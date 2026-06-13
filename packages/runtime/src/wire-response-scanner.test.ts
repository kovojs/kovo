import { describe, expect, it, vi } from 'vitest';

import { readMutationResponseBodyChunks } from './wire-parser.js';
import {
  readElementChunks,
  readFragmentChunksFromElements,
  readInlineMutationResponseBodyChunks,
  readMutationResponseElementChunks,
} from './wire-response-scanner.js';
import { readAttribute, unescapeHtml } from './wire-html.js';

describe('wire response scanner', () => {
  it('keeps low-level HTML scanner helpers behind the chunk-reader surface', async () => {
    const scannerModule = await import('./wire-response-scanner.js');

    // SPEC.md §4.4/§9.1: modular and inline response paths share the decoded
    // body readers; low-level HTML token helpers and single-element fragment
    // projection are implementation details, not compatibility APIs.
    expect(Object.hasOwn(scannerModule, 'readAttribute')).toBe(false);
    expect(Object.hasOwn(scannerModule, 'readFragmentElementChunk')).toBe(false);
    expect(Object.hasOwn(scannerModule, 'tagClose')).toBe(false);
    expect(Object.hasOwn(scannerModule, 'unescapeHtml')).toBe(false);
    expect(scannerModule.readFragmentChunksFromElements).toBe(readFragmentChunksFromElements);
  });

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

  it('shares mutation response element scanning with the inline loader parser root', () => {
    const malformedQuery = vi.fn();
    const malformedFragment = vi.fn();

    // SPEC.md §4.4/§9.1: the generated inline bootstrap extracts this scanner
    // root from the modular runtime instead of carrying a duplicate response parser.
    expect(
      readMutationResponseElementChunks(
        [
          '<fw-query name="cart">{"count":1}</fw-query>',
          '<fw-query name="stale">{"count":2}',
          '<fw-fragment target="cart"><cart-badge>1</cart-badge></fw-fragment>',
          '<fw-fragment target="stale"><span>stale</span>',
        ].join(''),
        {
          onMalformedFragment: malformedFragment,
          onMalformedQuery: malformedQuery,
        },
      ),
    ).toEqual({
      fragments: [
        {
          attrs: ' target="cart"',
          content: '<cart-badge>1</cart-badge>',
          end: expect.any(Number),
          start: expect.any(Number),
        },
      ],
      queries: [
        {
          attrs: ' name="cart"',
          content: '{"count":1}',
          end: expect.any(Number),
          start: expect.any(Number),
        },
      ],
    });
    expect(malformedQuery).toHaveBeenCalledWith('missing closing tag');
    expect(malformedFragment).toHaveBeenCalledWith('missing closing tag');
  });

  it('projects inline response bodies through the canonical parser before apply', () => {
    // SPEC.md §4.4/§9.1: inline enhanced responses dispatch raw query chunks
    // for modular JSON decoding while fragment apply consumes canonical chunks.
    expect(
      readInlineMutationResponseBodyChunks(
        [
          '<fw-query name="cart" key="cart&gt;1">{&quot;count&quot;:1}</fw-query>',
          '<fw-query>{"ignored":true}</fw-query>',
          '<fw-fragment target="cart-badge"><cart-badge>1</cart-badge></fw-fragment>',
          '<fw-fragment target="cart-list" mode="append"><li>p1</li></fw-fragment>',
        ].join(''),
      ),
    ).toEqual({
      fragments: [
        { html: '<cart-badge>1</cart-badge>', target: 'cart-badge' },
        { html: '<li>p1</li>', mode: 'append', target: 'cart-list' },
      ],
      queries: [
        {
          attrs: ' name="cart" key="cart&gt;1"',
          content: '{&quot;count&quot;:1}',
          end: expect.any(Number),
          start: expect.any(Number),
        },
        {
          attrs: '',
          content: '{"ignored":true}',
          end: expect.any(Number),
          start: expect.any(Number),
        },
      ],
    });
  });

  it('shares fragment element projection across modular and inline response readers', () => {
    const elements = [
      { attrs: ' target="cart&gt;badge"', content: '<cart-badge>1</cart-badge>' },
      { attrs: ' target="cart-list" mode="append"', content: '<li>p1</li>' },
      { attrs: ' mode="append"', content: '<li>missing target</li>' },
    ];
    const body = elements
      .map((chunk) => `<fw-fragment${chunk.attrs}>${chunk.content}</fw-fragment>`)
      .join('');

    // SPEC.md §4.4/§9.1: the extracted inline parser and modular mutation-body
    // parser share the scanner-owned fragment projection after element scanning.
    expect(readFragmentChunksFromElements(elements)).toEqual([
      { html: '<cart-badge>1</cart-badge>', target: 'cart>badge' },
      { html: '<li>p1</li>', mode: 'append', target: 'cart-list' },
    ]);
    expect(readInlineMutationResponseBodyChunks(body).fragments).toEqual(
      readMutationResponseBodyChunks(body).fragments,
    );
    expect(readMutationResponseBodyChunks(body).fragments).toEqual(
      readFragmentChunksFromElements(readMutationResponseElementChunks(body).fragments),
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
