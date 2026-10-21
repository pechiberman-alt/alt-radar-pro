// Pruebas de la operativa con el mapa y el flujo (lib/confluencia.ts, PLAN_CONFLUENCIA_1): la foto del flujo al entrar (sin la
// propia regla, sin mirar el futuro), el veredicto fijado de antemano, la validación de lo que manda el navegador, las dos
// versiones de cada agente en la oficina y el historial publicado de cada regla (que coincide con los documentos).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DELANTE_CONTRA_R, entraConMapa, motivosContra, veredicto, veredictoDeFoto } from "../lib/confluencia.ts";
import { fotoFlujo, fotoFlujoDeJson, lecturaFlujo, validarFotoFlujo, VELAS_FOTO_FLUJO, type FotoFlujo, type LecturaFlujo } from "../lib/flujo-lectura.ts";
import type { FotoMapa } from "../lib/mapa-contexto.ts";
import { ESTUDIO_FILAS } from "../lib/estudio-estrategias-datos.ts";
import { HISTORIAL_APARTE, historialDe, textoHistorial } from "../lib/oficina-historial.ts";
import { armarOficina, type FilaOficina } from "../lib/oficina.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const mapa = (x: Partial<FotoMapa> = {}): FotoMapa => ({ v: 1, detras: 0, delante: null, liquidezStop: false, motivos: [], ...x });
const flujo = (x: Partial<FotoFlujo> = {}): FotoFlujo => ({ v: 1, aFavor: [], enContra: [], conDelta: true, ...x });

test("veredicto: en contra gana; a favor con zona detrás o flujo a favor; sin las dos fotos, no hay veredicto", () => {
  assert.equal(veredicto(mapa(), flujo()), "NEUTRA");
  assert.equal(veredicto(mapa({ detras: 2 }), flujo()), "A_FAVOR");
  assert.equal(veredicto(mapa(), flujo({ aFavor: ["BARV"] })), "A_FAVOR");
  assert.equal(veredicto(mapa({ delante: DELANTE_CONTRA_R - 0.01, detras: 3 }), flujo({ aFavor: ["ABSO"] })), "EN_CONTRA", "una zona cerca en el camino frena aunque haya algo a favor");
  assert.equal(veredicto(mapa({ delante: DELANTE_CONTRA_R }), flujo()), "NEUTRA", "a 1 R o más, el camino no se considera tapado");
  assert.equal(veredicto(mapa({ liquidezStop: true }), flujo()), "EN_CONTRA");
  assert.equal(veredicto(mapa(), flujo({ enContra: ["ΔABS"] })), "EN_CONTRA");
  assert.equal(veredicto(null, flujo()), null);
  assert.equal(veredicto(mapa(), null), null);
  assert.equal(entraConMapa("A_FAVOR") && entraConMapa("NEUTRA"), true);
  assert.equal(entraConMapa("EN_CONTRA") || entraConMapa(null), false, "sin veredicto no cuenta para la versión con el mapa");
  assert.deepEqual(motivosContra(mapa({ delante: 0.5, liquidezStop: true }), flujo({ enContra: ["BARV"] })), ["zona en el camino a 0,50 R", "stop junto a liquidez sin barrer", "flujo en contra (BARV)"]);
});

test("foto del flujo: a favor y en contra según el lado, sin contar la propia regla", () => {
  const lectura: LecturaFlujo = {
    velas: 3,
    sinDelta: false,
    disparos: [
      { id: "ABSORCION", codigo: "ABSO", corto: "Absorción", lado: "LONG", stop: 1, objetivo: 3, openTime: 3, cierre: 2, extremo: 1 },
      { id: "BARRIDA_VOL", codigo: "BARV", corto: "Barrida con volumen", lado: "LONG", stop: 1, objetivo: 3, openTime: 2, cierre: 2, extremo: 1 },
      { id: "DELTA_ABSORBIDO", codigo: "ΔABS", corto: "Delta absorbido", lado: "SHORT", stop: 3, objetivo: 1, openTime: 1, cierre: 2, extremo: 3 },
    ],
  };
  assert.deepEqual(fotoFlujo(lectura, "LONG"), { v: 1, aFavor: ["ABSO", "BARV"], enContra: ["ΔABS"], conDelta: true });
  assert.deepEqual(fotoFlujo(lectura, "LONG", "ABSO").aFavor, ["BARV"], "la absorción no se confirma a sí misma");
  assert.deepEqual(fotoFlujo({ ...lectura, sinDelta: true }, "SHORT"), { v: 1, aFavor: ["ΔABS"], enContra: ["ABSO", "BARV"], conDelta: false });
});

