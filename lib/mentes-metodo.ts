/**
 * El MÉTODO de cada mente: no solo qué criterios cumple un papel (lib/mentes-inversoras.ts) sino en qué orden se hace las
 * preguntas la persona que inspira la lente, qué la frena de plano, qué le haría cambiar de opinión, cuál es su salida y qué
 * no puede saber esta app. Buffett se pregunta primero si entiende el negocio y si ganó plata todos los años; Graham calcula
 * un valor y exige un colchón; Lynch clasifica la acción antes de juzgarla (rápida, estable, cíclica, lenta, en recuperación)
 * y a cada clase le aplica otra regla; Paul Tudor Jones y Darvas piensan en dónde salen antes de entrar; O'Neil corta a 8 %.
 *
 * Lo que sale es una decisión por mente (COMPRARÍA, ESPERARÍA, NO LO TOCARÍA, AFUERA, FUERA DE MI MÉTODO, SIN DATOS o INFORMA)
 * con sus pasos, su plan si el método tiene uno, y lo que no se pudo medir. «Fuera de mi método» no es «en contra»: un
 * criptoactivo no tiene balances, así que las lentes de valor no tienen con qué calcular y se abstienen en vez de opinar.
 *
 * Son lentes inspiradas en lo que cada uno publicó: ninguno participa, avala ni revisó este software, y ninguna habla como la
 * persona real. Lo que no se puede medir (el foso, la gestión, el humor del mercado, el régimen macro) se dice, no se inventa.
 * No es asesoramiento financiero. Pura: sin red, sin base y sin reloj.
 */
import { leerMentes, metricas, rsiSerie, sma, volatilidadAnual, type EntradaMentes, type LecturaMente, type MenteId } from "./mentes-inversoras.ts";

export type Veredicto = "COMPRARÍA" | "ESPERARÍA" | "NO LO TOCARÍA" | "AFUERA" | "FUERA DE MI MÉTODO" | "SIN DATOS" | "INFORMA";
export type FamiliaMente = "VALOR" | "MOMENTUM" | "CONTRARIA" | "CRECIMIENTO" | "RIESGO";
export type TipoActivo = "ACCION" | "CRIPTO";

export type Paso = {
  pregunta: string;
  hallazgo: string;
  /** INFO: describe sin juzgar. NO SE: la pregunta existe pero esta app no la puede responder. */
  resultado: "PASA" | "FRENA" | "NO SE" | "INFO";
  /** Si frena, este paso corta el análisis (el método no sigue). */
  corta: boolean;
};

export type PlanMente = {
  /** Precio de entrada que usaría su método (puede ser un precio a esperar); null si no define uno. */
  entrada: number | null;
  stop: number | null;
  objetivo: number | null;
  /** Distancia de la entrada al stop como fracción de la entrada; null sin stop. */
  riesgo: number | null;
  /** Cómo sale, en palabras de su método. */
  salida: string;
  /** Cuánto de la cuenta compraría si arriesga 1 % (la regla de la app); null sin stop. */
  tamano: string | null;
};

export type Razonamiento = {
  id: MenteId;
  mente: string;
  familia: FamiliaMente;
  /** La clase en la que su método ubica al papel (Lynch); null si no clasifica. */
  clase: string | null;
  pasos: Paso[];
  veredicto: Veredicto;
  /** La razón de la decisión, en una frase con sus números. */
  porQue: string;
  plan: PlanMente | null;
  /** Qué tendría que pasar para que cambie de decisión. */
  cambiaria: string[];
  /** Lo que su método necesita y esta app no puede medir. */
  noSabe: string[];
};

export const FAMILIA: Record<MenteId, FamiliaMente> = {
  BUFFETT: "VALOR",
  GRAHAM: "VALOR",
  LYNCH: "VALOR",
  MUSK: "CRECIMIENTO",
  PTJ: "MOMENTUM",
  DARVAS: "MOMENTUM",
  ONEIL: "MOMENTUM",
  TEMPLETON: "CONTRARIA",
  DALIO: "RIESGO",
};

// ── Formato (coma decimal) ──

const num = (x: number, d = 2) => x.toLocaleString("es-AR", { maximumFractionDigits: d });
const pct = (x: number, d = 1) => `${(x * 100).toLocaleString("es-AR", { maximumFractionDigits: d })} %`;
const usd = (x: number) => `US$ ${num(x)}`;

const paso = (pregunta: string, hallazgo: string, ok: boolean | null, corta = false): Paso => ({
  pregunta,
  hallazgo,
  resultado: ok === null ? "NO SE" : ok ? "PASA" : "FRENA",
  corta: ok === false && corta,
});
const info = (pregunta: string, hallazgo: string): Paso => ({ pregunta, hallazgo, resultado: "INFO", corta: false });

/** Con 1 % de la cuenta en riesgo, qué parte de la cuenta se compra: 1 % / distancia al stop (tope 100 %). */
export function tamanoPorRiesgo(riesgo: number | null): string | null {
  if (riesgo === null || !(riesgo > 0)) return null;
  const parte = Math.min(1, 0.01 / riesgo);
  return `si arriesgás 1 % de tu cuenta, comprás ${pct(parte)} de la cuenta (1 % ÷ ${pct(riesgo)} hasta el stop)`;
}

function planCon(entrada: number | null, stop: number | null, objetivo: number | null, salida: string): PlanMente {
  const riesgo = entrada !== null && stop !== null && entrada > 0 && stop < entrada ? (entrada - stop) / entrada : null;
  return { entrada, stop, objetivo, riesgo, salida, tamano: tamanoPorRiesgo(riesgo) };
}

// ── Lo que todas las lentes técnicas miran ──

type Tec = {
  n: number;
  cierre: number | null;
  max52: number | null;
  desdeMax: number | null;
  m200: number | null;
  m200Antes: number | null;
  volRel: number | null;
  cajaTecho: number | null;
  cajaPiso: number | null;
};

