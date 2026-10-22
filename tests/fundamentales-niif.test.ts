/**
 * Pruebas de los balances NIIF de las empresas argentinas (lib/fundamentales-sec.ts): se leen del 20-F con la taxonomía
 * ifrs-full, la moneda la fija el primer concepto y no se mezclan monedas, el nombre que devuelve SEC se controla, y las
 * mentes de valor miran calidad, deuda y crecimiento sin comparar el precio de hoy con cifras en pesos ajustados por inflación.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bajarFundamentales, claveUnidad, empresaSec, motivoSinBalance, type Fundamentales } from "../lib/fundamentales-sec.ts";
import { metricas } from "../lib/mentes-inversoras.ts";
import { razonarMentes } from "../lib/mentes-metodo.ts";
import type { EntradaMentes } from "../lib/mentes-inversoras.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const fila = (end: string, val: number, flujo: boolean) => ({ end, val, form: "20-F", fp: "FY", filed: `${end.slice(0, 4)}-12-20`, ...(flujo ? { start: `${Number(end.slice(0, 4)) - 1}-${end.slice(5)}` } : {}) });
const anios = ["2022-12-31", "2023-12-31", "2024-12-31", "2025-12-31"];

/** Un SEC de mentira: devuelve cada concepto ifrs-full en la moneda pedida; `solo` limita las monedas por concepto. */
function sec(moneda: string, entidad: string, soloEn: Record<string, string> = {}): typeof fetch {
  return (async (url: string) => {
    const nombre = /\/ifrs-full\/(\w+)\.json/.exec(url)?.[1];
    if (!nombre || !["Revenue", "ProfitLossAttributableToOwnersOfParent", "DilutedEarningsLossPerShare", "EquityAttributableToOwnersOfParent", "Liabilities", "CurrentAssets", "CurrentLiabilities"].includes(nombre)) return new Response("", { status: 404 });
    const m = soloEn[nombre] ?? moneda;
    const eps = nombre.includes("PerShare");
    const flujo = ["Revenue", "ProfitLossAttributableToOwnersOfParent"].includes(nombre) || eps;
    const unidad = eps ? `${m}/shares` : m;
    return new Response(JSON.stringify({ entityName: entidad, units: { [unidad]: anios.map((f, k) => fila(f, (k + 1) * 100, flujo)) } }));
  }) as unknown as typeof fetch;
}

test("empresaSec: las argentinas con 20-F son NIIF y las demás dicen por qué no hay balances", () => {
  assert.equal(empresaSec("GGAL")?.niif, true);
  assert.equal(empresaSec("AAPL")?.niif, false);
  assert.equal(empresaSec("TXAR"), null);
  assert.match(motivoSinBalance("TXAR"), /CNV/);
  assert.match(motivoSinBalance("SPY"), /ETF/);
});

test("claveUnidad: la moneda sola o la moneda por acción", () => {
  const j = { units: { ARS: [], "ARS/shares": [], USD: [] } };
  assert.equal(claveUnidad(j, "ARS", false), "ARS");
  assert.equal(claveUnidad(j, "ARS", true), "ARS/shares");
  assert.equal(claveUnidad({ units: { USD: [] } }, "ARS", false), null);
  assert.equal(claveUnidad({ units: { ARS_per_share: [] } }, "ARS", true), "ARS_per_share");
});

test("bajarFundamentales NIIF: lee ifrs-full en pesos y lo dice; faltante queda null", async () => {
  const r = await bajarFundamentales("YPFD", { fetchImpl: sec("ARS", "YPF Sociedad Anonima"), ahora: 7 });
  assert.equal(r.error, null);
  assert.equal(r.fund?.moneda, "ARS");
  assert.match(r.fund?.fuente ?? "", /NIIF/);
  assert.equal(r.fund?.ejercicios.length, 4);
  const ult = r.fund!.ejercicios.at(-1)!;
  assert.equal(ult.ingresos, 400);
  assert.equal(ult.bpa, 400);
  assert.equal(ult.deuda, null, "desconocido no es cero");
  assert.ok(r.fund?.faltantes.includes("deuda"));
});

test("bajarFundamentales NIIF: una empresa que presenta en dólares (Vista) queda en dólares", async () => {
  const r = await bajarFundamentales("VIST", { fetchImpl: sec("USD", "Vista Energy, S.A.B. de C.V.") });
  assert.equal(r.fund?.moneda, "USD");
});

