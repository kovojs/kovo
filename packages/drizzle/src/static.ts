import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JsonValue } from '@kovojs/core';
import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import type {
  AlgebraicField,
  AlgebraicQueryShape,
  ArithOp,
  OrderByColumn,
  PuntReason,
  Rowset,
  RowsetFilter,
  RowWitness,
  SymbolicEffect,
  SymbolicMatch,
  SymbolicValue,
} from '@kovojs/core/internal/derivation';
import type {
  MassAssignmentFact,
  OwnerDomainFact,
  QueryProjectedColumn,
  QueryReadProvenance,
  QueryReadScopeProvenance,
  QueryWriteReachabilityFact,
  RevealExplainFact,
  ScopeAuditFact,
  ToctouFact,
  TouchGraph,
  TouchGraphEntry,
} from '@kovojs/core/internal/graph';
import {
  Node,
  Project,
  SyntaxKind,
  ts,
  type BindingElement,
  type CallExpression,
  type CompilerOptions,
  type ArrowFunction,
  type FunctionDeclaration,
  type FunctionExpression,
  type ImportDeclaration,
  type ObjectLiteralExpression,
  type ParameterDeclaration,
  type PropertyAssignment,
  type SourceFile,
  type VariableDeclaration,
  type Symbol as MorphSymbol,
  type Type as MorphType,
} from 'ts-morph';
/** @internal */
/** @internal */ export type {
  DomainRegistryInput,
  ReadSummaryInput,
  TouchGraphDiagnostic,
  UnresolvedSummaryInput,
  WriteSummaryInput,
} from './graph.js';
/** @internal */
export {
  createTouchGraphEntry,
  diagnosticsForTouchGraph,
  serializeDomainRegistry,
  serializeTouchGraph,
} from './graph.js';
import {
  createTouchGraphEntry,
  type ReadSummaryInput,
  type TouchGraphDiagnostic,
  type UnresolvedSummaryInput,
  type WriteSummaryInput,
} from './graph.js';
import {
  isDrizzleDatabaseTypeName,
  isDrizzleTableFactoryName,
  type KovoDomainRef,
  type KovoDomainTableAnnotation,
  type KovoFanAnnotation,
  type KovoTableAnnotation,
  type KovoViewAnnotation,
} from './drizzle-surface.js';
/** @internal */
/** @internal */ export type {
  InferredMutationTouchSite,
  InvalidationQueryInput,
  InvalidationRegistry,
  InvalidationRegistryEntry,
  MutationTouchRegistry,
  MutationTouchInput,
} from './invalidation.js';
/** @internal */
export {
  deriveInvalidationRegistry,
  deriveMutationTouchRegistry,
  serializeInvalidationRegistry,
  serializeMutationTouchRegistry,
} from './invalidation.js';

/** @internal */
/** @internal */ export type {
  TrustEscapeProjectOptions,
  TrustEscapeSourceFileInput,
} from './trust-escapes-static.js';
/** @internal */
export {
  collectCapabilityEscapesFromProject,
  collectCookieDowngradesFromProject,
  collectTrustEscapesFromProject,
  collectUnregisteredSinksFromProject,
} from './trust-escapes-static.js';
import {
  extractMassAssignmentFromProjectExtraction,
  extractQueryWriteReachabilityFromProjectExtraction,
  extractToctouFromProjectExtraction,
} from './static/derivation.js';
import {
  symbolProvenanceContextForNodes,
  symbolProvenanceForExpression,
  type SymbolProvenance,
  type SymbolProvenanceContext,
  type SymbolProvenanceRoot,
} from './static/symbol-provenance.js';
import {
  expressionResolvesToFrameworkExport,
  frameworkExport,
} from './static/framework-identity.js';
import { drizzleDiagnostic } from './static/diagnostics.js';

/** @internal */ export const IGNORED_LOCAL_CALL_NAMES = new Set([
  'eq',
  'for',
  'function',
  'if',
  'kovo',
  'pgTable',
  'return',
  'sqliteTable',
  'switch',
  'while',
]);
/** @internal */ export const KV411_MESSAGE = 'Query read set includes an exempt table';
/** @internal */ export const UNRESOLVED_READ_SOURCE_EXPRESSION = '__kovoUnresolvedReadSource';
/** @internal */ export const BOOLEAN_COLUMN_BUILDERS = new Set(['boolean']);
/** @internal */ export const JSON_COLUMN_BUILDERS = new Set(['json', 'jsonb']);
/** @internal */ export const NUMBER_COLUMN_BUILDERS = new Set([
  'bigint',
  'doublePrecision',
  'integer',
  'numeric',
  'real',
  'smallint',
  'serial',
  'bigserial',
  'smallserial',
]);
/** @internal */ export const UNCLASSIFIED_DRIZZLE_RECEIVER_MUTATION_METHODS = new Set([
  '$count',
  'execute',
]);
/** @internal */ export const RAW_SQL_RECEIVER_SINK_METHODS = new Set([
  'all',
  'exec',
  'execute',
  'get',
  'prepare',
  'query',
  'run',
  'values',
]);
/** @internal */ export const RAW_SQL_WRITE_RECEIVER_SINK_METHODS = new Set([
  'all',
  'exec',
  'execute',
  'get',
  'query',
  'run',
  'values',
]);
const AMBIGUOUS_RAW_SQL_RECEIVER_SINK_METHODS = new Set(['all', 'get', 'run', 'values']);
/** @internal */ export const DRIZZLE_SELECT_QUERY_METHODS = new Set([
  'select',
  'selectDistinct',
  'selectDistinctOn',
]);
/** @internal */ export const DRIZZLE_CORE_MODULE_SPECIFIERS = new Set([
  'drizzle-orm/pg-core',
  'drizzle-orm/sqlite-core',
]);
/** @internal */ export const DRIZZLE_UNMODELED_RELATION_FACTORY_NAMES = new Set([
  'pgMaterializedView',
  'pgView',
  'sqliteView',
]);
/** @internal */ export const CLASSIFIED_DRIZZLE_RECEIVER_METHODS = new Set([
  ...DRIZZLE_SELECT_QUERY_METHODS,
  'delete',
  'insert',
  'refreshMaterializedView',
  'transaction',
  'update',
  'with',
]);
/** @internal */ export const COMPUTED_DRIZZLE_RECEIVER_METHOD = '<computed>';
/** @internal */ export const UNRESOLVED_DOMAIN_WRITE_COMPUTED_MEMBER = '<computed>';
/** @internal */ export const UNRESOLVED_DOMAIN_WRITE_SPREAD_MEMBER = '<spread>';
/** @internal */ export const UNMODELED_RELATION_EXPRESSION_PREFIX = '__kovoUnmodeledRelation';
/** @internal */ export const DRIZZLE_STATIC_PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));
/** @internal */ export const TOUCH_BODY_ITERATION_CALLBACK_METHODS = new Set([
  'filter',
  'flatMap',
  'forEach',
  'map',
  'reduce',
]);

/** @internal */
/** @internal */ export type QueryShape =
  | 'array'
  | 'boolean'
  | 'number'
  | 'object'
  | 'string'
  | QueryShapeWrapper
  | readonly QueryShape[]
  | {
      readonly [key: string]: QueryShape;
    };

/** @internal */
/** @internal */ export interface QueryShapeReveal {
  grade: 'audit' | 'proof';
  justification?: string;
  method: 'arbitrary-fn' | 'fixed-redactor' | 'server-projection';
  selectedSecret?: boolean;
  site?: string;
  source?: string;
}

/** @internal */
/** @internal */ export type QueryShapeWrapper =
  | {
      kind: 'nullable' | 'optional' | 'secret' | 'volatile-time';
      shape: QueryShape;
    }
  | {
      kind: 'table-row';
      shape: QueryShape;
      table: string;
    }
  | {
      kind: 'revealed';
      reveal: QueryShapeReveal;
      shape: QueryShape;
    };

/** @internal */
/** @internal */ export interface QueryFact {
  /**
   * Owner-annotated domains this query selects through a client-visible `input.*`
   * arg compared against ANY column of the domain's table (SPEC §10.3, KV414, A3) —
   * not just the declared `key:` column, so `where(eq(orders.userId, input.userId))`
   * on `{ key: id, owner: userId }` is still flagged `args`/IDOR.
   */
  argScopedReads?: readonly string[];
  /** Private guard principal keys accepted by the query guard chain, e.g. `guard:userId`. */
  acceptedGuardPrivateKeys?: readonly string[];
  /** Exact client-visible keys for `argScopedReads`, used to scope `owns()` suppression. */
  argScopedReadKeys?: readonly OwnerScopeKey[];
  diagnostics?: readonly TouchGraphDiagnostic[];
  /**
   * The query's `where()`/join predicate selects rows by a client-visible `input.*`
   * arg keying ANY table (owner or not) — the IDOR vector regardless of which table
   * the arg lands on (SPEC §10.3, KV414 join-keyed bypass). When an owner domain is
   * read but is itself neither directly arg-keyed nor session/`owns()`-scoped, this
   * arg-reachability is what makes the unscoped owner read an IDOR candidate: an
   * authenticated attacker supplies any client key and reads another principal's owner
   * rows joined in through a non-owner table (e.g.
   * `from(orders).innerJoin(items, eq(items.orderId, orders.id)).where(eq(items.id, input.itemId))`).
   */
  hasClientArgPredicate?: boolean;
  instanceKey?: {
    domain: string;
    key: string;
  };
  /**
   * Narrow OPP-28 Authorization-gates-DATA subset: owner-annotated domains whose
   * owner column is compared against the matching session/principal private symbol
   * through exact equality-equivalent shapes: `eq(...)` or the singleton
   * `inArray(owner, [principal])` subset. Range predicates and negated
   * membership never prove exact `scope: session`. This is stricter than
   * `sessionAnchoredReads`, which may anchor any table column.
   */
  ownerScopedSessionReads?: readonly string[];
  /** Exact private principal symbols for `ownerScopedSessionReads`, e.g. `guard:userId`. */
  ownerScopedPrivateReadKeys?: readonly OwnerPrivateScopeKey[];
  query: string;
  readProvenance?: readonly QueryReadProvenance[];
  reads: readonly string[];
  /** Domains explicitly marked externally-owned/read-only for missed-invalidation posture. */
  readOnlyDomains?: readonly string[];
  /** Domains this query anchors to `req.session.*` (session-scoped, SPEC §11.1). */
  sessionAnchoredReads?: readonly string[];
  shape: QueryShape;
  site: string;
}

/** @internal */
/** @internal */ export interface OwnerScopeKey {
  domain: string;
  key: string;
}

/** @internal */
/** @internal */ export interface OwnerPrivateScopeKey {
  domain: string;
  privateKey: string;
}

interface OwnerDomainScope {
  domain: string;
  owner?: string;
}

/** @internal */ export function revealFactsFromQueryFacts(
  facts: readonly QueryFact[],
): RevealExplainFact[] {
  return facts
    .flatMap((fact) => revealFactsFromQueryShape(fact.query, fact.shape, fact.site))
    .sort(compareRevealExplainFacts);
}

function compareRevealExplainFacts(left: RevealExplainFact, right: RevealExplainFact): number {
  return (
    left.query.localeCompare(right.query) ||
    left.path.localeCompare(right.path) ||
    left.site.localeCompare(right.site)
  );
}

/**
 * Scope-audit facts for reads of an `owner:`-annotated domain (SPEC §10.3). The
 * KV414 IDOR signal is precisely a **client-visible `args.*` key**, so this emits:
 * `args` for an arg-keyed read (the IDOR candidate the CLI enforces unless an
 * `owns()` guard discharges it) and `session` for a directly `req.session`-anchored
 * read (safe). A read that is **neither** — e.g. one keyed by a local bound from
 * the session (`const userId = …session…; where(eq(col, userId))`) — emits a
 * `session` fact when the session-via-local tracing (`querySessionAnchoredDomains`)
 * proves the binding, and otherwise emits **no fact** UNLESS the query is also
 * arg-reachable: see the join-keyed bypass branch below.
 *
 * **Join-keyed bypass (SPEC §10.3, KV414 fail-closed).** Reading an owner table
 * through a JOIN keyed on the JOINED (non-owner) table — e.g.
 * `from(orders).innerJoin(items, eq(items.orderId, orders.id)).where(eq(items.id, input.itemId))`
 * — brings owner domain `order` into the read set while the only client-arg
 * predicate (`input.itemId`) lands on the non-owner `items` table. The owner rows
 * are therefore selected by a client-controlled key but are NOT directly arg-keyed
 * NOR session/`owns()`-scoped, so an authenticated attacker reads another
 * principal's owner rows. We emit `scope:'args'` (→ KV414) for such an arg-reachable
 * unscoped owner read. This is fail-closed/by-construction: an owner read that the
 * analyzer cannot prove is session/`owns()`-scoped, but that a client arg can pivot
 * into, is treated as IDOR. A non-arg-reachable unscoped owner read (no `input.*`
 * predicate anywhere, e.g. a literal-keyed or fully-unfiltered list) emits no fact
 * here — it is not the client-pivotable bypass this branch closes.
 */
/** @internal */ export function scopeAuditsFromQueryFacts(
  facts: readonly QueryFact[],
  ownerDomains: Iterable<string | OwnerDomainScope>,
): ScopeAuditFact[] {
  const ownerScopes = ownerDomainScopes(ownerDomains);
  const owners = new Set(ownerScopes.map((owner) => owner.domain));
  const audits: ScopeAuditFact[] = [];

  for (const fact of facts) {
    for (const read of scopeAuditReadProvenance(fact, ownerScopes)) {
      const domain = read.domain;
      if (!owners.has(domain)) continue;

      // SPEC §10.3 / §11.1 KV414: query read-scope enforcement is now a graph
      // operation over canonical read provenance rows. The extraction pass owns
      // source recognition and fail-closed unresolved rows; this gate only checks
      // each owner-domain read's proven scope.
      if (read.scope.kind === 'arg') {
        audits.push({
          domain,
          ...(read.scope.key ? { key: read.scope.key } : {}),
          kind: 'query',
          name: fact.query,
          scope: 'args',
          site: read.site || fact.site,
        });
        continue;
      }

      if (isPrivateQueryReadScope(read.scope) && read.scope.ownerProof) {
        audits.push({
          detail: ownerAuthorizationDataProofDetail(
            ownerScopes,
            domain,
            read.scope.key,
            fact.acceptedGuardPrivateKeys,
          ),
          domain,
          kind: 'query',
          name: fact.query,
          scope: 'session',
          site: read.site || fact.site,
        });
        continue;
      }

      const ownerScope = ownerScopes.find((owner) => owner.domain === domain);
      const privateScoped = isPrivateQueryReadScope(read.scope);
      if (privateScoped && !ownerScope?.owner) {
        audits.push({
          domain,
          kind: 'query',
          name: fact.query,
          scope: 'session',
          site: read.site || fact.site,
        });
        continue;
      }

      if (ownerScope?.owner) {
        audits.push({
          detail: ownerAuthorizationDataDetail(ownerScope, privateScoped),
          domain,
          kind: 'query',
          name: fact.query,
          scope: 'unknown',
          site: read.site || fact.site,
        });
      }
    }
  }

  return dedupeScopeAuditFacts(audits);
}

function scopeAuditReadProvenance(
  fact: QueryFact,
  ownerScopes: readonly OwnerDomainScope[],
): QueryReadProvenance[] {
  const owners = new Set(ownerScopes.map((owner) => owner.domain));
  const provenance = [...(fact.readProvenance ?? [])];
  const provenDomains = new Set(provenance.map((read) => read.domain));

  // Fail closed: scope audits consume only canonical readProvenance rows. An owner
  // domain present in the read set but missing canonical provenance becomes an
  // unresolved unscoped owner read and therefore KV414/unknown in the audit.
  for (const domain of fact.reads) {
    if (!owners.has(domain) || provenDomains.has(domain)) continue;
    provenance.push(unresolvedScopeAuditRead(fact, domain));
  }

  return prioritizedScopeAuditReadProvenance(provenance, owners);
}

function unresolvedScopeAuditRead(fact: QueryFact, domain: string): QueryReadProvenance {
  return {
    columns: [],
    domain,
    keys: null,
    scope: { kind: 'unscoped' },
    site: fact.site,
    source: 'declared',
    via: domain,
  };
}

function prioritizedScopeAuditReadProvenance(
  provenance: readonly QueryReadProvenance[],
  owners: ReadonlySet<string>,
): QueryReadProvenance[] {
  const byDomain = new Map<string, QueryReadProvenance[]>();
  for (const read of provenance) {
    if (!owners.has(read.domain)) continue;
    byDomain.set(read.domain, [...(byDomain.get(read.domain) ?? []), read]);
  }

  const prioritized: QueryReadProvenance[] = [];
  for (const reads of byDomain.values()) {
    const argReads = reads.filter((read) => read.scope.kind === 'arg');
    if (argReads.length > 0) {
      prioritized.push(...dedupeQueryReadProvenanceByScope(argReads));
      continue;
    }

    const ownerProof = reads.find(
      (read) => isPrivateQueryReadScope(read.scope) && read.scope.ownerProof,
    );
    if (ownerProof) {
      prioritized.push(ownerProof);
      continue;
    }

    const privateScope = reads.find((read) => isPrivateQueryReadScope(read.scope));
    const first = reads[0];
    if (first) prioritized.push(privateScope ?? first);
  }

  return prioritized.sort(
    (left, right) =>
      left.domain.localeCompare(right.domain) ||
      (left.scope.kind === right.scope.kind
        ? 0
        : left.scope.kind.localeCompare(right.scope.kind)) ||
      (scopeKey(left.scope) ?? '').localeCompare(scopeKey(right.scope) ?? '') ||
      left.site.localeCompare(right.site),
  );
}

function dedupeQueryReadProvenanceByScope(
  provenance: readonly QueryReadProvenance[],
): QueryReadProvenance[] {
  return [
    ...new Map(
      provenance.map((read) => [
        [read.domain, read.scope.kind, scopeKey(read.scope) ?? '', read.site].join('\0'),
        read,
      ]),
    ).values(),
  ];
}

function isPrivateQueryReadScope(
  scope: QueryReadScopeProvenance,
): scope is Extract<QueryReadScopeProvenance, { key: string }> {
  return scope.kind === 'guard' || scope.kind === 'session' || scope.kind === 'tenant';
}

function privateScopeFromKey(key: string, ownerProof = false): QueryReadScopeProvenance {
  const kind = key.startsWith('guard:')
    ? 'guard'
    : key.startsWith('tenant:')
      ? 'tenant'
      : 'session';
  return ownerProof ? { key, kind, ownerProof: true } : { key, kind };
}

function scopeKey(scope: QueryReadScopeProvenance): string | undefined {
  return 'key' in scope ? scope.key : undefined;
}

function dedupeScopeAuditFacts(audits: readonly ScopeAuditFact[]): ScopeAuditFact[] {
  return [
    ...new Map(
      audits.map((audit) => [
        [
          audit.kind,
          audit.name,
          audit.domain,
          audit.scope,
          audit.key ?? '',
          audit.site ?? '',
          audit.detail ?? '',
        ].join('\0'),
        audit,
      ]),
    ).values(),
  ];
}

function ownerDomainScopes(ownerDomains: Iterable<string | OwnerDomainScope>): OwnerDomainScope[] {
  return [...ownerDomains].map((owner) => {
    if (typeof owner === 'string') return { domain: owner };
    return owner.owner === undefined
      ? { domain: owner.domain }
      : { domain: owner.domain, owner: owner.owner };
  });
}

function ownerAuthorizationDataDetail(
  owner: OwnerDomainScope | undefined,
  sessionScoped: boolean,
): string {
  const ownerColumn = owner?.owner ? `owner=${owner.owner}` : 'owner=<unknown>';
  const reason = sessionScoped
    ? 'session predicate does not compare the owner column to the matching session/principal symbol'
    : 'no owner-column session/principal predicate was proven';
  return `narrow Authorization-gates-DATA subset: ${ownerColumn}; ${reason}`;
}

function ownerAuthorizationDataProofDetail(
  owners: readonly OwnerDomainScope[],
  domain: string,
  privateKey: string,
  acceptedGuardPrivateKeys: readonly string[] = [],
): string {
  const owner = owners.find((candidate) => candidate.domain === domain);
  const ownerColumn = owner?.owner ? `owner=${owner.owner}` : 'owner=<unknown>';
  const guardCoupling =
    privateKey.startsWith('guard:') && acceptedGuardPrivateKeys.includes(privateKey)
      ? '; accepted guard principal matched owner predicate'
      : '';
  return `narrow Authorization-gates-DATA subset: ${ownerColumn}; owner column compared to ${privateKey}${guardCoupling}`;
}

/**
 * A write touch on an owner-annotated domain, with the `args`/`session` domains its
 * `where()` predicate selects (SPEC §10.3, KV414 A1). The write half of the IDOR gate:
 * `scopeAuditsFromQueryFacts` covers reads; this covers `db.update/delete(...)` writes.
 *
 * @internal
 */
/** @internal */ export interface WriteScopeFact {
  /** Private guard principal keys accepted before this write, e.g. `guard:userId`. */
  acceptedGuardPrivateKeys?: readonly string[];
  /** Owner-table domains keyed by a client-visible `input.*` arg (any column) → `args`/IDOR. */
  argScopedWrites: readonly string[];
  /** Exact client-visible keys for `argScopedWrites`, used to scope `owns()` suppression. */
  argScopedWriteKeys?: readonly OwnerScopeKey[];
  /** The mutation/handler name that owns this write (for `owns()` discharge in `kovo check`). */
  name: string;
  /**
   * Narrow OPP-28 Authorization-gates-DATA subset for writes: owner-annotated domains whose
   * owner column is compared against the matching session/principal private symbol through
   * exact equality-equivalent shapes: `eq(...)` or the singleton
   * `inArray(owner, [principal])` subset. Range predicates and negated
   * membership never prove exact `scope: session`.
   */
  ownerScopedSessionWrites?: readonly string[];
  /** Exact private principal symbols for `ownerScopedSessionWrites`, e.g. `guard:userId`. */
  ownerScopedPrivateWriteKeys?: readonly OwnerPrivateScopeKey[];
  /** Owner-table domains this write touches (the audited surface). */
  reads: readonly string[];
  /**
   * The write predicate selects rows through a client-visible `input.*` arg on any
   * table. For owner writes without an owner/principal predicate, this is a
   * client-pivoted IDOR candidate (SPEC §10.3, KV414).
   */
  hasClientArgPredicate?: boolean;
  /** Owner-table domains keyed by `req.session.*` → `session` (safe). */
  sessionAnchoredWrites: readonly string[];
  site: string;
}

/**
 * Scope-audit facts for WRITES against an `owner:`-annotated domain (SPEC §10.3,
 * §11.1; KV414 A1). Parallels `scopeAuditsFromQueryFacts` but emits `kind:'write'`: a
 * write keyed by a client-visible `args.*` is the write-side IDOR candidate the CLI
 * enforces unless an `owns()` guard discharges it; an owner-column `req.session.*`/guard
 * predicate is safe (`session`); a write touching an owner domain without that proof emits
 * `unknown`, matching the read-side fail-closed audit.
 *
 * @internal
 */
/** @internal */ export function scopeAuditsFromWriteFacts(
  facts: readonly WriteScopeFact[],
  ownerDomains: Iterable<string | OwnerDomainScope>,
): ScopeAuditFact[] {
  const ownerScopes = ownerDomainScopes(ownerDomains);
  const owners = new Set(ownerScopes.map((owner) => owner.domain));
  const audits: ScopeAuditFact[] = [];

  for (const fact of facts) {
    for (const domain of fact.reads) {
      if (!owners.has(domain)) continue;

      const ownerSessionScoped = (fact.ownerScopedSessionWrites ?? []).includes(domain);
      if (ownerSessionScoped) {
        const privateKey = (fact.ownerScopedPrivateWriteKeys ?? []).find(
          (scoped) => scoped.domain === domain,
        )?.privateKey;
        audits.push({
          ...(privateKey
            ? {
                detail: ownerAuthorizationDataProofDetail(
                  ownerScopes,
                  domain,
                  privateKey,
                  fact.acceptedGuardPrivateKeys,
                ),
              }
            : {}),
          domain,
          kind: 'write',
          name: fact.name,
          scope: 'session',
          site: fact.site,
        });
        continue;
      }

      // Fail-closed: an arg-keyed owner write is IDOR unless the owner column is
      // already proven to match the current principal.
      const argKeys = new Set(
        (fact.argScopedWriteKeys ?? [])
          .filter((scoped) => scoped.domain === domain)
          .map((scoped) => scoped.key),
      );
      if (argKeys.size === 0 && fact.argScopedWrites.includes(domain)) argKeys.add('');
      if (argKeys.size > 0) {
        for (const key of argKeys) {
          audits.push({
            domain,
            ...(key ? { key } : {}),
            kind: 'write',
            name: fact.name,
            scope: 'args',
            site: fact.site,
          });
        }
        continue;
      }

      const sessionScoped = fact.sessionAnchoredWrites.includes(domain);
      const ownerScope = ownerScopes.find((owner) => owner.domain === domain);
      if (sessionScoped && !ownerScope?.owner) {
        audits.push({ domain, kind: 'write', name: fact.name, scope: 'session', site: fact.site });
        continue;
      }

      // Write-side join/from-keyed bypass: an owner-table update/delete whose
      // predicate is client-pivoted through another table is still an IDOR candidate
      // unless the owner column is scoped to the current principal.
      if (fact.hasClientArgPredicate) {
        audits.push({
          detail: ownerAuthorizationDataDetail(ownerScope, sessionScoped),
          domain,
          kind: 'write',
          name: fact.name,
          scope: 'args',
          site: fact.site,
        });
        continue;
      }

      if (ownerScope?.owner) {
        audits.push({
          detail: ownerAuthorizationDataDetail(ownerScope, sessionScoped),
          domain,
          kind: 'write',
          name: fact.name,
          scope: 'unknown',
          site: fact.site,
        });
      }
    }
  }

  return audits;
}

/**
 * The owner-domain facts (`{ domain, owner }`) derived from `owner:`-annotated
 * Drizzle tables (SPEC §10.1). These tell the CLI audit which domains are
 * principal-owned, so a scope-audit fact for them is enforced as KV414.
 */
