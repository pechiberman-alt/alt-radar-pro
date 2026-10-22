/**
 * Pruebas del cerebro gratis de Gemini (lib/ai-brains.ts): reconocer la clave, elegir el Flash más nuevo de la lista de
 * modelos de la cuenta (sin variantes lite, imagen o vista previa) y que cuente dentro del cupo gratis por persona.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BRAIN_LABEL, freeAllowance, FREE_USER_DAILY, GEMINI_MODEL, isGeminiKey, modeloGemini } from "../lib/ai-brains.ts";

test("la clave de Gemini empieza con AIza", () => {
  assert.equal(isGeminiKey("AIzaSyA1234567890abcdefghijklmnopqrstu"), true);
  assert.equal(isGeminiKey("gsk_1234567890abcdefghijklmnop"), false);
  assert.equal(isGeminiKey("AIza corta"), false);
});

test("elige el Flash más nuevo y deja afuera las variantes", () => {
  const lista = { data: [{ id: "models/gemini-2.5-flash" }, { id: "models/gemini-3.8-flash-lite" }, { id: "models/gemini-3.8-flash" }, { id: "models/gemini-3.9-flash-preview" }, { id: "models/gemini-3-pro" }, { id: "models/gemini-2.5-flash-image" }] };
  assert.equal(modeloGemini(lista), "gemini-3.8-flash");
  assert.equal(modeloGemini({ data: [] }), GEMINI_MODEL, "sin lista, el de los ejemplos de Google");
  assert.equal(modeloGemini(null), GEMINI_MODEL);
});

test("Gemini dice quién habló y respeta el cupo gratis por persona", () => {
  assert.equal(BRAIN_LABEL.gemini, "IA gratis · Gemini");
  assert.equal(freeAllowance({ answers: 0, neuronsAll: 0 }).gemini, true);
  assert.equal(freeAllowance({ answers: FREE_USER_DAILY, neuronsAll: 0 }).gemini, false);
});
