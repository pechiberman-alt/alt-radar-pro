import { dollars } from "./volume-spike.ts";
import type { TelegramEvent } from "./telegram.ts";

/**
 * Big trades ("ballenas") from Arkham Intelligence, for Telegram: large on-chain
 * transfers read from Arkham's REST API (GET /transfers, header API-Key) in the
 * Worker, so they arrive with the app closed. Needs the owner's Arkham key
 * (CONFIGURACIÓN or the ARKHAM_API_KEY secret) and no database: the per-transfer
 * key that dispatch already records makes sure nothing is sent twice.
 * Arkham limits this endpoint to 1 request per second; one run makes one request.
 */

export const ARKHAM_URL = "https://api.arkm.com/transfers";
/** Below this a transfer is routine on the big chains; a phone muted by noise helps no one. */
export const BALLENAS_MIN_USD = 5_000_000;
/** Wider than the 5-minute cron so one missed run loses nothing; sent keys stop repeats. */
const WINDOW = "30m";
const MAX_EVENTS = 6;

export type BigTrade = {
  hash: string;
  chain: string;
  symbol: string;
  amount: number;
  /** Arkham's historical USD value at the time of the transfer. */
  usd: number;
  from: string;
  to: string;
  /** Milliseconds; null when Arkham did not say. */
  time: number | null;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The entity Arkham knows the address as, else a shortened address. */
function party(x: unknown): string {
  if (x && typeof x === "object") {
    const o = x as { address?: unknown; arkhamEntity?: { name?: unknown } | null };
    const name = o.arkhamEntity?.name;
    if (typeof name === "string" && name) return name;
    if (typeof o.address === "string" && o.address) return short(o.address);
  }
  return typeof x === "string" && x ? short(x) : "desconocido";
}

const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/** Pure: Arkham's response in, the transfers worth reading out. A row without a hash or a USD value is dropped, never guessed. */
export function parseTransfers(json: unknown, minUsd = BALLENAS_MIN_USD): BigTrade[] {
  const rows = (json as { transfers?: unknown } | null)?.transfers;
  if (!Array.isArray(rows)) return [];
  const out: BigTrade[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    const usd = Number(r?.historicalUSD);
    const hash = typeof r?.transactionHash === "string" ? r.transactionHash : "";
    if (!hash || !Number.isFinite(usd) || usd < minUsd) continue;
    const ts = Number(r.blockTimestamp);
    out.push({
      hash,
      chain: typeof r.chain === "string" ? r.chain : "?",
      symbol: typeof r.tokenSymbol === "string" && r.tokenSymbol ? r.tokenSymbol : "?",
      amount: Number(r.unitValue) || 0,
      usd,
      from: party(r.fromAddress),
      to: party(r.toAddress),
      time: Number.isFinite(ts) && ts > 0 ? (ts > 1e11 ? ts : ts * 1000) : null,
    });
  }
  return out.sort((a, b) => b.usd - a.usd);
}

const amountText = (n: number) => (n >= 1000 ? Math.round(n).toLocaleString("es-AR") : n.toFixed(2).replace(".", ","));

export function ballenaEvent(t: BigTrade): TelegramEvent {
  return {
    // One per transfer leg: the same one seen on the next run is not news.
    key: `ballena:${t.hash}:${t.symbol}:${t.from}:${t.to}`,
    category: "BALLENAS",
    priority: 62 + Math.min(8, Math.floor(Math.log10(Math.max(t.usd, 1) / BALLENAS_MIN_USD) * 8)),
    text:
      `<b>🐋 ${esc(dollars(t.usd))} · ${esc(t.symbol)} en ${esc(t.chain)}</b>\n` +
      `${esc(amountText(t.amount))} ${esc(t.symbol)} de <b>${esc(t.from)}</b> a <b>${esc(t.to)}</b>\n` +
      `<i>Valor en dólares de Arkham al momento de la transferencia. Una transferencia grande no dice hacia dónde va el precio. No es asesoramiento financiero.</i>`,
  };
}

/** One request, biggest first. Throws on a refused key so the caller can tell it from "nothing happened". */
export async function collectBallenaEvents(apiKey: string, fetchFn: typeof fetch = fetch): Promise<TelegramEvent[]> {
  const q = new URLSearchParams({ usdGte: String(BALLENAS_MIN_USD), timeLast: WINDOW, sortKey: "usd", sortDir: "desc", limit: "20" });
  const r = await fetchFn(`${ARKHAM_URL}?${q}`, { headers: { "API-Key": apiKey }, signal: AbortSignal.timeout(8000) });
  if (r.status === 401 || r.status === 403) throw new Error("Arkham rechazó la clave");
  if (!r.ok) throw new Error(`Arkham HTTP ${r.status}`);
  return parseTransfers(await r.json()).slice(0, MAX_EVENTS).map(ballenaEvent);
}
