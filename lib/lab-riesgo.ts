/**
 * El gestor de riesgo central del AI TRADING LAB: una sola compuerta para toda operación simulada, en el motor de papel
 * del navegador y en la API del servidor (no solo en la pantalla). Límites por operación, exposición, pérdida del día,
 * drawdown, por activo, por estrategia, cantidad de posiciones y reglas del stop. Si se pasa un límite, frena y dice por qué.
 * Los límites los pone la persona dentro de topes fijos: ningún agente los cambia ni apaga la compuerta. Pura.
 */

export type LimitesRiesgo = {
  /** Riesgo máximo por operación, en % del capital. */
  riesgoMaxPct: number;
  /** Operaciones abiertas o pendientes a la vez. */
  maxPosiciones: number;
  /** Riesgo abierto total, en R (cada operación arriesga 1 R). */
  exposicionMaxR: number;
  /** Pérdida neta del día (UTC) que suspende operaciones nuevas, en R. */
  perdidaDiariaMaxR: number;
  /** Caída desde el pico de la curva que suspende operaciones nuevas, en R. */
  drawdownMaxR: number;
  maxPorActivo: number;
  maxPorEstrategia: number;
  /** R:R mínimo del plan. */
  rrMinimo: number;
};

export const LIMITES_DEFECTO: Readonly<LimitesRiesgo> = Object.freeze({
  riesgoMaxPct: 1,
  maxPosiciones: 5,
  exposicionMaxR: 5,
  perdidaDiariaMaxR: 3,
  drawdownMaxR: 10,
  maxPorActivo: 1,
  maxPorEstrategia: 5,
  rrMinimo: 1.5,
});

/** Lo más permisivo que se puede configurar. Más allá no se puede ir, ni desde la pantalla ni desde un agente. */
export const TOPES: Readonly<Record<keyof LimitesRiesgo, { min: number; max: number }>> = Object.freeze({
  riesgoMaxPct: { min: 0.1, max: 2 },
  maxPosiciones: { min: 1, max: 20 },
  exposicionMaxR: { min: 1, max: 10 },
  perdidaDiariaMaxR: { min: 0.5, max: 6 },
  drawdownMaxR: { min: 1, max: 20 },
  maxPorActivo: { min: 1, max: 3 },
  maxPorEstrategia: { min: 1, max: 20 },
  rrMinimo: { min: 1, max: 5 },
});

/** Lo que llega (de la pantalla o de la red) llevado a los topes; lo que falta o no es número queda en el valor por defecto. */
export function normalizarLimites(raw: unknown): Readonly<LimitesRiesgo> {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = { ...LIMITES_DEFECTO } as LimitesRiesgo;
  for (const k of Object.keys(TOPES) as (keyof LimitesRiesgo)[]) {
    const v = o[k];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const { min, max } = TOPES[k];
    out[k] = Math.min(max, Math.max(min, v));
  }
  return Object.freeze(out);
}

export type Propuesta = {
  symbol: string;
  lado: "LONG" | "SHORT";
  /** Quién la propone: "MESA", el nombre de un agente o de una variante. */
  estrategia: string;
  entrada: number;
  stop: number;
  rrPlan: number;
  /** Riesgo por operación en % del capital; null si no se sabe (no se supone). */
  riesgoPct: number | null;
};

export type OperacionCartera = {
  symbol: string;
  lado: "LONG" | "SHORT";
  estrategia: string;
  estado: "PENDIENTE" | "ABIERTA" | "CERRADA" | "CANCELADA";
  resultadoR: number | null;
  cerradaA: number | null;
};

export type EstadoCartera = {
  abiertas: number;
  exposicionR: number;
  perdidaHoyR: number;
  drawdownR: number;
  suspendida: boolean;
  motivoSuspension: string | null;
};

export type Veredicto = { ok: boolean; motivos: string[]; cartera: EstadoCartera };

const DIA = 86_400_000;
const viva = (o: OperacionCartera) => o.estado === "ABIERTA" || o.estado === "PENDIENTE";
const r2 = (v: number) => v.toFixed(2).replace(".", ",");

