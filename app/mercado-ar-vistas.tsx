"use client";

/**
 * Las vistas de MERCADO AR que comparten el panel y el MAPA: el gráfico diario de un papel (velas, medias, soportes y
 * resistencias, perfil de volumen aproximado, RSI y MACD), las MENTES (lib/mentes-inversoras.ts) y los agentes del
 * laboratorio (lib/mercado-ar-agentes.ts), y MapaAr, la vista completa de un papel que el MAPA muestra en lugar del mapa de
 * liquidaciones (que para acciones no existe y se dice). Todo con ruedas cerradas; no es asesoramiento financiero.
 */
import { useEffect, useMemo, useState } from "react";
import { PAPELES_AR, TEXTO_SIN_FOOTPRINT, type PapelAr } from "@/lib/mercado-ar";
import { AVISO_MENTES, type Consenso, type LecturaMente } from "@/lib/mentes-inversoras";
import { EXCLUIDOS_AR, ESTUDIO_AR, type AgenteEnPapel } from "@/lib/mercado-ar-agentes";
import { medir } from "@/lib/estrategias";
import { MUESTRA_MINIMA } from "@/lib/registro";
import { nivelesAr, perfilAprox, TEXTO_SIN_LIQUIDACIONES } from "@/lib/mercado-ar-mapa";
import { ema, macd, rsi } from "@/lib/oscillators";
import { cargarPanel, leerPapel, type LecturaPapel } from "@/lib/mercado-ar-cliente";
import type { SwingCandle } from "@/lib/swing-entries";

export const fmt = (x: number | null | undefined, d = 2) =>
  x === null || x === undefined || !Number.isFinite(x) ? "—" : x.toLocaleString("es-AR", { maximumFractionDigits: Math.abs(x) >= 1000 ? Math.min(d, 1) : d, minimumFractionDigits: 0 });
export const fmtPct = (x: number | null | undefined, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : `${x > 0 ? "+" : ""}${x.toLocaleString("es-AR", { maximumFractionDigits: d })} %`);
const fecha = (t: number) => new Date(t).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });

const CLASE_POSTURA: Record<string, string> = { "A FAVOR": "ok", "EN CONTRA": "mal", NEUTRAL: "alerta", "SIN DATOS": "", INFORMA: "" };

// ── Gráfico ──

