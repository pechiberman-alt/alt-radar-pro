#!/usr/bin/env node
/**
 * El editor por IA: lo corre .github/workflows/ia-editor.yml cuando el dueño comenta «/ia …» en un issue. Lee el pedido, le
 * muestra al modelo gratis los archivos que corresponden, valida lo que devuelve (lib/ia-editor.ts), aplica los cambios,
 * corre lint y las pruebas, y abre un PR para que la persona lo revise. Nunca mergea ni toca workflows, dependencias,
 * migraciones ni claves. Si algo falla, lo cuenta en el issue y no deja nada a medias.
 *
 * Ensayo sin red ni git: IA_SECO=1 IA_RESPUESTA_ARCHIVO=<json> COMENTARIO="/ia archivos: lib/x.ts …" node … (muestra el
 * resultado y deja los archivos cambiados en el disco, sin commit).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  MAX_ARCHIVOS,
  MAX_CARACTERES_CONTEXTO,
  aplicarEdiciones,
  ocultarSecretos,
  parsearComentario,
  promptEdicion,
  promptElegirArchivos,
  rutaPermitida,
  rutasElegidas,
  validarRespuesta,
} from "../lib/ia-editor.ts";

const env = process.env;
const SECO = env.IA_SECO === "1";
const REPO = env.GITHUB_REPOSITORY ?? "";
const ISSUE = Number(env.ISSUE_NUMBER ?? 0);
const URL_API = env.IA_API_URL || "https://api.groq.com/openai/v1/chat/completions";
const MODELO = env.IA_MODELO || "llama-3.3-70b-versatile";

/** Quita del texto cualquier secreto antes de mostrarlo o de comentarlo en un issue público. */
function limpiar(texto) {
  const auth = env.GITHUB_TOKEN ? Buffer.from(`x-access-token:${env.GITHUB_TOKEN}`).toString("base64") : "";
  return ocultarSecretos(texto, [env.GITHUB_TOKEN, env.IA_API_KEY, auth]);
}

const log = (m) => console.log(`[ia-editor] ${limpiar(m)}`);

async function github(ruta, cuerpo) {
  const r = await fetch(`https://api.github.com${ruta}`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: "application/vnd.github+json", "content-type": "application/json", "user-agent": "ia-editor" },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`GitHub respondió ${r.status} en ${ruta}`);
  return r.json();
}

async function avisar(texto) {
  log(texto);
  if (SECO || !ISSUE || !REPO) return;
  try {
    await github(`/repos/${REPO}/issues/${ISSUE}/comments`, { body: limpiar(texto) });
  } catch (e) {
    log(`No se pudo comentar en el issue: ${e.message}`);
  }
}

