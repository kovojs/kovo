/**
 * @internal Shared route pattern parser, normalizer, matcher, and href builder.
 * SPEC §6.4 makes typed route hrefs/redirects derive from the declared route
 * pattern; SPEC §9.5 makes canonical route matching, KV228 ambiguity, and static
 * export replay consume that same pattern contract.
 */

/** @internal Minimal route projection accepted by the shared matcher. */
export interface RouteLike<Path extends string = string> {
  path: Path;
}

/** @internal Normalized request/pathname metadata. */
export interface PathnameNormalization {
  inputPathname: string;
  pathname: string;
  redirect?: {
    pathname: string;
    status: 308;
  };
  trailingSlash: 'canonical' | 'removed';
}

/** @internal Parsed route pattern segment. */
export interface RoutePatternSegment {
  name?: string;
  value: string;
  kind: 'param' | 'static';
}

/** @internal Parsed route pattern metadata. */
export interface RoutePattern {
  hasParams: boolean;
  paramNames: readonly string[];
  path: string;
  segments: readonly RoutePatternSegment[];
}

/** @internal Resolved route-table match. */
export interface RouteMatch<Route extends RouteLike = RouteLike> {
  normalization: PathnameNormalization;
  params: Record<string, string>;
  pathname: string;
  route: Route;
}

/** @internal KV228 ambiguity diagnostic payload. */
export interface RouteAmbiguity {
  code: 'KV228';
  message: string;
  paths: readonly [string, string];
  witnessPath: string;
}

/** @internal Runtime mirror of the `PathParamNames` type grammar. */
export function routePatternParamNameFromSegment(segment: string): string | undefined {
  return segment.startsWith(':') && segment.length > 1 ? segment.slice(1) : undefined;
}

/** @internal Parse and normalize an authored route pattern. */
export function parseRoutePattern(path: string): RoutePattern {
  const normalizedPath = normalizePathname(path).pathname;
  const segments = splitPathSegments(normalizedPath).map(parseRoutePatternSegment);
  const paramNames = segments.flatMap((segment) =>
    segment.kind === 'param' && segment.name ? [segment.name] : [],
  );

  return {
    hasParams: paramNames.length > 0,
    paramNames,
    path: normalizedPath,
    segments,
  };
}

/** @internal Substitute a route pattern's params using the shared route grammar. */
export function substituteRoutePatternParams(
  path: string,
  params: Record<string, unknown>,
): string {
  const pattern = parseRoutePattern(path);
  if (pattern.segments.length === 0) return '/';

  return `/${pattern.segments
    .map((segment) => {
      if (segment.kind === 'static') return segment.value;
      return encodeURIComponent(String(params[segment.name ?? segment.value.slice(1)] ?? ''));
    })
    .join('/')}`;
}

/** @internal Build a typed route href from one shared route pattern contract. */
export function buildRoutePatternHref(
  path: string,
  options: {
    params?: Record<string, unknown>;
    search?: Record<string, unknown>;
  } = {},
): string {
  const pathname = substituteRoutePatternParams(path, options.params ?? {});
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(options.search ?? {})) {
    if (value === null || value === undefined) continue;
    search.set(key, routeSearchValueToString(value));
  }

  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** @internal Canonicalize request pathnames before matching or static export. */
