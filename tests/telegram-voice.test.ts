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
