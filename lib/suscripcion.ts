/**
 * El acceso PRO de la terminal: todo es PRO, con 7 días de prueba desde el primer uso (o desde que se crea la cuenta) y
 * después se paga por transferencia al alias (url.mp) y el administrador activa a mano al ver el pago. Acá van las reglas
 * puras: el estado de cada persona, cuánto suma un pago aprobado, qué rutas de la API son PRO y cómo se valida lo que manda
 * la persona al avisar que pagó (nunca un comprobante con datos de su cuenta: el número de operación alcanza).
 * Desconocido no es cero: sin precio cargado, se dice que falta, no se inventa. Pura: sin red ni base.
 */

export const DIA_MS = 86_400_000;
export const DIAS_PRUEBA = 7;
export const DIAS_POR_PAGO = 30;
export const ALIAS_PAGO = "url.mp";
/** Cuántos avisos de pago pendientes puede tener una persona a la vez. */
export const MAX_PENDIENTES = 3;

export type EstadoPro = "ADMIN" | "PRUEBA" | "ACTIVA" | "VENCIDA";
export type AccesoPro = { estado: EstadoPro; acceso: boolean; hasta: number | null; diasRestantes: number | null };

/**
 * El estado de una persona: el administrador entra siempre; un pago vigente gana sobre la prueba; si no, la prueba de
 * `diasPrueba` días desde `pruebaDesde`; si nada sigue vigente, VENCIDA.
 */
export function accesoPro(p: { esAdmin: boolean; pruebaDesde: number | null; pagoHasta: number | null; ahora: number; diasPrueba?: number }): AccesoPro {
  if (p.esAdmin) return { estado: "ADMIN", acceso: true, hasta: null, diasRestantes: null };
  const restan = (hasta: number) => Math.max(0, Math.ceil((hasta - p.ahora) / DIA_MS));
  if (p.pagoHasta !== null && p.pagoHasta > p.ahora) return { estado: "ACTIVA", acceso: true, hasta: p.pagoHasta, diasRestantes: restan(p.pagoHasta) };
  if (p.pruebaDesde !== null) {
    const fin = p.pruebaDesde + (p.diasPrueba ?? DIAS_PRUEBA) * DIA_MS;
    if (fin > p.ahora) return { estado: "PRUEBA", acceso: true, hasta: fin, diasRestantes: restan(fin) };
    return { estado: "VENCIDA", acceso: false, hasta: p.pagoHasta !== null && p.pagoHasta > fin ? p.pagoHasta : fin, diasRestantes: 0 };
  }
  return { estado: "VENCIDA", acceso: false, hasta: p.pagoHasta, diasRestantes: 0 };
}

/** Hasta cuándo queda PRO después de aprobar un pago de `dias` días: se suma a lo que le quedaba, nunca se pisa. */
export function extenderPago(pagoHasta: number | null, ahora: number, dias: number): number {
  return Math.max(pagoHasta ?? 0, ahora) + Math.round(dias) * DIA_MS;
}

/** Las rutas de la API que son PRO: la inteligencia de la terminal (IA, agentes, oficina, registro, Telegram, diarios…). */
const PREFIJOS_PRO = [
  "/api/analyst/",
  "/api/jarvis/",
  "/api/oficina",
  "/api/mapa/",
  "/api/registro",
  "/api/arana/",
  "/api/telegram/link",
  "/api/telegram/test",
  "/api/alerts/",
  "/api/robot/",
  "/api/scalping",
  "/api/signals",
  "/api/radar",
  "/api/performance",
  "/api/backtest/",
  "/api/journal",
  "/api/bot/",
  "/api/diario/",
  "/api/dca",
  "/api/axi/",
  "/api/brain",
  "/api/push/",
];

/** Si una ruta es PRO. Quedan abiertas: entrar, la versión, los datos públicos de mercado y lo que hace falta para pagar. */
export function rutaPro(pathname: string): boolean {
  return PREFIJOS_PRO.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)));
}

export type ConfigCobro = { alias: string; precio: number | null; moneda: "ARS" | "USD" | "USDT"; dias: number; diasPrueba: number };
export const CONFIG_COBRO_INICIAL: ConfigCobro = { alias: ALIAS_PAGO, precio: null, moneda: "ARS", dias: DIAS_POR_PAGO, diasPrueba: DIAS_PRUEBA };

/** Lee un número escrito a la argentina («10.000», «10000,50») o con punto decimal («10000.5»). Null si no es un monto. */
export function leerMonto(texto: string): number | null {
  const t = String(texto ?? "").trim().replace(/\s|\$/g, "");
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = /,/.test(t) || /^\d{1,3}(\.\d{3})+$/.test(t) ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t);
  return Number.isFinite(n) && n > 0 && n < 1e9 ? n : null;
}

