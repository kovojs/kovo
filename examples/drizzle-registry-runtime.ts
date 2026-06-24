import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import {
  deriveMutationTouchRegistry,
  extractQueryFactsFromProject,
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
  const queryRegistry = extractQueryFactsFromProject({ files })
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
