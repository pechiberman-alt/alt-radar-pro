/**
 * La búsqueda de la mejor confirmación y configuración de la ruptura de línea de tendencia (TENDENCIA_LINEA, lib/linea-busqueda.ts)
 * en 1 h, 4 h y 15 min, con las 10 monedas de datos-investigacion/ y los costos del estudio (0,07 % por lado). Fase 1: las 7
 * confirmaciones con la configuración base (5 velas, stop 1,5 ATR, 2 R). Fase 2: las 26 configuraciones nuevas de la grilla
 * (3 × 3 × 3) con la confirmación elegida en la fase 1. Todo se elige con el DESARROLLO (70 % inicial); la EVALUACIÓN se mira
 * después. La auditoría (DSR, Reality Check y SPA) cuenta todas las variantes. Escribe docs/busqueda-linea.md. Es una medición
 * del pasado: no garantiza resultados futuros y no es asesoramiento financiero.
 *
 * Uso: node --experimental-strip-types scripts/investigacion/linea-busqueda.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { conAuditoria, ESTRATEGIAS, indicadores, medir, MUESTRA_ESTUDIO, operar, operarSenales, veredicto, type Medicion, type Operacion, type Veredicto } from "../../lib/estrategias.ts";
import {
  CONFIGURACION_BASE,
  CONFIRMACIONES,
  DESCRIPCION_CONFIRMACION,
  esCandidata,
  etiquetaConfiguracion,
  grilla,
  masAltoPiso,
  mejorEnDesarrollo,
  mismaConfiguracion,
  mitadesDesarrollo,
  pisoIc,
  senalesLinea,
  type Candidata,
  type Configuracion,
  type Confirmacion,
} from "../../lib/linea-busqueda.ts";
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
/** Los mismos costos y horizonte que el estudio (scripts/investigacion/estrategias.ts). */
const COSTO_PCT = 0.07;
const HORIZONTE = 48;
const DIA = 86_400_000;
/** Variantes distintas por temporalidad: 7 confirmaciones + 26 configuraciones nuevas (la base con la confirmación elegida ya cuenta). */
const POR_MARCO = CONFIRMACIONES.length + (grilla().length - 1);
/** Todas las variantes de esta búsqueda: 33 en cada una de las 3 temporalidades. */
const ENSAYOS_BUSQUEDA = POR_MARCO * MARCOS.length;
/**
 * El N declarado del estudio (scripts/investigacion/estrategias.ts): 200 que ya se declaraban antes de esta búsqueda, más
 * estas 99, redondeado para arriba (lo exacto es al menos 262). Subestimarlo infla la confianza.
 */
const ENSAYOS_DECLARADOS = 300;

function leer(symbol: string, marco: string): SwingCandle[] {
  const raw = JSON.parse(readFileSync(join(DATOS, `${symbol}-${marco}.json`), "utf8")) as number[][];
  return raw.map(([openTime, open, high, low, close, volume]) => ({ openTime, open, high, low, close, volume }) as SwingCandle);
}

/** Una variante: su medición en desarrollo (total y por mitad) y en evaluación, con las operaciones de evaluación. */
type Variante = Candidata & { confirmacion: Confirmacion; cfg: Configuracion; ev: Medicion; evOps: Operacion[] };

function evaluar(ops: Operacion[], desde: number, corte: number, confirmacion: Confirmacion, cfg: Configuracion): Variante {
  const dev = ops.filter((o) => o.abiertaA < corte);
  const ev = ops.filter((o) => o.abiertaA >= corte);
  const [m1, m2] = mitadesDesarrollo(dev, desde, corte);
  return { confirmacion, cfg, dev: medir(dev), mitades: [medir(m1), medir(m2)], ev: medir(ev), evOps: ev };
}

// Corte: el mismo del estudio, el 70 % del rango de las velas de 1 h de las 10 monedas (se fija antes de mirar resultados).
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

type Fila = {
  marco: string;
  desde: number;
  fase1: Variante[];
  fase2: Variante[];
  elegidaFase1: Variante;
  elegida: Variante;
  estable: boolean;
  controlEv: Medicion;
  veredictoBruto: Veredicto;
};

const t0 = Date.now();
const filas: Fila[] = [];
const familia: Variante[] = [];
let desdeGlobal = Infinity;
let hastaGlobal = -Infinity;