function ownerDomainsFromTables(
  tables: Iterable<ExtractedTable>,
): { domain: string; owner: string }[] {
  const byDomain = new Map<string, string>();
  for (const table of tables) {
    if (!table.annotation || !isDomainExtractedTableAnnotation(table.annotation)) continue;
    const owner = table.annotation.owner;
    if (typeof owner === 'string' && !byDomain.has(table.annotation.domain)) {
      byDomain.set(table.annotation.domain, owner);
    }
  }
  return [...byDomain]
    .map(([domain, owner]) => ({ domain, owner }))
    .sort((a, b) => (a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0));
}

function ownerDomainSetFromTables(
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): ReadonlySet<string> {
  return new Set(ownerDomainsFromTables([...tables.values()].flat()).map((owner) => owner.domain));
}

/** @internal */
/** @internal */ export interface SourceFileInput {
  columnShapes?: Readonly<Record<string, QueryShape>>;
  fileName: string;
  source: string;
}

/** @internal */
/** @internal */ export interface TouchGraphProjectOptions {
  compilerOptions?: CompilerOptions;
  files: readonly SourceFileInput[];
}

type ExtractedDomainTableAnnotation = Omit<KovoDomainTableAnnotation, 'domain'> & {
  domain: string;
};

type ExtractedKovoTableAnnotation =
  | (Omit<KovoTableAnnotation, 'domain'> & { domain: string })
  | Extract<KovoTableAnnotation, { exempt: true }>;

function extractedDomainKey(domain: KovoDomainRef): string {
  return typeof domain === 'string' ? domain : domain.key;
}

/** @internal */ export type ExtractedTableAnnotation =
  | (ExtractedKovoTableAnnotation & { name: string })
  | (ExtractedDomainTableAnnotation & {
      name: string;
      relation: 'materialized-view' | 'view';
      refresh?: KovoViewAnnotation['refresh'];
    })
  | {
      name: string;
      unmapped: true;
    };

/** @internal */
/** @internal */ export interface MaterializedViewRefreshFact {
  domain: string;
  mutation: string;
  optimisticStatus: 'await-fragment';
  refresh: 'async';
  site: string;
  view: string;
}

/** @internal */ export interface ExtractedTable {
  annotation: ExtractedTableAnnotation;
  columns: Readonly<Record<string, QueryShape>>;
  exported: boolean;
  foreignKeys?: readonly ExtractedForeignKey[];
}

/** @internal */ export interface ExtractedForeignKey {
  column: string;
  onDelete?: string;
  onUpdate?: string;
  targetTableExpression: string;
}

/** @internal */
/** @internal */ export function diagnosticsForQueryFacts(
  facts: readonly QueryFact[],
): TouchGraphDiagnostic[] {
  return facts.flatMap((fact) => [...(fact.diagnostics ?? [])]);
}

type SqlTextSafety = 'literal' | 'safe' | 'tainted' | 'unknown';

interface SqlSafetyContext {
  /**
   * SQL-specific capabilities (`sql```, `staticSql```, separated parameter carriers) are
   * sink facts, not general value provenance. Request/literal/server flow comes from
   * SymbolProvenance; this map only records values the SQL safety classifier minted.
   */
  sqlBindingsBySymbolKey: Map<string, SqlTextSafety>;
  provenance: SymbolProvenanceContext;
}

/** @internal */
export function analyzeSqlSafetyFromProject(
  options: TouchGraphProjectOptions,
): TouchGraphDiagnostic[] {
  // SPEC §11.1: share one syntactic parse cache across this run's withParsedSourceFile calls.
  return runWithSourceFileParseCache(() => {
    const extraction = createProjectExtraction(options);
    try {
      return analyzeSqlSafetyFromProjectExtraction(extraction);
    } finally {
      extraction.dispose();
    }
  });
}

/** @internal */ export function analyzeSqlSafetyFromProjectExtraction(
  extraction: ProjectExtraction,
): TouchGraphDiagnostic[] {
  return analyzeSqlSafetyFromAnalysisContext(createDrizzleAnalysisContext(extraction));
}

/** @internal */ export function analyzeSqlSafetyFromAnalysisContext(
  context: DrizzleAnalysisContext,
): TouchGraphDiagnostic[] {
  return [...context.facts.sqlSafetyDiagnostics()];
}

function sqlSafetyDiagnosticsForSourceFile(
  file: SourceFileInput,
  sourceFile: SourceFile,
): TouchGraphDiagnostic[] {
  const diagnostics: TouchGraphDiagnostic[] = [];
  const context = sqlSafetyContextForSourceFile(sourceFile);
  const rawDriverImport = endpointRawDriverImportDiagnostic(file, sourceFile);
  if (rawDriverImport) diagnostics.push(rawDriverImport);
  diagnostics.push(...sqliteOwnerScopeWarningDiagnostics(file, sourceFile));
  diagnostics.push(...crossOwnerReadStaticGuardDiagnostics(file, sourceFile));
  // SPEC §10.2 non-goal: KV422 "does not prove safety for driver handles captured before the
  // framework wraps them." A raw driver client constructed in app code (e.g. `const client = new
  // PGlite()`) is such a handle, so its `.exec()`/`.query()` sinks are out of KV422 scope. Managed
  // Kovo handles arrive via context (`req.db`) or `drizzle(...)` — never a `new` expression — so
  // exempting `new`-constructed receivers never masks an injection on a managed handle.
  const rawDriverClients = new Set<string>();

  for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const name = declaration.getNameNode();
    if (!Node.isIdentifier(name)) continue;
    const initializer = declaration.getInitializer();
    if (initializer && Node.isNewExpression(initializer)) {
      rawDriverClients.add(name.getText());
    }
    const safety = sqlTextSafety(initializer, context);
    if (safety !== 'unknown') assignSqlSafetyBinding(name, safety, context);
  }

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const rawHelperDiagnostic = sqlRawHelperDiagnostic(file, call, context);
    if (rawHelperDiagnostic) diagnostics.push(rawHelperDiagnostic);

    const sink = sqlSink(call);
    if (!sink) continue;
    if (sqlSinkReceiverIsRawDriverClient(call, rawDriverClients)) continue;
    if (sqlSinkReceiverIsKovoMutationStream(call)) continue;
    const statement = sink.statementArguments.find(
      (candidate) => sqlTextSafety(candidate, context) !== 'safe',
    );
    if (!statement) continue;
    const safety = sqlTextSafety(statement, context);
    if (safety === 'safe') continue;

    diagnostics.push(
      drizzleDiagnostic({
        code: 'KV422',
        detail: `${sink.name}() receives ${sqlSafetyDescription(safety)} SQL text; use Kovo sql\`...\`, staticSql\`...\`, a separated parameter carrier, or trustedSql(...).`,
        site: `${file.fileName}:${lineForIndex(file.source, call.getStart())}`,
      }),
    );
  }

  return diagnostics;
}

function crossOwnerReadStaticGuardDiagnostics(
  file: SourceFileInput,
  sourceFile: SourceFile,
): TouchGraphDiagnostic[] {
  const diagnostics: TouchGraphDiagnostic[] = [];

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (propertyAccessCallName(call) !== 'crossOwnerRead') continue;
    const surface = owningCrossOwnerReadGuardedSurface(call);
    if (surface && surfaceHasExplicitAdminRoleGuard(surface.body)) continue;

    diagnostics.push(
      drizzleDiagnostic({
        code: 'KV414',
        detail:
          'crossOwnerRead(...) must be statically dominated by an explicit endpoint/query guard: guards.role("admin"). SPEC §10.3 requires a runtime guard marker, but runtime guard marker is necessary, not sufficient, without this static dominance proof.',
        site: `${file.fileName}:${lineForIndex(file.source, call.getStart())}`,
      }),
    );
  }

  return diagnostics;
}

function owningCrossOwnerReadGuardedSurface(
  call: CallExpression,
): { body: ObjectLiteralExpression; kind: 'endpoint' | 'query' } | undefined {
  const sourceFile = call.getSourceFile();
  for (const declaration of sourceFile.getVariableDeclarations()) {
    const initializer = declaration.getInitializer();
    if (!initializer) continue;
    const initializerCall = unwrappedStaticExpressionNode(initializer);
    if (!Node.isCallExpression(initializerCall)) continue;

    const queryDeclaration = staticQueryDeclarationFromCall(declaration, initializerCall);
    if (queryDeclaration) {
      const body = queryBodyObjectLiteral(queryDeclaration.bodyArgument, 'project').body;
      if (body && objectOwnsNode(body, call)) return { body, kind: 'query' };
    }

    if (isKovoServerCalleeExpression(initializerCall.getExpression(), 'endpoint')) {
      const body = endpointBodyObjectFromCall(initializerCall);
      if (body && objectOwnsNode(body, call)) return { body, kind: 'endpoint' };
    }
  }

  return undefined;
}

function endpointBodyObjectFromCall(call: CallExpression): ObjectLiteralExpression | undefined {
  const [firstArgument, secondArgument] = call.getArguments();
  if (secondArgument && Node.isObjectLiteralExpression(secondArgument)) return secondArgument;
  return firstArgument && Node.isObjectLiteralExpression(firstArgument) ? firstArgument : undefined;
}

function objectOwnsNode(object: ObjectLiteralExpression, node: Node): boolean {
  const objectStart = object.getStart();
  const objectEnd = object.getEnd();
  const nodeStart = node.getStart();
  return nodeStart >= objectStart && nodeStart <= objectEnd;
}

function surfaceHasExplicitAdminRoleGuard(body: ObjectLiteralExpression): boolean {
  const property = body.getProperty('guard');
  if (!Node.isPropertyAssignment(property)) return false;
  const initializer = property.getInitializer();
  return initializer ? expressionHasExplicitAdminRoleGuard(initializer) : false;
}

function expressionHasExplicitAdminRoleGuard(expression: Node, depth = 0): boolean {
  if (depth > 4) return false;
  const node = unwrappedStaticExpressionNode(expression);

  if (!Node.isCallExpression(node)) return false;

  const callee = unwrappedStaticExpressionNode(node.getExpression());
  if (isExplicitAdminRoleGuardCall(callee, node.getArguments())) return true;

  if (!isKovoGuardCompositionCall(callee)) return false;
  return node.getArguments().some((argument) => {
    if (Node.isSpreadElement(argument)) return false;
    return expressionHasExplicitAdminRoleGuard(argument, depth + 1);
  });
}

function isExplicitAdminRoleGuardCall(callee: Node, args: readonly Node[]): boolean {
  if (!Node.isPropertyAccessExpression(callee)) return false;
  if (callee.getName() !== 'role') return false;
  const [role] = args;
  return (
    role !== undefined &&
    (Node.isStringLiteral(role) || Node.isNoSubstitutionTemplateLiteral(role)) &&
    role.getLiteralText() === 'admin' &&
    expressionResolvesToKovoServerGuards(unwrappedStaticExpressionNode(callee.getExpression()))
  );
}

function isKovoGuardCompositionCall(expression: Node): boolean {
  if (!Node.isPropertyAccessExpression(expression)) return false;
  const name = expression.getName();
  if (name !== 'all' && name !== 'compose') return false;
  return expressionResolvesToKovoServerGuards(
    unwrappedStaticExpressionNode(expression.getExpression()),
  );
}

function expressionResolvesToKovoServerGuards(expression: Node): boolean {
  if (
    expressionResolvesToFrameworkExport(expression, frameworkExport('@kovojs/server', 'guards'), {
      legacyGlobals: [frameworkExport('@kovojs/server', 'guards')],
    })
  ) {
    return true;
  }

  if (!Node.isIdentifier(expression)) return false;
  const localName = expression.getText();
  const declarations = expression.getSymbol()?.getDeclarations() ?? [];
  if (declarations.length === 0) return localName === 'guards';
  return declarations.some((declaration) => {
    if (!Node.isImportSpecifier(declaration)) return false;
    if (declaration.getName() !== 'guards') return false;
    if ((declaration.getAliasNode()?.getText() ?? declaration.getName()) !== localName) {
      return false;
    }
    return declaration.getImportDeclaration().getModuleSpecifierValue() === '@kovojs/server';
  });
}

function mutationSecretWireDiagnosticsForSourceFile(
  file: SourceFileInput,
  sourceFile: SourceFile,
  columnShapes: Readonly<Record<string, QueryShape>>,
): TouchGraphDiagnostic[] {
  const secretColumnPaths = new Set(
    Object.entries(columnShapes)
      .filter(([, shape]) => queryShapeContainsSecret(shape))
      .map(([path]) => path),
  );
  if (secretColumnPaths.size === 0) return [];

  const diagnostics: TouchGraphDiagnostic[] = [];
  for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const initializer = declaration.getInitializer();
    if (!initializer) continue;

    const mutationCall = unwrappedStaticExpressionNode(initializer);
    if (!Node.isCallExpression(mutationCall)) continue;

    const mutation = staticMutationDeclarationFromCall(declaration, mutationCall);
    if (!mutation) continue;

    const body = queryBodyObjectLiteral(mutation.bodyArgument, 'project').body;
    if (!body) continue;

    for (const handler of mutationHandlerCallbackBodies(body)) {
      const diagnostic = mutationHandlerSecretReturnDiagnostic(
        file,
        mutation.key,
        handler,
        secretColumnPaths,
      );
      if (diagnostic) diagnostics.push(diagnostic);
    }
  }

  return dedupeDiagnostics(diagnostics);
}

function mutationHandlerCallbackBodies(body: ObjectLiteralExpression): Node[] {
  return body.getProperties().flatMap((property) => {
    if (
      Node.isMethodDeclaration(property) &&
      propertyNameText(property.getNameNode()) === 'handler'
    ) {
      return property.getBody() ? [property.getBodyOrThrow()] : [];
    }

    if (
      !Node.isPropertyAssignment(property) ||
      propertyNameText(property.getNameNode()) !== 'handler'
    ) {
      return [];
    }

    const initializer = property.getInitializer();
    if (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer)) return [];
    return [functionBody(initializer)];
  });
}

function mutationHandlerSecretReturnDiagnostic(
  file: SourceFileInput,
  mutationKey: string,
  body: Node,
  secretColumnPaths: ReadonlySet<string>,
): TouchGraphDiagnostic | null {
  const returnExpressions = mutationReturnExpressions(body);
  if (returnExpressions.length === 0) return null;

  const tainted = new Set<string>();
  let firstSecretSite: string | undefined;
  let changed = true;

  while (changed) {
    changed = false;
    for (const declaration of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      if (!mutationTopLevelDescendant(body, declaration)) continue;
      const initializer = declaration.getInitializer();
      if (!initializer) continue;
      const secretSite = firstSecretColumnSite(file, initializer, secretColumnPaths);
      if (secretSite && !firstSecretSite) firstSecretSite = secretSite;
      if (!secretSite && !expressionContainsAnyMutationKey(initializer, tainted)) continue;

      const name = declaration.getNameNode();
      if (!Node.isIdentifier(name)) return mutationSecretReturnDiagnostic(file, mutationKey, body);
      const key = sqlSafetySymbolKey(name);
      if (key && !tainted.has(key)) {
        tainted.add(key);
        changed = true;
      }
    }
  }

  for (const expression of returnExpressions) {
    const directSecretSite = firstSecretColumnSite(file, expression, secretColumnPaths);
    if (directSecretSite) {
      return mutationSecretReturnDiagnostic(file, mutationKey, expression, directSecretSite);
    }
    if (expressionContainsAnyMutationKey(expression, tainted)) {
      return mutationSecretReturnDiagnostic(file, mutationKey, expression, firstSecretSite);
    }
  }

  return null;
}

function mutationReturnExpressions(body: Node): Node[] {
  if (!Node.isBlock(body)) return [body];
  return body
    .getDescendantsOfKind(SyntaxKind.ReturnStatement)
    .filter((statement) => mutationTopLevelDescendant(body, statement))
    .flatMap((statement) => {
      const expression = statement.getExpression();
      return expression ? [expression] : [];
    });
}

function firstSecretColumnSite(
  file: SourceFileInput,
  node: Node,
  secretColumnPaths: ReadonlySet<string>,
): string | undefined {
  for (const expression of [node, ...node.getDescendants()]) {
    const access = staticAccessSegments(expression);
    if (!access || access.path.length === 0) continue;
    const path = [access.root.getText(), ...access.path].join('.');
    if (secretColumnPaths.has(path) && !isInsideTrustedRevealCall(expression)) {
      return `${file.fileName}:${lineForIndex(file.source, expression.getStart())}`;
    }
  }
  return undefined;
}

function isInsideTrustedRevealCall(node: Node): boolean {
  for (const ancestor of node.getAncestors()) {
    if (!Node.isCallExpression(ancestor)) continue;
    if (
      expressionResolvesToFrameworkExport(
        ancestor.getExpression(),
        frameworkExport('@kovojs/core', 'trustedReveal'),
      )
    ) {
      return true;
    }
  }
  return false;
}

function expressionContainsAnyMutationKey(expression: Node, keys: ReadonlySet<string>): boolean {
  for (const node of [expression, ...expression.getDescendants()]) {
    if (!Node.isIdentifier(node)) continue;
    const key = sqlSafetySymbolKey(node);
    if (key && keys.has(key)) return true;
  }
  return false;
}

function mutationTopLevelDescendant(body: Node, candidate: Node): boolean {
  let current = candidate.getParent();
  while (current && current !== body) {
    if (
      Node.isArrowFunction(current) ||
      Node.isFunctionDeclaration(current) ||
      Node.isFunctionExpression(current) ||
      Node.isMethodDeclaration(current)
    ) {
      return false;
    }
    current = current.getParent();
  }
  return current === body;
}

function mutationSecretReturnDiagnostic(
  file: SourceFileInput,
  mutationKey: string,
  siteNode: Node,
  site?: string,
): TouchGraphDiagnostic {
  return drizzleDiagnostic({
    code: 'KV435',
    detail: `Mutation handler result ${mutationKey} reads a secret-classified column before the mutation response is redirected or streamed to the wire. Prove the read stays off the mutation wire, select explicit non-secret columns, or wrap a reviewed projection in trustedReveal(...).`,
    site: site ?? `${file.fileName}:${lineForIndex(file.source, siteNode.getStart())}`,
  });
}

const ENDPOINT_RAW_DRIVER_MODULES = new Set([
  '@electric-sql/pglite',
  'better-sqlite3',
  'drizzle-orm/better-sqlite3',
  'drizzle-orm/pglite',
]);

function endpointRawDriverImportDiagnostic(
  file: SourceFileInput,
  sourceFile: SourceFile,
): TouchGraphDiagnostic | undefined {
  if (!isRequestAuthoredIngressModule(file, sourceFile)) {
    return undefined;
  }

  const runtimeDbImport = sourceFile
    .getImportDeclarations()
    .find((candidate) => isRuntimeDbModuleSpecifier(candidate.getModuleSpecifierValue()));
  if (
    runtimeDbImport !== undefined &&
    runtimeDbImportHasValueBindings(runtimeDbImport) &&
    (isRequestAuthoredIngressFileName(file.fileName) ||
      runtimeDbValueBindingIsReferencedFromRequestSurface(sourceFile))
  ) {
    return drizzleDiagnostic({
      code: 'KV414',
      detail:
        'Request-authored endpoint/webhook/task/query/mutation modules must not import value symbols from src/_kovo/app-runtime-db; use framework lifecycle DB capabilities so Postgres role/RLS/column privileges remain the sole authorization/confidentiality door. This lint is defense-in-depth; runtime least-privilege/capabilities remain the boundary (SPEC §10.3 DEC-B1/C5).',
      site: `${file.fileName}:${lineForIndex(file.source, runtimeDbImport.getStart())}`,
    });
  }

  const runtimeDbProviderAliasImport = runtimeDbProviderAliasImportDiagnostic(file, sourceFile);
  if (runtimeDbProviderAliasImport !== undefined) return runtimeDbProviderAliasImport;

  const unconfinedRuntimeDbCall = sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((call) => isUnconfinedAppRuntimeDbProviderCall(call, sourceFile));
  if (unconfinedRuntimeDbCall !== undefined) {
    return drizzleDiagnostic({
      code: 'KV414',
      detail:
        'Request-authored endpoint/webhook/task/query/mutation modules must not call appRuntimeDbProvider() without a lifecycle request; the undefined path returns the internal framework DB and bypasses the Postgres authorization/confidentiality engine choke. This lint is defense-in-depth; runtime least-privilege/capabilities remain the boundary (SPEC §10.3 DEC-B1/C5).',
      site: `${file.fileName}:${lineForIndex(file.source, unconfinedRuntimeDbCall.getStart())}`,
    });
  }

  const declaration = endpointRawDriverModuleReference(sourceFile);
  if (declaration === undefined) return undefined;
  return drizzleDiagnostic({
    code: 'KV414',
    detail:
      'endpoint() code must use endpoint({ db: true }) + ctx.actAs(id) managed DB capabilities; raw driver imports/import()/require() bypass the endpoint authorization choke. This lint is defense-in-depth; runtime least-privilege/capabilities remain the boundary (SPEC §10.3 DEC-H/C5).',
    site: `${file.fileName}:${lineForIndex(file.source, declaration.getStart())}`,
  });
}

function sqliteOwnerScopeWarningDiagnostics(
  file: SourceFileInput,
  sourceFile: SourceFile,
): TouchGraphDiagnostic[] {
  const diagnostics: { diagnostic: TouchGraphDiagnostic; index: number }[] = [];

  for (const declaration of sourceFile.getVariableDeclarations()) {
    const initializer = declaration.getInitializer();
    if (!initializer || !Node.isCallExpression(initializer)) continue;
    const rootCall = rootCallExpression(initializer);
    if (!isSqliteTableFactoryCall(rootCall)) continue;
    const annotation = tableAnnotation(rootCall);
    if (!annotation || !isDomainExtractedTableAnnotation(annotation)) continue;
    const classification =
      annotation.ownerVia !== undefined
        ? 'ownerVia'
        : annotation.owner !== undefined
          ? 'owner'
          : null;
    if (!classification) continue;

    const line = lineForIndex(file.source, rootCall.getStart());
    const detail = [
      `Table ${annotation.name} declares ${classification} scoping;`,
      'SQLite keeps the static metadata but has no engine role/RLS layer,',
      'so this starter is single-principal only. Use PGlite/Postgres for',
      "Kovo's multi-tenant authorization guarantees (SPEC §10.3 DEC-A).",
    ].join(' ');
    diagnostics.push({
      diagnostic: drizzleDiagnostic({
        code: 'KV447',
        detail,
        site: `${file.fileName}:${line}`,
      }),
      index: line,
    });
  }

  return diagnostics
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.diagnostic);
}

function isSqliteTableFactoryCall(call: CallExpression): boolean {
  const expression = unwrappedStaticExpressionNode(call.getExpression());
  const factoryName = Node.isIdentifier(expression)
    ? (projectDrizzleCoreIdentifierExportName(expression) ?? expression.getText())
    : Node.isPropertyAccessExpression(expression) &&
        isDrizzleTableFactoryNamespaceMember(expression)
      ? expression.getName()
      : undefined;
  return factoryName === 'sqliteTable';
}

function isRequestAuthoredIngressModule(file: SourceFileInput, sourceFile: SourceFile): boolean {
  if (/(?:^|\/)(?:src\/)?_kovo\/app-runtime-db(?:\.sqlite)?\.ts$/.test(file.fileName)) {
    return false;
  }
  if (isRequestAuthoredIngressFileName(file.fileName)) {
    return true;
  }
  const requestSurfaceExports = ['endpoint', 'mutation', 'query', 'task', 'webhook'];
  return sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .some((call) =>
      requestSurfaceExports.some((name) =>
        isKovoServerCalleeExpression(call.getExpression(), name),
      ),
    );
}

function isRequestAuthoredIngressFileName(fileName: string): boolean {
  return /\.(?:endpoint|endpoints|webhook|webhooks|task|tasks|query|queries|mutation|mutations)\.[cm]?[jt]sx?$/u.test(
    fileName,
  );
}

function isRuntimeDbModuleSpecifier(moduleSpecifier: string): boolean {
  const normalized = moduleSpecifier.replace(/\\/gu, '/').replace(/\.(?:mjs|cjs|js)$/u, '');
  return /(?:^|\/)(?:src\/)?_kovo\/app-runtime-db(?:\.sqlite)?$/u.test(normalized);
}

function runtimeDbImportHasValueBindings(declaration: ImportDeclaration): boolean {
  if (declaration.isTypeOnly()) return false;
  const importClause = declaration.getImportClause();
  if (importClause === undefined) return false;
  if (importClause.getDefaultImport() !== undefined) return true;
  if (importClause.getNamespaceImport() !== undefined) return true;
  return declaration.getNamedImports().some((specifier) => !specifier.isTypeOnly());
}

function runtimeDbValueBindingIsReferencedFromRequestSurface(sourceFile: SourceFile): boolean {
  const localNames = runtimeDbValueImportLocalNames(sourceFile);
  if (localNames.size === 0) return false;

  const requestSurfaceExports = ['endpoint', 'mutation', 'query', 'task', 'webhook'];
  return sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .some(
      (call) =>
        requestSurfaceExports.some((name) =>
          isKovoServerCalleeExpression(call.getExpression(), name),
        ) && nodeContainsRuntimeDbValueBinding(call, localNames),
    );
}

function runtimeDbProviderAliasImportDiagnostic(
  file: SourceFileInput,
  sourceFile: SourceFile,
): TouchGraphDiagnostic | undefined {
  const importSpecifier = sourceFile.getImportDeclarations().find((declaration) => {
    if (declaration.isTypeOnly()) return false;
    if (
      !isRequestAuthoredIngressFileName(file.fileName) &&
      !nodeContainsRuntimeDbValueBinding(
        requestSurfaceCallExpression(sourceFile) ?? sourceFile,
        runtimeDbProviderImportLocalNames(sourceFile),
      )
    ) {
      return false;
    }
    return declaration
      .getNamedImports()
      .some(
        (specifier) =>
          !specifier.isTypeOnly() && importSpecifierResolvesToRuntimeDbProvider(specifier),
      );
  });
  if (importSpecifier === undefined) return undefined;

  return drizzleDiagnostic({
    code: 'KV414',
    detail:
      'Request-authored endpoint/webhook/task/query/mutation modules must not import runtime DB provider aliases into request surfaces; use framework lifecycle DB capabilities so Postgres role/RLS/column privileges remain the sole authorization/confidentiality door. This lint is defense-in-depth; runtime least-privilege/capabilities remain the boundary (SPEC §10.3 DEC-B1/C5).',
    site: `${file.fileName}:${lineForIndex(file.source, importSpecifier.getStart())}`,
  });
}

