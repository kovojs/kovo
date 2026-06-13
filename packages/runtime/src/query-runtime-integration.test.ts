import { describe, expect, it, vi } from 'vitest';

import { applyMutationResponseChunksToRuntime } from './apply-mutation-response.js';
import {
  applyDeferredStreamResponseToRuntime,
  applyMutationResponseToDom,
  createQueryStore,
  derive,
  installPagehideOptimismCleanup,
} from './index.js';
import {
  FakeMorphRoot,
  FakeMorphTarget,
  FakeQueryBindingElement,
  FakeQueryPlanElement,
  FakeRoot,
} from './runtime-test-fakes.js';
import { readMutationResponseBodyChunks } from './wire-parser.js';

describe('query runtime integration', () => {
  it('registers pagehide optimism cleanup without unload handlers', () => {
    const root = new FakeRoot();
    const discardPendingOptimism = vi.fn();

    installPagehideOptimismCleanup({ discardPendingOptimism, root });

    expect(root.listeners.has('pagehide')).toBe(true);
    expect(root.listeners.has('unload')).toBe(false);

    void root.listeners.get('pagehide')?.({ target: null, type: 'pagehide' });

    expect(discardPendingOptimism).toHaveBeenCalledTimes(1);
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

  it('applies query update bindings from deferred chunks before morphing', () => {
    const root = new FakeMorphRoot();
    const store = createQueryStore();
    const count = new FakeQueryBindingElement('cart.count', { textContent: '1' });
    const observed: string[] = [];
    root.bindings.push(count);
    root.targets.set('cart-badge', new FakeMorphTarget());

    applyMutationResponseToDom({
      body: [
        '<fw-query name="cart">{"count":4}</fw-query>',
        '<fw-fragment target="cart-badge"><cart-badge>Ready</cart-badge></fw-fragment>',
      ].join('\n'),
      morph(target, html) {
        observed.push(`binding:${count.textContent}`);
        target.replaceWithHtml(html);
      },
      root,
      store,
    });

    expect(observed).toEqual(['binding:4']);
  });

  it('declares named derive inputs beside the pure derive function', () => {
    const isEmpty = derive(['cart'], (cart) => (cart as { count: number }).count === 0);

    expect(isEmpty.inputs).toEqual(['cart']);
    expect(isEmpty.run({ count: 0 })).toBe(true);
    expect(isEmpty.run({ count: 2 })).toBe(false);
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

  it('lets mutation DOM apply interpose query writes before compiled plans run', () => {
    const root = new FakeMorphRoot();
    const store = createQueryStore();
    const count = new FakeQueryBindingElement('cart.count', { textContent: '0' });
    const observedQueries: string[] = [];
    root.bindings.push(count);

    const result = applyMutationResponseToDom({
      applyQuery(query) {
        observedQueries.push(`${query.name}:${query.key ?? ''}`);
        store.set(query.name, { count: (query.value as { count: number }).count + 10 }, query.key);
        return { value: store.get(query.name, query.key) };
      },
      body: '<fw-query name="cart">{"count":5}</fw-query>',
      queryPlans: { cart: { bindings: true } },
      root,
      store,
    });

    expect(result.queries).toEqual(['cart']);
    expect(observedQueries).toEqual(['cart:']);
    expect(store.get('cart')).toEqual({ count: 15 });
    expect(count.textContent).toBe('15');
  });

  it('applies deferred stream chunks through the same query and fragment parser', () => {
    const store = createQueryStore();
    const plan = vi.fn();
    store.subscribe('reviews', plan, 'product:p1');

    const body = [
      '<fw-query name="reviews" key="product:p1">{"items":[{"id":"r1","rating":5}]}</fw-query>',
      '<fw-fragment target="reviews:p1"><section fw-c="reviews">Ready</section></fw-fragment>',
    ].join('\n');
    const applied = applyMutationResponseChunksToRuntime(readMutationResponseBodyChunks(body), {
      store,
    });

    expect(store.get('reviews')).toBeUndefined();
    expect(store.get('reviews', 'product:p1')).toEqual({ items: [{ id: 'r1', rating: 5 }] });
    expect(plan).toHaveBeenCalledWith({ items: [{ id: 'r1', rating: 5 }] });
    expect(applied).toEqual({
      fragments: [{ html: '<section fw-c="reviews">Ready</section>', target: 'reviews:p1' }],
      queries: ['reviews:product:p1'],
    });
  });

  it('skips malformed deferred query chunks while applying valid fragments', () => {
    const store = createQueryStore();
    const body = [
      '<fw-query name="reviews">{</fw-query>',
      '<fw-query name="recommendations">{"items":[{"id":"p2"}]}</fw-query>',
      '<fw-fragment target="reviews:p1"><section>Ready</section></fw-fragment>',
    ].join('\n');
    const applied = applyMutationResponseChunksToRuntime(readMutationResponseBodyChunks(body), {
      store,
    });

    expect(store.get('reviews')).toBeUndefined();
    expect(store.get('recommendations')).toEqual({ items: [{ id: 'p2' }] });
    expect(applied).toEqual({
      fragments: [{ html: '<section>Ready</section>', target: 'reviews:p1' }],
      queries: ['recommendations'],
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

  it('updates deferred query data before morphing deferred fragments', () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const observed: string[] = [];
    root.targets.set('reviews:p1', new FakeMorphTarget());
    store.subscribe('reviews', (value) => {
      observed.push(`plan:${JSON.stringify(value)}`);
    });

    const result = applyMutationResponseToDom({
      body: [
        '<fw-query name="reviews">{"items":[{"id":"r1"}]}</fw-query>',
        '<fw-fragment target="reviews:p1"><link rel="stylesheet" href="/assets/reviews.css"><section>Ready</section></fw-fragment>',
      ].join('\n'),
      morph(target, html) {
        observed.push(`morph:${JSON.stringify(store.get('reviews'))}`);
        target.replaceWithHtml(html);
      },
      root,
      store,
    });

    expect(observed).toEqual(['plan:{"items":[{"id":"r1"}]}', 'morph:{"items":[{"id":"r1"}]}']);
    expect(result).toEqual({
      appliedFragments: ['reviews:p1'],
      fragments: [
        {
          html: '<link rel="stylesheet" href="/assets/reviews.css"><section>Ready</section>',
          target: 'reviews:p1',
        },
      ],
      queries: ['reviews'],
    });
    expect(root.targets.get('reviews:p1')?.html).toContain('/assets/reviews.css');
  });

  it('applies full deferred stream responses in boundary order', () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const observed: string[] = [];
    const reviewsSummary = new FakeQueryPlanElement({ 'data-derive': 'reviews.summary' });
    const recommendationsHost = new FakeQueryPlanElement({ 'data-plan': 'recommendations-host' });
    root.planElements.push(reviewsSummary, recommendationsHost);
    root.targets.set('reviews:p1', new FakeMorphTarget());
    root.targets.set('recommendations:p1', new FakeMorphTarget());
    store.subscribe('reviews', (value) => {
      observed.push(`reviews-plan:${JSON.stringify(value)}`);
    });
    store.subscribe('recommendations', (value) => {
      observed.push(`recommendations-plan:${JSON.stringify(value)}`);
    });

    const result = applyDeferredStreamResponseToRuntime({
      body: [
        '<!doctype html><html><body><fw-defer target="reviews:p1"></fw-defer>',
        '--jiso-boundary',
        '<fw-query name="reviews">{"items":[{"id":"r1"}]}</fw-query>',
        '<fw-fragment target="reviews:p1"><section>Reviews ready</section></fw-fragment>',
        '--jiso-boundary',
        '<fw-query name="recommendations">{"items":[{"id":"p2"}]}</fw-query>',
        '<fw-fragment target="recommendations:p1"><section>Recommendations ready</section></fw-fragment>',
        '--jiso-boundary--',
        '</body></html>',
      ].join('\n'),
      morph(target, html) {
        observed.push(
          `morph:${html}:${reviewsSummary.textContent}:${recommendationsHost.getAttribute(
            'data-count',
          )}:${JSON.stringify({
            recommendations: store.get('recommendations'),
            reviews: store.get('reviews'),
          })}`,
        );
        target.replaceWithHtml(html);
      },
      queryPlans: {
        recommendations: {
          stamps: [
            {
              attr: 'data-count',
              selector: '[data-plan="recommendations-host"]',
              select: (value) => (value as { items: unknown[] }).items.length,
            },
          ],
        },
        reviews: {
          derives: [
            {
              name: 'summary',
              select: (value) => `${(value as { items: unknown[] }).items.length} review`,
            },
          ],
        },
      },
      root,
      store,
    });

    expect(observed).toEqual([
      'reviews-plan:{"items":[{"id":"r1"}]}',
      'morph:<section>Reviews ready</section>:1 review:null:{"reviews":{"items":[{"id":"r1"}]}}',
      'recommendations-plan:{"items":[{"id":"p2"}]}',
      'morph:<section>Recommendations ready</section>:1 review:1:{"recommendations":{"items":[{"id":"p2"}]},"reviews":{"items":[{"id":"r1"}]}}',
    ]);
    expect(result).toEqual({
      appliedFragments: ['reviews:p1', 'recommendations:p1'],
      chunks: [
        {
          appliedFragments: ['reviews:p1'],
          fragments: [{ html: '<section>Reviews ready</section>', target: 'reviews:p1' }],
          queries: ['reviews'],
        },
        {
          appliedFragments: ['recommendations:p1'],
          fragments: [
            {
              html: '<section>Recommendations ready</section>',
              target: 'recommendations:p1',
            },
          ],
          queries: ['recommendations'],
        },
      ],
      fragments: [
        { html: '<section>Reviews ready</section>', target: 'reviews:p1' },
        { html: '<section>Recommendations ready</section>', target: 'recommendations:p1' },
      ],
      queries: ['reviews', 'recommendations'],
    });
    expect(root.targets.get('reviews:p1')?.html).toBe('<section>Reviews ready</section>');
    expect(root.targets.get('recommendations:p1')?.html).toBe(
      '<section>Recommendations ready</section>',
    );
  });

  it('updates query data and morphs fragments from one mutation response', () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    root.targets.set('cart-badge', new FakeMorphTarget());

    const result = applyMutationResponseToDom({
      body: [
        '<fw-query name="cart">{"count":7}</fw-query>',
        '<fw-fragment target="cart-badge"><cart-badge><span data-bind="cart.count">7</span></cart-badge></fw-fragment>',
      ].join('\n'),
      root,
      store,
    });

    expect(result).toEqual({
      appliedFragments: ['cart-badge'],
      fragments: [
        {
          html: '<cart-badge><span data-bind="cart.count">7</span></cart-badge>',
          target: 'cart-badge',
        },
      ],
      queries: ['cart'],
    });
    expect(store.get('cart')).toEqual({ count: 7 });
    expect(root.targets.get('cart-badge')?.html).toContain('data-bind="cart.count"');
  });
});
