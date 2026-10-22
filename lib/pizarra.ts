/**
 * La PIZARRA: donde se coordinan todos los que opinan sobre un activo, sea una acción de BYMA, un CEDEAR o una criptomoneda.
 * Cada fuente deja una VOZ con su lado (largo, corto, espera, afuera o se abstiene), su motivo, su muestra y qué la haría
 * cambiar de idea: las mentes (lib/mentes-metodo.ts), los agentes de papel, la zona de Fibonacci, la estructura, el gestor de
 * riesgo y la mesa de JARVIS. La pizarra no promedia: ordena la discusión (quién está a favor, quién en contra y de qué
 * familia, quién se abstiene y por qué) y decide con reglas fijas y a la vista.
 *
 * Reglas (iguales para cripto y para BYMA, y nunca a favor de un resultado):
 * - Un veto del gestor de riesgo (relación riesgo/beneficio bajo el mínimo de la mesa, o la compuerta de riesgo de JARVIS)
 *   gana a cualquier cantidad de votos: NO OPERAR.
 * - Con menos de 3 voces que opinen no hay decisión: SIN DATOS SUFICIENTES. Una abstención no es un voto en contra.
 * - Una operación necesita su plan completo (entrada, SL, TP1, TP2 y TP3 en orden): sin plan, ESPERAR.
 * - HAY PLAN pide al menos dos voces a favor de dos familias distintas (el riesgo no cuenta como familia) y más a favor que en
 *   contra. Si en contra hay igual o más, NO OPERAR; si no, ESPERAR.
 * La huella identifica la decisión de forma estable (mismas voces y mismo plan, misma huella) para registrarla más adelante.
 * No es asesoramiento financiero. Pura: sin red, sin base y sin reloj.
 */
import type { Razonamiento, FamiliaMente } from "./mentes-metodo.ts";

export type Lado = "LARGO" | "CORTO" | "ESPERA" | "AFUERA" | "ABSTIENE";
export type Direccion = "LARGO" | "CORTO";
export type FamiliaVoz = FamiliaMente | "AGENTE" | "ZONA" | "MAPA" | "MESA" | "NUCLEO" | "RIESGO_MESA";

export type Voz = {
  id: string;
  nombre: string;
  familia: FamiliaVoz;
  lado: Lado;
  motivo: string;
  /** Solo el gestor de riesgo veta. */
  veto: boolean;
  /** Cierres en los que se apoya su récord (agentes, Fibonacci); null si no es una voz medida así. */
  muestra: number | null;
  /** Lo que no pudo saber (para las que se abstienen). */
  falta: string | null;
  /** Qué tendría que pasar para que cambie de lado. */
  cambiaria: string | null;
};

export type PlanComun = { entrada: number; stop: number; tp1: number; tp2: number; tp3: number; fuente: string };

/** El mismo mínimo de relación riesgo/beneficio que la mesa de JARVIS (MIN_RR de lib/jarvis-desk.ts; un test lo cuida). */
export const RR_MINIMO = 1.5;
/** Voces que tienen que opinar para que haya decisión. */
export const MIN_OPINAN = 3;
export const MUESTRA_VOZ = 15;
/** Cuántas voces más a favor que en contra pide «hay plan»: con una ventaja de uno es un empate de hecho. */
export const VENTAJA_MINIMA = 2;

export type Veredicto = "HAY PLAN" | "ESPERAR" | "NO OPERAR" | "SIN DATOS SUFICIENTES";

export type Linea = { quien: string; nombre: string; texto: string; lado: Lado | "MODERA" };

export type Deliberacion = {
  activo: string;
  direccion: Direccion;
  voces: Voz[];
  aFavor: Voz[];
  enContra: Voz[];
  espera: Voz[];
  abstienen: Voz[];
  vetos: Voz[];
  /** Parejas de voces de familias distintas que miran el mismo activo y se contradicen. */
  discrepancias: { favor: Voz; contra: Voz }[];
  veredicto: Veredicto;
  razon: string;
  plan: PlanComun | null;
  /** Qué habría que ver para que la decisión cambie (de los que esperan o están en contra) y qué datos faltan. */
  destraba: string[];
  debate: Linea[];
  huella: string;
};

// ── De cada fuente a voces ──

const LADO_DE: Record<Razonamiento["veredicto"], Lado> = {
  "COMPRARÍA": "LARGO",
  "ESPERARÍA": "ESPERA",
  "NO LO TOCARÍA": "AFUERA",
  "AFUERA": "AFUERA",
  "FUERA DE MI MÉTODO": "ABSTIENE",
  "SIN DATOS": "ABSTIENE",
  "INFORMA": "ABSTIENE",
};

