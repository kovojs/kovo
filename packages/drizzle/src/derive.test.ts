import type { AlgebraicQueryShape, SymbolicEffect } from '@jiso/core';
import { describe, expect, it } from 'vitest';

import { deriveOptimistic } from './derive.js';

// SPEC.md §10.5 Stage 3 — the deriver's own unit surface. The cross-package
// "deriver produces the shared contract fixtures" check lives in @jiso/test
// (which owns the fixtures and the commuting-diagram suite); here we pin the
// per-rule positive cases and the §10.5 PUNT list inline.

describe('deriveOptimistic — §10.5 Stage-3 rules (positive)', () => {
  it('INSERT × SUM (no rows shipped) increments by the contributed column', () => {
    const shape: AlgebraicQueryShape = {
      fields: {
        count: {
          arith: { kind: 'col', column: 'qty' },
          kind: 'sum',
          rowset: { filters: [], key: null, orderBy: [], table: 'cart_items' },
        },
      },
      query: 'cart',
    };
    const effect: SymbolicEffect = {
      op: 'insert',
      table: 'cart_items',
      values: {
        qty: { kind: 'param', path: 'quantity' },
        unitPrice: { kind: 'opaque', expr: 'price' },
      },
    };
    expect(deriveOptimistic([effect], shape)).toEqual({
      kind: 'derived',
      program: {
        ops: [{ by: { kind: 'param', path: 'quantity' }, op: 'inc', path: 'count' }],
        query: 'cart',
      },
    });
  });

  it('UPDATE × AGG (keyed row, self-arith) emits a guarded update; cursor is invariant', () => {
    const rowset = {
      filters: [],
      key: 'id',
      orderBy: [{ column: 'id', direction: 'asc' as const }],
      table: 'products',
    };
    const shape: AlgebraicQueryShape = {
      fields: {
        items: { kind: 'agg', projection: ['id', 'stock'], rowKey: 'id', rowset },
        nextCursor: { kind: 'cursor', rowset },
      },
      query: 'productGrid',
      rowsByTable: { products: { columns: ['id', 'stock'], rowsPath: 'items' } },
    };
    const effect: SymbolicEffect = {
      match: { eq: [{ column: 'id', value: { kind: 'param', path: 'productId' } }], kind: 'keys' },
      op: 'update',
      sets: {
        stock: {
          kind: 'arith',
          left: { kind: 'col', column: 'stock' },
          op: '-',
          right: { kind: 'param', path: 'quantity' },
        },
      },
      table: 'products',
    };
    expect(deriveOptimistic([effect], shape)).toEqual({
      kind: 'derived',
      program: {
        ops: [
          {
            guard: 'find-or-noop',
            match: [{ column: 'id', value: { kind: 'param', path: 'productId' } }],
            op: 'update-row',
            path: 'items',
            sets: {
              stock: {
                kind: 'arith',
                left: { kind: 'col', column: 'stock' },
                op: '-',
                right: { kind: 'param', path: 'quantity' },
              },
            },
          },
        ],
        query: 'productGrid',
      },
    });
  });

  it('DELETE × (AGG + COUNT) removes the row then recounts from the shipped rows', () => {
    const rowset = { filters: [], key: 'id', orderBy: [], table: 'todos' };
    const shape: AlgebraicQueryShape = {
      fields: {
        items: { kind: 'agg', projection: ['id'], rowKey: 'id', rowset },
        total: { kind: 'count', rowset, witness: { columns: ['id'], rowsPath: 'items' } },
      },
      query: 'todoCount',
      rowsByTable: { todos: { columns: ['id'], rowsPath: 'items' } },
    };
    const effect: SymbolicEffect = {
      match: { eq: [{ column: 'id', value: { kind: 'param', path: 'id' } }], kind: 'keys' },
      op: 'delete',
      table: 'todos',
    };
    expect(deriveOptimistic([effect], shape)).toEqual({
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
        query: 'todoCount',
      },
    });
  });
});

