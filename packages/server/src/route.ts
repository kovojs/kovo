import type { JsonValue, Redirect } from '@kovojs/core';

import { reportServerError } from './diagnostics.js';
import {
  renderHttpGuardFailureResponse,
  resolveLifecycleRequest,
  runGuard,
  sanitizeNext,
  type Guard,
  type GuardFailureResponseOptions,
  type RequestLifecycleOptions,
  type ResolvedGuardFailure,
  type UnauthenticatedHandler,
} from './guards.js';
import type { PageHintOptions } from './hints.js';
import { runWithJsxRequestContext } from './jsx-context.js';
import type { CsrfValidationOptions } from './csrf.js';
import type { MutationFail } from './mutation.js';
import { runQuery, type QueryDefinition, type RegisteredQueryDefinition } from './query.js';
import {
  htmlServerErrorResponse,
  retryAfterHeaders,
  routeOutcomeResponse,
  type NotFound,
  type RoutePageResponse,
  type RouteResponseOutcome,
} from './response.js';
import type { Schema } from './schema.js';
import { escapeAttribute } from './html.js';
import type {
  CompiledRouteNavigationSegment,
  CompiledRoutePageFunction,
  CompiledRoutePageMetadata,
} from './route-ir.js';

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

interface LayoutLiveTargetMetadata {
  deps: readonly string[];
  target: string;
}

const layoutLiveTargetMetadata = new WeakMap<object, LayoutLiveTargetMetadata>();
const layoutNavigationSegmentIds = new WeakMap<object, string>();
const routePageMetadata = new WeakMap<object, CompiledRoutePageMetadata>();
let nextLayoutLiveTargetId = 0;
let nextLayoutNavigationSegmentId = 0;

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

/** Context passed to route/layout segment boundary renderers. */
export interface RouteBoundaryContext<Request> {
  error?: unknown;
  request: Request;
  status: 403 | 404 | 500;
}

/** Render a route/layout segment boundary for expected route failures or errors. */
export type RouteBoundaryRenderer<Request, Page = unknown> = (
  context: RouteBoundaryContext<Request>,
) => Page | Promise<Page>;

/** Per-segment boundaries that override app-level error shells for matching route failures. */
export interface RouteBoundaries<Request = unknown, Page = unknown> {
  error?: RouteBoundaryRenderer<Request, Page>;
  notFound?: RouteBoundaryRenderer<Request, Page>;
  unauthorized?: RouteBoundaryRenderer<Request, Page>;
}

/** The body passed to `layout()`: optional parent, guard, queries, and chrome render function. */
export interface LayoutDefinition<
  Request = unknown,
  Queries extends LayoutQueryMap<Request> = LayoutQueryMap<Request>,
  Page = unknown,
