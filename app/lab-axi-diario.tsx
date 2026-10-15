"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { CENTAVOS_POR_USD, MAX_DEALS_AXI, MAX_POR_PEDIDO_AXI, type DealAxi, type ResumenAxi } from "../lib/axi-diario.ts";

/**
 * Tu cuenta real de Axi en el panel (solo lectura, en USC): las ejecuciones que ya están en tu diario, su resumen por mes y
 * cómo cargar más. La app no se conecta sola a Axi: el conector vive en tu chat con Claude, así que pegás (o subís) el JSON
 * de las ejecuciones y la app valida cada una. Nada de esto manda órdenes. No es asesoramiento financiero.
 */

type Respuesta = { moneda: string; deals: DealAxi[]; resumen: ResumenAxi; truncado: boolean };
type Rechazo = { posicion: number; motivo: string };
type Lectura = Respuesta | "sin-sesion" | "error";

async function leerDiario(): Promise<Lectura> {
  try {
    const res = await fetch("/api/axi/diario", { credentials: "same-origin", cache: "no-store" });
    if (res.status === 401) return "sin-sesion";
    if (!res.ok) return "error";
    return (await res.json()) as Respuesta;
  } catch {
    return "error";
  }
}

/** Acepta la lista tal cual, o un objeto con la lista en `fills` o en `deals`. */
function aLista(texto: string): unknown[] | null {
  try {
    const v: unknown = JSON.parse(texto);
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (Array.isArray(o.fills)) return o.fills;
      if (Array.isArray(o.deals)) return o.deals;
    }
    return null;
  } catch {
    return null;
  }
}

const dosDecimales = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
const usc = (v: number) => `${v.toLocaleString("es-AR", dosDecimales)} USC`;
const usd = (v: number) => `≈ ${(v / CENTAVOS_POR_USD).toLocaleString("es-AR", dosDecimales)} USD`;
const cuando = (t: number) =>
  new Date(t).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
const mesCorto = (m: string) => {
  const [anio, mes] = m.split("-");
  return `${mes}/${anio}`;
};
const ENTRADA: Record<string, string> = { in: "apertura", out: "cierre", inout: "cierre y apertura", out_by: "cierre" };
const MUESTRA: Record<ResumenAxi["muestra"], string> = {
  "SIN DATOS": "Sin cierres todavía: no hay resultado que medir.",
  MINIMA: "Muestra mínima: menos de 15 cierres.",
  RAZONABLE: "Muestra razonable: 15 cierres o más.",
};

