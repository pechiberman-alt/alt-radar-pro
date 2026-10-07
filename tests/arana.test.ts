import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  buscar,
  chequear,
  cargarIndice,
  construirIndice,
  ejecutar,
  globToRegExp,
  MAPA,
  objetivoDe,
  parseObjetivos,
  renderHuellas,
  renderMapa,
  ROOT,
  textoCambios,
} from "../scripts/arana.mjs";

/** A file as the araña reads it: its text and a fingerprint of that text. */
function archivo(path: string, texto: string) {
  return { path, bytes: texto.length, hash: createHash("sha1").update(texto).digest("hex").slice(0, 12), texto };
}

// A small objectives file: synonyms, one transversal objective, and the objectives the fixtures live in.
const FIXTURE_MD = `# Objetivos de prueba

## Sinónimos
voz: voice, speech, dictado

## cuentas — Lógica de cálculo
Texto: cálculos que la app muestra.
Archivos: lib/a.ts, lib/b.ts, lib/tipos.ts
Reglas:
- Nunca se redondea hacia arriba.
Pendiente:
- Revisar el redondeo de LIMITE.

## honestidad — Nunca inventar
Texto: transversal a todo.
Archivos: —

## datos — Datos de mercado
Texto: velas y noticias, con su fuente.
Archivos: lib/c.ts, lib/d.ts, lib/voice*.ts

## interfaz — La app
Texto: pantallas.
Archivos: app/*.tsx, app/api/**

## calidad — Pruebas
Texto: node:test.
Archivos: tests/**
`;

const FILES = [
  archivo("lib/a.ts", `/**\n * Calcula el riesgo de una operación.\n */\nimport type { Tipo } from "./tipos.ts";\nimport { sumar } from "./b.ts";\nexport function riesgo(x: number) { return sumar(x, 1); }\nexport const LIMITE = 3;\nexport type Tipo2 = string;\n`),
  archivo("lib/b.ts", "export function sumar(a: number, b: number) { return a + b; }\n"),
  archivo("lib/tipos.ts", "export type Tipo = string;\n"),
  archivo("lib/c.ts", `// Lee la clave del modelo.\nexport async function leer(db, env) {\n  return getSecret(db, env, "groq_api_key");\n}\nexport const url = "https://api.groq.com/openai/v1/audio";\n`),
  archivo("lib/d.ts", `export async function guardar(db) {\n  await db.prepare("CREATE TABLE IF NOT EXISTS notas (id TEXT PRIMARY KEY)").run();\n  await db.prepare("CREATE INDEX IF NOT EXISTS notas_id ON notas (id)").run();\n}\nexport async function leerNotas(db) {\n  return db.prepare("SELECT * FROM notas LIMIT 10").all();\n}\n`),
  archivo("app/page.tsx", `"use client";\nimport { riesgo } from "../lib/a.ts";\nexport default function Page() { return riesgo(1); }\n`),
  archivo("app/chico.tsx", `"use client";\nimport { leer } from "../lib/c.ts";\nexport function Chico() { leer(1, 2); return null; }\n`),
  archivo("app/cliente-api.tsx", `"use client";\nimport { GET } from "./api/hola/route.ts";\nexport const x = GET;\n`),
  archivo("app/api/hola/route.ts", `export async function GET() { return new Response("ok"); }\nexport async function POST() { return new Response("ok"); }\n`),
  archivo("tests/a.test.ts", `import test from "node:test";\nimport { riesgo } from "../lib/a.ts";\ntest("el riesgo suma", () => {});\n`),
  archivo("misc/zz.ts", "export const z = 1;\n"),
];

