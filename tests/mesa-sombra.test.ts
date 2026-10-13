import assert from "node:assert/strict";
import test from "node:test";
import type { PaperTrade } from "../lib/jarvis-paper.ts";
import { generadorAzar } from "../lib/jarvis-stats.ts";
import {
  aprobar,
  BASE,
  casosDe,
  codigo,
  describir,
  ESPACIO,
  estadoInicial,
  evolucionar,
  genomaDe,
  indiceDe,
  motivoRechazo,
  periodos,
  rasgosDe,
  resumirSombra,
  revocar,
  textoEvento,
  validarEstado,
  type EstadoSombra,
} from "../lib/mesa-sombra.ts";

const H = 3_600_000;
const T0 = Date.parse("2026-01-01T00:00:00Z");

type Opc = { ganaBuena?: number; ganaMala?: number; pref?: string; semilla?: number };
/** Operaciones cerradas sintéticas: con confluencia ≥ 60 ganan más seguido (la ventaja que el laboratorio debería encontrar). */
function operaciones(n: number, desde: number, o: Opc = {}): PaperTrade[] {
  const az = generadorAzar(o.semilla ?? 11);
  return Array.from({ length: n }, (_, i) => {
    const confianza = Math.round(30 + az() * 60);
    const lado = az() < 0.5 ? "LONG" : "SHORT";
    const p = confianza >= 60 ? (o.ganaBuena ?? 0.6) : (o.ganaMala ?? 0.3);
    const abiertaA = desde + i * H;
    return {
      id: `${o.pref ?? "t"}${i}`,
      symbol: "BTCUSDT",
      lado,
      estado: "CERRADA",
      abiertaA,
      cerradaA: abiertaA + 5 * H,
      resultadoR: az() < p ? 1.5 : -1,
      confianza,
      rrPlan: 1.5 + az(),
      analisis: { consenso: (lado === "LONG" ? 1 : -1) * az() * 0.6, cobertura: 0.6 + az() * 0.4, regimen: ["COMPRIMIDA", "NORMAL", "EXPANDIDA"][Math.floor(az() * 3)], sesgos: {} },
      decision: { stopPct: 0.5 + az() * 3 },
    } as unknown as PaperTrade;
  });
}

test("el espacio de variantes es fijo y cada variante va y vuelve de su número", () => {
  assert.equal(ESPACIO, 5 * 5 * 4 * 4 * 4 * 3 * 3);
  for (const i of [0, 1, 777, 9999, ESPACIO - 1]) assert.equal(indiceDe(genomaDe(i)), i);
  assert.equal(describir(BASE), "sin filtro: la mesa tal cual");
  assert.equal(codigo(42), "V-00042");
});

test("los rasgos son lo que la mesa sabía al abrir: el consenso se mide a favor del lado", () => {
  const [t] = operaciones(1, T0);
  const corto = { ...t, lado: "SHORT", analisis: { ...t.analisis, consenso: -0.4 } } as PaperTrade;
  assert.equal(rasgosDe(corto)?.consensoFavor, 0.4);
  const sinDato = { ...t, confianza: Number.NaN } as PaperTrade;
  assert.equal(rasgosDe(sinDato), null, "desconocido no es cero: sin dato, no entra");
});

test("una variante dice qué la deja afuera, gen por gen", () => {
  const r = { confianza: 55, consensoFavor: 0.35, cobertura: 0.7, rr: 1.8, stopPct: 2.5, lado: "LONG" as const, regimen: "COMPRIMIDA" };
  const con = (k: number, v: number) => {
    const g = new Array(7).fill(0);
    g[k] = v;
    return indiceDe(g);
  };
  assert.equal(motivoRechazo(BASE, r), null, "la mesa tal cual toma todo");
  assert.match(motivoRechazo(con(0, 3), r) ?? "", /confluencia 55, pide 60/);
  assert.equal(motivoRechazo(con(1, 2), r), null, "consenso 0,35 ≥ 0,30");
  assert.match(motivoRechazo(con(4, 2), r) ?? "", /stop a 2,50%/);
  assert.match(motivoRechazo(con(5, 2), r) ?? "", /solo toma cortos/);
  assert.match(motivoRechazo(con(6, 1), r) ?? "", /comprimida/);
});

test("solo cuentan las cerradas con resultado, una vez cada una y en orden de apertura", () => {
  const ts = operaciones(5, T0);
  const abierta = { ...ts[0], id: "x", estado: "ABIERTA", resultadoR: null } as PaperTrade;
  const casos = casosDe([ts[3], ts[1], abierta, ts[1]], [ts[0]]);
  assert.deepEqual(casos.map((c) => c.id), ["backtest:t0", "papel:t1", "papel:t3"]);
});

