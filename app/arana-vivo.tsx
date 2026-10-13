"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { AUTO_REVISA_MS, decidirAuto, type DecisionAuto, type EstadoAuto } from "../lib/arana-vivo-auto.ts";
import { buildVivo, type VivoSnapshot, type VivoSombra } from "../lib/arana-vivo.ts";
import { BACKTEST_EVENT, lastBacktest } from "../lib/jarvis-backtest-run.ts";
import { loadPaper, PAPER_EVENT, paperTrades } from "../lib/jarvis-paper-run.ts";
import { inicioDeUltimo } from "../lib/arana-ultimo.ts";
import { cancelScan, cargarUltimoEscaneo, lastScan, SCAN_EVENT, scanState, startScan, ultimoEscaneoListo } from "../lib/jarvis-scan-run.ts";
import { watchStatus, WATCH_EVENT } from "../lib/jarvis-watch-run.ts";
import { MEDICION } from "../lib/mesa-medicion.ts";
import { cargarRegistro, REGISTRO_ESPERA_MS, REGISTRO_EVENT, registroActual } from "../lib/registro-run.ts";
import { aprobarVariante, cargarSombra, correrSombra, laboratorio, resumenActual, revocarVariante, SOMBRA_EVENT } from "../lib/mesa-sombra-run.ts";
import { textoEvento } from "../lib/mesa-sombra.ts";

/**
 * La mesa en vivo, para la araña: lo que la app leyó ahora mismo (el escaneo que va
 * llegando o el último completo, el papel, el último backtest y la vigilancia)
 * junto con lo medido en el pasado, cada cosa con su muestra. Ninguna lectura
 * manda una orden: el escaneo automático solo lee datos públicos de Binance.
 */
const EVENTOS = [SCAN_EVENT, PAPER_EVENT, BACKTEST_EVENT, WATCH_EVENT, SOMBRA_EVENT, REGISTRO_EVENT] as const;
/** Cada cuánto, como mucho, se rearma la foto: un escaneo cambia una moneda por vez. */
const REFRESCO_MS = 400;

function vivoSombra(): VivoSombra {
  const l = laboratorio();
  return {
    resumen: resumenActual(),
    modo: l.modo,
    corriendo: l.corriendo,
    aviso: l.aviso,
    error: l.error,
    cadena: l.cadena ? { ok: l.cadena.ok, revisados: l.cadena.revisados, motivo: l.cadena.motivo } : null,
    eventos: l.eventos.slice(0, 8).map((e) => ({ seq: e.seq, at: e.at, tipo: e.tipo, texto: textoEvento(e.tipo, e.datos), hash: e.hash.slice(0, 12) })),
  };
}

/** La foto en vivo de este momento, para quien la necesita fuera de un componente (JARVIS, el laboratorio). */
export function armar(): VivoSnapshot {
  const st = scanState();
  return buildVivo({
    now: Date.now(),
    escaneo: lastScan(),
    escaneando: st.running && st.progress ? { hechas: st.progress.hechas, total: st.progress.total } : null,
    llegando: st.filas,
    papel: paperTrades(),
    backtest: lastBacktest(),
    vigilancia: watchStatus(),
    medido: MEDICION,
    sombra: vivoSombra(),
    registro: registroActual().registro,
  });
}

/** La foto en vivo. Empieza en null (se dibuja después de montar, así no hay diferencias entre servidor y navegador). */
export function useVivo(): VivoSnapshot | null {
  const [vivo, setVivo] = useState<VivoSnapshot | null>(null);
  useEffect(() => {
    let activo = true;
    let pendiente: ReturnType<typeof setTimeout> | null = null;
    const rearmar = () => {
      if (activo) setVivo(armar());
    };
    const refrescar = () => {
      if (!activo || pendiente !== null) return;
      pendiente = setTimeout(() => {
        pendiente = null;
        rearmar();
      }, REFRESCO_MS);
    };
    EVENTOS.forEach((n) => window.addEventListener(n, refrescar));
    void (async () => {
      await loadPaper().catch(() => null);
      refrescar();
    })();
    return () => {
      activo = false;
      if (pendiente !== null) clearTimeout(pendiente);
      EVENTOS.forEach((n) => window.removeEventListener(n, refrescar));
    };
  }, []);
  return vivo;
}

