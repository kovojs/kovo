import { describe, expect, it } from 'vitest';

// Pin the real pinned Drizzle Postgres surfaces the §10.5 derivation extractors
// must analyze; importing them here fails loudly on a pinned-API drift.
import { count, eq, gt, sql, sum } from 'drizzle-orm';
import { integer, pgTable, text } from 'drizzle-orm/pg-core';

import { deriveOptimistic } from '../../../packages/drizzle/src/derive.js';
import type {
  AlgebraicQueryShape,
  DerivationResult,
  SymbolicEffect,
} from '../../../packages/core/src/internal/derivation.js';
import {
  extractAlgebraicShapesFromProject,
  extractSymbolicEffectsFromProject,
  type SymbolicEffectFact,
} from '../../../packages/drizzle/src/static.js';

// SPEC.md §10.5 / plan plans/derived-optimism.md Phases 1+2 grammar-coverage proof.
// For a matrix of small REAL `drizzle-orm/pg-core` apps we assert the extracted
// Stage-1 `SymbolicEffect` and Stage-2 `AlgebraicQueryShape` IR (every value /
// match / algebraic class), AND the end-to-end `deriveOptimistic` outcome
// (derived program OR named §10.5 punt) for each (mutation × query) pair. All
// assertions are formatting-resistant: structured IR / algebraic class / punt
// code — never source-string snapshots.

const COMMON_IMPORTS = [
  "import { and, count, eq, gt, sql, sum } from 'drizzle-orm';",
  "import { integer, pgTable, text, type PgAsyncDatabase } from 'drizzle-orm/pg-core';",
  '',
].join('\n');

function effectsOf(...lines: string[]): SymbolicEffect[] {
  return extractEffectFacts(...lines).map((fact) => fact.effect);
}

function extractEffectFacts(...lines: string[]): SymbolicEffectFact[] {
  return extractSymbolicEffectsFromProject({
    files: [
      { fileName: 'conformance/drizzle-pin/src/derivation.write.ts', source: lines.join('\n') },
    ],
  });
}

function shapeOf(...lines: string[]): AlgebraicQueryShape {
  const shapes = extractAlgebraicShapesFromProject({
    files: [
      { fileName: 'conformance/drizzle-pin/src/derivation.query.ts', source: lines.join('\n') },
    ],
  });
  const shape = shapes[0];
  if (!shape) throw new Error('expected an extracted AlgebraicQueryShape');
  return shape;
}

// ── Table schemas reused across the matrix (real pgTable + kovo annotations) ──

const ITEMS_TABLE = [
  "export const items = pgTable('items', {",
  "  id: text('id').primaryKey(),",
  "  cartId: text('cart_id'),",
  "  qty: integer('qty'),",
  "  stock: integer('stock'),",
  "  tag: text('tag'),",
  "}, kovo({ domain: 'item', key: 'id' }));",
].join('\n');

