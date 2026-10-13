import assert from "node:assert/strict";
import test from "node:test";
import { AUTO_CADA_MIN, decidirAuto } from "../lib/arana-vivo-auto.ts";

// El escaneo automático de la araña: decisión pura, sin reloj ni pantalla.
const MIN = 60_000;
const AHORA = Date.parse("2026-10-13T08:00:00Z");
const base = { visible: true, pausado: false, enCurso: false, ultimoIntento: null, ahora: AHORA };

test("la primera vez, con la araña a la vista, escanea enseguida", () => {
  const d = decidirAuto(base);
  assert.equal(d.escanear, true);
  assert.equal(d.estado, "activo");
});

test("fuera de vista nunca escanea en segundo plano, aunque ya toque", () => {
  const d = decidirAuto({ ...base, visible: false, ultimoIntento: AHORA - 60 * MIN });
  assert.equal(d.escanear, false);
  assert.equal(d.estado, "fuera de vista");
  assert.equal(d.proximoEnMin, null);
});

test("pausado no escanea solo, y con un escaneo en curso no se empieza otro", () => {
  const pausa = decidirAuto({ ...base, pausado: true });
  assert.equal(pausa.escanear, false);
  assert.equal(pausa.estado, "pausado");
  const enCurso = decidirAuto({ ...base, enCurso: true, ultimoIntento: AHORA - 60 * MIN });
  assert.equal(enCurso.escanear, false);
  assert.equal(enCurso.estado, "en curso");
});

test("entre dos escaneos espera el intervalo entero y dice cuánto falta", () => {
  const d = decidirAuto({ ...base, ultimoIntento: AHORA - 4 * MIN });
  assert.equal(d.escanear, false);
  assert.equal(d.proximoEnMin, AUTO_CADA_MIN - 4);
  assert.match(d.motivo, /11 minutos/);
  assert.match(decidirAuto({ ...base, ultimoIntento: AHORA - 14 * MIN - 30_000 }).motivo, /1 minuto\./, "en singular cuando falta uno");
});

test("cumplido el intervalo vuelve a escanear, y un intento recién fallido también espera (no reintenta en bucle)", () => {
  assert.equal(decidirAuto({ ...base, ultimoIntento: AHORA - AUTO_CADA_MIN * MIN }).escanear, true, "justo al cumplirse");
  assert.equal(decidirAuto({ ...base, ultimoIntento: AHORA - 30_000 }).escanear, false, "un intento recién fallido no se repite al rato");
});
