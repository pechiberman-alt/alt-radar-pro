/**
 * La mesa con otras velas base: 15 min, 1 h (la de la app), 2 h, 4 h, 6 h y 12 h, con las dos versiones de reglas y dos
 * niveles de costo. Resultado y lectura: docs/mesa-perfiles.md.
 *
 *   node --experimental-strip-types scripts/investigacion/perfiles.ts [perfil...]               # tabla completa
 *   node --experimental-strip-types scripts/investigacion/perfiles.ts --intervalos [perfil...]  # con intervalos del 90% (semanas)
 *
 * Antes: datos.py y precalcular.ts <perfil> para cada perfil. Salida: filas de tabla en Markdown («—» = menos de 15 operaciones,
 * muestra mínima).
 */
import { existsSync } from "node:fs";
import { expectativa, factorDeGanancia, intervaloPorSemanas, lecturas, metricas, simulate, V1, V2, type Metricas, type Operacion, type Params } from "./simulador.ts";
import { aReal, aVirtual, dia, MONEDAS, PERFILES, SALIDA, type PerfilId } from "./util.ts";

const PERIODOS: [string, string][] = [["2021-01 → 2026-09", "2021-01-01"], ["2024-02 → 2026-09", "2024-02-15"]];

/** Números como se escriben en la documentación: coma decimal y punto de miles. */
const miles = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const dec = (v: number, d: number) => v.toFixed(d).replace(".", ",");
const conSigno = (v: number, d: number) => `${v >= 0 ? "+" : "−"}${dec(Math.abs(v), d)}`;
/** Profit factor, o «—» si hay menos de 15 operaciones (muestra mínima) o ninguna perdedora. */
const pfDe = (m: Metricas) => (m.n < 15 || !Number.isFinite(m.pf) ? "—" : dec(m.pf, 2));

/** Operaciones de las 10 monedas con una vela base, unas reglas y un costo por lado (en %), desde una fecha. */
function operaciones(id: PerfilId, base: Params, desde: string, pct: number): Operacion[] {
  const p = PERFILES[id];
  return MONEDAS.flatMap((sym) => simulate(sym, lecturas(sym, p), { ...base, fee: pct / 100 }, aVirtual(p, dia(desde)), Infinity, p));
}

export function filas(id: PerfilId) {
  const p = PERFILES[id];
  const out: string[] = [];
  for (const [periodo, desde] of PERIODOS) {
    if (id === "15m" && desde < "2024-02-15") continue;
    for (const [rn, base] of [["v1", V1], ["v2", V2]] as [string, Params][]) {
      for (const pct of [0.05, 0.1]) {
        const ts = operaciones(id, base, desde, pct);
        const m = metricas(ts);
        const anios = new Map<number, Operacion[]>();
        for (const t of ts) {
          const y = new Date(aReal(p, t.t)).getUTCFullYear();
          anios.set(y, [...(anios.get(y) ?? []), t]);
        }
        const pfAnios = [...anios.entries()].sort((a, b) => a[0] - b[0]).map(([y, v]) => `${String(y).slice(2)}: ${pfDe(metricas(v))}`).join(" · ");
        const largos = metricas(ts.filter((t) => t.side === "LONG"));
        const cortos = metricas(ts.filter((t) => t.side === "SHORT"));
        const anosDatos = (dia("2026-10-01") - dia(desde)) / (365.25 * 86_400_000);
        out.push(`| ${id} | ${periodo} | ${rn} | ${dec(pct, 2)}% | ${miles(m.n)} (${miles(m.n / anosDatos)}/año) | ${Math.round(m.wr * 100)}% | ${Number.isFinite(m.pf) ? dec(m.pf, 2) : "—"} | ${conSigno(m.e, 3)} | ${conSigno(m.tot, 0)} | ${miles(m.dd)} | ${pfDe(largos)} / ${pfDe(cortos)} | ${pfAnios} |`);
      }
    }
  }
  return out;
}

