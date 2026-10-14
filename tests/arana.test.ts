import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buscar,
  chequear,
  cargarIndice,
  comentarioInicial,
  construirIndice,
  ejecutar,
  encabezadosMarkdown,
  esferaDe,
  globToRegExp,
  grafoDe,
  MAPA,
  objetivoDe,
  paginaCaida,
  paginaHtml,
  parseObjetivos,
  renderHuellas,
  renderMapa,
  ROOT,
  textoBusqueda,
  textoCambios,
  textoPendientes,
  textoReglas,
  VISTA_PLANTILLA,
  vistaHtml,
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

test("the description of a file is the comment that opens it, or the header of three lines or more right after its imports", () => {
  assert.equal(comentarioInicial('/**\n * Calcula el riesgo.\n */\nimport a from "./a.ts";\n'), "Calcula el riesgo.");
  assert.equal(comentarioInicial('#!/usr/bin/env node\n/**\n * La araña: el mapa.\n */\nimport a from "./a.ts";\n'), "La araña: el mapa.", "the shebang line is not code");
  assert.equal(comentarioInicial("/* eslint-disable */\n/**\n * Hace cosas.\n */\nexport const c = 1;\n"), "Hace cosas.", "tooling directives are skipped");
  // Most files here start with their imports (multi-line ones, "use client", side-effect ones) and put the header after.
  const cabecera = '"use client";\n\nimport { useState } from "react";\nimport {\n  uno,\n  dos,\n} from "@/lib/x";\nimport type { Tipo } from "./tipos.ts";\nimport "./estilos.css";\n\n/**\n * El escáner del mercado.\n * Lee todo.\n * No opera.\n */\nexport const a = 1;\n';
  assert.equal(comentarioInicial(cabecera), "El escáner del mercado.\nLee todo.\nNo opera.");
  // A short doc after the imports belongs to the first function: describing the file with it would mislead.
  assert.equal(comentarioInicial('import a from "./a.ts";\n\n/** Suma dos números. */\nexport function sumar() {}\n'), "");
  assert.equal(comentarioInicial('import a from "./a.ts";\n\n/**\n * Suma.\n * Dos números.\n */\nexport function sumar() {}\n'), "", "two lines are not a header");
  // A // note after the imports is not a header either, and code between the imports and the comment ends the search.
  assert.equal(comentarioInicial('import a from "./a.ts";\n// eslint-disable-next-line x\nexport const b = 1;\n'), "");
  assert.equal(comentarioInicial('import a from "./a.ts";\nconst x = 1;\n/**\n * Uno.\n * Dos.\n * Tres.\n */\n'), "");
  // A // note between two imports is skipped with them.
  assert.equal(comentarioInicial('import a from "./a.ts";\n// Con la extensión para que Node lo corra.\nimport b from "./b.ts";\n\n/**\n * Un asistente.\n * Sin modelo.\n * No inventa.\n */\nexport const c = 1;\n'), "Un asistente.\nSin modelo.\nNo inventa.");
});

test("the real project: the files whose header comes after the imports are described", () => {
  const index = cargarIndice(ROOT);
  for (const p of ["scripts/arana.mjs", "lib/jarvis-scan.ts", "lib/jarvis-council.ts", "app/jarvis-scan.tsx"]) {
    assert.ok(index.mapa.get(p).resumen, `${p} no tiene descripción: abrilo con un comentario de tres líneas o más`);
  }
});

test("the headings of a Markdown file: ## to ####, never the ones inside a code block", () => {
  const md = "# Título\n\ntexto\n\n## Resultados (10 monedas)\n\n```sh\n## no es un título\n```\n\n### Costos `más` altos\n\n##### Demasiado hondo\n";
  assert.deepEqual(encabezadosMarkdown(md), ["Resultados (10 monedas)", "Costos más altos"]);
});

test("--buscar finds a Markdown file by its headings and says which section to read", () => {
  const md = archivo("docs/notas.md", "# Notas de prueba\n\n## Reglas de redondeo\n\nTexto.\n\n## Otra cosa\n");
  const index = construirIndice([...FILES, md], parseObjetivos(FIXTURE_MD));
  const hallado = buscar(index, "redondeo").resultados.find((x: { f: { path: string } }) => x.f.path === "docs/notas.md");
  assert.equal(hallado?.seccion, "Reglas de redondeo");
  assert.match(textoBusqueda(index, "redondeo"), /docs\/notas\.md .*§ Reglas de redondeo/);
});

