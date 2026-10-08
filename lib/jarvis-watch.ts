import { arNumber } from "./ai-numbers.ts";
import type { Alert, AlertPriority } from "./alerts.ts";
import type { CryptoNewsItem } from "./crypto-news.ts";
import type { DeskDecision } from "./jarvis-desk.ts";
import type { LiveLiquidation } from "./live-market.ts";
import { divergenceStats, oscillatorState } from "./oscillators.ts";
import type { SwingCandle } from "./swing-entries.ts";

/**
 * Las alertas de la mesa de JARVIS, configurables: lo que la persona pidió que
 * la mesa vigile en sus activos. Cada regla mira datos medidos (velas
 * cerradas, derivados de Binance, el tape real de liquidaciones, titulares
 * con su fuente) y avisa una sola vez por vela o evento. Nada se estima a
 * escondidas: si un dato falta, esa regla no dispara.
 */

export type WatchKind = "RUPTURA" | "SOPORTE" | "ESTRUCTURA" | "VOLUMEN" | "FUNDING" | "OI" | "LIQUIDACIONES" | "DIVERGENCIA" | "NOTICIA";

export const WATCH_KINDS: { id: WatchKind; label: string; hint: string }[] = [
  { id: "RUPTURA", label: "Ruptura de resistencia", hint: "Un cierre de 1 h por encima de un nivel de la mesa" },
  { id: "SOPORTE", label: "Pérdida de soporte", hint: "Un cierre de 1 h por debajo de un nivel de la mesa" },
  { id: "ESTRUCTURA", label: "Cambio de estructura", hint: "La tendencia de 4 h o diaria cambia" },
  { id: "VOLUMEN", label: "Volumen anormal", hint: "La última vela de 1 h con varias veces el volumen normal" },
  { id: "FUNDING", label: "Funding fuerte", hint: "Funding extremo o un salto entre dos lecturas" },
  { id: "OI", label: "Suba de interés abierto", hint: "El interés abierto sube fuerte en 24 h" },
  { id: "LIQUIDACIONES", label: "Grandes liquidaciones", hint: "Liquidaciones reales de Binance, en vivo, con la app abierta" },
  { id: "DIVERGENCIA", label: "Divergencias", hint: "RSI o MACD contra el precio en 4 h" },
  { id: "NOTICIA", label: "Noticias importantes", hint: "Titulares de alto impacto sobre tus activos" },
];

export type WatchPrefs = {
  enabled: boolean;
  symbols: string[];
  kinds: Record<WatchKind, boolean>;
  /** Veces el volumen normal de la última vela de 1 h. */
  volumenX: number;
  /** |funding| por período de 8 h, en %. */
  fundingPct: number;
  /** Cambio de funding entre dos lecturas, en puntos porcentuales. */
  fundingSalto: number;
  /** Suba del interés abierto en 24 h, en %. */
  oiPct: number;
  /** Una liquidación real de al menos este monto, en USD. */
  liquidacionUsd: number;
};

export const DEFAULT_WATCH_PREFS: WatchPrefs = {
  enabled: false,
  symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
  kinds: { RUPTURA: true, SOPORTE: true, ESTRUCTURA: true, VOLUMEN: true, FUNDING: true, OI: true, LIQUIDACIONES: true, DIVERGENCIA: true, NOTICIA: true },
  volumenX: 3,
  fundingPct: 0.05,
  fundingSalto: 0.03,
  oiPct: 10,
  liquidacionUsd: 1_000_000,
};

export const MAX_WATCHED = 6;
/** BTC, ETH y SOL ya tienen sus alertas de volumen en el centro de alertas: acá no se repiten. */
export const CENTER_VOLUME = new Set(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);

/** Lo que la vigilancia recuerda de un activo entre dos lecturas. */
export type WatchMemory = { at: number; trends: Record<string, string>; fundingPct: number | null };
/** Una lectura vieja no sirve para comparar: un cambio de días no es un cambio "ahora". */
export const MEMORY_MAX_AGE_MS = 12 * 3_600_000;

