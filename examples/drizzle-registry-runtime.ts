import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import {
  analyzeSqlSafetyFromProject,
  deriveMutationTouchRegistry,
  diagnosticsForQueryFacts,
  extractQueryFactsFromProject,
  extractToctouFromProject,
  extractTouchGraphFromProject,
  type SourceFileInput,
} from '../packages/drizzle/src/static.ts';
import { registerGeneratedMutationTouchRegistry } from '../packages/server/src/generated-mutation-registry.ts';
import { registerGeneratedQueryReadRegistry } from '../packages/server/src/generated-query-registry.ts';

interface ExampleDrizzleRegistryOptions {
  mutationTouchGraphKeys?: Readonly<Record<string, string>>;
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
