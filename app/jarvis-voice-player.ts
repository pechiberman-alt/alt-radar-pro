/**
 * Plays JARVIS's neural voice (app/api/jarvis/voice) fluidly: the reply is cut
 * into sentences, the first two are requested at once and each next one while
 * the current plays, so after the first second there are no waits between
 * sentences. Any failure — no session, daily allowance used, network — hands
 * the rest of the reply back to the caller to say with the phone's own voice.
 *
 * One <audio> element, unlocked by a tap: mobile browsers only let a page play
 * sound after a gesture, and an element unlocked once can keep playing.
 */
import { splitForSpeech } from "@/lib/speech-text";

export type NeuralState = "unknown" | "ready" | "login" | "quota" | "off";
export type NeuralModel = "aura" | "melo";

let state: NeuralState = "unknown";
let quotaDay = "";
let lastModel: NeuralModel | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function neuralState(): NeuralState {
  // The daily allowance comes back the next day (UTC, like Workers AI).
  if (state === "quota" && quotaDay !== new Date().toISOString().slice(0, 10)) state = "unknown";
  return state;
}
export const neuralModel = () => lastModel;
export function onNeural(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function setState(s: NeuralState) {
  if (s === "quota") quotaDay = new Date().toISOString().slice(0, 10);
  if (s !== state) {
    state = s;
    emit();
  }
}

/** Whether the server has the voice set up (no cost, no session needed). */
export async function probeNeural(): Promise<NeuralState> {
  if (state !== "unknown") return neuralState();
  try {
    const r = await fetch("/api/jarvis/voice", { cache: "no-store", signal: AbortSignal.timeout(6000) });
    const d = (await r.json()) as { ready?: boolean };
    setState(d.ready ? "ready" : "off");
  } catch {
    // Unknown: the first real request will tell.
  }
  return state;
}

let el: HTMLAudioElement | null = null;
let ctx: AudioContext | null = null;
let unlocked = false;
let gen = 0;

/** 50 ms of silence as a WAV, to unlock the audio element inside a tap. */
function silentWav(): string {
  const n = 400;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + n, true);
  w(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  w(36, "data");
  v.setUint32(40, n, true);
  for (let i = 0; i < n; i += 1) v.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

/** Call inside a tap or click (opening JARVIS, the microphone, PROBAR VOZ). */
export function unlockAudio() {
  if (typeof window === "undefined") return;
  el ??= new Audio();
  if (!unlocked) {
    const url = silentWav();
    el.src = url;
    el.play()
      .then(() => {
        unlocked = true;
      })
      .catch(() => undefined)
      .finally(() => window.setTimeout(() => URL.revokeObjectURL(url), 1000));
  }
  if (typeof AudioContext !== "undefined") {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  }
}

/** A short, quiet tone: rising when JARVIS starts listening, falling when it stops. */
export function earcon(kind: "listen" | "stop") {
  if (!ctx || ctx.state !== "running") return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(kind === "listen" ? 660 : 880, t);
  o.frequency.exponentialRampToValueAtTime(kind === "listen" ? 990 : 590, t + 0.12);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.06, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + 0.18);
}

export function stopNeural() {
  gen += 1;
  if (el) {
    el.pause();
    el.removeAttribute("src");
    el.load();
  }
}

type Got = { url: string; model: NeuralModel } | { error: NeuralState | "fail" };

async function fetchAudio(text: string, voice: string, signal: AbortSignal): Promise<Got> {
  try {
    const r = await fetch("/api/jarvis/voice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, voice }), signal });
    if (r.status === 401) return { error: "login" };
    if (r.status === 429) return { error: "quota" };
    if (r.status === 503) {
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      return { error: d.error === "VOZ NO CONFIGURADA" ? "off" : "fail" };
    }
    if (!r.ok) return { error: "fail" };
    const blob = await r.blob();
    if (!blob.size) return { error: "fail" };
    return { url: URL.createObjectURL(blob), model: r.headers.get("X-Voice-Model") === "melo" ? "melo" : "aura" };
  } catch {
    return { error: "fail" };
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((ok) => window.setTimeout(() => ok(fallback), ms))]);
}

/** Plays one clip; resolves "playing" handlers via onPlaying and the promise when it ends (false if it could not play). */
function play(url: string, rate: number, onPlaying: () => void): Promise<boolean> {
  const a = (el ??= new Audio());
  return new Promise((done) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      a.onended = null;
      a.onerror = null;
      a.onplaying = null;
      done(ok);
    };
    a.onplaying = onPlaying;
    a.onended = () => finish(true);
    a.onerror = () => finish(false);
    a.src = url;
    a.playbackRate = rate;
    (a as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
    a.play().catch(() => finish(false));
  });
}

export type SpeakResult = { done: true } | { done: false; rest: string; reason: NeuralState | "fail" };

/**
 * Speaks text that is already in spoken words (speech-text.ts). Stopping
 * (stopNeural) ends it quietly as done.
 */
export async function speakNeural(spoken: string, o: { voice: string; rate: number; onStart?: () => void }): Promise<SpeakResult> {
  stopNeural();
  const g = gen;
  const parts = splitForSpeech(spoken, 260, 110);
  if (!parts.length) return { done: true };
  const ctrl = new AbortController();
  const fetches: Promise<Got>[] = [];
  const get = (i: number) => (fetches[i] ??= withTimeout(fetchAudio(parts[i], o.voice, ctrl.signal), 9000, { error: "fail" as const }));
  get(0);
  if (parts.length > 1) get(1);
  let started = false;
  for (let i = 0; i < parts.length; i += 1) {
    const got = await get(i);
    if (g !== gen) {
      ctrl.abort();
      return { done: true };
    }
    if ("error" in got) {
      if (got.error !== "fail") setState(got.error);
      ctrl.abort();
      return { done: false, rest: parts.slice(i).join(" "), reason: got.error };
    }
    setState("ready");
    lastModel = got.model;
    if (i + 2 < parts.length) get(i + 2);
    const ok = await play(got.url, o.rate, () => {
      if (!started) {
        started = true;
        o.onStart?.();
      }
    });
    URL.revokeObjectURL(got.url);
    if (g !== gen) return { done: true };
    if (!ok) {
      ctrl.abort();
      return { done: false, rest: parts.slice(i).join(" "), reason: "fail" };
    }
  }
  emit();
  return { done: true };
}
