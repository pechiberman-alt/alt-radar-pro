import { arNumber } from "./ai-numbers.ts";
import { MIN_RR, rrFrom, type DeskDecision, type DeskSettings } from "./jarvis-desk.ts";

/**
 * JARVIS TRADING · los tres modos, separados a propósito:
 *
 *  - ANÁLISIS: la mesa lee el mercado y propone un plan. No toca nada.
 *  - PAPEL: sigue un plan sin plata real (jarvis-paper.ts) y mide el resultado.
 *  - EJECUCIÓN REAL: JARVIS no envía órdenes a ningún exchange. No hay código
 *    que lo haga. Lo que sí hace es armar un ticket manual con controles: si
 *    todos se cumplen y la persona confirma, le da el texto de la orden para
 *    que la cargue ella misma en su exchange, con su cuenta y su dinero.
 *
 * Habilitar órdenes reales desde la app sería otro módulo, revisado aparte,
 * con la clave de la persona solo en su navegador (lib/binance-client-signed.ts
 * hoy solo prueba permisos con order.test, que no envía nada) y una
 * confirmación explícita por cada orden. No existe y no se activa solo.
 */

export type DeskMode = "ANALISIS" | "PAPEL" | "REAL";

export const DESK_MODES: { id: DeskMode; label: string; detail: string }[] = [
  { id: "ANALISIS", label: "ANÁLISIS", detail: "La mesa lee y propone. No toca nada." },
  { id: "PAPEL", label: "PAPEL", detail: "Simula sin plata real y mide el resultado." },
  { id: "REAL", label: "REAL 🔒", detail: "JARVIS no envía órdenes: arma un ticket manual con controles y la orden la cargás vos." },
];

/** JARVIS no tiene ningún camino para enviar una orden real. Es una constante, no una preferencia. */
export const REAL_ORDERS_FROM_JARVIS = false as const;

/** Un ticket vale un rato: después el precio ya es otro y hay que volver a analizar. */
export const TICKET_TTL_MS = 15 * 60_000;
/** Lectura más vieja que esto no arma ticket. */
export const TICKET_MAX_AGE_MS = 10 * 60_000;
/** Riesgo por operación por encima de esto no arma ticket. */
export const MAX_TICKET_RISK_PCT = 2;

const H = 3_600_000;
const px = (v: number) => arNumber(v);
const usd = (v: number) => `$${v.toLocaleString("es-AR", { maximumFractionDigits: v >= 100 ? 0 : 2 })}`;
const rr = (v: number) => `1:${arNumber(Number(v.toFixed(2)))}`;
const hourAr = (t: number) => new Date(t).toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export type TicketCheck = { id: string; ok: boolean; label: string; detail: string };
export type ManualTicket = { ready: boolean; checks: TicketCheck[]; text: string | null; expiresAt: number | null };

/**
 * Los controles de la ejecución manual y, si todos pasan, el texto de la
 * orden. `confirmed` es la acción explícita de la persona: sin ella no hay
 * ticket aunque todo lo demás esté bien.
 */
