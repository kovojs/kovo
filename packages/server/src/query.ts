import type { JsonValue } from '@kovojs/core';
import { reportServerError } from './diagnostics.js';
import type { Domain } from './domain.js';
import type { AccessDecision } from './access.js';
import {
  renderHttpGuardFailureResponse,
  resolveLifecycleRequest,
  runGuard,
  withGuardArgs,
  type GuardFailureResponseOptions,
  type GuardResult,
  type RequestLifecycleOptions,
  type ResolvedGuardFailure,
} from './guards.js';
import {
  blessRedirectResponse,
  isBlessedRedirectResponse,
  retryAfterHeaders,
  type ResponseHeaders,
  type ServerResponseBase,
} from './response.js';
import {
  entriesToRecord,
  isSchemaValidationError,
  type Schema,
  type SchemaValidationErrorLike,
  type ValidationFailurePayload,
} from './schema.js';
import { renderQueryWireHtml } from './wire-html.js';
import type { JsonSerializable } from './json-boundary.js';
import type { Reader } from './managed-db.js';

interface QueryDeltaListMeta {
  domain: string;
  key: string;
  path: string;
}

const DEFAULT_QUERY_LIST_ITEMS = 100;

/** Explicit cache posture for proven public, session-independent typed reads (SPEC §9.4). */
export interface QueryReadConfig {
  cacheControl?: string;
}

/**
 * The context a query's `load` receives: the current request value plus the framework-owned
 * read-only managed db handle (SPEC §9.4 KV433 Stage 1 / §10.3). The framework threads `db` as a
 * `Reader<Db>` — the SQL-safe (KV422) managed handle with the write verbs
 * (insert/update/delete/execute/run/batch) removed at the type level (mirroring the runtime proxy
 * that throws `KovoReadonlyHandleError`). A loader destructures `{ db }` and reads through it; a
 * write in a loader is a `tsc` error, a runtime throw, AND a KV433 static-gate error. Use
 * `query.elevated(...)` for the audited GET-write escape (which receives the full read-write handle).
 */
export interface QueryLoadContext<Request = unknown, Db = unknown> {
  db?: Reader<Db>;
  request: Request;
}

/** @internal */
export interface QueryEndpointRequest<
  Request = unknown,
  SessionValue = unknown,
> extends GuardFailureResponseOptions<Request, SessionValue> {
  /**
   * Optional build token (SPEC §5.2.1 rule 2(d), §9.4): when present, stamped
   * as a `Kovo-Build` response header on every typed-read response so a plain
   * refetch into a stale tab is detectable by the client.
   */
  buildToken?: string;
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
  string,
  ResponseHeaders,
  200 | 303 | 403 | 404 | 422 | 429 | 500
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
  delta?: readonly QueryDeltaListMeta[];
  /**
   * SPEC §9.4/§10.3 (KV433): the audited GET-write escape. A `query.elevated(...)` loader receives
   * the FULL read-write managed handle (not the read-only proxy) and MUST be idempotent-safe-to-
   * repeat (GETs are re-fetched/prefetched). Set only by `query.elevated`; the capability is
   * surfaced in `kovo explain --capabilities`.
   */
  elevated?: boolean;
  guard?: {
    call(request: Request): GuardResult | Promise<GuardResult>;
  }['call'];
  instanceKey?: QueryInstanceKey<Input>;
  load?(input: Input, context?: QueryLoadContext<Request>): Promise<Value> | Value;
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
  <Props extends Record<string, unknown>>(
    mapper: (props: Props) => Input,
  ): QueryArgsBinding<Input, Props>;
};

export interface QueryArgsBinding<Input, Props extends Record<string, unknown>> {
  args: (props: Props) => Input;
  query: QueryDefinition<string, unknown, Input, unknown>;
  schema: Schema<Input>;
}

type BivariantGuard<Request> = {
  call(request: Request): GuardResult | Promise<GuardResult>;
}['call'];

