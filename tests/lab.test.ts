import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { BacktestResult } from "../lib/jarvis-backtest.ts";
import type { PaperTrade } from "../lib/jarvis-paper.ts";
import type { VivoSnapshot } from "../lib/arana-vivo.ts";
import { agentesDe, centroDe, estadoMotor, labParaIa, type FotoLab } from "../lib/lab.ts";
import { corteDe, costoEnR, evaluarBacktest, FRACCION_EVALUACION } from "../lib/lab-evaluacion.ts";
import { respuestaLab, temaLab } from "../lib/lab-jarvis.ts";
import {
  estadoCartera, evaluarPropuesta, LIMITES_DEFECTO, normalizarLimites, operacionDePapel, propuestaDePapel, TOPES,
  type OperacionCartera, type Propuesta,
} from "../lib/lab-riesgo.ts";
import type { Registro } from "../lib/registro.ts";
import { armarRegistro } from "../lib/registro.ts";

/**
 * AI TRADING LAB: el gestor de riesgo central frena lo que pasa los límites y nadie lo afloja más allá de los topes;
 * la evaluación del backtest respeta la cronología; el centro de la araña dice el estado real; los agentes dicen qué
 * hacen y qué falta; JARVIS responde con esos datos sin coronar muestras chicas; y nada del laboratorio toca ejecución real.
 */

const H = 3_600_000;
const DIA = 24 * H;
const AHORA = Date.UTC(2026, 9, 13, 15);

const prop = (o: Partial<Propuesta> = {}): Propuesta => ({ symbol: "BTCUSDT", lado: "LONG", estrategia: "MESA", entrada: 100, stop: 95, rrPlan: 2, riesgoPct: 1, ...o });
const op = (o: Partial<OperacionCartera> = {}): OperacionCartera => ({ symbol: "ETHUSDT", lado: "LONG", estrategia: "MESA", estado: "ABIERTA", resultadoR: null, cerradaA: null, ...o });
const cerrada = (r: number, cuando: number, o: Partial<OperacionCartera> = {}) => op({ estado: "CERRADA", resultadoR: r, cerradaA: cuando, ...o });

test("riesgo: una propuesta sana pasa y cada límite roto frena con su motivo", () => {
  assert.equal(evaluarPropuesta(prop(), [], null, AHORA).ok, true);
  const casos: [Partial<Propuesta>, RegExp][] = [
    [{ stop: 105 }, /lado equivocado/],
    [{ rrPlan: 1.2 }, /R:R/],
    [{ riesgoPct: null }, /No se sabe el riesgo/],
    [{ riesgoPct: 1.5 }, /límite es 1/],
    [{ entrada: Number.NaN }, /entrada y stop válidos/],
  ];
  for (const [o, re] of casos) {
    const v = evaluarPropuesta(prop(o), [], null, AHORA);
    assert.equal(v.ok, false, JSON.stringify(o));
    assert.ok(v.motivos.some((m) => re.test(m)), `${JSON.stringify(o)} → ${v.motivos.join(" | ")}`);
  }
});

test("riesgo: posiciones, exposición, duplicados, por activo y por estrategia", () => {
  const cinco = ["A", "B", "C", "D", "E"].map((s) => op({ symbol: `${s}USDT` }));
  assert.match(evaluarPropuesta(prop(), cinco, null, AHORA).motivos.join(" "), /5 posiciones abiertas/);
  assert.match(evaluarPropuesta(prop(), cinco, null, AHORA).motivos.join(" "), /riesgo abierto pasaría/);
  const igual = [op({ symbol: "BTCUSDT", lado: "LONG" })];
  assert.match(evaluarPropuesta(prop(), igual, null, AHORA).motivos.join(" "), /no se duplica/);
  const otroLado = [op({ symbol: "BTCUSDT", lado: "SHORT" })];
  assert.match(evaluarPropuesta(prop(), otroLado, null, AHORA).motivos.join(" "), /límite por activo/);
  const misma = [op({ symbol: "XUSDT", estrategia: "AGENTE" }), op({ symbol: "YUSDT", estrategia: "AGENTE" })];
  assert.match(evaluarPropuesta(prop({ estrategia: "AGENTE" }), misma, { maxPorEstrategia: 2 }, AHORA).motivos.join(" "), /AGENTE llegó a su límite/);
  // Las cerradas y canceladas no ocupan lugar.
  assert.equal(evaluarPropuesta(prop(), [op({ symbol: "BTCUSDT", estado: "CERRADA", resultadoR: 1, cerradaA: AHORA - DIA })], null, AHORA).ok, true);
});

