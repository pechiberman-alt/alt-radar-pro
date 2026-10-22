/**
 * La oficina del fondo: cada agente de papel en su escritorio, agrupados en mesas como un fondo de comercio. Cada escritorio
 * muestra lo que el registro unificado dice de ese agente (el acierto, el profit factor y la expectancia salen de
 * lib/registro.ts, con su muestra), qué tiene abierto y en qué activo (cripto, oro, plata), y la reunión de la semana: lo que
 * cerró cada uno en los últimos 7 días. La reunión no cambia ninguna regla: los cambios se proponen y los aprueba la persona,
 * a mano, en el laboratorio en sombra. Pura: sin red ni base. Solo papel: ningún escritorio manda órdenes.
 *
 * La charla: cada frase sale de un dato (lo que tiene abierto, con quién coincide o discrepa, cuánto cerró y con qué muestra).
 * Nadie inventa un número ni una opinión. Aprenden entre ellos por el consenso (lib/consenso.ts): se compara cómo terminan
 * las entradas donde coincidieron varios contra las solitarias, con muestra mínima. Eso informa; no filtra ni cambia reglas.
 * Las propuestas son para la persona: ninguna se aplica sola.
 */
import { explicadoDe } from "./agentes-explicado.ts";
import { AGENTES_PAUSADOS, agentePausado, leerClavePapel } from "./agentes-papel.ts";
import { leerClaveServidor } from "./agentes-servidor.ts";
import { forAi } from "./ai-numbers.ts";
import { acuerdoDe, concienciaDe, conversaciones, leccionesDe, type Dialogo, type Leccion } from "./agentes-mente.ts";
import { compararConsenso, type Comparacion, type ResultadoConsenso } from "./consenso.ts";
import { ESTRATEGIAS } from "./estrategias.ts";
import { entraConMapa, veredictoDeFoto, type Veredicto } from "./confluencia.ts";
import { historialDe, textoHistorial, type Historial } from "./oficina-historial.ts";
import { CAPITAL_INICIAL_USD, contar, estadistica, MUESTRA_MINIMA, RIESGO_POR_OPERACION_PCT, simularCapital, type Capital, type Estadistica, type OperacionLeida } from "./registro.ts";

/** Entradas que se leen por visita: por índice y con tope (plan gratuito de D1). Si se llega al tope, se dice. */
export const LIMITE_OFICINA = 1000;
export const SEMANA_MS = 7 * 86_400_000;
/** El agente Supertrend MTF + Volumen con su filtro de régimen de BTC (PLAN_ST_1): corre aparte, con claves «st:». */
export const ID_ST = "ST_REGIMEN";

export { acuerdoDe } from "./agentes-mente.ts";

export type FilaOficina = { clave: string; symbol: string; lado: string; r: number | null; desenlace: string; cerrada: number | null; detectada: number; foto?: string | null };

export type MesaId = "TENDENCIA" | "REVERSION" | "ESTRUCTURA" | "FLUJO" | "METALES";
export const MESAS: { id: MesaId; nombre: string; detalle: string }[] = [
  { id: "TENDENCIA", nombre: "Mesa de tendencia", detalle: "Siguen la dirección: medias, MACD, Supertrend y líneas." },
  { id: "REVERSION", nombre: "Mesa de reversión", detalle: "Esperan la vuelta: RSI, bandas, soportes y Fibonacci." },
  { id: "ESTRUCTURA", nombre: "Mesa de estructura", detalle: "Leen rangos, barridas y huecos: rupturas, SMC y AMD." },
  { id: "FLUJO", nombre: "Mesa de flujo", detalle: "Leen la cinta: quién agrede, quién absorbe y dónde se barren los stops." },
  { id: "METALES", nombre: "Mesa de metales", detalle: "Solo oro y plata." },
];