/**
 * Las mentes como voces. Las que no opinan (fuera de su método, sin datos, Dalio) se abstienen con su motivo. Las lentes son
 * de compra: si la dirección que se discute es corta, la que compraría queda en contra, la que espera espera y las que
 * «no lo tocarían» se abstienen (no tener ganas de comprar no es una señal de venta corta).
 */
export function vocesDeMentes(rs: Razonamiento[], direccion: Direccion = "LARGO"): Voz[] {
  return rs.map((r) => {
    let lado = LADO_DE[r.veredicto];
    let prefijo = r.veredicto === "FUERA DE MI MÉTODO" ? "Fuera de mi método: " : "";
    if (direccion === "CORTO" && lado === "AFUERA") {
      lado = "ABSTIENE";
      prefijo = "Mi lente es de compras y no opina sobre cortos. ";
    }
    return {
      id: `MENTE:${r.id}`,
      nombre: r.mente.split(" (")[0],
      familia: r.familia,
      lado,
      motivo: r.veredicto === "INFORMA" ? `Informa, no opina: ${r.porQue}` : `${prefijo}${r.porQue}`,
      veto: false,
      muestra: null,
      falta: lado === "ABSTIENE" ? (r.noSabe[0] ?? null) : null,
      cambiaria: r.cambiaria[0] ?? null,
    };
  });
}

const pct0 = (x: number) => `${Math.round(x * 100)} %`;
const rr1 = (x: number) => `1:${x.toLocaleString("es-AR", { maximumFractionDigits: 1 })}`;

/** Un agente de papel con su señal de hoy y sus operaciones cerradas en este activo. Los que no disparan hoy no opinan. */
export function vocesDeAgentes(agentes: { id: string; nombre: string; ops: { r: number }[]; senalHoy: { rr: number } | null }[]): Voz[] {
  return agentes
    .filter((a) => a.senalHoy)
    .map((a) => {
      const n = a.ops.length;
      const gano = a.ops.filter((o) => o.r > 0).length;
      const historia = n === 0 ? "sin cierres en este activo" : `en este activo ${gano} de ${n} cerradas ganaron${n < MUESTRA_VOZ ? " (muestra mínima)" : ""}`;
      return {
        id: `AGENTE:${a.id}`,
        nombre: a.nombre,
        familia: "AGENTE" as const,
        lado: "LARGO" as const,
        motivo: `Señal de compra hoy, R:R ${rr1(a.senalHoy!.rr)}; ${historia}.`,
        veto: false,
        muestra: n,
        falta: null,
        cambiaria: "Si la señal no se confirma en la rueda siguiente, la descarta.",
      };
    });
}

/** La zona de compra de Fibonacci del activo (estado y lo que aguantó antes). */
export function vozFib(f: { estado: string; historial: { aguantaron: number; fallaron: number } } | null, motivoSin: string | null = null): Voz {
  const base = { id: "ZONA:FIB", nombre: "Fibonacci", familia: "ZONA" as const, veto: false };
  if (!f) return { ...base, lado: "ABSTIENE", motivo: motivoSin ?? "No hay una pierna alcista reciente para trazar la zona.", muestra: null, falta: "una pierna alcista reciente", cambiaria: "Que el precio arme una pierna alcista nueva." };
  const n = f.historial.aguantaron + f.historial.fallaron;
  const hist = n === 0 ? "sin casos previos en este activo" : `antes aguantó ${f.historial.aguantaron} de ${n} veces${n < MUESTRA_VOZ ? " (muestra mínima)" : ""}`;
  if (f.estado === "EN LA ZONA") return { ...base, lado: "LARGO", motivo: `El precio está dentro de la zona 0,618–0,786; ${hist}.`, muestra: n, falta: null, cambiaria: "Un cierre bajo el origen de la pierna la invalida." };
  if (f.estado === "ARRIBA DE LA ZONA") return { ...base, lado: "ESPERA", motivo: `El precio está arriba de la zona: esperar el retroceso; ${hist}.`, muestra: n, falta: null, cambiaria: "Que el precio retroceda a la zona." };
  if (f.estado === "INVALIDADA") return { ...base, lado: "AFUERA", motivo: "La pierna quedó invalidada: el precio cayó bajo su origen.", muestra: n, falta: null, cambiaria: "Una pierna alcista nueva." };
  return { ...base, lado: "AFUERA", motivo: `El precio ya está debajo de la zona; ${hist}.`, muestra: n, falta: null, cambiaria: "Que recupere la zona." };
}

