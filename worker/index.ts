/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import { runTelegramDispatch } from "../lib/telegram-dispatch";
import handler from "vinext/server/app-router-entry";
import { runSignalAutomation } from "../lib/automation";
import { archiveCoreLiquidity } from "../lib/liquidity-archive";
import { runScalpingAutomation } from "../lib/scalping-automation";
import { parseCoinGeckoGlobal, parseCoinLoreGlobal } from "../lib/market-structure";
import { recordStructureSnapshot } from "../lib/structure-archive";

/**
 * Free sources publish dominance only as a current value. Recording it on a
 * schedule is what turns USDT.D and BTC.D into a trend the app can read.
 */
async function archiveMarketStructure(db: D1Database) {
  const fetchJson = async (url: string) => {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "ALT-RADAR-PRO/2.1" },
      signal: AbortSignal.timeout(7_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };

  let structure = null;
  try {
    structure = parseCoinGeckoGlobal(
      await fetchJson("https://api.coingecko.com/api/v3/global"),
    );
  } catch {
    // Fall through to the backup source.
  }
  if (!structure) {
    try {
      structure = parseCoinLoreGlobal(
        await fetchJson("https://api.coinlore.net/api/global/"),
      );
    } catch {
      return;
    }
  }
  if (structure) await recordStructureSnapshot(db, structure);
}

interface Env {
  /** Telegram bot token (Cloudflare secret). Alerts are off while it is missing. */
  TELEGRAM_BOT_TOKEN?: string;
  /** Anthropic API key for the ANALISTA AI mode (Cloudflare secret). Off while missing. */
  ANTHROPIC_API_KEY?: string;
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },

  async scheduled(
    controller: { scheduledTime: number; cron: string },
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    if (!env.DB) return;
    if (controller.cron === "* * * * *") {
      ctx.waitUntil(
        archiveCoreLiquidity(env.DB).catch((error) => {
          console.error("[ALT_RADAR_LIQUIDITY_SCHEDULED]", error);
        }),
      );
    }
    if (controller.cron === "*/15 * * * *") {
      ctx.waitUntil(
        runSignalAutomation(env.DB).catch((error) => {
          console.error("[ALT_RADAR_SCHEDULED]", error);
          // The next scheduled run retries automatically. No synthetic records are written.
        }),
      );
      ctx.waitUntil(
        archiveMarketStructure(env.DB).catch((error) => {
          console.error("[ALT_RADAR_STRUCTURE_SCHEDULED]", error);
        }),
      );
    }
    if (controller.cron === "*/5 * * * *" && env.TELEGRAM_BOT_TOKEN) {
      ctx.waitUntil(
        runTelegramDispatch(env.DB, env.TELEGRAM_BOT_TOKEN).catch((error) => {
          console.error("[ALT_RADAR_TELEGRAM_SCHEDULED]", error);
        }),
      );
    }
    if (controller.cron === "*/5 * * * *") {
      ctx.waitUntil(
        runScalpingAutomation(env.DB).catch((error) => {
          console.error("[ALT_RADAR_SCALPING_SCHEDULED]", error);
          // No record is created when public market data is unavailable.
        }),
      );
    }
  },
};

export default worker;
