// Pruebas de la foto del mapa de cada entrada (lib/mapa-contexto.ts) y de los motivos compartidos con el mapa
// (lib/mapa-atomos.ts): zona detrás del stop, zona en el camino, liquidez junto al stop, la forma que acepta el servidor, y que
// la foto no mira el futuro (la vela de entrada, todavía abierta, no la cambia).
import assert from "node:assert/strict";
import test from "node:test";
import { leerSenalesPapel, MARCO_AGENTES_MS } from "../lib/agentes-papel.ts";
import { generadorAzar } from "../lib/jarvis-stats.ts";
import { atomosMapa } from "../lib/mapa-atomos.ts";
import { fotoDeJson, fotoMapa, LIQUIDEZ_STOP_ATR, textosFoto, validarFotoMapa, type ContextoVelas } from "../lib/mapa-contexto.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const zona = (low: number, high: number, stars: number, kinds = ["order block", "FVG"]) => ({ low, high, mid: (low + high) / 2, score: stars, stars, kinds });

test("largo: zona detrás del stop, la primera zona en el camino en R, y liquidez junto al stop", () => {
  const ctx: ContextoVelas = {
    atr: 2,
    zonas: [zona(96, 97, 2), zona(104, 105, 3), zona(108, 109, 2), zona(120, 121, 4)],
    liquidez: [{ precio: 95.4, lado: "BAJOS" }],
  };
  const f = fotoMapa(ctx, "LONG", 100, 95, 110)!;
  assert.equal(f.detras, 2, "la zona 96–97 está entre el stop y la entrada");
  assert.equal(f.delante, 0.8, "la primera zona en el camino empieza en 104: (104 − 100) / 5");
  assert.equal(f.liquidezStop, true, `95,4 está entre el stop y ${LIQUIDEZ_STOP_ATR} ATR arriba`);
  assert.deepEqual(f.motivos, ["order block", "FVG"]);
  const lejos = fotoMapa({ ...ctx, liquidez: [{ precio: 96, lado: "BAJOS" }, { precio: 95.2, lado: "ALTOS" }] }, "LONG", 100, 95, 110)!;
  assert.equal(lejos.liquidezStop, false, "a más de 0,3 ATR, o del lado equivocado, no cuenta");
  const libre = fotoMapa({ ...ctx, zonas: [zona(120, 121, 4)] }, "LONG", 100, 95, 110)!;
  assert.equal(libre.delante, null, "una zona más allá del objetivo no está en el camino");
  assert.equal(libre.detras, 0);
});

test("corto: el espejo", () => {
  const ctx: ContextoVelas = { atr: 2, zonas: [zona(103, 104, 3), zona(92, 94, 2)], liquidez: [{ precio: 104.6, lado: "ALTOS" }] };
  const f = fotoMapa(ctx, "SHORT", 100, 105, 90)!;
  assert.equal(f.detras, 3);
  assert.equal(f.delante, 1.2, "(100 − 94) / 5");
  assert.equal(f.liquidezStop, true);
  assert.equal(fotoMapa(ctx, "SHORT", 100, 100, 90), null, "sin riesgo no hay foto");
});

test("el servidor acepta solo la forma exacta de la foto; fotoDeJson la lee del JSON de la entrada", () => {
  const buena = { v: 1 as const, detras: 2, delante: 0.8, liquidezStop: true, motivos: ["order block", "FVG"] };
  assert.deepEqual(validarFotoMapa(buena), buena);
  assert.equal(validarFotoMapa({ ...buena, v: 2 }), null);
  assert.equal(validarFotoMapa({ ...buena, detras: 9 }), null);
  assert.equal(validarFotoMapa({ ...buena, delante: "1" }), null);
  assert.equal(validarFotoMapa({ ...buena, liquidezStop: "sí" }), null);
  assert.deepEqual(validarFotoMapa({ ...buena, motivos: ["<script>", "FVG", 3] })?.motivos, ["FVG"], "los motivos raros se descartan");
  assert.deepEqual(fotoDeJson(JSON.stringify({ acuerdo: 1, contra: 0, con: [], mapa: buena })), buena);
  assert.equal(fotoDeJson(JSON.stringify({ acuerdo: 1 })), null);
  assert.equal(fotoDeJson("no es json"), null);
  assert.equal(textosFoto(buena).length, 3);
});

test("los motivos del mapa: la liquidez tomada no cuenta, la de varios marcos pesa más y los niveles de pura liquidez no se repiten", () => {
  const atomos = atomosMapa({
    pools: [{ price: 100, taken: true }, { price: 101, frames: ["1h", "4h"] }],
    imanes: [null, { price: 90 }],
    niveles: [
      { low: 99, high: 99.5, sources: [{ kind: "IMÁN" }, { kind: "POOL 4h" }] },
      { low: 98, high: 98.5, sources: [{ kind: "PDH" }] },
    ],
  });
  assert.deepEqual(atomos.map((a) => [a.kind, a.weight]), [["liquidez", 1.5], ["imán de liquidaciones", 1.5], ["nivel clave", 1]]);
});

test("no mira el futuro: la foto de cada entrada es la misma aunque cambie la vela de entrada, que sigue abierta", () => {
  let vistas = 0;
  for (let semilla = 1; semilla <= 4 && vistas < 3; semilla += 1) {
    const azar = generadorAzar(semilla);
    const v: SwingCandle[] = [];
    let p = 100;
    for (let k = 0; k < 420; k += 1) {
      const vol = Math.floor(k / 30) % 2 === 0 ? 0.4 : 1.8;
      const o = p;
      const c = o + (azar() - 0.48) * 2 * vol;
      v.push({ openTime: (1000 + k) * MARCO_AGENTES_MS, open: o, high: Math.max(o, c) + azar() * vol, low: Math.min(o, c) - azar() * vol, close: c, volume: 100 + azar() * 50, quoteVolume: 0 });
      p = c;
    }
    for (let k = 260; k < v.length - 1 && vistas < 3; k += 1) {
      const velas = v.slice(0, k + 1);
      const ahora = velas[k].openTime + 60_000;
      const planes = leerSenalesPapel("BTCUSDT", velas, ahora);
      const conFoto = planes.filter((x) => x.foto);
      if (!conFoto.length) continue;
      // La vela de entrada (la última) cambia por completo: la foto usa solo velas cerradas, así que no puede cambiar.
      const otra = [...velas.slice(0, -1), { ...velas[k], high: velas[k].high * 1.2, low: velas[k].low * 0.8 }];
      const despues = leerSenalesPapel("BTCUSDT", otra, ahora);
      for (const x of conFoto) assert.deepEqual(despues.find((y) => y.estrategia === x.estrategia)?.foto, x.foto, `${x.estrategia} en la vela ${k}`);
      vistas += 1;
    }
  }
  assert.ok(vistas >= 1, "hubo entradas con foto para probar");
});
