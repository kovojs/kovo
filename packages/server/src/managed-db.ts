// SPEC §6.6/§9.4/§10.3 (plans/secure-framework.md MARQUEE): the framework-owned managed DB handle.
//
// This is the shipped KV433 Stage-1 runtime floor (the read-only loader proxy) unified with KV422
// (the SQL-safe managed handle). Where Kovo owns and threads the handle, loaders receive one
// managed read handle and mutations receive one managed write handle:
//
//   - `managedDb(raw, 'read')`  → SQL-safe (KV422) + read capability proxy (KV433). A `query()`
//     loader receives only the framework-approved read surface; every other property fails closed
//     at runtime and is absent from the `Reader<Db>` type mirror.
//   - `managedDb(raw, 'write')` → SQL-safe (KV422) only. A `mutation()` or other explicit write
//     surface gets the full read-write handle.
//
// The read-only proxy is the safe-default runtime backstop; the KV433 direct static no-write-
// reachable check remains the by-construction guarantee, while broader interprocedural write-
// summary work is still residue (SPEC §6.6/§10.3: proxies are defense-in-depth, never sold as the
// proof).

import { wrapManagedDbForSqlSafety, type ManagedSqlWritePolicy } from './sql-safe-handle.js';

declare const readerDbBrand: unique symbol;
declare const writerDbBrand: unique symbol;

/** Adapter hook for providing a framework-owned engine read-only DB handle. */
export const kovoReadonlyDbHandle: unique symbol = Symbol('kovo.readonly-db-handle');

/**
 * @internal Adapter hook for providing a framework-owned write DB handle whose underlying engine
 * enforces the mutation's declared write table policy.
 */
export const kovoDeclaredWriteDbHandle: unique symbol = Symbol('kovo.declared-write-db-handle');

/**
 * @internal Adapter contract for a DB value that can vend a dedicated/read-only reader.
 */
export interface KovoReadonlyDbCapable<ReadDb = unknown> {
  [kovoReadonlyDbHandle](): ReadDb;
}

/**
 * @internal Adapter contract for a DB value that can vend an engine-scoped declared-write handle.
 */
export interface KovoDeclaredWriteDbCapable<WriteDb = unknown> {
  [kovoDeclaredWriteDbHandle](policy: ManagedSqlWritePolicy): WriteDb;
}

const READ_CAPABILITY_PROPERTIES = new Set<string>([
  '$count',
  '$with',
  'query',
  'select',
  'selectDistinct',
  'with',
]);
const PARSED_READ_SQL_METHODS = new Set<string>([
  'all',
  'exec',
  'execute',
  'get',
  'prepare',
  'run',
  'sql',
  'values',
]);
const DENIED_READ_CAPABILITY_PROPERTIES = new Set<string>([
  '$client',
  'batch',
  'client',
  'delete',
  'insert',
  'pglite',
  'session',
  'sqlite',
  'transaction',
  'update',
]);

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
  ? Pick<Db, Extract<keyof Db, '$count' | '$with' | 'query' | 'select' | 'selectDistinct'>> &
      (Db extends { with: (...args: infer Args) => infer Result }
        ? {
            with(
              ...args: Args
            ): Result extends object
              ? Pick<
                  Result,
                  Extract<keyof Result, '$count' | '$with' | 'query' | 'select' | 'selectDistinct'>
                >
              : Result;
          }
        : {})
  : Db) & {
  readonly [readerDbBrand]: {
    readonly db: Db;
    readonly scope: 'framework-read-handle';
  };
};

/**
 * The compile-time mirror of a framework-threaded write handle (SPEC §10.3/§11.2, DEC-E).
 * Unlike {@link Reader}, this keeps the underlying DB surface intact, but adds a private-symbol
 * witness so APIs that require a managed write capability cannot be satisfied by a raw provider
 * handle by accident. Runtime SQL/read-write enforcement still belongs to {@link managedDb} and
 * {@link wrapManagedDbForSqlSafety}; this type is an author-time guardrail only.
 */
export type Writer<Db> = Db & {
  readonly [writerDbBrand]: {
    readonly db: Db;
    readonly scope: 'framework-write-handle';
  };
};

