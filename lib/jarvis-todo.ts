/**
 * El contexto común de JARVIS: lo que la app y Telegram le dan a la IA además del radar de cripto, para que conteste de todo
 * lo que la terminal sabe y no solo de cripto. Acciones y CEDEARs de BYMA (la pizarra con las mentes, Fibonacci, los agentes y
 * la lectura diaria del papel que la persona nombró), el resumen de HOY (planes, zonas de compra, avisos, señales del núcleo) y
 * el semáforo de evidencia del registro. Reconoce el papel por ticker o por nombre («ypf» es YPFD) y, si la pregunta no lo
 * nombra (un seguimiento: «¿y con fibonacci?»), lo busca en lo último que se habló. Los números pasan por forAi (formato
 * argentino) antes de llegar al modelo. Lo que falta se dice: desconocido no es cero. No es asesoramiento financiero. Pura.
 */
import type { Hoy } from "./hoy.ts";
import type { AgenteEnPapel } from "./mercado-ar-agentes.ts";
import { ACCIONES_AR, CEDEARS, PAPELES_AR, lecturaDiaria, type PapelAr } from "./mercado-ar.ts";
import { zonaFib, zonaVentaFib, type AnalisisAr } from "./mercado-ar-tecnico.ts";
import type { PizarraActivo } from "./pizarra-activos.ts";
import type { SwingCandle } from "./swing-entries.ts";
import { arNumber } from "./ai-numbers.ts";
import type { Voz } from "./pizarra.ts";

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Palabras de un nombre que no identifican a la empresa. */
const GENERICAS = new Set(["grupo", "banco", "financiero", "argentina", "argentinos", "sociedad", "comercial", "bolsas", "mercados", "transportadora", "holding", "central", "energia", "spdr", "etf", "norte", "plata", "telecom", "negra", "chase", "morgan", "valores", "energy"]);
/** Palabras del castellano que además son tickers o nombres: solo cuentan escritas en mayúsculas («META», «VISA»). */
const AMBIGUAS = new Set(["meta", "come", "tran", "valo", "dis", "visa", "cres", "supv", "loma", "puerto", "macro", "pampa", "vista"]);
/** Cómo la gente nombra a algunas empresas y no figura en su nombre oficial. */
const ALIAS: Record<string, string> = { google: "GOOGL", facebook: "META", ypf: "YPFD", brk: "BRKB", berkshire: "BRKB", coca: "KO", cocacola: "KO", mercadolibre: "MELI", nasdaq: "QQQ", sp500: "SPY" };

type Clave = { papel: PapelAr; ambigua: boolean };
let CLAVES: Map<string, Clave> | null = null;
let NOMBRES: { frase: string; papel: PapelAr }[] | null = null;

function indices() {
  if (CLAVES && NOMBRES) return { claves: CLAVES, nombres: NOMBRES };
  const claves = new Map<string, Clave>();
  const nombres: { frase: string; papel: PapelAr }[] = [];
  const poner = (k: string, papel: PapelAr, ambigua: boolean) => {
    if (k && !claves.has(k)) claves.set(k, { papel, ambigua });
  };
  for (const p of PAPELES_AR) {
    const t = p.ticker.toLowerCase();
    poner(t, p, t.length <= 2 || AMBIGUAS.has(t));
    const frase = norm(p.nombre);
    if (frase.includes(" ")) nombres.push({ frase, papel: p });
    for (const w of frase.split(" ")) {
      if (/\d/.test(w) || GENERICAS.has(w)) continue;
      if (w.length >= 4 || w === frase) poner(w, p, AMBIGUAS.has(w));
    }
  }
  for (const [alias, ticker] of Object.entries(ALIAS)) {
    const p = PAPELES_AR.find((x) => x.ticker === ticker);
    if (p) claves.set(alias, { papel: p, ambigua: false });
  }
  CLAVES = claves;
  NOMBRES = nombres;
  return { claves, nombres };
}

