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
import type { WebhookDeclaration } from './webhook.js';

/**
 * @internal Build the producer-owned access ledger from an assembled app
 * (SPEC.md §10.2). Guard/auth posture is runtime enforcement input, not an
 * explain fact; missing `access:` declarations emit KV436-producing rows.
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

  return missingAccessFact('query', query.key);
}

function mutationAccessFact(mutation: AppMutationDeclaration): AccessExplainFact {
  const explicit = explicitAccessFact('mutation', mutation.key, mutation.access);
  if (explicit) return explicit;

  return missingAccessFact('mutation', mutation.key);
}

function routeAccessFact(route: RouteDeclaration<any, any, any, any, any, any>): AccessExplainFact {
  const explicit =
    explicitAccessFact('page', route.path, route.access) ?? explicitLayoutAccessFact(route);
  if (explicit) return explicit;

  return missingAccessFact('page', route.path);
}

function endpointAccessFact(
  endpoint: EndpointDeclaration<string, EndpointMethod, EndpointMount>,
): AccessExplainFact {
  const webhook = isWebhookEndpoint(endpoint);
  const kind = webhook ? 'webhook' : 'endpoint';
  const name = webhook ? endpoint.name : endpoint.path;
  const auth = endpoint.auth;
  const detail = endpointAccessDetail(endpoint, auth);
  if (endpoint.access?.kind === 'verified-machine-auth' && !hasExecutableMachineAuth(endpoint)) {
    return {
      decision: 'missing',
      detail: `access=verified-machine-auth audit-only-without-executable-verifier ${detail}`,
      kind,
      name,
      source: 'access',
    };
  }

  const explicit = explicitAccessFact(kind, name, endpoint.access);
  if (explicit) {
    return {
      ...explicit,
      detail: `${explicit.detail} ${detail}`,
    };
  }

  return {
    ...missingAccessFact(kind, name),
    detail: `missing access fact ${detail}`,
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

function explicitLayoutAccessFact(
  route: RouteDeclaration<any, any, any, any, any, any>,
): AccessExplainFact | undefined {
  let layout: LayoutDeclaration<any, any, any> | undefined = route.layout;
  while (layout !== undefined) {
    const fact = explicitAccessFact('page', route.path, layout.access);
    if (fact) {
      return {
        ...fact,
        detail: `${fact.detail} source=layout.access`,
      };
    }
    layout = layout.parent;
  }

  return undefined;
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

function missingAccessFact(kind: AccessExplainFact['kind'], name: string): AccessExplainFact {
  return {
    decision: 'missing',
    detail: 'missing access fact',
    kind,
    name,
    source: 'access',
  };
}

function listAccessGuards(access: Extract<AccessDecision, { kind: 'guard-chain' }>): string {
  return access.guards.length === 0 ? '-' : access.guards.map((guard) => guard.name).join(',');
}

function isWebhookEndpoint(
  endpoint: EndpointDeclaration<string, EndpointMethod, EndpointMount>,
): endpoint is WebhookDeclaration<string, string, any, any, any> {
  return (
    'webhook' in endpoint &&
    endpoint.webhook === true &&
    'name' in endpoint &&
    typeof endpoint.name === 'string'
  );
}

function hasExecutableMachineAuth(
  endpoint: EndpointDeclaration<string, EndpointMethod, EndpointMount>,
): boolean {
  if (isWebhookEndpoint(endpoint)) {
    return endpoint.webhookDefinition.verify !== 'none';
  }
  return endpoint.auth?.kind !== 'none' && endpoint.auth?.verify !== undefined;
}

function compareAccessFact(left: AccessExplainFact, right: AccessExplainFact): number {
  return left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name);
}
