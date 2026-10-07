import { fetchKlinesServer, FUTURES_BASES_SERVER, GLOBAL_BASES, isOutside, marketOf, VENUE_LABEL, type Venue } from "./klines-server.ts";
import {
  ALERT_USAGE, createdMessage, directionFor, firstTouch, listMessage, LOOKBACK_MINUTES, MAX_ALERTS_PER_USER, parseAlertArgs, parseTarget,
  triggeredMessage, type AlertDirection, type PriceAlert,
} from "./price-alerts.ts";
import { parsePrefs, sendMessage } from "./telegram.ts";

/**
 * Storage, commands and the 5-minute check for Telegram price alerts.
 *
 * Reads are small by design (D1's free tier caps rows read per day): one
 * query per run for every alert (at most ten per person), nothing when nobody
 * has one, and one candle request per coin that has an alert.
 */

export const PRICE_ALERTS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS telegram_price_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    target REAL NOT NULL,
    direction TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    created_price REAL NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS telegram_price_alerts_user_idx ON telegram_price_alerts (user_id)",
];
/** Coins checked per run, so a long list can't exhaust the Worker's request budget. */
const MAX_SYMBOLS_PER_RUN = 15;

export async function ensurePriceAlertsSchema(db: D1Database) {
  for (const sql of PRICE_ALERTS_SCHEMA) await db.prepare(sql).run();
}

type Row = { id: number; user_id: number; symbol: string; target: number; direction: string; created_at: number; created_price: number };
const toAlert = (r: Row): PriceAlert => ({
  id: r.id, symbol: r.symbol, target: r.target, direction: r.direction as AlertDirection, createdAt: r.created_at, createdPrice: r.created_price,
});

export async function listUserAlerts(db: D1Database, userId: number): Promise<PriceAlert[]> {
  const rows = (await db.prepare("SELECT * FROM telegram_price_alerts WHERE user_id = ?1 ORDER BY id").bind(userId).all<Row>()).results;
  return rows.map(toAlert);
}

