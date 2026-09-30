import assert from "node:assert/strict";
import test from "node:test";
import { handleAlertCommand, listUserAlerts, runPriceAlerts } from "../lib/price-alerts-server.ts";
import { TELEGRAM_SCHEMA } from "../lib/telegram.ts";

const sqlite = await import("node:sqlite").catch(() => null);

function makeDb() {
  const sql = new sqlite!.DatabaseSync(":memory:");
  const stmt = (q: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(q, a),
    run: async () => ({ meta: { changes: Number(sql.prepare(q).run(...(args as never[])).changes) } }),
    first: async () => sql.prepare(q).get(...(args as never[])) ?? null,
    all: async () => ({ results: sql.prepare(q).all(...(args as never[])) }),
  });
  return { prepare: (q: string) => stmt(q), batch: async (l: { run: () => Promise<unknown> }[]) => Promise.all(l.map((s) => s.run())) } as never as D1Database;
}

const M = 60_000;
const NOW = 1_000_000 * M;
type World = { prices: Record<string, number>; candles: Record<string, [number, number, number][]>; sent: { chat: string; text: string }[]; failSend?: boolean };

/** Binance and Telegram, simulated. candles: [minuteOffsetFromNow, high, low]. */
function mockFetch(w: World) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    if (u.hostname === "api.telegram.org") {
      const body = JSON.parse(String(init?.body));
      if (w.failSend) return new Response(JSON.stringify({ ok: false, description: "network" }), { status: 500 });
      w.sent.push({ chat: body.chat_id, text: body.text });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    const symbol = u.searchParams.get("symbol")!;
    if (u.pathname.endsWith("/ticker/price")) {
      return symbol in w.prices ? new Response(JSON.stringify({ symbol, price: String(w.prices[symbol]) })) : new Response('{"code":-1121}', { status: 400 });
    }
    if (u.pathname.endsWith("/klines")) {
      const start = Number(u.searchParams.get("startTime"));
      const rows = (w.candles[symbol] ?? []).map(([off, h, l]) => {
        const t = NOW + off * M;
        return [t, "0", String(h), String(l), String((h + l) / 2), "1", t + M - 1, "1", 1, "0", "0", "0"];
      }).filter((r) => (r[0] as number) >= start);
      return new Response(JSON.stringify(rows));
    }
    return new Response("?", { status: 404 });
  }) as typeof fetch;
  return () => { globalThis.fetch = real; };
}

async function setup() {
  const db = makeDb();
  for (const s of TELEGRAM_SCHEMA) await db.prepare(s).run();
  await db.prepare("INSERT INTO telegram_links (user_id, chat_id, prefs, linked_at) VALUES (1, 'c1', '{\"tzOffsetMin\":180}', 'x')").run();
  return db;
}

test("create: reads the price, settles the number, infers the direction, confirms", { skip: !sqlite }, async () => {
  const db = await setup();
  const w: World = { prices: { BTCUSDT: 85_000, XRPUSDT: 1.51 }, candles: {}, sent: [] };
  const restore = mockFetch(w);
  try {
    await handleAlertCommand(db, "T", "c1", 1, "alerta", "btc 90.000", NOW);
    await handleAlertCommand(db, "T", "c1", 1, "alerta", "xrp 1,495", NOW);
    const alerts = await listUserAlerts(db, 1);
    assert.deepEqual(alerts.map((a) => [a.symbol, a.target, a.direction, a.createdPrice]), [["BTCUSDT", 90_000, "ARRIBA", 85_000], ["XRPUSDT", 1.495, "ABAJO", 1.51]]);
    assert.match(w.sent[0].text, /Alerta creada: BTC ↑ 90\.000/);
    assert.match(w.sent[1].text, /XRP ↓ 1,495/);
  } finally { restore(); }
});

test("create: refuses what it can't honour, with a reason, and stores nothing", { skip: !sqlite }, async () => {
  const db = await setup();
  const w: World = { prices: { BTCUSDT: 85_000 }, candles: {}, sent: [] };
  const restore = mockFetch(w);
  try {
    await handleAlertCommand(db, "T", "c1", 1, "alerta", "", NOW);
    await handleAlertCommand(db, "T", "c1", 1, "alerta", "nocoin 5", NOW);
    await handleAlertCommand(db, "T", "c1", 1, "alerta", "btc abc", NOW);
    await handleAlertCommand(db, "T", "c1", 1, "alerta", "btc 85010", NOW);
    assert.equal((await listUserAlerts(db, 1)).length, 0);
    assert.match(w.sent[0].text, /Alertas de precio/);
    assert.match(w.sent[1].text, /No encontré NOCOINUSDT/);
    assert.match(w.sent[2].text, /No entendí el precio/);
    assert.match(w.sent[3].text, /prácticamente el de ahora/);
  } finally { restore(); }
});

