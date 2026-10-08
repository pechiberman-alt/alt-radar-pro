#!/usr/bin/env node
/**
 * La araña: the project map of ALT RADAR PRO. It answers questions without
 * anyone reading the whole repo, which saves tokens for people and for AIs.
 *
 * It reads the code offline (no network, no dependencies) and assigns every
 * file to an objective from docs/araña/objetivos.md. It writes:
 *   docs/araña/MAPA.md      the map: objectives, files, exports, imports, tables, secrets, routes
 *   docs/araña/huellas.txt  a fingerprint per file, to tell what changed since the last map
 *
 * The reading is static: imports built at run time are not seen.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DOCS = "docs/araña";
export const OBJETIVOS = `${DOCS}/objetivos.md`;
export const MAPA = `${DOCS}/MAPA.md`;
export const HUELLAS = `${DOCS}/huellas.txt`;

// Generated or heavy files: never indexed.
const NO_INDEXAR = new Set(["lib/build-info.ts", "worker-configuration.d.ts", "tsconfig.tsbuildinfo", "package-lock.json", MAPA, HUELLAS]);
const CARPETAS_EXCLUIDAS = new Set(["node_modules", ".git", "dist", ".next", ".vinext", ".wrangler", "coverage", "out"]);
const CODIGO = /\.(?:ts|tsx|js|mjs|cjs)$/;
const TEXTO = /\.(?:ts|tsx|js|mjs|cjs|css|md|json|jsonc|sql|yml|yaml|txt|html|toml)$/;
const STOP = new Set(["de", "del", "la", "las", "el", "los", "en", "y", "o", "al", "un", "una", "unos", "unas", "para", "por", "con", "sin", "que", "como", "se", "su", "sus", "lo", "es", "hay", "mi", "mis", "the", "and", "of", "to", "in", "for", "is", "how", "what"]);
// Words that follow TABLE, FROM or INTO in English prose: they are not table names.
const PALABRAS_NO_TABLA = new Set(["and", "or", "not", "if", "exists", "the", "a", "an", "of", "to", "in", "on", "as", "is", "it", "its", "this", "that", "each", "all", "any", "some", "with", "for", "from", "select", "where", "set", "values", "table", "index", "into", "join", "update", "by", "at", "be", "no", "new", "your", "our", "their", "one", "two"]);
const HOSTS_IGNORADOS = /^(?:example\.(?:com|org)|w3\.org|schema\.org)$/;

export function norm(s) {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Lowercase words without accents, camelCase split: "Analizá BTC" → ["analiza", "btc"]. */
export function tokens(s) {
  return norm(s.replace(/([a-z0-9])([A-Z])/g, "$1 $2"))
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

const sha1 = (buf) => createHash("sha1").update(buf).digest("hex").slice(0, 12);

/** Reads docs/araña/objetivos.md: the synonyms, and the objectives in file order. */
export function parseObjetivos(md) {
  const sinonimos = new Map();
  const objetivos = [];
  let seccion = null;
  let actual = null;
  let campo = null;
  for (const linea of md.split(/\r?\n/)) {
    const h2 = linea.match(/^##\s+(.+)$/);
    if (h2) {
      const titulo = h2[1].trim();
      campo = null;
      if (/^sin[oó]nimos$/i.test(titulo)) {
        seccion = "sinonimos";
        actual = null;
        continue;
      }
      const obj = titulo.match(/^(\S+)\s+—\s+(.+)$/u);
      if (!obj) {
        seccion = null;
        actual = null;
        continue;
      }
      if (objetivos.some((o) => o.slug === obj[1])) throw new Error(`objetivos.md: el objetivo «${obj[1]}» está repetido`);
      actual = { slug: obj[1], titulo: obj[2].trim(), texto: "", globs: [], transversal: false, reglas: [], pendiente: [], archivosVisto: false };
      objetivos.push(actual);
      seccion = "objetivo";
      continue;
    }
    if (seccion === "sinonimos") {
      const m = linea.match(/^([^:\s]+):\s*(.+)$/);
      if (!m) continue;
      const grupo = [m[1], ...m[2].split(",")].map((x) => norm(x.trim())).filter(Boolean);
      for (const palabra of grupo) {
        const set = sinonimos.get(palabra) ?? new Set();
        for (const x of grupo) set.add(x);
        sinonimos.set(palabra, set);
      }
      continue;
    }
    if (seccion !== "objetivo" || !actual) continue;
    const nuevo = linea.match(/^(Texto|Archivos|Reglas|Pendiente):\s*(.*)$/);
    if (nuevo) {
      const [, clave, valor] = nuevo;
      campo = clave === "Reglas" ? "reglas" : clave === "Pendiente" ? "pendiente" : null;
      if (clave === "Texto") actual.texto = valor.trim();
      if (clave === "Archivos") {
        // "—" means the objective cuts across the product and owns no files of its own.
        actual.archivosVisto = true;
        actual.transversal = /^[—-]$/.test(valor.trim());
        actual.globs = actual.transversal ? [] : valor.split(",").map((g) => g.trim()).filter(Boolean);
      }
      continue;
    }
    const item = linea.match(/^-\s+(.+)$/);
    if (item && campo) actual[campo].push(item[1].trim());
  }
  for (const o of objetivos) {
    if (!o.texto) throw new Error(`objetivos.md: «${o.slug}» no tiene Texto:`);
    if (!o.archivosVisto) throw new Error(`objetivos.md: «${o.slug}» no tiene Archivos: (usá «—» si es transversal)`);
    if (!o.transversal && !o.globs.length) throw new Error(`objetivos.md: «${o.slug}» tiene Archivos: vacío`);
  }
  return { sinonimos, objetivos };
}

/** `*` stays inside one folder, `**` goes through any number of them. */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "u");
}

/** The first objective, in file order, with a glob that matches the path: specific before general. */
export function objetivoDe(path, objetivos) {
  for (const o of objetivos) if (o.regs.some((re) => re.test(path))) return o.slug;
  return null;
}

function recorrer(root, dir) {
  const salida = [];
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!CARPETAS_EXCLUIDAS.has(e.name)) salida.push(...recorrer(root, rel));
    } else if (e.isFile()) salida.push(rel);
  }
  return salida;
}