async function llamarModelo({ sistema, usuario }) {
  if (!URL_API.startsWith("https://")) throw new Error("La dirección de la IA tiene que ser https.");
  if (!env.IA_API_KEY) throw new Error("Falta el secreto IA_API_KEY en el repositorio.");
  const r = await fetch(URL_API, {
    method: "POST",
    headers: { authorization: `Bearer ${env.IA_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: MODELO, temperature: 0.1, max_tokens: 4096, messages: [{ role: "system", content: sistema }, { role: "user", content: usuario }] }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!r.ok) {
    const detalle = (await r.text().catch(() => "")).slice(0, 200).replace(/\s+/g, " ");
    throw new Error(`La IA respondió ${r.status}. ${detalle}`);
  }
  const j = await r.json();
  const texto = j?.choices?.[0]?.message?.content;
  if (typeof texto !== "string") throw new Error("La IA no devolvió texto.");
  return texto;
}

/** Lista de archivos que se pueden tocar, desde el mapa de la araña (la ruta es lo último de cada línea). */
function listaPermitida() {
  const l = readFileSync("docs/araña/huellas.txt", "utf8").split("\n");
  return l.map((x) => x.split("\t").pop()?.trim() ?? "").filter((x) => x && rutaPermitida(x));
}

/**
 * Lint y pruebas corren código que escribió el modelo: van sin el token ni la clave en el entorno. El token de git tampoco está
 * guardado en el repositorio (el workflow usa persist-credentials: false); recién se usa al subir la rama.
 */
const ENTORNO_LIMPIO = { PATH: env.PATH ?? "", HOME: env.HOME ?? "", CI: "1", LANG: env.LANG ?? "C.UTF-8" };

function correr(cmd, args, tiempo = 600_000) {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: tiempo, env: ENTORNO_LIMPIO });
  const salida = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(-15).join("\n");
  return { ok: r.status === 0, salida };
}

async function principal() {
  const pedido = parsearComentario(env.COMENTARIO ?? "");
  if (!pedido) return log("El comentario no es un pedido «/ia»: nada que hacer.");

  let rutas = pedido.archivos.filter((r) => existsSync(r));
  if (rutas.length === 0) {
    if (SECO) throw new Error("En el ensayo hay que nombrar archivos.");
    log("Sin archivos nombrados: la IA elige de la lista.");
    const lista = listaPermitida();
    rutas = rutasElegidas(await llamarModelo(promptElegirArchivos(lista, pedido.pedido)), lista).filter((r) => existsSync(r));
  }
  if (rutas.length === 0) return avisar("No pude decidir qué archivos mirar. Probá de nuevo nombrándolos en una línea: `archivos: ruta1, ruta2`.");
  rutas = rutas.slice(0, MAX_ARCHIVOS);

  const archivos = Object.fromEntries(rutas.map((r) => [r, readFileSync(r, "utf8")]));
  const total = Object.values(archivos).reduce((s, c) => s + c.length, 0);
  if (total > MAX_CARACTERES_CONTEXTO) {
    return avisar(`Los archivos pesan ${total} caracteres y el máximo es ${MAX_CARACTERES_CONTEXTO}. Pedime algo sobre menos archivos o archivos más chicos.`);
  }

  const reglas = existsSync("CLAUDE.md") ? readFileSync("CLAUDE.md", "utf8").slice(0, 8_000) : "";
  const texto = SECO ? readFileSync(env.IA_RESPUESTA_ARCHIVO, "utf8") : await llamarModelo(promptEdicion(reglas, archivos, pedido.pedido));

  const v = validarRespuesta(texto);
  if (!v.ok) return avisar(`No abrí ningún PR: ${v.error}`);
  const a = aplicarEdiciones(archivos, v.respuesta.ediciones);
  if (!a.ok) return avisar(`No abrí ningún PR: ${a.error} No se cambió nada.`);

  for (const r of a.tocados) writeFileSync(r, a.archivos[r]);
  log(`Archivos cambiados: ${a.tocados.join(", ")}`);
  if (SECO) return log(`Ensayo terminado. Resumen: ${v.respuesta.resumen}`);

  correr("npm", ["run", "arana"], 120_000);
  const lint = correr("npm", ["run", "lint"]);
  const pruebas = correr("npm", ["run", "test:unit"]);
  const verde = lint.ok && pruebas.ok;

  const rama = `ia/issue-${ISSUE}-${Date.now()}`;
  const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
  git("config", "user.name", "ia-editor");
  git("config", "user.email", "ia-editor@users.noreply.github.com");
  git("checkout", "-b", rama);
  git("add", "--", ...a.tocados, "docs/araña");
  git("commit", "-m", `IA: ${v.respuesta.resumen.split("\n")[0].slice(0, 70) || "cambio pedido en el issue " + ISSUE}`);
  const auth = Buffer.from(`x-access-token:${env.GITHUB_TOKEN}`).toString("base64");
  try {
    git("-c", `http.https://github.com/.extraheader=AUTHORIZATION: basic ${auth}`, "push", "origin", rama);
  } catch {
    // El error de git puede traer los argumentos (con el token): se cuenta sin el detalle.
    throw new Error("No pude subir la rama al repositorio.");
  }

  const cuerpo = [
    "## Pedido",
    pedido.pedido,
    "",
    "## Qué cambia",
    v.respuesta.resumen,
    "",
    "Archivos: " + a.tocados.map((r) => `\`${r}\``).join(", "),
    "",
    "## Chequeos (corridos antes de abrir el PR)",
    `- Lint: ${lint.ok ? "✓" : "✗"}`,
    `- Pruebas: ${pruebas.ok ? "✓" : "✗"}`,
    ...(verde ? [] : ["", "```", (lint.ok ? "" : lint.salida + "\n") + (pruebas.ok ? "" : pruebas.salida), "```"]),
    "",
    `> Lo escribió un modelo gratis (${MODELO}) sin supervisión: revisalo antes de mergear. No hace merge solo. Ver issue #${ISSUE}.`,
  ].join("\n");
  const pr = await github(`/repos/${REPO}/pulls`, { title: `IA: ${v.respuesta.resumen.split("\n")[0].slice(0, 70)}`, head: rama, base: env.GITHUB_REF_NAME || "main", body: cuerpo, draft: !verde });
  await avisar(`Abrí el PR #${pr.number}${verde ? "" : " como borrador, porque fallaron los chequeos"}: ${pr.html_url}`);
}

principal().catch(async (e) => {
  await avisar(`No pude completar el pedido: ${limpiar(e.message)}`);
  process.exit(1);
});
