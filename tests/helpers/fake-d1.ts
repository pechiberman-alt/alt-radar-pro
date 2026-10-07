/** A D1 stand-in over node:sqlite (in memory), with the calls the app uses: prepare/bind/run/first/all and batch. */
export const sqlite = await import("node:sqlite").catch(() => null);

export function makeDb(): D1Database {
  const sql = new sqlite!.DatabaseSync(":memory:");
  const stmt = (q: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(q, a),
    run: async () => {
      const r = sql.prepare(q).run(...(args as never[]));
      return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
    first: async () => sql.prepare(q).get(...(args as never[])) ?? null,
    all: async () => ({ results: sql.prepare(q).all(...(args as never[])) }),
  });
  return { prepare: (q: string) => stmt(q), batch: async (l: { run: () => Promise<unknown> }[]) => Promise.all(l.map((s) => s.run())) } as never as D1Database;
}
