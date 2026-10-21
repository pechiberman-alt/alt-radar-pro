/**
 * La oficina del servidor para JARVIS en la app: una lectura de /api/oficina cada 5 minutos como mucho, ya resumida para la IA
 * (lib/oficina.ts, oficinaParaIa), con el último diario de aprendizaje y lo que leyó el mapa de liquidaciones en este navegador
 * (lib/mapa-memoria.ts, siempre fresco). Si no se puede leer, null: JARVIS dice que no tiene el dato en vez de suponer ceros.
 */
import { diarioParaIa, leerDiario } from "./aprendizaje-diario.ts";
import { lecturaParaIa, lecturasMapa } from "./mapa-memoria.ts";
import { armarOficina, oficinaParaIa, type FilaOficina } from "./oficina.ts";

const VIDA_MS = 5 * 60_000;
let guardada: { at: number; valor: { oficina: unknown; diario: unknown } | null } | null = null;

export async function oficinaParaJarvis(): Promise<unknown> {
  const mapa = lecturasMapa().slice(0, 3).map(lecturaParaIa);
  if (guardada && Date.now() - guardada.at < VIDA_MS) return guardada.valor ? { ...guardada.valor, mapa } : null;
  try {
    const r = await fetch("/api/oficina", { credentials: "same-origin", cache: "no-store" });
    if (!r.ok) return null;
    const d = (await r.json()) as { servidor?: { filas: FilaOficina[] } | null; diarios?: unknown[] };
    const valor = d.servidor
      ? { oficina: oficinaParaIa(armarOficina(d.servidor.filas, Date.now(), "SERVIDOR"), "SERVIDOR"), diario: diarioParaIa(leerDiario(d.diarios?.[0])) }
      : null;
    guardada = { at: Date.now(), valor };
    return valor ? { ...valor, mapa } : null;
  } catch {
    return null;
  }
}
