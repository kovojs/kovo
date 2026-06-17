import { applyPatchProgram, type PatchProgram } from '@kovojs/core/internal/derivation';
import { describe, expect, it } from 'vitest';

import { createQueryStore } from './index.js';
import { OptimisticRebaser, type OptimisticTransform } from './optimism.js';

// SPEC.md §10.4/§10.5 Phase 4: derived transforms are plain OptimisticTransforms
// (the deriver/codegen target the SAME v1 IR), so they flow through the unchanged
// OptimisticRebaser — snapshot → apply → server-truth rebase → settle → discard —
// with proven parity to the hand-written path they replace. A derived transform
// here is the reference interpreter bound to a PatchProgram, exactly what the
// generated `(current, $input) => { … }` source executes.

function derivedTransform(program: PatchProgram, tempId: () => string): OptimisticTransform {
  return (current, input) =>
    applyPatchProgram(current as never, input as never, program, { now: () => 0, tempId });
}

describe('derived transforms ride the unchanged OptimisticRebaser', () => {
  it('is byte-for-byte equivalent to the hand-written path it replaces (INSERT × SUM)', () => {
    const program: PatchProgram = {
      ops: [{ by: { kind: 'param', path: 'quantity' }, op: 'inc', path: 'count' }],
      query: 'cart',
    };
    const derived = derivedTransform(program, () => '__tmp__');
    const handWritten: OptimisticTransform = (current, input) => ({
      count: (current as { count: number }).count + (input as { quantity: number }).quantity,
    });

    const run = (transform: OptimisticTransform) => {
      const store = createQueryStore();
      const rebaser = new OptimisticRebaser(store);
      store.set('cart', { count: 0 });
      const trace: unknown[] = [];
      rebaser.add('m1', { quantity: 1 }, { transforms: { cart: transform } });
      rebaser.add('m2', { quantity: 2 }, { transforms: { cart: transform } });
      trace.push(store.get('cart')); // apply: 0 + 1 + 2
      rebaser.applyServerTruth('cart', { count: 10 });
      trace.push(store.get('cart')); // rebase both over truth: 10 + 1 + 2
      rebaser.settle('m1');
      rebaser.applyServerTruth('cart', { count: 11 });
      trace.push(store.get('cart')); // m1 settled, m2 replayed: 11 + 2
      trace.push(rebaser.discardPendingOptimism()); // back to last server truth
      trace.push(store.get('cart'));
      return trace;
    };

    const derivedTrace = run(derived);
    expect(derivedTrace).toEqual(run(handWritten));
    expect(derivedTrace).toEqual([
      { count: 3 },
      { count: 13 },
      { count: 13 },
      ['cart'],
      { count: 11 },
    ]);
  });

  it('rebases a derived INSERT × AGG push and reconciles the placeholder against server truth', () => {
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
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    store.set('orderHistory', { items: [{ id: 'o1', productId: 'p0', qty: 1 }] });

    rebaser.add(
      'm1',
      { productId: 'p1', quantity: 2 },
      { transforms: { orderHistory: derivedTransform(program, () => 'tmp-1') } },
    );

    // Prediction: the new row is appended with a tempId placeholder, pending.
    expect(store.get('orderHistory')).toEqual({
      items: [
        { id: 'o1', productId: 'p0', qty: 1 },
        { id: 'tmp-1', productId: 'p1', qty: 2 },
      ],
    });

    // Server truth arrives with the real row; the still-pending prediction is
    // replayed on top (rebase) — the placeholder row rides above server truth.
    rebaser.applyServerTruth('orderHistory', {
      items: [
        { id: 'o1', productId: 'p0', qty: 1 },
        { id: 'order-2', productId: 'p1', qty: 2 },
      ],
    });
    expect(store.get('orderHistory')).toEqual({
      items: [
        { id: 'o1', productId: 'p0', qty: 1 },
        { id: 'order-2', productId: 'p1', qty: 2 },
        { id: 'tmp-1', productId: 'p1', qty: 2 },
      ],
    });

    // On settle the prediction is dropped and server truth (real id) is authoritative.
    rebaser.settle('m1');
    rebaser.applyServerTruth('orderHistory', {
      items: [
        { id: 'o1', productId: 'p0', qty: 1 },
        { id: 'order-2', productId: 'p1', qty: 2 },
      ],
    });
    expect(store.get('orderHistory')).toEqual({
      items: [
        { id: 'o1', productId: 'p0', qty: 1 },
        { id: 'order-2', productId: 'p1', qty: 2 },
      ],
    });
    expect(rebaser.pendingCount('orderHistory')).toBe(0);
  });
});
