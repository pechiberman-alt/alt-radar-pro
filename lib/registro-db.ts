/**
 * La lectura del registro unificado desde la base (lib/registro.ts hace la cuenta). Cada fuente se lee con una consulta
 * acotada: los contadores globales de JARVIS vienen de su tabla de totales (pocas filas), y las de tu cuenta, de tus
 * propias filas, por índice y con LIMIT, las más recientes primero. Sin COUNT(*) sobre tablas que crecen: el conteo
 * se hace en memoria sobre a lo sumo LIMITE_HISTORIA filas por fuente, y si hay más o hay filas ilegibles, la fuente
 * se marca como incompleta. Si una fuente no se puede leer, dice «sin datos»: nunca cero.
 */
import type { CoreCounters } from "./jarvis-core.ts";
import { readCoreCounters } from "./jarvis-core-db.ts";
import type { PaperTrade } from "./jarvis-paper.ts";
import { ensurePaperSchema } from "./jarvis-paper-db.ts";
import { ensureRobotLedger } from "./robot-ledger-db.ts";
import { resultadosSt } from "./agente-st-db.ts";
import { resultadosFlujo } from "./flujo-db.ts";
import { armarRegistro, type Cierre, CONTEO_CERO, contar, type Conteo, type EntradaRegistro, type OperacionLeida, type Registro, sumarConteos } from "./registro.ts";
import { sharedJson } from "./shared-cache.ts";

/** Cuántas operaciones por fuente se leen como mucho. Si la cuenta llega a este tope, la fuente queda incompleta. */
export const LIMITE_HISTORIA = 1000;

/** De un contador de JARVIS (fila de jarvis_core_stats) al conteo del registro. Sin fila: cero conocido. */
export function conteoDeNucleo(c: CoreCounters | undefined): Conteo {
  if (!c) return { ...CONTEO_CERO };
  return {
    abiertas: c.open,
    cerradas: c.resolved,
    ganadas: c.wins,
    perdidas: c.losses,
    empatadas: Math.max(0, c.resolved - c.wins - c.losses),
    ganado: c.gain,
    perdido: c.loss,
    neto: c.total,
  };
}

/** Del diario de papel: cerradas con su R; pendientes y abiertas cuentan como sin cerrar; canceladas no son operaciones. */
export function operacionesDePapel(filas: { data: string }[]): { ops: OperacionLeida[]; ilegibles: number; cierres: Cierre[]; desde: number | null } {
  const ops: OperacionLeida[] = [];
  const cierres: Cierre[] = [];
  let desde: number | null = null;
  let ilegibles = 0;
  for (const f of filas) {
    let t: PaperTrade;
    try {
      t = JSON.parse(f.data) as PaperTrade;
    } catch {
      ilegibles += 1;
      continue;
    }
    if (t.estado === "CANCELADA") continue;
    if (typeof t.abiertaA === "number" && (desde === null || t.abiertaA < desde)) desde = t.abiertaA;
    if (t.estado === "PENDIENTE" || t.estado === "ABIERTA") ops.push({ r: null, abierta: true });
    else if (t.estado === "CERRADA") {
      const r = typeof t.resultadoR === "number" ? t.resultadoR : null;
      ops.push({ r, abierta: false });
      if (r !== null && typeof t.cerradaA === "number") cierres.push({ r, cerradaA: t.cerradaA, abiertaA: typeof t.abiertaA === "number" ? t.abiertaA : null });
    }
  }
  return { ops, ilegibles, cierres, desde };
}

/** Del robot MM y del flujo de órdenes: las que siguen abiertas, y las cerradas con su R. */
export function operacionesDeRobot(filas: { r: number | null; desenlace: string }[]): OperacionLeida[] {
  return filas.map((f) => (f.desenlace === "ABIERTA" ? { r: null, abierta: true } : { r: f.r, abierta: false }));
}

