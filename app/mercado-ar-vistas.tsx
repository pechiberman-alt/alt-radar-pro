"use client";

/**
 * Las vistas de MERCADO AR que comparten el panel y el MAPA: el gráfico diario de un papel (velas, medias, soportes y
 * resistencias, perfil de volumen aproximado, RSI y MACD), las MENTES (lib/mentes-inversoras.ts) y los agentes del
 * laboratorio (lib/mercado-ar-agentes.ts), y MapaAr, la vista completa de un papel que el MAPA muestra en lugar del mapa de
 * liquidaciones (que para acciones no existe y se dice). Todo con ruedas cerradas; no es asesoramiento financiero.
 */
import { useEffect, useId, useMemo, useState } from "react";
import { PAPELES_AR, TEXTO_SIN_FOOTPRINT, type PapelAr } from "@/lib/mercado-ar";
import { AVISO_MENTES, type Consenso, type LecturaMente } from "@/lib/mentes-inversoras";
import { EXCLUIDOS_AR, ESTUDIO_AR, type AgenteEnPapel } from "@/lib/mercado-ar-agentes";
import { medir } from "@/lib/estrategias";
import { MUESTRA_MINIMA } from "@/lib/registro";
import { perfilAprox, TEXTO_SIN_LIQUIDACIONES } from "@/lib/mercado-ar-mapa";
import { analisisAr, ZONA_COMPRA, type AnalisisAr } from "@/lib/mercado-ar-tecnico";
import { lineAt } from "@/lib/trendlines";
import { ema, macd, rsi } from "@/lib/oscillators";
import { cargarPanel, leerPapel, type LecturaPapel } from "@/lib/mercado-ar-cliente";
import type { SwingCandle } from "@/lib/swing-entries";

export const fmt = (x: number | null | undefined, d = 2) =>
  x === null || x === undefined || !Number.isFinite(x) ? "—" : x.toLocaleString("es-AR", { maximumFractionDigits: Math.abs(x) >= 1000 ? Math.min(d, 1) : d, minimumFractionDigits: 0 });
export const fmtPct = (x: number | null | undefined, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : `${x > 0 ? "+" : ""}${x.toLocaleString("es-AR", { maximumFractionDigits: d })} %`);
const fecha = (t: number) => new Date(t).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
const estrellas = (n: number) => "★".repeat(n);

const CLASE_POSTURA: Record<string, string> = { "A FAVOR": "ok", "EN CONTRA": "mal", NEUTRAL: "alerta", "SIN DATOS": "", INFORMA: "" };

// ── Gráfico ──

