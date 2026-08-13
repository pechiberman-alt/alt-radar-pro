import { env } from "cloudflare:workers";
import {
  readLiquidityHistory,
  storeLiquiditySnapshot,
} from "@/lib/liquidity-history";

export const dynamic = "force-dynamic";

function marketFrom(url: string) {
  const search = new URL(url).searchParams;
  const symbol = (search.get("symbol") ?? "").toUpperCase().replaceAll("/", "");
  const venue = search.get("venue") === "futures" ? "futures" : "spot";
  const hours = Number(search.get("hours") ?? 24);
  if (!/^[A-Z0-9]{2,24}USDT$/.test(symbol)) return null;
  return { symbol, venue, hours: Number.isFinite(hours) ? hours : 24 } as const;
}

export async function GET(request: Request) {
  try {
    if (!env.DB) throw new Error("D1_UNAVAILABLE");
    const market = marketFrom(request.url);
    if (!market) return Response.json({ error: "MERCADO INVÁLIDO" }, { status: 400 });
    const snapshots = await readLiquidityHistory(
      env.DB,
      market.symbol,
      market.venue,
      market.hours,
    );
    const first = snapshots[0]?.capturedAt ?? null;
    const last = snapshots.at(-1)?.capturedAt ?? null;
    return Response.json(
      {
        symbol: market.symbol,
        venue: market.venue,
        snapshots,
        coverage: {
          first,
          last,
          minutes: first && last
            ? Math.max(0, (Date.parse(last) - Date.parse(first)) / 60_000)
            : 0,
          samples: snapshots.length,
        },
        source: "ALT RADAR Liquidity Archive · Cloudflare D1",
        note: "Sólo snapshots observados desde la activación del archivo; no reconstruye profundidad pasada.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[ALT_RADAR_LIQUIDITY_READ]", error);
    return Response.json(
      { error: "HISTORIAL DE LIQUIDEZ TEMPORALMENTE NO DISPONIBLE" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  try {
    if (!env.DB) throw new Error("D1_UNAVAILABLE");
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin) {
      return Response.json({ error: "ORIGEN NO AUTORIZADO" }, { status: 403 });
    }
    const input = await request.json() as {
      symbol?: unknown;
      venue?: unknown;
      capturedAt?: unknown;
      mid?: unknown;
      bids?: unknown;
      asks?: unknown;
    };
    const result = await storeLiquiditySnapshot(env.DB, {
      symbol: typeof input.symbol === "string" ? input.symbol.toUpperCase() : "",
      venue: input.venue === "futures" ? "futures" : "spot",
      capturedAt: typeof input.capturedAt === "string" ? input.capturedAt : "",
      mid: Number(input.mid),
      bids: input.bids,
      asks: input.asks,
    });
    return Response.json(result, {
      status: result.stored ? 201 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[ALT_RADAR_LIQUIDITY_WRITE]", error);
    return Response.json(
      { error: "SNAPSHOT RECHAZADO" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
