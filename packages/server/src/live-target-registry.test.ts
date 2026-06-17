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

  it('stores generated renderers registered by imported modules', () => {
    const initial = registeredGeneratedLiveTargetRenderers().filter(
      (renderer) => renderer.component === 'test/auto-registered',
    );
    expect(initial).toEqual([]);

    const first: LiveTargetRenderer = {
      component: 'test/auto-registered',
      queries: ['cart'],
      render: () => '<cart-badge>1</cart-badge>',
    };
    const second: LiveTargetRenderer = {
      component: 'test/auto-registered',
      queries: ['cart'],
      render: () => '<cart-badge>2</cart-badge>',
    };

    expect(registerGeneratedLiveTargetRenderer(first)).toBe(first);
    expect(
      registeredGeneratedLiveTargetRenderers().filter(
        (renderer) => renderer.component === 'test/auto-registered',
      ),
    ).toEqual([first]);

    registerGeneratedLiveTargetRenderer(second);
    expect(
      registeredGeneratedLiveTargetRenderers().filter(
        (renderer) => renderer.component === 'test/auto-registered',
      ),
    ).toEqual([second]);
  });
});
