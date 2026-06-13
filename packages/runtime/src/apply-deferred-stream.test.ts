import { describe, expect, it, vi } from 'vitest';

import { applyDeferredStreamResponseToRuntime as applyDeferredStreamResponseToRuntimeFromDeferredModule } from './apply-deferred-stream.js';
import { applyDeferredStreamResponseToRuntime, createQueryStore } from './index.js';
import {
  FakeMorphRoot,
  FakeMorphTarget,
  FakeQueryBindingElement,
  FakeQueryPlanElement,
} from './runtime-test-fakes.js';

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
    const applied = applyDeferredStreamResponseToRuntime({
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
    const count = new FakeQueryBindingElement({ 'data-bind': 'cart.count' }, { textContent: '0' });
    const observed: string[] = [];
    const beforeApplyQueries = vi.fn();
    root.bindings.push(count);
    root.targets.set('cart-badge', new FakeMorphTarget());
    root.targets.set('cart-total', new FakeMorphTarget());

    // SPEC.md §9.1: deferred stream query chunks use the same mutation response
    // vocabulary, so interposed store truth and compiled bindings stay shared.
    const applied = applyDeferredStreamResponseToRuntime({
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
});