function runtimeDbValueImportLocalNames(sourceFile: SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  for (const declaration of sourceFile.getImportDeclarations()) {
    if (!isRuntimeDbModuleSpecifier(declaration.getModuleSpecifierValue())) continue;
    if (declaration.isTypeOnly()) continue;

    const importClause = declaration.getImportClause();
    const defaultImport = importClause?.getDefaultImport();
    const namespaceImport = importClause?.getNamespaceImport();
    if (defaultImport) names.add(defaultImport.getText());
    if (namespaceImport) names.add(namespaceImport.getText());

    for (const specifier of declaration.getNamedImports()) {
      if (specifier.isTypeOnly()) continue;
      names.add(specifier.getAliasNode()?.getText() ?? specifier.getName());
    }
  }
  return names;
}

function nodeContainsRuntimeDbValueBinding(node: Node, localNames: ReadonlySet<string>): boolean {
  for (const descendant of [node, ...node.getDescendants()]) {
    if (!Node.isIdentifier(descendant)) continue;
    if (localNames.has(descendant.getText())) return true;
  }
  return false;
}

function isUnconfinedAppRuntimeDbProviderCall(
  call: CallExpression,
  sourceFile: SourceFile,
): boolean {
  if (!isUndefinedOrEmptyArguments(call)) return false;

  const expression = unwrappedStaticExpressionNode(call.getExpression());
  if (expressionResolvesToRuntimeDbProvider(expression)) {
    return true;
  }
  if (Node.isIdentifier(expression) && expression.getText() === 'appRuntimeDbProvider') {
    return true;
  }
  if (
    Node.isPropertyAccessExpression(expression) &&
    expression.getName() === 'appRuntimeDbProvider'
  ) {
    return true;
  }

  return runtimeDbProviderImportLocalNames(sourceFile).has(expression.getText());
}

function isUndefinedOrEmptyArguments(call: CallExpression): boolean {
  const args = call.getArguments();
  if (args.length === 0) return true;
  return args.length === 1 && Node.isIdentifier(args[0]) && args[0].getText() === 'undefined';
}

function runtimeDbProviderImportLocalNames(sourceFile: SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  for (const declaration of sourceFile.getImportDeclarations()) {
    for (const specifier of declaration.getNamedImports()) {
      if (!importSpecifierResolvesToRuntimeDbProvider(specifier)) {
        continue;
      }
      names.add(specifier.getAliasNode()?.getText() ?? specifier.getName());
    }
    const namespaceImport = declaration.getImportClause()?.getNamespaceImport();
    if (
      namespaceImport &&
      namespaceImportResolvesToRuntimeDbProvider(
        namespaceImport,
        declaration.getModuleSpecifierSourceFile(),
      )
    ) {
      names.add(`${namespaceImport.getText()}.appRuntimeDbProvider`);
    }
  }
  return names;
}

function importSpecifierResolvesToRuntimeDbProvider(specifier: Node): boolean {
  if (!Node.isImportSpecifier(specifier)) return false;
  const importDeclaration = specifier.getImportDeclaration();
  if (
    isRuntimeDbModuleSpecifier(importDeclaration.getModuleSpecifierValue()) &&
    specifier.getName() === 'appRuntimeDbProvider'
  ) {
    return true;
  }
  const moduleSourceFile = importDeclaration.getModuleSpecifierSourceFile();
  return moduleSourceFile
    ? sourceFileExportResolvesToRuntimeDbProvider(
        moduleSourceFile,
        specifier.getName(),
        new Set(),
        0,
      )
    : false;
}

function requestSurfaceCallExpression(sourceFile: SourceFile): CallExpression | undefined {
  const requestSurfaceExports = ['endpoint', 'mutation', 'query', 'task', 'webhook'];
  return sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((call) =>
      requestSurfaceExports.some((name) =>
        isKovoServerCalleeExpression(call.getExpression(), name),
      ),
    );
}

function endpointRawDriverModuleReference(sourceFile: SourceFile): Node | undefined {
  const importDeclaration = sourceFile
    .getImportDeclarations()
    .find((candidate) => ENDPOINT_RAW_DRIVER_MODULES.has(candidate.getModuleSpecifierValue()));
  if (importDeclaration) return importDeclaration;

  return sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).find((call) => {
    const moduleSpecifier = rawDriverModuleSpecifierFromCall(call);
    return moduleSpecifier !== undefined && ENDPOINT_RAW_DRIVER_MODULES.has(moduleSpecifier);
  });
}

function rawDriverModuleSpecifierFromCall(call: CallExpression): string | undefined {
  const [firstArgument] = call.getArguments();
  const moduleSpecifier = staticStringLiteralText(firstArgument);
  if (moduleSpecifier === undefined) return undefined;

  const expression = unwrappedStaticExpressionNode(call.getExpression());
  if (expression.getKind() === SyntaxKind.ImportKeyword) return moduleSpecifier;
  if (!Node.isIdentifier(expression) || expression.getText() !== 'require') return undefined;
  const symbol = symbolForIdentifierReference(expression) ?? expression.getSymbol();
  const declarations = symbol?.getDeclarations() ?? [];
  if (declarations.some((declaration) => !declaration.getSourceFile().isDeclarationFile())) {
    return undefined;
  }
  return moduleSpecifier;
}

function staticStringLiteralText(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }
  return undefined;
}

function expressionResolvesToRuntimeDbProvider(expression: Node): boolean {
  if (Node.isIdentifier(expression)) {
    return symbolResolvesToRuntimeDbProvider(symbolForIdentifierReference(expression));
  }
  if (Node.isPropertyAccessExpression(expression)) {
    return symbolResolvesToRuntimeDbProvider(expression.getNameNode().getSymbol());
  }
  return symbolResolvesToRuntimeDbProvider(expression.getSymbol());
}

function symbolResolvesToRuntimeDbProvider(
  symbol: MorphSymbol | undefined,
  seen: Set<string> = new Set(),
  depth = 0,
): boolean {
  if (!symbol || depth > 12) return false;
  const key = resolvedSymbolKey(symbol) ?? symbol.getFullyQualifiedName();
  if (key && seen.has(key)) return false;
  if (key) seen.add(key);

  let aliased: MorphSymbol | undefined;
  try {
    aliased = symbol.getAliasedSymbol();
  } catch {
    aliased = undefined;
  }
  if (
    aliased &&
    aliased !== symbol &&
    symbolResolvesToRuntimeDbProvider(aliased, seen, depth + 1)
  ) {
    return true;
  }

  return symbol
    .getDeclarations()
    .some((declaration) => declarationResolvesToRuntimeDbProvider(declaration, seen, depth + 1));
}

function declarationResolvesToRuntimeDbProvider(
  declaration: Node,
  seen: Set<string>,
  depth: number,
): boolean {
  if (depth > 12) return false;

  if (Node.isImportSpecifier(declaration)) {
    const imported = declaration.getName();
    const importDeclaration = declaration.getImportDeclaration();
    if (
      isRuntimeDbModuleSpecifier(importDeclaration.getModuleSpecifierValue()) &&
      imported === 'appRuntimeDbProvider'
    ) {
      return true;
    }
    const moduleSourceFile = importDeclaration.getModuleSpecifierSourceFile();
    return moduleSourceFile
      ? sourceFileExportResolvesToRuntimeDbProvider(moduleSourceFile, imported, seen, depth + 1)
      : false;
  }

  if (Node.isExportSpecifier(declaration)) {
    const exportDeclaration = declaration.getFirstAncestorByKind(SyntaxKind.ExportDeclaration);
    const imported = declaration.getName();
    if (
      exportDeclaration &&
      isRuntimeDbModuleSpecifier(exportDeclaration.getModuleSpecifierValue() ?? '') &&
      imported === 'appRuntimeDbProvider'
    ) {
      return true;
    }
    const moduleSourceFile = exportDeclaration?.getModuleSpecifierSourceFile();
    if (moduleSourceFile) {
      return sourceFileExportResolvesToRuntimeDbProvider(
        moduleSourceFile,
        imported,
        seen,
        depth + 1,
      );
    }
    return sourceFileLocalResolvesToRuntimeDbProvider(
      declaration.getSourceFile(),
      imported,
      seen,
      depth + 1,
    );
  }

  if (Node.isVariableDeclaration(declaration)) {
    const initializer = declaration.getInitializer();
    return initializer ? expressionResolvesToRuntimeDbProvider(initializer) : false;
  }

  return false;
}

function sourceFileExportResolvesToRuntimeDbProvider(
  sourceFile: SourceFile,
  exportedName: string,
  seen: Set<string>,
  depth: number,
): boolean {
  if (depth > 12) return false;
  const key = `${sourceFile.getFilePath()}:${exportedName}`;
  if (seen.has(key)) return false;
  seen.add(key);

  for (const declaration of sourceFile.getExportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    const moduleSourceFile = declaration.getModuleSpecifierSourceFile();
    const namedExports = declaration.getNamedExports();

    if (namedExports.length === 0) {
      if (
        moduleSourceFile &&
        sourceFileExportResolvesToRuntimeDbProvider(moduleSourceFile, exportedName, seen, depth + 1)
      ) {
        return true;
      }
      continue;
    }

    for (const named of namedExports) {
      const exported = named.getAliasNode()?.getText() ?? named.getName();
      if (exported !== exportedName) continue;
      if (specifier) {
        if (isRuntimeDbModuleSpecifier(specifier) && named.getName() === 'appRuntimeDbProvider') {
          return true;
        }
        if (
          moduleSourceFile &&
          sourceFileExportResolvesToRuntimeDbProvider(
            moduleSourceFile,
            named.getName(),
            seen,
            depth + 1,
          )
        ) {
          return true;
        }
        continue;
      }

      if (
        sourceFileLocalResolvesToRuntimeDbProvider(sourceFile, named.getName(), seen, depth + 1)
      ) {
        return true;
      }
    }
  }

  return sourceFileLocalResolvesToRuntimeDbProvider(sourceFile, exportedName, seen, depth + 1);
}

function sourceFileLocalResolvesToRuntimeDbProvider(
  sourceFile: SourceFile,
  localName: string,
  seen: Set<string>,
  depth: number,
): boolean {
  if (depth > 12) return false;

  for (const declaration of sourceFile.getImportDeclarations()) {
    for (const specifier of declaration.getNamedImports()) {
      const boundName = specifier.getAliasNode()?.getText() ?? specifier.getName();
      if (boundName !== localName) continue;
      if (
        symbolResolvesToRuntimeDbProvider(
          symbolForIdentifierReference(specifier.getNameNode()),
          seen,
          depth + 1,
        )
      ) {
        return true;
      }
    }
  }

  for (const declaration of sourceFile.getVariableDeclarations()) {
    if (declaration.getName() !== localName) continue;
    const initializer = declaration.getInitializer();
    if (initializer && expressionResolvesToRuntimeDbProvider(initializer)) {
      return true;
    }
  }

  return false;
}

function namespaceImportResolvesToRuntimeDbProvider(
  namespaceImport: Node,
  sourceFile: SourceFile | undefined,
): boolean {
  if (!sourceFile) return false;
  return sourceFileExportResolvesToRuntimeDbProvider(
    sourceFile,
    'appRuntimeDbProvider',
    new Set([namespaceImport.getText()]),
    0,
  );
}

function sqlRawHelperDiagnostic(
  file: SourceFileInput,
  call: CallExpression,
  context: SqlSafetyContext,
): TouchGraphDiagnostic | null {
  const expression = call.getExpression();
  if (!Node.isPropertyAccessExpression(expression)) return null;
  const receiver = expression.getExpression();

  const method = expression.getName();
  if (method !== 'raw' && method !== 'identifier') return null;
  const [first, second] = call.getArguments();
  if (expressionResolvesToFrameworkExport(receiver, frameworkExport('drizzle-orm', 'sql'))) {
    return drizzleDiagnostic({
      code: 'KV422',
      detail: `Direct drizzle-orm sql.${method}(...) is not accepted in app code; import Kovo's sql from @kovojs/drizzle so raw chunks and identifiers are auditable.`,
      site: `${file.fileName}:${lineForIndex(file.source, call.getStart())}`,
    });
  }

  // SPEC §10.2/§6.6 (KV422): recognize Kovo's raw-SQL helper through its resolved
  // `@kovojs/drizzle` binding — bare `sql`, an `import { sql as s }` alias, or a
  // namespace `<ns>.sql` accessor — so `s.raw(...)` / `k.sql.raw(...)` cannot slip a
  // raw chunk past the gate the way a literal `receiver === 'sql'` check did.
  if (
    !expressionResolvesToFrameworkExport(receiver, frameworkExport('@kovojs/drizzle', 'sql'), {
      legacyGlobals: [frameworkExport('@kovojs/drizzle', 'sql')],
    })
  ) {
    return null;
  }
  if (method === 'identifier' && sqlAllowlistSafety(second, context) === 'literal') return null;

  const safety = sqlTextSafety(first, context);
  if (safety === 'literal') return null;

  return drizzleDiagnostic({
    code: 'KV422',
    detail: `sql.${method}(...) receives ${sqlSafetyDescription(safety)} text; use sql.identifier(value, { allow }) for identifiers or trustedSql(...) for audited raw SQL.`,
    site: `${file.fileName}:${lineForIndex(file.source, call.getStart())}`,
  });
}

function isKovoSqlTagExpression(tag: Node): boolean {
  return (
    expressionResolvesToFrameworkExport(tag, frameworkExport('@kovojs/drizzle', 'sql'), {
      legacyGlobals: [frameworkExport('@kovojs/drizzle', 'sql')],
    }) ||
    expressionResolvesToFrameworkExport(tag, frameworkExport('@kovojs/drizzle', 'staticSql'), {
      legacyGlobals: [frameworkExport('@kovojs/drizzle', 'staticSql')],
    })
  );
}

/** @internal */
export function isKovoDrizzleTrustedSqlCall(expression: CallExpression): boolean {
  return isKovoDrizzleTrustedSqlCallee(expression.getExpression());
}

function isKovoDrizzleTrustedSqlCallee(callee: Node): boolean {
  return expressionResolvesToFrameworkExport(
    callee,
    frameworkExport('@kovojs/drizzle', 'trustedSql'),
  );
}

/**
 * SPEC §6.6/§10.2/§11.1 (KV435/KV414/KV410/KV406/KV438): does `expression` name the `@kovojs/server`
 * export `exportName` (e.g. `query`/`domain`/`write`) as a call callee? The shared resolver follows
 * import aliases, namespace imports, re-exports, local const aliases, and object destructuring. The
 * bare-name fallback exists only for unresolved legacy fixture globals; a local declaration named
 * `query`/`domain`/`write` is not treated as Kovo.
 *
 * @internal
 */
export function isKovoServerCalleeExpression(expression: Node, exportName: string): boolean {
  return expressionResolvesToFrameworkExport(
    expression,
    frameworkExport('@kovojs/server', exportName),
    { legacyGlobals: [frameworkExport('@kovojs/server', exportName)] },
  );
}

interface StaticQueryDeclaration {
  bodyArgument: Node | undefined;
  query: string;
}

interface StaticMutationDeclaration {
  bodyArgument: Node | undefined;
  key: string;
}

/**
 * @internal Resolve a `query(...)` declaration to its public registry key and body object argument.
 *
 * SPEC.md §4.1/§10.2: exported object-form query declarations (`export const foo = query({ ... })`)
 * are source-derived from module path + export binding, matching the compiler's runtime lowering.
 * String-keyed declarations keep their explicit external vocabulary.
 */
export function staticQueryDeclarationFromCall(
  declaration: VariableDeclaration,
  queryCall: CallExpression,
): StaticQueryDeclaration | null {
  const expression = queryCall.getExpression();
  const isQueryCall = isKovoServerCalleeExpression(expression, 'query');
  // Legacy `.elevated` query calls are still parsed here so KV433 can fail closed instead of
  // letting a demoted GET-write spelling disappear from the static graph.
  const isElevatedQueryCall =
    Node.isPropertyAccessExpression(expression) &&
    expression.getName() === 'elevated' &&
    isKovoServerCalleeExpression(expression.getExpression(), 'query');
  if (!isQueryCall && !isElevatedQueryCall) {
    return staticQueryDeclarationFromWrapperCall(declaration, queryCall);
  }

  const [firstArgument, secondArgument] = queryCall.getArguments();
  return staticQueryDeclarationFromArguments(declaration, firstArgument, secondArgument);
}

function staticQueryDeclarationFromArguments(
  declaration: VariableDeclaration,
  firstArgument: Node | undefined,
  secondArgument: Node | undefined,
): StaticQueryDeclaration | null {
  if (
    firstArgument &&
    (Node.isStringLiteral(firstArgument) || Node.isNoSubstitutionTemplateLiteral(firstArgument))
  ) {
    return { bodyArgument: secondArgument, query: firstArgument.getLiteralText() };
  }
  if (firstArgument && Node.isObjectLiteralExpression(firstArgument)) {
    const query = sourceDerivedQueryKey(declaration);
    return query ? { bodyArgument: firstArgument, query } : null;
  }
  return null;
}

function staticQueryDeclarationFromWrapperCall(
  declaration: VariableDeclaration,
  wrapperCall: CallExpression,
): StaticQueryDeclaration | null {
  const target = simpleKovoQueryWrapperTarget(wrapperCall.getExpression());
  if (!target) return null;

  const wrapperArgs = wrapperCall.getArguments();
  const forwardedArgs = target.queryCall
    .getArguments()
    .map((argument) => substituteWrapperParameter(argument, target.parameters, wrapperArgs));
  return staticQueryDeclarationFromArguments(declaration, forwardedArgs[0], forwardedArgs[1]);
}

function simpleKovoQueryWrapperTarget(
  callee: Node,
): { parameters: readonly ParameterDeclaration[]; queryCall: CallExpression } | null {
  const target = unwrappedStaticExpressionNode(callee);
  if (!Node.isIdentifier(target)) return null;

  const declaration = target.getSymbol()?.getDeclarations()[0];
  if (!declaration) return null;

  const initializer = Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : null;
  const functionLike = initializer
    ? unwrappedFunctionExpression(initializer)
    : Node.isFunctionDeclaration(declaration)
      ? declaration
      : null;
  if (!functionLike) return null;

  const returned = singleReturnedExpression(functionLike);
  const queryCall = returned ? unwrappedStaticExpressionNode(returned) : undefined;
  if (!queryCall || !Node.isCallExpression(queryCall)) return null;

  return isKovoServerCalleeExpression(queryCall.getExpression(), 'query')
    ? { parameters: functionLike.getParameters(), queryCall }
    : null;
}

function singleReturnedExpression(
  functionLike: ArrowFunction | FunctionDeclaration | FunctionExpression,
): Node | null {
  const body = functionLike.getBody();
  if (!body) return null;
  if (!Node.isBlock(body)) return body;

  const statements = body.getStatements();
  if (statements.length !== 1) return null;
  const statement = statements[0];
  return statement && Node.isReturnStatement(statement)
    ? (statement.getExpression() ?? null)
    : null;
}

function substituteWrapperParameter(
  argument: Node,
  parameters: readonly ParameterDeclaration[],
  wrapperArgs: readonly Node[],
): Node {
  const unwrapped = unwrappedStaticExpressionNode(argument);
  const identifier = Node.isIdentifier(unwrapped)
    ? unwrapped
    : Node.isAsExpression(unwrapped)
      ? unwrappedStaticExpressionNode(unwrapped.getExpression())
      : undefined;
  if (!identifier || !Node.isIdentifier(identifier)) return argument;

  const parameterIndex = parameters.findIndex((parameter) => {
    const name = parameter.getNameNode();
    return Node.isIdentifier(name) && name.getText() === identifier.getText();
  });
  return parameterIndex >= 0 ? (wrapperArgs[parameterIndex] ?? argument) : argument;
}

/**
 * @internal Resolve a `mutation(...)` declaration to its public registry key and body object argument.
 *
 * SPEC.md §4.1/§10.3: exported object-form mutation declarations (`export const save = mutation({ ... })`)
 * are source-derived from module path + export binding, matching compiler/runtime lowering.
 * String-keyed declarations keep their explicit external vocabulary.
 */
export function staticMutationDeclarationFromCall(
  declaration: VariableDeclaration,
  mutationCall: CallExpression,
): StaticMutationDeclaration | null {
  if (!isKovoServerCalleeExpression(mutationCall.getExpression(), 'mutation')) return null;

  const [firstArgument, secondArgument] = mutationCall.getArguments();
  if (
    firstArgument &&
    (Node.isStringLiteral(firstArgument) || Node.isNoSubstitutionTemplateLiteral(firstArgument))
  ) {
    return { bodyArgument: secondArgument, key: firstArgument.getLiteralText() };
  }
  if (firstArgument && Node.isObjectLiteralExpression(firstArgument)) {
    const key = sourceDerivedRegistryKey(declaration);
    return key ? { bodyArgument: firstArgument, key } : null;
  }
  return null;
}

function sourceDerivedQueryKey(declaration: VariableDeclaration): string | undefined {
  return sourceDerivedRegistryKey(declaration);
}

function sourceDerivedRegistryKey(declaration: VariableDeclaration): string | undefined {
  const name = declaration.getNameNode();
  if (!Node.isIdentifier(name) || !isExportedVariableDeclaration(declaration)) return undefined;

  const namespace = sourceDerivedRegistryNamespace(declaration.getSourceFile().getFilePath());
  const leaf = sourceDerivedKebabCase(name.getText());
  return namespace ? `${namespace}/${leaf}` : leaf;
}

function isExportedVariableDeclaration(declaration: Node): boolean {
  const statement = declaration.getFirstAncestorByKind(SyntaxKind.VariableStatement);
  return statement?.isExported() === true;
}

function sourceDerivedRegistryNamespace(fileName: string): string {
  const normalized = fileName.replaceAll('\\', '/').replace(/\.[^./]+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  const fixtureRoot = sourceDerivedFixtureRootIndex(parts);
  const srcRoot = sourceDerivedNearestSrcRootIndex(parts);
  const root = fixtureRoot ?? srcRoot;
  const relative = root === undefined ? parts : parts.slice(root + 1);
  return relative.map(sourceDerivedKebabCase).join('/');
}

function sourceDerivedFixtureRootIndex(parts: readonly string[]): number | undefined {
  for (let index = 0; index <= parts.length - 3; index += 1) {
    if (
      parts[index] === 'tests' &&
      parts[index + 1] === 'integration' &&
      parts[index + 2] === 'fixtures'
    ) {
      return index + 2;
    }
  }
  return undefined;
}

function sourceDerivedNearestSrcRootIndex(parts: readonly string[]): number | undefined {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index] === 'src') return index;
  }
  return undefined;
}

function sourceDerivedKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}

function sqlSinkReceiverIsRawDriverClient(
  call: CallExpression,
  rawDriverClients: ReadonlySet<string>,
): boolean {
  if (rawDriverClients.size === 0) return false;
  const expression = call.getExpression();
  const receiver =
    Node.isPropertyAccessExpression(expression) || Node.isElementAccessExpression(expression)
      ? expression.getExpression()
      : undefined;
  return Boolean(
    receiver && Node.isIdentifier(receiver) && rawDriverClients.has(receiver.getText()),
  );
}

function sqlSinkReceiverIsKovoMutationStream(call: CallExpression): boolean {
  const expression = call.getExpression();
  const receiver =
    Node.isPropertyAccessExpression(expression) || Node.isElementAccessExpression(expression)
      ? expression.getExpression()
      : undefined;
  return Boolean(
    receiver &&
    expressionResolvesToFrameworkExport(receiver, frameworkExport('@kovojs/server', 'stream')),
  );
}

interface SqlSink {
  name: string;
  statementArguments: readonly Node[];
}

function sqlSink(call: CallExpression): SqlSink | null {
  const expression = call.getExpression();
  if (Node.isPropertyAccessExpression(expression)) {
    const name = expression.getName();
    if (name === 'exec' && isRegExpExecReceiver(expression.getExpression())) return null;
    if (RAW_SQL_RECEIVER_SINK_METHODS.has(name) && sqlSinkReceiverCanCarrySql(expression, name)) {
      const statement = call.getArguments()[0];
      return statement ? { name, statementArguments: [statement] } : null;
    }
    return futureSqlSink(call, expression, name);
  }

  if (Node.isElementAccessExpression(expression)) {
    const argument = expression.getArgumentExpression();
    if (Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument)) {
      const name = argument.getLiteralText();
      if (name === 'exec' && isRegExpExecReceiver(expression.getExpression())) return null;
      if (RAW_SQL_RECEIVER_SINK_METHODS.has(name) && sqlSinkReceiverCanCarrySql(expression, name)) {
        const statement = call.getArguments()[0];
        return statement ? { name, statementArguments: [statement] } : null;
      }
      return futureSqlSink(call, expression, name);
    }
    if (!sqlSinkReceiverCanCarrySql(expression, '<computed-sql-method>')) return null;
    const statement = call.getArguments()[0];
    return statement ? { name: '<computed-sql-method>', statementArguments: [statement] } : null;
  }

  return null;
}

function futureSqlSink(call: CallExpression, expression: Node, name: string): SqlSink | null {
  if (CLASSIFIED_DRIZZLE_RECEIVER_METHODS.has(name)) return null;

  const receiver = staticAccessExpression(expression);
  if (!receiver || !sqlSinkReceiverLooksLikeDriver(receiver)) return null;

  const statementArguments = call.getArguments().filter(sqlArgumentLooksExecutable);
  return statementArguments.length > 0 ? { name, statementArguments } : null;
}

