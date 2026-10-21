"use client";

/**
 * Los cobros de la terminal, solo para el administrador (dentro de CONFIGURACIÓN): el alias, el precio y los días; los avisos de pago
 * para aprobar o rechazar a mano, mirando el comprobante; la activación manual por email; y las cuentas con su estado. Nada se
 * aprueba solo: cada botón pide confirmar con un segundo toque.
 */
import { useCallback, useEffect, useState } from "react";

type Config = { alias: string; precio: number | null; moneda: "ARS" | "USD" | "USDT"; dias: number; diasPrueba: number };
type Pago = { id: number; email: string; monto: number; referencia: string; nota: string; estado: string; dias: number | null; creado: number; revisado: number | null };
type Cuenta = { id: number; email: string; estado: string; hasta: number | null; diasRestantes: number | null; sinUso: boolean };
type Datos = { config: Config; pendientes: Pago[]; revisados: Pago[]; cuentas: Cuenta[] };

const fecha = (t: number | null) => (t ? new Date(t).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const dia = (t: number | null) => (t ? new Date(t).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—");
const monto = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
const ESTADO: Record<string, string> = { ADMIN: "ADMIN", PRUEBA: "PRUEBA", ACTIVA: "PRO", VENCIDA: "VENCIDA", SIN_USO: "SIN USO" };

export default function CobrosAdmin() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nota, setNota] = useState<string | null>(null);
  const [vuelta, setVuelta] = useState(0);
  const [armado, setArmado] = useState<string | null>(null);
  const [form, setForm] = useState<{ alias: string; precio: string; moneda: string; dias: string; diasPrueba: string } | null>(null);
  const [email, setEmail] = useState("");
  const [diasMano, setDiasMano] = useState("30");
  const [ocupado, setOcupado] = useState(false);

  const releer = useCallback(() => setVuelta((v) => v + 1), []);
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await fetch("/api/admin/cobros", { credentials: "same-origin", cache: "no-store" });
        const d = (await r.json().catch(() => null)) as (Datos & { error?: string }) | null;
        if (!vivo) return;
        if (!r.ok || !d || d.error) {
          setError(d?.error ?? "No se pudieron leer los cobros.");
          return;
        }
        setDatos(d);
        setError(null);
        setForm((f) => f ?? { alias: d.config.alias, precio: d.config.precio === null ? "" : monto(d.config.precio), moneda: d.config.moneda, dias: String(d.config.dias), diasPrueba: String(d.config.diasPrueba) });
      } catch {
        if (vivo) setError("Sin conexión con el servidor.");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [vuelta]);

  const pedir = async (cuerpo: unknown, ok: string) => {
    setOcupado(true);
    setNota(null);
    try {
      const r = await fetch("/api/admin/cobros", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(cuerpo) });
      const d = (await r.json().catch(() => ({}))) as { error?: string; hasta?: number };
      setNota(r.ok ? `${ok}${d.hasta ? ` Queda PRO hasta el ${dia(d.hasta)}.` : ""}` : (d.error ?? "No se pudo."));
      if (r.ok) releer();
    } catch {
      setNota("Sin conexión con el servidor.");
    } finally {
      setOcupado(false);
      setArmado(null);
    }
  };
  /** Dos toques: el primero arma el botón, el segundo confirma. */
  const confirmar = (clave: string, accion: () => void) => (armado === clave ? accion() : setArmado(clave));

  return (
    <section className="panel ca" id="cobros" aria-label="Cobros">
      <div className="panel-head">
        <div>
          <p className="eyebrow">COBROS · SÓLO ADMINISTRADOR</p>
          <h2>Pagos por alias y acceso PRO</h2>
        </div>
        <span className="badge">{datos ? `${datos.pendientes.length} ${datos.pendientes.length === 1 ? "PENDIENTE" : "PENDIENTES"}` : "…"}</span>
      </div>
      {error && <p className="ca-nota bad">{error}</p>}
      {datos && form && (
        <div className="ca-cuerpo">
          <div className="ca-bloque">
            <h3>Avisos de pago pendientes</h3>
            {datos.pendientes.length === 0 ? (
              <p className="ca-vacio">No hay avisos pendientes.</p>
            ) : (
              <ul className="ca-lista">
                {datos.pendientes.map((p) => (
                  <li key={p.id}>
                    <div className="ca-pago">
                      <b>{p.email}</b>
                      <span>
                        {datos.config.moneda === "ARS" ? "$" : `${datos.config.moneda} `}
                        {monto(p.monto)} · operación <code>{p.referencia}</code> · {fecha(p.creado)}
                      </span>
                      {p.nota && <em>«{p.nota}»</em>}
                    </div>
                    <div className="ca-acciones">
                      <button type="button" className={armado === `a${p.id}` ? "armado" : ""} disabled={ocupado} onClick={() => confirmar(`a${p.id}`, () => void pedir({ accion: "aprobar", id: p.id }, "Aprobado."))}>
                        {armado === `a${p.id}` ? "¿CONFIRMÁS?" : `APROBAR +${datos.config.dias} DÍAS`}
                      </button>
                      <button type="button" className={`ca-no${armado === `r${p.id}` ? " armado" : ""}`} disabled={ocupado} onClick={() => confirmar(`r${p.id}`, () => void pedir({ accion: "rechazar", id: p.id }, "Rechazado."))}>
                        {armado === `r${p.id}` ? "¿CONFIRMÁS?" : "RECHAZAR"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="ca-letra">Aprobá solo después de ver la transferencia en tu cuenta con ese número de operación. A quien tenga Telegram vinculado le llega el aviso.</p>
          </div>

          <div className="ca-bloque">
            <h3>Configuración</h3>
            <form
              className="ca-form"
              onSubmit={(e) => {
                e.preventDefault();
                void pedir({ accion: "config", config: { alias: form.alias, precio: form.precio.trim() || null, moneda: form.moneda, dias: Number(form.dias), diasPrueba: Number(form.diasPrueba) } }, "Configuración guardada.");
              }}
            >
              <label>
                <span>ALIAS</span>
                <input value={form.alias} onChange={(e) => setForm({ ...form, alias: e.target.value })} required />
              </label>
              <label>
                <span>PRECIO</span>
                <input value={form.precio} onChange={(e) => setForm({ ...form, precio: e.target.value })} placeholder="sin cargar" inputMode="decimal" />
              </label>
              <label>
                <span>MONEDA</span>
                <select value={form.moneda} onChange={(e) => setForm({ ...form, moneda: e.target.value })}>
                  <option value="ARS">ARS</option>
                  <option value="USD">USD</option>
                  <option value="USDT">USDT</option>
                </select>
              </label>
              <label>
                <span>DÍAS POR PAGO</span>
                <input value={form.dias} onChange={(e) => setForm({ ...form, dias: e.target.value })} inputMode="numeric" />
              </label>
              <label>
                <span>DÍAS DE PRUEBA</span>
                <input value={form.diasPrueba} onChange={(e) => setForm({ ...form, diasPrueba: e.target.value })} inputMode="numeric" />
              </label>
              <button type="submit" disabled={ocupado}>
                GUARDAR
              </button>
            </form>
            {datos.config.precio === null && <p className="ca-letra warn">Todavía no cargaste el precio: la presentación y el muro dicen «precio a confirmar».</p>}
          </div>

          <div className="ca-bloque">
            <h3>Activar a mano</h3>
            <form
              className="ca-form ca-form-mano"
              onSubmit={(e) => {
                e.preventDefault();
                confirmar("mano", () => void pedir({ accion: "activar", email, dias: Number(diasMano) }, "Activado."));
              }}
            >
              <label>
                <span>EMAIL DE LA CUENTA</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </label>
              <label>
                <span>DÍAS</span>
                <input value={diasMano} onChange={(e) => setDiasMano(e.target.value)} inputMode="numeric" />
              </label>
              <button type="submit" className={armado === "mano" ? "armado" : ""} disabled={ocupado || !email.trim()}>
                {armado === "mano" ? "¿CONFIRMÁS?" : "SUMAR DÍAS"}
              </button>
            </form>
          </div>

          <div className="ca-bloque">
            <h3>Cuentas</h3>
            <ul className="ca-cuentas">
              {datos.cuentas.map((c) => (
                <li key={c.id}>
                  <span>{c.email}</span>
                  <b className={`ca-e-${c.estado.toLowerCase()}`}>{ESTADO[c.estado] ?? c.estado}</b>
                  <small>{c.sinUso ? "la prueba arranca cuando entre" : c.estado === "ADMIN" ? "siempre" : c.estado === "VENCIDA" ? `venció ${dia(c.hasta)}` : `hasta ${dia(c.hasta)}`}</small>
                </li>
              ))}
            </ul>
          </div>

          {datos.revisados.length > 0 && (
            <div className="ca-bloque">
              <h3>Últimos revisados</h3>
              <ul className="ca-cuentas">
                {datos.revisados.map((p) => (
                  <li key={p.id}>
                    <span>{p.email}</span>
                    <b className={p.estado === "APROBADO" ? "ca-e-activa" : "ca-e-vencida"}>{p.estado}</b>
                    <small>
                      {monto(p.monto)} · <code>{p.referencia}</code> · {fecha(p.revisado)}
                    </small>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {nota && <p className="ca-nota">{nota}</p>}
    </section>
  );
}
