// Pruebas del consenso entre agentes (lib/consenso.ts): que cuente bien quién coincide y quién va al revés, que nadie se
// cuente a sí mismo, y que la comparación no saque conclusiones con muestra chica ni afirme que el consenso sirve.
import assert from "node:assert/strict";
import test from "node:test";
import { MUESTRA_MINIMA_CONSENSO, compararConsenso, consensoDe, fotoConsenso, type EntradaConsenso } from "../lib/consenso.ts";

const e = (estrategia: string, symbol: string, vela: number, lado: "LONG" | "SHORT" = "LONG"): EntradaConsenso => ({ estrategia, symbol, vela, lado });

test("cuenta los que coincidieron en la misma moneda y vela, sin contarse a sí mismo", () => {
  const m = consensoDe([e("A", "BTCUSDT", 1), e("B", "BTCUSDT", 1), e("C", "BTCUSDT", 1)]);
  const a = m.get("A|BTCUSDT|1");
  assert.ok(a);
  assert.equal(a.acuerdo, 2);
  assert.deepEqual(a.con, ["B", "C"]);
  assert.ok(!a.con.includes("A"));
});

test("los de lado contrario cuentan aparte y no suman al acuerdo", () => {
  const m = consensoDe([e("A", "BTCUSDT", 1, "LONG"), e("B", "BTCUSDT", 1, "SHORT"), e("C", "BTCUSDT", 1, "LONG")]);
  const a = m.get("A|BTCUSDT|1");
  assert.equal(a?.acuerdo, 1);
  assert.equal(a?.contra, 1);
  assert.deepEqual(a?.con, ["C"]);
});

test("otra moneda u otra vela no es coincidencia", () => {
  const m = consensoDe([e("A", "BTCUSDT", 1), e("B", "ETHUSDT", 1), e("C", "BTCUSDT", 2)]);
  assert.equal(m.get("A|BTCUSDT|1")?.acuerdo, 0);
  assert.deepEqual(m.get("A|BTCUSDT|1")?.con, []);
});

test("una entrada sola no inventa compañía", () => {
  const m = consensoDe([e("A", "BTCUSDT", 1)]);
  assert.deepEqual(m.get("A|BTCUSDT|1"), { acuerdo: 0, contra: 0, con: [] });
  assert.equal(consensoDe([]).size, 0);
});

test("la foto recorta la lista de nombres para no llenar la base", () => {
  const con = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const f = fotoConsenso({ acuerdo: 8, contra: 1, con }, 3);
  assert.equal(f.acuerdo, 8);
  assert.deepEqual(f.con, ["A", "B", "C"]);
});

test("con pocos casos no se compara nada: la muestra manda", () => {
  const rs = Array.from({ length: 5 }, () => ({ acuerdo: 3, r: 2 })).concat(Array.from({ length: 5 }, () => ({ acuerdo: 0, r: -1 })));
  const c = compararConsenso(rs);
  assert.equal(c.muestraMinima, true);
  assert.equal(c.diferencia, null);
  assert.ok(c.texto.includes("Todavía no se puede comparar"));
});

test("con muestra suficiente informa la diferencia y aclara que no filtra nada", () => {
  const n = MUESTRA_MINIMA_CONSENSO;
  const rs = Array.from({ length: n }, () => ({ acuerdo: 2, r: 1 })).concat(Array.from({ length: n }, () => ({ acuerdo: 0, r: -1 })));
  const c = compararConsenso(rs);
  assert.equal(c.muestraMinima, false);
  assert.equal(c.acompanadas.rMedio, 1);
  assert.equal(c.solitarias.rMedio, -1);
  assert.equal(c.diferencia, 2);
  assert.ok(c.texto.includes("no filtra nada"));
});

test("el texto nunca concluye que el consenso sirve", () => {
  const n = MUESTRA_MINIMA_CONSENSO;
  const rs = Array.from({ length: n }, () => ({ acuerdo: 5, r: 3 })).concat(Array.from({ length: n }, () => ({ acuerdo: 0, r: -3 })));
  const t = compararConsenso(rs).texto.toLowerCase();
  for (const f of ["conviene", "hay que esperar a que coincidan", "funciona", "ventaja"]) assert.ok(!t.includes(f), f);
});

test("el umbral de acompañada se puede subir y cambia los grupos", () => {
  const rs = [{ acuerdo: 1, r: 1 }, { acuerdo: 4, r: 2 }, { acuerdo: 0, r: -1 }];
  assert.equal(compararConsenso(rs, 1).acompanadas.n, 2);
  assert.equal(compararConsenso(rs, 4).acompanadas.n, 1);
});
