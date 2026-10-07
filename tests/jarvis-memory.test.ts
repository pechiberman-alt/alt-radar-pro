import assert from "node:assert/strict";
import test from "node:test";
import { addMemory, cleanNote, forgetMemory, listMemory, MEMORY_MAX, memoryBlock } from "../lib/jarvis-memory.ts";
import { parseCommand } from "../lib/jarvis.ts";
import { makeDb, sqlite } from "./helpers/fake-d1.ts";

test("notes are kept tidy: no leading 'que', a capital, one line, bounded", () => {
  assert.equal(cleanNote("que  opero solo BTC\ny SOL. "), "Opero solo BTC y SOL");
  assert.equal(cleanNote("x".repeat(500)).length, 300);
  assert.equal(cleanNote("   "), "");
});

test("memory: per person, the same note once, the oldest dropped past the limit, forgotten by its words", { skip: !sqlite }, async () => {
  const db = makeDb();
  assert.deepEqual(await addMemory(db, 1, "opero solo BTC y SOL con 1% de riesgo", 1), { saved: true, text: "Opero solo BTC y SOL con 1% de riesgo", total: 1 });
  assert.equal((await addMemory(db, 1, "Opero solo btc y sol con 1% de riesgo.", 2)).saved, false, "the same note twice is kept once");
  await addMemory(db, 2, "Prefiero respuestas cortas", 3);
  assert.deepEqual((await listMemory(db, 1)).map((n) => n.text), ["Opero solo BTC y SOL con 1% de riesgo"], "each person only sees theirs");
  for (let i = 0; i < MEMORY_MAX + 2; i++) await addMemory(db, 3, `nota número ${i}`, 10 + i);
  const three = await listMemory(db, 3);
  assert.equal(three.length, MEMORY_MAX);
  assert.equal(three[0].text, "Nota número 2", "the two oldest were dropped");
  assert.deepEqual((await forgetMemory(db, 1, "sol")).map((n) => n.text), ["Opero solo BTC y SOL con 1% de riesgo"]);
  assert.deepEqual(await forgetMemory(db, 2, "algo que no está"), []);
  assert.equal((await forgetMemory(db, 3, "todo")).length, MEMORY_MAX);
  assert.deepEqual(await listMemory(db, 3), []);
  assert.deepEqual(await listMemory(db, 2), [{ id: 2, text: "Prefiero respuestas cortas", at: 3 }]);
});

test("every brain gets the notes as one block; none, nothing", () => {
  assert.equal(memoryBlock([]), "");
  assert.match(memoryBlock([{ id: 1, text: "Opero solo BTC", at: 0 }]), /^MEMORIA DEL USUARIO[\s\S]*\n- Opero solo BTC$/);
});

test("JARVIS understands remember, forget and recall — and 'pump' alone is the PUMP tab, not the coin", () => {
  const known = new Set(["BTC", "PUMP"]);
  assert.deepEqual(parseCommand("Jarvis, recordá que opero solo BTC con 1% de riesgo", known), { kind: "REMEMBER", text: "opero solo BTC con 1% de riesgo" });
  assert.deepEqual(parseCommand("acordate: prefiero respuestas cortas"), { kind: "REMEMBER", text: "prefiero respuestas cortas" });
  assert.deepEqual(parseCommand("guardá en tu memoria que el oro me interesa"), { kind: "REMEMBER", text: "el oro me interesa" });
  assert.deepEqual(parseCommand("¿Qué recordás?"), { kind: "MEMORY" });
  assert.deepEqual(parseCommand("qué sabés de mí"), { kind: "MEMORY" });
  assert.deepEqual(parseCommand("Olvidá lo de SOL"), { kind: "FORGET", text: "sol" });
  assert.deepEqual(parseCommand("borrá todo lo que sabés"), { kind: "FORGET", text: "todo" });
  assert.deepEqual(parseCommand("¿Qué aprendiste?"), { kind: "LEARN" }, "what the core learned is another thing");
  assert.deepEqual(parseCommand("Pump", known), { kind: "SECTION", section: "pumpeo", label: "PUMPEO" });
  assert.deepEqual(parseCommand("mapa de pump", known), { kind: "MAP", symbol: "PUMP", timeframe: null });
  assert.deepEqual(parseCommand("Analizalo", known), { kind: "AI", question: "Analizalo" });
});
