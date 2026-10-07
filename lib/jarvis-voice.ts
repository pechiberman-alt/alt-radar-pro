/**
 * JARVIS's neural voice, shared by the server route and the app.
 *
 * Workers AI hosts Deepgram's Aura-2 Spanish voices: natural voices made for
 * assistants (the ones in Cloudflare's catalog are listed here). On the free
 * plan Workers AI gives 10.000 neurons a day, shared by the voice and JARVIS's
 * free AI brain (ai-brains.ts, up to 3.500). Aura-2 costs 2.727 per 1.000
 * characters, so about 2.200 characters a day (6.000 neurons) go to the
 * premium voice and the rest to MeloTTS (18,6 neurons per minute of audio, a
 * simpler neural voice).
 * Nothing is charged on the free plan: past the allowance Workers AI just
 * refuses, and the app goes back to the phone's own voice.
 */

export type NeuralVoice = { id: string; label: string; accent: string; gender: "male" | "female"; style: string };

export const NEURAL_VOICES: NeuralVoice[] = [
  { id: "sirio", label: "Sirio", accent: "México", gender: "male", style: "grave, calmo y profesional" },
  { id: "javier", label: "Javier", accent: "México", gender: "male", style: "profesional y cercano" },
  { id: "aquila", label: "Aquila", accent: "Latinoamérica", gender: "male", style: "expresivo y seguro" },
  { id: "nestor", label: "Néstor", accent: "España", gender: "male", style: "claro y seguro" },
  { id: "alvaro", label: "Álvaro", accent: "España", gender: "male", style: "calmo y profesional" },
  { id: "selena", label: "Selena", accent: "Latinoamérica", gender: "female", style: "calma y cercana" },
  { id: "estrella", label: "Estrella", accent: "México", gender: "female", style: "natural y calma" },
  { id: "celeste", label: "Celeste", accent: "Colombia", gender: "female", style: "clara y enérgica" },
  { id: "diana", label: "Diana", accent: "España", gender: "female", style: "profesional y expresiva" },
  { id: "carina", label: "Carina", accent: "España", gender: "female", style: "profesional y enérgica" },
];

export const DEFAULT_NEURAL: Record<"male" | "female", string> = { male: "sirio", female: "selena" };
export const neuralVoice = (id: string | null | undefined) => NEURAL_VOICES.find((v) => v.id === id) ?? NEURAL_VOICES[0];

/** Longest text per request: the app sends one or two sentences at a time. */
export const VOICE_MAX_CHARS = 400;
/** Premium characters per day for everyone together (≈ 6.000 of the 10.000 free neurons; 3.500 are the free AI's). */
export const PREMIUM_DAILY_CHARS = 2200;
/** Neural characters per person per day, premium or not, so nobody can drain the allowance. */
export const USER_DAILY_CHARS = 8000;