function sqlArgumentLooksExecutable(argument: Node): boolean {
  const expression = unwrappedStaticExpressionNode(argument);

  if (Node.isStringLiteral(expression) || Node.isNoSubstitutionTemplateLiteral(expression)) {
    return true;
  }
  if (Node.isTemplateExpression(expression) || Node.isTaggedTemplateExpression(expression)) {
    return true;
  }
  if (Node.isObjectLiteralExpression(expression)) {
    return objectHasProperty(expression, 'text') || objectHasProperty(expression, 'sql');
  }
  if (Node.isCallExpression(expression)) {
    if (isKovoDrizzleTrustedSqlCall(expression)) return true;
    const callee = expression.getExpression();
    return (
      Node.isPropertyAccessExpression(callee) &&
      expressionResolvesToFrameworkExport(
        callee.getExpression(),
        frameworkExport('@kovojs/drizzle', 'sql'),
        { legacyGlobals: [frameworkExport('@kovojs/drizzle', 'sql')] },
      )
    );
  }
  if (Node.isBinaryExpression(expression)) {
    return (
      sqlArgumentLooksExecutable(expression.getLeft()) ||
      sqlArgumentLooksExecutable(expression.getRight())
    );
  }
  return false;
}

function sqlSinkReceiverCanCarrySql(expression: Node, methodName: string): boolean {
  const receiver = staticAccessExpression(expression);
  if (!receiver) return false;
  const receiverExpression = unwrappedStaticExpressionNode(receiver);
  // SQLite drivers expose `db.values(sql)` as an execution sink, while Drizzle insert builders
  // expose `db.insert(table).values(row)`. The builder receiver is a call expression; do not turn
  // ordinary row payloads into KV422 SQL text diagnostics.
  if (Node.isCallExpression(receiverExpression)) return false;
  if (!AMBIGUOUS_RAW_SQL_RECEIVER_SINK_METHODS.has(methodName)) return true;
  return sqlSinkReceiverLooksLikeDriver(receiverExpression);
}

function sqlSinkReceiverLooksLikeDriver(receiver: Node): boolean {
  if (Node.isIdentifier(receiver) && isLikelyDrizzleReceiver(receiver.getText())) return true;
  if (Node.isPropertyAccessExpression(receiver) || Node.isElementAccessExpression(receiver)) {
    const name = staticAccessName(receiver);
    if (name && isLikelyDrizzleReceiver(name)) return true;
  }
  return isProjectDrizzleReceiverContainerExpression(receiver);
}

function isRegExpExecReceiver(receiver: Node): boolean {
  if (receiver.getKind() === SyntaxKind.RegularExpressionLiteral) return true;
  return typeIsRegExpInstance(receiver.getType());
}

function typeIsRegExpInstance(type: MorphType): boolean {
  const symbolName = type.getSymbol()?.getName() ?? type.getAliasSymbol()?.getName();
  if (symbolName === 'RegExp') return true;
  const text = type.getText();
  if (text === 'RegExp' || text === 'globalThis.RegExp') return true;
  const apparent = type.getApparentType();
  if (apparent !== type) {
    const apparentSymbolName =
      apparent.getSymbol()?.getName() ?? apparent.getAliasSymbol()?.getName();
    if (apparentSymbolName === 'RegExp') return true;
    const apparentText = apparent.getText();
    if (apparentText === 'RegExp' || apparentText === 'globalThis.RegExp') return true;
  }
  return false;
}

function sqlTextSafety(expression: Node | undefined, context: SqlSafetyContext): SqlTextSafety {
  if (!expression) return 'unknown';
  if (Node.isStringLiteral(expression) || Node.isNoSubstitutionTemplateLiteral(expression)) {
    return 'literal';
  }
  if (Node.isTaggedTemplateExpression(expression)) {
    const tag = expression.getTag();
    return isKovoSqlTagExpression(tag) ? 'safe' : 'unknown';
  }
  if (Node.isTemplateExpression(expression)) return 'tainted';
  if (Node.isCallExpression(expression)) {
    const callExpression = expression.getExpression();
    if (isKovoDrizzleTrustedSqlCall(expression)) return 'safe';
    if (Node.isPropertyAccessExpression(callExpression)) {
      const receiver = callExpression.getExpression();
      // SPEC §10.2/§6.6 (KV422): resolve Kovo `sql` through its aliased/namespace
      // `@kovojs/drizzle` binding so `s.raw(...)` / `k.sql.identifier(...)` are
      // classified identically to bare `sql.*` — matching the sink-side fix above.
      if (
        expressionResolvesToFrameworkExport(receiver, frameworkExport('@kovojs/drizzle', 'sql'), {
          legacyGlobals: [frameworkExport('@kovojs/drizzle', 'sql')],
        })
      ) {
        const method = callExpression.getName();
        if (method === 'identifier') {
          return sqlAllowlistSafety(expression.getArguments()[1], context) === 'literal'
            ? 'safe'
            : joinSqlTextSafety(sqlTextSafety(expression.getArguments()[0], context), 'unknown');
        }
        if (method === 'allow') {
          return sqlAllowlistSafety(expression.getArguments()[1], context) === 'literal'
            ? 'safe'
            : joinSqlTextSafety(sqlTextSafety(expression.getArguments()[0], context), 'unknown');
        }
        if (method === 'join') return sqlJoinSafety(expression, context);
        if (method === 'raw') {
          return sqlTextSafety(expression.getArguments()[0], context) === 'literal'
            ? 'literal'
            : 'unknown';
        }
      }
    }
    if (objectCarrierSafety(expression) === 'safe') return 'safe';
    return 'unknown';
  }
  if (Node.isObjectLiteralExpression(expression)) return objectCarrierSafety(expression);
  if (Node.isIdentifier(expression)) {
    return bindingSafety(expression, context) ?? 'unknown';
  }
  if (Node.isPropertyAccessExpression(expression)) {
    return requestSourceExpression(expression, context) ? 'tainted' : 'unknown';
  }
  if (Node.isElementAccessExpression(expression)) {
    return requestSourceExpression(expression, context) ? 'tainted' : 'unknown';
  }
  if (Node.isBinaryExpression(expression)) {
    const operator = expression.getOperatorToken().getKind();
    if (operator !== SyntaxKind.PlusToken) return 'unknown';
    return joinSqlTextSafety(
      sqlTextSafety(expression.getLeft(), context),
      sqlTextSafety(expression.getRight(), context),
    );
  }
  if (Node.isArrayLiteralExpression(expression)) {
    return expression.getElements().some((item) => sqlTextSafety(item, context) !== 'literal')
      ? 'unknown'
      : 'literal';
  }
  return requestSourceExpression(expression, context) ? 'tainted' : 'unknown';
}

function objectCarrierSafety(expression: Node): SqlTextSafety {
  if (!Node.isObjectLiteralExpression(expression)) return 'unknown';
  const hasText =
    objectHasLiteralProperty(expression, 'text') || objectHasLiteralProperty(expression, 'sql');
  const hasParams =
    objectHasProperty(expression, 'values') ||
    objectHasProperty(expression, 'params') ||
    objectHasProperty(expression, 'args');
  return hasText && hasParams ? 'safe' : 'unknown';
}

function objectHasLiteralProperty(
  expression: ObjectLiteralExpression,
  propertyName: string,
): boolean {
  const property = expression.getProperty(propertyName);
  if (!Node.isPropertyAssignment(property)) return false;
  const initializer = property.getInitializer();
  return (
    !!initializer &&
    (Node.isStringLiteral(initializer) || Node.isNoSubstitutionTemplateLiteral(initializer))
  );
}

function sqlAllowlistSafety(
  expression: Node | undefined,
  context: SqlSafetyContext,
): SqlTextSafety {
  if (!expression) return 'unknown';
  const node = unwrappedStaticExpressionNode(expression);
  if (Node.isObjectLiteralExpression(node)) {
    const allow = node.getProperty('allow');
    if (!Node.isPropertyAssignment(allow)) return 'unknown';
    return sqlAllowlistSafety(allow.getInitializer(), context);
  }
  if (Node.isArrayLiteralExpression(node)) {
    return node.getElements().every((item) => sqlAllowlistLiteral(item))
      ? 'literal'
      : combineSqlTextSafetyForNodes(node.getElements(), context);
  }
  if (Node.isIdentifier(node)) return bindingSafety(node, context) ?? 'unknown';
  return requestSourceExpression(node, context) ? 'tainted' : 'unknown';
}

function sqlAllowlistLiteral(node: Node): boolean {
  const expression = unwrappedStaticExpressionNode(node);
  return (
    Node.isStringLiteral(expression) ||
    Node.isNoSubstitutionTemplateLiteral(expression) ||
    Node.isNumericLiteral(expression) ||
    expression.getKind() === SyntaxKind.TrueKeyword ||
    expression.getKind() === SyntaxKind.FalseKeyword
  );
}

function sqlJoinSafety(expression: CallExpression, context: SqlSafetyContext): SqlTextSafety {
  const [parts, separator] = expression.getArguments();
  const partSafety = sqlJoinPartsSafety(parts, context);
  const separatorSafety = separator ? sqlTextSafety(separator, context) : 'literal';
  if (partSafety === 'literal' && separatorSafety === 'literal') return 'literal';
  if (
    (partSafety === 'literal' || partSafety === 'safe') &&
    (separatorSafety === 'literal' || separatorSafety === 'safe')
  ) {
    return 'safe';
  }
  return joinSqlTextSafety(partSafety, separatorSafety);
}

function sqlJoinPartsSafety(
  expression: Node | undefined,
  context: SqlSafetyContext,
): SqlTextSafety {
  if (!expression) return 'unknown';
  const node = unwrappedStaticExpressionNode(expression);
  if (Node.isArrayLiteralExpression(node)) {
    return combineSqlTextSafetyForNodes(node.getElements(), context);
  }
  if (Node.isIdentifier(node)) return bindingSafety(node, context) ?? 'unknown';
  return requestSourceExpression(node, context) ? 'tainted' : 'unknown';
}

function combineSqlTextSafetyForNodes(
  nodes: readonly Node[],
  context: SqlSafetyContext,
): SqlTextSafety {
  let sawSafe = false;
  for (const node of nodes) {
    const safety = sqlTextSafety(node, context);
    if (safety === 'tainted') return 'tainted';
    if (safety === 'unknown') return 'unknown';
    if (safety === 'safe') sawSafe = true;
  }
  return sawSafe ? 'safe' : 'literal';
}

function joinSqlTextSafety(left: SqlTextSafety, right: SqlTextSafety): SqlTextSafety {
  if (left === 'tainted' || right === 'tainted') return 'tainted';
  if (left === 'unknown' || right === 'unknown') return 'unknown';
  if (left === 'safe' || right === 'safe') return 'unknown';
  return 'literal';
}

function bindingSafety(identifier: Node, context: SqlSafetyContext): SqlTextSafety | undefined {
  const key = sqlSafetySymbolKey(identifier);
  const binding = key ? context.sqlBindingsBySymbolKey.get(key) : undefined;
  if (binding) return binding;

  const provenance = symbolProvenanceForExpression(identifier, context.provenance);
  if (provenance.kind === 'literal') return 'literal';
  if (sqlRequestInputProvenance(provenance)) return 'tainted';
  return undefined;
}

function assignSqlSafetyBinding(
  node: Node,
  safety: SqlTextSafety,
  context: SqlSafetyContext,
): void {
  const key = sqlSafetySymbolKey(node);
  if (key) context.sqlBindingsBySymbolKey.set(key, safety);
}

function sqlSafetySymbolKey(node: Node): string | undefined {
  if (!Node.isIdentifier(node)) return resolvedSymbolKey(node.getSymbol());
  return resolvedSymbolKey(symbolForIdentifierReference(node) ?? node.getSymbol());
}

function sqlSafetyContextForSourceFile(sourceFile: SourceFile): SqlSafetyContext {
  return {
    // SPEC §6.6/§10.2/§11.1: request-derived SQL text is proven by AST symbol
    // provenance, not by source text/regex matching.
    provenance: symbolProvenanceContextForNodes([sourceFile], {
      inputRootPaths: sqlRequestInputRootPaths(sourceFile),
    }),
    sqlBindingsBySymbolKey: new Map(),
  };
}

function sqlRequestInputRootPaths(sourceFile: SourceFile): SymbolProvenanceRoot[] {
  const roots: SymbolProvenanceRoot[] = [];
  for (const parameter of sourceFile.getDescendantsOfKind(SyntaxKind.Parameter)) {
    const name = parameter.getNameNode();
    appendSqlRequestInputRootPath(name, roots);
  }
  return roots;
}

function appendSqlRequestInputRootPath(
  name: Node,
  roots: SymbolProvenanceRoot[],
  prefix = '',
): void {
  if (Node.isIdentifier(name)) {
    const text = name.getText();
    if (text === 'req') {
      roots.push({ node: name, path: 'req' });
      return;
    }
    if (text === 'input' || text === 'form' || text === 'headers' || text === 'cookies') {
      roots.push({ node: name, path: text });
      return;
    }
    if (
      prefix === 'req' &&
      (text === 'search' || text === 'params' || text === 'headers' || text === 'cookies')
    ) {
      roots.push({ node: name, path: `req.${text}` });
    }
    return;
  }

  if (!Node.isObjectBindingPattern(name)) return;
  for (const element of name.getElements()) {
    const property = element.getPropertyNameNode();
    const field = property ? propertyNameText(property) : objectBindingElementPropertyName(element);
    const child = element.getNameNode();
    if (!field) continue;
    if (field === 'search' || field === 'params' || field === 'headers' || field === 'cookies') {
      appendSqlRequestInputRootPath(child, roots, 'req');
      if (Node.isIdentifier(child)) roots.push({ node: child, path: `req.${field}` });
    }
  }
}

function requestSourceExpression(expression: Node, context: SqlSafetyContext): boolean {
  return sqlRequestInputProvenance(symbolProvenanceForExpression(expression, context.provenance));
}

function sqlRequestInputProvenance(provenance: SymbolProvenance): boolean {
  if (provenance.kind !== 'input') return false;
  const path = provenance.path;
  return (
    path === undefined ||
    path === 'input' ||
    path.startsWith('input.') ||
    path === 'form' ||
    path.startsWith('form.') ||
    path === 'headers' ||
    path.startsWith('headers.') ||
    path === 'cookies' ||
    path.startsWith('cookies.') ||
    path === 'req.search' ||
    path.startsWith('req.search.') ||
    path === 'req.params' ||
    path.startsWith('req.params.') ||
    path === 'req.headers' ||
    path.startsWith('req.headers.') ||
    path === 'req.cookies' ||
    path.startsWith('req.cookies.')
  );
}

function sqlSafetyDescription(safety: SqlTextSafety): string {
  if (safety === 'literal') return 'unbranded literal';
  if (safety === 'tainted') return 'request-derived';
  if (safety === 'unknown') return 'unknown-provenance';
  return 'safe';
}

// SPEC.md §11.1 (v1 scope): touch-graph facts require project-mode ts-morph type proof.
// The source-mode entry points and their name/shape heuristics were removed in
// v1-cleanup item 4; callers must supply a project SourceModuleContext and
// project-derived ExtractedFunction[] so receivers/tables are proven by TypeScript
// symbols/types, never by parameter names or pgTable("...") string literals.
function extractTouchGraphFromPreparedFiles(
  files: readonly SourceFileInput[],
  functionsForFile: (file: SourceFileInput) => ExtractedFunction[],
  sourceContext: SourceModuleContext,
  extraUnresolvedIdentifiers: ReadonlySet<string> = new Set(),
  tablesForContextFile: (file: SourceFileInput) => ReturnType<typeof tablesForFile> = (file) =>
    tablesForFile(file, sourceContext),
): TouchGraph {
  const unresolvedIdentifiers = new Set<string>(extraUnresolvedIdentifiers);
  const graph: Record<string, TouchGraphEntry> = {};
  const graphSummaries = new Map<string, FunctionTouchSummary>();

  for (const file of files) {
    const fileTables = tablesForContextFile(file);
    for (const identifier of extractUnresolvedConditionalIdentifiers(file, fileTables)) {
      unresolvedIdentifiers.add(identifier);
    }
  }

  for (const file of files) {
    const fileTables = tablesForContextFile(file);
    const functions = functionsForFile(file);
    const rawTablesByDomainWrite = rawTablesByDomainWriteCallback(file);
    const rawTablesByMutation = rawTablesByMutationHandler(file);
    const summaries = functionTouchSummariesForFile(
      file,
      functions,
      fileTables,
      unresolvedIdentifiers,
    );

    for (const unresolved of unresolvedDomainWriteCallbacks(file)) {
      const summary: FunctionTouchSummary = {
        reads: [],
        unresolved: [
          {
            operation: 'domain-write-callback',
            site: unresolved.site,
          },
        ],
        writes: [],
      };
      if (unresolved.mergeWithExact) {
        const graphSummary = graphSummaries.get(unresolved.name) ?? {
          reads: [],
          unresolved: [],
          writes: [],
        };
        mergeSummary(graphSummary, summary);
        graphSummaries.set(unresolved.name, graphSummary);
        graph[unresolved.name] = createTouchGraphEntry(graphSummary);
      } else {
        graph[unresolved.name] = createTouchGraphEntry(summary);
      }
    }

    for (const fn of functions) {
      if (fn.summaryOnly) continue;

      const { reads, unresolved, writes } = summaries.get(fn.key) ?? {
        reads: [],
        unresolved: [],
        writes: [],
      };
      const rawTables = mergedRawTables(
        rawTablesByDomainWrite.get(fn.name),
        rawTablesByMutation.get(fn.name),
      );
      const visibleUnresolved =
        rawTables.length > 0
          ? unresolved.filter(
              (site) => !declaredRawTableCoversUnresolved(site.operation, rawTables),
            )
          : unresolved;
      if (
        reads.length > 0 ||
        writes.length > 0 ||
        visibleUnresolved.length > 0 ||
        rawTables.length > 0
      ) {
        const graphSummary = graphSummaries.get(fn.name) ?? {
          reads: [],
          unresolved: [],
          writes: [],
        };
        mergeSummary(graphSummary, { rawTables, reads, unresolved: visibleUnresolved, writes });
        graphSummaries.set(fn.name, graphSummary);
        graph[fn.name] = createTouchGraphEntry(graphSummary);
      }
    }
  }

  return graph;
}

/** @internal */
/** @internal */ export function extractTouchGraphFromProject(
  options: TouchGraphProjectOptions,
): TouchGraph {
  // SPEC §11.1: share one syntactic parse cache across this run's withParsedSourceFile calls.
  return runWithSourceFileParseCache(() => {
    const extraction = createProjectExtraction(options);
    try {
      return extractTouchGraphFromProjectExtraction(extraction);
    } finally {
      extraction.dispose();
    }
  });
}

/** @internal */ export function extractTouchGraphFromProjectExtraction(
  extraction: ProjectExtraction,
): TouchGraph {
  return extractTouchGraphFromAnalysisContext(createDrizzleAnalysisContext(extraction));
}

/** @internal */ export function extractTouchGraphFromAnalysisContext(
  context: DrizzleAnalysisContext,
): TouchGraph {
  return context.facts.touchGraph();
}

/** @internal */
/** @internal */ export function extractQueryFactsFromProject(
  options: TouchGraphProjectOptions,
): QueryFact[] {
  // SPEC §11.1: share one syntactic parse cache across this run's withParsedSourceFile calls.
  return runWithSourceFileParseCache(() => {
    const extraction = createProjectExtraction(options);
    try {
      return extractQueryFactsFromProjectExtraction(extraction);
    } finally {
      extraction.dispose();
    }
  });
}

/** @internal */ export function extractQueryFactsFromProjectExtraction(
  extraction: ProjectExtraction,
): QueryFact[] {
  return extractQueryFactsFromAnalysisContext(createDrizzleAnalysisContext(extraction));
}

/** @internal */ export function extractQueryFactsFromAnalysisContext(
  context: DrizzleAnalysisContext,
): QueryFact[] {
  return [...context.facts.queryFacts()];
}

/**
 * Produce the owner/IDOR audit facts for a project (SPEC §10.1/§10.3): the
 * `ownerDomains` derived from `owner:` annotations, and the `scopeAudits` for
 * owner-domain reads (a client-arg-keyed read -> KV414 unless `owns()`-discharged;
 * a directly `req.session`-anchored read -> safe). The graph emission feeds these
 * into `kovo check`.
 *
 * @internal
 */
/** @internal */ export function extractOwnerAuditFromProject(options: TouchGraphProjectOptions): {
  ownerDomains: OwnerDomainFact[];
  scopeAudits: ScopeAuditFact[];
} {
  // SPEC §11.1: share one syntactic parse cache across this run's withParsedSourceFile calls.
  return runWithSourceFileParseCache(() => {
    const extraction = createProjectExtraction(options);
    try {
      return extractOwnerAuditFromProjectExtraction(extraction);
    } finally {
      extraction.dispose();
    }
  });
}

/** @internal */ export function extractOwnerAuditFromProjectExtraction(
  extraction: ProjectExtraction,
  queries?: readonly QueryFact[],
  writeFacts?: readonly WriteScopeFact[],
): {
  ownerDomains: OwnerDomainFact[];
  scopeAudits: ScopeAuditFact[];
} {
  return extractOwnerAuditFromAnalysisContext(
    createDrizzleAnalysisContext(extraction),
    queries,
    writeFacts,
  );
}

/** @internal */ export function extractOwnerAuditFromAnalysisContext(
  context: DrizzleAnalysisContext,
  queries?: readonly QueryFact[],
  writeFacts?: readonly WriteScopeFact[],
): {
  ownerDomains: OwnerDomainFact[];
  scopeAudits: ScopeAuditFact[];
} {
  if (!queries && !writeFacts) {
    const audit = context.facts.ownerAudit();
    return {
      ownerDomains: [...audit.ownerDomains],
      scopeAudits: [...audit.scopeAudits],
    };
  }

  const writes = writeFacts ?? context.facts.writeScopeFacts();
  const queryFacts = queries ?? context.facts.queryFacts();
  const ownerDomains = context.facts.ownerDomains();
  // SPEC §10.3 / KV414: "a query OR write" reaching an owner table. Reads and writes
  // are both audited (A1 added the write half, which the framework never produced).
  const scopeAudits = [
    ...scopeAuditsFromQueryFacts(queryFacts, ownerDomains),
    ...scopeAuditsFromWriteFacts(writes, ownerDomains),
  ];
  return { ownerDomains: [...ownerDomains], scopeAudits };
}

function requestReachableTableNames(input: {
  queries: readonly QueryFact[];
  queryWriteReachability: readonly QueryWriteReachabilityFact[];
  touchGraph: TouchGraph;
}): Map<string, string> {
  const reachable = new Map<string, string>();
  const add = (table: string, site: string) => {
    if (table === UNRESOLVED_READ_SOURCE_EXPRESSION || reachable.has(table)) return;
    reachable.set(table, site);
  };
  for (const query of input.queries) {
    for (const read of query.readProvenance ?? []) add(read.via, read.site);
  }
  for (const fact of input.queryWriteReachability) {
    add(fact.table, fact.site);
  }
  for (const entry of Object.values(input.touchGraph)) {
    for (const read of entry.reads ?? []) add(read.via, read.site);
    for (const touch of entry.touches ?? []) add(touch.via, touch.site);
    for (const table of entry.tables ?? []) add(table, tableAuthzCensusSite(table));
  }
  return reachable;
}

function appendQueryReadDomainTables(
  reachable: Map<string, string>,
  queries: readonly QueryFact[],
  tables: readonly ExtractedTable[],
): void {
  const tablesByDomain = new Map<string, string[]>();
  for (const table of tables) {
    if (!isDomainExtractedTableAnnotation(table.annotation)) continue;
    const domain = extractedDomainKey(table.annotation.domain);
    const bucket = tablesByDomain.get(domain);
    if (bucket) bucket.push(table.annotation.name);
    else tablesByDomain.set(domain, [table.annotation.name]);
  }
  for (const query of queries) {
    for (const domain of query.reads) {
      for (const table of tablesByDomain.get(domain) ?? []) {
        if (!reachable.has(table)) reachable.set(table, query.site);
      }
    }
  }
}

function authzCensusDiagnosticsFromTables(
  tables: readonly ExtractedTable[],
  reachable: ReadonlyMap<string, string>,
): TouchGraphDiagnostic[] {
  const diagnostics = new Map<string, TouchGraphDiagnostic>();
  for (const table of tables) {
    const name = table.annotation.name;
    const site = reachable.get(name);
    if (!site) continue;
    const classifications = authzCensusClassifications(table.annotation);
    if (classifications.length === 1) continue;
    const reason =
      classifications.length === 0
        ? 'is request-reachable but has no authorization classification'
        : `has multiple authorization classifications (${classifications.join(', ')})`;
    diagnostics.set(name, {
      code: 'KV414',
      message: `${diagnosticDefinitions.KV414.message} Authorization census table ${name} ${reason}; declare exactly one of owned/ownedVia/authzPolicy/public/reference.`,
      severity: diagnosticDefinitions.KV414.severity,
      site,
    });
  }
  return [...diagnostics.values()].sort((left, right) => left.site.localeCompare(right.site));
}

function authzCensusClassifications(
  annotation: ExtractedTableAnnotation,
): AuthzCensusClassification[] {
  if (!isDomainExtractedTableAnnotation(annotation)) return [];
  const classifications: AuthzCensusClassification[] = [];
  if (annotation.owner !== undefined) classifications.push('owned');
  if (annotation.ownerVia !== undefined) classifications.push('ownedVia');
  if (annotation.authzPolicy !== undefined) classifications.push('authzPolicy');
  if (annotation.public === true) classifications.push('public');
  if (annotation.reference === true) classifications.push('reference');
  return classifications;
}

function tableAuthzCensusSite(table: string): string {
  return `${table || UNRESOLVED_READ_SOURCE_EXPRESSION}:1`;
}

/**
 * Write-side owner scope facts for a project (SPEC §10.3, §11.1; KV414 A1). Iterates
 * every analyzable function's Drizzle write calls (`db.update/delete(...).where(...)`)
 * and, for each write touching an owner-annotated table, classifies its `where()`
 * predicate as `args` (client `input.*` key, any column — A3) or `session`
 * (`req.session.*`), reusing the same operand classifier as the read side.
 *
 * @internal
 */
