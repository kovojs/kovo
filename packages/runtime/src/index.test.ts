import { describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { event, form } from '@jiso/core';

import {
  applyDeferredChunk,
  applyDeferredChunkToDom,
  applyFragments,
  applyOptimisticTransforms,
  applyMutationResponseToDom,
  applyMutationResponse,
  createEventBus,
  createQueryStore,
  createSubmitContext,
  dispatchDelegatedEvent,
  hydrateQueryScripts,
  installMutationBroadcast,
  installPagehideOptimismCleanup,
  installJisoLoader,
  jisoLoaderSource,
  MutationQueue,
  morphStructuralTree,
  OptimisticRebaser,
  parseHandlerReference,
  readElementParams,
  readElementState,
  stampPendingQueries,
  submitEnhancedMutation,
  submitOptimisticEnhancedMutation,
  type DelegatedEvent,
  type EnhancedMutationFetchOptions,
  type EventElementLike,
  type OptimisticFor,
  type StructuralMorphNode,
} from './index.js';

class FakeRoot {
  listeners = new Map<string, (event: DelegatedEvent) => void | Promise<void>>();
  scripts: QueryScript[] = [];
  visibilityState: 'hidden' | 'visible' = 'visible';

  addEventListener(type: string, listener: (event: DelegatedEvent) => void | Promise<void>): void {
    this.listeners.set(type, listener);
  }

  querySelectorAll(selector: string): Iterable<QueryScript> {
    return selector === 'script[fw-query]' ? this.scripts : [];
  }
}

interface QueryScript {
  getAttribute(name: string): string | null;
  textContent: string | null;
}

class FakeElement implements EventElementLike {
  attributes: { name: string; value: string }[];

  constructor(attributes: Record<string, string>) {
    this.attributes = Object.entries(attributes).map(([name, value]) => ({ name, value }));
  }

  closest(_selector: string): FakeElement {
    return this;
  }

  getAttribute(name: string): string | null {
    return this.attributes.find((attribute) => attribute.name === name)?.value ?? null;
  }

  setAttribute(name: string, value: string): void {
    const existing = this.attributes.find((attribute) => attribute.name === name);
    if (existing) {
      existing.value = value;
      return;
    }

    this.attributes.push({ name, value });
  }
}

class FakeFormElement extends FakeElement {
  action: string;
  method: string | undefined;

  constructor(attributes: Record<string, string>, options: { action: string; method?: string }) {
    super(attributes);
    this.action = options.action;
    this.method = options.method;
  }
}

class FakeBroadcastChannel {
  messages: unknown[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;

  postMessage(message: unknown): void {
    this.messages.push(message);
  }
}

class FakeMorphTarget {
  html: string;

  constructor(html = '') {
    this.html = html;
  }

  replaceWithHtml(html: string): void {
    this.html = html;
  }

  appendHtml(html: string): void {
    this.html += html;
  }

  readHtml(): string {
    return this.html;
  }
}

class FakeMorphRoot {
  deps: { deps?: string; id?: string; target?: string }[] = [];
  targets = new Map<string, FakeMorphTarget>();

  findFragmentTarget(target: string): FakeMorphTarget | null {
    return this.targets.get(target) ?? null;
  }

  querySelectorAll(_selector: string): Iterable<{
    getAttribute(name: string): string | null;
    id?: string;
  }> {
    return this.deps.map((dep) => ({
      getAttribute: (name) => {
        if (name === 'fw-fragment-target') return dep.target ?? null;
        if (name === 'fw-deps') return dep.deps ?? null;
        return null;
      },
      ...(dep.id ? { id: dep.id } : {}),
    }));
  }
}

class FakePendingElement {
  attributes: Record<string, string>;

  constructor(attributes: Record<string, string>) {
    this.attributes = { ...attributes };
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  removeAttribute(name: string): void {
    delete this.attributes[name];
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
}

class FakePendingRoot {
  constructor(readonly elements: FakePendingElement[]) {}

  querySelectorAll(_selector: string): Iterable<FakePendingElement> {
    return this.elements;
  }
}

function keyedListRow(key: string, text: string): StructuralMorphNode {
  return {
    key,
    props: { 'data-row': key },
    text,
    type: 'li',
  };
}

describe('runtime loader', () => {
  it('keeps the always-loaded bootstrap under the S2 gzip budget', () => {
    expect(gzipSync(jisoLoaderSource).byteLength).toBeLessThanOrEqual(1024);
    expect(jisoLoaderSource).toContain('import(r.slice(0,i))');
    expect(jisoLoaderSource).not.toContain('customElements');
    expect(jisoLoaderSource).not.toContain('unload');
  });

  it('registers delegated capture listeners without importing handler modules', () => {
    const root = new FakeRoot();
    const importModule = vi.fn();

    const loader = installJisoLoader({ importModule, root });

    expect(loader.events).toEqual(['click', 'submit', 'input', 'change']);
    expect([...root.listeners.keys()]).toEqual(['click', 'submit', 'input', 'change']);
    expect(importModule).not.toHaveBeenCalled();
  });

  it('hydrates initial fw-query scripts into the configured query store', () => {
    const root = new FakeRoot();
    const store = createQueryStore();
    const plan = vi.fn();
    root.scripts = [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
        textContent: '{"count":2}',
      },
    ];
    store.subscribe('cart', plan);

    installJisoLoader({ importModule: vi.fn(), queryStore: store, root });

    expect(store.get('cart')).toEqual({ count: 2 });
    expect(plan).toHaveBeenCalledWith({ count: 2 });
  });

  it('intercepts enhanced form submits through the loader bridge', async () => {
    const loaderRoot = new FakeRoot();
    const mutationRoot = new FakeMorphRoot();
    const store = createQueryStore();
    const preventDefault = vi.fn();
    const importModule = vi.fn();
    const formData = new FormData();
    const form = new FakeFormElement(
      {
        enhance: '',
        'data-mutation': 'cart/add',
      },
      {
        action: '/_m/cart/add',
        method: 'post',
      },
    );
    mutationRoot.deps = [{ deps: 'cart', id: 'cart-badge' }];
    mutationRoot.targets.set('cart-badge', new FakeMorphTarget());
    formData.set('productId', 'p1');
    const fetch = vi.fn(async () => ({
      headers: {
        get(name: string) {
          return name === 'FW-Changes' ? '[{"domain":"cart","input":{"productId":"p1"}}]' : null;
        },
      },
      async text() {
        return [
          '<fw-query name="cart">{"count":1}</fw-query>',
          '<fw-fragment target="cart-badge"><cart-badge>1</cart-badge></fw-fragment>',
        ].join('\n');
      },
    }));

    installJisoLoader({
      enhancedMutations: {
        fetch,
        formData: () => formData,
        idem: () => 'idem_loader',
        root: mutationRoot,
        store,
      },
      importModule,
      root: loaderRoot,
    });

    await loaderRoot.listeners.get('submit')?.({
      preventDefault,
      target: form,
      type: 'submit',
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(importModule).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith('/_m/cart/add', {
      body: formData,
      headers: {
        Accept: 'text/vnd.jiso.fragment+html',
        'FW-Fragment': 'true',
        'FW-Idem': 'idem_loader',
        'FW-Targets': 'cart-badge=cart',
      },
      keepalive: true,
      method: 'POST',
    });
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(mutationRoot.targets.get('cart-badge')?.html).toBe('<cart-badge>1</cart-badge>');
  });

  it('imports and invokes a url#export handler only when a matching event arrives', async () => {
    const handler = vi.fn();
    const importModule = vi.fn(async () => ({ CartBadge$button_click: handler }));
    const element = new FakeElement({
      'data-p-item-id': 'i_42',
      'on:click': '/c/cart-badge.client.js#CartBadge$button_click',
    });

    await dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);

    expect(importModule).toHaveBeenCalledWith('/c/cart-badge.client.js');
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'click' }),
      expect.objectContaining({ params: { itemId: 'i_42' } }),
    );
  });

  it('hydrates serialized island state for delegated handlers', async () => {
    const handler = vi.fn();
    const importModule = vi.fn(async () => ({ CartBadge$button_click: handler }));
    const element = new FakeElement({
      'fw-state': '{"bouncing":false,"count":2}',
      'on:click': '/c/cart-badge.client.js#CartBadge$button_click',
    });

    await dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'click' }),
      expect.objectContaining({ state: { bouncing: false, count: 2 } }),
    );
  });

  it('persists handler state mutations back to the island host', async () => {
    const handler = vi.fn((_event, ctx: { state: { count: number } }) => {
      ctx.state.count += 1;
    });
    const importModule = vi.fn(async () => ({ Counter$button_click: handler }));
    const element = new FakeElement({
      'fw-state': '{"count":2}',
      'on:click': '/c/counter.client.js#Counter$button_click',
    });

    await dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);

    expect(element.getAttribute('fw-state')).toBe('{"count":3}');
  });

  it('defaults missing or malformed serialized state to an empty object', () => {
    expect(readElementState(new FakeElement({}))).toEqual({});
    expect(readElementState(new FakeElement({ 'fw-state': '{' }))).toEqual({});
  });

  it('parses full handler references and data params', () => {
    expect(parseHandlerReference('/c/cart.client.js?v=1#Cart$remove')).toEqual({
      exportName: 'Cart$remove',
      url: '/c/cart.client.js?v=1',
    });
    expect(readElementParams(new FakeElement({ 'data-p-product-id': 'p1' }))).toEqual({
      productId: 'p1',
    });
  });
});

