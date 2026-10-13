/**
 * Laboratorio en sombra de la mesa: busca, sin parar, variantes de filtro que
 * habrían rendido mejor que la mesa tal cual, y las mide hacia adelante.
 * Es puro: no lee la red, no guarda nada y no arma órdenes.
 *
 * QUÉ ES UNA VARIANTE. Un filtro sobre lo que la mesa ya sabía al abrir cada
 * operación (confluencia, consenso a favor, cobertura, R:R, distancia del stop,
 * lado y volatilidad), elegido dentro de una lista fija de valores (GENES). No
 * es código: la IA no escribe reglas ni ejecuta nada que haya generado.
 *
 * CÓMO EVOLUCIONA. Un algoritmo genético con semilla fija (mismo resultado en
 * cada corrida) cruza y muta las variantes. Solo avanza cuando llegan
 * operaciones cerradas nuevas: correrlo otra vez sobre los mismos datos solo
 * sobreajustaría más.
 *
 * TRES PASOS, sin mirar el futuro (criterio fijado antes de mirar):
 *   1. DESARROLLO: los primeros 2/3 de las operaciones (por hora de apertura),
 *      sin las que cerraron después de que empieza la validación. La evolución
 *      elige SOLO con esto.
 *   2. VALIDACIÓN: el tercio final. Pasa la que rinde más que la mesa y más
 *      que cero, con al menos 15 operaciones en cada período → EN OBSERVACIÓN.
 *   3. HACIA ADELANTE: solo operaciones abiertas DESPUÉS de que se descubrió,
 *      que nunca se usaron para elegir. Con 15 o más: APTA si rinde más que
 *      cero y más que la mesa en ese mismo tramo, con PSR (Sharpe > 0) de 0,95
 *      corregido por cuántas candidatas se miran a la vez, y si la búsqueda no
 *      está sobreajustada (PBO < 50%). DESCARTADA si rinde menos, o si con 60
 *      no se distingue del azar. Una APTA que deja de cumplir vuelve a EN
 *      OBSERVACIÓN, y queda registrado. El DSR de la búsqueda se informa.
 *
 * NADA CAMBIA SOLO. Una variante APTA queda para revisión. Solo pasa a filtrar
 * el papel si la persona la aprueba (aprobar), y se saca con revocar. Ninguna
 * de las dos cosas la hace el laboratorio por su cuenta, ni siquiera revocar
 * una aprobada que empeora: lo avisa. Nunca toca la ejecución real.
 */
import type { PaperTrade } from "./jarvis-paper.ts";
import { evaluarEstrategia, generadorAzar, MIN_MUESTRA, probabilidadDeSobreajuste } from "./jarvis-stats.ts";

export const GENES = [
  { id: "confianza", valores: [null, 40, 50, 60, 70] },
  { id: "consenso", valores: [null, 0.2, 0.3, 0.4, 0.5] },
  { id: "cobertura", valores: [null, 0.6, 0.7, 0.8] },
  { id: "rr", valores: [null, 1.5, 2, 2.5] },
  { id: "stop", valores: [null, 1, 2, 3] },
  { id: "lado", valores: [null, "LONG", "SHORT"] },
  { id: "regimen", valores: [null, "SIN COMPRIMIDA", "SIN EXPANDIDA"] },
] as const;

export type Genoma = number[];
/** Cuántas variantes distintas hay en total (la lista es fija). */
export const ESPACIO = GENES.reduce((p, g) => p * g.valores.length, 1);
/** La variante 0 no filtra nada: es la mesa tal cual, la referencia. */
export const BASE = 0;

export const POBLACION = 24;
export const ELITE = 6;
export const GENERACIONES_POR_CORRIDA = 6;
export const MUTACION = 0.25;
export const REVISADAS = 8;
export const MAX_CANDIDATAS = 20;
/** Hacia adelante: probabilidad de que el Sharpe sea mayor que cero (antes de corregir por candidatas). */
export const PSR_ADELANTE = 0.95;
/** Con tantas operaciones hacia adelante sin distinguirse del azar, se descarta. */
export const MAX_ADELANTE = 60;
export const PBO_MAX = 0.5;
/** Cota inferior de una cola al 90% (para la aptitud: media − z·desvío/√n). */
const Z_COTA = 1.2815515655446004;
export const TRAMOS_PBO = 16;
/** El PBO siempre con su muestra: en cuántos tramos de tiempo se midió. */
const textoPbo = (p: number | null) => (p === null ? "sin dato" : `${Math.round(p * 100)}% en ${TRAMOS_PBO} tramos`);

