import { describe, expect, it, vi } from 'vitest';

import { applyDeferredStreamResponseToRuntime } from './apply-deferred-stream.js';
import { createQueryStore } from './query-store.js';

describe('rootless deferred stream runtime apply', () => {
  it('keeps the split deferred module on the mutation runtime parser', () => {
    const store = createQueryStore();
    const onError = vi.fn();
    const beforeApplyQueries = vi.fn();

    // SPEC.md §9.1: deferred stream parts carry the same fw-query/fw-fragment
    // mutation vocabulary, so rootless stream apply still uses the mutation
    // response parser and decoded runtime apply primitive.
    const applied = applyDeferredStreamResponseToRuntime({
      beforeApplyQueries,
      body: [
        '--jiso-boundary',
        '<fw-query name="cart">{</fw-query>',
        '<fw-query name="inventory">{"available":true}</fw-query>',
        '<fw-fragment target="inventory"><section>ready</section></fw-fragment>',
        '--jiso-boundary',
        '<fw-query name="reviews">{"total":2}</fw-query>',
        '--jiso-boundary--',
      ].join('\n'),
      onError,
      root: undefined,
      store,
    });

    expect(applied).toEqual({
      chunks: [
        {
          fragments: [{ html: '<section>ready</section>', target: 'inventory' }],
          queries: ['inventory'],
        },
        {
          fragments: [],
          queries: ['reviews'],
        },
      ],
      fragments: [{ html: '<section>ready</section>', target: 'inventory' }],
      queries: ['inventory', 'reviews'],
    });
    expect(store.get('cart')).toBeUndefined();
    expect(store.get('inventory')).toEqual({ available: true });
    expect(store.get('reviews')).toEqual({ total: 2 });
    expect(beforeApplyQueries).toHaveBeenNthCalledWith(1, [
      { name: 'inventory', value: { available: true } },
    ]);
    expect(beforeApplyQueries).toHaveBeenNthCalledWith(2, [
      { name: 'reviews', value: { total: 2 } },
    ]);
    expect(String(onError.mock.calls[0]?.[0].message)).toContain('Malformed JSON in fw-query cart');
  });

  it('keeps rootless deferred streams on the hook-aware runtime apply path', () => {
    const store = createQueryStore();
    const beforeApplyQueries = vi.fn();
    const morph = vi.fn();

    // SPEC.md §9.1: deferred stream chunks reuse mutation response wire
    // vocabulary, so rootless stream forwarding still applies query truth
    // without enabling DOM fragment morphing.
    const applied = applyDeferredStreamResponseToRuntime({
      applyQuery(query) {
        store.set(query.name, { count: (query.value as { count: number }).count + 5 }, query.key);
        return { value: store.get(query.name, query.key) };
      },
      beforeApplyQueries,
      body: [
        '--jiso-boundary',
        '<fw-query name="cart">{"count":1}</fw-query>',
        '<fw-fragment target="cart-badge"><span>badge</span></fw-fragment>',
        '--jiso-boundary',
        '<fw-query name="cart" key="cart:primary">{"count":2}</fw-query>',
        '<fw-fragment target="cart-total"><span>total</span></fw-fragment>',
        '--jiso-boundary--',
      ].join('\n'),
      morph,
      root: undefined,
      store,
    });

    expect(applied).toEqual({
      chunks: [
        {
          fragments: [{ html: '<span>badge</span>', target: 'cart-badge' }],
          queries: ['cart'],
        },
        {
          fragments: [{ html: '<span>total</span>', target: 'cart-total' }],
          queries: ['cart:primary'],
        },
      ],
      fragments: [
        { html: '<span>badge</span>', target: 'cart-badge' },
        { html: '<span>total</span>', target: 'cart-total' },
      ],
      queries: ['cart', 'cart:primary'],
    });
    expect('appliedFragments' in applied).toBe(false);
    expect(store.get('cart')).toEqual({ count: 6 });
    expect(store.get('cart', 'cart:primary')).toEqual({ count: 7 });
    expect(morph).not.toHaveBeenCalled();
    expect(beforeApplyQueries).toHaveBeenNthCalledWith(1, [{ name: 'cart', value: { count: 1 } }]);
    expect(beforeApplyQueries).toHaveBeenNthCalledWith(2, [
      { key: 'cart:primary', name: 'cart', value: { count: 2 } },
    ]);
  });
});
