import {
  matchRoute,
  normalizePathname,
  type PathnameNormalization,
  type RouteLike,
} from './match.js';
import { canonicalRequestMethod } from './request-method.js';
import { denseOwnArrayFind } from './registry-lookup.js';
import { witnessStringStartsWith } from './security-witness-intrinsics.js';

/**
 * @internal Shell-dispatch engine input shape (SPEC.md §6.x dispatch order). The minimal
 * endpoint projection the dispatcher matches against. Exported only for in-repo
 * consumers, not app authors.
 */
export interface EndpointLike {
  allowedMethods?: readonly string[];
  method?: string;
  mount: 'exact' | 'prefix';
  path: string;
}

/**
 * @internal Shell-dispatch engine type (SPEC.md §6.x dispatch order). Names the dispatch
 * phase a request resolves to. Exported only for in-repo consumers, not app authors.
 */
export type ShellDispatchPhase =
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

type MatchingShellDispatchEntry = Exclude<ShellDispatchEntry, { kind: 'not-found' }>;

const shellDispatchMatchingTable = [
  { kind: 'reserved', phase: 'mutation', prefix: '/_m/' },
  { kind: 'reserved', phase: 'query', prefix: '/_q/' },
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
      kind: 'client-module' | 'mutation' | 'query';
      normalization: PathnameNormalization;
      pathname: string;
    }
  | {
      allowedMethods: readonly string[];
      endpoint: Endpoint;
      entry: Extract<ShellDispatchEntry, { kind: 'endpoint' }>;
      kind: 'endpoint';
      methodAllowed: boolean;
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
  const method = input.method === undefined ? undefined : canonicalRequestMethod(input.method);
  let endpointMethodMismatch:
    | Extract<ShellDispatchMatch<Route, Endpoint>, { kind: 'endpoint' }>
    | undefined;

  for (let entryIndex = 0; entryIndex < shellDispatchMatchingTable.length; entryIndex += 1) {
    const entry = shellDispatchMatchingTable[entryIndex]!;
    if (entry.kind === 'reserved') {
      if (!witnessStringStartsWith(normalization.pathname, entry.prefix)) continue;
      return {
        entry,
        key: requestPathRange(normalization.pathname, entry.prefix.length),
        kind: entry.phase,
        normalization,
        pathname: normalization.pathname,
      };
    }

    if (entry.kind === 'endpoint') {
      const endpoint = denseOwnArrayFind(
        input.endpoints ?? [],
        (candidate) =>
          candidate.mount === entry.mount && endpointPathMatches(candidate, normalization.pathname),
        'App endpoint registry',
      );
      if (!endpoint) continue;
      const allowedMethods = endpointAllowedMethods(endpoint);
      const methodAllowed =
        method === undefined ||
        denseOwnArrayFind(
          allowedMethods,
          (candidate) => {
            if (typeof candidate !== 'string') {
              throw new TypeError('Endpoint allowed methods must contain only strings.');
            }
            return canonicalRequestMethod(candidate) === method;
          },
          'Endpoint allowed methods',
        ) !== undefined;
      const match = {
        allowedMethods,
        endpoint,
        entry,
        kind: 'endpoint',
        methodAllowed,
        normalization,
        pathname: normalization.pathname,
      } satisfies Extract<ShellDispatchMatch<Route, Endpoint>, { kind: 'endpoint' }>;

      if (!methodAllowed) {
        endpointMethodMismatch ??= match;
        continue;
      }

      return match;
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

  if (endpointMethodMismatch) return endpointMethodMismatch;

  return {
    entry: notFoundShellDispatchEntry,
    kind: 'not-found',
    normalization,
    pathname: normalization.pathname,
  };
}

function endpointAllowedMethods(endpoint: EndpointLike): readonly string[] {
  if (endpoint.allowedMethods !== undefined) return endpoint.allowedMethods;
  if (endpoint.method === undefined) return [];
  const method = canonicalRequestMethod(endpoint.method);
  return method === 'GET' ? ['GET', 'HEAD'] : [method];
}

function endpointPathMatches(endpoint: EndpointLike, pathname: string): boolean {
  const endpointPath = normalizePathname(endpoint.path).pathname;
  if (endpoint.mount === 'exact') return pathname === endpointPath;
  if (endpointPath === '/') return witnessStringStartsWith(pathname, '/');
  return pathname === endpointPath || witnessStringStartsWith(pathname, `${endpointPath}/`);
}

function requestPathRange(value: string, start: number): string {
  let result = '';
  for (let index = start; index < value.length; index += 1) result += value[index];
  return result;
}
