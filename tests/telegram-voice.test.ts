import assert from "node:assert/strict";
import test from "node:test";
import { cleanTranscript, downloadVoice, escapeHtml, sendVoiceNote, speechFor, transcribe, TRANSCRIBE_MODEL, TRANSCRIBE_URL, voiceProblem, VOICE_MAX_BYTES, VOICE_MAX_SECONDS } from "../lib/telegram-voice.ts";

type Call = { url: string; init?: RequestInit };

/** A fetch that answers from a script and remembers what it was asked. */
function fakeFetch(answer: (url: string) => Response) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return answer(String(url));
  }) as unknown as typeof fetch;
  return { fn, calls };
}

test("a note too long or too heavy is refused in words; a short one goes through", () => {
  assert.match(voiceProblem({ file_id: "a", duration: VOICE_MAX_SECONDS + 1 }) ?? "", /más de 90 segundos/);
  assert.match(voiceProblem({ file_id: "a", file_size: VOICE_MAX_BYTES + 1 }) ?? "", /demasiado pesada/);
  assert.equal(voiceProblem({ file_id: "a", duration: 12, file_size: 40_000 }), null);
  assert.equal(voiceProblem({ file_id: "a" }), null, "unknown sizes are not refused up front");
});

test("what Whisper heard is cleaned; silence and stray dots are nothing heard", () => {
  assert.equal(cleanTranscript("  Qué  opina del BTC?  "), "Qué opina del BTC?");
  assert.equal(cleanTranscript("..."), null);
  assert.equal(cleanTranscript(" a "), null);
  assert.equal(cleanTranscript(undefined), null);
  assert.equal(cleanTranscript("x".repeat(3000))?.length, 1500);
});

test("the answer is spoken without markdown, in whole sentences; the rest stays in the text", () => {
  assert.equal(speechFor("**SOL** está en 150,25.", 400), "SOL está en 150,25.");
  const long = "BTC sostiene el soporte en 82.000. El riesgo está controlado con un stop bajo. " + "Dato extra ".repeat(60);
  const said = speechFor(long, 200);
  assert.ok(said.length <= 200);
  assert.ok(said.endsWith("."), "it ends at a sentence, not in the middle of a word");
  assert.equal(speechFor("palabra ".repeat(100), 50).endsWith(" "), false);
});

test("the note goes to Whisper on Groq in Spanish; the key only travels as a header", async () => {
  const { fn, calls } = fakeFetch(() => new Response(JSON.stringify({ text: " Qué opina de SOL " }), { status: 200 }));
  const text = await transcribe("gsk_test", new Uint8Array([1, 2, 3]), fn);
  assert.equal(text, "Qué opina de SOL");
  assert.equal(calls[0].url, TRANSCRIBE_URL);
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, "Bearer gsk_test");
  const form = calls[0].init?.body as FormData;
  assert.equal(form.get("model"), TRANSCRIBE_MODEL);
  assert.equal(form.get("language"), "es");
  assert.equal((form.get("file") as File).type, "audio/ogg");
});

test("a failed transcription says nothing was heard, and never throws", async () => {
  const bad = fakeFetch(() => new Response("nope", { status: 500 }));
  assert.equal(await transcribe("k", new Uint8Array([1]), bad.fn), null);
  const broken = (async () => {
    throw new Error("red caída");
  }) as unknown as typeof fetch;
  assert.equal(await transcribe("k", new Uint8Array([1]), broken), null);
});

test("the note comes in two steps: Telegram's file path, then the file", async () => {
  const { fn, calls } = fakeFetch((url) => {
    if (url.endsWith("/getFile")) return new Response(JSON.stringify({ ok: true, result: { file_path: "voice/file_7.oga", file_size: 3 } }));
    return new Response(new Uint8Array([79, 103, 103]));
  });
  const bytes = await downloadVoice("123:ABC", "file-id", fn);
  assert.deepEqual([...(bytes ?? [])], [79, 103, 103]);
  assert.match(calls[0].url, /\/bot123:ABC\/getFile$/);
  assert.match(calls[1].url, /\/file\/bot123:ABC\/voice\/file_7\.oga$/);
});

