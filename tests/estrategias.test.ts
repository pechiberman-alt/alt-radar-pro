import assert from "node:assert/strict";
import test from "node:test";
import { conAuditoria, ema, ESTRATEGIAS, eventosLinea, indicadores, medir, MUESTRA_ESTUDIO, operar, rsi, rupturasLinea, veredicto, type Indicadores, type Operacion } from "../lib/estrategias.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const H = 3_600_000;
/** Velas sintéticas reproducibles: una caminata con ondas, sin red. */
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

test("indicadores: EMA y RSI conocidos", () => {
  assert.deepEqual(ema([1, 2, 3, 4], 2).map((x) => (Number.isNaN(x) ? null : +x.toFixed(4))), [null, 1.5, 2.5, 3.5]);
  const sube = rsi(Array.from({ length: 20 }, (_, i) => i), 14);
  assert.equal(sube[19], 100, "solo subidas: RSI 100");
});

test("ninguna estrategia mira el futuro: la señal en i no cambia si se borran las velas posteriores", () => {
  const v = velas(600);
  const completos = indicadores(v);
  for (const e of ESTRATEGIAS) {
    for (const i of [250, 330, 420, 510]) {
      const corto = v.slice(0, i + 1);
      const a = e.senal(v, completos, i);
      const b = e.senal(corto, indicadores(corto), i);
      assert.deepEqual(a, b, `${e.id} en la vela ${i}`);
    }
  }
});

test("operar: entra a la apertura siguiente, una operación por vez, con la escalera de la app", () => {
  const v = velas(3000, 7);
  for (const e of ESTRATEGIAS) {
    const ops = operar(e, "TESTUSDT", v, { marcoMs: H, horizonte: 48, feePct: 0.07 });
    for (let k = 0; k < ops.length; k += 1) {
      const o = ops[k];
      assert.ok(o.cerradaA > o.abiertaA, `${e.id}: cierra después de abrir`);
      if (k > 0) assert.ok(o.abiertaA >= ops[k - 1].cerradaA, `${e.id}: nunca dos a la vez`);
      if (o.tp3) assert.ok(o.tp2 && o.tp1, "TP3 implica haber pasado TP1 y TP2");
      if (o.sl) assert.ok(o.r < 0, "el stop siempre pierde (con comisión)");
    }
  }
});

test("medir: winrate, tasas de objetivos, profit factor, expectancia con intervalo y caída", () => {
  const op = (r: number, t: number, tp: number): Operacion => ({
    estrategia: "RSI", symbol: "X", lado: "LONG", abiertaA: t, cerradaA: t + 1, r, tp1: tp >= 1, tp2: tp >= 2, tp3: tp >= 3, sl: r < 0,
  });
  const m = medir([op(2, 1, 3), op(-1, 2, 0), op(-1, 3, 1), op(1.5, 4, 3)]);
  assert.equal(m.operaciones, 4);
  assert.equal(m.winRate, 0.5);
  assert.equal(m.tasaTp1, 0.75);
  assert.equal(m.tasaTp3, 0.5);
  assert.equal(m.profitFactor, 3.5 / 2);
  assert.equal(m.expectancia, 1.5 / 4);
  assert.equal(m.maxCaidaR, 2);
  assert.ok(m.expectanciaIc && m.expectanciaIc.low < m.expectancia! && m.expectanciaIc.high > m.expectancia!);
});

