/**
 * Mercado argentino: parse Yahoo, diagnósticos, lecturas diarias.
 * No se mira el futuro (las velas son del pasado o están cerrando ahora).
 */
import { test } from "node:test";
import assert from "node:assert";
import {
  leerYahooChart,
  estadoSerie,
  lecturaDiaria,
  PAPELES_AR,
  SIMBOLOS_PERMITIDOS,
  MAX_DIAS_SIN_RUEDA,
} from "../lib/mercado-ar.ts";
import { bajarSerieAr, probarMercadoAr, tocaPruebaAr, leerPruebas } from "../lib/mercado-ar-fuente.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

// Yahoo chart fixture: ALUA (acción argentina)
const YAHOO_CHART_FIXTURE = {
  chart: {
    result: [
      {
        meta: {
          symbol: "ALUA.BA",
          currency: "ARS",
          fullExchangeName: "Buenos Aires",
          exchangeDataDelayedBy: 60,
          regularMarketPrice: 1050.0,
          regularMarketTime: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
          currentTradingPeriod: {
            regular: {
              start: Math.floor(Date.now() / 1000) - 86400, // yesterday's close
              end: Math.floor(Date.now() / 1000) + 3600, // tomorrow (session ongoing)
            },
          },
        },
        timestamp: [
          Math.floor(Date.now() / 1000) - 10 * 86400, // 10 days ago
          Math.floor(Date.now() / 1000) - 9 * 86400,
          Math.floor(Date.now() / 1000) - 8 * 86400,
          Math.floor(Date.now() / 1000) - 7 * 86400,
          Math.floor(Date.now() / 1000) - 6 * 86400,
          Math.floor(Date.now() / 1000) - 5 * 86400,
          Math.floor(Date.now() / 1000) - 4 * 86400,
          Math.floor(Date.now() / 1000) - 3 * 86400,
          Math.floor(Date.now() / 1000) - 2 * 86400,
          Math.floor(Date.now() / 1000) - 86400, // yesterday (closed)
          Math.floor(Date.now() / 1000), // today (forming, not closed yet)
        ],
        indicators: {
          quote: [
            {
              open: [1000, 1010, 1020, 1015, 1025, 1030, 1035, 1040, 1035, 1045, 1050],
              high: [1020, 1030, 1040, 1035, 1045, 1050, 1055, 1060, 1055, 1065, 1055],
              low: [990, 1000, 1010, 1005, 1015, 1020, 1025, 1030, 1025, 1035, 1045],
              close: [1010, 1020, 1030, 1025, 1035, 1040, 1045, 1050, 1045, 1055, 1050],
              volume: [5000000, 4800000, 5200000, 4900000, 5100000, 5300000, 4700000, 5000000, 4800000, 5200000, 3000000],
            },
          ],
        },
      },
    ],
  },
};

test("leerYahooChart: parsa respuesta válida", () => {
  const ahora = Date.now();
  const serie = leerYahooChart(YAHOO_CHART_FIXTURE, ahora);
  assert(serie, "debe parsear la serie");
  assert.equal(serie.meta.simbolo, "ALUA.BA");
  assert.equal(serie.meta.moneda, "ARS");
  assert.equal(serie.meta.demoraMin, 60);
  assert(serie.velas.length >= 9, "velas cerradas (sin la de hoy)");
  assert(serie.enCurso, "debe tener una vela en curso");
});

test("leerYahooChart: excluye la vela en formación", () => {
  const ahora = Date.now();
  const serie = leerYahooChart(YAHOO_CHART_FIXTURE, ahora);
  assert(serie);
  // La vela de hoy debe estar en enCurso, no en velas cerradas
  const ultimaCerrada = serie.velas.at(-1);
  assert(ultimaCerrada);
  assert(ultimaCerrada.openTime < ahora - 3600 * 1000, "última vela cerrada debe ser de antes de hoy");
});

