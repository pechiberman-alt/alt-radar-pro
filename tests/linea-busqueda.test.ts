// Pruebas de la búsqueda de confirmación y configuración de la línea de tendencia (lib/linea-busqueda.ts): cada
// confirmación con su caso que la cumple y el que no, la ventana del retesteo, la equivalencia con TENDENCIA_LINEA,
// que ninguna mira el futuro, y las reglas de elección que solo miran el desarrollo.
import assert from "node:assert/strict";
import test from "node:test";
import { atr, ESTRATEGIAS, indicadores, medir, operar, operarSenales, type EventoLinea, type Operacion } from "../lib/estrategias.ts";
import {
  CONFIGURACION_BASE,
  CONFIRMACIONES,
  esCandidata,
  grilla,
  masAltoPiso,
  mejorEnDesarrollo,
  mismaConfiguracion,
  mitadesDesarrollo,
  retesteLinea,
  senalesLinea,
  type Candidata,
  type Configuracion,
  type IndicadoresLinea,
} from "../lib/linea-busqueda.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const H = 3_600_000;

/** Caminata con ondas, reproducible y sin red (la misma familia que usa tests/estrategias.test.ts). */
function velas(n: number, semilla = 1): SwingCandle[] {
  const out: SwingCandle[] = [];
  let p = 100;
  let s = semilla;
  for (let i = 0; i < n; i += 1) {
    s = (s * 16807) % 2147483647;
    const ruido = (s / 2147483647 - 0.5) * 2;
    const open = p;
    p = Math.max(1, p * (1 + 0.01 * Math.sin(i / 25) + 0.012 * ruido));
    const close = p;
    out.push({ openTime: i * H, open, high: Math.max(open, close) * 1.004, low: Math.min(open, close) * 0.996, close, volume: 1 } as SwingCandle);
  }
  return out;
}

type Retoque = Partial<Pick<SwingCandle, "open" | "high" | "low" | "close" | "volume">>;

/**
 * Resistencia de dos pivotes: picos en 10 (110) y en 20 (`segundoPico`), con el precio en 100 y rangos de 2 entre medio.
 * La línea baja 0,5 por vela: en la vela 30 vale 100. `cierres` cambia el cierre de una vela; `retoques`, cualquier campo.
 */
function resistencia(opts: { n?: number; segundoPico?: number; cierres?: Record<number, number>; retoques?: Record<number, Retoque> } = {}): SwingCandle[] {
  const { n = 31, segundoPico = 105, cierres = {}, retoques = {} } = opts;
  return Array.from({ length: n }, (_, i) => {
    let close = cierres[i] ?? 100;
    let high = Math.max(101, close + 0.5);
    const low = 99;
    if (i === 10) {
      close = 100;
      high = 110;
    }
    if (i === 20) {
      close = 100;
      high = segundoPico;
    }
    return { openTime: i * H, open: close, high, low, close, volume: 1, ...retoques[i] } as SwingCandle;
  });
}

/** Indicadores de la serie; cada prueba cambia solo lo que quiere probar. */
function indice(v: SwingCandle[], extra: Partial<IndicadoresLinea> = {}): IndicadoresLinea {
  const n = v.length;
  return {
    atr14: atr(v, 14),
    volRel: new Array<number>(n).fill(1),
    ema200: new Array<number>(n).fill(Number.NaN),
    htfDir: new Array<number>(n).fill(Number.NaN),
    ...extra,
  };
}

/** La misma serie vista al revés del precio: una resistencia rota hacia arriba pasa a soporte roto hacia abajo. */
function espejo(v: SwingCandle[]): SwingCandle[] {
  return v.map((x) => ({ openTime: x.openTime, open: 200 - x.open, high: 200 - x.low, low: 200 - x.high, close: 200 - x.close, volume: x.volume }) as SwingCandle);
}

const serieCon = (n: number, valores: Record<number, number>): number[] => {
  const out = new Array<number>(n).fill(Number.NaN);
  for (const [i, x] of Object.entries(valores)) out[Number(i)] = x;
  return out;
};

