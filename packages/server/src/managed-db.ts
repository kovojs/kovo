// SPEC §6.6/§9.4/§10.3 (plans/secure-framework.md MARQUEE): the framework-owned managed DB handle.
//
// This is the shipped KV433 Stage-1 runtime floor (the read-only loader proxy) unified with KV422
// (the SQL-safe managed handle). Where Kovo owns and threads the handle, loaders receive one
// managed read handle and mutations receive one managed write handle:
//
//   - `managedDb(raw, 'read')`  → SQL-safe (KV422) + read-only proxy (KV433). A `query()` loader's
//     write verb (insert/update/delete/execute/run/batch) throws `KovoReadonlyHandleError` and is a
//     `tsc` error through the `Reader<Db>` type mirror.
//   - `managedDb(raw, 'write')` → SQL-safe (KV422) only. A `mutation()` handler (and the audited
//     `query.elevated(...)` GET-write escape) gets the full read-write handle.
//
// The read-only proxy is the safe-default runtime backstop; the KV433 direct static no-write-
// reachable check remains the by-construction guarantee, while broader interprocedural write-
// summary work is still residue (SPEC §6.6/§10.3: proxies are defense-in-depth, never sold as the
// proof).

import { wrapManagedDbForSqlSafety } from './sql-safe-handle.js';

/**
 * The write verbs forbidden on a `query()` loader's read-only handle (SPEC §9.4 KV433). A loader is
 * a read surface: reaching a write from it is a state change on an idempotent GET (the confused-
 * deputy case). These are the Drizzle/db write entry points the read-only proxy fails closed.
 */
const WRITE_VERBS = new Set<string>(['insert', 'update', 'delete', 'execute', 'run', 'batch']);

/**
 * Thrown when a `query()` loader calls a write verb on its read-only managed handle (SPEC §9.4
 * KV433 Stage 1). This is the fail-closed runtime floor; the direct static no-write-reachable
 * proof is the by-construction guarantee. Move the write to a `mutation()`, or use
 * `query.elevated(...)` for an idempotent-safe-to-repeat write.
 */
export class KovoReadonlyHandleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KovoReadonlyHandleError';
  }
}

/**
 * The compile-time mirror of the runtime read-only proxy (SPEC §9.4 KV433). A loader's
 * `context.db` is typed `Reader<Db>` so a `db.insert(...)` in a loader is a `tsc` error in addition
 * to the runtime throw and the static gate. This is ergonomics — the proxy is the runtime floor and
 * the static gate is the by-construction proof; the type just surfaces the error at authoring time.
 */
export type Reader<Db> = Omit<Db, 'insert' | 'update' | 'delete' | 'execute' | 'run' | 'batch'>;

/** The mode a managed handle is resolved in: a read-only loader handle, or a read-write handle. */
export type ManagedDbMode = 'read' | 'write';

/**
 * Wrap a db handle so every write verb throws (SPEC §9.4 KV433 Stage 1). The proxy intercepts the
 * `WRITE_VERBS` and returns a thrower; every other property/method passes through unchanged so reads
 * keep working. The returned proxy is structurally `Db`, but `context.db` is typed `Reader<Db>` so
 * the write verbs are also a `tsc` error.
 *
 * @internal exported for direct unit tests; apps receive it pre-applied as `context.db`.
 */
export function readonlyDb<Db extends object>(db: Db): Db {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && WRITE_VERBS.has(prop)) {
        return () => {
          throw new KovoReadonlyHandleError(
            `A query() loader cannot ${prop}() — loaders are read-only (KV433). Move the write to a mutation(), or use query.elevated for an idempotent write.`,
          );
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

/**
 * Resolve the framework-owned managed handle for a request (SPEC §6.6/§9.4/§10.3). Always applies
 * the KV422 SQL-safe wrap; in `'read'` mode it additionally applies the KV433 read-only proxy. This
 * is the single composition point: one handle = SQL-safe always + read-only in a loader + read-write
 * in a mutation (and in the audited `query.elevated` escape).
 *
 * @param raw - The app's raw resolved db handle (`app.db(request)` value).
 * @param mode - `'read'` for a `query()` loader, `'write'` for a `mutation()`/`query.elevated`.
 * @internal
 */
export function managedDb<Db>(raw: Db, mode: ManagedDbMode): Db {
  const safe = wrapManagedDbForSqlSafety(raw);
  if (mode === 'write') return safe;
  if (typeof safe !== 'object' || safe === null) return safe;
  return readonlyDb(safe as unknown as object) as unknown as Db;
}
