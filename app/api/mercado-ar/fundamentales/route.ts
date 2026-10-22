/**
 * Balances anuales de la empresa de un papel (la de afuera si es CEDEAR, la argentina si presenta 20-F), de SEC EDGAR, para las mentes de valor (Buffett, Graham, Lynch,
 * crecimiento). Solo la lista fija de lib/fundamentales-sec.ts; se guardan 7 días en una fila de D1 por empresa, así SEC
 * recibe a lo sumo un pedido por semana por empresa. Si SEC no responde, se sirve lo último guardado diciendo que es viejo.
 * Datos públicos: sin puerta PRO.
 */
import { NextResponse } from "next/server";
import { env } from "cloudflare:workers";
import { empresaSec, fundamentalesDe, motivoSinBalance } from "@/lib/fundamentales-sec";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const simbolo = new URL(request.url).searchParams.get("simbolo") ?? "";
  if (!empresaSec(simbolo)) {
    return NextResponse.json({ simbolo, fund: null, viejo: false, error: motivoSinBalance(simbolo) }, { headers: { "Cache-Control": "no-store" } });
  }
  const db = (env as { DB?: D1Database }).DB;
  if (!db) return NextResponse.json({ simbolo, fund: null, viejo: false, error: "sin base de datos" }, { status: 503 });
  const r = await fundamentalesDe(db, simbolo);
  return NextResponse.json({ simbolo, fund: r.fund, viejo: r.viejo, error: r.error }, { headers: { "Cache-Control": "no-store" } });
}
