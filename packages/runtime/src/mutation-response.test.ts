import { describe, expect, it, vi } from 'vitest';

import { applyMutationResponseToDom, createQueryStore } from './index.js';
import { applyMutationResponseChunksToRuntime } from './apply-mutation-response.js';
import {
  FakeMorphRoot,
  FakeMorphTarget,
  FakeQueryBindingElement,
  FakeQueryPlanElement,
} from './runtime-test-fakes.js';
import { readMutationResponseBodyChunks } from './wire-parser.js';

describe('mutation response wire chunks', () => {
  it('applies mutation response query chunks and returns fragment chunks for morphing', () => {
    const store = createQueryStore();
    const plan = vi.fn();

    store.subscribe('cart', plan);
    const body = [
      '<fw-query name="cart">{"count":3}</fw-query>',
      '<fw-fragment target="cart-badge"><cart-badge>3</cart-badge></fw-fragment>',
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

  it('reports keyed query chunks with their canonical typed-read key', () => {
    const store = createQueryStore();
    const plan = vi.fn();

    store.subscribe('product', plan, 'p1');
    const applied = applyMutationResponseChunksToRuntime(
      readMutationResponseBodyChunks('<fw-query name="product" key="p1">{"stock":4}</fw-query>'),
      { store },
    );

    // SPEC.md §9.4: query instance keys are the shared currency for store, wire,
    // optimistic transforms, and refetch-on-focus typed reads.
    expect(store.get('product', 'p1')).toEqual({ stock: 4 });
    expect(store.get('product')).toBeUndefined();
    expect(plan).toHaveBeenCalledWith({ stock: 4 });
    expect(applied).toEqual({
      fragments: [],
      queries: ['product:p1'],
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
      '<fw-query name="reviews" key="product:p1">{"items":[{"id":"r1"}]}</fw-query>',
      '<fw-query name="reviews" key="product:p2">{"items":[{"id":"r2"}]}</fw-query>',
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

  it('accepts escaped JSON from text/html-compatible fw-query chunks', () => {
    const store = createQueryStore();

    applyMutationResponseChunksToRuntime(
      readMutationResponseBodyChunks(
        '<fw-query name="cart">{&quot;count&quot;:4,&quot;label&quot;:&quot;Alice&#39;s &amp; Bob&apos;s&quot;}</fw-query>',
      ),
      { store },
    );

    expect(store.get('cart')).toEqual({ count: 4, label: "Alice's & Bob's" });
  });

  it('accepts single-quoted chunk attributes', () => {
    const store = createQueryStore();
    const body = [
      "<fw-query name='cart' key='cart:c1'>{\"count\":4}</fw-query>",
      "<fw-fragment target='cart-list' mode='append'><li>p1</li></fw-fragment>",
    ].join('');
    const applied = applyMutationResponseChunksToRuntime(readMutationResponseBodyChunks(body), {
      store,
    });

    expect(store.get('cart', 'cart:c1')).toEqual({ count: 4 });
    expect(applied).toEqual({
      fragments: [{ html: '<li>p1</li>', mode: 'append', target: 'cart-list' }],
      queries: ['cart:c1'],
    });
  });

  it('keeps quoted query attribute tag closers on the store apply path', () => {
    const store = createQueryStore();
    const applied = applyMutationResponseChunksToRuntime(
      readMutationResponseBodyChunks(
        '<fw-query name="product" key="product>p1">{"stock":7}</fw-query>',
      ),
      { store },
    );

    // SPEC.md §9.4: keyed query chunks must hydrate the same instance key that
    // inline DOM parsing exposes from the wire attribute.
    expect(store.get('product', 'product>p1')).toEqual({ stock: 7 });
    expect(applied).toEqual({
      fragments: [],
      queries: ['product:product>p1'],
    });
  });

  it('keeps store-only and DOM apply on the same keyed query path', () => {
    const storeOnly = createQueryStore();
    const domStore = createQueryStore();
    const root = new FakeMorphRoot();
    const body = [
      '<fw-query name="cart" key="cart:c1">{"count":5}</fw-query>',
      '<fw-fragment target="cart-list" mode="append"><li>p1</li></fw-fragment>',
    ].join('');

    // SPEC.md §9.1: mutation responses carry query patches and fragment patches together.
    const storeOnlyApplied = applyMutationResponseChunksToRuntime(
      readMutationResponseBodyChunks(body),
      { store: storeOnly },
    );
    const domApplied = applyMutationResponseToDom({ body, root, store: domStore });

    expect(domStore.get('cart', 'cart:c1')).toEqual(storeOnly.get('cart', 'cart:c1'));
    expect(domApplied.queries).toEqual(storeOnlyApplied.queries);
    expect(domApplied.fragments).toEqual(storeOnlyApplied.fragments);
  });

  it('applies pre-decoded mutation response chunks through the canonical runtime path', () => {
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
    // same fw-query wire chunks, so interposed values must not drift by entrypoint.
    const body = '<fw-query name="cart" key="cart:c1">{"count":6}</fw-query>';
    const applied = applyMutationResponseChunksToRuntime(readMutationResponseBodyChunks(body), {
      applyQuery(query) {
        store.set(query.name, { count: (query.value as { count: number }).count + 10 }, query.key);
        return { value: store.get(query.name, query.key) };
      },
      beforeApplyQueries,
      store,
    });

    expect(applied).toEqual({ fragments: [], queries: ['cart:c1'] });
    expect(store.get('cart', 'cart:c1')).toEqual({ count: 16 });
    expect(beforeApplyQueries).toHaveBeenCalledWith([
      { key: 'cart:c1', name: 'cart', value: { count: 6 } },
    ]);
  });

  it('reuses one attribute binding scan across multi-query DOM apply', () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const cartLabel = new FakeQueryBindingElement({
      'aria-label': 'old cart',
      'data-bind:aria-label': 'cart.label',
    });
    const productLabel = new FakeQueryBindingElement({
      'aria-label': 'old product',
      'data-bind:aria-label': 'product.label',
    });
    root.bindings.push(cartLabel, productLabel);

    // SPEC.md §9.1 mutation bodies may carry multiple query chunks before any
    // fragment morphing; those chunks should share one §4.8 binding index.
    const applied = applyMutationResponseToDom({
      body: [
        '<fw-query name="cart">{"label":"Cart ready"}</fw-query>',
        '<fw-query name="product">{"label":"Product ready"}</fw-query>',
      ].join('\n'),
      root,
      store,
    });

    expect(applied.queries).toEqual(['cart', 'product']);
    expect(root.wildcardSelectorCalls).toBe(1);
    expect(cartLabel.getAttribute('aria-label')).toBe('Cart ready');
    expect(productLabel.getAttribute('aria-label')).toBe('Product ready');
  });

  it('applies query update bindings from mutation chunks without requiring a fragment', () => {
    const root = new FakeMorphRoot();
    const store = createQueryStore();
    const count = new FakeQueryBindingElement('cart.count', { textContent: '1' });
    const total = new FakeQueryBindingElement('cart.total', { value: '1499' });
    const product = new FakeQueryBindingElement('product.name', { textContent: 'Coffee' });
    root.bindings.push(count, total, product);

    const result = applyMutationResponseToDom({
      body: '<fw-query name="cart">{"count":2,"total":2998}</fw-query>',
      root,
      store,
    });

    expect(result).toEqual({
      appliedFragments: [],
      fragments: [],
      queries: ['cart'],
    });
    expect(count.textContent).toBe('2');
    expect(total.value).toBe('2998');
    expect(product.textContent).toBe('Coffee');
  });

  it('applies mutation query chunks through compiled update plans before morphing', () => {
    const root = new FakeMorphRoot();
    const store = createQueryStore();
    const count = new FakeQueryBindingElement('cart.count', { textContent: '1' });
    const summary = new FakeQueryPlanElement({ 'data-derive': 'cart.summary' });
    const host = new FakeQueryPlanElement({ 'data-plan': 'cart-host' });
    const observed: string[] = [];
    root.bindings.push(count);
    root.planElements.push(summary, host);
    root.targets.set('cart-badge', new FakeMorphTarget());

    applyMutationResponseToDom({
      body: [
        '<fw-query name="cart">{"count":5}</fw-query>',
        '<fw-fragment target="cart-badge"><cart-badge>Ready</cart-badge></fw-fragment>',
      ].join('\n'),
      morph(target, html) {
        observed.push(
          `morph:${count.textContent}:${summary.textContent}:${host.getAttribute('data-count')}`,
        );
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
          stamps: [
            {
              attr: 'data-count',
              selector: '[data-plan="cart-host"]',
              select: (value) => (value as { count: number }).count,
            },
          ],
        },
      },
      root,
      store,
    });

    expect(observed).toEqual(['morph:5:5 items:5']);
  });

  it('routes runtime store-only apply through the shared mutation response helper', () => {
    const store = createQueryStore();
    const plan = vi.fn();

    store.subscribe('cart', plan);
    const applied = applyMutationResponseChunksToRuntime(
      readMutationResponseBodyChunks('<fw-query name="cart">{"count":6}</fw-query>'),
      { store },
    );

    expect(applied).toEqual({ fragments: [], queries: ['cart'] });
    expect(store.get('cart')).toEqual({ count: 6 });
    expect(plan).toHaveBeenCalledWith({ count: 6 });
  });

  it('keeps runtime rootless apply store-only when DOM hooks are present', () => {
    const store = createQueryStore();
    const morph = vi.fn();

    // SPEC.md §9.1: mutation response bodies use one wire vocabulary, but
    // fragment morphing only belongs to runtime callers with an actual root.
    const body = [
      '<fw-query name="cart">{"count":8}</fw-query>',
      '<fw-fragment target="cart-badge"><cart-badge>8</cart-badge></fw-fragment>',
    ].join('\n');
    const applied = applyMutationResponseChunksToRuntime(readMutationResponseBodyChunks(body), {
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
      '<fw-query name="cart">{"count":9}</fw-query>',
      '<fw-fragment target="cart-badge"><cart-badge>9</cart-badge></fw-fragment>',
    ].join('\n');
    const applied = applyMutationResponseChunksToRuntime(readMutationResponseBodyChunks(body), {
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

  it('reports malformed chunks on the runtime store-only apply path', () => {
    const store = createQueryStore();
    const onError = vi.fn();

    // SPEC.md §9.1 keeps query and fragment chunks in one response body; the
    // store-only runtime path should still parse both through the shared reader.
    const body = [
      '<fw-query name="cart">{</fw-query>',
      '<fw-query name="inventory">{"available":true}</fw-query>',
      '<fw-fragment target="cart-badge"><cart-badge>Ready</cart-badge>',
    ].join('\n');
    const applied = applyMutationResponseChunksToRuntime(
      readMutationResponseBodyChunks(body, onError),
      { onError, store },
    );

    expect(applied).toEqual({
      fragments: [],
      queries: ['inventory'],
    });
    expect(store.get('cart')).toBeUndefined();
    expect(store.get('inventory')).toEqual({ available: true });
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls.map(([error]) => String(error.message))).toEqual([
      expect.stringContaining('Malformed JSON in fw-query cart'),
      expect.stringContaining('Malformed fw-fragment chunk'),
    ]);
  });

  it('routes runtime DOM apply through the shared mutation response helper', () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const beforeApplyQueries = vi.fn();
    const count = new FakeQueryBindingElement({ 'data-bind': 'cart.count' }, '0');
    root.bindings.push(count);
    root.targets.set('cart-badge', new FakeMorphTarget());

    const body = [
      '<fw-query name="cart">{"count":7}</fw-query>',
      '<fw-fragment target="cart-badge"><cart-badge>27</cart-badge></fw-fragment>',
    ].join('\n');
    const applied = applyMutationResponseChunksToRuntime(readMutationResponseBodyChunks(body), {
      applyQuery(query) {
        store.set(query.name, { count: (query.value as { count: number }).count + 20 }, query.key);
        return { value: store.get(query.name, query.key) };
      },
      beforeApplyQueries,
      root,
      store,
    });

    expect(applied).toEqual({
      appliedFragments: ['cart-badge'],
      fragments: [{ html: '<cart-badge>27</cart-badge>', target: 'cart-badge' }],
      queries: ['cart'],
    });
    expect(store.get('cart')).toEqual({ count: 27 });
    expect(count.textContent).toBe('27');
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>27</cart-badge>');
    expect(beforeApplyQueries).toHaveBeenCalledWith([{ name: 'cart', value: { count: 7 } }]);
  });

  it('skips malformed mutation query chunks and continues applying valid chunks', () => {
    const store = createQueryStore();
    const body = [
      '<fw-query name="cart">{</fw-query>',
      '<fw-query name="inventory">{"available":true}</fw-query>',
      '<fw-fragment target="cart-badge"><cart-badge>Ready</cart-badge></fw-fragment>',
    ].join('\n');
    const applied = applyMutationResponseChunksToRuntime(readMutationResponseBodyChunks(body), {
      store,
    });

    expect(store.get('cart')).toBeUndefined();
    expect(store.get('inventory')).toEqual({ available: true });
    expect(applied).toEqual({
      fragments: [{ html: '<cart-badge>Ready</cart-badge>', target: 'cart-badge' }],
      queries: ['inventory'],
    });
  });

  it('keeps nested fw-fragment children inside their parent fragment chunk', () => {
    const store = createQueryStore();
    const body = [
      '<fw-fragment target="cart-badge">',
      '<cart-badge><span>1</span><fw-fragment target="nested"><span>nested</span></fw-fragment></cart-badge>',
      '</fw-fragment>',
    ].join('');
    const applied = applyMutationResponseChunksToRuntime(readMutationResponseBodyChunks(body), {
      store,
    });

    expect(applied).toEqual({
      fragments: [
        {
          html: '<cart-badge><span>1</span><fw-fragment target="nested"><span>nested</span></fw-fragment></cart-badge>',
          target: 'cart-badge',
        },
      ],
      queries: [],
    });
  });

  it('reports malformed mutation query chunks while applying valid DOM updates', () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const onError = vi.fn();
    root.targets.set('cart-badge', new FakeMorphTarget());

    const applied = applyMutationResponseToDom({
      body: [
        '<fw-query name="cart">{</fw-query>',
        '<fw-query name="inventory">{"available":true}</fw-query>',
        '<fw-fragment target="cart-badge"><cart-badge>Ready</cart-badge></fw-fragment>',
      ].join('\n'),
      onError,
      root,
      store,
    });

    expect(store.get('cart')).toBeUndefined();
    expect(store.get('inventory')).toEqual({ available: true });
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>Ready</cart-badge>');
    expect(applied.queries).toEqual(['inventory']);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('reports malformed mutation fragment chunks through the DOM error hook', () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const onError = vi.fn();
    root.targets.set('cart-badge', new FakeMorphTarget());

    // SPEC section 9.1 defines fw-fragment as mutation response wire vocabulary.
    const applied = applyMutationResponseToDom({
      body: [
        '<fw-query name="cart">{"count":3}</fw-query>',
        '<fw-fragment target="cart-badge"><cart-badge>3</cart-badge></fw-fragment>',
        '<fw-fragment target="cart-list"><li>stale</li>',
      ].join('\n'),
      onError,
      root,
      store,
    });

    expect(store.get('cart')).toEqual({ count: 3 });
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>3</cart-badge>');
    expect(applied).toEqual({
      appliedFragments: ['cart-badge'],
      fragments: [{ html: '<cart-badge>3</cart-badge>', target: 'cart-badge' }],
      queries: ['cart'],
    });
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(String(onError.mock.calls[0]?.[0].message)).toContain('Malformed fw-fragment chunk');
  });

  it('applies interposed query values through compiled plans before morphing fragments', () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const count = new FakeQueryBindingElement({ 'data-bind': 'cart.count' }, '0');
    const summary = new FakeQueryBindingElement({ 'data-derive': 'cart.summary' });
    const observed: string[] = [];
    root.bindings.push(count, summary);
    root.targets.set('cart-badge', new FakeMorphTarget());

    const applied = applyMutationResponseToDom({
      applyQuery(query) {
        store.set(query.name, { count: (query.value as { count: number }).count + 10 }, query.key);
        return { value: store.get(query.name, query.key) };
      },
      body: [
        '<fw-query name="cart">{"count":5}</fw-query>',
        '<fw-fragment target="cart-badge"><cart-badge>ready</cart-badge></fw-fragment>',
      ].join('\n'),
      morph(target, html) {
        observed.push(`${count.textContent}:${summary.textContent}`);
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

    expect(applied).toEqual({
      appliedFragments: ['cart-badge'],
      fragments: [{ html: '<cart-badge>ready</cart-badge>', target: 'cart-badge' }],
      queries: ['cart'],
    });
    expect(store.get('cart')).toEqual({ count: 15 });
    expect(count.textContent).toBe('15');
    expect(summary.textContent).toBe('15 items');
    expect(observed).toEqual(['15:15 items']);
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>ready</cart-badge>');
  });
});
