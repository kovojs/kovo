import { describe, expect, it, vi } from 'vitest';

import * as queryApplyModule from './query-apply.js';
import { applyQueryChunksToRuntime } from './query-apply.js';
import { createQueryStore } from './query-store.js';
import { FakeMorphRoot, FakeQueryBindingElement } from './runtime-test-fakes.js';

describe('decoded query runtime apply', () => {
  it('applies decoded query chunks as one runtime batch', () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const cartLabel = new FakeQueryBindingElement({
      'aria-label': 'old cart',
      'data-bind:aria-label': 'cart.label',
    });
    const productLabel = new FakeQueryBindingElement({
      'aria-label': 'old product',
      'data-bind:aria-label': 'product.label',
    });
    root.bindings.push(cartLabel, productLabel);

    const applied = applyQueryChunksToRuntime(
      store,
      [
        { name: 'cart', value: { label: 'Cart ready' } },
        { name: 'product', value: { label: 'Product ready' } },
      ],
      {
        queryPlans: {
          cart: { bindings: true },
          product: { bindings: true },
        },
        root,
      },
    );

    // SPEC.md §9.1/§9.4: mutation responses, typed reads, and decoded
    // hydration chunks converge on the same batched query apply path.
    expect(applied).toEqual(['cart', 'product']);
    expect(root.wildcardSelectorCalls).toBe(1);
    expect(cartLabel.getAttribute('aria-label')).toBe('Cart ready');
    expect(productLabel.getAttribute('aria-label')).toBe('Product ready');
  });

  it('applies query chunks through one canonical runtime batch with interposed values', () => {
    const store = createQueryStore();
    const cartPlan = vi.fn();
    const productPlan = vi.fn();
    const afterApplyQuery = vi.fn();

    store.subscribe('cart', cartPlan);
    store.subscribe('product', productPlan, 'p1');

    const applied = applyQueryChunksToRuntime(
      store,
      [
        { name: 'cart', value: { count: 1 } },
        { key: 'p1', name: 'product', value: { stock: 4 } },
      ],
      {
        afterApplyQuery,
        applyQuery(query) {
          if (query.name !== 'cart') return;

          store.set(query.name, { count: 2 }, query.key);
          return { value: store.get(query.name, query.key) };
        },
      },
    );

    // SPEC.md §9.1/§9.4: mutation, deferred, hydration, and typed-read paths
    // share canonical query instance keys while allowing runtime apply hooks.
    expect(applied).toEqual(['cart', 'product:p1']);
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(store.get('product', 'p1')).toEqual({ stock: 4 });
    expect(cartPlan).toHaveBeenCalledWith({ count: 2 });
    expect(productPlan).toHaveBeenCalledWith({ stock: 4 });
    expect(afterApplyQuery).toHaveBeenCalledWith(
      { name: 'cart', value: { count: 1 } },
      {
        count: 2,
      },
    );
    expect(afterApplyQuery).toHaveBeenCalledWith(
      { key: 'p1', name: 'product', value: { stock: 4 } },
      { stock: 4 },
    );
  });

  it('keeps script hydration helpers out of the decoded query apply surface', () => {
    // SPEC.md §4.4/§9.4: query scripts hydrate into decoded chunks, but the
    // decoded query apply primitive should not retain compatibility parser APIs.
    expect(Object.hasOwn(queryApplyModule, 'createQueryScriptHydrationLedger')).toBe(false);
    expect(Object.hasOwn(queryApplyModule, 'hydrateQueryScripts')).toBe(false);
    expect(Object.hasOwn(queryApplyModule, 'readQueryScriptChunk')).toBe(false);
  });
});
