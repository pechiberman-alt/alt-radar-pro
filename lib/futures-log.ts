/**
 * The record of the person's REAL Binance USDⓈ-M futures activity.
 *
 * Source: the account's private user-data stream. Binance pushes an
 * ORDER_TRADE_UPDATE for every execution (price, quantity, fee, realised
 * PnL) and an ACCOUNT_UPDATE for every funding payment, the moment they
 * happen. That stream is the only route a browser has to this data — the
 * trade-history endpoint (GET /fapi/v1/userTrades) is HTTP-only, which CORS
 * blocks in a browser and Binance's firewall blocks from our server — so
 * activity is recorded while the app is open, not retroactively.
 */

export type FuturesFill = {
  kind: "fill";
  /** `${symbol}-${tradeId}`: Binance trade ids are unique per symbol. */
  id: string;
  time: number;
  symbol: string;
  side: "BUY" | "SELL";
  positionSide: string;
  orderId: number;
  orderType: string;
  price: number;
  qty: number;
  commission: number;
  commissionAsset: string;
  realizedPnl: number;
  maker: boolean;
  reduceOnly: boolean;
  liquidation: boolean;
};

export type FuturesFunding = {
  kind: "funding";
  id: string;
  time: number;
  symbol: string | null;
  asset: string;
  amount: number;
};

export type FuturesLogRow = FuturesFill | FuturesFunding;

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Stream message → rows to record. Anything that isn't an execution or a
 *  funding payment (new orders, cancels, margin moves…) yields nothing. */
export function parseUserDataEvent(raw: unknown): FuturesLogRow[] {
  if (!raw || typeof raw !== "object") return [];
  const e = raw as Record<string, unknown>;

  if (e.e === "ORDER_TRADE_UPDATE" && e.o && typeof e.o === "object") {
    const o = e.o as Record<string, unknown>;
    // TRADE is a normal fill; CALCULATED is a liquidation fill.
    if (o.x !== "TRADE" && o.x !== "CALCULATED") return [];
    const symbol = typeof o.s === "string" ? o.s : null;
    const tradeId = num(o.t);
    const time = num(o.T) ?? num(e.T) ?? num(e.E);
    const price = num(o.L);
    const qty = num(o.l);
    if (!symbol || tradeId === null || time === null || price === null || qty === null || !(qty > 0)) return [];
    if (o.S !== "BUY" && o.S !== "SELL") return [];
    const clientId = typeof o.c === "string" ? o.c : "";
    return [
      {
        kind: "fill",
        id: `${symbol}-${tradeId}`,
        time,
        symbol,
        side: o.S,
        positionSide: typeof o.ps === "string" ? o.ps : "BOTH",
        orderId: num(o.i) ?? 0,
        orderType: typeof o.o === "string" ? o.o : "",
        price,
        qty,
        commission: num(o.n) ?? 0,
        commissionAsset: typeof o.N === "string" ? o.N : "",
        realizedPnl: num(o.rp) ?? 0,
        maker: o.m === true,
        reduceOnly: o.R === true,
        liquidation: o.x === "CALCULATED" || /^(autoclose-|adl_autoclose|settlement_autoclose)/.test(clientId),
      },
    ];
  }

  if (e.e === "ACCOUNT_UPDATE" && e.a && typeof e.a === "object") {
    const a = e.a as Record<string, unknown>;
    if (a.m !== "FUNDING_FEE" || !Array.isArray(a.B)) return [];
    const time = num(e.T) ?? num(e.E);
    if (time === null) return [];
    const symbol = typeof a.S === "string" && a.S ? a.S : null;
    const rows: FuturesLogRow[] = [];
    for (const b of a.B) {
      if (!b || typeof b !== "object") continue;
      const bal = b as Record<string, unknown>;
      const asset = typeof bal.a === "string" ? bal.a : null;
      const amount = num(bal.bc);
      if (!asset || amount === null || amount === 0) continue;
      rows.push({ kind: "funding", id: `${time}-${asset}-${symbol ?? "ALL"}`, time, symbol, asset, amount });
    }
    return rows;
  }
  return [];
}

const SYMBOL = /^[A-Z0-9]{2,24}$/;
const ASSET = /^[A-Z0-9]{2,12}$/;
const MIN_TIME = Date.UTC(2020, 0, 1);

