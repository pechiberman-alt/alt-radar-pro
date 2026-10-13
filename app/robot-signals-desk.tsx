"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { openInMap, showSection } from "@/lib/account-events";
import { enR, escaleraHacia, recorrer, type Escalera } from "@/lib/escalera";
import { buildLiquidationLives } from "@/lib/liquidation-columns";
import { FUTURES_BASES, loadRows, timeframeConfig } from "@/lib/market-fetch";
import { MM_FEE_PCT, MM_HORIZON } from "@/lib/mm-robot";
import { MARCO_MS, MAX_RECORRIDOS, mismoRecorrido, registroCsv, resumirRegistro, type RegistroRobot } from "@/lib/robot-ledger";
import { liveRobotTrade, MM_WIDE_KEY, MM_WIDE_TTL, type WideSummary } from "@/lib/robot-signals";
import { parseSwingKlines, type SwingCandle } from "@/lib/swing-entries";

type Live = { symbol: string; timeframe: string; side: "LONG" | "SHORT"; entry: number; escalera: Escalera; time: number; ago: number; telegram: string };

const fmt = (v: number) => v.toLocaleString("es-AR", { maximumFractionDigits: v >= 100 ? 2 : v >= 1 ? 4 : 6 });
const pct = (a: number, b: number) => `${b >= a ? "+" : ""}${(((b - a) / a) * 100).toFixed(2).replace(".", ",")}%`;
const rTxt = (r: number | null) => (r === null ? "sin dato" : `${r > 0 ? "+" : ""}${r.toFixed(2).replace(".", ",")} R`);
const hora = (t: number) => new Date(t).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const LISTA = 100;

function readStudies(): Record<string, WideSummary> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(MM_WIDE_KEY) ?? "null") as Record<string, WideSummary> | null;
    if (!raw || typeof raw !== "object") return {};
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => v && Date.now() - v.at < MM_WIDE_TTL));
  } catch {
    return {};
  }
}

function useMounted() {
  return useSyncExternalStore(() => () => undefined, () => true, () => false);
}

/** Velas de Binance Futures desde la de la señal: la misma serie con que el robot la encontró. */
async function velasDesde(symbol: string, interval: string, desde: number): Promise<SwingCandle[]> {
  for (const base of FUTURES_BASES) {
    try {
      const r = await fetch(`${base}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&startTime=${desde}&limit=1000`);
      if (!r.ok) continue;
      const rows: unknown = await r.json();
      if (Array.isArray(rows)) return parseSwingKlines(rows);
    } catch {
      // Siguiente espejo.
    }
  }
  return [];
}

type EstadoRegistro = "cargando" | "listo" | "sin sesión" | "error";

/**
 * El registro de la cuenta: se carga una vez y se resuelve con las velas de
 * Binance. Solo se manda al servidor lo que cambió; él lo revisa y calcula el R.
 */
function useRegistro() {
  const [registros, setRegistros] = useState<RegistroRobot[]>([]);
  const [estado, setEstado] = useState<EstadoRegistro>("cargando");
  const ref = useRef<RegistroRobot[]>([]);
  const evaluando = useRef(false);
  const rechazados = useRef(new Set<string>());

  const fijar = useCallback((lista: RegistroRobot[]) => {
    ref.current = lista;
    setRegistros(lista);
  }, []);

  const sumar = useCallback(
    (nuevos: RegistroRobot[]) => {
      const porClave = new Map(ref.current.map((r) => [r.clave, r]));
      for (const r of nuevos) porClave.set(r.clave, r);
      fijar([...porClave.values()].sort((a, b) => b.vela - a.vela).slice(0, LISTA));
    },
    [fijar],
  );

  const evaluar = useCallback(async () => {
    const abiertas = ref.current.filter((r) => r.recorrido.desenlace === "ABIERTA");
    if (evaluando.current || !abiertas.length) return;
    evaluando.current = true;
    try {
      const grupos = new Map<string, RegistroRobot[]>();
      for (const r of abiertas) {
        const k = `${r.symbol}|${r.timeframe}`;
        (grupos.get(k) ?? grupos.set(k, []).get(k)!).push(r);
      }
      const ahora = Date.now();
      const cambios: { clave: string; recorrido: RegistroRobot["recorrido"] }[] = [];
      for (const [k, lista] of grupos) {
        const [symbol, timeframe] = k.split("|");
        const marco = MARCO_MS[timeframe];
        if (!marco) continue;
        const velas = await velasDesde(symbol, timeframe, Math.min(...lista.map((r) => r.vela)));
        if (!velas.length) continue;
        for (const r of lista) {
          const rec = recorrer(r.side, r.entrada, r.escalera, r.vela, velas, marco, ahora, { horizonte: MM_HORIZON, feePct: MM_FEE_PCT });
          const firma = JSON.stringify([r.clave, rec]);
          if (!mismoRecorrido(rec, r.recorrido) && !rechazados.current.has(firma)) cambios.push({ clave: r.clave, recorrido: rec });
        }
      }
      for (let i = 0; i < cambios.length; i += MAX_RECORRIDOS) {
        const lote = cambios.slice(i, i + MAX_RECORRIDOS);
        const res = await fetch("/api/robot/signal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "evaluar", recorridos: lote }) });
        const j = (await res.json().catch(() => ({}))) as { registros?: RegistroRobot[]; rechazados?: { clave: string }[] };
        if (!res.ok) continue;
        if (j.registros?.length) sumar(j.registros);
        // Lo que el servidor rechazó no se vuelve a mandar igual en esta sesión.
        for (const x of j.rechazados ?? []) {
          const c = lote.find((l) => l.clave === x.clave);
          if (c) rechazados.current.add(JSON.stringify([c.clave, c.recorrido]));
        }
      }
    } catch {
      // Se reintenta en el próximo escaneo.
    } finally {
      evaluando.current = false;
    }
  }, [sumar]);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const res = await fetch("/api/robot/signal", { cache: "no-store" });
        if (!vivo) return;
        if (res.status === 401) {
          setEstado("sin sesión");
          return;
        }
        const j = (await res.json().catch(() => ({}))) as { registros?: RegistroRobot[] };
        if (!vivo) return;
        if (!res.ok) {
          setEstado("error");
          return;
        }
        fijar(j.registros ?? []);
        setEstado("listo");
        await evaluar();
      } catch {
        if (vivo) setEstado("error");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [fijar, evaluar]);

  return { registros, estado, sumar, evaluar };
}

