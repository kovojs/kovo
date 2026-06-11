export interface RouteLike<Path extends string = string> {
  path: Path;
}

export interface PathnameNormalization {
  inputPathname: string;
  pathname: string;
  redirect?: {
    pathname: string;
    status: 308;
  };
  trailingSlash: 'canonical' | 'removed';
}

export interface RouteMatch<Route extends RouteLike = RouteLike> {
  normalization: PathnameNormalization;
  params: Record<string, string>;
  pathname: string;
  route: Route;
}

export interface RouteAmbiguity {
  code: 'FW228';
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

export function normalizePathname(pathname: string): PathnameNormalization {
  const inputPathname = pathname;
  const withoutSearchOrHash = pathname.split(/[?#]/, 1)[0] ?? '';
  const absolutePathname = withoutSearchOrHash.startsWith('/')
    ? withoutSearchOrHash
    : `/${withoutSearchOrHash}`;
  const normalized = absolutePathname === '/' ? '/' : absolutePathname.replace(/\/+$/, '') || '/';

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
    trailingSlash: 'removed',
  };
}

export function matchRoute<Route extends RouteLike>(
  routes: readonly Route[],
  pathname: string,
): RouteMatch<Route> | undefined {
  const normalization = normalizePathname(pathname);
  const pathnameSegments = splitPathSegments(normalization.pathname);
  const candidates = routes
    .map((route, index) => compileRoute(route, index))
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

export function findRouteAmbiguities(routes: readonly RouteLike[]): readonly RouteAmbiguity[] {
  const compiledRoutes = routes.map((route, index) => compileRoute(route, index));
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
        code: 'FW228',
        message:
          'Ambiguous route table entry. SPEC 6.4 routes must be statically provable navigation targets; planned 9.5 shell dispatch rejects route pairs that can match the same pathname.',
        paths: [left.path, right.path],
        witnessPath,
      });
    }
  }

  return ambiguities;
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

    params[routeSegment.name ?? routeSegment.value.slice(1)] = pathnameSegment;
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