function tecnica(x: EntradaMentes): Tec {
  const v = x.velas;
  const n = v.length;
  const cierres = v.map((c) => c.close);
  const cierre = n ? cierres[n - 1] : null;
  const anio = v.slice(-252);
  const max52 = anio.length >= 120 ? Math.max(...anio.map((c) => c.high)) : null;
  const vol20 = n > 21 ? v.slice(-21, -1).map((c) => c.volume).sort((a, b) => a - b) : null;
  const med = vol20 ? (vol20[9] + vol20[10]) / 2 : null;
  const caja = n > 21 ? v.slice(-21, -1) : null;
  return {
    n,
    cierre,
    max52,
    desdeMax: cierre !== null && max52 !== null ? cierre / max52 - 1 : null,
    m200: sma(cierres, 200),
    m200Antes: sma(cierres, 200, n - 21),
    volRel: med && med > 0 ? v[n - 1].volume / med : null,
    cajaTecho: caja ? Math.max(...caja.map((c) => c.high)) : null,
    cajaPiso: caja ? Math.min(...caja.map((c) => c.low)) : null,
  };
}

const lectura = (ls: LecturaMente[], id: MenteId) => ls.find((l) => l.id === id)!;

function fueraDeMetodo(id: MenteId, mente: string, motivo: string, noSabe: string[]): Razonamiento {
  return { id, mente, familia: FAMILIA[id], clase: null, pasos: [], veredicto: "FUERA DE MI MÉTODO", porQue: motivo, plan: null, cambiaria: ["Nada de lo que cambie en el precio: el método necesita datos que este activo no tiene."], noSabe };
}

/** Si las cifras del balance se pueden comparar con el precio: están en dólares (lo de antes no decía la moneda). En pesos NIIF, no. */
const comparableConPrecio = (x: EntradaMentes) => !x.fund?.moneda || x.fund.moneda === "USD";

function sinBalances(id: MenteId, mente: string, x: EntradaMentes): Razonamiento {
  const motivo = x.sinFund ?? "sin balances para este papel";
  return { id, mente, familia: FAMILIA[id], clase: null, pasos: [], veredicto: "SIN DATOS", porQue: `No puedo ni empezar: ${motivo}.`, plan: null, cambiaria: ["Que haya balances anuales del papel."], noSabe: ["los balances de la empresa"] };
}

const TEXTO_CRIPTO_VALOR = "Un criptoactivo no tiene balances, ganancias ni deuda: no hay con qué calcular un valor, así que este método no aplica. No es lo mismo que estar en contra.";

// ── Las mentes de valor ──

function buffett(x: EntradaMentes, tipo: TipoActivo): Razonamiento {
  const id = "BUFFETT";
  const mente = "Warren Buffett";
  if (tipo === "CRIPTO") return fueraDeMetodo(id, mente, TEXTO_CRIPTO_VALOR, ["el flujo de caja de un negocio", "la calidad de la gestión"]);
  if (!x.fund) return sinBalances(id, mente, x);
  const m = metricas(x.simbolo, x.fund, x.precioUsd);
  const ult = x.fund.ejercicios.at(-1)!;
  const pasos: Paso[] = [
    paso("¿Entiendo el negocio y por qué le va a ir bien en diez años?", "Eso no se mide con números: lo tenés que responder vos antes de comprar.", null),
    paso("¿Ganó plata todos los años? (primera regla: no perder)", m.siempreGano === null ? "faltan ejercicios" : m.siempreGano ? `sí, en los ${m.anios} ejercicios` : "hubo al menos un año con pérdida", m.siempreGano, true),
    paso("¿Rinde mucho sobre lo que invierte, sin apalancarse?", m.roePromedio === null ? "sin ROE suficiente" : `ROE promedio ${pct(m.roePromedio)} (pide ≥ 15 %)`, m.roePromedio === null ? null : m.roePromedio >= 0.15),
    paso("¿Tiene poca deuda?", m.deudaPatrimonio === null ? "la empresa no reporta deuda de largo plazo con ese nombre" : `deuda de largo plazo ${num(m.deudaPatrimonio)} veces el patrimonio (pide ≤ 0,5)`, m.deudaPatrimonio === null ? null : m.deudaPatrimonio <= 0.5),
    paso("¿Las ganancias por acción crecen sin sobresaltos?", m.bpaTotal === null || m.caidasBpa === null ? "sin BPA suficiente" : `BPA ${pct(m.bpaTotal)} en el período, ${m.caidasBpa} ${m.caidasBpa === 1 ? "caída" : "caídas"}`, m.bpaTotal === null || m.caidasBpa === null ? null : m.bpaTotal > 0 && m.caidasBpa <= 1),
    paso("¿El precio es razonable para lo que es?", m.per === null ? (m.perMotivo ?? "sin PER") : `PER ${num(m.per, 1)} (pide ≤ 25)`, m.per === null ? null : m.per <= 25),
  ];
  const calidad = pasos.slice(1, 5);
  const corta = pasos.some((p) => p.corta);
  const frena = calidad.some((p) => p.resultado === "FRENA");
  const noSe = calidad.filter((p) => p.resultado === "NO SE").length;
  const bpa = ult.bpa;
  const objetivo = comparableConPrecio(x) && bpa !== null && bpa > 0 ? 25 * bpa : null;
  let veredicto: Veredicto;
  let porQue: string;
  if (corta) {
    veredicto = "NO LO TOCARÍA";
    porQue = "Hubo años con pérdida: para este método, una empresa que pierde plata en su historia no entra, aunque hoy esté barata.";
  } else if (frena) {
    veredicto = "NO LO TOCARÍA";
    porQue = `No pasa la calidad: ${calidad.filter((p) => p.resultado === "FRENA").map((p) => p.hallazgo).join("; ")}.`;
  } else if (noSe >= 2) {
    veredicto = "SIN DATOS";
    porQue = "Faltan datos para juzgar la calidad (no la invento).";
  } else if (m.per !== null && m.per <= 25) {
    veredicto = "COMPRARÍA";
    porQue = `Calidad sin fallas y un precio razonable (PER ${num(m.per, 1)}), siempre que vos entiendas el negocio.`;
  } else {
    veredicto = "ESPERARÍA";
    porQue = m.per === null ? `La calidad pasa pero no puedo ver si el precio es razonable: ${m.perMotivo}.` : `La calidad pasa, pero el precio no: PER ${num(m.per, 1)}. Mejor una empresa buena a un precio justo que esperar un milagro; esperaría que baje.`;
  }
  return {
    id,
    mente,
    familia: FAMILIA[id],
    clase: null,
    pasos,
    veredicto,
    porQue,
    plan: veredicto === "COMPRARÍA" || veredicto === "ESPERARÍA" ? planCon(objetivo, null, null, "No pone stop por precio: vende si el negocio se deteriora (la tesis se rompe), no porque la cotización baje. Si querés operarlo con stop, usá el plan de Fibonacci.") : null,
    cambiaria: [
      "Un año con pérdida lo saca del análisis.",
      m.per !== null && m.per > 25 && objetivo !== null ? `Si el precio baja a ${usd(objetivo)} (PER 25), pasa de esperar a comprar.` : "Si el PER sube de 25, pasa de comprar a esperar.",
    ],
    noSabe: ["el foso competitivo (la ventaja que protege las ganancias)", "la calidad y honestidad de la gestión", "si es un negocio que vos entendés"],
  };
}

