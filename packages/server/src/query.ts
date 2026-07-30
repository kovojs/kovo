import { isSecret } from '@kovojs/core/security';
import { type JsonValue } from '@kovojs/core';
import { wireEmitter } from '@kovojs/core/internal/security-markers';
import { canonicalQueryInstanceKeyValue } from '@kovojs/core/internal/wire-input-grammar';
import { reportServerError } from './diagnostics.js';
import {
  snapshotSharedCacheInfluenceDeclaration,
  type SharedCacheInfluenceDeclaration,
} from './cache-influence.js';
import type { Domain } from './domain.js';
import { snapshotGuardArgsReceipt } from './guard-args-receipt.js';
import {
  accessDecisionFor,
  assertUnambiguousAccessDeclaration,
  pinAccessDecision,
  type AccessDecision,
} from './access.js';
import {
  guardFailureIsUnauthenticated,
  guardFailureToResult,
  renderHttpGuardFailureResponse,
  runAccessDecisionGuards,
  withGuardArgs,
  type GuardFailureResponseOptions,
  type GuardResult,
  type RequestLifecycleOptions,
  type ResolvedGuardFailure,
} from './guards.js';
import { resolveKovoLifecycleRequest } from './response-posture.js';
import { principalPostureFromRequest } from './auth-principal.js';
import { registeredCacheInfluenceForRoot } from './generated-cache-influence-registry.js';
import {
  createAuthorityNeutralAbortSignal,
  isNativeAbortSignal,
  isNativeRequest,
} from './request-carrier.js';
import { currentRequestDeadlineSignal } from './request-deadline.js';
import {
  blessRedirectResponse,
  isBlessedRedirectResponse,
  isHeaderSource,
  frameworkWireBody,
  mergeResponseHeaders,
  readHeader,
  retryAfterHeaders,
  type FrameworkWireBody,
  type ResponseHeaders,
  type ServerResponseBase,
} from './response.js';
import {
  entriesToRecord,
  inheritSchemaRuntimeMetadata,
  isSchemaValidationError,
  schemaObjectFieldNames,
  snapshotSchemaForRuntime,
  type Schema,
  type SchemaValidationErrorLike,
  type ValidationFailurePayload,
} from './schema.js';
import { renderQueryWireHtml } from './wire-html.js';
import type { Reader } from './managed-db.js';
import { tagUntrustedRequestValue } from './untrusted-request-body.js';
import { denseOwnRegistryEntryByExactKey } from './registry-lookup.js';
import {
  requestIsUrlSearchParams,
  requestHeader,
  requestSerializeUrlSearchParamsEntries,
  requestUrlSearchParamsEntries,
} from './request-body-intrinsics.js';
import {
  securityEncodeURIComponent,
  securityArrayJoin,
  securityArraySort,
  securityRegExpTest,
  securityString,
  securityStringIndexOf,
  securityStringSlice,
  securityStringTrim,
} from './response-security-intrinsics.js';
import {
  createWitnessWeakMap,
  witnessCreateNullRecord,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessGetPrototypeOf,
  witnessIsArray,
  witnessObjectIs,
  witnessObjectKeys,
  witnessOwnKeys,
  witnessReflectApply,
  witnessSetHas,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';

const DEFAULT_QUERY_LIST_ITEMS = 100;
const MAX_QUERY_RESULT_DEPTH = 64;
const MAX_QUERY_RESULT_NODES = 100_000;
const MAX_QUERY_RESULT_ESTIMATED_BYTES = 4 * 1_024 * 1_024;
const MAX_QUERY_BIGINT_MAGNITUDE = 10n ** 4_096n;
const queryRuntimeWarningsByRequest = createWitnessWeakMap<object, QueryRuntimeWarning[]>();
const queryIteratorSymbol: typeof Symbol.iterator = Symbol.iterator;
const intrinsicArrayPrototype = witnessGetPrototypeOf([]);
const intrinsicObjectPrototype = witnessGetPrototypeOf({});

/** Explicit cache posture for proven public, session-independent typed reads (SPEC §9.4). */
export interface QueryReadConfig {
  /** Compiler-reviewed inputs and version-key obligations for an explicitly public response. */
  cacheInfluence?: SharedCacheInfluenceDeclaration;
  cacheControl?: string;
}

/**
 * The context a query's `load` receives: the current request value plus the framework-owned
 * read-only managed db handle (SPEC §9.4 KV433 Stage 1 / §10.3). The framework threads `db` as a
 * `Reader<Db>` — the SQL-safe (KV422) managed handle with the write verbs
 * (insert/update/delete/execute/run/batch) removed at the type level (mirroring the runtime proxy
 * that throws `KovoReadonlyHandleError`). A loader destructures `{ db }` and reads through it; a
 * write in a loader is a `tsc` error, a runtime throw, AND a KV433 static-gate error.
 */
export type QueryLoadContext<Request = unknown, Db = never, Env = never> = ([
  [Db] extends [never] ? (Request extends { db: infer RequestDb } ? RequestDb : never) : Reader<Db>,
] extends [never]
  ? { db?: never }
  : {
      db: [Db] extends [never]
        ? Request extends { db: infer RequestDb }
          ? RequestDb
          : never
        : Reader<Db>;
    }) & {
  request: Request;
  signal: AbortSignal;
} & (Request extends { session: infer Session } ? { session: Session } : { session?: never }) &
  ([
    [Env] extends [never]
      ? Request extends { env: infer RequestEnv }
        ? Readonly<RequestEnv>
        : never
      : Readonly<Env>,
  ] extends [never]
    ? { env?: never }
    : {
        env: [Env] extends [never]
          ? Request extends { env: infer RequestEnv }
            ? Readonly<RequestEnv>
            : never
          : Readonly<Env>;
      });

/** @internal */
export interface QueryEndpointRequest<
  Request = unknown,
  SessionValue = unknown,
> extends GuardFailureResponseOptions<Request, SessionValue, unknown, unknown> {
  /**
   * Optional build token (SPEC §5.2.1 rule 2(d), §9.4): when present, stamped
   * as a `Kovo-Build` response header on every typed-read response so a plain
   * refetch into a stale tab is detectable by the client.
   */
  buildToken?: string;
  /** @internal Framework-classified `Kovo-Fragment` typed-read delivery. */
  enhanced?: true;
  /** @internal SPEC §9.5 API4 resource-consumption floor for query/list result sinks. */
  maxListItems?: number;
  request: Request;
  search?: QuerySearchInput;
}

/** @internal */
export type QuerySearchInput =
  | URLSearchParams
  | Iterable<readonly [string, string]>
  | Record<string, readonly string[] | string | undefined>;

/** @internal */
export interface QueryEndpointResponse extends ServerResponseBase<
  FrameworkWireBody,
  ResponseHeaders,
  200 | 303 | 401 | 403 | 404 | 422 | 429 | 500
> {}

/** @internal */
export interface QueryEndpointRegistry<Request = unknown> {
  queries: readonly QueryDefinition<string, unknown, unknown, Request>[];
}

const UNASSIGNED_DERIVED_QUERY_KEY = '\0kovo:unassigned-query-key';

/** The shape of a query: its key, `load`, `reads` domains, and optional args/output/guard/version. */
export interface QueryDefinition<
  Key extends string = string,
  Value = JsonValue,
  Input = unknown,
  Request = unknown,
> {
  access?: AccessDecision;
  args?: Schema<Input>;
  /**
   * Delta-eligible collections for this query. When present, the server can
   * emit a change-record-scoped delta (SPEC §9.1.1) instead of the full value
   * when the delta is smaller. The compiler populates this; framework/test code
   * may set it directly.
   */
  delta?: readonly { domain: string; key: string; path: string }[];
  guard?: {
    call(request: Request): GuardResult | Promise<GuardResult>;
  }['call'];
  instanceKey?: QueryInstanceKey<Input>;
  load?(
    input: Input,
    context: {
      request: Request;
      signal: AbortSignal;
    } & (Request extends { db: infer RequestDb } ? { db: RequestDb } : { db?: never }) &
      (Request extends { session: infer Session } ? { session: Session } : { session?: never }) &
      (Request extends { env: infer RequestEnv } ? { env: Readonly<RequestEnv> } : { env?: never }),
  ): Promise<Value> | Value;
  key: Key;
  output?: Schema<Value>;
  read?: QueryReadConfig;
  reads?: readonly Domain[];
  version?: ((input: Input, value: Value) => number | string | undefined) | number | string;
}

/** Compute or declare a stable per-input query instance key (SPEC §9.4/§10.2). */
export type QueryInstanceKey<Input> = ((input: Input) => string | undefined) | string;

/** A query input schema that also binds component props to query args in app-authored TSX. */
export type QueryArgsSchema<Input> = Schema<Input> & {
  <Props extends object = any>(mapper: (props: Props) => Input): QueryArgsBinding<Input, Props>;
};

export interface QueryArgsBinding<Input, Props extends object> {
  args: (props: Props) => Input;
  query: QueryDefinition<string, unknown, Input, unknown>;
  schema: Schema<Input>;
}

type QueryWithArgsBinding<Definition, Input> = Omit<Definition, 'args'> & {
  args: QueryArgsSchema<Input>;
};

/**
 * Rest-parameter guard used by {@link query} and {@link QueryFactory} overloads.
 * It preserves ordinary inference for valid query definitions while making unknown
 * no-op fields a TypeScript error (SPEC §9.3/§10.2).
 */
export type QueryDefinitionBoundary<Definition, Shape> =
  Exclude<keyof Definition, keyof Shape> extends never
    ? 'access' | 'guard' extends keyof Definition
      ? [
          __kovoQueryAccessBoundary: {
            readonly __kovoQueryAccessBoundary: 'query() cannot declare both access and guard; choose exactly one access decision';
          },
        ]
      : 'load' extends keyof Definition
        ? Definition extends { load?: (...args: any[]) => infer Result }
          ? Awaited<Result> extends JsonValue
            ? []
            : [
                __kovoQueryJsonBoundary: QueryJsonBoundaryErrorUseJsonbTypeOrSRecord<
                  Awaited<Result>
                >,
              ]
          : [__kovoQueryJsonBoundary: QueryJsonBoundaryErrorUseJsonbTypeOrSRecord<unknown>]
        : []
    : [__kovoQueryDefinitionBoundary: QueryUnknownDefinitionFieldError<Definition, Shape>];

/** Type-level diagnostic payload for a `query()` load result that is not JSON-serializable. */
export type QueryJsonBoundaryErrorUseJsonbTypeOrSRecord<Result> = {
  readonly __kovoQueryJsonBoundary: 'query() load result must be JSON-serializable; annotate Drizzle json/jsonb columns with .$type<...>() or declare output: s.record(...)';
  readonly result: Result;
};

/** Type-level diagnostic payload for unsupported no-op fields on `query()` definitions. */
export type QueryUnknownDefinitionFieldError<Definition, Shape> = {
  readonly __kovoQueryDefinitionBoundary: 'query() definition contains unsupported field(s)';
  readonly fields: Exclude<keyof Definition, keyof Shape>;
};

/** Preserve authored object inference while intersecting query boundary guardrails. */
export type PreserveDefinitionInference<Definition> = Definition & {
  readonly __kovoDefinitionInference?: (definition: Definition) => Definition;
};

/** Rest-parameter-compatible guard that turns invalid `query()` definitions into readable errors. */
export type QueryDefinitionParameterBoundary<Definition, Shape> =
  QueryDefinitionBoundary<Definition, Shape> extends []
    ? unknown
    : QueryDefinitionBoundary<Definition, Shape>[0];

/** @internal */
export interface RegisteredQueryDefinition {
  access?: AccessDecision;
  args?: Schema<unknown>;
  /**
   * Delta-eligible collections for this query (SPEC §9.1.1). The compiler
   * populates this; framework/test code may set it directly.
   */
  delta?: readonly { domain: string; key: string; path: string }[];
  guard?: {
    call(request: unknown): GuardResult | Promise<GuardResult>;
  }['call'];
  instanceKey?: ((input: unknown) => string | undefined) | string;
  key: string;
  load?: {
    call(...args: any[]): unknown;
  }['call'];
  output?: Schema<unknown>;
  read?: QueryReadConfig;
  reads?: readonly Domain[];
  version?:
    | {
        call(input: unknown, value: unknown): number | string | undefined;
      }['call']
    | number
    | string;
}

/**
 * Definition object passed to `query()` before the stable key is attached (SPEC §10.2).
 * Query load values are checked against the public JSON boundary by `query()`.
 */
export interface QueryDeclarationDefinition<Request = unknown, Value = JsonValue> {
  access?: AccessDecision;
  args?: Schema<unknown>;
  /**
   * Delta-eligible collections for this query (SPEC §9.1.1). The compiler
   * populates this; framework/test code may set it directly.
   */
  delta?: readonly { domain: string; key: string; path: string }[];
  guard?: {
    call(request: Request): GuardResult | Promise<GuardResult>;
  }['call'];
  instanceKey?: ((input: unknown) => string | undefined) | string;
  load?: {
    call(
      input: any,
      context?: {
        request: Request;
        signal: AbortSignal;
      } & (Request extends { db: infer RequestDb } ? { db: RequestDb } : { db?: never }) &
        (Request extends { session: infer Session } ? { session: Session } : { session?: never }) &
        (Request extends { env: infer RequestEnv }
          ? { env: Readonly<RequestEnv> }
          : { env?: never }),
    ): Value | Promise<Value>;
  }['call'];
  output?: Schema<Value>;
  read?: QueryReadConfig;
  reads?: readonly Domain[];
  version?: ((input: any, value: any) => number | string | undefined) | number | string;
}

/** Public structural shape used by `query()` and app-scoped query factories for boundary checks. */
export type QueryDeclarationBoundaryShape<Request = unknown> = Omit<
  QueryDeclarationDefinition<Request, unknown>,
  'load' | 'output'
> & {
  load?: Function;
  output?: Schema<unknown>;
};

/** App-scoped query factory. `createApp()` uses this to contextually type query callbacks from configured request providers (SPEC §9.5/§10.2). */
export interface QueryFactory<Request = unknown> {
  <
    ContextRequest extends Request = Request,
    const Definition extends object = QueryDeclarationBoundaryShape<ContextRequest>,
  >(
    definition: PreserveDefinitionInference<Definition> &
      QueryDefinitionParameterBoundary<Definition, QueryDeclarationBoundaryShape<ContextRequest>>,
  ): Definition extends { args: Schema<infer Input> }
    ? QueryWithArgsBinding<Definition, Input> & { key: string; reads: readonly Domain[] }
    : Definition & { key: string; reads: readonly Domain[] };
}

/**
 * Declare a typed read. App-authored queries use object form and the compiler derives the stable
 * registry key from the exported binding plus module path (SPEC §4.1/§10.2). The read set is the
 * entire invalidation declaration: when a mutation touches a domain in `reads`, this query reruns.
 * Optional `args` validate inputs, `output` validates results, and `version`/`instanceKey` control
 * caching identity.
 *
 * @param definition - `load`, `reads`, and optional `args`/`output`/`guard`/`version`.
 * @returns A query definition that receives its stable key from compiler-emitted metadata.
 * @example
 * import { domain, query } from '@kovojs/server';
 *
 * export const product = domain();
 *
 * export const productsQuery = query({
 *   load: () => ({ items: [] as { id: string }[] }),
 *   reads: [product],
 * });
 */
export function query<const Definition extends Omit<QueryDefinition<string, any, any, any>, 'key'>>(
  definition: Definition &
    (Exclude<
      keyof Definition,
      keyof Omit<QueryDefinition<string, any, any, any>, 'key'>
    > extends never
      ? 'access' | 'guard' extends keyof Definition
        ? {
            readonly __kovoQueryAccessBoundary: 'query() cannot declare both access and guard; choose exactly one access decision';
          }
        : Definition extends { load?: (...args: any[]) => infer Result }
          ? Awaited<Result> extends JsonValue
            ? unknown
            : {
                readonly __kovoQueryJsonBoundary: 'query() load result must be JSON-serializable; annotate Drizzle json/jsonb columns with .$type<...>() or declare output: s.record(...)';
              }
          : unknown
      : {
          readonly __kovoQueryDefinitionBoundary: 'query() definition contains unsupported field(s)';
        }),
): Definition extends { args: Schema<infer Input> }
  ? Omit<Definition, 'args'> & {
      args: Schema<Input> & {
        <Props extends object = any>(
          mapper: (props: Props) => Input,
        ): {
          args: (props: Props) => Input;
          query: QueryDefinition<string, unknown, Input, unknown>;
          schema: Schema<Input>;
        };
      };
      key: string;
      reads: readonly Domain[];
    }
  : Definition & { key: string; reads: readonly Domain[] };
export function query<
  const Key extends string,
  const Definition extends Omit<QueryDefinition<string, any, any, any>, 'key'>,
>(
  key: Key,
  definition: Definition &
    (Exclude<
      keyof Definition,
      keyof Omit<QueryDefinition<string, any, any, any>, 'key'>
    > extends never
      ? 'access' | 'guard' extends keyof Definition
        ? {
            readonly __kovoQueryAccessBoundary: 'query() cannot declare both access and guard; choose exactly one access decision';
          }
        : Definition extends { load?: (...args: any[]) => infer Result }
          ? Awaited<Result> extends JsonValue
            ? unknown
            : {
                readonly __kovoQueryJsonBoundary: 'query() load result must be JSON-serializable; annotate Drizzle json/jsonb columns with .$type<...>() or declare output: s.record(...)';
              }
          : unknown
      : {
          readonly __kovoQueryDefinitionBoundary: 'query() definition contains unsupported field(s)';
        }),
): Definition extends { args: Schema<infer Input> }
  ? Omit<Definition, 'args'> & {
      args: Schema<Input> & {
        <Props extends object = any>(
          mapper: (props: Props) => Input,
        ): {
          args: (props: Props) => Input;
          query: QueryDefinition<string, unknown, Input, unknown>;
          schema: Schema<Input>;
        };
      };
      key: Key;
      reads: readonly Domain[];
    }
  : Definition & { key: Key; reads: readonly Domain[] };
export function query(
  keyOrDefinition: string | object,
  maybeDefinition?: unknown,
  ..._jsonBoundary: unknown[]
): unknown {
  const [key, definition] =
    typeof keyOrDefinition === 'string'
      ? [keyOrDefinition, maybeDefinition as Omit<RegisteredQueryDefinition, 'key'> | undefined]
      : [UNASSIGNED_DERIVED_QUERY_KEY, keyOrDefinition as Omit<RegisteredQueryDefinition, 'key'>];
  if (!definition) {
    throw new TypeError('query() requires a definition object.');
  }
  return buildQueryDefinition(key, definition);
}

function buildQueryDefinition<const Key extends string>(
  key: Key,
  definition: Omit<RegisteredQueryDefinition, 'key'>,
): unknown {
  const closedDefinition = snapshotQueryDefinition(definition);
  assertKnownQueryDefinitionKeys(closedDefinition);
  const queryDefinition = pinAccessDecision(
    {
      ...closedDefinition,
      key,
      reads: closedDefinition.reads ?? [],
    },
    closedDefinition.access,
  );
  if (!closedDefinition.args) return queryDefinition;

  witnessDefineProperty(queryDefinition, 'args', {
    configurable: true,
    enumerable: true,
    value: queryArgsSchema(
      closedDefinition.args,
      queryDefinition as QueryDefinition<string, unknown, unknown, unknown>,
    ),
    writable: true,
  });
  return queryDefinition;
}

function snapshotQueryDefinition(
  source: Omit<RegisteredQueryDefinition, 'key'>,
): Omit<RegisteredQueryDefinition, 'key'> {
  if (typeof source !== 'object' || source === null || witnessIsArray(source)) {
    throw new TypeError('query() requires a stable own-data definition object.');
  }
  assertUnambiguousAccessDeclaration(source, 'query() definition');
  const keys = witnessOwnKeys(source);
  if (keys.length > 100_000) throw new TypeError('query() definition must be bounded.');
  const snapshot = witnessCreateNullRecord<unknown>();
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (typeof key !== 'string') continue;
    const before = witnessGetOwnPropertyDescriptor(source, key);
    const after = witnessGetOwnPropertyDescriptor(source, key);
    if (
      before === undefined ||
      after === undefined ||
      !('value' in before) ||
      !('value' in after)
    ) {
      throw new TypeError(`query() definition.${key} must be an own data property.`);
    }
    if (!witnessObjectIs(before.value, after.value)) {
      throw new TypeError(`query() definition.${key} changed during validation.`);
    }
    witnessDefineProperty(snapshot, key, {
      configurable: true,
      enumerable: before.enumerable === true,
      value: before.value,
      writable: true,
    });
  }
  const readDescriptor = witnessGetOwnPropertyDescriptor(snapshot, 'read');
  if (
    readDescriptor !== undefined &&
    'value' in readDescriptor &&
    readDescriptor.value !== undefined
  ) {
    witnessDefineProperty(snapshot, 'read', {
      configurable: true,
      enumerable: readDescriptor.enumerable === true,
      value: snapshotQueryReadConfig(readDescriptor.value),
      writable: true,
    });
  }
  return snapshot as Omit<RegisteredQueryDefinition, 'key'>;
}