test("veredicto: con muestra chica no se concluye; ventaja solo si el intervalo queda sobre cero y le gana al control", () => {
  const base = medir([]);
  assert.equal(veredicto(base, null), "SIN CONCLUSIÓN");
  const m = (exp: number, low: number, high: number, n = MUESTRA_ESTUDIO) => ({ ...base, operaciones: n, expectancia: exp, expectanciaIc: { low, high } });
  assert.equal(veredicto(m(0.2, 0.05, 0.35), m(-0.1, -0.2, 0)), "VENTAJA");
  assert.equal(veredicto(m(0.2, 0.05, 0.35), m(0.3, 0.1, 0.5)), "SIN CONCLUSIÓN", "no le gana al azar");
  assert.equal(veredicto(m(-0.2, -0.3, -0.1), null), "SIN VENTAJA");
  assert.equal(veredicto(m(0.2, -0.05, 0.45), null), "SIN CONCLUSIÓN");
  assert.equal(veredicto(m(0.5, 0.2, 0.8, 50), null), "SIN CONCLUSIÓN", "menos de 100 operaciones");
});

test("auditoría: una VENTAJA con DSR bajo o desconocido baja a CANDIDATA; el resto no cambia", () => {
  assert.equal(conAuditoria("VENTAJA", 0.99), "VENTAJA");
  assert.equal(conAuditoria("VENTAJA", 0.5), "CANDIDATA");
  assert.equal(conAuditoria("VENTAJA", null), "CANDIDATA", "desconocido no es aprobado");
  assert.equal(conAuditoria("SIN VENTAJA", 0.99), "SIN VENTAJA");
});

test("supertrend: en una subida sostenida queda alcista con la línea por debajo del precio, y da vuelta al caer fuerte", async () => {
  const { supertrend } = await import("../lib/estrategias.ts");
  const v: SwingCandle[] = [];
  for (let i = 0; i < 60; i += 1) {
    const p = i < 40 ? 100 + i : 140 - (i - 40) * 4;
    v.push({ openTime: i * H, open: p, high: p + 1, low: p - 1, close: p, volume: 1 } as SwingCandle);
  }
  const st = supertrend(v, 10, 3);
  assert.equal(st.dir[35], 1);
  assert.ok(st.linea[35] < v[35].close);
  assert.equal(st.dir[59], -1, "la caída lo da vuelta");
  assert.ok(st.linea[59] > v[59].close);
});

test("VWAP semanal: promedio ponderado por volumen que se reinicia cada lunes, sin mirar adelante", async () => {
  const { vwapSemanal } = await import("../lib/estrategias.ts");
  const D = 86_400_000;
  const lunes = 4 * D; // 05/01/1970, lunes 00:00 UTC
  const vela = (t: number, precio: number, volume: number) => ({ openTime: t, open: precio, high: precio, low: precio, close: precio, volume }) as SwingCandle;
  const v = [vela(lunes, 10, 1), vela(lunes + D, 20, 3), vela(lunes + 7 * D, 50, 2)];
  const w = vwapSemanal(v);
  assert.equal(w[0], 10);
  assert.equal(w[1], (10 * 1 + 20 * 3) / 4);
  assert.equal(w[2], 50, "el lunes siguiente arranca de nuevo");
  const largo = velas(500, 3);
  const completo = vwapSemanal(largo);
  const corto = vwapSemanal(largo.slice(0, 301));
  assert.equal(completo[300], corto[300], "la vela 300 no cambia si se borran las siguientes");
});

test("perfil de volumen: el POC cae donde se concentró el volumen y no mira adelante", async () => {
  const { pocPerfil } = await import("../lib/estrategias.ts");
  const v: SwingCandle[] = [];
  for (let i = 0; i < 260; i += 1) {
    const p = i % 2 === 0 ? 100 : 120;
    v.push({ openTime: i * H, open: p, high: p + 1, low: p - 1, close: p, volume: p === 100 ? 5 : 1 } as SwingCandle);
  }
  const poc = pocPerfil(v);
  assert.ok(Number.isNaN(poc[100]), "sin 200 velas no hay perfil");
  assert.ok(Math.abs(poc[259] - 100) < 1.5, `el volumen está en 100, no en 120 (POC ${poc[259]})`);
  const largo = velas(500, 5);
  assert.equal(pocPerfil(largo)[400], pocPerfil(largo.slice(0, 401))[400]);
});

