import {
  isUntrusted,
  revealUntrusted,
  type ComponentChild,
  type JsonValue,
  type Redirect,
  type RouteSearchValue,
} from '@kovojs/core';
import { kovoTrustedHtmlContent } from '@kovojs/browser/internal/output';
import { substituteRoutePatternParams } from '@kovojs/core/internal/route-pattern';
import { isBlessedSink } from '@kovojs/core/internal/sink-policy';

import { reportServerError } from './diagnostics.js';
import {
  htmlAttributeValue,
  joinHtmlAttributeTokens,
  mergeHtmlAttributeTokens,
  replaceHtmlOpeningTag,
  setOrAppendHtmlAttribute,
  snapshotHtmlOpeningTag,
} from './component-root-stamps.js';
import {
  guardFailureToResult,
  renderHttpGuardFailureResponse,
  runAccessDecisionGuards,
  sanitizeNext,
  withGuardParams,
  type Guard,
  type GuardFailureResponseOptions,
  type RequestLifecycleOptions,
  type ResolvedGuardFailure,
  type UnauthenticatedHandler,
} from './guards.js';
import type { PageHintOptions, RouteMetaSource } from './hints.js';
import type { SignUrlContext } from './capability-route.js';
import { runWithJsxRequestContext } from './jsx-context.js';
import type { CsrfOptions } from './csrf.js';
import { accessDecisionFor, pinAccessDecision, type AccessDecision } from './access.js';
import { createDeferredRegionChunkCollector } from './deferred-region.js';
import { stampGuardFailureDocumentSecurityFloor } from './document-core.js';
import type { DeferredRegionCollector } from './jsx-context.js';
import type { MutationFail } from './mutation.js';
import type { LiveTargetAttestationAuthority } from './live-target-app-identity.js';
import {
  recordQueryRuntimeWarnings,
  runQuery,
  type QueryDefinition,
  type RegisteredQueryDefinition,
} from './query.js';
import {
  htmlServerErrorResponse,
  blessRedirectResponse,
  redirectLocationHeader,
  retryAfterHeaders,
  routeOutcomeResponse,
  type NotFound,
  type RoutePageResponse,
  type RouteResponseOutcome,
} from './response.js';
import { resolveKovoLifecycleRequest } from './response-posture.js';
import { requestSerializeUrlSearchParamsEntries } from './request-body-intrinsics.js';
import { isSchemaValidationError, type Schema, type ValidationFailurePayload } from './schema.js';
import {
  isRenderedHtml,
  renderedHtml,
  renderedHtmlContent,
  renderHtmlValue,
  unwrapCoercedRenderedHtml,
  type RenderedHtml,
} from './html.js';
import {
  securityArrayIsArray,
  securityArrayJoin,
  securityArrayPush,
} from './response-security-intrinsics.js';
import type {
  CompiledRouteNavigationSegment,
  CompiledRoutePageFunction,
  CompiledRoutePageMetadata,
} from './route-ir.js';
import { tagUntrustedRequestValue } from './untrusted-request-body.js';
import {
  createWitnessMap,
  createWitnessSet,
  createWitnessWeakMap,
  witnessArrayAppend,
  witnessCreateNullRecord,
  witnessDefineProperty,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessMapGet,
  witnessMapSet,
  witnessFreeze,
  witnessObjectIs,
  witnessObjectKeys,
  witnessOwnKeys,
  witnessSetAdd,
  witnessSetHas,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';

// Public signatures cannot reference internal subpath types. Keep this type-level
// mirror local while runtime URL construction consumes `internal/route-pattern`.
type PathParamNames<Path extends string> = Path extends `${string}:${infer Rest}`
  ? Rest extends `${infer Param}/${infer Tail}`
    ? Param | PathParamNames<Tail>
    : Rest extends `${infer Param}?${string}`
      ? Param
      : Rest extends `${infer Param}#${string}`
        ? Param
        : Rest
  : never;

type PathParams<Path extends string> =
  PathParamNames<Path> extends never ? {} : Record<PathParamNames<Path>, string>;

type MaybeSchema<Value> = Schema<Value> | undefined;

type RouteParamsFor<Path extends string, ParamsSchema extends MaybeSchema<Record<string, string>>> =
  ParamsSchema extends Schema<infer Params> ? Params : PathParams<Path>;

type RouteSearchFor<SearchSchema extends MaybeSchema<Record<string, RouteSearchValue>>> =
  SearchSchema extends Schema<infer Search> ? Search : Record<string, JsonValue>;

type LayoutQueryMap<Request> = Readonly<Record<string, QueryDefinition<string, any, any, Request>>>;

interface LayoutLiveTargetMetadata {
  deps: readonly string[];
  target: string;
}

const layoutLiveTargetMetadata = createWitnessWeakMap<object, LayoutLiveTargetMetadata>();
const layoutNavigationSegmentIds = createWitnessWeakMap<object, string>();
const routePageMetadata = createWitnessWeakMap<object, CompiledRoutePageMetadata>();
let nextLayoutLiveTargetId = 0;
let nextLayoutNavigationSegmentId = 0;

/** Resolved layout query values passed to a `layout().render` function (SPEC §4.5/§9.5). */
export type LayoutQueryResults<Queries> = {
  [Name in keyof Queries]: Queries[Name] extends QueryDefinition<string, infer Value, any, any>
    ? Awaited<Value>
    : unknown;
};

/** Region values passed to layout render slots when no narrower route contract is declared. */
export type LayoutRegionResults = Readonly<Record<never, never>>;

/** Slots passed to a `layout().render` function: child page/layout HTML plus the lifecycle request. */
export interface LayoutRenderSlots<
  Request,
  Regions extends LayoutRegionResults = LayoutRegionResults,
> {
  /** The child layout or route page output this layout wraps. */
  children: ComponentChild;
  /** Named route-level sibling regions rendered before layout composition (SPEC §4.5/§8). */
  regions: Regions;
  /** The request after configured app lifecycle providers have run. */
  request: Request;
}

/** Context passed to route/layout segment boundary renderers. */
export interface RouteBoundaryContext<Request> {
  error?: unknown;
  request: Request;
  status: 403 | 404 | 500;
}

/** Non-string page body value accepted from public route `page` callbacks (SPEC §4.1, §9.1). */
export type RoutePageResult =
  | boolean
  | null
  | number
  | readonly RoutePageResult[]
  | undefined
  | object;

/** Non-string chrome value accepted from public `layout().render` callbacks (SPEC §4.1, §9.5). */
export type LayoutRenderResult = RoutePageResult;

/** Render a route/layout segment boundary for expected route failures or errors. */
export type RouteBoundaryRenderer<Request, Page extends RoutePageResult = RoutePageResult> = (
  context: RouteBoundaryContext<Request>,
) => Page | Promise<Page>;

/** Per-segment boundaries that override app-level error shells for matching route failures. */
export interface RouteBoundaries<
  Request = unknown,
  Page extends RoutePageResult = RoutePageResult,
> {
  error?: RouteBoundaryRenderer<Request, Page>;
  notFound?: RouteBoundaryRenderer<Request, Page>;
  unauthorized?: RouteBoundaryRenderer<Request, Page>;
}

/** The body passed to `layout()`: optional parent, guard, queries, and chrome render function. */
export interface LayoutDefinition<
  Request = unknown,
  Queries extends LayoutQueryMap<Request> = LayoutQueryMap<Request>,
  Page extends LayoutRenderResult = LayoutRenderResult,
  Regions extends LayoutRegionResults = LayoutRegionResults,
> extends PageHintOptions {
  access?: AccessDecision;
  boundaries?: RouteBoundaries<Request, Page>;
  guard?: Guard<Request>;
  parent?: LayoutDeclaration<Request, any, LayoutRenderResult, any>;
  queries?: Queries;
  render?: (
    queries: LayoutQueryResults<Queries>,
    state: undefined,
    slots: LayoutRenderSlots<Request, Regions>,
  ) => Page | Promise<Page>;
}

/** A first-class page-chrome segment, as returned by `layout()`. */
export interface LayoutDeclaration<
  Request = unknown,
  Queries extends LayoutQueryMap<Request> = LayoutQueryMap<Request>,
  Page extends LayoutRenderResult = LayoutRenderResult,
  Regions extends LayoutRegionResults = LayoutRegionResults,
> extends LayoutDefinition<Request, Queries, Page, Regions> {}

/** App-scoped layout factory whose guards and render slots see the configured request shape. */
export interface LayoutFactory<Request = unknown> {
  <
    const Queries extends LayoutQueryMap<Request> = LayoutQueryMap<Request>,
    Page extends LayoutRenderResult = LayoutRenderResult,
    Regions extends LayoutRegionResults = LayoutRegionResults,
  >(
    definition: LayoutDefinition<Request, Queries, Page, Regions>,
  ): LayoutDeclaration<Request, Queries, Page, Regions>;
}

/** The typed context a route `page` receives: parsed `params`, `search`, the `path`, and `signUrl`. */
export interface RouteRequest<
  Path extends string,
  ParamsSchema extends MaybeSchema<Record<string, string>> = undefined,
  SearchSchema extends MaybeSchema<Record<string, RouteSearchValue>> = undefined,
> {
  params: RouteParamsFor<Path, ParamsSchema>;
  path: Path;
  search: RouteSearchFor<SearchSchema>;
  /**
   * Mint a signed, short-lived, scope-bound capability URL for a stored object (SPEC §6.6 / §9.1).
   * The URL points at the framework-owned download route, whose verify sink runs before any storage
   * read so an object is un-dereferenceable without a token minted for that exact object. Present
   * only when the app mounts exactly one `createStorageDownloadEndpoint({ secret })`; `undefined`
   * otherwise, so a page must handle its absence. The minted URL is a BEARER credential (leakage
   * mitigated by short expiry / narrow scope / optional one-time, NOT proven).
   */
  signUrl?: SignUrlContext['signUrl'];
}

/** The body of a route passed to `route()`: `page`, param/search schemas, guards, and meta/hints. */
export interface RouteDefinition<
  Path extends string,
  ParamsSchema extends MaybeSchema<Record<string, string>> = undefined,
  SearchSchema extends MaybeSchema<Record<string, RouteSearchValue>> = undefined,
  Request = unknown,
  Page extends RoutePageResult = RoutePageResult,
  GuardedRequest extends Request = Request,
  Regions extends RouteRegionDefinitions<any, GuardedRequest, Page> = RouteRegionDefinitions<
    any,
    GuardedRequest,
    Page
  >,
> extends Omit<PageHintOptions, 'meta'> {
  access?: AccessDecision;
  boundaries?: RouteBoundaries<Request, Page>;
  guard?: Guard<Request, GuardedRequest>;
  layout?: LayoutDeclaration<any, any, any, RouteRegionResults<Regions>>;
  meta?:
    | RouteMetaSource<RouteRequest<Path, ParamsSchema, SearchSchema>>
    | readonly RouteMetaSource<RouteRequest<Path, ParamsSchema, SearchSchema>>[];
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
  regions?: Regions &
    RouteRegionDefinitions<RouteRequest<Path, ParamsSchema, SearchSchema>, GuardedRequest, Page>;
  search?: SearchSchema;
  staticPaths?: readonly string[];
}

/** Public route-level sibling region declarations for layout composition (SPEC §4.5/§8). */
export type RouteRegionDefinitions<
  Context = unknown,
  Request = unknown,
  Page extends RoutePageResult = RoutePageResult,
> = Readonly<Record<string, (context: Context, request: Request) => Page | Promise<Page>>>;

/** Resolved route-region values passed to a layout from a route's `regions` declarations. */
export type RouteRegionResults<Regions> =
  Regions extends RouteRegionDefinitions<any, any, any>
    ? Readonly<{
        [Name in keyof Regions]: Regions[Name] extends (...args: any[]) => infer Value
          ? Awaited<Value>
          : unknown;
      }>
    : LayoutRegionResults;

/** A `RouteDefinition` with its `path` attached, as returned by `route()`. */
export interface RouteDeclaration<
  Path extends string,
  ParamsSchema extends MaybeSchema<Record<string, string>> = undefined,
  SearchSchema extends MaybeSchema<Record<string, RouteSearchValue>> = undefined,
  Request = unknown,
  Page extends RoutePageResult = RoutePageResult,
  GuardedRequest extends Request = Request,
> extends RouteDefinition<Path, ParamsSchema, SearchSchema, Request, Page, GuardedRequest, any> {
  path: Path;
}

/** Raw, unparsed `params`/`search` input handed to a route before schema parsing. */
export interface RouteRequestInput {
  params?: unknown;
  search?: unknown;
  /**
   * The `ctx.signUrl` capability the dispatcher threads onto the route context (SPEC §6.6 / §9.1).
   * Built from the framework signing secret via `createSignUrl`; omitted when no secret is configured.
   */
  signUrl?: SignUrlContext['signUrl'];
}

/**
 * Declare a reusable nested layout segment. Layouts compose page chrome around a route `page`;
 * parent layouts wrap child layouts, guards run before the route page, and layout queries load
 * from the same request lifecycle context as route/component queries (SPEC §4.5/§9.5).
 */
export function layout<
  Request = unknown,
  const Queries extends LayoutQueryMap<Request> = LayoutQueryMap<Request>,
  Page extends LayoutRenderResult = LayoutRenderResult,
  Regions extends LayoutRegionResults = LayoutRegionResults,
>(
  definition: LayoutDefinition<Request, Queries, Page, Regions>,
): LayoutDeclaration<Request, Queries, Page, Regions> {
  const closedDefinition = snapshotRouteAuthoringDefinition(
    definition,
    'layout() definition',
  ) as LayoutDeclaration<Request, Queries, Page, Regions>;
  const declaration = pinAccessDecision(closedDefinition, closedDefinition.access);
  const deps: string[] = [];
  const queryDefinitions = closedDefinition.queries ?? witnessCreateNullRecord();
  const queryNames = witnessObjectKeys(queryDefinitions);
  for (let index = 0; index < queryNames.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(queryDefinitions, queryNames[index]!);
    if (descriptor !== undefined && 'value' in descriptor) {
      witnessArrayAppend(deps, descriptor.value.key, 'Layout query dependency');
    }
  }
  if (deps.length > 0) {
    nextLayoutLiveTargetId += 1;
    witnessWeakMapSet(layoutLiveTargetMetadata, declaration, {
      deps,
      target: `kovo-layout-${nextLayoutLiveTargetId}`,
    });
  }
  return witnessFreeze(declaration);
}

/** App-scoped route factory. `createApp()` uses this to contextually type route guards/pages from configured request providers (SPEC §6.4/§9.5). */
export interface RouteFactory<Request = unknown> {
  <
    const Path extends string,
    const ParamsSchema extends MaybeSchema<Record<string, string>> = undefined,
    const SearchSchema extends MaybeSchema<Record<string, RouteSearchValue>> = undefined,
    Page extends RoutePageResult = RoutePageResult,
    Regions extends RouteRegionDefinitions<any, Request, Page> = RouteRegionDefinitions<
      any,
      Request,
      Page
    >,
  >(
    path: Path,
    definition?: RouteDefinition<Path, ParamsSchema, SearchSchema, Request, Page, Request, Regions>,
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
 * import { notFound, route, s, trustedHtml } from '@kovojs/server';
 *
 * const catalog = new Map<string, { name: string }>();
 *
 * export const productRoute = route('/products/:id', {
 *   params: s.object({ id: s.string() }),
 *   page({ params }) {
 *     const product = catalog.get(params.id);
 *     if (!product) return notFound();
 *     return trustedHtml(`<h1>${product.name}</h1>`);
 *   },
 * });
 */
export function route<
  const Path extends string,
  const ParamsSchema extends MaybeSchema<Record<string, string>> = undefined,
  const SearchSchema extends MaybeSchema<Record<string, RouteSearchValue>> = undefined,
  Request = unknown,
  Page extends RoutePageResult = RoutePageResult,
  GuardedRequest extends Request = Request,
  Regions extends RouteRegionDefinitions<any, GuardedRequest, Page> = RouteRegionDefinitions<
    any,
    GuardedRequest,
    Page
  >,
>(
  path: Path,
  definition: RouteDefinition<
    Path,
    ParamsSchema,
    SearchSchema,
    Request,
    Page,
    GuardedRequest,
    Regions
  > = {},
): RouteDeclaration<Path, ParamsSchema, SearchSchema, Request, Page, GuardedRequest> {
  const closedDefinition = snapshotRouteAuthoringDefinition(
    definition,
    'route() definition',
  ) as RouteDefinition<Path, ParamsSchema, SearchSchema, Request, Page, GuardedRequest, Regions>;
  const declarationRecord = closedDefinition as RouteDeclaration<
    Path,
    ParamsSchema,
    SearchSchema,
    Request,
    Page,
    GuardedRequest
  >;
  witnessDefineProperty(declarationRecord, 'path', {
    configurable: true,
    enumerable: true,
    value: path,
    writable: false,
  });
  const declaration = pinAccessDecision(declarationRecord, closedDefinition.access);
  const metadata =
    (closedDefinition.page as CompiledRoutePageFunction | undefined)?.kovoRoutePage ??
    fallbackRoutePageMetadata(path, closedDefinition);
  if (metadata) witnessWeakMapSet(routePageMetadata, declaration, metadata);
  return witnessFreeze(declaration);
}

function snapshotRouteAuthoringDefinition(source: object, label: string): Record<string, unknown> {
  if (typeof source !== 'object' || source === null || witnessIsArray(source)) {
    throw new TypeError(`${label} must be a stable own-data record.`);
  }
  const keys = witnessOwnKeys(source);
  if (keys.length > 100_000) throw new TypeError(`${label} must be bounded.`);
  const snapshot = witnessCreateNullRecord<unknown>() as Record<string, unknown>;
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
      throw new TypeError(`${label}.${key} must be an own data property.`);
    }
    if (!witnessObjectIs(before.value, after.value)) {
      throw new TypeError(`${label}.${key} changed during validation.`);
    }
    witnessDefineProperty(snapshot, key, {
      configurable: true,
      enumerable: before.enumerable === true,
      value: before.value,
      writable: true,
    });
  }
  return snapshot;
}

function fallbackRoutePageMetadata<Path extends string>(
  path: Path,
  definition: RouteDefinition<Path, any, any, any, any, any, any>,
): CompiledRoutePageMetadata | undefined {
  if ((!definition.page && !definition.regions) || !definition.layout) return undefined;
  const layouts = routeLayoutChain(definition.layout);
  const regionSegments = routeRegionSegments(path, witnessObjectKeys(definition.regions ?? {}));
  const navigationSegments: CompiledRouteNavigationSegment[] = [];
  for (let index = 0; index < layouts.length; index += 1) {
    const layoutDeclaration = layouts[index]!;
    const id = layoutNavigationSegmentId(layoutDeclaration);
    const queries: string[] = [];
    const definitions = layoutDeclaration.queries ?? {};
    const names = witnessObjectKeys(definitions);
    for (let queryIndex = 0; queryIndex < names.length; queryIndex += 1) {
      const descriptor = witnessGetOwnPropertyDescriptor(definitions, names[queryIndex]!);
      if (descriptor !== undefined && 'value' in descriptor) {
        witnessArrayAppend(
          queries,
          (descriptor.value as RegisteredQueryDefinition).key,
          'Route layout query key',
        );
      }
    }
    witnessArrayAppend(
      navigationSegments,
      { id, kind: 'layout', localName: id, queries },
      'Route layout navigation metadata',
    );
  }
  if (regionSegments.length > 0) {
    for (let index = 0; index < regionSegments.length; index += 1) {
      witnessArrayAppend(
        navigationSegments,
        regionSegments[index]!,
        'Route region navigation metadata',
      );
    }
  } else {
    witnessArrayAppend(
      navigationSegments,
      { components: [], id: `page:${path}`, kind: 'page', localName: 'page' },
      'Route page navigation metadata',
    );
  }
  return {
    components: [],
    fileName: '',
    navigationSegments,
    route: path,
  };
}

function routeRegionSegments(
  path: string,
  regionNames: readonly string[],
): CompiledRouteNavigationSegment[] {
  const segments: CompiledRouteNavigationSegment[] = [];
  for (let index = 0; index < regionNames.length; index += 1) {
    const name = regionNames[index]!;
    witnessArrayAppend(
      segments,
      {
        components: [],
        id: name === 'page' ? `page:${path}` : `region:${name}`,
        kind: name === 'page' ? 'page' : 'region',
        localName: name,
      },
      'Route region navigation segment',
    );
  }
  return segments;
}

function layoutNavigationSegmentId(layoutDeclaration: LayoutDeclaration<any, any, any>): string {
  const existing = witnessWeakMapGet(layoutNavigationSegmentIds, layoutDeclaration);
  if (existing) return existing;

  nextLayoutNavigationSegmentId += 1;
  const id = `layout:${nextLayoutNavigationSegmentId}`;
  witnessWeakMapSet(layoutNavigationSegmentIds, layoutDeclaration, id);
  return id;
}

export function parseRouteRequest<
  const Path extends string,
  ParamsSchema extends MaybeSchema<Record<string, string>>,
  SearchSchema extends MaybeSchema<Record<string, RouteSearchValue>>,
  Request,
  Page extends RoutePageResult,
>(
  definition: RouteDeclaration<Path, ParamsSchema, SearchSchema, Request, Page>,
  input: RouteRequestInput = {},
): RouteRequest<Path, ParamsSchema, SearchSchema> {
  const rawParams = tagUntrustedRequestValue(input.params ?? {});
  const rawSearch = tagUntrustedRequestValue(input.search ?? {});
  const params = definition.params
    ? definition.params.parse(rawParams)
    : (revealRouteRequestValue(rawParams) as RouteParamsFor<Path, ParamsSchema>);
  const search = definition.search
    ? definition.search.parse(rawSearch)
    : (revealRouteRequestValue(rawSearch) as RouteSearchFor<SearchSchema>);

  return {
    params: params as RouteParamsFor<Path, ParamsSchema>,
    path: definition.path,
    search: search as RouteSearchFor<SearchSchema>,
    // Thread `ctx.signUrl` onto the page context when the dispatcher supplied it (SPEC §6.6 / §9.1).
    ...(input.signUrl === undefined ? {} : { signUrl: input.signUrl }),
  };
}

function revealRouteRequestValue(value: unknown): unknown {
  // SPEC §5.2 rule 11 / §9.1: path params and URL search values are request-derived, so the
  // parser tags them before validation. Routes without explicit schemas retain Kovo's historical
  // typed-string fallback; reveal only after route matching has selected this declaration.
  if (isUntrusted(value)) {
    return revealRouteRequestValue(
      revealUntrusted(value, 'matched route request value without explicit schema'),
    );
  }
  if (witnessIsArray(value)) {
    const revealed: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = witnessGetOwnPropertyDescriptor(value, index);
      if (descriptor === undefined || !('value' in descriptor)) {
        throw new TypeError('Route request arrays must contain stable own data properties.');
      }
      witnessArrayAppend(
        revealed,
        revealRouteRequestValue(descriptor.value),
        'Route request value snapshot',
      );
    }
    return revealed;
  }
  if (typeof value === 'object' && value !== null) {
    const record = witnessCreateNullRecord<unknown>() as Record<string, unknown>;
    const keys = witnessObjectKeys(value);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      const descriptor = witnessGetOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !('value' in descriptor)) {
        throw new TypeError(`Route request value ${key} must be a stable own data property.`);
      }
      record[key] = revealRouteRequestValue(descriptor.value);
    }
    return record;
  }
  return value;
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
  attestationAuthority?: LiveTargetAttestationAuthority;
  csrf?: CsrfOptions<Request>;
  deferredRegions?: DeferredRegionCollector;
  maxListItems?: number;
  mutationFailure?: {
    failure: MutationFail;
    input?: unknown;
    mutationKey: string;
    target?: string;
  };
  onCsrfSetCookie?: (rawSetCookie: string) => void;
}

