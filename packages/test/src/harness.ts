import type * as CoreGraph from '@kovojs/core/internal/graph';
import type { DiagnosticCode, RegisteredDiagnostic } from '@kovojs/core/diagnostics';
import type {
  InferSchema,
  MutationFail,
  MutationHandle,
  MutationSuccess,
  QueryHandle,
  RouteHandle,
  ValidationFailurePayload,
} from '@kovojs/server';
import { type InferKovoAppTypes, type KovoApp } from '@kovojs/server/custom-adapters';
import {
  kovoDeclaredWriteDbHandle,
  kovoReadonlyDbHandle,
} from '@kovojs/server/internal/managed-db-capabilities';
import { type CsrfOptions } from '@kovojs/server/security';
import { executeHarnessMutation, executeHarnessQuery } from './harness-operations.js';
import { loadKovoTestArtifact } from './harness-artifact.js';
import { createPageAssertion } from './page.js';
import { createDbVerifier, type DbVerifier } from './verifier.js';
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

/** Rendered page returned by {@link KovoTestContext.page}. */
export interface PageAssertion {
  /** Extract one named Kovo fragment from the full rendered response. */
  fragment(target: string): string;
  /** Full rendered response body. */
  html: string;
}

/** Graph-honesty diagnostic observed while a harness executes database operations. */
export interface DbVerificationDiagnostic extends RegisteredDiagnostic<DiagnosticCode> {
  /** Static branch label when the diagnostic is branch-specific. */
  branch?: string;
  /** Declared or observed application data domain. */
  domain: string;
  /** Authored source site when retained by build evidence. */
  site?: string;
}

/** Database contract retained by the imported opaque app. */
export type KovoTestDb<App extends KovoApp> =
  InferKovoAppTypes<App> extends { readonly db: infer Db } ? Db : never;

/** Request contract retained by the imported opaque app after provider inference. */
export type KovoTestRequest<App extends KovoApp> =
  InferKovoAppTypes<App> extends { readonly request: infer Request } ? Request : never;

/** Raw request contract accepted by the imported app's custom-adapter boundary. */
export type KovoTestRawRequest<App extends KovoApp> =
  InferKovoAppTypes<App> extends { readonly rawRequest: infer Request }
    ? Request
    : globalThis.Request;

/** Exact mutation-handle union assembled into the imported app. */
export type KovoTestMutation<App extends KovoApp> =
  InferKovoAppTypes<App> extends {
    readonly declarations: { readonly mutation: infer Mutation };
  }
    ? Mutation
    : never;

/** Exact query-handle union assembled into the imported app. */
export type KovoTestQuery<App extends KovoApp> =
  InferKovoAppTypes<App> extends {
    readonly declarations: { readonly query: infer Query };
  }
    ? Query
    : never;

/** Exact route-key union assembled into the imported app. */
export type KovoTestRouteKey<App extends KovoApp> =
  InferKovoAppTypes<App> extends {
    readonly declarations: { readonly route: infer Route };
  }
    ? Route extends RouteHandle<infer Path, infer _Params, infer _Request>
      ? Path
      : never
    : never;

/** Input inferred from one app-scoped mutation handle. */
export type KovoTestMutationInput<Mutation> =
  Mutation extends MutationHandle<
    infer Input,
    infer _Value,
    infer _Errors,
    infer _Request,
    infer _Optimistic
  >
    ? Input
    : never;

/** Successful value inferred from one app-scoped mutation handle. */
export type KovoTestMutationValue<Mutation> =
  Mutation extends MutationHandle<
    infer _Input,
    infer Value,
    infer _Errors,
    infer _Request,
    infer _Optimistic
  >
    ? Value
    : never;

/** Declared application-error union inferred from one app-scoped mutation handle. */
export type KovoTestMutationError<Mutation> =
  Mutation extends MutationHandle<
    infer _Input,
    infer _Value,
    infer Errors,
    infer _Request,
    infer _Optimistic
  >
    ? {
        [Code in Extract<keyof Errors, string>]: MutationFail<Code, InferSchema<Errors[Code]>>;
      }[Extract<keyof Errors, string>]
    : never;

/** Framework-owned mutation failures that can precede an app handler. */
export type KovoTestFrameworkMutationError =
  | MutationFail<'CSRF', Record<never, never>>
  | MutationFail<'RATE_LIMITED', unknown>
  | MutationFail<'STALE_VERSION', Record<never, never>>
  | MutationFail<'UNAUTHORIZED', unknown>
  | MutationFail<'VALIDATION', ValidationFailurePayload>;