/**
 * El escaneo automático: cada 30 segundos, y cuando cambia la visibilidad, decide
 * con lib/arana-vivo-auto.ts si toca escanear. Solo con la mesa en vivo a la vista
 * y la pestaña visible; nunca dos a la vez, y el intento queda anotado aunque falle.
 */
export function useAutoEscaneo(zona: RefObject<HTMLElement | null>) {
  const [auto, setAuto] = useState<DecisionAuto | null>(null);
  const [pausado, setPausado] = useState(false);
  const pausadoRef = useRef(false);
  const visibleRef = useRef(false);
  const intentoRef = useRef<number | null>(null);
  const decidirRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const decidir = () => {
      // Hasta leer el último escaneo guardado no se decide nada: si no, el primer escaneo se lanza a ciegas y pisa la cadencia.
      if (!ultimoEscaneoListo()) return;
      const guardado = lastScan();
      const d = decidirAuto({
        visible: visibleRef.current && document.visibilityState === "visible",
        pausado: pausadoRef.current,
        enCurso: scanState().running,
        // El último intento es el de esta sesión o, si no hubo, cuando empezó el último escaneo guardado.
        ultimoIntento: intentoRef.current ?? (guardado ? inicioDeUltimo(guardado) : null),
        ahora: Date.now(),
      });
      if (d.escanear) {
        intentoRef.current = Date.now();
        void startScan();
      }
      setAuto(d);
    };
    decidirRef.current = decidir;
    // Al entrar: leer el último escaneo y, cuando esté, decidir de una vez (no hay que esperar al próximo tick de 30 s).
    void cargarUltimoEscaneo().then(() => decidirRef.current());
    const mirar = new IntersectionObserver((entradas) => {
      visibleRef.current = entradas.some((x) => x.isIntersecting);
      decidir();
    });
    if (zona.current) mirar.observe(zona.current);
    const cada = window.setInterval(decidir, AUTO_REVISA_MS);
    document.addEventListener("visibilitychange", decidir);
    return () => {
      mirar.disconnect();
      window.clearInterval(cada);
      document.removeEventListener("visibilitychange", decidir);
    };
  }, [zona]);

  const alternarPausa = () => {
    pausadoRef.current = !pausadoRef.current;
    setPausado(pausadoRef.current);
    decidirRef.current();
  };
  const escanearAhora = () => {
    if (scanState().running) return;
    intentoRef.current = Date.now();
    void startScan();
  };
  // Mientras corre un escaneo, el estado que se muestra es «en curso», aunque la decisión sea de antes.
  const estado: EstadoAuto | null = scanState().running ? "en curso" : auto ? auto.estado : null;
  return { auto, estado, pausado, alternarPausa, escanearAhora, cancelar: () => cancelScan() };
}

/** Cada cuánto, como mucho, revisa si hay operaciones cerradas nuevas (sin datos nuevos no hace nada). */
const SOMBRA_REVISA_MS = 10 * 60_000;
const SOMBRA_ESPERA_MS = 3000;

/**
 * El laboratorio en sombra: carga la auditoría y corre cuando llegan
 * operaciones de papel o un backtest nuevo, y cada 10 minutos con la pestaña
 * visible. Sin datos nuevos, una corrida no hace nada ni pide nada al servidor.
 */
/** El registro del servidor: se lee al abrir la araña y después como mucho cada 5 minutos, solo con la pestaña visible. */
export function useRegistro() {
  useEffect(() => {
    const correr = () => {
      if (document.visibilityState === "visible") void cargarRegistro().catch(() => null);
    };
    correr();
    const cada = setInterval(correr, REGISTRO_ESPERA_MS);
    document.addEventListener("visibilitychange", correr);
    return () => {
      clearInterval(cada);
      document.removeEventListener("visibilitychange", correr);
    };
  }, []);
}

export function useSombra() {
  useEffect(() => {
    let espera: ReturnType<typeof setTimeout> | null = null;
    const correr = () => {
      if (document.visibilityState === "visible") void correrSombra().catch(() => null);
    };
    const pronto = () => {
      if (espera !== null) clearTimeout(espera);
      espera = setTimeout(() => {
        espera = null;
        correr();
      }, SOMBRA_ESPERA_MS);
    };
    void (async () => {
      await cargarSombra().catch(() => null);
      correr();
    })();
    window.addEventListener(PAPER_EVENT, pronto);
    window.addEventListener(BACKTEST_EVENT, pronto);
    const cada = window.setInterval(correr, SOMBRA_REVISA_MS);
    return () => {
      if (espera !== null) clearTimeout(espera);
      window.removeEventListener(PAPER_EVENT, pronto);
      window.removeEventListener(BACKTEST_EVENT, pronto);
      window.clearInterval(cada);
    };
  }, []);
}

