import { describe, expect, it } from 'vitest';

import {
  renderDoneWireHtml,
  renderFragmentWireHtml,
  renderQueryPageWireHtml,
  renderQueryScript,
  renderQueryWireHtml,
  renderTextWireHtml,
} from './wire-html.js';

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

  it('emits mode="prepend" for the SPEC §9.3 load-older insert vocabulary', () => {
    expect(
      renderFragmentWireHtml({
        html: '<article kovo-key="m1">Older</article>',
        mode: 'prepend',
        target: 'chat-log',
      }),
    ).toBe(
      '<kovo-fragment target="chat-log" mode="prepend"><article kovo-key="m1">Older</article></kovo-fragment>',
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

  it('renders escaped kovo-text chunks with checkpoint mode', () => {
    expect(
      renderTextWireHtml({
        mode: 'checkpoint',
        target: 'assistant&a1',
        text: '<strong>safe & escaped</strong>',
      }),
    ).toBe(
      '<kovo-text target="assistant&amp;a1" mode="checkpoint">&lt;strong&gt;safe &amp; escaped&lt;/strong&gt;</kovo-text>',
    );
  });

  it('renders a readable terminal stream marker', () => {
    expect(renderDoneWireHtml({ reason: 'complete&verified' })).toBe(
      '<kovo-done reason="complete&amp;verified"></kovo-done>',
    );
  });
});

describe('wire codec — unserializable value normalization (bugs-part4 L3/L4/L5)', () => {
  it('L3: a bigint column does NOT throw and serializes via the tagged codec', () => {
    // Previously `JSON.stringify({ count: 10n })` threw, 500ing the whole /_q read.
    expect(() => renderQueryWireHtml({ name: 'cart', value: { count: 10n } })).not.toThrow();
    expect(renderQueryWireHtml({ name: 'cart', value: { count: 10n } })).toBe(
      '<kovo-query name="cart">{"count":{"$kovo":"bigint","value":"10"}}</kovo-query>',
    );
  });

  it('L4: a bigint in a (mutation rerun) query value serializes through the shared seam', () => {
    // renderQueryWireHtml is shared by the mutation-rerun render path; it must not throw.
    expect(() =>
      renderQueryWireHtml({ name: 'cart', key: 'cart:c1', value: { total: 999999999999999n } }),
    ).not.toThrow();
  });

  it('L5: a Date column serializes to the tagged date form (round-trips as a Date)', () => {
    expect(
      renderQueryWireHtml({ name: 'order', value: { at: new Date('2020-01-02T03:04:05.678Z') } }),
    ).toBe(
      '<kovo-query name="order">{"at":{"$kovo":"date","value":"2020-01-02T03:04:05.678Z"}}</kovo-query>',
    );
  });

  it('normalizes nested bigint/Date inside arrays and objects', () => {
    const html = renderQueryWireHtml({
      name: 'q',
      value: { rows: [{ id: 1n, at: new Date('2021-06-01T00:00:00.000Z') }] },
    });
    expect(html).toContain('{"$kovo":"bigint","value":"1"}');
    expect(html).toContain('{"$kovo":"date","value":"2021-06-01T00:00:00.000Z"}');
  });

  it('renderQueryScript also normalizes bigint at the script encode seam', () => {
    expect(() => renderQueryScript({ name: 'cart', value: { n: 5n } })).not.toThrow();
    expect(renderQueryScript({ name: 'cart', value: { n: 5n } })).toContain(
      '{"n":{"$kovo":"bigint","value":"5"}}',
    );
  });

  it('emits null for an invalid Date rather than throwing', () => {
    expect(renderQueryWireHtml({ name: 'q', value: { at: new Date('not-a-date') } })).toBe(
      '<kovo-query name="q">{"at":{"$kovo":"date","value":null}}</kovo-query>',
    );
  });
});

describe('renderQueryPageWireHtml (read-side pagination, SPEC §9.1.1/§9.3)', () => {
  it('emits a delta chunk carrying ONLY the new page rows under lists.<path>.upsert (no re-ship)', () => {
    expect(
      renderQueryPageWireHtml({
        name: 'productGrid',
        path: 'items',
        keyField: 'id',
        rows: [{ id: 'p3' }, { id: 'p4' }],
      }),
    ).toBe(
      '<kovo-query name="productGrid" delta>{"lists":{"items":{"key":"id","upsert":[{"id":"p3"},{"id":"p4"}]}}}</kovo-query>',
    );
  });

  it('flags prepend for a load-older page against a keyed instance', () => {
    expect(
      renderQueryPageWireHtml({
        name: 'messages',
        key: 'messages:room-1',
        path: 'items',
        keyField: 'id',
        mode: 'prepend',
        rows: [{ id: 'm1' }],
      }),
    ).toBe(
      '<kovo-query name="messages" key="messages:room-1" delta>{"lists":{"items":{"key":"id","upsert":[{"id":"m1"}],"prepend":true}}}</kovo-query>',
    );
  });
});