/** The files the map covers: what git knows and does not ignore; a plain walk when there is no git. */
export function listarArchivos(root = ROOT) {
  let rutas;
  try {
    rutas = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 256 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean);
  } catch {
    rutas = recorrer(root, "");
  }
  return [...new Set(rutas)]
    .filter((p) => !NO_INDEXAR.has(p) && !p.split("/").slice(0, -1).some((s) => CARPETAS_EXCLUIDAS.has(s)))
    .filter((p) => existsSync(join(root, p)) && statSync(join(root, p)).isFile())
    .sort();
}

/** Reads every listed file: its text when it is code or docs, and its fingerprint always. */
export function leerArchivos(root, rutas) {
  return rutas.map((path) => {
    const buf = readFileSync(join(root, path));
    return { path, bytes: buf.length, hash: sha1(buf), texto: TEXTO.test(path) ? buf.toString("utf8") : null };
  });
}

function quitarDirectivas(t) {
  return t.replace(/^\s*(?:(["'])use (?:client|server)\1;?\s*)+/, "");
}

/** The leading comment of a code file, without its markers. */
function comentarioInicial(t) {
  let resto = quitarDirectivas(t).trimStart();
  while (resto.startsWith("/*")) {
    const fin = resto.indexOf("*/");
    if (fin < 0) break;
    const texto = resto
      .slice(2, fin)
      .split("\n")
      .map((l) => l.replace(/^\s*\*?\s?/, "").trimEnd())
      .join("\n")
      .trim();
    resto = resto.slice(fin + 2).trimStart();
    if (!/^(?:eslint|@ts-|prettier|istanbul|biome|@vitest)/.test(texto)) return texto;
  }
  if (resto.startsWith("//")) {
    const lineas = [];
    for (const l of resto.split("\n")) {
      if (!l.trim().startsWith("//")) break;
      lineas.push(l.trim().replace(/^\/\/\s?/, ""));
    }
    return lineas.join("\n");
  }
  return "";
}

/** The first sentence of the first paragraph: what the file is for. */
export function primeraFrase(texto) {
  const parrafo = texto.split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();
  const frase = parrafo.match(/^.*?[.!?](?=\s|$)/);
  return (frase ? frase[0] : parrafo).slice(0, 180);
}

function resumenMarkdown(t) {
  const lineas = t.split("\n").map((l) => l.trim());
  const titulo = lineas.find((l) => /^#\s+/.test(l));
  const primera = lineas.find((l) => l && !l.startsWith("#") && !l.startsWith("---"));
  return (titulo ? titulo.replace(/^#\s+/, "") : primera ?? "").slice(0, 180);
}

export function exportesDe(t) {
  const nombres = new Set();
  const decl = /^export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm;
  for (const m of t.matchAll(decl)) nombres.add(m[1]);
  if (/^export\s+default\b/m.test(t)) nombres.add("default");
  for (const m of t.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)) {
    for (const parte of m[1].split(",")) {
      const nombre = parte.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop();
      if (nombre) nombres.add(nombre.trim());
    }
  }
  for (const m of t.matchAll(/^export\s+\*(?:\s+as\s+([\w$]+))?\s+from/gm)) nombres.add(`* ${m[1] ?? ""}`.trim());
  return [...nombres];
}

/** Module specifiers loaded at run time. Type-only imports are erased, so they are skipped. */
export function importesDe(t) {
  const salida = [];
  for (const m of t.matchAll(/\b(import|export)\s+(type\s+)?([^;'"`]*?)\bfrom\s*["']([^"'\n]+)["']/g)) {
    const soloTipos = (m[2] && m[2].trim() === "type") || /^\s*type\b/.test(m[3]);
    if (!soloTipos) salida.push(m[4]);
  }
  for (const m of t.matchAll(/\bimport\s*["']([^"'\n]+)["']/g)) salida.push(m[1]);
  for (const m of t.matchAll(/\bimport\(\s*["']([^"'\n]+)["']\s*\)/g)) salida.push(m[1]);
  return [...new Set(salida)];
}

export function secretosDe(t) {
  const vistos = new Map();
  for (const m of t.matchAll(/\b(get|set|delete)Secret\(\s*[^,()]+,\s*[^,()]+,\s*["'`]([a-z0-9_.-]+)["'`]/gi)) {
    const accion = m[1].toLowerCase() === "get" ? "lee" : m[1].toLowerCase() === "set" ? "guarda" : "borra";
    vistos.set(`${accion}:${m[2]}`, { nombre: m[2], accion });
  }
  return [...vistos.values()];
}

export function variablesDe(t) {
  return [...new Set([...t.matchAll(/\benv\.([A-Z][A-Z0-9_]{2,})\b/g)].map((m) => m[1]))];
}

export function hostsDe(t) {
  const hosts = new Set([...t.matchAll(/https?:\/\/((?:[a-z0-9-]+\.)+[a-z]{2,})/gi)].map((m) => m[1].toLowerCase()));
  return [...hosts].filter((h) => !HOSTS_IGNORADOS.test(h));
}

export function tablasDe(t) {
  const crea = new Set();
  for (const m of t.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?([a-z_][a-z0-9_]*)/gi)) crea.add(m[1].toLowerCase());
  for (const m of t.matchAll(/sqliteTable\(\s*["'`]([a-z_][a-z0-9_]*)["'`]/g)) crea.add(m[1]);
  const indices = [];
  for (const m of t.matchAll(/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?([a-z_][a-z0-9_]*)[`"']?\s+ON\s+[`"']?([a-z_][a-z0-9_]*)/gi)) {
    indices.push({ indice: m[1].toLowerCase(), tabla: m[2].toLowerCase() });
  }
  const menciones = new Set([...t.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN|TABLE)\s+[`"']?([a-z_][a-z0-9_]*)/gi)].map((m) => m[1].toLowerCase()));
  const esPalabra = (n) => !PALABRAS_NO_TABLA.has(n);
  return { crea: [...crea].filter(esPalabra), indices, menciones: [...menciones].filter(esPalabra) };
}

/** An API route file: its path under /api and the methods it exports. */
export function rutaDe(path, t) {
  const m = path.match(/^app\/api(?:\/(.+))?\/route\.(?:ts|tsx|js|mjs)$/);
  if (!m) return null;
  const verbos = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b|export\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
  const metodos = [...new Set([...t.matchAll(verbos)].map((x) => x[1] ?? x[2]))];
  return { ruta: m[1] ? `/api/${m[1]}` : "/api", metodos };
}

export function pruebasDe(t) {
  return [...t.matchAll(/\b(?:test|it)\(\s*["'`]([^"'`\n]+)["'`]/g)].map((m) => m[1].trim().slice(0, 80));
}

/** Everything one file says about itself, read once. Imports are resolved later, with the whole list. */
export function analizar(archivo) {
  const { path, bytes, hash, texto } = archivo;
  const info = {
    path,
    bytes,
    hash,
    lineas: 0,
    objetivo: null,
    resumen: "",
    exporta: [],
    especificadores: [],
    importa: [],
    pruebas: [],
    secretos: [],
    variables: [],
    hosts: [],
    tablas: { crea: [], indices: [], menciones: [] },
    ruta: null,
    cliente: false,
    esPrueba: /\.test\.(?:ts|tsx|js|mjs)$/.test(path),
    usadoPor: [],
    probadoPor: [],
    pruebaDe: [],
  };
  if (texto === null) return info;
  info.lineas = texto.split("\n").length;
  if (path.endsWith(".md")) {
    info.resumen = resumenMarkdown(texto);
    return info;
  }
  info.resumen = primeraFrase(comentarioInicial(texto));
  if (!CODIGO.test(path)) return info;
  info.cliente = /^(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*["']use client["']/.test(texto);
  info.exporta = exportesDe(texto);
  info.especificadores = importesDe(texto);
  info.secretos = secretosDe(texto);
  info.variables = variablesDe(texto);
  info.hosts = hostsDe(texto);
  info.tablas = tablasDe(texto);
  info.ruta = rutaDe(path, texto);
  if (info.esPrueba) {
    // A test writes fixtures with secret names and variables; they are not what the app reads.
    info.pruebas = pruebasDe(texto).slice(0, 4);
    info.secretos = [];
    info.variables = [];
  }
  return info;
}

const RESOLUCION = [".ts", ".tsx", ".mjs", ".js", ".d.ts", ".css", ".json", "/index.ts", "/index.tsx", "/index.js"];

/** The repo file a specifier points to, or null for a package or a file that is not there. */
export function resolverLocal(desde, spec, rutas) {
  let base;
  if (spec.startsWith(".")) base = posix.normalize(posix.join(posix.dirname(desde), spec));
  else if (spec.startsWith("@/")) base = spec.slice(2);
  else return null;
  const candidatos = [base];
  if (/\.m?js$/.test(base)) candidatos.push(base.replace(/\.m?js$/, ".ts"), base.replace(/\.m?js$/, ".tsx"));
  for (const e of RESOLUCION) candidatos.push(base + e);
  return candidatos.find((c) => rutas.has(c)) ?? null;
}

function anadirUnico(lista, valor) {
  if (!lista.includes(valor)) lista.push(valor);
}

function sumar(mapa, clave, valor) {
  if (!mapa.has(clave)) mapa.set(clave, []);
  anadirUnico(mapa.get(clave), valor);
}

function cadenaDesde(padre, p) {
  const cadena = [p];
  for (let q = padre.get(p); q; q = padre.get(q)) cadena.unshift(q);
  return cadena;
}

/**
 * The whole picture: objectives, imports both ways, tables, secrets, routes, and
 * what the browser code can reach (the rule: no secrets and no API routes there).
 */
export function construirIndice(archivos, { sinonimos, objetivos: definidos }) {
  const infos = archivos.map(analizar).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const mapa = new Map(infos.map((f) => [f.path, f]));
  const rutas = new Set(mapa.keys());
  const objetivos = definidos.map((o) => ({ ...o, regs: o.globs.map(globToRegExp), archivos: [], patrones: [] }));

  for (const f of infos) {
    f.objetivo = objetivoDe(f.path, objetivos);
    if (f.objetivo) objetivos.find((o) => o.slug === f.objetivo).archivos.push(f.path);
  }
  for (const o of objetivos) {
    o.patrones = o.globs.map((glob, i) => {
      const coinciden = infos.filter((f) => o.regs[i].test(f.path));
      return { glob, coincidencias: coinciden.length, tapado: coinciden.length > 0 && coinciden.every((f) => f.objetivo !== o.slug) };
    });
  }

  for (const f of infos) {
    for (const spec of f.especificadores) {
      const destino = resolverLocal(f.path, spec, rutas);
      if (destino && destino !== f.path) anadirUnico(f.importa, destino);
    }
    f.importa.sort();
  }
  for (const f of infos) {
    for (const dep of f.importa) {
      const destino = mapa.get(dep);
      if (f.esPrueba) {
        anadirUnico(destino.probadoPor, f.path);
        anadirUnico(f.pruebaDe, dep);
      } else anadirUnico(destino.usadoPor, f.path);
    }
  }
  for (const f of infos) {
    f.usadoPor.sort();
    f.probadoPor.sort();
    f.pruebaDe.sort();
  }

  const conocidas = new Set(infos.flatMap((f) => f.tablas.crea));
  const tablas = new Map();
  const tabla = (n) => {
    if (!tablas.has(n)) tablas.set(n, { crea: [], usa: [], indices: [] });
    return tablas.get(n);
  };
  for (const f of infos) {
    for (const n of f.tablas.crea) anadirUnico(tabla(n).crea, f.path);
    for (const n of f.tablas.menciones) if (conocidas.has(n)) anadirUnico(tabla(n).usa, f.path);
    for (const { indice, tabla: t } of f.tablas.indices) if (conocidas.has(t)) anadirUnico(tabla(t).indices, indice);
  }

  const secretos = new Map();
  const variables = new Map();
  const hosts = new Map();
  for (const f of infos) {
    for (const s of f.secretos) {
      if (!secretos.has(s.nombre)) secretos.set(s.nombre, { lee: [], guarda: [], borra: [] });
      anadirUnico(secretos.get(s.nombre)[s.accion], f.path);
    }
    for (const v of f.variables) sumar(variables, v, f.path);
    for (const h of f.hosts) sumar(hosts, h, f.path);
  }

  const rutasApi = infos
    .filter((f) => f.ruta)
    .map((f) => ({ ruta: f.ruta.ruta, archivo: f.path, metodos: f.ruta.metodos, objetivo: f.objetivo }))
    .sort((a, b) => (a.ruta < b.ruta ? -1 : a.ruta > b.ruta ? 1 : 0));

  // Browser code: the files that use "use client" and everything they load at run time.
  const raiz = infos.filter((f) => f.cliente).map((f) => f.path);
  const padre = new Map(raiz.map((p) => [p, null]));
  const cola = [...raiz];
  const problemas = [];
  for (let i = 0; i < cola.length; i++) {
    const p = cola[i];
    for (const dep of mapa.get(p).importa) {
      if (dep.startsWith("app/api/")) {
        problemas.push({ tipo: "api", archivo: p, detalle: `importa la ruta ${dep}`, cadena: cadenaDesde(padre, p) });
        continue;
      }
      if (!padre.has(dep)) {
        padre.set(dep, p);
        cola.push(dep);
      }
    }
  }
  for (const p of cola) {
    for (const s of mapa.get(p).secretos) {
      problemas.push({ tipo: "secreto", archivo: p, detalle: `${s.accion} el secreto «${s.nombre}»`, cadena: cadenaDesde(padre, p) });
    }
  }

  return {
    archivos: infos,
    mapa,
    sinonimos,
    objetivos,
    tablas,
    secretos,
    variables,
    hosts,
    rutas: rutasApi,
    cliente: { raiz, alcance: padre.size, problemas },
    sinObjetivo: infos.filter((f) => !f.objetivo).map((f) => f.path),
    libSinPrueba: infos.filter((f) => f.path.startsWith("lib/") && CODIGO.test(f.path) && f.probadoPor.length === 0).map((f) => f.path),
  };
}

const LIMITE = 6;

/** Up to `max` items joined, and how many were left out. */
export function lista(items, max = LIMITE) {
  if (!items.length) return "";
  const visibles = items.slice(0, max).join(", ");
  return items.length > max ? `${visibles} (+${items.length - max})` : visibles;
}

function tablasPorArchivo(index) {
  const salida = new Map();
  for (const [n, t] of index.tablas) for (const p of new Set([...t.crea, ...t.usa])) sumar(salida, p, n);
  return salida;
}

/** One line per file: its summary, or the test titles, or its exports. The rest is in --archivo and --ruta. */
function lineaDeArchivo(f) {
  const cabeza = `- \`${f.path}\``;
  if (f.resumen) return [`${cabeza} — ${f.resumen}`];
  if (f.pruebas.length) return [`${cabeza} — pruebas: ${lista(f.pruebas, 3)}`];
  if (f.exporta.length) return [`${cabeza} — exporta: ${lista(f.exporta, 6)}`];
  return [cabeza];
}

/** docs/araña/MAPA.md: deterministic, no dates, so a stale map shows as a diff. */
export function renderMapa(index) {
  const libs = index.archivos.filter((f) => f.path.startsWith("lib/") && CODIGO.test(f.path)).length;
  const out = [
    "# Mapa de ALT RADAR PRO",
    "",
    "> Lo escribe `npm run arana` (scripts/arana.mjs) desde el código y desde docs/araña/objetivos.md. No se edita a mano.",
    "> Lectura estática: los imports armados en tiempo de ejecución no aparecen.",
    "> Para no leer el repo entero: `npm run arana -- --buscar <tema>`, `--archivo <ruta>`, `--ruta <archivo>`, `--objetivo <nombre>`, `--tablas`, `--secretos`, `--cambios`, `--check`.",
    "",
    `- Archivos: ${index.archivos.length} · objetivos: ${index.objetivos.length} · sin objetivo: ${index.sinObjetivo.length}`,
    `- Tablas D1: ${index.tablas.size} · secretos: ${index.secretos.size} · variables de entorno: ${index.variables.size} · rutas /api: ${index.rutas.length} · hosts: ${index.hosts.size}`,
    `- Código de navegador: ${index.cliente.raiz.length} archivos con "use client" que alcanzan ${index.cliente.alcance} · problemas: ${index.cliente.problemas.length}`,
    `- Lib sin prueba directa: ${index.libSinPrueba.length} de ${libs}`,
    "",
    "## Objetivos",
    "",
  ];
  for (const o of index.objetivos) {
    out.push(`### ${o.slug} — ${o.titulo} (${o.archivos.length})`, `Texto: ${o.texto}`);
    if (o.pendiente.length) out.push(`Pendiente: ${o.pendiente.join(" · ")}`);
    for (const p of o.archivos) out.push(...lineaDeArchivo(index.mapa.get(p)));
    out.push("");
  }
  out.push("## Sin objetivo", "", ...(index.sinObjetivo.length ? index.sinObjetivo.map((p) => `- \`${p}\``) : ["- ninguno"]), "");
  out.push("## Tablas D1", "");
  for (const n of [...index.tablas.keys()].sort()) {
    const t = index.tablas.get(n);
    const indices = t.indices.length ? `índices: ${t.indices.join(", ")}` : "sin índice visible en el código";
    out.push(`- \`${n}\` — crea: ${lista(t.crea, 3) || "—"} · usa: ${lista(t.usa) || "—"} · ${indices}`);
  }
  out.push("", "## Secretos y variables de entorno", "");
  for (const n of [...index.secretos.keys()].sort()) {
    const s = index.secretos.get(n);
    const partes = [["lee", s.lee], ["guarda", s.guarda], ["borra", s.borra]].filter(([, v]) => v.length).map(([k, v]) => `${k}: ${lista(v, 4)}`);
    out.push(`- \`${n}\` (secreto) — ${partes.join(" · ")}`);
  }
  for (const v of [...index.variables.keys()].sort()) out.push(`- variable \`${v}\` — en: ${lista(index.variables.get(v), 4)}`);
  out.push("", "## Rutas /api", "");
  for (const r of index.rutas) out.push(`- \`${r.ruta}\` [${r.metodos.join(", ") || "sin método exportado"}] — ${r.archivo}${r.objetivo ? ` · ${r.objetivo}` : ""}`);
  out.push("", "## Hosts externos", "");
  for (const h of [...index.hosts.keys()].sort()) out.push(`- \`${h}\` — ${lista(index.hosts.get(h), 6)}`);
  out.push("", "## Código de navegador", "");
  out.push(`- Raíz ("use client"): ${lista(index.cliente.raiz, 80) || "ninguno"}`);
  if (index.cliente.problemas.length) {
    for (const pr of index.cliente.problemas) out.push(`- Problema: ${pr.archivo} ${pr.detalle} · ${pr.cadena.join(" → ")}`);
  } else out.push("- Problemas: ninguno");
  out.push("", "## Lib sin prueba directa", "", `- ${index.libSinPrueba.length ? index.libSinPrueba.map((p) => `\`${p}\``).join(", ") : "ninguno"}`);
  return `${out.join("\n")}\n`;
}

/** docs/araña/huellas.txt: one line per file, read by --cambios. */
export function renderHuellas(index) {
  const filas = index.archivos.map((f) => `${f.hash}\t${f.lineas}\t${f.path}`);
  return [
    "# Huellas de la araña: hash corto, líneas y ruta de cada archivo. Lo escribe npm run arana; lo lee --cambios.",
    ...filas,
  ].join("\n") + "\n";
}

/** The word and its synonyms, plus the singular of a plural: "alertas" → alerta, alert, notify… */
export function expandir(sinonimos, termino) {
  const set = new Set([termino]);
  const base = termino.endsWith("s") ? termino.slice(0, -1) : null;
  if (base) set.add(base);
  for (const x of sinonimos.get(termino) ?? []) set.add(x);
  if (base) for (const x of sinonimos.get(base) ?? []) set.add(x);
  return set;
}

// How much a match in each field is worth. The path says the most about a file.
const PESOS = { ruta: 6, exporta: 4, tablas: 4, resumen: 3, objetivo: 2, pruebas: 2 };

function camposDe(f, objetivo, tablasUso) {
  return {
    ruta: tokens(f.path),
    exporta: tokens(f.exporta.join(" ")),
    tablas: tokens([...tablasUso, ...f.secretos.map((s) => s.nombre), ...f.variables].join(" ")),
    resumen: tokens(f.resumen),
    objetivo: objetivo ? tokens(`${objetivo.slug} ${objetivo.titulo} ${objetivo.texto}`) : [],
    pruebas: tokens(f.pruebas.join(" ")),
  };
}

/** Ranks files for a topic, in Spanish or English, through the synonyms of the objectives file. */
export function buscar(index, consulta, limite = 12) {
  const terminos = [...new Set(tokens(consulta))].filter((t) => !STOP.has(t));
  const expansiones = terminos.map((termino) => ({ termino, set: expandir(index.sinonimos, termino) }));
  const tablasDe = tablasPorArchivo(index);
  const resultados = [];
  for (const f of index.archivos) {
    const objetivo = index.objetivos.find((o) => o.slug === f.objetivo);
    const campos = camposDe(f, objetivo, tablasDe.get(f.path) ?? []);
    let puntaje = 0;
    for (const { set } of expansiones) {
      let mejor = 0;
      for (const [campo, toks] of Object.entries(campos)) if (toks.some((t) => set.has(t))) mejor = Math.max(mejor, PESOS[campo]);
      puntaje += mejor;
    }
    if (puntaje > 0) resultados.push({ f, puntaje });
  }
  resultados.sort((a, b) => b.puntaje - a.puntaje || (a.f.path < b.f.path ? -1 : a.f.path > b.f.path ? 1 : 0));
  const porObjetivo = index.objetivos
    .map((o) => {
      const toks = new Set(tokens(`${o.slug} ${o.titulo} ${o.texto}`));
      return { slug: o.slug, hits: expansiones.filter(({ set }) => [...set].some((t) => toks.has(t))).length };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  return {
    terminos: expansiones,
    resultados: resultados.slice(0, limite),
    total: resultados.length,
    objetivo: porObjetivo[0]?.slug ?? null,
  };
}

export function textoBusqueda(index, consulta) {
  if (!tokens(consulta).some((t) => !STOP.has(t))) return "Decime qué buscás: por ejemplo `--buscar voz` o `--buscar alertas de precio`.";
  const r = buscar(index, consulta);
  const sinonimos = r.terminos.map(({ termino, set }) => {
    const otros = [...set].filter((x) => x !== termino);
    return otros.length ? `${termino} (${lista(otros, 8)})` : termino;
  });
  const out = [`Buscar «${consulta}»: ${sinonimos.join(" · ")}`];
  if (!r.resultados.length) {
    out.push("Nada. Probá otra palabra o agregá el sinónimo en docs/araña/objetivos.md.");
    return out.join("\n");
  }
  r.resultados.forEach(({ f }, i) => {
    const detalle = f.resumen ? f.resumen.slice(0, 110) : f.pruebas.length ? `pruebas: ${lista(f.pruebas, 2)}` : `exporta: ${lista(f.exporta, 4) || "nada"}`;
    out.push(`${String(i + 1).padStart(2)}. ${f.path} [${f.objetivo ?? "sin objetivo"}] ${detalle}`);
  });
  if (r.total > r.resultados.length) out.push(`… y ${r.total - r.resultados.length} más. Afiná la búsqueda o usá --objetivo.`);
  if (r.objetivo) out.push(`Objetivo que más calza: ${r.objetivo} (--objetivo ${r.objetivo})`);
  return out.join("\n");
}

/** Resolves a path typed in full, or a part of it, ignoring accents: "arana" finds docs/araña. */
export function buscarArchivo(index, texto) {
  const t = norm(texto.replace(/^\.\//, ""));
  const exacto = index.mapa.get(texto.replace(/^\.\//, ""));
  if (exacto) return [exacto];
  return index.archivos.filter((f) => norm(f.path).includes(t));
}

export function textoArchivo(index, f) {
  const tablas = tablasPorArchivo(index).get(f.path) ?? [];
  const out = [f.path, `  objetivo: ${f.objetivo ?? "sin objetivo"} · ${f.lineas} líneas · huella ${f.hash}`];
  if (f.resumen) out.push(`  resumen: ${f.resumen}`);
  out.push(`  exporta: ${lista(f.exporta, 60) || "nada"}`);
  out.push(`  importa: ${lista(f.importa, 60) || "nada del repo"}`);
  out.push(`  lo usan: ${lista(f.usadoPor, 60) || "nadie lo importa"}`);
  if (f.esPrueba) out.push(`  prueba a: ${lista(f.pruebaDe, 20) || "ningún archivo"} · pruebas: ${lista(f.pruebas, 6) || "—"}`);
  else out.push(`  lo prueban: ${lista(f.probadoPor, 20) || "ningún test lo importa"}`);
  if (tablas.length) out.push(`  tablas: ${tablas.join(", ")}`);
  if (f.secretos.length) out.push(`  secretos: ${[...new Set(f.secretos.map((s) => `${s.nombre} (${s.accion})`))].join(", ")}`);
  if (f.variables.length) out.push(`  variables: ${f.variables.join(", ")}`);
  if (f.hosts.length) out.push(`  hosts: ${f.hosts.join(", ")}`);
  if (f.ruta) out.push(`  ruta: ${f.ruta.ruta} [${f.ruta.metodos.join(", ")}]`);
  if (f.cliente) out.push('  navegador: sí ("use client")');
  return out.join("\n");
}

/** What a file loads, and what depends on it, level by level: the impact of changing it. */
export function textoDependencias(index, f, profundidad = 3) {
  const out = [`${f.path} [${f.objetivo ?? "sin objetivo"}]`];
  out.push(`Importa: ${lista(f.importa, 40) || "nada del repo"}`);
  out.push(`Lo usan (directo): ${lista(f.usadoPor, 40) || "nadie"}`);
  const vistos = new Set([f.path]);
  let nivel = [f.path];
  for (let n = 1; n <= profundidad; n++) {
    const siguientes = [];
    for (const p of nivel) {
      for (const q of index.mapa.get(p).usadoPor) {
        if (!vistos.has(q)) {
          vistos.add(q);
          siguientes.push(q);
        }
      }
    }
    if (!siguientes.length) break;
    siguientes.sort();
    out.push(`Nivel ${n} (${siguientes.length}): ${lista(siguientes, 30)}`);
    nivel = siguientes;
  }
  if (vistos.size > 1) out.push(`Si cambiás este archivo, revisá ${vistos.size - 1} archivos (hasta ${profundidad} niveles).`);
  if (f.probadoPor.length) out.push(`Pruebas que lo cubren: ${f.probadoPor.join(", ")}`);
  return out.join("\n");
}

export function textoObjetivo(index, slug) {
  if (!slug) return ["Objetivos:", ...index.objetivos.map((o) => `  ${o.slug} — ${o.titulo} (${o.archivos.length} archivos)`)].join("\n");
  const o = index.objetivos.find((x) => norm(x.slug) === norm(slug));
  if (!o) return `No existe el objetivo «${slug}». Están: ${index.objetivos.map((x) => x.slug).join(", ")}.`;
  const out = [`${o.slug} — ${o.titulo}`, `Texto: ${o.texto}`];
  if (o.reglas.length) out.push("Reglas:", ...o.reglas.map((r) => `- ${r}`));
  if (o.pendiente.length) out.push("Pendiente:", ...o.pendiente.map((r) => `- ${r}`));
  out.push(`Archivos (${o.archivos.length}):`);
  for (const p of o.archivos) {
    const f = index.mapa.get(p);
    out.push(`- ${p}${f.resumen ? ` — ${f.resumen.slice(0, 110)}` : ""}`);
  }
  out.push(`Patrones: ${o.patrones.map((p) => (p.tapado ? `${p.glob} (tapado por otro objetivo)` : `${p.glob} (${p.coincidencias})`)).join(", ")}`);
  return out.join("\n");
}

export function textoTablas(index) {
  const out = [`Tablas D1: ${index.tablas.size}. Una tabla que crece necesita índice y LIMIT (CLAUDE.md).`];
  for (const n of [...index.tablas.keys()].sort()) {
    const t = index.tablas.get(n);
    const indices = t.indices.length ? `índices: ${t.indices.join(", ")}` : "sin índice visible";
    out.push(`- ${n} — crea: ${lista(t.crea, 3) || "—"} · usa: ${lista(t.usa, 10) || "—"} · ${indices}`);
  }
  return out.join("\n");
}

export function textoSecretos(index) {
  const out = ["Secretos (getSecret; la regla: nunca llegan al navegador):"];
  for (const n of [...index.secretos.keys()].sort()) {
    const s = index.secretos.get(n);
    const partes = [["lee", s.lee], ["guarda", s.guarda], ["borra", s.borra]].filter(([, v]) => v.length).map(([k, v]) => `${k}: ${lista(v, 6)}`);
    out.push(`- ${n} — ${partes.join(" · ")}`);
  }
  out.push("Variables de entorno del Worker:");
  for (const v of [...index.variables.keys()].sort()) out.push(`- ${v} — ${lista(index.variables.get(v), 6)}`);
  const enNavegador = index.cliente.problemas.filter((p) => p.tipo === "secreto");
  out.push(enNavegador.length ? "Código de navegador que toca secretos:" : "Código de navegador que toca secretos: ninguno.");
  for (const p of enNavegador) out.push(`- ${p.archivo} ${p.detalle} · ${p.cadena.join(" → ")}`);
  return out.join("\n");
}

function apilar(mapa, clave, valor) {
  if (!mapa.has(clave)) mapa.set(clave, []);
  mapa.get(clave).push(valor);
}

/** Lines that differ between two texts, both ways. */
export function diferencias(viejo, nuevo) {
  const a = viejo.split("\n");
  const b = nuevo.split("\n");
  const enA = new Set(a);
  const enB = new Set(b);
  return {
    quitadas: a.filter((l) => l.trim() && !enB.has(l)),
    agregadas: b.filter((l) => l.trim() && !enA.has(l)),
  };
}

export function leerHuellas(texto) {
  const salida = new Map();
  for (const linea of texto.split("\n")) {
    if (!linea || linea.startsWith("#")) continue;
    const [hash, lineas, ...ruta] = linea.split("\t");
    salida.set(ruta.join("\t"), { hash, lineas: Number(lineas) });
  }
  return salida;
}

/** The checks: the map is current, every file has an objective, the browser touches no secrets. */
export function chequear(index, mapaGuardado) {
  const esperado = renderMapa(index);
  const mapaViejo = mapaGuardado !== esperado;
  const problemas = [];
  if (index.sinObjetivo.length) {
    problemas.push(`Archivos sin objetivo: ${lista(index.sinObjetivo, 40)}. Agregalos en docs/araña/objetivos.md (Archivos:).`);
  }
  for (const p of index.cliente.problemas) {
    problemas.push(`Código de navegador: ${p.archivo} ${p.detalle} (${p.cadena.join(" → ")}). La regla: el navegador no toca secretos ni rutas /api.`);
  }
  const avisos = [];
  for (const o of index.objetivos) {
    if (!o.archivos.length && !o.transversal) avisos.push(`El objetivo ${o.slug} no tiene archivos.`);
    for (const p of o.patrones) {
      if (!p.coincidencias) avisos.push(`Patrón sin archivos en ${o.slug}: ${p.glob}`);
      else if (p.tapado) avisos.push(`Patrón tapado en ${o.slug}: ${p.glob} (lo ganan objetivos anteriores)`);
    }
  }
  if (index.libSinPrueba.length) avisos.push(`Lib sin prueba directa (${index.libSinPrueba.length}): ${lista(index.libSinPrueba, 12)}`);
  return {
    ok: !mapaViejo && problemas.length === 0,
    mapaViejo,
    dif: mapaViejo ? diferencias(mapaGuardado ?? "", esperado) : null,
    problemas,
    avisos,
  };
}

export function textoCheck(r) {
  const out = [];
  if (r.mapaViejo) {
    out.push("PROBLEMA: docs/araña/MAPA.md está viejo. Corré npm run arana y commiteá docs/araña/.");
    for (const l of r.dif.quitadas.slice(0, 8)) out.push(`  quitado: ${l}`);
    for (const l of r.dif.agregadas.slice(0, 8)) out.push(`  agregado: ${l}`);
  }
  for (const p of r.problemas) out.push(`PROBLEMA: ${p}`);
  for (const a of r.avisos) out.push(`AVISO: ${a}`);
  out.push(r.ok ? "Mapa al día: todo archivo tiene objetivo y el navegador no toca secretos ni rutas /api." : "Hay problemas: corregí y corré npm run arana.");
  return out.join("\n");
}

/** What changed since the last map: files by objective, and the structure the committed map does not know. */
export function textoCambios(index, huellasTexto, mapaGuardado) {
  if (huellasTexto === null) return "No hay huellas todavía: corré npm run arana.";
  const previas = leerHuellas(huellasTexto);
  const cambios = [];
  for (const f of index.archivos) {
    const previa = previas.get(f.path);
    if (!previa) cambios.push({ f, etiqueta: "nuevo" });
    else if (previa.hash !== f.hash) cambios.push({ f, etiqueta: "cambió" });
  }
  const borrados = [...previas.keys()].filter((p) => !index.mapa.has(p));
  const out = [];
  if (!cambios.length && !borrados.length) {
    out.push("Archivos: nada cambió desde el último npm run arana.");
  } else {
    const nuevos = cambios.filter((c) => c.etiqueta === "nuevo").length;
    out.push(`Desde el último npm run arana: ${nuevos} nuevos, ${cambios.length - nuevos} cambiados, ${borrados.length} borrados.`);
    const grupos = new Map();
    for (const { f, etiqueta } of cambios) apilar(grupos, f.objetivo ?? "sin objetivo", `  ${etiqueta}: ${f.path}`);
    for (const p of borrados) apilar(grupos, "borrados", `  borrado: ${p}`);
    for (const g of [...grupos.keys()].sort()) out.push(`[${g}]`, ...grupos.get(g).slice(0, 40));
  }
  if (mapaGuardado !== null) {
    const d = diferencias(mapaGuardado, renderMapa(index));
    if (d.quitadas.length || d.agregadas.length) {
      out.push("", "Estructura que el mapa commiteado no tiene:");
      for (const l of d.quitadas.slice(0, 30)) out.push(`  quitado: ${l}`);
      for (const l of d.agregadas.slice(0, 30)) out.push(`  agregado: ${l}`);
    }
  }
  out.push("", "Cuando esté bien: npm run arana, y commiteá docs/araña/.");
  return out.join("\n");
}

export function resumen(index) {
  return `${index.archivos.length} archivos · ${index.objetivos.length} objetivos · ${index.sinObjetivo.length} sin objetivo · ${index.tablas.size} tablas D1 · ${index.secretos.size} secretos · ${index.rutas.length} rutas /api.`;
}

// ── La vista: la araña dibujada (docs/araña/vista.html) ──

export const VISTA_PLANTILLA = "scripts/arana-vista.html";
export const VISTA = `${DOCS}/vista.html`;

function tipoDe(f) {
  if (f.esPrueba) return "prueba";
  if (f.path.startsWith("app/api/")) return "api";
  if (f.path.startsWith("app/")) return /\.css$/.test(f.path) ? "estilo" : "pantalla";
  if (f.path.startsWith("lib/")) return "lib";
  if (f.path.startsWith("worker/")) return "worker";
  if (f.path.startsWith("scripts/")) return "script";
  if (f.path.endsWith(".md")) return "doc";
  return "otro";
}

/**
 * Todo lo que muestra la vista, compacto: objetivos con sus reglas y
 * pendientes, archivos (índice = posición), imports entre archivos, qué prueba
 * cada test, tablas, secretos, rutas y las banderas que hay que atender.
 */
export function grafoDe(index, { generado = new Date().toISOString(), commit = null } = {}) {
  const pos = new Map(index.archivos.map((f, i) => [f.path, i]));
  const obj = new Map(index.objetivos.map((o, i) => [o.slug, i]));
  const at = (p) => pos.get(p);
  const archivos = index.archivos.map((f) => ({
    p: f.path,
    o: f.objetivo ? obj.get(f.objetivo) : -1,
    k: tipoDe(f),
    l: f.lineas,
    r: f.resumen.slice(0, 180),
    x: f.exporta.slice(0, 8),
    c: f.cliente ? 1 : 0,
    pr: f.probadoPor.length,
    tb: [...new Set([...f.tablas.crea, ...f.tablas.menciones.filter((n) => index.tablas.has(n))])].slice(0, 6),
    s: [...new Set(f.secretos.map((s) => s.nombre))],
    ru: f.ruta ? f.ruta.ruta : null,
  }));
  const enlaces = [];
  const pruebas = [];
  for (const f of index.archivos) {
    for (const dep of f.importa) (f.esPrueba ? pruebas : enlaces).push([at(f.path), at(dep)]);
  }
  const banderas = [
    ...index.libSinPrueba.map((p) => ({ k: "sin-prueba", a: at(p), t: "sin prueba directa" })),
    ...index.sinObjetivo.map((p) => ({ k: "sin-objetivo", a: at(p), t: "sin objetivo en objetivos.md" })),
    ...index.cliente.problemas.map((pr) => ({ k: pr.tipo === "secreto" ? "secreto" : "api", a: at(pr.archivo), t: pr.detalle })),
  ];
  return {
    v: 1,
    generado,
    commit,
    resumen: {
      archivos: index.archivos.length,
      lineas: index.archivos.reduce((a, f) => a + f.lineas, 0),
      objetivos: index.objetivos.length,
      tablas: index.tablas.size,
      secretos: index.secretos.size,
      rutas: index.rutas.length,
      enlaces: enlaces.length,
      pruebas: pruebas.length,
      clienteProblemas: index.cliente.problemas.length,
    },
    objetivos: index.objetivos.map((o) => ({ slug: o.slug, titulo: o.titulo, texto: o.texto, reglas: o.reglas, pendiente: o.pendiente, transversal: o.transversal })),
    archivos,
    enlaces,
    pruebas,
    banderas,
    tablas: [...index.tablas].map(([n, t]) => ({ n, crea: t.crea.map(at), usa: t.usa.map(at) })),
    secretos: [...index.secretos].map(([n, s]) => ({ n, lee: s.lee.map(at), guarda: s.guarda.map(at) })),
    rutas: index.rutas.map((r) => ({ r: r.ruta, a: at(r.archivo), m: r.metodos })),
    sinonimos: Object.fromEntries([...index.sinonimos].map(([k, set]) => [k, [...set].filter((x) => x !== k)])),
  };
}

/** La plantilla con el grafo adentro (sin `</script>` que corte la página). */
export function vistaHtml(plantilla, grafo) {
  const json = JSON.stringify(grafo).replace(/</g, "\\u003c");
  if (!plantilla.includes("/*__GRAFO__*/null")) throw new Error(`${VISTA_PLANTILLA}: falta el marcador /*__GRAFO__*/null`);
  return plantilla.replace("/*__GRAFO__*/null", () => json);
}

const AYUDA = `La araña: el mapa de ALT RADAR PRO para consultar sin leer todo el repo.

  npm run arana                        reescribe docs/araña/MAPA.md y huellas.txt (después de cambiar archivos u objetivos)
  npm run arana -- --buscar <tema>     archivos que tratan un tema, en español o inglés (sinónimos en objetivos.md)
  npm run arana -- --archivo <ruta>    ficha de un archivo: qué exporta, qué importa, quién lo usa, tablas, secretos
  npm run arana -- --ruta <archivo>    qué se revisa si lo cambiás (quién lo usa, hasta 3 niveles)
  npm run arana -- --objetivo [nombre] un objetivo con sus reglas, pendientes y archivos
  npm run arana -- --tablas            tablas D1: quién las crea y quién las usa
  npm run arana -- --secretos          secretos y variables de entorno, y si el navegador los toca
  npm run arana -- --cambios           qué cambió desde el último mapa
  npm run arana -- --check             falla si el mapa está viejo, si hay archivos sin objetivo o si el navegador toca secretos
  npm run arana -- --vista [salida]    dibuja la araña recorriendo el proyecto en docs/araña/vista.html (no se commitea)
  npm run arana -- --ayuda

La lectura es estática: los imports que se arman en tiempo de ejecución no aparecen.`;

/** The objectives file and the repo, read from disk. */
export function cargarIndice(root = ROOT) {
  const definicion = parseObjetivos(readFileSync(join(root, OBJETIVOS), "utf8"));
  return construirIndice(leerArchivos(root, listarArchivos(root)), definicion);
}

function leerSiExiste(root, ruta) {
  try {
    return readFileSync(join(root, ruta), "utf8");
  } catch {
    return null;
  }
}

/** One query. Returns the exit code and the text to print; it writes nothing. */
export function ejecutar(args, index, { mapaGuardado = null, huellas = null } = {}) {
  const [flag, ...resto] = args;
  const tema = resto.join(" ").trim();
  if (flag === "--ayuda" || flag === "-h") return { codigo: 0, salida: AYUDA };
  if (flag === "--buscar") {
    return tema ? { codigo: 0, salida: textoBusqueda(index, tema) } : { codigo: 2, salida: "Falta el tema: --buscar <tema>." };
  }
  if (flag === "--archivo" || flag === "--ruta") {
    if (!tema) return { codigo: 2, salida: `Falta la ruta: ${flag} <archivo>.` };
    const hallados = buscarArchivo(index, tema);
    if (!hallados.length) return { codigo: 1, salida: `No hay archivo que contenga «${tema}».` };
    if (hallados.length > 1) {
      return { codigo: 1, salida: [`Son ${hallados.length} archivos. Sé más preciso:`, ...hallados.slice(0, 15).map((f) => `  ${f.path}`)].join("\n") };
    }
    return { codigo: 0, salida: flag === "--archivo" ? textoArchivo(index, hallados[0]) : textoDependencias(index, hallados[0]) };
  }
  if (flag === "--objetivo") return { codigo: 0, salida: textoObjetivo(index, tema) };
  if (flag === "--tablas") return { codigo: 0, salida: textoTablas(index) };
  if (flag === "--secretos") return { codigo: 0, salida: textoSecretos(index) };
  if (flag === "--cambios") return { codigo: 0, salida: textoCambios(index, huellas, mapaGuardado) };
  if (flag === "--check") {
    const r = chequear(index, mapaGuardado);
    return { codigo: r.ok ? 0 : 1, salida: textoCheck(r) };
  }
  if (flag === "--vista") {
    const plantilla = readFileSync(join(ROOT, VISTA_PLANTILLA), "utf8");
    let commit = null;
    try {
      commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    } catch {
      // Not a git checkout: the view just does not name the commit.
    }
    const salida = tema || VISTA;
    writeFileSync(join(ROOT, salida), vistaHtml(plantilla, grafoDe(index, { commit })));
    return { codigo: 0, salida: `Vista de la araña: ${salida} (${resumen(index)})` };
  }
  return { codigo: 2, salida: `No conozco «${flag}».\n\n${AYUDA}` };
}

/** Without arguments: rewrite the map and the fingerprints, and say what needs attention. */
function regenerar(index) {
  mkdirSync(join(ROOT, DOCS), { recursive: true });
  writeFileSync(join(ROOT, MAPA), renderMapa(index));
  writeFileSync(join(ROOT, HUELLAS), renderHuellas(index));
  return {
    codigo: 0,
    salida: [
      `Araña actualizada: ${resumen(index)}`,
      `Escribí ${MAPA} y ${HUELLAS}. Commiteálos junto con el cambio.`,
      textoCheck(chequear(index, renderMapa(index))),
    ].join("\n"),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const index = cargarIndice(ROOT);
  const { codigo, salida } = args.length
    ? ejecutar(args, index, { mapaGuardado: leerSiExiste(ROOT, MAPA), huellas: leerSiExiste(ROOT, HUELLAS) })
    : regenerar(index);
  process.stdout.write(`${salida}\n`);
  process.exitCode = codigo;
}
