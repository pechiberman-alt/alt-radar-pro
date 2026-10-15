/**
 * El contenido de APRENDER, la pestaña para quien recién empieza en el AI TRADING LAB: qué es una vela, qué es un gatillo,
 * cómo se miden el riesgo y los costos, por qué el winrate solo no alcanza y por qué hay que mirar la muestra. Cada lección
 * tiene preguntas con su explicación, y el glosario define las palabras que usa la app. Es texto puro: no da señales, no
 * promete ganancias y no dice cuánto se gana. Pura: sin red ni base.
 */

export type PreguntaLeccion = {
  id: string;
  pregunta: string;
  opciones: string[];
  /** Índice de la opción correcta dentro de `opciones`. */
  correcta: number;
  explicacion: string;
};

export type Leccion = {
  id: string;
  titulo: string;
  parrafos: string[];
  preguntas: PreguntaLeccion[];
};

export type TerminoGlosario = { termino: string; definicion: string };

export const LECCIONES: Leccion[] = [
  {
    id: "vela",
    titulo: "Qué es una vela",
    parrafos: [
      "Una vela resume lo que pasó en el precio durante un período: 15 minutos, 1 hora, 4 horas o 1 día. Tiene cuatro precios: la apertura (donde empezó), el máximo (el más alto), el mínimo (el más bajo) y el cierre (donde terminó).",
      "Si el cierre quedó por encima de la apertura, la vela es verde: el precio subió en ese período. Si quedó por debajo, es roja. La mecha son las líneas que salen del cuerpo: muestran hasta dónde llegó el precio y volvió.",
    ],
    preguntas: [
      {
        id: "vela-1",
        pregunta: "En una vela verde, ¿cuál de estos precios es más alto?",
        opciones: ["La apertura", "El cierre", "Son iguales siempre"],
        correcta: 1,
        explicacion: "En una vela verde el cierre queda por encima de la apertura: el precio subió durante ese período.",
      },
    ],
  },
  {
    id: "gatillo",
    titulo: "Qué es un gatillo",
    parrafos: [
      "Un gatillo es una regla fija que dice: si pasa tal cosa al cierre de una vela, se entra en tal dirección. Por ejemplo, 'el precio rompió el máximo de las últimas 20 velas'.",
      "La regla tiene que estar escrita antes de mirar los resultados. Si la elegís después de ver qué le fue bien, el resultado parece mejor de lo que es. Por eso el laboratorio fija las reglas y después las mide en datos que no usó para elegirlas.",
    ],
    preguntas: [
      {
        id: "gatillo-1",
        pregunta: "¿Por qué la regla de un gatillo tiene que estar fijada antes de medirla?",
        opciones: [
          "Porque así se ve más profesional",
          "Porque si la elegís mirando los resultados, los números salen mejores de lo que son",
          "Porque la app lo exige para cobrar",
        ],
        correcta: 1,
        explicacion: "Elegir la regla después de ver los resultados infla los números: parece que funciona, pero solo se ajustó al pasado.",
      },
    ],
  },
  {
    id: "riesgo",
    titulo: "Stop, objetivo y R",
    parrafos: [
      "Antes de entrar se define el stop: el precio donde te salís si la operación sale mal. Y el objetivo: donde te salís si sale bien. Las operaciones del laboratorio tienen tres objetivos (TP1, TP2 y TP3) y un stop.",
      "El R es tu riesgo: la distancia entre la entrada y el stop. Si arriesgás 1 R y el objetivo está a 2 R, ganás 2 R cuando llega y perdés 1 R cuando toca el stop. Si una vela toca el stop y el objetivo a la vez, el laboratorio cuenta el stop: es la forma conservadora de medir.",
    ],
    preguntas: [
      {
        id: "riesgo-1",
        pregunta: "Arriesgás 1 R y el objetivo está a 2 R. ¿Cuánto ganás si llega al objetivo?",
        opciones: ["1 R", "2 R", "3 R"],
        correcta: 1,
        explicacion: "El objetivo a 2 R significa que la ganancia es el doble del riesgo.",
      },
      {
        id: "riesgo-2",
        pregunta: "Una vela toca el stop y el objetivo al mismo tiempo. ¿Cómo se cuenta?",
        opciones: ["Como ganancia", "Como stop", "No se cuenta"],
        correcta: 1,
        explicacion: "Sin saber cuál de los dos pasó primero, se cuenta el stop. Así no se favorece ningún resultado.",
      },
    ],
  },
  {
    id: "costos",
    titulo: "Los costos",
    parrafos: [
      "Cada compra y cada venta cuesta: la comisión del exchange más el deslizamiento (el precio que te toca no es exactamente el que viste). El estudio usa 0,07 % por lado, es decir, 0,14 % de ida y vuelta.",
      "Parece poco, pero en operaciones chicas o frecuentes se come la ventaja. Por eso el laboratorio descuenta los costos en cada operación: un resultado sin costos no sirve.",
    ],
    preguntas: [
      {
        id: "costos-1",
        pregunta: "Si el costo es 0,07 % por lado, ¿cuánto cuesta una operación completa (comprar y vender)?",
        opciones: ["0,07 %", "0,14 %", "0,01 %"],
        correcta: 1,
        explicacion: "Se paga por entrar y por salir: 0,07 % más 0,07 % da 0,14 %.",
      },
    ],
  },
  {
    id: "metricas",
    titulo: "Winrate no alcanza",
    parrafos: [
      "El winrate (o acierto) es el porcentaje de operaciones ganadoras. Solo no dice nada: una estrategia puede ganar 75 % de las veces y aun así perder plata si cuando pierde pierde mucho más de lo que gana.",
      "Por eso se miran tres cosas juntas: el profit factor (lo que se gana dividido lo que se pierde: más de 1 significa ganancia bruta), la expectancia (el promedio en R por operación, ya con costos) y la muestra (cuántas operaciones son).",
    ],
    preguntas: [
      {
        id: "metricas-1",
        pregunta: "Un winrate de 75 %, ¿garantiza que la estrategia gana plata?",
        opciones: [
          "Sí, siempre",
          "No: hay que mirar también el profit factor, la expectancia y cuántas operaciones son",
          "Sí, si son más de 10 operaciones",
        ],
        correcta: 1,
        explicacion: "El winrate sin el tamaño de las pérdidas y sin muestra no dice si la estrategia gana.",
      },
    ],
  },
  {
    id: "muestra",
    titulo: "Muestra y azar",
    parrafos: [
      "Con pocas operaciones, cualquier porcentaje es ruido. Menos de 15 casos no dan un porcentaje útil: el laboratorio lo muestra como 'muestra mínima'.",
      "Además, si probás muchas reglas y elegís la que mejor te fue, una va a parecer buena por casualidad. Por eso el laboratorio tiene un agente de control que entra al azar: si una estrategia no le gana al azar, no tiene ventaja. Y corrige por la cantidad de reglas que se probaron.",
    ],
    preguntas: [
      {
        id: "muestra-1",
        pregunta: "Probaste 50 reglas y elegiste la que mejor le fue en el pasado. ¿Qué es lo más probable?",
        opciones: [
          "Que sea la mejor regla que existe",
          "Que parezca buena por casualidad, y hay que corregir por la cantidad de reglas probadas",
          "Que funcione igual en el futuro",
        ],
        correcta: 1,
        explicacion: "Entre muchas reglas, alguna siempre parece buena por azar. Por eso se corrige por la cantidad de pruebas y se mide hacia adelante.",
      },
    ],
  },
  {
    id: "practica",
    titulo: "Cómo usar la práctica del gatillo",
    parrafos: [
      "En la pestaña PRÁCTICA del laboratorio elegís una moneda, un marco de tiempo y un gatillo. Ves las velas hasta una vela y contestás LONG, SHORT o 'No hay gatillo'.",
      "Después de contestar aparece la verdad: si la regla disparaba ahí, y qué habría pasado con la operación. Al final de la tanda ves tu acierto, separado en velas con gatillo y sin gatillo. Con menos de 15 preguntas de cada tipo no se muestra porcentaje. Practicar no usa dinero: es para aprender a reconocer el gatillo.",
    ],
    preguntas: [
      {
        id: "practica-1",
        pregunta: "¿La práctica del gatillo usa dinero real?",
        opciones: ["Sí", "No, es solo para practicar a reconocer el gatillo", "Solo si conectás una cuenta"],
        correcta: 1,
        explicacion: "La práctica no opera ni toca cuentas: muestra velas del pasado y corrige tu respuesta.",
      },
    ],
  },
];

