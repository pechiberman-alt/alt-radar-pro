/**
 * Las listas que arma MERCADO AR con todo el panel leído: las mejores compras según Fibonacci (precio dentro de la zona
 * 0,618–0,786 o cerca, con su plan y lo que pasó antes en ese papel), las señales de los agentes con lo que opinan las
 * mentes del mismo papel, y el guion de la reunión de las mentes sobre un papel (cada frase sale de un criterio medido).
 * Orden y textos, no probabilidades. No es asesoramiento financiero. Pura.
 */
import type { LecturaMente } from "./mentes-inversoras.ts";
import type { ZonaFibAr } from "./mercado-ar-tecnico.ts";
import type { PapelAr } from "./mercado-ar.ts";
import type { AgenteEnPapel } from "./mercado-ar-agentes.ts";
import type { Consenso } from "./mentes-inversoras.ts";

/** Lo mínimo de un papel leído que necesitan estas listas (LecturaPapel lo cumple). */
export type PapelLeido = {
  papel: PapelAr;
  cierre: number | null;
  fib: ZonaFibAr | null;
  mentes: LecturaMente[];
  consenso: Consenso;
  agentes: AgenteEnPapel[];
};

/** Hasta qué distancia sobre la zona se muestra un papel como «cerca» (el precio puede bajar a la zona). */
export const CERCA_ZONA = 0.05;

export type CompraFib = {
  ticker: string;
  tipo: PapelAr["tipo"];
  estado: "EN LA ZONA" | "CERCA";
  /** Cuánto le falta al cierre para entrar a la zona (0 si ya está adentro). */
  distancia: number;
  fib: ZonaFibAr;
  /** Aguantó / resueltas en este papel; null sin casos resueltos. */
  tasa: number | null;
  resueltas: number;
  consenso: Consenso;
};

/**
 * Las mejores compras según Fibonacci: primero las que tienen el precio dentro de la zona, después las que están a menos
 * de 5 % arriba. Dentro de cada grupo, primero las que más veces aguantaron en ese papel (con al menos 3 casos resueltos),
 * después las de mejor relación entre lo que se arriesga y el objetivo. Quedan afuera las piernas invalidadas.
 */
export function mejoresComprasFib(papeles: PapelLeido[], maximo = 10): CompraFib[] {
  const out: CompraFib[] = [];
  for (const p of papeles) {
    const f = p.fib;
    if (!f || !f.plan || p.cierre === null) continue;
    const distancia = f.estado === "EN LA ZONA" ? 0 : f.estado === "ARRIBA DE LA ZONA" ? p.cierre / f.zona.alto - 1 : Number.NaN;
    if (!(distancia >= 0 && distancia <= CERCA_ZONA)) continue;
    const resueltas = f.historial.aguantaron + f.historial.fallaron;
    out.push({ ticker: p.papel.ticker, tipo: p.papel.tipo, estado: distancia === 0 ? "EN LA ZONA" : "CERCA", distancia, fib: f, tasa: resueltas ? f.historial.aguantaron / resueltas : null, resueltas, consenso: p.consenso });
  }
  const peso = (c: CompraFib) => (c.resueltas >= 3 && c.tasa !== null ? c.tasa : -1);
  return out
    .sort((a, b) => (a.estado === b.estado ? 0 : a.estado === "EN LA ZONA" ? -1 : 1) || peso(b) - peso(a) || (b.fib.plan?.rr ?? 0) - (a.fib.plan?.rr ?? 0))
    .slice(0, maximo);
}

/** Las señales de compra de la última rueda, cada una con cuántas mentes están a favor del mismo papel. */
export function senalesConMentes(papeles: PapelLeido[]): { ticker: string; agente: AgenteEnPapel; consenso: Consenso }[] {
  return papeles
    .flatMap((p) => p.agentes.filter((a) => a.senalHoy).map((agente) => ({ ticker: p.papel.ticker, agente, consenso: p.consenso })))
    .sort((a, b) => b.consenso.aFavor - b.consenso.enContra - (a.consenso.aFavor - a.consenso.enContra));
}

export type Intervencion = { quien: string; nombre: string; postura: LecturaMente["postura"] | "MODERA"; texto: string };

/** Lo que dice una mente en la reunión: su postura con el criterio que la decide. */
export function intervencion(m: LecturaMente): Intervencion {
  const conocidos = m.criterios.filter((c) => c.cumple !== null);
  const fallan = conocidos.filter((c) => c.cumple === false);
  const cumplen = conocidos.filter((c) => c.cumple === true);
  let texto: string;
  if (m.postura === "SIN DATOS") texto = `No puedo opinar: ${m.criterios.find((c) => c.cumple === null)?.valor ?? "faltan datos"}.`;
  else if (m.postura === "INFORMA") texto = m.criterios.map((c) => `${c.nombre.toLowerCase()} ${c.valor}`).join(" · ") + ".";
  else if (m.postura === "A FAVOR") texto = `A favor: ${cumplen.slice(0, 2).map((c) => `${c.nombre.toLowerCase()} (${c.valor})`).join(" y ")}.`;
  else if (m.postura === "EN CONTRA") texto = `En contra: ${fallan.slice(0, 2).map((c) => `${c.nombre.toLowerCase()} no se cumple (${c.valor})`).join(" y ")}.`;
  else texto = `Dividido: ${cumplen[0] ? `${cumplen[0].nombre.toLowerCase()} sí (${cumplen[0].valor})` : ""}${cumplen[0] && fallan[0] ? ", pero " : ""}${fallan[0] ? `${fallan[0].nombre.toLowerCase()} no (${fallan[0].valor})` : ""}.`;
  return { quien: m.id, nombre: m.mente, postura: m.postura, texto };
}

/** La reunión sobre un papel: abre JARVIS con el tema, hablan las mentes (primero las que opinan) y cierra con la cuenta. */
export function guionReunion(p: PapelLeido): Intervencion[] {
  const orden = (m: LecturaMente) => (m.postura === "SIN DATOS" ? 2 : m.postura === "INFORMA" ? 1 : 0);
  const mentes = [...p.mentes].sort((a, b) => orden(a) - orden(b));
  const f = p.fib;
  const fibTxt = !f ? "sin zona de compra de Fibonacci" : f.estado === "EN LA ZONA" ? "el precio está en la zona de compra de Fibonacci" : f.estado === "ARRIBA DE LA ZONA" ? "el precio está arriba de la zona de compra de Fibonacci" : f.estado === "INVALIDADA" ? "la pierna de Fibonacci quedó invalidada" : "el precio está debajo de la zona de Fibonacci";
  const senales = p.agentes.filter((a) => a.senalHoy).map((a) => a.agente);
  const c = p.consenso;
  return [
    { quien: "JARVIS", nombre: "JARVIS", postura: "MODERA", texto: `Reunión sobre ${p.papel.ticker} (${p.papel.nombre}): ${fibTxt}${senales.length ? `; ${senales.length} ${senales.length === 1 ? "agente da" : "agentes dan"} compra hoy` : ""}. Opinen.` },
    ...mentes.map(intervencion),
    { quien: "JARVIS", nombre: "JARVIS", postura: "MODERA", texto: `Quedamos ${c.aFavor} a favor, ${c.enContra} en contra y ${c.neutral} divididos, de ${c.opinan} que pudieron opinar. No es una probabilidad ni asesoramiento financiero.` },
  ];
}
