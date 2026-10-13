/**
 * Precalcula lo que la mesa veía en cada cierre de 4 velas base (solo velas cerradas) para un perfil de velas.
 *
 *   node --experimental-strip-types scripts/investigacion/precalcular.ts <perfil> [desde] [hasta] [moneda...]
 *
 * Escribe salida-investigacion/lecturas-<perfil>-<moneda>.json. Tarda ~7 ms por lectura (1 h: unas 12.600 por moneda).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { snapshotAt } from "../../lib/jarvis-backtest.ts";
import { analyzeAsset } from "../../lib/jarvis-analyst.ts";
import { consensus, framesOf, runAgents } from "../../lib/jarvis-desk-agents.ts";
import { closedSnapshot } from "../../lib/jarvis-desk.ts";
import { atrOf } from "../../lib/level-engine.ts";
import type { SwingCandle } from "../../lib/swing-entries.ts";
import type { Lectura } from "./simulador.ts";
import { aVirtual, dia, H, MONEDAS, perfilDe, SALIDA, velasAltas, velasBase, velasMedias, type Perfil } from "./util.ts";

/** Las series que ve el motor (ya en tiempo virtual): base, «4 h», «1 d» y las de referencia. */
export type Series = { h1: SwingCandle[]; h4: SwingCandle[] | null; d1: SwingCandle[] | null; btc: SwingCandle[] | null; eth: SwingCandle[] | null };
export const seriesDe = (sym: string, perfil: Perfil): Series => ({
  h1: velasBase(sym, perfil),
  h4: velasMedias(sym, perfil),
  d1: velasAltas(sym, perfil),
  btc: velasBase("BTCUSDT", perfil),
  eth: velasBase("ETHUSDT", perfil),
});

export function lecturasDe(sym: string, perfil: Perfil, desde: number, hasta: number, series: Series = seriesDe(sym, perfil)): Lectura[] {
  const input = {
    symbol: sym,
    ...series,
    from: aVirtual(perfil, desde),
    to: aVirtual(perfil, hasta),
    fuente: `dataset (${perfil.id}, tiempo virtual)`,
  };
  const step = 4 * H;
  const rows: Lectura[] = [];
  for (let t = Math.ceil(input.from / step) * step; t <= input.to; t += step) {
    const s = closedSnapshot(snapshotAt(input, t + 1000));
    const frames = framesOf(s);
    if (frames.h1.length < 200) continue;
    const a = analyzeAsset(s.symbol, { h1: s.candles.h1, h4: s.candles.h4, d1: s.candles.d1 }, s.now);
    if (!a) continue;
    const agents = runAgents(s, a);
    const c = consensus(agents);
    const lv = (l: { price: number; low: number; high: number; stars: number }) => [l.price, l.low, l.high, l.stars];
    const tec = agents.find((x) => x.id === "tecnico");
    const vol = agents.find((x) => x.id === "volatilidad");
    const volumen = agents.find((x) => x.id === "volumen");
    rows.push({
      t: s.now,
      vela: a.read.at,
      p: a.read.price,
      atr: atrOf(frames.h4),
      sup: a.levels.supports.map(lv),
      res: a.levels.resistances.map(lv),
      mu: a.magnets.above ? [a.magnets.above.price, a.magnets.above.distancePct, a.magnets.above.intensity] : null,
      md: a.magnets.below ? [a.magnets.below.price, a.magnets.below.distancePct, a.magnets.below.intensity] : null,
      c: [c.value, c.coverage, c.agreeLong, c.agreeShort],
      ses: Object.fromEntries(agents.filter((x) => x.disponible && x.peso > 0).map((x) => [x.id, x.sesgo])),
      reg: (vol?.datos.regimen as string | undefined) ?? null,
      al: a.read.alignment,
      tf: Object.fromEntries(a.tfs.map((x) => [x.tf, x.trend])),
      rsi: [a.rsi["1h"], a.rsi["4h"], a.rsi["1d"]],
      ema: [(tec?.datos.ema20_4h as number | null) ?? null, (tec?.datos.ema50_4h as number | null) ?? null, (tec?.datos.ema200_4h as number | null) ?? null, (tec?.datos.sma200_1d as number | null) ?? null],
      vr: [(volumen?.datos.volumenRelativo1h as number | null) ?? null, (volumen?.datos.volumenRelativo4h as number | null) ?? null],
      ch24: a.read.change24h,
      lb: a.lastBreak ? [a.lastBreak.direction, a.lastBreak.candlesAgo, a.lastBreak.confirmed ? 1 : 0] : null,
    });
  }
  return rows;
}

if (process.argv[1]?.endsWith("precalcular.ts")) {
  const [id, desde = "2021-01-01", hasta = "2026-09-30", ...monedas] = process.argv.slice(2);
  const perfil = perfilDe(id);
  mkdirSync(SALIDA, { recursive: true });
  for (const sym of monedas.length ? monedas : MONEDAS) {
    const t0 = performance.now();
    const rows = lecturasDe(sym, perfil, dia(desde), dia(hasta));
    writeFileSync(`${SALIDA}/lecturas-${perfil.id}-${sym}.json`, JSON.stringify(rows));
    console.log(`${perfil.id} ${sym}: ${rows.length} lecturas en ${((performance.now() - t0) / 1000).toFixed(0)} s`);
  }
}
