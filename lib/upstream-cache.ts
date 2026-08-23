/**
 * Shared in-Worker cache for upstream market data.
 *
 * Every open tab used to spend the same per-IP rate limit, which is how a
 * single session can get the origin throttled — and a throttled Binance
 * answers without CORS headers, so panels go dark rather than degrade. One
 * cached read per key serves every concurrent request, and a stale entry is
 * preferable to nothing when upstream is refusing us.
 */

type Entry<T> = {
  value: T;
  at: number;
  /** In-flight request, so concurrent callers coalesce instead of stampeding. */
  pending?: Promise<T | null>;
};

const store = new Map<string, Entry<unknown>>();

export type CacheState = "HIT" | "MISS" | "STALE" | "COALESCED";

export type CachedResult<T> = {
  value: T | null;
  state: CacheState;
  ageMs: number;
};

/**
 * @param ttlMs how long a value is served without revalidating
 * @param staleMs how long a stale value may still be served if the loader fails
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T | null>,
  staleMs = ttlMs * 10,
): Promise<CachedResult<T>> {
  const now = Date.now();
  const existing = store.get(key) as Entry<T> | undefined;

  if (existing && now - existing.at < ttlMs) {
    return { value: existing.value, state: "HIT", ageMs: now - existing.at };
  }

  if (existing?.pending) {
    const value = await existing.pending;
    return {
      value: value ?? existing.value,
      state: "COALESCED",
      ageMs: Date.now() - existing.at,
    };
  }

  const pending = loader().catch(() => null);
  store.set(key, { ...(existing ?? { value: null as T, at: 0 }), pending });

  const value = await pending;

  if (value !== null && value !== undefined) {
    store.set(key, { value, at: Date.now() });
    return { value, state: "MISS", ageMs: 0 };
  }

  // Loader failed. Serve the previous reading while it is still worth showing.
  if (existing && now - existing.at < staleMs) {
    store.set(key, { value: existing.value, at: existing.at });
    return { value: existing.value, state: "STALE", ageMs: now - existing.at };
  }

  store.delete(key);
  return { value: null, state: "MISS", ageMs: 0 };
}

/**
 * Accept a value fetched by a client on the Worker's behalf.
 *
 * Some upstream endpoints refuse datacenter addresses, so the Worker cannot
 * fetch them at all while ordinary visitors can. A contribution is only taken
 * when nothing fresher is held, which keeps a client from overwriting a good
 * reading or replacing it with a fabricated one.
 *
 * @returns whether the contribution was stored
 */
export function offerCached<T>(key: string, value: T, freshMs: number): boolean {
  if (value === null || value === undefined) return false;
  const existing = store.get(key);
  if (existing && Date.now() - existing.at < freshMs) return false;
  store.set(key, { value, at: Date.now() });
  return true;
}

/** Exposed for tests; not used by request handlers. */
export function clearUpstreamCache() {
  store.clear();
}
