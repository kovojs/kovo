import type { PatchProgram } from '@jiso/core';
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
    expect(source).toContain("import type { OptimisticFor } from '@jiso/runtime';");
    expect(source).toContain('export const cartAddDerivedOptimistic = {');
    expect(source).toContain("queue: 'cart',");
    expect(source).toContain('transforms: {');
    expect(source).toContain('cart: (current, $input) => {');
    expect(source).toContain('next.count = (next.count ?? 0) + $input.quantity;');
    expect(source).toContain('} satisfies OptimisticFor<typeof addToCartForm>;');
  });

  it('imports tempId only when a push uses a tempId placeholder', () => {
    const source = serializeDerivedOptimistic({
      complete: true,
      constName: 'plan',
      entries: [{ program: pushProgram, query: 'orderHistory' }],
      formImport: { name: 'addToCartForm', path: '../../app.js' },
    });
    expect(source).toContain("import { tempId, type OptimisticFor } from '@jiso/runtime';");
    expect(source).toContain(
      'next.items.push({ id: tempId(), productId: $input.productId, total: 0 });',
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
    expect(source).not.toContain('cart: (current');
    expect(source).not.toContain('productGrid: (current');
    // The empty (no-op) program reads no input, so the param lowers to `_$input`.
    expect(source).toContain('orderHistory: (current, _$input) =>');
    expect(source).not.toContain('satisfies OptimisticFor');
    expect(source).toContain(
      'Overridden in the mutation module (derivation suppressed): cart, productGrid.',
    );
  });
});

describe('lowerTransform — codegen ≡ interpreter parity', () => {
  it('produces an executable transform equivalent to applyPatchProgram', async () => {
    const { applyPatchProgram } = await import('@jiso/core');
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
    // eslint-disable-next-line no-implied-eval, @typescript-eslint/no-implied-eval -- see above
    const factory = new Function('tempId', 'now', `return ${lowerTransform(program)};`) as (
      t: () => string,
      n: () => number,
    ) => (current: unknown, $input: unknown) => unknown;
    const transform = factory(
      () => '__tempId__',
      () => 0,
    );

    const generated = transform(structuredClone(before), input);
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
});