describe('Drizzle pinned subset conformance — §10.5 derivation subset', () => {
  it('imports the pinned aggregate/comparison surfaces extraction depends on', () => {
    const t = pgTable('t', { id: text('id').primaryKey(), qty: integer('qty') });
    expect(count()).toBeDefined();
    expect(sum(t.qty)).toBeDefined();
    expect(eq(t.id, 'x')).toBeDefined();
    expect(gt(t.qty, 0)).toBeDefined();
    expect(sql`now()`).toBeDefined();
  });

  // ───────────────────────── Stage 1: write → effect ────────────────────────

  describe('Stage 1 — write → SymbolicEffect grammar coverage', () => {
    it('INSERT with Param + Const + Arith values (and named Opaque server compute)', () => {
      const facts = extractEffectFacts(
        COMMON_IMPORTS,
        ITEMS_TABLE,
        'export const item = domain({',
        '  add: write(async (db: PgAsyncDatabase<any, any>, id: string, qty: number) => {',
        '    await db.insert(items).values({ id, qty, stock: qty * 2, tag: serverTag() });',
        '  }),',
        '});',
      );

      expect(facts).toHaveLength(1);
      expect(facts[0]?.writeKey).toBe('item.add');
      expect(facts[0]?.effect).toEqual({
        op: 'insert',
        table: 'items',
        values: {
          id: { kind: 'param', path: 'id' },
          qty: { kind: 'param', path: 'qty' },
          stock: {
            kind: 'arith',
            left: { kind: 'param', path: 'qty' },
            op: '*',
            right: { kind: 'const', value: 2 },
          },
          tag: { kind: 'opaque', expr: 'unsummarized-helper:serverTag' },
        },
      });
    });

    it('UPDATE with self-referential ColRef arith SET and eq-key match', () => {
      expect(
        effectsOf(
          COMMON_IMPORTS,
          ITEMS_TABLE,
          'export const item = domain({',
          '  decr: write(async (db: PgAsyncDatabase<any, any>, id: string, qty: number) => {',
          '    await db.update(items).set({ stock: items.stock - qty }).where(eq(items.id, id));',
          '  }),',
          '});',
        ),
      ).toEqual([
        {
          match: { eq: [{ column: 'id', value: { kind: 'param', path: 'id' } }], kind: 'keys' },
          op: 'update',
          sets: {
            stock: {
              kind: 'arith',
              left: { kind: 'col', column: 'stock' },
              op: '-',
              right: { kind: 'param', path: 'qty' },
            },
          },
          table: 'items',
        },
      ]);
    });

    it('DELETE with eq-key match', () => {
      expect(
        effectsOf(
          COMMON_IMPORTS,
          ITEMS_TABLE,
          'export const item = domain({',
          '  remove: write(async (db: PgAsyncDatabase<any, any>, id: string) => {',
          '    await db.delete(items).where(eq(items.id, id));',
          '  }),',
          '});',
        ),
      ).toEqual([
        {
          match: { eq: [{ column: 'id', value: { kind: 'param', path: 'id' } }], kind: 'keys' },
          op: 'delete',
          table: 'items',
        },
      ]);
    });

    it('destructured mutation input binds each field as a top-level $input param', () => {
      expect(
        effectsOf(
          COMMON_IMPORTS,
          ITEMS_TABLE,
          'export async function add({ id, qty }: { id: string; qty: number }, db: PgAsyncDatabase<any, any>) {',
          '  await db.insert(items).values({ id, qty });',
          '}',
        ),
      ).toEqual([
        {
          op: 'insert',
          table: 'items',
          values: { id: { kind: 'param', path: 'id' }, qty: { kind: 'param', path: 'qty' } },
        },
      ]);
    });

    it('runtime-valid sql`${col} - ${param}` SET extracts as a self-referential Arith', () => {
      expect(
        effectsOf(
          COMMON_IMPORTS,
          ITEMS_TABLE,
          'export const item = domain({',
          '  decr: write(async (db: PgAsyncDatabase<any, any>, id: string, qty: number) => {',
          '    await db.update(items).set({ stock: sql`${items.stock} - ${qty}` }).where(eq(items.id, id));',
          '  }),',
          '});',
        ),
      ).toEqual([
        {
          match: { eq: [{ column: 'id', value: { kind: 'param', path: 'id' } }], kind: 'keys' },
          op: 'update',
          sets: {
            stock: {
              kind: 'arith',
              left: { kind: 'col', column: 'stock' },
              op: '-',
              right: { kind: 'param', path: 'qty' },
            },
          },
          table: 'items',
        },
      ]);
    });

    it('UPSERT (onConflictDoUpdate) carries both values and conflict SET', () => {
      expect(
        effectsOf(
          COMMON_IMPORTS,
          ITEMS_TABLE,
          'export const item = domain({',
          '  upsert: write(async (db: PgAsyncDatabase<any, any>, id: string, qty: number) => {',
          '    await db',
          '      .insert(items)',
          '      .values({ id, qty })',
          '      .onConflictDoUpdate({ target: items.id, set: { qty } });',
          '  }),',
          '});',
        ),
      ).toEqual([
        {
          match: { eq: [], kind: 'keys' },
          op: 'upsert',
          sets: { qty: { kind: 'param', path: 'qty' } },
          table: 'items',
          values: { id: { kind: 'param', path: 'id' }, qty: { kind: 'param', path: 'qty' } },
        },
      ]);
    });

    it('named-Opaque SET for a raw sql expression (Opaque SET ⇒ punt)', () => {
      const [effect] = effectsOf(
        COMMON_IMPORTS,
        ITEMS_TABLE,
        'export const item = domain({',
        '  bump: write(async (db: PgAsyncDatabase<any, any>, id: string) => {',
        '    await db.update(items).set({ stock: sql`stock + 1` }).where(eq(items.id, id));',
        '  }),',
        '});',
      );
      expect(effect?.op).toBe('update');
      expect(effect && effect.op === 'update' && effect.sets.stock).toEqual({
        kind: 'opaque',
        expr: 'sql`stock + 1`',
      });
    });

    it('named-Opaque match for a non-key range predicate (non-key match ⇒ punt)', () => {
      const [effect] = effectsOf(
        COMMON_IMPORTS,
        ITEMS_TABLE,
        'export const item = domain({',
        '  clearLow: write(async (db: PgAsyncDatabase<any, any>) => {',
        '    await db.delete(items).where(gt(items.stock, 0));',
        '  }),',
        '});',
      );
      expect(effect?.op).toBe('delete');
      expect(effect && 'match' in effect ? effect.match : undefined).toEqual({
        expr: 'gt(items.stock, 0)',
        kind: 'opaque',
      });
    });

    it('named-Opaque value for an untraceable identifier (untraceable param ⇒ Opaque)', () => {
      const [effect] = effectsOf(
        COMMON_IMPORTS,
        ITEMS_TABLE,
        "const ambient = 'x';",
        'export const item = domain({',
        '  add: write(async (db: PgAsyncDatabase<any, any>, id: string) => {',
        '    await db.insert(items).values({ id, tag: ambient });',
        '  }),',
        '});',
      );
      expect(effect && effect.op === 'insert' && effect.values.tag).toEqual({
        kind: 'opaque',
        expr: 'ambient',
      });
    });

    it('emits the unresolved-table marker (deriver punts) when the table is un-analyzable', () => {
      const [effect] = effectsOf(
        COMMON_IMPORTS,
        'export const item = domain({',
        '  add: write(async (db: PgAsyncDatabase<any, any>, table: any) => {',
        '    await db.insert(table).values({ id: 1 });',
        '  }),',
        '});',
      );
      expect(effect?.table).toBe('__kovoUnresolvedReadSource');
    });
  });

  // ──────────────────────── Stage 2: query → shape ──────────────────────────

  describe('Stage 2 — query → AlgebraicField grammar coverage', () => {
    function singleField(...lines: string[]) {
      const shape = shapeOf(...lines);
      return shape.fields.f;
    }

    it('Scalar(keyed-row col)', () => {
      expect(
        singleField(
          COMMON_IMPORTS,
          ITEMS_TABLE,
          "export const q = query('q', {",
          '  load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
          "    return { f: db.select({ stock: items.stock }).from(items).where(eq(items.id, 'x')) };",
          '  },',
          '});',
        ),
      ).toEqual({
        column: 'stock',
        kind: 'scalar',
        rowset: {
          filters: [{ column: 'id', op: 'eq', value: { kind: 'const', value: 'x' } }],
          key: 'id',
          orderBy: [],
          table: 'items',
        },
      });
    });

    it('COUNT(R, pred) with an eq filter predicate', () => {
      expect(
        singleField(
          COMMON_IMPORTS,
          ITEMS_TABLE,
          "export const q = query('q', {",
          '  load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
          "    return { f: db.select({ value: count() }).from(items).where(eq(items.cartId, 'c1')) };",
          '  },',
          '});',
        ),
      ).toEqual({
        kind: 'count',
        pred: { column: 'cartId', op: 'eq', value: { kind: 'const', value: 'c1' } },
        rowset: {
          filters: [{ column: 'cartId', op: 'eq', value: { kind: 'const', value: 'c1' } }],
          key: 'id',
          orderBy: [],
          table: 'items',
        },
      });
    });

    it('SUM(R, arith) over a column', () => {
      expect(
        singleField(
          COMMON_IMPORTS,
          ITEMS_TABLE,
          "export const q = query('q', {",
          '  load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
          '    return { f: db.select({ value: sum(items.qty) }).from(items) };',
          '  },',
          '});',
        ),
      ).toEqual({
        arith: { column: 'qty', kind: 'col' },
        kind: 'sum',
        rowset: { filters: [], key: 'id', orderBy: [], table: 'items' },
      });
    });

    it('AGG(R, projection) with rowKey, columnTypes, and a rows witness', () => {
      const shape = shapeOf(
        COMMON_IMPORTS,
        ITEMS_TABLE,
        "export const q = query('grid', {",
        '  load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
        '    return { items: db.select({ id: items.id, stock: items.stock }).from(items).orderBy(items.id) };',
        '  },',
        '});',
      );
      expect(shape.fields.items).toEqual({
        columnTypes: { id: 'string', stock: 'number' },
        kind: 'agg',
        projection: ['id', 'stock'],
        rowKey: 'id',
        rowset: {
          filters: [],
          key: 'id',
          orderBy: [{ column: 'id', direction: 'asc' }],
          table: 'items',
        },
      });
      expect(shape.rowsByTable).toEqual({
        items: {
          columns: ['id', 'stock'],
          rowsPath: 'items',
          rowset: {
            filters: [],
            key: 'id',
            orderBy: [{ column: 'id', direction: 'asc' }],
            table: 'items',
          },
        },
      });
    });

    it('cursor over a paginated (limit) rows sibling', () => {
      const shape = shapeOf(
        COMMON_IMPORTS,
        ITEMS_TABLE,
        "export const q = query('grid', {",
        '  load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
        '    const rows = db.select({ id: items.id }).from(items).orderBy(items.id).limit(20);',
        '    return { items: rows, nextCursor: rows.at(-1)?.id };',
        '  },',
        '});',
      );
      expect(shape.fields.nextCursor).toEqual({
        kind: 'cursor',
        rowset: {
          filters: [],
          key: 'id',
          orderBy: [{ column: 'id', direction: 'asc' }],
          table: 'items',
        },
      });
    });

    it('opaque-shape{distinct} for a DISTINCT select', () => {
      expect(
        singleField(
          COMMON_IMPORTS,
          ITEMS_TABLE,
          "export const q = query('q', {",
          '  load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
          '    return { f: db.selectDistinct({ tag: items.tag }).from(items) };',
          '  },',
          '});',
        ),
      ).toEqual({ kind: 'opaque', reason: { code: 'opaque-shape', shape: 'distinct' } });
    });

    it('opaque-shape{group-by-having} for a GROUP BY select', () => {
      expect(
        singleField(
          COMMON_IMPORTS,
          ITEMS_TABLE,
          "export const q = query('q', {",
          '  load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
          '    return { f: db.select({ value: count() }).from(items).groupBy(items.tag) };',
          '  },',
          '});',
        ),
      ).toEqual({ kind: 'opaque', reason: { code: 'opaque-shape', shape: 'group-by-having' } });
    });

    it('opaque-shape{window} for a window function projection', () => {
      expect(
        singleField(
          COMMON_IMPORTS,
          ITEMS_TABLE,
          "export const q = query('q', {",
          '  load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
          '    return { f: db.select({ value: count().over() }).from(items) };',
          '  },',
          '});',
        ),
      ).toEqual({ kind: 'opaque', reason: { code: 'opaque-shape', shape: 'window' } });
    });

    it('opaque-projection for a raw sql<T> projection (KV410)', () => {
      expect(
        singleField(
          COMMON_IMPORTS,
          ITEMS_TABLE,
          "export const q = query('q', {",
          '  load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
          '    return { f: db.select({ id: items.id, total: sql<number>`sum(qty)` }).from(items) };',
          '  },',
          '});',
        ),
      ).toEqual({
        kind: 'opaque',
        reason: { code: 'opaque-projection', expr: 'sql<number>`sum(qty)`' },
      });
    });

    // Real runtime loaders await the query and project the scalar out of the
    // `[{ value }]` aggregate result; the extractor must see through that.
    it('SUM via a real async loader (const row = await select; Number(rows[0]?.value ?? 0))', () => {
      expect(
        singleField(
          COMMON_IMPORTS,
          ITEMS_TABLE,
          "export const q = query('q', {",
          '  load: async (_input: unknown, db: PgAsyncDatabase<any, any>) => {',
          '    const rows = await db.select({ value: sum(items.qty) }).from(items);',
          '    return { f: Number(rows[0]?.value ?? 0) };',
          '  },',
          '});',
        ),
      ).toEqual({
        arith: { column: 'qty', kind: 'col' },
        kind: 'sum',
        rowset: { filters: [], key: 'id', orderBy: [], table: 'items' },
      });
    });

    it('AGG via a real async loader (f: await select().orderBy())', () => {
      expect(
        singleField(
          COMMON_IMPORTS,
          ITEMS_TABLE,
          "export const q = query('q', {",
          '  load: async (_input: unknown, db: PgAsyncDatabase<any, any>) =>',
          '    ({ f: await db.select({ id: items.id, stock: items.stock }).from(items).orderBy(items.id) }),',
          '});',
        ),
      ).toMatchObject({ kind: 'agg', projection: ['id', 'stock'], rowKey: 'id' });
    });
  });

  // ─────────────── End-to-end: deriveOptimistic(matrix pairs) ────────────────

  describe('Stage 3 — deriveOptimistic over extracted (mutation × query) pairs', () => {
    const insertEffect = effectsOf(
      COMMON_IMPORTS,
      ITEMS_TABLE,
      'export const item = domain({',
      '  add: write(async (db: PgAsyncDatabase<any, any>, id: string, qty: number) => {',
      '    await db.insert(items).values({ id, qty, cartId: id });',
      '  }),',
      '});',
    );
    const decrEffect = effectsOf(
      COMMON_IMPORTS,
      ITEMS_TABLE,
      'export const item = domain({',
      '  decr: write(async (db: PgAsyncDatabase<any, any>, id: string, qty: number) => {',
      '    await db.update(items).set({ stock: items.stock - qty }).where(eq(items.id, id));',
      '  }),',
      '});',
    );
    const deleteEffect = effectsOf(
      COMMON_IMPORTS,
      ITEMS_TABLE,
      'export const item = domain({',
      '  remove: write(async (db: PgAsyncDatabase<any, any>, id: string) => {',
      '    await db.delete(items).where(eq(items.id, id));',
      '  }),',
      '});',
    );
    const opaqueSetEffect = effectsOf(
      COMMON_IMPORTS,
      ITEMS_TABLE,
      'export const item = domain({',
      '  bump: write(async (db: PgAsyncDatabase<any, any>, id: string) => {',
      '    await db.update(items).set({ stock: sql`stock + 1` }).where(eq(items.id, id));',
      '  }),',
      '});',
    );

    const sumShape = shapeOf(
      COMMON_IMPORTS,
      ITEMS_TABLE,
      "export const q = query('cart', {",
      '  load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
      "    return { total: db.select({ value: sum(items.qty) }).from(items).where(eq(items.cartId, 'c1')) };",
      '  },',
      '});',
    );
    const gridShape = shapeOf(
      COMMON_IMPORTS,
      ITEMS_TABLE,
      "export const q = query('grid', {",
      '  load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
      '    return { items: db.select({ id: items.id, stock: items.stock }).from(items) };',
      '  },',
      '});',
    );
    const countShape = shapeOf(
      COMMON_IMPORTS,
      ITEMS_TABLE,
      "export const q = query('count', {",
      '  load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
      '    const rows = db.select({ id: items.id }).from(items);',
      '    return { items: rows, total: db.select({ value: count() }).from(items) };',
      '  },',
      '});',
    );

    function derive(effects: SymbolicEffect[], shape: AlgebraicQueryShape): DerivationResult {
      return deriveOptimistic(effects, shape);
    }

    it('INSERT × SUM ⇒ derived inc by the contributed column', () => {
      expect(derive(insertEffect, sumShape)).toEqual({
        kind: 'derived',
        program: {
          ops: [{ by: { kind: 'param', path: 'qty' }, op: 'inc', path: 'total' }],
          query: 'cart',
        },
      });
    });

    it('UPDATE × AGG (keyed self-arith) ⇒ derived guarded update-row', () => {
      expect(derive(decrEffect, gridShape)).toEqual({
        kind: 'derived',
        program: {
          ops: [
            {
              guard: 'find-or-noop',
              match: [{ column: 'id', value: { kind: 'param', path: 'id' } }],
              op: 'update-row',
              path: 'items',
              sets: {
                stock: {
                  kind: 'arith',
                  left: { kind: 'col', column: 'stock' },
                  op: '-',
                  right: { kind: 'param', path: 'qty' },
                },
              },
            },
          ],
          query: 'grid',
        },
      });
    });

    it('DELETE × (AGG + COUNT) ⇒ derived remove-row then recount', () => {
      expect(derive(deleteEffect, countShape)).toEqual({
        kind: 'derived',
        program: {
          ops: [
            {
              guard: 'find-or-noop',
              match: [{ column: 'id', value: { kind: 'param', path: 'id' } }],
              op: 'remove-row',
              path: 'items',
            },
            { from: 'items', op: 'recount', path: 'total' },
          ],
          query: 'count',
        },
      });
    });

    it('INSERT × AGG (Opaque cols) ⇒ derived push-row with placeholders', () => {
      const result = derive(insertEffect, gridShape);
      expect(result.kind).toBe('derived');
      if (result.kind !== 'derived') return;
      const [op] = result.program.ops;
      expect(op?.op).toBe('push-row');
      if (op?.op !== 'push-row') return;
      // `stock` is not supplied by the INSERT ⇒ a type-correct placeholder excluded
      // from soundness equality (SPEC.md §10.5 INSERT × AGG).
      expect(op.placeholderColumns).toEqual(['stock']);
      expect(op.row).toEqual({
        id: { kind: 'param', path: 'id' },
        stock: { kind: 'const', value: 0 },
      });
    });

    it('UPDATE Opaque-SET × Scalar ⇒ punt (opaque-set), never a best-effort patch', () => {
      const scalarShape = shapeOf(
        COMMON_IMPORTS,
        ITEMS_TABLE,
        "export const q = query('scalar', {",
        '  load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
        "    return { stock: db.select({ stock: items.stock }).from(items).where(eq(items.id, 'x')) };",
        '  },',
        '});',
      );
      expect(derive(opaqueSetEffect, scalarShape)).toEqual({
        kind: 'punt',
        reason: { code: 'opaque-set', expr: 'SET stock' },
      });
    });

    it('any-table × opaque-shape query ⇒ punt with the shape PuntReason', () => {
      const distinctShape = shapeOf(
        COMMON_IMPORTS,
        ITEMS_TABLE,
        "export const q = query('distinct', {",
        '  load(_input: unknown, db: PgAsyncDatabase<any, any>) {',
        '    return { tags: db.selectDistinct({ tag: items.tag }).from(items) };',
        '  },',
        '});',
      );
      expect(derive(insertEffect, distinctShape)).toEqual({
        kind: 'punt',
        reason: { code: 'opaque-shape', shape: 'distinct' },
      });
    });
  });
});
