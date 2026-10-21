/**
 * Medición de la mesa de flujo (lib/flujo-agentes.ts, PLAN_FLUJO_AGENTES_1) en el historial: los tres agentes que se leen con
 * velas y volumen (ABSORCION, ESFUERZO, BARRIDA_VOL), con los números fijados antes de mirar, en las 10 monedas de
 * datos-investigacion/ en 1 h, 4 h y 15 min, con los costos y el horizonte del estudio (0,07 % por lado, 48 velas) y el mismo
 * corte 70/30. Los dos de delta (DELTA_DIV, DELTA_ABSORBIDO) no se pueden medir acá: el historial no trae el volumen agresor;
 * se miden solo hacia adelante, en papel. Compara contra el control al azar; el DSR cuenta los ensayos ya declarados más estos.
 * Escribe docs/busqueda-flujo.md. Es una medición del pasado: no garantiza resultados futuros y no es asesoramiento financiero.
 *
 * Uso: node --experimental-strip-types scripts/investigacion/flujo-estudio.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { conAuditoria, ESTRATEGIAS, medir, operar, veredicto, type Medicion, type Operacion } from "../../lib/estrategias.ts";
import { CIERRE_ABSORCION, MARGEN_FLUJO_ATR, RANGO_ESFUERZO_ATR, RR_FLUJO, TRAMO_ESFUERZO, TRAMO_ESFUERZO_ATR, VENTANA_EXTREMO, VOL_ABSORCION, VOL_BARRIDA, VOL_ESFUERZO } from "../../lib/flujo-agentes.ts";
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
const AGENTES = ["ABSORCION", "ESFUERZO", "BARRIDA_VOL"] as const;
/** Los 570 de las mediciones anteriores (docs/busqueda-amd.md) más 3 agentes en 3 temporalidades, redondeado para arriba. */
const ENSAYOS_DECLARADOS = 580;

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
const coma = (x: number) => String(x).replace(".", ",");
const r3 = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(3).replace(".", ",")}`);
const n2 = (v: number | null) => (v === null ? "—" : v.toFixed(2).replace(".", ","));
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")} %`);
const ic = (m: Medicion) => (m.expectanciaIc ? `${r3(m.expectanciaIc.low)} a ${r3(m.expectanciaIc.high)}` : "—");

type Fila = { agente: string; marco: string; des: Medicion; ev: Medicion; ver: string; psr: number | null; dsr: number | null; largos: Medicion; cortos: Medicion };
const filas: Fila[] = [];
const controles: { marco: string; m: Medicion; rango: string }[] = [];
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
    for (const e of ESTRATEGIAS) porId.set(e.id, [...(porId.get(e.id) ?? []), ...operar(e, s, v, opciones)]);
  }
  const control = medir((porId.get("AZAR") ?? []).filter((o) => o.abiertaA >= corte));
  controles.push({ marco: marco.id, m: control, rango: `${fecha(desde)} a ${fecha(hasta)}` });
  // Dispersión de los Sharpe de evaluación entre los agentes (sin el control ni los de delta, que acá no operan), para el DSR.
  const sharpes = [...porId.entries()]
    .filter(([id]) => id !== "AZAR" && id !== "DELTA_DIV" && id !== "DELTA_ABSORBIDO")
    .map(([, o]) => momentos(o.filter((x) => x.abiertaA >= corte).map((x) => x.r))?.sharpe)
    .filter((x): x is number => x !== undefined && Number.isFinite(x));
  const media = sharpes.reduce((a, b) => a + b, 0) / sharpes.length;
  const varSr = sharpes.reduce((a, b) => a + (b - media) ** 2, 0) / Math.max(1, sharpes.length - 1);
  for (const id of AGENTES) {
    const ops = porId.get(id) ?? [];
    const evOps = ops.filter((o) => o.abiertaA >= corte);
    const ev = medir(evOps);
    const m = momentos(evOps.map((o) => o.r));
    const d = m ? dsr(m, ENSAYOS_DECLARADOS, varSr) : null;
    filas.push({
      agente: id,
      marco: marco.id,
      des: medir(ops.filter((o) => o.abiertaA < corte)),
      ev,
      ver: conAuditoria(veredicto(ev, control), d),
      psr: m ? psr(m) : null,
      dsr: d,
      largos: medir(evOps.filter((o) => o.lado === "LONG")),
      cortos: medir(evOps.filter((o) => o.lado === "SHORT")),
    });
  }
  for (const id of ["DELTA_DIV", "DELTA_ABSORBIDO"]) {
    if ((porId.get(id) ?? []).length) throw new Error(`${id} operó sin volumen agresor: revisar lib/flujo-agentes.ts`);
  }
  console.log(`${marco.id}: listo (${Math.round((Date.now() - t0) / 1000)} s)`);
}

const linea = (f: Fila, m: Medicion) => `| ${f.agente} | ${f.marco} | ${m.operaciones} | ${pct(m.winRate)} | ${n2(m.profitFactor)} | ${r3(m.expectancia)} | ${ic(m)} |`;

