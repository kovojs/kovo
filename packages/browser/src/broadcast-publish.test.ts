import { describe, expect, it, vi } from 'vitest';

import { installMutationBroadcast, withDefaultMutationBroadcast } from './broadcast.js';
import { createQueryStore } from './query-store.js';
import {
  FakeBroadcastChannel,
  FakeBroadcastHub,
  FakeMorphRoot,
  FakeMorphTarget,
} from './runtime-test-fakes.js';

// SPEC.md §9.2: the publish side sanitizes change records, owns default
// BroadcastChannel installation/teardown, and syncs across tabs; the incoming
// replay apply behavior lives in the sibling broadcast-replay.test.ts file.
describe('mutation broadcast publish', () => {
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

    broadcast.publish('<kovo-query name="cart">{"count":1}</kovo-query>', [
      { domain: 'cart', input: { productId: 'p1' } },
      { domain: 'product', keys: ['p1'] },
    ] as never);

    expect(channel.messages).toEqual([
      {
        body: '<kovo-query name="cart">{"count":1}</kovo-query>',
        changes: [{ domain: 'cart' }, { domain: 'product', keys: ['p1'] }],
        type: 'kovo:mutation-response',
      },
    ]);

    channel.onmessage?.({
      data: {
        body: [
          '<kovo-query name="cart">{"count":2}</kovo-query>',
          '<kovo-fragment target="cart-badge"><cart-badge>2</cart-badge></kovo-fragment>',
        ].join(''),
        changes: [{ domain: 'cart', keys: ['cart:1'] }],
        type: 'kovo:mutation-response',
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
        body: '<kovo-query name="cart">{"count":2}</kovo-query>',
        changes: [{ domain: 'cart', keys: [1] }],
        type: 'kovo:mutation-response',
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

    broadcast.publish('<kovo-query name="cart">{"count":5}</kovo-query>', [
      { domain: 'cart', input: { productId: 'p1' } },
    ] as never);
    expect(channel.messages).toEqual([
      {
        body: '<kovo-query name="cart">{"count":5}</kovo-query>',
        changes: [{ domain: 'cart' }],
        type: 'kovo:mutation-response',
      },
    ]);

    channel.onmessage?.({
      data: {
        body: '<kovo-query name="cart">{"count":6}</kovo-query>',
        changes: [{ domain: 'cart', keys: ['cart_1'] }],
        type: 'kovo:mutation-response',
      },
    });

    expect(store.get('cart')).toEqual({ count: 6 });
    expect(onChanges).toHaveBeenCalledWith([{ domain: 'cart', keys: ['cart_1'] }]);
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
        '<kovo-query name="cart">{"count":5}</kovo-query>',
        '<kovo-fragment target="cart-badge"><cart-badge>5</cart-badge></kovo-fragment>',
      ].join('\n'),
      [{ domain: 'cart', keys: ['cart_1'] }],
    );

    expect(channelA.messages).toEqual([
      {
        body: [
          '<kovo-query name="cart">{"count":5}</kovo-query>',
          '<kovo-fragment target="cart-badge"><cart-badge>5</cart-badge></kovo-fragment>',
        ].join('\n'),
        changes: [{ domain: 'cart', keys: ['cart_1'] }],
        type: 'kovo:mutation-response',
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
      expect(channel?.name).toBe('kovo:mutation-response');
      expect(setup.options.broadcast).toBeDefined();

      setup.options.broadcast?.publish('<kovo-query name="cart">{"count":1}</kovo-query>');
      expect(channel?.messages).toEqual([
        {
          body: '<kovo-query name="cart">{"count":1}</kovo-query>',
          changes: [],
          type: 'kovo:mutation-response',
        },
      ]);

      setup.dispose?.();
      expect(channel?.closed).toBe(true);
    } finally {
      globalThis.BroadcastChannel = originalBroadcastChannel;
    }
  });

  it('stamps the principal on publish and discards cross-principal rebroadcasts (bugs-1 F13)', () => {
    const channel = new FakeBroadcastChannel();
    const store = createQueryStore();
    const broadcast = installMutationBroadcast({ channel, principal: 'session-A', store });

    // publish carries the sender's principal fingerprint.
    broadcast.publish('<kovo-query name="cart">{"count":1}</kovo-query>');
    expect(channel.messages).toEqual([
      {
        body: '<kovo-query name="cart">{"count":1}</kovo-query>',
        changes: [],
        principal: 'session-A',
        type: 'kovo:mutation-response',
      },
    ]);

    // A rebroadcast from a DIFFERENT principal (e.g. another user on a shared device)
    // must be discarded — never morphed into this session's store.
    channel.onmessage?.({
      data: {
        body: '<kovo-query name="cart">{"count":99}</kovo-query>',
        changes: [],
        principal: 'session-B',
        type: 'kovo:mutation-response',
      },
    });
    expect(store.get('cart')).toBeUndefined();

    // A rebroadcast from the SAME principal is applied (same-user multi-tab sync).
    channel.onmessage?.({
      data: {
        body: '<kovo-query name="cart">{"count":2}</kovo-query>',
        changes: [],
        principal: 'session-A',
        type: 'kovo:mutation-response',
      },
    });
    expect(store.get('cart')).toEqual({ count: 2 });
  });

  it('discards a principal-stamped message when the receiver has no principal (K1 asymmetric discard)', () => {
    // K1: an undefined-principal (anonymous/cold page) receiver must NOT accept a
    // stamped message — cross-principal disclosure via the asymmetric path (SPEC §9.3).
    const channel = new FakeBroadcastChannel();
    const store = createQueryStore();
    // Receiver installed with principal: undefined (anonymous page).
    installMutationBroadcast({ channel, store });

    channel.onmessage?.({
      data: {
        body: '<kovo-query name="cart">{"count":99}</kovo-query>',
        changes: [],
        principal: 'session-B',
        type: 'kovo:mutation-response',
      },
    });

    // The stamped message must be discarded — store unchanged.
    expect(store.get('cart')).toBeUndefined();
  });
});
