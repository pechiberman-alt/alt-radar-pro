// Pruebas de los agentes de papel del servidor (lib/agentes-servidor.ts): el turno de cada moneda, la clave, que las entradas
// son las mismas de los agentes del navegador y no miran el futuro, que el recorrido solo devuelve lo que cambió, que el cron
// del Worker coincide y que la serie sale siempre de Kraken o Coinbase, nunca de Binance.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { leerSenalesPapel, MARCO_AGENTES_MS } from "../lib/agentes-papel.ts";
import { avancesServidor, claveServidor, CRON_SERVIDOR, entradasServidor, leerClaveServidor, monedaDeTurno, MONEDAS_SERVIDOR } from "../lib/agentes-servidor.ts";
import { escaleraHacia } from "../lib/escalera.ts";
import { fetchKlinesServer, resetKlinesServerState } from "../lib/klines-server.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const M = MARCO_AGENTES_MS;
const T0 = Date.UTC(2026, 9, 20, 0);

test("una moneda por corrida, en los minutos impares 1 a 19 de las horas múltiplo de 4 (UTC)", () => {
  assert.equal(monedaDeTurno(Date.UTC(2026, 9, 20, 0, 1)), MONEDAS_SERVIDOR[0]);
  assert.equal(monedaDeTurno(Date.UTC(2026, 9, 20, 4, 19)), MONEDAS_SERVIDOR[9]);
  assert.equal(monedaDeTurno(Date.UTC(2026, 9, 20, 0, 2)), null);
  assert.equal(monedaDeTurno(Date.UTC(2026, 9, 20, 1, 1)), null);
  assert.equal(monedaDeTurno(Date.UTC(2026, 9, 20, 0, 21)), null);
  const vistas = new Set(Array.from({ length: 10 }, (_, k) => monedaDeTurno(Date.UTC(2026, 9, 20, 8, 1 + 2 * k))));
  assert.equal(vistas.size, MONEDAS_SERVIDOR.length, "cada moneda una vez por vela");
});

test("el cron del Worker es el de la corrida", () => {
  assert.ok(readFileSync("wrangler.production.jsonc", "utf8").includes(`"${CRON_SERVIDOR}"`));
});

test("la clave se lee de vuelta; una clave ajena no", () => {
  const c = claveServidor("AMD_IFVG", "SOLUSDT", "SHORT", T0);
  assert.deepEqual(leerClaveServidor(c), { estrategia: "AMD_IFVG", symbol: "SOLUSDT", lado: "SHORT", vela: T0 });
  assert.equal(leerClaveServidor(`ag:AMD_IFVG:SOLUSDT:4h:SHORT:${T0}`), null);
});

/** Una serie de 4 h con tirones, cerrada, más la vela de entrada que acaba de abrir. */
function serie(n: number): SwingCandle[] {
  const v: SwingCandle[] = [];
  let p = 100;
  for (let k = 0; k < n; k += 1) {
    const o = p;
    const c = o * (1 + Math.sin(k / 7) * 0.012 + Math.cos(k / 3) * 0.006);
    v.push({ openTime: T0 - (n - 1 - k) * M, open: o, high: Math.max(o, c) * 1.004, low: Math.min(o, c) * 0.996, close: c, volume: 10 + (k % 5), quoteVolume: 0 });
    p = c;
  }
  return v;
}

test("las entradas del servidor son las mismas de los agentes del navegador, con su consenso, y vencen a la media hora", () => {
  let algun = false;
  for (let n = 400; n < 520; n += 1) {
    const v = serie(n);
    const ahora = v[v.length - 1].openTime + 5 * 60_000;
    const planes = leerSenalesPapel("BTCUSDT", v, ahora);
    const ent = entradasServidor("BTCUSDT", v, ahora, "KRAKEN");
    assert.equal(ent.length, planes.length);
    ent.forEach((e, k) => {
      assert.equal(e.estrategia, planes[k].estrategia);
      assert.equal(e.entrada, planes[k].entrada);
      assert.equal(e.consenso.acuerdo, planes.filter((p) => p.lado === e.lado && p.estrategia !== e.estrategia).length);
    });
    if (ent.length) algun = true;
    assert.deepEqual(entradasServidor("BTCUSDT", v, v[v.length - 1].openTime + 40 * 60_000, "KRAKEN"), [], "tarde no entra");
  }
  assert.ok(algun, "la serie tiene que dar alguna entrada para que la prueba valga");
});

test("no mira el futuro: lo que todavía no pasó de la vela de entrada (máximo, mínimo, cierre) no cambia las entradas", () => {
  for (let n = 420; n < 480; n += 1) {
    const v = serie(n);
    const ahora = v[v.length - 1].openTime + 5 * 60_000;
    const antes = entradasServidor("ETHUSDT", v, ahora, "KRAKEN");
    const ult = v[v.length - 1];
    const otra = [...v.slice(0, -1), { ...ult, high: ult.open * 1.2, low: ult.open * 0.8, close: ult.open * 0.85, volume: 999 }];
    assert.deepEqual(entradasServidor("ETHUSDT", otra, ahora, "KRAKEN"), antes, `n=${n}`);
  }
});

