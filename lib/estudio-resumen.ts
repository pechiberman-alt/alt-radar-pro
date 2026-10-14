/**
 * Un resumen corto y honesto del estudio de estrategias del laboratorio, para que JARVIS (Telegram y la app) hable de lo
 * mismo que muestra el piso: qué estrategias tuvieron ventaja medida en la evaluación y cuáles no. Sale de los datos
 * generados (lib/estudio-estrategias-datos.ts) y no inventa nada. Medición del pasado; no es asesoramiento financiero.
 */
import { ESTUDIO_FILAS, ESTUDIO_META } from "./estudio-estrategias-datos.ts";

const r2 = (v: number | null) => (v === null ? "sin dato" : `${v > 0 ? "+" : ""}${v.toFixed(2).replace(".", ",")} R`);

export function resumenEstudio(): string {
  const probadas = new Set(ESTUDIO_FILAS.map((f) => f.estrategia)).size;
  const ventajas = ESTUDIO_FILAS.filter((f) => f.veredicto === "VENTAJA" || f.veredicto === "CANDIDATA").sort((a, b) => (b.evaluacion.expectancia ?? -9) - (a.evaluacion.expectancia ?? -9));
  const lineas = ventajas.map((f) => `${f.agente} (${f.marco}): ${r2(f.evaluacion.expectancia)} por operación, n=${f.evaluacion.operaciones}, ${f.veredicto === "VENTAJA" ? "ventaja confirmada por la auditoría" : "candidata: no sobrevive a la auditoría de sobreajuste"}`);
  return (
    `Estudio del laboratorio (pasado, con costos, ${ESTUDIO_META.datosDesde} a ${ESTUDIO_META.datosHasta}, ${probadas} estrategias, veredicto solo de la evaluación posterior al ${ESTUDIO_META.corte}): ` +
    (lineas.length ? `con resultado positivo en evaluación: ${lineas.join("; ")}. ` : "ninguna tuvo resultado positivo medido. ") +
    `Auditoría: probando muchas variantes sobre los mismos datos, ninguna le gana a no operar con significancia (SPA p=${String(ESTUDIO_META.auditoria.pSpa).replace(".", ",")}); la única prueba limpia es el agente en papel hacia adelante. ` +
    "Las demás no le ganan al azar. En 1h ninguna tiene ventaja. Es una medición del pasado: no garantiza resultados y no es asesoramiento financiero."
  );
}
