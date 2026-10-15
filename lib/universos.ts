/**
 * Los universos de monedas: grupos con los que trabajan los agentes (gemas, pumpeo, infraestructura y DeFi, las 10 del
 * estudio). La distinción que manda todo: ESCANEAR en vivo se puede con cualquier moneda que Binance liste, pero MEDIR en
 * el pasado solo se puede con las que tienen velas descargadas (datos-investigacion/, 10 monedas). Un universo sin datos
 * puede vigilarse y no puede estudiarse, y eso se dice en la pantalla en vez de mostrar números inventados.
 * Pura: no lee la red, el disco ni la base.
 */

/** Las monedas con velas descargadas: las únicas que el estudio puede medir (scripts/investigacion/datos.py). */
export const MONEDAS_CON_DATOS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "TRXUSDT", "BCHUSDT", "ZECUSDT"];

export type Universo = {
  id: string;
  nombre: string;
  /** Qué busca este universo, en una línea. */
  describe: string;
  monedas: string[];
  /** Por qué estas monedas y no otras: queda escrito para que no se elijan después de ver resultados. */
  criterio: string;
};

/**
 * Los universos. Las monedas se eligen por una razón escrita de antemano, no por cómo les fue: elegirlas mirando el
 * resultado es la forma más fácil de inventarse una ventaja.
 */
export const UNIVERSOS: Universo[] = [
  {
    id: "ESTUDIO",
    nombre: "Las 10 del estudio",
    describe: "Las monedas grandes con historia descargada: lo único que hoy se puede medir en el pasado.",
    monedas: MONEDAS_CON_DATOS,
    criterio: "Fijadas antes de medir nada, por tamaño y por tener velas desde 2020 en el repositorio de datos.",
  },
  {
    id: "INFRA",
    nombre: "Infraestructura y DeFi",
    describe: "Cadenas y protocolos grandes fuera del top 3.",
    monedas: ["SOLUSDT", "AVAXUSDT", "LINKUSDT", "UNIUSDT", "ONDOUSDT", "WLDUSDT"],
    criterio: "Proyectos con producto en uso y volumen alto en Binance, elegidos por categoría y no por rendimiento.",
  },
  {
    id: "PUMPEO",
    nombre: "Pumpeo",
    describe: "Monedas que se mueven de golpe: sirven para vigilar volumen, no para confiar en ellas.",
    monedas: ["DOGEUSDT", "PEPEUSDT", "SHIBUSDT", "WIFUSDT", "BONKUSDT", "FLOKIUSDT"],
    criterio: "Alta volatilidad y volumen impulsado por atención, no por uso. Lista fija: no se cambia por resultados.",
  },
  {
    id: "GEMAS",
    nombre: "Gemas",
    describe: "Capitalización chica. Mucho más riesgo: menos liquidez, deslizamiento más alto y más proyectos que mueren.",
    monedas: [],
    criterio: "Sin lista fija todavía: una lista de monedas chicas armada hoy mirando para atrás solo elegiría las que ya subieron (sesgo del sobreviviente).",
  },
];

export const universoPorId = (id: string): Universo | null => UNIVERSOS.find((u) => u.id === id) ?? null;

/** Si la moneda tiene velas descargadas y por lo tanto se puede medir en el pasado. */
export const tieneDatos = (symbol: string): boolean => MONEDAS_CON_DATOS.includes(symbol);

export type EstadoUniverso = {
  universo: Universo;
  /** Las monedas del universo que sí se pueden medir. */
  conDatos: string[];
  /** Las que solo se pueden vigilar en vivo, porque no hay velas descargadas. */
  sinDatos: string[];
  /** Se puede estudiar el universo entero. */
  medible: boolean;
  /** Hay algo para vigilar en vivo (cualquier moneda sirve: el precio llega de Binance en el momento). */
  vigilable: boolean;
  /** Lo que se puede decir del universo, sin prometer lo que no se midió. */
  texto: string;
};

/**
 * En qué estado está un universo. Un universo con monedas sin datos no es un error: se puede vigilar en vivo igual. Lo que
 * no se puede es decir su acierto ni su profit factor, y el texto lo dice con todas las letras.
 */
export function estadoUniverso(u: Universo): EstadoUniverso {
  const conDatos = u.monedas.filter(tieneDatos);
  const sinDatos = u.monedas.filter((m) => !tieneDatos(m));
  const medible = conDatos.length > 0 && sinDatos.length === 0;
  const vigilable = u.monedas.length > 0;
  let texto: string;
  if (u.monedas.length === 0) texto = "Sin monedas definidas todavía: no se vigila ni se mide.";
  else if (medible) texto = `Se puede vigilar en vivo y medir en el pasado: las ${conDatos.length} monedas tienen velas descargadas.`;
  else if (conDatos.length === 0) texto = `Se puede vigilar en vivo, pero NO medir en el pasado: ninguna de las ${sinDatos.length} monedas tiene velas descargadas. Sin eso no hay acierto ni profit factor que mostrar.`;
  else texto = `Se puede vigilar en vivo. En el pasado solo se pueden medir ${conDatos.length} de ${u.monedas.length} (${conDatos.join(", ")}); de las otras no hay velas descargadas, así que el número del universo entero no existe.`;
  return { universo: u, conDatos, sinDatos, medible, vigilable, texto };
}

/** Todas las monedas sin datos, sin repetir: lo que habría que bajar para poder medir todos los universos. */
export function monedasFaltantes(): string[] {
  const out = new Set<string>();
  for (const u of UNIVERSOS) for (const m of u.monedas) if (!tieneDatos(m)) out.add(m);
  return [...out].sort();
}

/** El comando exacto para bajar lo que falta, para correr en la computadora de la persona (acá no hay salida a Binance). */
export function comandoDescarga(monedas = monedasFaltantes()): string | null {
  if (monedas.length === 0) return null;
  return `python3 scripts/investigacion/datos.py --monedas ${monedas.join(" ")}`;
}