/**
 * Authorize one already-matched route without running its page, layout queries, or renderers.
 * Dev HMR consumes the returned lifecycle request before any live-target query can run, so a
 * fragment refresh cannot become a cross-route authorization side channel (SPEC §§6.6, 8, 9.3,
 * 9.5.1).
 *
 * @internal
 */
export async function authorizeRouteRequest<
  const Path extends string,
  ParamsSchema extends MaybeSchema<Record<string, string>>,
  SearchSchema extends MaybeSchema<Record<string, RouteSearchValue>>,
  Request,
  Page extends RoutePageResult,
  GuardedRequest extends Request = Request,
>(
  definition: RouteDeclaration<Path, ParamsSchema, SearchSchema, Request, Page, GuardedRequest>,
  input: RouteRequestInput,
  request: Request,
  options: RequestLifecycleOptions<Request> = {},
): Promise<RouteAuthorizationResult<Request>> {
  const authorization = await resolveRouteAuthorization(definition, input, request, options);
  return authorization.ok
    ? witnessFreeze({ ok: true as const, request: authorization.request })
    : witnessFreeze({
        failure: stripRouteBoundaryFailure(authorization.failure),
        ok: false as const,
      });
}

async function resolveRouteAuthorization<
  const Path extends string,
  ParamsSchema extends MaybeSchema<Record<string, string>>,
  SearchSchema extends MaybeSchema<Record<string, RouteSearchValue>>,
  Request,
  Page extends RoutePageResult,
  GuardedRequest extends Request = Request,
