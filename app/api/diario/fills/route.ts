import { env } from "cloudflare:workers";
import { validateJFill } from "@/lib/account-journal";
import { ensureAuthSchema, getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { countJournalFills, ensureDiarioSchema, listJournalFills, MAX_JOURNAL_FILLS, saveJournalFills } from "@/lib/diario-db";

export const dynamic = "force-dynamic";
const MAX_PER_REQUEST = 100;

async function sessionUser(request: Request) {
  if (!env.DB) return null;
  await ensureAuthSchema(env.DB);
  const token = getCookie(request, SESSION_COOKIE);
  return token ? getSessionUser(env.DB, token) : null;
}

/** The spot fills read from Binance and the rows imported from files. */
export async function GET(request: Request) {
  try {
    const user = await sessionUser(request);
    if (!user) return Response.json({ error: "Iniciá sesión." }, { status: 401 });
    await ensureDiarioSchema(env.DB);
    return Response.json({ fills: await listJournalFills(env.DB, user.id) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "No se pudo leer el diario." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await sessionUser(request);
    if (!user) return Response.json({ error: "Iniciá sesión." }, { status: 401 });
    const body = (await request.json().catch(() => null)) as { fills?: unknown } | null;
    if (!body || !Array.isArray(body.fills) || !body.fills.length || body.fills.length > MAX_PER_REQUEST) {
      return Response.json({ error: `Enviá entre 1 y ${MAX_PER_REQUEST} operaciones por pedido.` }, { status: 400 });
    }
    const now = Date.now();
    const parsed = body.fills.map((raw) => validateJFill(raw, now));
    const valid = parsed.filter((f): f is NonNullable<typeof f> => f !== null);
    // Live futures fills have their own record; only synced and imported rows belong here.
    if (valid.length !== parsed.length || valid.some((f) => f.source === "live")) {
      return Response.json({ error: "Hay operaciones con datos inválidos; no se guardó nada." }, { status: 400 });
    }
    await ensureDiarioSchema(env.DB);
    if ((await countJournalFills(env.DB, user.id)) + valid.length > MAX_JOURNAL_FILLS) {
      return Response.json({ error: `El diario llegó al máximo de ${MAX_JOURNAL_FILLS} operaciones.` }, { status: 409 });
    }
    return Response.json({ saved: await saveJournalFills(env.DB, user.id, valid), received: valid.length });
  } catch {
    return Response.json({ error: "No se pudo guardar." }, { status: 500 });
  }
}
