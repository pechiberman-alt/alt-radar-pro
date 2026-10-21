// Pruebas del acceso PRO (lib/suscripcion.ts): el estado de cada persona (prueba, pago, vencido, administrador), cuánto suma
// un pago aprobado, qué rutas de la API pasan por la puerta, cómo se lee un monto argentino y qué se acepta al avisar un pago
// o al cambiar la configuración de cobro. Nada de esto activa PRO solo: lo aprueba el administrador a mano.
import assert from "node:assert/strict";
import test from "node:test";
import {
  accesoPro,
  CONFIG_COBRO_INICIAL,
  DIA_MS,
  extenderPago,
  leerMonto,
  rutaPro,
  textoAcceso,
  textoAprobado,
  textoAvisoAdmin,
  textoPrecio,
  validarConfigCobro,
  validarReporte,
} from "../lib/suscripcion.ts";

const T = 1_800_000_000_000;

test("estado: el administrador siempre entra; el pago vigente gana sobre la prueba; después, vencida", () => {
  assert.deepEqual(accesoPro({ esAdmin: true, pruebaDesde: null, pagoHasta: null, ahora: T }), { estado: "ADMIN", acceso: true, hasta: null, diasRestantes: null });
  const prueba = accesoPro({ esAdmin: false, pruebaDesde: T - 2 * DIA_MS, pagoHasta: null, ahora: T });
  assert.equal(prueba.estado, "PRUEBA");
  assert.equal(prueba.diasRestantes, 5);
  assert.equal(prueba.hasta, T + 5 * DIA_MS);
  const vencida = accesoPro({ esAdmin: false, pruebaDesde: T - 8 * DIA_MS, pagoHasta: null, ahora: T });
  assert.equal(vencida.estado, "VENCIDA");
  assert.equal(vencida.acceso, false);
  const paga = accesoPro({ esAdmin: false, pruebaDesde: T - 40 * DIA_MS, pagoHasta: T + 10 * DIA_MS + 1, ahora: T });
  assert.deepEqual([paga.estado, paga.acceso, paga.diasRestantes], ["ACTIVA", true, 11]);
  const pagoViejo = accesoPro({ esAdmin: false, pruebaDesde: T - 40 * DIA_MS, pagoHasta: T - DIA_MS, ahora: T });
  assert.deepEqual([pagoViejo.estado, pagoViejo.acceso, pagoViejo.hasta], ["VENCIDA", false, T - DIA_MS]);
  assert.equal(accesoPro({ esAdmin: false, pruebaDesde: T, pagoHasta: null, ahora: T, diasPrueba: 0 }).estado, "VENCIDA", "sin días de prueba, vence al empezar");
  assert.equal(accesoPro({ esAdmin: false, pruebaDesde: null, pagoHasta: null, ahora: T }).acceso, false);
});

test("un pago aprobado suma días a lo que quedaba, nunca los pisa", () => {
  assert.equal(extenderPago(null, T, 30), T + 30 * DIA_MS);
  assert.equal(extenderPago(T + 5 * DIA_MS, T, 30), T + 35 * DIA_MS, "le quedaban 5: quedan 35");
  assert.equal(extenderPago(T - 9 * DIA_MS, T, 30), T + 30 * DIA_MS, "vencido: arranca hoy");
});

test("la puerta: la inteligencia de la terminal es PRO; entrar, pagar y los datos públicos de mercado no", () => {
  for (const r of ["/api/analyst/ai", "/api/jarvis/chat", "/api/oficina", "/api/mapa/agentes", "/api/registro", "/api/registro/flujo", "/api/telegram/link", "/api/alerts/latest", "/api/signals", "/api/radar", "/api/journal", "/api/diario/notes", "/api/dca/schedule", "/api/brain", "/api/push/subscribe"]) assert.equal(rutaPro(r), true, r);
  for (const r of ["/api/auth/login", "/api/auth/register", "/api/auth/me", "/api/auth/logout", "/api/suscripcion", "/api/admin/cobros", "/api/admin/settings", "/api/version", "/api/tickers", "/api/klines", "/api/telegram/webhook", "/api/orderbook", "/api/binance/credentials", "/", "/api/oficinas-falsas", "/api/registros"]) assert.equal(rutaPro(r), false, r);
});