>(
  definition: RouteDeclaration<Path, ParamsSchema, SearchSchema, Request, Page, GuardedRequest>,
  input: RouteRequestInput,
  request: Request,
  options: RequestLifecycleOptions<Request> = {},
): Promise<RouteAuthorizationInternalResult<Path, ParamsSchema, SearchSchema, Request>> {
  let routeRequest: RouteRequest<Path, ParamsSchema, SearchSchema>;
  try {
    routeRequest = parseRouteRequest(definition, input);
  } catch (error) {
    if (isSchemaValidationError(error)) {
      return {
        failure: {
          error: {
            code: 'VALIDATION',
            payload: { issues: error.issues } satisfies ValidationFailurePayload,
          },
          ok: false,
          status: 422,
        },
        ok: false,
      };
    }
    throw error;
  }

  // Resolve the same lifecycle inputs a direct document request uses. The returned request is the
  // exact pinned carrier the guards consumed; HMR must never fall back to its raw endpoint request
  // after this decision (SPEC §6.6 classify-and-pin).
  const resolvedRequest = await resolveKovoLifecycleRequest(request, {
    ...(options.clientIp === undefined ? {} : { clientIp: options.clientIp }),
    ...(options.db === undefined ? {} : { db: options.db }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    ...(options.onSessionSetCookie === undefined
      ? {}
      : { onSessionSetCookie: options.onSessionSetCookie }),
    ...(options.sessionProvider === undefined ? {} : { sessionProvider: options.sessionProvider }),
    surface: 'document',
  });
  // SPEC §10.3 guard arguments and §6.4 route identity: attach only schema-validated params before
  // either layout or route access runs. The successful result preserves this exact request carrier
  // for downstream live-target queries, so authorization and data selection cannot disagree.
  const lifecycleRequest =
    definition.params === undefined
      ? resolvedRequest
      : (withGuardParams(resolvedRequest, routeRequest.params) as typeof resolvedRequest);
  const layouts = routeLayoutChain(definition.layout);

  for (let index = 0; index < layouts.length; index += 1) {
    const layoutDeclaration = layouts[index];
    if (!layoutDeclaration) continue;
    const guardFailure = await runAccessDecisionGuards(
      accessDecisionFor(layoutDeclaration),
      layoutDeclaration.guard,
      lifecycleRequest,
    );
    if (guardFailure) {
      return {
        failure: withRouteBoundaryFailure(
          routeGuardFailure(guardFailure),
          routeBoundaryFor('unauthorized', undefined, routeLayoutChainPrefix(layouts, index + 1)),
        ),
        ok: false,
      };
    }
  }

  const guardFailure = await runAccessDecisionGuards(
    accessDecisionFor(definition),
    definition.guard,
    lifecycleRequest,
  );
  if (guardFailure) {
    return {
      failure: withRouteBoundaryFailure(
        routeGuardFailure(guardFailure),
        routeBoundaryFor('unauthorized', definition, layouts),
      ),
      ok: false,
    };
  }

  return { layouts, ok: true, request: lifecycleRequest, routeRequest };
}

/**
 * Run a route page directly for framework dispatch and conformance fixtures.
 *
 * @internal
 */
export async function runRoutePage<
  const Path extends string,
  ParamsSchema extends MaybeSchema<Record<string, string>>,
  SearchSchema extends MaybeSchema<Record<string, RouteSearchValue>>,
  Request,
  Page extends RoutePageResult,
  GuardedRequest extends Request = Request,
>(
  definition: RouteDeclaration<Path, ParamsSchema, SearchSchema, Request, Page, GuardedRequest>,
  input: RouteRequestInput,
  request: Request,
  options: RequestLifecycleOptions<Request> = {},
): Promise<RoutePageRunResult<Page>> {
  const result = await runRoutePageInternal(definition, input, request, options);
  if (result.ok) return result;
  return stripRouteBoundaryFailure(result);
}

async function runRoutePageInternal<
  const Path extends string,
  ParamsSchema extends MaybeSchema<Record<string, string>>,
  SearchSchema extends MaybeSchema<Record<string, RouteSearchValue>>,
  Request,
  Page extends RoutePageResult,
  GuardedRequest extends Request = Request,
>(
  definition: RouteDeclaration<Path, ParamsSchema, SearchSchema, Request, Page, GuardedRequest>,
  input: RouteRequestInput,
  request: Request,
  options: RequestLifecycleOptions<Request> & RouteJsxContextOptions<Request> = {},
): Promise<RoutePageInternalResult<Page>> {
  const authorization = await resolveRouteAuthorization(definition, input, request, options);
  if (!authorization.ok) return authorization.failure;
  const lifecycleRequest = authorization.request;
  const routeRequest = authorization.routeRequest;
  const layouts = authorization.layouts;

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
        const regions = await renderRouteRegions(
          definition,
          routeRequest,
          lifecycleRequest as GuardedRequest,
          metadata,
        );
        const childValue = pageValue ?? regions.page;
        return renderLayoutChain(
          layouts,
          stampRoutePageSegment(metadata, childValue),
          lifecycleRequest,
          metadata,
          regions,
          options.maxListItems,
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
  return guardFailureToResult(failure);
}

function getRoutePageMetadata(
  definition: RouteDefinition<any, any, any, any, any, any, any>,
): CompiledRoutePageMetadata | undefined {
  const metadata =
    witnessWeakMapGet(routePageMetadata, definition) ??
    (definition.page as CompiledRoutePageFunction | undefined)?.kovoRoutePage ??
    fallbackRouteDeclarationMetadata(definition);
  if (metadata) witnessWeakMapSet(routePageMetadata, definition, metadata);
  return metadata;
}

function fallbackRouteDeclarationMetadata(
  definition: RouteDefinition<any, any, any, any, any, any, any>,
): CompiledRoutePageMetadata | undefined {
  if (!('path' in definition) || typeof definition.path !== 'string') return undefined;
  return fallbackRoutePageMetadata(definition.path, definition);
}

function routeLayoutChain(
  layoutDeclaration: LayoutDeclaration<any, any, any> | undefined,
): LayoutDeclaration<any, any, any>[] {
  const reversed: LayoutDeclaration<any, any, any>[] = [];
  const seen = createWitnessSet<LayoutDeclaration<any, any, any>>();
  let current = layoutDeclaration;

  while (current) {
    if (witnessSetHas(seen, current)) {
      throw new Error('Cyclic route layout parent chain.');
    }
    witnessSetAdd(seen, current);
    witnessArrayAppend(reversed, current, 'Route layout parent chain');
    current = current.parent;
  }

  const chain: LayoutDeclaration<any, any, any>[] = [];
  for (let index = reversed.length - 1; index >= 0; index -= 1) {
    witnessArrayAppend(chain, reversed[index]!, 'Route layout chain');
  }
  return chain;
}

async function renderLayoutChain<Request>(
  layouts: readonly LayoutDeclaration<any, any, any>[],
  pageValue: unknown,
  request: Request,
  metadata: CompiledRoutePageMetadata | undefined,
  regions: Readonly<Record<string, unknown>> = {},
  maxListItems?: number,
): Promise<unknown> {
  const layoutSegments = routeLayoutSegments(metadata);
  let value = pageValue;
  for (let index = layouts.length - 1; index >= 0; index -= 1) {
    const layoutDeclaration = layouts[index];
    if (!layoutDeclaration) continue;
    if (!layoutDeclaration.render) continue;
    try {
      const queries = await loadLayoutQueries(layoutDeclaration, request, maxListItems);
      value = await layoutDeclaration.render(queries, undefined, {
        children: value as ComponentChild,
        regions,
        request,
      });
      value = stampLayoutLiveTarget(layoutDeclaration, value);
      value = stampRouteNavigationSegment(layoutSegments[index], value);
    } catch (error) {
      throw new RouteBoundaryRenderError(
        error,
        routeBoundaryFor('error', undefined, routeLayoutChainPrefix(layouts, index + 1)),
      );
    }
  }
  return value;
}

function routeLayoutChainPrefix(
  layouts: readonly LayoutDeclaration<any, any, any>[],
  endExclusive: number,
): LayoutDeclaration<any, any, any>[] {
  // SPEC §6.6/§9.5: only layout segments whose guards have already run may supply a failure
  // boundary. App evaluation shares this realm, so an ambient Array.slice must not widen the
  // authorized prefix to include an unverified descendant.
  const prefix: LayoutDeclaration<any, any, any>[] = [];
  for (let index = 0; index < endExclusive && index < layouts.length; index += 1) {
    witnessArrayAppend(prefix, layouts[index]!, 'Verified route layout boundary prefix');
  }
  return prefix;
}

async function renderRouteRegions<
  const Path extends string,
  ParamsSchema extends MaybeSchema<Record<string, string>>,
  SearchSchema extends MaybeSchema<Record<string, RouteSearchValue>>,
  Request,
  Page extends RoutePageResult,
  GuardedRequest extends Request,
>(
  definition: RouteDeclaration<Path, ParamsSchema, SearchSchema, Request, Page, GuardedRequest>,
  routeRequest: RouteRequest<Path, ParamsSchema, SearchSchema>,
  request: GuardedRequest,
  metadata: CompiledRoutePageMetadata | undefined,
): Promise<Readonly<Record<string, unknown>>> {
  type RegionRenderer = (
    context: RouteRequest<Path, ParamsSchema, SearchSchema>,
    request: GuardedRequest,
  ) => Page | Promise<Page>;
  const regionDefinitions = definition.regions ?? {};
  const names = witnessObjectKeys(regionDefinitions);
  if (names.length === 0) return witnessCreateNullRecord<unknown>();
  const rendered = witnessCreateNullRecord<unknown>() as Record<string, unknown>;
  const segments = routeRegionNavigationSegments(metadata);
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]!;
    const descriptor = witnessGetOwnPropertyDescriptor(regionDefinitions, name);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'function'
    ) {
      throw new TypeError(`Route region ${name} must be an own renderer data property.`);
    }
    const render = descriptor.value as RegionRenderer;
    const value = await render(routeRequest, request);
    rendered[name] = stampRouteNavigationSegment(
      witnessMapGet(segments as Map<string, CompiledRouteNavigationSegment>, name),
      value,
    );
  }
  return rendered;
}

