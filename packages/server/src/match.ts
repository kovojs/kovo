/**
 * @internal Route-matching engine type (SPEC.md §6.x route table). The minimal route
 * projection the matcher and ambiguity checker operate on. Exported only for in-repo
 * consumers, not app authors.
 */
export interface RouteLike<Path extends string = string> {
  path: Path;
}

/**
 * @internal Route-matching engine type (SPEC.md §6.x). The result of normalizing a
 * request pathname (trailing-slash + authority collapse, with a 308 redirect when the
 * canonical form differs). Exported only for in-repo consumers, not app authors.
 */
export interface PathnameNormalization {
  inputPathname: string;
  pathname: string;
  redirect?: {
    pathname: string;
    status: 308;
  };
  trailingSlash: 'canonical' | 'removed';
}

/**
 * @internal Route-matching engine type (SPEC.md §6.x route table). A resolved
 * route-table match (route + extracted params + normalization). Exported only for in-repo
 * consumers, not app authors.
 */
export interface RouteMatch<Route extends RouteLike = RouteLike> {
  normalization: PathnameNormalization;
  params: Record<string, string>;
  pathname: string;
  route: Route;
}

/**
 * @internal Route-ambiguity diagnostic shape for KV228 (SPEC.md §9.5; KV228 in §appendix
 * diagnostics). Two routes that can both match the same canonical request path, with a
 * witness path. Exported only for in-repo conformance/audit tooling, not app authors.
 */
export interface RouteAmbiguity {
  code: 'KV228';
  message: string;
  paths: readonly [string, string];
  witnessPath: string;
}

interface RouteSegment {
  name?: string;
  value: string;
  kind: 'param' | 'static';
}

interface CompiledRoute<Route extends RouteLike = RouteLike> {
  index: number;
  path: string;
  route: Route;
  segments: readonly RouteSegment[];
}

interface CachedRouteTable<Route extends RouteLike = RouteLike> {
  compiled: readonly CompiledRoute<Route>[];
  paths: readonly string[];
}

const routeTableCache = new WeakMap<readonly RouteLike[], CachedRouteTable>();

/**
 * @internal Route-matching engine (SPEC.md §6.3/§6.x). Collapses an authority-forming
 * leading slash run and strips trailing slashes to one canonical pathname, emitting a 308
 * redirect descriptor when the canonical form differs (security finding H5). Exported
 * only for in-repo consumers, not app authors.
 */
export function normalizePathname(pathname: string): PathnameNormalization {
  const inputPathname = pathname;
  const withoutSearchOrHash = pathname.split(/[?#]/, 1)[0] ?? '';
  const absolutePathname = withoutSearchOrHash.startsWith('/')
    ? withoutSearchOrHash
    : `/${withoutSearchOrHash}`;
  // SPEC.md §6.3: collapse any leading authority-forming slash/backslash run to a
  // single leading slash so the normalized pathname can never start with `//` or
  // `/\`. Without this, a request to `//evil.com/` would normalize to `//evil.com`
  // and be emitted verbatim as a protocol-relative `Location` 308 — an
  // unauthenticated open redirect (security finding H5).
  //
  // F1 (bugs-part3 L2-route-matcher-1): also collapse *internal* slash/backslash
  // runs across the whole path. Without this, `/files//etc` survives as
  // `['files','','etc']` and an empty interior segment silently matches a param
  // (`/files/:a/:b` → `a=''`), letting a request probe a different route arity than
  // the canonical URL implies and feed empty params into ownership/key lookups.
  const slashCollapsed = `/${absolutePathname.replace(/[/\\]+/g, '/').replace(/^\/+/, '')}`;
  // L2-route-matcher-2 (bugs-part3): apply RFC-3986 dot-segment removal so a decoded
  // `.`/`..` can never be delivered as a literal param value (a traversal primitive
  // if an app interpolates a param into a filesystem path/cache key). This aligns the
  // runtime matcher with the static-export safety check
  // (static-export-route-plan.ts staticExportRouteTargetPathSegmentIsSafe), which
  // already rejects decoded `.`/`..` segments.
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

  // The normalized form differs from the requested path because trailing slashes
  // were stripped and/or a leading authority-forming run was collapsed, an internal
  // slash run was collapsed, or a dot-segment was removed. Either way, emit a 308
  // carrying the canonical pathname so the browser never follows the original
  // protocol-relative form or an empty-interior-segment smuggle. `trailingSlash`
  // reflects only whether a trailing slash was removed.
  const trailingSlashRemoved = trailingTrimmed !== dotSegmentsRemoved;
  return {
    inputPathname,
    pathname: normalized,
    redirect: {
      pathname: normalized,
      status: 308,
    },
    trailingSlash: trailingSlashRemoved ? 'removed' : 'canonical',
  };
}

/**
 * @internal Route-matching engine (SPEC.md §6.x route table). Resolves a pathname to the
 * most-specific matching route (static-first per segment) and extracts its params.
 * Exported only for in-repo consumers, not app authors.
 */
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

/**
 * @internal Route-ambiguity conformance diagnostic for KV228 (SPEC.md §9.5; §680 makes
 * an ambiguous route table a compile error rather than a runtime precedence footnote).
 * Returns every pair of routes that can both match one canonical request path, with a
 * witness path. Exported only for in-repo conformance/audit tooling, not app authors.
 */
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
  const path = normalizePathname(route.path).pathname;

  return {
    index,
    path,
    route,
    segments: splitPathSegments(path).map(parseRouteSegment),
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

    // I2 (ROUTING-NAV-2): URL-decode params so typed links round-trip correctly.
    // Malformed percent-sequences → treat as no-match (undefined) per SPEC §6.4.
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathnameSegment);
    } catch {
      return undefined;
    }
    // L2-route-matcher-2 (bugs-part3): a decoded param value of exactly `.`/`..` is a
    // traversal primitive. `removeDotSegments` already strips literal dot-segments
    // during normalization; this also rejects percent-encoded `%2e`/`%2e%2e` that only
    // surface as a dot-segment after decoding, matching the static-export safety check
    // (static-export-route-plan.ts) which rejects decoded `.`/`..` segments.
    if (decoded === '.' || decoded === '..') return undefined;
    params[routeSegment.name ?? routeSegment.value.slice(1)] = decoded;
  }

  return params;
}

function parseRouteSegment(value: string): RouteSegment {
  if (value.startsWith(':') && value.length > 1) {
    return {
      kind: 'param',
      name: value.slice(1),
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

/**
 * RFC-3986 §5.2.4 dot-segment removal over an already-absolute, slash-collapsed
 * pathname (L2-route-matcher-2). Resolves `.`/`..` interior segments so a decoded
 * dot-segment can never reach a param or change the matched route arity. A leading
 * `..` cannot escape above root — it is dropped, mirroring the static-export safety
 * check (static-export-route-plan.ts) which rejects decoded `.`/`..` segments.
 */
function removeDotSegments(pathname: string): string {
  const segments = pathname.split('/');
  const output: string[] = [];

  for (const segment of segments) {
    if (segment === '.') continue;
    if (segment === '..') {
      // Pop the last real segment but never the leading empty (root) segment.
      if (output.length > 1) output.pop();
      continue;
    }
    output.push(segment);
  }

  const joined = output.join('/');
  return joined.startsWith('/') ? joined : `/${joined}`;
}
