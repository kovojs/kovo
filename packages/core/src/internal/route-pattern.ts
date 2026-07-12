import {
  securityArrayAppend,
  securityDecodeURIComponent,
  securityEncodeURIComponent,
  securityGetOwnPropertyDescriptor,
  securityJsonStringify,
  securityNullRecord,
  securityObjectKeys,
  securityOwnArrayEntry,
  securityString,
  securityStringSlice,
  securityStringSplit,
  securityStringStartsWith,
  securityWeakMap,
  securityWeakMapGet,
  securityWeakMapSet,
} from '#security-witness-intrinsics';

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
  return securityStringStartsWith(segment, ':') && segment.length > 1
    ? securityStringSlice(segment, 1)
    : undefined;
}

/** @internal Parse and normalize an authored route pattern. */
export function parseRoutePattern(path: string): RoutePattern {
  const normalizedPath = normalizePathname(path).pathname;
  const sourceSegments = splitPathSegments(normalizedPath);
  const segments: RoutePatternSegment[] = [];
  const paramNames: string[] = [];
  for (let index = 0; index < sourceSegments.length; index += 1) {
    const sourceSegment = sourceSegments[index];
    if (sourceSegment === undefined) continue;
    const segment = parseRoutePatternSegment(sourceSegment);
    securityArrayAppend(segments, segment);
    if (segment.kind === 'param' && segment.name) securityArrayAppend(paramNames, segment.name);
  }

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

  let rendered = '';
  for (let index = 0; index < pattern.segments.length; index += 1) {
    const segment = pattern.segments[index];
    if (segment === undefined) continue;
    const value =
      segment.kind === 'static'
        ? segment.value
        : securityEncodeURIComponent(
            routeSearchValueToString(params[segment.name ?? securityStringSlice(segment.value, 1)]),
          );
    rendered += `${index === 0 ? '' : '/'}${value}`;
  }
  return `/${rendered}`;
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
  const search = options.search ?? {};
  const keys = securityObjectKeys(search);
  let query = '';
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === undefined) continue;
    const descriptor = securityGetOwnPropertyDescriptor(search, key);
    if (descriptor === undefined || !('value' in descriptor)) continue;
    const value = descriptor.value;
    if (value === null || value === undefined) continue;
    query += `${query === '' ? '' : '&'}${encodeSearchPart(key)}=${encodeSearchPart(
      routeSearchValueToString(value),
    )}`;
  }
  return query ? `${pathname}?${query}` : pathname;
}

