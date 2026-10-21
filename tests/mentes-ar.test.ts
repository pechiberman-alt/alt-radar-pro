/**
 * Pruebas de las MENTES (lib/mentes-inversoras.ts), los balances de SEC (lib/fundamentales-sec.ts), los agentes sobre
 * ruedas de BYMA (lib/mercado-ar-agentes.ts) y el mapa de un papel (lib/mercado-ar-mapa.ts). Incluyen que nada mira el
 * futuro: cambiar las ruedas posteriores no cambia lo que se leyó antes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SwingCandle } from "../lib/swing-entries.ts";
import { anualesDe, armarEjercicios, bajarFundamentales, leerFundGuardado, type Fundamentales } from "../lib/fundamentales-sec.ts";
import { consenso, leerMentes, metricas, percentiles, posturaDe, type EntradaMentes } from "../lib/mentes-inversoras.ts";
import { AGENTES_AR, estudiarPapel, medirUniverso, soloCompras } from "../lib/mercado-ar-agentes.ts";
import { nivelesAr, perfilAprox } from "../lib/mercado-ar-mapa.ts";
import { buscarPapeles, papelPorTicker, SIMBOLOS_PERMITIDOS } from "../lib/mercado-ar.ts";

const DIA = 86_400_000;

/** Ruedas de prueba: caminata con semilla fija y una tendencia. */
function serie(n: number, tendencia = 0.001, semilla = 7, inicio = 100): SwingCandle[] {
  let s = semilla;
  const azar = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const out: SwingCandle[] = [];
  let p = inicio;
  for (let k = 0; k < n; k += 1) {
    const o = p;
    const c = o * (1 + tendencia + (azar() - 0.5) * 0.04);
    const h = Math.max(o, c) * (1 + azar() * 0.01);
    const l = Math.min(o, c) * (1 - azar() * 0.01);
    const v = 1000 + azar() * 1000;
    out.push({ openTime: Date.UTC(2024, 0, 1) + k * DIA, open: o, high: h, low: l, close: c, volume: v, quoteVolume: v * c });
    p = c;
  }
  return out;
}

const fila = (end: string, val: number, extra: Record<string, unknown> = {}) => ({ end, val, form: "10-K", fp: "FY", filed: `${end.slice(0, 4)}-12-01`, ...extra });

test("anualesDe: solo 10-K del ejercicio completo, un año de duración, y gana la última presentación", () => {
  const json = {
    units: {
      USD: [
        fila("2023-12-31", 100, { start: "2023-01-01" }),
        fila("2023-12-31", 110, { start: "2023-01-01", filed: "2024-12-01" }), // corrección posterior
        fila("2023-09-30", 30, { start: "2023-07-01", form: "10-Q", fp: "Q3" }), // trimestral: afuera
        fila("2022-12-31", 25, { start: "2022-10-01" }), // un trimestre dentro de un 10-K: afuera
        fila("2022-12-31", 90, { start: "2022-01-01" }),
      ],
    },
  };
  const m = anualesDe(json, "USD", true);
  assert.deepEqual([...m.entries()].sort(), [
    ["2022-12-31", 90],
    ["2023-12-31", 110],
  ]);
  // Los saldos no piden duración.
  assert.equal(anualesDe({ units: { USD: [fila("2023-12-31", 5)] } }, "USD", false).get("2023-12-31"), 5);
  assert.equal(anualesDe(null, "USD", true).size, 0);
});

test("armarEjercicios: alinea por cierre y deja null lo que no se reporta", () => {
  const e = armarEjercicios({ ingresos: new Map([["2023-12-31", 10]]), patrimonio: new Map([["2023-12-31", 50]]) });
  assert.equal(e.length, 1);
  assert.equal(e[0].ingresos, 10);
  assert.equal(e[0].pasivo, null, "desconocido no es cero");
});

