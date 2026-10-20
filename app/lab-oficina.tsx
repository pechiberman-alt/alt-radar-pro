"use client";

/**
 * La oficina 3D del fondo: los agentes de papel trabajando en sus escritorios, agrupados en tres mesas (tendencia, reversión y
 * estructura), con pizarras en la pared (posiciones abiertas y reunión de la semana) y una sala de reuniones. Los agentes
 * «hablan»: cada globo es una frase armada con un dato (lib/oficina.ts, charla), nunca inventada. Aprenden entre ellos por el
 * consenso, que informa y no filtra; las propuestas son para la persona. Los números salen del registro unificado por agente y
 * se leen una vez al abrir. La escena es CSS 3D; el movimiento es decorativo y se apaga con «reducir movimiento». Solo papel.
 */
import { useEffect, useMemo, useState } from "react";
import { forAi } from "../lib/ai-numbers.ts";
import { ESTRATEGIAS } from "../lib/estrategias.ts";
import { armarOficina, charla, MESAS, nombreActivo, propuestas, tituloSemana, type Escritorio, type FilaOficina, type Frase, type MesaId, type Oficina } from "../lib/oficina.ts";

type Plan = "SERVIDOR" | "CUENTA";
type EstadoMoneda = { symbol: string; at: number; venue: string | null; registradas: number; avanzadas: number; error: string | null };
type Respuesta = { servidor: { filas: FilaOficina[]; estado: EstadoMoneda[] } | null; cuenta: FilaOficina[] | null; sesion: boolean };
type Linea = { de: "vos" | "agente"; texto: string; cerebro?: string };

