import { describe, expect, it } from 'vitest';

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

  it('renders void elements without closing tags', () => {
    expect(jsx('input', { name: 'quantity', type: 'number', min: 1 })).toBe(
      '<input name="quantity" type="number" min="1">',
    );
    expect(jsx('img', { src: '/p1.png' })).toBe('<img src="/p1.png">');
  });

  it('flattens array children and skips nullish or boolean children', () => {
    const list = jsx('ol', {
      children: [
        ['p1', 'p2'].map((id) => jsx('li', { 'fw-key': id, children: id })),
        null,
        undefined,
        false,
      ],
    });

    expect(list).toBe('<ol><li fw-key="p1">p1</li><li fw-key="p2">p2</li></ol>');
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
