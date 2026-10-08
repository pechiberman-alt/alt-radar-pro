"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { openInMap, showSection } from "@/lib/account-events";
import { eligible } from "@/lib/decoupling";
import { briefingText, findCoins, findTimeframe, greeting, HELP_TEXT, parseCommand, priceLine, type JarvisIntent, type Ticker } from "@/lib/jarvis";
import { compareDesks, deskForAi, deskSpeech, deskTicket, entrySpeech, indicatorsSpeech, liquidationRisk, macroBrief, macroKindOf, macroSpeech, whatIf, type DeskDecision } from "@/lib/jarvis-desk";
import { cachedDesk, deskFor, showInDesk } from "@/lib/jarvis-desk-run";
import { canPaper, paperForAi, paperSpeech } from "@/lib/jarvis-paper";
import { loadPaper, openFromDesk, paperTrades, refreshPaper } from "@/lib/jarvis-paper-run";
import { arNumber } from "@/lib/ai-numbers";
import { backtestForAi, backtestSpeech } from "@/lib/jarvis-backtest";
import { lastBacktest, runBacktestFor } from "@/lib/jarvis-backtest-run";
import { loadCalendar } from "@/lib/econ-calendar";
import { compactSnapshot } from "@/lib/ai-analyst";
import type { AssistantContext } from "@/lib/assistant/index";
import { localAnswer, pointsAtScreen, SECTION_SCREEN, withFocus, type Focus } from "@/lib/jarvis-local";
import { analysisForAi, analysisText, analyzeAsset, type Analysis } from "@/lib/jarvis-analyst";
import { readingSpeech } from "@/lib/jarvis-mind";
import { BRAIN_LABEL } from "@/lib/ai-brains";
import { FUTURES_BASES, loadRows, loadTopSymbols, timeframeConfig } from "@/lib/market-fetch";
import { readPreBreak } from "@/lib/pre-breakout";
import { addSignals, breakoutSignal, ledgerCsv, ledgerStats, magnetSignal, resolveSignal, statsSpeech, type JarvisSignal } from "@/lib/jarvis-ledger";
import { buildLiquidationHeatmap } from "@/lib/liquidation-heatmap";
import { magnetEvents, strongestMagnets } from "@/lib/magnet-watch";
import { parseSwingKlines } from "@/lib/swing-entries";
import { everyVisible } from "@/lib/visible-interval";
import { pickVoice } from "@/lib/browser-voice";
import { awaySpeech, breakoutsFromMind, coreContext, coreOnline, coreStatusSpeech, feedLabel, feedSpeech, GRADE_LABEL, reviveSnapshot, type CoreSignal, type CoreSnapshot } from "@/lib/jarvis-core";
import { fmtExpect, learnSpeech, venuesSpeech } from "@/lib/jarvis-learn";
import { DEFAULT_NEURAL, NEURAL_VOICES, neuralVoice } from "@/lib/jarvis-voice";
import { earcon, neuralModel, neuralState, onNeural, probeNeural, speakNeural, stopNeural, unlockAudio } from "./jarvis-voice-player";
import { normalizeSpanish, splitForSpeech } from "@/lib/speech-text";
import { ECHO_MS, HandsFree, MAX_SPEECH_MS, type MicPermission } from "@/lib/hands-free";

/**
 * JARVIS: a voice assistant over the whole app. It listens (Web Speech API,
 * es-AR), speaks back, opens sections and coins, reads prices, briefs the
 * market, watches for coins about to break and, for anything else, asks the
 * AI analyst. Voice and listening run in the browser.
 *
 * Its CORE runs on the server 24/7 (lib/jarvis-core.ts): it scans, records and
 * resolves its own signals with the app closed, studies the market's history
 * candle by candle to learn which signals work in which context
 * (lib/jarvis-learn.ts), and sends what it takes by Telegram. The panel reads
 * the core's status, record and lessons, tells what it did while you were
 * away, and gives the AI that context so it answers knowing its own track record.
 *
 * It speaks with a neural voice served by Cloudflare (app/jarvis-voice-player.ts),
 * sentence by sentence so it never waits between sentences, and falls back to
 * the phone's own voice without cutting off.
 */

/** `tag`: which brain answered (Claude, a free AI, the local analyst), shown next to the name. */
type Line = { who: "yo" | "jarvis"; text: string; tag?: string };
type JarvisProps = { getContext?: () => AssistantContext; screen?: string };
type Mode = "idle" | "listening" | "thinking" | "speaking";
type Breakout = { symbol: string; side: string; score: number; signal: JarvisSignal | null };

const LEDGER_KEY = "alt-radar-pro:jarvis-ledger:v1";
/** When this device last heard from the core, for "what happened while you were away". */
const CORE_SEEN_KEY = "alt-radar-pro:jarvis-core-seen:v1";

async function fetchCore(): Promise<CoreSnapshot | null> {
  try {
    const r = await fetch("/api/jarvis/core", { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    return reviveSnapshot((await r.json()) as CoreSnapshot);
  } catch {
    return null;
  }
}

function takeAway(snap: CoreSnapshot): string | null {
  let seen = 0;
  try {
    seen = Number(window.localStorage.getItem(CORE_SEEN_KEY) ?? 0);
    window.localStorage.setItem(CORE_SEEN_KEY, String(Date.now()));
  } catch {
    return null;
  }
  return seen ? awaySpeech([...snap.open, ...snap.recent], seen) : null;
}
function loadLedger(): JarvisSignal[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(LEDGER_KEY) ?? "[]");
    return Array.isArray(raw) ? (raw as JarvisSignal[]) : [];
  } catch {
    return [];
  }
}

async function closedCandles(symbol: string, tf: string, limit: number) {
  const frameMs = timeframeConfig(tf).frameMs;
  const now = Date.now();
  return parseSwingKlines(await loadRows(symbol, tf, limit, new AbortController().signal)).filter((c) => c.openTime + frameMs <= now);
}

/** Liquidation-magnet sweeps that closed back, on BTC/ETH/SOL 1h: reversal signals. */
async function scanMagnetSignals(): Promise<JarvisSignal[]> {
  const cfg = timeframeConfig("1h");
  const out: JarvisSignal[] = [];
  for (const symbol of ["BTCUSDT", "ETHUSDT", "SOLUSDT"]) {
    try {
      const candles = await closedCandles(symbol, "1h", 500);
      if (candles.length < 200) continue;
      const opts = { halfLifeCandles: cfg.halfLife, priceRangePct: cfg.priceRange };
      const prev = candles.slice(0, -1);
      const before = buildLiquidationHeatmap(symbol, prev, prev[prev.length - 1].close, opts);
      const now = buildLiquidationHeatmap(symbol, candles, candles[candles.length - 1].close, opts);
      const pair = now ? strongestMagnets(now, candles[candles.length - 1].close) : null;
      for (const e of magnetEvents(candles, before, now, { minIntensity: 70 })) {
        const sig = magnetSignal(symbol, "1h", candles, e, pair);
        if (sig) out.push(sig);
      }
    } catch {
      // skip this coin this round
    }
  }
  return out;
}

const fmtPx = (v: number) => v.toLocaleString("es-AR", { maximumFractionDigits: v >= 1000 ? 0 : v >= 1 ? 3 : 6 });
const signalSpeech = (s: JarvisSignal) =>
  `Señal registrada: ${s.symbol.replace(/USDT$/, "")} ${s.side === "LONG" ? "largo" : "corto"} en ${s.timeframe}, entrada ${fmtPx(s.entry)}, stop ${fmtPx(s.stop)}, objetivo ${fmtPx(s.target)}.`;

const PREFS_KEY = "alt-radar-pro:jarvis:v1";
// Device voices load asynchronously ("voiceschanged"); keep one list for the picker.
let voiceList: SpeechSynthesisVoice[] = [];
const NO_VOICES: SpeechSynthesisVoice[] = [];
function subscribeVoices(cb: () => void): () => void {
  if (typeof speechSynthesis === "undefined") return () => undefined;
  const update = () => {
    voiceList = speechSynthesis.getVoices().filter((v) => /^es/i.test(v.lang));
    cb();
  };
  update();
  speechSynthesis.addEventListener("voiceschanged", update);
  return () => speechSynthesis.removeEventListener("voiceschanged", update);
}
const getVoices = () => voiceList;
const getNoVoices = () => NO_VOICES;
type Prefs = {
  name: string;
  voice: boolean;
  wake: boolean;
  watch: boolean;
  lastBriefing: string;
  /** "neural": the server's neural voice (falls back to the phone's); "device": the phone's own. */
  engine: "neural" | "device";
  neuralVoice: string;
  /** After answering something asked by voice, listen once more for a follow-up. */
  followUp: boolean;
  /** Device voice by name; "" = the best Spanish one available. */
  voiceName: string;
  gender: "male" | "female";
  rate: number;
};
const DEFAULT_PREFS: Prefs = {
  name: "señor",
  voice: true,
  wake: false,
  watch: false,
  lastBriefing: "",
  engine: "neural",
  neuralVoice: DEFAULT_NEURAL.male,
  followUp: true,
  voiceName: "",
  gender: "male",
  rate: 1,
};
const neuralSnapshot = () => `${neuralState()}|${neuralModel() ?? ""}`;
const neuralServer = () => "unknown|";
const VOICE_TEST = "Hola. Soy JARVIS, tu asistente de ALT RADAR PRO. Leo la liquidez del mercado, te aviso antes de que el precio rompa y anoto cada señal con su resultado.";

function loadPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "{}") };
  } catch {
    return DEFAULT_PREFS;
  }
}

type SpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
};
/** The thread lives on the server for signed-in people. If the server says they are not signed in, it stops asking. */
let threadOpen = true;

/** One turn of the conversation, kept on the server so a reload does not lose it. Fire and forget. */
function keepTurn(role: "user" | "assistant", text: string) {
  if (!threadOpen) return;
  void fetch("/api/jarvis/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ turns: [{ role, text }] }),
  })
    .then((r) => {
      if (r.status === 401) threadOpen = false;
    })
    .catch(() => undefined);
}

