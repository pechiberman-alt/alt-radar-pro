import { env } from "cloudflare:workers";
import { ensureAuthSchema, getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { logBinanceFailure } from "@/lib/binance-debug-log";

export const dynamic = "force-dynamic";

/**
 * Failures from Binance calls made in the browser.
 *
 * Those calls no longer pass through the Worker (see
 * lib/binance-client-signed.ts), so when one fails nothing on the server ever
 * sees it — the person gets a message and the trail ends there. This lets the
 * browser report what that message was, into the same debug log the server-side
 * failures already go to.
 *
 * It only ever receives our own already-friendly error text, never the key,
 * the secret or a request body. It is bounded and login-gated so it can't be
 * used to fill the log.
 */
export async function POST(request: Request) {
  try {
    if (!env.DB) return Response.json({ ok: false }, { status: 503 });
    await ensureAuthSchema(env.DB);
    const token = getCookie(request, SESSION_COOKIE);
    const user = token ? await getSessionUser(env.DB, token) : null;
    if (!user) return Response.json({ ok: false }, { status: 401 });

    const body = (await request.json().catch(() => null)) as { context?: unknown; message?: unknown } | null;
    const context = String(body?.context ?? "").replace(/[^a-z0-9-]/gi, "").slice(0, 24);
    const message = String(body?.message ?? "").slice(0, 300);
    if (!context || !message) return Response.json({ ok: false }, { status: 400 });

    await logBinanceFailure(env.DB, `client-${context}`, user.id, new Error(message));
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