function snapshotQueryReadConfig(value: unknown): QueryReadConfig {
  if (value === null || typeof value !== 'object' || witnessIsArray(value)) {
    throw new TypeError('query().read must be a stable own-data record.');
  }
  const keys = witnessOwnKeys(value);
  const snapshot = witnessCreateNullRecord<unknown>();
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (key !== 'cacheControl' && key !== 'cacheInfluence') {
      throw new TypeError(`Unknown query().read field "${String(key)}".`);
    }
    const descriptor = witnessGetOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError(`query().read.${String(key)} must be an own data property.`);
    }
    if (key === 'cacheControl') {
      if (typeof descriptor.value !== 'string' || securityStringTrim(descriptor.value) === '') {
        throw new TypeError('query().read.cacheControl must be a non-empty string.');
      }
      snapshot.cacheControl = descriptor.value;
    } else if (descriptor.value !== undefined) {
      snapshot.cacheInfluence = snapshotSharedCacheInfluenceDeclaration(descriptor.value);
    }
  }
  return witnessFreeze(snapshot) as unknown as QueryReadConfig;
}

/**
 * @internal Compiler-emitted/generated ABI for SPEC §4.1 source-derived query identities.
 *
 * Runtime-only `query({ ... })` cannot know the source module path or exported binding. Generated
 * modules call this after evaluating an exported query declaration so every downstream wire surface
 * (`/_q/<key>`, `<kovo-query name>`, `kovo-deps`, and query stores) observes the derived key.
 */