test("marco superior (HTF): usa solo el día ya cerrado y no mira adelante", async () => {
  const { direccionHtf, supertrend } = await import("../lib/estrategias.ts");
  const F = 4 * H;
  const D = 24 * H;
  const v: SwingCandle[] = [];
  for (let i = 0; i < 6 * 60; i += 1) {
    const dia = Math.floor(i / 6);
    const p = dia < 30 ? 100 + dia * 2 : 160 - (dia - 30) * 5; // sube 30 días y después cae
    v.push({ openTime: i * F, open: p, high: p + 1, low: p - 1, close: p, volume: 1 } as SwingCandle);
  }
  const h = direccionHtf(v);
  assert.equal(h[6 * 25 + 2], 1, "en la suba, el diario es alcista");
  assert.equal(h[v.length - 1], -1, "tras la caída, bajista");
  // Dentro de un día en curso se usa el día anterior: la vela 0 del día no ve el cierre de su propio día.
  const diario = supertrend(
    Array.from({ length: 60 }, (_, d) => ({ openTime: d * D, open: v[d * 6].open, high: v[d * 6].open + 1, low: v[d * 6].open - 1, close: v[d * 6 + 5].close, volume: 1 }) as SwingCandle),
    10,
    3,
  ).dir;
  assert.equal(h[6 * 40], diario[39], "primera vela del día 40: dirección del día 39");
  assert.equal(h[6 * 40 + 5], diario[40], "la última vela del día 40 cierra el día");
  for (const i of [200, 250, 300]) assert.equal(direccionHtf(v.slice(0, i + 1))[i], h[i], `vela ${i} sin las posteriores`);
});

test("alineación del MACD y del RSI en los marcos superiores: +1 con una suba que se acelera, -1 con una caída que se acelera, y no mira la vela en curso", async () => {
  const { alineacionHtf } = await import("../lib/estrategias.ts");
  const serieDe = (f: (i: number) => number): SwingCandle[] =>
    Array.from({ length: 24 * 120 }, (_, i) => {
      const p = f(i);
      return { openTime: i * H, open: p, high: p * 1.001, low: p * 0.999, close: p, volume: 1 } as SwingCandle;
    });
  const sube = serieDe((i) => 100 * Math.exp(5.2e-7 * i * i));
  const baja = serieDe((i) => 100 * Math.exp(-5.2e-7 * i * i));
  assert.equal(alineacionHtf(sube)[24 * 100 + 23], 1, "suba: 4 h y diario alcistas");
  // En esta caída, el MACD de 4 h y el diario quedan bajo su señal entre el día 35 y el 40; después el de 4 h se da vuelta primero.
  assert.equal(alineacionHtf(baja)[24 * 38 + 23], -1, "caída: 4 h y diario bajistas");
  for (const v of [sube, baja]) {
    const completo = alineacionHtf(v);
    for (const i of [24 * 60 + 5, 24 * 80 + 5, 24 * 110 + 5]) {
      assert.equal(alineacionHtf(v.slice(0, i + 1))[i], completo[i], `vela ${i} sin las posteriores`);
    }
  }
});

