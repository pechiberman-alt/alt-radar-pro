import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { ensurePaperSchema, listPaper, openPaper, paperCounts, updatePaper } from "@/lib/jarvis-paper-db";

export const dynamic = "force-dynamic";

/**
 * Paper trading de JARVIS TRADING, por cuenta. Simulado: nada de esto toca un
 * exchange ni una clave. GET lista, POST abre una operación que sigue un plan
 * de la mesa, PUT guarda su avance (el servidor recalcula el resultado).
 */
async function who(request: NextRequest) {
  const session = getCookie(request, SESSION_COOKIE);
  return session && env.DB ? getSessionUser(env.DB, session) : null;
}

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_UPDATES = 20;

export async function GET(request: NextRequest) {
  const user = await who(request);
  if (!user) return NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });
  try {
    await ensurePaperSchema(env.DB);
    const [trades, counts] = await Promise.all([listPaper(env.DB, user.id), paperCounts(env.DB, user.id)]);
    return NextResponse.json({ trades, counts }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "No se pudo leer el paper trading." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await who(request);
  if (!user) return NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });
  try {
    const body = (await request.json().catch(() => null)) as { trade?: unknown } | null;
    await ensurePaperSchema(env.DB);
    const r = await openPaper(env.DB, user.id, body?.trade, Date.now());
    return r.ok ? NextResponse.json({ trade: r.trade }) : NextResponse.json({ error: r.error }, { status: r.status });
  } catch {
    return NextResponse.json({ error: "No se pudo abrir la operación de papel." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const user = await who(request);
  if (!user) return NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });
  try {
    const body = (await request.json().catch(() => null)) as { trades?: unknown } | null;
    if (!body || !Array.isArray(body.trades) || !body.trades.length || body.trades.length > MAX_UPDATES) {
      return NextResponse.json({ error: `Enviá entre 1 y ${MAX_UPDATES} operaciones por pedido.` }, { status: 400 });
    }
    await ensurePaperSchema(env.DB);
    return NextResponse.json(await updatePaper(env.DB, user.id, body.trades, Date.now()));
  } catch {
    return NextResponse.json({ error: "No se pudo guardar el avance." }, { status: 500 });
  }
}