export function assignDerivedQueryKey<Query extends { key: string }>(
  definition: Query,
  key: string,
): Query {
  if (!key) {
    throw new TypeError('assignDerivedQueryKey() requires a non-empty query key.');
  }
  if (definition.key !== UNASSIGNED_DERIVED_QUERY_KEY && definition.key !== key) {
    throw new TypeError(
      `Cannot assign derived query key "${key}" to query already keyed as "${definition.key}".`,
    );
  }
  definition.key = key;
  return definition;
}

/** @internal */
export function queryHasDerivedKey(definition: QueryDefinition<string, any, any, any>): boolean {
  return definition.key !== UNASSIGNED_DERIVED_QUERY_KEY;
}

const queryDefinitionKeys = new Set<PropertyKey>([
  'access',
  'args',
  'delta',
  'guard',
  'instanceKey',
  'load',
  'output',
  'read',
  'reads',
  'version',
]);

function assertKnownQueryDefinitionKeys(definition: object): void {
  const keys = witnessOwnKeys(definition);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (witnessSetHas(queryDefinitionKeys, key)) continue;
    throw new TypeError(
      `Unknown query() definition field "${String(key)}". Supported fields are ${[
        ...queryDefinitionKeys,
      ]
        .map(String)
        .sort()
        .join(', ')}.`,
    );
  }
}

