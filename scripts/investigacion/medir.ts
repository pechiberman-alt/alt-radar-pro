/**
 * Mide las reglas de la mesa en tres períodos que no se superponen, con costos más altos y de más de una manera.
 * Es la herramienta que pide la regla del objetivo «jarvis»: cambiar una regla exige medirla así y decir lo que no mejoró.
 *
 *   node --experimental-strip-types scripts/investigacion/medir.ts [perfil]                # v1 contra v2 por período
 *   node --experimental-strip-types scripts/investigacion/medir.ts [perfil] --costos        # comisión + deslizamiento 0,05 → 0,15%
 *   node --experimental-strip-types scripts/investigacion/medir.ts [perfil] --densa         # todos los puntos de decisión, no una operación a la vez
 *   node --experimental-strip-types scripts/investigacion/medir.ts [perfil] --detalle       # por lado, año, moneda y tipo de salida
 *   node --experimental-strip-types scripts/investigacion/medir.ts [perfil] --variantes     # reglas que se probaron y no se adoptaron
 *   node --experimental-strip-types scripts/investigacion/medir.ts [perfil] --fases         # el mismo resultado empezando en otro momento
 *   node --experimental-strip-types scripts/investigacion/medir.ts 1h --real BTCUSDT        # valida el simulador contra el backtest real de la app
 *
 * Antes: datos.py (velas) y precalcular.ts (lecturas del perfil).
 */
import { runBacktest } from "../../lib/jarvis-backtest.ts";
import { etiquetarTodas, fmt, lecturas, metricas, simulate, V1, V2, type Metricas, type Operacion, type Params, type Plan } from "./simulador.ts";
import { aReal, aVirtual, dia, H, MONEDAS, perfilDe, velasAltas, velasBase, velasMedias, type Perfil } from "./util.ts";

export type Ventana = { nombre: string; desde: number; hasta: number };

/** Los tres períodos de la investigación (+ los últimos 180 días) en el tiempo del perfil. */
export function ventanas(p: Perfil): Ventana[] {
  const v = (a: string, b: string, nombre: string): Ventana => ({ nombre, desde: aVirtual(p, dia(a)), hasta: aVirtual(p, dia(b)) - 1 });
  const todas = [v("2021-01-01", "2024-02-15", "2021-01 → 2024-02"), v("2024-02-15", "2025-07-01", "2024-02 → 2025-06"), v("2025-07-01", "2026-10-01", "2025-07 → 2026-09")];
  const ultimos = v("2026-04-03", "2026-10-01", "últimos 180 días");
  return p.id === "15m" ? [...todas.slice(1), ultimos] : [...todas, ultimos];
}

export function correr(P: Params, p: Perfil, w: Ventana, monedas = MONEDAS): Operacion[] {
  return monedas.flatMap((sym) => simulate(sym, lecturas(sym, p), P, w.desde, w.hasta, p));
}

function tablaPeriodos(p: Perfil) {
  console.log(`\nPerfil ${p.id} (marcos del motor: ${p.marcos}) · comisión ${(V1.fee * 100).toFixed(2)}% por lado · una operación a la vez`);
  for (const w of ventanas(p)) {
    for (const [nombre, P] of [["v1", V1], ["v2", V2]] as [string, Params][]) {
      const ts = correr(P, p, w);
      const por = MONEDAS.map((s) => ts.filter((t) => t.sym === s)).filter((t) => t.length);
      const positivas = por.filter((t) => metricas(t).pf > 1).length;
      console.log(`${w.nombre.padEnd(20)} ${nombre} ${fmt(metricas(ts))} | monedas con PF>1: ${positivas}/${por.length}`);
    }
  }
}

function costos(p: Perfil) {
  console.log(`\nSensibilidad al costo por lado (comisión + deslizamiento), perfil ${p.id}, períodos juntos`);
  for (const pct of [0.05, 0.08, 0.1, 0.15]) {
    for (const [nombre, base] of [["v1", V1], ["v2", V2]] as [string, Params][]) {
      const P = { ...base, fee: pct / 100 };
      const todas = ventanas(p).slice(0, -1).flatMap((w) => correr(P, p, w));
      const m = metricas(todas);
      console.log(`${pct.toFixed(2)}% ${nombre}: PF ${m.pf.toFixed(2)} · E ${m.e >= 0 ? "+" : ""}${m.e.toFixed(3)} R · n=${m.n}`);
    }
  }
}

