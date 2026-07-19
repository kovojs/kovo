import type * as CoreGraph from '@kovojs/core/internal/graph';

import {
  accessDecisionFor,
  executableGuardAccessDecision,
  type AccessDecision,
} from './access.js';
import { explainGuard, type Guard, type GuardAuditFact } from './guards.js';
import type {
  RuntimeTableSecurityWireManifest,
  RuntimeTableSecurityWireTable,
} from './internal/runtime-registry-wire.js';
import {
  explainPostgresAuthorizationCorrespondence,
  postgresOwnerColumnPolicyTerm,
  postgresOwnerViaPolicyTerm,
  renderPostgresOwnerPolicyPredicate,
  type PostgresAuthorizationPolicyExplainInput,
  type PostgresOwnerPolicyTerm,
} from './postgres-authorization-correspondence.js';

interface AuthorizationDeclaration {
  readonly access?: AccessDecision;
  readonly guard?: Guard<any, any>;
}

interface AuthorizationQueryDeclaration extends AuthorizationDeclaration {
  readonly key: string;
}

interface AuthorizationMutationDeclaration extends AuthorizationDeclaration {
  readonly key: string;
}

interface AuthorizationLayoutDeclaration extends AuthorizationDeclaration {
  readonly parent?: AuthorizationLayoutDeclaration;
  readonly queries?: Readonly<Record<string, { readonly key: string }>>;
}

interface AuthorizationRouteDeclaration extends AuthorizationDeclaration {
  readonly layout?: AuthorizationLayoutDeclaration;
  readonly path: string;
}

interface AuthorizationApp {
  readonly mutations: readonly AuthorizationMutationDeclaration[];
  readonly queries: readonly AuthorizationQueryDeclaration[];
  readonly routes: readonly AuthorizationRouteDeclaration[];
}

interface ProtectedTablePolicy {
  readonly policy: PostgresAuthorizationPolicyExplainInput;
  readonly table: RuntimeTableSecurityWireTable;
}

/**
 * Pair each exact app surface with the concrete Postgres RLS policy it can reach.
 *
 * SPEC §10.3: this is deliberately an honest non-correspondence ledger. Build output proves which
 * guard facts and generated predicate coexist; it does not claim that an arbitrary app callback is
 * equivalent to SQL or that an operator actually installed the policy in a live database.
 */
export function authorizationCorrespondenceFactsFromApp(input: {
  readonly app: AuthorizationApp;
  readonly mutations: readonly CoreGraph.MutationExplain[];
  readonly pages: readonly CoreGraph.PageExplain[];
  readonly queries: readonly CoreGraph.QueryReadSet[];
  readonly tableSecurity?: RuntimeTableSecurityWireManifest;
}): readonly CoreGraph.AuthorizationCorrespondenceExplainFact[] {
  if (input.tableSecurity === undefined) return [];

  const tablesByName = exactTablesByName(input.tableSecurity.tables);
  const protectedTables: ProtectedTablePolicy[] = [];
  for (const table of input.tableSecurity.tables) {
    if (table.dialect !== 'postgres') continue;
    const policy = protectedPolicyForTable(table, tablesByName);
    if (policy !== undefined) protectedTables.push({ policy, table });
  }

  const queriesByKey = new Map(input.app.queries.map((query) => [query.key, query] as const));
  const mutationsByKey = new Map(
    input.app.mutations.map((mutation) => [mutation.key, mutation] as const),
  );
  const routesByPath = new Map(input.app.routes.map((route) => [route.path, route] as const));
  const queryFactsByKey = new Map(input.queries.map((query) => [query.query, query] as const));
  const facts: CoreGraph.AuthorizationCorrespondenceExplainFact[] = [];
  const tablesWithAppSurfaces = new Set<string>();

  for (const query of input.queries) {
    for (const protectedTable of protectedTables) {
      const domain = protectedTable.table.domain;
      if (domain === undefined || !query.domains.includes(domain)) continue;
      facts.push(
        authorizationSurfaceFact(
          protectedTable,
          { kind: 'query', name: query.query },
          guardFactsForDeclaration(queriesByKey.get(query.query)),
        ),
      );
      tablesWithAppSurfaces.add(protectedTable.table.name);
    }
  }

  for (const mutation of input.mutations) {
    for (const protectedTable of protectedTables) {
      const domain = protectedTable.table.domain;
      if (domain === undefined || !mutation.writes?.includes(domain)) continue;
      facts.push(
        authorizationSurfaceFact(
          protectedTable,
          { kind: 'mutation', name: mutation.key },
          guardFactsForDeclaration(mutationsByKey.get(mutation.key)),
        ),
      );
      tablesWithAppSurfaces.add(protectedTable.table.name);
    }
  }

  for (const page of input.pages) {
    const route = routesByPath.get(page.route);
    const queryKeys = pageQueryKeys(page, route);
    for (const queryKey of queryKeys) {
      const query = queryFactsByKey.get(queryKey);
      if (query === undefined) continue;
      for (const protectedTable of protectedTables) {
        const domain = protectedTable.table.domain;
        if (domain === undefined || !query.domains.includes(domain)) continue;
        facts.push(
          authorizationSurfaceFact(
            protectedTable,
            { kind: 'page', name: page.route, viaQuery: queryKey },
            guardFactsForPage(route, queriesByKey.get(queryKey)),
          ),
        );
        tablesWithAppSurfaces.add(protectedTable.table.name);
      }
    }
  }

  for (const protectedTable of protectedTables) {
    if (!tablesWithAppSurfaces.has(protectedTable.table.name)) {
      facts.push(
        authorizationSurfaceFact(
          protectedTable,
          { kind: 'unreferenced', name: protectedTable.table.name },
          [],
        ),
      );
    }
    for (const site of ['admin', 'system'] as const) {
      facts.push(
        authorizationSurfaceFact(
          {
            policy: {
              emissionSite: site,
              predicate: 'true',
              tableName: protectedTable.table.name,
            },
            table: protectedTable.table,
          },
          { kind: 'framework-policy', name: site },
          [],
        ),
      );
    }
  }

  facts.sort(compareAuthorizationSurfaceFacts);
  return Object.freeze(facts);
}

