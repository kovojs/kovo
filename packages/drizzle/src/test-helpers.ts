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

export function sqliteDatabaseTypes(methods: readonly string[]): SourceFileInput {
  return {
    fileName: 'sqlite-drizzle-types.d.ts',
    source: [
      'import "drizzle-orm/sqlite-core";',
      'declare module "drizzle-orm/sqlite-core" {',
      '  export interface SQLiteAsyncDatabase<TResultKind extends "sync" | "async" = "async", TRunResult = unknown, TRelations = unknown> {',
      ...methods.map((method) => `    ${method}`),
      '  }',
      '}',
      'declare global {',
      '  type SQLiteAsyncDatabase<TResultKind extends "sync" | "async" = "async", TRunResult = unknown, TRelations = unknown> = import("drizzle-orm/sqlite-core").SQLiteAsyncDatabase<any, any, any>;',
      '}',
    ].join('\n'),
  };
}

export function pgliteDatabaseTypes(methods: readonly string[]): SourceFileInput {
  return {
    fileName: 'pglite-drizzle-types.d.ts',
    source: [
      'import "drizzle-orm/pglite";',
      'declare module "drizzle-orm/pglite" {',
      '  export interface PgliteDatabase<TFullSchema = unknown> {',
      ...methods.map((method) => `    ${method}`),
      '  }',
      '}',
      'declare global {',
      '  type PgliteDatabase<TFullSchema = unknown> = import("drizzle-orm/pglite").PgliteDatabase<TFullSchema>;',
      '}',
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
