// Pruebas del editor por IA (lib/ia-editor.ts): qué rutas se pueden tocar, cómo se lee el comentario del dueño, que se valide
// la respuesta del modelo y que un cambio dudoso se rechace entero sin dejar archivos a medias.
import assert from "node:assert/strict";
import test from "node:test";
import { MAX_ARCHIVOS, MAX_EDICIONES, aplicarEdiciones, ocultarSecretos, parsearComentario, promptEdicion, rutaPermitida, rutasElegidas, validarRespuesta } from "../lib/ia-editor.ts";

test("solo se pueden tocar archivos de app, lib, tests y docs", () => {
  for (const ok of ["app/practica-gatillo.tsx", "lib/aprender.ts", "tests/aprender.test.ts", "docs/estudio-estrategias.md"]) assert.equal(rutaPermitida(ok), true, ok);
});

test("se rechazan workflows, dependencias, migraciones, scripts, claves, el mapa de la araña y salidas de carpeta", () => {
  const no = [
    ".github/workflows/deploy-cloudflare.yml",
    "package.json",
    "package-lock.json",
    "wrangler.jsonc",
    "drizzle/0001.sql",
    "scripts/subir.mjs",
    "docs/araña/MAPA.md",
    "lib/../.github/workflows/x.yml",
    "../etc/passwd",
    "/etc/passwd",
    "lib\\x.ts",
    "lib/.env",
    "app/clave.pem",
    "lib//x.ts",
    "lib/./x.ts",
    "",
  ];
  for (const r of no) assert.equal(rutaPermitida(r), false, JSON.stringify(r));
});

test("el comentario tiene que empezar con /ia y traer un pedido", () => {
  assert.equal(parsearComentario("hola"), null);
  assert.equal(parsearComentario("/ia"), null);
  assert.equal(parsearComentario("/iaaa cambiá algo"), null);
  assert.deepEqual(parsearComentario("/ia cambiá el título de la pestaña"), { archivos: [], pedido: "cambiá el título de la pestaña" });
});

test("el comentario puede nombrar archivos, y los que no se pueden tocar se descartan", () => {
  const p = parsearComentario("/ia\narchivos: app/practica-gatillo.tsx, .github/workflows/claude.yml, lib/aprender.ts\nCorregí el texto del botón");
  assert.deepEqual(p, { archivos: ["app/practica-gatillo.tsx", "lib/aprender.ts"], pedido: "Corregí el texto del botón" });
});

test("no se toman más archivos que el máximo ni repetidos", () => {
  const lista = Array.from({ length: 9 }, (_, k) => `lib/a${k}.ts`).join(", ");
  const p = parsearComentario(`/ia\narchivos: lib/a0.ts, lib/a0.ts, ${lista}\nhacé algo`);
  assert.ok(p);
  assert.equal(p.archivos.length <= MAX_ARCHIVOS, true);
  assert.equal(new Set(p.archivos).size, p.archivos.length);
});

test("las rutas que elige el modelo se filtran contra la lista y lo permitido", () => {
  const lista = ["lib/a.ts", "app/b.tsx", "scripts/subir.mjs", "lib/c.ts"];
  const elegidas = rutasElegidas('Miralos: "lib/a.ts", scripts/subir.mjs, lib/inventado.ts, app/b.tsx', lista);
  assert.deepEqual(elegidas, ["lib/a.ts", "app/b.tsx"]);
});

test("la respuesta del modelo se acepta con o sin cercos de código", () => {
  const json = JSON.stringify({ resumen: "Cambia un texto", ediciones: [{ archivo: "lib/a.ts", buscar: "uno", reemplazar: "dos" }] });
  for (const t of [json, "```json\n" + json + "\n```", "Acá va:\n```\n" + json + "\n```"]) {
    const r = validarRespuesta(t);
    assert.equal(r.ok, true);
  }
});

test("la respuesta del modelo se rechaza si no es JSON, no tiene la forma, está vacía o pasa los límites", () => {
  assert.equal(validarRespuesta("no es json").ok, false);
  assert.equal(validarRespuesta("[]").ok, false);
  assert.equal(validarRespuesta(JSON.stringify({ resumen: "x", ediciones: [] })).ok, false);
  assert.equal(validarRespuesta(JSON.stringify({ resumen: "x", ediciones: [{ archivo: "lib/a.ts", buscar: "", reemplazar: "y" }] })).ok, false);
  assert.equal(validarRespuesta(JSON.stringify({ resumen: "x", ediciones: [{ archivo: "lib/a.ts", buscar: "a" }] })).ok, false);
  const muchas = Array.from({ length: MAX_EDICIONES + 1 }, () => ({ archivo: "lib/a.ts", buscar: "a", reemplazar: "b" }));
  assert.equal(validarRespuesta(JSON.stringify({ resumen: "x", ediciones: muchas })).ok, false);
  const enorme = [{ archivo: "lib/a.ts", buscar: "a".repeat(5_000), reemplazar: "b" }];
  assert.equal(validarRespuesta(JSON.stringify({ resumen: "x", ediciones: enorme })).ok, false);
});

test("se aplica un cambio cuando el texto aparece exactamente una vez", () => {
  const r = aplicarEdiciones({ "lib/a.ts": "const x = 1;\nconst y = 2;\n" }, [{ archivo: "lib/a.ts", buscar: "const y = 2;", reemplazar: "const y = 3;" }]);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.archivos["lib/a.ts"], "const x = 1;\nconst y = 3;\n");
    assert.deepEqual(r.tocados, ["lib/a.ts"]);
  }
});

test("un cambio dudoso rechaza todo y no toca nada: texto que no está, repetido, archivo no mostrado o no permitido", () => {
  const base = { "lib/a.ts": "uno uno dos", "lib/b.ts": "tres" };
  const sinCambios = JSON.stringify(base);
  const casos = [
    [{ archivo: "lib/a.ts", buscar: "cuatro", reemplazar: "x" }],
    [{ archivo: "lib/a.ts", buscar: "uno", reemplazar: "x" }],
    [{ archivo: "lib/c.ts", buscar: "tres", reemplazar: "x" }],
    [{ archivo: ".github/workflows/claude.yml", buscar: "a", reemplazar: "b" }],
    [
      { archivo: "lib/b.ts", buscar: "tres", reemplazar: "cinco" },
      { archivo: "lib/a.ts", buscar: "cuatro", reemplazar: "x" },
    ],
  ];
  for (const ediciones of casos) {
    const r = aplicarEdiciones(base, ediciones);
    assert.equal(r.ok, false, JSON.stringify(ediciones));
    assert.equal(JSON.stringify(base), sinCambios, "la entrada se modificó");
  }
});

test("el pedido al modelo incluye cada archivo con su ruta y el pedido de la persona", () => {
  const { sistema, usuario } = promptEdicion("reglas", { "lib/a.ts": "contenido a" }, "cambiá X");
  assert.ok(sistema.includes("JSON"));
  assert.ok(usuario.includes("=== ARCHIVO lib/a.ts ===") && usuario.includes("contenido a") && usuario.includes("cambiá X"));
});

test("los secretos se ocultan en cualquier texto que salga, aunque aparezcan varias veces", () => {
  const t = ocultarSecretos("falló con gsk_ABC123 y otra vez gsk_ABC123; token ghs_XYZ", ["gsk_ABC123", "ghs_XYZ", undefined, "ab"]);
  assert.equal(t, "falló con *** y otra vez ***; token ***");
  assert.equal(ocultarSecretos("sin nada", ["clave-larga"]), "sin nada");
});