> extends PageHintOptions {
  boundaries?: RouteBoundaries<Request, Page>;
  guard?: Guard<Request>;
  parent?: LayoutDeclaration<Request, any, unknown>;
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

/** App-scoped layout factory whose guards and render slots see the configured request shape. */
export interface LayoutFactory<Request = unknown> {
  <const Queries extends LayoutQueryMap<Request> = LayoutQueryMap<Request>, Page = unknown>(
    definition: LayoutDefinition<Request, Queries, Page>,
  ): LayoutDeclaration<Request, Queries, Page>;
}

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
  boundaries?: RouteBoundaries<Request, Page>;
  guard?: Guard<Request, GuardedRequest>;
  layout?: LayoutDeclaration<any, any, any>;
  onUnauthenticated?: UnauthenticatedHandler<Request>;
  page?: (
    context: RouteRequest<Path, ParamsSchema, SearchSchema>,
    request: GuardedRequest,
  ) =>
    | Page
    | NotFound
    | Redirect
    | RouteResponseOutcome
    | Promise<Page | NotFound | Redirect | RouteResponseOutcome>;
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
>(definition: LayoutDefinition<Request, Queries, Page>): LayoutDeclaration<Request, Queries, Page> {
  const declaration = { ...definition };
  const deps = Object.values(definition.queries ?? {}).map(
    (queryDefinition) => queryDefinition.key,
  );
  if (deps.length > 0) {
    nextLayoutLiveTargetId += 1;
    layoutLiveTargetMetadata.set(declaration, {
      deps,
      target: `kovo-layout-${nextLayoutLiveTargetId}`,
    });
  }
  return declaration;
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
  const declaration = { ...definition, path };
  const metadata =
    (definition.page as CompiledRoutePageFunction | undefined)?.kovoRoutePage ??
    fallbackRoutePageMetadata(path, definition);
  if (metadata) routePageMetadata.set(declaration, metadata);
  return declaration;
}

function fallbackRoutePageMetadata<Path extends string>(
  path: Path,
  definition: RouteDefinition<Path, any, any, any, any, any>,
): CompiledRoutePageMetadata | undefined {
  if (!definition.page || !definition.layout) return undefined;
  const layouts = routeLayoutChain(definition.layout);
  return {
    components: [],
    fileName: '',
    navigationSegments: [
      ...layouts.map((layoutDeclaration) => {
        const id = layoutNavigationSegmentId(layoutDeclaration);
        return {
          id,
          kind: 'layout' as const,
          localName: id,
          queries: (
            Object.values(layoutDeclaration.queries ?? {}) as RegisteredQueryDefinition[]
          ).map((queryDefinition) => queryDefinition.key),
        };
      }),
      {
        components: [],
        id: `page:${path}`,
        kind: 'page',
        localName: 'page',
      },
    ],
    route: path,
  };
}

function layoutNavigationSegmentId(layoutDeclaration: LayoutDeclaration<any, any, any>): string {
  const existing = layoutNavigationSegmentIds.get(layoutDeclaration);
  if (existing) return existing;

  nextLayoutNavigationSegmentId += 1;
  const id = `layout:${nextLayoutNavigationSegmentId}`;
  layoutNavigationSegmentIds.set(layoutDeclaration, id);
  return id;
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

export interface RouteJsxContextOptions<Request> {
  csrf?: CsrfValidationOptions<Request>;
  mutationFailure?: {
    failure: MutationFail;
    input?: unknown;
    mutationKey: string;
    target?: string;
  };
}

/**
 * Run a route page directly for framework dispatch and conformance fixtures.
 *
 * @internal
 */
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
  const result = await runRoutePageInternal(definition, input, request, options);
  if (result.ok) return result;
  return stripRouteBoundaryFailure(result);
}

async function runRoutePageInternal<
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
  options: RequestLifecycleOptions<Request> & RouteJsxContextOptions<Request> = {},
): Promise<RoutePageInternalResult<Page>> {
  const routeRequest = parseRouteRequest(definition, input);

  const lifecycleRequest = await resolveLifecycleRequest(request, options);
  const layouts = routeLayoutChain(definition.layout);

  for (let index = 0; index < layouts.length; index += 1) {
    const layoutDeclaration = layouts[index];
    if (!layoutDeclaration) continue;
    const guardFailure = await runGuard(layoutDeclaration.guard, lifecycleRequest);
    if (guardFailure) {
      return withRouteBoundaryFailure(
        routeGuardFailure(guardFailure),
        routeBoundaryFor('unauthorized', undefined, layouts.slice(0, index + 1)),
      );
    }
  }

  const guardFailure = await runGuard(definition.guard, lifecycleRequest);
  if (guardFailure) {
    return withRouteBoundaryFailure(
      routeGuardFailure(guardFailure),
      routeBoundaryFor('unauthorized', definition, layouts),
    );
  }

  let value: unknown;
  try {
    value = await runWithJsxRequestContext(
      lifecycleRequest,
      routeJsxContextOptions(options),
      async () => {
        let pageValue: unknown;
        try {
          pageValue = await definition.page?.(routeRequest, lifecycleRequest as GuardedRequest);
        } catch (error) {
          throw new RouteBoundaryRenderError(error, routeBoundaryFor('error', definition, layouts));
        }
        if (isNotFound(pageValue) || isRedirect(pageValue) || isRouteResponseOutcome(pageValue))
          return pageValue;
        const metadata = getRoutePageMetadata(definition);
        return renderLayoutChain(
          layouts,
          stampRoutePageSegment(metadata, pageValue),
          lifecycleRequest,
          metadata,
        );
      },
    );
  } catch (error) {
    if (error instanceof RouteBoundaryRenderError && error.boundary) {
      return {
        boundary: error.boundary,
        error: { code: 'RENDER_ERROR', payload: {} },
        ok: false,
        status: 500,
        thrown: error.thrown,
      };
    }
    throw error instanceof RouteBoundaryRenderError ? error.thrown : error;
  }

  if (isNotFound(value)) {
    return withRouteBoundaryFailure(
      { ok: false, status: 404 },
      routeBoundaryFor('notFound', definition, layouts),
    );
  }
  // SPEC §6.4: redirect() is a sanctioned non-200 page outcome. Sanitize the
  // location through sanitizeNext for defence-in-depth (open-redirect guard).
  if (isRedirect(value)) return { ok: true, redirect: value };
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

function getRoutePageMetadata(
  definition: RouteDefinition<any, any, any, any, any, any>,
): CompiledRoutePageMetadata | undefined {
  const metadata =
    routePageMetadata.get(definition) ??
    (definition.page as CompiledRoutePageFunction | undefined)?.kovoRoutePage;
  if (metadata) routePageMetadata.set(definition, metadata);
  return metadata;
}

function routeLayoutChain(
  layoutDeclaration: LayoutDeclaration<any, any, any> | undefined,
): LayoutDeclaration<any, any, any>[] {
  const chain: LayoutDeclaration<any, any, any>[] = [];
  const seen = new Set<LayoutDeclaration<any, any, any>>();
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
  layouts: readonly LayoutDeclaration<any, any, any>[],
  pageValue: unknown,
  request: Request,
  metadata: CompiledRoutePageMetadata | undefined,
): Promise<unknown> {
  const layoutSegments = routeLayoutSegments(metadata);
  let value = pageValue;
  for (let index = layouts.length - 1; index >= 0; index -= 1) {
    const layoutDeclaration = layouts[index];
    if (!layoutDeclaration) continue;
    if (!layoutDeclaration.render) continue;
    try {
      const queries = await loadLayoutQueries(layoutDeclaration, request);
      value = await layoutDeclaration.render(queries, undefined, {
        children: value,
        request,
      });
      value = stampLayoutLiveTarget(layoutDeclaration, value);
      value = stampRouteNavigationSegment(layoutSegments[index], value);
    } catch (error) {
      throw new RouteBoundaryRenderError(
        error,
        routeBoundaryFor('error', undefined, layouts.slice(0, index + 1)),
      );
    }
  }
  return value;
}

async function loadLayoutQueries<Request>(
  layoutDeclaration: LayoutDeclaration<any, any, any>,
  request: Request,
): Promise<LayoutQueryResults<LayoutQueryMap<any>>> {
  const values: Record<string, unknown> = {};

  for (const [name, queryDefinition] of Object.entries(layoutDeclaration.queries ?? {})) {
    const result = await runQuery(
      queryDefinition as QueryDefinition<string, unknown, unknown, Request>,
      undefined,
      request,
    );
    if (!result.ok) {
      throw new Error(`Layout query '${name}' failed with ${result.error.code}.`);
    }
    values[name] = result.value;
  }

  return values as LayoutQueryResults<LayoutQueryMap<any>>;
}

function stampRoutePageSegment(
  metadata: CompiledRoutePageMetadata | undefined,
  value: unknown,
): unknown {
  return stampRouteNavigationSegment(
    metadata?.navigationSegments?.find((segment) => segment.kind === 'page'),
    value,
  );
}

function routeLayoutSegments(
  metadata: CompiledRoutePageMetadata | undefined,
): readonly (CompiledRouteNavigationSegment | undefined)[] {
  return (metadata?.navigationSegments ?? []).filter((segment) => segment.kind === 'layout');
}

function stampRouteNavigationSegment(
  segment: CompiledRouteNavigationSegment | undefined,
  value: unknown,
): unknown {
  if (!segment || typeof value !== 'string') return value;

  const opening = /^<([A-Za-z][A-Za-z0-9:-]*)([^>]*)>/.exec(value);
  if (!opening) return value;

  const tagName = opening[1];
  const attrs = opening[2] ?? '';
  const stampedAttrs = stampRouteNavigationAttributes(attrs, segment);
  const stampedOpening = `<${tagName}${stampedAttrs}>`;
  return `${stampedOpening}${value.slice(opening[0].length)}`;
}

function stampRouteNavigationAttributes(
  attrs: string,
  segment: CompiledRouteNavigationSegment,
): string {
  let nextAttrs = setOrAppendAttribute(attrs, 'kovo-nav-segment', segment.id);
  nextAttrs = setOrAppendAttribute(nextAttrs, 'kovo-nav-kind', segment.kind);
  nextAttrs = setOrAppendAttribute(nextAttrs, 'kovo-nav-name', segment.localName);

  if (segment.queries && segment.queries.length > 0) {
    nextAttrs = setOrAppendAttribute(nextAttrs, 'kovo-nav-queries', segment.queries.join(' '));
  }
  if (segment.components && segment.components.length > 0) {
    nextAttrs = setOrAppendAttribute(
      nextAttrs,
      'kovo-nav-components',
      segment.components.join(' '),
    );
  }

  return nextAttrs;
}

function stampLayoutLiveTarget(
  layoutDeclaration: LayoutDeclaration<any, any, any>,
  value: unknown,
): unknown {
  if (typeof value !== 'string') return value;
  const metadata = layoutLiveTargetMetadata.get(layoutDeclaration);
  if (!metadata || metadata.deps.length === 0) return value;

  const opening = /^<([A-Za-z][A-Za-z0-9:-]*)([^>]*)>/.exec(value);
  if (!opening) return value;

  const tagName = opening[1];
  const attrs = opening[2] ?? '';
  const stampedAttrs = stampLayoutAttributes(attrs, metadata);
  const stampedOpening = `<${tagName}${stampedAttrs}>`;
  return `${stampedOpening}${value.slice(opening[0].length)}`;
}

function stampLayoutAttributes(attrs: string, metadata: LayoutLiveTargetMetadata): string {
  const mergedDeps = mergeAttributeTokens(attributeValue(attrs, 'kovo-deps'), metadata.deps);
  let nextAttrs = setOrAppendAttribute(attrs, 'kovo-deps', mergedDeps.join(' '));

  if (
    attributeValue(nextAttrs, 'kovo-fragment-target') === undefined &&
    attributeValue(nextAttrs, 'id') === undefined &&
    attributeValue(nextAttrs, 'kovo-c') === undefined
  ) {
    nextAttrs = setOrAppendAttribute(nextAttrs, 'kovo-fragment-target', metadata.target);
  }

  return nextAttrs;
}

function mergeAttributeTokens(
  existing: string | undefined,
  additions: readonly string[],
): string[] {
  return [
    ...new Set([
      ...(existing ?? '')
        .split(/[\s,]+/)
        .map((token) => token.trim())
        .filter(Boolean),
      ...additions,
    ]),
  ];
}

function attributeValue(attrs: string, name: string): string | undefined {
  const match = attributePattern(name).exec(attrs);
  return match ? unescapeAttribute(match[1] ?? match[2] ?? match[3] ?? '') : undefined;
}

function setOrAppendAttribute(attrs: string, name: string, value: string): string {
  const rendered = `${name}="${escapeAttribute(value)}"`;
  const pattern = attributePattern(name);
  if (pattern.test(attrs)) {
    return attrs.replace(pattern, (match) => `${match.startsWith(' ') ? ' ' : ''}${rendered}`);
  }
  return `${attrs} ${rendered}`;
}

function attributePattern(name: string): RegExp {
  return new RegExp(
    `(?:^|\\s)${escapeRegExp(name)}(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>` +
      '`' +
      `]+)))?(?=\\s|$|/|>)`,
    'i',
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unescapeAttribute(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');
}

/** @internal */
export type RoutePageResult<Page> = RoutePageSuccess<Page> | RoutePageFailure;

/** @internal */
export type RoutePageSuccess<Page> =
  | RoutePageRenderSuccess<Page>
  | RoutePageOutcomeSuccess
  | RoutePageRedirectSuccess;

/** @internal */
export interface RoutePageRenderSuccess<Page> {
  ok: true;
  value: Page;
}

/** @internal */
export interface RoutePageOutcomeSuccess {
  ok: true;
  outcome: RouteResponseOutcome;
}

/** @internal */
export interface RoutePageRedirectSuccess {
  ok: true;
  redirect: Redirect;
}

/** @internal */
export interface RoutePageFailure {
  auth?: ResolvedGuardFailure['auth'];
  error?: {
    code: 'RATE_LIMITED' | 'RENDER_ERROR' | 'UNAUTHORIZED';
    payload: Record<string, unknown>;
  };
  ok: false;
  retryAfter?: number;
  status: 404 | 422 | 429 | 500;
}

type RouteBoundaryKind = keyof RouteBoundaries<any, any>;

interface ResolvedRouteBoundary {
  kind: RouteBoundaryKind;
  render: RouteBoundaryRenderer<any, any>;
}

type RoutePageInternalResult<Page> = RoutePageSuccess<Page> | RoutePageInternalFailure;

interface RoutePageInternalFailure extends RoutePageFailure {
  boundary?: ResolvedRouteBoundary;
  thrown?: unknown;
}

class RouteBoundaryRenderError extends Error {
  constructor(
    readonly thrown: unknown,
    readonly boundary: ResolvedRouteBoundary | undefined,
  ) {
    super('Route boundary render error');
  }
}

function stripRouteBoundaryFailure(failure: RoutePageInternalFailure): RoutePageFailure {
  const { boundary: _boundary, thrown: _thrown, ...publicFailure } = failure;
  return publicFailure;
}

function withRouteBoundaryFailure(
  failure: RoutePageFailure,
  boundary: ResolvedRouteBoundary | undefined,
): RoutePageInternalFailure {
  return {
    ...failure,
    ...(boundary === undefined ? {} : { boundary }),
  };
}

function routeBoundaryFor<Request, Page>(
  kind: RouteBoundaryKind,
  routeDefinition: RouteDeclaration<any, any, any, Request, Page, any> | undefined,
  layouts: readonly LayoutDeclaration<any, any, any>[],
): ResolvedRouteBoundary | undefined {
  const routeBoundary = routeDefinition?.boundaries?.[kind];
  if (routeBoundary) return { kind, render: routeBoundary };

  for (let index = layouts.length - 1; index >= 0; index -= 1) {
    const layoutBoundary = layouts[index]?.boundaries?.[kind];
    if (layoutBoundary) return { kind, render: layoutBoundary };
  }

  return undefined;
}

export function routeHasBoundary(
  definition: RouteDeclaration<any, any, any, any, any, any>,
  kind: RouteBoundaryKind,
): boolean {
  return routeBoundaryFor(kind, definition, routeLayoutChain(definition.layout)) !== undefined;
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
 * @internal
 * @example
 * import { route } from '@kovojs/server';
 * import { renderRoutePageResponse } from '@kovojs/server/internal/route';
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
  options: GuardFailureResponseOptions<Request> & RouteJsxContextOptions<Request> = {},
): Promise<RoutePageResponse> {
  let result: RoutePageInternalResult<Page>;
  let lifecycleRequest: Request = request;
  try {
    lifecycleRequest = await resolveLifecycleRequest(request, options);
    result = await runRoutePageInternal(
      definition,
      input,
      lifecycleRequest,
      routeJsxContextOptions(options),
    );
  } catch (error) {
    reportServerError(options.onError, error, {
      operation: 'route-page',
      request: lifecycleRequest,
      routePath: definition.path,
    });
    return htmlServerErrorResponse();
  }

  if (!result.ok) {
    if (result.boundary && (result.status === 404 || result.status === 500)) {
      if (result.status === 500) {
        reportServerError(options.onError, result.thrown, {
          operation: 'route-page',
          request: lifecycleRequest,
          routePath: definition.path,
        });
      }
      return renderRouteBoundaryResponse(
        result.boundary,
        result.status,
        lifecycleRequest,
        render,
        result.thrown === undefined ? {} : { error: result.thrown },
      );
    }

    const onUnauthenticated = definition.onUnauthenticated ?? options.onUnauthenticated;
    const unauthorizedBoundary = result.boundary;
    const renderForbidden = unauthorizedBoundary
      ? async () => renderRouteBoundaryBody(unauthorizedBoundary, 403, lifecycleRequest, render, {})
      : options.renderForbidden;
    const authResponse = await renderHttpGuardFailureResponse(result, lifecycleRequest, {
      ...options,
      currentUrl: options.currentUrl ?? routeCurrentUrl(definition, input),
      ...(onUnauthenticated === undefined ? {} : { onUnauthenticated }),
      ...(renderForbidden === undefined ? {} : { renderForbidden }),
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

  if ('outcome' in result) {
    return attachLifecycleRequest(routeOutcomeResponse(result.outcome, request), lifecycleRequest);
  }
  // SPEC §6.4: page redirect() → 303 + sanitized Location header.
  if ('redirect' in result) {
    return attachLifecycleRequest({
      body: '',
      headers: { Location: sanitizeNext(result.redirect.location) },
      status: 303,
    }, lifecycleRequest);
  }

  try {
    return attachLifecycleRequest({
      body: await render(result.value),
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 200,
    }, lifecycleRequest);
  } catch (error) {
    reportServerError(options.onError, error, {
      operation: 'route-render',
      request: lifecycleRequest,
      routePath: definition.path,
    });
    return htmlServerErrorResponse();
  }
}

function attachLifecycleRequest<Request>(
  response: RoutePageResponse,
  lifecycleRequest: Request,
): RoutePageResponse {
  Object.defineProperty(response, 'lifecycleRequest', {
    configurable: true,
    enumerable: false,
    value: lifecycleRequest,
  });
  return response;
}

function routeJsxContextOptions<Request>(
  options: GuardFailureResponseOptions<Request> & RouteJsxContextOptions<Request>,
): RouteJsxContextOptions<Request> {
  return {
    ...(options.csrf === undefined ? {} : { csrf: options.csrf }),
    ...(options.mutationFailure === undefined ? {} : { mutationFailure: options.mutationFailure }),
  };
}

async function renderRouteBoundaryResponse<Page, Request>(
  boundary: ResolvedRouteBoundary,
  status: 403 | 404 | 500,
  request: Request,
  render: (value: Page) => string | Promise<string>,
  options: { error?: unknown },
): Promise<RoutePageResponse> {
  return {
    body: await renderRouteBoundaryBody(boundary, status, request, render, options),
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    status,
  };
}

async function renderRouteBoundaryBody<Page, Request>(
  boundary: ResolvedRouteBoundary,
  status: 403 | 404 | 500,
  request: Request,
  render: (value: Page) => string | Promise<string>,
  options: { error?: unknown },
): Promise<string> {
  const value = await boundary.render({
    ...(options.error === undefined ? {} : { error: options.error }),
    request,
    status,
  });
  return render(value as Page);
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

// SPEC §6.4: redirect() returns { location: string, status: 303 }.
function isRedirect(value: unknown): value is Redirect {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    value.status === 303 &&
    'location' in value &&
    typeof (value as { location: unknown }).location === 'string'
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