describe('deriveOptimistic — §10.5 PUNT list (negative surfaces)', () => {
  const cartShape: AlgebraicQueryShape = {
    fields: {
      count: {
        arith: { kind: 'col', column: 'qty' },
        kind: 'sum',
        rowset: { filters: [], key: null, orderBy: [], table: 'cart_items' },
      },
    },
    query: 'cart',
  };

  it('punts Opaque SET on a scalar keyed-row column', () => {
    const shape: AlgebraicQueryShape = {
      fields: {
        stock: {
          column: 'stock',
          kind: 'scalar',
          rowset: { filters: [], key: 'id', orderBy: [], table: 'products' },
        },
      },
      query: 'product',
    };
    const effect: SymbolicEffect = {
      match: { eq: [{ column: 'id', value: { kind: 'param', path: 'id' } }], kind: 'keys' },
      op: 'update',
      sets: { stock: { kind: 'opaque', expr: 'compute_restock()' } },
      table: 'products',
    };
    expect(deriveOptimistic([effect], shape)).toEqual({
      kind: 'punt',
      reason: { code: 'opaque-set', expr: 'SET stock' },
    });
  });

  it('punts a non-key (Opaque) match predicate', () => {
    const shape: AlgebraicQueryShape = {
      fields: {
        items: {
          kind: 'agg',
          projection: ['id'],
          rowKey: 'id',
          rowset: { filters: [], key: 'id', orderBy: [], table: 'orders' },
        },
      },
      query: 'orders',
    };
    const effect: SymbolicEffect = {
      match: { expr: 'gt(total, 100)', kind: 'opaque' },
      op: 'delete',
      table: 'orders',
    };
    expect(deriveOptimistic([effect], shape)).toEqual({
      kind: 'punt',
      reason: { code: 'non-key-match', expr: 'gt(total, 100)' },
    });
  });

  it('punts an Opaque-shape (window/GROUP BY) field carrying its reason', () => {
    const shape: AlgebraicQueryShape = {
      fields: { rank: { kind: 'opaque', reason: { code: 'opaque-shape', shape: 'window' } } },
      query: 'leaderboard',
    };
    const effect: SymbolicEffect = {
      op: 'insert',
      table: 'scores',
      values: { id: { kind: 'param', path: 'id' } },
    };
    expect(deriveOptimistic([effect], shape)).toEqual({
      kind: 'punt',
      reason: { code: 'opaque-shape', shape: 'window' },
    });
  });

  it('punts DELETE × SUM with no client-row witness', () => {
    const effect: SymbolicEffect = {
      match: { eq: [{ column: 'id', value: { kind: 'param', path: 'id' } }], kind: 'keys' },
      op: 'delete',
      table: 'cart_items',
    };
    expect(deriveOptimistic([effect], cartShape)).toEqual({
      kind: 'punt',
      reason: { code: 'no-row-witness', field: 'count' },
    });
  });

  it('punts an Opaque INSERT contribution to a SUM', () => {
    const effect: SymbolicEffect = {
      op: 'insert',
      table: 'cart_items',
      values: { qty: { kind: 'opaque', expr: 'serverQty()' } },
    };
    expect(deriveOptimistic([effect], cartShape)).toEqual({
      kind: 'punt',
      reason: { code: 'untraceable-param', expr: 'SUM(cart_items)' },
    });
  });

  it('punts an Opaque orderBy insertion point', () => {
    const shape: AlgebraicQueryShape = {
      fields: {
        items: {
          kind: 'agg',
          projection: ['id'],
          rowKey: 'id',
          rowset: {
            filters: [],
            key: 'id',
            orderBy: [{ column: 'rank', direction: 'asc', opaque: true }],
            table: 'feed',
          },
        },
      },
      query: 'feed',
    };
    const effect: SymbolicEffect = {
      op: 'insert',
      table: 'feed',
      values: { id: { kind: 'param', path: 'id' } },
    };
    expect(deriveOptimistic([effect], shape)).toEqual({
      kind: 'punt',
      reason: { code: 'opaque-orderby', column: 'rank' },
    });
  });

  it('punts membership entry on a filtered-column SET to a non-const value', () => {
    const shape: AlgebraicQueryShape = {
      fields: {
        items: {
          kind: 'agg',
          projection: ['id', 'status'],
          rowKey: 'id',
          rowset: {
            filters: [{ column: 'status', op: 'eq', value: { kind: 'const', value: 'open' } }],
            key: 'id',
            orderBy: [],
            table: 'tickets',
          },
        },
      },
      query: 'openTickets',
    };
    const effect: SymbolicEffect = {
      match: { eq: [{ column: 'id', value: { kind: 'param', path: 'id' } }], kind: 'keys' },
      op: 'update',
      sets: { status: { kind: 'param', path: 'status' } },
      table: 'tickets',
    };
    expect(deriveOptimistic([effect], shape)).toEqual({
      kind: 'punt',
      reason: { code: 'membership-entry', field: 'status' },
    });
  });

  it('punts when no classified field covers a written table', () => {
    const effect: SymbolicEffect = {
      op: 'insert',
      table: 'audit_log',
      values: { id: { kind: 'param', path: 'id' } },
    };
    expect(deriveOptimistic([effect], cartShape)).toEqual({
      kind: 'punt',
      reason: { code: 'unsupported', detail: 'no classified field over a written table' },
    });
  });
});