/** Current price (spot, or futures for the metals); null when Binance says the pair doesn't exist. Throws when Binance can't be reached. */
export async function fetchSpotPrice(symbol: string): Promise<number | null> {
  const futures = marketOf(symbol) === "futures";
  let lastError: unknown;
  for (const base of futures ? FUTURES_BASES_SERVER : GLOBAL_BASES) {
    try {
      const r = await globalThis.fetch(`${base}${futures ? "/fapi/v1" : "/api/v3"}/ticker/price?symbol=${encodeURIComponent(symbol)}`, { signal: AbortSignal.timeout(6_000) });
      if (r.status === 400) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const price = Number(((await r.json()) as { price?: string }).price);
      if (price > 0) return price;
      throw new Error("SIN PRECIO");
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("SIN DATOS");
}

async function spotPrices(symbols: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await Promise.all(
    [...new Set(symbols)].map(async (s) => {
      try {
        const p = await fetchSpotPrice(s);
        if (p) out[s] = p;
      } catch {
        // listed without a price rather than not listed
      }
    }),
  );
  return out;
}

/** /alerta, /alertas and /borrar. Always answers the chat. */
export async function handleAlertCommand(
  db: D1Database, token: string, chat: string, userId: number, cmd: "alerta" | "alertas" | "borrar", arg: string, now = Date.now(),
): Promise<void> {
  await ensurePriceAlertsSchema(db);
  const reply = (text: string) => sendMessage(token, chat, text);

  if (cmd === "alertas") {
    const alerts = await listUserAlerts(db, userId);
    await reply(listMessage(alerts, await spotPrices(alerts.map((a) => a.symbol))));
    return;
  }

  if (cmd === "borrar") {
    const alerts = await listUserAlerts(db, userId);
    const what = arg.trim().toLowerCase();
    if (what === "todas" || what === "todo") {
      await db.prepare("DELETE FROM telegram_price_alerts WHERE user_id = ?1").bind(userId).run();
      await reply(alerts.length ? `Listo, borré tus ${alerts.length} alertas de precio.` : "No tenías alertas de precio.");
      return;
    }
    const n = Number(what);
    const target = Number.isInteger(n) && n >= 1 ? alerts[n - 1] : undefined;
    if (!target) {
      await reply(alerts.length ? `Decime cuál: un número del 1 al ${alerts.length} (los ves con /alertas), o /borrar todas.` : "No tenés alertas de precio.");
      return;
    }
    await db.prepare("DELETE FROM telegram_price_alerts WHERE id = ?1 AND user_id = ?2").bind(target.id, userId).run();
    await reply(`Borrada: ${target.symbol.replace(/USDT$/, "")} ${target.direction === "ARRIBA" ? "↑" : "↓"} ${target.target}.`);
    return;
  }

  // /alerta
  const args = parseAlertArgs(arg);
  if (!args) {
    await reply(ALERT_USAGE);
    return;
  }
  let price: number | null;
  try {
    price = await fetchSpotPrice(args.symbol);
  } catch {
    await reply("No pude leer el precio en Binance ahora. Probá de nuevo en un rato.");
    return;
  }
  if (price === null) {
    await reply(`No encontré ${args.symbol} en Binance. Probá con el nombre de la moneda (ej: /alerta SOL 120, /alerta XAU 4200).`);
    return;
  }
  const level = parseTarget(args.target, price);
  if (level === null) {
    await reply(`No entendí el precio «${args.target}». Escribilo como 90000, 90.000 o 1,495.`);
    return;
  }
  const direction = directionFor(level, price);
  if (!direction) {
    await reply("Ese precio es prácticamente el de ahora: elegí un nivel más lejos.");
    return;
  }
  const existing = await listUserAlerts(db, userId);
  if (existing.length >= MAX_ALERTS_PER_USER) {
    await reply(`Ya tenés ${MAX_ALERTS_PER_USER} alertas, el máximo. Borrá alguna con /borrar N.`);
    return;
  }
  await db
    .prepare("INSERT INTO telegram_price_alerts (user_id, symbol, target, direction, created_at, created_price) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
    .bind(userId, args.symbol, level, direction, now, price)
    .run();
  await reply(createdMessage({ symbol: args.symbol, target: level, direction }, price));
}

/** Runs from the 5-minute cron: fires every alert whose level was touched since it was created. */
export async function runPriceAlerts(db: D1Database, token: string, now = Date.now()): Promise<{ alerts: number; fired: number }> {
  await ensurePriceAlertsSchema(db);
  const rows = (
    await db
      .prepare(
        `SELECT a.*, l.chat_id, l.prefs FROM telegram_price_alerts a
           JOIN telegram_links l ON l.user_id = a.user_id`,
      )
      .all<Row & { chat_id: string; prefs: string }>()
  ).results;
  if (!rows.length) return { alerts: 0, fired: 0 };

  const bySymbol = new Map<string, typeof rows>();
  for (const r of rows) (bySymbol.get(r.symbol) ?? bySymbol.set(r.symbol, []).get(r.symbol)!).push(r);

  let fired = 0;
  for (const [symbol, list] of [...bySymbol.entries()].slice(0, MAX_SYMBOLS_PER_RUN)) {
    const oldest = Math.min(...list.map((r) => r.created_at));
    const start = Math.floor(Math.max(oldest, now - LOOKBACK_MINUTES * 60_000) / 60_000) * 60_000;
    let candles;
    let venue: Venue;
    try {
      // Never a thin exchange (its wicks are not the market's). When Binance's
      // firewall refuses the cron, Kraken or Coinbase in dollars — deep markets
      // whose price differs from Binance's by hundredths of a percent — and
      // the message says so; otherwise the alert would never fire.
      ({ candles, venue } = await fetchKlinesServer(symbol, "1m", { limit: LOOKBACK_MINUTES + 5, startTime: start, allowThin: false, outside: true }));
    } catch {
      continue; // retried on the next run
    }
    const last = candles.at(-1)?.close ?? null;
    for (const r of list) {
      const alert = toAlert(r);
      const touched = firstTouch(alert, candles);
      if (touched === null) continue;
      let tz = 180;
      try {
        tz = parsePrefs(JSON.parse(r.prefs)).tzOffsetMin;
      } catch {
        // default: Argentina
      }
      const sent = await sendMessage(token, r.chat_id, triggeredMessage(alert, touched, last, tz, isOutside(venue) ? VENUE_LABEL[venue] : null));
      // Deleted only once the person was told; a failed send is retried next run.
      if (sent.ok) {
        await db.prepare("DELETE FROM telegram_price_alerts WHERE id = ?1").bind(alert.id).run();
        fired += 1;
      }
    }
  }
  return { alerts: rows.length, fired };
}
