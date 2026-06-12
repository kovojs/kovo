import type { TouchGraph } from '@jiso/core';
import type { MutationDefinition, MutationResult, QueryDefinition, Schema } from '@jiso/server';
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

export interface JisoTestContext<Db = unknown> {
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
    options?: JisoTestExecOptions<Request>,
  ) => Promise<MutationResult<Value>>;
  page: (path: string) => Promise<PageAssertion>;
  query: (query: QueryDefinition, input?: unknown) => Promise<unknown>;
  verificationDiagnostics(): readonly DbVerificationDiagnostic[];
}

export interface JisoTestRequest<Db> {
  db: Db;
}

export interface JisoTestHarnessOptions<Db> {
  db: Db;
  pages?: Record<string, string | (() => string | Promise<string>)>;
  request?: Record<string, unknown>;
  touchGraph?: TouchGraph;
  verification?: DbVerificationConfig;
}

export type JisoTestExecOptions<Request> = HarnessMutationOptions<Request>;

export function createJisoTestHarness<Db>(
  options: JisoTestHarnessOptions<Db>,
): JisoTestContext<Db> {
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
      execOptions?: JisoTestExecOptions<Request>,
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
