import { describe, expect, it } from 'vitest';

import { trustedHtml } from '@kovojs/runtime';

import { Fragment, jsx, jsxDEV, jsxs } from './jsx-runtime.js';

describe('server jsx runtime', () => {
  it('renders intrinsic elements to light-DOM HTML strings', () => {
    // SPEC.md section 4.2: components render to plain, never-registered elements.
    expect(jsx('span', { children: 'Cart' })).toBe('<span>Cart</span>');
    expect(jsx('cart-badge', { class: 'badge', children: jsx('span', { children: 2 }) })).toBe(
      '<cart-badge class="badge"><span>2</span></cart-badge>',
    );
  });

  it('renders boolean attributes bare and omits false, null, and undefined values', () => {
    expect(jsx('form', { enhance: true, children: '' })).toBe('<form enhance></form>');
    expect(jsx('form', { enhance: false, hidden: null, action: undefined, children: '' })).toBe(
      '<form></form>',
    );
  });

  it('escapes attribute values', () => {
    expect(jsx('input', { value: 'a"b<c&d' })).toBe('<input value="a&quot;b&lt;c&amp;d">');
  });

  it('renders style objects through property-level sanitizers', () => {
    expect(
      jsx('span', {
        style: {
          left: '25%',
          transform: 'translate(-50%, -50%)',
          width: 'url(javascript:alert(1))',
        },
      }),
    ).toBe('<span style="left: 25%; transform: translate(-50%, -50%)"></span>');
  });

  it('renders raw HTML sinks only from trusted values', () => {
    const browserTrustedHtml = {
      [Symbol.toStringTag]: 'TrustedHTML',
      toString: () => '<i>browser trusted</i>',
    } as const;

    expect(
      jsx('section', {
        dangerouslySetInnerHTML: trustedHtml('<b>kovo trusted</b>'),
        children: 'ignored',
      }),
    ).toBe('<section><b>kovo trusted</b></section>');
    expect(jsx('section', { innerHTML: browserTrustedHtml })).toBe(
      '<section><i>browser trusted</i></section>',
    );
    expect(jsx('section', { rawHtml: trustedHtml(browserTrustedHtml) })).toBe(
      '<section><i>browser trusted</i></section>',
    );
    expect(jsx('section', { html: trustedHtml('<em>html helper</em>') })).toBe(
      '<section><em>html helper</em></section>',
    );
  });

  it('safely no-ops dynamic plain strings and unbranded objects in raw HTML sinks', () => {
    expect(jsx('section', { dangerouslySetInnerHTML: '<img src=x onerror=alert(1)>' })).toBe(
      '<section></section>',
    );
    expect(jsx('section', { innerHTML: { toString: () => '<i>not trusted</i>' } })).toBe(
      '<section></section>',
    );
    expect(jsx('section', { rawHtml: '<b>not trusted</b>', title: 'copy' })).toBe(
      '<section title="copy"></section>',
    );
    expect(jsx('section', { html: '<b>not trusted</b>' })).toBe('<section></section>');
  });

  it('renders void elements without closing tags', () => {
    expect(jsx('input', { name: 'quantity', type: 'number', min: 1 })).toBe(
      '<input name="quantity" type="number" min="1">',
    );
    expect(jsx('img', { src: '/p1.png' })).toBe('<img src="/p1.png">');
  });

  it('flattens array children and skips nullish or boolean children', () => {
    const list = jsx('ol', {
      children: [
        ['p1', 'p2'].map((id) => jsx('li', { 'kovo-key': id, children: id })),
        null,
        undefined,
        false,
      ],
    });

    expect(list).toBe('<ol><li kovo-key="p1">p1</li><li kovo-key="p2">p2</li></ol>');
  });

  it('renders fragments and function components', () => {
    const Badge = (props: { children?: unknown }) =>
      jsx('span', { class: 'badge', children: props.children as string });

    expect(Fragment({ children: ['a', 'b'] })).toBe('ab');
    expect(jsx(Badge, { children: 'Cart' })).toBe('<span class="badge">Cart</span>');
  });

  it('aliases jsxs and jsxDEV to jsx for static and dev transforms', () => {
    expect(jsxs('span', { children: ['a', 'b'] })).toBe('<span>ab</span>');
    expect(jsxDEV('span', { children: 'a' })).toBe('<span>a</span>');
  });
});
