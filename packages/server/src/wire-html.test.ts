import { describe, expect, it } from 'vitest';

import { renderFragmentWireHtml, renderQueryScript } from './wire-html.js';

describe('server wire html emitters', () => {
  it('renders initial query scripts for document-load hydration', () => {
    expect(
      renderQueryScript({
        key: 'cart:c1',
        name: 'cart',
        value: {
          html: '</script><script>alert(1)</script>',
          items: [{ productId: 'p1', qty: 1 }],
        },
      }),
    ).toBe(
      '<script type="application/json" kovo-query="cart" key="cart:c1">{"html":"\\u003c/script>\\u003cscript>alert(1)\\u003c/script>","items":[{"productId":"p1","qty":1}]}</script>',
    );
  });

  it('renders kovo-fragment wrappers with escaped wire attributes and raw html content', () => {
    expect(
      renderFragmentWireHtml({
        errorBoundary: 'error&panel',
        html: '<section data-ready="true">Ready</section>',
        mode: 'append',
        priority: '5&up',
        target: 'cart&badge',
      }),
    ).toBe(
      '<kovo-fragment target="cart&amp;badge" mode="append" priority="5&amp;up" error-boundary="error&amp;panel"><section data-ready="true">Ready</section></kovo-fragment>',
    );
  });

  it('prepends stylesheet links inside fragment wire payloads', () => {
    expect(
      renderFragmentWireHtml({
        html: '<cart-drawer>Ready</cart-drawer>',
        stylesheets: [
          '/assets/cart-drawer.css',
          { href: '/assets/theme.css?mode=screen&print=1' },
          '/assets/cart-drawer.css',
        ],
        target: 'cart-drawer',
      }),
    ).toBe(
      '<kovo-fragment target="cart-drawer"><link rel="stylesheet" href="/assets/cart-drawer.css"><link rel="stylesheet" href="/assets/theme.css?mode=screen&amp;print=1"><cart-drawer>Ready</cart-drawer></kovo-fragment>',
    );
  });

  it('omits replace mode because it is the default fragment wire behavior', () => {
    expect(
      renderFragmentWireHtml({
        html: '<main>Updated</main>',
        mode: 'replace',
        target: 'content',
      }),
    ).toBe('<kovo-fragment target="content"><main>Updated</main></kovo-fragment>');
  });
});