/** Cómo está la cartera simulada ahora: abiertas, pérdida del día y caída desde el pico, y si eso suspende operaciones nuevas. */
export function estadoCartera(ops: OperacionCartera[], lim: LimitesRiesgo, ahora: number): EstadoCartera {
  const abiertas = ops.filter(viva).length;
  const inicioDia = Math.floor(ahora / DIA) * DIA;
  const cerradas = ops
    .filter((o) => o.estado === "CERRADA" && o.resultadoR !== null && Number.isFinite(o.resultadoR) && o.cerradaA !== null && o.cerradaA <= ahora)
    .sort((a, b) => (a.cerradaA as number) - (b.cerradaA as number));
  const perdidaHoyR = Math.max(0, -cerradas.filter((o) => (o.cerradaA as number) >= inicioDia).reduce((s, o) => s + (o.resultadoR as number), 0));
  let acum = 0;
  let pico = 0;
  let drawdownR = 0;
  for (const o of cerradas) {
    acum += o.resultadoR as number;
    pico = Math.max(pico, acum);
    drawdownR = Math.max(drawdownR, pico - acum);
  }
  // La caída que cuenta para suspender es la de ahora, no la peor de la historia: si la curva ya se recuperó, se puede seguir.
  const caidaActual = pico - acum;
  const motivoSuspension =
    perdidaHoyR >= lim.perdidaDiariaMaxR
      ? `la pérdida de hoy (${r2(perdidaHoyR)} R) llegó al límite diario de ${r2(lim.perdidaDiariaMaxR)} R`
      : caidaActual >= lim.drawdownMaxR
        ? `la caída desde el pico (${r2(caidaActual)} R) llegó al límite de ${r2(lim.drawdownMaxR)} R`
        : null;
  return { abiertas, exposicionR: abiertas, perdidaHoyR, drawdownR, suspendida: motivoSuspension !== null, motivoSuspension };
}

/** La compuerta: una propuesta simulada pasa solo si cumple todos los límites. Devuelve cada motivo de rechazo. */
export function evaluarPropuesta(p: Propuesta, ops: OperacionCartera[], limRaw: unknown, ahora: number): Veredicto {
  const lim = normalizarLimites(limRaw);
  const cartera = estadoCartera(ops, lim, ahora);
  const motivos: string[] = [];
  if (cartera.suspendida) motivos.push(`Operaciones nuevas suspendidas: ${cartera.motivoSuspension}.`);
  const precios = [p.entrada, p.stop].every((x) => typeof x === "number" && Number.isFinite(x) && x > 0);
  if (!precios) motivos.push("El plan no trae entrada y stop válidos.");
  else if ((p.lado === "LONG" && p.stop >= p.entrada) || (p.lado === "SHORT" && p.stop <= p.entrada)) motivos.push("El stop está del lado equivocado de la entrada.");
  if (!(typeof p.rrPlan === "number" && p.rrPlan >= lim.rrMinimo)) motivos.push(`El R:R del plan no llega al mínimo de ${r2(lim.rrMinimo)}.`);
  if (p.riesgoPct === null || !Number.isFinite(p.riesgoPct)) motivos.push("No se sabe el riesgo por operación: sin ese dato no se abre.");
  else if (p.riesgoPct > lim.riesgoMaxPct) motivos.push(`Arriesga ${r2(p.riesgoPct)} % por operación y el límite es ${r2(lim.riesgoMaxPct)} %.`);
  const vivas = ops.filter(viva);
  if (vivas.length >= lim.maxPosiciones) motivos.push(`Ya hay ${vivas.length} posiciones abiertas o pendientes (límite ${lim.maxPosiciones}).`);
  if (cartera.exposicionR + 1 > lim.exposicionMaxR) motivos.push(`El riesgo abierto pasaría de ${r2(lim.exposicionMaxR)} R.`);
  if (vivas.some((o) => o.symbol === p.symbol && o.lado === p.lado)) motivos.push(`Ya hay una operación ${p.lado} de ${p.symbol} abierta: no se duplica.`);
  else if (vivas.filter((o) => o.symbol === p.symbol).length >= lim.maxPorActivo) motivos.push(`${p.symbol} ya tiene ${lim.maxPorActivo} posición(es), el límite por activo.`);
  if (vivas.filter((o) => o.estrategia === p.estrategia).length >= lim.maxPorEstrategia) motivos.push(`La estrategia ${p.estrategia} llegó a su límite de ${lim.maxPorEstrategia} posiciones.`);
  return { ok: motivos.length === 0, motivos, cartera };
}

/** Una operación de papel de la mesa (lib/jarvis-paper.ts) como la ve el gestor: la mesa es su estrategia. */
export function operacionDePapel(t: {
  symbol: string;
  lado: "LONG" | "SHORT";
  estado: OperacionCartera["estado"];
  resultadoR: number | null;
  cerradaA: number | null;
}, estrategia = "MESA"): OperacionCartera {
  return { symbol: t.symbol, lado: t.lado, estrategia, estado: t.estado, resultadoR: t.resultadoR, cerradaA: t.cerradaA };
}

/** La propuesta que sale de una operación de papel de la mesa, con el riesgo por operación que tenía configurado la persona. */
export function propuestaDePapel(
  t: { symbol: string; lado: "LONG" | "SHORT"; entrada: number; stop: number; rrPlan: number },
  riesgoPct: number | null,
  estrategia = "MESA",
): Propuesta {
  return { symbol: t.symbol, lado: t.lado, estrategia, entrada: t.entrada, stop: t.stop, rrPlan: t.rrPlan, riesgoPct };
}
