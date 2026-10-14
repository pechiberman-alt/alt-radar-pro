/**
 * La búsqueda de la mejor configuración del agente Fibonacci + niveles clave (lib/fibonacci-niveles.ts) en 1 h, 4 h y 15 min, con
 * las 10 monedas de datos-investigacion/ y los costos del estudio (0,07 % por lado). Son 18 configuraciones por temporalidad:
 * zona de retroceso (0,5–0,618, 0,618–0,786 o 0,5–0,786) × extensión objetivo (1, 1,272 o 1,618) × con o sin nivel clave. Se elige
 * solo con el DESARROLLO (70 % inicial); la EVALUACIÓN se mira después. La auditoría (DSR, Reality Check y SPA) cuenta todas las
 * variantes. Escribe docs/busqueda-fibonacci.md. Es una medición del pasado: no garantiza resultados futuros y no es
 * asesoramiento financiero.
 *
 * Uso: node --experimental-strip-types scripts/investigacion/fib-busqueda.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { conAuditoria, ESTRATEGIAS, indicadores, medir, MUESTRA_ESTUDIO, operar, operarSenales, veredicto, type Medicion, type Operacion, type Veredicto } from "../../lib/estrategias.ts";
import { CONFIGURACION_AGENTE_FIB, etiquetaConfiguracionFib, grillaFib, senalesFib, type ConfiguracionFib } from "../../lib/fibonacci-niveles.ts";
import { esCandidata, masAltoPiso, mejorEnDesarrollo, mitadesDesarrollo, pisoIc, type Candidata } from "../../lib/linea-busqueda.ts";
import { FRACCION_EVALUACION } from "../../lib/lab-evaluacion.ts";
import { dsr, momentos, pruebaMultiple, psr } from "../../lib/sobreajuste.ts";
import type { SwingCandle } from "../../lib/swing-entries.ts";
import { DATOS } from "./util.ts";

const MONEDAS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "TRXUSDT", "BCHUSDT", "ZECUSDT"];
const MARCOS = [
  { id: "1h", ms: 3_600_000 },
  { id: "4h", ms: 4 * 3_600_000 },
  { id: "15m", ms: 900_000 },
];
const COSTO_PCT = 0.07;
const HORIZONTE = 48;
const DIA = 86_400_000;
const GRILLA = grillaFib();
/** Las 18 de la grilla más el agente con su escalera propia (TP1 1, TP2 1,272, TP3 1,618), que no está en la grilla. */
const ENSAYOS_BUSQUEDA = (GRILLA.length + 1) * MARCOS.length;
/**
 * El N declarado del estudio (scripts/investigacion/estrategias.ts) con esta búsqueda: 469 que ya se contaban como mínimo, más
 * estas 57, redondeado para arriba (lo exacto es al menos 526). Subestimarlo infla la confianza.
 */
const ENSAYOS_DECLARADOS = 600;

function leer(symbol: string, marco: string): SwingCandle[] {
  const raw = JSON.parse(readFileSync(join(DATOS, `${symbol}-${marco}.json`), "utf8")) as number[][];
  return raw.map(([openTime, open, high, low, close, volume]) => ({ openTime, open, high, low, close, volume }) as SwingCandle);
}

type Variante = Candidata & { cfg: ConfiguracionFib; ev: Medicion; evOps: Operacion[] };
function evaluar(ops: Operacion[], desde: number, corte: number, cfg: ConfiguracionFib): Variante {
  const dev = ops.filter((o) => o.abiertaA < corte);
  const ev = ops.filter((o) => o.abiertaA >= corte);
  const [m1, m2] = mitadesDesarrollo(dev, desde, corte);
  return { cfg, dev: medir(dev), mitades: [medir(m1), medir(m2)], ev: medir(ev), evOps: ev };
}

let desde1h = Infinity;
let hasta1h = -Infinity;
for (const s of MONEDAS) {
  const v = leer(s, "1h");
  desde1h = Math.min(desde1h, v[0].openTime);
  hasta1h = Math.max(hasta1h, v[v.length - 1].openTime);
}
const corte = Math.round(desde1h + (hasta1h - desde1h) * (1 - FRACCION_EVALUACION));
const control = ESTRATEGIAS.find((e) => e.id === "AZAR");
if (!control) throw new Error("falta el agente de control AZAR");

