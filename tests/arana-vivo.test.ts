import assert from "node:assert/strict";
import test from "node:test";
import type { BacktestResult } from "../lib/jarvis-backtest.ts";
import { APRENDIZAJE_VIVO, buildVivo, ESCANEO_VIEJO_MIN, type VivoInput } from "../lib/arana-vivo.ts";
import type { PaperTrade } from "../lib/jarvis-paper.ts";
import type { ScanResult, ScanRow } from "../lib/jarvis-scan.ts";
import type { WatchStatus } from "../lib/jarvis-watch-run.ts";
import type { MedicionMesa } from "../lib/mesa-medicion.ts";

const MIN = 60_000;
const AHORA = Date.parse("2026-10-13T08:00:00Z");

const MEDIDO: MedicionMesa = {
  fuente: "fixture",
  perfil: "1 h",
  reglas: "v2",
  monedas: 10,
  periodo: "fixture",
  n: 3000,
  winRate: { p: 0.45, low: 0.43, high: 0.47 },
  profitFactor: { p: 1.17, low: 1.06, high: 1.28 },
  expectativaR: { p: 0.05, low: 0.02, high: 0.08 },
  sharpe: 0.1,
  psr0: 0.9,
  reglasProbadas: 22,
  dsr: 0.5,
  dsr300: 0.4,
  pbo: 0.5,
};

const base = (extra: Partial<VivoInput> = {}): VivoInput => ({
  now: AHORA,
  escaneo: null,
  escaneando: null,
  llegando: [],
  papel: [],
  backtest: null,
  vigilancia: null,
  medido: MEDIDO,
  ...extra,
});

const cerrada = (r: number) => ({ symbol: "BTCUSDT", lado: "LONG", estado: "CERRADA", resultadoR: r, decision: { riesgoUsd: null }, cerradaA: 1, llenadaA: 0 }) as unknown as PaperTrade;
const papel = (ganadas: number, perdidas: number) => [...Array(ganadas).fill(1), ...Array(perdidas).fill(-1)].map(cerrada);

const escaneo = (haceMin: number, parcial = false): ScanResult =>
  ({
    at: AHORA - haceMin * MIN,
    minVolumen: 0,
    universo: { contratos: 10, noMonedas: 0, sinVolumen: 0, recortadas: 0, elegibles: 10 },
    filas: [
      { symbol: "ETHUSDT", direccion: "LONG", puntaje: 70, consenso: 0.5, volumenUsd: 1 },
      { symbol: "SOLUSDT", direccion: "SHORT", puntaje: 80, consenso: -0.4, volumenUsd: 2 },
      { symbol: "XRPUSDT", direccion: "ESPERAR", puntaje: 90, consenso: 0.1, volumenUsd: 3 },
    ],
    resumen: { total: 10, leidas: 8, aprobadas: 2, largos: 1, cortos: 1 },
    parcial,
    motivoParcial: parcial ? "Binance limitó las consultas" : null,
    duracionMs: 1000,
  }) as unknown as ScanResult;

/** Ningún número de la foto puede ser NaN ni infinito: lo que no se sabe es null. */
function soloFinitos(v: unknown, ruta = "foto"): void {
  if (typeof v === "number") assert.ok(Number.isFinite(v), `${ruta} no es un número finito: ${v}`);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) soloFinitos(x, `${ruta}.${k}`);
}

test("sin escaneo, sin papel y sin backtest: todo dice «sin datos», nada se inventa", () => {
  const v = buildVivo(base());
  assert.equal(v.escaneo.estado, "sin datos");
  assert.equal(v.escaneo.haceMin, null);
  assert.deepEqual(v.escaneo.mejores, []);
  assert.equal(v.papel.muestra, "SIN DATOS");
  assert.equal(v.papel.winRate, null);
  assert.equal(v.veredicto.estado, "sin datos");
  assert.equal(v.backtest, null);
  assert.equal(v.vigilancia, null);
  assert.deepEqual(v.avisos, []);
  soloFinitos(v);
});