/** Aprobar y revocar: siempre a mano, con confirmación, y quedan en la auditoría. */
export function ControlesSombra({ sombra }: { sombra: VivoSombra | null }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  if (!sombra) return null;
  const r = sombra.resumen;
  const aptas = r.candidatas.filter((c) => c.estado === "APTA");
  const decidir = async (accion: () => Promise<{ ok: true } | { ok: false; error: string }>, hecho: string) => {
    setOcupado(true);
    const res = await accion();
    setOcupado(false);
    setMsg(res.ok ? hecho : res.error);
  };
  const aprobar = (indice: number, variante: string, descripcion: string) => {
    const texto = `¿Aprobás ${variante}?\n\n${descripcion}\n\nDesde ahora frena las operaciones de papel nuevas que esta variante no tomaría. No toca la ejecución real. Queda en la auditoría y la podés revocar cuando quieras.`;
    if (window.confirm(texto)) void decidir(() => aprobarVariante(indice), `Aprobaste ${variante}. Quedó en la auditoría.`);
  };
  const revocar = (variante: string) => {
    const motivo = window.prompt(`¿Por qué revocás ${variante}? Queda en la auditoría.`, "La reviso de nuevo.");
    if (motivo !== null) void decidir(() => revocarVariante(motivo), `Revocaste ${variante}. El papel vuelve a seguir la mesa tal cual.`);
  };
  return (
    <div className="vivo-ctl sombra-ctl">
      <p className="vivo-ctl-texto">
        <b>LABORATORIO EN SOMBRA</b> · generación {r.generacion} · {r.probadas.toLocaleString("es-AR")} de {r.espacio.toLocaleString("es-AR")} variantes probadas ·{" "}
        {sombra.modo === "cuenta" ? (sombra.cadena?.ok === false ? "auditoría ROTA" : "auditoría en tu cuenta") : sombra.modo === "sin sesión" ? "sin sesión: en memoria" : sombra.modo === "error" ? "sin conexión" : "cargando"}
        {sombra.corriendo ? " · evolucionando…" : ""}
      </p>
      {(aptas.length > 0 || r.aprobada) && (
        <div className="vivo-ctl-botones">
          {r.aprobada ? (
            <button type="button" disabled={ocupado} onClick={() => revocar(r.aprobada!.variante)}>
              REVOCAR {r.aprobada.variante}
            </button>
          ) : (
            aptas.map((c) => (
              <button type="button" key={c.indice} disabled={ocupado || sombra.modo !== "cuenta"} onClick={() => aprobar(c.indice, c.variante, c.descripcion)}>
                APROBAR {c.variante}
              </button>
            ))
          )}
        </div>
      )}
      {(msg || sombra.error || sombra.aviso) && (
        <p className="vivo-ctl-nota" aria-live="polite">
          {msg ?? sombra.error ?? sombra.aviso}
        </p>
      )}
    </div>
  );
}

const pct = (x: number | null) => (x === null ? "sin dato" : `${Math.round(x * 100)}%`);
const num = (x: number | null, d = 2) => (x === null ? "sin dato" : x.toFixed(d).replace(".", ","));
const ic = (i: { low: number; high: number } | null) => (i ? `IC90 ${pct(i.low)} a ${pct(i.high)}` : "sin dato");
const estadoEscaneo = { "sin datos": "sin escaneo", escaneando: "escaneando", listo: "al día", parcial: "parcial" } as const;
const TEXTO_AUTO: Record<EstadoAuto, string> = {
  activo: "Escaneo automático: cada 15 minutos, mientras la araña esté a la vista.",
  pausado: "Escaneo automático en pausa: escaneás a mano.",
  "fuera de vista": "Escaneo automático en espera: la araña no está a la vista.",
  "en curso": "Escaneando ahora…",
};

