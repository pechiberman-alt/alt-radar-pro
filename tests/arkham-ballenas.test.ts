// Pruebas de las alertas de big trades de Arkham (lib/arkham-ballenas.ts).
// Cubre el parseo de la respuesta, el texto del aviso, la categoría de Telegram
// y que una clave rechazada se distinga de "no pasó nada". Sin red.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ballenaEvent, BALLENAS_MIN_USD, collectBallenaEvents, parseTransfers } from "../lib/arkham-ballenas.ts";
import { DEFAULT_TELEGRAM_PREFS, parsePrefs, selectForUser } from "../lib/telegram.ts";

const row = (o: Record<string, unknown> = {}) => ({
  transactionHash: "0xabc", chain: "ethereum", tokenSymbol: "USDC", unitValue: 12_000_000, historicalUSD: 12_000_000, blockTimestamp: 1_760_000_000_000,
  fromAddress: { address: "0x1111111111111111111111111111111111111111", arkhamEntity: { name: "Binance" } },
  toAddress: { address: "0x2222222222222222222222222222222222222222" },
  ...o,
});

test("parseTransfers: entidad si Arkham la conoce, dirección corta si no, y orden de mayor a menor", () => {
  const t = parseTransfers({ transfers: [row({ transactionHash: "0xb", historicalUSD: 6e6 }), row()] });
  assert.equal(t.length, 2);
  assert.equal(t[0].usd, 12e6);
  assert.equal(t[0].from, "Binance");
  assert.equal(t[0].to, "0x2222…2222");
  assert.equal(t[0].time, 1_760_000_000_000);
});

test("parseTransfers: descarta lo que no se puede leer en vez de inventarlo", () => {
  assert.deepEqual(parseTransfers(null), []);
  assert.deepEqual(parseTransfers({ transfers: "x" }), []);
  const t = parseTransfers({ transfers: [row({ transactionHash: "" }), row({ historicalUSD: null }), row({ historicalUSD: "abc" }), row({ historicalUSD: BALLENAS_MIN_USD - 1 })] });
  assert.equal(t.length, 0);
});

test("parseTransfers: marca de tiempo en segundos pasa a milisegundos; ausente queda en null", () => {
  assert.equal(parseTransfers({ transfers: [row({ blockTimestamp: 1_760_000_000 })] })[0].time, 1_760_000_000_000);
  assert.equal(parseTransfers({ transfers: [row({ blockTimestamp: undefined })] })[0].time, null);
});

test("ballenaEvent: texto en español con coma decimal, aviso de no asesoramiento y escapado de HTML", () => {
  const [t] = parseTransfers({ transfers: [row({ historicalUSD: 12_500_000, fromAddress: { arkhamEntity: { name: "<b>X&Y</b>" } } })] });
  const e = ballenaEvent(t);
  assert.equal(e.category, "BALLENAS");
  assert.match(e.text, /\$12,5 M/);
  assert.match(e.text, /No es asesoramiento financiero/);
  assert.ok(!e.text.includes("<b>X&Y</b>"));
  assert.match(e.text, /&lt;b&gt;X&amp;Y&lt;\/b&gt;/);
});

test("ballenaEvent: la misma transferencia da la misma clave; otra distinta, otra clave", () => {
  const [a] = parseTransfers({ transfers: [row()] });
  const [b] = parseTransfers({ transfers: [row({ transactionHash: "0xdef" })] });
  assert.equal(ballenaEvent(a).key, ballenaEvent(a).key);
  assert.notEqual(ballenaEvent(a).key, ballenaEvent(b).key);
});

test("BALLENAS: encendida por defecto, se apaga y no llega si el usuario la apagó", () => {
  assert.equal(parsePrefs({}).categories.BALLENAS, true);
  assert.equal(parsePrefs({ categories: { SEÑAL: true } }).categories.BALLENAS, true);
  const [t] = parseTransfers({ transfers: [row()] });
  const off = { ...DEFAULT_TELEGRAM_PREFS, categories: { ...DEFAULT_TELEGRAM_PREFS.categories, BALLENAS: false } };
  assert.equal(selectForUser([ballenaEvent(t)], off, new Set()).send.length, 0);
  assert.equal(selectForUser([ballenaEvent(t)], DEFAULT_TELEGRAM_PREFS, new Set()).send.length, 1);
});

test("collectBallenaEvents: manda la clave en API-Key, pide el mínimo y corta en 6", async () => {
  let seen: { url: string; key: string } | null = null;
  const many = Array.from({ length: 10 }, (_, i) => row({ transactionHash: `0x${i}`, historicalUSD: 6e6 + i }));
  const fake = (async (url: string, init: RequestInit) => {
    seen = { url, key: (init.headers as Record<string, string>)["API-Key"] };
    return new Response(JSON.stringify({ transfers: many }), { status: 200 });
  }) as unknown as typeof fetch;
  const events = await collectBallenaEvents("clave-de-prueba", fake);
  assert.equal(events.length, 6);
  assert.equal(seen!.key, "clave-de-prueba");
  assert.match(seen!.url, /^https:\/\/api\.arkm\.com\/transfers\?/);
  assert.match(seen!.url, /usdGte=5000000/);
});

test("collectBallenaEvents: una clave rechazada o un error del servicio es error, no 'sin novedades'", async () => {
  const status = (s: number) => (async () => new Response("{}", { status: s })) as unknown as typeof fetch;
  await assert.rejects(collectBallenaEvents("x", status(401)), /rechaz/);
  await assert.rejects(collectBallenaEvents("x", status(403)), /rechaz/);
  await assert.rejects(collectBallenaEvents("x", status(500)), /HTTP 500/);
  assert.deepEqual(await collectBallenaEvents("x", (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch), []);
});
