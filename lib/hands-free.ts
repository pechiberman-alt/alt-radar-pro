/**
 * Manos libres: the rules behind JARVIS's listening mode in the browser.
 *
 * The browser's speech engine misbehaves in the ways a hands-free mode cannot
 * afford. On Android Chrome it can deliver a result it already gave (one
 * "Jarvis" was greeted three times on a phone), it stops listening when the
 * page is hidden, it fails in bursts, and JARVIS's own voice comes back into
 * the microphone while it speaks. This module decides, for each engine event,
 * what JARVIS does. The panel only wires events to it, so every rule is tested
 * without a microphone.
 *
 * What it cannot do is listen with the page in the background: the browser
 * takes the microphone away together with the page. The panel says so: for
 * that, JARVIS is reached on Telegram, where it answers with the page closed.
 */

/** After "Jarvis" or a command, a phrase without the wake word still counts for this long. */
export const WAKE_WINDOW_MS = 10_000;
/** After JARVIS stops speaking, the microphone can still hear the tail of its voice. */
export const ECHO_MS = 1_200;
/** "Jarvis" alone is acknowledged at most once per gap. */
export const GREET_GAP_MS = 4_000;
/** The same phrase again within this gap is a re-delivery, not something new said. */
export const REPEAT_MS = 2_500;
/** How long JARVIS's own words are recognised as echo after it spoke them. */
export const SPOKEN_MEMORY_MS = 15_000;
/** Safety net: a speech that never reports its end must not keep the engine deaf for longer. */
export const MAX_SPEECH_MS = 120_000;

const WAKE = /\b(?:jarvis|jarbis|yarvis|jarvi)\b[\s,.:;!?]*/i;

/** Whether the wake word was said, and what came after it. */
export function afterWake(text: string): { woke: boolean; rest: string } {
  const m = WAKE.exec(text);
  if (!m) return { woke: false, rest: "" };
  return { woke: true, rest: text.slice(m.index + m[0].length).trim() };
}

/** Lowercase words without accents: "Analizá, BTC" → ["analiza", "btc"]. */
export function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export type Stop = "permiso" | "micrófono" | "red";
export type Heard = { type: "none" } | { type: "awake" } | { type: "command"; text: string };
export type Engine = { type: "none" } | { type: "restart"; inMs: number } | { type: "stop"; reason: Stop };
export type Visibility = "none" | "start" | "abort";

const NONE: Heard = { type: "none" };
const IDLE: Engine = { type: "none" };
const STOP_TEXT: Record<Stop, string> = {
  permiso: "SIN PERMISO DEL MICRÓFONO · permitilo en el navegador y reactivá Manos libres",
  "micrófono": "NO ENCUENTRO EL MICRÓFONO · revisá el dispositivo y reactivá Manos libres",
  red: "EL DICTADO NO RESPONDE · reactivá Manos libres cuando tengas conexión",
};

export class HandsFree {
  private enabled = false;
  private visible = true;
  private stopped: Stop | null = null;
  private speakingUntil = 0;
  private echoUntil = 0;
  private windowUntil = 0;
  /** A command was accepted: its answer, once spoken, opens the follow-up window. */
  private followUp = false;
  private lastIndex = -1;
  private lastText = "";
  private lastAt = Number.NEGATIVE_INFINITY;
  private lastGreetAt = Number.NEGATIVE_INFINITY;
  private failures = 0;
  private spoken: { words: Set<string>; at: number } | null = null;

  /** The engine should run now: switched on, page visible, nothing stopped it. */
  get active(): boolean {
    return this.enabled && this.visible && this.stopped === null;
  }

  enable(): void {
    this.enabled = true;
    this.stopped = null;
    this.failures = 0;
  }

  /** Switching off keeps a stop reason, so the panel can still say why it stopped. */
  disable(): void {
    this.enabled = false;
    this.windowUntil = 0;
    this.followUp = false;
  }

  /** The browser takes the microphone with the page: stop when hidden, go on when visible again. */
  setVisible(visible: boolean): Visibility {
    if (visible === this.visible) return "none";
    this.visible = visible;
    if (!visible) return this.enabled ? "abort" : "none";
    if (this.active) {
      this.failures = 0;
      return "start";
    }
    return "none";
  }

