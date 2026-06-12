import { describe, expect, it, vi } from 'vitest';

import {
  applyDeferredChunk,
  applyDeferredChunkToDom,
  applyDeferredStreamResponseToDom,
  applyMutationResponse,
  applyMutationResponseToDom,
  createQueryStore,
} from './index.js';
import {
  applyDeferredChunk as applyDeferredChunkFromApplyPath,
  applyDeferredChunkToDom as applyDeferredChunkToDomFromApplyPath,
  applyDeferredStreamResponseToDom as applyDeferredStreamResponseToDomFromApplyPath,
  applyMutationResponse as applyMutationResponseFromApplyPath,
  applyMutationResponseToRuntime,
  applyMutationResponseToStore,
} from './apply-path.js';
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

  it('exports deferred chunk helpers as aliases of the mutation response helpers', () => {
    expect(applyDeferredChunk).toBe(applyMutationResponse);
    expect(applyDeferredChunkToDom).toBe(applyMutationResponseToDom);
    expect(applyMutationResponse).toBe(applyMutationResponseFromApplyPath);
    expect(applyMutationResponseFromApplyPath).toBe(applyMutationResponseToStore);
    expect(applyDeferredChunk).toBe(applyDeferredChunkFromApplyPath);
    expect(applyDeferredChunkToDom).toBe(applyDeferredChunkToDomFromApplyPath);
  });

  it('exports deferred stream response apply through the shared apply path', () => {
    expect(applyDeferredStreamResponseToDom).toBe(applyDeferredStreamResponseToDomFromApplyPath);

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
      queries: ['cart'],
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

    expect(applied).toEqual({ fragments: [], queries: ['cart'] });
    expect(store.get('cart', 'cart:c1')).toEqual({ count: 16 });
    expect(beforeApplyQueries).toHaveBeenCalledWith([
      { key: 'cart:c1', name: 'cart', value: { count: 6 } },
    ]);
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
    const count = new FakeQueryBindingElement({ 'data-bind': 'cart.count' }, '0');
    root.bindings.push(count);
    root.targets.set('cart-badge', new FakeMorphTarget());

    const applied = applyMutationResponseToRuntime({
      body: [
        '<fw-query name="cart">{"count":7}</fw-query>',
        '<fw-fragment target="cart-badge"><cart-badge>7</cart-badge></fw-fragment>',
      ].join('\n'),
      root,
      store,
    });

    expect(applied).toEqual({
      appliedFragments: ['cart-badge'],
      fragments: [{ html: '<cart-badge>7</cart-badge>', target: 'cart-badge' }],
      queries: ['cart'],
    });
    expect(store.get('cart')).toEqual({ count: 7 });
    expect(count.textContent).toBe('7');
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>7</cart-badge>');
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