describe('typed event bus', () => {
  it('emits declared cross-island events with typed payloads', () => {
    const cartAdded = event<'cart:added', { productId: string; quantity: number }>('cart:added');
    const bus = createEventBus([cartAdded] as const);
    const listener = vi.fn();

    bus.on('cart:added', listener);
    bus.emit('cart:added', { productId: 'p1', quantity: 2 });

    expect(bus.events).toEqual(['cart:added']);
    expect(listener).toHaveBeenCalledWith({
      name: 'cart:added',
      payload: { productId: 'p1', quantity: 2 },
    });
  });

  it('unsubscribes typed event listeners', () => {
    const bus = createEventBus([event<'cart:added', { productId: string }>('cart:added')] as const);
    const listener = vi.fn();

    const subscription = bus.on('cart:added', listener);
    subscription.off();
    bus.emit('cart:added', { productId: 'p1' });

    expect(listener).not.toHaveBeenCalled();
  });

  it('rejects events that were not declared in the registry', () => {
    const bus = createEventBus([event<'cart:added', { productId: string }>('cart:added')] as const);

    expect(() => bus.emit('inventory:changed' as never, { sku: 'sku_1' } as never)).toThrow(
      'Event is not declared in the registry: inventory:changed',
    );
    expect(() => bus.on('inventory:changed' as never, vi.fn())).toThrow(
      'Event is not declared in the registry: inventory:changed',
    );
  });

  it('rejects event payloads that carry query data facts', () => {
    const cartAdded = event<'cart:added', { productId: string; quantity: number }>('cart:added', {
      serverFactKeys: ['productId'],
    });
    const bus = createEventBus([cartAdded] as const, { queryDataKeys: ['productId'] });

    expect(() => bus.emit('cart:added', { productId: 'p1', quantity: 2 })).toThrow(
      'Event payload overlaps query data; use a transform. event cart:added carries productId.',
    );
  });

  it('rejects undeclared actual payload keys that overlap query data', () => {
    const bus = createEventBus(
      [event<'cart:added', { productId: string; quantity: number }>('cart:added')] as const,
      { queryDataKeys: ['productId'] },
    );

    expect(() => bus.emit('cart:added', { productId: 'p1', quantity: 2 })).toThrow(
      'Event payload overlaps query data; use a transform. event cart:added carries productId.',
    );
  });
});

