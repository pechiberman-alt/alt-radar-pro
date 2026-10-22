/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import { getSecret } from "../lib/app-settings";
import { runTelegramDispatch } from "../lib/telegram-dispatch";
import handler from "vinext/server/app-router-entry";
import { windDownSignals } from "../lib/automation";
import { archiveCoreLiquidity } from "../lib/liquidity-archive";
import { runCoreTick } from "../lib/jarvis-core-db";
import { probeFreeBrain } from "../lib/ai-probe";
import { runMindHour } from "../lib/jarvis-mind-db";
import { runAgentesServidor } from "../lib/agentes-servidor-run";
import { CRON_SERVIDOR } from "../lib/agentes-servidor";
import { esHoraDelDiario, runAprendizajeDiario } from "../lib/aprendizaje-diario-db";
import { conSeguridad } from "../lib/seguridad-cabeceras";
import { contarPedido, respuestaLimite } from "../lib/limite-pedidos";
import { rutaPro } from "../lib/suscripcion";
import { puertaDe, respuestaPuerta } from "../lib/suscripcion-db";
import type { AiLike } from "../lib/ai-brains";
import { parseCoinGeckoGlobal, parseCoinLoreGlobal } from "../lib/market-structure";
import { recordStructureSnapshot } from "../lib/structure-archive";
import { probarMercadoAr, tocaPruebaAr } from "../lib/mercado-ar-fuente";
import { runArSenales } from "../lib/ar-senales-run";
import { runPizarraServidor } from "../lib/pizarra-servidor-run";

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
  /** Encryption key for secrets saved from the app (optional Cloudflare secret). */
  ENCRYPTION_KEY?: string;
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

async function responder(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Primer freno contra quien llama a la API en bucle desde una IP (lib/limite-pedidos.ts).
    const { pathname } = new URL(request.url);
    const espera = contarPedido(request.headers.get("cf-connecting-ip"), pathname);
    if (espera !== null) return conSeguridad(respuestaLimite(espera));
    // La puerta PRO (lib/suscripcion.ts): la inteligencia de la terminal pide sesión y prueba o pago vigentes. Si la base
    // falla al leer el acceso, el pedido sigue (cada ruta tiene su propio control de sesión): un corte no deja afuera a todos.
    if (env.DB && rutaPro(pathname)) {
      const puerta = await puertaDe(request, env.DB).catch((error) => {
        console.error("[ALT_RADAR_PUERTA_PRO]", error);
        return null;
      });
      if (puerta && !(puerta.sesion && puerta.acceso.acceso)) return conSeguridad(respuestaPuerta(puerta));
    }
    return conSeguridad(await responder(request, env, ctx));
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
      // Once per deploy: does the free AI brain answer in production? (lib/ai-probe.ts)
      ctx.waitUntil(
        probeFreeBrain(env.DB, (env as unknown as { AI?: AiLike }).AI ?? null).catch((error) => {
          console.error("[ALT_RADAR_AI_PROBE]", error);
        }),
      );
      // JARVIS MENTE: once an hour (hh:17 UTC), its own reading of the market and theses (lib/jarvis-mind.ts).
      ctx.waitUntil(
        runMindHour(env.DB, env as unknown as { AI?: AiLike }, controller.scheduledTime).catch((error) => {
          console.error("[ALT_RADAR_JARVIS_MIND]", error);
        }),
      );
      // BYMA: un papel por minuto, de lunes a viernes a las 21 UTC, con el mercado cerrado (lib/ar-senales.ts).
      ctx.waitUntil(
        runArSenales(env.DB, controller.scheduledTime).catch((error) => {
          console.error("[ALT_RADAR_AR_SENALES]", error);
        }),
      );
      // Pizarra de cripto: una moneda por minuto, a los 31–40 de cada hora múltiplo de 4 UTC (lib/pizarra-servidor.ts).
      ctx.waitUntil(
        runPizarraServidor(env.DB, controller.scheduledTime).catch((error) => {
          console.error("[ALT_RADAR_PIZARRA]", error);
        }),
      );
      // JARVIS CORE: one small job per minute, 24/7 (lib/jarvis-core.ts).
      ctx.waitUntil(
        runCoreTick(env.DB, controller.scheduledTime).catch((error) => {
          console.error("[ALT_RADAR_JARVIS_CORE]", error);
        }),
      );
    }
    if (controller.cron === "*/15 * * * *") {
      ctx.waitUntil(
        // The confluence and scalping engines no longer open signals (Uri,
        // 3/10/2026: measured, they were losing; signals now come only from the
        // ROBOT MM). This only closes the ones still open — stop, targets,
        // plans — and becomes a no-op once there are none.
        windDownSignals(env.DB).catch((error) => {
          console.error("[ALT_RADAR_SCHEDULED]", error);
        }),
      );
      ctx.waitUntil(
        archiveMarketStructure(env.DB).catch((error) => {
          console.error("[ALT_RADAR_STRUCTURE_SCHEDULED]", error);
        }),
      );
      // Diagnóstico horario del mercado argentino (Yahoo Finance): una vez por hora, en los primeros 15 minutos.
      if (tocaPruebaAr(controller.scheduledTime)) {
        ctx.waitUntil(
          probarMercadoAr(env.DB, controller.scheduledTime).catch((error) => {
            console.error("[ALT_RADAR_MERCADO_AR]", error);
          }),
        );
      }
      // El aprendizaje diario de la oficina (lib/aprendizaje-diario.ts): una vez por día, a las 00:15 de Argentina. Sin IA.
      if (esHoraDelDiario(controller.scheduledTime)) {
        ctx.waitUntil(
          runAprendizajeDiario(env.DB, controller.scheduledTime).catch((error) => {
            console.error("[ALT_RADAR_APRENDIZAJE_DIARIO]", error);
          }),
        );
      }
    }
    if (controller.cron === "*/5 * * * *") {
      // Token from a Cloudflare secret or, if absent, the one saved in the app.
      ctx.waitUntil(
        getSecret(env.DB, env, "telegram_bot_token")
          .then(async ({ value }) => {
            if (!value) return null;
            const arkham = await getSecret(env.DB, env, "arkham_api_key").catch(() => ({ value: null }));
            return runTelegramDispatch(env.DB, value, Date.now(), arkham.value);
          })
          .catch((error) => {
            console.error("[ALT_RADAR_TELEGRAM_SCHEDULED]", error);
          }),
      );
    }
    // Los agentes de papel 24/7 (lib/agentes-servidor.ts): una moneda por corrida, en su propio cron para no compartir CPU.
    if (controller.cron === CRON_SERVIDOR) {
      ctx.waitUntil(
        runAgentesServidor(env.DB, controller.scheduledTime).catch((error) => {
          console.error("[ALT_RADAR_AGENTES_SERVIDOR]", error);
        }),
      );
    }
    // Scalping automation: switched off with the confluence engine (see above).
  },
};

export default worker;