/** @internal */ export function extractWriteScopeFactsFromProject(
  options: TouchGraphProjectOptions,
): WriteScopeFact[] {
  // SPEC §11.1: share one syntactic parse cache across this run's withParsedSourceFile calls.
  return runWithSourceFileParseCache(() => {
    const extraction = createProjectExtraction(options);
    try {
      return extractWriteScopeFactsFromProjectExtraction(extraction);
    } finally {
      extraction.dispose();
    }
  });
}

/** @internal */ export function extractWriteScopeFactsFromProjectExtraction(
  extraction: ProjectExtraction,
): WriteScopeFact[] {
  return extractWriteScopeFactsFromAnalysisContext(createDrizzleAnalysisContext(extraction));
}

/** @internal */ export function extractWriteScopeFactsFromAnalysisContext(
  context: DrizzleAnalysisContext,
): WriteScopeFact[] {
  return [...context.facts.writeScopeFacts()];
}

function writeScopeFactsForFunction(
  fn: ExtractedFunction,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): WriteScopeFact[] {
  const facts: WriteScopeFact[] = [];

  for (const call of fn.writeCalls) {
    const domains = new Set<string>();
    for (const table of tables.get(call.tableExpression) ?? []) {
      if (isDomainExtractedTableAnnotation(table.annotation)) domains.add(table.annotation.domain);
    }
    if (domains.size === 0) continue;

    const argScopedWrites = queryArgScopedDomains(call.instanceKeyComparisons, tables);
    const argScopedWriteKeys = queryArgScopedDomainKeys(call.instanceKeyComparisons, tables);
    const ownerScopedSessionWrites = queryOwnerSessionAnchoredDomains(
      call.instanceKeyComparisons,
      tables,
    );
    const ownerScopedPrivateWriteKeys = queryOwnerPrivateScopedKeys(
      call.instanceKeyComparisons,
      tables,
    );
    const hasClientArgPredicate = queryHasClientArgPredicate(call.instanceKeyComparisons);
    const sessionAnchoredWrites = querySessionAnchoredDomains(call.instanceKeyComparisons, tables);

    facts.push({
      argScopedWrites,
      ...(call.instanceKeyComparisons.acceptedGuardPrivateKeys?.length
        ? { acceptedGuardPrivateKeys: call.instanceKeyComparisons.acceptedGuardPrivateKeys }
        : {}),
      ...(argScopedWriteKeys.length > 0 ? { argScopedWriteKeys } : {}),
      ...(hasClientArgPredicate ? { hasClientArgPredicate } : {}),
      name: fn.name,
      ...(ownerScopedPrivateWriteKeys.length > 0 ? { ownerScopedPrivateWriteKeys } : {}),
      ...(ownerScopedSessionWrites.length > 0 ? { ownerScopedSessionWrites } : {}),
      reads: [...domains].sort(),
      sessionAnchoredWrites,
      site: call.site ?? '',
    });
  }

  return facts;
}

function rawWriteScopeFactsForFunction(
  fn: ExtractedFunction,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
  rawTables: readonly string[],
  trust: RawWriteSqlTrust | undefined,
): WriteScopeFact[] {
  if (rawTables.length === 0 || !trust?.hasRawSqlSink || trust.trusted) return [];

  const domains = new Set<string>();
  for (const table of extractedTablesForRawNames(tables, rawTables)) {
    if (isDomainExtractedTableAnnotation(table.annotation)) {
      domains.add(extractedDomainKey(table.annotation.domain));
    }
  }
  if (domains.size === 0) return [];

  return [
    {
      argScopedWrites: [],
      name: fn.name,
      reads: [...domains].sort(),
      sessionAnchoredWrites: [],
      site: trust.site ?? '',
    },
  ];
}

const KOVO_DURABLE_TASK_QUEUE_TABLE = '_kovo_jobs';
const KOVO_DURABLE_TASK_QUEUE_OPERATIONS = new Set(['cancel', 'schedule']);

function declaredRawTableCoversUnresolved(
  operation: string,
  rawTables: readonly string[],
): boolean {
  if (RAW_SQL_WRITE_RECEIVER_SINK_METHODS.has(operation)) return true;
  // SPEC §9.6: request.schedule()/cancel() persist durable queue rows in the
  // framework-owned _kovo_jobs store; a registry table declaration keeps that
  // write auditable without treating the request container as opaque Drizzle.
  return (
    rawTables.includes(KOVO_DURABLE_TASK_QUEUE_TABLE) &&
    KOVO_DURABLE_TASK_QUEUE_OPERATIONS.has(operation)
  );
}

function extractedTablesForRawNames(
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
  rawTables: readonly string[],
): ExtractedTable[] {
  const rawNames = new Set(rawTables);
  const found = new Map<string, ExtractedTable>();

  for (const entries of tables.values()) {
    for (const table of entries) {
      if (!rawNames.has(table.annotation.name)) continue;
      found.set(JSON.stringify(table.annotation), table);
    }
  }

  return [...found.values()];
}

function ownerDomainsFromProject(options: TouchGraphProjectOptions): OwnerDomainFact[] {
  // SPEC §11.1: share one syntactic parse cache across this run's withParsedSourceFile calls.
  return runWithSourceFileParseCache(() => {
    const extraction = createProjectExtraction(options);
    try {
      return ownerDomainsFromProjectExtraction(extraction);
    } finally {
      extraction.dispose();
    }
  });
}

function ownerDomainsFromProjectExtraction(extraction: ProjectExtraction): OwnerDomainFact[] {
  return [...createDrizzleAnalysisContext(extraction).facts.ownerDomains()];
}

/** @internal */
/** @internal */ export function extractMaterializedViewRefreshFactsFromProject(
  options: TouchGraphProjectOptions,
): MaterializedViewRefreshFact[] {
  // SPEC §11.1: share one syntactic parse cache across this run's withParsedSourceFile calls.
  return runWithSourceFileParseCache(() => {
    const extraction = createProjectExtraction(options);
    try {
      return extractMaterializedViewRefreshFactsFromAnalysisContext(
        createDrizzleAnalysisContext(extraction),
      );
    } finally {
      extraction.dispose();
    }
  });
}

/** @internal */ export function extractMaterializedViewRefreshFactsFromAnalysisContext(
  context: DrizzleAnalysisContext,
): MaterializedViewRefreshFact[] {
  return [...context.facts.materializedViewRefreshFacts()];
}

/** @internal */ export interface StaticBuildAnalysisFacts {
  massAssignmentFacts: readonly MassAssignmentFact[];
  ownerDomains: readonly OwnerDomainFact[];
  queries: readonly QueryFact[];
  queryWriteReachability: readonly QueryWriteReachabilityFact[];
  scopeAudits: readonly ScopeAuditFact[];
  sqlSafetyDiagnostics: readonly TouchGraphDiagnostic[];
  toctouFacts: readonly ToctouFact[];
  touchGraph: TouchGraph;
}

type AuthzCensusClassification = 'authzPolicy' | 'owned' | 'ownedVia' | 'public' | 'reference';

/** @internal */ export interface DrizzleAnalysisContext {
  extraction: ProjectExtraction;
  facts: DrizzleFactStore;
}

/** @internal */ export interface DrizzleFactStore {
  contextFiles(): readonly SourceFileInput[];
  functionExtractionsByFileName(): ReturnType<typeof projectFunctionExtractionsByFileName>;
  massAssignmentFacts(): readonly MassAssignmentFact[];
  materializedViewRefreshFacts(): readonly MaterializedViewRefreshFact[];
  ownerAudit(): {
    ownerDomains: readonly OwnerDomainFact[];
    scopeAudits: readonly ScopeAuditFact[];
  };
  authzCensusDiagnostics(): readonly TouchGraphDiagnostic[];
  ownerDomains(): readonly OwnerDomainFact[];
  mutationSecretWireDiagnostics(): readonly TouchGraphDiagnostic[];
  queryFacts(): readonly QueryFact[];
  queryWriteReachability(): readonly QueryWriteReachabilityFact[];
  relationCardinalities(): ReturnType<typeof projectRelationCardinalitiesByProperty>;
  relationTargetTableNames(): ReturnType<typeof projectRelationTargetTableNamesByProperty>;
  sourceContext(): SourceModuleContext;
  sqlSafetyDiagnostics(): readonly TouchGraphDiagnostic[];
  staticBuildAnalysisFacts(): StaticBuildAnalysisFacts;
  tablesForFile(file: SourceFileInput): ReturnType<typeof tablesForFile>;
  toctouFacts(): readonly ToctouFact[];
  touchGraph(): TouchGraph;
  writeScopeFacts(): readonly WriteScopeFact[];
}

class LazyDrizzleFactStore implements DrizzleFactStore {
  private readonly extraction: ProjectExtraction;
  private cachedMassAssignmentFacts: readonly MassAssignmentFact[] | undefined;
  private cachedMaterializedViewRefreshFacts: readonly MaterializedViewRefreshFact[] | undefined;
  private cachedOwnerAudit:
    | {
        ownerDomains: readonly OwnerDomainFact[];
        scopeAudits: readonly ScopeAuditFact[];
      }
    | undefined;
  private cachedAuthzCensusDiagnostics: readonly TouchGraphDiagnostic[] | undefined;
  private cachedOwnerDomains: readonly OwnerDomainFact[] | undefined;
  private cachedMutationSecretWireDiagnostics: readonly TouchGraphDiagnostic[] | undefined;
  private cachedQueryFacts: readonly QueryFact[] | undefined;
  private cachedQueryWriteReachability: readonly QueryWriteReachabilityFact[] | undefined;
  private cachedRelationCardinalities:
    | ReturnType<typeof projectRelationCardinalitiesByProperty>
    | undefined;
  private cachedRelationTargetTableNames:
    | ReturnType<typeof projectRelationTargetTableNamesByProperty>
    | undefined;
  private cachedSourceContext: SourceModuleContext | undefined;
  private cachedSqlSafetyDiagnostics: readonly TouchGraphDiagnostic[] | undefined;
  private cachedStaticBuildAnalysisFacts: StaticBuildAnalysisFacts | undefined;
  private cachedToctouFacts: readonly ToctouFact[] | undefined;
  private cachedTouchGraph: TouchGraph | undefined;
  private cachedWriteScopeFacts: readonly WriteScopeFact[] | undefined;
  private readonly namespaceTableNamesByFileName = new Map<
    string,
    ReturnType<typeof projectNamespaceTableNamesByLocal>
  >();
  private readonly queryDefinitionsByFileName = new Map<
    string,
    readonly ExtractedQueryDefinition[]
  >();
  private readonly relationalTableNamesByFileName = new Map<
    string,
    ReturnType<typeof projectRelationalTableNamesByProperty>
  >();
  private readonly tablesByFileName = new Map<string, ReturnType<typeof tablesForFile>>();

  constructor(extraction: ProjectExtraction) {
    this.extraction = extraction;
  }

  contextFiles(): readonly SourceFileInput[] {
    return projectContextFiles(this.extraction);
  }

  functionExtractionsByFileName(): ReturnType<typeof projectFunctionExtractionsByFileName> {
    return projectFunctionExtractionsByFileName(this.extraction);
  }

  sourceContext(): SourceModuleContext {
    this.cachedSourceContext ??= projectSourceModuleContext(this.extraction);
    return this.cachedSourceContext;
  }

  relationTargetTableNames(): ReturnType<typeof projectRelationTargetTableNamesByProperty> {
    this.cachedRelationTargetTableNames ??= projectRelationTargetTableNamesForExtraction(
      this.extraction,
    );
    return this.cachedRelationTargetTableNames;
  }

  relationCardinalities(): ReturnType<typeof projectRelationCardinalitiesByProperty> {
    this.cachedRelationCardinalities ??= projectRelationCardinalitiesByProperty(
      this.extraction.sourceFiles,
    );
    return this.cachedRelationCardinalities;
  }

  tablesForFile(file: SourceFileInput): ReturnType<typeof tablesForFile> {
    const cached = this.tablesByFileName.get(file.fileName);
    if (cached) return cached;
    const tables = tablesForFile(file, this.sourceContext());
    this.tablesByFileName.set(file.fileName, tables);
    return tables;
  }

  queryFacts(): readonly QueryFact[] {
    if (this.cachedQueryFacts) return this.cachedQueryFacts;
    const functions = this.functionExtractionsByFileName();
    this.cachedQueryFacts = extractQueryFactsFromPreparedFiles(
      this.extraction.files,
      (file) => this.queryDefinitionsForFile(file),
      this.contextFiles(),
      this.sourceContext(),
      (file) => projectFunctionsForFile(file, functions),
      (file) => this.tablesForFile(file),
    );
    return this.cachedQueryFacts;
  }

  writeScopeFacts(): readonly WriteScopeFact[] {
    if (this.cachedWriteScopeFacts) return this.cachedWriteScopeFacts;
    const contextFiles = this.contextFiles();
    const functions = this.functionExtractionsByFileName();
    const facts: WriteScopeFact[] = [];

    for (const file of contextFiles) {
      const fileTables = this.tablesForFile(file);
      const rawTablesByDomainWrite = rawTablesByDomainWriteCallback(file);
      const rawTablesByMutation = rawTablesByMutationHandler(file);
      const rawWriteTrustByDomainWrite = rawWriteSqlTrustByDomainWriteCallback(file);
      const rawWriteTrustByMutation = rawWriteSqlTrustByMutationHandler(file);
      for (const fn of projectFunctionsForFile(file, functions)) {
        if (fn.summaryOnly) continue;
        const rawTables = mergedRawTables(
          rawTablesByDomainWrite.get(fn.name),
          rawTablesByMutation.get(fn.name),
        );
        const rawWriteTrust = mergedRawWriteSqlTrust(
          rawWriteTrustByDomainWrite.get(fn.name),
          rawWriteTrustByMutation.get(fn.name),
        );
        facts.push(...writeScopeFactsForFunction(fn, fileTables));
        facts.push(...rawWriteScopeFactsForFunction(fn, fileTables, rawTables, rawWriteTrust));
      }
    }

    this.cachedWriteScopeFacts = facts.sort(
      (left, right) => left.name.localeCompare(right.name) || left.site.localeCompare(right.site),
    );
    return this.cachedWriteScopeFacts;
  }

  ownerDomains(): readonly OwnerDomainFact[] {
    if (this.cachedOwnerDomains) return this.cachedOwnerDomains;
    const tables: ExtractedTable[] = [];
    for (const file of this.contextFiles()) {
      for (const entries of this.tablesForFile(file).values()) tables.push(...entries);
    }
    this.cachedOwnerDomains = ownerDomainsFromTables(tables);
    return this.cachedOwnerDomains;
  }

  ownerAudit(): {
    ownerDomains: readonly OwnerDomainFact[];
    scopeAudits: readonly ScopeAuditFact[];
  } {
    if (this.cachedOwnerAudit) return this.cachedOwnerAudit;
    const ownerDomains = this.ownerDomains();
    this.cachedOwnerAudit = {
      ownerDomains,
      scopeAudits: [
        ...scopeAuditsFromQueryFacts(this.queryFacts(), ownerDomains),
        ...scopeAuditsFromWriteFacts(this.writeScopeFacts(), ownerDomains),
      ],
    };
    return this.cachedOwnerAudit;
  }

  authzCensusDiagnostics(): readonly TouchGraphDiagnostic[] {
    if (this.cachedAuthzCensusDiagnostics) return this.cachedAuthzCensusDiagnostics;
    const tables: ExtractedTable[] = [];
    for (const file of this.contextFiles()) {
      for (const entries of this.tablesForFile(file).values()) tables.push(...entries);
    }
    const reachable = requestReachableTableNames({
      queries: this.queryFacts(),
      queryWriteReachability: this.queryWriteReachability(),
      touchGraph: this.touchGraph(),
    });
    appendQueryReadDomainTables(reachable, this.queryFacts(), tables);
    for (const file of this.extraction.files) {
      for (const query of this.queryDefinitionsForFile(file)) {
        const site = `${file.fileName}:${lineForIndex(file.source, query.index)}`;
        for (const table of [...query.tableExpressions, ...query.declaredReadExpressions]) {
          if (table !== UNRESOLVED_READ_SOURCE_EXPRESSION && !reachable.has(table)) {
            reachable.set(table, site);
          }
        }
      }
    }
    this.cachedAuthzCensusDiagnostics = authzCensusDiagnosticsFromTables(tables, reachable);
    return this.cachedAuthzCensusDiagnostics;
  }

  sqlSafetyDiagnostics(): readonly TouchGraphDiagnostic[] {
    if (this.cachedSqlSafetyDiagnostics) return this.cachedSqlSafetyDiagnostics;
    this.cachedSqlSafetyDiagnostics = this.contextFiles()
      .flatMap((file, index) => {
        const sourceFile = this.extraction.sourceFiles[index];
        return sourceFile ? sqlSafetyDiagnosticsForSourceFile(file, sourceFile) : [];
      })
      .sort((left, right) => left.site.localeCompare(right.site));
    return this.cachedSqlSafetyDiagnostics;
  }

  mutationSecretWireDiagnostics(): readonly TouchGraphDiagnostic[] {
    if (this.cachedMutationSecretWireDiagnostics) return this.cachedMutationSecretWireDiagnostics;
    this.cachedMutationSecretWireDiagnostics = this.contextFiles()
      .flatMap((file, index) => {
        const sourceFile = this.extraction.sourceFiles[index];
        if (!sourceFile) return [];
        const columnShapes = {
          ...sourceColumnShapesForTables(this.tablesForFile(file)),
          ...file.columnShapes,
        };
        return mutationSecretWireDiagnosticsForSourceFile(file, sourceFile, columnShapes);
      })
      .sort((left, right) => left.site.localeCompare(right.site));
    return this.cachedMutationSecretWireDiagnostics;
  }

  touchGraph(): TouchGraph {
    if (this.cachedTouchGraph) return this.cachedTouchGraph;
    const functions = this.functionExtractionsByFileName();
    this.cachedTouchGraph = extractTouchGraphFromPreparedFiles(
      this.extraction.files,
      (file) => projectFunctionsForFile(file, functions),
      this.sourceContext(),
      projectUnresolvedConditionalTableExpressions(this.extraction),
      (file) => this.tablesForFile(file),
    );
    return this.cachedTouchGraph;
  }

  materializedViewRefreshFacts(): readonly MaterializedViewRefreshFact[] {
    if (this.cachedMaterializedViewRefreshFacts) return this.cachedMaterializedViewRefreshFacts;
    const facts: MaterializedViewRefreshFact[] = [];
    const functions = this.functionExtractionsByFileName();

    for (const file of this.contextFiles()) {
      const fileTables = this.tablesForFile(file);
      for (const fn of projectFunctionsForFile(file, functions)) {
        if (fn.summaryOnly) continue;
        facts.push(...materializedViewRefreshFactsForFunction(fn, file, fileTables));
      }
    }

    this.cachedMaterializedViewRefreshFacts = facts.sort(
      (left, right) =>
        left.mutation.localeCompare(right.mutation) ||
        left.view.localeCompare(right.view) ||
        left.domain.localeCompare(right.domain) ||
        left.site.localeCompare(right.site),
    );
    return this.cachedMaterializedViewRefreshFacts;
  }

  massAssignmentFacts(): readonly MassAssignmentFact[] {
    this.cachedMassAssignmentFacts ??= extractMassAssignmentFromProjectExtraction(this.extraction);
    return this.cachedMassAssignmentFacts;
  }

  queryWriteReachability(): readonly QueryWriteReachabilityFact[] {
    this.cachedQueryWriteReachability ??= extractQueryWriteReachabilityFromProjectExtraction(
      this.extraction,
    );
    return this.cachedQueryWriteReachability;
  }

  toctouFacts(): readonly ToctouFact[] {
    this.cachedToctouFacts ??= extractToctouFromProjectExtraction(this.extraction);
    return this.cachedToctouFacts;
  }

  staticBuildAnalysisFacts(): StaticBuildAnalysisFacts {
    if (this.cachedStaticBuildAnalysisFacts) return this.cachedStaticBuildAnalysisFacts;
    const queries = this.queryFacts();
    const ownerAudit = this.ownerAudit();
    this.cachedStaticBuildAnalysisFacts = {
      massAssignmentFacts: this.massAssignmentFacts(),
      ownerDomains: ownerAudit.ownerDomains,
      queries,
      queryWriteReachability: this.queryWriteReachability(),
      scopeAudits: ownerAudit.scopeAudits,
      sqlSafetyDiagnostics: [
        ...this.sqlSafetyDiagnostics(),
        ...diagnosticsForQueryFacts(queries),
        ...this.mutationSecretWireDiagnostics(),
        ...this.authzCensusDiagnostics(),
      ],
      toctouFacts: this.toctouFacts(),
      touchGraph: this.touchGraph(),
    };
    return this.cachedStaticBuildAnalysisFacts;
  }

  private queryDefinitionsForFile(file: SourceFileInput): readonly ExtractedQueryDefinition[] {
    const cached = this.queryDefinitionsByFileName.get(file.fileName);
    if (cached) return cached;

    const index = this.extraction.files.findIndex(
      (candidate) => candidate.fileName === file.fileName,
    );
    const sourceFile = this.extraction.sourceFiles[index];
    if (!sourceFile) return [];

    const definitions = extractProjectQueryDefinitions(sourceFile, {
      ...(file.columnShapes ? { columnShapes: file.columnShapes } : {}),
      localFunctionReceiverParameters: functionReceiverParametersByKey(
        (this.functionExtractionsByFileName().get(file.fileName) ?? new Map()).values(),
      ),
      namespaceTableNames: this.namespaceTableNamesForSourceFile(sourceFile, file.fileName),
      relationalTableNames: this.relationalTableNamesForSourceFile(sourceFile, file.fileName),
      relationCardinalities: this.relationCardinalities(),
      relationTargetTableNames: this.relationTargetTableNames(),
      unmodeledRelationNamesBySymbol: this.extraction.unmodeledRelationNamesBySymbol,
      tableNamesBySymbol: this.extraction.tableNamesBySymbol,
    });
    this.queryDefinitionsByFileName.set(file.fileName, definitions);
    return definitions;
  }

  private namespaceTableNamesForSourceFile(
    sourceFile: SourceFile,
    fileName: string,
  ): ReturnType<typeof projectNamespaceTableNamesByLocal> {
    const cached = this.namespaceTableNamesByFileName.get(fileName);
    if (cached) return cached;
    const namespaceTableNames = projectNamespaceTableNamesByLocal(
      sourceFile,
      this.extraction.tableNamesBySymbol,
    );
    this.namespaceTableNamesByFileName.set(fileName, namespaceTableNames);
    return namespaceTableNames;
  }

  private relationalTableNamesForSourceFile(
    sourceFile: SourceFile,
    fileName: string,
  ): ReturnType<typeof projectRelationalTableNamesByProperty> {
    const cached = this.relationalTableNamesByFileName.get(fileName);
    if (cached) return cached;
    const relationalTableNames = projectRelationalTableNamesByProperty(
      sourceFile,
      this.extraction.tableNamesBySymbol,
    );
    this.relationalTableNamesByFileName.set(fileName, relationalTableNames);
    return relationalTableNames;
  }
}

/** @internal */ export function createDrizzleAnalysisContext(
  extraction: ProjectExtraction,
): DrizzleAnalysisContext {
  return { extraction, facts: new LazyDrizzleFactStore(extraction) };
}

/**
 * Build-facing aggregate for SPEC §11.1/§11.4 static security facts. It creates
 * one ts-morph project/type-checker and shares it across every project-mode
 * drizzle pass used by `kovo build`, preserving each individual gate while
 * avoiding repeated binding of the same app and Drizzle type graph.
 *
 * @internal
 */
/** @internal */ export function extractStaticBuildAnalysisFactsFromProject(
  options: TouchGraphProjectOptions,
): StaticBuildAnalysisFacts {
  // SPEC §11.1: share one syntactic parse cache across every project-mode pass in this
  // build-facing run so the same ~14/7 app files are parsed once, not re-parsed per pass.
  return runWithSourceFileParseCache(() => {
    const extraction = createProjectExtraction(options);
    try {
      return extractStaticBuildAnalysisFactsFromAnalysisContext(
        createDrizzleAnalysisContext(extraction),
      );
    } finally {
      extraction.dispose();
    }
  });
}

/** @internal */ export function extractStaticBuildAnalysisFactsFromAnalysisContext(
  context: DrizzleAnalysisContext,
): StaticBuildAnalysisFacts {
  return context.facts.staticBuildAnalysisFacts();
}

