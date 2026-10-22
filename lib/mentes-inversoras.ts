/**
 * Las MENTES: agentes que leen un papel con las reglas públicas de inversores famosos (Buffett, Graham, Lynch, la
 * prédica de crecimiento de Musk, Paul Tudor Jones, Darvas, O'Neil, Templeton y Dalio). Cada mente es una lista fija de
 * criterios con su umbral: dice qué cumple, qué no y qué no se puede saber. Ninguna de esas personas participa, avala ni
 * revisó este software; son lentes inspiradas en lo que publicaron.
 *
 * Las de valor necesitan balances (lib/fundamentales-sec.ts): sin balances dicen SIN DATOS, no inventan. Las técnicas usan
 * solo ruedas cerradas. El consenso cuenta mentes, no es una probabilidad. No es asesoramiento financiero. Pura.
 */
import type { SwingCandle } from "./swing-entries.ts";
import { BPA_NO_COMPARABLE, type Fundamentales } from "./fundamentales-sec.ts";

export type Postura = "A FAVOR" | "NEUTRAL" | "EN CONTRA" | "SIN DATOS" | "INFORMA";

export type Criterio = { nombre: string; regla: string; valor: string; cumple: boolean | null };

export type MenteId = "BUFFETT" | "GRAHAM" | "LYNCH" | "MUSK" | "PTJ" | "DARVAS" | "ONEIL" | "TEMPLETON" | "DALIO";

export type LecturaMente = {
  id: MenteId;
  mente: string;
  /** De qué se inspira, en una línea. */
  idea: string;
  postura: Postura;
  criterios: Criterio[];
  nota: string;
};

export type EntradaMentes = {
  simbolo: string;
  /** Ruedas cerradas del papel (para las mentes técnicas). */
  velas: SwingCandle[];
  /** Moneda de esas ruedas, para decirlo. */
  moneda: string | null;
  /** Último cierre de la acción de afuera en dólares (para el PER de los CEDEARs); null si no hay. */
  precioUsd: number | null;
  fund: Fundamentales | null;
  /** Por qué no hay balances (si no hay). */
  sinFund: string | null;
  /** Percentil (0 a 100) del rendimiento de 6 meses del papel dentro del universo AR; null si no se pudo armar. */
  fuerzaRelativa: number | null;
  /** Si el índice de referencia (Merval para acciones, S&P 500 para CEDEARs) está sobre su media de 200 ruedas. */
  mercadoAlcista: boolean | null;
  mercadoNombre: string;
  /** Mediana de la volatilidad anual del universo (para Dalio); null si no hay. */
  volMediana: number | null;
};

export const AVISO_MENTES =
  "Lentes inspiradas en los principios públicos de cada inversor: ninguno participa, avala ni revisó este software. Cuentan criterios, no dan probabilidades. No es asesoramiento financiero.";

// ── Cuentas sobre las ruedas ──

const pct = (x: number) => `${(x * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`;
const num = (x: number, d = 2) => x.toLocaleString("es-AR", { maximumFractionDigits: d });

export function sma(xs: number[], n: number, hasta = xs.length - 1): number | null {
  if (hasta + 1 < n || hasta < 0) return null;
  let s = 0;
  for (let k = hasta - n + 1; k <= hasta; k += 1) s += xs[k];
  return s / n;
}