const MESA_DE: Record<string, MesaId> = {
  CRUCE_EMA: "TENDENCIA", MACD: "TENDENCIA", SUPERTREND: "TENDENCIA", ST_VWAP: "TENDENCIA", ST_PERFIL: "TENDENCIA",
  ST_VWAP_PERFIL: "TENDENCIA", ST_MTF: "TENDENCIA", ST_MTF_VOL: "TENDENCIA", RETROCESO: "TENDENCIA", TENDENCIA_LINEA: "TENDENCIA",
  [ID_ST]: "TENDENCIA",
  RSI: "REVERSION", BOLLINGER: "REVERSION", SNR: "REVERSION", SNR_HTF: "REVERSION", FIB_NIVELES: "REVERSION",
  RUPTURA: "ESTRUCTURA", MACD_MTF_SNR: "ESTRUCTURA", SMC_LIQUIDEZ: "ESTRUCTURA", SMC_TODO: "ESTRUCTURA", AMD_IFVG: "ESTRUCTURA",
  ABSORCION: "FLUJO", ESFUERZO: "FLUJO", BARRIDA_VOL: "FLUJO", DELTA_DIV: "FLUJO", DELTA_ABSORBIDO: "FLUJO",
  METALES_D55: "METALES",
};
/** La mesa de un agente; uno nuevo sin mesa asignada va a estructura hasta que se le asigne (no se pierde). */
export const mesaDe = (id: string): MesaId => MESA_DE[id] ?? "ESTRUCTURA";

/** Una posición abierta, con el veredicto del mapa y el flujo al entrar (null si entró sin las dos fotos). */
export type Abierta = { symbol: string; lado: string; detectada: number; veredicto?: Veredicto | null };

export type Escritorio = {
  id: string;
  agente: string;
  mesa: MesaId;
  mira: string;
  /** Todo lo leído: acierto, PF y expectancia del registro, con su muestra. */
  total: Estadistica;
  /** Lo cerrado en los últimos 7 días. */
  semana: Estadistica;
  abiertas: Abierta[];
  /** Lo que aprendió de sus cierres: se recalcula con cada cierre; nunca cambia su regla. */
  lecciones: Leccion[];
  /** Lo que sabe y no sabe de sí mismo, según su muestra. */
  conciencia: string;
  /** PnL simulado: USD 1.000 y 1 % de riesgo fijo por operación (el mismo supuesto del registro). No es dinero real. */
  capital: Capital;
  /** La versión «con el mapa» (lib/confluencia.ts): sus cierres con veredicto que no estaba en contra. */
  conMapa: Estadistica;
  /** Los cierres que el mapa o el flujo tenían en contra: los que la versión con el mapa no habría tomado. */
  frenadas: Estadistica;
  /** Cuántas de sus entradas (abiertas o cerradas) tienen veredicto: las anteriores a la foto del flujo no lo tienen. */
  conVeredicto: number;
  /** Su regla en 4 h en el tramo de evaluación de su estudio (el pasado, con costos); null si no tiene. */
  historial: Historial | null;
};

/** El fondo simulado: la suma de los agentes, cada uno con su capital de papel. */
export type Fondo = {
  agentes: number;
  inicialUsd: number;
  actualUsd: number;
  netoUsd: number;
  retornoPct: number;
  maxCaidaUsd: number | null;
  maxCaidaPct: number | null;
  /** El capital del fondo después de cada cierre, en orden (recortado a 60 puntos). */
  curva: number[];
  cierres: number;
};

export type Oficina = {
  escritorios: Escritorio[];
  /** La reunión de la semana: los que cerraron algo, del mejor neto al peor. Sin propuestas automáticas. */
  reunion: Escritorio[];
  sinMovimiento: number;
  /** Se leyó el tope de entradas: lo más viejo puede faltar. */
  incompleta: boolean;
  /** Sin sesión o sin poder leer: los escritorios están, sin números (desconocido no es cero). */
  sinDatos: boolean;
  /** Lo que aprenden entre ellos: entradas acompañadas contra solitarias, con muestra mínima. */
  aprendizaje: Comparacion;
  /** Conversaciones entre agentes, armadas con sus datos. */
  conversaciones: Dialogo[];
  /** Los que tienen cierres, ordenados por el piso del intervalo de su acierto (premia la muestra, no la suerte). */
  ranking: Escritorio[];
  fondo: Fondo;
};