test("riesgo: la pérdida del día y la caída desde el pico suspenden operaciones nuevas", () => {
  const hoy = [cerrada(-1, AHORA - H), cerrada(-1, AHORA - 2 * H), cerrada(-1.1, AHORA - 3 * H)];
  const v = evaluarPropuesta(prop(), hoy, null, AHORA);
  assert.equal(v.ok, false);
  assert.equal(v.cartera.suspendida, true);
  assert.match(v.motivos[0], /pérdida de hoy/);
  // La misma pérdida ayer no suspende hoy (el límite es diario)...
  assert.equal(estadoCartera(hoy.map((o) => ({ ...o, cerradaA: (o.cerradaA as number) - DIA })), LIMITES_DEFECTO, AHORA).suspendida, false);
  // ...pero una caída de 10 R desde el pico, sí, aunque sea de días anteriores.
  const caida = [cerrada(5, AHORA - 10 * DIA), ...Array.from({ length: 10 }, (_, k) => cerrada(-1, AHORA - (9 - k) * DIA))];
  const e = estadoCartera(caida, LIMITES_DEFECTO, AHORA);
  assert.equal(e.suspendida, true);
  assert.match(e.motivoSuspension ?? "", /caída desde el pico/);
  // Si la curva se recuperó, se puede volver a operar aunque la peor caída de la historia haya sido grande.
  const recuperada = [...caida.map((o) => ({ ...o, cerradaA: (o.cerradaA as number) - 20 * DIA })), cerrada(12, AHORA - 2 * DIA)];
  assert.equal(estadoCartera(recuperada, LIMITES_DEFECTO, AHORA).suspendida, false);
  // Una operación que "cierra" en el futuro no cuenta.
  assert.equal(estadoCartera([cerrada(-5, AHORA + H)], LIMITES_DEFECTO, AHORA).perdidaHoyR, 0);
});

test("riesgo: nadie afloja los límites más allá de los topes y los de defecto no se pueden modificar", () => {
  const flojo = normalizarLimites({ riesgoMaxPct: 50, maxPosiciones: 1000, drawdownMaxR: 1e9, rrMinimo: 0, perdidaDiariaMaxR: "todo" });
  assert.equal(flojo.riesgoMaxPct, TOPES.riesgoMaxPct.max);
  assert.equal(flojo.maxPosiciones, TOPES.maxPosiciones.max);
  assert.equal(flojo.drawdownMaxR, TOPES.drawdownMaxR.max);
  assert.equal(flojo.rrMinimo, TOPES.rrMinimo.min);
  assert.equal(flojo.perdidaDiariaMaxR, LIMITES_DEFECTO.perdidaDiariaMaxR);
  assert.ok(Object.isFrozen(flojo) && Object.isFrozen(LIMITES_DEFECTO) && Object.isFrozen(TOPES));
  assert.throws(() => {
    (LIMITES_DEFECTO as { riesgoMaxPct: number }).riesgoMaxPct = 99;
  });
  // Pedir 3 % de riesgo con límites "aflojados" sigue frenando: el tope es 2 %.
  assert.equal(evaluarPropuesta(prop({ riesgoPct: 3 }), [], { riesgoMaxPct: 100 }, AHORA).ok, false);
});

