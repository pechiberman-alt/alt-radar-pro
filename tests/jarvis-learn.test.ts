import assert from "node:assert/strict";
import test from "node:test";
import {
  addCase,
  btcSeries,
  compactModel,
  D,
  emptyModel,
  emptyRidge,
  encode,
  explain,
  fit,
  gradeOf,
  learnSpeech,
  lessons,
  parseModel,
  powerOf,
  predict,
  regimeAt,
  replayRompe,
  sessionOf,
  summarizeModel,
  venuesSpeech,
  volRegime,
  type Features,
} from "../lib/jarvis-learn.ts";
import { HORIZON } from "../lib/jarvis-ledger.ts";
import { setupAt } from "./helpers/setups.ts";

const H = 3_600_000;


const F = (o: Partial<Features> = {}): Features => ({ side: "LONG", btc: "SUBE", vol: "NORMAL", sess: "EEUU", power: "MEDIA", coin: "ALT", ...o });

/** A small deterministic pseudo-random generator so the tests never flake. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test("encoding: one column per non-baseline value, 'with BTC' derived from side and regime", () => {
  assert.equal(encode(F()).length, D);
  assert.deepEqual(encode(F()).slice(0, 4), [1, 1, 1, 0], "long with BTC rising = in favour");
  assert.deepEqual(encode(F({ side: "SHORT" })).slice(0, 4), [1, 0, 0, 1], "short with BTC rising = against");
  assert.deepEqual(encode(F({ btc: "LATERAL" })).slice(2, 4), [0, 0], "BTC sideways: neither");
});

test("the regression recovers real effects, and says 'no sé' with little data", () => {
  const r = emptyRidge();
  const rand = rng(7);
  const sides: Features["side"][] = ["LONG", "SHORT"];
  const regimes: Features["btc"][] = ["SUBE", "BAJA", "LATERAL"];
  for (let i = 0; i < 3000; i++) {
    const f = F({ side: sides[i % 2], btc: regimes[i % 3], sess: (["ASIA", "EUROPA", "EEUU", "CIERRE"] as const)[i % 4] });
    const x = encode(f);
    // True model: +0,40R with BTC in favour, −0,40R against, nothing else; noise of ±1R.
    const y = 0.4 * x[2] - 0.4 * x[3] + (rand() * 2 - 1);
    addCase(r, x, y);
  }
  const pro = predict(r, F());
  const contra = predict(r, F({ side: "SHORT" }));
  assert.ok(Math.abs(pro.e - 0.4) < 0.12, `with BTC: ${pro.e}`);
  assert.ok(Math.abs(contra.e + 0.4) < 0.12, `against BTC: ${contra.e}`);
  assert.ok(pro.se < 0.1, "3000 cases: tight");
  assert.equal(gradeOf(pro), "FAVORABLE");
  assert.equal(gradeOf(contra), "DESFAVORABLE");
  assert.ok(Math.abs(predict(r, F({ btc: "LATERAL" })).e) < 0.12, "BTC sideways: close to no effect");
  const ex = explain(r, F({ side: "SHORT" }), "ROMPE");
  assert.equal(ex[0].label, "Con BTC en contra");
  assert.ok(ex[0].r < -0.25);

  const few = emptyRidge();
  for (let i = 0; i < 10; i++) addCase(few, encode(F()), 2);
  const p = predict(few, F());
  assert.equal(gradeOf(p), "APRENDIENDO", "10 wins in a row is not a lesson");
  assert.ok(p.e < 2 * 0.8, "the penalty pulls a tiny sample towards no edge");
});

test("incremental sums equal the batch, whatever the order", () => {
  const a = emptyRidge();
  const b = emptyRidge();
  const cases = Array.from({ length: 50 }, (_, i) => ({ x: encode(F({ side: i % 2 ? "LONG" : "SHORT", vol: i % 3 ? "ALTA" : "BAJA" })), y: (i % 7) / 3 - 1 }));
  cases.forEach((c) => addCase(a, c.x, c.y));
  [...cases].reverse().forEach((c) => addCase(b, c.x, c.y));
  assert.deepEqual(fit(a).beta.map((v) => v.toFixed(9)), fit(b).beta.map((v) => v.toFixed(9)));
});

test("lessons: only effects the data supports, quoted as plain averages", () => {
  const r = emptyRidge();
  const rand = rng(3);
  for (let i = 0; i < 1200; i++) {
    const f = F({ side: i % 2 ? "LONG" : "SHORT", btc: (["SUBE", "BAJA", "LATERAL"] as const)[i % 3] });
    const x = encode(f);
    addCase(r, x, 0.5 * x[2] - 0.5 * x[3] + (rand() * 2 - 1));
  }
  const ls = lessons("ROMPE", r).map((l) => l.text);
  assert.match(ls[0], /^Rupturas en general: [+−]0,\d\dR por señal en 1\.200 casos\.$/);
  assert.ok(ls.some((t) => /^Con BTC a favor: \+0,\d\dR por señal en 400 casos, contra [+−]0,\d\dR del resto\.$/.test(t)), ls.join(" | "));
  assert.ok(ls.some((t) => /^Con BTC en contra: −0,\d\dR por señal en 400 casos/.test(t)));
  assert.ok(!ls.some((t) => /horario|volatilidad/.test(t)), "noise is not reported as a lesson");

  const noise = emptyRidge();
  for (let i = 0; i < 600; i++) addCase(noise, encode(F({ side: i % 2 ? "LONG" : "SHORT" })), rand() * 2 - 1);
  assert.match(lessons("ROMPE", noise).map((l) => l.text).join(" "), /Todavía no encontré ninguna condición/);
  assert.match(lessons("IMÁN", emptyRidge())[0].text, /^Barridas de imán: llevo 0 casos, todavía pocos/);
});

test("context: BTC regime from its own past, volatility, session, strength", () => {
  const c = Array.from({ length: 60 }, (_, i) => ({ openTime: i * H, open: 100, high: 101, low: 99, close: i < 30 ? 100 : 100 + (i - 29) * 0.1, volume: 1, quoteVolume: 1 }));
  const s = btcSeries(c, H)!;
  assert.equal(regimeAt(s, 10 * H), null, "first 24 candles: unknown");
  assert.equal(regimeAt(s, 35 * H), "LATERAL", "+0,6% in 24 candles: sideways");
  assert.equal(regimeAt(s, 40 * H), "SUBE", "+1,1%: rising");
  assert.equal(regimeAt(s, 59 * H), "SUBE");
  assert.equal(regimeAt(s, 60 * H), null, "beyond the series: unknown, not guessed");
  assert.equal(s.last, "SUBE");
  const calm = Array.from({ length: 150 }, (_, i) => ({ openTime: i * H, open: 100, high: i > 135 ? 110 : 101, low: i > 135 ? 90 : 99, close: 100, volume: 1, quoteVolume: 1 }));
  assert.equal(volRegime(calm, 149), "ALTA");
  assert.equal(volRegime(calm, 130), "NORMAL");
  assert.equal(sessionOf(Date.UTC(2026, 0, 1, 3)), "ASIA");
  assert.equal(sessionOf(Date.UTC(2026, 0, 1, 15)), "EEUU");
  assert.equal(powerOf("ROMPE", 84), "ALTA");
  assert.equal(powerOf("IMÁN", 96), "MAXIMA");
});

test("history walk: no lookahead — what happens after a candle never changes the decision at it", () => {
  const up = setupAt(400, 300);
  const down = setupAt(400, 300, (j) => 109.95 - (j - 300) * 0.5);
  const btc = btcSeries(up, H);
  const a = replayRompe("TRIUSDT", up, null, btc, H, 1000);
  const b = replayRompe("TRIUSDT", down, null, btcSeries(down, H), H, 1000);
  assert.ok(a.cases.length >= 1, "the setup is found");
  assert.equal(a.cases[0].time, b.cases[0].time, "same candle, whatever came after");
  assert.deepEqual(a.cases[0].features, b.cases[0].features, "same context");
  assert.ok(a.cases[0].r > 1.5 && b.cases[0].r < -0.9, "only the result differs");
  assert.equal(a.cursor.last, (400 - 1 - HORIZON) * H, "candles without 48 after them are not studied yet");
  assert.equal(a.backlog, 0);
});

test("history walk: exactly once, in steps, and waits for BTC instead of guessing", () => {
  const c = setupAt(400, 300);
  const btc = btcSeries(c, H);
  const whole = replayRompe("TRIUSDT", c, null, btc, H, 10_000);
  let cursor = null;
  const times: number[] = [];
  let steps = 0;
  for (;;) {
    const r = replayRompe("TRIUSDT", c, cursor, btc, H, 7);
    times.push(...r.cases.map((x) => x.time));
    cursor = r.cursor;
    steps += 1;
    if (!r.studied || steps > 200) break;
  }
  assert.deepEqual(times, whole.cases.map((x) => x.time), "steps add up to the whole, nothing repeated");
  const after = replayRompe("TRIUSDT", c, cursor, btc, H, 7);
  assert.equal(after.cases.length, 0);
  assert.equal(after.studied, 0, "already studied: nothing to do");
  // BTC's series ends before the coin's: stop at the gap, don't skip it.
  const shortBtc = btcSeries(c.slice(0, 250), H);
  const r = replayRompe("TRIUSDT", c, null, shortBtc, H, 1000);
  assert.equal(r.waitingForBtc, true);
  assert.ok(r.cursor.last < 250 * H);
  assert.equal(replayRompe("TRIUSDT", c, null, null, H, 1000).waitingForBtc, true, "no BTC at all: waits");
});

test("stored model: compact, parsed back, damaged or old data starts clean", () => {
  const m = emptyModel();
  addCase(m.ridge.ROMPE, encode(F()), 1 / 3);
  const back = parseModel(JSON.stringify(compactModel(m)));
  assert.equal(back.ridge.ROMPE.n, 1);
  assert.equal(back.ridge.ROMPE.xy[0], 0.333333);
  assert.equal(parseModel("{nope").ridge.ROMPE.n, 0);
  assert.equal(parseModel(JSON.stringify({ v: 1, ridge: { ROMPE: { n: 1, xx: [1], xy: [], yy: 0 } } })).ridge.ROMPE.n, 0, "wrong shape: start over");
});

test("summary and speech: how much it studied, what is left, what it learned", () => {
  const m = emptyModel();
  const rand = rng(11);
  for (let i = 0; i < 400; i++) {
    const x = encode(F({ side: i % 2 ? "LONG" : "SHORT", btc: (["SUBE", "BAJA", "LATERAL"] as const)[i % 3] }));
    addCase(m.ridge.ROMPE, x, 0.6 * x[2] - 0.6 * x[3] + rand() - 0.5);
  }
  m.historyCases = 400;
  // The magnets model stays empty: nothing should be said about it.
  m.cursors = { BTCUSDT: { last: 1, busyUntil: 0 }, ETHUSDT: { last: 1, busyUntil: 0 } };
  m.backlog = { BTCUSDT: 120, ETHUSDT: 30 };
  const s = summarizeModel(m);
  assert.equal(s.backlog, 150);
  assert.equal(s.coins, 2);
  assert.ok(s.sources.ROMPE.base && Math.abs(s.sources.ROMPE.base.e) < 0.2);
  assert.equal(s.sources["IMÁN"].base, null);
  const say = learnSpeech(s);
  assert.match(say, /^Estudié 400 situaciones de la historia de 2 monedas\. Me quedan 150 velas por estudiar; sigo aprendiendo cada minuto\. Rupturas en general/);
  assert.match(say, /Con BTC (a favor|en contra)/);
  assert.doesNotMatch(say, /Barridas de imán: llevo 0/, "nothing to say about magnets yet: silence, not noise");
});

test("where the lessons come from: said when not Binance, counted per exchange, old models start at zero", () => {
  assert.equal(venuesSpeech({}), null);
  assert.equal(venuesSpeech({ BINANCE_FUTURES: 300, BINANCE: 20 }), null, "Binance's own candles: nothing to explain");
  assert.equal(venuesSpeech({ KRAKEN: 640 }), "Las estudié con velas de Kraken en dólares, porque Binance no deja leer al servidor.");
  assert.equal(
    venuesSpeech({ BINANCE_FUTURES: 300, KRAKEN: 1200, COINBASE: 0 }),
    "De esas, 1.200 salen de velas de Kraken en dólares y 300 de Binance: cuando Binance no deja leer al servidor, uso otra fuente.",
  );
  const old = { ...emptyModel(), historyCases: 3 } as Partial<ReturnType<typeof emptyModel>>;
  delete old.venues;
  assert.deepEqual(parseModel(JSON.stringify(old)).venues, {}, "a model saved before this existed");
  const m = emptyModel();
  m.historyCases = 640;
  m.venues = { KRAKEN: 640 };
  const s = summarizeModel(m);
  assert.deepEqual(s.venues, { KRAKEN: 640 });
  assert.match(learnSpeech(s), /^Estudié 640 situaciones de la historia de 0 monedas\. Las estudié con velas de Kraken en dólares, porque Binance no deja leer al servidor\./);
});