function fundDe(anios: { fin: string; ing: number; gn: number; bpa: number; pat: number; pas: number; ac?: number; pc?: number }[]): Fundamentales {
  return {
    simbolo: "AAPL",
    entidad: "Apple Inc.",
    fuente: "SEC",
    leido: 0,
    faltantes: [],
    ejercicios: anios.map((a) => ({ fin: a.fin, ingresos: a.ing, gananciaNeta: a.gn, bpa: a.bpa, patrimonio: a.pat, pasivo: a.pas, activoCorriente: a.ac ?? null, pasivoCorriente: a.pc ?? null })),
  };
}

const SOLIDA = fundDe([
  { fin: "2020-12-31", ing: 100, gn: 20, bpa: 2, pat: 100, pas: 50, ac: 80, pc: 30 },
  { fin: "2021-12-31", ing: 130, gn: 26, bpa: 2.6, pat: 120, pas: 55, ac: 90, pc: 30 },
  { fin: "2022-12-31", ing: 170, gn: 34, bpa: 3.4, pat: 140, pas: 60, ac: 100, pc: 40 },
  { fin: "2023-12-31", ing: 220, gn: 44, bpa: 4.4, pat: 160, pas: 70, ac: 120, pc: 50 },
]);

function entrada(over: Partial<EntradaMentes> = {}): EntradaMentes {
  return { simbolo: "AAPL", velas: serie(300), moneda: "USD", precioUsd: 44, fund: SOLIDA, sinFund: null, fuerzaRelativa: 80, mercadoAlcista: true, mercadoNombre: "el S&P 500", volMediana: 0.3, ...over };
}

test("metricas: PER, ROE, crecimiento y número de Graham con las acciones implícitas", () => {
  const m = metricas("AAPL", SOLIDA, 44);
  assert.equal(m.per, 10);
  assert.ok(Math.abs((m.roePromedio ?? 0) - (0.2 + 26 / 120 + 34 / 140 + 44 / 160) / 4) < 1e-9);
  assert.ok((m.cagrBpa ?? 0) > 0.29 && (m.cagrBpa ?? 0) < 0.31);
  // Valor libro por acción = 160 / (44 / 4,4) = 16 → P/VL 2,75 → 10 × 2,75 = 27,5.
  assert.ok(Math.abs((m.perPorPvl ?? 0) - 27.5) < 1e-9);
  assert.equal(metricas("BRKB", SOLIDA, 44).per, null, "Berkshire publica el BPA de la clase A");
  assert.equal(metricas("AAPL", SOLIDA, null).perMotivo, "sin precio en dólares de la acción de afuera");
});

test("mentes de valor: Buffett a favor con una empresa sólida; sin balances dicen SIN DATOS", () => {
  const l = leerMentes(entrada());
  const de = (id: string) => l.find((x) => x.id === id)!;
  assert.equal(de("BUFFETT").postura, "A FAVOR");
  assert.equal(de("LYNCH").postura, "A FAVOR", "PEG 10/30 ≈ 0,33");
  assert.equal(de("MUSK").postura, "A FAVOR", "ingresos +30 % por año");
  assert.equal(de("GRAHAM").postura, "NEUTRAL", "número de Graham 27,5 > 22,5");
  const sin = leerMentes(entrada({ fund: null, sinFund: "es un ETF" }));
  for (const id of ["BUFFETT", "GRAHAM", "LYNCH", "MUSK"]) {
    const x = sin.find((m) => m.id === id)!;
    assert.equal(x.postura, "SIN DATOS");
    assert.match(x.nota, /es un ETF/);
  }
  // Una cara: PER 40 y mucha deuda.
  const cara = leerMentes(entrada({ precioUsd: 176, fund: fundDe(SOLIDA.ejercicios.map((e) => ({ fin: e.fin, ing: e.ingresos!, gn: e.gananciaNeta!, bpa: e.bpa!, pat: e.patrimonio!, pas: e.patrimonio! * 3 }))) }));
  assert.equal(cara.find((x) => x.id === "BUFFETT")!.postura, "EN CONTRA");
});

