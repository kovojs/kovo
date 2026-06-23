import type { PatchProgram } from '@kovojs/core/internal/derivation';
import { describe, expect, it } from 'vitest';

import { lowerTransform, serializeDerivedOptimistic } from './derive-codegen.js';

// SPEC.md §10.4 Phase 3 — the generated module is committed, reviewable, and
// overridable. These tests pin the DO-NOT-EDIT header, the `satisfies
// OptimisticFor` resolution, override precedence, and the lowered transform body.

const cartProgram: PatchProgram = {
  ops: [{ by: { kind: 'param', path: 'quantity' }, op: 'inc', path: 'count' }],
  query: 'cart',
};

const pushProgram: PatchProgram = {
  ops: [
    {
      op: 'push-row',
      path: 'items',
      placeholderColumns: ['id', 'total'],
      position: 'end',
      row: {
        id: { kind: 'placeholder', placeholder: 'tempId' },
        productId: { kind: 'param', path: 'productId' },
        total: { kind: 'const', value: 0 },
      },
    },
  ],
  query: 'orderHistory',
};

describe('serializeDerivedOptimistic', () => {
  it('emits a DO-NOT-EDIT header and a satisfies clause when complete', () => {
    const source = serializeDerivedOptimistic({
      complete: true,
      constName: 'cartAddDerivedOptimistic',
      entries: [{ program: cartProgram, query: 'cart' }],
      formImport: { name: 'addToCartForm', path: '../../app.js' },
      queue: 'cart',
    });

    expect(source).toContain('// DO NOT EDIT');
    expect(source).toContain("import type { addToCartForm } from '../../app.js';");
    expect(source).toContain("import type { OptimisticFor } from '@kovojs/browser';");
    expect(source).toContain('export const cartAddDerivedOptimistic = {');
    expect(source).toContain("queue: 'cart',");
    expect(source).toContain('transforms: {');
    expect(source).toContain('cart: (draft, $input) => {');
    // C5 (SPEC.md §10.5:1172) — inc coerces base + increment via the shared `n(...)`
    // helper (identical to the interpreter's `asNumber`) so string-serialized
    // numeric/decimal/bigint columns sum rather than string-concatenate.
    expect(source).toContain('const n = (v) => (typeof v === "number" ? v : Number(v ?? 0));');
    expect(source).toContain('draft.count = n(draft.count) + n($input.quantity);');
    expect(source).toContain('} satisfies OptimisticFor<typeof addToCartForm>;');
  });

  it('imports tempId only when a push uses a tempId placeholder', () => {
    const source = serializeDerivedOptimistic({
      complete: true,
      constName: 'plan',
      entries: [{ program: pushProgram, query: 'orderHistory' }],
      formImport: { name: 'addToCartForm', path: '../../app.js' },
    });
    expect(source).toContain("import { tempId, type OptimisticFor } from '@kovojs/browser';");
    expect(source).toContain(
      'draft.items.push({ id: tempId(), productId: $input.productId, total: 0 });',
    );
    expect(source).not.toContain('now()');
  });

  it('override precedence: a hand-written entry is suppressed (no satisfies, named note)', () => {
    const source = serializeDerivedOptimistic({
      complete: false,
      constName: 'cartAddDerivedOptimistic',
      entries: [{ program: { ops: [], query: 'orderHistory' }, query: 'orderHistory' }],
      formImport: { name: 'addToCartForm', path: '../../app.js' },
      overrides: ['cart', 'productGrid'],
    });

    // Suppressed pairs are not emitted; the const is a partial the app merges.
    expect(source).not.toContain('cart: (draft');
    expect(source).not.toContain('productGrid: (draft');
    // The empty (no-op) program reads no input, so the param lowers to `_$input`.
    expect(source).toContain('orderHistory: (draft, _$input) =>');
    expect(source).not.toContain('satisfies OptimisticFor');
    expect(source).toContain(
      'Overridden in the mutation module (derivation suppressed): cart, productGrid.',
    );
  });
});