  /** A new engine session: its results start again from 0. */
  started(): void {
    this.lastIndex = -1;
  }

  /** JARVIS starts or stops speaking. `said` is what it says, so its echo is recognised. */
  busy(on: boolean, now: number, said = ""): void {
    if (on) {
      this.speakingUntil = now + MAX_SPEECH_MS;
      if (said) this.spoken = { words: new Set(words(said).filter((w) => w.length >= 3)), at: now };
      return;
    }
    this.speakingUntil = 0;
    this.echoUntil = now + ECHO_MS;
    if (this.spoken) this.spoken.at = now;
    if (this.followUp) {
      this.windowUntil = now + WAKE_WINDOW_MS;
      this.followUp = false;
    }
  }

  /** One final phrase. `index` is its place in the engine's results, which the engine may repeat. */
  final(index: number, text: string, now: number): Heard {
    if (!this.active || index <= this.lastIndex) return NONE;
    this.lastIndex = index;
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean || now < this.speakingUntil || now < this.echoUntil || this.isEcho(clean, now)) return NONE;
    if (clean.toLowerCase() === this.lastText && now - this.lastAt < REPEAT_MS) return NONE;
    this.lastText = clean.toLowerCase();
    this.lastAt = now;
    this.failures = 0;

    const { woke, rest } = afterWake(clean);
    if (woke && rest) return this.accept(rest, now);
    if (woke) {
      this.windowUntil = now + WAKE_WINDOW_MS;
      if (now - this.lastGreetAt < GREET_GAP_MS) return NONE;
      this.lastGreetAt = now;
      return { type: "awake" };
    }
    return now < this.windowUntil ? this.accept(clean, now) : NONE;
  }

  /** The engine ended on its own (it does, after silence): restart it, backing off after failures. */
  ended(): Engine {
    if (!this.active) return IDLE;
    const inMs = this.failures === 0 ? 250 : Math.min(30_000, 500 * 2 ** (this.failures - 1));
    return { type: "restart", inMs };
  }

  /** The engine reported an error. Silence is not an error; the rest back off, and some stop it for good. */
  error(code: string): Engine {
    if (!this.active) return IDLE;
    if (code === "not-allowed" || code === "service-not-allowed") return this.halt("permiso");
    if (code === "no-speech") return IDLE;
    this.failures += 1;
    if (code === "audio-capture" && this.failures >= 2) return this.halt("micrófono");
    if (this.failures >= 6) return this.halt("red");
    return IDLE;
  }

  /** What the panel says, now. */
  status(now: number): string {
    if (this.stopped) return STOP_TEXT[this.stopped];
    if (!this.enabled) return "";
    if (!this.visible) return "EN PAUSA · la app quedó en segundo plano: con la pantalla apagada mandame una nota de voz por Telegram";
    if (now < this.speakingUntil) return "HABLANDO · no te escucho mientras hablo";
    if (now < this.windowUntil) return "TE ESCUCHO · decí tu pedido";
    return "ESCUCHANDO · decí «Jarvis» y tu pedido";
  }

  /** When the status changes by itself (the follow-up window closes). */
  windowEndsAt(): number {
    return this.windowUntil;
  }

  private accept(text: string, now: number): Heard {
    this.windowUntil = now + WAKE_WINDOW_MS;
    this.followUp = true;
    return { type: "command", text };
  }

  private halt(reason: Stop): Engine {
    this.stopped = reason;
    return { type: "stop", reason };
  }

  /** Most of the phrase is JARVIS's own last words: the microphone heard the speaker. */
  private isEcho(text: string, now: number): boolean {
    const said = this.spoken;
    if (!said || now - said.at > SPOKEN_MEMORY_MS) return false;
    const heard = words(text).filter((w) => w.length >= 3);
    if (heard.length < 3) return false;
    // Strict on purpose: a question that reuses two words of the last answer ("el soporte de BTC") is a question.
    const hits = heard.filter((w) => said.words.has(w)).length;
    return hits / heard.length >= 0.8;
  }
}
