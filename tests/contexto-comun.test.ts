// Pruebas del contexto común (lib/contexto-comun.ts): cada dato con su estado de calidad (ausente, viejo, insuficiente o
// incoherente, nunca cero), Spot y Futures sin mezclarse, velas que todavía no cerraron fuera (no se mira el futuro), la
// foto de la mesa envuelta sin pedir nada nuevo y la compatibilidad entre dos fotos que leen dos agentes.
import assert from "node:assert/strict";
import test from "node:test";
import {
  compatibles,
  contextoDesdeMesa,
  evaluarDato,
  mercadoComun,
  mercadoDeFuente,
  mismoMercado,
  problemasDe,
  TEXTO_CALIDAD,
  velasComoDato,
} from "../lib/contexto-comun.ts";
import type { DeskSnapshot } from "../lib/jarvis-desk-data.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const H = 3_600_000;
const AHORA = Date.UTC(2026, 9, 21, 12, 30, 0);
const vela = (openTime: number, close = 100): SwingCandle => ({ openTime, open: 100, high: Math.max(100, close) + 1, low: Math.min(100, close) - 1, close, volume: 10, quoteVolume: 1000 });
/** `n` velas cerradas de `frame`; la última cerró en el último múltiplo de `frame` antes de `hasta`. */
const serie = (n: number, frame: number, hasta = AHORA) => {
  const ultima = Math.floor(hasta / frame) * frame - frame;
  return Array.from({ length: n }, (_, k) => vela(ultima - (n - 1 - k) * frame));
};
const origen = { fuente: "Binance Futures", unidad: "USDT", mercado: "FUTURES" as const, temporalidad: "1h" };

test("vocabulario de calidad: el mismo del documento de la plataforma", () => {
  assert.deepEqual(TEXTO_CALIDAD, { OK: "OK", STALE_DATA: "STALE DATA", DATA_UNAVAILABLE: "DATA UNAVAILABLE", INSUFFICIENT_DATA: "INSUFFICIENT DATA" });
});

test("velas: ausentes o vacías no son cero, son DATA UNAVAILABLE con motivo", () => {
  for (const v of [null, undefined, []]) {
    const d = velasComoDato(v, H, origen, AHORA, 50);
    assert.equal(d.calidad, "DATA_UNAVAILABLE");
    assert.equal(d.valor, null);
    assert.ok(d.motivo.length > 0);
  }
});

test("velas frescas y suficientes: OK, con la hora del cierre de la última y su origen", () => {
  const v = serie(60, H);
  const d = velasComoDato(v, H, origen, AHORA, 50);
  assert.equal(d.calidad, "OK");
  assert.equal(d.motivo, "");
  assert.equal(d.ts, v.at(-1)!.openTime + H);
  assert.equal(d.mercado, "FUTURES");
  assert.equal(d.valor!.length, 60);
});

test("velas viejas: STALE DATA; pocas: INSUFFICIENT DATA; las dos cosas se dicen", () => {
  const vieja = velasComoDato(serie(60, H, AHORA - 5 * H), H, origen, AHORA, 50);
  assert.equal(vieja.calidad, "STALE_DATA");
  assert.match(vieja.motivo, /cerró hace/);
  const pocas = velasComoDato(serie(10, H), H, origen, AHORA, 50);
  assert.equal(pocas.calidad, "INSUFFICIENT_DATA");
  assert.match(pocas.motivo, /10 velas \(mínimo 50\)/);
  const ambas = velasComoDato(serie(10, H, AHORA - 5 * H), H, origen, AHORA, 50);
  assert.equal(ambas.calidad, "STALE_DATA", "lo viejo pesa más que la muestra corta");
  assert.match(ambas.motivo, /mínimo 50/);
});

test("velas incoherentes y repetidas con valores distintos se descartan y se dicen; las repetidas idénticas se unen", () => {
  const v = serie(60, H);
  const rota = { ...v[10], high: v[10].close - 5 };
  const conRota = velasComoDato([...v.slice(0, 10), rota, ...v.slice(11)], H, origen, AHORA, 50);
  assert.equal(conRota.calidad, "INSUFFICIENT_DATA");
  assert.match(conRota.motivo, /1 vela incoherente/);
  assert.equal(conRota.valor!.length, 59);

  const repetidas = velasComoDato([...v, v[5], v[6]], H, origen, AHORA, 50);
  assert.equal(repetidas.calidad, "OK");
  assert.equal(repetidas.valor!.length, 60);

  const distintas = velasComoDato([...v, { ...v[5], close: 101, high: 102 }], H, origen, AHORA, 50);
  assert.equal(distintas.calidad, "INSUFFICIENT_DATA");
  assert.match(distintas.motivo, /repetida con valores distintos/);
  assert.equal(distintas.valor!.length, 59);
});

test("no mira el futuro: una vela que todavía no cerró queda afuera, y el resultado es el mismo que sin ella", () => {
  const cerradas = serie(60, H);
  const aMedias = vela(cerradas.at(-1)!.openTime + H);
  assert.ok(aMedias.openTime + H > AHORA, "la vela de prueba todavía no cerró");
  const con = velasComoDato([...cerradas, aMedias], H, origen, AHORA, 50);
  const sin = velasComoDato(cerradas, H, origen, AHORA, 50);
  assert.deepEqual(con, sin);
  assert.ok(con.valor!.every((c) => c.openTime + H <= AHORA));
});