export function indiceDe(g: Genoma): number {
  let i = 0;
  for (let k = 0; k < GENES.length; k += 1) i = i * GENES[k].valores.length + g[k];
  return i;
}

export function genomaDe(indice: number): Genoma {
  const g: number[] = new Array(GENES.length).fill(0);
  let r = indice;
  for (let k = GENES.length - 1; k >= 0; k -= 1) {
    const b = GENES[k].valores.length;
    g[k] = r % b;
    r = Math.floor(r / b);
  }
  return g;
}

export function indiceValido(i: unknown): i is number {
  return typeof i === "number" && Number.isInteger(i) && i >= 0 && i < ESPACIO;
}

export const codigo = (indice: number) => `V-${String(indice).padStart(5, "0")}`;

const coma = (x: number, d = 2) => x.toFixed(d).replace(".", ",");

/** La variante en palabras. */
export function describir(indice: number): string {
  const g = genomaDe(indice);
  const partes: string[] = [];
  GENES.forEach((gen, k) => {
    const v = gen.valores[g[k]];
    if (v === null) return;
    if (gen.id === "confianza") partes.push(`confluencia ≥ ${v}`);
    else if (gen.id === "consenso") partes.push(`consenso a favor ≥ ${coma(v as number)}`);
    else if (gen.id === "cobertura") partes.push(`cobertura ≥ ${Math.round((v as number) * 100)}%`);
    else if (gen.id === "rr") partes.push(`R:R ≥ ${coma(v as number, 1)}`);
    else if (gen.id === "stop") partes.push(`stop ≤ ${v}%`);
    else if (gen.id === "lado") partes.push(v === "LONG" ? "solo largos" : "solo cortos");
    else partes.push(v === "SIN COMPRIMIDA" ? "sin volatilidad comprimida" : "sin volatilidad expandida");
  });
  return partes.length ? partes.join(" · ") : "sin filtro: la mesa tal cual";
}

/** Lo que la mesa sabía al abrir. Nada de lo que pasó después. */
export type Rasgos = {
  confianza: number;
  consensoFavor: number;
  cobertura: number;
  rr: number;
  stopPct: number;
  lado: "LONG" | "SHORT";
  regimen: string | null;
};

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export function rasgosDe(t: PaperTrade): Rasgos | null {
  const a = t.analisis;
  if (!a || !t.decision || (t.lado !== "LONG" && t.lado !== "SHORT")) return null;
  if (![t.confianza, a.consenso, a.cobertura, t.rrPlan, t.decision.stopPct].every(fin)) return null;
  return {
    confianza: t.confianza,
    consensoFavor: t.lado === "LONG" ? a.consenso : -a.consenso,
    cobertura: a.cobertura,
    rr: t.rrPlan,
    stopPct: t.decision.stopPct,
    lado: t.lado,
    regimen: a.regimen ?? null,
  };
}

/** Qué gen la deja afuera, en palabras; null si la variante la toma. */
export function motivoRechazo(indice: number, r: Rasgos): string | null {
  const g = genomaDe(indice);
  for (let k = 0; k < GENES.length; k += 1) {
    const v = GENES[k].valores[g[k]];
    if (v === null) continue;
    switch (GENES[k].id) {
      case "confianza":
        if (r.confianza < (v as number)) return `confluencia ${Math.round(r.confianza)}, pide ${v} o más`;
        break;
      case "consenso":
        if (r.consensoFavor < (v as number)) return `consenso a favor ${coma(r.consensoFavor)}, pide ${coma(v as number)} o más`;
        break;
      case "cobertura":
        if (r.cobertura < (v as number)) return `cobertura ${Math.round(r.cobertura * 100)}%, pide ${Math.round((v as number) * 100)}% o más`;
        break;
      case "rr":
        if (r.rr < (v as number)) return `R:R ${coma(r.rr)}, pide ${coma(v as number, 1)} o más`;
        break;
      case "stop":
        if (r.stopPct > (v as number)) return `stop a ${coma(r.stopPct)}%, pide ${v}% o menos`;
        break;
      case "lado":
        if (r.lado !== v) return v === "LONG" ? "solo toma largos" : "solo toma cortos";
        break;
      case "regimen":
        if (v === "SIN COMPRIMIDA" && r.regimen === "COMPRIMIDA") return "no toma volatilidad comprimida";
        if (v === "SIN EXPANDIDA" && r.regimen === "EXPANDIDA") return "no toma volatilidad expandida";
        break;
    }
  }
  return null;
}

