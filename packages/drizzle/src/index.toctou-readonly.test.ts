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

  it('flags read-then-absolute-write flows into an atomic column', () => {
    const result = toctou(
      ATOMIC_SCHEMA,
      buy(
        [
          '  const [row] = await db.select({ stock: products.stock }).from(products).where(eq(products.id, input.id));',
          '  const nextStock = Math.max(0, Number(row?.stock ?? 0) - input.qty);',
          '  await db.update(products).set({ stock: nextStock }).where(eq(products.id, input.id));',
        ].join('\n'),
      ),
    );
    expect(result).toEqual([
      { column: 'stock', name: 'buy', site: 'inventory.domain.ts:7', table: 'products' },
    ]);
  });

  it('discharges read-then-absolute-write flows with a version-column guard', () => {
    const result = toctou(
      ATOMIC_SCHEMA,
      buy(
        [
          '  const [row] = await db.select({ stock: products.stock }).from(products).where(eq(products.id, input.id));',
          '  const nextStock = Math.max(0, Number(row?.stock ?? 0) - input.qty);',
          '  await db.update(products).set({ stock: nextStock, ver: sql`${products.ver} + 1` }).where(and(eq(products.id, input.id), eq(products.ver, input.prevVer)));',
        ].join('\n'),
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

// Audit trap #5 (SPEC §10.3/§11.1, KV429): `set({ stock: sql`${col} + 1` })` (a BARE numeric
// literal inside the sql`` template) and `set({ stock: sql`${col} + ${1}` })` (the constant
// INTERPOLATED) are effect-identical self-referential writes and MUST get the same KV429
// verdict. The bare spelling formerly lowered to Opaque and SILENTLY ESCAPED the gate, so two
// statements with identical effects received different safety verdicts purely on interpolation
// style. These assert both spellings (and `1 + col` operand order) behave identically.
describe('KV429 bare-literal vs interpolated constant operand (audit trap #5)', () => {
  const FLAGGED = [
    { column: 'stock', name: 'buy', site: 'inventory.domain.ts:5', table: 'products' },
  ];

  // Self-referential atomic arithmetic spelled with a bare constant vs an interpolated one.
  // Every entry is the SAME runtime SQL effect (`stock = stock ± const`) — they must agree.
  const SELF_REF_ARITH: ReadonlyArray<{ label: string; set: string }> = [
    { label: 'decrement bare `- 1`', set: 'sql`${products.stock} - 1`' },
    { label: 'decrement interpolated `- ${1}`', set: 'sql`${products.stock} - ${1}`' },
    { label: 'increment bare `+ 1`', set: 'sql`${products.stock} + 1`' },
    { label: 'increment interpolated `+ ${1}`', set: 'sql`${products.stock} + ${1}`' },
    { label: 'operand-order bare `1 + col`', set: 'sql`1 + ${products.stock}`' },
    { label: 'decimal bare `- 1.5`', set: 'sql`${products.stock} - 1.5`' },
  ];

  it.each(SELF_REF_ARITH)('flags an unguarded self-referential $label', ({ set }) => {
    const result = toctou(
      ATOMIC_SCHEMA,
      buy(`  await db.update(products).set({ stock: ${set} }).where(eq(products.id, input.id));`),
    );
    expect(result).toEqual(FLAGGED);
  });

  it.each(SELF_REF_ARITH)('discharges $label with a compare-and-set guard', ({ set }) => {
    const result = toctou(
      ATOMIC_SCHEMA,
      buy(
        `  await db.update(products).set({ stock: ${set} }).where(and(eq(products.id, input.id), eq(products.stock, input.prevStock)));`,
      ),
    );
    expect(result).toEqual([]);
  });

  it.each(SELF_REF_ARITH)('discharges $label with a version-column guard', ({ set }) => {
    const result = toctou(
      ATOMIC_SCHEMA,
      buy(
        `  await db.update(products).set({ stock: ${set}, ver: sql\`\${products.ver} + 1\` }).where(and(eq(products.id, input.id), eq(products.ver, input.prevVer)));`,
      ),
    );
    expect(result).toEqual([]);
  });

  it('gives `+ 1` and `+ ${1}` identical verdicts (no interpolation-style divergence)', () => {
    const bare = toctou(
      ATOMIC_SCHEMA,
      buy(
        '  await db.update(products).set({ stock: sql`${products.stock} + 1` }).where(eq(products.id, input.id));',
      ),
    );
    const interpolated = toctou(
      ATOMIC_SCHEMA,
      buy(
        '  await db.update(products).set({ stock: sql`${products.stock} + ${1}` }).where(eq(products.id, input.id));',
      ),
    );
    expect(bare).toEqual(interpolated);
    expect(bare).toEqual(FLAGGED);
  });

  it('does not normalize a bare NON-numeric token to a constant (stays opaque)', () => {
    // Only NUMERIC constants normalize; a bare SQL expression (`now()`) is not a recognized
    // constant operand, so the arith stays opaque and the write is not flagged — column refs
    // and request values must never be mistaken for constants (SPEC §10.3/§11.1 KV429).
    const result = toctou(
      ATOMIC_SCHEMA,
      buy(
        '  await db.update(products).set({ stock: sql`${products.stock} - now()` }).where(eq(products.id, input.id));',
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
          'delete(table: unknown): { where(value: unknown): Promise<void> }; execute(sql: unknown): Promise<void>; insert(table: unknown): { values(value: unknown): Promise<void> };',
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

  it('flags a query() loader that directly reaches a raw Drizzle write verb', () => {
    const result = reach(
      `${QHEAD}export const dashboard = query("dashboard", { load: async (db: PgAsyncDatabase<any, any>) => { await db.execute("vacuum"); return { ok: true }; } });`,
    );
    expect(result).toEqual([
      {
        operation: 'execute',
        query: 'dashboard',
        site: 'q.ts:4',
        table: '__kovoUnresolvedReadSource',
      },
    ]);
  });

  it('keeps query.elevated as the escape for direct raw Drizzle write verbs', () => {
    const result = reach(
      `${QHEAD}export const dashboard = query.elevated("dashboard", { load: async (db: PgAsyncDatabase<any, any>) => { await db.execute("vacuum"); return { ok: true }; } });`,
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