/** The last hours of the conversation, from the server. Empty when signed out or offline. */
async function readThreadLines(): Promise<Line[]> {
  if (!threadOpen) return [];
  try {
    const r = await fetch("/api/jarvis/chat", { cache: "no-store" });
    if (r.status === 401) {
      threadOpen = false;
      return [];
    }
    const d = (await r.json().catch(() => ({}))) as { turns?: { role: string; text: string }[] };
    return (d.turns ?? []).map((x): Line => ({ who: x.role === "user" ? "yo" : "jarvis", text: x.text }));
  } catch {
    return [];
  }
}

/** The hands-free rules, created on first use. */
function handsOf(ref: { current: HandsFree | null }): HandsFree {
  if (!ref.current) ref.current = new HandsFree();
  return ref.current;
}

type WakeLockRef = { current: { release: () => Promise<void> } | null };

type Sentinel = { release: () => Promise<void>; addEventListener?: (type: "release", fn: () => void) => void };

/**
 * Keeps the screen on while the engine listens. Not every browser has it: then
 * the screen may sleep. Android lets go of the lock by itself (battery saver,
 * another app on top): the ref forgets it then, so the next start asks again.
 */
function keepAwake(ref: WakeLockRef): void {
  const nav = navigator as unknown as { wakeLock?: { request: (kind: "screen") => Promise<Sentinel> } };
  if (!nav.wakeLock || ref.current) return;
  nav.wakeLock.request("screen").then((lock) => {
    ref.current = lock;
    lock.addEventListener?.("release", () => {
      if (ref.current === lock) ref.current = null;
    });
  }).catch(() => {
    // Refused: the engine still listens while the screen is on.
  });
}

/**
 * Closes the hands-free microphone while JARVIS speaks, without switching
 * hands-free off. On Android an open recognizer takes the audio from the page:
 * JARVIS's voice is muted or cut, and the microphone hears it back.
 */
function closeMic(ref: { current: SpeechRec | null }): void {
  const rec = ref.current;
  ref.current = null;
  if (!rec) return;
  rec.onend = null;
  rec.onerror = null;
  rec.onresult = null;
  try {
    if (rec.abort) rec.abort();
    else rec.stop();
  } catch {
    // not running
  }
}

/** Longest a reply may keep the microphone closed: about 9 characters a second of speech, plus the first clip's wait. */
function speechBudgetMs(text: string, rate: number): number {
  return Math.min(MAX_SPEECH_MS, 8000 + (text.length * 110) / Math.max(0.5, rate));
}

/** A short buzz on Android when JARVIS hears its name: the phone may be across the table. */
function buzz(): void {
  try {
    (navigator as Navigator & { vibrate?: (ms: number) => boolean }).vibrate?.(35);
  } catch {
    // No vibration motor or not allowed.
  }
}

/** Chrome on Android: its recognizer has rules of its own (lib/hands-free.ts). */
function onAndroid(): boolean {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

/** The microphone permission as the browser reports it, kept up to date. "unknown" where it does not say. */
function watchMicPermission(onChange: (p: MicPermission) => void): void {
  const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
  if (!perms?.query) return onChange("unknown");
  perms
    .query({ name: "microphone" as PermissionName })
    .then((status) => {
      onChange(status.state);
      status.onchange = () => onChange(status.state);
    })
    .catch(() => onChange("unknown"));
}

function letGoAwake(ref: WakeLockRef): void {
  const lock = ref.current;
  ref.current = null;
  if (lock) void lock.release().catch(() => {
    // Already released by the browser.
  });
}

function recognizer(): SpeechRec | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  const C = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return C ? new C() : null;
}

