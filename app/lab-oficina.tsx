"use client";

/**
 * La oficina 3D del fondo: los agentes de papel trabajando en sus escritorios, agrupados en tres mesas (tendencia, reversión y
 * estructura), con dos pizarras en las paredes (posiciones abiertas y reunión de la semana) y una sala de reuniones. Los
 * números salen del registro unificado por agente (lib/oficina.ts) y se leen una vez al abrir la oficina. La escena es CSS 3D:
 * el movimiento es decorativo y se apaga con «reducir movimiento». Solo papel: ningún escritorio manda órdenes.
 */
import { useEffect, useMemo, useState } from "react";
import { armarOficina, MESAS, nombreActivo, type Escritorio, type FilaOficina, type MesaId, type Oficina } from "../lib/oficina.ts";

const POR_FILA = 4;
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)} %`);
const r2 = (v: number | null) => {
  if (v === null) return "—";
  const x = Math.round(v * 100) / 100 || 0;
  return `${x > 0 ? "+" : ""}${x.toFixed(2).replace(".", ",")} R`;
};
const n2 = (v: number | null) => (v === null ? "—" : v.toFixed(2).replace(".", ","));
const tono = (e: Escritorio) => (e.semana.cerradas === 0 ? "quieto" : e.semana.neto > 0 ? "gana" : e.semana.neto < 0 ? "pierde" : "quieto");
const nombreCorto = (agente: string) => agente.replace(/^Agente\s+/, "");

type Puesto = { e: Escritorio; x: number; y: number };

/** Ubica los escritorios: cada mesa en su bloque de filas, con un pasillo entre mesas. La sala de reuniones va al fondo. */
function ubicar(escritorios: Escritorio[]): { puestos: Puesto[]; filas: number; bloques: { mesa: MesaId; y: number; filas: number }[] } {
  const puestos: Puesto[] = [];
  const bloques: { mesa: MesaId; y: number; filas: number }[] = [];
  let y = 1;
  for (const m of MESAS) {
    const suyos = escritorios.filter((e) => e.mesa === m.id);
    if (!suyos.length) continue;
    const filas = Math.ceil(suyos.length / POR_FILA);
    bloques.push({ mesa: m.id, y, filas });
    suyos.forEach((e, k) => puestos.push({ e, x: 1 + (k % POR_FILA) * 1.5, y: y + Math.floor(k / POR_FILA) * 1.6 }));
    y += filas * 1.6 + 0.9;
  }
  return { puestos, filas: y + 3, bloques };
}

function Persona({ tonoCamisa }: { tonoCamisa: string }) {
  return (
    <span className={`of-persona of-${tonoCamisa}`} aria-hidden="true">
      <span className="of-cabeza" />
      <span className="of-cuerpo" />
    </span>
  );
}

function Pizarra({ titulo, filas, vacio }: { titulo: string; filas: string[]; vacio: string }) {
  return (
    <div className="of-pizarra-texto">
      <b>{titulo}</b>
      {filas.length ? filas.map((f) => <span key={f}>{f}</span>) : <span className="of-tenue">{vacio}</span>}
    </div>
  );
}

export default function LabOficina() {
  const [oficina, setOficina] = useState<Oficina>(() => armarOficina(null, 0));
  const [estado, setEstado] = useState<"cargando" | "listo" | "sin-sesion" | "error">("cargando");
  const [elegido, setElegido] = useState<string | null>(null);
  const [giro, setGiro] = useState(-40);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await fetch("/api/oficina", { credentials: "same-origin", cache: "no-store" });
        if (!vivo) return;
        if (r.status === 401) {
          setEstado("sin-sesion");
          return;
        }
        if (!r.ok) throw new Error(String(r.status));
        const { filas } = (await r.json()) as { filas: FilaOficina[] };
        if (!vivo) return;
        setOficina(armarOficina(filas, Date.now()));
        setEstado("listo");
      } catch {
        if (vivo) setEstado("error");
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const { puestos, filas, bloques } = useMemo(() => ubicar(oficina.escritorios), [oficina.escritorios]);
  const elegidoE = oficina.escritorios.find((e) => e.id === elegido) ?? null;
  const enDirecto = oficina.escritorios.flatMap((e) => e.abiertas.map((a) => ({ e, a }))).sort((x, y) => y.a.detectada - x.a.detectada);
  const lineasDirecto = enDirecto.slice(0, 8).map(({ e, a }) => `${nombreCorto(e.agente)} · ${nombreActivo(a.symbol)} ${a.lado === "LONG" ? "▲" : "▼"}`);
  const lineasReunion = oficina.reunion.slice(0, 6).map((e) => `${nombreCorto(e.agente)} · ${r2(e.semana.neto)} · n=${e.semana.cerradas}`);
  const mejor = oficina.reunion[0] ?? null;

  return (
    <section className="of" aria-labelledby="of-titulo">
      <header className="of-cabecera">
        <h3 id="of-titulo" className="lab-sub">La oficina del fondo</h3>
        <p>
          Cada agente en su escritorio, como un fondo con tres mesas. Todo es papel: nadie opera dinero real. Tocá un escritorio para
          ver su ficha.
        </p>
        <label className="of-giro">
          Girar la vista
          <input type="range" min={-80} max={0} value={giro} onChange={(ev) => setGiro(Number(ev.target.value))} />
        </label>
        {estado === "cargando" && <p className="of-tenue">Leyendo los resultados de los agentes…</p>}
        {estado === "sin-sesion" && <p className="of-tenue">Iniciá sesión para ver los resultados de tus agentes. Sin sesión, los escritorios no tienen números.</p>}
        {estado === "error" && <p className="of-tenue">No se pudieron leer los resultados: sin datos (no es cero).</p>}
        {oficina.incompleta && <p className="of-tenue">Se leyeron las últimas 1.000 entradas: lo más viejo no entra.</p>}
      </header>

      <div className="of-escena" style={{ ["--giro" as string]: `${giro}deg`, ["--filas" as string]: filas }}>
        <div className="of-piso">
          <div className="of-pared of-pared-fondo">
            <Pizarra titulo="EN DIRECTO" filas={lineasDirecto} vacio="Sin posiciones abiertas" />
            <Pizarra titulo="REUNIÓN DE LA SEMANA" filas={lineasReunion} vacio="Nadie cerró en 7 días" />
          </div>
          {bloques.map((b) => (
            <div key={b.mesa} className="of-alfombra" style={{ ["--y" as string]: b.y - 0.35, ["--alto" as string]: b.filas * 1.6 }}>
              <span>{MESAS.find((m) => m.id === b.mesa)?.nombre}</span>
            </div>
          ))}
          {puestos.map(({ e, x, y }) => (
            <button
              key={e.id}
              type="button"
              className={`of-puesto${elegido === e.id ? " of-activo" : ""}${e.abiertas.length ? " of-operando" : ""}`}
              style={{ ["--x" as string]: x, ["--y" as string]: y }}
              aria-pressed={elegido === e.id}
              aria-label={`${e.agente}: ${e.abiertas.length} abiertas, ${e.semana.cerradas} cerradas esta semana`}
              onClick={() => setElegido(elegido === e.id ? null : e.id)}
            >
              <span className="of-mueble">
                <span className="of-tapa" />
                <span className="of-frente" />
                <span className="of-lado" />
                <span className="of-monitor">{e.abiertas.length ? e.abiertas.length : ""}</span>
              </span>
              <span className="of-parado">
                <Persona tonoCamisa={tono(e)} />
              </span>
            </button>
          ))}
          <div className="of-sala" style={{ ["--y" as string]: filas - 2.4 }}>
            <span className="of-mesa-redonda" />
            {oficina.reunion.slice(0, 4).map((e, k) => (
              <span key={e.id} className="of-parado of-silla" style={{ ["--k" as string]: k }}>
                <Persona tonoCamisa={tono(e)} />
              </span>
            ))}
            <span className="of-sala-nombre">Sala de reuniones</span>
          </div>
        </div>
      </div>

      {elegidoE && (
        <article className="of-ficha" aria-live="polite">
          <header>
            <b>{elegidoE.agente}</b>
            <span>{MESAS.find((m) => m.id === elegidoE.mesa)?.nombre}</span>
          </header>
          <p>{elegidoE.mira}</p>
          <dl>
            <div><dt>Cerradas</dt><dd>{oficina.sinDatos ? "sin datos" : elegidoE.total.cerradas}</dd></div>
            <div>
              <dt>Acierto</dt>
              <dd>
                {pct(elegidoE.total.winRate)}
                {elegidoE.total.muestra === "MINIMA" && <small> muestra mínima</small>}
              </dd>
            </div>
            <div><dt>Factor de ganancia</dt><dd>{n2(elegidoE.total.profitFactor)}</dd></div>
            <div><dt>Por operación</dt><dd>{r2(elegidoE.total.expectancia)}</dd></div>
            <div><dt>Semana</dt><dd>{elegidoE.semana.cerradas ? `${r2(elegidoE.semana.neto)} · n=${elegidoE.semana.cerradas}` : "sin cierres"}</dd></div>
          </dl>
          {elegidoE.abiertas.length > 0 && (
            <p>
              Abiertas:{" "}
              {elegidoE.abiertas.map((a) => `${nombreActivo(a.symbol)} ${a.lado === "LONG" ? "▲" : "▼"}`).join(" · ")}
            </p>
          )}
          <small>Papel, velas de 4 h. No es asesoramiento financiero.</small>
        </article>
      )}

      <div className="of-listas">
        <div>
          <h4>En directo</h4>
          {enDirecto.length ? (
            <ul>{enDirecto.slice(0, 12).map(({ e, a }) => <li key={`${e.id}-${a.symbol}-${a.detectada}`}>{nombreCorto(e.agente)} · {nombreActivo(a.symbol)} {a.lado === "LONG" ? "▲ largo" : "▼ corto"}</li>)}</ul>
          ) : (
            <p className="of-tenue">Sin posiciones abiertas.</p>
          )}
        </div>
        <div>
          <h4>Reunión de la semana</h4>
          {mejor ? (
            <>
              <p>
                Mejor neto: <b>{nombreCorto(mejor.agente)}</b>, {r2(mejor.semana.neto)} con {mejor.semana.cerradas} {mejor.semana.cerradas === 1 ? "cierre" : "cierres"}
                {mejor.semana.muestra === "MINIMA" ? " (muestra mínima: no alcanza para llamarlo campeón)" : ""}.
              </p>
              <ol>{oficina.reunion.map((e) => <li key={e.id}>{nombreCorto(e.agente)} · {r2(e.semana.neto)} · n={e.semana.cerradas}</li>)}</ol>
            </>
          ) : (
            <p className="of-tenue">Nadie cerró operaciones en los últimos 7 días.</p>
          )}
          <p className="of-tenue">
            {oficina.sinMovimiento} agentes sin cierres esta semana. La reunión no cambia reglas: los cambios los proponés y los aprobás
            vos, a mano, en el laboratorio en sombra.
          </p>
        </div>
      </div>
    </section>
  );
}
