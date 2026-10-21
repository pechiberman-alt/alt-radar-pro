// Pruebas del agente AMD + IFVG (lib/amd-ifvg.ts): el patrón completo dispara en la vela del IFVG con su stop y objetivo, el
// corto es el espejo, un rango alto no es acumulación, el objetivo es el FVG de la temporalidad alta (PLAN_AMD_2) y ninguna señal
// mira velas posteriores a la suya. Las pruebas del patrón usan el objetivo fijo del PLAN_AMD_1 ("RR"), que se sigue midiendo.
import assert from "node:assert/strict";
import test from "node:test";
import { fvgsAltos, MARGEN_AMD_ATR, MIN_R_HTF, objetivoHtf, RR_AMD, senalesAmd, type ZonaHtf } from "../lib/amd-ifvg.ts";
import { atr } from "../lib/estrategias.ts";
import { generadorAzar } from "../lib/jarvis-stats.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const H = 3_600_000;
const vela = (k: number, [open, high, low, close]: number[]): SwingCandle => ({ openTime: k * H, open, high, low, close, volume: 1, quoteVolume: 0 });

/** 20 velas quietas entre 100 y 102, barrida del mínimo, hueco bajista en la pata y una vela que lo cierra y vuelve al rango. */
function patronLargo(): SwingCandle[] {
  const v: SwingCandle[] = [];
  for (let k = 0; k < 20; k += 1) v.push(vela(k, [101, 102, 100, 101]));
  v.push(vela(20, [101, 101.5, 99, 99.2])); // manipulación: pasa el mínimo del rango
  v.push(vela(21, [99.2, 99.3, 97.5, 97.6]));
  v.push(vela(22, [97.6, 97.8, 96.8, 97])); // hueco bajista entre 97,8 y 99
  v.push(vela(23, [97, 100.6, 96.9, 100.4])); // cierra por arriba del hueco y vuelve adentro del rango
  for (let k = 24; k < 30; k += 1) v.push(vela(k, [100.4, 101, 100, 100.5]));
  return v;
}

const espejo = (v: SwingCandle[]): SwingCandle[] => v.map((x) => ({ ...x, open: 200 - x.open, high: 200 - x.low, low: 200 - x.high, close: 200 - x.close }));

test("AMD de largo: dispara en la vela del IFVG, con stop bajo la manipulación y objetivo a 2 R", () => {
  const v = patronLargo();
  const t = atr(v, 14);
  const senal = senalesAmd(v, t, "RR");
  const con = v.map((_, i) => i).filter((i) => senal(i) !== null);
  assert.deepEqual(con, [23], "una sola señal, en la vela que cierra el hueco");
  const s = senal(23)!;
  assert.equal(s.lado, "LONG");
  const stop = 96.8 - MARGEN_AMD_ATR * t[23];
  assert.ok(Math.abs(s.stop - stop) < 1e-9);
  assert.ok(Math.abs(s.objetivo - (100.4 + RR_AMD * (100.4 - stop))) < 1e-9);
});

test("AMD de corto: el espejo del largo", () => {
  const v = espejo(patronLargo());
  const t = atr(v, 14);
  const s = senalesAmd(v, t, "RR")(23);
  assert.ok(s);
  assert.equal(s.lado, "SHORT");
  assert.ok(s.stop > v[23].close && s.objetivo < v[23].close);
});

test("un rango demasiado alto no es acumulación: no dispara", () => {
  const v = patronLargo();
  v[10] = vela(10, [101, 125, 100, 101]);
  assert.equal(senalesAmd(v, atr(v, 14), "RR")(23), null);
});

test("si el IFVG no vuelve adentro del rango, no dispara", () => {
  const v = patronLargo();
  v[23] = vela(23, [97, 99.6, 96.9, 99.4]);
  for (let k = 24; k < 30; k += 1) v[k] = vela(k, [99.4, 99.6, 99.2, 99.4]);
  assert.equal(senalesAmd(v, atr(v, 14), "RR")(23), null);
});

