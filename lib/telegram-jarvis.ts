import { coreActivitySince, ensureCoreSchema, loadModel, readCoreStats } from "./jarvis-core-db.ts";
import type { CoreSignal } from "./jarvis-core.ts";
import type { LedgerStats } from "./jarvis-ledger.ts";
import { summarizeModel, type LearnSummary } from "./jarvis-learn.ts";
import type { TelegramEvent } from "./telegram.ts";

/**
 * Telegram messages from JARVIS CORE: each signal it takes (with the plan and
 * what it had learned about that kind of signal), each one it closes (with the
 * result and the running record), and once a day, after 12:00 UTC (9 in
 * Argentina), a log of its record and what it has learned. Signals it kept in
 * shadow are not announced; they are measured in the app.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const px = (v: number) => v.toLocaleString("es-AR", { maximumFractionDigits: v >= 1000 ? 0 : v >= 1 ? 3 : 6 });
const coin = (s: string) => s.replace(/USDT$/, "");
const pf = (v: number | null) => (v === null ? "—" : v === Infinity ? "∞" : v.toFixed(2).replace(".", ","));
const rr = (r: number) => `${r >= 0 ? "+" : ""}${r.toFixed(2).replace(".", ",")}R`;

export function recordLine(st: LedgerStats): string {
  if (!st.resolved) return "Registro del núcleo: todavía sin señales cerradas.";
  return `Registro del núcleo: ${st.resolved} cerradas · win rate ${Math.round((st.winRate ?? 0) * 100)}% · PF ${pf(st.profitFactor)} · ${rr(st.totalR)}${
    st.confidence === "MUESTRA RAZONABLE" ? "" : " · muestra mínima"
  }`;
}

/** The learning line of a signal: its grade, the estimate with its error and sample, and why. */
export function gradeLine(s: CoreSignal, n: number | null): string {
  if (!s.grade || s.expectR === null) return "";
  if (s.grade === "APRENDIENDO") return `\nAprendizaje: todavía pocos casos de este tipo${n !== null ? ` (${n})` : ""} para opinar.`;
  const label = s.grade === "FAVORABLE" ? "favorable" : s.grade === "NEUTRA" ? "neutra" : "desfavorable";
  return `\nAprendizaje: ${label} · esperado ${rr(s.expectR)} ± ${Math.abs(s.expectSe ?? 0).toFixed(2).replace(".", ",")}${n !== null ? ` (${n} casos)` : ""}${s.why ? `\nPesa: ${esc(s.why)}` : ""}`;
}

export function jarvisEvents(activity: CoreSignal[], since: number, st: LedgerStats, learn: LearnSummary | null): TelegramEvent[] {
  const out: TelegramEvent[] = [];
  const foot = `\n<i>${esc(recordLine(st))}\nAnálisis en papel, no órdenes. No es asesoramiento financiero.</i>`;
  for (const s of activity) {
    if (s.taken === false) continue;
    const side = s.side === "LONG" ? "LARGO ▲" : "CORTO ▼";
    const kind = s.source === "ROMPE" ? "ruptura" : "barrida de imán";
    if (s.closedAt !== null && s.closedAt > since && s.r !== null) {
      const icon = s.r > 0 ? "✅" : s.r < 0 ? "❌" : "➖";
      const how = s.result === "OBJETIVO" ? "llegó al objetivo" : s.result === "STOP" ? "tocó el stop" : "cerró por tiempo";
      out.push({
        key: `jarvis:closed:${s.id}`,
        category: "JARVIS",
        priority: 60,
        text: `${icon} <b>JARVIS · ${esc(coin(s.symbol))} ${side} · ${esc(s.timeframe)}</b>\n${how}: <b>${rr(s.r)}</b> (comisiones incluidas)\nEntrada ${px(s.entry)} · stop ${px(s.stop)} · objetivo ${px(s.target)}${foot}`,
      });
    } else if (s.result === "ABIERTA") {
      const n = learn ? learn.sources[s.source].n : null;
      out.push({
        key: `jarvis:new:${s.id}`,
        category: "JARVIS",
        priority: 70,
        text: `🤖 <b>JARVIS · nueva señal · ${esc(coin(s.symbol))} ${side} · ${esc(s.timeframe)}</b>\n${esc(kind)}: ${esc(s.note)}\nEntrada <b>${px(s.entry)}</b> · stop <b>${px(s.stop)}</b> · objetivo <b>${px(s.target)}</b>${gradeLine(s, n)}\nSi una vela toca stop y objetivo, cuenta el stop.${foot}`,
      });
    }
  }
  return out;
}

/** Once a day: the record, the shadow, how much it has studied and what it has learned. */
export function dailyEvent(day: string, st: LedgerStats, learn: LearnSummary | null): TelegramEvent {
  const lines = [`🧠 <b>JARVIS · bitácora del ${esc(day.split("-").reverse().join("/"))}</b>`, esc(recordLine(st))];
  if (learn) {
    lines.push(
      `Estudié ${learn.historyCases.toLocaleString("es-AR")} situaciones de la historia de ${learn.coins} monedas${learn.liveCases ? ` y ${learn.liveCases} señales en vivo` : ""}${learn.backlog ? `; quedan ${learn.backlog.toLocaleString("es-AR")} velas por estudiar` : ""}.`,
    );
    for (const l of [...learn.sources.ROMPE.lessons.slice(0, 3), ...(learn.sources["IMÁN"].n ? learn.sources["IMÁN"].lessons.slice(0, 2) : [])]) lines.push(`• ${esc(l)}`);
  }
  lines.push("<i>Promedios con comisiones; si una vela toca stop y objetivo, cuenta el stop. No es asesoramiento financiero.</i>");
  return { key: `jarvis:daily:${day}`, category: "JARVIS", priority: 50, text: lines.join("\n") };
}

/** Events since the last dispatch; the first run only sets the starting point. */
export async function collectJarvisEvents(db: D1Database, now: number): Promise<TelegramEvent[]> {
  await ensureCoreSchema(db);
  const row = await db.prepare("SELECT value FROM telegram_state WHERE key = 'jarvis_since'").first<{ value: string }>();
  await db.prepare("INSERT OR REPLACE INTO telegram_state (key, value) VALUES ('jarvis_since', ?1)").bind(String(now)).run();
  if (!row) return [];
  const since = Number(row.value) || now;
  const activity = await coreActivitySince(db, since, 20);
  const day = new Date(now).toISOString().slice(0, 10);
  const wantDaily = new Date(now).getUTCHours() >= 12;
  if (!activity.length && !wantDaily) return [];
  const [st, loaded] = await Promise.all([readCoreStats(db), loadModel(db)]);
  const learn = loaded.exists ? summarizeModel(loaded.model) : null;
  const out = jarvisEvents(activity, since, st, learn);
  // The dispatch skips keys already sent, so this goes out once per day.
  if (wantDaily && (st.resolved > 0 || (learn?.historyCases ?? 0) > 0)) out.push(dailyEvent(day, st, learn));
  return out;
}
