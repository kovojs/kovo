import { describe, expect, it, vi } from 'vitest';

import { installMutationBroadcast } from './broadcast.js';
import {
  submitOptimisticEnhancedMutation as submitOptimisticEnhancedMutationWithBuild,
  type OptimisticEnhancedMutationSubmitOptions,
} from './mutation-optimistic.js';
import { OptimisticRebaser } from './optimism.js';
import { createQueryStore } from './query-store.js';

import {
  FakeBroadcastChannel,
  FakeMorphRoot,
  FakeMorphTarget,
  FakePendingElement,
  FakePendingRoot,
  mutationTestResponse,
} from './runtime-test-fakes.js';

function submitOptimisticEnhancedMutation<Input>(
  options: Omit<OptimisticEnhancedMutationSubmitOptions<Input>, 'expectedBuildToken'> & {
    expectedBuildToken?: string;
  },
) {
  return submitOptimisticEnhancedMutationWithBuild({
    expectedBuildToken: 'build-test',
    ...options,
  });
}

describe('optimistic enhanced mutation failure handling', () => {
  it('reports fetch failures, discards predictions, and clears pending state', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const root = new FakeMorphRoot();
    const pendingRoot = new FakePendingRoot([new FakePendingElement({ 'kovo-deps': 'cart' })]);
    const onError = vi.fn();
    const error = new Error('network down');
    store.set('cart', { count: 1 });
    const fetch = vi.fn(async () => {
      const pending = [...pendingRoot.querySelectorAll('[kovo-deps]')][0];
      expect(store.get('cart')).toEqual({ count: 3 });
      expect(pending?.attributes).toMatchObject({
        'aria-busy': 'true',
        'kovo-pending': '',
      });
      throw error;
    });

    await expect(
      submitOptimisticEnhancedMutation({
        fetch,
        form: { action: '/_m/cart/add', method: 'post' },
        formData: new FormData(),
        idem: 'v1_1750000000000_00000000000000000000000000000023',
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

    const pending = [...pendingRoot.querySelectorAll('[kovo-deps]')][0];
    // SPEC.md §10.4: optimistic mutations must discard failed predictions and
    // report direct-submit failures through the mutation-layer error seam.
    expect(onError).toHaveBeenCalledWith(error);
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(rebaser.pendingCount('cart')).toBe(0);
    expect(pending?.attributes).not.toHaveProperty('kovo-pending');
    expect(pending?.attributes).not.toHaveProperty('aria-busy');
  });

  it('reports omitted optimistic server truth and preserves other pending transforms', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const root = new FakeMorphRoot();
    const cartBadge = new FakePendingElement({ 'kovo-deps': 'cart' });
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

      return mutationTestResponse('/_m/cart/add', {
        async text() {
          return '<kovo-fragment target="cart-badge"><cart-badge>stale</cart-badge></kovo-fragment>';
        },
      });
    });

    const result = await submitOptimisticEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      idem: 'v1_1750000000000_00000000000000000000000000000024',
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
      'kovo-pending': '',
    });
  });

  it('reports omitted await-fragment server truth through the missing-server-truth channel', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const root = new FakeMorphRoot();
    const productGrid = new FakePendingElement({ 'kovo-deps': 'productGrid' });
    const pendingRoot = new FakePendingRoot([productGrid]);
    const onError = vi.fn();
    root.deps = [{ id: 'product-grid' }];
    root.targets.set('product-grid', new FakeMorphTarget());
    store.set('productGrid', { products: [{ id: 'p1', stock: 2 }] });

    const result = await submitOptimisticEnhancedMutation({
      fetch: vi.fn(async () =>
        mutationTestResponse('/_m/cart/add', {
          async text() {
            return '<kovo-fragment target="product-grid"><section>stale</section></kovo-fragment>';
          },
        }),
      ),
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      idem: 'v1_1750000000000_00000000000000000000000000000025',
      input: { productId: 'p1' },
      onError,
      optimistic: {
        transforms: {
          productGrid: 'await-fragment',
        },
      },
      pendingRoot,
      rebaser,
      root,
      store,
    });

    expect(result.queries).toEqual([]);
    expect(root.targets.get('product-grid')?.html).toBe('<section>stale</section>');
    // SPEC.md §10.4: await-fragment waits for server truth; omission is a
    // visible missing-server-truth diagnostic, not a silent fragment-only pass.
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Await-fragment position for productGrid produced no server query truth after guard rerun.',
      }),
    );
    expect(store.get('productGrid')).toEqual({ products: [{ id: 'p1', stock: 2 }] });
    expect(rebaser.pendingCount('productGrid')).toBe(0);
    expect(productGrid.attributes).not.toHaveProperty('kovo-pending');
    expect(productGrid.attributes).not.toHaveProperty('aria-busy');
  });

  it('accepts await-fragment server truth without reporting a missing-truth diagnostic', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const root = new FakeMorphRoot();
    const productGrid = new FakePendingElement({ 'kovo-deps': 'productGrid' });
    const pendingRoot = new FakePendingRoot([productGrid]);
    const onError = vi.fn();
    root.deps = [{ id: 'product-grid' }];
    root.targets.set('product-grid', new FakeMorphTarget());
    store.set('productGrid', { products: [{ id: 'p1', stock: 2 }] });

    const result = await submitOptimisticEnhancedMutation({
      fetch: vi.fn(async () =>
        mutationTestResponse('/_m/cart/add', {
          async text() {
            return [
              '<kovo-query name="productGrid">{"products":[{"id":"p1","stock":1}]}</kovo-query>',
              '<kovo-fragment target="product-grid"><section>fresh</section></kovo-fragment>',
            ].join('\n');
          },
        }),
      ),
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      idem: 'v1_1750000000000_00000000000000000000000000000026',
      input: { productId: 'p1' },
      onError,
      optimistic: {
        transforms: {
          productGrid: 'await-fragment',
        },
      },
      pendingRoot,
      rebaser,
      root,
      store,
    });

    expect(result.queries).toEqual([{ name: 'productGrid' }]);
    expect(root.targets.get('product-grid')?.html).toBe('<section>fresh</section>');
    expect(onError).not.toHaveBeenCalled();
    expect(store.get('productGrid')).toEqual({ products: [{ id: 'p1', stock: 1 }] });
    expect(rebaser.pendingCount('productGrid')).toBe(0);
    expect(productGrid.attributes).not.toHaveProperty('kovo-pending');
    expect(productGrid.attributes).not.toHaveProperty('aria-busy');
  });

  it('reports malformed optimistic server query chunks while applying unrelated fragments', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const root = new FakeMorphRoot();
    const cartBadge = new FakePendingElement({ 'kovo-deps': 'cart' });
    const pendingRoot = new FakePendingRoot([cartBadge]);
    const onError = vi.fn();
    root.deps = [{ id: 'cart-badge' }];
    root.targets.set('cart-badge', new FakeMorphTarget());
    store.set('cart', { count: 0 });

    const result = await submitOptimisticEnhancedMutation({
      fetch: vi.fn(async () =>
        mutationTestResponse('/_m/cart/add', {
          async text() {
            return [
              '<kovo-query name="cart">{</kovo-query>',
              '<kovo-fragment target="cart-badge"><cart-badge>stale</cart-badge></kovo-fragment>',
            ].join('\n');
          },
        }),
      ),
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      idem: 'v1_1750000000000_00000000000000000000000000000027',
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
    expect(cartBadge.attributes).not.toHaveProperty('kovo-pending');
    expect(cartBadge.attributes).not.toHaveProperty('aria-busy');
    expect(onError).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        message: expect.stringContaining('Malformed JSON in kovo-query cart'),
      }),
    );
    expect(onError).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        message: 'Optimistic transform for cart was not covered by server query truth.',
      }),
    );
  });

  it('rolls back only the failed mutation, preserving a co-pending sibling prediction', async () => {
    // SPEC.md §10.4 line 1118: the per-query pending log rebases only the not-yet-committed
    // transforms; a single mutation failure must roll back ONLY its own transform and leave a
    // concurrent in-flight sibling's prediction (and pending-log entry) intact — not wipe the
    // whole query's pending log.
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const root = new FakeMorphRoot();
    store.set('cart', { count: 0 });
    const optimistic = {
      transforms: {
        cart(current: unknown, input: { quantity: number }) {
          const cart = current as { count: number };
          return { count: cart.count + input.quantity };
        },
      },
    };

    // m1 is a still-in-flight sibling on the same query (predicts +1 → count 1).
    rebaser.add('m1', { quantity: 1 }, optimistic);
    expect(store.get('cart')).toEqual({ count: 1 });

    // m2 predicts +5 on enqueue (→ 6), then the server rejects it (422).
    await submitOptimisticEnhancedMutation({
      fetch: vi.fn(async () =>
        mutationTestResponse('/_m/cart/add', {
          ok: false,
          status: 422,
          async text() {
            return '';
          },
        }),
      ),
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      idem: 'v1_1750000000000_00000000000000000000000000000028',
      input: { quantity: 5 },
      optimistic,
      rebaser,
      root,
      store,
    });

    // m2's prediction is rolled back; m1's +1 survives (store 1, one pending), NOT wiped to 0/0.
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(rebaser.pendingCount('cart')).toBe(1);
  });

  it('restores co-pending optimism and true absence after an interrupted progressive stream', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const root = new FakeMorphRoot();
    const encoder = new TextEncoder();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });
    const text = vi.fn(async () => {
      throw new Error('interrupted streaming submit must not buffer text()');
    });
    const reload = vi.fn();
    const locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { reload },
    });
    const idem = 'v1_1750000000000_00000000000000000000000000000032';
    const optimistic = {
      transforms: {
        cart(current: unknown, input: { quantity: number }) {
          return { count: (current as { count: number }).count + input.quantity };
        },
      },
    };
    store.set('cart', { count: 0 });
    rebaser.add('co-pending', { quantity: 1 }, optimistic);

    try {
      const submission = submitOptimisticEnhancedMutation({
        fetch: vi.fn(async () =>
          mutationTestResponse('/_m/cart/add', {
            body,
            text,
          }),
        ),
        form: {
          action: '/_m/cart/add',
          getAttribute(name: string) {
            return name === 'stream' ? '' : null;
          },
          method: 'post',
        },
        formData: new FormData(),
        idem,
        input: { quantity: 5 },
        optimistic,
        rebaser,
        root,
        store,
      });

      expect(store.get('cart')).toEqual({ count: 6 });
      streamController.enqueue(
        encoder.encode(
          `<kovo-query name="cart" settles="${idem}">{"count":100}</kovo-query>` +
            '<kovo-query name="audit">{"seen":true}</kovo-query>',
        ),
      );
      await vi.waitFor(() => {
        expect(store.get('cart')).toEqual({ count: 101 });
        expect(store.get('audit')).toEqual({ seen: true });
      });
      streamController.close();

      await expect(submission).rejects.toThrow(/without a <kovo-done> terminator/u);
      expect(text).not.toHaveBeenCalled();
      expect(reload).toHaveBeenCalledOnce();
      expect(store.get('cart')).toEqual({ count: 1 });
      expect(rebaser.pendingCount('cart')).toBe(1);
      expect(store.get('audit')).toBeUndefined();
      const auditObserver = vi.fn();
      store.subscribe('audit', auditObserver);
      expect(auditObserver).not.toHaveBeenCalled();
    } finally {
      if (locationDescriptor) {
        Object.defineProperty(globalThis, 'location', locationDescriptor);
      } else {
        delete (globalThis as { location?: unknown }).location;
      }
    }
  });

  it('discards optimistic state on enhanced mutation errors and applies the error fragment', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const channel = new FakeBroadcastChannel();
    const broadcast = installMutationBroadcast({ channel, store });
    const root = new FakeMorphRoot();
    const cartForm = new FakePendingElement({ 'kovo-deps': 'cart' });
    const pendingRoot = new FakePendingRoot([cartForm]);
    root.deps = [{ id: 'cart-form' }];
    root.targets.set('cart-form', new FakeMorphTarget());
    store.set('cart', { count: 1 });
    const text = vi.fn(
      async () => '<kovo-fragment target="cart-form"><form>Out of stock</form></kovo-fragment>',
    );
    const fetch = vi.fn(async () =>
      mutationTestResponse('/_m/cart/add', {
        body: new ReadableStream<Uint8Array>(),
        ok: false,
        status: 422,
        text,
      }),
    );

    const result = await submitOptimisticEnhancedMutation({
      fetch,
      form: {
        action: '/_m/cart/add',
        getAttribute(name: string) {
          return name === 'data-stream' ? '' : null;
        },
        method: 'post',
      },
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
    expect(text).toHaveBeenCalledOnce();
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(rebaser.pendingCount('cart')).toBe(0);
    expect(channel.messages).toEqual([]);
    expect(cartForm.attributes).not.toHaveProperty('kovo-pending');
    expect(cartForm.attributes).not.toHaveProperty('aria-busy');
    expect(root.targets.get('cart-form')?.html).toBe('<form>Out of stock</form>');
  });
});