test("NINGUNA: la ruptura de la resistencia da LONG en la vela de ruptura, con stop a 1,5 ATR y objetivo a 2 R", () => {
  const v = resistencia({ cierres: { 30: 102 } });
  const s = senalesLinea(v, indice(v), "NINGUNA", CONFIGURACION_BASE)(30);
  assert.ok(s, "hay señal en la vela de ruptura");
  const t = atr(v, 14)[30];
  assert.equal(s.lado, "LONG");
  assert.ok(Math.abs(s.stop - (102 - 1.5 * t)) < 1e-9, "stop a 1,5 ATR bajo el cierre");
  assert.ok(Math.abs(s.objetivo - (102 + 2 * 1.5 * t)) < 1e-9, "objetivo a 2 R");
  assert.equal(senalesLinea(v, indice(v), "NINGUNA", CONFIGURACION_BASE)(29), null, "antes de la ruptura no hay señal");
});

test("NINGUNA: un cierre que no pasa la línea por 0,1 ATR no es ruptura", () => {
  const v = resistencia({ cierres: { 30: 100.1 } });
  assert.equal(senalesLinea(v, indice(v), "NINGUNA", CONFIGURACION_BASE)(30), null);
});

test("espejo: una ruptura de soporte hacia abajo da SHORT, con stop y objetivo reflejados", () => {
  const v = resistencia({ cierres: { 30: 102 } });
  const w = espejo(v);
  const largo = senalesLinea(v, indice(v), "NINGUNA", CONFIGURACION_BASE)(30);
  const corto = senalesLinea(w, indice(w), "NINGUNA", CONFIGURACION_BASE)(30);
  assert.ok(largo && corto, "las dos tienen señal");
  assert.equal(corto.lado, "SHORT");
  assert.ok(Math.abs(corto.stop - (200 - largo.stop)) < 1e-9);
  assert.ok(Math.abs(corto.objetivo - (200 - largo.objetivo)) < 1e-9);
});

test("configuración: el stop va a stopAtr ATR del cierre y el objetivo a rr veces ese riesgo", () => {
  const v = resistencia({ cierres: { 30: 102 } });
  const cfg: Configuracion = { pivotes: 5, stopAtr: 2, rr: 3 };
  const s = senalesLinea(v, indice(v), "NINGUNA", cfg)(30);
  assert.ok(s, "hay señal");
  const t = atr(v, 14)[30];
  assert.ok(Math.abs(s.stop - (102 - 2 * t)) < 1e-9, "stop a 2 ATR");
  assert.ok(Math.abs(s.objetivo - (102 + 3 * 2 * t)) < 1e-9, "objetivo a 3 R");
});

test("VOLUMEN: solo cuenta la ruptura con volumen de 1,5 veces o más", () => {
  const v = resistencia({ cierres: { 30: 102 } });
  const fuerte = new Array<number>(v.length).fill(1);
  fuerte[30] = 2;
  const flojo = new Array<number>(v.length).fill(1);
  flojo[30] = 1.2;
  assert.ok(senalesLinea(v, indice(v, { volRel: fuerte }), "VOLUMEN", CONFIGURACION_BASE)(30));
  assert.equal(senalesLinea(v, indice(v, { volRel: flojo }), "VOLUMEN", CONFIGURACION_BASE)(30), null);
});

test("CIERRE_FUERTE: la ruptura tiene que cerrar en el 30 % superior de su rango", () => {
  // Rango 99 a 106 con cierre en 102: está en 0,43 del rango. Rango 99 a 102,5 con cierre en 102: está en 0,86.
  const debil = resistencia({ cierres: { 30: 102 }, retoques: { 30: { high: 106 } } });
  const fuerte = resistencia({ cierres: { 30: 102 }, retoques: { 30: { high: 102.5 } } });
  assert.equal(senalesLinea(debil, indice(debil), "CIERRE_FUERTE", CONFIGURACION_BASE)(30), null);
  assert.ok(senalesLinea(fuerte, indice(fuerte), "CIERRE_FUERTE", CONFIGURACION_BASE)(30));
});

test("EMA200: la ruptura alcista necesita el cierre por encima de la EMA; sin EMA no confirma", () => {
  const v = resistencia({ cierres: { 30: 102 } });
  assert.ok(senalesLinea(v, indice(v, { ema200: serieCon(v.length, { 30: 101 }) }), "EMA200", CONFIGURACION_BASE)(30));
  assert.equal(senalesLinea(v, indice(v, { ema200: serieCon(v.length, { 30: 103 }) }), "EMA200", CONFIGURACION_BASE)(30), null);
  assert.equal(senalesLinea(v, indice(v), "EMA200", CONFIGURACION_BASE)(30), null);
});

