/**
 * Herramientas para trabajar en el repo gastando pocos tokens: el resumen corto de lint, tests, tsc y build que
 * imprime `npm run verificar`, el control de secretos y archivos protegidos de `npm run subir` y las decisiones de
 * los hooks de Claude Code (scripts/claude-hooks.mjs). Casi todo es puro (sin red ni disco) para poder probarlo;
 * lo único que toca git es `arbolActual`, que usa un índice aparte y nunca el del repo.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

/** Un archivo de texto con más líneas que esto no se lee entero sin pedirlo (offset/limit). */
export const MAX_LINEAS_LECTURA = 600;
/** Cuántas líneas de detalle se muestran de un paso que falla. */
export const MAX_LINEAS_FALLA = 60;

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, "g");
export const quitarAnsi = (s) => String(s).replace(ANSI, "");

export function duracion(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

/** Las últimas n líneas con texto. */
export function ultimasLineas(texto, n) {
  return quitarAnsi(texto).split("\n").map((l) => l.trimEnd()).filter(Boolean).slice(-n);
}

/**
 * El reporte «spec» de `node --test`, resumido: totales y, si algo falla, solo las fallas, sin los marcos internos
 * de node (los que apuntan a los archivos de tests quedan). Sin totales, el proceso se cayó: van las últimas líneas.
 */
export function resumirTests(salida) {
  const t = quitarAnsi(salida);
  const num = (k) => {
    const m = t.match(new RegExp(`^ℹ ${k} (\\d+)`, "m"));
    return m ? Number(m[1]) : null;
  };
  const total = num("tests");
  /** @type {{ total: number | null, pass: number | null, fail: number | null, cancelled: number | null, fallas: string[] }} */
  const resumen = { total, pass: num("pass"), fail: num("fail"), cancelled: num("cancelled"), fallas: [] };
  const marca = "✖ failing tests:";
  const i = t.indexOf(marca);
  if (i >= 0) {
    resumen.fallas = t.slice(i + marca.length).split("\n").map((l) => l.trimEnd())
      .filter((l) => l && !/^\s*at .*(node:|node_modules|\(native\)|\(index \d+\))/.test(l))
      .slice(0, MAX_LINEAS_FALLA);
  } else if (total === null) {
    resumen.fallas = ultimasLineas(t, 40);
  }
  return resumen;
}

/** eslint (formato stylish): errores, avisos y las primeras líneas del detalle. */
export function resumirLint(salida) {
  const t = quitarAnsi(salida);
  const m = t.match(/✖ (\d+) problems? \((\d+) errors?, (\d+) warnings?\)/);
  const lineas = t.split("\n").map((l) => l.trimEnd()).filter((l) => l && !l.startsWith(">"));
  return { errores: m ? Number(m[2]) : 0, avisos: m ? Number(m[3]) : 0, lineas: lineas.slice(0, MAX_LINEAS_FALLA) };
}

/**
 * Errores de `tsc --pretty false` agrupados (la línea del error y las que siguen indentadas), sin los esperados:
 * CLAUDE.md dice que el único que se espera es el de vite.config.ts.
 */
export function filtrarTsc(salida, esperados = ["vite.config.ts"]) {
  const grupos = [];
  for (const linea of quitarAnsi(salida).split("\n")) {
    if (/^\S.*\(\d+,\d+\): error TS\d+/.test(linea) || /^error TS\d+/.test(linea)) grupos.push([linea]);
    else if (linea.trim() && grupos.length) grupos[grupos.length - 1].push(linea.trimEnd());
  }
  const esperado = (g) => esperados.some((f) => g[0].startsWith(`${f}(`) || g[0].startsWith(`./${f}(`));
  const quedan = grupos.filter((g) => !esperado(g));
  return { esperados: grupos.length - quedan.length, cantidad: quedan.length, errores: quedan.flat().slice(0, MAX_LINEAS_FALLA) };
}

/** Archivos que no se suben ni se editan desde acá: claves y variables de entorno (las plantillas .example sí). */
export function archivoDeSecretos(ruta) {
  const base = String(ruta).split("/").pop() ?? "";
  if (/\.(example|sample|template)$/.test(base)) return false;
  return /^\.env(\..+)?$/.test(base) || /^\.dev\.vars(\..+)?$/.test(base)
    || /\.(pem|key|p12|pfx)$/.test(base) || /^id_(rsa|ed25519|ecdsa)$/.test(base);
}

/** CLAUDE.md: los workflows y la configuración de wrangler solo se tocan con un pedido explícito. */
export function archivoProtegido(ruta) {
  const r = String(ruta).replace(/^\.\//, "");
  const base = r.split("/").pop() ?? "";
  return r.startsWith(".github/workflows/") || /^wrangler.*\.jsonc?$/.test(base);
}

const PATRONES_SECRETO = [
  ["clave privada", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["token de GitHub", /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}/],
  ["clave de Anthropic", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["clave de OpenAI", /\bsk-(proj-)?[A-Za-z0-9]{32,}/],
  ["clave de Groq", /\bgsk_[A-Za-z0-9]{40,}/],
  ["clave de AWS", /\bAKIA[0-9A-Z]{16}\b/],
  ["token de Slack", /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ["token de bot de Telegram", /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/],
  ["token de Cloudflare", /\b(CLOUDFLARE_API_TOKEN|CF_API_TOKEN)\s*[=:]\s*["']?[A-Za-z0-9_-]{40}\b/],
];

/** Líneas agregadas de un `git diff -U0` que parecen un secreto, con archivo y número de línea. */
export function buscarSecretos(diff) {
  const hallados = [];
  let archivo = null;
  let linea = 0;
  for (const l of String(diff).split("\n")) {
    if (l.startsWith("+++ ")) {
      archivo = l.slice(4).replace(/^b\//, "");
      continue;
    }
    const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (h) {
      linea = Number(h[1]);
      continue;
    }
    if (archivo && l.startsWith("+")) {
      for (const [tipo, re] of PATRONES_SECRETO) if (re.test(l)) hallados.push({ archivo, linea, tipo });
      linea++;
    }
  }
  return hallados;
}

/**
 * Hook de lectura: un archivo largo leído entero sin pedirlo gasta miles de tokens; se frena con el camino barato.
 * @param {{ rel?: string, lineas: number, offset?: number | null, limit?: number | null }} p
 */
export function decidirLectura({ rel, lineas, offset, limit }) {
  if (offset != null || limit != null || lineas <= MAX_LINEAS_LECTURA) return null;
  const enRepo = Boolean(rel) && !rel.startsWith("..") && !rel.startsWith("/");
  const ficha = enRepo ? `, pedí la ficha (npm run arana -- --archivo ${rel})` : "";
  return `${rel || "El archivo"} tiene ${lineas} líneas: leelo por partes con offset/limit, buscá con Grep${ficha} o, si de verdad lo necesitás entero, repetí la lectura con limit.`;
}

/** Hook de edición: los secretos no se tocan; workflows y wrangler piden confirmación. */
export function decidirEdicion(rel) {
  if (archivoDeSecretos(rel)) return { tipo: "frenar", motivo: `${rel} guarda secretos: no se edita desde acá (CLAUDE.md: nunca commitear claves).` };
  if (archivoProtegido(rel)) return { tipo: "preguntar", motivo: `${rel}: CLAUDE.md dice que no se toca salvo pedido explícito.` };
  return null;
}

/**
 * Los archivos nuevos sin seguimiento que `subir` sumaría con `git add -A` (salida de `git ls-files --others
 * --exclude-standard`). Sin `incluir`, frena y los lista: nada entra al commit sin que se vea. Pura.
 */
export function revisarArchivosNuevos(salidaGit, incluir = false) {
  const nuevos = String(salidaGit).split("\n").map((l) => l.trim()).filter(Boolean);
  if (!nuevos.length || incluir) return { nuevos, error: null };
  const cuantos = nuevos.length === 1 ? "hay 1 archivo nuevo sin seguimiento" : `hay ${nuevos.length} archivos nuevos sin seguimiento`;
  const muestra = nuevos.slice(0, 15).join(", ");
  const resto = nuevos.length > 15 ? ` y ${nuevos.length - 15} más` : "";
  return {
    nuevos,
    error: `${cuantos}: ${muestra}${resto}. Si son parte del cambio, repetí con --incluir-nuevos; si no, sacalos o agregalos a .gitignore.`,
  };
}

/** «dueño/repo» del remoto, sea https, ssh o detrás de un proxy. */
export function repoDesdeRemoto(url) {
  const m = String(url).trim().match(/[/:]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * El árbol de git del directorio de trabajo tal como está (archivos nuevos incluidos, lo ignorado no), calculado
 * con un índice propio en .git/ para no tocar lo que está en stage. Si dos llamadas dan lo mismo, no cambió nada.
 */
export function arbolActual(cwd = process.cwd()) {
  const gitDir = execFileSync("git", ["rev-parse", "--git-dir"], { cwd, encoding: "utf8" }).trim();
  const env = { ...process.env, GIT_INDEX_FILE: resolve(cwd, gitDir, "verificar-index") };
  execFileSync("git", ["read-tree", "HEAD"], { cwd, env });
  execFileSync("git", ["add", "-A"], { cwd, env });
  return execFileSync("git", ["write-tree"], { cwd, env, encoding: "utf8" }).trim();
}

/** Dónde queda anotado el último árbol que pasó `npm run verificar` (dentro de .git: nunca se commitea). */
export function archivoVerificado(cwd = process.cwd()) {
  const gitDir = execFileSync("git", ["rev-parse", "--git-dir"], { cwd, encoding: "utf8" }).trim();
  return resolve(cwd, gitDir, "verificado.json");
}