export const toma = (indice: number, r: Rasgos) => motivoRechazo(indice, r) === null;

export type Caso = { id: string; origen: "papel" | "backtest"; abiertaA: number; cerradaA: number; r: number; rasgos: Rasgos };

/** Las operaciones cerradas con resultado, en orden de apertura. Una vez cada una. */
export function casosDe(papel: PaperTrade[], backtest: PaperTrade[] = []): Caso[] {
  const vistos = new Set<string>();
  const out: Caso[] = [];
  const sumar = (ts: PaperTrade[], origen: Caso["origen"]) => {
    for (const t of ts) {
      if (!t || t.estado !== "CERRADA" || !fin(t.resultadoR) || !fin(t.cerradaA) || !fin(t.abiertaA)) continue;
      const id = `${origen}:${t.id}`;
      if (vistos.has(id)) continue;
      const rasgos = rasgosDe(t);
      if (!rasgos) continue;
      vistos.add(id);
      out.push({ id, origen, abiertaA: t.abiertaA, cerradaA: t.cerradaA, r: t.resultadoR, rasgos });
    }
  };
  sumar(papel, "papel");
  sumar(backtest, "backtest");
  return out.sort((a, b) => a.abiertaA - b.abiertaA || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * DESARROLLO y VALIDACIÓN. Se purgan del desarrollo las operaciones que
 * cerraron después de que abrió la primera de validación: su resultado todavía
 * no se sabía cuando empieza la validación.
 */
export function periodos(casos: Caso[]): { desarrollo: Caso[]; validacion: Caso[] } {
  const c = Math.floor((casos.length * 2) / 3);
  if (c < 1 || c >= casos.length) return { desarrollo: [], validacion: [] };
  const corte = casos[c].abiertaA;
  return { desarrollo: casos.slice(0, c).filter((x) => x.cerradaA < corte), validacion: casos.slice(c) };
}

export type Medida = { n: number; media: number | null; cota: number | null };

export function medir(xs: number[]): Medida {
  const n = xs.length;
  if (!n) return { n, media: null, cota: null };
  const media = xs.reduce((a, x) => a + x, 0) / n;
  if (n < 2) return { n, media, cota: null };
  const v = xs.reduce((a, x) => a + (x - media) ** 2, 0) / (n - 1);
  return { n, media, cota: n >= MIN_MUESTRA ? media - (Z_COTA * Math.sqrt(v)) / Math.sqrt(n) : null };
}

export const tomados = (indice: number, casos: Caso[]) => casos.filter((c) => toma(indice, c.rasgos)).map((c) => c.r);

function sharpe(xs: number[]): number | null {
  const m = medir(xs);
  if (m.n < 2 || m.media === null) return null;
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - (m.media as number)) ** 2, 0) / (m.n - 1));
  return sd > 0 ? m.media / sd : null;
}

export type EstadoCandidata = "EN OBSERVACIÓN" | "APTA" | "DESCARTADA";
export type Candidata = {
  indice: number;
  descubiertaA: number;
  estado: EstadoCandidata;
  motivo: string;
  /** Hacia adelante: solo operaciones abiertas después de descubrirla. */
  adelante: { n: number; media: number | null; mesa: number | null };
  cambiadaA: number;
};

export type EstadoSombra = {
  version: 1;
  generacion: number;
  semilla: number;
  poblacion: number[];
  /** Qué variantes se probaron alguna vez: un bit por variante, en base64. */
  probadas: string;
  candidatas: Candidata[];
  aprobada: { indice: number; aprobadaA: number } | null;
  huella: string;
  casos: number;
  actualizadaA: number;
};

export type TipoEvento = "EVOLUCION" | "CANDIDATA" | "APTA" | "OBSERVACION" | "DESCARTADA" | "APROBACION" | "REVOCACION";
export type EventoSombra = { tipo: TipoEvento; datos: Record<string, unknown> };
/** Los que el laboratorio registra solo; aprobar y revocar los registra el servidor a pedido de la persona. */
export const EVENTOS_DEL_LABORATORIO: TipoEvento[] = ["EVOLUCION", "CANDIDATA", "APTA", "OBSERVACION", "DESCARTADA"];
/** Los que cambian el estado de una candidata: el último de cada variante es su estado registrado. */
export const EVENTOS_DE_ESTADO: TipoEvento[] = ["CANDIDATA", "OBSERVACION", "APTA", "DESCARTADA"];

