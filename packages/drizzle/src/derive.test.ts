import type { AlgebraicQueryShape, SymbolicEffect } from '@kovojs/core/internal/derivation';
import { describe, expect, it } from 'vitest';

import { deriveOptimistic } from './derive.js';

// SPEC.md §10.5 Stage 3 — the deriver's own unit surface. The cross-package
// "deriver produces the shared contract fixtures" check lives in @kovojs/test
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

// ── C4 / C5 / C6 correctness guards ──────────────────────────────────────────
// SPEC.md §10.5 "soundly optimistic": wrong predictions are worse than none.

describe('deriveOptimistic — C4: COUNT(pred) must not recount unfiltered witness', () => {
  // items AGG (no filter) + active COUNT(pred done=false) share the same
  // todos witness.  The witness ships ALL rows (done:true and done:false), so
  // recount(witness) would return the wrong total for the filtered COUNT.
  // Correct fix: use inc-by-1 for INSERT (when pred is satisfied) rather than
  // recount; for DELETE/UPDATE that flip the pred column, punt (no-row-witness).
  const rowset = { filters: [], key: 'id', orderBy: [], table: 'todos' };
  const shape: AlgebraicQueryShape = {
    fields: {
      // Unfiltered AGG — ships the rows witness for the todos table
      items: { kind: 'agg', projection: ['id', 'done'], rowKey: 'id', rowset },
      // COUNT with a predicate — must NOT blindly recount from the unfiltered witness
      active: {
        kind: 'count',
        pred: { column: 'done', op: 'eq', value: { kind: 'const', value: false } },
        rowset,
      },
    },
    query: 'todoList',
    rowsByTable: { todos: { columns: ['id', 'done'], rowsPath: 'items' } },
  };

  it('uses inc-by-1 for INSERT done:false — not recount from the unfiltered witness', () => {
    // Old code: rowsPath exists → recount(items) → counts ALL rows including any
    // done:true rows → wrong active count.
    // New code: pred present → rowsPath=undefined → inc by 1 (correct).
    const effect: SymbolicEffect = {
      op: 'insert',
      table: 'todos',
      values: {
        done: { kind: 'const', value: false },
        id: { kind: 'param', path: 'id' },
      },
    };
    expect(deriveOptimistic([effect], shape)).toEqual({
      kind: 'derived',
      program: {
        ops: [
          // items AGG: push the new row
          {
            op: 'push-row',
            path: 'items',
            placeholderColumns: [],
            position: 'end',
            row: {
              done: { kind: 'const', value: false },
              id: { kind: 'param', path: 'id' },
            },
          },
          // active COUNT: inc by 1 (not recount) — the new row satisfies the pred
          { by: { kind: 'const', value: 1 }, op: 'inc', path: 'active' },
        ],
        query: 'todoList',
      },
    });
  });

  it('punts (no-row-witness) on DELETE — cannot filter the witness by pred to recount', () => {
    // A DELETE changes the count only if the deleted row satisfied the pred.
    // Since the witness is unfiltered and has no pred info, punt.
    const effect: SymbolicEffect = {
      match: { eq: [{ column: 'id', value: { kind: 'param', path: 'id' } }], kind: 'keys' },
      op: 'delete',
      table: 'todos',
    };
    expect(deriveOptimistic([effect], shape)).toEqual({
      kind: 'punt',
      reason: { code: 'no-row-witness', field: 'active' },
    });
  });
});

describe('deriveOptimistic — C5: non-key eq match must punt, not single-row update', () => {
  // AGG over products with rowKey 'id'; UPDATE matches on non-key column 'category'.
  // A keys-kind match whose columns don't cover the declared rowKey must punt.
  const rowset = { filters: [], key: 'id', orderBy: [], table: 'products' };
  const shape: AlgebraicQueryShape = {
    fields: {
      items: {
        kind: 'agg',
        projection: ['id', 'category', 'price'],
        rowKey: 'id',
        rowset,
      },
    },
    query: 'productGrid',
    rowsByTable: { products: { columns: ['id', 'category', 'price'], rowsPath: 'items' } },
  };

  it('punts (non-key-match) when eq columns do not include the declared rowKey', () => {
    const effect: SymbolicEffect = {
      // Non-key eq: category is not the primary key
      match: {
        eq: [{ column: 'category', value: { kind: 'const', value: 'books' } }],
        kind: 'keys',
      },
      op: 'update',
      sets: { price: { kind: 'param', path: 'price' } },
      table: 'products',
    };
    expect(deriveOptimistic([effect], shape)).toEqual({
      kind: 'punt',
      reason: { code: 'non-key-match', expr: 'non-key eq on products' },
    });
  });
});

