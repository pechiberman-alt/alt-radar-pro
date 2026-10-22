/**
 * Pruebas del método de cada mente (lib/mentes-metodo.ts): el orden de sus preguntas, sus vetos, su plan y que, sin balances
 * o con un criptoactivo, las lentes de valor se abstengan en vez de inventar. Incluye que nada mira el futuro.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SwingCandle } from "../lib/swing-entries.ts";
import type { Ejercicio, Fundamentales } from "../lib/fundamentales-sec.ts";
import type { EntradaMentes } from "../lib/mentes-inversoras.ts";
import { FAMILIA, razonarMentes, tamanoPorRiesgo, type Razonamiento } from "../lib/mentes-metodo.ts";

const DIA = 86_400_000;

function serie(n: number, tendencia = 0.001, semilla = 7, inicio = 100): SwingCandle[] {
  let s = semilla;
  const azar = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const out: SwingCandle[] = [];
  let p = inicio;
  for (let k = 0; k < n; k += 1) {
    const o = p;
    const c = o * (1 + tendencia + (azar() - 0.5) * 0.01);
    const h = Math.max(o, c) * (1 + azar() * 0.004);
    const l = Math.min(o, c) * (1 - azar() * 0.004);
    const v = 1000 + azar() * 1000;
    out.push({ openTime: Date.UTC(2024, 0, 1) + k * DIA, open: o, high: h, low: l, close: c, volume: v, quoteVolume: v * c });
    p = c;
  }
  return out;
}

const ej = (anio: number, x: Partial<Ejercicio>): Ejercicio => ({
  fin: `${anio}-12-31`,
  ingresos: 1000,
  gananciaNeta: 1000,
  bpa: 2,
  patrimonio: 5000,
  pasivo: 2000,
  deuda: 500,
  activoCorriente: 3000,
  pasivoCorriente: 1000,
  ...x,
});

const fund = (ejercicios: Ejercicio[]): Fundamentales => ({ simbolo: "TEST", entidad: "TEST INC", ejercicios, fuente: "SEC EDGAR", leido: 0, faltantes: [] });

/** Una empresa de calidad: gana siempre, ROE 20 %, poca deuda, BPA que sube sin caídas. */
const buena = () =>
  fund([2020, 2021, 2022, 2023, 2024].map((a, k) => ej(a, { bpa: 1.6 + k * 0.1, gananciaNeta: 1000 + k * 40, patrimonio: 5000, ingresos: 5000 + k * 400 })));

function entrada(extra: Partial<EntradaMentes> = {}): EntradaMentes {
  return {
    simbolo: "TEST",
    velas: serie(300),
    moneda: "ARS",
    precioUsd: 30,
    fund: buena(),
    sinFund: null,
    fuerzaRelativa: 80,
    mercadoAlcista: true,
    mercadoNombre: "S&P 500",
    volMediana: 0.3,
    ...extra,
  };
}

const de = (rs: Razonamiento[], id: string) => rs.find((r) => r.id === id)!;

test("cada mente tiene familia y un razonamiento propio", () => {
  const rs = razonarMentes(entrada());
  assert.equal(rs.length, 9);
  for (const r of rs) assert.equal(r.familia, FAMILIA[r.id]);
  assert.equal(de(rs, "BUFFETT").familia, "VALOR");
  assert.equal(de(rs, "PTJ").familia, "MOMENTUM");
  assert.equal(de(rs, "TEMPLETON").familia, "CONTRARIA");
});

