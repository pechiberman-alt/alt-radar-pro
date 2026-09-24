"use client";

import { useEffect, useMemo, useState } from "react";
import type { CryptoNewsItem, NewsCategory } from "@/lib/crypto-news";
import type { FearGreed } from "@/lib/fear-greed";
import { FUTURES_BASES } from "@/lib/market-fetch";

type Payload = { fearGreed: FearGreed | null; news: CryptoNewsItem[]; sources: string[]; failed: string[] };
type Leverage = { longPct: number | null; funding: number | null };

const MAJORS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];

async function loadLeverage(): Promise<Leverage> {
  const out: Leverage = { longPct: null, funding: null };
  for (const base of FUTURES_BASES) {
    try {
      const r = await fetch(`${base}/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=1`, { cache: "no-store" });
      if (!r.ok) continue;
      const row = ((await r.json()) as { longAccount?: string }[])[0];
      const v = Number(row?.longAccount);
      if (Number.isFinite(v)) out.longPct = v * 100;
      break;
    } catch {
      // Next mirror.
    }
  }
  for (const base of FUTURES_BASES) {
    try {
      const r = await fetch(`${base}/fapi/v1/premiumIndex`, { cache: "no-store" });
      if (!r.ok) continue;
      const rows = (await r.json()) as { symbol?: string; lastFundingRate?: string }[];
      const rates = rows.filter((x) => MAJORS.includes(x.symbol ?? "")).map((x) => Number(x.lastFundingRate)).filter(Number.isFinite);
      if (rates.length) out.funding = rates.reduce((a, b) => a + b, 0) / rates.length;
      break;
    } catch {
      // Next mirror.
    }
  }
  return out;
}