test("riesgo: una operación de papel de la mesa se traduce sin perder datos", () => {
  const t = { symbol: "SOLUSDT", lado: "SHORT" as const, estado: "ABIERTA" as const, resultadoR: null, cerradaA: null, entrada: 150, stop: 160, rrPlan: 1.8 };
  assert.deepEqual(operacionDePapel(t), { symbol: "SOLUSDT", lado: "SHORT", estrategia: "MESA", estado: "ABIERTA", resultadoR: null, cerradaA: null });
  assert.deepEqual(propuestaDePapel(t, 0.5), { symbol: "SOLUSDT", lado: "SHORT", estrategia: "MESA", entrada: 150, stop: 160, rrPlan: 1.8, riesgoPct: 0.5 });
});

// ——— Backtest ———

function trade(i: number, o: Partial<PaperTrade> & { r: number; abierta: number; horas?: number }): PaperTrade {
  const llenada = o.abierta + H;
  return {
    id: `t${i}`, symbol: "BTCUSDT", lado: "LONG", estado: "CERRADA", abiertaA: o.abierta, vela: o.abierta, tipoEntrada: "MERCADO",
    entrada: 100, stop: 98, tp: [102, 104, 106], rrPlan: 2, confianza: 60,
    analisis: { direccionMesa: "LONG", consenso: 0.4, cobertura: 0.8, regimen: null, sesgos: {}, motivo: "", razonamiento: [], fuentes: [] },
    decision: { riesgoNivel: "BAJO", apalancamiento: 1, riesgoUsd: null, posicionUsd: null, stopPct: 2 },
    salidas: [], llenadaA: llenada, cerradaA: llenada + (o.horas ?? 10) * H, resultadoR: o.r, mfeR: null, maeR: null,
    revisadaHasta: null, fuenteVelas: "Binance Futures", motivoCierre: null, ...o,
  } as PaperTrade;
}

function backtest(trades: PaperTrade[], desde = AHORA - 100 * DIA, hasta = AHORA): BacktestResult {
  return { symbol: "BTCUSDT", desde, hasta, dias: 100, trades, abiertasAlFinal: 1, equity: [], metricas: {} as BacktestResult["metricas"], lecturas: { evaluadas: 0, long: 0, short: 0, esperar: 0, noTrade: 0, sinDatos: 0 }, fuente: "Binance Futures", reglas: 2, limitaciones: ["Sin derivados históricos."] };
}

test("backtest: comisión y deslizamiento en R, bruto, neto y con deslizamiento", () => {
  const t = trade(0, { r: 1, abierta: AHORA - 50 * DIA });
  // 0,05 % por lado sobre un riesgo del 2 % del precio: 2 × 0,05 / 2 = 0,05 R.
  assert.ok(Math.abs(costoEnR(t, 0.05) - 0.05) < 1e-12);
  assert.equal(costoEnR({ ...t, stop: 100 }, 0.05), 0, "sin distancia al stop no se divide por cero");
  const ev = evaluarBacktest(backtest([t]), 0.02);
  const d = ev.desarrollo;
  assert.ok(Math.abs(d.brutoR - 1.05) < 1e-12);
  assert.equal(d.netoR, 1);
  assert.ok(Math.abs(d.conDeslizamientoR - 0.98) < 1e-12);
});