async function tickers24h(): Promise<Ticker[]> {
  for (const base of FUTURES_BASES) {
    try {
      const r = await fetch(`${base}/fapi/v1/ticker/24hr`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const rows = (await r.json()) as { symbol: string; lastPrice: string; priceChangePercent: string; quoteVolume: string }[];
      return rows.map((x) => ({ symbol: x.symbol, price: Number(x.lastPrice), change: Number(x.priceChangePercent), quoteVolume: Number(x.quoteVolume) }));
    } catch {
      // next base
    }
  }
  throw new Error("Binance no respondió.");
}

async function scanBreakouts(tf: string, count: number): Promise<Breakout[]> {
  const ranked = (await loadTopSymbols(new AbortController().signal).catch(() => null)) ?? [];
  const symbols = ["BTCUSDT", "ETHUSDT", ...ranked.filter(eligible).slice(0, count - 2)];
  const frameMs = timeframeConfig(tf).frameMs;
  const out: Breakout[] = [];
  for (const symbol of symbols) {
    try {
      const now = Date.now();
      const candles = parseSwingKlines(await loadRows(symbol, tf, 200, new AbortController().signal)).filter((c) => c.openTime + frameMs <= now);
      const r = readPreBreak(candles, symbol);
      if (r && r.state === "A PUNTO") out.push({ symbol, side: r.side, score: r.score, signal: breakoutSignal(symbol, tf, candles, r) });
    } catch {
      // skip this coin
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

function useMounted() {
  return useSyncExternalStore(() => () => undefined, () => true, () => false);
}

export default function Jarvis(props: JarvisProps) {
  return useMounted() ? <JarvisInner {...props} /> : null;
}

function JarvisInner({ getContext, screen }: JarvisProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [interim, setInterim] = useState("");
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  const voices = useSyncExternalStore(subscribeVoices, getVoices, getNoVoices);
  const [showVoice, setShowVoice] = useState(false);
  const [ledger, setLedgerState] = useState<JarvisSignal[]>(loadLedger);
  const [showLedger, setShowLedger] = useState(false);
  const [core, setCore] = useState<CoreSnapshot | null>(null);
  const [coreUp, setCoreUp] = useState(false);
  const [ledgerTab, setLedgerTab] = useState<"core" | "mind" | "learn" | "local">("core");
  const coreRef = useRef<CoreSnapshot | null>(null);
  const awayRef = useRef<string | null>(null);
  const ledgerRef = useRef(ledger);
  const recRef = useRef<SpeechRec | null>(null);
  /** Manos libres: the rules live in lib/hands-free.ts; these refs keep the engine's state between events. */
  const handsRef = useRef<HandsFree | null>(null);
  const engineRef = useRef<SpeechRec | null>(null);
  const oneShotRef = useRef(false);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const engineFnsRef = useRef<{ startEngine: () => void } | null>(null);
  const [handsText, setHandsText] = useState("");
  const speakGen = useRef(0);
  const speakingRef = useRef(false);
  /** JARVIS has the floor: from the moment a reply is given until its voice ends. The hands-free microphone stays closed. */
  const floorRef = useRef(false);
  /** The microphone permission as the browser reports it (to tell a missing permission from a busy recognizer). */
  const micPermRef = useRef<MicPermission>("unknown");
  /** The last thing JARVIS was asked came by voice (for the follow-up turn). */
  const lastVoiceRef = useRef(false);
  const listenRef = useRef<(() => void) | null>(null);
  const neural = useSyncExternalStore(onNeural, neuralSnapshot, neuralServer);
  const known = useRef<Set<string>>(new Set());
  /** The coin JARVIS last opened or talked about, so "analizalo" knows what "lo" is. */
  const focusRef = useRef<{ symbol: string | null; timeframe: string | null }>({ symbol: null, timeframe: null });
  /** The section on screen and the radar's live data, from the app (radar-app.tsx). */
  const screenRef = useRef<string | null>(screen ?? null);
  const ctxRef = useRef<(() => AssistantContext) | null>(getContext ?? null);
  /** Which brain answered last, to say once when it changes (Claude's quota used, no session…). */
  const brainRef = useRef<string | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const supportsListen = typeof window !== "undefined" && Boolean((window as unknown as { webkitSpeechRecognition?: unknown; SpeechRecognition?: unknown }).webkitSpeechRecognition ?? (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition);

  const setPrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      try {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        // kept for this page
      }
      return next;
    });
  }, []);

  const saveLedger = useCallback((next: JarvisSignal[]) => {
    ledgerRef.current = next;
    setLedgerState(next);
    try {
      window.localStorage.setItem(LEDGER_KEY, JSON.stringify(next));
    } catch {
      // kept for this page
    }
  }, []);

  const loadCore = useCallback(async () => {
    const snap = await fetchCore();
    if (snap) {
      coreRef.current = snap;
      setCore(snap);
    }
    setCoreUp(snap !== null && coreOnline(snap.heartbeat, Date.now()));
    return snap;
  }, []);

  /** Records new directional signals; returns the ones that were not there before. */
  const record = useCallback(
    (fresh: (JarvisSignal | null)[]) => {
      const have = new Set(ledgerRef.current.map((x) => x.id));
      const added = fresh.filter((x): x is JarvisSignal => Boolean(x) && !have.has((x as JarvisSignal).id));
      if (added.length) saveLedger(addSignals(ledgerRef.current, added));
      return added;
    },
    [saveLedger],
  );

  /** Resolves open signals with the candles that came after them. */
  const resolveOpen = useCallback(async () => {
    const open = ledgerRef.current.filter((x) => x.result === "ABIERTA");
    if (!open.length) return;
    const groups = new Map<string, JarvisSignal[]>();
    for (const x of open) groups.set(`${x.symbol}|${x.timeframe}`, [...(groups.get(`${x.symbol}|${x.timeframe}`) ?? []), x]);
    const updated = new Map<string, JarvisSignal>();
    for (const [key, list] of groups) {
      const [symbol, tf] = key.split("|");
      try {
        const candles = await closedCandles(symbol, tf, 200);
        for (const x of list) updated.set(x.id, resolveSignal(x, candles, timeframeConfig(tf).frameMs));
      } catch {
        // try again next time
      }
    }
    if (updated.size) saveLedger(ledgerRef.current.map((x) => updated.get(x.id) ?? x));
  }, [saveLedger]);

  useEffect(() => {
    void loadTopSymbols(new AbortController().signal)
      .then((list) => {
        known.current = new Set((list ?? []).map((s) => s.replace(/USDT$/, "")));
      })
      .catch(() => undefined);
  }, []);

  // The browser's word on the microphone permission, to tell a real denial from Android's busy recognizer.
  useEffect(() => {
    watchMicPermission((p) => {
      micPermRef.current = p;
      handsOf(handsRef).setPermission(p);
    });
  }, []);

  // The section on screen changes when the person scrolls or taps the menu; JARVIS also sets it when it opens one.
  useEffect(() => {
    screenRef.current = screen ?? null;
  }, [screen]);
  useEffect(() => {
    ctxRef.current = getContext ?? null;
  }, [getContext]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [lines, interim]);

  /** The phone's own voice. Said as words, in pieces: Chrome cuts long utterances off after ~15 s. */
  const sayDevice = useCallback(
    (text: string, onStart: () => void, onEnd: () => void) => {
      if (typeof speechSynthesis === "undefined") return onEnd();
      speechSynthesis.cancel();
      const all = speechSynthesis.getVoices();
      const voice = all.find((v) => v.name === prefs.voiceName) ?? pickVoice(all, prefs.gender);
      const parts = splitForSpeech(normalizeSpanish(text), 180);
      if (!parts.length) return onEnd();
      let started = false;
      parts.forEach((part, i) => {
        const u = new SpeechSynthesisUtterance(part);
        u.voice = voice;
        u.lang = voice?.lang ?? "es-AR";
        u.rate = prefs.rate;
        u.pitch = prefs.gender === "male" ? 0.92 : 1;
        if (i === 0)
          u.onstart = () => {
            started = true;
            onStart();
          };
        if (i === parts.length - 1) u.onend = onEnd;
        u.onerror = onEnd;
        speechSynthesis.speak(u);
      });
      // Browsers without a usable voice never start: the text is already on screen, so don't hang.
      window.setTimeout(() => {
        if (!started) onEnd();
      }, 2500);
    },
    [prefs.voiceName, prefs.gender, prefs.rate],
  );

  /** Stops whatever JARVIS is saying, neural or device. With hands-free on, the microphone opens again. */
  const hush = useCallback(() => {
    speakGen.current += 1;
    speakingRef.current = false;
    floorRef.current = false;
    handsRef.current?.busy(false, Date.now());
    stopNeural();
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    if (handsRef.current?.active) window.setTimeout(() => engineFnsRef.current?.startEngine(), 400);
  }, []);

  const speak = useCallback(
    /** `shown` is what the chat shows when it is not what the voice says (the desk's full ticket, spoken short). */
    (text: string, tag?: string, shown?: string) => {
      keepTurn("assistant", shown ?? text);
      setLines((l) => [...l, { who: "jarvis" as const, text: shown ?? text, ...(tag ? { tag } : {}) }].slice(-40));
      if (!prefs.voice) {
        setMode("idle");
        return;
      }
      // Only the latest reply may change the state when it ends: an interrupted one ends quietly.
      const mine = ++speakGen.current;
      let ended = false;
      let watchdog = 0;
      // The microphone closes before the voice starts and opens again after the echo (closeMic).
      floorRef.current = true;
      closeMic(engineRef);
      handsOf(handsRef).busy(true, Date.now(), text);
      setInterim("");
      const onStart = () => {
        if (speakGen.current !== mine) return;
        speakingRef.current = true;
        handsOf(handsRef).busy(true, Date.now(), text);
        setMode("speaking");
      };
      const onEnd = () => {
        if (ended || speakGen.current !== mine) return;
        ended = true;
        window.clearTimeout(watchdog);
        speakingRef.current = false;
        floorRef.current = false;
        handsOf(handsRef).busy(false, Date.now());
        const listening = handsOf(handsRef).active;
        setMode(listening ? "listening" : "idle");
        if (listening) window.setTimeout(() => engineFnsRef.current?.startEngine(), ECHO_MS);
        // Something asked by voice gets one more turn of listening, like a conversation. It waits out the echo first.
        if (prefs.followUp && lastVoiceRef.current && !listening) {
          lastVoiceRef.current = false;
          window.setTimeout(() => listenRef.current?.(), ECHO_MS);
        }
      };
      // A voice that never reports its end (it happens on Android) must not leave the microphone closed.
      watchdog = window.setTimeout(onEnd, speechBudgetMs(text, prefs.rate));
      const ns = neuralState();
      if (prefs.engine === "neural" && ns !== "login" && ns !== "quota" && ns !== "off") {
        if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
        speakingRef.current = true;
        void speakNeural(normalizeSpanish(text), { voice: prefs.neuralVoice, rate: prefs.rate, onStart }).then((r) => {
          if (speakGen.current !== mine) return;
          if (r.done) onEnd();
          else sayDevice(r.rest, onStart, onEnd);
        });
        return;
      }
      stopNeural();
      sayDevice(text, onStart, onEnd);
    },
    [prefs.voice, prefs.engine, prefs.neuralVoice, prefs.rate, prefs.followUp, sayDevice],
  );

  // The radar's live context (market structure for the desk); a failing panel never breaks an answer.
  const deskContext = useCallback((): AssistantContext | null => {
    try {
      return ctxRef.current?.() ?? null;
    } catch {
      return null;
    }
  }, []);

  const run = useCallback(
    async (intent: JarvisIntent) => {
      setMode("thinking");
      try {
        switch (intent.kind) {
          case "STOP":
            lastVoiceRef.current = false;
            hush();
            setMode("idle");
            return;
          case "HELP":
            return speak(HELP_TEXT);
          case "NAME":
            setPrefs({ name: intent.name });
            return speak(`Entendido. De ahora en más te llamo ${intent.name}.`);
          case "SECTION":
            screenRef.current = SECTION_SCREEN[intent.section] ?? intent.label;
            showSection(intent.section);
            return speak(`Abriendo ${intent.label.toLowerCase()}.`);
          case "MAP":
            focusRef.current = { symbol: `${intent.symbol}USDT`, timeframe: intent.timeframe ?? "1h" };
            screenRef.current = "LIQUIDACIONES";
            openInMap(`${intent.symbol}USDT`, intent.timeframe);
            return speak(`Mapa de ${intent.symbol}${intent.timeframe ? ` en ${intent.timeframe.replace("m", " minutos").replace("h", intent.timeframe === "1h" ? " hora" : " horas").replace("1d", "diario")}` : ""}, en pantalla.`);
          case "PRICE": {
            focusRef.current = { symbol: `${intent.symbols[0]}USDT`, timeframe: focusRef.current.timeframe };
            const all = await tickers24h();
            const found = intent.symbols.map((s) => all.find((t) => t.symbol === `${s}USDT`)).filter((t): t is Ticker => Boolean(t));
            return speak(found.length ? found.map(priceLine).join(" ") : "No encontré esa moneda en Binance futuros.");
          }
          case "MOVERS": {
            const all = (await tickers24h()).filter((t) => t.symbol.endsWith("USDT") && t.quoteVolume > 20_000_000);
            const top = [...all].sort((a, b) => b.change - a.change).slice(0, 5);
            return speak(`Las que más suben en 24 horas, con volumen: ${top.map((t) => `${t.symbol.replace(/USDT$/, "")} ${t.change.toFixed(1).replace(".", ",")} por ciento`).join(", ")}.`);
          }
          case "BREAKOUTS": {
            // The core reads 20 coins in 1h every 15 minutes: answer from it at once when it is fresh.
            if (intent.timeframe === "1h") {
              const snap = coreRef.current ?? (await loadCore());
              const fromCore = breakoutsFromMind(snap?.mind ?? null, Date.now());
              if (fromCore) return speak(fromCore.text);
            }
            setLines((l) => [...l, { who: "jarvis" as const, text: `Escaneando 20 monedas en ${intent.timeframe}…` }]);
            const hot = await scanBreakouts(intent.timeframe, 20);
            const added = record(hot.map((b) => b.signal));
            return speak(
              hot.length
                ? `En ${intent.timeframe}, a punto de romper: ${hot.slice(0, 4).map((b) => `${b.symbol.replace(/USDT$/, "")} ${b.side === "ALCISTA" ? "hacia arriba" : b.side === "BAJISTA" ? "hacia abajo" : "sin dirección clara"}, presión ${b.score}`).join("; ")}. La dirección es probable, no segura.${added.length ? ` ${added.slice(0, 2).map(signalSpeech).join(" ")}` : ""}`
                : `En ${intent.timeframe} no veo ninguna de las principales comprimida contra un nivel.`,
            );
          }
          case "STATS": {
            const [snap] = await Promise.all([loadCore(), resolveOpen()]);
            setShowLedger(true);
            const local = ledgerStats(ledgerRef.current);
            if (snap && (snap.stats.resolved || snap.open.length)) {
              setLedgerTab("core");
              const sh = snap.shadow;
              return speak(
                `Núcleo veinticuatro siete. ${statsSpeech(snap.stats)}${
                  sh.resolved
                    ? ` Además dejé en sombra ${sh.resolved} ${sh.resolved === 1 ? "señal" : "señales"} que el aprendizaje desaconsejó: ${sh.totalR >= 0 ? "sumaron más" : "sumaron menos"} ${Math.abs(sh.totalR).toFixed(1).replace(".", ",")} R.`
                    : ""
                }${local.resolved ? ` En este dispositivo, aparte: ${local.resolved} cerradas, profit factor ${local.profitFactor === null ? "sin dato" : local.profitFactor === Infinity ? "infinito" : local.profitFactor.toFixed(2).replace(".", ",")}.` : ""}`,
              );
            }
            setLedgerTab("local");
            return speak(statsSpeech(local));
          }
          case "LEARN": {
            const snap = await loadCore();
            setShowLedger(true);
            setLedgerTab("learn");
            if (!snap?.learning) return speak("Mi núcleo todavía no empezó a estudiar la historia. En unos minutos tengo los primeros casos.");
            return speak(learnSpeech(snap.learning));
          }
          case "CORE": {
            const snap = await loadCore();
            if (!snap) return speak("No pude conectar con el núcleo. Sigo funcionando desde tu navegador.");
            const away = takeAway(snap);
            return speak(`${coreStatusSpeech(snap, Date.now())}${away ? ` ${away}` : ""}`);
          }
          case "BRIEFING": {
            const [tickers, hot] = await Promise.all([tickers24h(), scanBreakouts("1h", 12).catch(() => undefined)]);
            if (hot) record(hot.map((b) => b.signal));
            setPrefs({ lastBriefing: new Date().toISOString().slice(0, 10) });
            const away = awayRef.current;
            awayRef.current = null;
            // What its 24/7 mind concluded in the last hour, when there is a fresh reading.
            const rd = (coreRef.current ?? (await loadCore()))?.reading ?? null;
            const mindLine = rd && Date.now() - rd.at < 2 * 3_600_000 ? ` Mi lectura de la última hora: ${rd.resumen}` : "";
            return speak(`${briefingText({ hour: new Date().getHours(), name: prefs.name, tickers, breakouts: hot })}${mindLine}${away ? ` ${away}` : ""}`);
          }
          case "MIND": {
            const snap = await loadCore();
            setShowLedger(true);
            setShowVoice(false);
            setLedgerTab("mind");
            if (!snap?.reading) return speak("Todavía no escribí mi primera lectura del mercado: la escribo cada hora, a los diecisiete minutos, con todos los datos del software.");
            return speak(readingSpeech(snap.reading, Date.now()));
          }
          case "REMEMBER": {
            const r = await fetch("/api/jarvis/memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: intent.text }) });
            if (r.status === 401) return speak("Para recordar cosas necesito que inicies sesión: la memoria es tuya y se guarda en tu cuenta.");
            const d = (await r.json().catch(() => ({}))) as { saved?: boolean; text?: string; total?: number };
            if (d.saved) return speak(`Anotado: ${d.text}. Lo voy a tener en cuenta en cada respuesta.`);
            return speak(d.text && d.text.length >= 3 ? "Eso ya lo tenía anotado." : "No entendí qué querés que recuerde. Decime, por ejemplo: recordá que opero solo BTC con uno por ciento de riesgo.");
          }
          case "FORGET": {
            const r = await fetch("/api/jarvis/memory", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: intent.text }) });
            if (r.status === 401) return speak("Para tocar mi memoria necesito que inicies sesión.");
            const d = (await r.json().catch(() => ({}))) as { removed?: string[] };
            const gone = d.removed ?? [];
            return speak(gone.length ? `Listo, olvidé ${gone.length === 1 ? `esto: ${gone[0]}` : `${gone.length} cosas`}.` : "No encontré nada así en mi memoria. Preguntame qué recuerdo y te digo cómo está anotado.");
          }
          case "MEMORY": {
            const r = await fetch("/api/jarvis/memory", { cache: "no-store" });
            if (r.status === 401) return speak("Mi memoria se guarda en tu cuenta: iniciá sesión y decime, por ejemplo, recordá que opero solo BTC.");
            const d = (await r.json().catch(() => ({}))) as { notes?: { text: string }[] };
            const notes = d.notes ?? [];
            return speak(
              notes.length
                ? `${notes.length === 1 ? "Tengo una cosa anotada" : `Tengo ${notes.length} cosas anotadas`}: ${notes.map((n) => n.text).join("; ")}. Las uso en cada respuesta; decime olvidá lo de… para borrar una.`
                : "Todavía no me pediste que recuerde nada. Decime, por ejemplo: recordá que opero solo BTC con uno por ciento de riesgo.",
            );
          }
          // JARVIS TRADING: the desk of specialists (lib/jarvis-desk.ts) answers with its own numbers.
          case "DESK":
          case "ENTRY":
          case "INDICATORS":
          case "LIQ_RISK":
          case "WHATIF": {
            const sym = intent.symbol ? `${intent.symbol}USDT` : (focusRef.current.symbol ?? "BTCUSDT");
            focusRef.current = { symbol: sym, timeframe: focusRef.current.timeframe ?? "4h" };
            const d: DeskDecision | null = (intent.kind === "WHATIF" ? cachedDesk(sym) : null) ?? (await deskFor(sym, { structure: deskContext()?.structure ?? null })).decision;
            if (!d) return speak(`No tengo velas suficientes de ${sym.replace(/USDT$/, "")} para que la mesa lo analice. Este dato no está disponible actualmente.`);
            if (intent.kind === "DESK" || intent.kind === "ENTRY") {
              screenRef.current = "JARVIS TRADING";
              showSection("jarvis-trading");
              showInDesk(sym);
            }
            const said =
              intent.kind === "DESK" ? deskSpeech(d) : intent.kind === "ENTRY" ? entrySpeech(d) : intent.kind === "INDICATORS" ? indicatorsSpeech(d) : intent.kind === "LIQ_RISK" ? liquidationRisk(d) : whatIf(d, intent.level);
            // An analysis or a trade request shows the full ticket in the chat (ACTIVO, DIRECCIÓN, …); the voice says it short.
            return speak(said, "mesa", intent.kind === "DESK" || intent.kind === "ENTRY" ? deskTicket(d) : undefined);
          }
          case "COMPARE": {
            const ctxNow = deskContext();
            const [x, y] = await Promise.all([deskFor(`${intent.a}USDT`, { structure: ctxNow?.structure ?? null }), deskFor(`${intent.b}USDT`, { structure: ctxNow?.structure ?? null })]);
            if (!x.decision || !y.decision) return speak("No pude leer los dos activos para compararlos. Este dato no está disponible actualmente.");
            const c = compareDesks(x.decision, y.decision);
            screenRef.current = "JARVIS TRADING";
            showSection("jarvis-trading");
            showInDesk(`${intent.a}USDT`, `${intent.b}USDT`);
            const top = c.filas.filter((r) => r.gana === "A" || r.gana === "B").slice(0, 4).map((r) => `${r.criterio}: ${r.gana === "A" ? c.a : c.b}`).join("; ");
            return speak(`${c.resumen.replace(/ No es asesoramiento financiero\.$/, "")}${top ? ` Por criterio: ${top}.` : ""} No es asesoramiento financiero.`, "mesa");
          }
          case "PAPER": {
            const st = await loadPaper();
            screenRef.current = "JARVIS TRADING";
            showSection("jarvis-trading");
            if (st.mode === "error") return speak(`${st.error ?? "No pude leer tu registro de papel."} Este dato no está disponible actualmente.`);
            await refreshPaper().catch(() => null);
            return speak(paperSpeech(paperTrades()), "papel");
          }
          case "PAPER_OPEN": {
            const sym = intent.symbol ? `${intent.symbol}USDT` : (focusRef.current.symbol ?? "BTCUSDT");
            const coin = sym.replace(/USDT$/, "");
            const d = (await deskFor(sym, { structure: deskContext()?.structure ?? null })).decision;
            if (!d) return speak(`No tengo velas suficientes de ${coin} para que la mesa arme un plan. Este dato no está disponible actualmente.`);
            // Paper follows the desk: never a plan the risk manager did not approve.
            if (!canPaper(d)) return speak(`No hay un plan aprobado para ${coin}: la mesa dice ${d.direccion === "NO TRADE" ? "no operar" : d.direccion.toLowerCase()}. ${d.resolucion} No abro operaciones de papel contra el gestor de riesgo.`, "mesa");
            const r = await openFromDesk(d);
            if (!r.ok) return speak(r.error);
            screenRef.current = "JARVIS TRADING";
            showSection("jarvis-trading");
            showInDesk(sym);
            const t = r.trade;
            return speak(
              `Listo, en papel: ${t.lado === "LONG" ? "largo" : "corto"} en ${coin} ${t.tipoEntrada === "LÍMITE" ? `con orden límite en ${arNumber(t.entrada)}` : "a mercado, al precio del minuto que viene (solo cuentan los precios desde ahora)"}, stop ${arNumber(t.stop)}, objetivos ${t.tp.map((x) => arNumber(x)).join(", ")}. Si a ese precio el riesgo beneficio ya no alcanza, no entra. La sigo minuto a minuto esta hora y después con velas de una hora. Simulado, sin plata real.`,
              "papel",
            );
          }
          case "ALERT": {
            const sym = intent.symbol ? `${intent.symbol}USDT` : (focusRef.current.symbol ?? "BTCUSDT");
            const coin = sym.replace(/USDT$/, "");
            const r = await fetch("/api/jarvis/alert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: sym, target: intent.level, reference: cachedDesk(sym)?.precio ?? null }) });
            const body = (await r.json().catch(() => ({}))) as { error?: string; alert?: { direction: "ARRIBA" | "ABAJO" } };
            if (r.status === 401) return speak("Para avisarte por Telegram necesito que inicies sesión y vincules Telegram en ALERTAS.");
            if (!r.ok || !body.alert) return speak(body.error ?? "No pude crear la alerta.");
            return speak(`Listo: te aviso por Telegram cuando ${coin} ${body.alert.direction === "ARRIBA" ? "suba a" : "baje a"} ${arNumber(intent.level)}, aunque la app esté cerrada. Lo reviso cada 5 minutos.`, "alertas");
          }
          case "BACKTEST": {
            const sym = intent.symbol ? `${intent.symbol}USDT` : (focusRef.current.symbol ?? "BTCUSDT");
            const coin = sym.replace(/USDT$/, "");
            screenRef.current = "JARVIS TRADING";
            showSection("jarvis-trading");
            showInDesk(sym);
            setLines((l) => [...l, { who: "jarvis" as const, text: `Corro el backtest de ${coin} en ${intent.days} días con la misma mesa y las reglas del papel: tarda unos segundos…` }].slice(-40));
            const r = await runBacktestFor(sym, intent.days);
            return speak(r.ok ? `${backtestSpeech(r.result)}${r.nota ? ` ${r.nota}` : ""}` : r.error, "backtest");
          }
          case "REAL": {
            // Real money is the person's own action: JARVIS never sends an order (lib/jarvis-execution.ts).
            const sym = intent.symbol ? `${intent.symbol}USDT` : (focusRef.current.symbol ?? "BTCUSDT");
            screenRef.current = "JARVIS TRADING";
            showSection("jarvis-trading");
            showInDesk(sym, undefined, "REAL");
            return speak(
              `No opero en tu cuenta: JARVIS no envía órdenes, y no tiene cómo. Análisis, papel y ejecución real están separados. Te abro la ejecución manual de ${sym.replace(/USDT$/, "")}: si el plan pasa todos los controles y lo confirmás, te armo el ticket y la orden la cargás vos en tu exchange. Si querés practicar sin plata, decime «simulá la operación».`,
              "mesa",
            );
          }
          case "MACRO": {
            const cal = await loadCalendar().catch(() => null);
            return speak(macroSpeech(macroBrief(cal?.events ?? null, Date.now(), macroKindOf(intent.question))), "mesa");
          }
          case "AI": {
            // What the question is about: a coin it names, or what is on screen ("analizalo").
            const named = findCoins(intent.question, known.current);
            if (named.length) focusRef.current = { symbol: `${named[0]}USDT`, timeframe: findTimeframe(intent.question) ?? focusRef.current.timeframe };
            const onScreen = !named.length && pointsAtScreen(intent.question);
            const focus: Focus = { screen: screenRef.current, symbol: focusRef.current.symbol, timeframe: focusRef.current.timeframe };
            const subject = named.length ? focus.symbol : onScreen && (focus.screen === "LIQUIDACIONES" || !focus.screen) ? focus.symbol : null;
            // The asset through every engine of the software, on 1h, 4h and daily (jarvis-analyst.ts).
            let analysis: Analysis | null = null;
            if (subject) {
              if (named.length) setLines((l) => [...l, { who: "jarvis" as const, text: `Analizando ${subject.replace(/USDT$/, "")} con todos los motores: 1h, 4h y diario…` }].slice(-40));
              analysis = await Promise.all([closedCandles(subject, "1h", 1000), closedCandles(subject, "4h", 300).catch(() => null), closedCandles(subject, "1d", 200).catch(() => null)])
                .then(([h1, h4, d1]) => analyzeAsset(subject, { h1, h4, d1 }, Date.now()))
                .catch(() => null);
            }
            const report = analysis ? analysisText(analysis) : null;
            const ctx = (() => {
              try {
                return ctxRef.current?.() ?? null;
              } catch {
                return null;
              }
            })();
            const asked = named.length ? { question: intent.question } : withFocus(intent.question, focus);
            const local = (why: string | null) => {
              const tag = "motor local";
              // A coin named in the question wins over the screen ("analizá BTC" while PUMP is open).
              const text = localAnswer(intent.question, named.length ? null : focus, ctx, report);
              if (why && brainRef.current !== "local") {
                brainRef.current = "local";
                return speak(`${why} ${text}`, tag);
              }
              brainRef.current = "local";
              return speak(text, tag);
            };
            let r: Response;
            try {
              r = await fetch("/api/analyst/ai", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  question: asked.question,
                  // Every brain gets the same live data: the radar, JARVIS's 24/7 core, the screen and the coin in focus.
                  snapshot: {
                    asistente: "JARVIS",
                    ...(ctx ? compactSnapshot(ctx) : {}),
                    jarvis: coreRef.current ? coreContext(coreRef.current, Date.now()).nucleo : null,
                    pantalla: { seccion: focus.screen, moneda: focus.symbol, temporalidad: focus.timeframe },
                    foco: analysis ? analysisForAi(analysis) : null,
                    // The desk's last decision on that coin, so the conversation uses the same plan and numbers.
                    mesa: subject && cachedDesk(subject) ? deskForAi(cachedDesk(subject)!) : null,
                    // Its own paper record (simulated), so it can discuss how its plans actually went.
                    papel: paperForAi(paperTrades()),
                    backtest: subject && lastBacktest()?.symbol === subject ? backtestForAi(lastBacktest()!) : null,
                  },
                  history: lines.slice(-6).map((l) => ({ role: l.who === "yo" ? "user" : "assistant", content: l.text })),
                }),
              });
            } catch {
              return local("No llego a la inteligencia artificial ahora; te respondo con mi motor local.");
            }
            const d = (await r.json().catch(() => ({}))) as { text?: string; error?: string; brain?: string; label?: string };
            if (r.ok && d.text) {
              // Said once each time the brain changes, so it is clear even by voice which one is answering.
              const changed = brainRef.current !== d.brain;
              brainRef.current = d.brain ?? null;
              const note = changed && d.brain && d.brain !== "claude" ? "Te respondo con la inteligencia artificial gratuita. " : "";
              return speak(`${note}${d.text}`, d.label);
            }
            return local(
              d.error === "SESIÓN REQUERIDA"
                ? "Sin sesión iniciada no uso la inteligencia artificial; te respondo con mi motor local, sin límite."
                : d.error === "SIN IA POR HOY"
                  ? "Por hoy se terminaron las respuestas de inteligencia artificial; sigo con mi motor local, sin límite."
                  : "La inteligencia artificial no respondió; te respondo con mi motor local.",
            );
          }
        }
      } catch {
        speak("No pude completar eso: Binance no respondió. Probá de nuevo en un momento.");
      }
    },
    [lines, prefs.name, record, resolveOpen, setPrefs, speak, loadCore, hush, deskContext],
  );

  const handle = useCallback(
    (text: string, byVoice = false) => {
      const clean = text.trim();
      if (!clean) return;
      lastVoiceRef.current = byVoice;
      keepTurn("user", clean);
      setLines((l) => [...l, { who: "yo" as const, text: clean }].slice(-40));
      void run(parseCommand(clean, known.current));
    },
    [run],
  );

  // The browser's events come from recognizers made earlier: they must call the newest handle, speak and name.
  const latestRef = useRef({ handle, speak, name: prefs.name });
  useEffect(() => {
    latestRef.current = { handle, speak, name: prefs.name };
  }, [handle, speak, prefs.name]);

  /** Stops the hands-free engine for good: nothing restarts it until it is switched on again. */
  const stopEngine = useCallback(() => {
    closeMic(engineRef);
    letGoAwake(wakeLockRef);
  }, []);

  /** The engine stopped on its own: the rules say whether it starts again, or stays off and the panel says why. */
  const decideAfterEnd = useCallback(() => {
    const hands = handsOf(handsRef);
    const next = hands.ended();
    if (next.type === "restart") {
      // Android's recognizer needs a moment to be free again after a session (otherwise: "not-allowed").
      window.setTimeout(() => engineFnsRef.current?.startEngine(), onAndroid() ? Math.max(next.inMs, 400) : next.inMs);
      return;
    }
    stopEngine();
    setMode((m) => (m === "listening" ? "idle" : m));
    setHandsText(hands.status(Date.now()));
  }, [stopEngine]);

  /** The hands-free engine: one continuous recognition. The browser ends it now and then; the rules decide the next one. */
  const startEngine = useCallback(() => {
    const hands = handsOf(handsRef);
    if (!hands.active || oneShotRef.current || engineRef.current || floorRef.current) return;
    const rec = recognizer();
    if (!rec) return;
    rec.lang = "es-AR";
    // On Android continuous mode hands every partial guess over as final ("jarvis analizame" before "… SOL"):
    // there the engine hears one whole phrase per session, and the rules restart it.
    rec.continuous = !onAndroid();
    rec.interimResults = true;
    engineRef.current = rec;
    hands.started();
    rec.onresult = (e) => {
      // While JARVIS talks, the microphone hears it: those results never reach the rules.
      if (engineRef.current !== rec || speakingRef.current) return;
      const latest = latestRef.current;
      let partial = "";
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const r = e.results[i];
        if (!r.isFinal) {
          partial += r[0].transcript;
          continue;
        }
        const heard = hands.final(i, r[0].transcript, Date.now());
        if (heard.type === "none") continue;
        setOpen(true);
        buzz();
        if (heard.type === "awake") {
          // A tone and a buzz, not a sentence: people go on talking right after "Jarvis", and a
          // spoken "te escucho" would close the microphone over their words (closeMic).
          earcon("listen");
        } else {
          earcon("stop");
          latest.handle(heard.text, true);
        }
      }
      setInterim(partial);
      setHandsText(hands.status(Date.now()));
    };
    rec.onerror = (e) => {
      if (engineRef.current !== rec) return;
      const verdict = hands.error(e.error);
      if (verdict.type !== "stop") return;
      stopEngine();
      setMode((m) => (m === "listening" ? "idle" : m));
      setHandsText(hands.status(Date.now()));
      if (verdict.reason === "permiso") latestRef.current.speak("Necesito permiso para usar el micrófono.");
      if (verdict.reason === "ocupado") latestRef.current.speak("El micrófono está ocupado por otra app. Cuando se libere, reactivá manos libres.");
    };
    rec.onend = () => {
      if (engineRef.current !== rec) return;
      engineRef.current = null;
      decideAfterEnd();
    };
    keepAwake(wakeLockRef);
    try {
      rec.start();
      setMode((m) => (m === "idle" ? "listening" : m));
    } catch {
      // The browser still holds an earlier session: that counts as a failure, and the rules back off.
      engineRef.current = null;
      hands.error("aborted");
      decideAfterEnd();
    }
  }, [decideAfterEnd, stopEngine]);

  /** One phrase, for the mic button and Alt+J. It takes the microphone from the engine, which comes back after it. */
  const listenOnce = useCallback(() => {
    if (oneShotRef.current) return;
    const hadEngine = engineRef.current !== null;
    stopEngine();
    const rec = recognizer();
    if (!rec) return latestRef.current.speak("Tu navegador no permite dictado por voz. Probá con Chrome, o escribime.");
    rec.lang = "es-AR";
    rec.continuous = false;
    rec.interimResults = true;
    oneShotRef.current = true;
    rec.onresult = (e) => {
      if (speakingRef.current) return;
      let finalText = "";
      let partial = "";
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t;
        else partial += t;
      }
      setInterim(partial);
      if (!finalText) return;
      setInterim("");
      earcon("stop");
      latestRef.current.handle(finalText, true);
    };
    rec.onerror = (e) => {
      // On Android "not-allowed" is also a recognizer still busy: with the permission granted, that is what it is.
      if (e.error === "not-allowed") latestRef.current.speak(micPermRef.current === "granted" ? "El micrófono estaba ocupado. Tocá de nuevo." : "Necesito permiso para usar el micrófono.");
    };
    rec.onend = () => {
      oneShotRef.current = false;
      if (recRef.current === rec) recRef.current = null;
      setMode((m) => (m === "listening" ? "idle" : m));
      engineFnsRef.current?.startEngine();
    };
    recRef.current = rec;
    const begin = () => {
      try {
        rec.start();
        setMode("listening");
        earcon("listen");
      } catch {
        oneShotRef.current = false;
        recRef.current = null;
        engineFnsRef.current?.startEngine();
      }
    };
    // Android needs a moment to hand the microphone from the hands-free engine to this phrase:
    // started at once, it fails and the tap seems to do nothing.
    if (hadEngine) window.setTimeout(begin, 350);
    else begin();
  }, [stopEngine]);

  useEffect(() => {
    engineFnsRef.current = { startEngine };
    listenRef.current = listenOnce;
  }, [listenOnce, startEngine]);

  // The checkbox switches the engine on and off. A browser that cannot listen never switches it on.
  useEffect(() => {
    const hands = handsOf(handsRef);
    let live = true;
    void (async () => {
      await Promise.resolve();
      if (!live) return;
      if (prefs.wake && supportsListen) {
        hands.enable();
        hands.setPermission(micPermRef.current);
        engineFnsRef.current?.startEngine();
      } else {
        hands.disable();
        setMode((m) => (m === "listening" ? "idle" : m));
      }
      setHandsText(hands.status(Date.now()));
    })();
    return () => {
      live = false;
      hands.disable();
      stopEngine();
    };
  }, [prefs.wake, stopEngine, supportsListen]);

  // While hands-free is on, the status line follows the state: the follow-up window closes by itself.
  useEffect(() => {
    if (!prefs.wake) return;
    const id = window.setInterval(() => setHandsText(handsOf(handsRef).status(Date.now())), 1000);
    return () => window.clearInterval(id);
  }, [prefs.wake]);

  // The browser takes the microphone with the page: stop when it is hidden, go on when it is visible again.
  useEffect(() => {
    const onVisibility = () => {
      const hands = handsOf(handsRef);
      const change = hands.setVisible(!document.hidden);
      if (change === "abort") {
        stopEngine();
        setMode((m) => (m === "listening" ? "idle" : m));
      }
      if (change === "start") engineFnsRef.current?.startEngine();
      setHandsText(hands.status(Date.now()));
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [stopEngine]);

  // Watch mode. With the core online it speaks what the core opens and closes
  // (the server already scans 24/7); without it, the browser scans as before.
  useEffect(() => {
    if (!prefs.watch) return;
    const seen = new Set<string>();
    const announced = new Set<string>();
    let primed = false;
    const check = async () => {
      const snap = await loadCore();
      if (snap && coreOnline(snap.heartbeat, Date.now())) {
        const items = [...snap.open, ...snap.recent];
        const keyOf = (x: JarvisSignal) => `${x.id}|${x.result}`;
        if (!primed) {
          items.forEach((x) => announced.add(keyOf(x)));
          primed = true;
          return;
        }
        const fresh = items.filter((x) => !announced.has(keyOf(x)));
        fresh.forEach((x) => announced.add(keyOf(x)));
        if (!fresh.length) return;
        const parts = fresh.slice(0, 3).map((x) =>
          x.result === "ABIERTA"
            ? `el núcleo abrió ${signalSpeech(x).replace(/^Señal registrada: /, "")}`
            : `${x.symbol.replace(/USDT$/, "")} cerró en ${x.result === "OBJETIVO" ? "objetivo" : x.result === "STOP" ? "stop" : "tiempo"}, ${(x.r ?? 0) >= 0 ? "más" : "menos"} ${Math.abs(x.r ?? 0).toFixed(1).replace(".", ",")} R.`,
        );
        setOpen(true);
        speak(`Atención, ${prefs.name}: ${parts.join(" ")}`);
        return;
      }
      await resolveOpen();
      const [hot, sweeps] = await Promise.all([scanBreakouts("1h", 20).catch(() => []), scanMagnetSignals().catch(() => [])]);
      const added = record([...hot.map((b) => b.signal), ...sweeps]);
      const freshHot = hot.filter((b) => !seen.has(b.symbol));
      freshHot.forEach((b) => seen.add(b.symbol));
      const parts: string[] = [];
      if (freshHot.length) parts.push(`${freshHot.slice(0, 3).map((b) => `${b.symbol.replace(/USDT$/, "")} está a punto de romper ${b.side === "ALCISTA" ? "hacia arriba" : b.side === "BAJISTA" ? "hacia abajo" : "sin dirección clara"}`).join("; ")}.`);
      if (added.length) parts.push(added.slice(0, 3).map(signalSpeech).join(" "));
      if (parts.length) {
        setOpen(true);
        speak(`Atención, ${prefs.name}: ${parts.join(" ")}`);
      }
    };
    void check();
    return everyVisible(() => void check(), 120_000);
  }, [prefs.watch, prefs.name, record, resolveOpen, speak, loadCore]);

  // While the panel is open, keep the core's status fresh (shared 60 s cache on the server).
  useEffect(() => {
    if (!open) return;
    return everyVisible(() => void loadCore(), 120_000);
  }, [open, loadCore]);

  // Keyboard: Alt+J opens and listens; Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen(true);
        listenOnce();
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listenOnce]);

  const refreshLedger = useCallback(() => {
    if (ledgerTab === "local") void resolveOpen();
    else void loadCore();
  }, [ledgerTab, loadCore, resolveOpen]);

  /** "Nueva charla": the conversation starts again. The notes JARVIS keeps (jarvis-memory) stay. */
  const newThread = () => {
    hush();
    setLines([]);
    setInterim("");
    if (threadOpen) void fetch("/api/jarvis/chat", { method: "DELETE" }).catch(() => undefined);
  };

  const openPanel = () => {
    setOpen(true);
    unlockAudio();
    void probeNeural();
    void resolveOpen();
    void (async () => {
      // A conversation of the last hours goes on where it was; only a new one gets the briefing.
      const [snap, past] = await Promise.all([loadCore(), lines.length ? Promise.resolve<Line[]>([]) : readThreadLines()]);
      const away = snap ? takeAway(snap) : null;
      if (past.length) {
        setLines((l) => (l.length ? l : past));
        if (away) speak(away);
        return;
      }
      if (!lines.length) {
        const today = new Date().toISOString().slice(0, 10);
        if (prefs.lastBriefing !== today) {
          awayRef.current = away;
          void run({ kind: "BRIEFING" });
        } else speak(`${greeting(new Date().getHours(), prefs.name)}${away ? ` ${away}` : ""} ¿En qué te ayudo?`);
      } else if (away) speak(away);
    })();
  };

  const label = mode === "listening" ? "ESCUCHANDO" : mode === "thinking" ? "PROCESANDO" : mode === "speaking" ? "HABLANDO" : prefs.wake ? "EN ESPERA · DECÍ «JARVIS»" : "EN LÍNEA";

  return (
    <>
      <button className={`jv-orb ${mode}${prefs.wake ? " wake" : ""}`} onClick={() => (open ? setOpen(false) : openPanel())} aria-label="JARVIS · asistente de voz (Alt+J)" title="JARVIS · Alt+J">
        <span />
      </button>
      {open && (
        <div className="jv-panel" role="dialog" aria-label="JARVIS">
          <div className="jv-head">
            <b>J.A.R.V.I.S.</b>
            <em>{label}</em>
            <button
              className={`jv-core ${coreUp ? "on" : "off"}`}
              onClick={() => void run({ kind: "CORE" })}
              title={
                core?.heartbeat
                  ? `Núcleo 24/7 · último latido ${new Date(core.heartbeat.at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} · ${core.heartbeat.note}${
                      core.mind?.feed ? ` · velas: ${feedLabel(core.mind.feed)}` : ""
                    }`
                  : "Núcleo 24/7 en el servidor"
              }
            >
              <i />NÚCLEO
            </button>
            <button className={showLedger ? "jv-tab on" : "jv-tab"} onClick={() => {
                setShowLedger((v) => !v);
                setShowVoice(false);
              }} aria-pressed={showLedger} title="Registro de señales y aprendizaje">📊</button>
            <button onClick={() => setOpen(false)} aria-label="Cerrar">✕</button>
          </div>
          <div className={`jv-hud ${mode}`} aria-hidden="true">
            <svg viewBox="0 0 200 200">
              <circle className="r1" cx="100" cy="100" r="92" />
              <circle className="r2" cx="100" cy="100" r="78" />
              <circle className="r3" cx="100" cy="100" r="64" />
              <circle className="r4" cx="100" cy="100" r="50" />
              <circle className="core" cx="100" cy="100" r="30" />
            </svg>
            <div className="jv-wave">
              {Array.from({ length: 9 }, (_, i) => (
                <i key={i} style={{ animationDelay: `${i * 0.09}s` }} />
              ))}
            </div>
          </div>
          <div className="jv-log" ref={logRef}>
            {lines.map((l, i) => (
              <p key={i} className={l.who}>
                <b>
                  {l.who === "yo" ? prefs.name.toUpperCase() : "JARVIS"}
                  {l.tag && <small> · {l.tag}</small>}
                </b>{" "}
                {l.text}
              </p>
            ))}
            {interim && <p className="yo interim">{interim}…</p>}
          </div>
          {showLedger && (() => {
            const fmtR = (r: number) => `${r >= 0 ? "+" : ""}${r.toFixed(2).replace(".", ",")}R`;
            const tabs = (
              <div className="jv-seg jv-ltabs four" role="tablist">
                {(
                  [
                    ["core", "NÚCLEO 24/7"],
                    ["mind", "MENTE"],
                    ["learn", "APRENDIZAJE"],
                    ["local", "ESTE EQUIPO"],
                  ] as const
                ).map(([id, label]) => (
                  <button key={id} role="tab" aria-selected={ledgerTab === id} className={ledgerTab === id ? "on" : ""} onClick={() => setLedgerTab(id)}>
                    {label}
                  </button>
                ))}
              </div>
            );
            if (ledgerTab === "mind") {
              const rd = core?.reading ?? null;
              const ia = core?.stats.bySource.IA ?? null;
              const iaOpen = (core?.open ?? []).filter((s) => s.source === "IA");
              const iaClosed = (core?.recent ?? []).filter((s) => s.source === "IA" && s.r !== null);
              const px = (v: number) => v.toLocaleString("es-AR", { maximumFractionDigits: v >= 1000 ? 0 : v >= 1 ? 3 : 6 });
              const coin = (s: string) => s.replace(/USDT$/, "");
              return (
                <div className="jv-ledger">
                  {tabs}
                  {!core ? (
                    <p className="jv-empty">Conectando con el núcleo…</p>
                  ) : !rd ? (
                    <p className="jv-empty">JARVIS escribe su primera lectura del mercado en la próxima hora, a los 17 minutos.</p>
                  ) : (
                    <div className="jv-mind">
                      <p className="jv-mind-head">
                        <b className={`jv-bias ${rd.sesgo.toLowerCase()}`}>{rd.sesgo === "NEUTRAL" ? "SIN DIRECCIÓN" : rd.sesgo}</b>
                        <span>
                          {new Date(rd.at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} · {BRAIN_LABEL[rd.brain]}
                        </span>
                      </p>
                      <p>{rd.resumen}</p>
                      {rd.activos.length > 0 && (
                        <ul>
                          {rd.activos.map((a) => (
                            <li key={a.moneda}>
                              <b>{a.moneda}</b> {a.lectura}
                            </li>
                          ))}
                        </ul>
                      )}
                      {rd.vigilar.length > 0 && <p className="jv-sample">A vigilar: {rd.vigilar.join(" · ")}</p>}
                      {rd.riesgos.length > 0 && <p className="jv-sample">Riesgos: {rd.riesgos.join(" · ")}</p>}
                      {(rd.quitadas?.length ?? 0) > 0 && (
                        <p className="jv-sample">
                          Verificación: quité {rd.quitadas?.length} {rd.quitadas?.length === 1 ? "frase" : "frases"} con números o niveles que no están en los datos.
                        </p>
                      )}
                    </div>
                  )}
                  {core && (
                    <div className="jv-learn">
                      <p>
                        <b>Tesis de la IA</b> ·{" "}
                        {ia && ia.resolved
                          ? `${ia.resolved} cerradas, win rate ${Math.round((ia.winRate ?? 0) * 100)}%, ${fmtR(ia.totalR)}${ia.resolved < 15 ? " · muestra mínima" : ""}`
                          : "todavía sin tesis cerradas para medir"}
                      </p>
                      {(iaOpen.length > 0 || iaClosed.length > 0) && (
                        <ul>
                          {iaOpen.map((s) => (
                            <li key={s.id}>
                              {coin(s.symbol)} {s.side === "LONG" ? "▲" : "▼"} abierta · entrada {px(s.entry)} · objetivo {px(s.target)} · invalidación {px(s.stop)}
                              {s.why ? ` · ${s.why}` : ""}
                            </li>
                          ))}
                          {iaClosed.slice(0, 5).map((s) => (
                            <li key={s.id}>
                              {coin(s.symbol)} {s.side === "LONG" ? "▲" : "▼"} {s.result === "OBJETIVO" ? "objetivo" : s.result === "STOP" ? "invalidada" : "cerrada por tiempo"} · {fmtR(s.r as number)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  <small>
                    Cada hora JARVIS lee todo el software en el servidor: 20 monedas en 1h, 4h y diario, imanes de liquidación, estructura del mercado, miedo y avaricia,
                    noticias, lo que aprendió su núcleo y su propio historial. Escribe esta lectura y, cuando la evidencia es clara, una tesis con objetivo e invalidación
                    que se mide sola contra el precio: así aprende de sus aciertos y errores, con el tamaño de muestra a la vista. No es asesoramiento financiero.
                  </small>
                </div>
              );
            }
            if (ledgerTab === "learn") {
              const l = core?.learning ?? null;
              const taken = core?.stats;
              const sh = core?.shadow;
              let verdict = "Todavía hay pocas señales cerradas para juzgar si el filtro ayuda.";
              if (taken && sh && taken.resolved >= 15 && sh.resolved >= 15 && taken.expectancyR !== null && sh.expectancyR !== null) {
                const d = taken.expectancyR - sh.expectancyR;
                verdict = d > 0 ? `Por ahora el filtro ayuda: las tomadas rinden ${fmtR(d)} más por señal que las descartadas.` : "Por ahora el filtro no ayuda: las descartadas no rinden peor que las tomadas.";
              }
              return (
                <div className="jv-ledger">
                  {tabs}
                  {!core ? (
                    <p className="jv-empty">Conectando con el núcleo…</p>
                  ) : !l ? (
                    <p className="jv-empty">El núcleo todavía no empezó a estudiar la historia: arranca en los próximos minutos.</p>
                  ) : (
                    <>
                      <div className="jv-kpis">
                        <span><b>{l.historyCases.toLocaleString("es-AR")}</b>situaciones estudiadas</span>
                        <span><b>{l.coins}</b>monedas</span>
                        <span><b>{l.backlog.toLocaleString("es-AR")}</b>velas por estudiar</span>
                        <span><b>{l.liveCases}</b>en vivo</span>
                      </div>
                      {(["ROMPE", "IMÁN"] as const).map((src) => {
                        const x = l.sources[src];
                        return (
                          <div key={src} className="jv-learn">
                            <p>
                              <b>{src === "ROMPE" ? "Rupturas" : "Barridas de imán"}</b>{" "}
                              {x.base ? `· esperado por señal ${fmtExpect(x.base)} con ${x.n.toLocaleString("es-AR")} casos` : `· ${x.n} casos, todavía pocos para opinar`}
                            </p>
                            {x.base && (
                              <ul>
                                {x.lessons.slice(1).map((t) => (
                                  <li key={t}>{t}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                      {taken && sh && (
                        <p className="jv-sample">
                          Filtro aprendido: tomadas {taken.resolved} cerradas ({fmtR(taken.totalR)}) · en sombra {sh.resolved} ({fmtR(sh.totalR)}). {verdict}
                        </p>
                      )}
                    </>
                  )}
                  <small>
                    Cómo aprende: recorre la historia de 20 monedas vela por vela con la misma regla que usa en vivo y solo las velas de ese momento, y anota el resultado de
                    las 48 siguientes. Con eso estima cuánto rinde cada tipo de señal según el contexto (BTC a favor o en contra, volatilidad, horario, fuerza) y cuán seguro
                    está. Una señal desfavorable queda en sombra: se mide igual pero no se anuncia. Con pocos casos no opina. {venuesSpeech(l?.venues) ?? ""}{" "}
                    {feedSpeech(core?.mind?.feed) ?? ""} No es asesoramiento financiero.
                  </small>
                </div>
              );
            }
            const onCore = ledgerTab === "core" && core !== null;
            const list: (JarvisSignal & Partial<Pick<CoreSignal, "taken" | "grade" | "expectR">>)[] = onCore
              ? [...core.open, ...core.recent].sort((a, b) => (b.closedAt ?? b.time) - (a.closedAt ?? a.time))
              : [...ledger].reverse();
            const st = onCore ? core.stats : ledgerStats(ledger);
            const pfTxt = st.profitFactor === null ? "—" : st.profitFactor === Infinity ? "∞" : st.profitFactor.toFixed(2).replace(".", ",");
            return (
              <div className="jv-ledger">
                {tabs}
                {ledgerTab === "core" && !core && <p className="jv-empty">Conectando con el núcleo…</p>}
                <div className="jv-kpis">
                  <span><b>{st.winRate === null ? "—" : `${Math.round(st.winRate * 100)}%`}</b>win rate</span>
                  <span><b>{pfTxt}</b>profit factor</span>
                  <span className={st.totalR >= 0 ? "up" : "down"}><b>{st.totalR >= 0 ? "+" : ""}{st.totalR.toFixed(1).replace(".", ",")}R</b>total</span>
                  <span><b>{st.expectancyR === null ? "—" : `${st.expectancyR >= 0 ? "+" : ""}${st.expectancyR.toFixed(2).replace(".", ",")}R`}</b>por señal</span>
                </div>
                <p className="jv-sample">
                  {st.resolved} cerradas ({st.wins} ganadoras · {st.losses} perdedoras) · {st.open} abiertas · {st.confidence.toLowerCase()}
                  {(["ROMPE", "IMÁN"] as const).map((src) =>
                    st.bySource[src].resolved ? ` · ${src === "ROMPE" ? "rupturas" : "imanes"}: PF ${st.bySource[src].profitFactor === Infinity ? "∞" : (st.bySource[src].profitFactor ?? 0).toFixed(2).replace(".", ",")} en ${st.bySource[src].resolved}` : "",
                  )}
                  {onCore && core.shadow.resolved ? ` · en sombra (no cuentan): ${core.shadow.resolved}, ${fmtR(core.shadow.totalR)}` : ""}
                </p>
                <div className="jv-sigs">
                  {list.length ? (
                    list.slice(0, 12).map((x) => (
                      <p key={x.id} className={`${x.r === null ? "" : x.r > 0 ? "up" : "down"}${x.taken === false ? " shadow" : ""}`}>
                        <b>{x.symbol.replace(/USDT$/, "")} {x.side === "LONG" ? "▲" : "▼"} {x.timeframe}</b>
                        <span>{fmtPx(x.entry)} → stop {fmtPx(x.stop)} · obj {fmtPx(x.target)}</span>
                        <em>{x.result === "ABIERTA" ? "abierta" : `${x.result.toLowerCase()} ${x.r !== null ? `${x.r >= 0 ? "+" : ""}${x.r.toFixed(2).replace(".", ",")}R` : ""}`}</em>
                        {x.grade && (
                          <i className={`jv-grade g-${x.taken === false ? "sombra" : x.grade.toLowerCase()}`}>
                            {x.taken === false ? "en sombra" : GRADE_LABEL[x.grade]}
                            {x.expectR !== null && x.expectR !== undefined && x.grade !== "APRENDIENDO" ? ` ${fmtR(x.expectR)}` : ""}
                          </i>
                        )}
                      </p>
                    ))
                  ) : (
                    <p className="jv-empty">
                      {onCore
                        ? "El núcleo todavía no abrió señales: solo lo hace cuando una moneda está a punto de romper con dirección o un imán se barre y rechaza."
                        : "Todavía no di señales con dirección en este equipo. Activá la vigilancia o preguntame qué está por romper."}
                    </p>
                  )}
                </div>
                <div className="jv-ledger-actions">
                  <button onClick={refreshLedger}>ACTUALIZAR</button>
                  {list.length > 0 && (
                    <button
                      onClick={() => {
                        const url = URL.createObjectURL(new Blob([ledgerCsv([...list].reverse())], { type: "text/csv;charset=utf-8" }));
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = onCore ? "jarvis-nucleo.csv" : "jarvis-senales.csv";
                        a.click();
                        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
                      }}
                    >
                      CSV
                    </button>
                  )}
                </div>
                <small>
                  Cada señal queda con su plan desde que la doy y se resuelve con las velas siguientes: si una vela toca stop y objetivo, cuenta el stop; a las 48 velas
                  se cierra a mercado; comisiones descontadas. Nada se borra ni se corrige después.{" "}
                  {onCore
                    ? `El núcleo corre en el servidor las 24 horas: ${core.heartbeat ? `último latido ${new Date(core.heartbeat.at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} (${core.heartbeat.note})` : "todavía sin latido"}. ${
                        feedSpeech(core.mind?.feed) ?? ""
                      } Las señales en sombra se miden aparte y no cuentan en el registro.`
                    : "Guardado en este equipo."}{" "}
                  No es asesoramiento financiero.
                </small>
              </div>
            );
          })()}
          <div className="jv-chips">
            {["Tu lectura del mercado", "Analizá Bitcoin", "Informe del mercado", "¿Qué está por romper?", "¿Cómo vienen tus señales?", "¿Qué aprendiste?", "Estado del núcleo"].map((c) => (
              <button key={c} onClick={() => handle(c)}>{c}</button>
            ))}
          </div>
          <form
            className="jv-input"
            onSubmit={(e) => {
              e.preventDefault();
              handle(draft);
              setDraft("");
            }}
          >
            <button
              type="button"
              className={mode === "listening" ? "mic on" : "mic"}
              onClick={() => {
                unlockAudio();
                // Tapping while JARVIS talks interrupts it and listens, like any assistant.
                if (mode === "speaking") hush();
                if (oneShotRef.current) recRef.current?.stop();
                else listenOnce();
              }}
              aria-label="Hablar"
            >
              🎙
            </button>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Escribí o tocá el micrófono…" />
            <button type="submit">ENVIAR</button>
          </form>
          <div className="jv-opts">
            <label><input type="checkbox" checked={prefs.voice} onChange={(e) => setPrefs({ voice: e.target.checked })} /> Voz</label>
            {supportsListen && (
              <label title="Escucha con la pantalla encendida: decí «Jarvis» y tu pedido. Con la app en segundo plano no escucha: mandale una nota de voz por Telegram"><input type="checkbox" checked={prefs.wake} onChange={(e) => setPrefs({ wake: e.target.checked })} /> Manos libres</label>
            )}
            {handsText && <p className="jv-hf" role="status">{handsText}</p>}
            <label title="Cada 5 minutos revisa 20 monedas y las barridas de imanes de BTC, ETH y SOL; te avisa en voz y registra cada señal con su resultado"><input type="checkbox" checked={prefs.watch} onChange={(e) => setPrefs({ watch: e.target.checked })} /> Vigilancia</label>
            <button type="button" className="jv-link" title="Empieza una conversación nueva. Las notas que JARVIS guarda de vos siguen." onClick={newThread}>Nueva charla</button>
            <button type="button" className={`jv-voicebtn${showVoice ? " on" : ""}`} onClick={() => {
                setShowVoice((v) => !v);
                setShowLedger(false);
              }} aria-expanded={showVoice}>
              🔊 VOZ
            </button>
          </div>
          {showVoice && (
            <div className="jv-voice">
              <div className="jv-seg" role="radiogroup" aria-label="Motor de voz">
                <button type="button" role="radio" aria-checked={prefs.engine === "neural"} className={prefs.engine === "neural" ? "on" : ""} onClick={() => setPrefs({ engine: "neural" })}>
                  NEURONAL PRO
                </button>
                <button type="button" role="radio" aria-checked={prefs.engine === "device"} className={prefs.engine === "device" ? "on" : ""} onClick={() => setPrefs({ engine: "device" })}>
                  DEL TELÉFONO
                </button>
              </div>
              {prefs.engine === "neural" && (
                <>
                  <label className="jv-row">
                    <span>Voz</span>
                    <select value={neuralVoice(prefs.neuralVoice).id} onChange={(e) => setPrefs({ neuralVoice: e.target.value })} aria-label="Voz neuronal">
                      {NEURAL_VOICES.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label} · {v.accent} · {v.style}
                        </option>
                      ))}
                    </select>
                  </label>
                  <small className={/login|quota|off/.test(neural) ? "err" : ""}>
                    {(() => {
                      const [st, model] = neural.split("|");
                      if (st === "login") return "Iniciá sesión para usar la voz neuronal; mientras tanto hablo con la del teléfono.";
                      if (st === "quota") return "Se usó el cupo diario de voz neuronal: hasta mañana hablo con la del teléfono.";
                      if (st === "off") return "La voz neuronal todavía no está activa en el servidor: hablo con la del teléfono.";
                      if (model === "melo") return "Voz neuronal simple: el cupo premium de hoy ya se usó (vuelve mañana).";
                      if (model === "aura") return "Voz neuronal premium (Deepgram Aura-2) servida por Cloudflare. Las frases repetidas salen de la caché, sin gastar cupo.";
                      return "Voz neuronal premium (Deepgram Aura-2). Si falla o se acaba el cupo diario, sigo con la del teléfono sin cortarme.";
                    })()}
                  </small>
                </>
              )}
              <label className="jv-row">
                <span>{prefs.engine === "neural" ? "Respaldo" : "Voz"}</span>
                <select value={prefs.voiceName} onChange={(e) => setPrefs({ voiceName: e.target.value })} aria-label="Voz del teléfono">
                  <option value="">Automática · la mejor del teléfono</option>
                  {voices.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name.replace(/^(Microsoft|Google)\s+/, "")} · {v.lang}
                      {/natural|neural|online|premium|enhanced|google/i.test(v.name) ? " ★" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {prefs.engine === "device" && (
                <div className="jv-row">
                  <span>Tono</span>
                  <div className="jv-seg small">
                    <button type="button" className={prefs.gender === "male" ? "on" : ""} onClick={() => setPrefs({ gender: "male", voiceName: "" })}>MASCULINA</button>
                    <button type="button" className={prefs.gender === "female" ? "on" : ""} onClick={() => setPrefs({ gender: "female", voiceName: "" })}>FEMENINA</button>
                  </div>
                </div>
              )}
              <div className="jv-row">
                <span>Velocidad</span>
                <input type="range" min={0.8} max={1.25} step={0.05} value={prefs.rate} onChange={(e) => setPrefs({ rate: Number(e.target.value) })} aria-label="Velocidad de la voz" />
                <b>{prefs.rate.toFixed(2).replace(".", ",")}×</b>
              </div>
              <label className="jv-row">
                <input type="checkbox" checked={prefs.followUp} onChange={(e) => setPrefs({ followUp: e.target.checked })} /> Conversación continua: después de responder algo que pediste por voz, sigo escuchando
              </label>
              <button
                type="button"
                className="jv-test"
                onClick={() => {
                  unlockAudio();
                  speak(VOICE_TEST);
                }}
              >
                ▶ PROBAR VOZ
              </button>
              {prefs.engine === "device" && (
                <small>
                  {(() => {
                    const all = voices;
                    const v = all.find((x) => x.name === prefs.voiceName) ?? pickVoice(all, prefs.gender);
                    if (!v) return "Tu navegador no tiene voces en español: JARVIS te responde por escrito.";
                    const good = /natural|neural|online|premium|enhanced|google/i.test(v.name);
                    return `Usando: ${v.name} (${v.lang}).${good ? "" : " ★ = voces de mejor calidad. En la PC, Microsoft Edge trae «Tomás» y «Elena» de Argentina (naturales); en Android, Ajustes › Texto a voz › Servicios de Google › instalá las voces de español."}`;
                  })()}
                </small>
              )}
            </div>
          )}
          <small className="jv-foot">El dictado se procesa en tu navegador; la voz neuronal, en Cloudflare. Análisis, no órdenes: no es asesoramiento financiero.</small>
        </div>
      )}
    </>
  );
}
