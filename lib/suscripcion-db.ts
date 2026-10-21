/**
 * El acceso PRO en la base: la prueba y el pago de cada persona (suscripciones), los avisos de pago que manda la persona
 * (pagos_reportados) y la configuración de cobro (app_settings). El administrador aprueba o rechaza a mano: ningún camino
 * activa PRO solo. Consultas por índice y con LIMIT; nada de COUNT(*). La puerta de la API (worker/index.ts) recuerda cada
 * sesión un minuto en la memoria del isolate para no leer la base en cada pedido. Las reglas puras viven en lib/suscripcion.ts.
 */
import { adminUserId, guardarAjuste, leerAjuste } from "./app-settings.ts";
import { getCookie, getSessionUser, SESSION_COOKIE } from "./auth.ts";
import { sendMessage } from "./telegram.ts";
import {
  accesoPro,
  CONFIG_COBRO_INICIAL,
  DIA_MS,
  extenderPago,
  MAX_PENDIENTES,
  validarConfigCobro,
  type AccesoPro,
  type ConfigCobro,
  type ReportePago,
} from "./suscripcion.ts";

const ESQUEMA = [
  `CREATE TABLE IF NOT EXISTS suscripciones (
    user_id INTEGER PRIMARY KEY,
    prueba_desde INTEGER NOT NULL,
    pago_hasta INTEGER,
    actualizada INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS pagos_reportados (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    monto REAL NOT NULL,
    referencia TEXT NOT NULL UNIQUE,
    nota TEXT NOT NULL DEFAULT '',
    estado TEXT NOT NULL DEFAULT 'PENDIENTE',
    dias INTEGER,
    creado INTEGER NOT NULL,
    revisado INTEGER
  )`,
  "CREATE INDEX IF NOT EXISTS pagos_estado ON pagos_reportados (estado, creado)",
  "CREATE INDEX IF NOT EXISTS pagos_usuario ON pagos_reportados (user_id, creado)",
];
let lista = false;
export async function asegurarSuscripciones(db: D1Database) {
  if (lista) return;
  await db.batch(ESQUEMA.map((sql) => db.prepare(sql)));
  lista = true;
}

// ── Configuración de cobro (alias, precio, días). Un minuto en memoria. ──
let configMem: { c: ConfigCobro; at: number } | null = null;
export async function configCobro(db: D1Database, ahora = Date.now(), fresco = false): Promise<ConfigCobro> {
  if (!fresco && configMem && ahora - configMem.at < 60_000) return configMem.c;
  const raw = await leerAjuste(db, "cobro_config").catch(() => null);
  let c = CONFIG_COBRO_INICIAL;
  if (raw) {
    try {
      const v = validarConfigCobro(JSON.parse(raw));
      if (typeof v !== "string") c = v;
    } catch {
      // Una configuración rota no rompe el cobro: queda la inicial.
    }
  }
  configMem = { c, at: ahora };
  return c;
}
export async function guardarConfigCobro(db: D1Database, c: ConfigCobro) {
  await guardarAjuste(db, "cobro_config", JSON.stringify(c));
  configMem = null;
  olvidarAccesos();
}

// ── El administrador, un minuto en memoria (cambia una vez en la vida). ──
let adminMem: { id: number | null; at: number } | null = null;
async function adminId(db: D1Database, ahora: number) {
  if (adminMem && ahora - adminMem.at < 60_000) return adminMem.id;
  const id = await adminUserId(db);
  adminMem = { id, at: ahora };
  return id;
}

type Fila = { user_id: number; prueba_desde: number; pago_hasta: number | null };

/** La fila de una persona; si no tiene, empieza su prueba ahora (primer uso desde que existe el cobro). */
async function filaDe(db: D1Database, userId: number, ahora: number): Promise<Fila> {
  await asegurarSuscripciones(db);
  const f = await db.prepare("SELECT user_id, prueba_desde, pago_hasta FROM suscripciones WHERE user_id = ?1 LIMIT 1").bind(userId).first<Fila>();
  if (f) return f;
  await db.prepare("INSERT OR IGNORE INTO suscripciones (user_id, prueba_desde, pago_hasta, actualizada) VALUES (?1, ?2, NULL, ?2)").bind(userId, ahora).run();
  return { user_id: userId, prueba_desde: ahora, pago_hasta: null };
}

