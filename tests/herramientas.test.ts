import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  archivoDeSecretos, archivoProtegido, buscarSecretos, decidirEdicion, decidirLectura, duracion, filtrarTsc,
  MAX_LINEAS_LECTURA, repoDesdeRemoto, resumirLint, resumirTests, revisarArchivosNuevos,
} from "../scripts/herramientas.mjs";

/**
 * Las herramientas para gastar pocos tokens: el resumen de `npm run verificar` tiene que mostrar lo que falla y nada
 * más, `npm run subir` tiene que frenar secretos, archivos protegidos y archivos nuevos sin seguimiento, y los hooks de Claude Code tienen que frenar
 * la lectura entera de archivos largos y la edición de secretos.
 */

const raiz = fileURLToPath(new URL("..", import.meta.url));

test("tests: totals, and on failure only the failures, without node's internal frames", () => {
  const ok = "✔ suma (1ms)\nℹ tests 12\nℹ pass 12\nℹ fail 0\nℹ cancelled 0\n";
  assert.deepEqual(resumirTests(ok), { total: 12, pass: 12, fail: 0, cancelled: 0, fallas: [] });
  const mal = [
    "✖ resta (2ms)", "ℹ tests 3", "ℹ pass 2", "ℹ fail 1", "ℹ cancelled 0", "", "✖ failing tests:", "",
    "test at tests/resta.test.ts:4:1", "✖ resta (2ms)", "  AssertionError [ERR_ASSERTION]: 2 !== 3",
    "      at TestContext.<anonymous> (file:///repo/tests/resta.test.ts:5:10)",
    "      at Test.runInAsyncScope (node:async_hooks:211:14)", "      at async Promise.all (index 0)",
  ].join("\n");
  const r = resumirTests(`\x1b[31m${mal}\x1b[39m`);
  assert.equal(r.fail, 1);
  assert.deepEqual(r.fallas, [
    "test at tests/resta.test.ts:4:1", "✖ resta (2ms)", "  AssertionError [ERR_ASSERTION]: 2 !== 3",
    "      at TestContext.<anonymous> (file:///repo/tests/resta.test.ts:5:10)",
  ]);
  const caido = resumirTests("SyntaxError: Unexpected token\n    at x.ts:1");
  assert.equal(caido.total, null, "without totals the run crashed");
  assert.ok(caido.fallas.some((l) => l.includes("SyntaxError")), "and the last lines say why");
});

test("lint: counts and the first lines of the detail", () => {
  const r = resumirLint("\n/repo/lib/x.ts\n  3:7  error  'a' is assigned a value but never used  no-unused-vars\n\n✖ 1 problem (1 error, 0 warnings)\n");
  assert.equal(r.errores, 1);
  assert.equal(r.avisos, 0);
  assert.ok(r.lineas[1].includes("no-unused-vars"));
  assert.deepEqual(resumirLint(""), { errores: 0, avisos: 0, lineas: [] });
});

test("tsc: groups each error with its continuation lines and drops the expected vite.config.ts one", () => {
  const salida = [
    "vite.config.ts(9,5): error TS2769: No overload matches this call.",
    "  Overload 1 of 2 gave the following error.",
    "lib/x.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.",
    "  detalle de lib/x.ts",
  ].join("\n");
  const r = filtrarTsc(salida);
  assert.equal(r.esperados, 1);
  assert.equal(r.cantidad, 1);
  assert.deepEqual(r.errores, ["lib/x.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.", "  detalle de lib/x.ts"]);
  assert.equal(filtrarTsc("").cantidad, 0);
});

