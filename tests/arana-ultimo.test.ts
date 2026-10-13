import assert from "node:assert/strict";
import test from "node:test";
import { aceptarUltimo, inicioDeUltimo, serializarUltimo, ULTIMO_MAX_BYTES } from "../lib/arana-ultimo.ts";
import { decidirAuto } from "../lib/arana-vivo-auto.ts";
import type { ScanResult } from "../lib/jarvis-scan.ts";

const MIN = 60_000;

/** Un escaneo con la forma mínima que pide lib/arana-ultimo.ts (los campos de contenido no se miran acá). */
function escaneo(over: Partial<Record<string, unknown>> = {}): ScanResult {
  return {
    at: 1_700_000_000_000,
    duracionMs: 2 * MIN,
    minVolumen: 5_000_000,
    universo: { contratos: 300, noMonedas: 40, sinVolumen: 10, recortadas: 0, elegibles: 30 },
    filas: [],
    resumen: { leidas: 0, aprobadas: 0, largos: 0, cortos: 0 },
    parcial: false,
    motivoParcial: null,
    ...over,
  } as unknown as ScanResult;
}

test("acepta un escaneo con la forma correcta y lo devuelve tal cual", () => {
  const e = escaneo();
  assert.equal(aceptarUltimo(e), e);
});

test("rechaza lo que no tiene forma de escaneo", () => {
  assert.equal(aceptarUltimo(null), null);
  assert.equal(aceptarUltimo("escaneo"), null);
  assert.equal(aceptarUltimo(escaneo({ at: "ayer" })), null);
  assert.equal(aceptarUltimo(escaneo({ at: Number.NaN })), null);
  assert.equal(aceptarUltimo(escaneo({ duracionMs: -1 })), null);
  assert.equal(aceptarUltimo(escaneo({ minVolumen: undefined })), null);
  assert.equal(aceptarUltimo(escaneo({ parcial: "no" })), null);
  assert.equal(aceptarUltimo(escaneo({ filas: "muchas" })), null);
  assert.equal(aceptarUltimo(escaneo({ resumen: null })), null);
  assert.equal(aceptarUltimo(escaneo({ universo: "x" })), null);
});

test("no acepta más filas que el tope del escáner", () => {
  const filas = Array.from({ length: 1001 }, () => ({}));
  assert.equal(aceptarUltimo(escaneo({ filas })), null);
  assert.ok(aceptarUltimo(escaneo({ filas: filas.slice(0, 1000) })));
});

test("guarda solo lo que entra en el tope y vuelve igual al leerlo", () => {
  const chico = escaneo();
  const json = serializarUltimo(chico);
  assert.ok(json !== null && json.length <= ULTIMO_MAX_BYTES);
  assert.deepEqual(aceptarUltimo(JSON.parse(json as string)), chico);

  const grande = escaneo({ motivoParcial: "x".repeat(ULTIMO_MAX_BYTES) });
  assert.equal(serializarUltimo(grande), null, "pasa el tope: no se guarda");
});

test("el inicio del escaneo guardado es su fin menos su duración", () => {
  const e = escaneo({ at: 10 * MIN, duracionMs: 4 * MIN });
  assert.equal(inicioDeUltimo(e), 6 * MIN);
});

test("al entrar, un escaneo guardado de hace menos de 15 minutos no dispara uno nuevo", () => {
  // Terminó hace 5 minutos y duró 2: empezó hace 7. El automático espera 8 minutos más.
  const ahora = 1_700_000_000_000 + 5 * MIN;
  const guardado = escaneo();
  const d = decidirAuto({
    visible: true,
    pausado: false,
    enCurso: false,
    ultimoIntento: inicioDeUltimo(guardado),
    ahora,
  });
  assert.equal(d.escanear, false);
  assert.equal(d.proximoEnMin, 8);
});

test("al entrar, un escaneo guardado de hace más de 15 minutos sí dispara uno nuevo", () => {
  const ahora = 1_700_000_000_000 + 20 * MIN;
  const d = decidirAuto({
    visible: true,
    pausado: false,
    enCurso: false,
    ultimoIntento: inicioDeUltimo(escaneo()),
    ahora,
  });
  assert.equal(d.escanear, true);
});
