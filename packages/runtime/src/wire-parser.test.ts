import { describe, expect, it, vi } from 'vitest';

import { readAttribute, readFragmentChunks, readQueryChunks, unescapeHtml } from './wire-parser.js';

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
});
