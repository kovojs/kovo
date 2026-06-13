import { describe, expect, it, vi } from 'vitest';

import { applyQueryChunksToRuntime } from './query-apply.js';
import { createQueryScriptHydrationLedger, hydrateQueryScripts } from './query-script-hydration.js';
import { createQueryStore } from './query-store.js';
import { FakeMorphRoot, FakeQueryBindingElement } from './runtime-test-fakes.js';

interface QueryScript {
  getAttribute(name: string): string | null;
  textContent: string | null;
}

describe('query script hydration', () => {
  it('hydrates fw-query scripts and immediately runs subscribed update plans', () => {
    const store = createQueryStore();
    const plan = vi.fn();

    store.subscribe('cart', plan);
    const hydrated = hydrateQueryScripts(store, [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
        textContent: '{"count":2}',
      },
    ]);

    expect(hydrated).toEqual(['cart']);
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(plan).toHaveBeenCalledWith({ count: 2 });
  });

  it('hydrates keyed query instances with canonical typed-read keys', () => {
    const store = createQueryStore();
    const p1Plan = vi.fn();
    const p2Plan = vi.fn();

    store.subscribe('product', p1Plan, 'p1');
    store.subscribe('product', p2Plan, 'p2');
    const hydrated = hydrateQueryScripts(store, [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'product' : name === 'key' ? 'p1' : null),
        textContent: '{"stock":4}',
      },
      {
        getAttribute: (name) => (name === 'fw-query' ? 'product' : name === 'key' ? 'p2' : null),
        textContent: '{"stock":9}',
      },
    ]);

    // SPEC.md §9.4: query instance keys use one canonical currency across
    // hydration, the client store, and typed-read refetch.
    expect(hydrated).toEqual(['product:p1', 'product:p2']);
    expect(store.get('product', 'p1')).toEqual({ stock: 4 });
    expect(store.get('product', 'p2')).toEqual({ stock: 9 });
    expect(store.get('product')).toBeUndefined();
    expect(p1Plan).toHaveBeenCalledWith({ stock: 4 });
    expect(p2Plan).toHaveBeenCalledWith({ stock: 9 });
  });

  it('hydrates canonical script query keys into keyed store instances', () => {
    const store = createQueryStore();
    const p1Plan = vi.fn();
    const p2Plan = vi.fn();

    store.subscribe('product', p1Plan, 'p1');
    store.subscribe('product', p2Plan, 'p2');
    const hydrated = hydrateQueryScripts(store, [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'product:p1' : null),
        textContent: '{"stock":4}',
      },
      {
        getAttribute: (name) => (name === 'fw-query' ? 'product:p2' : null),
        textContent: '{"stock":9}',
      },
    ]);

    // SPEC.md §9.4/§10.2: server-authored hydration scripts may encode the
    // canonical instance key directly in `fw-query`, matching typed-read URLs.
    expect(hydrated).toEqual(['product:p1', 'product:p2']);
    expect(store.get('product', 'p1')).toEqual({ stock: 4 });
    expect(store.get('product', 'p2')).toEqual({ stock: 9 });
    expect(store.get('product')).toBeUndefined();
    expect(p1Plan).toHaveBeenCalledWith({ stock: 4 });
    expect(p2Plan).toHaveBeenCalledWith({ stock: 9 });
  });

  it('keeps hydrated script values in parity with mutation query chunks', () => {
    const hydratedStore = createQueryStore();
    const appliedStore = createQueryStore();
    const hydratedPlan = vi.fn();
    const appliedPlan = vi.fn();

    hydratedStore.subscribe('product', hydratedPlan, 'p1');
    appliedStore.subscribe('product', appliedPlan, 'p1');

    const hydrated = hydrateQueryScripts(hydratedStore, [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'product' : name === 'key' ? 'p1' : null),
        textContent: '{"stock":4}',
      },
    ]);
    const applied = applyQueryChunksToRuntime(appliedStore, [
      {
        key: 'p1',
        name: 'product',
        value: { stock: 4 },
      },
    ]);

    // SPEC.md §9.4: hydrated scripts and later mutation/deferred query chunks
    // must write the same keyed store slot and publish the same typed-read key.
    expect(hydrated).toEqual(['product:p1']);
    expect(applied).toEqual(['product:p1']);
    expect(hydratedStore.get('product', 'p1')).toEqual(appliedStore.get('product', 'p1'));
    expect(hydratedStore.get('product')).toBeUndefined();
    expect(appliedStore.get('product')).toBeUndefined();
    expect(hydratedPlan).toHaveBeenCalledWith({ stock: 4 });
    expect(appliedPlan).toHaveBeenCalledWith({ stock: 4 });
  });

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

  it('returns only successfully hydrated fw-query scripts', () => {
    const store = createQueryStore();
    const onError = vi.fn();

    const hydrated = hydrateQueryScripts(
      store,
      [
        {
          getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
          textContent: '{"count":1}',
        },
        {
          getAttribute: (name) => (name === 'fw-query' ? 'inventory' : null),
          textContent: '{',
        },
      ],
      { onError },
    );

    expect(hydrated).toEqual(['cart']);
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(store.get('inventory')).toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]?.[0].message)).toContain(
      'Malformed JSON in fw-query inventory',
    );
  });
});
