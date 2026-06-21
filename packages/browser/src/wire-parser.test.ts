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

  it('reads kovo-query attributes with quoted tag closers', () => {
    expect(
      readQueryChunks('<kovo-query name="cart" key="cart>a">{&quot;count&quot;:1}</kovo-query>'),
    ).toEqual([{ key: 'cart>a', name: 'cart', value: { count: 1 } }]);
  });

  it('reads a pre-split kovo-query element chunk through the same decoded shape', () => {
    // SPEC.md §9.1/§9.4: inline hydration and mutation bodies share the same
    // kovo-query chunk parser after the inline bootstrap has split wire markup.
    expect(
      readQueryElementChunk({
        attrs: ' name="product" key="product&gt;p1"',
        content: '{&quot;stock&quot;:7}',
      }),
    ).toEqual({ key: 'product>p1', name: 'product', value: { stock: 7 } });
  });

  it('keeps query endpoint instance keys separate from declared query names', () => {
    // SPEC.md §9.4/§10.2: /_q chunks use the declared query key as `name` and
    // the canonical instance identity as `key`, even when that key contains colons.
    expect(
      readQueryChunks(
        '<kovo-query name="productDetail" key="product:p1">{"id":"p1"}</kovo-query>',
      ),
    ).toEqual([{ key: 'product:p1', name: 'productDetail', value: { id: 'p1' } }]);
  });

  it('normalizes canonical query instance names into the shared query chunk shape', () => {
    // SPEC.md §9.4/§10.2: typed reads and hydration carry instance keys as
    // `query:key`; runtime apply paths decode that once before hitting the store.
    expect(readQueryChunks('<kovo-query name="product:p1">{"stock":7}</kovo-query>')).toEqual([
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
          getAttribute: (name) => (name === 'kovo-query' ? 'product:p3' : null),
          textContent: '{"stock":9}',
        },
      ]),
    ).toEqual([{ key: 'p3', name: 'product', value: { stock: 9 } }]);
  });

  it('decodes apostrophe entities in kovo-query JSON bodies', () => {
    expect(
      readQueryChunks(
        '<kovo-query name="cart">{&quot;label&quot;:&quot;Alice&#39;s &amp; Bob&apos;s&quot;}</kovo-query>',
      ),
    ).toEqual([{ name: 'cart', value: { label: "Alice's & Bob's" } }]);
  });

  it('keeps malformed JSON reporting after apostrophe unescaping', () => {
    const onError = vi.fn();

    expect(
      readQueryChunks(
        '<kovo-query name="cart">{&quot;label&quot;:&#39;bad&#39;}</kovo-query>',
        onError,
      ),
    ).toEqual([]);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(String(onError.mock.calls[0]?.[0].message)).toContain(
      'Malformed JSON in kovo-query cart',
    );
  });

  it('reads hydrated query scripts into the shared query chunk shape', () => {
    // SPEC.md §9.4: hydrated script data, mutation chunks, and typed-read
    // refetches share query names and keys as the store currency.
    expect(
      readQueryScriptChunks([
        {
          getAttribute: (name) =>
            name === 'kovo-query' ? 'product' : name === 'key' ? 'product>p1' : null,
          textContent: '{"stock":7}',
        },
        {
          getAttribute: (name) => (name === 'kovo-query' ? 'cart' : null),
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
        getAttribute: (name) => (name === 'kovo-query' ? 'product:p1' : null),
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

  it('reports hydrated query script JSON with the same kovo-query label as wire chunks', () => {
    const onError = vi.fn();

    expect(
      readQueryScriptChunks(
        [
          {
            getAttribute: (name) => (name === 'kovo-query' ? 'cart' : null),
            textContent: '{',
          },
        ],
        onError,
      ),
    ).toEqual([]);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(String(onError.mock.calls[0]?.[0].message)).toContain(
      'Malformed JSON in kovo-query cart',
    );
  });

  it('reports malformed kovo-query markup instead of silently truncating', () => {
    const onError = vi.fn();

    expect(readQueryChunks('<kovo-query name="cart">{"count":1}', onError)).toEqual([]);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(String(onError.mock.calls[0]?.[0].message)).toContain(
      'Malformed kovo-query chunk: missing closing tag',
    );
  });

  it('decodes mutation response bodies into one query and fragment shape', () => {
    const onError = vi.fn();

    // SPEC.md §9.1: enhanced mutation responses use kovo-query plus kovo-fragment
    // wire chunks, and all runtime apply paths consume the same decoded body.
    expect(
      readMutationResponseBodyChunks(
        [
          '<kovo-query name="cart">{</kovo-query>',
          '<kovo-query name="inventory" key="inventory:p1">{"available":true}</kovo-query>',
          '<kovo-fragment target="inventory" mode="append"><li>p1</li></kovo-fragment>',
          '<kovo-fragment target="stale"><li>stale</li>',
        ].join('\n'),
        onError,
      ),
    ).toEqual({
      fragments: [{ html: '<li>p1</li>', mode: 'append', target: 'inventory' }],
      queries: [{ key: 'inventory:p1', name: 'inventory', value: { available: true } }],
    });
    expect(onError.mock.calls.map(([error]) => String(error.message))).toEqual([
      expect.stringContaining('Malformed JSON in kovo-query cart'),
      expect.stringContaining('Malformed kovo-fragment chunk: missing closing tag'),
    ]);
  });

  it('preserves malformed query-then-fragment reporting order through the shared core', () => {
    const onError = vi.fn();

    // SPEC.md §4.4/§9.1 (v1-cleanup item 3): readMutationResponseBodyChunks now
    // consumes readMutationResponseBodyCore for scan + fragment decode, but the
    // observable onError sequence must stay: malformed kovo-query reasons reported
    // during the shared scan / decode pass, then buffered kovo-fragment reasons
    // replayed afterwards. Malformed query MARKUP (not just JSON) must still come
    // before malformed fragment markup.
    expect(
      readMutationResponseBodyChunks(
        [
          '<kovo-query name="cart">{"count":1}',
          '<kovo-fragment target="cart-badge"><cart-badge>1</cart-badge>',
        ].join(''),
        onError,
      ),
    ).toEqual({ fragments: [], queries: [] });
    expect(onError.mock.calls.map(([error]) => String(error.message))).toEqual([
      expect.stringContaining('Malformed kovo-query chunk: missing closing tag'),
      expect.stringContaining('Malformed kovo-fragment chunk: missing closing tag'),
    ]);
  });

  it('extracts CRLF deferred stream parts before the shared mutation parser', () => {
    // SPEC.md §9.1: deferred streams carry the same kovo-query/kovo-fragment
    // mutation vocabulary; multipart boundary framing must not create a
    // transport-specific apply/parser fork.
    expect(
      deferredStreamChunks(
        [
          'HTTP/1.1 200 OK\r\n',
          '--kovo-boundary\r\n',
          'Content-Type: text/vnd.kovo.fragment+html\r\n',
          '\r\n',
          '<kovo-query name="cart">{"count":1}</kovo-query>\r\n',
          '--kovo-boundary\r\n',
          'Content-Type: text/vnd.kovo.fragment+html\r\n',
          '\r\n',
          '<kovo-fragment target="cart-badge"><cart-badge>1</cart-badge></kovo-fragment>\r\n',
          '--kovo-boundary--\r\n',
        ].join(''),
        'kovo-boundary',
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
    // canonical kovo-query/kovo-fragment element scanner.
    expect(
      deferredStreamChunks(
        [
          '--kovo-boundary',
          '<p>shell-only chunk</p>',
          '--kovo-boundary',
          '<kovo-query name="cart">{"count":1}',
          '--kovo-boundary',
          '<kovo-fragment target="cart"><span>ready</span></kovo-fragment>',
          '--kovo-boundary--',
        ].join('\n'),
        'kovo-boundary',
      ),
    ).toEqual([
      '<kovo-query name="cart">{"count":1}',
      '<kovo-fragment target="cart"><span>ready</span></kovo-fragment>',
    ]);
  });

  it('reports malformed kovo-fragment markup instead of silently truncating', () => {
    const onError = vi.fn();

    expect(
      readMutationResponseBodyChunks(
        [
          '<kovo-fragment target="cart-badge"><cart-badge>3</cart-badge></kovo-fragment>',
          '<kovo-fragment target="cart-list"><li>stale</li>',
        ].join('\n'),
        onError,
      ).fragments,
    ).toEqual([{ html: '<cart-badge>3</cart-badge>', target: 'cart-badge' }]);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(String(onError.mock.calls[0]?.[0].message)).toContain(
      'Malformed kovo-fragment chunk: missing closing tag',
    );
  });

  it('keeps mutation-body and standalone fragment chunk decoding in parity', () => {
    const body = [
      '<kovo-fragment target="cart-list" mode="append"><li>new</li></kovo-fragment>',
      '<kovo-fragment><li>missing target</li></kovo-fragment>',
      '<kovo-fragment target="cart-total" mode="replace"><span>$7</span></kovo-fragment>',
    ].join('');

    // SPEC.md §9.1: response apply and fragment-only readers consume the same
    // decoded fragment shape so target filtering and modes cannot drift.
    expect(readMutationResponseBodyChunks(body).fragments).toEqual([
      { html: '<li>new</li>', mode: 'append', target: 'cart-list' },
      { html: '<span>$7</span>', target: 'cart-total' },
    ]);
  });

  it('parses the delta boolean attribute into QueryChunk.delta (SPEC §9.1.1)', () => {
    // SPEC §9.1.1: `delta` is a boolean HTML attribute (presence = true, no
    // value). readAttribute returns '' for a valueless attribute and null when
    // absent; the parser must treat non-null as true.
    expect(
      readQueryChunks('<kovo-query name="cart" delta>{"set":{"count":2}}</kovo-query>'),
    ).toEqual([{ delta: true, name: 'cart', value: { set: { count: 2 } } }]);
  });

  it('does not set delta on full-value (non-delta) kovo-query chunks', () => {
    // SPEC §9.1.1: absence of the delta attribute means a full value — the
    // runtime must not add delta:false to the shape (keep it sparse).
    const chunks = readQueryChunks('<kovo-query name="cart">{"count":1}</kovo-query>');
    expect(chunks).toEqual([{ name: 'cart', value: { count: 1 } }]);
    expect(Object.hasOwn(chunks[0]!, 'delta')).toBe(false);
  });

  it('parses delta chunks in a mutation response body', () => {
    // SPEC §9.1.1: mutation responses may carry delta kovo-query chunks
    // alongside full chunks and fragment patches.
    expect(
      readMutationResponseBodyChunks(
        [
          '<kovo-query name="cart" delta>{"set":{"count":3}}</kovo-query>',
          '<kovo-query name="inventory">{"available":true}</kovo-query>',
        ].join('\n'),
      ),
    ).toEqual({
      fragments: [],
      queries: [
        { delta: true, name: 'cart', value: { set: { count: 3 } } },
        { name: 'inventory', value: { available: true } },
      ],
    });
  });

  it('parses a delta chunk with key attribute', () => {
    expect(
      readQueryChunks('<kovo-query name="product" key="p1" delta>{"set":{"stock":5}}</kovo-query>'),
    ).toEqual([{ delta: true, key: 'p1', name: 'product', value: { set: { stock: 5 } } }]);
  });

  it('reads a pre-split delta element chunk through readQueryElementChunk', () => {
    // SPEC §9.1.1: inline bootstrap splits wire markup before passing raw element
    // chunks to readQueryElementChunk; delta must survive that path.
    expect(
      readQueryElementChunk({
        attrs: ' name="cart" delta',
        content: '{"set":{"count":5}}',
      }),
    ).toEqual({ delta: true, name: 'cart', value: { set: { count: 5 } } });
  });

  it('decodes escaped kovo-text chunks without treating token text as HTML', () => {
    expect(
      readMutationResponseBodyChunks(
        '<kovo-text target="assistant:a1" mode="append">&lt;strong&gt;safe &amp; escaped&lt;/strong&gt;</kovo-text>',
      ),
    ).toEqual({
      fragments: [],
      queries: [],
      texts: [
        {
          target: 'assistant:a1',
          text: '<strong>safe & escaped</strong>',
        },
      ],
    });
  });

  it('parses checkpoint kovo-text chunks beside query and fragment chunks', () => {
    expect(
      readMutationResponseBodyChunks(
        [
          '<kovo-fragment target="messages" mode="append"><article></article></kovo-fragment>',
          '<kovo-text target="assistant:a1" mode="checkpoint">server text so far</kovo-text>',
          '<kovo-query name="chat">{"count":1}</kovo-query>',
        ].join(''),
      ),
    ).toEqual({
      fragments: [{ html: '<article></article>', mode: 'append', target: 'messages' }],
      queries: [{ name: 'chat', value: { count: 1 } }],
      texts: [{ mode: 'checkpoint', target: 'assistant:a1', text: 'server text so far' }],
    });
  });
});
