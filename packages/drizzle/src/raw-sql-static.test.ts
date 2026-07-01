import { describe, expect, it } from 'vitest';

import {
  extractMassAssignmentFromProject,
  extractOwnerAuditFromProject,
  extractTouchGraphFromProject,
} from '@kovojs/drizzle/internal/static';
import {
  pgDatabaseTypes,
  pgliteDatabaseTypes,
  sqliteDatabaseTypes,
  withPgDatabaseTypes,
} from './test-helpers.js';

const RAW_EXECUTE_DB = pgDatabaseTypes(['execute(query: unknown): Promise<void>;']);

const RAW_SQL_WRITE_SINK_CASES = [
  {
    dbType: 'PgliteDatabase<any>',
    importLine: 'import type { PgliteDatabase } from "drizzle-orm/pglite";',
    method: 'execute',
    name: 'pglite execute',
    tableFactory: 'pgTable',
    types: pgliteDatabaseTypes(['execute(query: unknown): Promise<void>;']),
  },
  {
    dbType: 'PgliteDatabase<any>',
    importLine: 'import type { PgliteDatabase } from "drizzle-orm/pglite";',
    method: 'query',
    name: 'pglite query',
    tableFactory: 'pgTable',
    types: pgliteDatabaseTypes(['query(query: unknown): Promise<void>;']),
  },
  {
    dbType: 'BaseSQLiteDatabase<any, any, any, any>',
    importLine: 'import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";',
    method: 'run',
    name: 'sqlite run',
    tableFactory: 'sqliteTable',
    types: sqliteDatabaseTypes(['run(query: unknown): Promise<void>;']),
  },
  {
    dbType: 'BaseSQLiteDatabase<any, any, any, any>',
    importLine: 'import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";',
    method: 'get',
    name: 'sqlite get',
    tableFactory: 'sqliteTable',
    types: sqliteDatabaseTypes(['get(query: unknown): Promise<unknown>;']),
  },
  {
    dbType: 'BaseSQLiteDatabase<any, any, any, any>',
    importLine: 'import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";',
    method: 'all',
    name: 'sqlite all',
    tableFactory: 'sqliteTable',
    types: sqliteDatabaseTypes(['all(query: unknown): Promise<unknown[]>;']),
  },
  {
    dbType: 'BaseSQLiteDatabase<any, any, any, any>',
    importLine: 'import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";',
    method: 'values',
    name: 'sqlite values',
    tableFactory: 'sqliteTable',
    types: sqliteDatabaseTypes(['values(query: unknown): Promise<unknown[]>;']),
  },
] as const;

function rawWriteSource({
  dbType,
  importLine,
  method,
  tableFactory,
}: (typeof RAW_SQL_WRITE_SINK_CASES)[number]): string {
  return [
    importLine,
    '',
    `export const orders = ${tableFactory}("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: "id", owner: "userId" }));`,
    '',
    'export const order = domain({',
    `  cancel: write({ tables: ["orders"], touches: ["order"], run: async (db: ${dbType}, input: { id: string }) => {`,
    `    await db.${method}(sql\`update orders set status = ${'${"cancelled"}'} where id = ${'${input.id}'}\`);`,
    '  } }),',
    '});',
  ].join('\n');
}