/** Hasta dos papeles de BYMA que el texto nombra, por ticker o por nombre, en el orden en que aparecen. */
export function papelesPedidos(texto: string, maximo = 2): PapelAr[] {
  const { claves, nombres } = indices();
  const hallados: { pos: number; papel: PapelAr }[] = [];
  const tokens = [...texto.matchAll(/[\p{L}\p{N}]+/gu)];
  for (const m of tokens) {
    const original = m[0];
    const k = claves.get(norm(original).replace(/ /g, ""));
    if (!k) continue;
    const mayus = original === original.toUpperCase() && /[A-Z]/.test(original);
    if (k.ambigua && !mayus) continue;
    hallados.push({ pos: m.index ?? 0, papel: k.papel });
  }
  const t = ` ${norm(texto)} `;
  for (const n of nombres) {
    const pos = t.indexOf(` ${n.frase} `);
    if (pos >= 0) hallados.push({ pos, papel: n.papel });
  }
  const out: PapelAr[] = [];
  for (const h of hallados.sort((a, b) => a.pos - b.pos)) if (!out.some((p) => p.ticker === h.papel.ticker)) out.push(h.papel);
  return out.slice(0, maximo);
}

/** Los papeles de la pregunta; si no nombra ninguno, los de lo último que dijo la persona (un seguimiento). */
export function papelesDeLaConversacion(pregunta: string, anteriores: string[]): PapelAr[] {
  const ahora = papelesPedidos(pregunta);
  if (ahora.length) return ahora;
  for (const previo of [...anteriores].reverse().slice(0, 3)) {
    const p = papelesPedidos(previo);
    if (p.length) return p;
  }
  return [];
}

const corto = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
const voz = (v: Voz) => ({ quien: v.nombre, porQue: corto(v.motivo, 170), ...(v.muestra !== null ? { muestra: v.muestra } : {}) });
const fecha = (t: number) => new Date(t).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric" });

export type TecnicoResumen = Pick<AnalisisAr, "fib" | "fibMotivo" | "fibVenta" | "zonas" | "niveles">;
export type EntradaResumen = {
  papel: PapelAr;
  moneda: string | null;
  velas: SwingCandle[];
  agentes: AgenteEnPapel[];
  tecnico: TecnicoResumen;
  /** Null si todavía no se calculó la pizarra de este papel (la lectura rápida, sin el cierre del servidor). */
  pizarra: PizarraActivo | null;
};

/**
 * Lo que la IA necesita de un papel: su pizarra con razones a favor y en contra, las zonas de Fibonacci de compra y de venta,
 * las zonas por confluencia, los niveles con estrellas, los agentes que disparan y su lectura diaria.
 */
export function resumenPapel(l: EntradaResumen) {
  const d = l.pizarra?.deliberacion ?? null;
  const dia = lecturaDiaria(l.velas);
  const ultima = l.velas.at(-1);
  const t = l.tecnico;
  return {
    ticker: l.papel.ticker,
    nombre: l.papel.nombre,
    tipo: l.papel.tipo,
    moneda: l.moneda,
    ultimaRueda: ultima ? fecha(ultima.openTime) : null,
    lecturaDiaria: dia
      ? { cierre: dia.cierre, var1: dia.var1, var5: dia.var5, var20: dia.var20, tendencia: dia.tendencia, rsi14: dia.rsi14, atrPct: dia.atrPct, desdeMaximo52s: dia.desdeMaximo, desdeMinimo52s: dia.desdeMinimo, volumenRelativo: dia.volumenRelativo, faltantes: dia.faltantes }
      : null,
    fibonacci: t.fib ? { estado: t.fib.estado, zonaDeCompra: t.fib.zona, plan: t.fib.plan, historialEnEstePapel: t.fib.historial } : { estado: "SIN ZONA DE COMPRA", motivo: t.fibMotivo },
    fibonacciVenta: t.fibVenta
      ? { estado: t.fibVenta.estado, zonaDeVenta: t.fibVenta.zona, objetivosHaciaAbajo: t.fibVenta.extensiones, plan: t.fibVenta.plan, historialEnEstePapel: t.fibVenta.historial, nota: "para quien tiene el papel es la zona donde tomar ganancias o reducir; el corto minorista en BYMA es limitado" }
      : null,
    zonasPorConfluencia: t.zonas.map((z) => ({ lado: z.side === "SOPORTE" ? "compra" : "venta", estrellas: z.stars, desde: z.low, hasta: z.high, motivos: z.kinds, distanciaPct: z.distancePct })),
    niveles: t.niveles.slice(0, 8).map((n) => ({ precio: n.price, tipo: n.kind === "SOPORTE" ? "soporte" : "resistencia", estrellas: n.stars, distanciaPct: n.distancePct })),
    pizarra: d
      ? {
          veredicto: d.veredicto,
          razon: d.razon,
          aFavor: d.aFavor.slice(0, 5).map(voz),
          enContra: d.enContra.slice(0, 5).map(voz),
          esperan: d.espera.length,
          seAbstienen: d.abstienen.map((v) => ({ quien: v.nombre, falta: v.falta ? corto(v.falta, 110) : null })).slice(0, 4),
          plan: d.plan,
          paraQueCambie: d.destraba.slice(0, 3),
          decision: d.huella,
        }
      : null,
    pizarraNota: d ? null : "la pizarra de este papel todavía no se calculó (se arma una vez por rueda, después del cierre); lo de arriba es la lectura rápida de las ruedas",
    agentesQueDisparanHoy: l.agentes.filter((a) => a.senalHoy).map((a) => ({ agente: a.agente, entrada: a.senalHoy!.referencia, stop: a.senalHoy!.escalera.stop, tp1: a.senalHoy!.escalera.tp1, tp2: a.senalHoy!.escalera.tp2, tp3: a.senalHoy!.escalera.tp3 })),
    avisoDeDatos: "velas diarias de Yahoo Finance con demora; sin footprint; balances solo si la empresa presenta ante la SEC",
  };
}

