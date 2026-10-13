/**
 * Lo medido de la mesa de JARVIS, con su procedencia: los números que la araña
 * en vivo pone al lado de lo que la app lee hoy. Salen de
 * `medir.ts 1h --estadistica` (reglas v2, 1 h, 10 monedas, comisión 0,05% por
 * lado, 3 períodos sin superponerse) y están escritos en docs/mesa-reglas-v2.md:
 * tests/mesa-medicion.test.ts chequea que coincidan. Son medición del pasado: no
 * garantizan nada, y no son probabilidades de que la mesa gane.
 */

export type IntervaloMedido = { p: number; low: number; high: number };

export type MedicionMesa = {
  fuente: string;
  perfil: string;
  reglas: string;
  monedas: number;
  periodo: string;
  /** Operaciones de los tres períodos largos (la fila «Los 3 períodos largos» de la doc). */
  n: number;
  /** Win rate, IC90. */
  winRate: IntervaloMedido;
  /** Profit factor, IC90 (bootstrap en bloques de operaciones). */
  profitFactor: IntervaloMedido;
  /** Expectativa por operación en R, IC90. */
  expectativaR: IntervaloMedido;
  /** Sharpe por operación, sin anualizar. */
  sharpe: number;
  /** Probabilidad de que el Sharpe verdadero sea mayor que cero (PSR). */
  psr0: number;
  /** Reglas con las que se comparó el Sharpe (la lista de medir.ts; la investigación probó más). */
  reglasProbadas: number;
  /** Probabilidad de que el Sharpe supere el azar de probar esas reglas (DSR). */
  dsr: number;
  /** Lo mismo suponiendo 300 reglas probadas. */
  dsr300: number;
};

export const MEDICION: MedicionMesa = {
  fuente: "docs/mesa-reglas-v2.md, «Estadística profesional»",
  perfil: "1 h",
  reglas: "v2",
  monedas: 10,
  periodo: "2021-01 → 2026-09 (3 períodos largos, sin superponerse)",
  n: 3669,
  winRate: { p: 0.45, low: 0.44, high: 0.47 },
  profitFactor: { p: 1.17, low: 1.05, high: 1.29 },
  expectativaR: { p: 0.086, low: 0.028, high: 0.146 },
  sharpe: 0.066,
  psr0: 1,
  reglasProbadas: 22,
  dsr: 0.999,
  dsr300: 0.998,
};