export function GraficoAr({ velas, cantidad }: { velas: SwingCandle[]; cantidad: number }) {
  const g = useMemo(() => {
    if (velas.length < 2) return null;
    const cierres = velas.map((c) => c.close);
    const e50 = ema(cierres, 50);
    const m200: (number | null)[] = cierres.map((_, k) => (k >= 199 ? cierres.slice(k - 199, k + 1).reduce((s, x) => s + x, 0) / 200 : null));
    const r = rsi(cierres, 14);
    const md = macd(cierres);
    const desde = Math.max(0, velas.length - cantidad);
    const v = velas.slice(desde);
    const niv = nivelesAr(velas);
    const perfil = perfilAprox(v);
    const W = 360;
    const ejeX = 50;
    const anchoV = (W - ejeX) / v.length;
    const H = 200;
    const precios = [...v.flatMap((c) => [c.high, c.low]), ...niv.soportes.map((n) => n.precio), ...niv.resistencias.map((n) => n.precio)];
    const lo = Math.min(...v.map((c) => c.low));
    const hi = Math.max(...v.map((c) => c.high));
    const loV = Math.min(lo, ...precios.filter((p) => p >= lo - (hi - lo) * 0.25));
    const hiV = Math.max(hi, ...precios.filter((p) => p <= hi + (hi - lo) * 0.25));
    const y = (p: number) => 8 + (1 - (p - loV) / (hiV - loV || 1)) * (H - 16);
    const x = (k: number) => k * anchoV + anchoV / 2;
    const linea = (serie: (number | null)[]) =>
      serie
        .slice(desde)
        .map((p, k) => (p === null ? null : `${x(k).toFixed(1)},${y(p).toFixed(1)}`))
        .filter(Boolean)
        .join(" ");
    const maxVol = Math.max(...v.map((c) => c.volume), 1);
    const maxPerfil = Math.max(...perfil.franjas.map((f) => f.volumen), 1);
    const hist = md.hist.slice(desde);
    const maxHist = Math.max(...hist.map((h) => Math.abs(h ?? 0)), 1e-9);
    return { v, x, y, anchoV, W, H, ejeX, linea, e50, m200, r: r.slice(desde), md, hist, maxHist, desde, niv, perfil, maxVol, maxPerfil, loV, hiV };
  }, [velas, cantidad]);
  if (!g) return <p className="ar-mute">Sin ruedas para dibujar.</p>;
  const { v, x, y, anchoV, W, H, ejeX } = g;
  const VOL = H + 4;
  const RSI = VOL + 40;
  const MACD = RSI + 50;
  const total = MACD + 50;
  const yRsi = (r: number) => RSI + 4 + (1 - r / 100) * 40;
  const yMacd = (h: number) => MACD + 25 - (h / g.maxHist) * 20;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => g.loV + (g.hiV - g.loV) * t);
  return (
    <svg className="ar-svg" viewBox={`0 0 ${W} ${total}`} role="img" aria-label="Gráfico diario del papel">
      {g.perfil.franjas.map((f, k) => (
        <rect key={`p${k}`} x={W - ejeX - (f.volumen / g.maxPerfil) * 60} y={y(f.hasta)} width={(f.volumen / g.maxPerfil) * 60} height={Math.max(1, y(f.desde) - y(f.hasta))} fill="#55d6be14" />
      ))}
      {ticks.map((p, k) => (
        <g key={`t${k}`}>
          <line x1={0} x2={W - ejeX} y1={y(p)} y2={y(p)} stroke="#17201c" />
          <text x={W - ejeX + 3} y={y(p) + 3} fill="#718078" fontSize="8" fontFamily="monospace">{fmt(p)}</text>
        </g>
      ))}
      {[...g.niv.resistencias, ...g.niv.soportes].map((n, k) => (
        <g key={`n${k}`}>
          <line x1={0} x2={W - ejeX} y1={y(n.precio)} y2={y(n.precio)} stroke={n.tipo === "RESISTENCIA" ? "#ff5964" : "#39f29a"} strokeDasharray="4 3" strokeWidth="0.8" />
          <text x={2} y={y(n.precio) - 2} fill={n.tipo === "RESISTENCIA" ? "#ff5964" : "#39f29a"} fontSize="7.5" fontFamily="monospace">
            {n.tipo === "RESISTENCIA" ? "R" : "S"} {fmt(n.precio)} ×{n.toques}
          </text>
        </g>
      ))}
      {g.perfil.poc !== null && <line x1={0} x2={W - ejeX} y1={y(g.perfil.poc)} y2={y(g.perfil.poc)} stroke="#f4b84a" strokeWidth="0.6" strokeDasharray="1 2" />}
      {v.map((c, k) => {
        const sube = c.close >= c.open;
        const col = sube ? "#39f29a" : "#ff5964";
        return (
          <g key={c.openTime}>
            <line x1={x(k)} x2={x(k)} y1={y(c.high)} y2={y(c.low)} stroke={col} strokeWidth="0.7" />
            <rect x={x(k) - Math.max(0.6, anchoV * 0.35)} width={Math.max(1.2, anchoV * 0.7)} y={y(Math.max(c.open, c.close))} height={Math.max(0.8, Math.abs(y(c.open) - y(c.close)))} fill={col} />
            <rect x={x(k) - Math.max(0.6, anchoV * 0.35)} width={Math.max(1.2, anchoV * 0.7)} y={VOL + 36 - (c.volume / g.maxVol) * 32} height={(c.volume / g.maxVol) * 32} fill={sube ? "#39f29a55" : "#ff596455"} />
          </g>
        );
      })}
      <polyline points={g.linea(g.e50)} fill="none" stroke="#55d6be" strokeWidth="1" />
      <polyline points={g.linea(g.m200)} fill="none" stroke="#f4b84a" strokeWidth="1.1" />
      <text x={2} y={10} fill="#55d6be" fontSize="8" fontFamily="monospace">EMA 50</text>
      <text x={40} y={10} fill="#f4b84a" fontSize="8" fontFamily="monospace">MEDIA 200</text>
      <text x={2} y={VOL + 8} fill="#718078" fontSize="7.5" fontFamily="monospace">VOLUMEN</text>
      <line x1={0} x2={W - ejeX} y1={yRsi(70)} y2={yRsi(70)} stroke="#673238" strokeDasharray="2 2" />
      <line x1={0} x2={W - ejeX} y1={yRsi(30)} y2={yRsi(30)} stroke="#2c493b" strokeDasharray="2 2" />
      <polyline points={g.r.map((r, k) => (r === null ? null : `${x(k).toFixed(1)},${yRsi(r).toFixed(1)}`)).filter(Boolean).join(" ")} fill="none" stroke="#a78bfa" strokeWidth="1" />
      <text x={2} y={RSI + 8} fill="#718078" fontSize="7.5" fontFamily="monospace">RSI 14 · {fmt(g.r.at(-1) ?? null, 1)}</text>
      {g.hist.map((h, k) => (h === null ? null : <rect key={`h${k}`} x={x(k) - anchoV * 0.35} width={Math.max(1, anchoV * 0.7)} y={Math.min(yMacd(h), MACD + 25)} height={Math.abs(yMacd(h) - (MACD + 25))} fill={h >= 0 ? "#39f29a88" : "#ff596488"} />))}
      <text x={2} y={MACD + 8} fill="#718078" fontSize="7.5" fontFamily="monospace">MACD 12·26·9</text>
      <text x={2} y={total - 2} fill="#4f5e56" fontSize="7" fontFamily="monospace">{fecha(v[0].openTime)} → {fecha(v.at(-1)!.openTime)} · perfil de volumen aproximado (por rueda)</text>
    </svg>
  );
}