/** Lo que se guarda por papel: el resumen y de cuándo es. */
export type PapelGuardado = ReturnType<typeof resumenPapel> & { lecturaDel?: string };

/** La lectura rápida de un papel, sin la pizarra: solo lo barato (ruedas, Fibonacci de compra y de venta). Para antes de que el servidor lo calcule. */
export function resumenRapido(papel: PapelAr, velas: SwingCandle[], moneda: string | null) {
  const z = zonaFib(velas);
  return resumenPapel({ papel, moneda, velas, agentes: [], tecnico: { fib: z.fib, fibMotivo: z.motivo, fibVenta: zonaVentaFib(velas), zonas: [], niveles: [] }, pizarra: null });
}

export type PapelParaIa = ReturnType<typeof resumenPapel> | { ticker: string; nombre: string; noSePudoLeer: string };

/** El resumen de HOY para la IA: corto, con lo accionable primero. */
export function resumenHoy(h: Hoy) {
  return {
    titular: h.titular,
    planesDeLaPizarra: [
      ...h.planesCripto.map((p) => ({ activo: p.symbol.replace(/USDT$/, ""), mercado: "cripto", lado: p.lado === "CORTO" ? "corto" : "largo", razon: corto(p.razon, 160), decision: p.huella })),
      ...h.planesAr.filter((p) => !p.viejo).map((p) => ({ activo: p.ticker, mercado: "BYMA", lado: "largo", decision: p.huella })),
    ],
    papelesEnZonaDeCompraFibonacci: h.enZonaAr,
    avisosDeLas24h: h.avisos.slice(0, 5).map((a) => corto(a.texto, 200)),
    senalesAbiertasDelNucleo: h.nucleo.slice(0, 6).map((s) => ({ moneda: s.symbol.replace(/USDT$/, ""), lado: s.side === "LONG" ? "largo" : "corto", entrada: s.entry, stop: s.stop, objetivo: s.target, fuente: s.source })),
    evidenciaPorFuente: h.evidencia.slice(0, 8).map((e) => ({ fuente: e.nombre, nivel: e.nivel, detalle: corto(e.texto, 140), cerradas: e.cerradas, abiertas: e.abiertas })),
    noSePudoLeer: h.faltan,
  };
}

export type TodoParaIa = {
  cobertura: string;
  papelesDeBymaQueCubro: { acciones: string[]; cedears: string[] };
  hoy: ReturnType<typeof resumenHoy> | null;
  papeles: PapelParaIa[];
};