type Fila = { marco: string; variantes: Variante[]; agente: Variante; elegida: Variante; estable: boolean; controlEv: Medicion; veredictoBruto: Veredicto };
const filas: Fila[] = [];
const t0 = Date.now();
let hastaGlobal = -Infinity;
for (const marco of MARCOS) {
  const datos = MONEDAS.map((s) => {
    const v = leer(s, marco.id);
    return { s, v, ind: indicadores(v) };
  });
  const desde = Math.min(...datos.map((d) => d.v[0].openTime));
  hastaGlobal = Math.max(hastaGlobal, ...datos.map((d) => d.v[d.v.length - 1].openTime));
  const opciones = { marcoMs: marco.ms, horizonte: HORIZONTE, feePct: COSTO_PCT };
  const variantes = GRILLA.map((cfg) => evaluar(datos.flatMap(({ s, v, ind }) => operarSenales("FIB_NIVELES", s, v, senalesFib(v, ind.atr14, cfg), opciones)), desde, corte, cfg));
  const elegida = mejorEnDesarrollo(variantes) ?? masAltoPiso(variantes);
  const agente = evaluar(datos.flatMap(({ s, v, ind }) => operarSenales("FIB_NIVELES", s, v, senalesFib(v, ind.atr14, CONFIGURACION_AGENTE_FIB), opciones)), desde, corte, CONFIGURACION_AGENTE_FIB);
  if (!elegida) throw new Error("sin variantes que medir");
  const controlEv = medir(datos.flatMap(({ s, v }) => operar(control, s, v, opciones)).filter((o) => o.abiertaA >= corte));
  filas.push({ marco: marco.id, variantes, agente, elegida, estable: esCandidata(elegida), controlEv, veredictoBruto: veredicto(elegida.ev, controlEv) });
  console.log(`${marco.id}: ${variantes.length} configuraciones · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

const familia = filas.flatMap((f) => [...f.variantes, f.agente]);
if (familia.length !== ENSAYOS_BUSQUEDA) throw new Error(`la familia tiene ${familia.length} variantes, se esperaban ${ENSAYOS_BUSQUEDA}`);
const sharpes = familia.map((v) => momentos(v.evOps.map((o) => o.r))?.sharpe).filter((x): x is number => x !== undefined && Number.isFinite(x));
const mediaSr = sharpes.reduce((s, x) => s + x, 0) / sharpes.length;
const varSr = sharpes.reduce((s, x) => s + (x - mediaSr) ** 2, 0) / (sharpes.length - 1);
const corteDia = Math.floor(corte / DIA);
const ultimoDia = Math.floor(hastaGlobal / DIA);
const columnas = familia.map((v) => {
  const dias = new Map<number, number>();
  for (const o of v.evOps) dias.set(Math.floor(o.cerradaA / DIA), (dias.get(Math.floor(o.cerradaA / DIA)) ?? 0) + o.r);
  const out: number[] = [];
  for (let k = corteDia; k <= ultimoDia; k += 1) out.push(dias.get(k) ?? 0);
  return out;
});
const prueba = pruebaMultiple(columnas, { remuestreos: 5000, bloque: 10, semilla: 7 });
const redondo4 = (v: number) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : null);
const auditoria = filas.map((f) => {
  const m = momentos(f.elegida.evOps.map((o) => o.r));
  return { psr: m ? redondo4(psr(m)) : null, dsrBusqueda: m ? redondo4(dsr(m, ENSAYOS_BUSQUEDA, varSr)) : null, dsrDeclarado: m ? redondo4(dsr(m, ENSAYOS_DECLARADOS, varSr)) : null };
});
const veredictos = filas.map((f, k) => conAuditoria(f.veredictoBruto, auditoria[k].dsrDeclarado));

const dia = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")} %`);
const num = (v: number | null) => (v === null ? "—" : v.toFixed(2).replace(".", ","));
const r3 = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(3).replace(".", ",")} R`);
const ic = (m: Medicion) => (m.expectanciaIc ? `${r3(m.expectanciaIc.low)} a ${r3(m.expectanciaIc.high)}` : "—");
const mitades = (c: Candidata) => c.mitades.map((m) => r3(m.expectancia)).join(" / ");
const cuenta = (m: Medicion) => (m.operaciones < MUESTRA_ESTUDIO ? `${m.operaciones} (muestra chica)` : String(m.operaciones));

const resumen = filas.flatMap((f, k) => {
  const e = f.elegida;
  const a = f.agente;
  const base = `El agente (configuración fijada de antemano, ${etiquetaConfiguracionFib(a.cfg)}): ${cuenta(a.ev)} operaciones en evaluación, acierto ${pct(a.ev.winRate)}, profit factor ${num(a.ev.profitFactor)}, expectancia ${r3(a.ev.expectancia)} (IC ${ic(a.ev)}).`;
  const elegida = f.estable
    ? `La regla de desarrollo eligió ${etiquetaConfiguracionFib(e.cfg)}: ${e.dev.operaciones} operaciones en desarrollo con ${r3(e.dev.expectancia)} (IC ${ic(e.dev)}); en evaluación ${cuenta(e.ev)} operaciones, acierto ${pct(e.ev.winRate)}, profit factor ${num(e.ev.profitFactor)}, expectancia ${r3(e.ev.expectancia)} (IC ${ic(e.ev)}), DSR con N = ${ENSAYOS_BUSQUEDA}: ${pct(auditoria[k].dsrBusqueda)}. Veredicto: ${veredictos[k]}.`
    : `Ninguna configuración es estable en el desarrollo; la de mayor piso es ${etiquetaConfiguracionFib(e.cfg)} (marcada no estable): en evaluación ${cuenta(e.ev)} operaciones, expectancia ${r3(e.ev.expectancia)} (IC ${ic(e.ev)}), veredicto ${veredictos[k]}.`;
  return [`- **${f.marco}**: ${elegida} ${base}`];
});

const tabla = (f: Fila): string[] => [
  "| Configuración | Operaciones (desarrollo) | Acierto | Profit factor | Expectancia (IC 90 %) | Mitades del desarrollo | Operaciones (evaluación) | Acierto | Profit factor | Expectancia (IC 90 %) | Estable |",
  "|---|---|---|---|---|---|---|---|---|---|---|",
  ...[...f.variantes, f.agente].map((v) => {
    const nombre = v === f.elegida ? `**${etiquetaConfiguracionFib(v.cfg)}**` : v === f.agente ? `*${etiquetaConfiguracionFib(v.cfg)}* (agente)` : etiquetaConfiguracionFib(v.cfg);
    return `| ${nombre} | ${v.dev.operaciones} | ${pct(v.dev.winRate)} | ${num(v.dev.profitFactor)} | ${r3(v.dev.expectancia)} (${ic(v.dev)}) | ${mitades(v)} | ${cuenta(v.ev)} | ${pct(v.ev.winRate)} | ${num(v.ev.profitFactor)} | ${r3(v.ev.expectancia)} (${ic(v.ev)}) | ${esCandidata(v) ? "sí" : "no"} |`;
  }),
];

const md = [
  "# Búsqueda de configuración: Fibonacci + extensión + niveles clave",
  "",
  `Generado el ${dia(Date.now())} con \`scripts/investigacion/fib-busqueda.ts\`. Velas de Binance de ${MONEDAS.length} monedas (${MONEDAS.join(", ")}) en 1 h, 4 h y 15 min, del ${dia(desde1h)} al ${dia(hastaGlobal)}. Desarrollo hasta el ${dia(corte)}, evaluación después: el mismo corte del estudio (\`docs/estudio-estrategias.md\`). Costos: ${String(COSTO_PCT).replace(".", ",")} % por lado. Horizonte: ${HORIZONTE} velas. Escalera de la app: si una vela toca stop y objetivo, cuenta el stop.`,
  "",
  "## Qué se midió",
  "",
  "Se toma la última pierna de impulso (de un pivote de 5 velas al siguiente de signo contrario, de al menos 2 ATR; se conoce al confirmarse el pivote y vive 80 velas o hasta que el precio la rompe). Se espera el retroceso a la zona de Fibonacci y se entra en la primera vela que la toca y cierra a favor, sin cerrar más allá de la zona. Stop a 0,25 ATR del origen de la pierna (si queda a más de 4 ATR no se opera). Objetivo: la extensión de la pierna (1 = volver al extremo del impulso; 1,272 y 1,618 más allá). Con nivel clave, además, el máximo o el mínimo del día o de la semana anteriores (UTC) tiene que caer dentro de la zona, a 0,25 ATR o menos. Una señal por pierna.",
  "",
  "- **Grilla** (18 por temporalidad): zona 0,5–0,618, 0,618–0,786 o 0,5–0,786 × extensión 1, 1,272 o 1,618 × con o sin nivel clave.",
  "- **El agente** se fijó de antemano con la convención clásica (bolsillo dorado 0,618–0,786, con nivel clave) y su escalera propia: TP1 en la extensión 1 (volver al extremo del impulso), TP2 en 1,272 y TP3 en 1,618; el TP3 es el objetivo que se mide. No se eligió con estos resultados y no está en la grilla (que tiene un solo objetivo con TP1 y TP2 a un tercio y dos tercios): es la variante 19 de cada temporalidad.",
  "- **Elección** (solo con el DESARROLLO): candidata = al menos 100 operaciones y expectancia positiva en cada mitad del desarrollo (con 30 o más en cada una); gana el piso más alto del intervalo del 90 %. Sin candidatas, se muestra la de piso más alto, marcada como no estable.",
  `- **Contabilidad**: ${GRILLA.length} de la grilla más el agente, ${GRILLA.length + 1} por temporalidad y ${ENSAYOS_BUSQUEDA} en total; el DSR de la búsqueda cuenta esas ${ENSAYOS_BUSQUEDA}; el declarado del estudio pasa a ${ENSAYOS_DECLARADOS} (469 de antes como mínimo, más estas 57, redondeado para arriba).`,
  "",
  "## Cómo leerlo",
  "",
  "- Todo lo de desarrollo se eligió sin mirar la evaluación, pero **el período de evaluación ya se miró** con otras estrategias y búsquedas: los números de evaluación no son una prueba limpia.",
  "- Los umbrales (pivotes de 5, pierna de 2 ATR, vida de 80, margen de 0,25 ATR, tolerancia de 0,25 ATR, riesgo máximo de 4 ATR) son fijos: no se afinaron.",
  "- La detección es propia y causal: no usa los detectores del gráfico, que miran velas posteriores. Los niveles clave son del día y la semana ya cerrados.",
  "- Los intervalos son del 90 %. Un intervalo que cruza cero no da conclusión. Es una medición del pasado, con costos; no garantiza resultados futuros y no es asesoramiento financiero.",
  "",
  "## Resumen por temporalidad",
  "",
  ...resumen,
  "",
  "## Auditoría de sobreajuste",
  "",
  `Variantes de la búsqueda: ${ENSAYOS_BUSQUEDA}. Ensayos declarados del estudio: ${ENSAYOS_DECLARADOS}. Varianza de los Sharpe por operación entre las variantes en evaluación: ${(redondo4(varSr) ?? 0).toFixed(4).replace(".", ",")}.`,
  "",
  "| Temporalidad | Elegida | PSR (evaluación) | DSR (N = búsqueda) | DSR (N declarado) | Veredicto |",
  "|---|---|---|---|---|---|",
  ...filas.map((f, k) => `| ${f.marco} | ${etiquetaConfiguracionFib(f.elegida.cfg)} | ${pct(auditoria[k].psr)} | ${pct(auditoria[k].dsrBusqueda)} | ${pct(auditoria[k].dsrDeclarado)} | ${veredictos[k]} |`),
  "",
  `Reality Check de White y SPA de Hansen sobre el resultado diario en evaluación de las ${ENSAYOS_BUSQUEDA} variantes (bootstrap estacionario, 5.000 remuestreos, bloques de 10 días): p = ${num(prueba?.pRealityCheck ?? null)} (Reality Check) y p = ${num(prueba?.pSpa ?? null)} (SPA). La pregunta: ¿alguna variante le gana a no operar, contando que se eligió la mejor entre todas? Con p menor a 0,05 la respuesta es sí.`,
  "",
  ...filas.flatMap((f) => [`## ${f.marco}: las 18 configuraciones y el agente`, "", ...tabla(f), "", `Control (entradas al azar, mismas fechas de evaluación): ${r3(f.controlEv.expectancia)} sobre ${f.controlEv.operaciones} operaciones.`, ""]),
].join("\n");
writeFileSync("docs/busqueda-fibonacci.md", md);
console.log(`listo en ${((Date.now() - t0) / 1000).toFixed(1)} s · variantes ${ENSAYOS_BUSQUEDA} · corte ${dia(corte)}`);
for (const [k, f] of filas.entries()) {
  const a = f.agente;
  console.log(`${f.marco.padEnd(4)} agente: ev n=${a.ev.operaciones} acierto ${pct(a.ev.winRate)} PF ${num(a.ev.profitFactor)} exp ${r3(a.ev.expectancia)} IC [${ic(a.ev)}] | elegida ${etiquetaConfiguracionFib(f.elegida.cfg)} estable ${f.estable ? "sí" : "no"} dev n=${f.elegida.dev.operaciones} piso ${pisoIc(f.elegida.dev).toFixed(3)} | ev n=${f.elegida.ev.operaciones} exp ${r3(f.elegida.ev.expectancia)} PF ${num(f.elegida.ev.profitFactor)} ${veredictos[k]}`);
}
console.log(`Reality Check p=${num(prueba?.pRealityCheck ?? null)} · SPA p=${num(prueba?.pSpa ?? null)}`);
