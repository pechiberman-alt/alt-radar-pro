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
import { resultadosFlujo } from "./flujo-db.ts";
import { armarRegistro, CONTEO_CERO, contar, type Conteo, type EntradaRegistro, type OperacionLeida, type Registro, sumarConteos } from "./registro.ts";

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
export function operacionesDePapel(filas: { data: string }[]): { ops: OperacionLeida[]; ilegibles: number } {
  const ops: OperacionLeida[] = [];
  let ilegibles = 0;
  for (const f of filas) {
    let t: PaperTrade;
    try {
      t = JSON.parse(f.data) as PaperTrade;
    } catch {
      ilegibles += 1;
      continue;
    }
    if (t.estado === "PENDIENTE" || t.estado === "ABIERTA") ops.push({ r: null, abierta: true });
    else if (t.estado === "CERRADA") ops.push({ r: typeof t.resultadoR === "number" ? t.resultadoR : null, abierta: false });
  }
  return { ops, ilegibles };
}

/** Del robot MM y del flujo de órdenes: las que siguen abiertas, y las cerradas con su R. */
export function operacionesDeRobot(filas: { r: number | null; desenlace: string }[]): OperacionLeida[] {
  return filas.map((f) => (f.desenlace === "ABIERTA" ? { r: null, abierta: true } : { r: f.r, abierta: false }));
}

async function seguro<T>(etiqueta: string, leer: () => Promise<T>): Promise<T | null> {
  try {
    return await leer();
  } catch (e) {
    // La fuente queda «sin datos»; el error va al log sin datos de la persona.
    console.error(`[registro] ${etiqueta}: ${e instanceof Error ? e.name : "error"}`);
    return null;
  }
}

async function leerPapel(db: D1Database, userId: number): Promise<{ conteo: Conteo; incompleta: boolean }> {
  await ensurePaperSchema(db);
  const filas = (
    await db.prepare("SELECT data FROM jarvis_paper WHERE user_id = ?1 ORDER BY abierta_a DESC LIMIT ?2").bind(userId, LIMITE_HISTORIA).all<{ data: string }>()
  ).results;
  const { ops, ilegibles } = operacionesDePapel(filas);
  return { conteo: contar(ops), incompleta: filas.length >= LIMITE_HISTORIA || ilegibles > 0 };
}

async function leerFlujo(db: D1Database, userId: number): Promise<{ conteo: Conteo; incompleta: boolean }> {
  const filas = await resultadosFlujo(db, userId, LIMITE_HISTORIA);
  return { conteo: contar(operacionesDeRobot(filas)), incompleta: filas.length >= LIMITE_HISTORIA };
}

async function leerRobot(db: D1Database, userId: number): Promise<{ conteo: Conteo; incompleta: boolean }> {
  await ensureRobotLedger(db);
  const filas = (
    await db.prepare("SELECT r, desenlace FROM robot_senales WHERE user_id = ?1 ORDER BY vela DESC LIMIT ?2").bind(userId, LIMITE_HISTORIA).all<{ r: number | null; desenlace: string }>()
  ).results;
  return { conteo: contar(operacionesDeRobot(filas)), incompleta: filas.length >= LIMITE_HISTORIA };
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

  const sombra = nucleo
    ? sumarConteos(["ROMPE~SOMBRA", "IMÁN~SOMBRA", "IA~SOMBRA"].map((k) => conteoDeNucleo(nucleo[k])))
    : null;

  const entradas: EntradaRegistro[] = [
    { id: "NUCLEO_ROMPE", conteo: nucleo ? conteoDeNucleo(nucleo.ROMPE) : null },
    { id: "NUCLEO_IMAN", conteo: nucleo ? conteoDeNucleo(nucleo["IMÁN"]) : null },
    { id: "NUCLEO_IA", conteo: nucleo ? conteoDeNucleo(nucleo.IA) : null },
    { id: "NUCLEO_SOMBRA", conteo: sombra },
    { id: "PAPEL", conteo: cuenta?.conteo ?? null, incompleta: cuenta?.incompleta },
    { id: "ROBOT", conteo: robot?.conteo ?? null, incompleta: robot?.incompleta },
    { id: "FLUJO", conteo: flujo?.conteo ?? null, incompleta: flujo?.incompleta },
  ];
  return armarRegistro(entradas, ahora);
}