/** Extract the resolved value type a query's `load` produces. */
export type QueryResult<Query> = Query extends { load: (...args: never[]) => infer Value }
  ? Awaited<Value>
  : unknown;

/**
 * Execute a query against raw input and a request, returning a typed result
 * without rendering a wire response. Parses `args`, runs the guard, calls
 * `load`, and validates `output`. Use the render helpers for HTTP; use this for
 * the structured result directly, e.g. in tests (SPEC §10.2).
 *
 * @param definition - The query to run.
 * @param rawInput - Unparsed input for the query's `args`.
 * @param request - The per-request value passed to `load`.
 * @param options - Optional session provider and error hook.
 * @returns A `QueryEndpointResult`: a success with the value, or a typed failure.
 * @internal
 */
export async function runQuery<const Key extends string, Value, Input, Request>(
  definition: QueryDefinition<Key, Value, Input, Request>,
  rawInput: unknown,
  request: Request,
  options: RequestLifecycleOptions<Request> & { trustedInput?: boolean } = {},
): Promise<QueryEndpointResult<Value, Input>> {
  const argsResult = parseQueryInput(definition, rawInput, options.trustedInput === true);
  if (!argsResult.ok) return argsResult.failure;
  const input =
    definition.args === undefined ? argsResult.value : snapshotGuardArgsReceipt(argsResult.value);

  // SPEC §9.4/§10.3 (MARQUEE): the framework owns the handle threaded into the loader. A
  // `query()` loader always runs in read mode (KV433 read-only proxy); writes belong in
  // mutation/domain/endpoint surfaces, not GET-backed reads.
  const resolvedRequest = await resolveKovoLifecycleRequest(request, {
    ...(options.clientIp === undefined ? {} : { clientIp: options.clientIp }),
    ...(options.db === undefined ? {} : { db: options.db }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    ...(options.principalPosture === undefined
      ? {}
      : { principalPosture: options.principalPosture }),
    ...(options.sessionProvider === undefined ? {} : { sessionProvider: options.sessionProvider }),
    surface: 'query',
  });
  // SPEC §10.3:1155-1157 ("Guards (arg-aware, normative)") + §9.4: thread the query's *validated*
  // args onto the request BEFORE the guard chain so an ownership guard (`guards.owns` reading
  // `req.args`) can authorize a client-visible key and discharge KV414 — without this merge
  // `keyOf(request)` reads `undefined` and a key-ignoring predicate authorizes everyone (IDOR).
  // Only on the validated path (a declared `args` schema, parsed above); a query without args never
  // fabricates an unvalidated `req.args`. The loader/guard then see the same coerced values.
  const lifecycleRequest =
    definition.args === undefined
      ? resolvedRequest
      : (withGuardArgs(resolvedRequest, input) as typeof resolvedRequest);
  const guardFailure = await runAccessDecisionGuards(
    accessDecisionFor(definition),
    definition.guard,
    lifecycleRequest,
  );
  if (guardFailure) {
    return guardFailureToResult(guardFailure);
  }

  // The framework-owned managed handle is installed on `lifecycleRequest.db` by
  // `resolveLifecycleRequest` (read-only proxy for a loader). Thread it onto the loader context as
  // `context.db` so loaders destructure `{ db }` from the framework
  // instead of bringing their own (the breaking change). When no `db` provider is configured the
  // field is simply absent, preserving today's behavior for db-less queries.
  const threadedDb = (lifecycleRequest as { db?: unknown }).db;
  const requestContext = lifecycleRequest as {
    env?: unknown;
    session?: unknown;
    signal?: unknown;
  };
  const requestSignal = requestContext.signal;
  const loadContext = {
    request: lifecycleRequest,
    ...(threadedDb === undefined ? {} : { db: threadedDb }),
    ...(requestContext.env === undefined ? {} : { env: requestContext.env }),
    ...(requestContext.session === undefined ? {} : { session: requestContext.session }),
    signal:
      currentRequestDeadlineSignal() ??
      (isNativeAbortSignal(requestSignal) ? requestSignal : createAuthorityNeutralAbortSignal()),
  } as Parameters<NonNullable<typeof definition.load>>[1];
  const value = definition.load ? await definition.load(input, loadContext) : (null as Value);
  const outputResult = parseQueryOutput(definition, value);
  if (!outputResult.ok) return outputResult.failure;
  const capped = capQueryListResults(
    outputResult.value,
    options.maxListItems ?? DEFAULT_QUERY_LIST_ITEMS,
  );

  return {
    input,
    ok: true,
    value: capped.value as Value,
    ...(capped.warnings.length === 0 ? {} : { warnings: capped.warnings }),
  };
}

/** @internal */
export type QueryEndpointResult<Value, Input = unknown> =
  | QueryEndpointSuccess<Value, Input>
  | QueryEndpointFailure;

/** @internal */
export interface QueryEndpointSuccess<Value, Input = unknown> {
  input: Input;
  ok: true;
  value: Value;
  warnings?: readonly QueryRuntimeWarning[];
}

/** @internal Runtime warning emitted by the shared query execution chokepoint. */
export interface QueryRuntimeWarning {
  code: 'QUERY_LIST_LIMIT';
  limit: number;
  path: string;
}

/** @internal Record query-runtime warnings on the lifecycle request for SSR/wire responses. */
export function recordQueryRuntimeWarnings(
  request: unknown,
  warnings: readonly QueryRuntimeWarning[] | undefined,
): void {
  if (warnings === undefined || warnings.length === 0) return;
  if (typeof request !== 'object' || request === null) return;
  const target = request as object;
  const existing = witnessWeakMapGet(queryRuntimeWarningsByRequest, target);
  if (existing === undefined) {
    const snapshot: QueryRuntimeWarning[] = [];
    appendQueryWarnings(snapshot, warnings);
    witnessWeakMapSet(queryRuntimeWarningsByRequest, target, snapshot);
    return;
  }
  appendQueryWarnings(existing, warnings);
}

/** @internal Read query-runtime warnings recorded on a lifecycle request. */
export function queryRuntimeWarningsFromRequest(request: unknown): readonly QueryRuntimeWarning[] {
  if (typeof request !== 'object' || request === null) return [];
  return witnessWeakMapGet(queryRuntimeWarningsByRequest, request) ?? [];
}

/** @internal */
export interface QueryEndpointFailure {
  auth?: ResolvedGuardFailure['auth'];
  error: {
    code: 'KV410' | 'RATE_LIMITED' | 'UNAUTHORIZED' | 'VALIDATION';
    payload: Record<string, unknown> | ValidationFailurePayload;
  };
  ok: false;
  retryAfter?: number;
  status: 422 | 429 | 500;
}

/**
 * Run a query and render its HTTP endpoint response (the typed-read endpoint of
 * SPEC §9.4): a JSON body with caching headers, or a guard-failure response.
 *
 * @param definition - The query to run.
 * @param endpointRequest - The request plus optional search input and guard-failure options.
 * @returns A `QueryEndpointResponse` (status, headers, JSON body).
 * @internal
 */
export const renderQueryEndpointResponse = wireEmitter(
  'server.wire.query-endpoint',
  async function <const Key extends string, Value, Input, Request>(
    definition: QueryDefinition<Key, Value, Input, Request>,
    endpointRequest: QueryEndpointRequest<Request>,
  ): Promise<QueryEndpointResponse> {
    let searchEntries: readonly QuerySearchEntry[] = [];
    let result: QueryEndpointResult<Value, Input>;
    let lifecycleRequest: Request = endpointRequest.request;
    try {
      searchEntries = snapshotQuerySearchInputEntries(endpointRequest.search ?? {});
      if (definition.args === undefined && searchEntries.length > 0) {
        // SPEC §9.4/§10.2: /_q/ input is rejected unless an args schema owns its grammar.
        // Do this before lifecycle providers or guards so unvalidated query data cannot trigger
        // authority-bearing work and an argsless endpoint never receives a tagged search record.
        result = querySearchWithoutArgsSchemaFailure();
      } else {
        const rawInput = tagUntrustedRequestValue(querySearchInputToRecord(searchEntries));
        lifecycleRequest = await resolveKovoLifecycleRequest(endpointRequest.request, {
          ...(endpointRequest.clientIp === undefined ? {} : { clientIp: endpointRequest.clientIp }),
          ...(endpointRequest.db === undefined ? {} : { db: endpointRequest.db }),
          ...(endpointRequest.env === undefined ? {} : { env: endpointRequest.env }),
          ...(endpointRequest.onError === undefined ? {} : { onError: endpointRequest.onError }),
          ...(endpointRequest.sessionProvider === undefined
            ? {}
            : { sessionProvider: endpointRequest.sessionProvider }),
          surface: 'query',
        });
        result = await runQuery(
          definition,
          rawInput,
          lifecycleRequest,
          endpointRequest.maxListItems === undefined
            ? {}
            : { maxListItems: endpointRequest.maxListItems },
        );
      }
    } catch (error) {
      reportServerError(endpointRequest.onError, error, {
        operation: 'query-endpoint',
        queryKey: definition.key,
        request: lifecycleRequest,
      });
      // SPEC §9.4:895: the private, no-store cache posture applies to every /_q/ response,
      // including error responses, so a shared/intermediary cache cannot store and replay
      // any response (even an anon 403) to a different user.
      return {
        body: frameworkWireBody(JSON.stringify(serverErrorPayload())),
        headers: queryJsonHeaders(endpointRequest),
        status: 500,
      };
    }

    if (!result.ok) {
      // SPEC §9.4: an enhanced typed read cannot redirect inside Fetch. Return an exact,
      // non-redirecting denial so the browser can retire stale private query truth and recover by
      // loading the native route, which then owns the ordinary login redirect. Native /_q/
      // navigation retains the §6.5 303 contract.
      if (
        endpointRequest.enhanced === true &&
        guardFailureIsUnauthenticated(result, lifecycleRequest)
      ) {
        return {
          body: frameworkWireBody(''),
          headers: mergeResponseHeaders(
            {
              'Cache-Control': 'private, no-store',
              'Content-Type': 'text/html; charset=utf-8',
              Vary: 'Cookie',
            },
            queryBuildHeaders(endpointRequest),
          ),
          status: 401,
        };
      }
      const authResponse = await renderHttpGuardFailureResponse(result, lifecycleRequest, {
        ...endpointRequest,
        currentUrl:
          endpointRequest.currentUrl ?? queryEndpointCurrentUrl(definition.key, searchEntries),
      });
      // SPEC §9.4:895: guard-failure responses (303 redirect, 403) also carry the private
      // cache posture — an anon 403 must not be cached and replayed to an authed user.
      if (authResponse) {
        const queryAuthResponse = {
          ...authResponse,
          body: frameworkWireBody(typeof authResponse.body === 'string' ? authResponse.body : ''),
        };
        const markedAuthResponse = isBlessedRedirectResponse(authResponse)
          ? blessRedirectResponse(queryAuthResponse)
          : queryAuthResponse;
        return withQueryBuildHeaders(withQueryCacheHeaders(markedAuthResponse), endpointRequest);
      }

      return {
        body: frameworkWireBody(JSON.stringify(result.error)),
        headers: mergeResponseHeaders(
          {
            'Cache-Control': 'private, no-store',
            'Content-Type': 'application/json; charset=utf-8',
            Vary: 'Cookie',
          },
          queryBuildHeaders(endpointRequest),
          retryAfterHeaders(result),
        ),
        status: result.status,
      };
    }

    // SPEC §9.4:895 (bugs-part4 L3): the success render is wrapped in the SAME private-cache
    // try/catch as the error branch above. The wire encode seam normalizes unserializable
    // values (bigint→tagged, Date→tagged) so `JSON.stringify` no longer throws on a `bigint`
    // column; if any render still throws, this catch keeps the mandated `private, no-store` +
    // `Vary: Cookie` posture on the resulting 500 instead of letting the throw escape and drop
    // those headers (which would let a shared cache replay one user's data to another).
    let body: string;
    try {
      body = renderQueryEndpointChunk(
        definition,
        result.input,
        result.value,
        queryEndpointCurrentUrl(definition.key, searchEntries),
      );
    } catch (error) {
      reportServerError(endpointRequest.onError, error, {
        operation: 'query-endpoint',
        queryKey: definition.key,
        request: lifecycleRequest,
      });
      return {
        body: frameworkWireBody(JSON.stringify(serverErrorPayload())),
        headers: queryJsonHeaders(endpointRequest),
        status: 500,
      };
    }

    return {
      body: frameworkWireBody(body),
      headers: mergeResponseHeaders(
        { 'Content-Type': 'text/html; charset=utf-8' },
        querySuccessCacheHeaders(definition, endpointRequest.request, lifecycleRequest),
        // SPEC §5.2.1 rule 2(d): stamp the build token so a background refetch into a stale
        // tab can detect deploy skew and avoid merging new-build data into a stale document.
        queryBuildHeaders(endpointRequest),
        queryWarningHeaders(result.warnings),
      ),
      status: 200,
    };
  },
);

/**
 * Render a registered query endpoint by key for generated/framework dispatch.
 *
 * @internal
 */
export const renderQueryRegistryEndpointResponse = wireEmitter(
  'server.wire.query-registry-endpoint',
  async function <Request>(
    registry: QueryEndpointRegistry<Request>,
    queryKey: string,
    endpointRequest: QueryEndpointRequest<Request>,
  ): Promise<QueryEndpointResponse> {
    const definition = denseOwnRegistryEntryByExactKey(
      registry.queries,
      queryKey,
      'Query endpoint registry',
    );

    if (!definition) {
      return withQueryCacheHeaders({
        body: frameworkWireBody('Not Found'),
        headers: mergeResponseHeaders(
          { 'Content-Type': 'text/plain; charset=utf-8' },
          queryBuildHeaders(endpointRequest),
        ),
        status: 404,
      });
    }

    return renderQueryEndpointResponse(definition, endpointRequest);
  },
);

export function readQueryInstanceKey<const Key extends string, Value, Input, Request>(
  queryDefinition: QueryDefinition<Key, Value, Input, Request>,
  input: Input,
): string | undefined {
  if (typeof queryDefinition.instanceKey === 'function') return queryDefinition.instanceKey(input);
  if (queryDefinition.instanceKey !== undefined) return queryDefinition.instanceKey;
  if (queryDefinition.args === undefined) return undefined;
  return defaultQueryInstanceKey(queryDefinition.key, queryDefinition.args, input);
}

/**
 * @internal Canonical typed-read href for a component query result.
 *
 * The initial document records this exact href beside its hydrated value, so focus return,
 * delta-miss recovery, and explicit refetch do not need to invert an app-authored instance key.
 */
export function queryEndpointHref<const Key extends string, Value, Input, Request>(
  queryDefinition: QueryDefinition<Key, Value, Input, Request>,
  input: Input,
): string {
  return queryEndpointCurrentUrl(
    queryDefinition.key,
    queryDefinition.args === undefined
      ? []
      : queryInputSearchEntries(input, schemaObjectFieldNames(queryDefinition.args)),
  );
}

export function readQueryVersion<const Key extends string, Value, Input, Request>(
  queryDefinition: QueryDefinition<Key, Value, Input, Request>,
  input: Input,
  value: Value,
): number | string | undefined {
  if (queryDefinition.version === undefined) return undefined;
  if (typeof queryDefinition.version === 'function') return queryDefinition.version(input, value);
  return queryDefinition.version;
}

function parseQueryInput<const Key extends string, Value, Input, Request>(
  definition: QueryDefinition<Key, Value, Input, Request>,
  rawInput: unknown,
  trustedInput = false,
): { ok: true; value: Input } | { failure: QueryEndpointFailure; ok: false } {
  rawInput = trustedInput ? rawInput : tagUntrustedRequestValue(rawInput);
  if (!definition.args) return { ok: true, value: rawInput as Input };

  try {
    return { ok: true, value: definition.args.parse(rawInput) };
  } catch (error) {
    if (!isSchemaValidationError(error)) throw error;

    return {
      failure: {
        error: {
          code: 'VALIDATION',
          payload: validationFailurePayload(error),
        },
        ok: false,
        status: 422,
      },
      ok: false,
    };
  }
}

function queryArgsSchema<Input>(
  schema: Schema<Input>,
  queryDefinition: QueryDefinition<string, unknown, Input, unknown>,
): QueryArgsSchema<Input> {
  const closedSchema = snapshotSchemaForRuntime(schema, 'query.args');
  const bind = (<Props extends object = any>(
    mapper: (props: Props) => Input,
  ): QueryArgsBinding<Input, Props> => ({
    args: mapper,
    query: queryDefinition,
    schema: closedSchema,
  })) as QueryArgsSchema<Input>;

  witnessDefineProperty(bind, 'parse', {
    configurable: true,
    enumerable: true,
    value: (input: unknown) => closedSchema.parse(input),
  });

  const asyncSchema = closedSchema as Schema<Input> & {
    parseAsync?: (input: unknown) => Promise<Input>;
  };
  if (typeof asyncSchema.parseAsync === 'function') {
    witnessDefineProperty(bind, 'parseAsync', {
      configurable: true,
      enumerable: true,
      value: (input: unknown) => asyncSchema.parseAsync?.(input),
    });
  }

  inheritSchemaRuntimeMetadata(closedSchema, bind);
  return bind;
}

function parseQueryOutput<const Key extends string, Value, Input, Request>(
  definition: QueryDefinition<Key, Value, Input, Request>,
  value: Value,
): { ok: true; value: Value } | { failure: QueryEndpointFailure; ok: false } {
  if (!definition.output) return { ok: true, value };

  try {
    // SPEC.md §10.2 KV410 + §11.2: opaque query projections with declared
    // output schemas are verified against the observed runtime result.
    return { ok: true, value: definition.output.parse(value) };
  } catch (error) {
    if (!isSchemaValidationError(error)) throw error;

    return {
      failure: {
        error: {
          code: 'KV410',
          payload: {},
        },
        ok: false,
        status: 500,
      },
      ok: false,
    };
  }
}

function capQueryListResults(
  value: unknown,
  limit: number,
): { value: unknown; warnings: QueryRuntimeWarning[] } {
  const warnings: QueryRuntimeWarning[] = [];
  const seen = createWitnessWeakMap<object, unknown>();
  let nodes = 0;
  let estimatedBytes = 0;

  const cap = (current: unknown, path: string, depth: number): unknown => {
    if (depth > MAX_QUERY_RESULT_DEPTH) {
      throw new Error('KV430: query result exceeded the framework depth ceiling (SPEC §9.5).');
    }
    nodes += 1;
    if (nodes > MAX_QUERY_RESULT_NODES) {
      throw new Error('KV430: query result exceeded the framework node ceiling (SPEC §9.5).');
    }
    estimatedBytes += estimatedQueryValueBytes(current);
    if (estimatedBytes > MAX_QUERY_RESULT_ESTIMATED_BYTES) {
      throw new Error('KV430: query result exceeded the framework byte ceiling (SPEC §9.5).');
    }

    if (isQueryResultArray(current)) {
      const length = queryArrayLength(current);
      const cappedLength = length > limit ? limit : length;
      if (length > limit) {
        appendQueryValue(warnings, { code: 'QUERY_LIST_LIMIT', limit, path });
      }
      const existing = witnessWeakMapGet(seen, current);
      if (existing !== undefined) return existing;
      const next: unknown[] = [];
      witnessWeakMapSet(seen, current, next);
      for (let index = 0; index < cappedLength; index += 1) {
        const descriptor = witnessGetOwnPropertyDescriptor(current, index);
        if (descriptor === undefined || !('value' in descriptor)) {
          throw new Error(
            'KV430: query result arrays must contain dense own data properties (SPEC §9.5).',
          );
        }
        appendQueryValue(next, cap(descriptor.value, `${path}[${index}]`, depth + 1));
      }
      return next;
    }

    if (!isPlainRecord(current)) {
      if (isSecret(current)) return current;
      if (typeof current === 'object' && current !== null) {
        throw new Error(
          'KV430: query result contains a non-JSON object outside the framework resource ceiling (SPEC §6.6/§9.5).',
        );
      }
      return current;
    }
    const existing = witnessWeakMapGet(seen, current);
    if (existing !== undefined) return existing;
    const next = witnessCreateNullRecord<unknown>() as Record<string, unknown>;
    witnessWeakMapSet(seen, current, next);
    const keys = witnessObjectKeys(current);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      const descriptor = witnessGetOwnPropertyDescriptor(current, key);
      if (descriptor === undefined || !('value' in descriptor)) {
        throw new Error(
          'KV430: query result records must contain own data properties (SPEC §9.5).',
        );
      }
      estimatedBytes += key.length * 6 + 3;
      if (estimatedBytes > MAX_QUERY_RESULT_ESTIMATED_BYTES) {
        throw new Error('KV430: query result exceeded the framework byte ceiling (SPEC §9.5).');
      }
      witnessDefineProperty(next, key, {
        configurable: true,
        enumerable: true,
        value: cap(descriptor.value, path === '$' ? `$.${key}` : `${path}.${key}`, depth + 1),
        writable: true,
      });
    }
    return next;
  };

  // SPEC §9.5: the framework-owned query sink applies the API4 default result-count
  // ceiling after `load` and before any query value reaches SSR or the client wire.
  return { value: cap(value, '$', 0), warnings };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = witnessGetPrototypeOf(value);
  return prototype === intrinsicObjectPrototype || prototype === null;
}

