/**
 * El registro de las señales del ROBOT MM, por cuenta: cada señal con su SL,
 * TP1, TP2 y TP3 fijados al detectarla, la hora en que tocó cada nivel, cómo
 * terminó y su resultado en R. Se mide con las mismas reglas que validaron al
 * robot (lib/escalera.ts, que replica runMm). Es puro: D1 está en robot-ledger-db.
 *
 * QUIÉN LA RESUELVE. El navegador, con las mismas velas de Binance con que el
 * robot la encontró: el Worker no puede leer Binance. El servidor no le cree:
 * revisa que el recorrido sea coherente con la escalera guardada, no deja
 * reescribir lo que ya quedó registrado y calcula él mismo el resultado en R.
 */
import { resultadoR, type Desenlace, type Escalera, type Lado, type Recorrido } from "./escalera.ts";
import { MM_FEE_PCT, MM_HORIZON } from "./mm-robot.ts";

/** Duración de cada marco del robot (los de ROBOT_FRAMES). */
export const MARCO_MS: Record<string, number> = {
  "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000,
};
export const FUENTE_NAVEGADOR = "Binance USDT-M, velas leídas en tu navegador";
export const MAX_RECORRIDOS = 20;
/** Con menos operaciones cerradas que esto no se saca ningún porcentaje. */
export const MUESTRA_MINIMA = 15;

export type Validacion = { trades: number; profitFactor: number | null; positive: number; tested: number };

export type RegistroRobot = {
  clave: string;
  symbol: string;
  timeframe: string;
  side: Lado;
  /** Apertura de la vela que disparó la señal. */
  vela: number;
  /** Cuándo la registró el servidor. */
  detectada: number;
  entrada: number;
  escalera: Escalera;
  variante: string;
  validacion: Validacion;
  /** Qué pasó con el aviso: «enviada a Telegram» o por qué no. */
  telegram: string | null;
  recorrido: Recorrido;
  /** De dónde salieron las velas que la resolvieron. */
  fuente: string | null;
};

const DESENLACES: Desenlace[] = ["ABIERTA", "SL", "TP3", "TIEMPO"];
type Resultado = { ok: true; recorrido: Recorrido } | { ok: false; error: string };
const mal = (error: string): Resultado => ({ ok: false, error });

/** Cierre de la primera vela posterior a la señal y de la última del horizonte (velas seguidas, como las da Binance). */
export function ventana(reg: Pick<RegistroRobot, "vela" | "timeframe">): { primera: number; ultima: number } | null {
  const marco = MARCO_MS[reg.timeframe];
  return marco ? { primera: reg.vela + 2 * marco, ultima: reg.vela + (MM_HORIZON + 1) * marco } : null;
}

/**
 * Lo que manda el navegador, revisado contra la escalera guardada. El resultado
 * en R no se toma del navegador: sale de la escalera y de la salida.
 */
export function validarRecorrido(reg: RegistroRobot, raw: unknown, ahora: number): Resultado {
  if (reg.recorrido.desenlace !== "ABIERTA") return mal("Ya está cerrada: lo registrado no se reescribe.");
  const w = ventana(reg);
  if (!w) return mal("Marco desconocido.");
  const x = (raw ?? {}) as Record<string, unknown>;
  const hora = (k: string): number | null | undefined => {
    const v = x[k];
    if (v === null || v === undefined) return null;
    return typeof v === "number" && Number.isInteger(v) && v >= w.primera && v <= ahora + 60_000 ? v : undefined;
  };
  const [slAt, tp1At, tp2At, tp3At, cerradaA] = ["slAt", "tp1At", "tp2At", "tp3At", "cerradaA"].map(hora);
  if ([slAt, tp1At, tp2At, tp3At, cerradaA].some((v) => v === undefined)) return mal("Una hora no es posible: antes de la señal o en el futuro.");
  const desenlace = x.desenlace as Desenlace;
  if (!DESENLACES.includes(desenlace)) return mal("Desenlace desconocido.");
  // Un objetivo más lejos no se alcanza antes que uno más cerca.
  if (tp2At != null && (tp1At == null || tp1At > tp2At)) return mal("TP2 sin TP1 antes.");
  if (tp3At != null && (tp2At == null || tp2At > tp3At)) return mal("TP3 sin TP2 antes.");
  // Lo que ya quedó registrado no cambia.
  if (reg.recorrido.tp1At !== null && tp1At !== reg.recorrido.tp1At) return mal("La hora del TP1 ya estaba registrada.");
  if (reg.recorrido.tp2At !== null && tp2At !== reg.recorrido.tp2At) return mal("La hora del TP2 ya estaba registrada.");

  const base = { slAt: slAt ?? null, tp1At: tp1At ?? null, tp2At: tp2At ?? null, tp3At: tp3At ?? null };
  const e = reg.escalera;
  const r = (salida: number) => resultadoR(reg.side, reg.entrada, e.stop, salida, MM_FEE_PCT);
  switch (desenlace) {
    case "ABIERTA":
      if (slAt != null || tp3At != null || cerradaA != null) return mal("Abierta no puede tener SL, TP3 ni cierre.");
      return { ok: true, recorrido: { ...base, desenlace, cerradaA: null, salida: null, r: null } };
    case "SL":
      if (slAt == null || tp3At != null || cerradaA !== slAt) return mal("Un SL necesita su hora, sin TP3, y cierra a esa hora.");
      // Un objetivo tocado en la misma vela que el SL no cuenta: tienen que ser de antes.
      if ((tp1At != null && tp1At >= slAt) || (tp2At != null && tp2At >= slAt)) return mal("Un objetivo de la misma vela que el SL no cuenta.");
      return { ok: true, recorrido: { ...base, desenlace, cerradaA: slAt, salida: e.stop, r: r(e.stop) } };
    case "TP3":
      if (tp3At == null || slAt != null || cerradaA !== tp3At) return mal("Un TP3 necesita su hora, sin SL, y cierra a esa hora.");
      return { ok: true, recorrido: { ...base, desenlace, cerradaA: tp3At, salida: e.tp3, r: r(e.tp3) } };
    case "TIEMPO": {
      const salida = x.salida;
      if (slAt != null || tp3At != null || cerradaA == null || cerradaA < w.ultima) return mal(`Por tiempo cierra recién después de ${MM_HORIZON} velas, sin SL ni TP3.`);
      if (typeof salida !== "number" || !Number.isFinite(salida) || salida <= reg.entrada / 3 || salida >= reg.entrada * 3) return mal("Precio de salida imposible.");
      return { ok: true, recorrido: { ...base, desenlace, cerradaA, salida, r: r(salida) } };
    }
  }
}

