"use client";

/**
 * La sala de las MENTES (lib/mentes-inversoras.ts): los nueve agentes inspirados en Buffett, Graham, Lynch, Musk, Tudor
 * Jones, Darvas, O'Neil, Templeton y Dalio en sus escritorios. Se juntan en la mesa cuando hay reunión sobre un papel de
 * BYMA (cada frase sale de un criterio medido: lib/mercado-ar-ranking.ts) y, entre reuniones, el que está a favor va al
 * escritorio del que está en contra a discutir. Tocando una mente se ve su lectura y se le puede preguntar (la misma IA que
 * JARVIS, con sus datos; sin IA, contesta con lo que ya dijo). Ninguno de esos inversores participa ni avala esto. El
 * movimiento es decorativo y se apaga con «reducir movimiento». No es asesoramiento financiero.
 */
import { useEffect, useMemo, useState } from "react";
import { forAi } from "@/lib/ai-numbers";
import { panelCompleto, type LecturaPapel } from "@/lib/mercado-ar-cliente";
import { guionReunion, intervencion, type Intervencion } from "@/lib/mercado-ar-ranking";
import { AVISO_MENTES, type LecturaMente, type MenteId } from "@/lib/mentes-inversoras";
import { openArEnMapa } from "@/lib/account-events";
import { intencionDe, respondeLoPreguntado, respuestaDirecta } from "@/lib/ia-respuesta";

/** Iniciales y lugar de cada escritorio en la sala (en % del ancho y del alto). */
const LUGAR: Record<MenteId, { ini: string; corto: string; x: number; y: number }> = {
  BUFFETT: { ini: "WB", corto: "Buffett", x: 10, y: 14 },
  GRAHAM: { ini: "BG", corto: "Graham", x: 32, y: 8 },
  LYNCH: { ini: "PL", corto: "Lynch", x: 54, y: 8 },
  MUSK: { ini: "EM", corto: "Musk", x: 76, y: 14 },
  PTJ: { ini: "PTJ", corto: "Tudor Jones", x: 87, y: 44 },
  DARVAS: { ini: "ND", corto: "Darvas", x: 78, y: 80 },
  ONEIL: { ini: "WO", corto: "O'Neil", x: 50, y: 88 },
  TEMPLETON: { ini: "JT", corto: "Templeton", x: 22, y: 80 },
  DALIO: { ini: "RD", corto: "Dalio", x: 8, y: 46 },
};
const ORDEN: MenteId[] = ["BUFFETT", "GRAHAM", "LYNCH", "MUSK", "PTJ", "DARVAS", "ONEIL", "TEMPLETON", "DALIO"];
/** Sillas alrededor de la mesa redonda del centro. */
const silla = (k: number) => {
  const a = (k / ORDEN.length) * Math.PI * 2 - Math.PI / 2;
  return { x: 50 + Math.cos(a) * 29, y: 48 + Math.sin(a) * 31 };
};
const CLASE: Record<string, string> = { "A FAVOR": "sm-favor", "EN CONTRA": "sm-contra", NEUTRAL: "sm-neutral", "SIN DATOS": "sm-sin", INFORMA: "sm-info", MODERA: "sm-info" };
const PASO_MS = 3800;

type Linea = { de: "vos" | "mente"; texto: string; cerebro?: string };

