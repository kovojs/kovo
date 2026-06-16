import { reportServerError } from './diagnostics.js';
import type { Domain } from './domain.js';
import {
  renderHttpGuardFailureResponse,
  resolveLifecycleRequest,
  runGuard,
  type Guard,
  type GuardFailure,
  type GuardFailureResponseOptions,
  type GuardResult,
  type RequestLifecycleOptions,
} from './guards.js';
import { retryAfterHeaders, type ServerResponseBase } from './response.js';
import {
  entriesToRecord,
  SchemaValidationError,
  type Schema,
  type ValidationFailurePayload,
} from './schema.js';
import { renderQueryWireHtml } from './wire-html.js';

/** The context a query's `load` receives: the current request value. */
export interface QueryLoadContext<Request = unknown> {
  request: Request;
}

export interface QueryEndpointRequest<
  Request = unknown,
  SessionValue = unknown,
> extends GuardFailureResponseOptions<Request, SessionValue> {
  request: Request;
  search?: QuerySearchInput;
}

export type QuerySearchInput =
  | URLSearchParams
  | Iterable<readonly [string, string]>
  | Record<string, readonly string[] | string | undefined>;

export interface QueryEndpointResponse extends ServerResponseBase<
  string,
  Record<string, string>,
  200 | 303 | 403 | 404 | 422 | 429 | 500
> {}

export interface QueryEndpointRegistry<Request = unknown> {
  queries: readonly QueryDefinition<string, unknown, unknown, Request>[];
}

/** The shape of a query: its key, `load`, `reads` domains, and optional args/output/guard/version. */
export interface QueryDefinition<
  Key extends string = string,
  Value = unknown,
  Input = unknown,
  Request = unknown,
> {
  args?: Schema<Input>;
  guard?: Guard<Request>;
  instanceKey?: ((input: unknown) => string | undefined) | string;
  load?(input: Input, context?: QueryLoadContext<Request>): Promise<Value> | Value;
  key: Key;
  output?: Schema<Value>;
  reads: readonly Domain[];
  version?: ((input: Input, value: Value) => number | string | undefined) | number | string;
}

type BivariantGuard<Request> = {
  call(request: Request): GuardResult | Promise<GuardResult>;
}['call'];

interface QueryArgsDeclarationDefinition<Key extends string, Value, Input, Request> {
  args: Schema<Input>;
  guard?: BivariantGuard<Request>;
  instanceKey?: ((input: unknown) => string | undefined) | string;
  key?: Key;
  load?(input: Input, context?: QueryLoadContext<Request>): Promise<Value> | Value;
  output?: Schema<Value>;
  reads: readonly Domain[];
  version?: ((input: Input, value: Value) => number | string | undefined) | number | string;
}

type BivariantQueryGuard = {
  call(request: unknown): GuardResult | Promise<GuardResult>;
}['call'];

type BivariantQueryLoad = {
  call(input: unknown, context?: QueryLoadContext<unknown>): unknown;
}['call'];

type BivariantQueryVersion = {
  call(input: unknown, value: unknown): number | string | undefined;
}['call'];

export interface RegisteredQueryDefinition {
  args?: Schema<unknown>;
  guard?: BivariantQueryGuard;
  instanceKey?: ((input: unknown) => string | undefined) | string;
  key: string;
  load?: BivariantQueryLoad;
  output?: Schema<unknown>;
  reads: readonly Domain[];
  version?: BivariantQueryVersion | number | string;
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
  const Key extends string,
  Input,
  Request,
  Value,
  const Definition extends Omit<QueryArgsDeclarationDefinition<Key, Value, Input, Request>, 'key'>,
>(key: Key, definition: Definition): Definition & { key: Key };
export function query<
  const Key extends string,
  const Definition extends Omit<RegisteredQueryDefinition, 'key'>,
>(key: Key, definition: Definition): Definition & { key: Key };
export function query<const Key extends string>(
  key: Key,
  definition: Omit<RegisteredQueryDefinition, 'key'>,
): Omit<RegisteredQueryDefinition, 'key'> & { key: Key } {
  return { ...definition, key };
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
  return { input, ok: true, value };
}

export type QueryEndpointResult<Value, Input = unknown> =
  | QueryEndpointSuccess<Value, Input>
  | QueryEndpointFailure;

export interface QueryEndpointSuccess<Value, Input = unknown> {
  input: Input;
  ok: true;
  value: Value;
}

export interface QueryEndpointFailure {
  auth?: GuardFailure['auth'];
  error: {
    code: 'RATE_LIMITED' | 'UNAUTHORIZED' | 'VALIDATION';
    payload: Record<string, unknown> | ValidationFailurePayload;
  };
  ok: false;
  retryAfter?: number;
  status: 422 | 429;
}

/**
 * Run a query and render its HTTP endpoint response (the typed-read endpoint of
 * SPEC §9.4): a JSON body with caching headers, or a guard-failure response.
 *
 * @param definition - The query to run.
 * @param endpointRequest - The request plus optional search input and guard-failure options.
 * @returns A `QueryEndpointResponse` (status, headers, JSON body).
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
    return {
      body: JSON.stringify(serverErrorPayload()),
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
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
    if (authResponse) return authResponse;

    return {
      body: JSON.stringify(result.error),
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...retryAfterHeaders(result),
      },
      status: result.status,
    };
  }

  return {
    body: renderQueryEndpointChunk(definition, result.input, result.value),
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    status: 200,
  };
}

export async function renderQueryRegistryEndpointResponse<Request>(
  registry: QueryEndpointRegistry<Request>,
  queryKey: string,
  endpointRequest: QueryEndpointRequest<Request>,
): Promise<QueryEndpointResponse> {
  const definition = registry.queries.find((queryDefinition) => queryDefinition.key === queryKey);

  if (!definition) {
    return {
      body: 'Not Found',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
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
    if (!(error instanceof SchemaValidationError)) throw error;

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

function validationFailurePayload(error: SchemaValidationError): ValidationFailurePayload {
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
    key: undefined,
    name: key ?? queryDefinition.key,
    value,
    version: readQueryVersion(queryDefinition, input, value),
  });
}

function serverErrorPayload(): { code: 'SERVER_ERROR'; payload: Record<string, never> } {
  return { code: 'SERVER_ERROR', payload: {} };
}
