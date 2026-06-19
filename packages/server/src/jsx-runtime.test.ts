import { describe, expect, it } from 'vitest';

import { trustedHtml } from '@kovojs/runtime';
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

import { csrfToken } from './csrf.js';
import { runWithJsxRequestContext } from './jsx-context.js';
import { Fragment, jsx, jsxDEV, jsxs } from './jsx-runtime.js';
import { mutationFormAttributes } from './mutation.js';

describe('server jsx runtime', () => {
  it('renders intrinsic elements to light-DOM HTML strings', () => {
    // SPEC.md section 4.2: components render to plain, never-registered elements.
    expect(jsx('span', { children: 'Cart' })).toBe('<span>Cart</span>');
    expect(jsx('cart-badge', { class: 'badge', children: jsx('span', { children: 2 }) })).toBe(
      '<cart-badge class="badge"><span>2</span></cart-badge>',
    );
  });

  it('renders Kovo component descriptors instead of invoking their callable placeholder', async () => {
    const Badge = component({
      render: () => jsx('cart-badge', { children: '3' }),
    });

    await expect(jsx(Badge, {})).resolves.toBe('<cart-badge>3</cart-badge>');
  });

  it('renders boolean attributes bare and omits false, null, and undefined values', () => {
    expect(jsx('form', { enhance: true, children: '' })).toBe('<form enhance></form>');
    expect(jsx('form', { enhance: false, hidden: null, action: undefined, children: '' })).toBe(
      '<form></form>',
    );
  });

  it('lowers typed mutation form values for direct server JSX forms', () => {
    // SPEC.md §6.3: server-rendered templates can bind the importable mutation
    // value instead of hard-coding the `/_m/*` endpoint string.
    const addToCart = { key: 'cart/add' } as const;

    expect(
      jsx('form', {
        enhance: true,
        mutation: addToCart,
        class: 'add',
        children: '',
      }),
    ).toBe(
      '<form enhance method="post" action="/_m/cart/add" data-mutation="cart/add" class="add"></form>',
    );
  });

  it('renders JSX key identity as kovo-key for direct server JSX forms', () => {
    const addToCart = { key: 'cart/add' } as const;

    expect(
      jsx(
        'form',
        {
          enhance: true,
          mutation: addToCart,
          children: '',
        },
        'p1',
      ),
    ).toBe(
      '<form kovo-key="p1" enhance method="post" action="/_m/cart/add" data-mutation="cart/add"><input type="hidden" name="kovo-form-key" value="p1"></form>',
    );
    expect(jsx('form', { key: 'p2', enhance: true, children: '' })).toBe(
      '<form kovo-key="p2" enhance></form>',
    );
  });

  it('renders one session-bound CSRF field for direct server JSX mutation forms', () => {
    const request = { session: { id: 's1' } };
    const csrf = {
      field: 'csrf',
      secret: 'test-secret',
      sessionId: (value: typeof request) => value.session.id,
    };
    const addToCart = { csrf, key: 'cart/add' } as const;

    const html = runWithJsxRequestContext(request, () =>
      jsx('form', {
        enhance: true,
        mutation: addToCart,
        children: '',
      }),
    );

    expect(html).toBe(
      `<form enhance method="post" action="/_m/cart/add" data-mutation="cart/add"><input type="hidden" name="csrf" value="${csrfToken(
        request,
        csrf,
      )}"></form>`,
    );
    expect(String(html).match(/name="csrf"/g)).toHaveLength(1);
  });

  it('does not render CSRF fields for csrf:false mutation forms', () => {
    const html = runWithJsxRequestContext({ session: { id: 's1' } }, () =>
      jsx('form', {
        enhance: true,
        mutation: { csrf: false, key: 'cart/add' },
        children: '',
      }),
    );

    expect(html).not.toContain('name="kovo-csrf"');
  });

  it('renders CSRF for mutationFormAttributes spreads through the retained mutation value', () => {
    const request = { session: { id: 's1' } };
    const csrf = {
      field: 'csrf',
      secret: 'test-secret',
      sessionId: (value: typeof request) => value.session.id,
    };
    const addToCart = { csrf, key: 'cart/add' } as const;

    const html = runWithJsxRequestContext(request, () =>
      jsx('form', {
        ...mutationFormAttributes(addToCart),
        children: '',
      }),
    );

    expect(html).toContain('action="/_m/cart/add"');
    expect(html).toContain(`name="csrf" value="${csrfToken(request, csrf)}"`);
    expect(String(html).match(/name="csrf"/g)).toHaveLength(1);
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

  it('renders Kovo style records passed through style= in direct server JSX', () => {
    const styles = style.create(
      {
        root: {
          backgroundColor: 'black',
          color: 'white',
        },
        inline: {
          marginTop: 4,
        },
      }
    );

    expect(jsx('button', { style: styles.root, children: 'Buy' })).toMatch(
      /^<button class="kv-style-bg-[^ ]+ kv-style-fg-[^"]+">Buy<\/button>$/,
    );
    expect(
      jsx('button', {
        class: 'manual',
        style: [styles.root, [styles.inline, { opacity: 0.8 }]],
        children: 'Buy',
      }),
    ).toMatch(
      /^<button class="manual kv-style-bg-[^ ]+ kv-style-fg-[^ ]+ kv-style-m-[^"]+" style="opacity:0.8">Buy<\/button>$/,
    );
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
