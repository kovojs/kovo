import { describe, expect, it, vi } from 'vitest';

import {
  applyDeferredStreamResponseToDom,
  applyDeferredStreamResponseToRuntime,
  applyMutationResponse,
  applyMutationResponseToDom,
  createQueryStore,
} from './index.js';
import {
  applyDeferredStreamResponseToDom as applyDeferredStreamResponseToDomFromApplyPath,
  applyDeferredStreamResponseToRuntime as applyDeferredStreamResponseToRuntimeFromApplyPath,
  applyMutationResponse as applyMutationResponseFromApplyPath,
  applyMutationResponseToRuntime,
  applyMutationResponseToDom as applyMutationResponseToDomFromApplyPath,
  applyMutationResponseToStore,
} from './apply-path.js';
import { applyDeferredStreamResponseToRuntime as applyDeferredStreamResponseToRuntimeFromDeferredModule } from './apply-deferred-stream.js';
import { applyMutationResponseToRuntime as applyMutationResponseToRuntimeFromMutationModule } from './apply-mutation-response.js';
import {
  createMutationIdem,
  isMutationBroadcastMessage,
  readMutationChangeHeader,
  sanitizeMutationChangeRecord,
} from './mutation-response.js';

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

class FakeQueryBindingElement {
  attributes: { name: string; value: string }[];
  textContent: string | null;

  constructor(attrs: Record<string, string>, textContent = '') {
    this.attributes = Object.entries(attrs).map(([name, value]) => ({ name, value }));
    this.textContent = textContent;
  }