test("--buscar also brings the rules and pending items that talk about the topic, and --regla brings them whole", () => {
  const index = construirIndice(FILES, parseObjetivos(FIXTURE_MD));
  assert.deepEqual(buscar(index, "redondea").reglas.map((x: { slug: string; tipo: string; texto: string }) => [x.slug, x.tipo, x.texto]), [["cuentas", "regla", "Nunca se redondea hacia arriba."]]);
  assert.deepEqual(buscar(index, "redondeo").reglas.map((x: { tipo: string }) => x.tipo), ["pendiente"]);
  assert.equal(buscar(index, "redondea voz").reglas.length, 0, "with two words both have to be there: «redondea» alone is not «redondea voz»");
  // A rule found with no file for it is still an answer.
  const sinArchivos = textoBusqueda(index, "arriba");
  assert.match(sinArchivos, /Reglas y pendientes que lo mencionan/);
  assert.match(sinArchivos, /\[cuentas\] Nunca se redondea hacia arriba\./);
  assert.doesNotMatch(sinArchivos, /Nada\./);
  assert.match(textoBusqueda(index, "zzzzz"), /Nada\./);
  // --buscar cuts a long rule; --regla gives it whole.
  const larga = `Nunca se redondea hacia arriba ${"palabra ".repeat(60).trim()}.`;
  const conLarga = construirIndice(FILES, parseObjetivos(FIXTURE_MD.replace("- Nunca se redondea hacia arriba.", `- ${larga}`)));
  const corta = textoBusqueda(conLarga, "redondea").split("\n").find((l: string) => l.includes("[cuentas]")) ?? "";
  assert.ok(corta.endsWith("…") && corta.length < 240, corta);
  assert.equal(textoReglas(conLarga, "redondea"), `[cuentas] ${larga}`);
  assert.equal(ejecutar(["--regla", "redondeo"], index).salida, "[cuentas] pendiente: Revisar el redondeo de LIMITE.");
  assert.equal(ejecutar(["--regla"], index).codigo, 2);
  assert.match(ejecutar(["--regla", "zzzzz"], index).salida, /Ninguna regla/);
  assert.match(ejecutar(["--regla", "de la"], index).salida, /Decime qué buscás/);
});

test("--pendientes gathers what is left to do, by objective, and says when there is nothing", () => {
  const index = construirIndice(FILES, parseObjetivos(FIXTURE_MD));
  assert.equal(textoPendientes(index), "[cuentas]\n- Revisar el redondeo de LIMITE.");
  assert.equal(ejecutar(["--pendientes"], index).codigo, 0);
  const sin = construirIndice(FILES, parseObjetivos(FIXTURE_MD.replace("Pendiente:\n- Revisar el redondeo de LIMITE.\n", "")));
  assert.match(textoPendientes(sin), /nada pendiente/);
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

test("the view's graph: every file once, imports and tests as edges between them, and the flags to look at", () => {
  const index = construirIndice(FILES, parseObjetivos(FIXTURE_MD));
  const g = grafoDe(index, { generado: "2026-10-08T09:00:00.000Z", commit: "abc1234" });
  assert.equal(g.archivos.length, FILES.length);
  const at = (p: string) => g.archivos.findIndex((f: { p: string }) => f.p === p);
  assert.deepEqual(g.enlaces.map(([a, b]: number[]) => [g.archivos[a].p, g.archivos[b].p]).sort(), [["app/chico.tsx", "lib/c.ts"], ["app/cliente-api.tsx", "app/api/hola/route.ts"], ["app/page.tsx", "lib/a.ts"], ["lib/a.ts", "lib/b.ts"]]);
  assert.deepEqual(g.pruebas, [[at("tests/a.test.ts"), at("lib/a.ts")]], "a test is an edge of its own kind");
  assert.equal(g.archivos[at("lib/a.ts")].pr, 1);
  assert.equal(g.archivos[at("lib/a.ts")].k, "lib");
  assert.equal(g.archivos[at("app/api/hola/route.ts")].k, "api");
  assert.equal(g.archivos[at("tests/a.test.ts")].k, "prueba");
  assert.equal(g.objetivos[g.archivos[at("lib/a.ts")].o].slug, "cuentas");
  assert.equal(g.archivos[at("misc/zz.ts")].o, -1);
  const kinds = g.banderas.map((b: { k: string; a: number }) => `${b.k}:${g.archivos[b.a].p}`).sort();
  assert.ok(kinds.includes("sin-objetivo:misc/zz.ts"));
  assert.ok(kinds.includes("sin-prueba:lib/b.ts"));
  assert.ok(kinds.includes("secreto:lib/c.ts"), "a secret reached from browser code is flagged on the file that reads it");
  assert.ok(kinds.includes("api:app/cliente-api.tsx"));
  assert.deepEqual(g.objetivos.find((o: { slug: string }) => o.slug === "cuentas").pendiente, ["Revisar el redondeo de LIMITE."]);
  assert.equal(g.commit, "abc1234");
  assert.deepEqual(g.tablas, [{ n: "notas", crea: [at("lib/d.ts")], usa: [at("lib/d.ts")] }]);
  assert.ok(g.sinonimos.voz.includes("voice"));
});

type Vec = number[];
const angulo = (a: Vec, b: Vec) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));

