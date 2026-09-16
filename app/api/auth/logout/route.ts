import { env } from "cloudflare:workers";
import { clearedSessionCookieHeader, destroySession, getCookie, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const token = getCookie(request, SESSION_COOKIE);
  if (token && env.DB) {
    try {
      await destroySession(env.DB, token);
    } catch (error) {
      // The token is still valid server-side, so the cookie stays put: a
      // cleared cookie plus an error would leave the client believing it is
      // signed out while a copied cookie still works.
      console.error("[ALT_RADAR_LOGOUT]", error);
      return Response.json({ error: "NO SE PUDO CERRAR LA SESIÓN" }, { status: 500 });
    }
  }
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearedSessionCookieHeader() } });
}