test("backtest: el corte se fija por fecha y lo que pasa después no cambia el DESARROLLO", () => {
  const desde = AHORA - 100 * DIA;
  const corte = corteDe(desde, AHORA);
  assert.equal(corte, Math.round(desde + 100 * DIA * (1 - FRACCION_EVALUACION)));
  const antes = [trade(1, { r: 2, abierta: desde + DIA }), trade(2, { r: -1, abierta: desde + 10 * DIA }), trade(3, { r: -1, abierta: desde + 20 * DIA })];
  const despues = [trade(4, { r: -1, abierta: corte + DIA }), trade(5, { r: 3, abierta: corte + 2 * DIA })];
  const solo = evaluarBacktest(backtest(antes));
  const todo = evaluarBacktest(backtest([...antes, ...despues]));
  assert.deepEqual(todo.desarrollo, solo.desarrollo, "agregar el futuro no toca el pasado");
  assert.equal(todo.evaluacion.operaciones, 2);
  const d = todo.desarrollo;
  assert.equal(d.operaciones, 3);
  assert.equal(d.ganadas, 1);
  assert.equal(d.netoR, 0);
  assert.equal(d.maxDrawdownR, 2);
  assert.equal(d.gananciaMediaR, 2);
  assert.equal(d.perdidaMediaR, 1);
  assert.equal(d.relacionGP, 2);
  assert.equal(d.profitFactor, 1);
  assert.equal(d.duracionMediaH, 10);
  assert.ok(d.exposicion !== null && Math.abs(d.exposicion - 30 / (70 * 24)) < 1e-9);
  assert.equal(d.muestra, "MUESTRA MÍNIMA");
  assert.match(todo.id, /^bt:BTCUSDT:\d+:\d+:reglas2:Binance Futures$/);
  assert.equal(evaluarBacktest(backtest([...antes, ...despues])).id, todo.id, "la misma corrida tiene el mismo id");
  assert.ok(todo.calidad.some((c) => /deslizamiento .* es un supuesto/.test(c)));
  assert.ok(todo.calidad.some((c) => /quedaron abiertas/.test(c)));
});

test("backtest: abiertas, sin resultado y exposición superpuesta se cuentan bien", () => {
  const desde = AHORA - 100 * DIA;
  const a = trade(1, { r: 1, abierta: desde, horas: 10 });
  const b = trade(2, { r: 1, abierta: desde + 5 * H, horas: 10 });
  const abierta = trade(3, { r: 0, abierta: desde, estado: "ABIERTA", resultadoR: null, cerradaA: null });
  const ev = evaluarBacktest(backtest([a, b, abierta]));
  assert.equal(ev.desarrollo.operaciones, 2);
  // a cubre 10 h desde desde+1h; b desde desde+6h a desde+16h: la unión son 15 h, no 20.
  assert.ok(Math.abs((ev.desarrollo.exposicion as number) * (ev.corte - desde) - 15 * H) < 1);
  assert.equal(ev.evaluacion.muestra, "SIN DATOS");
  assert.equal(ev.evaluacion.winRate, null);
});

// ——— Centro de la araña ———

function vivo(o: Partial<VivoSnapshot["escaneo"]> = {}, extra: Partial<VivoSnapshot> = {}): VivoSnapshot {
  return {
    generadoEn: AHORA,
    escaneo: { estado: "listo", haceMin: 5, progreso: null, total: 20, leidas: 20, sinDatos: 0, aprobadas: 2, largos: 1, cortos: 1, esperan: 0, vetadas: 0, sinLado: 0, sinPlan: 0, mejores: [{ symbol: "SOLUSDT", direccion: "LONG", puntaje: 71, consenso: 0.4 }], ...o },
    filas: [], histograma: [], especialistas: [{ id: "tecnico", disponibles: 20, de: 20 }, { id: "derivados", disponibles: 0, de: 20 }],
    coberturaMedia: { valor: null, n: 0 }, papel: { abiertas: 1, cerradas: 3, winRate: null, profitFactor: null, expectativaR: null, muestra: "MUESTRA MÍNIMA" } as VivoSnapshot["papel"],
    arcos: [], riesgoAbierto: { usd: null, abiertas: 1, sinDato: 1 }, cinta: [{ cuando: AHORA - 60_000, texto: "Escaneo completo", tono: "ok" }], backtest: null,
    medido: {} as VivoSnapshot["medido"], veredicto: { estado: "sin muestra", texto: "Sin muestra suficiente." }, vigilancia: null, avisos: [], advertencia: "", aprendizaje: "", sombra: null, registro: null,
    ...extra,
  };
}

