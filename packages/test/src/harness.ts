import type { TouchGraph } from '@jiso/core';
import {
  type CsrfValidationOptions,
  type MutationDefinition,
  type MutationResult,
  type QueryDefinition,
  type Schema,
  runMutation,
} from '@jiso/server';
import { createPageAssertion, type PageAssertion } from './page.js';
import { createDbVerifier, diagnosticMessage } from './verifier.js';
import type { DbVerificationConfig, DbVerificationDiagnostic } from './verifier.js';

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

export interface JisoTestExecOptions<Request> {
  csrf?: CsrfValidationOptions<Request>;
  request?: Partial<Omit<Request, 'db'>>;
  touchGraphKey?: string;
}

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
      const request = {
        ...options.request,
        ...execOptions?.request,
        db,
      } as unknown as Request;

      if (!verifier) {
        const result = await runMutation(
          mutation,
          input,
          request,
          execOptions?.csrf === undefined ? {} : { csrf: execOptions.csrf },
        );
        return result;
      }

      const captured = await verifier.capture(async () => {
        const result = await runMutation(
          mutation,
          input,
          request,
          execOptions?.csrf === undefined ? {} : { csrf: execOptions.csrf },
        );
        return result;
      });
      verifier.assertCoveredOperations(captured.observed, execOptions?.touchGraphKey);
      const result = captured.result;
      return result;
    },
    async page(path) {
      const page = options.pages?.[path];
      if (!page) throw new Error(`Page fixture not found: ${path}`);

      const html = typeof page === 'function' ? await page() : page;
      return createPageAssertion(html);
    },
    async query(query, input) {
      if (!query.load) throw new Error(`Query fixture has no loader: ${query.key}`);

      const load = () =>
        query.load?.(input, {
          request: {
            ...options.request,
            db,
          },
        });
      const result = verifier
        ? await verifier.capture(load).then((captured) => {
            verifier.assertReadsCoveredOperations(
              captured.observed,
              query.reads.map((domain) => domain.key),
            );
            return captured.result;
          })
        : await load();
      if (query.output) {
        try {
          query.output.parse(result);
        } catch (error) {
          throw new Error(
            diagnosticMessage(
              'FW410',
              `${query.key} ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
        }
      }
      return result;
    },
    verificationDiagnostics(): readonly DbVerificationDiagnostic[] {
      return verifier?.diagnostics() ?? [];
    },
  };
}

export function jisoTest<Db>(
  name: string,
  fn: (ctx: JisoTestContext<Db>) => void | Promise<void>,
  options: JisoTestHarnessOptions<Db>,
  runner?: JisoTestRunner,
): JisoTestCase {
  const run = async () => {
    await fn(createJisoTestHarness(options));
  };

  runner?.(name, run);

  return {
    name,
    run,
  };
}

export type JisoTestRunner = (name: string, run: () => Promise<void>) => unknown;

export interface JisoTestCase {
  name: string;
  run(): Promise<void>;
}
