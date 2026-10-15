/**
 * El diario de tu cuenta de Axi (MT5 en centavos, USC): las ejecuciones que devuelve el conector de Axi, validadas una por una
 * y resumidas. Solo lectura: nada de esto manda órdenes ni guarda acceso a Axi. Pura: sin red ni base (lib/axi-db.ts guarda).
 *
 * Por qué no entra en el diario de Binance (lib/account-journal.ts): ese modelo asume dólares y cuentas de Binance. Una cuenta en
 * centavos (100 USC = 1 USD) con CFD no encaja sin convertir cosas en silencio, y se mezclarían monedas. Unirlos es una decisión
 * aparte. Tampoco calcula acierto: eso sale solo del registro unificado (lib/registro.ts), y por ahora no hay R para estas
 * operaciones, así que el resumen no trae porcentajes.
 */
import { MUESTRA_MINIMA, type Muestra } from "./registro.ts";

export const MONEDA_AXI = "USC";
/** 100 USC = 1 USD: la convención de las cuentas en centavos. Sirve para decir el equivalente, nunca para sumar. */
export const CENTAVOS_POR_USD = 100;
/** Tope de ejecuciones guardadas por persona. Lo que pase de acá no se muestra completo, y se dice. */
export const MAX_DEALS_AXI = 500;
/** Ejecuciones por pedido. El conector devuelve hasta 1.000; el navegador las manda en tandas de este tamaño. */
export const MAX_POR_PEDIDO_AXI = 200;

const ACCIONES_OPERACION = ["buy", "sell"];
/** Entradas que cierran o reducen una posición: ahí se realiza el resultado. */
const ENTRADAS_CIERRE = ["out", "inout", "out_by"];
const ENTRADAS = ["in", ...ENTRADAS_CIERRE];
/** Los símbolos de Axi son como XAUUSD.c o USTECH: letras, números, punto, guion y guion bajo. */
const SIMBOLO = /^[A-Za-z0-9._-]{1,20}$/;
const ANO_MIN = Date.UTC(2000, 0, 1);
const ANO_MAX = Date.UTC(2100, 0, 1);

export type DealAxi = {
  /** El dealId de Axi: la clave de la ejecución. Importar dos veces lo mismo no la duplica. */
  id: string;
  /** El orderId de la orden que la originó, si Axi lo informa. */
  orden: string | null;
  /** Como lo nombra Axi (XAUUSD.c, USTECH). Vacío en los movimientos de saldo. */
  simbolo: string;
  /** «operacion» (compra o venta) o «movimiento» (saldo: depósito, retiro, cargo). */
  tipo: "operacion" | "movimiento";
  /** La acción tal como la informó Axi: buy, sell, balance, credit, charge… */
  accion: string;
  /** in, out, inout, out_by. Vacío en los movimientos. */
  entrada: string;
  lotes: number;
  precio: number;
  /** El resultado que informó Axi (profit), en USC. */
  resultado: number;
  swap: number;
  comision: number;
  /** resultado + swap + comisión, en USC. */
  neto: number;
  /** Milisegundos desde 1970, UTC. */
  tiempo: number;
  comentario: string;
};

export type RechazoAxi = { posicion: number; motivo: string };

type Crudo = Record<string, unknown>;

const fallo = (motivo: string) => ({ ok: false as const, motivo });

const texto = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v.trim() : null);

/** Un número de verdad. Lo que no lo es (falta, texto, NaN) queda en null: desconocido, no cero. */
const numero = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

/** El id de Axi puede venir como número o como texto; se guarda como texto. */
const idDe = (v: unknown): string | null => {
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return String(v);
  const t = texto(v, 40);
  return t && t.length > 0 ? t : null;
};

/** Milisegundos UTC. Si el texto no trae zona horaria, se toma como UTC (así lo informa Axi). */
function aMilisegundos(v: unknown): number | null {
  let t: number | null = null;
  if (typeof v === "number" && Number.isFinite(v)) t = v;
  else if (typeof v === "string" && v.trim() !== "") {
    let s = v.trim().replace(/(\.\d{3})\d+/, "$1").replace(" ", "T");
    if (!/([zZ]|[+-]\d{2}:?\d{2})$/.test(s)) s += "Z";
    t = Date.parse(s);
  }
  return t !== null && Number.isFinite(t) && t >= ANO_MIN && t <= ANO_MAX ? Math.trunc(t) : null;
}

/**
 * Valida una ejecución del conector. Si falta un dato que hace falta, se rechaza con su motivo: nunca se completa con cero.
 * Los movimientos de saldo (depósitos, retiros, cargos) no tienen símbolo ni precio, así que no se les exige.
 */
