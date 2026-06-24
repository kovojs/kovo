import type { JsonValue } from '@kovojs/core';
import { reportServerError } from './diagnostics.js';
import type { Domain } from './domain.js';
import type { AccessDecision } from './access.js';
import {
  renderHttpGuardFailureResponse,
  resolveLifecycleRequest,
  runGuard,
  type GuardFailureResponseOptions,
  type GuardResult,
  type RequestLifecycleOptions,
  type ResolvedGuardFailure,
} from './guards.js';
import { retryAfterHeaders, type ServerResponseBase } from './response.js';
import {
  entriesToRecord,
  isSchemaValidationError,
  type Schema,
  type SchemaValidationErrorLike,
  type ValidationFailurePayload,
} from './schema.js';
import { renderQueryWireHtml } from './wire-html.js';
import type { JsonSerializable } from './json-boundary.js';

interface QueryDeltaListMeta {
  domain: string;
  key: string;
  path: string;
}

/** The context a query's `load` receives: the current request value. */
export interface QueryLoadContext<Request = unknown> {
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
  Record<string, string>,
  200 | 303 | 403 | 404 | 422 | 429 | 500
> {}

/** @internal */
export interface QueryEndpointRegistry<Request = unknown> {
  queries: readonly QueryDefinition<string, unknown, unknown, Request>[];
}

/** The shape of a query: its key, explicit access decision, `load`, `reads` domains, and optional args/output/guard/version. */
export interface QueryDefinition<
  Key extends string = string,
  Value = JsonValue,
  Input = unknown,
  Request = unknown,
> {
  access: AccessDecision;
  args?: Schema<Input>;
  /**
   * Delta-eligible collections for this query. When present, the server can
   * emit a change-record-scoped delta (SPEC §9.1.1) instead of the full value
   * when the delta is smaller. The compiler populates this; framework/test code
   * may set it directly.
   */
  delta?: readonly QueryDeltaListMeta[];
  guard?: {
    call(request: Request): GuardResult | Promise<GuardResult>;
  }['call'];
  instanceKey?: ((input: unknown) => string | undefined) | string;
  load?(input: Input, context?: QueryLoadContext<Request>): Promise<Value> | Value;
  key: Key;
  output?: Schema<Value>;
  reads?: readonly Domain[];
  version?: ((input: Input, value: Value) => number | string | undefined) | number | string;
}

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
  access: AccessDecision;
  args: Schema<Input>;
  delta?: readonly QueryDeltaListMeta[];
  guard?: BivariantGuard<Request>;
  instanceKey?: ((input: unknown) => string | undefined) | string;
  key?: Key;
  load?(input: Input, context?: QueryLoadContext<Request>): Promise<Value> | Value;
  output?: Schema<Value>;
  reads?: readonly Domain[];
  version?: ((input: Input, value: Value) => number | string | undefined) | number | string;
}

type QueryWithArgsBinding<Definition, Input> = Omit<Definition, 'args'> & {
  args: QueryArgsSchema<Input>;
};

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
  access: AccessDecision;
  args?: Schema<unknown>;
  /**
   * Delta-eligible collections for this query (SPEC §9.1.1). The compiler
   * populates this; framework/test code may set it directly.
   */
  delta?: readonly QueryDeltaListMeta[];
  guard?: BivariantQueryGuard;
  instanceKey?: ((input: unknown) => string | undefined) | string;
  key: string;
  load?: BivariantQueryLoad;
  output?: Schema<unknown>;
  reads?: readonly Domain[];
  version?: BivariantQueryVersion | number | string;
}

/**
 * Definition object passed to `query()` before the stable key is attached (SPEC §10.2).
 * Query load values are checked against the public JSON boundary by `query()`.
 */
export interface QueryDeclarationDefinition<Request = unknown, Value = JsonValue> {
  access: AccessDecision;
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
  reads?: readonly Domain[];
  version?: ((input: any, value: any) => number | string | undefined) | number | string;
}

/** App-scoped query factory. `createApp()` uses this to contextually type query callbacks from configured request providers (SPEC §9.5/§10.2). */
export interface QueryFactory<Request = unknown> {
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
    ...jsonBoundary: Definition extends { load: (...args: any[]) => infer Result }
      ? Awaited<Result> extends JsonSerializable<Awaited<Result>>
        ? []
        : [never]
      : []
  ): Definition extends { args: Schema<infer Input> }
    ? QueryWithArgsBinding<Definition, Input> & { key: Key; reads: readonly Domain[] }
    : Definition & { key: Key; reads: readonly Domain[] };
}

