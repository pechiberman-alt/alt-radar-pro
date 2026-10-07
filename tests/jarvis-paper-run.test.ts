import assert from "node:assert/strict";
import test from "node:test";
import type { DeskDecision } from "../lib/jarvis-desk.ts";
import { closeNow, lastPrice, loadPaper, openFromDesk, PAPER_LOCAL_KEY, paperState, refreshPaper } from "../lib/jarvis-paper-run.ts";
import type { PaperTrade } from "../lib/jarvis-paper.ts";

const H = 3_600_000;
const NOW = Date.UTC(2026, 9, 7, 15, 20);
const VELA = Date.UTC(2026, 9, 7, 14); // the last closed 1 h candle at NOW

/** A desk decision with an approved LONG plan, just what paper trading reads. */
function decision(over: Partial<DeskDecision> = {}): DeskDecision {
  return {
    symbol: "SOLUSDT",
    moneda: "SOL",
    precio: 100,
    vela: VELA,
    generadoA: NOW,
    direccion: "LONG",
    puntaje: 70,
    consenso: 0.4,
    cobertura: 0.9,
    plan: { lado: "LONG", entrada: 100, tipoEntrada: "MERCADO", stop: 95, stopRazon: "prueba", tp: [{ price: 105, label: "a" }, { price: 110, label: "b" }, { price: 115, label: "c" }], obstaculos: [] },
    riesgo: { lado: "LONG", rr: [1, 2, 3], rrPonderado: 2, stopPct: 5, stopAtr: 1.5, riesgoUsd: 10, posicionUsd: 200, cantidad: 2, apalancamiento: 3, apalancamientoMaxSeguro: 6, margenUsd: 66, liquidacionAprox: 70, nivel: "BAJO", vetos: [], esperas: [], avisos: [], aprobado: true },
    alcista: { plan: null, riesgo: null, argumentos: [] },
    bajista: { plan: null, riesgo: null, argumentos: [] },
    resolucion: "prueba",
    razonamiento: ["a"],
    invalidacion: "",
    alternativo: "",
    niveles: { soportes: [], resistencias: [] },
    imanes: { arriba: null, abajo: null },
    agentes: [],
    faltantes: [],
    fuentes: ["prueba"],
    historial: null,
    aviso: "",
    ...over,
  } as DeskDecision;
}

function fakeWindow() {
  const store = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    dispatchEvent: () => true,
  };
  return store;
}

/** Binance-shaped 1 h klines from `start`, rising 1 a candle from 100 (TP1 at the 5th, TP3 at the 15th). */
function rising(start: number, n: number) {
  return Array.from({ length: n }, (_, i) => {
    const t = start + i * H;
    const o = 100 + i;
    return [t, String(o), String(o + 1.2), String(o - 0.2), String(o + 1), "1", t + H - 1, "1", 1, "1", "1", "0"];
  });
}

type Call = { method: string; url: string; body: unknown };
function stubFetch(paper: (method: string, body: unknown) => Response) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, url, body });
    if (url.startsWith("/api/jarvis/paper")) return paper(method, body);
    const m = url.match(/\/fapi\/v1\/klines\?symbol=(\w+)&interval=1h&startTime=(\d+)/);
    if (m) return new Response(JSON.stringify(rising(Number(m[2]), 30)));
    return new Response("", { status: 404 });
  }) as typeof fetch;
  return calls;
}

test("signed in but the record does not answer: an honest error, never an empty list taken as real", async () => {
  fakeWindow();
  const calls = stubFetch(() => new Response("", { status: 500 }));
  const s = await loadPaper(true);
  assert.equal(s.mode, "error");
  const r = await openFromDesk(decision(), NOW);
  assert.equal(r.ok, false);
  assert.ok(!calls.some((c) => c.method === "POST"), "nothing is opened against a record it cannot read");
});

test("signed out: the record lives on this device, opens once, refuses stale plans, resolves with Binance candles", async () => {
  const local = fakeWindow();
  stubFetch(() => Response.json({ error: "SESIÓN REQUERIDA" }, { status: 401 }));
  assert.equal((await loadPaper(true)).mode, "equipo");
  const r = await openFromDesk(decision(), NOW);
  assert.ok(r.ok);
  assert.equal((await openFromDesk(decision(), NOW)).ok, false, "the same plan twice");
  const stale = await openFromDesk(decision({ vela: VELA - 10 * H }), NOW);
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.match(stale.error, /viejo/);
  const vetoed = await openFromDesk(decision({ direccion: "NO TRADE", riesgo: { ...decision().riesgo!, vetos: ["x"] } }), NOW);
  assert.equal(vetoed.ok, false, "never a plan the risk manager vetoed");
  assert.equal(JSON.parse(local.get(PAPER_LOCAL_KEY)!).length, 1);
  const later = VELA + 20 * H;
  const done = await refreshPaper(later);
  assert.equal(done.changed, 1);
  const t = paperState().trades[0];
  assert.equal(t.estado, "CERRADA");
  assert.deepEqual(t.salidas.map((e) => e.kind), ["TP1", "TP2", "TP3"]);
  assert.equal(t.fuenteVelas, "Binance Futures");
  assert.equal(JSON.parse(local.get(PAPER_LOCAL_KEY)!)[0].estado, "CERRADA", "kept on this device");
  assert.ok(lastPrice("SOLUSDT")!.price > 100);
  assert.equal((await closeNow(t.id, later)).ok, false, "a closed trade cannot be closed again");
});

test("signed in: opened and advanced through the server, whose version wins", async () => {
  fakeWindow();
  const serverOpened = { abiertaA: NOW - 5000 };
  const calls = stubFetch((method, body) => {
    if (method === "GET") return Response.json({ trades: [] });
    if (method === "POST") return Response.json({ trade: { ...(body as { trade: PaperTrade }).trade, ...serverOpened } });
    // PUT: the server recomputes the result; here it marks it so the test can see whose copy won.
    const trades = (body as { trades: PaperTrade[] }).trades;
    return Response.json({ saved: trades.map((x) => ({ ...x, motivoCierre: `${x.motivoCierre} (servidor)` })), rejected: [] });
  });
  assert.equal((await loadPaper(true)).mode, "cuenta");
  const r = await openFromDesk(decision(), NOW);
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.trade.abiertaA, serverOpened.abiertaA, "the server's clock");
  await refreshPaper(VELA + 20 * H);
  const put = calls.filter((c) => c.method === "PUT");
  assert.equal(put.length, 1);
  assert.equal((put[0].body as { trades: PaperTrade[] }).trades.length, 1);
  assert.match(paperState().trades[0].motivoCierre!, /\(servidor\)$/);
});
