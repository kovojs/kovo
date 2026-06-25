import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import {
  collectCssAssetManifest,
  componentHostSelector,
  createCssAssetResolver,
  cssRouteByteAccounting,
  cssRouteDeliveryGate,
  cssRouteSplitTargetsFromRouteFacts,
  dedupeCss,
  scopeComponentCss,
  selectCssAssets,
} from './internal.js';
import { compileComponentModule } from './index.js';
import { parseComponentModule } from './scan/parse.js';
import type { ComponentCssAsset } from './internal.js';

function cssAssetSnapshot(assets: readonly ComponentCssAsset[]) {
  return assets.map((asset) => ({
    componentName: asset.componentName,
    fragmentTargets: asset.fragmentTargets,
    href: asset.href,
    sourceFileName: asset.sourceFileName,
    styles: {
      cart: asset.criticalCss?.includes('kv-cart') ?? false,
      recommendations: asset.criticalCss?.includes('kv-recommendations') ?? false,
      shell: asset.criticalCss?.includes('kv-shell') ?? false,
    },
    styleRules: asset.styleRuleUsages?.map((usage) => ({
      source: usage.source,
      styleRef: usage.styleRef,
    })),
  }));
}

describe('componentHostSelector (L14-3: kovo-c attribute-selector escaping)', () => {
  // A model whose render host (`<dialog>`) differs from the DOM component name,
  // so `componentHostSelector` takes the `[kovo-c="…"]` branch for any chosen
  // component name.
  function dialogHostModel() {
    return parseComponentModule(
      'components/widget/widget.tsx',
      `
import { component } from '@kovojs/core';

export const Widget = component({
  css: \`.count { color: teal; }\`,
  render: () => <dialog id="widget">Widget</dialog>,
});
`,
    );
  }

  it('escapes CSS-string-significant chars so the selector round-trips against kovo-c (SPEC.md §5.2)', () => {
    const model = dialogHostModel();

    // A `"` in the value would otherwise terminate the CSS string token and let
    // the rest of the name smuggle in selector syntax. The CSS-string escaper
    // backslash-escapes it (NOT the HTML escaper, which would emit `&quot;`).
    expect(componentHostSelector('a"b', model)).toBe('[kovo-c="a\\"b"]');
    // Backslash and newline likewise follow CSS string rules, not HTML entities.
    expect(componentHostSelector('a\\b', model)).toBe('[kovo-c="a\\\\b"]');
    expect(componentHostSelector('a\nb', model)).toBe('[kovo-c="a\\a b"]');
    // The HTML attribute escaper bug is gone: no `&amp;`/`&quot;` entities leak
    // into the CSS selector (`&` is not significant inside a CSS string).
    expect(componentHostSelector('a&b', model)).toBe('[kovo-c="a&b"]');
    expect(componentHostSelector('a"b', model)).not.toContain('&quot;');
  });

  it('leaves a normal identifier component name unchanged', () => {
    const model = dialogHostModel();
    expect(componentHostSelector('cart-drawer', model)).toBe('[kovo-c="cart-drawer"]');
  });
});

