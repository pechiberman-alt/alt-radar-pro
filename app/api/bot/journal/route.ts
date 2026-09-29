import { env } from "cloudflare:workers";
import { ensureAuthSchema, getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { validateJournalRow } from "@/lib/bot-journal";
import { countBotJournal, ensureBotJournalSchema, listBotJournal, MAX_ROWS_PER_USER, saveBotJournal } from "@/lib/bot-journal-db";

export const dynamic = "force-dynamic";

const MAX_PER_REQUEST = 100;

async function sessionUser(request: Request) {
  if (!env.DB) return null;
  await ensureAuthSchema(env.DB);
  const token = getCookie(request, SESSION_COOKIE);
  return token ? getSessionUser(env.DB, token) : null;
}

/** The logged-in person's whole bot record. */
export async function GET(request: Request) {
  try {
    const user = await sessionUser(request);
    if (!user) return Response.json({ error: "Iniciá sesión para ver el registro guardado." }, { status: 401 });
    await ensureBotJournalSchema(env.DB);
    const rows = await listBotJournal(env.DB, user.id);
    return Response.json({ rows }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "No se pudo leer el registro." }, { status: 500 });
  }
}

/** Stores closed trades sent by the bot. Idempotent: resending a trade is harmless. */
export async function POST(request: Request) {
  try {
    const user = await sessionUser(request);
    if (!user) return Response.json({ error: "Iniciá sesión para guardar el registro." }, { status: 401 });
    const body = (await request.json().catch(() => null)) as { rows?: unknown } | null;
    if (!body || !Array.isArray(body.rows) || body.rows.length > MAX_PER_REQUEST) {
      return Response.json({ error: `Enviá entre 1 y ${MAX_PER_REQUEST} operaciones por pedido.` }, { status: 400 });
    }
    const now = Date.now();
    const rows = body.rows.map((raw) => validateJournalRow(raw, now));
    const valid = rows.filter((row): row is NonNullable<typeof row> => row !== null);
    if (valid.length !== rows.length) {
      return Response.json({ error: "Hay operaciones con datos inválidos; no se guardó nada." }, { status: 400 });
    }
    await ensureBotJournalSchema(env.DB);
    if ((await countBotJournal(env.DB, user.id)) + valid.length > MAX_ROWS_PER_USER) {
      return Response.json({ error: `El registro llegó al máximo de ${MAX_ROWS_PER_USER} operaciones.` }, { status: 409 });
    }
    const saved = await saveBotJournal(env.DB, user.id, valid);
    return Response.json({ saved, received: valid.length });
  } catch {
    return Response.json({ error: "No se pudo guardar el registro." }, { status: 500 });
  }
}
