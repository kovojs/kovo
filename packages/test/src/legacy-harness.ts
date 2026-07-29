import type * as CoreGraph from '@kovojs/core/internal/graph';
import type { CsrfOptions } from '@kovojs/server/security';
import type { MutationDefinition, MutationResult, QueryDefinition, Schema } from '@kovojs/server';
import {
  kovoDeclaredWriteDbHandle,
  kovoReadonlyDbHandle,
} from '@kovojs/server/internal/managed-db';
import {
  executeHarnessMutation,
  executeHarnessQuery,
  type HarnessPageFixture,
  loadHarnessPage,
} from './harness-operations.js';
import type { PageAssertion } from './page.js';
import { createDbVerifier, type DbVerifier } from './verifier.js';
import type { DbVerificationDiagnostic } from './verifier-diagnostics.js';
import type { DbVerificationConfig as InternalDbVerificationConfig } from './verifier-observation.js';
import {
  createManagedTestFixtureDelegatingProxy,
  createManagedTestFixtureDispatchProxy,
} from './adapter-security.js';
import {
  verifierApply,
  verifierDefineProperty,
  verifierGetOwnPropertyDescriptor,
  verifierNullRecord,
  verifierTypeError,
} from './verifier-security-intrinsics.js';

/** @internal Compatibility harness retained only for low-level verifier regression tests. */
export interface LegacyKovoTestContext<Db = unknown> {
  db: Db;
  exec: <
    InputSchema extends Schema<unknown>,
    Errors extends Record<string, Schema<unknown>>,
    Request extends { db: unknown },
    Value,
  >(
    mutation: MutationDefinition<string, InputSchema, Errors, Request, Value>,
    input: unknown,
    options?: LegacyKovoTestExecOptions<Request>,
  ) => Promise<MutationResult<Value>>;
  page: (path: string) => Promise<PageAssertion>;
  query: (query: QueryDefinition, input?: unknown) => Promise<unknown>;
  verificationDiagnostics(): readonly DbVerificationDiagnostic[];
}

/** @internal */
export interface LegacyKovoTestHarnessOptions<Db> {
  db: Db;
  pages?: Record<string, HarnessPageFixture<Db>>;
  request?: Record<string, unknown>;
  touchGraph?: CoreGraph.TouchGraph;
  verification?: {
    domainByTable: Record<string, string>;
    exemptTables?: readonly string[];
    keyByTable?: Record<string, string>;
    sqlDialect?: 'postgres' | 'sqlite';
  };
}

/** @internal */
export interface LegacyKovoTestExecOptions<Request> {
  csrf?: CsrfOptions<Request>;
  request?: Partial<Omit<Request, 'db'>>;
  touchGraphKey?: string;
}

/** @internal Old names exist only on this private regression-test module. */
export type KovoTestContext<Db = unknown> = LegacyKovoTestContext<Db>;
/** @internal */
export type KovoTestHarnessOptions<Db> = LegacyKovoTestHarnessOptions<Db>;

/** @internal Low-level regression seam. Public app tests use `createKovoTestHarness(app, options)`. */
export function createLegacyKovoTestHarness<Db>(
  options: LegacyKovoTestHarnessOptions<Db>,
): LegacyKovoTestContext<Db> {
  const verifier =
    options.touchGraph && options.verification
      ? createDbVerifier(
          options.touchGraph,
          options.verification as InternalDbVerificationConfig,
        )
      : null;
  const db = verifier
    ? (verifier.wrap(options.db) as Db)
    : typeof options.db === 'object' && options.db !== null
      ? (createManagedTestFixtureDispatchProxy(options.db) as Db)
      : options.db;
  const mutationDb = verifier ? lifecycleMutationDb(options.db, db, verifier) : db;

  return {
    db,
    async exec<
      InputSchema extends Schema<unknown>,
      Errors extends Record<string, Schema<unknown>>,
      Request extends { db: unknown },
      Value,
    >(
      mutation: MutationDefinition<string, InputSchema, Errors, Request, Value>,
      input: unknown,
      execOptions?: LegacyKovoTestExecOptions<Request>,
    ) {
      return executeHarnessMutation(
        mutation,
        input,
        mutationDb,
        options.request,
        verifier,
        execOptions,
      );
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

/** @internal Old name exists only on this private regression-test module. */
export const createKovoTestHarness = createLegacyKovoTestHarness;

function lifecycleMutationDb<Db>(raw: Db, wrapped: Db, verifier: DbVerifier): Db {
  if (typeof raw !== 'object' || raw === null || typeof wrapped !== 'object' || wrapped === null) {
    return wrapped;
  }
  const shell = verifierNullRecord();
  let hasCapability = false;
  const bridgeCapability = (property: symbol): void => {
    const descriptor = verifierGetOwnPropertyDescriptor(raw, property);
    if (descriptor === undefined) return;
    if (!('value' in descriptor) || typeof descriptor.value !== 'function') {
      throw verifierTypeError('Harness DB capability hooks must be stable own data functions.');
    }
    const capability = descriptor.value;
    verifierDefineProperty(shell, property, {
      value: (...args: unknown[]) => verifier.wrap(verifierApply<unknown>(capability, raw, args)),
    });
    hasCapability = true;
  };
  bridgeCapability(kovoReadonlyDbHandle);
  bridgeCapability(kovoDeclaredWriteDbHandle);
  return hasCapability ? (createManagedTestFixtureDelegatingProxy(shell, wrapped) as Db) : wrapped;
}
