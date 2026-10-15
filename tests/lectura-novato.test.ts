// Pruebas de la lectura para novatos (lib/lectura-novato.ts): que el veredicto mire primero la muestra, que detecte el caso
// de ganar en desarrollo y perder en evaluación, que nunca prometa ganancias y que los niveles de los gatillos existan.
import assert from "node:assert/strict";
import test from "node:test";
import { ESTRATEGIAS } from "../lib/estrategias.ts";
import { MUESTRA_MINIMA, type Evaluacion, type MetricasTramo } from "../lib/lab-evaluacion.ts";
import { NIVELES_GATILLO, frecuencia, lecturaTramo, nivelDe, veredictoNovato } from "../lib/lectura-novato.ts";

const DIA = 86_400_000;

function tramo(p: Partial<MetricasTramo> = {}): MetricasTramo {
  return {
    tramo: "EVALUACIÓN",
    desde: 0,
    hasta: 100 * DIA,
    operaciones: 40,
    ganadas: 18,
    perdidas: 22,
    winRate: 0.45,
    gananciaMediaR: 1.8,
    perdidaMediaR: 1,
    relacionGP: 1.8,
    profitFactor: 1.2,
    brutoR: 10,
    netoR: 7,
    comisionesR: 3,
    conDeslizamientoR: 5,
    maxDrawdownR: 8,
    duracionMediaH: 20,
    exposicion: 0.3,
    muestra: "MUESTRA RAZONABLE",
    ...p,
  };
}

function evaluacion(d: Partial<MetricasTramo>, e: Partial<MetricasTramo>, calidad: string[] = []): Evaluacion {
  return {
    id: "x",
    symbol: "BTCUSDT",
    desde: 0,
    hasta: 200 * DIA,
    corte: 140 * DIA,
    reglas: 1,
    fuente: "Binance",
    deslizamientoPct: 0.02,
    desarrollo: tramo({ tramo: "DESARROLLO", ...d }),
    evaluacion: tramo({ tramo: "EVALUACIÓN", ...e }),
    abiertasAlFinal: 0,
    calidad,
  };
}

test("sin operaciones en evaluación no se concluye nada", () => {
  const v = veredictoNovato(evaluacion({}, { operaciones: 0, muestra: "SIN DATOS" }));
  assert.equal(v.fuerza, "SIN DATOS");
});

test("la muestra manda: con pocas operaciones no se concluye aunque el resultado sea muy positivo", () => {
  const v = veredictoNovato(evaluacion({}, { operaciones: MUESTRA_MINIMA - 1, muestra: "MUESTRA MÍNIMA", conDeslizamientoR: 99 }));
  assert.equal(v.fuerza, "NO ALCANZA");
  assert.ok(v.porque.join(" ").includes("azar"));
});

test("muestra chica en desarrollo también frena la conclusión", () => {
  const v = veredictoNovato(evaluacion({ operaciones: 3, muestra: "MUESTRA MÍNIMA" }, {}));
  assert.equal(v.fuerza, "NO ALCANZA");
});

test("ganar en desarrollo y perder en evaluación se marca como que no se sostiene", () => {
  const v = veredictoNovato(evaluacion({ conDeslizamientoR: 20 }, { conDeslizamientoR: -5 }));
  assert.equal(v.fuerza, "NO SE SOSTIENE");
  assert.ok(v.queHacer.toLowerCase().includes("no la uses"));
});

test("perder en los dos tramos es sin ventaja, no «no se sostiene»", () => {
  const v = veredictoNovato(evaluacion({ conDeslizamientoR: -3 }, { conDeslizamientoR: -5 }));
  assert.equal(v.fuerza, "SIN VENTAJA");
});

test("el mejor veredicto posible sigue siendo provisorio y manda a medir hacia adelante", () => {
  const v = veredictoNovato(evaluacion({ conDeslizamientoR: 10 }, { conDeslizamientoR: 8 }));
  assert.equal(v.fuerza, "PARA SEGUIR MIRANDO");
  const texto = `${v.titulo} ${v.porque.join(" ")} ${v.queHacer}`.toLowerCase();
  assert.ok(texto.includes("no es una ventaja demostrada"));
  assert.ok(texto.includes("hacia adelante"));
});

test("ningún veredicto promete ganancias ni dice que la estrategia gana", () => {
  const casos = [
    evaluacion({ conDeslizamientoR: 10 }, { conDeslizamientoR: 8 }),
    evaluacion({ conDeslizamientoR: 20 }, { conDeslizamientoR: -5 }),
    evaluacion({}, { operaciones: 0, muestra: "SIN DATOS" }),
  ];
  for (const c of casos) {
    const v = veredictoNovato(c);
    const t = `${v.titulo} ${v.porque.join(" ")} ${v.queHacer}`.toLowerCase();
    for (const frase of ["ganancia asegurada", "vas a ganar", "gana seguro", "rentable garantizado"]) assert.ok(!t.includes(frase), frase);
  }
});

test("las advertencias de la corrida se mencionan en el veredicto positivo", () => {
  const v = veredictoNovato(evaluacion({ conDeslizamientoR: 10 }, { conDeslizamientoR: 8 }, ["algo raro", "otra cosa"]));
  assert.ok(v.porque.some((p) => p.includes("2 advertencia")));
});

test("la lectura de un tramo explica el acierto, los costos y la peor racha", () => {
  const l = lecturaTramo(tramo());
  const t = l.frases.join(" ");
  assert.ok(t.includes("Acertó"));
  assert.ok(t.includes("costos"));
  assert.ok(t.includes("peor racha"));
});

test("la lectura avisa cuando los costos se comen una ganancia bruta", () => {
  const l = lecturaTramo(tramo({ brutoR: 6, conDeslizamientoR: -1 }));
  assert.ok(l.frases.join(" ").includes("se lo comieron los costos"));
});

test("un tramo sin operaciones no inventa lectura", () => {
  const l = lecturaTramo(tramo({ operaciones: 0 }));
  assert.equal(l.frases.length, 1);
});

test("la frecuencia es horas por operación, y null sin operaciones", () => {
  assert.equal(frecuencia(tramo({ desde: 0, hasta: 100 * 3_600_000, operaciones: 10 })), 10);
  assert.equal(frecuencia(tramo({ operaciones: 0 })), null);
});

test("todos los gatillos con nivel existen como estrategia del laboratorio y no se repiten", () => {
  const ids = new Set(ESTRATEGIAS.map((e) => e.id as string));
  for (const n of NIVELES_GATILLO) assert.ok(ids.has(n.id), `${n.id} no es una estrategia`);
  const lista = NIVELES_GATILLO.map((n) => n.id);
  assert.equal(new Set(lista).size, lista.length);
});

test("el control al azar es el primero de nivel 1: es el piso contra el que medirse", () => {
  assert.equal(NIVELES_GATILLO[0].id, "AZAR");
  assert.equal(nivelDe("AZAR")?.nivel, 1);
  assert.equal(nivelDe("NO_EXISTE"), null);
});
