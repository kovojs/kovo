import { describe, expect, it, vi } from 'vitest';

import { createQueryScriptHydrationLedger } from './query-script-hydration.js';
import { createQueryStore } from './query-store.js';
import { FakeMorphRoot, FakeQueryBindingElement } from './runtime-test-fakes.js';

interface QueryScript {
  getAttribute(name: string): string | null;
  textContent: string | null;
}

// SPEC.md §4.4/§9.1/§9.4: the stateful hydration ledger hydrates each observed
// server script once, retries malformed/transiently-rejected scripts on later
// passes, and routes newly discovered visible-return scripts through the one
// batched runtime query apply path. The stateless direct hydration seam lives
// in the sibling query-script-hydration-direct.test.ts file.
describe('query script hydration ledger', () => {
  it('hydrates each server query script once while accepting later script nodes', () => {
    const store = createQueryStore();
    const ledger = createQueryScriptHydrationLedger(store);
    const cartPlan = vi.fn();
    const originalScript: QueryScript = {
      getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
      textContent: '{"count":1}',
    };
    const laterScript = {
      getAttribute: (name: string) => (name === 'fw-query' ? 'cart' : null),
      textContent: '{"count":2}',
    };

    store.subscribe('cart', cartPlan);

    expect(ledger.hydrate([originalScript])).toEqual(['cart']);
    originalScript.textContent = '{"count":99}';
    expect(ledger.hydrate([originalScript])).toEqual([]);
    expect(ledger.hydrate([laterScript])).toEqual(['cart']);

    // SPEC.md §9.1/§9.4: later browser hydration discoveries share the query
    // apply path, but already observed server script nodes are not replayed.
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(cartPlan).toHaveBeenNthCalledWith(1, { count: 1 });
    expect(cartPlan).toHaveBeenNthCalledWith(2, { count: 2 });
    expect(cartPlan).toHaveBeenCalledTimes(2);
  });

  it('retries malformed query scripts until a hydration pass successfully applies them', () => {
    const store = createQueryStore();
    const ledger = createQueryScriptHydrationLedger(store);
    const onError = vi.fn();
    const cartPlan = vi.fn();
    const script: QueryScript = {
      getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
      textContent: '{',
    };

    store.subscribe('cart', cartPlan);

    expect(ledger.hydrate([script], { onError })).toEqual([]);
    expect(store.get('cart')).toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);

    script.textContent = '{"count":2}';
    expect(ledger.hydrate([script], { onError })).toEqual(['cart']);
    script.textContent = '{"count":99}';
    expect(ledger.hydrate([script], { onError })).toEqual([]);

    // SPEC.md §9.4: hydrated script data shares the same runtime query apply
    // path; failed transient JSON must not permanently remove a query from
    // later visible-return hydration.
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(cartPlan).toHaveBeenCalledTimes(1);
    expect(cartPlan).toHaveBeenCalledWith({ count: 2 });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('retries parsed query scripts when the shared runtime apply path rejects them', () => {
    const store = createQueryStore();
    const onError = vi.fn();
    const cartPlan = vi.fn();
    const applyError = new Error('transient query apply failure');
    const script: QueryScript = {
      getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
      textContent: '{"count":2}',
    };
    let attempts = 0;
    const ledger = createQueryScriptHydrationLedger(store, {
      applyQuery() {
        attempts += 1;
        if (attempts === 1) throw applyError;
      },
      onError,
    });

    store.subscribe('cart', cartPlan);

    expect(ledger.hydrate([script])).toEqual([]);
    expect(store.get('cart')).toBeUndefined();
    expect(onError).toHaveBeenCalledWith(applyError);

    expect(ledger.hydrate([script])).toEqual(['cart']);
    script.textContent = '{"count":99}';
    expect(ledger.hydrate([script])).toEqual([]);

    // SPEC.md §4.4/§9.4: hydration ledgers follow the same decoded apply path
    // as mutation and typed-read chunks; a transient apply failure must not make
    // server-authored query data permanently invisible to later passes.
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(cartPlan).toHaveBeenCalledOnce();
    expect(cartPlan).toHaveBeenCalledWith({ count: 2 });
    expect(attempts).toBe(2);
  });

  it('hydrates newly discovered query scripts as one decoded runtime batch', () => {
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
    const malformedScript: QueryScript = {
      getAttribute: (name) => (name === 'fw-query' ? 'inventory' : null),
      textContent: '{',
    };
    const cartScript: QueryScript = {
      getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
      textContent: '{"label":"Cart ready"}',
    };
    const productScript: QueryScript = {
      getAttribute: (name) => (name === 'fw-query' ? 'product' : null),
      textContent: '{"label":"Product ready"}',
    };
    const onError = vi.fn();
    root.bindings.push(cartLabel, productLabel);

    const ledger = createQueryScriptHydrationLedger(store, {
      queryPlans: {
        cart: { bindings: true },
        product: { bindings: true },
      },
      root,
    });

    expect(ledger.hydrate([malformedScript, cartScript, productScript], { onError })).toEqual([
      'cart',
      'product',
    ]);

    // SPEC.md §9.1/§9.4: visible-return script hydration enters the same
    // batched query apply path as mutation responses and typed-read chunks.
    expect(root.wildcardSelectorCalls).toBe(1);
    expect(cartLabel.getAttribute('aria-label')).toBe('Cart ready');
    expect(productLabel.getAttribute('aria-label')).toBe('Product ready');
    expect(store.get('inventory')).toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);

    malformedScript.textContent = '{"label":"Inventory ready"}';
    expect(ledger.hydrate([malformedScript, cartScript, productScript], { onError })).toEqual([
      'inventory',
    ]);
    expect(store.get('inventory')).toEqual({ label: 'Inventory ready' });
  });
});
