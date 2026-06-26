import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import {
  analyzeSqlSafetyFromProject,
  deriveInvalidationRegistry,
  deriveMutationTouchRegistry,
  diagnosticsForQueryFacts,
  extractQueryFactsFromProject,
  extractToctouFromProject,
  extractTouchGraphFromProject,
  type SourceFileInput,
} from '../packages/drizzle/src/static.ts';
import { serializeCoreRegistryModule } from '../packages/drizzle/src/derive-codegen.ts';
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
 * SPEC.md §6.1/§10.6/§11.1 — emit the example's `@kovojs/core` registry augmentation source
 * (`QueryRegistry` + `InvalidationSets` + empty `OptimisticDerivationSets`) so the app's `tsc`
 * program enforces KV310/`OptimisticFor` WITHOUT a hand-authored `declare module` that can drift
 * from the real invalidation graph (capability-gaps §3). The mutation→query union is DERIVED from
 * the analyzer-derived Drizzle touch graph folded against the declared query read set; each query's
 * result type is taken from its loader (`QueryResult<typeof loader>`), the single source of truth.
 */
export function emitExampleCoreRegistry(options: ExampleCoreRegistryOptions): string {
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

  return serializeCoreRegistryModule({
    headerImports: [`import type { QueryResult } from '@kovojs/server';`],
    invalidations,
    queries: options.queries.map((spec) => ({
      name: spec.query,
      type: `QueryResult<typeof import('${options.queryModule}').${spec.query}>`,
    })),
  });
}

/** Write {@link emitExampleCoreRegistry} to `outPath` (a gitignored `src/generated/` artifact). */
export function writeExampleCoreRegistry(
  options: ExampleCoreRegistryOptions & { outPath: string },
): void {
  mkdirSync(dirname(options.outPath), { recursive: true });
  writeFileSync(options.outPath, emitExampleCoreRegistry(options), 'utf8');
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
