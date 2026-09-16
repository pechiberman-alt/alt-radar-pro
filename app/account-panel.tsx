"use client";

import { useCallback, useEffect, useState } from "react";

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
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me")
      .then((response) => response.json() as Promise<{ user: SessionUser | null }>)
      .then((body) => {
        if (alive) setUser(body.user ?? null);
      })
      .catch(() => undefined)
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        className="account-trigger"
        onClick={() => setOpen(true)}
        aria-label={user ? `Cuenta de ${user.email}` : "Ingresar a tu cuenta"}
      >
        {ready && user ? user.email.split("@")[0].slice(0, 12).toUpperCase() : "INGRESAR"}
      </button>

      {open && (
        <div className="overlay">
          <aside className="drawer account-drawer" aria-label="Panel de cuenta">
            <button className="close" onClick={() => setOpen(false)} aria-label="Cerrar">
              ×
            </button>
            {!ready ? (
              <p className="account-loading">CARGANDO SESIÓN…</p>
            ) : user ? (
              <AccountHome user={user} onSignedOut={() => setUser(null)} />
            ) : (
              <AuthForms onSignedIn={setUser} />
            )}
          </aside>
        </div>
      )}
    </>
  );
}

function AuthForms({ onSignedIn }: { onSignedIn: (user: SessionUser) => void }) {
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
      const me = (await fetch("/api/auth/me").then((r) => r.json())) as {
        user: SessionUser | null;
      };
      if (me.user) onSignedIn(me.user);
    } catch {
      setError("Sin conexión con el servidor.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="account-body">
      <p className="eyebrow">ACCESO DE CLIENTE</p>
      <h2 className="account-title">
        {mode === "login" ? "Ingresar" : "Crear cuenta"}
      </h2>

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

function AccountHome({ user, onSignedOut }: { user: SessionUser; onSignedOut: () => void }) {
  const [portfolio, setPortfolio] = useState<PortfolioState>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/binance/portfolio")
      .then(async (response) => {
        if (!alive) return;
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
  }, [reloadKey]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    setReloadKey((key) => key + 1);
  }, []);

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    onSignedOut();
  };

  const unlink = async () => {
    await fetch("/api/binance/link", { method: "DELETE" }).catch(() => undefined);
    setPortfolio(null);
  };

  return (
    <div className="account-body">
      <p className="eyebrow">CUENTA ACTIVA</p>
      <h2 className="account-title">{user.email}</h2>
      <button className="account-ghost" onClick={signOut}>
        CERRAR SESIÓN
      </button>

      <h3 className="account-section">BINANCE · SOLO LECTURA</h3>

      {loading && <p className="account-loading">LEYENDO CARTERA…</p>}
      {error && <p className="account-error">{error}</p>}

      {!loading && portfolio === null && <LinkForm onLinked={reload} />}

      {!loading && portfolio && (
        <>
          <div className="account-actions">
            <button onClick={reload}>ACTUALIZAR</button>
            <button className="danger" onClick={unlink}>
              DESVINCULAR
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