/** Acciones implícitas = ganancia / BPA; sirve igual con varias clases de acciones. */
function accionesImplicitas(x: EntradaMentes): number | null {
  const e = x.fund?.ejercicios.at(-1);
  if (!e || e.gananciaNeta === null || e.bpa === null || e.gananciaNeta <= 0 || e.bpa <= 0) return null;
  return e.gananciaNeta / e.bpa;
}

function graham(x: EntradaMentes, tipo: TipoActivo): Razonamiento {
  const id = "GRAHAM";
  const mente = "Benjamin Graham";
  if (tipo === "CRIPTO") return fueraDeMetodo(id, mente, TEXTO_CRIPTO_VALOR, ["el valor de los activos de la empresa"]);
  if (!x.fund) return sinBalances(id, mente, x);
  const m = metricas(x.simbolo, x.fund, x.precioUsd);
  const e = x.fund.ejercicios.at(-1)!;
  const acciones = accionesImplicitas(x);
  const bpa = e.bpa;
  const vlpa = acciones !== null && e.patrimonio !== null && e.patrimonio > 0 ? e.patrimonio / acciones : null;
  const valor = comparableConPrecio(x) && bpa !== null && bpa > 0 && vlpa !== null ? Math.sqrt(22.5 * bpa * vlpa) : null;
  const precio = x.precioUsd;
  const margen = valor !== null && precio !== null && valor > 0 ? 1 - precio / valor : null;
  const ncav = comparableConPrecio(x) && acciones !== null && e.activoCorriente !== null && e.pasivo !== null ? (e.activoCorriente - e.pasivo) / acciones : null;
  const pasos: Paso[] = [
    paso("¿Ganó plata todos los años? (el defensivo no compra pérdidas)", m.siempreGano === null ? "faltan ejercicios" : m.siempreGano ? `sí, en los ${m.anios} ejercicios` : "hubo al menos un año con pérdida", m.siempreGano, true),
    paso("¿Es una empresa sólida (activo corriente ≥ 2 veces el pasivo corriente)?", m.liquidez === null ? "la empresa no reporta esas cuentas (bancos y aseguradoras)" : `${num(m.liquidez)} veces`, m.liquidez === null ? null : m.liquidez >= 2),
    info("¿Cuánto vale según mis números? (√(22,5 × BPA × valor libro por acción))", valor === null ? "no se puede calcular: falta BPA o patrimonio positivo" : `${usd(valor)} por acción`),
    paso("¿Pago menos que ese valor?", valor === null || precio === null ? "sin precio o sin valor" : `precio ${usd(precio)} contra valor ${usd(valor)}`, valor === null || precio === null ? null : precio <= valor),
    paso("¿Hay colchón de seguridad (precio ≤ 2/3 del valor)?", margen === null ? "sin dato" : `colchón de ${pct(margen)} (pide ≥ 33,3 %)`, margen === null ? null : margen >= 1 / 3),
    info("¿Es una empresa de «net-net» (activo corriente menos todo el pasivo, por acción)?", ncav === null || precio === null ? "sin dato" : `${usd(ncav)} por acción; ${precio <= (2 / 3) * ncav ? "el precio está bajo 2/3 de eso" : "el precio está por encima de 2/3 de eso"}`),
  ];
  const entrada = valor !== null ? (2 / 3) * valor : null;
  let veredicto: Veredicto;
  let porQue: string;
  if (pasos[0].corta) {
    veredicto = "NO LO TOCARÍA";
    porQue = "Perdió plata algún año: el inversor defensivo no compra eso.";
  } else if (valor === null || precio === null || margen === null) {
    veredicto = "SIN DATOS";
    porQue = comparableConPrecio(x) ? "No puedo calcular el valor sin BPA positivo, patrimonio y el precio de la acción de afuera." : `No calculo el valor contra el precio: ${m.perMotivo}.`;
  } else if (margen >= 1 / 3) {
    veredicto = "COMPRARÍA";
    porQue = `Paga ${usd(precio)} por algo que vale ${usd(valor)}: colchón de ${pct(margen)}. Ese colchón es el negocio.`;
  } else if (margen >= 0) {
    veredicto = "ESPERARÍA";
    porQue = `Está bajo su valor (${usd(valor)}) pero con un colchón de solo ${pct(margen)}. Compraría bajo ${usd(entrada!)}.`;
  } else {
    veredicto = "NO LO TOCARÍA";
    porQue = `Hoy se paga ${pct(-margen)} más que su valor (${usd(valor)}): sin colchón no hay inversión, hay apuesta.`;
  }
  return {
    id,
    mente,
    familia: FAMILIA[id],
    clase: null,
    pasos,
    veredicto,
    porQue,
    plan: veredicto === "COMPRARÍA" || veredicto === "ESPERARÍA" ? planCon(entrada, null, valor, "Regla práctica que se le atribuye: vender con unos 50 % de ganancia o a los dos años si no se cumplió. Sin stop por precio: el colchón es la protección.") : null,
    cambiaria: [entrada !== null ? `Si el precio baja a ${usd(entrada)} (2/3 del valor), compra.` : "Que haya BPA positivo y patrimonio para poder calcular el valor.", "Una pérdida anual la saca del análisis."],
    noSabe: ["Graham pedía 10 años de historia (acá hay menos)", "dividendos ininterrumpidos (no se miden acá)"],
  };
}

