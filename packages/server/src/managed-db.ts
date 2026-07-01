// SPEC §6.6/§9.4/§10.3 (plans/secure-framework.md MARQUEE): the framework-owned managed DB handle.
//
// This is the shipped KV433 Stage-1 runtime floor (the read-only loader proxy) unified with KV422
// (the SQL-safe managed handle). Where Kovo owns and threads the handle, loaders receive one
// managed read handle and mutations receive one managed write handle:
//
//   - `managedDb(raw, 'read')`  → SQL-safe (KV422) + read-only proxy (KV433). A `query()` loader's
//     write verb (insert/update/delete/execute/run/batch) throws `KovoReadonlyHandleError` and is a
//     `tsc` error through the `Reader<Db>` type mirror.
//   - `managedDb(raw, 'write')` → SQL-safe (KV422) only. A `mutation()` or other explicit write
//     surface gets the full read-write handle.
//
// The read-only proxy is the safe-default runtime backstop; the KV433 direct static no-write-
// reachable check remains the by-construction guarantee, while broader interprocedural write-
// summary work is still residue (SPEC §6.6/§10.3: proxies are defense-in-depth, never sold as the
// proof).

import { wrapManagedDbForSqlSafety, type ManagedSqlWritePolicy } from './sql-safe-handle.js';

declare const readerDbBrand: unique symbol;

/**
 * The write verbs forbidden on a `query()` loader's read-only handle (SPEC §9.4 KV433). A loader is
 * a read surface: reaching a write from it is a state change on an idempotent GET (the confused-
 * deputy case). These are the Drizzle/db write entry points the read-only proxy fails closed.
 */
const WRITE_VERBS = new Set<string>(['insert', 'update', 'delete', 'execute', 'run', 'batch']);

/**
 * Thrown when a `query()` loader calls a write verb on its read-only managed handle (SPEC §9.4
 * KV433 Stage 1). This is the fail-closed runtime floor; the direct static no-write-reachable
 * proof is the by-construction guarantee. Move the write to a mutation/domain/endpoint write
 * surface.
 */
export class KovoReadonlyHandleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KovoReadonlyHandleError';
  }
}

/**
 * The compile-time mirror of the runtime read-only proxy (SPEC §9.4 KV433). Framework-owned read
 * surfaces receive `Reader<Db>` so a `db.insert(...)` is a `tsc` error in addition to the runtime
 * throw and the static gate. The private-symbol brand makes a raw provider handle awkward to pass
 * where a framework-threaded read capability is expected.
 *
 * This is ergonomics and defense-in-depth only (SPEC §6.6): the runtime proxy is the fail-closed
 * floor, and the static KV433 provenance gate remains the by-construction proof. Casts/`any` can
 * defeat this type and must never be accepted as security evidence.
 */
export type Reader<Db> = (Db extends object
  ? Omit<Db, 'batch' | 'delete' | 'execute' | 'insert' | 'run' | 'update'>
  : Db) & {
  readonly [readerDbBrand]: {
    readonly db: Db;
    readonly scope: 'framework-read-handle';
  };
};

/** The mode a managed handle is resolved in: a read-only loader handle, or a read-write handle. */
export type ManagedDbMode = 'read' | 'write';

/**
 * Wrap a db handle so every write verb throws (SPEC §9.4 KV433 Stage 1). The proxy intercepts
 * `WRITE_VERBS` and returns a thrower; every other property/method passes through unchanged so reads
 * keep working. Framework-owned query/document surfaces receive this pre-applied as `context.db` /
 * `request.db`.
 *
 * This helper is the blessed read-only escape for raw endpoint reads: wrap an app DB with
 * `readonlyDb(appDb)` instead of importing a broad write handle into a read-only endpoint. It is a
 * fail-closed runtime floor plus a branded type, not the SPEC §6.6 security proof.
 */
export function readonlyDb<Db extends object>(db: Db): Reader<Db> {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && WRITE_VERBS.has(prop)) {
        return () => {
          throw new KovoReadonlyHandleError(
            `A query() loader cannot ${prop}() — loaders are read-only (KV433). Move the write to a mutation(), domain write, or endpoint().`,
          );
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as Reader<Db>;
}

/** @internal Options for the framework-owned managed DB handle composition point. */
export interface ManagedDbOptions {
  sqlWritePolicy?: ManagedSqlWritePolicy;
}

/**
 * Resolve the framework-owned managed handle for a request (SPEC §6.6/§9.4/§10.3). Always applies
 * the KV422 SQL-safe wrap; in `'read'` mode it additionally applies the KV433 read-only proxy. This
 * is the single composition point: one handle = SQL-safe always + read-only in a loader + read-write
 * in an explicit write surface.
 *
 * @param raw - The app's raw resolved db handle (`app.db(request)` value).
 * @param mode - `'read'` for a `query()` loader, `'write'` for mutation/endpoint write surfaces.
 * @internal
 */
export function managedDb<Db>(raw: Db, mode: 'read', options?: ManagedDbOptions): Reader<Db>;
export function managedDb<Db>(raw: Db, mode: 'write', options?: ManagedDbOptions): Db;
export function managedDb<Db>(
  raw: Db,
  mode: ManagedDbMode,
  options?: ManagedDbOptions,
): Db | Reader<Db>;
export function managedDb<Db>(
  raw: Db,
  mode: ManagedDbMode,
  options: ManagedDbOptions = {},
): Db | Reader<Db> {
  const safe = wrapManagedDbForSqlSafety(raw, undefined, options.sqlWritePolicy);
  if (mode === 'write') return safe;
  if (typeof safe !== 'object' || safe === null) return safe as Reader<Db>;
  return readonlyDb(safe as unknown as object) as Reader<Db>;
}
