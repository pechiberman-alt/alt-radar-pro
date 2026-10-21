/**
 * La mesa de flujo mirando un gráfico: corre las cinco reglas de lib/flujo-agentes.ts (las mismas, con los mismos números)
 * sobre las velas ya cerradas del mapa, en la temporalidad que se esté viendo, y devuelve dónde dispararon. Es una lectura
 * para mirar, no una operación: los agentes operan en papel solo en 4 h, con su escalera y su registro. Las dos reglas de
 * delta necesitan el volumen agresor de Binance; si las velas no lo traen, se dice (sinDelta) en vez de suponer cero.
 * Pura y causal: cada disparo usa solo velas hasta la suya.
 */
import { atr, volumenRelativo } from "./estrategias.ts";
import { deltaDe, senalAbsorcion, senalBarridaVol, senalDeltaAbsorbido, senalDeltaDiv, senalEsfuerzo, type SenalFlujo } from "./flujo-agentes.ts";
import type { SwingCandle } from "./swing-entries.ts";

export type IdFlujo = "ABSORCION" | "ESFUERZO" | "BARRIDA_VOL" | "DELTA_DIV" | "DELTA_ABSORBIDO";
export const LECTORES_FLUJO: { id: IdFlujo; codigo: string; corto: string; delta: boolean }[] = [
  { id: "ABSORCION", codigo: "ABSO", corto: "Absorción", delta: false },
  { id: "ESFUERZO", codigo: "ESFU", corto: "Esfuerzo sin resultado", delta: false },
  { id: "BARRIDA_VOL", codigo: "BARV", corto: "Barrida con volumen", delta: false },
  { id: "DELTA_DIV", codigo: "ΔDIV", corto: "Divergencia de delta", delta: true },
  { id: "DELTA_ABSORBIDO", codigo: "ΔABS", corto: "Delta absorbido", delta: true },
];

export type DisparoFlujo = SenalFlujo & { id: IdFlujo; codigo: string; corto: string; openTime: number; cierre: number; extremo: number };
export type LecturaFlujo = { disparos: DisparoFlujo[]; sinDelta: boolean; velas: number };

/** Cuántas velas cerradas se miran hacia atrás como mucho. */
export const VELAS_LECTURA_FLUJO = 120;

/**
 * Los disparos de la mesa de flujo en las últimas `ultimas` velas de la serie (que tienen que estar cerradas), del más
 * nuevo al más viejo. `sinDelta` dice si a las velas les falta el volumen agresor (las reglas de delta no pueden leer).
 */
export function lecturaFlujo(cerradas: SwingCandle[], ultimas = VELAS_LECTURA_FLUJO): LecturaFlujo {
  const n = cerradas.length;
  const desde = Math.max(0, n - Math.max(1, Math.min(ultimas, VELAS_LECTURA_FLUJO)));
  const sinDelta = !cerradas.slice(desde).some((c) => deltaDe(c) !== null);
  if (n < 2) return { disparos: [], sinDelta, velas: 0 };
  const a = atr(cerradas, 14);
  const vr = volumenRelativo(cerradas);
  const disparos: DisparoFlujo[] = [];
  for (let i = n - 1; i >= desde; i -= 1) {
    const c = cerradas[i];
    const leer: [IdFlujo, SenalFlujo | null][] = [
      ["ABSORCION", senalAbsorcion(cerradas, a, vr, i)],
      ["ESFUERZO", senalEsfuerzo(cerradas, a, vr, i)],
      ["BARRIDA_VOL", senalBarridaVol(cerradas, a, vr, i)],
      ["DELTA_DIV", sinDelta ? null : senalDeltaDiv(cerradas, a, i)],
      ["DELTA_ABSORBIDO", sinDelta ? null : senalDeltaAbsorbido(cerradas, a, vr, i)],
    ];
    for (const [id, s] of leer) {
      if (!s) continue;
      const l = LECTORES_FLUJO.find((x) => x.id === id)!;
      disparos.push({ ...s, id, codigo: l.codigo, corto: l.corto, openTime: c.openTime, cierre: c.close, extremo: s.lado === "LONG" ? c.low : c.high });
    }
  }
  return { disparos, sinDelta, velas: n - desde };
}