async function loadLayoutQueries<Request>(
  layoutDeclaration: LayoutDeclaration<any, any, any>,
  request: Request,
  maxListItems?: number,
): Promise<LayoutQueryResults<LayoutQueryMap<any>>> {
  const values = witnessCreateNullRecord<unknown>() as Record<string, unknown>;

  const queryDefinitions = layoutDeclaration.queries ?? {};
  const names = witnessObjectKeys(queryDefinitions);
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]!;
    const descriptor = witnessGetOwnPropertyDescriptor(queryDefinitions, name);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError(`Layout query ${name} must be an own data property.`);
    }
    const queryDefinition = descriptor.value;
    const result = await runQuery(
      queryDefinition as QueryDefinition<string, unknown, unknown, Request>,
      undefined,
      request,
      maxListItems === undefined ? {} : { maxListItems },
    );
    if (!result.ok) {
      throw new Error(`Layout query '${name}' failed with ${result.error.code}.`);
    }
    recordQueryRuntimeWarnings(request, result.warnings);
    values[name] = result.value;
  }

  return values as LayoutQueryResults<LayoutQueryMap<any>>;
}

function stampRoutePageSegment(
  metadata: CompiledRoutePageMetadata | undefined,
  value: unknown,
): unknown {
  const segments = metadata?.navigationSegments ?? [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment?.kind === 'page') return stampRouteNavigationSegment(segment, value);
  }
  return value;
}

