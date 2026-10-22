/**
 * Arma la pizarra (lib/pizarra.ts) de un activo concreto con todo lo que ya se leyó de él: para una acción o un CEDEAR de
 * BYMA, las nueve mentes con su método, los agentes que disparan hoy, la zona de Fibonacci, la estructura y el gestor de
 * riesgo; para una criptomoneda, las mentes de precio (las de valor se abstienen: no hay balances), la estructura y la mesa de
 * JARVIS con sus compuertas (su veto de riesgo gana). Nada se pide a ninguna red: recibe lo ya leído. No es asesoramiento
 * financiero. Pura.
 */
import type { AgenteEnPapel } from "./mercado-ar-agentes.ts";
import { estructura, type ZonaFibAr } from "./mercado-ar-tecnico.ts";
import { razonarMentes, type Razonamiento } from "./mentes-metodo.ts";
import type { EntradaMentes } from "./mentes-inversoras.ts";
import type { DeskDecision, Plan } from "./jarvis-desk.ts";
import { council, gates } from "./jarvis-council.ts";
import type { DeskSnapshot } from "./jarvis-desk-data.ts";
import { deliberar, vocesDeAgentes, vocesDeConsejo, vocesDeMentes, vozEstructura, vozFib, vozRiesgo, type Deliberacion, type Direccion, type PlanComun } from "./pizarra.ts";
import type { SwingCandle } from "./swing-entries.ts";
import type { Intervencion } from "./mercado-ar-ranking.ts";

export type PizarraActivo = { razon: Razonamiento[]; deliberacion: Deliberacion };

// ── Acciones y CEDEARs de BYMA ──

export type EntradaPizarraAr = {
  ticker: string;
  nombre: string;
  /** Las ruedas del papel que se opera (en pesos). */
  velas: SwingCandle[];
  fib: ZonaFibAr | null;
  fibMotivo: string | null;
  agentes: AgenteEnPapel[];
  mentes: EntradaMentes;
};

/** El plan de la pizarra de un papel: el de Fibonacci si la pierna sigue viva; si no, el de la primera señal de un agente. */
export function planDelPapel(fib: ZonaFibAr | null, agentes: AgenteEnPapel[]): PlanComun | null {
  if (fib?.plan && fib.estado !== "INVALIDADA") return { ...fib.plan, fuente: "Fibonacci" };
  const a = agentes.find((x) => x.senalHoy);
  if (a?.senalHoy) {
    const e = a.senalHoy.escalera;
    return { entrada: a.senalHoy.referencia, stop: e.stop, tp1: e.tp1, tp2: e.tp2, tp3: e.tp3, fuente: a.agente };
  }
  return null;
}

export function pizarraAr(e: EntradaPizarraAr): PizarraActivo {
  const razon = razonarMentes(e.mentes, "ACCION");
  const plan = planDelPapel(e.fib, e.agentes);
  const voces = [
    ...vocesDeMentes(razon),
    ...vocesDeAgentes(e.agentes.map((a) => ({ id: a.id, nombre: a.agente, ops: a.ops, senalHoy: a.senalHoy }))),
    vozFib(e.fib, e.fibMotivo),
    vozEstructura(estructura(e.velas)),
    vozRiesgo(plan, "LARGO"),
  ];
  return { razon, deliberacion: deliberar({ activo: `${e.ticker} (${e.nombre})`, direccion: "LARGO", voces, plan }) };
}

// ── Criptomonedas ──

const planDeLaMesa = (p: Plan | null): PlanComun | null => (p ? { entrada: p.entrada, stop: p.stop, tp1: p.tp[0].price, tp2: p.tp[1].price, tp3: p.tp[2].price, fuente: "Mesa de JARVIS" } : null);

/**
 * La pizarra de una criptomoneda con lo que la mesa de JARVIS ya leyó. La dirección es la que eligió la mesa; si no tomó
 * lado, se discute el largo (con el plan alcista si lo hay). Las mentes de precio leen las velas diarias; las de valor se
 * abstienen: un criptoactivo no tiene balances.
 */