test("no mira el futuro: la señal de cada vela es la misma con la serie cortada en esa vela", () => {
  for (let semilla = 1; semilla <= 6; semilla += 1) {
    const azar = generadorAzar(semilla);
    const v: SwingCandle[] = [];
    let p = 100;
    for (let k = 0; k < 500; k += 1) {
      // Tramos quietos y tramos con tirones, para que aparezcan rangos, barridas y huecos.
      const vol = Math.floor(k / 40) % 2 === 0 ? 0.3 : 1.6;
      const o = p;
      const c = o + (azar() - 0.5) * 2 * vol;
      v.push(vela(k, [o, Math.max(o, c) + azar() * vol, Math.min(o, c) - azar() * vol, c]));
      p = c;
    }
    for (const modo of ["HTF", "RR"] as const) {
      const completa = senalesAmd(v, atr(v, 14), modo);
      for (let i = 30; i < v.length; i += 1) {
        const corta = v.slice(0, i + 1);
        assert.deepEqual(senalesAmd(corta, atr(corta, 14), modo)(i), completa(i), `semilla ${semilla}, ${modo}, vela ${i}`);
      }
    }
  }
});

/**
 * Velas de 1 h (la temporalidad alta es de 6 h): una caída deja un FVG bajista de 6 h entre 108 y 112, el precio se queda quieto
 * entre 100 y 102 y después hace el AMD de largo, con el IFVG en la vela 47.
 */
function conFvgAlto(): SwingCandle[] {
  const v: SwingCandle[] = [];
  for (let k = 0; k < 6; k += 1) v.push(vela(k, [115, 116, 112, 115]));
  const caida = [[115, 115.5, 110.5, 111], [111, 111.2, 108, 108.5], [108.5, 108.6, 105, 105.5], [105.5, 105.6, 103, 103.2], [103.2, 103.3, 101.5, 102], [102, 102.5, 101, 101.5]];
  caida.forEach((c, j) => v.push(vela(6 + j, c)));
  v.push(vela(12, [101.5, 108, 101, 102]));
  for (let k = 13; k < 18; k += 1) v.push(vela(k, [102, 103, 100.5, 101.5]));
  for (let k = 18; k < 44; k += 1) v.push(vela(k, [101, 102, 100, 101]));
  v.push(vela(44, [101, 101.5, 99, 99.2]));
  v.push(vela(45, [99.2, 99.3, 97.5, 97.6]));
  v.push(vela(46, [97.6, 97.8, 96.8, 97]));
  v.push(vela(47, [97, 100.6, 96.9, 100.4]));
  for (let k = 48; k < 54; k += 1) v.push(vela(k, [100.4, 101, 100, 100.5]));
  return v;
}

test("PLAN_AMD_2: el objetivo es el borde cercano del FVG de la temporalidad alta, no 2 R", () => {
  const v = conFvgAlto();
  const z = fvgsAltos(v);
  assert.ok(z.some((x) => x.bajo === 108 && x.alto === 112 && x.formada === 17 && x.llena === Infinity), "el FVG de 6 h se conoce al cerrar la vela 17");
  const s = senalesAmd(v, atr(v, 14))(47);
  assert.ok(s);
  assert.equal(s.lado, "LONG");
  assert.equal(s.objetivo, 108);
  assert.ok(108 - 100.4 >= MIN_R_HTF * (100.4 - s.stop));
});

test("PLAN_AMD_2: si el FVG alto ya se llenó, no hay objetivo y no opera", () => {
  const v = conFvgAlto();
  v[20] = vela(20, [101, 112.5, 100, 101]);
  assert.equal(senalesAmd(v, atr(v, 14))(47), null);
});

test("objetivoHtf: el FVG sin llenar más cercano y ya conocido; si queda a menos de 1 R, nada (no salta al siguiente)", () => {
  const zonas: ZonaHtf[] = [
    { bajo: 110, alto: 112, formada: 5, llena: Infinity },
    { bajo: 104, alto: 106, formada: 5, llena: 8 }, // se llenó antes de la entrada
    { bajo: 103, alto: 104, formada: 12, llena: Infinity }, // se forma después de la entrada
    { bajo: 90, alto: 92, formada: 5, llena: Infinity },
  ];
  assert.equal(objetivoHtf(zonas, "LONG", 100, 4, 10), 110);
  assert.equal(objetivoHtf(zonas, "SHORT", 100, 4, 10), 92);
  assert.equal(objetivoHtf(zonas, "LONG", 100, 20, 10), null, "110 queda a 0,5 R");
  assert.equal(objetivoHtf([{ bajo: 101, alto: 102, formada: 5, llena: Infinity }, ...zonas], "LONG", 100, 4, 10), null, "el cercano llega antes");
  assert.equal(objetivoHtf([], "LONG", 100, 4, 10), null);
});
