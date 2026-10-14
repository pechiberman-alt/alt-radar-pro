/**
 * AI TRADING LAB: la foto del laboratorio armada con lo que la app ya tiene (la araña en vivo, el backtest, el papel,
 * el registro y el gestor de riesgo). Dice en qué estado está el motor de la araña según lo que corre de verdad, qué
 * tareas hay, qué hace cada agente (roles con entradas, salidas, estado y errores) y qué falta. Nada se inventa: sin
 * dato de avance, el avance es indeterminado. Pura: lib/lab-run.ts y la pantalla le pasan los datos.
 */
import type { VivoSnapshot } from "./arana-vivo.ts";
import type { Evaluacion } from "./lab-evaluacion.ts";
import type { EstadoCartera, LimitesRiesgo } from "./lab-riesgo.ts";
import { lineaFuente } from "./registro.ts";

export type EstadoMotor = "idle" | "initializing" | "scanning" | "processing" | "paused" | "completed" | "error" | "unavailable";

export const ESTADO_TEXTO: Record<EstadoMotor, string> = {
  idle: "en reposo",
  initializing: "iniciando",
  scanning: "escaneando el mercado",
  processing: "procesando un backtest",
  paused: "en pausa",
  completed: "análisis completo",
  error: "con error",
  unavailable: "sin conexión",
};

export type ActividadLab = { cuando: number; texto: string; tono: "ok" | "aviso" | "error" | "info" };

export type FotoLab = {
  ahora: number;
  enLinea: boolean;
  vivo: VivoSnapshot | null;
  /** Backtest corriendo ahora, con su avance real; null si no hay ninguno. */
  backtestEnCurso: { hechos: number; total: number } | null;
  /** Estado del escaneo automático de la araña (pausado lo pone la persona). */
  autoPausado: boolean;
  /** El último error de una tarea del laboratorio, si lo hubo y no se resolvió. */
  ultimoError: string | null;
  evaluacion: Evaluacion | null;
  limites: Readonly<LimitesRiesgo>;
  cartera: EstadoCartera;
  actividad: ActividadLab[];
};

export type EstadoTarea = "corriendo" | "en espera" | "hecha" | "sin datos" | "error";
export type Tarea = { id: string; nombre: string; estado: EstadoTarea; progreso: number | null; detalle: string };

export type Centro = {
  estado: EstadoMotor;
  texto: string;
  /** 0 a 1 cuando se conoce; null = indeterminado. */
  progreso: number | null;
  tareas: Tarea[];
  errores: string[];
  avisos: string[];
  actividad: ActividadLab[];
};

const ESCANEO_RECIENTE_MIN = 60;

/** El estado del motor, en el orden en que manda cada señal real. */
export function estadoMotor(f: FotoLab): { estado: EstadoMotor; progreso: number | null } {
  if (!f.enLinea) return { estado: "unavailable", progreso: null };
  if (!f.vivo) return { estado: "initializing", progreso: null };
  if (f.backtestEnCurso) {
    const { hechos, total } = f.backtestEnCurso;
    return { estado: "processing", progreso: total > 0 ? Math.min(1, Math.max(0, hechos / total)) : null };
  }
  if (f.vivo.escaneo.estado === "escaneando") {
    const p = f.vivo.escaneo.progreso;
    return { estado: "scanning", progreso: typeof p === "number" && Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : null };
  }
  if (f.ultimoError) return { estado: "error", progreso: null };
  if (f.autoPausado) return { estado: "paused", progreso: null };
  const hace = f.vivo.escaneo.haceMin;
  if ((f.vivo.escaneo.estado === "listo" || f.vivo.escaneo.estado === "parcial") && hace !== null && hace < ESCANEO_RECIENTE_MIN) return { estado: "completed", progreso: 1 };
  return { estado: "idle", progreso: null };
}