export function pizarraCripto(entry: { decision: DeskDecision | null; snapshot: DeskSnapshot }): PizarraActivo {
  const { decision, snapshot } = entry;
  const velas = snapshot.candles.d1 ?? [];
  const razon = razonarMentes(
    { simbolo: snapshot.symbol, velas, moneda: "USDT", precioUsd: null, fund: null, sinFund: "los criptoactivos no tienen balances", fuerzaRelativa: null, mercadoAlcista: null, mercadoNombre: "Bitcoin", volMediana: null },
    "CRIPTO",
  );
  const direccion: Direccion = decision?.direccion === "SHORT" ? "CORTO" : "LARGO";
  const planMesa = decision ? decision.plan ?? (direccion === "LARGO" ? decision.alcista.plan : decision.bajista.plan) : null;
  const plan = planDeLaMesa(planMesa);
  const voces = [
    ...vocesDeMentes(razon, direccion),
    ...(velas.length ? [vozEstructura(estructura(velas), direccion)] : []),
    ...(decision ? vocesDeConsejo({ votos: council(decision).votos, compuertas: gates(decision) }) : []),
    ...(decision?.riesgo ? [] : [vozRiesgo(plan, direccion)]),
  ];
  return { razon, deliberacion: deliberar({ activo: snapshot.symbol.replace(/USDT$/, ""), direccion, voces, plan }) };
}

// ── Para la oficina ──

const corto = (t: string, n = 150) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
const jarvis = (texto: string): Intervencion => ({ quien: "JARVIS", nombre: "JARVIS", postura: "MODERA", texto });

/**
 * La deliberación como guion de reunión (el formato de la oficina): abre JARVIS, hablan las mentes que discuten (hasta tres a
 * favor y tres en contra, alternadas; cada una con su motivo y, las que están en contra, lo que las haría cambiar de idea),
 * JARVIS resume lo que dicen las demás voces (Fibonacci, agentes, estructura, riesgo) y cierra con la decisión y su huella.
 */
export function guionDeDeliberacion(d: Deliberacion): Intervencion[] {
  const mentes = (voces: Deliberacion["voces"]) => voces.filter((v) => v.id.startsWith("MENTE:"));
  const favor = mentes(d.aFavor).slice(0, 3);
  const contra = mentes(d.enContra).slice(0, 3);
  const habla: Intervencion[] = [];
  for (let k = 0; k < 3; k += 1) {
    if (favor[k]) habla.push({ quien: favor[k].id.slice(6), nombre: favor[k].nombre, postura: "A FAVOR", texto: `A favor: ${corto(favor[k].motivo)}` });
    if (contra[k]) habla.push({ quien: contra[k].id.slice(6), nombre: contra[k].nombre, postura: "EN CONTRA", texto: `En contra: ${corto(contra[k].motivo)}${contra[k].cambiaria ? ` Cambiaría de idea si: ${corto(contra[k].cambiaria!, 90)}` : ""}` });
  }
  const otras = d.voces.filter((v) => !v.id.startsWith("MENTE:") && v.lado !== "ABSTIENE");
  const resumen = otras.length ? `Por fuera de las mentes: ${otras.slice(0, 4).map((v) => `${v.nombre} ${v.lado === d.direccion ? "a favor" : v.lado === "ESPERA" ? "espera" : "en contra"}`).join(", ")}.` : "Por fuera de las mentes, nadie más opina todavía.";
  return [
    jarvis(`Reunión sobre ${d.activo}: ${d.aFavor.length} a favor, ${d.enContra.length} en contra, ${d.espera.length} esperan y ${d.abstienen.length} se abstienen.`),
    ...habla,
    jarvis(resumen),
    jarvis(`${d.veredicto}. ${d.razon} Decisión ${d.huella}. No es asesoramiento financiero.`),
  ];
}