test("montos: a la argentina, con punto decimal o sin separadores; lo demás no es un monto", () => {
  assert.equal(leerMonto("10.000"), 10000);
  assert.equal(leerMonto("$ 10.000,50"), 10000.5);
  assert.equal(leerMonto("10000"), 10000);
  assert.equal(leerMonto("10000,5"), 10000.5);
  assert.equal(leerMonto("15.5"), 15.5);
  assert.equal(leerMonto("1.234.567"), 1234567);
  for (const malo of ["", "abc", "-5", "0", "1,2,3", "10.00.0", "1e9"]) assert.equal(leerMonto(malo), null, malo);
});

test("aviso de pago: monto, número de operación y una nota limpia; lo demás se rechaza con un motivo", () => {
  assert.deepEqual(validarReporte({ monto: "10.000", referencia: " 1234 5678 ", nota: "pagué <b>hoy</b>" }), { monto: 10000, referencia: "1234 5678", nota: "pagué b hoy /b" });
  assert.match(String(validarReporte({ monto: "x", referencia: "12345" })), /MONTO/);
  assert.match(String(validarReporte({ monto: "100", referencia: "12" })), /OPERACIÓN/);
  assert.match(String(validarReporte({ monto: "100", referencia: "<script>" })), /OPERACIÓN/);
  const largo = validarReporte({ monto: "100", referencia: "ABC-123", nota: "a".repeat(500) });
  assert.ok(typeof largo !== "string" && largo.nota.length === 200);
  assert.match(String(validarReporte(null)), /MONTO/);
});

test("configuración de cobro: alias de 6 a 20, precio opcional, días con límites", () => {
  assert.deepEqual(validarConfigCobro({ alias: "URL.MP", precio: "15.000", moneda: "ars", dias: 30, diasPrueba: 7 }), { alias: "url.mp", precio: 15000, moneda: "ARS", dias: 30, diasPrueba: 7 });
  assert.deepEqual(validarConfigCobro({ ...CONFIG_COBRO_INICIAL }), CONFIG_COBRO_INICIAL);
  assert.equal(CONFIG_COBRO_INICIAL.alias, "url.mp");
  assert.equal(CONFIG_COBRO_INICIAL.precio, null, "sin precio cargado no se inventa uno");
  assert.match(String(validarConfigCobro({ ...CONFIG_COBRO_INICIAL, alias: "a b" })), /ALIAS/);
  assert.match(String(validarConfigCobro({ ...CONFIG_COBRO_INICIAL, precio: "gratis" })), /PRECIO/);
  assert.match(String(validarConfigCobro({ ...CONFIG_COBRO_INICIAL, dias: 0 })), /DÍAS/);
  assert.match(String(validarConfigCobro({ ...CONFIG_COBRO_INICIAL, diasPrueba: 99 })), /PRUEBA/);
  assert.match(String(validarConfigCobro({ ...CONFIG_COBRO_INICIAL, moneda: "EUR" })), /MONEDA/);
});

test("textos: el precio sin cargar se dice; los avisos de Telegram escapan lo que escribió la persona", () => {
  assert.equal(textoPrecio(CONFIG_COBRO_INICIAL), "precio a confirmar por el administrador");
  assert.equal(textoPrecio({ ...CONFIG_COBRO_INICIAL, precio: 15000 }), "$15.000 por 30 días");
  assert.equal(textoPrecio({ ...CONFIG_COBRO_INICIAL, precio: 9.5, moneda: "USDT" }), "USDT 9,50 por 30 días");
  const aviso = textoAvisoAdmin({ email: "a@b.com", monto: 15000, referencia: "123<x>", nota: "<i>hola</i>", moneda: "ARS" });
  assert.ok(!aviso.includes("<x>") && !aviso.includes("<i>"), "nada de lo que escribe la persona entra como HTML");
  assert.match(aviso, /15\.000/);
  assert.match(textoAprobado(T + 30 * DIA_MS), /PRO activado<\/b> hasta el \d\d\/\d\d\/\d{4}/);
  assert.match(textoAcceso({ estado: "PRUEBA", acceso: true, hasta: T + DIA_MS, diasRestantes: 1 }), /te queda 1 día/);
  assert.match(textoAcceso({ estado: "VENCIDA", acceso: false, hasta: T, diasRestantes: 0 }), /terminó/);
});
