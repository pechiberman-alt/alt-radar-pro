/**
 * El lado del navegador de MERCADO AR: baja las series (/api/mercado-ar) y los balances (/api/mercado-ar/fundamentales),
 * las guarda en memoria mientras la pestaña está abierta y arma la entrada de las mentes y de los agentes para un papel o
 * para todo el panel. Lo usan el panel MERCADO AR, el MAPA y la sala de las mentes, así leen lo mismo. Las series viajan en
 * lotes de 12 (/api/mercado-ar/lote, formato compacto), de a 3 lotes por vez; los balances, de a una empresa (SEC limita).
 * Nada de esto se guarda en el navegador ni pide historial en intervalos.
 */
import { INDICE_EEUU, INDICE_MERVAL, PAPELES_AR, estadoSerie, type EstadoSerie, type PapelAr, type SerieAr } from "./mercado-ar.ts";
import { consenso, leerMentes, percentiles, rendimiento, sma, volatilidadAnual, type Consenso, type LecturaMente } from "./mentes-inversoras.ts";
import { estudiarPapel, type AgenteEnPapel } from "./mercado-ar-agentes.ts";
import { EMPRESAS_SEC, SIN_BALANCE, type Fundamentales } from "./fundamentales-sec.ts";
import { expandir, MAX_LOTE, type ItemLote } from "./mercado-ar-lote.ts";
import { zonaFib, type ZonaFibAr } from "./mercado-ar-tecnico.ts";

export type SerieCargada = { serie: SerieAr | null; fuente: string | null; edadSeg: number; error: string | null; estado: EstadoSerie };
export type FundCargado = { fund: Fundamentales | null; viejo: boolean; error: string | null };

const series = new Map<string, Promise<SerieCargada>>();
const balances = new Map<string, Promise<FundCargado>>();

export function cargarSerie(yahoo: string): Promise<SerieCargada> {
  const ya = series.get(yahoo);
  if (ya) return ya;
  const p = (async (): Promise<SerieCargada> => {
    try {
      const r = await fetch(`/api/mercado-ar?simbolo=${encodeURIComponent(yahoo)}`, { cache: "no-store" });
      const j = (await r.json()) as { serie: SerieAr | null; fuente: string | null; edadSeg: number; error: string | null };
      return { ...j, estado: estadoSerie(j.serie, Date.now()) };
    } catch (e) {
      series.delete(yahoo); // un error de red se puede reintentar
      return { serie: null, fuente: null, edadSeg: 0, error: e instanceof Error ? e.message : "sin conexión", estado: { estado: "DATA_UNAVAILABLE", motivo: "sin conexión" } };
    }
  })();
  series.set(yahoo, p);
  return p;
}

const sinConexion = (e: unknown): SerieCargada => ({ serie: null, fuente: null, edadSeg: 0, error: e instanceof Error ? e.message : "sin conexión", estado: { estado: "DATA_UNAVAILABLE", motivo: "sin conexión" } });

/**
 * Varias series en un pedido. Las que ya están (o se están bajando) no se vuelven a pedir. Si el lote falla, cada una se
 * reintenta sola.
 */
export function cargarLote(simbolos: string[]): Promise<SerieCargada[]> {
  const faltan = [...new Set(simbolos)].filter((s) => !series.has(s));
  for (let k = 0; k < faltan.length; k += MAX_LOTE) {
    const parte = faltan.slice(k, k + MAX_LOTE);
    const lote = fetch(`/api/mercado-ar/lote?simbolos=${parte.map(encodeURIComponent).join(",")}`, { cache: "no-store" }).then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return ((await r.json()) as { series: Record<string, ItemLote> }).series;
    });
    for (const s of parte) {
      series.set(
        s,
        lote.then(
          (todas) => {
            const it = todas[s];
            if (!it) return sinConexion(new Error("el lote no la trajo"));
            const serie = expandir(it.serie);
            return { serie, fuente: it.fuente, edadSeg: it.edadSeg, error: it.error, estado: estadoSerie(serie, Date.now()) };
          },
          () => {
            series.delete(s);
            return cargarSerie(s);
          },
        ),
      );
    }
  }
  return Promise.all(simbolos.map((s) => series.get(s) ?? cargarSerie(s)));
}

