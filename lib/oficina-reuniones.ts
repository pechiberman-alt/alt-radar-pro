/**
 * Las reuniones de la oficina: cuándo hace falta juntarse, con quién y qué se dice. Hay reunión cuando dos agentes tienen
 * apuestas opuestas en el mismo activo, cuando dos de la misma mesa van muy distinto, cuando las MENTES no coinciden sobre
 * un papel de BYMA, o cuando uno tiene una lección para contar. Los que participan caminan de su escritorio a la sala,
 * dicen sus líneas (todas salen de datos medidos: lib/agentes-mente.ts y lib/mercado-ar-ranking.ts) y vuelven.
 *
 * La línea de tiempo alterna charla en los escritorios y reuniones; avanza con el reloj de la oficina. Nada de esto cambia
 * reglas ni opera. Pura.
 */
import type { Dialogo } from "./agentes-mente.ts";
import type { Intervencion } from "./mercado-ar-ranking.ts";

export type MotivoReunion = "APUESTAS OPUESTAS" | "RESULTADOS DISTINTOS" | "LAS MENTES NO COINCIDEN" | "UNA LECCIÓN";

export type Reunion = {
  tema: string;
  motivo: MotivoReunion;
  /** Quiénes van a la sala (ids de agente o de mente), a lo sumo SILLAS. */
  participantes: string[];
  lineas: { quien: string; nombre: string; texto: string }[];
};

/** Sillas alrededor de la mesa de la sala. */
export const SILLAS = 6;

const PRIORIDAD: Record<MotivoReunion, number> = { "APUESTAS OPUESTAS": 0, "LAS MENTES NO COINCIDEN": 1, "RESULTADOS DISTINTOS": 2, "UNA LECCIÓN": 3 };

function motivoDe(d: Dialogo): MotivoReunion {
  if (d.tema.startsWith("Debate en")) return "APUESTAS OPUESTAS";
  if (d.tema.startsWith("Mesa de")) return "RESULTADOS DISTINTOS";
  return "UNA LECCIÓN";
}

/**
 * La agenda: primero lo más urgente (apuestas opuestas), después las mentes que no coinciden, las mesas con resultados
 * distintos y las lecciones. Las mentes se reúnen solo si hay al menos una a favor y una en contra del papel.
 */
export function agendaReuniones(dialogos: Dialogo[], mentes: { ticker: string; guion: Intervencion[] } | null, maximo = 6): Reunion[] {
  const out: Reunion[] = dialogos.map((d) => ({
    tema: d.tema,
    motivo: motivoDe(d),
    participantes: [...new Set(d.lineas.map((l) => l.quien))].slice(0, SILLAS),
    lineas: d.lineas,
  }));
  if (mentes) {
    const favor = mentes.guion.filter((g) => g.postura === "A FAVOR");
    const contra = mentes.guion.filter((g) => g.postura === "EN CONTRA");
    if (favor.length && contra.length) {
      // Se sientan las que discuten: hasta 3 a favor y 3 en contra, alternadas; abre y cierra JARVIS desde el holograma.
      const habla: Intervencion[] = [];
      for (let k = 0; k < 3; k += 1) {
        if (favor[k]) habla.push(favor[k]);
        if (contra[k]) habla.push(contra[k]);
      }
      const jarvis = mentes.guion.filter((g) => g.quien === "JARVIS");
      out.push({
        tema: `Las mentes sobre ${mentes.ticker}`,
        motivo: "LAS MENTES NO COINCIDEN",
        participantes: habla.map((g) => g.quien).slice(0, SILLAS),
        lineas: [...(jarvis[0] ? [jarvis[0]] : []), ...habla, ...(jarvis[1] ? [jarvis[1]] : [])].map((g) => ({ quien: g.quien, nombre: g.nombre.split(" (")[0], texto: g.texto })),
      });
    }
  }
  return out.sort((a, b) => PRIORIDAD[a.motivo] - PRIORIDAD[b.motivo]).slice(0, maximo);
}

export type Momento =
  | { tipo: "CHARLA" }
  | { tipo: "LLEGAN"; reunion: Reunion }
  | { tipo: "HABLA"; reunion: Reunion; linea: Reunion["lineas"][number] }
  | { tipo: "VUELVEN"; reunion: Reunion };

/** Cuántos pasos de charla en los escritorios entre una reunión y la siguiente. */
export const CHARLA_ENTRE = 4;

/** La línea de tiempo: charla, llegan a la sala, habla cada uno, vuelven; y así con cada reunión de la agenda. */
export function lineaDeTiempo(agenda: Reunion[]): Momento[] {
  const out: Momento[] = [];
  for (const r of agenda) {
    for (let k = 0; k < CHARLA_ENTRE; k += 1) out.push({ tipo: "CHARLA" });
    out.push({ tipo: "LLEGAN", reunion: r });
    for (const linea of r.lineas) out.push({ tipo: "HABLA", reunion: r, linea });
    out.push({ tipo: "VUELVEN", reunion: r });
  }
  return out.length ? out : [{ tipo: "CHARLA" }];
}

/** Quiénes están en la sala en este momento (los que llegan y hablan; al volver ya caminan a su escritorio). */
export const enLaSala = (m: Momento): Set<string> => (m.tipo === "LLEGAN" || m.tipo === "HABLA" ? new Set(m.reunion.participantes) : new Set());

/** Las sillas alrededor de la mesa redonda, en unidades del piso y relativas a la esquina de la sala. */
export function silla(k: number, n: number, sala: { ancho: number; alto: number }): { x: number; y: number } {
  const a = (k / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2;
  return { x: sala.ancho / 2 + Math.cos(a) * 1.35, y: sala.alto / 2 + Math.sin(a) * 0.95 };
}
