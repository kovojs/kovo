import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import {
  analyzeSqlSafetyFromProject,
  deriveInvalidationRegistry,
  deriveMutationTouchRegistry,
  diagnosticsForQueryFacts,
  extractAlgebraicShapesFromProject,
  extractQueryFactsFromProject,
  extractSymbolicEffectsFromProject,
  extractToctouFromProject,
  extractTouchGraphFromProject,
  type SourceFileInput,
} from '../packages/drizzle/src/static.ts';
import { serializeCoreRegistryModule } from '../packages/drizzle/src/derive-codegen.ts';
import { deriveOptimistic } from '../packages/drizzle/src/derive.ts';
import { puntReasonLabel } from '../packages/core/src/derivation.ts';
import type { AlgebraicQueryShape, SymbolicEffect } from '../packages/core/src/derivation.ts';
import { registerGeneratedMutationTouchRegistry } from '../packages/server/src/generated-mutation-registry.ts';
import { registerGeneratedQueryReadRegistry } from '../packages/server/src/generated-query-registry.ts';

interface ExampleDrizzleRegistryOptions {
  mutationTouchGraphKeys?: Readonly<Record<string, string>>;
  sourceRoot: string;
}

/** One declared query read fact: a query key and the domains its loader reads. */
export interface ExampleQueryReadSpec {
  domains: readonly string[];
  query: string;
}

/** Options for {@link emitExampleCoreRegistry}/{@link writeExampleCoreRegistry}. */
export interface ExampleCoreRegistryOptions {
  /**
   * Compact declared query → read-domain graph. SPEC.md §10.2/§11.1: the project query-fact
   * analyzer cannot prove reads through the example's `Reader<Db>` + `requireDb(context)` loader
   * indirection (capability-gaps §3), so the read set is declared here. The mutation→query
   * `InvalidationSets` union is still DERIVED from this read set folded against the analyzer-derived
   * Drizzle write/touch graph, so the union itself never drifts by hand.
   */
  queries: readonly ExampleQueryReadSpec[];
  /** Import specifier (relative to the generated out file) exporting the query loaders by key. */
  queryModule: string;
  /** Mutation key → touch-graph function name, folded against the touch graph (SPEC.md §10.3). */
  mutationTouchGraphKeys: Readonly<Record<string, string>>;
  /** App source root analyzed for the Drizzle touch graph. */
  sourceRoot: string;
}

export function registerExampleDrizzleRegistries(options: ExampleDrizzleRegistryOptions): void {
  const files = sourceFilesForDrizzleRegistry(options.sourceRoot);
  const queryFacts = extractQueryFactsFromProject({ files });
  // SPEC.md §11.4 / §10.2 / §10.3: gate on the error-severity data-plane diagnostics instead of
  // silently discarding `.diagnostics`. The default `vp build` path gates these too (the kovo()
  // Vite plugin), so this is defense-in-depth that keeps the example registry fail-closed if the
  // example is built without the plugin gate.
  assertNoDataPlaneErrors(files, queryFacts);
  const queryRegistry = queryFacts
    .filter((fact) => fact.reads.length > 0)
    .map((fact) => ({ domains: [...fact.reads], query: fact.query }));
  const touchGraph = extractTouchGraphFromProject({ files });
  const mutationTouchGraphKeys = options.mutationTouchGraphKeys ?? {};
  const mutationTouchRegistry =
    Object.keys(mutationTouchGraphKeys).length === 0
      ? {}
      : deriveMutationTouchRegistry({
          mutations: Object.entries(mutationTouchGraphKeys).map(([mutation, touchGraphKey]) => ({
            mutation,
            touchGraphKey,
          })),
          touchGraph,
        });

  registerGeneratedQueryReadRegistry(queryRegistry);
  registerGeneratedMutationTouchRegistry(mutationTouchRegistry);
}

/**
 * One (mutation × invalidated query) optimistic-derivation outcome (SPEC.md §10.5/§10.6).
 * `derived` pairs land in `OptimisticDerivationSets` and need NO hand-written transform; a
 * `hand-written` pair carries a NAMED punt reason so coverage is never silently dropped
 * (`kovo explain --optimistic` renders the same reason as an `OPTIMISTIC-PUNT` line).
 */
export interface ExampleOptimisticDerivationFact {
  mutation: string;
  query: string;
  reason?: string;
  status: 'derived' | 'hand-written';
}