export async function accesoDe(db: D1Database, userId: number, ahora = Date.now()): Promise<AccesoPro> {
  const [f, admin, c] = await Promise.all([filaDe(db, userId, ahora), adminId(db, ahora), configCobro(db, ahora)]);
  return accesoPro({ esAdmin: admin === userId, pruebaDesde: f.prueba_desde, pagoHasta: f.pago_hasta, ahora, diasPrueba: c.diasPrueba });
}

// ── La puerta de la API: por sesión, un minuto en memoria. ──
export type Puerta = { sesion: false } | { sesion: true; userId: number; acceso: AccesoPro };
const puertas = new Map<string, { p: Puerta; at: number }>();
const MAX_PUERTAS = 2000;
export function olvidarAccesos() {
  puertas.clear();
}
/** Solo para pruebas: olvida todo lo que se guarda en memoria (tablas creadas, configuración, administrador y sesiones). */
export function olvidarTodo() {
  lista = false;
  configMem = null;
  adminMem = null;
  puertas.clear();
}

export async function puertaDe(request: Request, db: D1Database, ahora = Date.now()): Promise<Puerta> {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return { sesion: false };
  const mem = puertas.get(token);
  if (mem && ahora - mem.at < 60_000) return mem.p;
  const user = await getSessionUser(db, token);
  const p: Puerta = user ? { sesion: true, userId: user.id, acceso: await accesoDe(db, user.id, ahora) } : { sesion: false };
  if (puertas.size >= MAX_PUERTAS) puertas.clear();
  puertas.set(token, { p, at: ahora });
  return p;
}

/** La respuesta de la puerta: 401 sin sesión, 402 con la prueba o el pago vencidos. */
export function respuestaPuerta(p: Puerta): Response {
  const cuerpo = p.sesion
    ? { error: "PRO VENCIDO: activá PRO para seguir usando la terminal.", pro: true, estado: p.acceso.estado }
    : { error: "SESIÓN REQUERIDA: creá tu cuenta y probá PRO 7 días gratis.", pro: true, estado: "VISITANTE" };
  return Response.json(cuerpo, { status: p.sesion ? 402 : 401, headers: { "Cache-Control": "no-store" } });
}

// ── Avisos de pago ──
export type PagoFila = { id: number; user_id: number; monto: number; referencia: string; nota: string; estado: string; dias: number | null; creado: number; revisado: number | null };

/** Guarda el aviso de pago de una persona. Devuelve el id, o un texto de error para mostrarle. */
export async function reportarPago(db: D1Database, userId: number, r: ReportePago, ahora = Date.now()): Promise<{ id: number } | string> {
  await asegurarSuscripciones(db);
  const recientes = (
    await db.prepare("SELECT id, estado, creado FROM pagos_reportados WHERE user_id = ?1 ORDER BY creado DESC LIMIT 10").bind(userId).all<{ id: number; estado: string; creado: number }>()
  ).results;
  if (recientes.filter((x) => x.estado === "PENDIENTE").length >= MAX_PENDIENTES) return `YA TENÉS ${MAX_PENDIENTES} AVISOS PENDIENTES: esperá a que el administrador los revise.`;
  if (recientes.filter((x) => ahora - x.creado < DIA_MS).length >= 6) return "DEMASIADOS AVISOS HOY: probá mañana.";
  try {
    const res = await db
      .prepare("INSERT INTO pagos_reportados (user_id, monto, referencia, nota, estado, creado) VALUES (?1, ?2, ?3, ?4, 'PENDIENTE', ?5)")
      .bind(userId, r.monto, r.referencia, r.nota, ahora)
      .run();
    return { id: Number(res.meta.last_row_id) };
  } catch (e) {
    if (/UNIQUE/i.test(String(e))) return "ESE NÚMERO DE OPERACIÓN YA SE AVISÓ.";
    throw e;
  }
}

