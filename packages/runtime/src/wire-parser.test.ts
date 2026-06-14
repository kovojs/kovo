import { describe, expect, it, vi } from 'vitest';

import {
  deferredStreamChunks,
  readMutationResponseBodyChunks,
  readQueryChunks,
  readQueryElementChunk,
  readQueryScriptChunks,
} from './wire-parser.js';

// @ts-expect-error SPEC.md §4.4/§9.1: fragment chunk ownership lives with the shared response scanner.
// eslint-disable-next-line no-unused-vars -- compile-time compatibility surface removal assertion only.
type RemovedWireParserFragmentChunkAlias = import('./wire-parser.js').FragmentChunk;

describe('wire parser HTML entity handling', () => {
  it('keeps fragment element internals behind the decoded reader surface', async () => {
    const wireParserModule = await import('./wire-parser.js');

    // SPEC.md §4.4/§9.1: inline and modular response paths share decoded body
    // readers; individual fragment element decoding is not a compatibility API.
    expect(Object.hasOwn(wireParserModule, 'readAttribute')).toBe(false);
    expect(Object.hasOwn(wireParserModule, 'readElementChunks')).toBe(false);
    expect(Object.hasOwn(wireParserModule, 'readFragmentElementChunk')).toBe(false);
    expect(Object.hasOwn(wireParserModule, 'readInlineMutationResponseBodyChunks')).toBe(false);
    expect(Object.hasOwn(wireParserModule, 'readMutationResponseElementChunks')).toBe(false);
    expect(Object.hasOwn(wireParserModule, 'malformedFragmentError')).toBe(false);
    expect(Object.hasOwn(wireParserModule, 'readFragmentChunks')).toBe(false);
    expect(Object.hasOwn(wireParserModule, 'tagClose')).toBe(false);
    expect(Object.hasOwn(wireParserModule, 'unescapeHtml')).toBe(false);
    expect(wireParserModule.readMutationResponseBodyChunks).toBe(readMutationResponseBodyChunks);
  });

  it('reads fw-query attributes with quoted tag closers', () => {
    expect(
      readQueryChunks('<fw-query name="cart" key="cart>a">{&quot;count&quot;:1}</fw-query>'),
    ).toEqual([{ key: 'cart>a', name: 'cart', value: { count: 1 } }]);
  });

  it('reads a pre-split fw-query element chunk through the same decoded shape', () => {
    // SPEC.md §9.1/§9.4: inline hydration and mutation bodies share the same
    // fw-query chunk parser after the inline bootstrap has split wire markup.
    expect(
      readQueryElementChunk({
        attrs: ' name="product" key="product&gt;p1"',
        content: '{&quot;stock&quot;:7}',
      }),
    ).toEqual({ key: 'product>p1', name: 'product', value: { stock: 7 } });
  });

  it('normalizes canonical query instance names into the shared query chunk shape', () => {
    // SPEC.md §9.4/§10.2: typed reads and hydration carry instance keys as
    // `query:key`; runtime apply paths decode that once before hitting the store.
    expect(readQueryChunks('<fw-query name="product:p1">{"stock":7}</fw-query>')).toEqual([
      { key: 'p1', name: 'product', value: { stock: 7 } },
    ]);
    expect(
      readQueryElementChunk({
        attrs: ' name="product:p2"',
        content: '{"stock":8}',
      }),
    ).toEqual({ key: 'p2', name: 'product', value: { stock: 8 } });
    expect(
      readQueryScriptChunks([
        {
          getAttribute: (name) => (name === 'fw-query' ? 'product:p3' : null),
          textContent: '{"stock":9}',
        },
      ]),
    ).toEqual([{ key: 'p3', name: 'product', value: { stock: 9 } }]);
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

  it('keeps hydrated script chunks and wire query chunks on one parsed query shape', () => {
    const hydrated = readQueryScriptChunks([
      {
        getAttribute: (name) => (name === 'fw-query' ? 'product:p1' : null),
        textContent: '{"label":"Alice\'s & Bob\'s"}',
      },
    ]);
    const wire = readQueryElementChunk({
      attrs: ' name="product:p1"',
      content: '{&quot;label&quot;:&quot;Alice&#39;s &amp; Bob&apos;s&quot;}',
    });

    // SPEC.md §9.1/§9.4: server-rendered scripts, inline events, mutation
    // responses, and typed reads share one query chunk currency after decoding.
    expect(hydrated).toEqual([wire]);
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

  it('preserves malformed query-then-fragment reporting order through the shared core', () => {
    const onError = vi.fn();

    // SPEC.md §4.4/§9.1 (v1-cleanup item 3): readMutationResponseBodyChunks now
    // consumes readMutationResponseBodyCore for scan + fragment decode, but the
    // observable onError sequence must stay: malformed fw-query reasons reported
    // during the shared scan / decode pass, then buffered fw-fragment reasons
    // replayed afterwards. Malformed query MARKUP (not just JSON) must still come
    // before malformed fragment markup.
    expect(
      readMutationResponseBodyChunks(
        [
          '<fw-query name="cart">{"count":1}',
          '<fw-fragment target="cart-badge"><cart-badge>1</cart-badge>',
        ].join(''),
        onError,
      ),
    ).toEqual({ fragments: [], queries: [] });
    expect(onError.mock.calls.map(([error]) => String(error.message))).toEqual([
      expect.stringContaining('Malformed fw-query chunk: missing closing tag'),
      expect.stringContaining('Malformed fw-fragment chunk: missing closing tag'),
    ]);
  });

  it('extracts CRLF deferred stream parts before the shared mutation parser', () => {
    // SPEC.md §9.1: deferred streams carry the same fw-query/fw-fragment
    // mutation vocabulary; multipart boundary framing must not create a
    // transport-specific apply/parser fork.
    expect(
      deferredStreamChunks(
        [
          'HTTP/1.1 200 OK\r\n',
          '--jiso-boundary\r\n',
          'Content-Type: text/vnd.jiso.fragment+html\r\n',
          '\r\n',
          '<fw-query name="cart">{"count":1}</fw-query>\r\n',
          '--jiso-boundary\r\n',
          'Content-Type: text/vnd.jiso.fragment+html\r\n',
          '\r\n',
          '<fw-fragment target="cart-badge"><cart-badge>1</cart-badge></fw-fragment>\r\n',
          '--jiso-boundary--\r\n',
        ].join(''),
        'jiso-boundary',
      ).map((chunk) => readMutationResponseBodyChunks(chunk)),
    ).toEqual([
      {
        fragments: [],
        queries: [{ name: 'cart', value: { count: 1 } }],
      },
      {
        fragments: [{ html: '<cart-badge>1</cart-badge>', target: 'cart-badge' }],
        queries: [],
      },
    ]);
  });

  it('filters deferred stream parts through the mutation response element scanner', () => {
    // SPEC.md §9.1: deferred streams reuse mutation response wire chunks, so
    // stream part detection must not keep a regex-only parser beside the
    // canonical fw-query/fw-fragment element scanner.
    expect(
      deferredStreamChunks(
        [
          '--jiso-boundary',
          '<p>shell-only chunk</p>',
          '--jiso-boundary',
          '<fw-query name="cart">{"count":1}',
          '--jiso-boundary',
          '<fw-fragment target="cart"><span>ready</span></fw-fragment>',
          '--jiso-boundary--',
        ].join('\n'),
        'jiso-boundary',
      ),
    ).toEqual([
      '<fw-query name="cart">{"count":1}',
      '<fw-fragment target="cart"><span>ready</span></fw-fragment>',
    ]);
  });

  it('reports malformed fw-fragment markup instead of silently truncating', () => {
    const onError = vi.fn();

    expect(
      readMutationResponseBodyChunks(
        [
          '<fw-fragment target="cart-badge"><cart-badge>3</cart-badge></fw-fragment>',
          '<fw-fragment target="cart-list"><li>stale</li>',
        ].join('\n'),
        onError,
      ).fragments,
    ).toEqual([{ html: '<cart-badge>3</cart-badge>', target: 'cart-badge' }]);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(String(onError.mock.calls[0]?.[0].message)).toContain(
      'Malformed fw-fragment chunk: missing closing tag',
    );
  });

  it('keeps mutation-body and standalone fragment chunk decoding in parity', () => {
    const body = [
      '<fw-fragment target="cart-list" mode="append"><li>new</li></fw-fragment>',
      '<fw-fragment><li>missing target</li></fw-fragment>',
      '<fw-fragment target="cart-total" mode="replace"><span>$7</span></fw-fragment>',
    ].join('');

    // SPEC.md §9.1: response apply and fragment-only readers consume the same
    // decoded fragment shape so target filtering and modes cannot drift.
    expect(readMutationResponseBodyChunks(body).fragments).toEqual([
      { html: '<li>new</li>', mode: 'append', target: 'cart-list' },
      { html: '<span>$7</span>', target: 'cart-total' },
    ]);
  });
});