export function manualTicket(d: DeskDecision, settings: DeskSettings, now: number, confirmed: boolean): ManualTicket {
  const p = d.plan;
  const r = d.riesgo;
  const isTrade = (d.direccion === "LONG" || d.direccion === "SHORT") && p !== null && r !== null && r.aprobado;
  const checks: TicketCheck[] = [];
  checks.push({
    id: "plan",
    ok: isTrade,
    label: "Plan aprobado por el gestor de riesgo",
    detail: isTrade ? `${d.direccion} con R:R ${rr(r!.rrPonderado)}, riesgo ${r!.nivel.toLowerCase()}.` : `${d.direccion}: ${d.resolucion}`,
  });
  const age = now - d.generadoA;
  const fresh = age >= 0 && age <= TICKET_MAX_AGE_MS && now - (d.vela + H) < H;
  checks.push({
    id: "fresco",
    ok: fresh,
    label: "Lectura fresca",
    detail: fresh ? `Analizado hace ${Math.max(0, Math.round(age / 60_000))} min, con la última vela cerrada.` : "La lectura tiene más de 10 minutos o no es de la última vela: volvé a analizar.",
  });
  const live = d.precioVivo;
  const rrLive = p && live !== null ? rrFrom(p, live) : null;
  const priceOk = p !== null && live !== null && rrLive !== null && (p.tipoEntrada === "LÍMITE" || rrLive >= MIN_RR);
  checks.push({
    id: "precio",
    ok: priceOk,
    label: "Precio en vivo dentro del plan",
    detail:
      live === null
        ? "No se pudo leer el precio en vivo: este dato no está disponible actualmente."
        : rrLive === null
          ? `Ahora ${px(live)}: ya está del otro lado del stop o del TP1.`
          : `Ahora ${px(live)}: entrando a ese precio el R:R es ${rr(rrLive)}${p?.tipoEntrada === "MERCADO" && rrLive < MIN_RR ? ` (menos del mínimo, ${rr(MIN_RR)})` : ""}.`,
  });
  const capital = settings.capital && settings.capital > 0 ? settings.capital : null;
  checks.push({
    id: "capital",
    ok: capital !== null && r?.posicionUsd !== null && r?.posicionUsd !== undefined,
    label: "Capital cargado",
    detail: capital !== null ? `${usd(capital)}: con eso se calcula el tamaño.` : "Cargá tu capital en «Mi riesgo»: sin eso no hay tamaño.",
  });
  checks.push({
    id: "riesgo",
    ok: settings.riesgoPct <= MAX_TICKET_RISK_PCT,
    label: `Riesgo por operación de ${arNumber(MAX_TICKET_RISK_PCT)}% o menos`,
    detail: `Configurado en ${arNumber(settings.riesgoPct)}%.`,
  });
  const levOk = r !== null && r.apalancamiento <= r.apalancamientoMaxSeguro && r.liquidacionVsStop >= 3;
  checks.push({
    id: "liquidacion",
    ok: levOk,
    label: "Liquidación lejos del stop",
    detail: r ? `Con ${r.apalancamiento}x la liquidación (≈ ${px(r.liquidacionAprox)}) queda ${arNumber(Number(r.liquidacionVsStop.toFixed(1)))} veces más lejos que el stop.` : "Sin plan no hay apalancamiento que revisar.",
  });
  checks.push({
    id: "confirmacion",
    ok: confirmed,
    label: "Tu confirmación",
    detail: confirmed ? "Confirmaste que la orden la cargás vos, con tu dinero y bajo tu responsabilidad." : "Falta que confirmes que la orden la cargás vos en tu exchange.",
  });
  const ready = checks.every((c) => c.ok);
  if (!ready || !p || !r || r.posicionUsd === null || r.cantidad === null || r.riesgoUsd === null || r.margenUsd === null || capital === null) {
    return { ready: false, checks, text: null, expiresAt: null };
  }
  const expiresAt = d.generadoA + TICKET_TTL_MS;
  const text = [
    `ORDEN MANUAL · ${d.moneda}/USDT perpetuo · ${p.lado}`,
    `Tipo: ${p.tipoEntrada === "LÍMITE" ? `límite en ${px(p.entrada)}` : "mercado"}`,
    `Entrada: ${px(p.entrada)}${p.tipoEntrada === "MERCADO" && live !== null ? ` (ahora ${px(live)})` : ""}`,
    `Stop loss: ${px(p.stop)} (stop-market, reduce-only)`,
    `TP1: ${px(p.tp[0].price)} · un tercio (reduce-only)`,
    `TP2: ${px(p.tp[1].price)} · un tercio (reduce-only)`,
    `TP3: ${px(p.tp[2].price)} · el resto (reduce-only)`,
    `Cantidad: ${px(r.cantidad)} ${d.moneda} (≈ ${usd(r.posicionUsd)})`,
    `Apalancamiento: ${r.apalancamiento}x aislado · margen ≈ ${usd(r.margenUsd)}`,
    `Riesgo: ${usd(r.riesgoUsd)} (${arNumber(settings.riesgoPct)}% de ${usd(capital)}) · R:R ${rr(r.rrPonderado)}`,
    `Liquidación aprox.: ${px(r.liquidacionAprox)}`,
    `Armado por JARVIS a las ${hourAr(d.generadoA)} (hora argentina). Vence a las ${hourAr(expiresAt)}: después, volvé a analizar.`,
    "JARVIS no envía órdenes: esta la cargás vos en tu exchange. No es asesoramiento financiero.",
  ].join("\n");
  return { ready: true, checks, text: now <= expiresAt ? text : null, expiresAt };
}
