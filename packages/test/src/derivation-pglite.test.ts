import {
  applyPatchProgram,
  type AlgebraicQueryShape,
  type JsonValue,
  type SymbolicEffect,
} from '@kovojs/core';
import { deriveOptimistic } from '@kovojs/drizzle/derive';
import { afterEach, describe, expect, it } from 'vitest';

import { createPgliteTestDb, type PgliteTestDb } from './pglite.js';

// SPEC.md §10.5 / §11.4 point 4: soundness is property-tested as the commuting
// diagram patch(clientShape(s), i) ≡ clientShape(apply(effect, s, i)) over the
// pinned Drizzle Postgres subset — run here against REAL Postgres semantics via
// the in-process pglite harness. Each case authors the SQL effect + query and the
// matching symbolic IR; the derived patch must agree with what Postgres does.

interface CommutingCase {
  effect: SymbolicEffect;
  input: Record<string, JsonValue>;
  mutationParams: (input: Record<string, JsonValue>) => unknown[];
  mutationSql: string;
  name: string;
  placeholderColumns?: readonly string[];
  querySql: string;
  schema: readonly string[];
  shape: AlgebraicQueryShape;
  toShape: (rows: readonly Record<string, unknown>[]) => JsonValue;
}

const productsRowset = {
  filters: [],
  key: 'id',
  orderBy: [{ column: 'id', direction: 'asc' as const }],
  table: 'products',
};

const CASES: CommutingCase[] = [
  {
    effect: { op: 'insert', table: 'cart_items', values: { qty: { kind: 'param', path: 'qty' } } },
    input: { qty: 3 },
    mutationParams: (input) => [input.qty],
    mutationSql: 'INSERT INTO cart_items (qty) VALUES ($1)',
    name: 'INSERT × SUM increments the scalar total',
    querySql: 'SELECT COALESCE(SUM(qty), 0)::int AS total FROM cart_items',
    schema: [
      'CREATE TABLE cart_items (id serial PRIMARY KEY, qty int NOT NULL)',
      'INSERT INTO cart_items (qty) VALUES (2), (5)',
    ],
    shape: {
      fields: {
        total: {
          arith: { column: 'qty', kind: 'col' },
          kind: 'sum',
          rowset: { filters: [], key: null, orderBy: [], table: 'cart_items' },
        },
      },
      query: 'cart',
    },
    toShape: (rows) => ({ total: Number(rows[0]?.total ?? 0) }),
  },
  {
    effect: {
      match: { eq: [{ column: 'id', value: { kind: 'param', path: 'id' } }], kind: 'keys' },
      op: 'delete',
      table: 'todos',
    },
    input: { id: 'b' },
    mutationParams: (input) => [input.id],
    mutationSql: 'DELETE FROM todos WHERE id = $1',
    name: 'DELETE × (AGG + COUNT) removes the row and recounts',
    querySql: 'SELECT id FROM todos ORDER BY id',
    schema: [
      'CREATE TABLE todos (id text PRIMARY KEY)',
      "INSERT INTO todos (id) VALUES ('a'), ('b'), ('c')",
    ],
    shape: {
      fields: {
        items: {
          kind: 'agg',
          projection: ['id'],
          rowKey: 'id',
          rowset: { filters: [], key: 'id', orderBy: [], table: 'todos' },
        },
        total: {
          kind: 'count',
          rowset: { filters: [], key: 'id', orderBy: [], table: 'todos' },
          witness: { columns: ['id'], rowsPath: 'items' },
        },
      },
      query: 'todos',
      rowsByTable: { todos: { columns: ['id'], rowsPath: 'items' } },
    },
    toShape: (rows) => ({
      items: rows.map((row) => ({ id: row.id })) as JsonValue,
      total: rows.length,
    }),
  },
  {
    effect: {
      match: { eq: [{ column: 'id', value: { kind: 'param', path: 'id' } }], kind: 'keys' },
      op: 'update',
      sets: {
        stock: {
          kind: 'arith',
          left: { column: 'stock', kind: 'col' },
          op: '-',
          right: { kind: 'param', path: 'qty' },
        },
      },
      table: 'products',
    },
    input: { id: 'p1', qty: 2 },
    mutationParams: (input) => [input.qty, input.id],
    mutationSql: 'UPDATE products SET stock = stock - $1 WHERE id = $2',
    name: 'UPDATE keyed-row scalar (AGG) decrements the matched row',
    querySql: 'SELECT id, stock FROM products ORDER BY id',
    schema: [
      'CREATE TABLE products (id text PRIMARY KEY, stock int NOT NULL)',
      "INSERT INTO products (id, stock) VALUES ('p1', 5), ('p2', 9)",
    ],
    shape: {
      fields: {
        items: { kind: 'agg', projection: ['id', 'stock'], rowKey: 'id', rowset: productsRowset },
      },
      query: 'productGrid',
      rowsByTable: { products: { columns: ['id', 'stock'], rowsPath: 'items' } },
    },
    toShape: (rows) => ({
      items: rows.map((row) => ({ id: row.id, stock: Number(row.stock) })) as JsonValue,
    }),
  },
  {
    effect: {
      op: 'insert',
      table: 'notes',
      values: { id: { kind: 'opaque', expr: 'serial' }, label: { kind: 'param', path: 'label' } },
    },
    input: { label: 'fresh' },
    mutationParams: (input) => [input.label],
    mutationSql: 'INSERT INTO notes (label) VALUES ($1)',
    name: 'INSERT × AGG appends a row (opaque id placeholder, content-matched)',
    placeholderColumns: ['id'],
    querySql: 'SELECT id, label FROM notes ORDER BY id',
    schema: [
      'CREATE TABLE notes (id serial PRIMARY KEY, label text NOT NULL)',
      "INSERT INTO notes (label) VALUES ('first')",
    ],
    shape: {
      fields: {
        items: {
          columnTypes: { id: 'number', label: 'string' },
          kind: 'agg',
          projection: ['id', 'label'],
          rowKey: 'id',
          rowset: { filters: [], key: 'id', orderBy: [], table: 'notes' },
        },
      },
      query: 'notes',
      rowsByTable: { notes: { columns: ['id', 'label'], rowsPath: 'items' } },
    },
    toShape: (rows) => ({
      items: rows.map((row) => ({ id: Number(row.id), label: row.label })) as JsonValue,
    }),
  },
];