/**
 * SPEC.md §10.5 — run the Stage-1 write→effect extractor, the Stage-2 query→shape classifier,
 * and the Stage-3 deriver over the example's REAL Drizzle source for every (mutation ×
 * invalidated query) pair. Returns the `OptimisticDerivationSets` union (the soundly DERIVED
 * pairs, all-or-nothing per query) plus a per-pair fact list that NAMES every punt. A derived
 * pair is the compiler PROVING the optimistic transform from the mutation's write effects and
 * the query's shape, so the app author does not hand-write it (KV310 makes it optional, §10.6);
 * an out-of-grammar pair stays hand-written / `'await-fragment'` with its named reason.
 */
function deriveExampleOptimisticSets(
  files: readonly SourceFileInput[],
  invalidations: Readonly<Record<string, readonly string[]>>,
  mutationTouchGraphKeys: Readonly<Record<string, string>>,
): { derivations: Record<string, string[]>; facts: ExampleOptimisticDerivationFact[] } {
  const effectFacts = extractSymbolicEffectsFromProject({ files });
  const shapeByQuery = new Map<string, AlgebraicQueryShape>(
    extractAlgebraicShapesFromProject({ files }).map((shape) => [shape.query, shape]),
  );
  const derivations: Record<string, string[]> = {};
  const facts: ExampleOptimisticDerivationFact[] = [];

  for (const [mutation, queries] of Object.entries(invalidations)) {
    // The mutation's write effects share the touch-graph write key (the inline handler name).
    const writeKey = mutationTouchGraphKeys[mutation] ?? mutation;
    const mutationEffects: SymbolicEffect[] = effectFacts
      .filter((fact) => fact.writeKey === writeKey)
      .map((fact) => fact.effect);
    const derived: string[] = [];
    for (const query of [...queries].sort()) {
      const shape = shapeByQuery.get(query);
      if (!shape) {
        // Stage-2 produced no in-grammar §10.5 shape for this loader (e.g. the keyed
        // whole-row `return row ?? null` of `questionDetail`: a keyed scalar-from-keyed-row
        // return is not yet classified/keyed-emittable). NAMED punt, kept hand-written.
        facts.push({
          mutation,
          query,
          reason: 'unsupported: no in-grammar §10.5 query shape (keyed whole-row return)',
          status: 'hand-written',
        });
        continue;
      }
      const result = deriveOptimistic(mutationEffects, shape);
      if (result.kind === 'derived') {
        derived.push(query);
        facts.push({ mutation, query, status: 'derived' });
      } else {
        facts.push({
          mutation,
          query,
          reason: puntReasonLabel(result.reason),
          status: 'hand-written',
        });
      }
    }
    if (derived.length > 0) derivations[mutation] = derived;
  }
  return { derivations, facts };
}

interface ExampleRegistryComputation {
  facts: ExampleOptimisticDerivationFact[];
  source: string;
}

function computeExampleCoreRegistry(
  options: ExampleCoreRegistryOptions,
): ExampleRegistryComputation {
  const files = sourceFilesForDrizzleRegistry(options.sourceRoot);
  // Defense-in-depth: never emit a registry for a project with error-severity data-plane findings.
  assertNoDataPlaneErrors(files, extractQueryFactsFromProject({ files }));

  const touchGraph = extractTouchGraphFromProject({ files });
  const invalidationRegistry = deriveInvalidationRegistry({
    mutations: Object.entries(options.mutationTouchGraphKeys).map(([mutation, touchGraphKey]) => ({
      mutation,
      touchGraphKey,
    })),
    queries: options.queries.map((spec) => ({ domains: [...spec.domains], query: spec.query })),
    touchGraph,
  });
  const invalidations: Record<string, string[]> = {};
  for (const [mutation, entries] of Object.entries(invalidationRegistry)) {
    invalidations[mutation] = [...new Set(entries.map((entry) => entry.query))].sort();
  }

  // SPEC.md §10.5 — DERIVE the optimistic transforms the compiler can prove, and fold them into
  // `OptimisticDerivationSets` so they become optional (derived) in each mutation's optimistic map.
  const { derivations, facts } = deriveExampleOptimisticSets(
    files,
    invalidations,
    options.mutationTouchGraphKeys,
  );

  const source = serializeCoreRegistryModule({
    derivations,
    headerImports: [`import type { QueryResult } from '@kovojs/server';`],
    invalidations,
    queries: options.queries.map((spec) => ({
      name: spec.query,
      type: `QueryResult<typeof import('${options.queryModule}').${spec.query}>`,
    })),
  });
  return { facts, source };
}