// SPEC.md §11.1 (v1 scope): query-fact extraction requires project-mode ts-morph type
// proof. The source-mode entry point and its heuristic query/function/table producers
// were removed in v1-cleanup item 4; callers must supply project-derived queries,
// context files, SourceModuleContext, and ExtractedFunction[].
function extractQueryFactsFromPreparedFiles(
  files: readonly SourceFileInput[],
  queriesForFile: (file: SourceFileInput) => readonly ExtractedQueryDefinition[],
  contextFiles: readonly SourceFileInput[],
  sourceContext: SourceModuleContext,
  functionsForFile: (file: SourceFileInput) => ExtractedFunction[],
  tablesForContextFile: (file: SourceFileInput) => ReturnType<typeof tablesForFile> = (file) =>
    tablesForFile(file, sourceContext),
): QueryFact[] {
  const facts: QueryFact[] = [];
  const unresolvedIdentifiers = unresolvedConditionalIdentifiersForFiles(
    contextFiles,
    sourceContext,
    tablesForContextFile,
  );

  for (const [index, file] of files.entries()) {
    const contextFile = contextFiles[index] ?? file;
    const fileTables = tablesForContextFile(contextFile);
    const helperSummaries = functionTouchSummariesForFile(
      file,
      functionsForFile(file),
      fileTables,
      unresolvedIdentifiers,
    );
    const columnShapes = {
      ...sourceColumnShapesForTables(fileTables),
      ...contextFile.columnShapes,
      ...file.columnShapes,
    };
    for (const query of queriesForFile({ ...file, columnShapes })) {
      const site = `${file.fileName}:${lineForIndex(file.source, query.index)}`;
      const localHelperSummary = localQueryHelperSummary(query.localHelperCalls, helperSummaries);
      const reads = queryReadDomains(query.tableExpressions, fileTables);
      const declaredReads = queryReadDomains(query.declaredReadExpressions, fileTables);
      const helperReads = localHelperSummary.reads.map((read) =>
        extractedDomainKey(read.table.domain),
      );
      const readOnlyDomains = [
        ...new Set([
          ...queryReadOnlyDomains(query.tableExpressions, fileTables),
          ...queryReadOnlyDomains(query.declaredReadExpressions, fileTables),
          ...localHelperSummary.reads
            .filter((read) => read.table.readOnly === true)
            .map((read) => extractedDomainKey(read.table.domain)),
        ]),
      ].sort();
      // SPEC §11.1: fold every read-set source — `.from()`-derived tables, declared `reads:` table
      // identifiers, declared `reads:` Domain VALUES (§10.2), and local-helper reads. Declared
      // domain values resolve directly to their key (no table lookup), so a `reads: [domain('x')]`
      // declaration drives invalidation instead of being decorative.
      const allReads = [
        ...new Set([...reads, ...declaredReads, ...query.declaredReadDomains, ...helperReads]),
      ].sort();
      const instanceKey = queryInstanceKey(query.instanceKeyComparisons, fileTables);
      const sessionAnchoredReads = querySessionAnchoredDomains(
        query.instanceKeyComparisons,
        fileTables,
      );
      const ownerScopedSessionReads = queryOwnerSessionAnchoredDomains(
        query.instanceKeyComparisons,
        fileTables,
      );
      const ownerScopedPrivateReadKeys = queryOwnerPrivateScopedKeys(
        query.instanceKeyComparisons,
        fileTables,
      );
      // A3 (SPEC §10.3): the supplemental owner-column arg signal. Omit any domain the
      // declared-key `instanceKey` already captures as `arg:*` — that domain is already
      // flagged `args` by `scopeAuditsFromQueryFacts`, so listing it here too would only
      // add redundant output. `argScopedReads` carries the cases the declared-key path
      // misses (an arg keyed on an owner column other than `key:`).
      const argScopedReads = queryArgScopedDomains(query.instanceKeyComparisons, fileTables).filter(
        (domain) =>
          !(
            instanceKey?.instanceKey?.domain === domain &&
            instanceKey.instanceKey.key.startsWith('arg:')
          ),
      );
      const argScopedReadKeys = queryArgScopedDomainKeys(
        query.instanceKeyComparisons,
        fileTables,
      ).filter(
        (scoped) =>
          !(
            instanceKey?.instanceKey?.domain === scoped.domain &&
            instanceKey.instanceKey.key === scoped.key
          ),
      );
      // SPEC §10.3 / KV414 join-keyed bypass: does the predicate key any table column
      // (owner or not) by a client `input.*` arg? An owner table joined into the read
      // set but keyed only through a non-owner table's arg is still client-pivotable;
      // `scopeAuditsFromQueryFacts` fails it closed to `args` when the owner domain is
      // neither directly arg-keyed nor session/`owns()`-scoped.
      const hasClientArgPredicate = queryHasClientArgPredicate(query.instanceKeyComparisons);
      const ownerReadDomains = ownerDomainSetFromTables(fileTables);
      const readProvenance = queryReadProvenanceFacts({
        argScopedReadKeys,
        argScopedReads,
        columnShapes,
        declaredReadDomains: query.declaredReadDomains,
        declaredReadExpressions: query.declaredReadExpressions,
        hasClientArgPredicate,
        helperReads: localHelperSummary.reads,
        ...(instanceKey?.instanceKey === undefined ? {} : { instanceKey: instanceKey.instanceKey }),
        ownerReadDomains,
        ownerScopedPrivateReadKeys,
        projectedColumns: query.projectedColumns,
        queryTableExpressions: query.tableExpressions,
        sessionAnchoredReads,
        site,
        tables: fileTables,
      });
      // SPEC §10.2: a `reads:` entry naming an `exempt` table is KV411 — checked over BOTH the
      // `.from()`-derived read set AND the author's declared `reads:` table set, so an exempt/outbox
      // read cannot be smuggled past the static pass through a declared `reads:` entry either.
      const exemptReadDiagnostics = exemptQueryReadDiagnostics(
        [...query.tableExpressions, ...query.declaredReadExpressions],
        fileTables,
        site,
      );
      const diagnostics = opaqueProjectionDiagnostics(
        query.query,
        query.opaquePaths,
        site,
        query.hasOutputSchema,
        // SPEC §10.2 (F2 fix #1, plans/compiler-soundness.md): an opaque projection with an `output`
        // schema but NO declared `reads:` set is still a KV410 error. The declared `reads:` set is the
        // only typed-table fact (hard-rule #9) that exposes a secret/exempt table referenced solely in
        // raw SQL text to the confidentiality backstop, so its absence must fail the build closed.
        // A declared `reads:` Domain VALUE counts as a declaration too (§10.2 `reads: readonly Domain[]`).
        query.declaredReadExpressions.length > 0 || query.declaredReadDomains.length > 0,
      )
        .concat(secretProjectionBackstopDiagnostics(query.query, readProvenance, query.shape))
        .concat(tableRowProjectionDiagnostics(query.query, query.shape, site))
        .concat(unresolvedProjectionDiagnostics(query.query, query.unresolvedPaths, site))
        .concat(query.diagnostics?.map((diagnostic) => ({ ...diagnostic, site })) ?? [])
        .concat(unmodeledRelationReadDiagnostics(query.tableExpressions, fileTables, site))
        .concat(exemptReadDiagnostics)
        // SPEC §10.2/§11.1: an opaque/raw read that takes the declared-opaque-read escape but whose
        // `reads:` resolves to NO domain has an empty folded read set — silent staleness. KV411 is
        // the more specific diagnostic for an exempt declared read, so suppress this when it fired.
        .concat(
          exemptReadDiagnostics.length > 0
            ? []
            : opaqueReadWithoutResolvableReadsDiagnostics(
                query.query,
                query.hasOutputSchema,
                query.declaredReadExpressions,
                query.declaredReadDomains,
                allReads,
                site,
              ),
        )
        .concat(localQueryHelperDiagnostics(localHelperSummary));
      if (!query.hasSelection && allReads.length === 0 && diagnostics.length === 0) continue;

      facts.push({
        ...(argScopedReads.length > 0 ? { argScopedReads } : {}),
        ...(argScopedReadKeys.length > 0 ? { argScopedReadKeys } : {}),
        ...(query.instanceKeyComparisons.acceptedGuardPrivateKeys?.length
          ? { acceptedGuardPrivateKeys: query.instanceKeyComparisons.acceptedGuardPrivateKeys }
          : {}),
        ...(diagnostics.length > 0 ? { diagnostics } : {}),
        ...(hasClientArgPredicate ? { hasClientArgPredicate } : {}),
        ...instanceKey,
        ...(ownerScopedPrivateReadKeys.length > 0 ? { ownerScopedPrivateReadKeys } : {}),
        ...(ownerScopedSessionReads.length > 0 ? { ownerScopedSessionReads } : {}),
        query: query.query,
        ...(readProvenance.length > 0 ? { readProvenance } : {}),
        reads: allReads,
        ...(readOnlyDomains.length > 0 ? { readOnlyDomains } : {}),
        ...(sessionAnchoredReads.length > 0 ? { sessionAnchoredReads } : {}),
        shape: query.shape,
        site,
      });
    }
  }

  return facts.sort((left, right) => left.query.localeCompare(right.query));
}

function secretProjectionBackstopDiagnostics(
  query: string,
  readProvenance: readonly QueryReadProvenance[],
  shape: QueryShape,
): TouchGraphDiagnostic[] {
  const revealedPaths = revealedQueryShapePaths(shape);
  const diagnostics: TouchGraphDiagnostic[] = [];

  for (const read of readProvenance) {
    for (const column of read.columns) {
      if (revealedPaths.has(column.path)) continue;
      if (column.classification !== 'secret' && column.classification !== 'unresolved') continue;

      diagnostics.push(
        drizzleDiagnostic({
          code: 'KV435',
          detail: `Query projection ${query}.${column.path} reads a secret-classified column or unresolved projection from secret-classified table(s): ${column.table}. Prove the read stays off the query wire, select explicit non-secret columns, or wrap a reviewed projection in trustedReveal(...).`,
          site: column.site || read.site,
        }),
      );
    }
  }

  return dedupeDiagnostics(diagnostics);
}

interface QueryReadProvenanceFactsInput {
  argScopedReadKeys: readonly OwnerScopeKey[];
  argScopedReads: readonly string[];
  columnShapes: Readonly<Record<string, QueryShape>>;
  declaredReadDomains: readonly string[];
  declaredReadExpressions: readonly string[];
  hasClientArgPredicate: boolean;
  helperReads: readonly ReadSummaryInput[];
  instanceKey?: {
    domain: string;
    key: string;
  };
  ownerReadDomains: ReadonlySet<string>;
  ownerScopedPrivateReadKeys: readonly OwnerPrivateScopeKey[];
  projectedColumns: readonly QueryProjectedColumn[];
  queryTableExpressions: readonly string[];
  sessionAnchoredReads: readonly string[];
  site: string;
  tables: ReadonlyMap<string, readonly ExtractedTable[]>;
}

function queryReadProvenanceFacts(input: QueryReadProvenanceFactsInput): QueryReadProvenance[] {
  const facts: QueryReadProvenance[] = [];
  const directTableExpressions = new Set(input.queryTableExpressions);
  const declaredTableExpressions = input.declaredReadExpressions.filter(
    (table) => !directTableExpressions.has(table),
  );

  facts.push(
    ...queryReadProvenanceFromTableExpressions({
      ...input,
      source: 'select',
      tableExpressions: [...directTableExpressions],
    }),
  );
  facts.push(
    ...queryReadProvenanceFromTableExpressions({
      ...input,
      source: 'declared',
      tableExpressions: declaredTableExpressions,
    }),
  );
  facts.push(...queryReadProvenanceFromDeclaredDomains(input));

  for (const read of input.helperReads) {
    const domain = extractedDomainKey(read.table.domain);
    const columns = secretProjectedColumnsForRead({
      columnShapes: input.columnShapes,
      projectedColumns: [],
      readSite: read.site,
      source: 'helper',
      table: read.table,
      tableExpression: read.table.name,
    });
    if (columns.length === 0 && !input.ownerReadDomains.has(domain)) continue;

    const ownerScopes = ownerQueryReadScopesForDomain(input, domain);
    const firstOwnerScope = ownerScopes[0];
    const scopes =
      read.scope !== undefined
        ? [read.scope]
        : firstOwnerScope && ownerScopes.length === 1 && firstOwnerScope.kind === 'unscoped'
          ? [readScopeFromKey(read.readKey)]
          : ownerScopes;
    for (const scope of scopes) {
      facts.push({
        columns,
        domain,
        keys: read.readKey ?? null,
        scope,
        site: read.site,
        source: 'helper',
        via: read.table.name,
      });
    }
  }

  return dedupeQueryReadProvenance(facts);
}

function queryReadProvenanceFromTableExpressions(
  input: QueryReadProvenanceFactsInput & {
    source: QueryReadProvenance['source'];
    tableExpressions: readonly string[];
  },
): QueryReadProvenance[] {
  const facts: QueryReadProvenance[] = [];

  for (const tableExpression of input.tableExpressions) {
    for (const table of input.tables.get(tableExpression) ?? []) {
      if (!isDomainExtractedTableAnnotation(table.annotation)) continue;
      const domain = extractedDomainKey(table.annotation.domain);
      const columns = secretProjectedColumnsForRead({
        columnShapes: input.columnShapes,
        projectedColumns: input.projectedColumns,
        readSite: input.site,
        source: input.source,
        table: table.annotation,
        tableExpression,
      });
      const ownerRead = input.ownerReadDomains.has(domain);
      if (columns.length === 0 && !ownerRead) continue;

      const keys = input.instanceKey?.domain === domain ? input.instanceKey.key : null;
      for (const scope of ownerQueryReadScopesForDomain(input, domain)) {
        facts.push({
          columns,
          domain,
          keys,
          scope,
          site: input.site,
          source: input.source,
          via: table.annotation.name,
        });
      }
    }
  }

  return facts;
}

function queryReadProvenanceFromDeclaredDomains(
  input: QueryReadProvenanceFactsInput,
): QueryReadProvenance[] {
  return input.declaredReadDomains
    .filter((domain) => input.ownerReadDomains.has(domain))
    .flatMap((domain) =>
      ownerQueryReadScopesForDomain(input, domain).map((scope) => ({
        columns: [],
        domain,
        keys: input.instanceKey?.domain === domain ? input.instanceKey.key : null,
        scope,
        site: input.site,
        source: 'declared' as const,
        via: domain,
      })),
    );
}

function ownerQueryReadScopesForDomain(
  input: QueryReadProvenanceFactsInput,
  domain: string,
): QueryReadScopeProvenance[] {
  const argKeys = queryReadArgKeysForDomain(input, domain);
  if (argKeys.length > 0) {
    return argKeys.map(
      (key): QueryReadScopeProvenance => (key ? { key, kind: 'arg' } : { kind: 'arg' }),
    );
  }

  const privateKey = input.ownerScopedPrivateReadKeys.find(
    (scoped) => scoped.domain === domain,
  )?.privateKey;
  if (privateKey) return [privateScopeFromKey(privateKey, true)];

  if (input.ownerReadDomains.has(domain) && input.hasClientArgPredicate) return [{ kind: 'arg' }];
  if (input.sessionAnchoredReads.includes(domain))
    return [privateScopeFromKey('session:<unknown>')];
  if (input.instanceKey?.domain === domain) return [readScopeFromKey(input.instanceKey.key)];
  return [{ kind: 'unscoped' }];
}

function queryReadArgKeysForDomain(input: QueryReadProvenanceFactsInput, domain: string): string[] {
  if (input.instanceKey?.domain === domain && input.instanceKey.key.startsWith('arg:')) {
    return [input.instanceKey.key];
  }
  const keys = input.argScopedReadKeys
    .filter((candidate) => candidate.domain === domain)
    .map((candidate) => candidate.key);
  if (keys.length > 0) return [...new Set(keys)].sort();
  if (input.argScopedReads.includes(domain)) return [''];
  return [];
}

function secretProjectedColumnsForRead(input: {
  columnShapes: Readonly<Record<string, QueryShape>>;
  projectedColumns: readonly QueryProjectedColumn[];
  readSite: string;
  source: QueryReadProvenance['source'];
  table: { name: string };
  tableExpression: string;
}): QueryProjectedColumn[] {
  const secretTable = tableHasSecretColumn(input.columnShapes, input.tableExpression);
  const columns = input.projectedColumns
    .filter((column) =>
      projectedColumnBelongsToRead(column, input.tableExpression, input.table.name),
    )
    .flatMap((column) => {
      if (column.classification === 'secret') {
        return [{ ...column, table: input.table.name }];
      }
      if (secretTable && (column.projection === 'opaque' || column.projection === 'unresolved')) {
        return [
          {
            ...column,
            classification: 'unresolved' as const,
            table: input.table.name,
          },
        ];
      }
      return [];
    });

  if (columns.length > 0) return dedupeProjectedColumns(columns);
  if (!secretTable || input.source !== 'helper') return [];

  return [
    {
      classification: 'unresolved',
      path: '$',
      projection: 'unresolved',
      site: input.readSite,
      table: input.table.name,
    },
  ];
}

function projectedColumnBelongsToRead(
  column: QueryProjectedColumn,
  tableExpression: string,
  tableName: string,
): boolean {
  return column.table === '' || column.table === tableExpression || column.table === tableName;
}

function readScopeFromKey(key: string | undefined): QueryReadScopeProvenance {
  if (!key) return { kind: 'unscoped' };
  if (key.startsWith('arg:')) return { key, kind: 'arg' };
  if (key.startsWith('guard:')) return { key, kind: 'guard' };
  if (key.startsWith('tenant:')) return { key, kind: 'tenant' };
  return { key, kind: 'session' };
}

function dedupeQueryReadProvenance(facts: readonly QueryReadProvenance[]): QueryReadProvenance[] {
  return [...new Map(facts.map((fact) => [queryReadProvenanceKey(fact), fact])).values()].sort(
    (left, right) =>
      left.domain.localeCompare(right.domain) ||
      left.via.localeCompare(right.via) ||
      left.source.localeCompare(right.source) ||
      left.site.localeCompare(right.site),
  );
}

function queryReadProvenanceKey(fact: QueryReadProvenance): string {
  return [
    fact.domain,
    fact.via,
    fact.source,
    fact.keys ?? '',
    JSON.stringify(fact.scope),
    fact.site,
    JSON.stringify(fact.columns),
  ].join('\0');
}

function dedupeProjectedColumns(columns: readonly QueryProjectedColumn[]): QueryProjectedColumn[] {
  return [...new Map(columns.map((column) => [projectedColumnKey(column), column])).values()].sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.table.localeCompare(right.table) ||
      (left.column ?? '').localeCompare(right.column ?? '') ||
      left.projection.localeCompare(right.projection),
  );
}

function projectedColumnKey(column: QueryProjectedColumn): string {
  return [
    column.path,
    column.table,
    column.column ?? '',
    column.classification,
    column.projection,
    column.site,
  ].join('\0');
}

function dedupeDiagnostics(diagnostics: readonly TouchGraphDiagnostic[]): TouchGraphDiagnostic[] {
  return [
    ...new Map(diagnostics.map((diagnostic) => [diagnosticKey(diagnostic), diagnostic])).values(),
  ];
}

function diagnosticKey(diagnostic: TouchGraphDiagnostic): string {
  return [diagnostic.code, diagnostic.message, diagnostic.site].join('\0');
}

function tableRowProjectionDiagnostics(
  query: string,
  shape: QueryShape,
  site: string,
): TouchGraphDiagnostic[] {
  return tableRowQueryShapePaths(shape).map((path) =>
    drizzleDiagnostic({
      code: 'KV439',
      detail: `Query projection ${pathForQueryDiagnostic(query, path)} carries table-row provenance; select explicit fields instead.`,
      site,
    }),
  );
}

function pathForQueryDiagnostic(query: string, path: string): string {
  return path === '$' ? query : `${query}.${path}`;
}

function secretBackstopTableDisplayNames(
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
  table: string,
): string[] {
  const entries = tables.get(table) ?? [];
  const names = entries
    .map((entry) => ('name' in entry.annotation ? entry.annotation.name : undefined))
    .filter((name): name is string => name !== undefined);
  return names.length > 0 ? names : [table];
}

function tableHasSecretColumn(
  columnShapes: Readonly<Record<string, QueryShape>>,
  table: string,
): boolean {
  const prefix = `${table}.`;
  return Object.entries(columnShapes).some(
    ([path, shape]) => path.startsWith(prefix) && queryShapeContainsSecret(shape),
  );
}

function unresolvedConditionalIdentifiersForFiles(
  files: readonly SourceFileInput[],
  sourceContext: SourceModuleContext,
  tablesForContextFile: (file: SourceFileInput) => ReturnType<typeof tablesForFile> = (file) =>
    tablesForFile(file, sourceContext),
): Set<string> {
  const unresolvedIdentifiers = new Set<string>();

  for (const file of files) {
    const fileTables = tablesForContextFile(file);
    for (const identifier of extractUnresolvedConditionalIdentifiers(file, fileTables)) {
      unresolvedIdentifiers.add(identifier);
    }
  }

  return unresolvedIdentifiers;
}

function localQueryHelperSummary(
  helperCalls: readonly string[],
  helperSummaries: ReadonlyMap<string, FunctionTouchSummary>,
): FunctionTouchSummary {
  const summary: FunctionTouchSummary = { reads: [], unresolved: [], writes: [] };

  for (const call of helperCalls) {
    const helperSummary = helperSummaries.get(call);
    if (helperSummary) mergeSummary(summary, helperSummary);
  }

  return summary;
}

function localQueryHelperDiagnostics(summary: FunctionTouchSummary): TouchGraphDiagnostic[] {
  const diagnostics: TouchGraphDiagnostic[] = [];

  for (const write of summary.writes) {
    diagnostics.push(
      drizzleDiagnostic({
        code: 'KV406',
        detail: `Query local helper touches Drizzle table via ${write.operation}().`,
        site: write.site,
      }),
    );
  }

  for (const unresolved of summary.unresolved) {
    diagnostics.push(
      drizzleDiagnostic({
        code: 'KV406',
        detail: `Query local helper has unresolved Drizzle ${unresolved.operation}().`,
        site: unresolved.site,
      }),
    );
  }

  return diagnostics;
}

/** @internal */ export interface ExtractedFunction {
  bodyStart: number;
  key: string;
  localCalls: readonly string[];
  name: string;
  readCalls: readonly ExtractedReadCall[];
  receiverNames: readonly string[];
  receiverParameters: readonly ReceiverParameterRequirement[];
  summaryOnly?: boolean;
  unresolvedCalls: readonly ExternalDbArgumentCall[];
  writeCalls: readonly ExtractedWriteCall[];
}

/** @internal */ export interface ReceiverParameterRequirement {
  index: number;
  names: readonly string[];
  symbolKeys: readonly string[];
}

/** @internal */ export interface ExtractedQueryDefinition {
  /**
   * SPEC §10.2/§11.1: declared `reads:` entries that resolved to a Drizzle table identifier (the
   * `.from()`-derived/test-harness form). Folded into the read set via `queryReadDomains` against
   * the file's table facts.
   */
  declaredReadExpressions: readonly string[];
  /**
   * SPEC §10.2/§11.1: declared `reads:` entries that resolved to a `Domain` VALUE
   * (`domain('x')`/`tag('x')`) — the canonical app form, since `reads:` is `readonly Domain[]`.
   * These are domain keys folded DIRECTLY into the read set (no table lookup), so a declared domain
   * drives invalidation instead of being decorative.
   */
  declaredReadDomains: readonly string[];
  diagnostics?: readonly TouchGraphDiagnostic[];
  hasOutputSchema: boolean;
  hasSelection: boolean;
  index: number;
  instanceKeyComparisons: QueryInstanceKeyComparisons;
  localHelperCalls: readonly string[];
  opaquePaths: readonly string[];
  projectedColumns: readonly QueryProjectedColumn[];
  query: string;
  shape: QueryShape;
  tableExpressions: readonly string[];
  unresolvedPaths: readonly string[];
}

/** @internal */ export interface QueryInstanceKeyComparison {
  left: QueryInstanceKeyOperand;
  right: QueryInstanceKeyOperand;
}

/** @internal */ export interface QueryInstanceKeyOperand {
  inputKey?: string;
  privateKey?: string;
  sessionKey?: string;
  tableKey?: {
    key: string;
    tableIdentifier: string;
  };
}

/** @internal */ export type PrivateScopeKind = 'guard' | 'session' | 'tenant';

/** @internal */ export interface PrivateScopeProvenance {
  kind: PrivateScopeKind;
  path: string;
  requiresGuard?: boolean;
}

/** @internal */ export interface SessionAlias {
  declaration: Node;
  kind: PrivateScopeKind;
  name: string;
  path: string;
  requiresGuard: boolean;
}

/** @internal */ export interface SessionProvenanceContext {
  acceptedGuardPrivateKeys?: ReadonlySet<string>;
  aliases: ReadonlyMap<string, SessionAlias>;
  helpers: ReadonlyMap<string, PrivateScopeProvenance>;
  opaqueAliases: Map<string, string>;
}

/** @internal */ export interface ExtractedWriteCall {
  index: number;
  /**
   * The write `where()` predicate operand comparisons, classified the same way as
   * query reads (SPEC §10.3, KV414 A1/A2/A3): `argCandidates` carries every `eq`
   * operand pair (incl. `and()`/`or()` branches) so an owner-table column compared
   * against a client `input.*` arg surfaces as an `args`-scope write candidate.
   */
  instanceKeyComparisons: QueryInstanceKeyComparisons;
  operation: string;
  predicateFacts: readonly ExtractedPredicateFact[];
  readSources: ExtractedReadSource[];
  site?: string;
  tableExpression: string;
}

/** @internal */ export interface ExtractedReadSource {
  operation: 'delete-predicate' | 'insert-select' | 'update-from' | 'update-predicate';
  tableExpression: string;
}

/** @internal */ export interface ExtractedReadCall {
  index: number;
  operation: 'relational-query' | 'select';
  site?: string;
  tableExpression: string;
}

/** @internal */ export interface ExtractedPredicateSummary {
  key?: string;
  predicate?: 'non-eq';
}

/** @internal */ export interface ExtractedPredicateFact {
  argumentKey?: string;
  key: string;
  predicate?: 'non-eq';
  tableIdentifier: string;
}

/** @internal */ export interface FunctionTouchSummary {
  rawTables?: string[];
  reads: ReadSummaryInput[];
  unresolved: UnresolvedSummaryInput[];
  writes: WriteSummaryInput[];
}

interface ProjectQueryDefinitionOptions {
  columnShapes?: Readonly<Record<string, QueryShape>>;
  localFunctionReceiverParameters?: ReadonlyMap<string, readonly ReceiverParameterRequirement[]>;
  namespaceTableNames: ProjectNamespaceTableNames;
  relationCardinalities: ReadonlyMap<string, 'many' | 'one'>;
  relationTargetTableNames: ReadonlyMap<string, string>;
  relationalTableNames: ReadonlyMap<string, string>;
  tableNamesBySymbol: ReadonlyMap<string, string>;
  unmodeledRelationNamesBySymbol: ReadonlyMap<string, string>;
}

function extractProjectQueryDefinitions(
  sourceFile: SourceFile,
  options: ProjectQueryDefinitionOptions,
): ExtractedQueryDefinition[] {
  const resolveTableIdentifier = (node: Node) =>
    projectTableNameForNode(node, options.tableNamesBySymbol, options.namespaceTableNames) ??
    projectUnmodeledRelationNameForNode(node, options.unmodeledRelationNamesBySymbol);

  return extractQueryDefinitionsFromSourceFile(sourceFile, {
    ...(options.columnShapes ? { columnShapes: options.columnShapes } : {}),
    ...(options.localFunctionReceiverParameters
      ? { localFunctionReceiverParameters: options.localFunctionReceiverParameters }
      : {}),
    readTableIdentifier: resolveTableIdentifier,
    receiverMode: 'project',
    relationalRelationCardinality: (name) => options.relationCardinalities.get(name),
    relationalRelationTableName: (name) => options.relationTargetTableNames.get(name),
    relationalTableName: (name) => options.relationalTableNames.get(name),
  });
}

