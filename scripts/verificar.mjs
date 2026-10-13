/**
 * npm run verificar: todo lo que tiene que pasar antes de subir un cambio, con salida corta (una línea por paso y
 * solo el detalle de lo que falla): mapa de la araña, lint, tests, tsc y build. Deja lib/build-info.ts como estaba
 * y anota en .git/ el árbol que pasó, para que `npm run subir` se niegue a subir algo distinto de lo verificado.
 * `--rapido` saltea tsc y build mientras se itera (no habilita subir). Sale con 1 si algo falla.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, rmSync, writeFileSync } from "node:fs";
import {
  arbolActual, archivoVerificado, duracion, filtrarTsc, resumirLint, resumirTests, ultimasLineas,
} from "./herramientas.mjs";

const rapido = process.argv.includes("--rapido");
const inicio = Date.now();
const fallaron = [];

function correr(cmd, args) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } });
  return { ok: r.status === 0, salida: `${r.stdout ?? ""}\n${r.stderr ?? ""}`, ms: Date.now() - t0 };
}

function informar(nombre, ok, texto, detalle = []) {
  console.log(`${ok ? "✓" : "✗"} ${texto}`);
  if (!ok) {
    fallaron.push(nombre);
    for (const l of detalle) console.log(`  ${l}`);
  }
}

// La araña primero: regenera el mapa y después lo controla (objetivos, secretos en el navegador).
const mapa = correr("node", ["scripts/arana.mjs"]);
const control = mapa.ok ? correr("node", ["scripts/arana.mjs", "--check"]) : mapa;
informar("araña", mapa.ok && control.ok, mapa.ok && control.ok ? "araña al día" : "araña", ultimasLineas(control.salida, 20));

const lint = correr("npm", ["run", "-s", "lint"]);
const l = resumirLint(lint.salida);
informar("lint", lint.ok, lint.ok ? `lint${l.avisos ? ` (${l.avisos} avisos)` : ""}` : `lint: ${l.errores} errores`, l.lineas);

const archivos = readdirSync("tests").filter((f) => f.endsWith(".test.ts")).sort().map((f) => `tests/${f}`);
const tests = correr("node", ["--test", "--test-reporter=spec", ...archivos]);
const t = resumirTests(tests.salida);
const cuenta = t.total === null ? "no terminaron" : `${t.pass}/${t.total}${t.cancelled ? ` · ${t.cancelled} cancelados` : ""}`;
informar("tests", tests.ok, `tests ${cuenta} · ${duracion(tests.ms)}`, t.fallas);

if (!rapido) {
  const tsc = correr("node_modules/.bin/tsc", ["--noEmit", "-p", ".", "--pretty", "false"]);
  const f = filtrarTsc(tsc.salida);
  const sinErrores = f.cantidad === 0 && (tsc.ok || f.esperados > 0);
  informar("tsc", sinErrores, sinErrores ? `tsc${f.esperados ? ` (${f.esperados} esperado en vite.config.ts)` : ""}` : `tsc: ${f.cantidad} errores`, f.cantidad ? f.errores : ultimasLineas(tsc.salida, 20));

  const build = correr("npm", ["run", "-s", "build"]);
  spawnSync("git", ["checkout", "--", "lib/build-info.ts"]);
  informar("build", build.ok, `build · ${duracion(build.ms)}`, ultimasLineas(build.salida, 40));
}

const destino = archivoVerificado();
if (fallaron.length) {
  rmSync(destino, { force: true });
  console.log(`✗ falló: ${fallaron.join(", ")} · ${duracion(Date.now() - inicio)}`);
  process.exit(1);
}
const arbol = arbolActual();
writeFileSync(destino, JSON.stringify({ arbol, rapido, at: new Date().toISOString() }));
console.log(`verificado${rapido ? " rápido (sin tsc ni build: no alcanza para subir)" : ""} · ${duracion(Date.now() - inicio)} · árbol ${arbol.slice(0, 7)}`);
