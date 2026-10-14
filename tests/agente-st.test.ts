import assert from "node:assert/strict";
import test from "node:test";
import { ESTRATEGIAS, indicadores } from "../lib/estrategias.ts";
import { resultadoR } from "../lib/escalera.ts";
import {
  claveSt, COMISION_ST_PCT, leerSenalSt, MARCO_ST_MS, regimenAlcistaBtc, validarSenalSt, VENTANA_ENTRADA_ST_MS, type PlanSt,
} from "../lib/agente-st.ts";
import { abiertasSt, ensureAgenteSt, evaluarSt, registrarSenalSt, resultadosSt } from "../lib/agente-st-db.ts";
import { validarRecorridoFlujo } from "../lib/flujo.ts";
import { leerRegistroUnificado } from "../lib/registro-db.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";
import { makeDb } from "./helpers/fake-d1.ts";

/**
 * El agente de papel Supertrend MTF + Volumen: la señal sale de velas cerradas (nunca de las que vienen), solo largos y
 * solo con BTC alcista; lo que manda el navegador se revisa y la escalera la calcula el servidor; la entrada se
 * cierra una sola vez y entra al registro unificado como una fuente más.
 */

const F = MARCO_ST_MS;
/** Velas de 4 h reproducibles con ondas largas y picos de volumen. */
function velas(n: number, semilla: number, deriva: number): SwingCandle[] {
  const out: SwingCandle[] = [];
  let p = 100;
  let s = semilla;
  for (let i = 0; i < n; i += 1) {
    s = (s * 16807) % 2147483647;
    const ruido = (s / 2147483647 - 0.5) * 2;
    const open = p;
    p = Math.max(1, p * (1 + deriva + 0.018 * Math.sin(i / 18) + 0.01 * ruido));
    const close = p;
    out.push({ openTime: i * F, open, high: Math.max(open, close) * 1.004, low: Math.min(open, close) * 0.996, close, volume: s % 5 === 0 ? 4 : 1 } as SwingCandle);
  }
  return out;
}

/** Subidas largas con retrocesos cortos y volumen alto al arrancar cada subida: da entradas del Supertrend MTF + Volumen. */
function ciclos(n: number): SwingCandle[] {
  const out: SwingCandle[] = [];
  let p = 100;
  for (let i = 0; i < n; i += 1) {
    const k = i % 100;
    const open = p;
    p *= 1 + (k < 88 ? 0.012 : -0.01);
    out.push({ openTime: i * F, open, high: Math.max(open, p) * 1.003, low: Math.min(open, p) * 0.997, close: p, volume: k < 10 ? 4 : 1 } as SwingCandle);
  }
  return out;
}

const btcSube = velas(3200, 3, 0.0008);
const btcBaja = velas(3200, 3, -0.0008);

/** La primera vela i (con historia) en la que la estrategia del estudio da una entrada larga. */
function buscarEntradaLarga(v: SwingCandle[]): number {
  const e = ESTRATEGIAS.find((x) => x.id === "ST_MTF_VOL")!;
  const ind = indicadores(v);
  // Desde la vela 1.300: antes BTC todavía no tiene su media de 200 días.
  for (let i = 1300; i < v.length - 2; i += 1) {
    const s = e.senal(v, ind, i);
    if (s && s.lado === "LONG") return i;
  }
  throw new Error("la serie sintética no dio ninguna entrada larga");
}

test("régimen de BTC: alcista solo con el cierre sobre la media de 200 días y la de 50 días sobre la de 200", () => {
  assert.equal(regimenAlcistaBtc(btcSube)[3100], true);
  assert.equal(regimenAlcistaBtc(btcBaja)[3100], false);
  assert.equal(regimenAlcistaBtc(btcSube)[500], false, "sin 1.200 velas todavía no hay media de 200 días");
});

