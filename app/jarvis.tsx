"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { openInMap, showSection } from "@/lib/account-events";
import { eligible } from "@/lib/decoupling";
import { briefingText, greeting, HELP_TEXT, parseCommand, priceLine, type JarvisIntent, type Ticker } from "@/lib/jarvis";
import { FUTURES_BASES, loadRows, loadTopSymbols, timeframeConfig } from "@/lib/market-fetch";
import { readPreBreak } from "@/lib/pre-breakout";
import { parseSwingKlines } from "@/lib/swing-entries";
import { everyVisible } from "@/lib/visible-interval";

/**
 * JARVIS: a voice assistant over the whole app. It listens (Web Speech API,
 * es-AR), speaks back, opens sections and coins, reads prices, briefs the
 * market, watches for coins about to break and, for anything else, asks the
 * AI analyst. Everything runs in the browser; nothing is recorded or sent
 * anywhere except the AI question itself.
 */

type Line = { who: "yo" | "jarvis"; text: string };
type Mode = "idle" | "listening" | "thinking" | "speaking";
type Breakout = { symbol: string; side: string; score: number };

const PREFS_KEY = "alt-radar-pro:jarvis:v1";
type Prefs = { name: string; voice: boolean; wake: boolean; watch: boolean; lastBriefing: string };
const DEFAULT_PREFS: Prefs = { name: "señor", voice: true, wake: false, watch: false, lastBriefing: "" };

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
      if (r && r.state === "A PUNTO") out.push({ symbol, side: r.side, score: r.score });
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
      const u = new SpeechSynthesisUtterance(text);
      const voices = speechSynthesis.getVoices();
      u.voice = voices.find((v) => v.lang === "es-AR") ?? voices.find((v) => v.lang.startsWith("es") && /male|jorge|diego|pablo|google/i.test(v.name)) ?? voices.find((v) => v.lang.startsWith("es")) ?? null;
      u.lang = u.voice?.lang ?? "es-AR";
      u.rate = 1.03;
      u.pitch = 0.85;
      let started = false;
      u.onstart = () => {
        started = true;
        setMode("speaking");
      };
      u.onend = () => setMode(wakeRef.current ? "listening" : "idle");
      u.onerror = () => setMode(wakeRef.current ? "listening" : "idle");
      speechSynthesis.speak(u);
      // Browsers without a usable voice never start: the text is already on screen, so don't hang.
      window.setTimeout(() => {
        if (!started) setMode(wakeRef.current ? "listening" : "idle");
      }, 2500);
    },
    [prefs.voice],
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
            return speak(
              hot.length
                ? `En ${intent.timeframe}, a punto de romper: ${hot.slice(0, 4).map((b) => `${b.symbol.replace(/USDT$/, "")} ${b.side === "ALCISTA" ? "hacia arriba" : b.side === "BAJISTA" ? "hacia abajo" : "sin dirección clara"}, presión ${b.score}`).join("; ")}. La dirección es probable, no segura.`
                : `En ${intent.timeframe} no veo ninguna de las principales comprimida contra un nivel.`,
            );
          }
          case "BRIEFING": {
            const [tickers, hot] = await Promise.all([tickers24h(), scanBreakouts("1h", 12).catch(() => undefined)]);
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
    [lines, prefs.name, setPrefs, speak],
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
      const hot = await scanBreakouts("1h", 20).catch(() => []);
      const fresh = hot.filter((b) => !seen.has(b.symbol));
      fresh.forEach((b) => seen.add(b.symbol));
      if (fresh.length) {
        setOpen(true);
        speak(`Atención, ${prefs.name}: ${fresh.slice(0, 3).map((b) => `${b.symbol.replace(/USDT$/, "")} está a punto de romper ${b.side === "ALCISTA" ? "hacia arriba" : b.side === "BAJISTA" ? "hacia abajo" : ""}`).join("; ")}.`);
      }
    };
    void check();
    return everyVisible(() => void check(), 300_000);
  }, [prefs.watch, prefs.name, speak]);

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
          <div className="jv-chips">
            {["Informe del mercado", "¿Qué está por romper?", "¿Qué está subiendo?", "Precio de Bitcoin", "Abrí las señales"].map((c) => (
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
            <label title="Cada 5 minutos revisa 20 monedas y te avisa en voz si alguna está a punto de romper"><input type="checkbox" checked={prefs.watch} onChange={(e) => setPrefs({ watch: e.target.checked })} /> Vigilancia</label>
          </div>
          <small className="jv-foot">La voz se procesa en tu navegador. Análisis, no órdenes: no es asesoramiento financiero.</small>
        </div>
      )}
    </>
  );
}