test("Buffett: primero pregunta si entiendes el negocio (no se mide), y un año con pérdida lo corta", () => {
  const ok = de(razonarMentes(entrada({ precioUsd: 20 })), "BUFFETT");
  assert.equal(ok.pasos[0].resultado, "NO SE", "el foso y entender el negocio no se miden");
  assert.ok(ok.noSabe.some((t) => /foso/.test(t)));
  assert.equal(ok.veredicto, "COMPRARÍA", "calidad sin fallas y PER ≤ 25");
  assert.equal(ok.plan?.stop, null, "no pone stop por precio");
  assert.match(ok.plan!.salida, /tesis/);

  const caro = de(razonarMentes(entrada({ precioUsd: 90 })), "BUFFETT");
  assert.equal(caro.veredicto, "ESPERARÍA");
  assert.equal(caro.plan?.entrada, 25 * 2, "esperaría el precio de PER 25: 25 × BPA del último ejercicio (2,0)");

  const perdio = fund([ej(2020, {}), ej(2021, { gananciaNeta: -50, bpa: -0.1 }), ej(2022, {}), ej(2023, {}), ej(2024, {})]);
  const corta = de(razonarMentes(entrada({ fund: perdio })), "BUFFETT");
  assert.equal(corta.veredicto, "NO LO TOCARÍA");
  assert.ok(corta.pasos.some((p) => p.corta), "el año con pérdida corta el análisis");
});

test("Graham: calcula un valor y exige un colchón de un tercio", () => {
  // Ganancia 1000 y BPA 2 → 500 acciones; patrimonio 5000 → valor libro 10; valor = √(22,5 × 2 × 10) = 21,21.
  const f = fund([2020, 2021, 2022, 2023, 2024].map((a) => ej(a, { bpa: 2, gananciaNeta: 1000, patrimonio: 5000 })));
  const barato = de(razonarMentes(entrada({ fund: f, precioUsd: 12 })), "GRAHAM");
  assert.equal(barato.veredicto, "COMPRARÍA");
  assert.ok(Math.abs(barato.plan!.objetivo! - Math.sqrt(450)) < 1e-9);
  assert.ok(Math.abs(barato.plan!.entrada! - (2 / 3) * Math.sqrt(450)) < 1e-9, "compraría a 2/3 del valor");
  const justo = de(razonarMentes(entrada({ fund: f, precioUsd: 20 })), "GRAHAM");
  assert.equal(justo.veredicto, "ESPERARÍA", "bajo el valor pero sin colchón");
  const caro = de(razonarMentes(entrada({ fund: f, precioUsd: 30 })), "GRAHAM");
  assert.equal(caro.veredicto, "NO LO TOCARÍA");
  assert.match(caro.porQue, /más que su valor/);
});

test("Lynch: clasifica la acción antes de juzgarla y cada clase tiene otra regla", () => {
  const rapida = fund([1, 1.25, 1.6, 2, 2.5].map((b, k) => ej(2020 + k, { bpa: b, gananciaNeta: 500 * b })));
  const r = de(razonarMentes(entrada({ fund: rapida, precioUsd: 25 })), "LYNCH");
  assert.equal(r.clase, "RÁPIDA");
  assert.equal(r.veredicto, "COMPRARÍA", "PER 10 con crecimiento de ~26 %: PEG bajo 1");

  const ciclica = fund([1, 2, 1, 2, 1].map((b, k) => ej(2020 + k, { bpa: b, gananciaNeta: 500 * b })));
  const c = de(razonarMentes(entrada({ fund: ciclica, precioUsd: 12 })), "LYNCH");
  assert.equal(c.clase, "CÍCLICA");
  assert.equal(c.veredicto, "ESPERARÍA", "el PER bajo de una cíclica es alarma, no oferta");
  assert.match(c.porQue, /ciclo/);

  const lenta = fund([2, 2.02, 2.04, 2.06, 2.08].map((b, k) => ej(2020 + k, { bpa: b, gananciaNeta: 500 * b })));
  assert.equal(de(razonarMentes(entrada({ fund: lenta })), "LYNCH").clase, "LENTA");

  const recup = fund([2, 2, 2, 2, -1].map((b, k) => ej(2020 + k, { bpa: b, gananciaNeta: 500 * b })));
  assert.equal(de(razonarMentes(entrada({ fund: recup })), "LYNCH").clase, "EN RECUPERACIÓN");
});

