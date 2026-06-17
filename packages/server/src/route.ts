import type { JsonValue } from '@kovojs/core';

import { reportServerError } from './diagnostics.js';
import {
  renderHttpGuardFailureResponse,
  resolveLifecycleRequest,
  runGuard,
  type Guard,
  type GuardFailureResponseOptions,
  type RequestLifecycleOptions,
  type ResolvedGuardFailure,
  type UnauthenticatedHandler,
} from './guards.js';
import type { PageHintOptions } from './hints.js';
import { runWithJsxRequestContext } from './jsx-context.js';
import { runQuery, type QueryDefinition } from './query.js';
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

type LayoutQueryMap<Request> = Readonly<Record<string, QueryDefinition<string, any, any, Request>>>;

/** Resolved layout query values passed to a `layout().render` function (SPEC §4.5/§9.5). */
export type LayoutQueryResults<Queries> = {
  [Name in keyof Queries]: Queries[Name] extends QueryDefinition<string, infer Value, any, any>
    ? Awaited<Value>
    : unknown;
};

/** Slots passed to a `layout().render` function: child page/layout HTML plus the lifecycle request. */
export interface LayoutRenderSlots<Request> {
  /** The child layout or route page output this layout wraps. */
  children: unknown;
  /** The request after configured app lifecycle providers have run. */
  request: Request;
}

/** The body passed to `layout()`: optional parent, guard, queries, and chrome render function. */
export interface LayoutDefinition<
  Request = unknown,
  Queries extends LayoutQueryMap<Request> = LayoutQueryMap<Request>,
  Page = unknown,
> extends PageHintOptions {
  guard?: Guard<Request>;
  parent?: LayoutDeclaration<Request, LayoutQueryMap<Request>, unknown>;
  queries?: Queries;
  render?: (
    queries: LayoutQueryResults<Queries>,
    state: undefined,
    slots: LayoutRenderSlots<Request>,
  ) => Page | Promise<Page>;
}

/** A first-class page-chrome segment, as returned by `layout()`. */
export interface LayoutDeclaration<
  Request = unknown,
  Queries extends LayoutQueryMap<Request> = LayoutQueryMap<Request>,
  Page = unknown,
> extends LayoutDefinition<Request, Queries, Page> {}

/** The typed context a route `page` receives: parsed `params`, `search`, and the `path`. */
export interface RouteRequest<
  Path extends string,
  ParamsSchema extends MaybeSchema<Record<string, string>> = undefined,
  SearchSchema extends MaybeSchema<Record<string, JsonValue>> = undefined,
> {
  params: RouteParamsFor<Path, ParamsSchema>;
  path: Path;
  search: RouteSearchFor<SearchSchema>;
}

/** The body of a route passed to `route()`: `page`, param/search schemas, guards, and meta/hints. */
export interface RouteDefinition<
  Path extends string,
  ParamsSchema extends MaybeSchema<Record<string, string>> = undefined,
  SearchSchema extends MaybeSchema<Record<string, JsonValue>> = undefined,
  Request = unknown,
  Page = unknown,
  GuardedRequest extends Request = Request,
> extends PageHintOptions {
  guard?: Guard<Request, GuardedRequest>;
  layout?: LayoutDeclaration<any, LayoutQueryMap<any>, unknown>;
  onUnauthenticated?: UnauthenticatedHandler<Request>;
  page?: (
    context: RouteRequest<Path, ParamsSchema, SearchSchema>,
    request: GuardedRequest,
  ) => Page | NotFound | RouteResponseOutcome | Promise<Page | NotFound | RouteResponseOutcome>;
  params?: ParamsSchema;
  search?: SearchSchema;
  staticPaths?: readonly string[];
}

/** A `RouteDefinition` with its `path` attached, as returned by `route()`. */
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

/** Raw, unparsed `params`/`search` input handed to a route before schema parsing. */
export interface RouteRequestInput {
  params?: unknown;
  search?: unknown;
}

/**
 * Declare a reusable nested layout segment. Layouts compose page chrome around a route `page`;
 * parent layouts wrap child layouts, guards run before the route page, and layout queries load
 * from the same request lifecycle context as route/component queries (SPEC §4.5/§9.5).
 */
export function layout<
  Request = unknown,
  const Queries extends LayoutQueryMap<Request> = LayoutQueryMap<Request>,
  Page = unknown,
>(
  definition: LayoutDefinition<Request, Queries, Page>,
): LayoutDeclaration<Request, Queries, Page> {
  return { ...definition };
}

/** App-scoped route factory. `createApp()` uses this to contextually type route guards/pages from configured request providers (SPEC §6.4/§9.5). */
export interface RouteFactory<Request = unknown> {
  <
    const Path extends string,
    const ParamsSchema extends MaybeSchema<Record<string, string>> = undefined,
    const SearchSchema extends MaybeSchema<Record<string, JsonValue>> = undefined,
    Page = unknown,
  >(
    path: Path,
    definition?: RouteDefinition<Path, ParamsSchema, SearchSchema, Request, Page, Request>,
  ): RouteDeclaration<Path, ParamsSchema, SearchSchema, Request, Page, Request>;
}

