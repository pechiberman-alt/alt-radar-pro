import { env } from "cloudflare:workers";
import { clearedSessionCookieHeader, destroySession, getCookie, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const token = getCookie(request, SESSION_COOKIE);
  if (token && env.DB) {
    await destroySession(env.DB, token).catch(() => undefined);
  }
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearedSessionCookieHeader() } });
}