const BYTES = Math.ceil(ESPACIO / 8);

function aBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 1) s += String.fromCharCode(b[i]);
  return btoa(s);
}

function deBase64(s: string): Uint8Array {
  const out = new Uint8Array(BYTES);
  try {
    const bin = atob(s);
    for (let i = 0; i < Math.min(bin.length, BYTES); i += 1) out[i] = bin.charCodeAt(i);
  } catch {
    /* vacío */
  }
  return out;
}

export function contarProbadas(probadas: string): number {
  const b = deBase64(probadas);
  let n = 0;
  for (let i = 0; i < b.length; i += 1) for (let x = b[i]; x; x &= x - 1) n += 1;
  return n;
}

function probadasLista(probadas: string): number[] {
  const b = deBase64(probadas);
  const out: number[] = [];
  for (let i = 0; i < ESPACIO; i += 1) if (b[i >> 3] & (1 << (i & 7))) out.push(i);
  return out;
}

/** Una huella de los datos: si no cambió, no hay nada nuevo que aprender. */
export function huellaDe(casos: Caso[]): string {
  let h = 2166136261;
  const mezclar = (s: string) => {
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  };
  for (const c of casos) mezclar(`${c.id}|${c.abiertaA}|${c.r}`);
  return `${casos.length}-${(h >>> 0).toString(16).padStart(8, "0")}`;
}

export function estadoInicial(semilla = 20261013): EstadoSombra {
  const azar = generadorAzar(semilla);
  const pob = new Set<number>([BASE]);
  while (pob.size < POBLACION) pob.add(Math.floor(azar() * ESPACIO));
  return { version: 1, generacion: 0, semilla, poblacion: [...pob], probadas: aBase64(new Uint8Array(BYTES)), candidatas: [], aprobada: null, huella: "", casos: 0, actualizadaA: 0 };
}

const redondo = (x: number | null) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 10000) / 10000);
const resumenMedida = (m: Medida) => ({ n: m.n, media: redondo(m.media) });

/**
 * Una corrida: si hay datos nuevos, evoluciona unas generaciones, busca
 * candidatas nuevas y mide hacia adelante las que ya había. Devuelve el
 * estado nuevo y lo que hay que dejar en la auditoría.
 */
