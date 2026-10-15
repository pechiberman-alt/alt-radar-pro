/**
 * La lectura para novatos: traduce las métricas del backtest (lib/lab-evaluacion.ts) a frases en castellano que alguien sin
 * experiencia entienda, sin inventar nada. Cada frase dice lo que el número significa y lo que NO significa. El veredicto
 * mira primero la muestra: con pocas operaciones no se concluye, por buenos que se vean los números. Y compara desarrollo
 * contra evaluación: si gana en el pasado que se usó para elegir y pierde después, no se sostiene.
 * También ordena los gatillos de la práctica de más simple a más complejo, para aprender por partes. Pura: sin red ni base.
 */
import { MUESTRA_MINIMA, type Evaluacion, type MetricasTramo } from "./lab-evaluacion.ts";

/** Qué tan fuerte es lo que se puede decir. No hay un nivel «gana»: eso no lo decide un backtest. */
export type Fuerza = "SIN DATOS" | "NO ALCANZA" | "NO SE SOSTIENE" | "SIN VENTAJA" | "PARA SEGUIR MIRANDO";

export type Lectura = { titulo: string; frases: string[] };
export type VeredictoNovato = { fuerza: Fuerza; titulo: string; porque: string[]; queHacer: string };

const coma = (x: number, d = 2) => x.toFixed(d).replace(".", ",");
const pct = (x: number | null) => (x === null ? "sin dato" : `${coma(x * 100, 0)} %`);

/** Una operación por cada cuántas horas, para decir si el gatillo dispara seguido o casi nunca. */
export function frecuencia(m: MetricasTramo): number | null {
  const horas = (m.hasta - m.desde) / 3_600_000;
  if (!(horas > 0) || m.operaciones === 0) return null;
  return horas / m.operaciones;
}

/**
 * Las frases de un tramo. Cada número va con lo que quiere decir y con su límite: el acierto sin el tamaño de las
 * ganancias no dice nada, y el profit factor sin muestra tampoco.
 */
export function lecturaTramo(m: MetricasTramo): Lectura {
  const frases: string[] = [];
  if (m.operaciones === 0) return { titulo: m.tramo, frases: ["No hubo ninguna operación en este tramo: no hay nada que leer."] };

  frases.push(`Hubo ${m.operaciones} operación(es) cerradas. ${m.muestra === "MUESTRA RAZONABLE" ? `Es una muestra chica igual, pero llega al mínimo de ${MUESTRA_MINIMA} para empezar a mirarla.` : `Con menos de ${MUESTRA_MINIMA} no se puede concluir nada: cualquier porcentaje acá es ruido.`}`);

  if (m.winRate !== null) {
    frases.push(`Acertó ${pct(m.winRate)} de las veces. Eso solo no dice si gana: importa cuánto gana cuando acierta y cuánto pierde cuando no.`);
  }
  if (m.relacionGP !== null) {
    frases.push(
      m.relacionGP >= 1
        ? `Cuando ganó, ganó ${coma(m.relacionGP)} veces lo que perdió cuando perdió. Por eso puede dar positivo aun acertando menos de la mitad.`
        : `Cuando ganó, ganó menos de lo que perdió cuando perdió (${coma(m.relacionGP)}). Para dar positivo necesita acertar muchas veces.`,
    );
  }
  if (m.profitFactor !== null) {
    frases.push(
      m.profitFactor > 1
        ? `El profit factor es ${coma(m.profitFactor)}: por cada peso perdido ganó ${coma(m.profitFactor)}. Arriba de 1 es ganancia en este período, no una promesa.`
        : `El profit factor es ${coma(m.profitFactor)}: perdió más de lo que ganó. Abajo de 1 es pérdida.`,
    );
  }
  // El salto de neto a «con deslizamiento» es lo que más sorprende a quien recién empieza.
  const costo = m.brutoR - m.conDeslizamientoR;
  frases.push(
    `Sin costos el resultado sería ${coma(m.brutoR)} R; con comisiones y deslizamiento queda en ${coma(m.conDeslizamientoR)} R. Los costos se llevaron ${coma(costo)} R${m.brutoR > 0 && m.conDeslizamientoR <= 0 ? ": lo que parecía ganancia se lo comieron los costos." : "."}`,
  );
  frases.push(`La peor racha hizo caer ${coma(m.maxDrawdownR)} R desde el pico. Eso es lo que habría que aguantar sin abandonar la regla.`);

  const f = frecuencia(m);
  if (f !== null) frases.push(`Disparó una vez cada ${coma(f, 0)} horas en promedio. ${f > 240 ? "Es poco seguido: hay que tener paciencia y la muestra crece lento." : "Dispara seguido: la muestra crece rápido, pero también los costos."}`);
  return { titulo: m.tramo, frases };
}

/**
 * El veredicto honesto de la corrida. El orden importa: primero la muestra (sin datos no hay conclusión), después si se
 * sostiene fuera del tramo con el que se eligió, y recién al final si el resultado da positivo. Nunca dice que gana.
 */