test("the view's sphere: every file a unit point inside the cap of its objective, caps apart, same project same sphere", () => {
  const index = cargarIndice(ROOT);
  const e = esferaDe(index);
  const n = index.objetivos.length;
  assert.equal(e.p.length, index.archivos.length * 3);
  assert.equal(e.c.length, n * 3);
  assert.equal(e.r.length, n);
  const centro = (g: number) => e.c.slice(g * 3, g * 3 + 3);
  index.archivos.forEach((f: { path: string; objetivo?: string | null }, i: number) => {
    const P = e.p.slice(i * 3, i * 3 + 3);
    assert.ok(Math.abs(Math.hypot(P[0], P[1], P[2]) - 1) < 0.01, `${f.path} is on the sphere`);
    if (!f.objetivo) return;
    const g = index.objetivos.findIndex((o: { slug: string }) => o.slug === f.objetivo);
    assert.ok(angulo(P, centro(g)) <= e.r[g] + 0.005, `${f.path} stays inside the cap of ${f.objetivo}`);
  });
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      if (!e.r[a] || !e.r[b]) continue;
      assert.ok(angulo(centro(a), centro(b)) >= e.r[a] + e.r[b], `the caps of ${index.objetivos[a].slug} and ${index.objetivos[b].slug} do not overlap`);
    }
  }
  assert.deepEqual(esferaDe(index), e, "no randomness: the same project draws the same sphere");
});

test("the view's sphere keeps objectives with no files of their own out of it, and puts loose files in a cap of their own", () => {
  const index = construirIndice(FILES, parseObjetivos(FIXTURE_MD));
  const e = esferaDe(index);
  const g = (slug: string) => index.objetivos.findIndex((o: { slug: string }) => o.slug === slug);
  assert.equal(e.r[g("honestidad")], 0, "transversal: no cap");
  assert.deepEqual(e.c.slice(g("honestidad") * 3, g("honestidad") * 3 + 3), [0, 0, 0]);
  assert.ok(e.r[g("cuentas")] > 0);
  const suelto = index.archivos.findIndex((f: { path: string }) => f.path === "misc/zz.ts");
  assert.ok(suelto >= 0 && Math.abs(Math.hypot(e.p[suelto * 3], e.p[suelto * 3 + 1], e.p[suelto * 3 + 2]) - 1) < 0.01);
  const vacio = esferaDe(construirIndice([], parseObjetivos(FIXTURE_MD)));
  assert.deepEqual(vacio.p, [], "an empty project draws an empty sphere without failing");
});

test("the view's matrix counts the imports that go from each objective to each objective", () => {
  const index = construirIndice(FILES, parseObjetivos(FIXTURE_MD));
  const g = grafoDe(index);
  const n = g.objetivos.length;
  const k = (slug: string) => g.objetivos.findIndex((o: { slug: string }) => o.slug === slug);
  assert.equal(g.matriz.length, n * n);
  assert.equal(g.matriz[k("interfaz") * n + k("datos")], 1, "app/chico.tsx → lib/c.ts");
  assert.equal(g.matriz[k("interfaz") * n + k("cuentas")], 1, "app/page.tsx → lib/a.ts");
  assert.equal(g.matriz[k("interfaz") * n + k("interfaz")], 1, "app/cliente-api.tsx → the route, in the same objective");
  assert.equal(g.matriz[k("cuentas") * n + k("cuentas")], 1, "lib/a.ts → lib/b.ts");
  assert.equal(g.matriz[k("datos") * n + k("interfaz")], 0, "imports have a direction");
  assert.equal(g.matriz.reduce((a: number, v: number) => a + v, 0), 4, "tests are not counted: they are edges of their own kind");
  assert.equal(g.esfera.p.length, g.archivos.length * 3, "the sphere travels with the graph");
});