test("el desarrollo no incluye operaciones que cerraron después de que empieza la validación", () => {
  const casos = casosDe(operaciones(30, T0)).map((c, i) => (i === 18 ? { ...c, cerradaA: c.abiertaA + 100 * H } : c));
  const { desarrollo, validacion } = periodos(casos);
  assert.equal(validacion.length, 10);
  assert.ok(!desarrollo.some((c) => c.id === casos[18].id), "su resultado se supo durante la validación: se purga");
  const corte = validacion[0].abiertaA;
  assert.ok(desarrollo.every((c) => c.cerradaA < corte), "ningún resultado del desarrollo se conoce después del corte");
  // Cierran 5 h después de abrir: de la 15 a la 19 se resuelven ya dentro de la validación.
  assert.equal(desarrollo.length, 15);
});

test("no mira el futuro: cambiar los resultados de validación no cambia qué variantes elige la evolución", () => {
  const ts = operaciones(300, T0);
  const ahora = T0 + 400 * H;
  const a = evolucionar(estadoInicial(), casosDe(ts), ahora);
  const corte = periodos(casosDe(ts)).validacion[0].abiertaA;
  const envenenadas = ts.map((t) => (t.abiertaA >= corte ? { ...t, resultadoR: -(t.resultadoR as number) * 3 } : t));
  const b = evolucionar(estadoInicial(), casosDe(envenenadas), ahora);
  assert.deepEqual(b.estado.poblacion, a.estado.poblacion, "la población sale solo del desarrollo");
  assert.equal(b.estado.probadas, a.estado.probadas);
});

test("es determinista y sin datos nuevos no evoluciona (correrlo otra vez solo sobreajustaría)", () => {
  const casos = casosDe(operaciones(300, T0));
  const a = evolucionar(estadoInicial(), casos, T0 + 400 * H);
  const b = evolucionar(estadoInicial(), casos, T0 + 400 * H);
  assert.deepEqual(a.estado, b.estado);
  const otra = evolucionar(a.estado, casos, T0 + 500 * H);
  assert.equal(otra.cambio, false);
  assert.equal(otra.eventos.length, 0);
  assert.equal(otra.estado, a.estado);
});

test("con muestra mínima no evoluciona y lo dice", () => {
  const r = evolucionar(estadoInicial(), casosDe(operaciones(20, T0)), T0 + 30 * H);
  assert.equal(r.estado.generacion, 0);
  assert.equal(r.eventos.length, 0);
  assert.match(resumirSombra(r.estado, casosDe(operaciones(20, T0))).nota, /Muestra mínima/);
});

test("encuentra la ventaja real, la mide hacia adelante y la deja APTA solo con datos que no existían al descubrirla", () => {
  const pasado = operaciones(300, T0);
  const ahora = T0 + 301 * H;
  const r1 = evolucionar(estadoInicial(), casosDe(pasado), ahora);
  const cand = r1.eventos.filter((e) => e.tipo === "CANDIDATA");
  assert.ok(cand.length > 0, "aparece al menos una candidata");
  assert.ok(r1.estado.candidatas.every((c) => c.estado === "EN OBSERVACIÓN" && c.descubiertaA === ahora));
  assert.ok(r1.estado.candidatas.every((c) => /confluencia ≥ (60|70)/.test(describir(c.indice))), "la ventaja está en la confluencia");
  assert.equal(r1.eventos[0].tipo, "EVOLUCION");

  const adelante = operaciones(200, ahora + H, { ganaBuena: 0.75, ganaMala: 0.3, pref: "f", semilla: 5 });
  const r2 = evolucionar(r1.estado, casosDe([...pasado, ...adelante]), ahora + 300 * H);
  const aptas = r2.estado.candidatas.filter((c) => c.estado === "APTA");
  assert.ok(aptas.length > 0, "con ventaja hacia adelante queda apta");
  assert.ok(r2.eventos.some((e) => e.tipo === "APTA"));
  assert.equal(r2.estado.aprobada, null, "APTA no es aprobada: eso lo decide la persona");
});

test("con ruido hacia adelante, la candidata se descarta y dice por qué", () => {
  const pasado = operaciones(300, T0);
  const ahora = T0 + 301 * H;
  const r1 = evolucionar(estadoInicial(), casosDe(pasado), ahora);
  const ruido = operaciones(120, ahora + H, { ganaBuena: 0.3, ganaMala: 0.45, pref: "f", semilla: 9 });
  const r2 = evolucionar(r1.estado, casosDe([...pasado, ...ruido]), ahora + 200 * H);
  const antes = new Set(r1.estado.candidatas.map((c) => c.indice));
  const viejas = r2.estado.candidatas.filter((c) => antes.has(c.indice));
  assert.ok(viejas.length > 0 && viejas.every((c) => c.estado === "DESCARTADA"));
  assert.ok(viejas.every((c) => /no rinde más que/.test(c.motivo)));
  assert.ok(r2.eventos.some((e) => e.tipo === "DESCARTADA"));
});

