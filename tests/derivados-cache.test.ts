import assert from "node:assert/strict";
import test from "node:test";
import { parteDerivados } from "../lib/market-providers.ts";
import { cached, clearUpstreamCache } from "../lib/upstream-cache.ts";

test("sin ningún proveedor que responda, la parte de derivados es null (no un objeto vacío)", () => {
  assert.equal(parteDerivados({ derivatives: null, provider: null, tried: [{ provider: "okx", ok: false, why: "sin respuesta" }] }), null);
});

test("con datos, la parte lleva la moneda, el proveedor y los intentos", () => {
  const tried = [{ provider: "okx" as const, ok: true as const }];
  assert.deepEqual(parteDerivados({ derivatives: { funding: 0.0001 }, provider: "okx", tried }), { data: { funding: 0.0001 }, provider: "okx", tried });
});

test("si los proveedores fallan, el caché sirve la última lectura buena y no la pisa con un vacío", async () => {
  clearUpstreamCache();
  let fallan = false;
  const cargar = async () => {
    const r = fallan
      ? { derivatives: null, provider: null, tried: [] }
      : { derivatives: { funding: 0.0001 }, provider: "okx" as const, tried: [] };
    return parteDerivados(r);
  };
  // TTL 0: cada lectura vuelve al cargador; el fallo cae en la ventana de «última lectura buena».
  const primera = await cached("deriv:TEST", 0, cargar, 60_000);
  assert.equal(primera.value?.data.funding, 0.0001);

  fallan = true;
  const segunda = await cached("deriv:TEST", 0, cargar, 60_000);
  assert.equal(segunda.state, "STALE");
  assert.equal(segunda.value?.data.funding, 0.0001, "el fallo no debe borrar el dato bueno");
});
