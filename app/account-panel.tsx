"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

type SessionUser = { id: number; email: string };

type Balance = { asset: string; free: string; locked: string };
type Deposit = { amount: string; coin: string; status: number; insertTime: number };
type Withdrawal = { amount: string; coin: string; status: number; applyTime: string };

type Portfolio = {
  balances: Balance[];
  updateTime: number;
  deposits: Deposit[];
  withdrawals: Withdrawal[];
  /** A false flag means the fetch failed — the arrays above are display
   *  fallbacks, not a claim that the history is empty. */
  historyAvailable: { deposits: boolean; withdrawals: boolean };
};

/** `null` = no linked account, `undefined` = not loaded yet. */
type PortfolioState = Portfolio | null | undefined;

/** A failed session lookup is not the same as a confirmed signed-out user:
 *  showing the login form on a network blip would be a lie about the state. */
type SessionState = "loading" | "ready" | "error";

const amount = (value: string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return parsed >= 1
    ? parsed.toLocaleString("es-AR", { maximumFractionDigits: 4 })
    : parsed.toPrecision(4);
};

const readError = async (response: Response, fallback: string) => {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error || fallback;
};

export default function AccountPanel() {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<SessionState>("loading");
  const [expired, setExpired] = useState(false);
  const [sessionKey, setSessionKey] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me")
      .then(async (response) => {
        if (!alive) return;
        if (!response.ok) {
          setStatus("error");
          return;
        }
        const body = (await response.json()) as { user: SessionUser | null };
        setUser(body.user ?? null);
        setStatus("ready");
      })
      .catch(() => alive && setStatus("error"));
    return () => {
      alive = false;
    };
  }, [sessionKey]);

  const retrySession = useCallback(() => {
    setStatus("loading");
    setSessionKey((key) => key + 1);
  }, []);

  const signedIn = useCallback((next: SessionUser) => {
    setExpired(false);
    setUser(next);
    setStatus("ready");
  }, []);

  const signedOut = useCallback(() => {
    setUser(null);
    setStatus("ready");
  }, []);

  /** Session died server-side while the drawer was open. */
  const sessionExpired = useCallback(() => {
    setUser(null);
    setStatus("ready");
    setExpired(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const label = status === "ready" && user ? user.email.split("@")[0].slice(0, 12) : null;

  return (
    <>
      <button
        className="account-trigger"
        onClick={() => setOpen(true)}
        aria-label={user ? `Cuenta de ${user.email}` : "Ingresar a tu cuenta"}
      >
        {/* Not a <span>: the mobile header hides spans inside .system. */}
        <b className="account-trigger-wide">{label ? label.toUpperCase() : "INGRESAR"}</b>
        <i className="account-trigger-slim" aria-hidden="true">
          {label ? "◉" : "→"}
        </i>
      </button>

      {/* Portalled to <body>: the drawer is fixed-position, and leaving it
          inside .system lets the header's own button/span rules reshape and
          hide the controls and balances inside it. */}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="overlay">
            <aside className="drawer account-drawer" aria-label="Panel de cuenta">
              <button className="close" onClick={() => setOpen(false)} aria-label="Cerrar">
                ×
              </button>
              {status === "loading" ? (
                <p className="account-loading">CARGANDO SESIÓN…</p>
              ) : status === "error" ? (
                <div className="account-body">
                  <p className="account-error">No se pudo verificar tu sesión.</p>
                  <button className="account-submit" onClick={retrySession}>
                    REINTENTAR
                  </button>
                </div>
              ) : user ? (
                <AccountHome
                  user={user}
                  onSignedOut={signedOut}
                  onSessionExpired={sessionExpired}
                />
              ) : (
                <AuthForms onSignedIn={signedIn} expired={expired} />
              )}
            </aside>
          </div>,
          document.body,
        )}
    </>
  );
}

