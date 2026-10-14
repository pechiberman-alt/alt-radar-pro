/**
 * El estudio de estrategias del AI TRADING LAB: cada agente mide su estrategia (lib/estrategias.ts) en las 10 monedas
 * de datos-investigacion/, con velas de 1 h y de 4 h, y con costos (comisión + deslizamiento). El período se parte por
 * fecha en DESARROLLO (70 % inicial) y EVALUACIÓN (30 % final); el veredicto sale solo de la EVALUACIÓN. Escribe
 * lib/estudio-estrategias-datos.ts (lo que muestra la app) y docs/estudio-estrategias.md (la tabla para leer).
 *
 * Uso: node --experimental-strip-types scripts/investigacion/estrategias.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ESTRATEGIAS, medir, operar, veredicto, type Medicion, type Operacion } from "../../lib/estrategias.ts";
import { FRACCION_EVALUACION } from "../../lib/lab-evaluacion.ts";
import type { SwingCandle } from "../../lib/swing-entries.ts";
import { DATOS } from "./util.ts";

const MONEDAS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "TRXUSDT", "BCHUSDT", "ZECUSDT"];
const MARCOS = [
  { id: "1h", ms: 3_600_000 },
  { id: "4h", ms: 4 * 3_600_000 },
] as const;
/** Comisión 0,05 % + deslizamiento supuesto 0,02 %, por lado. */
const COSTO_PCT = 0.07;
const HORIZONTE = 48;

function leer(symbol: string, marco: string): SwingCandle[] {
  const raw = JSON.parse(readFileSync(join(DATOS, `${symbol}-${marco}.json`), "utf8")) as number[][];
  return raw.map(([openTime, open, high, low, close, volume]) => ({ openTime, open, high, low, close, volume }) as SwingCandle);
}

type Fila = {
  estrategia: string;
  agente: string;
  nombre: string;
  regla: string;
  marco: string;
  desarrollo: Medicion;
  evaluacion: Medicion;
  veredicto: string;
  /** Monedas con expectancia positiva en EVALUACIÓN, de las que tuvieron operaciones. */
  monedasPositivas: number;
  monedasConOperaciones: number;
};

const filas: Fila[] = [];
let desde = Infinity;
let hasta = -Infinity;
let corteGlobal = 0;
const t0 = Date.now();

for (const marco of MARCOS) {
  const velas = new Map(MONEDAS.map((s) => [s, leer(s, marco.id)]));
  for (const v of velas.values()) {
    desde = Math.min(desde, v[0].openTime);
    hasta = Math.max(hasta, v[v.length - 1].openTime);
  }
  // Un solo corte por fecha para todas las monedas, fijado antes de mirar resultados.
  const corte = Math.round(desde + (hasta - desde) * (1 - FRACCION_EVALUACION));
  corteGlobal = corte;
  const porEstrategia = new Map<string, Operacion[]>();
  for (const e of ESTRATEGIAS) {
    const ops: Operacion[] = [];
    for (const [s, v] of velas) ops.push(...operar(e, s, v, { marcoMs: marco.ms, horizonte: HORIZONTE, feePct: COSTO_PCT }));
    porEstrategia.set(e.id, ops);
  }
  const control = medir((porEstrategia.get("AZAR") ?? []).filter((o) => o.abiertaA >= corte));
  for (const e of ESTRATEGIAS) {
    const ops = porEstrategia.get(e.id) ?? [];
    const dev = ops.filter((o) => o.abiertaA < corte);
    const ev = ops.filter((o) => o.abiertaA >= corte);
    const mEv = medir(ev);
    const porMoneda = MONEDAS.map((s) => medir(ev.filter((o) => o.symbol === s))).filter((m) => m.operaciones > 0);
    filas.push({
      estrategia: e.id,
      agente: e.agente,
      nombre: e.nombre,
      regla: e.regla,
      marco: marco.id,
      desarrollo: medir(dev),
      evaluacion: mEv,
      veredicto: e.id === "AZAR" ? "CONTROL" : veredicto(mEv, control),
      monedasPositivas: porMoneda.filter((m) => (m.expectancia ?? 0) > 0).length,
      monedasConOperaciones: porMoneda.length,
    });
  }
}

const dia = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")} %`);
const n2 = (v: number | null) => (v === null ? "—" : v.toFixed(2).replace(".", ","));
const r3 = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(3).replace(".", ",")} R`);
const redondo = (m: Medicion): Medicion => JSON.parse(JSON.stringify(m, (_k, x) => (typeof x === "number" ? Math.round(x * 10000) / 10000 : x)));

const meta = {
  generado: dia(Date.now()),
  datosDesde: dia(desde),
  datosHasta: dia(hasta),
  corte: dia(corteGlobal),
  monedas: MONEDAS,
  costoPorLadoPct: COSTO_PCT,
  horizonteVelas: HORIZONTE,
};

const ts = `/**
 * Resultado del estudio de estrategias (scripts/investigacion/estrategias.ts). ARCHIVO GENERADO: no editar a mano;
 * se vuelve a generar corriendo el script con los datos de datos-investigacion/. Es una medición del pasado, con
 * costos, separada en desarrollo y evaluación: no garantiza resultados futuros y no es asesoramiento financiero.
 */