test("aprobar solo una APTA, de a una, y revocar deja la mesa tal cual; la evolución nunca aprueba ni revoca sola", () => {
  const base = estadoInicial();
  const conApta: EstadoSombra = { ...base, candidatas: [{ indice: 123, descubiertaA: 1, estado: "APTA", motivo: "", adelante: { n: 20, media: 0.3, mesa: 0.1 }, cambiadaA: 2 }] };
  assert.equal(aprobar(conApta, 999, 3).ok, false, "no figura");
  const enObs = { ...conApta, candidatas: [{ ...conApta.candidatas[0], estado: "EN OBSERVACIÓN" as const }] };
  assert.equal(aprobar(enObs, 123, 3).ok, false, "en observación no se aprueba");
  const a = aprobar(conApta, 123, 3);
  assert.ok(a.ok);
  if (!a.ok) return;
  assert.deepEqual(a.estado.aprobada, { indice: 123, aprobadaA: 3 });
  assert.equal(a.evento.tipo, "APROBACION");
  assert.equal(aprobar(a.estado, 123, 4).ok, false, "de a una");
  const r = revocar(a.estado, 5, "la reviso");
  assert.ok(r.ok && r.estado.aprobada === null && r.evento.tipo === "REVOCACION");

  const ts = operaciones(300, T0);
  const ev = evolucionar(a.estado, casosDe(ts), T0 + 400 * H);
  assert.deepEqual(ev.estado.aprobada, a.estado.aprobada, "evolucionar no toca la aprobada");
  assert.ok(!ev.eventos.some((e) => e.tipo === "APROBACION" || e.tipo === "REVOCACION"));
});

test("el estado que manda el navegador se revisa entero", () => {
  const e = estadoInicial();
  assert.ok(validarEstado(JSON.parse(JSON.stringify(e))));
  assert.equal(validarEstado({ ...e, poblacion: [ESPACIO] }), null, "fuera del espacio");
  assert.equal(validarEstado({ ...e, aprobada: { indice: -1, aprobadaA: 1 } }), null);
  assert.equal(validarEstado({ ...e, candidatas: [{ indice: 1, estado: "APROBADA" }] }), null);
  assert.equal(validarEstado({ ...e, version: 2 }), null);
  const cand = { indice: 1, descubiertaA: 1, estado: "APTA", motivo: "", adelante: { n: 20, media: 0.2, mesa: 0.1 }, cambiadaA: 1 };
  assert.ok(validarEstado({ ...e, candidatas: [cand] }));
  assert.equal(validarEstado({ ...e, candidatas: [{ ...cand, adelante: { n: 20, media: "0,2", mesa: 0.1 } }] }), null, "un número que no es número no entra");
  assert.equal(validarEstado({ ...e, candidatas: [{ ...cand, adelante: { n: -1, media: null, mesa: null } }] }), null);
});

test("una APTA que con más datos deja de ser firme vuelve a observación, queda registrado y ya no se aprueba", () => {
  const soloLargos = indiceDe([0, 0, 0, 0, 0, 1, 0]);
  const estado: EstadoSombra = {
    ...estadoInicial(),
    candidatas: [{ indice: soloLargos, descubiertaA: T0, estado: "APTA", motivo: "Apta para revisión.", adelante: { n: 15, media: 0.6, mesa: 0.1 }, cambiadaA: T0 }],
  };
  // Hacia adelante los largos ganan en promedio (+2 y −1 alternados, +0,5 R) y los cortos pierden, pero con
  // 20 largos el PSR no llega a 0,95: ya no es firme, aunque siga ganándole a la mesa.
  const ts = Array.from({ length: 40 }, (_, i) => {
    const lado = i % 2 === 0 ? "LONG" : "SHORT";
    const abiertaA = T0 + (i + 1) * H;
    return {
      id: `f${i}`,
      symbol: "BTCUSDT",
      lado,
      estado: "CERRADA",
      abiertaA,
      cerradaA: abiertaA + 2 * H,
      resultadoR: lado === "LONG" ? (i % 4 === 0 ? 2 : -1) : -1,
      confianza: 60,
      rrPlan: 2,
      analisis: { consenso: lado === "LONG" ? 0.4 : -0.4, cobertura: 0.8, regimen: "NORMAL", sesgos: {} },
      decision: { stopPct: 1.5 },
    } as unknown as PaperTrade;
  });
  const r = evolucionar(estado, casosDe(ts), T0 + 100 * H);
  const c = r.estado.candidatas.find((x) => x.indice === soloLargos);
  assert.equal(c?.estado, "EN OBSERVACIÓN", "no queda apta por inercia");
  assert.match(c?.motivo ?? "", /^Volvió a observación: con 20 operaciones hacia adelante ya no alcanza/);
  const ev = r.eventos.find((e) => e.tipo === "OBSERVACION");
  assert.ok(ev, "la vuelta a observación queda en la auditoría");
  assert.match(textoEvento(ev.tipo, ev.datos), /volvió a observación/);
  assert.equal(aprobar(r.estado, soloLargos, T0 + 101 * H).ok, false, "en observación no se aprueba");
});

