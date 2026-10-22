/**
 * La pizarra de cripto en el servidor (PLAN_PIZARRA_1), con la app cerrada: cada 4 horas, después de que cierra la vela y de
 * que corren los agentes del servidor, una moneda por minuto se discute con lo que el servidor sabe de ella: las mentes de
 * precio sobre velas diarias (las de valor se abstienen), la estructura, los agentes del servidor con posición abierta, las
 * señales abiertas del núcleo de JARVIS y el gestor de riesgo. La mesa de JARVIS corre en el navegador y no opina acá.
 *
 * Si dice «hay plan», se registra: entrada al cierre de la última vela de 4 h, con el stop y los objetivos de la señal más
 * reciente a favor (de las últimas 8 horas), si con ese cierre quedan en orden. Se resuelve con las velas de 4 h siguientes,
 * con el horizonte y la comisión de los agentes del servidor; si una vela toca stop y objetivo, cuenta el stop. Velas de
 * Kraken (o Coinbase), otra serie que la de Binance del navegador: se dice y no se suma al total del registro.
 * Solo papel: no manda órdenes. No es asesoramiento financiero. Pura: sin red ni base.
 */
import { escaleraHacia, escaleraValida, recorrer, type Escalera, type Lado, type Recorrido } from "./escalera.ts";
import { COMISION_AGENTES_PCT, HORIZONTE_AGENTES, MARCO_AGENTES_MS, MONEDAS_AGENTES } from "./agentes-papel.ts";
import { estructura } from "./mercado-ar-tecnico.ts";
import { razonarMentes, type Razonamiento } from "./mentes-metodo.ts";
import { deliberar, vocesDeMentes, vozEstructura, vozRiesgo, type Deliberacion, type Direccion, type PlanComun, type Voz } from "./pizarra.ts";
import { vocesDeOficina, type EscritorioLite } from "./pizarra-activos.ts";
import type { SwingCandle } from "./swing-entries.ts";

export const PLAN_PIZARRA = "PLAN_PIZARRA_1";
/** Minuto de la primera moneda: los agentes del servidor corren en los minutos 1 a 21 de las mismas horas. */
export const MINUTO_PIZARRA = 31;
/** Hasta cuándo una señal sirve de plan: más vieja, el precio ya se movió. */
export const FRESCURA_PLAN_MS = 8 * 3_600_000;

/** Qué moneda le toca: horas múltiplo de 4 (UTC), minuto 31 → la primera, 32 → la segunda… Fuera de turno, null. */
export function monedaPizarraDeTurno(t: number): string | null {
  const d = new Date(t);
  if (d.getUTCHours() % 4 !== 0) return null;
  return MONEDAS_AGENTES[d.getUTCMinutes() - MINUTO_PIZARRA] ?? null;
}

export type SenalNucleo = { id: string; source: string; side: Lado; entry: number; stop: number; target: number; time: number; taken: boolean };
export type AbiertaAgente = { clave: string; lado: Lado; vela: number; entrada: number; sl: number; tp1: number; tp2: number; tp3: number };

const nombreAgente = (clave: string) => clave.split(":")[1] ?? clave;
const lado = (l: Lado): Direccion => (l === "SHORT" ? "CORTO" : "LARGO");
const n = (x: number) => x.toLocaleString("es-AR", { maximumFractionDigits: x >= 100 ? 2 : x >= 1 ? 3 : 6 });

/** Las señales abiertas del núcleo de JARVIS como voces (las que están en sombra no opinan). */
export function vocesDeNucleo(senales: SenalNucleo[]): Voz[] {
  return senales
    .filter((s) => s.taken)
    .map((s) => ({
      id: `NUCLEO:${s.id}`,
      nombre: `Núcleo · ${s.source}`,
      familia: "NUCLEO" as const,
      lado: lado(s.side),
      motivo: `Señal abierta ${s.side === "LONG" ? "en largo" : "en corto"}: entrada ${n(s.entry)}, stop ${n(s.stop)}, objetivo ${n(s.target)}.`,
      veto: false,
      muestra: null,
      falta: null,
      cambiaria: "Se cierra en su stop o en su objetivo: la regla es fija.",
    }));
}

/** La dirección que se discute: la que tienen más señales y agentes con posición; si empatan o nadie tiene, largo. */
export function direccionDe(voces: Voz[]): Direccion {
  const cuenta = (d: Direccion) => voces.filter((v) => (v.familia === "AGENTE" || v.familia === "NUCLEO") && v.lado === d).length;
  return cuenta("CORTO") > cuenta("LARGO") ? "CORTO" : "LARGO";
}