/** La estructura de precio (tendencia por máximos y mínimos). */
export function vozEstructura(e: { tendencia: "ALCISTA" | "BAJISTA" | "LATERAL" | "SIN DATOS"; detalle: string }, direccion: Direccion = "LARGO"): Voz {
  const base = { id: "MAPA:ESTRUCTURA", nombre: "Estructura", familia: "MAPA" as const, veto: false, muestra: null, falta: null as string | null };
  if (e.tendencia === "SIN DATOS") return { ...base, lado: "ABSTIENE", motivo: e.detalle, falta: "más ruedas", cambiaria: null };
  if (e.tendencia === "LATERAL") return { ...base, lado: "ESPERA", motivo: `Lateral: ${e.detalle}`, cambiaria: "Que rompa el rango." };
  const alcista = e.tendencia === "ALCISTA";
  const lado: Lado = alcista === (direccion === "LARGO") ? direccion : "AFUERA";
  return { ...base, lado, motivo: `${alcista ? "Alcista" : "Bajista"}: ${e.detalle}`, cambiaria: alcista ? "Un mínimo más bajo rompe la tendencia." : "Un máximo más alto rompe la tendencia." };
}

/** Un plan es completo si trae entrada, SL y tres objetivos finitos y ordenados para la dirección. */
export function planCompleto(p: PlanComun | null, direccion: Direccion): boolean {
  if (!p) return false;
  const v = [p.entrada, p.stop, p.tp1, p.tp2, p.tp3];
  if (!v.every((n) => Number.isFinite(n) && n > 0)) return false;
  return direccion === "LARGO" ? p.stop < p.entrada && p.entrada < p.tp1 && p.tp1 < p.tp2 && p.tp2 < p.tp3 : p.stop > p.entrada && p.entrada > p.tp1 && p.tp1 > p.tp2 && p.tp2 > p.tp3;
}

/** La relación riesgo/beneficio hacia el TP3 (el que se midió); null si el plan no es completo. */
export function rrDelPlan(p: PlanComun | null, direccion: Direccion): number | null {
  if (!p || !planCompleto(p, direccion)) return null;
  const riesgo = Math.abs(p.entrada - p.stop);
  return riesgo > 0 ? Math.abs(p.tp3 - p.entrada) / riesgo : null;
}

/** El gestor de riesgo: sin plan se abstiene; con relación bajo el mínimo veta; si no, aprueba y dice cuánto arriesga. */
export function vozRiesgo(plan: PlanComun | null, direccion: Direccion): Voz {
  const base = { id: "RIESGO:GESTOR", nombre: "Gestor de riesgo", familia: "RIESGO_MESA" as const, muestra: null };
  const rr = rrDelPlan(plan, direccion);
  if (!plan || rr === null) return { ...base, lado: "ABSTIENE", motivo: "Sin plan completo no hay nada que revisar.", veto: false, falta: "un plan con SL, TP1, TP2 y TP3", cambiaria: null };
  const riesgo = Math.abs(plan.entrada - plan.stop) / plan.entrada;
  if (rr < RR_MINIMO) return { ...base, lado: "AFUERA", veto: true, motivo: `Veto: la relación riesgo/beneficio es ${rr1(rr)} y el mínimo es ${rr1(RR_MINIMO)}.`, falta: null, cambiaria: "Un stop más cerca o un objetivo más lejos que den al menos 1:1,5." };
  return { ...base, lado: direccion, veto: false, motivo: `Relación ${rr1(rr)} (mínimo ${rr1(RR_MINIMO)}); el stop queda a ${pct0(riesgo)} de la entrada: con 1 % de la cuenta en riesgo se compra ${pct0(Math.min(1, 0.01 / riesgo))} de la cuenta.`, falta: null, cambiaria: "Si el stop se aleja o el objetivo se acerca hasta bajar de 1:1,5, veta." };
}

