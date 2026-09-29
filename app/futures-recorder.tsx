"use client";

import { useEffect } from "react";
import { onSession } from "@/lib/account-events";
import {
  BinanceClientError, FUTURES_USER_STREAM_URLS, friendlyClientError, pingFuturesUserStream, startFuturesUserStream,
} from "@/lib/binance-client-signed";
import { logKey, parseUserDataEvent, type FuturesLogRow } from "@/lib/futures-log";

/**
 * Records every execution and funding payment on the person's REAL Binance
 * futures account while the app is open in any tab — whichever panel is on
 * screen — by listening to the account's private stream.
 *
 * It holds only the API key: opening that stream needs no signature, so the
 * secret returned by /api/binance/credentials is dropped on arrival. Captured
 * rows are sent to the account's record at once; if that fails they wait in
 * this browser and are sent later, so a server hiccup doesn't lose them.
 */

export type RecorderState = "apagado" | "sin-sesion" | "sin-vincular" | "conectando" | "grabando" | "reintentando" | "sin-permiso";
export type RecorderStatus = { state: RecorderState; message: string; since: number | null; captured: number };

export const RECORDER_STATUS_EVENT = "alt-radar:futures-recorder";
export const RECORDER_ROWS_EVENT = "alt-radar:futures-log";
const PENDING = "alt-radar-futures-pending-v1";

let current: RecorderStatus = { state: "apagado", message: "", since: null, captured: 0 };
export const recorderStatus = () => current;
function publish(next: Partial<RecorderStatus>) {
  current = { ...current, ...next };
  window.dispatchEvent(new CustomEvent(RECORDER_STATUS_EVENT, { detail: current }));
}

function readPending(): FuturesLogRow[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PENDING) ?? "[]") as unknown;
    return Array.isArray(raw) ? (raw as FuturesLogRow[]) : [];
  } catch {
    return [];
  }
}
function writePending(rows: FuturesLogRow[]) {
  try {
    if (rows.length) localStorage.setItem(PENDING, JSON.stringify(rows.slice(-5000)));
    else localStorage.removeItem(PENDING);
  } catch {
    // storage unavailable: rows still go out while the tab is open
  }
}

function reportFailure(message: string) {
  void fetch("/api/binance/client-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context: "futures-stream", message }),
  }).catch(() => undefined);
}

function createRecorder() {
  let alive = true;
  let socket: WebSocket | null = null;
  let ping: ReturnType<typeof setInterval> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let flushRetry: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let flushing = false;
  let apiKey: string | null = null;
  const queue: FuturesLogRow[] = readPending();

  const flush = async () => {
    if (flushing || !queue.length || !alive) return;
    flushing = true;
    try {
      while (queue.length && alive) {
        const chunk = queue.slice(0, 100);
        const r = await fetch("/api/binance/futures-log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: chunk }),
        });
        if (r.status === 400) {
          // A row the server refuses will never be accepted: drop the chunk
          // rather than retry it forever, and say so where it can be seen.
          reportFailure(`registro rechazado: ${chunk.map(logKey).slice(0, 3).join(", ")}`);
        } else if (!r.ok) {
          throw new Error(`HTTP ${r.status}`);
        } else {
          window.dispatchEvent(new CustomEvent(RECORDER_ROWS_EVENT, { detail: chunk }));
        }
        queue.splice(0, chunk.length);
        writePending(queue);
      }
    } catch {
      if (alive) flushRetry = setTimeout(() => void flush(), 30_000);
    } finally {
      flushing = false;
    }
  };

  const closeSocket = () => {
    if (ping) clearInterval(ping);
    ping = null;
    const s = socket;
    socket = null;
    try {
      s?.close();
    } catch {
      // already closed
    }
  };

  const scheduleRetry = (why: string) => {
    closeSocket();
    if (!alive) return;
    failures += 1;
    const delay = Math.min(5 * 60_000, 5_000 * 2 ** Math.min(failures - 1, 6));
    publish({ state: "reintentando", message: why });
    retry = setTimeout(() => void connect(), delay);
  };

  const connect = async () => {
    if (!alive || !apiKey) return;
    publish({ state: "conectando", message: "" });
    let listenKey: string;
    try {
      listenKey = await startFuturesUserStream(apiKey);
    } catch (error) {
      if (!alive) return;
      if (error instanceof BinanceClientError && error.code === -2015) {
        publish({ state: "sin-permiso", message: "La API key vinculada no tiene el permiso «Habilitar Futuros»." });
        reportFailure("futures stream: -2015");
        return;
      }
      scheduleRetry(friendlyClientError(error));
      return;
    }
    if (!alive) return;
    const urls = FUTURES_USER_STREAM_URLS(listenKey);
    const open = (i: number) => {
      const ws = new WebSocket(urls[i]);
      let opened = false;
      socket = ws;
      ws.onopen = () => {
        opened = true;
        failures = 0;
        publish({ state: "grabando", message: "", since: Date.now() });
      };
      ws.onmessage = (event) => {
        let data: unknown;
        try {
          data = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if ((data as { e?: string } | null)?.e === "listenKeyExpired") {
          scheduleRetry("La clave del canal privado venció; reconectando.");
          return;
        }
        const rows = parseUserDataEvent(data);
        if (!rows.length) return;
        queue.push(...rows);
        writePending(queue);
        publish({ captured: current.captured + rows.length });
        void flush();
      };
      ws.onclose = () => {
        if (!alive || socket !== ws) return;
        if (!opened && i + 1 < urls.length) {
          open(i + 1);
          return;
        }
        scheduleRetry("Se cortó el canal privado de Binance; reconectando.");
      };
    };
    open(0);
    ping = setInterval(() => {
      if (apiKey) pingFuturesUserStream(apiKey).catch(() => undefined);
    }, 30 * 60_000);
  };

  (async () => {
    try {
      const me = await fetch("/api/auth/me", { cache: "no-store" });
      const body = me.ok ? ((await me.json()) as { user: unknown }) : { user: null };
      if (!alive) return;
      if (!body.user) {
        publish({ state: "sin-sesion", message: "" });
        return;
      }
      void flush();
      const cred = await fetch("/api/binance/credentials", { cache: "no-store" });
      if (!alive) return;
      if (cred.status === 404) {
        publish({ state: "sin-vincular", message: "" });
        return;
      }
      if (!cred.ok) {
        scheduleRetry("No se pudieron leer las credenciales guardadas.");
        return;
      }
      // Only the key is kept: the stream never needs the secret.
      apiKey = ((await cred.json()) as { apiKey: string }).apiKey;
      await connect();
    } catch {
      if (alive) scheduleRetry("Sin conexión; reintentando.");
    }
  })();

  return () => {
    alive = false;
    if (retry) clearTimeout(retry);
    if (flushRetry) clearTimeout(flushRetry);
    closeSocket();
    apiKey = null;
    publish({ state: "apagado", message: "", since: null });
  };
}

export default function FuturesRecorder() {
  useEffect(() => {
    let stop = createRecorder();
    // Logging in or out (or linking a key) restarts it with the new session.
    const off = onSession(() => {
      stop();
      stop = createRecorder();
    });
    return () => {
      off();
      stop();
    };
  }, []);
  return null;
}