// ── Mentes ──

export function MentesPanel({ mentes, consenso }: { mentes: LecturaMente[]; consenso: Consenso }) {
  const [abierta, setAbierta] = useState<string | null>(null);
  return (
    <div className="ar-box">
      <h3>MENTES · {consenso.aFavor} a favor · {consenso.enContra} en contra · {consenso.neutral} neutrales · {consenso.sinDatos} sin datos</h3>
      {mentes.map((m) => (
        <div className="ar-mente" key={m.id}>
          <div>
            <button className="ar-chip-btn" onClick={() => setAbierta(abierta === m.id ? null : m.id)} aria-expanded={abierta === m.id}>
              {m.mente}
            </button>
            <span className={`ar-chip ${CLASE_POSTURA[m.postura]}`}>{m.postura}</span>
          </div>
          <em>{m.idea}</em>
          {abierta === m.id && (
            <>
              {m.criterios.map((c) => (
                <div className="ar-crit" key={c.nombre} title={c.regla}>
                  <i className={c.cumple === null ? "ar-mute" : c.cumple ? "ar-up" : "ar-down"}>{c.cumple === null ? "?" : c.cumple ? "✓" : "✗"}</i>
                  <span>{c.nombre}</span>
                  <span className="ar-mute">{c.valor}</span>
                </div>
              ))}
              <p>{m.nota}</p>
            </>
          )}
        </div>
      ))}
      <p className="ar-mute">{AVISO_MENTES}</p>
    </div>
  );
}

// ── Agentes ──

export function AgentesPanel({ agentes }: { agentes: AgenteEnPapel[] }) {
  if (!agentes.length) return <div className="ar-box"><h3>AGENTES</h3><p>Hacen falta al menos 60 ruedas para que los agentes lean el papel.</p></div>;
  const conSenal = agentes.filter((a) => a.senalHoy);
  return (
    <div className="ar-box">
      <h3>AGENTES DEL LABORATORIO · {conSenal.length} con señal de compra en la última rueda</h3>
      {agentes.map((a) => {
        const m = medir(a.ops);
        const minima = m.operaciones < MUESTRA_MINIMA;
        return (
          <div className="ar-agente" key={a.id} title={a.regla}>
            <div className="ar-head">
              <b>{a.agente}</b>
              <span className="ar-mute">
                {m.operaciones ? `${m.operaciones} op. · acierto ${fmtPct((m.winRate ?? 0) * 100, 0)} · PF ${m.profitFactor === null ? "—" : fmt(m.profitFactor)} · ${fmt(m.netoR, 1)} R${minima ? " · muestra mínima" : ""}` : "sin operaciones en este papel"}
              </span>
            </div>
            <span className="ar-mute">{a.nombre}</span>
            {a.senalHoy && (
              <div className="ar-plan">
                COMPRA en la apertura siguiente a la rueda del {fecha(a.senalHoy.rueda)} · ref. {fmt(a.senalHoy.referencia)} · SL {fmt(a.senalHoy.escalera.stop)} · TP1 {fmt(a.senalHoy.escalera.tp1)} · TP2 {fmt(a.senalHoy.escalera.tp2)} · TP3 {fmt(a.senalHoy.escalera.tp3)} · R:R {fmt(a.senalHoy.rr, 1)}
              </div>
            )}
          </div>
        );
      })}
      <p className="ar-mute">
        Backtest con las ruedas que hay (unos 2 años), solo compras, horizonte de {ESTUDIO_AR.horizonte} ruedas y comisión supuesta de {fmt(ESTUDIO_AR.feePct, 1)} % por lado. Si una rueda toca stop y objetivo, cuenta el stop. {EXCLUIDOS_AR} Resultados pasados, simulados: no garantizan resultados futuros. No es asesoramiento financiero.
      </p>
    </div>
  );
}