interface QueryArgsDeclarationDefinition<Key extends string, Value, Input, Request> {
  args: Schema<Input>;
  delta?: readonly QueryDeltaListMeta[];
  guard?: BivariantGuard<Request>;
  instanceKey?: QueryInstanceKey<Input>;
  key?: Key;
  load?(input: Input, context?: QueryLoadContext<Request>): Promise<Value> | Value;
  output?: Schema<Value>;
  read?: QueryReadConfig;
  reads?: readonly Domain[];
  version?: ((input: Input, value: Value) => number | string | undefined) | number | string;
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
    ? Definition extends { load: (...args: any[]) => infer Result }
      ? Awaited<Result> extends JsonSerializable<Awaited<Result>>
        ? []
        : [never]
      : []
    : [never];

type BivariantQueryGuard = {
  call(request: unknown): GuardResult | Promise<GuardResult>;
}['call'];

type BivariantQueryLoad = {
  call(input: unknown, context?: QueryLoadContext<unknown>): unknown;
}['call'];

type BivariantQueryVersion = {
  call(input: unknown, value: unknown): number | string | undefined;
}['call'];

/** @internal */
export interface RegisteredQueryDefinition {
  access?: AccessDecision;
  args?: Schema<unknown>;
  /**
   * Delta-eligible collections for this query (SPEC §9.1.1). The compiler
   * populates this; framework/test code may set it directly.
   */
  delta?: readonly QueryDeltaListMeta[];
  /** SPEC §9.4/§10.3 (KV433): set by `query.elevated(...)` — the audited GET-write escape. */
  elevated?: boolean;
  guard?: BivariantQueryGuard;
  instanceKey?: ((input: unknown) => string | undefined) | string;
  key: string;
  load?: BivariantQueryLoad;
  output?: Schema<unknown>;
  read?: QueryReadConfig;
  reads?: readonly Domain[];
  version?: BivariantQueryVersion | number | string;
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
    call(input: any, context?: QueryLoadContext<Request>): Value | Promise<Value>;
  }['call'];
  output?: Schema<Value>;
  read?: QueryReadConfig;
  reads?: readonly Domain[];
  version?: ((input: any, value: any) => number | string | undefined) | number | string;
}

/** App-scoped query factory. `createApp()` uses this to contextually type query callbacks from configured request providers (SPEC §9.5/§10.2). */
export interface QueryFactory<Request = unknown> {
  <
    Input,
    Value,
    const Definition extends QueryArgsDeclarationDefinition<string, Value, Input, Request>,
  >(
    definition: Definition,
    ...jsonBoundary: Definition extends { load: (...args: any[]) => infer Result }
      ? Awaited<Result> extends JsonSerializable<Awaited<Result>>
        ? []
        : [never]
      : []
  ): QueryWithArgsBinding<Definition, Input> & { key: string; reads: readonly Domain[] };
  <const Definition extends QueryDeclarationDefinition<Request, any>>(
    definition: Definition,
    ...jsonBoundary: QueryDefinitionBoundary<Definition, QueryDeclarationDefinition<Request, any>>
  ): Definition extends { args: Schema<infer Input> }
    ? QueryWithArgsBinding<Definition, Input> & { key: string; reads: readonly Domain[] }
    : Definition & { key: string; reads: readonly Domain[] };
  <
    const Key extends string,
    Input,
    Value,
    const Definition extends Omit<
      QueryArgsDeclarationDefinition<Key, Value, Input, Request>,
      'key'
    >,
  >(
    key: Key,
    definition: Definition,
    ...jsonBoundary: Definition extends { load: (...args: any[]) => infer Result }
      ? Awaited<Result> extends JsonSerializable<Awaited<Result>>
        ? []
        : [never]
      : []
  ): QueryWithArgsBinding<Definition, Input> & { key: Key; reads: readonly Domain[] };
  <const Key extends string, const Definition extends QueryDeclarationDefinition<Request, any>>(
    key: Key,
    definition: Definition,
    ...jsonBoundary: QueryDefinitionBoundary<Definition, QueryDeclarationDefinition<Request, any>>
  ): Definition extends { args: Schema<infer Input> }
    ? QueryWithArgsBinding<Definition, Input> & { key: Key; reads: readonly Domain[] }
    : Definition & { key: Key; reads: readonly Domain[] };
  /** SPEC §9.4/§10.3 (KV433): the audited GET-write escape — see `query.elevated`. */
  elevated: QueryFactory<Request>;
}

