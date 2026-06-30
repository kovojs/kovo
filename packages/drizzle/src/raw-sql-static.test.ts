import { describe, expect, it } from 'vitest';

import {
  extractOwnerAuditFromProject,
  extractTouchGraphFromProject,
} from '@kovojs/drizzle/internal/static';
import { pgDatabaseTypes, withPgDatabaseTypes } from './test-helpers.js';

const RAW_EXECUTE_DB = pgDatabaseTypes(['execute(query: unknown): Promise<void>;']);

describe('@kovojs/drizzle raw SQL static extraction', () => {
  it('keeps undeclared raw db.execute writes visible as KV406', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        RAW_EXECUTE_DB,
        {
          fileName: 'order.domain.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: "id", owner: "userId" }));',
            '',
            'export const order = domain({',
            '  cancel: write(async (db: PgAsyncDatabase<any, any>, input: { id: string }) => {',
            '    await db.execute(sql`update orders set status = ${"cancelled"} where id = ${input.id}`);',
            '  }),',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      'order.cancel': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'order.domain.ts:7',
          },
        ],
      },
    });
  });

  it('uses declared raw tables as the touch graph table set without parsing SQL text', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        RAW_EXECUTE_DB,
        {
          fileName: 'order.domain.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: "id", owner: "userId" }));',
            '',
            'export const order = domain({',
            '  cancel: write({ tables: ["orders"], touches: ["order"], run: async (db: PgAsyncDatabase<any, any>, input: { id: string }) => {',
            '    await db.execute(sql`update orders set status = ${"cancelled"} where id = ${input.id}`);',
            '  } }),',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(graph).toEqual({
      'order.cancel': {
        reads: [],
        tables: ['orders'],
        touches: [],
        unresolved: [],
      },
    });
  });

  it('fails closed with a write-scope audit for declared owner-table raw writes', () => {
    const audit = extractOwnerAuditFromProject(
      withPgDatabaseTypes({
        files: [
          RAW_EXECUTE_DB,
          {
            fileName: 'order.domain.ts',
            source: [
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: "id", owner: "userId" }));',
              '',
              'export const order = domain({',
              '  cancel: write({ tables: ["orders"], touches: ["order"], run: async (db: PgAsyncDatabase<any, any>, input: { id: string }) => {',
              '    await db.execute(sql`update orders set status = ${"cancelled"} where id = ${input.id}`);',
              '  } }),',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(audit.ownerDomains).toEqual([{ domain: 'order', owner: 'userId' }]);
    expect(audit.scopeAudits).toEqual([
      expect.objectContaining({
        domain: 'order',
        kind: 'write',
        name: 'order.cancel',
        scope: 'unknown',
        site: 'order.domain.ts:7',
      }),
    ]);
  });

  it('accepts declared owner-table raw writes with a trustedSql justification', () => {
    const audit = extractOwnerAuditFromProject(
      withPgDatabaseTypes({
        files: [
          RAW_EXECUTE_DB,
          {
            fileName: 'order.domain.ts',
            source: [
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: "id", owner: "userId" }));',
              '',
              'export const order = domain({',
              '  cancel: write({ tables: ["orders"], touches: ["order"], run: async (db: PgAsyncDatabase<any, any>, input: { id: string }) => {',
              '    await db.execute(trustedSql(sql`update orders set status = ${"cancelled"} where id = ${input.id}`, { justification: "reviewed owner predicate" }));',
              '  } }),',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(audit.ownerDomains).toEqual([{ domain: 'order', owner: 'userId' }]);
    expect(audit.scopeAudits).toEqual([]);
  });
});
