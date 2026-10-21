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
    id: "iceberg",
    title: "Iceberg",
    aliases: ["iceberg", "icebergs", "orden oculta", "tamano oculto"],
    summary:
      "Una orden grande que muestra sólo una porción por vez y se repone cada vez que la ejecutan.",
    detail:
      "Se detecta cuando un nivel absorbe mucho más volumen del que el libro llegó a mostrar ahí. Quien la coloca no quiere revelar su tamaño, porque hacerlo movería el precio en su contra antes de terminar.",
    caveat:
      "Que haya tamaño oculto no dice hacia dónde va el precio. Un iceberg comprador puede estar acumulando o simplemente ejecutando una orden que ya estaba decidida.",
  },
  {
    id: "absorcion",
    title: "Absorción",
    aliases: ["absorcion", "absorbe", "absorbido"],
    summary:
      "Un lado agrede con fuerza y el precio no avanza: alguien está tomando todo ese flujo sin ceder.",
    detail:
      "Es de las lecturas más útiles del order flow, porque muestra un lado gastando munición sin resultado. Cuando la agresión se agota, el precio suele girar hacia el lado que absorbió.",
    caveat:
      "La absorción puede fallar: si el que absorbe se queda sin tamaño, el nivel cede de golpe y el movimiento se acelera en la dirección original.",
  },
  {
    id: "barrido",
    title: "Barrido (sweep)",
    aliases: ["barrido", "sweep", "barre"],
    summary:
      "Una ráfaga que atraviesa varios niveles de precio en segundos, tomando liquidez de golpe.",
    detail:
      "Indica urgencia: quien barre prioriza entrar ya sobre conseguir buen precio. Suele aparecer en rupturas y al inicio de cascadas de liquidaciones.",
    caveat:
      "Un barrido también puede ser una parada de stops: se toma la liquidez y el precio vuelve. Por sí solo no confirma continuación.",
  },
  {
    id: "agresor-pasivo",
    title: "Agresor y pasivo (taker y maker)",
    aliases: ["agresor", "agresiva", "agresivo", "pasivo", "pasiva", "taker", "maker", "orden a mercado", "orden limite"],
    summary:
      "El agresor cruza el spread con una orden a mercado; el pasivo espera en el libro con una orden límite. Cada operación tiene uno de cada lado.",
    detail:
      "El precio se mueve cuando los agresores de un lado consumen las órdenes pasivas del otro. Por eso el flujo se lee en pares: cuánto agredió cada lado y si el libro cedió o aguantó. Las órdenes grandes suelen entrar pasivas, para no mover el precio en su contra.",
    caveat:
      "Que haya más compra agresiva no garantiza suba: si del otro lado hay órdenes pasivas grandes, absorben esa compra y el precio no avanza.",
  },
  {
    id: "delta-vela",
    title: "Delta de vela",
    aliases: ["delta", "delta de vela", "delta por vela", "volumen agresor", "taker buy"],
    summary:
      "Compra agresiva menos venta agresiva dentro de una vela. Binance lo da en cada vela (volumen comprador tomador).",
    detail:
      "Un delta muy positivo con la vela cerrando abajo es agresión compradora absorbida; un delta muy negativo con la vela cerrando arriba, venta absorbida. Sumado vela a vela da el CVD. La mesa de flujo de la oficina usa este dato en dos agentes (divergencia de delta y delta absorbido).",
    caveat:
      "Kraken, Coinbase y el historial de estudio no traen ese dato: sin él, el delta es desconocido, no cero. Por eso esos dos agentes no operan en el servidor y se miden solo hacia adelante.",
  },
  {
    id: "divergencia-delta",
    title: "Divergencia de delta",
    aliases: ["divergencia de delta", "divergencia delta", "divergencia de cvd", "divergencia cvd", "delta divergence"],
    summary:
      "El precio hace un extremo nuevo pero el delta acumulado no lo acompaña: la agresión que empujaba se está agotando.",
    detail:
      "En un mínimo nuevo con el CVD más alto que en el mínimo anterior, los vendedores agresivos ya no empujan como antes. Se lee junto con la estructura: una divergencia contra un nivel fuerte o contra un imán de liquidez barrido pesa más que una en el medio del rango.",
    caveat:
      "Una divergencia puede durar varias velas antes de girar, o no girar nunca. Es una condición, no un gatillo: el agente la exige con un cierre a favor y un stop fijo.",
  },
  {
    id: "esfuerzo-resultado",
    title: "Esfuerzo contra resultado (Wyckoff)",
    aliases: ["esfuerzo", "esfuerzo sin resultado", "esfuerzo resultado", "effort vs result", "esfuerzo y resultado"],
    summary:
      "El volumen es el esfuerzo y el recorrido del precio es el resultado. Mucho esfuerzo con poco resultado avisa que alguien frena el movimiento.",
    detail:
      "Después de un tramo fuerte, una vela con volumen muy alto y rango chico que cierra en contra muestra que el empuje ya no rinde: del otro lado hay órdenes que lo absorben. Es una de las leyes de Wyckoff y la regla del agente Esfuerzo sin resultado.",
    caveat:
      "En una noticia o una apertura de mercado el volumen sube sin que nadie esté absorbiendo. El contexto importa: el volumen alto solo no es la señal.",
  },
  {
    id: "caza-stops",
    title: "Caza de stops (barrida de liquidez)",
    aliases: ["caza de stops", "stop hunt", "barrida de stops", "barrida de liquidez", "liquidez de stops", "barrida"],
    summary:
      "El precio pasa un mínimo o máximo obvio donde se juntan los stops, los ejecuta y vuelve adentro.",
    detail:
      "Los stops de los largos quedan debajo de los mínimos y los de los cortos encima de los máximos. Ejecutarlos da liquidez para llenar órdenes grandes del lado contrario. Si la vela que barre cierra de vuelta adentro y con volumen, el que barrió ya tomó lo que buscaba. En el mapa, esos extremos son los charcos de liquidez y los imanes.",
    caveat:
      "Si el precio barre y se queda afuera, no fue una caza: fue una ruptura. Por eso el agente exige el cierre adentro, y aun así puede fallar.",
  },
  {
    id: "volumen-relativo",
    title: "Volumen relativo",
    aliases: ["volumen relativo", "rvol", "volumen alto", "volumen anormal"],
    summary:
      "El volumen de la vela dividido por el promedio de las anteriores: 2 significa el doble de lo normal para ese activo.",
    detail:
      "Compara cada activo consigo mismo, así que sirve igual en BTC que en una moneda chica. Los agentes de flujo lo usan como umbral fijo: 2 veces para absorción, 2,5 para esfuerzo sin resultado, 1,5 para la barrida y 1,8 para el delta absorbido.",
    caveat:
      "En horarios de poca actividad el promedio baja y cualquier vela normal parece de volumen alto.",
  },
  {
    id: "mapa-liquidez",
    title: "Mapa de liquidez y liquidaciones",
    aliases: ["mapa de liquidez", "mapa de liquidaciones", "mapa de calor", "heatmap", "liquidity heatmap", "iman", "imanes"],
    summary:
      "Dónde se juntan las liquidaciones estimadas y las órdenes del libro: zonas a las que el precio suele ir a buscar liquidez.",
    detail:
      "Las bandas más intensas marcan más liquidación estimada a ese precio. Un imán es la zona más cargada cerca del precio. Las zonas de compra y de venta del mapa salen de varios motivos que coinciden (niveles, order blocks, huecos, charcos de liquidez) y llevan estrellas por cuántos coinciden. Los agentes guardan una foto del mapa al entrar y la comparan con el mapa de ahora.",
    caveat:
      "El mapa de liquidaciones es un modelo con apalancamiento supuesto, no las posiciones reales. Que el precio vaya a un imán es una tendencia, no una regla.",
  },
  {
    id: "vwap",
    title: "VWAP",
    aliases: ["vwap", "precio promedio ponderado", "promedio ponderado por volumen"],
    summary:
      "El precio promedio ponderado por volumen desde un ancla (acá, el lunes 00:00 UTC): el precio justo de la semana para quien operó.",
    detail:
      "Por encima del VWAP, el promedio de los que compraron esta semana gana; por debajo, pierde. Muchos institucionales lo usan como referencia de ejecución, así que suele actuar de soporte o resistencia.",
    caveat:
      "Recién empezada la semana el VWAP tiene pocas velas y se mueve mucho: pesa menos.",
  },
  {
    id: "squeeze",
    title: "Squeeze (short y long)",
    aliases: ["squeeze", "short squeeze", "long squeeze", "apretada"],
    summary:
      "Un lado queda demasiado cargado y, al moverse el precio en su contra, sus cierres forzados empujan más en esa dirección.",
    detail:
      "En un short squeeze hay mucho posicionamiento corto: si el precio sube, cada liquidación de short es una compra forzada que lo empuja más arriba, y eso liquida al siguiente. El long squeeze es el espejo, hacia abajo. Se lee combinando funding, open interest, liquidaciones y flujo agresivo.",
    caveat:
      "Un posicionamiento cargado puede quedarse así mucho tiempo. El squeeze necesita un detonante, y saber que existe la condición no dice cuándo se dispara.",
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
