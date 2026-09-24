/**
 * Telegram alerts: the pure parts.
 *
 * The bot exists because an app cannot wake a phone on its own and a chat
 * connector only acts while someone is chatting. The Worker's cron detects
 * events 24/7 and this module turns them into Telegram messages. Everything
 * here is free of network and database so it can be tested directly; the
 * dispatcher (telegram-dispatch.ts) does the I/O.
 */

export type TelegramCategory = "SEÑAL" | "DCA" | "NOTICIAS" | "SENTIMIENTO";

export type TelegramPrefs = {
  categories: Record<TelegramCategory, boolean>;
  /** Signals below this score are not sent. */
  signalMinScore: number;
  /** Minutes behind UTC, as the browser reports it (Argentina: 180). Used to
   *  send DCA reminders in the user's morning, not at UTC midnight. */
  tzOffsetMin: number;
};

export const DEFAULT_TELEGRAM_PREFS: TelegramPrefs = {
  categories: { "SEÑAL": true, DCA: true, NOTICIAS: true, SENTIMIENTO: true },
  // Only the stronger signals by default: a phone that buzzes for every
  // setup gets muted within a day.
  signalMinScore: 75,
  tzOffsetMin: 180,
};

export function parsePrefs(raw: unknown): TelegramPrefs {
  const p = (raw ?? {}) as Partial<TelegramPrefs>;
  const categories = { ...DEFAULT_TELEGRAM_PREFS.categories };
  for (const key of Object.keys(categories) as TelegramCategory[]) {
    if (typeof p.categories?.[key] === "boolean") categories[key] = p.categories[key];
  }
  const score = Number(p.signalMinScore);
  return {
    categories,
    signalMinScore: Number.isFinite(score) ? Math.min(100, Math.max(0, Math.round(score))) : DEFAULT_TELEGRAM_PREFS.signalMinScore,
    tzOffsetMin: Number.isFinite(Number(p.tzOffsetMin)) && Math.abs(Number(p.tzOffsetMin)) <= 840 ? Math.round(Number(p.tzOffsetMin)) : DEFAULT_TELEGRAM_PREFS.tzOffsetMin,
  };
}