let colaFund: Promise<unknown> = Promise.resolve();
export function cargarFund(ticker: string): Promise<FundCargado> {
  const ya = balances.get(ticker);
  if (ya) return ya;
  if (!EMPRESAS_SEC[ticker]) {
    const p = Promise.resolve({ fund: null, viejo: false, error: SIN_BALANCE[ticker] ?? "sin balances para este papel" });
    balances.set(ticker, p);
    return p;
  }
  // En fila, de a una empresa por vez.
  const p = colaFund.then(async (): Promise<FundCargado> => {
    try {
      const r = await fetch(`/api/mercado-ar/fundamentales?simbolo=${encodeURIComponent(ticker)}`, { cache: "no-store" });
      return (await r.json()) as FundCargado;
    } catch (e) {
      balances.delete(ticker);
      return { fund: null, viejo: false, error: e instanceof Error ? e.message : "sin conexión" };
    }
  });
  colaFund = p.catch(() => undefined);
  balances.set(ticker, p);
  return p;
}

/** Las ruedas cerradas de un papel (vacío si no hay). */
const velasDe = (s: SerieCargada | undefined) => s?.serie?.velas ?? [];

export type Universo = { rend6m: Map<string, number | null>; volMediana: { ACCION: number | null; CEDEAR: number | null }; mercado: { ACCION: boolean | null; CEDEAR: boolean | null } };

/** Lo que el panel ya tiene cargado, para comparar un papel con los demás (fuerza relativa, volatilidad, índices). */
export async function universoCargado(): Promise<Universo> {
  const rend6m = new Map<string, number | null>();
  const vols: { ACCION: number[]; CEDEAR: number[] } = { ACCION: [], CEDEAR: [] };
  for (const p of PAPELES_AR) {
    const s = series.get(p.yahoo);
    if (!s) continue;
    const v = velasDe(await s);
    rend6m.set(p.ticker, rendimiento(v));
    const vol = volatilidadAnual(v);
    if (vol !== null) vols[p.tipo].push(vol);
  }
  const mediana = (xs: number[]) => {
    if (xs.length < 5) return null;
    const o = [...xs].sort((a, b) => a - b);
    return o.length % 2 ? o[(o.length - 1) / 2] : (o[o.length / 2 - 1] + o[o.length / 2]) / 2;
  };
  const sobre200 = async (yahoo: string) => {
    const v = velasDe(await cargarSerie(yahoo));
    const m = sma(v.map((c) => c.close), 200);
    return m === null ? null : v.at(-1)!.close > m;
  };
  const [merval, sp] = await Promise.all([sobre200(INDICE_MERVAL), sobre200(INDICE_EEUU)]);
  return { rend6m, volMediana: { ACCION: mediana(vols.ACCION), CEDEAR: mediana(vols.CEDEAR) }, mercado: { ACCION: merval, CEDEAR: sp } };
}

export type LecturaPapel = {
  papel: PapelAr;
  serie: SerieCargada;
  /** Solo CEDEARs: la acción de afuera en dólares. */
  subyacente: SerieCargada | null;
  fund: FundCargado | null;
  mentes: LecturaMente[];
  consenso: Consenso;
  agentes: AgenteEnPapel[];
  /** La zona de compra de Fibonacci de la serie que se opera (en pesos). */
  fib: ZonaFibAr | null;
  fibMotivo: string | null;
};