function isQueryResultArray(value: unknown): value is unknown[] {
  if (witnessIsArray(value)) return true;
  return (
    typeof value === 'object' &&
    value !== null &&
    witnessGetPrototypeOf(value) === intrinsicArrayPrototype
  );
}

function queryArrayLength(value: readonly unknown[]): number {
  const descriptor = witnessGetOwnPropertyDescriptor(value, 'length');
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    typeof descriptor.value !== 'number' ||
    descriptor.value < 0 ||
    descriptor.value > 4_294_967_295 ||
    descriptor.value % 1 !== 0
  ) {
    throw new Error('KV430: query result array length is not trustworthy (SPEC §9.5).');
  }
  return descriptor.value;
}

function estimatedQueryValueBytes(value: unknown): number {
  if (typeof value === 'string') return value.length * 6 + 2;
  if (typeof value === 'bigint') return estimatedBigintWireBytes(value);
  if (typeof value === 'number') return 32;
  if (typeof value === 'boolean') return 5;
  if (value === null || value === undefined) return 4;
  return 16;
}

function estimatedBigintWireBytes(value: bigint): number {
  let remaining = value < 0n ? -value : value;
  if (remaining >= MAX_QUERY_BIGINT_MAGNITUDE) {
    throw new Error('KV430: query result exceeded the framework byte ceiling (SPEC §9.5).');
  }
  let digits = 1;
  while (remaining >= 10n) {
    remaining /= 10n;
    digits += 1;
  }
  return digits + (value < 0n ? 1 : 0) + 40;
}