test("el escaneo al día muestra las mejores aprobadas, ordenadas por puntaje, sin los que esperan", () => {
  const v = buildVivo(base({ escaneo: escaneo(5) }));
  assert.equal(v.escaneo.estado, "listo");
  assert.equal(v.escaneo.haceMin, 5);
  assert.deepEqual(
    v.escaneo.mejores.map((m) => m.symbol),
    ["SOLUSDT", "ETHUSDT"],
  );
  assert.equal(v.escaneo.aprobadas, 2);
  assert.equal(v.escaneo.leidas, 8);
  assert.deepEqual(v.avisos, []);
});

test("un escaneo viejo avisa que ya no es de ahora, y uno parcial dice por qué se cortó", () => {
  const viejo = buildVivo(base({ escaneo: escaneo(ESCANEO_VIEJO_MIN + 30) }));
  assert.ok(viejo.avisos.some((a) => a.includes("ya no es de ahora")));
  const parcial = buildVivo(base({ escaneo: escaneo(1, true) }));
  assert.equal(parcial.escaneo.estado, "parcial");
  assert.ok(parcial.avisos.some((a) => a.includes("Binance limitó las consultas")));
});

test("mientras escanea, muestra el avance y no el escaneo anterior como si fuera nuevo", () => {
  const v = buildVivo(base({ escaneo: escaneo(120), escaneando: { hechas: 3, total: 10 } }));
  assert.equal(v.escaneo.estado, "escaneando");
  assert.equal(v.escaneo.progreso, 0.3);
  assert.deepEqual(v.avisos, [], "un escaneo en curso no se marca como viejo");
});

test("el papel con menos de 15 operaciones cerradas es muestra mínima y no se compara con lo medido", () => {
  const v = buildVivo(base({ papel: papel(7, 3) }));
  assert.equal(v.papel.cerradas, 10);
  assert.equal(v.papel.muestra, "MUESTRA MÍNIMA");
  assert.equal(v.veredicto.estado, "sin muestra");
  // Ni acierto ni intervalo: con una sola operación un 0% o un 100% sería un número sin sentido.
  assert.equal(v.papel.winRate, null);
});

test("con una sola operación cerrada no hay porcentaje de acierto, aunque haya operaciones abiertas", () => {
  const v = buildVivo(base({ papel: [...papel(0, 1), abierta("ETHUSDT", 5)] }));
  assert.equal(v.papel.cerradas, 1);
  assert.equal(v.papel.abiertas, 1);
  assert.equal(v.papel.winRate, null);
  assert.equal(v.veredicto.estado, "sin muestra");
});

test("sin operaciones cerradas el veredicto dice «sin datos», no «muestra mínima»", () => {
  const v = buildVivo(base({ papel: [abierta("ETHUSDT", 5)] }));
  assert.equal(v.papel.cerradas, 0);
  assert.equal(v.papel.winRate, null);
  assert.equal(v.veredicto.estado, "sin datos");
});

test("con muestra suficiente, el papel se compara con el intervalo de lo medido", () => {
  const dentro = buildVivo(base({ papel: papel(18, 22) }));
  assert.equal(dentro.veredicto.estado, "compatible", "45% con IC90 se superpone con lo medido");
  assert.ok(dentro.papel.winRate && dentro.papel.winRate.low < dentro.papel.winRate.p);

  const fuera = buildVivo(base({ papel: papel(4, 36) }));
  assert.equal(fuera.veredicto.estado, "distinto", "10% con 40 operaciones queda fuera de lo medido");
  assert.ok(fuera.veredicto.texto.includes("Revisar"));
});

test("sin pérdidas el profit factor es null, no infinito", () => {
  const v = buildVivo(base({ papel: papel(12, 0) }));
  assert.equal(v.papel.profitFactor, null);
  soloFinitos(v);
});

