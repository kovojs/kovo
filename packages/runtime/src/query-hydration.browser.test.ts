import { afterEach, describe, expect, it, vi } from 'vitest';

import { createQueryStore, installJisoLoader } from './index.js';

afterEach(() => {
  document.body.replaceChildren();
});

describe('query hydration browser runtime', () => {
  it('hydrates newly inserted query scripts through store subscribers and DOM bindings', async () => {
    document.body.innerHTML = [
      '<script fw-query="cart" type="application/json">{"count":1}</script>',
      '<output data-bind="recommendations.items"></output>',
    ].join('');
    const store = createQueryStore();
    const cartPlan = vi.fn();
    const recommendationsPlan = vi.fn();
    const refetchOnFocus = vi.fn();
    const output = document.querySelector('output');
    if (!output) throw new Error('missing recommendations binding output');

    store.subscribe('cart', cartPlan);
    store.subscribe('recommendations', recommendationsPlan);

    const loader = installJisoLoader({
      importModule: vi.fn(),
      queryPlans: { recommendations: { bindings: true } },
      queryStore: store,
      refetchOnFocus,
      root: document,
    });

    const originalScript = document.querySelector('script[fw-query="cart"]');
    if (!originalScript) throw new Error('missing original query script');

    expect(store.get('cart')).toEqual({ count: 1 });

    originalScript.textContent = '{"count":99}';
    const laterScript = document.createElement('script');
    laterScript.type = 'application/json';
    laterScript.setAttribute('fw-query', 'recommendations');
    laterScript.textContent = '{"items":["p1"]}';
    document.body.append(laterScript);

    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => {
      expect(refetchOnFocus).toHaveBeenCalledWith(['cart', 'recommendations']);
    });

    // SPEC.md §9.1/§9.4: browser-visible hydration discoveries use the shared
    // query apply path without replaying already observed server script nodes.
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(store.get('recommendations')).toEqual({ items: ['p1'] });
    expect(output.textContent).toBe('["p1"]');
    expect(cartPlan).toHaveBeenCalledTimes(1);
    expect(recommendationsPlan).toHaveBeenCalledWith({ items: ['p1'] });

    loader.dispose();
  });

  it('recovers malformed hydrated query scripts on a later visible return', async () => {
    document.body.innerHTML = '<script fw-query="cart" type="application/json">{</script>';
    const store = createQueryStore();
    const cartPlan = vi.fn();
    const onError = vi.fn();
    const refetchOnFocus = vi.fn();
    const script = document.querySelector('script[fw-query="cart"]');
    if (!script) throw new Error('missing cart query script');

    store.subscribe('cart', cartPlan);

    const loader = installJisoLoader({
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

  it('hydrates inline query events into the runtime store and DOM bindings', async () => {
    document.body.innerHTML = '<output data-bind="cart.count"></output>';
    const store = createQueryStore();
    const refetchOnFocus = vi.fn();
    const output = document.querySelector('output');
    if (!output) throw new Error('missing query binding output');

    const loader = installJisoLoader({
      importModule: vi.fn(),
      queryPlans: { cart: { bindings: true } },
      queryStore: store,
      refetchOnFocus,
      root: document,
    });

    window.dispatchEvent(
      new CustomEvent('jiso:query', {
        detail: {
          attrs: ' name="cart"',
          content: '{"count":5}',
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
      new CustomEvent('jiso:query', {
        detail: {
          attrs: ' name="cart"',
          content: '{"count":6}',
        },
      }),
    );

    // SPEC.md §9.1/§9.4: inline enhanced responses publish the same query
    // truth and visible-return refetch eligibility as mutation responses, but
    // loader disposal must remove hydration.
    expect(store.get('cart')).toEqual({ count: 5 });
    expect(output.textContent).toBe('5');
  });
});
