"use client";

/**
 * El gráfico de un papel de BYMA con el estilo de las terminales (el mismo que usa open.bymadata): lightweight-charts de
 * TradingView (Apache 2.0, gratis, corre en el navegador). Velas diarias con volumen, media 200 y EMA 50, y por capas que
 * se prenden y apagan: niveles con estrellas, la zona de compra de Fibonacci con sus extensiones y las líneas de tendencia.
 * Abajo, el RSI 14. Se mueve arrastrando y se acerca con la rueda o pellizcando; arriba, apertura, máximo, mínimo y cierre
 * de la rueda que se señala. Ruedas cerradas solamente. No es asesoramiento financiero.
 */
import { useEffect, useRef, useState } from "react";
import type { IChartApi, MouseEventParams, Time } from "lightweight-charts";
import type { AnalisisAr } from "@/lib/mercado-ar-tecnico";
import { lineAt } from "@/lib/trendlines";
import { ema, rsi } from "@/lib/oscillators";
import type { SwingCandle } from "@/lib/swing-entries";

type Capas = { medias: boolean; niveles: boolean; fib: boolean; lineas: boolean };
type Leyenda = { fecha: string; o: number; h: number; l: number; c: number; cambio: number | null; v: number };

const dia = (t: number) => new Date(t).toISOString().slice(0, 10) as Time;
const num = (x: number) => x.toLocaleString("es-AR", { maximumFractionDigits: Math.abs(x) >= 1000 ? 1 : 2 });
const COLOR = { sube: "#26a69a", baja: "#ef5350", ema: "#55d6be", media: "#f4b84a", fib: "#39f29a", ext: "#a78bfa", res: "#ef5350", sop: "#26a69a" };

function leyendaDe(v: SwingCandle[], k: number): Leyenda | null {
  const c = v[k];
  if (!c) return null;
  const p = v[k - 1];
  return { fecha: new Date(c.openTime).toLocaleDateString("es-AR", { timeZone: "UTC" }), o: c.open, h: c.high, l: c.low, c: c.close, cambio: p ? (c.close / p.close - 1) * 100 : null, v: c.volume };
}

