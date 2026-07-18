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
  endpointHasSelfVerifyingAuth,
  type EndpointAuthDeclaration,
  type EndpointDeclaration,
  type EndpointMethod,
  type EndpointMount,
} from './endpoint.js';
import { guardAuditName, type Guard } from './guards.js';
import type { LayoutDeclaration, RouteDeclaration } from './route.js';
import type { WebhookDeclaration } from './webhook.js';
import { appendDenseOwnArrayValue, denseOwnArrayForEach } from './registry-lookup.js';
import { securityArrayJoin, securityArraySort } from './response-security-intrinsics.js';

/**
 * @internal Build the producer-owned access ledger from an assembled app
 * (SPEC.md §10.2). Guard/auth posture is runtime enforcement input, not an
 * explain fact; missing `access:` declarations emit KV436-producing rows.
 */
export function accessFactsFromApp(
  app: Pick<KovoApp, 'endpoints' | 'mutations' | 'queries' | 'routes'>,
): AccessExplainFact[] {
  const facts: AccessExplainFact[] = [];
  appendAccessFacts(facts, app.endpoints, endpointAccessFact, 'App endpoint access ledger');
  appendAccessFacts(facts, app.mutations, mutationAccessFact, 'App mutation access ledger');
  appendAccessFacts(facts, app.queries, queryAccessFact, 'App query access ledger');
  appendAccessFacts(facts, app.routes, routeAccessFact, 'App route access ledger');
  securityArraySort(facts, compareAccessFact);
  return facts;
}

function appendAccessFacts<Input>(
  target: AccessExplainFact[],
  declarations: readonly Input[],
  project: (declaration: Input) => AccessExplainFact,
  label: string,
): void {
  denseOwnArrayForEach(
    declarations,
    (declaration) => appendDenseOwnArrayValue(target, project(declaration)),
    label,
  );
}

function queryAccessFact(query: AppQueryDeclaration): AccessExplainFact {
  const explicit = declarationAccessFact('query', query.key, query);
  if (explicit) return explicit;

  return missingAccessFact('query', query.key);
}

function mutationAccessFact(mutation: AppMutationDeclaration): AccessExplainFact {
  const explicit = declarationAccessFact('mutation', mutation.key, mutation);
  if (explicit) return explicit;

  return missingAccessFact('mutation', mutation.key);
}

function routeAccessFact(route: RouteDeclaration<any, any, any, any, any, any>): AccessExplainFact {
  const explicit = declarationAccessFact('page', route.path, route) ?? layoutAccessFact(route);
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
  return securityArrayJoin(
    [
      `method=${endpoint.method}`,
      `path=${endpoint.path}`,
      `mount=${endpoint.mount}`,
      `auth=${auth === undefined ? '-' : auth.kind === 'none' ? 'none' : `${auth.kind}:${auth.name}`}`,
    ],
    ' ',
  );
}

function layoutAccessFact(
  route: RouteDeclaration<any, any, any, any, any, any>,
): AccessExplainFact | undefined {
  let layout: LayoutDeclaration<any, any, any> | undefined = route.layout;
  while (layout !== undefined) {
    const fact = declarationAccessFact('page', route.path, layout);
    if (fact) {
      return {
        ...fact,
        detail: `${fact.detail} source=${accessDecisionFor(layout) === undefined ? 'layout.guard' : 'layout.access'}`,
      };
    }
    layout = layout.parent;
  }

  return undefined;
}

function declarationAccessFact(
  kind: AccessExplainFact['kind'],
  name: string,
  declaration: object & {
    access?: AccessDecision;
    guard?: Guard<any, any>;
  },
): AccessExplainFact | undefined {
  return (
    explicitAccessFact(kind, name, accessDecisionFor(declaration)) ??
    legacyGuardAccessFact(kind, name, declaration.guard)
  );
}

function legacyGuardAccessFact(
  kind: AccessExplainFact['kind'],
  name: string,
  guard: Guard<any, any> | undefined,
): AccessExplainFact | undefined {
  if (guard === undefined) return undefined;
  return {
    decision: 'guard',
    detail: `access=legacy-guard guards=${guardAuditName(guard)}`,
    kind,
    name,
    source: 'access',
  };
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
      detail: `access=guards guards=${securityArrayJoin(accessGuardNames(executable), ',')}`,
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
  const names: string[] = [];
  denseOwnArrayForEach(
    access,
    (guard) => appendDenseOwnArrayValue(names, guardAuditName(guard)),
    'Access guard audit ledger',
  );
  return names;
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
  return endpointHasExecutableVerifier(endpoint) || endpointHasSelfVerifyingAuth(endpoint);
}

function compareAccessFact(left: AccessExplainFact, right: AccessExplainFact): number {
  return compareAccessString(left.kind, right.kind) || compareAccessString(left.name, right.name);
}

function compareAccessString(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
