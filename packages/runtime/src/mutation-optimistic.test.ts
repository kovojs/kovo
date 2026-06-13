import { describe, expect, it, vi } from 'vitest';

import { installMutationBroadcast } from './broadcast.js';
import { MutationQueue } from './mutation-queue.js';
import type { EnhancedMutationFetchOptions } from './mutation-fetch.js';
import { submitOptimisticEnhancedMutation } from './mutation-optimistic.js';
import { installPagehideOptimismCleanup, OptimisticRebaser } from './optimism.js';
import { stampPendingQueries } from './pending.js';
import { createQueryStore } from './query-store.js';
import {
  FakeBroadcastChannel,
  FakeMorphRoot,
  FakeMorphTarget,
  FakePendingElement,
  FakePendingRoot,
  FakeQueryBindingElement,
  FakeQueryPlanElement,
  FakeRoot,
} from './runtime-test-fakes.js';

describe('optimistic enhanced mutation submission', () => {
  it('reports fetch failures, discards predictions, and clears pending state', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const root = new FakeMorphRoot();
    const pendingRoot = new FakePendingRoot([new FakePendingElement({ 'fw-deps': 'cart' })]);
    const onError = vi.fn();
    const error = new Error('network down');
    store.set('cart', { count: 1 });
    const fetch = vi.fn(async () => {
      const pending = [...pendingRoot.querySelectorAll('[fw-deps]')][0];
      expect(store.get('cart')).toEqual({ count: 3 });
      expect(pending?.attributes).toMatchObject({
        'aria-busy': 'true',
        'fw-pending': '',
      });
      throw error;
    });

    await expect(
      submitOptimisticEnhancedMutation({
        fetch,
        form: { action: '/_m/cart/add', method: 'post' },
        formData: new FormData(),
        idem: 'idem_failed_optimistic',
        input: { quantity: 2 },
        onError,
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
      }),
    ).rejects.toBe(error);

    const pending = [...pendingRoot.querySelectorAll('[fw-deps]')][0];
    // SPEC.md §10.4: optimistic mutations must discard failed predictions and
    // report direct-submit failures through the mutation-layer error seam.
    expect(onError).toHaveBeenCalledWith(error);
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(rebaser.pendingCount('cart')).toBe(0);
    expect(pending?.attributes).not.toHaveProperty('fw-pending');
    expect(pending?.attributes).not.toHaveProperty('aria-busy');
  });

  it('reconciles server truth and broadcasts successful enhanced responses', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const channel = new FakeBroadcastChannel();
    const broadcast = installMutationBroadcast({ channel, store });
    const root = new FakeMorphRoot();
    const cartBadge = new FakePendingElement({ 'fw-deps': 'cart' });
    const pendingRoot = new FakePendingRoot([cartBadge]);
    root.deps = [{ id: 'cart-badge' }];
    root.targets.set('cart-badge', new FakeMorphTarget());
    store.set('cart', { count: 1 });

    const fetch = vi.fn(async () => {
      expect(store.get('cart')).toEqual({ count: 3 });
      expect(cartBadge.attributes).toMatchObject({
        'aria-busy': 'true',
        'fw-pending': '',
      });

      return {
        headers: {
          get(name: string) {
            return name === 'FW-Changes'
              ? '[{"domain":"cart","input":{"productId":"p1","quantity":2}}]'
              : null;
          },
        },
        async text() {
          return [
            '<fw-query name="cart">{"count":4}</fw-query>',
            '<fw-fragment target="cart-badge"><cart-badge>4</cart-badge></fw-fragment>',
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
          '<fw-query name="cart">{"count":4}</fw-query>',
          '<fw-fragment target="cart-badge"><cart-badge>4</cart-badge></fw-fragment>',
        ].join('\n'),
        changes: [{ domain: 'cart' }],
        type: 'jiso:mutation-response',
      },
    ]);
    expect(store.get('cart')).toEqual({ count: 4 });
    expect(rebaser.pendingCount('cart')).toBe(0);
    expect(cartBadge.attributes).not.toHaveProperty('fw-pending');
    expect(cartBadge.attributes).not.toHaveProperty('aria-busy');
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>4</cart-badge>');
  });

  it('cleans up mid-flight optimistic navigation while the keepalive mutation continues', async () => {
    const lifecycleRoot = new FakeRoot();
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const root = new FakeMorphRoot();
    const cartBadge = new FakePendingElement({ 'fw-deps': 'cart' });
    const pendingRoot = new FakePendingRoot([cartBadge]);
    let releaseFetch: (() => void) | undefined;
    store.set('cart', { count: 1 });

    installPagehideOptimismCleanup({
      discardPendingOptimism() {
        const discarded = rebaser.discardPendingOptimism();
        stampPendingQueries(pendingRoot, discarded, false);
        return discarded;
      },
      root: lifecycleRoot,
    });

    const fetch = vi.fn(
      async (_url: string, options: EnhancedMutationFetchOptions) =>
        new Promise<{
          text(): Promise<string>;
        }>((resolve) => {
          expect(options.keepalive).toBe(true);
          releaseFetch = () => {
            resolve({
              async text() {
                return '<fw-query name="cart">{"count":2}</fw-query>';
              },
            });
          };
        }),
    );

    const formData = new FormData();
    formData.set('quantity', '2');
    const submit = submitOptimisticEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData,
      idem: 'idem_bfcache',
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

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(store.get('cart')).toEqual({ count: 3 });
    expect(rebaser.pendingCount('cart')).toBe(1);
    expect(cartBadge.attributes).toMatchObject({
      'aria-busy': 'true',
      'fw-pending': '',
    });

    // SPEC.md §8/§10.4: pagehide is the bfcache-safe teardown point; the
    // optimistic log dies with the document while the POST continues keepalive.
    void lifecycleRoot.listeners.get('pagehide')?.({ target: null, type: 'pagehide' });

    expect(store.get('cart')).toEqual({ count: 1 });
    expect(rebaser.pendingCount('cart')).toBe(0);
    expect(cartBadge.attributes).not.toHaveProperty('fw-pending');
    expect(cartBadge.attributes).not.toHaveProperty('aria-busy');
    expect(fetch).toHaveBeenCalledWith('/_m/cart/add', {
      body: formData,
      headers: {
        Accept: 'text/vnd.jiso.fragment+html',
        'FW-Fragment': 'true',
        'FW-Idem': 'idem_bfcache',
        'FW-Targets': '',
      },
      keepalive: true,
      method: 'POST',
    });

    releaseFetch?.();

    await expect(submit).resolves.toMatchObject({
      idem: 'idem_bfcache',
      queries: ['cart'],
    });
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(rebaser.pendingCount('cart')).toBe(0);
    expect(cartBadge.attributes).not.toHaveProperty('fw-pending');
    expect(cartBadge.attributes).not.toHaveProperty('aria-busy');
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
            '<fw-query name="reviews" key="product:p1">{"items":[{"id":"r1"},{"id":"server"}]}</fw-query>',
            '<fw-fragment target="reviews:p1"><section>Reviews ready</section></fw-fragment>',
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

  it('runs optimistic enhanced submits with the same named queue sequentially', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const queue = new MutationQueue();
    const root = new FakeMorphRoot();
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    store.set('cart', { count: 0 });

    const optimistic = {
      queue: 'cart',
      transforms: {
        cart(current: unknown, input: { quantity: number }) {
          order.push(`${input.quantity}:optimistic`);
          const cart = current as { count: number };
          return { count: cart.count + input.quantity };
        },
      },
    };
    const fetch = vi.fn(async (_url: string, options: EnhancedMutationFetchOptions) => {
      const quantityEntry = (options.body as FormData).get('quantity');
      const quantity = typeof quantityEntry === 'string' ? quantityEntry : '';
      order.push(`${quantity}:fetch`);

      if (quantity === '1') {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        order.push('1:released');
      }

      return {
        async text() {
          return `<fw-query name="cart">{"count":${quantity === '1' ? 1 : 3}}</fw-query>`;
        },
      };
    });

    const firstFormData = new FormData();
    firstFormData.set('quantity', '1');
    const secondFormData = new FormData();
    secondFormData.set('quantity', '2');

    const first = submitOptimisticEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData: firstFormData,
      idem: 'idem_first',
      input: { quantity: 1 },
      optimistic,
      queue,
      rebaser,
      root,
      store,
    });
    const second = submitOptimisticEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData: secondFormData,
      idem: 'idem_second',
      input: { quantity: 2 },
      optimistic,
      queue,
      rebaser,
      root,
      store,
    });

    await Promise.resolve();

    expect(order).toEqual(['1:optimistic', '1:fetch']);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(queue.pending('cart')).toBe(true);

    releaseFirst?.();

    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { idem: 'idem_first', queries: ['cart'] },
      { idem: 'idem_second', queries: ['cart'] },
    ]);
    expect(order).toEqual(['1:optimistic', '1:fetch', '1:released', '2:optimistic', '2:fetch']);
    expect(store.get('cart')).toEqual({ count: 3 });
    expect(queue.pending('cart')).toBe(false);
  });

  it('starts unqueued optimistic enhanced submits directly', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const root = new FakeMorphRoot();
    store.set('cart', { count: 0 });
    const fetch = vi.fn(async () => ({
      async text() {
        return '<fw-query name="cart">{"count":2}</fw-query>';
      },
    }));

    const result = submitOptimisticEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      idem: 'idem_direct',
      input: { quantity: 1 },
      optimistic: {
        queue: 'cart',
        transforms: {
          cart(current, input) {
            const cart = current as { count: number };
            return { count: cart.count + input.quantity };
          },
        },
      },
      rebaser,
      root,
      store,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.get('cart')).toEqual({ count: 1 });

    await expect(result).resolves.toMatchObject({ idem: 'idem_direct', queries: ['cart'] });
    expect(store.get('cart')).toEqual({ count: 2 });
  });

  it('rebases other pending optimism while reconciling an optimistic submit', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const root = new FakeMorphRoot();
    const cartBadge = new FakePendingElement({ 'fw-deps': 'cart' });
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
            '<fw-query name="cart">{"count":2}</fw-query>',
            '<fw-fragment target="cart-badge"><cart-badge>server</cart-badge></fw-fragment>',
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
      'fw-pending': '',
    });
  });

  it('reports omitted optimistic server truth and preserves other pending transforms', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const root = new FakeMorphRoot();
    const cartBadge = new FakePendingElement({ 'fw-deps': 'cart' });
    const pendingRoot = new FakePendingRoot([cartBadge]);
    const onError = vi.fn();
    root.deps = [{ id: 'cart-badge' }];
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
          return '<fw-fragment target="cart-badge"><cart-badge>stale</cart-badge></fw-fragment>';
        },
      };
    });

    const result = await submitOptimisticEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      idem: 'idem_first',
      input: { quantity: 2 },
      onError,
      optimistic,
      pendingRoot,
      rebaser,
      root,
      store,
    });

    expect(result.queries).toEqual([]);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Optimistic transform for cart was not covered by server query truth.',
      }),
    );
    expect(store.get('cart')).toEqual({ count: 5 });
    expect(rebaser.pendingCount('cart')).toBe(1);
    expect(cartBadge.attributes).toMatchObject({
      'aria-busy': 'true',
      'fw-pending': '',
    });
  });

  it('reports malformed optimistic server query chunks while applying unrelated fragments', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const root = new FakeMorphRoot();
    const cartBadge = new FakePendingElement({ 'fw-deps': 'cart' });
    const pendingRoot = new FakePendingRoot([cartBadge]);
    const onError = vi.fn();
    root.deps = [{ id: 'cart-badge' }];
    root.targets.set('cart-badge', new FakeMorphTarget());
    store.set('cart', { count: 0 });

    const result = await submitOptimisticEnhancedMutation({
      fetch: vi.fn(async () => ({
        async text() {
          return [
            '<fw-query name="cart">{</fw-query>',
            '<fw-fragment target="cart-badge"><cart-badge>stale</cart-badge></fw-fragment>',
          ].join('\n');
        },
      })),
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      idem: 'idem_malformed_optimistic',
      input: { quantity: 2 },
      onError,
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

    expect(result.queries).toEqual([]);
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>stale</cart-badge>');
    expect(store.get('cart')).toEqual({ count: 0 });
    expect(rebaser.pendingCount('cart')).toBe(0);
    expect(cartBadge.attributes).not.toHaveProperty('fw-pending');
    expect(cartBadge.attributes).not.toHaveProperty('aria-busy');
    expect(onError).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        message: expect.stringContaining('Malformed JSON in fw-query cart'),
      }),
    );
    expect(onError).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        message: 'Optimistic transform for cart was not covered by server query truth.',
      }),
    );
  });

  it('discards optimistic state on enhanced mutation errors and applies the error fragment', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const channel = new FakeBroadcastChannel();
    const broadcast = installMutationBroadcast({ channel, store });
    const root = new FakeMorphRoot();
    const cartForm = new FakePendingElement({ 'fw-deps': 'cart' });
    const pendingRoot = new FakePendingRoot([cartForm]);
    root.deps = [{ id: 'cart-form' }];
    root.targets.set('cart-form', new FakeMorphTarget());
    store.set('cart', { count: 1 });
    const fetch = vi.fn(async () => ({
      ok: false,
      status: 422,
      async text() {
        return '<fw-fragment target="cart-form"><form>Out of stock</form></fw-fragment>';
      },
    }));

    const result = await submitOptimisticEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      broadcast,
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

    expect(result.appliedFragments).toEqual(['cart-form']);
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(rebaser.pendingCount('cart')).toBe(0);
    expect(channel.messages).toEqual([]);
    expect(cartForm.attributes).not.toHaveProperty('fw-pending');
    expect(cartForm.attributes).not.toHaveProperty('aria-busy');
    expect(root.targets.get('cart-form')?.html).toBe('<form>Out of stock</form>');
  });
});
