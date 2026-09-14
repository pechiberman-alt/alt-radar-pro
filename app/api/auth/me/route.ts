import { env } from "cloudflare:workers";
import { getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token || !env.DB) return Response.json({ user: null });
  const user = await getSessionUser(env.DB, token);
  return Response.json({ user });
}
