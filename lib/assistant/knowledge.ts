/**
 * Curated explanations for the concepts the terminal actually uses.
 *
 * These are written once and reviewed, rather than generated, so the assistant
 * can explain a concept without a language model and without the risk of
 * inventing a definition that sounds right. Each entry stays deliberately
 * short: the assistant pairs it with live data, and a wall of theory would
 * bury the reading the user asked for.
 */

export type KnowledgeEntry = {
  id: string;
  title: string;
  /** Terms that should surface this entry, already lowercase and unaccented. */
  aliases: string[];
  summary: string;
  detail: string;
  /** What to be careful about — the part most explanations leave out. */
  caveat?: string;
};

export const KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: "cvd",
    title: "CVD (Cumulative Volume Delta)",
    aliases: ["cvd", "volume delta", "delta acumulado", "delta acumulativo"],
    summary:
      "Suma corrida de compras agresivas menos ventas agresivas: quién está cruzando el spread para entrar.",
    detail:
      "Una compra agresiva es la que levanta el ask; una venta agresiva es la que pega contra el bid. El CVD acumula esa diferencia en dinero. Si el precio sube y el CVD sube, la subida está siendo pagada. Si el precio sube y el CVD baja, alguien está vendiendo contra ese movimiento: es divergencia, y suele preceder un giro.",
    caveat:
      "El CVD sólo ve órdenes a mercado. Un jugador grande que acumula con órdenes límite pasivas no aparece, así que un CVD plano no significa que nadie esté comprando.",
  },
  {
    id: "footprint",
    title: "Footprint",
    aliases: ["footprint", "huella", "bid x ask", "bid ask por nivel"],
    summary:
      "Muestra, precio por precio, cuánto se ejecutó contra el bid y cuánto contra el ask.",
    detail:
      "En vez de una vela con un solo volumen, el footprint abre ese volumen por nivel y por lado. Sirve para ver dónde se absorbió oferta, dónde se agotó la demanda y en qué precio se concentró la actividad.",
    caveat:
      "Necesita ejecuciones reales. En un activo ilíquido el footprint tiene tan pocos datos que cualquier lectura es ruido.",
  },
  {
    id: "imbalance",
    title: "Desequilibrio (imbalance)",
    aliases: ["imbalance", "desequilibrio", "desbalance"],
    summary:
      "Un nivel donde un lado ejecutó mucho más que el otro; acá se marca desde 3× de diferencia.",
    detail:
      "Varios desequilibrios apilados en la misma dirección indican que un lado está barriendo al otro con decisión, no operando de a poco. Los desequilibrios suelen dejar niveles a los que el precio vuelve después.",
    caveat:
      "Un desequilibrio no es una señal de entrada. Marca dónde hubo agresión, no hacia dónde sigue el precio.",
  },
  {
    id: "value-area",
    title: "Área de valor",
    aliases: ["area de valor", "value area", "poc", "punto de control"],
    summary:
      "El rango de precios donde ocurrió el 70% del volumen. El POC es el nivel con más volumen de todos.",
    detail:
      "Es donde el mercado consideró que había valor. El precio tiende a volver al área de valor cuando se aleja sin volumen que lo sostenga, y el POC suele funcionar como imán.",
    caveat:
      "Se calcula sobre la ventana observada, no sobre la sesión completa. Cambiar la ventana cambia el área.",
  },
  {
    id: "usdt-dominance",
    title: "Dominancia de USDT",
    aliases: [
      "usdt.d",
      "usdt d",
      "dominancia de usdt",
      "dominancia usdt",
      "stablecoins",
      "stablecoin",
      "capital al margen",
    ],
    summary:
      "Qué porcentaje de la capitalización total está parado en USDT: poder de compra esperando afuera.",
    detail:
      "Se lee al revés que el resto. Si USDT.D sube, hay capital saliendo de riesgo hacia stablecoins, y eso suele acompañar debilidad en alts. Si baja, ese capital volvió al mercado. Por eso USDT.D subiendo con precios cayendo es coherente, y USDT.D bajando con precios subiendo confirma la rotación.",
    caveat:
      "Es un porcentaje, no un monto. Si la capitalización total cae, USDT.D puede subir sin que haya entrado un solo dólar nuevo a stablecoins.",
  },
  {
    id: "btc-dominance",
    title: "Dominancia de BTC",
    aliases: ["btc.d", "btc d", "dominancia de btc", "dominancia btc", "dominancia"],
    summary: "Qué porcentaje de la capitalización total es Bitcoin.",
    detail:
      "Bajando con el mercado subiendo indica rotación hacia altcoins. Subiendo con el mercado cayendo indica refugio en BTC. La combinación con el total importa más que el número solo.",
    caveat:
      "BTC.D bajando también puede significar simplemente que BTC cae más rápido que el resto. No es alcista por sí sola.",
  },
  {
    id: "total2-total3",
    title: "TOTAL, TOTAL2 y TOTAL3",
    aliases: ["total2", "total 2", "total3", "total 3", "market cap", "capitalizacion", "marketcap"],
    summary:
      "TOTAL es toda la capitalización cripto. TOTAL2 le quita BTC. TOTAL3 le quita BTC y ETH.",
    detail:
      "No son fuentes distintas: se derivan del total y la dominancia. TOTAL2 mide el mercado de altcoins, y TOTAL3 el de altcoins sin el peso de ETH, que es donde se ve mejor una rotación hacia monedas chicas.",
  },
  {
    id: "altseason",
    title: "Altseason",
    aliases: ["altseason", "temporada de alts", "temporada alt"],
    summary:
      "Fase en la que el capital se reparte más allá de BTC y la mayoría de las alts le gana en rendimiento.",
    detail:
      "Acá se estima con amplitud (cuántas alts superan a BTC), rendimiento de ETH contra BTC, participación de volumen y estabilidad de BTC, ajustado por el contexto macro.",
    caveat:
      "Es una probabilidad de régimen, no un permiso para comprar cualquier cosa. En altseason confirmada igual la mayoría de las monedas termina por debajo.",
  },
  {
    id: "riesgo-posicion",
    title: "Tamaño de posición y riesgo",
    aliases: [
      "tamaño de posicion",
      "position sizing",
      "cuanto arriesgar",
      "gestion de riesgo",
      "riesgo por operacion",
    ],
    summary:
      "El tamaño sale de la distancia al stop, no del apalancamiento. El apalancamiento sólo limita cuánto nocional soporta la cuenta.",
    detail:
      "Fijás cuánto estás dispuesto a perder si la tesis falla (por ejemplo 1% de la cuenta) y dividís ese monto por la distancia entre entrada e invalidación. Ese cociente es el tamaño. Así, un stop lejano da una posición chica y uno cercano una grande, pero la pérdida si te equivocás es siempre la misma.",
    caveat:
      "Si el apalancamiento pone la liquidación antes del stop, el stop no te protege y perdés el margen entero. La calculadora de esta app avisa exactamente ese caso.",
  },
  {
    id: "r-multiple",
    title: "R y ratio riesgo-beneficio",
    aliases: ["r multiple", "ratio r", "riesgo beneficio", "risk reward", "rr", "1r", "2r"],
    summary:
      "1R es lo que arriesgás. Un objetivo de 3R busca ganar tres veces esa cantidad.",
    detail:
      "Pensar en R vuelve comparables operaciones de distinto tamaño y precio. Con 2R sostenido, acertar 40% de las veces ya es rentable; con 1R necesitás más del 50%.",
    caveat:
      "Un R alto sobre el papel no sirve si el objetivo está en un lugar al que el precio rara vez llega. El R:R sólo vale junto a la probabilidad real de alcanzarlo.",
  },
  {
    id: "liquidacion",
    title: "Liquidación",
    aliases: ["liquidacion", "liquidaciones", "liquidation", "forceorder", "force order"],
    summary:
      "El cierre forzado de una posición apalancada cuando el margen ya no la sostiene.",
    detail:
      "Una cascada de liquidaciones de longs empuja el precio hacia abajo porque cada cierre forzado es una venta a mercado, y viceversa. Por eso los picos de liquidaciones suelen coincidir con mechas largas y giros bruscos.",
    caveat:
      "El precio exacto de liquidación depende del margen de mantenimiento, comisiones y modo de margen. Cualquier estimación, incluida la de esta app, es aproximada y algo optimista.",
  },
  {
    id: "funding",
    title: "Funding rate",
    aliases: ["funding", "tasa de financiamiento", "financiamiento"],
    summary:
      "Pago periódico entre longs y shorts en perpetuos, que mantiene el precio del futuro pegado al spot.",
    detail:
      "Funding positivo significa que los longs pagan a los shorts: hay más presión alcista apalancada. Muy positivo y sostenido indica un posicionamiento cargado de un lado, que es combustible para una cascada si el precio gira.",
  },
  {
    id: "open-interest",
    title: "Open Interest",
    aliases: ["open interest", "oi", "interes abierto"],
    summary: "Cantidad total de contratos abiertos sin cerrar.",
    detail:
      "OI subiendo con el precio subiendo indica dinero nuevo entrando en largo. OI cayendo con el precio subiendo indica cierre de shorts, que es un movimiento con menos convicción detrás.",
  },
  {
    id: "correlacion",
    title: "Correlación",
    aliases: ["correlacion", "correlaciones", "pearson", "beta"],
    summary:
      "Mide cuánto se mueven juntos dos activos, de -1 a 1. La beta mide cuánto amplifica uno los movimientos del otro.",
    detail:
      "Correlación 0.8 entre dos monedas significa que tener las dos no diversifica: es una sola apuesta con dos nombres. Beta 1.5 contra BTC significa que históricamente se movió un 1.5% por cada 1% de BTC.",
    caveat:
      "La correlación cripto tiende a 1 justo en las caídas fuertes, que es cuando más falta hace que sea baja.",
  },
  {
    id: "pump",
    title: "Fases de un pump",
    aliases: ["pump", "pumpeo", "bombeo", "ignicion", "climax", "distribucion", "acumulacion"],
    summary:
      "Acumulación → Ignición → Pump activo → Clímax → Distribución.",
    detail:
      "En acumulación sube el volumen con el precio quieto. En ignición se disparan volumen y rango con poco recorrido todavía: es la fase útil. En pump activo el movimiento ya lleva camino hecho. En clímax aparece venta absorbiendo el impulso, con mechas superiores. En distribución el precio retrocede desde el máximo con volumen alto.",
    caveat:
      "Detectar un pump no es una razón para comprarlo. Clímax y distribución señalan lo contrario, y son las fases donde entra la mayoría.",
  },
  {
    id: "spread-liquidez",
    title: "Spread y liquidez",
    aliases: ["spread", "liquidez", "slippage", "deslizamiento"],
    summary:
      "El spread es la diferencia entre el mejor bid y el mejor ask; la liquidez es cuánto se puede ejecutar sin mover el precio.",
    detail:
      "En un activo ilíquido, entrar y salir cuesta más que la ventaja que te da la señal. Por eso esta app penaliza el score por volumen insuficiente en vez de mostrar la señal como si fuera igual de operable.",
  },
  {
    id: "walk-forward",
    title: "Validación walk-forward",
    aliases: ["walk forward", "walk-forward", "sin look ahead", "look ahead", "backtest"],
    summary:
      "Registrar la señal en el momento y recién evaluarla cuando pasa el tiempo, sin mirar el futuro.",
    detail:
      "Es lo opuesto a elegir velas hacia atrás para que la estrategia parezca buena. Acá cada señal se guarda con su precio de entrada y después se capturan los resultados a 15m, 1H, 4H y 24H, con lo que realmente pasó.",
    caveat:
      "Los resultados registrados no son operaciones ejecutadas: no incluyen comisiones, deslizamiento ni la decisión humana de salir antes.",
  },
  {
    id: "kill-switch",
    title: "Riesgo macro y noticias",
    aliases: ["kill switch", "riesgo geopolitico", "noticias", "macro"],
    summary:
      "El flujo de noticias penaliza el score de las señales, pero ya no las bloquea.",
    detail:
      "Antes un contexto macro extremo forzaba NO SIGNAL en todo el universo, con lo que el feed decidía por vos. Ahora las señales se siguen calculando, quedan marcadas con el contexto y la decisión es tuya.",
  },
];

/** Combining diacritical marks, so "dominancia" matches "domináncia". */
const DIACRITICS = /[̀-ͯ]/g;

export const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .replace(/[^a-z0-9\s.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Finds the concepts a question is asking about. Matching is on whole words so
 * that, for example, "oi" does not fire inside "coincidencia".
 */
export function findConcepts(question: string, limit = 2): KnowledgeEntry[] {
  const text = ` ${normalize(question)} `;
  const scored: { entry: KnowledgeEntry; score: number }[] = [];

  for (const entry of KNOWLEDGE) {
    let score = 0;
    for (const alias of entry.aliases) {
      if (text.includes(` ${alias} `)) {
        // Longer aliases are more specific, so they outrank generic ones.
        score = Math.max(score, alias.length);
      }
    }
    if (score > 0) scored.push({ entry, score });
  }

  return scored
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.entry);
}

export function conceptById(id: string) {
  return KNOWLEDGE.find((entry) => entry.id === id) ?? null;
}