describe('deriveOptimistic — C6: SUM resum must not proceed when witness omits the summed column', () => {
  // items AGG projects only ['id'] — does NOT ship qty.
  // total SUM over qty must punt on DELETE, not zero out via resum.
  const rowset = { filters: [], key: 'id', orderBy: [], table: 'items' };
  const shape: AlgebraicQueryShape = {
    fields: {
      // AGG ships only id — witness columns do NOT include qty
      items: { kind: 'agg', projection: ['id'], rowKey: 'id', rowset },
      total: {
        arith: { kind: 'col', column: 'qty' },
        kind: 'sum',
        rowset,
      },
    },
    query: 'itemTotals',
    rowsByTable: { items: { columns: ['id'], rowsPath: 'items' } },
  };

  it('punts (no-row-witness) on DELETE when the witness does not ship the summed column', () => {
    const effect: SymbolicEffect = {
      match: { eq: [{ column: 'id', value: { kind: 'param', path: 'id' } }], kind: 'keys' },
      op: 'delete',
      table: 'items',
    };
    expect(deriveOptimistic([effect], shape)).toEqual({
      kind: 'punt',
      reason: { code: 'no-row-witness', field: 'total' },
    });
  });
});

// ── Part-4 Lane C correctness guards (filtered aggregate soundness) ───────────
// SPEC.md §10.5 "soundly optimistic": a filtered aggregate ranges over only its
// rowset members; adding/counting a provable non-member is worse than no prediction.

describe('deriveOptimistic — C1: filtered SUM ignores rowset filters', () => {
  const shape: AlgebraicQueryShape = {
    fields: {
      total: {
        arith: { kind: 'col', column: 'amount' },
        kind: 'sum',
        rowset: {
          filters: [{ column: 'status', op: 'eq', value: { kind: 'const', value: 'active' } }],
          key: null,
          orderBy: [],
          table: 'invoices',
        },
      },
    },
    query: 'activeTotal',
  };

  it('no-ops an INSERT that provably violates the SUM filter (does not inc by the amount)', () => {
    // SUM(amount) WHERE status='active'; INSERT {amount:50, status:'pending'} must NOT
    // contribute 50 to the active total (old code emitted `inc by amount`).
    const effect: SymbolicEffect = {
      op: 'insert',
      table: 'invoices',
      values: {
        amount: { kind: 'const', value: 50 },
        status: { kind: 'const', value: 'pending' },
      },
    };
    // The field is connected (the write touches the SUM's table) but the provable
    // non-member contributes nothing → a no-op transform, never an `inc by 50`.
    expect(deriveOptimistic([effect], shape)).toEqual({
      kind: 'derived',
      program: { ops: [], query: 'activeTotal' },
    });
  });

  it('still increments a filtered SUM when the INSERT provably satisfies the filter', () => {
    const effect: SymbolicEffect = {
      op: 'insert',
      table: 'invoices',
      values: {
        amount: { kind: 'param', path: 'amount' },
        status: { kind: 'const', value: 'active' },
      },
    };
    expect(deriveOptimistic([effect], shape)).toEqual({
      kind: 'derived',
      program: {
        ops: [{ by: { kind: 'param', path: 'amount' }, op: 'inc', path: 'total' }],
        query: 'activeTotal',
      },
    });
  });
});

describe('deriveOptimistic — C2: filtered AGG pushes a non-member INSERT', () => {
  const shape: AlgebraicQueryShape = {
    fields: {
      items: {
        kind: 'agg',
        projection: ['id', 'status'],
        rowKey: 'id',
        rowset: {
          filters: [{ column: 'status', op: 'eq', value: { kind: 'const', value: 'active' } }],
          key: 'id',
          orderBy: [],
          table: 'subscriptions',
        },
      },
    },
    query: 'activeList',
  };

  it('does not push an INSERT that provably violates the list filter', () => {
    // list WHERE status='active'; INSERT {status:'pending'} must NOT be pushed (old code
    // pushed unconditionally → row appears then vanishes on reconcile).
    const effect: SymbolicEffect = {
      op: 'insert',
      table: 'subscriptions',
      values: {
        id: { kind: 'param', path: 'id' },
        status: { kind: 'const', value: 'pending' },
      },
    };
    // Connected (the write touches the list's table) but the provable non-member is not
    // pushed → a no-op transform, never a row that appears and vanishes on reconcile.
    expect(deriveOptimistic([effect], shape)).toEqual({
      kind: 'derived',
      program: { ops: [], query: 'activeList' },
    });
  });

  it('still pushes an INSERT that provably satisfies the list filter', () => {
    const effect: SymbolicEffect = {
      op: 'insert',
      table: 'subscriptions',
      values: {
        id: { kind: 'param', path: 'id' },
        status: { kind: 'const', value: 'active' },
      },
    };
    expect(deriveOptimistic([effect], shape)).toEqual({
      kind: 'derived',
      program: {
        ops: [
          {
            op: 'push-row',
            path: 'items',
            placeholderColumns: [],
            position: 'end',
            row: {
              id: { kind: 'param', path: 'id' },
              status: { kind: 'const', value: 'active' },
            },
          },
        ],
        query: 'activeList',
      },
    });
  });
});

