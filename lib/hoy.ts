/**
 * La pantalla HOY: lo que importa hoy en una sola vista, pensada primero para el celular. Junta lo que el servidor ya guardó
 * (nada se calcula de nuevo ni se pide a ningún mercado): los planes de la pizarra de BYMA y de cripto, los papeles en zona
 * de compra de Fibonacci, los avisos de las últimas 24 horas, las señales abiertas del núcleo de JARVIS y el semáforo de
 * evidencia de cada fuente del registro. Lo viejo se marca como viejo; lo que no está, se dice. No es asesoramiento
 * financiero. Pura.
 */
import type { NivelEvidencia, Registro } from "./registro.ts";

export type EstadoArLite = { ticker: string; at: number; vela: number | null; fib: string | null; veredicto: string | null; huella: string | null; error: string | null };
export type AvisoLite = { clave: string; ticker: string; texto: string; at?: number };
export type SenalNucleoLite = { symbol: string; source: string; side: "LONG" | "SHORT"; entry: number; stop: number; target: number; time: number; taken: boolean };
export type PizarraCriptoLite = { symbol: string; at: number; veredicto: string; razon: string; lado: string | null; huella: string; registrada: boolean };

export type DatosHoy = {
  registro: Registro | null;
  estadosAr: EstadoArLite[] | null;
  avisos: AvisoLite[] | null;
  nucleo: SenalNucleoLite[] | null;
  pizarraCripto: PizarraCriptoLite[] | null;
};

export type TarjetaEvidencia = { id: string; nombre: string; nivel: NivelEvidencia; texto: string; cerradas: number; abiertas: number };

export type Hoy = {
  generado: number;
  /** Una frase con lo principal del día. */
  titular: string;
  planesAr: { ticker: string; huella: string | null; viejo: boolean }[];
  enZonaAr: string[];
  planesCripto: PizarraCriptoLite[];
  avisos: { clave: string; ticker: string; texto: string }[];
  nucleo: SenalNucleoLite[];
  evidencia: TarjetaEvidencia[];
  /** Lo que no se pudo leer, en palabras. */
  faltan: string[];
};

/** Cuánto vale una lectura de BYMA: el servidor lee una vez por rueda; más de 4 días sin leer es viejo (feriado largo o falla). */
export const VIDA_AR_MS = 4 * 86_400_000;
export const VIDA_CRIPTO_MS = 12 * 3_600_000;

const ORDEN_NIVEL: Record<NivelEvidencia, number> = { POSITIVA: 0, NEGATIVA: 1, "SIN VENTAJA CLARA": 2, "SIN SERIE": 3, "MUESTRA MÍNIMA": 4, "SIN DATOS": 5 };

/** El texto de un aviso de Telegram sin el HTML (negritas) y con las entidades vueltas a caracteres. */
export function textoPlano(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function armarHoy(d: DatosHoy, ahora: number): Hoy {
  const faltan: string[] = [];
  if (!d.registro) faltan.push("el registro unificado");
  if (!d.estadosAr) faltan.push("la lectura de BYMA");
  if (!d.avisos) faltan.push("los avisos");
  if (!d.nucleo) faltan.push("el núcleo de JARVIS");
  if (!d.pizarraCripto) faltan.push("la pizarra de cripto");

  const estados = d.estadosAr ?? [];
  const planesAr = estados
    .filter((e) => e.veredicto === "HAY PLAN")
    .map((e) => ({ ticker: e.ticker, huella: e.huella, viejo: ahora - e.at > VIDA_AR_MS }))
    .sort((a, b) => Number(a.viejo) - Number(b.viejo) || a.ticker.localeCompare(b.ticker));
  const enZonaAr = estados.filter((e) => e.fib === "EN LA ZONA" && ahora - e.at <= VIDA_AR_MS).map((e) => e.ticker).sort();
  const planesCripto = (d.pizarraCripto ?? []).filter((p) => p.veredicto === "HAY PLAN" && ahora - p.at <= VIDA_CRIPTO_MS);
  const avisos = (d.avisos ?? []).map((a) => ({ clave: a.clave, ticker: a.ticker, texto: textoPlano(a.texto) }));
  const nucleo = (d.nucleo ?? []).filter((s) => s.taken).sort((a, b) => b.time - a.time).slice(0, 8);
  const evidencia: TarjetaEvidencia[] = (d.registro?.fuentes ?? [])
    .filter((f) => f.disponible && f.ambito === "GLOBAL" && (f.cerradas > 0 || f.abiertas > 0))
    .map((f) => ({ id: f.id, nombre: f.nombre, nivel: f.evidencia.nivel, texto: f.evidencia.texto, cerradas: f.cerradas, abiertas: f.abiertas }))
    .sort((a, b) => ORDEN_NIVEL[a.nivel] - ORDEN_NIVEL[b.nivel] || b.cerradas - a.cerradas);

  const partes: string[] = [];
  const planes = planesAr.filter((p) => !p.viejo).length + planesCripto.length;
  partes.push(planes ? `${planes} ${planes === 1 ? "plan" : "planes"} de la pizarra` : "ningún plan de la pizarra");
  if (enZonaAr.length) partes.push(`${enZonaAr.length} ${enZonaAr.length === 1 ? "papel" : "papeles"} en zona de compra de Fibonacci`);
  if (nucleo.length) partes.push(`${nucleo.length} ${nucleo.length === 1 ? "señal abierta" : "señales abiertas"} del núcleo`);
  const positivas = evidencia.filter((e) => e.nivel === "POSITIVA").length;
  partes.push(positivas ? `${positivas} ${positivas === 1 ? "fuente con evidencia positiva" : "fuentes con evidencia positiva"}` : "ninguna fuente con evidencia positiva todavía");
  const titular = `Hoy: ${partes.join(", ")}.`;

  return { generado: ahora, titular, planesAr, enZonaAr, planesCripto, avisos, nucleo, evidencia, faltan };
}
