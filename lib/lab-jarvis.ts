/**
 * JARVIS sobre el AI TRADING LAB: contesta con los datos reales de la foto del laboratorio (lib/lab.ts) qué hace la
 * araña, qué encontró, qué estrategias se evalúan, cuál rinde mejor y con qué muestra, el drawdown, los riesgos, qué
 * datos faltan y qué probar después. Si la pregunta no es del laboratorio devuelve null y sigue el camino de siempre.
 * No corona estrategias con muestra mínima ni promete nada. Pura.
 */
import { centroDe, type FotoLab } from "./lab.ts";
import { lineaFuente, MUESTRA_MINIMA, type FuenteRegistro } from "./registro.ts";

export type TemaLab = "arana" | "hallazgo" | "estrategias" | "mejor" | "drawdown" | "riesgos" | "faltan" | "pruebas";

const sinAcentos = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const TEMAS: [TemaLab, RegExp][] = [
  ["arana", /\b(que|en que) (esta|anda) (haciendo )?la arana\b|\bestado de la arana\b|\bque hace la arana\b/],
  ["hallazgo", /\b(que encontro|ultimo analisis|ultima lectura|que encontraste)\b/],
  ["mejor", /\b(mejor (rendimiento|estrategia)|cual (rinde|funciona|anda) mejor|que estrategia (rinde|funciona|anda) mejor)\b/],
  ["drawdown", /\b(drawdown|mayor caida|peor racha)\b/],
  ["estrategias", /\bque estrategias\b|\bestrategias (estamos )?evaluando\b|\bque (estamos|estas) evaluando\b/],
  ["riesgos", /\b(que riesgos|riesgos detectaste|que riesgo hay)\b/],
  ["faltan", /\b(que datos faltan|que falta para confiar|datos faltan|confiar en (este|el) resultado)\b/],
  ["pruebas", /\b(que pruebas|que conviene (probar|ejecutar|correr)|que pruebo despues|proximas? pruebas?)\b/],
];

/** El tema de laboratorio de la pregunta, o null si no es una pregunta del laboratorio. */
export function temaLab(pregunta: string): TemaLab | null {
  const q = sinAcentos(pregunta);
  for (const [tema, re] of TEMAS) if (re.test(q)) return tema;
  return null;
}

const r2 = (v: number) => v.toFixed(2).replace(".", ",");
const pct = (v: number) => `${Math.round(v * 100)} %`;

function fuentes(f: FotoLab): FuenteRegistro[] {
  return f.vivo?.registro?.fuentes.filter((x) => x.disponible) ?? [];
}

