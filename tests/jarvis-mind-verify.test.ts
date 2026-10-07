import assert from "node:assert/strict";
import test from "node:test";
import { readArNumber, readingText, sentenceProblem, verifyCoinText, verifyReading, type MindFacts } from "../lib/jarvis-mind.ts";

/** The data of the 19:17 UTC reading of 7 October 2026, the one that published "1,146,2" and called a magnet "soporte". */
const FACTS: MindFacts = {
  monedas: [
    { m: "BTC", precio: 83422, sop: [82919.9, 81846], res: [83742, 84460.1] },
    { m: "ETH", precio: 2562.98, sop: [], res: [2564.33, 2600.15] },
    { m: "SOL", precio: 116.13, sop: [116.113, 114.32], res: [117.177, 119.645] },
    { m: "AVAX", precio: 11.231, sop: [11.0664, 10.782], res: [11.3064, 11.7645] },
    { m: "LINK", precio: 13.383, sop: [13.2404, 12.7245], res: [13.505, 13.7223] },
    { m: "DOT", precio: 1.102, sop: [1.099, 1.075], res: [1.14618, 1.17533] },
    { m: "DOGE", precio: 0.08858, sop: [0.08649], res: [0.08892] },
  ],
  imanes: {
    BTC: { arriba: { precio: 87860 }, abajo: { precio: 82480 } },
    ETH: { arriba: null, abajo: { precio: 2524.5 } },
    SOL: { arriba: { precio: 125.02 }, abajo: { precio: 115.44 } },
  },
};

/** What the free model wrote at 19:17 UTC, as stored in jarvis_mind. */
const READING_1917 = readingText({
  sesgo: "BAJISTA",
  resumen:
    "El mercado sigue en régimen bajista a 24 horas, con una caída del 2,44% en BTC. El sentimiento se mantiene en avaricia, pero hay presión bajista en las principales altcoins.",
  activos: [
    { moneda: "BTC", lectura: "BTC está cerca de su soporte clave en 82.920, que se mantiene intacto. Si rompe, podría caer hacia 81.846. La resistencia en 83.742 es clave para ver si hay fuerza al alza." },
    { moneda: "ETH", lectura: "ETH se mantiene cerca de su resistencia en 2.564,3. Si supera este nivel, podría acelerar su subida. El soporte en 2.524,5 es clave para evitar una caída más profunda." },
    { moneda: "SOL", lectura: "SOL se mantiene cerca de su soporte en 116,11. Si rompe, podría caer hacia 114,32. La resistencia en 117,18 es clave para ver si hay fuerza al alza." },
    { moneda: "AVAX", lectura: "AVAX se mantiene cerca de su soporte en 11,066. Si rompe, podría caer hacia 10,782. La resistencia en 11,306 es clave para ver si hay fuerza al alza." },
    { moneda: "LINK", lectura: "LINK se mantiene cerca de su soporte en 13,24. Si rompe, podría caer hacia 12,725. La resistencia en 13,505 es clave para ver si hay fuerza al alza." },
    { moneda: "DOT", lectura: "DOT se mantiene cerca de su soporte en 1,099. Si rompe, podría caer hacia 1,075. La resistencia en 1,146,2 es clave para ver si hay fuerza al alza." },
  ],
  riesgos: ["La caída de BTC por debajo de 82.920 podría generar una mayor presión bajista en todo el mercado.", "La falta de volumen podría limitar cualquier movimiento significativo en las próximas horas."],
  vigilar: ["Niveles clave de BTC y ETH para ver si hay fuerza al alza o si se confirma la tendencia bajista."],
});

test("numbers are read the Argentine way, and broken ones are not numbers", () => {
  assert.equal(readArNumber("82.920"), 82920);
  assert.equal(readArNumber("2.564,3"), 2564.3);
  assert.equal(readArNumber("-2,44"), -2.44);
  assert.equal(readArNumber("0,7042"), 0.7042);
  assert.equal(readArNumber("83742"), 83742);
  assert.equal(readArNumber("1,146,2"), null);
  assert.equal(readArNumber("2.99"), null, "an English decimal is not an Argentine number");
  assert.equal(readArNumber("83,742.5"), null);
});

test("the 19:17 reading: the broken number and the magnet called support are taken out, the rest is kept word for word", () => {
  const { text, quitadas } = verifyReading(READING_1917, FACTS);
  const lectura = (m: string) => text.activos.find((a) => a.moneda === m)?.lectura ?? "";
  assert.equal(lectura("DOT"), "DOT se mantiene cerca de su soporte en 1,099. Si rompe, podría caer hacia 1,075.");
  assert.equal(lectura("ETH"), "ETH se mantiene cerca de su resistencia en 2.564,3. Si supera este nivel, podría acelerar su subida.");
  for (const m of ["BTC", "SOL", "AVAX", "LINK"]) assert.equal(lectura(m), READING_1917.activos.find((a) => a.moneda === m)?.lectura, m);
  assert.equal(text.resumen, READING_1917.resumen, "percentages and hours are not prices");
  assert.deepEqual(text.riesgos, READING_1917.riesgos);
  assert.deepEqual(text.vigilar, READING_1917.vigilar);
  assert.equal(quitadas.length, 2);
  assert.match(quitadas.join(" "), /1,146,2/);
  assert.match(quitadas.join(" "), /soporte en 2\.524,5 no está en los datos/);
});

test("a price off by thousands (the old '11.066,4' for a coin of 11) is taken out", () => {
  assert.match(sentenceProblem("AVAX rebota en 11.066,4 con volumen.", { precio: 11.231, sop: [11.0664], res: [], imanes: [] }) ?? "", /fuera de escala/);
  assert.equal(sentenceProblem("AVAX rebota en 11,066 con volumen.", { precio: 11.231, sop: [11.0664], res: [], imanes: [] }), null);
});

test("a magnet named as a magnet is fine; multiples, hours and percentages are not prices", () => {
  const btc = { precio: 83422, sop: [82919.9], res: [83742], imanes: [82480, 87860] };
  assert.equal(sentenceProblem("Debajo está el imán de liquidaciones en 82.480.", btc), null);
  assert.equal(sentenceProblem("El volumen viene 2,18 veces el semanal y cae 3,5% en 48 horas.", btc), null);
  assert.equal(sentenceProblem("Si pierde el soporte busca el imán de 82.480.", btc), null, "the number belongs to the magnet, not to the support");
  assert.equal(sentenceProblem("Entre soporte y resistencia en 83.742 hay poco espacio.", btc), null, "the level named last is the one checked");
  assert.match(sentenceProblem("El imán está en 85.000.", btc) ?? "", /imán en 85\.000/);
  assert.match(sentenceProblem("Sube 2.99% en el día.", null) ?? "", /mal escrito/, "a broken number is caught with no coin to check against");
});

test("a summary left with nothing true says so instead of going out empty", () => {
  const { text } = verifyReading(readingText({ sesgo: "ALCISTA", resumen: "BTC rompe 1,2,3 y sigue.", activos: [], riesgos: [], vigilar: [] }), FACTS);
  assert.match(text.resumen, /números que no están en los datos/);
});

test("a thesis's reason is checked against its own coin", () => {
  assert.equal(verifyCoinText("Rebota en el soporte de 116,11. El soporte en 120,5 aguanta.", "SOL", FACTS), "Rebota en el soporte de 116,11.");
});
