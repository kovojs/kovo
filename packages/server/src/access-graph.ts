import type { AccessExplainFact } from '@kovojs/core/internal/graph';

import type { AppMutationDeclaration, AppQueryDeclaration, KovoApp } from './app-types.js';
import type {
  EndpointAuthDeclaration,
  EndpointDeclaration,
  EndpointMethod,
  EndpointMount,
} from './endpoint.js';
import type { LayoutDeclaration, RouteDeclaration } from './route.js';

/**
 * @internal Build the Phase 2 access ledger from an assembled app.
 *
 * This is intentionally additive: it records the current guard/auth posture so
 * graph emitters can opt into `kovo explain --access` before the public
 * `access:` declaration API becomes mandatory.
 */
export function accessFactsFromApp(
  app: Pick<KovoApp, 'endpoints' | 'mutations' | 'queries' | 'routes'>,
): AccessExplainFact[] {
  return [
    ...app.endpoints.map(endpointAccessFact),
    ...app.mutations.map(mutationAccessFact),
    ...app.queries.map(queryAccessFact),
    ...app.routes.map(routeAccessFact),
  ].sort(compareAccessFact);
}

function queryAccessFact(query: AppQueryDeclaration): AccessExplainFact {
  const hasGuard = typeof query.guard === 'function';
  return {
    decision: hasGuard ? 'guard' : 'missing',
    detail: hasGuard ? 'guard=query.guard' : 'guard=-',
    kind: 'query',
    name: query.key,
    source: 'legacy-guard',
  };
}

function mutationAccessFact(mutation: AppMutationDeclaration): AccessExplainFact {
  const hasGuard = typeof mutation.guard === 'function';
  return {
    decision: hasGuard ? 'guard' : 'missing',
    detail: hasGuard ? 'guard=mutation.guard' : 'guard=-',
    kind: 'mutation',
    name: mutation.key,
    source: 'legacy-guard',
  };
}

function routeAccessFact(route: RouteDeclaration<any, any, any, any, any, any>): AccessExplainFact {
  const guardSource = routeGuardSource(route);
  return {
    decision: guardSource === undefined ? 'missing' : 'guard',
    detail: guardSource === undefined ? 'guard=-' : `guard=${guardSource}`,
    kind: 'page',
    name: route.path,
    source: 'legacy-guard',
  };
}

function endpointAccessFact(
  endpoint: EndpointDeclaration<string, EndpointMethod, EndpointMount>,
): AccessExplainFact {
  const webhook = isWebhookEndpoint(endpoint);
  const kind = webhook ? 'webhook' : 'endpoint';
  const name = webhook ? endpoint.name : endpoint.path;
  const source = webhook ? 'webhook' : 'auth';
  const auth = endpoint.auth;
  const detail = endpointAccessDetail(endpoint, auth);

  if (auth?.kind === 'none') {
    return {
      decision: 'public',
      detail,
      justification: auth.justification,
      kind,
      name,
      source,
    };
  }

  if (auth?.kind === 'custom' || auth?.kind === 'verifier') {
    return {
      decision: 'verified',
      detail,
      kind,
      name,
      source,
    };
  }

  return {
    decision: 'missing',
    detail,
    kind,
    name,
    source,
  };
}

function endpointAccessDetail(
  endpoint: EndpointDeclaration<string, EndpointMethod, EndpointMount>,
  auth: EndpointAuthDeclaration | undefined,
): string {
  return [
    `method=${endpoint.method}`,
    `path=${endpoint.path}`,
    `mount=${endpoint.mount}`,
    `auth=${auth === undefined ? '-' : auth.kind === 'none' ? 'none' : `${auth.kind}:${auth.name}`}`,
  ].join(' ');
}

function routeGuardSource(
  route: RouteDeclaration<any, any, any, any, any, any>,
): string | undefined {
  if (typeof route.guard === 'function') return 'route.guard';

  let layout: LayoutDeclaration<any, any, any> | undefined = route.layout;
  while (layout !== undefined) {
    if (typeof layout.guard === 'function') return 'layout.guard';
    layout = layout.parent;
  }

  return undefined;
}

function isWebhookEndpoint(
  endpoint: EndpointDeclaration<string, EndpointMethod, EndpointMount>,
): endpoint is EndpointDeclaration<string, EndpointMethod, EndpointMount> & {
  name: string;
  webhook: true;
} {
  return (
    'webhook' in endpoint &&
    endpoint.webhook === true &&
    'name' in endpoint &&
    typeof endpoint.name === 'string'
  );
}

function compareAccessFact(left: AccessExplainFact, right: AccessExplainFact): number {
  return left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name);
}