export default function LabAxiDiario() {
  const [lectura, setLectura] = useState<Lectura | null>(null);
  const [pegado, setPegado] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [rechazos, setRechazos] = useState<Rechazo[]>([]);
  const [pideBorrar, setPideBorrar] = useState(false);

  useEffect(() => {
    void (async () => {
      const l = await leerDiario();
      setLectura(l);
    })();
  }, []);

  async function refrescar() {
    setLectura(await leerDiario());
  }

  async function importar(lista: unknown[]) {
    setTrabajando(true);
    setAviso(null);
    setRechazos([]);
    let nuevas = 0;
    let ya = 0;
    const malos: Rechazo[] = [];
    let error: string | null = null;
    // En tandas: el servidor acepta hasta MAX_POR_PEDIDO_AXI por pedido. Si una tanda falla, lo ya guardado queda guardado.
    for (let i = 0; i < lista.length; i += MAX_POR_PEDIDO_AXI) {
      try {
        const res = await fetch("/api/axi/diario", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ deals: lista.slice(i, i + MAX_POR_PEDIDO_AXI) }),
        });
        const j = (await res.json().catch(() => ({}))) as { error?: string; nuevas?: number; ya?: number; rechazados?: Rechazo[] };
        if (!res.ok) {
          error = j.error ?? "No se pudo guardar.";
          break;
        }
        nuevas += j.nuevas ?? 0;
        ya += j.ya ?? 0;
        for (const r of j.rechazados ?? []) malos.push({ posicion: r.posicion + i, motivo: r.motivo });
      } catch {
        error = "Se cortó la conexión. Lo que ya llegó quedó guardado: volvé a importar para completar.";
        break;
      }
    }
    setRechazos(malos);
    setAviso(error ?? `Importadas ${nuevas} ejecuciones nuevas. ${ya} ya estaban en tu diario.${malos.length ? ` ${malos.length} no se pudieron leer.` : ""}`);
    if (!error) setPegado("");
    await refrescar();
    setTrabajando(false);
  }

  async function alImportarPegado() {
    const lista = aLista(pegado);
    if (!lista) {
      setAviso("No reconozco el JSON: pegá la lista de ejecuciones que devuelve el conector de Axi.");
      return;
    }
    await importar(lista);
  }

  async function alElegirArchivo(e: ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    if (!archivo) return;
    const lista = aLista(await archivo.text());
    if (!lista) {
      setAviso("No reconozco el archivo: tiene que ser la lista de ejecuciones que devuelve el conector de Axi.");
      return;
    }
    await importar(lista);
  }

  async function borrar() {
    setTrabajando(true);
    setPideBorrar(false);
    try {
      const res = await fetch("/api/axi/diario", { method: "DELETE", credentials: "same-origin" });
      setAviso(res.ok ? "Tu diario de Axi quedó vacío." : "No se pudo borrar. Probá de nuevo.");
    } catch {
      setAviso("No se pudo borrar. Probá de nuevo.");
    }
    setRechazos([]);
    await refrescar();
    setTrabajando(false);
  }

  if (lectura === null) {
    return (
      <section className="axi-diario">
        <h3 className="lab-sub">Cuenta real de Axi · diario</h3>
        <p className="axi-nota">Cargando tu diario…</p>
      </section>
    );
  }
  if (lectura === "sin-sesion") {
    return (
      <section className="axi-diario">
        <h3 className="lab-sub">Cuenta real de Axi · diario</h3>
        <p className="axi-nota">Iniciá sesión para ver tu diario de Axi.</p>
      </section>
    );
  }
  if (lectura === "error") {
    return (
      <section className="axi-diario">
        <h3 className="lab-sub">Cuenta real de Axi · diario</h3>
        <p className="axi-nota">No se pudo leer tu diario de Axi. Probá de nuevo más tarde.</p>
      </section>
    );
  }

  const { resumen, deals, truncado } = lectura;
  const hayDatos = resumen.operaciones > 0 || resumen.movimientos > 0;
  const periodo = resumen.primero !== null && resumen.ultimo !== null ? `${cuando(resumen.primero)} → ${cuando(resumen.ultimo)}` : "—";

  return (
    <section className="axi-diario">
      <h3 className="lab-sub">Cuenta real de Axi · diario (solo lectura, en USC)</h3>
      <p className="axi-nota">
        Tu cuenta MT5 de Axi está en centavos: 100 USC = 1 USD. La app no se conecta sola a Axi: el conector vive en tu chat con Claude.
        Para cargar el historial, pedile a Claude que lo lea y pegá acá el JSON de las ejecuciones, o subí el archivo. Nada de esto manda
        órdenes. No es asesoramiento financiero.
      </p>

      <div className="axi-carga">
        <textarea
          value={pegado}
          onChange={(e) => setPegado(e.target.value)}
          placeholder="Pegá acá la lista de ejecuciones (fills) del conector de Axi"
          rows={4}
          aria-label="JSON de las ejecuciones de Axi"
        />
        <div className="axi-botones">
          <button type="button" onClick={alImportarPegado} disabled={trabajando || !pegado.trim()}>
            Importar lo pegado
          </button>
          <label className="axi-archivo">
            Subir archivo .json{" "}
            <input type="file" accept="application/json,.json" onChange={alElegirArchivo} disabled={trabajando} />
          </label>
        </div>
        {aviso && <p className="axi-aviso" role="status">{aviso}</p>}
        {rechazos.length > 0 && (
          <ul className="axi-rechazos">
            {rechazos.slice(0, 20).map((r) => (
              <li key={`${r.posicion}-${r.motivo}`}>
                Ejecución {r.posicion}: {r.motivo}
              </li>
            ))}
            {rechazos.length > 20 && <li>…y {rechazos.length - 20} más.</li>}
          </ul>
        )}
      </div>

      {!hayDatos ? (
        <p className="axi-vacio">
          Todavía no hay ejecuciones en tu diario. Sin datos no hay resultado: acá no se muestra cero.
        </p>
      ) : (
        <>
          <div className="axi-cards">
            <article>
              <h4>Cierres (la muestra)</h4>
              <p className="axi-grande">{resumen.cierres}</p>
              <small>{MUESTRA[resumen.muestra]}</small>
            </article>
            <article>
              <h4>Neto de operaciones</h4>
              <p className="axi-grande">{usc(resumen.netoOperaciones)}</p>
              <small>{usd(resumen.netoOperaciones)}</small>
            </article>
            <article>
              <h4>Saldo: depósitos y retiros</h4>
              <p className="axi-grande">{usc(resumen.netoMovimientos)}</p>
              <small>{resumen.movimientos} movimientos</small>
            </article>
            <article>
              <h4>Período</h4>
              <p className="axi-periodo">{periodo}</p>
              <small>Hora de Argentina</small>
            </article>
          </div>

          <h4 className="axi-subtitulo">Por mes</h4>
          <div className="axi-tabla">
            <table>
              <thead>
                <tr>
                  <th>Mes</th>
                  <th>Operaciones</th>
                  <th>Cierres</th>
                  <th>Neto (USC)</th>
                </tr>
              </thead>
              <tbody>
                {resumen.meses.map((m) => (
                  <tr key={m.mes}>
                    <td>{mesCorto(m.mes)}</td>
                    <td>{m.operaciones}</td>
                    <td>{m.cierres}</td>
                    <td>{usc(m.neto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h4 className="axi-subtitulo">Ejecuciones ({deals.length}){truncado ? `, las ${MAX_DEALS_AXI} más recientes` : ""}</h4>
          <div className="axi-tabla">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Símbolo</th>
                  <th>Acción</th>
                  <th>Entrada</th>
                  <th>Lotes</th>
                  <th>Precio</th>
                  <th>Resultado</th>
                  <th>Comisión</th>
                  <th>Swap</th>
                  <th>Neto</th>
                </tr>
              </thead>
              <tbody>
                {deals.map((d) =>
                  d.tipo === "movimiento" ? (
                    <tr key={d.id} className="axi-mov">
                      <td>{cuando(d.tiempo)}</td>
                      <td colSpan={8}>
                        Saldo: {d.accion}
                        {d.comentario ? ` · ${d.comentario}` : ""}
                      </td>
                      <td>{usc(d.neto)}</td>
                    </tr>
                  ) : (
                    <tr key={d.id}>
                      <td>{cuando(d.tiempo)}</td>
                      <td>{d.simbolo}</td>
                      <td>{d.accion === "buy" ? "Compra" : "Venta"}</td>
                      <td>{ENTRADA[d.entrada] ?? d.entrada}</td>
                      <td>{d.lotes.toLocaleString("es-AR")}</td>
                      <td>{d.precio.toLocaleString("es-AR", { maximumFractionDigits: 3 })}</td>
                      <td>{usc(d.resultado)}</td>
                      <td>{usc(d.comision)}</td>
                      <td>{usc(d.swap)}</td>
                      <td>{usc(d.neto)}</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {hayDatos && (
        <div className="axi-botones">
          {pideBorrar ? (
            <>
              <button type="button" onClick={borrar} disabled={trabajando}>
                Sí, borrar mi diario de Axi
              </button>
              <button type="button" onClick={() => setPideBorrar(false)}>
                Cancelar
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setPideBorrar(true)} disabled={trabajando}>
              Borrar mi diario de Axi
            </button>
          )}
        </div>
      )}
    </section>
  );
}