export default function RobotSignalsDesk() {
  const mounted = useMounted();
  return mounted ? <Inner /> : <section className="panel rs-desk" id="robot-senales"><p className="bot-none">Cargando…</p></section>;
}

function Inner() {
  const [studies, setStudies] = useState<Record<string, WideSummary>>({});
  const [signals, setSignals] = useState<Live[]>([]);
  const [status, setStatus] = useState<string>("");
  const [scanAt, setScanAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const { registros, estado, sumar, evaluar } = useRegistro();

  // Studies are saved by the map's ROBOT MM card; re-read when it announces one.
  useEffect(() => {
    const load = () => setStudies(readStudies());
    const t = window.setTimeout(load, 0);
    window.addEventListener("alt-radar:mm-wide", load);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("alt-radar:mm-wide", load);
    };
  }, []);

  const approved = Object.values(studies).filter((s) => s.best);

  useEffect(() => {
    if (!approved.length) return;
    const controller = new AbortController();
    let alive = true;
    (async () => {
      setStatus("Escaneando…");
      const found: Live[] = [];
      const nuevos: RegistroRobot[] = [];
      for (const study of approved) {
        const best = study.best!;
        const frameMs = timeframeConfig(study.timeframe).frameMs;
        for (const { symbol } of study.perCoin) {
          if (!alive) return;
          try {
            const now = Date.now();
            const candles = parseSwingKlines(await loadRows(symbol, study.timeframe, 500, controller.signal)).filter((c) => c.openTime + frameMs <= now);
            const live = liveRobotTrade(candles, buildLiquidationLives(symbol, candles, { samples: 2 }), best.filter);
            const e = live?.event;
            const escalera = live && e ? escaleraHacia(e.side, e.entry, e.stop, live.target) : null;
            if (live && e && escalera) {
              const signal = { symbol, timeframe: study.timeframe, side: e.side, entry: e.entry, stop: e.stop, target: live.target, time: e.time, variant: best.name, validation: { trades: best.outSample.resolved, profitFactor: best.outSample.profitFactor, positive: best.breadth.positive, tested: best.breadth.tested } };
              let telegram = "";
              try {
                const r = await fetch("/api/robot/signal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(signal), signal: controller.signal });
                const j = (await r.json().catch(() => ({}))) as { sent?: boolean; reason?: string; error?: string; registro?: RegistroRobot | null };
                telegram = j.sent ? "enviada a Telegram" : j.reason ?? j.error ?? "";
                if (j.registro) nuevos.push(j.registro);
              } catch {
                telegram = "";
              }
              found.push({ symbol, timeframe: study.timeframe, side: e.side, entry: e.entry, escalera, time: e.time, ago: candles.length - 1 - e.index, telegram });
            }
          } catch {
            // a coin that can't be read this round is skipped
          }
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      if (!alive) return;
      setSignals(found);
      setScanAt(Date.now());
      setStatus("");
      if (nuevos.length) sumar(nuevos);
      // Con cada escaneo se resuelve lo que quedó abierto en el registro.
      await evaluar();
    })();
    // Every 5 minutes while the tab is visible.
    const timer = window.setInterval(() => {
      if (!document.hidden) setTick((n) => n + 1);
    }, 300_000);
    return () => {
      alive = false;
      controller.abort();
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rescan when the approved set or the tick changes
  }, [JSON.stringify(approved.map((s) => [s.timeframe, s.at])), tick, sumar, evaluar]);

  return (
    <section className="panel rs-desk" id="robot-senales">
      <div className="panel-head">
        <div>
          <p className="eyebrow">SEÑALES · ROBOT MM</p>
          <h2>Señales del robot del mapa de liquidez</h2>
        </div>
        <span className="badge">{approved.length ? `${approved.length} ${approved.length === 1 ? "estrategia aprobada" : "estrategias aprobadas"}` : "SIN ESTRATEGIA APROBADA"}</span>
      </div>

      <div className="rs-frames">
        {Object.values(studies).length ? (
          Object.values(studies).map((s) => (
            <span key={s.timeframe} className={s.best ? "up" : "warn"}>
              {s.timeframe.toUpperCase()} · {s.best ? `✓ ${s.best.name}` : "ninguna aprobada"}
            </span>
          ))
        ) : (
          <span className="warn">Todavía no hay estudios.</span>
        )}
      </div>

      {!approved.length ? (
        <div className="rs-empty">
          <p>
            Las señales salen solo de estrategias que el robot <b>aprobó</b>: que ganaron en el estudio, en la validación (la parte de la historia que no
            usó para elegir) y en al menos la mitad de 12 monedas. Ahora no hay ninguna, así que no hay señales — y eso es a propósito.
          </p>
          <p>
            Para estudiar: abrí el MAPA, elegí una temporalidad (15M, 1H…) y en la tarjeta ROBOT MM tocá <b>ESTUDIAR 12 MONEDAS</b>. Si aprueba algo, las
            señales aparecen acá y en Telegram.
          </p>
          <button className="lv-csv" onClick={() => showSection("liquidaciones")}>IR AL MAPA</button>
        </div>
      ) : (
        <>
          {signals.length ? (
            <div className="rs-list">
              {signals.map((s) => (
                <div key={`${s.symbol}-${s.timeframe}-${s.time}`} className={s.side === "LONG" ? "up" : "down"}>
                  <button className="dc-coin" onClick={() => openInMap(s.symbol)} title="Abrir en el MAPA">
                    {s.symbol.replace(/USDT$/, "")} ↗
                  </button>
                  <b>{s.side === "LONG" ? "🟢 LONG" : "🔴 SHORT"} · {s.timeframe.toUpperCase()}</b>
                  <span>
                    entrada {fmt(s.entry)} · SL {fmt(s.escalera.stop)} ({pct(s.entry, s.escalera.stop)}) ·{" "}
                    {([s.escalera.tp1, s.escalera.tp2, s.escalera.tp3] as const).map((p, i) => (
                      <span key={i}>
                        TP{i + 1} {fmt(p)} ({pct(s.entry, p)} · {enR(s.entry, s.escalera.stop, p).toFixed(1).replace(".", ",")}R){i < 2 ? " · " : ""}
                      </span>
                    ))}
                  </span>
                  <em>
                    {s.ago === 0 ? "en la última vela" : `hace ${s.ago} ${s.ago === 1 ? "vela" : "velas"}`}
                    {s.telegram ? ` · ${s.telegram}` : ""}
                  </em>
                </div>
              ))}
            </div>
          ) : (
            <p className="bot-none">{status || "Sin señales ahora: ninguna de las monedas estudiadas barrió liquidez en la última vela con la estrategia aprobada."}</p>
          )}
          <p className="rs-meta">
            {scanAt ? `Último escaneo ${new Date(scanAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} · ` : ""}
            se repite cada 5 minutos con esta pestaña visible.{" "}
            <button className="lv-csv" onClick={() => setTick((n) => n + 1)}>ESCANEAR AHORA</button>
          </p>
        </>
      )}

      <Registro registros={registros} estado={estado} />

      <small className="dc-foot">
        El motor de confluencia y el modo scalping están apagados: venían perdiendo en la medición. Las señales se calculan en este navegador y se
        mandan a Telegram mientras la app está abierta (una sola vez cada una). Son del robot en papel: no son órdenes ni asesoramiento financiero.
      </small>
    </section>
  );
}

/** Cada nivel con su precio y, si lo tocó, la hora; el SL tocado va en rojo. */
function Nivel({ nombre, precio, at, tipo }: { nombre: string; precio: number; at: number | null; tipo: "tp" | "sl" }) {
  return (
    <span className={`rs-niv${at !== null ? (tipo === "sl" ? " mal" : " ok") : ""}`}>
      {nombre} {fmt(precio)} {at !== null ? `${tipo === "sl" ? "✗" : "✓"} ${hora(at)}` : "—"}
    </span>
  );
}

const DESENLACE: Record<string, string> = { ABIERTA: "abierta", SL: "terminó en SL", TP3: "llegó al TP3", TIEMPO: `salió por tiempo (${MM_HORIZON} velas)` };

function Registro({ registros, estado }: { registros: RegistroRobot[]; estado: EstadoRegistro }) {
  const res = resumirRegistro(registros);
  const descargar = () => {
    const url = URL.createObjectURL(new Blob([registroCsv(registros)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "registro-robot-mm.csv";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="rs-registro">
      <div className="rs-reg-head">
        <b>REGISTRO · cada señal con SL, TP1, TP2 y TP3</b>
        {registros.length > 0 && (
          <button className="lv-csv" onClick={descargar}>
            DESCARGAR CSV
          </button>
        )}
      </div>
      <p className="rs-meta">
        TP3 es el objetivo que el robot validó; TP1 y TP2 quedan a un tercio y dos tercios del camino, para parciales. Se fijan al detectar la señal y no se
        recalculan. Cada nivel tocado queda con su hora (si una vela toca el SL y un objetivo, cuenta el SL). El resultado es el de la operación entera
        —hasta TP3, SL o {MM_HORIZON} velas—, en R neto de comisión, medido igual que el robot. Lo resuelve tu navegador con las velas de Binance y el
        servidor lo revisa y calcula el R.
      </p>
      {estado === "cargando" && <p className="bot-none">Cargando el registro…</p>}
      {estado === "sin sesión" && <p className="bot-none">Iniciá sesión para que cada señal quede registrada en tu cuenta.</p>}
      {estado === "error" && <p className="bot-none">No se pudo leer el registro. Este dato no está disponible actualmente.</p>}
      {estado === "listo" && (
        <>
          <p className="rs-sum">
            {res.cerradas === 0
              ? `Todavía no terminó ninguna señal${res.abiertas ? ` (${res.abiertas} abierta${res.abiertas === 1 ? "" : "s"})` : ""}.`
              : res.tasas
                ? `${res.cerradas} cerradas (muestra razonable): llegaron a TP1 ${res.tasas.tp1}% · TP2 ${res.tasas.tp2}% · TP3 ${res.tasas.tp3}% · SL ${res.tasas.sl}% · por tiempo ${res.tasas.tiempo}% · R neto total ${rTxt(res.rTotal)} · medio ${rTxt(res.rMedio)}.`
                : `${res.cerradas} cerradas (muestra mínima: con menos de 15 no hay porcentajes): ${res.tp1} llegaron a TP1, ${res.tp2} a TP2, ${res.tp3} a TP3, ${res.sl} terminaron en SL y ${res.tiempo} por tiempo · R neto total ${rTxt(res.rTotal)}.`}
            {res.cerradas > 0 && res.abiertas > 0 ? ` ${res.abiertas} siguen abiertas.` : ""}
          </p>
          {registros.length ? (
            <div className="rs-reg-list">
              {registros.map((x) => {
                const r = x.recorrido;
                return (
                  <div key={x.clave} className={x.side === "LONG" ? "up" : "down"}>
                    <button className="dc-coin" onClick={() => openInMap(x.symbol)} title="Abrir en el MAPA">
                      {x.symbol.replace(/USDT$/, "")} ↗
                    </button>
                    <b>
                      {x.side === "LONG" ? "🟢 LONG" : "🔴 SHORT"} · {x.timeframe.toUpperCase()} · {hora(x.vela)}
                    </b>
                    <span className="rs-niveles">
                      <span className="rs-niv">entrada {fmt(x.entrada)}</span>
                      <Nivel nombre="SL" precio={x.escalera.stop} at={r.slAt} tipo="sl" />
                      <Nivel nombre="TP1" precio={x.escalera.tp1} at={r.tp1At} tipo="tp" />
                      <Nivel nombre="TP2" precio={x.escalera.tp2} at={r.tp2At} tipo="tp" />
                      <Nivel nombre="TP3" precio={x.escalera.tp3} at={r.tp3At} tipo="tp" />
                    </span>
                    <em>
                      {DESENLACE[r.desenlace] ?? r.desenlace}
                      {r.desenlace !== "ABIERTA" ? ` · ${rTxt(r.r)}${r.desenlace === "TIEMPO" && r.salida !== null ? ` (salió a ${fmt(r.salida)})` : ""}` : ""}
                      {x.telegram ? ` · ${x.telegram}` : ""}
                    </em>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="bot-none">Todavía no hay señales registradas en tu cuenta.</p>
          )}
          <p className="rs-meta">Horas en tu zona horaria; el CSV va en UTC. Se muestran las últimas {LISTA}.</p>
        </>
      )}
    </div>
  );
}