export function veredictoNovato(ev: Evaluacion): VeredictoNovato {
  const d = ev.desarrollo;
  const e = ev.evaluacion;
  const porque: string[] = [];

  if (e.operaciones === 0) {
    return { fuerza: "SIN DATOS", titulo: "No hay nada que concluir", porque: ["No hubo operaciones cerradas en el tramo de evaluación."], queHacer: "Probá un período más largo o otra moneda: con cero operaciones no hay nada que medir." };
  }
  if (e.muestra !== "MUESTRA RAZONABLE" || d.muestra !== "MUESTRA RAZONABLE") {
    porque.push(`Hacen falta al menos ${MUESTRA_MINIMA} operaciones cerradas en cada tramo y no se llegó (desarrollo ${d.operaciones}, evaluación ${e.operaciones}).`);
    porque.push("Con tan pocas operaciones, un resultado bueno o malo se explica por azar.");
    return { fuerza: "NO ALCANZA", titulo: "La muestra no alcanza para decir nada", porque, queHacer: "Alargá el período para juntar más operaciones. No tomes decisiones con estos números." };
  }

  const dPos = d.conDeslizamientoR > 0;
  const ePos = e.conDeslizamientoR > 0;
  porque.push(`En desarrollo (el tramo que se usó para armar las reglas) quedó en ${coma(d.conDeslizamientoR)} R y en evaluación (el que se reservó) en ${coma(e.conDeslizamientoR)} R, ya con costos.`);

  if (dPos && !ePos) {
    porque.push("Dio positivo donde se la miró y negativo donde no: ese es el patrón típico de una regla ajustada al pasado.");
    return { fuerza: "NO SE SOSTIENE", titulo: "Funcionó en el pasado mirado, no en el reservado", porque, queHacer: "No la uses. Que ande en desarrollo y falle en evaluación es la señal más clara de sobreajuste." };
  }
  if (!ePos) {
    porque.push("En el tramo reservado perdió plata una vez descontados los costos.");
    return { fuerza: "SIN VENTAJA", titulo: "No mostró ventaja", porque, queHacer: "Descartala para este activo y período, o probá otra configuración sabiendo que cada prueba nueva hace más fácil encontrar algo bueno por azar." };
  }

  porque.push("Dio positivo en el tramo reservado, que es el que más vale.");
  porque.push("Aun así, esto es un período, un activo y una corrida: no es una ventaja demostrada. Para eso hace falta medirla hacia adelante, sin tocar la regla.");
  if (ev.calidad.length > 0) porque.push(`La corrida tiene ${ev.calidad.length} advertencia(s) listadas abajo: léelas antes de entusiasmarte.`);
  return { fuerza: "PARA SEGUIR MIRANDO", titulo: "Da para seguir mirándola, nada más", porque, queHacer: "Anotá la regla tal como está y medila hacia adelante en papel. Si la cambiás ahora para mejorar el número, volvés a empezar." };
}

/** Un gatillo de la práctica con su nivel: para aprender de a poco en vez de arrancar por el más complicado. */
export type NivelGatillo = { id: string; nivel: 1 | 2 | 3; porQue: string };

/**
 * El orden sugerido para practicar: primero los que se leen con una sola condición en el gráfico, después los que suman
 * un marco superior o varias condiciones. El control al azar va primero a propósito: sirve para medirse contra el ruido.
 */
export const NIVELES_GATILLO: NivelGatillo[] = [
  { id: "AZAR", nivel: 1, porQue: "Entra al azar. Practicá con este primero para ver cuánto acertás sin ninguna señal: es tu piso." },
  { id: "RUPTURA", nivel: 1, porQue: "Una sola condición: el precio supera el máximo reciente. Es la más fácil de ver." },
  { id: "CRUCE_EMA", nivel: 1, porQue: "Dos medias que se cruzan. Se ve de un vistazo." },
  { id: "RSI", nivel: 1, porQue: "Un indicador que pasa un umbral." },
  { id: "BOLLINGER", nivel: 2, porQue: "El precio toca una banda que se mueve con la volatilidad." },
  { id: "RETROCESO", nivel: 2, porQue: "Hay que leer la tendencia y después esperar la vuelta." },
  { id: "MACD", nivel: 2, porQue: "Dos líneas del indicador y su cruce." },
  { id: "SUPERTREND", nivel: 2, porQue: "Un indicador de tendencia que cambia de lado." },
  { id: "TENDENCIA_LINEA", nivel: 3, porQue: "Hay que trazar la línea y esperar que la rompa." },
  { id: "SMC_LIQUIDEZ", nivel: 3, porQue: "Varias condiciones encadenadas de estructura." },
  { id: "FIB_NIVELES", nivel: 3, porQue: "Retroceso de una pierna más niveles del día y la semana." },
];

/** El nivel de un gatillo, o null si no está en la lista (los que no se listan no se recomiendan para empezar). */
export function nivelDe(id: string): NivelGatillo | null {
  return NIVELES_GATILLO.find((x) => x.id === id) ?? null;
}