export function evolucionar(estado: EstadoSombra, casos: Caso[], ahora: number): { estado: EstadoSombra; eventos: EventoSombra[]; cambio: boolean } {
  const huella = huellaDe(casos);
  if (huella === estado.huella) return { estado, eventos: [], cambio: false };

  const eventos: EventoSombra[] = [];
  const { desarrollo, validacion } = periodos(casos);
  const bits = deBase64(estado.probadas);
  const marcar = (i: number) => {
    bits[i >> 3] |= 1 << (i & 7);
  };

  const memo = new Map<number, number | null>();
  const aptitud = (i: number): number | null => {
    if (!memo.has(i)) {
      marcar(i);
      memo.set(i, medir(tomados(i, desarrollo)).cota);
    }
    return memo.get(i) ?? null;
  };
  const orden = (a: number, b: number) => (aptitud(b) ?? -Infinity) - (aptitud(a) ?? -Infinity) || a - b;

  let poblacion = estado.poblacion.filter(indiceValido);
  let generacion = estado.generacion;
  const hayMuestra = desarrollo.length >= MIN_MUESTRA && validacion.length >= MIN_MUESTRA;

  if (hayMuestra) {
    const azar = generadorAzar((estado.semilla ^ Math.imul(generacion + 1, 2654435761)) >>> 0);
    const pick = (lista: number[]) => lista[Math.floor(azar() * lista.length)];
    for (let k = 0; k < GENERACIONES_POR_CORRIDA; k += 1) {
      const ordenada = [...new Set(poblacion)].sort(orden);
      const nueva = new Set<number>(ordenada.slice(0, ELITE));
      const padres = ordenada.slice(0, Math.max(ELITE, Math.ceil(ordenada.length / 2)));
      let intentos = 0;
      while (nueva.size < POBLACION && intentos < POBLACION * 20) {
        intentos += 1;
        const a = genomaDe(pick(padres));
        const b = genomaDe(pick(padres));
        const hijo = a.map((x, j) => (azar() < 0.5 ? x : b[j]));
        for (let j = 0; j < hijo.length; j += 1) {
          if (azar() < MUTACION) {
            const n = GENES[j].valores.length;
            hijo[j] = azar() < 0.5 ? Math.max(0, Math.min(n - 1, hijo[j] + (azar() < 0.5 ? -1 : 1))) : Math.floor(azar() * n);
          }
        }
        nueva.add(indiceDe(hijo));
      }
      poblacion = [...nueva];
      generacion += 1;
    }
    poblacion.forEach(aptitud);
    poblacion.sort(orden);
  }

  const baseDes = medir(tomados(BASE, desarrollo));
  const baseVal = medir(tomados(BASE, validacion));

  // La corrección por azar cuenta todas las variantes probadas alguna vez que podían ser elegidas
  // (con 15 operaciones o más en desarrollo): las de muestra mínima nunca compiten y su Sharpe es puro ruido.
  const probadas = probadasLista(aBase64(bits));
  const srVariantes = probadas
    .map((i) => tomados(i, desarrollo))
    .filter((xs) => xs.length >= MIN_MUESTRA)
    .map(sharpe)
    .filter((x): x is number => x !== null);

  let pbo: number | null = null;
  if (hayMuestra && casos.length >= TRAMOS_PBO * 2) {
    const cols = [...new Set([BASE, ...poblacion])];
    const largo = casos.length / TRAMOS_PBO;
    const matriz: number[][] = [];
    for (let t = 0; t < TRAMOS_PBO; t += 1) {
      const tramo = casos.slice(Math.floor(t * largo), Math.floor((t + 1) * largo));
      matriz.push(cols.map((i) => tomados(i, tramo).reduce((a, x) => a + x, 0)));
    }
    pbo = probabilidadDeSobreajuste(matriz, 8)?.pbo ?? null;
  }

  // Candidatas nuevas: pasan desarrollo y validación. Desde ahora se miden hacia adelante.
  let candidatas = estado.candidatas.map((c) => ({ ...c, adelante: { ...c.adelante } }));
  const conocidas = new Set(candidatas.map((c) => c.indice));
  if (hayMuestra) {
    for (const i of poblacion.slice(0, REVISADAS)) {
      if (i === BASE || conocidas.has(i)) continue;
      const des = medir(tomados(i, desarrollo));
      const val = medir(tomados(i, validacion));
      const pasa =
        des.cota !== null && baseDes.cota !== null && des.cota > baseDes.cota && (des.media ?? 0) > 0 &&
        val.n >= MIN_MUESTRA && val.media !== null && val.media > 0 && baseVal.media !== null && val.media > baseVal.media;
      if (!pasa) continue;
      conocidas.add(i);
      candidatas.push({ indice: i, descubiertaA: ahora, estado: "EN OBSERVACIÓN", motivo: "Pasó desarrollo y validación. Falta medirla hacia adelante, con operaciones que todavía no existían.", adelante: { n: 0, media: null, mesa: null }, cambiadaA: ahora });
      eventos.push({ tipo: "CANDIDATA", datos: { variante: codigo(i), indice: i, descripcion: describir(i), desarrollo: resumenMedida(des), validacion: resumenMedida(val), mesa: { desarrollo: resumenMedida(baseDes), validacion: resumenMedida(baseVal) } } });
    }
  }

  // Hacia adelante: solo lo que abrió después de descubrirla. Esos datos nunca se usaron para
  // elegir, así que no hace falta corregir por la búsqueda: se pide que el Sharpe sea mayor que
  // cero con PSR alto, corregido (Bonferroni) por cuántas candidatas se miran a la vez.
  const mirando = Math.max(1, candidatas.filter((c) => c.estado !== "DESCARTADA").length);
  const exigencia = 1 - (1 - PSR_ADELANTE) / mirando;
  for (const c of candidatas) {
    if (c.estado === "DESCARTADA") continue;
    const despues = casos.filter((x) => x.abiertaA > c.descubiertaA);
    const xs = tomados(c.indice, despues);
    const suyas = medir(xs);
    const mesa = medir(tomados(BASE, despues));
    c.adelante = { n: suyas.n, media: redondo(suyas.media), mesa: redondo(mesa.media) };
    if (suyas.n < MIN_MUESTRA || (estado.aprobada && estado.aprobada.indice === c.indice)) continue;
    const psr0 = evaluarEstrategia(xs).psr0;
    const dsrBusqueda = evaluarEstrategia(tomados(c.indice, desarrollo), srVariantes).dsr;
    const gana = suyas.media !== null && suyas.media > 0 && mesa.media !== null && suyas.media > mesa.media;
    const firme = psr0 !== null && psr0 >= exigencia;
    const sinSobreajuste = pbo !== null && pbo < PBO_MAX;
    let nuevo: EstadoCandidata;
    let motivo: string;
    if (gana && firme && sinSobreajuste) {
      nuevo = "APTA";
      motivo = `Apta para revisión: hacia adelante rinde ${coma(suyas.media as number, 3)} R contra ${coma(mesa.media as number, 3)} R de la mesa, PSR ${coma(psr0 as number)} con ${suyas.n} operaciones. No filtra nada hasta que la apruebes.`;
    } else if (!gana || suyas.n >= MAX_ADELANTE) {
      const fallas: string[] = [];
      if (!(suyas.media !== null && suyas.media > 0)) fallas.push("hacia adelante no rinde más que cero");
      if (!(suyas.media !== null && mesa.media !== null && suyas.media > mesa.media)) fallas.push("hacia adelante no rinde más que la mesa");
      if (gana && !firme) fallas.push(`con ${suyas.n} operaciones no se distingue del azar (PSR ${psr0 === null ? "sin dato" : coma(psr0)}, pide ${coma(exigencia, 3)})`);
      if (gana && firme && !sinSobreajuste) fallas.push(`la búsqueda está sobreajustada (PBO ${textoPbo(pbo)}, pide menos de 50%)`);
      nuevo = "DESCARTADA";
      motivo = `Descartada: ${fallas.join("; ")}.`;
    } else {
      // Gana, pero la evidencia todavía no alcanza. Una APTA que deja de cumplir vuelve acá: no sigue apta por inercia.
      nuevo = "EN OBSERVACIÓN";
      const falta = `PSR ${psr0 === null ? "sin dato" : coma(psr0)} (pide ${coma(exigencia, 3)})${sinSobreajuste ? "" : `, PBO ${textoPbo(pbo)} (pide menos de 50%)`}`;
      motivo =
        c.estado === "APTA"
          ? `Volvió a observación: con ${suyas.n} operaciones hacia adelante ya no alcanza (${falta}). Sigue en observación hasta ${MAX_ADELANTE} operaciones.`
          : `Va mejor que la mesa hacia adelante, pero todavía no alcanza: ${falta}. Sigue en observación hasta ${MAX_ADELANTE} operaciones.`;
    }
    c.motivo = motivo;
    if (nuevo === c.estado) continue;
    c.estado = nuevo;
    c.cambiadaA = ahora;
    eventos.push({ tipo: nuevo === "EN OBSERVACIÓN" ? "OBSERVACION" : nuevo, datos: { variante: codigo(c.indice), indice: c.indice, descripcion: describir(c.indice), adelante: c.adelante, psr: redondo(psr0), exigencia: redondo(exigencia), dsrBusqueda: redondo(dsrBusqueda), pbo: redondo(pbo), motivo } });
  }

  // Se guardan todas las vivas y las últimas descartadas.
  const vivas = candidatas.filter((c) => c.estado !== "DESCARTADA");
  const descartadas = candidatas.filter((c) => c.estado === "DESCARTADA").sort((a, b) => b.cambiadaA - a.cambiadaA);
  candidatas = [...vivas, ...descartadas].slice(0, Math.max(MAX_CANDIDATAS, vivas.length));

  const papel = casos.filter((c) => c.origen === "papel").length;
  if (hayMuestra) {
    const mejor = poblacion[0];
    eventos.unshift({
      tipo: "EVOLUCION",
      datos: {
        generacion,
        semilla: estado.semilla,
        datos: { casos: casos.length, papel, backtest: casos.length - papel, desarrollo: desarrollo.length, validacion: validacion.length, huella },
        probadas: probadas.length,
        espacio: ESPACIO,
        mejor: { variante: codigo(mejor), descripcion: describir(mejor), desarrollo: resumenMedida(medir(tomados(mejor, desarrollo))) },
        mesa: { desarrollo: resumenMedida(baseDes), validacion: resumenMedida(baseVal) },
        pbo: redondo(pbo),
      },
    });
  }

  return {
    estado: { ...estado, generacion, poblacion, probadas: aBase64(bits), candidatas, huella, casos: casos.length, actualizadaA: ahora },
    eventos,
    cambio: true,
  };
}

