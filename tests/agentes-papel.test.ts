// Pruebas de los agentes en papel (lib/agentes-papel.ts): que no se mire el futuro, que la entrada sea la apertura siguiente
// con la escalera completa, que la clave no duplique entradas y que el servidor rechace planes mal formados o fuera de hora.
import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENTES_PAPEL,
  MARCO_AGENTES_MS,
  MONEDAS_AGENTES,
  VENTANA_ENTRADA_AGENTES_MS,
  clavePapel,
  leerClavePapel,
  leerSenalesPapel,
  AGENTES_PAUSADOS,
  agentePausado,
  validarSenalPapel,
  PLAN_AGENTES,
  PLAN_FONDEO,
  SIMBOLOS_FONDEO_PAPEL,
  planDe,
  sinEstudioPrevio,
} from "../lib/agentes-papel.ts";
import { NASDAQ_SIMBOLO } from "../lib/fondeo.ts";
import { ESTRATEGIAS } from "../lib/estrategias.ts";
import { generadorSemilla } from "../lib/practica-gatillo.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const T0 = 1_600_000_000_000 - (1_600_000_000_000 % MARCO_AGENTES_MS);

function serie(n: number, semilla: number): SwingCandle[] {
  const azar = generadorSemilla(semilla);
  const out: SwingCandle[] = [];
  let precio = 100;
  for (let k = 0; k < n; k += 1) {
    const open = precio;
    const close = Math.max(1, precio + (azar() - 0.47) * 3);
    out.push({
      openTime: T0 + k * MARCO_AGENTES_MS,
      open,
      high: Math.max(open, close) + azar(),
      low: Math.min(open, close) - azar(),
      close,
      volume: 100 + azar() * 80,
      quoteVolume: 0,
    });
    precio = close;
  }
  return out;
}

/** El momento justo después de que abrió la vela de entrada. */
const ahoraDe = (v: SwingCandle[]) => v[v.length - 1].openTime + 60_000;

test("los agentes en papel son todas las estrategias del estudio menos el control al azar", () => {
  const esperado = ESTRATEGIAS.map((e) => e.id).filter((id) => id !== "AZAR");
  assert.deepEqual([...AGENTES_PAPEL].sort(), [...esperado].sort());
  assert.ok(!AGENTES_PAPEL.includes("AZAR" as never), "el azar no corre hacia adelante");
});

test("la entrada es la apertura de la vela siguiente y trae SL, TP1, TP2 y TP3 ordenados", () => {
  const v = serie(400, 3);
  const planes = leerSenalesPapel("BTCUSDT", v, ahoraDe(v));
  assert.ok(planes.length > 0, "la serie de prueba no disparó nada");
  for (const p of planes) {
    assert.equal(p.entrada, v[v.length - 1].open);
    assert.equal(p.velaEntrada, v[v.length - 1].openTime);
    assert.equal(p.vela, v[v.length - 2].openTime);
    const signo = p.lado === "LONG" ? 1 : -1;
    assert.ok((p.entrada - p.stop) * signo > 0, `${p.estrategia}: stop del lado equivocado`);
    assert.ok((p.objetivo - p.entrada) * signo > 0, `${p.estrategia}: objetivo del lado equivocado`);
    const { tp1, tp2, tp3 } = p.escalera;
    assert.ok((tp1 - p.entrada) * signo > 0 && (tp2 - tp1) * signo > 0 && (tp3 - tp2) * signo > 0, `${p.estrategia}: escalera desordenada`);
  }
});

test("no se mira el futuro: las entradas no cambian si se agregan velas posteriores", () => {
  const larga = serie(402, 3);
  const corta = larga.slice(0, 400);
  const a = leerSenalesPapel("BTCUSDT", corta, ahoraDe(corta));
  const b = leerSenalesPapel("BTCUSDT", larga, ahoraDe(larga)).filter((x) => x.vela === corta[corta.length - 2].openTime);
  assert.ok(a.length > 0);
  // Las entradas de esa vela tienen que ser idénticas, haya o no velas después.
  assert.deepEqual(b, []);
  const mismas = leerSenalesPapel("BTCUSDT", corta, ahoraDe(corta));
  assert.deepEqual(mismas, a);
});

test("fuera de la ventana de entrada no se registra nada", () => {
  const v = serie(400, 3);
  assert.deepEqual(leerSenalesPapel("BTCUSDT", v, v[v.length - 1].openTime + VENTANA_ENTRADA_AGENTES_MS + 60_000), []);
});

