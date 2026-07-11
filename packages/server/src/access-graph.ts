import type { AccessExplainFact } from '@kovojs/core/internal/graph';

import {
  accessDecisionFor,
  executableGuardAccessDecision,
  isGuardAccessDecision,
  type AccessDecision,
} from './access.js';
import type { AppMutationDeclaration, AppQueryDeclaration, KovoApp } from './app-types.js';
import {
  endpointAuthFor,
  endpointHasExecutableVerifier,
  type EndpointAuthDeclaration,
  type EndpointDeclaration,
  type EndpointMethod,
  type EndpointMount,
} from './endpoint.js';
import { guardAuditName } from './guards.js';
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
  const explicit = explicitAccessFact('query', query.key, accessDecisionFor(query));
  if (explicit) return explicit;

  return missingAccessFact('query', query.key);
}

function mutationAccessFact(mutation: AppMutationDeclaration): AccessExplainFact {
  const explicit = explicitAccessFact('mutation', mutation.key, accessDecisionFor(mutation));
  if (explicit) return explicit;

  return missingAccessFact('mutation', mutation.key);
}

function routeAccessFact(route: RouteDeclaration<any, any, any, any, any, any>): AccessExplainFact {
  const explicit =
    explicitAccessFact('page', route.path, accessDecisionFor(route)) ??
    explicitLayoutAccessFact(route);
  if (explicit) return explicit;

  return missingAccessFact('page', route.path);
}

function endpointAccessFact(
  endpoint: EndpointDeclaration<string, EndpointMethod, EndpointMount>,
): AccessExplainFact {
  const webhook = isWebhookEndpoint(endpoint);
  const kind = webhook ? 'webhook' : 'endpoint';
  const name = webhook ? endpoint.name : endpoint.path;
  const auth = endpointAuthFor(endpoint);
  const access = accessDecisionFor(endpoint);
  const detail = endpointAccessDetail(endpoint, auth);
  if (
    !isGuardAccessDecision(access) &&
    access?.kind === 'verified-machine-auth' &&
    !hasExecutableMachineAuth(endpoint)
  ) {
    return {
      decision: 'missing',
      detail: `access=verified-machine-auth audit-only-without-executable-verifier ${detail}`,
      kind,
      name,
      source: 'access',
    };
  }

  const explicit = explicitAccessFact(kind, name, access);
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
    const fact = explicitAccessFact('page', route.path, accessDecisionFor(layout));
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

  if (isGuardAccessDecision(access)) {
    const executable = executableGuardAccessDecision(access);
    if (executable === undefined) return undefined;
    return {
      decision: 'guard',
      detail: `access=guards guards=${accessGuardNames(executable).join(',')}`,
      kind,
      name,
      source: 'access',
    };
  }

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

function accessGuardNames(access: readonly import('./guards.js').Guard<any, any>[]): string[] {
  return access.map((guard) => guardAuditName(guard));
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
  if (isWebhookEndpoint(endpoint)) return endpoint.webhookDefinition.verify !== 'none';
  const auth = endpointAuthFor(endpoint);
  return (
    endpointHasExecutableVerifier(endpoint) ||
    (auth?.kind !== 'none' && auth?.name === 'kovo-capability-url')
  );
}

function compareAccessFact(left: AccessExplainFact, right: AccessExplainFact): number {
  return left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name);
}