test("mentes técnicas: Tudor Jones sigue la media de 200; con pocas ruedas, SIN DATOS", () => {
  const sube = leerMentes(entrada({ velas: serie(300, 0.004), fund: null }));
  assert.equal(sube.find((x) => x.id === "PTJ")!.postura, "A FAVOR");
  const baja = leerMentes(entrada({ velas: serie(300, -0.004), fund: null }));
  assert.equal(baja.find((x) => x.id === "PTJ")!.postura, "EN CONTRA");
  const corta = leerMentes(entrada({ velas: serie(100), fund: null }));
  assert.equal(corta.find((x) => x.id === "PTJ")!.postura, "SIN DATOS");
  assert.equal(corta.find((x) => x.id === "DARVAS")!.postura, "SIN DATOS");
});

test("consenso: cuenta mentes, Dalio informa y no cuenta", () => {
  const l = leerMentes(entrada());
  const c = consenso(l);
  assert.equal(l.find((x) => x.id === "DALIO")!.postura, "INFORMA");
  assert.equal(c.aFavor + c.enContra + c.neutral, c.opinan);
  assert.equal(c.opinan + c.sinDatos, l.length - 1);
});

test("posturaDe y percentiles", () => {
  const c = (cumple: boolean | null) => ({ nombre: "x", regla: "", valor: "", cumple });
  assert.equal(posturaDe([c(true), c(true), c(null)], 2), "A FAVOR");
  assert.equal(posturaDe([c(true), c(false)], 2), "EN CONTRA");
  assert.equal(posturaDe([c(true), c(true), c(false)], 2), "NEUTRAL");
  assert.equal(posturaDe([c(true), c(null)], 2), "SIN DATOS");
  assert.deepEqual(percentiles([1, null, 3, 2]), [0, null, 100, 50]);
});

test("bajarFundamentales: controla el nombre de la empresa y marca lo que no se reporta", async () => {
  const pedidos: string[] = [];
  const ok = (async (url: string) => {
    pedidos.push(url);
    if (url.includes("Revenues") || url.includes("SalesRevenueNet") || url.includes("AssetsCurrent")) return new Response("", { status: 404 });
    const flujo = !/StockholdersEquity|Liabilities/.test(url);
    const unidad = url.includes("EarningsPerShare") ? "USD/shares" : "USD";
    return new Response(JSON.stringify({ entityName: "Apple Inc.", units: { [unidad]: [fila("2023-09-30", 7, flujo ? { start: "2022-10-01" } : {})] } }));
  }) as unknown as typeof fetch;
  const r = await bajarFundamentales("AAPL", { fetchImpl: ok, ahora: 5 });
  assert.equal(r.error, null);
  assert.equal(r.fund?.ejercicios.length, 1);
  assert.ok(r.fund?.faltantes.includes("activoCorriente"));
  assert.ok(pedidos.every((u) => u.includes("CIK0000320193")));
  const otro = (async () => new Response(JSON.stringify({ entityName: "Otra Empresa SA", units: {} }))) as unknown as typeof fetch;
  const mal = await bajarFundamentales("AAPL", { fetchImpl: otro });
  assert.equal(mal.fund, null);
  assert.match(mal.error ?? "", /no la empresa esperada/);
  const etf = await bajarFundamentales("SPY");
  assert.match(etf.error ?? "", /ETF/);
  assert.equal(leerFundGuardado("{roto"), null);
});