/** Todo lo de un papel: su serie, la de afuera si es CEDEAR, los balances, las mentes y los agentes. */
export async function leerPapel(papel: PapelAr, u?: Universo): Promise<LecturaPapel> {
  const [serie, subyacente, fund] = await Promise.all([
    cargarSerie(papel.yahoo),
    papel.subyacente ? cargarSerie(papel.subyacente) : Promise.resolve(null),
    papel.tipo === "CEDEAR" ? cargarFund(papel.ticker) : Promise.resolve(null),
  ]);
  const uni = u ?? (await universoCargado());
  const tickers = [...uni.rend6m.keys()].filter((t) => PAPELES_AR.find((p) => p.ticker === t)?.tipo === papel.tipo);
  const pcts = percentiles(tickers.map((t) => uni.rend6m.get(t) ?? null));
  const k = tickers.indexOf(papel.ticker);
  const fuerza = k >= 0 && tickers.length >= 10 ? pcts[k] : null;
  // Los CEDEARs se leen técnicamente sobre la acción de afuera en dólares (la tendencia de la empresa, sin el dólar local).
  const tecnica = papel.tipo === "CEDEAR" && subyacente?.serie?.velas.length ? subyacente : serie;
  const mentes = leerMentes({
    simbolo: papel.ticker,
    velas: velasDe(tecnica),
    moneda: tecnica.serie?.meta.moneda ?? null,
    precioUsd: subyacente?.serie?.velas.at(-1)?.close ?? null,
    fund: fund?.fund ?? null,
    sinFund: papel.tipo === "ACCION" ? "no hay una fuente gratis de balances de empresas argentinas en formato de datos (la CNV publica PDF)" : (fund?.error ?? null),
    fuerzaRelativa: fuerza,
    mercadoAlcista: uni.mercado[papel.tipo],
    mercadoNombre: papel.tipo === "ACCION" ? "el Merval" : "el S&P 500 (SPY)",
    volMediana: uni.volMediana[papel.tipo],
  });
  const z = zonaFib(velasDe(serie));
  return { papel, serie, subyacente, fund, mentes, consenso: consenso(mentes), agentes: estudiarPapel(papel.ticker, velasDe(serie)), fib: z.fib, fibMotivo: z.motivo };
}

/** Baja todo el panel (o una parte) en lotes, de a 3 lotes por vez, avisando el avance. */
export async function cargarPanel(papeles: PapelAr[], alAvanzar?: (hechos: number, total: number) => void): Promise<void> {
  const todos = [...papeles.flatMap((p) => (p.subyacente ? [p.yahoo, p.subyacente] : [p.yahoo])), INDICE_MERVAL, INDICE_EEUU];
  const lotes: string[][] = [];
  for (let k = 0; k < todos.length; k += MAX_LOTE) lotes.push(todos.slice(k, k + MAX_LOTE));
  let hechos = 0;
  let k = 0;
  const trabajar = async () => {
    while (k < lotes.length) {
      const l = lotes[k++];
      await cargarLote(l);
      hechos += l.length;
      alAvanzar?.(hechos, todos.length);
    }
  };
  await Promise.all([trabajar(), trabajar(), trabajar()]);
}

let panel: Promise<LecturaPapel[]> | null = null;

/**
 * Todo el panel leído por las mentes y los agentes, una vez por pestaña abierta (lo comparten el escáner y la sala de las
 * mentes). `nuevo` lo vuelve a leer.
 */
export function panelCompleto(alAvanzar?: (texto: string, hechos: number, total: number) => void, nuevo = false): Promise<LecturaPapel[]> {
  if (panel && !nuevo) return panel;
  panel = (async () => {
    await cargarPanel(PAPELES_AR, (h, t) => alAvanzar?.("Bajando ruedas", h, t));
    const u = await universoCargado();
    const out: LecturaPapel[] = [];
    for (const [k, p] of PAPELES_AR.entries()) {
      alAvanzar?.(`Mentes y agentes leyendo ${p.ticker}${p.tipo === "CEDEAR" ? " (y sus balances)" : ""}`, k, PAPELES_AR.length);
      out.push(await leerPapel(p, u));
      await new Promise((r) => setTimeout(r, 0)); // que la pantalla respire entre papel y papel
    }
    return out;
  })();
  panel.catch(() => {
    panel = null;
  });
  return panel;
}
