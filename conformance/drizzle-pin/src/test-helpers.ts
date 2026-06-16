import {
  extractQueryFactsFromProject as extractQueryFactsFromProjectBase,
  type kovo,
  type SourceFileInput,
  type TouchGraphProjectOptions,
} from '../../../packages/drizzle/src/static.js';

export function pgDatabaseTypes(methods: readonly string[] = []): SourceFileInput {
  return {
    fileName: 'conformance/drizzle-pin/src/drizzle-types.d.ts',
    source: [
      'declare module "drizzle-orm/pg-core" {',
      '  export class PgDatabase<TQueryResultHKT = unknown, TFullSchema = unknown, TSchema = unknown> {',
      ...methods.map((method) => `    ${method}`),
      '  }',
      '}',
      'type PgDatabase<TQueryResultHKT = unknown, TFullSchema = unknown, TSchema = unknown> = import("drizzle-orm/pg-core").PgDatabase<TQueryResultHKT, TFullSchema, TSchema>;',
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
  return /import\s+(?:type\s+)?[\s\S]*\bPgDatabase\b[\s\S]*from\s+['"]drizzle-orm\/pg-core['"]/.test(
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