function densa(p: Perfil) {
  console.log(`\nTodos los puntos de decisión con plan (se solapan: no son independientes), perfil ${p.id}`);
  for (const w of ventanas(p)) {
    for (const [nombre, P] of [["v1", V1], ["v2", V2]] as [string, Params][]) {
      const rs = MONEDAS.flatMap((sym) => etiquetarTodas(sym, lecturas(sym, p), P, w.desde, w.hasta, p)).filter((x) => !x.res.cancelled).map((x) => ({ r: x.res.r, t: x.t, fin: x.res.end }));
      console.log(`${w.nombre.padEnd(20)} ${nombre} ${fmt(metricas(rs))}`);
    }
  }
}

function detalle(p: Perfil) {
  for (const [nombre, P] of [["v1", V1], ["v2", V2]] as [string, Params][]) {
    const todas = MONEDAS.flatMap((sym) => simulate(sym, lecturas(sym, p), P, -Infinity, Infinity, p));
    console.log(`\n[${p.id}] ${nombre} todo el período: ${fmt(metricas(todas))}`);
    const grupo = (titulo: string, clave: (t: Operacion) => string) => {
      const m = new Map<string, Operacion[]>();
      for (const t of todas) {
        const k = clave(t);
        m.set(k, [...(m.get(k) ?? []), t]);
      }
      console.log(`  ${titulo}`);
      for (const k of [...m.keys()].sort()) console.log(`    ${k.padEnd(14)} ${fmt(metricas(m.get(k)!))}`);
    };
    grupo("por lado", (t) => t.side);
    grupo("por año", (t) => String(new Date(aReal(p, t.t)).getUTCFullYear()));
    grupo("por lado y año", (t) => `${t.side === "LONG" ? "largos" : "cortos"} ${new Date(aReal(p, t.t)).getUTCFullYear()}`);
    grupo("por moneda", (t) => t.sym.replace("USDT", ""));
    grupo("por salidas", (t) => t.exits.replace(/TP\d/g, "TP").split(",").join("+"));
  }
}

/** Qué tan lejos queda el TP1 del stop, en R. */
const tp1R = (pl: Plan) => Math.abs(pl.tp[0] - pl.entry) / Math.abs(pl.entry - pl.stop);

/**
 * Cambios a las reglas v2 que se probaron y no se adoptaron (docs/mesa-reglas-v2.md). Es una muestra reproducible de las
 * pruebas, no la lista completa: se probaron varios cientos de combinaciones.
 */
export const VARIANTES: [string, Partial<Params>][] = [
  ["el stop sigue al TP2", { trailAfterTp2: true }],
  ["tendencia diaria a favor", { trendFilter: "d1" }],
  ["tendencia diaria no en contra", { extra: (s, side) => s.tf["1d"] !== (side === "LONG" ? "BAJISTA" : "ALCISTA") }],
  ["marcos alineados a favor", { trendFilter: "align" }],
  ["precio del lado de la media de 200", { trendFilter: "ema200" }],
  ["RSI de 4 h: sin largos sobre 70 ni cortos bajo 30", { rsiMaxLong: 70, rsiMinShort: 30 }],
  ["sin cortos", { allowShorts: false }],
  ["volumen no en contra", { volNotAgainst: true }],
  ["estructura no en contra", { structNotAgainst: true }],
  ["sin volatilidad expandida", { extra: (s) => s.reg !== "EXPANDIDA" }],
  ["objetivos a 1 / 2 / 3 R", { tpMults: [1, 2, 3] }],
  ["objetivos a 2 / 3 / 4 R", { tpMults: [2, 3, 4] }],
  ["salidas 50 / 25 / 25", { fractions: [0.5, 0.25, 0.25] }],
  ["salidas 25 / 25 / 50", { fractions: [0.25, 0.25, 0.5] }],
  ["horizonte de 96 velas base", { horizonH: 96 }],
  ["horizonte de 336 velas base", { horizonH: 336 }],
  ["stop de hasta 2,5 ATR", { maxStopAtr: 2.5 }],
  ["confluencia mínima de 50", { minConfluence: 50 }],
  ["consenso menor a 0,60", { extra: (s) => Math.abs(s.c[0]) < 0.6 }],
  ["TP1 a 1,3 R o más", { post: (_s, pl) => tp1R(pl) >= 1.3 }],
  ["TP1 a 1,5 R o más", { post: (_s, pl) => tp1R(pl) >= 1.5 }],
];

