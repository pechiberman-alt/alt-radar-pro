/**
 * Datos y escalas de tiempo de la investigación de la mesa.
 *
 * El motor de la mesa está escrito para velas de 1 h, 4 h y 1 d (relación 1:4:24). Para medirlo con otras velas
 * base se le dan velas de 15 min, 2 h, 4 h, 6 h o 12 h con el tiempo reescalado ("tiempo virtual") para que la vela
 * base valga «una hora» del motor; las velas medias y altas se arman agrupando 4 y 24 velas base, igual que la app
 * arma las de 4 h y 1 d con las de 1 h. El motor es el mismo, sin tocar; el horizonte (168 velas base), el
 * vencimiento de la orden límite (48) y la cadencia de decisión (cada 4 velas base) escalan solos.
 */
import { readFileSync } from "node:fs";
import { aggregate } from "../../lib/asset-read.ts";
import type { SwingCandle } from "../../lib/swing-entries.ts";

/** Carpeta con SIMBOLO-INTERVALO.json ([openTime, open, high, low, close, volume] por vela). Ver datos.py. */
export const DATOS = process.env.ALT_RADAR_DATOS ?? "datos-investigacion";
/** Carpeta donde se guardan las lecturas precalculadas y los resultados (no se commitea). */
export const SALIDA = process.env.ALT_RADAR_SALIDA ?? "salida-investigacion";

export const MONEDAS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "TRXUSDT", "DOGEUSDT", "ZECUSDT", "ADAUSDT", "BCHUSDT"];
export const H = 3_600_000;
export const dia = (s: string) => Date.parse(`${s}T00:00:00Z`);

export type PerfilId = "15m" | "1h" | "2h" | "4h" | "6h" | "12h";
export type Perfil = { id: PerfilId; archivo: "15m" | "1h" | "4h"; agrupar: number; escala: number; marcos: string };
export const PERFILES: Record<PerfilId, Perfil> = {
  "15m": { id: "15m", archivo: "15m", agrupar: 1, escala: 4, marcos: "15 min / 1 h / 6 h" },
  "1h": { id: "1h", archivo: "1h", agrupar: 1, escala: 1, marcos: "1 h / 4 h / 1 d" },
  "2h": { id: "2h", archivo: "1h", agrupar: 2, escala: 1 / 2, marcos: "2 h / 8 h / 2 d" },
  "4h": { id: "4h", archivo: "4h", agrupar: 1, escala: 1 / 4, marcos: "4 h / 16 h / 4 d" },
  "6h": { id: "6h", archivo: "1h", agrupar: 6, escala: 1 / 6, marcos: "6 h / 1 d / 6 d" },
  "12h": { id: "12h", archivo: "1h", agrupar: 12, escala: 1 / 12, marcos: "12 h / 2 d / 12 d" },
};

/** Origen del tiempo virtual: alineado a 4 h y 1 d para que las agrupaciones caigan igual que en la app. */
export const TZ = dia("2024-01-01");
export const aVirtual = (p: Perfil, t: number) => (p.escala === 1 ? t : TZ + (t - TZ) * p.escala);
export const aReal = (p: Perfil, v: number) => (p.escala === 1 ? v : TZ + (v - TZ) / p.escala);

const cache = new Map<string, SwingCandle[]>();

/** Velas reales de un archivo, tal cual. */
export function velasReales(sym: string, intervalo: string): SwingCandle[] {
  const key = `${sym}-${intervalo}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const rows = JSON.parse(readFileSync(`${DATOS}/${key}.json`, "utf8")) as number[][];
  const c = rows.map(([t, o, h, l, cl, v]) => ({ openTime: t, open: o, high: h, low: l, close: cl, volume: v, quoteVolume: v * cl }));
  cache.set(key, c);
  return c;
}

/** Las velas base del perfil, en tiempo virtual (1 vela = 1 hora del motor). */
export function velasBase(sym: string, p: Perfil): SwingCandle[] {
  const key = `base-${sym}-${p.id}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let real = velasReales(sym, p.archivo);
  if (p.agrupar > 1) real = aggregate(real, p.agrupar);
  const c = p.escala === 1 ? real : real.map((x) => ({ ...x, openTime: aVirtual(p, x.openTime) }));
  cache.set(key, c);
  return c;
}
/**
 * Velas «de 4 h» y «de 1 d» del motor. Con las de 1 h son las reales de 4 h y 1 d (como en la app); con las demás se
 * arman agrupando 4 y 24 velas base.
 */
export const velasMedias = (sym: string, p: Perfil) => (p.id === "1h" ? velasReales(sym, "4h") : aggregate(velasBase(sym, p), 4));
export const velasAltas = (sym: string, p: Perfil) => (p.id === "1h" ? velasReales(sym, "1d") : aggregate(velasBase(sym, p), 24));

export function perfilDe(id: string | undefined): Perfil {
  const p = PERFILES[(id ?? "1h") as PerfilId];
  if (!p) throw new Error(`Perfil desconocido: ${id}. Usá ${Object.keys(PERFILES).join(", ")}.`);
  return p;
}
