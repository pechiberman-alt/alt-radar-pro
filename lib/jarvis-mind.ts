import type { Brain } from "./ai-brains.ts";
import { arNumber, parseLevel } from "./ai-numbers.ts";
import type { CoreSignal, Mind } from "./jarvis-core.ts";
import type { LvStats } from "./liq-vol-signals.ts";
import type { LearnSummary } from "./jarvis-learn.ts";
import type { World } from "./jarvis-world.ts";

/**
 * JARVIS MENTE: once an hour, on the server, JARVIS writes its own reading of
 * the market from everything the software knows — the technical read of 20
 * coins (trend by timeframe, levels, volume, pressure), the liquidation
 * magnets, market structure, Fear & Greed and the news, what its core learned
 * and its own track record — and, when the evidence is clear, a thesis with a
 * target and an invalidation. Theses are kept as signals of source "IA" and
 * resolved like any other (worst case first, fees, 48 candles), and that
 * record goes back into the next hour's prompt: the AI is told how its own
 * calls are doing and asked to calibrate. That is what "learning" means here,
 * measured and with its sample size; no model is retrained.
 */

export type MindThesis = {
  id: string;
  moneda: string;
  lado: "LONG" | "SHORT";
  entrada: number;
  objetivo: number;
  invalidacion: number;
  confianza: "BAJA" | "MEDIA" | "ALTA";
  porque: string;
};

export type MindReading = {
  at: number;
  brain: Brain;
  model: string;
  sesgo: "ALCISTA" | "BAJISTA" | "NEUTRAL";
  /** The bias of the reading before this one, to tell when it changed. */
  sesgoAnterior: "ALCISTA" | "BAJISTA" | "NEUTRAL" | null;
  resumen: string;
  activos: { moneda: string; lectura: string }[];
  riesgos: string[];
  vigilar: string[];
  tesis: MindThesis[];
  /** Theses the AI proposed that did not pass the checks, with why. */
  descartadas: { moneda: string; motivo: string }[];
};

export const MIND_MAX_THESES = 3;
export const MIND_MAX_OUTPUT = 1800;

export const MIND_SYSTEM = `Sos JARVIS, la inteligencia artificial de ALT RADAR PRO (marca url.fx). Vivís en el servidor y cada hora escribís tu lectura del mercado con los datos del software que te paso en DATOS.

Respondé SOLO con un objeto JSON válido, sin texto antes ni después, con esta forma exacta:
{"sesgo":"ALCISTA|BAJISTA|NEUTRAL","resumen":"...","activos":[{"moneda":"BTC","lectura":"..."}],"riesgos":["..."],"vigilar":["..."],"tesis":[{"moneda":"SOL","sesgo":"ALCISTA|BAJISTA","objetivo":"nivel","invalidacion":"nivel","confianza":"BAJA|MEDIA|ALTA","porque":"..."}]}

REGLAS
1. Todo número sale de DATOS (precios, niveles, imanes, porcentajes). Nada de memoria: tu memoria del mercado está desactualizada.
2. "resumen": 2 a 4 frases profesionales. Régimen (BTC y altcoins), sentimiento, qué manda ahora y qué cambió desde tu lectura anterior.
3. "activos": hasta 6 monedas, las más relevantes ahora (a punto de romper, tendencias alineadas, cerca de un imán o de un nivel). Una o dos frases técnicas cada una, con niveles concretos.
4. "tesis": de 0 a 3, solo con evidencia clara que coincida en varias temporalidades. "objetivo" e "invalidacion" son niveles de DATOS (soportes, resistencias, imanes), copiados como texto tal cual aparecen. Horizonte: 48 horas. Objetivo/riesgo entre 1,5 y 4. Si no hay nada claro, la lista va vacía: nunca inventes oportunidades.
5. Calibrá la confianza con TU HISTORIAL (en DATOS): si tus tesis vienen perdiendo, sé más exigente y bajá la confianza. Con menos de 15 tesis cerradas la muestra es mínima: decilo si opinás sobre tu rendimiento.
6. Distinguí lo medido (precios, volumen) de lo estimado (imanes de liquidación = modelo). No prometas resultados; no es asesoramiento financiero.
7. Español rioplatense, claro y directo.
8. Los números de DATOS ya vienen en formato argentino, con punto de miles y coma decimal: "82.920" son ochenta y dos mil, "11,066" es once, "0,7042" es menos de uno. Copialos así: nunca cambies puntos por comas ni comas por puntos. Los cambios ("c24", "c7d") y las distancias ya son porcentajes: "-2,99" se escribe -2,99%.`;

const coin = (s: string) => s.replace(/USDT$/, "");
const r2 = (v: number | null | undefined) => (v === null || v === undefined ? null : Number(v.toFixed(2)));

