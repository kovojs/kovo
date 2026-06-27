import type { JsonValue } from '@kovojs/core';
import {
  applyPatchProgram,
  type AlgebraicQueryShape,
  type PatchProgram,
  type SymbolicEffect,
} from '@kovojs/core/internal/derivation';
import { describe, expect, it } from 'vitest';

import { deriveOptimistic } from './derive.js';

// bugz-3 M10 / M11 — SPEC.md §10.5 commuting diagram: a derived optimistic transform is
// sound iff `patch(clientShape(s), i) ≡ clientShape(apply(effect, s, i))`. These two pairs
// are the ones the prior deriver got wrong. Each test (a) reconstructs the insert-shaped
// program the OLD deriver emitted and shows it BREAKS the diagram (the bug), then (b) asserts
// the fixed deriver PUNTS the pair to `await-fragment` (sound: the server is authoritative,
// ~1 RTT) — "wrong predictions are worse than none" (SPEC.md §10.5).

const input: JsonValue = { cartId: 'c1', productId: 'p1', qty: 1 };

// The canonical SPEC §10.3 cart.addItem: insert(cart_items).onConflictDoUpdate(qty += $qty).
const cartUpsert: SymbolicEffect = {
  match: {
    eq: [
      { column: 'cartId', value: { kind: 'param', path: 'cartId' } },
      { column: 'productId', value: { kind: 'param', path: 'productId' } },
    ],
    kind: 'keys',
  },
  op: 'upsert',
  sets: {
    qty: {
      kind: 'arith',
      left: { kind: 'col', column: 'qty' },
      op: '+',
      right: { kind: 'param', path: 'qty' },
    },
  },
  table: 'cart_items',
  values: {
    cartId: { kind: 'param', path: 'cartId' },
    productId: { kind: 'param', path: 'productId' },
    qty: { kind: 'param', path: 'qty' },
  },
};

describe('M10 — UPSERT over a COUNT (§10.5 commuting diagram)', () => {
  const countShape: AlgebraicQueryShape = {
    fields: {
      count: {
        kind: 'count',
        rowset: { filters: [], key: null, orderBy: [], table: 'cart_items' },
      },
    },
    query: 'cartCount',
  };

  it('the OLD insert-shaped program over-predicts +1 on the conflict path', () => {
    // OLD deriver: INSERT × COUNT (no witness) ⇒ inc by 1.
    const oldProgram: PatchProgram = {
      ops: [{ by: { kind: 'const', value: 1 }, op: 'inc', path: 'count' }],
      query: 'cartCount',
    };
    // The product is ALREADY in the cart (count 1) ⇒ the upsert hits the conflict UPDATE
    // path: the existing row's qty is bumped, the row count stays 1.
    const before: JsonValue = { count: 1 };
    const serverReconciled: JsonValue = { count: 1 };
    const predicted = applyPatchProgram(before, input, oldProgram);

    expect(predicted).toEqual({ count: 2 }); // phantom +1 — the bug
    expect(predicted).not.toEqual(serverReconciled); // commuting diagram BROKEN
  });

  it('the fixed deriver punts the pair (no phantom +1 reaches the client)', () => {
    expect(deriveOptimistic([cartUpsert], countShape)).toEqual({
      kind: 'punt',
      reason: { code: 'unsupported', detail: 'UPSERT (onConflictDoUpdate) over cart_items' },
    });
  });
});

describe('M10 — UPSERT over an AGG list (§10.5 commuting diagram)', () => {
  const aggShape: AlgebraicQueryShape = {
    fields: {
      items: {
        columnTypes: { cartId: 'string', productId: 'string', qty: 'number' },
        kind: 'agg',
        projection: ['cartId', 'productId', 'qty'],
        rowKey: 'cartId,productId',
        rowset: { filters: [], key: 'cartId,productId', orderBy: [], table: 'cart_items' },
      },
    },
    query: 'cartItems',
  };

  it('the OLD insert-shaped program duplicates the line item on the conflict path', () => {
    // OLD deriver: INSERT × AGG ⇒ push-row.
    const oldProgram: PatchProgram = {
      ops: [
        {
          op: 'push-row',
          path: 'items',
          placeholderColumns: [],
          position: 'end',
          row: {
            cartId: { kind: 'param', path: 'cartId' },
            productId: { kind: 'param', path: 'productId' },
            qty: { kind: 'param', path: 'qty' },
          },
        },
      ],
      query: 'cartItems',
    };
    const before: JsonValue = { items: [{ cartId: 'c1', productId: 'p1', qty: 1 }] };
    const predicted = applyPatchProgram(before, input, oldProgram) as { items: unknown[] };

    // Server truth on the conflict path: still ONE row (qty updated to 2), not two.
    expect(predicted.items).toHaveLength(2); // duplicate row — the bug
  });

  it('the fixed deriver punts the pair (no duplicate row reaches the client)', () => {
    expect(deriveOptimistic([cartUpsert], aggShape)).toEqual({
      kind: 'punt',
      reason: { code: 'unsupported', detail: 'UPSERT (onConflictDoUpdate) over cart_items' },
    });
  });
});

describe('M11 — sorted INSERT on a text orderBy column (§10.5 commuting diagram)', () => {
  const textShape: AlgebraicQueryShape = {
    fields: {
      items: {
        columnTypes: { id: 'string', title: 'string' },
        kind: 'agg',
        projection: ['id', 'title'],
        rowKey: 'id',
        rowset: {
          filters: [],
          key: 'id',
          orderBy: [{ column: 'title', direction: 'asc' }],
          table: 'todos',
        },
      },
    },
    query: 'todoList',
  };
  const insertTodo: SymbolicEffect = {
    op: 'insert',
    table: 'todos',
    values: { id: { kind: 'param', path: 'id' }, title: { kind: 'param', path: 'title' } },
  };

  it('the OLD numeric-sorted program appends to the END (NaN compare), diverging from lexical order', () => {
    // OLD deriver: INSERT × AGG with a sorted position keyed on the text `title`.
    const oldProgram: PatchProgram = {
      ops: [
        {
          op: 'push-row',
          path: 'items',
          placeholderColumns: [],
          position: { column: 'title', direction: 'asc' },
          row: { id: { kind: 'param', path: 'id' }, title: { kind: 'param', path: 'title' } },
        },
      ],
      query: 'todoList',
    };
    const before: JsonValue = {
      items: [
        { id: 'a', title: 'Apple' },
        { id: 'z', title: 'Zebra' },
      ],
    };
    const mango: JsonValue = { id: 'm', title: 'Mango' };
    const predicted = applyPatchProgram(before, mango, oldProgram) as {
      items: { title: string }[];
    };

    // asNumber('Mango') is NaN ⇒ every compare false ⇒ row appended at the END.
    expect(predicted.items.map((row) => row.title)).toEqual(['Apple', 'Zebra', 'Mango']);
    // The server's lexical ORDER BY title would place Mango BETWEEN Apple and Zebra.
    expect(predicted.items.map((row) => row.title)).not.toEqual(['Apple', 'Mango', 'Zebra']);
  });

  it('the fixed deriver punts the text-orderBy sorted insert', () => {
    expect(deriveOptimistic([insertTodo], textShape)).toEqual({
      kind: 'punt',
      reason: { code: 'opaque-orderby', column: 'title' },
    });
  });
});