function appendQueryValue<Value>(values: Value[], value: Value): void {
  witnessDefineProperty(values, values.length, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function validationFailurePayload(error: SchemaValidationErrorLike): ValidationFailurePayload {
  return { issues: error.issues };
}

function querySearchWithoutArgsSchemaFailure(): QueryEndpointFailure {
  return {
    error: {
      code: 'VALIDATION',
      payload: {
        issues: [{ message: 'Search input requires a declared query args schema.', path: [] }],
      },
    },
    ok: false,
    status: 422,
  };
}

type QuerySearchEntry = readonly [string, string];

function defaultQueryInstanceKey(queryKey: string, args: Schema<unknown>, input: unknown): string {
  const declaredFields = schemaObjectFieldNames(args);
  if (declaredFields === undefined) {
    throw new TypeError(
      `Query "${queryKey}" requires an explicit instanceKey because its args are not a genuine s.object(...) schema.`,
    );
  }
  return `${queryKey}:${canonicalQueryInstanceKeyValue(declaredFields, input)}`;
}

function queryInputSearchEntries(
  input: unknown,
  declaredFields: readonly string[] | undefined,
): readonly QuerySearchEntry[] {
  if (typeof input !== 'object' || input === null || witnessIsArray(input)) {
    throw new TypeError('Kovo component query args must resolve to a flat own-data record.');
  }
  const entries: QuerySearchEntry[] = [];
  const names = declaredFields === undefined ? witnessObjectKeys(input) : declaredFields;
  if (declaredFields === undefined) {
    securityArraySort(names as string[], (left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
  }
  if (names.length > 1_024) {
    throw new RangeError('Kovo component query args exceed the bounded field limit.');
  }
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]!;
    const descriptor = witnessGetOwnPropertyDescriptor(input, name);
    if (descriptor === undefined) continue;
    if (!('value' in descriptor)) {
      throw new TypeError('Kovo component query args must be stable own-data properties.');
    }
    appendQueryInputSearchValues(entries, name, descriptor.value);
  }
  return entries;
}

function appendQueryInputSearchValues(
  entries: QuerySearchEntry[],
  name: string,
  value: unknown,
): void {
  if (value === undefined) return;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    appendQuerySearchEntry(entries, name, securityString(value));
    return;
  }
  if (witnessIsArray(value)) {
    if (value.length > 1_024) {
      throw new RangeError(`Kovo component query arg "${name}" exceeds the bounded value limit.`);
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = witnessGetOwnPropertyDescriptor(value, index);
      if (!descriptor || !('value' in descriptor)) {
        throw new TypeError(`Kovo component query arg "${name}" must be a dense scalar array.`);
      }
      const item = descriptor.value;
      if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') {
        throw new TypeError(`Kovo component query arg "${name}" must contain scalar values.`);
      }
      appendQuerySearchEntry(entries, name, securityString(item));
    }
    return;
  }
  throw new TypeError(`Kovo component query arg "${name}" must be a scalar or scalar array.`);
}