const POR_FILA = 4;
const CAMBIO_FRASE_MS = 4500;
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)} %`);
const r2 = (v: number | null) => {
  if (v === null) return "—";
  const x = Math.round(v * 100) / 100 || 0;
  return `${x > 0 ? "+" : ""}${x.toFixed(2).replace(".", ",")} R`;
};
const n2 = (v: number | null) => (v === null ? "—" : v.toFixed(2).replace(".", ","));
const tono = (e: Escritorio) => (e.semana.cerradas === 0 ? "quieto" : e.semana.neto > 0 ? "gana" : e.semana.neto < 0 ? "pierde" : "quieto");
const nombreCorto = (agente: string) => agente.replace(/^Agente\s+/, "");
/** El monitor: verde si solo tiene largos, rojo si solo cortos, ámbar si tiene de los dos, apagado si nada. */
const pantalla = (e: Escritorio) => {
  const l = e.abiertas.some((a) => a.lado === "LONG");
  const c = e.abiertas.some((a) => a.lado === "SHORT");
  return l && c ? "mixto" : l ? "largo" : c ? "corto" : "apagado";
};

type Puesto = { e: Escritorio; x: number; y: number };

/** Ubica los escritorios: cada mesa en su bloque de filas, con un pasillo entre mesas. La sala de reuniones va al fondo. */
function ubicar(escritorios: Escritorio[]): { puestos: Puesto[]; filas: number; bloques: { mesa: MesaId; y: number; filas: number }[] } {
  const puestos: Puesto[] = [];
  const bloques: { mesa: MesaId; y: number; filas: number }[] = [];
  let y = 1.2;
  for (const m of MESAS) {
    const suyos = escritorios.filter((e) => e.mesa === m.id);
    if (!suyos.length) continue;
    const filas = Math.ceil(suyos.length / POR_FILA);
    bloques.push({ mesa: m.id, y, filas });
    suyos.forEach((e, k) => puestos.push({ e, x: 1 + (k % POR_FILA) * 1.5, y: y + Math.floor(k / POR_FILA) * 1.6 }));
    y += filas * 1.6 + 1.1;
  }
  return { puestos, filas: y + 3, bloques };
}

function Persona({ tonoCamisa }: { tonoCamisa: string }) {
  return (
    <span className={`of-persona of-${tonoCamisa}`} aria-hidden="true">
      <span className="of-pelo" />
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

/** Una planta de pie, mirando a la cámara. Decoración. */
function Planta({ x, y }: { x: number; y: number }) {
  return (
    <span className="of-planta-lugar" style={{ ["--x" as string]: x, ["--y" as string]: y }} aria-hidden="true">
      <span className="of-parado of-planta">
        <span className="of-hojas" />
        <span className="of-maceta" />
      </span>
    </span>
  );
}

export default function LabOficina() {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [plan, setPlan] = useState<Plan>("SERVIDOR");
  const [ahora, setAhora] = useState(0);
  const [estado, setEstado] = useState<"cargando" | "listo" | "error">("cargando");
  const [elegido, setElegido] = useState<string | null>(null);
  const [giro, setGiro] = useState(-40);
  const [turno, setTurno] = useState(0);
  const [chat, setChat] = useState<Record<string, Linea[]>>({});
  const [pregunta, setPregunta] = useState("");
  const [pensando, setPensando] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await fetch("/api/oficina", { credentials: "same-origin", cache: "no-store" });
        if (!vivo) return;
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as Respuesta;
        if (!vivo) return;
        setDatos(d);
        setAhora(Date.now());
        setEstado("listo");
      } catch {
        if (vivo) setEstado("error");
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const oficina: Oficina = useMemo(
    () => armarOficina(plan === "SERVIDOR" ? (datos?.servidor?.filas ?? null) : (datos?.cuenta ?? null), ahora, plan),
    [datos, plan, ahora],
  );
  const fallas = (datos?.servidor?.estado ?? []).filter((e) => e.error);
  const ultimaVuelta = Math.max(0, ...(datos?.servidor?.estado ?? []).map((e) => e.at));

  // La charla pasa de una frase a otra; con «reducir movimiento» queda quieta en la primera (el feed de abajo las tiene todas).
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setTurno((t) => t + 1), CAMBIO_FRASE_MS);
    return () => window.clearInterval(id);
  }, []);

  /** Hablar con un agente: la misma IA que JARVIS, con sus datos; sin IA, responde con sus propias frases (motor local). */
  async function preguntar(e: Escritorio) {
    const texto = pregunta.trim();
    if (!texto) return;
    const anotar = (l: Linea) => setChat((c) => ({ ...c, [e.id]: [...(c[e.id] ?? []), l] }));
    anotar({ de: "vos", texto });
    setPregunta("");
    setPensando(true);
    const propias = frases.filter((f) => f.quien === e.id).map((f) => f.texto);
    const local = (por: string) => anotar({ de: "agente", texto: propias.length ? propias.join(" ") : "Todavía no tengo operaciones para contarte.", cerebro: `motor local (${por})` });
    try {
      const regla = ESTRATEGIAS.find((x) => x.id === e.id)?.regla ?? e.mira;
      const r = await fetch("/api/analyst/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: `Hablás como ${e.agente}, un agente de papel de la oficina del fondo. Respondé en primera persona, corto y en español rioplatense, solo con tus datos (en el resumen, «agente»). Si un dato no está, decilo. No cambiás tu regla, no das órdenes y no es asesoramiento financiero. Pregunta: ${texto}`,
          snapshot: {
            asistente: "AGENTE DE LA OFICINA",
            agente: forAi({
              nombre: e.agente,
              regla,
              plan: plan === "SERVIDOR" ? "servidor 24/7, velas de Kraken, papel" : "tu cuenta, navegador, papel",
              cerradas: e.total.cerradas,
              acierto: e.total.winRate,
              rPorOperacion: e.total.expectancia,
              netoR: e.total.neto,
              muestra: e.total.muestra,
              semana: { cerradas: e.semana.cerradas, netoR: e.semana.neto },
              abiertas: e.abiertas.map((a) => `${nombreActivo(a.symbol)} ${a.lado === "LONG" ? "largo" : "corto"}`),
              loQueDice: propias,
              loQueAprendeLaOficina: oficina.aprendizaje.texto,
            }),
          },
          history: (chat[e.id] ?? []).slice(-6).map((l) => ({ role: l.de === "vos" ? "user" : "assistant", content: l.texto })),
        }),
      });
      if (r.status === 401) return local("iniciá sesión para la IA");
      const d = (await r.json().catch(() => ({}))) as { text?: string; label?: string };
      if (!r.ok || !d.text) return local("la IA no respondió");
      anotar({ de: "agente", texto: d.text, cerebro: d.label });
    } catch {
      local("sin conexión");
    } finally {
      setPensando(false);
    }
  }

  const { puestos, filas, bloques } = useMemo(() => ubicar(oficina.escritorios), [oficina.escritorios]);
  const frases = charla(oficina);
  const propias = propuestas(oficina);
  const hablan = frases.filter((f) => f.quien !== "JARVIS");
  const actual: Frase | null = hablan.length ? hablan[turno % hablan.length] : null;
  const elegidoE = oficina.escritorios.find((e) => e.id === elegido) ?? null;
  const enDirecto = oficina.escritorios.flatMap((e) => e.abiertas.map((a) => ({ e, a }))).sort((x, y) => y.a.detectada - x.a.detectada);
  const lineasDirecto = enDirecto.slice(0, 7).map(({ e, a }) => `${nombreCorto(e.agente)} · ${nombreActivo(a.symbol)} ${a.lado === "LONG" ? "▲" : "▼"}`);
  const lineasReunion = oficina.reunion.slice(0, 7).map((e) => `${nombreCorto(e.agente)} · ${r2(e.semana.neto)} · n=${e.semana.cerradas}`);
  const mejor = oficina.reunion[0] ?? null;

  return (
    <section className="of" aria-labelledby="of-titulo">
      <header className="of-cabecera">
        <h3 id="of-titulo" className="lab-sub">La oficina del fondo</h3>
        <p>
          Cada agente en su escritorio, en tres mesas. Hablan con lo que muestran sus datos y aprenden entre ellos comparando cuándo
          les va mejor: acompañados o solos. Todo es papel. Tocá un escritorio para ver su ficha.
        </p>
        <div className="of-planes" role="tablist" aria-label="Qué agentes ver">
          <button type="button" role="tab" aria-selected={plan === "SERVIDOR"} onClick={() => setPlan("SERVIDOR")}>SERVIDOR 24/7</button>
          <button type="button" role="tab" aria-selected={plan === "CUENTA"} onClick={() => setPlan("CUENTA")}>TU CUENTA</button>
        </div>
        <p className="of-tenue">
          {plan === "SERVIDOR"
            ? `Corren solos en el servidor, con la app cerrada, sobre velas de 4 h de Kraken (otra serie que Binance: su medición arrancó de cero). Oro y plata no están acá: solo los da Binance.${ultimaVuelta ? ` Última vuelta: ${new Date(ultimaVuelta).toLocaleString("es-AR")}.` : " Todavía no corrió ninguna vuelta."}${fallas.length ? ` ${fallas.length} ${fallas.length === 1 ? "moneda no respondió" : "monedas no respondieron"}: ${fallas.map((f) => f.symbol.replace(/USDT$/, "")).join(", ")}.` : ""}`
            : "Tus agentes del navegador: corren con la app abierta, sobre velas de Binance, con oro y plata."}
        </p>
        <label className="of-giro">
          Girar la vista
          <input type="range" min={-80} max={0} value={giro} onChange={(ev) => setGiro(Number(ev.target.value))} />
        </label>
        {estado === "cargando" && <p className="of-tenue">Leyendo los resultados de los agentes…</p>}
        {estado === "error" && <p className="of-tenue">No se pudieron leer los resultados: sin datos (no es cero).</p>}
        {estado === "listo" && plan === "CUENTA" && !datos?.sesion && <p className="of-tenue">Iniciá sesión para ver tus agentes. El servidor 24/7 se ve sin sesión.</p>}
        {oficina.incompleta && <p className="of-tenue">Se leyeron las últimas 1.000 entradas: lo más viejo no entra.</p>}
      </header>

      <div className="of-escena" style={{ ["--giro" as string]: `${giro}deg`, ["--filas" as string]: filas }}>
        <div className="of-piso">
          <span className="of-luz" style={{ ["--y" as string]: 3 }} aria-hidden="true" />
          <span className="of-luz" style={{ ["--y" as string]: filas - 5 }} aria-hidden="true" />
          <div className="of-pared of-pared-fondo">
            <Pizarra titulo="EN DIRECTO" filas={lineasDirecto} vacio="Sin posiciones abiertas" />
            <span className="of-ventana" aria-hidden="true" />
            <Pizarra titulo="REUNIÓN DE LA SEMANA" filas={lineasReunion} vacio="Nadie cerró en 7 días" />
          </div>
          {bloques.map((b) => (
            <div key={b.mesa} className={`of-alfombra of-alf-${b.mesa.toLowerCase()}`} style={{ ["--y" as string]: b.y - 0.4, ["--alto" as string]: b.filas * 1.6 }}>
              <span>{MESAS.find((m) => m.id === b.mesa)?.nombre}</span>
            </div>
          ))}
          <Planta x={0.15} y={0.6} />
          <Planta x={6.9} y={0.6} />
          <Planta x={6.9} y={filas - 3.2} />
          {puestos.map(({ e, x, y }) => {
            const habla = actual?.quien === e.id;
            const visible = habla || elegido === e.id;
            return (
              <button
                key={e.id}
                type="button"
                className={`of-puesto of-pant-${pantalla(e)}${elegido === e.id ? " of-activo" : ""}${habla ? " of-habla" : ""}`}
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
                  {visible && (
                    <span className={`of-globo${habla ? "" : " of-globo-nombre"}`}>
                      <b>{nombreCorto(e.agente)}</b>
                      {habla && actual ? <span>{actual.texto}</span> : null}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
          <div className="of-sala" style={{ ["--y" as string]: filas - 2.5 }}>
            <span className="of-mesa-redonda" />
            {oficina.reunion.slice(0, 4).map((e, k) => (
              <span key={e.id} className="of-parado of-silla" style={{ ["--k" as string]: k }}>
                <Persona tonoCamisa={tono(e)} />
              </span>
            ))}
            <span className="of-sala-nombre">Sala de reuniones</span>
          </div>
        </div>
        {actual && (
          <p className="of-subtitulo" aria-live="polite">
            <b>{actual.nombre}:</b> {actual.texto}
          </p>
        )}
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
            <p>Abiertas: {elegidoE.abiertas.map((a) => `${nombreActivo(a.symbol)} ${a.lado === "LONG" ? "▲" : "▼"}`).join(" · ")}</p>
          )}
          {frases.filter((f) => f.quien === elegidoE.id).map((f) => <p key={f.texto} className="of-dice">«{f.texto}»</p>)}
          <div className="of-conversa" aria-live="polite">
            {(chat[elegidoE.id] ?? []).map((l, k) => (
              <p key={k} className={`of-msg of-msg-${l.de}`}>
                {l.texto}
                {l.cerebro ? <small> · {l.cerebro}</small> : null}
              </p>
            ))}
            {pensando && <p className="of-msg of-msg-agente of-tenue">Pensando…</p>}
          </div>
          <form
            className="of-preguntar"
            onSubmit={(ev) => {
              ev.preventDefault();
              void preguntar(elegidoE);
            }}
          >
            <input value={pregunta} onChange={(ev) => setPregunta(ev.target.value)} placeholder={`Preguntale a ${nombreCorto(elegidoE.agente)}…`} maxLength={300} aria-label={`Pregunta para ${elegidoE.agente}`} />
            <button type="submit" disabled={pensando || !pregunta.trim()}>Preguntar</button>
          </form>
          <small>Papel, velas de 4 h{plan === "SERVIDOR" ? " de Kraken" : ""}. No es asesoramiento financiero.</small>
        </article>
      )}

      <div className="of-listas">
        <div>
          <h4>La charla</h4>
          <ul className="of-chat">
            {frases.map((f) => (
              <li key={`${f.quien}-${f.texto}`} className={`of-chat-${f.tipo}`}>
                <b>{f.nombre}</b> {f.texto}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4>Reunión de la semana</h4>
          {mejor ? (
            <>
              <p>
                {tituloSemana(mejor)}: <b>{nombreCorto(mejor.agente)}</b>, {r2(mejor.semana.neto)} con {mejor.semana.cerradas}{" "}
                {mejor.semana.cerradas === 1 ? "cierre" : "cierres"}
                {mejor.semana.muestra === "MINIMA" ? " (muestra mínima)" : ""}.
              </p>
              <ol>{oficina.reunion.map((e) => <li key={e.id}>{nombreCorto(e.agente)} · {r2(e.semana.neto)} · n={e.semana.cerradas}</li>)}</ol>
            </>
          ) : (
            <p className="of-tenue">Nadie cerró operaciones en los últimos 7 días.</p>
          )}
          <h4>Propuestas para vos</h4>
          {propias.length ? (
            <ul>{propias.map((p) => <li key={`${p.quien}-${p.texto}`}><b>{nombreCorto(p.agente)}:</b> {p.texto}</li>)}</ul>
          ) : (
            <p className="of-tenue">Ningún agente llegó a 15 cierres: por ahora la única propuesta es seguir midiendo.</p>
          )}
          <p className="of-tenue">
            Nada de esto se aplica solo: pausar o revisar un agente lo decidís vos, y un cambio de regla va por el laboratorio en
            sombra. {oficina.sinMovimiento} agentes sin cierres esta semana.
          </p>
        </div>
      </div>

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
          <h4>Lo que aprenden entre ellos</h4>
          <p>{oficina.aprendizaje.texto}</p>
          <p className="of-tenue">Cada agente decide solo, con su regla. Solo queda anotado con quién coincidió, para ver si coincidir ayuda.</p>
        </div>
      </div>
    </section>
  );
}