function foto(o: Partial<FotoLab> = {}): FotoLab {
  return { ahora: AHORA, enLinea: true, vivo: vivo(), backtestEnCurso: null, autoPausado: false, ultimoError: null, evaluacion: null, limites: LIMITES_DEFECTO, cartera: estadoCartera([], LIMITES_DEFECTO, AHORA), actividad: [], ...o };
}

test("araña: cada estado sale de una señal real y el avance es indeterminado si no se conoce", () => {
  assert.deepEqual(estadoMotor(foto({ enLinea: false })), { estado: "unavailable", progreso: null });
  assert.deepEqual(estadoMotor(foto({ vivo: null })), { estado: "initializing", progreso: null });
  assert.deepEqual(estadoMotor(foto({ backtestEnCurso: { hechos: 30, total: 120 } })), { estado: "processing", progreso: 0.25 });
  assert.deepEqual(estadoMotor(foto({ backtestEnCurso: { hechos: 0, total: 0 } })), { estado: "processing", progreso: null });
  assert.deepEqual(estadoMotor(foto({ vivo: vivo({ estado: "escaneando", progreso: 0.4 }) })), { estado: "scanning", progreso: 0.4 });
  assert.deepEqual(estadoMotor(foto({ vivo: vivo({ estado: "escaneando", progreso: null }) })), { estado: "scanning", progreso: null });
  assert.equal(estadoMotor(foto({ ultimoError: "Binance no respondió" })).estado, "error");
  assert.equal(estadoMotor(foto({ autoPausado: true })).estado, "paused");
  assert.deepEqual(estadoMotor(foto()), { estado: "completed", progreso: 1 });
  assert.equal(estadoMotor(foto({ vivo: vivo({ haceMin: 300 }) })).estado, "idle");
  assert.equal(estadoMotor(foto({ vivo: vivo({ estado: "sin datos", haceMin: null }) })).estado, "idle");
});

test("araña: tareas, errores y actividad ordenada con su hora", () => {
  const c = centroDe(foto({ enLinea: false, actividad: [{ cuando: AHORA, texto: "Riesgo frenó BTC", tono: "aviso" }] }));
  assert.equal(c.estado, "unavailable");
  assert.ok(c.errores.some((e) => /no se generan operaciones/.test(e)));
  assert.deepEqual(c.actividad.map((a) => a.texto), ["Riesgo frenó BTC", "Escaneo completo"]);
  const ids = c.tareas.map((t) => t.id);
  assert.deepEqual(ids, ["escaneo", "backtest", "papel", "riesgo"]);
  assert.equal(c.tareas.find((t) => t.id === "backtest")?.estado, "en espera");
});

test("agentes: roles con entradas, salidas y estado según lo que corrió, y lo pendiente dicho", () => {
  const a = agentesDe(foto());
  assert.deepEqual(a.map((x) => x.nombre), ["Market Analyst", "Technical Analyst", "Liquidity Analyst", "Strategy Researcher", "Risk Manager", "La Araña", "Jarvis"]);
  for (const x of a) assert.ok(x.entradas.length && x.salidas.length && x.modulos.length, x.nombre);
  assert.equal(a.find((x) => x.id === "technical")?.estado, "activo");
  // Derivados sin datos y volumen/liquidaciones sin filas: el analista de liquidez no está activo.
  assert.equal(a.find((x) => x.id === "liquidity")?.estado, "sin datos");
  assert.ok(a.find((x) => x.id === "researcher")?.pendiente.some((p) => /no implementado/.test(p)));
  assert.equal(agentesDe(foto({ vivo: null })).find((x) => x.id === "arana")?.estado, "sin datos");
});

// ——— JARVIS ———

function registro(cerradas: number, r = 0.2): Registro {
  const conteo = { abiertas: 0, cerradas, ganadas: Math.ceil(cerradas / 2), perdidas: cerradas - Math.ceil(cerradas / 2), empatadas: 0, ganado: 0, perdido: 0, neto: cerradas * r };
  conteo.ganado = conteo.ganadas * 2;
  conteo.perdido = conteo.ganado - conteo.neto;
  return armarRegistro([{ id: "NUCLEO_ROMPE", conteo }, { id: "NUCLEO_IMAN", conteo: { ...conteo, neto: -cerradas * r } }, { id: "PAPEL", conteo: null }], AHORA);
}

