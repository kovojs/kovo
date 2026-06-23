import type * as CoreGraph from '@kovojs/core/internal/graph';
import type {
  CsrfValidationOptions,
  MutationDefinition,
  MutationResult,
  QueryDefinition,
  Schema,
} from '@kovojs/server';
import {
  executeHarnessMutation,
  executeHarnessQuery,
  type HarnessPageFixture,
  loadHarnessPage,
} from './harness-operations.js';
import type { PageAssertion } from './page.js';
import { createDbVerifier } from './verifier.js';
import type { DbVerificationDiagnostic } from './verifier-diagnostics.js';
import type { DbVerificationConfig as InternalDbVerificationConfig } from './verifier-observation.js';

// SPEC.md §11: the harness verification API returns `DbVerificationDiagnostic`s
// and the `page()` API returns a `PageAssertion`, so both documented types are
// re-exported here to keep the harness public surface self-contained.
export type { HarnessPageFixture } from './harness-operations.js';
export type { PageAssertion } from './page.js';
export type { DbVerificationDiagnostic } from './verifier-diagnostics.js';

/** The context a Kovo test receives: the `db`, and helpers to `exec` mutations, run `query`s, load a `page`, and read verification diagnostics. */
export interface KovoTestContext<Db = unknown> {
  db: Db;
  dbHandle(): Db;
  exec: <
    InputSchema extends Schema<unknown>,
    Errors extends Record<string, Schema<unknown>>,
    Request extends { db: unknown },
    Value,
  >(
    mutation: MutationDefinition<string, InputSchema, Errors, Request, Value>,
    input: unknown,
    options?: KovoTestExecOptions<Request>,
  ) => Promise<MutationResult<Value>>;
  page: (path: string) => Promise<PageAssertion>;
  query: (query: QueryDefinition, input?: unknown) => Promise<unknown>;
  verificationDiagnostics(): readonly DbVerificationDiagnostic[];
}

/** Touch-site fact accepted by the public harness verifier options (SPEC.md §11). */
export interface KovoTestTouchSite {
  branch?: string;
  domain: string;
  keys: null | string;
  predicate?: 'eq' | 'non-eq';
  site: string;
  via: string;
}

/** Read-site fact accepted by the public harness verifier options (SPEC.md §11). */
export interface KovoTestReadSite {
  branch?: string;
  domain: string;
  keys: null | string;
  predicate?: 'eq' | 'non-eq';
  site: string;
  source: string;
  via: string;
}

/** Unresolved static write fact accepted by the public harness verifier options (SPEC.md §11). */
export interface KovoTestUnresolvedWriteSite {
  code: 'KV404' | 'KV406' | 'KV413';
  domain?: string;
  message: string;
  site: string;
}

/** One public touch-graph entry consumed by `createKovoTestHarness` verification (SPEC.md §11). */
export interface KovoTestTouchGraphEntry {
  reads?: readonly KovoTestReadSite[];
  touches: readonly KovoTestTouchSite[];
  unresolved: readonly KovoTestUnresolvedWriteSite[];
}

/** Public structural touch graph accepted by `createKovoTestHarness` verification (SPEC.md §11). */
export type KovoTestTouchGraph = Readonly<Record<string, KovoTestTouchGraphEntry>>;

/** Public database-observation config for harness verification (SPEC.md §11). */
export interface KovoTestVerificationConfig {
  domainByTable: Record<string, string>;
  exemptTables?: readonly string[];
  keyByTable?: Record<string, string>;
  sqlDialect?: 'postgres' | 'sqlite';
}

/** Options for `createKovoTestHarness`: the `db`, optional `pages`, request stub, touch graph, and verification config. */
export interface KovoTestHarnessOptions<Db> {
  db: Db;
  pages?: Record<string, HarnessPageFixture<Db>>;
  request?: Record<string, unknown>;
  touchGraph?: KovoTestTouchGraph;
  verification?: KovoTestVerificationConfig;
}

/** Options for a single `exec` of a mutation inside the harness. */
export interface KovoTestExecOptions<Request> {
  csrf?: CsrfValidationOptions<Request>;
  request?: Partial<Omit<Request, 'db'>>;
  touchGraphKey?: string;
}

/**
 * Create a test harness around a database: run mutations and queries, load
 * pages, and—when given a touch graph and verification config—verify that
 * writes only touch the domains their mutations declared (SPEC §10.1, §11).
 *
 * @param options - The `db` plus optional pages, request stub, touch graph, and verification config.
 * @returns A `KovoTestContext` with `exec`/`query`/`page` helpers.
 */
export function createKovoTestHarness<Db>(
  options: KovoTestHarnessOptions<Db>,
): KovoTestContext<Db> {
  const verifier =
    options.touchGraph && options.verification
      ? createDbVerifier(
          options.touchGraph as CoreGraph.TouchGraph,
          options.verification as InternalDbVerificationConfig,
        )
      : null;
  const db = verifier ? (verifier.wrap(options.db) as Db) : options.db;

  return {
    db,
    dbHandle(): Db {
      return db;
    },
    async exec<
      InputSchema extends Schema<unknown>,
      Errors extends Record<string, Schema<unknown>>,
      Request extends { db: unknown },
      Value,
    >(
      mutation: MutationDefinition<string, InputSchema, Errors, Request, Value>,
      input: unknown,
      execOptions?: KovoTestExecOptions<Request>,
    ) {
      return executeHarnessMutation(mutation, input, db, options.request, verifier, execOptions);
    },
    async page(path) {
      return loadHarnessPage(options.pages, path, db, verifier);
    },
    async query(query, input) {
      return executeHarnessQuery(query, input, db, options.request, verifier);
    },
    verificationDiagnostics(): readonly DbVerificationDiagnostic[] {
      return verifier?.diagnostics() ?? [];
    },
  };
}