test("el backtest y la vigilancia pasan con su muestra y su hora", () => {
  const bt = {
    symbol: "BTCUSDT",
    dias: 90,
    metricas: { operaciones: 40, ganadas: 18, perdidas: 22, winRate: 0.45, profitFactor: 1.1, muestra: "MUESTRA RAZONABLE" },
  } as unknown as BacktestResult;
  const vig: WatchStatus = { lastRun: AHORA - 2 * MIN, lastAlerts: 0, errors: ["fallo de red"], running: false, tape: "en vivo" };
  const v = buildVivo(base({ backtest: bt, vigilancia: vig }));
  assert.equal(v.backtest?.moneda, "BTC");
  assert.equal(v.backtest?.operaciones, 40);
  assert.equal(v.backtest?.muestra, "MUESTRA RAZONABLE");
  assert.deepEqual(v.vigilancia, { cinta: "en vivo", haceMin: 2, errores: 1 });
});

test("la misma entrada da la misma foto (función pura) y siempre trae la advertencia", () => {
  const entrada = base({ escaneo: escaneo(3), papel: papel(18, 22) });
  assert.deepEqual(buildVivo(entrada), buildVivo(entrada));
  assert.ok(buildVivo(entrada).advertencia.includes("No es asesoramiento financiero"));
});

const fila = (symbol: string, direccion: string, puntaje: number | null, extra: Record<string, unknown> = {}) =>
  ({ symbol, moneda: symbol.replace(/USDT$/, ""), volumenUsd: 1, lectura: "rápida", direccion, puntaje, consenso: 0.2, cobertura: null, precio: 1, plan: null, frenoEn: null, motivo: null, antes: null, nota: null, ...extra }) as unknown as ScanRow;

const abierta = (symbol: string, riesgoUsd: number | null, lado = "LONG") =>
  ({ id: symbol, symbol, lado, estado: "ABIERTA", abiertaA: 1, llenadaA: 1, cerradaA: null, resultadoR: null, entrada: 100, decision: { riesgoNivel: "BAJO", apalancamiento: 1, riesgoUsd, posicionUsd: null, stopPct: 1 } }) as unknown as PaperTrade;

test("mientras escanea, la esfera muestra lo que va llegando y el resumen sale de eso, contra el total del escaneo", () => {
  const llegando = [fila("ETHUSDT", "LONG", 70), fila("XRPUSDT", "ESPERAR", 40, { frenoEn: "consenso" })];
  const v = buildVivo(base({ escaneo: escaneo(120), escaneando: { hechas: 2, total: 10 }, llegando }));
  assert.equal(v.filas.length, 2, "lo que va llegando, no el escaneo de hace dos horas");
  assert.equal(v.escaneo.total, 10);
  assert.equal(v.escaneo.leidas, 2);
  assert.equal(v.escaneo.aprobadas, 1);
  assert.equal(v.escaneo.sinLado, 1, "la que frenó el consenso se cuenta en su compuerta");
  assert.deepEqual(
    v.escaneo.mejores.map((m) => m.symbol),
    ["ETHUSDT"],
  );
});

test("el histograma cuenta cada moneda leída en su tramo de 10 puntos, y no cuenta las que no tienen datos", () => {
  const filas = [fila("AAAUSDT", "ESPERAR", 5), fila("BBBUSDT", "ESPERAR", 15), fila("CCCUSDT", "LONG", 15), fila("DDDUSDT", "SHORT", 100), fila("EEEUSDT", "SIN DATOS", null)];
  const v = buildVivo(base({ escaneo: { ...escaneo(1), filas } as ScanResult }));
  assert.equal(v.histograma.length, 10);
  assert.equal(v.histograma[0].n, 1);
  assert.equal(v.histograma[1].n, 2);
  assert.equal(v.histograma[1].aprobadas, 1);
  assert.equal(v.histograma[9].n, 1, "100 cae en el último tramo, 90 a 100");
  assert.equal(v.histograma.reduce((p, t) => p + t.n, 0), 4, "la que no tiene datos no entra");
});

