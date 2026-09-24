/**
 * Crypto Fear & Greed index (alternative.me), summarized.
 *
 * A composite of volatility, momentum, social volume, dominance and trends,
 * 0 = extreme fear, 100 = extreme greed. Extremes have often lined up with
 * turning points, and they have also lasted for weeks — it is a thermometer,
 * not a trigger, and the panel says so.
 */

export type FearGreedPoint = { value: number; time: number };
export type FearGreed = {
  value: number;
  label: string;
  zone: "MIEDO EXTREMO" | "MIEDO" | "NEUTRAL" | "AVARICIA" | "AVARICIA EXTREMA";
  yesterday: number | null;
  weekAgo: number | null;
  monthAgo: number | null;
  average30: number | null;
  series: FearGreedPoint[];
  reading: string;
};

export function zoneFor(value: number): FearGreed["zone"] {
  if (value <= 24) return "MIEDO EXTREMO";
  if (value <= 44) return "MIEDO";
  if (value <= 55) return "NEUTRAL";
  if (value <= 75) return "AVARICIA";
  return "AVARICIA EXTREMA";
}

export function parseFearGreed(payload: unknown): FearGreed | null {
  const data = (payload as { data?: unknown[] } | null)?.data;
  if (!Array.isArray(data)) return null;
  const points = data
    .map((d) => {
      const row = d as { value?: string; timestamp?: string };
      return { value: Number(row.value), time: Number(row.timestamp) * 1000 };
    })
    .filter((p) => Number.isFinite(p.value) && p.value >= 0 && p.value <= 100 && p.time > 0)
    .sort((a, b) => b.time - a.time); // newest first
  if (!points.length) return null;
  const at = (i: number) => (points[i] ? points[i].value : null);
  const last30 = points.slice(0, 30);
  const value = points[0].value;
  const zone = zoneFor(value);
  const avg = last30.length ? last30.reduce((s, p) => s + p.value, 0) / last30.length : null;
  const reading =
    zone === "MIEDO EXTREMO"
      ? "Miedo extremo: la gente está vendiendo por pánico. Históricamente coincidió con zonas de compra, pero el miedo puede durar semanas antes de girar."
      : zone === "AVARICIA EXTREMA"
        ? "Avaricia extrema: euforia y apalancamiento alto. Históricamente coincidió con techos locales y correcciones, aunque la euforia también puede extenderse."
        : zone === "MIEDO"
          ? "Miedo: el mercado está cauteloso. Suele ser mejor momento para acumular que para perseguir subas."
          : zone === "AVARICIA"
            ? "Avaricia: optimismo en marcha. Momento de gestionar riesgo y tomar ganancias parciales, no de sobreapalancarse."
            : "Neutral: sin exceso emocional en ningún sentido.";
  return {
    value,
    label: zone,
    zone,
    yesterday: at(1),
    weekAgo: at(7),
    monthAgo: at(30) ?? at(last30.length - 1),
    average30: avg,
    series: [...last30].reverse(),
    reading,
  };
}
