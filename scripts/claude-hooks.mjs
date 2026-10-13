/**
 * Hooks de Claude Code de este repo (los registra .claude/settings.json). «lectura» frena leer entero un archivo de
 * texto de más de 600 líneas: se lee por partes o se pide la ficha a la araña, que cuesta mucho menos contexto.
 * «edicion» frena tocar archivos de secretos y pide confirmación para workflows y wrangler, como dice CLAUDE.md.
 * Recibe el evento por stdin (JSON); frena con código 2 y el motivo en stderr, o pide permiso con un JSON.
 */
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { decidirEdicion, decidirLectura } from "./herramientas.mjs";

const modo = process.argv[2];
let entrada = "";
for await (const trozo of process.stdin) entrada += trozo;
let evento = null;
try {
  evento = JSON.parse(entrada);
} catch {
  process.exit(0);
}
const raiz = process.env.CLAUDE_PROJECT_DIR || evento?.cwd || process.cwd();
const datos = evento?.tool_input ?? {};
const ruta = datos.file_path ?? datos.notebook_path;
if (typeof ruta !== "string" || !ruta) process.exit(0);
const abs = isAbsolute(ruta) ? ruta : resolve(raiz, ruta);
const rel = relative(raiz, abs).split("\\").join("/");

function contarLineas(archivo) {
  if (/\.(ipynb|pdf|png|jpe?g|gif|webp|bmp|ico)$/i.test(archivo)) return 0;
  const st = statSync(archivo);
  if (!st.isFile() || st.size > 50_000_000) return 0;
  const b = readFileSync(archivo);
  if (b.subarray(0, 8000).includes(0)) return 0; // binario
  let n = 0;
  for (let i = b.indexOf(10); i !== -1; i = b.indexOf(10, i + 1)) n++;
  return n;
}

if (modo === "lectura") {
  let lineas = 0;
  try {
    lineas = contarLineas(abs);
  } catch {
    process.exit(0);
  }
  const motivo = decidirLectura({ rel, lineas, offset: datos.offset, limit: datos.limit });
  if (motivo) {
    process.stderr.write(`${motivo}\n`);
    process.exit(2);
  }
} else if (modo === "edicion") {
  const d = decidirEdicion(rel);
  if (d?.tipo === "frenar") {
    process.stderr.write(`${d.motivo}\n`);
    process.exit(2);
  }
  if (d?.tipo === "preguntar") {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: d.motivo },
    }));
  }
}
process.exit(0);