function routeRegionNavigationSegments(
  metadata: CompiledRoutePageMetadata | undefined,
): ReadonlyMap<string, CompiledRouteNavigationSegment> {
  const segments = createWitnessMap<string, CompiledRouteNavigationSegment>();
  const navigationSegments = metadata?.navigationSegments ?? [];
  for (let index = 0; index < navigationSegments.length; index += 1) {
    const segment = navigationSegments[index]!;
    if (segment.kind === 'layout') continue;
    witnessMapSet(segments, segment.localName, segment);
  }
  return segments;
}

function routeLayoutSegments(
  metadata: CompiledRoutePageMetadata | undefined,
): readonly (CompiledRouteNavigationSegment | undefined)[] {
  const layouts: CompiledRouteNavigationSegment[] = [];
  const navigationSegments = metadata?.navigationSegments ?? [];
  for (let index = 0; index < navigationSegments.length; index += 1) {
    const segment = navigationSegments[index]!;
    if (segment.kind === 'layout') {
      witnessArrayAppend(layouts, segment, 'Route layout navigation segment');
    }
  }
  return layouts;
}

function stampRouteNavigationSegment(
  segment: CompiledRouteNavigationSegment | undefined,
  value: unknown,
): unknown {
  const rendered = stampableRouteHtml(value);
  if (!segment || !rendered) return value;

  const html = renderedHtmlContent(rendered);
  const opening = snapshotHtmlOpeningTag(html);
  if (opening === undefined) return value;

  return renderedHtml(
    replaceHtmlOpeningTag(html, opening, stampRouteNavigationAttributes(opening.attrs, segment)),
  );
}