describe('lowerTransform — codegen ≡ interpreter parity', () => {
  it('produces an executable transform equivalent to applyPatchProgram', async () => {
    const { applyPatchProgram } = await import('@kovojs/core/internal/derivation');
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
    const before = {
      items: [
        { id: 'p1', stock: 5 },
        { id: 'p2', stock: 9 },
      ],
    };
    const input = { productId: 'p1', quantity: 2 };

    // Executing the emitted transform source is exactly what proves codegen ≡ interpreter.
    // oxlint-disable-next-line no-implied-eval -- see above.
    const factory = new Function('tempId', 'now', `return ${lowerTransform(program)};`) as (
      t: () => string,
      n: () => number,
    ) => (draft: unknown, $input: unknown) => void;
    const transform = factory(
      () => '__tempId__',
      () => 0,
    );

    const generated = structuredClone(before);
    transform(generated, input);
    const interpreted = applyPatchProgram(before, input, program, {
      now: () => 0,
      tempId: () => '__tempId__',
    });

    expect(generated).toEqual(interpreted);
    expect(generated).toEqual({
      items: [
        { id: 'p1', stock: 3 },
        { id: 'p2', stock: 9 },
      ],
    });
  });

  // C5 (SPEC.md §10.5:1172 commuting diagram) — node-postgres serializes
  // numeric/decimal/bigint columns as STRINGS. The SHIPPED path is codegen; it must
  // coerce numerically EXACTLY as the interpreter (`asNumber`), or `0 + "19.99"`
  // string-concatenates into a corrupt total and codegen ≢ interpreter.
  async function runBoth(program: PatchProgram, before: unknown, input: unknown) {
    const { applyPatchProgram } = await import('@kovojs/core/internal/derivation');
    // oxlint-disable-next-line no-implied-eval -- executing emitted source proves codegen parity.
    const factory = new Function('tempId', 'now', `return ${lowerTransform(program)};`) as (
      t: () => string,
      n: () => number,
    ) => (draft: unknown, $input: unknown) => void;
    const transform = factory(
      () => '__tempId__',
      () => 0,
    );
    const generated = structuredClone(before);
    transform(generated, input);
    const interpreted = applyPatchProgram(before as never, input as never, program, {
      now: () => 0,
      tempId: () => '__tempId__',
    });
    return { generated, interpreted };
  }

  it('inc over a string-decimal SUM base agrees with the interpreter (no string concat)', async () => {
    const program: PatchProgram = {
      ops: [{ by: { kind: 'param', path: 'amount' }, op: 'inc', path: 'total' }],
      query: 'cart',
    };
    const { generated, interpreted } = await runBoth(program, { total: '100.50' }, { amount: '5' });

    expect(generated).toEqual(interpreted);
    expect(generated).toEqual({ total: 105.5 });
  });

  it('resum over string-decimal row columns agrees with the interpreter', async () => {
    const program: PatchProgram = {
      ops: [{ column: 'amount', from: 'lines', op: 'resum', path: 'total' }],
      query: 'cart',
    };
    const { generated, interpreted } = await runBoth(
      program,
      { lines: [{ amount: '19.99' }, { amount: '5' }], total: '0' },
      {},
    );

    expect(generated).toEqual(interpreted);
    expect(generated).toEqual({ lines: [{ amount: '19.99' }, { amount: '5' }], total: 24.99 });
  });

  it('sorted push-row over string-numeric orderBy agrees with the interpreter', async () => {
    const program: PatchProgram = {
      ops: [
        {
          op: 'push-row',
          path: 'items',
          placeholderColumns: [],
          position: { column: 'rank', direction: 'asc' },
          row: { id: { kind: 'param', path: 'id' }, rank: { kind: 'param', path: 'rank' } },
        },
      ],
      query: 'leaderboard',
    };
    // String-serialized ranks: lexical compare would place "10" before "9"; numeric
    // coercion (asNumber) must place the new "9" before "10".
    const { generated, interpreted } = await runBoth(
      program,
      {
        items: [
          { id: 'a', rank: '2' },
          { id: 'b', rank: '10' },
        ],
      },
      { id: 'c', rank: '9' },
    );

    expect(generated).toEqual(interpreted);
    expect(generated).toEqual({
      items: [
        { id: 'a', rank: '2' },
        { id: 'c', rank: '9' },
        { id: 'b', rank: '10' },
      ],
    });
  });
});
