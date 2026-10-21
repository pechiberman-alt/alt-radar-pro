"use client";

/**
 * La oficina 3D del fondo: los agentes de papel trabajando en sus escritorios, agrupados en mesas (tendencia, reversión,
 * estructura, flujo de órdenes y metales), con pizarras en la pared (posiciones abiertas y reunión de la semana) y una sala de reuniones. Los agentes
 * «hablan»: cada globo es una frase armada con un dato (lib/oficina.ts, charla), nunca inventada. Aprenden entre ellos por el
 * consenso, que informa y no filtra; las propuestas son para la persona. Los números salen del registro unificado por agente y
 * se leen una vez al abrir. La escena es CSS 3D; el movimiento es decorativo y se apaga con «reducir movimiento». Solo papel.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { forAi } from "../lib/ai-numbers.ts";
import { ESTRATEGIAS, operaEn } from "../lib/estrategias.ts";
import { conocimientoDe, conocimientoParaIa, respuestaConcepto } from "../lib/agentes-conocimiento.ts";
import { armarOficina, charla, MESAS, nombreActivo, oficinaParaIa, propuestas, tituloSemana, usdTxt, type Escritorio, type FilaOficina, type Frase, type MesaId, type Oficina } from "../lib/oficina.ts";
import { diaAr, diarioParaIa, leerDiario, resumenDia, ultimosDiarios, type Diario } from "../lib/aprendizaje-diario.ts";
import { MONEDAS_SERVIDOR, PLAN_SERVIDOR } from "../lib/agentes-servidor.ts";
import { openInMap } from "../lib/account-events.ts";
import { lecturaMapa, lecturaParaIa, lecturasMapa, onLecturaMapa, type LecturaMapa } from "../lib/mapa-memoria.ts";
import MiniArana from "./lab-mini-arana";

type Plan = "SERVIDOR" | "CUENTA";
type EstadoMoneda = { symbol: string; at: number; venue: string | null; registradas: number; avanzadas: number; error: string | null };
type Respuesta = { servidor: { filas: FilaOficina[]; estado: EstadoMoneda[] } | null; cuenta: FilaOficina[] | null; sesion: boolean; diarios?: unknown[] };
type Linea = { de: "vos" | "agente"; texto: string; cerebro?: string };

const POR_FILA = 4;
/** El largo de piso (en unidades) que entra entero en la escena; más largo, se achica. */
const ESCENA_FILAS = 21.5;
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
/** Los pares que mira un agente en el servidor 24/7 (los metales, solo el oro como PAXG). */
const universoDe = (id: string) => {
  const e = ESTRATEGIAS.find((x) => x.id === id);
  return MONEDAS_SERVIDOR.filter((s) => (e ? operaEn(e, s) : s !== "PAXGUSDT"));
};
/** El monitor: verde si solo tiene largos, rojo si solo cortos, ámbar si tiene de los dos, apagado si nada. */
const pantalla = (e: Escritorio) => {
  const l = e.abiertas.some((a) => a.lado === "LONG");
  const c = e.abiertas.some((a) => a.lado === "SHORT");
  return l && c ? "mixto" : l ? "largo" : c ? "corto" : "apagado";
};

type Puesto = { e: Escritorio; x: number; y: number };

/**
 * Encuadra la escena: mide lo que tiene que verse entero (el piso, la pared con las pizarras, la sala de reuniones y JARVIS) y
 * ajusta la escala (--fit) y la altura (--sube) del piso para que entre debajo del subtítulo, con margen. Dos vueltas, porque
 * la perspectiva no es lineal. Sin transición mientras mide, para leer la posición final y no una intermedia.
 */
