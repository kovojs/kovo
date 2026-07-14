import { describe, expect, it, vi } from 'vitest';

import { installMutationBroadcast, withDefaultMutationBroadcast } from './broadcast.js';
import { createQueryStore } from './query-store.js';
import {
  FakeBroadcastChannel,
  FakeBroadcastHub,
  FakeMorphRoot,
  FakeMorphTarget,
} from './runtime-test-fakes.js';

const TEST_BUILD = 'build-test';

// SPEC.md §9.2: the publish side sanitizes change records, owns default
// BroadcastChannel installation/teardown, and syncs across tabs; the incoming
// replay apply behavior lives in the sibling broadcast-replay.test.ts file.
describe('mutation broadcast publish', () => {
  it('never restamps missing or mismatched response proof with the page build token', () => {
    const channel = new FakeBroadcastChannel();
    const broadcast = installMutationBroadcast({
      buildToken: 'build-old',
      channel,
      store: createQueryStore(),
    });
    const body = '<kovo-query name="account">{"secret":"new-build"}</kovo-query>';

    broadcast.publish(body);
    broadcast.publish(body, [], 'build-new');
    expect(channel.messages).toEqual([]);

    broadcast.publish(body, [], 'build-old');
    expect(channel.messages).toEqual([
      {
        body,
        buildToken: 'build-old',
        changes: [],
        type: 'kovo:mutation-response',
      },
    ]);
  });

  it('publishes sanitized change records and applies received mutation wire bodies', () => {
    const channel = new FakeBroadcastChannel();
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const onChanges = vi.fn();
    const onAppliedQueries = vi.fn();
    root.targets.set('cart-badge', new FakeMorphTarget());

    const broadcast = installMutationBroadcast({
      buildToken: TEST_BUILD,
      channel,
      onAppliedQueries,
      onChanges,
      root,
      store,
    });

    broadcast.publish(
      '<kovo-query name="cart">{"count":1}</kovo-query>',
      [
        { domain: 'cart', input: { productId: 'p1' } },
        { domain: 'product', keys: ['p1'] },
      ] as never,
      TEST_BUILD,
    );

    expect(channel.messages).toEqual([
      {
        body: '<kovo-query name="cart">{"count":1}</kovo-query>',
        buildToken: TEST_BUILD,
        changes: [{ domain: 'cart' }, { domain: 'product', keys: ['p1'] }],
        type: 'kovo:mutation-response',
      },
    ]);
    const published = channel.messages[0] as {
      changes: readonly { keys?: readonly string[] }[];
    };
    expect(Object.isFrozen(published)).toBe(true);
    expect(Object.isFrozen(published.changes)).toBe(true);
    expect(Object.isFrozen(published.changes[0])).toBe(true);
    expect(Object.isFrozen(published.changes[1]?.keys)).toBe(true);

    channel.onmessage?.({
      data: {
        body: [
          '<kovo-query name="cart">{"count":2}</kovo-query>',
          '<kovo-fragment target="cart-badge"><cart-badge>2</cart-badge></kovo-fragment>',
        ].join(''),
        buildToken: TEST_BUILD,
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
    const broadcast = installMutationBroadcast({ buildToken: TEST_BUILD, channel, store });

    channel.onmessage?.({
      data: {
        body: '<kovo-query name="cart">{"count":2}</kovo-query>',
        changes: [{ domain: 'cart', keys: [1] }],
        type: 'kovo:mutation-response',
      },
    });
    expect(store.get('cart')).toBeUndefined();

    broadcast.close();
    broadcast.close();
    broadcast.publish('<kovo-query name="cart">{"count":99}</kovo-query>');

    expect(channel.onmessage).toBeNull();
    expect(channel.closed).toBe(true);
    expect(channel.messages).toEqual([]);
  });

  it('rebroadcasts and applies mutation responses for same-user tab sync', () => {
    const store = createQueryStore();
    const channel = new FakeBroadcastChannel();
    const onChanges = vi.fn();
    const broadcast = installMutationBroadcast({
      buildToken: TEST_BUILD,
      channel,
      onChanges,
      store,
    });

    broadcast.publish(
      '<kovo-query name="cart">{"count":5}</kovo-query>',
      [{ domain: 'cart', input: { productId: 'p1' } }] as never,
      TEST_BUILD,
    );
    expect(channel.messages).toEqual([
      {
        body: '<kovo-query name="cart">{"count":5}</kovo-query>',
        buildToken: TEST_BUILD,
        changes: [{ domain: 'cart' }],
        type: 'kovo:mutation-response',
      },
    ]);

    channel.onmessage?.({
      data: {
        body: '<kovo-query name="cart">{"count":6}</kovo-query>',
        buildToken: TEST_BUILD,
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
      buildToken: TEST_BUILD,
      channel: channelA,
      onChanges: onChangesA,
      store: storeA,
    });
    installMutationBroadcast({
      buildToken: TEST_BUILD,
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
      TEST_BUILD,
    );

    expect(channelA.messages).toEqual([
      {
        body: [
          '<kovo-query name="cart">{"count":5}</kovo-query>',
          '<kovo-fragment target="cart-badge"><cart-badge>5</cart-badge></kovo-fragment>',
        ].join('\n'),
        buildToken: TEST_BUILD,
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
      const setup = withDefaultMutationBroadcast({ buildToken: TEST_BUILD, root, store });

      expect(createdChannels).toHaveLength(1);
      const channel = createdChannels[0];
      expect(channel).toBeDefined();
      expect(channel?.name).toBe('kovo:mutation-response');
      expect(setup.options.broadcast).toBeDefined();

      setup.options.broadcast?.publish(
        '<kovo-query name="cart">{"count":1}</kovo-query>',
        [],
        TEST_BUILD,
      );
      expect(channel?.messages).toEqual([
        {
          body: '<kovo-query name="cart">{"count":1}</kovo-query>',
          buildToken: TEST_BUILD,
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

  it('does not create or retain a default broadcast for unresolved session-dependent state', () => {
    const originalBroadcastChannel = globalThis.BroadcastChannel;
    const createdChannels: FakeBroadcastChannel[] = [];
    const suppliedBroadcast = {
      close: vi.fn(),
      publish: vi.fn(),
    };
    class DefaultBroadcastChannel extends FakeBroadcastChannel {
      constructor() {
        super();
        createdChannels.push(this);
      }
    }
    globalThis.BroadcastChannel = DefaultBroadcastChannel as never;

    try {
      const setup = withDefaultMutationBroadcast({
        broadcast: suppliedBroadcast,
        buildToken: TEST_BUILD,
        root: new FakeMorphRoot(),
        sessionDependent: true,
        store: createQueryStore(),
      });

      expect(createdChannels).toEqual([]);
      expect(setup.options.broadcast).toBeUndefined();
      expect(setup.dispose).toBeUndefined();
      expect(suppliedBroadcast.publish).not.toHaveBeenCalled();
    } finally {
      globalThis.BroadcastChannel = originalBroadcastChannel;
    }
  });

  it('isolates an unresolved session-dependent tab from an anonymous tab in both directions', () => {
    const hub = new FakeBroadcastHub();
    const unresolvedChannel = new FakeBroadcastChannel(hub);
    const anonymousChannel = new FakeBroadcastChannel(hub);
    const unresolvedStore = createQueryStore();
    const anonymousStore = createQueryStore();
    const unresolved = installMutationBroadcast({
      buildToken: TEST_BUILD,
      channel: unresolvedChannel,
      sessionDependent: true,
      store: unresolvedStore,
    });
    const anonymous = installMutationBroadcast({
      buildToken: TEST_BUILD,
      channel: anonymousChannel,
      store: anonymousStore,
    });

    expect(unresolvedChannel.closed).toBe(true);
    expect(unresolvedChannel.onmessage).toBeNull();
    unresolved.publish(
      '<kovo-query name="account">{"secret":"private"}</kovo-query>',
      [],
      TEST_BUILD,
    );
    expect(unresolvedChannel.messages).toEqual([]);
    expect(anonymousStore.get('account')).toBeUndefined();

    anonymous.publish(
      '<kovo-query name="account">{"posture":"anonymous"}</kovo-query>',
      [],
      TEST_BUILD,
    );
    expect(unresolvedStore.get('account')).toBeUndefined();
  });

  it('stamps the principal on publish and discards cross-principal rebroadcasts (bugs-1 F13)', () => {
    const channel = new FakeBroadcastChannel();
    const store = createQueryStore();
    const broadcast = installMutationBroadcast({
      buildToken: TEST_BUILD,
      channel,
      principal: 'session-A',
      store,
    });

    // publish carries the sender's principal fingerprint.
    broadcast.publish('<kovo-query name="cart">{"count":1}</kovo-query>', [], TEST_BUILD);
    expect(channel.messages).toEqual([
      {
        body: '<kovo-query name="cart">{"count":1}</kovo-query>',
        buildToken: TEST_BUILD,
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
        buildToken: TEST_BUILD,
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
        buildToken: TEST_BUILD,
        changes: [],
        principal: 'session-A',
        type: 'kovo:mutation-response',
      },
    });
    expect(store.get('cart')).toEqual({ count: 2 });
  });

  it('pins channel and principal authority when the broadcast is installed', () => {
    const channel = new FakeBroadcastChannel();
    const redirectedChannel = new FakeBroadcastChannel();
    const store = createQueryStore();
    const redirectedStore = createQueryStore();
    const onChanges = vi.fn();
    const redirectedOnChanges = vi.fn();
    const options = {
      buildToken: TEST_BUILD,
      channel,
      onChanges,
      principal: 'session-A',
      store,
    };
    const broadcast = installMutationBroadcast(options);

    // SPEC §§6.6/9.3: a caller-controlled options object must not remain a
    // live capability after installation. Otherwise authored client code can swap
    // the principal gate and channel after Kovo binds the receive handler.
    options.principal = 'session-B';
    options.channel = redirectedChannel;
    options.store = redirectedStore;
    options.onChanges = redirectedOnChanges;
    channel.onmessage?.({
      data: {
        body: '<kovo-query name="cart">{"count":99}</kovo-query>',
        buildToken: TEST_BUILD,
        changes: [],
        principal: 'session-B',
        type: 'kovo:mutation-response',
      },
    });
    expect(store.get('cart')).toBeUndefined();

    channel.onmessage?.({
      data: {
        body: '<kovo-query name="cart">{"count":2}</kovo-query>',
        buildToken: TEST_BUILD,
        changes: [{ domain: 'cart' }],
        principal: 'session-A',
        type: 'kovo:mutation-response',
      },
    });
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(redirectedStore.get('cart')).toBeUndefined();
    expect(onChanges).toHaveBeenCalledWith([{ domain: 'cart' }]);
    expect(redirectedOnChanges).not.toHaveBeenCalled();

    broadcast.publish('<kovo-query name="cart">{"count":1}</kovo-query>', [], TEST_BUILD);
    expect(channel.messages).toEqual([
      {
        body: '<kovo-query name="cart">{"count":1}</kovo-query>',
        buildToken: TEST_BUILD,
        changes: [],
        principal: 'session-A',
        type: 'kovo:mutation-response',
      },
    ]);
    expect(redirectedChannel.messages).toEqual([]);

    broadcast.close();
    expect(channel.closed).toBe(true);
    expect(redirectedChannel.closed).toBe(false);
  });

  it.each(['channel', 'onChanges', 'principal', 'store'] as const)(
    'rejects an accessor-backed %s option without invoking it',
    (property) => {
      const channel = new FakeBroadcastChannel();
      const store = createQueryStore();
      let reads = 0;
      const options: Record<string, unknown> = { buildToken: TEST_BUILD, channel, store };
      Object.defineProperty(options, property, {
        configurable: true,
        enumerable: true,
        get() {
          reads += 1;
          return property === 'channel' ? channel : property === 'store' ? store : undefined;
        },
      });

      expect(() => installMutationBroadcast(options as never)).toThrow(/own-data/u);
      expect(reads).toBe(0);
    },
  );

  it('ignores inherited principal and callback options', () => {
    const channel = new FakeBroadcastChannel();
    const store = createQueryStore();
    const inheritedOnChanges = vi.fn();
    const options = Object.assign(
      Object.create({ onChanges: inheritedOnChanges, principal: 'session-B' }),
      { buildToken: TEST_BUILD, channel, store },
    );
    const broadcast = installMutationBroadcast(options);

    broadcast.publish('<kovo-query name="cart">{"count":1}</kovo-query>', [], TEST_BUILD);
    expect(channel.messages[0]).toEqual({
      body: '<kovo-query name="cart">{"count":1}</kovo-query>',
      buildToken: TEST_BUILD,
      changes: [],
      type: 'kovo:mutation-response',
    });
    channel.onmessage?.({
      data: {
        body: '<kovo-query name="cart">{"count":99}</kovo-query>',
        buildToken: TEST_BUILD,
        changes: [{ domain: 'cart' }],
        principal: 'session-B',
        type: 'kovo:mutation-response',
      },
    });
    expect(store.get('cart')).toBeUndefined();
    expect(inheritedOnChanges).not.toHaveBeenCalled();
  });

  it('rejects inherited required channel and store capabilities', () => {
    const channel = new FakeBroadcastChannel();
    const store = createQueryStore();
    const inheritedChannel = Object.assign(Object.create({ channel }), { store });
    const inheritedStore = Object.assign(Object.create({ store }), { channel });

    expect(() => installMutationBroadcast(inheritedChannel)).toThrow(/channel.*own-data/u);
    expect(() => installMutationBroadcast(inheritedStore)).toThrow(/store.*own-data/u);
  });

  it('discards a principal-stamped message when the receiver has no principal (K1 asymmetric discard)', () => {
    // K1: an undefined-principal (anonymous/cold page) receiver must NOT accept a
    // stamped message — cross-principal disclosure via the asymmetric path (SPEC §9.3).
    const channel = new FakeBroadcastChannel();
    const store = createQueryStore();
    // Receiver installed with principal: undefined (anonymous page).
    installMutationBroadcast({ buildToken: TEST_BUILD, channel, store });

    channel.onmessage?.({
      data: {
        body: '<kovo-query name="cart">{"count":99}</kovo-query>',
        buildToken: TEST_BUILD,
        changes: [],
        principal: 'session-B',
        type: 'kovo:mutation-response',
      },
    });

    // The stamped message must be discarded — store unchanged.
    expect(store.get('cart')).toBeUndefined();
  });
});