/** La mesa de JARVIS (especialistas y compuertas) como voces: para cripto. */
export function vocesDeConsejo(c: {
  votos: { id: string; nombre: string; estado: "VOTA" | "SIN DATOS" | "CONTEXTO"; postura: "ALCISTA" | "BAJISTA" | "NEUTRAL" | null; hallazgo: string | null; falta: string[] }[];
  compuertas?: { id: string; estado: "OK" | "FALLA" | "NO EVALUADA"; detalle: string }[];
}): Voz[] {
  const out: Voz[] = [];
  for (const v of c.votos) {
    if (v.estado === "CONTEXTO") continue;
    const base = { id: `MESA:${v.id}`, nombre: v.nombre, familia: "MESA" as const, veto: false, muestra: null };
    if (v.estado === "SIN DATOS") out.push({ ...base, lado: "ABSTIENE", motivo: "Sin datos: este dato no está disponible actualmente.", falta: v.falta[0] ?? "datos de la mesa", cambiaria: null });
    else out.push({ ...base, lado: v.postura === "ALCISTA" ? "LARGO" : v.postura === "BAJISTA" ? "CORTO" : "ESPERA", motivo: v.hallazgo ?? "sin hallazgo", falta: null, cambiaria: null });
  }
  const riesgo = c.compuertas?.find((g) => g.id === "riesgo");
  if (riesgo?.estado === "FALLA") out.push({ id: "RIESGO:JARVIS", nombre: "Gestor de riesgo (JARVIS)", familia: "RIESGO_MESA", lado: "AFUERA", motivo: riesgo.detalle, veto: true, muestra: null, falta: null, cambiaria: "Que el plan pase la revisión de riesgo." });
  const momento = c.compuertas?.find((g) => g.id === "momento");
  if (momento?.estado === "FALLA") out.push({ id: "MESA:MOMENTO", nombre: "Momento", familia: "MESA", lado: "ESPERA", motivo: momento.detalle, veto: false, muestra: null, falta: null, cambiaria: "Que se cumpla lo que pide esperar." });
  return out;
}

// ── La deliberación ──

const ORDEN_FAMILIA: FamiliaVoz[] = ["MESA", "NUCLEO", "ZONA", "MAPA", "AGENTE", "MOMENTUM", "VALOR", "CRECIMIENTO", "CONTRARIA", "RIESGO", "RIESGO_MESA"];
const orden = (a: Voz, b: Voz) => ORDEN_FAMILIA.indexOf(a.familia) - ORDEN_FAMILIA.indexOf(b.familia) || (b.muestra ?? 0) - (a.muestra ?? 0);

