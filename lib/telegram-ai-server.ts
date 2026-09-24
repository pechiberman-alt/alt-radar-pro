import { buildSystemPrompt, buildUserMessage, type ChatTurn } from "./ai-analyst.ts";
import { askClaude, consumeQuota, quotaFor } from "./ai-analyst-server.ts";
import { getSecret, type SettingsEnv } from "./app-settings.ts";
import { KNOWLEDGE } from "./assistant/knowledge.ts";
import { loadCryptoNews, type CryptoNewsResult } from "./crypto-news.ts";
import { parseFearGreed, type FearGreed } from "./fear-greed.ts";
import { sendMessage, tg } from "./telegram.ts";
import { buildServerSnapshot, markdownToTelegramHtml, splitForTelegram, type ServerSnapshot } from "./telegram-ai.ts";
import { cached } from "./upstream-cache.ts";

const SYSTEM =
  buildSystemPrompt(KNOWLEDGE) +
  "\n\nFORMATO: estás respondiendo en un chat de Telegram. Texto corto (máximo ~150 palabras), párrafos breves, **negrita** sólo para lo clave, sin tablas ni encabezados largos.";

const MAJORS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT"];
const SPOT_HOSTS = ["https://data-api.binance.vision", "https://api-gcp.binance.com", "https://api.binance.com"];

async function majorsFromBinance() {
  const q = encodeURIComponent(JSON.stringify(MAJORS));
  for (const host of SPOT_HOSTS) {
    try {
      const r = await fetch(`${host}/api/v3/ticker/24hr?symbols=${q}`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) continue;
      const rows = (await r.json()) as { symbol?: string; lastPrice?: string; priceChangePercent?: string }[];
      const out = rows
        .map((x) => ({ s: String(x.symbol), price: Number(x.lastPrice), ch24h: Number(x.priceChangePercent) }))
        .filter((x) => x.price > 0);
      if (out.length) return out;
    } catch {
      // Next host.
    }
  }
  return [];
}

export async function loadServerSnapshot(db: D1Database, now = Date.now()): Promise<ServerSnapshot> {
  const [majors, signals, fg, news, structure] = await Promise.all([
    majorsFromBinance(),
    db
      .prepare(
        `SELECT symbol, side, score, entry_price, timeframe, detected_at FROM signal_records
          WHERE status = 'MONITORING' ORDER BY score DESC LIMIT 10`,
      )
      .all<{ symbol: string; side: string; score: number; entry_price: number; timeframe: string; detected_at: string }>()
      .then((r) => r.results)
      .catch(() => []),
    cached<FearGreed>("fear-greed", 30 * 60_000, async () => {
      const r = await fetch("https://api.alternative.me/fng/?limit=31&format=json", { signal: AbortSignal.timeout(6000) });
      return r.ok ? parseFearGreed(await r.json()) : null;
    }, 24 * 3_600_000).catch(() => ({ value: null })),
    cached<CryptoNewsResult>("crypto-news", 10 * 60_000, async () => {
      const r = await loadCryptoNews(now);
      return r.items.length ? r : null;
    }, 6 * 3_600_000).catch(() => ({ value: null })),
    db
      .prepare("SELECT * FROM structure_snapshots ORDER BY captured_at DESC LIMIT 1")
      .first<Record<string, number | string | null>>()
      .catch(() => null),
  ]);

  return buildServerSnapshot(
    {
      majors,
      openSignals: signals.map((x) => ({ s: x.symbol, side: x.side, score: x.score, entry: x.entry_price, tf: x.timeframe, since: x.detected_at })),
      fearGreed: fg.value ? { value: fg.value.value, zone: fg.value.zone } : null,
      structure: structure ?? null,
      news: (news.value?.items ?? [])
        .filter((n) => n.impact !== "BAJO" && now - n.publishedAt < 12 * 3_600_000)
        .map((n) => ({ title: n.title, category: n.category, impact: n.impact, tone: n.tone, source: n.source })),
    },
    now,
  );
}

const CHAT_SCHEMA =
  "CREATE TABLE IF NOT EXISTS telegram_chat (chat_id TEXT NOT NULL, at INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL)";

export async function clearChat(db: D1Database, chatId: string) {
  await db.prepare(CHAT_SCHEMA).run();
  await db.prepare("DELETE FROM telegram_chat WHERE chat_id = ?1").bind(chatId).run();
}

/**
 * Answers a free-text question in Telegram with the analyst. Runs in the
 * background (the webhook has already answered Telegram), so every failure
 * ends in a message to the user rather than a silent drop.
 */
export async function answerInTelegram(db: D1Database, env: SettingsEnv, token: string, chatId: string, userId: number, question: string) {
  try {
    await tg(token, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => undefined);

    const quota = await quotaFor(db, userId);
    if (!quota.allowed) {
      await sendMessage(token, chatId, `Llegaste al límite de ${quota.limit} preguntas con IA por hoy (se comparte con la app). Se renueva mañana.`);
      return;
    }
    const key = (await getSecret(db, env, "anthropic_api_key")).value;
    if (!key) {
      await sendMessage(token, chatId, "La IA todavía no está activada: falta cargar la clave de Anthropic en la app → CONFIGURACIÓN.");
      return;
    }

    await db.prepare(CHAT_SCHEMA).run();
    const history = (
      await db
        .prepare("SELECT role, content FROM telegram_chat WHERE chat_id = ?1 AND at > ?2 ORDER BY at DESC LIMIT 6")
        .bind(chatId, Date.now() - 6 * 3_600_000)
        .all<{ role: "user" | "assistant"; content: string }>()
    ).results.reverse();

    const snapshot = await loadServerSnapshot(db);
    const messages: ChatTurn[] = [...history, { role: "user", content: buildUserMessage(question, snapshot) }];
    const answer = await askClaude(key, SYSTEM, messages);
    if (!answer.ok) {
      await sendMessage(
        token,
        chatId,
        answer.error === "CLAVE DE IA INVÁLIDA"
          ? "La clave de IA fue rechazada por Anthropic. Revisala en la app → CONFIGURACIÓN."
          : "La IA no pudo responder ahora. Probá de nuevo en un rato.",
      );
      return;
    }

    for (const part of splitForTelegram(markdownToTelegramHtml(answer.text))) {
      await sendMessage(token, chatId, part);
    }
    await consumeQuota(db, userId, quota.day);
    const now = Date.now();
    // Only the plain question and answer are kept — never the data snapshot —
    // so follow-ups work without re-sending old market data.
    await db.batch([
      db.prepare("INSERT INTO telegram_chat (chat_id, at, role, content) VALUES (?1, ?2, 'user', ?3)").bind(chatId, now, question.slice(0, 1500)),
      db.prepare("INSERT INTO telegram_chat (chat_id, at, role, content) VALUES (?1, ?2, 'assistant', ?3)").bind(chatId, now + 1, answer.text.slice(0, 1500)),
      db.prepare("DELETE FROM telegram_chat WHERE at < ?1").bind(now - 2 * 86_400_000),
    ]);
  } catch (error) {
    console.error("[ALT_RADAR_TELEGRAM_AI]", error);
    await sendMessage(token, chatId, "Hubo un error respondiendo. Probá de nuevo.").catch(() => undefined);
  }
}
