import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JsonValue } from '@kovojs/core';
import { diagnosticDefinitionText, diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
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
  RevealExplainFact,
  ScopeAuditFact,
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
  type FunctionExpression,
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
  isKovoExtraConfigCallName,
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
  collectTrustEscapesFromProject,
  collectUnregisteredSinksFromProject,
} from './trust-escapes-static.js';

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
   * owner column is compared against the matching session/principal private symbol.
   * This is stricter than `sessionAnchoredReads`, which may anchor any table column.
   */
  ownerScopedSessionReads?: readonly string[];
  query: string;
  reads: readonly string[];
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

function revealFactsFromQueryShape(
  query: string,
  shape: QueryShape,
  fallbackSite: string,
  path: readonly string[] = [],
): RevealExplainFact[] {
  if (typeof shape !== 'object' || shape === null) return [];
  if (Array.isArray(shape)) {
    return shape.flatMap((item) => revealFactsFromQueryShape(query, item, fallbackSite, path));
  }

  if (isQueryShapeWrapper(shape)) {
    if (shape.kind === 'revealed') {
      return [
        {
          grade: shape.reveal.grade,
          method: shape.reveal.method,
          path: path.join('.') || '$',
          query,
          site: shape.reveal.site ?? fallbackSite,
          ...(shape.reveal.justification === undefined
            ? {}
            : { justification: shape.reveal.justification }),
          ...(shape.reveal.selectedSecret === undefined
            ? {}
            : { selectedSecret: shape.reveal.selectedSecret }),
          ...(shape.reveal.source === undefined ? {} : { source: shape.reveal.source }),
        },
      ];
    }
    return revealFactsFromQueryShape(query, shape.shape, fallbackSite, path);
  }

  return Object.entries(shape).flatMap(([key, child]) =>
    revealFactsFromQueryShape(query, child, fallbackSite, [...path, key]),
  );
}

function isQueryShapeWrapper(shape: QueryShape): shape is QueryShapeWrapper {
  return (
    typeof shape === 'object' &&
    shape !== null &&
    !Array.isArray(shape) &&
    'kind' in shape &&
    'shape' in shape &&
    (shape.kind === 'nullable' ||
      shape.kind === 'optional' ||
      shape.kind === 'secret' ||
      shape.kind === 'table-row' ||
      shape.kind === 'volatile-time' ||
      (shape.kind === 'revealed' && 'reveal' in shape))
  );
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
    for (const domain of fact.reads) {
      if (!owners.has(domain)) continue;

      // SPEC §10.3 / KV414. `args` is the IDOR signal and is fail-closed: a
      // client-visible `input.*` arg keying the declared key column (A1/legacy),
      // OR any owner-table column (A3, `argScopedReads`), flags KV414 even when the
      // same predicate is also session-anchored.
      const argKeys = new Set<string>();
      if (fact.instanceKey?.domain === domain && fact.instanceKey.key.startsWith('arg:')) {
        argKeys.add(fact.instanceKey.key);
      }
      for (const scoped of fact.argScopedReadKeys ?? []) {
        if (scoped.domain === domain) argKeys.add(scoped.key);
      }
      if (argKeys.size === 0 && (fact.argScopedReads ?? []).includes(domain)) {
        argKeys.add('');
      }
      if (argKeys.size > 0) {
        for (const key of argKeys) {
          audits.push({
            domain,
            ...(key ? { key } : {}),
            kind: 'query',
            name: fact.query,
            scope: 'args',
            site: fact.site,
          });
        }
        continue;
      }

      const ownerSessionScoped = (fact.ownerScopedSessionReads ?? []).includes(domain);
      if (ownerSessionScoped) {
        audits.push({ domain, kind: 'query', name: fact.query, scope: 'session', site: fact.site });
        continue;
      }

      const sessionScoped = (fact.sessionAnchoredReads ?? []).includes(domain);
      const ownerScope = ownerScopes.find((owner) => owner.domain === domain);
      if (sessionScoped && !ownerScope?.owner) {
        audits.push({ domain, kind: 'query', name: fact.query, scope: 'session', site: fact.site });
        continue;
      }

      const detail = ownerAuthorizationDataDetail(ownerScope, sessionScoped);
      // Join-keyed bypass: an owner read that is neither directly arg-keyed nor
      // session/`owns()`-scoped, but is reachable from a client `input.*` predicate
      // (on this or a joined non-owner table). Fail-closed to `args`/KV414.
      if (fact.hasClientArgPredicate) {
        audits.push({
          detail,
          domain,
          kind: 'query',
          name: fact.query,
          scope: 'args',
          site: fact.site,
        });
        continue;
      }

      if (ownerScope?.owner) {
        audits.push({
          detail,
          domain,
          kind: 'query',
          name: fact.query,
          scope: 'unknown',
          site: fact.site,
        });
      }
    }
  }

  return audits;
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

/**
 * A write touch on an owner-annotated domain, with the `args`/`session` domains its
 * `where()` predicate selects (SPEC §10.3, KV414 A1). The write half of the IDOR gate:
 * `scopeAuditsFromQueryFacts` covers reads; this covers `db.update/delete(...)` writes.
 *
 * @internal
 */