/**
 * Declare a typed read. A query couples a stable key, a `load` function, and the
 * domains it `reads`, and an explicit access decision. The read set is the entire invalidation declaration —
 * nothing else registers anywhere; when a mutation touches a domain in `reads`,
 * this query reruns (SPEC §10.2). Optional `args` validate inputs, `output`
 * validates results, and `version`/`instanceKey` control caching identity.
 *
 * @param key - The query's stable registry key.
 * @param definition - `access`, `load`, `reads`, and optional `args`/`output`/`guard`/`version`.
 * @returns A query definition carrying `key`.
 * @example
 * import { domain, query } from '@kovojs/server';
 *
 * const product = domain('product');
 *
 * export const productsQuery = query('products', {
 *   access: publicAccess('public product catalog'),
 *   load: () => ({ items: [] as { id: string }[] }),
 *   reads: [product],
 * });
 */
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
  ...jsonBoundary: Definition extends { load: (...args: any[]) => infer Result }
    ? Awaited<Result> extends JsonSerializable<Awaited<Result>>
      ? []
      : [never]
    : []
): Definition extends { args: Schema<infer Input> }
  ? QueryWithArgsBinding<Definition, Input> & { key: Key; reads: readonly Domain[] }
  : Definition & { key: Key; reads: readonly Domain[] };
export function query<const Key extends string>(
  key: Key,
  definition: Omit<RegisteredQueryDefinition, 'key'>,
  ..._jsonBoundary: never[]
): unknown {
  const queryDefinition = {
    ...definition,
    key,
    reads: definition.reads ?? [],
  };
  if (!definition.args) return queryDefinition;

  return {
    ...queryDefinition,
    args: queryArgsSchema(
      definition.args,
      queryDefinition as QueryDefinition<string, unknown, unknown, unknown>,
    ),
  };
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
  options: RequestLifecycleOptions<Request> = {},
): Promise<QueryEndpointResult<Value, Input>> {
  const argsResult = parseQueryInput(definition, rawInput);
  if (!argsResult.ok) return argsResult.failure;

  const lifecycleRequest = await resolveLifecycleRequest(request, options);
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
  const value = definition.load
    ? await definition.load(input, { request: lifecycleRequest })
    : (null as Value);
  const outputResult = parseQueryOutput(definition, value);
  if (!outputResult.ok) return outputResult.failure;

  return { input, ok: true, value: outputResult.value };
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
    result = await runQuery(definition, rawInput, lifecycleRequest);
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
      // SPEC §9.4 (bugs-1 F35): /_q reads return per-user, session-dependent query JSON and
      // the query guard is checked on every read. Default to a private, uncacheable posture
      // keyed on the cookie so a shared/intermediary cache can never replay one user's data
      // to another and bypass that guard. (Relaxing to a cacheable posture for queries proven
      // session-independent is a later optimization; the safe default is unconditional.)
      'Cache-Control': 'private, no-store',
      Vary: 'Cookie',
      // SPEC §5.2.1 rule 2(d): stamp the build token so a background refetch into a stale
      // tab can detect deploy skew and avoid merging new-build data into a stale document.
      ...queryBuildHeaders(endpointRequest),
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
    return {
      body: 'Not Found',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        ...queryBuildHeaders(endpointRequest),
      },
      status: 404,
    };
  }

  return renderQueryEndpointResponse(definition, endpointRequest);
}

export function readQueryInstanceKey<const Key extends string, Value, Input, Request>(
  queryDefinition: QueryDefinition<Key, Value, Input, Request>,
  input: unknown,
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

function withQueryBuildHeaders<Request>(
  response: QueryEndpointResponse,
  endpointRequest: QueryEndpointRequest<Request>,
): QueryEndpointResponse {
  return {
    ...response,
    headers: {
      ...response.headers,
      ...queryBuildHeaders(endpointRequest),
    },
  };
}

/**
 * Merge the SPEC §9.4:895 private cache posture onto any /_q/ response.
 * Guard-failure redirects (303) and forbidden (403) carry only Location/Content-Type
 * by default; stamping them prevents a shared cache from serving one user's denial
 * to another.
 */
function withQueryCacheHeaders(response: QueryEndpointResponse): QueryEndpointResponse {
  return {
    ...response,
    headers: {
      'Cache-Control': 'private, no-store',
      Vary: 'Cookie',
      ...response.headers,
    },
  };
}
