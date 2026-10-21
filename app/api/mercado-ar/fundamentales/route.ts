/**
 * Balances anuales de la empresa de afuera de un CEDEAR, de SEC EDGAR, para las mentes de valor (Buffett, Graham, Lynch,
 * crecimiento). Solo la lista fija de lib/fundamentales-sec.ts; se guardan 7 días en una fila de D1 por empresa, así SEC
 * recibe a lo sumo un pedido por semana por empresa. Si SEC no responde, se sirve lo último guardado diciendo que es viejo.
 * Datos públicos: sin puerta PRO.
 */
import { NextResponse } from "next/server";
import { env } from "cloudflare:workers";
import { EMPRESAS_SEC, SIN_BALANCE, fundamentalesDe } from "@/lib/fundamentales-sec";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const simbolo = new URL(request.url).searchParams.get("simbolo") ?? "";
  if (!EMPRESAS_SEC[simbolo]) {
    return NextResponse.json({ simbolo, fund: null, viejo: false, error: SIN_BALANCE[simbolo] ?? "sin balances de SEC para este papel" }, { headers: { "Cache-Control": "no-store" } });
  }
  const db = (env as { DB?: D1Database }).DB;
  if (!db) return NextResponse.json({ simbolo, fund: null, viejo: false, error: "sin base de datos" }, { status: 503 });
  const r = await fundamentalesDe(db, simbolo);
  return NextResponse.json({ simbolo, fund: r.fund, viejo: r.viejo, error: r.error }, { headers: { "Cache-Control": "no-store" } });
}
