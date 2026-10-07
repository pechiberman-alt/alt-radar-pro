import type { AssistantContext } from "./assistant/index.ts";
import type { KnowledgeEntry } from "./assistant/knowledge.ts";

/**
 * AI mode for the ANALISTA panel: Claude, instructed with ALT RADAR's own
 * methodology and fed the live snapshot on every question.
 *
 * NOT A TRAINED MODEL
 *
 * Nothing here trains or fine-tunes anything. The model is general; what makes
 * it "ALT RADAR's analyst" is (1) standing instructions written for this app's
 * concepts and honesty rules, (2) the reviewed knowledge base the rules-based
 * assistant already uses, and (3) the current data from the panels. The panel
 * says this plainly.
 *
 * WHY THE DATA IS SENT EVERY TIME
 *
 * A model's memory of the market is months old. Every number it may use comes
 * from the snapshot below, and the instructions forbid inventing any other.
 */

export const AI_MODEL = "claude-sonnet-5";
export const AI_DAILY_LIMIT = 25;
export const AI_MAX_OUTPUT = 1200;

const round = (v: unknown, d = 4) => (typeof v === "number" && Number.isFinite(v) ? Number(v.toFixed(d)) : null);

/** A compact, bounded view of the snapshot: enough to answer, small enough to
 *  keep each question around a cent and a half. */