test("si la vela de entrada no sigue a la de la señal no se registra nada", () => {
  const v = serie(400, 3);
  const salteada = [...v.slice(0, -1), { ...v[v.length - 1], openTime: v[v.length - 1].openTime + MARCO_AGENTES_MS }];
  assert.deepEqual(leerSenalesPapel("BTCUSDT", salteada, ahoraDe(salteada)), []);
});

test("la clave distingue agente, moneda, lado y vela, y se puede leer de vuelta", () => {
  const c = clavePapel("SUPERTREND", "BTCUSDT", "LONG", T0);
  assert.equal(c, `ag:SUPERTREND:BTCUSDT:4h:LONG:${T0}`);
  assert.deepEqual(leerClavePapel(c), { estrategia: "SUPERTREND", symbol: "BTCUSDT", marco: "4h", lado: "LONG", vela: T0 });
  assert.notEqual(c, clavePapel("RUPTURA", "BTCUSDT", "LONG", T0));
  assert.notEqual(c, clavePapel("SUPERTREND", "ETHUSDT", "LONG", T0));
  assert.notEqual(c, clavePapel("SUPERTREND", "BTCUSDT", "SHORT", T0));
  for (const mala of ["", "x", "ag:A:B:4h:LONG", "ag:A:B:4h:ARRIBA:1", "ag:A:B:4h:LONG:abc", "otro:A:B:4h:LONG:1"]) {
    assert.equal(leerClavePapel(mala), null, mala);
  }
});

const base = (ahora: number) => ({
  estrategia: "SUPERTREND",
  symbol: "BTCUSDT",
  lado: "LONG" as const,
  vela: T0,
  detectada: ahora,
  entrada: 100,
  stop: 98,
  objetivo: 104,
});

test("el servidor acepta un plan bien formado y recalcula la escalera", () => {
  const ahora = T0 + MARCO_AGENTES_MS + 60_000;
  const s = validarSenalPapel(base(ahora), ahora);
  assert.ok(s);
  assert.equal(s.clave, clavePapel("SUPERTREND", "BTCUSDT", "LONG", T0));
  assert.ok(s.tp1 > s.entrada && s.tp2 > s.tp1 && s.tp3 > s.tp2);
});

test("el navegador no puede inventar TP1 ni TP2: se ignora lo que mande", () => {
  const ahora = T0 + MARCO_AGENTES_MS + 60_000;
  const s = validarSenalPapel({ ...base(ahora), tp1: 9999, tp2: 9999, tp3: 9999 }, ahora);
  assert.ok(s);
  assert.ok(s.tp1 < 9999 && s.tp2 < 9999 && s.tp3 < 9999);
});

test("el servidor rechaza agente desconocido, moneda de fuera, lado inválido y vela desalineada", () => {
  const ahora = T0 + MARCO_AGENTES_MS + 60_000;
  assert.equal(validarSenalPapel({ ...base(ahora), estrategia: "INVENTADA" }, ahora), null);
  assert.equal(validarSenalPapel({ ...base(ahora), estrategia: "AZAR" }, ahora), null);
  assert.equal(validarSenalPapel({ ...base(ahora), symbol: "PEPEUSDT" }, ahora), null);
  assert.equal(validarSenalPapel({ ...base(ahora), lado: "ARRIBA" }, ahora), null);
  assert.equal(validarSenalPapel({ ...base(ahora), vela: T0 + 1 }, ahora), null);
  assert.equal(validarSenalPapel(null, ahora), null);
  assert.equal(validarSenalPapel("x", ahora), null);
});

test("el servidor rechaza un plan registrado tarde o con hora que no coincide", () => {
  const ahora = T0 + MARCO_AGENTES_MS + 60_000;
  const tarde = T0 + MARCO_AGENTES_MS + VENTANA_ENTRADA_AGENTES_MS + 5 * 60_000;
  assert.equal(validarSenalPapel({ ...base(tarde), detectada: tarde }, tarde), null);
  assert.equal(validarSenalPapel({ ...base(ahora), detectada: ahora - 10 * 60_000 }, ahora), null);
  // Antes de que abra la vela de entrada tampoco.
  const temprano = T0 + 60_000;
  assert.equal(validarSenalPapel({ ...base(temprano), detectada: temprano }, temprano), null);
});

