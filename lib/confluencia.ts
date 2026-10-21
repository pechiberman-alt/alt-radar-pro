/**
 * La operativa con el mapa y el flujo (PLAN_CONFLUENCIA_1): cada agente sigue disparando con su regla fija, y además decide si
 * esa entrada la toma «con el mapa»: no entra cuando el mapa de liquidaciones o el flujo de órdenes la tienen en contra. Las dos
 * versiones se miden en papel, sobre las mismas entradas: la regla sola (todas) y la regla con el mapa (las que no tenían nada
 * en contra). Así se sabe si mirar el mapa los hace mejores, con su muestra, en vez de suponerlo.
 *
 * El veredicto se fija antes de medir y sale de las dos fotos que se guardan al entrar, con las velas cerradas hasta la de la
 * señal (lib/mapa-contexto.ts y lib/flujo-lectura.ts):
 * - EN CONTRA: una zona de confluencia en el camino a menos de 1 R, el stop junto a liquidez sin barrer, o una lectura de flujo
 *   del lado contrario en las últimas 3 velas.
 * - A FAVOR: nada en contra y una zona de confluencia detrás del stop o una lectura de flujo a favor (que no sea la propia regla).
 * - NEUTRA: nada en contra ni a favor.
 * Sin las dos fotos no hay veredicto (desconocido no es cero): esas entradas cuentan para la regla sola y no para la versión con
 * el mapa. Cambiar estos números es otro PLAN, medido al lado. Pura.
 */
import { fotoFlujoDeJson, type FotoFlujo } from "./flujo-lectura.ts";
import { fotoDeJson, type FotoMapa } from "./mapa-contexto.ts";

export const PLAN_CONFLUENCIA = "PLAN_CONFLUENCIA_1";
/** Una zona en el camino más cerca que esto (en R desde la entrada) frena la entrada. */
export const DELANTE_CONTRA_R = 1;

export type Veredicto = "A_FAVOR" | "NEUTRA" | "EN_CONTRA";

/** El veredicto de una entrada con sus dos fotos; null si falta alguna. */
export function veredicto(mapa: FotoMapa | null, flujo: FotoFlujo | null): Veredicto | null {
  if (!mapa || !flujo) return null;
  const contra = (mapa.delante !== null && mapa.delante < DELANTE_CONTRA_R) || mapa.liquidezStop || flujo.enContra.length > 0;
  if (contra) return "EN_CONTRA";
  return mapa.detras > 0 || flujo.aFavor.length > 0 ? "A_FAVOR" : "NEUTRA";
}

/** El veredicto leído del JSON de la foto de una entrada. */
export const veredictoDeFoto = (foto: string | null | undefined): Veredicto | null => veredicto(fotoDeJson(foto), fotoFlujoDeJson(foto));

/** Si la versión «con el mapa» del agente toma esa entrada: hay veredicto y no está en contra. */
export const entraConMapa = (v: Veredicto | null): boolean => v !== null && v !== "EN_CONTRA";

/** Por qué una entrada quedó en contra, en palabras (vacío si no lo está). */
export function motivosContra(mapa: FotoMapa | null, flujo: FotoFlujo | null): string[] {
  const out: string[] = [];
  if (mapa && mapa.delante !== null && mapa.delante < DELANTE_CONTRA_R) out.push(`zona en el camino a ${mapa.delante.toFixed(2).replace(".", ",")} R`);
  if (mapa?.liquidezStop) out.push("stop junto a liquidez sin barrer");
  if (flujo?.enContra.length) out.push(`flujo en contra (${flujo.enContra.join(", ")})`);
  return out;
}

export const TEXTO_VEREDICTO: Record<Veredicto, string> = {
  A_FAVOR: "mapa y flujo a favor",
  NEUTRA: "mapa y flujo neutros",
  EN_CONTRA: "mapa o flujo en contra: con el mapa no entra",
};
