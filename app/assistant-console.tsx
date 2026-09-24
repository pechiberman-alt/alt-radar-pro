"use client";

import { useEffect, useRef, useState } from "react";
import { AI_DAILY_LIMIT, compactSnapshot, type ChatTurn } from "@/lib/ai-analyst";
import { ask, type AssistantAnswer, type AssistantContext } from "@/lib/assistant/index";

type Entry =
  | { id: number; kind: "rules"; question: string; answer: AssistantAnswer; at: string }
  | { id: number; kind: "ai"; question: string; text: string; error: boolean; at: string };

type Mode = "reglas" | "ia";

const SUGGESTIONS = [
  "Dame un resumen del mercado",
  "¿Dónde está el piso más fuerte?",
  "¿Hay absorción?",
  "¿Hay squeeze?",
  "¿Hay pumpeo ahora?",
  "¿Cómo está la dominancia?",
  "¿Qué es un iceberg?",
  "¿Cuánto arriesgo por operación?",
];

export default function AssistantConsole({
  getContext,
}: {
  /** Resolved when a question is asked, so the answer uses the current snapshot. */
  getContext: () => AssistantContext;
}) {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<Entry[]>([]);
  const [mode, setMode] = useState<Mode>("reglas");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiRemaining, setAiRemaining] = useState<number | null>(null);
  const [readiness, setReadiness] = useState({ available: 0, total: 5 });
  const nextId = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);

  // Keep the newest exchange in view without yanking the whole page.
  useEffect(() => {
    if (!history.length || !logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [history]);

  // Poll which data sources are populated, for the header badge.
  useEffect(() => {
    const check = () => {
      const context = getContext();
      setReadiness({
        available: [
          context.market.length > 0,
          context.structure !== null,
          context.pumps.length > 0,
          context.correlations != null,
          context.orderFlow != null,
        ].filter(Boolean).length,
        total: 5,
      });
    };
    const boot = window.setTimeout(check, 500);
    const timer = window.setInterval(check, 15_000);
    return () => {
      window.clearTimeout(boot);
      window.clearInterval(timer);
    };
  }, [getContext]);

  const submitAi = async (text: string) => {
    setAiBusy(true);
    setQuestion("");
    // Only text of earlier AI exchanges is sent back, never old snapshots.
    const turns: ChatTurn[] = history
      .filter((e): e is Extract<Entry, { kind: "ai" }> => e.kind === "ai" && !e.error)
      .slice(-3)
      .flatMap((e) => [
        { role: "user" as const, content: e.question },
        { role: "assistant" as const, content: e.text },
      ]);
    let entry: Entry;
    try {
      const r = await fetch("/api/analyst/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, snapshot: compactSnapshot(getContext()), history: turns }),
      });
      const d = (await r.json().catch(() => ({}))) as { text?: string; error?: string; remaining?: number };
      if (typeof d.remaining === "number") setAiRemaining(d.remaining);
      const message =
        d.error === "SESIÓN REQUERIDA"
          ? "Para usar la IA ingresá con tu cuenta (INGRESAR arriba). El modo REGLAS funciona sin cuenta."
          : d.error === "IA NO CONFIGURADA"
            ? "La IA todavía no está configurada en el servidor (falta la clave de Anthropic). El modo REGLAS sigue disponible."
            : d.error === "LÍMITE DIARIO ALCANZADO"
              ? `Llegaste al límite de ${AI_DAILY_LIMIT} preguntas con IA por hoy. Se renueva mañana; el modo REGLAS no tiene límite.`
              : d.error ?? "";
      entry = r.ok && d.text
        ? { id: nextId.current++, kind: "ai", question: text, text: d.text, error: false, at: new Date().toLocaleTimeString() }
        : { id: nextId.current++, kind: "ai", question: text, text: message || "La IA no respondió.", error: true, at: new Date().toLocaleTimeString() };
    } catch {
      entry = { id: nextId.current++, kind: "ai", question: text, text: "Sin conexión con la IA.", error: true, at: new Date().toLocaleTimeString() };
    }
    setHistory((current) => [...current.slice(-11), entry]);
    setAiBusy(false);
  };

  const submit = (raw: string) => {
    const text = raw.trim();
    if (!text || aiBusy) return;
    if (mode === "ia") {
      void submitAi(text);
      return;
    }
    const answer = ask(text, getContext());
    setHistory((current) => [
      ...current.slice(-11),
      { id: nextId.current++, kind: "rules", question: text, answer, at: new Date().toLocaleTimeString() },
    ]);
    setQuestion("");
  };

  return (
    <section className="panel assistant-console" id="asistente">
      <div className="panel-head">
        <div>
          <p className="eyebrow">ANALISTA DE TERMINAL · {mode === "ia" ? "IA · CLAUDE" : "MOTOR LOCAL"}</p>
          <h2>Preguntale a la terminal</h2>
        </div>
        <span className="badge">
          {mode === "ia"
            ? `IA · ${aiRemaining ?? AI_DAILY_LIMIT}/${AI_DAILY_LIMIT} HOY`
            : `SIN LLM · 0 TOKENS`}{" "}
          · {readiness.available}/{readiness.total} FUENTES
        </span>
      </div>

      <div className="assistant-modes" role="group" aria-label="Modo del analista">
        <button className={mode === "reglas" ? "on" : ""} onClick={() => setMode("reglas")} aria-pressed={mode === "reglas"}>
          REGLAS
          <em>instantáneo · sin terceros</em>
        </button>
        <button className={mode === "ia" ? "on" : ""} onClick={() => setMode("ia")} aria-pressed={mode === "ia"}>
          IA · CLAUDE
          <em>razona con los datos del radar</em>
        </button>
      </div>
      {mode === "ia" && (
        <p className="assistant-ai-note">
          La pregunta y un resumen de los datos del radar se envían a Anthropic para generar la respuesta.
          No es una IA entrenada por nosotros: es Claude con instrucciones de la metodología de ALT RADAR y
          los datos en vivo de tus paneles. Puede equivocarse — cada cifra debería coincidir con los paneles.
        </p>
      )}

      <div className="assistant-log" ref={logRef}>
        {!history.length && (
          <div className="assistant-intro">
            <b>◉ LISTO</b>
            <p>
              Leo el snapshot real que ya tiene la terminal y explico lo que ves. Puedo
              responder por activo, señal, pumpeo, dominancia, correlaciones, riesgo y
              rendimiento registrado, y explicar cualquier concepto del panel.
            </p>
            <small>
              No uso modelo de lenguaje ni envío tus preguntas a terceros. Si un dato no está
              en el snapshot, te lo digo en lugar de completarlo.
            </small>
          </div>
        )}

        {history.map((entry) =>
          entry.kind === "ai" ? (
            <div className="assistant-exchange" key={entry.id}>
              <div className="assistant-question">
                <span>VOS</span>
                <b>{entry.question}</b>
                <time>{entry.at}</time>
              </div>
              <div className={`assistant-answer ai${entry.error ? " error" : ""}`}>
                <div className="assistant-answer-head">
                  <span>{entry.error ? "AVISO" : "IA · CLAUDE"}</span>
                </div>
                <p className="ai-text">{entry.text}</p>
              </div>
            </div>
          ) : (
          <div className="assistant-exchange" key={entry.id}>
            <div className="assistant-question">
              <span>VOS</span>
              <b>{entry.question}</b>
              <time>{entry.at}</time>
            </div>
            <div className="assistant-answer">
              <div className="assistant-answer-head">
                <span>TERMINAL</span>
                <em className={`confidence ${entry.answer.confidence.toLowerCase()}`}>
                  CONFIANZA {entry.answer.confidence}
                </em>
              </div>
              <p>{entry.answer.text}</p>

              {entry.answer.concepts.map((concept) => (
                <div className="assistant-concept" key={concept.title}>
                  <b>{concept.title}</b>
                  <span>{concept.summary}</span>
                  {concept.caveat && <small>⚠ {concept.caveat}</small>}
                </div>
              ))}

              {entry.answer.sources.length > 0 && (
                <div className="assistant-sources">
                  FUENTES: {entry.answer.sources.join(" · ")}
                </div>
              )}

              {entry.answer.followUps.length > 0 && (
                <div className="assistant-followups">
                  {entry.answer.followUps.map((followUp) => (
                    <button key={followUp} onClick={() => submit(followUp)}>
                      {followUp}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          ),
        )}
        {aiBusy && <div className="assistant-thinking">IA · analizando el radar…</div>}
      </div>

      <form
        className="assistant-input"
        onSubmit={(event) => {
          event.preventDefault();
          submit(question);
        }}
      >
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Preguntá sobre un activo, el mercado o cualquier concepto…"
          aria-label="Pregunta para el analista"
        />
        <button type="submit" disabled={!question.trim() || aiBusy}>
          {aiBusy ? "…" : "ANALIZAR"}
        </button>
      </form>

      <div className="assistant-suggestions">
        {SUGGESTIONS.map((suggestion) => (
          <button key={suggestion} onClick={() => submit(suggestion)}>
            {suggestion}
          </button>
        ))}
      </div>

      <p className="assistant-footnote">
        Motor determinista: la misma pregunta sobre el mismo snapshot devuelve siempre la misma
        respuesta, y cada cifra sale de los datos que ves en los paneles. Las explicaciones de
        conceptos son texto revisado, no generado. Nada de esto es asesoramiento financiero.
      </p>
    </section>
  );
}
