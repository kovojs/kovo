import { describe, expect, it } from 'vitest';
import { trustedHtml } from '@kovojs/browser';

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

  // L2-deferred-4 (bugs-part3): `register` is now collision-aware (parity with
  // `collect`). The SAME renderer object re-registers idempotently (HMR re-import);
  // a DIFFERENT object for the same component id throws instead of last-writer-wins
  // silently cross-contaminating renderers.
  it('stores generated renderers and is collision-aware on re-register (L2-deferred-4)', () => {
    const initial = registeredGeneratedLiveTargetRenderers().filter(
      (renderer) => renderer.component === 'test/auto-registered',
    );
    expect(initial).toEqual([]);

    const first: LiveTargetRenderer = {
      component: 'test/auto-registered',
      queries: ['cart'],
      render: () => '<cart-badge>1</cart-badge>',
    };
    const conflicting: LiveTargetRenderer = {
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

    // Re-registering the SAME object identity is idempotent (no throw, no duplicate).
    expect(registerGeneratedLiveTargetRenderer(first)).toBe(first);
    expect(
      registeredGeneratedLiveTargetRenderers().filter(
        (renderer) => renderer.component === 'test/auto-registered',
      ),
    ).toEqual([first]);

    // A DIFFERENT object for the same component id is a collision → throw (parity with
    // `collectGeneratedLiveTargetRenderers`); the first registration is preserved.
    expect(() => registerGeneratedLiveTargetRenderer(conflicting)).toThrow(
      'Duplicate generated live target renderer for component "test/auto-registered".',
    );
    expect(
      registeredGeneratedLiveTargetRenderers().filter(
        (renderer) => renderer.component === 'test/auto-registered',
      ),
    ).toEqual([first]);
  });
});
