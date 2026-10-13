/**
 * npm run subir: lleva a producción el cambio que pasó `npm run verificar`, en un paso y con salida corta: rama,
 * commit, PR, squash a main y espera el deploy del CI. Se niega si el árbol cambió desde el último verificar, si hay
 * archivos o líneas que parecen secretos, o si toca workflows o wrangler sin --permitir-protegidos (CLAUDE.md).
 * Uso: npm run subir -- --rama x --titulo "…" --mensaje archivo --cuerpo archivo [--sin-merge] | --seguir <sha>
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  arbolActual, archivoDeSecretos, archivoProtegido, archivoVerificado, buscarSecretos, duracion, repoDesdeRemoto,
} from "./herramientas.mjs";

const { values: op } = parseArgs({
  options: {
    rama: { type: "string" },
    titulo: { type: "string" },
    mensaje: { type: "string" },
    cuerpo: { type: "string" },
    "sin-merge": { type: "boolean" },
    "sin-verificar": { type: "boolean" },
    "permitir-protegidos": { type: "boolean" },
    esperar: { type: "string" },
    seguir: { type: "string" },
  },
});

function fallar(motivo) {
  console.log(`✗ ${motivo}`);
  process.exit(1);
}
function correr(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }).trim();
  } catch (e) {
    const detalle = String(e.stderr || e.stdout || e.message).trim().split("\n").slice(-6).join(" | ");
    return fallar(`${cmd} ${args.slice(0, 3).join(" ")}: ${detalle}`);
  }
}
const git = (...args) => correr("git", args);
const gh = (...args) => JSON.parse(correr("gh", ["api", ...args]) || "null");
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const repo = repoDesdeRemoto(git("remote", "get-url", "origin")) ?? fallar("no reconozco el remoto origin");

async function seguirDeploy(sha) {
  const minutos = Number(op.esperar ?? 9);
  const limite = Date.now() + minutos * 60_000;
  let visto = "";
  let corridas = [];
  while (Date.now() < limite) {
    corridas = (gh(`repos/${repo}/actions/runs?branch=main&event=push&per_page=15`)?.workflow_runs ?? [])
      .filter((r) => r.head_sha.startsWith(sha));
    if (corridas.length && corridas.every((r) => r.status === "completed")) break;
    const estado = corridas.length ? (corridas.some((r) => r.status === "in_progress") ? "corriendo" : "en cola") : "esperando que arranque";
    if (estado !== visto) console.log(`… deploy ${estado}`);
    visto = estado;
    await dormir(15_000);
  }
  if (!corridas.length || corridas.some((r) => r.status !== "completed")) {
    console.log(`… el deploy sigue después de ${minutos} min: npm run subir -- --seguir ${sha.slice(0, 7)}`);
    return 0;
  }
  const rotas = corridas.filter((r) => r.conclusion !== "success");
  if (!rotas.length) {
    const r = corridas[0];
    const ms = Date.parse(r.updated_at) - Date.parse(r.run_started_at ?? r.created_at);
    console.log(`✓ deploy ok · ${duracion(ms)} · falta confirmar producción: /api/version?nocache=${sha.slice(0, 7)}`);
    return 0;
  }
  for (const r of rotas) {
    const pasos = (gh(`repos/${repo}/actions/runs/${r.id}/jobs`)?.jobs ?? [])
      .flatMap((j) => (j.steps ?? []).filter((s) => s.conclusion === "failure").map((s) => `${j.name} › ${s.name}`));
    console.log(`✗ ${r.name}: ${r.conclusion}${pasos.length ? ` en ${pasos.join("; ")}` : ""} · ${r.html_url}`);
  }
  return 1;
}

if (op.seguir) process.exit(await seguirDeploy(op.seguir));

if (!op.titulo || !op.mensaje || !op.cuerpo) fallar("faltan --titulo, --mensaje <archivo> y --cuerpo <archivo>");
for (const f of [op.mensaje, op.cuerpo]) if (!existsSync(f)) fallar(`no existe ${f}`);

// lib/build-info.ts lo reescribe el build: nunca se sube.
spawnSync("git", ["checkout", "--", "lib/build-info.ts"]);

if (!op["sin-verificar"]) {
  const destino = archivoVerificado();
  if (!existsSync(destino)) fallar("falta npm run verificar (o --sin-verificar, que queda dicho en el PR)");
  const v = JSON.parse(readFileSync(destino, "utf8"));
  if (v.rapido) fallar("el último verificar fue --rapido: corré el completo");
  if (v.arbol !== arbolActual()) fallar("el árbol cambió desde el último npm run verificar: volvé a correrlo");
}

let rama = git("rev-parse", "--abbrev-ref", "HEAD");
if (rama === "main") {
  if (!op.rama) fallar("estás en main: pasá --rama <nombre>");
  if (spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${op.rama}`]).status === 0) fallar(`la rama ${op.rama} ya existe`);
  git("checkout", "-q", "-b", op.rama);
  rama = op.rama;
}

git("add", "-A");
const archivos = git("diff", "--cached", "--name-only").split("\n").filter(Boolean);
const frenar = (motivo) => {
  git("reset", "-q");
  fallar(motivo);
};
if (!archivos.length) frenar("no hay cambios para subir");
const secretos = archivos.filter(archivoDeSecretos);
if (secretos.length) frenar(`archivos de secretos: ${secretos.join(", ")}`);
const protegidos = archivos.filter(archivoProtegido);
if (protegidos.length && !op["permitir-protegidos"]) frenar(`toca ${protegidos.join(", ")}: solo con pedido explícito (--permitir-protegidos)`);
const hallados = buscarSecretos(git("diff", "--cached", "-U0", "--no-color"));
if (hallados.length) frenar(`parece un secreto: ${hallados.map((h) => `${h.archivo}:${h.linea} (${h.tipo})`).join(", ")}`);

git("commit", "-q", "-F", op.mensaje);
const commit = git("rev-parse", "HEAD");
git("push", "-q", "-u", "origin", rama);
rmSync(archivoVerificado(), { force: true });
console.log(`✓ commit ${commit.slice(0, 7)} en ${rama} · ${archivos.length} archivos${op["sin-verificar"] ? " · SIN verificar" : ""}`);

const pr = gh("-X", "POST", `repos/${repo}/pulls`, "-f", `title=${op.titulo}`, "-f", `head=${rama}`, "-f", "base=main", "-F", `body=@${op.cuerpo}`);
console.log(`✓ PR #${pr.number} ${pr.html_url}`);
if (op["sin-merge"]) process.exit(0);

const merge = gh("-X", "PUT", `repos/${repo}/pulls/${pr.number}/merge`, "-f", "merge_method=squash");
if (!merge?.merged) fallar(`no se pudo mergear el PR #${pr.number}: ${merge?.message ?? "sin detalle"}`);
console.log(`✓ squash a main ${merge.sha.slice(0, 7)}`);
git("checkout", "-q", "main");
git("pull", "-q", "--ff-only");
spawnSync("git", ["branch", "-q", "-D", rama]);
process.exit(await seguirDeploy(merge.sha));
