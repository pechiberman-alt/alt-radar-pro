/**
 * Pruebas de la pantalla HOY (lib/hoy.ts): planes vigentes y viejos, papeles en zona, avisos sin HTML, el semáforo ordenado
 * (lo que ya dice algo primero) y que lo que no se pudo leer se diga en vez de mostrarse como cero.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { armarHoy, textoPlano, VIDA_AR_MS } from "../lib/hoy.ts";
import { armarRegistro, contar } from "../lib/registro.ts";

const AHORA = Date.UTC(2026, 9, 22, 22);

test("planes de la pizarra y papeles en zona: lo viejo se marca y no cuenta en el titular", () => {
  const h = armarHoy(
    {
      registro: null,
      estadosAr: [
        { ticker: "GGAL", at: AHORA - 3_600_000, vela: 1, fib: "EN LA ZONA", veredicto: "HAY PLAN", huella: "aaaa1111", error: null },
        { ticker: "YPFD", at: AHORA - VIDA_AR_MS - 1, vela: 1, fib: "EN LA ZONA", veredicto: "HAY PLAN", huella: "bbbb2222", error: null },
        { ticker: "PAMP", at: AHORA, vela: 1, fib: "ARRIBA DE LA ZONA", veredicto: "ESPERAR", huella: null, error: null },
      ],
      avisos: [{ clave: "k", ticker: "GGAL", texto: "📐 <b>BYMA · GGAL</b> entró &amp; algo" }],
      nucleo: [{ symbol: "BTCUSDT", source: "ROMPE", side: "LONG", entry: 1, stop: 0.9, target: 1.2, time: 5, taken: true }, { symbol: "ETHUSDT", source: "ROMPE", side: "SHORT", entry: 1, stop: 1.1, target: 0.8, time: 6, taken: false }],
      pizarraCripto: [],
    },
    AHORA,
  );
  assert.deepEqual(h.planesAr.map((p) => [p.ticker, p.viejo]), [["GGAL", false], ["YPFD", true]]);
  assert.deepEqual(h.enZonaAr, ["GGAL"], "la lectura vieja no cuenta como en zona");
  assert.equal(h.avisos[0].texto, "📐 BYMA · GGAL entró & algo");
  assert.equal(h.nucleo.length, 1, "las señales en sombra no se muestran como abiertas");
  assert.match(h.titular, /^Hoy: 1 plan de la pizarra, 1 papel en zona/);
  assert.ok(h.faltan.includes("el registro unificado"));
});

test("el semáforo pone primero lo que ya dice algo y solo muestra fuentes globales con operaciones", () => {
  const mala = Array.from({ length: 30 }, (_, k) => ({ r: k % 4 === 0 ? 1 : -1, cerradaA: k, abiertaA: null }));
  const reg = armarRegistro(
    [
      { id: "AGENTES_SERVIDOR", conteo: contar([{ r: 1, abierta: false }]), cierres: [{ r: 1, cerradaA: 1, abiertaA: null }] },
      { id: "NUCLEO_ROMPE", conteo: contar(mala.map((c) => ({ r: c.r, abierta: false }))), cierres: mala },
      { id: "PAPEL", conteo: contar([{ r: 1, abierta: false }]) },
      { id: "NUCLEO_IA", conteo: contar([]) },
    ],
    AHORA,
  );
  const h = armarHoy({ registro: reg, estadosAr: [], avisos: [], nucleo: [], pizarraCripto: [] }, AHORA);
  assert.deepEqual(h.evidencia.map((e) => [e.id, e.nivel]), [["NUCLEO_ROMPE", "NEGATIVA"], ["AGENTES_SERVIDOR", "MUESTRA MÍNIMA"]]);
  assert.match(h.titular, /ninguna fuente con evidencia positiva todavía/);
  assert.deepEqual(h.faltan, []);
});

test("texto plano de un aviso", () => {
  assert.equal(textoPlano("<b>a</b>  &lt;b&gt;"), "a <b>");
});