/** FNV-1a de 32 bits, en hexadecimal: una huella corta y estable (no es criptográfica). */
export function huellaDe(texto: string): string {
  let h = 0x811c9dc5;
  for (let k = 0; k < texto.length; k += 1) {
    h ^= texto.charCodeAt(k);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const corto = (t: string, n = 170) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

export function deliberar(entrada: { activo: string; direccion?: Direccion; voces: Voz[]; plan?: PlanComun | null }): Deliberacion {
  const direccion = entrada.direccion ?? "LARGO";
  const plan = entrada.plan ?? null;
  const voces = [...entrada.voces].sort(orden);
  const opuesto: Lado = direccion === "LARGO" ? "CORTO" : "LARGO";
  const aFavor = voces.filter((v) => v.lado === direccion);
  const enContra = voces.filter((v) => v.lado === "AFUERA" || v.lado === opuesto);
  const espera = voces.filter((v) => v.lado === "ESPERA");
  const abstienen = voces.filter((v) => v.lado === "ABSTIENE");
  const vetos = voces.filter((v) => v.veto && v.lado === "AFUERA");
  const opinan = voces.length - abstienen.length;
  const familiasAFavor = new Set(aFavor.filter((v) => v.familia !== "RIESGO_MESA").map((v) => v.familia));
  const completo = planCompleto(plan, direccion);

  let veredicto: Veredicto;
  let razon: string;
  if (vetos.length) {
    veredicto = "NO OPERAR";
    razon = `${vetos[0].nombre} veta: ${vetos[0].motivo} Un veto de riesgo gana a cualquier cantidad de votos.`;
  } else if (opinan < MIN_OPINAN) {
    veredicto = "SIN DATOS SUFICIENTES";
    razon = `Solo ${opinan} ${opinan === 1 ? "voz opina" : "voces opinan"} y hacen falta ${MIN_OPINAN}; ${abstienen.length} se abstienen. Una abstención no es un voto en contra.`;
  } else if (!completo) {
    veredicto = "ESPERAR";
    razon = "No hay plan completo (entrada, SL, TP1, TP2 y TP3 en orden): sin plan no hay operación, por más votos que haya.";
  } else if (enContra.length >= aFavor.length && enContra.length >= 2) {
    veredicto = "NO OPERAR";
    razon = `${enContra.length} en contra contra ${aFavor.length} a favor: la mayoría que opina no lo toma.`;
  } else if (aFavor.length >= 2 && familiasAFavor.size >= 2 && aFavor.length >= enContra.length + VENTAJA_MINIMA) {
    veredicto = "HAY PLAN";
    razon = `${aFavor.length} a favor de ${familiasAFavor.size} familias distintas (${[...familiasAFavor].join(", ").toLowerCase()}), ${enContra.length} en contra y el riesgo no veta.`;
  } else {
    veredicto = "ESPERAR";
    razon =
      aFavor.length < 2
        ? `Solo ${aFavor.length} ${aFavor.length === 1 ? "voz está" : "voces están"} a favor y hacen falta 2.`
        : familiasAFavor.size < 2
          ? "Los que están a favor son de la misma familia: hace falta una segunda mirada distinta."
          : `La ventaja es estrecha (${aFavor.length} a favor, ${enContra.length} en contra): hacen falta al menos ${VENTAJA_MINIMA} más a favor que en contra.`;
  }

  const discrepancias: { favor: Voz; contra: Voz }[] = [];
  const vistas = new Set<string>();
  for (const f of aFavor) {
    for (const c of enContra) {
      const clave = [f.familia, c.familia].sort().join("|");
      if (f.familia === c.familia || vistas.has(clave)) continue;
      vistas.add(clave);
      discrepancias.push({ favor: f, contra: c });
      if (discrepancias.length >= 3) break;
    }
    if (discrepancias.length >= 3) break;
  }

  const destraba = [...new Set([...enContra.slice(0, 2), ...espera.slice(0, 2)].map((v) => (v.cambiaria ? `${v.nombre}: ${v.cambiaria}` : "")).filter(Boolean))].concat([...new Set(abstienen.map((v) => (v.falta ? `${v.nombre} necesita: ${v.falta}` : "")).filter(Boolean))].slice(0, 3));

  const huella = huellaDe(`${entrada.activo}|${direccion}|${voces.map((v) => `${v.id}:${v.lado}:${v.veto ? 1 : 0}`).sort().join(",")}|${plan ? [plan.entrada, plan.stop, plan.tp1, plan.tp2, plan.tp3].join("/") : "-"}`);

  const debate: Linea[] = [{ quien: "JARVIS", nombre: "JARVIS", lado: "MODERA", texto: `Debatimos ${entrada.activo} en ${direccion === "LARGO" ? "largo" : "corto"}. Opinan ${opinan} y ${abstienen.length} se abstienen.` }];
  for (const v of aFavor.slice(0, 2)) debate.push({ quien: v.id, nombre: v.nombre, lado: v.lado, texto: `A favor: ${corto(v.motivo)}` });
  for (const v of enContra.slice(0, 2)) {
    debate.push({ quien: v.id, nombre: v.nombre, lado: v.lado, texto: `En contra: ${corto(v.motivo)}` });
    if (v.cambiaria) debate.push({ quien: v.id, nombre: v.nombre, lado: v.lado, texto: `Cambiaría de idea si: ${corto(v.cambiaria, 120)}` });
  }
  for (const v of espera.slice(0, 1)) debate.push({ quien: v.id, nombre: v.nombre, lado: v.lado, texto: `Espero: ${corto(v.motivo)}` });
  if (abstienen.length) debate.push({ quien: "JARVIS", nombre: "JARVIS", lado: "MODERA", texto: `Se abstienen: ${abstienen.slice(0, 3).map((v) => v.nombre).join(", ")}${abstienen.length > 3 ? ` y ${abstienen.length - 3} más` : ""}. ${abstienen[0].falta ? `Les falta: ${abstienen[0].falta}.` : ""}`.trim() });
  debate.push({ quien: "JARVIS", nombre: "JARVIS", lado: "MODERA", texto: `${veredicto}. ${razon} Decisión ${huella}. No es asesoramiento financiero.` });

  return { activo: entrada.activo, direccion, voces, aFavor, enContra, espera, abstienen, vetos, discrepancias, veredicto, razon, plan, destraba, debate, huella };
}

/** Un plan de Fibonacci (lib/mercado-ar-tecnico.ts) o de un agente, como plan común. */
export function planDe(fuente: string, p: { entrada: number; stop: number; tp1: number; tp2: number; tp3: number } | null): PlanComun | null {
  return p ? { ...p, fuente } : null;
}

export type { FamiliaMente };
