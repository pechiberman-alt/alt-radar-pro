"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AssistantContext } from "@/lib/assistant/index";
import { arNumber } from "@/lib/ai-numbers";
import { arTime, NOT_AVAILABLE, upcomingHighImpact, type AgentReport } from "@/lib/jarvis-desk-agents";
import { DESK_PROVIDERS, type DeskSnapshot } from "@/lib/jarvis-desk-data";
import { compareDesks, macroBrief, type Comparison, type DeskDecision, type DeskSettings, type Plan, type RiskReview } from "@/lib/jarvis-desk";
import { cachedDesk, deskFor, DESK_SHOW_EVENT, loadDeskSettings, saveDeskSettings, typedNumber } from "@/lib/jarvis-desk-run";
import { withRecord } from "@/lib/jarvis-paper";
import { PaperBlock, PaperFollow, usePaper } from "./jarvis-paper";

/**
 * JARVIS TRADING: la mesa de especialistas de JARVIS sobre un activo, pensada
 * primero para el celular. Arriba la decisión (LONG, SHORT, ESPERAR o NO TRADE)
 * con su plan; debajo el porqué, el análisis completo de cada especialista, el
 * debate alcista/bajista, el gestor de riesgo, la comparación con otro activo
 * y la agenda macro. Es análisis: no hay ningún botón que opere en una cuenta.
 */

