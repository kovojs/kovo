import { describe, expect, it } from 'vitest';

import {
  extractQueryWriteReachabilityFromProject,
  extractToctouFromProject,
} from '@kovojs/drizzle/internal/static';
import { pgDatabaseTypes } from './test-helpers.js';

// SPEC §10.3/§11.1 (KV429 TOCTOU) and §6.6/§9.4 (KV433 read-only query, Stage 2).

const writeDbTypes = pgDatabaseTypes([
  'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
]);

function toctou(schema: string, domainSource: string) {
  return extractToctouFromProject({
    files: [
      writeDbTypes,
      { fileName: 'schema.ts', source: schema },
      { fileName: 'inventory.domain.ts', source: domainSource },
    ],
  });
}

const ATOMIC_SCHEMA = [
  'export const products = pgTable("products", {',
  '  id: text("id").primaryKey(),',
  '  stock: integer("stock").notNull(),',
  '  ver: integer("ver").notNull(),',
  '}, kovo({ domain: "product", key: "id", atomic: "stock", version: "ver" }));',
].join('\n');

const HEAD = [
  'import { and, eq, sql } from "drizzle-orm";',
  'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
  'import { products } from "./schema";',
  '',
].join('\n');

function buy(body: string): string {
  return `${HEAD}export const buy = async (db: PgAsyncDatabase<any, any>, input: { id: string; qty: number; prevStock: number; prevVer: number }) => {\n${body}\n};\n`;
}

describe('KV429 TOCTOU lost-update gate', () => {
  it('flags an unguarded self-referential atomic decrement', () => {
    const result = toctou(
      ATOMIC_SCHEMA,
      buy(
        '  await db.update(products).set({ stock: sql`${products.stock} - ${input.qty}` }).where(eq(products.id, input.id));',
      ),
    );
    expect(result).toEqual([
      { column: 'stock', name: 'buy', site: 'inventory.domain.ts:5', table: 'products' },
    ]);
  });

  it('discharges with a compare-and-set guard on the atomic column', () => {
    const result = toctou(
      ATOMIC_SCHEMA,
      buy(
        '  await db.update(products).set({ stock: sql`${products.stock} - ${input.qty}` }).where(and(eq(products.id, input.id), eq(products.stock, input.prevStock)));',
      ),
    );
    expect(result).toEqual([]);
  });

  it('discharges with a version-column guard (optimistic concurrency)', () => {
    const result = toctou(
      ATOMIC_SCHEMA,
      buy(
        '  await db.update(products).set({ stock: sql`${products.stock} - ${input.qty}`, ver: sql`${products.ver} + 1` }).where(and(eq(products.id, input.id), eq(products.ver, input.prevVer)));',
      ),
    );
    expect(result).toEqual([]);
  });

  it('keeps KV429 open when a version guard does not update the version column', () => {
    const result = toctou(
      ATOMIC_SCHEMA,
      buy(
        '  await db.update(products).set({ stock: sql`${products.stock} - ${input.qty}` }).where(and(eq(products.id, input.id), eq(products.ver, input.prevVer)));',
      ),
    );
    expect(result).toEqual([
      { column: 'stock', name: 'buy', site: 'inventory.domain.ts:5', table: 'products' },
    ]);
  });

  it('does not flag a non-self-referential atomic write (absolute set)', () => {
    const result = toctou(
      ATOMIC_SCHEMA,
      buy(
        '  await db.update(products).set({ stock: input.qty }).where(eq(products.id, input.id));',
      ),
    );
    expect(result).toEqual([]);
  });

  it('does not flag tables without an atomic/version annotation', () => {
    const result = toctou(
      'export const products = pgTable("products", { id: text("id").primaryKey(), stock: integer("stock") }, kovo({ domain: "product", key: "id" }));',
      buy(
        '  await db.update(products).set({ stock: sql`${products.stock} - ${input.qty}` }).where(eq(products.id, input.id));',
      ),
    );
    expect(result).toEqual([]);
  });

  it('honest ceiling: an opaque (multi-row/range) match is not flagged', () => {
    const result = toctou(
      ATOMIC_SCHEMA,
      buy(
        '  await db.update(products).set({ stock: sql`${products.stock} - ${input.qty}` }).where(sql`${products.stock} > 0`);',
      ),
    );
    expect(result).toEqual([]);
  });
});

describe('KV433 read-only query handle (Stage 2: static no-write-reachable)', () => {
  function reach(loaderSource: string) {
    return extractQueryWriteReachabilityFromProject({
      files: [
        writeDbTypes,
        pgDatabaseTypes([
          'delete(table: unknown): { where(value: unknown): Promise<void> }; insert(table: unknown): { values(value: unknown): Promise<void> };',
        ]),
        {
          fileName: 'schema.ts',
          source:
            'export const logs = pgTable("logs", { id: text("id").primaryKey() }, kovo({ domain: "log" }));',
        },
        { fileName: 'q.ts', source: loaderSource },
      ],
    });
  }

  const QHEAD = [
    'import { eq } from "drizzle-orm";',
    'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
    'import { logs } from "./schema";',
    '',
  ].join('\n');

  it('flags a query() loader that reaches a Drizzle write', () => {
    const result = reach(
      `${QHEAD}export const dashboard = query("dashboard", { load: async (db: PgAsyncDatabase<any, any>) => { await db.delete(logs).where(eq(logs.id, "x")); return { ok: true }; } });`,
    );
    expect(result).toEqual([
      { operation: 'delete', query: 'dashboard', site: 'q.ts:4', table: 'logs' },
    ]);
  });

  it('flags a query() loader that reaches a module-scope Drizzle write receiver', () => {
    const result = reach(
      `${QHEAD}declare const db: PgAsyncDatabase<any, any>;\nexport const dashboard = query("dashboard", { load: async () => { await db.delete(logs).where(eq(logs.id, "x")); return { ok: true }; } });`,
    );
    expect(result).toEqual([
      { operation: 'delete', query: 'dashboard', site: 'q.ts:5', table: 'logs' },
    ]);
  });

  it('does not flag a query.elevated loader (the audited escape)', () => {
    const result = reach(
      `${QHEAD}export const dashboard = query.elevated("dashboard", { load: async (db: PgAsyncDatabase<any, any>) => { await db.delete(logs).where(eq(logs.id, "x")); return { ok: true }; } });`,
    );
    expect(result).toEqual([]);
  });

  it('does not flag a read-only loader', () => {
    const result = reach(
      `${QHEAD}export const dashboard = query("dashboard", { load: async () => ({ ok: true }) });`,
    );
    expect(result).toEqual([]);
  });
});
