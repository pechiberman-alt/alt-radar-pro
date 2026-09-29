"use client";

import { useMemo, useState } from "react";
import { EMPTY_NOTE, groupTrades, rMultiple, type EquityPoint, type JTrade, type JournalStats, type TradeNote } from "@/lib/account-journal";
import { dur, money, monthLabel, monthOf, num, pct, pf, px, qty, share, stamp, usd, WEEKDAYS } from "./diario-format";

export type NoteMap = Record<string, TradeNote>;

/** Cumulative result and the drawdown under it. Labels are HTML, not SVG text,
 *  so they keep their size when the chart stretches to the panel's width. */
export function EquityChart({ points }: { points: EquityPoint[] }) {
  if (points.length < 2) return <p className="bot-none">Hacen falta al menos 2 operaciones cerradas para dibujar la curva.</p>;
  const W = 640;
  const H = 170;
  const DD = 54;
  const pad = 6;
  const cums = [0, ...points.map((p) => p.cum)];
  const lo = Math.min(...cums);
  const hi = Math.max(...cums);
  const span = hi - lo || 1;
  const x = (i: number) => pad + (i / (points.length - 1)) * (W - pad * 2);
  const y = (v: number) => pad + (1 - (v - lo) / span) * (H - pad * 2);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.cum).toFixed(1)}`).join(" ");
  const maxDd = Math.max(...points.map((p) => p.dd), 1e-9);
  const ddY = (d: number) => 4 + (d / maxDd) * (DD - 8);
  const ddLine = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${ddY(p.dd).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  return (
    <div className="dz-chart">
      <div className="dz-chart-foot"><span>Resultado acumulado</span><b className={last.cum >= 0 ? "up" : "down"}>{usd(last.cum)}</b></div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Curva de resultado acumulado">
        <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} className="dz-zero" />
        <path d={line} className={last.cum >= 0 ? "dz-eq up" : "dz-eq down"} />
      </svg>
      <div className="dz-chart-foot"><span>{stamp(points[0].t).slice(0, 10)}</span><span>{stamp(last.t).slice(0, 10)}</span></div>
      <svg viewBox={`0 0 ${W} ${DD}`} preserveAspectRatio="none" role="img" aria-label="Caída desde el máximo" className="dz-dd">
        <path d={ddLine} className="dz-ddline" />
      </svg>
      <div className="dz-chart-foot"><span>Caída desde el máximo</span><span>peor: {money(maxDd)}</span></div>
    </div>
  );
}

function Bars({ groups, label }: { groups: { key: string; count: number; net: number; wins: number }[]; label: (k: string) => string }) {
  const max = Math.max(...groups.map((g) => Math.abs(g.net)), 1e-9);
  return (
    <div className="dz-bars">
      {groups.map((g) => (
        <div key={g.key} className="dz-bar-row">
          <span>{label(g.key)}</span>
          <div className="dz-bar-track"><i className={g.net >= 0 ? "up" : "down"} style={{ width: `${Math.max(2, (Math.abs(g.net) / max) * 100)}%` }} /></div>
          <b className={g.net >= 0 ? "up" : "down"}>{usd(g.net)}</b>
          <em>{g.count} · {share(g.wins, g.count)}</em>
        </div>
      ))}
    </div>
  );
}

export function SummaryView({
  stats, trades, incomplete, openCount, excluded, unattributed, today, limit,
}: {
  stats: JournalStats; trades: JTrade[]; incomplete: number; openCount: number; excluded: string[]; unattributed: number;
  today: number; limit: { limitUsd: number; used: number; remaining: number; breached: boolean } | null;
}) {
  const bySymbol = useMemo(() => groupTrades(trades, (t) => t.symbol).sort((a, b) => b.net - a.net), [trades]);
  const byMonth = useMemo(() => groupTrades(trades, (t) => monthOf(t.closeTime as number)).sort((a, b) => b.key.localeCompare(a.key)), [trades]);
  const byWeekday = useMemo(() => {
    const g = groupTrades(trades, (t) => String(new Date(t.closeTime as number).getDay()));
    return [1, 2, 3, 4, 5, 6, 0].map((d) => g.find((x) => x.key === String(d)) ?? { key: String(d), count: 0, net: 0, wins: 0, profitFactor: null }).filter((x) => x.count > 0);
  }, [trades]);
  const byHour = useMemo(() => groupTrades(trades, (t) => String(new Date(t.closeTime as number).getHours())).sort((a, b) => Number(a.key) - Number(b.key)), [trades]);

  if (!stats.count) {
    return (
      <p className="bot-none">
        Todavía no hay operaciones cerradas para medir. Las de futuros se graban solas mientras la app esté abierta; para el historial anterior y para spot,
        andá a la pestaña DATOS.
      </p>
    );
  }
  const tile = (label: string, value: string, sub: string, tone?: "up" | "down") => (
    <div key={label}><small>{label}</small><b className={tone}>{value}</b><em>{sub}</em></div>
  );
  return (
    <>
      <div className="bj-tiles">
        {tile("OPERACIONES", String(stats.count), `${stats.wins} ganadoras · ${stats.losses} perdedoras${stats.flat ? ` · ${stats.flat} en cero` : ""}`)}
        {tile("% GANADORAS", pct((stats.winRate as number) * 100, 0), stats.confidence.toLowerCase())}
        {tile("PROFIT FACTOR", pf(stats.profitFactor), "1,00 = equilibrio")}
        {tile("RESULTADO NETO", usd(stats.net), "bruto − comisiones + funding", stats.net >= 0 ? "up" : "down")}
        {tile("EXPECTATIVA", usd(stats.expectancy as number), "promedio por operación", (stats.expectancy as number) >= 0 ? "up" : "down")}
        {tile("PAYOFF", stats.payoff === null ? "—" : num(stats.payoff, 2), `ganás ${stats.avgWin === null ? "—" : money(stats.avgWin)} · perdés ${stats.avgLoss === null ? "—" : money(stats.avgLoss)}`)}
        {tile("CAÍDA MÁXIMA", money(stats.maxDrawdown), "desde el mejor punto")}
        {tile("RACHAS", `${stats.longestWin} / ${stats.longestLoss}`, `mayor ganadora / perdedora · ahora ${stats.currentStreak.count} ${stats.currentStreak.kind}`)}
        {tile("DURACIÓN MEDIA", dur(stats.avgHoldMs), "de apertura a cierre")}
        {tile("COMISIONES / FUNDING", `${usd(-stats.fees)} / ${usd(stats.funding)}`, Object.keys(stats.feesOther).length ? `+ ${Object.entries(stats.feesOther).map(([a, v]) => `${qty(v)} ${a}`).join(", ")} sin convertir` : "en dólares")}
        {tile("R MEDIO", stats.avgR === null ? "—" : `${stats.avgR >= 0 ? "+" : ""}${num(stats.avgR, 2)}R`, stats.rCount ? `${stats.rCount} con stop planificado` : "cargá el stop en cada operación")}
        {tile("MEJOR / PEOR", `${stats.best ? usd(stats.best.net as number) : "—"} / ${stats.worst ? usd(stats.worst.net as number) : "—"}`, "una operación")}
      </div>
      {stats.count < 15 && (
        <p className="bot-sample thin">⚠ Con {stats.count} operaciones cerradas, el porcentaje, el profit factor y la expectativa todavía se mueven mucho por azar. Sirven para ordenarte, no para concluir.</p>
      )}
      {limit && (
        <p className={`dz-today ${limit.breached ? "warn" : ""}`}>
          HOY: {usd(today)}. Límite de pérdida diaria {money(limit.limitUsd)} · usaste {money(limit.used)} · te quedan {money(limit.remaining)}.
          {limit.breached ? " 🛑 Llegaste al límite que te pusiste: es el momento de parar." : ""}
        </p>
      )}
      <EquityChart points={stats.equity} />
      <div className="bj-groups">
        <div className="dz-card"><h4>Por par</h4><Bars groups={bySymbol} label={(k) => k.replace(/USDT$/, "")} /></div>
        <div className="dz-card"><h4>Por mes</h4><Bars groups={byMonth} label={monthLabel} /></div>
        <div className="dz-card"><h4>Por día de la semana</h4><Bars groups={byWeekday} label={(k) => WEEKDAYS[Number(k)]} /></div>
        <div className="dz-card"><h4>Por hora de cierre</h4><Bars groups={byHour} label={(k) => `${k.padStart(2, "0")}:00`} /></div>
      </div>
      <p className="bj-foot">
        {openCount ? `${openCount} operación(es) abierta(s) no cuentan hasta cerrarse. ` : ""}
        {incomplete ? `${incomplete} incompleta(s): ${"su resultado a veces se conoce (se cuentan) y otras no (quedan fuera). "}` : ""}
        {excluded.length ? `Pares spot en otra moneda que no se analizan: ${excluded.join(", ")}. ` : ""}
        {unattributed ? `Funding sin operación asociada: ${usd(unattributed)} (no está en los resultados). ` : ""}
        Los días y horas son de tu zona horaria. No es asesoramiento financiero.
      </p>
    </>
  );
}

const STATUS_TEXT: Record<string, string> = { cerrada: "CERRADA", abierta: "ABIERTA", incompleta: "INCOMPLETA" };

function TradeDetail({ trade, note, onSave }: { trade: JTrade; note: TradeNote; onSave: (key: string, note: TradeNote) => Promise<void> }) {
  const [stop, setStop] = useState(note.stop === null ? "" : String(note.stop));
  const [setup, setSetup] = useState(note.setup);
  const [emotion, setEmotion] = useState(note.emotion);
  const [rating, setRating] = useState<number | null>(note.rating);
  const [tags, setTags] = useState(note.tags.join(", "));
  const [notes, setNotes] = useState(note.notes);
  const [state, setState] = useState<"idle" | "saving" | "saved" | string>("idle");
  const stopNum = stop.trim() === "" ? null : Number(stop.replace(",", "."));
  const stopBad = stopNum !== null && !(stopNum > 0);
  const preview = rMultiple(trade, stopNum);
  const wrongSide = stopNum !== null && !stopBad && trade.entry !== null && (trade.direction === "LONG" ? stopNum >= trade.entry : stopNum <= trade.entry);

  const save = async () => {
    if (stopBad) return;
    setState("saving");
    try {
      await onSave(trade.key, { stop: stopNum, setup, emotion, rating, tags: tags.split(",").map((t) => t.trim()).filter(Boolean), notes });
      setState("saved");
    } catch (error) {
      setState(error instanceof Error ? error.message : "No se pudo guardar.");
    }
  };
  return (
    <div className="dz-detail">
      {trade.reason && <p className="bot-sample thin">{trade.reason}</p>}
      <div className="dz-fills">
        {trade.fills.map((f) => (
          <div key={`${f.market}${f.id}`}>
            <span>{stamp(f.time)}</span>
            <b className={f.side === "BUY" ? "up" : "down"}>{f.side === "BUY" ? "COMPRA" : "VENTA"}</b>
            <span>{px(f.price)} × {qty(f.qty)}</span>
            <span>comisión {qty(f.fee)} {f.feeAsset}</span>
            <em>{f.source === "live" ? "grabada" : f.source === "sync" ? "leída de Binance" : "importada"}{f.liquidation ? " · LIQUIDACIÓN" : ""}</em>
          </div>
        ))}
      </div>
      <div className="dz-form">
        <label>Stop planificado<input inputMode="decimal" value={stop} onChange={(e) => setStop(e.target.value)} placeholder="para calcular el R" aria-invalid={stopBad} /></label>
        <label>Setup<input value={setup} maxLength={60} onChange={(e) => setSetup(e.target.value)} placeholder="ruptura, rebote…" /></label>
        <label>Cómo te sentías<input value={emotion} maxLength={60} onChange={(e) => setEmotion(e.target.value)} placeholder="calma, ansiedad, FOMO…" /></label>
        <label>Etiquetas (separadas por coma)<input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="plan, error, revancha" /></label>
        <label className="dz-wide">Notas<textarea rows={3} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} placeholder="qué viste, qué hiciste, qué cambiarías" /></label>
      </div>
      <div className="dz-rating" role="group" aria-label="Puntaje de la ejecución">
        <span>Ejecución:</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} className={rating !== null && n <= rating ? "on" : ""} onClick={() => setRating(rating === n ? null : n)} aria-pressed={rating === n}>★</button>
        ))}
        {preview !== null && <span className="dz-r">R de esta operación: <b className={preview >= 0 ? "up" : "down"}>{preview >= 0 ? "+" : ""}{num(preview, 2)}R</b></span>}
        {wrongSide && <span className="dz-r warn">El stop tiene que estar del lado que pierde ({trade.direction === "LONG" ? "debajo" : "encima"} de la entrada).</span>}
        {!wrongSide && stopNum !== null && !stopBad && preview === null && <span className="dz-r">El R se calcula cuando la operación cierra con un resultado.</span>}
      </div>
      <div className="dz-save">
        <button onClick={save} disabled={state === "saving" || stopBad}>{state === "saving" ? "GUARDANDO…" : "GUARDAR NOTA"}</button>
        {state === "saved" && <span className="ok">✓ Guardada en tu cuenta</span>}
        {state !== "idle" && state !== "saving" && state !== "saved" && <span className="warn">{state}</span>}
      </div>
    </div>
  );
}

export function TradesView({ trades, notes, onSave }: { trades: JTrade[]; notes: NoteMap; onSave: (key: string, note: TradeNote) => Promise<void> }) {
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(80);
  if (!trades.length) return <p className="bot-none">No hay operaciones con estos filtros.</p>;
  return (
    <div className="bj-list dz-trades">
      <table>
        <thead>
          <tr><th>Cierre</th><th>Par</th><th>Lado</th><th>Entrada → salida</th><th>Tamaño</th><th>Resultado</th><th>R</th><th>Duración</th><th>Estado</th></tr>
        </thead>
        <tbody>
          {trades.slice(0, shown).flatMap((t) => {
            const note = notes[t.key];
            const r = rMultiple(t, note?.stop ?? null);
            const rows = [
              <tr key={t.key} className={open === t.key ? "dz-open" : ""} onClick={() => setOpen(open === t.key ? null : t.key)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setOpen(open === t.key ? null : t.key)}>
                <td>{stamp(t.closeTime ?? t.openTime)}</td>
                <td>{t.symbol.replace(/USDT$/, "")}<i className={`dz-mk ${t.market}`}>{t.market === "futures" ? "FUT" : "SPOT"}</i>{note && (note.notes || note.setup || note.tags.length) ? " ✎" : ""}</td>
                <td className={t.direction === "LONG" ? "up" : "down"}>{t.direction === "LONG" ? "LARGO" : "CORTO"}{t.liquidation ? " ⚠" : ""}</td>
                <td>{t.entry === null ? "—" : px(t.entry)} → {t.exit === null ? "—" : px(t.exit)}</td>
                <td>{qty(t.qty)}</td>
                <td className={t.net === null ? "" : t.net >= 0 ? "up" : "down"}>{t.net === null ? "—" : usd(t.net)}</td>
                <td>{r === null ? "—" : `${r >= 0 ? "+" : ""}${num(r, 2)}`}</td>
                <td>{dur(t.holdMs)}</td>
                <td><span className={`dz-st ${t.status}`}>{STATUS_TEXT[t.status]}</span></td>
              </tr>,
            ];
            if (open === t.key) {
              rows.push(
                <tr key={`${t.key}-d`} className="dz-detail-row">
                  <td colSpan={9}><TradeDetail trade={t} note={note ?? EMPTY_NOTE} onSave={onSave} /></td>
                </tr>,
              );
            }
            return rows;
          })}
        </tbody>
      </table>
      {trades.length > shown && <button className="dz-more" onClick={() => setShown(shown + 80)}>VER MÁS ({trades.length - shown} restantes)</button>}
    </div>
  );
}
