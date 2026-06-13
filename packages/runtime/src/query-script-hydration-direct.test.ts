import { describe, expect, it, vi } from 'vitest';

import { applyQueryChunksToRuntime } from './query-apply.js';
import { hydrateQueryScripts } from './query-script-hydration.js';
import { createQueryStore } from './query-store.js';

// SPEC.md §9.1/§9.4: direct `hydrateQueryScripts` decodes server-authored
// fw-query scripts (including canonical instance keys) into the one runtime
// query apply path, in parity with later mutation/typed-read chunks. The
// stateful ledger retry/visible-return seam lives in the sibling
// query-script-hydration-ledger.test.ts file.
describe('query script hydration direct', () => {
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

  it('reports direct hydration apply failures while applying later scripts', () => {
    const store = createQueryStore();
    const onError = vi.fn();
    const productPlan = vi.fn();
    const applyError = new Error('direct query hydration apply failed');

    store.subscribe('product', productPlan, 'p1');

    const hydrated = hydrateQueryScripts(
      store,
      [
        {
          getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
          textContent: '{"count":1}',
        },
        {
          getAttribute: (name) => (name === 'fw-query' ? 'product:p1' : null),
          textContent: '{"stock":9}',
        },
      ],
      {
        applyQuery(query) {
          if (query.name === 'cart') throw applyError;
        },
        onError,
      },
    );

    // SPEC.md §9.1/§9.4: direct script hydration, visible-return hydration,
    // mutation responses, and typed reads use one decoded query apply path; a
    // failed query must not fork batch continuation behavior.
    expect(hydrated).toEqual(['product:p1']);
    expect(store.get('cart')).toBeUndefined();
    expect(store.get('product', 'p1')).toEqual({ stock: 9 });
    expect(productPlan).toHaveBeenCalledWith({ stock: 9 });
    expect(onError).toHaveBeenCalledWith(applyError);
  });
});