export function normalizarDeal(raw: unknown): { ok: true; deal: DealAxi } | { ok: false; motivo: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallo("no es una ejecución");
  const o = raw as Crudo;
  const id = idDe(o.dealId);
  if (!id) return fallo("falta el id de la ejecución");
  const accion = texto(o.action, 24);
  if (!accion) return fallo("falta la acción");
  const tipo: DealAxi["tipo"] = ACCIONES_OPERACION.includes(accion) ? "operacion" : "movimiento";
  const tiempo = aMilisegundos(o.time);
  if (tiempo === null) return fallo("hora inválida");
  const resultado = numero(o.profit);
  if (resultado === null) return fallo("falta el resultado (profit)");
  const swap = numero(o.swap);
  if (swap === null) return fallo("falta el swap");
  const comision = numero(o.commission);
  if (comision === null) return fallo("falta la comisión");
  const orden = idDe(o.orderId);
  const comentario = texto(o.comment, 200) ?? "";
  const neto = resultado + swap + comision;

  if (tipo === "movimiento") {
    const entrada = texto(o.entry, 8) ?? "";
    return { ok: true, deal: { id, orden, simbolo: "", tipo, accion, entrada: ENTRADAS.includes(entrada) ? entrada : "", lotes: 0, precio: 0, resultado, swap, comision, neto, tiempo, comentario } };
  }

  const simbolo = texto(o.symbol, 20);
  if (!simbolo || !SIMBOLO.test(simbolo)) return fallo("símbolo inválido");
  const entrada = texto(o.entry, 8);
  if (!entrada || !ENTRADAS.includes(entrada)) return fallo("entrada inválida");
  const lotes = numero(o.volumeLots);
  if (lotes === null || lotes <= 0) return fallo("volumen inválido");
  const precio = numero(o.price);
  if (precio === null || precio <= 0) return fallo("precio inválido");
  return { ok: true, deal: { id, orden, simbolo, tipo, accion, entrada, lotes, precio, resultado, swap, comision, neto, tiempo, comentario } };
}

/** Valida una lista. No deduplica: eso lo hace el almacenamiento por id de ejecución. */
export function normalizarDeals(raw: unknown[]): { deals: DealAxi[]; rechazados: RechazoAxi[] } {
  const deals: DealAxi[] = [];
  const rechazados: RechazoAxi[] = [];
  raw.forEach((r, i) => {
    const v = normalizarDeal(r);
    if (v.ok) deals.push(v.deal);
    else rechazados.push({ posicion: i + 1, motivo: v.motivo });
  });
  return { deals, rechazados };
}

export type ResumenAxi = {
  moneda: typeof MONEDA_AXI;
  /** Compras y ventas (cada ejecución, de apertura o de cierre). */
  operaciones: number;
  /** Las que cierran o reducen una posición: ahí se realiza un resultado. Es la muestra. */
  cierres: number;
  /** Suma del neto de las operaciones, en USC. */
  netoOperaciones: number;
  /** Movimientos de saldo: depósitos, retiros, cargos. */
  movimientos: number;
  /** Suma del neto de los movimientos, en USC (un depósito suma, un retiro resta). */
  netoMovimientos: number;
  /** Según los cierres: sin cierres no hay muestra; menos de 15, muestra mínima. */
  muestra: Muestra;
  primero: number | null;
  ultimo: number | null;
  /** Por mes UTC (AAAA-MM), el más reciente primero. */
  meses: { mes: string; operaciones: number; cierres: number; neto: number }[];
  /** Por símbolo, el de más operaciones primero. */
  simbolos: { simbolo: string; operaciones: number; cierres: number; neto: number }[];
};

/**
 * El resumen de las ejecuciones. No calcula acierto ni profit factor: esos salen solo del registro unificado, y no hay R para
 * estas operaciones todavía. Lo que sí dice: cuántas, cuánto neto en USC y en qué meses.
 */
export function resumirDeals(deals: DealAxi[]): ResumenAxi {
  let operaciones = 0;
  let cierres = 0;
  let netoOperaciones = 0;
  let movimientos = 0;
  let netoMovimientos = 0;
  let primero: number | null = null;
  let ultimo: number | null = null;
  const meses = new Map<string, { mes: string; operaciones: number; cierres: number; neto: number }>();
  const simbolos = new Map<string, { simbolo: string; operaciones: number; cierres: number; neto: number }>();

  for (const d of deals) {
    primero = primero === null ? d.tiempo : Math.min(primero, d.tiempo);
    ultimo = ultimo === null ? d.tiempo : Math.max(ultimo, d.tiempo);
    if (d.tipo === "movimiento") {
      movimientos += 1;
      netoMovimientos += d.neto;
      continue;
    }
    const cierra = ENTRADAS_CIERRE.includes(d.entrada);
    operaciones += 1;
    netoOperaciones += d.neto;
    if (cierra) cierres += 1;

    const mes = new Date(d.tiempo).toISOString().slice(0, 7);
    const m = meses.get(mes) ?? { mes, operaciones: 0, cierres: 0, neto: 0 };
    m.operaciones += 1;
    m.cierres += cierra ? 1 : 0;
    m.neto += d.neto;
    meses.set(mes, m);

    const s = simbolos.get(d.simbolo) ?? { simbolo: d.simbolo, operaciones: 0, cierres: 0, neto: 0 };
    s.operaciones += 1;
    s.cierres += cierra ? 1 : 0;
    s.neto += d.neto;
    simbolos.set(d.simbolo, s);
  }

  return {
    moneda: MONEDA_AXI,
    operaciones,
    cierres,
    netoOperaciones,
    movimientos,
    netoMovimientos,
    muestra: cierres === 0 ? "SIN DATOS" : cierres < MUESTRA_MINIMA ? "MINIMA" : "RAZONABLE",
    primero,
    ultimo,
    meses: [...meses.values()].sort((a, b) => (a.mes < b.mes ? 1 : -1)),
    simbolos: [...simbolos.values()].sort((a, b) => b.operaciones - a.operaciones || a.simbolo.localeCompare(b.simbolo)),
  };
}
