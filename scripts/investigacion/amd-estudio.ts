/**
 * Medición del agente AMD + IFVG (lib/amd-ifvg.ts, PLAN_AMD_1) con parámetros fijados antes de mirar: las 10 monedas de
 * datos-investigacion/ en 1 h, 4 h y 15 min, con los costos y el horizonte del estudio (0,07 % por lado, 48 velas) y el mismo
 * corte 70/30. Es fractal: la MISMA regla en las tres temporalidades, sin ajustar nada por marco. Compara contra el control al
 * azar y contra el resto de los agentes del estudio; el DSR cuenta los ensayos ya declarados más estos. Escribe docs/busqueda-amd.md.
 * Es una medición del pasado: no garantiza resultados futuros y no es asesoramiento financiero.
 *
 * Uso: node --experimental-strip-types scripts/investigacion/amd-estudio.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RANGO_MAX_ATR, RANGO_N, VENTANA_AMD, PATA_PREVIA, MARGEN_AMD_ATR, RR_AMD } from "../../lib/amd-ifvg.ts";
import { conAuditoria, ESTRATEGIAS, medir, operar, veredicto, type Medicion, type Operacion } from "../../lib/estrategias.ts";
import { FRACCION_EVALUACION } from "../../lib/lab-evaluacion.ts";
import { dsr, momentos, psr } from "../../lib/sobreajuste.ts";
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
/** Los 550 que ya declaraba el estudio (docs/busqueda-smc.md) más las 3 temporalidades de esta medición, redondeado para arriba. */
const ENSAYOS_DECLARADOS = 560;
const SIN_VOLUMEN = new Set<string>();

function leer(symbol: string, marco: string): SwingCandle[] {
  const raw = JSON.parse(readFileSync(join(DATOS, `${symbol}-${marco}.json`), "utf8")) as number[][];
  return raw.map(([openTime, open, high, low, close, volume]) => ({ openTime, open, high, low, close, volume }) as SwingCandle);
}

// El corte del estudio: el 70 % del rango de las velas de 1 h de las 10 monedas.
let d1 = Infinity;
let h1 = -Infinity;
for (const s of MONEDAS) {
  const v = leer(s, "1h");
  d1 = Math.min(d1, v[0].openTime);
  h1 = Math.max(h1, v[v.length - 1].openTime);
}
const corte = Math.round(d1 + (h1 - d1) * (1 - FRACCION_EVALUACION));
const fecha = (t: number) => new Date(t).toISOString().slice(0, 10);
const r3 = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(3).replace(".", ",")}`);
const n2 = (v: number | null) => (v === null ? "—" : v.toFixed(2).replace(".", ","));
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")} %`);
const ic = (m: Medicion) => (m.expectanciaIc ? `${r3(m.expectanciaIc.low)} a ${r3(m.expectanciaIc.high)}` : "—");

type Fila = { marco: string; des: Medicion; ev: Medicion; control: Medicion; ver: string; psr: number | null; dsr: number | null; rango: string };
const filas: Fila[] = [];
const amd = ESTRATEGIAS.find((e) => e.id === "AMD_IFVG");
if (!amd) throw new Error("falta AMD_IFVG en ESTRATEGIAS");
const t0 = Date.now();

for (const marco of MARCOS) {
  const opciones = { marcoMs: marco.ms, horizonte: HORIZONTE, feePct: COSTO_PCT };
  const porId = new Map<string, Operacion[]>();
  let desde = Infinity;
  let hasta = -Infinity;
  for (const s of MONEDAS) {
    const v = leer(s, marco.id);
    desde = Math.min(desde, v[0].openTime);
    hasta = Math.max(hasta, v[v.length - 1].openTime);
    for (const e of ESTRATEGIAS) {
      if (SIN_VOLUMEN.has(e.id)) continue;
      porId.set(e.id, [...(porId.get(e.id) ?? []), ...operar(e, s, v, opciones)]);
    }
  }
  const ops = porId.get("AMD_IFVG") ?? [];
  const control = medir((porId.get("AZAR") ?? []).filter((o) => o.abiertaA >= corte));
  const ev = medir(ops.filter((o) => o.abiertaA >= corte));
  // Dispersión de los Sharpe de evaluación entre los agentes (sin el control), para el DSR.
  const sharpes = [...porId.entries()]
    .filter(([id]) => id !== "AZAR")
    .map(([, o]) => momentos(o.filter((x) => x.abiertaA >= corte).map((x) => x.r))?.sharpe)
    .filter((x): x is number => x !== undefined && Number.isFinite(x));
  const media = sharpes.reduce((a, b) => a + b, 0) / sharpes.length;
  const varSr = sharpes.reduce((a, b) => a + (b - media) ** 2, 0) / Math.max(1, sharpes.length - 1);
  const m = momentos(ops.filter((o) => o.abiertaA >= corte).map((o) => o.r));
  const d = m ? dsr(m, ENSAYOS_DECLARADOS, varSr) : null;
  filas.push({
    marco: marco.id,
    des: medir(ops.filter((o) => o.abiertaA < corte)),
    ev,
    control,
    ver: conAuditoria(veredicto(ev, control), d),
    psr: m ? psr(m) : null,
    dsr: d,
    rango: `${fecha(desde)} a ${fecha(hasta)}`,
  });
  console.log(`${marco.id}: ${ops.length} operaciones (${Math.round((Date.now() - t0) / 1000)} s)`);
}

