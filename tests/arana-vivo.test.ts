import assert from "node:assert/strict";
import test from "node:test";
import type { BacktestResult } from "../lib/jarvis-backtest.ts";
import { buildVivo, ESCANEO_VIEJO_MIN, type VivoInput } from "../lib/arana-vivo.ts";
import type { PaperTrade } from "../lib/jarvis-paper.ts";
import type { ScanResult } from "../lib/jarvis-scan.ts";
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
};

const base = (extra: Partial<VivoInput> = {}): VivoInput => ({
  now: AHORA,
  escaneo: null,
  escaneando: null,
  papel: [],
  backtest: null,
  vigilancia: null,
  medido: MEDIDO,
  ...extra,
});

const cerrada = (r: number) => ({ estado: "CERRADA", resultadoR: r, decision: { riesgoUsd: null }, cerradaA: 1, llenadaA: 0 }) as unknown as PaperTrade;
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
