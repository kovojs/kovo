import {
  extractQueryFactsFromProject as extractQueryFactsFromProjectBase,
  type SourceFileInput,
  type TouchGraphProjectOptions,
} from '../../../packages/drizzle/src/static.js';
import { kovo } from '../../../packages/drizzle/src/drizzle-surface.js';
import { pgTable, text } from 'drizzle-orm/pg-core';

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

export function annotatedTable(
  name: string,
  annotation: { domain: string; key: 'cartId' | 'id' | 'productId' },
) {
  // SPEC §10.1: even this graph-serialization helper exercises the annotation
  // against concrete Drizzle column identities. The returned graph row remains
  // deliberately small, but it is no longer fabricated from string selectors.
  const table = pgTable(
    name,
    {
      cartId: text('cart_id'),
      id: text('id'),
      productId: text('product_id'),
    },
    kovo((columns) => ({
      domain: annotation.domain,
      key:
        annotation.key === 'cartId'
          ? columns.cartId
          : annotation.key === 'productId'
            ? columns.productId
            : columns.id,
    })),
  );
  const tableInternals = table as unknown as Record<symbol, unknown>;
  const extraConfigBuilder = tableInternals[drizzleSymbol('ExtraConfigBuilder')];
  const extraConfigColumns = tableInternals[drizzleSymbol('ExtraConfigColumns')] as Record<
    string,
    unknown
  >;
  if (typeof extraConfigBuilder !== 'function') {
    throw new TypeError('Expected a Drizzle extra-config callback.');
  }
  extraConfigBuilder(extraConfigColumns);
  const annotationSnapshot = extraConfigBuilder as unknown as Record<string, unknown>;
  if (typeof annotationSnapshot.domain !== 'string') {
    throw new TypeError('Expected a domain-bearing Kovo annotation.');
  }
  if (annotationSnapshot.key !== extraConfigColumns[annotation.key]) {
    throw new TypeError('Expected the Kovo key to retain its concrete Drizzle column identity.');
  }
  return {
    domain: annotationSnapshot.domain,
    key: annotation.key,
    name,
  };
}

export function drizzleSymbol(name: string): symbol {
  return Symbol.for(`drizzle:${name}`);
}