test("alineación en 15 min y en 3 min: mira las temporalidades superiores y no la vela en curso", async () => {
  const { alineacionHtf } = await import("../lib/estrategias.ts");
  const serieDe = (paso: number, f: (horas: number) => number): SwingCandle[] =>
    Array.from({ length: (120 * 24 * H) / paso }, (_, i) => {
      const p = f((i * paso) / H);
      return { openTime: i * paso, open: p, high: p * 1.001, low: p * 0.999, close: p, volume: 1 } as SwingCandle;
    });
  const sube = (horas: number) => 100 * Math.exp(5.2e-7 * horas * horas);
  const baja = (horas: number) => 100 * Math.exp(-5.2e-7 * horas * horas);
  for (const paso of [15 * 60_000, 3 * 60_000]) {
    const porDia = (24 * H) / paso;
    const alzas = serieDe(paso, sube);
    const bajas = serieDe(paso, baja);
    assert.equal(alineacionHtf(alzas)[porDia * 100 - 1], 1, `${paso / 60_000} min: suba, último momento del día 100`);
    assert.equal(alineacionHtf(bajas)[porDia * 38 - 1], -1, `${paso / 60_000} min: caída, último momento del día 38`);
    for (const v of [alzas, bajas]) {
      const completo = alineacionHtf(v);
      // En la mitad de una hora, de un 4 h y de un día: la vela en curso no cuenta.
      for (const i of [porDia * 60 + (H / paso) * 5 + 1, porDia * 80 + ((4 * H) / paso) * 2 + 1, porDia * 90 + porDia / 2 + 1]) {
        assert.equal(alineacionHtf(v.slice(0, i + 1))[i], completo[i], `vela ${i} de ${paso / 60_000} min sin las posteriores`);
      }
    }
  }
});

test("azar: entra en un 2 % de las velas también en 15 min, y sus entradas no vienen en racimos de una hora", () => {
  const e = ESTRATEGIAS.find((x) => x.id === "AZAR")!;
  const paso = 15 * 60_000;
  const n = 96 * 300;
  const v = Array.from({ length: n }, (_, i) => {
    const p = 100 + Math.sin(i / 7) * 5;
    return { openTime: i * paso, open: p, high: p + 1, low: p - 1, close: p, volume: 1 } as SwingCandle;
  });
  const ind = indicadores(v);
  const entra = v.map((_, i) => e.senal(v, ind, i) !== null);
  const cuenta = entra.filter(Boolean).length;
  const conVecina = entra.filter((x, i) => x && i > 0 && entra[i - 1]).length;
  assert.ok(cuenta / n > 0.012 && cuenta / n < 0.028, `entra en ${((100 * cuenta) / n).toFixed(2)} % de las velas`);
  assert.ok(conVecina / cuenta < 0.05, "las entradas no vienen en racimos de una hora");
});

test("MACD_MTF_SNR: entra solo con el cruce, el RSI del lado, los marcos superiores alineados y un nivel SNR rechazado", () => {
  const e = ESTRATEGIAS.find((x) => x.id === "MACD_MTF_SNR")!;
  const n = 8;
  const v = Array.from({ length: n }, (_, k) => ({ openTime: k * H, open: 100, high: 101, low: 99, close: 100, volume: 1 }) as SwingCandle);
  const serie = (x: number) => Array.from({ length: n }, () => x);
  const bien: Record<string, number[]> = {
    macd: [-1, -1, -1, -1, -1, 1, 1, 1], macdSenal: serie(0), ema200: serie(90), atr14: serie(2), rsi14: serie(60),
    alineacionHtf: serie(1), snrSop: serie(95), snrRes: serie(Number.NaN),
  };
  const senal = (x: Record<string, number[]>) => e.senal(v, x as unknown as Indicadores, 5);
  assert.deepEqual(senal(bien), { lado: "LONG", stop: 97, objetivo: 106 });
  assert.equal(senal({ ...bien, snrSop: serie(Number.NaN) }), null, "sin nivel SNR rechazado no hay señal");
  assert.equal(senal({ ...bien, rsi14: serie(40) }), null, "el RSI está del otro lado");
  assert.equal(senal({ ...bien, alineacionHtf: serie(0) }), null, "los marcos superiores no coinciden");
  assert.equal(senal({ ...bien, alineacionHtf: serie(-1) }), null, "los marcos superiores van para abajo");
  assert.equal(senal({ ...bien, ema200: serie(110) }), null, "cruce alcista bajo la EMA 200");
  const corto: Record<string, number[]> = {
    ...bien, macd: [1, 1, 1, 1, 1, -1, -1, -1], ema200: serie(110), rsi14: serie(40), alineacionHtf: serie(-1),
    snrSop: serie(Number.NaN), snrRes: serie(105),
  };
  assert.deepEqual(senal(corto), { lado: "SHORT", stop: 103, objetivo: 94 }, "el espejo: cruce bajista, RSI bajo 50 y rechazo de resistencia");
});

