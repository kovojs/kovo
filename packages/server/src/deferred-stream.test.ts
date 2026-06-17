import { describe, expect, it } from 'vitest';

import { renderDeferredStream } from './deferred-stream.js';

const applyScript =
  '<script>let s=document.currentScript,n=s.previousSibling,e=[];for(;n;){let p=n.previousSibling,t=n.textContent||"";if(n.outerHTML)e.unshift(n.outerHTML);n.remove();if(t.includes("--kovo-boundary"))break;n=p}globalThis.__kovo_a?.(e.join("\\n"));s.remove()</script>';
const cleanupScript =
  '<script>for(const n of [...document.body.childNodes])if((n.textContent||"").includes("--kovo-boundary"))n.remove();document.currentScript.remove()</script>';

describe('deferred streams', () => {
  it('renders deferred streams with shell first and query JSON before fragments', () => {
    expect(
      renderDeferredStream({
        closeHtml: '</body></html>',
        chunks: [
          {
            fragments: [
              {
                html: '<section kovo-c="reviews" kovo-deps="product:p1"><article kovo-key="r1">5</article></section>',
                target: 'reviews:p1',
              },
            ],
            queries: [
              { key: 'product:p1', name: 'reviews', value: { items: [{ id: 'r1', rating: 5 }] } },
            ],
          },
        ],
        shell:
          '<!doctype html>\n<html><body><main><product-page kovo-deps="product:p1"><kovo-defer target="reviews:p1" state="pending"></kovo-defer></product-page></main>',
      }),
    ).toEqual({
      body: [
        '<!doctype html>\n<html><body><main><product-page kovo-deps="product:p1"><kovo-defer target="reviews:p1" state="pending"></kovo-defer></product-page></main>',
        '--kovo-boundary',
        '<kovo-query name="reviews" key="product:p1">{"items":[{"id":"r1","rating":5}]}</kovo-query>',
        '<kovo-fragment target="reviews:p1"><section kovo-c="reviews" kovo-deps="product:p1"><article kovo-key="r1">5</article></section></kovo-fragment>',
        applyScript,
        '--kovo-boundary--',
        cleanupScript,
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
        shell: '<!doctype html><html><body><kovo-defer target="critical&details"></kovo-defer>',
      }),
    ).toEqual({
      body: [
        '<!doctype html><html><body><kovo-defer target="critical&details"></kovo-defer>',
        '--kovo-boundary',
        '<kovo-query name="criticalQuery">{"ready":true}</kovo-query>',
        '<kovo-fragment target="critical&amp;details" priority="5"><section>critical</section></kovo-fragment>',
        '<kovo-fragment target="normal"><section>normal</section></kovo-fragment>',
        applyScript,
        '--kovo-boundary',
        '<kovo-query name="lowQuery">{"ready":true}</kovo-query>',
        '<kovo-fragment target="low"><section>low</section></kovo-fragment>',
        applyScript,
        '--kovo-boundary--',
        cleanupScript,
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
        shell: '<!doctype html><html><body><kovo-defer target="normal"></kovo-defer>',
      }).body,
    ).toBe(
      [
        '<!doctype html><html><body><kovo-defer target="normal"></kovo-defer>',
        '--kovo-boundary',
        '<kovo-query name="cart">{"count":1}</kovo-query>',
        '<kovo-fragment target="normal" priority="0"><section>normal</section></kovo-fragment>',
        applyScript,
        '--kovo-boundary--',
        cleanupScript,
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
                html: '<article kovo-key="p3">Third</article>',
                mode: 'append',
                target: 'product-grid',
              },
            ],
          },
        ],
        closeHtml: '',
        shell: '<!doctype html><html><body><kovo-defer target="product-grid"></kovo-defer>',
      }).body,
    ).toBe(
      [
        '<!doctype html><html><body><kovo-defer target="product-grid"></kovo-defer>',
        '--kovo-boundary',
        '<kovo-fragment target="product-grid" mode="append"><article kovo-key="p3">Third</article></kovo-fragment>',
        applyScript,
        '--kovo-boundary--',
        cleanupScript,
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
        shell: '<!doctype html><html><body><kovo-defer target="reviews:p1"></kovo-defer>',
      }).body,
    ).toContain(
      `<kovo-fragment target="reviews:p1"><link rel="stylesheet" href="/assets/reviews.css"><section class="reviews-card">Ready</section></kovo-fragment>\n${applyScript}`,
    );
  });
});