test("el recorrido devuelve solo lo que cambió: un objetivo nuevo o el cierre; lo que sigue igual no se reescribe", () => {
  const e = escaleraHacia("LONG", 100, 97, 106)!;
  const base = { clave: "sv:X:BTCUSDT:4h:LONG:1", lado: "LONG" as const, vela: T0, entrada: 100, sl: e.stop, tp1: e.tp1, tp2: e.tp2, tp3: e.tp3, tp1_at: null, tp2_at: null };
  const vela = (k: number, high: number, low: number): SwingCandle => ({ openTime: T0 + k * M, open: 100, high, low, close: 100, volume: 1, quoteVolume: 0 });
  const quieta = [vela(1, 100.5, 99.5)];
  assert.deepEqual(avancesServidor([base], quieta, T0 + 3 * M), []);
  const tp1 = avancesServidor([base], [vela(1, 102.5, 99.5)], T0 + 3 * M);
  assert.equal(tp1.length, 1);
  assert.equal(tp1[0].recorrido.desenlace, "ABIERTA");
  assert.deepEqual(avancesServidor([{ ...base, tp1_at: tp1[0].recorrido.tp1At }], [vela(1, 102.5, 99.5)], T0 + 3 * M), [], "el TP1 ya anotado no vuelve");
  const sl = avancesServidor([base], [vela(1, 102.5, 96)], T0 + 3 * M);
  assert.equal(sl[0].recorrido.desenlace, "SL", "stop y objetivo en la misma vela: cuenta el stop");
  assert.deepEqual(avancesServidor([base], [vela(1, 110, 96)], T0 + M), [], "una vela que no cerró no cuenta");
});

test("soloAfuera: la serie sale de Kraken y nunca se le pregunta a Binance", async () => {
  resetKlinesServerState();
  const real = globalThis.fetch;
  const pedidas: string[] = [];
  const filas = Array.from({ length: 5 }, (_, k) => [T0 / 1000 + k * 14400, "100", "101", "99", "100.5", "100.2", "3", 10]);
  globalThis.fetch = (async (u: string) => {
    pedidas.push(String(u));
    return new Response(JSON.stringify({ error: [], result: { XXBTZUSD: filas, last: 1 } }));
  }) as typeof fetch;
  try {
    const r = await fetchKlinesServer("BTCUSDT", "4h", { limit: 720, soloAfuera: true });
    assert.equal(r.venue, "KRAKEN");
    assert.equal(r.candles.length, 5);
    assert.ok(pedidas.every((u) => !u.includes("binance")), pedidas.join(" "));
  } finally {
    globalThis.fetch = real;
  }
});

test("la corrida de punta a punta: registra con Kraken, la vuelta siguiente cierra las abiertas, y si Kraken falla queda el motivo", async () => {
  const { makeDb, sqlite } = await import("./helpers/fake-d1.ts");
  if (!sqlite) return;
  const { runAgentesServidor } = await import("../lib/agentes-servidor-run.ts");
  const { estadoServidor, filasServidor } = await import("../lib/agentes-servidor-db.ts");
  const T = Date.UTC(2026, 9, 20, 8);
  const corrida = T + 60_000; // minuto 1 de las 08 UTC: le toca BTC
  assert.equal(monedaDeTurno(corrida), "BTCUSDT");
  // Una serie que dé entradas en la vela que cierra justo antes de T.
  let v: SwingCandle[] = [];
  for (let n = 400; n < 600 && !v.length; n += 1) {
    const s = serie(n).map((c) => ({ ...c, openTime: c.openTime - T0 + T }));
    if (entradasServidor("BTCUSDT", s, T + 5 * 60_000, "KRAKEN").length) v = s;
  }
  assert.ok(v.length, "hace falta una serie con entradas");
  const kraken = (velas: SwingCandle[]) => JSON.stringify({ error: [], result: { XXBTZUSD: velas.map((c) => [c.openTime / 1000, c.open, c.high, c.low, c.close, c.close, c.volume, 1]), last: 1 } });
  const real = globalThis.fetch;
  const pedidas: string[] = [];
  let respuesta = kraken(v);
  globalThis.fetch = (async (u: string) => {
    pedidas.push(String(u));
    return new Response(respuesta);
  }) as typeof fetch;
  resetKlinesServerState();
  const db = makeDb();
  try {
    await runAgentesServidor(db, corrida, T + 5 * 60_000);
    const abiertas = await filasServidor(db, 100);
    assert.ok(abiertas.length > 0 && abiertas.every((f) => f.desenlace === "ABIERTA" && f.clave.startsWith("sv:")));
    assert.equal((await estadoServidor(db))[0].venue, "KRAKEN");
    // Repetir la corrida no duplica.
    await runAgentesServidor(db, corrida, T + 6 * 60_000);
    assert.equal((await filasServidor(db, 100)).length, abiertas.length);
    // Cuatro velas después, un derrumbe y una suba enormes: toda abierta toca su stop (si toca los dos, cuenta el stop).
    const despues = [1, 2, 3].map((k) => ({ openTime: T + k * M, open: v[v.length - 1].open, high: v[v.length - 1].open * 3, low: v[v.length - 1].open / 3, close: v[v.length - 1].open, volume: 1, quoteVolume: 0 }));
    respuesta = kraken([...v, ...despues]);
    await runAgentesServidor(db, T + 4 * 3_600_000 + 60_000, T + 4 * M - 60_000);
    const cerradas = await filasServidor(db, 100);
    assert.ok(cerradas.every((f) => f.desenlace === "SL" && typeof f.r === "number" && f.r < -1), JSON.stringify(cerradas.map((f) => [f.desenlace, f.r])));
    assert.ok(pedidas.every((u) => u.includes("kraken")), "nunca Binance");
    // Si Kraken falla, el motivo queda anotado; no se escribe ningún cero.
    globalThis.fetch = (async () => new Response("falla", { status: 500 })) as typeof fetch;
    await runAgentesServidor(db, corrida, T + 5 * 60_000);
    const est = (await estadoServidor(db)).find((e) => e.symbol === "BTCUSDT")!;
    assert.ok(est.error && est.venue === null, String(est.error));
  } finally {
    globalThis.fetch = real;
  }
});
