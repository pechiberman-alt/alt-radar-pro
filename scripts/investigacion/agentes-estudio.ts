/**
 * Estudio agente por agente sobre el pasado (2021–sep 2026, velas de 4 h de Binance, las 10 monedas del servidor): cada
 * estrategia de los agentes de papel con sus reglas sin tocar (lib/estrategias.ts, como lib/agentes-papel.ts: entrada a la
 * apertura siguiente, la misma escalera, horizonte de 48 velas), en tres períodos y con dos costos (0,07 % y 0,15 % por lado).
 *
 * El criterio para conservar un agente se fijó ANTES de mirar: expectancia positiva con t ≥ 2 en los tres períodos con costo
 * 0,07 %, y expectancia positiva en los tres con 0,15 %. Se prueban muchos agentes a la vez: uno puede pasar por azar, y por
 * eso lo que pase se mide después hacia adelante antes de creerle. Es pasado: no garantiza nada.
 *   node --experimental-strip-types scripts/investigacion/agentes-estudio.ts   (ALT_RADAR_DATOS=carpeta con SIMBOLO-4h.json)
 */
import { readFileSync } from "node:fs";
import { escaleraHacia, recorrer } from "../../lib/escalera.ts";
import { ESTRATEGIAS, indicadores, operaEn } from "../../lib/estrategias.ts";
import { AGENTES_PAPEL, HORIZONTE_AGENTES, MARCO_AGENTES_MS, MONEDAS_AGENTES } from "../../lib/agentes-papel.ts";
import type { SwingCandle } from "../../lib/swing-entries.ts";

const DATOS = process.env.ALT_RADAR_DATOS ?? "datos-investigacion";
const PERIODOS = [
  { id: "2021–2022", desde: Date.UTC(2021, 0, 1), hasta: Date.UTC(2023, 0, 1) },
  { id: "2023–2024", desde: Date.UTC(2023, 0, 1), hasta: Date.UTC(2025, 0, 1) },
  { id: "2025–sep 2026", desde: Date.UTC(2025, 0, 1), hasta: Date.UTC(2026, 9, 1) },
];
const COSTOS = [0.07, 0.15];

const cargar = (sym: string): SwingCandle[] =>
  (JSON.parse(readFileSync(`${DATOS}/${sym}-4h.json`, "utf8")) as number[][]).map(([t, o, h, l, c, v]) => ({ openTime: t, open: o, high: h, low: l, close: c, volume: v, quoteVolume: v * c }));

type Op = { estrategia: string; sym: string; t: number; r: Record<number, number> };
const ops: Op[] = [];
for (const sym of MONEDAS_AGENTES) {
  const v = cargar(sym);
  const ind = indicadores(v);
  for (const e of ESTRATEGIAS.filter((x) => AGENTES_PAPEL.includes(x.id) && operaEn(x, sym))) {
    for (let i = 0; i + 1 < v.length; i += 1) {
      const s = e.senal(v, ind, i);
      if (!s) continue;
      const entrada = v[i + 1].open;
      const riesgo = Math.abs(v[i].close - s.stop);
      const rr = Math.abs(s.objetivo - v[i].close) / riesgo;
      if (!(entrada > 0) || !(riesgo > 0) || !Number.isFinite(rr)) continue;
      const signo = s.lado === "LONG" ? 1 : -1;
      const esc = escaleraHacia(s.lado, entrada, entrada - signo * riesgo, entrada + signo * rr * riesgo);
      if (!esc) continue;
      const tramo = v.slice(i + 1, i + 3 + HORIZONTE_AGENTES);
      const fin = (tramo.at(-1)?.openTime ?? 0) + MARCO_AGENTES_MS;
      const r: Record<number, number> = {};
      let ok = true;
      for (const fee of COSTOS) {
        const rec = recorrer(s.lado, entrada, esc, v[i].openTime, tramo, MARCO_AGENTES_MS, fin, { horizonte: HORIZONTE_AGENTES, feePct: fee });
        if (rec.desenlace === "ABIERTA" || rec.r === null) ok = false;
        else r[fee] = rec.r;
      }
      if (ok) ops.push({ estrategia: e.id, sym, t: v[i + 1].openTime, r });
    }
  }
  console.error(`${sym} listo`);
}

const medir = (rs: number[]) => {
  const n = rs.length;
  if (n < 2) return { n, e: n ? rs[0] : null, t: null as number | null };
  const m = rs.reduce((s, x) => s + x, 0) / n;
  const de = Math.sqrt(rs.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1));
  return { n, e: m, t: de > 0 ? m / (de / Math.sqrt(n)) : null };
};
const f = (x: number | null) => (x === null ? "—" : x.toFixed(2).replace(".", ","));
const ids = [...new Set(ops.map((o) => o.estrategia))].sort();
const filas: string[] = ["| Agente | " + PERIODOS.map((p) => `${p.id} (n · R · t)`).join(" | ") + " | 0,15 %: R por período | Pasa |", "|---|---|---|---|---|---|"];
const pasan: string[] = [];
for (const id of ids) {
  const suyas = ops.filter((o) => o.estrategia === id);
  const base = PERIODOS.map((p) => medir(suyas.filter((o) => o.t >= p.desde && o.t < p.hasta).map((o) => o.r[0.07])));
  const caro = PERIODOS.map((p) => medir(suyas.filter((o) => o.t >= p.desde && o.t < p.hasta).map((o) => o.r[0.15])));
  const pasa = base.every((m) => m.e !== null && m.e > 0 && m.t !== null && m.t >= 2) && caro.every((m) => m.e !== null && m.e > 0);
  if (pasa) pasan.push(id);
  filas.push(`| ${id} | ${base.map((m) => `${m.n} · ${f(m.e)} · ${f(m.t)}`).join(" | ")} | ${caro.map((m) => f(m.e)).join(" / ")} | ${pasa ? "SÍ" : "no"} |`);
}
console.log(filas.join("\n"));
console.log(`\nPasan el criterio: ${pasan.length ? pasan.join(", ") : "ninguno"} (de ${ids.length}).`);
