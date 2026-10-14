/**
 * El estudio de estrategias del AI TRADING LAB: cada agente mide su estrategia (lib/estrategias.ts) en las 10 monedas
 * de datos-investigacion/, con velas de 1 h y de 4 h (y de 15 min y 3 min para el gatillo MACD_MTF_SNR; la línea de tendencia también en 15 min), y con costos
 * (comisión + deslizamiento). El período se parte por
 * fecha en DESARROLLO (70 % inicial) y EVALUACIÓN (30 % final); el veredicto sale solo de la EVALUACIÓN. Escribe
 * lib/estudio-estrategias-datos.ts (lo que muestra la app) y docs/estudio-estrategias.md (la tabla para leer).
 *
 * Uso: node --experimental-strip-types scripts/investigacion/estrategias.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ESTRATEGIAS, conAuditoria, medir, operar, veredicto, type Medicion, type Operacion } from "../../lib/estrategias.ts";
import { FRACCION_EVALUACION } from "../../lib/lab-evaluacion.ts";
import { dsr, momentos, pruebaMultiple, psr } from "../../lib/sobreajuste.ts";
import type { SwingCandle } from "../../lib/swing-entries.ts";
import { DATOS } from "./util.ts";

const MONEDAS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "TRXUSDT", "BCHUSDT", "ZECUSDT"];
type Marco = { id: string; ms: number; fina: boolean };
/**
 * Las temporalidades finas (15 min y 3 min) no llevan todos los agentes, para no sumar 30 a la tabla: el gatillo MACD_MTF_SNR
 * y su control (AZAR) van en las dos, y la línea de tendencia (TENDENCIA_LINEA) también en 15 min. Sus velas empiezan en 2024-01:
 * el repositorio de 15 min empieza ahí, y las de 3 min se arman con las de 1 min de ese mismo repositorio (datos.py --tres-minutos).
 */
const MARCOS: Marco[] = [
  { id: "1h", ms: 3_600_000, fina: false },
  { id: "4h", ms: 4 * 3_600_000, fina: false },
  { id: "15m", ms: 900_000, fina: true },
  { id: "3m", ms: 180_000, fina: true },
];
/** Estrategias que se miden en cada temporalidad fina (las demás van solo en 1 h y 4 h). */
const ESTRATEGIAS_FINAS: Record<string, string[]> = {
  "15m": ["MACD_MTF_SNR", "TENDENCIA_LINEA", "AZAR"],
  "3m": ["MACD_MTF_SNR", "AZAR"],
};
/** Comisión 0,05 % + deslizamiento supuesto 0,02 %, por lado. */
const COSTO_PCT = 0.07;
const HORIZONTE = 48;
/**
 * Variantes que se miraron sobre estos mismos datos, contando las de fuera de esta tabla: la grilla SNR (128), pruebas
 * sueltas (filtros de bull run, MTF, modos de salida) y la búsqueda de confirmación y configuración de la línea de
 * tendencia (99 variantes, scripts/investigacion/linea-busqueda.ts). Lo exacto es al menos 262 (35 de la tabla, 128 de la
 * grilla SNR y 99 de la búsqueda); se redondea para arriba a propósito: subestimarlo infla la confianza.
 */
const ENSAYOS_DECLARADOS = 300;
const DIA = 86_400_000;

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
  /** Probabilidad de que el R medio por operación sea mayor que cero (PSR), y lo mismo descontando N ensayos (DSR). */
  psr: number | null;
  dsrTabla: number | null;
  dsrDeclarado: number | null;
};

const filas: Fila[] = [];
const momentosEv = new Map<number, ReturnType<typeof momentos>>();
let desde = Infinity;
let hasta = -Infinity;
let corteGlobal = 0;
const t0 = Date.now();
/** Resultado diario (suma de R de las operaciones que cerraron ese día) en EVALUACIÓN, por fila: para Reality Check y SPA. */
const diarios: { fila: number; dias: Map<number, number> }[] = [];
let primerDiaEv = Infinity;
let ultimoDiaEv = -Infinity;