const QUICK = ["BTC", "ETH", "SOL", "XRP", "BNB", "DOGE"];
const px = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : arNumber(v));
const money = (v: number | null) => (v === null ? "—" : `$${v.toLocaleString("es-AR", { maximumFractionDigits: v >= 100 ? 0 : 2 })}`);
const rr = (v: number) => `1:${v.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
const DIR_ICON: Record<DeskDecision["direccion"], string> = { LONG: "🟢", SHORT: "🔴", ESPERAR: "⏸", "NO TRADE": "⛔" };

function useMounted() {
  return useSyncExternalStore(() => () => undefined, () => true, () => false);
}

export default function JarvisTrading({ getContext }: { getContext?: () => AssistantContext }) {
  const mounted = useMounted();
  if (!mounted) {
    return (
      <section className="panel jt-desk" id="jarvis-trading">
        <p className="jt-muted">Cargando la mesa de JARVIS…</p>
      </section>
    );
  }
  return <Desk getContext={getContext} />;
}

/**
 * A number field that lets the person type freely ("0," on the way to "0,5")
 * and only saves values that make sense; the draft goes back to the saved
 * value when the field loses focus.
 */
function NumberField(props: { label: string; value: number | null; placeholder?: string; hint: string; integer?: boolean; accept: (v: number | null) => boolean; onCommit: (v: number | null) => void }) {
  const show = (v: number | null) => (v === null ? "" : v.toLocaleString("es-AR", { maximumFractionDigits: 2, useGrouping: false }));
  const [draft, setDraft] = useState(() => show(props.value));
  const [bad, setBad] = useState(false);
  return (
    <label>
      {props.label}
      <input
        inputMode={props.integer ? "numeric" : "decimal"}
        value={draft}
        placeholder={props.placeholder}
        aria-invalid={bad}
        onChange={(e) => {
          const text = e.target.value;
          setDraft(text);
          const v = text.trim() === "" ? null : typedNumber(text);
          const ok = (text.trim() === "" || v !== null) && props.accept(v);
          setBad(!ok && text.trim() !== "");
          if (ok) props.onCommit(v);
        }}
        onBlur={() => {
          setDraft(show(props.value));
          setBad(false);
        }}
      />
      {bad && <small className="jt-bad">{props.hint}</small>}
    </label>
  );
}

function bias(v: number, available: boolean) {
  if (!available) return { text: "SIN DATOS", cls: "off" };
  return v > 0.1 ? { text: "ALCISTA", cls: "up" } : v < -0.1 ? { text: "BAJISTA", cls: "down" } : { text: "NEUTRAL", cls: "flat" };
}

function Desk({ getContext }: { getContext?: () => AssistantContext }) {
  const [input, setInput] = useState("BTC");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [decision, setDecision] = useState<DeskDecision | null>(null);
  const [snapshot, setSnapshot] = useState<DeskSnapshot | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<DeskSettings>(loadDeskSettings);
  const [other, setOther] = useState("ETH");
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [comparing, setComparing] = useState(false);
  // A plain toggle: it opens when a simulation starts and never closes by itself when a trade ends.
  const [paperOpen, setPaperOpen] = useState(false);
  const ctxRef = useRef(getContext);
  useEffect(() => {
    ctxRef.current = getContext;
  }, [getContext]);

  const analyze = useCallback(async (raw: string, force = false) => {
    const sym = raw.trim().toUpperCase().replace(/\/?USDT$/, "") + "USDT";
    setSymbol(sym);
    setState("loading");
    setError("");
    setComparison(null);
    try {
      const { decision: d, snapshot: s } = await deskFor(sym, { structure: ctxRef.current?.()?.structure ?? null, force });
      setSnapshot(s);
      setDecision(d);
      if (!d) {
        setState("error");
        setError(`No hay velas suficientes de ${sym.replace(/USDT$/, "")} en Binance Futures para analizarlo. Este dato no está disponible actualmente.`);
      } else setState("idle");
    } catch {
      setState("error");
      setError("Binance no respondió. Probá de nuevo en un rato.");
    }
  }, []);

  const runCompare = useCallback(async (baseRaw: string, raw: string) => {
    const norm = (x: string) => x.trim().toUpperCase().replace(/\/?USDT$/, "") + "USDT";
    setComparing(true);
    try {
      const [mine, theirs] = await Promise.all([deskFor(norm(baseRaw)), deskFor(norm(raw), { structure: ctxRef.current?.()?.structure ?? null })]);
      setComparison(mine.decision && theirs.decision ? compareDesks(mine.decision, theirs.decision) : null);
    } finally {
      setComparing(false);
    }
  }, []);

  // First reading, and JARVIS asking to show a coin ("analizame SOL").
  useEffect(() => {
    let live = true;
    void (async () => {
      await Promise.resolve();
      if (live) await analyze("BTC");
    })();
    const onShow = (e: Event) => {
      const d = (e as CustomEvent<{ symbol?: string; compareWith?: string }>).detail;
      if (!d?.symbol) return;
      const coin = d.symbol.replace(/USDT$/, "");
      setInput(coin);
      void analyze(coin).then(() => {
        if (d.compareWith) {
          setOther(d.compareWith.replace(/USDT$/, ""));
          void runCompare(coin, d.compareWith);
        }
      });
      document.getElementById("jarvis-trading")?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    window.addEventListener(DESK_SHOW_EVENT, onShow);
    return () => {
      live = false;
      window.removeEventListener(DESK_SHOW_EVENT, onShow);
    };
  }, [analyze, runCompare]);

  // New risk settings decide again over the same data, at once (no new request).
  const updateSettings = (patch: Partial<DeskSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveDeskSettings(next);
    const again = cachedDesk(symbol);
    if (again) setDecision(again);
    if (comparison) {
      const a = cachedDesk(comparison.a);
      const b = cachedDesk(comparison.b);
      if (a && b) setComparison(compareDesks(a, b));
    }
  };

  const paper = usePaper();
  // The measured record of similar paper trades, next to the score (the plan does not change).
  const d = decision ? withRecord(decision, paper.trades) : null;
  const coin = symbol.replace(/USDT$/, "");
  const paperBlock = (
    <details className="jt-block" open={paperOpen} onToggle={(e) => setPaperOpen(e.currentTarget.open)}>
      <summary>Paper trading · simulado</summary>
      <PaperBlock state={paper} />
    </details>
  );
  return (
    <section className="panel jt-desk" id="jarvis-trading">
      <header className="jt-head">
        <div>
          <p className="eyebrow">JARVIS · MESA DE ESPECIALISTAS</p>
          <h2>JARVIS TRADING</h2>
        </div>
        <span className="jt-tag">ANÁLISIS · NO EJECUTA</span>
      </header>

      <form
        className="jt-search"
        onSubmit={(e) => {
          e.preventDefault();
          void analyze(input, true);
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} aria-label="Activo" placeholder="BTC, ETH, SOL…" autoCapitalize="characters" />
        <button type="submit" disabled={state === "loading"}>{state === "loading" ? "ANALIZANDO…" : "ANALIZAR"}</button>
      </form>
      <div className="jt-quick" role="group" aria-label="Activos rápidos">
        {QUICK.map((q) => (
          <button
            key={q}
            className={coin === q ? "on" : ""}
            onClick={() => {
              setInput(q);
              void analyze(q);
            }}
          >
            {q}
          </button>
        ))}
      </div>

      {state === "loading" && <p className="jt-muted">Los especialistas leen {coin}: velas de 1 h, 4 h y diarias, derivados, noticias, sentimiento y calendario…</p>}
      {state === "error" && <p className="jt-error">{error}</p>}

      {d && state !== "loading" && (
        <>
          <DecisionCard d={d} />
          <PaperFollow key={`${d.symbol}:${d.vela}:${d.direccion}`} d={d} onOpened={() => setPaperOpen(true)} />
          <details className="jt-block" open>
            <summary>¿Por qué?</summary>
            <p className="jt-lead">{d.resolucion}</p>
            <ul className="jt-list">
              {d.razonamiento.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            <p>
              <b>Invalidación.</b> {d.invalidacion}
            </p>
            <p>
              <b>Escenario alternativo.</b> {d.alternativo}
            </p>
          </details>

          <details className="jt-block">
            <summary>Análisis completo</summary>
            <h3 className="jt-sub">Debate alcista vs bajista</h3>
            <div className="jt-debate">
              <Side title="Analista alcista" cls="up" plan={d.alcista.plan} risk={d.alcista.riesgo} args={d.alcista.argumentos} />
              <Side title="Analista bajista" cls="down" plan={d.bajista.plan} risk={d.bajista.riesgo} args={d.bajista.argumentos} />
            </div>
            <h3 className="jt-sub">Gestor de riesgo</h3>
            <RiskBlock d={d} settings={settings} />
            <h3 className="jt-sub">Especialistas</h3>
            <div className="jt-agents">
              {d.agentes.map((a) => (
                <Agent key={a.id} a={a} />
              ))}
            </div>
            <p className="jt-note">
              Consenso de la mesa: {arNumber(Number(d.consenso.toFixed(2)))} (de −1 bajista a +1 alcista) · datos leídos: {Math.round(d.cobertura * 100)}% del peso total.
            </p>
          </details>

          <details className="jt-block">
            <summary>Comparar {coin} con otro activo</summary>
            <form
              className="jt-search"
              onSubmit={(e) => {
                e.preventDefault();
                void runCompare(symbol, other);
              }}
            >
              <input value={other} onChange={(e) => setOther(e.target.value)} aria-label="Activo para comparar" placeholder="ETH" autoCapitalize="characters" />
              <button type="submit" disabled={comparing}>{comparing ? "COMPARANDO…" : "COMPARAR"}</button>
            </form>
            {comparison && <CompareTable c={comparison} />}
          </details>

          {paperBlock}

          <details className="jt-block">
            <summary>Agenda macro</summary>
            <Macro snapshot={snapshot} />
          </details>

          <details className="jt-block">
            <summary>Mi riesgo</summary>
            <div className="jt-settings">
              <NumberField
                label="Capital (USD)"
                value={settings.capital}
                placeholder="sin cargar"
                hint="Vacío = sin cargar."
                accept={(v) => v === null || v > 0}
                onCommit={(v) => updateSettings({ capital: v })}
              />
              <NumberField
                label="Riesgo por operación (%)"
                value={settings.riesgoPct}
                hint="Entre 0,1 y 5."
                accept={(v) => v !== null && v >= 0.1 && v <= 5}
                onCommit={(v) => updateSettings({ riesgoPct: v! })}
              />
              <NumberField
                label="Apalancamiento máximo"
                value={settings.apalancamientoMax}
                hint="Entero entre 1 y 50."
                integer
                accept={(v) => v !== null && Number.isInteger(v) && v >= 1 && v <= 50}
                onCommit={(v) => updateSettings({ apalancamientoMax: v! })}
              />
            </div>
            <p className="jt-note">Se guarda en este equipo y se aplica al instante sobre los mismos datos. Con el capital cargado, la mesa calcula el tamaño de la posición y el margen.</p>
          </details>

          <details className="jt-block">
            <summary>Fuentes y datos que faltan</summary>
            <ul className="jt-list">
              {d.fuentes.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            {d.faltantes.length > 0 && (
              <>
                <p className="jt-note">{NOT_AVAILABLE} Faltan:</p>
                <ul className="jt-list off">
                  {d.faltantes.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </>
            )}
            <p className="jt-note">Proveedores preparados para conectar: {DESK_PROVIDERS.filter((p) => !p.ready).map((p) => `${p.label} (${p.needs})`).join(" · ")}.</p>
          </details>

          <p className="jt-hint">Decile a JARVIS: «analizame {coin}», «¿dónde entrarías?», «¿qué pasa si pierde {px(d.niveles.soportes[0]?.precio ?? d.precio * 0.97)}?», «comparame {coin} vs ETH», «¿hay riesgo de liquidaciones?».</p>
          <p className="disclaimer">{d.aviso} El puntaje mide cuánto coinciden los especialistas, no la probabilidad de acertar.</p>
        </>
      )}
      {!d && state !== "loading" && paperBlock}
    </section>
  );
}

function DecisionCard({ d }: { d: DeskDecision }) {
  const p = d.plan;
  const r = d.riesgo;
  const trade = d.direccion === "LONG" || d.direccion === "SHORT";
  return (
    <article className={`jt-card ${d.direccion === "LONG" ? "long" : d.direccion === "SHORT" ? "short" : "wait"}`}>
      <div className="jt-card-top">
        <div>
          <b className="jt-pair">{d.moneda}/USDT</b>
          <span className="jt-price">${px(d.precio)}</span>
        </div>
        <div className="jt-dir">
          <strong>
            {DIR_ICON[d.direccion]} {d.direccion}
          </strong>
          <small>Confluencia {d.puntaje}/100</small>
        </div>
      </div>
      <p className="jt-record">
        {d.historial ? `Acierto medido de setups parecidos: ${d.historial.etiqueta}` : "Acierto medido: todavía sin historial de setups parecidos (se mide con paper trading)."}
      </p>
      {p && (
        <dl className="jt-levels">
          <div>
            <dt>Entrada {p.tipoEntrada === "LÍMITE" ? "(límite)" : ""}</dt>
            <dd>${px(p.entrada)}</dd>
          </div>
          <div className="bad">
            <dt>Stop</dt>
            <dd>${px(p.stop)}</dd>
          </div>
          {p.tp.map((t, i) => (
            <div key={i} className="good">
              <dt>TP{i + 1}</dt>
              <dd>
                ${px(t.price)} <em>{t.label}</em>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {r && (
        <div className="jt-facts">
          <span>
            R:R <b>{rr(r.rrPonderado)}</b>
          </span>
          <span>
            Riesgo <b className={r.nivel.toLowerCase()}>{r.nivel}</b>
          </span>
          <span>
            Apalancamiento <b>{r.apalancamiento}x</b>
          </span>
          <span>
            Stop a <b>{arNumber(Number(r.stopPct.toFixed(2)))}%</b>
          </span>
        </div>
      )}
      {!trade && <p className="jt-verdict">{d.resolucion}</p>}
    </article>
  );
}

function Side({ title, cls, plan, risk, args }: { title: string; cls: string; plan: Plan | null; risk: RiskReview | null; args: string[] }) {
  return (
    <div className={`jt-side ${cls}`}>
      <b>{title}</b>
      {args.length ? (
        <ul className="jt-list">
          {args.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      ) : (
        <p className="jt-note">Ningún especialista empuja hacia este lado.</p>
      )}
      {plan && risk ? (
        <p className="jt-note">
          Plan: entrada {px(plan.entrada)}, stop {px(plan.stop)}, TP {plan.tp.map((t) => px(t.price)).join(" / ")} · R:R {rr(risk.rrPonderado)}
          {risk.vetos.length ? ` · VETADO: ${risk.vetos.join(" ")}` : risk.esperas.length ? ` · ESPERAR: ${risk.esperas.join(" ")}` : " · aprobado por riesgo"}
        </p>
      ) : (
        <p className="jt-note">Sin plan válido para este lado.</p>
      )}
    </div>
  );
}

function RiskBlock({ d, settings }: { d: DeskDecision; settings: DeskSettings }) {
  const r = d.riesgo;
  if (!r || !d.plan) return <p className="jt-note">Sin plan elegido: {d.resolucion}</p>;
  return (
    <div className="jt-risk">
      <ul className="jt-list">
        <li>
          Stop a {arNumber(Number(r.stopPct.toFixed(2)))}% ({arNumber(Number(r.stopAtr.toFixed(1)))} ATR de 4 h): {d.plan.stopRazon}.
        </li>
        <li>
          R:R por objetivo: {r.rr.map(rr).join(" · ")} · ponderado saliendo un tercio en cada TP: {rr(r.rrPonderado)}.
        </li>
        <li>
          Apalancamiento sugerido {r.apalancamiento}x (máximo seguro {r.apalancamientoMaxSeguro}x: la liquidación queda al menos 3 veces más lejos que el stop). Liquidación aproximada: ${px(r.liquidacionAprox)}.
        </li>
        {settings.capital ? (
          <li>
            Con {money(settings.capital)} y {arNumber(settings.riesgoPct)}% de riesgo: arriesgás {money(r.riesgoUsd)}, posición de {money(r.posicionUsd)} ({px(r.cantidad)} {d.moneda}), margen {money(r.margenUsd)}.
          </li>
        ) : (
          <li>Cargá tu capital en «Mi riesgo» para ver el tamaño de la posición.</li>
        )}
        {r.vetos.map((v) => (
          <li key={v} className="bad">
            Veto: {v}
          </li>
        ))}
        {r.esperas.map((v) => (
          <li key={v} className="warn">
            Esperar: {v}
          </li>
        ))}
        {r.avisos.map((v) => (
          <li key={v} className="warn">
            {v}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Agent({ a }: { a: AgentReport }) {
  const b = bias(a.sesgo, a.disponible);
  return (
    <details className="jt-agent">
      <summary>
        <span>{a.nombre}</span>
        <i className={b.cls}>{b.text}</i>
      </summary>
      {a.disponible ? (
        <ul className="jt-list">
          {a.hallazgos.map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ul>
      ) : (
        <p className="jt-note">{NOT_AVAILABLE}</p>
      )}
      {a.faltantes.length > 0 && <p className="jt-note">Falta: {a.faltantes.join(", ")}.</p>}
    </details>
  );
}

function CompareTable({ c }: { c: Comparison }) {
  return (
    <div className="jt-compare">
      <table>
        <thead>
          <tr>
            <th>Criterio</th>
            <th>{c.a}</th>
            <th>{c.b}</th>
          </tr>
        </thead>
        <tbody>
          {c.filas.map((r) => (
            <tr key={r.criterio}>
              <td>{r.criterio}</td>
              <td className={r.gana === "A" ? "win" : ""}>{r.a}</td>
              <td className={r.gana === "B" ? "win" : ""}>{r.b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="jt-lead">{c.resumen}</p>
    </div>
  );
}

function Macro({ snapshot }: { snapshot: DeskSnapshot | null }) {
  if (!snapshot) return null;
  const events = snapshot.macro.events;
  if (events === null) return <p className="jt-note">El calendario económico no respondió. {NOT_AVAILABLE}</p>;
  const soon = upcomingHighImpact(events, snapshot.now, 24 * 7).slice(0, 6);
  const brief = macroBrief(events, snapshot.now, null);
  return (
    <div className="jt-macro">
      {soon.length ? (
        <ul className="jt-list">
          {soon.map((e) => (
            <li key={e.id}>
              <b>{e.title}</b> · {arTime(e.time)} (hora argentina) · pronóstico {e.forecast ?? "sin dato"} · previo {e.previous ?? "sin dato"}
            </li>
          ))}
        </ul>
      ) : (
        <p className="jt-note">Sin eventos de alto impacto de EE.UU. en lo que queda de la semana (Forex Factory).</p>
      )}
      {brief.evento && (
        <div className="jt-brief">
          <p>
            <b>EVENTO:</b> {brief.evento} · <b>HORA:</b> {brief.hora} · <b>IMPACTO:</b> {brief.impacto}
          </p>
          <p>
            <b>ESCENARIO CALIENTE:</b> {brief.hot}
          </p>
          <p>
            <b>ESCENARIO FRÍO:</b> {brief.cool}
          </p>
          <p>
            <b>BTC:</b> {brief.btc} <b>ETH:</b> {brief.eth}
          </p>
        </div>
      )}
      <p className="jt-note">{brief.nota}</p>
    </div>
  );
}
