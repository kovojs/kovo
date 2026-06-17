import { describe, expect, it } from 'vitest';

import { renderFragmentWireHtml, renderQueryScript, renderQueryWireHtml } from './wire-html.js';

describe('renderQueryWireHtml', () => {
  it('emits a full query chunk without delta attribute by default', () => {
    expect(renderQueryWireHtml({ name: 'cart', value: { count: 2 } })).toBe(
      '<kovo-query name="cart">{"count":2}</kovo-query>',
    );
  });

  it('emits the boolean delta attribute when delta: true (SPEC §9.1.1)', () => {
    expect(
      renderQueryWireHtml({
        name: 'cart',
        key: 'cart:c1',
        value: { set: { count: 3 } },
        delta: true,
        version: '7',
      }),
    ).toBe(
      '<kovo-query name="cart" key="cart:c1" version="7" delta>{"set":{"count":3}}</kovo-query>',
    );
  });

  it('does not emit the delta attribute when delta: false', () => {
    const html = renderQueryWireHtml({ name: 'cart', value: { count: 2 }, delta: false });
    expect(html).not.toContain(' delta');
  });

  it('does not emit the delta attribute when delta is undefined', () => {
    const html = renderQueryWireHtml({ name: 'cart', value: { count: 2 } });
    expect(html).not.toContain(' delta');
  });
});

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