export type Resultado = { ok: true; estado: EstadoSombra; evento: EventoSombra } | { ok: false; error: string };

/** Solo una APTA, solo a pedido de la persona y de a una por vez. */
export function aprobar(estado: EstadoSombra, indice: number, ahora: number): Resultado {
  if (estado.aprobada) return { ok: false, error: `Ya hay una variante aprobada (${codigo(estado.aprobada.indice)}): revocala primero.` };
  const c = estado.candidatas.find((x) => x.indice === indice);
  if (!c || c.estado !== "APTA") return { ok: false, error: "Solo se puede aprobar una variante APTA: que haya cumplido desarrollo, validación y hacia adelante." };
  return {
    ok: true,
    estado: { ...estado, aprobada: { indice, aprobadaA: ahora } },
    evento: { tipo: "APROBACION", datos: { variante: codigo(indice), indice, descripcion: describir(indice), adelante: c.adelante, efecto: "Desde ahora filtra las operaciones de papel nuevas. No toca la ejecución real." } },
  };
}

export function revocar(estado: EstadoSombra, ahora: number, motivo: string): Resultado {
  if (!estado.aprobada) return { ok: false, error: "No hay ninguna variante aprobada." };
  const i = estado.aprobada.indice;
  return {
    ok: true,
    estado: { ...estado, aprobada: null, actualizadaA: ahora },
    evento: { tipo: "REVOCACION", datos: { variante: codigo(i), indice: i, descripcion: describir(i), aprobadaA: estado.aprobada.aprobadaA, motivo: String(motivo || "Revocada a mano.").slice(0, 200) } },
  };
}