function querySearchInputToRecord(entries: readonly QuerySearchEntry[]): Record<string, unknown> {
  return entriesToRecord(entries);
}

function snapshotQuerySearchInputEntries(search: QuerySearchInput): readonly QuerySearchEntry[] {
  if (requestIsUrlSearchParams(search)) return requestUrlSearchParamsEntries(search);
  if (witnessIsArray(search)) return snapshotDenseQuerySearchEntries(search);

  const iterator = stableQueryIteratorMethod(search);
  if (iterator !== undefined) return snapshotIterableQuerySearchEntries(search, iterator);
  if (typeof search !== 'object' || search === null) {
    throw new TypeError('Kovo query search input must be a stable record or pair iterable.');
  }

  const entries: QuerySearchEntry[] = [];
  const keys = witnessObjectKeys(search);
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const key = keys[keyIndex]!;
    const descriptor = witnessGetOwnPropertyDescriptor(search, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('Kovo query search records must contain stable own data properties.');
    }
    const value = descriptor.value;
    if (value === undefined) continue;
    if (typeof value === 'string') {
      appendQuerySearchEntry(entries, key, value);
      continue;
    }
    if (!witnessIsArray(value)) {
      throw new TypeError('Kovo query search record values must be strings or string arrays.');
    }
    for (let valueIndex = 0; valueIndex < value.length; valueIndex += 1) {
      const valueDescriptor = witnessGetOwnPropertyDescriptor(value, valueIndex);
      if (
        valueDescriptor === undefined ||
        !('value' in valueDescriptor) ||
        typeof valueDescriptor.value !== 'string'
      ) {
        throw new TypeError('Kovo query search arrays must contain dense stable strings.');
      }
      appendQuerySearchEntry(entries, key, valueDescriptor.value);
    }
  }
  return entries;
}

function snapshotDenseQuerySearchEntries(search: readonly unknown[]): readonly QuerySearchEntry[] {
  const entries: QuerySearchEntry[] = [];
  for (let index = 0; index < search.length; index += 1) {
    const pair = stableOwnDataValue(search, index, `query search entry ${index}`);
    if (!witnessIsArray(pair) || pair.length !== 2) {
      throw new TypeError('Kovo query search arrays must contain dense string pairs.');
    }
    const key = stableOwnDataValue(pair, 0, 'query search entry key');
    const value = stableOwnDataValue(pair, 1, 'query search entry value');
    if (typeof key !== 'string' || typeof value !== 'string') {
      throw new TypeError('Kovo query search arrays must contain dense string pairs.');
    }
    appendQuerySearchEntry(entries, key, value);
  }
  return entries;
}

function stableQueryIteratorMethod(value: unknown): Function | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined;
  }
  let owner: object | null = value;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(owner, queryIteratorSymbol);
    if (descriptor !== undefined) {
      if (!('value' in descriptor) || typeof descriptor.value !== 'function') {
        throw new TypeError('Kovo query search iterator must be a stable data method.');
      }
      return descriptor.value;
    }
    owner = witnessGetPrototypeOf(owner);
  }
  return undefined;
}

function snapshotIterableQuerySearchEntries(
  search: object,
  iteratorMethod: Function,
): readonly QuerySearchEntry[] {
  const iterator = witnessReflectApply<unknown>(iteratorMethod, search, []);
  if ((typeof iterator !== 'object' && typeof iterator !== 'function') || iterator === null) {
    throw new TypeError('Kovo query search iterator factory returned an invalid carrier.');
  }
  const next = stableDataMethod(iterator, 'next', 'query search iterator');
  const entries: QuerySearchEntry[] = [];
  for (let count = 0; count <= 100_000; count += 1) {
    const result = witnessReflectApply<unknown>(next, iterator, []);
    if (typeof result !== 'object' || result === null) {
      throw new TypeError('Kovo query search iterator returned an invalid result.');
    }
    const done = stableOwnDataValue(result, 'done', 'query search iterator result.done');
    if (done === true) return entries;
    if (done !== false && done !== undefined) {
      throw new TypeError('Kovo query search iterator returned an invalid state.');
    }
    const pair = stableOwnDataValue(result, 'value', 'query search iterator result.value');
    if (!witnessIsArray(pair) || pair.length !== 2) {
      throw new TypeError('Kovo query search iterable must yield string pairs.');
    }
    const key = stableOwnDataValue(pair, 0, 'query search entry key');
    const value = stableOwnDataValue(pair, 1, 'query search entry value');
    if (typeof key !== 'string' || typeof value !== 'string') {
      throw new TypeError('Kovo query search iterable must yield string pairs.');
    }
    appendQuerySearchEntry(entries, key, value);
  }
  throw new TypeError('Kovo refused an unbounded query search carrier.');
}

function stableDataMethod(value: object, key: PropertyKey, label: string): Function {
  let owner: object | null = value;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(owner, key);
    if (descriptor !== undefined) {
      if (!('value' in descriptor) || typeof descriptor.value !== 'function') {
        throw new TypeError(`${label}.${String(key)} must be a stable data method.`);
      }
      return descriptor.value;
    }
    owner = witnessGetPrototypeOf(owner);
  }
  throw new TypeError(`${label}.${String(key)} is unavailable.`);
}