/** Del robot MM y del flujo: las cerradas con su R y su hora de cierre, y la primera detectada (desde cuándo opera). */
export function cierresDeFilas(filas: { r: number | null; desenlace: string; cerrada?: number | null; detectada?: number | null }[]): { cierres: Cierre[]; desde: number | null } {
  const cierres: Cierre[] = [];
  let desde: number | null = null;
  for (const f of filas) {
    if (typeof f.detectada === "number" && (desde === null || f.detectada < desde)) desde = f.detectada;
    if (f.desenlace !== "ABIERTA" && typeof f.r === "number" && Number.isFinite(f.r) && typeof f.cerrada === "number") {
      cierres.push({ r: f.r, cerradaA: f.cerrada, abiertaA: typeof f.detectada === "number" ? f.detectada : null });
    }
  }
  return { cierres, desde };
}

/** Las filas del núcleo de JARVIS (cerradas, con fuente) repartidas por fuente del registro. */
export type FilaNucleo = { source: string; taken: number; r: number | null; closed_at: number | null; created_at: number };
export function cierresDeNucleo(filas: FilaNucleo[]): Record<string, { cierres: Cierre[]; desde: number | null }> {
  const out: Record<string, { cierres: Cierre[]; desde: number | null }> = {};
  for (const f of filas) {
    const clave = f.taken ? f.source : `${f.source}~SOMBRA`;
    const g = (out[clave] ??= { cierres: [], desde: null });
    if (g.desde === null || f.created_at < g.desde) g.desde = f.created_at;
    if (typeof f.r === "number" && Number.isFinite(f.r) && typeof f.closed_at === "number") g.cierres.push({ r: f.r, cerradaA: f.closed_at, abiertaA: f.created_at });
  }
  return out;
}

const juntar = (gs: ({ cierres: Cierre[]; desde: number | null } | undefined)[]) => {
  const v = gs.filter((g): g is { cierres: Cierre[]; desde: number | null } => g !== undefined);
  const desdes = v.map((g) => g.desde).filter((d): d is number => d !== null);
  return { cierres: v.flatMap((g) => g.cierres), desde: desdes.length ? Math.min(...desdes) : null };
};

async function seguro<T>(etiqueta: string, leer: () => Promise<T>): Promise<T | null> {
  try {
    return await leer();
  } catch (e) {
    // La fuente queda «sin datos»; el error va al log sin datos de la persona.
    console.error(`[registro] ${etiqueta}: ${e instanceof Error ? e.name : "error"}`);
    return null;
  }
}

/**
 * Las cerradas del núcleo de JARVIS, para la curva del capital: por el índice de cierre, las más recientes, con tope.
 * Es global y la misma para todos: se comparte 5 minutos entre todas las pestañas (no se relee en cada pedido).
 */
async function leerCierresNucleo(db: D1Database): Promise<FilaNucleo[]> {
  return sharedJson("registro-nucleo-cierres", 300, async () =>
    (
      await db
        .prepare("SELECT source, taken, r, closed_at, created_at FROM jarvis_core_signals WHERE closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT ?1")
        .bind(LIMITE_HISTORIA)
        .all<FilaNucleo>()
    ).results,
  );
}

type Lectura = { conteo: Conteo; incompleta: boolean; cierres: Cierre[]; desde: number | null };

async function leerPapel(db: D1Database, userId: number): Promise<Lectura> {
  await ensurePaperSchema(db);
  const filas = (
    await db.prepare("SELECT data FROM jarvis_paper WHERE user_id = ?1 ORDER BY abierta_a DESC LIMIT ?2").bind(userId, LIMITE_HISTORIA).all<{ data: string }>()
  ).results;
  const { ops, ilegibles, cierres, desde } = operacionesDePapel(filas);
  return { conteo: contar(ops), incompleta: filas.length >= LIMITE_HISTORIA || ilegibles > 0, cierres, desde };
}

async function leerFlujo(db: D1Database, userId: number): Promise<Lectura> {
  const filas = await resultadosFlujo(db, userId, LIMITE_HISTORIA);
  return { conteo: contar(operacionesDeRobot(filas)), incompleta: filas.length >= LIMITE_HISTORIA, ...cierresDeFilas(filas) };
}

