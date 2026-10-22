/**
 * Pruebas del contexto común de JARVIS (lib/jarvis-todo.ts): reconoce el papel de BYMA por ticker o por nombre (YPF es YPFD)
 * sin confundir palabras comunes, sigue el hilo de una conversación, resume la pizarra del papel con sus razones y escribe la
 * respuesta sin IA con los números en formato argentino y la aclaración de que no es asesoramiento.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { armarTodo, papelesDeLaConversacion, papelesPedidos, resumenHoy, resumenPapel, resumenRapido, respuestaSinIa, textoDePapel } from "../lib/jarvis-todo.ts";
import type { LecturaPapelAr } from "../lib/ar-lectura.ts";
import { estudiarPapel } from "../lib/mercado-ar-agentes.ts";
import { analisisAr } from "../lib/mercado-ar-tecnico.ts";
import { paraResumen } from "../lib/ar-lectura.ts";
import { PAPELES_AR, papelPorTicker, type SerieAr } from "../lib/mercado-ar.ts";
import { entradaMentesAr, pizarraAr } from "../lib/pizarra-activos.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";
import { armarHoy } from "../lib/hoy.ts";

const tickers = (t: string) => papelesPedidos(t).map((p) => p.ticker);

test("reconoce el papel por ticker y por nombre", () => {
  assert.deepEqual(tickers("Cuáles sería la zona de compra de ypf"), ["YPFD"]);
  assert.deepEqual(tickers("analizá GGAL"), ["GGAL"]);
  assert.deepEqual(tickers("qué opinás de Apple"), ["AAPL"]);
  assert.deepEqual(tickers("dame banco macro y galicia"), ["BMA", "GGAL"]);
  assert.deepEqual(tickers("zona de fibonacci de coca cola"), ["KO"]);
  assert.deepEqual(tickers("mercado libre o mercadolibre"), ["MELI"]);
  assert.deepEqual(tickers("y de google?"), ["GOOGL"]);
});

test("no confunde palabras comunes con papeles", () => {
  for (const frase of ["con fibonacci en acciones y", "mirá el calendario macro de hoy", "tengo una meta de ahorro", "una vista general del mercado", "come bien y descansá", "cuántos valores hay", "tramité la visa", "Cuál es la zona de compra de BTC"]) {
    assert.deepEqual(tickers(frase), [], frase);
  }
  // En mayúsculas sí es el papel.
  assert.deepEqual(tickers("qué pasa con META"), ["META"]);
  assert.deepEqual(tickers("hablame de la V"), ["V"]);
});

test("como mucho dos papeles, en el orden en que se nombran, sin repetir", () => {
  assert.deepEqual(tickers("GGAL, BMA, YPF y GGAL de nuevo"), ["GGAL", "BMA"]);
});

test("un seguimiento sin nombre toma el papel de lo último que se habló", () => {
  assert.deepEqual(papelesDeLaConversacion("con fibonacci en acciones y", ["zona de compra de ypf", "hola"]).map((p) => p.ticker), ["YPFD"]);
  assert.deepEqual(papelesDeLaConversacion("ahora de BMA", ["zona de compra de ypf"]).map((p) => p.ticker), ["BMA"]);
  assert.deepEqual(papelesDeLaConversacion("cómo viene el mercado", ["hola"]), []);
});

function velas(n: number): SwingCandle[] {
  let s = 11;
  const azar = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const out: SwingCandle[] = [];
  let p = 8000;
  for (let k = 0; k < n; k += 1) {
    const o = p;
    const c = o * (1 + 0.001 + (azar() - 0.5) * 0.02);
    out.push({ openTime: Date.UTC(2025, 0, 1) + k * 86_400_000, open: o, high: Math.max(o, c) * 1.004, low: Math.min(o, c) * 0.996, close: c, volume: 1000, quoteVolume: 1000 * c });
    p = c;
  }
  return out;
}

function lectura(): LecturaPapelAr {
  const papel = papelPorTicker("YPFD")!;
  const v = velas(300);
  const serie = { meta: { simbolo: papel.yahoo, moneda: "ARS", bolsa: "BUE", demoraMin: 20, precio: null, horaPrecio: null }, velas: v } as unknown as SerieAr;
  const agentes = estudiarPapel(papel.ticker, v);
  const analisis = analisisAr(v);
  const mentes = entradaMentesAr({ papel, velasPapel: v, monedaPapel: "ARS", velasAfuera: null, monedaAfuera: null, fund: null, fundError: null, fuerzaRelativa: null, mercadoAlcista: null, volMediana: null });
  const pizarra = pizarraAr({ ticker: papel.ticker, nombre: papel.nombre, velas: v, fib: analisis.fib, fibMotivo: analisis.fibMotivo, agentes, mentes });
  return { papel, serie, velas: v, agentes, analisis, pizarra };
}

test("el resumen del papel trae pizarra, Fibonacci, lectura diaria y lo que falta", () => {
  const r = resumenPapel(paraResumen(lectura()));
  assert.equal(r.ticker, "YPFD");
  assert.ok(r.pizarra!.veredicto.length > 0);
  assert.ok(r.pizarra!.razon.length > 0);
  assert.ok(r.lecturaDiaria && r.lecturaDiaria.cierre > 0);
  assert.ok(r.avisoDeDatos.includes("sin footprint"));
  assert.ok(r.pizarra!.aFavor.length <= 5 && r.pizarra!.enContra.length <= 5);
});

test("sin IA, la respuesta sale de las reglas, con números argentinos y sin asesoramiento", () => {
  const t = textoDePapel(resumenPapel(paraResumen(lectura())));
  assert.match(t, /YPF \(YPFD\)/);
  assert.match(t, /Pizarra: /);
  assert.match(t, /no es asesoramiento financiero/);
  assert.doesNotMatch(t, /undefined|NaN/);
  assert.match(textoDePapel({ ticker: "GGAL", nombre: "Galicia", noSePudoLeer: "Yahoo no respondió" }), /no pude leerlo ahora \(Yahoo no respondió\)/);
});

test("el todo trae la cobertura y la lista de BYMA, y dice si HOY no se pudo leer", () => {
  const sin = armarTodo({ hoy: null, papeles: [] });
  assert.equal(sin.hoy, null);
  assert.ok(sin.cobertura.includes("menos de 15 cierres es muestra mínima"));
  assert.equal(sin.papelesDeBymaQueCubro.acciones.length + sin.papelesDeBymaQueCubro.cedears.length, PAPELES_AR.length);
  assert.equal(respuestaSinIa(sin), null);
  const con = armarTodo({ hoy: null, papeles: [resumenPapel(paraResumen(lectura()))] });
  assert.ok(respuestaSinIa(con)?.includes("YPFD"));
});

test("el resumen de HOY marca lo viejo y deja afuera los planes viejos", () => {
  const ahora = Date.now();
  const hoy = armarHoy(
    {
      registro: null,
      estadosAr: [
        { ticker: "GGAL", at: ahora - 1000, vela: 1, fib: "EN LA ZONA", veredicto: "HAY PLAN", huella: "abc123", error: null },
        { ticker: "BMA", at: ahora - 9 * 86_400_000, vela: 1, fib: "EN LA ZONA", veredicto: "HAY PLAN", huella: "def456", error: null },
      ],
      avisos: [{ clave: "k", ticker: "GGAL", texto: "<b>GGAL</b> entró &amp; zona" }],
      nucleo: [],
      pizarraCripto: [],
    },
    ahora,
  );
  const r = resumenHoy(hoy);
  assert.deepEqual(r.planesDeLaPizarra.map((p) => p.activo), ["GGAL"]);
  assert.deepEqual(r.papelesEnZonaDeCompraFibonacci, ["GGAL"]);
  assert.equal(r.avisosDeLas24h[0], "GGAL entró & zona");
  assert.ok(r.noSePudoLeer.includes("el registro unificado"));
});

test("la lectura rápida (antes del cierre del servidor) no trae pizarra y lo dice", () => {
  const l = lectura();
  const r = resumenRapido(l.papel, l.velas, "ARS");
  assert.equal(r.pizarra, null);
  assert.match(r.pizarraNota ?? "", /todavía no se calculó/);
  assert.ok(r.lecturaDiaria);
  const t = textoDePapel(r);
  assert.match(t, /Pizarra: la pizarra de este papel todavía no se calculó/);
  assert.doesNotMatch(t, /undefined|NaN/);
});

test("con la última pierna bajista el resumen trae la zona de venta y el texto la nombra", () => {
  // Suba, caída fuerte y un rebote que llega a la zona 0,618–0,786.
  const c = [...Array(40).fill(0).map((_, k) => 170 + k * 0.75), ...Array(25).fill(0).map((_, k) => 199.25 - (k + 1) * 4), ...Array(12).fill(0).map((_, k) => 99.25 + (k + 1) * 5.5)];
  const v: SwingCandle[] = c.map((x, k) => ({ openTime: Date.UTC(2025, 0, 1) + k * 86_400_000, open: x, high: x * 1.004, low: x * 0.996, close: x, volume: 1000, quoteVolume: 1000 * x }));
  const papel = papelPorTicker("EDN")!;
  const analisis = analisisAr(v);
  const r = resumenPapel({ papel, moneda: "ARS", velas: v, agentes: [], tecnico: analisis, pizarra: null });
  assert.equal(r.fibonacci.estado, "SIN ZONA DE COMPRA");
  assert.ok(r.fibonacciVenta);
  assert.equal(r.fibonacciVenta!.estado, "EN LA ZONA");
  assert.match(textoDePapel(r), /Zona de venta de Fibonacci: EN LA ZONA/);
});