test("sin balances las lentes de valor dicen SIN DATOS; con un criptoactivo, FUERA DE MI MÉTODO (no es estar en contra)", () => {
  const sin = razonarMentes(entrada({ fund: null, sinFund: "SEC no respondió" }));
  for (const id of ["BUFFETT", "GRAHAM", "LYNCH", "MUSK"]) {
    assert.equal(de(sin, id).veredicto, "SIN DATOS");
    assert.match(de(sin, id).porQue, /SEC no respondió/);
  }
  const cripto = razonarMentes(entrada({ fund: null, sinFund: "los criptoactivos no tienen balances", moneda: "USDT" }), "CRIPTO");
  for (const id of ["BUFFETT", "GRAHAM", "LYNCH", "MUSK", "ONEIL"]) assert.equal(de(cripto, id).veredicto, "FUERA DE MI MÉTODO", id);
  assert.match(de(cripto, "BUFFETT").porQue, /no es lo mismo que estar en contra/i);
  // Las mentes de precio siguen opinando sobre cripto.
  for (const id of ["PTJ", "DARVAS", "TEMPLETON"]) assert.notEqual(de(cripto, id).veredicto, "FUERA DE MI MÉTODO", id);
});

test("Paul Tudor Jones: tendencia, stop en la media de 200 y tamaño por riesgo; bajo la media, afuera", () => {
  const alza = de(razonarMentes(entrada({ velas: serie(320, 0.002) })), "PTJ");
  assert.ok(["COMPRARÍA", "ESPERARÍA"].includes(alza.veredicto));
  assert.ok(alza.plan!.stop! < alza.plan!.entrada!, "el stop es la media de 200, abajo");
  assert.match(alza.plan!.tamano!, /1 %/);
  assert.match(alza.plan!.salida, /media de 200/);

  const baja = de(razonarMentes(entrada({ velas: serie(320, -0.003) })), "PTJ");
  assert.equal(baja.veredicto, "AFUERA");
  assert.match(baja.porQue, /no promedia/i);

  assert.equal(de(razonarMentes(entrada({ velas: serie(100) })), "PTJ").veredicto, "SIN DATOS");
});

test("Darvas: compra la ruptura de la caja con volumen, con el stop en el piso de la caja", () => {
  const velas = serie(300, 0.001);
  const caja = velas.slice(-21, -1);
  const techo = Math.max(...caja.map((c) => c.high));
  const piso = Math.min(...caja.map((c) => c.low));
  const ult = velas[velas.length - 1];
  velas[velas.length - 1] = { ...ult, open: techo, high: techo * 1.05, low: techo * 0.99, close: techo * 1.04, volume: ult.volume * 20 };
  const d = de(razonarMentes(entrada({ velas })), "DARVAS");
  assert.equal(d.veredicto, "COMPRARÍA");
  assert.equal(d.plan?.entrada, techo, "entra sobre el techo de la caja");
  assert.equal(d.plan?.stop, piso, "sale bajo el piso de la caja");
  assert.match(d.plan!.salida, /caja/);

  const sinVol = [...velas];
  sinVol[sinVol.length - 1] = { ...sinVol[sinVol.length - 1], volume: 1 };
  assert.equal(de(razonarMentes(entrada({ velas: sinVol })), "DARVAS").veredicto, "ESPERARÍA", "sin volumen no confirma");

  const cae = [...velas];
  cae[cae.length - 1] = { ...cae[cae.length - 1], high: piso, low: piso * 0.9, close: piso * 0.9 };
  assert.equal(de(razonarMentes(entrada({ velas: cae })), "DARVAS").veredicto, "AFUERA");
});