for (const marco of MARCOS) {
  const velas = new Map(MONEDAS.map((s) => [s, leer(s, marco.id)]));
  for (const v of velas.values()) {
    desde = Math.min(desde, v[0].openTime);
    hasta = Math.max(hasta, v[v.length - 1].openTime);
  }
  // Un solo corte para todas las temporalidades: el 70 % del rango de las velas de 1 h (2020 a hoy), que van primero y se
  // fija antes de mirar resultados. Así la evaluación cae en la misma fecha en todas.
  if (corteGlobal === 0) corteGlobal = Math.round(desde + (hasta - desde) * (1 - FRACCION_EVALUACION));
  const corte = corteGlobal;
  const estrategias = marco.fina ? ESTRATEGIAS.filter((e) => ESTRATEGIAS_FINAS[marco.id].includes(e.id)) : ESTRATEGIAS;
  const porEstrategia = new Map<string, Operacion[]>();
  for (const e of estrategias) {
    const ops: Operacion[] = [];
    for (const [s, v] of velas) ops.push(...operar(e, s, v, { marcoMs: marco.ms, horizonte: HORIZONTE, feePct: COSTO_PCT }));
    porEstrategia.set(e.id, ops);
  }
  const control = medir((porEstrategia.get("AZAR") ?? []).filter((o) => o.abiertaA >= corte));
  for (const e of estrategias) {
    const ops = porEstrategia.get(e.id) ?? [];
    const dev = ops.filter((o) => o.abiertaA < corte);
    const ev = ops.filter((o) => o.abiertaA >= corte);
    const mEv = medir(ev);
    if (e.id !== "AZAR") {
      const dias = new Map<number, number>();
      for (const o of ev) {
        const d = Math.floor(o.cerradaA / DIA);
        dias.set(d, (dias.get(d) ?? 0) + o.r);
      }
      primerDiaEv = Math.min(primerDiaEv, Math.floor(corte / DIA));
      ultimoDiaEv = Math.max(ultimoDiaEv, Math.floor(hasta / DIA));
      diarios.push({ fila: filas.length, dias });
    }
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
      psr: null,
      dsrTabla: null,
      dsrDeclarado: null,
    });
    momentosEv.set(filas.length - 1, momentos(ev.map((o) => o.r)));
  }
}

// Auditoría de sobreajuste: la varianza de los Sharpe entre las variantes de la tabla (sin el control).
const sharpes = diarios.map((d) => momentosEv.get(d.fila)?.sharpe).filter((v): v is number => v !== undefined);
const mediaSr = sharpes.reduce((s, v) => s + v, 0) / sharpes.length;
const varSr = sharpes.reduce((s, v) => s + (v - mediaSr) ** 2, 0) / (sharpes.length - 1);
const redondo4 = (v: number) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : null);
for (const d of diarios) {
  const m = momentosEv.get(d.fila);
  if (!m) continue;
  filas[d.fila].psr = redondo4(psr(m));
  filas[d.fila].dsrTabla = redondo4(dsr(m, diarios.length, varSr));
  filas[d.fila].dsrDeclarado = redondo4(dsr(m, ENSAYOS_DECLARADOS, varSr));
  filas[d.fila].veredicto = conAuditoria(filas[d.fila].veredicto as Parameters<typeof conAuditoria>[0], filas[d.fila].dsrDeclarado);
}
const columnas = diarios.map((d) => {
  const out: number[] = [];
  for (let k = primerDiaEv; k <= ultimoDiaEv; k += 1) out.push(d.dias.get(k) ?? 0);
  return out;
});
const prueba = pruebaMultiple(columnas, { remuestreos: 5000, bloque: 10, semilla: 7 });
writeFileSync(join(DATOS, "estudio-diarios.json"), JSON.stringify({ filas: diarios.map((d) => `${filas[d.fila].estrategia}-${filas[d.fila].marco}`), columnas }));

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
  auditoria: {
    variantesTabla: diarios.length,
    ensayosDeclarados: ENSAYOS_DECLARADOS,
    varianzaSharpes: redondo4(varSr),
    diasEvaluacion: columnas[0]?.length ?? 0,
    pRealityCheck: prueba?.pRealityCheck ?? null,
    pSpa: prueba?.pSpa ?? null,
  },
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
  psr: number | null;
  dsrTabla: number | null;
  dsrDeclarado: number | null;
};

export const ESTUDIO_META = ${JSON.stringify(meta, null, 2)} as const;