/** De qué agente es una entrada; null si la clave no tiene una forma conocida. */
export function agenteDeClave(clave: string): string | null {
  if (clave.startsWith("st:")) return ID_ST;
  if (clave.startsWith("sv:")) return leerClaveServidor(clave)?.estrategia ?? null;
  return leerClavePapel(clave)?.estrategia ?? null;
}

const leida = (f: FilaOficina): OperacionLeida => (f.desenlace === "ABIERTA" ? { r: null, abierta: true } : { r: f.r, abierta: false });

/** Los agentes que tienen escritorio: todos los del estudio salvo el control al azar, más el agente ST con filtro de régimen. */
export function plantel(conSt = true): { id: string; agente: string; mira: string }[] {
  const delEstudio = ESTRATEGIAS.filter((e) => e.id !== "AZAR").map((e) => ({ id: e.id as string, agente: e.agente, mira: explicadoDe(e.id)?.mira ?? e.nombre }));
  if (!conSt) return delEstudio;
  return [...delEstudio, { id: ID_ST, agente: "Agente Supertrend + régimen de BTC", mira: "La tendencia del Supertrend en varias temporalidades, con volumen, y solo si BTC acompaña." }];
}

/**
 * `plan`: CUENTA son tus agentes del navegador (con el agente ST); SERVIDOR, los que corren 24/7 en el Worker con velas de
 * Kraken (el agente ST no corre ahí: necesita las velas de BTC de Binance para su filtro).
 */
export function armarOficina(filas: FilaOficina[] | null, ahora: number, plan: "CUENTA" | "SERVIDOR" = "CUENTA"): Oficina {
  const por = new Map<string, FilaOficina[]>();
  for (const f of filas ?? []) {
    const id = agenteDeClave(f.clave);
    if (id) por.set(id, [...(por.get(id) ?? []), f]);
  }
  const desde = ahora - SEMANA_MS;
  const escritorios: Escritorio[] = plantel(plan === "CUENTA").map((p) => {
    const suyas = por.get(p.id) ?? [];
    const semana = suyas.filter((f) => f.desenlace !== "ABIERTA" && typeof f.cerrada === "number" && f.cerrada >= desde && f.cerrada <= ahora);
    const conteo = contar(suyas.map(leida));
    const total = estadistica(conteo);
    const cierresSuyos = suyas.flatMap((f) => (f.desenlace !== "ABIERTA" && typeof f.r === "number" && Number.isFinite(f.r) && typeof f.cerrada === "number" ? [{ r: f.r, cerradaA: f.cerrada, abiertaA: f.detectada }] : []));
    const lecciones = leccionesDe(suyas);
    const veredictos = new Map(suyas.map((f) => [f, veredictoDeFoto(f.foto)] as const));
    const cerradasV = suyas.filter((f) => f.desenlace !== "ABIERTA" && veredictos.get(f) !== null);
    return {
      ...p,
      conMapa: estadistica(contar(cerradasV.filter((f) => entraConMapa(veredictos.get(f) ?? null)).map(leida))),
      frenadas: estadistica(contar(cerradasV.filter((f) => veredictos.get(f) === "EN_CONTRA").map(leida))),
      conVeredicto: suyas.filter((f) => veredictos.get(f) !== null).length,
      historial: historialDe(p.id),
      mesa: mesaDe(p.id),
      total,
      semana: estadistica(contar(semana.map(leida))),
      abiertas: suyas.filter((f) => f.desenlace === "ABIERTA").map((f) => ({ symbol: f.symbol, lado: f.lado, detectada: f.detectada, veredicto: veredictos.get(f) ?? null })),
      lecciones,
      conciencia: agentePausado(p.id) ? `Estoy en pausa: ${AGENTES_PAUSADOS[p.id]}. No abro operaciones nuevas; lo que tenía abierto se cierra con mi regla. Volver a activarme lo decide la persona. ${concienciaDe(p.agente, mesaDe(p.id), total, lecciones)}` : concienciaDe(p.agente, mesaDe(p.id), total, lecciones),
      capital: simularCapital(conteo, cierresSuyos, suyas.length ? Math.min(...suyas.map((f) => f.detectada)) : null),
    };
  });
  const reunion = escritorios.filter((e) => e.semana.cerradas > 0).sort((a, b) => b.semana.neto - a.semana.neto || a.agente.localeCompare(b.agente));
  const conConsenso: ResultadoConsenso[] = [];
  for (const f of filas ?? []) {
    if (f.desenlace === "ABIERTA" || typeof f.r !== "number" || !Number.isFinite(f.r) || f.clave.startsWith("st:")) continue;
    const acuerdo = acuerdoDe(f.foto);
    if (acuerdo !== null) conConsenso.push({ acuerdo, r: f.r });
  }
  const ranking = escritorios
    .filter((e) => e.total.cerradas > 0)
    .sort((a, b) => (b.total.intervalo?.low ?? 0) - (a.total.intervalo?.low ?? 0) || b.total.cerradas - a.total.cerradas);
  return {
    fondo: fondoDe(escritorios, filas ?? []),
    conversaciones: filas === null ? [] : conversaciones(escritorios),
    ranking,
    aprendizaje: compararConsenso(conConsenso),
    escritorios,
    reunion,
    sinMovimiento: escritorios.length - reunion.length,
    incompleta: (filas?.length ?? 0) >= LIMITE_OFICINA,
    sinDatos: filas === null,
  };
}