/**
 * SPEC.md §6.1/§10.5/§10.6/§11.1 — emit the example's `@kovojs/core` registry augmentation source
 * (`QueryRegistry` + `InvalidationSets` + the DERIVED `OptimisticDerivationSets`) so the app's
 * `tsc` program enforces KV310/`OptimisticFor` WITHOUT a hand-authored `declare module` that can
 * drift from the real invalidation graph (capability-gaps §3). The mutation→query union is DERIVED
 * from the analyzer-derived Drizzle touch graph folded against the declared query read set; the
 * `OptimisticDerivationSets` union is DERIVED from the §10.5 effect-through-shape deriver run over
 * the same source; each query's result type is its loader's (`QueryResult<typeof loader>`).
 */
export function emitExampleCoreRegistry(options: ExampleCoreRegistryOptions): string {
  return computeExampleCoreRegistry(options).source;
}

/**
 * SPEC.md §10.5/§10.6 — the per-pair derivation outcomes (which optimistic transforms the compiler
 * DERIVED, and the NAMED reason for every punt that stays hand-written / `'await-fragment'`).
 */
export function exampleOptimisticDerivationFacts(
  options: ExampleCoreRegistryOptions,
): ExampleOptimisticDerivationFact[] {
  return computeExampleCoreRegistry(options).facts;
}

/**
 * Write {@link emitExampleCoreRegistry} to `outPath` (a gitignored `src/generated/` artifact) and
 * return the §10.5 per-pair derivation facts (derived pairs + named punts) for reporting.
 */
export function writeExampleCoreRegistry(
  options: ExampleCoreRegistryOptions & { outPath: string },
): ExampleOptimisticDerivationFact[] {
  const { facts, source } = computeExampleCoreRegistry(options);
  mkdirSync(dirname(options.outPath), { recursive: true });
  writeFileSync(options.outPath, source, 'utf8');
  return facts;
}

/**
 * SPEC.md §11.4 / §10.2 / §10.3: fail-closed on the error-severity data-plane findings — KV422
 * (request-derived/unproven data reaching executable SQL text), KV410/KV411 (opaque query
 * projection / exempt-table reads), and KV429 (single-row lost-update writes). Reuses the SAME
 * `@kovojs/drizzle` analyzers as the `kovo` CLI and the kovo() Vite plugin (one source of truth).
 */
function assertNoDataPlaneErrors(
  files: readonly SourceFileInput[],
  queryFacts: ReturnType<typeof extractQueryFactsFromProject>,
): void {
  const findings: string[] = [];

  for (const diagnostic of analyzeSqlSafetyFromProject({ files })) {
    if ((diagnostic.severity ?? 'error') === 'error') {
      findings.push(`ERROR ${diagnostic.code} ${diagnostic.site} ${diagnostic.message}`);
    }
  }
  for (const diagnostic of diagnosticsForQueryFacts(queryFacts)) {
    if ((diagnostic.severity ?? 'error') === 'error') {
      findings.push(`ERROR ${diagnostic.code} ${diagnostic.site} ${diagnostic.message}`);
    }
  }
  for (const fact of extractToctouFromProject({ files })) {
    findings.push(
      `ERROR KV429 ${fact.site} Read-then-write on a contended column without an atomic/version guard (${fact.table}.${fact.column}).`,
    );
  }

  if (findings.length > 0) {
    throw new Error(
      `Kovo data-plane safety gate failed: ${findings.length} error-severity diagnostic(s) (SPEC.md §11.4).\n${findings
        .map((line) => `  ${line}`)
        .join('\n')}`,
    );
  }
}

function sourceFilesForDrizzleRegistry(sourceRoot: string): SourceFileInput[] {
  return sourceFilePaths(sourceRoot)
    .sort((left, right) => left.localeCompare(right))
    .map((fileName) => ({
      fileName: normalizePath(relative(sourceRoot, fileName)),
      source: readFileSync(fileName, 'utf8'),
    }));
}

function sourceFilePaths(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFilePaths(path);
    if (!/\.[cm]?tsx?$/.test(entry.name)) return [];
    if (entry.name.includes('.test.') || entry.name.includes('.setup.')) return [];
    return [path];
  });
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/');
}
