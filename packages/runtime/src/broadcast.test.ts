import { describe, expect, it, vi } from 'vitest';

import { installMutationBroadcast, withDefaultMutationBroadcast } from './broadcast.js';
import { createQueryStore } from './query-store.js';
import {
  FakeBroadcastChannel,
  FakeBroadcastHub,
  FakeMorphRoot,
  FakeMorphTarget,
  FakeQueryBindingElement,
  FakeQueryPlanElement,
} from './runtime-test-fakes.js';

describe('mutation broadcast', () => {
  it('publishes sanitized change records and applies received mutation wire bodies', () => {
    const channel = new FakeBroadcastChannel();
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const onChanges = vi.fn();
    const onAppliedQueries = vi.fn();
    root.targets.set('cart-badge', new FakeMorphTarget());

    const broadcast = installMutationBroadcast({
      channel,
      onAppliedQueries,
      onChanges,
      root,
      store,
    });

    broadcast.publish('<fw-query name="cart">{"count":1}</fw-query>', [
      { domain: 'cart', input: { productId: 'p1' } },
      { domain: 'product', keys: ['p1'] },
    ] as never);

    expect(channel.messages).toEqual([
      {
        body: '<fw-query name="cart">{"count":1}</fw-query>',
        changes: [{ domain: 'cart' }, { domain: 'product', keys: ['p1'] }],
        type: 'jiso:mutation-response',
      },
    ]);

    channel.onmessage?.({
      data: {
        body: [
          '<fw-query name="cart">{"count":2}</fw-query>',
          '<fw-fragment target="cart-badge"><cart-badge>2</cart-badge></fw-fragment>',
        ].join(''),
        changes: [{ domain: 'cart', keys: ['cart:1'] }],
        type: 'jiso:mutation-response',
      },
    });

    // SPEC.md §9.2: broadcast replay consumes the same mutation wire body as
    // direct enhanced submits, updating query data before fragment morphing.
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>2</cart-badge>');
    expect(onAppliedQueries).toHaveBeenCalledWith(['cart']);
    expect(onChanges).toHaveBeenCalledWith([{ domain: 'cart', keys: ['cart:1'] }]);
  });

  it('ignores invalid messages and detaches from the channel on close', () => {
    const channel = new FakeBroadcastChannel();
    const store = createQueryStore();
    const broadcast = installMutationBroadcast({ channel, store });

    channel.onmessage?.({
      data: {
        body: '<fw-query name="cart">{"count":2}</fw-query>',
        changes: [{ domain: 'cart', keys: [1] }],
        type: 'jiso:mutation-response',
      },
    });
    expect(store.get('cart')).toBeUndefined();

    broadcast.close();

    expect(channel.onmessage).toBeNull();
    expect(channel.closed).toBe(true);
  });

  it('rebroadcasts and applies mutation responses for same-user tab sync', () => {
    const store = createQueryStore();
    const channel = new FakeBroadcastChannel();
    const onChanges = vi.fn();
    const broadcast = installMutationBroadcast({ channel, onChanges, store });

    broadcast.publish('<fw-query name="cart">{"count":5}</fw-query>', [
      { domain: 'cart', input: { productId: 'p1' } },
    ] as never);
    expect(channel.messages).toEqual([
      {
        body: '<fw-query name="cart">{"count":5}</fw-query>',
        changes: [{ domain: 'cart' }],
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

  it('rebroadcasts keyed query chunks to the matching keyed store entry', () => {
    const store = createQueryStore();
    const channel = new FakeBroadcastChannel();
    const keyedPlan = vi.fn();
    const unkeyedPlan = vi.fn();

    store.subscribe('reviews', keyedPlan, 'product:p1');
    store.subscribe('reviews', unkeyedPlan);
    installMutationBroadcast({ channel, store });

    channel.onmessage?.({
      data: {
        body: '<fw-query name="reviews" key="product:p1">{"items":[{"id":"r1"}]}</fw-query>',
        changes: [{ domain: 'product', keys: ['p1'] }],
        type: 'jiso:mutation-response',
      },
    });

    expect(store.get('reviews')).toBeUndefined();
    expect(store.get('reviews', 'product:p1')).toEqual({ items: [{ id: 'r1' }] });
    expect(keyedPlan).toHaveBeenCalledWith({ items: [{ id: 'r1' }] });
    expect(unkeyedPlan).not.toHaveBeenCalled();
  });

  it('reports malformed replay wire while applying later broadcast chunks', () => {
    const store = createQueryStore();
    const channel = new FakeBroadcastChannel();
    const onError = vi.fn();

    installMutationBroadcast({ channel, onError, store });

    channel.onmessage?.({
      data: {
        body: [
          '<fw-query name="cart">{</fw-query>',
          '<fw-query name="product:p1">{"stock":8}</fw-query>',
        ].join('\n'),
        changes: [],
        type: 'jiso:mutation-response',
      },
    });

    // SPEC.md §9.1/§9.2: same-user broadcast replay enters the canonical
    // mutation response apply path, including its tolerant per-chunk error seam.
    expect(store.get('cart')).toBeUndefined();
    expect(store.get('product', 'p1')).toEqual({ stock: 8 });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]?.[0].message)).toContain('Malformed JSON in fw-query cart');
  });

  it('reports broadcast apply hook failures without aborting later chunks', () => {
    const store = createQueryStore();
    const channel = new FakeBroadcastChannel();
    const onError = vi.fn();
    const applyError = new Error('broadcast apply failed');

    installMutationBroadcast({
      applyQuery(query) {
        if (query.name === 'cart') throw applyError;
      },
      channel,
      onError,
      store,
    });

    channel.onmessage?.({
      data: {
        body: [
          '<fw-query name="cart">{"count":2}</fw-query>',
          '<fw-query name="product:p1">{"stock":8}</fw-query>',
        ].join('\n'),
        changes: [],
        type: 'jiso:mutation-response',
      },
    });

    // SPEC.md §9.2: broadcast replay is not a separate compatibility apply
    // path; query hook failures use the same decoded response error behavior.
    expect(store.get('cart')).toBeUndefined();
    expect(store.get('product', 'p1')).toEqual({ stock: 8 });
    expect(onError).toHaveBeenCalledWith(applyError);
  });

  it('morphs rebroadcast mutation fragments when a root is configured', () => {
    const store = createQueryStore();
    const channel = new FakeBroadcastChannel();
    const root = new FakeMorphRoot();
    const count = new FakeQueryBindingElement('cart.count', { textContent: '1' });
    const summary = new FakeQueryPlanElement({ 'data-derive': 'cart.summary' });
    const observed: string[] = [];
    root.bindings.push(count);
    root.planElements.push(summary);
    root.targets.set('cart-badge', new FakeMorphTarget('<cart-badge>0</cart-badge>'));

    installMutationBroadcast({
      channel,
      morph(target, html) {
        observed.push(`morph:${count.textContent}:${summary.textContent}`);
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
    expect(observed).toEqual(['morph:6:6 items']);
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>6</cart-badge>');
  });

  it('syncs mutation responses from one tab to another over BroadcastChannel', () => {
    const hub = new FakeBroadcastHub();
    const channelA = new FakeBroadcastChannel(hub);
    const channelB = new FakeBroadcastChannel(hub);
    const storeA = createQueryStore();
    const storeB = createQueryStore();
    const onChangesA = vi.fn();
    const onChangesB = vi.fn();
    const rootB = new FakeMorphRoot();
    rootB.targets.set('cart-badge', new FakeMorphTarget('<cart-badge>1</cart-badge>'));

    const broadcastA = installMutationBroadcast({
      channel: channelA,
      onChanges: onChangesA,
      store: storeA,
    });
    installMutationBroadcast({
      channel: channelB,
      onChanges: onChangesB,
      root: rootB,
      store: storeB,
    });

    broadcastA.publish(
      [
        '<fw-query name="cart">{"count":5}</fw-query>',
        '<fw-fragment target="cart-badge"><cart-badge>5</cart-badge></fw-fragment>',
      ].join('\n'),
      [{ domain: 'cart', keys: ['cart_1'] }],
    );

    expect(channelA.messages).toEqual([
      {
        body: [
          '<fw-query name="cart">{"count":5}</fw-query>',
          '<fw-fragment target="cart-badge"><cart-badge>5</cart-badge></fw-fragment>',
        ].join('\n'),
        changes: [{ domain: 'cart', keys: ['cart_1'] }],
        type: 'jiso:mutation-response',
      },
    ]);
    expect(channelB.messages).toEqual([]);
    expect(storeA.get('cart')).toBeUndefined();
    expect(onChangesA).not.toHaveBeenCalled();
    expect(storeB.get('cart')).toEqual({ count: 5 });
    expect(rootB.targets.get('cart-badge')?.html).toBe('<cart-badge>5</cart-badge>');
    expect(onChangesB).toHaveBeenCalledWith([{ domain: 'cart', keys: ['cart_1'] }]);
  });

  it('owns default BroadcastChannel installation for enhanced mutation options', () => {
    const originalBroadcastChannel = globalThis.BroadcastChannel;
    const createdChannels: Array<FakeBroadcastChannel & { name: string }> = [];
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    class DefaultBroadcastChannel extends FakeBroadcastChannel {
      name: string;

      constructor(name: string) {
        super();
        this.name = name;
        createdChannels.push(this);
      }
    }
    globalThis.BroadcastChannel = DefaultBroadcastChannel as never;

    try {
      const setup = withDefaultMutationBroadcast({ root, store });

      expect(createdChannels).toHaveLength(1);
      const channel = createdChannels[0];
      expect(channel).toBeDefined();
      expect(channel?.name).toBe('jiso:mutation-response');
      expect(setup.options.broadcast).toBeDefined();

      setup.options.broadcast?.publish('<fw-query name="cart">{"count":1}</fw-query>');
      expect(channel?.messages).toEqual([
        {
          body: '<fw-query name="cart">{"count":1}</fw-query>',
          changes: [],
          type: 'jiso:mutation-response',
        },
      ]);

      setup.dispose?.();
      expect(channel?.closed).toBe(true);
    } finally {
      globalThis.BroadcastChannel = originalBroadcastChannel;
    }
  });
});