/** El plan: la señal más reciente a favor de la dirección (núcleo o agente) de las últimas 8 horas, con su escalera. */
export function planDeServidor(direccion: Direccion, nucleo: SenalNucleo[], agentes: AbiertaAgente[], ahora: number): (PlanComun & { desde: number }) | null {
  const l: Lado = direccion === "CORTO" ? "SHORT" : "LONG";
  const candidatos: (PlanComun & { desde: number })[] = [];
  for (const s of nucleo) {
    if (!s.taken || s.side !== l || ahora - s.time > FRESCURA_PLAN_MS) continue;
    const e = escaleraHacia(s.side, s.entry, s.stop, s.target);
    if (e) candidatos.push({ entrada: s.entry, ...e, fuente: `Núcleo · ${s.source}`, desde: s.time });
  }
  for (const a of agentes) {
    if (a.lado !== l || ahora - a.vela > FRESCURA_PLAN_MS) continue;
    candidatos.push({ entrada: a.entrada, stop: a.sl, tp1: a.tp1, tp2: a.tp2, tp3: a.tp3, fuente: `Agente ${nombreAgente(a.clave)}`, desde: a.vela });
  }
  return candidatos.sort((a, b) => b.desde - a.desde)[0] ?? null;
}

export type PizarraServidor = { razon: Razonamiento[]; deliberacion: Deliberacion };

export function pizarraServidor(x: { symbol: string; d1: SwingCandle[]; escritorios: EscritorioLite[]; nucleo: SenalNucleo[]; agentes: AbiertaAgente[]; ahora: number }): PizarraServidor {
  const razon = razonarMentes(
    { simbolo: x.symbol, velas: x.d1, moneda: "USD", precioUsd: null, fund: null, sinFund: "los criptoactivos no tienen balances", fuerzaRelativa: null, mercadoAlcista: null, mercadoNombre: "Bitcoin", volMediana: null },
    "CRIPTO",
  );
  const otras = [...vocesDeOficina(x.escritorios, x.symbol), ...vocesDeNucleo(x.nucleo)];
  const direccion = direccionDe(otras);
  const plan = planDeServidor(direccion, x.nucleo, x.agentes, x.ahora);
  const voces = [...vocesDeMentes(razon, direccion), ...(x.d1.length ? [vozEstructura(estructura(x.d1), direccion)] : []), ...otras, vozRiesgo(plan, direccion)];
  return { razon, deliberacion: deliberar({ activo: x.symbol.replace(/USDT$/, ""), direccion, voces, plan }) };
}

export type EntradaPizarra = { clave: string; symbol: string; lado: Lado; vela: number; detectada: number; entrada: number; escalera: Escalera; huella: string; detalle: string };

/**
 * La entrada a registrar si la pizarra dice «hay plan»: al cierre de la última vela de 4 h cerrada, con la escalera del plan
 * si con ese cierre queda en orden. Si no, null y el motivo.
 */
export function entradaPizarra(symbol: string, h4: SwingCandle[], d: Deliberacion, ahora: number): { entrada: EntradaPizarra | null; motivo: string | null } {
  if (d.veredicto !== "HAY PLAN" || !d.plan) return { entrada: null, motivo: null };
  const u = h4.filter((c) => c.openTime + MARCO_AGENTES_MS <= ahora).at(-1);
  if (!u) return { entrada: null, motivo: "sin velas de 4 h cerradas" };
  const l: Lado = d.direccion === "CORTO" ? "SHORT" : "LONG";
  const e: Escalera = { stop: d.plan.stop, tp1: d.plan.tp1, tp2: d.plan.tp2, tp3: d.plan.tp3 };
  if (!escaleraValida(l, u.close, e)) return { entrada: null, motivo: `La pizarra dio plan (${d.plan.fuente}) pero con el cierre de ${n(u.close)} la escalera no queda en orden: no se registra.` };
  return {
    entrada: { clave: `pz:${symbol}:4h:${l}:${u.openTime}`, symbol, lado: l, vela: u.openTime, detectada: ahora, entrada: u.close, escalera: e, huella: d.huella, detalle: `${d.plan.fuente}. ${d.razon}`.slice(0, 400) },
    motivo: null,
  };
}

export type AbiertaPizarra = { clave: string; lado: Lado; vela: number; entrada: number; sl: number; tp1: number; tp2: number; tp3: number; tp1_at: number | null; tp2_at: number | null };

export function avancesPizarra(abiertas: AbiertaPizarra[], h4: SwingCandle[], ahora: number): { clave: string; recorrido: Recorrido }[] {
  const out: { clave: string; recorrido: Recorrido }[] = [];
  for (const a of abiertas) {
    const rec = recorrer(a.lado, a.entrada, { stop: a.sl, tp1: a.tp1, tp2: a.tp2, tp3: a.tp3 }, a.vela, h4, MARCO_AGENTES_MS, ahora, { horizonte: HORIZONTE_AGENTES, feePct: COMISION_AGENTES_PCT });
    if (rec.desenlace !== "ABIERTA" || (rec.tp1At !== null && a.tp1_at === null) || (rec.tp2At !== null && a.tp2_at === null)) out.push({ clave: a.clave, recorrido: rec });
  }
  return out;
}
