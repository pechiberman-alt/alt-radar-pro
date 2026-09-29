export const usd = (v: number) => `${v < 0 ? "-" : v > 0 ? "+" : ""}$${Math.abs(v).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const money = (v: number) => `$${v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const px = (v: number) => v.toLocaleString("es-AR", { maximumFractionDigits: v >= 100 ? 2 : v >= 1 ? 4 : 8 });
export const qty = (v: number) => v.toLocaleString("es-AR", { maximumFractionDigits: 8 });
export const num = (v: number, d = 2) => v.toLocaleString("es-AR", { maximumFractionDigits: d });
export const pf = (v: number | null) => (v === null ? "—" : v === Infinity ? "∞" : num(v, 2));
export const pct = (v: number, d = 1) => `${num(v, d)}%`;
export const share = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");

export function dur(ms: number | null): string {
  if (ms === null) return "—";
  const min = Math.round(ms / 60_000);
  if (min < 1) return "<1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${min % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

export const stamp = (t: number) =>
  new Date(t).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
export const csvStamp = (t: number) => stamp(t).replace(",", "");
const two = (n: number) => String(n).padStart(2, "0");
export const dayOf = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
};
export const monthOf = (t: number) => dayOf(t).slice(0, 7);
export const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("es-AR", { month: "long", year: "numeric" });
};
export const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
export const fileDate = () => dayOf(Date.now());