function rawMutationSource({
  dbType,
  importLine,
  method,
  tableFactory,
}: (typeof RAW_SQL_WRITE_SINK_CASES)[number]): string {
  return [
    importLine,
    '',
    `export const rawOwners = ${tableFactory}("raw_owners", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "raw-owner", key: "id", owner: "userId" }));`,
    '',
    'export const addContact = mutation({',
    '  registry: { tables: ["raw_owners"] },',
    `  async handler(input: { id: string }, request: { db: ${dbType} }) {`,
    '    const db = request.db;',
    `    await db.${method}(sql\`update raw_owners set label = ${'${"x"}'} where id = ${'${input.id}'}\`);`,
    '  },',
    '});',
  ].join('\n');
}

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

  it.each(RAW_SQL_WRITE_SINK_CASES)('uses declared raw tables for $name domain writes', (sink) => {
    const graph = extractTouchGraphFromProject({
      files: [
        sink.types,
        {
          fileName: 'order.domain.ts',
          source: rawWriteSource(sink),
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

  it.each(RAW_SQL_WRITE_SINK_CASES)(
    'uses declared registry tables for $name mutation-handler writes',
    (sink) => {
      const graph = extractTouchGraphFromProject({
        files: [
          sink.types,
          {
            fileName: 'mutations.ts',
            source: rawMutationSource(sink),
          },
        ],
      });

      expect(graph).toEqual({
        'mutations/add-contact': {
          reads: [],
          tables: ['raw_owners'],
          touches: [],
          unresolved: [],
        },
      });
    },
  );

  it('fails closed for unknown raw SQL receiver methods even with declared tables', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        pgDatabaseTypes(['futureSql(query: unknown): Promise<void>;']),
        {
          fileName: 'order.domain.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: "id", owner: "userId" }));',
            '',
            'export const order = domain({',
            '  cancel: write({ tables: ["orders"], touches: ["order"], run: async (db: PgAsyncDatabase<any, any>, input: { id: string }) => {',
            '    await db.futureSql(sql`update orders set status = ${"cancelled"} where id = ${input.id}`);',
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

  it('fails closed for computed raw SQL receiver methods even with declared tables', () => {
    const graph = extractTouchGraphFromProject({
      files: [
        sqliteDatabaseTypes(['run(query: unknown): Promise<void>;']),
        {
          fileName: 'order.domain.ts',
          source: [
            'import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";',
            '',
            'export const orders = sqliteTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: "id", owner: "userId" }));',
            '',
            'export const order = domain({',
            '  cancel: write({ tables: ["orders"], touches: ["order"], run: async (db: BaseSQLiteDatabase<any, any, any, any>, input: { id: string }) => {',
            '    const method = "run";',
            '    await db[method](sql`update orders set status = ${"cancelled"} where id = ${input.id}`);',
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
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'order.domain.ts:8',
          },
        ],
      },
    });
  });

  it('keeps undeclared mutation raw db.execute writes visible as KV406', () => {
    const graph = extractTouchGraphFromProject(
      withPgDatabaseTypes({
        files: [
          RAW_EXECUTE_DB,
          {
            fileName: 'mutations.ts',
            source: [
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const addContact = mutation({',
              '  async handler(input: { id: string }, request: { db: PgAsyncDatabase<any, any> }) {',
              '    const db = request.db;',
              '    await db.execute(sql`update raw_owners set label = ${"x"} where id = ${input.id}`);',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(graph).toEqual({
      'mutations/add-contact': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'mutations.ts:6',
          },
        ],
      },
    });
  });

  it('keeps undeclared durable task scheduler writes visible as KV406', () => {
    const graph = extractTouchGraphFromProject(
      withPgDatabaseTypes({
        files: [
          {
            fileName: 'mutations.ts',
            source: [
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'type TaskRequest = { db: PgAsyncDatabase<any, any>; schedule(task: unknown, args: unknown): Promise<{ id: string }>; cancel(handle: { id: string }): Promise<boolean> };',
              '',
              'export const scheduleProof = mutation({',
              '  async handler(input: { proofId: string }, request: TaskRequest) {',
              '    const handle = await request.schedule("proof", input);',
              '    await request.cancel(handle);',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(graph).toEqual({
      'mutations/schedule-proof': {
        reads: [],
        touches: [],
        unresolved: [
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'mutations.ts:7',
          },
          {
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
            site: 'mutations.ts:8',
          },
        ],
      },
    });
  });

  it('uses a declared durable task queue table for request.schedule and cancel', () => {
    const graph = extractTouchGraphFromProject(
      withPgDatabaseTypes({
        files: [
          {
            fileName: 'mutations.ts',
            source: [
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'type TaskRequest = { db: PgAsyncDatabase<any, any>; schedule(task: unknown, args: unknown): Promise<{ id: string }>; cancel(handle: { id: string }): Promise<boolean> };',
              '',
              'export const scheduleProof = mutation({',
              '  registry: { tables: ["_kovo_jobs"] },',
              '  async handler(input: { proofId: string }, request: TaskRequest) {',
              '    const handle = await request.schedule("proof", input);',
              '    await request.cancel(handle);',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(graph).toEqual({
      'mutations/schedule-proof': {
        reads: [],
        tables: ['_kovo_jobs'],
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
              'import { trustedSql } from "@kovojs/drizzle";',
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

  it('accepts declared SQLite owner-table raw writes with a trustedSql justification', () => {
    const audit = extractOwnerAuditFromProject({
      files: [
        sqliteDatabaseTypes(['run(query: unknown): Promise<void>;']),
        {
          fileName: 'order.domain.ts',
          source: [
            'import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";',
            'import { trustedSql } from "@kovojs/drizzle";',
            '',
            'export const orders = sqliteTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: "id", owner: "userId" }));',
            '',
            'export const order = domain({',
            '  cancel: write({ tables: ["orders"], touches: ["order"], run: async (db: BaseSQLiteDatabase<any, any, any, any>, input: { id: string }) => {',
            '    await db.run(trustedSql(sql`update orders set status = ${"cancelled"} where id = ${input.id}`, { justification: "reviewed sqlite owner predicate" }));',
            '  } }),',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(audit.ownerDomains).toEqual([{ domain: 'order', owner: 'userId' }]);
    expect(audit.scopeAudits).toEqual([]);
  });

  it('does not let a local trustedSql shadow waive owner-table raw write audits', () => {
    const audit = extractOwnerAuditFromProject(
      withPgDatabaseTypes({
        files: [
          RAW_EXECUTE_DB,
          {
            fileName: 'order.domain.ts',
            source: [
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'function trustedSql<T>(value: T, _options: { justification: string }): T { return value; }',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: "id", owner: "userId" }));',
              '',
              'export const order = domain({',
              '  cancel: write({ tables: ["orders"], touches: ["order"], run: async (db: PgAsyncDatabase<any, any>, input: { id: string }) => {',
              '    await db.execute(trustedSql(sql`update orders set status = ${"cancelled"} where id = ${input.id}`, { justification: "fake local wrapper" }));',
              '  } }),',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(audit.scopeAudits).toEqual([
      expect.objectContaining({
        domain: 'order',
        kind: 'write',
        name: 'order.cancel',
        scope: 'unknown',
        site: 'order.domain.ts:8',
      }),
    ]);
  });

  it('fails closed with KV438 provenance for declared raw writes to governed tables', () => {
    const facts = extractMassAssignmentFromProject(
      withPgDatabaseTypes({
        files: [
          RAW_EXECUTE_DB,
          {
            fileName: 'order.domain.ts',
            source: [
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), status: text("status").notNull() }, kovo({ domain: "order", key: "id", governed: ["status"] }));',
              '',
              'export const order = domain({',
              '  cancel: write({ tables: ["orders"], touches: ["order"], run: async (db: PgAsyncDatabase<any, any>, input: { id: string; status: string }) => {',
              '    await db.execute(sql`update orders set status = ${input.status} where id = ${input.id}`);',
              '  } }),',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(facts).toEqual([
      {
        column: 'id+status',
        detail: 'raw SQL statement cannot prove governed value provenance',
        domain: 'order',
        name: 'order.cancel',
        provenance: 'unknown',
        site: 'order.domain.ts:7',
        via: 'raw-sql',
      },
    ]);
  });

  it('accepts trusted raw writes to governed tables without synthesizing KV438', () => {
    const facts = extractMassAssignmentFromProject(
      withPgDatabaseTypes({
        files: [
          RAW_EXECUTE_DB,
          {
            fileName: 'order.domain.ts',
            source: [
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              'import { trustedSql } from "@kovojs/drizzle";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), status: text("status").notNull() }, kovo({ domain: "order", key: "id", governed: ["status"] }));',
              '',
              'export const order = domain({',
              '  cancel: write({ tables: ["orders"], touches: ["order"], run: async (db: PgAsyncDatabase<any, any>, input: { id: string; status: string }) => {',
              '    await db.execute(trustedSql(sql`update orders set status = ${input.status} where id = ${input.id}`, { justification: "reviewed governed write" }));',
              '  } }),',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(facts).toEqual([]);
  });

  it('does not let a local trustedSql shadow waive governed-column raw write audits', () => {
    const facts = extractMassAssignmentFromProject(
      withPgDatabaseTypes({
        files: [
          RAW_EXECUTE_DB,
          {
            fileName: 'order.domain.ts',
            source: [
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'function trustedSql<T>(value: T, _options: { justification: string }): T { return value; }',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), status: text("status").notNull() }, kovo({ domain: "order", key: "id", governed: ["status"] }));',
              '',
              'export const order = domain({',
              '  cancel: write({ tables: ["orders"], touches: ["order"], run: async (db: PgAsyncDatabase<any, any>, input: { id: string; status: string }) => {',
              '    await db.execute(trustedSql(sql`update orders set status = ${input.status} where id = ${input.id}`, { justification: "fake local wrapper" }));',
              '  } }),',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(facts).toEqual([
      {
        column: 'id+status',
        detail: 'raw SQL statement cannot prove governed value provenance',
        domain: 'order',
        name: 'order.cancel',
        provenance: 'unknown',
        site: 'order.domain.ts:8',
        via: 'raw-sql',
      },
    ]);
  });

  it('fails closed for helper-mediated mutation registry raw writes to governed tables', () => {
    const facts = extractMassAssignmentFromProject(
      withPgDatabaseTypes({
        files: [
          RAW_EXECUTE_DB,
          {
            fileName: 'mutations.ts',
            source: [
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const rawOrders = pgTable("raw_orders", { id: text("id").primaryKey(), status: text("status").notNull() }, kovo({ domain: "raw-order", key: "id", governed: ["status"] }));',
              '',
              'async function updateOrderStatus(input: { id: string; status: string }, db: PgAsyncDatabase<any, any>) {',
              '  await db.execute(sql`update raw_orders set status = ${input.status} where id = ${input.id}`);',
              '}',
              '',
              'export const updateOrder = mutation({',
              '  registry: { tables: ["raw_orders"] },',
              '  async handler(input: { id: string; status: string }, request: { db: PgAsyncDatabase<any, any> }) {',
              '    return updateOrderStatus(input, request.db);',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(facts).toEqual([
      {
        column: 'id+status',
        detail: 'raw SQL statement cannot prove governed value provenance',
        domain: 'raw-order',
        name: 'mutations/update-order',
        provenance: 'unknown',
        site: 'mutations.ts:6',
        via: 'raw-sql',
      },
    ]);
  });

  it('fails closed for mutation registry raw writes against owner tables', () => {
    const audit = extractOwnerAuditFromProject(
      withPgDatabaseTypes({
        files: [
          RAW_EXECUTE_DB,
          {
            fileName: 'mutations.ts',
            source: [
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const rawOwners = pgTable("raw_owners", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "raw-owner", key: "id", owner: "userId" }));',
              '',
              'export const addContact = mutation({',
              '  registry: { tables: ["raw_owners"] },',
              '  async handler(input: { id: string }, request: { db: PgAsyncDatabase<any, any> }) {',
              '    const db = request.db;',
              '    await db.execute(sql`update raw_owners set label = ${"x"} where id = ${input.id}`);',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(audit.ownerDomains).toEqual([{ domain: 'raw-owner', owner: 'userId' }]);
    expect(audit.scopeAudits).toEqual([
      expect.objectContaining({
        domain: 'raw-owner',
        kind: 'write',
        name: 'mutations/add-contact',
        scope: 'unknown',
        site: 'mutations.ts:9',
      }),
    ]);
  });

  it('fails closed for helper-mediated mutation registry raw writes against owner tables', () => {
    const audit = extractOwnerAuditFromProject(
      withPgDatabaseTypes({
        files: [
          RAW_EXECUTE_DB,
          {
            fileName: 'mutations.ts',
            source: [
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const rawOwners = pgTable("raw_owners", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "raw-owner", key: "id", owner: "userId" }));',
              '',
              'async function addContactRow(input: { id: string }, db: PgAsyncDatabase<any, any>) {',
              '  await db.execute(sql`update raw_owners set label = ${"x"} where id = ${input.id}`);',
              '}',
              '',
              'export const addContact = mutation({',
              '  registry: { tables: ["raw_owners"] },',
              '  async handler(input: { id: string }, request: { db: PgAsyncDatabase<any, any> }) {',
              '    return addContactRow(input, request.db);',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(audit.ownerDomains).toEqual([{ domain: 'raw-owner', owner: 'userId' }]);
    expect(audit.scopeAudits).toEqual([
      expect.objectContaining({
        domain: 'raw-owner',
        kind: 'write',
        name: 'mutations/add-contact',
        scope: 'unknown',
        site: 'mutations.ts:6',
      }),
    ]);
  });

  it('maps helper-mediated mutation raw table names to owner tables declared in sibling files', () => {
    const audit = extractOwnerAuditFromProject(
      withPgDatabaseTypes({
        files: [
          RAW_EXECUTE_DB,
          {
            fileName: 'schema.ts',
            source:
              'export const rawOwners = pgTable("raw_owners", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "raw-owner", key: "id", owner: "userId" }));',
          },
          {
            fileName: 'mutations.ts',
            source: [
              'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
              '',
              'async function addContactRow(input: { id: string }, db: PgAsyncDatabase<any, any>) {',
              '  await db.execute(sql`update raw_owners set label = ${"x"} where id = ${input.id}`);',
              '}',
              '',
              'export const addContact = mutation({',
              '  registry: { tables: ["raw_owners"] },',
              '  async handler(input: { id: string }, request: { db: PgAsyncDatabase<any, any> }) {',
              '    return addContactRow(input, request.db);',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(audit.ownerDomains).toEqual([{ domain: 'raw-owner', owner: 'userId' }]);
    expect(audit.scopeAudits).toEqual([
      expect.objectContaining({
        domain: 'raw-owner',
        kind: 'write',
        name: 'mutations/add-contact',
        scope: 'unknown',
        site: 'mutations.ts:4',
      }),
    ]);
  });
});