export function tareasDe(f: FotoLab): Tarea[] {
  const v = f.vivo;
  const tareas: Tarea[] = [];
  if (!v) {
    tareas.push({ id: "escaneo", nombre: "Escaneo de mercado", estado: "sin datos", progreso: null, detalle: "Todavía no hay lectura de la araña." });
  } else {
    const e = v.escaneo;
    const corriendo = e.estado === "escaneando";
    tareas.push({
      id: "escaneo",
      nombre: "Escaneo de mercado",
      estado: corriendo ? "corriendo" : e.estado === "sin datos" ? "sin datos" : "hecha",
      progreso: corriendo && typeof e.progreso === "number" ? Math.min(1, Math.max(0, e.progreso)) : e.estado === "sin datos" ? null : corriendo ? null : 1,
      detalle: corriendo
        ? `${e.leidas ?? 0} monedas leídas hasta ahora.`
        : e.estado === "sin datos"
          ? "Sin escaneo todavía."
          : `${e.leidas ?? 0} monedas leídas, ${e.aprobadas ?? 0} con plan aprobado${e.haceMin !== null ? `, hace ${e.haceMin} min` : ""}.`,
    });
  }
  const bt = f.backtestEnCurso;
  tareas.push({
    id: "backtest",
    nombre: "Backtest de la mesa",
    estado: bt ? "corriendo" : f.evaluacion ? "hecha" : "en espera",
    progreso: bt ? (bt.total > 0 ? Math.min(1, bt.hechos / bt.total) : null) : f.evaluacion ? 1 : null,
    detalle: bt ? `${bt.hechos} de ${bt.total} pasos.` : f.evaluacion ? `${f.evaluacion.symbol.replace(/USDT$/, "")}: ${f.evaluacion.desarrollo.operaciones + f.evaluacion.evaluacion.operaciones} operaciones cerradas.` : "No se corrió ninguno en esta sesión.",
  });
  tareas.push({
    id: "papel",
    nombre: "Seguimiento de papel",
    estado: !v ? "sin datos" : v.papel.abiertas > 0 ? "corriendo" : "en espera",
    progreso: null,
    detalle: !v ? "Sin datos." : `${v.papel.abiertas} abiertas, ${v.papel.cerradas} cerradas.`,
  });
  tareas.push({
    id: "riesgo",
    nombre: "Gestor de riesgo",
    estado: f.cartera.suspendida ? "error" : "corriendo",
    progreso: null,
    detalle: f.cartera.suspendida ? `Operaciones nuevas suspendidas: ${f.cartera.motivoSuspension}.` : `${f.cartera.abiertas} de ${f.limites.maxPosiciones} posiciones; pérdida de hoy ${f.cartera.perdidaHoyR.toFixed(2).replace(".", ",")} R.`,
  });
  if (v?.sombra) {
    tareas.push({
      id: "sombra",
      nombre: "Laboratorio en sombra",
      estado: v.sombra.error ? "error" : v.sombra.corriendo ? "corriendo" : v.sombra.modo === "cuenta" ? "en espera" : "sin datos",
      progreso: null,
      detalle: v.sombra.error ?? v.sombra.aviso ?? (v.sombra.modo === "sin sesión" ? "Necesita sesión iniciada." : "Mide variantes de filtro hacia adelante."),
    });
  }
  if (v?.vigilancia) {
    tareas.push({
      id: "vigilancia",
      nombre: "Vigilancia",
      estado: v.vigilancia.errores > 0 ? "error" : v.vigilancia.haceMin === null ? "sin datos" : "corriendo",
      progreso: null,
      detalle: v.vigilancia.errores > 0 ? `${v.vigilancia.errores} error(es) al leer datos.` : v.vigilancia.haceMin === null ? "Todavía no leyó nada." : `Última lectura hace ${v.vigilancia.haceMin} min.`,
    });
  }
  return tareas;
}

export function centroDe(f: FotoLab): Centro {
  const { estado, progreso } = estadoMotor(f);
  const errores: string[] = [];
  const avisos: string[] = [];
  if (!f.enLinea) errores.push("Sin conexión: no se leen precios y no se generan operaciones simuladas.");
  if (f.ultimoError) errores.push(f.ultimoError);
  if (f.vivo?.sombra?.error) errores.push(`Laboratorio en sombra: ${f.vivo.sombra.error}`);
  if (f.vivo?.vigilancia && f.vivo.vigilancia.errores > 0) avisos.push(`La vigilancia tuvo ${f.vivo.vigilancia.errores} error(es) al leer datos.`);
  if (f.cartera.suspendida) avisos.push(`Riesgo: operaciones nuevas suspendidas (${f.cartera.motivoSuspension}).`);
  for (const a of f.vivo?.avisos ?? []) avisos.push(a);
  const actividad: ActividadLab[] = [
    ...f.actividad,
    ...(f.vivo?.cinta ?? []).map((c) => ({ cuando: c.cuando, texto: c.texto, tono: c.tono === "malo" ? ("error" as const) : c.tono === "ok" ? ("ok" as const) : ("info" as const) })),
  ]
    .sort((a, b) => b.cuando - a.cuando)
    .slice(0, 40);
  return { estado, texto: ESTADO_TEXTO[estado], progreso, tareas: tareasDe(f), errores, avisos, actividad };
}