/**
 * Declare a server route with a `page` handler. The path's `:params` and any
 * `search` schema are parsed and passed to `page` as a typed context; `page`
 * returns the page value (rendered by `renderRoutePageResponse`), `notFound()`,
 * or a response outcome. Optional `guard`/`onUnauthenticated` gate access, and
 * meta/hint fields control the document head (SPEC §6.4). Pages are complete
 * server-rendered documents — there is no client router.
 *
 * @param path - URL pattern; `:name` segments become typed params.
 * @param definition - The `page` handler plus optional `params`/`search` schemas, guards, and meta.
 * @returns A `RouteDeclaration` carrying `path`.
 * @example
 * import { notFound, route, s } from '@kovojs/server';
 *
 * const catalog = new Map<string, { name: string }>();
 *
 * export const productRoute = route('/products/:id', {
 *   params: s.object({ id: s.string() }),
 *   page({ params }) {
 *     const product = catalog.get(params.id);
 *     if (!product) return notFound();
 *     return `<h1>${product.name}</h1>`;
 *   },
 * });
 */
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

/**
 * Return a 404 not-found outcome from a route `page` handler.
 *
 * @returns A `NotFound` marker (`{ notFound: true, status: 404 }`).
 * @example
 * import { notFound } from '@kovojs/server';
 *
 * const missing = notFound();
 * // missing.status === 404
 */
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
  const layouts = routeLayoutChain(definition.layout);

  for (const layoutDeclaration of layouts) {
    const guardFailure = await runGuard(layoutDeclaration.guard, lifecycleRequest);
    if (guardFailure) return routeGuardFailure(guardFailure);
  }

  const guardFailure = await runGuard(definition.guard, lifecycleRequest);
  if (guardFailure) return routeGuardFailure(guardFailure);

  const value = await runWithJsxRequestContext(lifecycleRequest, async () => {
    const pageValue = await definition.page?.(routeRequest, lifecycleRequest as GuardedRequest);
    if (isNotFound(pageValue) || isRouteResponseOutcome(pageValue)) return pageValue;
    return renderLayoutChain(layouts, pageValue, lifecycleRequest);
  });
  if (isNotFound(value)) return { ok: false, status: 404 };
  if (isRouteResponseOutcome(value)) return { ok: true, outcome: value };
  return { ok: true, value: value as Page };
}

function routeGuardFailure(failure: ResolvedGuardFailure): RoutePageFailure {
  return {
    ...(failure.auth === undefined ? {} : { auth: failure.auth }),
    error: { code: failure.code, payload: failure.payload ?? {} },
    ok: false,
    ...(failure.retryAfter === undefined ? {} : { retryAfter: failure.retryAfter }),
    status: failure.status,
  };
}

function routeLayoutChain<Request>(
  layoutDeclaration: LayoutDeclaration<any, LayoutQueryMap<any>, unknown> | undefined,
): LayoutDeclaration<any, LayoutQueryMap<any>, unknown>[] {
  const chain: LayoutDeclaration<any, LayoutQueryMap<any>, unknown>[] = [];
  const seen = new Set<LayoutDeclaration<any, LayoutQueryMap<any>, unknown>>();
  let current = layoutDeclaration;

  while (current) {
    if (seen.has(current)) {
      throw new Error('Cyclic route layout parent chain.');
    }
    seen.add(current);
    chain.unshift(current);
    current = current.parent;
  }

  return chain;
}

async function renderLayoutChain<Request>(
  layouts: readonly LayoutDeclaration<any, LayoutQueryMap<any>, unknown>[],
  pageValue: unknown,
  request: Request,
): Promise<unknown> {
  let value = pageValue;
  for (const layoutDeclaration of [...layouts].reverse()) {
    if (!layoutDeclaration.render) continue;
    const queries = await loadLayoutQueries(layoutDeclaration, request);
    value = await layoutDeclaration.render(queries, undefined, {
      children: value,
      request,
    });
  }
  return value;
}

async function loadLayoutQueries<Request>(
  layoutDeclaration: LayoutDeclaration<any, LayoutQueryMap<any>, unknown>,
  request: Request,
): Promise<LayoutQueryResults<LayoutQueryMap<any>>> {
  const values: Record<string, unknown> = {};

  for (const [name, queryDefinition] of Object.entries(layoutDeclaration.queries ?? {})) {
    const result = await runQuery(queryDefinition, undefined, request);
    if (!result.ok) {
      throw new Error(`Layout query '${name}' failed with ${result.error.code}.`);
    }
    values[name] = result.value;
  }

  return values as LayoutQueryResults<LayoutQueryMap<any>>;
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
  auth?: ResolvedGuardFailure['auth'];
  error?: {
    code: 'RATE_LIMITED' | 'UNAUTHORIZED';
    payload: Record<string, unknown>;
  };
  ok: false;
  retryAfter?: number;
  status: 404 | 422 | 429;
}

/**
 * Run a route and render its full HTTP response: parse params/search, run the
 * guard, call `page`, and turn the result into a `RoutePageResponse` (status,
 * headers, body), or a guard-failure response. The default `render` stringifies
 * the page value; pass a custom `render` to wrap it in a document (SPEC §6.4).
 *
 * @param definition - The route to run.
 * @param input - Raw `params`/`search` to parse.
 * @param request - The per-request value passed to `page`.
 * @param render - Turns the page value into an HTML string (defaults to `String`).
 * @param options - Guard-failure, session, and error options.
 * @returns A `RoutePageResponse`.
 * @example
 * import { renderRoutePageResponse, route } from '@kovojs/server';
 *
 * const homeRoute = route('/', { page: () => '<h1>Home</h1>' });
 *
 * export function renderHome() {
 *   return renderRoutePageResponse(homeRoute, {}, {});
 * }
 */
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