export const mismoRecorrido = (a: Recorrido, b: Recorrido) =>
  a.desenlace === b.desenlace && a.slAt === b.slAt && a.tp1At === b.tp1At && a.tp2At === b.tp2At && a.tp3At === b.tp3At && a.cerradaA === b.cerradaA && a.salida === b.salida;

export type ResumenRegistro = {
  total: number;
  abiertas: number;
  cerradas: number;
  /** Cuántas cerradas llegaron a cada objetivo antes del SL (o terminaron así). */
  tp1: number;
  tp2: number;
  tp3: number;
  sl: number;
  tiempo: number;
  /** Suma y media del resultado de las cerradas, en R neto. */
  rTotal: number | null;
  rMedio: number | null;
  /** Porcentajes sobre las cerradas; null con menos de MUESTRA_MINIMA. */
  tasas: { tp1: number; tp2: number; tp3: number; sl: number; tiempo: number } | null;
  muestra: "sin datos" | "muestra mínima" | "muestra razonable";
};

export function resumirRegistro(regs: RegistroRobot[]): ResumenRegistro {
  const cerradas = regs.filter((x) => x.recorrido.desenlace !== "ABIERTA");
  const n = cerradas.length;
  const cuenta = (f: (x: RegistroRobot) => boolean) => cerradas.filter(f).length;
  const tp1 = cuenta((x) => x.recorrido.tp1At !== null);
  const tp2 = cuenta((x) => x.recorrido.tp2At !== null);
  const tp3 = cuenta((x) => x.recorrido.desenlace === "TP3");
  const sl = cuenta((x) => x.recorrido.desenlace === "SL");
  const tiempo = cuenta((x) => x.recorrido.desenlace === "TIEMPO");
  const rs = cerradas.map((x) => x.recorrido.r).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const rTotal = rs.length ? rs.reduce((a, v) => a + v, 0) : null;
  const pct = (k: number) => Math.round((k / n) * 100);
  return {
    total: regs.length,
    abiertas: regs.length - n,
    cerradas: n,
    tp1, tp2, tp3, sl, tiempo,
    rTotal,
    rMedio: rTotal === null ? null : rTotal / rs.length,
    tasas: n >= MUESTRA_MINIMA ? { tp1: pct(tp1), tp2: pct(tp2), tp3: pct(tp3), sl: pct(sl), tiempo: pct(tiempo) } : null,
    muestra: n === 0 ? "sin datos" : n < MUESTRA_MINIMA ? "muestra mínima" : "muestra razonable",
  };
}

const num = (v: number | null) => (v === null || !Number.isFinite(v) ? "" : String(Number(v.toPrecision(10))).replace(".", ","));
const utc = (t: number | null) => (t === null ? "" : new Date(t).toISOString().slice(0, 16).replace("T", " "));
const campo = (s: string | null) => (s ?? "").replace(/[;\n\r]/g, " ");

/** Todo el registro en CSV (punto y coma, decimales con coma, horas UTC): para revisarlo afuera. */
export function registroCsv(regs: RegistroRobot[]): string {
  const head = "vela_utc;moneda;marco;lado;entrada;sl;tp1;tp2;tp3;tp1_utc;tp2_utc;tp3_utc;sl_utc;desenlace;cerrada_utc;salida;r_neto;variante;validacion_pf;validacion_operaciones;telegram;fuente";
  const rows = regs.map((x) => {
    const e = x.escalera;
    const r = x.recorrido;
    return [
      utc(x.vela), x.symbol.replace(/USDT$/, ""), x.timeframe, x.side, num(x.entrada), num(e.stop), num(e.tp1), num(e.tp2), num(e.tp3),
      utc(r.tp1At), utc(r.tp2At), utc(r.tp3At), utc(r.slAt), r.desenlace, utc(r.cerradaA), num(r.salida), num(r.r),
      campo(x.variante), num(x.validacion.profitFactor), String(x.validacion.trades), campo(x.telegram), campo(x.fuente),
    ].join(";");
  });
  return [head, ...rows].join("\n");
}