test("the objectives file gives its synonyms and its objectives, transversal ones included", () => {
  const { sinonimos, objetivos } = parseObjetivos(FIXTURE_MD);
  assert.deepEqual(objetivos.map((o: { slug: string }) => o.slug), ["cuentas", "honestidad", "datos", "interfaz", "calidad"]);
  assert.equal(objetivos[0].titulo, "Lógica de cálculo");
  assert.deepEqual(objetivos[0].globs, ["lib/a.ts", "lib/b.ts", "lib/tipos.ts"]);
  assert.deepEqual(objetivos[0].reglas, ["Nunca se redondea hacia arriba."]);
  assert.deepEqual(objetivos[0].pendiente, ["Revisar el redondeo de LIMITE."]);
  assert.equal(objetivos[1].transversal, true);
  assert.deepEqual([...sinonimos.get("voz")].sort(), ["dictado", "speech", "voice", "voz"]);
  assert.ok(sinonimos.get("speech").has("voz"), "the synonyms work both ways");
});

test("an objective without Texto or Archivos is a mistake, not a silent gap", () => {
  assert.throws(() => parseObjetivos("## x — X\nTexto: algo\n"), /no tiene Archivos/);
  assert.throws(() => parseObjetivos("## x — X\nArchivos: lib/*.ts\n"), /no tiene Texto/);
});

test("globs: * stays inside one folder, ** goes through all of them", () => {
  assert.ok(globToRegExp("lib/jarvis*.ts").test("lib/jarvis-mind.ts"));
  assert.ok(!globToRegExp("lib/jarvis*.ts").test("lib/x/jarvis-mind.ts"));
  assert.ok(globToRegExp("lib/assistant/**").test("lib/assistant/a/b.ts"));
  assert.ok(globToRegExp("app/*.tsx").test("app/jarvis.tsx"));
  assert.ok(!globToRegExp("app/*.tsx").test("app/api/x.tsx"));
  assert.ok(globToRegExp("wrangler*.jsonc").test("wrangler.production.jsonc"));
});

test("the first objective whose glob matches takes the file: specific before general", () => {
  const { objetivos } = parseObjetivos(FIXTURE_MD);
  const objs = objetivos.map((o: { globs: string[] }) => ({ ...o, regs: o.globs.map(globToRegExp) }));
  assert.equal(objetivoDe("lib/a.ts", objs), "cuentas");
  assert.equal(objetivoDe("app/otra.tsx", objs), "interfaz");
  assert.equal(objetivoDe("zz/otra.ts", objs), null);
});

test("the index reads exports, imports both ways, type-only imports apart, tests and routes", () => {
  const index = construirIndice(FILES, parseObjetivos(FIXTURE_MD));
  const a = index.mapa.get("lib/a.ts");
  assert.equal(a.objetivo, "cuentas");
  assert.equal(a.resumen, "Calcula el riesgo de una operación.");
  assert.deepEqual(a.exporta, ["riesgo", "LIMITE", "Tipo2"]);
  assert.deepEqual(a.importa, ["lib/b.ts"], "the type-only import of tipos.ts is erased, so it is not an edge");
  assert.deepEqual(index.mapa.get("lib/b.ts").usadoPor, ["lib/a.ts"]);
  assert.deepEqual(index.mapa.get("lib/tipos.ts").usadoPor, []);
  assert.deepEqual(a.probadoPor, ["tests/a.test.ts"]);
  assert.deepEqual(index.mapa.get("tests/a.test.ts").pruebas, ["el riesgo suma"]);
  assert.deepEqual(index.mapa.get("tests/a.test.ts").pruebaDe, ["lib/a.ts"]);
  assert.deepEqual(index.rutas, [{ ruta: "/api/hola", archivo: "app/api/hola/route.ts", metodos: ["GET", "POST"], objetivo: "interfaz" }]);
});

test("tables: created with their indexes, and read from the files that use them", () => {
  const index = construirIndice(FILES, parseObjetivos(FIXTURE_MD));
  const notas = index.tablas.get("notas");
  assert.deepEqual(notas.crea, ["lib/d.ts"]);
  assert.deepEqual(notas.usa, ["lib/d.ts"], "the file that creates a table and also queries it counts as a user");
  assert.deepEqual(notas.indices, ["notas_id"]);
});

