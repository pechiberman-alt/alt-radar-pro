// Pruebas de la arena del piso de estrategias (lib/lab-arena.ts): el orden de mayor a menor R por operación, la
// conexión de cada agente con el cerebro, la muestra mínima, el intervalo que cruza el cero, la raya del control
// al azar y la escala de las barras. Con filas armadas a mano y con las reales del estudio.
import assert from "node:assert/strict";
import { AGENTES_PAPEL } from "../lib/agentes-papel.ts";
import test from "node:test";
import { ESTUDIO_FILAS, type FilaEstudio } from "../lib/estudio-estrategias-datos.ts";
import { AGENTES_EN_PAPEL, combatientes, conexionCerebro, controlDelMarco, marcosDisponibles, MUESTRA_MINIMA, nombreCorto, partirNombre, posicion, repartirAnillos, textoCombatiente, tonoBarra, tonoNumero, topeEscala } from "../lib/lab-arena.ts";

const med = (n: number, exp: number | null, ic: [number, number] | null, neto = 0) => ({
  operaciones: n, ganadas: 0, winRate: 0.4, tasaTp1: 0.5, tasaTp2: 0.4, tasaTp3: 0.3, tasaSl: 0.6, profitFactor: 1.1,
  expectancia: exp, expectanciaIc: ic ? { low: ic[0], high: ic[1] } : null, netoR: neto, maxCaidaR: 3,
});
const fila = (estrategia: string, marco: string, n: number, exp: number | null, ic: [number, number] | null, agente = `Agente ${estrategia}`): FilaEstudio =>
  ({ estrategia, agente, nombre: estrategia, regla: "", marco, desarrollo: med(n, exp, ic), evaluacion: med(n, exp, ic, (exp ?? 0) * n), veredicto: "SIN CONCLUSIÓN", monedasPositivas: 1, monedasConOperaciones: 2, psr: null, dsrTabla: null, dsrDeclarado: null }) as FilaEstudio;

test("se ordena de mayor a menor R por operación, con el que no tiene dato al final", () => {
  const cs = combatientes([fila("A", "1h", 100, -0.1, [-0.2, 0]), fila("B", "1h", 100, 0.2, [0.1, 0.3]), fila("C", "1h", 3, null, null), fila("D", "1h", 100, 0.05, [-0.1, 0.2])]);
  assert.deepEqual(cs.map((c) => c.estrategia), ["B", "D", "A", "C"]);
});

test("el filtro por temporalidad deja solo esa; «todos» las deja todas", () => {
  const filas = [fila("A", "1h", 100, 0.1, [0, 0.2]), fila("A", "4h", 100, 0.2, [0.1, 0.3])];
  assert.equal(combatientes(filas, "4h").length, 1);
  assert.equal(combatientes(filas, "4h")[0].marco, "4h");
  assert.equal(combatientes(filas).length, 2);
});

test("muestra mínima con menos de 15 operaciones y no con 15", () => {
  const cs = combatientes([fila("A", "1h", MUESTRA_MINIMA - 1, 0.5, [0, 1]), fila("B", "1h", MUESTRA_MINIMA, 0.4, [0, 1])]);
  assert.equal(cs.find((c) => c.estrategia === "A")?.muestraMinima, true);
  assert.equal(cs.find((c) => c.estrategia === "B")?.muestraMinima, false);
});

test("cruzaCero: un intervalo con el cero adentro no dice si gana o pierde; sin intervalo, tampoco", () => {
  const cs = combatientes([fila("A", "1h", 100, 0.05, [-0.05, 0.15]), fila("B", "1h", 100, 0.2, [0.1, 0.3]), fila("C", "1h", 100, -0.2, [-0.3, -0.1]), fila("D", "1h", 5, null, null)]);
  const por = Object.fromEntries(cs.map((c) => [c.estrategia, c.cruzaCero]));
  assert.deepEqual(por, { A: true, B: false, C: false, D: true });
});

test("conexión con el cerebro: todos los agentes del estudio corren en papel y el azar es el control", () => {
  // Antes corría uno solo. Ahora corren todos (lib/agentes-papel.ts): leen las mismas velas, así que no cuesta más bajarlas.
  assert.deepEqual([...AGENTES_EN_PAPEL].sort(), [...AGENTES_PAPEL].sort());
  assert.ok(!AGENTES_EN_PAPEL.includes("AZAR"), "el control al azar no corre hacia adelante");
  for (const id of ["ST_MTF_VOL", "RUPTURA", "FIB_NIVELES"]) assert.equal(conexionCerebro(id), "PAPEL", id);
  assert.equal(conexionCerebro("AZAR"), "CONTROL");
  assert.equal(conexionCerebro("NO_EXISTE"), "ESTUDIO");
});