/** Structured result inferred from one app-scoped mutation handle. */
export type KovoTestMutationResult<Mutation> =
  | KovoTestFrameworkMutationError
  | KovoTestMutationError<Mutation>
  | MutationSuccess<KovoTestMutationValue<Mutation>, KovoTestMutationInput<Mutation>>;

/** Input inferred from one app-scoped query handle. */
export type KovoTestQueryInput<Query> =
  Query extends QueryHandle<infer Input, infer _Value, infer _Request, infer _Delta>
    ? Input
    : never;

/** Result inferred from one app-scoped query handle. */
export type KovoTestQueryResult<Query> =
  Query extends QueryHandle<infer _Input, infer Value, infer _Request, infer _Delta>
    ? Awaited<Value>
    : never;

/** Runtime SQL-observation config; static graph facts always come from the verified artifact. */
export interface KovoTestVerificationConfig {
  domainByTable: Record<string, string>;
  exemptTables?: readonly string[];
  keyByTable?: Record<string, string>;
  sqlDialect?: 'postgres' | 'sqlite';
}

/** Explicit artifact and runtime fixtures for one imported app contract. */
export interface KovoTestHarnessOptions<App extends KovoApp> {
  /**
   * Exact successful-build graph to consume. Relative paths are rejected so tests cannot
   * accidentally trust a nearby artifact (SPEC §§5.2.4 and 12).
   */
  artifact: string | URL;
  /** Absolute project root used to re-hash every analyzed source/config input. */
  projectRoot: string | URL;
  /**
   * Explicit origin of a separately bootstrapped app used by `page()` and `request()`.
   * Direct `query()` and `exec()` tests do not require it.
   */
  baseUrl?: string | URL;
  /** Optional test DB whose type is inferred from the imported app contract. */
  db?: KovoTestDb<App>;
  /** Typed provider/request fixture merged into direct query and mutation execution. */
  request?: Partial<Omit<KovoTestRequest<App>, 'db'>>;
  /**
   * Runtime adapter mapping used by SQL observation. Touch/read facts cannot be supplied here;
   * those come only from the verified build graph.
   */
  verification?: KovoTestVerificationConfig;
}

/** Options for one direct app-scoped mutation execution. */
export interface KovoTestExecOptions<App extends KovoApp> {
  csrf?: CsrfOptions<KovoTestRequest<App>>;
  request?: Partial<Omit<KovoTestRequest<App>, 'db'>>;
}

/** App-scoped harness whose callable surface is inferred from one imported opaque app. */
export interface KovoTestContext<App extends KovoApp> {
  readonly db: KovoTestDb<App> | undefined;
  exec<Mutation extends KovoTestMutation<App>>(
    mutation: Mutation,
    input: KovoTestMutationInput<Mutation>,
    options?: KovoTestExecOptions<App>,
  ): Promise<KovoTestMutationResult<Mutation>>;
  page(path: KovoTestRouteKey<App>, init?: Omit<RequestInit, 'method'>): Promise<PageAssertion>;
  query<Query extends KovoTestQuery<App>>(
    query: Query,
    ...input: [KovoTestQueryInput<Query>] extends [undefined]
      ? [input?: undefined]
      : [input: KovoTestQueryInput<Query>]
  ): Promise<KovoTestQueryResult<Query>>;
  request(request: KovoTestRawRequest<App>): Promise<Response>;
  verificationDiagnostics(): readonly DbVerificationDiagnostic[];
}

/**
 * Create an app-scoped test harness.
 *
 * TypeScript obtains mutation/query/route/request/DB contracts from `app`; runtime coverage facts
 * come only from the explicitly selected, completion- and digest-verified build graph. A stale,
 * partial, failed-build, or wrong-app artifact rejects before the returned context can run one
 * handler (SPEC §§5.2.4, 11, and 12).
 */