let activeDb: PgliteTestDb | undefined;

afterEach(async () => {
  await activeDb?.close();
  activeDb = undefined;
});

function stripPlaceholders(value: JsonValue, columns: readonly string[]): JsonValue {
  if (columns.length === 0) return value;
  const clone = structuredClone(value) as { items?: JsonValue[] };
  if (Array.isArray(clone.items)) {
    clone.items = clone.items.map((row) => {
      if (row === null || typeof row !== 'object' || Array.isArray(row)) return row;
      const next = { ...(row as Record<string, JsonValue>) };
      for (const column of columns) delete next[column];
      return next;
    });
  }
  return clone as JsonValue;
}

async function commutingTruth(
  testCase: CommutingCase,
): Promise<{ before: JsonValue; truth: JsonValue }> {
  const db = await createPgliteTestDb();
  activeDb = db;
  for (const statement of testCase.schema) await db.exec(statement);
  const before = testCase.toShape(await db.query(testCase.querySql));
  await db.query(testCase.mutationSql, testCase.mutationParams(testCase.input));
  const truth = testCase.toShape(await db.query(testCase.querySql));
  return { before, truth };
}

describe('derived optimism — commuting diagrams over real Postgres (pglite)', () => {
  for (const testCase of CASES) {
    it(testCase.name, async () => {
      const result = deriveOptimistic([testCase.effect], testCase.shape);
      expect(result.kind).toBe('derived');
      if (result.kind !== 'derived') return;

      const { before, truth } = await commutingTruth(testCase);
      const predicted = applyPatchProgram(before, testCase.input, result.program, {
        now: () => 0,
        tempId: () => '__tempId__',
      });

      const columns = testCase.placeholderColumns ?? [];
      expect(stripPlaceholders(predicted, columns)).toEqual(stripPlaceholders(truth, columns));
    });
  }

  it('fails loudly when a derived program disagrees with Postgres', async () => {
    const testCase = CASES[0]!;
    const { before, truth } = await commutingTruth(testCase);
    // Deliberately broken program: increments by a wrong constant.
    const broken = applyPatchProgram(before, testCase.input, {
      ops: [{ by: { kind: 'const', value: 999 }, op: 'inc', path: 'total' }],
      query: 'cart',
    });
    expect(broken).not.toEqual(truth);
  });
});