  getAttribute(name: string): string | null {
    return this.attributes.find((attribute) => attribute.name === name)?.value ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes = this.attributes.filter((attribute) => attribute.name !== name);
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

class FakeMorphRoot {
  bindings: FakeQueryBindingElement[] = [];
  targets = new Map<string, FakeMorphTarget>();
  wildcardSelectorCalls = 0;

  findFragmentTarget(target: string): FakeMorphTarget | null {
    return this.targets.get(target) ?? null;
  }

  querySelectorAll(selector: string): FakeQueryBindingElement[] {
    if (selector === '[data-bind]') {
      return this.bindings.filter((element) => element.getAttribute('data-bind'));
    }
    if (selector === '*') {
      this.wildcardSelectorCalls += 1;
      return this.bindings;
    }
    if (selector.startsWith('[data-derive="')) {
      const value = selector.slice('[data-derive="'.length, -2);
      return this.bindings.filter((element) => element.getAttribute('data-derive') === value);
    }

    return [];
  }
}

describe('mutation response wire chunks', () => {
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

  it('reports keyed query chunks with their canonical typed-read key', () => {
    const store = createQueryStore();
    const plan = vi.fn();

    store.subscribe('product', plan, 'p1');
    const applied = applyMutationResponse(
      store,
      '<fw-query name="product" key="p1">{"stock":4}</fw-query>',
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

  it('exports canonical mutation response helpers through the runtime barrel', () => {
    expect(applyMutationResponse).toBe(applyMutationResponseFromApplyPath);
    expect(applyMutationResponse).toBe(applyMutationResponseToStore);
    expect(applyMutationResponseToDom).toBe(applyMutationResponseToDomFromApplyPath);
    expect(applyMutationResponseToRuntime).toBe(applyMutationResponseToRuntimeFromMutationModule);
  });

  it('exports deferred stream response apply through the shared apply path', () => {
    expect(applyDeferredStreamResponseToDom).toBe(applyDeferredStreamResponseToDomFromApplyPath);
    expect(applyDeferredStreamResponseToRuntime).toBe(
      applyDeferredStreamResponseToRuntimeFromApplyPath,
    );
    expect(applyDeferredStreamResponseToRuntime).toBe(
      applyDeferredStreamResponseToRuntimeFromDeferredModule,
    );

    const store = createQueryStore();
    const root = new FakeMorphRoot();
    root.targets.set('reviews:p1', new FakeMorphTarget());
    root.targets.set('recommendations:p1', new FakeMorphTarget());

    // SPEC.md §9.1: deferred stream responses reuse the mutation query/fragment
    // wire vocabulary, so stream aggregation belongs on the shared apply path.
    const applied = applyDeferredStreamResponseToDom({
      body: [
        '--jiso-boundary',
        '<fw-query name="reviews">{"items":[{"id":"r1"}]}</fw-query>',
        '<fw-fragment target="reviews:p1"><section>Reviews ready</section></fw-fragment>',
        '--jiso-boundary',
        '<fw-query name="recommendations">{"items":[{"id":"p2"}]}</fw-query>',
        '<fw-fragment target="recommendations:p1"><section>Recommendations ready</section></fw-fragment>',
        '--jiso-boundary--',
      ].join('\n'),
      root,
      store,
    });

    expect(applied.queries).toEqual(['reviews', 'recommendations']);
    expect(applied.appliedFragments).toEqual(['reviews:p1', 'recommendations:p1']);
    expect(applied.chunks).toHaveLength(2);
    expect(store.get('reviews')).toEqual({ items: [{ id: 'r1' }] });
    expect(store.get('recommendations')).toEqual({ items: [{ id: 'p2' }] });
    expect(root.targets.get('reviews:p1')?.html).toBe('<section>Reviews ready</section>');
    expect(root.targets.get('recommendations:p1')?.html).toBe(
      '<section>Recommendations ready</section>',
    );
  });

  it('keeps deferred stream chunks on the hook-aware mutation response path', () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const count = new FakeQueryBindingElement({ 'data-bind': 'cart.count' }, '0');
    const observed: string[] = [];
    const beforeApplyQueries = vi.fn();
    root.bindings.push(count);
    root.targets.set('cart-badge', new FakeMorphTarget());
    root.targets.set('cart-total', new FakeMorphTarget());

    // SPEC.md §9.1: deferred stream query chunks use the same mutation response
    // vocabulary, so interposed store truth and compiled bindings stay shared.
    const applied = applyDeferredStreamResponseToDom({
      applyQuery(query) {
        store.set(query.name, { count: (query.value as { count: number }).count + 10 }, query.key);
        return { value: store.get(query.name, query.key) };
      },
      beforeApplyQueries,
      body: [
        '--jiso-boundary',
        '<fw-query name="cart">{"count":1}</fw-query>',
        '<fw-fragment target="cart-badge"><span>badge</span></fw-fragment>',
        '--jiso-boundary',
        '<fw-query name="cart" key="cart:primary">{"count":2}</fw-query>',
        '<fw-fragment target="cart-total"><span>total</span></fw-fragment>',
        '--jiso-boundary--',
      ].join('\n'),
      morph(target, html) {
        observed.push(count.textContent ?? '');
        target.replaceWithHtml(html);
      },
      root,
      store,
    });

    expect(applied.queries).toEqual(['cart', 'cart:primary']);
    expect(applied.appliedFragments).toEqual(['cart-badge', 'cart-total']);
    expect(observed).toEqual(['11', '12']);
    expect(store.get('cart')).toEqual({ count: 11 });
    expect(store.get('cart', 'cart:primary')).toEqual({ count: 12 });
    expect(beforeApplyQueries).toHaveBeenNthCalledWith(1, [{ name: 'cart', value: { count: 1 } }]);
    expect(beforeApplyQueries).toHaveBeenNthCalledWith(2, [
      { key: 'cart:primary', name: 'cart', value: { count: 2 } },
    ]);
  });

  it('keeps the split deferred module on the mutation runtime parser', () => {
    const store = createQueryStore();
    const onError = vi.fn();
    const beforeApplyQueries = vi.fn();

    // SPEC.md §9.1: deferred stream parts carry the same fw-query/fw-fragment
    // mutation vocabulary, so the split stream module must keep routing each
    // part through the mutation response apply path.
    const applied = applyDeferredStreamResponseToRuntimeFromDeferredModule({
      beforeApplyQueries,
      body: [
        '--jiso-boundary',
        '<fw-query name="cart">{</fw-query>',
        '<fw-query name="inventory">{"available":true}</fw-query>',
        '<fw-fragment target="inventory"><section>ready</section></fw-fragment>',
        '--jiso-boundary',
        '<fw-query name="reviews">{"total":2}</fw-query>',
        '--jiso-boundary--',
      ].join('\n'),
      onError,
      root: undefined,
      store,
    });

    expect(applied).toEqual({
      chunks: [
        {
          fragments: [{ html: '<section>ready</section>', target: 'inventory' }],
          queries: ['inventory'],
        },
        {
          fragments: [],
          queries: ['reviews'],
        },
      ],
      fragments: [{ html: '<section>ready</section>', target: 'inventory' }],
      queries: ['inventory', 'reviews'],
    });
    expect(store.get('cart')).toBeUndefined();
    expect(store.get('inventory')).toEqual({ available: true });
    expect(store.get('reviews')).toEqual({ total: 2 });
    expect(beforeApplyQueries).toHaveBeenNthCalledWith(1, [
      { name: 'inventory', value: { available: true } },
    ]);
    expect(beforeApplyQueries).toHaveBeenNthCalledWith(2, [
      { name: 'reviews', value: { total: 2 } },
    ]);
    expect(String(onError.mock.calls[0]?.[0].message)).toContain('Malformed JSON in fw-query cart');
  });

  it('keeps rootless deferred streams on the hook-aware runtime apply path', () => {
    const store = createQueryStore();
    const beforeApplyQueries = vi.fn();
    const morph = vi.fn();

    // SPEC.md §9.1: deferred stream chunks reuse mutation response wire
    // vocabulary, so rootless stream forwarding still applies query truth.
    const applied = applyDeferredStreamResponseToRuntime({
      applyQuery(query) {
        store.set(query.name, { count: (query.value as { count: number }).count + 5 }, query.key);
        return { value: store.get(query.name, query.key) };
      },
      beforeApplyQueries,
      body: [
        '--jiso-boundary',
        '<fw-query name="cart">{"count":1}</fw-query>',
        '<fw-fragment target="cart-badge"><span>badge</span></fw-fragment>',
        '--jiso-boundary',
        '<fw-query name="cart" key="cart:primary">{"count":2}</fw-query>',
        '<fw-fragment target="cart-total"><span>total</span></fw-fragment>',
        '--jiso-boundary--',
      ].join('\n'),
      morph,
      root: undefined,
      store,
    });

    expect(applied).toEqual({
      chunks: [
        {
          fragments: [{ html: '<span>badge</span>', target: 'cart-badge' }],
          queries: ['cart'],
        },
        {
          fragments: [{ html: '<span>total</span>', target: 'cart-total' }],
          queries: ['cart:primary'],
        },
      ],
      fragments: [
        { html: '<span>badge</span>', target: 'cart-badge' },
        { html: '<span>total</span>', target: 'cart-total' },
      ],
      queries: ['cart', 'cart:primary'],
    });
    expect('appliedFragments' in applied).toBe(false);
    expect(store.get('cart')).toEqual({ count: 6 });
    expect(store.get('cart', 'cart:primary')).toEqual({ count: 7 });
    expect(morph).not.toHaveBeenCalled();
    expect(beforeApplyQueries).toHaveBeenNthCalledWith(1, [{ name: 'cart', value: { count: 1 } }]);
    expect(beforeApplyQueries).toHaveBeenNthCalledWith(2, [
      { key: 'cart:primary', name: 'cart', value: { count: 2 } },
    ]);
  });

  it('accepts escaped JSON from text/html-compatible fw-query chunks', () => {
    const store = createQueryStore();

    applyMutationResponse(
      store,
      '<fw-query name="cart">{&quot;count&quot;:4,&quot;label&quot;:&quot;Alice&#39;s &amp; Bob&apos;s&quot;}</fw-query>',
    );

    expect(store.get('cart')).toEqual({ count: 4, label: "Alice's & Bob's" });
  });

  it('accepts single-quoted chunk attributes', () => {
    const store = createQueryStore();
    const applied = applyMutationResponse(
      store,
      [
        "<fw-query name='cart' key='cart:c1'>{\"count\":4}</fw-query>",
        "<fw-fragment target='cart-list' mode='append'><li>p1</li></fw-fragment>",
      ].join(''),
    );

    expect(store.get('cart', 'cart:c1')).toEqual({ count: 4 });
    expect(applied).toEqual({
      fragments: [{ html: '<li>p1</li>', mode: 'append', target: 'cart-list' }],
      queries: ['cart:c1'],
    });
  });

  it('keeps quoted query attribute tag closers on the store apply path', () => {
    const store = createQueryStore();
    const applied = applyMutationResponse(
      store,
      '<fw-query name="product" key="product>p1">{"stock":7}</fw-query>',
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
    const storeOnlyApplied = applyMutationResponse(storeOnly, body);
    const domApplied = applyMutationResponseToDom({ body, root, store: domStore });

    expect(domStore.get('cart', 'cart:c1')).toEqual(storeOnly.get('cart', 'cart:c1'));
    expect(domApplied.queries).toEqual(storeOnlyApplied.queries);
    expect(domApplied.fragments).toEqual(storeOnlyApplied.fragments);
  });

  it('keeps store-only apply on the hook-aware runtime apply path', () => {
    const store = createQueryStore();
    const beforeApplyQueries = vi.fn();

    // SPEC.md §9.1: store-only mutation responses and runtime apply consume the
    // same fw-query wire chunks, so interposed values must not drift by entrypoint.
    const applied = applyMutationResponse(
      store,
      '<fw-query name="cart" key="cart:c1">{"count":6}</fw-query>',
      {
        applyQuery(query) {
          store.set(
            query.name,
            { count: (query.value as { count: number }).count + 10 },
            query.key,
          );
          return { value: store.get(query.name, query.key) };
        },
        beforeApplyQueries,
      },
    );

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

  it('routes runtime store-only apply through the shared mutation response helper', () => {
    const store = createQueryStore();
    const plan = vi.fn();

    store.subscribe('cart', plan);
    const applied = applyMutationResponseToRuntime({
      body: '<fw-query name="cart">{"count":6}</fw-query>',
      store,
    });

    expect(applied).toEqual({ fragments: [], queries: ['cart'] });
    expect(store.get('cart')).toEqual({ count: 6 });
    expect(plan).toHaveBeenCalledWith({ count: 6 });
  });

  it('keeps runtime store-only apply on the hook-aware mutation response path', () => {
    const store = createQueryStore();
    const beforeApplyQueries = vi.fn();

    // SPEC.md §9.1: fw-query chunks are the mutation response vocabulary on
    // every runtime apply path, including store-only multi-tab sync.
    const applied = applyMutationResponseToRuntime({
      applyQuery(query) {
        store.set(query.name, { count: (query.value as { count: number }).count + 10 }, query.key);
        return { value: store.get(query.name, query.key) };
      },
      beforeApplyQueries,
      body: '<fw-query name="cart" key="cart:c1">{"count":6}</fw-query>',
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
    const applied = applyMutationResponseToRuntime({
      body: [
        '<fw-query name="cart">{"count":8}</fw-query>',
        '<fw-fragment target="cart-badge"><cart-badge>8</cart-badge></fw-fragment>',
      ].join('\n'),
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

  it('reports malformed chunks on the runtime store-only apply path', () => {
    const store = createQueryStore();
    const onError = vi.fn();

    // SPEC.md §9.1 keeps query and fragment chunks in one response body; the
    // store-only runtime path should still parse both through the shared reader.
    const applied = applyMutationResponseToRuntime({
      body: [
        '<fw-query name="cart">{</fw-query>',
        '<fw-query name="inventory">{"available":true}</fw-query>',
        '<fw-fragment target="cart-badge"><cart-badge>Ready</cart-badge>',
      ].join('\n'),
      onError,
      store,
    });

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

    const applied = applyMutationResponseToRuntime({
      applyQuery(query) {
        store.set(query.name, { count: (query.value as { count: number }).count + 20 }, query.key);
        return { value: store.get(query.name, query.key) };
      },
      beforeApplyQueries,
      body: [
        '<fw-query name="cart">{"count":7}</fw-query>',
        '<fw-fragment target="cart-badge"><cart-badge>27</cart-badge></fw-fragment>',
      ].join('\n'),
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
    const applied = applyMutationResponse(
      store,
      [
        '<fw-query name="cart">{</fw-query>',
        '<fw-query name="inventory">{"available":true}</fw-query>',
        '<fw-fragment target="cart-badge"><cart-badge>Ready</cart-badge></fw-fragment>',
      ].join('\n'),
    );

    expect(store.get('cart')).toBeUndefined();
    expect(store.get('inventory')).toEqual({ available: true });
    expect(applied).toEqual({
      fragments: [{ html: '<cart-badge>Ready</cart-badge>', target: 'cart-badge' }],
      queries: ['inventory'],
    });
  });

  it('keeps nested fw-fragment children inside their parent fragment chunk', () => {
    const store = createQueryStore();
    const applied = applyMutationResponse(
      store,
      [
        '<fw-fragment target="cart-badge">',
        '<cart-badge><span>1</span><fw-fragment target="nested"><span>nested</span></fw-fragment></cart-badge>',
        '</fw-fragment>',
      ].join(''),
    );

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

  it('reports malformed FW-Changes headers through the mutation response error hook', () => {
    const onError = vi.fn();

    // SPEC.md §9.1: FW-Changes is sanitized mutation response wire metadata.
    expect(
      readMutationChangeHeader(
        {
          headers: {
            get(name: string) {
              return name === 'FW-Changes' ? '[' : null;
            },
          },
        },
        onError,
      ),
    ).toEqual([]);

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(String(onError.mock.calls[0]?.[0].message)).toContain(
      'Malformed JSON in FW-Changes header',
    );
  });

  it('creates mutation idempotency keys from crypto or the local fallback', () => {
    const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    try {
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: { randomUUID: () => 'crypto-idem' },
      });

      expect(createMutationIdem()).toBe('crypto-idem');

      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: undefined,
      });

      // SPEC.md §9.1: generated enhanced mutation requests always carry FW-Idem.
      const firstFallback = createMutationIdem();
      const secondFallback = createMutationIdem();
      expect(firstFallback).toMatch(/^idem_loyw3v28_[0-9a-z]+$/);
      expect(secondFallback).toMatch(/^idem_loyw3v28_[0-9a-z]+$/);
      expect(secondFallback).not.toBe(firstFallback);
    } finally {
      now.mockRestore();
      if (cryptoDescriptor) {
        Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
      } else {
        delete (globalThis as { crypto?: unknown }).crypto;
      }
    }
  });

  it('sanitizes mutation change records before broadcast publication and acceptance', () => {
    expect(
      sanitizeMutationChangeRecord({
        domain: 'cart',
        input: { productId: 'p1' },
        keys: ['cart'],
        stack: 'hidden',
      }),
    ).toEqual({ domain: 'cart', keys: ['cart'] });
    expect(sanitizeMutationChangeRecord({ domain: 'cart', keys: [1] })).toBeNull();
    expect(
      isMutationBroadcastMessage({
        body: '<fw-query name="cart">{"count":1}</fw-query>',
        changes: [{ domain: 'cart', keys: ['cart'] }],
        type: 'jiso:mutation-response',
      }),
    ).toBe(true);
    expect(
      isMutationBroadcastMessage({
        body: '<fw-query name="cart">{"count":1}</fw-query>',
        changes: [{ domain: 'cart', keys: [1] }],
        type: 'jiso:mutation-response',
      }),
    ).toBe(false);
  });
});
