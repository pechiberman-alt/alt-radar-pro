/**
 * Numbers for the AIs, already written the Argentine way ("82.920", "11,066",
 * "0,7042", "-2,99"). Asked to convert 11.0664 itself, the free model wrote
 * "11.066,4" in a reading — eleven thousand for a coin of eleven. Given the
 * string, it only has to copy it. Times stay numbers.
 */

/** 82920.4 → "82.920"; 2462.5 → "2.462,5"; 11.0664 → "11,066"; 0.70421 → "0,70421"; -2.99 → "-2,99". */
export function arNumber(v: number): string {
  const n = v === 0 ? 0 : v;
  return n.toLocaleString("es-AR", Math.abs(n) >= 10_000 ? { maximumFractionDigits: 0 } : { maximumSignificantDigits: 5 });
}

const TIME_KEY = /^(at|t|ts|time|timestamp)$|(At|Time|_at|_time)$/;

/** The same data with every number as arNumber, except times (by key, or epoch milliseconds). */
export function forAi(value: unknown, key = ""): unknown {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return TIME_KEY.test(key) || Math.abs(value) >= 1e11 ? value : arNumber(value);
  }
  if (Array.isArray(value)) return value.map((x) => forAi(x, key));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, forAi(v, k)]));
  return value;
}

/**
 * A price an AI wrote back: a JSON number, or text in either notation
 * ("11,066", "2.462,5", "82.920", or "11.07" from a model that slipped into
 * English). When the text reads two ways, the one nearest `near` wins: a
 * target or a stop is never orders of magnitude away from the price.
 */
export function parseLevel(v: unknown, near: number): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v !== "string") return null;
  const raw = v.match(/\d[\d.,]*/)?.[0].replace(/[.,]+$/, "");
  if (!raw) return null;
  const es = Number(raw.replace(/\./g, "").replace(",", "."));
  const en = Number(raw.replace(/,/g, ""));
  const ok = [es, en].filter((x) => Number.isFinite(x) && x > 0);
  if (!ok.length) return null;
  if (!(near > 0)) return ok[0];
  const off = (x: number) => Math.abs(Math.log(x / near));
  return ok.reduce((best, x) => (off(x) < off(best) ? x : best));
}