export function respuestaLab(pregunta: string, f: FotoLab): string | null {
  const tema = temaLab(pregunta);
  if (!tema) return null;
  const c = centroDe(f);
  const ev = f.evaluacion;
  switch (tema) {
    case "arana": {
      const tareas = c.tareas.map((t) => `${t.nombre}: ${t.estado}${t.progreso !== null && t.estado === "corriendo" ? ` (${pct(t.progreso)})` : ""}. ${t.detalle}`);
      return [`La araña está ${c.texto}.`, ...tareas, ...(c.errores.length ? [`Errores: ${c.errores.join(" ")}`] : [])].join(" ");
    }
    case "hallazgo": {
      const v = f.vivo;
      if (!v || v.escaneo.estado === "sin datos") return "Todavía no hay un análisis de la araña en esta sesión: abrí La Araña y esperá el primer escaneo.";
      const e = v.escaneo;
      const mejores = e.mejores.slice(0, 3).map((m) => `${m.symbol.replace(/USDT$/, "")} ${m.direccion}${m.puntaje !== null ? ` (puntaje ${m.puntaje}, no es probabilidad)` : ""}`);
      return [
        `Último escaneo: ${e.leidas ?? 0} monedas leídas, ${e.aprobadas ?? 0} con plan aprobado por el gestor de riesgo${e.haceMin !== null ? `, hace ${e.haceMin} min` : ""}.`,
        mejores.length ? `Las de mayor confluencia: ${mejores.join(", ")}.` : "Ninguna moneda pasó todas las compuertas.",
        `Veredicto frente a lo medido: ${v.veredicto.texto}`,
      ].join(" ");
    }
    case "estrategias": {
      const lista = fuentes(f).map((x) => x.nombre);
      const partes = [lista.length ? `En el registro: ${lista.join("; ")}.` : "El registro todavía no se leyó."];
      if (ev) partes.push(`Backtest de la mesa sobre ${ev.symbol.replace(/USDT$/, "")} (reglas v${ev.reglas}).`);
      if (f.vivo?.sombra) partes.push("Variantes de filtro en el laboratorio en sombra, que no se aplican sin tu aprobación.");
      partes.push("Todo en simulación: ninguna opera con dinero real.");
      return partes.join(" ");
    }
    case "mejor": {
      const conDatos = fuentes(f).filter((x) => x.cerradas > 0 && x.expectancia !== null);
      if (!conDatos.length) return "No hay operaciones cerradas para comparar. Sin resultados no hay mejor estrategia.";
      const razonables = conDatos.filter((x) => x.cerradas >= MUESTRA_MINIMA);
      const lineas = conDatos.map(lineaFuente).join(" ");
      if (!razonables.length) return `Ninguna estrategia llega a ${MUESTRA_MINIMA} operaciones cerradas: con muestra mínima no se puede decir cuál rinde mejor. Lo que hay: ${lineas}`;
      const mejor = [...razonables].sort((a, b) => (b.expectancia as number) - (a.expectancia as number))[0];
      return `Con muestra de al menos ${MUESTRA_MINIMA}, la de mayor expectancia es ${mejor.nombre}: ${lineaFuente(mejor)}. Es rendimiento pasado, medido en estas condiciones; no garantiza el futuro. Todas: ${lineas}`;
    }
    case "drawdown": {
      if (!ev) return "El drawdown se mide sobre una curva de resultados: corré un backtest en el laboratorio y te lo digo por tramo. El registro no guarda la curva de cada fuente.";
      const d = ev.desarrollo;
      const e = ev.evaluacion;
      return `Backtest de ${ev.symbol.replace(/USDT$/, "")}: caída máxima ${r2(d.maxDrawdownR)} R en DESARROLLO (${d.operaciones} operaciones) y ${r2(e.maxDrawdownR)} R en EVALUACIÓN (${e.operaciones}). ${d.muestra === "MUESTRA RAZONABLE" && e.muestra === "MUESTRA RAZONABLE" ? "" : "Con muestra mínima en algún tramo, ese número puede cambiar mucho."}`.trim();
    }
    case "riesgos": {
      const r: string[] = [];
      if (f.cartera.suspendida) r.push(`Operaciones nuevas suspendidas: ${f.cartera.motivoSuspension}.`);
      r.push(`Cartera simulada: ${f.cartera.abiertas} posiciones de ${f.limites.maxPosiciones}, pérdida de hoy ${r2(f.cartera.perdidaHoyR)} R, caída máxima ${r2(f.cartera.drawdownR)} R.`);
      const negativas = fuentes(f).filter((x) => x.expectancia !== null && x.expectancia < 0);
      if (negativas.length) r.push(`Con expectancia negativa hasta ahora: ${negativas.map((x) => `${x.nombre} (${r2(x.expectancia as number)} R, ${x.cerradas} cerradas)`).join("; ")}.`);
      if (ev && ev.evaluacion.netoR < 0 && ev.desarrollo.netoR > 0) r.push("El backtest gana en DESARROLLO y pierde en EVALUACIÓN: señal de que no se sostiene fuera de lo ya visto.");
      r.push(...c.avisos, ...c.errores);
      return r.join(" ");
    }
    case "faltan": {
      const falta: string[] = [];
      const chicas = fuentes(f).filter((x) => x.cerradas < MUESTRA_MINIMA);
      if (chicas.length) falta.push(`Muestra: ${chicas.map((x) => `${x.nombre} tiene ${x.cerradas} cerradas`).join("; ")} (hacen falta al menos ${MUESTRA_MINIMA}).`);
      const sinLeer = f.vivo?.registro?.fuentes.filter((x) => !x.disponible).map((x) => x.nombre) ?? [];
      if (sinLeer.length) falta.push(`Sin datos (sin sesión o sin leer): ${sinLeer.join(", ")}.`);
      if (ev) falta.push(...ev.calidad);
      else falta.push("No hay backtest en esta sesión: sin eso no hay drawdown ni separación entre desarrollo y evaluación.");
      return falta.length ? falta.join(" ") : "Con lo que hay en esta foto no veo faltantes, pero la muestra sigue siendo la limitación principal.";
    }
    case "pruebas": {
      const p: string[] = [];
      if (!ev) p.push("Correr un backtest de 180 días sobre una moneda líquida y mirar DESARROLLO contra EVALUACIÓN.");
      else {
        if (ev.evaluacion.muestra !== "MUESTRA RAZONABLE") p.push("Repetir el backtest en más monedas o más días: la EVALUACIÓN tiene muestra mínima.");
        if (ev.evaluacion.conDeslizamientoR < 0 && ev.evaluacion.netoR >= 0) p.push("Medir el deslizamiento real: con el supuesto, la EVALUACIÓN pasa a negativo.");
      }
      const chicas = fuentes(f).filter((x) => x.cerradas < MUESTRA_MINIMA);
      if (chicas.length) p.push(`Seguir midiendo en papel hasta ${MUESTRA_MINIMA} cerradas en ${chicas.map((x) => x.nombre).join(", ")}.`);
      p.push("Ninguna prueba cambia las reglas sola: lo que salga se propone y lo aprobás vos.");
      return p.join(" ");
    }
  }
}
