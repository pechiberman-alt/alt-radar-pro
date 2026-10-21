/**
 * Revisa una serie de velas que manda un navegador para el resto (/api/klines, POST) antes de guardarla: forma de vela de
 * Binance, precios coherentes (el máximo arriba de todo, el mínimo abajo), velas seguidas sin huecos ni saltos de horario,
 * alineadas a su temporalidad y la última reciente. Una serie inventada a mano casi nunca pasa todo esto; la que pasa, igual
 * tiene que coincidir con el precio de Kraken o Coinbase (lib/corroborar.ts). Pura.
 */

export const MS_INTERVALO: Record<string, number> = {
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "8h": 28_800_000,
  "1d": 86_400_000,
};

export type RevisionSerie = { ok: true; ultimoCierre: number } | { ok: false; motivo: string };

const num = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : NaN;
};

export function revisarSerie(rows: unknown, intervalo: string, ahora: number): RevisionSerie {
  const paso = MS_INTERVALO[intervalo];
  if (!paso) return { ok: false, motivo: "intervalo" };
  if (!Array.isArray(rows) || rows.length < 5 || rows.length > 500) return { ok: false, motivo: "largo" };
  let anterior = -1;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) return { ok: false, motivo: "forma" };
    const [t, o, h, l, c, v] = [num(row[0]), num(row[1]), num(row[2]), num(row[3]), num(row[4]), num(row[5])];
    if (![t, o, h, l, c, v].every(Number.isFinite) || o <= 0 || h <= 0 || l <= 0 || c <= 0 || v < 0) return { ok: false, motivo: "números" };
    if (h < Math.max(o, c, l) || l > Math.min(o, c)) return { ok: false, motivo: "precios incoherentes" };
    if (t % paso !== 0) return { ok: false, motivo: "horario" };
    if (anterior >= 0 && t - anterior !== paso) return { ok: false, motivo: "velas no seguidas" };
    anterior = t;
  }
  if (anterior < ahora - 2 * paso || anterior > ahora + 60_000) return { ok: false, motivo: "vieja o futura" };
  return { ok: true, ultimoCierre: num((rows[rows.length - 1] as unknown[])[4]) };
}