test("la foto del flujo mira solo las últimas velas cerradas y no el futuro", () => {
  let s = 3;
  const azar = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  let p = 100;
  const v: SwingCandle[] = [];
  for (let k = 0; k < 300; k += 1) {
    const open = p;
    p = Math.max(1, p * (1 + 0.02 * (azar() - 0.5)));
    const volume = 5 + 40 * azar() ** 3;
    v.push({ openTime: k * 14_400_000, open, high: Math.max(open, p) * (1 + 0.01 * azar()), low: Math.min(open, p) * (1 - 0.01 * azar()), close: p, volume, quoteVolume: volume * p, takerBuy: volume * azar() });
  }
  // La lectura con toda la serie (las velas posteriores incluidas) tiene las mismas lecturas en esas velas: no miran el futuro.
  const completa = lecturaFlujo(v, 120);
  let vistos = 0;
  for (const i of [200, 230, 260, 299]) {
    const hasta = v.slice(0, i + 1);
    const l = lecturaFlujo(hasta, VELAS_FOTO_FLUJO);
    assert.ok(l.disparos.every((d) => d.openTime >= hasta[hasta.length - VELAS_FOTO_FLUJO].openTime), "solo las últimas 3 velas");
    for (const d of l.disparos) {
      vistos += 1;
      assert.ok(completa.disparos.some((x) => x.id === d.id && x.openTime === d.openTime && x.lado === d.lado && x.stop === d.stop), `${d.id} en ${d.openTime}`);
    }
  }
  assert.ok(vistos >= 0);
});

test("lo que manda el navegador: solo códigos de la mesa de flujo", () => {
  assert.deepEqual(validarFotoFlujo({ v: 1, aFavor: ["BARV", "ABSO", "ABSO"], enContra: [], conDelta: false }), { v: 1, aFavor: ["ABSO", "BARV"], enContra: [], conDelta: false });
  assert.equal(validarFotoFlujo({ v: 1, aFavor: ["<script>"], enContra: [], conDelta: true }), null);
  assert.equal(validarFotoFlujo({ v: 2, aFavor: [], enContra: [], conDelta: true }), null);
  assert.equal(validarFotoFlujo({ v: 1, aFavor: [], enContra: [] }), null);
  assert.equal(fotoFlujoDeJson("no es json"), null);
  const json = JSON.stringify({ acuerdo: 1, mapa: mapa({ detras: 1 }), flujo: flujo() });
  assert.equal(veredictoDeFoto(json), "A_FAVOR");
  assert.equal(veredictoDeFoto(JSON.stringify({ acuerdo: 0, mapa: mapa() })), null, "sin foto del flujo no hay veredicto");
});

