/**
 * El tutorial paso a paso de toda la plataforma, por capítulos: empezá acá (RESUMEN, JARVIS, señales), el MAPA y sus
 * niveles, señales y entradas, acciones y CEDEARs (Fibonacci, mentes), flujo institucional, los agentes, y tu cuenta y tu
 * riesgo. Cada paso tiene un botón que lleva a esa parte de la app.
 * Se abre solo la primera vez y cuando el enlace trae ?tutorial=1 (el QR impreso). Puro: los textos y cuándo abrirse.
 */

export type AccionTutorial = { tipo: "seccion"; destino: string; boton: string } | { tipo: "ar"; destino: string; boton: string } | { tipo: "cuenta"; boton: string } | null;

export type PasoTutorial = { id: string; capitulo: string; titulo: string; texto: string; accion: AccionTutorial };

export const TUTORIAL_KEY = "alt-radar-pro:tutorial:v1";

/** Los capítulos, en orden: el índice del primer paso deja saltar a cualquiera. */
export const CAPITULOS = ["EMPEZÁ ACÁ", "EL MAPA", "SEÑALES Y ENTRADAS", "ACCIONES Y CEDEARS", "FLUJO INSTITUCIONAL", "LOS AGENTES", "TU CUENTA Y TU RIESGO"] as const;