/** Lo que manda el navegador se revisa entero: tipos, rangos y tamaños. */
export function validarEstado(raw: unknown): EstadoSombra | null {
  const e = raw as EstadoSombra;
  if (!e || typeof e !== "object" || e.version !== 1) return null;
  if (![e.generacion, e.semilla, e.casos, e.actualizadaA].every((x) => Number.isInteger(x) && x >= 0)) return null;
  if (!Array.isArray(e.poblacion) || e.poblacion.length > POBLACION * 2 || !e.poblacion.every(indiceValido)) return null;
  if (typeof e.probadas !== "string" || e.probadas.length > Math.ceil(BYTES / 3) * 4 + 4) return null;
  if (typeof e.huella !== "string" || e.huella.length > 40) return null;
  if (!Array.isArray(e.candidatas) || e.candidatas.length > MAX_CANDIDATAS + POBLACION) return null;
  for (const c of e.candidatas) {
    if (!c || !indiceValido(c.indice) || !["EN OBSERVACIÓN", "APTA", "DESCARTADA"].includes(c.estado)) return null;
    if (!fin(c.descubiertaA) || !fin(c.cambiadaA) || typeof c.motivo !== "string" || c.motivo.length > 600) return null;
    if (!c.adelante || !Number.isInteger(c.adelante.n) || c.adelante.n < 0) return null;
    if (![c.adelante.media, c.adelante.mesa].every((x) => x === null || fin(x))) return null;
  }
  if (e.aprobada !== null && (!e.aprobada || !indiceValido(e.aprobada.indice) || !fin(e.aprobada.aprobadaA))) return null;
  return e;
}

export type ResumenSombra = {
  generacion: number;
  probadas: number;
  espacio: number;
  datos: { casos: number; papel: number; backtest: number; desarrollo: number; validacion: number };
  mesa: { desarrollo: { n: number; media: number | null }; validacion: { n: number; media: number | null } };
  mejores: { variante: string; descripcion: string; desarrollo: { n: number; media: number | null }; validacion: { n: number; media: number | null } }[];
  candidatas: { indice: number; variante: string; descripcion: string; estado: EstadoCandidata; motivo: string; adelante: { n: number; media: number | null; mesa: number | null }; falta: number }[];
  aprobada: { indice: number; variante: string; descripcion: string; aprobadaA: number; adelante: { n: number; media: number | null; mesa: number | null }; aviso: string | null } | null;
  nota: string;
};

