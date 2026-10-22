/**
 * La clave de Gemini y el modelo elegido al guardarla (lib/ai-brains.ts), leídos en el Worker: el navegador nunca toca
 * secretos. La usan /api/analyst/ai, el bot de Telegram y MENTE. Sin clave, null; un error de lectura cuenta como sin clave.
 */
import { getSecret, leerAjuste, type SettingsEnv } from "./app-settings.ts";
import { AJUSTE_MODELO_GEMINI, GEMINI_MODEL } from "./ai-brains.ts";

export async function geminiConfig(db: D1Database, env: SettingsEnv): Promise<{ key: string; model: string } | null> {
  const [k, m] = await Promise.all([getSecret(db, env, "gemini_api_key").catch(() => ({ value: null })), leerAjuste(db, AJUSTE_MODELO_GEMINI).catch(() => null)]);
  return k.value ? { key: k.value, model: m || GEMINI_MODEL } : null;
}