function exactTablesByName(
  tables: readonly RuntimeTableSecurityWireTable[],
): ReadonlyMap<string, RuntimeTableSecurityWireTable> {
  const byName = new Map<string, RuntimeTableSecurityWireTable>();
  for (const table of tables) {
    if (byName.has(table.name)) {
      throw new TypeError(
        `KV414: duplicate physical table ${table.name} is ambiguous in the authorization correspondence graph (SPEC §10.3).`,
      );
    }
    byName.set(table.name, table);
  }
  return byName;
}

function protectedPolicyForTable(
  table: RuntimeTableSecurityWireTable,
  tablesByName: ReadonlyMap<string, RuntimeTableSecurityWireTable>,
): PostgresAuthorizationPolicyExplainInput | undefined {
  const classifiedOwner = table.authorizationClassifications.includes('owned');
  const classifiedOwnerVia = table.authorizationClassifications.includes('ownedVia');
  const classifiedAuthzPolicy = table.authorizationClassifications.includes('authzPolicy');
  if (
    classifiedOwner !== (table.owner !== undefined) ||
    classifiedOwnerVia !== (table.ownerVia !== undefined) ||
    classifiedAuthzPolicy !== (table.authzPolicy !== undefined)
  ) {
    throw new TypeError(
      `KV414: Postgres table ${table.name} has inconsistent authorization classification facts (SPEC §10.3).`,
    );
  }
  const primaryCount =
    Number(classifiedOwner) + Number(classifiedOwnerVia) + Number(classifiedAuthzPolicy);
  if (primaryCount === 0) return undefined;
  if (primaryCount !== 1) {
    throw new TypeError(
      `KV414: Postgres table ${table.name} must have exactly one primary RLS classification (SPEC §10.3).`,
    );
  }

  if (classifiedAuthzPolicy) {
    if (table.authzPolicy?.kind !== 'sql') {
      throw new TypeError(
        `KV414: Postgres authzPolicy for ${table.name} must retain its exact SQL predicate (SPEC §10.3).`,
      );
    }
    return {
      emissionSite: 'authzPolicy',
      predicate: table.authzPolicy.sql,
      tableName: table.name,
    };
  }

  const term = ownerPolicyTermForTable(table.name, tablesByName, new Set<string>());
  return {
    emissionSite: classifiedOwner ? 'owner' : 'ownerVia',
    predicate: renderPostgresOwnerPolicyPredicate(term),
    tableName: table.name,
    term,
  };
}