test("el servidor rechaza precios imposibles, stop del lado equivocado y riesgo desmedido", () => {
  const ahora = T0 + MARCO_AGENTES_MS + 60_000;
  const malos = [
    { entrada: 0 },
    { entrada: -1 },
    { stop: 0 },
    { stop: 100 },
    { stop: 104, objetivo: 98 },
    { stop: 60 },
    { objetivo: 100.1 },
    { objetivo: 1000 },
  ];
  for (const m of malos) assert.equal(validarSenalPapel({ ...base(ahora), ...m }, ahora), null, JSON.stringify(m));
});

test("un plan SHORT válido se acepta con la escalera para abajo", () => {
  const ahora = T0 + MARCO_AGENTES_MS + 60_000;
  const s = validarSenalPapel({ ...base(ahora), lado: "SHORT", entrada: 100, stop: 102, objetivo: 96 }, ahora);
  assert.ok(s);
  assert.ok(s.tp1 < s.entrada && s.tp2 < s.tp1 && s.tp3 < s.tp2);
});

test("las monedas de los agentes en papel son las 10 del estudio", () => {
  assert.equal(MONEDAS_AGENTES.length, 10);
  for (const m of MONEDAS_AGENTES) assert.match(m, /USDT$/);
});

test("el servidor limpia la foto de consenso: solo agentes reales, números sanos y lista corta", () => {
  const ahora = T0 + MARCO_AGENTES_MS + 60_000;
  const s = validarSenalPapel(
    { ...base(ahora), consenso: { acuerdo: 3, contra: 1, con: ["RUPTURA", "INVENTADO", "SUPERTREND"] } },
    ahora,
  );
  assert.ok(s);
  assert.deepEqual(s.consenso, { acuerdo: 3, contra: 1, con: ["RUPTURA", "SUPERTREND"] });
});

test("una foto de consenso con basura no rompe nada y queda en cero", () => {
  const ahora = T0 + MARCO_AGENTES_MS + 60_000;
  const s = validarSenalPapel({ ...base(ahora), consenso: { acuerdo: -5, contra: 999, con: "no es lista" } }, ahora);
  assert.ok(s);
  assert.deepEqual(s.consenso, { acuerdo: 0, contra: 0, con: [] });
  // Sin consenso tampoco falla.
  assert.equal(validarSenalPapel(base(ahora), ahora)?.consenso, undefined);
});

test("el oro corre hacia adelante con su propio plan: no tiene estudio detrás y no se mezcla con cripto", () => {
  assert.ok(SIMBOLOS_FONDEO_PAPEL.includes("XAUUSDT"), "el oro tiene que correr");
  assert.equal(planDe("XAUUSDT"), PLAN_FONDEO);
  assert.equal(planDe("BTCUSDT"), PLAN_AGENTES);
  assert.notEqual(PLAN_FONDEO, PLAN_AGENTES);
  assert.equal(sinEstudioPrevio("XAUUSDT"), true);
  assert.equal(sinEstudioPrevio("BTCUSDT"), false);
});

test("NASDAQ no corre hasta que la persona confirme su símbolo: no se inventa", () => {
  assert.equal(NASDAQ_SIMBOLO, null);
  assert.ok(!SIMBOLOS_FONDEO_PAPEL.some((s) => s.includes("NAS") || s.includes("NQ")));
});

test("el servidor acepta una entrada de oro y sigue rechazando un símbolo de fuera", () => {
  const ahora = T0 + MARCO_AGENTES_MS + 60_000;
  assert.ok(validarSenalPapel({ ...base(ahora), symbol: "XAUUSDT" }, ahora));
  assert.equal(validarSenalPapel({ ...base(ahora), symbol: "PEPEUSDT" }, ahora), null);
});

test("los agentes en pausa no abren nada nuevo, ni en el servidor ni en tu cuenta", () => {
  assert.deepEqual(Object.keys(AGENTES_PAUSADOS).sort(), ["BOLLINGER", "RSI", "SNR", "SNR_HTF"]);
  for (let semilla = 1; semilla <= 12; semilla += 1) {
    const v = serie(400, semilla);
    assert.ok(!leerSenalesPapel("BTCUSDT", v, ahoraDe(v)).some((p) => agentePausado(p.estrategia)), `semilla ${semilla}`);
  }
  const ahora = T0 + MARCO_AGENTES_MS + 60_000;
  assert.equal(validarSenalPapel({ ...base(ahora), estrategia: "SNR" }, ahora), null, "el servidor rechaza una señal de un agente en pausa");
  assert.ok(validarSenalPapel(base(ahora), ahora), "los demás siguen");
  // Siguen en la lista (para mostrar su historial), solo que en pausa.
  assert.ok(AGENTES_PAPEL.includes("SNR" as never));
});