type ClaseLynch = "RÁPIDA" | "ESTABLE" | "CÍCLICA" | "LENTA" | "EN RECUPERACIÓN";

function lynch(x: EntradaMentes, tipo: TipoActivo): Razonamiento {
  const id = "LYNCH";
  const mente = "Peter Lynch";
  if (tipo === "CRIPTO") return fueraDeMetodo(id, mente, TEXTO_CRIPTO_VALOR, ["la historia en dos minutos del negocio"]);
  if (!x.fund) return sinBalances(id, mente, x);
  const m = metricas(x.simbolo, x.fund, x.precioUsd);
  const e = x.fund.ejercicios.at(-1)!;
  let clase: ClaseLynch | null = null;
  if ((e.bpa !== null && e.bpa <= 0) || (e.gananciaNeta !== null && e.gananciaNeta <= 0)) clase = "EN RECUPERACIÓN";
  else if (m.anios >= 4 && m.caidasBpa !== null && m.caidasBpa >= 2) clase = "CÍCLICA";
  else if (m.cagrBpa !== null) clase = m.cagrBpa < 0.05 ? "LENTA" : m.cagrBpa < 0.15 ? "ESTABLE" : "RÁPIDA";
  const peg = m.per !== null && m.cagrBpa !== null && m.cagrBpa > 0 ? m.per / (m.cagrBpa * 100) : null;
  const pasos: Paso[] = [
    info("¿Qué clase de acción es? (rápida, estable, cíclica, lenta o en recuperación)", clase === null ? "no alcanzan los ejercicios para clasificar" : `${clase}${m.cagrBpa !== null ? `, BPA ${pct(m.cagrBpa)} por año` : ""}${m.caidasBpa !== null ? `, ${m.caidasBpa} caídas de BPA` : ""}`),
    paso("¿Puedo contar en dos minutos por qué esta empresa va a ganar más?", "La historia no se mide: la tenés que poder contar vos.", null),
  ];
  let veredicto: Veredicto;
  let porQue: string;
  let salida: string;
  const entradaPeg = comparableConPrecio(x) && e.bpa !== null && e.bpa > 0 && m.cagrBpa !== null && m.cagrBpa > 0 ? e.bpa * m.cagrBpa * 100 : null;
  if (clase === null) {
    veredicto = "SIN DATOS";
    porQue = "Sin tres ejercicios de BPA no puedo ni clasificarla, y sin clase no hay regla.";
    salida = "—";
  } else if (clase === "CÍCLICA") {
    pasos.push(info("Regla de las cíclicas: el PER bajo es la alarma, no la oferta", m.per === null ? (m.perMotivo ?? "sin PER") : `PER ${num(m.per, 1)}: ${m.per < 10 ? "bajo, cuando las ganancias están en el techo del ciclo" : "alto o medio"}`));
    veredicto = "ESPERARÍA";
    porQue = "Sus ganancias suben y bajan con el ciclo: un PER bajo suele ser el techo del ciclo, no una ganga. Compra cuando el PER está alto (ganancias deprimidas) y empiezan a subir.";
    salida = "Vende cuando el PER es bajo y las ganancias ya subieron; no usa PEG con las cíclicas.";
  } else if (clase === "LENTA") {
    veredicto = "NO LO TOCARÍA";
    porQue = "Crece menos de 5 % por año: sin una razón de crecimiento, la compra sería por dividendo, y acá no se mide el dividendo.";
    salida = "—";
  } else if (clase === "EN RECUPERACIÓN") {
    pasos.push(paso("¿La deuda no la ahoga mientras se recupera?", m.deudaPatrimonio === null ? "no reporta deuda de largo plazo con ese nombre" : `deuda ${num(m.deudaPatrimonio)} veces el patrimonio`, m.deudaPatrimonio === null ? null : m.deudaPatrimonio <= 1));
    veredicto = "ESPERARÍA";
    porQue = "Hoy no gana plata: es una apuesta a la recuperación. Esperaría ver que la ganancia vuelva y que la deuda no la ahogue antes de pagar nada.";
    salida = "Vende cuando la recuperación ya está en el precio o si la deuda empeora.";
  } else {
    pasos.push(paso("¿El precio acompaña el crecimiento? (PEG = PER ÷ crecimiento anual en %)", peg === null ? (m.perMotivo ?? "sin PEG") : `PEG ${num(peg)} (pide ≤ 1)`, peg === null ? null : peg <= 1));
    pasos.push(paso("¿La deuda es manejable?", m.deudaPatrimonio === null ? "no reporta deuda de largo plazo con ese nombre" : `${num(m.deudaPatrimonio)} veces el patrimonio (pide ≤ 0,5)`, m.deudaPatrimonio === null ? null : m.deudaPatrimonio <= 0.5));
    salida = clase === "RÁPIDA" ? "Vende cuando el PEG pasa de 2 o cuando el crecimiento se frena; una rápida no se vende por subir." : "Es de las que se compran para ganar 30 a 50 % y rotar: vende cerca de ahí o si el PEG pasa de 2.";
    if (peg === null) {
      veredicto = "SIN DATOS";
      porQue = m.perMotivo ? `No puedo calcular el PEG: ${m.perMotivo}.` : "No puedo calcular el PEG.";
    } else if (peg <= 1) {
      veredicto = "COMPRARÍA";
      porQue = `Es ${clase === "RÁPIDA" ? "una rápida" : "una estable"} (BPA ${pct(m.cagrBpa!)} por año) con PEG ${num(peg)}: el precio no descuenta todo el crecimiento.`;
    } else if (peg <= 2) {
      veredicto = "ESPERARÍA";
      porQue = `Buena empresa de crecimiento, pero con PEG ${num(peg)} ya cuesta más que lo que crece. Compraría con PEG 1: ${entradaPeg !== null ? usd(entradaPeg) : "—"}.`;
    } else {
      veredicto = "NO LO TOCARÍA";
      porQue = `PEG ${num(peg)}: paga el crecimiento al doble o más. Eso no es una ganga.`;
    }
  }
  return {
    id,
    mente,
    familia: FAMILIA[id],
    clase,
    pasos,
    veredicto,
    porQue,
    plan: veredicto === "COMPRARÍA" || veredicto === "ESPERARÍA" ? planCon(clase === "RÁPIDA" || clase === "ESTABLE" ? entradaPeg : null, null, null, salida) : null,
    cambiaria: [entradaPeg !== null && (clase === "RÁPIDA" || clase === "ESTABLE") ? `Si el precio baja a ${usd(entradaPeg)} (PEG 1), compra.` : "Que cambie de clase: una cíclica en pleno ciclo bajo, o una lenta que acelere.", "Si el crecimiento del BPA se frena, baja de clase y cambia la regla."],
    noSabe: ["la historia en dos minutos", "dividendos", "si los directivos compran acciones de su propia empresa"],
  };
}

