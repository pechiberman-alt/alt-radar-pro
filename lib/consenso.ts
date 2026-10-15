/**
 * El consenso entre agentes: cuántos coincidieron en la misma moneda y la misma vela, y cuántos apuntaron al revés.
 * Es lo más cerca que los agentes pueden estar de «hablarse» sin arruinar la medición: cada uno decide solo, con su regla
 * de siempre, y lo único que pasa es que queda registrado con quiénes coincidió. El consenso NO filtra, NO cambia ninguna
 * regla y NO decide nada: es una foto de condiciones, igual que la del agente ST (lib/agente-st.ts).
 *
 * Por qué así: si un agente mirara a los demás para decidir, su regla dejaría de ser la que se midió y la medición hacia
 * adelante perdería sentido. Guardándolo aparte se puede responder después, con muestra, la pregunta que de verdad importa:
 * ¿las entradas donde muchos coincidieron terminan mejor que las solitarias? Hasta tener esa muestra no se afirma nada.
 * Para que un filtro de consenso llegue a filtrar algo hace falta el camino del laboratorio en sombra, que lo aprueba una
 * persona (docs/mesa-aprendizaje.md). Pura: sin red ni base.
 */
import type { Lado } from "./escalera.ts";

/** Lo mínimo que hace falta de una entrada para cruzarla con las demás. */
export type EntradaConsenso = { estrategia: string; symbol: string; vela: number; lado: Lado };

export type Consenso = {
  /** Cuántos agentes entraron en la misma moneda y vela para el MISMO lado, sin contarse a sí mismo. */
  acuerdo: number;
  /** Cuántos entraron para el lado contrario. */
  contra: number;
  /** Los agentes que coincidieron, ordenados: queda escrito con quién, no solo cuántos. */
  con: string[];
};

/** Debajo de esta cantidad de casos, una comparación entre entradas acompañadas y solitarias no dice nada. */
export const MUESTRA_MINIMA_CONSENSO = 15;

const clave = (e: EntradaConsenso) => `${e.symbol}|${e.vela}`;

/**
 * El consenso de cada entrada de una misma tanda. Cada agente se compara con los demás de la misma moneda y vela; nunca
 * consigo mismo, y una estrategia repetida no se cuenta dos veces.
 */
export function consensoDe(entradas: EntradaConsenso[]): Map<string, Consenso> {
  const porMomento = new Map<string, EntradaConsenso[]>();
  for (const e of entradas) porMomento.set(clave(e), [...(porMomento.get(clave(e)) ?? []), e]);
  const out = new Map<string, Consenso>();
  for (const e of entradas) {
    const otros = (porMomento.get(clave(e)) ?? []).filter((x) => x.estrategia !== e.estrategia);
    const mismos = [...new Set(otros.filter((x) => x.lado === e.lado).map((x) => x.estrategia))].sort();
    const contra = new Set(otros.filter((x) => x.lado !== e.lado).map((x) => x.estrategia)).size;
    out.set(`${e.estrategia}|${clave(e)}`, { acuerdo: mismos.length, contra, con: mismos });
  }
  return out;
}

/** La foto que se guarda con la entrada. Se recorta para no llenar la base con nombres. */
export function fotoConsenso(c: Consenso, maxNombres = 6): { acuerdo: number; contra: number; con: string[] } {
  return { acuerdo: c.acuerdo, contra: c.contra, con: c.con.slice(0, maxNombres) };
}

export type ResultadoConsenso = { acuerdo: number; r: number };

export type Comparacion = {
  acompanadas: { n: number; rMedio: number | null };
  solitarias: { n: number; rMedio: number | null };
  /** La diferencia en R por operación, o null si alguna muestra no alcanza. */
  diferencia: number | null;
  muestraMinima: boolean;
  texto: string;
};

/**
 * Compara las entradas donde al menos `desde` agentes coincidieron contra las que salieron solas. Si cualquiera de los dos
 * grupos no llega a la muestra mínima, no devuelve diferencia: con pocos casos la comparación es ruido. Nunca concluye que
 * el consenso sirve; a lo sumo dice qué se vio y con cuántos casos.
 */
export function compararConsenso(rs: ResultadoConsenso[], desde = 1): Comparacion {
  const medio = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length);
  const acc = rs.filter((x) => x.acuerdo >= desde).map((x) => x.r);
  const sol = rs.filter((x) => x.acuerdo < desde).map((x) => x.r);
  const corta = acc.length < MUESTRA_MINIMA_CONSENSO || sol.length < MUESTRA_MINIMA_CONSENSO;
  const mA = medio(acc);
  const mS = medio(sol);
  const diferencia = corta || mA === null || mS === null ? null : mA - mS;
  const r2 = (x: number | null) => (x === null ? "sin dato" : `${x > 0 ? "+" : ""}${x.toFixed(2).replace(".", ",")} R`);
  const texto = corta
    ? `Todavía no se puede comparar: hacen falta al menos ${MUESTRA_MINIMA_CONSENSO} entradas de cada tipo y hay ${acc.length} acompañadas y ${sol.length} solitarias.`
    : `Acompañadas (${acc.length}): ${r2(mA)} por operación. Solitarias (${sol.length}): ${r2(mS)}. Diferencia: ${r2(diferencia)}. Es lo que se vio hasta acá, no una regla: no filtra nada.`;
  return { acompanadas: { n: acc.length, rMedio: mA }, solitarias: { n: sol.length, rMedio: mS }, diferencia, muestraMinima: corta, texto };
}
