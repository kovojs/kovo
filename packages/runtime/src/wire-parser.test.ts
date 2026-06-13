import { describe, expect, it, vi } from 'vitest';

import {
  readAttribute,
  readElementChunks,
  readFragmentChunks,
  readMutationResponseBodyChunks,
  readQueryChunks,
  readQueryScriptChunks,
  unescapeHtml,
} from './wire-parser.js';

describe('wire parser HTML entity handling', () => {
  it('decodes the server-runtime HTML entity contract for wire text', () => {
    // SPEC section 2 Constitution #4: mutation/query wire traffic must stay readable HTML.
    expect(unescapeHtml('&lt;fw-query name=&quot;cart&quot; key=&apos;cart:1&#39;&gt;&amp;')).toBe(
      '<fw-query name="cart" key=\'cart:1\'>&',
    );
  });

  it('decodes apostrophe entities in chunk attributes', () => {
    expect(readAttribute('name="cart" key="cart&#39;c1"', 'key')).toBe("cart'c1");
    expect(readAttribute("name='cart' key='cart&apos;c2'", 'key')).toBe("cart'c2");
  });

  it('reads fw-query attributes with quoted tag closers', () => {
    expect(
      readQueryChunks('<fw-query name="cart" key="cart>a">{&quot;count&quot;:1}</fw-query>'),
    ).toEqual([{ key: 'cart>a', name: 'cart', value: { count: 1 } }]);
  });

  it('shares quoted tag-close scanning for mutation wire element chunks', () => {
    // SPEC.md §9.2: failure payload parsing and query/fragment parsing use the
    // same mutation-wire element scanner, including quoted > characters.
    const chunks = readElementChunks(
      '<output data-debug="quantity > stock" data-error-code="OUT_OF_STOCK">{"availableQuantity":0}</output>',
      'output',
    );

    expect(chunks).toEqual([
      {
        attrs: ' data-debug="quantity > stock" data-error-code="OUT_OF_STOCK"',
        content: '{"availableQuantity":0}',
        end: expect.any(Number),
        start: expect.any(Number),
      },
    ]);
    expect(chunks[0]?.start).toBe(0);
    expect(chunks[0]?.end).toBeGreaterThan(chunks[0]?.start ?? 0);
  });

  it('decodes apostrophe entities in fw-query JSON bodies', () => {
    expect(
      readQueryChunks(
        '<fw-query name="cart">{&quot;label&quot;:&quot;Alice&#39;s &amp; Bob&apos;s&quot;}</fw-query>',
      ),
    ).toEqual([{ name: 'cart', value: { label: "Alice's & Bob's" } }]);
  });

  it('keeps malformed JSON reporting after apostrophe unescaping', () => {
    const onError = vi.fn();

    expect(
      readQueryChunks(
        '<fw-query name="cart">{&quot;label&quot;:&#39;bad&#39;}</fw-query>',
        onError,
      ),
    ).toEqual([]);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(String(onError.mock.calls[0]?.[0].message)).toContain('Malformed JSON in fw-query cart');
  });

  it('reads hydrated query scripts into the shared query chunk shape', () => {
    // SPEC.md §9.4: hydrated script data, mutation chunks, and typed-read
    // refetches share query names and keys as the store currency.
    expect(
      readQueryScriptChunks([
        {
          getAttribute: (name) =>
            name === 'fw-query' ? 'product' : name === 'key' ? 'product>p1' : null,
          textContent: '{"stock":7}',
        },
        {
          getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
          textContent: '{"count":2}',
        },
        {
          getAttribute: () => null,
          textContent: '{"ignored":true}',
        },
      ]),
    ).toEqual([
      { key: 'product>p1', name: 'product', value: { stock: 7 } },
      { name: 'cart', value: { count: 2 } },
    ]);
  });

  it('reports hydrated query script JSON with the same fw-query label as wire chunks', () => {
    const onError = vi.fn();

    expect(
      readQueryScriptChunks(
        [
          {
            getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
            textContent: '{',
          },
        ],
        onError,
      ),
    ).toEqual([]);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(String(onError.mock.calls[0]?.[0].message)).toContain('Malformed JSON in fw-query cart');
  });

  it('reports malformed fw-query markup instead of silently truncating', () => {
    const onError = vi.fn();

    expect(readQueryChunks('<fw-query name="cart">{"count":1}', onError)).toEqual([]);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(String(onError.mock.calls[0]?.[0].message)).toContain(
      'Malformed fw-query chunk: missing closing tag',
    );
  });

  it('decodes mutation response bodies into one query and fragment shape', () => {
    const onError = vi.fn();

    // SPEC.md §9.1: enhanced mutation responses use fw-query plus fw-fragment
    // wire chunks, and all runtime apply paths consume the same decoded body.
    expect(
      readMutationResponseBodyChunks(
        [
          '<fw-query name="cart">{</fw-query>',
          '<fw-query name="inventory" key="inventory:p1">{"available":true}</fw-query>',
          '<fw-fragment target="inventory" mode="append"><li>p1</li></fw-fragment>',
          '<fw-fragment target="stale"><li>stale</li>',
        ].join('\n'),
        onError,
      ),
    ).toEqual({
      fragments: [{ html: '<li>p1</li>', mode: 'append', target: 'inventory' }],
      queries: [{ key: 'inventory:p1', name: 'inventory', value: { available: true } }],
    });
    expect(onError.mock.calls.map(([error]) => String(error.message))).toEqual([
      expect.stringContaining('Malformed JSON in fw-query cart'),
      expect.stringContaining('Malformed fw-fragment chunk: missing closing tag'),
    ]);
  });

  it('reports malformed fw-fragment markup instead of silently truncating', () => {
    const onError = vi.fn();

    expect(
      readFragmentChunks(
        [
          '<fw-fragment target="cart-badge"><cart-badge>3</cart-badge></fw-fragment>',
          '<fw-fragment target="cart-list"><li>stale</li>',
        ].join('\n'),
        onError,
      ),
    ).toEqual([{ html: '<cart-badge>3</cart-badge>', target: 'cart-badge' }]);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(String(onError.mock.calls[0]?.[0].message)).toContain(
      'Malformed fw-fragment chunk: missing closing tag',
    );
  });

  it('keeps nested fw-fragment chunks inside the parent fragment content', () => {
    // SPEC.md §9.1: fragment wire chunks may carry HTML that itself contains
    // inert fw-fragment markup; shared scanning must not split that parent.
    const chunks = readElementChunks(
      [
        '<fw-fragment target="cart">',
        '<section><fw-fragment target="nested"><span>nested</span></fw-fragment></section>',
        '</fw-fragment>',
      ].join(''),
      'fw-fragment',
      { nested: true },
    );

    expect(chunks).toEqual([
      {
        attrs: ' target="cart"',
        content:
          '<section><fw-fragment target="nested"><span>nested</span></fw-fragment></section>',
        end: expect.any(Number),
        start: expect.any(Number),
      },
    ]);
    expect(chunks[0]?.start).toBe(0);
    expect(chunks[0]?.end).toBeGreaterThan(chunks[0]?.start ?? 0);
  });
});
