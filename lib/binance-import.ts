import type { JFill, Market } from "./account-journal.ts";

/**
 * Reads a trade-history file exported from Binance's website.
 *
 * The exports differ by product and over time, and their exact columns could
 * not be checked against a real file from here — so nothing is assumed by
 * position. Columns are found by name (English and Spanish, ignoring case,
 * spaces and punctuation); if a required one is missing the parse stops and
 * lists the headers it found. Every row that can't be read is reported with
 * its line and reason instead of being guessed at, and a cross-check
 * (quantity × price against the file's own amount column) flags a file whose
 * columns were misread.
 *
 * Numbers may carry their asset ("0.0012BTC"); dates are read as UTC, as
 * Binance's headers say.
 */

// Accents are stripped first: "Símbolo" and "Comisión" must match their plain aliases.
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const ALIASES = {
  time: ["dateutc", "timeutc", "date", "time", "fecha", "fechautc", "datetime", "tiempo"],
  symbol: ["symbol", "pair", "par", "market", "contract", "simbolo", "contrato"],
  side: ["side", "lado", "direction", "direccion", "type", "tipo"],
  price: ["price", "precio", "averageprice", "avgprice", "executionprice", "precioejecucion"],
  qty: ["quantity", "qty", "executed", "filled", "cantidad", "ejecutado", "executedqty"],
  amount: ["amount", "total", "tradingtotal", "quotequantity", "quoteamount", "monto", "importe"],
  fee: ["fee", "fees", "commission", "comision", "comisiones"],
  feeCoin: ["feecoin", "feecurrency", "feeasset", "commissionasset", "feeunit", "activocomision", "monedacomision"],
  realized: ["realizedprofit", "realizedpnl", "realizedpnlusdt", "realizedprofitusdt", "pnlrealizado", "gananciarealizada"],
} as const;
type Field = keyof typeof ALIASES;

export function parseCsv(text: string): { rows: string[][]; delimiter: string } {
  const src = text.replace(/^\uFEFF/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length - 1] as const);
  const delimiter = counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts[0][0] : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return { rows, delimiter };
}

export function parseQuantity(raw: string, decimalComma: boolean): { value: number; unit: string } | null {
  const m = /^([-+]?[\d.,]*\d(?:[eE][-+]?\d+)?)\s*([A-Za-z][A-Za-z0-9]*)?$/.exec(raw.trim());
  if (!m) return null;
  const digits = decimalComma ? m[1].replace(/\./g, "").replace(",", ".") : m[1].replace(/,/g, "");
  const value = Number(digits);
  return Number.isFinite(value) ? { value, unit: (m[2] ?? "").toUpperCase() } : null;
}

export function parseTime(raw: string): number | null {
  const s = raw.trim();
  if (/^\d{13}$/.test(s)) return Number(s);
  const m = /^(\d{2,4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (!m) return null;
  const year = m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1]);
  const [mo, d, h, mi, sec] = [Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  const ms = m[7] ? Number(m[7].padEnd(3, "0")) : 0;
  const t = Date.UTC(year, mo - 1, d, h, mi, sec, ms);
  const check = new Date(t);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59 || sec > 59) return null;
  if (m[8] && m[8] !== "Z") {
    const sign = m[8][0] === "-" ? -1 : 1;
    const digitsOnly = m[8].replace(/[^0-9]/g, "");
    return t - sign * (Number(digitsOnly.slice(0, 2)) * 60 + Number(digitsOnly.slice(2, 4))) * 60_000;
  }
  return t;
}

export function parseSide(raw: string): "BUY" | "SELL" | null {
  const s = raw.trim().toLowerCase();
  if (["buy", "compra", "comprar", "b", "bought"].includes(s)) return "BUY";
  if (["sell", "venta", "vender", "s", "sold"].includes(s)) return "SELL";
  if (/^(open|abrir)\s*long|^close\s*short|^cerrar\s*short/.test(s)) return "BUY";
  if (/^(open|abrir)\s*short|^close\s*long|^cerrar\s*long/.test(s)) return "SELL";
  return null;
}

export type ImportResult =
  | { ok: false; error: string; headers: string[] }
  | {
      ok: true;
      fills: JFill[];
      rows: number;
      skippedZero: number;
      rejected: { line: number; reason: string }[];
      mapping: Partial<Record<Field, string>>;
      from: number | null;
      to: number | null;
      symbols: string[];
      /** Rows where quantity × price differs from the file's own amount by more than 2%. */
      mismatched: number;
      warnings: string[];
    };

