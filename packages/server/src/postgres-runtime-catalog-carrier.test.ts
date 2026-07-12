import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { kovo } from '@kovojs/drizzle';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

const carrier = vi.hoisted(() => ({
  active: false,
  hookTriggers: 0,
  lengthReads: 0,
  queryCalls: 0,
  statements: [] as string[],
}));

vi.mock('@electric-sql/pglite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@electric-sql/pglite')>();
  const RealPGlite = actual.PGlite;

  const carryCatalogRows = (
    args: readonly unknown[],
    result: { rows: Record<string, unknown>[] },
  ): typeof result => {
    const query = args[0];
    const statement =
      typeof query === 'string'
        ? query
        : query !== null &&
            typeof query === 'object' &&
            'text' in query &&
            typeof (query as { text?: unknown }).text === 'string'
          ? (query as { text: string }).text
          : undefined;
    if (statement !== undefined) carrier.statements.push(statement);
    if (carrier.active && statement !== undefined && statement.includes('pg_catalog.pg_policies')) {
      carrier.active = false;
      carrier.hookTriggers += 1;
      const rows = new Proxy(result.rows, {
        get(target, property, receiver) {
          if (property === 'length' && carrier.lengthReads < 6) {
            carrier.lengthReads += 1;
            return target.length - 1;
          }
          return Reflect.get(target, property, receiver);
        },
      });
      return { ...result, rows };
    }
    return result;
  };

  class CatalogCarrierPGlite extends RealPGlite {
    override async query(...args: unknown[]): Promise<unknown> {
      carrier.queryCalls += 1;
      const query = RealPGlite.prototype.query as (...values: unknown[]) => Promise<{
        rows: Record<string, unknown>[];
      }>;
      return carryCatalogRows(args, await Reflect.apply(query, this, args));
    }

    override async transaction(callback: (tx: unknown) => Promise<unknown>): Promise<unknown> {
      return super.transaction(async (tx: unknown) => {
        const transaction = tx as {
          query: (...args: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
        };
        const nativeQuery = transaction.query;
        transaction.query = async (...args: unknown[]) => {
          carrier.queryCalls += 1;
          return carryCatalogRows(args, await Reflect.apply(nativeQuery, transaction, args));
        };
        try {
          return await callback(tx);
        } finally {
          delete (transaction as { query?: unknown }).query;
        }
      });
    }
  }

  return { ...actual, PGlite: CatalogCarrierPGlite };
});

import { PGlite } from '@electric-sql/pglite';

import { checkPostgresAppDbPosture, createPostgresAppRuntimeDb } from './postgres-runtime.js';

const carrierNotes = pgTable(
  'kovo_catalog_carrier_notes',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
  },
  kovo({ domain: 'catalog-carrier-notes', key: 'id', owner: 'ownerId' }),
);

describe('Postgres security catalog carriers', () => {
  it('does not trust a one-shot Proxy rows length that hides an extra permissive policy', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-catalog-carrier-'));
    try {
      const runtime = createPostgresAppRuntimeDb({
        dataDir,
        driver: 'pglite',
        schema: { carrierNotes },
      });
      await runtime.ready;
      await runtime.close();

      const setup = new PGlite(dataDir);
      await setup.exec(
        'CREATE POLICY zz_extra_permissive ON kovo_catalog_carrier_notes FOR SELECT TO kovo_reader USING (true)',
      );
      await setup.close();

      const baseline = await checkPostgresAppDbPosture({
        dataDir,
        driver: 'pglite',
        schema: { carrierNotes },
      });
      expect(baseline.ok).toBe(false);
      expect(baseline.issues.some((issue) => issue.code === 'KV433_POLICY_SET')).toBe(true);

      carrier.active = true;
      carrier.hookTriggers = 0;
      carrier.lengthReads = 0;
      carrier.queryCalls = 0;
      carrier.statements = [];
      const report = await checkPostgresAppDbPosture({
        dataDir,
        driver: 'pglite',
        schema: { carrierNotes },
      });

      expect(carrier.queryCalls).toBeGreaterThan(0);
      expect(carrier.statements.some((statement) => statement.includes('pg_policies'))).toBe(true);
      expect(carrier.hookTriggers).toBe(1);
      expect(carrier.lengthReads).toBe(0);
      expect(report.ok).toBe(false);
      expect(report.issues.some((issue) => issue.code === 'KV433_POLICY_SET')).toBe(true);
    } finally {
      carrier.active = false;
      rmSync(dataDir, { force: true, recursive: true });
    }
  });
});
