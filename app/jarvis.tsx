"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { openInMap, showSection } from "@/lib/account-events";
import { eligible } from "@/lib/decoupling";
import { briefingText, greeting, HELP_TEXT, parseCommand, priceLine, type JarvisIntent, type Ticker } from "@/lib/jarvis";
import { FUTURES_BASES, loadRows, loadTopSymbols, timeframeConfig } from "@/lib/market-fetch";
import { readPreBreak } from "@/lib/pre-breakout";
import { addSignals, breakoutSignal, ledgerCsv, ledgerStats, magnetSignal, resolveSignal, statsSpeech, type JarvisSignal } from "@/lib/jarvis-ledger";
import { buildLiquidationHeatmap } from "@/lib/liquidation-heatmap";
import { magnetEvents, strongestMagnets } from "@/lib/magnet-watch";
import { parseSwingKlines } from "@/lib/swing-entries";
import { everyVisible } from "@/lib/visible-interval";
import { pickVoice } from "@/lib/browser-voice";
import { normalizeSpanish, splitForSpeech } from "@/lib/speech-text";

/**
 * JARVIS: a voice assistant over the whole app. It listens (Web Speech API,
 * es-AR), speaks back, opens sections and coins, reads prices, briefs the
 * market, watches for coins about to break and, for anything else, asks the
 * AI analyst. Everything runs in the browser; nothing is recorded or sent
 * anywhere except the AI question itself.
 */

type Line = { who: "yo" | "jarvis"; text: string };
type Mode = "idle" | "listening" | "thinking" | "speaking";
type Breakout = { symbol: string; side: string; score: number; signal: JarvisSignal | null };

const LEDGER_KEY = "alt-radar-pro:jarvis-ledger:v1";
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
  /** Device voice by name; "" = the best Spanish one available. */
  voiceName: string;
  gender: "male" | "female";
  rate: number;
};
const DEFAULT_PREFS: Prefs = { name: "señor", voice: true, wake: false, watch: false, lastBriefing: "", voiceName: "", gender: "male", rate: 1 };
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
};
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

export default function Jarvis() {
  return useMounted() ? <JarvisInner /> : null;
}