/** Server-side check of a row sent by a browser. Anything off is refused. */
export function validateFuturesLogRow(raw: unknown, now = Date.now()): FuturesLogRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const n = (k: string) => (typeof r[k] === "number" && Number.isFinite(r[k]) ? (r[k] as number) : null);
  const time = n("time");
  const id = typeof r.id === "string" && r.id.length > 0 && r.id.length <= 80 ? r.id : null;
  if (!id || time === null || time < MIN_TIME || time > now + 86_400_000) return null;

  if (r.kind === "fill") {
    const symbol = typeof r.symbol === "string" && SYMBOL.test(r.symbol) ? r.symbol : null;
    const side = r.side === "BUY" || r.side === "SELL" ? r.side : null;
    const values = ["orderId", "price", "qty", "commission", "realizedPnl"].map(n);
    const text = (k: string, max: number) => (typeof r[k] === "string" && (r[k] as string).length <= max ? (r[k] as string) : null);
    const positionSide = text("positionSide", 8);
    const orderType = text("orderType", 32);
    const commissionAsset = r.commissionAsset === "" ? "" : typeof r.commissionAsset === "string" && ASSET.test(r.commissionAsset) ? r.commissionAsset : null;
    if (!symbol || !side || values.some((v) => v === null) || positionSide === null || orderType === null || commissionAsset === null) return null;
    if (typeof r.maker !== "boolean" || typeof r.reduceOnly !== "boolean" || typeof r.liquidation !== "boolean") return null;
    const [orderId, price, qty, commission, realizedPnl] = values as number[];
    if (!(price > 0) || !(qty > 0)) return null;
    return { kind: "fill", id, time, symbol, side, positionSide, orderId, orderType, price, qty, commission, commissionAsset, realizedPnl, maker: r.maker, reduceOnly: r.reduceOnly, liquidation: r.liquidation };
  }
  if (r.kind === "funding") {
    const symbol = r.symbol === null ? null : typeof r.symbol === "string" && SYMBOL.test(r.symbol) ? r.symbol : undefined;
    const asset = typeof r.asset === "string" && ASSET.test(r.asset) ? r.asset : null;
    const amount = n("amount");
    if (symbol === undefined || !asset || amount === null || amount === 0) return null;
    return { kind: "funding", id, time, symbol, asset, amount };
  }
  return null;
}

export const logKey = (row: Pick<FuturesLogRow, "kind" | "id">) => `${row.kind}:${row.id}`;

