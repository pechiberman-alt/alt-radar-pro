import type { PaperTrade } from "./paper-bot.ts";

/**
 * The permanent record of the futures bot: one row per closed trade.
 *
 * The bot's own state lives in the browser and is wiped by "reiniciar
 * cuenta"; this record is not. It is kept in the browser AND, for a logged-in
 * person, in the account, so it survives a reset, a cleared browser or a
 * different computer. Rows are keyed by (account start, trade id): a trade id
 * alone is not unique, since after a reset the same candle can be traded again.
 */

export type JournalStatus = "win" | "loss" | "timeout" | "news";

export type JournalRow = {
  id: string;
  /** When the paper account this trade belongs to was started. */
  runStartedAt: number;
  symbol: string;
  side: "COMPRA" | "VENTA";
  timeframe: string | null;
  leverage: number;
  entryTime: number;
  exitTime: number;
  entry: number;
  exit: number;
  qty: number;
  notional: number;
  margin: number;
  riskUsd: number;
  pnl: number;
  r: number;
  fees: number;
  status: JournalStatus;
  note: string | null;
};

export const journalKey = (row: Pick<JournalRow, "runStartedAt" | "id">) => `${row.runStartedAt}:${row.id}`;

/** A closed trade as a record row; null while it is still open. */
export function journalRowFrom(trade: PaperTrade, runStartedAt: number): JournalRow | null {
  if (trade.status === "open" || trade.exit === undefined || trade.exitTime === undefined || trade.pnl === undefined) return null;
  return {
    id: trade.id,
    runStartedAt,
    symbol: trade.symbol,
    side: trade.side,
    timeframe: trade.timeframe ?? null,
    leverage: trade.leverage,
    entryTime: trade.entryTime,
    exitTime: trade.exitTime,
    entry: trade.entry,
    exit: trade.exit,
    qty: trade.qty,
    notional: trade.notional,
    margin: trade.margin,
    riskUsd: trade.riskUsd,
    pnl: trade.pnl,
    r: trade.r ?? 0,
    fees: trade.fees ?? 0,
    status: trade.status,
    note: trade.note ?? null,
  };
}

const STATUSES = new Set<JournalStatus>(["win", "loss", "timeout", "news"]);
const MIN_TIME = Date.UTC(2020, 0, 1);

/** Server-side check of a row sent by a browser: anything off is refused, not repaired. */
export function validateJournalRow(raw: unknown, now = Date.now()): JournalRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (k: string) => (typeof r[k] === "number" && Number.isFinite(r[k]) ? (r[k] as number) : null);
  const time = (k: string) => {
    const v = num(k);
    return v !== null && v >= MIN_TIME && v <= now + 86_400_000 ? v : null;
  };
  const id = typeof r.id === "string" && r.id.length > 0 && r.id.length <= 80 ? r.id : null;
  const symbol = typeof r.symbol === "string" && /^[A-Z0-9]{2,20}$/.test(r.symbol) ? r.symbol : null;
  const side = r.side === "COMPRA" || r.side === "VENTA" ? r.side : null;
  const status = typeof r.status === "string" && STATUSES.has(r.status as JournalStatus) ? (r.status as JournalStatus) : null;
  const timeframe = r.timeframe === null || r.timeframe === undefined ? null : typeof r.timeframe === "string" && /^[0-9]{1,2}[mhdw]$/.test(r.timeframe) ? r.timeframe : undefined;
  const note = r.note === null || r.note === undefined ? null : typeof r.note === "string" ? r.note.slice(0, 200) : undefined;
  const runStartedAt = time("runStartedAt");
  const entryTime = time("entryTime");
  const exitTime = time("exitTime");
  const values = ["leverage", "entry", "exit", "qty", "notional", "margin", "riskUsd", "pnl", "r", "fees"].map(num);
  if (!id || !symbol || !side || !status || timeframe === undefined || note === undefined) return null;
  if (runStartedAt === null || entryTime === null || exitTime === null || exitTime < entryTime) return null;
  if (values.some((v) => v === null)) return null;
  const [leverage, entry, exit, qty, notional, margin, riskUsd, pnl, rr, fees] = values as number[];
  if (!(leverage >= 1 && leverage <= 125) || !(entry > 0) || !(exit > 0) || !(qty > 0) || !(notional > 0) || !(margin > 0) || fees < 0 || riskUsd < 0) return null;
  return { id, runStartedAt, symbol, side, timeframe, leverage, entryTime, exitTime, entry, exit, qty, notional, margin, riskUsd, pnl, r: rr, fees, status, note };
}

