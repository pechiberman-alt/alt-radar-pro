"use client";

/**
 * La oficina 3D del fondo: los agentes de papel en sus escritorios, en mesas de cristal (tendencia, reversión, estructura,
 * flujo de órdenes y metales), con pantallas en la pared (posiciones abiertas, mapa de liquidaciones y reunión de la semana) y una
 * sala de reuniones con JARVIS. Cada escritorio tiene dos monitores: el acierto y el profit factor del agente en papel (o los de su
 * historial, marcados H, mientras no cierre nada). Se acerca con zoom (botones, pellizco o Ctrl + rueda) y se recorre arrastrando.
 * Los agentes «hablan»: cada globo es una frase armada con un dato (lib/oficina.ts, charla), nunca inventada. Cada uno se mide
 * con su regla sola y con el mapa (lib/confluencia.ts). Los números salen del registro unificado por agente y se leen una vez al
 * abrir. La escena es CSS 3D; el movimiento es decorativo y se apaga con «reducir movimiento». Solo papel.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { textoHistorial } from "../lib/oficina-historial.ts";
import type { Estadistica } from "../lib/registro.ts";
import type { Veredicto } from "../lib/confluencia.ts";
import { forAi } from "../lib/ai-numbers.ts";
import { ESTRATEGIAS, operaEn } from "../lib/estrategias.ts";
import { conocimientoDe, conocimientoParaIa, respuestaConcepto } from "../lib/agentes-conocimiento.ts";
import { armarOficina, charla, MESAS, nombreActivo, oficinaParaIa, propuestas, tituloSemana, usdTxt, type Escritorio, type FilaOficina, type Frase, type MesaId, type Oficina } from "../lib/oficina.ts";
import { diaAr, diarioParaIa, leerDiario, resumenDia, ultimosDiarios, type Diario } from "../lib/aprendizaje-diario.ts";
import { MONEDAS_SERVIDOR, PLAN_SERVIDOR } from "../lib/agentes-servidor.ts";
import { openInMap } from "../lib/account-events.ts";
import { lecturaMapa, lecturaParaIa, lecturasMapa, onLecturaMapa, type LecturaMapa } from "../lib/mapa-memoria.ts";
import MiniArana from "./lab-mini-arana";
import SalaMentes from "./sala-mentes";

type Plan = "SERVIDOR" | "CUENTA";
type EstadoMoneda = { symbol: string; at: number; venue: string | null; registradas: number; avanzadas: number; error: string | null };
type Respuesta = { servidor: { filas: FilaOficina[]; estado: EstadoMoneda[] } | null; cuenta: FilaOficina[] | null; sesion: boolean; diarios?: unknown[] };
type Linea = { de: "vos" | "agente"; texto: string; cerebro?: string };

/** Escritorios por fila dentro de cada mesa de cristal, y la separación entre ellos (en unidades del piso). */
const POR_FILA = 3;
const PASO_X = 1.55;
const PASO_Y = 1.7;
/** Las mesas van en columnas: más cuadrado el piso, más grande entra en la pantalla. */
const COLUMNAS = 3;
const ANCHO_POD = POR_FILA * PASO_X + 0.8;
const CABEZA_POD = 1.05;
const SEPARACION = 0.8;
/** Color de cada mesa (r, g, b): el cristal, el cartel y la tarjeta del tablero. */
const COLOR_MESA: Record<MesaId, string> = { TENDENCIA: "59,130,246", REVERSION: "168,85,247", ESTRUCTURA: "34,211,238", FLUJO: "52,211,153", METALES: "242,184,75" };
const ZOOM_MAX = 4;
/** Desde este zoom se ven las etiquetas con el nombre y los números de cada agente. */
const ZOOM_CERCA = 2.2;
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
type Pod = { mesa: MesaId; x: number; y: number; ancho: number; alto: number };

