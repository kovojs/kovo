import {
  matchRoute,
  normalizePathname,
  type PathnameNormalization,
  type RouteLike,
} from './match.js';

/**
 * @internal Shell-dispatch engine input shape (SPEC.md §6.x dispatch order). The minimal
 * endpoint projection the dispatcher matches against. Exported only for in-repo
 * consumers, not app authors.
 */
export interface EndpointLike {
  method?: string;
  mount: 'exact' | 'prefix';
  path: string;
}

/**
 * @internal Shell-dispatch engine type (SPEC.md §6.x dispatch order). Names the dispatch
 * phase a request resolves to. Exported only for in-repo consumers, not app authors.
 */
export type ShellDispatchPhase =
  | 'capability'
  | 'mutation'
  | 'query'
  | 'client-module'
  | 'endpoint-exact'
  | 'endpoint-prefix'
  | 'route'
  | 'not-found';

/**
 * @internal Shell-dispatch engine type (SPEC.md §6.x dispatch order). One entry in the
 * normative dispatch precedence table (reserved `/_m/`,`/_q/`,`/c/` prefixes → endpoints
 * → route → 404). Exported only for in-repo consumers, not app authors.
 */
export type ShellDispatchEntry =
  | {
      kind: 'reserved';
      phase: 'capability' | 'client-module' | 'mutation' | 'query';
      prefix: '/_cap/' | '/_m/' | '/_q/' | '/c/';
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

type MatchingShellDispatchEntry = Exclude<ShellDispatchEntry, { kind: 'not-found' }>;

const shellDispatchMatchingTable = [
  { kind: 'reserved', phase: 'mutation', prefix: '/_m/' },
  { kind: 'reserved', phase: 'query', prefix: '/_q/' },
  { kind: 'reserved', phase: 'capability', prefix: '/_cap/' },
  { kind: 'reserved', phase: 'client-module', prefix: '/c/' },
  { kind: 'endpoint', mount: 'exact', phase: 'endpoint-exact' },
  { kind: 'endpoint', mount: 'prefix', phase: 'endpoint-prefix' },
  { kind: 'route', phase: 'route' },
] as const satisfies readonly MatchingShellDispatchEntry[];

const notFoundShellDispatchEntry = {
  kind: 'not-found',
  phase: 'not-found',
} as const satisfies Extract<ShellDispatchEntry, { kind: 'not-found' }>;

/**
 * @internal Shell-dispatch engine table (SPEC.md §6.x dispatch order). The normative,
 * printable dispatch precedence order. Exported only for in-repo consumers and audit
 * tooling, not app authors.
 */
export const shellDispatchTable = [
  ...shellDispatchMatchingTable,
  notFoundShellDispatchEntry,
] as const satisfies readonly ShellDispatchEntry[];

/**
 * @internal Shell-dispatch engine input (SPEC.md §6.x dispatch order). The request shape
 * the dispatcher resolves against the route/endpoint tables. Exported only for in-repo
 * consumers, not app authors.
 */
export interface ShellDispatchInput<
  Route extends RouteLike = RouteLike,
  Endpoint extends EndpointLike = EndpointLike,
> {
  endpoints?: readonly Endpoint[];
  method?: string;
  pathname: string;
  routes?: readonly Route[];
}

/**
 * @internal Shell-dispatch engine result (SPEC.md §6.x dispatch order). The resolved
 * dispatch outcome (reserved/endpoint/route/not-found) for a request. Exported only for
 * in-repo consumers, not app authors.
 */
export type ShellDispatchMatch<
  Route extends RouteLike = RouteLike,
  Endpoint extends EndpointLike = EndpointLike,
> =
  | {
      entry: Extract<ShellDispatchEntry, { kind: 'reserved' }>;
      key: string;
      kind: 'capability' | 'client-module' | 'mutation' | 'query';
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

/**
 * @internal Shell-dispatch engine (SPEC.md §6.x dispatch order). Resolves a request to
 * the first matching dispatch phase following the normative precedence: reserved `/_m/`,
 * `/_q/`, `/c/` prefixes → endpoint exact/prefix mounts → route table → 404. Exported
 * only for in-repo consumers, not app authors.
 */
export function matchShellDispatch<
  Route extends RouteLike,
  Endpoint extends EndpointLike = EndpointLike,
>(input: ShellDispatchInput<Route, Endpoint>): ShellDispatchMatch<Route, Endpoint> {
  const normalization = normalizePathname(input.pathname);
  const method = input.method?.toUpperCase();

  for (const entry of shellDispatchMatchingTable) {
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
  }

  return {
    entry: notFoundShellDispatchEntry,
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
