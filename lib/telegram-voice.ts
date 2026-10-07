/**
 * JARVIS on Telegram by voice. A voice note is downloaded, transcribed in
 * Spanish with Whisper on Groq and answered like a question typed in the chat.
 * The answer comes back as text and, within the same daily voice allowance as
 * the app (lib/jarvis-voice-server.ts), as a voice note too. The audio is only
 * held in memory for the length of one request.
 *
 * This is the background channel: a browser cannot listen with the page in
 * the background (lib/hands-free.ts), Telegram can.
 */

/** The longest note JARVIS listens to, in seconds: a minute and a half is a long question. */
export const VOICE_MAX_SECONDS = 90;
/** Telegram's limit for a download is 20 MB; a note of 90 seconds is well under 1 MB. */
export const VOICE_MAX_BYTES = 2_000_000;
export const TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
export const TRANSCRIBE_MODEL = "whisper-large-v3-turbo";
const TELEGRAM_API = "https://api.telegram.org";

/** The voice object Telegram sends for a voice note. */
export type TgVoice = { file_id: string; duration?: number; file_size?: number; mime_type?: string };

/** Why a note cannot be heard, in the words the person reads. Null when it can be. */
export function voiceProblem(voice: TgVoice): string | null {
  if ((voice.duration ?? 0) > VOICE_MAX_SECONDS) {
    return `Tu nota dura más de ${VOICE_MAX_SECONDS} segundos. Mandala más corta, o escribime la pregunta.`;
  }
  if ((voice.file_size ?? 0) > VOICE_MAX_BYTES) {
    return "Tu nota es demasiado pesada para escucharla. Mandala más corta, o escribime la pregunta.";
  }
  return null;
}

/** What Whisper heard, cleaned up. Null when nothing intelligible came back (silence, dots, a stray sound). */
export function cleanTranscript(raw: string | null | undefined): string | null {
  const t = (raw ?? "").replace(/\s+/g, " ").trim();
  if (t.length < 3 || /^[\s.…,;:!?¿¡-]+$/.test(t)) return null;
  return t.slice(0, 1500);
}

/** The answer as speech: no markdown, whole sentences, at most `max` characters. The rest stays in the text. */
export function speechFor(answer: string, max: number): string {
  const plain = answer.replace(/[*_`#>|]+/g, " ").replace(/\s+/g, " ").trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (end >= 40) return cut.slice(0, end + 1);
  const space = cut.lastIndexOf(" ");
  return space > 0 ? cut.slice(0, space) : cut;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The note's bytes from Telegram: first the file path (getFile), then the file.
 * Null when Telegram does not give them. The URLs carry the bot token, so they
 * are never logged, and a failure says nothing more than "no audio".
 */
export async function downloadVoice(token: string, fileId: string, fetchFn: typeof fetch = fetch): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const meta = await fetchFn(`${TELEGRAM_API}/bot${token}/getFile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: fileId }),
      signal: AbortSignal.timeout(10_000),
    });
    const info = (await meta.json().catch(() => null)) as { ok?: boolean; result?: { file_path?: string; file_size?: number } } | null;
    const path = info?.ok ? info.result?.file_path : undefined;
    if (!path || (info?.result?.file_size ?? 0) > VOICE_MAX_BYTES) return null;
    const file = await fetchFn(`${TELEGRAM_API}/file/bot${token}/${path}`, { signal: AbortSignal.timeout(15_000) });
    if (!file.ok) return null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    return bytes.length > 0 && bytes.length <= VOICE_MAX_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

/** Whisper on Groq: the note as Spanish text. Null when it fails or nothing intelligible is heard. */
export async function transcribe(groqKey: string, audio: Uint8Array<ArrayBuffer>, fetchFn: typeof fetch = fetch): Promise<string | null> {
  try {
    const form = new FormData();
    form.append("file", new Blob([audio], { type: "audio/ogg" }), "nota.ogg");
    form.append("model", TRANSCRIBE_MODEL);
    form.append("language", "es");
    form.append("temperature", "0");
    form.append("response_format", "json");
    const r = await fetchFn(TRANSCRIBE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${groqKey}` },
      body: form,
      signal: AbortSignal.timeout(25_000),
    });
    if (!r.ok) return null;
    const d = (await r.json().catch(() => null)) as { text?: string } | null;
    return cleanTranscript(d?.text);
  } catch {
    return null;
  }
}

/** The answer as a voice note (MP3, which Telegram takes as a voice message). True when Telegram accepted it. */
export async function sendVoiceNote(token: string, chatId: string, mp3: Uint8Array<ArrayBuffer>, fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("voice", new Blob([mp3], { type: "audio/mpeg" }), "jarvis.mp3");
    const r = await fetchFn(`${TELEGRAM_API}/bot${token}/sendVoice`, { method: "POST", body: form, signal: AbortSignal.timeout(20_000) });
    return r.ok;
  } catch {
    return false;
  }
}