describe('deriveOptimistic — membership exit + sorted insert (in-grammar)', () => {
  it('derives a membership exit (filtered col SET to a const that violates the filter)', () => {
    const shape: AlgebraicQueryShape = {
      fields: {
        items: {
          kind: 'agg',
          projection: ['id', 'status'],
          rowKey: 'id',
          rowset: {
            filters: [{ column: 'status', op: 'eq', value: { kind: 'const', value: 'open' } }],
            key: 'id',
            orderBy: [],
            table: 'tickets',
          },
        },
      },
      query: 'openTickets',
    };
    const effect: SymbolicEffect = {
      match: { eq: [{ column: 'id', value: { kind: 'param', path: 'id' } }], kind: 'keys' },
      op: 'update',
      sets: { status: { kind: 'const', value: 'closed' } },
      table: 'tickets',
    };
    expect(deriveOptimistic([effect], shape)).toEqual({
      kind: 'derived',
      program: {
        ops: [
          {
            guard: 'find-or-noop',
            match: [{ column: 'id', value: { kind: 'param', path: 'id' } }],
            op: 'remove-row',
            path: 'items',
          },
        ],
        query: 'openTickets',
      },
    });
  });

  it('derives a sorted INSERT for a non-opaque single-column orderBy', () => {
    const shape: AlgebraicQueryShape = {
      fields: {
        items: {
          columnTypes: { id: 'string', priority: 'number' },
          kind: 'agg',
          projection: ['id', 'priority'],
          rowKey: 'id',
          rowset: {
            filters: [],
            key: 'id',
            orderBy: [{ column: 'priority', direction: 'asc' }],
            table: 'queue',
          },
        },
      },
      query: 'queue',
    };
    const effect: SymbolicEffect = {
      op: 'insert',
      table: 'queue',
      values: { id: { kind: 'param', path: 'id' }, priority: { kind: 'param', path: 'priority' } },
    };
    expect(deriveOptimistic([effect], shape)).toEqual({
      kind: 'derived',
      program: {
        ops: [
          {
            op: 'push-row',
            path: 'items',
            placeholderColumns: [],
            position: { column: 'priority', direction: 'asc' },
            row: {
              id: { kind: 'param', path: 'id' },
              priority: { kind: 'param', path: 'priority' },
            },
          },
        ],
        query: 'queue',
      },
    });
  });
});