test("when Telegram does not give the file there is no audio, and no crash", async () => {
  const none = fakeFetch(() => new Response(JSON.stringify({ ok: false, description: "no" })));
  assert.equal(await downloadVoice("t", "f", none.fn), null);
});

test("the answer goes back as a voice note: an MP3 to the same chat", async () => {
  const { fn, calls } = fakeFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  assert.equal(await sendVoiceNote("t", "42", new Uint8Array([255, 251]), fn), true);
  assert.match(calls[0].url, /\/sendVoice$/);
  const form = calls[0].init?.body as FormData;
  assert.equal(form.get("chat_id"), "42");
  assert.equal((form.get("voice") as File).type, "audio/mpeg");
});

test("text that goes into the chat as HTML is escaped", () => {
  assert.equal(escapeHtml("<b>& 1 < 2</b>"), "&lt;b&gt;&amp; 1 &lt; 2&lt;/b&gt;");
});

/* ── Whisper on Workers AI: voice notes with no Groq key ── */

import { toBase64, transcribeWorkers, whisperNeurons, WORKERS_WHISPER, WORKERS_WHISPER_FALLBACK } from "../lib/telegram-voice.ts";
import { answerVoiceInTelegram } from "../lib/telegram-ai-server.ts";
import { FREE_DAILY_NEURONS } from "../lib/ai-brains.ts";
import { makeDb } from "./helpers/fake-d1.ts";

test("what Whisper invents over silence (subtitle credits) is nothing heard", () => {
  assert.equal(cleanTranscript("Subtítulos realizados por la comunidad de Amara.org"), null);
  assert.equal(cleanTranscript("¡Gracias por ver el video!"), null);
  assert.equal(cleanTranscript("¿Cómo ves el soporte de BTC?"), "¿Cómo ves el soporte de BTC?");
});

test("a note costs its minutes of audio in neurons; an unknown length counts as the longest", () => {
  assert.equal(whisperNeurons(30), 24);
  assert.equal(whisperNeurons(60), 47);
  assert.equal(whisperNeurons(undefined), whisperNeurons(VOICE_MAX_SECONDS));
  assert.equal(whisperNeurons(10_000), whisperNeurons(VOICE_MAX_SECONDS), "never more than the longest note allowed");
});

test("base64 of a long note is exact and does not overflow the stack", () => {
  const bytes = new Uint8Array(200_000).map((_, i) => (i * 37) % 256);
  assert.equal(toBase64(bytes), Buffer.from(bytes).toString("base64"));
});

test("Workers AI hears the note in Spanish; if the turbo model refuses it, the older one gets the raw bytes", async () => {
  const asked: { model: string; input: Record<string, unknown> }[] = [];
  const ok = { run: async (model: string, input: Record<string, unknown>) => (asked.push({ model, input }), { text: "  qué hace ETH  " }) };
  assert.equal(await transcribeWorkers(ok, new Uint8Array([1, 2, 3])), "qué hace ETH");
  assert.equal(asked[0].model, WORKERS_WHISPER);
  assert.equal(asked[0].input.language, "es");
  assert.equal(asked[0].input.audio, "AQID");

  asked.length = 0;
  const turboDown = {
    run: async (model: string, input: Record<string, unknown>) => {
      asked.push({ model, input });
      if (model === WORKERS_WHISPER) throw new Error("5006: audio rechazado");
      return { text: "precio de SOL" };
    },
  };
  assert.equal(await transcribeWorkers(turboDown, new Uint8Array([7, 8])), "precio de SOL");
  assert.deepEqual(asked.map((a) => a.model), [WORKERS_WHISPER, WORKERS_WHISPER_FALLBACK]);
  assert.deepEqual(asked[1].input.audio, [7, 8]);

  const allDown = { run: async () => Promise.reject(new Error("caído")) };
  assert.equal(await transcribeWorkers(allDown, new Uint8Array([1])), null);
});