/** The track record of the IA theses, plus the last ones closed, for the prompt. */
export function thesisRecord(stats: LvStats, recent: CoreSignal[]) {
  return {
    cerradas: stats.resolved,
    abiertas: stats.open,
    winRate: stats.winRate === null ? null : Math.round(stats.winRate * 100),
    profitFactor: stats.profitFactor === null ? null : stats.profitFactor === Infinity ? "infinito" : r2(stats.profitFactor),
    totalR: r2(stats.totalR),
    muestra: stats.confidence,
    ultimas: recent
      .filter((s) => s.source === "IA" && s.r !== null)
      .slice(0, 8)
      .map((s) => ({ moneda: coin(s.symbol), lado: s.side, resultado: s.result, r: r2(s.r), nota: s.note })),
  };
}

/** Everything the software knows right now, compact, for the hourly reading. */
export function mindDossier(input: {
  mind: Mind;
  world: World | null;
  structure: Record<string, unknown> | null;
  record: ReturnType<typeof thesisRecord>;
  open: CoreSignal[];
  learning: LearnSummary | null;
  previous: Pick<MindReading, "at" | "sesgo" | "resumen"> | null;
  now: number;
}) {
  const { mind, world } = input;
  const reads = Object.entries(mind.reads ?? {}).filter(([, r]) => input.now - r.at < 3 * 3_600_000);
  const magnet = (m: { price: number; distancePct: number; intensity: number } | null) => (m ? { precio: m.price, distanciaPct: r2(m.distancePct), intensidad: Math.round(m.intensity) } : null);
  return {
    ahora: new Date(input.now).toISOString(),
    btc: mind.btc ? { regimen24h: mind.btc.regime, cambio24h: r2(mind.btc.change24 === null ? null : mind.btc.change24 * 100) } : null,
    monedas: reads.map(([s, r]) => ({
      m: coin(s),
      precio: r.precio,
      c24: r2(r.cambio24h === null ? null : r.cambio24h * 100),
      c7d: r2(r.cambio7d === null ? null : r.cambio7d * 100),
      tend: r.tendencias,
      alin: r.alineacion,
      sop: r.soportes.map((l) => l.precio),
      res: r.resistencias.map((l) => l.precio),
      vol: r.volumen24VsSemana,
      aPunto: r.aPunto ? `${r.aPunto.state} ${r.aPunto.side} ${r.aPunto.score}` : null,
    })),
    imanes: Object.fromEntries(Object.entries(mind.magnets).filter(([, m]) => input.now - m.at < 3 * 3_600_000).map(([s, m]) => [coin(s), { arriba: magnet(m.above), abajo: magnet(m.below) }])),
    estructura: input.structure
      ? {
          dominanciaBtc: r2(Number(input.structure.btc_dominance)),
          dominanciaUsdt: r2(Number(input.structure.usdt_dominance)),
          capTotalBillones: r2(Number(input.structure.total_market_cap) / 1e12),
        }
      : null,
    sentimiento: world?.fearGreed ? { miedoYAvaricia: world.fearGreed.value, zona: world.fearGreed.zone, ayer: world.fearGreed.yesterday, semanaPasada: world.fearGreed.weekAgo } : null,
    noticias: (world?.news ?? []).slice(0, 6).map((n) => ({ titulo: n.title, impacto: n.impact, tono: n.tone, activos: n.assets })),
    nucleo: input.learning ? { leccionesRupturas: input.learning.sources.ROMPE.lessons.slice(0, 3), casosEstudiados: input.learning.historyCases } : null,
    tuHistorialDeTesis: input.record,
    tesisAbiertas: input.open.filter((s) => s.source === "IA").map((s) => ({ moneda: coin(s.symbol), lado: s.side, entrada: s.entry, objetivo: s.target, invalidacion: s.stop })),
    lecturaAnterior: input.previous ? { haceMin: Math.round((input.now - input.previous.at) / 60_000), sesgo: input.previous.sesgo, resumen: input.previous.resumen } : null,
    fuente: mind.feed ? `velas de ${mind.feed.venue}${mind.feed.venue === "KRAKEN" || mind.feed.venue === "COINBASE" ? " en USD (Binance bloquea al servidor)" : ""}` : null,
  };
}

type RawThesis = { moneda?: unknown; sesgo?: unknown; objetivo?: unknown; invalidacion?: unknown; confianza?: unknown; porque?: unknown };
export type RawMind = { sesgo?: unknown; resumen?: unknown; activos?: unknown; riesgos?: unknown; vigilar?: unknown; tesis?: unknown };

/** The JSON object in a model's answer, even wrapped in ```json fences or with a sentence around it. */
export function parseMindAnswer(text: string): RawMind | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1)) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as RawMind) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const strs = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) : []);
const bias = (v: unknown): MindReading["sesgo"] => (v === "ALCISTA" || v === "BAJISTA" ? v : "NEUTRAL");

