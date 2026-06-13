import { describe, expect, it, vi } from 'vitest';

import { installMutationBroadcast } from './broadcast.js';
import { createQueryStore } from './query-store.js';
import {
  FakeBroadcastChannel,
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
});
