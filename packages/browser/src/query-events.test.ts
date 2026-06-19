import { describe, expect, it, vi } from 'vitest';

import {
  applyInlineQueryEventToRuntime,
  installInlineQueryEventHydration,
  type InlineQueryEvent,
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
            queries: [{ attrs: ' name="cart" key="cart:c1"', content: '{"count":3}' }],
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

    // SPEC.md §9.1/§9.4: inline enhanced responses publish kovo-query wire
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

  it('parses wire-shaped inline query events with the shared kovo-query chunk parser', () => {
    const store = createQueryStore();
    const onError = vi.fn();

    expect(
      applyInlineQueryEventToRuntime(
        {
          detail: {
            queries: [
              {
                attrs: ' name="product" key="product&gt;p1"',
                content: '{&quot;label&quot;:&quot;Alice&#39;s &amp; Bob&apos;s&quot;}',
              },
            ],
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
            queries: [{ attrs: ' name="empty"', content: '' }],
          },
        },
        { onError, store },
      ),
    ).toEqual([]);

    // SPEC.md §9.1/§9.4: inline enhanced responses carry kovo-query wire chunks
    // into the modular parser, so malformed or empty query bodies do not gain
    // a separate inline-only null fallback.
    expect(store.get('empty')).toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]?.[0].message)).toContain(
      'Malformed JSON in kovo-query empty',
    );
  });

  it('normalizes canonical inline query event instance keys before runtime apply', () => {
    const store = createQueryStore();
    const plan = vi.fn();

    store.subscribe('product', plan, 'p1');

    expect(
      applyInlineQueryEventToRuntime(
        {
          detail: {
            queries: [{ attrs: ' name="product:p1"', content: '{"stock":7}' }],
          },
        },
        { store },
      ),
    ).toEqual(['product:p1']);

    // SPEC.md §4.4/§9.4: inline enhanced responses dispatch raw kovo-query wire
    // chunks, so canonical typed-read keys must normalize before store apply.
    expect(store.get('product', 'p1')).toEqual({ stock: 7 });
    expect(store.get('product')).toBeUndefined();
    expect(plan).toHaveBeenCalledWith({ stock: 7 });
  });

  it('applies batched inline query events in one runtime query pass', () => {
    const store = createQueryStore();
    const seen: string[] = [];

    expect(
      applyInlineQueryEventToRuntime(
        {
          detail: {
            queries: [
              { attrs: ' name="cart" key="cart:c1"', content: '{"count":3}' },
              { attrs: ' name="product:p1"', content: '{"stock":7}' },
            ],
          },
        },
        {
          applyQuery(query) {
            seen.push(`${query.name}:${query.key ?? ''}`);
          },
          store,
        },
      ),
    ).toEqual(['cart:c1', 'product:p1']);

    // SPEC.md §4.4/§9.1: the inline loader publishes one parsed kovo-query
    // batch per enhanced response, so modular hydration shares the batched
    // query apply path used by mutation responses instead of per-query drift.
    expect(seen).toEqual(['cart:cart:c1', 'product:p1']);
  });

  it('reports inline query event apply failures while applying later queries', () => {
    const store = createQueryStore();
    const onError = vi.fn();
    const productPlan = vi.fn();
    const applyError = new Error('inline query apply failed');

    store.subscribe('product', productPlan, 'p1');

    expect(
      applyInlineQueryEventToRuntime(
        {
          detail: {
            queries: [
              { attrs: ' name="cart"', content: '{"count":3}' },
              { attrs: ' name="product:p1"', content: '{"stock":7}' },
            ],
          },
        },
        {
          applyQuery(query) {
            if (query.name === 'cart') throw applyError;
          },
          onError,
          store,
        },
      ),
    ).toEqual(['product:p1']);

    // SPEC.md §9.1/§9.4: inline query hydration shares the decoded mutation
    // query apply primitive, so one failed query reports through the runtime
    // error seam without aborting later query truth in the same batch.
    expect(store.get('cart')).toBeUndefined();
    expect(store.get('product', 'p1')).toEqual({ stock: 7 });
    expect(productPlan).toHaveBeenCalledWith({ stock: 7 });
    expect(onError).toHaveBeenCalledWith(applyError);
  });

  it('ignores removed inline query compatibility events', () => {
    const store = createQueryStore();

    const removedRuntimeShape: InlineQueryEvent = {
      detail: {
        // @ts-expect-error SPEC.md §9.1: inline query events carry batched
        // kovo-query element chunks, not runtime query values.
        body: '{"count":3}',
        key: 'cart:c1',
        name: 'cart',
      },
    };
    const removedSingleQueryShape: InlineQueryEvent = {
      detail: {
        // @ts-expect-error SPEC.md §9.1: a lone kovo-query element-like payload
        // is not the batched inline loader event contract.
        attrs: ' name="cart" key="cart:c1"',
        content: '{"count":3}',
      },
    };

    expect(
      applyInlineQueryEventToRuntime(removedRuntimeShape as unknown as InlineQueryEvent, { store }),
    ).toEqual([]);
    expect(
      applyInlineQueryEventToRuntime(removedSingleQueryShape as unknown as InlineQueryEvent, {
        store,
      }),
    ).toEqual([]);

    // SPEC.md §9.1/§9.4: the inline query event contract is the batched
    // kovo-query wire shape emitted by inline-loader-build.ts, not alternate
    // single-query or runtime-only compatibility payloads.
    expect(store.get('cart', 'cart:c1')).toBeUndefined();
  });

  it('installs disposable inline query event hydration listeners', () => {
    const store = createQueryStore();
    const onAppliedQueries = vi.fn();
    const listeners = new Map<string, (event: InlineQueryEvent) => void>();
    const target: QueryEventHydrationTarget = {
      addEventListener(type: string, listener: (event: InlineQueryEvent) => void) {
        listeners.set(type, listener);
      },
      removeEventListener(type: string, listener: (event: InlineQueryEvent) => void) {
        if (listeners.get(type) === listener) listeners.delete(type);
      },
    };
    const dispose = installInlineQueryEventHydration({ onAppliedQueries, store, target });

    listeners.get('kovo:query')?.({
      detail: {
        queries: [{ attrs: ' name="cart"', content: '{"count":1}' }],
      },
    });
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(onAppliedQueries).toHaveBeenCalledWith(['cart']);

    dispose();
    listeners.get('kovo:query')?.({
      detail: {
        queries: [{ attrs: ' name="cart"', content: '{"count":2}' }],
      },
    });
    expect(listeners.has('kovo:query')).toBe(false);
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(onAppliedQueries).toHaveBeenCalledTimes(1);
  });
});
