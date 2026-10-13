import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MEDICION } from "../lib/mesa-medicion.ts";

// Lo que muestra la araña en vivo tiene que estar escrito, con los mismos números, en la documentación de la mesa.
const doc = readFileSync(new URL("../docs/mesa-reglas-v2.md", import.meta.url), "utf8");
const pct = (x: number) => `${Math.round(x * 100)}%`;
const coma = (x: number, d: number) => x.toFixed(d).replace(".", ",");
const signo = (x: number, d: number) => `${x >= 0 ? "+" : "−"}${coma(Math.abs(x), d)}`;
const miles = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

test("la fila de los tres períodos largos en la doc coincide con lo que muestra la araña", () => {
  const m = MEDICION;
  const fila = `| Los 3 períodos largos | ${miles(m.n)} | ${pct(m.winRate.p)} [${pct(m.winRate.low)}; ${pct(m.winRate.high)}] | ${coma(m.profitFactor.p, 2)} [${coma(m.profitFactor.low, 2)}; ${coma(m.profitFactor.high, 2)}] | ${signo(m.expectativaR.p, 3)} R [${signo(m.expectativaR.low, 3)}; ${signo(m.expectativaR.high, 3)}] | ${coma(m.sharpe, 3)} |`;
  assert.ok(doc.includes(fila), `la doc no tiene la fila: ${fila}`);
});

test("el PSR, el DSR con las reglas probadas y con 300 están escritos en la doc", () => {
  assert.ok(doc.includes(`DSR ${coma(MEDICION.dsr * 100, 1)}%`), "falta el DSR con las reglas de la lista");
  assert.ok(doc.includes(`${coma(MEDICION.dsr300 * 100, 1)}%`), "falta el DSR con 300 reglas");
  assert.equal(MEDICION.psr0, 1, "PSR: la doc dice 100%");
  assert.ok(doc.includes("PSR (probabilidad de que el Sharpe sea mayor que cero): 100%"));
});

test("el win rate corregido, el 12 h y las 22 reglas están en la doc", () => {
  assert.equal(MEDICION.reglasProbadas, 22);
  assert.ok(doc.includes("22 reglas de la lista"));
  assert.ok(doc.includes("[43%; 48%]"));
  assert.ok(doc.includes("47 de 91 operaciones"));
  assert.ok(doc.includes("[43%; 60%]"));
});
