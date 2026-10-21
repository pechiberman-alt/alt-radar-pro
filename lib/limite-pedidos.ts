/**
 * Límite de pedidos por IP a la API, en el propio Worker. La regla de límite del WAF de Cloudflare no existe para un
 * subdominio *.workers.dev (solo para un dominio propio), así que el primer freno va acá: una ventana de un minuto por IP en
 * la memoria de cada isolate (barato, sin base; aproximado, porque Cloudflare reparte los pedidos entre isolates, pero frena
 * a quien llama en bucle desde una IP). El webhook de Telegram no se limita: tiene su secreto y lo llaman los servidores de
 * Telegram. Pura salvo el Map en memoria.
 */

export const VENTANA_PEDIDOS_MS = 60_000;
/** Pedidos por minuto y por IP a /api/: una pestaña de la app usa bastante menos; varias pestañas, también. */
export const MAX_PEDIDOS_API = 300;
/** Para entrar y crear cuentas, mucho menos (además de los límites por email de lib/auth-limites.ts). */
export const MAX_PEDIDOS_AUTH = 20;
/** Cuántas IPs se recuerdan como mucho: pasado el tope se olvidan las más viejas. */
export const MAX_IPS = 5000;

type Cuenta = { n: number; desde: number };
const cuentas = new Map<string, Cuenta>();

/** El límite que corresponde a una ruta; null si la ruta no se limita. */
export function limiteDe(pathname: string): { clave: string; max: number } | null {
  if (!pathname.startsWith("/api/")) return null;
  if (pathname.startsWith("/api/telegram/webhook")) return null;
  if (pathname.startsWith("/api/auth/login") || pathname.startsWith("/api/auth/register")) return { clave: "auth", max: MAX_PEDIDOS_AUTH };
  return { clave: "api", max: MAX_PEDIDOS_API };
}

/**
 * Cuenta un pedido. Devuelve null si pasa, o los segundos a esperar si esa IP ya llegó al límite en esta ventana. Sin IP
 * (desarrollo local) no se limita.
 */
export function contarPedido(ip: string | null, pathname: string, ahora = Date.now()): number | null {
  const limite = limiteDe(pathname);
  if (!limite || !ip) return null;
  const k = `${limite.clave}:${ip}`;
  const c = cuentas.get(k);
  const vigente = c && ahora - c.desde < VENTANA_PEDIDOS_MS ? c : { n: 0, desde: ahora };
  vigente.n += 1;
  cuentas.delete(k);
  cuentas.set(k, vigente);
  if (cuentas.size > MAX_IPS) {
    let sobran = cuentas.size - MAX_IPS + 500;
    for (const vieja of cuentas.keys()) {
      if (sobran-- <= 0) break;
      if (vieja !== k) cuentas.delete(vieja);
    }
  }
  if (vigente.n <= limite.max) return null;
  return Math.max(1, Math.ceil((vigente.desde + VENTANA_PEDIDOS_MS - ahora) / 1000));
}

/** La respuesta 429, en el mismo formato que el resto de la API. */
export function respuestaLimite(espera: number): Response {
  return Response.json(
    { error: "DEMASIADOS PEDIDOS: esperá un minuto." },
    { status: 429, headers: { "Retry-After": String(espera), "Cache-Control": "no-store" } },
  );
}

/** Solo para pruebas. */
export function olvidarPedidos() {
  cuentas.clear();
}