export const PASOS_TUTORIAL: PasoTutorial[] = [
  {
    id: "hola",
    capitulo: "EMPEZÁ ACÁ",
    titulo: "Bienvenido a ALT RADAR PRO",
    texto: "Una terminal para leer el mercado: cripto, acciones argentinas y CEDEARs. Todo lo que muestra está medido y dice de dónde sale. Seguí los pasos o elegí un capítulo.",
    accion: null,
  },
  {
    id: "hoy",
    capitulo: "EMPEZÁ ACÁ",
    titulo: "HOY",
    texto: "Lo primero que ves: los planes de la pizarra, los papeles en zona de compra, las señales abiertas y el semáforo que dice si cada fuente ya demostró algo. Si no hay plan, esperar también es una decisión.",
    accion: { tipo: "seccion", destino: "hoy", boton: "VER HOY" },
  },
  {
    id: "resumen",
    capitulo: "EMPEZÁ ACÁ",
    titulo: "El RESUMEN",
    texto: "El estado del mercado de un vistazo: en qué régimen está (qué tan cerca de una altseason, con sus factores), el riesgo geopolítico y la rotación entre BTC y las altcoins. Es el punto de partida de cada día.",
    accion: { tipo: "seccion", destino: "resumen", boton: "VER EL RESUMEN" },
  },
  {
    id: "jarvis",
    capitulo: "EMPEZÁ ACÁ",
    titulo: "JARVIS TRADING",
    texto: "Una mesa de especialistas lee una moneda (tendencia, niveles, derivados, noticias) y un gestor de riesgo decide si hay operación o no. Le podés hablar con el micrófono o el orbe de abajo a la derecha.",
    accion: { tipo: "seccion", destino: "jarvis-trading", boton: "ABRIR JARVIS" },
  },
  {
    id: "robot",
    capitulo: "EMPEZÁ ACÁ",
    titulo: "SEÑALES · ROBOT MM",
    texto: "Las señales del robot del mapa de liquidez, cada una con su plan (stop y objetivos) y con cómo le fue a las anteriores.",
    accion: { tipo: "seccion", destino: "inteligencia", boton: "VER LAS SEÑALES" },
  },
  {
    id: "mapa",
    capitulo: "EL MAPA",
    titulo: "El MAPA de liquidaciones",
    texto: "Elegí una moneda y una temporalidad arriba, y tocá MODO SIMPLE: queda lo esencial. Las zonas IMÁN son donde se juntan liquidaciones estimadas; el precio suele ir a buscarlas, pero no siempre.",
    accion: { tipo: "seccion", destino: "liquidaciones", boton: "ABRIR EL MAPA" },
  },
  {
    id: "niveles",
    capitulo: "EL MAPA",
    titulo: "Los niveles con estrellas",
    texto: "Las líneas verdes son pisos (soportes) y las rojas, techos (resistencias). Más estrellas = más motivos que coinciden en ese precio. Sirven para ubicar el stop y el objetivo.",
    accion: { tipo: "seccion", destino: "liquidaciones", boton: "VER LOS NIVELES" },
  },
  {
    id: "romper",
    capitulo: "SEÑALES Y ENTRADAS",
    titulo: "A punto de romper y Suben solas",
    texto: "POR ROMPER muestra monedas comprimidas contra un nivel; SUBEN SOLAS, las que suben aunque BTC no acompañe. Son lugares para mirar, no órdenes.",
    accion: { tipo: "seccion", destino: "rompe", boton: "VER POR ROMPER" },
  },
  {
    id: "mas-entradas",
    capitulo: "SEÑALES Y ENTRADAS",
    titulo: "Más herramientas de entrada",
    texto: "Con AVANZADO aparecen PUMPEO (volumen anormal), PRESIÓN (qué está comprimido), ZONAS MTF (dónde se defendió el precio), SWING y ESTRATEGIA SPOT (dónde comprar, dónde salir y dónde admitir el error).",
    accion: { tipo: "seccion", destino: "spot", boton: "VER ESTRATEGIA SPOT" },
  },
  {
    id: "acciones",
    capitulo: "ACCIONES Y CEDEARS",
    titulo: "MERCADO AR",
    texto: "El panel líder de BYMA y los CEDEARs en tarjetas. Tocá una y se abre en el MAPA con su gráfico: arrastrá para moverte, hacé zoom con dos dedos y prendé o apagá las capas (medias, niveles, Fibonacci).",
    accion: { tipo: "ar", destino: "ACCIONES", boton: "VER ACCIONES" },
  },
  {
    id: "fibonacci",
    capitulo: "ACCIONES Y CEDEARS",
    titulo: "Las compras de Fibonacci",
    texto: "MEJORES COMPRAS FIBONACCI lista los papeles con el precio en la zona 0,618–0,786 de su última subida, con stop y tres objetivos. Mirá cuántas veces aguantó antes: con pocos casos es muestra mínima.",
    accion: { tipo: "ar", destino: "FIBONACCI", boton: "VER LAS COMPRAS" },
  },
  {
    id: "mentes",
    capitulo: "ACCIONES Y CEDEARS",
    titulo: "Las mentes y su sala",
    texto: "Nueve agentes leen cada papel con las reglas públicas de Buffett, Graham, Lynch, Musk, Tudor Jones y otros, y dicen a favor, en contra o sin datos, y por qué. En la sala se reúnen y les podés preguntar. Están inspirados en ellos; ninguno participa.",
    accion: { tipo: "ar", destino: "SALA", boton: "ABRIR LA SALA" },
  },
  {
    id: "institucional",
    capitulo: "FLUJO INSTITUCIONAL",
    titulo: "Qué hace el dinero grande",
    texto: "INSTITUCIONAL muestra qué compraron los fondos (ETF de Bitcoin); ÓRDENES GRANDES, quién entra con tamaño; FLUJO POR ACTIVO y RESERVAS, qué entra y sale de los exchanges; OFERTA PENDIENTE, cuántos tokens faltan desbloquear.",
    accion: { tipo: "seccion", destino: "institucional", boton: "VER INSTITUCIONAL" },
  },
  {
    id: "lab",
    capitulo: "LOS AGENTES",
    titulo: "AI TRADING LAB y la oficina",
    texto: "Cada agente opera una estrategia en papel (sin plata real) y se mide contra el azar. En la oficina 3D los ves en sus escritorios, con su acierto, y les podés preguntar qué están viendo.",
    accion: { tipo: "seccion", destino: "lab", boton: "ABRIR EL LABORATORIO" },
  },
  {
    id: "analista",
    capitulo: "LOS AGENTES",
    titulo: "El ANALISTA",
    texto: "Preguntale a la terminal en tus palabras: «¿cómo ves SOL?», «¿dónde pongo el stop?». Responde con los datos que la app tiene en pantalla.",
    accion: { tipo: "seccion", destino: "asistente", boton: "ABRIR EL ANALISTA" },
  },
  {
    id: "cuenta",
    capitulo: "TU CUENTA Y TU RIESGO",
    titulo: "Cuenta y alertas en el celular",
    texto: "Creá tu cuenta gratis y conectá Telegram: te avisa cuando el precio llega a donde vos digas (por ejemplo /alerta BTC 90000) y cuando aparece algo en el centro de ALERTAS.",
    accion: { tipo: "cuenta", boton: "CREAR CUENTA GRATIS" },
  },
  {
    id: "cartera",
    capitulo: "TU CUENTA Y TU RIESGO",
    titulo: "Tu cartera y tu diario",
    texto: "Conectá Binance con una clave de solo lectura (sin retiros) y vas a ver tu balance, tus futuros con la distancia a liquidación, y un DIARIO con tus operaciones reales y su acierto.",
    accion: { tipo: "seccion", destino: "diario", boton: "ABRIR EL DIARIO" },
  },
  {
    id: "riesgo",
    capitulo: "TU CUENTA Y TU RIESGO",
    titulo: "Cuidá tu plata",
    texto: "Arriesgá como máximo 1 % por operación y siempre con stop. La mesa de RIESGO te dice cuánto comprar según dónde está tu stop. Nada de esto es asesoramiento financiero.",
    accion: { tipo: "seccion", destino: "riesgo", boton: "ABRIR LA CALCULADORA" },
  },
  {
    id: "listo",
    capitulo: "TU CUENTA Y TU RIESGO",
    titulo: "Listo",
    texto: "Arriba, en la barra de paneles, AVANZADO muestra todas las herramientas y TUTORIAL vuelve a abrir esta guía cuando quieras.",
    accion: null,
  },
];

/** El primer paso de cada capítulo (para saltar desde el índice). */
export const inicioCapitulo = (c: string) => PASOS_TUTORIAL.findIndex((p) => p.capitulo === c);

/** Si el tutorial se abre solo: cuando el enlace lo pide (?tutorial=1) o si esta persona todavía no lo vio. */
export function debeAbrirse(search: string, visto: boolean): boolean {
  const pide = new URLSearchParams(search).get("tutorial");
  if (pide === "1") return true;
  if (pide === "0") return false;
  return !visto;
}