test("señal: entra a la apertura de la vela siguiente, con el riesgo y el objetivo a 2 R de esa apertura", () => {
  const par = ciclos(1500);
  const i = buscarEntradaLarga(par);
  assert.equal(regimenAlcistaBtc(btcSube.slice(0, 3000))[i], true, "BTC alcista en la vela de la señal");
  // BTC alcista y alineado en el tiempo con la moneda: la señal es la vela i, la de entrada la i+1.
  const e = ESTRATEGIAS.find((x) => x.id === "ST_MTF_VOL")!;
  const sEst = e.senal(par.slice(0, i + 1), indicadores(par.slice(0, i + 1)), i)!;
  const ahora = par[i + 1].openTime + 60_000;
  const plan = leerSenalSt("ETHUSDT", par.slice(0, i + 2), btcSube.slice(0, 3000), ahora);
  assert.ok(plan, "con BTC alcista y la vela de entrada recién abierta, hay entrada");
  const riesgo = Math.abs(par[i].close - sEst.stop);
  assert.equal(plan.lado, "LONG");
  assert.equal(plan.vela, par[i].openTime);
  assert.equal(plan.velaEntrada, par[i + 1].openTime);
  assert.equal(plan.entrada, par[i + 1].open);
  assert.ok(Math.abs(plan.entrada - plan.stop - riesgo) < 1e-9);
  assert.ok(Math.abs((plan.objetivo - plan.entrada) / riesgo - 2) < 1e-9);
  assert.ok(plan.foto.volRel >= 1.5 && plan.foto.htf === 1);
});

test("señal: con BTC bajista, fuera de la ventana de media hora o sin la vela de entrada, no hay entrada", () => {
  const par = ciclos(1500);
  const i = buscarEntradaLarga(par);
  const ahora = par[i + 1].openTime + 60_000;
  assert.equal(leerSenalSt("ETHUSDT", par.slice(0, i + 2), btcBaja.slice(0, 3000), ahora), null, "BTC bajista");
  assert.equal(leerSenalSt("ETHUSDT", par.slice(0, i + 2), btcSube.slice(0, 3000), par[i + 1].openTime + VENTANA_ENTRADA_ST_MS + 1), null, "tarde para esa entrada");
  assert.equal(leerSenalSt("ETHUSDT", par.slice(0, i + 1), btcSube.slice(0, 3000), ahora), null, "falta la vela de entrada");
});

test("señal: no mira adelante; las velas que vienen después de la de entrada no cambian nada", () => {
  const par = ciclos(1500);
  const i = buscarEntradaLarga(par);
  const ahora = par[i + 1].openTime + 60_000;
  const a = leerSenalSt("ETHUSDT", par.slice(0, i + 2), btcSube.slice(0, 3000), ahora);
  const b = leerSenalSt("ETHUSDT", par.slice(0, i + 2), btcSube.slice(0, 3200), ahora);
  assert.ok(a);
  assert.deepEqual(a, b, "las velas de BTC posteriores a ahora se ignoran");
});

const plan = (): PlanSt => ({
  symbol: "ETHUSDT", lado: "LONG", vela: 1000 * F, velaEntrada: 1001 * F, entrada: 100, stop: 95, objetivo: 110,
  foto: { volRel: 2, htf: 1, idm: 0, compras: 0.55 },
});
const cruda = (ahora: number, p = plan()) => ({ symbol: p.symbol, lado: p.lado, vela: p.vela, detectada: ahora, entrada: p.entrada, stop: p.stop, objetivo: p.objetivo, foto: p.foto });