/** RSI de Wilder de 14 sobre cierres; null donde no alcanza. */
export function rsiSerie(cierres: number[], n = 14): (number | null)[] {
  const out: (number | null)[] = cierres.map(() => null);
  if (cierres.length <= n) return out;
  let g = 0;
  let p = 0;
  for (let k = 1; k <= n; k += 1) {
    const d = cierres[k] - cierres[k - 1];
    if (d > 0) g += d;
    else p -= d;
  }
  g /= n;
  p /= n;
  out[n] = p === 0 ? 100 : 100 - 100 / (1 + g / p);
  for (let k = n + 1; k < cierres.length; k += 1) {
    const d = cierres[k] - cierres[k - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    p = (p * (n - 1) + Math.max(-d, 0)) / n;
    out[k] = p === 0 ? 100 : 100 - 100 / (1 + g / p);
  }
  return out;
}

/** Volatilidad anual (desvío de los rendimientos diarios × √252) de las últimas `n` ruedas; null con menos de 30. */
export function volatilidadAnual(velas: SwingCandle[], n = 252): number | null {
  const v = velas.slice(-(n + 1));
  if (v.length < 31) return null;
  const r = v.slice(1).map((x, k) => Math.log(x.close / v[k].close));
  const m = r.reduce((s, x) => s + x, 0) / r.length;
  const de = Math.sqrt(r.reduce((s, x) => s + (x - m) ** 2, 0) / (r.length - 1));
  return de * Math.sqrt(252);
}

/** Rendimiento de las últimas `n` ruedas (126 ≈ 6 meses); null si no hay tantas. */
export function rendimiento(velas: SwingCandle[], n = 126): number | null {
  return velas.length > n ? velas.at(-1)!.close / velas[velas.length - 1 - n].close - 1 : null;
}

/** El percentil de cada valor dentro de la lista (0 a 100); los null quedan null. */
export function percentiles(valores: (number | null)[]): (number | null)[] {
  const ok = valores.filter((x): x is number => x !== null).sort((a, b) => a - b);
  return valores.map((x) => {
    if (x === null || ok.length < 2) return null;
    const debajo = ok.filter((y) => y < x).length;
    return (debajo / (ok.length - 1)) * 100;
  });
}

// ── Cuentas sobre los balances ──

export type Metricas = {
  anios: number;
  per: number | null;
  perMotivo: string | null;
  roePromedio: number | null;
  pasivoPatrimonio: number | null;
  /** Deuda financiera de largo plazo sobre patrimonio; null si la empresa no la reporta con esos nombres. */
  deudaPatrimonio: number | null;
  liquidez: number | null;
  /** Crecimiento anual compuesto del BPA y de los ingresos en los ejercicios disponibles. */
  cagrBpa: number | null;
  cagrIngresos: number | null;
  ingresosUltimoAnio: number | null;
  /** Si hubo ganancia en todos los ejercicios; null sin dato. */
  siempreGano: boolean | null;
  caidasBpa: number | null;
  bpaTotal: number | null;
  perPorPvl: number | null;
};

const aniosEntre = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / (365.25 * 86_400_000);
const cagr = (a: number | null, b: number | null, anios: number) => (a !== null && b !== null && a > 0 && b > 0 && anios >= 1 ? (b / a) ** (1 / anios) - 1 : null);

export function metricas(simbolo: string, fund: Fundamentales, precioUsd: number | null): Metricas {
  const e = fund.ejercicios;
  const ult = e.at(-1)!;
  const bpas = e.map((x) => x.bpa).filter((x): x is number => x !== null);
  let per: number | null = null;
  let perMotivo: string | null = null;
  if (BPA_NO_COMPARABLE.has(simbolo)) perMotivo = "el BPA se publica por acción clase A: no se compara con este precio";
  else if (fund.moneda && fund.moneda !== "USD") perMotivo = `las cifras están en ${fund.moneda} (NIIF, ajustadas por inflación a la fecha del balance) y el precio de hoy no se compara con ellas sin ese ajuste: no se calcula`;
  else if (precioUsd === null) perMotivo = "sin un precio en dólares que se pueda comparar con el balance";
  else if (ult.bpa === null) perMotivo = "la empresa no reporta BPA diluido";
  else if (ult.bpa <= 0) perMotivo = "BPA negativo: el PER no tiene sentido";
  else per = precioUsd / ult.bpa;
  const roes = e.filter((x) => x.gananciaNeta !== null && x.patrimonio !== null && x.patrimonio > 0).map((x) => (x.gananciaNeta as number) / (x.patrimonio as number));
  const conBpa = e.filter((x) => x.bpa !== null);
  const conIng = e.filter((x) => x.ingresos !== null);
  const ganancias = e.map((x) => x.gananciaNeta).filter((x): x is number => x !== null);
  let caidas: number | null = null;
  if (bpas.length >= 2) {
    caidas = 0;
    for (let k = 1; k < bpas.length; k += 1) if (bpas[k] < bpas[k - 1]) caidas += 1;
  }
  // Valor libro por acción con las acciones implícitas (ganancia / BPA): sirve igual con varias clases de acciones.
  let perPorPvl: number | null = null;
  if (per !== null && ult.gananciaNeta !== null && ult.bpa !== null && ult.patrimonio !== null && ult.gananciaNeta > 0 && ult.patrimonio > 0) {
    const acciones = ult.gananciaNeta / ult.bpa;
    const vlpa = ult.patrimonio / acciones;
    if (vlpa > 0 && precioUsd !== null) perPorPvl = per * (precioUsd / vlpa);
  }
  const ingPrev = e.length >= 2 ? e[e.length - 2].ingresos : null;
  return {
    anios: e.length,
    per,
    perMotivo,
    roePromedio: roes.length >= 3 ? roes.reduce((s, x) => s + x, 0) / roes.length : null,
    pasivoPatrimonio: ult.pasivo !== null && ult.patrimonio !== null && ult.patrimonio > 0 ? ult.pasivo / ult.patrimonio : null,
    deudaPatrimonio: ult.deuda !== null && ult.patrimonio !== null && ult.patrimonio > 0 ? ult.deuda / ult.patrimonio : null,
    liquidez: ult.activoCorriente !== null && ult.pasivoCorriente !== null && ult.pasivoCorriente > 0 ? ult.activoCorriente / ult.pasivoCorriente : null,
    cagrBpa: conBpa.length >= 3 ? cagr(conBpa[0].bpa, conBpa.at(-1)!.bpa, aniosEntre(conBpa[0].fin, conBpa.at(-1)!.fin)) : null,
    cagrIngresos: conIng.length >= 3 ? cagr(conIng[0].ingresos, conIng.at(-1)!.ingresos, aniosEntre(conIng[0].fin, conIng.at(-1)!.fin)) : null,
    ingresosUltimoAnio: ult.ingresos !== null && ingPrev !== null && ingPrev > 0 ? ult.ingresos / ingPrev - 1 : null,
    siempreGano: ganancias.length >= 3 ? ganancias.every((g) => g > 0) : null,
    caidasBpa: caidas,
    bpaTotal: bpas.length >= 3 && bpas[0] > 0 ? bpas.at(-1)! / bpas[0] - 1 : null,
    perPorPvl,
  };
}

// ── La postura ──

const crit = (nombre: string, regla: string, valor: number | null, fmt: (x: number) => string, cumple: (x: number) => boolean, faltante = "sin dato"): Criterio =>
  valor === null ? { nombre, regla, valor: faltante, cumple: null } : { nombre, regla, valor: fmt(valor), cumple: cumple(valor) };

/** Con al menos `minimo` criterios conocidos: todos cumplen → A FAVOR; la mitad o más no → EN CONTRA; si no, NEUTRAL. */
export function posturaDe(criterios: Criterio[], minimo: number): Postura {
  const conocidos = criterios.filter((c) => c.cumple !== null);
  if (conocidos.length < minimo) return "SIN DATOS";
  const fallan = conocidos.filter((c) => c.cumple === false).length;
  if (fallan === 0) return "A FAVOR";
  if (fallan * 2 >= conocidos.length) return "EN CONTRA";
  return "NEUTRAL";
}

function mentesDeValor(x: EntradaMentes): LecturaMente[] {
  const sinBal = x.sinFund ?? "sin balances para este papel";
  const m = x.fund ? metricas(x.simbolo, x.fund, x.precioUsd) : null;
  const notaBal = x.fund ? `Balances: ${x.fund.fuente}, ${m!.anios} ejercicios hasta ${x.fund.ejercicios.at(-1)!.fin}. ${x.fund.moneda && x.fund.moneda !== "USD" ? `Cifras en ${x.fund.moneda}: miro calidad, deuda y crecimiento; el precio no se compara.` : "Precio: la acción de afuera en dólares."}` : `Sin balances: ${sinBal}.`;
  const perCrit = (umbral: number) =>
    crit(`PER ≤ ${umbral}`, "precio sobre ganancia por acción del último ejercicio", m?.per ?? null, (v) => num(v, 1), (v) => v <= umbral, m?.perMotivo ?? "sin dato");

  const buffett: Criterio[] = m
    ? [
        crit("Rentabilidad alta y estable", "ROE promedio de los ejercicios ≥ 15 %", m.roePromedio, pct, (v) => v >= 0.15),
        crit("Poca deuda", "deuda financiera de largo plazo ≤ 0,5 veces el patrimonio (no todo el pasivo: los anticipos de clientes o los depósitos de un banco no son deuda que hay que refinanciar)", m.deudaPatrimonio, (v) => `${num(v)} veces`, (v) => v <= 0.5, "la empresa no reporta deuda de largo plazo con ese nombre"),
        crit("Ganancias que crecen", "BPA del último ejercicio mayor que el del primero, con a lo sumo una caída", m.caidasBpa === null || m.bpaTotal === null ? null : m.bpaTotal, pct, (v) => v > 0 && (m.caidasBpa ?? 9) <= 1),
        perCrit(25),
      ]
    : [];
  const graham: Criterio[] = m
    ? [
        perCrit(15),
        crit("PER × precio/valor libro ≤ 22,5", "el número de Graham", m.perPorPvl, (v) => num(v, 1), (v) => v <= 22.5),
        crit("Liquidez corriente ≥ 2", "activo corriente sobre pasivo corriente", m.liquidez, (v) => `${num(v)} veces`, (v) => v >= 2, "la empresa no reporta activo y pasivo corriente (bancos y aseguradoras)"),
        crit("Ganó todos los años", "ganancia neta positiva en cada ejercicio disponible", m.siempreGano === null ? null : m.siempreGano ? 1 : 0, (v) => (v ? "sí" : "no"), (v) => v === 1),
        crit("BPA creció ≥ 33 %", "del primer al último ejercicio disponible (Graham pedía 10 años; acá hay menos)", m.bpaTotal, pct, (v) => v >= 0.33),
      ]
    : [];
  const peg = m && m.per !== null && m.cagrBpa !== null && m.cagrBpa > 0 ? m.per / (m.cagrBpa * 100) : null;
  const lynch: Criterio[] = m
    ? [
        crit("PEG ≤ 1", "PER dividido el crecimiento anual del BPA en %", peg, (v) => num(v), (v) => v <= 1, m.cagrBpa !== null && m.cagrBpa <= 0 ? "el BPA no creció: el PEG no aplica" : (m.perMotivo ?? "sin dato")),
        crit("Crece ≥ 10 % por año", "crecimiento anual compuesto del BPA", m.cagrBpa, pct, (v) => v >= 0.1),
      ]
    : [];
  const musk: Criterio[] = m
    ? [
        crit("Ingresos crecen ≥ 20 % por año", "crecimiento anual compuesto de los ingresos", m.cagrIngresos, pct, (v) => v >= 0.2),
        crit("Último año ≥ 15 %", "ingresos del último ejercicio contra el anterior", m.ingresosUltimoAnio, pct, (v) => v >= 0.15),
      ]
    : [];
  return [
    { id: "BUFFETT", mente: "Warren Buffett", idea: "empresas de calidad, con poca deuda, a un precio razonable", postura: posturaDe(buffett, 3), criterios: buffett, nota: `${notaBal} El «foso» competitivo no se mide con números: queda afuera.` },
    { id: "GRAHAM", mente: "Benjamin Graham", idea: "el inversor defensivo: barato, sólido y con historia de ganancias", postura: posturaDe(graham, 3), criterios: graham, nota: notaBal },
    { id: "LYNCH", mente: "Peter Lynch", idea: "crecimiento a un precio que no lo descuente todo (PEG)", postura: posturaDe(lynch, 2), criterios: lynch, nota: notaBal },
    {
      id: "MUSK",
      mente: "Elon Musk (crecimiento disruptivo)",
      idea: "apostar a quien crece rápido e invierte en innovación",
      postura: posturaDe(musk, 2),
      criterios: musk,
      nota: `Musk no publicó un método de inversión: esta lente toma su prédica de crecimiento e innovación. ${notaBal}`,
    },
  ];
}

function mentesTecnicas(x: EntradaMentes): LecturaMente[] {
  const v = x.velas;
  const n = v.length;
  const cierres = v.map((c) => c.close);
  const cierre = n ? cierres[n - 1] : null;
  const moneda = x.moneda ? ` (en ${x.moneda}${x.moneda === "ARS" ? ": incluye la suba del dólar y la inflación" : ""})` : "";

  // Paul Tudor Jones: la media de 200 días.
  const m200 = sma(cierres, 200);
  const m200Antes = sma(cierres, 200, n - 21);
  const ptj = [
    crit("Precio sobre la media de 200", "cierre por encima de la media simple de 200 ruedas", cierre !== null && m200 !== null ? cierre / m200 - 1 : null, pct, (d) => d > 0, `hacen falta 200 ruedas (hay ${n})`),
    crit("La media de 200 sube", "la media de hoy contra la de hace 20 ruedas", m200 !== null && m200Antes !== null ? m200 / m200Antes - 1 : null, pct, (d) => d > 0, `hacen falta 220 ruedas (hay ${n})`),
  ];
  const ptjConocidos = ptj.filter((c) => c.cumple !== null);
  const ptjPostura: Postura = ptjConocidos.length < 2 ? "SIN DATOS" : ptj.every((c) => c.cumple) ? "A FAVOR" : ptj.every((c) => !c.cumple) ? "EN CONTRA" : "NEUTRAL";

  // Darvas y O'Neil: el máximo de 52 semanas.
  const anio = v.slice(-252);
  const max52 = anio.length >= 120 ? Math.max(...anio.map((c) => c.high)) : null;
  const desdeMax = cierre !== null && max52 !== null ? cierre / max52 - 1 : null;
  const vol20 = n > 21 ? v.slice(-21, -1).map((c) => c.volume).sort((a, b) => a - b) : null;
  const medVol = vol20 ? (vol20[9] + vol20[10]) / 2 : null;
  const volRel = medVol && medVol > 0 ? v[n - 1].volume / medVol : null;
  const minCaja = n > 21 ? Math.min(...v.slice(-21, -1).map((c) => c.low)) : null;
  const darvas = [
    crit("En máximos de 52 semanas", "cierre a 3 % o menos del máximo del año", desdeMax, pct, (d) => d >= -0.03, "hacen falta 120 ruedas"),
    crit("Con volumen", "volumen de la última rueda ≥ 1,5 veces la mediana de 20", volRel, (r) => `${num(r)} veces`, (r) => r >= 1.5),
  ];
  const rompioCaja = cierre !== null && minCaja !== null && cierre < minCaja;
  const darvasPostura: Postura = darvas.some((c) => c.cumple === null) ? "SIN DATOS" : darvas.every((c) => c.cumple) ? "A FAVOR" : rompioCaja ? "EN CONTRA" : "NEUTRAL";

  // O'Neil: la parte técnica de CAN SLIM (N, S, L, M) y, si hay balances, la de ganancias (A).
  let acumulacion: number | null = null;
  if (n > 51) {
    let suba = 0;
    let baja = 0;
    for (let k = n - 50; k < n; k += 1) {
      if (v[k].close > v[k - 1].close) suba += v[k].volume;
      else if (v[k].close < v[k - 1].close) baja += v[k].volume;
    }
    acumulacion = baja > 0 ? suba / baja : null;
  }
  const mOneil = x.fund ? metricas(x.simbolo, x.fund, x.precioUsd) : null;
  const oneil = [
    crit("N: cerca del máximo", "cierre a 15 % o menos del máximo de 52 semanas", desdeMax, pct, (d) => d >= -0.15, "hacen falta 120 ruedas"),
    crit("S: se acumula", "en 50 ruedas, más volumen en días de suba que de baja", acumulacion, (r) => `${num(r)} veces`, (r) => r > 1),
    crit("L: líder", "rendimiento de 6 meses en el 30 % de arriba del universo AR", x.fuerzaRelativa, (p) => `percentil ${num(p, 0)}`, (p) => p >= 70, "falta el resto del universo para comparar"),
    crit("M: mercado a favor", `${x.mercadoNombre} sobre su media de 200`, x.mercadoAlcista === null ? null : x.mercadoAlcista ? 1 : 0, (b) => (b ? "sí" : "no"), (b) => b === 1, `sin datos de ${x.mercadoNombre}`),
    crit("A: ganancias que crecen", "BPA anual creciendo ≥ 25 % por año", mOneil?.cagrBpa ?? null, pct, (g) => g >= 0.25, x.fund ? "sin BPA suficiente" : "sin balances"),
  ];

  // Templeton: comprar en el máximo pesimismo (por precio: el pesimismo real no se mide).
  const rsis = rsiSerie(cierres);
  const sobreventaReciente = rsis.slice(-11, -1).some((r) => r !== null && r < 30);
  const rsiHoy = rsis.at(-1) ?? null;
  const templeton = [
    crit("Castigada", "40 % o más debajo del máximo de 52 semanas", desdeMax, pct, (d) => d <= -0.4, "hacen falta 120 ruedas"),
    crit("Sale de la sobreventa", "RSI 14 bajo 30 en las últimas 10 ruedas y hoy por encima", rsiHoy, (r) => num(r, 1), (r) => sobreventaReciente && r > 30),
  ];
  const templetonPostura: Postura =
    templeton.some((c) => c.cumple === null) ? "SIN DATOS" : templeton.every((c) => c.cumple) ? "A FAVOR" : desdeMax !== null && desdeMax > -0.1 ? "EN CONTRA" : "NEUTRAL";

  // Dalio: no elige dirección; mide el riesgo para decidir cuánto pesar.
  const vol = volatilidadAnual(v);
  let picoAcum = 0;
  let caida = 0;
  for (const c of anio) {
    picoAcum = Math.max(picoAcum, c.close);
    caida = Math.min(caida, c.close / picoAcum - 1);
  }
  const dalio = [
    crit("Volatilidad anual", "desvío de los rendimientos diarios, anualizado", vol, pct, () => true, "hacen falta 30 ruedas"),
    crit("Peor caída del año", "de un máximo a un mínimo posterior, al cierre", anio.length >= 120 ? caida : null, pct, () => true, "hacen falta 120 ruedas"),
    crit("Peso relativo", "inverso a la volatilidad, contra la mediana del universo (1 = peso normal)", vol !== null && x.volMediana !== null && vol > 0 ? x.volMediana / vol : null, (p) => `${num(p)} veces`, () => true, "falta el universo para comparar"),
  ];

  return [
    { id: "PTJ", mente: "Paul Tudor Jones", idea: "no pelear con la tendencia: la media de 200 días manda", postura: ptjPostura, criterios: ptj, nota: `Ruedas del papel${moneda}.` },
    { id: "DARVAS", mente: "Nicolas Darvas", idea: "la caja: comprar el máximo nuevo con volumen, salir si rompe la caja", postura: darvasPostura, criterios: darvas, nota: `Ruedas del papel${moneda}.` },
    { id: "ONEIL", mente: "William O'Neil (CAN SLIM)", idea: "líderes cerca de máximos, con acumulación y el mercado a favor", postura: posturaDe(oneil, 3), criterios: oneil, nota: `C (ganancias trimestrales) e I (fondos que compran) no se pueden saber acá: quedan afuera. Ruedas del papel${moneda}.` },
    { id: "TEMPLETON", mente: "John Templeton", idea: "comprar en el máximo pesimismo", postura: templetonPostura, criterios: templeton, nota: "El pesimismo se aproxima por el precio (caída y sobreventa): el humor real del mercado no se mide." },
    { id: "DALIO", mente: "Ray Dalio", idea: "el riesgo primero: pesar cada papel según cuánto se mueve", postura: vol === null ? "SIN DATOS" : "INFORMA", criterios: dalio, nota: "No opina comprar o vender: dice cuánto pesaría el papel en una cartera equilibrada por riesgo." },
  ];
}

export function leerMentes(x: EntradaMentes): LecturaMente[] {
  return [...mentesDeValor(x), ...mentesTecnicas(x)];
}

export type Consenso = { aFavor: number; enContra: number; neutral: number; sinDatos: number; opinan: number };

/** Cuántas mentes opinan y para qué lado (Dalio informa y no cuenta). No es una probabilidad. */
export function consenso(lecturas: LecturaMente[]): Consenso {
  const c: Consenso = { aFavor: 0, enContra: 0, neutral: 0, sinDatos: 0, opinan: 0 };
  for (const l of lecturas) {
    if (l.postura === "INFORMA") continue;
    if (l.postura === "SIN DATOS") c.sinDatos += 1;
    else {
      c.opinan += 1;
      if (l.postura === "A FAVOR") c.aFavor += 1;
      else if (l.postura === "EN CONTRA") c.enContra += 1;
      else c.neutral += 1;
    }
  }
  return c;
}
