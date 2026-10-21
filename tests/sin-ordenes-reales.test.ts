// La terminal no envía órdenes reales: ningún archivo de la app, del Worker ni de lib/ llama a un endpoint o método que
// cree, cambie o cancele una orden en un exchange o broker. La única llamada de órdenes permitida es order.test, que
// Binance valida sin enviar nada (lib/binance-client-signed.ts). Si esta prueba falla, alguien agregó un camino de
// ejecución real: eso se revisa aparte y con pedido explícito de la persona; no se arregla cambiando la lista.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const CARPETAS = ["lib", "app", "worker"];
const EXTENSIONES = /\.(ts|tsx|js|mjs)$/;

/** Métodos y rutas que crean, cambian o cancelan órdenes (Binance REST y WebSocket API, MetaTrader 5, ccxt). */
const PROHIBIDO: RegExp[] = [
  /["'`]order\.(place|cancel|modify|cancelReplace|amend)["'`]/,
  /["'`]orderList\.place/,
  /["'`]sor\.order\.place["'`]/,
  /\/fapi\/v1\/(order|batchOrders)\b/,
  /\/dapi\/v1\/(order|batchOrders)\b/,
  /\/api\/v3\/(order|orderList|sor\/order)\b/,
  /\/sapi\/v1\/margin\/order\b/,
  /\b(open|place|modify|close|cancel)_mt5_(position|order)\b/,
  /\bcreateOrder\(/,
];

function archivos(): string[] {
  return CARPETAS.flatMap((carpeta) =>
    (readdirSync(carpeta, { recursive: true }) as string[]).filter((f) => EXTENSIONES.test(f)).map((f) => join(carpeta, f)),
  );
}

test("ningún archivo tiene un camino para enviar, cambiar o cancelar órdenes reales", () => {
  const lista = archivos();
  assert.ok(lista.length > 100, `se revisaron ${lista.length} archivos: la búsqueda tiene que estar leyendo el código`);
  const hallazgos: string[] = [];
  for (const archivo of lista) {
    const texto = readFileSync(archivo, "utf8");
    for (const patron of PROHIBIDO) {
      const m = texto.match(patron);
      if (m) hallazgos.push(`${archivo}: ${m[0]}`);
    }
  }
  assert.deepEqual(hallazgos, []);
});

test("la única llamada de órdenes es order.test, que valida sin enviar", () => {
  const firmado = readFileSync("lib/binance-client-signed.ts", "utf8");
  assert.match(firmado, /"order\.test"/);
  for (const patron of PROHIBIDO) assert.doesNotMatch(firmado, patron);
});
