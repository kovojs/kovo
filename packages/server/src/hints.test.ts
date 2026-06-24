import { describe, expect, it } from 'vitest';

import { versionedClientModuleHref } from './client-modules.js';
import { renderContentSecurityPolicy } from './csp.js';
import { renderDeferredStream } from './deferred-stream.js';
import { renderPageHints, stylesheet, stylesheetsForTargets } from './hints.js';

describe('page hints', () => {
  it('renders modulepreloads, opt-in speculation rules, and Early Hints headers', () => {
    expect(
      renderPageHints({
        modulepreloads: ['/c/cart.client.js', '/c/cart.client.js', '/c/recs.client.js'],
        prefetch: 'conservative',
        prerenderUrls: ['/cart', '/checkout'],
      }),
    ).toEqual({
      csp: {
        scripts: ['sha256-/aovN5oxwLTJnSx2AWnlCNGwIbyhuoijwj3ORkZ7lac='],
        styles: [],
      },
      earlyHints: {
        Link: '</c/cart.client.js>; rel=modulepreload, </c/recs.client.js>; rel=modulepreload',
      },
      html: [
        '<link rel="modulepreload" href="/c/cart.client.js">',
        '<link rel="modulepreload" href="/c/recs.client.js">',
        '<script type="speculationrules" data-kovo-csp-hash="sha256-/aovN5oxwLTJnSx2AWnlCNGwIbyhuoijwj3ORkZ7lac=">{"prerender":[{"eagerness":"conservative","urls":["/cart","/checkout"]}]}</script>',
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

  it('threads the document CSP nonce through emitted hint scripts', () => {
    const hints = renderPageHints(
      {
        bootstrapScript: '/c/generated/app.client.js',
        i18n: { locale: 'en-US', messages: { cart: 'Cart' } },
        prefetch: 'conservative',
        prerenderUrls: ['/cart'],
      },
      { cspNonce: 'doc-nonce' },
    );

    expect(hints.html).toContain(
      '<script type="module" src="/c/generated/app.client.js" nonce="doc-nonce"></script>',
    );
    expect(hints.html).toContain(
      '<script type="application/json" kovo-i18n locale="en-US" nonce="doc-nonce"',
    );
    expect(hints.html).toContain('<script type="speculationrules" nonce="doc-nonce"');
    expect(renderContentSecurityPolicy(hints.csp!)).toContain("'nonce-doc-nonce' 'strict-dynamic'");
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
        Link: '</c/__v/cart-1/cart.client.js>; rel=modulepreload, </c/__v/build-1/generated/app.client.js>; rel=modulepreload',
      },
      html: [
        '<link rel="modulepreload" href="/c/__v/cart-1/cart.client.js">',
        '<link rel="modulepreload" href="/c/__v/build-1/generated/app.client.js">',
        '<script type="module" src="/c/__v/build-1/generated/app.client.js"></script>',
      ].join(''),
    });
    expect(versionedClientModuleHref('/c/cart.client.js#Cart$add', 'cart-1')).toBe(
      '/c/__v/cart-1/cart.client.js#Cart$add',
    );
  });

  it('renders stylesheet assets for StyleX-first CSS delivery', () => {
    expect(
      renderPageHints({
        modulepreloads: ['/c/cart.client.js'],
        stylesheets: [
          '/assets/styles.css',
          '/assets/styles.css',
          { href: '/assets/print.css', preload: false },
        ],
      }),
    ).toEqual({
      earlyHints: {
        Link: '</assets/styles.css>; rel=preload; as=style, </c/cart.client.js>; rel=modulepreload',
      },
      html: [
        '<link rel="stylesheet" href="/assets/styles.css">',
        '<link rel="stylesheet" href="/assets/print.css">',
        '<link rel="modulepreload" href="/c/cart.client.js">',
      ].join(''),
    });
  });

  it('declares local, external, and theme-only stylesheets through the public helper', () => {
    expect(stylesheet('./styles.css')).toEqual({
      href: '/assets/styles.css',
    });
    expect(stylesheet('./components/cart.css?build=1', { preload: false })).toEqual({
      href: '/assets/cart.css?build=1',
      preload: false,
    });
    expect(stylesheet('https://cdn.example.test/reset.css')).toEqual({
      href: 'https://cdn.example.test/reset.css',
    });
    expect(
      stylesheet('./styles.css', {
        criticalCss: ['.cart{display:grid}', '.badge{color:teal}'],
        theme: { css: ':root{--brand:teal}' },
      }),
    ).toEqual({
      criticalCss: '.cart{display:grid}\n.badge{color:teal}',
      href: '/assets/styles.css',
    });
    expect(stylesheet({ theme: ':root{--only-theme:1}' })).toEqual({
      criticalCss: ':root{--only-theme:1}',
      href: '/assets/styles.css',
    });
  });

  it('prunes critical theme CSS to variables reachable from critical rules', () => {
    expect(
      stylesheet('./styles.css', {
        criticalCss: [
          '.shell{color:var(--used);border-color:var(--missing, currentColor)}',
          '.nested{background:var(--nested)}',
        ],
        theme: {
          css: [
            ':root {',
            '  --used: var(--base);',
            '  --base: #fff;',
            '  --nested: color-mix(in srgb, var(--base) 80%, black);',
            '  --unused: red;',
            '}',
            ':root[data-theme="dark"] {',
            '  --used: var(--base);',
            '  --base: #111;',
            '  --nested: color-mix(in srgb, var(--base) 70%, white);',
            '  --unused: orange;',
            '}',
          ].join('\n'),
        },
      }).criticalCss,
    ).toBe(
      [
        ':root {',
        '  --used: var(--base);',
        '  --base: #fff;',
        '  --nested: color-mix(in srgb, var(--base) 80%, black);',
        '}',
        '',
        ':root[data-theme="dark"] {',
        '  --used: var(--base);',
        '  --base: #111;',
        '  --nested: color-mix(in srgb, var(--base) 70%, white);',
        '}',
        '.shell{color:var(--used);border-color:var(--missing, currentColor)}',
        '.nested{background:var(--nested)}',
      ].join('\n'),
    );
  });

  it('keeps full critical theme CSS when pruning is disabled or unsafe', () => {
    const themeCss = ':root{--used:teal;--unused:red}';
    expect(
      stylesheet('./styles.css', {
        criticalCss: '.shell{color:var(--used)}',
        criticalCssTheme: 'all',
        theme: themeCss,
      }).criticalCss,
    ).toBe(`${themeCss}\n.shell{color:var(--used)}`);
    expect(
      stylesheet('./styles.css', {
        criticalCss: '.shell{color:var(--used)}',
        theme: '@media (min-width: 40rem) { :root { --used: teal; --unused: red; } }',
      }).criticalCss,
    ).toBe(
      '@media (min-width: 40rem) { :root { --used: teal; --unused: red; } }\n.shell{color:var(--used)}',
    );
  });

  it('keeps authored CSP hashes tied to unmodified critical theme CSS', () => {
    expect(
      stylesheet('./styles.css', {
        criticalCss: '.shell{color:var(--used)}',
        cspHash: 'sha256-test',
        theme: ':root{--used:teal;--unused:red}',
      }),
    ).toEqual({
      criticalCss: ':root{--used:teal;--unused:red}\n.shell{color:var(--used)}',
      cspHash: 'sha256-test',
      href: '/assets/styles.css',
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
      csp: {
        scripts: [],
        styles: ['sha256-aglF4eql6svDxPnTw19+/jdeBTsfl850MsmdffQ8F/s='],
      },
      earlyHints: {
        Link: '</assets/components/cart/cart-badge.css>; rel=preload; as=style',
      },
      html: [
        '<style data-kovo-critical-href="/assets/components/cart/cart-badge.css" data-kovo-csp-hash="sha256-aglF4eql6svDxPnTw19+/jdeBTsfl850MsmdffQ8F/s=">cart-badge { color: teal; }<\\/style> cart-badge { display: block; }</style>',
        '<link rel="stylesheet" href="/assets/components/cart/cart-badge.css">',
      ].join(''),
    });
  });

  it('keeps full stylesheet delivery render-blocking by default when critical CSS is inlined', () => {
    expect(
      renderPageHints({
        stylesheets: [
          {
            criticalCss: 'cart-badge { color: teal; }',
            href: '/assets/components/cart/cart-badge.css',
          },
        ],
      }).html,
    ).toContain(
      '<style data-kovo-critical-href="/assets/components/cart/cart-badge.css" data-kovo-csp-hash="sha256-sx71hKmvDG940BhsIfAcO2PDWD7BMRdMimhBDfDpbMY=">cart-badge { color: teal; }</style><link rel="stylesheet" href="/assets/components/cart/cart-badge.css">',
    );
  });

  it('can explicitly keep critical stylesheets render-blocking', () => {
    expect(
      renderPageHints({
        stylesheets: [
          {
            criticalCss: 'cart-badge { color: teal; }',
            deferFull: false,
            href: '/assets/components/cart/cart-badge.css',
          },
        ],
      }).html,
    ).toContain(
      '<style data-kovo-critical-href="/assets/components/cart/cart-badge.css" data-kovo-csp-hash="sha256-sx71hKmvDG940BhsIfAcO2PDWD7BMRdMimhBDfDpbMY=">cart-badge { color: teal; }</style><link rel="stylesheet" href="/assets/components/cart/cart-badge.css">',
    );
  });

  it('can defer non-critical stylesheet assets with a no-js fallback', () => {
    expect(
      renderPageHints({
        stylesheets: [{ deferFull: true, href: '/assets/routes/cart.css' }],
      }),
    ).toEqual({
      earlyHints: {
        Link: '</assets/routes/cart.css>; rel=preload; as=style',
      },
      html: '<link rel="preload" as="style" href="/assets/routes/cart.css" data-kovo-deferred-style><noscript><link rel="stylesheet" href="/assets/routes/cart.css"></noscript>',
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
      csp: {
        scripts: [],
        styles: ['sha256-sx71hKmvDG940BhsIfAcO2PDWD7BMRdMimhBDfDpbMY='],
      },
      earlyHints: {
        Link: '</assets/components/cart/cart-badge.css>; rel=preload; as=style, </assets/components/cart/cart-drawer.css>; rel=preload; as=style',
      },
      html: [
        '<style data-kovo-critical-href="/assets/components/cart/cart-badge.css" data-kovo-csp-hash="sha256-sx71hKmvDG940BhsIfAcO2PDWD7BMRdMimhBDfDpbMY=">cart-badge { color: teal; }</style>',
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
        shell: '<!doctype html><html><body><kovo-defer target="cart-drawer"></kovo-defer>',
      }).body,
    ).toContain(
      '<kovo-fragment target="cart-drawer"><link rel="stylesheet" href="/assets/components/cart/cart-drawer.css"><cart-drawer>Ready</cart-drawer></kovo-fragment>',
    );
  });

  it('encodes Early Hints link targets without changing rendered hrefs', () => {
    expect(
      renderPageHints({
        modulepreloads: ['/c/cart client.js?target=<badge>'],
        stylesheets: ['/assets/styles,print.css'],
      }),
    ).toEqual({
      earlyHints: {
        Link: '</assets/styles%2Cprint.css>; rel=preload; as=style, </c/cart%20client.js?target=%3Cbadge%3E>; rel=modulepreload',
      },
      html: [
        '<link rel="stylesheet" href="/assets/styles,print.css">',
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

  // L2-early-hints-1 (bugs-part3): a speculation rule prerenders/prefetches with the
  // user's credentials, so an off-origin target is a credentialed cross-origin
  // prerender (KV419 never gates `conservative`). Same-origin paths survive; everything
  // off-origin is dropped.
  it('drops cross-origin / protocol-relative prerender URLs (L2-early-hints-1)', () => {
    const result = renderPageHints({
      prefetch: 'conservative',
      prerenderUrls: [
        '/cart', // same-origin path: kept
        '/products/p1', // same-origin path: kept
        'https://evil.example/steal', // absolute cross-origin: dropped
        'http://evil.example/steal', // absolute cross-origin: dropped
        '//evil.example/steal', // protocol-relative: dropped
        '/\\evil.example/steal', // backslash-authority: dropped
        '/x\\evil.example', // embedded backslash: dropped
        'data:text/html,<x>', // scheme: dropped
        'cart', // relative (no leading slash): dropped
      ],
    });

    // Only the two same-origin paths appear in the emitted rule.
    expect(result.html).toContain('"urls":["/cart","/products/p1"]');
    expect(result.html).not.toContain('evil.example');
    expect(result.html).not.toContain('data:');
  });

  it('emits no speculation rule when every prerender URL is off-origin (L2-early-hints-1)', () => {
    expect(
      renderPageHints({
        prefetch: 'conservative',
        prerenderUrls: ['https://evil.example/a', '//evil.example/b'],
      }),
    ).toEqual({
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
      csp: {
        scripts: ['sha256-moDWLGVl123UjqovUCtXndhtW0kiYXVMQE8nqaw9SHo='],
        styles: [],
      },
      earlyHints: {},
      html: '<script type="speculationrules" data-kovo-csp-hash="sha256-moDWLGVl123UjqovUCtXndhtW0kiYXVMQE8nqaw9SHo=">{"prerender":[{"eagerness":"moderate","urls":["/cart","/search?q=\\u003c/script>\\u003cx>"]}]}</script>',
    });
  });
});
