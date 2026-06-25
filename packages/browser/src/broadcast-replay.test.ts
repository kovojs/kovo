import { describe, expect, it, vi } from 'vitest';

import { installMutationBroadcast } from './broadcast.js';
import { createIslandSignalScope } from './handler-context.js';
import { dispatchDelegatedEvent } from './handlers.js';
import { createQueryStore } from './query-store.js';
import {
  FakeBroadcastChannel,
  FakeElement,
  FakeMorphRoot,
  FakeMorphTarget,
  FakeQueryBindingElement,
  FakeQueryPlanElement,
} from './runtime-test-fakes.js';

// SPEC.md §9.1/§9.2: incoming broadcast replay enters the canonical mutation
// response apply path (keyed query chunks, tolerant per-chunk error seam, query
// hook failures, and fragment morphing); the publish/lifecycle side lives in the
// sibling broadcast-publish.test.ts file.
describe('mutation broadcast replay', () => {
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
        body: '<kovo-query name="reviews" key="product:p1">{"items":[{"id":"r1"}]}</kovo-query>',
        changes: [{ domain: 'product', keys: ['p1'] }],
        type: 'kovo:mutation-response',
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
          '<kovo-query name="cart">{</kovo-query>',
          '<kovo-query name="product:p1">{"stock":8}</kovo-query>',
        ].join('\n'),
        changes: [],
        type: 'kovo:mutation-response',
      },
    });

    // SPEC.md §9.1/§9.2: same-user broadcast replay enters the canonical
    // mutation response apply path, including its tolerant per-chunk error seam.
    expect(store.get('cart')).toBeUndefined();
    expect(store.get('product', 'p1')).toEqual({ stock: 8 });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]?.[0].message)).toContain(
      'Malformed JSON in kovo-query cart',
    );
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
          '<kovo-query name="cart">{"count":2}</kovo-query>',
          '<kovo-query name="product:p1">{"stock":8}</kovo-query>',
        ].join('\n'),
        changes: [],
        type: 'kovo:mutation-response',
      },
    });

    // SPEC.md §9.2: broadcast replay is not a separate compatibility apply
    // path; query hook failures use the same decoded response error behavior.
    expect(store.get('cart')).toBeUndefined();
    expect(store.get('product', 'p1')).toEqual({ stock: 8 });
    expect(onError).toHaveBeenCalledWith(applyError);
  });

  it('aborts island ctx.signal when a broadcast morph removes the island (K4 scope threading)', async () => {
    // K4 / SPEC §4.7: broadcast apply must thread islandSignalScope so a morph that
    // removes an island aborts its ctx.signal. Without the fix, the apply hits the
    // default scope and no registered signal is aborted.
    const store = createQueryStore();
    const channel = new FakeBroadcastChannel();
    const islandSignalScope = createIslandSignalScope();
    const root = new FakeMorphRoot();
    const islandHtml = '<section kovo-c="cart-filter">initial</section>';
    root.targets.set('cart-shell', new FakeMorphTarget(islandHtml));

    // Register a ctx.signal for the island in the explicit scope.
    const element = new FakeElement({
      'kovo-c': 'cart-filter',
      'on:visible': '/c/cart-filter.client.js#mount',
    });
    let capturedSignal: AbortSignal | undefined;
    const importModule = vi.fn(async () => ({
      mount: (_event: Event, ctx: { signal: AbortSignal }) => {
        capturedSignal = ctx.signal;
      },
    }));
    await dispatchDelegatedEvent(
      { target: element, type: 'visible' },
      importModule,
      islandSignalScope,
    );
    expect(capturedSignal?.aborted).toBe(false);

    installMutationBroadcast({
      channel,
      islandSignalScope,
      morph(target, html) {
        target.replaceWithHtml(html);
      },
      root,
      store,
    });

    // Broadcast a morph that replaces the island's fragment with HTML that removes it.
    channel.onmessage?.({
      data: {
        body: '<kovo-fragment target="cart-shell"><section></section></kovo-fragment>',
        changes: [],
        type: 'kovo:mutation-response',
      },
    });

    // The island signal must be aborted now that the island was removed.
    expect(capturedSignal?.aborted).toBe(true);
  });

  // D3 / SPEC §9.1.1, §847, §14: BroadcastChannel replay is a distinct apply path
  // from direct enhanced submit. Without build-token validation, Tab A on build N
  // applies Tab B's build N+1 delta onto its N base after a redeploy — the exact
  // long-open-tab skew base-version validation exists to catch. The receiver passes
  // its own page token as the expected token and the sender-stamped envelope token
  // as the response token, so a cross-build delta chunk becomes a miss.
  describe('cross-build delta validation (D3 / SPEC §9.1.1)', () => {
    const deltaBody = '<kovo-query name="cart" delta>{"set":{"count":99}}</kovo-query>';

    it('converts a cross-build delta chunk to a miss and leaves the store base untouched', () => {
      const store = createQueryStore();
      const channel = new FakeBroadcastChannel();
      const onDeltaMiss = vi.fn();
      store.set('cart', { count: 1 });

      // Receiver page is on build N.
      installMutationBroadcast({ buildToken: 'N', channel, onDeltaMiss, store });

      // Envelope was stamped by a sender on build N+1 (post-redeploy tab).
      channel.onmessage?.({
        data: {
          body: deltaBody,
          buildToken: 'N+1',
          changes: [],
          type: 'kovo:mutation-response',
        },
      });

      // The cross-build delta is a miss → refetch; the N base is never merged with N+1.
      expect(onDeltaMiss).toHaveBeenCalledWith('cart', undefined);
      expect(store.get('cart')).toEqual({ count: 1 });
    });

    it('applies a same-build delta chunk against the held base', () => {
      const store = createQueryStore();
      const channel = new FakeBroadcastChannel();
      const onDeltaMiss = vi.fn();
      store.set('cart', { count: 1 });

      installMutationBroadcast({ buildToken: 'N', channel, onDeltaMiss, store });

      // Same-build envelope: the delta merges normally.
      channel.onmessage?.({
        data: {
          body: deltaBody,
          buildToken: 'N',
          changes: [],
          type: 'kovo:mutation-response',
        },
      });

      expect(onDeltaMiss).not.toHaveBeenCalled();
      expect(store.get('cart')).toEqual({ count: 99 });
    });

    it('treats a cross-build full chunk as a whole-response miss', () => {
      const store = createQueryStore();
      const channel = new FakeBroadcastChannel();
      const onDeltaMiss = vi.fn();
      store.set('cart', { count: 1 });

      installMutationBroadcast({ buildToken: 'N', channel, onDeltaMiss, store });

      channel.onmessage?.({
        data: {
          body: '<kovo-query name="cart">{"count":7}</kovo-query>',
          buildToken: 'N+1',
          changes: [],
          type: 'kovo:mutation-response',
        },
      });

      expect(onDeltaMiss).toHaveBeenCalledWith('cart', undefined);
      expect(store.get('cart')).toEqual({ count: 1 });
    });

    it('treats a missing broadcast token as a whole-response miss when the receiver is stamped', () => {
      const store = createQueryStore();
      const channel = new FakeBroadcastChannel();
      const onDeltaMiss = vi.fn();
      store.set('cart', { count: 1 });

      installMutationBroadcast({ buildToken: 'N', channel, onDeltaMiss, store });

      channel.onmessage?.({
        data: {
          body: '<kovo-query name="cart">{"count":7}</kovo-query>',
          changes: [],
          type: 'kovo:mutation-response',
        },
      });

      expect(onDeltaMiss).toHaveBeenCalledWith('cart', undefined);
      expect(store.get('cart')).toEqual({ count: 1 });
    });
  });

  it('round-trips a build token through publish and back into the receive gate (D3)', () => {
    // publish stamps the sender's build token; a peer on a different build converts
    // the rebroadcast delta into a miss. Drives the publish + receive paths together.
    const senderChannel = new FakeBroadcastChannel();
    const senderStore = createQueryStore();
    const sender = installMutationBroadcast({
      buildToken: 'N+1',
      channel: senderChannel,
      store: senderStore,
    });

    sender.publish('<kovo-query name="cart" delta>{"set":{"count":99}}</kovo-query>');
    const envelope = senderChannel.messages[0] as { buildToken?: string };
    expect(envelope.buildToken).toBe('N+1');

    // Deliver that exact envelope into a receiver pinned to build N.
    const receiverStore = createQueryStore();
    const receiverChannel = new FakeBroadcastChannel();
    const onDeltaMiss = vi.fn();
    receiverStore.set('cart', { count: 1 });
    installMutationBroadcast({
      buildToken: 'N',
      channel: receiverChannel,
      onDeltaMiss,
      store: receiverStore,
    });
    receiverChannel.onmessage?.({ data: envelope });

    expect(onDeltaMiss).toHaveBeenCalledWith('cart', undefined);
    expect(receiverStore.get('cart')).toEqual({ count: 1 });
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
          '<kovo-query name="cart">{"count":6}</kovo-query>',
          '<kovo-fragment target="cart-badge"><cart-badge>6</cart-badge></kovo-fragment>',
        ].join('\n'),
        changes: [],
        type: 'kovo:mutation-response',
      },
    });

    expect(store.get('cart')).toEqual({ count: 6 });
    expect(observed).toEqual(['morph:6:6 items']);
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>6</cart-badge>');
  });
});
