/**
 * Corre el laboratorio en sombra en el navegador (la CPU del Worker no alcanza
 * y Binance no le responde a los crons): junta el papel cerrado y el último
 * backtest, evoluciona si hay datos nuevos y guarda la corrida en la auditoría
 * de la cuenta. Aprobar y revocar solo pasan cuando la persona lo pide.
 * Sin sesión corre igual, pero en memoria: no queda registro ni se puede aprobar.
 */
import { lastBacktest } from "./jarvis-backtest-run.ts";
import { loadPaper, paperTrades } from "./jarvis-paper-run.ts";
import { verificarCadena, type EventoAuditado, type Verificacion } from "./mesa-sombra-auditoria.ts";
import { fijarFiltro } from "./mesa-sombra-filtro.ts";
import { casosDe, estadoInicial, evolucionar, resumirSombra, type Caso, type EstadoSombra, type ResumenSombra } from "./mesa-sombra.ts";

export const SOMBRA_EVENT = "alt-radar:mesa-sombra";
export const MAX_EVENTOS_VISTOS = 40;

export type ModoSombra = "cargando" | "cuenta" | "sin sesión" | "error";
export type EstadoLaboratorio = {
  estado: EstadoSombra;
  /** Los últimos eventos de la auditoría, del más nuevo al más viejo. */
  eventos: EventoAuditado[];
  cadena: Verificacion | null;
  modo: ModoSombra;
  corriendo: boolean;
  error: string | null;
  aviso: string | null;
  corridaA: number | null;
};

let store: EstadoLaboratorio = { estado: estadoInicial(), eventos: [], cadena: null, modo: "cargando", corriendo: false, error: null, aviso: null, corridaA: null };
let cargando: Promise<EstadoLaboratorio> | null = null;

function emit() {
  // La compuerta del papel sigue a la cuenta. Si la cuenta no se pudo leer no se toca: la compuerta la vuelve a pedir sola.
  if (store.modo === "cuenta") fijarFiltro(store.estado.aprobada?.indice ?? null);
  else if (store.modo === "sin sesión") fijarFiltro(null);
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") window.dispatchEvent(new Event(SOMBRA_EVENT));
}

export function laboratorio(): Readonly<EstadoLaboratorio> {
  return store;
}

export function casosActuales(): Caso[] {
  return casosDe(paperTrades(), lastBacktest()?.trades ?? []);
}

export function resumenActual(): ResumenSombra {
  return resumirSombra(store.estado, casosActuales());
}

async function sumarEventos(nuevos: EventoAuditado[]) {
  const porSeq = new Map(store.eventos.map((e) => [e.seq, e]));
  for (const e of nuevos) porSeq.set(e.seq, e);
  const eventos = [...porSeq.values()].sort((a, b) => b.seq - a.seq).slice(0, MAX_EVENTOS_VISTOS);
  store = { ...store, eventos, cadena: await verificarCadena(eventos) };
}

export async function cargarSombra(force = false): Promise<EstadoLaboratorio> {
  // Ya cargado, no se vuelve a pedir; si falló (un corte de red), se reintenta en la próxima vuelta.
  if ((store.modo === "cuenta" || store.modo === "sin sesión") && !force) return store;
  if (cargando) return cargando;
  cargando = (async () => {
    try {
      const r = await fetch("/api/jarvis/sombra", { cache: "no-store" });
      if (r.ok) {
        const d = (await r.json()) as { estado?: EstadoSombra | null; eventos?: EventoAuditado[] };
        store = { ...store, estado: d.estado ?? estadoInicial(), eventos: [], modo: "cuenta", error: null };
        await sumarEventos(d.eventos ?? []);
      } else if (r.status === 401) {
        store = { ...store, modo: "sin sesión", error: null, aviso: "Sin sesión el laboratorio corre en memoria: no queda auditoría ni se puede aprobar una variante." };
      } else {
        store = { ...store, modo: "error", error: "No se pudo leer el laboratorio de tu cuenta. Probá en un rato." };
      }
    } catch {
      store = { ...store, modo: "error", error: "Sin conexión con el laboratorio de tu cuenta." };
    }
    emit();
    return store;
  })().finally(() => {
    cargando = null;
  });
  return cargando;
}

let enCurso: Promise<void> | null = null;

/** Una corrida: solo hace algo si llegaron operaciones cerradas nuevas. Si ya hay una en curso, espera esa. */
export function correrSombra(ahora = Date.now()): Promise<void> {
  if (!enCurso) {
    enCurso = corrida(ahora).finally(() => {
      enCurso = null;
    });
  }
  return enCurso;
}

async function corrida(ahora: number): Promise<void> {
  await cargarSombra();
  if (store.modo === "error") return;
  await loadPaper();
  store = { ...store, corriendo: true };
  emit();
  try {
    const r = evolucionar(store.estado, casosActuales(), ahora);
    if (!r.cambio) return;
    if (store.modo !== "cuenta") {
      store = { ...store, estado: r.estado, corridaA: ahora };
      return;
    }
    const res = await fetch("/api/jarvis/sombra", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "guardar", estado: r.estado, eventos: r.eventos }) });
    const d = (await res.json().catch(() => ({}))) as { estado?: EstadoSombra; eventos?: EventoAuditado[]; error?: string };
    if (res.ok && d.estado) {
      store = { ...store, estado: d.estado, corridaA: ahora, aviso: null, error: null };
      await sumarEventos(d.eventos ?? []);
    } else if (res.status === 429) {
      // Lo que no se registra no cuenta: la corrida se descarta y se repite sola en la próxima vuelta.
      store = { ...store, aviso: d.error ?? "La auditoría registra una evolución cada 20 minutos: se vuelve a intentar sola." };
    } else if (res.status === 409 || res.status === 403) {
      // Otra pestaña guardó antes, o aprobaste o revocaste en otro lado: se vuelve a leer la cuenta.
      store = { ...store, modo: "cargando" };
      await cargarSombra(true);
    } else {
      store = { ...store, error: d.error ?? "No se pudo guardar la corrida del laboratorio." };
    }
  } finally {
    store = { ...store, corriendo: false };
    emit();
  }
}

async function pedir(cuerpo: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> {
  await cargarSombra();
  if (store.modo !== "cuenta") return { ok: false, error: "Aprobar o revocar una variante necesita sesión iniciada: así queda en la auditoría de tu cuenta." };
  const res = await fetch("/api/jarvis/sombra", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...cuerpo, confirmo: true }) });
  const d = (await res.json().catch(() => ({}))) as { estado?: EstadoSombra; eventos?: EventoAuditado[]; error?: string };
  if (!res.ok || !d.estado) return { ok: false, error: d.error ?? "No se pudo guardar tu decisión." };
  store = { ...store, estado: d.estado, error: null };
  await sumarEventos(d.eventos ?? []);
  emit();
  return { ok: true };
}

export const aprobarVariante = (indice: number) => pedir({ accion: "aprobar", indice });
export const revocarVariante = (motivo: string) => pedir({ accion: "revocar", motivo });
