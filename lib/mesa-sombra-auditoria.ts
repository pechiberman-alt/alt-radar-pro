/**
 * La auditoría del laboratorio en sombra: cada evento (una evolución, una
 * candidata, una aprobación…) lleva el hash SHA-256 del anterior. Si alguien
 * edita, borra o reordena un evento guardado, la cadena se rompe y se nota.
 * El hash lo calcula el servidor al guardar; el navegador lo vuelve a revisar.
 */

export const GENESIS = "0".repeat(64);

export type EventoAuditado = {
  seq: number;
  at: number;
  tipo: string;
  datos: Record<string, unknown>;
  prev: string;
  hash: string;
};

/** JSON con las claves ordenadas: el mismo objeto da siempre el mismo texto. */
export function canonico(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`)
    .join(",")}}`;
}

export async function hashEvento(prev: string, seq: number, at: number, tipo: string, datos: unknown): Promise<string> {
  const texto = `${prev}|${seq}|${at}|${tipo}|${canonico(datos)}`;
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type Verificacion = { ok: boolean; revisados: number; rotaEn: number | null; motivo: string };

/**
 * Revisa una tirada de eventos seguidos (en cualquier orden): que cada hash
 * corresponda a su contenido, que cada uno apunte al anterior y que no falte
 * ningún número. El primero de la tirada solo se puede atar al génesis si es el 1.
 */
export async function verificarCadena(eventos: EventoAuditado[]): Promise<Verificacion> {
  const ev = [...eventos].sort((a, b) => a.seq - b.seq);
  for (let i = 0; i < ev.length; i += 1) {
    const e = ev[i];
    if (i === 0 && e.seq === 1 && e.prev !== GENESIS) return { ok: false, revisados: i, rotaEn: e.seq, motivo: "El primer evento no sale del génesis." };
    if (i > 0) {
      if (e.seq !== ev[i - 1].seq + 1) return { ok: false, revisados: i, rotaEn: e.seq, motivo: `Falta el evento ${ev[i - 1].seq + 1}.` };
      if (e.prev !== ev[i - 1].hash) return { ok: false, revisados: i, rotaEn: e.seq, motivo: `El evento ${e.seq} no apunta al anterior.` };
    }
    if ((await hashEvento(e.prev, e.seq, e.at, e.tipo, e.datos)) !== e.hash) return { ok: false, revisados: i, rotaEn: e.seq, motivo: `El evento ${e.seq} fue modificado después de guardarse.` };
  }
  return { ok: true, revisados: ev.length, rotaEn: null, motivo: ev.length ? "Cadena íntegra." : "Sin eventos todavía." };
}