test("create: at most ten per person", { skip: !sqlite }, async () => {
  const db = await setup();
  const w: World = { prices: { BTCUSDT: 85_000 }, candles: {}, sent: [] };
  const restore = mockFetch(w);
  try {
    for (let i = 0; i < 11; i += 1) await handleAlertCommand(db, "T", "c1", 1, "alerta", `btc ${90_000 + i * 100}`, NOW);
    assert.equal((await listUserAlerts(db, 1)).length, 10);
    assert.match(w.sent.at(-1)!.text, /el máximo/);
  } finally { restore(); }
});

test("list and delete: by position, all, and a clear answer for a wrong number", { skip: !sqlite }, async () => {
  const db = await setup();
  const w: World = { prices: { BTCUSDT: 85_000, SOLUSDT: 120 }, candles: {}, sent: [] };
  const restore = mockFetch(w);
  try {
    await handleAlertCommand(db, "T", "c1", 1, "alerta", "btc 90000", NOW);
    await handleAlertCommand(db, "T", "c1", 1, "alerta", "sol 110", NOW);
    await handleAlertCommand(db, "T", "c1", 1, "alertas", "", NOW);
    assert.match(w.sent.at(-1)!.text, /1\. <b>BTC ↑ 90\.000<\/b> · ahora 85\.000[\s\S]*2\. <b>SOL ↓ 110<\/b>/);
    await handleAlertCommand(db, "T", "c1", 1, "borrar", "7", NOW);
    assert.match(w.sent.at(-1)!.text, /del 1 al 2/);
    await handleAlertCommand(db, "T", "c1", 1, "borrar", "1", NOW);
    assert.deepEqual((await listUserAlerts(db, 1)).map((a) => a.symbol), ["SOLUSDT"]);
    await handleAlertCommand(db, "T", "c1", 1, "borrar", "todas", NOW);
    assert.equal((await listUserAlerts(db, 1)).length, 0);
  } finally { restore(); }
});

test("the 5-minute check fires on a wick, only once, in the person's time, and leaves the rest", { skip: !sqlite }, async () => {
  const db = await setup();
  const w: World = { prices: { BTCUSDT: 85_000, SOLUSDT: 120 }, candles: {}, sent: [] };
  const restore = mockFetch(w);
  try {
    await handleAlertCommand(db, "T", "c1", 1, "alerta", "btc 90000", NOW - 30 * M);
    await handleAlertCommand(db, "T", "c1", 1, "alerta", "sol 100", NOW - 30 * M);
    w.sent.length = 0;
    // BTC wicks to 90.100 at minute -10 and comes back; SOL never reaches 100.
    w.candles = { BTCUSDT: [[-31, 95_000, 84_000], [-20, 86_000, 85_000], [-10, 90_100, 86_000], [-1, 88_000, 87_000]], SOLUSDT: [[-5, 121, 105]] };
    assert.deepEqual(await runPriceAlerts(db, "T", NOW), { alerts: 2, fired: 1 });
    assert.equal(w.sent.length, 1);
    assert.match(w.sent[0].text, /BTC llegó a 90\.000<\/b> subiendo/);
    assert.match(w.sent[0].text, new RegExp(`a las ${new Date(NOW - 10 * M - 180 * M).toISOString().slice(11, 16)}`));
    assert.doesNotMatch(w.sent[0].text, /95\.000/, "the candle from before the alert (95.000) never counts");
    assert.deepEqual((await listUserAlerts(db, 1)).map((a) => a.symbol), ["SOLUSDT"]);
    assert.deepEqual(await runPriceAlerts(db, "T", NOW + 5 * M), { alerts: 1, fired: 0 }, "not sent twice");
  } finally { restore(); }
});

test("a failed send keeps the alert for the next run; no alerts means no candle requests", { skip: !sqlite }, async () => {
  const db = await setup();
  const w: World = { prices: { BTCUSDT: 85_000 }, candles: { BTCUSDT: [[-1, 91_000, 85_000]] }, sent: [] };
  const restore = mockFetch(w);
  try {
    assert.deepEqual(await runPriceAlerts(db, "T", NOW), { alerts: 0, fired: 0 });
    await handleAlertCommand(db, "T", "c1", 1, "alerta", "btc 90000", NOW - 5 * M);
    w.failSend = true;
    assert.deepEqual(await runPriceAlerts(db, "T", NOW), { alerts: 1, fired: 0 });
    assert.equal((await listUserAlerts(db, 1)).length, 1);
    w.failSend = false;
    assert.deepEqual(await runPriceAlerts(db, "T", NOW + 5 * M), { alerts: 1, fired: 1 });
  } finally { restore(); }
});

test("alerts of someone who unlinked Telegram are not checked", { skip: !sqlite }, async () => {
  const db = await setup();
  const w: World = { prices: { BTCUSDT: 85_000 }, candles: { BTCUSDT: [[-1, 91_000, 85_000]] }, sent: [] };
  const restore = mockFetch(w);
  try {
    await handleAlertCommand(db, "T", "c1", 1, "alerta", "btc 90000", NOW - 5 * M);
    await db.prepare("DELETE FROM telegram_links WHERE user_id = 1").run();
    assert.deepEqual(await runPriceAlerts(db, "T", NOW), { alerts: 0, fired: 0 });
  } finally { restore(); }
});
