import type { JsonValue } from '@jiso/core';

import { reportServerError } from './diagnostics.js';
import {
  renderHttpGuardFailureResponse,
  resolveLifecycleRequest,
  runGuard,
  type Guard,
  type GuardFailure,
  type GuardFailureResponseOptions,
  type RequestLifecycleOptions,
  type UnauthenticatedHandler,
} from './guards.js';
import type { PageHintOptions } from './hints.js';
import {
  htmlServerErrorResponse,
  retryAfterHeaders,
  routeOutcomeResponse,
  type NotFound,
  type RoutePageResponse,
  type RouteResponseOutcome,
} from './response.js';
import type { Schema } from './schema.js';

type PathParamNames<Path extends string> = Path extends `${string}:${infer Rest}`
  ? Rest extends `${infer Param}/${infer Tail}`
    ? Param | PathParamNames<Tail>
    : Rest extends `${infer Param}?${string}`
      ? Param
      : Rest
  : never;

type PathParams<Path extends string> =
  PathParamNames<Path> extends never ? {} : Record<PathParamNames<Path>, string>;

type MaybeSchema<Value> = Schema<Value> | undefined;

type RouteParamsFor<Path extends string, ParamsSchema extends MaybeSchema<Record<string, string>>> =
  ParamsSchema extends Schema<infer Params> ? Params : PathParams<Path>;

type RouteSearchFor<SearchSchema extends MaybeSchema<Record<string, JsonValue>>> =
  SearchSchema extends Schema<infer Search> ? Search : Record<string, JsonValue>;

export interface RouteRequest<
  Path extends string,
  ParamsSchema extends MaybeSchema<Record<string, string>> = undefined,
  SearchSchema extends MaybeSchema<Record<string, JsonValue>> = undefined,
> {
  params: RouteParamsFor<Path, ParamsSchema>;
  path: Path;
  search: RouteSearchFor<SearchSchema>;
}

export interface RouteDefinition<
  Path extends string,
  ParamsSchema extends MaybeSchema<Record<string, string>> = undefined,
  SearchSchema extends MaybeSchema<Record<string, JsonValue>> = undefined,
  Request = unknown,
  Page = unknown,
  GuardedRequest extends Request = Request,
> extends PageHintOptions {
  guard?: Guard<Request, GuardedRequest>;
  onUnauthenticated?: UnauthenticatedHandler<Request>;
  page?: (
    context: RouteRequest<Path, ParamsSchema, SearchSchema>,
    request: GuardedRequest,
  ) => Page | NotFound | RouteResponseOutcome | Promise<Page | NotFound | RouteResponseOutcome>;
  params?: ParamsSchema;
  search?: SearchSchema;
  staticPaths?: readonly string[];
}

export interface RouteDeclaration<
  Path extends string,
  ParamsSchema extends MaybeSchema<Record<string, string>> = undefined,
  SearchSchema extends MaybeSchema<Record<string, JsonValue>> = undefined,
  Request = unknown,
  Page = unknown,
  GuardedRequest extends Request = Request,
> extends RouteDefinition<Path, ParamsSchema, SearchSchema, Request, Page, GuardedRequest> {
  path: Path;
}

export interface RouteRequestInput {
  params?: unknown;
  search?: unknown;
}

export function route<
  const Path extends string,
  const ParamsSchema extends MaybeSchema<Record<string, string>> = undefined,
  const SearchSchema extends MaybeSchema<Record<string, JsonValue>> = undefined,
  Request = unknown,
  Page = unknown,
  GuardedRequest extends Request = Request,
>(
  path: Path,
  definition: RouteDefinition<Path, ParamsSchema, SearchSchema, Request, Page, GuardedRequest> = {},
): RouteDeclaration<Path, ParamsSchema, SearchSchema, Request, Page, GuardedRequest> {
  return { ...definition, path };
}

export function parseRouteRequest<
  const Path extends string,
  ParamsSchema extends MaybeSchema<Record<string, string>>,
  SearchSchema extends MaybeSchema<Record<string, JsonValue>>,
  Request,
  Page,
>(
  definition: RouteDeclaration<Path, ParamsSchema, SearchSchema, Request, Page>,
  input: RouteRequestInput = {},
): RouteRequest<Path, ParamsSchema, SearchSchema> {
  const params = definition.params
    ? definition.params.parse(input.params ?? {})
    : ((input.params ?? {}) as RouteParamsFor<Path, ParamsSchema>);
  const search = definition.search
    ? definition.search.parse(input.search ?? {})
    : ((input.search ?? {}) as RouteSearchFor<SearchSchema>);

  return {
    params: params as RouteParamsFor<Path, ParamsSchema>,
    path: definition.path,
    search: search as RouteSearchFor<SearchSchema>,
  };
}

export function notFound(): NotFound {
  return { notFound: true, status: 404 };
}