test("secret files and protected files", () => {
  for (const f of [".env", ".env.local", "sub/.env.production", ".dev.vars", ".dev.vars.staging", "clave.pem", "id_ed25519"]) assert.ok(archivoDeSecretos(f), f);
  for (const f of [".env.example", ".dev.vars.example", "lib/env.ts", "docs/claves.md", "lib/keys.ts"]) assert.ok(!archivoDeSecretos(f), f);
  for (const f of [".github/workflows/deploy-cloudflare.yml", "wrangler.jsonc", "wrangler.cron.jsonc", "./wrangler.json"]) assert.ok(archivoProtegido(f), f);
  for (const f of ["lib/wrangler-notes.ts", ".github/ISSUE_TEMPLATE/x.md", "worker/index.ts"]) assert.ok(!archivoProtegido(f), f);
});

test("secrets in a diff: only added lines, with file and line number", () => {
  // Built at runtime so this file never carries a real-looking token itself.
  const gh = `ghp_${"a1".repeat(18)}`;
  const tg = `123456789:${"A".repeat(35)}`;
  const diff = [
    "diff --git a/lib/x.ts b/lib/x.ts", "--- a/lib/x.ts", "+++ b/lib/x.ts",
    "@@ -10,0 +11,2 @@", "+const ok = 1;", `+const t = "${gh}";`,
    "@@ -40 +42 @@", `-const viejo = "${tg}";`, `+const bot = "${tg}";`,
    "+++ b/docs/limpio.md", "@@ -1 +1 @@", "+nada raro acá: task-observer, desk-12",
  ].join("\n");
  assert.deepEqual(buscarSecretos(diff), [
    { archivo: "lib/x.ts", linea: 12, tipo: "token de GitHub" },
    { archivo: "lib/x.ts", linea: 42, tipo: "token de bot de Telegram" },
  ]);
  assert.deepEqual(buscarSecretos("+++ b/a.ts\n@@ -1 +1 @@\n+export const a = 1;"), []);
});

test("the scanner does not flag its own patterns", () => {
  const propio = readFileSync(new URL("../scripts/herramientas.mjs", import.meta.url), "utf8");
  const diff = `+++ b/scripts/herramientas.mjs\n@@ -0,0 +1,${propio.split("\n").length} @@\n${propio.split("\n").map((l) => `+${l}`).join("\n")}`;
  assert.deepEqual(buscarSecretos(diff), []);
});

test("read hook: a long file read whole is stopped with the cheap way; parts and short files pass", () => {
  const n = MAX_LINEAS_LECTURA + 1;
  assert.match(decidirLectura({ rel: "app/x.tsx", lineas: n }) ?? "", /npm run arana -- --archivo app\/x\.tsx/);
  assert.doesNotMatch(decidirLectura({ rel: "../../tmp/log.txt", lineas: n }) ?? "", /arana/, "outside the repo there is no card");
  assert.equal(decidirLectura({ rel: "app/x.tsx", lineas: n, limit: 5000 }), null, "asking for it explicitly is allowed");
  assert.equal(decidirLectura({ rel: "app/x.tsx", lineas: n, offset: 100 }), null);
  assert.equal(decidirLectura({ rel: "app/x.tsx", lineas: MAX_LINEAS_LECTURA }), null);
});

test("edit hook: secrets are stopped, workflows and wrangler ask, the rest passes", () => {
  assert.equal(decidirEdicion(".dev.vars")?.tipo, "frenar");
  assert.equal(decidirEdicion("wrangler.jsonc")?.tipo, "preguntar");
  assert.equal(decidirEdicion(".github/workflows/deploy-cloudflare.yml")?.tipo, "preguntar");
  assert.equal(decidirEdicion("lib/escalera.ts"), null);
});