function musk(x: EntradaMentes, tipo: TipoActivo): Razonamiento {
  const id = "MUSK";
  const mente = "Elon Musk (crecimiento disruptivo)";
  if (tipo === "CRIPTO") return fueraDeMetodo(id, mente, "Esta lente mide crecimiento de ingresos de una empresa; un criptoactivo no tiene ingresos que medir.", ["ingresos", "inversión en I+D"]);
  if (!x.fund) return sinBalances(id, mente, x);
  const m = metricas(x.simbolo, x.fund, x.precioUsd);
  const pasos: Paso[] = [
    paso("¿Crece rápido? (ingresos ≥ 20 % por año)", m.cagrIngresos === null ? "sin ingresos suficientes" : `${pct(m.cagrIngresos)} por año`, m.cagrIngresos === null ? null : m.cagrIngresos >= 0.2),
    paso("¿Sigue acelerando? (último año ≥ 15 %)", m.ingresosUltimoAnio === null ? "sin dato" : `${pct(m.ingresosUltimoAnio)} el último año`, m.ingresosUltimoAnio === null ? null : m.ingresosUltimoAnio >= 0.15),
    info("¿Le importa el PER o la ganancia de hoy?", "No: esta lente acepta perder plata hoy si el negocio crece y reinvierte."),
    paso("¿Invierte en innovación y tiene una ventaja tecnológica?", "No se mide con los balances que hay acá.", null),
  ];
  const cuenta = pasos.slice(0, 2);
  const ok = cuenta.filter((p) => p.resultado === "PASA").length;
  const sinDato = cuenta.filter((p) => p.resultado === "NO SE").length;
  let veredicto: Veredicto;
  let porQue: string;
  if (sinDato === 2) {
    veredicto = "SIN DATOS";
    porQue = "Sin ingresos suficientes no puedo medir el crecimiento.";
  } else if (ok === 2) {
    veredicto = "COMPRARÍA";
    porQue = `Crece ${pct(m.cagrIngresos!)} por año y el último año ${pct(m.ingresosUltimoAnio!)}: la lente de crecimiento la deja entrar.`;
  } else if (ok === 1) {
    veredicto = "ESPERARÍA";
    porQue = "Crece, pero no acelera (o al revés): esperaría ver dos años seguidos de crecimiento.";
  } else {
    veredicto = "NO LO TOCARÍA";
    porQue = "No crece al ritmo que pide esta lente.";
  }
  return {
    id,
    mente,
    familia: FAMILIA[id],
    clase: null,
    pasos,
    veredicto,
    porQue: `${porQue} (Es una lente de crecimiento, no un método de inversión publicado.)`,
    plan: veredicto === "COMPRARÍA" ? planCon(null, null, null, "No tiene una regla de salida publicada: usá el plan de Fibonacci o un stop por ATR.") : null,
    cambiaria: ["Si los ingresos dejan de crecer 20 % por año, sale de la lente.", "Un año de crecimiento bajo 15 % la frena."],
    noSabe: ["la inversión en I+D", "la ventaja tecnológica", "la capacidad de ejecución del equipo"],
  };
}

// ── Las mentes de precio ──