const H = 3_600_000;
const coinOf = (s: string) => s.replace(/USDT$/, "");
const px = (v: number) => arNumber(v);
const n2 = (v: number) => arNumber(Number(v.toFixed(2)));
const stars = (n: number) => "★".repeat(Math.max(1, Math.min(3, n)));
const NOT_ADVICE = "No es asesoramiento financiero.";

const alertOf = (id: string, priority: AlertPriority, symbol: string, title: string, body: string, at: number): Alert => ({ id: `mesa:${id}`, priority, category: "MESA", symbol, title, body, at });

export type WatchInput = {
  d: DeskDecision;
  /** Velas de 1 h y 4 h ya cerradas, de las que leyó la mesa. */
  h1: SwingCandle[];
  h4: SwingCandle[] | null;
  news: CryptoNewsItem[] | null;
  prev: WatchMemory | null;
  now: number;
  prefs: WatchPrefs;
};

/** Las alertas de un activo en esta lectura, y lo que hay que recordar para la próxima. */
export function watchAlerts(x: WatchInput): { alerts: Alert[]; memory: WatchMemory } {
  const { d, h1, prefs, now } = x;
  const sym = d.symbol;
  const coin = coinOf(sym);
  const out: Alert[] = [];
  const structure = d.agentes.find((a) => a.id === "estructura");
  const trends: Record<string, string> = {};
  for (const tf of ["1h", "4h", "1d"]) {
    const v = structure?.datos[`tendencia${tf}`];
    if (typeof v === "string") trends[tf] = v;
  }
  const der = d.agentes.find((a) => a.id === "derivados");
  const fundingPct = der?.disponible && typeof der.datos.fundingPct === "number" ? der.datos.fundingPct : null;
  const memory: WatchMemory = { at: now, trends, fundingPct };
  const prev = x.prev && now - x.prev.at <= MEMORY_MAX_AGE_MS ? x.prev : null;
  const last = h1[h1.length - 1];
  const before = h1[h1.length - 2];

  // Breaks: the last closed 1 h candle closed across one of the desk's levels.
  if (last && before && (prefs.kinds.RUPTURA || prefs.kinds.SOPORTE)) {
    const levels = [...d.niveles.soportes, ...d.niveles.resistencias];
    const up = levels.filter((l) => before.close < l.precio && last.close > l.precio).sort((a, b) => b.estrellas - a.estrellas || a.precio - b.precio)[0];
    const down = levels.filter((l) => before.close > l.precio && last.close < l.precio).sort((a, b) => b.estrellas - a.estrellas || b.precio - a.precio)[0];
    if (up && prefs.kinds.RUPTURA) {
      out.push(alertOf(`rompe:${sym}:${up.precio}:${last.openTime}`, up.estrellas >= 2 ? "IMPORTANTE" : "INFORMATIVA", sym, `${coin} rompió ${px(up.precio)} hacia arriba`, `Cierre de 1 h en ${px(last.close)} por encima de un nivel ${stars(up.estrellas)} de la mesa. Una vela no confirma: la ruptura vale si sostiene. ${NOT_ADVICE}`, last.openTime + H));
    }
    if (down && prefs.kinds.SOPORTE) {
      out.push(alertOf(`pierde:${sym}:${down.precio}:${last.openTime}`, down.estrellas >= 2 ? "IMPORTANTE" : "INFORMATIVA", sym, `${coin} perdió ${px(down.precio)}`, `Cierre de 1 h en ${px(last.close)} por debajo de un nivel ${stars(down.estrellas)} de la mesa. Una vela no confirma: la pérdida vale si no lo recupera. ${NOT_ADVICE}`, last.openTime + H));
    }
  }

  // Structure: the 4 h or daily trend changed since the previous reading.
  if (prefs.kinds.ESTRUCTURA && prev) {
    for (const tf of ["4h", "1d"]) {
      const was = prev.trends[tf];
      const is = trends[tf];
      if (!was || !is || was === is) continue;
      const flip = (was === "ALCISTA" && is === "BAJISTA") || (was === "BAJISTA" && is === "ALCISTA");
      out.push(alertOf(`estructura:${sym}:${tf}:${is}:${d.vela}`, flip ? "IMPORTANTE" : "INFORMATIVA", sym, `${coin}: la tendencia de ${tf === "1d" ? "diario" : "4 h"} pasó de ${was.toLowerCase()} a ${is.toLowerCase()}`, `Cambio de estructura leído por la mesa sobre velas cerradas. ${NOT_ADVICE}`, now));
    }
  }

  // Volume: the last closed 1 h candle against its normal (BTC, ETH and SOL already have it in the alert centre).
  const vol = d.agentes.find((a) => a.id === "volumen")?.datos.volumenRelativo1h;
  if (prefs.kinds.VOLUMEN && !CENTER_VOLUME.has(sym) && typeof vol === "number" && vol >= prefs.volumenX && last) {
    const dir = last.close >= last.open ? "subiendo" : "bajando";
    out.push(alertOf(`volumen:${sym}:${last.openTime}`, vol >= 2 * prefs.volumenX ? "IMPORTANTE" : "INFORMATIVA", sym, `${coin}: volumen ${n2(vol)}× lo normal en 1 h`, `La última vela de 1 h cerró ${dir} con ${n2(vol)} veces el volumen de las 20 anteriores. ${NOT_ADVICE}`, last.openTime + H));
  }

  // Funding: extreme, or a jump between two readings.
  if (prefs.kinds.FUNDING && fundingPct !== null) {
    const period = Math.floor(now / (8 * H));
    if (Math.abs(fundingPct) >= prefs.fundingPct) {
      const who = fundingPct > 0 ? "los largos pagan a los cortos" : "los cortos pagan a los largos";
      out.push(alertOf(`funding:${sym}:${period}:${fundingPct > 0 ? "+" : "-"}`, Math.abs(fundingPct) >= 2 * prefs.fundingPct ? "IMPORTANTE" : "INFORMATIVA", sym, `${coin}: funding ${fundingPct > 0 ? "+" : ""}${arNumber(Number(fundingPct.toFixed(4)))}% cada 8 h`, `Funding extremo: ${who}. Posicionamiento cargado de un lado; suele anticipar barridas en contra. Fuente: Binance Futures. ${NOT_ADVICE}`, now));
    }
    const was = prev?.fundingPct ?? null;
    if (was !== null && Math.abs(fundingPct - was) >= prefs.fundingSalto) {
      out.push(alertOf(`funding-salto:${sym}:${period}:${Math.round(fundingPct * 1e4)}`, "INFORMATIVA", sym, `${coin}: el funding cambió fuerte`, `De ${arNumber(Number(was.toFixed(4)))}% a ${arNumber(Number(fundingPct.toFixed(4)))}% cada 8 h entre dos lecturas. Fuente: Binance Futures. ${NOT_ADVICE}`, now));
    }
  }

  // Open interest: a strong rise in 24 h (fires again only on the next 5% step of the same day).
  const oi = der?.disponible ? der.datos.cambioInteresAbierto24hPct : null;
  if (prefs.kinds.OI && typeof oi === "number" && oi >= prefs.oiPct && last) {
    const rising = h1.length > 24 ? last.close >= h1[h1.length - 25].close : null;
    const read = rising === null ? "" : rising ? " con el precio subiendo: entran posiciones nuevas a favor del movimiento" : " con el precio bajando: entran cortos o se cargan largos contra el movimiento";
    out.push(alertOf(`oi:${sym}:${Math.floor(now / (24 * H))}:${Math.floor(oi / 5)}`, oi >= 2 * prefs.oiPct ? "IMPORTANTE" : "INFORMATIVA", sym, `${coin}: interés abierto +${n2(oi)}% en 24 h`, `Suba fuerte del interés abierto${read}. Fuente: Binance Futures. ${NOT_ADVICE}`, now));
  }

  // Divergences on 4 h, new on the last closed candles, with how they worked on this chart.
  if (prefs.kinds.DIVERGENCIA && x.h4 && x.h4.length >= 60) {
    const all = oscillatorState(x.h4, x.h4.length).recent.filter((v) => v.kind === "REGULAR");
    const fresh = all.filter((v) => v.age <= 6);
    if (fresh.length) {
      // The track record is every past divergence on this chart; the fresh ones are still open and never count.
      const st = divergenceStats(x.h4, all);
      for (const v of fresh.slice(0, 2)) {
        const at = x.h4[x.h4.length - 1 - v.age]?.openTime ?? d.vela;
        const measured = st.rate === null ? "sin casos medidos en este gráfico todavía" : `en este gráfico funcionó ${Math.round(st.rate * 100)}% de ${st.tested} veces${st.tested < 15 ? " (muestra mínima)" : ""}`;
        out.push(alertOf(`div:${sym}:${v.indicator}:${v.side}:${at}`, "INFORMATIVA", sym, `${coin}: divergencia ${v.side.toLowerCase()} de ${v.indicator} en 4 h`, `El precio marcó un ${v.side === "BAJISTA" ? "máximo más alto" : "mínimo más bajo"} que el ${v.indicator} no acompañó. Es una advertencia, no un gatillo: ${measured}. ${NOT_ADVICE}`, now));
      }
    }
  }

  // News: high-impact headlines about this coin from the last three hours, with their source.
  if (prefs.kinds.NOTICIA && x.news) {
    for (const n of x.news) {
      if (n.impact !== "ALTO" || now - n.publishedAt > 3 * H || !n.assets.includes(coin)) continue;
      out.push(alertOf(`noticia:${n.url}`, "IMPORTANTE", sym, `Noticia de alto impacto sobre ${coin}`, `${n.title} (${n.source}). Es el titular: JARVIS no verificó la nota.`, n.publishedAt));
    }
  }
  return { alerts: out, memory };
}