function ownerPolicyTermForTable(
  tableName: string,
  tablesByName: ReadonlyMap<string, RuntimeTableSecurityWireTable>,
  visited: Set<string>,
): PostgresOwnerPolicyTerm {
  if (visited.has(tableName)) {
    throw new TypeError(`KV414: ownerVia cycle reaches ${tableName} (SPEC §10.3).`);
  }
  visited.add(tableName);
  const table = tablesByName.get(tableName);
  if (table === undefined || table.dialect !== 'postgres') {
    throw new TypeError(
      `KV414: ownerVia cannot resolve Postgres parent table ${tableName} (SPEC §10.3).`,
    );
  }
  if (table.owner !== undefined) {
    return postgresOwnerColumnPolicyTerm({
      columnName: table.owner.columnName,
      tableName: table.name,
    });
  }
  if (table.ownerVia === undefined) {
    throw new TypeError(
      `KV414: ownerVia chain through ${tableName} does not terminate at an owner column (SPEC §10.3).`,
    );
  }
  return postgresOwnerViaPolicyTerm({
    fkColumnName: table.ownerVia.fkColumnName,
    parent: ownerPolicyTermForTable(table.ownerVia.parentTable, tablesByName, visited),
    parentKeyColumnName: table.ownerVia.parentKeyColumnName,
    tableName: table.name,
  });
}

function authorizationSurfaceFact(
  protectedTable: ProtectedTablePolicy,
  surface: CoreGraph.AuthorizationCorrespondenceExplainFact['surface'],
  guardFacts: readonly GuardAuditFact[],
): CoreGraph.AuthorizationCorrespondenceExplainFact {
  return Object.freeze({
    activation: Object.freeze({ source: 'build' as const, status: 'environment-unchecked' as const }),
    correspondence: explainPostgresAuthorizationCorrespondence({
      guardFacts,
      policy: protectedTable.policy,
    }),
    schema: 'kovo.postgres.authorization-surface/v1' as const,
    surface: Object.freeze(surface),
    table: Object.freeze({
      ...(protectedTable.table.domain === undefined
        ? {}
        : { domain: protectedTable.table.domain }),
      name: protectedTable.table.name,
    }),
  });
}

function guardFactsForDeclaration(
  declaration: AuthorizationDeclaration | undefined,
): readonly GuardAuditFact[] {
  if (declaration === undefined) return [];
  const access = accessDecisionFor(declaration);
  if (access === undefined) return explainGuard(declaration.guard);
  const guards = executableGuardAccessDecision(access);
  if (guards === undefined) return [];
  const facts: GuardAuditFact[] = [];
  for (const guard of guards) facts.push(...explainGuard(guard));
  return facts;
}

function guardFactsForPage(
  route: AuthorizationRouteDeclaration | undefined,
  query: AuthorizationQueryDeclaration | undefined,
): readonly GuardAuditFact[] {
  const facts: GuardAuditFact[] = [];
  if (route !== undefined) {
    const layouts: AuthorizationLayoutDeclaration[] = [];
    const seen = new Set<AuthorizationLayoutDeclaration>();
    let layout = route.layout;
    while (layout !== undefined) {
      if (seen.has(layout)) {
        throw new TypeError(`KV414: route ${route.path} has a cyclic layout chain (SPEC §10.3).`);
      }
      seen.add(layout);
      layouts.push(layout);
      layout = layout.parent;
    }
    layouts.reverse();
    for (const declaration of layouts) facts.push(...guardFactsForDeclaration(declaration));
    facts.push(...guardFactsForDeclaration(route));
  }
  facts.push(...guardFactsForDeclaration(query));
  return facts;
}

function pageQueryKeys(
  page: CoreGraph.PageExplain,
  route: AuthorizationRouteDeclaration | undefined,
): readonly string[] {
  const keys = new Set<string>(page.queries ?? []);
  for (const layout of page.layouts ?? []) {
    for (const query of layout.queries ?? []) keys.add(query);
  }
  const seen = new Set<AuthorizationLayoutDeclaration>();
  let layout = route?.layout;
  while (layout !== undefined) {
    if (seen.has(layout)) {
      throw new TypeError(`KV414: route ${route?.path ?? page.route} has a cyclic layout chain.`);
    }
    seen.add(layout);
    for (const query of Object.values(layout.queries ?? {})) keys.add(query.key);
    layout = layout.parent;
  }
  return [...keys].sort(compareStrings);
}

function compareAuthorizationSurfaceFacts(
  left: CoreGraph.AuthorizationCorrespondenceExplainFact,
  right: CoreGraph.AuthorizationCorrespondenceExplainFact,
): number {
  return (
    compareStrings(left.table.name, right.table.name) ||
    compareStrings(left.surface.kind, right.surface.kind) ||
    compareStrings(left.surface.name, right.surface.name) ||
    compareStrings(left.surface.viaQuery ?? '', right.surface.viaQuery ?? '') ||
    compareStrings(
      left.correspondence.rls.emissionSite,
      right.correspondence.rls.emissionSite,
    )
  );
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