/** La foto para mostrar: números finitos o null, nada inventado. */
export function resumirSombra(estado: EstadoSombra, casos: Caso[]): ResumenSombra {
  const { desarrollo, validacion } = periodos(casos);
  const papel = casos.filter((c) => c.origen === "papel").length;
  const mejores = estado.poblacion
    .filter((i) => i !== BASE)
    .slice(0, 3)
    .map((i) => ({ variante: codigo(i), descripcion: describir(i), desarrollo: resumenMedida(medir(tomados(i, desarrollo))), validacion: resumenMedida(medir(tomados(i, validacion))) }));
  const orden: Record<EstadoCandidata, number> = { APTA: 0, "EN OBSERVACIÓN": 1, DESCARTADA: 2 };
  const candidatas = [...estado.candidatas]
    .sort((a, b) => orden[a.estado] - orden[b.estado] || b.cambiadaA - a.cambiadaA)
    .slice(0, 8)
    .map((c) => ({ indice: c.indice, variante: codigo(c.indice), descripcion: describir(c.indice), estado: c.estado, motivo: c.motivo, adelante: c.adelante, falta: Math.max(0, MIN_MUESTRA - c.adelante.n) }));
  let aprobada: ResumenSombra["aprobada"] = null;
  if (estado.aprobada) {
    const { indice, aprobadaA } = estado.aprobada;
    const despues = casos.filter((x) => x.abiertaA > aprobadaA);
    const suyas = medir(tomados(indice, despues));
    const mesa = medir(tomados(BASE, despues));
    const aviso =
      suyas.n >= MIN_MUESTRA && suyas.media !== null && mesa.media !== null && (suyas.media <= 0 || suyas.media <= mesa.media)
        ? "Desde que la aprobaste no rinde más que cero o que la mesa. El laboratorio no la saca solo: decidí vos si revocarla."
        : null;
    aprobada = { indice, variante: codigo(indice), descripcion: describir(indice), aprobadaA, adelante: { n: suyas.n, media: redondo(suyas.media), mesa: redondo(mesa.media) }, aviso };
  }
  const nota =
    casos.length === 0
      ? "Todavía no hay operaciones cerradas: el laboratorio aprende de papel cerrado y del último backtest."
      : desarrollo.length < MIN_MUESTRA || validacion.length < MIN_MUESTRA
        ? `Muestra mínima: hay ${casos.length} operaciones cerradas y hacen falta al menos ${MIN_MUESTRA} en desarrollo y ${MIN_MUESTRA} en validación para evolucionar.`
        : "Evoluciona solo cuando llegan operaciones cerradas nuevas. Lo que encuentra se mide hacia adelante antes de poder aprobarse.";
  return {
    generacion: estado.generacion,
    probadas: contarProbadas(estado.probadas),
    espacio: ESPACIO,
    datos: { casos: casos.length, papel, backtest: casos.length - papel, desarrollo: desarrollo.length, validacion: validacion.length },
    mesa: { desarrollo: resumenMedida(medir(tomados(BASE, desarrollo))), validacion: resumenMedida(medir(tomados(BASE, validacion))) },
    mejores,
    candidatas,
    aprobada,
    nota,
  };
}

/** Un evento de la auditoría en una línea, para la araña. */
export function textoEvento(tipo: string, datos: Record<string, unknown>): string {
  const v = typeof datos.variante === "string" ? datos.variante : "una variante";
  const d = typeof datos.descripcion === "string" ? `: ${datos.descripcion}` : "";
  switch (tipo) {
    case "EVOLUCION": {
      const mejor = datos.mejor as { variante?: string } | undefined;
      return `Generación ${String(datos.generacion ?? "?")}: ${String(datos.probadas ?? "?")} variantes probadas en total${mejor?.variante ? `, la mejor en desarrollo es ${mejor.variante}` : ""}.`;
    }
    case "CANDIDATA":
      return `${v} pasó desarrollo y validación; ahora se mide hacia adelante${d}.`;
    case "APTA":
      return `${v} quedó apta para revisión${d}.`;
    case "OBSERVACION":
      return `${v} volvió a observación${typeof datos.motivo === "string" ? `. ${datos.motivo.replace(/^Volvió a observación: /, "")}` : "."}`;
    case "DESCARTADA":
      return `${v} descartada${typeof datos.motivo === "string" ? `. ${datos.motivo.replace(/^Descartada: /, "")}` : "."}`;
    case "APROBACION":
      return `Aprobaste ${v}${d}. Filtra el papel nuevo.`;
    case "REVOCACION":
      return `Revocaste ${v}${typeof datos.motivo === "string" ? ` (${datos.motivo})` : ""}.`;
    default:
      return `Evento ${tipo}.`;
  }
}
