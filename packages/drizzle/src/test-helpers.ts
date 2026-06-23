import { kovo } from '@kovojs/drizzle';
import type { SourceFileInput, TouchGraphProjectOptions } from '@kovojs/drizzle/internal/static';

export function annotatedTable(name: string, annotation: ReturnType<typeof kovo>) {
  return {
    domain: annotation.domain,
    ...(annotation.key ? { key: annotation.key } : {}),
    name,
  };
}

export function pgDatabaseTypes(methods: readonly string[]): SourceFileInput {
  return {
    fileName: 'drizzle-types.d.ts',
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

export function sqliteDatabaseTypes(methods: readonly string[]): SourceFileInput {
  return {
    fileName: 'sqlite-drizzle-types.d.ts',
    source: [
      'declare module "drizzle-orm/sqlite-core" {',
      '  export class BaseSQLiteDatabase<TResultKind = unknown, TRunResult = unknown, TFullSchema = unknown, TSchema = unknown> {',
      ...methods.map((method) => `    ${method}`),
      '  }',
      '}',
      'type BaseSQLiteDatabase<TResultKind = unknown, TRunResult = unknown, TFullSchema = unknown, TSchema = unknown> = import("drizzle-orm/sqlite-core").BaseSQLiteDatabase<TResultKind, TRunResult, TFullSchema, TSchema>;',
    ].join('\n'),
  };
}

export function withPgDatabaseTypes(
  options: TouchGraphProjectOptions,
  methods: readonly string[] = [],
): TouchGraphProjectOptions {
  if (options.files.some((file) => file.fileName === 'drizzle-types.d.ts')) return options;
  return {
    ...options,
    files: [pgDatabaseTypes(methods), ...options.files],
  };
}

export function unresolvedQueryLoadFact(query: string, site: string) {
  return {
    diagnostics: [
      {
        code: 'KV406',
        message:
          'Statically un-analyzable write site; manual touches required. Query load callback could not be statically resolved.',
        severity: 'error',
        site,
      },
    ],
    query,
    reads: [],
    shape: {},
    site,
  };
}