test("O'Neil: el mercado en contra lo frena de plano y su plan corta a 8 %", () => {
  const contra = de(razonarMentes(entrada({ mercadoAlcista: false })), "ONEIL");
  assert.equal(contra.veredicto, "NO LO TOCARÍA");
  assert.match(contra.porQue, /mercado/);
  assert.ok(contra.pasos.some((p) => p.corta));

  // Con el punto de compra recién roto, el plan corta 8 % abajo y toma ganancias a 20 %.
  const velas = serie(300, 0.001);
  const previas = velas.slice(-253, -1);
  const pivot = Math.max(...previas.map((c) => c.high));
  const ult = velas[velas.length - 1];
  velas[velas.length - 1] = { ...ult, open: pivot, high: pivot * 1.02, low: pivot * 0.995, close: pivot * 1.01, volume: ult.volume };
  const o = de(razonarMentes(entrada({ velas })), "ONEIL");
  if (o.plan) {
    assert.ok(Math.abs(o.plan.riesgo! - 0.08) < 1e-9);
    assert.ok(Math.abs(o.plan.objetivo! / o.plan.entrada! - 1.2) < 1e-9);
  }
});

test("Dalio no elige dirección: informa el peso por riesgo", () => {
  const d = de(razonarMentes(entrada()), "DALIO");
  assert.equal(d.veredicto, "INFORMA");
  assert.equal(d.plan, null);
  assert.ok(d.noSabe.some((t) => /régimen macro/.test(t)));
});

test("tamaño por riesgo: 1 % de la cuenta dividido por la distancia al stop", () => {
  assert.match(tamanoPorRiesgo(0.05)!, /20 % de la cuenta/);
  assert.match(tamanoPorRiesgo(0.005)!, /100 % de la cuenta/, "tope en toda la cuenta");
  assert.equal(tamanoPorRiesgo(null), null);
  assert.equal(tamanoPorRiesgo(0), null);
});

test("no mira el futuro: lo que se razona con las ruedas hasta k no cambia si después pasa cualquier cosa", () => {
  const todas = serie(340, 0.001);
  const hasta = todas.slice(0, 300);
  const a = razonarMentes(entrada({ velas: hasta }));
  const trucada = [...todas.slice(0, 300), ...todas.slice(300).map((c) => ({ ...c, close: c.close * 0.1, low: c.low * 0.1 }))];
  const b = razonarMentes(entrada({ velas: trucada.slice(0, 300) }));
  assert.deepEqual(a, b);
});

test("cada mente contesta con su propio método: qué haría, dónde sale, qué la cambiaría y qué no sabe", async () => {
  const { respuestaDeMetodo } = await import("../lib/mentes-metodo.ts");
  const f = fund([2020, 2021, 2022, 2023, 2024].map((a) => ej(a, { bpa: 2, gananciaNeta: 1000, patrimonio: 5000 })));
  const g = de(razonarMentes(entrada({ fund: f, precioUsd: 12 })), "GRAHAM");
  assert.match(respuestaDeMetodo(g, "¿qué harías con este papel?", "KO")!, /^KO: COMPRARÍA\./);
  assert.match(respuestaDeMetodo(g, "¿cuándo vendés?", "KO")!, /50 %/);
  assert.match(respuestaDeMetodo(g, "¿qué te haría cambiar de opinión?")!, /2\/3 del valor|pérdida/);
  assert.match(respuestaDeMetodo(g, "¿qué no podés saber?")!, /No puedo saber/);
  assert.match(respuestaDeMetodo(g, "¿cómo pensás?")!, /Mi método, en orden: 1\)/);
  assert.equal(respuestaDeMetodo(g, "¿cuál es la capital de Francia?"), null);

  const o = de(razonarMentes(entrada({ mercadoAlcista: false })), "ONEIL");
  assert.match(respuestaDeMetodo(o, "¿dónde ponés el stop?")!, /no entraría|Hoy no entraría/);
  const b = de(razonarMentes(entrada({ fund: null, sinFund: "x", moneda: "USDT" }), "CRIPTO"), "BUFFETT");
  assert.match(respuestaDeMetodo(b, "¿comprarías?")!, /FUERA DE MI MÉTODO/);
});