test("volumen relativo: contra el promedio de las 20 anteriores, sin la vela misma ni las siguientes", async () => {
  const { volumenRelativo } = await import("../lib/estrategias.ts");
  const v = Array.from({ length: 40 }, (_, i) => ({ openTime: i * H, open: 1, high: 1, low: 1, close: 1, volume: i === 30 ? 30 : 10 }) as SwingCandle);
  const x = volumenRelativo(v);
  assert.ok(Number.isNaN(x[19]), "sin 20 velas previas no hay dato");
  assert.equal(x[20], 1);
  assert.equal(x[30], 3, "30 contra un promedio de 10");
  assert.ok(Math.abs(x[31] - 10 / ((19 * 10 + 30) / 20)) < 1e-12, "el pico entra al promedio de la vela siguiente");
  assert.equal(volumenRelativo(v.slice(0, 31))[30], x[30]);
});

test("SNR: un nivel fresco da señal solo en su primera visita con rechazo, y después se gasta", async () => {
  const { nivelesSnr } = await import("../lib/estrategias.ts");
  const vela = (i: number, o: number, h: number, l: number, c: number) => ({ openTime: i * H, open: o, high: h, low: l, close: c, volume: 1 }) as SwingCandle;
  // Pico de cierres en 110 (vela 2), baja y vuelve a visitar el 110 con la mecha dos veces.
  const v = [vela(0, 100, 101, 99, 100), vela(1, 100, 108, 100, 108), vela(2, 108, 111, 108, 110), vela(3, 110, 110, 100, 102), vela(4, 102, 104, 100, 103), vela(5, 103, 112, 103, 108), vela(6, 108, 112, 105, 107)];
  const { res, sop } = nivelesSnr(v);
  assert.equal(res[5], 110, "la primera mecha sobre 110 que cierra abajo es la señal");
  assert.ok(Number.isNaN(res[6]), "el nivel ya se gastó: la segunda visita no es señal");
  assert.ok(Number.isNaN(res[3]) && Number.isNaN(res[2]), "ni en la vela del pico ni en la siguiente (se conoce una vela después y se toca desde la otra)");
  // Un hueco al alza entre dos velas verdes es un soporte en la apertura de la segunda.
  const g = [vela(0, 100, 101, 99, 100), vela(1, 100, 104, 100, 104), vela(2, 106, 110, 105, 109), vela(3, 109, 112, 108, 111), vela(4, 111, 112, 105.9, 108), vela(5, 108, 109, 107, 108)];
  assert.equal(nivelesSnr(g).sop[4], 106, "la mecha llega a 106 y cierra por encima");
  assert.ok(Number.isNaN(sop[5]));
});

const barra = (i: number, close: number, high: number, low: number) => ({ openTime: i * H, open: close, high, low, close, volume: 1 }) as SwingCandle;
/** Picos de 110 (vela 10) y de `segundoPico` (vela 20): una resistencia que baja 0,5 por vela y vale 100 en la vela 30. */
function resistencia(segundoPico: number, cierres: Record<number, number> = {}): SwingCandle[] {
  return Array.from({ length: 31 }, (_, i) => {
    if (i === 10) return barra(i, 100, 110, 99);
    if (i === 20) return barra(i, 100, segundoPico, 99);
    const c = cierres[i] ?? 100;
    return barra(i, c, Math.max(101, c + 0.5), 99);
  });
}
const rupturas = (v: SwingCandle[]) => rupturasLinea(v).flatMap((x, i) => (x !== 0 ? [i] : []));