test("the view: the graph goes inside the page once, and nothing in it can close the script", () => {
  const plantilla = readFileSync(join(ROOT, VISTA_PLANTILLA), "utf8");
  const g = grafoDe(construirIndice([...FILES, archivo("lib/raro.ts", "/** Cierra </script> a propósito. */\nexport const x = 1;\n")], parseObjetivos(FIXTURE_MD)));
  const html = vistaHtml(plantilla, g);
  assert.ok(!html.includes("/*__GRAFO__*/null"));
  assert.equal(html.split("</script>").length, plantilla.split("</script>").length, "no extra </script> from the data");
  assert.ok(html.includes("<title>Araña de ALT RADAR</title>"));
  assert.throws(() => vistaHtml("<p>sin marcador</p>", g), /falta el marcador/);
});

test("the page for the app: a whole document around the view, with the graph inside once", () => {
  const plantilla = readFileSync(join(ROOT, VISTA_PLANTILLA), "utf8");
  const g = grafoDe(construirIndice(FILES, parseObjetivos(FIXTURE_MD)), { generado: "2026-10-13T00:00:00.000Z", commit: "abc1234" });
  const vista = vistaHtml(plantilla, g);
  const pagina = paginaHtml(vista);
  assert.ok(pagina.startsWith("<!doctype html>"), "without a doctype the browser renders in quirks mode");
  assert.ok(pagina.includes('<meta charset="utf-8">') && pagina.includes('name="viewport"'));
  assert.ok(pagina.includes(vista), "the view goes in untouched");
  // the page's own title: the SVG tooltips built inside the script are text there, not a second title
  assert.equal(pagina.replace(/<script[\s\S]*?<\/script>/g, "").split("<title>").length, 2, "one title");
  assert.ok(pagina.includes("abc1234"));
  assert.ok(!pagina.includes("/*__GRAFO__*/null"));
});

test("the fallback page says what happened, escapes the reason and runs nothing", () => {
  const html = paginaCaida('falta <script>alert("x")</script> & más');
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("La araña no se pudo dibujar"));
  assert.ok(!html.includes("<script"), "no script, not even the one in the reason");
  assert.ok(html.includes("&lt;script&gt;") && html.includes("&amp;"));
});