function encuadrarEscena(escena: HTMLElement) {
  const piso = escena.querySelector<HTMLElement>(".of-piso");
  if (!piso) return;
  const transicion = piso.style.transition;
  piso.style.transition = "none";
  let fit = 1;
  let sube = 0;
  escena.style.setProperty("--fit", "1");
  escena.style.setProperty("--sube", "0px");
  for (let vuelta = 0; vuelta < 3; vuelta += 1) {
    const s = escena.getBoundingClientRect();
    const cajas = [...escena.querySelectorAll<HTMLElement>(".of-piso, .of-pared-fondo, .of-sala, .of-jarvis")].map((el) => el.getBoundingClientRect()).filter((c) => c.width > 0 && c.height > 0);
    if (!cajas.length || !(s.height > 0)) break;
    const sub = escena.querySelector<HTMLElement>(".of-subtitulo")?.getBoundingClientRect();
    const arriba = (sub && sub.height > 0 ? sub.bottom : s.top) + 6;
    const abajo = s.bottom - 8;
    const top = Math.min(...cajas.map((c) => c.top));
    const bottom = Math.max(...cajas.map((c) => c.bottom));
    const left = Math.min(...cajas.map((c) => c.left));
    const right = Math.max(...cajas.map((c) => c.right));
    const k = Math.min((abajo - arriba) / Math.max(1, bottom - top), (s.width - 16) / Math.max(1, right - left));
    fit = Math.max(0.3, Math.min(1.35, fit * (vuelta === 0 ? k : Math.min(1.08, Math.max(0.92, k)))));
    escena.style.setProperty("--fit", fit.toFixed(4));
    const t = escena.getBoundingClientRect();
    const despues = [...escena.querySelectorAll<HTMLElement>(".of-piso, .of-pared-fondo, .of-sala, .of-jarvis")].map((el) => el.getBoundingClientRect()).filter((c) => c.width > 0 && c.height > 0);
    const centro = (Math.min(...despues.map((c) => c.top)) + Math.max(...despues.map((c) => c.bottom))) / 2;
    sube += (arriba + abajo) / 2 - centro + (t.top - s.top);
    escena.style.setProperty("--sube", `${Math.round(sube)}px`);
  }
  void piso.offsetWidth;
  piso.style.transition = transicion;
}

const precioCorto = (v: number) => v.toLocaleString("es-AR", { maximumFractionDigits: v >= 1000 ? 0 : v >= 1 ? 2 : 5 });
/** La pantalla del mapa en la pared: lo último que leyó el mapa de liquidaciones en este navegador. */
function lineasMapa(l: LecturaMapa | null): string[] {
  if (!l) return [];
  const zona = (z: { low: number; high: number; stars: number }) => `${precioCorto(z.low)}–${precioCorto(z.high)} ${"★".repeat(z.stars)}`;
  return [
    `${nombreActivo(l.symbol)} ${l.timeframe} · ${precioCorto(l.precio)}`,
    ...l.venta.slice(0, 2).map((z) => `Venta ${zona(z)}`),
    ...l.compra.slice(0, 2).map((z) => `Compra ${zona(z)}`),
    ...(l.sesgo ? [l.sesgo.toLowerCase()] : []),
  ];
}
const fechaDia = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

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
    // El pasillo deja lugar al globo con el nombre de la primera fila, para que no tape el cartel de la mesa de atrás.
    y += filas * 1.6 + 1.8;
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

/** La curva de un capital simulado. Sin puntos suficientes, una raya: nada que mostrar todavía. */
function Curva({ puntos, ancho = 220, alto = 56, etiqueta }: { puntos: number[]; ancho?: number; alto?: number; etiqueta: string }) {
  if (puntos.length < 2) return <svg className="of-curva" viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label={`${etiqueta}: sin cierres todavía`}><line x1="0" y1={alto / 2} x2={ancho} y2={alto / 2} className="of-curva-base" /></svg>;
  const min = Math.min(...puntos);
  const max = Math.max(...puntos);
  const rango = max - min || 1;
  const xy = puntos.map((v, i) => `${((i / (puntos.length - 1)) * ancho).toFixed(1)},${(alto - 4 - ((v - min) / rango) * (alto - 8)).toFixed(1)}`);
  const sube = puntos[puntos.length - 1] >= puntos[0];
  const base = alto - 4 - ((puntos[0] - min) / rango) * (alto - 8);
  return (
    <svg className={`of-curva ${sube ? "of-curva-sube" : "of-curva-baja"}`} viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label={`${etiqueta}: de ${Math.round(puntos[0])} a ${Math.round(puntos[puntos.length - 1])} dólares simulados`}>
      <line x1="0" y1={base} x2={ancho} y2={base} className="of-curva-base" />
      <polyline points={xy.join(" ")} />
    </svg>
  );
}

/** JARVIS en la sala de reuniones: un holograma que proyecta la curva del fondo. */
function Holograma({ puntos, activo, elegir }: { puntos: number[]; activo: boolean; elegir: () => void }) {
  return (
    <button type="button" className={`of-jarvis${activo ? " of-activo" : ""}`} onClick={elegir} aria-pressed={activo} aria-label="JARVIS: el fondo simulado y lo que aprende la oficina">
      <span className="of-parado of-jarvis-pie">
        <span className="of-jarvis-panel">
          <Curva puntos={puntos} ancho={120} alto={46} etiqueta="Curva del fondo" />
        </span>
        <span className="of-jarvis-orbe" />
        <span className="of-jarvis-haz" />
      </span>
    </button>
  );
}