/** The reading's text fields, cleaned and bounded; theses are checked apart (checkThesis). */
export function readingText(raw: RawMind) {
  return {
    sesgo: bias(raw.sesgo),
    resumen: str(raw.resumen, 900),
    activos: (Array.isArray(raw.activos) ? raw.activos : [])
      .map((a) => ({ moneda: str((a as { moneda?: unknown })?.moneda, 12).toUpperCase().replace(/USDT$/, ""), lectura: str((a as { lectura?: unknown })?.lectura, 420) }))
      .filter((a) => a.moneda && a.lectura)
      .slice(0, 6),
    riesgos: strs(raw.riesgos, 4, 240),
    vigilar: strs(raw.vigilar, 4, 240),
  };
}

export function rawTheses(raw: RawMind): RawThesis[] {
  return Array.isArray(raw.tesis) ? (raw.tesis as RawThesis[]).slice(0, 6) : [];
}

/**
 * A thesis is kept only if it is a real plan from the current price: a
 * direction, the target on its side and the invalidation on the other, risk
 * between 0,4% and 12% of the price, and reward between 1 and 6 times the risk.
 * The entry is never the AI's number: it is the close of the last candle.
 */
export function checkThesis(t: RawThesis, entry: number): { ok: true; lado: "LONG" | "SHORT"; objetivo: number; invalidacion: number; confianza: MindThesis["confianza"]; porque: string } | { ok: false; motivo: string } {
  const lado = t.sesgo === "ALCISTA" ? "LONG" : t.sesgo === "BAJISTA" ? "SHORT" : null;
  if (!lado) return { ok: false, motivo: "sin dirección" };
  const objetivo = parseLevel(t.objetivo, entry);
  const invalidacion = parseLevel(t.invalidacion, entry);
  if (!(entry > 0) || objetivo === null || invalidacion === null) return { ok: false, motivo: "niveles inválidos" };
  const long = lado === "LONG";
  if (long ? !(invalidacion < entry && entry < objetivo) : !(objetivo < entry && entry < invalidacion)) return { ok: false, motivo: "objetivo o invalidación del lado equivocado del precio" };
  const risk = Math.abs(entry - invalidacion) / entry;
  const rr = Math.abs(objetivo - entry) / Math.abs(entry - invalidacion);
  if (risk < 0.004 || risk > 0.12) return { ok: false, motivo: `riesgo de ${(risk * 100).toFixed(1).replace(".", ",")}% fuera de 0,4–12%` };
  if (rr < 1 || rr > 6) return { ok: false, motivo: `objetivo/riesgo ${rr.toFixed(1).replace(".", ",")} fuera de 1–6` };
  const confianza = t.confianza === "ALTA" || t.confianza === "MEDIA" ? t.confianza : "BAJA";
  return { ok: true, lado, objetivo, invalidacion, confianza, porque: str(t.porque, 280) };
}

/** A thesis as a signal of the core's record (source IA), entered at the close of the last closed candle. */
export function thesisSignal(symbol: string, candleOpenTime: number, entry: number, c: Extract<ReturnType<typeof checkThesis>, { ok: true }>, venueNote = ""): CoreSignal {
  return {
    id: `IA:${symbol}:1h:${candleOpenTime}:${c.lado}`,
    source: "IA",
    symbol,
    timeframe: "1h",
    side: c.lado,
    time: candleOpenTime,
    entry,
    stop: c.invalidacion,
    target: c.objetivo,
    note: `tesis de la IA · confianza ${c.confianza.toLowerCase()}${venueNote}`,
    result: "ABIERTA",
    r: null,
    closedAt: null,
    taken: true,
    grade: null,
    expectR: null,
    expectSe: null,
    features: null,
    why: c.porque || null,
  };
}

/** What JARVIS says when asked for its reading of the market. */
export function readingSpeech(r: MindReading, now: number): string {
  const ago = Math.max(1, Math.round((now - r.at) / 60_000));
  const parts = [`Mi lectura de hace ${ago} ${ago === 1 ? "minuto" : "minutos"}: mercado ${r.sesgo === "NEUTRAL" ? "sin dirección clara" : r.sesgo.toLowerCase()}. ${r.resumen}`];
  if (r.tesis.length) parts.push(`Tesis nuevas: ${r.tesis.map((t) => `${t.moneda} ${t.lado === "LONG" ? "alcista" : "bajista"}, objetivo ${arNumber(t.objetivo)}, invalidación ${arNumber(t.invalidacion)}`).join("; ")}.`);
  if (r.vigilar.length) parts.push(`A vigilar: ${r.vigilar.slice(0, 2).join("; ")}.`);
  parts.push("No es asesoramiento financiero.");
  return parts.join(" ");
}