export function GraficoAr({ velas, cantidad, analisis }: { velas: SwingCandle[]; cantidad: number; analisis: AnalisisAr }) {
  const clip = `ar-precio-${useId().replace(/:/g, "")}`;
  const g = useMemo(() => {
    if (velas.length < 2) return null;
    const cierres = velas.map((c) => c.close);
    const e50 = ema(cierres, 50);
    const m200: (number | null)[] = cierres.map((_, k) => (k >= 199 ? cierres.slice(k - 199, k + 1).reduce((s, x) => s + x, 0) / 200 : null));
    const r = rsi(cierres, 14);
    const md = macd(cierres);
    const desde = Math.max(0, velas.length - cantidad);
    const v = velas.slice(desde);
    const niv = analisis.niveles;
    const fib = analisis.fib;
    const perfil = perfilAprox(v);
    const W = 360;
    const ejeX = 50;
    const anchoV = (W - ejeX) / v.length;
    const H = 200;
    const precios = [...niv.map((n) => n.price), ...(fib ? [fib.zona.bajo, fib.zona.alto] : [])];
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
    return { v, x, y, anchoV, W, H, ejeX, linea, e50, m200, r: r.slice(desde), md, hist, maxHist, desde, niv, fib, perfil, maxVol, maxPerfil, loV, hiV };
  }, [velas, cantidad, analisis]);
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
      {g.fib && (
        <g>
          <rect x={Math.max(0, x(velas.findIndex((c) => c.openTime === g.fib!.desde) - g.desde))} width={W - ejeX - Math.max(0, x(velas.findIndex((c) => c.openTime === g.fib!.desde) - g.desde))} y={y(g.fib.zona.alto)} height={Math.max(1, y(g.fib.zona.bajo) - y(g.fib.zona.alto))} fill="#39f29a1f" stroke="#39f29a66" strokeWidth="0.6" />
          <text x={W - ejeX - 2} y={y(g.fib.zona.alto) + 8} fill="#39f29a" fontSize="7.5" fontFamily="monospace" textAnchor="end">ZONA DE COMPRA FIB {String(ZONA_COMPRA[0]).replace(".", ",")}–{String(ZONA_COMPRA[1]).replace(".", ",")}</text>
          {[...g.fib.niveles, ...g.fib.extensiones].map((n) => (
            <g key={`f${n.r}`}>
              <line x1={0} x2={W - ejeX} y1={y(n.precio)} y2={y(n.precio)} stroke="#a78bfa" strokeWidth="0.5" strokeDasharray="1 2" />
              <text x={W - ejeX - 2} y={y(n.precio) - 1.5} fill="#a78bfa" fontSize="6.5" fontFamily="monospace" textAnchor="end">{String(n.r).replace(".", ",")}</text>
            </g>
          ))}
        </g>
      )}
      {analisis.fvg.map((f, k) => {
        const i = f.index - g.desde;
        if (i < 0) return null;
        return <rect key={`g${k}`} x={x(i)} width={W - ejeX - x(i)} y={y(f.high)} height={Math.max(0.8, y(f.low) - y(f.high))} fill={f.side === "ALCISTA" ? "#55d6be14" : "#ff596414"} />;
      })}
      {g.niv.map((n, k) => (
        <g key={`n${k}`}>
          {/* Dos etiquetas casi en el mismo precio se pisan: la de menos estrellas no lleva texto. */}
          <line x1={0} x2={W - ejeX} y1={y(n.price)} y2={y(n.price)} stroke={n.kind === "RESISTENCIA" ? "#ff5964" : "#39f29a"} strokeDasharray="4 3" strokeWidth={0.5 + n.stars * 0.25} />
          <text x={2} y={y(n.price) - 2} fill={n.kind === "RESISTENCIA" ? "#ff5964" : "#39f29a"} fontSize="7.5" fontFamily="monospace" visibility={g.niv.some((o) => o !== n && Math.abs(y(o.price) - y(n.price)) < 9 && (o.stars > n.stars || (o.stars === n.stars && o.price > n.price))) ? "hidden" : "visible"}>
            {n.kind === "RESISTENCIA" ? "R" : "S"} {fmt(n.price)} {estrellas(n.stars)} {n.sources.slice(0, 2).map((f) => f.kind).join(" + ")}
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
      <defs>
        <clipPath id={clip}>
          <rect x={0} y={0} width={W - ejeX} height={H} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <polyline points={g.linea(g.e50)} fill="none" stroke="#55d6be" strokeWidth="1" />
        <polyline points={g.linea(g.m200)} fill="none" stroke="#f4b84a" strokeWidth="1.1" />
        {analisis.lineas.map((l, k) => {
          const a = Math.max(l.a, g.desde);
          const b = velas.length - 1;
          return <line key={`l${k}`} x1={x(a - g.desde)} x2={x(b - g.desde)} y1={y(lineAt(l, a))} y2={y(lineAt(l, b))} stroke={l.side === "RESISTENCIA" ? "#ff8a8a" : "#7cf0bd"} strokeWidth="0.9" />;
        })}
      </g>
      <text x={2} y={H - 2} fill="#55d6be" fontSize="8" fontFamily="monospace">EMA 50</text>
      <text x={40} y={H - 2} fill="#f4b84a" fontSize="8" fontFamily="monospace">MEDIA 200</text>
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

// ── Análisis técnico ──

const tasa = (a: number, n: number) => (n ? `${fmt((a / n) * 100, 0)} %` : "—");

export function TecnicoPanel({ analisis }: { analisis: AnalisisAr }) {
  const { fib, estructura, ruptura, banderas, wyckoff, preRuptura, divergencias, fvg, niveles } = analisis;
  const chips: { texto: string; clase: string }[] = [];
  chips.push({ texto: `ESTRUCTURA · ${estructura.tendencia}${estructura.tendencia !== "SIN DATOS" ? ` · ${estructura.detalle}` : ""}`, clase: estructura.tendencia === "ALCISTA" ? "ok" : estructura.tendencia === "BAJISTA" ? "mal" : "alerta" });
  if (ruptura) chips.push({ texto: `RUPTURA ${ruptura.direction} (línea) · ${ruptura.confirmed ? "confirmada" : "sin confirmar"} · ${ruptura.outcome.toLowerCase()}${ruptura.volumeMultiple ? ` · ${fmt(ruptura.volumeMultiple, 1)}× vol` : ""}`, clase: ruptura.direction === "ALCISTA" ? "ok" : "mal" });
  for (const b of banderas) chips.push({ texto: `${b.kind} · ${b.status} · objetivo ${fmt(b.target)}`, clase: b.kind === "BULL FLAG" ? "ok" : "mal" });
  if (wyckoff) chips.push({ texto: `WYCKOFF · ${wyckoff.kind} posible · ${wyckoff.phase}`, clase: "alerta" });
  if (preRuptura && preRuptura.state !== "QUIETO") chips.push({ texto: `${preRuptura.state} · ${preRuptura.score}/100 · ${preRuptura.side}${preRuptura.level ? ` · ${fmt(preRuptura.level)} (${preRuptura.touches} toques)` : ""}`, clase: preRuptura.side === "ALCISTA" ? "ok" : preRuptura.side === "BAJISTA" ? "mal" : "alerta" });
  for (const d of divergencias) chips.push({ texto: `DIVERGENCIA ${d.kind} ${d.side} · RSI · hace ${d.age} ruedas`, clase: d.side === "ALCISTA" ? "ok" : "mal" });
  if (fvg.length) chips.push({ texto: `FVG · ${fvg.filter((f) => f.side === "ALCISTA").length} de compra · ${fvg.filter((f) => f.side === "BAJISTA").length} de venta`, clase: "" });
  const h = fib?.historial;
  const resueltas = h ? h.aguantaron + h.fallaron : 0;
  return (
    <>
      <div className="ar-box">
        <h3>ZONA DE COMPRA FIBONACCI</h3>
        {!fib && <p>{analisis.fibMotivo}</p>}
        {fib && (
          <>
            <div className="ar-head">
              <span>
                Pierna alcista {fmt(fib.pierna.origen)} → {fmt(fib.pierna.extremo)} (terminó el {fecha(fib.desde)})
              </span>
              <span className={`ar-chip ${fib.estado === "EN LA ZONA" ? "ok" : fib.estado === "INVALIDADA" ? "mal" : "alerta"}`}>{fib.estado}</span>
            </div>
            <div className="ar-grid">
              {fib.niveles.map((n) => (
                <div key={n.r}>
                  <span>RETROCESO {String(n.r).replace(".", ",")}</span>
                  {fmt(n.precio)}
                </div>
              ))}
              {fib.extensiones.map((n) => (
                <div key={n.r}>
                  <span>EXTENSIÓN {String(n.r).replace(".", ",")}</span>
                  {fmt(n.precio)}
                </div>
              ))}
            </div>
            <div className="ar-plan">
              ZONA {fmt(fib.zona.bajo)} – {fmt(fib.zona.alto)}
              {fib.plan
                ? ` · entrada ${fmt(fib.plan.entrada)} · SL ${fmt(fib.plan.stop)} · TP1 ${fmt(fib.plan.tp1)} · TP2 ${fmt(fib.plan.tp2)} · TP3 ${fmt(fib.plan.tp3)} · R:R ${fmt(fib.plan.rr, 1)}`
                : " · sin plan: la pierna quedó invalidada (el precio perdió su origen)"}
            </div>
            <p>
              En este papel el precio volvió a la zona {h!.probadas} {h!.probadas === 1 ? "vez" : "veces"}: aguantó (volvió al máximo antes de perder el origen) {h!.aguantaron}, falló {h!.fallaron}
              {h!.abiertas ? `, ${h!.abiertas} sin resolver` : ""}. {resueltas ? `Aguantó ${tasa(h!.aguantaron, resueltas)} de ${resueltas}` : "Sin casos resueltos"}
              {resueltas < 15 ? " · muestra mínima" : ""}. Si en una misma rueda pasan las dos cosas, cuenta como falla. No es una probabilidad.
            </p>
          </>
        )}
      </div>
      <div className="ar-box">
        <h3>ANÁLISIS TÉCNICO</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {chips.map((c) => (
            <span key={c.texto} className={`ar-chip ${c.clase}`}>{c.texto}</span>
          ))}
        </div>
        {niveles.length > 0 && (
          <div className="ar-scroll">
            <table className="ar-table">
              <tbody>
                {niveles.map((n) => (
                  <tr key={`${n.kind}${n.price}`}>
                    <td className={n.kind === "RESISTENCIA" ? "ar-down" : "ar-up"}>{n.kind === "RESISTENCIA" ? "R" : "S"} {fmt(n.price)}</td>
                    <td>{estrellas(n.stars)}</td>
                    <td className="ar-mute">{fmtPct(n.distancePct, 1)}</td>
                    <td className="ar-mute">{n.sources.map((f) => f.label).join(" + ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="ar-mute">
          Niveles: estructura diaria y semanal, máximo y mínimo de ayer y de la semana pasada, POC y área de valor (aproximados por rueda), números redondos y Fibonacci; más estrellas = más motivos coinciden en ese precio. Banderas, Wyckoff y rupturas son lecturas mecánicas del gráfico: si funcionaron se sabe después. No es asesoramiento financiero.
        </p>
      </div>
    </>
  );
}

// ── Ficha del papel ──

function Ficha({ velas }: { velas: SwingCandle[] }) {
  const v = (n: number) => (velas.length > n ? (velas.at(-1)!.close / velas[velas.length - 1 - n].close - 1) * 100 : null);
  const anio = velas.slice(-252);
  const lo = Math.min(...anio.map((c) => c.low));
  const hi = Math.max(...anio.map((c) => c.high));
  const cierre = velas.at(-1)!.close;
  const pos = hi > lo ? ((cierre - lo) / (hi - lo)) * 100 : 50;
  const celdas: [string, number | null][] = [["1 SEMANA", v(5)], ["1 MES", v(21)], ["3 MESES", v(63)], ["6 MESES", v(126)], ["1 AÑO", v(250)], ["DESDE EL MÁXIMO", (cierre / hi - 1) * 100]];
  return (
    <>
      <div className="ar-ficha">
        {celdas.map(([t, x]) => (
          <div key={t}>
            <span>{t}</span>
            <b className={x === null ? "ar-mute" : x >= 0 ? "ar-up" : "ar-down"}>{fmtPct(x, 1)}</b>
          </div>
        ))}
      </div>
      <div>
        <div className="ar-head ar-mute" style={{ fontSize: 10 }}>
          <span>Mín. {anio.length >= 250 ? "52 sem." : `${anio.length} ruedas`} {fmt(lo)}</span>
          <span>Máx. {fmt(hi)}</span>
        </div>
        <div className="ar-rango" role="img" aria-label={`El cierre está al ${Math.round(pos)} % del rango`}>
          <i style={{ left: `calc(${pos}% - 1px)` }} />
        </div>
      </div>
    </>
  );
}

// ── Mentes ──

export function MentesPanel({ mentes, consenso }: { mentes: LecturaMente[]; consenso: Consenso }) {
  const [abierta, setAbierta] = useState<string | null>(null);
  return (
    <div className="ar-box">
      <h3>MENTES · {consenso.aFavor} a favor · {consenso.enContra} en contra · {consenso.neutral} neutrales · {consenso.sinDatos} sin datos</h3>
      <div className="ar-avatares">
        {mentes.map((m) => (
          <button key={m.id} className={`ar-avatar ${CLASE_POSTURA[m.postura]}`} onClick={() => setAbierta(abierta === m.id ? null : m.id)} title={`${m.mente}: ${m.postura}`}>
            <i>{m.mente.split(" ").filter((w) => /^[A-ZÁÉÍÓÚ]/.test(w)).slice(0, 2).map((w) => w[0]).join("")}</i>
            {m.mente.split(" (")[0].split(" ").at(-1)}
          </button>
        ))}
      </div>
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
  const velas = useMemo(() => s?.serie?.velas ?? [], [s]);
  const analisis = useMemo(() => analisisAr(velas), [velas]);
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
            {velas.length > 21 && <Ficha velas={velas} />}
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
              <GraficoAr velas={velas} cantidad={cantidad} analisis={analisis} />
              <p className="ar-mute" style={{ fontSize: 10 }}>{TEXTO_SIN_FOOTPRINT}</p>
            </>
          )}
          {velas.length > 1 && <TecnicoPanel analisis={analisis} />}
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