/** The mode a managed handle is resolved in: a read-only loader handle, or a read-write handle. */
export type ManagedDbMode = 'read' | 'write';

/**
 * Wrap a db handle so only known read capabilities are exposed (SPEC §9.4 KV433 Stage 1). The proxy
 * allowlists read builders and returns a thrower for every other string property, so future/dialect
 * sinks fail closed instead of depending on an incomplete write-verb denylist. Framework-owned
 * query/document surfaces receive this pre-applied as `context.db` / `request.db`.
 *
 * This helper is the blessed read-only escape for raw endpoint reads: wrap an app DB with
 * `readonlyDb(appDb)` instead of importing a broad write handle into a read-only endpoint. It is a
 * fail-closed runtime floor plus a branded type, not the SPEC §6.6 security proof.
 */
export function readonlyDb<Db extends object>(db: Db): Reader<Db> {
  const readDb = readonlyDbTarget(db);
  const safe = wrapManagedDbForSqlSafety(readDb, undefined, {
    capability: 'read',
    engineReadonly: readDb !== db,
  });
  return readonlyCapabilityDb(safe as object) as Reader<Db>;
}

function readonlyCapabilityDb<Db extends object>(db: Db): Reader<Db> {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === 'then') return undefined;
      if (typeof prop === 'string') {
        if (DENIED_READ_CAPABILITY_PROPERTIES.has(prop)) return readonlyCapabilityError(prop);
        if (!READ_CAPABILITY_PROPERTIES.has(prop)) {
          const value = Reflect.get(target, prop, receiver);
          if (
            typeof value === 'function' &&
            (PARSED_READ_SQL_METHODS.has(prop) || prop in target)
          ) {
            return value.bind(target);
          }
          return readonlyCapabilityError(prop);
        }
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as Reader<Db>;
}

function readonlyCapabilityError(prop: string): () => never {
  return () => {
    throw new KovoReadonlyHandleError(
      `A query() loader cannot access db.${prop} — loaders receive a read-only DB capability (KV433). Move writes to a mutation(), domain write, or endpoint().`,
    );
  };
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
export function managedDb<Db>(raw: Db, mode: 'write', options?: ManagedDbOptions): Writer<Db>;
export function managedDb<Db>(
  raw: Db,
  mode: ManagedDbMode,
  options?: ManagedDbOptions,
): Reader<Db> | Writer<Db>;
export function managedDb<Db>(
  raw: Db,
  mode: ManagedDbMode,
  options: ManagedDbOptions = {},
): Reader<Db> | Writer<Db> {
  const target =
    mode === 'read' ? readonlyDbTarget(raw) : declaredWriteDbTarget(raw, options.sqlWritePolicy);
  const safe = wrapManagedDbForSqlSafety(target, undefined, {
    ...options.sqlWritePolicy,
    capability: mode,
    engineReadonly: mode === 'read' && target !== raw,
  });
  if (mode === 'write') return safe as Writer<Db>;
  if (typeof safe !== 'object' || safe === null) return safe as Reader<Db>;
  return readonlyCapabilityDb(safe as unknown as object) as Reader<Db>;
}

function readonlyDbTarget<Db>(raw: Db): Db {
  if (!isRecord(raw)) return raw;
  const createReadonly = raw[kovoReadonlyDbHandle];
  if (typeof createReadonly !== 'function') return raw;
  const readTarget = createReadonly.call(raw) as Db;
  if (readTarget === raw) {
    throw new KovoReadonlyHandleError(
      'KV433: adapter read-only DB hook returned the mutable writer handle; managed readers require a dedicated engine read-only handle (SPEC §10.3/§11.2).',
    );
  }
  return readTarget;
}

function declaredWriteDbTarget<Db>(raw: Db, writePolicy: ManagedSqlWritePolicy | undefined): Db {
  if (
    writePolicy === undefined ||
    writePolicy.tables === undefined ||
    writePolicy.tables.length === 0
  ) {
    return raw;
  }
  if (!isRecord(raw)) return raw;
  const createDeclaredWrite = raw[kovoDeclaredWriteDbHandle];
  if (typeof createDeclaredWrite !== 'function') return raw;
  return createDeclaredWrite.call(raw, writePolicy) as Db;
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}