function AuthForms({
  onSignedIn,
  expired,
}: {
  onSignedIn: (user: SessionUser) => void;
  expired: boolean;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        const message = await readError(response, "No se pudo continuar.");
        setError(message === "EMAIL_INVALIDO" ? "Ese email no es válido." : message);
        return;
      }
      const me = await fetch("/api/auth/me");
      if (!me.ok) {
        setError("Entraste, pero no se pudo leer la sesión. Recargá la página.");
        return;
      }
      const body = (await me.json()) as { user: SessionUser | null };
      if (body.user) onSignedIn(body.user);
      else setError("Entraste, pero no se pudo leer la sesión. Recargá la página.");
    } catch {
      setError("Sin conexión con el servidor.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="account-body">
      <p className="eyebrow">ACCESO DE CLIENTE</p>
      <h2 className="account-title">{mode === "login" ? "Ingresar" : "Crear cuenta"}</h2>

      {expired && <p className="account-warn">Tu sesión venció. Volvé a ingresar.</p>}

      <div className="account-tabs">
        <button
          className={mode === "login" ? "active" : ""}
          onClick={() => {
            setMode("login");
            setError(null);
          }}
        >
          INGRESAR
        </button>
        <button
          className={mode === "register" ? "active" : ""}
          onClick={() => {
            setMode("register");
            setError(null);
          }}
        >
          CREAR CUENTA
        </button>
      </div>

      <form className="account-form" onSubmit={submit}>
        <label>
          <span>EMAIL</span>
          <input
            type="email"
            value={email}
            autoComplete="email"
            required
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          <span>CONTRASEÑA</span>
          <input
            type="password"
            value={password}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={mode === "register" ? 8 : undefined}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {mode === "register" && <small className="account-hint">Mínimo 8 caracteres.</small>}
        {error && <p className="account-error">{error}</p>}
        <button className="account-submit" type="submit" disabled={busy}>
          {busy ? "PROCESANDO…" : mode === "login" ? "INGRESAR" : "CREAR CUENTA"}
        </button>
      </form>

      <p className="disclaimer">
        Tu cuenta es individual e independiente. Sirve para vincular tu Binance en modo lectura y
        ver tu cartera dentro de la terminal.
      </p>
    </div>
  );
}

function AccountHome({
  user,
  onSignedOut,
  onSessionExpired,
}: {
  user: SessionUser;
  onSignedOut: () => void;
  onSessionExpired: () => void;
}) {
  const [portfolio, setPortfolio] = useState<PortfolioState>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [pending, setPending] = useState<"signout" | "unlink" | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/binance/portfolio")
      .then(async (response) => {
        if (!alive) return;
        // The session died server-side — send the user back to the login form
        // instead of showing a stale "active account" header.
        if (response.status === 401) {
          onSessionExpired();
          return;
        }
        // 404 is the "no linked account yet" case, not a failure.
        if (response.status === 404) {
          setPortfolio(null);
          return;
        }
        if (!response.ok) {
          setError(await readError(response, "No se pudo leer la cartera."));
          return;
        }
        setPortfolio((await response.json()) as Portfolio);
      })
      .catch(() => alive && setError("Sin conexión con el servidor."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [reloadKey, onSessionExpired]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    setReloadKey((key) => key + 1);
  }, []);

  const signOut = async () => {
    setPending("signout");
    setError(null);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) {
        // Claiming "signed out" while the server token is still valid would be
        // a security lie — say it failed and let the user retry.
        setError(await readError(response, "No se pudo cerrar la sesión. Reintentá."));
        return;
      }
      onSignedOut();
    } catch {
      setError("Sin conexión: la sesión sigue abierta. Reintentá.");
    } finally {
      setPending(null);
    }
  };

  const unlink = async () => {
    setPending("unlink");
    setError(null);
    try {
      const response = await fetch("/api/binance/link", { method: "DELETE" });
      if (response.status === 401) {
        onSessionExpired();
        return;
      }
      if (!response.ok) {
        // Same reasoning: never show the linking form as if the keys were
        // removed when the server still holds them.
        setError(await readError(response, "No se pudo desvincular. Reintentá."));
        return;
      }
      setPortfolio(null);
    } catch {
      setError("Sin conexión: las claves siguen vinculadas. Reintentá.");
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="account-body">
      <p className="eyebrow">CUENTA ACTIVA</p>
      <h2 className="account-title">{user.email}</h2>
      <button className="account-ghost" onClick={signOut} disabled={pending !== null}>
        {pending === "signout" ? "CERRANDO…" : "CERRAR SESIÓN"}
      </button>

      <h3 className="account-section">BINANCE · SOLO LECTURA</h3>

      {loading && <p className="account-loading">LEYENDO CARTERA…</p>}
      {error && <p className="account-error">{error}</p>}

      {!loading && portfolio === null && <LinkForm onLinked={reload} />}

      {!loading && portfolio && (
        <>
          <div className="account-actions">
            <button onClick={reload} disabled={pending !== null}>
              ACTUALIZAR
            </button>
            <button className="danger" onClick={unlink} disabled={pending !== null}>
              {pending === "unlink" ? "DESVINCULANDO…" : "DESVINCULAR"}
            </button>
          </div>

          <div className="balance-list">
            {portfolio.balances.length === 0 ? (
              <p className="account-loading">SIN SALDOS DISPONIBLES</p>
            ) : (
              portfolio.balances.map((balance) => (
                <div key={balance.asset}>
                  <b>{balance.asset}</b>
                  <span>{amount(balance.free)}</span>
                  {Number(balance.locked) > 0 && <em>{amount(balance.locked)} bloq.</em>}
                </div>
              ))
            )}
          </div>
          <small className="account-hint">
            Actualizado {new Date(portfolio.updateTime).toLocaleString("es-AR")}
          </small>

          <HistoryBlock
            title="DEPÓSITOS"
            available={portfolio.historyAvailable.deposits}
            rows={portfolio.deposits.map((entry) => ({
              key: `${entry.coin}-${entry.insertTime}`,
              coin: entry.coin,
              amount: entry.amount,
              date: new Date(entry.insertTime).toLocaleDateString("es-AR"),
            }))}
          />
          <HistoryBlock
            title="RETIROS"
            available={portfolio.historyAvailable.withdrawals}
            rows={portfolio.withdrawals.map((entry) => ({
              key: `${entry.coin}-${entry.applyTime}`,
              coin: entry.coin,
              amount: entry.amount,
              date: new Date(entry.applyTime).toLocaleDateString("es-AR"),
            }))}
          />
        </>
      )}
    </div>
  );
}