test("leerYahooChart: descarta velas incoherentes", () => {
  const now = Date.now();
  const base = Math.floor(now / 1000) - 86400; // yesterday
  const bad = {
    chart: {
      result: [
        {
          meta: { symbol: "TEST.BA", currency: "ARS", fullExchangeName: "Buenos Aires" },
          timestamp: [base, base + 86400, base + 2 * 86400],
          indicators: {
            quote: [
              {
                open: [100, 200, null],
                high: [120, 220, 320],
                low: [80, 180, 280],
                close: [110, 210, 310],
                volume: [1000, 2000, 3000],
              },
            ],
          },
        },
      ],
    },
  };
  const serie = leerYahooChart(bad, now);
  assert(serie);
  assert.equal(serie.velas.length, 2, "solo dos velas válidas (sin la del índice 2)");
});

test("estadoSerie: OK con suficientes ruedas recientes", () => {
  const velas: SwingCandle[] = Array.from({ length: 50 }, (_, i) => ({
    openTime: Date.now() - (50 - i) * 86400 * 1000,
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 1000000,
    quoteVolume: 105000000,
  }));
  const e = estadoSerie({ meta: { simbolo: "TEST.BA", moneda: "ARS", bolsa: "BYMA", demoraMin: 60, precio: 105, horaPrecio: Date.now() }, velas, enCurso: null }, Date.now());
  assert.equal(e.estado, "OK");
});

test("estadoSerie: STALE_DATA si última rueda es muy antigua", () => {
  const velas: SwingCandle[] = Array.from({ length: 50 }, (_, i) => ({
    openTime: Date.now() - (50 - i + MAX_DIAS_SIN_RUEDA + 2) * 86400 * 1000,
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 1000000,
    quoteVolume: 105000000,
  }));
  const e = estadoSerie({ meta: { simbolo: "TEST.BA", moneda: "ARS", bolsa: "BYMA", demoraMin: 60, precio: 105, horaPrecio: Date.now() }, velas, enCurso: null }, Date.now());
  assert.equal(e.estado, "STALE_DATA");
});

test("estadoSerie: INSUFFICIENT_DATA si menos de 30 ruedas", () => {
  const velas: SwingCandle[] = Array.from({ length: 20 }, (_, i) => ({
    openTime: Date.now() - (20 - i) * 86400 * 1000,
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 1000000,
    quoteVolume: 105000000,
  }));
  const e = estadoSerie({ meta: { simbolo: "TEST.BA", moneda: "ARS", bolsa: "BYMA", demoraMin: 60, precio: 105, horaPrecio: Date.now() }, velas, enCurso: null }, Date.now());
  assert.equal(e.estado, "INSUFFICIENT_DATA");
});

test("lecturaDiaria: calcula medias, RSI, ATR, tendencia", () => {
  const velas: SwingCandle[] = Array.from({ length: 200 }, (_, i) => {
    const precio = 100 + Math.sin(i * 0.1) * 5; // onda suave
    return {
      openTime: Date.now() - (200 - i) * 86400 * 1000,
      open: precio,
      high: precio + 2,
      low: precio - 2,
      close: precio + 1,
      volume: 1000000,
      quoteVolume: (precio + 1) * 1000000,
    };
  });
  const lectura = lecturaDiaria(velas);
  assert(lectura);
  assert(lectura.ema50 !== null, "debe calcular EMA 50");
  assert(lectura.ema200 !== null, "debe calcular EMA 200");
  assert(lectura.tendencia !== null, "tendencia definida con 200 ruedas");
  assert(lectura.rsi14 !== null, "RSI 14 debe calcularse");
  assert(lectura.atrPct !== null, "ATR % debe calcularse");
  assert.equal(lectura.ruedas, 200);
});

test("lecturaDiaria: faltantes si insuficientes ruedas", () => {
  const velas: SwingCandle[] = Array.from({ length: 50 }, (_, i) => ({
    openTime: Date.now() - (50 - i) * 86400 * 1000,
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 1000000,
    quoteVolume: 105000000,
  }));
  const lectura = lecturaDiaria(velas);
  assert(lectura);
  assert(lectura.tendencia === null, "tendencia = null sin 200 ruedas");
  assert(lectura.desdeMaximo === null, "desdeMaximo = null sin 252 ruedas");
  assert(lectura.faltantes.length > 0, "debe listar qué falta");
});

test("SIMBOLOS_PERMITIDOS: contiene todos los papeles argentinos", () => {
  PAPELES_AR.forEach((p) => {
    assert(SIMBOLOS_PERMITIDOS.has(p.yahoo), `${p.yahoo} debe estar permitido`);
    if (p.subyacente) {
      assert(SIMBOLOS_PERMITIDOS.has(p.subyacente), `subyacente ${p.subyacente} debe estar permitido`);
    }
  });
});