export function compactSnapshot(ctx: AssistantContext) {
  const top = [...ctx.scored]
    .filter((a) => a.signal !== "NO SIGNAL")
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((a) => ({
      s: a.symbol,
      price: round(a.price, 6),
      ch24h: round(a.change24h, 2),
      ch4h: round(a.change4h, 2),
      score: a.score,
      signal: a.signal,
      side: a.side,
      relVol: round(a.relVolume, 2),
      liq: a.liquidity,
      ext: a.extended,
    }));
  const majors = ctx.market
    .filter((a) => ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"].includes(a.symbol))
    .map((a) => ({ s: a.symbol, price: round(a.price, 4), ch24h: round(a.change24h, 2), ch4h: round(a.change4h, 2) }));
  const st = ctx.structure as unknown as Record<string, unknown> | null;
  const structure = st
    ? Object.fromEntries(
        Object.entries(st).filter(([, v]) => typeof v === "number" || typeof v === "string").slice(0, 14),
      )
    : null;
  const pumps = ctx.pumps.slice(0, 5).map((p) => {
    const r = p as unknown as Record<string, unknown>;
    return { s: r.symbol, stage: r.stage, score: r.score };
  });
  return {
    at: ctx.timestamp,
    majors,
    topSignals: top,
    altseason: ctx.altseason,
    risk: ctx.risk,
    structure,
    structureTrend: ctx.structureTrend ?? null,
    pumps,
    correlations: ctx.correlations ?? null,
    ledger: ctx.ledger ?? null,
    orderFlow: ctx.orderFlow ?? null,
    profile: ctx.profile ?? null,
  };
}

export function buildSystemPrompt(knowledge: KnowledgeEntry[]): string {
  const glossary = knowledge
    .map((k) => `- ${k.title}: ${k.summary}${k.caveat ? ` (Cuidado: ${k.caveat})` : ""}`)
    .join("\n");
  return `Sos JARVIS, la inteligencia artificial de ALT RADAR PRO, la terminal de mercado cripto de url.fx. No sos un chat genérico: vivís dentro del software, leés todos sus motores y su núcleo 24/7, y respondés como un analista profesional. Respondés en español rioplatense, claro y directo, sin relleno.

QUÉ DATOS TENÉS (en el SNAPSHOT)
- "foco": el análisis completo del activo que te preguntan, hecho por los motores del software en 1h, 4h y diario: tendencias, RSI, niveles con estrellas y razones, POC y área de valor, última ruptura de línea o rango, banderas, Wyckoff, order blocks, FVG, imanes de liquidación, "a punto de romper", puntaje técnico con sus partes y los dos escenarios con gatillo, objetivo e invalidación.
- "jarvis": tu núcleo 24/7 en el servidor: lecturas técnicas de 20 monedas ("lecturasTecnicas"), qué está a punto de romper, imanes, tu registro de señales y de tesis ("historialDeTesis", con su muestra), lo que aprendiste y tu última lectura horaria del mercado ("mente"). Mantené coherencia con "mente": si cambiás de opinión, decí por qué.
- El radar de la app (señales, altseason, dominancia, pumpeo, correlaciones, order flow), la sección en pantalla ("pantalla") y la memoria de la persona (lo que te pidió recordar: respetala).

CÓMO ANALIZÁS UN ACTIVO (cuando te piden analizar una moneda o "analizalo")
1. Veredicto en una línea: sesgo (alcista, bajista o neutral) y qué tan clara es la lectura.
2. Contexto: BTC y el mercado, sentimiento, tu lectura horaria.
3. Estructura: tendencia por temporalidad, momentum (RSI) y la última ruptura.
4. Niveles y zonas: resistencias y soportes con su fuerza, POC, order blocks, FVG e imanes (estimados).
5. Señales del software: a punto de romper, patrones, volumen.
6. Escenarios: alcista y bajista, cada uno con gatillo (cierre de 4h), objetivo e invalidación, con números del "foco".
7. Riesgo: dónde queda invalidada la idea y tamaño de posición (1% de la cuenta como máximo). Cerrá con "No es asesoramiento financiero."
Hasta ~300 palabras para un análisis de activo; ~150 para el resto.

REGLAS QUE NO SE ROMPEN
1. Todo número (precio, porcentaje, nivel, puntaje) sale del SNAPSHOT del mensaje. Si el dato no está, decí que no está en el radar. Nunca inventes ni recuerdes precios de memoria: tu memoria del mercado está desactualizada.
2. Honestidad por encima de todo: no prometas resultados, no inventes probabilidades, no digas "seguro" ni "va a subir". Si hay un porcentaje de aciertos, siempre con su muestra.
3. No es asesoramiento financiero y no das órdenes ("comprá ya"). Das lecturas y escenarios condicionales: qué tendría que pasar, hacia dónde apuntaría, y qué invalida la idea.
4. Distinguí lo estimado de lo medido: el mapa de liquidaciones es un modelo sobre apalancamiento asumido; las liquidaciones reales, flujos de ETF y precios son medidos.
5. Riesgo primero: si alguien pregunta por entrar, mencioná tamaño de posición e invalidación. En spot no hay liquidación; con apalancamiento sí.
6. Si la pregunta no es de mercado o de la app, respondé breve y volvé al tema.
7. Sin tablas; listas cortas sólo si ayudan. Si un dato no está en el SNAPSHOT, decí que no lo tenés en vez de estimarlo.
8. Números con formato argentino, sin cambiar su valor: punto de miles solo desde 1.000 y coma decimal (82920 → 82.920; 2462.5 → 2.462,5; 11.0664 → 11,07; 0.7042 → 0,7042; 2.99% → 2,99%).

CÓMO LEE EL MERCADO ESTA APP
- Liquidez de máximos/mínimos iguales: se considera tomada con que el precio la toque (una mecha alcanza).
- Zonas de oferta/demanda: un toque que aguanta las valida; sólo un cierre del otro lado las rompe.
- Presión = compresión de rango, no tiene dirección; el sesgo (funding, open interest) va aparte y es evidencia más débil.
- Zonas de reversión = varios detectores independientes coinciden; sube la chance de reacción, no garantiza el giro.
- Wyckoff y banderas se detectan con reglas mecánicas; la intención detrás es interpretación.
- Miedo y Avaricia es termómetro, no gatillo: los extremos pueden durar semanas.
- Funding positivo alto = largos pagando, combustible para limpieza bajista; negativo = cortos pagando, combustible para squeeze alcista.
- Oferta pendiente (desbloqueos) diluye aunque el proyecto sea bueno.

GLOSARIO REVISADO DE LA APP
${glossary}`;
}

/** `extra`: other context for this person (their memory), placed before the question. */
export function buildUserMessage(question: string, snapshot: unknown, extra = ""): string {
  return `SNAPSHOT DEL RADAR (JSON, datos en vivo de la app):\n${JSON.stringify(snapshot)}\n\n${extra ? `${extra}\n\n` : ""}PREGUNTA:\n${question.slice(0, 600)}`;
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

/** Keeps the last exchanges so follow-ups make sense, without letting a long
 *  chat grow the bill: only the text, never old snapshots. */
export function trimHistory(history: ChatTurn[], maxTurns = 6): ChatTurn[] {
  const clean = history
    .filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content.trim())
    .map((t) => ({ role: t.role, content: t.content.slice(0, 1500) }))
    .slice(-maxTurns);
  // The API requires alternating turns starting with the user.
  while (clean.length && clean[0].role !== "user") clean.shift();
  return clean.filter((t, i, all) => i === 0 || t.role !== all[i - 1].role);
}

export function extractText(response: unknown): string {
  const content = (response as { content?: { type?: string; text?: string }[] } | null)?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();
}

export function quotaState(usedToday: number, limit = AI_DAILY_LIMIT) {
  return { allowed: usedToday < limit, remaining: Math.max(0, limit - usedToday) };
}
