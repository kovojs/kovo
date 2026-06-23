import { describe, expect, it } from 'vitest';

import {
  applyPatchProgram,
  derived,
  punt,
  puntReasonLabel,
  type PatchProgram,
  type PuntReason,
} from './derivation.js';

// SPEC.md §10.5: the interpreter is the executable meaning of a PatchProgram —
// the commuting-diagram suite runs it as patch(clientShape(s), i), and codegen
// lowers the same ops to the committed transform. These unit tests pin the op
// semantics, purity, and the punt-label surface independent of any populator.

describe('derivation patch interpreter', () => {
  it('increments a scalar field (INSERT/DELETE × SUM/COUNT) without mutating input', () => {
    const program: PatchProgram = {
      ops: [{ by: { kind: 'param', path: 'quantity' }, op: 'inc', path: 'count' }],
      query: 'cart',
    };
    const value = { count: 3 };
    const next = applyPatchProgram(value, { quantity: 2 }, program);

    expect(next).toEqual({ count: 5 });
    expect(value).toEqual({ count: 3 });
  });

  it('runs against proxy-backed optimistic drafts', () => {
    const program: PatchProgram = {
      ops: [{ by: { kind: 'param', path: 'quantity' }, op: 'inc', path: 'count' }],
      query: 'cart',
    };
    const value = new Proxy({ count: 3 }, {}) as never;

    expect(applyPatchProgram(value, { quantity: 2 }, program)).toEqual({ count: 5 });
  });

  // C6 (SPEC.md §10.5:1172) — node-postgres serializes numeric/decimal/bigint columns
  // as STRINGS, so the held SUM base is a string like '100.50'. `inc` must coerce the
  // existing total numerically (asNumber), not reset a non-`number` base to 0; otherwise
  // the cart subtotal silently collapses to just the added amount and the interpreter
  // disagrees with codegen (which keeps the base).
  it('inc coerces a string/decimal SUM base instead of discarding it', () => {
    const program: PatchProgram = {
      ops: [{ by: { kind: 'const', value: 5 }, op: 'inc', path: 'total' }],
      query: 'cart',
    };

    expect(applyPatchProgram({ total: '100.50' }, {}, program)).toEqual({ total: 105.5 });
  });

  it('decrements via negative arith (DELETE × SUM)', () => {
    const program: PatchProgram = {
      ops: [
        {
          by: {
            kind: 'arith',
            left: { kind: 'const', value: 0 },
            op: '-',
            right: { kind: 'param', path: 'qty' },
          },
          op: 'inc',
          path: 'total',
        },
      ],
      query: 'totals',
    };

    expect(applyPatchProgram({ total: 10 }, { qty: 4 }, program)).toEqual({ total: 6 });
  });

  it('pushes a row with placeholders for Opaque INSERT columns (INSERT × AGG)', () => {
    const program: PatchProgram = {
      ops: [
        {
          op: 'push-row',
          path: 'items',
          placeholderColumns: ['id'],
          position: 'end',
          row: {
            id: { kind: 'placeholder', placeholder: 'tempId' },
            productId: { kind: 'param', path: 'productId' },
            qty: { kind: 'param', path: 'quantity' },
          },
        },
      ],
      query: 'orderHistory',
    };
    const next = applyPatchProgram(
      { items: [{ id: 'o1', productId: 'p0', qty: 1 }] },
      { productId: 'p1', quantity: 2 },
      program,
      {
        tempId: () => 'tmp-1',
      },
    );

    expect(next).toEqual({
      items: [
        { id: 'o1', productId: 'p0', qty: 1 },
        { id: 'tmp-1', productId: 'p1', qty: 2 },
      ],
    });
  });

  it('updates a keyed row guarded by find-or-no-op (Scalar on keyed row)', () => {
    const program: PatchProgram = {
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
    };
    const value = {
      items: [
        { id: 'p1', stock: 5 },
        { id: 'p2', stock: 9 },
      ],
    };
    const next = applyPatchProgram(value, { productId: 'p1', quantity: 2 }, program);

    expect(next).toEqual({
      items: [
        { id: 'p1', stock: 3 },
        { id: 'p2', stock: 9 },
      ],
    });
  });

  it('is a no-op when the guarded row is outside the client rowset', () => {
    const program: PatchProgram = {
      ops: [
        {
          guard: 'find-or-noop',
          match: [{ column: 'id', value: { kind: 'param', path: 'productId' } }],
          op: 'update-row',
          path: 'items',
          sets: { stock: { kind: 'const', value: 0 } },
        },
      ],
      query: 'productGrid',
    };
    const value = { items: [{ id: 'p2', stock: 9 }] };

    expect(applyPatchProgram(value, { productId: 'p1' }, program)).toEqual(value);
  });

  it('removes a matching row (DELETE × AGG)', () => {
    const program: PatchProgram = {
      ops: [
        {
          guard: 'find-or-noop',
          match: [{ column: 'id', value: { kind: 'param', path: 'id' } }],
          op: 'remove-row',
          path: 'items',
        },
      ],
      query: 'orderHistory',
    };

    expect(applyPatchProgram({ items: [{ id: 'a' }, { id: 'b' }] }, { id: 'a' }, program)).toEqual({
      items: [{ id: 'b' }],
    });
  });
});

describe('derivation result constructors + punt labels', () => {
  it('builds derived/punt results', () => {
    const program: PatchProgram = { ops: [], query: 'cart' };
    expect(derived(program)).toEqual({ kind: 'derived', program });
    expect(punt({ code: 'opaque-set', expr: 'compute_discount' })).toEqual({
      kind: 'punt',
      reason: { code: 'opaque-set', expr: 'compute_discount' },
    });
  });

  it('renders every §10.5 PUNT reason with a stable label', () => {
    const cases: [PuntReason, string][] = [
      [{ code: 'opaque-set', expr: 'compute_discount' }, 'Opaque: compute_discount'],
      [{ code: 'non-key-match', expr: 'gt(price, 10)' }, 'non-key match: gt(price, 10)'],
      [{ code: 'opaque-shape', shape: 'window' }, 'window shape'],
      [{ code: 'opaque-shape', detail: 'rank()', shape: 'distinct' }, 'distinct shape: rank()'],
      [{ code: 'interprocedural', site: 'cart.ts:8' }, 'interprocedural KV406: cart.ts:8'],
      [{ code: 'untraceable-param', expr: 'serverNow()' }, 'untraceable param: serverNow()'],
      [{ code: 'mixed-disjunction', expr: 'or(...)' }, 'mixed disjunction: or(...)'],
      [{ code: 'opaque-orderby', column: 'rank' }, 'Opaque orderBy: rank'],
      [{ code: 'opaque-projection', expr: 'sql`...`' }, 'Opaque projection: sql`...`'],
      [{ code: 'no-row-witness', field: 'total' }, 'no client rows: total'],
      [{ code: 'membership-entry', field: 'items' }, 'membership entry: items'],
      [
        { code: 'partial-key', columns: ['tenantId'], table: 'tickets' },
        'partial key on tickets: tenantId',
      ],
      [{ code: 'unsupported', detail: 'INSERT × scalar' }, 'unsupported: INSERT × scalar'],
    ];

    for (const [reason, label] of cases) {
      expect(puntReasonLabel(reason)).toBe(label);
    }
  });
});
