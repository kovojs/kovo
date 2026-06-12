import { describe, expect, it } from 'vitest';

import {
  collectCssAssetManifest,
  compileComponentModule,
  dedupeCss,
  scopeComponentCss,
  selectCssAssets,
} from './index.js';

describe('component CSS helpers', () => {
  it('wraps component CSS in @scope and emits a prefixed fallback', () => {
    const result = scopeComponentCss(
      '[fw-c="cart-badge"]',
      '.count { color: red; }\nbutton, a { color: blue; }',
    );

    expect(result.scoped).toBe(
      '@scope ([fw-c="cart-badge"]) to (:scope [fw-c]) {\n  .count { color: red; }\n  button, a { color: blue; }\n}\n',
    );
    expect(result.fallback).toBe(
      '[fw-c="cart-badge"] .count:not([fw-c]):not([fw-c] *) { color: red; }\n[fw-c="cart-badge"] button:not([fw-c]):not([fw-c] *), [fw-c="cart-badge"] a:not([fw-c]):not([fw-c] *) { color: blue; }',
    );
  });

  it('prefixes component CSS fallback selectors inside conditional at-rules', () => {
    const result = scopeComponentCss(
      '[fw-c="cart-badge"]',
      '@media (min-width: 40rem) { .count { color: red; } button, a { color: blue; } }',
    );

    expect(result.fallback).toBe(
      '@media (min-width: 40rem) { [fw-c="cart-badge"] .count:not([fw-c]):not([fw-c] *) { color: red; } [fw-c="cart-badge"] button:not([fw-c]):not([fw-c] *), [fw-c="cart-badge"] a:not([fw-c]):not([fw-c] *) { color: blue; } }',
    );
  });

  it('excludes stamped and dashed nested island hosts from component CSS scopes', () => {
    const result = scopeComponentCss('[fw-c="cart-badge"]', '.count { color: red; }', {
      nestedHostSelectors: ['[fw-c]', 'cart-row'],
    });

    expect(result.scoped).toBe(
      '@scope ([fw-c="cart-badge"]) to (:scope [fw-c], :scope cart-row) {\n  .count { color: red; }\n}\n',
    );
    expect(result.fallback).toBe(
      '[fw-c="cart-badge"] .count:not([fw-c]):not([fw-c] *):not(cart-row):not(cart-row *) { color: red; }',
    );
  });

  it('dedupes normalized CSS chunks in page order', () => {
    expect(dedupeCss(['.a{}', '.a{}', ' .b{} '])).toBe('.a{}\n\n.b{}');
  });

  it('collects emitted component CSS artifacts as server stylesheet assets', () => {
    const cartBadge = compileComponentModule({
      fileName: 'components/cart/cart-badge.tsx',
      source: `
import { component } from '@jiso/core';

export const CartBadge = component('cart-badge', {
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
import { component } from '@jiso/core';

export const CartDrawer = component('cart-drawer', {
  css: \`
    dialog { border: 0; }
  \`,
  render: () => <dialog id="cart-drawer">Cart</dialog>,
});
`,
    });

    const manifest = collectCssAssetManifest([cartBadge, cartDrawer, cartBadge], {
      baseHref: '/_jiso/',
    });

    expect(manifest.stylesheets).toEqual([
      {
        componentName: 'CartBadge',
        criticalCss: expect.stringContaining('@scope (cart-badge) to (:scope [fw-c])'),
        fragmentTargets: [],
        href: '/_jiso/components/cart/cart-badge.css',
        sourceFileName: 'components/cart/cart-badge.css',
      },
      {
        componentName: 'CartDrawer',
        criticalCss: expect.stringContaining('@scope ([fw-c="cart-drawer"]) to (:scope [fw-c])'),
        fragmentTargets: [],
        href: '/_jiso/components/cart/cart-drawer.css',
        sourceFileName: 'components/cart/cart-drawer.css',
      },
    ]);
    expect(selectCssAssets(manifest, ['components/cart/cart-drawer.css'])).toEqual([
      {
        componentName: 'CartDrawer',
        criticalCss: expect.stringContaining('@scope ([fw-c="cart-drawer"]) to (:scope [fw-c])'),
        fragmentTargets: [],
        href: '/_jiso/components/cart/cart-drawer.css',
        sourceFileName: 'components/cart/cart-drawer.css',
      },
    ]);
  });

  it('preserves fragment target metadata in collected CSS manifests', () => {
    const cartBadge = compileComponentModule({
      fileName: 'components/cart/cart-badge.tsx',
      source: `
import { component } from '@jiso/core';

export const CartBadge = component('cart-badge', {
  fragmentTarget: true,
  styles: \`
    .count { color: teal; }
  \`,
  render: () => <cart-badge><span class="count">1</span></cart-badge>,
});
`,
    });

    expect(collectCssAssetManifest(cartBadge).stylesheets).toEqual([
      {
        componentName: 'CartBadge',
        criticalCss: expect.stringContaining('@scope (cart-badge) to (:scope [fw-c])'),
        fragmentTargets: ['cart-badge'],
        href: '/assets/components/cart/cart-badge.css',
        sourceFileName: 'components/cart/cart-badge.css',
      },
    ]);
  });

  it('carries preload policy for late fragment stylesheet delivery', () => {
    const result = compileComponentModule({
      fileName: './components/reviews.tsx',
      source: `
export const Reviews = component('reviews', {
  styles: \`
    .reviews-card { border-radius: 0.5rem; }
  \`,
  render: () => <section class="reviews-card">Ready</section>,
});
`,
    });

    expect(collectCssAssetManifest(result, { preload: false }).stylesheets).toEqual([
      {
        componentName: 'Reviews',
        criticalCss: expect.stringContaining('@scope ([fw-c="reviews"]) to (:scope [fw-c])'),
        fragmentTargets: [],
        href: '/assets/components/reviews.css',
        preload: false,
        sourceFileName: './components/reviews.css',
      },
    ]);
  });
});
