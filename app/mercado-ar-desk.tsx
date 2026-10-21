"use client";

/**
 * MERCADO AR: panel del mercado argentino (acciones + CEDEARs) de BYMA,
 * con velas diarias de Yahoo Finance (demora: BYMA publica rezagado).
 * Lectura diaria: medias, RSI, ATR, distancia a máximos y mínimos,
 * volumen relativo. Sin footprint (BYMA no publica operaciones gratis).
 * Sin asesoramiento financiero.
 */

import { useState, useEffect } from "react";
import { ACCIONES_AR, CEDEARS, TEXTO_SIN_FOOTPRINT, type PapelAr, type SerieAr } from "@/lib/mercado-ar";
import { lecturaDiaria, estadoSerie } from "@/lib/mercado-ar";
import styles from "./mercado-ar-desk.module.css";

type ResultadoAr = { serie: SerieAr | null; fuente: string | null; edadSeg: number; error: string | null };

// Mini SVG line chart: closes con EMA 50 y 200
function MiniChart({ velas, ema50, ema200 }: { velas: SerieAr["velas"]; ema50: number | null; ema200: number | null }) {
  if (!velas.length) return null;
  const width = 200,
    height = 60;
  const cierre = velas.map((v) => v.close);
  const min = Math.min(...cierre, ema50 ?? Infinity, ema200 ?? Infinity);
  const max = Math.max(...cierre, ema50 ?? -Infinity, ema200 ?? -Infinity);
  const range = max - min || 1;

  const points = cierre.map((c, i) => ({ x: (i / (cierre.length - 1)) * width, y: height - ((c - min) / range) * height }));
  const pathClose = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  return (
    <svg width={width} height={height} className={styles.miniChart}>
      <path d={pathClose} fill="none" stroke="currentColor" strokeWidth="1.5" />
      {ema50 !== null && <line x1="0" y1={height - ((ema50 - min) / range) * height} x2={width} y2={height - ((ema50 - min) / range) * height} stroke="rgba(255,165,0,0.5)" strokeWidth="1" strokeDasharray="2,2" />}
      {ema200 !== null && <line x1="0" y1={height - ((ema200 - min) / range) * height} x2={width} y2={height - ((ema200 - min) / range) * height} stroke="rgba(100,100,255,0.5)" strokeWidth="1" strokeDasharray="2,2" />}
    </svg>
  );
}

function PaperRow({ paper, onSelect }: { paper: PapelAr; onSelect: (p: PapelAr) => void }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ResultadoAr | null>(null);

  useEffect(() => {
    const fetch_ = async () => {
      try {
        const r = await fetch(`/api/mercado-ar?simbolo=${encodeURIComponent(paper.yahoo)}`);
        const j = (await r.json()) as ResultadoAr;
        setData(j);
      } catch {
        setData({ serie: null, fuente: null, edadSeg: 0, error: "no se pudo leer" });
      } finally {
        setLoading(false);
      }
    };
    fetch_();
  }, [paper.yahoo]);

  const cierre = data?.serie?.velas.at(-1)?.close;
  const cambio = data?.serie?.velas.length ? ((data.serie.velas.at(-1)!.close - data.serie.velas.at(-2)!.close) / data.serie.velas.at(-2)!.close) * 100 : null;

  return (
    <button className={styles.row} onClick={() => onSelect(paper)} title={paper.nombre}>
      <div className={styles.ticker}>{paper.ticker}</div>
      <div className={styles.precio}>{cierre?.toFixed(2) || "—"}</div>
      <div className={styles.cambio} data-positivo={cambio && cambio > 0}>{cambio?.toFixed(2) || "—"}%</div>
      <div className={styles.edad}>{data?.edadSeg ? Math.floor(data.edadSeg / 60) + "m" : "—"}</div>
      {loading && <div className={styles.spinner} />}
      {data?.error && <div className={styles.error} title={data.error}>⚠</div>}
    </button>
  );
}

