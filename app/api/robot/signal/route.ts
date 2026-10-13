import { env } from "cloudflare:workers";
import { getSecret } from "@/lib/app-settings";
import { ensureAuthSchema, getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { resumirRegistro } from "@/lib/robot-ledger";
import { ENVIADA, ensureRobotLedger, guardarRecorridos, listarRegistro, marcarTelegram, registrarSenal } from "@/lib/robot-ledger-db";
import { robotSignalKey, robotSignalText, validateRobotSignal, type RobotSignal } from "@/lib/robot-signals";
import { parsePrefs, sendMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/**
 * Las señales del ROBOT MM de tu cuenta.
 * POST con una señal que encontró el navegador: queda registrada con su SL, TP1,
 *   TP2 y TP3 (aunque Telegram no esté vinculado) y se avisa a Telegram una vez.
 * POST con accion "evaluar": los recorridos que resolvió el navegador, revisados
 *   contra lo guardado; el resultado en R lo calcula el servidor.
 * GET: el registro (las últimas 100) con su resumen.
 */
async function usuario(request: Request) {
  await ensureAuthSchema(env.DB);
  const token = getCookie(request, SESSION_COOKIE);
  return token ? getSessionUser(env.DB, token) : null;
}

/**
 * Avisa a Telegram una sola vez. La clave entra primero en telegram_sent, así
 * dos pestañas abiertas no la mandan las dos; si Telegram falla se borra y el
 * próximo escaneo reintenta.
 */
async function avisar(userId: number, signal: RobotSignal): Promise<{ sent: boolean; reason?: string }> {
  const link = await env.DB.prepare("SELECT chat_id, prefs FROM telegram_links WHERE user_id = ?1").bind(userId).first<{ chat_id: string; prefs: string }>();
  if (!link) return { sent: false, reason: "Telegram no vinculado" };
  let prefsRaw: unknown = {};
  try {
    prefsRaw = JSON.parse(link.prefs || "{}");
  } catch {
    prefsRaw = {};
  }
  if (!parsePrefs(prefsRaw).categories["SEÑAL"]) return { sent: false, reason: "Señales apagadas en Telegram" };

  const key = robotSignalKey(signal);
  const claimed = await env.DB.prepare("INSERT OR IGNORE INTO telegram_sent (key, sent_at) VALUES (?1, ?2)").bind(key, Date.now()).run();
  if (!claimed.meta.changes) return { sent: false, reason: "ya enviada" };

  const bot = (await getSecret(env.DB, env, "telegram_bot_token")).value;
  const result = bot ? await sendMessage(bot, link.chat_id, robotSignalText(signal)) : { ok: false, description: "bot sin token" };
  if (!result.ok) {
    await env.DB.prepare("DELETE FROM telegram_sent WHERE key = ?1").bind(key).run();
    return { sent: false, reason: result.description ?? "Telegram no respondió" };
  }
  return { sent: true };
}

export async function GET(request: Request) {
  if (!env.DB) return Response.json({ error: "Base no disponible." }, { status: 503 });
  try {
    const user = await usuario(request);
    if (!user) return Response.json({ error: "Iniciá sesión." }, { status: 401 });
    await ensureRobotLedger(env.DB);
    const registros = await listarRegistro(env.DB, user.id);
    return Response.json({ registros, resumen: resumirRegistro(registros) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[ALT_RADAR_ROBOT_LEDGER]", error);
    return Response.json({ error: "No se pudo leer el registro." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!env.DB) return Response.json({ error: "Base no disponible." }, { status: 503 });
  try {
    const user = await usuario(request);
    if (!user) return Response.json({ error: "Iniciá sesión." }, { status: 401 });
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    await ensureRobotLedger(env.DB);

    if (body?.accion === "evaluar") {
      const r = await guardarRecorridos(env.DB, user.id, body.recorridos, Date.now());
      return r.ok ? Response.json({ registros: r.registros, rechazados: r.rechazados }) : Response.json({ error: r.error }, { status: r.status });
    }

    const signal = validateRobotSignal(body, Date.now());
    if (!signal) return Response.json({ error: "Señal inválida." }, { status: 400 });
    // Primero el registro: la señal queda con su escalera pase lo que pase con Telegram.
    const registro = await registrarSenal(env.DB, user.id, signal, Date.now());
    const aviso = await avisar(user.id, signal);
    const texto = aviso.sent ? ENVIADA : aviso.reason ?? "";
    if (texto && aviso.reason !== "ya enviada") await marcarTelegram(env.DB, user.id, robotSignalKey(signal), texto);
    // Lo que quedó guardado: una vez enviada sigue «enviada»; si no, el motivo de ahora.
    const guardado = registro?.telegram === ENVIADA || aviso.reason === "ya enviada" ? (registro?.telegram ?? null) : texto || registro?.telegram || null;
    return Response.json({ ...aviso, registro: registro ? { ...registro, telegram: guardado } : null });
  } catch (error) {
    console.error("[ALT_RADAR_ROBOT_SIGNAL]", error);
    return Response.json({ error: "No se pudo registrar ni enviar." }, { status: 500 });
  }
}
