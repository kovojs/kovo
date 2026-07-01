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
    expect(result).toMatchObject([
      {
        canonicalTarget: { identity: 'logs', provenance: 'table-argument' },
        operation: 'delete',
        operationKind: 'delete',
        operationProvenance: 'property-access',
        query: 'dashboard',
        site: 'q.ts:4',
        table: 'logs',
      },
    ]);
    expect(result[0]?.span).toEqual({ end: expect.any(Number), start: expect.any(Number) });
  });

  it('flags a query() loader that reaches a module-scope Drizzle write receiver', () => {
    const result = reach(
      `${QHEAD}declare const db: PgAsyncDatabase<any, any>;\nexport const dashboard = query("dashboard", { load: async () => { await db.delete(logs).where(eq(logs.id, "x")); return { ok: true }; } });`,
    );
    expect(result).toMatchObject([
      {
        canonicalTarget: { identity: 'logs', provenance: 'table-argument' },
        operation: 'delete',
        operationKind: 'delete',
        operationProvenance: 'property-access',
        query: 'dashboard',
        site: 'q.ts:5',
        table: 'logs',
      },
    ]);
  });

  it('flags a legacy query.elevated loader that reaches a Drizzle write', () => {
    const result = reach(
      `${QHEAD}export const dashboard = query.elevated("dashboard", { load: async (db: PgAsyncDatabase<any, any>) => { await db.delete(logs).where(eq(logs.id, "x")); return { ok: true }; } });`,
    );
    expect(result).toMatchObject([
      {
        canonicalTarget: { identity: 'logs', provenance: 'table-argument' },
        operation: 'delete',
        operationKind: 'delete',
        operationProvenance: 'property-access',
        query: 'dashboard',
        site: 'q.ts:4',
        table: 'logs',
      },
    ]);
  });

  it('flags a query() loader that directly reaches a raw Drizzle write verb', () => {
    const result = reach(
      `${QHEAD}export const dashboard = query("dashboard", { load: async (db: PgAsyncDatabase<any, any>) => { await db.execute("vacuum"); return { ok: true }; } });`,
    );
    expect(result).toMatchObject([
      {
        canonicalTarget: { identity: 'UNRESOLVED', provenance: 'raw-receiver-method' },
        operation: 'execute',
        operationKind: 'execute',
        operationProvenance: 'property-access',
        query: 'dashboard',
        site: 'q.ts:4',
        table: '__kovoUnresolvedReadSource',
      },
    ]);
  });

  it('flags legacy query.elevated for direct raw Drizzle write verbs', () => {
    const result = reach(
      `${QHEAD}export const dashboard = query.elevated("dashboard", { load: async (db: PgAsyncDatabase<any, any>) => { await db.execute("vacuum"); return { ok: true }; } });`,
    );
    expect(result).toMatchObject([
      {
        canonicalTarget: { identity: 'UNRESOLVED', provenance: 'raw-receiver-method' },
        operation: 'execute',
        operationKind: 'execute',
        operationProvenance: 'property-access',
        query: 'dashboard',
        site: 'q.ts:4',
        table: '__kovoUnresolvedReadSource',
      },
    ]);
  });

  it('normalizes a destructured Drizzle write method alias in a query loader', () => {
    const result = reach(
      `${QHEAD}export const dashboard = query("dashboard", { load: async (db: PgAsyncDatabase<any, any>) => { const { delete: remove } = db; await remove(logs).where(eq(logs.id, "x")); return { ok: true }; } });`,
    );
    expect(result).toMatchObject([
      {
        canonicalTarget: { identity: 'logs', provenance: 'table-argument' },
        operation: 'delete',
        operationKind: 'delete',
        operationProvenance: 'receiver-method-alias',
        query: 'dashboard',
        site: 'q.ts:4',
        table: 'logs',
      },
    ]);
  });

  it('emits an unresolved canonical fact for computed Drizzle receiver methods', () => {
    const result = reach(
      `${QHEAD}export const dashboard = query("dashboard", { load: async (db: PgAsyncDatabase<any, any>, method: string) => { await db[method](logs); return { ok: true }; } });`,
    );
    expect(result).toMatchObject([
      {
        canonicalTarget: { identity: 'logs', provenance: 'table-argument' },
        operation: 'UNRESOLVED',
        operationKind: 'UNRESOLVED',
        operationProvenance: 'computed-member',
        query: 'dashboard',
        site: 'q.ts:4',
        table: 'logs',
        unresolved: { code: 'KV406', reason: 'computed-member' },
      },
    ]);
  });

  it('flags query() loaders that reach storage put/delete authority', () => {
    const result = reach(
      [
        'import type { StorageCapability } from "@kovojs/core";',
        'declare const storage: StorageCapability;',
        'export const downloads = query("downloads", {',
        '  load: async () => {',
        '    await storage.put("receipts/a.txt", "A");',
        '    await storage.delete("receipts/a.txt");',
        '    return { ok: true };',
        '  },',
        '});',
      ].join('\n'),
    );
    expect(result).toMatchObject([
      {
        canonicalTarget: { identity: 'storage', provenance: 'storage-receiver' },
        operation: 'put',
        operationKind: 'put',
        operationProvenance: 'property-access',
        query: 'downloads',
        site: 'q.ts:5',
        table: 'storage',
      },
      {
        canonicalTarget: { identity: 'storage', provenance: 'storage-receiver' },
        operation: 'delete',
        operationKind: 'delete',
        operationProvenance: 'property-access',
        query: 'downloads',
        site: 'q.ts:6',
        table: 'storage',
      },
    ]);
  });

  it('flags upload-named storage write authority in query() loaders', () => {
    const result = reach(
      [
        'declare const uploadStorage: { upload(key: string, body: string): Promise<void> };',
        'export const uploads = query("uploads", {',
        '  load: async () => {',
        '    await uploadStorage.upload("receipts/a.txt", "A");',
        '    return { ok: true };',
        '  },',
        '});',
      ].join('\n'),
    );
    expect(result).toMatchObject([
      {
        canonicalTarget: { identity: 'uploadStorage', provenance: 'storage-receiver' },
        operation: 'upload',
        operationKind: 'upload',
        operationProvenance: 'property-access',
        query: 'uploads',
        site: 'q.ts:4',
        table: 'uploadStorage',
      },
    ]);
  });

  it('normalizes destructured storage write method aliases in query loaders', () => {
    const result = reach(
      [
        'declare const uploadStorage: { upload(key: string, body: string): Promise<void> };',
        'export const uploads = query("uploads", {',
        '  load: async () => {',
        '    const { upload } = uploadStorage;',
        '    await upload("receipts/a.txt", "A");',
        '    return { ok: true };',
        '  },',
        '});',
      ].join('\n'),
    );
    expect(result).toMatchObject([
      {
        canonicalTarget: { identity: '__kovoUnresolvedReadSource', provenance: 'storage-receiver' },
        operation: 'upload',
        operationKind: 'upload',
        operationProvenance: 'receiver-method-alias',
        query: 'uploads',
        site: 'q.ts:5',
        table: '__kovoUnresolvedReadSource',
      },
    ]);
  });

  it('fails closed on computed storage receiver methods in query() loaders', () => {
    const result = reach(
      [
        'import type { StorageCapability } from "@kovojs/core";',
        'declare const storage: StorageCapability;',
        'export const downloads = query("downloads", {',
        '  load: async (method: string) => {',
        '    await storage[method]("receipts/a.txt", "A");',
        '    return { ok: true };',
        '  },',
        '});',
      ].join('\n'),
    );
    expect(result).toMatchObject([
      {
        canonicalTarget: { identity: 'storage', provenance: 'storage-receiver' },
        operation: 'UNRESOLVED',
        operationKind: 'UNRESOLVED',
        operationProvenance: 'computed-member',
        query: 'downloads',
        site: 'q.ts:5',
        table: 'storage',
        unresolved: { code: 'KV406', reason: 'computed-member' },
      },
    ]);
  });

  it('flags s.file().store(...) in query() loaders as storage write authority', () => {
    const result = reach(
      [
        'import type { StoragePutCapability } from "@kovojs/core";',
        'import { s } from "@kovojs/server";',
        'declare const storage: StoragePutCapability;',
        'declare const upload: File;',
        'export const uploads = query("uploads", {',
        '  load: async () => {',
        '    const schema = s.file().store({ keyPrefix: "receipts", storage });',
        '    await schema.parseAsync(upload);',
        '    return { ok: true };',
        '  },',
        '});',
      ].join('\n'),
    );
    expect(result).toMatchObject([
      {
        canonicalTarget: { identity: 'storage', provenance: 'storage-receiver' },
        operation: 'store',
        operationKind: 'store',
        operationProvenance: 'property-access',
        query: 'uploads',
        site: 'q.ts:7',
        table: 'storage',
      },
    ]);
  });

  it('summarizes local helper writes reached by query() loaders', () => {
    const result = reach(
      [
        QHEAD,
        'declare const db: PgAsyncDatabase<any, any>;',
        'function purgeLogs() {',
        '  return db.delete(logs).where(eq(logs.id, "x"));',
        '}',
        'export const dashboard = query("dashboard", {',
        '  load: async () => {',
        '    await purgeLogs();',
        '    return { ok: true };',
        '  },',
        '});',
      ].join('\n'),
    );
    expect(result).toMatchObject([
      {
        canonicalTarget: { identity: 'logs', provenance: 'table-argument' },
        operation: 'delete',
        operationKind: 'delete',
        operationProvenance: 'property-access',
        query: 'dashboard',
        site: 'q.ts:7',
        table: 'logs',
      },
    ]);
  });

  it('summarizes imported sibling helper writes reached by query() loaders', () => {
    const result = extractQueryWriteReachabilityFromProject({
      files: [
        writeDbTypes,
        pgDatabaseTypes([
          'delete(table: unknown): { where(value: unknown): Promise<void> }; execute(sql: unknown): Promise<void>;',
        ]),
        {
          fileName: 'schema.ts',
          source:
            'export const logs = pgTable("logs", { id: text("id").primaryKey() }, kovo({ domain: "log" }));',
        },
        {
          fileName: 'helpers.ts',
          source: [
            'import { eq } from "drizzle-orm";',
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            'import { logs } from "./schema";',
            'declare const db: PgAsyncDatabase<any, any>;',
            'export function purgeLogs() {',
            '  return db.delete(logs).where(eq(logs.id, "x"));',
            '}',
            'export function readLogs() {',
            '  return db.select().from(logs);',
            '}',
          ].join('\n'),
        },
        {
          fileName: 'q.ts',
          source: [
            'import { purgeLogs, readLogs } from "./helpers";',
            'export const dashboard = query("dashboard", {',
            '  load: async () => {',
            '    await readLogs();',
            '    await purgeLogs();',
            '    return { ok: true };',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });
    expect(result).toMatchObject([
      {
        canonicalTarget: { identity: 'logs', provenance: 'table-argument' },
        operation: 'delete',
        operationKind: 'delete',
        operationProvenance: 'property-access',
        query: 'dashboard',
        site: 'helpers.ts:6',
        table: 'logs',
      },
    ]);
  });

  it('summarizes helper raw DB writes and storage writes through captured handles', () => {
    const result = reach(
      [
        'import type { StorageCapability } from "@kovojs/core";',
        'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
        'declare const db: PgAsyncDatabase<any, any>;',
        'declare const storage: StorageCapability;',
        'function rebuild() {',
        '  db.execute("vacuum");',
        '  return storage.put("receipts/a.txt", "A");',
        '}',
        'export const dashboard = query("dashboard", {',
        '  load: async () => {',
        '    await rebuild();',
        '    return { ok: true };',
        '  },',
        '});',
      ].join('\n'),
    );
    expect(result).toMatchObject([
      {
        canonicalTarget: { identity: 'UNRESOLVED', provenance: 'raw-receiver-method' },
        operation: 'execute',
        operationKind: 'execute',
        operationProvenance: 'property-access',
        query: 'dashboard',
        site: 'q.ts:6',
        table: '__kovoUnresolvedReadSource',
      },
      {
        canonicalTarget: { identity: 'storage', provenance: 'storage-receiver' },
        operation: 'put',
        operationKind: 'put',
        operationProvenance: 'property-access',
        query: 'dashboard',
        site: 'q.ts:7',
        table: 'storage',
      },
    ]);
  });

  it('does not flag safe read-only sibling helpers', () => {
    const result = reach(
      [
        QHEAD,
        'declare const db: PgAsyncDatabase<any, any>;',
        'function readLogs() {',
        '  return db.select().from(logs);',
        '}',
        'export const dashboard = query("dashboard", {',
        '  load: async () => readLogs(),',
        '});',
      ].join('\n'),
    );
    expect(result).toEqual([]);
  });

  it('fails closed on unprovable write-shaped helper calls in query() loaders', () => {
    const result = reach(
      [
        'declare function deleteFromAuditLog(): Promise<void>;',
        'export const dashboard = query("dashboard", {',
        '  load: async () => {',
        '    await deleteFromAuditLog();',
        '    return { ok: true };',
        '  },',
        '});',
      ].join('\n'),
    );
    expect(result).toMatchObject([
      {
        canonicalTarget: { identity: 'UNRESOLVED', provenance: 'unresolved-table' },
        operation: 'UNRESOLVED',
        operationKind: 'UNRESOLVED',
        operationProvenance: 'property-access',
        query: 'dashboard',
        site: 'q.ts:4',
        table: '__kovoUnresolvedReadSource',
        unresolved: { code: 'KV406', reason: 'computed-member' },
      },
    ]);
  });

  it('fails closed when a summarized helper reaches an unprovable write-shaped helper', () => {
    const result = reach(
      [
        'declare function deleteFromAuditLog(): Promise<void>;',
        'function helper() {',
        '  return deleteFromAuditLog();',
        '}',
        'export const dashboard = query("dashboard", {',
        '  load: async () => {',
        '    await helper();',
        '    return { ok: true };',
        '  },',
        '});',
      ].join('\n'),
    );
    expect(result).toMatchObject([
      {
        canonicalTarget: { identity: 'UNRESOLVED', provenance: 'unresolved-table' },
        operation: 'UNRESOLVED',
        operationKind: 'UNRESOLVED',
        operationProvenance: 'property-access',
        query: 'dashboard',
        site: 'q.ts:3',
        table: '__kovoUnresolvedReadSource',
        unresolved: { code: 'KV406', reason: 'computed-member' },
      },
    ]);
  });

  it('does not flag a read-only loader', () => {
    const result = reach(
      `${QHEAD}export const dashboard = query("dashboard", { load: async () => ({ ok: true }) });`,
    );
    expect(result).toEqual([]);
  });
});