test("la cobertura media promedia solo las aprobadas que la tienen; los especialistas cuentan en cuántas monedas tuvieron datos", () => {
  const agentes = (datos: boolean) => [
    ["tecnico", datos ? 1 : 0, 0.4, 0.2],
    ["macro", 0, 0, 0.1],
  ];
  const filas = [
    fila("AAAUSDT", "LONG", 80, { cobertura: 0.8, agentes: agentes(true) }),
    fila("BBBUSDT", "SHORT", 70, { cobertura: 0.6, agentes: agentes(true) }),
    fila("CCCUSDT", "LONG", 60, { cobertura: null, agentes: agentes(false) }),
    fila("DDDUSDT", "ESPERAR", 30, { cobertura: 0.1, agentes: agentes(true) }),
  ];
  const v = buildVivo(base({ escaneo: { ...escaneo(1), filas } as ScanResult }));
  assert.equal(v.coberturaMedia.n, 2, "la aprobada sin cobertura no entra, y la que espera tampoco");
  assert.ok(v.coberturaMedia.valor !== null && Math.abs(v.coberturaMedia.valor - 0.7) < 1e-9);
  assert.deepEqual(
    v.especialistas.find((x) => x.id === "tecnico"),
    { id: "tecnico", disponibles: 3, de: 4 },
  );
  assert.deepEqual(
    v.especialistas.find((x) => x.id === "macro"),
    { id: "macro", disponibles: 0, de: 4 },
  );
});

test("el riesgo abierto suma solo lo que se conoce, dice cuántas no lo traen y los arcos son solo las abiertas", () => {
  const closed = { ...cerrada(1), symbol: "ZZZUSDT", lado: "SHORT" } as unknown as PaperTrade;
  const v = buildVivo(base({ papel: [abierta("AUSDT", 10), abierta("BUSDT", null), abierta("CUSDT", 5), closed] }));
  assert.deepEqual(v.riesgoAbierto, { usd: 15, abiertas: 3, sinDato: 1 });
  assert.deepEqual(
    v.arcos.map((a) => a.symbol),
    ["AUSDT", "BUSDT", "CUSDT"],
  );
  const sin = buildVivo(base({ papel: [abierta("AUSDT", null)] }));
  assert.deepEqual(sin.riesgoAbierto, { usd: null, abiertas: 1, sinDato: 1 }, "ninguna trae el dato: null, no cero");
});

test("la cinta cuenta lo último primero, con la R con coma y como máximo doce; la foto sigue siendo solo números finitos", () => {
  const cerradas = Array.from({ length: 15 }, (_, k) => ({ ...cerrada(k % 2 ? 1.5 : -0.5), id: `t${k}`, symbol: "BTCUSDT", lado: "LONG", entrada: 100, llenadaA: 1000 + k, cerradaA: 2000 + k }));
  const v = buildVivo(base({ escaneo: escaneo(5), papel: cerradas as unknown as PaperTrade[] }));
  assert.equal(v.cinta.length, 12);
  assert.ok(v.cinta.every((x, k) => k === 0 || v.cinta[k - 1].cuando >= x.cuando), "lo más nuevo primero");
  assert.ok(v.cinta.some((x) => /[+-]\d,\d{2} R neto/.test(x.texto)), "la R sale con coma");
  assert.ok(v.cinta.some((x) => x.tono === "ok") && v.cinta.some((x) => x.tono === "malo"));
  soloFinitos(buildVivo(base({ escaneo: { ...escaneo(1), filas: [fila("AAAUSDT", "LONG", 80, { cobertura: 0.8, agentes: [["tecnico", 1, 0.4, 0.2]] })] } as ScanResult, papel: [abierta("AUSDT", 3)] })));
  assert.ok(buildVivo(base()).aprendizaje === APRENDIZAJE_VIVO && APRENDIZAJE_VIVO.includes("en sombra") && APRENDIZAJE_VIVO.includes("sin tu aprobación") && APRENDIZAJE_VIVO.includes("nada toca la ejecución real"));
});