/**
 * Declare a typed read. A query couples a stable key, a `load` function, and the
 * domains it `reads`. The read set is the entire invalidation declaration —
 * nothing else registers anywhere; when a mutation touches a domain in `reads`,
 * this query reruns (SPEC §10.2). Optional `args` validate inputs, `output`
 * validates results, and `version`/`instanceKey` control caching identity.
 *
 * @param key - The query's stable registry key.
 * @param definition - `load`, `reads`, and optional `args`/`output`/`guard`/`version`.
 * @returns A query definition carrying `key`.
 * @example
 * import { domain, query } from '@kovojs/server';
 *
 * const product = domain('product');
 *
 * export const productsQuery = query('products', {
 *   load: () => ({ items: [] as { id: string }[] }),
 *   reads: [product],
 * });
 */
export function query<
  Input,
  Request,
  Value,
  const Definition extends QueryArgsDeclarationDefinition<string, Value, Input, Request>,
>(
  definition: Definition,
  ...jsonBoundary: Definition extends { load: (...args: any[]) => infer Result }
    ? Awaited<Result> extends JsonSerializable<Awaited<Result>>
      ? []
      : [never]
    : []
): QueryWithArgsBinding<Definition, Input> & { key: string; reads: readonly Domain[] };
export function query<const Definition extends QueryDeclarationDefinition<any, any>>(
  definition: Definition,
  ...jsonBoundary: QueryDefinitionBoundary<Definition, QueryDeclarationDefinition<any, any>>
): Definition extends { args: Schema<infer Input> }
  ? QueryWithArgsBinding<Definition, Input> & { key: string; reads: readonly Domain[] }
  : Definition & { key: string; reads: readonly Domain[] };
export function query<
  const Key extends string,
  Input,
  Request,
  Value,
  const Definition extends Omit<QueryArgsDeclarationDefinition<Key, Value, Input, Request>, 'key'>,
>(
  key: Key,
  definition: Definition,
  ...jsonBoundary: Definition extends { load: (...args: any[]) => infer Result }
    ? Awaited<Result> extends JsonSerializable<Awaited<Result>>
      ? []
      : [never]
    : []
): QueryWithArgsBinding<Definition, Input> & { key: Key; reads: readonly Domain[] };
export function query<
  const Key extends string,
  const Definition extends QueryDeclarationDefinition<any, any>,
>(
  key: Key,
  definition: Definition,
  ...jsonBoundary: QueryDefinitionBoundary<Definition, QueryDeclarationDefinition<any, any>>
): Definition extends { args: Schema<infer Input> }
  ? QueryWithArgsBinding<Definition, Input> & { key: Key; reads: readonly Domain[] }
  : Definition & { key: Key; reads: readonly Domain[] };
export function query(
  keyOrDefinition: string | Omit<RegisteredQueryDefinition, 'key'>,
  maybeDefinition?: Omit<RegisteredQueryDefinition, 'key'>,
  ..._jsonBoundary: never[]
): unknown {
  const [key, definition] =
    typeof keyOrDefinition === 'string'
      ? [keyOrDefinition, maybeDefinition]
      : [UNASSIGNED_DERIVED_QUERY_KEY, keyOrDefinition];
  if (!definition) {
    throw new TypeError('query() requires a definition object.');
  }
  return buildQueryDefinition(key, definition, false);
}