test("la compuerta vuelve a leer la aprobación cada 5 minutos y, si no puede, sigue la última que leyó", async () => {
  const filtro = await (import(new URL("../lib/mesa-sombra-filtro.ts?vigencia", import.meta.url).href) as Promise<typeof import("../lib/mesa-sombra-filtro.ts")>);
  const [t] = operaciones(1, T0);
  const largo = { ...t, lado: "LONG", analisis: { ...t.analisis, consenso: 0.3 } } as PaperTrade;
  const soloCortos = indiceDe([0, 0, 0, 0, 0, 2, 0]);
  let respuesta: () => Response = () => Response.json({ estado: { aprobada: { indice: soloCortos } } });
  let pedidos = 0;
  globalThis.fetch = (async () => {
    pedidos += 1;
    return respuesta();
  }) as typeof fetch;
  const vence = filtro.FILTRO_VIGENCIA_MS;
  assert.match((await filtro.rechazoDeVariante(largo, T0)) ?? "", /solo toma cortos/, "la primera vez la lee de la cuenta");
  assert.notEqual(await filtro.rechazoDeVariante(largo, T0 + 60_000), null);
  assert.equal(pedidos, 1, "dentro de los 5 minutos no la vuelve a pedir");
  respuesta = () => new Response("", { status: 500 });
  assert.notEqual(await filtro.rechazoDeVariante(largo, T0 + vence + 1), null, "si no puede leer, sigue la última que leyó");
  assert.equal(pedidos, 2);
  respuesta = () => Response.json({ estado: { aprobada: null } });
  assert.equal(await filtro.rechazoDeVariante(largo, T0 + vence + 2), null, "revocada en otra pestaña: deja de frenar");
  assert.equal(pedidos, 3, "después de no poder leer, la vuelve a pedir en la próxima apertura");
  filtro.fijarFiltro(-5, T0 + 2 * vence);
  assert.equal(filtro.filtroActual(), null, "un número fuera del espacio no filtra nada");
});

test("el resumen trae solo números finitos o null, y cada evento se puede leer", () => {
  const ts = operaciones(300, T0);
  const r = evolucionar(estadoInicial(), casosDe(ts), T0 + 400 * H);
  const res = resumirSombra(r.estado, casosDe(ts));
  JSON.stringify(res, (_k, v) => {
    if (typeof v === "number") assert.ok(Number.isFinite(v));
    return v;
  });
  assert.equal(res.datos.casos, 300);
  assert.ok(res.probadas > 0 && res.probadas <= ESPACIO);
  for (const e of r.eventos) assert.ok(!textoEvento(e.tipo, e.datos).includes("undefined"));
});

test("la variante aprobada frena el papel nuevo que no tomaría, dice por qué, y sin aprobada no frena nada", async () => {
  const { fijarFiltro, rechazoDeVariante } = await import("../lib/mesa-sombra-filtro.ts");
  const [t] = operaciones(1, T0);
  const largo = { ...t, lado: "LONG", analisis: { ...t.analisis, consenso: 0.3 } } as PaperTrade;
  const soloCortos = indiceDe([0, 0, 0, 0, 0, 2, 0]);
  fijarFiltro(soloCortos);
  assert.match((await rechazoDeVariante(largo)) ?? "", new RegExp(`${codigo(soloCortos)} no toma esta operación: solo toma cortos.*revocala`));
  assert.equal(await rechazoDeVariante({ ...largo, lado: "SHORT", analisis: { ...largo.analisis, consenso: -0.3 } } as PaperTrade), null);
  fijarFiltro(null);
  assert.equal(await rechazoDeVariante(largo), null);
  const { readFileSync } = await import("node:fs");
  const run = readFileSync(new URL("../lib/jarvis-paper-run.ts", import.meta.url), "utf8");
  assert.ok(/s\.mode === "cuenta"\) \{\s*\/\/[^\n]*\n\s*const rechazo = await rechazoDeVariante\(t\);/.test(run), "la compuerta va antes de abrir en la cuenta");
});