export default function GraficoTv({ velas, cantidad, analisis, ticker }: { velas: SwingCandle[]; cantidad: number; analisis: AnalisisAr; ticker: string }) {
  const caja = useRef<HTMLDivElement>(null);
  const [capas, setCapas] = useState<Capas>({ medias: true, niveles: true, fib: true, lineas: false });
  const [leyenda, setLeyenda] = useState<Leyenda | null>(null);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    const el = caja.current;
    if (!el || velas.length < 2) return;
    let chart: IChartApi | null = null;
    let vivo = true;
    void (async () => {
      let lw: typeof import("lightweight-charts");
      try {
        lw = await import("lightweight-charts");
      } catch {
        if (vivo) setFallo(true);
        return;
      }
      if (!vivo) return;
      const ancho = el.clientWidth;
      // En el celular los nombres de las líneas taparían las velas: queda solo el precio en el eje.
      const t = (texto: string) => (ancho < 500 ? "" : texto);
      chart = lw.createChart(el, {
        autoSize: true,
        layout: { background: { color: "#0b1220" }, textColor: "#9fb0c8", fontSize: ancho < 500 ? 10 : 12, panes: { separatorColor: "#1e2a3d" } },
        grid: { vertLines: { color: "#152033" }, horzLines: { color: "#152033" } },
        rightPriceScale: { borderColor: "#24324a" },
        timeScale: { borderColor: "#24324a", rightOffset: 4, barSpacing: 8 },
        crosshair: { mode: lw.CrosshairMode.Normal },
        localization: { locale: "es-AR", priceFormatter: num },
      });
      const velasSerie = chart.addSeries(lw.CandlestickSeries, { upColor: COLOR.sube, downColor: COLOR.baja, borderVisible: false, wickUpColor: COLOR.sube, wickDownColor: COLOR.baja });
      velasSerie.setData(velas.map((c) => ({ time: dia(c.openTime), open: c.open, high: c.high, low: c.low, close: c.close })));
      // El volumen va al pie del mismo panel, con su propia escala.
      const vol = chart.addSeries(lw.HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      vol.setData(velas.map((c, k) => ({ time: dia(c.openTime), value: c.volume, color: k && c.close < velas[k - 1].close ? "#ef535055" : "#26a69a55" })));
      const cierres = velas.map((c) => c.close);
      if (capas.medias) {
        const e50 = ema(cierres, 50);
        const linea = (vals: (number | null)[], color: string, titulo: string) => {
          const s = chart!.addSeries(lw.LineSeries, { color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: t(titulo) });
          s.setData(vals.flatMap((x, k) => (x === null ? [] : [{ time: dia(velas[k].openTime), value: x }])));
        };
        linea(e50, COLOR.ema, "EMA 50");
        linea(cierres.map((_, k) => (k >= 199 ? cierres.slice(k - 199, k + 1).reduce((s, x) => s + x, 0) / 200 : null)), COLOR.media, "MEDIA 200");
      }
      if (capas.niveles) {
        for (const n of analisis.niveles) {
          velasSerie.createPriceLine({ price: n.price, color: n.kind === "RESISTENCIA" ? COLOR.res : COLOR.sop, lineWidth: n.stars >= 3 ? 2 : 1, lineStyle: lw.LineStyle.Dashed, axisLabelVisible: true, title: t(`${n.kind === "RESISTENCIA" ? "R" : "S"} ${"★".repeat(n.stars)}`) });
        }
      }
      const f = analisis.fib;
      if (capas.fib && f) {
        velasSerie.createPriceLine({ price: f.zona.alto, color: COLOR.fib, lineWidth: 2, lineStyle: lw.LineStyle.Solid, axisLabelVisible: true, title: t("COMPRA FIB 0,618") });
        velasSerie.createPriceLine({ price: f.zona.bajo, color: COLOR.fib, lineWidth: 2, lineStyle: lw.LineStyle.Solid, axisLabelVisible: true, title: t("COMPRA FIB 0,786") });
        for (const x of f.extensiones) velasSerie.createPriceLine({ price: x.precio, color: COLOR.ext, lineWidth: 1, lineStyle: lw.LineStyle.Dotted, axisLabelVisible: true, title: t(`EXT ${String(x.r).replace(".", ",")}`) });
        if (f.plan) velasSerie.createPriceLine({ price: f.plan.stop, color: COLOR.baja, lineWidth: 1, lineStyle: lw.LineStyle.Dotted, axisLabelVisible: true, title: t("SL FIB") });
      }
      if (capas.lineas) {
        for (const l of analisis.lineas) {
          const fin = velas.length - 1;
          if (l.a >= fin) continue;
          const s = chart.addSeries(lw.LineSeries, { color: l.side === "RESISTENCIA" ? "#ff8a8a" : "#7cf0bd", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
          s.setData([
            { time: dia(velas[l.a].openTime), value: lineAt(l, l.a) },
            { time: dia(velas[fin].openTime), value: lineAt(l, fin) },
          ]);
        }
      }
      // RSI 14 en su propio panel, con 30 y 70.
      const r = rsi(cierres, 14);
      const rsiSerie = chart.addSeries(lw.LineSeries, { color: "#a78bfa", lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: t("RSI 14") }, 1);
      rsiSerie.setData(r.flatMap((x, k) => (x === null ? [] : [{ time: dia(velas[k].openTime), value: x }])));
      rsiSerie.createPriceLine({ price: 70, color: "#ef535077", lineWidth: 1, lineStyle: lw.LineStyle.Dashed, axisLabelVisible: false, title: "" });
      rsiSerie.createPriceLine({ price: 30, color: "#26a69a77", lineWidth: 1, lineStyle: lw.LineStyle.Dashed, axisLabelVisible: false, title: "" });
      chart.panes()[1]?.setHeight(ancho < 500 ? 70 : 100);
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, velas.length - cantidad), to: velas.length + 3 });
      const indice = new Map(velas.map((c, k) => [dia(c.openTime) as string, k]));
      chart.subscribeCrosshairMove((p: MouseEventParams<Time>) => {
        const k = p.time !== undefined ? indice.get(p.time as string) : undefined;
        setLeyenda(k === undefined ? null : leyendaDe(velas, k));
      });
    })();
    return () => {
      vivo = false;
      chart?.remove();
    };
  }, [velas, cantidad, analisis, capas]);

  const ley = leyenda ?? leyendaDe(velas, velas.length - 1);
  const capa = (k: keyof Capas, texto: string) => (
    <button key={k} className={capas[k] ? "on" : ""} aria-pressed={capas[k]} onClick={() => setCapas((c) => ({ ...c, [k]: !c[k] }))}>
      {texto}
    </button>
  );
  if (fallo) return <p className="ar-mute">No se pudo cargar el gráfico.</p>;
  return (
    <div className="ar-tv">
      {ley && (
        <div className="ar-tv-leyenda">
          <b>{ticker}, D</b> <span>{ley.fecha}</span> <span>A {num(ley.o)}</span> <span>Máx {num(ley.h)}</span> <span>Mín {num(ley.l)}</span> <span>C {num(ley.c)}</span>{" "}
          <span className={ley.cambio === null ? "" : ley.cambio >= 0 ? "ar-up" : "ar-down"}>{ley.cambio === null ? "" : `${ley.cambio >= 0 ? "+" : ""}${ley.cambio.toLocaleString("es-AR", { maximumFractionDigits: 2 })} %`}</span>{" "}
          <span className="ar-mute">Vol {ley.v.toLocaleString("es-AR")}</span>
        </div>
      )}
      <div className="ar-tabs ar-tv-capas">
        {capa("medias", "MEDIAS")}
        {capa("niveles", "NIVELES ★")}
        {capa("fib", "FIBONACCI")}
        {capa("lineas", "LÍNEAS DE TENDENCIA")}
      </div>
      <div ref={caja} className="ar-tv-caja" />
    </div>
  );
}