/** Union, one row per key (first source wins), oldest first. */
export function mergeFuturesLog(...sources: FuturesLogRow[][]): FuturesLogRow[] {
  const byKey = new Map<string, FuturesLogRow>();
  for (const source of sources) for (const row of source) if (!byKey.has(logKey(row))) byKey.set(logKey(row), row);
  return [...byKey.values()].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

/** Stablecoins that realised PnL and fees are counted in directly. Anything
 *  else (a fee paid in BNB, say) is reported on its own, never converted at a
 *  guessed price. */
const DOLLARS = new Set(["USDT", "USDC", "FDUSD", "BUSD"]);

export type FuturesLogGroup = { key: string; fills: number; closes: number; winners: number; realized: number; fees: number; funding: number; net: number };

export type FuturesLogSummary = {
  fills: number;
  /** Fills that realised profit or loss — the closing side of a trade. */
  closes: number;
  winners: number;
  winRate: number | null;
  profitFactor: number | null;
  realized: number;
  /** Fees paid in dollar stablecoins. */
  fees: number;
  funding: number;
  net: number;
  volume: number;
  liquidations: number;
  /** Fees in any other asset, by asset, not converted. */
  otherFees: Record<string, number>;
  bySymbol: FuturesLogGroup[];
  byMonth: FuturesLogGroup[];
};

function emptyGroup(key: string): FuturesLogGroup {
  return { key, fills: 0, closes: 0, winners: 0, realized: 0, fees: 0, funding: 0, net: 0 };
}

export function futuresLogSummary(rows: FuturesLogRow[], monthOf: (t: number) => string): FuturesLogSummary {
  let gain = 0;
  let loss = 0;
  const s: FuturesLogSummary = {
    fills: 0, closes: 0, winners: 0, winRate: null, profitFactor: null, realized: 0, fees: 0, funding: 0, net: 0,
    volume: 0, liquidations: 0, otherFees: {}, bySymbol: [], byMonth: [],
  };
  const bySymbol = new Map<string, FuturesLogGroup>();
  const byMonth = new Map<string, FuturesLogGroup>();
  const groups = (row: FuturesLogRow) => {
    const out: FuturesLogGroup[] = [];
    const symbolKey = row.symbol ?? "SIN PAR";
    if (!bySymbol.has(symbolKey)) bySymbol.set(symbolKey, emptyGroup(symbolKey));
    out.push(bySymbol.get(symbolKey)!);
    const m = monthOf(row.time);
    if (!byMonth.has(m)) byMonth.set(m, emptyGroup(m));
    out.push(byMonth.get(m)!);
    return out;
  };

  for (const row of rows) {
    const gs = groups(row);
    if (row.kind === "funding") {
      if (!DOLLARS.has(row.asset)) continue;
      s.funding += row.amount;
      for (const g of gs) g.funding += row.amount;
      continue;
    }
    s.fills += 1;
    s.volume += row.price * row.qty;
    if (row.liquidation) s.liquidations += 1;
    const dollarFee = DOLLARS.has(row.commissionAsset);
    if (dollarFee) s.fees += row.commission;
    else if (row.commission) s.otherFees[row.commissionAsset || "?"] = (s.otherFees[row.commissionAsset || "?"] ?? 0) + row.commission;
    const closes = row.realizedPnl !== 0;
    if (closes) {
      s.closes += 1;
      s.realized += row.realizedPnl;
      if (row.realizedPnl > 0) {
        s.winners += 1;
        gain += row.realizedPnl;
      } else loss -= row.realizedPnl;
    }
    for (const g of gs) {
      g.fills += 1;
      if (dollarFee) g.fees += row.commission;
      if (closes) {
        g.closes += 1;
        g.realized += row.realizedPnl;
        if (row.realizedPnl > 0) g.winners += 1;
      }
    }
  }
  s.winRate = s.closes ? s.winners / s.closes : null;
  s.profitFactor = loss > 0 ? gain / loss : gain > 0 ? Infinity : null;
  s.net = s.realized - s.fees + s.funding;
  const finish = (map: Map<string, FuturesLogGroup>) =>
    [...map.values()].map((g) => ({ ...g, net: g.realized - g.fees + g.funding }));
  s.bySymbol = finish(bySymbol).sort((a, b) => b.fills - a.fills || a.key.localeCompare(b.key));
  s.byMonth = finish(byMonth).sort((a, b) => b.key.localeCompare(a.key));
  return s;
}

/** CSV for a Spanish-locale spreadsheet: semicolons, decimal comma, BOM. */
export function futuresLogCsv(rows: FuturesLogRow[], formatTime: (t: number) => string): string {
  const n = (v: number) => (Number.isFinite(v) ? String(Number(v.toFixed(8))).replace(".", ",") : "");
  const text = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const header = [
    "Fecha", "Tipo", "Par", "Lado", "Lado de posición", "Tipo de orden", "Precio", "Cantidad", "Monto", "Comisión",
    "Activo comisión", "PnL realizado", "Funding", "Activo funding", "Maker", "Liquidación", "ID operación", "ID orden",
  ];
  const lines = rows.map((r) =>
    r.kind === "fill"
      ? [
          text(formatTime(r.time)), "Ejecución", text(r.symbol), r.side === "BUY" ? "COMPRA" : "VENTA", text(r.positionSide),
          text(r.orderType), n(r.price), n(r.qty), n(r.price * r.qty), n(r.commission), text(r.commissionAsset),
          n(r.realizedPnl), "", "", r.maker ? "Sí" : "No", r.liquidation ? "Sí" : "No", text(r.id), String(r.orderId),
        ].join(";")
      : [
          text(formatTime(r.time)), "Funding", text(r.symbol ?? ""), "", "", "", "", "", "", "", "", "", n(r.amount),
          text(r.asset), "", "", text(r.id), "",
        ].join(";"),
  );
  return `\uFEFF${[header.join(";"), ...lines].join("\r\n")}\r\n`;
}