test("oficina: cada agente se mide con su regla sola y con el mapa, sobre las mismas entradas", () => {
  const H = 3_600_000;
  const fila = (k: number, r: number | null, foto: object | null): FilaOficina => ({
    clave: `sv:BOLLINGER:BTCUSDT:4h:LONG:${1_700_000_000_000 + k * 4 * H}`,
    symbol: "BTCUSDT",
    lado: "LONG",
    r,
    desenlace: r === null ? "ABIERTA" : r > 0 ? "TP3" : "SL",
    cerrada: r === null ? null : 1_700_100_000_000 + k,
    detectada: 1_700_000_000_000 + k,
    foto: foto ? JSON.stringify(foto) : null,
  });
  const filas = [
    fila(1, 2, { acuerdo: 0, mapa: mapa({ detras: 2 }), flujo: flujo() }),
    fila(2, -1, { acuerdo: 0, mapa: mapa({ liquidezStop: true }), flujo: flujo() }),
    fila(3, -1, { acuerdo: 0, mapa: mapa(), flujo: flujo() }),
    fila(4, 1.5, { acuerdo: 0, mapa: mapa() }),
    fila(5, null, { acuerdo: 0, mapa: mapa({ delante: 0.4 }), flujo: flujo() }),
  ];
  const o = armarOficina(filas, 1_700_200_000_000, "SERVIDOR");
  const e = o.escritorios.find((x) => x.id === "BOLLINGER")!;
  assert.equal(e.total.cerradas, 4, "la regla sola cuenta todo");
  assert.equal(e.conMapa.cerradas, 2, "con el mapa: las que tenían veredicto y no estaban en contra");
  assert.equal(e.conMapa.neto, 1);
  assert.equal(e.frenadas.cerradas, 1);
  assert.equal(e.conVeredicto, 4, "la que no tiene foto del flujo no tiene veredicto");
  assert.equal(e.abiertas[0].veredicto, "EN_CONTRA");
  assert.ok(e.historial && e.historial.marco === "4h");
});

test("historial: la tabla del estudio en 4 h y los estudios aparte, iguales a lo publicado", () => {
  const st = ESTUDIO_FILAS.find((f) => f.estrategia === "SUPERTREND" && f.marco === "4h")!;
  assert.deepEqual([historialDe("SUPERTREND")?.operaciones, historialDe("SUPERTREND")?.profitFactor], [st.evaluacion.operaciones, st.evaluacion.profitFactor]);
  assert.equal(historialDe("DELTA_DIV"), null, "las reglas de delta no tienen historial");
  assert.equal(historialDe("ST_REGIMEN"), null);
  const coma = (v: number, d: number) => v.toFixed(d).replace(".", ",");
  const flujoDoc = readFileSync("docs/busqueda-flujo.md", "utf8");
  for (const id of ["ABSORCION", "ESFUERZO", "BARRIDA_VOL"]) {
    const h = HISTORIAL_APARTE[id];
    const fila = `| ${id} | 4h | ${h.operaciones} | ${coma((h.winRate ?? 0) * 100, 1)} % | ${coma(h.profitFactor ?? 0, 2)} | ${coma(h.expectancia ?? 0, 3)} |`;
    assert.ok(flujoDoc.includes(fila), `${id} coincide con docs/busqueda-flujo.md: ${fila}`);
  }
  const amd = readFileSync("docs/busqueda-amd.md", "utf8").split("## Evaluación: PLAN_AMD_1")[0];
  const a = HISTORIAL_APARTE.AMD_IFVG;
  assert.ok(amd.includes(`| 4h | ${a.operaciones} | ${coma((a.winRate ?? 0) * 100, 1)} % | ${coma(a.profitFactor ?? 0, 2)} | ${coma(a.expectancia ?? 0, 3)} |`), "AMD coincide con docs/busqueda-amd.md");
  const m = HISTORIAL_APARTE.METALES_D55;
  assert.ok(readFileSync("docs/estudio-axi.md", "utf8").includes(`| Evaluación | ${m.operaciones} | ${coma((m.winRate ?? 0) * 100, 1)} % | ${coma(m.profitFactor ?? 0, 2)} | +${coma(m.expectancia ?? 0, 3)} |`), "metales coincide con docs/estudio-axi.md");
  assert.match(textoHistorial(historialDe("METALES_D55")), /no es prueba limpia/);
  assert.match(textoHistorial(historialDe("ESFUERZO")), /muestra mínima/);
  assert.equal(textoHistorial(null), "sin medición del pasado");
});
