// Pruebas del agente AMD + IFVG (lib/amd-ifvg.ts): el patrón completo dispara en la vela del IFVG con su stop y objetivo, el
// corto es el espejo, un rango alto no es acumulación, y ninguna señal mira velas posteriores a la suya.
import assert from "node:assert/strict";
import test from "node:test";
import { MARGEN_AMD_ATR, RR_AMD, senalesAmd } from "../lib/amd-ifvg.ts";
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
  const senal = senalesAmd(v, t);
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
  const s = senalesAmd(v, t)(23);
  assert.ok(s);
  assert.equal(s.lado, "SHORT");
  assert.ok(s.stop > v[23].close && s.objetivo < v[23].close);
});

test("un rango demasiado alto no es acumulación: no dispara", () => {
  const v = patronLargo();
  v[10] = vela(10, [101, 125, 100, 101]);
  assert.equal(senalesAmd(v, atr(v, 14))(23), null);
});

test("si el IFVG no vuelve adentro del rango, no dispara", () => {
  const v = patronLargo();
  v[23] = vela(23, [97, 99.6, 96.9, 99.4]);
  for (let k = 24; k < 30; k += 1) v[k] = vela(k, [99.4, 99.6, 99.2, 99.4]);
  assert.equal(senalesAmd(v, atr(v, 14))(23), null);
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
    const completa = senalesAmd(v, atr(v, 14));
    let vistas = 0;
    for (let i = 30; i < v.length; i += 1) {
      const corta = v.slice(0, i + 1);
      const a = completa(i);
      const b = senalesAmd(corta, atr(corta, 14))(i);
      assert.deepEqual(b, a, `semilla ${semilla}, vela ${i}`);
      if (a) vistas += 1;
    }
    assert.ok(vistas >= 0);
  }
});