const ago = (t: number) => {
  const m = Math.max(0, Math.round((Date.now() - t) / 60_000));
  return m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`;
};
const delta = (now: number, then: number | null) => (then === null ? "—" : `${now - then >= 0 ? "+" : ""}${now - then}`);
const zoneClass = (v: number) => (v <= 24 ? "xf" : v <= 44 ? "f" : v <= 55 ? "n" : v <= 75 ? "g" : "xg");

function Gauge({ value }: { value: number }) {
  // Semicircle 0–100; the needle angle maps value to 180° → 0°.
  const angle = Math.PI * (1 - value / 100);
  const cx = 100, cy = 95, r = 78;
  const nx = cx + (r - 8) * Math.cos(angle);
  const ny = cy - (r - 8) * Math.sin(angle);
  const arc = (from: number, to: number) => {
    const a0 = Math.PI * (1 - from / 100), a1 = Math.PI * (1 - to / 100);
    return `M ${cx + r * Math.cos(a0)} ${cy - r * Math.sin(a0)} A ${r} ${r} 0 0 1 ${cx + r * Math.cos(a1)} ${cy - r * Math.sin(a1)}`;
  };
  return (
    <svg viewBox="0 0 200 110" className="fg-gauge" role="img" aria-label={`Miedo y avaricia ${value}`}>
      {[[0, 25, "xf"], [25, 45, "f"], [45, 55, "n"], [55, 75, "g"], [75, 100, "xg"]].map(([a, b, c]) => (
        <path key={String(c)} d={arc(Number(a), Number(b))} className={`fg-arc ${c}`} />
      ))}
      <line x1={cx} y1={cy} x2={nx} y2={ny} className="fg-needle" />
      <circle cx={cx} cy={cy} r={4} className="fg-hub" />
    </svg>
  );
}

export default function SentimentDesk() {
  const [data, setData] = useState<Payload | null>(null);
  const [lev, setLev] = useState<Leverage>({ longPct: null, funding: null });
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<NewsCategory | "TODAS">("TODAS");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 300_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [r, l] = await Promise.all([fetch("/api/sentiment", { cache: "no-store" }), loadLeverage()]);
        if (!alive) return;
        setLev(l);
        if (!r.ok) throw new Error();
        setData((await r.json()) as Payload);
        setError("");
      } catch {
        if (alive) setError("SENTIMIENTO NO DISPONIBLE");
      }
    })();
    return () => {
      alive = false;
    };
  }, [tick]);

  const categories = useMemo(() => [...new Set((data?.news ?? []).map((n) => n.category))], [data]);
  const shown = (data?.news ?? []).filter((n) => filter === "TODAS" || n.category === filter);
  const fg = data?.fearGreed ?? null;

  return (
    <section className="panel sent-desk" id="noticias">
      <div className="panel-head">
        <div>
          <p className="eyebrow">NOTICIAS Y SENTIMIENTO</p>
          <h2>Qué mueve el mercado y cómo se siente</h2>
        </div>
        <span className={error ? "badge critical" : "badge"}>{error ? "NO DISPONIBLE" : data ? `${data.news.length} NOTICIAS` : "CARGANDO…"}</span>
      </div>

      <div className="sent-top">
        <div className={`fg-card z-${fg ? zoneClass(fg.value) : "n"}`}>
          <span className="sent-label">MIEDO Y AVARICIA</span>
          {fg ? (
            <>
              <Gauge value={fg.value} />
              <b className="fg-value">{fg.value}</b>
              <strong className="fg-zone">{fg.zone}</strong>
              <div className="fg-deltas">
                <span>ayer <b>{delta(fg.value, fg.yesterday)}</b></span>
                <span>semana <b>{delta(fg.value, fg.weekAgo)}</b></span>
                <span>mes <b>{delta(fg.value, fg.monthAgo)}</b></span>
              </div>
              <svg viewBox={`0 0 ${Math.max(1, fg.series.length - 1)} 100`} preserveAspectRatio="none" className="fg-spark">
                <polyline points={fg.series.map((p, i) => `${i},${100 - p.value}`).join(" ")} />
              </svg>
              <p>{fg.reading}</p>
            </>
          ) : (
            <p className="sent-none">Sin dato del índice.</p>
          )}
        </div>

        <div className="lev-card">
          <span className="sent-label">APALANCAMIENTO · BINANCE</span>
          <div className="lev-row">
            <span>Cuentas en largo · BTC</span>
            <b>{lev.longPct === null ? "—" : `${lev.longPct.toFixed(1)}%`}</b>
          </div>
          {lev.longPct !== null && (
            <div className="lev-bar"><i style={{ width: `${lev.longPct}%` }} /></div>
          )}
          <div className="lev-row">
            <span>Funding promedio · majors</span>
            <b className={lev.funding === null ? "" : lev.funding >= 0 ? "positive" : "negative"}>
              {lev.funding === null ? "—" : `${(lev.funding * 100).toFixed(4)}%`}
            </b>
          </div>
          <p>
            {lev.funding === null
              ? "Sin dato de futuros desde esta red."
              : lev.funding > 0.0003
                ? "Funding alto: los largos pagan caro por mantenerse. Mucho apalancamiento alcista es combustible para una limpieza hacia abajo."
                : lev.funding < 0
                  ? "Funding negativo: los cortos pagan. Cortos amontonados son combustible para un squeeze al alza."
                  : "Funding normal: el apalancamiento no está inclinado de forma extrema."}
          </p>
        </div>
      </div>

      <div className="news-filters">
        {(["TODAS", ...categories] as (NewsCategory | "TODAS")[]).map((c) => (
          <button key={c} className={filter === c ? "on" : ""} onClick={() => setFilter(c)}>{c}</button>
        ))}
      </div>

      <div className="news-list">
        {shown.map((n) => (
          <a key={n.url} href={n.url} target="_blank" rel="noopener noreferrer" className={`news-item i-${n.impact.toLowerCase()}`}>
            <div className="news-meta">
              <b className={`imp i-${n.impact.toLowerCase()}`}>{n.impact}</b>
              <em>{n.category}</em>
              <i className={`tone t-${n.tone.toLowerCase()}`} title={`Tono del titular: ${n.tone.toLowerCase()}`} />
              {n.assets.map((a) => <u key={a}>{a}</u>)}
            </div>
            <strong>{n.title}</strong>
            <small>{n.source} · {ago(n.publishedAt)}</small>
          </a>
        ))}
        {data && !shown.length && <p className="sent-none">Sin noticias en esta categoría en las últimas 48 h.</p>}
      </div>

      <p className="sent-caveat">
        Clasificación automática por palabras clave del titular. El punto de color es el <b>tono del titular</b>, no
        una predicción: el mercado muchas veces vende buenas noticias y compra malas. Titulares en inglés, de
        {" "}{data?.sources.join(", ") || "medios cripto"}{data?.failed.length ? ` (sin respuesta: ${data.failed.join(", ")})` : ""}.
        Índice de Miedo y Avaricia: alternative.me.
      </p>
    </section>
  );
}
