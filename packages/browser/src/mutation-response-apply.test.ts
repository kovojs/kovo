import { describe, expect, it, vi } from 'vitest';

import {
  applyMutationResponseBodyToRuntime,
  applyMutationResponseChunksToRuntime,
} from './apply-mutation-response.js';
import { createQueryStore } from './client.js';
import { FakeMorphRoot, FakeMorphTarget, FakeQueryBindingElement } from './runtime-test-fakes.js';
import { readMutationResponseBodyChunks } from './wire-parser.js';

describe('decoded mutation response apply', () => {
  it('applies mutation response query chunks and returns fragment chunks for morphing', () => {
    const store = createQueryStore();
    const plan = vi.fn();

    store.subscribe('cart', plan);
    const body = [
      '<kovo-query name="cart">{"count":3}</kovo-query>',
      '<kovo-fragment target="cart-badge"><cart-badge>3</cart-badge></kovo-fragment>',
    ].join('\n');
    const applied = applyMutationResponseChunksToRuntime(readMutationResponseBodyChunks(body), {
      store,
    });

    expect(store.get('cart')).toEqual({ count: 3 });
    expect(plan).toHaveBeenCalledWith({ count: 3 });
    expect(applied).toEqual({
      fragments: [{ html: '<cart-badge>3</cart-badge>', target: 'cart-badge' }],
      queries: ['cart'],
    });
  });

  it('keeps keyed query chunks isolated by instance key', () => {
    const store = createQueryStore();
    const p1Plan = vi.fn();
    const p2Plan = vi.fn();
    const unkeyedPlan = vi.fn();

    store.subscribe('reviews', p1Plan, 'product:p1');
    store.subscribe('reviews', p2Plan, 'product:p2');
    store.subscribe('reviews', unkeyedPlan);

    const body = [
      '<kovo-query name="reviews" key="product:p1">{"items":[{"id":"r1"}]}</kovo-query>',
      '<kovo-query name="reviews" key="product:p2">{"items":[{"id":"r2"}]}</kovo-query>',
    ].join('\n');
    applyMutationResponseChunksToRuntime(readMutationResponseBodyChunks(body), {
      store,
    });

    expect(store.get('reviews')).toBeUndefined();
    expect(store.get('reviews', 'product:p1')).toEqual({ items: [{ id: 'r1' }] });
    expect(store.get('reviews', 'product:p2')).toEqual({ items: [{ id: 'r2' }] });
    expect(p1Plan).toHaveBeenCalledWith({ items: [{ id: 'r1' }] });
    expect(p2Plan).toHaveBeenCalledWith({ items: [{ id: 'r2' }] });
    expect(unkeyedPlan).not.toHaveBeenCalled();
  });

  it('applies pre-decoded chunks through the canonical runtime path', () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const count = new FakeQueryBindingElement({ 'data-bind': 'cart.count' }, '0');
    const beforeApplyQueries = vi.fn();
    root.bindings.push(count);
    root.targets.set('cart-badge', new FakeMorphTarget());

    const applied = applyMutationResponseChunksToRuntime(
      {
        fragments: [{ html: '<cart-badge>11</cart-badge>', target: 'cart-badge' }],
        queries: [{ name: 'cart', value: { count: 1 } }],
      },
      {
        applyQuery(query) {
          store.set(query.name, { count: (query.value as { count: number }).count + 10 });
          return { value: store.get(query.name) };
        },
        beforeApplyQueries,
        root,
        store,
      },
    );

    // SPEC.md §9.1/§9.4: transport-specific parsers hand decoded query and
    // fragment chunks to one runtime apply path for store writes, update plans,
    // and morphing.
    expect(applied).toEqual({
      appliedFragments: ['cart-badge'],
      fragments: [{ html: '<cart-badge>11</cart-badge>', target: 'cart-badge' }],
      queries: ['cart'],
    });
    expect(store.get('cart')).toEqual({ count: 11 });
    expect(count.textContent).toBe('11');
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>11</cart-badge>');
    expect(beforeApplyQueries).toHaveBeenCalledWith([{ name: 'cart', value: { count: 1 } }]);
  });

  it('keeps store-only apply on the hook-aware runtime apply path', () => {
    const store = createQueryStore();
    const beforeApplyQueries = vi.fn();

    // SPEC.md §9.1: store-only mutation responses and runtime apply consume the
    // same kovo-query wire chunks, so interposed values must not drift by entrypoint.
    const body = '<kovo-query name="cart" key="cart:c1">{"count":6}</kovo-query>';
    const applied = applyMutationResponseBodyToRuntime({
      applyQuery(query) {
        store.set(query.name, { count: (query.value as { count: number }).count + 10 }, query.key);
        return { value: store.get(query.name, query.key) };
      },
      beforeApplyQueries,
      body,
      store,
    });

    expect(applied).toEqual({ fragments: [], queries: ['cart:c1'] });
    expect(store.get('cart', 'cart:c1')).toEqual({ count: 16 });
    expect(beforeApplyQueries).toHaveBeenCalledWith([
      { key: 'cart:c1', name: 'cart', value: { count: 6 } },
    ]);
  });

  it('keeps runtime rootless apply store-only when DOM hooks are present', () => {
    const store = createQueryStore();
    const morph = vi.fn();

    // SPEC.md §9.1: mutation response bodies use one wire vocabulary, but
    // fragment morphing only belongs to runtime callers with an actual root.
    const body = [
      '<kovo-query name="cart">{"count":8}</kovo-query>',
      '<kovo-fragment target="cart-badge"><cart-badge>8</cart-badge></kovo-fragment>',
    ].join('\n');
    const applied = applyMutationResponseBodyToRuntime({
      body,
      morph,
      queryPlans: {
        cart: {
          bindings: false,
        },
      },
      root: undefined,
      store,
    });

    expect(applied).toEqual({
      fragments: [{ html: '<cart-badge>8</cart-badge>', target: 'cart-badge' }],
      queries: ['cart'],
    });
    expect('appliedFragments' in applied).toBe(false);
    expect(store.get('cart')).toEqual({ count: 8 });
    expect(morph).not.toHaveBeenCalled();
  });

  it('applies runtime query plans through queryRoot without enabling fragment morphing', () => {
    const store = createQueryStore();
    const queryRoot = new FakeMorphRoot();
    const count = new FakeQueryBindingElement({ 'data-bind': 'cart.count' }, '0');
    const morph = vi.fn();
    queryRoot.bindings.push(count);

    // SPEC.md §4.4/§9.1: typed reads and rootless runtime apply can refresh
    // query-bound DOM from the shared mutation vocabulary without requiring a
    // morph root for returned fragments.
    const body = [
      '<kovo-query name="cart">{"count":9}</kovo-query>',
      '<kovo-fragment target="cart-badge"><cart-badge>9</cart-badge></kovo-fragment>',
    ].join('\n');
    const applied = applyMutationResponseBodyToRuntime({
      body,
      morph,
      queryPlans: { cart: { bindings: true } },
      queryRoot,
      store,
    });

    expect(applied).toEqual({
      fragments: [{ html: '<cart-badge>9</cart-badge>', target: 'cart-badge' }],
      queries: ['cart'],
    });
    expect('appliedFragments' in applied).toBe(false);
    expect(count.textContent).toBe('9');
    expect(morph).not.toHaveBeenCalled();
  });

  it('reports query apply failures while applying later queries and fragments', () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const onError = vi.fn();
    const count = new FakeQueryBindingElement({ 'data-bind': 'cart.count' }, '0');
    root.bindings.push(count);
    root.targets.set('cart-badge', new FakeMorphTarget());

    const hookError = new Error('cart hook drift');
    const applied = applyMutationResponseBodyToRuntime({
      applyQuery(query) {
        if ((query.value as { count: number }).count === 1) throw hookError;
      },
      body: [
        '<kovo-query name="cart">{"count":1}</kovo-query>',
        '<kovo-query name="cart">{"count":2}</kovo-query>',
        '<kovo-fragment target="cart-badge"><cart-badge>2</cart-badge></kovo-fragment>',
      ].join(''),
      onError,
      root,
      store,
    });

    // SPEC.md §9.1/§9.4: mutation response queries use the same decoded runtime
    // apply primitive as hydration and typed reads, so a bad hook reports
    // through the runtime error seam without forking fragment apply.
    expect(onError).toHaveBeenCalledWith(hookError);
    expect(applied).toEqual({
      appliedFragments: ['cart-badge'],
      fragments: [{ html: '<cart-badge>2</cart-badge>', target: 'cart-badge' }],
      queries: ['cart'],
    });
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(count.textContent).toBe('2');
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>2</cart-badge>');
  });
});