/** Los últimos avisos de una persona, para que vea en qué quedaron. */
export async function pagosDe(db: D1Database, userId: number): Promise<PagoFila[]> {
  await asegurarSuscripciones(db);
  return (await db.prepare("SELECT * FROM pagos_reportados WHERE user_id = ?1 ORDER BY creado DESC LIMIT 5").bind(userId).all<PagoFila>()).results;
}

/** Los avisos pendientes, del más viejo al más nuevo, con el email de quien avisó. */
export async function pagosPendientes(db: D1Database): Promise<(PagoFila & { email: string })[]> {
  await asegurarSuscripciones(db);
  return (
    await db
      .prepare("SELECT p.*, u.email AS email FROM pagos_reportados p JOIN users u ON u.id = p.user_id WHERE p.estado = 'PENDIENTE' ORDER BY p.creado ASC LIMIT 50")
      .all<PagoFila & { email: string }>()
  ).results;
}

/** Los últimos revisados (aprobados o rechazados), para el historial del administrador. */
export async function pagosRevisados(db: D1Database): Promise<(PagoFila & { email: string })[]> {
  await asegurarSuscripciones(db);
  return (
    await db
      .prepare("SELECT p.*, u.email AS email FROM pagos_reportados p JOIN users u ON u.id = p.user_id WHERE p.estado IN ('APROBADO', 'RECHAZADO') ORDER BY p.creado DESC LIMIT 20")
      .all<PagoFila & { email: string }>()
  ).results;
}

/** Suma `dias` de PRO a una persona (desde lo que le quedaba). Devuelve hasta cuándo queda. */
export async function extenderPro(db: D1Database, userId: number, dias: number, ahora = Date.now()): Promise<number> {
  const f = await filaDe(db, userId, ahora);
  const hasta = extenderPago(f.pago_hasta, ahora, dias);
  await db.prepare("UPDATE suscripciones SET pago_hasta = ?2, actualizada = ?3 WHERE user_id = ?1").bind(userId, hasta, ahora).run();
  olvidarAccesos();
  return hasta;
}

/** El administrador aprueba un aviso pendiente: suma los días y lo marca aprobado. Null si no estaba pendiente. */
export async function aprobarPago(db: D1Database, id: number, dias: number, ahora = Date.now()): Promise<{ userId: number; hasta: number } | null> {
  await asegurarSuscripciones(db);
  const p = await db.prepare("SELECT id, user_id, estado FROM pagos_reportados WHERE id = ?1 LIMIT 1").bind(id).first<{ id: number; user_id: number; estado: string }>();
  if (!p || p.estado !== "PENDIENTE") return null;
  // Primero se marca (solo si sigue pendiente), así dos aprobaciones a la vez no suman dos veces.
  const marca = await db.prepare("UPDATE pagos_reportados SET estado = 'APROBADO', dias = ?2, revisado = ?3 WHERE id = ?1 AND estado = 'PENDIENTE'").bind(id, dias, ahora).run();
  if (!marca.meta.changes) return null;
  const hasta = await extenderPro(db, p.user_id, dias, ahora);
  return { userId: p.user_id, hasta };
}

export async function rechazarPago(db: D1Database, id: number, ahora = Date.now()): Promise<{ userId: number } | null> {
  await asegurarSuscripciones(db);
  const p = await db.prepare("SELECT user_id FROM pagos_reportados WHERE id = ?1 AND estado = 'PENDIENTE' LIMIT 1").bind(id).first<{ user_id: number }>();
  if (!p) return null;
  const r = await db.prepare("UPDATE pagos_reportados SET estado = 'RECHAZADO', revisado = ?2 WHERE id = ?1 AND estado = 'PENDIENTE'").bind(id, ahora).run();
  return r.meta.changes ? { userId: p.user_id } : null;
}

/** El id de una cuenta por su email (índice único), o null. */
export async function usuarioPorEmail(db: D1Database, email: string): Promise<number | null> {
  const r = await db.prepare("SELECT id FROM users WHERE email = ?1 LIMIT 1").bind(email.trim().toLowerCase()).first<{ id: number }>();
  return r?.id ?? null;
}