/** Lo que muestran los dos monitores: el acierto y el PF en papel; sin cierres, los de su historial (H); sin nada, una raya. */
function monitores(e: Escritorio): { tipo: "papel" | "hist" | "nada"; acierto: string; pf: string } {
  // Con menos de 15 operaciones el número lleva un asterisco: muestra mínima.
  const poca = (n: number) => (n < 15 ? "*" : "");
  if (e.total.cerradas > 0) return { tipo: "papel", acierto: e.total.winRate === null ? "—" : `${Math.round(e.total.winRate * 100)}%${poca(e.total.cerradas)}`, pf: n2(e.total.profitFactor) };
  const h = e.historial;
  if (h && h.operaciones > 0) return { tipo: "hist", acierto: h.winRate === null ? "—" : `${Math.round(h.winRate * 100)}%${poca(h.operaciones)}`, pf: n2(h.profitFactor) };
  return { tipo: "nada", acierto: "—", pf: "—" };
}
/** Una estadística del registro en una línea: acierto, PF, R por operación y muestra; sin cierres, lo dice. */
const lineaEst = (t: Estadistica) =>
  t.cerradas === 0 ? "sin cierres" : `${pct(t.winRate)} · PF ${n2(t.profitFactor)} · ${r2(t.expectancia)} · n=${t.cerradas}${t.cerradas < 15 ? " (muestra mínima)" : ""}`;
const TEXTO_V: Record<Veredicto, string> = { A_FAVOR: "mapa a favor", NEUTRA: "mapa neutro", EN_CONTRA: "mapa en contra" };

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
  // Se mide sin zoom: el zoom va encima (lib/useZoomEscena) y se vuelve a poner al terminar.
  const zoomAntes = ["--zoom", "--px", "--py"].map((k) => [k, escena.style.getPropertyValue(k)] as const);
  escena.style.setProperty("--zoom", "1");
  escena.style.setProperty("--px", "0px");
  escena.style.setProperty("--py", "0px");
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
  for (const [k, v] of zoomAntes) if (v) escena.style.setProperty(k, v);
}

/**
 * El zoom de la escena: la cámara (una capa 2D por encima de la perspectiva) se agranda y se corre sin volver a dibujar la
 * oficina. Botones, pellizco con dos dedos, Ctrl + rueda (el pellizco del touchpad) y doble toque en el piso. Con zoom, un dedo
 * o el mouse arrastran la vista; sin zoom, un dedo hace scroll de la página como siempre. El punto bajo los dedos queda quieto.
 */
