/**
 * Pruebas de las reuniones de la oficina (lib/oficina-reuniones.ts): cuándo hay reunión, quién va a la sala, el orden de la
 * agenda y la línea de tiempo (charla, llegan, hablan, vuelven).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { agendaReuniones, CHARLA_ENTRE, enLaSala, lineaDeTiempo, SILLAS, silla } from "../lib/oficina-reuniones.ts";
import type { Intervencion } from "../lib/mercado-ar-ranking.ts";

const d = (tema: string, quienes: string[]) => ({ tema, lineas: quienes.map((q) => ({ quien: q, nombre: q, texto: `${q} dice algo` })) });
const g = (quien: string, postura: Intervencion["postura"]): Intervencion => ({ quien, nombre: `${quien} (algo)`, postura, texto: `${quien}: ${postura}` });

test("agenda: primero las apuestas opuestas, después las mentes que no coinciden, las mesas y las lecciones", () => {
  const a = agendaReuniones(
    [d("Lo que aprendió RSI", ["RSI", "MACD"]), d("Mesa de tendencia", ["CRUCE_EMA", "SUPERTREND"]), d("Debate en ZEC", ["RUPTURA", "BOLLINGER"])],
    { ticker: "KO", guion: [g("JARVIS", "MODERA"), g("BUFFETT", "A FAVOR"), g("GRAHAM", "EN CONTRA"), g("LYNCH", "SIN DATOS"), g("JARVIS", "MODERA")] },
  );
  assert.deepEqual(a.map((r) => r.motivo), ["APUESTAS OPUESTAS", "LAS MENTES NO COINCIDEN", "RESULTADOS DISTINTOS", "UNA LECCIÓN"]);
  const mentes = a[1];
  assert.deepEqual(mentes.participantes, ["BUFFETT", "GRAHAM"], "a la sala van las que discuten");
  assert.equal(mentes.lineas[0].quien, "JARVIS");
  assert.equal(mentes.lineas.at(-1)!.quien, "JARVIS");
  assert.equal(mentes.lineas[1].nombre, "BUFFETT", "sin el paréntesis del nombre");
});

test("sin una mente a favor y otra en contra, las mentes no se reúnen", () => {
  assert.equal(agendaReuniones([], { ticker: "KO", guion: [g("BUFFETT", "A FAVOR"), g("LYNCH", "A FAVOR")] }).length, 0);
  assert.equal(agendaReuniones([], null).length, 0);
});

test("a la sala van a lo sumo tantos como sillas", () => {
  const muchas = Array.from({ length: 5 }, (_, k) => g(`F${k}`, "A FAVOR")).concat(Array.from({ length: 5 }, (_, k) => g(`C${k}`, "EN CONTRA")));
  const [r] = agendaReuniones([], { ticker: "X", guion: muchas });
  assert.ok(r.participantes.length <= SILLAS);
});

test("línea de tiempo: charla, llegan, habla cada uno y vuelven; en la sala solo mientras dura", () => {
  const agenda = agendaReuniones([d("Debate en BTC", ["A", "B"])], null);
  const t = lineaDeTiempo(agenda);
  assert.equal(t.length, CHARLA_ENTRE + 1 + 2 + 1);
  assert.deepEqual(t.map((m) => m.tipo), [...Array(CHARLA_ENTRE).fill("CHARLA"), "LLEGAN", "HABLA", "HABLA", "VUELVEN"]);
  assert.deepEqual([...enLaSala(t[CHARLA_ENTRE])], ["A", "B"]);
  assert.equal(enLaSala(t.at(-1)!).size, 0, "al volver ya caminan a su escritorio");
  assert.deepEqual(lineaDeTiempo([]), [{ tipo: "CHARLA" }]);
});

test("sillas alrededor de la mesa, dentro de la sala", () => {
  const sala = { ancho: 5.45, alto: 3.2 };
  for (let k = 0; k < SILLAS; k += 1) {
    const s = silla(k, SILLAS, sala);
    assert.ok(s.x > 0 && s.x < sala.ancho && s.y > 0 && s.y < sala.alto);
  }
});