test("jarvis: entiende las preguntas del laboratorio y deja pasar las demás", () => {
  const preguntas: [string, string][] = [
    ["¿Qué está haciendo La Araña?", "arana"], ["¿Qué encontró el último análisis?", "hallazgo"], ["¿Qué estrategias estamos evaluando?", "estrategias"],
    ["¿Cuál tiene mejor rendimiento histórico y bajo qué condiciones?", "mejor"], ["¿Cuál presenta el mayor drawdown?", "drawdown"],
    ["¿Qué riesgos detectaste?", "riesgos"], ["¿Qué datos faltan para confiar en este resultado?", "faltan"], ["¿Qué pruebas conviene ejecutar después?", "pruebas"],
  ];
  for (const [q, t] of preguntas) assert.equal(temaLab(q), t, q);
  assert.equal(temaLab("analizá BTC en 4h"), null);
  assert.equal(respuestaLab("¿cómo está el mercado?", foto()), null);
});

test("jarvis: responde con los datos de la foto y no corona una muestra mínima", () => {
  const f = foto({ vivo: vivo({}, { registro: registro(5) }) });
  assert.match(respuestaLab("¿Qué está haciendo La Araña?", f) ?? "", /análisis completo/);
  assert.match(respuestaLab("¿Qué encontró el último análisis?", f) ?? "", /20 monedas leídas, 2 con plan aprobado.*SOL LONG/);
  const mejorChica = respuestaLab("¿cuál tiene mejor rendimiento?", f) ?? "";
  assert.match(mejorChica, /no se puede decir cuál rinde mejor/);
  const mejorGrande = respuestaLab("¿cuál tiene mejor rendimiento?", foto({ vivo: vivo({}, { registro: registro(20) }) })) ?? "";
  assert.match(mejorGrande, /la de mayor expectancia es JARVIS · ruptura/);
  assert.match(mejorGrande, /no garantiza el futuro/);
  assert.match(respuestaLab("¿qué estrategias estamos evaluando?", f) ?? "", /ninguna opera con dinero real/);
  assert.match(respuestaLab("¿cuál presenta el mayor drawdown?", f) ?? "", /corré un backtest/);
  assert.match(respuestaLab("¿qué datos faltan para confiar en este resultado?", f) ?? "", /tiene 5 cerradas.*Sin datos.*Bot de papel/);
  assert.match(respuestaLab("¿qué riesgos detectaste?", f) ?? "", /expectancia negativa.*barrida de imán/);
  assert.match(respuestaLab("¿qué pruebas conviene ejecutar después?", f) ?? "", /Correr un backtest.*lo aprobás vos/);
  const ia = labParaIa(f);
  assert.match(ia.aviso, /nada opera con dinero real/);
  assert.equal(ia.registro?.length, 3);
});

// ——— Aislamiento ———

test("aislamiento: el laboratorio no importa ejecución real ni nombra endpoints de órdenes", () => {
  const archivos = ["lib/lab.ts", "lib/lab-riesgo.ts", "lib/lab-evaluacion.ts", "lib/lab-jarvis.ts", "lib/lab-run.ts", "app/ai-trading-lab.tsx"];
  const prohibido = /binance-client-signed|jarvis-execution|futures-order|\/fapi\/v1\/order|\/api\/v3\/order|newOrder|order\.place|apiSecret|X-MBX-APIKEY/;
  for (const f of archivos) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, prohibido, f);
  }
});