function stampRouteNavigationAttributes(
  attrs: string,
  segment: CompiledRouteNavigationSegment,
): string {
  const id = routeStampOwnString(segment, 'id', 'Route navigation segment');
  const kind = routeStampOwnString(segment, 'kind', 'Route navigation segment');
  const localName = routeStampOwnString(segment, 'localName', 'Route navigation segment');
  const queries = routeStampOptionalStringArray(segment, 'queries', 'Route navigation segment');
  const components = routeStampOptionalStringArray(
    segment,
    'components',
    'Route navigation segment',
  );

  let nextAttrs = setOrAppendHtmlAttribute(attrs, 'kovo-nav-segment', id);
  nextAttrs = setOrAppendHtmlAttribute(nextAttrs, 'kovo-nav-kind', kind);
  nextAttrs = setOrAppendHtmlAttribute(nextAttrs, 'kovo-nav-name', localName);

  if (queries !== undefined && queries.length > 0) {
    nextAttrs = setOrAppendHtmlAttribute(
      nextAttrs,
      'kovo-nav-queries',
      securityArrayJoin(queries, ' '),
    );
  }
  if (components !== undefined && components.length > 0) {
    nextAttrs = setOrAppendHtmlAttribute(
      nextAttrs,
      'kovo-nav-components',
      securityArrayJoin(components, ' '),
    );
  }

  return nextAttrs;
}

