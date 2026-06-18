import type * as CoreGraph from '@kovojs/core/internal/graph';
import type { MutationDefinition, MutationResult, QueryDefinition, Schema } from '@kovojs/server';
import {
  executeHarnessMutation,
  executeHarnessQuery,
  type HarnessMutationOptions,
  loadHarnessPage,
} from './harness-operations.js';
import type { PageAssertion } from './page.js';
import { createDbVerifier } from './verifier.js';
import type { DbVerificationDiagnostic } from './verifier-diagnostics.js';
import type { DbVerificationConfig } from './verifier-observation.js';

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

export interface KovoTestRequest<Db> {
  db: Db;
}

/** Options for `createKovoTestHarness`: the `db`, optional `pages`, request stub, touch graph, and verification config. */
export interface KovoTestHarnessOptions<Db> {
  db: Db;
  pages?: Record<string, string | (() => string | Promise<string>)>;
  request?: Record<string, unknown>;
  touchGraph?: CoreGraph.TouchGraph;
  verification?: DbVerificationConfig;
}

/** Options for a single `exec` of a mutation inside the harness. */
export type KovoTestExecOptions<Request> = HarnessMutationOptions<Request>;

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
      ? createDbVerifier(options.touchGraph, options.verification)
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
      return loadHarnessPage(options.pages, path);
    },
    async query(query, input) {
      return executeHarnessQuery(query, input, db, options.request, verifier);
    },
    verificationDiagnostics(): readonly DbVerificationDiagnostic[] {
      return verifier?.diagnostics() ?? [];
    },
  };
}