export function armarTodo(x: { hoy: Hoy | null; papeles: PapelParaIa[] }): TodoParaIa {
  return {
    cobertura:
      "ALT RADAR cubre cripto (Binance, velas de 1h, 4h y diario) y acciones y CEDEARs de BYMA (velas diarias de Yahoo Finance, con demora). Para BYMA no hay footprint ni balances de empresas argentinas. Todo resultado de operaciones sale del registro, con su muestra: menos de 15 cierres es muestra mínima.",
    papelesDeBymaQueCubro: { acciones: ACCIONES_AR.map((p) => `${p.ticker} (${p.nombre})`), cedears: CEDEARS.map((p) => p.ticker) },
    hoy: x.hoy ? resumenHoy(x.hoy) : null,
    papeles: x.papeles,
  };
}

/**
 * La respuesta sobre un papel cuando ninguna IA puede contestar (se acabó el cupo o no hay conexión): sale de las mismas reglas
 * y números, sin modelo. Dice lo que hay y lo que no se pudo leer; nunca inventa un nivel. No es asesoramiento financiero.
 */
export function textoDePapel(p: PapelParaIa): string {
  if ("noSePudoLeer" in p) return `${p.nombre} (${p.ticker}): no pude leerlo ahora (${p.noSePudoLeer}). Probá de nuevo en un rato.`;
  const n = (x: number | null | undefined) => (typeof x === "number" ? arNumber(x) : "s/d");
  const partes: string[] = [];
  const cierre = p.lecturaDiaria ? `, cierre ${n(p.lecturaDiaria.cierre)}${p.moneda ? ` ${p.moneda}` : ""}` : "";
  partes.push(`${p.nombre} (${p.ticker}): última rueda ${p.ultimaRueda ?? "s/d"}${cierre}.`);
  const f = p.fibonacci;
  const z = "zonaDeCompra" in f ? f.zonaDeCompra : undefined;
  if (z) {
    const pl = "plan" in f ? f.plan : null;
    const plan = pl ? ` Plan si se compra en la zona: entrada ${n(pl.entrada)}, SL ${n(pl.stop)}, TP1 ${n(pl.tp1)}, TP2 ${n(pl.tp2)}, TP3 ${n(pl.tp3)}.` : "";
    partes.push(`Zona de compra de Fibonacci: ${f.estado}, de ${n(z.bajo)} a ${n(z.alto)}.${plan}`);
  } else if (p.fibonacciVenta) {
    const v = p.fibonacciVenta;
    const pl = v.plan ? ` Plan de venta en la zona: entrada ${n(v.plan.entrada)}, SL ${n(v.plan.stop)}, TP1 ${n(v.plan.tp1)}, TP2 ${n(v.plan.tp2)}, TP3 ${n(v.plan.tp3)}.` : "";
    partes.push(`Sin zona de compra (la última pierna es bajista). Zona de venta de Fibonacci: ${v.estado}, de ${n(v.zonaDeVenta.bajo)} a ${n(v.zonaDeVenta.alto)}.${pl}`);
  } else partes.push(`Fibonacci: sin zona de compra${"motivo" in f && f.motivo ? ` (${f.motivo})` : ""}.`);
  const conf = p.zonasPorConfluencia.filter((x) => x.motivos.length >= 2);
  if (conf.length) partes.push(`Zonas por confluencia: ${conf.map((x) => `${x.lado} ${n(x.desde)} a ${n(x.hasta)} (${"★".repeat(x.estrellas)}, ${x.motivos.join(" + ")})`).join("; ")}.`);
  if (p.pizarra) {
    partes.push(`Pizarra: ${p.pizarra.veredicto}. ${p.pizarra.razon}`);
    if (p.pizarra.aFavor.length) partes.push(`A favor: ${p.pizarra.aFavor.map((v) => v.quien).join(", ")}.`);
    if (p.pizarra.enContra.length) partes.push(`En contra: ${p.pizarra.enContra.map((v) => v.quien).join(", ")}.`);
  } else if (p.pizarraNota) partes.push(`Pizarra: ${p.pizarraNota}.`);
  partes.push("Es lectura en papel con velas diarias, no es asesoramiento financiero.");
  return partes.join(" ");
}

/** El texto sin IA para la pregunta, si nombra papeles de BYMA; null si no (entonces responde el motor local de siempre). */
export function respuestaSinIa(todo: TodoParaIa | null): string | null {
  return todo?.papeles.length ? todo.papeles.map(textoDePapel).join("\n\n") : null;
}
