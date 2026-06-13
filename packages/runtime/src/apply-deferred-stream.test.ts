import { describe, expect, it, vi } from 'vitest';

import { applyDeferredStreamResponseToRuntime as applyDeferredStreamResponseToRuntimeFromDeferredModule } from './apply-deferred-stream.js';
import {
  applyDeferredStreamResponseToDom,
  applyDeferredStreamResponseToRuntime,
  createQueryStore,
} from './index.js';

class FakeMorphTarget {
  html: string;

  constructor(html = '') {
    this.html = html;
  }

  replaceWithHtml(html: string): void {
    this.html = html;
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

  findFragmentTarget(target: string): FakeMorphTarget | null {
    return this.targets.get(target) ?? null;
  }

  querySelectorAll(selector: string): FakeQueryBindingElement[] {
    if (selector === '[data-bind]') {
      return this.bindings.filter((element) => element.getAttribute('data-bind'));
    }
    if (selector === '*') return this.bindings;

    return [];
  }
}

describe('deferred stream response apply', () => {
  it('exports deferred stream response apply through the runtime barrel', () => {
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
});
