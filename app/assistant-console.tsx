"use client";

import { useEffect, useRef, useState } from "react";
import { ask, type AssistantAnswer, type AssistantContext } from "@/lib/assistant/index";

type Entry = {
  id: number;
  question: string;
  answer: AssistantAnswer;
  at: string;
};

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

  const submit = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    const answer = ask(text, getContext());
    setHistory((current) => [
      ...current.slice(-11),
      { id: nextId.current++, question: text, answer, at: new Date().toLocaleTimeString() },
    ]);
    setQuestion("");
  };

  return (
    <section className="panel assistant-console" id="asistente">
      <div className="panel-head">
        <div>
          <p className="eyebrow">ANALISTA DE TERMINAL · MOTOR LOCAL</p>
          <h2>Preguntale a la terminal</h2>
        </div>
        <span className="badge">
          SIN LLM · 0 TOKENS · {readiness.available}/{readiness.total} FUENTES
        </span>
      </div>

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

        {history.map((entry) => (
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
        ))}
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
        <button type="submit" disabled={!question.trim()}>
          ANALIZAR
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
