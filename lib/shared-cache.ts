/**
 * Shared, short-lived cache for database-backed JSON that is the same for
 * everyone (signal ledger, performance totals).
 *
 * Every open tab polling such an endpoint used to cost a full table scan per
 * request, and D1's free tier counts rows read: one tab left open could spend
 * a million reads an hour. Cloudflare's Cache API is shared by every request
 * in the same data centre, so N tabs cost one scan per TTL. A per-isolate map
 * sits in front of it, and when the Cache API is absent (tests, local runs)
 * that map alone is used.
 */
const local = new Map<string, { at: number; value: unknown }>();
const ORIGIN = "https://alt-radar-cache.internal/";

function edgeCache(): Cache | null {
  const c = (globalThis as { caches?: { default?: Cache } }).caches;
  return c?.default ?? null;
}

export async function sharedJson<T>(key: string, ttlSec: number, loader: () => Promise<T>, now = Date.now()): Promise<T> {
  const hit = local.get(key);
  if (hit && now - hit.at < ttlSec * 1000) return hit.value as T;
  const edge = edgeCache();
  const url = ORIGIN + encodeURIComponent(key);
  if (edge) {
    const res = await edge.match(url).catch(() => undefined);
    if (res) {
      const value = (await res.json()) as T;
      local.set(key, { at: now, value });
      return value;
    }
  }
  const value = await loader();
  local.set(key, { at: now, value });
  if (edge) {
    await edge
      .put(url, new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttlSec}` } }))
      .catch(() => undefined);
  }
  return value;
}

/** After a write that changes the data, the next read goes to the database. */
export async function dropShared(key: string): Promise<void> {
  local.delete(key);
  await edgeCache()?.delete(ORIGIN + encodeURIComponent(key)).catch(() => undefined);
}