test("bajarSerieAr: rechaza símbolos fuera de lista", async () => {
  const r = await bajarSerieAr("FAKE.XX", { fetchImpl: async () => new Response("{}", { status: 404 }) });
  assert.equal(r.serie, null);
  assert.match(r.error || "", /lista/);
});

test("bajarSerieAr: intenta ambos hosts si el primero falla", async () => {
  let intentos = 0;
  const mockFetch = async (input: string | URL | Request) => {
    intentos++;
    if (intentos === 1) return new Response("", { status: 503 }); // primer host falla
    return new Response(JSON.stringify(YAHOO_CHART_FIXTURE)); // segundo host ok
  };
  const r = await bajarSerieAr("ALUA.BA", { fetchImpl: mockFetch as typeof fetch, ahora: Date.now() });
  assert.equal(intentos, 2, "debe intentar dos hosts");
  assert(r.serie, "debe conseguir la serie del segundo");
});

test("probarMercadoAr: rota símbolo por hora", () => {
  // La rotación es determinista: floor(scheduledTime / 3_600_000) % count de símbolos
  // Diferentes horas → diferentes símbolos (en general)
  const SIMBOLOS = ["ALUA.BA", "BBAR.BA", "BMA.BA"];
  const ts0 = new Date("2026-10-21T00:00:00Z").getTime(); // hora 0
  const ts1 = new Date("2026-10-21T01:00:00Z").getTime(); // hora 1
  const ts2 = new Date("2026-10-21T02:00:00Z").getTime(); // hora 2

  const idx0 = Math.floor(ts0 / 3_600_000) % SIMBOLOS.length; // 0 % 3 = 0
  const idx1 = Math.floor(ts1 / 3_600_000) % SIMBOLOS.length; // 1 % 3 = 1
  const idx2 = Math.floor(ts2 / 3_600_000) % SIMBOLOS.length; // 2 % 3 = 2

  assert.equal(idx0, 0);
  assert.equal(idx1, 1);
  assert.equal(idx2, 2);
});

test("tocaPruebaAr: verdadero solo en primeros 15 minutos de la hora", () => {
  const base = new Date("2026-10-21T10:00:00Z").getTime();
  assert.equal(tocaPruebaAr(base), true, "minuto 0");
  assert.equal(tocaPruebaAr(base + 5 * 60 * 1000), true, "minuto 5");
  assert.equal(tocaPruebaAr(base + 14 * 60 * 1000), true, "minuto 14");
  assert.equal(tocaPruebaAr(base + 15 * 60 * 1000), false, "minuto 15 ya no");
  assert.equal(tocaPruebaAr(base + 59 * 60 * 1000), false, "minuto 59");
});

test("leerPruebas: parsea lista JSON guardada", () => {
  const json = JSON.stringify([
    { ts: 1, simbolo: "ALUA.BA", estado: "OK", motivo: "", ruedas: 50, ultimaRueda: 123, demoraMin: 60, fuente: "Yahoo", http: 200, error: null },
    { ts: 2, simbolo: "BBAR.BA", estado: "STALE_DATA", motivo: "data vieja", ruedas: 30, ultimaRueda: 456, demoraMin: 60, fuente: "Yahoo", http: 200, error: null },
  ]);
  const pruebas = leerPruebas(json);
  assert.equal(pruebas.length, 2);
  assert.equal(pruebas[0].simbolo, "ALUA.BA");
  assert.equal(pruebas[1].estado, "STALE_DATA");
});

test("leerPruebas: devuelve lista vacía si no hay ajuste", () => {
  const pruebas = leerPruebas(null);
  assert.equal(pruebas.length, 0);
});

test("leerPruebas: ignora líneas rotas", () => {
  const json = JSON.stringify([
    { ts: 1, simbolo: "OK", estado: "OK" },
    null,
    { foo: "bar" }, // sin simbolo
    { ts: 2, simbolo: "GOOD", estado: "OK" },
  ]);
  const pruebas = leerPruebas(json);
  assert.equal(pruebas.length, 2, "solo las dos válidas");
});