const entre = (r: { valor: number; bajo: number; alto: number }, d: number, signo = false) => {
  const f = (v: number) => (signo ? conSigno(v, d) : dec(v, d));
  return `${f(r.valor)} [${f(r.bajo)} a ${f(r.alto)}]`;
};

/** Intervalos del 90% (semanas enteras remuestreadas) para cada perfil y para las diferencias entre reglas y entre velas base. */
function intervalos(ids: PerfilId[]) {
  const serie = (id: PerfilId, base: Params, desde: string) => ({ ts: operaciones(id, base, desde, 0.05), aReal: (t: number) => aReal(PERFILES[id], t) });
  const pf = ([a]: number[][]) => factorDeGanancia(a);
  const e = ([a]: number[][]) => expectativa(a);
  console.log("| Velas base | Período | Reglas | Operaciones | Profit factor [intervalo 90%] | Expectativa en R [intervalo 90%] | Semanas |");
  console.log("| --- | --- | --- | --- | --- | --- | --- |");
  for (const id of ids) {
    const [periodo, desde] = id === "15m" ? PERIODOS[1] : PERIODOS[0];
    for (const [rn, base] of [["v1", V1], ["v2", V2]] as [string, Params][]) {
      const s = serie(id, base, desde);
      const a = intervaloPorSemanas([s], pf);
      const b = intervaloPorSemanas([s], e);
      console.log(`| ${id} | ${periodo} | ${rn} | ${miles(s.ts.length)} | ${entre(a, 2)} | ${entre(b, 3, true)} | ${a.semanas} |`);
    }
  }
  console.log("");
  console.log("| Período | Comparación (primero menos segundo) | Reglas | Diferencia de profit factor [intervalo 90%] | Diferencia de expectativa en R [intervalo 90%] |");
  console.log("| --- | --- | --- | --- | --- |");
  const difPf = ([a, b]: number[][]) => factorDeGanancia(a) - factorDeGanancia(b);
  const difE = ([a, b]: number[][]) => expectativa(a) - expectativa(b);
  for (const [periodo, desde] of PERIODOS) {
    const aqui = ids.filter((id) => id !== "15m" || desde >= "2024-02-15");
    for (const id of aqui) {
      const [v2, v1] = [serie(id, V2, desde), serie(id, V1, desde)];
      console.log(`| ${periodo} | ${id} v2 − ${id} v1 | — | ${entre(intervaloPorSemanas([v2, v1], difPf), 2, true)} | ${entre(intervaloPorSemanas([v2, v1], difE), 3, true)} |`);
    }
    for (const [rn, base] of [["v1", V1], ["v2", V2]] as [string, Params][]) {
      if (!aqui.includes("1h")) continue;
      const ref = serie("1h", base, desde);
      for (const id of aqui.filter((x) => x !== "1h")) {
        const otra = serie(id, base, desde);
        console.log(`| ${periodo} | ${id} − 1h | ${rn} | ${entre(intervaloPorSemanas([otra, ref], difPf), 2, true)} | ${entre(intervaloPorSemanas([otra, ref], difE), 3, true)} |`);
      }
    }
  }
}

if (process.argv[1]?.endsWith("perfiles.ts")) {
  const args = process.argv.slice(2);
  const pedidos = args.filter((a) => !a.startsWith("--")) as PerfilId[];
  const ids = (pedidos.length ? pedidos : (Object.keys(PERFILES) as PerfilId[])).filter((id) => existsSync(`${SALIDA}/lecturas-${id}-BTCUSDT.json`));
  if (args.includes("--intervalos")) {
    intervalos(ids);
    process.exit(0);
  }
  console.log("| Velas base | Período | Reglas | Costo por lado | Operaciones | Win rate | Profit factor | Expectativa (R) | Total (R) | Peor caída (R) | PF largos / cortos | PF por año |");
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const id of ids) for (const f of filas(id)) console.log(f);
}
