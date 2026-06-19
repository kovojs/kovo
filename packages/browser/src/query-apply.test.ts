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

  it('scopes keyed query chunks to matching kovo-deps consumers', () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const p1Stock = scopedBinding('product:p1', 'product.stock', '2');
    const p2Stock = scopedBinding('product:p2', 'product.stock', '9');
    root.bindings.push(p1Stock, p2Stock);

    const applied = applyQueryChunksToRuntime(
      store,
      [{ key: 'product:p1', name: 'product', value: { stock: 7 } }],
      {
        queryPlans: {
          product: { bindings: false },
          'product:p1': { bindings: true },
        },
        root,
      },
    );

    // SPEC.md §10.2: canonical query instance keys partition same-query
    // consumers, so a product:p1 chunk cannot overwrite product:p2 bindings.
    expect(applied).toEqual(['product:p1']);
    expect(store.get('product', 'product:p1')).toEqual({ stock: 7 });
    expect(p1Stock.textContent).toBe('7');
    expect(p2Stock.textContent).toBe('9');
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

describe('delta query chunk apply (SPEC §9.1.1)', () => {
  it('applies a delta chunk by merging into the existing store base', () => {
    // SPEC §9.1.1: when delta=true, applyQueryDelta merges into the held base
    // instead of overwriting; the update plan runs on the merged result.
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const countEl = new FakeQueryBindingElement({ 'data-bind': 'cart.count' });
    root.bindings.push(countEl);

    store.set('cart', { count: 1, items: [{ id: 'p1', qty: 1 }] });

    const applied = applyQueryChunksToRuntime(
      store,
      [
        {
          delta: true,
          name: 'cart',
          value: {
            set: { count: 2 },
            lists: { items: { key: 'id', upsert: [{ id: 'p1', qty: 2 }] } },
          },
        },
      ],
      { queryPlans: { cart: { bindings: true } }, root },
    );

    // Applied and store contain the merged full value (SPEC §9.1.1).
    expect(applied).toEqual(['cart']);
    expect(store.get('cart')).toEqual({ count: 2, items: [{ id: 'p1', qty: 2 }] });
    // Update plan ran on the merged result.
    expect(countEl.textContent).toBe('2');
  });

  it('round-trip: store base + delta chunk = expected full value', () => {
    // SPEC §9.1.1: apply_delta(base, render_prod(Δ)) ≡ render_dev(full).
    const store = createQueryStore();
    store.set('cart', {
      count: 2,
      items: [
        { id: 'p1', qty: 1 },
        { id: 'p2', qty: 3 },
      ],
    });

    applyQueryChunksToRuntime(store, [
      {
        delta: true,
        name: 'cart',
        value: {
          set: { count: 4 },
          lists: { items: { key: 'id', upsert: [{ id: 'p2', qty: 4 }], remove: [] } },
        },
      },
    ]);

    expect(store.get('cart')).toEqual({
      count: 4,
      items: [
        { id: 'p1', qty: 1 },
        { id: 'p2', qty: 4 },
      ],
    });
  });

  it('triggers onDeltaMiss and does NOT set the store when base is missing', () => {
    // SPEC §9.1.1: no base → QueryDeltaApplyError → miss handler, store unchanged.
    const store = createQueryStore();
    const onDeltaMiss = vi.fn();

    const applied = applyQueryChunksToRuntime(
      store,
      [{ delta: true, name: 'cart', value: { set: { count: 2 } } }],
      { onDeltaMiss },
    );

    // The chunk was not applied (no store write, not in applied list).
    expect(applied).toEqual([]);
    expect(store.get('cart')).toBeUndefined();
    expect(onDeltaMiss).toHaveBeenCalledWith('cart', undefined);
  });

  it('triggers onDeltaMiss with the correct key for a keyed delta chunk', () => {
    const store = createQueryStore();
    const onDeltaMiss = vi.fn();

    applyQueryChunksToRuntime(
      store,
      [{ delta: true, key: 'p1', name: 'product', value: { set: { stock: 5 } } }],
      { onDeltaMiss },
    );

    expect(onDeltaMiss).toHaveBeenCalledWith('product', 'p1');
    expect(store.get('product', 'p1')).toBeUndefined();
  });

  it('does not call onDeltaMiss for full (non-delta) chunks', () => {
    const store = createQueryStore();
    const onDeltaMiss = vi.fn();

    applyQueryChunksToRuntime(store, [{ name: 'cart', value: { count: 5 } }], { onDeltaMiss });

    expect(onDeltaMiss).not.toHaveBeenCalled();
    expect(store.get('cart')).toEqual({ count: 5 });
  });
});

function scopedBinding(deps: string, path: string, textContent: string): FakeQueryBindingElement {
  const element = new FakeQueryBindingElement(path, textContent) as FakeQueryBindingElement & {
    closest(selector: string): FakeQueryBindingElement | null;
  };
  element.closest = (selector: string) =>
    selector === '[kovo-deps]'
      ? ({
          getAttribute(name: string) {
            return name === 'kovo-deps' ? deps : null;
          },
        } as FakeQueryBindingElement)
      : null;
  return element;
}