/** La araña en su tela, en la esquina de la pared: vigila la red de corridas del servidor. */
function Arana({ activa, elegir, falla }: { activa: boolean; elegir: () => void; falla: boolean }) {
  return (
    <button type="button" className={`of-arana${activa ? " of-activo" : ""}${falla ? " of-arana-alerta" : ""}`} onClick={elegir} aria-pressed={activa} aria-label="La araña: cómo salió la última vuelta de cada moneda">
      <svg viewBox="0 0 60 80" aria-hidden="true">
        <g className="of-tela">
          <path d="M0 0 L60 0 M0 0 L0 60 M0 0 L45 45 M0 0 L58 22 M0 0 L22 58" />
          <path d="M0 14 Q 8 8 14 0 M0 28 Q 16 16 28 0 M0 42 Q 24 24 42 0" />
        </g>
        <line className="of-hilo" x1="30" y1="20" x2="30" y2="52" />
        <g className="of-arana-cuerpo">
          <MiniArana x={30} y={56} escala={1.2} activa />
        </g>
      </svg>
    </button>
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
  const [diaElegido, setDiaElegido] = useState<string | null>(null);
  const [lecturas, setLecturas] = useState<LecturaMapa[]>([]);

  // Lo que leyó el mapa de liquidaciones en este navegador: la pantalla de la pared y lo que ven los agentes al hablar.
  useEffect(() => {
    const leer = () => setLecturas(lecturasMapa());
    const id = window.setTimeout(leer, 0);
    const corta = onLecturaMapa(leer);
    return () => {
      window.clearTimeout(id);
      corta();
    };
  }, []);

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
  // El diario de aprendizaje del plan que se ve: el guardado del servidor (lee más registro) y, para los días que falten y
  // para hoy, el armado acá con las mismas filas (lib/aprendizaje-diario.ts). El de tu cuenta se arma siempre acá.
  const diarios: Diario[] = useMemo(() => {
    if (!ahora) return [];
    const hoy = diaAr(ahora);
    const filasPlan = plan === "SERVIDOR" ? (datos?.servidor?.filas ?? null) : (datos?.cuenta ?? null);
    const guardados = plan === "SERVIDOR" ? (datos?.diarios ?? []).map(leerDiario).filter((d): d is Diario => d !== null) : [];
    if (!filasPlan) return guardados;
    return ultimosDiarios(filasPlan, hoy, plan === "SERVIDOR" ? PLAN_SERVIDOR : "TU_CUENTA").map((d) => (d.dia !== hoy ? (guardados.find((g) => g.dia === d.dia) ?? d) : d));
  }, [datos, plan, ahora]);
  const diaSel = diarios.find((d) => d.dia === diaElegido) ?? diarios.find((d) => d.delDia.cierres > 0) ?? diarios[0] ?? null;
  const fallas = (datos?.servidor?.estado ?? []).filter((e) => e.error);
  const ultimaVuelta = Math.max(0, ...(datos?.servidor?.estado ?? []).map((e) => e.at));

  // La charla pasa de una frase a otra; con «reducir movimiento» queda quieta en la primera (el feed de abajo las tiene todas).
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setTurno((t) => t + 1), CAMBIO_FRASE_MS);
    return () => window.clearInterval(id);
  }, []);

  /**
   * Hablar con alguien de la oficina (un agente o JARVIS): la misma IA que JARVIS, con sus datos y en primera persona. Sin IA,
   * responde con lo que ya dice (motor local). Nadie cambia una regla ni da órdenes desde acá.
   */
  async function preguntar(quien: { id: string; nombre: string; instruccion: string; datos: unknown; local: string[] }) {
    const texto = pregunta.trim();
    if (!texto) return;
    const anotar = (l: Linea) => setChat((c) => ({ ...c, [quien.id]: [...(c[quien.id] ?? []), l] }));
    anotar({ de: "vos", texto });
    setPregunta("");
    setPensando(true);
    // Sin IA: si pregunta por un concepto, el conocimiento revisado; si no, lo que ya dice de sí mismo.
    const concepto = respuestaConcepto(texto);
    const local = (por: string) =>
      anotar({ de: "agente", texto: concepto ?? (quien.local.length ? quien.local.join(" ") : "Todavía no tengo datos para contarte."), cerebro: `motor local (${por})` });
    // Si nombra un par que el mapa leyó hace poco, esa lectura va con la pregunta.
    const nombrados = lecturasMapa().filter((l) => new RegExp(`\\b${l.symbol.replace(/USDT$/, "")}\\b`, "i").test(texto) || (l.symbol === "PAXGUSDT" && /\boro\b/i.test(texto)));
    try {
      const r = await fetch("/api/analyst/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: `${quien.instruccion} Respondé en primera persona, corto y en español rioplatense, solo con los datos del resumen. Si un dato no está, decilo. No cambiás reglas, no das órdenes y no es asesoramiento financiero. Pregunta: ${texto}`,
          snapshot: { asistente: quien.nombre, datos: quien.datos, ...(nombrados.length ? { mapaDeLoQuePreguntas: nombrados.slice(0, 2).map(lecturaParaIa) } : {}) },
          history: (chat[quien.id] ?? []).slice(-6).map((l) => ({ role: l.de === "vos" ? "user" : "assistant", content: l.texto })),
        }),
      });
      if (r.status === 401) return local("iniciá sesión para la IA");
      if (r.status === 429) return local("se terminó la IA gratis de hoy");
      const d = (await r.json().catch(() => ({}))) as { text?: string; label?: string };
      if (!r.ok || !d.text) return local("la IA no respondió");
      anotar({ de: "agente", texto: d.text, cerebro: d.label });
    } catch {
      local("sin conexión");
    } finally {
      setPensando(false);
    }
  }

  const planTxt = plan === "SERVIDOR" ? "servidor 24/7, velas de Kraken, papel" : "tu cuenta, navegador, papel";
  const personaAgente = (e: Escritorio) => ({
    id: e.id,
    nombre: e.agente,
    instruccion: `Hablás como ${e.agente}, un agente de papel de la oficina del fondo. «mapa» es lo que leyó el mapa de liquidaciones en este navegador para los pares donde tenés posición (zonas de compra y de venta, imanes y lo que vio la mesa de flujo); «mapaDeLoQuePreguntas», el del par que nombra la pregunta. Usalos si te preguntan por un activo; si no están, decí que abran el mapa en ese par. «conocimiento» es la teoría profesional de lo que mirás: explicala con tus palabras y con su cuidado, sin prometer resultados.`,
    // Sin IA contesta con lo que ya dice; si todavía no dijo nada, con cómo se ve (siempre tiene algo honesto para contar).
    local: ((propias) => (propias.length ? propias : [e.conciencia]))(frases.filter((f) => f.quien === e.id).map((f) => f.texto)),
    datos: forAi({
      nombre: e.agente,
      regla: ESTRATEGIAS.find((x) => x.id === e.id)?.regla ?? e.mira,
      plan: planTxt,
      cerradas: e.total.cerradas,
      acierto: e.total.winRate,
      rPorOperacion: e.total.expectancia,
      muestra: e.total.muestra,
      pnlSimuladoUsd: e.capital.netoUsd,
      semana: { cerradas: e.semana.cerradas, netoR: e.semana.neto },
      abiertas: e.abiertas.map((a) => `${nombreActivo(a.symbol)} ${a.lado === "LONG" ? "largo" : "corto"}`),
      comoSeVe: e.conciencia,
      lecciones: e.lecciones.map((l) => l.texto),
      mapa: [...new Set(e.abiertas.map((a) => a.symbol))].map((sym) => lecturaMapa(sym)).filter((l): l is LecturaMapa => l !== null).map(lecturaParaIa),
      conocimiento: conocimientoParaIa(conocimientoDe(e.id, e.mesa)),
      mapasLeidosEnEsteNavegador: lecturas.map((l) => nombreActivo(l.symbol)),
      diarioDeLaOficina: diarioParaIa(diaSel),
    }),
  });
  const personaJarvis = () => ({
    id: "JARVIS",
    nombre: "JARVIS",
    instruccion: "Sos JARVIS y coordinás la oficina del fondo: ves a todos los agentes, el fondo simulado, lo que aprenden cada día (diario) y lo que leyó el mapa de liquidaciones (mapa).",
    local: [oficina.aprendizaje.texto, `El fondo simulado va ${usdTxt(oficina.fondo.netoUsd, true)} con ${oficina.fondo.cierres} cierres.`, ...(diaSel ? [`Diario del ${fechaDia(diaSel.dia)}: ${resumenDia(diaSel)}`] : [])],
    datos: { oficina: oficinaParaIa(oficina, plan), diario: diarioParaIa(diaSel), mapa: lecturas.slice(0, 3).map(lecturaParaIa) } as unknown,
  });

  /** El chat de la ficha que esté abierta. */
  const bloqueChat = (quien: ReturnType<typeof personaJarvis>) => (
    <>
      <div className="of-conversa" aria-live="polite">
        {(chat[quien.id] ?? []).map((l, k) => (
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
          void preguntar(quien);
        }}
      >
        <input value={pregunta} onChange={(ev) => setPregunta(ev.target.value)} placeholder={`Preguntale a ${nombreCorto(quien.nombre)}…`} maxLength={300} aria-label={`Pregunta para ${quien.nombre}`} />
        <button type="submit" disabled={pensando || !pregunta.trim()}>Preguntar</button>
      </form>
    </>
  );

  const { puestos, filas, bloques } = useMemo(() => ubicar(oficina.escritorios), [oficina.escritorios]);
  // El encuadre se mide en la pantalla (la perspectiva y el giro cambian lo que ocupa el piso): al dibujar, al girar y al
  // cambiar el tamaño. Escribe dos variables CSS en la escena; no hay estado de React que vuelva a dibujar.
  const escenaRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const escena = escenaRef.current;
    if (!escena) return;
    const encuadrar = () => encuadrarEscena(escena);
    encuadrar();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(encuadrar);
    ro.observe(escena);
    return () => ro.disconnect();
  }, [filas, giro, estado]);
  const frases = charla(oficina);
  const propias = propuestas(oficina);
  // Lo que se oye en la oficina: lo que dice cada uno y lo que se dicen entre ellos.
  const hablan: Frase[] = [
    ...frases.filter((f) => f.quien !== "JARVIS"),
    ...oficina.conversaciones.flatMap((d) => d.lineas.map((l) => ({ quien: l.quien, nombre: l.nombre, texto: l.texto, tipo: "acuerdo" as const }))),
  ];
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
            ? `Corren solos en el servidor, con la app cerrada, sobre velas de 4 h de Kraken (otra serie que Binance: su medición arrancó de cero). El oro corre como PAXG; la plata no está acá (solo la da Binance).${ultimaVuelta ? ` Última vuelta: ${new Date(ultimaVuelta).toLocaleString("es-AR")}.` : " Todavía no corrió ninguna vuelta."}${fallas.length ? ` ${fallas.length} ${fallas.length === 1 ? "moneda no respondió" : "monedas no respondieron"}: ${fallas.map((f) => f.symbol.replace(/USDT$/, "")).join(", ")}.` : ""}`
            : "Tus agentes del navegador: corren con la app abierta, sobre velas de Binance, con oro y plata."}
        </p>
        <div className="of-fondo">
          <div>
            <span className="of-fondo-titulo">Fondo simulado</span>
            <b className={`of-fondo-pnl ${oficina.fondo.netoUsd > 0 ? "of-sube" : oficina.fondo.netoUsd < 0 ? "of-baja" : ""}`}>{usdTxt(oficina.fondo.netoUsd, true)}</b>
            <span>
              {usdTxt(oficina.fondo.inicialUsd)} → {usdTxt(oficina.fondo.actualUsd)} · {oficina.fondo.retornoPct >= 0 ? "+" : ""}
              {oficina.fondo.retornoPct.toFixed(2).replace(".", ",")} %
              {oficina.fondo.maxCaidaPct !== null ? ` · peor caída ${oficina.fondo.maxCaidaPct.toFixed(2).replace(".", ",")} %` : ""} · {oficina.fondo.cierres} cierres
            </span>
          </div>
          <Curva puntos={oficina.fondo.curva} etiqueta="Curva del fondo simulado" />
          <small className="of-tenue">Ficticio: USD 1.000 por agente y 1 % de riesgo por operación sobre sus resultados de papel. No es dinero real.</small>
        </div>
        <label className="of-giro">
          Girar la vista
          <input type="range" min={-80} max={0} value={giro} onChange={(ev) => setGiro(Number(ev.target.value))} />
        </label>
        {estado === "cargando" && <p className="of-tenue">Leyendo los resultados de los agentes…</p>}
        {estado === "error" && <p className="of-tenue">No se pudieron leer los resultados: sin datos (no es cero).</p>}
        {estado === "listo" && plan === "CUENTA" && !datos?.sesion && <p className="of-tenue">Iniciá sesión para ver tus agentes. El servidor 24/7 se ve sin sesión.</p>}
        {oficina.incompleta && <p className="of-tenue">Se leyeron las últimas 1.000 entradas: lo más viejo no entra.</p>}
      </header>

      {/* Con más mesas el piso es más largo: se encuadra (encuadrarEscena) para que la pared, la sala y JARVIS entren siempre. */}
      <div ref={escenaRef} className="of-escena" style={{ ["--giro" as string]: `${giro}deg`, ["--filas" as string]: filas, ["--esc" as string]: Math.min(1, ESCENA_FILAS / filas) }}>
        <div className="of-piso">
          <span className="of-luz" style={{ ["--y" as string]: 3 }} aria-hidden="true" />
          <span className="of-luz" style={{ ["--y" as string]: filas - 5 }} aria-hidden="true" />
          <div className="of-pared of-pared-fondo">
            <Pizarra titulo="EN DIRECTO" filas={lineasDirecto} vacio="Sin posiciones abiertas" />
            <Pizarra titulo="MAPA DE LIQUIDACIONES" filas={lineasMapa(lecturas[0] ?? null)} vacio="Abrí el mapa: lo que lea aparece acá" />
            <Pizarra titulo="REUNIÓN DE LA SEMANA" filas={lineasReunion} vacio="Nadie cerró en 7 días" />
            <Arana activa={elegido === "ARANA"} elegir={() => setElegido(elegido === "ARANA" ? null : "ARANA")} falla={plan === "SERVIDOR" && fallas.length > 0} />
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
                  <span className={`of-monitor${e.total.muestra === "MINIMA" ? " of-monitor-poca" : ""}`} title="Acierto">{e.total.winRate === null ? "—" : `${Math.round(e.total.winRate * 100)}%`}</span>
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
            <Holograma puntos={oficina.fondo.curva} activo={elegido === "JARVIS"} elegir={() => setElegido(elegido === "JARVIS" ? null : "JARVIS")} />
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
                {elegidoE.total.intervalo && <small> ({pct(elegidoE.total.intervalo.low)} a {pct(elegidoE.total.intervalo.high)})</small>}
                {elegidoE.total.muestra === "MINIMA" && <small> muestra mínima</small>}
              </dd>
            </div>
            <div><dt>Factor de ganancia</dt><dd>{n2(elegidoE.total.profitFactor)}</dd></div>
            <div><dt>Por operación</dt><dd>{r2(elegidoE.total.expectancia)}</dd></div>
            <div><dt>Semana</dt><dd>{elegidoE.semana.cerradas ? `${r2(elegidoE.semana.neto)} · n=${elegidoE.semana.cerradas}` : "sin cierres"}</dd></div>
            <div>
              <dt>PnL simulado</dt>
              <dd className={elegidoE.capital.netoUsd > 0 ? "of-sube" : elegidoE.capital.netoUsd < 0 ? "of-baja" : ""}>{usdTxt(elegidoE.capital.netoUsd, true)}</dd>
            </div>
          </dl>
          <Curva puntos={elegidoE.capital.curva} etiqueta={`Capital simulado de ${elegidoE.agente}`} />
          {elegidoE.abiertas.length > 0 && (
            <div className="of-abiertas">
              <span>Abiertas</span>
              {elegidoE.abiertas.map((a) => (
                <button key={`${a.symbol}-${a.detectada}`} type="button" className={a.lado === "LONG" ? "of-sube" : "of-baja"} onClick={() => openInMap(a.symbol, "4h")} title="Ver la posición y sus niveles en el mapa de liquidaciones">
                  {nombreActivo(a.symbol)} {a.lado === "LONG" ? "▲" : "▼"} · VER EN EL MAPA
                </button>
              ))}
            </div>
          )}
          <div className="of-mirar">
            <span>Mirar en el mapa</span>
            {universoDe(elegidoE.id).map((sym) => (
              <button key={sym} type="button" onClick={() => openInMap(sym, "4h")} title={`Abrir ${nombreActivo(sym)} en el mapa de liquidaciones, con las posiciones de los agentes y la mesa de flujo`}>
                {nombreActivo(sym)}
                {lecturas.some((l) => l.symbol === sym) ? <i aria-label="leído hace poco"> ●</i> : null}
              </button>
            ))}
          </div>
          {frases.filter((f) => f.quien === elegidoE.id).map((f) => <p key={f.texto} className="of-dice">«{f.texto}»</p>)}
          <h5 className="of-ficha-sub">Lo que sabe (conocimiento profesional)</h5>
          <div className="of-saber">
            {conocimientoDe(elegidoE.id, elegidoE.mesa).map((k) => (
              <details key={k.id}>
                <summary>
                  <b>{k.title}</b> {k.summary}
                </summary>
                <p>{k.detail}</p>
                {k.caveat && <p className="of-cuidado">Cuidado: {k.caveat}</p>}
              </details>
            ))}
          </div>
          <h5 className="of-ficha-sub">Cómo se ve</h5>
          <p className="of-dice">«{elegidoE.conciencia}»</p>
          <h5 className="of-ficha-sub">Lo que aprendió</h5>
          <ul className="of-lecciones">
            {elegidoE.lecciones.map((l) => (
              <li key={l.tema}>
                {l.texto} <span className={l.firme ? "of-firme" : "of-floja"}>{l.firme ? "firme" : "todavía no firme"}</span>
              </li>
            ))}
          </ul>
          {bloqueChat(personaAgente(elegidoE))}
          <small>Papel, velas de 4 h{plan === "SERVIDOR" ? " de Kraken" : ""}. No es asesoramiento financiero.</small>
        </article>
      )}

      {elegido === "JARVIS" && (
        <article className="of-ficha of-ficha-jarvis" aria-live="polite">
          <header>
            <b>JARVIS</b>
            <span>Coordina la oficina</span>
          </header>
          <p>Ve a todos los agentes, el fondo simulado y lo que aprenden. No opera ni cambia reglas: informa y te propone.</p>
          <dl>
            <div><dt>Fondo simulado</dt><dd>{usdTxt(oficina.fondo.actualUsd)}</dd></div>
            <div><dt>PnL</dt><dd className={oficina.fondo.netoUsd > 0 ? "of-sube" : oficina.fondo.netoUsd < 0 ? "of-baja" : ""}>{usdTxt(oficina.fondo.netoUsd, true)}</dd></div>
            <div><dt>Peor caída</dt><dd>{oficina.fondo.maxCaidaPct === null ? "—" : `${oficina.fondo.maxCaidaPct.toFixed(2).replace(".", ",")} %`}</dd></div>
            <div><dt>Agentes con cierres</dt><dd>{oficina.ranking.length} de {oficina.escritorios.length}</dd></div>
            <div><dt>Propuestas para vos</dt><dd>{propias.length}</dd></div>
          </dl>
          <Curva puntos={oficina.fondo.curva} ancho={320} alto={80} etiqueta="Curva del fondo simulado" />
          <p className="of-dice">«{oficina.aprendizaje.texto}»</p>
          {bloqueChat(personaJarvis())}
          <small>El fondo es ficticio: USD 1.000 por agente y 1 % de riesgo por operación. No es asesoramiento financiero.</small>
        </article>
      )}

      {elegido === "ARANA" && (
        <article className="of-ficha" aria-live="polite">
          <header>
            <b>La araña</b>
            <span>Vigila la red</span>
          </header>
          {plan === "SERVIDOR" ? (
            <>
              <p>Cada vela de 4 h el servidor recorre las monedas de a una. Así salió la última vuelta de cada una:</p>
              {(datos?.servidor?.estado ?? []).length ? (
                <ul className="of-lecciones">
                  {[...(datos?.servidor?.estado ?? [])].sort((a, b) => a.symbol.localeCompare(b.symbol)).map((e) => (
                    <li key={e.symbol}>
                      <b>{nombreActivo(e.symbol)}</b> · {new Date(e.at).toLocaleString("es-AR")} ·{" "}
                      {e.error ? <span className="of-baja">no respondió ({e.error})</span> : `${e.venue === "KRAKEN" ? "Kraken" : e.venue}: ${e.registradas} entradas nuevas, ${e.avanzadas} avances`}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="of-tenue">Todavía no corrió ninguna vuelta: la primera es al cerrar la próxima vela de 4 h.</p>
              )}
            </>
          ) : (
            <p>En tu cuenta, la red la teje tu navegador: los agentes corren mientras la app está abierta y visible.</p>
          )}
        </article>
      )}

      <div className="of-tabla-caja">
        <h4>Acierto de cada uno</h4>
        <p className="of-tenue">Ordenado por el piso del intervalo del 90 %: premia la muestra, no la suerte. Con menos de 15 cierres, muestra mínima.</p>
        {oficina.ranking.length ? (
          <table className="of-tabla">
            <thead>
              <tr><th>Agente</th><th>Cierres</th><th>Acierto (IC 90 %)</th><th>PF</th><th>Por op.</th><th>PnL simulado</th></tr>
            </thead>
            <tbody>
              {oficina.ranking.map((e) => (
                <tr key={e.id} className={e.total.muestra === "MINIMA" ? "of-fila-poca" : ""} onClick={() => setElegido(e.id)}>
                  <td>{nombreCorto(e.agente)}</td>
                  <td>{e.total.cerradas}</td>
                  <td>
                    {pct(e.total.winRate)}
                    {e.total.intervalo ? ` (${pct(e.total.intervalo.low)}–${pct(e.total.intervalo.high)})` : ""}
                  </td>
                  <td>{n2(e.total.profitFactor)}</td>
                  <td>{r2(e.total.expectancia)}</td>
                  <td className={e.capital.netoUsd > 0 ? "of-sube" : e.capital.netoUsd < 0 ? "of-baja" : ""}>{usdTxt(e.capital.netoUsd, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="of-tenue">Nadie cerró todavía: el acierto aparece con el primer cierre.</p>
        )}
        <p className="of-tenue">{oficina.escritorios.length - oficina.ranking.length} agentes todavía sin cierres.</p>
      </div>

      <div className="of-tabla-caja of-diario">
        <h4>Diario de aprendizaje</h4>
        <p className="of-tenue">
          Cada día (de Argentina) los agentes cuentan qué cerraron y qué dice todo su registro según el mapa de liquidaciones al entrar:
          con o sin zona detrás del stop, con el camino libre o con una zona en el medio, con el stop lejos o junto a liquidez sin barrer.
          Firme recién con 15 cierres de cada lado. Aprender es medir: ninguna regla cambia sola.
        </p>
        {diarios.length ? (
          <>
            <div className="of-dias" role="tablist" aria-label="Día del diario">
              {diarios.map((d) => (
                <button key={d.dia} type="button" role="tab" aria-selected={diaSel?.dia === d.dia} onClick={() => setDiaElegido(d.dia)}>
                  <span>{fechaDia(d.dia)}</span>
                  <b className={d.delDia.netoR > 0 ? "of-sube" : d.delDia.netoR < 0 ? "of-baja" : ""}>{d.delDia.cierres ? r2(d.delDia.netoR) : "—"}</b>
                  <small>{d.delDia.cierres} {d.delDia.cierres === 1 ? "cierre" : "cierres"}</small>
                </button>
              ))}
            </div>
            {diaSel && (
              <>
                <p>
                  <b>{fechaDia(diaSel.dia)}:</b> {resumenDia(diaSel)}
                </p>
                <div className="of-tabla-scroll">
                  <table className="of-tabla of-comparar">
                    <thead>
                      <tr><th>Lo que mira</th><th>Sí</th><th>No</th><th>Estado</th></tr>
                    </thead>
                    <tbody>
                      {diaSel.comparaciones.map((c) => (
                        <tr key={c.tema}>
                          <td>{c.si.etiqueta}</td>
                          <td>{pct(c.si.est.winRate)} · {r2(c.si.est.expectancia)} <small>n={c.si.est.cerradas}</small></td>
                          <td>{pct(c.no.est.winRate)} · {r2(c.no.est.expectancia)} <small>n={c.no.est.cerradas}</small></td>
                          <td className={c.firme ? "of-firme-txt" : "of-tenue"}>{c.firme ? (c.separados ? "firme · se separan" : "firme · todavía se pisan") : "todavía no firme"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {diaSel.novedades.length > 0 && (
                  <ul className="of-lecciones">
                    {diaSel.novedades.map((n) => <li key={n}>{n}</li>)}
                  </ul>
                )}
                <p className="of-tenue">
                  {diaSel.conFoto} de {diaSel.total.cerradas} cierres tienen foto del mapa (las entradas anteriores al 21/10/2026 no la tienen). Comparar no es
                  probar una causa. No es asesoramiento financiero.
                </p>
              </>
            )}
          </>
        ) : (
          <p className="of-tenue">{estado === "cargando" ? "Leyendo el diario…" : "Sin datos para armar el diario (no es cero)."}</p>
        )}
      </div>

      {oficina.conversaciones.length > 0 && (
        <div className="of-tabla-caja">
          <h4>Conversaciones entre ellos</h4>
          {oficina.conversaciones.map((d) => (
            <div key={d.tema + d.lineas[0].texto} className="of-dialogo">
              <b className="of-dialogo-tema">{d.tema}</b>
              {d.lineas.map((l, k) => (
                <p key={k} className={`of-msg ${k % 2 ? "of-msg-vos" : "of-msg-agente"}`}>
                  <b>{l.nombre}:</b> {l.texto}
                </p>
              ))}
            </div>
          ))}
        </div>
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
            <ul>
              {enDirecto.slice(0, 12).map(({ e, a }) => (
                <li key={`${e.id}-${a.symbol}-${a.detectada}`}>
                  {nombreCorto(e.agente)} · {nombreActivo(a.symbol)} {a.lado === "LONG" ? "▲ largo" : "▼ corto"}{" "}
                  <button type="button" className="of-link" onClick={() => openInMap(a.symbol, "4h")}>
                    ver en el mapa
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="of-tenue">Sin posiciones abiertas.</p>
          )}
        </div>
        <div>
          <h4>Lo que aprenden entre ellos</h4>
          <p>{oficina.aprendizaje.texto}</p>
          <p className="of-tenue">Cada agente decide solo, con su regla. Aprenden todo el tiempo: sus lecciones se recalculan con cada cierre. Lo que no hacen es cambiarse la regla solos; eso lo aprobás vos.</p>
        </div>
      </div>
    </section>
  );
}
