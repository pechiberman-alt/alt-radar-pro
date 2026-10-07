import { buildSystemPrompt, buildUserMessage, type ChatTurn } from "./ai-analyst.ts";
import { BRAIN_LABEL, type AiLike } from "./ai-brains.ts";
import { answerWithBrains } from "./ai-cascade.ts";
import { getSecret, type SettingsEnv } from "./app-settings.ts";
import { KNOWLEDGE } from "./assistant/knowledge.ts";
import { loadCryptoNews, type CryptoNewsResult } from "./crypto-news.ts";
import { parseFearGreed, type FearGreed } from "./fear-greed.ts";
import { sendMessage, tg } from "./telegram.ts";
import { buildServerSnapshot, markdownToTelegramHtml, splitForTelegram, type ServerSnapshot } from "./telegram-ai.ts";
import { cached } from "./upstream-cache.ts";
import { coreContext } from "./jarvis-core.ts";
import { coreSnapshot } from "./jarvis-core-db.ts";
import { sharedJson } from "./shared-cache.ts";
import { listMemory, memoryBlock } from "./jarvis-memory.ts";
import { DEFAULT_NEURAL, VOICE_MAX_CHARS } from "./jarvis-voice.ts";
import { addUsage, allowance, synthesize, usageToday } from "./jarvis-voice-server.ts";
import { downloadVoice, escapeHtml, sendVoiceNote, speechFor, transcribe, voiceProblem, type TgVoice } from "./telegram-voice.ts";

const SYSTEM =
  buildSystemPrompt(KNOWLEDGE) +
  "\n\nFORMATO: estás respondiendo en un chat de Telegram. Texto corto (máximo ~150 palabras), párrafos breves, **negrita** sólo para lo clave, sin tablas ni encabezados largos.";

const MAJORS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT"];
const SPOT_HOSTS = ["https://data-api.binance.vision", "https://api-gcp.binance.com", "https://api.binance.com"];

async function majorsFromBinance() {
  const q = encodeURIComponent(JSON.stringify(MAJORS));
  for (const host of SPOT_HOSTS) {
    try {
      const r = await fetch(`${host}/api/v3/ticker/24hr?symbols=${q}`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) continue;
      const rows = (await r.json()) as { symbol?: string; lastPrice?: string; priceChangePercent?: string }[];
      const out = rows
        .map((x) => ({ s: String(x.symbol), price: Number(x.lastPrice), ch24h: Number(x.priceChangePercent) }))
        .filter((x) => x.price > 0);
      if (out.length) return out;
    } catch {
      // Next host.
    }
  }
  return [];
}

export async function loadServerSnapshot(db: D1Database, now = Date.now()): Promise<ServerSnapshot> {
  const [majors, signals, fg, news, structure] = await Promise.all([
    majorsFromBinance(),
    db
      .prepare(
        `SELECT symbol, side, score, entry_price, timeframe, detected_at FROM signal_records
          WHERE status = 'MONITORING' ORDER BY score DESC LIMIT 10`,
      )
      .all<{ symbol: string; side: string; score: number; entry_price: number; timeframe: string; detected_at: string }>()
      .then((r) => r.results)
      .catch(() => []),
    cached<FearGreed>("fear-greed", 30 * 60_000, async () => {
      const r = await fetch("https://api.alternative.me/fng/?limit=31&format=json", { signal: AbortSignal.timeout(6000) });
      return r.ok ? parseFearGreed(await r.json()) : null;
    }, 24 * 3_600_000).catch(() => ({ value: null })),
    cached<CryptoNewsResult>("crypto-news", 10 * 60_000, async () => {
      const r = await loadCryptoNews(now);
      return r.items.length ? r : null;
    }, 6 * 3_600_000).catch(() => ({ value: null })),
    db
      .prepare("SELECT * FROM structure_snapshots ORDER BY captured_at DESC LIMIT 1")
      .first<Record<string, number | string | null>>()
      .catch(() => null),
  ]);

  return buildServerSnapshot(
    {
      majors,
      openSignals: signals.map((x) => ({ s: x.symbol, side: x.side, score: x.score, entry: x.entry_price, tf: x.timeframe, since: x.detected_at })),
      fearGreed: fg.value ? { value: fg.value.value, zone: fg.value.zone } : null,
      structure: structure ?? null,
      news: (news.value?.items ?? [])
        .filter((n) => n.impact !== "BAJO" && now - n.publishedAt < 12 * 3_600_000)
        .map((n) => ({ title: n.title, category: n.category, impact: n.impact, tone: n.tone, source: n.source })),
    },
    now,
  );
}

const CHAT_SCHEMA =
  "CREATE TABLE IF NOT EXISTS telegram_chat (chat_id TEXT NOT NULL, at INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL)";

export async function clearChat(db: D1Database, chatId: string) {
  await db.prepare(CHAT_SCHEMA).run();
  await db.prepare("DELETE FROM telegram_chat WHERE chat_id = ?1").bind(chatId).run();
}

/**
 * Answers a free-text question in Telegram with the analyst. Runs in the
 * background (the webhook has already answered Telegram), so every failure
 * ends in a message to the user rather than a silent drop.
 */
