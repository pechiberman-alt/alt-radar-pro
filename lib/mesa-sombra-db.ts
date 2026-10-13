/**
 * El laboratorio en sombra por cuenta, en D1: una fila de estado por persona
 * y la auditoría encadenada (lib/mesa-sombra-auditoria.ts), que nunca se edita.
 * Presupuesto de D1 (la cuota es una sola para toda la app): un contador por
 * persona (seq, nada de COUNT(*)), lecturas por clave o por índice con LIMIT,
 * como mucho una evolución registrada cada 20 minutos y una corrida guardada
 * cada 30 segundos.
 */
import { GENESIS, hashEvento, type EventoAuditado } from "./mesa-sombra-auditoria.ts";
import { aprobar, EVENTOS_DE_ESTADO, EVENTOS_DEL_LABORATORIO, revocar, validarEstado, type EstadoSombra, type EventoSombra } from "./mesa-sombra.ts";

export const EVOLUCION_CADA_MS = 20 * 60_000;
export const GUARDAR_CADA_MS = 30_000;
export const MAX_EVENTOS_POR_PEDIDO = 12;
export const MAX_DATOS = 4000;
export const MAX_ESTADO = 64_000;
export const LISTA_EVENTOS = 40;

const listo = new WeakSet<D1Database>();

export async function ensureSombraSchema(db: D1Database) {
  if (listo.has(db)) return;
  await db.batch([
    db.prepare(
      "CREATE TABLE IF NOT EXISTS mesa_sombra (user_id INTEGER PRIMARY KEY, estado TEXT NOT NULL, seq INTEGER NOT NULL DEFAULT 0, ultimo_hash TEXT NOT NULL, ultima_evolucion INTEGER NOT NULL DEFAULT 0, actualizada INTEGER NOT NULL)",
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS mesa_sombra_eventos (user_id INTEGER NOT NULL, seq INTEGER NOT NULL, at INTEGER NOT NULL, tipo TEXT NOT NULL, datos TEXT NOT NULL, prev TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY (user_id, seq))",
    ),
    // Para aprobar se busca el último estado de una variante: por tipo, sin recorrer toda la auditoría.
    db.prepare("CREATE INDEX IF NOT EXISTS mesa_sombra_eventos_tipo ON mesa_sombra_eventos (user_id, tipo, seq)"),
  ]);
  listo.add(db);
}

type Fila = { estado: string; seq: number; ultimo_hash: string; ultima_evolucion: number; actualizada: number };
export type Guardado = { estado: EstadoSombra | null; seq: number; ultimoHash: string; ultimaEvolucion: number; actualizada: number };

export async function leerSombra(db: D1Database, userId: number): Promise<Guardado> {
  const f = await db.prepare("SELECT estado, seq, ultimo_hash, ultima_evolucion, actualizada FROM mesa_sombra WHERE user_id = ?").bind(userId).first<Fila>();
  if (!f) return { estado: null, seq: 0, ultimoHash: GENESIS, ultimaEvolucion: 0, actualizada: 0 };
  let estado: EstadoSombra | null = null;
  try {
    estado = validarEstado(JSON.parse(f.estado));
  } catch {
    estado = null;
  }
  return { estado, seq: f.seq, ultimoHash: f.ultimo_hash, ultimaEvolucion: f.ultima_evolucion, actualizada: f.actualizada };
}

export async function listarEventos(db: D1Database, userId: number, limite = LISTA_EVENTOS): Promise<EventoAuditado[]> {
  const r = await db
    .prepare("SELECT seq, at, tipo, datos, prev, hash FROM mesa_sombra_eventos WHERE user_id = ? ORDER BY seq DESC LIMIT ?")
    .bind(userId, Math.max(1, Math.min(LISTA_EVENTOS, limite)))
    .all<{ seq: number; at: number; tipo: string; datos: string; prev: string; hash: string }>();
  return (r.results ?? []).map((x) => {
    let datos: Record<string, unknown> = {};
    try {
      datos = JSON.parse(x.datos) as Record<string, unknown>;
    } catch {
      datos = { ilegible: true };
    }
    return { seq: x.seq, at: x.at, tipo: x.tipo, datos, prev: x.prev, hash: x.hash };
  });
}

export type Escritura = { ok: true; seq: number; ultimoHash: string; estado: EstadoSombra; eventos: EventoAuditado[] } | { ok: false; status: number; error: string };