export function parseBinanceCsv(text: string, market: Market): ImportResult {
  const { rows, delimiter } = parseCsv(text);
  if (rows.length < 2) return { ok: false, error: "El archivo está vacío o no tiene filas de operaciones.", headers: rows[0] ?? [] };
  const headers = rows[0].map((h) => h.trim());
  const normalized = headers.map(norm);
  const at: Partial<Record<Field, number>> = {};
  (Object.keys(ALIASES) as Field[]).forEach((field) => {
    // Aliases are tried in priority order so "side" wins over a "type" column.
    for (const alias of ALIASES[field]) {
      const i = normalized.indexOf(alias);
      if (i >= 0) {
        at[field] = i;
        break;
      }
    }
  });
  const missing = (["time", "symbol", "side", "price", "qty"] as Field[]).filter((f) => at[f] === undefined);
  if (missing.length) {
    const names: Record<string, string> = { time: "fecha/hora", symbol: "par", side: "lado (compra/venta)", price: "precio", qty: "cantidad" };
    return { ok: false, error: `No encontré estas columnas: ${missing.map((m) => names[m]).join(", ")}. Revisá que sea el historial de operaciones (no de órdenes ni de depósitos).`, headers };
  }

  const decimalComma = delimiter === ";";
  const fills: JFill[] = [];
  const rejected: { line: number; reason: string }[] = [];
  const seen = new Map<string, number>();
  let skippedZero = 0;
  let mismatched = 0;
  let checked = 0;

  for (let i = 1; i < rows.length; i += 1) {
    const r = rows[i];
    const cell = (f: Field) => (at[f] === undefined ? "" : (r[at[f] as number] ?? "").trim());
    const line = i + 1;
    const time = parseTime(cell("time"));
    const side = parseSide(cell("side"));
    const price = parseQuantity(cell("price"), decimalComma);
    const qty = parseQuantity(cell("qty"), decimalComma);
    const symbol = cell("symbol").toUpperCase().replace(/[\s/_-]/g, "").replace(/(PERPETUAL|PERP)$/, "");
    if (time === null) { rejected.push({ line, reason: `fecha no reconocida: «${cell("time")}»` }); continue; }
    if (!side) { rejected.push({ line, reason: `lado no reconocido: «${cell("side")}»` }); continue; }
    if (!price || !(price.value > 0)) { rejected.push({ line, reason: `precio inválido: «${cell("price")}»` }); continue; }
    if (!qty) { rejected.push({ line, reason: `cantidad inválida: «${cell("qty")}»` }); continue; }
    if (!(qty.value > 0)) { skippedZero += 1; continue; }
    if (!/^[A-Z0-9]{2,24}$/.test(symbol)) { rejected.push({ line, reason: `par no reconocido: «${cell("symbol")}»` }); continue; }

    const amountCell = cell("amount");
    if (amountCell) {
      const amount = parseQuantity(amountCell, decimalComma);
      if (amount && amount.value > 0) {
        checked += 1;
        if (Math.abs(qty.value * price.value - amount.value) / amount.value > 0.02) mismatched += 1;
      }
    }
    const feeParsed = cell("fee") ? parseQuantity(cell("fee"), decimalComma) : null;
    if (cell("fee") && !feeParsed) { rejected.push({ line, reason: `comisión inválida: «${cell("fee")}»` }); continue; }
    const feeAsset = (cell("feeCoin") || feeParsed?.unit || (market === "futures" ? "USDT" : "?")).toUpperCase();
    const realizedCell = cell("realized");
    const realized = realizedCell ? parseQuantity(realizedCell, decimalComma) : null;

    const base = `imp-${market}-${symbol}-${time}-${side}-${price.value}-${qty.value}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    fills.push({
      id: `${base}#${n}`.slice(0, 120), market, source: "import", time, symbol, side, price: price.value, qty: qty.value,
      fee: Math.abs(feeParsed?.value ?? 0), feeAsset: /^[A-Z0-9?]{1,12}$/.test(feeAsset) ? feeAsset : "?",
      realizedPnl: market === "futures" && realized ? realized.value : null, positionSide: "BOTH", liquidation: false,
    });
  }

  const warnings: string[] = [];
  if (checked >= 5 && mismatched / checked > 0.2) {
    warnings.push(`En ${mismatched} de ${checked} filas cantidad × precio no coincide con el monto del archivo: puede que las columnas estén mal interpretadas. Revisá la vista previa antes de importar.`);
  }
  if (rejected.length) warnings.push(`${rejected.length} fila(s) no se pudieron leer y se van a omitir.`);
  const times = fills.map((f) => f.time);
  const mapping: Partial<Record<Field, string>> = {};
  (Object.keys(at) as Field[]).forEach((f) => (mapping[f] = headers[at[f] as number]));
  return {
    ok: true, fills, rows: rows.length - 1, skippedZero, rejected, mapping,
    from: times.length ? Math.min(...times) : null, to: times.length ? Math.max(...times) : null,
    symbols: [...new Set(fills.map((f) => f.symbol))].sort(), mismatched, warnings,
  };
}

/** Spot pairs to read history for: every non-stable asset with a balance, plus the ones the person adds. */
export function spotCandidates(balances: { asset: string; free: string; locked: string }[], extra: string[]): string[] {
  const stables = new Set(["USDT", "USDC", "FDUSD", "BUSD", "TUSD", "USDP", "DAI"]);
  const out = new Set<string>();
  for (const b of balances) {
    if (stables.has(b.asset) || !/^[A-Z0-9]{1,12}$/.test(b.asset)) continue;
    if (Number(b.free) > 0 || Number(b.locked) > 0) out.add(`${b.asset}USDT`);
  }
  for (const raw of extra) {
    const s = raw.toUpperCase().replace(/[\s/_-]/g, "");
    if (/^[A-Z0-9]{5,24}$/.test(s)) out.add(s);
  }
  return [...out].sort();
}

/** Reads one symbol's whole history forward in pages of 1000, starting after `afterId`. */
export async function readSpotHistory<T extends { id: number }>(
  getPage: (fromId: number) => Promise<T[]>,
  afterId: number | null,
  maxPages = 60,
): Promise<T[]> {
  const all: T[] = [];
  let fromId = afterId === null ? 0 : afterId + 1;
  for (let page = 0; page < maxPages; page += 1) {
    const rows = await getPage(fromId);
    all.push(...rows);
    if (rows.length < 1000) break;
    fromId = Math.max(...rows.map((r) => r.id)) + 1;
  }
  return all;
}