function variantes(p: Perfil) {
  const ws = ventanas(p);
  const largas = ws.slice(0, -1);
  const fila = (P: Params) => ws.map((w) => metricas(correr(P, p, w)));
  const total = (P: Params) => metricas(largas.flatMap((w) => correr(P, p, w)));
  const base = fila(V2);
  const tb = total(V2);
  console.log(`\nVariantes de las reglas v2, perfil ${p.id}: profit factor por ventana (diferencia con v2), operaciones y R total de los períodos largos`);
  console.log(`${"".padEnd(52)} ${ws.map((w) => w.nombre.padEnd(19)).join(" ")} ${"operaciones".padEnd(12)} ${"R total".padEnd(8)} veredicto`);
  const linea = (nombre: string, por: Metricas[], t: Metricas, esBase: boolean) => {
    const dif = por.map((m, i) => m.pf - base[i].pf);
    // Con ±0,05 de ruido solo por cómo se cortan las ventanas, una mejora menor no se distingue de la nada.
    const veredicto = esBase ? "" : dif.every((d) => d > 0.05) ? "mejora más de 0,05 en todas" : dif.every((d) => d > 0) ? "mejora en todas, pero poco" : "no mejora en todas";
    const celdas = por.map((m, i) => `${m.pf.toFixed(2)}${esBase ? "" : ` (${dif[i] >= 0 ? "+" : "−"}${Math.abs(dif[i]).toFixed(2)})`}`.padEnd(19));
    console.log(`${nombre.padEnd(52)} ${celdas.join(" ")} ${String(t.n).padEnd(12)} ${`${t.tot >= 0 ? "+" : "−"}${Math.abs(t.tot).toFixed(0)}`.padEnd(8)} ${veredicto}`);
  };
  linea("v2 (las reglas de la app)", base, tb, true);
  for (const [nombre, cambio] of VARIANTES) {
    const P = { ...V2, ...cambio };
    linea(nombre, fila(P), total(P), false);
  }
}

/**
 * «Una operación a la vez» depende de por dónde se empiece: la primera señal de cada moneda decide cuáles vienen después.
 * Se repite con el comienzo corrido de a un cierre de 4 velas base para ver cuánto se mueve el resultado solo por eso.
 */
function fases(p: Perfil) {
  const ws = ventanas(p);
  const inicio = ws[0].desde;
  const fin = ws[ws.length - 2].hasta;
  console.log(`\nMismo período (${ws[0].nombre.split(" →")[0]} → 2026-09), perfil ${p.id}, empezando 0, 1, 2… 11 cierres de 4 velas base más tarde`);
  for (const [nombre, P] of [["v1", V1], ["v2", V2]] as [string, Params][]) {
    const ms = Array.from({ length: 12 }, (_, k) => metricas(MONEDAS.flatMap((sym) => simulate(sym, lecturas(sym, p), P, inicio + k * 4 * H, fin, p))));
    const rango = (f: (m: Metricas) => number, d: number) => `${Math.min(...ms.map(f)).toFixed(d)} a ${Math.max(...ms.map(f)).toFixed(d)}`;
    console.log(`${nombre}: PF ${rango((m) => m.pf, 2)} · expectativa ${rango((m) => m.e, 3)} R · operaciones ${rango((m) => m.n, 0)} · total ${rango((m) => m.tot, 0)} R`);
  }
}

/** Compara el simulador con el backtest real de la app (solo perfil 1h) en una moneda. */
function real(sym: string) {
  const p = perfilDe("1h");
  const input = (w: Ventana) => ({ symbol: sym, h1: velasBase(sym, p), h4: velasMedias(sym, p), d1: velasAltas(sym, p), btc: velasBase("BTCUSDT", p), eth: velasBase("ETHUSDT", p), from: w.desde, to: w.hasta, fuente: "dataset" });
  console.log(`\nSimulador contra backtest real · ${sym} · reglas v2`);
  for (const w of ventanas(p).slice(0, 3)) {
    const r = runBacktest(input(w));
    const m = r.metricas;
    const s = metricas(simulate(sym, lecturas(sym, p), V2, w.desde, w.hasta, p));
    console.log(`${w.nombre.padEnd(20)} real: n=${m.operaciones} PF=${m.profitFactor?.toFixed(2)} total=${m.totalR.toFixed(1)}R | simulador: n=${s.n} PF=${s.pf.toFixed(2)} total=${s.tot.toFixed(1)}R`);
  }
}

if (process.argv[1]?.endsWith("medir.ts")) {
  const args = process.argv.slice(2);
  const real_ = args.indexOf("--real");
  const p = perfilDe(args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--real"));
  if (real_ >= 0) real(args[real_ + 1] ?? "BTCUSDT");
  else if (args.includes("--costos")) costos(p);
  else if (args.includes("--densa")) densa(p);
  else if (args.includes("--detalle")) detalle(p);
  else if (args.includes("--variantes")) variantes(p);
  else if (args.includes("--fases")) fases(p);
  else tablaPeriodos(p);
}