function stableOwnDataValue(value: object, key: PropertyKey, label: string): unknown {
  const descriptor = witnessGetOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new TypeError(`${label} must be a stable own data property.`);
  }
  return descriptor.value;
}

function appendQuerySearchEntry(entries: QuerySearchEntry[], key: string, value: string): void {
  witnessDefineProperty(entries, entries.length, {
    configurable: true,
    enumerable: true,
    value: [key, value] as const,
    writable: true,
  });
}

function queryEndpointCurrentUrl(queryKey: string, entries: readonly QuerySearchEntry[]): string {
  const queryString = requestSerializeUrlSearchParamsEntries(entries);
  return `/_q/${encodeQueryPath(queryKey)}${queryString ? `?${queryString}` : ''}`;
}

function encodeQueryPath(queryKey: string): string {
  let encoded = '';
  let remaining = queryKey;
  for (;;) {
    const separator = securityStringIndexOf(remaining, '/');
    const segment = separator < 0 ? remaining : securityStringSlice(remaining, 0, separator);
    encoded += `${encoded === '' ? '' : '/'}${securityEncodeURIComponent(segment)}`;
    if (separator < 0) return encoded;
    remaining = securityStringSlice(remaining, separator + 1);
  }
}

const renderQueryEndpointChunk = wireEmitter('server.wire.query-endpoint-chunk', function <
  const Key extends string,
  Value,
  Input,
  Request,
>(queryDefinition: QueryDefinition<Key, Value, Input, Request>, input: Input, value: Value, href: string): string {
  const key = readQueryInstanceKey(queryDefinition, input);

  return renderQueryWireHtml({
    href,
    key,
    name: queryDefinition.key,
    value,
    version: readQueryVersion(queryDefinition, input, value),
  });
});

function serverErrorPayload(): { code: 'SERVER_ERROR'; payload: Record<string, never> } {
  return { code: 'SERVER_ERROR', payload: {} };
}

const queryJsonHeaders = wireEmitter('server.wire.query-json-headers', function <
  Request,
>(endpointRequest: QueryEndpointRequest<Request>): ResponseHeaders {
  return mergeResponseHeaders(
    {
      'Cache-Control': 'private, no-store',
      'Content-Type': 'application/json; charset=utf-8',
      Vary: 'Cookie',
    },
    queryBuildHeaders(endpointRequest),
  );
});

function queryBuildHeaders<Request>(
  endpointRequest: QueryEndpointRequest<Request>,
): ResponseHeaders {
  return endpointRequest.buildToken ? { 'Kovo-Build': endpointRequest.buildToken } : {};
}

function querySuccessCacheHeaders<Request>(
  definition: { readonly key: string; readonly read?: QueryReadConfig },
  rawRequest: Request,
  lifecycleRequest: Request,
): ResponseHeaders {
  // SPEC §9.4: public caching is opened only by the compiler-owned manifest registered before app
  // evaluation. Runtime observations are rejection-only: they may narrow this response but never
  // turn a compile-time closed or missing verdict into public.
  const cacheControl = definition.read?.cacheControl;
  const manifest = registeredCacheInfluenceForRoot(`query:${definition.key}`);
  if (
    cacheControl === undefined ||
    !securityRegExpTest(/(?:^|,)\s*public(?:\s|,|$)/iu, cacheControl) ||
    manifest === undefined ||
    manifest.surface !== 'query' ||
    manifest.authored.posture !== 'public' ||
    manifest.authored.cacheControl !== cacheControl ||
    manifest.verdict === 'shared-cache-closed' ||
    runtimeCacheInfluenceClosesPublic(rawRequest, lifecycleRequest)
  ) {
    return privateQueryCacheHeaders();
  }
  return {
    'Cache-Control': cacheControl,
    ...(manifest.vary.length === 0 ? {} : { Vary: securityArrayJoin(manifest.vary, ', ') }),
  };
}

function privateQueryCacheHeaders(): ResponseHeaders {
  return { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
}

function runtimeCacheInfluenceClosesPublic<Request>(
  rawRequest: Request,
  lifecycleRequest: Request,
): boolean {
  if (queryRequestHeader(rawRequest, 'cookie') !== undefined) return true;
  if (queryRequestHeader(rawRequest, 'authorization') !== undefined) return true;
  if (lifecycleRequest !== null && typeof lifecycleRequest === 'object') {
    const session = witnessGetOwnPropertyDescriptor(lifecycleRequest, 'session');
    if (
      session !== undefined &&
      (!('value' in session) || (session.value !== null && session.value !== undefined))
    ) {
      return true;
    }
    if (principalPostureFromRequest(lifecycleRequest).kind !== 'anonymous') return true;
  }
  // Supported deployment paths use a genuine Web Request. A caller-supplied opaque carrier has no
  // runtime provenance vocabulary, so it can only narrow public caching.
  return rawRequest !== null && typeof rawRequest === 'object' && !isNativeRequest(rawRequest);
}

function queryRequestHeader(value: unknown, name: 'authorization' | 'cookie'): string | undefined {
  if (isNativeRequest(value)) {
    return name === 'cookie'
      ? (requestHeader(value, 'cookie') ?? undefined)
      : (requestHeader(value, 'authorization') ?? undefined);
  }
  if (value === null || typeof value !== 'object') return undefined;
  const descriptor = witnessGetOwnPropertyDescriptor(value, 'headers');
  if (descriptor === undefined || !('value' in descriptor)) return undefined;
  const headers = descriptor.value;
  if (!isHeaderSource(headers)) return undefined;
  return name === 'cookie' ? readHeader(headers, 'cookie') : readHeader(headers, 'authorization');
}

function queryWarningHeaders(
  warnings: readonly QueryRuntimeWarning[] | undefined,
): ResponseHeaders {
  const value = queryRuntimeWarningHeaderValue(warnings);
  return value === undefined ? {} : { 'Kovo-Warn': value };
}

/** @internal Format query warnings for SSR and /_q responses from the same runtime vocabulary. */
export function queryRuntimeWarningHeaderValue(
  warnings: readonly QueryRuntimeWarning[] | undefined,
): string | undefined {
  if (warnings === undefined || warnings.length === 0) return undefined;
  let listLimits = '';
  for (let index = 0; index < warnings.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(warnings, index);
    if (descriptor === undefined || !('value' in descriptor)) continue;
    const warning = descriptor.value;
    if (warning.code !== 'QUERY_LIST_LIMIT') continue;
    if (listLimits !== '') listLimits += ',';
    listLimits += `${warning.path};limit=${warning.limit}`;
  }
  return listLimits ? `QUERY_LIST_LIMIT ${listLimits}` : undefined;
}

function appendQueryWarnings(
  target: QueryRuntimeWarning[],
  warnings: readonly QueryRuntimeWarning[],
): void {
  for (let index = 0; index < warnings.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(warnings, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('Kovo query warnings must be dense own data properties.');
    }
    appendQueryValue(target, descriptor.value);
  }
}

function withQueryBuildHeaders<Request>(
  response: QueryEndpointResponse,
  endpointRequest: QueryEndpointRequest<Request>,
): QueryEndpointResponse {
  const next = {
    ...response,
    headers: mergeResponseHeaders(response.headers, queryBuildHeaders(endpointRequest)),
  };
  return isBlessedRedirectResponse(response) ? blessRedirectResponse(next) : next;
}

/**
 * Merge the SPEC §9.4:895 private cache posture onto any /_q/ response.
 * Guard-failure redirects (303) and forbidden (403) carry only Location/Content-Type
 * by default; stamping them prevents a shared cache from serving one user's denial
 * to another.
 */
const withQueryCacheHeaders = wireEmitter(
  'server.wire.query-cache-headers',
  function (response: QueryEndpointResponse): QueryEndpointResponse {
    const next = {
      ...response,
      headers: mergeResponseHeaders(
        {
          'Cache-Control': 'private, no-store',
          Vary: 'Cookie',
        },
        response.headers,
      ),
    };
    return isBlessedRedirectResponse(response) ? blessRedirectResponse(next) : next;
  },
);