test("agentes AR: solo compras, sin agentes de flujo, y la señal de hoy no entra en los resultados", () => {
  assert.equal(soloCompras({ lado: "SHORT", stop: 1, objetivo: 0 }), null);
  assert.ok(!AGENTES_AR.includes("ABSORCION") && AGENTES_AR.includes("AZAR"));
  const v = serie(500, 0.0005, 11);
  const ag = estudiarPapel("GGAL", v);
  assert.equal(ag.length, AGENTES_AR.length);
  for (const a of ag) {
    assert.ok(a.ops.every((o) => o.lado === "LONG"));
    assert.ok(a.ops.every((o) => o.abiertaA <= v.at(-1)!.openTime));
    if (a.senalHoy) {
      const e = a.senalHoy.escalera;
      assert.ok(e.stop < a.senalHoy.referencia && a.senalHoy.referencia < e.tp1 && e.tp1 < e.tp2 && e.tp2 < e.tp3, `${a.id}: escalera ordenada`);
    }
  }
  assert.deepEqual(estudiarPapel("X", serie(40)), [], "con menos de 60 ruedas no leen");
  const u = medirUniverso([ag, estudiarPapel("YPFD", serie(500, -0.0005, 5))]);
  assert.equal(u.find((x) => x.id === "AZAR")!.veredicto, "SIN CONCLUSIÓN", "el azar es el control");
});

test("no mira el futuro: cambiar las ruedas posteriores no cambia lo que ya se leyó", () => {
  const v = serie(420, 0.0008, 3);
  const corte = 350;
  const futuroDistinto = [...v.slice(0, corte), ...serie(70, -0.01, 99, v[corte - 1].close).map((c, k) => ({ ...c, openTime: v[corte + k].openTime }))];
  const a = estudiarPapel("GGAL", v);
  const b = estudiarPapel("GGAL", futuroDistinto);
  const hasta = v[corte - 1].openTime;
  for (let k = 0; k < a.length; k += 1) {
    const ya = (ops: typeof a[number]["ops"]) => ops.filter((o) => o.cerradaA <= hasta);
    assert.deepEqual(ya(a[k].ops), ya(b[k].ops), `${a[k].id}: lo cerrado antes del corte no depende del después`);
  }
  // Las mentes y los niveles de un día dependen solo de las ruedas hasta ese día.
  const hoy = (x: SwingCandle[]) => leerMentes(entrada({ velas: x.slice(0, corte), fund: null }));
  assert.deepEqual(hoy(v), hoy(futuroDistinto));
  assert.deepEqual(nivelesAr(v.slice(0, corte)), nivelesAr(futuroDistinto.slice(0, corte)));
});

test("niveles: solo pivotes confirmados; perfil: reparte todo el volumen", () => {
  const v = serie(260, 0, 13);
  // Un pico en la penúltima rueda todavía no es pivote (faltan 5 ruedas a la derecha).
  const conPico = v.map((c, k) => (k === v.length - 2 ? { ...c, high: c.high * 1.5 } : c));
  const n = nivelesAr(conPico);
  assert.ok(n.resistencias.every((r) => r.precio < conPico[v.length - 2].high * 0.99));
  assert.ok(n.soportes.every((s) => s.precio <= conPico.at(-1)!.close));
  const p = perfilAprox(v);
  const total = v.reduce((s, c) => s + c.volume, 0);
  assert.ok(Math.abs(p.franjas.reduce((s, f) => s + f.volumen, 0) - total) < 1e-6 * total);
  assert.ok(p.poc !== null);
});

test("buscador del mapa: encuentra por ticker o nombre, sin tildes", () => {
  assert.equal(papelPorTicker("ggal.ba")?.ticker, "GGAL");
  assert.equal(papelPorTicker("BYMA")?.nombre, "Bolsas y Mercados Argentinos");
  assert.ok(buscarPapeles("byma").some((p) => p.ticker === "BYMA"));
  assert.ok(buscarPapeles("energia").some((p) => p.ticker === "PAMP"));
  assert.deepEqual(buscarPapeles("x"), []);
  assert.ok(SIMBOLOS_PERMITIDOS.has("^MERV") && SIMBOLOS_PERMITIDOS.has("SPY"));
});
