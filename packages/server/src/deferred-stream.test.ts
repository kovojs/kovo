import { describe, expect, it } from 'vitest';

import { renderDeferredStream } from './deferred-stream.js';

describe('deferred streams', () => {
  it('renders deferred streams with shell first and query JSON before fragments', () => {
    expect(
      renderDeferredStream({
        closeHtml: '</body></html>',
        chunks: [
          {
            fragments: [
              {
                html: '<section fw-c="reviews" fw-deps="product:p1"><article fw-key="r1">5</article></section>',
                target: 'reviews:p1',
              },
            ],
            queries: [
              { key: 'product:p1', name: 'reviews', value: { items: [{ id: 'r1', rating: 5 }] } },
            ],
          },
        ],
        shell:
          '<!doctype html>\n<html><body><main><product-page fw-deps="product:p1"><fw-defer target="reviews:p1" state="pending"></fw-defer></product-page></main>',
      }),
    ).toEqual({
      body: [
        '<!doctype html>\n<html><body><main><product-page fw-deps="product:p1"><fw-defer target="reviews:p1" state="pending"></fw-defer></product-page></main>',
        '--jiso-boundary',
        '<fw-query name="reviews" key="product:p1">{"items":[{"id":"r1","rating":5}]}</fw-query>',
        '<fw-fragment target="reviews:p1"><section fw-c="reviews" fw-deps="product:p1"><article fw-key="r1">5</article></section></fw-fragment>',
        '--jiso-boundary--',
        '</body></html>',
      ].join('\n'),
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
      status: 200,
    });
  });

  it('orders deferred stream chunks and fragments by priority while keeping query JSON first', () => {
    expect(
      renderDeferredStream({
        chunks: [
          {
            fragments: [{ html: '<section>low</section>', target: 'low' }],
            priority: 'low',
            queries: [{ name: 'lowQuery', value: { ready: true } }],
          },
          {
            fragments: [
              { html: '<section>normal</section>', target: 'normal' },
              { html: '<section>critical</section>', priority: 5, target: 'critical&details' },
            ],
            priority: 'high',
            queries: [{ name: 'criticalQuery', value: { ready: true } }],
          },
        ],
        shell: '<!doctype html><html><body><fw-defer target="critical&details"></fw-defer>',
      }),
    ).toEqual({
      body: [
        '<!doctype html><html><body><fw-defer target="critical&details"></fw-defer>',
        '--jiso-boundary',
        '<fw-query name="criticalQuery">{"ready":true}</fw-query>',
        '<fw-fragment target="critical&amp;details" priority="5"><section>critical</section></fw-fragment>',
        '<fw-fragment target="normal"><section>normal</section></fw-fragment>',
        '--jiso-boundary',
        '<fw-query name="lowQuery">{"ready":true}</fw-query>',
        '<fw-fragment target="low"><section>low</section></fw-fragment>',
        '--jiso-boundary--',
        '',
      ].join('\n'),
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
      status: 200,
    });
  });

  it('renders explicit numeric deferred fragment priority hints including zero', () => {
    expect(
      renderDeferredStream({
        chunks: [
          {
            fragments: [{ html: '<section>normal</section>', priority: 0, target: 'normal' }],
            queries: [{ name: 'cart', value: { count: 1 } }],
          },
        ],
        closeHtml: '',
        shell: '<!doctype html><html><body><fw-defer target="normal"></fw-defer>',
      }).body,
    ).toBe(
      [
        '<!doctype html><html><body><fw-defer target="normal"></fw-defer>',
        '--jiso-boundary',
        '<fw-query name="cart">{"count":1}</fw-query>',
        '<fw-fragment target="normal" priority="0"><section>normal</section></fw-fragment>',
        '--jiso-boundary--',
        '',
      ].join('\n'),
    );
  });

  it('renders deferred append fragment mode for streamed pagination fragments', () => {
    expect(
      renderDeferredStream({
        chunks: [
          {
            fragments: [
              {
                html: '<article fw-key="p3">Third</article>',
                mode: 'append',
                target: 'product-grid',
              },
            ],
          },
        ],
        closeHtml: '',
        shell: '<!doctype html><html><body><fw-defer target="product-grid"></fw-defer>',
      }).body,
    ).toBe(
      [
        '<!doctype html><html><body><fw-defer target="product-grid"></fw-defer>',
        '--jiso-boundary',
        '<fw-fragment target="product-grid" mode="append"><article fw-key="p3">Third</article></fw-fragment>',
        '--jiso-boundary--',
        '',
      ].join('\n'),
    );
  });

  it('delivers late stylesheets with deferred fragments', () => {
    expect(
      renderDeferredStream({
        chunks: [
          {
            fragments: [
              {
                html: '<section class="reviews-card">Ready</section>',
                stylesheets: ['/assets/reviews.css', '/assets/reviews.css'],
                target: 'reviews:p1',
              },
            ],
          },
        ],
        shell: '<!doctype html><html><body><fw-defer target="reviews:p1"></fw-defer>',
      }).body,
    ).toContain(
      '<fw-fragment target="reviews:p1"><link rel="stylesheet" href="/assets/reviews.css"><section class="reviews-card">Ready</section></fw-fragment>',
    );
  });
});