async function leerAgenteSt(db: D1Database, userId: number): Promise<Lectura> {
  const filas = await resultadosSt(db, userId, LIMITE_HISTORIA);
  return { conteo: contar(operacionesDeRobot(filas)), incompleta: filas.length >= LIMITE_HISTORIA, ...cierresDeFilas(filas) };
}

async function leerRobot(db: D1Database, userId: number): Promise<Lectura> {
  await ensureRobotLedger(db);
  const filas = (
    await db
      .prepare("SELECT r, desenlace, cerrada, detectada FROM robot_senales WHERE user_id = ?1 ORDER BY vela DESC LIMIT ?2")
      .bind(userId, LIMITE_HISTORIA)
      .all<{ r: number | null; desenlace: string; cerrada: number | null; detectada: number | null }>()
  ).results;
  return { conteo: contar(operacionesDeRobot(filas)), incompleta: filas.length >= LIMITE_HISTORIA, ...cierresDeFilas(filas) };
}

/**
 * El registro completo para quien pide: JARVIS (global, lo ve cualquiera) y, si hay sesión, tu cuenta.
 * Sin sesión, las fuentes de cuenta dicen «sin datos» y no se inventa nada.
 */
export async function leerRegistroUnificado(db: D1Database, userId: number | null, ahora: number): Promise<Registro> {
  const nucleo = await seguro("núcleo", () => readCoreCounters(db));
  const cuenta = userId === null ? null : await seguro("papel", () => leerPapel(db, userId));
  const robot = userId === null ? null : await seguro("robot", () => leerRobot(db, userId));
  const flujo = userId === null ? null : await seguro("flujo", () => leerFlujo(db, userId));
  const agenteSt = userId === null ? null : await seguro("agente supertrend", () => leerAgenteSt(db, userId));
  // Sin la serie del núcleo, el capital final sigue saliendo exacto de los contadores; solo falta la curva.
  const nucleoCierres = nucleo ? await seguro("núcleo cierres", async () => cierresDeNucleo(await leerCierresNucleo(db))) : null;
  const serie = (claves: string[]) => (nucleoCierres ? juntar(claves.map((k) => nucleoCierres[k])) : { cierres: null, desde: null });

  const sombra = nucleo
    ? sumarConteos(["ROMPE~SOMBRA", "IMÁN~SOMBRA", "IA~SOMBRA"].map((k) => conteoDeNucleo(nucleo[k])))
    : null;

  const entradas: EntradaRegistro[] = [
    { id: "NUCLEO_ROMPE", conteo: nucleo ? conteoDeNucleo(nucleo.ROMPE) : null, ...serie(["ROMPE"]) },
    { id: "NUCLEO_IMAN", conteo: nucleo ? conteoDeNucleo(nucleo["IMÁN"]) : null, ...serie(["IMÁN"]) },
    { id: "NUCLEO_IA", conteo: nucleo ? conteoDeNucleo(nucleo.IA) : null, ...serie(["IA"]) },
    { id: "NUCLEO_SOMBRA", conteo: sombra, ...serie(["ROMPE~SOMBRA", "IMÁN~SOMBRA", "IA~SOMBRA"]) },
    { id: "PAPEL", conteo: cuenta?.conteo ?? null, incompleta: cuenta?.incompleta, cierres: cuenta?.cierres, desde: cuenta?.desde },
    { id: "ROBOT", conteo: robot?.conteo ?? null, incompleta: robot?.incompleta, cierres: robot?.cierres, desde: robot?.desde },
    { id: "FLUJO", conteo: flujo?.conteo ?? null, incompleta: flujo?.incompleta, cierres: flujo?.cierres, desde: flujo?.desde },
    { id: "AGENTE_ST", conteo: agenteSt?.conteo ?? null, incompleta: agenteSt?.incompleta, cierres: agenteSt?.cierres, desde: agenteSt?.desde },
  ];
  return armarRegistro(entradas, ahora);
}
