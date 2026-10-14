/**
 * Mide el preregistro del flujo (lib/preregistro-flujo.ts): el Agente Supertrend MTF + Volumen en 4 h con cada uno de
 * los cuatro filtros fijados el 14/10/2026, con las mismas velas, costos y corte que el estudio. Necesita los archivos
 * de scripts/investigacion/datos-binance.py (correr en tu PC). Escribe docs/preregistro-flujo.md.
 *
 * Uso: node --experimental-strip-types scripts/investigacion/preregistro-flujo.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ESTRATEGIAS, medir, operar, type Operacion } from "../../lib/estrategias.ts";
import { ESTUDIO_META } from "../../lib/estudio-estrategias-datos.ts";
import { FILTROS, PREREGISTRO_FECHA, conFiltro, type FiltroId, type Flujo } from "../../lib/preregistro-flujo.ts";
import { dsr, momentos, psr } from "../../lib/sobreajuste.ts";
import type { SwingCandle } from "../../lib/swing-entries.ts";
import { DATOS } from "./util.ts";

const M = 4 * 3_600_000;
const COSTO_PCT = ESTUDIO_META.costoPorLadoPct;
const HORIZONTE = ESTUDIO_META.horizonteVelas;
const corte = Date.parse(`${ESTUDIO_META.corte}T00:00:00Z`);
const ensayos = ESTUDIO_META.auditoria.ensayosDeclarados + Object.keys(FILTROS).length;
const leer = <T>(f: string): T | null => (existsSync(join(DATOS, f)) ? (JSON.parse(readFileSync(join(DATOS, f), "utf8")) as T) : null);

const faltan = ESTUDIO_META.monedas.filter((s) => !leer(`${s}-4h-fut.json`));
if (faltan.length) {
  console.error(`Faltan los datos de flujo de ${faltan.join(", ")}. Corré en tu PC: python3 scripts/investigacion/datos-binance.py --metricas`);
  process.exit(1);
}

const pct = (v: number | null) => (v === null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(1).replace(".", ",")} %`);
const r3 = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(3).replace(".", ",")} R`);
const filas: string[] = [];
const ids = ["BASE", ...Object.keys(FILTROS)] as ("BASE" | FiltroId)[];
for (const id of ids) {
  const ops: Operacion[] = [];
  const faltantes = { n: 0 };
  for (const s of ESTUDIO_META.monedas) {
    const v = (leer<number[][]>(`${s}-4h.json`) ?? []).map(([openTime, open, high, low, close, volume]) => ({ openTime, open, high, low, close, volume }) as SwingCandle);
    const fut = leer<number[][]>(`${s}-4h-fut.json`) ?? [];
    const flujo: Flujo = {
      taker: new Map(fut.map((r) => [r[0], [r[5], r[6]] as [number, number]])),
      funding: leer<[number, number][]>(`${s}-funding.json`) ?? [],
      oi: leer<[number, number][]>(`${s}-oi.json`) ?? [],
    };
    const e = id === "BASE" ? ESTRATEGIAS.find((x) => x.id === "ST_MTF_VOL")! : conFiltro(id, flujo, M, faltantes);
    ops.push(...operar(e, s, v, { marcoMs: M, horizonte: HORIZONTE, feePct: COSTO_PCT }));
  }
  const ev = ops.filter((o) => o.abiertaA >= corte);
  const m = medir(ev);
  const mo = momentos(ev.map((o) => o.r));
  const d = mo ? dsr(mo, ensayos, ESTUDIO_META.auditoria.varianzaSharpes ?? 0) : null;
  filas.push(
    `| ${id === "BASE" ? "Sin filtro (referencia)" : `${id}: ${FILTROS[id].regla}`} | ${medir(ops.filter((o) => o.abiertaA < corte)).operaciones} | ${m.operaciones} | ${pct(m.winRate)} | ${m.profitFactor?.toFixed(2).replace(".", ",") ?? "—"} | ${r3(m.expectancia)} | ${pct(mo ? psr(mo) : null)} | ${pct(d)} | ${faltantes.n} |`,
  );
  console.log(filas[filas.length - 1]);
}

writeFileSync(
  "docs/preregistro-flujo.md",
  [
    "# Preregistro del flujo real",
    "",
    `Filtros fijados el ${PREREGISTRO_FECHA}, antes de mirar datos de volumen taker, funding u open interest (lib/preregistro-flujo.ts). Base: Agente Supertrend MTF + Volumen, velas de 4 h, costos ${String(COSTO_PCT).replace(".", ",")} % por lado, corte ${ESTUDIO_META.corte}. DSR contando ${ensayos} ensayos. Datos de Binance Vision (CC BY-NC-SA 4.0): investigación personal, no producción.`,
    "",
    "| Variante | Operaciones desarrollo | Operaciones evaluación | Acierto | Profit factor | Expectancia | PSR | DSR | Señales sin dato |",
    "|---|---|---|---|---|---|---|---|---|",
    ...filas,
    "",
    "Un filtro solo se adopta si mejora la evaluación con DSR de al menos 95 % y después se sostiene en papel. Medición del pasado; no es asesoramiento financiero.",
    "",
  ].join("\n"),
);