/** Encadena los eventos al último guardado y escribe todo junto (si otro escribió antes, falla entero). */
async function escribir(db: D1Database, userId: number, g: Guardado, estado: EstadoSombra, eventos: EventoSombra[], ahora: number): Promise<Escritura> {
  const texto = JSON.stringify(estado);
  if (texto.length > MAX_ESTADO) return { ok: false, status: 413, error: "El estado del laboratorio es demasiado grande." };
  let prev = g.ultimoHash;
  let seq = g.seq;
  const auditados: EventoAuditado[] = [];
  for (const e of eventos) {
    seq += 1;
    const datos = JSON.parse(JSON.stringify(e.datos)) as Record<string, unknown>;
    const hash = await hashEvento(prev, seq, ahora, e.tipo, datos);
    auditados.push({ seq, at: ahora, tipo: e.tipo, datos, prev, hash });
    prev = hash;
  }
  const evoluciono = eventos.some((e) => e.tipo === "EVOLUCION");
  const sentencias = auditados.map((a) =>
    db.prepare("INSERT INTO mesa_sombra_eventos (user_id, seq, at, tipo, datos, prev, hash) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(userId, a.seq, a.at, a.tipo, JSON.stringify(a.datos), a.prev, a.hash),
  );
  sentencias.push(
    db
      .prepare(
        "INSERT INTO mesa_sombra (user_id, estado, seq, ultimo_hash, ultima_evolucion, actualizada) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET estado = excluded.estado, seq = excluded.seq, ultimo_hash = excluded.ultimo_hash, ultima_evolucion = excluded.ultima_evolucion, actualizada = excluded.actualizada",
      )
      .bind(userId, texto, seq, prev, evoluciono ? ahora : g.ultimaEvolucion, ahora),
  );
  try {
    await db.batch(sentencias);
  } catch {
    return { ok: false, status: 409, error: "Otra pestaña guardó el laboratorio al mismo tiempo: volvé a cargarlo." };
  }
  return { ok: true, seq, ultimoHash: prev, estado, eventos: auditados };
}

/**
 * Lo que el laboratorio corrió en el navegador. No puede aprobar ni revocar:
 * la variante aprobada tiene que quedar igual a la guardada.
 */
export async function guardarCorrida(db: D1Database, userId: number, rawEstado: unknown, rawEventos: unknown, ahora: number): Promise<Escritura> {
  const estado = validarEstado(rawEstado);
  if (!estado) return { ok: false, status: 400, error: "Estado del laboratorio inválido." };
  if (!Array.isArray(rawEventos) || rawEventos.length > MAX_EVENTOS_POR_PEDIDO) return { ok: false, status: 400, error: `Hasta ${MAX_EVENTOS_POR_PEDIDO} eventos por pedido.` };
  const eventos: EventoSombra[] = [];
  for (const e of rawEventos as EventoSombra[]) {
    if (!e || !EVENTOS_DEL_LABORATORIO.includes(e.tipo) || !e.datos || typeof e.datos !== "object" || Array.isArray(e.datos)) {
      return { ok: false, status: 400, error: "Evento inválido: el laboratorio solo registra evoluciones, candidatas, aptas y descartadas." };
    }
    if (JSON.stringify(e.datos).length > MAX_DATOS) return { ok: false, status: 413, error: "Un evento es demasiado grande." };
    eventos.push({ tipo: e.tipo, datos: e.datos });
  }
  const g = await leerSombra(db, userId);
  const antes = g.estado?.aprobada ?? null;
  const ahoraAprobada = estado.aprobada;
  if (JSON.stringify(antes) !== JSON.stringify(ahoraAprobada)) return { ok: false, status: 403, error: "La variante aprobada solo cambia aprobando o revocando, a pedido tuyo." };
  if (g.estado && estado.generacion < g.estado.generacion) return { ok: false, status: 409, error: "El laboratorio guardado está más adelante: volvé a cargarlo." };
  if (eventos.some((e) => e.tipo === "EVOLUCION") && ahora - g.ultimaEvolucion < EVOLUCION_CADA_MS) {
    return { ok: false, status: 429, error: "La auditoría registra una evolución cada 20 minutos: esta se vuelve a intentar sola en la próxima vuelta." };
  }
  if (g.actualizada && ahora - g.actualizada < GUARDAR_CADA_MS) {
    return { ok: false, status: 429, error: "El laboratorio se guardó hace menos de 30 segundos: la corrida se vuelve a intentar sola en la próxima vuelta." };
  }
  return escribir(db, userId, g, estado, eventos, ahora);
}

const ESTADO_REGISTRADO: Record<string, string> = { CANDIDATA: "en observación", OBSERVACION: "en observación", DESCARTADA: "descartada" };

/**
 * Aprobar lo decide el servidor sobre lo GUARDADO: la candidata tiene que estar
 * APTA en el estado y lo último que la auditoría registró de esa variante tiene
 * que ser APTA (no alcanza con que lo haya sido alguna vez).
 */
export async function aprobarGuardada(db: D1Database, userId: number, indice: unknown, ahora: number): Promise<Escritura> {
  const g = await leerSombra(db, userId);
  if (!g.estado) return { ok: false, status: 404, error: "Todavía no hay laboratorio guardado." };
  if (typeof indice !== "number") return { ok: false, status: 400, error: "Falta la variante." };
  const r = aprobar(g.estado, indice, ahora);
  if (!r.ok) return { ok: false, status: 409, error: r.error };
  const marcas = EVENTOS_DE_ESTADO.map(() => "?").join(", ");
  const ultimo = await db
    .prepare(`SELECT tipo FROM mesa_sombra_eventos WHERE user_id = ? AND tipo IN (${marcas}) AND json_extract(datos, '$.indice') = ? ORDER BY seq DESC LIMIT 1`)
    .bind(userId, ...EVENTOS_DE_ESTADO, indice)
    .first<{ tipo: string }>();
  if (ultimo?.tipo !== "APTA") {
    const error = ultimo ? `Esa variante no está APTA en la auditoría: lo último registrado es que quedó ${ESTADO_REGISTRADO[ultimo.tipo] ?? ultimo.tipo}.` : "Esa variante no figura como APTA en la auditoría.";
    return { ok: false, status: 409, error };
  }
  return escribir(db, userId, g, r.estado, [r.evento], ahora);
}

export async function revocarGuardada(db: D1Database, userId: number, motivo: unknown, ahora: number): Promise<Escritura> {
  const g = await leerSombra(db, userId);
  if (!g.estado) return { ok: false, status: 404, error: "Todavía no hay laboratorio guardado." };
  const r = revocar(g.estado, ahora, typeof motivo === "string" ? motivo : "");
  if (!r.ok) return { ok: false, status: 409, error: r.error };
  return escribir(db, userId, g, r.estado, [r.evento], ahora);
}
