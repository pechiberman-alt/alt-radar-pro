"use client";

import { useCallback, useEffect, useState } from "react";

type Status = {
  isAdmin: boolean;
  adminExists: boolean;
  canClaim: boolean;
  telegram: { configured: boolean; source: "cloudflare" | "app" | null };
  ai: { configured: boolean; source: "cloudflare" | "app" | null };
  encryption: "fuerte" | "local";
};

const sourceLabel = (s: Status["telegram"]) =>
  !s.configured ? "SIN CONFIGURAR" : s.source === "cloudflare" ? "ACTIVO · CLOUDFLARE" : "ACTIVO · GUARDADO EN LA APP";

/**
 * Owner-only settings: paste the Telegram bot token and the Anthropic key from
 * the phone. Values are validated against each service, stored encrypted, and
 * never shown again — the screen only ever reports whether one is set.
 */
export default function SettingsDesk() {
  const [status, setStatus] = useState<Status | null>(null);
  const [state, setState] = useState<"loading" | "signed-out" | "ready" | "error">("loading");
  const [code, setCode] = useState("");
  const [telegramToken, setTelegramToken] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/settings", { cache: "no-store" });
      if (r.status === 401) return setState("signed-out");
      if (!r.ok) throw new Error();
      setStatus((await r.json()) as Status);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  const claim = async () => {
    setBusy(true);
    setNote("");
    const r = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    }).catch(() => null);
    const d = (await r?.json().catch(() => ({}))) as { error?: string } | undefined;
    setNote(r?.ok ? "Listo: esta cuenta es la administradora." : d?.error ?? "No se pudo reclamar.");
    setCode("");
    setBusy(false);
    await load();
  };

  const save = async () => {
    if (!telegramToken.trim() && !anthropicKey.trim()) return;
    setBusy(true);
    setResults({});
    const r = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegramToken, anthropicKey }),
    }).catch(() => null);
    const d = (await r?.json().catch(() => ({}))) as { results?: Record<string, string>; error?: string } | undefined;
    setResults(d?.results ?? { error: d?.error ?? "No se pudo guardar." });
    // Cleared either way: the field must not keep a secret on screen.
    setTelegramToken("");
    setAnthropicKey("");
    setBusy(false);
    await load();
  };

  const remove = async (which: "telegram" | "ai") => {
    await fetch(`/api/admin/settings?which=${which}`, { method: "DELETE" }).catch(() => undefined);
    await load();
  };

  return (
    <section className="panel settings-desk" id="configuracion">
      <div className="panel-head">
        <div>
          <p className="eyebrow">CONFIGURACIÓN · SÓLO ADMINISTRADOR</p>
          <h2>Bot de Telegram e IA</h2>
        </div>
        <span className={status?.isAdmin ? "badge" : "badge critical"}>
          {state === "ready" ? (status?.isAdmin ? "ADMIN" : "SIN PERMISO") : state === "loading" ? "…" : "—"}
        </span>
      </div>

      {state === "signed-out" && <p className="set-note">Ingresá con tu cuenta (INGRESAR arriba).</p>}
      {state === "error" && <p className="set-note">No se pudo leer la configuración.</p>}

      {state === "ready" && status && !status.isAdmin && (
        <div className="set-block">
          {status.canClaim ? (
            <>
              <p className="set-why">Ingresá el código de administrador de un solo uso para convertir esta cuenta en la administradora.</p>
              <div className="set-row">
                <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Código de administrador" aria-label="Código de administrador" autoComplete="off" />
                <button onClick={claim} disabled={busy || !code.trim()}>RECLAMAR</button>
              </div>
            </>
          ) : (
            <p className="set-why">
              {status.adminExists ? "Esta configuración la maneja la cuenta administradora." : "Todavía no hay administrador ni código de reclamo."}
            </p>
          )}
        </div>
      )}

      {state === "ready" && status?.isAdmin && (
        <>
          <div className="set-status">
            <div className={status.telegram.configured ? "on" : ""}>
              <span>TELEGRAM</span>
              <b>{sourceLabel(status.telegram)}</b>
              {status.telegram.source === "app" && <button onClick={() => remove("telegram")}>BORRAR</button>}
            </div>
            <div className={status.ai.configured ? "on" : ""}>
              <span>IA · ANTHROPIC</span>
              <b>{sourceLabel(status.ai)}</b>
              {status.ai.source === "app" && <button onClick={() => remove("ai")}>BORRAR</button>}
            </div>
          </div>

          <label className="set-field">
            <span>Token del bot (de @BotFather)</span>
            <input type="password" value={telegramToken} onChange={(e) => setTelegramToken(e.target.value)} placeholder="123456789:AAH…" autoComplete="off" />
          </label>
          <label className="set-field">
            <span>Clave de Anthropic (console.anthropic.com)</span>
            <input type="password" value={anthropicKey} onChange={(e) => setAnthropicKey(e.target.value)} placeholder="sk-ant-…" autoComplete="off" />
          </label>
          <button className="set-save" onClick={save} disabled={busy || (!telegramToken.trim() && !anthropicKey.trim())}>
            {busy ? "VERIFICANDO…" : "VERIFICAR Y GUARDAR"}
          </button>

          {Object.entries(results).map(([k, v]) => (
            <p key={k} className={`set-result ${v.startsWith("OK") ? "ok" : "bad"}`}>
              {k === "telegram" ? "Telegram" : k === "ai" ? "IA" : "Error"}: {v}
            </p>
          ))}

          <p className="set-caveat">
            Cada valor se verifica con su servicio antes de guardarse, se guarda cifrado y no se vuelve a mostrar.
            Cifrado actual: <b>{status.encryption === "fuerte" ? "fuerte (ENCRYPTION_KEY de Cloudflare)" : "local"}</b>.
            {status.encryption === "local" &&
              " Con cifrado local, alguien con acceso completo a la base de datos podría recuperarlos; para cifrado fuerte cargá ENCRYPTION_KEY en Cloudflare."}{" "}
            Si un secreto también está cargado en Cloudflare, ese tiene prioridad.
          </p>
        </>
      )}
      {note && <p className="set-note">{note}</p>}
    </section>
  );
}
