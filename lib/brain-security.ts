export const BRAIN_MODEL_VERSION = "secure-quant-brain-v3";

const GENESIS_HASH = "0".repeat(64);
const VERIFY_WINDOW = 96;

export type BrainSecurityState = {
  status: "INTEGRIDAD VERIFICADA" | "CADENA DEGRADADA" | "MEMORIA NO DISPONIBLE";
  chainVerified: boolean;
  storedEvents: number;
  checkedEvents: number;
  latestHash: string | null;
  modelVersion: string;
  policy: string;
  privacy: string;
};

type AuditEvent = {
  eventKey: string;
  eventType: "MODEL_MANIFEST" | "MARKET_OBSERVATION" | "MARKET_OUTCOME" | "SCALP_OBSERVATION";
  symbol?: string | null;
  timeframe?: string | null;
  source: string;
  observedAt: string;
  payload: unknown;
};

type AuditRow = {
  sequence: number;
  event_key: string;
  event_type: AuditEvent["eventType"];
  payload_hash: string;
  previous_hash: string;
  chain_hash: string;
  observed_at: string;
};

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function chainInput(
  previousHash: string,
  payloadHash: string,
  eventKey: string,
  eventType: string,
  observedAt: string,
) {
  return [BRAIN_MODEL_VERSION, previousHash, payloadHash, eventKey, eventType, observedAt].join("|");
}

export function unavailableBrainSecurity(): BrainSecurityState {
  return {
    status: "MEMORIA NO DISPONIBLE",
    chainVerified: false,
    storedEvents: 0,
    checkedEvents: 0,
    latestHash: null,
    modelVersion: BRAIN_MODEL_VERSION,
    policy: "Sólo datos de mercado verificables y resultados posteriores reales.",
    privacy: "Las preguntas del analista no se guardan ni se envían a terceros.",
  };
}

export async function ensureBrainSecuritySchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS brain_security_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      event_key TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      symbol TEXT,
      timeframe TEXT,
      source TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      previous_hash TEXT NOT NULL UNIQUE,
      chain_hash TEXT NOT NULL UNIQUE,
      observed_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS brain_security_events_time_idx
      ON brain_security_events (observed_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS brain_security_events_symbol_idx
      ON brain_security_events (symbol, timeframe, observed_at)`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS brain_security_events_previous_idx
      ON brain_security_events (previous_hash)`),
  ]);
}

export async function appendBrainAuditEvent(db: D1Database, event: AuditEvent) {
  const payloadHash = await sha256(canonical({
    payload: event.payload,
    source: event.source,
    symbol: event.symbol ?? null,
    timeframe: event.timeframe ?? null,
    observedAt: event.observedAt,
  }));
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const exists = await db.prepare(
      "SELECT chain_hash FROM brain_security_events WHERE event_key = ?1",
    ).bind(event.eventKey).first<{ chain_hash: string }>();
    if (exists) return exists.chain_hash;
    const latest = await db.prepare(
      "SELECT chain_hash FROM brain_security_events ORDER BY sequence DESC LIMIT 1",
    ).first<{ chain_hash: string }>();
    const previousHash = latest?.chain_hash ?? GENESIS_HASH;
    const chainHash = await sha256(chainInput(
      previousHash,
      payloadHash,
      event.eventKey,
      event.eventType,
      event.observedAt,
    ));
    try {
      await db.prepare(
        `INSERT INTO brain_security_events (
           event_key, event_type, symbol, timeframe, source, payload_hash,
           previous_hash, chain_hash, observed_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(event_key) DO NOTHING`,
      ).bind(
        event.eventKey,
        event.eventType,
        event.symbol ?? null,
        event.timeframe ?? null,
        event.source,
        payloadHash,
        previousHash,
        chainHash,
        event.observedAt,
      ).run();
      return chainHash;
    } catch {
      // Another request extended the chain first. Re-read the tip and retry.
    }
  }
  throw new Error("BRAIN_AUDIT_CHAIN_BUSY");
}

export async function registerBrainManifest(db: D1Database, observedAt: string) {
  return appendBrainAuditEvent(db, {
    eventKey: `model:${BRAIN_MODEL_VERSION}`,
    eventType: "MODEL_MANIFEST",
    source: "ALT RADAR PRO · código versionado",
    observedAt,
    payload: {
      version: BRAIN_MODEL_VERSION,
      inputs: ["Binance Spot", "Binance Futures", "resultados walk-forward"],
      excluded: ["preguntas del usuario", "datos personales", "resultados futuros"],
      calibration: "minimum-20-evaluated-samples",
    },
  });
}

export async function readBrainSecurity(db: D1Database): Promise<BrainSecurityState> {
  const [countRow, rowResult] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS total FROM brain_security_events")
      .first<{ total: number }>(),
    db.prepare(
      `SELECT sequence, event_key, event_type, payload_hash, previous_hash,
              chain_hash, observed_at
       FROM brain_security_events
       ORDER BY sequence DESC LIMIT ?1`,
    ).bind(VERIFY_WINDOW).all<AuditRow>(),
  ]);
  const rows = [...rowResult.results].reverse();
  let verified = true;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const expected = await sha256(chainInput(
      row.previous_hash,
      row.payload_hash,
      row.event_key,
      row.event_type,
      row.observed_at,
    ));
    if (expected !== row.chain_hash) verified = false;
    if (index > 0 && row.previous_hash !== rows[index - 1].chain_hash) verified = false;
  }
  const latest = rows.at(-1)?.chain_hash ?? null;
  return {
    status: rows.length && verified ? "INTEGRIDAD VERIFICADA" : "CADENA DEGRADADA",
    chainVerified: Boolean(rows.length && verified),
    storedEvents: Number(countRow?.total ?? 0),
    checkedEvents: rows.length,
    latestHash: latest,
    modelVersion: BRAIN_MODEL_VERSION,
    policy: "Sólo datos de mercado verificables y resultados posteriores reales.",
    privacy: "Las preguntas del analista no se guardan ni se envían a terceros.",
  };
}
