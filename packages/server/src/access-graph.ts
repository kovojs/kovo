import type { AccessExplainFact } from '@kovojs/core/internal/graph';

import type { AccessDecision } from './access.js';
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
 * Explicit `access:` metadata is the source of truth for Phase 2 completeness.
 * Legacy guard/auth posture may appear in missing-fact details for migration
 * help, but it never satisfies KV436.
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
  const explicit = explicitAccessFact('query', query.key, query.access);
  if (explicit) return explicit;

  const hasGuard = typeof query.guard === 'function';
  return {
    decision: 'missing',
    detail: hasGuard ? 'access=- legacyGuard=query.guard' : 'access=- guard=-',
    kind: 'query',
    name: query.key,
    source: 'access',
  };
}

function mutationAccessFact(mutation: AppMutationDeclaration): AccessExplainFact {
  const explicit = explicitAccessFact('mutation', mutation.key, mutation.access);
  if (explicit) return explicit;

  const hasGuard = typeof mutation.guard === 'function';
  return {
    decision: 'missing',
    detail: hasGuard ? 'access=- legacyGuard=mutation.guard' : 'access=- guard=-',
    kind: 'mutation',
    name: mutation.key,
    source: 'access',
  };
}

function routeAccessFact(route: RouteDeclaration<any, any, any, any, any, any>): AccessExplainFact {
  const explicit = explicitAccessFact('page', route.path, route.access);
  if (explicit) return explicit;

  const guardSource = routeGuardSource(route);
  return {
    decision: 'missing',
    detail: guardSource === undefined ? 'access=- guard=-' : `access=- legacyGuard=${guardSource}`,
    kind: 'page',
    name: route.path,
    source: 'access',
  };
}

function endpointAccessFact(
  endpoint: EndpointDeclaration<string, EndpointMethod, EndpointMount>,
): AccessExplainFact {
  const webhook = isWebhookEndpoint(endpoint);
  const kind = webhook ? 'webhook' : 'endpoint';
  const name = webhook ? endpoint.name : endpoint.path;
  const auth = endpoint.auth;
  const detail = endpointAccessDetail(endpoint, auth);
  const explicit = explicitAccessFact(kind, name, endpoint.access);
  if (explicit) {
    return {
      ...explicit,
      detail: `${explicit.detail} ${detail}`,
    };
  }

  return {
    decision: 'missing',
    detail: `access=- ${detail}`,
    kind,
    name,
    source: 'access',
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

function explicitAccessFact(
  kind: AccessExplainFact['kind'],
  name: string,
  access: AccessDecision | undefined,
): AccessExplainFact | undefined {
  if (access === undefined) return undefined;

  if (access.kind === 'public') {
    return {
      decision: 'public',
      detail: 'access=public',
      justification: access.reason,
      kind,
      name,
      source: 'access',
    };
  }

  if (access.kind === 'verified-machine-auth') {
    return {
      decision: 'verified',
      detail: 'access=verified-machine-auth',
      kind,
      name,
      source: 'access',
    };
  }

  return {
    decision: 'guard',
    detail: `access=guard-chain guards=${listAccessGuards(access)}`,
    kind,
    name,
    source: 'access',
  };
}

function listAccessGuards(access: Extract<AccessDecision, { kind: 'guard-chain' }>): string {
  return access.guards.length === 0 ? '-' : access.guards.map((guard) => guard.name).join(',');
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
