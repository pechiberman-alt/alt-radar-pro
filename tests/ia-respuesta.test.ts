/**
 * Pruebas de lib/ia-respuesta.ts: qué se pregunta, la respuesta directa con el dato, el prompt de persona, la limpieza
 * (razonamiento oculto y markdown) y el control de que la IA conteste lo preguntado.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { intencionDe, limpiarRespuesta, respondeLoPreguntado, respuestaDirecta, sistemaPersona, type Ficha } from "../lib/ia-respuesta.ts";

test("intención: las preguntas de siempre, con y sin tildes", () => {
  assert.equal(intencionDe("Que tenés abierto"), "ABIERTAS");
  assert.equal(intencionDe("¿qué posiciones tenés?"), "ABIERTAS");
  assert.equal(intencionDe("¿Cómo te va?"), "RESULTADO");
  assert.equal(intencionDe("cuál es tu win rate"), "RESULTADO");
  assert.equal(intencionDe("¿qué mirás?"), "REGLA");
  assert.equal(intencionDe("¿qué aprendiste?"), "APRENDIZAJE");
  assert.equal(intencionDe("¿qué ves en BTC?", true), "ACTIVO");
  assert.equal(intencionDe("hola"), "SALUDO");
  assert.equal(intencionDe("¿sube la tasa de la Fed?"), "OTRA");
});

const ficha: Ficha = { nombre: "Agente RSI", abiertas: ["BTC largo desde el 21/10/2026"], resultado: "Llevo 8 cerradas: acierto 63 %.", regla: "Mi regla, fija: RSI bajo 30.", aprendizajes: ["Con tendencia en contra pierdo más."] };

test("respuesta directa: el dato exacto, sin IA", () => {
  assert.equal(respuestaDirecta("ABIERTAS", ficha), "Tengo 1 abierta: BTC largo desde el 21/10/2026.");
  assert.equal(respuestaDirecta("ABIERTAS", { ...ficha, abiertas: [] }), "No tengo nada abierto ahora.");
  assert.match(respuestaDirecta("RESULTADO", { ...ficha, resultado: null })!, /no sé si mi regla sirve/);
  assert.equal(respuestaDirecta("REGLA", ficha), ficha.regla);
  assert.equal(respuestaDirecta("ACTIVO", ficha, "BTC: no tengo posición."), "BTC: no tengo posición.");
  assert.equal(respuestaDirecta("OTRA", ficha), null, "lo abierto lo contesta la IA");
});

test("persona: contesta primero, sin markdown, sin inventar y sin hacerse pasar por la persona real", () => {
  const s = sistemaPersona({ nombre: "Warren Buffett", rol: "una mente", idea: "calidad a precio razonable" });
  assert.match(s, /Primero contestás exactamente lo que te preguntaron/);
  assert.match(s, /no sos esa persona/);
  assert.match(s, /sin markdown/);
  assert.match(s, /No inventás números/);
  assert.match(s, /asesoramiento financiero/);
});

test("limpieza: sin razonamiento oculto ni markdown, y corta en una frase", () => {
  assert.equal(limpiarRespuesta("<think>pienso…</think>Tengo **BTC** largo."), "Tengo BTC largo.");
  assert.equal(limpiarRespuesta("## Título\n- uno\n- dos"), "Título\n· uno\n· dos");
  const largo = limpiarRespuesta(`${"Frase corta. ".repeat(40)}`, 100);
  assert.ok(largo.length <= 103 && largo.endsWith("…"));
});

test("control: una respuesta que no toca lo preguntado se descarta", () => {
  assert.equal(respondeLoPreguntado("Soy un agente que lee rangos y barridas.", "ABIERTAS"), false);
  assert.equal(respondeLoPreguntado("No tengo nada abierto.", "ABIERTAS"), true);
  assert.equal(respondeLoPreguntado("ETH viene fuerte.", "ACTIVO", ["BTC"]), false);
  assert.equal(respondeLoPreguntado("En BTC no tengo posición.", "ACTIVO", ["BTC"]), true);
  assert.equal(respondeLoPreguntado("", "OTRA"), false);
});