test("the hooks script answers Claude Code the way it expects (exit 2 stops, JSON asks)", () => {
  const correr = (modo: string, entrada: object) => spawnSync("node", ["scripts/claude-hooks.mjs", modo], {
    cwd: raiz, input: JSON.stringify(entrada), encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: raiz },
  });
  const largo = correr("lectura", { tool_input: { file_path: `${raiz}app/live-bookmap.tsx` } });
  assert.equal(largo.status, 2);
  assert.match(largo.stderr, /líneas: leelo por partes/);
  assert.equal(correr("lectura", { tool_input: { file_path: `${raiz}app/live-bookmap.tsx`, limit: 50 } }).status, 0);
  assert.equal(correr("lectura", { tool_input: { file_path: `${raiz}package.json` } }).status, 0);
  assert.equal(correr("lectura", { tool_input: { file_path: `${raiz}no-existe.ts` } }).status, 0, "a missing file is the Read tool's problem");
  assert.equal(correr("edicion", { tool_input: { file_path: `${raiz}.env` } }).status, 2);
  const pide = correr("edicion", { tool_input: { file_path: "wrangler.jsonc" } });
  assert.equal(pide.status, 0);
  assert.equal(JSON.parse(pide.stdout).hookSpecificOutput.permissionDecision, "ask");
  assert.equal(correr("edicion", { tool_input: { file_path: "lib/x.ts" } }).stdout, "");
  assert.equal(spawnSync("node", ["scripts/claude-hooks.mjs", "lectura"], { cwd: raiz, input: "no es json" }).status, 0);
});

test("the project registers the hooks and the npm scripts", () => {
  const settings = JSON.parse(readFileSync(new URL("../.claude/settings.json", import.meta.url), "utf8"));
  const pre = settings.hooks.PreToolUse as { matcher: string; hooks: { command: string }[] }[];
  const de = (m: string) => pre.find((h) => h.matcher.split("|").includes(m))?.hooks[0].command ?? "";
  assert.match(de("Read"), /claude-hooks\.mjs" lectura$/);
  for (const m of ["Edit", "Write", "MultiEdit"]) assert.match(de(m), /claude-hooks\.mjs" edicion$/);
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts.verificar, "node scripts/verificar.mjs");
  assert.equal(pkg.scripts.subir, "node scripts/subir.mjs");
});

test("remote and duration helpers", () => {
  assert.equal(repoDesdeRemoto("https://github.com/pechiberman-alt/alt-radar-pro"), "pechiberman-alt/alt-radar-pro");
  assert.equal(repoDesdeRemoto("git@github.com:pechiberman-alt/alt-radar-pro.git"), "pechiberman-alt/alt-radar-pro");
  assert.equal(repoDesdeRemoto("http://proxy@127.0.0.1:1234/git/pechiberman-alt/alt-radar-pro/"), "pechiberman-alt/alt-radar-pro");
  assert.equal(duracion(42_400), "42 s");
  assert.equal(duracion(185_000), "3 min 05 s");
});

test("subir no suma archivos nuevos sin verlos: los lista y pide --incluir-nuevos", () => {
  const sin = revisarArchivosNuevos("docs/nuevo.md\n\n  lib/otro.ts  \n");
  assert.deepEqual(sin.nuevos, ["docs/nuevo.md", "lib/otro.ts"]);
  assert.equal(sin.error, "hay 2 archivos nuevos sin seguimiento: docs/nuevo.md, lib/otro.ts. Si son parte del cambio, repetí con --incluir-nuevos; si no, sacalos o agregalos a .gitignore.");
  assert.deepEqual(revisarArchivosNuevos("docs/nuevo.md\n", true), { nuevos: ["docs/nuevo.md"], error: null });
  assert.deepEqual(revisarArchivosNuevos(""), { nuevos: [], error: null });
  assert.match(revisarArchivosNuevos("uno.txt").error ?? "", /^hay 1 archivo nuevo sin seguimiento: uno\.txt\./);
});

test("el aviso de archivos nuevos nombra hasta 15 y cuenta el resto", () => {
  const lista = Array.from({ length: 17 }, (_, i) => `scratch/${i}.txt`).join("\n");
  const r = revisarArchivosNuevos(lista);
  assert.match(r.error ?? "", /^hay 17 archivos nuevos sin seguimiento: scratch\/0\.txt, .*scratch\/14\.txt y 2 más\./);
  assert.doesNotMatch(r.error ?? "", /scratch\/15\.txt/);
});
