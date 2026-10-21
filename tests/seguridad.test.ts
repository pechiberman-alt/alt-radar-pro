// Pruebas de la revisión de seguridad: series de velas que manda un navegador (forma, coherencia, horario), corroboración
// de precios, límites de intentos de login, tokens de sesión guardados como hash, cabeceras de seguridad, direcciones de
// notificaciones permitidas y el tope de la caché del Worker.
import assert from "node:assert/strict";
import test from "node:test";
import { MS_INTERVALO, revisarSerie } from "../lib/aporte-velas.ts";
import { claveIntento, esperaSeg, superado, vigente } from "../lib/auth-limites.ts";
import { hashToken, tokenValido } from "../lib/auth.ts";
import { coincide, TOLERANCIA_CIERRE } from "../lib/corroborar.ts";
import { conSeguridad, SEGURIDAD } from "../lib/seguridad-cabeceras.ts";
import { clearUpstreamCache, MAX_ENTRADAS, offerCached } from "../lib/upstream-cache.ts";
import { endpointPushValido } from "../lib/web-push.ts";

const H = MS_INTERVALO["1h"];
const AHORA = 1_760_000_000_000 - (1_760_000_000_000 % H) + 10 * 60_000;
const serie = (n = 20, precio = 100) =>
  Array.from({ length: n }, (_, k) => {
    const t = AHORA - (AHORA % H) - (n - 1 - k) * H;
    return [t, String(precio), String(precio + 1), String(precio - 1), String(precio + 0.5), "10", t + H - 1];
  });

test("una serie de velas coherente pasa; una inventada a mano no", () => {
  const ok = revisarSerie(serie(), "1h", AHORA);
  assert.deepEqual(ok, { ok: true, ultimoCierre: 100.5 });
  const mala = serie();
  mala[5] = [mala[5][0], "100", "99", "98", "100.5", "10", 0]; // el máximo por debajo del cierre
  assert.equal(revisarSerie(mala, "1h", AHORA).ok, false);
  const hueco = serie();
  hueco.splice(7, 1);
  assert.deepEqual(revisarSerie(hueco, "1h", AHORA), { ok: false, motivo: "velas no seguidas" });
  const corrida = serie().map((r) => [Number(r[0]) + 60_000, ...r.slice(1)]);
  assert.deepEqual(revisarSerie(corrida, "1h", AHORA), { ok: false, motivo: "horario" });
  assert.deepEqual(revisarSerie(serie(), "1h", AHORA + 5 * H), { ok: false, motivo: "vieja o futura" });
  assert.deepEqual(revisarSerie(serie(), "30m", AHORA), { ok: false, motivo: "intervalo" });
  assert.equal(revisarSerie(serie(3), "1h", AHORA).ok, false);
});

test("corroborar: el precio tiene que estar cerca de la referencia", () => {
  assert.equal(coincide(100, 101), true);
  assert.equal(coincide(100, 110), false);
  assert.equal(coincide(100.4, 100, TOLERANCIA_CIERRE), true);
  assert.equal(coincide(101, 100, TOLERANCIA_CIERRE), false);
  assert.equal(coincide(Number.NaN, 100), false);
  assert.equal(coincide(100, 0), false);
});

test("límites de intentos: cuentan dentro de la ventana y se liberan cuando pasa", () => {
  const V = 15 * 60_000;
  const t = 1_000_000;
  assert.deepEqual(vigente(null, V, t), { cuenta: 0, desde: t });
  assert.equal(superado({ cuenta: 8, desde: t - 60_000 }, 8, V, t), true);
  assert.equal(superado({ cuenta: 8, desde: t - V - 1 }, 8, V, t), false, "pasada la ventana, vuelve a cero");
  assert.equal(superado({ cuenta: 7, desde: t }, 8, V, t), false);
  assert.equal(esperaSeg({ cuenta: 9, desde: t - 60_000 }, V, t), 14 * 60);
});

test("las claves de los contadores no guardan el email ni la IP", async () => {
  const a = await claveIntento("email", "uri@ejemplo.com");
  assert.match(a, /^email:[0-9a-f]{40}$/);
  assert.ok(!a.includes("uri"));
  assert.equal(a, await claveIntento("email", "uri@ejemplo.com"));
  assert.notEqual(a, await claveIntento("ip", "uri@ejemplo.com"));
});

test("la sesión se guarda como hash del token, y un token con otra forma ni se busca", async () => {
  const token = "a".repeat(64);
  const h = await hashToken(token);
  assert.match(h, /^h:[0-9a-f]{64}$/);
  assert.notEqual(h.slice(2), token);
  assert.equal(tokenValido(token), true);
  assert.equal(tokenValido("x' OR 1=1 --"), false);
  assert.equal(tokenValido(h), false, "el hash guardado no sirve como cookie");
});

test("cabeceras de seguridad en cada respuesta, sin pisar las que ya trae", () => {
  const r = conSeguridad(new Response("ok", { headers: { "Referrer-Policy": "no-referrer" } }));
  for (const k of Object.keys(SEGURIDAD)) assert.ok(r.headers.get(k), k);
  assert.equal(r.headers.get("Referrer-Policy"), "no-referrer");
  assert.match(r.headers.get("Content-Security-Policy") ?? "", /frame-ancestors 'self'/);
  assert.equal(r.headers.get("X-Content-Type-Options"), "nosniff");
});

test("notificaciones: solo los servicios de los navegadores, por HTTPS", () => {
  assert.equal(endpointPushValido("https://fcm.googleapis.com/fcm/send/abc"), true);
  assert.equal(endpointPushValido("https://updates.push.services.mozilla.com/wpush/v2/abc"), true);
  assert.equal(endpointPushValido("https://web.push.apple.com/abc"), true);
  assert.equal(endpointPushValido("https://evil.example.com/fcm.googleapis.com"), false);
  assert.equal(endpointPushValido("http://fcm.googleapis.com/x"), false);
  assert.equal(endpointPushValido("https://fcm.googleapis.com:8443/x"), false);
  assert.equal(endpointPushValido(`https://fcm.googleapis.com/${"a".repeat(1200)}`), false);
});

test("la caché del Worker tiene tope: pasado el tope se van las claves más viejas", () => {
  clearUpstreamCache();
  assert.equal(offerCached("primera", 1, 60_000), true);
  assert.equal(offerCached("primera", 2, 60_000), false, "fresca: no se pisa");
  for (let k = 0; k < MAX_ENTRADAS + 10; k += 1) offerCached(`k${k}`, k, 60_000);
  assert.equal(offerCached("primera", 3, 60_000), true, "la más vieja ya no está");
  clearUpstreamCache();
});
