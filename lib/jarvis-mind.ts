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
  /** Sentences of the AI taken out because a number or a level in them is not in the data (verifyReading). */
  quitadas?: string[];
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
8. Los números de DATOS ya vienen en formato argentino, con punto de miles y coma decimal: "82.920" son ochenta y dos mil, "11,066" es once, "0,7042" es menos de uno. Copialos así: nunca cambies puntos por comas ni comas por puntos. Los cambios ("c24", "c7d") y las distancias ya son porcentajes: "-2,99" se escribe -2,99%.
9. Soporte y resistencia son SOLO los de "sop" y "res" de cada moneda. Los "imanes" son zonas de liquidación estimadas: llamalos imán o zona de liquidaciones, nunca soporte ni resistencia. Si una moneda no tiene "sop", no le inventes un soporte. Cada frase con un número o un nivel que no esté en DATOS se borra antes de publicarse.`;

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

// ── The reading's numbers, checked against the data before anything is published ──

/** What the data says about one coin, to check the AI's sentences about it. */
export type CoinFacts = { precio: number; sop: number[]; res: number[]; imanes: number[] };
type MagnetLike = { precio: number } | null;
/** The part of the dossier the check reads (mindDossier gives it, numbers still as numbers). */
export type MindFacts = { monedas: { m: string; precio: number; sop: number[]; res: number[] }[]; imanes: Record<string, { arriba: MagnetLike; abajo: MagnetLike }> };

const NUM_TOKEN = /-?\d[\d.,]*\d|-?\d/g;
const AR_NUMBER = /^-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/;

/** A number written the Argentine way ("82.920", "2.564,3", "-2,44"), or null when it is not one ("1,146,2", "2.99"). */
export function readArNumber(token: string): number | null {
  return AR_NUMBER.test(token) ? Number(token.replace(/\./g, "").replace(",", ".")) : null;
}

/** The written number is the data's number, as rounded as it was written (or within 0,2%). */
function sameLevel(token: string, written: number, data: number): boolean {
  const decimals = token.includes(",") ? token.split(",")[1].length : 0;
  const diff = Math.abs(written - data);
  return diff <= 0.51 * 10 ** -decimals || diff <= Math.abs(data) * 0.002;
}

const LABEL = /\b(soportes?|resistencias?|im[aá]n(?:es)?)\b/gi;
/** Words that mean the next number belongs to something else ("pierde el soporte y busca el imán de 82.480"). */
const OTHER_THING = /im[aá]n|liquidac|zona|objetivo|rango|m[ií]nimo|m[aá]ximo|precio|hacia|hasta|soporte|resistencia|\by\b|\bo\b/i;
/** After a number, these say it is not a price: a percentage, a multiple, hours, candles, touches… */
const NOT_A_PRICE = /^\s*(%|x\b|veces|r\b|h\b|horas|d[ií]as|velas|toques|min|puntos|de\s+(?:cada|las)\b)/i;

/**
 * Why a sentence cannot be published, or null when it can: a number that is
 * not a number ("1,146,2"), a price of a coin off by more than 3 times (the
 * "11.066,4" for a coin of 11), or a support, resistance or magnet at a
 * price where the data has none (a magnet called support).
 */
export function sentenceProblem(sentence: string, coin: CoinFacts | null): string | null {
  const tokens = [...sentence.matchAll(NUM_TOKEN)].map((m) => ({ text: m[0], at: m.index ?? 0, value: readArNumber(m[0]) }));
  for (const t of tokens) if (t.value === null) return `número mal escrito: ${t.text}`;
  if (!coin || !(coin.precio > 0)) return null;
  for (const t of tokens) {
    const v = t.value as number;
    const after = sentence.slice(t.at + t.text.length);
    const year = !/[.,]/.test(t.text) && v >= 1990 && v <= 2100;
    const priceLike = v > 0 && !year && (/[.,]/.test(t.text) || t.text.length >= 4);
    if (!priceLike || NOT_A_PRICE.test(after)) continue;
    if (v / coin.precio > 3 || v / coin.precio < 1 / 3) return `precio fuera de escala: ${t.text}`;
  }
  for (const label of sentence.matchAll(LABEL)) {
    const end = (label.index ?? 0) + label[0].length;
    const next = tokens.find((t) => t.at >= end);
    if (!next) continue;
    const between = sentence.slice(end, next.at);
    if (between.length > 30 || OTHER_THING.test(between) || NOT_A_PRICE.test(sentence.slice(next.at + next.text.length))) continue;
    const kind = label[1].toLowerCase();
    const levels = kind.startsWith("sop") ? coin.sop : kind.startsWith("res") ? coin.res : coin.imanes;
    if (!levels.some((l) => sameLevel(next.text, next.value as number, l))) return `${kind} en ${next.text} no está en los datos`;
  }
  return null;
}

/**
 * The reading with every sentence that fails sentenceProblem taken out, and
 * the list of what was taken out. Brand rule: an unknown number is never
 * published as if it were measured. A coin left with nothing to say is
 * dropped; a summary left empty says why.
 */
export function verifyReading(text: ReturnType<typeof readingText>, facts: MindFacts): { text: ReturnType<typeof readingText>; quitadas: string[] } {
  const byCoin = new Map<string, CoinFacts>();
  for (const c of facts.monedas) {
    const mag = facts.imanes[c.m];
    byCoin.set(c.m, { precio: c.precio, sop: c.sop, res: c.res, imanes: [mag?.arriba?.precio, mag?.abajo?.precio].filter((x): x is number => typeof x === "number") });
  }
  const names = [...byCoin.keys()].filter((m) => /^[A-Z0-9]+$/.test(m));
  const mentioned = names.length ? new RegExp(`\\b(${names.join("|")})\\b`, "g") : null;
  const quitadas: string[] = [];
  const clean = (s: string, coinName: string | null) =>
    s
      .split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡"«0-9])/)
      .filter((sentence) => {
        const own = coinName ?? (() => {
          const found = new Set([...(mentioned ? sentence.matchAll(mentioned) : [])].map((m) => m[1]));
          return found.size === 1 ? [...found][0] : null;
        })();
        const problem = sentenceProblem(sentence, own ? (byCoin.get(own) ?? null) : null);
        if (problem) quitadas.push(`${sentence.slice(0, 160)} (${problem})`);
        return !problem;
      })
      .join(" ")
      .trim();
  const resumen = clean(text.resumen, null);
  return {
    text: {
      sesgo: text.sesgo,
      resumen: resumen || (text.resumen ? "Sin resumen esta hora: el texto de la IA traía números que no están en los datos y se quitó." : ""),
      activos: text.activos.map((a) => ({ moneda: a.moneda, lectura: clean(a.lectura, byCoin.has(a.moneda) ? a.moneda : null) })).filter((a) => a.lectura),
      riesgos: text.riesgos.map((r) => clean(r, null)).filter(Boolean),
      vigilar: text.vigilar.map((v) => clean(v, null)).filter(Boolean),
    },
    quitadas: quitadas.slice(0, 12),
  };
}

/** One sentence-checked text about one coin (a thesis's "why"). */
export function verifyCoinText(text: string, coinName: string, facts: MindFacts): string {
  const one = verifyReading({ sesgo: "NEUTRAL", resumen: "", activos: [{ moneda: coinName, lectura: text }], riesgos: [], vigilar: [] }, facts);
  return one.text.activos[0]?.lectura ?? "";
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