/** La configuración de cobro que manda el administrador, validada; un texto de error si algo no sirve. */
export function validarConfigCobro(x: unknown): ConfigCobro | string {
  const o = (x ?? {}) as Record<string, unknown>;
  const alias = String(o.alias ?? "").trim().toLowerCase();
  if (!/^[a-z0-9.-]{6,20}$/.test(alias)) return "ALIAS INVÁLIDO: de 6 a 20 letras, números, puntos o guiones";
  const precio = o.precio === null || o.precio === "" || o.precio === undefined ? null : leerMonto(String(o.precio));
  if (o.precio !== null && o.precio !== "" && o.precio !== undefined && precio === null) return "PRECIO INVÁLIDO";
  const moneda = String(o.moneda ?? "ARS").toUpperCase();
  if (moneda !== "ARS" && moneda !== "USD" && moneda !== "USDT") return "MONEDA INVÁLIDA";
  const dias = Number(o.dias);
  if (!Number.isInteger(dias) || dias < 1 || dias > 366) return "DÍAS POR PAGO: de 1 a 366";
  const diasPrueba = Number(o.diasPrueba);
  if (!Number.isInteger(diasPrueba) || diasPrueba < 0 || diasPrueba > 30) return "DÍAS DE PRUEBA: de 0 a 30";
  return { alias, precio, moneda, dias, diasPrueba };
}

export type ReportePago = { monto: number; referencia: string; nota: string };

/** Lo que manda la persona al avisar que pagó: monto, número de operación y una nota corta. Un texto de error si no sirve. */
export function validarReporte(x: unknown): ReportePago | string {
  const o = (x ?? {}) as Record<string, unknown>;
  const monto = leerMonto(String(o.monto ?? ""));
  if (monto === null) return "MONTO INVÁLIDO: escribilo como en el comprobante (por ejemplo 10.000)";
  const referencia = String(o.referencia ?? "").trim().replace(/\s+/g, " ");
  if (!/^[A-Za-z0-9#./_ -]{4,40}$/.test(referencia)) return "NÚMERO DE OPERACIÓN INVÁLIDO: de 4 a 40 letras o números, como figura en el comprobante";
  // Sin caracteres de control ni marcas: la nota llega al administrador por Telegram.
  const nota = Array.from(String(o.nota ?? ""), (ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 || ch === "<" || ch === ">" ? " " : ch))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return { monto, referencia, nota };
}

const fechaCorta = (t: number) => new Date(t - 3 * 3_600_000).toISOString().slice(0, 10).split("-").reverse().join("/");
/** El estado en una línea, para la terminal y para Telegram. */
export function textoAcceso(a: AccesoPro): string {
  if (a.estado === "ADMIN") return "Administrador: acceso completo.";
  if (a.estado === "ACTIVA") return `PRO activo hasta el ${fechaCorta(a.hasta!)} (${a.diasRestantes} ${a.diasRestantes === 1 ? "día" : "días"}).`;
  if (a.estado === "PRUEBA") return `Prueba PRO: ${a.diasRestantes === 1 ? "te queda 1 día" : `te quedan ${a.diasRestantes} días`} (hasta el ${fechaCorta(a.hasta!)}).`;
  return "Tu prueba terminó: activá PRO para seguir usando la terminal.";
}

/** El precio en texto, o que falta cargarlo (no se inventa). */
export function textoPrecio(c: ConfigCobro): string {
  if (c.precio === null) return "precio a confirmar por el administrador";
  const n = c.precio.toLocaleString("es-AR", { minimumFractionDigits: Number.isInteger(c.precio) ? 0 : 2, maximumFractionDigits: 2 });
  return `${c.moneda === "ARS" ? "$" : `${c.moneda} `}${n} por ${c.dias} días`;
}

const escHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const montoTxt = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });

/** El aviso al administrador por Telegram cuando alguien avisa que pagó (HTML de Telegram, todo escapado). */
export function textoAvisoAdmin(p: { email: string; monto: number; referencia: string; nota: string; moneda: string }): string {
  return [
    "💳 <b>Aviso de pago</b>",
    `Cuenta: ${escHtml(p.email)}`,
    `Monto: ${escHtml(p.moneda)} ${montoTxt(p.monto)}`,
    `Operación: <code>${escHtml(p.referencia)}</code>`,
    ...(p.nota ? [`Nota: ${escHtml(p.nota)}`] : []),
    "Revisalo en el comprobante y aprobalo o rechazalo en la terminal: CONFIGURACIÓN → COBROS.",
  ].join("\n");
}

/** El aviso a la persona cuando el administrador aprueba su pago. */
export function textoAprobado(hasta: number): string {
  return `✅ <b>PRO activado</b> hasta el ${fechaCorta(hasta)}. ¡Gracias! Si tenés la terminal abierta, recargala.`;
}

/** El aviso a la persona cuando el administrador rechaza su aviso de pago. */
export const TEXTO_RECHAZADO = "⚠️ Tu aviso de pago no se pudo confirmar con el comprobante. Revisá el número de operación y avisá de nuevo desde la terminal.";
