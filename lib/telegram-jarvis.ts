import { coreActivitySince, ensureCoreSchema, readCoreStats } from "./jarvis-core-db.ts";
import type { JarvisSignal, LedgerStats } from "./jarvis-ledger.ts";
import type { TelegramEvent } from "./telegram.ts";

/**
 * Telegram messages from JARVIS CORE: each signal it opens (with the plan)
 * and each one it closes (with the result and the running record). Read from
 * the database by index since the last dispatch, so it costs a few rows.
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

export function jarvisEvents(activity: JarvisSignal[], since: number, st: LedgerStats): TelegramEvent[] {
  const out: TelegramEvent[] = [];
  const foot = `\n<i>${esc(recordLine(st))}\nAnálisis en papel, no órdenes. No es asesoramiento financiero.</i>`;
  for (const s of activity) {
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
      out.push({
        key: `jarvis:new:${s.id}`,
        category: "JARVIS",
        priority: 70,
        text: `🤖 <b>JARVIS · nueva señal · ${esc(coin(s.symbol))} ${side} · ${esc(s.timeframe)}</b>\n${esc(kind)}: ${esc(s.note)}\nEntrada <b>${px(s.entry)}</b> · stop <b>${px(s.stop)}</b> · objetivo <b>${px(s.target)}</b>\nSi una vela toca stop y objetivo, cuenta el stop.${foot}`,
      });
    }
  }
  return out;
}

/** Events since the last dispatch; the first run only sets the starting point. */
export async function collectJarvisEvents(db: D1Database, now: number): Promise<TelegramEvent[]> {
  await ensureCoreSchema(db);
  const row = await db.prepare("SELECT value FROM telegram_state WHERE key = 'jarvis_since'").first<{ value: string }>();
  await db.prepare("INSERT OR REPLACE INTO telegram_state (key, value) VALUES ('jarvis_since', ?1)").bind(String(now)).run();
  if (!row) return [];
  const since = Number(row.value) || now;
  const activity = await coreActivitySince(db, since, 20);
  if (!activity.length) return [];
  return jarvisEvents(activity, since, await readCoreStats(db));
}