/** Cómo se nombra un activo en la oficina: los metales por su nombre, la cripto por su ticker. */
export const nombreActivo = (symbol: string): string => (symbol === "XAUUSDT" ? "Oro" : symbol === "XAGUSDT" ? "Plata" : symbol === "PAXGUSDT" ? "Oro (PAXG)" : symbol.replace(/USDT$/, ""));


const lado = (l: string) => (l === "LONG" ? "largo" : "corto");
const r2 = (v: number) => `${v > 0 ? "+" : ""}${(Math.round(v * 100) / 100 || 0).toFixed(2).replace(".", ",")} R`;
const corto = (agente: string) => agente.replace(/^Agente\s+/, "");

export type Frase = { quien: string; nombre: string; texto: string; tipo: "posicion" | "acuerdo" | "debate" | "resultado" | "aprendizaje" };

/** Lo que dicen en la oficina. Cada frase sale de un dato; ninguna inventa números ni opiniones. */
export function charla(o: Oficina): Frase[] {
  const out: Frase[] = [];
  const porActivo = new Map<string, { e: Escritorio; lado: string; v: Veredicto | null }[]>();
  for (const e of o.escritorios)
    for (const a of e.abiertas) porActivo.set(a.symbol, [...(porActivo.get(a.symbol) ?? []), { e, lado: a.lado, v: a.veredicto ?? null }]);
  for (const [symbol, quienes] of porActivo) {
    const activo = nombreActivo(symbol);
    for (const l of ["LONG", "SHORT"]) {
      const mismos = [...new Map(quienes.filter((q) => q.lado === l).map((q) => [q.e.id, q.e])).values()];
      if (mismos.length >= 2)
        out.push({ quien: mismos[0].id, nombre: corto(mismos[0].agente), tipo: "acuerdo", texto: `Coincido con ${mismos.slice(1, 3).map((x) => corto(x.agente)).join(" y ")}${mismos.length > 3 ? ` y ${mismos.length - 3} más` : ""}: ${activo} ${lado(l)}.` });
      else if (mismos.length === 1) {
        const v = quienes.find((q) => q.e.id === mismos[0].id && q.lado === l)?.v ?? null;
        const conMapa = v === "A_FAVOR" ? ", con el mapa y el flujo a favor" : v === "EN_CONTRA" ? ": el mapa o el flujo estaban en contra, con el mapa no entraba" : v === "NEUTRA" ? ", con el mapa neutro" : "";
        out.push({ quien: mismos[0].id, nombre: corto(mismos[0].agente), tipo: "posicion", texto: `Tengo ${activo} ${lado(l)} abierto${conMapa}.` });
      }
    }
    const largos = quienes.filter((q) => q.lado === "LONG");
    const cortos = quienes.filter((q) => q.lado === "SHORT");
    if (largos.length && cortos.length)
      out.push({ quien: largos[0].e.id, nombre: corto(largos[0].e.agente), tipo: "debate", texto: `En ${activo} voy largo y ${corto(cortos[0].e.agente)} va corto: uno de los dos se equivoca, lo dirá el cierre.` });
  }
  for (const e of o.escritorios) {
    const t = e.total;
    if (t.cerradas === 0) continue;
    const texto =
      t.cerradas < MUESTRA_MINIMA
        ? `Llevo ${t.cerradas} ${t.cerradas === 1 ? "cierre" : "cierres"} (${r2(t.neto)}): con menos de ${MUESTRA_MINIMA} todavía no sé nada.`
        : t.expectancia !== null && t.expectancia < 0
          ? `Con ${t.cerradas} cierres pierdo ${r2(t.expectancia)} por operación. Que me revisen: mi regla no la cambio yo.`
          : `Con ${t.cerradas} cierres voy ${r2(t.expectancia ?? 0)} por operación. Sigo con mi regla, sin tocarla.`;
    out.push({ quien: e.id, nombre: corto(e.agente), tipo: "resultado", texto });
  }
  out.push({ quien: "JARVIS", nombre: "JARVIS", tipo: "aprendizaje", texto: `Lo que aprendemos juntos: ${o.aprendizaje.texto}` });
  return out;
}