test("HTF: solo confirma si el marco superior va en el sentido de la ruptura", () => {
  const v = resistencia({ cierres: { 30: 102 } });
  assert.ok(senalesLinea(v, indice(v, { htfDir: serieCon(v.length, { 30: 1 }) }), "HTF", CONFIGURACION_BASE)(30));
  assert.equal(senalesLinea(v, indice(v, { htfDir: serieCon(v.length, { 30: -1 }) }), "HTF", CONFIGURACION_BASE)(30), null);
  assert.equal(senalesLinea(v, indice(v), "HTF", CONFIGURACION_BASE)(30), null);
});

test("CIERRE_SIGUIENTE: entra en la vela después de la ruptura, si esa también cierra del lado de la ruptura", () => {
  const sigue = resistencia({ n: 33, cierres: { 30: 102, 31: 101 } });
  const vuelve = resistencia({ n: 33, cierres: { 30: 102, 31: 99 } });
  const s1 = senalesLinea(sigue, indice(sigue), "CIERRE_SIGUIENTE", CONFIGURACION_BASE);
  assert.equal(s1(30), null, "la ruptura sola todavía no basta");
  assert.ok(s1(31), "la vela siguiente confirma");
  const s2 = senalesLinea(vuelve, indice(vuelve), "CIERRE_SIGUIENTE", CONFIGURACION_BASE);
  assert.equal(s2(31), null, "si vuelve del otro lado de la línea, no");
});

test("REENTRADA: el retesteo que cierra del lado de la ruptura confirma; si la línea falla antes, no hay señal", () => {
  const vuelve = resistencia({ n: 33, cierres: { 30: 102, 31: 101 } });
  const sv = senalesLinea(vuelve, indice(vuelve), "REENTRADA", CONFIGURACION_BASE);
  assert.equal(sv(30), null, "la ruptura sola no basta");
  assert.ok(sv(31), "el retesteo en 31 confirma");
  const falla = resistencia({ n: 33, cierres: { 30: 102, 31: 98 } });
  const sf = senalesLinea(falla, indice(falla), "REENTRADA", CONFIGURACION_BASE);
  for (let i = 30; i < 33; i += 1) assert.equal(sf(i), null, `la línea falló en 31, así que no hay retesteo en ${i}`);
});

test("REENTRADA: el retesteo cuenta hasta 30 velas después de la ruptura, no más", () => {
  const e: EventoLinea = { signo: 1, a: { i: 0, price: 100, kind: "high", confirmedAt: 0 }, pendiente: 0, atrB: 1 };
  const n = 80;
  const atr14 = new Array<number>(n).fill(1);
  const vela = (j: number, cierre: number, minimo: number): SwingCandle => ({ openTime: j * H, open: cierre, high: cierre + 1, low: minimo, close: cierre, volume: 1 }) as SwingCandle;
  const sinToque = (): SwingCandle[] => Array.from({ length: n }, (_, j) => vela(j, 103, 102));
  const eventos: (EventoLinea | null)[] = new Array<EventoLinea | null>(n).fill(null);
  eventos[10] = e;
  const dentro = sinToque();
  dentro[40] = vela(40, 101, 99.5); // 10 + 30: último día de la ventana
  const fuera = sinToque();
  fuera[41] = vela(41, 101, 99.5); // un día después de la ventana
  assert.ok(retesteLinea(dentro, atr14, eventos)[40], "el retesteo en la última vela de la ventana cuenta");
  assert.equal(retesteLinea(fuera, atr14, eventos)[41], null, "después de la ventana no cuenta");
});

test("grilla: 27 configuraciones distintas, y la base está entre ellas", () => {
  const g = grilla();
  assert.equal(g.length, 27);
  assert.equal(new Set(g.map((c) => `${c.pivotes}|${c.stopAtr}|${c.rr}`)).size, 27);
  assert.ok(g.some((c) => mismaConfiguracion(c, CONFIGURACION_BASE)));
});

