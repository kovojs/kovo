import {
  extractQueryFactsFromProject as extractQueryFactsFromProjectBase,
  type SourceFileInput,
  type TouchGraphProjectOptions,
} from '../../../packages/drizzle/src/static.js';
import type { kovo } from '../../../packages/drizzle/src/drizzle-surface.js';

export function pgDatabaseTypes(methods: readonly string[] = []): SourceFileInput {
  return {
    fileName: 'conformance/drizzle-pin/src/drizzle-types.d.ts',
    source: [
      'import "drizzle-orm/pg-core";',
      'declare module "drizzle-orm/pg-core" {',
      '  export interface PgAsyncDatabase<TQueryResultHKT = unknown, TFullSchema = unknown> {',
      ...methods.map((method) => `    ${method}`),
      '  }',
      '}',
      'declare global {',
      '  type PgAsyncDatabase<TQueryResultHKT = unknown, TFullSchema = unknown> = import("drizzle-orm/pg-core").PgAsyncDatabase<any, any>;',
      '}',
    ].join('\n'),
  };
}

export function withPgDatabaseTypes(options: TouchGraphProjectOptions): TouchGraphProjectOptions {
  if (
    options.files.some(
      (file) => file.fileName.endsWith('drizzle-types.d.ts') || importsPgDatabase(file.source),
    )
  ) {
    return options;
  }
  return {
    ...options,
    files: [pgDatabaseTypes(), ...options.files],
  };
}

function importsPgDatabase(source: string): boolean {
  return /import\s+(?:type\s+)?[\s\S]*\bPgAsyncDatabase\b[\s\S]*from\s+['"]drizzle-orm\/pg-core['"]/.test(
    source,
  );
}

export function extractQueryFactsFromProject(
  options: TouchGraphProjectOptions,
): ReturnType<typeof extractQueryFactsFromProjectBase> {
  return extractQueryFactsFromProjectBase(withPgDatabaseTypes(options));
}

export function annotatedTable(name: string, annotation: ReturnType<typeof kovo>) {
  return {
    domain: annotation.domain,
    ...(annotation.key ? { key: annotation.key } : {}),
    name,
  };
}

export function drizzleSymbol(name: string): symbol {
  return Symbol.for(`drizzle:${name}`);
}