function stampLayoutLiveTarget(
  layoutDeclaration: LayoutDeclaration<any, any, any>,
  value: unknown,
): unknown {
  const rendered = stampableRouteHtml(value);
  if (!rendered) return value;
  const metadata = witnessWeakMapGet(layoutLiveTargetMetadata, layoutDeclaration);
  if (!metadata) return value;

  const html = renderedHtmlContent(rendered);
  const opening = snapshotHtmlOpeningTag(html);
  if (opening === undefined) return value;

  return renderedHtml(
    replaceHtmlOpeningTag(html, opening, stampLayoutAttributes(opening.attrs, metadata)),
  );
}

function stampableRouteHtml(value: unknown): RenderedHtml | undefined {
  if (isRenderedHtml(value)) return value;
  const trusted = kovoTrustedHtmlContent(value);
  if (trusted !== '') return renderedHtml(trusted);
  if (typeof value === 'string') return renderedHtml(unwrapCoercedRenderedHtml(value));
  return undefined;
}

function stampLayoutAttributes(attrs: string, metadata: LayoutLiveTargetMetadata): string {
  const deps = routeStampOwnStringArray(metadata, 'deps', 'Layout live-target metadata');
  const target = routeStampOwnString(metadata, 'target', 'Layout live-target metadata');
  if (deps.length === 0) return attrs;
  const mergedDeps = mergeHtmlAttributeTokens(htmlAttributeValue(attrs, 'kovo-deps'), deps);
  let nextAttrs = setOrAppendHtmlAttribute(attrs, 'kovo-deps', joinHtmlAttributeTokens(mergedDeps));

  if (
    htmlAttributeValue(nextAttrs, 'kovo-fragment-target') === undefined &&
    htmlAttributeValue(nextAttrs, 'id') === undefined &&
    htmlAttributeValue(nextAttrs, 'kovo-c') === undefined
  ) {
    nextAttrs = setOrAppendHtmlAttribute(nextAttrs, 'kovo-fragment-target', target);
  }

  return nextAttrs;
}

function routeStampOwnString(value: object, property: PropertyKey, label: string): string {
  const descriptor = witnessGetOwnPropertyDescriptor(value, property);
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    typeof descriptor.value !== 'string'
  ) {
    throw new TypeError(`${label}.${String(property)} must be an own string data property.`);
  }
  return descriptor.value;
}

function routeStampOwnStringArray(value: object, property: PropertyKey, label: string): string[] {
  const snapshot = routeStampOptionalStringArray(value, property, label);
  if (snapshot === undefined) {
    throw new TypeError(`${label}.${String(property)} must be an own dense string array.`);
  }
  return snapshot;
}

function routeStampOptionalStringArray(
  value: object,
  property: PropertyKey,
  label: string,
): string[] | undefined {
  const descriptor = witnessGetOwnPropertyDescriptor(value, property);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor) || !securityArrayIsArray(descriptor.value)) {
    throw new TypeError(`${label}.${String(property)} must be an own dense string array.`);
  }
  const source = descriptor.value;
  const length = witnessGetOwnPropertyDescriptor(source, 'length');
  if (
    length === undefined ||
    !('value' in length) ||
    typeof length.value !== 'number' ||
    length.value < 0 ||
    length.value % 1 !== 0
  ) {
    throw new TypeError(`${label}.${String(property)} must expose a stable dense length.`);
  }
  const snapshot: string[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const entry = witnessGetOwnPropertyDescriptor(source, index);
    if (entry === undefined || !('value' in entry) || typeof entry.value !== 'string') {
      throw new TypeError(`${label}.${String(property)} must contain own string data entries.`);
    }
    securityArrayPush(snapshot, entry.value);
  }
  return snapshot;
}

/** @internal */
export type RoutePageRunResult<Page extends RoutePageResult> =
  | RoutePageFailure
  | RoutePageRunSuccess<Page>;

/** @internal */
export type RoutePageRunSuccess<Page extends RoutePageResult> =
  | RoutePageRenderSuccess<Page>
  | RoutePageOutcomeSuccess
  | RoutePageRedirectSuccess;

/** @internal */
export interface RoutePageRenderSuccess<Page extends RoutePageResult> {
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
    code: 'RATE_LIMITED' | 'RENDER_ERROR' | 'UNAUTHORIZED' | 'VALIDATION';
    payload: Record<string, unknown>;
  };
  ok: false;
  retryAfter?: number;
  status: 404 | 422 | 429 | 500;
}

/** @internal Exact route-authorization result consumed by dev refresh dispatch. */
export type RouteAuthorizationResult<Request> =
  | {
      failure: RoutePageFailure;
      ok: false;
    }
  | {
      ok: true;
      request: Request;
    };

type RouteBoundaryKind = keyof RouteBoundaries<any, any>;

interface ResolvedRouteBoundary {
  kind: RouteBoundaryKind;
  render: RouteBoundaryRenderer<any, any>;
}

type RoutePageInternalResult<Page extends RoutePageResult> =
  | RoutePageRunSuccess<Page>
  | RoutePageInternalFailure;

interface RoutePageInternalFailure extends RoutePageFailure {
  boundary?: ResolvedRouteBoundary;
  thrown?: unknown;
}

type RouteAuthorizationInternalResult<
  Path extends string,
  ParamsSchema extends MaybeSchema<Record<string, string>>,
  SearchSchema extends MaybeSchema<Record<string, RouteSearchValue>>,
  Request,
> =
  | {
      failure: RoutePageInternalFailure;
      ok: false;
    }
  | {
      layouts: LayoutDeclaration<any, any, any>[];
      ok: true;
      request: Request;
      routeRequest: RouteRequest<Path, ParamsSchema, SearchSchema>;
    };

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

function routeBoundaryFor<Request, Page extends RoutePageResult>(
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
 * headers, body), or a guard-failure response. The default `render` unwraps
 * framework-rendered JSX HTML and escapes plain strings as text; pass a custom
 * `render` to wrap legacy/raw values in a document (SPEC §6.4, §5.2).
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
 * const homeRoute = route('/', { page: () => <h1>Home</h1> });
 *
 * export function renderHome() {
 *   return renderRoutePageResponse(homeRoute, {}, {});
 * }
 */
export async function renderRoutePageResponse<
  const Path extends string,
  ParamsSchema extends MaybeSchema<Record<string, string>>,
  SearchSchema extends MaybeSchema<Record<string, RouteSearchValue>>,
  Request,
  Page extends RoutePageResult,
  GuardedRequest extends Request = Request,
