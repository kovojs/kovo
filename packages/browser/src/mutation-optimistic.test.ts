import { describe, expect, it, vi } from 'vitest';

import { installMutationBroadcast } from './broadcast.js';
import { submitOptimisticEnhancedMutation } from './mutation-optimistic.js';
import { OptimisticRebaser } from './optimism.js';
import { createQueryStore } from './query-store.js';
import {
  FakeBroadcastChannel,
  FakeMorphRoot,
  FakeMorphTarget,
  FakePendingElement,
  FakePendingRoot,
  FakeQueryBindingElement,
  FakeQueryPlanElement,
} from './runtime-test-fakes.js';

describe('optimistic enhanced mutation submission', () => {
  it('reconciles server truth and broadcasts successful enhanced responses', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const channel = new FakeBroadcastChannel();
    const broadcast = installMutationBroadcast({ channel, store });
    const root = new FakeMorphRoot();
    const cartBadge = new FakePendingElement({ 'kovo-deps': 'cart' });
    const pendingRoot = new FakePendingRoot([cartBadge]);
    root.deps = [{ id: 'cart-badge' }];
    root.targets.set('cart-badge', new FakeMorphTarget());
    store.set('cart', { count: 1 });

    const fetch = vi.fn(async () => {
      expect(store.get('cart')).toEqual({ count: 3 });
      expect(cartBadge.attributes).toMatchObject({
        'aria-busy': 'true',
        'kovo-pending': '',
      });

      return {
        headers: {
          get(name: string) {
            return name === 'Kovo-Changes'
              ? '[{"domain":"cart","input":{"productId":"p1","quantity":2}}]'
              : null;
          },
        },
        async text() {
          return [
            '<kovo-query name="cart">{"count":4}</kovo-query>',
            '<kovo-fragment target="cart-badge"><cart-badge>4</cart-badge></kovo-fragment>',
          ].join('\n');
        },
      };
    });

    const result = await submitOptimisticEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      broadcast,
      idem: 'idem_optimistic',
      input: { quantity: 2 },
      optimistic: {
        transforms: {
          cart(current, input) {
            const cart = current as { count: number };
            return { count: cart.count + input.quantity };
          },
        },
      },
      pendingRoot,
      rebaser,
      root,
      store,
    });

    expect(result.queries).toEqual(['cart']);
    expect(result.changes).toEqual([{ domain: 'cart' }]);
    expect(channel.messages).toEqual([
      {
        body: [
          '<kovo-query name="cart">{"count":4}</kovo-query>',
          '<kovo-fragment target="cart-badge"><cart-badge>4</cart-badge></kovo-fragment>',
        ].join('\n'),
        changes: [{ domain: 'cart' }],
        type: 'kovo:mutation-response',
      },
    ]);
    expect(store.get('cart')).toEqual({ count: 4 });
    expect(rebaser.pendingCount('cart')).toBe(0);
    expect(cartBadge.attributes).not.toHaveProperty('kovo-pending');
    expect(cartBadge.attributes).not.toHaveProperty('aria-busy');
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>4</cart-badge>');
  });

  it('reconciles keyed optimistic enhanced submits with keyed query chunks', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const root = new FakeMorphRoot();
    root.targets.set('reviews:p1', new FakeMorphTarget());
    store.set('reviews', { items: [{ id: 'r1' }] }, 'product:p1');

    const fetch = vi.fn(async () => {
      expect(store.get('reviews')).toBeUndefined();
      expect(store.get('reviews', 'product:p1')).toEqual({
        items: [{ id: 'r1' }, { id: 'draft' }],
      });

      return {
        async text() {
          return [
            '<kovo-query name="reviews" key="product:p1">{"items":[{"id":"r1"},{"id":"server"}]}</kovo-query>',
            '<kovo-fragment target="reviews:p1"><section>Reviews ready</section></kovo-fragment>',
          ].join('\n');
        },
      };
    });

    const result = await submitOptimisticEnhancedMutation({
      fetch,
      form: { action: '/_m/reviews/add', method: 'post' },
      formData: new FormData(),
      change: {
        domain: 'product',
        input: { reviewId: 'draft' },
        keys: ['p1'],
      },
      idem: 'idem_keyed_optimistic',
      input: { reviewId: 'ignored' },
      optimistic: {
        keys: { reviews: (change) => `product:${change.keys?.[0]}` },
        transforms: {
          reviews(current, input) {
            const reviews = current as { items: { id: string }[] };
            return { items: [...reviews.items, { id: input.reviewId }] };
          },
        },
      },
      rebaser,
      root,
      store,
    });

    expect(result.queries).toEqual(['reviews:product:p1']);
    expect(store.get('reviews')).toBeUndefined();
    expect(store.get('reviews', 'product:p1')).toEqual({
      items: [{ id: 'r1' }, { id: 'server' }],
    });
    expect(rebaser.pendingCount('reviews', 'product:p1')).toBe(0);
    expect(root.targets.get('reviews:p1')?.html).toBe('<section>Reviews ready</section>');
  });

  it('F1: merges a prod delta chunk before rebasing instead of storing the raw envelope', async () => {
    // SPEC §9.1.1: a `<kovo-query delta>` response body is a QueryDelta envelope
    // ({set}/{lists}), not the full value. The optimistic apply hook must merge the
    // delta against the held base BEFORE handing it to the rebaser as server truth;
    // otherwise the raw envelope is written to the store as the full value and the
    // rebaser baseline is corrupted (every binding renders blank).
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    store.set('cart', { count: 5, items: [{ kovoKey: 'a' }] });

    const fetch = vi.fn(async () => ({
      async text() {
        // Steady-state prod encoding: a delta chunk that overwrites `count` (a
        // non-collection field, sent whole under `set`) and upserts the `items`
        // collection. The merge against the held base must produce the FULL value;
        // the held base for future deltas and the rebaser server-truth baseline
        // must both be that merged value, never the raw {set}/{lists} envelope.
        return [
          '<kovo-query name="cart" delta>',
          '{"set":{"count":6},"lists":{"items":{"key":"kovoKey","upsert":[{"kovoKey":"b"}]}}}',
          '</kovo-query>',
        ].join('');
      },
    }));

    await submitOptimisticEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      idem: 'idem_delta',
      input: { quantity: 1 },
      optimistic: {
        transforms: {
          cart(current, input) {
            const cart = current as { count: number; items: unknown[] };
            return { ...cart, count: cart.count + input.quantity };
          },
        },
      },
      rebaser,
      root: new FakeMorphRoot(),
      store,
    });

    // Server committed count=6, upserted item b, and settled the only pending
    // transform → merged FULL value, NOT the raw {set,lists} envelope.
    expect(store.get('cart')).toEqual({ count: 6, items: [{ kovoKey: 'a' }, { kovoKey: 'b' }] });
    expect(rebaser.pendingCount('cart')).toBe(0);
  });

  it('rebases other pending optimism while reconciling an optimistic submit', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const root = new FakeMorphRoot();
    const cartBadge = new FakePendingElement({ 'kovo-deps': 'cart' });
    const pendingRoot = new FakePendingRoot([cartBadge]);
    root.deps = [{ id: 'cart-badge' }];
    const count = new FakeQueryBindingElement('cart.count', { textContent: '0' });
    const summary = new FakeQueryPlanElement({ 'data-derive': 'cart.summary' });
    const observed: string[] = [];
    root.bindings.push(count);
    root.planElements.push(summary);
    root.targets.set('cart-badge', new FakeMorphTarget());
    store.set('cart', { count: 0 });
    const optimistic = {
      transforms: {
        cart(current: unknown, input: { quantity: number }) {
          const cart = current as { count: number };
          return { count: cart.count + input.quantity };
        },
      },
    };
    const fetch = vi.fn(async () => {
      rebaser.add('idem_second', { quantity: 5 }, optimistic);
      expect(store.get('cart')).toEqual({ count: 7 });

      return {
        async text() {
          return [
            '<kovo-query name="cart">{"count":2}</kovo-query>',
            '<kovo-fragment target="cart-badge"><cart-badge>server</cart-badge></kovo-fragment>',
          ].join('\n');
        },
      };
    });

    await submitOptimisticEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      idem: 'idem_first',
      input: { quantity: 2 },
      morph(target, html) {
        observed.push(`morph:${count.textContent}:${summary.textContent}:${html}`);
        target.replaceWithHtml(html);
      },
      optimistic,
      pendingRoot,
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
      rebaser,
      root,
      store,
    });

    expect(store.get('cart')).toEqual({ count: 7 });
    expect(count.textContent).toBe('7');
    expect(summary.textContent).toBe('7 items');
    expect(observed).toEqual(['morph:7:7 items:<cart-badge>server</cart-badge>']);
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>server</cart-badge>');
    expect(rebaser.pendingCount('cart')).toBe(1);
    expect(cartBadge.attributes).toMatchObject({
      'aria-busy': 'true',
      'kovo-pending': '',
    });
  });
});
