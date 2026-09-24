/**
 * Telegram answers from the ALT RADAR analyst: the pure parts.
 *
 * In the app the phone builds the data snapshot; in Telegram nobody has the
 * app open, so the Worker builds a smaller one from what it can read by
 * itself: spot prices of the majors, open signals from the ledger, Fear &
 * Greed, recent high-impact news and the archived market structure.
 */

export type ServerSnapshot = {
  at: string;
  majors: { s: string; price: number; ch24h: number }[];
  openSignals: { s: string; side: string; score: number; entry: number; tf: string; since: string }[];
  fearGreed: { value: number; zone: string } | null;
  structure: Record<string, number | string | null> | null;
  news: { title: string; category: string; impact: string; tone: string; source: string }[];
  note: string;
};

export function buildServerSnapshot(parts: Omit<ServerSnapshot, "at" | "note">, now = Date.now()): ServerSnapshot {
  return {
    at: new Date(now).toISOString(),
    majors: parts.majors.slice(0, 8),
    openSignals: [...parts.openSignals].sort((a, b) => b.score - a.score).slice(0, 10),
    fearGreed: parts.fearGreed,
    structure: parts.structure,
    news: parts.news.slice(0, 5),
    note:
      "Resumen armado por el servidor para Telegram: no incluye el mapa de liquidaciones, zonas ni patrones del gráfico (esos se calculan en la app). Si preguntan por eso, decilo y sugerí abrir el MAPA.",
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The model writes light Markdown; Telegram's HTML mode shows it literally.
 * Escape first (so nothing the model writes can break the markup), then turn
 * **bold**, *italic*, `code` and headings into the few tags Telegram allows.
 */
export function markdownToTelegramHtml(md: string): string {
  return esc(md)
    .replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/gm, "$1<i>$2</i>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .trim();
}

/** Telegram caps a message at 4096 characters; split on paragraph breaks. */
export function splitForTelegram(text: string, max = 3900): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let current = "";
  for (const para of text.split(/\n{2,}/)) {
    if ((current + "\n\n" + para).length > max && current) {
      out.push(current);
      current = para;
    } else current = current ? `${current}\n\n${para}` : para;
    while (current.length > max) {
      out.push(current.slice(0, max));
      current = current.slice(max);
    }
  }
  if (current) out.push(current);
  return out;
}
