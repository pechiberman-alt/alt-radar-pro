/**
 * Límites de intentos para entrar y para crear cuentas: sin esto, cualquiera podía probar contraseñas sin parar contra un email
 * o crear cuentas en masa. Cuenta fallas por email y por IP en una ventana (D1, tabla auth_intentos: una fila por clave, con
 * la clave como hash, sin guardar ni el email ni la IP). Pasado el límite, se responde 429 con cuánto esperar. Un acierto
 * borra las fallas de ese email. Las cuentas son puras; la base, abajo.
 */

export const VENTANA_LOGIN_MS = 15 * 60_000;
export const MAX_FALLAS_EMAIL = 8;
export const MAX_FALLAS_IP = 30;
export const VENTANA_REGISTRO_MS = 60 * 60_000;
export const MAX_REGISTROS_IP = 5;
/** Una contraseña más larga que esto no es una contraseña: se corta antes de calcular nada. */
export const MAX_LARGO_CLAVE = 200;

export type Contador = { cuenta: number; desde: number };

/** El contador dentro de su ventana: si la ventana ya pasó, vuelve a cero. */
export function vigente(c: Contador | null | undefined, ventanaMs: number, ahora: number): Contador {
  return c && ahora - c.desde < ventanaMs ? c : { cuenta: 0, desde: ahora };
}

export function superado(c: Contador | null | undefined, max: number, ventanaMs: number, ahora: number): boolean {
  return vigente(c, ventanaMs, ahora).cuenta >= max;
}

/** Segundos hasta que se libera (al menos 1). */
export function esperaSeg(c: Contador | null | undefined, ventanaMs: number, ahora: number): number {
  const v = vigente(c, ventanaMs, ahora);
  return Math.max(1, Math.ceil((v.desde + ventanaMs - ahora) / 1000));
}

async function sha256Hex(texto: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** La clave de un contador: tipo y hash del valor (no se guarda el email ni la IP). */
export async function claveIntento(tipo: "email" | "ip" | "registro", valor: string): Promise<string> {
  return `${tipo}:${(await sha256Hex(`alt-radar-intentos:${valor}`)).slice(0, 40)}`;
}

/** La IP del pedido según Cloudflare (no la puede inventar el cliente detrás de Cloudflare). */
export function ipDe(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip") ?? "sin-ip";
}

const listo = new WeakSet<D1Database>();
async function ensure(db: D1Database) {
  if (listo.has(db)) return;
  await db.prepare("CREATE TABLE IF NOT EXISTS auth_intentos (clave TEXT PRIMARY KEY, cuenta INTEGER NOT NULL, desde INTEGER NOT NULL)").run();
  listo.add(db);
}

export async function leerIntentos(db: D1Database, claves: string[]): Promise<Map<string, Contador>> {
  await ensure(db);
  const filas = (
    await db
      .prepare(`SELECT clave, cuenta, desde FROM auth_intentos WHERE clave IN (${claves.map((_, i) => `?${i + 1}`).join(", ")}) LIMIT ${claves.length}`)
      .bind(...claves)
      .all<{ clave: string; cuenta: number; desde: number }>()
  ).results;
  return new Map(filas.map((f) => [f.clave, { cuenta: f.cuenta, desde: f.desde }]));
}

/** Suma un intento a cada clave (si su ventana ya pasó, arranca de nuevo) y borra los contadores de más de un día. */
export async function sumarIntento(db: D1Database, claves: string[], ventanaMs: number, ahora: number): Promise<void> {
  await ensure(db);
  await db.batch([
    ...claves.map((clave) =>
      db
        .prepare(
          `INSERT INTO auth_intentos (clave, cuenta, desde) VALUES (?1, 1, ?2)
           ON CONFLICT(clave) DO UPDATE SET
             cuenta = CASE WHEN desde < ?3 THEN 1 ELSE cuenta + 1 END,
             desde = CASE WHEN desde < ?3 THEN ?2 ELSE desde END`,
        )
        .bind(clave, ahora, ahora - ventanaMs),
    ),
    db.prepare("DELETE FROM auth_intentos WHERE desde < ?1").bind(ahora - 86_400_000),
  ]);
}

export async function borrarIntentos(db: D1Database, clave: string): Promise<void> {
  await ensure(db);
  await db.prepare("DELETE FROM auth_intentos WHERE clave = ?1").bind(clave).run();
}