/** Cuántas velas atrás fue un disparo, en texto («en la última vela», «hace 3 velas»). */
export function haceVelas(disparo: DisparoFlujo, cerradas: SwingCandle[]): string {
  const k = cerradas.length - 1 - cerradas.findIndex((c) => c.openTime === disparo.openTime);
  return k <= 0 ? "en la última vela cerrada" : `hace ${k} ${k === 1 ? "vela" : "velas"}`;
}

// ── La foto del flujo al entrar (PLAN_CONFLUENCIA_1, lib/confluencia.ts) ──

/** Cuántas velas cerradas mira la foto del flujo: la de la señal y las dos anteriores. */
export const VELAS_FOTO_FLUJO = 3;

/** Lo que leía la mesa de flujo al entrar: lecturas a favor y en contra del lado de la entrada, y si había volumen agresor. */
export type FotoFlujo = { v: 1; aFavor: string[]; enContra: string[]; conDelta: boolean };

const CODIGOS_FLUJO = new Set(LECTORES_FLUJO.map((l) => l.codigo));

/**
 * La foto del flujo de una entrada, con la lectura de las últimas VELAS_FOTO_FLUJO velas cerradas (hasta la de la señal, así que
 * no mira el futuro). `propia` es el código del agente si es de la mesa de flujo: su propia regla no cuenta como confirmación.
 */
export function fotoFlujo(lectura: LecturaFlujo, lado: "LONG" | "SHORT", propia: string | null = null): FotoFlujo {
  const unicos = (xs: string[]) => [...new Set(xs)].sort();
  return {
    v: 1,
    aFavor: unicos(lectura.disparos.filter((d) => d.lado === lado && d.codigo !== propia).map((d) => d.codigo)),
    enContra: unicos(lectura.disparos.filter((d) => d.lado !== lado).map((d) => d.codigo)),
    conDelta: !lectura.sinDelta,
  };
}

/** El código de la mesa de flujo de un agente, o null si el agente no es de la mesa de flujo. */
export const codigoFlujoDe = (id: string): string | null => LECTORES_FLUJO.find((l) => l.id === id)?.codigo ?? null;

/** Lo que manda el navegador, revisado: solo códigos de la mesa de flujo. Si no tiene esta forma exacta, null (sin foto). */
export function validarFotoFlujo(raw: unknown): FotoFlujo | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const lista = (x: unknown) => (Array.isArray(x) && x.length <= LECTORES_FLUJO.length && x.every((c) => typeof c === "string" && CODIGOS_FLUJO.has(c)) ? [...new Set(x as string[])].sort() : null);
  const aFavor = lista(o.aFavor);
  const enContra = lista(o.enContra);
  if (o.v !== 1 || !aFavor || !enContra || typeof o.conDelta !== "boolean") return null;
  return { v: 1, aFavor, enContra, conDelta: o.conDelta };
}

/** La foto del flujo guardada en el JSON de la entrada (junto al consenso y al mapa); null si no tiene o está mal. */
export function fotoFlujoDeJson(foto: string | null | undefined): FotoFlujo | null {
  if (!foto) return null;
  try {
    return validarFotoFlujo((JSON.parse(foto) as { flujo?: unknown }).flujo);
  } catch {
    return null;
  }
}

const NOMBRE_CODIGO = new Map(LECTORES_FLUJO.map((l) => [l.codigo, l.corto.toLowerCase()] as const));
/** La foto del flujo en palabras, para mostrarla. */
export function textosFlujo(f: FotoFlujo): { tono: "bien" | "mal" | "neutro"; texto: string }[] {
  const nombres = (cs: string[]) => cs.map((c) => NOMBRE_CODIGO.get(c) ?? c).join(", ");
  const out: { tono: "bien" | "mal" | "neutro"; texto: string }[] = [];
  if (f.aFavor.length) out.push({ tono: "bien", texto: `flujo a favor: ${nombres(f.aFavor)}` });
  if (f.enContra.length) out.push({ tono: "mal", texto: `flujo en contra: ${nombres(f.enContra)}` });
  if (!f.aFavor.length && !f.enContra.length) out.push({ tono: "neutro", texto: "flujo sin lectura en esas velas" });
  if (!f.conDelta) out.push({ tono: "neutro", texto: "sin volumen agresor (delta desconocido)" });
  return out;
}