describe('deriveOptimistic — C3: COUNT with multi-eq / non-eq filters', () => {
  it('no-ops a multi-eq COUNT when the INSERT violates a non-first eq filter', () => {
    // count() WHERE and(eq(a,X),eq(b,Y)); INSERT {a:X,b:Z}. Old code kept only a=X as the
    // pred → over-counted. The full chain proves the row is a non-member → no-op.
    const shape: AlgebraicQueryShape = {
      fields: {
        n: {
          kind: 'count',
          pred: { column: 'a', op: 'eq', value: { kind: 'const', value: 'X' } },
          rowset: {
            filters: [
              { column: 'a', op: 'eq', value: { kind: 'const', value: 'X' } },
              { column: 'b', op: 'eq', value: { kind: 'const', value: 'Y' } },
            ],
            key: null,
            orderBy: [],
            table: 'rows',
          },
        },
      },
      query: 'counted',
    };
    const effect: SymbolicEffect = {
      op: 'insert',
      table: 'rows',
      values: {
        a: { kind: 'const', value: 'X' },
        b: { kind: 'const', value: 'Z' },
      },
    };
    // The row violates eq(b,Y) → a provable non-member → no inc (a no-op transform),
    // never the over-count the first-eq-only pred produced.
    expect(deriveOptimistic([effect], shape)).toEqual({
      kind: 'derived',
      program: { ops: [], query: 'counted' },
    });
  });

  it('does not recount a non-eq filtered COUNT over the unfiltered witness', () => {
    // count() WHERE gt(price,100); pred is undefined (no eq) but the rowset has a non-eq
    // filter. Old code set rowsPath=fullRowsPath → recount over ALL rows. Now it punts.
    const rowset = {
      filters: [{ column: 'price', op: 'non-eq' as const }],
      key: 'id',
      orderBy: [],
      table: 'products',
    };
    const shape: AlgebraicQueryShape = {
      fields: {
        items: { kind: 'agg', projection: ['id', 'price'], rowKey: 'id', rowset },
        expensive: { kind: 'count', rowset },
      },
      query: 'pricey',
      rowsByTable: { products: { columns: ['id', 'price'], rowsPath: 'items' } },
    };
    const effect: SymbolicEffect = {
      op: 'insert',
      table: 'products',
      values: { id: { kind: 'param', path: 'id' }, price: { kind: 'param', path: 'price' } },
    };
    // The non-eq filter is undecidable on insert, so the row is assumed a member and the
    // COUNT increments by 1 (SPEC §10.5:1164) — but it must NOT recount the unfiltered
    // witness (the C3-2 / C4 bug), and the AGG sibling pushes the row.
    expect(deriveOptimistic([effect], shape)).toEqual({
      kind: 'derived',
      program: {
        ops: [
          {
            op: 'push-row',
            path: 'items',
            placeholderColumns: [],
            position: 'end',
            row: { id: { kind: 'param', path: 'id' }, price: { kind: 'param', path: 'price' } },
          },
          { by: { kind: 'const', value: 1 }, op: 'inc', path: 'expensive' },
        ],
        query: 'pricey',
      },
    });
  });
});

describe('deriveOptimistic — C4: count(t.col) must not be COUNT(*)', () => {
  // C4 is realized in the extractor (static.ts aggregateField): count(t.col) classifies
  // as opaque, so the deriver punts the pair rather than counting NULL-column rows.
  it('punts the whole pair when the COUNT field is classified opaque', () => {
    const shape: AlgebraicQueryShape = {
      fields: {
        assigned: {
          kind: 'opaque',
          reason: { code: 'opaque-projection', expr: 'count(tasks.assignee)' },
        },
      },
      query: 'assignedCount',
    };
    const effect: SymbolicEffect = {
      op: 'insert',
      table: 'tasks',
      values: { assignee: { kind: 'const', value: null } },
    };
    expect(deriveOptimistic([effect], shape)).toEqual({
      kind: 'punt',
      reason: { code: 'opaque-projection', expr: 'count(tasks.assignee)' },
    });
  });
});