export function normalizePathname(pathname: string): PathnameNormalization {
  const inputPathname = pathname;
  const withoutSearchOrHash = pathname.split(/[?#]/, 1)[0] ?? '';
  const absolutePathname = withoutSearchOrHash.startsWith('/')
    ? withoutSearchOrHash
    : `/${withoutSearchOrHash}`;
  // SPEC §9.5: route dispatch works on one canonical pathname. Collapse leading
  // authority-forming slash/backslash runs and internal slash runs before matching
  // so redirects cannot become protocol-relative and params cannot receive empty
  // smuggled segments.
  const slashCollapsed = `/${absolutePathname.replace(/[/\\]+/g, '/').replace(/^\/+/, '')}`;
  const dotSegmentsRemoved = removeDotSegments(slashCollapsed);
  const trailingTrimmed =
    dotSegmentsRemoved === '/' ? '/' : dotSegmentsRemoved.replace(/\/+$/, '') || '/';
  const normalized = trailingTrimmed;

  if (normalized === absolutePathname) {
    return {
      inputPathname,
      pathname: normalized,
      trailingSlash: 'canonical',
    };
  }

  return {
    inputPathname,
    pathname: normalized,
    redirect: {
      pathname: normalized,
      status: 308,
    },
    trailingSlash: trailingTrimmed !== dotSegmentsRemoved ? 'removed' : 'canonical',
  };
}

/** @internal Static-first route matcher. */
export function matchRoute<Route extends RouteLike>(
  routes: readonly Route[],
  pathname: string,
): RouteMatch<Route> | undefined {
  const normalization = normalizePathname(pathname);
  const pathnameSegments = splitPathSegments(normalization.pathname);
  const candidates = compileRoutes(routes)
    .flatMap((route) => {
      const params = matchCompiledRoute(route, pathnameSegments);
      return params ? [{ params, route }] : [];
    })
    .sort((left, right) => compareCompiledRouteSpecificity(left.route, right.route));

  const match = candidates[0];
  if (!match) return undefined;

  return {
    normalization,
    params: match.params,
    pathname: normalization.pathname,
    route: match.route.route,
  };
}

/** @internal KV228 ambiguity checker over canonical route patterns. */
export function findRouteAmbiguities(routes: readonly RouteLike[]): readonly RouteAmbiguity[] {
  const compiledRoutes = compileRoutes(routes);
  const ambiguities: RouteAmbiguity[] = [];

  for (let leftIndex = 0; leftIndex < compiledRoutes.length; leftIndex += 1) {
    const left = compiledRoutes[leftIndex];
    if (!left) continue;

    for (let rightIndex = leftIndex + 1; rightIndex < compiledRoutes.length; rightIndex += 1) {
      const right = compiledRoutes[rightIndex];
      if (!right) continue;
      const witnessPath = routeAmbiguityWitness(left, right);
      if (!witnessPath) continue;

      ambiguities.push({
        code: 'KV228',
        message: `Ambiguous route table: '${left.path}' and '${right.path}' can both match canonical request path '${witnessPath}'.`,
        paths: [left.path, right.path],
        witnessPath,
      });
    }
  }

  return ambiguities;
}

type PathParamNames<Path extends string> = Path extends `${string}:${infer Rest}`
  ? Rest extends `${infer Param}/${infer Tail}`
    ? Param | PathParamNames<Tail>
    : Rest extends `${infer Param}?${string}`
      ? Param
      : Rest extends `${infer Param}#${string}`
        ? Param
        : Rest
  : never;

/** @internal Type-level route param extractor matching `parseRoutePattern()`. */
export type RoutePatternParamNames<Path extends string> = PathParamNames<Path>;

interface CompiledRoute<Route extends RouteLike = RouteLike> {
  index: number;
  path: string;
  route: Route;
  segments: readonly RoutePatternSegment[];
}

interface CachedRouteTable<Route extends RouteLike = RouteLike> {
  compiled: readonly CompiledRoute<Route>[];
  paths: readonly string[];
}

const routeTableCache = new WeakMap<readonly RouteLike[], CachedRouteTable>();

function compileRoutes<Route extends RouteLike>(
  routes: readonly Route[],
): readonly CompiledRoute<Route>[] {
  const cached = routeTableCache.get(routes);
  const paths = routes.map((route) => route.path);
  if (cached && pathsEqual(cached.paths, paths)) {
    return cached.compiled as readonly CompiledRoute<Route>[];
  }

  const compiled = routes.map((route, index) => compileRoute(route, index));
  routeTableCache.set(routes, { compiled, paths });
  return compiled;
}

function compileRoute<Route extends RouteLike>(route: Route, index: number): CompiledRoute<Route> {
  const pattern = parseRoutePattern(route.path);
  return {
    index,
    path: pattern.path,
    route,
    segments: pattern.segments,
  };
}

function pathsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compareCompiledRouteSpecificity(left: CompiledRoute, right: CompiledRoute): number {
  const segmentCount = Math.max(left.segments.length, right.segments.length);

  for (let index = 0; index < segmentCount; index += 1) {
    const leftSegment = left.segments[index];
    const rightSegment = right.segments[index];
    if (!leftSegment || !rightSegment) break;
    if (leftSegment.kind === rightSegment.kind) continue;
    return leftSegment.kind === 'static' ? -1 : 1;
  }

  return left.index - right.index;
}

function matchCompiledRoute(
  route: CompiledRoute,
  pathnameSegments: readonly string[],
): Record<string, string> | undefined {
  if (route.segments.length !== pathnameSegments.length) return undefined;

  const params: Record<string, string> = {};
  for (let index = 0; index < route.segments.length; index += 1) {
    const routeSegment = route.segments[index];
    const pathnameSegment = pathnameSegments[index];
    if (!routeSegment || pathnameSegment === undefined) return undefined;

    if (routeSegment.kind === 'static') {
      if (routeSegment.value !== pathnameSegment) return undefined;
      continue;
    }

    let decoded: string;
    try {
      decoded = decodeURIComponent(pathnameSegment);
    } catch {
      return undefined;
    }
    if (decoded === '.' || decoded === '..') return undefined;
    params[routeSegment.name ?? routeSegment.value.slice(1)] = decoded;
  }

  return params;
}

function parseRoutePatternSegment(value: string): RoutePatternSegment {
  const name = routePatternParamNameFromSegment(value);
  if (name !== undefined) {
    return {
      kind: 'param',
      name,
      value,
    };
  }

  return {
    kind: 'static',
    value,
  };
}

function routeAmbiguityWitness(left: CompiledRoute, right: CompiledRoute): string | undefined {
  if (left.segments.length !== right.segments.length) return undefined;

  const witnessSegments: string[] = [];
  for (let index = 0; index < left.segments.length; index += 1) {
    const leftSegment = left.segments[index];
    const rightSegment = right.segments[index];
    if (!leftSegment || !rightSegment) return undefined;

    if (leftSegment.kind === 'static' && rightSegment.kind === 'static') {
      if (leftSegment.value !== rightSegment.value) return undefined;
      witnessSegments.push(leftSegment.value);
      continue;
    }

    if (leftSegment.kind === 'static') {
      witnessSegments.push(leftSegment.value);
      continue;
    }

    if (rightSegment.kind === 'static') {
      witnessSegments.push(rightSegment.value);
      continue;
    }

    witnessSegments.push(leftSegment.name ? `:${leftSegment.name}` : ':param');
  }

  return `/${witnessSegments.join('/')}`;
}

function splitPathSegments(pathname: string): readonly string[] {
  if (pathname === '/') return [];
  return pathname.slice(1).split('/');
}

function removeDotSegments(pathname: string): string {
  const segments = pathname.split('/');
  const output: string[] = [];

  for (const segment of segments) {
    if (segment === '.') continue;
    if (segment === '..') {
      if (output.length > 1) output.pop();
      continue;
    }
    output.push(segment);
  }

  const joined = output.join('/');
  return joined.startsWith('/') ? joined : `/${joined}`;
}

function routeSearchValueToString(value: unknown): string {
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
