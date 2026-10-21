/**
 * Que la IA conteste lo que se le pregunta, con los datos, y no algo genérico. Tres piezas, para JARVIS, el ANALISTA, los
 * agentes de la oficina y las MENTES (cripto, acciones y CEDEARs):
 *
 * 1. Respuesta directa sin IA: las preguntas de siempre («¿qué tenés abierto?», «¿cómo te va?», «¿qué mirás?», «¿qué ves en
 *    KO?») se contestan al instante con el dato exacto de la ficha. La IA queda para lo abierto.
 * 2. Persona con reglas firmes (inspirado en virattt/ai-hedge-fund, MIT: la persona es solo un prompt de sistema, razona
 *    solo con los datos que recibe y, si no alcanzan, lo dice): primero responde la pregunta en pocas frases, sin recitar su
 *    regla ni teoría que no se pidió, sin inventar números y sin hacerse pasar por la persona real.
 * 3. Limpieza y control: se sacan el razonamiento oculto (<think>) y el markdown, y una respuesta que no toca lo preguntado
 *    se descarta para contestar con los datos.
 * Pura.
 */

export type Intencion = "ABIERTAS" | "RESULTADO" | "REGLA" | "APRENDIZAJE" | "ACTIVO" | "SALUDO" | "OTRA";

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Qué pregunta la persona, por palabras clave (el activo nombrado lo resuelve quien llama). */
export function intencionDe(pregunta: string, nombraActivo = false): Intencion {
  const t = sinTildes(pregunta);
  if (/\b(abiert|posicion|operando|operacion(es)? abierta|tenes (algo )?(abierto|en curso)|en que estas)/.test(t)) return "ABIERTAS";
  if (/\b(como te va|como vas|resultado|ganaste|perdiste|acierto|win ?rate|profit|pf\b|rendimiento|cuanto (ganas|llevas))/.test(t)) return "RESULTADO";
  if (/\b(aprendi|leccion|que sabes de vos|en que fallas)/.test(t)) return "APRENDIZAJE";
  if (nombraActivo) return "ACTIVO";
  if (/\b(regla|que miras|como operas|tu estrategia|como funcionas|que haces|quien sos)/.test(t)) return "REGLA";
  if (/^(hola|buenas|buen dia|que tal|como estas)\b/.test(t.trim())) return "SALUDO";
  return "OTRA";
}

/** Lo que una persona de la app (agente, mente o JARVIS) sabe de sí misma, ya en texto. */
export type Ficha = {
  nombre: string;
  /** Una línea por posición abierta («BTC largo desde el 21/10»); vacío si no tiene. */
  abiertas: string[];
  /** Su resultado en una frase con la muestra; null si no tiene cierres. */
  resultado: string | null;
  regla: string;
  aprendizajes: string[];
};

/**
 * La respuesta con el dato exacto para las preguntas de siempre; null si la pregunta es otra (la contesta la IA). Para
 * ACTIVO, quien llama arma la frase con su lectura de ese activo y la pasa en `activo`.
 */
export function respuestaDirecta(i: Intencion, f: Ficha, activo: string | null = null): string | null {
  if (i === "ABIERTAS") return f.abiertas.length ? `Tengo ${f.abiertas.length} ${f.abiertas.length === 1 ? "abierta" : "abiertas"}: ${f.abiertas.join("; ")}.` : "No tengo nada abierto ahora.";
  if (i === "RESULTADO") return f.resultado ?? "Todavía no cerré ninguna operación: no sé si mi regla sirve.";
  if (i === "REGLA") return f.regla;
  if (i === "APRENDIZAJE") return f.aprendizajes.length ? f.aprendizajes.slice(0, 2).join(" ") : "Todavía no tengo cierres suficientes para sacar una lección.";
  if (i === "ACTIVO") return activo;
  if (i === "SALUDO") return `Hola, soy ${f.nombre}. Preguntame qué tengo abierto, cómo me va, qué miro o qué veo en un activo.`;
  return null;
}

export type Persona = { nombre: string; rol: string; idea?: string };

/** El prompt de sistema de una persona de la app: corto y firme, para que conteste la pregunta con los datos. */
export function sistemaPersona(p: Persona): string {
  return `Sos «${p.nombre}», ${p.rol} dentro de ALT RADAR PRO (url.fx).${p.idea ? ` Tu mirada: ${p.idea}.` : ""}
Si tu nombre es el de un inversor real, sos una lente inspirada en lo que esa persona publicó: no sos esa persona, no hablás en su nombre y, si te lo preguntan, lo aclarás.

CÓMO RESPONDÉS
1. Primero contestás exactamente lo que te preguntaron, en 1 a 3 frases, con los números del SNAPSHOT. Después, solo si suma, una frase más de contexto.
2. No recitás tu regla, tu teoría ni tu conocimiento si no te lo pidieron.
3. Usás solo los datos del SNAPSHOT. Si el dato que piden no está, decís «no tengo ese dato» y qué haría falta. No inventás números ni probabilidades; todo acierto va con su muestra.
4. Hablás en primera persona, en español rioplatense, sin markdown (sin asteriscos, numerales ni tablas), en menos de 90 palabras salvo que te pidan explicar.
5. No das órdenes ni prometés resultados. Si la pregunta es de comprar o vender, das la lectura y qué la invalidaría. No es asesoramiento financiero.
6. Los números del SNAPSHOT vienen en formato argentino (punto de miles, coma decimal): copialos tal cual.`;
}

/** Saca el razonamiento oculto de algunos modelos y el markdown; deja el texto plano y corto. */
export function limpiarRespuesta(texto: string, maximo = 1800): string {
  let t = texto.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<\/?think>/gi, "");
  t = t
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|$|[.,;:])/g, "$1$2")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "· ")
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (t.length <= maximo) return t;
  const corte = t.slice(0, maximo);
  const fin = Math.max(corte.lastIndexOf(". "), corte.lastIndexOf(".\n"));
  return (fin > maximo * 0.5 ? corte.slice(0, fin + 1) : corte) + " …";
}

/**
 * Si la respuesta de la IA toca lo que se preguntó. Para las preguntas de siempre pide alguna de las palabras del dato
 * (por ejemplo el activo nombrado o «abiert»); para lo abierto, que no sea un recitado de la regla.
 */
export function respondeLoPreguntado(respuesta: string, i: Intencion, claves: string[] = []): boolean {
  const r = sinTildes(respuesta);
  if (!r.trim()) return false;
  if (i === "ABIERTAS" && !/(abiert|posicion|nada|ningun|largo|corto)/.test(r)) return false;
  if (i === "ACTIVO" && claves.length && !claves.some((c) => r.includes(sinTildes(c)))) return false;
  return true;
}
