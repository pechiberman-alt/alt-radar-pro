import { env } from "cloudflare:workers";
import { ensureAuthSchema, getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { validateFuturesLogRow } from "@/lib/futures-log";
import { countFuturesLog, ensureFuturesLogSchema, listFuturesLog, MAX_FUTURES_LOG_ROWS, saveFuturesLog } from "@/lib/futures-log-db";

export const dynamic = "force-dynamic";

const MAX_PER_REQUEST = 100;

async function sessionUser(request: Request) {
  if (!env.DB) return null;
  await ensureAuthSchema(env.DB);
  const token = getCookie(request, SESSION_COOKIE);
  return token ? getSessionUser(env.DB, token) : null;
}

/** The logged-in person's recorded real futures activity. */
export async function GET(request: Request) {
  try {
    const user = await sessionUser(request);
    if (!user) return Response.json({ error: "Iniciá sesión para ver el registro." }, { status: 401 });
    await ensureFuturesLogSchema(env.DB);
    return Response.json({ rows: await listFuturesLog(env.DB, user.id) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "No se pudo leer el registro." }, { status: 500 });
  }
}

/** Executions and funding payments captured from the account's private stream. Idempotent. */
export async function POST(request: Request) {
  try {
    const user = await sessionUser(request);
    if (!user) return Response.json({ error: "Iniciá sesión para guardar el registro." }, { status: 401 });
    const body = (await request.json().catch(() => null)) as { rows?: unknown } | null;
    if (!body || !Array.isArray(body.rows) || !body.rows.length || body.rows.length > MAX_PER_REQUEST) {
      return Response.json({ error: `Enviá entre 1 y ${MAX_PER_REQUEST} registros por pedido.` }, { status: 400 });
    }
    const now = Date.now();
    const rows = body.rows.map((raw) => validateFuturesLogRow(raw, now));
    const valid = rows.filter((row): row is NonNullable<typeof row> => row !== null);
    if (valid.length !== rows.length) {
      return Response.json({ error: "Hay registros con datos inválidos; no se guardó nada." }, { status: 400 });
    }
    await ensureFuturesLogSchema(env.DB);
    if ((await countFuturesLog(env.DB, user.id)) + valid.length > MAX_FUTURES_LOG_ROWS) {
      return Response.json({ error: `El registro llegó al máximo de ${MAX_FUTURES_LOG_ROWS} movimientos.` }, { status: 409 });
    }
    return Response.json({ saved: await saveFuturesLog(env.DB, user.id, valid), received: valid.length });
  } catch {
    return Response.json({ error: "No se pudo guardar el registro." }, { status: 500 });
  }
}
