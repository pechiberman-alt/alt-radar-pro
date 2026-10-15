/**
 * Mide los agentes del estudio sobre ORO (XAUUSD.c de Axi, CFD), con las mismas reglas, la misma escalera y el mismo corte
 * 70/30 que el estudio de cripto. NO se mezcla con cripto: es otro mercado, con su precio, su spread y su horario, y por eso
 * tiene su propia tabla y su propio número de ensayos.
 *
 * Datos: datos-investigacion/XAUUSDAXI-4h.json, bajado de la cuenta de Axi con get_mt5_candles (velas de 4 h ya cerradas).
 * Es un solo instrumento: no hay «en cuántas monedas ganó» que sirva de contraste, así que una ventaja acá se apoya en menos
 * evidencia que la misma ventaja en diez monedas. Está dicho en la salida.
 *
 * Uso: node --experimental-strip-types scripts/investigacion/oro.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ESTRATEGIAS, conAuditoria, medir, operar, veredicto, type Medicion, type Operacion } from "../../lib/estrategias.ts";
import { FRACCION_EVALUACION } from "../../lib/lab-evaluacion.ts";
import { dsr, momentos, psr } from "../../lib/sobreajuste.ts";
import type { SwingCandle } from "../../lib/swing-entries.ts";
import { DATOS } from "./util.ts";

const SIMBOLO = "XAUUSDAXI";
const MARCO_MS = 4 * 3_600_000;
const HORIZONTE = 48;
/**
 * Costo por lado. El spread observado en las velas de Axi fue de 17 puntos sobre un precio de ~4.100 (0,004 %), así que
 * 0,02 % por lado cubre el spread con margen para deslizamiento. Se mide también a 0,07 % (el costo del estudio de cripto)
 * para ver cuánto del resultado aguanta un costo más duro: si una ventaja desaparece ahí, era del costo y no de la regla.
 */
const COSTOS = [0.02, 0.07];
/**
 * Ensayos declarados para la corrección por múltiples pruebas: las 20 estrategias medidas acá, por los 2 costos, más las 620
 * que ya se habían mirado sobre los datos de cripto. Se suman porque las reglas vienen de aquella búsqueda: si solo se
 * contaran las de esta tabla, la corrección quedaría corta y la confianza inflada.
 */
const ENSAYOS_DECLARADOS = 620 + ESTRATEGIAS.length * COSTOS.length;

const velas = (JSON.parse(readFileSync(join(DATOS, `${SIMBOLO}-4h.json`), "utf8")) as number[][]).map(
  ([openTime, open, high, low, close, volume]) => ({ openTime, open, high, low, close, volume }) as SwingCandle,
);

const desde = velas[0].openTime;
const hasta = velas[velas.length - 1].openTime;
const corte = Math.round(desde + (hasta - desde) * (1 - FRACCION_EVALUACION));
const fecha = (t: number) => new Date(t).toISOString().slice(0, 10);

const n2 = (v: number | null) => (v === null ? "—" : v.toFixed(2).replace(".", ","));
const r3 = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(3).replace(".", ",")}`);
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")} %`);

console.log(`ORO · XAUUSD.c (Axi, CFD) · velas de 4 h`);
console.log(`${velas.length} velas, del ${fecha(desde)} al ${fecha(hasta)}. Desarrollo hasta ${fecha(corte)}; evaluación después.`);
console.log(`Un solo instrumento: no hay contraste entre varios activos, así que una ventaja acá se apoya en menos evidencia.\n`);

type Fila = { agente: string; costo: number; ev: Medicion; des: Medicion; ver: string; psr: number | null; dsr: number | null };
const filas: Fila[] = [];

for (const costo of COSTOS) {
  const porEstrategia = new Map<string, Operacion[]>();
  for (const e of ESTRATEGIAS) porEstrategia.set(e.id, operar(e, SIMBOLO, velas, { marcoMs: MARCO_MS, horizonte: HORIZONTE, feePct: costo }));
  const control = porEstrategia.get("AZAR") ?? [];
  const evControl = medir(control.filter((o) => o.abiertaA >= corte));

  // La corrección por haber probado muchas variantes necesita cuánto se dispersan los Sharpe ENTRE variantes (sin el control).
  const momentosPorId = new Map<string, ReturnType<typeof momentos>>();
  for (const e of ESTRATEGIAS) momentosPorId.set(e.id, momentos((porEstrategia.get(e.id) ?? []).filter((o) => o.abiertaA >= corte).map((o) => o.r)));
  const sharpes = ESTRATEGIAS.filter((e) => e.id !== "AZAR")
    .map((e) => momentosPorId.get(e.id)?.sharpe)
    .filter((v): v is number => v !== undefined && Number.isFinite(v));
  const mediaSr = sharpes.reduce((s, v) => s + v, 0) / sharpes.length;
  const varSr = sharpes.length > 1 ? sharpes.reduce((s, v) => s + (v - mediaSr) ** 2, 0) / (sharpes.length - 1) : 0;

  for (const e of ESTRATEGIAS) {
    const ops = porEstrategia.get(e.id) ?? [];
    const des = medir(ops.filter((o) => o.abiertaA < corte));
    const ev = medir(ops.filter((o) => o.abiertaA >= corte));
    const m = momentosPorId.get(e.id) ?? null;
    const p = m ? psr(m) : null;
    const d = m ? dsr(m, ENSAYOS_DECLARADOS, varSr) : null;
    // El veredicto simple baja a CANDIDATA si la corrección por las variantes miradas no lo sostiene.
    const ver = e.id === "AZAR" ? "CONTROL" : conAuditoria(veredicto(ev, evControl), d);
    filas.push({ agente: e.agente, costo, ev, des, ver, psr: p, dsr: d });
  }
}

for (const costo of COSTOS) {
  console.log(`\n── Costo ${String(costo).replace(".", ",")} % por lado ──`);
  console.log("agente".padEnd(42) + "oper.  acierto     PF   R/oper.   IC 90%                   PSR    DSR   veredicto");
  for (const f of filas.filter((x) => x.costo === costo).sort((a, b) => (b.ev.expectancia ?? -9) - (a.ev.expectancia ?? -9))) {
    const ic = f.ev.expectanciaIc ? `[${r3(f.ev.expectanciaIc.low)} ; ${r3(f.ev.expectanciaIc.high)}]` : "sin dato";
    console.log(
      f.agente.padEnd(42) +
        String(f.ev.operaciones).padStart(5) +
        pct(f.ev.winRate).padStart(9) +
        n2(f.ev.profitFactor).padStart(7) +
        r3(f.ev.expectancia).padStart(9) +
        "  " +
        ic.padEnd(24) +
        pct(f.psr).padStart(7) +
        pct(f.dsr).padStart(7) +
        "  " +
        f.ver,
    );
  }
}

const conVentaja = filas.filter((f) => f.ver === "VENTAJA");
console.log(`\nEnsayos declarados para la corrección: ${ENSAYOS_DECLARADOS} (620 de cripto + ${ESTRATEGIAS.length} agentes × ${COSTOS.length} costos acá).`);
console.log(`Con ventaja según la regla simple: ${conVentaja.length}. Un DSR por debajo de 95 % quiere decir que ese resultado no se distingue del mejor que daría el azar probando tantas variantes.`);
console.log("Medición del pasado sobre un solo instrumento: no garantiza resultados futuros y no es asesoramiento financiero.");
