import type { KovoPostgresRuntimeDb } from '../postgres-runtime.js';
import {
  createWitnessWeakMap,
  witnessFreeze,
  witnessReflectApply,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from '../security-witness-intrinsics.js';

const postgresSystemDbBrand: unique symbol = Symbol('kovo.postgres-system-db');
const postgresSystemDbValues = createWitnessWeakMap<KovoPostgresSystemDb, KovoPostgresRuntimeDb>();
const postgresAppRuntimeDbResolvers = createWitnessWeakMap<
  object,
  (request?: unknown) => KovoPostgresRuntimeDb
>();

/**
 * Opaque framework-owned Postgres system-write database capability.
 *
 * The public type lets first-party integration constructors accept the capability without making
 * its raw-database consumer public. Minting and consumption stay on this package-internal entry so
 * packed server and Better Auth bundles share one module-private registry (SPEC §6.6/§10.3 C9).
 */
export interface KovoPostgresSystemDb {
  readonly [postgresSystemDbBrand]: {
    readonly scope: 'postgres-system-write-db';
  };
}

/** @internal Mint one Postgres system-write capability for a framework-owned raw database. */
export function createPostgresSystemDb(db: KovoPostgresRuntimeDb): KovoPostgresSystemDb {
  const capability = witnessFreeze({
    [postgresSystemDbBrand]: witnessFreeze({ scope: 'postgres-system-write-db' as const }),
  });
  witnessWeakMapSet(postgresSystemDbValues, capability, db);
  return capability;
}

/** @internal Consume an opaque Postgres system capability inside a reviewed first-party sink. */
export function usePostgresSystemDb<Result>(
  capability: KovoPostgresSystemDb,
  use: (db: KovoPostgresRuntimeDb) => Result,
): Result {
  const db = witnessWeakMapGet(postgresSystemDbValues, capability);
  if (db === undefined) {
    throw new Error(
      'KV414: invalid Postgres system DB capability; use createPostgresAppRuntimeDb().systemDb(...) (SPEC §10.3).',
    );
  }
  return witnessReflectApply<Result>(use, undefined, [db]);
}

/** @internal Register the private resolver behind a public opaque app-runtime provider token. */
export function registerPostgresAppRuntimeDb(
  runtime: object,
  resolver: (request?: unknown) => KovoPostgresRuntimeDb,
): void {
  witnessWeakMapSet(postgresAppRuntimeDbResolvers, runtime, resolver);
}

/** @internal Resolve a Postgres runtime DB only for framework tests and first-party adapters. */
export function usePostgresAppRuntimeDb(runtime: object, request?: unknown): KovoPostgresRuntimeDb {
  const resolver = witnessWeakMapGet(postgresAppRuntimeDbResolvers, runtime);
  if (resolver === undefined) {
    throw new Error(
      'KV414: invalid Postgres app runtime; use createPostgresAppRuntimeDb() (SPEC §10.3).',
    );
  }
  return witnessReflectApply<KovoPostgresRuntimeDb>(resolver, undefined, [request]);
}