test("rupturas de línea: el primer cierre que pasa la resistencia la rompe, una sola vez; una meseta no es línea", () => {
  const v = resistencia(105, { 30: 102 });
  assert.deepEqual(rupturas(v), [30], "el cierre de 102 pasa la línea, que vale 100 en la vela 30");
  assert.deepEqual(rupturas(resistencia(105, { 26: 103, 30: 103 })), [26], "rompe en la vela 26, la primera después de conocerse el pico 20; después la línea ya no cuenta");
  assert.deepEqual(rupturas(resistencia(110, { 30: 102 })), [], "dos picos a la misma altura forman una meseta, no una línea");
  const e = ESTRATEGIAS.find((x) => x.id === "TENDENCIA_LINEA")!;
  const ind = indicadores(v);
  const s = e.senal(v, ind, 30)!;
  assert.equal(s.lado, "LONG");
  assert.ok(Math.abs(s.stop - (102 - 1.5 * ind.atr14[30])) < 1e-9, "stop a 1,5 ATR por debajo");
  assert.ok(Math.abs(s.objetivo - (102 + 3 * ind.atr14[30])) < 1e-9, "objetivo a 2 R por encima");
  assert.equal(e.senal(v, ind, 29), null, "sin ruptura no hay señal");
});

test("rupturas de línea: una línea que ya se había pasado antes de conocerse su segundo pico no cuenta", () => {
  // El pico 20 se conoce en la vela 25: pasar la línea en la 22, o en la 25 misma, la invalida.
  assert.deepEqual(rupturas(resistencia(105, { 22: 104.5, 30: 102 })), []);
  assert.deepEqual(rupturas(resistencia(105, { 25: 104.5, 26: 103 })), []);
});

test("rupturas de línea: el espejo, un soporte que sube y se rompe hacia abajo da -1 y la señal es corta", () => {
  // Valles de 90 (vela 10) y 95 (vela 20): un soporte que sube 0,5 por vela y vale 100 en la vela 30; el cierre de 98 lo rompe.
  const v = Array.from({ length: 31 }, (_, i) => {
    if (i === 10) return barra(i, 100, 101, 90);
    if (i === 20) return barra(i, 100, 101, 95);
    const c = i === 30 ? 98 : 100;
    return barra(i, c, 101, Math.min(99, c - 1));
  });
  assert.equal(rupturasLinea(v)[30], -1);
  assert.deepEqual(rupturas(v), [30]);
  const e = ESTRATEGIAS.find((x) => x.id === "TENDENCIA_LINEA")!;
  const ind = indicadores(v);
  const s = e.senal(v, ind, 30)!;
  assert.equal(s.lado, "SHORT");
  assert.ok(Math.abs(s.stop - (98 + 1.5 * ind.atr14[30])) < 1e-9, "stop a 1,5 ATR por encima");
  assert.ok(Math.abs(s.objetivo - (98 - 3 * ind.atr14[30])) < 1e-9, "objetivo a 2 R por debajo");
});

test("rupturas de línea: no miran adelante, cortar la serie no cambia ninguna ruptura anterior al corte", () => {
  const v = velas(900, 3);
  const completo = rupturasLinea(v);
  assert.ok(completo.some((x) => x !== 0), "la serie tiene rupturas que comprobar");
  for (const corte of [300, 520, 777]) {
    assert.deepEqual(rupturasLinea(v.slice(0, corte)), completo.slice(0, corte), `cortada en la vela ${corte}`);
  }
});

test("eventosLinea dice lo mismo que rupturasLinea: cada evento es la ruptura con su signo", () => {
  const v = velas(3000, 9);
  const eventos = eventosLinea(v);
  assert.deepEqual(
    eventos.map((e) => (e ? e.signo : 0)),
    rupturasLinea(v),
  );
  assert.ok(eventos.some((e) => e !== null), "hay rupturas que comparar");
});