export async function answerInTelegram(db: D1Database, env: SettingsEnv & { AI?: AiLike }, token: string, chatId: string, userId: number, question: string): Promise<string | null> {
  try {
    await tg(token, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => undefined);

    const [claudeKey, groqKey, notes] = await Promise.all([
      getSecret(db, env, "anthropic_api_key"),
      getSecret(db, env, "groq_api_key"),
      listMemory(db, userId).catch(() => []),
    ]);

    await db.prepare(CHAT_SCHEMA).run();
    const history = (
      await db
        .prepare("SELECT role, content FROM telegram_chat WHERE chat_id = ?1 AND at > ?2 ORDER BY at DESC LIMIT 6")
        .bind(chatId, Date.now() - 6 * 3_600_000)
        .all<{ role: "user" | "assistant"; content: string }>()
    ).results.reverse();

    // JARVIS's 24/7 core goes along: its record, what it learned and what it sees now.
    const [base, core] = await Promise.all([
      loadServerSnapshot(db),
      sharedJson("jarvis-core-v1", 60, () => coreSnapshot(db, Date.now())).catch(() => null),
    ]);
    const snapshot = core ? { ...base, jarvis: coreContext(core, Date.now()).nucleo } : base;
    const messages: ChatTurn[] = [...history, { role: "user", content: buildUserMessage(question, snapshot, memoryBlock(notes)) }];
    // Claude first, then the free brains (lib/ai-brains.ts); only the one that answered is counted.
    const answer = await answerWithBrains(db, userId, { claude: claudeKey.value, groq: groqKey.value }, env.AI ?? null, SYSTEM, messages);
    if (!answer.ok) {
      await sendMessage(
        token,
        chatId,
        answer.error === "SIN IA POR HOY"
          ? "Por hoy se terminaron las respuestas de IA (Claude y las gratuitas); mañana vuelven. Mientras tanto /jarvis y los demás comandos siguen andando, y en la app JARVIS responde con su motor local sin límite."
          : "La IA no pudo responder ahora. Probá de nuevo en un rato.",
      );
      return null;
    }

    const html = markdownToTelegramHtml(answer.text) + (answer.brain === "claude" ? "" : `\n<i>Respondió: ${BRAIN_LABEL[answer.brain]}.</i>`);
    for (const part of splitForTelegram(html)) {
      await sendMessage(token, chatId, part);
    }
    const now = Date.now();
    // Only the plain question and answer are kept — never the data snapshot —
    // so follow-ups work without re-sending old market data.
    await db.batch([
      db.prepare("INSERT INTO telegram_chat (chat_id, at, role, content) VALUES (?1, ?2, 'user', ?3)").bind(chatId, now, question.slice(0, 1500)),
      db.prepare("INSERT INTO telegram_chat (chat_id, at, role, content) VALUES (?1, ?2, 'assistant', ?3)").bind(chatId, now + 1, answer.text.slice(0, 1500)),
      db.prepare("DELETE FROM telegram_chat WHERE at < ?1").bind(now - 2 * 86_400_000),
    ]);
    return answer.text;
  } catch (error) {
    console.error("[ALT_RADAR_TELEGRAM_AI]", error);
    await sendMessage(token, chatId, "Hubo un error respondiendo. Probá de nuevo.").catch(() => undefined);
    return null;
  }
}

/**
 * A voice note to JARVIS: heard with Whisper, then answered like a typed
 * question, in the same thread. The transcript goes first, so a misheard word
 * shows at once. Every failure ends in a message the person can read.
 */
export async function answerVoiceInTelegram(db: D1Database, env: SettingsEnv & { AI?: AiLike }, token: string, chatId: string, userId: number, voice: TgVoice) {
  try {
    await tg(token, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => undefined);
    const problem = voiceProblem(voice);
    if (problem) {
      await sendMessage(token, chatId, problem);
      return;
    }
    const groq = await getSecret(db, env, "groq_api_key");
    if (!groq.value) {
      await sendMessage(token, chatId, "Todavía no puedo escucharte: falta configurar el reconocimiento de voz. Mientras tanto, escribime la pregunta.");
      return;
    }
    const audio = await downloadVoice(token, voice.file_id);
    const heard = audio ? await transcribe(groq.value, audio) : null;
    if (!heard) {
      await sendMessage(token, chatId, "No te entendí la nota. Probá de nuevo, más despacio, o escribime.");
      return;
    }
    await sendMessage(token, chatId, `🎙 Escuché: <i>${escapeHtml(heard)}</i>`);
    const answer = await answerInTelegram(db, env, token, chatId, userId, heard);
    if (answer) await replyWithVoice(db, env, token, chatId, userId, answer);
  } catch (error) {
    // The bot token and the file's address never reach the log: only the kind of error.
    console.error("[ALT_RADAR_TELEGRAM_VOICE]", error instanceof Error ? error.name : "error");
    await sendMessage(token, chatId, "Hubo un error con tu nota de voz. Probá de nuevo.").catch(() => undefined);
  }
}

/**
 * The answer as a voice note too, within the voice allowance of the app
 * (lib/jarvis-voice-server.ts). Quietly skipped when the allowance or the voice
 * is out: the text is already in the chat.
 */
async function replyWithVoice(db: D1Database, env: { AI?: AiLike }, token: string, chatId: string, userId: number, answer: string) {
  const model = env.AI ?? null;
  const text = speechFor(answer, VOICE_MAX_CHARS);
  if (!model || !text) return;
  const day = new Date().toISOString().slice(0, 10);
  const allow = allowance(await usageToday(db, day, userId), text.length);
  if (!allow.allowed) return;
  const out = await synthesize(model, text, DEFAULT_NEURAL.male, allow.premium);
  if (!out) return;
  await addUsage(db, day, userId, text.length, out.model === "aura");
  await sendVoiceNote(token, chatId, out.audio);
}