export async function runRoutePage<
  const Path extends string,
  ParamsSchema extends MaybeSchema<Record<string, string>>,
  SearchSchema extends MaybeSchema<Record<string, JsonValue>>,
  Request,
  Page,
  GuardedRequest extends Request = Request,
>(
  definition: RouteDeclaration<Path, ParamsSchema, SearchSchema, Request, Page, GuardedRequest>,
  input: RouteRequestInput,
  request: Request,
  options: RequestLifecycleOptions<Request> = {},
): Promise<RoutePageResult<Page>> {
  const routeRequest = parseRouteRequest(definition, input);

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

  const value = await definition.page?.(routeRequest, lifecycleRequest as GuardedRequest);
  if (isNotFound(value)) return { ok: false, status: 404 };
  if (isRouteResponseOutcome(value)) return { ok: true, outcome: value };
  return { ok: true, value: value as Page };
}

export type RoutePageResult<Page> = RoutePageSuccess<Page> | RoutePageFailure;

export type RoutePageSuccess<Page> = RoutePageRenderSuccess<Page> | RoutePageOutcomeSuccess;

export interface RoutePageRenderSuccess<Page> {
  ok: true;
  value: Page;
}

export interface RoutePageOutcomeSuccess {
  ok: true;
  outcome: RouteResponseOutcome;
}

export interface RoutePageFailure {
  auth?: GuardFailure['auth'];
  error?: {
    code: 'RATE_LIMITED' | 'UNAUTHORIZED';
    payload: Record<string, unknown>;
  };
  ok: false;
  retryAfter?: number;
  status: 404 | 422 | 429;
}

export async function renderRoutePageResponse<
  const Path extends string,
  ParamsSchema extends MaybeSchema<Record<string, string>>,
  SearchSchema extends MaybeSchema<Record<string, JsonValue>>,
  Request,
  Page,
  GuardedRequest extends Request = Request,
>(
  definition: RouteDeclaration<Path, ParamsSchema, SearchSchema, Request, Page, GuardedRequest>,
  input: RouteRequestInput,
  request: Request,
  render: (value: Page) => string | Promise<string> = (value) => String(value ?? ''),
  options: GuardFailureResponseOptions<Request> = {},
): Promise<RoutePageResponse> {
  let result: RoutePageResult<Page>;
  let lifecycleRequest: Request = request;
  try {
    lifecycleRequest = await resolveLifecycleRequest(request, options);
    result = await runRoutePage(definition, input, lifecycleRequest);
  } catch (error) {
    reportServerError(options.onError, error, {
      operation: 'route-page',
      request: lifecycleRequest,
      routePath: definition.path,
    });
    return htmlServerErrorResponse();
  }

  if (!result.ok) {
    const onUnauthenticated = definition.onUnauthenticated ?? options.onUnauthenticated;
    const authResponse = await renderHttpGuardFailureResponse(result, lifecycleRequest, {
      ...options,
      currentUrl: options.currentUrl ?? routeCurrentUrl(definition, input),
      ...(onUnauthenticated === undefined ? {} : { onUnauthenticated }),
    });
    if (authResponse) return authResponse;

    return {
      body:
        result.status === 404
          ? 'Not Found'
          : result.status === 429
            ? 'Too Many Requests'
            : 'Unauthorized',
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        ...retryAfterHeaders(result),
      },
      status: result.status,
    };
  }

  if ('outcome' in result) return routeOutcomeResponse(result.outcome, request);

  try {
    return {
      body: await render(result.value),
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 200,
    };
  } catch (error) {
    reportServerError(options.onError, error, {
      operation: 'route-render',
      request: lifecycleRequest,
      routePath: definition.path,
    });
    return htmlServerErrorResponse();
  }
}

function routeCurrentUrl<
  const Path extends string,
  ParamsSchema extends MaybeSchema<Record<string, string>>,
  SearchSchema extends MaybeSchema<Record<string, JsonValue>>,
  Request,
  Page,
>(
  definition: RouteDeclaration<Path, ParamsSchema, SearchSchema, Request, Page>,
  input: RouteRequestInput,
): string {
  const routeRequest = parseRouteRequest(definition, input);
  const pathname = definition.path.replace(/:([A-Za-z_$][\w$]*)/g, (_match, key: string) =>
    encodeURIComponent(searchParamValue((routeRequest.params as Record<string, unknown>)[key])),
  );
  const search = searchParamsString(routeRequest.search as Record<string, unknown>);

  return search ? `${pathname}?${search}` : pathname;
}

function searchParamsString(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    appendSearchParams(params, key, value);
  }

  return params.toString();
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

function isNotFound(value: unknown): value is NotFound {
  return (
    typeof value === 'object' &&
    value !== null &&
    'notFound' in value &&
    value.notFound === true &&
    'status' in value &&
    value.status === 404
  );
}

function isRouteResponseOutcome(value: unknown): value is RouteResponseOutcome {
  return (
    typeof value === 'object' &&
    value !== null &&
    'routeResponse' in value &&
    value.routeResponse === true
  );
}
