import { describe, expect, it } from 'vitest';

import {
  collectGeneratedLiveTargetRenderers,
  registeredGeneratedLiveTargetRenderers,
  registerGeneratedLiveTargetRenderer,
} from './live-target-registry.js';
import type { LiveTargetRenderer } from './mutation-wire.js';

describe('generated live target registry collection', () => {
  it('collects only compiler-emitted live target renderer exports', () => {
    const cart: LiveTargetRenderer = {
      component: 'components/cart/cart-badge/cart-badge',
      queries: ['cart'],
      render: () => '<cart-badge>1</cart-badge>',
    };
    const product: LiveTargetRenderer = {
      component: 'components/products/product-grid/product-grid',
      queries: ['products'],
      render: () => '<product-grid></product-grid>',
    };

    expect(
      collectGeneratedLiveTargetRenderers([
        {
          CartBadge: {},
          CartBadge$liveTargetRenderer: cart,
          malformed$liveTargetRenderer: { component: 'bad' },
        },
        {
          ProductGrid$liveTargetRenderer: product,
          query: { key: 'products' },
        },
      ]),
    ).toEqual([cart, product]);
  });

  it('dedupes the same renderer object but rejects conflicting duplicate component ids', () => {
    const renderer: LiveTargetRenderer = {
      component: 'components/cart/cart-badge/cart-badge',
      render: () => '<cart-badge>1</cart-badge>',
    };
    const duplicate: LiveTargetRenderer = {
      component: 'components/cart/cart-badge/cart-badge',
      render: () => '<cart-badge>2</cart-badge>',
    };

    expect(
      collectGeneratedLiveTargetRenderers([
        { CartBadge$liveTargetRenderer: renderer },
        { CartBadgeAgain$liveTargetRenderer: renderer },
      ]),
    ).toEqual([renderer]);

    expect(() =>
      collectGeneratedLiveTargetRenderers([
        { CartBadge$liveTargetRenderer: renderer },
        { OtherCartBadge$liveTargetRenderer: duplicate },
      ]),
    ).toThrow(
      'Duplicate generated live target renderer for component "components/cart/cart-badge/cart-badge".',
    );
  });

  it('collects generated renderer exports without ambient object, string, array, or Map dispatch', () => {
    const renderer: LiveTargetRenderer = {
      component: 'components/security/registry-census',
      queries: ['security-census'],
      render: () => '<registry-census>safe</registry-census>',
    };
    const modules = [{ RegistryCensus$liveTargetRenderer: renderer }];
    const originalEntries = Object.entries;
    const originalEndsWith = String.prototype.endsWith;
    const originalEvery = Array.prototype.every;
    const originalGet = Map.prototype.get;
    const originalSet = Map.prototype.set;
    const originalValues = Map.prototype.values;
    const calls = { endsWith: 0, entries: 0, every: 0, get: 0, set: 0, values: 0 };
    Object.entries = function (value) {
      calls.entries += 1;
      return originalEntries(value);
    } as typeof Object.entries;
    String.prototype.endsWith = function (search, endPosition) {
      calls.endsWith += 1;
      return originalEndsWith.call(this, search, endPosition);
    };
    Array.prototype.every = function (callback, thisArg) {
      calls.every += 1;
      return originalEvery.call(this, callback, thisArg);
    } as typeof Array.prototype.every;
    Map.prototype.get = function (key) {
      calls.get += 1;
      return originalGet.call(this, key);
    };
    Map.prototype.set = function (key, value) {
      calls.set += 1;
      return originalSet.call(this, key, value);
    };
    Map.prototype.values = function () {
      calls.values += 1;
      return originalValues.call(this);
    };

    let collected: LiveTargetRenderer[];
    try {
      collected = collectGeneratedLiveTargetRenderers(modules);
    } finally {
      Map.prototype.values = originalValues;
      Map.prototype.set = originalSet;
      Map.prototype.get = originalGet;
      Array.prototype.every = originalEvery;
      String.prototype.endsWith = originalEndsWith;
      Object.entries = originalEntries;
    }

    expect(calls).toEqual({ endsWith: 0, entries: 0, every: 0, get: 0, set: 0, values: 0 });
    expect(collected).toEqual([renderer]);
  });

  it('stores generated renderers idempotently by component id', () => {
    const initial = registeredGeneratedLiveTargetRenderers().filter(
      (renderer) => renderer.component === 'test/auto-registered',
    );
    expect(initial).toEqual([]);

    const first: LiveTargetRenderer = {
      component: 'test/auto-registered',
      queries: ['cart'],
      render: () => '<cart-badge>1</cart-badge>',
    };
    expect(registerGeneratedLiveTargetRenderer(first)).toBe(first);
    expect(
      registeredGeneratedLiveTargetRenderers().filter(
        (renderer) => renderer.component === 'test/auto-registered',
      ),
    ).toEqual([first]);

    // Re-registering the SAME object identity is idempotent (no throw, no duplicate).
    expect(registerGeneratedLiveTargetRenderer(first)).toBe(first);
    expect(
      registeredGeneratedLiveTargetRenderers().filter(
        (renderer) => renderer.component === 'test/auto-registered',
      ),
    ).toEqual([first]);

    expect(
      registeredGeneratedLiveTargetRenderers().filter(
        (renderer) => renderer.component === 'test/auto-registered',
      ),
    ).toEqual([first]);
  });

  it('replaces stale generated renderers by component id during dev HMR', async () => {
    const component = 'test/hmr-auto-registered';
    const initial = registeredGeneratedLiveTargetRenderers().filter(
      (renderer) => renderer.component === component,
    );
    expect(initial).toEqual([]);

    const first: LiveTargetRenderer = {
      component,
      queries: ['cart'],
      render: () => '<cart-badge>stale</cart-badge>',
    };
    const latest: LiveTargetRenderer = {
      component,
      queries: ['cart'],
      render: () => '<cart-badge>latest</cart-badge>',
    };

    expect(registerGeneratedLiveTargetRenderer(first)).toBe(first);
    expect(registerGeneratedLiveTargetRenderer(latest)).toBe(latest);

    const active = registeredGeneratedLiveTargetRenderers().filter(
      (renderer) => renderer.component === component,
    );
    expect(active).toEqual([latest]);
    expect(
      await active[0]!.render({
        liveTarget: { component, props: {}, target: 'cart-badge' },
        request: new Request('http://kovo.test/cart'),
      }),
    ).toBe('<cart-badge>latest</cart-badge>');
  });
});