>(
  definition: RouteDeclaration<Path, ParamsSchema, SearchSchema, Request, Page, GuardedRequest>,
  input: RouteRequestInput,
  request: Request,
  render: (value: Page) => string | Promise<string> = renderHtmlValue,
  options: GuardFailureResponseOptions<Request> & RouteJsxContextOptions<Request> = {},
): Promise<RoutePageResponse> {
  let result: RoutePageInternalResult<Page>;
  let lifecycleRequest: Request = request;
  const deferredRegions = createDeferredRegionChunkCollector();
  try {
    lifecycleRequest = await resolveKovoLifecycleRequest(request, {
      ...(options.clientIp === undefined ? {} : { clientIp: options.clientIp }),
      ...(options.db === undefined ? {} : { db: options.db }),
      ...(options.onError === undefined ? {} : { onError: options.onError }),
      ...(options.onSessionSetCookie === undefined
        ? {}
        : { onSessionSetCookie: options.onSessionSetCookie }),
      ...(options.sessionProvider === undefined
        ? {}
        : { sessionProvider: options.sessionProvider }),
      surface: 'document',
    });
    result = await runRoutePageInternal(
      definition,
      input,
      lifecycleRequest,
      routeJsxContextOptions(options, deferredRegions),
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
    if (result.error?.code === 'VALIDATION') {
      return {
        body: 'Validation Failed',
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        status: 422,
      };
    }

    if (result.boundary && (result.status === 404 || result.status === 500)) {
      if (result.status === 500) {
        reportServerError(options.onError, result.thrown, {
          operation: 'route-page',
          request: lifecycleRequest,
          routePath: definition.path,
        });
      }
      return attachLifecycleRequest(
        await renderRouteBoundaryResponse(
          result.boundary,
          result.status,
          lifecycleRequest,
          render,
          result.thrown === undefined ? {} : { error: result.thrown },
        ),
        lifecycleRequest,
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

    return stampGuardFailureDocumentSecurityFloor({
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
    });
  }

  if ('outcome' in result) {
    return attachLifecycleRequest(routeOutcomeResponse(result.outcome, request), lifecycleRequest);
  }
  // SPEC §6.4: page redirect() → 303 + sanitized Location header.
  if ('redirect' in result) {
    return attachLifecycleRequest(
      blessRedirectResponse({
        body: '',
        headers: { Location: redirectLocationHeader(sanitizeNext(result.redirect.location)) },
        status: 303,
      }),
      lifecycleRequest,
    );
  }

  try {
    const body = await render(result.value);
    const deferredChunks = deferredRegions.pendingChunks();
    return attachLifecycleRequest(
      {
        body,
        ...(deferredChunks.length === 0 ? {} : { deferredChunks }),
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        status: 200,
      },
      lifecycleRequest,
    );
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
  witnessDefineProperty(response, 'lifecycleRequest', {
    configurable: true,
    enumerable: false,
    value: lifecycleRequest,
  });
  return response;
}

function routeJsxContextOptions<Request>(
  options: GuardFailureResponseOptions<Request> & RouteJsxContextOptions<Request>,
  deferredRegions?: DeferredRegionCollector,
): RouteJsxContextOptions<Request> {
  return {
    ...(options.attestationAuthority === undefined
      ? {}
      : { attestationAuthority: options.attestationAuthority }),
    ...(options.csrf === undefined ? {} : { csrf: options.csrf }),
    ...(deferredRegions === undefined && options.deferredRegions === undefined
      ? {}
      : { deferredRegions: deferredRegions ?? options.deferredRegions }),
    ...(options.maxListItems === undefined ? {} : { maxListItems: options.maxListItems }),
    ...(options.mutationFailure === undefined ? {} : { mutationFailure: options.mutationFailure }),
    ...(options.onCsrfSetCookie === undefined ? {} : { onCsrfSetCookie: options.onCsrfSetCookie }),
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
  SearchSchema extends MaybeSchema<Record<string, RouteSearchValue>>,
  Request,
  Page extends RoutePageResult,
>(
  definition: RouteDeclaration<Path, ParamsSchema, SearchSchema, Request, Page>,
  input: RouteRequestInput,
): string {
  const routeRequest = parseRouteRequest(definition, input);
  const routeParams = witnessCreateNullRecord<string>() as Record<string, string>;
  const paramSource = routeRequest.params as Record<string, unknown>;
  const paramNames = witnessObjectKeys(paramSource);
  for (let index = 0; index < paramNames.length; index += 1) {
    const key = paramNames[index]!;
    const descriptor = witnessGetOwnPropertyDescriptor(paramSource, key);
    if (descriptor !== undefined && 'value' in descriptor) {
      routeParams[key] = searchParamValue(descriptor.value);
    }
  }
  const pathname = substituteRoutePatternParams(definition.path, routeParams);
  const search = searchParamsString(routeRequest.search as Record<string, unknown>);

  return search ? `${pathname}?${search}` : pathname;
}

function searchParamsString(search: Record<string, unknown>): string {
  const entries: [string, string][] = [];
  const keys = witnessObjectKeys(search);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const descriptor = witnessGetOwnPropertyDescriptor(search, key);
    if (descriptor !== undefined && 'value' in descriptor) {
      appendSearchParams(entries, key, descriptor.value);
    }
  }
  return requestSerializeUrlSearchParamsEntries(entries);
}

function appendSearchParams(entries: [string, string][], key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (witnessIsArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = witnessGetOwnPropertyDescriptor(value, index);
      if (descriptor !== undefined && 'value' in descriptor) {
        appendSearchParams(entries, key, descriptor.value);
      }
    }
    return;
  }
  witnessArrayAppend(entries, [key, searchParamValue(value)], 'Route URL search entry');
}

function searchParamValue(value: unknown): string {
  if (isUntrusted(value)) {
    return searchParamValue(revealUntrusted(value, 'matched route request URL reconstruction'));
  }
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

// SPEC §6.4: redirect() returns { location: string, status: 303 }. Vite module
// runner boundaries can drop the non-enumerable blessed witness, so the route
// shell also treats the exact structural redirect shape as a fail-closed
// non-document outcome instead of rendering it into status-200 HTML.
function isRedirect(value: unknown): value is Redirect {
  return (
    typeof value === 'object' &&
    value !== null &&
    (isBlessedSink('core:route-redirect', value) || isStructuralRouteRedirect(value)) &&
    'status' in value &&
    value.status === 303 &&
    'location' in value &&
    typeof (value as { location: unknown }).location === 'string'
  );
}

function isStructuralRouteRedirect(value: object): boolean {
  const keys = witnessObjectKeys(value);
  if (keys.length !== 2) return false;
  let location = false;
  let status = false;
  for (let index = 0; index < keys.length; index += 1) {
    if (keys[index] === 'location') location = true;
    if (keys[index] === 'status') status = true;
  }
  return location && status;
}

function isRouteResponseOutcome(value: unknown): value is RouteResponseOutcome {
  return (
    typeof value === 'object' &&
    value !== null &&
    'routeResponse' in value &&
    value.routeResponse === true
  );
}
