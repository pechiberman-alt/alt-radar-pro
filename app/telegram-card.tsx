"use client";

import { useCallback, useEffect, useState } from "react";
import { onSession } from "@/lib/account-events";
import SignInPrompt from "./sign-in-prompt";
import type { TelegramCategory, TelegramPrefs } from "@/lib/telegram";

type State =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "not-configured" }
  | { kind: "ready"; linked: boolean; prefs: TelegramPrefs; bot: string | null };

const CATS: [TelegramCategory, string, string][] = [
  ["SEÑAL", "SEÑALES", "Señales nuevas del radar"],
  ["DCA", "DCA", "Tu día programado de compra, a las 9 de tu hora"],
  ["NOTICIAS", "NOTICIAS", "Sólo las de alto impacto"],
  ["SENTIMIENTO", "MIEDO Y AVARICIA", "Sólo cuando entra en extremo"],
];

/** Links the signed-in account to a Telegram chat and sets what gets sent. */
export default function TelegramCard() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/telegram/link", { cache: "no-store" });
      if (r.status === 401) return setState({ kind: "signed-out" });
      if (r.status === 503) return setState({ kind: "not-configured" });
      if (!r.ok) throw new Error();
      const d = (await r.json()) as { linked: boolean; prefs: TelegramPrefs; bot: string | null };
      setState({ kind: "ready", ...d });
    } catch {
      setNote("No se pudo leer el estado de Telegram.");
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
    // Coming back from Telegram after tapping Start: refresh the link state.
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    const offSession = onSession(() => void load());
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      offSession();
    };
  }, [load]);

  const link = async () => {
    setBusy(true);
    setNote("");
    try {
      const r = await fetch("/api/telegram/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tzOffsetMin: new Date().getTimezoneOffset() }),
      });
      const d = (await r.json()) as { url?: string; error?: string };
      if (!r.ok || !d.url) throw new Error(d.error ?? "NO SE PUDO GENERAR EL LINK");
      setNote("Se abre Telegram: tocá INICIAR y volvé acá.");
      window.location.href = d.url;
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  const save = async (prefs: TelegramPrefs) => {
    if (state.kind !== "ready") return;
    setState({ ...state, prefs });
    await fetch("/api/telegram/link", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prefs),
    }).catch(() => setNote("No se guardó el cambio."));
  };

  const test = async () => {
    setNote("");
    const r = await fetch("/api/telegram/test", { method: "POST" }).catch(() => null);
    setNote(r?.ok ? "Mensaje de prueba enviado. Revisá Telegram." : "No se pudo enviar la prueba.");
  };

  const unlink = async () => {
    await fetch("/api/telegram/link", { method: "DELETE" }).catch(() => undefined);
    await load();
  };

  return (
    <div className="tg-card">
      <div className="tg-head">
        <b>TELEGRAM · ALERTAS 24/7</b>
        <span className={state.kind === "ready" && state.linked ? "on" : ""}>
          {state.kind === "ready" ? (state.linked ? "VINCULADO" : "SIN VINCULAR") : state.kind === "loading" ? "…" : "—"}
        </span>
      </div>
      <p className="tg-why">
        Te llegan aunque la app esté cerrada: el servidor revisa cada 5 minutos y te manda sólo lo que elijas.
      </p>

      {state.kind === "signed-out" && (
        <SignInPrompt why="El bot necesita saber a quién mandarle las alertas: se vincula a tu cuenta." />
      )}
      {state.kind === "not-configured" && (
        <p className="tg-note">El bot todavía no está configurado: cargá el token de @BotFather en CONFIGURACIÓN.</p>
      )}

      {state.kind === "ready" && !state.linked && (
        <button className="tg-link" onClick={link} disabled={busy}>
          {busy ? "GENERANDO…" : `VINCULAR TELEGRAM${state.bot ? ` · @${state.bot}` : ""}`}
        </button>
      )}

      {state.kind === "ready" && state.linked && (
        <>
          <div className="tg-cats">
            {CATS.map(([key, label, hint]) => (
              <label key={key} className={state.prefs.categories[key] ? "on" : ""}>
                <input
                  type="checkbox"
                  aria-label={`${label}: ${hint}`}
                  checked={state.prefs.categories[key]}
                  onChange={() =>
                    void save({ ...state.prefs, categories: { ...state.prefs.categories, [key]: !state.prefs.categories[key] } })
                  }
                />
                <div>
                  <b>{label}</b>
                  <em>{hint}</em>
                </div>
              </label>
            ))}
          </div>
          <div className="tg-row">
            <span>Señales desde</span>
            <select
              value={state.prefs.signalMinScore}
              onChange={(e) => void save({ ...state.prefs, signalMinScore: Number(e.target.value) })}
              aria-label="Convicción mínima de señales"
            >
              <option value={60}>60% · todas</option>
              <option value={75}>75% · fuertes</option>
              <option value={85}>85% · sólo las mejores</option>
            </select>
          </div>
          <div className="tg-actions">
            <button onClick={test}>ENVIAR PRUEBA</button>
            <button onClick={unlink} className="ghost">DESVINCULAR</button>
          </div>
        </>
      )}
      {note && <p className="tg-note">{note}</p>}
    </div>
  );
}
