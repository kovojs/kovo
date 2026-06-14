import { jiso, type SourceFileInput } from '@jiso/drizzle/static';

export function annotatedTable(name: string, annotation: ReturnType<typeof jiso>) {
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
    ].join('\n'),
  };
}

export function unresolvedQueryLoadFact(query: string, site: string) {
  return {
    diagnostics: [
      {
        code: 'FW406',
        message:
          'Statically un-analyzable write site; manual touches required. Query load callback could not be statically resolved.',
        severity: 'warn',
        site,
      },
    ],
    query,
    reads: [],
    shape: {},
    site,
  };
}