function buildQueryDefinition<const Key extends string>(
  key: Key,
  definition: Omit<RegisteredQueryDefinition, 'key'>,
  elevated: boolean,
): unknown {
  assertKnownQueryDefinitionKeys(definition);
  const queryDefinition = {
    ...definition,
    key,
    reads: definition.reads ?? [],
    ...(elevated ? { elevated: true } : {}),
  };
  if (!definition.args) return queryDefinition;

  return Object.assign(queryDefinition, {
    args: queryArgsSchema(
      definition.args,
      queryDefinition as QueryDefinition<string, unknown, unknown, unknown>,
    ),
  });
}

/**
 * @internal Compiler-emitted/generated ABI for SPEC §4.1 source-derived query identities.
 *
 * Runtime-only `query({ ... })` cannot know the source module path or exported binding. Generated
 * modules call this after evaluating an exported query declaration so every downstream wire surface
 * (`/_q/<key>`, `<kovo-query name>`, `kovo-deps`, and query stores) observes the derived key.
 */
export function assignDerivedQueryKey<Query extends QueryDefinition<string, any, any, any>>(
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
  if (definition.elevated) recordElevatedQueryFact(key);
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
  for (const key of Reflect.ownKeys(definition)) {
    if (queryDefinitionKeys.has(key)) continue;
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

/**
 * A recorded `query.elevated(...)` capability fact for `kovo explain --capabilities`
 * (SPEC §9.4/§10.3, audit-grade). Names the elevated GET-write query that received the full
 * read-write handle, so the audit surfaces every read surface authorized to write.
 */
export interface ElevatedQueryFact {
  query: string;
}

const elevatedQueryFacts: ElevatedQueryFact[] = [];
const elevatedQueryFactKeys = new Set<string>();

function recordElevatedQueryFact(key: string): void {
  if (key === UNASSIGNED_DERIVED_QUERY_KEY || elevatedQueryFactKeys.has(key)) return;
  elevatedQueryFactKeys.add(key);
  elevatedQueryFacts.push({ query: key });
}

/**
 * Drain the recorded {@link ElevatedQueryFact}s for `kovo explain --capabilities`
 * (SPEC §9.4/§10.3). Returns and clears the accumulated facts.
 */
export function drainElevatedQueryFacts(): ElevatedQueryFact[] {
  elevatedQueryFactKeys.clear();
  return elevatedQueryFacts.splice(0, elevatedQueryFacts.length);
}

/**
 * The audited GET-write escape for the read-only loader rule (SPEC §9.4/§10.3, KV433).
 *
 * A normal `query()` loader receives the read-only managed handle (write verbs throw,
 * `KovoReadonlyHandleError`). `query.elevated(...)` declares a read surface that is allowed to write
 * — its loader receives the FULL read-write handle — and is recorded as a capability for
 * `kovo explain --capabilities`. An elevated loader MUST be idempotent-safe-to-repeat: a GET is
 * re-fetched and prefetched (SPEC §9.4), so its write must produce the same observable state when
 * repeated. Use this only when a write genuinely must run on a read (e.g. a usage counter that is
 * fine to double-count via an idempotent UPSERT); otherwise move the write to a `mutation()`.
 *
 * @param key - The query's stable registry key.
 * @param definition - `load` (receiving a read-write handle), `reads`, and optional facets.
 * @returns A query definition carrying `key` and `elevated: true`.
 */
function queryElevated(
  keyOrDefinition: string | Omit<RegisteredQueryDefinition, 'key'>,
  maybeDefinition?: Omit<RegisteredQueryDefinition, 'key'>,
  ..._jsonBoundary: never[]
): unknown {
  const [key, definition] =
    typeof keyOrDefinition === 'string'
      ? [keyOrDefinition, maybeDefinition]
      : [UNASSIGNED_DERIVED_QUERY_KEY, keyOrDefinition];
  if (!definition) {
    throw new TypeError('query.elevated() requires a definition object.');
  }
  recordElevatedQueryFact(key);
  return buildQueryDefinition(key, definition, true);
}

// Attach the audited escape to the `query` factory. Typed against the same overloads as `query`
// (minus the elevated marker the factory owns) so `query.elevated('name', { load, reads })` type-
// checks identically to `query('name', …)`.
interface QueryElevated {
  <
    Input,
    Request,
    Value,
    const Definition extends QueryArgsDeclarationDefinition<string, Value, Input, Request>,
  >(
    definition: Definition,
    ...jsonBoundary: Definition extends { load: (...args: any[]) => infer Result }
      ? Awaited<Result> extends JsonSerializable<Awaited<Result>>
        ? []
        : [never]
      : []
  ): QueryWithArgsBinding<Definition, Input> & {
    key: string;
    reads: readonly Domain[];
    elevated: true;
  };
  <const Definition extends QueryDeclarationDefinition<any, any>>(
    definition: Definition,
    ...jsonBoundary: QueryDefinitionBoundary<Definition, QueryDeclarationDefinition<any, any>>
  ): Definition extends { args: Schema<infer Input> }
    ? QueryWithArgsBinding<Definition, Input> & {
        key: string;
        reads: readonly Domain[];
        elevated: true;
      }
    : Definition & { key: string; reads: readonly Domain[]; elevated: true };
  <
    const Key extends string,
    Input,
    Request,
    Value,
    const Definition extends Omit<
      QueryArgsDeclarationDefinition<Key, Value, Input, Request>,
      'key'
    >,
  >(
    key: Key,
    definition: Definition,
    ...jsonBoundary: Definition extends { load: (...args: any[]) => infer Result }
      ? Awaited<Result> extends JsonSerializable<Awaited<Result>>
        ? []
        : [never]
      : []
  ): QueryWithArgsBinding<Definition, Input> & {
    key: Key;
    reads: readonly Domain[];
    elevated: true;
  };
  <const Key extends string, const Definition extends QueryDeclarationDefinition<any, any>>(
    key: Key,
    definition: Definition,
    ...jsonBoundary: QueryDefinitionBoundary<Definition, QueryDeclarationDefinition<any, any>>
  ): Definition extends { args: Schema<infer Input> }
    ? QueryWithArgsBinding<Definition, Input> & {
        key: Key;
        reads: readonly Domain[];
        elevated: true;
      }
    : Definition & { key: Key; reads: readonly Domain[]; elevated: true };
}

// Merge `query.elevated` onto the `query` function symbol so the public type carries the escape.
// eslint-disable-next-line @typescript-eslint/no-namespace
export declare namespace query {
  /** SPEC §9.4/§10.3 (KV433): the audited GET-write escape; see {@link queryElevated}. */
  export const elevated: QueryElevated;
}
(query as unknown as { elevated: QueryElevated }).elevated = queryElevated as QueryElevated;

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
  options: RequestLifecycleOptions<Request> = {},
): Promise<QueryEndpointResult<Value, Input>> {
  const argsResult = parseQueryInput(definition, rawInput);
  if (!argsResult.ok) return argsResult.failure;

  // SPEC §9.4/§10.3 (MARQUEE): the framework owns the handle threaded into the loader. A normal
  // `query()` loader runs in read mode (KV433 read-only proxy); the audited `query.elevated(...)`
  // escape runs in write mode so a GET that must be idempotent-safe-to-repeat can perform its write.
  const dbMode = definition.elevated ? 'write' : 'read';
  const resolvedRequest = await resolveLifecycleRequest(request, { ...options, dbMode });
  // SPEC §10.3:1155-1157 ("Guards (arg-aware, normative)") + §9.4: thread the query's *validated*
  // args onto the request BEFORE the guard chain so an ownership guard (`guards.owns` reading
  // `req.args`) can authorize a client-visible key and discharge KV414 — without this merge
  // `keyOf(request)` reads `undefined` and a key-ignoring predicate authorizes everyone (IDOR).
  // Only on the validated path (a declared `args` schema, parsed above); a query without args never
  // fabricates an unvalidated `req.args`. The loader/guard then see the same coerced values.
  const lifecycleRequest =
    definition.args === undefined
      ? resolvedRequest
      : (withGuardArgs(resolvedRequest, argsResult.value) as typeof resolvedRequest);
  const guardFailure = await runGuard(definition.guard, lifecycleRequest);
  if (guardFailure) {
    return {
      ...(guardFailure.auth === undefined ? {} : { auth: guardFailure.auth }),
      error: { code: guardFailure.code, payload: guardFailure.payload ?? {} },
      ok: false,
      ...(guardFailure.retryAfter === undefined ? {} : { retryAfter: guardFailure.retryAfter }),
      status: guardFailure.status,
    };
  }

  const input = argsResult.value;
  // The framework-owned managed handle is installed on `lifecycleRequest.db` by
  // `resolveLifecycleRequest` (read-only proxy for a loader, read-write for an elevated GET). Thread
  // it onto the loader context as `context.db` so loaders destructure `{ db }` from the framework
  // instead of bringing their own (the breaking change). When no `db` provider is configured the
  // field is simply absent, preserving today's behavior for db-less queries.
  const threadedDb = (lifecycleRequest as { db?: unknown }).db;
  const loadContext = {
    request: lifecycleRequest,
    ...(threadedDb === undefined ? {} : { db: threadedDb }),
  } as QueryLoadContext<Request>;
  const value = definition.load ? await definition.load(input, loadContext) : (null as Value);
  const capped = capQueryListResults(value, options.maxListItems ?? DEFAULT_QUERY_LIST_ITEMS);
  const outputResult = parseQueryOutput(definition, capped.value as Value);
  if (!outputResult.ok) return outputResult.failure;

  return {
    input,
    ok: true,
    value: outputResult.value,
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

interface QueryRuntimeWarning {
  code: 'QUERY_LIST_LIMIT';
  limit: number;
  path: string;
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
export async function renderQueryEndpointResponse<const Key extends string, Value, Input, Request>(
  definition: QueryDefinition<Key, Value, Input, Request>,
  endpointRequest: QueryEndpointRequest<Request>,
): Promise<QueryEndpointResponse> {
  const rawInput = querySearchInputToRecord(endpointRequest.search ?? {});
  let result: QueryEndpointResult<Value, Input>;
  let lifecycleRequest: Request = endpointRequest.request;
  try {
    lifecycleRequest = await resolveLifecycleRequest(endpointRequest.request, endpointRequest);
    result = await runQuery(
      definition,
      rawInput,
      lifecycleRequest,
      endpointRequest.maxListItems === undefined
        ? {}
        : { maxListItems: endpointRequest.maxListItems },
    );
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
      body: JSON.stringify(serverErrorPayload()),
      headers: queryJsonHeaders(endpointRequest),
      status: 500,
    };
  }

  if (!result.ok) {
    const authResponse = await renderHttpGuardFailureResponse(result, lifecycleRequest, {
      ...endpointRequest,
      currentUrl:
        endpointRequest.currentUrl ??
        queryEndpointCurrentUrl(definition.key, endpointRequest.search ?? {}),
    });
    // SPEC §9.4:895: guard-failure responses (303 redirect, 403) also carry the private
    // cache posture — an anon 403 must not be cached and replayed to an authed user.
    if (authResponse) {
      return withQueryBuildHeaders(withQueryCacheHeaders(authResponse), endpointRequest);
    }

    return {
      body: JSON.stringify(result.error),
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'application/json; charset=utf-8',
        Vary: 'Cookie',
        ...queryBuildHeaders(endpointRequest),
        ...retryAfterHeaders(result),
      },
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
    body = renderQueryEndpointChunk(definition, result.input, result.value);
  } catch (error) {
    reportServerError(endpointRequest.onError, error, {
      operation: 'query-endpoint',
      queryKey: definition.key,
      request: lifecycleRequest,
    });
    return {
      body: JSON.stringify(serverErrorPayload()),
      headers: queryJsonHeaders(endpointRequest),
      status: 500,
    };
  }

  return {
    body,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...querySuccessCacheHeaders(definition),
      // SPEC §5.2.1 rule 2(d): stamp the build token so a background refetch into a stale
      // tab can detect deploy skew and avoid merging new-build data into a stale document.
      ...queryBuildHeaders(endpointRequest),
      ...queryWarningHeaders(result.warnings),
    },
    status: 200,
  };
}

/**
 * Render a registered query endpoint by key for generated/framework dispatch.
 *
 * @internal
 */
export async function renderQueryRegistryEndpointResponse<Request>(
  registry: QueryEndpointRegistry<Request>,
  queryKey: string,
  endpointRequest: QueryEndpointRequest<Request>,
): Promise<QueryEndpointResponse> {
  const definition = registry.queries.find((queryDefinition) => queryDefinition.key === queryKey);

  if (!definition) {
    return withQueryCacheHeaders({
      body: 'Not Found',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        ...queryBuildHeaders(endpointRequest),
      },
      status: 404,
    });
  }

  return renderQueryEndpointResponse(definition, endpointRequest);
}

export function readQueryInstanceKey<const Key extends string, Value, Input, Request>(
  queryDefinition: QueryDefinition<Key, Value, Input, Request>,
  input: Input,
): string | undefined {
  if (queryDefinition.instanceKey === undefined) return undefined;
  if (typeof queryDefinition.instanceKey === 'function') return queryDefinition.instanceKey(input);
  return queryDefinition.instanceKey;
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
): { ok: true; value: Input } | { failure: QueryEndpointFailure; ok: false } {
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
  const bind = (<Props extends Record<string, unknown>>(
    mapper: (props: Props) => Input,
  ): QueryArgsBinding<Input, Props> => ({
    args: mapper,
    query: queryDefinition,
    schema,
  })) as QueryArgsSchema<Input>;

  Object.defineProperty(bind, 'parse', {
    configurable: true,
    enumerable: true,
    value: (input: unknown) => schema.parse(input),
  });

  const asyncSchema = schema as Schema<Input> & {
    parseAsync?: (input: unknown) => Promise<Input>;
  };
  if (typeof asyncSchema.parseAsync === 'function') {
    Object.defineProperty(bind, 'parseAsync', {
      configurable: true,
      enumerable: true,
      value: (input: unknown) => asyncSchema.parseAsync?.(input),
    });
  }

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
  const seen = new WeakMap<object, unknown>();

  const cap = (current: unknown, path: string): unknown => {
    if (Array.isArray(current)) {
      const source = current.length > limit ? current.slice(0, limit) : current;
      if (current.length > limit) warnings.push({ code: 'QUERY_LIST_LIMIT', limit, path });
      return source.map((item, index) => cap(item, `${path}[${index}]`));
    }

    if (!isPlainRecord(current)) return current;
    const existing = seen.get(current);
    if (existing !== undefined) return existing;
    const next: Record<string, unknown> = {};
    seen.set(current, next);
    for (const [key, nested] of Object.entries(current)) {
      next[key] = cap(nested, path === '$' ? `$.${key}` : `${path}.${key}`);
    }
    return next;
  };

  // SPEC §9.5: the framework-owned query sink applies the API4 default result-count
  // ceiling after `load` and before any query value reaches SSR or the client wire.
  return { value: cap(value, '$'), warnings };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validationFailurePayload(error: SchemaValidationErrorLike): ValidationFailurePayload {
  return { issues: error.issues };
}

function querySearchInputToRecord(search: QuerySearchInput): Record<string, unknown> {
  return entriesToRecord(querySearchInputEntries(search));
}

function querySearchInputEntries(search: QuerySearchInput): Iterable<readonly [string, unknown]> {
  if (search instanceof URLSearchParams || Symbol.iterator in search) return search;

  return Object.entries(search).flatMap(([key, value]) =>
    value === undefined
      ? []
      : Array.isArray(value)
        ? value.map((item) => [key, item] as const)
        : [[key, value] as const],
  );
}

function queryEndpointCurrentUrl(queryKey: string, search: QuerySearchInput): string {
  const params = new URLSearchParams();
  for (const [key, value] of querySearchInputEntries(search)) {
    appendSearchParams(params, key, value);
  }

  const queryString = params.toString();
  return `/_q/${encodeURIComponent(queryKey)}${queryString ? `?${queryString}` : ''}`;
}

function appendSearchParams(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) appendSearchParams(params, key, item);
    return;
  }

  params.append(key, searchParamValue(value));
}

function searchParamValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return `${value}`;
  }

  return JSON.stringify(value) ?? '';
}

function renderQueryEndpointChunk<const Key extends string, Value, Input, Request>(
  queryDefinition: QueryDefinition<Key, Value, Input, Request>,
  input: Input,
  value: Value,
): string {
  const key = readQueryInstanceKey(queryDefinition, input);

  return renderQueryWireHtml({
    key,
    name: queryDefinition.key,
    value,
    version: readQueryVersion(queryDefinition, input, value),
  });
}

function serverErrorPayload(): { code: 'SERVER_ERROR'; payload: Record<string, never> } {
  return { code: 'SERVER_ERROR', payload: {} };
}

function queryJsonHeaders<Request>(
  endpointRequest: QueryEndpointRequest<Request>,
): Record<string, string> {
  return {
    'Cache-Control': 'private, no-store',
    'Content-Type': 'application/json; charset=utf-8',
    Vary: 'Cookie',
    ...queryBuildHeaders(endpointRequest),
  };
}

function queryBuildHeaders<Request>(
  endpointRequest: QueryEndpointRequest<Request>,
): Record<string, string> {
  return endpointRequest.buildToken ? { 'Kovo-Build': endpointRequest.buildToken } : {};
}

function querySuccessCacheHeaders(definition: {
  access?: AccessDecision;
  guard?: unknown;
  read?: QueryReadConfig;
}): Record<string, string> {
  const cacheControl = definition.read?.cacheControl;
  if (
    cacheControl &&
    definition.guard === undefined &&
    definition.access?.kind === 'public' &&
    safeHeaderValue(cacheControl)
  ) {
    return { 'Cache-Control': cacheControl };
  }

  // SPEC §9.4: guarded or otherwise session-dependent /_q reads stay private and uncacheable.
  // The public cache-control relaxation is accepted only on explicitly public, unguarded query
  // declarations; errors and guard failures use the same private posture above.
  return {
    'Cache-Control': 'private, no-store',
    Vary: 'Cookie',
  };
}

