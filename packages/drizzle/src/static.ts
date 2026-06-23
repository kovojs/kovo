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
import type { ScopeAuditFact, TouchGraph, TouchGraphEntry } from '@kovojs/core/internal/graph';
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
export type {
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
export type {
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

export const IGNORED_LOCAL_CALL_NAMES = new Set([
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
const KV411_MESSAGE = 'Query read set includes an exempt table';
export const UNRESOLVED_READ_SOURCE_EXPRESSION = '__kovoUnresolvedReadSource';
export const BOOLEAN_COLUMN_BUILDERS = new Set(['boolean']);
export const JSON_COLUMN_BUILDERS = new Set(['json', 'jsonb']);
export const NUMBER_COLUMN_BUILDERS = new Set([
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
export const UNCLASSIFIED_DRIZZLE_RECEIVER_MUTATION_METHODS = new Set(['$count', 'execute']);
export const DRIZZLE_SELECT_QUERY_METHODS = new Set(['select', 'selectDistinct', 'selectDistinctOn']);
export const DRIZZLE_CORE_MODULE_SPECIFIERS = new Set(['drizzle-orm/pg-core', 'drizzle-orm/sqlite-core']);
export const DRIZZLE_UNMODELED_RELATION_FACTORY_NAMES = new Set([
  'pgMaterializedView',
  'pgView',
  'sqliteView',
]);
export const CLASSIFIED_DRIZZLE_RECEIVER_METHODS = new Set([
  ...DRIZZLE_SELECT_QUERY_METHODS,
  'delete',
  'insert',
  'refreshMaterializedView',
  'transaction',
  'update',
  'with',
]);
export const COMPUTED_DRIZZLE_RECEIVER_METHOD = '<computed>';
export const UNRESOLVED_DOMAIN_WRITE_COMPUTED_MEMBER = '<computed>';
export const UNRESOLVED_DOMAIN_WRITE_SPREAD_MEMBER = '<spread>';
export const UNMODELED_RELATION_EXPRESSION_PREFIX = '__kovoUnmodeledRelation';
export const DRIZZLE_STATIC_PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));
export const TOUCH_BODY_ITERATION_CALLBACK_METHODS = new Set([
  'filter',
  'flatMap',
  'forEach',
  'map',
  'reduce',
]);

/** @internal */
export type QueryShape =
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
export interface QueryShapeWrapper {
  kind: 'nullable' | 'optional' | 'volatile-time';
  shape: QueryShape;
}

/** @internal */
export interface QueryFact {
  /**
   * Owner-annotated domains this query selects through a client-visible `input.*`
   * arg compared against ANY column of the domain's table (SPEC §10.3, KV414, A3) —
   * not just the declared `key:` column, so `where(eq(orders.userId, input.userId))`
   * on `{ key: id, owner: userId }` is still flagged `args`/IDOR.
   */
  argScopedReads?: readonly string[];
  diagnostics?: readonly TouchGraphDiagnostic[];
  instanceKey?: {
    domain: string;
    key: string;
  };
  query: string;
  reads: readonly string[];
  /** Domains this query anchors to `req.session.*` (session-scoped, SPEC §11.1). */
  sessionAnchoredReads?: readonly string[];
  shape: QueryShape;
  site: string;
}

/**
 * Scope-audit facts for reads of an `owner:`-annotated domain (SPEC §10.3). The
 * KV414 IDOR signal is precisely a **client-visible `args.*` key**, so this emits:
 * `args` for an arg-keyed read (the IDOR candidate the CLI enforces unless an
 * `owns()` guard discharges it) and `session` for a directly `req.session`-anchored
 * read (safe). A read that is **neither** — e.g. one keyed by a local bound from
 * the session (`const userId = …session…; where(eq(col, userId))`) — emits **no
 * fact**: it is not a client-controlled key, so it is not the IDOR pattern, and
 * skipping it avoids false-positiving a safe app without needing inter-procedural
 * session data-flow tracing.
 */
export function scopeAuditsFromQueryFacts(
  facts: readonly QueryFact[],
  ownerDomains: Iterable<string>,
): ScopeAuditFact[] {
  const owners = new Set(ownerDomains);
  const audits: ScopeAuditFact[] = [];

  for (const fact of facts) {
    for (const domain of fact.reads) {
      if (!owners.has(domain)) continue;

      // SPEC §10.3 / KV414. `args` is the IDOR signal and is fail-closed: a
      // client-visible `input.*` arg keying the declared key column (A1/legacy),
      // OR any owner-table column (A3, `argScopedReads`), flags KV414 even when the
      // same predicate is also session-anchored.
      const argKeyed =
        (fact.instanceKey?.domain === domain && fact.instanceKey.key.startsWith('arg:')) ||
        (fact.argScopedReads ?? []).includes(domain);
      if (argKeyed) {
        audits.push({ domain, kind: 'query', name: fact.query, scope: 'args', site: fact.site });
        continue;
      }

      if ((fact.sessionAnchoredReads ?? []).includes(domain)) {
        audits.push({ domain, kind: 'query', name: fact.query, scope: 'session', site: fact.site });
      }
    }
  }

  return audits;
}

/**
 * A write touch on an owner-annotated domain, with the `args`/`session` domains its
 * `where()` predicate selects (SPEC §10.3, KV414 A1). The write half of the IDOR gate:
 * `scopeAuditsFromQueryFacts` covers reads; this covers `db.update/delete(...)` writes.
 *
 * @internal
 */
export interface WriteScopeFact {
  /** Owner-table domains keyed by a client-visible `input.*` arg (any column) → `args`/IDOR. */
  argScopedWrites: readonly string[];
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
export function scopeAuditsFromWriteFacts(
  facts: readonly WriteScopeFact[],
  ownerDomains: Iterable<string>,
): ScopeAuditFact[] {
  const owners = new Set(ownerDomains);
  const audits: ScopeAuditFact[] = [];

  for (const fact of facts) {
    for (const domain of fact.reads) {
      if (!owners.has(domain)) continue;

      // Fail-closed: an arg-keyed owner write is IDOR even if also session-anchored.
      if (fact.argScopedWrites.includes(domain)) {
        audits.push({ domain, kind: 'write', name: fact.name, scope: 'args', site: fact.site });
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
export interface SourceFileInput {
  columnShapes?: Readonly<Record<string, QueryShape>>;
  fileName: string;
  source: string;
}

/** @internal */
export interface TouchGraphProjectOptions {
  compilerOptions?: CompilerOptions;
  files: readonly SourceFileInput[];
}

export type ExtractedTableAnnotation =
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
export interface MaterializedViewRefreshFact {
  domain: string;
  mutation: string;
  optimisticStatus: 'await-fragment';
  refresh: 'async';
  site: string;
  view: string;
}

export interface ExtractedTable {
  annotation: ExtractedTableAnnotation;
  columns: Readonly<Record<string, QueryShape>>;
  exported: boolean;
  foreignKeys?: readonly ExtractedForeignKey[];
}

export interface ExtractedForeignKey {
  column: string;
  onDelete?: string;
  onUpdate?: string;
  targetTableExpression: string;
}

/** @internal */
export function diagnosticsForQueryFacts(facts: readonly QueryFact[]): TouchGraphDiagnostic[] {
  return facts.flatMap((fact) => [...(fact.diagnostics ?? [])]);
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
export function extractTouchGraphFromProject(options: TouchGraphProjectOptions): TouchGraph {
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
export function extractQueryFactsFromProject(options: TouchGraphProjectOptions): QueryFact[] {
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
export function extractOwnerAuditFromProject(options: TouchGraphProjectOptions): {
  ownerDomains: { domain: string; owner: string }[];
  scopeAudits: ScopeAuditFact[];
} {
  const ownerDomains = ownerDomainsFromProject(options);
  const ownerDomainNames = ownerDomains.map((owner) => owner.domain);
  // SPEC §10.3 / KV414: "a query OR write" reaching an owner table. Reads and writes
  // are both audited (A1 added the write half, which the framework never produced).
  const scopeAudits = [
    ...scopeAuditsFromQueryFacts(extractQueryFactsFromProject(options), ownerDomainNames),
    ...scopeAuditsFromWriteFacts(extractWriteScopeFactsFromProject(options), ownerDomainNames),
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
export function extractWriteScopeFactsFromProject(
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
    const sessionAnchoredWrites = querySessionAnchoredDomains(call.instanceKeyComparisons, tables);

    facts.push({
      argScopedWrites,
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
export function extractMaterializedViewRefreshFactsFromProject(
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
      facts.push({
        ...(argScopedReads.length > 0 ? { argScopedReads } : {}),
        ...(diagnostics.length > 0 ? { diagnostics } : {}),
        ...instanceKey,
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

export interface ExtractedFunction {
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

export interface ReceiverParameterRequirement {
  index: number;
  names: readonly string[];
  symbolKeys: readonly string[];
}

interface ExtractedQueryDefinition {
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

interface QueryInstanceKeyComparison {
  left: QueryInstanceKeyOperand;
  right: QueryInstanceKeyOperand;
}

interface QueryInstanceKeyOperand {
  inputKey?: string;
  privateKey?: string;
  sessionKey?: string;
  tableKey?: {
    key: string;
    tableIdentifier: string;
  };
}

export type PrivateScopeKind = 'guard' | 'session' | 'tenant';

export interface PrivateScopeProvenance {
  kind: PrivateScopeKind;
  path: string;
  requiresGuard?: boolean;
}

export interface SessionAlias {
  declaration: Node;
  kind: PrivateScopeKind;
  name: string;
  path: string;
  requiresGuard: boolean;
}

export interface SessionProvenanceContext {
  aliases: ReadonlyMap<string, SessionAlias>;
  helpers: ReadonlyMap<string, PrivateScopeProvenance>;
  opaqueAliases: Map<string, string>;
}

export interface ExtractedWriteCall {
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

interface ExtractedReadSource {
  operation: 'delete-predicate' | 'insert-select' | 'update-from' | 'update-predicate';
  tableExpression: string;
}

export interface ExtractedReadCall {
  index: number;
  operation: 'relational-query' | 'select';
  site?: string;
  tableExpression: string;
}

interface ExtractedPredicateSummary {
  key?: string;
  predicate?: 'non-eq';
}

interface ExtractedPredicateFact {
  argumentKey?: string;
  key: string;
  predicate?: 'non-eq';
  tableIdentifier: string;
}

interface FunctionTouchSummary {
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
    const selection = selectShapeFromQueryBody(
      bodyObject,
      receiverReferences,
      options.columnShapes,
      receiverMode,
    );
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

function queryReadDomains(
  tableExpressions: readonly string[],
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): string[] {
  const domains = new Set<string>();

  for (const tableExpression of tableExpressions) {
    for (const table of tables.get(tableExpression) ?? []) {
      if (!isDomainExtractedTableAnnotation(table.annotation)) continue;
      domains.add(table.annotation.domain);
    }
  }

  return [...domains].sort();
}

function exemptQueryReadDiagnostics(
  tableExpressions: readonly string[],
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
  site: string,
): TouchGraphDiagnostic[] {
  const exemptTables = new Set<string>();

  for (const tableExpression of tableExpressions) {
    for (const table of tables.get(tableExpression) ?? []) {
      if (isExemptExtractedTableAnnotation(table.annotation))
        exemptTables.add(table.annotation.name);
    }
  }

  if (exemptTables.size === 0) return [];

  return [
    {
      code: 'KV411',
      message: `${KV411_MESSAGE}. Tables: ${[...exemptTables].sort().join(', ')}.`,
      severity: 'error',
      site,
    },
  ];
}

function unmodeledRelationReadDiagnostics(
  tableExpressions: readonly string[],
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
  site: string,
): TouchGraphDiagnostic[] {
  const relations = tableExpressions
    .filter((expression) => (tables.get(expression) ?? []).length === 0)
    .map(unmodeledRelationFromExpression)
    .filter((relation): relation is UnmodeledRelationFact => relation !== undefined);
  if (relations.length === 0) return [];

  return [...new Map(relations.map((relation) => [relation.expression, relation])).values()]
    .sort(
      (left, right) => left.name.localeCompare(right.name) || left.kind.localeCompare(right.kind),
    )
    .map((relation) => ({
      code: 'KV412' as const,
      message: `${diagnosticDefinitions.KV412.message} ${relation.kind} ${relation.name} has no derived or declared domain.`,
      severity: diagnosticDefinitions.KV412.severity,
      site,
    }));
}

function queryTableExpressions(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
  options: QueryReadResolutionOptions = {},
): string[] {
  return [
    ...queryJoinTableExpressions(body, receiverReferences, options.readTableIdentifier),
    ...queryRelationalTableExpressions(body, receiverReferences, options.relationalTableName),
  ];
}

interface QueryReadResolutionOptions {
  readTableIdentifier?: (node: Node) => string | undefined;
  relationalTableName?: (name: string) => string | undefined;
}

function queryJoinTableExpressions(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
  readTableIdentifier?: (node: Node) => string | undefined,
): string[] {
  return queryBodyCallExpressions(body, queryReceiverMode(receiverReferences), (call) => {
    const name = propertyAccessCallName(call);
    if (!name || !isQueryReadCallName(name)) return [];
    if (!isQueryCallOnReceiver(call, receiverReferences)) return [];

    const tableArgument = call.getArguments()[0];
    const table = readTableIdentifier
      ? tableArgument
        ? readTableIdentifier(tableArgument)
        : undefined
      : staticExpressionPath(tableArgument);
    return table ? [table] : [];
  });
}

export function queryRelationalTableExpressions(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
  relationalTableName?: (name: string) => string | undefined,
): string[] {
  return queryBodyCallExpressions(body, queryReceiverMode(receiverReferences), (call) => {
    const expression = call.getExpression();
    const method = staticAccessName(expression);
    if (method !== 'findMany' && method !== 'findFirst') return [];

    const tableAccess = staticAccessExpression(expression);
    if (!tableAccess) return [];
    const table = staticAccessName(tableAccess);
    if (!table) return [];

    const queryAccess = staticAccessExpression(tableAccess);
    if (!queryAccess || staticAccessName(queryAccess) !== 'query') return [];
    const receiver = staticAccessExpression(queryAccess);
    // SPEC §10-§11: non-DB objects must not fabricate relational read/KV406 facts.
    if (!isQueryReceiverIdentifier(receiver, receiverReferences)) return [];

    const resolvedTable = relationalTableName ? relationalTableName(table) : table;
    return resolvedTable ? [resolvedTable] : [];
  });
}

function unresolvedQueryReadDiagnostics(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
  options: QueryReadResolutionOptions = {},
): TouchGraphDiagnostic[] {
  const diagnostics: TouchGraphDiagnostic[] = queryBodyCallExpressions(
    body,
    queryReceiverMode(receiverReferences),
    (call) => {
      const name = propertyAccessCallName(call);
      if (!name || !isQueryReadCallName(name)) return [];
      if (!isQueryCallOnReceiver(call, receiverReferences)) return [];

      const tableArgument = call.getArguments()[0];
      const table = options.readTableIdentifier
        ? tableArgument
          ? options.readTableIdentifier(tableArgument)
          : undefined
        : staticExpressionPath(tableArgument);
      if (table) return [];

      return [
        {
          code: 'KV406' as const,
          message: `${diagnosticDefinitions.KV406.message} Query read source for db.${name}() could not be resolved to a Drizzle table.`,
          severity: diagnosticDefinitions.KV406.severity,
          site: '',
        },
      ];
    },
  );

  diagnostics.push(
    ...unresolvedRelationalQueryReadDiagnostics(
      body,
      receiverReferences,
      options.relationalTableName,
    ),
  );
  return diagnostics;
}

function unresolvedRelationalQueryReadDiagnostics(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
  relationalTableName?: (name: string) => string | undefined,
): TouchGraphDiagnostic[] {
  return queryBodyCallExpressions(body, queryReceiverMode(receiverReferences), (call) => {
    const expression = call.getExpression();
    const method = staticAccessName(expression);
    if (method !== 'findMany' && method !== 'findFirst') return [];

    const tableAccess = staticAccessExpression(expression);
    const table = tableAccess ? staticAccessName(tableAccess) : undefined;
    if (!tableAccess || (table && (!relationalTableName || relationalTableName(table)))) {
      return [];
    }
    const queryAccess = staticAccessExpression(tableAccess);
    if (!queryAccess || staticAccessName(queryAccess) !== 'query') return [];
    const receiver = staticAccessExpression(queryAccess);
    if (!isQueryReceiverIdentifier(receiver, receiverReferences)) return [];

    return [
      {
        code: 'KV406' as const,
        message: `${diagnosticDefinitions.KV406.message} Query relational read source could not be resolved to a Drizzle table.`,
        severity: diagnosticDefinitions.KV406.severity,
        site: '',
      },
    ];
  });
}

export function queryBodyCallExpressions<T>(
  body: ObjectLiteralExpression,
  mode: 'project' | 'source',
  extract: (call: CallExpression) => readonly T[],
): T[] {
  // SPEC §10-§11: query facts come from executable query-loader callback surfaces; nested helper
  // bodies are summarized only when called instead of fabricating reads from declarations.
  return queryCallbackBodies(body, mode)
    .flatMap((callbackBody) => touchBodyCallExpressions(callbackBody))
    .sort((left, right) => callSourceOrder(left) - callSourceOrder(right))
    .flatMap(extract);
}

export function queryReceiverMode(receiverReferences: QueryReceiverReferences): 'project' | 'source' {
  return receiverReferences.projectContainers ? 'project' : 'source';
}

export function isQueryCallOnReceiver(
  call: CallExpression,
  receiverReferences: QueryReceiverReferences,
): boolean {
  // SPEC §11.1: read facts must originate from the Drizzle receiver, not lookalike builders.
  const receiver = queryCallChainReceiver(call);
  return isQueryReceiverIdentifier(receiver, receiverReferences);
}

export function queryCallChainReceiver(call: CallExpression): Node | undefined {
  let receiver = staticAccessExpression(call.getExpression());

  while (receiver && Node.isCallExpression(receiver)) {
    receiver = staticAccessExpression(receiver.getExpression());
  }

  return receiver;
}

/**
 * SPEC §11.1 (part-4 D1): resolve a write call's receiver through chained CTE
 * prefixes (`db.with(cte).insert(t)` ⇒ receiver `db`). Only `.with(...)` link
 * calls are unwound; any other CallExpression receiver is returned as-is so it
 * fails closed (not a project receiver identifier ⇒ KV406 surface).
 */
export function writeCallChainReceiver(receiver: Node | undefined): Node | undefined {
  let current = receiver;

  while (current && Node.isCallExpression(current)) {
    if (staticAccessName(current.getExpression()) !== 'with') break;
    current = staticAccessExpression(current.getExpression());
  }

  return current;
}

export function callSourceOrder(call: CallExpression): number {
  const expression = call.getExpression();
  return Node.isPropertyAccessExpression(expression)
    ? expression.getNameNode().getStart()
    : call.getStart();
}

export function isQueryReadCallName(name: string): boolean {
  return (
    name === 'from' ||
    name === 'innerJoin' ||
    name === 'leftJoin' ||
    name === 'rightJoin' ||
    name === 'fullJoin'
  );
}

export function isJoinReadCallName(name: string): boolean {
  return name === 'join' || isQueryReadCallName(name);
}

export function staticExpressionPath(
  node: Node | undefined,
  resolveIdentifier?: (node: Node) => string | undefined,
): string | undefined {
  if (!node) return undefined;
  const expression = unwrappedStaticExpressionNode(node);
  if (expression !== node) return staticExpressionPath(expression, resolveIdentifier);

  const resolved = resolveIdentifier?.(node);
  if (resolved) return resolved;
  if (Node.isIdentifier(node)) return resolveIdentifier?.(node) ?? node.getText();
  if (Node.isPropertyAccessExpression(node)) {
    const base = staticExpressionPath(node.getExpression(), resolveIdentifier);
    return base ? `${base}.${node.getName()}` : undefined;
  }
  if (Node.isElementAccessExpression(node)) {
    const base = staticExpressionPath(node.getExpression(), resolveIdentifier);
    const name = staticAccessName(node);
    return base && name ? `${base}.${name}` : undefined;
  }
  return undefined;
}

export function staticExpressionRootIdentifier(node: Node): Node | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  if (Node.isIdentifier(expression)) return expression;
  if (Node.isPropertyAccessExpression(expression) || Node.isElementAccessExpression(expression)) {
    return staticExpressionRootIdentifier(expression.getExpression());
  }
  if (Node.isCallExpression(expression)) {
    return staticExpressionRootIdentifier(expression.getExpression());
  }
  return undefined;
}

export function unwrappedStaticExpressionNode(node: Node): Node {
  let current = node;

  while (
    Node.isParenthesizedExpression(current) ||
    Node.isAsExpression(current) ||
    Node.isSatisfiesExpression(current) ||
    Node.isTypeAssertion(current) ||
    Node.isNonNullExpression(current)
  ) {
    current = current.getExpression();
  }

  return current;
}

export function unwrappedFunctionExpression(node: Node): ArrowFunction | FunctionExpression | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  return Node.isArrowFunction(expression) || Node.isFunctionExpression(expression)
    ? expression
    : undefined;
}

function queryInstanceKey(
  comparisons: QueryInstanceKeyComparisons,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): Pick<QueryFact, 'instanceKey'> | null {
  // SPEC §10-§11: query keys must come from real predicates, not comment/string text.
  // Only `and(...)`/top-level conjuncts (not `or(...)` branches) discharge a unique key.
  return compositeQueryInstanceKey(comparisons.instanceKey, tables);
}

/**
 * The domains a query's `where` predicates anchor to `req.session.*` (SPEC §11.1
 * session-traceability). A read of an owner-annotated domain anchored this way is
 * session-scoped (not IDOR), so it discharges KV414.
 */
function querySessionAnchoredDomains(
  comparisons: QueryInstanceKeyComparisons,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): readonly string[] {
  const domains = new Set<string>();
  for (const comparison of comparisons.instanceKey) {
    const domain = sessionAnchoredDomainFromEqOperands(comparison.left, comparison.right, tables);
    if (domain) domains.add(domain);
  }
  return [...domains].sort();
}

/**
 * SPEC §10.3 / KV414 (A3): the owner-annotated domains a query's `where` predicates
 * select through a client-visible `input.*` arg compared against ANY column of that
 * domain's table — not only the declared `key` column. This is the canonical IDOR
 * signal regardless of whether the keyed column is `key:` or `owner:` (e.g.
 * `where(eq(orders.userId, input.userId))` on `{ key: id, owner: userId }`). Includes
 * `or(...)`-branch operands (A2, fail-closed). The declared-key match in
 * `queryInstanceKey` still governs instanceKey/invalidation granularity.
 */
function queryArgScopedDomains(
  comparisons: QueryInstanceKeyComparisons,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): readonly string[] {
  const domains = new Set<string>();
  for (const comparison of comparisons.argCandidates) {
    const domain = argScopedDomainFromEqOperands(comparison.left, comparison.right, tables);
    if (domain) domains.add(domain);
  }
  return [...domains].sort();
}

function argScopedDomainFromEqOperands(
  left: QueryInstanceKeyOperand,
  right: QueryInstanceKeyOperand,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): string | null {
  const candidates = [
    { inputKey: right.inputKey, tableKey: left.tableKey },
    { inputKey: left.inputKey, tableKey: right.tableKey },
  ];

  for (const candidate of candidates) {
    if (!candidate.inputKey || !candidate.tableKey) continue;
    // A3 is purely an `owner:`-table IDOR signal — restrict to owner-annotated tables
    // so a non-owner arg read (the common safe case, e.g. `eq(products.sku, input.sku)`)
    // never pollutes the fact. The owner-domain filter in `scopeAuditsFromQueryFacts`
    // would drop a non-owner domain anyway; this keeps the fact precise.
    const domain = resolvedQueryOwnerTableDomain(candidate.tableKey, tables);
    if (domain) return domain;
  }

  return null;
}

/**
 * Resolve a `tableIdentifier.column` reference to the domain of an `owner:`-annotated
 * table regardless of which column is named (SPEC §10.1/§10.3). Contrast
 * `resolvedQueryTableKey`, which requires the declared `key:` column — A3 needs the
 * domain for an `args` predicate on ANY column of an owner table (the owner column is
 * usually not the key column), so it matches on table identity + owner-ness.
 */
function resolvedQueryOwnerTableDomain(
  key: { key: string; tableIdentifier: string },
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): string | null {
  for (const table of tables.get(key.tableIdentifier) ?? []) {
    if (
      isDomainExtractedTableAnnotation(table.annotation) &&
      typeof table.annotation.owner === 'string'
    ) {
      return table.annotation.domain;
    }
  }

  return null;
}

/**
 * Resolve a `tableIdentifier.column` reference to its domain regardless of which
 * column is named (SPEC §10.1). Contrast `resolvedQueryTableKey`, which requires the
 * declared `key:` column — used for session-anchoring detection on any domain table
 * column (matching prior declared-key behavior, now column-agnostic).
 */
function resolvedQueryTableDomain(
  key: { key: string; tableIdentifier: string },
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): string | null {
  for (const table of tables.get(key.tableIdentifier) ?? []) {
    if (isDomainExtractedTableAnnotation(table.annotation)) {
      return table.annotation.domain;
    }
  }

  return null;
}

function sessionAnchoredDomainFromEqOperands(
  left: QueryInstanceKeyOperand,
  right: QueryInstanceKeyOperand,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): string | null {
  const candidates = [
    { sessionKey: right.sessionKey, tableKey: left.tableKey },
    { sessionKey: left.sessionKey, tableKey: right.tableKey },
  ];

  for (const candidate of candidates) {
    if (!candidate.sessionKey || !candidate.tableKey) continue;
    // SPEC §11.1 (A3 symmetry): match on table identity, ANY column — not only the
    // declared `key:` column. An owner table is usually keyed `key:id, owner:userId`,
    // and the safe pattern `where(eq(orders.userId, req.session.userId))` anchors the
    // OWNER column to the session, so the declared-key-only check missed it and the
    // read fell through to the `args` IDOR branch (a false KV414 on a safe app).
    const domain = resolvedQueryTableDomain(candidate.tableKey, tables);
    if (domain) return domain;
  }

  return null;
}

/**
 * SPEC §11.1 / KV414: the `where()`-predicate `eq(...)` operand comparisons of a query.
 *
 * Two tiers, both reusing the write side's `eqPredicateConjuncts` (~:9736):
 * - `instanceKey`: top-level/`and(...)` conjuncts only — these may discharge a unique
 *   single-row instance key and a `session` scope.
 * - `argCandidates`: every `eq(...)` operand pair anywhere in the predicate tree,
 *   INCLUDING under `or(...)` (A2, fail-closed). An arg-keyed owner operand in any
 *   branch is an `args`-scope candidate that must surface KV414, but an `or`-branch
 *   does NOT pin a row, so these never discharge an instance key.
 */
function queryInstanceKeyComparisons(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
  readTableIdentifier?: (node: Node) => string | undefined,
): QueryInstanceKeyComparisons {
  const instanceKey: QueryInstanceKeyComparison[] = [];
  const argCandidates: QueryInstanceKeyComparison[] = [];
  const sessionContext = sessionProvenanceContextForNodes(
    body.getSourceFile(),
    queryCallbackBodies(body, queryReceiverMode(receiverReferences)),
  );

  for (const predicate of queryBodyCallExpressions(
    body,
    queryReceiverMode(receiverReferences),
    (call) => {
      if (propertyAccessCallName(call) !== 'where') return [];
      if (!isQueryCallOnReceiver(call, receiverReferences)) return [];
      const argument = call.getArguments()[0];
      return argument ? [argument] : [];
    },
  )) {
    const toComparison = ({ left, right }: EqPredicateConjunct): QueryInstanceKeyComparison => ({
      left: queryInstanceKeyOperand(left, readTableIdentifier, sessionContext),
      right: queryInstanceKeyOperand(right, readTableIdentifier, sessionContext),
    });

    // A2: `and(...)`/top-level `eq` conjuncts may discharge a unique instance key.
    const conjuncts = eqPredicateConjuncts(predicate);
    if (conjuncts) instanceKey.push(...conjuncts.map(toComparison));

    // A2 fail-closed: any `eq` operand anywhere (incl. `or(...)` branches) is an
    // `args`/`session` scope candidate, never an instance-key.
    argCandidates.push(...allEqOperandPairs(predicate).map(toComparison));
  }

  return { argCandidates, instanceKey };
}

interface QueryInstanceKeyComparisons {
  argCandidates: readonly QueryInstanceKeyComparison[];
  instanceKey: readonly QueryInstanceKeyComparison[];
}

/**
 * Every `eq(...)` operand pair nested anywhere under a predicate node (SPEC §11.1,
 * KV414 fail-closed). Used only for `args`/`session` scope candidacy — `or(...)`
 * branches are included here but must never discharge an instance key.
 */
function allEqOperandPairs(predicate: Node): EqPredicateConjunct[] {
  return pnfAllEqOperandPairs(predicatePnf(predicate));
}

function queryInstanceKeyOperand(
  expression: Node,
  readTableIdentifier?: (node: Node) => string | undefined,
  sessionContext: SessionProvenanceContext = emptySessionProvenanceContext(),
): QueryInstanceKeyOperand {
  return {
    ...queryTableKeyOperand(expression, readTableIdentifier),
    ...queryInputKeyOperand(expression),
    ...queryPrivateScopeKeyOperand(expression, sessionContext),
  };
}

/**
 * Detects private-scope predicate operands (SPEC §11.1): static session/tenant/
 * guard access or a same-package helper with an explicit analyzer summary. Private
 * values participate in proof but are erased from client-visible keys.
 */
function queryPrivateScopeKeyOperand(
  expression: Node,
  sessionContext: SessionProvenanceContext = emptySessionProvenanceContext(),
): Pick<QueryInstanceKeyOperand, 'privateKey' | 'sessionKey'> {
  const provenance = privateScopeForExpression(expression, sessionContext);
  if (!provenance) return {};
  return {
    privateKey: privateScopeKey(provenance),
    ...(provenance.kind === 'session' ? { sessionKey: provenance.path } : {}),
  };
}

function queryTableKeyOperand(
  expression: Node,
  readTableIdentifier?: (node: Node) => string | undefined,
): Pick<QueryInstanceKeyOperand, 'tableKey'> {
  const key = staticAccessName(expression);
  const tableIdentifier = staticExpressionPath(
    staticAccessExpression(expression),
    readTableIdentifier,
  );
  if (!tableIdentifier || !key) return {};

  return {
    tableKey: {
      key,
      tableIdentifier,
    },
  };
}

function queryInputKeyOperand(expression: Node): Pick<QueryInstanceKeyOperand, 'inputKey'> {
  const node = staticAccessExpression(expression);
  if (!Node.isIdentifier(node) || node.getText() !== 'input') return {};

  const key = staticAccessName(expression);
  return key ? { inputKey: `arg:${key}` } : {};
}

function compositeQueryInstanceKey(
  comparisons: readonly QueryInstanceKeyComparison[],
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): Pick<QueryFact, 'instanceKey'> | null {
  for (const [tableIdentifier, tableEntries] of tables) {
    for (const table of tableEntries) {
      if (!isDomainExtractedTableAnnotation(table.annotation)) continue;
      if (typeof table.annotation.key !== 'string') continue;

      const keyColumns = tableKeyColumns(table.annotation.key);
      const valuesByColumn = new Map<string, string>();
      for (const comparison of comparisons) {
        const candidate = valueKeyForTableColumnComparison(comparison, tableIdentifier);
        if (!candidate || !keyColumns.includes(candidate.column)) continue;
        valuesByColumn.set(candidate.column, candidate.valueKey);
      }
      if (!keyColumns.every((column) => valuesByColumn.has(column))) continue;

      const publicKeys = keyColumns
        .map((column) => valuesByColumn.get(column))
        .filter((valueKey): valueKey is string => valueKey !== undefined)
        .filter((valueKey) => !isPrivateScopeKey(valueKey));
      if (publicKeys.length === 0) continue;

      return { instanceKey: { domain: table.annotation.domain, key: publicKeys.join(',') } };
    }
  }

  return null;
}

function valueKeyForTableColumnComparison(
  comparison: QueryInstanceKeyComparison,
  tableIdentifier: string,
): { column: string; valueKey: string } | null {
  const candidates = [
    { tableKey: comparison.left.tableKey, value: comparison.right },
    { tableKey: comparison.right.tableKey, value: comparison.left },
  ];

  for (const candidate of candidates) {
    if (!candidate.tableKey || candidate.tableKey.tableIdentifier !== tableIdentifier) continue;
    const valueKey = candidate.value.inputKey ?? candidate.value.privateKey;
    if (!valueKey) continue;
    return { column: candidate.tableKey.key, valueKey };
  }

  return null;
}

function directSummaryForFunction(
  fn: ExtractedFunction,
  file: SourceFileInput,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
  unresolvedIdentifiers: ReadonlySet<string>,
): FunctionTouchSummary {
  const reads: ReadSummaryInput[] = [];
  const writes: WriteSummaryInput[] = [];
  const unresolved: UnresolvedSummaryInput[] = [];
  const triggerTables = triggerTableNamesFromSource(file.source);

  // SPEC §11.1: visible Drizzle read surfaces belong in the touch graph, not KV406.
  for (const call of fn.readCalls) {
    const site =
      call.site ?? `${file.fileName}:${lineForIndex(file.source, fn.bodyStart + call.index)}`;
    const resolvedTables = tables.get(call.tableExpression) ?? [];

    if (resolvedTables.length > 0) {
      for (const table of resolvedTables) {
        if (isExemptExtractedTableAnnotation(table.annotation)) continue;
        if (isUnmappedTableAnnotation(table.annotation)) {
          unresolved.push({
            code: 'KV404',
            operation: call.operation,
            site,
          });
          continue;
        }
        reads.push({
          operation: call.operation,
          site,
          table: table.annotation,
        });
      }
      continue;
    }

    unresolved.push({
      operation: call.operation,
      site,
    });
  }

  for (const call of fn.writeCalls) {
    const site =
      call.site ?? `${file.fileName}:${lineForIndex(file.source, fn.bodyStart + call.index)}`;
    const resolvedTables = tables.get(call.tableExpression) ?? [];

    appendReadSourceSummaries(reads, unresolved, call, site, tables, unresolvedIdentifiers);

    if (resolvedTables.length > 0) {
      for (const table of resolvedTables) {
        if (isExemptExtractedTableAnnotation(table.annotation)) continue;
        if (isUnmappedTableAnnotation(table.annotation)) {
          unresolved.push({
            code: 'KV404',
            operation: call.operation,
            site,
          });
          continue;
        }
        const writePredicate = predicateSummaryFromFacts(
          call.predicateFacts,
          call.tableExpression,
          table.annotation,
        );
        writes.push({
          operation: call.operation,
          site,
          table: table.annotation,
          ...(writePredicate.predicate ? { predicate: writePredicate.predicate } : {}),
          ...(writePredicate.key ? { writeKey: writePredicate.key } : {}),
        });
        appendForeignKeyCascadeWriteSummaries(writes, call, site, table.annotation, tables);
        appendDeclaredFanOutWriteSummaries(writes, call, site, table.annotation);
        appendMissingTriggerFanOutDiagnostics(
          unresolved,
          call,
          site,
          table.annotation,
          triggerTables,
        );
      }
      if (unresolvedIdentifiers.has(call.tableExpression)) {
        unresolved.push({
          operation: call.operation,
          site,
        });
      }
      continue;
    }

    unresolved.push({
      operation: call.operation,
      site,
    });
  }

  for (const call of fn.unresolvedCalls) {
    unresolved.push({
      operation: call.name,
      site: `${file.fileName}:${lineForIndex(file.source, fn.bodyStart + call.index)}`,
    });
  }

  return { reads, unresolved, writes };
}

function materializedViewRefreshFactsForFunction(
  fn: ExtractedFunction,
  file: SourceFileInput,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): MaterializedViewRefreshFact[] {
  const facts: MaterializedViewRefreshFact[] = [];

  for (const call of fn.writeCalls) {
    if (call.operation !== 'refreshMaterializedView') continue;

    const site =
      call.site ?? `${file.fileName}:${lineForIndex(file.source, fn.bodyStart + call.index)}`;
    for (const table of tables.get(call.tableExpression) ?? []) {
      const annotation = table.annotation;
      if (!isAsyncMaterializedViewAnnotation(annotation)) continue;

      facts.push({
        domain: annotation.domain,
        mutation: fn.name,
        optimisticStatus: 'await-fragment',
        refresh: 'async',
        site,
        view: annotation.name,
      });
    }
  }

  return facts;
}

function isAsyncMaterializedViewAnnotation(
  annotation: ExtractedTableAnnotation,
): annotation is KovoDomainTableAnnotation & {
  name: string;
  relation: 'materialized-view';
  refresh: 'async';
} {
  return (
    'domain' in annotation &&
    'relation' in annotation &&
    annotation.relation === 'materialized-view' &&
    annotation.refresh === 'async'
  );
}

export function appendReadSourceSummaries(
  reads: ReadSummaryInput[],
  unresolved: UnresolvedSummaryInput[],
  call: ExtractedWriteCall,
  site: string,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
  unresolvedIdentifiers: ReadonlySet<string>,
): void {
  // SPEC §11.1: insert-select/update-from reads are independently visible even when the write
  // target itself is opaque and must degrade to KV406.
  for (const readSource of call.readSources) {
    const readTables = tables.get(readSource.tableExpression) ?? [];
    if (readTables.length > 0) {
      for (const readTable of readTables) {
        if (isExemptExtractedTableAnnotation(readTable.annotation)) continue;
        if (isUnmappedTableAnnotation(readTable.annotation)) {
          unresolved.push({
            code: 'KV404',
            operation: readSource.operation,
            site,
          });
          continue;
        }
        const readPredicate = predicateSummaryFromFacts(
          call.predicateFacts,
          readSource.tableExpression,
          readTable.annotation,
        );
        reads.push({
          operation: readSource.operation,
          ...(readPredicate.predicate ? { predicate: readPredicate.predicate } : {}),
          ...(readPredicate.key ? { readKey: readPredicate.key } : {}),
          site,
          table: readTable.annotation,
        });
      }
      if (unresolvedIdentifiers.has(readSource.tableExpression)) {
        unresolved.push({
          operation: readSource.operation,
          site,
        });
      }
      continue;
    }

    unresolved.push({
      operation: readSource.operation,
      site,
    });
  }
}

function appendForeignKeyCascadeWriteSummaries(
  writes: WriteSummaryInput[],
  call: ExtractedWriteCall,
  site: string,
  parentTable: ExtractedTableAnnotation,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): void {
  if (!isDomainExtractedTableAnnotation(parentTable)) return;

  const action =
    call.operation === 'delete' ? 'onDelete' : call.operation === 'update' ? 'onUpdate' : null;
  if (!action) return;

  // SPEC §11.1 (part-4 D2): a CASCADE child is itself deleted/updated, so the DB
  // re-fires that child's own referential actions — the fan-out is a transitive
  // closure, not one hop. `set null`/`set default` are terminal (the row is mutated,
  // not deleted, so it does not re-trigger its own ON DELETE cascades). `walked`
  // guards FK cycles (the parent is pre-seeded since its own touch is emitted by the
  // caller); `emitted` dedupes touches across diamond/cycle fan-out paths.
  const walked = new Set<KovoDomainTableAnnotation & { name: string }>([parentTable]);
  const emitted = new Set<KovoDomainTableAnnotation & { name: string }>([parentTable]);
  let frontier: (KovoDomainTableAnnotation & { name: string })[] = [parentTable];

  while (frontier.length > 0) {
    const next: (KovoDomainTableAnnotation & { name: string })[] = [];

    for (const ancestor of frontier) {
      for (const entries of tables.values()) {
        for (const childTable of entries) {
          if (!isDomainExtractedTableAnnotation(childTable.annotation)) continue;

          for (const foreignKey of childTable.foreignKeys ?? []) {
            const foreignKeyAction =
              action === 'onDelete' ? foreignKey.onDelete : foreignKey.onUpdate;
            if (!isTouchingForeignKeyAction(foreignKeyAction)) continue;
            if (!foreignKeyTargetsTable(foreignKey, ancestor, tables)) continue;

            if (!emitted.has(childTable.annotation)) {
              emitted.add(childTable.annotation);
              writes.push({
                operation: `${call.operation}-${foreignKeyAction}`,
                site,
                table: childTable.annotation,
              });
            }

            // Only a `cascade` child re-fires its own referential actions (the row is
            // deleted/updated and triggers further cascades). Walk each child once.
            if (foreignKeyAction === 'cascade' && !walked.has(childTable.annotation)) {
              walked.add(childTable.annotation);
              next.push(childTable.annotation);
            }
          }
        }
      }
    }

    frontier = next;
  }
}

function isTouchingForeignKeyAction(action: string | undefined): action is string {
  return action === 'cascade' || action === 'set null' || action === 'set default';
}

function foreignKeyTargetsTable(
  foreignKey: ExtractedForeignKey,
  parentTable: KovoDomainTableAnnotation & { name: string },
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): boolean {
  return (tables.get(foreignKey.targetTableExpression) ?? []).some(
    (targetTable) =>
      isDomainExtractedTableAnnotation(targetTable.annotation) &&
      targetTable.annotation.name === parentTable.name,
  );
}

function appendDeclaredFanOutWriteSummaries(
  writes: WriteSummaryInput[],
  call: ExtractedWriteCall,
  site: string,
  table: ExtractedTableAnnotation,
): void {
  if (!isDomainExtractedTableAnnotation(table)) return;

  for (const fan of fanAnnotationsForOperation(table, call.operation)) {
    writes.push({
      operation: `${call.operation}-fan`,
      site,
      table: {
        domain: fan.domain,
        name: typeof fan.via === 'string' ? fan.via : fan.domain,
      },
    });
  }
}

function appendMissingTriggerFanOutDiagnostics(
  unresolved: UnresolvedSummaryInput[],
  call: ExtractedWriteCall,
  site: string,
  table: ExtractedTableAnnotation,
  triggerTables: ReadonlySet<string>,
): void {
  if (!isDomainExtractedTableAnnotation(table)) return;
  if (!triggerTables.has(table.name)) return;
  if (fanAnnotationsForOperation(table, call.operation).length > 0) return;

  unresolved.push({
    code: 'KV413',
    domain: table.domain,
    operation: 'trigger-fan-out',
    site,
  });
}

function fanAnnotationsForOperation(
  table: KovoDomainTableAnnotation & { name: string },
  operation: string,
): readonly KovoFanAnnotation[] {
  if (operation !== 'delete' && operation !== 'insert' && operation !== 'update') return [];
  return (table.fans ?? []).filter((fan) => fan.when === undefined || fan.when === operation);
}

function triggerTableNamesFromSource(source: string): ReadonlySet<string> {
  const tables = new Set<string>();
  const triggerPattern =
    /CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER[\s\S]*?\bON\s+("?)([A-Za-z_][\w]*)\1/gi;

  for (const match of source.matchAll(triggerPattern)) {
    const table = match[2];
    if (table) tables.add(table);
  }

  return tables;
}

function functionTouchSummariesForFile(
  file: SourceFileInput,
  functions: readonly ExtractedFunction[],
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
  unresolvedIdentifiers: ReadonlySet<string>,
): Map<string, FunctionTouchSummary> {
  const functionsByKey = new Map(functions.map((fn) => [fn.key, fn]));
  const callsByKey = new Map(
    functions.map((fn) => [fn.key, fn.localCalls.filter((call) => functionsByKey.has(call))]),
  );
  const summaries = new Map(
    functions.map((fn) => [
      fn.key,
      directSummaryForFunction(fn, file, tables, unresolvedIdentifiers),
    ]),
  );

  let changed = true;
  while (changed) {
    changed = false;

    for (const fn of functions) {
      const summary = summaries.get(fn.key);
      if (!summary) continue;

      for (const call of callsByKey.get(fn.key) ?? []) {
        const calleeSummary = summaries.get(call);
        if (!calleeSummary) continue;

        if (mergeSummary(summary, calleeSummary)) changed = true;
      }
    }
  }

  return summaries;
}

function mergeSummary(target: FunctionTouchSummary, source: FunctionTouchSummary): boolean {
  let changed = false;

  changed =
    pushUnique(
      target.rawTables ?? (target.rawTables = []),
      source.rawTables ?? [],
      (table) => table,
    ) || changed;
  changed = pushUnique(target.reads, source.reads, readSummaryKey) || changed;
  changed = pushUnique(target.unresolved, source.unresolved, unresolvedSummaryKey) || changed;
  changed = pushUnique(target.writes, source.writes, writeSummaryKey) || changed;

  return changed;
}

function pushUnique<T>(target: T[], source: readonly T[], keyFor: (item: T) => string): boolean {
  const keys = new Set(target.map(keyFor));
  let changed = false;

  for (const item of source) {
    const key = keyFor(item);
    if (keys.has(key)) continue;

    keys.add(key);
    target.push(item);
    changed = true;
  }

  return changed;
}

function readSummaryKey(read: ReadSummaryInput): string {
  return [
    read.operation,
    read.table.name,
    read.site,
    read.readKey ?? '',
    read.predicate ?? '',
    read.branch ?? '',
  ].join('\0');
}

function unresolvedSummaryKey(unresolved: UnresolvedSummaryInput): string {
  return [
    unresolved.code ?? '',
    unresolved.operation,
    unresolved.site,
    unresolved.domain ?? '',
  ].join('\0');
}

function writeSummaryKey(write: WriteSummaryInput): string {
  return [
    write.operation,
    write.table.name,
    write.site,
    write.writeKey ?? '',
    write.predicate ?? '',
    write.branch ?? '',
  ].join('\0');
}

export function tableAnnotation(initializer: Node): ExtractedTableAnnotation | null {
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
  const fans = fanAnnotationsFromObject(annotationObject);
  return {
    domain,
    ...(fans.length > 0 ? { fans } : {}),
    ...(key ? { key } : {}),
    ...(owner ? { owner } : {}),
    name: tableName,
  };
}

export function declaredRelationTableForInitializer(
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

function isDomainExtractedTableAnnotation(
  annotation: ExtractedTableAnnotation,
): annotation is KovoDomainTableAnnotation & { name: string } {
  return 'domain' in annotation;
}

function isExemptExtractedTableAnnotation(
  annotation: ExtractedTableAnnotation,
): annotation is { exempt: true; name: string } {
  return 'exempt' in annotation && annotation.exempt === true;
}

function isUnmappedTableAnnotation(
  annotation: ExtractedTableAnnotation,
): annotation is { name: string; unmapped: true } {
  return 'unmapped' in annotation && annotation.unmapped === true;
}

export function stringPropertyFromObject(object: Node, name: string): string | undefined {
  if (!Node.isObjectLiteralExpression(object)) return undefined;

  for (const property of object.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;
    if (propertyNameText(property.getNameNode()) !== name) continue;

    const initializer = property.getInitializer();
    if (initializer && Node.isStringLiteral(initializer)) return initializer.getLiteralText();
  }

  return undefined;
}

export function stringArrayPropertyFromObject(object: Node, name: string): string[] {
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

export function unwrappedTsExpression(expression: ts.Expression): ts.Expression {
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
export { createProjectExtraction, projectContextFiles, projectSourceFileName, type ProjectExtraction } from './static/project-setup.js';
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
export function functionBody(callback: Node): Node {
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

export function extractReadSourcesFromWriteChain(
  chain: Node,
  operation: string,
  tableExpressionText: (node: Node) => string,
): ExtractedReadSource[] {
  const calls = [
    ...(Node.isCallExpression(chain) ? [chain] : []),
    ...chain.getDescendantsOfKind(SyntaxKind.CallExpression),
  ];
  const hasInsertSelect =
    operation === 'insert' && calls.some((call) => propertyAccessCallName(call) === 'select');
  const sources: ExtractedReadSource[] = [];

  for (const call of calls) {
    if (!isReadSourceCall(call)) continue;
    const sourceOperation = writeReadSourceOperation(call, chain, operation);
    if (!sourceOperation) continue;

    const tableArgument = call.getArguments()[0];
    const tableExpression = tableArgument ? tableExpressionText(tableArgument) : '';

    sources.push({
      operation: sourceOperation,
      tableExpression: tableExpression || UNRESOLVED_READ_SOURCE_EXPRESSION,
    });
  }

  // SPEC §10-§11: an opaque write read source is visible as KV406, not guessed.
  return sources.length > 0 || !hasInsertSelect
    ? sources
    : [{ operation: 'insert-select', tableExpression: UNRESOLVED_READ_SOURCE_EXPRESSION }];
}

function writeReadSourceOperation(
  call: CallExpression,
  chain: Node,
  operation: string,
): ExtractedReadSource['operation'] | undefined {
  if (operation === 'insert') {
    return callExpressionsInNode(chain).some(
      (candidate) => propertyAccessCallName(candidate) === 'select',
    )
      ? 'insert-select'
      : undefined;
  }

  // SPEC §11.1: drizzle Postgres `delete()` has no `.from()`/`.using()` chain method (PgDeleteBase
  // exposes only where/returning), so a `from(R)` descended from a delete chain is necessarily
  // inside a `.where()` predicate subquery and contributes R to the READ set as a `delete-predicate`
  // source instead of being silently dropped.
  if (operation === 'delete') {
    return callExpressionContinuesToChain(call, chain) ? undefined : 'delete-predicate';
  }

  if (operation !== 'update') return undefined;
  return callExpressionContinuesToChain(call, chain) ? 'update-from' : 'update-predicate';
}

function callExpressionContinuesToChain(call: CallExpression, chain: Node): boolean {
  let current: Node = call;

  while (current !== chain) {
    const parent = current.getParent();
    if (parent && Node.isPropertyAccessExpression(parent) && parent.getExpression() === current) {
      current = parent;
      continue;
    }
    if (parent && Node.isCallExpression(parent) && parent.getExpression() === current) {
      current = parent;
      continue;
    }
    return false;
  }

  return true;
}

export function isReadSourceCall(call: CallExpression): boolean {
  const name = propertyAccessCallName(call);
  return (
    name === 'from' ||
    name === 'join' ||
    name === 'innerJoin' ||
    name === 'leftJoin' ||
    name === 'rightJoin' ||
    name === 'fullJoin'
  );
}

export function propertyAccessCallName(call: CallExpression): string | undefined {
  const expression = call.getExpression();
  return staticAccessName(expression);
}

export function staticAccessName(node: Node): string | undefined {
  if (Node.isPropertyAccessExpression(node)) return node.getName();
  if (!Node.isElementAccessExpression(node)) return undefined;

  const argument = node.getArgumentExpression();
  if (Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument)) {
    return argument.getLiteralText();
  }
  if (Node.isNumericLiteral(argument)) return argument.getText();
  return undefined;
}

export function staticAccessExpression(node: Node): Node | undefined {
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    return node.getExpression();
  }
  return undefined;
}

function predicateSummaryFromFacts(
  facts: readonly ExtractedPredicateFact[],
  tableIdentifier: string,
  table: KovoDomainTableAnnotation,
): ExtractedPredicateSummary {
  if (typeof table.key !== 'string') return {};

  const keyColumns = tableKeyColumns(table.key);
  const keyFacts = keyColumns.map((key) =>
    facts.find((fact) => fact.tableIdentifier === tableIdentifier && fact.key === key),
  );
  const argumentKeys = keyFacts.map((fact) => fact?.argumentKey);
  if (
    argumentKeys.length === keyColumns.length &&
    argumentKeys.every((argumentKey): argumentKey is string => argumentKey !== undefined)
  ) {
    const publicArgumentKeys = argumentKeys.filter(
      (argumentKey) => !isPrivateScopeKey(argumentKey),
    );
    return publicArgumentKeys.length > 0 ? { key: publicArgumentKeys.join(',') } : {};
  }

  return keyFacts.some((fact) => fact?.predicate === 'non-eq') ? { predicate: 'non-eq' } : {};
}

function isPrivateScopeKey(key: string): boolean {
  return key.startsWith('guard:') || key.startsWith('session:') || key.startsWith('tenant:');
}

function tableKeyColumns(key: string): string[] {
  return key
    .split(',')
    .map((column) => column.trim())
    .filter((column) => column.length > 0);
}

export function extractPredicateFactsFromWriteChain(
  chain: Node,
  resolveIdentifier?: (node: Node) => string | undefined,
  paramSymbolKeys: ReadonlySet<string> = new Set(),
  sessionContext: SessionProvenanceContext = emptySessionProvenanceContext(),
): ExtractedPredicateFact[] {
  const facts: ExtractedPredicateFact[] = [];
  const calls = [
    ...(Node.isCallExpression(chain) ? [chain] : []),
    ...chain.getDescendantsOfKind(SyntaxKind.CallExpression),
  ];
  const whereCall = calls.find((call) => propertyAccessCallName(call) === 'where');
  const predicate = whereCall?.getArguments()[0];
  if (!predicate) return facts;
  const pnf = predicatePnf(predicate);

  const parameterizedKeys = extractParameterizedKeys(
    pnf,
    resolveIdentifier,
    paramSymbolKeys,
    sessionContext,
  );
  facts.push(...parameterizedKeys);

  if (!pnfExactConjuncts(pnf)) {
    for (const reference of tableKeyReferences(predicate, resolveIdentifier)) {
      facts.push({ ...reference, predicate: 'non-eq' });
    }
  }

  return dedupePredicateFacts(facts);
}

/**
 * Classify a write chain's `where()` predicate operands the same way as a query read
 * (SPEC §10.3, KV414 A1/A2/A3). Reuses `eqPredicateConjuncts` (`and()`/top-level →
 * instance-key/`session` candidates) and `allEqOperandPairs` (every `eq` operand,
 * incl. `or()` branches → fail-closed `args` candidates), with the same
 * `input.*`/`req.session.*`/table-column operand classifier the read side uses — so a
 * write keyed by a client arg against an owner table emits a `kind:'write'` scope
 * audit (the write half of KV414 the framework previously never produced).
 */
export function writeInstanceKeyComparisons(
  chain: Node,
  resolveIdentifier?: (node: Node) => string | undefined,
  sessionContext: SessionProvenanceContext = emptySessionProvenanceContext(),
): QueryInstanceKeyComparisons {
  const calls = [
    ...(Node.isCallExpression(chain) ? [chain] : []),
    ...chain.getDescendantsOfKind(SyntaxKind.CallExpression),
  ];
  const whereCall = calls.find((call) => propertyAccessCallName(call) === 'where');
  const predicate = whereCall?.getArguments()[0];
  if (!predicate) return { argCandidates: [], instanceKey: [] };
  const pnf = predicatePnf(predicate);

  const toComparison = ({ left, right }: EqPredicateConjunct): QueryInstanceKeyComparison => ({
    left: queryInstanceKeyOperand(left, resolveIdentifier, sessionContext),
    right: queryInstanceKeyOperand(right, resolveIdentifier, sessionContext),
  });

  return {
    argCandidates: pnfAllEqOperandPairs(pnf).map(toComparison),
    instanceKey: (pnfExactConjuncts(pnf) ?? []).map(toComparison),
  };
}

function extractParameterizedKeys(
  pnf: PredicatePnf,
  resolveIdentifier?: (node: Node) => string | undefined,
  paramSymbolKeys: ReadonlySet<string> = new Set(),
  sessionContext: SessionProvenanceContext = emptySessionProvenanceContext(),
): ExtractedPredicateFact[] {
  const conjuncts = pnfExactConjuncts(pnf);
  if (!conjuncts) return [];

  const facts: ExtractedPredicateFact[] = [];
  for (const { left, right } of conjuncts) {
    const leftKey = tableKeyReference(left, resolveIdentifier);
    const rightArgument = argumentKey(right, paramSymbolKeys, sessionContext);
    if (leftKey) {
      facts.push(
        rightArgument
          ? { ...leftKey, argumentKey: rightArgument }
          : { ...leftKey, predicate: 'non-eq' },
      );
      continue;
    }

    const rightKey = tableKeyReference(right, resolveIdentifier);
    const leftArgument = argumentKey(left, paramSymbolKeys, sessionContext);
    if (rightKey) {
      facts.push(
        leftArgument
          ? { ...rightKey, argumentKey: leftArgument }
          : { ...rightKey, predicate: 'non-eq' },
      );
    }
  }

  return facts;
}

interface EqPredicateConjunct {
  left: Node;
  right: Node;
}

export type PredicatePnf =
  | { expr: string; kind: 'and'; nodes: readonly PredicatePnf[] }
  | { kind: 'eq'; left: Node; right: Node }
  | { expr: string; kind: 'opaque' }
  | { expr: string; kind: 'or'; nodes: readonly PredicatePnf[] };

export function predicatePnf(node: Node): PredicatePnf {
  const expression = unwrappedStaticExpressionNode(node);
  if (!Node.isCallExpression(expression)) return { expr: expression.getText(), kind: 'opaque' };

  const callee = expression.getExpression();
  if (!Node.isIdentifier(callee)) return { expr: expression.getText(), kind: 'opaque' };
  const name = callee.getText();

  if (name === 'and' || name === 'or') {
    return {
      expr: expression.getText(),
      kind: name,
      nodes: expression.getArguments().map((argument) => predicatePnf(argument)),
    };
  }

  if (name !== 'eq') return { expr: expression.getText(), kind: 'opaque' };
  const [left, right] = expression.getArguments();
  return left && right
    ? { kind: 'eq', left, right }
    : { expr: expression.getText(), kind: 'opaque' };
}

export function pnfExactConjuncts(pnf: PredicatePnf): EqPredicateConjunct[] | null {
  if (pnf.kind === 'eq') return [{ left: pnf.left, right: pnf.right }];
  if (pnf.kind === 'and') {
    const conjuncts: EqPredicateConjunct[] = [];
    for (const child of pnf.nodes) {
      const nested = pnfExactConjuncts(child);
      if (!nested) return null;
      conjuncts.push(...nested);
    }
    return conjuncts;
  }
  return null;
}

function eqPredicateConjuncts(node: Node): EqPredicateConjunct[] | null {
  return pnfExactConjuncts(predicatePnf(node));
}

function pnfAllEqOperandPairs(pnf: PredicatePnf): EqPredicateConjunct[] {
  if (pnf.kind === 'eq') return [{ left: pnf.left, right: pnf.right }];
  if (pnf.kind === 'and' || pnf.kind === 'or') return pnf.nodes.flatMap(pnfAllEqOperandPairs);
  return [];
}

function tableKeyReferences(
  node: Node,
  resolveIdentifier?: (node: Node) => string | undefined,
): ExtractedPredicateFact[] {
  const references: ExtractedPredicateFact[] = [];
  const ownReference = tableKeyReference(node, resolveIdentifier);
  if (ownReference) references.push(ownReference);

  for (const descendant of node.getDescendants()) {
    const reference = tableKeyReference(descendant, resolveIdentifier);
    if (reference) references.push(reference);
  }

  return dedupePredicateFacts(references);
}

function tableKeyReference(
  node: Node,
  resolveIdentifier?: (node: Node) => string | undefined,
): ExtractedPredicateFact | undefined {
  const path = staticExpressionPath(node, resolveIdentifier);
  if (!path) return undefined;

  const keyStart = path.lastIndexOf('.');
  if (keyStart <= 0 || keyStart === path.length - 1) return undefined;

  return {
    key: path.slice(keyStart + 1),
    tableIdentifier: path.slice(0, keyStart),
  };
}

function dedupePredicateFacts(facts: readonly ExtractedPredicateFact[]): ExtractedPredicateFact[] {
  const seen = new Set<string>();
  const deduped: ExtractedPredicateFact[] = [];

  for (const fact of facts) {
    const key = [fact.tableIdentifier, fact.key, fact.argumentKey ?? '', fact.predicate ?? ''].join(
      '\0',
    );
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(fact);
  }

  return deduped;
}

function argumentKey(
  expression: Node,
  paramSymbolKeys: ReadonlySet<string>,
  sessionContext: SessionProvenanceContext = emptySessionProvenanceContext(),
): string | undefined {
  const node = unwrappedStaticExpressionNode(expression);
  const provenance = privateScopeForExpression(node, sessionContext);
  if (provenance) return privateScopeKey(provenance);

  if (Node.isIdentifier(node)) {
    const symbolKey = resolvedSymbolKey(symbolForIdentifierReference(node));
    return symbolKey && paramSymbolKeys.has(symbolKey) ? `arg:${node.getText()}` : undefined;
  }
  if (!Node.isPropertyAccessExpression(node)) return undefined;

  const base = unwrappedStaticExpressionNode(node.getExpression());
  if (!Node.isIdentifier(base)) return undefined;
  const symbolKey = resolvedSymbolKey(symbolForIdentifierReference(base));
  if (!symbolKey || !paramSymbolKeys.has(symbolKey)) return undefined;

  return `arg:${node.getName()}`;
}

import {
  emptySessionProvenanceContext,
  opaqueAliasReasonForExpression,
  privateScopeForExpression,
  privateScopeKey,
  sessionProvenanceContextForNodes,
} from './static/session-provenance.js';
/** @internal */
export {
  emptySessionProvenanceContext,
  opaqueAliasReasonForExpression,
  privateScopeForExpression,
  privateScopeKey,
  sessionProvenanceContextForNodes,
} from './static/session-provenance.js';
export function appendTableEntries<Table>(
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

export function lineForIndex(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}


export function unsummarizedHelperReason(call: CallExpression): string {
  const callee = unwrappedStaticExpressionNode(call.getExpression());
  const name = Node.isIdentifier(callee) ? callee.getText() : staticAccessName(callee);
  return name ? `unsummarized-helper:${name}` : 'unsummarized-helper';
}

export function callbackParameterSymbolKeys(fn: Node): Set<string> {
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
  extractSymbolicEffectsFromProject,
} from './static/derivation.js';
/** @internal */
export type { SymbolicEffectFact } from './static/derivation.js';