export type Propuesta = { quien: string; agente: string; texto: string };

/**
 * Las propuestas de la reunión, para que las decida la persona. Solo con muestra suficiente; con menos, seguir midiendo.
 * Ninguna se aplica sola: pausar, revisar o cambiar una regla es una decisión humana (y un cambio de regla, un PR revisado).
 */
export function propuestas(o: Oficina): Propuesta[] {
  const out: Propuesta[] = [];
  for (const e of o.escritorios) {
    const t = e.total;
    if (t.cerradas < MUESTRA_MINIMA || t.expectancia === null) continue;
    if (t.expectancia < 0) out.push({ quien: e.id, agente: e.agente, texto: `Pierde ${r2(t.expectancia)} por operación con ${t.cerradas} cierres: revisar o pausar en papel.` });
    else out.push({ quien: e.id, agente: e.agente, texto: `Gana ${r2(t.expectancia)} por operación con ${t.cerradas} cierres: seguir midiendo hacia adelante antes de confiar.` });
  }
  if (!o.aprendizaje.muestraMinima && o.aprendizaje.diferencia !== null)
    out.push({ quien: "JARVIS", agente: "JARVIS", texto: `Coincidir ${o.aprendizaje.diferencia > 0 ? "mejoró" : "empeoró"} el resultado en ${r2(Math.abs(o.aprendizaje.diferencia))} por operación. Si querés probarlo como filtro, va por el laboratorio en sombra.` });
  return out;
}

/** Cómo se nombra el mejor de la semana sin mentir: si todos perdieron, es el que menos perdió. */
export function tituloSemana(e: Escritorio): string {
  return e.semana.neto > 0 ? "Mejor neto" : e.semana.neto === 0 ? "Nadie ganó; empató" : "Nadie ganó esta semana; el que menos perdió";
}

// ── Para hablar con la oficina desde JARVIS y Telegram: lo mismo que muestra la pantalla, compacto y con los números en formato argentino ──