export default function SalaMentes() {
  const [panel, setPanel] = useState<LecturaPapel[] | null>(null);
  const [avance, setAvance] = useState<string | null>(null);
  const [tema, setTema] = useState<string | null>(null);
  const [reunion, setReunion] = useState(false);
  const [turno, setTurno] = useState(0);
  const [elegida, setElegida] = useState<MenteId | null>(null);
  const [chat, setChat] = useState<Record<string, Linea[]>>({});
  const [pregunta, setPregunta] = useState("");
  const [pensando, setPensando] = useState(false);
  const [quieto, setQuieto] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setQuieto(Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)), 0);
    return () => window.clearTimeout(id);
  }, []);

  // El paso de la charla: en reunión avanza el guion; fuera de reunión cambia la visita entre escritorios.
  useEffect(() => {
    if (!panel || quieto) return;
    const id = window.setInterval(() => setTurno((t) => t + 1), PASO_MS);
    return () => window.clearInterval(id);
  }, [panel, quieto]);

  const leer = async () => {
    setAvance("Empezando…");
    const p = await panelCompleto((texto, h, t) => setAvance(`${texto}… ${h}/${t}`));
    setPanel(p);
    setAvance(null);
    const conDatos = p.filter((l) => l.serie.serie);
    const mejor = [...conDatos].sort((a, b) => b.consenso.aFavor - b.consenso.enContra - (a.consenso.aFavor - a.consenso.enContra))[0];
    setTema(mejor?.papel.ticker ?? null);
  };

  const actual = useMemo(() => panel?.find((l) => l.papel.ticker === tema) ?? null, [panel, tema]);
  const leido = useMemo(() => (actual ? { ...actual, cierre: actual.serie.serie?.velas.at(-1)?.close ?? null } : null), [actual]);
  const guion = useMemo(() => (leido ? guionReunion(leido) : []), [leido]);
  const habla: Intervencion | null = reunion && guion.length ? guion[turno % guion.length] : null;
  const mentePorId = (id: MenteId): LecturaMente | null => actual?.mentes.find((m) => m.id === id) ?? null;

  // Entre reuniones: una mente a favor visita a una en contra (si hay) para discutir el papel del tema.
  const visita = useMemo(() => {
    if (reunion || !actual || quieto) return null;
    const favor = actual.mentes.filter((m) => m.postura === "A FAVOR");
    const contra = actual.mentes.filter((m) => m.postura === "EN CONTRA");
    if (!favor.length || !contra.length) return null;
    const de = favor[turno % favor.length];
    const a = contra[Math.floor(turno / favor.length) % contra.length];
    return { de: de.id, a: a.id, textoDe: intervencion(de).texto, textoA: intervencion(a).texto };
  }, [reunion, actual, turno, quieto]);

  const posicion = (id: MenteId, k: number) => {
    if (reunion) return silla(k);
    if (visita?.de === id) {
      const destino = LUGAR[visita.a];
      return { x: destino.x + (destino.x > 50 ? -7 : 7), y: destino.y + (destino.y > 50 ? -6 : 6) };
    }
    return LUGAR[id];
  };

  async function preguntar(m: LecturaMente) {
    const texto = pregunta.trim();
    if (!texto || !panel) return;
    const anotar = (l: Linea) => setChat((c) => ({ ...c, [m.id]: [...(c[m.id] ?? []), l] }));
    anotar({ de: "vos", texto });
    setPregunta("");
    setPensando(true);
    // Lo que esta mente opina de cada papel: va con la pregunta (y es lo que contesta sin IA).
    const nombrado = panel.find((l) => new RegExp(`\\b${l.papel.ticker}\\b`, "i").test(texto));
    const suya = (l: LecturaPapel) => l.mentes.find((x) => x.id === m.id);
    const local = (por: string) => {
      const l = nombrado ?? actual;
      const x = l ? suya(l) : null;
      anotar({ de: "mente", texto: x && l ? `${l.papel.ticker}: ${intervencion(x).texto}` : "Todavía no leí ese papel.", cerebro: `motor local (${por})` });
    };
    // Las preguntas de siempre se contestan con el dato exacto, sin IA.
    const aFavorEn = panel.filter((l) => suya(l)?.postura === "A FAVOR").map((l) => l.papel.ticker);
    const enContraEn = panel.filter((l) => suya(l)?.postura === "EN CONTRA").map((l) => l.papel.ticker);
    const intencion = /\b(compr|a favor|te gusta|recomend|eleg|mejor)/i.test(texto) && !nombrado ? "FAVORITOS" : intencionDe(texto, Boolean(nombrado));
    const x = nombrado ? suya(nombrado) : null;
    const directa =
      intencion === "FAVORITOS"
        ? `Hoy estoy a favor en ${aFavorEn.join(", ") || "ningún papel"}${enContraEn.length ? ` y en contra en ${enContraEn.join(", ")}` : ""}. Cuento criterios, no es una probabilidad ni asesoramiento financiero.`
        : respuestaDirecta(intencion, {
            nombre: m.mente,
            abiertas: [],
            resultado: `No opero: leo papeles con mis criterios. Hoy estoy a favor en ${aFavorEn.length} y en contra en ${enContraEn.length} de ${panel.length}.`,
            regla: `${m.idea}. Miro: ${m.criterios.map((c) => `${c.nombre.toLowerCase()} (${c.regla})`).join("; ")}.`,
            aprendizajes: [],
          }, nombrado && x ? `${nombrado.papel.ticker}: ${intervencion(x).texto}` : null);
    if (directa && intencion !== "ABIERTAS") {
      anotar({ de: "mente", texto: directa, cerebro: "dato exacto" });
      setPensando(false);
      return;
    }
    if (intencion === "ABIERTAS") {
      anotar({ de: "mente", texto: `No opero ni tengo posiciones: leo papeles. Hoy estoy a favor en ${aFavorEn.join(", ") || "ninguno"}.`, cerebro: "dato exacto" });
      setPensando(false);
      return;
    }
    try {
      const r = await fetch("/api/analyst/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: texto,
          persona: { nombre: m.mente, rol: "una de las mentes de la sala que leen acciones y CEDEARs de BYMA con criterios fijos", idea: `${m.idea}; tus criterios con sus valores en cada papel están en el SNAPSHOT` },
          snapshot: forAi({
            asistente: m.mente,
            aviso: AVISO_MENTES,
            papelPreguntado: nombrado ? { papel: nombrado.papel.ticker, nombre: nombrado.papel.nombre, lectura: suya(nombrado) } : null,
            papelDeLaReunion: actual ? { papel: actual.papel.ticker, lectura: suya(actual) } : null,
            aFavorEn,
            enContraEn,
          }),
          history: (chat[m.id] ?? []).slice(-6).map((l) => ({ role: l.de === "vos" ? "user" : "assistant", content: l.texto })),
        }),
      });
      if (r.status === 401) return local("iniciá sesión para la IA");
      if (r.status === 429) return local("se terminó la IA gratis de hoy");
      const d = (await r.json().catch(() => ({}))) as { text?: string; label?: string };
      if (!r.ok || !d.text) return local("la IA no respondió");
      if (!respondeLoPreguntado(d.text, intencion === "FAVORITOS" ? "OTRA" : intencion, nombrado ? [nombrado.papel.ticker] : [])) return local("la IA se fue de tema");
      anotar({ de: "mente", texto: d.text, cerebro: d.label });
    } catch {
      local("sin conexión");
    } finally {
      setPensando(false);
    }
  }

  if (!panel) {
    return (
      <div className="ar-box sm-intro">
        <h3>SALA DE LAS MENTES · BYMA</h3>
        <p>
          Nueve agentes con la mirada de grandes inversores leen las acciones y los CEDEARs, se reúnen a discutir un papel y se puede hablar con cada uno.
          Primero leen todo el panel.
        </p>
        {avance ? <p className="ar-mute">{avance}</p> : <button className="ar-chip-btn on" onClick={() => void leer()}>ABRIR LA SALA</button>}
        <p className="ar-mute">{AVISO_MENTES}</p>
      </div>
    );
  }

  const elegidaM = elegida ? mentePorId(elegida) : null;
  const opciones = panel.filter((l) => l.serie.serie).sort((a, b) => b.consenso.aFavor - a.consenso.aFavor || a.papel.ticker.localeCompare(b.papel.ticker));
  return (
    <div className="ar-wrap" style={{ padding: 0 }}>
      <div className="ar-head">
        <label className="sm-tema">
          <span className="ar-mute">TEMA</span>
          <select value={tema ?? ""} onChange={(e) => setTema(e.target.value)}>
            {opciones.map((l) => (
              <option key={l.papel.ticker} value={l.papel.ticker}>
                {l.papel.ticker} · {l.consenso.aFavor} a favor · {l.consenso.enContra} en contra
              </option>
            ))}
          </select>
        </label>
        <div className="ar-tabs">
          <button className={reunion ? "on" : ""} onClick={() => { setReunion(!reunion); setTurno(0); }}>
            {reunion ? "TERMINAR REUNIÓN" : "LLAMAR A REUNIÓN"}
          </button>
          {tema && <button onClick={() => openArEnMapa(tema)}>VER {tema} EN EL MAPA</button>}
        </div>
      </div>

      <div className={`sm-sala${reunion ? " sm-en-reunion" : ""}${quieto ? " sm-quieta" : ""}`} role="group" aria-label="Sala de las mentes">
        <div className="sm-mesa" aria-hidden="true">
          <b>{tema ?? "—"}</b>
          <small>{actual ? `${actual.consenso.aFavor}▲ ${actual.consenso.enContra}▼` : ""}</small>
        </div>
        {ORDEN.map((id) => (
          <span key={`e${id}`} className="sm-escritorio" style={{ left: `${LUGAR[id].x}%`, top: `${LUGAR[id].y}%` }} aria-hidden="true" />
        ))}
        {ORDEN.map((id, k) => {
          const m = mentePorId(id);
          const pos = posicion(id, k);
          const dice = habla?.quien === id ? habla.texto : visita?.de === id ? visita.textoDe : visita?.a === id ? visita.textoA : null;
          return (
            <button
              key={id}
              type="button"
              className={`sm-mente ${CLASE[m?.postura ?? "SIN DATOS"]}${elegida === id ? " sm-elegida" : ""}${dice ? " sm-habla" : ""}`}
              style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
              onClick={() => setElegida(elegida === id ? null : id)}
              aria-pressed={elegida === id}
              aria-label={`${m?.mente ?? id}: ${m?.postura ?? "sin datos"}`}
            >
              <span className="sm-avatar">{LUGAR[id].ini}</span>
              <span className="sm-nombre">{LUGAR[id].corto}</span>
              {dice && <span className={`sm-globo${pos.y < 35 ? " sm-globo-abajo" : ""}`}>{dice}</span>}
            </button>
          );
        })}
        {habla?.quien === "JARVIS" && <span className="sm-globo sm-globo-jarvis">{habla.texto}</span>}
      </div>

      {reunion && (
        <div className="ar-box">
          <h3>ACTA DE LA REUNIÓN · {tema}</h3>
          {guion.map((g, k) => (
            <p key={k} className={k === turno % guion.length ? "sm-turno" : ""}>
              <b className={CLASE[g.postura]}>{g.nombre.split(" (")[0]}</b> · {g.texto}
            </p>
          ))}
        </div>
      )}

      {elegidaM && (
        <div className="ar-box">
          <div className="ar-head">
            <h3>{elegidaM.mente.toUpperCase()} · {tema}</h3>
            <span className={`ar-chip ${elegidaM.postura === "A FAVOR" ? "ok" : elegidaM.postura === "EN CONTRA" ? "mal" : "alerta"}`}>{elegidaM.postura}</span>
          </div>
          <p>{elegidaM.idea}</p>
          {elegidaM.criterios.map((c) => (
            <div className="ar-crit" key={c.nombre} title={c.regla}>
              <i className={c.cumple === null ? "ar-mute" : c.cumple ? "ar-up" : "ar-down"}>{c.cumple === null ? "?" : c.cumple ? "✓" : "✗"}</i>
              <span>{c.nombre}</span>
              <span className="ar-mute">{c.valor}</span>
            </div>
          ))}
          <p className="ar-mute">{elegidaM.nota}</p>
          <p className="ar-mute">
            A favor en: {panel.filter((l) => l.mentes.find((x) => x.id === elegidaM.id)?.postura === "A FAVOR").map((l) => l.papel.ticker).join(", ") || "ninguno"}
          </p>
          <div className="sm-conversa" aria-live="polite">
            {(chat[elegidaM.id] ?? []).map((l, k) => (
              <p key={k} className={`sm-msg sm-msg-${l.de}`}>
                {l.texto}
                {l.cerebro ? <small> · {l.cerebro}</small> : null}
              </p>
            ))}
            {pensando && <p className="sm-msg ar-mute">Pensando…</p>}
          </div>
          <form
            className="sm-preguntar"
            onSubmit={(ev) => {
              ev.preventDefault();
              void preguntar(elegidaM);
            }}
          >
            <input value={pregunta} onChange={(ev) => setPregunta(ev.target.value)} placeholder="Preguntale por un papel (ej.: ¿qué ves en KO?)" maxLength={300} aria-label={`Pregunta para ${elegidaM.mente}`} />
            <button type="submit" className="ar-chip-btn on" disabled={pensando || !pregunta.trim()}>
              PREGUNTAR
            </button>
          </form>
        </div>
      )}
      <p className="ar-mute" style={{ fontSize: 10 }}>{AVISO_MENTES}</p>
    </div>
  );
}