test("--pagina writes the standalone page where it is told to", () => {
  const dir = mkdtempSync(join(tmpdir(), "arana-pagina-"));
  try {
    const salida = join(dir, "nueva", "index.html");
    const r = ejecutar(["--pagina", salida], cargarIndice(ROOT));
    assert.equal(r.codigo, 0);
    const html = readFileSync(salida, "utf8");
    assert.ok(html.startsWith("<!doctype html>") && html.includes("Araña de ALT RADAR"));
    assert.ok(html.includes('"archivos"'), "the graph is inside");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--pagina in a build that cannot read the project leaves the fallback page and does not fail the build", () => {
  const dir = mkdtempSync(join(tmpdir(), "arana-caida-"));
  try {
    // A copy of the script with no docs next to it: the objectives file is missing, so the index cannot be built.
    mkdirSync(join(dir, "scripts"), { recursive: true });
    copyFileSync(join(ROOT, "scripts", "arana.mjs"), join(dir, "scripts", "arana.mjs"));
    const r = spawnSync(process.execPath, [join(dir, "scripts", "arana.mjs"), "--pagina"], { encoding: "utf8" });
    assert.equal(r.status, 0, "the build keeps going");
    const html = readFileSync(join(dir, "public", "arana", "index.html"), "utf8");
    assert.ok(html.includes("La araña no se pudo dibujar"));
    assert.ok(r.stdout.includes("queda una que avisa"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the app wires the page: build step, ignored output, the frame and its section", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.ok(String(pkg.scripts.prebuild).includes("arana.mjs --pagina"), "the build draws the page");
  assert.ok(readFileSync(join(ROOT, ".gitignore"), "utf8").split("\n").includes("/public/arana/"), "generated, so it is not committed");
  const desk = readFileSync(join(ROOT, "app", "arana-desk.tsx"), "utf8");
  // La ruta puede ir literal o en la constante RUTA del panel; lo que importa es que el marco cargue esa página.
  const cargaPagina = (pagina: string, clave: string) =>
    desk.includes(`src="${pagina}"`) || (desk.includes(`${clave}: "${pagina}"`) && desk.includes(`src={RUTA.${clave}}`));
  assert.ok(cargaPagina("/arana/index.html", "mapa") && desk.includes("sandbox="), "the frame loads the page, sandboxed");
  const app = readFileSync(join(ROOT, "app", "radar-app.tsx"), "utf8");
  assert.ok(app.includes('<Collapsible id="arana"') && app.includes('id: "arana"'), "section and nav entry");
});

test("the frame stays sandboxed apart from the app and only trusts its own height message", () => {
  const desk = readFileSync(join(ROOT, "app", "arana-desk.tsx"), "utf8");
  const sandbox = /sandbox="([^"]*)"/.exec(desk)?.[1] ?? "";
  assert.ok(sandbox.includes("allow-scripts"), "the page needs its script");
  assert.ok(!sandbox.includes("allow-same-origin"), "with scripts plus same-origin the page could lift its own sandbox");
  assert.ok(desk.includes("e.source === marcoVivo.current.contentWindow") && desk.includes("e.source === marcoMapa.current.contentWindow"), "only the messages of each frame count, and the height goes to that frame");
  assert.ok(desk.includes('d.arana !== "alto"') && desk.includes("Number.isFinite(d.h)"), "only a finite number under the agreed key");
  assert.ok(desk.includes("ALTO_MAX"), "the height is clamped");
  const page = readFileSync(join(ROOT, "scripts", "arana-vista.html"), "utf8");
  assert.ok(page.includes('postMessage({ arana: "alto", h }'), "the page reports its height under the same key");
  assert.ok(!/localStorage|sessionStorage|fetch\(|XMLHttpRequest|document\.cookie/.test(page), "the page keeps no storage and makes no requests");
});

test("the live page is a fixed file: no storage, no requests, only the parent's data, and it reports its height", () => {
  const page = readFileSync(join(ROOT, "scripts", "arana-vivo.html"), "utf8");
  assert.ok(!/localStorage|sessionStorage|fetch\(|XMLHttpRequest|document\.cookie|indexedDB|WebSocket/.test(page), "no storage and no requests: the data comes from the app");
  assert.ok(page.includes("e.source !== window.parent") && page.includes('d.arana !== "vivo"'), "only the parent's live data counts");
  assert.ok(page.includes('postMessage({ arana: "alto", h }'), "it reports its height under the key the frame expects");
  assert.ok(page.includes("const esc = (s)") && page.includes("esc(moneda(r.symbol))"), "text from the scan is escaped before it reaches the page");
  assert.ok(page.includes("Cómo leer esta pantalla") && page.includes("No es asesoramiento financiero"), "it explains itself to a beginner and says what it is not");
});

test("the live page is built as a plain copy, the build makes it, and the app shows it in its own tab", () => {
  const dir = mkdtempSync(join(tmpdir(), "arana-vivo-"));
  try {
    const destino = join(dir, "vivo.html");
    const r = spawnSync(process.execPath, [join(ROOT, "scripts", "arana.mjs"), "--vivo", destino], { encoding: "utf8" });
    assert.equal(r.status, 0);
    assert.equal(readFileSync(destino, "utf8"), readFileSync(join(ROOT, "scripts", "arana-vivo.html"), "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.ok(String(pkg.scripts.prebuild).includes("arana.mjs --vivo"), "the build copies the live page");
  const desk = readFileSync(join(ROOT, "app", "arana-desk.tsx"), "utf8");
  assert.ok((desk.includes('src="/arana/vivo.html"') || (desk.includes('vivo: "/arana/vivo.html"') && desk.includes("src={RUTA.vivo}"))) && desk.includes('role="tab"') && desk.includes("MAPA DEL PROYECTO"), "two tabs: EN VIVO and the map");
});

test("the automatic scan looks at the screen, respects the pause, and never stacks two scans", () => {
  const vivo = readFileSync(join(ROOT, "app", "arana-vivo.tsx"), "utf8");
  assert.ok(vivo.includes("IntersectionObserver") && vivo.includes("visibilitychange"), "it looks at whether the table is on screen");
  assert.ok(vivo.includes("decidirAuto(") && vivo.includes("if (scanState().running) return;"), "the rule lives in one pure function, and a manual scan does not stack");
  const auto = readFileSync(join(ROOT, "lib", "arana-vivo-auto.ts"), "utf8");
  assert.ok(auto.includes("AUTO_CADA_MIN = 15"), "every 15 minutes at most");
});