/** @internal Canonicalize request pathnames before matching or static export. */
export function normalizePathname(pathname: string): PathnameNormalization {
  const inputPathname = pathname;
  const boundary = firstPathBoundary(pathname);
  const withoutSearchOrHash = boundary < 0 ? pathname : securityStringSlice(pathname, 0, boundary);
  const absolutePathname = securityStringStartsWith(withoutSearchOrHash, '/')
    ? withoutSearchOrHash
    : `/${withoutSearchOrHash}`;
  // SPEC §9.5: route dispatch works on one canonical pathname. Collapse leading
  // authority-forming slash/backslash runs and internal slash runs before matching
  // so redirects cannot become protocol-relative and params cannot receive empty
  // smuggled segments.
  let slashCollapsed = '/';
  let previousSlash = true;
  for (let index = 0; index < absolutePathname.length; index += 1) {
    const character = absolutePathname[index] ?? '';
    const slash = character === '/' || character === '\\';
    if (slash) {
      if (!previousSlash) slashCollapsed += '/';
    } else {
      slashCollapsed += character;
    }
    previousSlash = slash;
  }
  const dotSegmentsRemoved = removeDotSegments(slashCollapsed);
  let trailingEnd = dotSegmentsRemoved.length;
  while (trailingEnd > 1 && dotSegmentsRemoved[trailingEnd - 1] === '/') trailingEnd -= 1;
  const trailingTrimmed =
    trailingEnd === dotSegmentsRemoved.length
      ? dotSegmentsRemoved
      : securityStringSlice(dotSegmentsRemoved, 0, trailingEnd);
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
  let match: { params: Record<string, string>; route: CompiledRoute<Route> } | undefined;
  const compiled = compileRoutes(routes);
  for (let index = 0; index < compiled.length; index += 1) {
    const routeEntry = securityOwnArrayEntry(compiled, index);
    if (!routeEntry.ok) continue;
    const route = routeEntry.value;
    const params = matchCompiledRoute(route, pathnameSegments);
    if (!params) continue;
    if (!match || compareCompiledRouteSpecificity(route, match.route) < 0) {
      match = { params, route };
    }
  }
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
    const leftEntry = securityOwnArrayEntry(compiledRoutes, leftIndex);
    if (!leftEntry.ok) continue;
    const left = leftEntry.value;

    for (let rightIndex = leftIndex + 1; rightIndex < compiledRoutes.length; rightIndex += 1) {
      const rightEntry = securityOwnArrayEntry(compiledRoutes, rightIndex);
      if (!rightEntry.ok) continue;
      const right = rightEntry.value;
      const witnessPath = routeAmbiguityWitness(left, right);
      if (!witnessPath) continue;

      securityArrayAppend(ambiguities, {
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

const routeTableCache = securityWeakMap<readonly RouteLike[], CachedRouteTable>();

function compileRoutes<Route extends RouteLike>(
  routes: readonly Route[],
): readonly CompiledRoute<Route>[] {
  const cached = securityWeakMapGet(routeTableCache, routes);
  const paths: string[] = [];
  for (let index = 0; index < routes.length; index += 1) {
    const routeEntry = securityOwnArrayEntry(routes, index);
    if (routeEntry.ok) securityArrayAppend(paths, routeEntry.value.path);
  }
  if (cached && pathsEqual(cached.paths, paths)) {
    return cached.compiled as readonly CompiledRoute<Route>[];
  }

  const compiled: CompiledRoute<Route>[] = [];
  for (let index = 0; index < routes.length; index += 1) {
    const routeEntry = securityOwnArrayEntry(routes, index);
    if (routeEntry.ok) securityArrayAppend(compiled, compileRoute(routeEntry.value, index));
  }
  securityWeakMapSet(routeTableCache, routes, { compiled, paths });
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
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function compareCompiledRouteSpecificity(left: CompiledRoute, right: CompiledRoute): number {
  const segmentCount =
    left.segments.length > right.segments.length ? left.segments.length : right.segments.length;

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

  const params = securityNullRecord<string>();
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
      decoded = securityDecodeURIComponent(pathnameSegment);
    } catch {
      return undefined;
    }
    if (decoded === '.' || decoded === '..') return undefined;
    params[routeSegment.name ?? securityStringSlice(routeSegment.value, 1)] = decoded;
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
      securityArrayAppend(witnessSegments, leftSegment.value);
      continue;
    }

    if (leftSegment.kind === 'static') {
      securityArrayAppend(witnessSegments, leftSegment.value);
      continue;
    }

    if (rightSegment.kind === 'static') {
      securityArrayAppend(witnessSegments, rightSegment.value);
      continue;
    }

    securityArrayAppend(witnessSegments, leftSegment.name ? `:${leftSegment.name}` : ':param');
  }

  return `/${joinPathSegments(witnessSegments)}`;
}

function splitPathSegments(pathname: string): readonly string[] {
  if (pathname === '/') return [];
  return securityStringSplit(securityStringSlice(pathname, 1), '/');
}

function removeDotSegments(pathname: string): string {
  const segments = securityStringSplit(pathname, '/');
  const output: string[] = [];

  for (let index = 0; index < segments.length; index += 1) {
    const segmentEntry = securityOwnArrayEntry(segments, index);
    if (!segmentEntry.ok) continue;
    const segment = segmentEntry.value;
    if (segment === '.') continue;
    if (segment === '..') {
      if (output.length > 1) output.length -= 1;
      continue;
    }
    securityArrayAppend(output, segment);
  }

  const joined = joinPathSegments(output);
  return securityStringStartsWith(joined, '/') ? joined : `/${joined}`;
}

function routeSearchValueToString(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return securityString(value);
  }
  if (typeof value === 'symbol') return value.description ?? '';
  return securityJsonStringify(value) ?? '';
}

function firstPathBoundary(value: string): number {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '?' || value[index] === '#') return index;
  }
  return -1;
}

function joinPathSegments(segments: readonly string[]): string {
  let joined = '';
  for (let index = 0; index < segments.length; index += 1) {
    const entry = securityOwnArrayEntry(segments, index);
    if (!entry.ok) continue;
    joined += `${index === 0 ? '' : '/'}${entry.value}`;
  }
  return joined;
}

function encodeSearchPart(value: string): string {
  const encoded = securityEncodeURIComponent(value);
  let formEncoded = '';
  for (let index = 0; index < encoded.length; index += 1) {
    if (securityStringStartsWith(encoded, '%20', index)) {
      formEncoded += '+';
      index += 2;
      continue;
    }
    const character = encoded[index] ?? '';
    if (character === '!') formEncoded += '%21';
    else if (character === "'") formEncoded += '%27';
    else if (character === '(') formEncoded += '%28';
    else if (character === ')') formEncoded += '%29';
    else if (character === '~') formEncoded += '%7E';
    else formEncoded += character;
  }
  return formEncoded;
}
