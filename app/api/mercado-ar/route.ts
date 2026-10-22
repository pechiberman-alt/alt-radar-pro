/**
 * Velas diarias de una acción argentina o un CEDEAR (y de su acción de afuera), de Yahoo Finance, para el panel MERCADO AR.
 * Solo acepta los símbolos de la lista fija de lib/mercado-ar.ts (no es un proxy abierto) y guarda cada serie 15 minutos
 * en la caché del Worker, así varias pestañas no le piden lo mismo a Yahoo. Si Yahoo no responde, se sirve la última serie
 * guardada (hasta 3 días) diciendo su antigüedad; si no hay ninguna, el error real. Datos públicos de mercado: sin puerta PRO.
 */
import { NextResponse } from "next/server";
import { SIMBOLOS_PERMITIDOS } from "@/lib/mercado-ar";
import { serieArCacheada } from "@/lib/mercado-ar-fuente";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const simbolo = new URL(request.url).searchParams.get("simbolo") ?? "";
  if (!SIMBOLOS_PERMITIDOS.has(simbolo)) {
    return NextResponse.json({ error: "Ese símbolo no está en la lista de acciones y CEDEARs." }, { status: 400 });
  }
  const c = await serieArCacheada(simbolo);
  return NextResponse.json(
    {
      simbolo,
      serie: c.resultado?.serie ?? null,
      fuente: c.resultado?.fuente ?? null,
      edadSeg: Math.round(c.edadMs / 1000),
      error: c.error,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