test("cualquier dato: ausente, sin hora, del futuro, viejo o con muestra corta", () => {
  const o = { fuente: "x", unidad: "u" };
  assert.equal(evaluarDato(null, AHORA, o, { ahora: AHORA, maxEdadMs: H }).calidad, "DATA_UNAVAILABLE");
  assert.equal(evaluarDato(1, null, o, { ahora: AHORA, maxEdadMs: H }).calidad, "INSUFFICIENT_DATA");
  assert.equal(evaluarDato(1, AHORA + 10 * 60_000, o, { ahora: AHORA, maxEdadMs: H }).calidad, "INSUFFICIENT_DATA");
  assert.equal(evaluarDato(1, AHORA - 2 * H, o, { ahora: AHORA, maxEdadMs: H }).calidad, "STALE_DATA");
  const corta = evaluarDato(1, AHORA, o, { ahora: AHORA, maxEdadMs: H, muestra: 9, minMuestra: 15 });
  assert.equal(corta.calidad, "INSUFFICIENT_DATA");
  assert.match(corta.motivo, /muestra de 9 \(mínimo 15\)/);
  const porRecepcion = evaluarDato(1, null, { ...o, recibido: AHORA }, { ahora: AHORA, maxEdadMs: H });
  assert.equal(porRecepcion.calidad, "OK", "sin hora de la fuente, la frescura se mide con la de recepción");
  assert.equal(porRecepcion.ts, null, "y la hora de la fuente queda vacía, a la vista");
});

test("Spot y Futures: cada fuente con su mercado, y sin mercado declarado no se supone", () => {
  assert.equal(mercadoDeFuente("Binance Futures"), "FUTURES");
  assert.equal(mercadoDeFuente("Binance Spot"), "SPOT");
  assert.equal(mercadoDeFuente("copia del servidor (Binance)"), null);
  assert.equal(mercadoDeFuente(null), null);
  assert.equal(mismoMercado("Binance Futures", "FUTURES"), true);
  assert.equal(mismoMercado("Binance Spot", "FUTURES"), false, "el footprint de futuros no va sobre velas spot");
  assert.equal(mismoMercado("copia del servidor (Binance)", "FUTURES"), false);
  assert.deepEqual(mercadoComun(["Binance Futures", "Binance Futures"]), { mercado: "FUTURES", aviso: null });
  const mezcla = mercadoComun(["Binance Futures", "Binance Spot"]);
  assert.equal(mezcla.mercado, null);
  assert.match(mezcla.aviso!, /Spot y de Futures/);
  assert.equal(mercadoComun([]).mercado, null);
});

function foto(x: Partial<DeskSnapshot> = {}): DeskSnapshot {
  return {
    symbol: "SOLUSDT",
    now: AHORA,
    candles: { h1: serie(200, H), h4: serie(100, 4 * H), d1: serie(40, 24 * H) },
    btc: serie(200, H),
    eth: serie(200, H),
    derivatives: null,
    liquidations: null,
    macro: { btcDominance: null, usdtDominance: null, marketCapChange24h: null, events: null, calendarSource: null },
    news: null,
    fearGreed: null,
    sources: [],
    venues: ["Binance Futures"],
    ...x,
  };
}

test("la foto de la mesa como contexto común: cada parte con su estado, y el flujo por operación declarado como faltante", () => {
  const c = contextoDesdeMesa(foto());
  assert.equal(c.mercado, "FUTURES");
  assert.equal(c.id, `CONTEXTO_1:SOLUSDT:${AHORA}`);
  assert.equal(c.velas["1h"].calidad, "OK");
  assert.equal(c.velas["4h"].calidad, "OK");
  assert.equal(c.velas["1d"].calidad, "OK");
  assert.equal(c.derivados.calidad, "DATA_UNAVAILABLE", "sin derivados no hay cero: hay faltante");
  assert.equal(c.footprint.calidad, "DATA_UNAVAILABLE");
  assert.match(c.footprint.motivo, /fase C/);
  assert.deepEqual(problemasDe(c).map((p) => p.parte), ["derivados", "liquidaciones", "noticias", "miedo y avaricia", "calendario", "footprint", "libro"]);
  assert.deepEqual(c.avisos, []);
});

test("la foto con velas de Spot y de Futures queda sin mercado y lo avisa; sin fuentes registradas, también", () => {
  const mezcla = contextoDesdeMesa(foto({ venues: ["Binance Futures", "Binance Spot"] }));
  assert.equal(mezcla.mercado, null);
  assert.equal(mezcla.velas["1h"].mercado, null);
  assert.match(mezcla.avisos.join(" "), /no se mezclan/);
  const sinFuentes = contextoDesdeMesa(foto({ venues: undefined }));
  assert.equal(sinFuentes.mercado, null);
  assert.match(sinFuentes.avisos.join(" "), /no registra/);
});

test("dos agentes con fotos compatibles: mismo símbolo, mercado, momento y última vela cerrada", () => {
  const a = contextoDesdeMesa(foto());
  assert.deepEqual(compatibles(a, contextoDesdeMesa(foto()), 60_000), { compatibles: true, motivos: [] });
  assert.equal(compatibles(a, contextoDesdeMesa(foto({ symbol: "ETHUSDT" })), 60_000).compatibles, false);
  const tarde = contextoDesdeMesa(foto({ now: AHORA + 10 * 60_000 }));
  assert.match(compatibles(a, tarde, 60_000).motivos.join(" "), /de diferencia/);
  const otraVela = contextoDesdeMesa(foto({ candles: { h1: serie(200, H, AHORA - H), h4: serie(100, 4 * H), d1: serie(40, 24 * H) } }));
  assert.match(compatibles(a, otraVela, 60_000).motivos.join(" "), /1h: distinta última vela cerrada/);
  const sinMercado = contextoDesdeMesa(foto({ venues: ["Binance Futures", "Binance Spot"] }));
  assert.match(compatibles(a, sinMercado, 60_000).motivos.join(" "), /sin mercado|no tiene mercado/);
});