function HistoryBlock({
  title,
  available,
  rows,
}: {
  title: string;
  available: boolean;
  rows: { key: string; coin: string; amount: string; date: string }[];
}) {
  return (
    <div className="history-block">
      <h4>{title}</h4>
      {!available ? (
        // Never claim "no history" when the upstream call failed.
        <p className="account-warn">No se pudo leer este historial. Volvé a intentar.</p>
      ) : rows.length === 0 ? (
        <p className="account-loading">SIN MOVIMIENTOS</p>
      ) : (
        rows.slice(0, 8).map((row) => (
          <div key={row.key}>
            <b>{row.coin}</b>
            <span>{amount(row.amount)}</span>
            <em>{row.date}</em>
          </div>
        ))
      )}
    </div>
  );
}

function LinkForm({ onLinked }: { onLinked: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/binance/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, apiSecret }),
      });
      if (!response.ok) {
        setError(await readError(response, "No se pudo vincular la cuenta."));
        return;
      }
      setApiKey("");
      setApiSecret("");
      onLinked();
    } catch {
      setError("Sin conexión con el servidor.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="account-form" onSubmit={submit}>
      <p className="account-notice">
        Creá la API key en Binance <b>sin permisos de trading ni de retiro</b>. Si la key tiene
        alguno de esos permisos, el servidor la rechaza y no la guarda.
      </p>
      <label>
        <span>API KEY</span>
        <input value={apiKey} required onChange={(event) => setApiKey(event.target.value)} />
      </label>
      <label>
        <span>API SECRET</span>
        <input
          type="password"
          value={apiSecret}
          required
          onChange={(event) => setApiSecret(event.target.value)}
        />
      </label>
      {error && <p className="account-error">{error}</p>}
      <button className="account-submit" type="submit" disabled={busy}>
        {busy ? "VERIFICANDO…" : "VINCULAR CUENTA"}
      </button>
      <small className="account-hint">
        Se guardan cifradas. Podés desvincularlas cuando quieras.
      </small>
    </form>
  );
}