function ptj(x: EntradaMentes, l: LecturaMente): Razonamiento {
  const id = "PTJ";
  const mente = "Paul Tudor Jones";
  const t = tecnica(x);
  const riesgo = t.cierre !== null && t.m200 !== null && t.m200 < t.cierre ? 1 - t.m200 / t.cierre : null;
  const sube = t.m200 !== null && t.m200Antes !== null ? t.m200 > t.m200Antes : null;
  const falta = t.max52 !== null && t.cierre !== null ? t.max52 / t.cierre - 1 : null;
  const pasos: Paso[] = [
    paso("¿Está por encima de la media de 200 ruedas?", t.cierre === null || t.m200 === null ? `hacen falta 200 ruedas (hay ${t.n})` : `cierre ${pct(t.cierre / t.m200 - 1)} ${t.cierre >= t.m200 ? "sobre" : "bajo"} la media`, t.cierre === null || t.m200 === null ? null : t.cierre > t.m200),
    paso("¿La media de 200 sube?", sube === null ? "hacen falta 220 ruedas" : sube ? "sube" : "baja", sube),
    info("¿Dónde me equivoco? (mi stop es la media de 200)", riesgo === null ? "sin stop: el precio ya está bajo la media o no hay media" : `${pct(riesgo)} debajo del cierre`),
    paso("¿Entra 5 a 1? (busca ganar cinco veces lo que arriesga)", riesgo === null || falta === null ? "sin stop o sin máximo del año" : t.desdeMax !== null && t.desdeMax >= -0.01 ? "está en máximos: sin techo previo para medir el 5 a 1" : `necesita subir ${pct(5 * riesgo)}; hasta el máximo del año faltan ${pct(falta)}`, riesgo === null || falta === null || (t.desdeMax !== null && t.desdeMax >= -0.01) ? null : falta >= 5 * riesgo),
  ];
  let veredicto: Veredicto;
  let porQue: string;
  if (l.postura === "SIN DATOS") {
    veredicto = "SIN DATOS";
    porQue = `Necesito 200 ruedas y hay ${t.n}.`;
  } else if (l.postura === "EN CONTRA") {
    veredicto = "AFUERA";
    porQue = t.cierre !== null && t.m200 !== null && t.cierre < t.m200 ? "Bajo la media de 200 no se opera largo: se sale y se espera. No promedia a la baja." : "La media de 200 baja: no pelea contra la tendencia.";
  } else if (l.postura === "A FAVOR") {
    if (pasos[3].resultado === "FRENA") {
      veredicto = "ESPERARÍA";
      porQue = "La tendencia está a favor, pero con el stop en la media no entra 5 a 1 hasta el máximo del año: esperaría un retroceso que acerque el stop.";
    } else {
      veredicto = "COMPRARÍA";
      porQue = `Tendencia a favor (sobre una media que sube) y el stop queda a ${riesgo !== null ? pct(riesgo) : "—"}.`;
    }
  } else {
    veredicto = "ESPERARÍA";
    porQue = "La tendencia no es clara: sobre la media pero la media no sube, o al revés. No pelea con la tendencia, espera la señal.";
  }
  const plan = veredicto === "COMPRARÍA" || veredicto === "ESPERARÍA" ? planCon(t.cierre, t.m200, riesgo !== null && t.cierre !== null ? t.cierre * (1 + 5 * riesgo) : null, "Sale con un cierre bajo la media de 200. Nunca promedia una pérdida.") : null;
  return {
    id,
    mente,
    familia: FAMILIA[id],
    clase: null,
    pasos,
    veredicto,
    porQue,
    plan,
    cambiaria: ["Un cierre bajo la media de 200 lo saca de golpe.", "Si la media de 200 deja de subir, pasa de comprar a esperar."],
    noSabe: ["el contexto macro y de bancos centrales que él mira", "el humor del mercado"],
  };
}

function darvas(x: EntradaMentes, l: LecturaMente): Razonamiento {
  const id = "DARVAS";
  const mente = "Nicolas Darvas";
  const t = tecnica(x);
  const cercaMax = t.desdeMax !== null && t.desdeMax >= -0.03;
  const rompioArriba = t.cierre !== null && t.cajaTecho !== null && t.cierre > t.cajaTecho;
  const rompioAbajo = t.cierre !== null && t.cajaPiso !== null && t.cierre < t.cajaPiso;
  const pasos: Paso[] = [
    paso("¿Está haciendo máximos nuevos? (él solo compraba lo que sube)", t.desdeMax === null ? "hacen falta 120 ruedas" : `cierre a ${pct(-t.desdeMax)} del máximo de 52 semanas`, t.desdeMax === null ? null : cercaMax),
    info("¿Dónde está la caja? (techo y piso de las últimas 20 ruedas)", t.cajaTecho === null || t.cajaPiso === null ? "sin ruedas" : `techo ${num(t.cajaTecho)}, piso ${num(t.cajaPiso)}`),
    paso("¿Rompió el techo de la caja?", t.cierre === null || t.cajaTecho === null ? "sin ruedas" : rompioArriba ? "sí, cerró arriba" : rompioAbajo ? "no: cerró bajo el piso" : "no: sigue dentro", t.cierre === null || t.cajaTecho === null ? null : rompioArriba),
    paso("¿Con volumen? (≥ 1,5 veces la mediana de 20 ruedas)", t.volRel === null ? "sin volumen" : `${num(t.volRel)} veces`, t.volRel === null ? null : t.volRel >= 1.5),
  ];
  let veredicto: Veredicto;
  let porQue: string;
  if (l.postura === "SIN DATOS" || t.cierre === null || t.cajaTecho === null || t.cajaPiso === null) {
    veredicto = "SIN DATOS";
    porQue = "Hacen falta 120 ruedas para saber si hace máximos.";
  } else if (rompioAbajo) {
    veredicto = "AFUERA";
    porQue = "Cerró bajo el piso de la caja: su método sale. Una caja rota es una tesis rota.";
  } else if (!cercaMax) {
    veredicto = "NO LO TOCARÍA";
    porQue = `Está ${pct(-(t.desdeMax ?? 0))} bajo su máximo: nunca compró algo que no hiciera máximos.`;
  } else if (rompioArriba && (t.volRel ?? 0) >= 1.5) {
    veredicto = "COMPRARÍA";
    porQue = `Rompió el techo de la caja (${num(t.cajaTecho)}) en máximos y con ${num(t.volRel!)} veces el volumen.`;
  } else if (rompioArriba) {
    veredicto = "ESPERARÍA";
    porQue = "Rompió el techo pero sin volumen: sin volumen no confirma.";
  } else {
    veredicto = "ESPERARÍA";
    porQue = `Está en máximos pero dentro de la caja: dejaría una orden de compra sobre el techo (${num(t.cajaTecho)}) y nada más.`;
  }
  const plan = veredicto === "COMPRARÍA" || veredicto === "ESPERARÍA" ? planCon(t.cajaTecho, t.cajaPiso, null, "Sube el stop al piso de cada caja nueva; sale si el precio rompe la caja hacia abajo. No fija un objetivo: deja correr.") : null;
  return {
    id,
    mente,
    familia: FAMILIA[id],
    clase: null,
    pasos,
    veredicto,
    porQue,
    plan,
    cambiaria: ["Un cierre bajo el piso de la caja lo saca.", t.cajaTecho !== null ? `Un cierre sobre ${num(t.cajaTecho)} con volumen lo hace comprar.` : "Que haya 120 ruedas."],
    noSabe: ["la calidad de la empresa (a él no le importaba)", "el volumen intradiario"],
  };
}