test("silence heard by the turbo model is the answer: the older model is not paid for too", async () => {
  const models: string[] = [];
  const quiet = { run: async (model: string) => (models.push(model), { text: " ... " }) };
  assert.equal(await transcribeWorkers(quiet, new Uint8Array([1])), null);
  assert.deepEqual(models, [WORKERS_WHISPER]);
});

/** Telegram, the market APIs and the AI, all faked: what the bot sends is recorded. */
async function withFakes(fn: (sent: string[]) => Promise<void>) {
  const sent: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = String(input);
    if (u.includes("/getFile")) return new Response(JSON.stringify({ ok: true, result: { file_path: "voice/a.oga", file_size: 6 } }));
    if (u.includes("/file/bot")) return new Response(new Uint8Array([79, 103, 103, 83, 0, 2]));
    if (u.includes("api.telegram.org")) {
      const body = init?.body;
      if (typeof body === "string") sent.push(String((JSON.parse(body) as { text?: string }).text ?? ""));
      return new Response(JSON.stringify({ ok: true, result: {} }));
    }
    return new Response("{}", { status: 503 });
  }) as typeof fetch;
  try {
    await fn(sent);
  } finally {
    globalThis.fetch = real;
  }
}

test("with no Groq key the note is heard by Workers AI, answered, and its neurons are counted", async () => {
  const db = makeDb();
  const models: string[] = [];
  const ai = {
    run: async (model: string) => {
      models.push(model);
      if (model === WORKERS_WHISPER) return { text: "¿Cómo ves BTC?" };
      if (model.includes("qwen")) return { response: "BTC está en zona de soporte. No es asesoramiento financiero.", usage: { prompt_tokens: 100, completion_tokens: 20 } };
      throw new Error("sin voz en la prueba");
    },
  };
  await withFakes(async (sent) => {
    await answerVoiceInTelegram(db, { AI: ai } as never, "1:T", "42", 7, { file_id: "f", duration: 30 });
    assert.ok(sent.some((t) => t.includes("Escuché") && t.includes("¿Cómo ves BTC?")), sent.join(" | "));
    assert.ok(sent.some((t) => t.includes("zona de soporte")), "the question is answered in the same chat");
  });
  assert.equal(models[0], WORKERS_WHISPER);
  const row = await db.prepare("SELECT neurons FROM ai_free_usage WHERE user_id = 0").first<{ neurons: number }>();
  assert.ok((row?.neurons ?? 0) >= whisperNeurons(30), "the note's neurons come out of the free share");
});

test("when the free neurons are used up the bot says so and does not run Whisper", async () => {
  const db = makeDb();
  const day = new Date().toISOString().slice(0, 10);
  await db.prepare("CREATE TABLE IF NOT EXISTS ai_free_usage (day TEXT NOT NULL, user_id INTEGER NOT NULL, answers INTEGER NOT NULL, neurons REAL NOT NULL, PRIMARY KEY (day, user_id))").run();
  await db.prepare("INSERT INTO ai_free_usage (day, user_id, answers, neurons) VALUES (?1, 0, 9, ?2)").bind(day, FREE_DAILY_NEURONS - 5).run();
  const models: string[] = [];
  const ai = { run: async (model: string) => (models.push(model), { text: "hola" }) };
  await withFakes(async (sent) => {
    await answerVoiceInTelegram(db, { AI: ai } as never, "1:T", "42", 7, { file_id: "f", duration: 20 });
    assert.ok(sent.some((t) => /cupo gratis para escuchar/.test(t)), sent.join(" | "));
  });
  assert.deepEqual(models, []);
});

test("with neither a Groq key nor Workers AI the bot says it cannot listen yet, without downloading", async () => {
  await withFakes(async (sent) => {
    await answerVoiceInTelegram(makeDb(), {} as never, "1:T", "42", 7, { file_id: "f", duration: 5 });
    assert.ok(sent.some((t) => /falta configurar el reconocimiento de voz/.test(t)));
  });
});