test("secrets and hosts are listed per file, and a secret read in browser code is a problem with its chain", () => {
  const index = construirIndice(FILES, parseObjetivos(FIXTURE_MD));
  assert.deepEqual(index.secretos.get("groq_api_key").lee, ["lib/c.ts"]);
  assert.deepEqual(index.mapa.get("lib/c.ts").hosts, ["api.groq.com"]);
  const problemas = index.cliente.problemas.map((p: { tipo: string; archivo: string }) => `${p.tipo}:${p.archivo}`).sort();
  assert.deepEqual(problemas, ["api:app/cliente-api.tsx", "secreto:lib/c.ts"]);
  const secreto = index.cliente.problemas.find((p: { tipo: string }) => p.tipo === "secreto");
  assert.ok(secreto, "the secret read in browser code is reported");
  assert.deepEqual(secreto.cadena, ["app/chico.tsx", "lib/c.ts"]);
});

test("a file that no objective owns is reported, and the check fails on it", () => {
  const index = construirIndice(FILES, parseObjetivos(FIXTURE_MD));
  assert.deepEqual(index.sinObjetivo, ["misc/zz.ts"]);
  assert.equal(chequear(index, renderMapa(index)).ok, false);
});

test("the check fails when the map is stale, and names the lines that differ", () => {
  const index = construirIndice(FILES, parseObjetivos(FIXTURE_MD));
  const r = chequear(index, "# Mapa viejo\n");
  assert.equal(r.mapaViejo, true);
  assert.equal(r.ok, false);
  assert.ok(r.dif, "the difference between the maps is named");
  assert.ok(r.dif.agregadas.length > 0);
  assert.ok(r.dif.quitadas.includes("# Mapa viejo"));
});

test("--buscar finds code in English through the synonyms, and stopwords alone find nothing", () => {
  const extra = [...FILES.filter((f) => !f.path.startsWith("misc/")), archivo("lib/voice-engine.ts", "export function speak() {}\n")];
  const index = construirIndice(extra, parseObjetivos(FIXTURE_MD));
  assert.equal(buscar(index, "voz").resultados[0].f.path, "lib/voice-engine.ts");
  assert.equal(buscar(index, "de la").resultados.length, 0);
});

test("--cambios names the files that changed, grouped by objective", () => {
  const def = parseObjetivos(FIXTURE_MD);
  const index = construirIndice(FILES, def);
  const previas = renderHuellas(index);
  assert.match(textoCambios(index, previas, null), /nada cambió/);
  const cambiados = FILES.map((f) => (f.path === "lib/b.ts" ? archivo("lib/b.ts", `${f.texto}// nuevo\n`) : f));
  const texto = textoCambios(construirIndice(cambiados, def), previas, null);
  assert.match(texto, /\[cuentas\]/);
  assert.match(texto, /cambió: lib\/b\.ts/);
});

test("queries answer with a code: 2 for a missing argument, 1 for a file that is not there", () => {
  const index = construirIndice(FILES, parseObjetivos(FIXTURE_MD));
  assert.equal(ejecutar(["--buscar"], index).codigo, 2);
  assert.equal(ejecutar(["--archivo", "no-existe.ts"], index).codigo, 1);
  assert.equal(ejecutar(["--objetivo", "cuentas"], index).codigo, 0);
  assert.match(ejecutar(["--archivo", "lib/a.ts"], index).salida, /exporta: riesgo, LIMITE, Tipo2/);
});

test("the committed map is the map the code gives today (npm run arana rewrites it when this fails)", () => {
  const index = cargarIndice(ROOT);
  const guardado = readFileSync(join(ROOT, MAPA), "utf8");
  const r = chequear(index, guardado);
  assert.equal(r.mapaViejo, false, "docs/araña/MAPA.md está viejo: corré npm run arana");
  assert.deepEqual(r.problemas, [], r.problemas.join("\n"));
});
