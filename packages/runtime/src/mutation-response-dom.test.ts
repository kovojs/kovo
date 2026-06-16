import { describe, expect, it, vi } from 'vitest';

import { applyMutationResponseBodyToRuntime } from './apply-mutation-response.js';
import { createQueryStore } from './index.js';
import {
  FakeMorphRoot,
  FakeMorphTarget,
  FakeQueryBindingElement,
  FakeQueryPlanElement,
} from './runtime-test-fakes.js';

describe('mutation response DOM apply', () => {
  it('keeps store-only and DOM apply on the same keyed query path', () => {
    const storeOnly = createQueryStore();
    const domStore = createQueryStore();
    const root = new FakeMorphRoot();
    const body = [
      '<kovo-query name="cart" key="cart:c1">{"count":5}</kovo-query>',
      '<kovo-fragment target="cart-list" mode="append"><li>p1</li></kovo-fragment>',
    ].join('');

    // SPEC.md §9.1: mutation responses carry query patches and fragment patches together.
    const storeOnlyApplied = applyMutationResponseBodyToRuntime({ body, store: storeOnly });
    const domApplied = applyMutationResponseBodyToRuntime({ body, root, store: domStore });

    expect(domStore.get('cart', 'cart:c1')).toEqual(storeOnly.get('cart', 'cart:c1'));
    expect(domApplied.queries).toEqual(storeOnlyApplied.queries);
    expect(domApplied.fragments).toEqual(storeOnlyApplied.fragments);
  });

  it('reuses one attribute binding scan across multi-query DOM apply', () => {
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

    // SPEC.md §9.1 mutation bodies may carry multiple query chunks before any
    // fragment morphing; those chunks should share one §4.8 binding index.
    const applied = applyMutationResponseBodyToRuntime({
      body: [
        '<kovo-query name="cart">{"label":"Cart ready"}</kovo-query>',
        '<kovo-query name="product">{"label":"Product ready"}</kovo-query>',
      ].join('\n'),
      root,
      store,
    });

    expect(applied.queries).toEqual(['cart', 'product']);
    expect(root.wildcardSelectorCalls).toBe(1);
    expect(cartLabel.getAttribute('aria-label')).toBe('Cart ready');
    expect(productLabel.getAttribute('aria-label')).toBe('Product ready');
  });

  it('applies query update bindings from mutation chunks without requiring a fragment', () => {
    const root = new FakeMorphRoot();
    const store = createQueryStore();
    const count = new FakeQueryBindingElement('cart.count', { textContent: '1' });
    const total = new FakeQueryBindingElement('cart.total', { value: '1499' });
    const product = new FakeQueryBindingElement('product.name', { textContent: 'Coffee' });
    root.bindings.push(count, total, product);

    const result = applyMutationResponseBodyToRuntime({
      body: '<kovo-query name="cart">{"count":2,"total":2998}</kovo-query>',
      root,
      store,
    });

    expect(result).toEqual({
      appliedFragments: [],
      fragments: [],
      queries: ['cart'],
    });
    expect(count.textContent).toBe('2');
    expect(total.value).toBe('2998');
    expect(product.textContent).toBe('Coffee');
  });

  it('applies mutation query chunks through compiled update plans before morphing', () => {
    const root = new FakeMorphRoot();
    const store = createQueryStore();
    const count = new FakeQueryBindingElement('cart.count', { textContent: '1' });
    const summary = new FakeQueryPlanElement({ 'data-derive': 'cart.summary' });
    const host = new FakeQueryPlanElement({ 'data-plan': 'cart-host' });
    const observed: string[] = [];
    root.bindings.push(count);
    root.planElements.push(summary, host);
    root.targets.set('cart-badge', new FakeMorphTarget());

    applyMutationResponseBodyToRuntime({
      body: [
        '<kovo-query name="cart">{"count":5}</kovo-query>',
        '<kovo-fragment target="cart-badge"><cart-badge>Ready</cart-badge></kovo-fragment>',
      ].join('\n'),
      morph(target, html) {
        observed.push(
          `morph:${count.textContent}:${summary.textContent}:${host.getAttribute('data-count')}`,
        );
        target.replaceWithHtml(html);
      },
      queryPlans: {
        cart: {
          derives: [
            {
              name: 'summary',
              select: (value) => `${(value as { count: number }).count} items`,
            },
          ],
          stamps: [
            {
              attr: 'data-count',
              selector: '[data-plan="cart-host"]',
              select: (value) => (value as { count: number }).count,
            },
          ],
        },
      },
      root,
      store,
    });

    expect(observed).toEqual(['morph:5:5 items:5']);
  });

  it('reports malformed mutation query chunks while applying valid DOM updates', () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const onError = vi.fn();
    root.targets.set('cart-badge', new FakeMorphTarget());

    const applied = applyMutationResponseBodyToRuntime({
      body: [
        '<kovo-query name="cart">{</kovo-query>',
        '<kovo-query name="inventory">{"available":true}</kovo-query>',
        '<kovo-fragment target="cart-badge"><cart-badge>Ready</cart-badge></kovo-fragment>',
      ].join('\n'),
      onError,
      root,
      store,
    });

    expect(store.get('cart')).toBeUndefined();
    expect(store.get('inventory')).toEqual({ available: true });
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>Ready</cart-badge>');
    expect(applied.queries).toEqual(['inventory']);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('reports malformed mutation fragment chunks through the DOM error hook', () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const onError = vi.fn();
    root.targets.set('cart-badge', new FakeMorphTarget());

    // SPEC section 9.1 defines kovo-fragment as mutation response wire vocabulary.
    const applied = applyMutationResponseBodyToRuntime({
      body: [
        '<kovo-query name="cart">{"count":3}</kovo-query>',
        '<kovo-fragment target="cart-badge"><cart-badge>3</cart-badge></kovo-fragment>',
        '<kovo-fragment target="cart-list"><li>stale</li>',
      ].join('\n'),
      onError,
      root,
      store,
    });

    expect(store.get('cart')).toEqual({ count: 3 });
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>3</cart-badge>');
    expect(applied).toEqual({
      appliedFragments: ['cart-badge'],
      fragments: [{ html: '<cart-badge>3</cart-badge>', target: 'cart-badge' }],
      queries: ['cart'],
    });
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(String(onError.mock.calls[0]?.[0].message)).toContain('Malformed kovo-fragment chunk');
  });

  it('applies interposed query values through compiled plans before morphing fragments', () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const count = new FakeQueryBindingElement({ 'data-bind': 'cart.count' }, '0');
    const summary = new FakeQueryBindingElement({ 'data-derive': 'cart.summary' });
    const observed: string[] = [];
    root.bindings.push(count, summary);
    root.targets.set('cart-badge', new FakeMorphTarget());

    const applied = applyMutationResponseBodyToRuntime({
      applyQuery(query) {
        store.set(query.name, { count: (query.value as { count: number }).count + 10 }, query.key);
        return { value: store.get(query.name, query.key) };
      },
      body: [
        '<kovo-query name="cart">{"count":5}</kovo-query>',
        '<kovo-fragment target="cart-badge"><cart-badge>ready</cart-badge></kovo-fragment>',
      ].join('\n'),
      morph(target, html) {
        observed.push(`${count.textContent}:${summary.textContent}`);
        target.replaceWithHtml(html);
      },
      queryPlans: {
        cart: {
          derives: [
            {
              name: 'summary',
              select: (value) => `${(value as { count: number }).count} items`,
            },
          ],
        },
      },
      root,
      store,
    });

    expect(applied).toEqual({
      appliedFragments: ['cart-badge'],
      fragments: [{ html: '<cart-badge>ready</cart-badge>', target: 'cart-badge' }],
      queries: ['cart'],
    });
    expect(store.get('cart')).toEqual({ count: 15 });
    expect(count.textContent).toBe('15');
    expect(summary.textContent).toBe('15 items');
    expect(observed).toEqual(['15:15 items']);
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>ready</cart-badge>');
  });
});