test("la variante base (NINGUNA, 5 velas, 1,5 ATR, 2 R) reproduce TENDENCIA_LINEA operación por operación", () => {
  const e = ESTRATEGIAS.find((x) => x.id === "TENDENCIA_LINEA");
  assert.ok(e, "existe la estrategia");
  const opciones = { marcoMs: H, horizonte: 48, feePct: 0.07 };
  let total = 0;
  for (const semilla of [7, 11, 23]) {
    const v = velas(4000, semilla);
    const esperado = operar(e, "TESTUSDT", v, opciones);
    const obtenido = operarSenales("TENDENCIA_LINEA", "TESTUSDT", v, senalesLinea(v, indicadores(v), "NINGUNA", CONFIGURACION_BASE), opciones);
    assert.deepEqual(obtenido, esperado);
    total += esperado.length;
  }
  assert.ok(total > 0, "hay operaciones que comparar");
});

test("ninguna confirmación mira el futuro: la señal en i no cambia si se cortan las velas posteriores", () => {
  const v = velas(1500, 5);
  const completos = indicadores(v);
  let senales = 0;
  for (const c of CONFIRMACIONES) {
    for (const cfg of [CONFIGURACION_BASE, { pivotes: 3, stopAtr: 1, rr: 1.5 }]) {
      const f = senalesLinea(v, completos, c, cfg);
      for (const corte of [400, 777, 1100]) {
        const corto = v.slice(0, corte);
        const g = senalesLinea(corto, indicadores(corto), c, cfg);
        for (let i = 0; i < corte; i += 1) assert.deepEqual(f(i), g(i), `${c} ${JSON.stringify(cfg)} en la vela ${i} (corte ${corte})`);
      }
      for (let i = 0; i < v.length; i += 1) if (f(i)) senales += 1;
    }
  }
  assert.ok(senales > 0, "hay señales que comparar");
});

// ── Reglas para elegir ──

const patron = (n: number, media: number): number[] => Array.from({ length: n }, (_, k) => (k % 2 === 0 ? media + 0.6 : media - 0.6));

/** Una operación por hora, con el R dado: la hora de apertura marca la mitad del desarrollo en que cae. */
function operaciones(rs: number[]): Operacion[] {
  return rs.map((r, k) => ({ estrategia: "TENDENCIA_LINEA", symbol: "X", lado: "LONG", abiertaA: k * H, cerradaA: k * H + 1, r, tp1: false, tp2: false, tp3: false, sl: r < 0 }));
}

/** Desarrollo de 240 horas (dos mitades de 120), con las operaciones dadas. */
const DESDE = 0;
const CORTE = 240 * H;
function variante(rs: number[]): Candidata {
  const dev = operaciones(rs).filter((o) => o.abiertaA < CORTE);
  const [m1, m2] = mitadesDesarrollo(dev, DESDE, CORTE);
  return { dev: medir(dev), mitades: [medir(m1), medir(m2)] };
}

test("elección: solo cuentan las candidatas (100 o más operaciones, positivas en cada mitad) y gana la de piso más alto", () => {
  const estable = variante([...patron(120, 0.3), ...patron(120, 0.3)]);
  const cae = variante([...patron(120, 0.5), ...patron(120, -0.1)]);
  const chica = variante(patron(90, 0.9));
  assert.equal(esCandidata(estable), true);
  assert.equal(esCandidata(cae), false, "gana en una mitad y pierde en la otra");
  assert.equal(esCandidata(chica), false, "menos de 100 operaciones");
  assert.equal(mejorEnDesarrollo([cae, chica, estable]), estable);
  assert.equal(mejorEnDesarrollo([cae, chica]), null, "sin candidata estable no se elige ninguna");
  assert.notEqual(masAltoPiso([cae, chica]), null, "pero la fase sigue con la de piso más alto");
});

test("mitadesDesarrollo parte el desarrollo por la hora de apertura en dos mitades iguales", () => {
  const dev = operaciones(patron(240, 0)).filter((o) => o.abiertaA < CORTE);
  const [a, b] = mitadesDesarrollo(dev, DESDE, CORTE);
  assert.equal(a.length, 120);
  assert.equal(b.length, 120);
  assert.ok(a.every((o) => o.abiertaA < CORTE / 2) && b.every((o) => o.abiertaA >= CORTE / 2));
});