interface QueryDefinitionOptions {
  columnShapes?: Readonly<Record<string, QueryShape>>;
  localFunctionReceiverParameters?: ReadonlyMap<string, readonly ReceiverParameterRequirement[]>;
  readTableIdentifier?: (node: Node) => string | undefined;
  receiverMode?: 'project' | 'source';
  relationalRelationCardinality?: (name: string) => 'many' | 'one' | undefined;
  relationalRelationTableName?: (name: string) => string | undefined;
  relationalTableName?: (name: string) => string | undefined;
}

function extractQueryDefinitionsFromSourceFile(
  sourceFile: SourceFile,
  options: QueryDefinitionOptions = {},
): ExtractedQueryDefinition[] {
  const definitions: ExtractedQueryDefinition[] = [];
  // SPEC §11.1 (v1 scope): local query-helper receiver requirements are supplied by the project
  // pipeline (functionReceiverParametersByKey); there is no source-mode fallback. When a caller
  // omits them (e.g. a query with no local helpers), an empty map is the correct project view.
  const localFunctionsByKey: ReadonlyMap<string, readonly ReceiverParameterRequirement[]> =
    options.localFunctionReceiverParameters ?? new Map();
  const localFunctionKeys = new Set(localFunctionsByKey.keys());

  for (const declaration of sourceFile.getVariableDeclarations()) {
    const statement = declaration.getVariableStatement();
    if (!statement || statement.getDeclarationKind() !== 'const') continue;

    const initializer = declaration.getInitializer();
    if (!initializer) continue;
    const queryCall = unwrappedStaticExpressionNode(initializer);
    if (!Node.isCallExpression(queryCall)) continue;

    // SPEC §11.1 (bugz-3 H1): resolve `query` to its @kovojs/server binding (bare/alias/namespace)
    // so an aliased or namespaced loader still yields QueryFacts and KV435/KV414/KV410/KV406 stay engaged.
    const queryDeclaration = staticQueryDeclarationFromCall(declaration, queryCall);
    if (!queryDeclaration) continue;

    const { bodyArgument, query } = queryDeclaration;
    // SPEC §11.1 (v1 scope): query facts require project-mode ts-morph type proof; the
    // source-mode receiver/table heuristics were removed in v1-cleanup item 4.
    const receiverMode = options.receiverMode ?? 'project';
    const bodyResolution = queryBodyObjectLiteral(bodyArgument, receiverMode);
    if (!bodyResolution.body) {
      if (bodyResolution.unresolved) {
        definitions.push({
          declaredReadDomains: [],
          declaredReadExpressions: [],
          diagnostics: [unresolvedQueryLoadCallbackDiagnostic(bodyArgument ?? queryCall)],
          hasOutputSchema: false,
          hasSelection: false,
          index: declaration.getStart(),
          instanceKeyComparisons: { argCandidates: [], instanceKey: [] },
          localHelperCalls: [],
          opaquePaths: [],
          projectedColumns: [],
          query,
          shape: {},
          tableExpressions: [],
          unresolvedPaths: [],
        });
      }
      continue;
    }

    const bodyObject = bodyResolution.body;
    const receiverReferences = queryCallbackReceiverReferences(bodyObject, receiverMode);
    // SPEC §11.1 (v1 scope): a destructured loader receiver slot (e.g. `{ db: reader }`) is not
    // type proof. When project mode cannot prove the destructured receiver via TypeScript symbols
    // (it is absent from the proven receiverReferences), it remains a fail-closed KV406 surface
    // rather than feeding read/write extraction. Drop the names project mode already proved so a
    // genuinely-typed destructured receiver (resolved into receiverReferences) does not double-fire.
    const destructuredCandidates = sourceQueryDestructuredReceiverNames(bodyObject);
    const sourceDestructuredReceiverReferences = unprovenDestructuredReceiverReferences(
      destructuredCandidates,
      receiverReferences,
    );
    const selectSelection = selectShapeFromQueryBody(
      bodyObject,
      receiverReferences,
      options.columnShapes,
      receiverMode,
    );
    const relationalSelection =
      selectSelection ??
      relationalShapeFromQueryBody(
        bodyObject,
        receiverReferences,
        options.columnShapes,
        options.relationalRelationTableName,
        options.relationalRelationCardinality,
      );
    const selection = selectSelection ?? relationalSelection;
    const outputShape = queryOutputShape(bodyObject);
    const outputInitializer = objectPropertyInitializer(bodyObject, 'output');
    const shape =
      selection && !isEmptyQueryShape(selection.shape)
        ? selection.shape
        : (outputShape ?? selection?.shape ?? {});
    const projectedColumns = [
      ...wireRelevantProjectedColumnsFromQueryBody(
        bodyObject,
        receiverReferences,
        options.columnShapes,
        receiverMode,
      ),
      ...(selectSelection ? [] : (relationalSelection?.projectedColumns ?? [])),
    ];
    const hasOutputSchema =
      outputShape !== undefined ||
      (outputInitializer !== undefined && Node.isObjectLiteralExpression(outputInitializer));
    const declaredReadExpressions = queryDeclaredReadExpressions(
      bodyObject,
      options.readTableIdentifier,
    );
    // SPEC §10.2/§11.1: `reads:` is `readonly Domain[]`, so the canonical form lists domain VALUES
    // (`domain('x')`). Resolve those to their domain keys so the declaration folds into the read set
    // and drives invalidation instead of being decorative.
    const declaredReadDomains = queryDeclaredReadDomains(bodyObject);
    const declaredOpaqueRead =
      hasOutputSchema && (declaredReadExpressions.length > 0 || declaredReadDomains.length > 0);
    const readResolutionOptions: QueryReadResolutionOptions = {
      ...(options.readTableIdentifier ? { readTableIdentifier: options.readTableIdentifier } : {}),
      ...(options.relationalRelationTableName
        ? { relationalRelationTableName: options.relationalRelationTableName }
        : {}),
      ...(options.relationalTableName ? { relationalTableName: options.relationalTableName } : {}),
    };
    const diagnostics = [
      ...(bodyResolution.unresolved ? [unresolvedQueryLoadCallbackDiagnostic(bodyObject)] : []),
      ...dynamicDeclaredReadsDiagnostics(bodyObject),
      ...unresolvedQueryCallbackDiagnostics(bodyObject, receiverMode),
      ...relationalQueryDiagnostics(bodyObject, receiverReferences),
      ...(declaredOpaqueRead
        ? []
        : unclassifiedQueryReceiverDiagnostics(bodyObject, receiverReferences)),
      ...projectQueryReceiverContainerDiagnostics(bodyObject, receiverReferences),
      ...receiverMethodAliasQueryDiagnostics(bodyObject, receiverReferences),
      ...externalQueryHelperDiagnostics(bodyObject, receiverReferences, localFunctionKeys),
      ...opaqueLocalQueryHelperDiagnostics(bodyObject, receiverReferences, localFunctionsByKey),
      ...unresolvedQueryClosureReadDiagnostics(bodyObject, receiverReferences),
      ...unresolvedQueryReadDiagnostics(bodyObject, receiverReferences, readResolutionOptions),
      // SPEC §11.1 (v1 scope): fail-closed KV406 for a destructured loader receiver slot that
      // project mode could not type-prove. This DETECTOR never produces a positive read/write
      // fact; it flags an un-analyzable Drizzle receiver surface so manual touches are required.
      ...sourceDestructuredQueryReceiverDiagnostics(
        bodyObject,
        localFunctionKeys,
        sourceDestructuredReceiverReferences,
      ),
    ];
    const localHelperCalls = queryLocalHelperCalls(
      bodyObject,
      receiverReferences,
      localFunctionsByKey,
    );
    if (
      !selection &&
      diagnostics.length === 0 &&
      localHelperCalls.length === 0 &&
      !declaredOpaqueRead
    )
      continue;

    definitions.push({
      declaredReadDomains,
      declaredReadExpressions,
      ...(selection?.diagnostics || diagnostics.length > 0
        ? { diagnostics: [...(selection?.diagnostics ?? []), ...diagnostics] }
        : {}),
      hasOutputSchema,
      hasSelection: selection !== null,
      index: declaration.getStart(),
      instanceKeyComparisons: queryInstanceKeyComparisons(
        bodyObject,
        receiverReferences,
        options.readTableIdentifier,
        options.relationalTableName,
      ),
      localHelperCalls,
      opaquePaths: selection?.opaquePaths ?? [],
      projectedColumns,
      query,
      shape,
      tableExpressions: queryTableExpressions(
        bodyObject,
        receiverReferences,
        readResolutionOptions,
      ),
      unresolvedPaths: selection?.unresolvedPaths ?? [],
    });
  }

  return definitions;
}

function dynamicDeclaredReadsDiagnostics(body: ObjectLiteralExpression): TouchGraphDiagnostic[] {
  const readsProperty = body.getProperty('reads');
  if (!Node.isPropertyAssignment(readsProperty)) return [];
  const initializer = readsProperty.getInitializer();
  const reads = initializer ? unwrappedStaticExpressionNode(initializer) : undefined;
  if (!reads) return [];
  if (!Node.isArrayLiteralExpression(reads)) {
    return [dynamicDeclaredReadsDiagnostic(reads)];
  }
  for (const element of reads.getElements()) {
    const expression = unwrappedStaticExpressionNode(element);
    // SPEC §10.2: identifier/property-access references and inline `domain('x')`/`tag('x')` Domain
    // values are static; dynamic or spread entries fail closed as KV410.
    if (isStaticDeclaredReadEntry(expression)) continue;
    return [dynamicDeclaredReadsDiagnostic(expression)];
  }
  return [];
}

function dynamicDeclaredReadsDiagnostic(node: Node): TouchGraphDiagnostic {
  return drizzleDiagnostic({
    code: 'KV410',
    detail:
      'Opaque query reads must be a fully static table list; dynamic or spread reads fail closed.',
    node,
  });
}

/** @internal */ export function tableAnnotation(
  initializer: Node,
): ExtractedTableAnnotation | null {
  if (!Node.isCallExpression(initializer)) return null;
  const annotationCall = initializer.getArguments().find(isKovoAnnotationCall);
  if (!annotationCall) {
    const tableName = tableNameArgument(initializer);
    return tableName
      ? { domain: defaultDomainForTableName(tableName), name: tableName }
      : { name: UNRESOLVED_READ_SOURCE_EXPRESSION, unmapped: true };
  }
  if (!Node.isCallExpression(annotationCall)) return null;
  const annotationObject = annotationCall.getArguments()[0];
  if (!annotationObject || !Node.isObjectLiteralExpression(annotationObject)) return null;

  const tableName = tableNameArgument(initializer) ?? UNRESOLVED_READ_SOURCE_EXPRESSION;
  if (booleanPropertyFromObject(annotationObject, 'exempt') === true) {
    return { exempt: true, name: tableName };
  }
  const domain = domainPropertyFromObject(annotationObject, 'domain');
  if (!domain) return null;
  const key = columnNamePropertyFromObject(annotationObject, 'key');
  const owner = columnNamePropertyFromObject(annotationObject, 'owner');
  const ownerVia = objectPropertyFromObject(annotationObject, 'ownerVia');
  const authzPolicy = propertyExistsOnObject(annotationObject, 'authzPolicy');
  const secret = secretPropertyFromObject(annotationObject);
  const confidentialAtRest = confidentialAtRestPropertyFromObject(annotationObject);
  const governed = governedPropertyFromObject(annotationObject);
  const atomic = concurrencyColumnsFromObject(annotationObject, 'atomic');
  const version = concurrencyColumnsFromObject(annotationObject, 'version');
  const fans = fanAnnotationsFromObject(annotationObject);
  const publicTable = booleanPropertyFromObject(annotationObject, 'public');
  const reference = booleanPropertyFromObject(annotationObject, 'reference');
  const readOnly = booleanPropertyFromObject(annotationObject, 'readOnly');
  return {
    domain,
    ...(atomic === undefined ? {} : { atomic }),
    ...(authzPolicy ? { authzPolicy: true } : {}),
    ...(confidentialAtRest === undefined ? {} : { confidentialAtRest }),
    ...(fans.length > 0 ? { fans } : {}),
    ...(governed === undefined ? {} : { governed }),
    ...(key ? { key } : {}),
    ...(owner ? { owner } : {}),
    ...(ownerVia === undefined ? {} : { ownerVia: true as never }),
    ...(publicTable === true ? { public: true as const } : {}),
    ...(readOnly === true ? { readOnly } : {}),
    ...(reference === true ? { reference: true as const } : {}),
    ...(secret === undefined ? {} : { secret }),
    ...(version === undefined ? {} : { version }),
    name: tableName,
  };
}

/** @internal */ export function declaredRelationTableForInitializer(
  initializer: Node | undefined,
  relation: UnmodeledRelationFact,
): ExtractedTable | null {
  if (!initializer || !Node.isCallExpression(initializer)) return null;

  const rootCall = rootCallExpression(initializer);
  const annotationCall = rootCall.getArguments().find(isKovoAnnotationCall);
  if (!annotationCall || !Node.isCallExpression(annotationCall)) return null;

  const annotationObject = annotationCall.getArguments()[0];
  const viewObject = objectPropertyFromObject(annotationObject, 'view');
  if (!viewObject) return null;

  const domain = domainPropertyFromObject(viewObject, 'of');
  if (!domain) return null;

  const refresh = stringPropertyFromObject(viewObject, 'refresh');
  const annotation: ExtractedDomainTableAnnotation & {
    name: string;
    relation: UnmodeledRelationFact['kind'];
    refresh?: KovoViewAnnotation['refresh'];
  } = {
    domain,
    name: relation.name,
    relation: relation.kind,
    ...(refresh === 'async' || refresh === 'sync' ? { refresh } : {}),
  };

  return {
    annotation,
    columns: tableColumnShapes(rootCall, 'project'),
    exported: false,
  };
}

function defaultDomainForTableName(tableName: string): string {
  // SPEC §10.1: tables default to their same-name domain. Existing fixtures and plan ledger use
  // singular domain names for simple plural table names such as `carts` -> `cart`.
  return tableName.length > 1 && tableName.endsWith('s') ? tableName.slice(0, -1) : tableName;
}

/** @internal */ export function isDomainExtractedTableAnnotation(
  annotation: ExtractedTableAnnotation,
): annotation is ExtractedDomainTableAnnotation & { name: string } {
  return 'domain' in annotation;
}

/** @internal */ export function isExemptExtractedTableAnnotation(
  annotation: ExtractedTableAnnotation,
): annotation is { exempt: true; name: string } {
  return 'exempt' in annotation && annotation.exempt === true;
}

/** @internal */ export function isUnmappedTableAnnotation(
  annotation: ExtractedTableAnnotation,
): annotation is { name: string; unmapped: true } {
  return 'unmapped' in annotation && annotation.unmapped === true;
}

/** @internal */ export function stringPropertyFromObject(
  object: Node,
  name: string,
): string | undefined {
  if (!Node.isObjectLiteralExpression(object)) return undefined;

  for (const property of object.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;
    if (propertyNameText(property.getNameNode()) !== name) continue;

    const initializer = property.getInitializer();
    if (initializer && Node.isStringLiteral(initializer)) return initializer.getLiteralText();
  }

  return undefined;
}

function domainPropertyFromObject(object: Node, name: string): string | undefined {
  if (!Node.isObjectLiteralExpression(object)) return undefined;

  for (const property of object.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;
    if (propertyNameText(property.getNameNode()) !== name) continue;

    const initializer = property.getInitializer();
    if (!initializer) return undefined;
    const expression = unwrappedStaticExpressionNode(initializer);
    if (Node.isStringLiteral(expression) || Node.isNoSubstitutionTemplateLiteral(expression)) {
      return expression.getLiteralText();
    }
    return declaredDomainValueKey(expression);
  }

  return undefined;
}

/** @internal */ export function stringArrayPropertyFromObject(
  object: Node,
  name: string,
): string[] {
  if (!Node.isObjectLiteralExpression(object)) return [];

  for (const property of object.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;
    if (propertyNameText(property.getNameNode()) !== name) continue;

    const initializer = property.getInitializer();
    if (!initializer || !Node.isArrayLiteralExpression(initializer)) return [];
    return initializer
      .getElements()
      .flatMap((element) => (Node.isStringLiteral(element) ? [element.getLiteralText()] : []));
  }

  return [];
}

/**
 * Resolve a Kovo column reference (SPEC §10.1) from a property initializer: a
 * string-literal column name, or a `(table) => table.column` selector (the
 * Drizzle idiom — read statically here, never called at runtime). Returns the
 * referenced column name in both forms.
 */
function columnRefName(initializer: Node | undefined): string | undefined {
  if (!initializer) return undefined;
  if (Node.isStringLiteral(initializer)) return initializer.getLiteralText();
  if (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer)) {
    return undefined;
  }
  let body: Node | undefined = initializer.getBody();
  if (body && Node.isBlock(body)) {
    const returnStatement = body
      .getStatements()
      .find((statement) => Node.isReturnStatement(statement));
    body =
      returnStatement && Node.isReturnStatement(returnStatement)
        ? returnStatement.getExpression()
        : undefined;
  }
  while (body && Node.isParenthesizedExpression(body)) body = body.getExpression();
  if (body && Node.isPropertyAccessExpression(body)) return body.getName();
  if (body && Node.isElementAccessExpression(body)) {
    const argument = body.getArgumentExpression();
    if (argument && Node.isStringLiteral(argument)) return argument.getLiteralText();
  }
  return undefined;
}

/** Like `stringPropertyFromObject` but also accepts a `(t) => t.col` column selector (SPEC §10.1). */
function columnNamePropertyFromObject(object: Node, name: string): string | undefined {
  if (!Node.isObjectLiteralExpression(object)) return undefined;
  for (const property of object.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;
    if (propertyNameText(property.getNameNode()) !== name) continue;
    return columnRefName(property.getInitializer());
  }
  return undefined;
}

function secretPropertyFromObject(object: Node): true | string[] | undefined {
  if (!Node.isObjectLiteralExpression(object)) return undefined;
  for (const property of object.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;
    if (propertyNameText(property.getNameNode()) !== 'secret') continue;

    const initializer = property.getInitializer();
    if (!initializer) return undefined;
    if (initializer.getKind() === SyntaxKind.TrueKeyword) return true;
    if (Node.isArrayLiteralExpression(initializer)) {
      const columns = initializer.getElements().flatMap((element) => columnRefName(element) ?? []);
      return columns.length > 0 ? columns : undefined;
    }
    const column = columnRefName(initializer);
    return column === undefined ? undefined : [column];
  }
  return undefined;
}

function confidentialAtRestPropertyFromObject(object: Node): true | string[] | undefined {
  if (!Node.isObjectLiteralExpression(object)) return undefined;
  for (const property of object.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;
    if (propertyNameText(property.getNameNode()) !== 'confidentialAtRest') continue;

    const initializer = property.getInitializer();
    if (!initializer) return undefined;
    if (initializer.getKind() === SyntaxKind.TrueKeyword) return true;
    if (Node.isArrayLiteralExpression(initializer)) {
      const columns = initializer.getElements().flatMap((element) => columnRefName(element) ?? []);
      return columns.length > 0 ? columns : undefined;
    }
    const column = columnRefName(initializer);
    return column === undefined ? undefined : [column];
  }
  return undefined;
}

/**
 * Parse a `governed:` annotation (SPEC §11.1, the mass-assignment gate / KV438) into
 * its resolved column-name form: `true` (all columns governed) or `string[]` (the
 * named columns). Mirrors `secretPropertyFromObject`. The primary `key` and `owner`
 * columns are AUTO-governed elsewhere; this captures the explicit extra columns.
 */
function governedPropertyFromObject(object: Node): true | string[] | undefined {
  if (!Node.isObjectLiteralExpression(object)) return undefined;
  for (const property of object.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;
    if (propertyNameText(property.getNameNode()) !== 'governed') continue;

    const initializer = property.getInitializer();
    if (!initializer) return undefined;
    if (initializer.getKind() === SyntaxKind.TrueKeyword) return true;
    if (Node.isArrayLiteralExpression(initializer)) {
      const columns = initializer.getElements().flatMap((element) => columnRefName(element) ?? []);
      return columns.length > 0 ? columns : undefined;
    }
    const column = columnRefName(initializer);
    return column === undefined ? undefined : [column];
  }
  return undefined;
}

/**
 * Parse an `atomic:` / `version:` concurrency annotation (SPEC §10.3/§11.1, KV429) into
 * the resolved column-name list. A column ref or list of column refs; never `true`.
 */
function concurrencyColumnsFromObject(object: Node, name: string): string[] | undefined {
  if (!Node.isObjectLiteralExpression(object)) return undefined;
  for (const property of object.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;
    if (propertyNameText(property.getNameNode()) !== name) continue;

    const initializer = property.getInitializer();
    if (!initializer) return undefined;
    if (Node.isArrayLiteralExpression(initializer)) {
      const columns = initializer.getElements().flatMap((element) => columnRefName(element) ?? []);
      return columns.length > 0 ? columns : undefined;
    }
    const column = columnRefName(initializer);
    return column === undefined ? undefined : [column];
  }
  return undefined;
}

function booleanPropertyFromObject(object: Node, name: string): boolean | undefined {
  if (!Node.isObjectLiteralExpression(object)) return undefined;

  for (const property of object.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;
    if (propertyNameText(property.getNameNode()) !== name) continue;

    const initializer = property.getInitializer();
    if (!initializer) return undefined;
    if (initializer.getKind() === SyntaxKind.TrueKeyword) return true;
    if (initializer.getKind() === SyntaxKind.FalseKeyword) return false;
  }

  return undefined;
}

function propertyExistsOnObject(object: Node, name: string): boolean {
  if (!Node.isObjectLiteralExpression(object)) return false;
  return object.getProperties().some((property) => {
    if (!Node.isPropertyAssignment(property) && !Node.isShorthandPropertyAssignment(property)) {
      return false;
    }
    return propertyNameText(property.getNameNode()) === name;
  });
}

function objectPropertyFromObject(
  object: Node | undefined,
  name: string,
): ObjectLiteralExpression | undefined {
  if (!object || !Node.isObjectLiteralExpression(object)) return undefined;

  for (const property of object.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;
    if (propertyNameText(property.getNameNode()) !== name) continue;

    const initializer = property.getInitializer();
    if (initializer && Node.isObjectLiteralExpression(initializer)) return initializer;
  }

  return undefined;
}

function fanAnnotationsFromObject(object: Node): KovoFanAnnotation[] {
  if (!Node.isObjectLiteralExpression(object)) return [];

  const fansProperty = object
    .getProperties()
    .find(
      (property): property is PropertyAssignment =>
        Node.isPropertyAssignment(property) && propertyNameText(property.getNameNode()) === 'fans',
    );
  const initializer = fansProperty?.getInitializer();
  if (!initializer || !Node.isArrayLiteralExpression(initializer)) return [];

  return initializer.getElements().flatMap((element) => {
    if (!Node.isObjectLiteralExpression(element)) return [];

    const domain = domainPropertyFromObject(element, 'domain');
    const via = columnNamePropertyFromObject(element, 'via');
    if (!domain || !via) return [];

    const when = stringPropertyFromObject(element, 'when');
    return [
      {
        domain,
        via,
        ...(when === 'delete' || when === 'insert' || when === 'update' ? { when } : {}),
      },
    ];
  });
}

/** @internal */ export function unwrappedTsExpression(expression: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(expression)) return unwrappedTsExpression(expression.expression);
  if (ts.isAsExpression(expression)) return unwrappedTsExpression(expression.expression);
  if (ts.isSatisfiesExpression(expression)) return unwrappedTsExpression(expression.expression);
  if (ts.isTypeAssertionExpression(expression)) return unwrappedTsExpression(expression.expression);
  if (ts.isNonNullExpression(expression)) return unwrappedTsExpression(expression.expression);
  return expression;
}