const md = `# Mesa de flujo: medición con las reglas fijadas de antemano

Generado el ${fecha(Date.now())} con \`scripts/investigacion/flujo-estudio.ts\`. Reglas: \`lib/flujo-agentes.ts\` (PLAN_FLUJO_AGENTES_1). Velas de Binance de 10 monedas (${MONEDAS.join(", ")}) en 1 h, 4 h y 15 min. Desarrollo hasta el ${fecha(corte)}, evaluación después (el corte del estudio). Costos: ${coma(COSTO_PCT)} % por lado. Horizonte: ${HORIZONTE} velas. Escalera de la app: si una vela toca stop y objetivo, cuenta el stop.

## Las reglas (no se buscaron: los números se fijaron antes de medir)

- **Absorción (ABSORCION)**: la vela hace el mínimo (o máximo) de las ${VENTANA_EXTREMO} anteriores con ${VOL_ABSORCION} veces el volumen promedio y cierra a más del ${Math.round(CIERRE_ABSORCION * 100)} % de su rango lejos de ese extremo.
- **Esfuerzo sin resultado (ESFUERZO)**: después de un tramo de ${TRAMO_ESFUERZO_ATR} ATR en ${TRAMO_ESFUERZO} velas, una vela con ${coma(VOL_ESFUERZO)} veces el volumen promedio y un rango de ${coma(RANGO_ESFUERZO_ATR)} ATR o menos que cierra en la mitad contraria al tramo. Entra en contra del tramo.
- **Barrida con volumen (BARRIDA_VOL)**: la vela pasa el mínimo (o máximo) de las ${VENTANA_EXTREMO} anteriores con ${coma(VOL_BARRIDA)} veces el volumen promedio y cierra de vuelta adentro.
- **Operación**: entra a la apertura siguiente. Stop a ${coma(MARGEN_FLUJO_ATR)} ATR del extremo. Objetivo ${RR_FLUJO} R.
- **Delta (DELTA_DIV, DELTA_ABSORBIDO)**: necesitan el volumen agresor comprador de cada vela, que este historial no trae. No se miden acá: solo hacia adelante, en papel, con las velas de Binance del navegador.

## Evaluación (el tramo que decide)

| Agente | Marco | n | Acierto | PF | E[R] | IC 90 % |
|---|---|---|---|---|---|---|
${filas.map((f) => linea(f, f.ev)).join("\n")}

| Agente | Marco | Control al azar E[R] | Veredicto | PSR | DSR (${ENSAYOS_DECLARADOS} ensayos) |
|---|---|---|---|---|---|
${filas.map((f) => `| ${f.agente} | ${f.marco} | ${r3(controles.find((c) => c.marco === f.marco)?.m.expectancia ?? null)} (n=${controles.find((c) => c.marco === f.marco)?.m.operaciones ?? 0}) | ${f.ver} | ${n2(f.psr)} | ${n2(f.dsr)} |`).join("\n")}

## Evaluación por lado

| Agente | Marco | Largos n | Largos E[R] | Cortos n | Cortos E[R] |
|---|---|---|---|---|---|
${filas.map((f) => `| ${f.agente} | ${f.marco} | ${f.largos.operaciones} | ${r3(f.largos.expectancia)} | ${f.cortos.operaciones} | ${r3(f.cortos.expectancia)} |`).join("\n")}

## Desarrollo

| Agente | Marco | n | Acierto | PF | E[R] | IC 90 % |
|---|---|---|---|---|---|---|
${filas.map((f) => linea(f, f.des)).join("\n")}

Rangos de datos: ${controles.map((c) => `${c.marco} ${c.rango}`).join("; ")}.

## Cómo leerlo

- E[R] es la ganancia media por operación en R, neta de costos. Un intervalo que cruza cero no da conclusión.
- El período de evaluación ya se miró con otras estrategias del estudio: no es una prueba limpia, y el DSR cuenta ${ENSAYOS_DECLARADOS} ensayos por eso.
- Las reglas son lecturas clásicas del flujo de órdenes (absorción, esfuerzo contra resultado, barrida de stops). No se ajustaron con estos datos y no se van a ajustar para mejorar estos números: una versión nueva lleva otro PLAN y se mide al lado.
- ESFUERZO casi no dispara con sus números (un tramo de 2 ATR en 5 velas, rango chico y volumen 2,5 veces mayor rara vez coinciden): sus pocas operaciones no dicen nada. No se aflojan los números mirando estos resultados; una versión que dispare más va como PLAN nuevo y se mide al lado.
- El volumen de una vela no dice quién agredió: estas tres leen el esfuerzo con el volumen total. Las dos de delta sí lo dicen, y por eso solo se pueden medir hacia adelante.
- La única prueba limpia es la medición hacia adelante en papel, que arranca cuando los agentes se encienden (en papel corren en 4 h, como todos).
- Es una medición del pasado, con costos. No garantiza resultados futuros y no es asesoramiento financiero.
`;
writeFileSync("docs/busqueda-flujo.md", md);
console.log(md);