export type TelegramEvent = {
  /** Stable per event, used to never send the same thing twice. */
  key: string;
  category: TelegramCategory;
  /** Used to order and to decide what survives the per-run cap. */
  priority: number;
  text: string;
  /** For signals: the score the user's threshold is compared against. */
  score?: number;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const px = (v: number) =>
  v >= 1000 ? v.toLocaleString("es-AR", { maximumFractionDigits: 0 }) : v.toLocaleString("es-AR", { maximumFractionDigits: v >= 1 ? 3 : 6 });

export function signalEvent(s: {
  id: string;
  symbol: string;
  side: string;
  signal: string;
  score: number;
  entryPrice: number;
  timeframe: string;
}): TelegramEvent {
  const arrow = s.side === "LONG" ? "🟢 LONG" : "🔴 SHORT";
  return {
    key: `signal:${s.id}`,
    category: "SEÑAL",
    priority: s.score,
    score: s.score,
    text:
      `<b>${esc(s.symbol.replace("USDT", ""))} · ${arrow}</b>\n` +
      `${esc(s.signal)} · convicción <b>${s.score}%</b> · ${esc(s.timeframe)}\n` +
      `Entrada ${px(s.entryPrice)}\n` +
      `<i>Objetivo y riesgo en ALT RADAR → HISTORIAL. No es una orden.</i>`,
  };
}

export function dcaEvent(symbol: string, usd: number, day: string): TelegramEvent {
  return {
    key: `dca:${symbol}:${day}`,
    category: "DCA",
    priority: 60,
    text:
      `<b>📅 Día de compra · ${esc(symbol.replace("USDT", ""))}</b>\n` +
      `Tu calendario DCA marca <b>${usd} USD</b> hoy.\n` +
      `<i>Es un recordatorio: la compra la hacés vos y después la cargás en DCA.</i>`,
  };
}

export function newsEvent(n: { url: string; title: string; source: string; category: string; tone: string }): TelegramEvent {
  const tone = n.tone === "POSITIVO" ? "🟢" : n.tone === "NEGATIVO" ? "🔴" : "⚪";
  return {
    key: `news:${n.url}`,
    category: "NOTICIAS",
    priority: 70,
    text:
      `<b>📰 ${esc(n.category)} · alto impacto</b> ${tone}\n` +
      `${esc(n.title)}\n` +
      `<a href="${esc(n.url)}">${esc(n.source)}</a>\n` +
      `<i>El color es el tono del titular, no una predicción.</i>`,
  };
}

export function fearGreedEvent(value: number, zone: string, day: string): TelegramEvent | null {
  // Only the extremes are worth a notification; the middle is weather.
  if (zone !== "MIEDO EXTREMO" && zone !== "AVARICIA EXTREMA") return null;
  const note =
    zone === "MIEDO EXTREMO"
      ? "Pánico en el mercado. Históricamente coincidió con zonas de compra, pero puede durar semanas."
      : "Euforia y apalancamiento alto. Históricamente coincidió con techos locales, aunque puede extenderse.";
  return {
    key: `fng:${zone}:${day}`,
    category: "SENTIMIENTO",
    priority: 65,
    text: `<b>${zone === "MIEDO EXTREMO" ? "😨" : "🤑"} Miedo y Avaricia: ${value} · ${zone}</b>\n${note}`,
  };
}

/**
 * What one user receives this run: their categories and threshold, nothing
 * already sent, at most `cap` messages — the rest are folded into one summary
 * line rather than dropped silently or sent as a burst.
 */
export function selectForUser(
  events: TelegramEvent[],
  prefs: TelegramPrefs,
  alreadySent: Set<string>,
  cap = 4,
): { send: TelegramEvent[]; rest: TelegramEvent[]; suppressed: number } {
  const eligible = events
    .filter((e) => prefs.categories[e.category])
    .filter((e) => e.category !== "SEÑAL" || (e.score ?? 0) >= prefs.signalMinScore)
    .filter((e) => !alreadySent.has(e.key))
    .sort((a, b) => b.priority - a.priority);
  const rest = eligible.slice(cap);
  return { send: eligible.slice(0, cap), rest, suppressed: rest.length };
}

export type BotCommand = { cmd: "start" | "stop" | "estado" | "ayuda"; arg: string };

export function parseCommand(text: string | undefined): BotCommand {
  const m = (text ?? "").trim().match(/^\/(\w+)(?:@\w+)?(?:\s+(.*))?$/);
  const name = m?.[1]?.toLowerCase() ?? "";
  const arg = (m?.[2] ?? "").trim();
  if (name === "start") return { cmd: "start", arg };
  if (name === "stop") return { cmd: "stop", arg };
  if (name === "estado") return { cmd: "estado", arg };
  return { cmd: "ayuda", arg };
}

/** Webhook secret derived from the bot token: Telegram echoes it in a header,
 *  so a forged request without the token cannot drive the bot. */
export async function webhookSecret(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`alt-radar:${token}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 48);
}

export function linkCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20);
}

export const TELEGRAM_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS telegram_links (
    user_id INTEGER PRIMARY KEY,
    chat_id TEXT NOT NULL,
    prefs TEXT NOT NULL DEFAULT '{}',
    linked_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS telegram_link_codes (
    code TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS telegram_sent (
    key TEXT PRIMARY KEY,
    sent_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS telegram_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];

/** Thin Bot API client. */
export async function tg(token: string, method: string, body: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; description?: string }> {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  return (await r.json().catch(() => ({ ok: false }))) as { ok: boolean; result?: unknown; description?: string };
}

export function sendMessage(token: string, chatId: string, text: string) {
  return tg(token, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true });
}