test("interfaz móvil: el panel tiene versión angosta, controles táctiles de 44 px y estados de carga, vacío, error y desconexión", () => {
  const css = readFileSync(new URL("../app/ai-trading-lab.css", import.meta.url), "utf8");
  assert.match(css, /@media \(max-width: \d+px\)/);
  assert.match(css, /min-height: ?44px/);
  const tsx = readFileSync(new URL("../app/ai-trading-lab.tsx", import.meta.url), "utf8");
  for (const estado of ["lab-cargando", "lab-vacio", "lab-error", "lab-desconectado"]) assert.match(tsx, new RegExp(estado), estado);
  const app = readFileSync(new URL("../app/radar-app.tsx", import.meta.url), "utf8");
  assert.match(app, /id: "lab"/);
  assert.match(app, /<AiTradingLab/);
});

test("jarvis: las preguntas del laboratorio llegan al chat, incluida la de mejor rendimiento", async () => {
  const { parseCommand } = await import("../lib/jarvis.ts");
  for (const q of ["¿Cuál tiene mejor rendimiento histórico y bajo qué condiciones?", "¿Qué está haciendo La Araña?", "¿Qué riesgos detectaste?"]) {
    assert.equal(parseCommand(q, new Set()).kind, "AI", q);
  }
  assert.equal(parseCommand("¿cuál es mi rendimiento?", new Set()).kind, "STATS", "el rendimiento de las señales sigue en su lugar");
});

test("persistencia: los límites se guardan recortados a los topes y la actividad queda con su hora", async () => {
  const guardado = new Map<string, string>();
  const eventos: string[] = [];
  const g = globalThis as unknown as { window?: unknown };
  const antes = g.window;
  g.window = {
    localStorage: { getItem: (k: string) => guardado.get(k) ?? null, setItem: (k: string, v: string) => void guardado.set(k, v) },
    dispatchEvent: (e: { type: string }) => eventos.push(e.type),
  };
  try {
    const run = await import("../lib/lab-run.ts");
    assert.deepEqual(run.limitesGuardados(), LIMITES_DEFECTO);
    const lim = run.guardarLimites({ riesgoMaxPct: 9, maxPosiciones: 3 });
    assert.equal(lim.riesgoMaxPct, TOPES.riesgoMaxPct.max);
    assert.equal(run.limitesGuardados().maxPosiciones, 3, "se lee lo guardado");
    guardado.set(run.LAB_RIESGO_KEY, "{roto");
    assert.deepEqual(run.limitesGuardados(), LIMITES_DEFECTO, "un guardado roto vuelve a los de defecto");
    run.registrarActividad("Riesgo frenó BTCUSDT", "aviso", AHORA);
    assert.equal(run.actividadLab()[0].cuando, AHORA);
    assert.ok(eventos.includes(run.LAB_EVENT));
    run.fijarBacktest({ hechos: 3, total: 10 });
    const f = run.fotoLab({ vivo: vivo(), operaciones: [op()], ahora: AHORA, enLinea: true, autoPausado: false });
    assert.deepEqual(estadoMotor(f), { estado: "processing", progreso: 0.3 });
    assert.equal(f.cartera.abiertas, 1);
    run.fijarBacktest(null);
    run.fijarError("Binance no devolvió historia suficiente de XYZ.");
    assert.equal(estadoMotor(run.fotoLab({ vivo: vivo(), operaciones: [], ahora: AHORA, enLinea: true, autoPausado: false })).estado, "error");
    run.fijarError(null);
  } finally {
    g.window = antes;
  }
});

test("araña: una vigilancia que nunca leyó dice «sin datos», no «corriendo»", () => {
  const nunca = centroDe(foto({ vivo: vivo({}, { vigilancia: { cinta: "conectando", haceMin: null, errores: 0 } }) }));
  assert.equal(nunca.tareas.find((t) => t.id === "vigilancia")?.estado, "sin datos");
  const leyo = centroDe(foto({ vivo: vivo({}, { vigilancia: { cinta: "en vivo", haceMin: 3, errores: 0 } }) }));
  assert.equal(leyo.tareas.find((t) => t.id === "vigilancia")?.estado, "corriendo");
});
