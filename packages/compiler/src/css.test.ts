import { describe, expect, it } from 'vitest';

import {
  collectCssAssetManifest,
  compileComponentModule,
  createCssAssetResolver,
  dedupeCss,
  scopeComponentCss,
  selectCssAssets,
} from './index.js';

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
        fragmentTargets: [],
        href: '/_kovo/components/cart/cart-badge.css',
        sourceFileName: 'components/cart/cart-badge.css',
      },
      {
        componentName: 'cart-drawer',
        criticalCss: expect.stringContaining(
          '@scope ([kovo-c="cart-drawer"]) to (:scope [kovo-c])',
        ),
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
  fragmentTarget: true,
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
        fragmentTargets: [],
        href: '/assets/components/reviews.css',
        preload: false,
        sourceFileName: './components/reviews.css',
      },
    ]);
  });
});