describe('query store', () => {
  it('hydrates fw-query scripts and immediately runs subscribed update plans', () => {
    const store = createQueryStore();
    const plan = vi.fn();

    store.subscribe('cart', plan);
    hydrateQueryScripts(store, [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
        textContent: '{"count":2}',
      },
    ]);

    expect(store.get('cart')).toEqual({ count: 2 });
    expect(plan).toHaveBeenCalledWith({ count: 2 });
  });

  it('runs update plans whenever a query value changes', () => {
    const store = createQueryStore();
    const plan = vi.fn();

    const unsubscribe = store.subscribe<{ count: number }>('cart', plan);
    store.set('cart', { count: 1 });
    unsubscribe();
    store.set('cart', { count: 2 });

    expect(plan).toHaveBeenCalledTimes(1);
    expect(plan).toHaveBeenCalledWith({ count: 1 });
  });

  it('registers refetch-on-focus and visible-return listeners without invoking them eagerly', async () => {
    const root = new FakeRoot();
    const refetchOnFocus = vi.fn();

    installJisoLoader({
      importModule: vi.fn(),
      refetchOnFocus,
      root,
    });

    expect(root.listeners.has('visibilitychange')).toBe(true);
    expect(root.listeners.has('focus')).toBe(true);
    expect(refetchOnFocus).not.toHaveBeenCalled();

    root.visibilityState = 'hidden';
    await root.listeners.get('visibilitychange')?.({ target: null, type: 'visibilitychange' });

    expect(refetchOnFocus).not.toHaveBeenCalled();

    root.visibilityState = 'visible';
    await root.listeners.get('visibilitychange')?.({ target: null, type: 'visibilitychange' });

    expect(refetchOnFocus).toHaveBeenCalledTimes(1);

    await root.listeners.get('focus')?.({ target: null, type: 'focus' });

    expect(refetchOnFocus).toHaveBeenCalledTimes(2);
  });

  it('passes hydrated query names to refetch-on-focus with per-query opt-out', async () => {
    const root = new FakeRoot();
    const store = createQueryStore();
    const refetchOnFocus = vi.fn();
    root.scripts = [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
        textContent: '{"count":1}',
      },
      {
        getAttribute: (name) => (name === 'fw-query' ? 'inventory' : null),
        textContent: '{"sku":"sku_1","available":true}',
      },
      {
        getAttribute: (name) => (name === 'fw-query' ? 'analytics' : null),
        textContent: '{"sampled":true}',
      },
      {
        getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
        textContent: '{"count":1}',
      },
    ];

    installJisoLoader({
      importModule: vi.fn(),
      queryStore: store,
      refetchOnFocus,
      refetchOnFocusOptOut: ['analytics'],
      root,
    });

    root.visibilityState = 'hidden';
    await root.listeners.get('visibilitychange')?.({ target: null, type: 'visibilitychange' });

    expect(refetchOnFocus).not.toHaveBeenCalled();

    root.visibilityState = 'visible';
    await root.listeners.get('visibilitychange')?.({ target: null, type: 'visibilitychange' });
    await root.listeners.get('focus')?.({ target: null, type: 'focus' });

    expect(refetchOnFocus).toHaveBeenNthCalledWith(1, ['cart', 'inventory']);
    expect(refetchOnFocus).toHaveBeenNthCalledWith(2, ['cart', 'inventory']);
  });

  it('registers pagehide optimism cleanup without unload handlers', () => {
    const root = new FakeRoot();
    const discardPendingOptimism = vi.fn();

    installPagehideOptimismCleanup({ discardPendingOptimism, root });

    expect(root.listeners.has('pagehide')).toBe(true);
    expect(root.listeners.has('unload')).toBe(false);

    void root.listeners.get('pagehide')?.({ target: null, type: 'pagehide' });

    expect(discardPendingOptimism).toHaveBeenCalledTimes(1);
  });

  it('applies mutation response query chunks and returns fragment chunks for morphing', () => {
    const store = createQueryStore();
    const plan = vi.fn();

    store.subscribe('cart', plan);
    const applied = applyMutationResponse(
      store,
      [
        '<fw-query name="cart">{"count":3}</fw-query>',
        '<fw-fragment target="cart-badge"><cart-badge>3</cart-badge></fw-fragment>',
      ].join('\n'),
    );

    expect(store.get('cart')).toEqual({ count: 3 });
    expect(plan).toHaveBeenCalledWith({ count: 3 });
    expect(applied).toEqual({
      fragments: [{ html: '<cart-badge>3</cart-badge>', target: 'cart-badge' }],
      queries: ['cart'],
    });
  });

  it('accepts escaped JSON from text/html-compatible fw-query chunks', () => {
    const store = createQueryStore();

    applyMutationResponse(store, '<fw-query name="cart">{&quot;count&quot;:4}</fw-query>');

    expect(store.get('cart')).toEqual({ count: 4 });
  });

  it('applies deferred stream chunks through the same query and fragment parser', () => {
    const store = createQueryStore();
    const plan = vi.fn();
    store.subscribe('reviews', plan);

    const applied = applyDeferredChunk(
      store,
      [
        '<fw-query name="reviews" key="product:p1">{"items":[{"id":"r1","rating":5}]}</fw-query>',
        '<fw-fragment target="reviews:p1"><section fw-c="reviews">Ready</section></fw-fragment>',
      ].join('\n'),
    );

    expect(store.get('reviews')).toEqual({ items: [{ id: 'r1', rating: 5 }] });
    expect(plan).toHaveBeenCalledWith({ items: [{ id: 'r1', rating: 5 }] });
    expect(applied).toEqual({
      fragments: [{ html: '<section fw-c="reviews">Ready</section>', target: 'reviews:p1' }],
      queries: ['reviews'],
    });
  });

  it('updates deferred query data before morphing deferred fragments', () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const observed: string[] = [];
    root.targets.set('reviews:p1', new FakeMorphTarget());
    store.subscribe('reviews', (value) => {
      observed.push(`plan:${JSON.stringify(value)}`);
    });

    const result = applyDeferredChunkToDom({
      body: [
        '<fw-query name="reviews">{"items":[{"id":"r1"}]}</fw-query>',
        '<fw-fragment target="reviews:p1"><link rel="stylesheet" href="/assets/reviews.css"><section>Ready</section></fw-fragment>',
      ].join('\n'),
      morph(target, html) {
        observed.push(`morph:${JSON.stringify(store.get('reviews'))}`);
        target.replaceWithHtml(html);
      },
      root,
      store,
    });

    expect(observed).toEqual(['plan:{"items":[{"id":"r1"}]}', 'morph:{"items":[{"id":"r1"}]}']);
    expect(result).toEqual({
      appliedFragments: ['reviews:p1'],
      fragments: [
        {
          html: '<link rel="stylesheet" href="/assets/reviews.css"><section>Ready</section>',
          target: 'reviews:p1',
        },
      ],
      queries: ['reviews'],
    });
    expect(root.targets.get('reviews:p1')?.html).toContain('/assets/reviews.css');
  });

  it('rebroadcasts and applies mutation responses for same-user tab sync', () => {
    const store = createQueryStore();
    const channel = new FakeBroadcastChannel();
    const onChanges = vi.fn();
    const broadcast = installMutationBroadcast({ channel, onChanges, store });

    broadcast.publish('<fw-query name="cart">{"count":5}</fw-query>', [
      { domain: 'cart', input: { productId: 'p1' } },
    ]);
    expect(channel.messages).toEqual([
      {
        body: '<fw-query name="cart">{"count":5}</fw-query>',
        changes: [{ domain: 'cart', input: { productId: 'p1' } }],
        type: 'jiso:mutation-response',
      },
    ]);

    channel.onmessage?.({
      data: {
        body: '<fw-query name="cart">{"count":6}</fw-query>',
        changes: [{ domain: 'cart', keys: ['cart_1'] }],
        type: 'jiso:mutation-response',
      },
    });

    expect(store.get('cart')).toEqual({ count: 6 });
    expect(onChanges).toHaveBeenCalledWith([{ domain: 'cart', keys: ['cart_1'] }]);
  });

  it('morphs rebroadcast mutation fragments when a root is configured', () => {
    const store = createQueryStore();
    const channel = new FakeBroadcastChannel();
    const root = new FakeMorphRoot();
    root.targets.set('cart-badge', new FakeMorphTarget('<cart-badge>0</cart-badge>'));

    installMutationBroadcast({ channel, root, store });

    channel.onmessage?.({
      data: {
        body: [
          '<fw-query name="cart">{"count":6}</fw-query>',
          '<fw-fragment target="cart-badge"><cart-badge>6</cart-badge></fw-fragment>',
        ].join('\n'),
        changes: [],
        type: 'jiso:mutation-response',
      },
    });

    expect(store.get('cart')).toEqual({ count: 6 });
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>6</cart-badge>');
  });

  it('applies hand-written optimistic transforms through query update plans', () => {
    const store = createQueryStore();
    const plan = vi.fn();
    store.set('cart', { count: 1 });
    store.subscribe('cart', plan);

    const pending = applyOptimisticTransforms(
      store,
      { quantity: 2 },
      {
        transforms: {
          cart(current, input) {
            const cart = current as { count: number };
            return { count: cart.count + input.quantity };
          },
        },
      },
    );

    expect(store.get('cart')).toEqual({ count: 3 });
    expect(plan).toHaveBeenLastCalledWith({ count: 3 });
    pending.commit();
    expect(pending.snapshot.size).toBe(0);
  });

  it('types hand-written optimistic plans from mutation forms and query shapes', () => {
    const addToCart = form<'cart/add', { productId: string; quantity: number }>('cart/add');
    const optimistic = {
      queue: 'cart',
      transforms: {
        cart(current, input) {
          return {
            count: current.count + input.quantity,
            productIds: [...current.productIds, input.productId],
          };
        },
      },
    } satisfies OptimisticFor<typeof addToCart, { cart: { count: number; productIds: string[] } }>;

    expect(
      optimistic.transforms.cart(
        { count: 1, productIds: [] },
        {
          productId: 'p1',
          quantity: 2,
        },
      ),
    ).toEqual({
      count: 3,
      productIds: ['p1'],
    });
  });

  it('rejects optimistic plans that do not match mutation input or query values', () => {
    const addToCart = form<'cart/add', { productId: string; quantity: number }>('cart/add');
    const assertWrongInputRejected = () => {
      ({
        transforms: {
          cart(current, input) {
            return {
              // @ts-expect-error sku is not part of the mutation input schema.
              count: current.count + input.sku,
            };
          },
        },
      }) satisfies OptimisticFor<typeof addToCart, { cart: { count: number } }>;
    };
    const assertWrongQueryValueRejected = () => {
      ({
        transforms: {
          cart(current, input) {
            return {
              // @ts-expect-error missingCount is not part of the cart query value.
              count: current.missingCount + input.quantity,
            };
          },
        },
      }) satisfies OptimisticFor<typeof addToCart, { cart: { count: number } }>;
    };

    expect(assertWrongInputRejected).toBeTypeOf('function');
    expect(assertWrongQueryValueRejected).toBeTypeOf('function');
  });

  it('restores optimistic snapshots on mutation error', () => {
    const store = createQueryStore();
    store.set('cart', { count: 1 });

    const pending = applyOptimisticTransforms(
      store,
      { quantity: 2 },
      {
        transforms: {
          cart(current, input) {
            const cart = current as { count: number };
            return { count: cart.count + input.quantity };
          },
        },
      },
    );

    expect(store.get('cart')).toEqual({ count: 3 });
    pending.restore();
    expect(store.get('cart')).toEqual({ count: 1 });
  });

  it('stamps and clears pending state on islands consuming optimistic queries', () => {
    const cartBadge = new FakePendingElement({ 'fw-deps': 'cart' });
    const recommendations = new FakePendingElement({ 'fw-deps': 'product:p1 cart' });
    const profile = new FakePendingElement({ 'fw-deps': 'profile' });
    const root = new FakePendingRoot([cartBadge, recommendations, profile]);

    expect(stampPendingQueries(root, ['cart'], true)).toEqual(['cart', 'product:p1,cart']);
    expect(cartBadge.attributes).toMatchObject({
      'aria-busy': 'true',
      'fw-pending': '',
    });
    expect(recommendations.attributes).toMatchObject({
      'aria-busy': 'true',
      'fw-pending': '',
    });
    expect(profile.attributes).not.toHaveProperty('fw-pending');

    expect(stampPendingQueries(root, ['cart'], false)).toEqual(['cart', 'product:p1,cart']);
    expect(cartBadge.attributes).not.toHaveProperty('fw-pending');
    expect(cartBadge.attributes).not.toHaveProperty('aria-busy');
    expect(recommendations.attributes).not.toHaveProperty('fw-pending');
    expect(recommendations.attributes).not.toHaveProperty('aria-busy');
  });

  it('rebases pending optimistic transforms over arriving server truth', () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    store.set('cart', { count: 0 });
    const transform = (current: unknown, input: { quantity: number }) => {
      const cart = current as { count: number };
      return { count: cart.count + input.quantity };
    };

    rebaser.add('m1', { quantity: 1 }, { transforms: { cart: transform } });
    rebaser.add('m2', { quantity: 2 }, { transforms: { cart: transform } });

    expect(store.get('cart')).toEqual({ count: 3 });
    expect(rebaser.pendingCount('cart')).toBe(2);

    rebaser.applyServerTruth('cart', { count: 10 });

    expect(store.get('cart')).toEqual({ count: 13 });

    rebaser.settle('m1');
    rebaser.applyServerTruth('cart', { count: 11 });

    expect(store.get('cart')).toEqual({ count: 13 });
    expect(rebaser.pendingCount('cart')).toBe(1);
  });

  it('discards pending optimistic transforms back to server truth on pagehide', () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    store.set('cart', { count: 0 });
    const transform = (current: unknown, input: { quantity: number }) => {
      const cart = current as { count: number };
      return { count: cart.count + input.quantity };
    };

    rebaser.add('m1', { quantity: 1 }, { transforms: { cart: transform } });
    rebaser.add('m2', { quantity: 2 }, { transforms: { cart: transform } });
    rebaser.applyServerTruth('cart', { count: 10 });

    expect(store.get('cart')).toEqual({ count: 13 });

    expect(rebaser.discardPendingOptimism()).toEqual(['cart']);

    expect(store.get('cart')).toEqual({ count: 10 });
    expect(rebaser.pendingCount('cart')).toBe(0);
  });

  it('serializes named mutation queues without blocking unrelated queues', async () => {
    const queue = new MutationQueue();
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;

    const first = queue.run('cart', async () => {
      order.push('cart:first:start');
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      order.push('cart:first:end');
      return 'first';
    });
    const second = queue.run('cart', () => {
      order.push('cart:second');
      return 'second';
    });
    const inventory = queue.run('inventory', () => {
      order.push('inventory');
      return 'inventory';
    });

    await Promise.resolve();

    expect(order).toEqual(['cart:first:start', 'inventory']);
    expect(queue.pending('cart')).toBe(true);
    await expect(inventory).resolves.toBe('inventory');
    expect(queue.pending('inventory')).toBe(false);

    releaseFirst?.();

    await expect(Promise.all([first, second, inventory])).resolves.toEqual([
      'first',
      'second',
      'inventory',
    ]);
    expect(order).toEqual(['cart:first:start', 'inventory', 'cart:first:end', 'cart:second']);
    expect(queue.pending('cart')).toBe(false);
  });

  it('continues a named mutation queue after a failed task', async () => {
    const queue = new MutationQueue();
    const order: string[] = [];

    const failed = queue.run('cart', async () => {
      order.push('failed');
      throw new Error('nope');
    });
    const next = queue.run('cart', () => {
      order.push('next');
      return 'next';
    });

    await expect(failed).rejects.toThrow('nope');
    await expect(next).resolves.toBe('next');
    expect(order).toEqual(['failed', 'next']);
    expect(queue.pending('cart')).toBe(false);
  });

  it('applies fragment chunks through the morph adapter', () => {
    const root = new FakeMorphRoot();
    root.targets.set('cart-badge', new FakeMorphTarget('<cart-badge>old</cart-badge>'));

    expect(
      applyFragments(root, [
        { html: '<cart-badge>new</cart-badge>', target: 'cart-badge' },
        { html: '<aside>ignored</aside>', target: 'missing' },
      ]),
    ).toEqual(['cart-badge']);
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>new</cart-badge>');
  });

  it('appends fragment chunks when the wire mode is append', () => {
    const root = new FakeMorphRoot();
    root.targets.set('product-grid', new FakeMorphTarget('<article data-key="p1"></article>'));
    const store = createQueryStore();

    const result = applyMutationResponseToDom({
      body: '<fw-fragment target="product-grid" mode="append"><article data-key="p2"></article></fw-fragment>',
      root,
      store,
    });

    expect(result.fragments).toEqual([
      {
        html: '<article data-key="p2"></article>',
        mode: 'append',
        target: 'product-grid',
      },
    ]);
    expect(result.appliedFragments).toEqual(['product-grid']);
    expect(root.targets.get('product-grid')?.html).toBe(
      '<article data-key="p1"></article><article data-key="p2"></article>',
    );
  });

  it('morphs a structural tree to the next tree shape without DOM APIs', () => {
    const current: StructuralMorphNode = {
      children: [
        { key: 'total', text: 'Cart total: $4', type: 'span' },
        { text: 'stale helper', type: 'small' },
      ],
      props: { role: 'status' },
      type: 'cart-badge',
    };
    const next: StructuralMorphNode = {
      children: [
        {
          key: 'total',
          props: { 'data-bind': 'cart.total' },
          text: 'Cart total: $7',
          type: 'span',
        },
        { key: 'count', text: '2 items', type: 'strong' },
      ],
      props: { role: 'status', 'aria-live': 'polite' },
      type: 'cart-badge',
    };

    const result = morphStructuralTree(current, next);

    expect(result).toBe(current);
    expect(result).toEqual(next);
    expect(result.children?.[1]).not.toBe(next.children?.[1]);
  });

  it('preserves keyed structural node identity when sibling order changes', () => {
    const first: StructuralMorphNode = {
      children: [{ text: '$4', type: 'span' }],
      key: 'line:1',
      props: { 'data-id': 'line:1' },
      text: 'Coffee',
      type: 'li',
    };
    const second: StructuralMorphNode = {
      children: [{ text: '$3', type: 'span' }],
      key: 'line:2',
      props: { 'data-id': 'line:2' },
      text: 'Tea',
      type: 'li',
    };
    const current: StructuralMorphNode = {
      children: [first, second],
      type: 'ul',
    };
    const next: StructuralMorphNode = {
      children: [
        {
          children: [{ text: '$5', type: 'span' }],
          key: 'line:2',
          props: { 'data-id': 'line:2', 'data-selected': 'true' },
          text: 'Tea',
          type: 'li',
        },
        {
          children: [{ text: '$4', type: 'span' }],
          key: 'line:1',
          props: { 'data-id': 'line:1' },
          text: 'Coffee',
          type: 'li',
        },
      ],
      type: 'ul',
    };

    const result = morphStructuralTree(current, next);

    expect(result).toEqual(next);
    expect(result.children?.[0]).toBe(second);
    expect(result.children?.[1]).toBe(first);
  });

  it('preserves keyed browser state across fragment morphs and reorders', () => {
    const input: StructuralMorphNode = {
      browserState: {
        focused: true,
        islandState: { draftQuantity: 2 },
        scroll: { left: 4, top: 24 },
        selection: { direction: 'forward', end: 3, start: 1 },
      },
      key: 'line:input',
      props: { name: 'quantity' },
      text: '2',
      type: 'input',
    };
    const current: StructuralMorphNode = {
      children: [{ key: 'line:label', text: 'Quantity', type: 'label' }, input],
      type: 'form',
    };
    const next: StructuralMorphNode = {
      children: [
        {
          key: 'line:input',
          props: { name: 'quantity', value: '3' },
          text: '3',
          type: 'input',
        },
        { key: 'line:label', text: 'Updated quantity', type: 'label' },
      ],
      type: 'form',
    };

    const result = morphStructuralTree(current, next);

    expect(result.children?.[0]).toBe(input);
    expect(result.children?.[0]?.browserState).toEqual({
      focused: true,
      islandState: { draftQuantity: 2 },
      scroll: { left: 4, top: 24 },
      selection: { direction: 'forward', end: 3, start: 1 },
    });
    expect(result.children?.[0]).toMatchObject({
      props: { name: 'quantity', value: '3' },
      text: '3',
    });
  });

  it('clones browser state for newly inserted structural nodes', () => {
    const current: StructuralMorphNode = { children: [], type: 'form' };
    const nextChild: StructuralMorphNode = {
      browserState: { scroll: { left: 0, top: 10 } },
      key: 'new-panel',
      text: 'New',
      type: 'section',
    };

    const result = morphStructuralTree(current, {
      children: [nextChild],
      type: 'form',
    });

    expect(result.children?.[0]).not.toBe(nextChild);
    expect(result.children?.[0]?.browserState).toEqual({ scroll: { left: 0, top: 10 } });
    expect(result.children?.[0]?.browserState).not.toBe(nextChild.browserState);
  });

  it('preserves keyed list identity across append fragments and later reorders', () => {
    const first = keyedListRow('product:1', 'Coffee');
    const second = keyedListRow('product:2', 'Tea');
    const current: StructuralMorphNode = {
      children: [first, second],
      type: 'ul',
    };
    const appended: StructuralMorphNode = {
      children: [
        keyedListRow('product:1', 'Coffee'),
        keyedListRow('product:2', 'Tea'),
        keyedListRow('product:3', 'Milk'),
        keyedListRow('product:4', 'Honey'),
      ],
      type: 'ul',
    };

    const appendResult = morphStructuralTree(current, appended);
    const third = appendResult.children?.[2];
    const fourth = appendResult.children?.[3];

    expect(appendResult.children).toEqual(appended.children);
    expect(appendResult.children?.[0]).toBe(first);
    expect(appendResult.children?.[1]).toBe(second);
    expect(third).not.toBe(appended.children?.[2]);
    expect(fourth).not.toBe(appended.children?.[3]);

    const reordered: StructuralMorphNode = {
      children: [
        keyedListRow('product:2', 'Tea'),
        keyedListRow('product:4', 'Honey'),
        keyedListRow('product:5', 'Jam'),
        keyedListRow('product:1', 'Coffee'),
        keyedListRow('product:3', 'Milk'),
      ],
      type: 'ul',
    };

    const reorderResult = morphStructuralTree(appendResult, reordered);

    expect(reorderResult.children).toEqual(reordered.children);
    expect(reorderResult.children?.[0]).toBe(second);
    expect(reorderResult.children?.[1]).toBe(fourth);
    expect(reorderResult.children?.[2]).not.toBe(reordered.children?.[2]);
    expect(reorderResult.children?.[3]).toBe(first);
    expect(reorderResult.children?.[4]).toBe(third);
  });

  it('updates query data and morphs fragments from one mutation response', () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    root.targets.set('cart-badge', new FakeMorphTarget());

    const result = applyMutationResponseToDom({
      body: [
        '<fw-query name="cart">{"count":7}</fw-query>',
        '<fw-fragment target="cart-badge"><cart-badge><span data-bind="cart.count">7</span></cart-badge></fw-fragment>',
      ].join('\n'),
      root,
      store,
    });

    expect(result).toEqual({
      appliedFragments: ['cart-badge'],
      fragments: [
        {
          html: '<cart-badge><span data-bind="cart.count">7</span></cart-badge>',
          target: 'cart-badge',
        },
      ],
      queries: ['cart'],
    });
    expect(store.get('cart')).toEqual({ count: 7 });
    expect(root.targets.get('cart-badge')?.html).toContain('data-bind="cart.count"');
  });

  it('submits enhanced mutation forms with live targets and applies the fragment response', async () => {
    const store = createQueryStore();
    const channel = new FakeBroadcastChannel();
    const broadcast = installMutationBroadcast({ channel, store });
    const root = new FakeMorphRoot();
    root.deps = [
      { deps: 'cart', id: 'cart-badge' },
      { deps: 'product:p1', target: 'recommendations' },
      { deps: 'cart', id: 'cart-badge' },
    ];
    root.targets.set('cart-badge', new FakeMorphTarget());
    root.targets.set('recommendations', new FakeMorphTarget());
    const formData = new FormData();
    formData.set('productId', 'p1');
    formData.set('quantity', '1');
    const fetch = vi.fn(async () => ({
      headers: {
        get(name: string) {
          return name === 'FW-Changes'
            ? '[{"domain":"cart","input":{"productId":"p1","quantity":"1"}}]'
            : null;
        },
      },
      async text() {
        return [
          '<fw-query name="cart">{"count":1}</fw-query>',
          '<fw-fragment target="cart-badge"><cart-badge>1</cart-badge></fw-fragment>',
          '<fw-fragment target="recommendations"><section></section></fw-fragment>',
        ].join('\n');
      },
    }));

    const result = await submitEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData,
      broadcast,
      idem: 'idem_01HX',
      root,
      store,
    });

    expect(fetch).toHaveBeenCalledWith('/_m/cart/add', {
      body: formData,
      headers: {
        Accept: 'text/vnd.jiso.fragment+html',
        'FW-Fragment': 'true',
        'FW-Idem': 'idem_01HX',
        'FW-Targets': 'cart-badge=cart; recommendations=product:p1',
      },
      keepalive: true,
      method: 'POST',
    });
    expect(result).toEqual({
      appliedFragments: ['cart-badge', 'recommendations'],
      fragments: [
        { html: '<cart-badge>1</cart-badge>', target: 'cart-badge' },
        { html: '<section></section>', target: 'recommendations' },
      ],
      changes: [{ domain: 'cart', input: { productId: 'p1', quantity: '1' } }],
      idem: 'idem_01HX',
      queries: ['cart'],
      targets: ['cart-badge=cart', 'recommendations=product:p1'],
    });
    expect(channel.messages).toEqual([
      {
        body: [
          '<fw-query name="cart">{"count":1}</fw-query>',
          '<fw-fragment target="cart-badge"><cart-badge>1</cart-badge></fw-fragment>',
          '<fw-fragment target="recommendations"><section></section></fw-fragment>',
        ].join('\n'),
        changes: [{ domain: 'cart', input: { productId: 'p1', quantity: '1' } }],
        type: 'jiso:mutation-response',
      },
    ]);
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>1</cart-badge>');
    expect(root.targets.get('recommendations')?.html).toBe('<section></section>');
  });

  it('does not rebroadcast failed enhanced mutation responses', async () => {
    const store = createQueryStore();
    const channel = new FakeBroadcastChannel();
    const broadcast = installMutationBroadcast({ channel, store });
    const root = new FakeMorphRoot();
    root.deps = [{ id: 'cart-form' }];
    root.targets.set('cart-form', new FakeMorphTarget());
    const fetch = vi.fn(async () => ({
      headers: {
        get() {
          return null;
        },
      },
      ok: false,
      status: 422,
      async text() {
        return '<fw-fragment target="cart-form"><form>Out of stock</form></fw-fragment>';
      },
    }));

    const result = await submitEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      broadcast,
      root,
      store,
    });

    expect(result.appliedFragments).toEqual(['cart-form']);
    expect(channel.messages).toEqual([]);
  });

  it('submits enhanced mutations with optimistic transforms and reconciles server truth', async () => {
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
    expect(channel.messages).toEqual([
      {
        body: [
          '<fw-query name="cart">{"count":4}</fw-query>',
          '<fw-fragment target="cart-badge"><cart-badge>4</cart-badge></fw-fragment>',
        ].join('\n'),
        changes: [],
        type: 'jiso:mutation-response',
      },
    ]);
    expect(store.get('cart')).toEqual({ count: 4 });
    expect(rebaser.pendingCount('cart')).toBe(0);
    expect(cartBadge.attributes).not.toHaveProperty('fw-pending');
    expect(cartBadge.attributes).not.toHaveProperty('aria-busy');
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>4</cart-badge>');
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
          return '<fw-query name="cart">{"count":2}</fw-query>';
        },
      };
    });

    await submitOptimisticEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      idem: 'idem_first',
      input: { quantity: 2 },
      optimistic,
      pendingRoot,
      rebaser,
      root,
      store,
    });

    expect(store.get('cart')).toEqual({ count: 7 });
    expect(rebaser.pendingCount('cart')).toBe(1);
    expect(cartBadge.attributes).toMatchObject({
      'aria-busy': 'true',
      'fw-pending': '',
    });
  });

  it('discards optimistic state on enhanced mutation errors and applies the error fragment', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
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
    expect(cartForm.attributes).not.toHaveProperty('fw-pending');
    expect(cartForm.attributes).not.toHaveProperty('aria-busy');
    expect(root.targets.get('cart-form')?.html).toBe('<form>Out of stock</form>');
  });

  it('submits typed forms through a ctx.submit-style helper', async () => {
    const addToCart = form<'cart/add', { productId: string; quantity: number }>('cart/add');
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    root.deps = [{ id: 'cart-badge' }];
    root.targets.set('cart-badge', new FakeMorphTarget());
    const fetch = vi.fn(async (_url: string, options: EnhancedMutationFetchOptions) => {
      const body = options.body as FormData;

      expect(body.get('productId')).toBe('p1');
      expect(body.get('quantity')).toBe('2');

      return {
        async text() {
          return [
            '<fw-query name="cart">{"count":2}</fw-query>',
            '<fw-fragment target="cart-badge"><cart-badge>2</cart-badge></fw-fragment>',
          ].join('\n');
        },
      };
    });
    const ctx = createSubmitContext({ fetch, root, store });

    const result = await ctx.submit(addToCart, {
      idem: 'idem_ctx',
      input: { productId: 'p1', quantity: 2 },
    });

    expect(fetch).toHaveBeenCalledWith('/_m/cart/add', {
      body: expect.any(FormData),
      headers: {
        Accept: 'text/vnd.jiso.fragment+html',
        'FW-Fragment': 'true',
        'FW-Idem': 'idem_ctx',
        'FW-Targets': 'cart-badge',
      },
      keepalive: true,
      method: 'POST',
    });
    expect(result.appliedFragments).toEqual(['cart-badge']);
    expect(store.get('cart')).toEqual({ count: 2 });
  });

  it('passes typed validation failures from ctx.submit on 422 responses', async () => {
    const addToCart = form<
      'cart/add',
      { productId: string; quantity: number },
      { code: 'OUT_OF_STOCK' }
    >('cart/add');
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const onError = vi.fn();
    const fetch = vi.fn(async () => ({
      status: 422,
      async text() {
        return '<fw-error>{&quot;code&quot;:&quot;OUT_OF_STOCK&quot;}</fw-error>';
      },
    }));
    const ctx = createSubmitContext({ fetch, root, store });

    const result = await ctx.submit(addToCart, {
      input: { productId: 'p1', quantity: 1 },
      onError,
    });

    expect(onError).toHaveBeenCalledWith({ code: 'OUT_OF_STOCK' });
    expect(result.fragments).toEqual([]);
  });
});