/** @internal */ export interface WriteScopeFact {
  /** Owner-table domains keyed by a client-visible `input.*` arg (any column) → `args`/IDOR. */
  argScopedWrites: readonly string[];
  /** Exact client-visible keys for `argScopedWrites`, used to scope `owns()` suppression. */
  argScopedWriteKeys?: readonly OwnerScopeKey[];
  /** The mutation/handler name that owns this write (for `owns()` discharge in `kovo check`). */
  name: string;
  /** Owner-table domains this write touches (the audited surface). */
  reads: readonly string[];
  /** Owner-table domains keyed by `req.session.*` → `session` (safe). */
  sessionAnchoredWrites: readonly string[];
  site: string;
}

/**
 * Scope-audit facts for WRITES against an `owner:`-annotated domain (SPEC §10.3,
 * §11.1; KV414 A1). Parallels `scopeAuditsFromQueryFacts` but emits `kind:'write'`: a
 * write keyed by a client-visible `args.*` is the write-side IDOR candidate the CLI
 * enforces unless an `owns()` guard discharges it; a `req.session.*`-anchored write is
 * safe (`session`); a write keyed by neither emits no fact (no false positive without
 * inter-procedural session tracing — mirrors the read side).
 *
 * @internal
 */
/** @internal */ export function scopeAuditsFromWriteFacts(
  facts: readonly WriteScopeFact[],
  ownerDomains: Iterable<string>,
): ScopeAuditFact[] {
  const owners = new Set(ownerDomains);
  const audits: ScopeAuditFact[] = [];

  for (const fact of facts) {
    for (const domain of fact.reads) {
      if (!owners.has(domain)) continue;

      // Fail-closed: an arg-keyed owner write is IDOR even if also session-anchored.
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

      if (fact.sessionAnchoredWrites.includes(domain)) {
        audits.push({ domain, kind: 'write', name: fact.name, scope: 'session', site: fact.site });
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

/** @internal */ export type ExtractedTableAnnotation =
  | (KovoTableAnnotation & { name: string })
  | (KovoDomainTableAnnotation & {
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

/** @internal */
export function analyzeSqlSafetyFromProject(
  options: TouchGraphProjectOptions,
): TouchGraphDiagnostic[] {
  const extraction = createProjectExtraction(options);
  try {
    const contextFiles = projectContextFiles(extraction);
    const diagnostics = contextFiles.flatMap((file, index) => {
      const sourceFile = extraction.sourceFiles[index];
      return sourceFile ? sqlSafetyDiagnosticsForSourceFile(file, sourceFile) : [];
    });
    return diagnostics.sort((left, right) => left.site.localeCompare(right.site));
  } finally {
    extraction.dispose();
  }
}

function sqlSafetyDiagnosticsForSourceFile(
  file: SourceFileInput,
  sourceFile: SourceFile,
): TouchGraphDiagnostic[] {
  const diagnostics: TouchGraphDiagnostic[] = [];
  const scopes = new Map<Node, Map<string, SqlTextSafety>>();
  const nativeDrizzleSqlReceivers = nativeDrizzleSqlReceiverTexts(sourceFile);

  for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const name = declaration.getNameNode();
    if (!Node.isIdentifier(name)) continue;
    const scope = nearestSqlSafetyScope(declaration);
    let bindings = scopes.get(scope);
    if (!bindings) {
      bindings = new Map();
      scopes.set(scope, bindings);
    }
    bindings.set(name.getText(), sqlTextSafety(declaration.getInitializer(), scopes));
  }

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const rawHelperDiagnostic = sqlRawHelperDiagnostic(
      file,
      call,
      scopes,
      nativeDrizzleSqlReceivers,
    );
    if (rawHelperDiagnostic) diagnostics.push(rawHelperDiagnostic);

    const sinkName = sqlSinkName(call);
    if (!sinkName) continue;
    const [statement] = call.getArguments();
    const safety = sqlTextSafety(statement, scopes);
    if (safety === 'safe') continue;

    diagnostics.push({
      code: 'KV422',
      message: `${diagnosticDefinitions.KV422.message} ${sinkName}() receives ${sqlSafetyDescription(safety)} SQL text; use Kovo sql\`...\`, staticSql\`...\`, a separated parameter carrier, or trustedSql(...).`,
      severity: diagnosticDefinitions.KV422.severity,
      site: `${file.fileName}:${lineForIndex(file.source, call.getStart())}`,
    });
  }

  return diagnostics;
}

function sqlRawHelperDiagnostic(
  file: SourceFileInput,
  call: CallExpression,
  scopes: ReadonlyMap<Node, ReadonlyMap<string, SqlTextSafety>>,
  nativeDrizzleSqlReceivers: ReadonlySet<string>,
): TouchGraphDiagnostic | null {
  const expression = call.getExpression();
  if (!Node.isPropertyAccessExpression(expression)) return null;
  const receiver = expression.getExpression();

  const method = expression.getName();
  if (method !== 'raw' && method !== 'identifier') return null;
  const [first, second] = call.getArguments();
  if (nativeDrizzleSqlReceivers.has(receiver.getText())) {
    return {
      code: 'KV422',
      message: `${diagnosticDefinitions.KV422.message} Direct drizzle-orm sql.${method}(...) is not accepted in app code; import Kovo's sql from @kovojs/drizzle so raw chunks and identifiers are auditable.`,
      severity: diagnosticDefinitions.KV422.severity,
      site: `${file.fileName}:${lineForIndex(file.source, call.getStart())}`,
    };
  }

  if (!Node.isIdentifier(receiver) || receiver.getText() !== 'sql') return null;
  if (method === 'identifier' && sqlAllowlistSafety(second, scopes) === 'literal') return null;

  const safety = sqlTextSafety(first, scopes);
  if (safety === 'literal') return null;

  return {
    code: 'KV422',
    message: `${diagnosticDefinitions.KV422.message} sql.${method}(...) receives ${sqlSafetyDescription(safety)} text; use sql.identifier(value, { allow }) for identifiers or trustedSql(...) for audited raw SQL.`,
    severity: diagnosticDefinitions.KV422.severity,
    site: `${file.fileName}:${lineForIndex(file.source, call.getStart())}`,
  };
}

function nativeDrizzleSqlReceiverTexts(sourceFile: SourceFile): Set<string> {
  const receivers = new Set<string>();
  for (const declaration of sourceFile.getImportDeclarations()) {
    if (declaration.getModuleSpecifierValue() !== 'drizzle-orm') continue;
    for (const named of declaration.getNamedImports()) {
      if (named.getName() === 'sql') receivers.add(named.getAliasNode()?.getText() ?? 'sql');
    }
    const namespace = declaration.getNamespaceImport();
    if (namespace) receivers.add(`${namespace.getText()}.sql`);
  }
  return receivers;
}

function sqlSinkName(call: CallExpression): string | null {
  const expression = call.getExpression();
  if (Node.isPropertyAccessExpression(expression)) {
    const name = expression.getName();
    return name === 'execute' || name === 'query' || name === 'exec' || name === 'prepare'
      ? name
      : null;
  }

  if (Node.isElementAccessExpression(expression)) {
    const argument = expression.getArgumentExpression();
    if (Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument)) {
      const name = argument.getLiteralText();
      return name === 'execute' || name === 'query' || name === 'exec' || name === 'prepare'
        ? name
        : null;
    }
    return '<computed-sql-method>';
  }

  return null;
}

function sqlTextSafety(
  expression: Node | undefined,
  scopes: ReadonlyMap<Node, ReadonlyMap<string, SqlTextSafety>>,
): SqlTextSafety {
  if (!expression) return 'unknown';
  if (Node.isStringLiteral(expression) || Node.isNoSubstitutionTemplateLiteral(expression)) {
    return 'literal';
  }
  if (Node.isTaggedTemplateExpression(expression)) {
    const tag = expression.getTag();
    return tag.getText() === 'sql' || tag.getText() === 'staticSql' ? 'safe' : 'unknown';
  }
  if (Node.isTemplateExpression(expression)) return 'tainted';
  if (Node.isCallExpression(expression)) {
    const callExpression = expression.getExpression();
    if (Node.isIdentifier(callExpression) && callExpression.getText() === 'trustedSql')
      return 'safe';
    if (Node.isPropertyAccessExpression(callExpression)) {
      const receiver = callExpression.getExpression();
      if (Node.isIdentifier(receiver) && receiver.getText() === 'sql') {
        const method = callExpression.getName();
        if (method === 'identifier') {
          return sqlAllowlistSafety(expression.getArguments()[1], scopes) === 'literal'
            ? 'safe'
            : joinSqlTextSafety(sqlTextSafety(expression.getArguments()[0], scopes), 'unknown');
        }
        if (method === 'allow') {
          return sqlAllowlistSafety(expression.getArguments()[1], scopes) === 'literal'
            ? 'safe'
            : joinSqlTextSafety(sqlTextSafety(expression.getArguments()[0], scopes), 'unknown');
        }
        if (method === 'join') return sqlJoinSafety(expression, scopes);
        if (method === 'raw') {
          return sqlTextSafety(expression.getArguments()[0], scopes) === 'literal'
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
    return bindingSafety(expression, scopes) ?? 'unknown';
  }
  if (Node.isPropertyAccessExpression(expression)) {
    return requestSourceExpression(expression) ? 'tainted' : 'unknown';
  }
  if (Node.isElementAccessExpression(expression)) {
    return requestSourceExpression(expression) ? 'tainted' : 'unknown';
  }
  if (Node.isBinaryExpression(expression)) {
    const operator = expression.getOperatorToken().getKind();
    if (operator !== SyntaxKind.PlusToken) return 'unknown';
    return joinSqlTextSafety(
      sqlTextSafety(expression.getLeft(), scopes),
      sqlTextSafety(expression.getRight(), scopes),
    );
  }
  if (Node.isArrayLiteralExpression(expression)) {
    return expression.getElements().some((item) => sqlTextSafety(item, scopes) !== 'literal')
      ? 'unknown'
      : 'literal';
  }
  return requestSourceExpression(expression) ? 'tainted' : 'unknown';
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
  scopes: ReadonlyMap<Node, ReadonlyMap<string, SqlTextSafety>>,
): SqlTextSafety {
  if (!expression) return 'unknown';
  const node = unwrappedStaticExpressionNode(expression);
  if (Node.isObjectLiteralExpression(node)) {
    const allow = node.getProperty('allow');
    if (!Node.isPropertyAssignment(allow)) return 'unknown';
    return sqlAllowlistSafety(allow.getInitializer(), scopes);
  }
  if (Node.isArrayLiteralExpression(node)) {
    return node.getElements().every((item) => sqlAllowlistLiteral(item))
      ? 'literal'
      : combineSqlTextSafetyForNodes(node.getElements(), scopes);
  }
  if (Node.isIdentifier(node)) return bindingSafety(node, scopes) ?? 'unknown';
  return requestSourceExpression(node) ? 'tainted' : 'unknown';
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

function sqlJoinSafety(
  expression: CallExpression,
  scopes: ReadonlyMap<Node, ReadonlyMap<string, SqlTextSafety>>,
): SqlTextSafety {
  const [parts, separator] = expression.getArguments();
  const partSafety = sqlJoinPartsSafety(parts, scopes);
  const separatorSafety = separator ? sqlTextSafety(separator, scopes) : 'literal';
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
  scopes: ReadonlyMap<Node, ReadonlyMap<string, SqlTextSafety>>,
): SqlTextSafety {
  if (!expression) return 'unknown';
  const node = unwrappedStaticExpressionNode(expression);
  if (Node.isArrayLiteralExpression(node)) {
    return combineSqlTextSafetyForNodes(node.getElements(), scopes);
  }
  if (Node.isIdentifier(node)) return bindingSafety(node, scopes) ?? 'unknown';
  return requestSourceExpression(node) ? 'tainted' : 'unknown';
}

function combineSqlTextSafetyForNodes(
  nodes: readonly Node[],
  scopes: ReadonlyMap<Node, ReadonlyMap<string, SqlTextSafety>>,
): SqlTextSafety {
  let sawSafe = false;
  for (const node of nodes) {
    const safety = sqlTextSafety(node, scopes);
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

function bindingSafety(
  identifier: Node,
  scopes: ReadonlyMap<Node, ReadonlyMap<string, SqlTextSafety>>,
): SqlTextSafety | undefined {
  let scope: Node | undefined = nearestSqlSafetyScope(identifier);
  const name = identifier.getText();
  while (scope) {
    const binding = scopes.get(scope)?.get(name);
    if (binding) return binding;
    scope = nearestSqlSafetyScope(scope.getParent());
  }
  return undefined;
}

function nearestSqlSafetyScope(node: Node | undefined): Node {
  let current = node;
  while (current) {
    if (
      Node.isFunctionDeclaration(current) ||
      Node.isFunctionExpression(current) ||
      Node.isArrowFunction(current) ||
      Node.isSourceFile(current)
    ) {
      return current;
    }
    current = current.getParent();
  }
  return node?.getSourceFile() ?? (undefined as never);
}

function requestSourceExpression(expression: Node): boolean {
  const text = expression.getText();
  return (
    /\b(input|form|headers|cookies)\b/.test(text) ||
    /\breq\.(search|params|headers|cookies)\b/.test(text)
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
): TouchGraph {
  const unresolvedIdentifiers = new Set<string>(extraUnresolvedIdentifiers);
  const graph: Record<string, TouchGraphEntry> = {};
  const graphSummaries = new Map<string, FunctionTouchSummary>();

  for (const file of files) {
    const fileTables = tablesForFile(file, sourceContext);
    for (const identifier of extractUnresolvedConditionalIdentifiers(file, fileTables)) {
      unresolvedIdentifiers.add(identifier);
    }
  }

  for (const file of files) {
    const fileTables = tablesForFile(file, sourceContext);
    const functions = functionsForFile(file);
    const rawTablesByDomainWrite = rawTablesByDomainWriteCallback(file);
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
      const rawTables = [...(rawTablesByDomainWrite.get(fn.name) ?? [])];
      if (reads.length > 0 || writes.length > 0 || unresolved.length > 0 || rawTables.length > 0) {
        const graphSummary = graphSummaries.get(fn.name) ?? {
          reads: [],
          unresolved: [],
          writes: [],
        };
        mergeSummary(graphSummary, { rawTables, reads, unresolved, writes });
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
  const extraction = createProjectExtraction(options);
  try {
    const sourceContext = projectSourceModuleContext(extraction);
    const projectFunctionExtractions = projectFunctionExtractionsByFileName(extraction);

    return extractTouchGraphFromPreparedFiles(
      extraction.files,
      (file) => projectFunctionsForFile(file, projectFunctionExtractions),
      sourceContext,
      projectUnresolvedConditionalTableExpressions(extraction),
    );
  } finally {
    extraction.dispose();
  }
}

/** @internal */
/** @internal */ export function extractQueryFactsFromProject(
  options: TouchGraphProjectOptions,
): QueryFact[] {
  const extraction = createProjectExtraction(options);
  try {
    const sourceContext = projectSourceModuleContext(extraction);
    const contextFiles = projectContextFiles(extraction);
    const projectFunctionExtractions = projectFunctionExtractionsByFileName(extraction);
    return extractQueryFactsFromPreparedFiles(
      extraction.files,
      (file) => {
        const index = extraction.files.findIndex(
          (candidate) => candidate.fileName === file.fileName,
        );
        const sourceFile = extraction.sourceFiles[index];
        if (!sourceFile) return [];

        return extractProjectQueryDefinitions(sourceFile, {
          ...(file.columnShapes ? { columnShapes: file.columnShapes } : {}),
          localFunctionReceiverParameters: functionReceiverParametersByKey(
            (projectFunctionExtractions.get(file.fileName) ?? new Map()).values(),
          ),
          namespaceTableNames: projectNamespaceTableNamesByLocal(
            sourceFile,
            extraction.tableNamesBySymbol,
          ),
          relationalTableNames: projectRelationalTableNamesByProperty(
            sourceFile,
            extraction.tableNamesBySymbol,
          ),
          unmodeledRelationNamesBySymbol: extraction.unmodeledRelationNamesBySymbol,
          tableNamesBySymbol: extraction.tableNamesBySymbol,
        });
      },
      contextFiles,
      sourceContext,
      (file) => projectFunctionsForFile(file, projectFunctionExtractions),
    );
  } finally {
    extraction.dispose();
  }
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
  ownerDomains: { domain: string; owner: string }[];
  scopeAudits: ScopeAuditFact[];
} {
  const ownerDomains = ownerDomainsFromProject(options);
  // SPEC §10.3 / KV414: "a query OR write" reaching an owner table. Reads and writes
  // are both audited (A1 added the write half, which the framework never produced).
  const scopeAudits = [
    ...scopeAuditsFromQueryFacts(extractQueryFactsFromProject(options), ownerDomains),
    ...scopeAuditsFromWriteFacts(
      extractWriteScopeFactsFromProject(options),
      ownerDomains.map((owner) => owner.domain),
    ),
  ];
  return { ownerDomains, scopeAudits };
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
  const extraction = createProjectExtraction(options);
  try {
    const sourceContext = projectSourceModuleContext(extraction);
    const contextFiles = projectContextFiles(extraction);
    const projectFunctionExtractions = projectFunctionExtractionsByFileName(extraction);
    const facts: WriteScopeFact[] = [];

    for (const file of contextFiles) {
      const fileTables = tablesForFile(file, sourceContext);
      for (const fn of projectFunctionsForFile(file, projectFunctionExtractions)) {
        if (fn.summaryOnly) continue;
        facts.push(...writeScopeFactsForFunction(fn, fileTables));
      }
    }

    return facts.sort(
      (left, right) => left.name.localeCompare(right.name) || left.site.localeCompare(right.site),
    );
  } finally {
    extraction.dispose();
  }
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
    const sessionAnchoredWrites = querySessionAnchoredDomains(call.instanceKeyComparisons, tables);

    facts.push({
      argScopedWrites,
      ...(argScopedWriteKeys.length > 0 ? { argScopedWriteKeys } : {}),
      name: fn.name,
      reads: [...domains].sort(),
      sessionAnchoredWrites,
      site: call.site ?? '',
    });
  }

  return facts;
}

function ownerDomainsFromProject(
  options: TouchGraphProjectOptions,
): { domain: string; owner: string }[] {
  const extraction = createProjectExtraction(options);
  try {
    const sourceContext = projectSourceModuleContext(extraction);
    const tables: ExtractedTable[] = [];
    for (const file of projectContextFiles(extraction)) {
      for (const entries of tablesForFile(file, sourceContext).values()) {
        tables.push(...entries);
      }
    }
    return ownerDomainsFromTables(tables);
  } finally {
    extraction.dispose();
  }
}

/** @internal */
/** @internal */ export function extractMaterializedViewRefreshFactsFromProject(
  options: TouchGraphProjectOptions,
): MaterializedViewRefreshFact[] {
  const extraction = createProjectExtraction(options);
  try {
    const sourceContext = projectSourceModuleContext(extraction);
    const contextFiles = projectContextFiles(extraction);
    const projectFunctionExtractions = projectFunctionExtractionsByFileName(extraction);
    const facts: MaterializedViewRefreshFact[] = [];

    for (const file of contextFiles) {
      const fileTables = tablesForFile(file, sourceContext);
      for (const fn of projectFunctionsForFile(file, projectFunctionExtractions)) {
        if (fn.summaryOnly) continue;
        facts.push(...materializedViewRefreshFactsForFunction(fn, file, fileTables));
      }
    }

    return facts.sort(
      (left, right) =>
        left.mutation.localeCompare(right.mutation) ||
        left.view.localeCompare(right.view) ||
        left.domain.localeCompare(right.domain) ||
        left.site.localeCompare(right.site),
    );
  } finally {
    extraction.dispose();
  }
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
): QueryFact[] {
  const facts: QueryFact[] = [];
  const unresolvedIdentifiers = unresolvedConditionalIdentifiersForFiles(
    contextFiles,
    sourceContext,
  );

  for (const [index, file] of files.entries()) {
    const contextFile = contextFiles[index] ?? file;
    const fileTables = tablesForFile(contextFile, sourceContext);
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
      const helperReads = localHelperSummary.reads.map((read) => read.table.domain);
      const diagnostics = opaqueProjectionDiagnostics(
        query.query,
        query.opaquePaths,
        site,
        query.hasOutputSchema,
      )
        .concat(
          secretProjectionBackstopDiagnostics(
            query.query,
            [...query.opaquePaths, ...query.unresolvedPaths],
            query.shape,
            query.tableExpressions,
            columnShapes,
            fileTables,
            site,
          ),
        )
        .concat(tableRowProjectionDiagnostics(query.query, query.shape, site))
        .concat(unresolvedProjectionDiagnostics(query.query, query.unresolvedPaths, site))
        .concat(query.diagnostics?.map((diagnostic) => ({ ...diagnostic, site })) ?? [])
        .concat(unmodeledRelationReadDiagnostics(query.tableExpressions, fileTables, site))
        .concat(exemptQueryReadDiagnostics(query.tableExpressions, fileTables, site))
        .concat(localQueryHelperDiagnostics(localHelperSummary));
      const allReads = [...new Set([...reads, ...declaredReads, ...helperReads])].sort();
      if (!query.hasSelection && allReads.length === 0 && diagnostics.length === 0) continue;

      const sessionAnchoredReads = querySessionAnchoredDomains(
        query.instanceKeyComparisons,
        fileTables,
      );
      const ownerScopedSessionReads = queryOwnerSessionAnchoredDomains(
        query.instanceKeyComparisons,
        fileTables,
      );
      const instanceKey = queryInstanceKey(query.instanceKeyComparisons, fileTables);
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
      facts.push({
        ...(argScopedReads.length > 0 ? { argScopedReads } : {}),
        ...(argScopedReadKeys.length > 0 ? { argScopedReadKeys } : {}),
        ...(diagnostics.length > 0 ? { diagnostics } : {}),
        ...(hasClientArgPredicate ? { hasClientArgPredicate } : {}),
        ...instanceKey,
        ...(ownerScopedSessionReads.length > 0 ? { ownerScopedSessionReads } : {}),
        query: query.query,
        reads: allReads,
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
  projectionPaths: readonly string[],
  shape: QueryShape,
  tableExpressions: readonly string[],
  columnShapes: Readonly<Record<string, QueryShape>>,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
  site: string,
): TouchGraphDiagnostic[] {
  const revealedPaths = revealedQueryShapePaths(shape);
  const paths = [...new Set(projectionPaths)].filter((path) => !revealedPaths.has(path)).sort();
  if (paths.length === 0) return [];

  const secretTables = tableExpressions
    .flatMap((table) =>
      tableHasSecretColumn(columnShapes, table)
        ? secretBackstopTableDisplayNames(tables, table)
        : [],
    )
    .sort();
  if (secretTables.length === 0) return [];

  const definition = diagnosticDefinitions.KV435;
  const tableList = [...new Set(secretTables)].join(', ');
  return paths.map((path) => ({
    code: 'KV435',
    message: `${definition.message} Query projection ${query}.${path} is opaque or unresolved while reading secret-classified table(s): ${tableList}. Remove the opaque projection, select explicit non-secret columns, or wrap a reviewed projection in trustedReveal(...).`,
    severity: definition.severity,
    site,
  }));
}

function tableRowProjectionDiagnostics(
  query: string,
  shape: QueryShape,
  site: string,
): TouchGraphDiagnostic[] {
  const definition = diagnosticDefinitions.KV439;
  return tableRowQueryShapePaths(shape).map((path) => ({
    code: 'KV439',
    message: `${definition.message} Query projection ${pathForQueryDiagnostic(query, path)} carries table-row provenance; select explicit fields instead.`,
    severity: definition.severity,
    site,
  }));
}

function tableRowQueryShapePaths(shape: QueryShape, path: readonly string[] = []): string[] {
  if (typeof shape !== 'object' || shape === null) return [];
  if (Array.isArray(shape)) return shape.flatMap((item) => tableRowQueryShapePaths(item, path));

  if (isQueryShapeWrapper(shape)) {
    if (shape.kind === 'table-row') return [path.join('.') || '$'];
    return tableRowQueryShapePaths(shape.shape, path);
  }

  return Object.entries(shape).flatMap(([key, child]) =>
    tableRowQueryShapePaths(child, [...path, key]),
  );
}

function pathForQueryDiagnostic(query: string, path: string): string {
  return path === '$' ? query : `${query}.${path}`;
}

function revealedQueryShapePaths(
  shape: QueryShape,
  path: readonly string[] = [],
  paths = new Set<string>(),
): ReadonlySet<string> {
  if (typeof shape !== 'object' || shape === null) return paths;
  if (Array.isArray(shape)) {
    for (const item of shape) revealedQueryShapePaths(item, path, paths);
    return paths;
  }

  if (isQueryShapeWrapper(shape)) {
    if (shape.kind === 'revealed') paths.add(path.join('.') || '$');
    revealedQueryShapePaths(shape.shape, path, paths);
    return paths;
  }

  for (const [key, child] of Object.entries(shape)) {
    revealedQueryShapePaths(child, [...path, key], paths);
  }
  return paths;
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

function queryShapeContainsSecret(shape: QueryShape): boolean {
  if (typeof shape !== 'object' || shape === null) return false;
  if (Array.isArray(shape)) return shape.some(queryShapeContainsSecret);

  if ('kind' in shape && 'shape' in shape) {
    if (shape.kind === 'secret') return true;
    return queryShapeContainsSecret(shape.shape);
  }

  return Object.values(shape).some(queryShapeContainsSecret);
}

function unresolvedConditionalIdentifiersForFiles(
  files: readonly SourceFileInput[],
  sourceContext: SourceModuleContext,
): Set<string> {
  const unresolvedIdentifiers = new Set<string>();

  for (const file of files) {
    const fileTables = tablesForFile(file, sourceContext);
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
    diagnostics.push({
      code: 'KV406',
      message: `${diagnosticDefinitions.KV406.message} Query local helper touches Drizzle table via ${write.operation}().`,
      severity: diagnosticDefinitions.KV406.severity,
      site: write.site,
    });
  }

  for (const unresolved of summary.unresolved) {
    diagnostics.push({
      code: 'KV406',
      message: `${diagnosticDefinitions.KV406.message} Query local helper has unresolved Drizzle ${unresolved.operation}().`,
      severity: diagnosticDefinitions.KV406.severity,
      site: unresolved.site,
    });
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
  declaredReadExpressions: readonly string[];
  diagnostics?: readonly TouchGraphDiagnostic[];
  hasOutputSchema: boolean;
  hasSelection: boolean;
  index: number;
  instanceKeyComparisons: QueryInstanceKeyComparisons;
  localHelperCalls: readonly string[];
  opaquePaths: readonly string[];
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
    relationalTableName: (name) => options.relationalTableNames.get(name),
  });
}

interface QueryDefinitionOptions {
  columnShapes?: Readonly<Record<string, QueryShape>>;
  localFunctionReceiverParameters?: ReadonlyMap<string, readonly ReceiverParameterRequirement[]>;
  readTableIdentifier?: (node: Node) => string | undefined;
  receiverMode?: 'project' | 'source';
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

    const expression = queryCall.getExpression();
    if (!Node.isIdentifier(expression) || expression.getText() !== 'query') continue;

    const [queryArgument, bodyArgument] = queryCall.getArguments();
    if (!Node.isStringLiteral(queryArgument)) {
      continue;
    }

    const query = queryArgument.getLiteralText();
    // SPEC §11.1 (v1 scope): query facts require project-mode ts-morph type proof; the
    // source-mode receiver/table heuristics were removed in v1-cleanup item 4.
    const receiverMode = options.receiverMode ?? 'project';
    const bodyResolution = queryBodyObjectLiteral(bodyArgument, receiverMode);
    if (!bodyResolution.body) {
      if (bodyResolution.unresolved) {
        definitions.push({
          declaredReadExpressions: [],
          diagnostics: [unresolvedQueryLoadCallbackDiagnostic()],
          hasOutputSchema: false,
          hasSelection: false,
          index: declaration.getStart(),
          instanceKeyComparisons: { argCandidates: [], instanceKey: [] },
          localHelperCalls: [],
          opaquePaths: [],
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
    const selection =
      selectShapeFromQueryBody(
        bodyObject,
        receiverReferences,
        options.columnShapes,
        receiverMode,
      ) ?? relationalShapeFromQueryBody(bodyObject, receiverReferences, options.columnShapes);
    const hasOutputSchema = objectHasProperty(bodyObject, 'output');
    const declaredReadExpressions = queryDeclaredReadExpressions(
      bodyObject,
      options.readTableIdentifier,
    );
    const declaredOpaqueRead = hasOutputSchema && declaredReadExpressions.length > 0;
    const readResolutionOptions: QueryReadResolutionOptions = {
      ...(options.readTableIdentifier ? { readTableIdentifier: options.readTableIdentifier } : {}),
      ...(options.relationalTableName ? { relationalTableName: options.relationalTableName } : {}),
    };
    const diagnostics = [
      ...(bodyResolution.unresolved ? [unresolvedQueryLoadCallbackDiagnostic()] : []),
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
      ),
      localHelperCalls,
      opaquePaths: selection?.opaquePaths ?? [],
      query,
      shape: selection?.shape ?? queryOutputShape(bodyObject) ?? {},
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
    return [dynamicDeclaredReadsDiagnostic()];
  }
  for (const element of reads.getElements()) {
    const expression = unwrappedStaticExpressionNode(element);
    if (Node.isIdentifier(expression) || Node.isPropertyAccessExpression(expression)) continue;
    return [dynamicDeclaredReadsDiagnostic()];
  }
  return [];
}

function dynamicDeclaredReadsDiagnostic(): TouchGraphDiagnostic {
  return {
    code: 'KV410',
    message: `${diagnosticDefinitions.KV410.message} Opaque query reads must be a fully static table list; dynamic or spread reads fail closed.`,
    severity: diagnosticDefinitions.KV410.severity,
    site: '',
  };
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
  const domain = stringPropertyFromObject(annotationObject, 'domain');
  if (!domain) return null;
  const key = columnNamePropertyFromObject(annotationObject, 'key');
  const owner = columnNamePropertyFromObject(annotationObject, 'owner');
  const secret = secretPropertyFromObject(annotationObject);
  const confidentialAtRest = confidentialAtRestPropertyFromObject(annotationObject);
  const governed = governedPropertyFromObject(annotationObject);
  const atomic = concurrencyColumnsFromObject(annotationObject, 'atomic');
  const version = concurrencyColumnsFromObject(annotationObject, 'version');
  const fans = fanAnnotationsFromObject(annotationObject);
  return {
    domain,
    ...(atomic === undefined ? {} : { atomic }),
    ...(confidentialAtRest === undefined ? {} : { confidentialAtRest }),
    ...(fans.length > 0 ? { fans } : {}),
    ...(governed === undefined ? {} : { governed }),
    ...(key ? { key } : {}),
    ...(owner ? { owner } : {}),
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

  const domain = stringPropertyFromObject(viewObject, 'of');
  if (!domain) return null;

  const refresh = stringPropertyFromObject(viewObject, 'refresh');
  const annotation: KovoDomainTableAnnotation & {
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
): annotation is KovoDomainTableAnnotation & { name: string } {
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

    const domain = stringPropertyFromObject(element, 'domain');
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
  tablesForFile,
  withParsedSourceFile,
  type SourceModuleContext,
} from './static/tables.js';
/** @internal */
export { projectTablesBySyntheticName } from './static/tables.js';
import {
  domainWriteObject,
  functionReceiverParametersByKey,
  rawTablesByDomainWriteCallback,
  rawTablesFromWriteInitializer,
  unresolvedDomainWriteCallbacks,
  writeActionCallbackFunction,
  writeCallbackFunction,
  domainWriteProperties,
  extractedFunctionKey,
  typeHasOpaqueStringMembers,
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
  queryShapeFromObjectLiteralNode,
  receiverMethodAliasQueryDiagnostics,
  referencedQueryCallbackFunction,
  relationalQueryDiagnostics,
  relationalShapeFromQueryBody,
  scalarProjectionTable,
  scalarQueryShape,
  selectCallDisplayName,
  selectCallFromQueryBody,
  selectShapeFromQueryBody,
  sourceDestructuredQueryReceiverDiagnostics,
  sourceQueryDestructuredReceiverNames,
  staticFactoryBlockReturnExpression,
  staticLiteralContainerExpression,
  staticTsElementAccessName,
  staticTsExpressionPath,
  symbolForStaticMemberReference,
  tableExpressionBase,
  typedSqlProjectionShape,
  unclassifiedQueryReceiverDiagnostics,
  unprovenDestructuredReceiverReferences,
  unresolvedProjectionDiagnostics,
  unresolvedQueryCallbackDiagnostics,
  unresolvedQueryLoadCallbackDiagnostic,
  volatileTimeShape,
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
  projectRelationalTableNamesByProperty,
  projectTableNameForColumnShapeAccess,
  projectTableNamesBySymbol,
  projectUnmodeledRelationNameForNode,
  projectUnmodeledRelationNameForSymbol,
  projectUnmodeledRelationNamesBySymbol,
  projectUnresolvedConditionalTableExpressions,
  propertyNameText,
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
  queryOwnerSessionAnchoredDomains,
  queryPrivateScopeKeyOperand,
  queryReadDomains,
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
  queryOwnerSessionAnchoredDomains,
  queryPrivateScopeKeyOperand,
  queryReadDomains,
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
  projectSourceFileName,
  type ProjectExtraction,
} from './static/project-setup.js';
/** @internal */
export {
  emptySessionProvenanceContext,
  opaqueAliasReasonForExpression,
  privateScopeForExpression,
  privateScopeKey,
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
} from './static/symbol-provenance.js';
/** @internal */
export {
  computedPropertyNameExpression,
  isDrizzleDatabaseTypeAnnotation,
  isDrizzleWriteCall,
  isProjectTableInitializerNode,
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
  extractQueryWriteReachabilityFromProject,
  extractSymbolicEffectsFromProject,
  extractToctouFromProject,
} from './static/derivation.js';
/** @internal */
/** @internal */ export type { SymbolicEffectFact } from './static/derivation.js';
