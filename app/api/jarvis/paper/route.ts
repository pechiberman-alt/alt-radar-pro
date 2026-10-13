import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { ensurePaperSchema, listPaper, openPaper, paperCounts, updatePaper } from "@/lib/jarvis-paper-db";
import { evaluarPropuesta, operacionDePapel, propuestaDePapel } from "@/lib/lab-riesgo";

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
    const body = (await request.json().catch(() => null)) as { trade?: unknown; riesgoPct?: unknown; limites?: unknown } | null;
    await ensurePaperSchema(env.DB);
    // El gestor de riesgo central (lib/lab-riesgo.ts) también acá, no solo en el navegador: los límites que llegan se
    // recortan a los topes, y sin riesgo por operación conocido no se abre.
    const raw = body?.trade as { symbol?: unknown; lado?: unknown; entrada?: unknown; stop?: unknown; rrPlan?: unknown } | undefined;
    if (raw && typeof raw === "object" && typeof raw.symbol === "string" && (raw.lado === "LONG" || raw.lado === "SHORT")) {
      const cartera = (await listPaper(env.DB, user.id)).map((t) => operacionDePapel(t));
      const propuesta = propuestaDePapel(
        { symbol: raw.symbol, lado: raw.lado, entrada: Number(raw.entrada), stop: Number(raw.stop), rrPlan: Number(raw.rrPlan) },
        typeof body?.riesgoPct === "number" ? body.riesgoPct : null,
      );
      const v = evaluarPropuesta(propuesta, cartera, body?.limites, Date.now());
      if (!v.ok) return NextResponse.json({ error: `El gestor de riesgo del laboratorio no la deja abrir. ${v.motivos.join(" ")}` }, { status: 409 });
    }
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