/** Union of several sources, one row per key (the first source wins), oldest close first. */
export function mergeJournal(...sources: JournalRow[][]): JournalRow[] {
  const byKey = new Map<string, JournalRow>();
  for (const source of sources) for (const row of source) if (!byKey.has(journalKey(row))) byKey.set(journalKey(row), row);
  return [...byKey.values()].sort((a, b) => a.exitTime - b.exitTime || a.id.localeCompare(b.id));
}

export type JournalGroup = { key: string; count: number; profitable: number; net: number; profitFactor: number | null };

export type JournalSummary = {
  count: number;
  profitable: number;
  winRate: number | null;
  /** Gross profit over gross loss; Infinity with no losing trade, null with no trades. */
  profitFactor: number | null;
  net: number;
  fees: number;
  best: JournalRow | null;
  worst: JournalRow | null;
  bySymbol: JournalGroup[];
  byMonth: JournalGroup[];
  byStatus: Record<JournalStatus, number>;
};

function group(rows: JournalRow[], keyOf: (row: JournalRow) => string): JournalGroup[] {
  const map = new Map<string, JournalRow[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return [...map.entries()].map(([key, list]) => {
    const gain = list.filter((r) => r.pnl > 0).reduce((s, r) => s + r.pnl, 0);
    const loss = list.filter((r) => r.pnl < 0).reduce((s, r) => s - r.pnl, 0);
    return {
      key,
      count: list.length,
      profitable: list.filter((r) => r.pnl > 0).length,
      net: gain - loss,
      profitFactor: loss > 0 ? gain / loss : gain > 0 ? Infinity : null,
    };
  });
}

/** `monthOf` is injected so the grouping follows the reader's own time zone. */
export function journalSummary(rows: JournalRow[], monthOf: (t: number) => string): JournalSummary {
  const all = group(rows, () => "all")[0];
  let best: JournalRow | null = null;
  let worst: JournalRow | null = null;
  for (const row of rows) {
    if (!best || row.pnl > best.pnl) best = row;
    if (!worst || row.pnl < worst.pnl) worst = row;
  }
  const byStatus: Record<JournalStatus, number> = { win: 0, loss: 0, timeout: 0, news: 0 };
  for (const row of rows) byStatus[row.status] += 1;
  return {
    count: rows.length,
    profitable: all?.profitable ?? 0,
    winRate: rows.length ? (all.profitable / rows.length) : null,
    profitFactor: all?.profitFactor ?? null,
    net: all?.net ?? 0,
    fees: rows.reduce((s, r) => s + r.fees, 0),
    best,
    worst,
    bySymbol: group(rows, (r) => r.symbol).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    byMonth: group(rows, (r) => monthOf(r.exitTime)).sort((a, b) => b.key.localeCompare(a.key)),
    byStatus,
  };
}

export const STATUS_LABEL: Record<JournalStatus, string> = {
  win: "Objetivo",
  loss: "Stop",
  timeout: "Tiempo",
  news: "Cerrada por noticia",
};

/**
 * CSV for a Spanish-locale spreadsheet: semicolons between fields, decimal
 * comma, no thousands separator, UTF-8 with a byte-order mark so accents
 * survive. Text a spreadsheet could read as a formula is neutralised.
 */
export function journalCsv(rows: JournalRow[], formatTime: (t: number) => string): string {
  const n = (v: number, digits = 8) => (Number.isFinite(v) ? String(Number(v.toFixed(digits))).replace(".", ",") : "");
  const text = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const header = [
    "Apertura", "Cierre", "Par", "Lado", "Marco", "Apalancamiento", "Entrada", "Salida", "Cantidad",
    "Nocional USDT", "Margen USDT", "Riesgo USDT", "Resultado USDT", "Resultado R", "Comisiones USDT",
    "Motivo de cierre", "Nota", "Cuenta iniciada",
  ];
  const lines = rows.map((r) =>
    [
      text(formatTime(r.entryTime)), text(formatTime(r.exitTime)), text(r.symbol), text(r.side), text(r.timeframe ?? ""),
      n(r.leverage, 2), n(r.entry), n(r.exit), n(r.qty), n(r.notional, 2), n(r.margin, 2), n(r.riskUsd, 2),
      n(r.pnl, 2), n(r.r, 2), n(r.fees, 2), text(STATUS_LABEL[r.status]), text(r.note ?? ""), text(formatTime(r.runStartedAt)),
    ].join(";"),
  );
  return `\uFEFF${[header.join(";"), ...lines].join("\r\n")}\r\n`;
}