test("la raya del control sale del azar de esa temporalidad, y es null si ahí no hay control", () => {
  const filas = [fila("AZAR", "1h", 100, -0.01, [-0.1, 0.1]), fila("A", "1h", 100, 0.1, [0, 0.2]), fila("A", "4h", 100, 0.1, [0, 0.2])];
  assert.equal(controlDelMarco(filas, "1h"), -0.01);
  assert.equal(controlDelMarco(filas, "4h"), null);
});

test("las temporalidades van de la más gruesa a la más fina, con «todos» primero", () => {
  const filas = [fila("A", "3m", 1, 0, null), fila("A", "1h", 1, 0, null), fila("A", "15m", 1, 0, null), fila("A", "4h", 1, 0, null)];
  assert.deepEqual(marcosDisponibles(filas), ["todos", "4h", "1h", "15m", "3m"]);
});

test("la escala es simétrica, sube de a 0,05 y nunca baja de 0,05; la posición se recorta a la escala", () => {
  const cs = combatientes([fila("A", "1h", 100, 0.12, [-5, 5]), fila("B", "1h", 100, -0.31, [-1, 1])]);
  assert.equal(topeEscala(cs), 0.35);
  assert.equal(topeEscala([]), 0.05);
  assert.equal(posicion(0.175, 0.35), 0.5);
  assert.equal(posicion(-9, 0.35), -1);
  assert.equal(posicion(9, 0.35), 1);
});

test("textoCombatiente: coma decimal, muestra y veredicto", () => {
  const [c] = combatientes([fila("A", "1h", 7, 0.1234, [0, 0.3], "Agente Ruptura")]);
  assert.equal(textoCombatiente(c), "Ruptura en 1h: +0,12 R por operación, 7 operaciones (muestra mínima), SIN CONCLUSIÓN");
  assert.equal(nombreCorto("Agente Control (azar)"), "Control");
});

test("con las filas reales del estudio: cada agente aparece una vez por temporalidad y el control queda marcado", () => {
  const cs = combatientes(ESTUDIO_FILAS);
  assert.equal(cs.length, ESTUDIO_FILAS.length);
  assert.equal(new Set(cs.map((c) => c.clave)).size, cs.length);
  assert.ok(cs.every((c) => (c.estrategia === "AZAR") === (c.conexion === "CONTROL")));
  for (let i = 1; i < cs.length; i += 1) assert.ok((cs[i - 1].expectancia ?? -Infinity) >= (cs[i].expectancia ?? -Infinity));
});

test("repartirAnillos: 16 agentes dan 6 adentro y 10 afuera, a su radio, sin dos en el mismo lugar", () => {
  const lugares = repartirAnillos(16, { x: 190, y: 195 }, 80, 150);
  assert.equal(lugares.length, 16);
  assert.equal(lugares.filter((l) => l.anillo === 0).length, 6);
  assert.equal(lugares.filter((l) => l.anillo === 1).length, 10);
  for (const l of lugares) assert.ok(Math.abs(Math.hypot(l.x - 190, l.y - 195) - (l.anillo === 0 ? 80 : 150)) < 0.2);
  assert.equal(new Set(lugares.map((l) => `${l.x},${l.y}`)).size, 16);
  assert.ok(lugares[0].y < 195, "el primero queda arriba del cerebro");
});

test("repartirAnillos: pocos agentes caben adentro y ninguno afuera", () => {
  assert.equal(repartirAnillos(4, { x: 0, y: 0 }, 10, 20).filter((l) => l.anillo === 1).length, 0);
  assert.deepEqual(repartirAnillos(0, { x: 0, y: 0 }, 10, 20), []);
});

test("partirNombre: corto queda en un renglón y largo se parte cerca de la mitad, sin pasar el máximo", () => {
  assert.deepEqual(partirNombre("Ruptura"), ["Ruptura"]);
  assert.deepEqual(partirNombre("Supertrend MTF + Volumen"), ["Supertrend", "MTF + Volumen"]);
  for (const n of ["Supertrend + VWAP + Perfil", "SNR + Storyline", "MACD + MTF + SNR"]) assert.ok(partirNombre(n).every((r) => r.length <= 14), n);
});

test("el color sale del veredicto, no del signo: solo VENTAJA es verde sólido y CANDIDATA no se confunde con una confirmada", () => {
  assert.equal(tonoBarra("VENTAJA"), "gana");
  assert.equal(tonoBarra("CANDIDATA"), "candidata");
  assert.equal(tonoBarra("SIN VENTAJA"), "pierde");
  assert.equal(tonoBarra("SIN CONCLUSIÓN"), "duda");
  assert.equal(tonoBarra("CONTROL"), "control");
  assert.equal(tonoNumero("VENTAJA"), "gana");
  assert.equal(tonoNumero("CANDIDATA"), "neutro");
  assert.equal(tonoNumero("SIN CONCLUSIÓN"), "neutro");
  assert.equal(tonoNumero("SIN VENTAJA"), "pierde");
});