test("validar: acepta la regla y calcula TP1 y TP2 a un tercio y dos tercios; rechaza lo que no es la regla", () => {
  const ahora = 1001 * F + 5 * 60_000;
  const ok = validarSenalSt(cruda(ahora), ahora);
  assert.ok(ok);
  assert.equal(ok.clave, claveSt("ETHUSDT", 1000 * F));
  assert.ok(Math.abs(ok.tp1 - (100 + 10 / 3)) < 1e-9 && Math.abs(ok.tp2 - (100 + 20 / 3)) < 1e-9 && ok.tp3 === 110);
  const mal = (cambio: Record<string, unknown>) => validarSenalSt({ ...cruda(ahora), ...cambio }, ahora);
  assert.equal(mal({ lado: "SHORT" }), null, "solo largos");
  assert.equal(mal({ symbol: "PEPEUSDT" }), null, "solo las monedas del estudio");
  assert.equal(mal({ objetivo: 120 }), null, "el objetivo es a 2 R");
  assert.equal(mal({ vela: 1000 * F + 7 }), null, "la vela tiene que ser de 4 h");
  assert.equal(validarSenalSt(cruda(ahora), ahora + VENTANA_ENTRADA_ST_MS + 5 * 60_000), null, "fuera de la ventana de entrada");
  assert.equal(mal({ foto: { volRel: 1.2, htf: 1, idm: 0, compras: null } }), null, "el volumen tiene que cumplir la regla");
  assert.equal(mal({ foto: { volRel: 2, htf: -1, idm: 0, compras: null } }), null, "el marco superior tiene que ir a favor");
});

test("recorrido: el R lo calcula el servidor con la comisión de la regla (0,07 % por lado)", () => {
  const op = { lado: "LONG" as const, vela: 1000 * F, entrada: 100, stop: 95, tp3: 110 };
  const r = validarRecorridoFlujo(op, { slAt: 1002 * F, tp1At: null, tp2At: null, tp3At: null, cerradaA: 1002 * F, desenlace: "SL", salida: 95 }, 2000 * F, COMISION_ST_PCT);
  assert.ok(r.ok);
  assert.equal(r.recorrido.r, resultadoR("LONG", 100, 95, 95, COMISION_ST_PCT));
  assert.ok((r.recorrido.r ?? 0) < -1, "el stop pierde más de 1 R por la comisión");
});

test("base: una vez por moneda y vela; se mide una sola vez; entra al registro unificado como una fuente más", async () => {
  const db = makeDb();
  await ensureAgenteSt(db);
  const velaS = Math.floor(Date.now() / F) * F - 8 * F;
  const ahora = velaS + F + 5 * 60_000;
  const p: PlanSt = { ...plan(), vela: velaS, velaEntrada: velaS + F };
  const s = validarSenalSt(cruda(ahora, p), ahora);
  assert.ok(s, "una entrada de la vela que acaba de abrir se acepta");
  assert.equal(await registrarSenalSt(db, 7, s), true);
  assert.equal(await registrarSenalSt(db, 7, s), false, "la misma moneda y vela no se repite");
  assert.equal((await abiertasSt(db, 7)).length, 1);
  assert.equal((await abiertasSt(db, 8)).length, 0, "es de la cuenta 7");
  const rec = { slAt: null, tp1At: velaS + 2 * F, tp2At: velaS + 3 * F, tp3At: velaS + 4 * F, cerradaA: velaS + 4 * F, desenlace: "TP3", salida: 110 };
  const antesDeLaHora = await evaluarSt(db, 7, [{ clave: s.clave, recorrido: { ...rec, cerradaA: Date.now() + 86_400_000, tp3At: Date.now() + 86_400_000 } }]);
  assert.equal(antesDeLaHora[0].ok, false, "una hora en el futuro se rechaza");
  assert.equal((await evaluarSt(db, 7, [{ clave: s.clave, recorrido: rec }]))[0].ok, true);
  assert.equal((await evaluarSt(db, 7, [{ clave: s.clave, recorrido: rec }]))[0].ok, false, "ya no está abierta");
  const filas = await resultadosSt(db, 7, 10);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].desenlace, "TP3");
  assert.ok((filas[0].r ?? 0) > 1.9, "TP3 a 2 R menos la comisión");
  const reg = await leerRegistroUnificado(db, 7, Date.now());
  const f = reg.fuentes.find((x) => x.id === "AGENTE_ST");
  assert.ok(f, "el registro lo lista");
  assert.equal(f.cerradas, 1);
  assert.equal(f.ganadas, 1);
  assert.equal(f.disponible, true);
});