export function ControlesVivo({
  auto,
  estado,
  pausado,
  onPausa,
  onEscanear,
  onCancelar,
}: {
  auto: DecisionAuto | null;
  estado: EstadoAuto | null;
  pausado: boolean;
  onPausa: () => void;
  onEscanear: () => void;
  onCancelar: () => void;
}) {
  const enCurso = estado === "en curso";
  const texto = estado ? `${TEXTO_AUTO[estado]}${estado === "activo" && auto ? ` ${auto.motivo}` : ""}` : "Esperando a que la mesa esté a la vista…";
  return (
    <div className="vivo-ctl">
      <div className="vivo-ctl-botones">
        <button type="button" onClick={onEscanear} disabled={enCurso}>
          ESCANEAR AHORA
        </button>
        <button type="button" onClick={onCancelar} disabled={!enCurso}>
          CANCELAR
        </button>
        <button type="button" onClick={onPausa} aria-pressed={pausado}>
          {pausado ? "REANUDAR AUTO" : "PAUSAR AUTO"}
        </button>
      </div>
      <p className="vivo-ctl-texto" aria-live="polite">
        {texto}
      </p>
      <p className="vivo-ctl-nota">Un escaneo lee hasta 400 monedas de a una, con datos públicos de Binance: tarda varios minutos y la esfera se llena mientras tanto.</p>
    </div>
  );
}

export function PanelVivo({ vivo }: { vivo: VivoSnapshot | null }) {
  if (!vivo) return <p className="vivo-wait">LEYENDO LA MESA EN VIVO…</p>;
  const e = vivo.escaneo;
  const bt = vivo.backtest;
  return (
    <div className="vivo" aria-live="polite">
      <div className="vivo-head">
        <span className={`vivo-dot ${e.estado}`} aria-hidden="true" />
        <b>EN VIVO</b>
        <span>lo que la app leyó ahora, contra lo medido</span>
      </div>
      <div className="vivo-grid">
        <div>
          <small>Escaneo</small>
          <b>{estadoEscaneo[e.estado]}</b>
          <span>
            {e.estado === "escaneando" && e.progreso !== null
              ? `${Math.round(e.progreso * 100)}% leídas`
              : e.haceMin === null
                ? "todavía no escaneaste"
                : `hace ${e.haceMin} min`}
          </span>
        </div>
        <div>
          <small>Aprobadas ahora</small>
          <b>{e.aprobadas ?? "–"}</b>
          <span>
            {e.largos ?? "–"} largos · {e.cortos ?? "–"} cortos · de {e.leidas ?? "–"} leídas
          </span>
        </div>
        <div>
          <small>Papel cerrado</small>
          <b>{vivo.papel.cerradas}</b>
          <span>
            {vivo.papel.winRate ? `${pct(vivo.papel.winRate.p)} · ${ic(vivo.papel.winRate)}` : "sin operaciones cerradas"} · {vivo.papel.muestra.toLowerCase()}
          </span>
        </div>
        <div>
          <small>Backtest {bt ? `de ${bt.moneda}, ${bt.dias} días` : ""}</small>
          <b>{bt ? bt.operaciones : "–"}</b>
          <span>{bt ? `${bt.winRate ? `${pct(bt.winRate.p)} · ${ic(bt.winRate)}` : "sin operaciones"} · ${bt.muestra.toLowerCase()}` : "todavía no corriste uno"}</span>
        </div>
        <div>
          <small>Medido en el pasado</small>
          <b>{pct(vivo.medido.winRate.p)}</b>
          <span>
            {ic(vivo.medido.winRate)} · {vivo.medido.n} operaciones · PF {num(vivo.medido.profitFactor.p)}
          </span>
        </div>
      </div>
      {e.mejores.length > 0 && (
        <ol className="vivo-mejores" aria-label="Mejores aprobadas del escaneo">
          {e.mejores.map((m) => (
            <li key={m.symbol}>
              <b>{m.symbol.replace(/USDT$/, "")}</b> {m.direccion === "LONG" ? "largo" : "corto"} · confluencia {m.puntaje ?? "sin dato"}
              {m.consenso !== null ? ` · consenso ${num(m.consenso)}` : ""}
            </li>
          ))}
        </ol>
      )}
      <p className={`vivo-veredicto ${vivo.veredicto.estado}`}>{vivo.veredicto.texto}</p>
      {vivo.avisos.map((a) => (
        <p className="vivo-aviso" key={a}>
          {a}
        </p>
      ))}
      <p className="vivo-adv">{vivo.advertencia}</p>
      <p className="vivo-adv">{vivo.aprendizaje}</p>
    </div>
  );
}