export type EstadoAgente = "activo" | "implementado" | "sin datos" | "error";

export type AgenteLab = {
  id: string;
  nombre: string;
  rol: string;
  entradas: string[];
  salidas: string[];
  modulos: string[];
  estado: EstadoAgente;
  detalle: string;
  /** Lo que el rol pide y todavía no está hecho. */
  pendiente: string[];
  errores: string[];
};

function porEspecialistas(v: VivoSnapshot | null, ids: string[]): { estado: EstadoAgente; detalle: string } {
  if (!v) return { estado: "sin datos", detalle: "Sin lectura de la araña todavía." };
  const filas = v.especialistas.filter((e) => ids.includes(e.id));
  const con = filas.filter((e) => e.disponibles > 0);
  if (!filas.length || filas.every((e) => e.de === 0)) return { estado: "implementado", detalle: "Listo; ningún escaneo lo usó todavía." };
  return {
    estado: con.length ? "activo" : "sin datos",
    detalle: filas.map((e) => `${e.id}: datos en ${e.disponibles} de ${e.de}`).join(" · "),
  };
}

/** Los agentes del laboratorio: roles que usan módulos que ya existen, con su estado según lo que corrió. */
export function agentesDe(f: FotoLab): AgenteLab[] {
  const v = f.vivo;
  const mercado = porEspecialistas(v, ["estructura", "correlacion", "volatilidad", "macro"]);
  const tecnico = porEspecialistas(v, ["tecnico"]);
  const liquidez = porEspecialistas(v, ["volumen", "liquidaciones", "derivados"]);
  const hayRegistro = Boolean(v?.registro);
  return [
    {
      id: "market",
      nombre: "Market Analyst",
      rol: "Tendencia, estructura y contexto temporal (1 h, 4 h, 1 d), correlación con BTC, volatilidad y macro.",
      entradas: ["Velas cerradas de 1 h, 4 h y 1 d", "BTC y ETH de referencia", "Calendario macro"],
      salidas: ["Sesgo de −1 a +1 por especialista", "Régimen de volatilidad"],
      modulos: ["lib/jarvis-desk-agents.ts", "lib/jarvis-analyst.ts"],
      ...mercado,
      pendiente: [],
      errores: [],
    },
    {
      id: "technical",
      nombre: "Technical Analyst",
      rol: "Indicadores, patrones y confirmaciones.",
      entradas: ["Velas cerradas", "Osciladores (RSI y otros)"],
      salidas: ["Sesgo técnico de −1 a +1", "Niveles"],
      modulos: ["lib/jarvis-desk-agents.ts", "lib/oscillators.ts", "lib/level-engine.ts"],
      ...tecnico,
      pendiente: [],
      errores: [],
    },
    {
      id: "liquidity",
      nombre: "Liquidity Analyst",
      rol: "Volumen, liquidaciones, derivados y flujo de órdenes cuando hay datos.",
      entradas: ["Volumen", "Mapa de liquidaciones", "Funding e interés abierto", "Libro de órdenes (en la pantalla de flujo)"],
      salidas: ["Sesgos de volumen, liquidaciones y derivados", "Lecturas de flujo con plan (PLAN_FLUJO_1)"],
      modulos: ["lib/jarvis-desk-agents.ts", "lib/order-flow-brain.ts", "lib/flujo.ts"],
      ...liquidez,
      pendiente: ["Sin historia de derivados ni de flujo: en el backtest esos datos pesan cero."],
      errores: [],
    },
    {
      id: "researcher",
      nombre: "Strategy Researcher",
      rol: "Compara estrategias con su muestra, mide backtests en DESARROLLO y EVALUACIÓN y mide variantes en sombra.",
      entradas: ["Registro unificado", "Backtest de la mesa", "Variantes del laboratorio en sombra"],
      salidas: ["Comparación con muestra e intervalo", "Evaluación por tramo", "Variantes medidas que esperan tu aprobación"],
      modulos: ["lib/registro.ts", "lib/jarvis-backtest.ts", "lib/lab-evaluacion.ts", "lib/mesa-sombra.ts"],
      estado: f.backtestEnCurso || v?.sombra?.corriendo ? "activo" : hayRegistro || f.evaluacion ? "implementado" : "sin datos",
      detalle: f.evaluacion ? `Última evaluación: ${f.evaluacion.symbol.replace(/USDT$/, "")}.` : hayRegistro ? "Registro leído; sin backtest en esta sesión." : "Sin datos todavía.",
      pendiente: ["Proponer estrategias nuevas con IA: no implementado. Las variantes salen de una lista fija y las aprueba la persona."],
      errores: v?.sombra?.error ? [v.sombra.error] : [],
    },
    {
      id: "risk",
      nombre: "Risk Manager",
      rol: "Revisa cada plan (R:R, apalancamiento, liquidación) y la cartera simulada; rechaza lo que pasa los límites.",
      entradas: ["Plan de la mesa", "Operaciones de papel", "Límites configurados"],
      salidas: ["Aprobado o rechazado con motivo", "Suspensión de operaciones nuevas"],
      modulos: ["lib/jarvis-desk.ts (reviewRisk)", "lib/lab-riesgo.ts"],
      estado: "activo",
      detalle: f.cartera.suspendida ? `Suspendido: ${f.cartera.motivoSuspension}.` : `Compuerta activa: ${f.cartera.abiertas} de ${f.limites.maxPosiciones} posiciones.`,
      pendiente: [],
      errores: [],
    },
    {
      id: "arana",
      nombre: "La Araña",
      rol: "Supervisa tareas, resultados, anomalías y trazabilidad.",
      entradas: ["Escaneo", "Papel", "Backtest", "Vigilancia", "Laboratorio en sombra", "Registro"],
      salidas: ["Estado del motor", "Tareas", "Registro de actividad", "Errores y avisos"],
      modulos: ["lib/arana-vivo.ts", "lib/lab.ts"],
      estado: v ? "activo" : "sin datos",
      detalle: v ? ESTADO_TEXTO[estadoMotor(f).estado] : "Esperando la primera foto.",
      pendiente: [],
      errores: f.ultimoError ? [f.ultimoError] : [],
    },
    {
      id: "jarvis",
      nombre: "Jarvis",
      rol: "Explica los resultados del laboratorio en palabras.",
      entradas: ["Esta misma foto del laboratorio"],
      salidas: ["Respuestas con datos y su muestra"],
      modulos: ["lib/lab-jarvis.ts", "lib/jarvis-local.ts", "lib/ai-cascade.ts"],
      estado: "implementado",
      detalle: "Las preguntas del laboratorio las responde el motor local con estos datos; el resto va a la cascada de IA si hay sesión.",
      pendiente: ["Memoria de laboratorio entre sesiones: no implementada."],
      errores: [],
    },
  ];
}

