import { describe, expect, it } from 'vitest';

import {
  renderDeferredStream,
  renderPageHints,
  stylesheetsForTargets,
  versionedClientModuleHref,
} from './index.js';

describe('page hints', () => {
  it('renders modulepreloads, opt-in speculation rules, and Early Hints headers', () => {
    expect(
      renderPageHints({
        modulepreloads: ['/c/cart.client.js', '/c/cart.client.js', '/c/recs.client.js'],
        prefetch: 'conservative',
        prerenderUrls: ['/cart', '/checkout'],
      }),
    ).toEqual({
      earlyHints: {
        Link: '</c/cart.client.js>; rel=modulepreload, </c/recs.client.js>; rel=modulepreload',
      },
      html: [
        '<link rel="modulepreload" href="/c/cart.client.js">',
        '<link rel="modulepreload" href="/c/recs.client.js">',
        '<script type="speculationrules">{"prerender":[{"eagerness":"conservative","urls":["/cart","/checkout"]}]}</script>',
      ].join(''),
    });
  });

  it('renders and preloads the generated app bootstrap script', () => {
    expect(
      renderPageHints({
        bootstrapScript: '/c/generated/app.client.js',
        modulepreloads: ['/c/cart.client.js', '/c/generated/app.client.js'],
      }),
    ).toEqual({
      earlyHints: {
        Link: '</c/cart.client.js>; rel=modulepreload, </c/generated/app.client.js>; rel=modulepreload',
      },
      html: [
        '<link rel="modulepreload" href="/c/cart.client.js">',
        '<link rel="modulepreload" href="/c/generated/app.client.js">',
        '<script type="module" src="/c/generated/app.client.js"></script>',
      ].join(''),
    });
  });

  it('renders versioned client module hrefs in page hints', () => {
    const bootstrapScript = versionedClientModuleHref('/c/generated/app.client.js', 'build-1');
    const cartModule = versionedClientModuleHref('/c/cart.client.js', 'cart-1');

    expect(
      renderPageHints({
        bootstrapScript,
        modulepreloads: [cartModule, bootstrapScript],
      }),
    ).toEqual({
      earlyHints: {
        Link: '</c/cart.client.js?v=cart-1>; rel=modulepreload, </c/generated/app.client.js?v=build-1>; rel=modulepreload',
      },
      html: [
        '<link rel="modulepreload" href="/c/cart.client.js?v=cart-1">',
        '<link rel="modulepreload" href="/c/generated/app.client.js?v=build-1">',
        '<script type="module" src="/c/generated/app.client.js?v=build-1"></script>',
      ].join(''),
    });
    expect(versionedClientModuleHref('/c/cart.client.js#Cart$add', 'cart-1')).toBe(
      '/c/cart.client.js?v=cart-1#Cart$add',
    );
  });

  it('renders stylesheet assets for Tailwind-first CSS delivery', () => {
    expect(
      renderPageHints({
        modulepreloads: ['/c/cart.client.js'],
        stylesheets: [
          '/assets/tailwind.css',
          '/assets/tailwind.css',
          { href: '/assets/print.css', preload: false },
        ],
      }),
    ).toEqual({
      earlyHints: {
        Link: '</assets/tailwind.css>; rel=preload; as=style, </c/cart.client.js>; rel=modulepreload',
      },
      html: [
        '<link rel="stylesheet" href="/assets/tailwind.css">',
        '<link rel="stylesheet" href="/assets/print.css">',
        '<link rel="modulepreload" href="/c/cart.client.js">',
      ].join(''),
    });
  });

  it('inlines critical component CSS without losing stylesheet identity', () => {
    expect(
      renderPageHints({
        stylesheets: [
          '/assets/components/cart/cart-badge.css',
          {
            criticalCss: 'cart-badge { color: teal; }</style> cart-badge { display: block; }',
            href: '/assets/components/cart/cart-badge.css',
          },
        ],
      }),
    ).toEqual({
      earlyHints: {
        Link: '</assets/components/cart/cart-badge.css>; rel=preload; as=style',
      },
      html: [
        '<style data-jiso-critical-href="/assets/components/cart/cart-badge.css">cart-badge { color: teal; }<\\/style> cart-badge { display: block; }</style>',
        '<link rel="stylesheet" href="/assets/components/cart/cart-badge.css">',
      ].join(''),
    });
  });

  it('selects manifest stylesheets for pages and late fragments', () => {
    const manifest = [
      {
        criticalCss: 'cart-badge { color: teal; }',
        fragmentTargets: ['cart-badge'],
        href: '/assets/components/cart/cart-badge.css',
        sourceFileName: 'components/cart/cart-badge.css',
      },
      {
        fragmentTargets: ['cart-drawer'],
        href: '/assets/components/cart/cart-drawer.css',
        sourceFileName: 'components/cart/cart-drawer.css',
      },
      {
        fragmentTargets: ['cart-drawer'],
        href: '/assets/components/cart/cart-drawer.css',
        sourceFileName: 'components/cart/cart-drawer.css',
      },
    ];

    expect(renderPageHints({ stylesheets: stylesheetsForTargets(manifest) })).toEqual({
      earlyHints: {
        Link: '</assets/components/cart/cart-badge.css>; rel=preload; as=style, </assets/components/cart/cart-drawer.css>; rel=preload; as=style',
      },
      html: [
        '<style data-jiso-critical-href="/assets/components/cart/cart-badge.css">cart-badge { color: teal; }</style>',
        '<link rel="stylesheet" href="/assets/components/cart/cart-badge.css">',
        '<link rel="stylesheet" href="/assets/components/cart/cart-drawer.css">',
      ].join(''),
    });
    expect(
      renderDeferredStream({
        chunks: [
          {
            fragments: [
              {
                html: '<cart-drawer>Ready</cart-drawer>',
                stylesheets: stylesheetsForTargets(manifest, ['cart-drawer']),
                target: 'cart-drawer',
              },
            ],
          },
        ],
        shell: '<!doctype html><html><body><fw-defer target="cart-drawer"></fw-defer>',
      }).body,
    ).toContain(
      '<fw-fragment target="cart-drawer"><link rel="stylesheet" href="/assets/components/cart/cart-drawer.css"><cart-drawer>Ready</cart-drawer></fw-fragment>',
    );
  });

  it('encodes Early Hints link targets without changing rendered hrefs', () => {
    expect(
      renderPageHints({
        modulepreloads: ['/c/cart client.js?target=<badge>'],
        stylesheets: ['/assets/tailwind,print.css'],
      }),
    ).toEqual({
      earlyHints: {
        Link: '</assets/tailwind%2Cprint.css>; rel=preload; as=style, </c/cart%20client.js?target=%3Cbadge%3E>; rel=modulepreload',
      },
      html: [
        '<link rel="stylesheet" href="/assets/tailwind,print.css">',
        '<link rel="modulepreload" href="/c/cart client.js?target=&lt;badge&gt;">',
      ].join(''),
    });
  });

  it('keeps speculation rules default-off for ordinary page hints', () => {
    expect(renderPageHints({ modulepreloads: ['/c/cart.client.js'] })).toEqual({
      earlyHints: { Link: '</c/cart.client.js>; rel=modulepreload' },
      html: '<link rel="modulepreload" href="/c/cart.client.js">',
    });
    expect(renderPageHints({ prefetch: false, prerenderUrls: ['/cart'] })).toEqual({
      earlyHints: {},
      html: '',
    });
    expect(renderPageHints({ prefetch: 'moderate', prerenderUrls: ['', ''] })).toEqual({
      earlyHints: {},
      html: '',
    });
  });

  it('renders moderate speculation rules with deduped escaped prerender urls only when opted in', () => {
    expect(
      renderPageHints({
        prefetch: 'moderate',
        prerenderUrls: ['/cart', '', '/cart', '/search?q=</script><x>'],
      }),
    ).toEqual({
      earlyHints: {},
      html: '<script type="speculationrules">{"prerender":[{"eagerness":"moderate","urls":["/cart","/search?q=\\u003c/script>\\u003cx>"]}]}</script>',
    });
  });
});
