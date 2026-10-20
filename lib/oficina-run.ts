/**
 * La oficina del servidor para JARVIS en la app: una lectura de /api/oficina cada 5 minutos como mucho, ya resumida para la IA
 * (lib/oficina.ts, oficinaParaIa). Si no se puede leer, null: JARVIS dice que no tiene el dato en vez de suponer ceros.
 */
import { armarOficina, oficinaParaIa, type FilaOficina } from "./oficina.ts";

const VIDA_MS = 5 * 60_000;
let guardada: { at: number; valor: unknown } | null = null;

export async function oficinaParaJarvis(): Promise<unknown> {
  if (guardada && Date.now() - guardada.at < VIDA_MS) return guardada.valor;
  try {
    const r = await fetch("/api/oficina", { credentials: "same-origin", cache: "no-store" });
    if (!r.ok) return null;
    const d = (await r.json()) as { servidor?: { filas: FilaOficina[] } | null };
    const valor = d.servidor ? oficinaParaIa(armarOficina(d.servidor.filas, Date.now(), "SERVIDOR"), "SERVIDOR") : null;
    guardada = { at: Date.now(), valor };
    return valor;
  } catch {
    return null;
  }
}