function useZoomEscena(escenaRef: RefObject<HTMLDivElement | null>) {
  const estado = useRef({ zoom: 1, px: 0, py: 0 });
  const arrastro = useRef(false);
  const etiqueta = useRef<HTMLSpanElement | null>(null);
  const [cerca, setCerca] = useState(false);
  const [activo, setActivo] = useState(false);

  const aplicar = useCallback(
    (zoom: number, px: number, py: number) => {
      const el = escenaRef.current;
      if (!el) return;
      const z = Math.min(ZOOM_MAX, Math.max(1, zoom));
      // No se puede correr la vista más allá del borde de la oficina agrandada.
      const limX = (el.clientWidth / 2) * (z - 1);
      const limY = (el.clientHeight / 2) * (z - 1);
      const x = Math.max(-limX, Math.min(limX, px));
      const y = Math.max(-limY, Math.min(limY, py));
      estado.current = { zoom: z, px: x, py: y };
      el.style.setProperty("--zoom", z.toFixed(3));
      el.style.setProperty("--px", `${x.toFixed(1)}px`);
      el.style.setProperty("--py", `${y.toFixed(1)}px`);
      if (etiqueta.current) etiqueta.current.textContent = `${Math.round(z * 100)} %`;
      setCerca(z >= ZOOM_CERCA);
      setActivo(z > 1.01);
    },
    [escenaRef],
  );

  const zoomEn = useCallback(
    (nuevo: number, cx?: number, cy?: number) => {
      const el = escenaRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const ox = r.left + r.width / 2;
      const oy = r.top + r.height / 2;
      const ax = cx ?? ox;
      const ay = cy ?? oy;
      const { zoom, px, py } = estado.current;
      const z = Math.min(ZOOM_MAX, Math.max(1, nuevo));
      aplicar(z, ax - ox - (z * (ax - ox - px)) / zoom, ay - oy - (z * (ay - oy - py)) / zoom);
    },
    [aplicar, escenaRef],
  );

  useEffect(() => {
    const el = escenaRef.current;
    if (!el) return;
    const dedos = new Map<number, { x: number; y: number }>();
    let base: { zoom: number; px: number; py: number; x: number; y: number; dist: number } | null = null;
    let movido = 0;
    let ultimoToque = { t: 0, x: 0, y: 0 };
    const empezar = () => {
      const ps = [...dedos.values()];
      const { zoom, px, py } = estado.current;
      if (ps.length === 1) base = { zoom, px, py, x: ps[0].x, y: ps[0].y, dist: 0 };
      else if (ps.length >= 2) base = { zoom, px, py, x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2, dist: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) };
    };
    const abajo = (ev: PointerEvent) => {
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      dedos.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (dedos.size === 1) {
        movido = 0;
        arrastro.current = false;
      }
      empezar();
    };
    const mueve = (ev: PointerEvent) => {
      if (!dedos.has(ev.pointerId) || !base) return;
      dedos.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      const ps = [...dedos.values()];
      if (ps.length >= 2 && base.dist > 0) {
        const r = el.getBoundingClientRect();
        const ox = r.left + r.width / 2;
        const oy = r.top + r.height / 2;
        const mx = (ps[0].x + ps[1].x) / 2;
        const my = (ps[0].y + ps[1].y) / 2;
        const z = Math.min(ZOOM_MAX, Math.max(1, base.zoom * (Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) / base.dist)));
        const ux = (base.x - ox - base.px) / base.zoom;
        const uy = (base.y - oy - base.py) / base.zoom;
        aplicar(z, mx - ox - z * ux, my - oy - z * uy);
        arrastro.current = true;
        return;
      }
      const dx = ev.clientX - base.x;
      const dy = ev.clientY - base.y;
      movido = Math.max(movido, Math.hypot(dx, dy));
      if (movido > 6 && estado.current.zoom > 1.01) {
        if (!arrastro.current) el.setPointerCapture?.(ev.pointerId);
        arrastro.current = true;
        aplicar(base.zoom, base.px + dx, base.py + dy);
      }
    };
    const arriba = (ev: PointerEvent) => {
      if (!dedos.has(ev.pointerId)) return;
      dedos.delete(ev.pointerId);
      if (dedos.size) {
        empezar();
        return;
      }
      base = null;
      // Doble toque en el piso (no en un escritorio): acerca ahí, o vuelve a la vista entera.
      const enBoton = (ev.target as Element | null)?.closest?.("button");
      if (ev.pointerType !== "mouse" && movido <= 6 && !enBoton) {
        if (ev.timeStamp - ultimoToque.t < 320 && Math.hypot(ev.clientX - ultimoToque.x, ev.clientY - ultimoToque.y) < 30) {
          zoomEn(estado.current.zoom < 1.5 ? 2.2 : 1, ev.clientX, ev.clientY);
          ultimoToque = { t: 0, x: 0, y: 0 };
        } else ultimoToque = { t: ev.timeStamp, x: ev.clientX, y: ev.clientY };
      }
    };
    const doble = (ev: MouseEvent) => {
      if ((ev.target as Element | null)?.closest?.("button")) return;
      zoomEn(estado.current.zoom < 1.5 ? 2.2 : 1, ev.clientX, ev.clientY);
    };
    const rueda = (ev: WheelEvent) => {
      if (!ev.ctrlKey && !ev.metaKey) return;
      ev.preventDefault();
      zoomEn(estado.current.zoom * Math.exp(-ev.deltaY * 0.01), ev.clientX, ev.clientY);
    };
    el.addEventListener("pointerdown", abajo);
    el.addEventListener("pointermove", mueve);
    window.addEventListener("pointerup", arriba);
    window.addEventListener("pointercancel", arriba);
    el.addEventListener("dblclick", doble);
    el.addEventListener("wheel", rueda, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", abajo);
      el.removeEventListener("pointermove", mueve);
      window.removeEventListener("pointerup", arriba);
      window.removeEventListener("pointercancel", arriba);
      el.removeEventListener("dblclick", doble);
      el.removeEventListener("wheel", rueda);
    };
  }, [aplicar, zoomEn, escenaRef]);

  const acercar = useCallback(() => zoomEn(estado.current.zoom * 1.5), [zoomEn]);
  const alejar = useCallback(() => zoomEn(estado.current.zoom / 1.5), [zoomEn]);
  const entera = useCallback(() => aplicar(1, 0, 0), [aplicar]);
  return { cerca, activo, arrastro, etiqueta, acercar, alejar, entera };
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