export const GLOSARIO: TerminoGlosario[] = [
  { termino: "Vela", definicion: "Resumen de un período de precio con apertura, máximo, mínimo y cierre." },
  { termino: "Marco de tiempo", definicion: "Duración de cada vela: 15 minutos, 1 hora, 4 horas o 1 día." },
  { termino: "Gatillo", definicion: "Regla fija que dice cuándo se entra en una dirección." },
  { termino: "Stop", definicion: "Precio al que te salís si la operación sale mal." },
  { termino: "Objetivo (TP)", definicion: "Precio al que te salís si la operación sale bien. El laboratorio tiene TP1, TP2 y TP3." },
  { termino: "R", definicion: "Tu riesgo en una operación: la distancia entre la entrada y el stop." },
  { termino: "Winrate o acierto", definicion: "Porcentaje de operaciones ganadoras. Solo no alcanza para juzgar una estrategia." },
  { termino: "Profit factor", definicion: "Lo que se gana dividido lo que se pierde. Más de 1 significa ganancia bruta." },
  { termino: "Expectancia", definicion: "Promedio en R por operación, con costos descontados." },
  { termino: "Costos", definicion: "Comisión más deslizamiento por cada compra y cada venta. El estudio usa 0,07 % por lado." },
  { termino: "Muestra mínima", definicion: "Menos de 15 casos: un porcentaje con tan pocos datos no dice nada." },
  { termino: "Control al azar", definicion: "Un agente que entra al azar. Si una estrategia no le gana, no tiene ventaja." },
  { termino: "Sobreajuste", definicion: "Cuando una regla parece buena porque se eligió mirando el pasado, no porque funcione." },
  { termino: "Papel", definicion: "Operar en simulación, sin dinero real, para medir hacia adelante." },
];

/** Si la respuesta elegida es la correcta. Un índice fuera de rango cuenta como incorrecta. */
export function esCorrecta(p: PreguntaLeccion, elegida: number): boolean {
  return elegida === p.correcta;
}