/** Una liquidación real grande de un activo vigilado (el tape en vivo de Binance). */
export function liquidationWatchAlert(l: LiveLiquidation, prefs: WatchPrefs): Alert | null {
  if (!prefs.enabled || !prefs.kinds.LIQUIDACIONES || !prefs.symbols.includes(l.symbol) || l.notionalUsd < prefs.liquidacionUsd) return null;
  const coin = coinOf(l.symbol);
  const usd = l.notionalUsd >= 1e6 ? `${n2(l.notionalUsd / 1e6)} millones de dólares` : `${arNumber(Math.round(l.notionalUsd))} dólares`;
  return alertOf(
    `liq:${l.symbol}:${l.time}:${l.side}`,
    l.notionalUsd >= 5 * prefs.liquidacionUsd ? "CRITICA" : "IMPORTANTE",
    l.symbol,
    `${coin}: liquidaron ${usd} de ${l.side.toLowerCase()}`,
    `A ${px(l.price)}. Liquidación real informada por Binance en vivo; en cascadas Binance informa como máximo una por segundo por moneda, así que el total real puede ser mayor. ${NOT_ADVICE}`,
    l.time,
  );
}

/** Saneo de lo guardado en el equipo: nada fuera de rango, nunca más activos de los permitidos. */
export function cleanWatchPrefs(raw: unknown): WatchPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<WatchPrefs>;
  const num = (v: unknown, lo: number, hi: number, dflt: number) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : dflt);
  const symbols = Array.isArray(r.symbols) ? [...new Set(r.symbols.filter((s): s is string => typeof s === "string" && /^[A-Z0-9]{2,20}USDT$/.test(s)))].slice(0, MAX_WATCHED) : DEFAULT_WATCH_PREFS.symbols;
  const kinds = { ...DEFAULT_WATCH_PREFS.kinds };
  for (const k of Object.keys(kinds) as WatchKind[]) if (typeof r.kinds?.[k] === "boolean") kinds[k] = r.kinds[k];
  return {
    enabled: r.enabled === true,
    symbols: symbols.length ? symbols : DEFAULT_WATCH_PREFS.symbols,
    kinds,
    volumenX: num(r.volumenX, 1.5, 20, DEFAULT_WATCH_PREFS.volumenX),
    fundingPct: num(r.fundingPct, 0.01, 1, DEFAULT_WATCH_PREFS.fundingPct),
    fundingSalto: num(r.fundingSalto, 0.005, 1, DEFAULT_WATCH_PREFS.fundingSalto),
    oiPct: num(r.oiPct, 2, 200, DEFAULT_WATCH_PREFS.oiPct),
    liquidacionUsd: num(r.liquidacionUsd, 50_000, 1e9, DEFAULT_WATCH_PREFS.liquidacionUsd),
  };
}