/** Lo que recibe la IA: escritorios con actividad, la charla, lo que aprenden y las propuestas. Los números ya formateados (forAi). */
export function oficinaParaIa(o: Oficina, plan: "CUENTA" | "SERVIDOR") {
  const activos = o.escritorios.filter((e) => e.total.cerradas > 0 || e.abiertas.length > 0);
  return forAi({
    plan: plan === "SERVIDOR" ? "servidor 24/7, velas de Kraken, papel" : "tu cuenta, en el navegador, papel",
    sinDatos: o.sinDatos,
    agentesSinActividad: o.escritorios.length - activos.length,
    escritorios: activos.slice(0, 20).map((e) => ({
      agente: e.agente,
      cerradas: e.total.cerradas,
      aciertoPct: e.total.winRate === null ? null : Math.round(e.total.winRate * 1000) / 10,
      aciertoIc90Pct: e.total.intervalo ? [Math.round(e.total.intervalo.low * 1000) / 10, Math.round(e.total.intervalo.high * 1000) / 10] : null,
      netoR: Math.round(e.total.neto * 100) / 100,
      pnlSimuladoUsd: Math.round(e.capital.netoUsd * 100) / 100,
      rPorOperacion: e.total.expectancia === null ? null : Math.round(e.total.expectancia * 1000) / 1000,
      muestra: e.total.muestra === "MINIMA" ? "muestra mínima (menos de 15)" : e.total.muestra === "SIN DATOS" ? "sin cierres" : "razonable",
      abiertas: e.abiertas.map((a) => `${nombreActivo(a.symbol)} ${a.lado === "LONG" ? "largo" : "corto"}`),
      lecciones: e.lecciones.map((l) => `${l.texto}${l.firme ? " (firme)" : ""}`),
      comoSeVe: e.conciencia,
      profitFactor: e.total.profitFactor === null ? null : Math.round(e.total.profitFactor * 100) / 100,
      conElMapa: { cerradas: e.conMapa.cerradas, aciertoPct: e.conMapa.winRate === null ? null : Math.round(e.conMapa.winRate * 1000) / 10, profitFactor: e.conMapa.profitFactor === null ? null : Math.round(e.conMapa.profitFactor * 100) / 100, rPorOperacion: e.conMapa.expectancia === null ? null : Math.round(e.conMapa.expectancia * 1000) / 1000 },
      frenadasPorElMapa: { cerradas: e.frenadas.cerradas, rPorOperacion: e.frenadas.expectancia === null ? null : Math.round(e.frenadas.expectancia * 1000) / 1000 },
      historial4h: textoHistorial(e.historial),
    })),
    operativaConElMapa: "Cada agente se mide dos veces: con su regla sola y con el mapa (no entra si el mapa de liquidaciones o el flujo de órdenes estaban en contra al entrar). Las dos sobre las mismas entradas; la comparación vale recién con 15 cierres de cada lado.",
    conversaciones: o.conversaciones.map((d) => `${d.tema}: ${d.lineas.map((l) => `${l.nombre}: ${l.texto}`).join(" / ")}`),
    charla: charla(o).slice(0, 12).map((f) => `${f.nombre}: ${f.texto}`),
    aprendizaje: o.aprendizaje.texto,
    fondoSimulado: { agentes: o.fondo.agentes, capitalInicialUsd: o.fondo.inicialUsd, capitalActualUsd: Math.round(o.fondo.actualUsd * 100) / 100, pnlUsd: Math.round(o.fondo.netoUsd * 100) / 100, retornoPct: Math.round(o.fondo.retornoPct * 100) / 100, caidaMaximaPct: o.fondo.maxCaidaPct === null ? null : Math.round(o.fondo.maxCaidaPct * 100) / 100, supuesto: "USD 1.000 por agente y 1 % de riesgo fijo por operación; es papel, no dinero real" },
    propuestas: propuestas(o).map((p) => `${corto(p.agente)}: ${p.texto}`),
    regla: "Cada agente decide solo con su regla fija. Nada se cambia ni se pausa sin que la persona lo apruebe. Es papel, no asesoramiento financiero.",
  });
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const sinAcento = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** /oficina en Telegram: en directo, la reunión de la semana, lo que aprenden y las propuestas. */
export function textoOficinaTelegram(o: Oficina, estado: { error: string | null }[] = []): string {
  if (o.sinDatos) return "🏢 No pude leer la oficina ahora: sin datos (no es cero). Probá en un rato.";
  const fallas = estado.filter((e) => e.error).length;
  const directo = o.escritorios.flatMap((e) => e.abiertas.map((a) => `• ${esc(corto(e.agente))} · ${nombreActivo(a.symbol)} ${a.lado === "LONG" ? "▲" : "▼"}`));
  const mejor = o.reunion[0];
  const partes = [
    "🏢 <b>Oficina del fondo · servidor 24/7</b>\n<i>Velas de Kraken, papel. Cada agente con su regla fija.</i>",
    directo.length ? `<b>En directo</b>\n${directo.slice(0, 10).join("\n")}${directo.length > 10 ? `\n… y ${directo.length - 10} más` : ""}` : "<b>En directo</b>\nSin posiciones abiertas.",
    mejor
      ? `<b>Reunión de la semana</b>\n${tituloSemana(mejor)}: ${esc(corto(mejor.agente))}, ${r2(mejor.semana.neto)} con ${mejor.semana.cerradas} ${mejor.semana.cerradas === 1 ? "cierre" : "cierres"}${mejor.semana.muestra === "MINIMA" ? " (muestra mínima)" : ""}.`
      : "<b>Reunión de la semana</b>\nNadie cerró en 7 días.",
    o.ranking.length
      ? `<b>Acierto de cada uno</b> (ordenado por el piso del intervalo)\n${o.ranking.slice(0, 8).map((e) => `• ${esc(corto(e.agente))}: ${e.total.winRate === null ? "—" : `${Math.round(e.total.winRate * 100)} %`} · n=${e.total.cerradas}${e.total.muestra === "MINIMA" ? " (muestra mínima)" : ""} · ${r2(e.total.expectancia ?? 0)} por op.`).join("\n")}`
      : "<b>Acierto de cada uno</b>\nNadie cerró todavía.",
    `<b>Lo que aprenden</b>\n${esc(o.aprendizaje.texto)}`,
    `<b>Fondo simulado</b>\n${usdTxt(o.fondo.inicialUsd)} → ${usdTxt(o.fondo.actualUsd)} (${usdTxt(o.fondo.netoUsd, true)}, ${o.fondo.retornoPct >= 0 ? "+" : ""}${o.fondo.retornoPct.toFixed(2).replace(".", ",")} %) con ${o.fondo.cierres} cierres.\n<i>USD 1.000 por agente y 1 % de riesgo por operación: es papel, no dinero real.</i>`,
  ];
  const props = propuestas(o);
  partes.push(props.length ? `<b>Propuestas para vos</b>\n${props.map((p) => `• ${esc(corto(p.agente))}: ${esc(p.texto)}`).join("\n")}` : "<b>Propuestas</b>\nNingún agente llegó a 15 cierres: seguir midiendo.");
  if (fallas) partes.push(`<i>En la última vuelta, ${fallas} ${fallas === 1 ? "moneda no respondió" : "monedas no respondieron"} en Kraken.</i>`);
  partes.push("Hablá con uno: /agente nombre (ej. /agente amd). <i>No es asesoramiento financiero.</i>");
  return partes.join("\n\n");
}

/** Busca un agente por una parte de su nombre, sin importar acentos ni mayúsculas. */
export function buscarAgente(o: Oficina, nombre: string): Escritorio | null {
  const q = sinAcento(nombre.trim());
  if (!q) return null;
  return o.escritorios.find((e) => sinAcento(corto(e.agente)) === q) ?? o.escritorios.find((e) => sinAcento(e.agente).includes(q) || sinAcento(e.id).includes(q)) ?? null;
}

/** /agente nombre en Telegram: su ficha y lo que dice, con su muestra. */
export function textoAgenteTelegram(o: Oficina, nombre: string): string {
  const e = buscarAgente(o, nombre);
  if (!e) return `No encontré ese agente. Están: ${o.escritorios.map((x) => esc(corto(x.agente))).join(", ")}.`;
  const t = e.total;
  const dice = charla(o).filter((f) => f.quien === e.id).map((f) => `«${esc(f.texto)}»`);
  return [
    `🧑‍💼 <b>${esc(e.agente)}</b> · ${MESAS.find((m) => m.id === e.mesa)?.nombre ?? ""}`,
    esc(e.mira),
    t.cerradas
      ? `Cerradas: ${t.cerradas} · acierto ${t.winRate === null ? "—" : `${Math.round(t.winRate * 100)} %`}${t.muestra === "MINIMA" ? " (muestra mínima)" : ""} · ${r2(t.expectancia ?? 0)} por operación · neto ${r2(t.neto)}`
      : "Todavía sin cierres.",
    `PnL simulado: ${usdTxt(e.capital.netoUsd, true)} (${usdTxt(e.capital.inicialUsd)} → ${usdTxt(e.capital.actualUsd)})`,
    e.conMapa.cerradas || e.frenadas.cerradas
      ? `Con el mapa: ${e.conMapa.cerradas} cierres · acierto ${e.conMapa.winRate === null ? "—" : `${Math.round(e.conMapa.winRate * 100)} %`} · PF ${e.conMapa.profitFactor === null ? "—" : e.conMapa.profitFactor.toFixed(2).replace(".", ",")}. Frenadas por el mapa: ${e.frenadas.cerradas}.`
      : "Con el mapa: todavía sin cierres con las dos fotos.",
    `Historial 4 h: ${esc(textoHistorial(e.historial))}`,
    e.abiertas.length ? `Abiertas: ${e.abiertas.map((a) => `${nombreActivo(a.symbol)} ${a.lado === "LONG" ? "▲" : "▼"}`).join(" · ")}` : "Sin posiciones abiertas.",
    ...dice,
    `<b>Cómo se ve</b>\n${esc(e.conciencia)}`,
    ...(e.lecciones.length ? [`<b>Lo que aprendió</b>\n${e.lecciones.map((l) => `• ${esc(l.texto)}${l.firme ? " (firme)" : ""}`).join("\n")}`] : []),
    "<i>Papel, servidor 24/7, velas de Kraken. No es asesoramiento financiero.</i>",
  ].join("\n");
}

const PUNTOS_FONDO = 60;

/**
 * El fondo simulado: cada agente arranca con CAPITAL_INICIAL_USD y arriesga RIESGO_POR_OPERACION_PCT fijo, como en el registro.
 * La curva suma los cierres de todos en el orden en que cerraron. Es papel: sirve para comparar, no es dinero real.
 */
export function fondoDe(escritorios: Escritorio[], filas: FilaOficina[]): Fondo {
  const ids = new Set(escritorios.map((e) => e.id));
  const riesgoUsd = (CAPITAL_INICIAL_USD * RIESGO_POR_OPERACION_PCT) / 100;
  const inicialUsd = escritorios.length * CAPITAL_INICIAL_USD;
  const cierres = filas
    .filter((f) => f.desenlace !== "ABIERTA" && typeof f.r === "number" && Number.isFinite(f.r) && typeof f.cerrada === "number" && ids.has(agenteDeClave(f.clave) ?? ""))
    .sort((a, b) => (a.cerrada as number) - (b.cerrada as number));
  const puntos = [inicialUsd];
  let eq = inicialUsd;
  let pico = inicialUsd;
  let maxCaidaUsd: number | null = cierres.length ? 0 : null;
  let maxCaidaPct: number | null = cierres.length ? 0 : null;
  for (const c of cierres) {
    eq += (c.r as number) * riesgoUsd;
    puntos.push(eq);
    pico = Math.max(pico, eq);
    if (pico - eq > (maxCaidaUsd ?? 0)) {
      maxCaidaUsd = pico - eq;
      maxCaidaPct = pico > 0 ? ((pico - eq) / pico) * 100 : null;
    }
  }
  const paso = puntos.length > PUNTOS_FONDO ? (puntos.length - 1) / (PUNTOS_FONDO - 1) : 1;
  const curva = puntos.length > PUNTOS_FONDO ? Array.from({ length: PUNTOS_FONDO }, (_, i) => puntos[Math.round(i * paso)]) : puntos;
  const netoUsd = escritorios.reduce((a, e) => a + e.capital.netoUsd, 0);
  return {
    agentes: escritorios.length,
    inicialUsd,
    actualUsd: inicialUsd + netoUsd,
    netoUsd,
    retornoPct: inicialUsd > 0 ? (netoUsd / inicialUsd) * 100 : 0,
    maxCaidaUsd,
    maxCaidaPct,
    curva,
    cierres: cierres.length,
  };
}

/** Dólares simulados en formato argentino, con signo cuando es un resultado. */
export const usdTxt = (v: number, signo = false) => `${signo && v > 0 ? "+" : v < 0 ? "−" : ""}USD ${Math.abs(v).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