function oneil(x: EntradaMentes, l: LecturaMente, tipo: TipoActivo): Razonamiento {
  const id = "ONEIL";
  const mente = "William O'Neil (CAN SLIM)";
  if (tipo === "CRIPTO") return fueraDeMetodo(id, mente, "CAN SLIM exige ganancias trimestrales y anuales que crecen (C y A) y fondos que compran (I): un criptoactivo no las tiene.", ["ganancias", "fondos que compran"]);
  const t = tecnica(x);
  const v = x.velas;
  const previas = v.slice(-253, -1);
  const pivot = previas.length >= 120 ? Math.max(...previas.map((c) => c.high)) : null;
  const pasos: Paso[] = l.criterios.map((c) => ({ pregunta: `${c.nombre}: ${c.regla}`, hallazgo: c.valor, resultado: c.cumple === null ? "NO SE" : c.cumple ? "PASA" : "FRENA", corta: c.nombre.startsWith("M:") && c.cumple === false }) as Paso);
  pasos.push(info("¿Dónde está el punto de compra? (aprox.: el máximo de 52 semanas; no detecta tazas con asa)", pivot === null ? "hacen falta 120 ruedas" : num(pivot)));
  const conocidos = l.criterios.filter((c) => c.cumple !== null);
  const fallan = conocidos.filter((c) => c.cumple === false);
  const vetoM = pasos.some((p) => p.corta);
  let veredicto: Veredicto;
  let porQue: string;
  if (l.postura === "SIN DATOS" || t.cierre === null || pivot === null) {
    veredicto = "SIN DATOS";
    porQue = "Faltan datos para armar CAN SLIM.";
  } else if (vetoM) {
    veredicto = "NO LO TOCARÍA";
    porQue = `El mercado no acompaña (${x.mercadoNombre} bajo su media de 200): tres de cada cuatro acciones siguen al mercado, y no compra contra él.`;
  } else if (fallan.length) {
    veredicto = "NO LO TOCARÍA";
    porQue = `No cumple ${fallan.slice(0, 2).map((c) => c.nombre.split(":")[0]).join(" ni ")}: ${fallan.slice(0, 2).map((c) => `${c.nombre.split(":")[1]?.trim().toLowerCase() ?? c.nombre} ${c.valor}`).join("; ")}.`;
  } else if (t.cierre > pivot * 1.05) {
    veredicto = "ESPERARÍA";
    porQue = `Ya pasó más de 5 % del punto de compra (${num(pivot)}): no persigue, espera una base nueva.`;
  } else if (t.cierre >= pivot) {
    veredicto = "COMPRARÍA";
    porQue = `Cumple los criterios y está a menos de 5 % sobre el punto de compra (${num(pivot)}).`;
  } else {
    veredicto = "ESPERARÍA";
    porQue = `Cumple los criterios pero no rompió el punto de compra (${num(pivot)}): espera la ruptura con volumen.`;
  }
  const entrada = pivot !== null && t.cierre !== null ? Math.max(pivot, t.cierre) : null;
  const plan = veredicto === "COMPRARÍA" || veredicto === "ESPERARÍA" ? planCon(entrada, entrada !== null ? entrada * 0.92 : null, entrada !== null ? entrada * 1.2 : null, "Corta la pérdida en 7 a 8 % sin discutir (acá, 8 %). Toma ganancias parciales a 20 a 25 %.") : null;
  return {
    id,
    mente,
    familia: FAMILIA[id],
    clase: null,
    pasos,
    veredicto,
    porQue,
    plan,
    cambiaria: ["Si el mercado de referencia pierde su media de 200, sale de la lista.", pivot !== null ? `Un cierre sobre ${num(pivot)} con volumen lo hace comprar.` : "Que haya 120 ruedas."],
    noSabe: ["C: las ganancias del último trimestre", "I: si compran los fondos", "el patrón (taza con asa) a ojo"],
  };
}

function templeton(x: EntradaMentes, l: LecturaMente): Razonamiento {
  const id = "TEMPLETON";
  const mente = "John Templeton";
  const t = tecnica(x);
  const rsi = rsiSerie(x.velas.map((c) => c.close)).at(-1) ?? null;
  const pasos: Paso[] = [
    paso("¿Hay pesimismo? (aprox. por precio: 40 % o más bajo el máximo del año)", t.desdeMax === null ? "hacen falta 120 ruedas" : `a ${pct(-t.desdeMax)} del máximo`, t.desdeMax === null ? null : t.desdeMax <= -0.4),
    paso("¿Ya no cae en picada? (RSI sale de la sobreventa)", rsi === null ? "sin RSI" : `RSI ${num(rsi, 1)}`, l.criterios[1]?.cumple ?? null),
    paso("¿Es más barata que las otras opciones que tengo?", "Hay que compararla con otras: este análisis la mira sola.", null),
  ];
  let veredicto: Veredicto;
  let porQue: string;
  if (l.postura === "SIN DATOS") {
    veredicto = "SIN DATOS";
    porQue = "Hacen falta 120 ruedas.";
  } else if (l.postura === "A FAVOR") {
    veredicto = "COMPRARÍA";
    porQue = "Está castigada y sale de la sobreventa: es el punto de máximo pesimismo, según el precio.";
  } else if (l.postura === "EN CONTRA") {
    veredicto = "NO LO TOCARÍA";
    porQue = `Está a ${pct(-(t.desdeMax ?? 0))} de su máximo: no hay pesimismo, hay optimismo. No es su momento.`;
  } else {
    veredicto = "ESPERARÍA";
    porQue = "No está lo bastante castigada, o todavía cae: espera el pesimismo extremo.";
  }
  return {
    id,
    mente,
    familia: FAMILIA[id],
    clase: null,
    pasos,
    veredicto,
    porQue,
    plan: veredicto === "COMPRARÍA" ? planCon(t.cierre, null, null, "Vende cuando deja de estar barata (el optimismo la acerca a su valor) y la cambia por otra más barata. Diversifica: no pone todo en una.") : null,
    cambiaria: ["Si el precio cae otro tramo sin rebotar, espera más.", "Si se acerca a su máximo, pasa de comprar a no tocarla."],
    noSabe: ["el pesimismo real del mercado (encuestas, flujos, noticias)", "cómo se compara con otras opciones"],
  };
}

