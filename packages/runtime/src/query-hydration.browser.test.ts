import { afterEach, describe, expect, it, vi } from 'vitest';

import { createQueryStore, installKovoLoader } from './index.js';

afterEach(() => {
  document.body.replaceChildren();
});

describe('query hydration browser runtime', () => {
  it('hydrates newly inserted query scripts through store subscribers and DOM bindings', async () => {
    document.body.innerHTML = [
      '<script kovo-query="cart" type="application/json">{"count":1}</script>',
      '<output data-bind="recommendations.items"></output>',
    ].join('');
    const store = createQueryStore();
    const cartPlan = vi.fn();
    const recommendationsPlan = vi.fn();
    const refetchOnFocus = vi.fn();
    const output = document.querySelector('output');
    if (!output) throw new Error('missing recommendations binding output');

    store.subscribe('cart', cartPlan);
    store.subscribe('recommendations', recommendationsPlan, 'homepage');

    const loader = installKovoLoader({
      importModule: vi.fn(),
      queryPlans: { recommendations: { bindings: true } },
      queryStore: store,
      refetchOnFocus,
      root: document,
    });

    const originalScript = document.querySelector('script[kovo-query="cart"]');
    if (!originalScript) throw new Error('missing original query script');

    expect(store.get('cart')).toEqual({ count: 1 });

    originalScript.textContent = '{"count":99}';
    const laterScript = document.createElement('script');
    laterScript.type = 'application/json';
    laterScript.setAttribute('kovo-query', 'recommendations:homepage');
    laterScript.textContent = '{"items":["p1"]}';
    document.body.append(laterScript);

    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => {
      expect(refetchOnFocus).toHaveBeenCalledWith(['cart', 'recommendations:homepage']);
    });

    // SPEC.md §9.1/§9.4: browser-visible hydration discoveries use the shared
    // query apply path without replaying already observed server script nodes,
    // including canonical instance keys from SPEC.md §10.2.
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(store.get('recommendations', 'homepage')).toEqual({ items: ['p1'] });
    expect(output.textContent).toBe('["p1"]');
    expect(cartPlan).toHaveBeenCalledTimes(1);
    expect(recommendationsPlan).toHaveBeenCalledWith({ items: ['p1'] });

    loader.dispose();
  });

  it('recovers malformed hydrated query scripts on a later visible return', async () => {
    document.body.innerHTML = '<script kovo-query="cart" type="application/json">{</script>';
    const store = createQueryStore();
    const cartPlan = vi.fn();
    const onError = vi.fn();
    const refetchOnFocus = vi.fn();
    const script = document.querySelector('script[kovo-query="cart"]');
    if (!script) throw new Error('missing cart query script');

    store.subscribe('cart', cartPlan);

    const loader = installKovoLoader({
      importModule: vi.fn(),
      onError,
      queryStore: store,
      refetchOnFocus,
      root: document,
    });

    expect(store.get('cart')).toBeUndefined();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), { phase: 'query-hydration' });

    script.textContent = '{"count":2}';
    document.dispatchEvent(new Event('visibilitychange'));

    await vi.waitFor(() => {
      expect(store.get('cart')).toEqual({ count: 2 });
      expect(refetchOnFocus).toHaveBeenCalledWith(['cart']);
    });

    // SPEC.md §9.4: hydrated script data, mutation chunks, and typed reads all
    // converge on one query-store apply path; transient malformed DOM script
    // JSON must remain discoverable for a later browser pass.
    expect(cartPlan).toHaveBeenCalledWith({ count: 2 });
    expect(onError).toHaveBeenCalledTimes(1);

    loader.dispose();
  });

  it('recovers parsed query scripts after a transient apply failure', async () => {
    document.body.innerHTML = [
      '<script kovo-query="cart" type="application/json">{"count":2}</script>',
      '<output data-bind="cart.count"></output>',
    ].join('');
    const store = createQueryStore();
    const cartPlan = vi.fn();
    const onError = vi.fn();
    const refetchOnFocus = vi.fn();
    const output = document.querySelector('output');
    const applyError = new Error('transient browser apply failure');
    let attempts = 0;
    if (!output) throw new Error('missing cart binding output');

    store.subscribe('cart', cartPlan);

    const loader = installKovoLoader({
      applyQuery() {
        attempts += 1;
        if (attempts === 1) throw applyError;
      },
      importModule: vi.fn(),
      onError,
      queryPlans: { cart: { bindings: true } },
      queryStore: store,
      refetchOnFocus,
      root: document,
    });

    expect(store.get('cart')).toBeUndefined();
    expect(onError).toHaveBeenCalledWith(applyError, { phase: 'query-hydration' });

    document.dispatchEvent(new Event('visibilitychange'));

    await vi.waitFor(() => {
      expect(store.get('cart')).toEqual({ count: 2 });
      expect(refetchOnFocus).toHaveBeenCalledWith(['cart']);
    });

    // SPEC.md §4.4/§9.4: browser query hydration uses the same runtime apply
    // path as typed reads; parsed scripts are only retired after that path
    // succeeds, so transient apply failures remain recoverable.
    expect(output.textContent).toBe('2');
    expect(cartPlan).toHaveBeenCalledWith({ count: 2 });
    expect(attempts).toBe(2);

    loader.dispose();
  });

  it('hydrates inline query events into the runtime store and DOM bindings', async () => {
    document.body.innerHTML = '<output data-bind="cart.count"></output>';
    const store = createQueryStore();
    const refetchOnFocus = vi.fn();
    const output = document.querySelector('output');
    if (!output) throw new Error('missing query binding output');

    const loader = installKovoLoader({
      importModule: vi.fn(),
      queryPlans: { cart: { bindings: true } },
      queryStore: store,
      refetchOnFocus,
      root: document,
    });

    window.dispatchEvent(
      new CustomEvent('kovo:query', {
        detail: {
          queries: [{ attrs: ' name="cart"', content: '{"count":5}' }],
        },
      }),
    );

    expect(store.get('cart')).toEqual({ count: 5 });
    expect(output.textContent).toBe('5');

    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => {
      expect(refetchOnFocus).toHaveBeenCalledWith(['cart']);
    });

    loader.dispose();
    window.dispatchEvent(
      new CustomEvent('kovo:query', {
        detail: {
          queries: [{ attrs: ' name="cart"', content: '{"count":6}' }],
        },
      }),
    );

    // SPEC.md §9.1/§9.4: inline enhanced responses publish the same query
    // truth and visible-return refetch eligibility as mutation responses, but
    // loader disposal must remove hydration.
    expect(store.get('cart')).toEqual({ count: 5 });
    expect(output.textContent).toBe('5');
  });

  it('threads the loader query apply hook through browser hydration events', () => {
    document.body.innerHTML = '<output data-bind="cart.count"></output>';
    const store = createQueryStore();
    const output = document.querySelector('output');
    if (!output) throw new Error('missing query binding output');

    const loader = installKovoLoader({
      applyQuery(query) {
        const value =
          typeof query.value === 'object' && query.value !== null
            ? (query.value as { count?: unknown })
            : {};
        store.set(query.name, { count: Number(value.count) + 1 }, query.key);
        return { value: store.get(query.name, query.key) };
      },
      importModule: vi.fn(),
      queryPlans: { cart: { bindings: true } },
      queryStore: store,
      root: document,
    });

    window.dispatchEvent(
      new CustomEvent('kovo:query', {
        detail: {
          queries: [{ attrs: ' name="cart"', content: '{"count":5}' }],
        },
      }),
    );

    // SPEC.md §9.1/§9.4: browser inline hydration uses the same configured
    // query apply hook as decoded mutation, typed-read, and script hydration.
    expect(store.get('cart')).toEqual({ count: 6 });
    expect(output.textContent).toBe('6');

    loader.dispose();
  });

  it('continues browser inline query event batches after an apply failure', () => {
    document.body.innerHTML = '<output data-bind="product.stock"></output>';
    const store = createQueryStore();
    const onError = vi.fn();
    const output = document.querySelector('output');
    const applyError = new Error('browser inline query apply failed');
    if (!output) throw new Error('missing product binding output');

    const loader = installKovoLoader({
      applyQuery(query) {
        if (query.name === 'cart') throw applyError;
      },
      importModule: vi.fn(),
      onError,
      queryPlans: { product: { bindings: true } },
      queryStore: store,
      root: document,
    });

    window.dispatchEvent(
      new CustomEvent('kovo:query', {
        detail: {
          queries: [
            { attrs: ' name="cart"', content: '{"count":5}' },
            { attrs: ' name="product"', content: '{"stock":8}' },
          ],
        },
      }),
    );

    // SPEC.md §9.1/§9.4: browser inline query event hydration enters the same
    // decoded query apply path as mutation responses and typed reads; a failed
    // hook reports through the loader seam without losing later query chunks.
    expect(onError).toHaveBeenCalledWith(applyError, { phase: 'query-hydration' });
    expect(store.get('cart')).toBeUndefined();
    expect(store.get('product')).toEqual({ stock: 8 });
    expect(output.textContent).toBe('8');

    loader.dispose();
  });
});