// ── La vista de un papel en el MAPA ──

export function MapaAr({ papel, onSalir }: { papel: PapelAr; onSalir: () => void }) {
  const [lectura, setLectura] = useState<LecturaPapel | null>(null);
  const [cargando, setCargando] = useState(true);
  const [cantidad, setCantidad] = useState(120);
  const [panel, setPanel] = useState<{ hechos: number; total: number } | null>(null);
  const [vuelta, setVuelta] = useState(0);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const l = await leerPapel(papel);
      if (!vivo) return;
      setLectura(l);
      setCargando(false);
    })();
    return () => {
      vivo = false;
    };
  }, [papel, vuelta]);

  const leerPanel = async () => {
    setPanel({ hechos: 0, total: 1 });
    await cargarPanel(PAPELES_AR, (hechos, total) => setPanel({ hechos, total }));
    setPanel(null);
    setVuelta((n) => n + 1);
  };

  const s = lectura?.serie;
  const velas = s?.serie?.velas ?? [];
  const ultima = velas.at(-1);
  const previa = velas.at(-2);
  const estado = s?.estado;
  return (
    <div className="ar-wrap">
      <div className="ar-head">
        <div>
          <p className="eyebrow">MERCADO AR · {papel.tipo === "CEDEAR" ? "CEDEAR" : "ACCIÓN"} · BYMA · RUEDAS DIARIAS</p>
          <h2>{papel.ticker}</h2>
          <small>{papel.nombre}{papel.subyacente ? ` · afuera: ${papel.subyacente} (USD)` : ""}</small>
        </div>
        <button className="ar-chip-btn" onClick={onSalir}>VOLVER AL MAPA CRIPTO</button>
      </div>
      <p className="ar-flag"><b>SIN LIQUIDACIONES</b> · {TEXTO_SIN_LIQUIDACIONES}</p>
      {cargando && <p className="liq-loading">LEYENDO {papel.ticker}…</p>}
      {!cargando && lectura && (
        <>
          <div className="ar-box">
            <div className="ar-head">
              <div>
                <h3>ÚLTIMO CIERRE</h3>
                <b style={{ font: "24px var(--font-mono)" }}>
                  {fmt(ultima?.close ?? null)} {s?.serie?.meta.moneda ?? ""}
                </b>{" "}
                <span className={ultima && previa && ultima.close >= previa.close ? "ar-up" : "ar-down"}>{ultima && previa ? fmtPct((ultima.close / previa.close - 1) * 100, 2) : ""}</span>
              </div>
              <span className={`ar-chip ${estado?.estado === "OK" ? "ok" : estado?.estado === "DATA_UNAVAILABLE" ? "mal" : "alerta"}`}>{estado?.estado ?? "—"}</span>
            </div>
            <p>
              {estado?.motivo ? `${estado.motivo}. ` : ""}
              {s?.fuente ? `Fuente: ${s.fuente}` : `Sin fuente: ${s?.error ?? "no respondió"}`}
              {s?.serie?.meta.demoraMin ? ` · demora declarada ${s.serie.meta.demoraMin} min` : ""}
              {ultima ? ` · última rueda cerrada ${fecha(ultima.openTime)}` : ""}. La rueda de hoy, si está abierta, no entra en ninguna cuenta.
            </p>
          </div>
          {velas.length > 1 && (
            <>
              <div className="ar-tabs">
                {[60, 120, 250].map((n) => (
                  <button key={n} className={cantidad === n ? "on" : ""} onClick={() => setCantidad(n)}>
                    {n} RUEDAS
                  </button>
                ))}
              </div>
              <GraficoAr velas={velas} cantidad={cantidad} />
              <p className="ar-mute" style={{ fontSize: 10 }}>{TEXTO_SIN_FOOTPRINT}</p>
            </>
          )}
          <MentesPanel mentes={lectura.mentes} consenso={lectura.consenso} />
          {lectura.mentes.some((m) => m.criterios.some((c) => c.valor.startsWith("falta el"))) && (
            <button className="ar-chip-btn" onClick={() => void leerPanel()} disabled={panel !== null}>
              {panel ? `LEYENDO EL PANEL ${panel.hechos}/${panel.total}…` : "LEER TODO EL PANEL PARA COMPARAR (fuerza relativa y riesgo)"}
            </button>
          )}
          <AgentesPanel agentes={lectura.agentes} />
        </>
      )}
    </div>
  );
}
