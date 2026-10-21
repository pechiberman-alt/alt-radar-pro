/**
 * Varias series de MERCADO AR en un solo pedido (hasta 12), en formato compacto (lib/mercado-ar-lote.ts): el panel entero
 * llega en unos pocos pedidos en lugar de cien. Cada serie usa la misma caché de 15 minutos que /api/mercado-ar (con la
 * última buena hasta 3 días si Yahoo no responde, diciendo su edad). Solo la lista fija de símbolos. Sin puerta PRO.
 */
import { NextResponse } from "next/server";
import { SIMBOLOS_PERMITIDOS } from "@/lib/mercado-ar";
import { bajarSerieAr, type ResultadoAr } from "@/lib/mercado-ar-fuente";
import { compactar, simbolosDelLote, type ItemLote } from "@/lib/mercado-ar-lote";
import { cached } from "@/lib/upstream-cache";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const simbolos = simbolosDelLote(new URL(request.url).searchParams.get("simbolos") ?? "", SIMBOLOS_PERMITIDOS);
  if (!simbolos.length) return NextResponse.json({ error: "Ningún símbolo de la lista de acciones y CEDEARs." }, { status: 400 });
  const items = await Promise.all(
    simbolos.map(async (simbolo): Promise<[string, ItemLote]> => {
      let ultimoError: string | null = null;
      const r = await cached<ResultadoAr>(
        `mercado-ar:${simbolo}`,
        15 * 60_000,
        async () => {
          const x = await bajarSerieAr(simbolo);
          ultimoError = x.error;
          return x.serie ? x : null;
        },
        3 * 86_400_000,
      );
      return [simbolo, { serie: compactar(r.value?.serie ?? null), fuente: r.value?.fuente ?? null, edadSeg: Math.round(r.ageMs / 1000), error: r.value ? null : (ultimoError ?? "la fuente no respondió") }];
    }),
  );
  return NextResponse.json({ series: Object.fromEntries(items) }, { headers: { "Cache-Control": "no-store" } });
}