export async function createKovoTestHarness<App extends KovoApp>(
  app: App,
  options: KovoTestHarnessOptions<App>,
): Promise<KovoTestContext<App>> {
  const artifact = await loadKovoTestArtifact(app, options.artifact, options.projectRoot);
  const verifier =
    options.verification === undefined
      ? null
      : createDbVerifier(artifact.touchGraph, options.verification as InternalDbVerificationConfig);
  const rawDb = options.db;
  const db =
    rawDb === undefined
      ? undefined
      : verifier
        ? (verifier.wrap(rawDb) as KovoTestDb<App>)
        : typeof rawDb === 'object' && rawDb !== null
          ? (createManagedTestFixtureDispatchProxy(rawDb) as KovoTestDb<App>)
          : rawDb;
  const mutationDb =
    rawDb === undefined || db === undefined
      ? undefined
      : verifier
        ? lifecycleMutationDb(rawDb, db, verifier)
        : db;
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const dispatch = (request: globalThis.Request): Promise<Response> =>
    dispatchWireRequest(request, baseUrl);
  const queryDomains = queryDomainMap(artifact.graph);

  return {
    db,
    async exec<Mutation extends KovoTestMutation<App>>(
      mutation: Mutation,
      input: KovoTestMutationInput<Mutation>,
      execOptions?: KovoTestExecOptions<App>,
    ): Promise<KovoTestMutationResult<Mutation>> {
      if (mutationDb === undefined) {
        throw new TypeError('Kovo harness exec() requires options.db.');
      }
      return executeHarnessMutation(
        mutation as never,
        input,
        mutationDb,
        options.request as Record<string, unknown> | undefined,
        verifier,
        {
          ...(execOptions?.csrf === undefined ? {} : { csrf: execOptions.csrf }),
          ...(execOptions?.request === undefined
            ? {}
            : { request: execOptions.request as Record<string, unknown> }),
          touchGraphKey: mutationKey(mutation),
        } as never,
      ) as Promise<KovoTestMutationResult<Mutation>>;
    },
    async page(path, init) {
      const request = new Request(new URL(path, requiredBaseUrl(baseUrl)), {
        ...init,
        method: 'GET',
      });
      const response = await dispatch(request);
      return createPageAssertion(await response.text());
    },
    async query<Query extends KovoTestQuery<App>>(
      query: Query,
      ...input: [KovoTestQueryInput<Query>] extends [undefined]
        ? [input?: undefined]
        : [input: KovoTestQueryInput<Query>]
    ): Promise<KovoTestQueryResult<Query>> {
      if (db === undefined) throw new TypeError('Kovo harness query() requires options.db.');
      const key = queryKey(query);
      return executeHarnessQuery(
        query as never,
        input[0],
        db,
        options.request as Record<string, unknown> | undefined,
        verifier,
        queryDomains.get(key),
      ) as Promise<KovoTestQueryResult<Query>>;
    },
    async request(request) {
      if (!(request instanceof Request)) {
        throw new TypeError('Kovo harness request() requires a Web-standard Request.');
      }
      return dispatch(request);
    },
    verificationDiagnostics(): readonly DbVerificationDiagnostic[] {
      return verifier?.diagnostics() ?? [];
    },
  };
}

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

function queryDomainMap(graph: CoreGraph.KovoCheckInput): Map<string, readonly string[]> {
  const result = new Map<string, readonly string[]>();
  for (const fact of graph.queries ?? []) result.set(fact.query, fact.domains);
  return result;
}

function mutationKey(value: unknown): string {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Kovo harness exec() requires an app-scoped mutation handle.');
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, 'key');
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    typeof descriptor.value !== 'string'
  ) {
    throw new TypeError('Kovo harness mutation handle has no stable derived key.');
  }
  return descriptor.value;
}

function queryKey(value: unknown): string {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Kovo harness query() requires an app-scoped query handle.');
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, 'key');
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    typeof descriptor.value !== 'string'
  ) {
    throw new TypeError('Kovo harness query handle has no stable derived key.');
  }
  return descriptor.value;
}

function normalizeBaseUrl(value: string | URL | undefined): URL | undefined {
  if (value === undefined) return undefined;
  const result = new URL(value);
  if (result.protocol !== 'http:' && result.protocol !== 'https:') {
    throw new TypeError('Kovo harness baseUrl must use http or https.');
  }
  result.pathname = '/';
  result.search = '';
  result.hash = '';
  return result;
}

function requiredBaseUrl(value: URL | undefined): URL {
  if (value === undefined) {
    throw new TypeError(
      'Kovo harness page() and request() require options.baseUrl for a separately bootstrapped app.',
    );
  }
  return value;
}

async function dispatchWireRequest(request: Request, baseUrl: URL | undefined): Promise<Response> {
  const origin = requiredBaseUrl(baseUrl);
  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== origin.origin) {
    throw new TypeError(
      `Kovo harness request origin ${requestUrl.origin} does not match options.baseUrl ${origin.origin}.`,
    );
  }
  return fetch(request);
}
