/**
 * El conocimiento profesional que acompaña a cada agente de la oficina: los conceptos de lib/assistant/knowledge.ts
 * (escritos y revisados una vez, no generados) que explican lo que su regla mira. Se muestran en su ficha, van a su chat con
 * la IA y, sin IA, el motor local contesta con ellos. Explican la lectura; no cambian la regla ni prometen resultados.
 * Pura: sin red ni base.
 */
import { conceptById, findConcepts, type KnowledgeEntry } from "./assistant/knowledge.ts";

/** Los conceptos de cada agente con regla propia; el resto toma los de su mesa. */
const DEL_AGENTE: Record<string, string[]> = {
  ABSORCION: ["absorcion", "volumen-relativo", "iceberg", "agresor-pasivo"],
  ESFUERZO: ["esfuerzo-resultado", "volumen-relativo", "absorcion"],
  BARRIDA_VOL: ["caza-stops", "mapa-liquidez", "volumen-relativo"],
  DELTA_DIV: ["divergencia-delta", "cvd", "delta-vela", "agresor-pasivo"],
  DELTA_ABSORBIDO: ["delta-vela", "absorcion", "agresor-pasivo", "footprint"],
  ST_VWAP: ["vwap", "r-multiple"],
  ST_VWAP_PERFIL: ["vwap", "value-area"],
  ST_PERFIL: ["value-area", "r-multiple"],
  ST_MTF_VOL: ["volumen-relativo", "r-multiple"],
  SMC_LIQUIDEZ: ["caza-stops", "mapa-liquidez", "imbalance"],
  SMC_TODO: ["caza-stops", "mapa-liquidez", "imbalance"],
  AMD_IFVG: ["caza-stops", "imbalance", "mapa-liquidez"],
  SNR: ["value-area", "absorcion"],
  SNR_HTF: ["value-area", "absorcion"],
};
const DE_LA_MESA: Record<string, string[]> = {
  TENDENCIA: ["r-multiple", "riesgo-posicion", "walk-forward"],
  REVERSION: ["value-area", "caza-stops", "r-multiple"],
  ESTRUCTURA: ["caza-stops", "mapa-liquidez", "imbalance"],
  FLUJO: ["agresor-pasivo", "cvd", "absorcion", "footprint"],
  METALES: ["correlacion", "riesgo-posicion", "r-multiple"],
};

/** Los conceptos que explican a un agente (hasta 4, en orden), siempre del conocimiento revisado. */
export function conocimientoDe(id: string, mesa: string): KnowledgeEntry[] {
  const ids = [...(DEL_AGENTE[id] ?? []), ...(DE_LA_MESA[mesa] ?? [])];
  const out: KnowledgeEntry[] = [];
  for (const k of ids) {
    const e = conceptById(k);
    if (e && !out.includes(e)) out.push(e);
    if (out.length >= 4) break;
  }
  return out;
}

/** El conocimiento en la forma que va a la IA: tema, idea y cuidado, sin el detalle largo. */
export const conocimientoParaIa = (es: KnowledgeEntry[]) => es.map((e) => ({ tema: e.title, idea: e.summary, ...(e.caveat ? { cuidado: e.caveat } : {}) }));

/**
 * Sin IA, la respuesta del agente a una pregunta por un concepto: el detalle revisado y su cuidado, en su voz. Null si la
 * pregunta no nombra ningún concepto conocido (entonces el agente contesta con lo que ya dice de sí mismo).
 */
export function respuestaConcepto(pregunta: string): string | null {
  const [e] = findConcepts(pregunta, 1);
  if (!e) return null;
  return `${e.title}: ${e.summary} ${e.detail}${e.caveat ? ` Ojo: ${e.caveat}` : ""}`;
}