for (const marco of MARCOS) {
  const datos = MONEDAS.map((s) => {
    const v = leer(s, marco.id);
    return { s, v, ind: indicadores(v) };
  });
  const desde = Math.min(...datos.map((d) => d.v[0].openTime));
  const hasta = Math.max(...datos.map((d) => d.v[d.v.length - 1].openTime));
  desdeGlobal = Math.min(desdeGlobal, desde);
  hastaGlobal = Math.max(hastaGlobal, hasta);
  const opciones = { marcoMs: marco.ms, horizonte: HORIZONTE, feePct: COSTO_PCT };
  const correr = (c: Confirmacion, cfg: Configuracion): Operacion[] =>
    datos.flatMap(({ s, v, ind }) => operarSenales("TENDENCIA_LINEA", s, v, senalesLinea(v, ind, c, cfg), opciones));

  // Fase 1: las confirmaciones, con la configuración base. Se elige la mejor con el desarrollo.
  const fase1 = CONFIRMACIONES.map((c) => evaluar(correr(c, CONFIGURACION_BASE), desde, corte, c, CONFIGURACION_BASE));
  const elegidaFase1 = mejorEnDesarrollo(fase1) ?? masAltoPiso(fase1);
  if (!elegidaFase1) throw new Error("sin confirmaciones que medir");

  // Fase 2: la grilla de configuraciones con esa confirmación. La base con ella ya está medida en la fase 1.
  const c1 = elegidaFase1.confirmacion;
  const fase2 = grilla().map((cfg) => (mismaConfiguracion(cfg, CONFIGURACION_BASE) ? elegidaFase1 : evaluar(correr(c1, cfg), desde, corte, c1, cfg)));
  const elegida = mejorEnDesarrollo(fase2) ?? masAltoPiso(fase2);
  if (!elegida) throw new Error("sin configuraciones que medir");

  const controlEv = medir(datos.flatMap(({ s, v }) => operar(control, s, v, opciones)).filter((o) => o.abiertaA >= corte));
  familia.push(...fase1, ...fase2.filter((v) => v !== elegidaFase1));
  filas.push({
    marco: marco.id,
    desde,
    fase1,
    fase2,
    elegidaFase1,
    elegida,
    estable: esCandidata(elegida),
    controlEv,
    veredictoBruto: veredicto(elegida.ev, controlEv),
  });
  console.log(`${marco.id}: fase 1 con ${c1}, fase 2 con ${fase2.length} configuraciones · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

if (familia.length !== ENSAYOS_BUSQUEDA) throw new Error(`la familia tiene ${familia.length} variantes, se esperaban ${ENSAYOS_BUSQUEDA}`);

// Auditoría: la varianza de los Sharpe entre todas las variantes de la búsqueda (por operación, como en el estudio).
const sharpes = familia.map((v) => momentos(v.evOps.map((o) => o.r))?.sharpe).filter((x): x is number => x !== undefined && Number.isFinite(x));
const mediaSr = sharpes.reduce((s, x) => s + x, 0) / sharpes.length;
const varSr = sharpes.reduce((s, x) => s + (x - mediaSr) ** 2, 0) / (sharpes.length - 1);

// Reality Check y SPA sobre el resultado diario en evaluación de las 99 variantes (la regla de la app: no operar = 0).
const corteDia = Math.floor(corte / DIA);
const ultimoDia = Math.floor(hastaGlobal / DIA);
const columnas = familia.map((v) => {
  const dias = new Map<number, number>();
  for (const o of v.evOps) {
    const d = Math.floor(o.cerradaA / DIA);
    dias.set(d, (dias.get(d) ?? 0) + o.r);
  }
  const out: number[] = [];
  for (let k = corteDia; k <= ultimoDia; k += 1) out.push(dias.get(k) ?? 0);
  return out;
});
const prueba = pruebaMultiple(columnas, { remuestreos: 5000, bloque: 10, semilla: 7 });

const redondo4 = (v: number) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : null);
const auditoria = filas.map((f) => {
  const m = momentos(f.elegida.evOps.map((o) => o.r));
  return {
    psr: m ? redondo4(psr(m)) : null,
    dsrBusqueda: m ? redondo4(dsr(m, ENSAYOS_BUSQUEDA, varSr)) : null,
    dsrDeclarado: m ? redondo4(dsr(m, ENSAYOS_DECLARADOS, varSr)) : null,
  };
});
const veredictos = filas.map((f, k) => conAuditoria(f.veredictoBruto, auditoria[k].dsrDeclarado));

// ── El documento ──

const dia = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")} %`);
const num = (v: number | null) => (v === null ? "—" : v.toFixed(2).replace(".", ","));
const r3 = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(3).replace(".", ",")} R`);
const ic = (m: Medicion) => (m.expectanciaIc ? `${r3(m.expectanciaIc.low)} a ${r3(m.expectanciaIc.high)}` : "—");
const mitades = (c: Candidata) => c.mitades.map((m) => r3(m.expectancia)).join(" / ");
const etiqueta = (c: Variante) => `**${c.confirmacion}**`;

function tablaFase1(f: Fila): string[] {
  return [
    "| Confirmación | Operaciones (desarrollo) | Acierto | Profit factor | Expectancia (IC 90 %) | Mitades del desarrollo | Operaciones (evaluación) | Expectancia (IC 90 %) | Estable |",
    "|---|---|---|---|---|---|---|---|---|",
    ...f.fase1.map((v) => {
      const nombre = v.confirmacion === f.elegidaFase1.confirmacion ? etiqueta(v) : v.confirmacion;
      return `| ${nombre} | ${v.dev.operaciones} | ${pct(v.dev.winRate)} | ${num(v.dev.profitFactor)} | ${r3(v.dev.expectancia)} (${ic(v.dev)}) | ${mitades(v)} | ${v.ev.operaciones} | ${r3(v.ev.expectancia)} (${ic(v.ev)}) | ${esCandidata(v) ? "sí" : "no"} |`;
    }),
  ];
}

function tablaFase2(f: Fila): string[] {
  return [
    "| Configuración | Operaciones (desarrollo) | Acierto | Profit factor | Expectancia (IC 90 %) | Mitades del desarrollo | Operaciones (evaluación) | Expectancia (IC 90 %) | Estable |",
    "|---|---|---|---|---|---|---|---|---|",
    ...f.fase2.map((v) => {
      const nombre = v === f.elegida ? `**${etiquetaConfiguracion(v.cfg)}**` : etiquetaConfiguracion(v.cfg);
      return `| ${nombre} | ${v.dev.operaciones} | ${pct(v.dev.winRate)} | ${num(v.dev.profitFactor)} | ${r3(v.dev.expectancia)} (${ic(v.dev)}) | ${mitades(v)} | ${v.ev.operaciones} | ${r3(v.ev.expectancia)} (${ic(v.ev)}) | ${esCandidata(v) ? "sí" : "no"} |`;
    }),
  ];
}

// Para transparencia: la mejor expectancia en evaluación entre todas las variantes. No es un resultado (la regla eligió con el
// desarrollo) y la evaluación ya se miró: se muestra como dato, con el Reality Check que corrige por la búsqueda.
const conMarco = filas.flatMap((f) => [...f.fase1, ...f.fase2].map((v) => ({ v, marco: f.marco })));
const mejorEv = conMarco
  .filter((x) => x.v.ev.operaciones >= MUESTRA_ESTUDIO && x.v.ev.expectancia !== null)
  .reduce<{ v: Variante; marco: string } | null>((a, b) => (!a || (b.v.ev.expectancia ?? -Infinity) > (a.v.ev.expectancia ?? -Infinity) ? b : a), null);
const lineaTransparencia = mejorEv
  ? [
      `- **Para transparencia**: entre las ${ENSAYOS_BUSQUEDA} variantes, la de mejor expectancia en evaluación es ${etiqueta(mejorEv.v)} con ${etiquetaConfiguracion(mejorEv.v.cfg)} en ${mejorEv.marco} (${mejorEv.v.ev.operaciones} operaciones, expectancia ${r3(mejorEv.v.ev.expectancia)}, IC ${ic(mejorEv.v.ev)}). ${filas.some((f) => f.elegida === mejorEv.v) ? "Es la que eligió la regla de desarrollo." : "No es la que eligió la regla de desarrollo, y como la evaluación ya se miró, se muestra como dato y no como resultado."} Con las ${ENSAYOS_BUSQUEDA} variantes, el Reality Check da p = ${num(prueba?.pRealityCheck ?? null)} y el SPA p = ${num(prueba?.pSpa ?? null)}: ${(prueba?.pSpa ?? 1) < 0.05 ? "alcanza" : "no alcanza"} para distinguirla de la suerte (el SPA es el más confiable cuando las variantes tienen varianzas distintas).`,
    ]
  : [];

const resumen = filas.flatMap((f, k) => {
  const e = f.elegida;
  const a = auditoria[k];
  const cuenta = e.ev.operaciones < 100 ? "muestra chica" : `${e.ev.operaciones} operaciones`;
  if (!f.estable) {
    return [
      `- **${f.marco}**: ninguna configuración es estable en el desarrollo. La de mayor piso del intervalo es ${etiqueta(e)} con ${etiquetaConfiguracion(e.cfg)}, y queda marcada como no estable. En evaluación: ${cuenta}, expectancia ${r3(e.ev.expectancia)} (IC ${ic(e.ev)}), veredicto ${veredictos[k]}.`,
    ];
  }
  return [
    `- **${f.marco}**: ${etiqueta(e)} con ${etiquetaConfiguracion(e.cfg)}. En desarrollo, ${e.dev.operaciones} operaciones con expectancia ${r3(e.dev.expectancia)} (IC ${ic(e.dev)}). En evaluación: ${cuenta}, expectancia ${r3(e.ev.expectancia)} (IC ${ic(e.ev)}), acierto ${pct(e.ev.winRate)}, profit factor ${num(e.ev.profitFactor)}. DSR con N = ${ENSAYOS_BUSQUEDA}: ${pct(a.dsrBusqueda)}. Veredicto: ${veredictos[k]}.`,
  ];
});

const md = [
  "# Búsqueda de confirmación y configuración: línea de tendencia",
  "",
  `Generado el ${dia(Date.now())} con \`scripts/investigacion/linea-busqueda.ts\`. Velas de Binance de ${MONEDAS.length} monedas (${MONEDAS.join(", ")}) en 1 h, 4 h y 15 min, del ${dia(desdeGlobal)} al ${dia(hastaGlobal)}. Desarrollo hasta el ${dia(corte)}, evaluación después: el mismo corte que el estudio (\`docs/estudio-estrategias.md\`). Costos: ${String(COSTO_PCT).replace(".", ",")} % por lado. Horizonte: ${HORIZONTE} velas. Escalera de la app: si una vela toca stop y objetivo, cuenta el stop.`,
  "",
  "## Qué se buscó",
  "",
  "Una ruptura de línea de tendencia (TENDENCIA_LINEA: dos pivotes, una línea que el precio respeta entre ambos y un cierre que la pasa por 0,1 ATR) tiene dos decisiones: qué confirmación exige y qué configuración usa.",
  "",
  "- **Fase 1, confirmaciones** (con la configuración base: pivotes de 5 velas, stop a 1,5 ATR, objetivo a 2 R):",
  ...CONFIRMACIONES.map((c) => `  - **${c}**: ${DESCRIPCION_CONFIRMACION[c]}`),
  "- **Fase 2, configuraciones** (con la confirmación elegida en la fase 1): pivotes de 3, 5 u 8 velas × stop de 1, 1,5 o 2 ATR × objetivo de 1,5, 2 o 3 R. Son 27; la base ya está en la fase 1.",
  "- **Elección**: solo con el DESARROLLO. Candidata = al menos 100 operaciones y expectancia positiva en cada mitad del desarrollo (con 30 o más en cada una). Entre las candidatas, gana la de piso más alto del intervalo del 90 % de la expectancia. Si ninguna es candidata, se muestra la de piso más alto, marcada como no estable.",
  `- **Contabilidad**: ${POR_MARCO} variantes distintas por temporalidad, ${ENSAYOS_BUSQUEDA} en total. El DSR de esta búsqueda cuenta esas ${ENSAYOS_BUSQUEDA}; el declarado del estudio pasa a ${ENSAYOS_DECLARADOS} (200 de antes, más estas 99, redondeado para arriba).`,
  "",
  "## Cómo leerlo",
  "",
  "- Todo lo de desarrollo se eligió sin mirar la evaluación. Pero **la evaluación ya se había mirado**: el estudio anterior midió TENDENCIA_LINEA (la configuración base, sin confirmación) en 1 h, 4 h y 15 min. Los números de evaluación de esta búsqueda no son una prueba limpia.",
  "- La búsqueda es **escalonada**: la confirmación se elige con la base y después se busca la configuración. Una búsqueda conjunta (7 × 27 por temporalidad) podría dar otra combinación, y contaría más variantes.",
  "- Los umbrales (volumen de 1,5 veces, cierre en el 30 % del rango, 30 velas de retesteo, 0,3 ATR) son fijos: no se afinaron. Cambiarlos sería otra variante, y entraría en la cuenta.",
  "- Los intervalos son del 90 %: media ± 1,645 errores estándar de la expectancia. Un intervalo que cruza cero no da conclusión.",
  "- Es una medición del pasado, con costos. No garantiza resultados futuros y no es asesoramiento financiero. La única prueba limpia es la medición hacia adelante en papel, que todavía no existe para esta variante.",
  "",
  "## Resumen por temporalidad",
  "",
  ...resumen,
  ...lineaTransparencia,
  "",
  "## Auditoría de sobreajuste",
  "",
  `Variantes de la búsqueda: ${ENSAYOS_BUSQUEDA}. Ensayos declarados del estudio: ${ENSAYOS_DECLARADOS}. Varianza de los Sharpe por operación entre las ${ENSAYOS_BUSQUEDA} variantes en evaluación: ${(redondo4(varSr) ?? 0).toFixed(4).replace(".", ",")}. Días de evaluación: ${columnas[0]?.length ?? 0}.`,
  "",
  "| Temporalidad | Elegida | PSR (evaluación) | DSR (N = búsqueda) | DSR (N declarado) | Veredicto |",
  "|---|---|---|---|---|---|",
  ...filas.map((f, k) => `| ${f.marco} | ${f.elegida.confirmacion} · ${etiquetaConfiguracion(f.elegida.cfg)} | ${pct(auditoria[k].psr)} | ${pct(auditoria[k].dsrBusqueda)} | ${pct(auditoria[k].dsrDeclarado)} | ${veredictos[k]} |`),
  "",
  `Reality Check de White y SPA de Hansen sobre el resultado diario en evaluación de las ${ENSAYOS_BUSQUEDA} variantes (bootstrap estacionario, 5.000 remuestreos, bloques de 10 días): p = ${num(prueba?.pRealityCheck ?? null)} (Reality Check) y p = ${num(prueba?.pSpa ?? null)} (SPA). La pregunta: ¿alguna variante le gana a no operar, contando que se eligió la mejor entre todas? Con p menor a 0,05 la respuesta es sí. Como la evaluación ya se miró, esto corrige por la búsqueda pero no por esa mirada previa.`,
  "",
  "Un DSR menor a 95 % no alcanza para decir que hay ventaja. Una VENTAJA con DSR declarado menor a 95 % baja a CANDIDATA.",
  "",
  ...filas.flatMap((f) => [
    `## ${f.marco}: fase 1, confirmaciones (configuración base)`,
    "",
    ...tablaFase1(f),
    "",
    `## ${f.marco}: fase 2, configuraciones (con ${f.elegidaFase1.confirmacion})`,
    "",
    ...tablaFase2(f),
    "",
    `Control (entradas al azar, mismas fechas de evaluación): ${r3(f.controlEv.expectancia)} sobre ${f.controlEv.operaciones} operaciones.`,
    "",
  ]),
].join("\n");
writeFileSync("docs/busqueda-linea.md", md);

console.log(`listo en ${((Date.now() - t0) / 1000).toFixed(1)} s · corte ${dia(corte)} · variantes ${ENSAYOS_BUSQUEDA}`);
for (const [k, f] of filas.entries()) {
  const e = f.elegida;
  console.log(
    `${f.marco.padEnd(4)} confirmación ${e.confirmacion.padEnd(16)} ${etiquetaConfiguracion(e.cfg).padEnd(44)} estable ${f.estable ? "sí" : "no"}  dev n=${e.dev.operaciones} exp ${r3(e.dev.expectancia)} piso ${pisoIc(e.dev).toFixed(3)}  |  ev n=${e.ev.operaciones} exp ${r3(e.ev.expectancia)} IC [${ic(e.ev)}]  DSR ${pct(auditoria[k].dsrBusqueda)}  ${veredictos[k]}`,
  );
}
console.log(`Reality Check p=${num(prueba?.pRealityCheck ?? null)} · SPA p=${num(prueba?.pSpa ?? null)}`);