/** Lo que reciben las IAs sobre el laboratorio: corto y con los números ya en texto. */
export function labParaIa(f: FotoLab) {
  const c = centroDe(f);
  return {
    aviso: "Laboratorio de simulación: nada opera con dinero real. Resultados pasados no garantizan nada.",
    motor: c.texto,
    tareas: c.tareas.map((t) => `${t.nombre}: ${t.estado} — ${t.detalle}`),
    agentes: agentesDe(f).map((a) => `${a.nombre}: ${a.estado}`),
    riesgo: f.cartera.suspendida ? `suspendido: ${f.cartera.motivoSuspension}` : `${f.cartera.abiertas} de ${f.limites.maxPosiciones} posiciones`,
    registro: f.vivo?.registro ? f.vivo.registro.fuentes.map(lineaFuente) : null,
    evaluacion: f.evaluacion
      ? {
          activo: f.evaluacion.symbol,
          desarrollo: `${f.evaluacion.desarrollo.operaciones} ops, neto ${f.evaluacion.desarrollo.netoR.toFixed(2).replace(".", ",")} R, DD ${f.evaluacion.desarrollo.maxDrawdownR.toFixed(2).replace(".", ",")} R`,
          evaluacion: `${f.evaluacion.evaluacion.operaciones} ops, neto ${f.evaluacion.evaluacion.netoR.toFixed(2).replace(".", ",")} R, DD ${f.evaluacion.evaluacion.maxDrawdownR.toFixed(2).replace(".", ",")} R`,
        }
      : null,
  };
}
