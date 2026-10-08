import { NextRequest, NextResponse } from "next/server";
import { derivativesWithFallback, loadOkxLiquidations, type Attempt, type LiquidationTape, type ProviderId } from "@/lib/market-providers";
import type { Derivatives } from "@/lib/jarvis-desk-data";
import { cached } from "@/lib/upstream-cache";

export const dynamic = "force-dynamic";

/**
 * Derivados y liquidaciones reales desde el servidor, para cuando el
 * navegador no puede: OKX y Hyperliquid no siempre dejan leerse desde una
 * página (CORS), y las liquidaciones con historial solo las publica OKX. APIs
 * públicas, sin claves. Un resultado por moneda y por minuto se comparte
 * entre todos los que preguntan.
 */
// Measured in production (oct 2026): OKX answers the Worker with every field; Bybit refuses it (region block)
// and Binance refuses the crons. Hyperliquid has no 24 h open-interest change or long/short ratio.
const ORDER: ProviderId[] = ["okx", "hyperliquid", "bybit", "binance"];
const TTL_MS = 60_000;
const STALE_MS = 10 * 60_000;

type DerivPart = { data: Derivatives | null; provider: ProviderId | null; tried: Attempt[] };

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase();
  if (!/^[A-Z0-9]{2,20}USDT$/.test(symbol)) return NextResponse.json({ error: "MONEDA NO VÁLIDA" }, { status: 400 });
  const parts = new Set((url.searchParams.get("parts") ?? "derivados,liquidaciones").split(","));
  const price = Number(url.searchParams.get("price"));
  const ref = Number.isFinite(price) && price > 0 ? price : null;
  const now = Date.now();
  const [deriv, liq] = await Promise.all([
    parts.has("derivados")
      ? cached<DerivPart>(`deriv:${symbol}`, TTL_MS, async () => {
          const r = await derivativesWithFallback(symbol, ref, ORDER);
          return { data: r.derivatives, provider: r.provider, tried: r.tried };
        }, STALE_MS)
      : null,
    parts.has("liquidaciones") ? cached<LiquidationTape>(`liq:${symbol}`, TTL_MS, () => loadOkxLiquidations(symbol, now), STALE_MS) : null,
  ]);
  return NextResponse.json(
    {
      symbol,
      derivados: deriv?.value ?? null,
      derivadosEdadSeg: deriv ? Math.round(deriv.ageMs / 1000) : null,
      liquidaciones: liq?.value ?? null,
      liquidacionesEdadSeg: liq ? Math.round(liq.ageMs / 1000) : null,
      at: now,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