/** Las cuentas con su estado, para el administrador (las últimas 100 creadas). */
export async function cuentasConEstado(db: D1Database, ahora = Date.now()) {
  await asegurarSuscripciones(db);
  const [admin, c] = await Promise.all([adminId(db, ahora), configCobro(db, ahora)]);
  const filas = (
    await db
      .prepare("SELECT u.id AS id, u.email AS email, s.prueba_desde AS prueba_desde, s.pago_hasta AS pago_hasta FROM users u LEFT JOIN suscripciones s ON s.user_id = u.id ORDER BY u.id DESC LIMIT 100")
      .all<{ id: number; email: string; prueba_desde: number | null; pago_hasta: number | null }>()
  ).results;
  return filas.map((f) => {
    const a = accesoPro({ esAdmin: admin === f.id, pruebaDesde: f.prueba_desde, pagoHasta: f.pago_hasta, ahora, diasPrueba: c.diasPrueba });
    // Sin fila todavía: su prueba arranca la primera vez que entre (no está vencida).
    const sinUso = f.prueba_desde === null && a.estado !== "ADMIN" && a.estado !== "ACTIVA";
    return { id: f.id, email: f.email, ...a, estado: sinUso ? "SIN_USO" : a.estado, sinUso };
  });
}

/**
 * Para los envíos por Telegram: de una lista de cuentas, las que tienen acceso. Quien todavía no tiene fila empieza su
 * prueba ahora (igual que al abrir la terminal), así nadie recibe alertas para siempre sin haber probado.
 */
export async function conAcceso(db: D1Database, userIds: number[], ahora = Date.now()): Promise<Set<number>> {
  const ids = [...new Set(userIds.filter((x) => Number.isInteger(x) && x > 0))].slice(0, 500);
  if (!ids.length) return new Set();
  await asegurarSuscripciones(db);
  const [admin, c] = await Promise.all([adminId(db, ahora), configCobro(db, ahora)]);
  const filas = new Map<number, Fila>();
  for (let k = 0; k < ids.length; k += 90) {
    const parte = ids.slice(k, k + 90);
    const r = await db
      .prepare(`SELECT user_id, prueba_desde, pago_hasta FROM suscripciones WHERE user_id IN (${parte.map((_, j) => `?${j + 1}`).join(",")}) LIMIT ${parte.length}`)
      .bind(...parte)
      .all<Fila>();
    for (const f of r.results) filas.set(f.user_id, f);
  }
  const faltan = ids.filter((id) => !filas.has(id));
  if (faltan.length) {
    await db.batch(faltan.map((id) => db.prepare("INSERT OR IGNORE INTO suscripciones (user_id, prueba_desde, pago_hasta, actualizada) VALUES (?1, ?2, NULL, ?2)").bind(id, ahora)));
    for (const id of faltan) filas.set(id, { user_id: id, prueba_desde: ahora, pago_hasta: null });
  }
  const out = new Set<number>();
  for (const id of ids) {
    const f = filas.get(id)!;
    if (accesoPro({ esAdmin: admin === id, pruebaDesde: f.prueba_desde, pagoHasta: f.pago_hasta, ahora, diasPrueba: c.diasPrueba }).acceso) out.add(id);
  }
  return out;
}

/** Un aviso por Telegram a una cuenta vinculada (al administrador o a quien pagó). Sin bot o sin vínculo, no pasa nada. */
export async function avisarPorTelegram(db: D1Database, token: string | null, userId: number | null, texto: string): Promise<boolean> {
  if (!token || !userId) return false;
  const link = await db.prepare("SELECT chat_id FROM telegram_links WHERE user_id = ?1 LIMIT 1").bind(userId).first<{ chat_id: string }>().catch(() => null);
  if (!link) return false;
  const r = await sendMessage(token, link.chat_id, texto).catch(() => null);
  return Boolean(r && (r as { ok?: boolean }).ok);
}

/** El id del administrador (para avisarle). */
export const administrador = (db: D1Database) => adminId(db, Date.now());