const linea = (f: Fila, m: Medicion) =>
  `| ${f.marco} | ${m.operaciones} | ${pct(m.winRate)} | ${n2(m.profitFactor)} | ${r3(m.expectancia)} | ${ic(m)} |`;

const md = `# Agente AMD + IFVG: medición con la regla fijada de antemano

Generado el ${fecha(Date.now())} con \`scripts/investigacion/amd-estudio.ts\`. Regla: \`lib/amd-ifvg.ts\` (${"PLAN_AMD_1"}). Velas de Binance de 10 monedas (${MONEDAS.join(", ")}) en 1 h, 4 h y 15 min. Desarrollo hasta el ${fecha(corte)}, evaluación después (el corte del estudio). Costos: ${String(COSTO_PCT).replace(".", ",")} % por lado. Horizonte: ${HORIZONTE} velas. Escalera de la app: si una vela toca stop y objetivo, cuenta el stop.

## La regla (no se buscó: los números se fijaron antes de medir)

- **Acumulación**: las ${RANGO_N} velas anteriores forman un rango de ${RANGO_MAX_ATR} ATR de alto o menos.
- **Manipulación**: una vela barre un solo lado del rango. Solo cuenta la primera barrida de una racha.
- **Última pata**: un hueco de valor justo en contra, formado desde ${PATA_PREVIA} velas antes de la barrida, que una vela cierra por el otro lado (IFVG) dentro de las ${VENTANA_AMD} velas siguientes, con el cierre de vuelta adentro del rango.
- **Operación**: entra a la apertura siguiente. Stop a ${String(MARGEN_AMD_ATR).replace(".", ",")} ATR del extremo de la manipulación. Objetivo ${RR_AMD} R. No opera si el stop queda a más de 4 ATR.
- **Fractal**: la misma regla en las tres temporalidades, sin cambiar ningún número.

## Evaluación (el tramo que decide)

| Marco | n | Acierto | PF | E[R] | IC 90 % |
|---|---|---|---|---|---|
${filas.map((f) => linea(f, f.ev)).join("\n")}

| Marco | Control al azar E[R] | Veredicto | PSR | DSR (${ENSAYOS_DECLARADOS} ensayos) |
|---|---|---|---|---|
${filas.map((f) => `| ${f.marco} | ${r3(f.control.expectancia)} (n=${f.control.operaciones}) | ${f.ver} | ${n2(f.psr)} | ${n2(f.dsr)} |`).join("\n")}

## Desarrollo

| Marco | n | Acierto | PF | E[R] | IC 90 % |
|---|---|---|---|---|---|
${filas.map((f) => linea(f, f.des)).join("\n")}

## Cómo leerlo

- E[R] es la ganancia media por operación en R, neta de costos. Un intervalo que cruza cero no da conclusión.
- El período de evaluación ya se miró con otras estrategias del estudio: no es una prueba limpia, y el DSR cuenta ${ENSAYOS_DECLARADOS} ensayos por eso.
- La regla viene de un video (AMD e IFVG de la última pata). No se ajustó con estos datos; la única corrección antes de medir fue que solo cuente la primera barrida de una racha, que encontró una prueba.
- Oro de Axi (XAUUSD.c, 4 h): el agente entra solo en \`scripts/investigacion/axi-estudio.ts\`. Al 2026-10-20 dio 17 operaciones en evaluación (+0,34 R a 0,07 % por lado, intervalo de −0,22 a +0,90): muestra chica, sin conclusión.\n- La única prueba limpia es la medición hacia adelante en papel, que arranca cuando el agente se enciende (en papel corre en 4 h, como todos los agentes, sobre cripto, oro y plata).
- Es una medición del pasado, con costos. No garantiza resultados futuros y no es asesoramiento financiero.
`;
writeFileSync("docs/busqueda-amd.md", md);
console.log(md);