import type { Medicion } from "./estrategias.ts";

export type FilaEstudio = {
  estrategia: string;
  agente: string;
  nombre: string;
  regla: string;
  marco: string;
  desarrollo: Medicion;
  evaluacion: Medicion;
  veredicto: string;
  monedasPositivas: number;
  monedasConOperaciones: number;
};

export const ESTUDIO_META = ${JSON.stringify(meta, null, 2)} as const;

export const ESTUDIO_FILAS: FilaEstudio[] = ${JSON.stringify(filas.map((f) => ({ ...f, desarrollo: redondo(f.desarrollo), evaluacion: redondo(f.evaluacion) })), null, 2)};
`;
writeFileSync("lib/estudio-estrategias-datos.ts", ts);

const orden = [...filas].sort((a, b) => (b.evaluacion.expectancia ?? -9) - (a.evaluacion.expectancia ?? -9));
const md = [
  "# Estudio de estrategias del AI TRADING LAB",
  "",
  `Generado el ${meta.generado} con \`scripts/investigacion/estrategias.ts\`. Velas de Binance de ${MONEDAS.length} monedas (${MONEDAS.join(", ")}), del ${meta.datosDesde} al ${meta.datosHasta}. Desarrollo hasta el ${meta.corte}; evaluación después. Costos: ${String(COSTO_PCT).replace(".", ",")} % por lado (comisión + deslizamiento supuesto). Horizonte: ${HORIZONTE} velas. Escalera de la app: si una vela toca stop y objetivo, cuenta el stop.`,
  "",
  "Cada agente tiene una estrategia clásica con parámetros fijos (no se optimizaron). El veredicto sale solo de la EVALUACIÓN: VENTAJA exige al menos 100 operaciones, el intervalo del 90 % de la expectancia entero por encima de cero y ganarle al agente de control (entradas al azar). Es una medición del pasado: no garantiza resultados futuros y no es asesoramiento financiero.",
  "",
  "## Evaluación (lo que cuenta), ordenado por expectancia",
  "",
  "| Agente | Velas | Operaciones | Acierto | TP1 | TP2 | TP3 | SL | Profit factor | Expectancia (IC 90 %) | Caída máx | Monedas + | Veredicto |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...orden.map((f) => {
    const m = f.evaluacion;
    const ic = m.expectanciaIc ? ` (${r3(m.expectanciaIc.low)} a ${r3(m.expectanciaIc.high)})` : "";
    return `| ${f.agente} | ${f.marco} | ${m.operaciones} | ${pct(m.winRate)} | ${pct(m.tasaTp1)} | ${pct(m.tasaTp2)} | ${pct(m.tasaTp3)} | ${pct(m.tasaSl)} | ${n2(m.profitFactor)} | ${r3(m.expectancia)}${ic} | ${n2(m.maxCaidaR)} R | ${f.monedasPositivas}/${f.monedasConOperaciones} | ${f.veredicto} |`;
  }),
  "",
  "## Desarrollo (para comparar: si gana acá y pierde en evaluación, no se sostiene)",
  "",
  "| Agente | Velas | Operaciones | Acierto | TP1 | TP2 | TP3 | SL | Profit factor | Expectancia |",
  "|---|---|---|---|---|---|---|---|---|---|",
  ...filas.map((f) => `| ${f.agente} | ${f.marco} | ${f.desarrollo.operaciones} | ${pct(f.desarrollo.winRate)} | ${pct(f.desarrollo.tasaTp1)} | ${pct(f.desarrollo.tasaTp2)} | ${pct(f.desarrollo.tasaTp3)} | ${pct(f.desarrollo.tasaSl)} | ${n2(f.desarrollo.profitFactor)} | ${r3(f.desarrollo.expectancia)} |`),
  "",
].join("\n");
writeFileSync("docs/estudio-estrategias.md", md);

console.log(`listo en ${((Date.now() - t0) / 1000).toFixed(1)} s · corte ${meta.corte}`);
for (const f of orden) {
  const m = f.evaluacion;
  console.log(`${f.agente.padEnd(24)} ${f.marco}  n=${String(m.operaciones).padStart(5)}  acierto ${pct(m.winRate).padStart(7)}  TP1 ${pct(m.tasaTp1).padStart(7)}  TP2 ${pct(m.tasaTp2).padStart(7)}  TP3 ${pct(m.tasaTp3).padStart(7)}  PF ${n2(m.profitFactor).padStart(5)}  exp ${r3(m.expectancia).padStart(9)}  IC [${r3(m.expectanciaIc?.low ?? null)} ; ${r3(m.expectanciaIc?.high ?? null)}]  ${f.veredicto}`);
}
