/**
 * Qué mira cada agente, en palabras de todos los días. La regla técnica de cada estrategia ya está en lib/estrategias.ts;
 * esto es la versión para alguien que recién empieza y abre el panel sin saber qué es una EMA o un Supertrend.
 * Describe lo que el agente busca, no lo que consigue: ninguna línea habla de ganancias. Pura: sin red ni base.
 */
import { ESTRATEGIAS } from "./estrategias.ts";

export type Explicado = {
  /** Qué mira el agente, en una o dos frases simples. */
  mira: string;
  /** La idea de fondo: por qué alguien pensaría que eso puede funcionar. */
  idea: string;
};

export const EXPLICADO: Record<string, Explicado> = {
  RUPTURA: {
    mira: "Que el precio supere el techo más alto de las últimas velas.",
    idea: "Si rompe un techo que venía frenándolo, puede seguir de largo.",
  },
  CRUCE_EMA: {
    mira: "Que el promedio de precios corto cruce por encima del largo.",
    idea: "Cuando lo reciente se pone por encima de lo viejo, suele leerse como un cambio de tendencia.",
  },
  RSI: {
    mira: "Un medidor de fuerza que marca cuándo el precio se estiró demasiado para un lado.",
    idea: "Lo muy estirado tiende a volver al centro.",
  },
  BOLLINGER: {
    mira: "Que el precio toque una banda que se ensancha cuando el mercado se mueve más.",
    idea: "Tocar el borde puede ser exageración y volver, o el arranque de algo más grande.",
  },
  RETROCESO: {
    mira: "Una tendencia ya formada, y dentro de ella una pausa en contra.",
    idea: "Entrar en la pausa sale más barato que entrar cuando ya se fue.",
  },
  MACD: {
    mira: "Dos promedios del precio que se cruzan entre sí.",
    idea: "El cruce marca que el impulso cambió de mano.",
  },
  MACD_MTF_SNR: {
    mira: "Ese mismo cruce, pero solo si la temporalidad más grande va para el mismo lado y el precio está en una zona que antes lo frenó.",
    idea: "Tres cosas de acuerdo filtran más que una sola.",
  },
  SUPERTREND: {
    mira: "Un indicador que va dibujando un escalón debajo o arriba del precio y cambia de lado cuando lo atraviesa.",
    idea: "Mientras el escalón no se dé vuelta, la tendencia sigue.",
  },
  ST_VWAP: {
    mira: "Lo mismo, y además que el precio esté del lado favorable del precio promedio de la semana.",
    idea: "Sumar el promedio semanal deja afuera entradas contra la corriente.",
  },
  ST_PERFIL: {
    mira: "Lo mismo, y además que el precio esté del lado favorable del nivel donde se operó más volumen.",
    idea: "Donde se operó más volumen suele haber un punto de equilibrio.",
  },
  ST_VWAP_PERFIL: {
    mira: "Lo anterior con las dos condiciones a la vez: promedio semanal y nivel de más volumen.",
    idea: "Cuantos más acuerdos se exigen, menos entradas y en teoría mejores.",
  },
  ST_MTF: {
    mira: "El escalón del Supertrend, pero exigiendo que la temporalidad más grande vaya para el mismo lado.",
    idea: "No pelearse con la tendencia de fondo.",
  },
  ST_MTF_VOL: {
    mira: "Lo anterior y además que la vela de la señal tenga bastante más volumen que las anteriores.",
    idea: "Un movimiento con volumen tiene más gente atrás que uno sin nadie.",
  },
  SNR: {
    mira: "La primera vez que el precio visita un nivel donde antes se dio vuelta.",
    idea: "Los niveles donde ya rebotó suelen volver a frenarlo.",
  },
  SNR_HTF: {
    mira: "Esa primera visita, pero solo si la tendencia de la temporalidad grande acompaña.",
    idea: "Un nivel a favor de la tendencia pesa más que uno en contra.",
  },
  TENDENCIA_LINEA: {
    mira: "Una línea trazada uniendo los puntos donde el precio fue girando, y que la rompa.",
    idea: "Romper la línea que lo venía conteniendo marca que algo cambió.",
  },
  SMC_LIQUIDEZ: {
    mira: "Que el precio pase por arriba de un máximo para buscar las órdenes que hay ahí, y después se dé vuelta.",
    idea: "A veces el precio sube solo para barrer stops y después va para el otro lado.",
  },
  SMC_TODO: {
    mira: "Ese barrido, pero exigiendo además varias confirmaciones de tendencia y de volumen.",
    idea: "Pedir todo junto deja muchas menos entradas, con la idea de que sean mejores.",
  },
  METALES_D55: {
    mira: "Que el oro o la plata cierren por encima de lo más alto de las últimas 55 velas. Solo compra.",
    idea: "Los metales suelen moverse en tendencias largas: cuando rompen máximos, a veces siguen. Se probó en oro; en plata no hay medición.",
  },
  AMD_IFVG: {
    mira: "Un precio quieto en un rango, un tirón falso que barre un lado, y la vuelta que deja un hueco cerrado al revés.",
    idea: "El tirón falso junta las órdenes de los apurados; cuando el precio vuelve adentro del rango, suele ir para el otro lado, hasta el hueco más cercano que quedó abierto en una temporalidad más alta.",
  },
  ABSORCION: {
    mira: "Una vela que llega al extremo de las últimas 20 con mucho volumen y aun así cierra lejos de ese extremo.",
    idea: "Si entra mucho volumen empujando y el precio no sigue, alguien del otro lado está absorbiendo: el empujón se gasta.",
  },
  ESFUERZO: {
    mira: "Mucho volumen y poco movimiento justo después de una subida o una bajada fuerte.",
    idea: "Esfuerzo sin resultado: si cuesta tanto mover el precio, del otro lado hay órdenes grandes esperando.",
  },
  BARRIDA_VOL: {
    mira: "Que el precio pase el mínimo o máximo de las últimas 20 velas, con volumen, y cierre de vuelta adentro.",
    idea: "Ahí se juntan los stops: el tirón los ejecuta, y si el precio vuelve enseguida, el que barrió ya tiene lo que buscaba.",
  },
  DELTA_DIV: {
    mira: "Un nuevo extremo de precio sin que el delta acumulado (compra agresiva menos venta agresiva) lo acompañe.",
    idea: "Cuando el precio sigue pero la agresión ya no, el movimiento se queda sin combustible.",
  },
  DELTA_ABSORBIDO: {
    mira: "Una vela con venta agresiva fuerte que igual cierra arriba, o compra agresiva fuerte que igual cierra abajo.",
    idea: "Si los agresores pegan fuerte y el precio va para el otro lado, órdenes pasivas grandes los están absorbiendo.",
  },
  FIB_NIVELES: {
    mira: "Cuánto retrocedió el precio de su último tramo, en proporciones fijas, cerca de los máximos o mínimos del día o la semana.",
    idea: "Hay proporciones de retroceso que mucha gente mira, y los niveles del día concentran órdenes.",
  },
  AZAR: {
    mira: "Nada: entra por sorteo.",
    idea: "No es un agente, es la vara. Si una estrategia no le gana al azar, no tiene ninguna ventaja.",
  },
};

/** La explicación de un agente, o null si todavía no se escribió. */
export const explicadoDe = (id: string): Explicado | null => EXPLICADO[id] ?? null;

/** Los agentes del estudio que todavía no tienen explicación: el test falla si hay alguno. */
export const sinExplicacion = (): string[] => ESTRATEGIAS.map((e) => e.id as string).filter((id) => !EXPLICADO[id]);