test("bajarFundamentales NIIF: no mezcla monedas ni acepta otra empresa", async () => {
  // El primer concepto (ingresos) viene en pesos: el patrimonio que solo está en dólares no entra.
  const mezcla = await bajarFundamentales("GGAL", { fetchImpl: sec("ARS", "Grupo Financiero Galicia S.A.", { EquityAttributableToOwnersOfParent: "USD" }) });
  assert.equal(mezcla.fund?.moneda, "ARS");
  assert.equal(mezcla.fund?.ejercicios.at(-1)?.patrimonio, null);
  assert.ok(mezcla.fund?.faltantes.includes("patrimonio"));
  const otra = await bajarFundamentales("GGAL", { fetchImpl: sec("ARS", "Otra Empresa SA") });
  assert.equal(otra.fund, null);
  assert.match(otra.error ?? "", /no la empresa esperada/);
});

const fundArs = (): Fundamentales => ({
  simbolo: "YPFD",
  entidad: "YPF",
  fuente: "SEC EDGAR (XBRL, NIIF, 20-F)",
  leido: 0,
  faltantes: [],
  moneda: "ARS",
  ejercicios: [
    { fin: "2022-12-31", ingresos: 100, gananciaNeta: 20, bpa: 2, patrimonio: 100, pasivo: 50, deuda: 20, activoCorriente: 80, pasivoCorriente: 30 },
    { fin: "2023-12-31", ingresos: 130, gananciaNeta: 26, bpa: 2.6, patrimonio: 120, pasivo: 55, deuda: 20, activoCorriente: 90, pasivoCorriente: 30 },
    { fin: "2024-12-31", ingresos: 170, gananciaNeta: 34, bpa: 3.4, patrimonio: 140, pasivo: 60, deuda: 20, activoCorriente: 100, pasivoCorriente: 40 },
    { fin: "2025-12-31", ingresos: 220, gananciaNeta: 44, bpa: 4.4, patrimonio: 160, pasivo: 70, deuda: 20, activoCorriente: 120, pasivoCorriente: 50 },
  ],
});

function velas(n: number): SwingCandle[] {
  const out: SwingCandle[] = [];
  let p = 1000;
  for (let k = 0; k < n; k += 1) {
    const o = p;
    const c = o * 1.002;
    out.push({ openTime: Date.UTC(2025, 0, 1) + k * 86_400_000, open: o, high: c * 1.003, low: o * 0.997, close: c, volume: 1000, quoteVolume: 1000 * c });
    p = c;
  }
  return out;
}

test("con cifras en pesos: no hay PER, pero la calidad, la deuda y el crecimiento sí se evalúan", () => {
  const f = fundArs();
  const m = metricas("YPFD", f, null);
  assert.equal(m.per, null);
  assert.match(m.perMotivo ?? "", /ARS/);
  assert.ok(m.roePromedio !== null && m.cagrBpa !== null && m.deudaPatrimonio !== null);
  const x: EntradaMentes = { simbolo: "YPFD", velas: velas(300), moneda: "ARS", precioUsd: null, fund: f, sinFund: null, fuerzaRelativa: null, mercadoAlcista: null, mercadoNombre: "el Merval", volMediana: null };
  const rs = razonarMentes(x, "ACCION");
  const de = (id: string) => rs.find((r) => r.id === id)!;
  // Buffett: la calidad pasa; el precio no se puede juzgar y lo dice, sin inventar un objetivo.
  assert.equal(de("BUFFETT").veredicto, "ESPERARÍA");
  assert.match(de("BUFFETT").porQue, /ARS/);
  assert.equal(de("BUFFETT").plan?.entrada ?? null, null);
  // Graham: sin precio comparable no hay valor ni colchón; nunca pesos mostrados como dólares.
  assert.equal(de("GRAHAM").veredicto, "SIN DATOS");
  assert.ok(!JSON.stringify(de("GRAHAM")).includes("US$"));
  assert.ok(!JSON.stringify(de("LYNCH").plan ?? {}).includes("US$"));
  // Musk mira el crecimiento de ingresos: sí opina.
  assert.notEqual(de("MUSK").veredicto, "SIN DATOS");
});
