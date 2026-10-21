/**
 * Cabeceras de seguridad en todas las respuestas: nadie puede meter la app en un marco de otro sitio (clickjacking), el
 * navegador no adivina tipos de archivo, no se filtra la dirección completa a otros sitios, solo HTTPS, y la página no puede
 * pedir cámara, ubicación ni pagos (el micrófono, solo esta misma página, para el manos libres de JARVIS). Sin script-src:
 * una política de scripts mal ajustada rompería la app; esto no restringe ningún script.
 */
export const SEGURIDAD: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN",
  "Content-Security-Policy": "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Permissions-Policy": "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)",
};
export function conSeguridad(res: Response): Response {
  if (res.status === 101 || (res as Response & { webSocket?: unknown }).webSocket) return res;
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SEGURIDAD)) if (!out.headers.has(k)) out.headers.set(k, v);
  return out;
}
