import { env } from "cloudflare:workers";
import { cleanNote } from "@/lib/account-journal";
import { ensureAuthSchema, getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { ensureDiarioSchema, listJournalNotes, saveJournalNote, TRADE_KEY } from "@/lib/diario-db";

export const dynamic = "force-dynamic";

async function sessionUser(request: Request) {
  if (!env.DB) return null;
  await ensureAuthSchema(env.DB);
  const token = getCookie(request, SESSION_COOKIE);
  return token ? getSessionUser(env.DB, token) : null;
}

export async function GET(request: Request) {
  try {
    const user = await sessionUser(request);
    if (!user) return Response.json({ error: "Iniciá sesión." }, { status: 401 });
    await ensureDiarioSchema(env.DB);
    return Response.json({ notes: await listJournalNotes(env.DB, user.id) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "No se pudieron leer las notas." }, { status: 500 });
  }
}

/** Saves the note for one trade (replacing the previous one). */
export async function PUT(request: Request) {
  try {
    const user = await sessionUser(request);
    if (!user) return Response.json({ error: "Iniciá sesión." }, { status: 401 });
    const body = (await request.json().catch(() => null)) as { key?: unknown; note?: unknown } | null;
    const key = typeof body?.key === "string" && TRADE_KEY.test(body.key) ? body.key : null;
    const note = cleanNote(body?.note);
    if (!key || !note) return Response.json({ error: "Nota inválida." }, { status: 400 });
    await ensureDiarioSchema(env.DB);
    if (!(await saveJournalNote(env.DB, user.id, key, note))) {
      return Response.json({ error: "Llegaste al máximo de notas guardadas." }, { status: 409 });
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "No se pudo guardar la nota." }, { status: 500 });
  }
}