function DetailPanel({ paper, data, close }: { paper: PapelAr | null; data: ResultadoAr | null; close: () => void }) {
  const [ahora] = useState(() => Date.now());

  if (!paper || !data?.serie) return null;

  const lectura = data.serie.velas.length ? lecturaDiaria(data.serie.velas) : null;
  const { estado, motivo } = estadoSerie(data.serie, ahora);

  return (
    <div className={styles.detail}>
      <button className={styles.closeBtn} onClick={close}>✕</button>
      <div className={styles.detailHead}>
        <div>
          <div className={styles.detailTicker}>{paper.ticker}</div>
          <div className={styles.detailNombre}>{paper.nombre}</div>
          {paper.subyacente && <div className={styles.subyacente}> subyacente: {paper.subyacente}</div>}
        </div>
        <div className={styles.meta}>
          <div>
            <strong>Cierre:</strong> {data.serie.meta.precio?.toFixed(2) || "—"} {data.serie.meta.moneda || "—"}
          </div>
          <div>
            <strong>Demora:</strong> {data.serie.meta.demoraMin ? `${data.serie.meta.demoraMin} min` : "—"}
          </div>
          <div>
            <strong>Estado:</strong> <span className={styles[`estado-${estado}`]}>{estado}</span>
            {motivo && <div className={styles.motivo}>{motivo}</div>}
          </div>
        </div>
      </div>

      {lectura && (
        <div className={styles.lectura}>
          <div className={styles.titulo2}>Lectura Diaria</div>
          <div className={styles.grid}>
            <div><strong>Ruedas:</strong> {lectura.ruedas}</div>
            <div><strong>Var 1d:</strong> {lectura.var1?.toFixed(2) || "—"}%</div>
            <div><strong>Var 5d:</strong> {lectura.var5?.toFixed(2) || "—"}%</div>
            <div><strong>Var 20d:</strong> {lectura.var20?.toFixed(2) || "—"}%</div>
            <div><strong>EMA 50:</strong> {lectura.ema50?.toFixed(2) || "—"}</div>
            <div><strong>EMA 200:</strong> {lectura.ema200?.toFixed(2) || "—"}</div>
            <div><strong>Tendencia:</strong> {lectura.tendencia || "—"}</div>
            <div><strong>RSI 14:</strong> {lectura.rsi14?.toFixed(1) || "—"}</div>
            <div><strong>ATR %:</strong> {lectura.atrPct?.toFixed(2) || "—"}</div>
            <div><strong>Desde máx (1y):</strong> {lectura.desdeMaximo?.toFixed(2) || "—"}%</div>
            <div><strong>Desde mín (1y):</strong> {lectura.desdeMinimo?.toFixed(2) || "—"}%</div>
            <div><strong>Vol relativo:</strong> {lectura.volumenRelativo?.toFixed(2) || "—"}x</div>
          </div>
          {lectura.faltantes.length > 0 && (
            <div className={styles.faltantes}>
              Datos incompletos: {lectura.faltantes.join("; ")}
            </div>
          )}
          <div className={styles.chart}>
            <MiniChart velas={data.serie.velas} ema50={lectura.ema50} ema200={lectura.ema200} />
          </div>
        </div>
      )}

      <div className={styles.disclaimer}>⚠️ Esto no es asesoramiento financiero. Los datos de BYMA llegan con demora ({data.serie.meta.demoraMin}+ min); {TEXTO_SIN_FOOTPRINT}</div>
      <div className={styles.fuente}>Fuente: {data.fuente} (edad: {Math.floor(data.edadSeg / 60)} min)</div>
    </div>
  );
}

export default function MercadoArDesk() {
  const [tab, setTab] = useState<"acciones" | "cedears">("acciones");
  const [selected, setSelected] = useState<PapelAr | null>(null);
  const [selectedData, setSelectedData] = useState<ResultadoAr | null>(null);

  const papeles = tab === "acciones" ? ACCIONES_AR : CEDEARS;

  useEffect(() => {
    if (!selected) return;
    const fetch_ = async () => {
      try {
        const r = await fetch(`/api/mercado-ar?simbolo=${encodeURIComponent(selected.yahoo)}`);
        setSelectedData((await r.json()) as ResultadoAr);
      } catch {
        setSelectedData({ serie: null, fuente: null, edadSeg: 0, error: "error" });
      }
    };
    fetch_();
  }, [selected]);

  return (
    <div className={styles.container}>
      <div className={styles.tabs}>
        <button className={tab === "acciones" ? styles.active : ""} onClick={() => { setTab("acciones"); setSelected(null); }}>
          ACCIONES ({ACCIONES_AR.length})
        </button>
        <button className={tab === "cedears" ? styles.active : ""} onClick={() => { setTab("cedears"); setSelected(null); }}>
          CEDEARS ({CEDEARS.length})
        </button>
      </div>

      <div className={styles.lista}>
        <div className={styles.header}>
          <div className={styles.ticker}>Ticker</div>
          <div className={styles.precio}>Precio</div>
          <div className={styles.cambio}>Cambio</div>
          <div className={styles.edad}>Edad</div>
        </div>
        {papeles.map((p) => (
          <PaperRow key={p.yahoo} paper={p} onSelect={setSelected} />
        ))}
      </div>

      <DetailPanel paper={selected} data={selectedData} close={() => { setSelected(null); setSelectedData(null); }} />
    </div>
  );
}
