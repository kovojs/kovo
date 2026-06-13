import { describe, expect, it, vi } from 'vitest';

import {
  applyInlineQueryEventToRuntime,
  installInlineQueryEventHydration,
  type QueryEventHydrationTarget,
} from './query-events.js';
import { applyQueryChunksToRuntime } from './query-apply.js';
import { createQueryStore } from './query-store.js';

describe('inline query events', () => {
  it('applies wire-shaped inline query events through the mutation query apply path', () => {
    const store = createQueryStore();
    const binding = {
      textContent: '',
      getAttribute: (name: string) => (name === 'data-bind' ? 'cart.count' : null),
    };
    const root = {
      querySelectorAll(selector: string) {
        if (selector === '[data-bind]') return [binding];
        if (selector === '*') return [];
        return [];
      },
    };

    expect(
      applyInlineQueryEventToRuntime(
        {
          detail: {
            attrs: ' name="cart" key="cart:c1"',
            content: '{"count":3}',
          },
        },
        {
          queryPlans: { cart: { bindings: true } },
          root,
          store,
        },
      ),
    ).toEqual(['cart:c1']);
    expect(store.get('cart', 'cart:c1')).toEqual({ count: 3 });
    expect(binding.textContent).toBe('3');

    // SPEC.md §9.1/§9.4: inline enhanced responses publish fw-query wire
    // chunks, so modular hydration and mutation apply share the same runtime
    // query store/update-plan behavior with no legacy event-shape adapter.
    binding.textContent = '';
    expect(
      applyQueryChunksToRuntime(store, [{ key: 'cart:c1', name: 'cart', value: { count: 4 } }], {
        queryPlans: { cart: { bindings: true } },
        root,
      }),
    ).toEqual(['cart:c1']);
    expect(store.get('cart', 'cart:c1')).toEqual({ count: 4 });
    expect(binding.textContent).toBe('4');
  });

  it('parses wire-shaped inline query events with the shared fw-query chunk parser', () => {
    const store = createQueryStore();
    const onError = vi.fn();

    expect(
      applyInlineQueryEventToRuntime(
        {
          detail: {
            attrs: ' name="product" key="product&gt;p1"',
            content: '{&quot;label&quot;:&quot;Alice&#39;s &amp; Bob&apos;s&quot;}',
          },
        },
        { onError, store },
      ),
    ).toEqual(['product:product>p1']);
    expect(store.get('product', 'product>p1')).toEqual({
      label: "Alice's & Bob's",
    });

    expect(
      applyInlineQueryEventToRuntime(
        {
          detail: {
            attrs: ' name="empty"',
            content: '',
          },
        },
        { onError, store },
      ),
    ).toEqual([]);

    // SPEC.md §9.1/§9.4: inline enhanced responses carry fw-query wire chunks
    // into the modular parser, so malformed or empty query bodies do not gain
    // a separate inline-only null fallback.
    expect(store.get('empty')).toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]?.[0].message)).toContain(
      'Malformed JSON in fw-query empty',
    );
  });

  it('ignores removed body/name inline query compatibility events', () => {
    const store = createQueryStore();

    expect(
      applyInlineQueryEventToRuntime(
        {
          detail: {
            body: '{"count":3}',
            key: 'cart:c1',
            name: 'cart',
          },
        },
        { store },
      ),
    ).toEqual([]);

    // SPEC.md §9.1/§9.4: the v1 inline query event contract is the fw-query
    // wire chunk shape emitted by inline-loader-build.ts, not an alternate
    // runtime-only compatibility payload.
    expect(store.get('cart', 'cart:c1')).toBeUndefined();
  });

  it('installs disposable inline query event hydration listeners', () => {
    const store = createQueryStore();
    const onAppliedQueries = vi.fn();
    const listeners = new Map<string, (event: { detail?: unknown }) => void>();
    const target: QueryEventHydrationTarget = {
      addEventListener(type: string, listener: (event: { detail?: unknown }) => void) {
        listeners.set(type, listener);
      },
      removeEventListener(type: string, listener: (event: { detail?: unknown }) => void) {
        if (listeners.get(type) === listener) listeners.delete(type);
      },
    };
    const dispose = installInlineQueryEventHydration({ onAppliedQueries, store, target });

    listeners.get('jiso:query')?.({
      detail: {
        attrs: ' name="cart"',
        content: '{"count":1}',
      },
    });
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(onAppliedQueries).toHaveBeenCalledWith(['cart']);

    dispose();
    listeners.get('jiso:query')?.({
      detail: {
        attrs: ' name="cart"',
        content: '{"count":2}',
      },
    });
    expect(listeners.has('jiso:query')).toBe(false);
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(onAppliedQueries).toHaveBeenCalledTimes(1);
  });
});
