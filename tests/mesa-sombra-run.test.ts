import assert from "node:assert/strict";
import test from "node:test";
import { SOMBRA_EVENT } from "../lib/mesa-sombra-run.ts";
import { estadoInicial } from "../lib/mesa-sombra.ts";

const estadoBase = estadoInicial();

/** Una instancia nueva del módulo (otra URL, otro estado), con sus tipos. */
const fresco = (q: string) => import(new URL(`../lib/mesa-sombra-run.ts?${q}`, import.meta.url).href) as Promise<typeof import("../lib/mesa-sombra-run.ts")>;

type Llamada = { metodo: string; url: string; cuerpo: Record<string, unknown> | null };

/** Un fetch falso: el papel sin sesión (vacío) y el laboratorio según `sombra`. */
function simular(sombra: (metodo: string, cuerpo: Record<string, unknown> | null) => Response): Llamada[] {
  const llamadas: Llamada[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const metodo = init?.method ?? "GET";
    const cuerpo = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    llamadas.push({ metodo, url, cuerpo });
    if (url.startsWith("/api/jarvis/paper")) return Response.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });
    if (url.startsWith("/api/jarvis/sombra")) return sombra(metodo, cuerpo);
    return new Response("", { status: 404 });
  }) as typeof fetch;
  return llamadas;
}

test("avisa sus cambios con su propio evento", () => {
  assert.equal(SOMBRA_EVENT, "alt-radar:mesa-sombra");
});

test("sin sesión corre en memoria: no manda nada al servidor y no deja aprobar", async () => {
  const llamadas = simular(() => Response.json({ error: "SESIÓN REQUERIDA" }, { status: 401 }));
  const run = await fresco("sin-sesion");
  await run.correrSombra(Date.parse("2026-10-13T10:00:00Z"));
  assert.equal(run.laboratorio().modo, "sin sesión");
  assert.match(run.laboratorio().aviso ?? "", /no queda auditoría/);
  assert.ok(!llamadas.some((l) => l.url.startsWith("/api/jarvis/sombra") && l.metodo === "POST"));
  const r = await run.aprobarVariante(5);
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /sesión iniciada/);
});

test("con sesión guarda la corrida (sin evolución si falta muestra) y respeta el límite de la auditoría", async () => {
  let posts = 0;
  const llamadas = simular((metodo, cuerpo) => {
    if (metodo === "GET") return Response.json({ estado: null, seq: 0, eventos: [] });
    posts += 1;
    if (posts > 1) return Response.json({ error: "Ya se registró una evolución hace menos de 20 minutos." }, { status: 429 });
    return Response.json({ estado: cuerpo?.estado, seq: 0, eventos: [] });
  });
  const run = await fresco("con-sesion");
  await run.correrSombra(Date.parse("2026-10-13T10:00:00Z"));
  assert.equal(run.laboratorio().modo, "cuenta");
  const post = llamadas.find((l) => l.metodo === "POST");
  assert.equal(post?.cuerpo?.accion, "guardar");
  assert.deepEqual(post?.cuerpo?.eventos, [], "sin muestra no hay evolución que registrar");
  assert.equal(run.laboratorio().cadena?.ok, true);
  await run.correrSombra(Date.parse("2026-10-13T10:01:00Z"));
  assert.equal(posts, 1, "sin datos nuevos no vuelve a guardar");
});

test("tres corridas a la vez se juntan en una: un solo guardado", async () => {
  let posts = 0;
  simular((metodo, cuerpo) => {
    if (metodo === "GET") return Response.json({ estado: null, seq: 0, eventos: [] });
    posts += 1;
    return Response.json({ estado: cuerpo?.estado, seq: 0, eventos: [] });
  });
  const run = await fresco("a-la-vez");
  const t = Date.parse("2026-10-13T11:00:00Z");
  await Promise.all([run.correrSombra(t), run.correrSombra(t), run.correrSombra(t)]);
  assert.equal(posts, 1);
  assert.equal(run.laboratorio().corriendo, false);
});

test("si la cuenta no responde, lo vuelve a intentar en la próxima vuelta: no queda trabado en error", async () => {
  let caida = true;
  simular((metodo, cuerpo) => {
    if (caida) return new Response("", { status: 503 });
    if (metodo === "GET") return Response.json({ estado: null, seq: 0, eventos: [] });
    return Response.json({ estado: cuerpo?.estado, seq: 0, eventos: [] });
  });
  const run = await fresco("reintenta");
  await run.correrSombra(Date.parse("2026-10-13T12:00:00Z"));
  assert.equal(run.laboratorio().modo, "error");
  caida = false;
  await run.correrSombra(Date.parse("2026-10-13T12:10:00Z"));
  assert.equal(run.laboratorio().modo, "cuenta");
  assert.equal(run.laboratorio().error, null);
});

test("si aprobaste en otra pestaña, el guardado de esta se rechaza y vuelve a leer la cuenta: adopta la aprobada", async () => {
  const aprobadaEnOtra = { indice: 4321, aprobadaA: Date.parse("2026-10-13T12:30:00Z") };
  let gets = 0;
  simular((metodo) => {
    if (metodo === "GET") {
      gets += 1;
      return Response.json({ estado: gets === 1 ? null : { ...JSON.parse(JSON.stringify(estadoBase)), aprobada: aprobadaEnOtra }, seq: 0, eventos: [] });
    }
    return Response.json({ error: "La variante aprobada solo cambia aprobando o revocando, a pedido tuyo." }, { status: 403 });
  });
  const run = await fresco("otra-pestana");
  await run.correrSombra(Date.parse("2026-10-13T13:00:00Z"));
  assert.equal(gets, 2, "después del rechazo vuelve a pedir el laboratorio");
  assert.deepEqual(run.laboratorio().estado.aprobada, aprobadaEnOtra);
  assert.equal(run.laboratorio().modo, "cuenta");
});
