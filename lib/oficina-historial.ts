/**
 * El historial de cada agente en la oficina: cómo le fue a su regla en 4 h en el tramo de evaluación de su estudio (el pasado,
 * con costos), para ponerlo al lado de lo que mide en papel. No lo calcula: lo lee de los resultados ya publicados. La tabla
 * general sale de lib/estudio-estrategias-datos.ts (archivo generado); los agentes que se midieron aparte traen sus números de
 * su propio estudio (docs/busqueda-amd.md, docs/busqueda-flujo.md y docs/estudio-axi.md), y una prueba comprueba que coinciden
 * con lo publicado. Es una medición del pasado: no garantiza resultados futuros y no es asesoramiento financiero. Pura.
 */
import { ESTUDIO_FILAS, ESTUDIO_META } from "./estudio-estrategias-datos.ts";

export type Historial = {
  marco: "4h";
  operaciones: number;
  winRate: number | null;
  profitFactor: number | null;
  expectancia: number | null;
  veredicto: string;
  /** De dónde sale, en palabras. */
  fuente: string;
  /** Falso si la regla se eligió mirando esos mismos datos: entonces no es una prueba limpia. */
  limpia: boolean;
};

/** Los agentes medidos aparte, en 4 h y en su tramo de evaluación, copiados de lo publicado (lo comprueba tests/oficina-historial.test.ts). */
export const HISTORIAL_APARTE: Record<string, Omit<Historial, "marco">> = {
  AMD_IFVG: { operaciones: 230, winRate: 0.404, profitFactor: 0.97, expectancia: -0.018, veredicto: "SIN CONCLUSIÓN", fuente: "estudio del agente AMD (docs/busqueda-amd.md), 10 monedas", limpia: true },
  ABSORCION: { operaciones: 537, winRate: 0.354, profitFactor: 0.91, expectancia: -0.058, veredicto: "SIN CONCLUSIÓN", fuente: "estudio de la mesa de flujo (docs/busqueda-flujo.md), 10 monedas", limpia: true },
  ESFUERZO: { operaciones: 1, winRate: 0, profitFactor: 0, expectancia: -1.022, veredicto: "SIN CONCLUSIÓN", fuente: "estudio de la mesa de flujo (docs/busqueda-flujo.md): casi no dispara", limpia: true },
  BARRIDA_VOL: { operaciones: 990, winRate: 0.353, profitFactor: 0.92, expectancia: -0.057, veredicto: "SIN CONCLUSIÓN", fuente: "estudio de la mesa de flujo (docs/busqueda-flujo.md), 10 monedas", limpia: true },
  METALES_D55: { operaciones: 41, winRate: 0.585, profitFactor: 2.28, expectancia: 0.592, veredicto: "SIN CONCLUSIÓN", fuente: "oro de Axi (docs/estudio-axi.md); la regla se eligió mirando esos datos", limpia: false },
};

const FUENTE_GENERAL = `estudio de estrategias, evaluación desde ${ESTUDIO_META.corte}, 10 monedas, con costos`;

/** El historial en 4 h de un agente; null si no tiene medición del pasado (por ejemplo, las reglas de delta). */
export function historialDe(id: string): Historial | null {
  const f = ESTUDIO_FILAS.find((x) => x.estrategia === id && x.marco === "4h");
  if (f) {
    const e = f.evaluacion;
    return { marco: "4h", operaciones: e.operaciones, winRate: e.winRate, profitFactor: e.profitFactor, expectancia: e.expectancia, veredicto: f.veredicto, fuente: FUENTE_GENERAL, limpia: true };
  }
  const a = HISTORIAL_APARTE[id];
  return a ? { marco: "4h", ...a } : null;
}

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)} %`);
const n2 = (v: number | null) => (v === null ? "—" : v.toFixed(2).replace(".", ","));
/** El historial en una línea corta: acierto, PF, muestra y veredicto. */
export function textoHistorial(h: Historial | null): string {
  if (!h) return "sin medición del pasado";
  return `${pct(h.winRate)} · PF ${n2(h.profitFactor)} · n=${h.operaciones}${h.operaciones < 15 ? " (muestra mínima)" : ""} · ${h.veredicto.toLowerCase()}${h.limpia ? "" : " (no es prueba limpia)"}`;
}