import {
  extractUnresolvedConditionalIdentifiers,
  projectSourceModuleContext,
  runWithSourceFileParseCache,
  tablesForFile,
  withParsedSourceFile,
  type SourceModuleContext,
} from './static/tables.js';
/** @internal */
export { projectTablesBySyntheticName } from './static/tables.js';
import {
  functionReceiverParametersByKey,
  mergedRawTables,
  mergedRawWriteSqlTrust,
  rawTablesByDomainWriteCallback,
  rawTablesByMutationHandler,
  rawWriteSqlTrustByDomainWriteCallback,
  rawWriteSqlTrustByMutationHandler,
  unresolvedDomainWriteCallbacks,
  writeCallbackFunction,
  extractedFunctionKey,
  typeHasOpaqueStringMembers,
  type RawWriteSqlTrust,
} from './static/domain-writes.js';
/** @internal */
export { typeHasOpaqueStringMembers } from './static/domain-writes.js';
import {
  appendReceiverMethodAlias,
  appendReceiverMethodAliasesFromArrayAssignment,
  appendReceiverMethodAliasesFromArrayPattern,
  appendReceiverMethodAliasesFromObjectAssignment,
  appendReceiverMethodAliasesFromObjectPattern,
  appendSourceDestructuredReceiverBinding,
  appendSourceDestructuredReceiverIdentifier,
  appendSourceReceiverAliasesFromArrayCarrierAssignment,
  appendSourceReceiverAliasesFromArrayCarrierBinding,
  appendSourceReceiverAliasesFromCarrierAssignment,
  appendSourceReceiverAliasesFromCarrierBinding,
  appendSourceReceiverAliasesFromNestedCarrierAssignment,
  appendSourceReceiverAliasesFromNestedCarrierBinding,
  appendSourceReceiverCarrierProperties,
  appendSourceReceiverCarrierPropertiesForRestTarget,
  appendSourceReceiverCarrierPropertiesForTarget,
  appendSourceReceiverCarrierPropertiesFromArrayLiteral,
  boundReceiverMethodAccessName,
  carrierPropertiesForSymbol,
  dedupeExternalDbArgumentCalls,
  directDrizzleReceiverCallSurface,
  externalHelperCallSurface,
  extractLocalFunctionCallsFromBody,
  extractOpaqueLocalHelperReceiverCallsFromBody,
  extractReceiverMethodAliasCallsFromBody,
  extractSourceReceiverSurfaceCallsFromBody,
  extractTransactionCallbackLocalFunctionCallsFromBody,
  extractUnresolvedTransactionCallbackCallsFromBody,
  isAccessExpressionReceiver,
  isIdentifierDeclarationPosition,
  isInsideNestedFunction,
  isLikelyDrizzleReceiver,
  isProjectDrizzleReceiverContainerExpression,
  isPropertyNamePosition,
  isReceiverArgumentReference,
  isReceiverCarrierIdentifier,
  isSourceDestructuredReceiverIdentifier,
  isSourceReceiverAliasExpression,
  isSourceReceiverAliasIdentifier,
  isSourceReceiverCarrierMemberExpression,
  isUnclassifiedDirectDrizzleReceiverMethod,
  localFunctionCallSatisfiesReceiverRequirements,
  localFunctionKeyForCallback,
  localFunctionKeyForDeclaration,
  localFunctionKeyForIdentifier,
  localFunctionKeyForReference,
  prefixedReceiverCarrierProperties,
  projectReceiverReferenceInArgument,
  projectTypeContainsDrizzleReceiver,
  queryReceiverCarrierSymbolKeys,
  queryReceiverReferenceInArgument,
  receiverCarrierNestedProperties,
  receiverCarrierPathsForValue,
  receiverCarrierPropertiesForExpression,
  receiverCarrierPropertiesFromArrayLiteral,
  receiverCarrierPropertiesFromObjectLiteral,
  receiverCarrierPropertyPaths,
  receiverCarrierSpreadProperties,
  receiverCarrierSymbolKeysForBody,
  receiverMethodAliasCallName,
  receiverMethodAliasExpressionName,
  receiverMethodAliasName,
  receiverMethodAliasesForBody,
  receiverParameterDeclaration,
  receiverReferenceInArgument,
  removeReceiverCarrierPropertyPath,
  restCarrierProperties,
  sourceReceiverAliasReferencesForBody,
  sourceReceiverCallSurface,
  sourceReceiverHelperCallSurface,
  sourceReceiverReferenceSize,
  symbolForIdentifierReference,
  transactionCallHasInlineCallback,
  transactionCallbackLocalFunctionKey,
  transactionCallbackSatisfiesReceiverRequirements,
  type DirectDrizzleReceiverCallSurface,
  type ExternalDbArgumentCall,
  type ExternalHelperCallSurface,
  type ReceiverMethodAliases,
  type SourceReceiverAliasReferences,
} from './static/receiver-surface.js';
import {
  appendQueryReceiverIdentifierBinding,
  appendQueryReceiverParameterReferences,
  appendQueryTransactionReceiverAliases,
  appendUntypedQueryReceiverBinding,
  bindingElementStaticPath,
  boundCallbackTarget,
  callbackFunctionFromReference,
  callbackFunctionFromPropertyDeclaration,
  staticBindingElementReference,
  staticLiteralReferenceFromExpression,
  staticObjectFactoryReturnExpression,
  symbolForCallbackReference,
  symbolForStaticTypePath,
  callbackFunctionFromGetAccessorDeclaration,
  callbackFunctionFromVariable,
  callbackReferenceFromStaticLiteralPath,
  externalQueryHelperDiagnostics,
  factoryHasNoParameters,
  functionLikeStaticReturnExpression,
  isTimeVolatileExpression,
  isTimeVolatileSource,
  isTimeVolatileSqlProjection,
  isEmptyQueryShape,
  nullableJoinTables,
  nullableNestedShape,
  objectLiteralStaticPropertyReference,
  opaqueLocalQueryHelperDiagnostics,
  opaqueProjectionDiagnostics,
  projectQueryReceiverContainerDiagnostics,
  projectionPropertyName,
  queryBodyHasTimeVolatileWhere,
  queryBodyObjectLiteralFromDeclaration,
  queryBodyObjectLiteralFromNode,
  queryCallbackBodyForNode,
  queryCallbackExpressionResolution,
  queryCallbackPropertyIsLoad,
  queryCallbackPropertyMayHideLoad,
  queryCallbackPropertyResolution,
  queryCallbackReceiverReferences,
  queryExecutableCallExpressions,
  queryHelperArgumentReceiverName,
  queryHelperReceiverArgumentName,
  queryLoadCallbackFromSpread,
  queryLoadCallbackFromSpreadExpression,
  queryLoadCallbackResolution,
  queryLocalHelperCalls,
  queryReceiverAliasReferencesForCall,
  queryShapeContainsSecret,
  queryShapeFromObjectLiteralNode,
  revealFactsFromQueryShape,
  receiverMethodAliasQueryDiagnostics,
  referencedQueryCallbackFunction,
  revealedQueryShapePaths,
  relationalQueryDiagnostics,
  relationalShapeFromQueryBody,
  scalarProjectionTable,
  scalarQueryShape,
  selectCallDisplayName,
  selectCallFromQueryBody,
  selectShapeFromQueryBody,
  sourceDestructuredQueryReceiverDiagnostics,
  sourceQueryDestructuredReceiverNames,
  staticAccessSegments,
  staticFactoryBlockReturnExpression,
  staticLiteralContainerExpression,
  staticTsElementAccessName,
  staticTsExpressionPath,
  symbolForStaticMemberReference,
  tableExpressionBase,
  tableRowQueryShapePaths,
  typedSqlProjectionShape,
  unclassifiedQueryReceiverDiagnostics,
  unprovenDestructuredReceiverReferences,
  unresolvedQueryClosureReadDiagnostics,
  unresolvedProjectionDiagnostics,
  unresolvedQueryCallbackDiagnostics,
  unresolvedQueryLoadCallbackDiagnostic,
  volatileTimeShape,
  wireRelevantProjectedColumnsFromQueryBody,
  type QueryBodyObjectResolution,
  type QueryLoadCallbackResolution,
  type QueryLoadSpreadResolution,
  type QueryShapeContext,
  type QueryShapeSelection,
  isSelectQueryCallName,
  queryBodyObjectLiteral,
  isQueryReceiverIdentifier,
  queryCallbackBodies,
  queryCallbackParameterNodes,
} from './static/query-shapes.js';
/** @internal */
export {
  isOpaqueProjection,
  isQueryReceiverIdentifier,
  isSelectQueryCallName,
  queryBodyObjectLiteral,
  queryCallbackBodies,
  queryCallbackParameterNodes,
  queryLoadCallbackFunctions,
  selectProjectionArgument,
  staticAccessSegments,
  aliasedSymbol,
  symbolForStaticTypePath,
  symbolForCallbackReference,
  staticObjectFactoryReturnExpression,
  staticLiteralReferenceFromExpression,
  staticBindingElementReference,
  callbackFunctionFromReference,
  callbackFunctionFromPropertyDeclaration,
  callbackFunctionFromProperty,
  callbackFunctionFromDeclaration,
  callbackFunctionFromBindingElement,
  staticLiteralContainerInitializer,
  isQueryShapeWrapper,
  nullableShape,
} from './static/query-shapes.js';
import {
  appendColumnShapesForTablePath,
  appendProjectAliasTableNames,
  appendProjectConditionalTableNames,
  blockSingleReturnExpression,
  columnBuilderBaseShape,
  columnBuilderChainMethods,
  columnBuilderIsNonNull,
  columnBuilderMode,
  columnBuilderModeFromExpression,
  columnBuilderName,
  columnBuilderNameFromExpression,
  columnBuilderRootCallExpression,
  columnBuilderShape,
  columnShapesForFile,
  computedPropertyNameExpression,
  declaredDomainValueKey,
  drizzleCoreExportNameFromDeclarations,
  drizzleCoreExportSpecifierExportName,
  drizzleCoreImportSpecifierExportName,
  drizzleCoreModuleSpecifierForDeclaration,
  drizzleDatabaseTypeDeclarations,
  drizzleDatabaseTypeNames,
  foreignKeyActionMethods,
  foreignKeyActionOptions,
  foreignKeyActions,
  foreignKeyCallbackReturnExpression,
  foreignKeyTargetTableExpression,
  isDrizzleCoreModuleSpecifier,
  isDrizzleCoreNamespaceMember,
  isDrizzleDatabaseType,
  isDrizzleDatabaseTypeAnnotation,
  isDrizzleDatabaseTypeNode,
  isDrizzleOrmDeclaration,
  isDrizzleReceiver,
  isDrizzleTableFactoryNamespaceMember,
  isDrizzleWriteCall,
  isKovoAnnotationCall,
  isProjectDrizzleAliasCall,
  isProjectTableInitializerNode,
  isStaticDeclaredReadEntry,
  isTableInitializerNode,
  objectAssignmentPropertyName,
  objectAssignmentTargetNode,
  objectHasProperty,
  objectPropertyInitializer,
  projectAliasTargetTableName,
  projectColumnBuilderName,
  projectColumnBuilderShape,
  projectColumnShapesByTable,
  projectConditionalTargetTableNames,
  projectDrizzleCoreIdentifierExportName,
  projectForeignKeyForColumn,
  projectForeignKeysForTable,
  projectRelationCardinalitiesByProperty,
  projectRelationTargetTableNamesByProperty,
  projectRelationalTableNamesByProperty,
  projectTableNameForColumnShapeAccess,
  projectTableNamesBySymbol,
  projectUnmodeledRelationNameForNode,
  projectUnmodeledRelationNameForSymbol,
  projectUnmodeledRelationNamesBySymbol,
  projectUnresolvedConditionalTableExpressions,
  propertyNameText,
  queryDeclaredReadDomains,
  queryDeclaredReadExpressions,
  queryOutputShape,
  queryShapeFromSchemaExpression,
  resolvedSymbolKey,
  rootCallExpression,
  sourceColumnShapesForTables,
  staticPropertyNameExpressionText,
  staticStringPropertyValue,
  tableColumnShapes,
  tableNameArgument,
  unmodeledRelationExpression,
  unmodeledRelationForInitializer,
  unmodeledRelationFromExpression,
  type UnmodeledRelationFact,
} from './static/schema.js';
import {
  createProjectExtraction,
  projectContextFiles,
  projectFunctionExtractionsByFileName,
  projectRelationTargetTableNamesForExtraction,
  projectSourceFileName,
  type ProjectExtraction,
} from './static/project-setup.js';
import {
  type ProjectNamespaceTableNames,
  appendProjectDrizzleReceiverAliasIdentifier,
  appendProjectDrizzleReceiverArrayAssignmentAliases,
  appendProjectDrizzleReceiverArrayAssignmentAliasesForType,
  appendProjectDrizzleReceiverArrayBindingAliasesForType,
  appendProjectDrizzleReceiverAssignmentAliases,
  appendProjectDrizzleReceiverBinding,
  appendProjectDrizzleReceiverBindingAliasForType,
  appendProjectDrizzleReceiverBindingInitializerAliases,
  appendProjectDrizzleReceiverBindingsFromBody,
  appendProjectDrizzleReceiverInitializerAlias,
  appendProjectDrizzleReceiverObjectAssignmentAliases,
  appendProjectDrizzleReceiverObjectAssignmentAliasesForType,
  appendProjectDrizzleReceiverObjectBindingAliasesForType,
  appendProjectDrizzleReceiverParameterBinding,
  appendProjectTransactionReceiverAliases,
  bodySourceStart,
  callExpressionsInNode,
  drizzleWriteChainRoot,
  extractOpaqueClosureProjectReceiverCallsFromBody,
  extractProjectDrizzleReceiverContainerCalls,
  extractProjectDrizzleWriteCalls,
  extractProjectExternalDbArgumentCalls,
  extractProjectRelationalReadCalls,
  extractProjectSelectReadCalls,
  extractProjectUnclassifiedDrizzleReceiverCalls,
  extractProjectUnresolvedCalls,
  isFunctionLikeNode,
  isInlineIterationCallback,
  isInlineTransactionCallback,
  isNestedInWriteReadSource,
  isProjectDrizzleReceiverContainerCallReceiver,
  isProjectDrizzleReceiverIdentifier,
  isProjectDrizzleReceiverMemberExpression,
  isRestBindingElement,
  isTouchBodyNode,
  objectBindingElementPropertyName,
  opaqueTouchClosureAncestor,
  projectArrayElementType,
  projectClassStaticMemberCallbacks,
  projectDomainWriteCallbacks,
  projectDrizzleReceivers,
  projectExportedTableNamesByName,
  projectFunctionsForFile,
  projectMutationHandlerCallbacks,
  projectNamespaceAccessTableName,
  projectNamespaceTableNamesByLocal,
  projectObjectLiteralCallbacks,
  projectObjectPropertyType,
  projectReceiverParameterRequirements,
  projectTableNameForNode,
  projectTableNameForSymbol,
  projectUnclassifiedCallSurface,
  queryBuilderRootCallName,
  relationalReadCall,
  selectReadCall,
  singleReturnExpression,
  touchBodyCallExpressions,
  touchBodyVariableDeclarations,
  uniqueExternalDbArgumentCalls,
  type DomainWriteProperty,
  type ProjectDrizzleReceivers,
  type QueryReceiverReferences,
} from './static/project-receivers.js';
import {
  allEqOperandPairs,
  appendDeclaredFanOutWriteSummaries,
  appendForeignKeyCascadeWriteSummaries,
  appendMissingTriggerFanOutDiagnostics,
  appendReadSourceSummaries,
  argScopedDomainFromEqOperands,
  callSourceOrder,
  compositeQueryInstanceKey,
  directSummaryForFunction,
  exemptQueryReadDiagnostics,
  fanAnnotationsForOperation,
  foreignKeyTargetsTable,
  functionTouchSummariesForFile,
  isAsyncMaterializedViewAnnotation,
  isJoinReadCallName,
  isQueryCallOnReceiver,
  isQueryReadCallName,
  isTouchingForeignKeyAction,
  materializedViewRefreshFactsForFunction,
  mergeSummary,
  opaqueReadWithoutResolvableReadsDiagnostics,
  pushUnique,
  queryArgScopedDomainKeys,
  queryArgScopedDomains,
  queryBodyCallExpressions,
  queryCallChainReceiver,
  queryHasClientArgPredicate,
  queryInputKeyOperand,
  queryInstanceKey,
  queryInstanceKeyComparisons,
  queryInstanceKeyOperand,
  queryJoinTableExpressions,
  queryOwnerPrivateScopedKeys,
  queryOwnerSessionAnchoredDomains,
  queryPrivateScopeKeyOperand,
  queryReadDomains,
  queryReadOnlyDomains,
  queryReceiverMode,
  queryRelationalTableExpressions,
  querySessionAnchoredDomains,
  queryTableExpressions,
  queryTableKeyOperand,
  readSummaryKey,
  resolvedQueryOwnerTableDomain,
  resolvedQueryTableDomain,
  sessionAnchoredDomainFromEqOperands,
  staticExpressionPath,
  staticExpressionRootIdentifier,
  triggerTableNamesFromSource,
  unmodeledRelationReadDiagnostics,
  unresolvedQueryReadDiagnostics,
  unresolvedRelationalQueryReadDiagnostics,
  unresolvedSummaryKey,
  unwrappedFunctionExpression,
  unwrappedStaticExpressionNode,
  valueKeyForTableColumnComparison,
  writeCallChainReceiver,
  writeSummaryKey,
  type QueryInstanceKeyComparisons,
  type QueryReadResolutionOptions,
  writeReadSourceOperation,
  writeInstanceKeyComparisons,
  tableKeyReferences,
  tableKeyReference,
  tableKeyColumns,
  staticAccessName,
  staticAccessExpression,
  propertyAccessCallName,
  predicateSummaryFromFacts,
  predicatePnf,
  pnfExactConjuncts,
  pnfAllEqOperandPairs,
  isReadSourceCall,
  isPrivateScopeKey,
  extractReadSourcesFromWriteChain,
  extractPredicateFactsFromWriteChain,
  extractParameterizedKeys,
  eqPredicateConjuncts,
  dedupePredicateFacts,
  callExpressionContinuesToChain,
  argumentKey,
  type PredicatePnf,
  type EqPredicateConjunct,
} from './static/summaries.js';
/** @internal */
export {
  allEqOperandPairs,
  appendDeclaredFanOutWriteSummaries,
  appendForeignKeyCascadeWriteSummaries,
  appendMissingTriggerFanOutDiagnostics,
  appendReadSourceSummaries,
  argScopedDomainFromEqOperands,
  callSourceOrder,
  compositeQueryInstanceKey,
  directSummaryForFunction,
  exemptQueryReadDiagnostics,
  fanAnnotationsForOperation,
  foreignKeyTargetsTable,
  functionTouchSummariesForFile,
  isAsyncMaterializedViewAnnotation,
  isJoinReadCallName,
  isQueryCallOnReceiver,
  isQueryReadCallName,
  isTouchingForeignKeyAction,
  materializedViewRefreshFactsForFunction,
  mergeSummary,
  opaqueReadWithoutResolvableReadsDiagnostics,
  pushUnique,
  queryArgScopedDomainKeys,
  queryArgScopedDomains,
  queryBodyCallExpressions,
  queryCallChainReceiver,
  queryHasClientArgPredicate,
  queryInputKeyOperand,
  queryInstanceKey,
  queryInstanceKeyComparisons,
  queryInstanceKeyOperand,
  queryJoinTableExpressions,
  queryOwnerPrivateScopedKeys,
  queryOwnerSessionAnchoredDomains,
  queryPrivateScopeKeyOperand,
  queryReadDomains,
  queryReadOnlyDomains,
  queryReceiverMode,
  queryRelationalTableExpressions,
  querySessionAnchoredDomains,
  queryTableExpressions,
  queryTableKeyOperand,
  readSummaryKey,
  resolvedQueryOwnerTableDomain,
  resolvedQueryTableDomain,
  sessionAnchoredDomainFromEqOperands,
  staticExpressionPath,
  staticExpressionRootIdentifier,
  triggerTableNamesFromSource,
  unmodeledRelationReadDiagnostics,
  unresolvedQueryReadDiagnostics,
  unresolvedRelationalQueryReadDiagnostics,
  unresolvedSummaryKey,
  unwrappedFunctionExpression,
  unwrappedStaticExpressionNode,
  valueKeyForTableColumnComparison,
  writeCallChainReceiver,
  writeSummaryKey,
  type QueryInstanceKeyComparisons,
  type QueryReadResolutionOptions,
  writeReadSourceOperation,
  writeInstanceKeyComparisons,
  tableKeyReferences,
  tableKeyReference,
  tableKeyColumns,
  staticAccessName,
  staticAccessExpression,
  propertyAccessCallName,
  predicateSummaryFromFacts,
  predicatePnf,
  pnfExactConjuncts,
  pnfAllEqOperandPairs,
  isReadSourceCall,
  isPrivateScopeKey,
  extractReadSourcesFromWriteChain,
  extractPredicateFactsFromWriteChain,
  extractParameterizedKeys,
  eqPredicateConjuncts,
  dedupePredicateFacts,
  callExpressionContinuesToChain,
  argumentKey,
  type PredicatePnf,
  type EqPredicateConjunct,
} from './static/summaries.js';

/** @internal */
export {
  appendProjectDrizzleReceiverBindingsFromBody,
  appendProjectDrizzleReceiverParameterBinding,
  bodySourceStart,
  drizzleWriteChainRoot,
  isProjectDrizzleReceiverIdentifier,
  isProjectDrizzleReceiverMemberExpression,
  projectClassStaticMemberCallbacks,
  projectDomainWriteCallbacks,
  projectDrizzleReceivers,
  projectMutationHandlerCallbacks,
  projectObjectLiteralCallbacks,
  relationalReadCall,
  selectReadCall,
  type DomainWriteProperty,
  type ProjectDrizzleReceivers,
  type QueryReceiverReferences,
  type ProjectNamespaceTableNames,
  touchBodyVariableDeclarations,
  touchBodyCallExpressions,
  singleReturnExpression,
  projectTableNameForSymbol,
  projectTableNameForNode,
  projectReceiverParameterRequirements,
  projectNamespaceTableNamesByLocal,
  projectNamespaceAccessTableName,
  isTouchBodyNode,
  isRestBindingElement,
  isProjectDrizzleReceiverContainerCallReceiver,
  isFunctionLikeNode,
  extractProjectUnresolvedCalls,
  extractProjectSelectReadCalls,
  extractProjectRelationalReadCalls,
  extractProjectDrizzleWriteCalls,
  projectExportedTableNamesByName,
} from './static/project-receivers.js';
/** @internal */
export {
  createProjectExtraction,
  projectContextFiles,
  projectRelationTargetTableNamesForExtraction,
  projectSourceFileName,
  type ProjectExtraction,
} from './static/project-setup.js';
/** @internal */
export {
  emptySessionProvenanceContext,
  opaqueAliasReasonForExpression,
  privateScopeForExpression,
  privateScopeKey,
  privateScopeSourceForExpression,
  sessionProvenanceContextForNodes,
} from './static/session-provenance.js';
/** @internal */
export {
  appendSymbolProvenancePath,
  joinSymbolProvenance,
  provenInputProvenanceForExpression,
  provenServerProvenanceForExpression,
  serverSummaryKeysForSourceFile,
  symbolProvenanceContextForNodes,
  symbolProvenanceForExpression,
  type SymbolProvenance,
  type SymbolProvenanceContext,
  type SymbolProvenanceContextOptions,
  type SymbolProvenanceKind,
  type SymbolProvenanceRoot,
} from './static/symbol-provenance.js';
/** @internal */
export {
  canonicalFrameworkExportForExpression,
  canonicalFrameworkExportForSymbol,
  expressionResolvesToFrameworkExport,
  frameworkExport,
  frameworkIdentityExpressionKindRows,
  symbolResolvesToFrameworkExport,
  typeAliasResolvesToFrameworkExport,
  type CanonicalFrameworkExportIdentity,
  type CanonicalFrameworkModule,
  type FrameworkIdentityExpressionKindResolution,
  type FrameworkIdentityOptions,
} from './static/framework-identity.js';
/** @internal */
export {
  computedPropertyNameExpression,
  isDrizzleDatabaseTypeAnnotation,
  isDrizzleWriteCall,
  isProjectTableInitializerNode,
  isStaticDeclaredReadEntry,
  isTableInitializerNode,
  objectAssignmentPropertyName,
  objectAssignmentTargetNode,
  objectPropertyInitializer,
  propertyNameText,
  resolvedSymbolKey,
  tableColumnShapes,
  tableNameArgument,
  unmodeledRelationFromExpression,
  isDrizzleDatabaseType,
  projectForeignKeysForTable,
  isDrizzleReceiver,
  type UnmodeledRelationFact,
} from './static/schema.js';
/** @internal */
export {
  appendSourceDestructuredReceiverBinding,
  boundReceiverMethodAccessName,
  directDrizzleReceiverCallSurface,
  externalHelperCallSurface,
  extractReceiverMethodAliasCallsFromBody,
  extractSourceReceiverSurfaceCallsFromBody,
  isSourceDestructuredReceiverIdentifier,
  localFunctionCallSatisfiesReceiverRequirements,
  localFunctionKeyForReference,
  projectReceiverReferenceInArgument,
  queryReceiverCarrierSymbolKeys,
  queryReceiverReferenceInArgument,
  receiverReferenceInArgument,
  sourceReceiverAliasReferencesForBody,
  symbolForIdentifierReference,
} from './static/receiver-surface.js';
/** @internal */ export function functionBody(callback: Node): Node {
  if (
    Node.isArrowFunction(callback) ||
    Node.isFunctionDeclaration(callback) ||
    Node.isFunctionExpression(callback) ||
    Node.isMethodDeclaration(callback)
  ) {
    const body = callback.getBody();
    if (body) return body;
  }

  throw new Error('Expected a write callback function');
}

/** @internal */ export function appendTableEntries<Table>(
  tables: Map<string, Table[]>,
  identifier: string,
  entries: readonly Table[],
): void {
  const current = tables.get(identifier) ?? [];
  const next = [...current];
  const keys = new Set(current.map((entry) => JSON.stringify(entry)));

  for (const entry of entries) {
    const key = JSON.stringify(entry);
    if (keys.has(key)) continue;

    keys.add(key);
    next.push(entry);
  }

  tables.set(identifier, next);
}

/** @internal */ export function lineForIndex(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

/** @internal */ export function unsummarizedHelperReason(call: CallExpression): string {
  const callee = unwrappedStaticExpressionNode(call.getExpression());
  const name = Node.isIdentifier(callee) ? callee.getText() : staticAccessName(callee);
  return name ? `unsummarized-helper:${name}` : 'unsummarized-helper';
}

/** @internal */ export function callbackParameterSymbolKeys(fn: Node): Set<string> {
  const keys = new Set<string>();
  for (const parameter of queryCallbackParameterNodes(fn)) {
    if (isDrizzleDatabaseTypeAnnotation(parameter)) continue;
    const nameNode = parameter.getNameNode();
    if (Node.isObjectBindingPattern(nameNode)) {
      for (const element of nameNode.getElements()) {
        const key = resolvedSymbolKey(element.getNameNode().getSymbol());
        if (key) keys.add(key);
      }
      continue;
    }
    const symbolKey = resolvedSymbolKey(nameNode.getSymbol());
    if (symbolKey) keys.add(symbolKey);
  }
  return keys;
}

/** @internal */
export {
  extractAlgebraicShapesFromProject,
  extractMassAssignmentFromProject,
  extractMassAssignmentFromProjectExtraction,
  extractQueryWriteReachabilityFromProject,
  extractQueryWriteReachabilityFromProjectExtraction,
  extractSymbolicEffectsFromProject,
  extractToctouFromProject,
  extractToctouFromProjectExtraction,
} from './static/derivation.js';
/** @internal */
/** @internal */ export type { SymbolicEffectFact } from './static/derivation.js';