export const ESTUDIO_FILAS: FilaEstudio[] = ${JSON.stringify(filas.map((f) => ({ ...f, desarrollo: redondo(f.desarrollo), evaluacion: redondo(f.evaluacion) })), null, 2)};
`;
writeFileSync("lib/estudio-estrategias-datos.ts", ts);

const orden = [...filas].sort((a, b) => (b.evaluacion.expectancia ?? -9) - (a.evaluacion.expectancia ?? -9));
const md = [
  "# Estudio de estrategias del AI TRADING LAB",
  "",
  `Generado el ${meta.generado} con \`scripts/investigacion/estrategias.ts\`. Velas de Binance de ${MONEDAS.length} monedas (${MONEDAS.join(", ")}), del ${meta.datosDesde} al ${meta.datosHasta}. Las velas de 15 min y de 3 min (MACD_MTF_SNR y su control; la línea de tendencia solo en 15 min) son del 2024-01-01 en adelante. Desarrollo hasta el ${meta.corte}; evaluación después, en la misma ventana para todas las temporalidades. Costos: ${String(COSTO_PCT).replace(".", ",")} % por lado (comisión + deslizamiento supuesto). Horizonte: ${HORIZONTE} velas de cada temporalidad (48 h en 1 h, 8 días en 4 h, 12 h en 15 min, 2,4 h en 3 min). Escalera de la app: si una vela toca stop y objetivo, cuenta el stop.`,
  "",
  "Cada agente tiene una estrategia clásica con parámetros fijos (no se optimizaron). El veredicto sale solo de la EVALUACIÓN: VENTAJA exige al menos 100 operaciones, el intervalo del 90 % de la expectancia entero por encima de cero y ganarle al agente de control (entradas al azar); si además su DSR contando todas las variantes miradas queda debajo del 95 %, baja a CANDIDATA (ver la auditoría). Es una medición del pasado: no garantiza resultados futuros y no es asesoramiento financiero.",
  "",
  "## Evaluación, ordenado por expectancia",
  "",
  "| Agente | Velas | Operaciones | Acierto | TP1 | TP2 | TP3 | SL | Profit factor | Expectancia (IC 90 %) | Caída máx | Monedas + | PSR | DSR (N tabla) | DSR (N declarado) | Veredicto |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...orden.map((f) => {
    const m = f.evaluacion;
    const ic = m.expectanciaIc ? ` (${r3(m.expectanciaIc.low)} a ${r3(m.expectanciaIc.high)})` : "";
    return `| ${f.agente} | ${f.marco} | ${m.operaciones} | ${pct(m.winRate)} | ${pct(m.tasaTp1)} | ${pct(m.tasaTp2)} | ${pct(m.tasaTp3)} | ${pct(m.tasaSl)} | ${n2(m.profitFactor)} | ${r3(m.expectancia)}${ic} | ${n2(m.maxCaidaR)} R | ${f.monedasPositivas}/${f.monedasConOperaciones} | ${pct(f.psr)} | ${pct(f.dsrTabla)} | ${pct(f.dsrDeclarado)} | ${f.veredicto} |`;
  }),
  "",
  "## Auditoría de sobreajuste",
  "",
  `PSR: probabilidad de que el R medio por operación sea mayor que cero, descontando asimetría y colas gordas. DSR: lo mismo, pero contra el mejor resultado que se esperaría solo por azar al elegir entre N variantes (Bailey y López de Prado). N tabla = ${meta.auditoria.variantesTabla} variantes de esta tabla; N declarado = ${ENSAYOS_DECLARADOS}, que suma la grilla SNR (128), pruebas sueltas y la búsqueda de confirmación y configuración de la línea de tendencia (99, en docs/busqueda-linea.md), sobre los mismos datos. Un DSR menor a 95 % no alcanza para decir que hay ventaja.`,
  "",
  `Reality Check de White y SPA de Hansen sobre el resultado diario de las ${meta.auditoria.variantesTabla} variantes en evaluación (${meta.auditoria.diasEvaluacion} días, bootstrap estacionario, 5.000 remuestreos, bloques de 10 días): p = ${n2(meta.auditoria.pRealityCheck)} (Reality Check) y p = ${n2(meta.auditoria.pSpa)} (SPA). La pregunta que responden: ¿alguna variante le gana a no operar, contando que se eligió la mejor entre todas? Con p menor a 0,05 la respuesta es sí.`,
  "",
  "Advertencia: la evaluación ya se miró al diseñar las variantes (la MTF + Volumen nació después de ver el Supertrend). Ningún número de esta tabla es una prueba limpia: la única es la medición hacia adelante del agente en papel. El Agente Línea de tendencia (TENDENCIA_LINEA) se mide con parámetros fijos: pivotes de 5 velas, ruptura de 0,1 ATR, stop a 1,5 ATR, objetivo de 2 R y sin confirmación. Se mide en 1 h, 4 h y 15 min. Después se buscó su mejor confirmación y configuración con reglas de desarrollo (docs/busqueda-linea.md); esas variantes ya cuentan en el N declarado.",
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
