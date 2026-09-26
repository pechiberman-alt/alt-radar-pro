import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Route contracts.
 *
 * The last two production faults both lived in route handlers rather than in
 * lib: CoinGecko silently falling through to a source that has no stablecoin
 * split, and the klines proxy returning 503 because Binance blocks datacenter
 * addresses. Neither was covered. These assert the properties that matter —
 * input validation, a fallback chain, and never inventing a value when the
 * upstream fails — by reading the handlers, since running them needs a Worker
 * runtime with live bindings.
 */

const read = (path: string) =>
  readFile(new URL(`../app/api/${path}`, import.meta.url), "utf8");

const ROUTES = [
  "klines/route.ts",
  "rolling/route.ts",
  "tickers/route.ts",
  "market-structure/route.ts",
  "structure-trend/route.ts",
] as const;

test("every proxy route refuses to cache upstream failures as success", async () => {
  for (const route of ROUTES) {
    const source = await read(route);
    assert.match(
      source,
      /status:\s*503/,
      `${route}: debe responder 503 cuando el origen no entrega datos`,
    );
    assert.match(
      source,
      /SIN DATOS/,
      `${route}: debe declarar el dato faltante en lugar de completarlo`,
    );
  }
});

test("no route sends a no-store response as cacheable", async () => {
  for (const route of ROUTES) {
    const source = await read(route);
    assert.match(
      source,
      /"Cache-Control":\s*"no-store"/,
      `${route}: los datos de mercado no deben quedar cacheados por el navegador`,
    );
  }
});

test("klines validates symbol and interval before reaching upstream", async () => {
  const source = await read("klines/route.ts");
  assert.match(source, /\[A-Z0-9\]\{2,24\}USDT/, "debe validar el símbolo");
  assert.match(source, /ALLOWED_INTERVALS/, "debe restringir el intervalo");
  assert.match(source, /SÍMBOLO NO VÁLIDO/);
  assert.match(source, /INTERVALO NO VÁLIDO/);
  // A caller-supplied limit must be bounded, or one request can pull an
  // arbitrarily large payload through the Worker.
  assert.match(source, /Math\.max\(10,\s*Math\.min\(500/);
});

test("rolling validates the window and caps how many symbols one call can ask for", async () => {
  const source = await read("rolling/route.ts");
  assert.match(source, /ALLOWED_WINDOWS/);
  assert.match(source, /MAX_SYMBOLS/);
  assert.match(source, /VENTANA NO VÁLIDA/);
  assert.match(source, /SIN SÍMBOLOS VÁLIDOS/);
});

test("structure-trend bounds the requested window", async () => {
  const source = await read("structure-trend/route.ts");
  assert.match(source, /Math\.min\(720/, "no debe permitir pedir un histórico sin límite");
  assert.match(source, /Math\.max\(\s*1/);
});

test("proxies try more than one upstream before giving up", async () => {
  for (const route of ["klines/route.ts", "rolling/route.ts", "tickers/route.ts"] as const) {
    const source = await read(route);
    assert.match(source, /BASES/, `${route}: debe tener lista de espejos`);
    assert.match(
      source,
      /for \(const base of BASES\)/,
      `${route}: debe recorrer los espejos, no depender de uno`,
    );
  }
});

test("cached proxies share one upstream call and can serve a stale reading", async () => {
  for (const route of ["klines/route.ts", "rolling/route.ts", "tickers/route.ts", "market-structure/route.ts"] as const) {
    const source = await read(route);
    assert.match(source, /cached</, `${route}: debe pasar por la caché compartida`);
    assert.match(source, /"X-Cache"/, `${route}: debe declarar el estado de caché`);
  }
});

/**
 * CoinGecko is the only free source that breaks out stablecoin dominance, and
 * it blocks Cloudflare's egress addresses. Falling through to CoinLore is
 * correct, but CoinLore must not pretend to know USDT.D.
 */
test("the structure fallback never invents stablecoin dominance", async () => {
  const source = await readFile(
    new URL("../lib/market-structure.ts", import.meta.url),
    "utf8",
  );
  const coinLore = source.slice(source.indexOf("parseCoinLoreGlobal"));
  assert.match(
    coinLore,
    /usdt:\s*null/,
    "el respaldo no publica USDT.D y no debe rellenarlo",
  );
  assert.match(coinLore, /stablecoins:\s*null/);
});

test("market-structure prefers the source that has the stablecoin split", async () => {
  const source = await read("market-structure/route.ts");
  const geckoAt = source.indexOf("loadCoinGecko()");
  const loreAt = source.indexOf("loadCoinLore()");
  assert.ok(geckoAt > -1 && loreAt > -1);
  assert.ok(
    geckoAt < loreAt,
    "CoinGecko debe intentarse primero: es la única fuente con desglose de stablecoins",
  );
});

test("routes that touch D1 handle its absence instead of throwing", async () => {
  const source = await read("structure-trend/route.ts");
  assert.match(source, /if \(!env\.DB\)/, "debe contemplar que no haya base de datos");
});

test("every route is explicitly dynamic", async () => {
  for (const route of ROUTES) {
    const source = await read(route);
    assert.match(
      source,
      /export const dynamic = "force-dynamic"/,
      `${route}: datos de mercado no pueden servirse pre-renderizados`,
    );
  }
});

/**
 * Track-record integrity.
 *
 * The signals route used to accept a snapshot of candidates AND the prices they
 * were graded against, checking only that the two agreed with each other. Any
 * caller could POST a hand-made payload — no account, no session — and write
 * winning signals into the public Win Rate and Profit Factor. These pin the
 * property that closed it: nothing a caller sends can enter the record.
 */

test("the signals route never inserts from a caller-supplied payload", async () => {
  const source = await read("signals/route.ts");
  assert.doesNotMatch(
    source,
    /captureBrowserSignals/,
    "la inserción desde el navegador quedó eliminada: no debe volver",
  );
  assert.doesNotMatch(
    source,
    /payload\.snapshot|snapshot\?:/,
    "la ruta no debe volver a leer un snapshot de mercado del cuerpo",
  );
  assert.match(
    source,
    /syncOpenSignals/,
    "un POST del navegador sólo puede re-evaluar señales abiertas",
  );
});

test("open signals are graded against prices the server fetches itself", async () => {
  const source = await readFile(
    new URL("../lib/automation.ts", import.meta.url),
    "utf8",
  );
  const syncAt = source.indexOf("export async function syncOpenSignals");
  assert.ok(syncAt > -1, "syncOpenSignals debe existir");
  const body = source.slice(syncAt, source.indexOf("\n}\n", syncAt));
  assert.match(
    body,
    /loadMarket\(\)/,
    "los precios deben venir del servidor, nunca del cuerpo del request",
  );
});

test("the dominance archive corroborates a caller's reading before storing it", async () => {
  const source = await read("market-structure/route.ts");
  const corroborateAt = source.indexOf("corroborated(structure)");
  // The call site, not the import at the top of the file.
  const archiveAt = source.indexOf("await recordStructureSnapshot(");
  assert.ok(corroborateAt > -1, "debe corroborarse la lectura del navegador");
  assert.ok(
    corroborateAt < archiveAt,
    "la corroboración debe ocurrir antes de escribir en el archivo histórico",
  );
  assert.match(
    source,
    /if \(!reference\?\.totalMarketCap[\s\S]*?return false/,
    "sin fuente de contraste la lectura se rechaza, no se confía",
  );
});
