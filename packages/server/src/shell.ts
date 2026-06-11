import {
  matchRoute,
  normalizePathname,
  type PathnameNormalization,
  type RouteLike,
} from './match.js';

export interface EndpointLike {
  method?: string;
  mount: 'exact' | 'prefix';
  path: string;
}

export type ShellDispatchPhase =
  | 'mutation'
  | 'query'
  | 'client-module'
  | 'endpoint-exact'
  | 'endpoint-prefix'
  | 'route'
  | 'not-found';

export type ShellDispatchEntry =
  | {
      kind: 'reserved';
      phase: 'client-module' | 'mutation' | 'query';
      prefix: '/_m/' | '/_q/' | '/c/';
    }
  | {
      kind: 'endpoint';
      mount: 'exact' | 'prefix';
      phase: 'endpoint-exact' | 'endpoint-prefix';
    }
  | {
      kind: 'route';
      phase: 'route';
    }
  | {
      kind: 'not-found';
      phase: 'not-found';
    };

export const shellDispatchTable = [
  { kind: 'reserved', phase: 'mutation', prefix: '/_m/' },
  { kind: 'reserved', phase: 'query', prefix: '/_q/' },
  { kind: 'reserved', phase: 'client-module', prefix: '/c/' },
  { kind: 'endpoint', mount: 'exact', phase: 'endpoint-exact' },
  { kind: 'endpoint', mount: 'prefix', phase: 'endpoint-prefix' },
  { kind: 'route', phase: 'route' },
  { kind: 'not-found', phase: 'not-found' },
] as const satisfies readonly ShellDispatchEntry[];

export interface ShellDispatchInput<
  Route extends RouteLike = RouteLike,
  Endpoint extends EndpointLike = EndpointLike,
> {
  endpoints?: readonly Endpoint[];
  method?: string;
  pathname: string;
  routes?: readonly Route[];
}

export type ShellDispatchMatch<
  Route extends RouteLike = RouteLike,
  Endpoint extends EndpointLike = EndpointLike,
> =
  | {
      entry: Extract<ShellDispatchEntry, { kind: 'reserved' }>;
      key: string;
      kind: 'client-module' | 'mutation' | 'query';
      normalization: PathnameNormalization;
      pathname: string;
    }
  | {
      endpoint: Endpoint;
      entry: Extract<ShellDispatchEntry, { kind: 'endpoint' }>;
      kind: 'endpoint';
      normalization: PathnameNormalization;
      pathname: string;
    }
  | {
      allowedMethods: readonly ['GET', 'HEAD'];
      entry: Extract<ShellDispatchEntry, { kind: 'route' }>;
      kind: 'route';
      methodAllowed: boolean;
      normalization: PathnameNormalization;
      params: Record<string, string>;
      pathname: string;
      route: Route;
    }
  | {
      entry: Extract<ShellDispatchEntry, { kind: 'not-found' }>;
      kind: 'not-found';
      normalization: PathnameNormalization;
      pathname: string;
    };

const routeAllowedMethods = ['GET', 'HEAD'] as const;

export function matchShellDispatch<
  Route extends RouteLike,
  Endpoint extends EndpointLike = EndpointLike,
>(input: ShellDispatchInput<Route, Endpoint>): ShellDispatchMatch<Route, Endpoint> {
  const normalization = normalizePathname(input.pathname);
  const method = input.method?.toUpperCase();

  for (const entry of shellDispatchTable) {
    if (entry.kind === 'reserved') {
      if (!normalization.pathname.startsWith(entry.prefix)) continue;
      return {
        entry,
        key: normalization.pathname.slice(entry.prefix.length),
        kind: entry.phase,
        normalization,
        pathname: normalization.pathname,
      };
    }

    if (entry.kind === 'endpoint') {
      const endpoint = (input.endpoints ?? []).find(
        (candidate) =>
          candidate.mount === entry.mount &&
          endpointMethodMatches(candidate, method) &&
          endpointPathMatches(candidate, normalization.pathname),
      );
      if (!endpoint) continue;

      return {
        endpoint,
        entry,
        kind: 'endpoint',
        normalization,
        pathname: normalization.pathname,
      };
    }

    if (entry.kind === 'route') {
      const routeMatch = matchRoute(input.routes ?? [], normalization.pathname);
      if (!routeMatch) continue;

      return {
        allowedMethods: routeAllowedMethods,
        entry,
        kind: 'route',
        methodAllowed: method === undefined || method === 'GET' || method === 'HEAD',
        normalization,
        params: routeMatch.params,
        pathname: normalization.pathname,
        route: routeMatch.route,
      };
    }

    return {
      entry,
      kind: 'not-found',
      normalization,
      pathname: normalization.pathname,
    };
  }

  return {
    entry: { kind: 'not-found', phase: 'not-found' },
    kind: 'not-found',
    normalization,
    pathname: normalization.pathname,
  };
}

function endpointMethodMatches(endpoint: EndpointLike, method: string | undefined): boolean {
  return (
    endpoint.method === undefined ||
    method === undefined ||
    endpoint.method.toUpperCase() === method
  );
}

function endpointPathMatches(endpoint: EndpointLike, pathname: string): boolean {
  const endpointPath = normalizePathname(endpoint.path).pathname;
  if (endpoint.mount === 'exact') return pathname === endpointPath;
  if (endpointPath === '/') return pathname.startsWith('/');
  return pathname === endpointPath || pathname.startsWith(`${endpointPath}/`);
}