/**
 * Ubica las mesas de cristal en columnas (la más grande primero, en la columna más corta) y a cada agente en su escritorio. La
 * sala de reuniones va al frente de la columna que queda más corta. Las medidas van en unidades del piso.
 */
function ubicar(escritorios: Escritorio[]): { puestos: Puesto[]; pods: Pod[]; ancho: number; largo: number; sala: { x: number; y: number; ancho: number; alto: number } } {
  const puestos: Puesto[] = [];
  const pods: Pod[] = [];
  const alturas = Array.from({ length: COLUMNAS }, () => 1.3);
  const grupos = MESAS.map((m) => ({ mesa: m.id, suyos: escritorios.filter((e) => e.mesa === m.id) })).filter((g) => g.suyos.length);
  for (const g of [...grupos].sort((x, y) => y.suyos.length - x.suyos.length)) {
    const c = alturas.indexOf(Math.min(...alturas));
    const filas = Math.ceil(g.suyos.length / POR_FILA);
    const x = 0.7 + c * (ANCHO_POD + SEPARACION);
    const y = alturas[c];
    const alto = CABEZA_POD + filas * PASO_Y + 0.25;
    pods.push({ mesa: g.mesa, x, y, ancho: ANCHO_POD, alto });
    g.suyos.forEach((e, k) => puestos.push({ e, x: x + 0.55 + (k % POR_FILA) * PASO_X, y: y + CABEZA_POD + Math.floor(k / POR_FILA) * PASO_Y }));
    alturas[c] = y + alto + SEPARACION;
  }
  const ancho = 1.4 + COLUMNAS * ANCHO_POD + (COLUMNAS - 1) * SEPARACION;
  const cs = alturas.indexOf(Math.min(...alturas));
  const sala = { x: 0.7 + cs * (ANCHO_POD + SEPARACION), y: alturas[cs] - 0.2, ancho: ANCHO_POD, alto: 3.2 };
  const largo = Math.max(...alturas, sala.y + sala.alto + 0.9);
  return { puestos, pods, ancho, largo, sala };
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
  const [orden, setOrden] = useState<"MESA" | "ACIERTO" | "PF" | "HISTORIAL">("MESA");

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

  const { puestos, pods, ancho, largo, sala } = useMemo(() => ubicar(oficina.escritorios), [oficina.escritorios]);
  // El encuadre se mide en la pantalla (la perspectiva y el giro cambian lo que ocupa el piso): al dibujar, al girar y al
  // cambiar el tamaño. Escribe dos variables CSS en la escena; no hay estado de React que vuelva a dibujar.
  const escenaRef = useRef<HTMLDivElement>(null);
  const { cerca: zoomCerca, activo: zoomActivo, arrastro, etiqueta: etiquetaZoom, acercar, alejar, entera } = useZoomEscena(escenaRef);
  useLayoutEffect(() => {
    const escena = escenaRef.current;
    if (!escena) return;
    const encuadrar = () => encuadrarEscena(escena);
    encuadrar();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(encuadrar);
    ro.observe(escena);
    return () => ro.disconnect();
  }, [ancho, largo, giro, estado]);
  const frases = charla(oficina);
  const propias = propuestas(oficina);
  // Lo que se oye en la oficina: lo que dice cada uno y lo que se dicen entre ellos.
  const hablan: Frase[] = [
    ...frases.filter((f) => f.quien !== "JARVIS"),
    ...oficina.conversaciones.flatMap((d) => d.lineas.map((l) => ({ quien: l.quien, nombre: l.nombre, texto: l.texto, tipo: "acuerdo" as const }))),
  ];
  const actual: Frase | null = hablan.length ? hablan[turno % hablan.length] : null;
  const elegidoE = oficina.escritorios.find((e) => e.id === elegido) ?? null;
  // El tablero: cada agente con su papel, su versión con el mapa y su historial. Sin dato, al final (desconocido no es cero).
  const ordenMesa = (e: Escritorio) => MESAS.findIndex((m) => m.id === e.mesa);
  const tablero = [...oficina.escritorios].sort((a, b) => {
    const nulos = (x: number | null | undefined, y: number | null | undefined) => (x === null || x === undefined ? (y === null || y === undefined ? 0 : 1) : y === null || y === undefined ? -1 : y - x);
    if (orden === "ACIERTO") return nulos(a.total.cerradas ? a.total.winRate : null, b.total.cerradas ? b.total.winRate : null) || b.total.cerradas - a.total.cerradas;
    if (orden === "PF") return nulos(a.total.cerradas ? a.total.profitFactor : null, b.total.cerradas ? b.total.profitFactor : null) || b.total.cerradas - a.total.cerradas;
    if (orden === "HISTORIAL") return nulos(a.historial?.profitFactor, b.historial?.profitFactor);
    return ordenMesa(a) - ordenMesa(b) || a.agente.localeCompare(b.agente);
  });
  const enDirecto = oficina.escritorios.flatMap((e) => e.abiertas.map((a) => ({ e, a }))).sort((x, y) => y.a.detectada - x.a.detectada);
  const lineasDirecto = enDirecto.slice(0, 7).map(({ e, a }) => `${nombreCorto(e.agente)} · ${nombreActivo(a.symbol)} ${a.lado === "LONG" ? "▲" : "▼"}`);
  const lineasReunion = oficina.reunion.slice(0, 7).map((e) => `${nombreCorto(e.agente)} · ${r2(e.semana.neto)} · n=${e.semana.cerradas}`);
  const mejor = oficina.reunion[0] ?? null;

  return (
    <section className="of" aria-labelledby="of-titulo">
      <header className="of-cabecera">
        <h3 id="of-titulo" className="lab-sub">La oficina del fondo</h3>
        <p>
          Cada agente en su escritorio, en cinco mesas de cristal, con su acierto y su profit factor en los monitores. Cada uno opera con
          su regla y, además, con el mapa de liquidaciones y el flujo de órdenes: si los tiene en contra, esa versión no entra. Las dos se
          miden en papel para saber si mirar el mapa los hace mejores. Tocá un escritorio para ver su ficha.
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

      {/* Las mesas van en columnas y la escena se encuadra midiendo (encuadrarEscena); el zoom va por encima (useZoomEscena). */}
      <div
        ref={escenaRef}
        className={`of-escena${zoomCerca ? " of-cerca" : ""}${zoomActivo ? " of-zoom" : ""}`}
        style={{ ["--giro" as string]: `${giro}deg`, ["--ancho" as string]: ancho, ["--largo" as string]: largo }}
      >
        <div className="of-camara">
          <div className="of-piso">
            <div className="of-pared of-pared-fondo">
              <Pizarra titulo="EN DIRECTO" filas={lineasDirecto} vacio="Sin posiciones abiertas" />
              <Pizarra titulo="MAPA DE LIQUIDACIONES" filas={lineasMapa(lecturas[0] ?? null)} vacio="Abrí el mapa: lo que lea aparece acá" />
              <Pizarra titulo="REUNIÓN DE LA SEMANA" filas={lineasReunion} vacio="Nadie cerró en 7 días" />
              <Arana activa={elegido === "ARANA"} elegir={() => setElegido(elegido === "ARANA" ? null : "ARANA")} falla={plan === "SERVIDOR" && fallas.length > 0} />
            </div>
            {pods.map((p) => {
              const suyos = oficina.escritorios.filter((e) => e.mesa === p.mesa);
              const abiertas = suyos.reduce((n, e) => n + e.abiertas.length, 0);
              const cierres = suyos.reduce((n, e) => n + e.total.cerradas, 0);
              return (
                <div key={p.mesa} className="of-pod" style={{ ["--x" as string]: p.x, ["--y" as string]: p.y, ["--w" as string]: p.ancho, ["--h" as string]: p.alto, ["--c" as string]: COLOR_MESA[p.mesa] }}>
                  <span className="of-pod-luz" aria-hidden="true" />
                  <span className="of-vidrio of-vidrio-fondo" aria-hidden="true" />
                  <span className="of-vidrio of-vidrio-lado" aria-hidden="true" />
                  <span className="of-vidrio of-vidrio-lado of-vidrio-der" aria-hidden="true" />
                  <span className="of-pod-cartel">
                    <span>
                      <b>{MESAS.find((m) => m.id === p.mesa)?.nombre}</b>
                      <small>
                        {suyos.length} {suyos.length === 1 ? "agente" : "agentes"} · {abiertas} {abiertas === 1 ? "abierta" : "abiertas"} · {cierres} {cierres === 1 ? "cierre" : "cierres"}
                      </small>
                    </span>
                  </span>
                </div>
              );
            })}
            <Planta x={0.1} y={0.45} />
            <Planta x={ancho - 0.6} y={0.45} />
            <Planta x={ancho - 0.6} y={largo - 0.9} />
            {puestos.map(({ e, x, y }) => {
              const habla = actual?.quien === e.id;
              const visible = habla || elegido === e.id;
              const m = monitores(e);
              return (
                <button
                  key={e.id}
                  type="button"
                  className={`of-puesto of-pant-${pantalla(e)}${elegido === e.id ? " of-activo" : ""}${habla ? " of-habla" : ""}`}
                  style={{ ["--x" as string]: x, ["--y" as string]: y, ["--c" as string]: COLOR_MESA[e.mesa] }}
                  aria-pressed={elegido === e.id}
                  aria-label={`${e.agente}: ${m.tipo === "nada" ? "sin cierres" : `${m.tipo === "hist" ? "historial, " : ""}acierto ${m.acierto}, profit factor ${m.pf}`}, ${e.abiertas.length} abiertas`}
                  onClick={() => {
                    if (arrastro.current) return;
                    setElegido(elegido === e.id ? null : e.id);
                  }}
                >
                  <span className="of-mueble">
                    <span className="of-tapa" />
                    <span className="of-frente" />
                    <span className="of-lado" />
                    <span className={`of-pantallas of-m-${m.tipo}`}>
                      <span className="of-pantalla">
                        <small>{m.tipo === "hist" ? "H · ACIERTO" : "ACIERTO"}</small>
                        {m.acierto}
                      </span>
                      <span className="of-pantalla">
                        <small>{m.tipo === "hist" ? "H · PF" : "PF"}</small>
                        {m.pf}
                      </span>
                    </span>
                  </span>
                  <span className="of-parado">
                    <span className="of-silla" aria-hidden="true" />
                    <Persona tonoCamisa={tono(e)} />
                    {visible ? (
                      <span className={`of-globo${habla ? "" : " of-globo-nombre"}`}>
                        <b>{nombreCorto(e.agente)}</b>
                        {habla && actual ? <span>{actual.texto}</span> : null}
                      </span>
                    ) : (
                      <span className="of-etiqueta" aria-hidden="true">
                        <b>{nombreCorto(e.agente)}</b>
                        <span>{m.tipo === "nada" ? "sin cierres" : `${m.tipo === "hist" ? "H " : ""}${m.acierto} · PF ${m.pf}`}</span>
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
            <div className="of-sala" style={{ ["--x" as string]: sala.x, ["--y" as string]: sala.y, ["--w" as string]: sala.ancho, ["--h" as string]: sala.alto }}>
              <span className="of-vidrio of-vidrio-fondo" aria-hidden="true" />
              <span className="of-vidrio of-vidrio-lado" aria-hidden="true" />
              <span className="of-vidrio of-vidrio-lado of-vidrio-der" aria-hidden="true" />
              <span className="of-mesa-redonda" />
              <Holograma puntos={oficina.fondo.curva} activo={elegido === "JARVIS"} elegir={() => setElegido(elegido === "JARVIS" ? null : "JARVIS")} />
              {oficina.reunion.slice(0, 4).map((e, k) => (
                <span key={e.id} className="of-parado of-silla-sala" style={{ ["--k" as string]: k }}>
                  <Persona tonoCamisa={tono(e)} />
                </span>
              ))}
              <span className="of-sala-nombre">Sala de reuniones</span>
            </div>
          </div>
        </div>
        {actual && (
          <p className="of-subtitulo" aria-live="polite">
            <b>{actual.nombre}:</b> {actual.texto}
          </p>
        )}
        <div className="of-zoom-controles" role="group" aria-label="Zoom de la oficina">
          <button type="button" onClick={alejar} aria-label="Alejar">
            −
          </button>
          <span ref={etiquetaZoom}>100 %</span>
          <button type="button" onClick={acercar} aria-label="Acercar">
            +
          </button>
          <button type="button" onClick={entera} aria-label="Ver la oficina entera" title="Ver la oficina entera">
            ⤢
          </button>
        </div>
      </div>
      <p className="of-tenue of-pista">
        Acercate con + o pellizcando (en la compu, Ctrl + rueda o doble clic en el piso) y arrastrá para recorrer. En los monitores: acierto y
        profit factor en papel; con H, los de su historial en 4 h mientras no cierre nada; con *, menos de 15 operaciones (muestra mínima).
      </p>

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
            <div className="of-ficha-ancha">
              <dt>Con el mapa y el flujo</dt>
              <dd>
                {lineaEst(elegidoE.conMapa)}
                <small>
                  {" "}
                  · {elegidoE.frenadas.cerradas} {elegidoE.frenadas.cerradas === 1 ? "frenada" : "frenadas"}
                  {elegidoE.frenadas.cerradas ? ` (${r2(elegidoE.frenadas.expectancia)} por op.)` : ""} · {elegidoE.conVeredicto} con las dos fotos
                </small>
              </dd>
            </div>
            <div className="of-ficha-ancha">
              <dt>Historial 4 h (estudio)</dt>
              <dd>{textoHistorial(elegidoE.historial)}</dd>
            </div>
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
                  {nombreActivo(a.symbol)} {a.lado === "LONG" ? "▲" : "▼"}
                  {a.veredicto ? ` · ${TEXTO_V[a.veredicto]}` : ""} · VER EN EL MAPA
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

      <div className="of-tablero-caja">
        <div className="of-tablero-cab">
          <h4>Tablero de agentes</h4>
          <div className="of-orden" role="tablist" aria-label="Ordenar el tablero">
            {(
              [
                ["MESA", "Por mesa"],
                ["ACIERTO", "Acierto"],
                ["PF", "PF"],
                ["HISTORIAL", "Historial"],
              ] as const
            ).map(([k, t]) => (
              <button key={k} type="button" role="tab" aria-selected={orden === k} onClick={() => setOrden(k)}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <p className="of-tenue">
          Papel: el registro de cada agente con su regla sola. Con el mapa: las mismas entradas sin las que el mapa o el flujo tenían en contra
          (desde que se guardan las dos fotos). Historial: su regla en 4 h en la evaluación de su estudio, con costos. Con menos de 15 cierres,
          muestra mínima. No es asesoramiento financiero.
        </p>
        <div className="of-tablero">
          {tablero.map((e) => (
            <button
              key={e.id}
              type="button"
              className={`of-tarjeta${elegido === e.id ? " of-activo" : ""}`}
              style={{ ["--c" as string]: COLOR_MESA[e.mesa] }}
              onClick={() => {
                setElegido(e.id);
                escenaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              <span className="of-t-cab">
                <b>{nombreCorto(e.agente)}</b>
                <i>{MESAS.find((m) => m.id === e.mesa)?.nombre.replace("Mesa de ", "")}</i>
              </span>
              <span className="of-t-fila">
                <em>PAPEL</em>
                <span className={e.total.cerradas ? "" : "of-tenue"}>{lineaEst(e.total)}</span>
              </span>
              <span className="of-t-fila">
                <em>CON MAPA</em>
                <span className={e.conMapa.cerradas ? "" : "of-tenue"}>{lineaEst(e.conMapa)}</span>
              </span>
              <span className="of-t-fila">
                <em>HISTORIAL</em>
                <span className={e.historial ? "" : "of-tenue"}>{textoHistorial(e.historial)}</span>
              </span>
              {e.abiertas.length > 0 && (
                <span className="of-t-abiertas">
                  {e.abiertas.slice(0, 4).map((a) => (
                    <span key={`${a.symbol}-${a.detectada}`} className={`${a.lado === "LONG" ? "of-sube" : "of-baja"}${a.veredicto ? ` of-v-${a.veredicto.toLowerCase()}` : ""}`} title={a.veredicto ? TEXTO_V[a.veredicto] : "sin veredicto del mapa"}>
                      {nombreActivo(a.symbol)} {a.lado === "LONG" ? "▲" : "▼"}
                    </span>
                  ))}
                </span>
              )}
            </button>
          ))}
        </div>
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
      {/* Las mentes (Buffett, Musk y los demás) trabajan en su propia sala: leen acciones y CEDEARs de BYMA. */}
      <div className="of-sala-mentes">
        <h3 className="lab-sub">La sala de las mentes</h3>
        <SalaMentes />
      </div>
    </section>
  );
}