describe('component CSS helpers', () => {
  it('wraps component CSS in @scope and emits a prefixed fallback', () => {
    const result = scopeComponentCss(
      '[kovo-c="cart-badge"]',
      '.count { color: red; }\nbutton, a { color: blue; }',
    );

    expect(result.scoped).toBe(
      '@scope ([kovo-c="cart-badge"]) to (:scope [kovo-c]) {\n  .count { color: red; }\n  button, a { color: blue; }\n}\n',
    );
    expect(result.fallback).toBe(
      '[kovo-c="cart-badge"] .count:not([kovo-c]):not([kovo-c] *) { color: red; }\n[kovo-c="cart-badge"] button:not([kovo-c]):not([kovo-c] *), [kovo-c="cart-badge"] a:not([kovo-c]):not([kovo-c] *) { color: blue; }',
    );
  });

  it('prefixes component CSS fallback selectors inside conditional at-rules', () => {
    const result = scopeComponentCss(
      '[kovo-c="cart-badge"]',
      '@media (min-width: 40rem) { .count { color: red; } button, a { color: blue; } }',
    );

    expect(result.fallback).toBe(
      '@media (min-width: 40rem) { [kovo-c="cart-badge"] .count:not([kovo-c]):not([kovo-c] *) { color: red; } [kovo-c="cart-badge"] button:not([kovo-c]):not([kovo-c] *), [kovo-c="cart-badge"] a:not([kovo-c]):not([kovo-c] *) { color: blue; } }',
    );
  });

  it('excludes stamped and dashed nested island hosts from component CSS scopes', () => {
    const result = scopeComponentCss('[kovo-c="cart-badge"]', '.count { color: red; }', {
      nestedHostSelectors: ['[kovo-c]', 'cart-row'],
    });

    expect(result.scoped).toBe(
      '@scope ([kovo-c="cart-badge"]) to (:scope [kovo-c], :scope cart-row) {\n  .count { color: red; }\n}\n',
    );
    expect(result.fallback).toBe(
      '[kovo-c="cart-badge"] .count:not([kovo-c]):not([kovo-c] *):not(cart-row):not(cart-row *) { color: red; }',
    );
  });

  it('splits fallback selector lists only on top-level commas', () => {
    const result = scopeComponentCss(
      '[kovo-c="cart-badge"]',
      ':is(.primary, .secondary), [data-label="a,b"] { color: red; }',
    );

    expect(result.fallback).toBe(
      '[kovo-c="cart-badge"] :is(.primary, .secondary):not([kovo-c]):not([kovo-c] *), [kovo-c="cart-badge"] [data-label="a,b"]:not([kovo-c]):not([kovo-c] *) { color: red; }',
    );
  });

  it('flattens nested ampersand fallback selectors with the host prefix and donut exclusion', () => {
    const result = scopeComponentCss(
      '[kovo-c="cart-badge"]',
      '.card { color: red; & .title, &:is(.active, .open) { color: blue; } }',
    );

    expect(result.fallback).toBe(
      '[kovo-c="cart-badge"] .card:not([kovo-c]):not([kovo-c] *) { color: red;}[kovo-c="cart-badge"] .card .title:not([kovo-c]):not([kovo-c] *), [kovo-c="cart-badge"] .card:is(.active, .open):not([kovo-c]):not([kovo-c] *) { color: blue; }',
    );
  });

  it('dedupes normalized CSS chunks in page order', () => {
    expect(dedupeCss(['.a{}', '.a{}', ' .b{} '])).toBe('.a{}\n\n.b{}');
  });

  it('collects emitted component CSS artifacts as server stylesheet assets', () => {
    const cartBadge = compileComponentModule({
      fileName: 'components/cart/cart-badge.tsx',
      source: `
import { component } from '@kovojs/core';

export const CartBadge = component({
  css: \`
    .count { color: teal; }
  \`,
  render: () => <cart-badge><span class="count">1</span></cart-badge>,
});
`,
    });
    const cartDrawer = compileComponentModule({
      fileName: 'components/cart/cart-drawer.tsx',
      source: `
import { component } from '@kovojs/core';

export const CartDrawer = component({
  css: \`
    dialog { border: 0; }
  \`,
  render: () => <dialog id="cart-drawer">Cart</dialog>,
});
`,
    });

    const manifest = collectCssAssetManifest([cartBadge, cartDrawer, cartBadge], {
      baseHref: '/_kovo/',
    });

    expect(manifest.stylesheets).toEqual([
      {
        componentName: 'cart-badge',
        criticalCss: expect.stringContaining('@scope (cart-badge) to (:scope [kovo-c])'),
        cspHash: 'sha256-48na4dosBulm/lAbYlLZ/FVLEDHrOYHv9gVNdtAeDF8=',
        fragmentTargets: [],
        href: '/_kovo/components/cart/cart-badge.css',
        sourceFileName: 'components/cart/cart-badge.css',
      },
      {
        componentName: 'cart-drawer',
        criticalCss: expect.stringContaining(
          '@scope ([kovo-c="cart-drawer"]) to (:scope [kovo-c])',
        ),
        cspHash: 'sha256-1Dq6YEhupr5PUc5bHQbISCSL0u23zC71ihSEA7HWmR0=',
        fragmentTargets: [],
        href: '/_kovo/components/cart/cart-drawer.css',
        sourceFileName: 'components/cart/cart-drawer.css',
      },
    ]);
    expect(selectCssAssets(manifest, ['components/cart/cart-drawer.css'])).toEqual([
      {
        componentName: 'cart-drawer',
        criticalCss: expect.stringContaining(
          '@scope ([kovo-c="cart-drawer"]) to (:scope [kovo-c])',
        ),
        cspHash: 'sha256-1Dq6YEhupr5PUc5bHQbISCSL0u23zC71ihSEA7HWmR0=',
        fragmentTargets: [],
        href: '/_kovo/components/cart/cart-drawer.css',
        sourceFileName: 'components/cart/cart-drawer.css',
      },
    ]);

    const stylesheetsForRender = createCssAssetResolver(manifest);
    expect(stylesheetsForRender({ kind: 'page' })).toEqual(manifest.stylesheets);
    expect(
      stylesheetsForRender({
        kind: 'fragment',
        sourceFileNames: ['components/cart/cart-drawer.css'],
      }),
    ).toEqual([
      {
        componentName: 'cart-drawer',
        criticalCss: expect.stringContaining(
          '@scope ([kovo-c="cart-drawer"]) to (:scope [kovo-c])',
        ),
        cspHash: 'sha256-1Dq6YEhupr5PUc5bHQbISCSL0u23zC71ihSEA7HWmR0=',
        fragmentTargets: [],
        href: '/_kovo/components/cart/cart-drawer.css',
        sourceFileName: 'components/cart/cart-drawer.css',
      },
    ]);
    expect(
      stylesheetsForRender({
        kind: 'defer',
        sourceFileNames: ['components/cart/cart-badge.css'],
      }),
    ).toEqual([
      {
        componentName: 'cart-badge',
        criticalCss: expect.stringContaining('@scope (cart-badge) to (:scope [kovo-c])'),
        cspHash: 'sha256-48na4dosBulm/lAbYlLZ/FVLEDHrOYHv9gVNdtAeDF8=',
        fragmentTargets: [],
        href: '/_kovo/components/cart/cart-badge.css',
        sourceFileName: 'components/cart/cart-badge.css',
      },
    ]);
  });

  it('preserves fragment target metadata in collected CSS manifests', () => {
    const cartBadge = compileComponentModule({
      fileName: 'components/cart/cart-badge.tsx',
      source: `
import { component } from '@kovojs/core';

export const CartBadge = component({
  queries: { cart: cartQuery },
  styles: \`
    .count { color: teal; }
  \`,
  render: () => <cart-badge><span class="count">1</span></cart-badge>,
});
`,
    });

    const manifest = collectCssAssetManifest(cartBadge);
    expect(manifest.stylesheets).toEqual([
      {
        componentName: 'cart-badge',
        criticalCss: expect.stringContaining('@scope (cart-badge) to (:scope [kovo-c])'),
        cspHash: 'sha256-48na4dosBulm/lAbYlLZ/FVLEDHrOYHv9gVNdtAeDF8=',
        fragmentTargets: ['components/cart/cart-badge/cart-badge'],
        href: '/assets/components/cart/cart-badge.css',
        sourceFileName: 'components/cart/cart-badge.css',
      },
    ]);
    expect(
      createCssAssetResolver(manifest)({
        fragmentTargets: ['components/cart/cart-badge/cart-badge'],
        kind: 'fragment',
      }),
    ).toEqual(manifest.stylesheets);
  });

  it('preserves StyleX rule attribution in collected CSS manifests', () => {
    const cartBadge = compileComponentModule({
      fileName: 'components/cart/cart-badge.tsx',
      source: `
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

const styles = style.create({
  root: {
    color: 'teal',
  },
});

export const CartBadge = component({
  queries: { cart: cartQuery },
  render: () => <cart-badge style={styles.root}>1</cart-badge>,
});
`,
    });

    expect(cssAssetSnapshot(collectCssAssetManifest(cartBadge).stylesheets)).toMatchInlineSnapshot(`
      [
        {
          "componentName": "cart-badge",
          "fragmentTargets": [
            "components/cart/cart-badge/cart-badge",
          ],
          "href": "/assets/components/cart/cart-badge.css",
          "sourceFileName": "components/cart/cart-badge.css",
          "styleRules": [
            {
              "source": "components/cart/cart-badge.tsx#root",
              "styleRef": "styles.root",
            },
          ],
          "styles": {
            "cart": true,
            "recommendations": false,
            "shell": false,
          },
        },
      ]
    `);
  });

  it('computes opt-in base route and fragment CSS chunks from route attribution', () => {
    const shell = compileComponentModule({
      fileName: 'components/app/shell.tsx',
      source: `
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

const styles = style.create({
  root: {
    display: 'grid',
  },
});

export const AppShell = component({
  render: () => <main style={styles.root}>Shell</main>,
});
`,
    });
    const cartBadge = compileComponentModule({
      fileName: 'components/cart/cart-badge.tsx',
      source: `
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

const styles = style.create({
  root: {
    color: 'teal',
  },
});

export const CartBadge = component({
  render: () => <cart-badge style={styles.root}>1</cart-badge>,
});
`,
    });
    const recommendations = compileComponentModule({
      fileName: 'components/product/recommendations.tsx',
      source: `
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

const styles = style.create({
  root: {
    gap: '1rem',
  },
});

export const Recommendations = component({
  queries: { recommendations: recommendationsQuery },
  render: () => <aside style={styles.root}>More like this</aside>,
});
`,
    });
    const manifest = collectCssAssetManifest([shell, cartBadge, recommendations], {
      baseHref: '/_kovo/',
      split: {
        routes: [
          {
            route: '/cart',
            sourceFileNames: ['components/app/shell.css', 'components/cart/cart-badge.css'],
          },
          {
            route: '/products/:id',
            sourceFileNames: [
              'components/app/shell.css',
              'components/cart/cart-badge.css',
              'components/product/recommendations.css',
            ],
          },
        ],
      },
    });
    const resolveCssAssets = createCssAssetResolver(manifest);

    expect(cssAssetSnapshot(manifest.chunks?.base ?? [])).toMatchInlineSnapshot(`
      [
        {
          "componentName": "css-base",
          "fragmentTargets": [],
          "href": "/_kovo/base-3b6d05fa.css",
          "sourceFileName": "base-3b6d05fa.css",
          "styleRules": [
            {
              "source": "components/app/shell.tsx#root",
              "styleRef": "styles.root",
            },
            {
              "source": "components/cart/cart-badge.tsx#root",
              "styleRef": "styles.root",
            },
          ],
          "styles": {
            "cart": true,
            "recommendations": false,
            "shell": true,
          },
        },
      ]
    `);
    expect(cssAssetSnapshot(resolveCssAssets({ kind: 'page', route: '/cart' })))
      .toMatchInlineSnapshot(`
        [
          {
            "componentName": "css-base",
            "fragmentTargets": [],
            "href": "/_kovo/base-3b6d05fa.css",
            "sourceFileName": "base-3b6d05fa.css",
            "styleRules": [
              {
                "source": "components/app/shell.tsx#root",
                "styleRef": "styles.root",
              },
              {
                "source": "components/cart/cart-badge.tsx#root",
                "styleRef": "styles.root",
              },
            ],
            "styles": {
              "cart": true,
              "recommendations": false,
              "shell": true,
            },
          },
        ]
      `);
    expect(cssAssetSnapshot(resolveCssAssets({ kind: 'page', route: '/products/:id' })))
      .toMatchInlineSnapshot(`
        [
          {
            "componentName": "css-base",
            "fragmentTargets": [],
            "href": "/_kovo/base-3b6d05fa.css",
            "sourceFileName": "base-3b6d05fa.css",
            "styleRules": [
              {
                "source": "components/app/shell.tsx#root",
                "styleRef": "styles.root",
              },
              {
                "source": "components/cart/cart-badge.tsx#root",
                "styleRef": "styles.root",
              },
            ],
            "styles": {
              "cart": true,
              "recommendations": false,
              "shell": true,
            },
          },
          {
            "componentName": "route:/products/:id",
            "fragmentTargets": [
              "components/product/recommendations/recommendations",
            ],
            "href": "/_kovo/routes/products-id-355be470.css",
            "sourceFileName": "routes/products-id-355be470.css",
            "styleRules": [
              {
                "source": "components/product/recommendations.tsx#root",
                "styleRef": "styles.root",
              },
            ],
            "styles": {
              "cart": false,
              "recommendations": true,
              "shell": false,
            },
          },
        ]
      `);
    expect(
      cssAssetSnapshot(
        resolveCssAssets({
          fragmentTargets: ['components/product/recommendations/recommendations'],
          kind: 'defer',
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "componentName": "css-base",
          "fragmentTargets": [],
          "href": "/_kovo/base-3b6d05fa.css",
          "sourceFileName": "base-3b6d05fa.css",
          "styleRules": [
            {
              "source": "components/app/shell.tsx#root",
              "styleRef": "styles.root",
            },
            {
              "source": "components/cart/cart-badge.tsx#root",
              "styleRef": "styles.root",
            },
          ],
          "styles": {
            "cart": true,
            "recommendations": false,
            "shell": true,
          },
        },
        {
          "componentName": "fragment:components/product/recommendations/recommendations",
          "fragmentTargets": [
            "components/product/recommendations/recommendations",
          ],
          "href": "/_kovo/fragments/components-product-recommendations-recommendations-355be470.css",
          "sourceFileName": "fragments/components-product-recommendations-recommendations-355be470.css",
          "styleRules": [
            {
              "source": "components/product/recommendations.tsx#root",
              "styleRef": "styles.root",
            },
          ],
          "styles": {
            "cart": false,
            "recommendations": true,
            "shell": false,
          },
        },
      ]
    `);
  });

  it('accounts linked and inlined route CSS bytes against reachable route CSS', () => {
    const sharedCss = '.shared-card{display:grid}';
    const homeCss = '.home-panel{color:teal}';
    const loginCss = '.login-panel{color:purple}';
    const homeRoute = {
      route: '/',
      sourceFileNames: ['components/shared.css', 'routes/home.css'],
    };
    const loginRoute = {
      route: '/login',
      sourceFileNames: ['components/shared.css', 'routes/login.css'],
    };
    const routes = [homeRoute, loginRoute];
    const manifest = collectCssAssetManifest(
      {
        cssAssets: [
          cssAccountingAsset('components/shared.css', 'shared-card', sharedCss),
          cssAccountingAsset('routes/home.css', 'home-panel', homeCss),
          cssAccountingAsset('routes/login.css', 'login-panel', loginCss),
        ],
      },
      { split: { routes } },
    );
    const homeBytes = Buffer.byteLength(sharedCss, 'utf8') + Buffer.byteLength(homeCss, 'utf8');
    const loginBytes = Buffer.byteLength(sharedCss, 'utf8') + Buffer.byteLength(loginCss, 'utf8');

    expect(cssRouteByteAccounting(manifest, homeRoute)).toEqual({
      inlinedCriticalCssBytes: homeBytes,
      linkedCssBytes: homeBytes,
      linkedHrefs: [
        expect.stringMatching(/^\/assets\/base-[a-f0-9]{8}\.css$/),
        expect.stringMatching(/^\/assets\/routes\/index-[a-f0-9]{8}\.css$/),
      ],
      linkedSourceFileNames: [
        expect.stringMatching(/^base-[a-f0-9]{8}\.css$/),
        expect.stringMatching(/^routes\/index-[a-f0-9]{8}\.css$/),
      ],
      reachableCssBytes: homeBytes,
      reachableSourceFileNames: ['components/shared.css', 'routes/home.css'],
      route: '/',
    });
    expect(cssRouteByteAccounting(manifest, loginRoute)).toMatchObject({
      inlinedCriticalCssBytes: loginBytes,
      linkedCssBytes: loginBytes,
      reachableCssBytes: loginBytes,
      reachableSourceFileNames: ['components/shared.css', 'routes/login.css'],
      route: '/login',
    });
  });

  it('flags StyleX atoms delivered to routes that cannot reach them', () => {
    const sharedCss = '.shared-card{display:grid}';
    const homeCss = '.home-panel{color:teal}';
    const loginCss = '.login-panel{color:purple}';
    const homeRoute = {
      route: '/',
      sourceFileNames: ['components/shared.css', 'routes/home.css'],
    };
    const loginRoute = {
      route: '/login',
      sourceFileNames: ['components/shared.css', 'routes/login.css'],
    };
    const manifest = collectCssAssetManifest(
      {
        cssAssets: [
          cssAccountingAsset('components/shared.css', 'shared-card', sharedCss, true),
          cssAccountingAsset('routes/home.css', 'home-panel', homeCss, true),
          cssAccountingAsset('routes/login.css', 'login-panel', loginCss, true),
        ],
      },
      { split: { routes: [homeRoute, loginRoute] } },
    );
    const deliveredToHome = [
      ...(manifest.chunks?.base ?? []),
      ...(manifest.chunks?.routes['/'] ?? []),
      ...(manifest.chunks?.routes['/login'] ?? []),
    ];

    expect(cssRouteDeliveryGate(manifest, homeRoute).diagnostics).toEqual([]);
    expect(cssRouteDeliveryGate(manifest, homeRoute, deliveredToHome)).toEqual({
      accounting: expect.objectContaining({
        linkedCssBytes: Buffer.byteLength(sharedCss, 'utf8') + Buffer.byteLength(homeCss, 'utf8'),
        route: '/',
      }),
      diagnostics: [
        {
          className: 'login-panel',
          href: expect.stringMatching(/^\/assets\/routes\/login-[a-f0-9]{8}\.css$/),
          moduleFileName: 'routes/login.tsx',
          route: '/',
          source: 'routes/login.tsx#root',
          styleRef: 'styles.root',
        },
      ],
    });
  });

  it('places unattributed document-shell CSS in the shared base chunk', () => {
    const documentCss = '.document-dialog{background:white}';
    const homeCss = '.home-panel{color:teal}';
    const loginCss = '.login-panel{color:purple}';
    const homeRoute = {
      route: '/',
      sourceFileNames: ['routes/home.css'],
    };
    const loginRoute = {
      route: '/login',
      sourceFileNames: ['routes/login.css'],
    };
    const manifest = collectCssAssetManifest(
      {
        cssAssets: [
          cssAccountingAsset('document-template.css', 'document-dialog', documentCss, true),
          cssAccountingAsset('routes/home.css', 'home-panel', homeCss, true),
          cssAccountingAsset('routes/login.css', 'login-panel', loginCss, true),
        ],
      },
      { split: { routes: [homeRoute, loginRoute] } },
    );

    const baseCss = manifest.chunks?.base[0];
    expect(baseCss?.criticalCss).toContain('document-dialog');
    expect(baseCss?.criticalCss).not.toContain('home-panel');
    expect(baseCss?.criticalCss).not.toContain('login-panel');
    expect(cssRouteDeliveryGate(manifest, homeRoute).diagnostics).toEqual([]);
    expect(cssRouteByteAccounting(manifest, homeRoute)).toMatchObject({
      linkedCssBytes: Buffer.byteLength(documentCss, 'utf8') + Buffer.byteLength(homeCss, 'utf8'),
      linkedSourceFileNames: [
        expect.stringMatching(/^base-[a-f0-9]{8}\.css$/),
        expect.stringMatching(/^routes\/index-[a-f0-9]{8}\.css$/),
      ],
      reachableCssBytes: Buffer.byteLength(homeCss, 'utf8'),
      reachableSourceFileNames: ['routes/home.css'],
      route: '/',
    });
  });

  it('carries preload policy for late fragment stylesheet delivery', () => {
    const result = compileComponentModule({
      fileName: './components/reviews.tsx',
      source: `
export const Reviews = component({
  styles: \`
    .reviews-card { border-radius: 0.5rem; }
  \`,
  render: () => <section class="reviews-card">Ready</section>,
});
`,
    });

    expect(collectCssAssetManifest(result, { preload: false }).stylesheets).toEqual([
      {
        componentName: 'reviews',
        criticalCss: expect.stringContaining('@scope ([kovo-c="reviews"]) to (:scope [kovo-c])'),
        cspHash: 'sha256-MYalTaUpJ7chCrawgiV0MWzhUVzExnn4DaRoAsw6+60=',
        fragmentTargets: [],
        href: '/assets/components/reviews.css',
        preload: false,
        sourceFileName: 'components/reviews.css',
      },
    ]);
  });

  it('maps route page CSS facts to splitter targets', () => {
    expect(
      cssRouteSplitTargetsFromRouteFacts([
        {
          components: [],
          css: {
            fragmentTargets: ['cart-fragment', 'cart-fragment'],
            sourceFileNames: ['components/cart.css', 'components/shell.css', 'components/cart.css'],
          },
          fileName: 'src/routes.tsx',
          route: '/cart',
        },
        {
          components: [],
          fileName: 'src/routes.tsx',
          route: '/plain',
        },
      ]),
    ).toEqual([
      {
        fragmentTargets: ['cart-fragment'],
        route: '/cart',
        sourceFileNames: ['components/cart.css', 'components/shell.css'],
      },
    ]);
  });
});

function cssAccountingAsset(
  sourceFileName: string,
  componentName: string,
  criticalCss: string,
  withUsage = false,
): ComponentCssAsset {
  const moduleFileName = sourceFileName.replace(/\.css$/, '.tsx');
  return {
    componentName,
    criticalCss,
    fragmentTargets: [],
    href: `/assets/${sourceFileName}`,
    sourceFileName,
    ...(withUsage
      ? {
          styleRuleUsages: [
            {
              className: componentName,
              moduleFileName,
              source: `${moduleFileName}#root`,
              styleRef: 'styles.root',
            },
          ],
        }
      : {}),
  };
}
