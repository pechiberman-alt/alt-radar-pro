import assert from "node:assert/strict";
import test from "node:test";
import { historyOf, lastBacktest, runBacktestFor, type BacktestProgress } from "../lib/jarvis-backtest-run.ts";

const H = 3_600_000;
const FRAME: Record<string, number> = { "1h": H, "4h": 4 * H, "1d": 24 * H };
const price = (t: number) => 100 * Math.exp((0.0004 * t) / H / 10) * (1 + 0.03 * Math.sin(t / H / 37) + 0.01 * Math.sin(t / H / 5.3));

/** Binance-like klines between startTime and endTime (inclusive), at most `limit`, from `since` on. */
function serve(url: string, since = 0): unknown[] {
  const q = new URL(url).searchParams;
  const frame = FRAME[q.get("interval")!];
  const start = Math.max(Number(q.get("startTime")), since);
  const end = Math.min(Number(q.get("endTime")), Date.now());
  const rows: unknown[] = [];
  for (let t = Math.ceil(start / frame) * frame; t <= end && rows.length < Number(q.get("limit")); t += frame) {
    const o = price(t);
    const c = price(t + frame);
    rows.push([t, String(o), String(Math.max(o, c) * 1.003), String(Math.min(o, c) * 0.997), String(c), "100", t + frame - 1, String(100 * c), 10, "50", String(50 * c), "0"]);
  }
  return rows;
}

function stub(opts: { futuresDown?: boolean; since?: number } = {}) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (opts.futuresDown && url.includes("/fapi/")) return new Response("", { status: 500 });
    if (url.includes("/klines")) return new Response(JSON.stringify(serve(url, opts.since)));
    return new Response("", { status: 404 });
  }) as typeof fetch;
  return calls;
}

test("history comes in pages of 1000, contiguous and without repeats", async () => {
  const calls = stub();
  const end = Math.floor(Date.now() / H) * H - 10 * H;
  const start = end - 2500 * H;
  const got = (await historyOf("SOLUSDT", "1h", start, end, new AbortController().signal))!;
  assert.equal(got.venue, "Binance Futures");
  assert.equal(got.candles.length, 2501);
  assert.equal(calls.length, 3);
  for (let i = 1; i < got.candles.length; i += 1) assert.equal(got.candles[i].openTime - got.candles[i - 1].openTime, H);
});

test("when futures does not answer, spot does, and the source says so", async () => {
  stub({ futuresDown: true });
  const end = Math.floor(Date.now() / H) * H;
  const got = (await historyOf("SOLUSDT", "4h", end - 100 * 4 * H, end, new AbortController().signal))!;
  assert.equal(got.venue, "Binance Spot");
});

test("a backtest from the phone: only closed candles, progress to the end, and the result kept for the chat", async () => {
  stub();
  const seen: BacktestProgress[] = [];
  const r = await runBacktestFor("sol", 30, (p) => seen.push(p));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.result.symbol, "SOLUSDT");
  assert.equal(r.result.dias, 30);
  assert.equal(r.nota, null);
  const now = Date.now();
  assert.ok(r.result.trades.every((t) => t.abiertaA <= now));
  assert.equal(seen[0].fase, "datos");
  const lastStep = seen.at(-1)!;
  assert.equal(lastStep.fase, "mesa");
  assert.ok(lastStep.hechos <= lastStep.total);
  assert.equal(lastBacktest(), r.result);
  assert.match(r.result.limitaciones.join(" "), /no garantizan rentabilidad futura/);
});

test("a young coin: the window starts once the desk has enough candles, and it says so", async () => {
  stub({ since: Date.now() - 1500 * H });
  const r = await runBacktestFor("NEWUSDT", 90);
  assert.ok(r.ok);
  if (r.ok) {
    assert.match(r.nota ?? "", /tiene menos historia/);
    assert.ok(r.result.desde > Date.now() - 90 * 24 * H);
  }
});

test("no history is said, and a cancelled run stops", async () => {
  globalThis.fetch = (async () => new Response("", { status: 500 })) as typeof fetch;
  const none = await runBacktestFor("SOL", 30);
  assert.equal(none.ok, false);
  if (!none.ok) assert.match(none.error, /no está disponible actualmente/);
  stub();
  const ac = new AbortController();
  const running = runBacktestFor("SOL", 180, (p) => {
    if (p.fase === "mesa" && p.hechos > 10) ac.abort();
  }, ac.signal);
  const out = await running;
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.error, "Backtest cancelado.");
});