function dalio(x: EntradaMentes, l: LecturaMente): Razonamiento {
  const id = "DALIO";
  const mente = "Ray Dalio";
  const vol = volatilidadAnual(x.velas);
  const peso = vol !== null && x.volMediana !== null && vol > 0 ? x.volMediana / vol : null;
  const pasos: Paso[] = [
    info("¿Cuánto se mueve? (volatilidad anual)", vol === null ? "hacen falta 30 ruedas" : pct(vol)),
    info("¿Cuánto pesaría en una cartera equilibrada por riesgo?", peso === null ? "falta el universo para comparar" : `${num(peso)} veces el peso normal`),
    paso("¿En qué régimen estamos (crecimiento e inflación, subiendo o bajando)?", "El régimen macro no se mide acá.", null),
    paso("¿Qué tan correlacionado está con el resto de mi cartera?", "No se mide acá: depende de tu cartera.", null),
  ];
  return {
    id,
    mente,
    familia: FAMILIA[id],
    clase: null,
    pasos,
    veredicto: l.postura === "SIN DATOS" ? "SIN DATOS" : "INFORMA",
    porQue: vol === null ? "Hacen falta 30 ruedas." : peso !== null ? `No elige dirección: dice cuánto pesar. Con volatilidad ${pct(vol)}, pesaría ${num(peso)} veces lo normal.` : `No elige dirección. Volatilidad ${pct(vol)}.`,
    plan: null,
    cambiaria: ["Si la volatilidad sube, su peso baja (y al revés)."],
    noSabe: ["el régimen macro (crecimiento e inflación)", "la correlación con el resto de tu cartera"],
  };
}

/**
 * El razonamiento de cada mente sobre un papel o un activo. `tipo` CRIPTO hace que las lentes que necesitan balances se
 * abstengan con su motivo (FUERA DE MI MÉTODO) en vez de inventar un valor.
 */
export function razonarMentes(x: EntradaMentes, tipo: TipoActivo = "ACCION"): Razonamiento[] {
  const ls = leerMentes(x);
  return [
    buffett(x, tipo),
    graham(x, tipo),
    lynch(x, tipo),
    musk(x, tipo),
    ptj(x, lectura(ls, "PTJ")),
    darvas(x, lectura(ls, "DARVAS")),
    oneil(x, lectura(ls, "ONEIL"), tipo),
    templeton(x, lectura(ls, "TEMPLETON")),
    dalio(x, lectura(ls, "DALIO")),
  ];
}

// ── Contestar con el método ──

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * La respuesta de una mente a lo que se le pregunta, sacada de su propio razonamiento (sin IA): qué haría, dónde sale, qué la
 * haría cambiar de idea, qué no puede saber y cómo piensa. Contesta primero lo preguntado. null si la pregunta es de otra
 * cosa (entonces contesta la IA con este razonamiento como contexto).
 */
export function respuestaDeMetodo(r: Razonamiento, pregunta: string, ticker = ""): string | null {
  const q = sinTildes(pregunta);
  const de = ticker ? `${ticker}: ` : "";
  const entra = r.veredicto === "COMPRARÍA" || r.veredicto === "ESPERARÍA";
  if (/\b(stop|salir|salida|vender|vendes|cortar|corto perdidas|cuando salis)\b/.test(q)) {
    if (!r.plan) return `${de}${entra ? "Mi método no fija una salida acá." : "Hoy no entraría, así que no tengo salida que darte."} ${r.veredicto === "FUERA DE MI MÉTODO" ? r.porQue : ""}`.trim();
    const stop = r.plan.stop !== null ? `Stop en ${num(r.plan.stop)}${r.plan.riesgo !== null ? ` (${pct(r.plan.riesgo)} debajo de la entrada)` : ""}. ` : "";
    return `${de}${stop}${r.plan.salida}${r.plan.tamano ? ` Tamaño: ${r.plan.tamano}.` : ""}`;
  }
  if (/\b(cambiar\w* de (idea|opinion)|que te haria|que tendria que pasar|te haria cambiar)\b/.test(q)) return `${de}${r.cambiaria.join(" ")}`;
  if (/\b(que no (sabes|podes|medis|ves)|que te falta|limites|que no sabes)\b/.test(q)) return `${de}No puedo saber: ${r.noSabe.join("; ")}.`;
  if (/\b(como (pensas|razonas|decidis|analizas)|tu metodo|tus pasos|que te preguntas|en que orden)\b/.test(q)) {
    const pasos = r.pasos.slice(0, 5).map((p, k) => `${k + 1}) ${p.pregunta} ${p.hallazgo}`);
    return pasos.length ? `${de}Mi método, en orden: ${pasos.join(" ")}` : `${de}${r.porQue}`;
  }
  if (/\b(comprar\w*|har\w*|entrar\w*|que opinas|que pensas|que ves|invertir\w*|te gusta)\b/.test(q)) {
    const entrada = r.plan?.entrada !== null && r.plan?.entrada !== undefined ? ` Entrada de referencia: ${num(r.plan.entrada)}.` : "";
    return `${de}${r.veredicto}. ${r.porQue}${entrada}`;
  }
  return null;
}