function JarvisInner() {
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
  const ledgerRef = useRef(ledger);
  const recRef = useRef<SpeechRec | null>(null);
  const wakeRef = useRef(false);
  const known = useRef<Set<string>>(new Set());
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

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [lines, interim]);

  const speak = useCallback(
    (text: string) => {
      setLines((l) => [...l, { who: "jarvis" as const, text }].slice(-40));
      if (!prefs.voice || typeof speechSynthesis === "undefined") {
        setMode("idle");
        return;
      }
      speechSynthesis.cancel();
      const all = speechSynthesis.getVoices();
      const voice = all.find((v) => v.name === prefs.voiceName) ?? pickVoice(all, prefs.gender);
      // Said as words ("uno coma setenta y seis", "uin réit"), in pieces: Chrome cuts long utterances off after ~15 s.
      const parts = splitForSpeech(normalizeSpanish(text), 180);
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
            setMode("speaking");
          };
        if (i === parts.length - 1) u.onend = () => setMode(wakeRef.current ? "listening" : "idle");
        u.onerror = () => setMode(wakeRef.current ? "listening" : "idle");
        speechSynthesis.speak(u);
      });
      // Browsers without a usable voice never start: the text is already on screen, so don't hang.
      window.setTimeout(() => {
        if (!started) setMode(wakeRef.current ? "listening" : "idle");
      }, 2500);
    },
    [prefs.voice, prefs.voiceName, prefs.gender, prefs.rate],
  );

  const run = useCallback(
    async (intent: JarvisIntent) => {
      setMode("thinking");
      try {
        switch (intent.kind) {
          case "STOP":
            speechSynthesis?.cancel();
            setMode("idle");
            return;
          case "HELP":
            return speak(HELP_TEXT);
          case "NAME":
            setPrefs({ name: intent.name });
            return speak(`Entendido. De ahora en más te llamo ${intent.name}.`);
          case "SECTION":
            showSection(intent.section);
            return speak(`Abriendo ${intent.label.toLowerCase()}.`);
          case "MAP":
            openInMap(`${intent.symbol}USDT`, intent.timeframe);
            return speak(`Mapa de ${intent.symbol}${intent.timeframe ? ` en ${intent.timeframe.replace("m", " minutos").replace("h", intent.timeframe === "1h" ? " hora" : " horas").replace("1d", "diario")}` : ""}, en pantalla.`);
          case "PRICE": {
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
            await resolveOpen();
            setShowLedger(true);
            return speak(statsSpeech(ledgerStats(ledgerRef.current)));
          }
          case "BRIEFING": {
            const [tickers, hot] = await Promise.all([tickers24h(), scanBreakouts("1h", 12).catch(() => undefined)]);
            if (hot) record(hot.map((b) => b.signal));
            setPrefs({ lastBriefing: new Date().toISOString().slice(0, 10) });
            return speak(briefingText({ hour: new Date().getHours(), name: prefs.name, tickers, breakouts: hot }));
          }
          case "AI": {
            const r = await fetch("/api/analyst/ai", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ question: intent.question, history: lines.slice(-6).map((l) => ({ role: l.who === "yo" ? "user" : "assistant", content: l.text })) }),
            });
            const d = (await r.json().catch(() => ({}))) as { text?: string; error?: string };
            return speak(
              d.text ??
                (d.error === "SESIÓN REQUERIDA"
                  ? "Para consultas libres necesito que inicies sesión. Los comandos de mercado funcionan igual."
                  : d.error === "LÍMITE DIARIO ALCANZADO"
                    ? "Llegamos al límite diario de consultas a la inteligencia artificial."
                    : "No pude consultar a la inteligencia artificial ahora."),
            );
          }
        }
      } catch {
        speak("No pude completar eso: Binance no respondió. Probá de nuevo en un momento.");
      }
    },
    [lines, prefs.name, record, resolveOpen, setPrefs, speak],
  );

  const handle = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      setLines((l) => [...l, { who: "yo" as const, text: clean }].slice(-40));
      void run(parseCommand(clean, known.current));
    },
    [run],
  );

  // Listening: one phrase, or continuous with the wake word "Jarvis".
  const startListening = useCallback(
    (wake: boolean) => {
      recRef.current?.stop();
      const rec = recognizer();
      if (!rec) return speak("Tu navegador no permite dictado por voz. Probá con Chrome, o escribime.");
      rec.lang = "es-AR";
      rec.continuous = wake;
      rec.interimResults = true;
      wakeRef.current = wake;
      rec.onresult = (e) => {
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
        if (wake) {
          const m = finalText.match(/jarvis[,:]?\s*(.*)$/i);
          if (!m) return;
          setOpen(true);
          if (m[1].trim()) handle(m[1]);
          else speak(`Te escucho, ${prefs.name}.`);
        } else handle(finalText);
      };
      rec.onerror = (e) => {
        if (e.error === "not-allowed") {
          wakeRef.current = false;
          setPrefs({ wake: false });
          speak("Necesito permiso para usar el micrófono.");
        }
      };
      rec.onend = () => {
        if (wakeRef.current) {
          try {
            rec.start();
          } catch {
            // already restarting
          }
        } else setMode((m) => (m === "listening" ? "idle" : m));
      };
      recRef.current = rec;
      try {
        rec.start();
        setMode("listening");
      } catch {
        // already started
      }
    },
    [handle, prefs.name, setPrefs, speak],
  );

  useEffect(() => {
    if (prefs.wake && supportsListen) {
      void (async () => {
        await Promise.resolve();
        startListening(true);
      })();
    } else if (!prefs.wake) {
      wakeRef.current = false;
      recRef.current?.stop();
    }
    return () => {
      wakeRef.current = false;
      recRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the wake setting changes
  }, [prefs.wake]);

  // Watch mode: every 5 minutes with the tab visible, warn about new coins about to break.
  useEffect(() => {
    if (!prefs.watch) return;
    const seen = new Set<string>();
    const check = async () => {
      await resolveOpen();
      const [hot, sweeps] = await Promise.all([scanBreakouts("1h", 20).catch(() => []), scanMagnetSignals().catch(() => [])]);
      const added = record([...hot.map((b) => b.signal), ...sweeps]);
      const fresh = hot.filter((b) => !seen.has(b.symbol));
      fresh.forEach((b) => seen.add(b.symbol));
      const parts: string[] = [];
      if (fresh.length) parts.push(`${fresh.slice(0, 3).map((b) => `${b.symbol.replace(/USDT$/, "")} está a punto de romper ${b.side === "ALCISTA" ? "hacia arriba" : b.side === "BAJISTA" ? "hacia abajo" : "sin dirección clara"}`).join("; ")}.`);
      if (added.length) parts.push(added.slice(0, 3).map(signalSpeech).join(" "));
      if (parts.length) {
        setOpen(true);
        speak(`Atención, ${prefs.name}: ${parts.join(" ")}`);
      }
    };
    void check();
    return everyVisible(() => void check(), 300_000);
  }, [prefs.watch, prefs.name, record, resolveOpen, speak]);

  // Keyboard: Alt+J opens and listens; Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen(true);
        startListening(false);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [startListening]);

  const openPanel = () => {
    setOpen(true);
    void resolveOpen();
    if (!lines.length) {
      const today = new Date().toISOString().slice(0, 10);
      if (prefs.lastBriefing !== today) void run({ kind: "BRIEFING" });
      else speak(`${greeting(new Date().getHours(), prefs.name)} ¿En qué te ayudo?`);
    }
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
            <button className={showLedger ? "jv-tab on" : "jv-tab"} onClick={() => setShowLedger((v) => !v)} aria-pressed={showLedger} title="Registro de señales">📊</button>
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
                <b>{l.who === "yo" ? prefs.name.toUpperCase() : "JARVIS"}</b> {l.text}
              </p>
            ))}
            {interim && <p className="yo interim">{interim}…</p>}
          </div>
          {showLedger && (() => {
            const st = ledgerStats(ledger);
            const pfTxt = st.profitFactor === null ? "—" : st.profitFactor === Infinity ? "∞" : st.profitFactor.toFixed(2).replace(".", ",");
            return (
              <div className="jv-ledger">
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
                </p>
                <div className="jv-sigs">
                  {ledger.length ? (
                    [...ledger].reverse().slice(0, 12).map((x) => (
                      <p key={x.id} className={x.r === null ? "" : x.r > 0 ? "up" : "down"}>
                        <b>{x.symbol.replace(/USDT$/, "")} {x.side === "LONG" ? "▲" : "▼"} {x.timeframe}</b>
                        <span>{fmtPx(x.entry)} → stop {fmtPx(x.stop)} · obj {fmtPx(x.target)}</span>
                        <em>{x.result === "ABIERTA" ? "abierta" : `${x.result.toLowerCase()} ${x.r !== null ? `${x.r >= 0 ? "+" : ""}${x.r.toFixed(2).replace(".", ",")}R` : ""}`}</em>
                      </p>
                    ))
                  ) : (
                    <p className="jv-empty">Todavía no di señales con dirección. Activá la vigilancia o preguntame qué está por romper.</p>
                  )}
                </div>
                <div className="jv-ledger-actions">
                  <button onClick={() => void resolveOpen()}>ACTUALIZAR</button>
                  {ledger.length > 0 && (
                    <button
                      onClick={() => {
                        const url = URL.createObjectURL(new Blob([ledgerCsv(ledger)], { type: "text/csv;charset=utf-8" }));
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = "jarvis-senales.csv";
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
                  se cierra a mercado; comisiones descontadas. Nada se borra ni se corrige después. Guardado en este dispositivo. No es asesoramiento financiero.
                </small>
              </div>
            );
          })()}
          <div className="jv-chips">
            {["Informe del mercado", "¿Qué está por romper?", "¿Cómo vienen tus señales?", "¿Qué está subiendo?", "Precio de Bitcoin"].map((c) => (
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
            <button type="button" className={mode === "listening" ? "mic on" : "mic"} onClick={() => (mode === "listening" && !prefs.wake ? recRef.current?.stop() : startListening(false))} aria-label="Hablar">
              🎙
            </button>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Escribí o tocá el micrófono…" />
            <button type="submit">ENVIAR</button>
          </form>
          <div className="jv-opts">
            <label><input type="checkbox" checked={prefs.voice} onChange={(e) => setPrefs({ voice: e.target.checked })} /> Voz</label>
            {supportsListen && (
              <label title="Queda escuchando: decí «Jarvis» y tu pedido"><input type="checkbox" checked={prefs.wake} onChange={(e) => setPrefs({ wake: e.target.checked })} /> Manos libres</label>
            )}
            <label title="Cada 5 minutos revisa 20 monedas y las barridas de imanes de BTC, ETH y SOL; te avisa en voz y registra cada señal con su resultado"><input type="checkbox" checked={prefs.watch} onChange={(e) => setPrefs({ watch: e.target.checked })} /> Vigilancia</label>
            <button type="button" className={`jv-voicebtn${showVoice ? " on" : ""}`} onClick={() => setShowVoice((v) => !v)} aria-expanded={showVoice}>
              🔊 VOZ
            </button>
          </div>
          {showVoice && (
            <div className="jv-voice">
              <label className="jv-row">
                <span>Voz</span>
                <select value={prefs.voiceName} onChange={(e) => setPrefs({ voiceName: e.target.value })} aria-label="Voz del teléfono">
                  <option value="">Automática · la mejor disponible</option>
                  {voices.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name.replace(/^(Microsoft|Google)\s+/, "")} · {v.lang}
                      {/natural|neural|online|premium|enhanced|google/i.test(v.name) ? " ★" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <div className="jv-row">
                <span>Tono</span>
                <div className="jv-seg small">
                  <button type="button" className={prefs.gender === "male" ? "on" : ""} onClick={() => setPrefs({ gender: "male", voiceName: "" })}>MASCULINA</button>
                  <button type="button" className={prefs.gender === "female" ? "on" : ""} onClick={() => setPrefs({ gender: "female", voiceName: "" })}>FEMENINA</button>
                </div>
              </div>
              <div className="jv-row">
                <span>Velocidad</span>
                <input type="range" min={0.8} max={1.25} step={0.05} value={prefs.rate} onChange={(e) => setPrefs({ rate: Number(e.target.value) })} aria-label="Velocidad de la voz" />
                <b>{prefs.rate.toFixed(2).replace(".", ",")}×</b>
              </div>
              <button type="button" className="jv-test" onClick={() => speak(VOICE_TEST)}>▶ PROBAR VOZ</button>
              <small>
                {(() => {
                  const all = voices;
                  const v = all.find((x) => x.name === prefs.voiceName) ?? pickVoice(all, prefs.gender);
                  if (!v) return "Tu navegador no tiene voces en español: JARVIS te responde por escrito.";
                  const good = /natural|neural|online|premium|enhanced|google/i.test(v.name);
                  return `Usando: ${v.name} (${v.lang}).${good ? "" : " ★ = voces de mejor calidad. En la PC, Microsoft Edge trae «Tomás» y «Elena» de Argentina (naturales); en Android, Ajustes › Texto a voz › Servicios de Google › instalá las voces de español."}`;
                })()}
              </small>
            </div>
          )}
          <small className="jv-foot">La voz se procesa en tu navegador. Análisis, no órdenes: no es asesoramiento financiero.</small>
        </div>
      )}
    </>
  );
}