function safeHeaderValue(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0 || code === 0x7f || code < 0x20) return false;
  }
  return true;
}

function queryWarningHeaders(
  warnings: readonly QueryRuntimeWarning[] | undefined,
): Record<string, string> {
  if (warnings === undefined || warnings.length === 0) return {};
  const listLimits = warnings
    .filter((warning) => warning.code === 'QUERY_LIST_LIMIT')
    .map((warning) => `${warning.path};limit=${warning.limit}`)
    .join(',');
  return listLimits ? { 'Kovo-Warn': `QUERY_LIST_LIMIT ${listLimits}` } : {};
}

function withQueryBuildHeaders<Request>(
  response: QueryEndpointResponse,
  endpointRequest: QueryEndpointRequest<Request>,
): QueryEndpointResponse {
  const next = {
    ...response,
    headers: {
      ...response.headers,
      ...queryBuildHeaders(endpointRequest),
    },
  };
  return isBlessedRedirectResponse(response) ? blessRedirectResponse(next) : next;
}

/**
 * Merge the SPEC §9.4:895 private cache posture onto any /_q/ response.
 * Guard-failure redirects (303) and forbidden (403) carry only Location/Content-Type
 * by default; stamping them prevents a shared cache from serving one user's denial
 * to another.
 */
function withQueryCacheHeaders(response: QueryEndpointResponse): QueryEndpointResponse {
  const next = {
    ...response,
    headers: {
      'Cache-Control': 'private, no-store',
      Vary: 'Cookie',
      ...response.headers,
    },
  };
  return isBlessedRedirectResponse(response) ? blessRedirectResponse(next) : next;
}
