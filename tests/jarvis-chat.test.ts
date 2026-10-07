import assert from "node:assert/strict";
import test from "node:test";
import { CHAT_KEEP_MS, CHAT_SHOW, CHAT_TURN_MAX, CHAT_WINDOW_MS, cleanTurns, clearThread, readThread, saveTurns } from "../lib/jarvis-chat.ts";
import { makeDb } from "./helpers/fake-d1.ts";

const T0 = Date.UTC(2026, 9, 7, 18, 0, 0);

test("only question and answer turns are kept, trimmed and bounded", () => {
  assert.deepEqual(
    cleanTurns([{ role: "user", text: "  hola \n  Jarvis " }, { role: "system", text: "x" }, { role: "assistant", text: "" }, null, { role: "assistant", text: 42 }]),
    [{ role: "user", text: "hola Jarvis" }],
  );
  assert.equal(cleanTurns([{ role: "user", text: "x".repeat(5000) }])[0].text.length, CHAT_TURN_MAX);
  assert.equal(cleanTurns("no es una lista").length, 0);
  assert.equal(cleanTurns(Array.from({ length: 9 }, () => ({ role: "user", text: "a" }))).length, 4, "a few turns at most in one write");
});

test("the thread comes back in order, and only to its owner", async () => {
  const db = makeDb();
  await saveTurns(db, 1, [{ role: "user", text: "precio de BTC" }, { role: "assistant", text: "BTC está en 82.920" }], T0);
  await saveTurns(db, 2, [{ role: "user", text: "otra persona" }], T0);
  const mine = await readThread(db, 1, T0 + 60_000);
  assert.deepEqual(
    mine.map((t) => [t.role, t.text]),
    [
      ["user", "precio de BTC"],
      ["assistant", "BTC está en 82.920"],
    ],
  );
  assert.equal((await readThread(db, 2, T0 + 60_000)).length, 1);
});

test("a thread older than six hours starts fresh, as the Telegram thread does", async () => {
  const db = makeDb();
  await saveTurns(db, 1, [{ role: "user", text: "vieja" }], T0);
  assert.equal((await readThread(db, 1, T0 + CHAT_WINDOW_MS - 1)).length, 1);
  assert.equal((await readThread(db, 1, T0 + CHAT_WINDOW_MS + 1)).length, 0);
});

test("the panel reads back at most CHAT_SHOW turns, the newest ones", async () => {
  const db = makeDb();
  for (let i = 0; i < 35; i += 1) await saveTurns(db, 1, [{ role: "user", text: `pregunta ${i}` }], T0 + i);
  const got = await readThread(db, 1, T0 + 100);
  assert.equal(got.length, CHAT_SHOW);
  assert.equal(got[0].text, `pregunta ${35 - CHAT_SHOW}`, "the oldest of the newest turns comes first");
  assert.equal(got[got.length - 1].text, "pregunta 34");
});

test("turns older than two days are pruned on the next write", async () => {
  const db = makeDb();
  await saveTurns(db, 1, [{ role: "user", text: "de hace tres días" }], T0);
  await saveTurns(db, 1, [{ role: "user", text: "hoy" }], T0 + CHAT_KEEP_MS + 1_000);
  const left = await db.prepare("SELECT content FROM jarvis_chat WHERE user_id = 1").all<{ content: string }>();
  assert.deepEqual(
    left.results.map((r) => r.content),
    ["hoy"],
  );
});

test("'Nueva charla' forgets this person's turns and no one else's", async () => {
  const db = makeDb();
  await saveTurns(db, 1, [{ role: "user", text: "a" }], T0);
  await saveTurns(db, 2, [{ role: "user", text: "b" }], T0);
  await clearThread(db, 1);
  assert.equal((await readThread(db, 1, T0 + 1)).length, 0);
  assert.equal((await readThread(db, 2, T0 + 1)).length, 1);
});
