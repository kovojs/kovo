import { describe, expect, it } from 'vitest';

import { trustedHtml } from '@kovojs/browser';
import { component } from '@kovojs/core';
import {
  setRuntimeSinkSecurityEventHandler,
  type RuntimeSinkSecurityEvent,
} from '@kovojs/core/internal/sink-policy';
import * as style from '@kovojs/style';

import { validateCsrfToken } from './csrf.js';
import { escapeText, renderHtmlValue } from './html.js';
import { runWithJsxRequestContext } from './jsx-context.js';
import { Fragment, jsx, jsxDEV, jsxs } from './jsx-runtime.js';
import { mutationFormAttributes } from './mutation.js';

const html = (value: unknown): string => renderHtmlValue(value);
const asyncHtml = async (value: unknown): Promise<string> => renderHtmlValue(await value);
const TEST_CSRF_SECRET = 'test-csrf-secret-0123456789abcdef012345';

function hiddenInputValue(rendered: string, name: string): string {
  const match = new RegExp(`name="${name}" value="([^"]+)"`).exec(rendered);
  if (!match?.[1]) throw new Error(`expected hidden input ${name} in ${rendered}`);
  return match[1];
}

describe('server jsx runtime', () => {
  it('renders intrinsic elements to light-DOM HTML strings', () => {
    // SPEC.md section 4.2: components render to plain, never-registered elements.
    expect(html(jsx('span', { children: 'Cart' }))).toBe('<span>Cart</span>');
    expect(
      html(jsx('cart-badge', { class: 'badge', children: jsx('span', { children: 2 }) })),
    ).toBe('<cart-badge class="badge"><span>2</span></cart-badge>');
  });

  it('renders Kovo component descriptors instead of invoking their callable placeholder', async () => {
    const Badge = component({
      render: () => jsx('cart-badge', { children: '3' }),
    });

    await expect(asyncHtml(jsx(Badge, {}))).resolves.toBe('<cart-badge>3</cart-badge>');
  });

  it('awaits async nested children before rendering function component wrappers', async () => {
    const AsyncButton = async () => jsx('button', { children: 'Save' });
    const Card = (props: { children?: unknown }) =>
      jsx('section', { class: 'card', children: props.children as JsxChild });

    await expect(asyncHtml(jsx(Card, { children: [jsx(AsyncButton, {})] }))).resolves.toBe(
      '<section class="card"><button>Save</button></section>',
    );
  });

  it('renders boolean attributes bare and omits false, null, and undefined values', () => {
    expect(html(jsx('form', { enhance: true, children: '' }))).toBe('<form enhance></form>');
    expect(
      html(jsx('form', { enhance: false, hidden: null, action: undefined, children: '' })),
    ).toBe('<form></form>');
  });

  it('lowers typed mutation form values for direct server JSX forms', () => {
    // SPEC.md §6.3: server-rendered templates can bind the importable mutation
    // value instead of hard-coding the `/_m/*` endpoint string.
    const addToCart = { key: 'cart/add' } as const;

    const formHtml = html(
      jsx('form', {
        enhance: true,
        mutation: addToCart,
        class: 'add',
        children: '',
      }),
    );
    // SPEC.md §10.3:1063/1065: mutation forms include a per-submit Kovo-Idem field.
    expect(formHtml).toContain('action="/_m/cart/add" data-mutation="cart/add" class="add"');
    expect(formHtml).toMatch(/name="Kovo-Idem" value="[^"]+"/);
  });

  it('lowers direct server JSX streaming mutation and text attributes', () => {
    // SPEC.md §5.2/§9.1: app source authors TSX-only `stream` and `streamText`;
    // served framework output exposes the runtime-visible data attributes.
    const sendMessage = { key: 'chat/send' } as const;

    const formHtml = html(
      jsx('form', {
        enhance: true,
        stream: true,
        mutation: sendMessage,
        children: '',
      }),
    );
    const textHtml = html(jsx('p', { streamText: 'assistant:a1', children: '' }));

    expect(formHtml).toContain(
      'method="post" action="/_m/chat/send" data-mutation="chat/send" data-mutation-stream="true"',
    );
    expect(formHtml).not.toMatch(/\sstream(?:\s|>)/);
    expect(textHtml).toBe('<p data-stream-text="assistant:a1"></p>');
  });

  it('renders JSX key identity as kovo-key for direct server JSX forms', () => {
    const addToCart = { key: 'cart/add' } as const;

    const formHtml = html(
      jsx(
        'form',
        {
          enhance: true,
          mutation: addToCart,
          children: '',
        },
        'p1',
      ),
    );
    // SPEC.md §10.3:1063/1065: mutation forms include a per-submit Kovo-Idem field
    // (value is a fresh UUID each render, so we match the structure not the exact value).
    expect(formHtml).toMatch(
      /^<form kovo-key="p1" enhance method="post" action="\/_m\/cart\/add" data-mutation="cart\/add"><input type="hidden" name="kovo-form-key" value="p1"><input type="hidden" name="Kovo-Idem" value="[^"]+"><\/form>$/,
    );
    expect(html(jsx('form', { key: 'p2', enhance: true, children: '' }))).toBe(
      '<form kovo-key="p2" enhance></form>',
    );
  });

  it('renders one session-bound CSRF field for direct server JSX mutation forms', () => {
    const request = { session: { id: 's1' } };
    const csrf = {
      field: 'csrf',
      secret: TEST_CSRF_SECRET,
      sessionId: (value: typeof request) => value.session.id,
    };
    const addToCart = { csrf, key: 'cart/add' } as const;

    const rendered = html(
      runWithJsxRequestContext(request, () =>
        jsx('form', {
          enhance: true,
          mutation: addToCart,
          children: '',
        }),
      ),
    );

    // SPEC.md §10.3:1063/1065: mutation forms include a per-submit Kovo-Idem field
    // alongside the CSRF field. The idem value is a fresh UUID each render.
    expect(
      validateCsrfToken({ csrf: hiddenInputValue(rendered, 'csrf') }, request, csrf, {
        audience: 'cart/add',
      }),
    ).toBe(true);
    expect(rendered).toMatch(/name="Kovo-Idem" value="[^"]+"/);
    expect(rendered).toContain('action="/_m/cart/add"');
    expect(rendered.match(/name="csrf"/g)).toHaveLength(1);
    expect(rendered.match(/name="Kovo-Idem"/g)).toHaveLength(1);
  });

  it('does not render CSRF fields for csrf:false mutation forms but does render Kovo-Idem', () => {
    const rendered = html(
      runWithJsxRequestContext({ session: { id: 's1' } }, () =>
        jsx('form', {
          enhance: true,
          mutation: { csrf: false, key: 'cart/add' },
          children: '',
        }),
      ),
    );

    expect(rendered).not.toContain('name="kovo-csrf"');
    // SPEC.md §10.3:1063/1065: idem field is always emitted for mutation forms
    // (dedup is orthogonal to CSRF).
    expect(rendered).toMatch(/name="Kovo-Idem" value="[^"]+"/);
  });

  it('renders CSRF for mutationFormAttributes spreads through the retained mutation value', () => {
    const request = { session: { id: 's1' } };
    const csrf = {
      field: 'csrf',
      secret: TEST_CSRF_SECRET,
      sessionId: (value: typeof request) => value.session.id,
    };
    const addToCart = { csrf, key: 'cart/add' } as const;

    const rendered = html(
      runWithJsxRequestContext(request, () =>
        jsx('form', {
          ...mutationFormAttributes(addToCart),
          children: '',
        }),
      ),
    );

    expect(rendered).toContain('action="/_m/cart/add"');
    expect(
      validateCsrfToken({ csrf: hiddenInputValue(rendered, 'csrf') }, request, csrf, {
        audience: 'cart/add',
      }),
    ).toBe(true);
    expect(rendered.match(/name="csrf"/g)).toHaveLength(1);
  });

  it('escapes attribute values', () => {
    expect(html(jsx('input', { value: 'a"b<c&d' }))).toBe('<input value="a&quot;b&lt;c&amp;d">');
  });

  // bugz H1 (SPEC.md §1.1/§2, §4.8 KV236): the runtime sink policy classifies attribute
  // VALUES but trusted the NAME verbatim, so a dynamic spread (`<div {...record}>`) with
  // attacker-controlled keys broke out of the tag (stored XSS). Attribute names are now
  // fail-closed against a strict allowlist.
  it('H1: omits attacker-controlled attribute names from a dynamic spread', () => {
    const record: Record<string, unknown> = { 'x><img src=x onerror=alert(1)>': 'y' };
    const out = html(jsx('div', { ...record }));
    expect(out).toBe('<div></div>');
    expect(out).not.toContain('onerror');
  });

  it('H1: omits a boolean-true hostile key that would inject raw markup', () => {
    const record: Record<string, unknown> = { '><script>alert(1)</script>': true };
    expect(html(jsx('div', { ...record }))).toBe('<div></div>');
  });

  it('H1: retains legitimate hyphen/colon/aria/data attribute names', () => {
    expect(html(jsx('a', { 'data-bind': 'x', 'aria-label': 'Close', 'xlink:href': '/y' }))).toBe(
      '<a data-bind="x" aria-label="Close" xlink:href="/y"></a>',
    );
  });

  it('H1: drains a redacted KV236 event when an attribute name is rejected', () => {
    const events: RuntimeSinkSecurityEvent[] = [];
    const restore = setRuntimeSinkSecurityEventHandler((event) => events.push(event));
    try {
      html(jsx('div', { 'x ><b>': 'secret-token' }));
    } finally {
      restore();
    }
    expect(events).toHaveLength(1);
    expect([events[0]!.code, events[0]!.family, events[0]!.action]).toEqual([
      'KV236',
      'attribute',
      'remove',
    ]);
    expect(JSON.stringify(events)).not.toContain('><b>');
  });

  // bugz.md M2 (SPEC.md §4.5/§5.2, FIXED): the compiler injects `{escapeText(expr)}`. `escapeText`
  // now brands its already-escaped result as RenderedHtml, so the server JSX runtime passes it
  // through the `isRenderedHtml` fast-path instead of escaping `&`/`<`/`>` a SECOND time
  // (`&` -> `&amp;amp;`). The branded value materializes the escaped text up front and resolves any
  // coerced-rendered-html marker, so nothing leaks into the list-stamp / live-component boundary.
  // This test pins the corrected SINGLE-escape so the M2 regression cannot return.
  it('M2 (fixed): a compiler-injected escapeText value is single-escaped through the runtime', () => {
    const child = escapeText('AT&T <b> R&D');
    expect(html(jsx('h2', { 'data-bind': 'x', children: child }))).toBe(
      '<h2 data-bind="x">AT&amp;T &lt;b&gt; R&amp;D</h2>',
    );
    // The marker sentinel must never reach shipped HTML.
    expect(html(jsx('h2', { 'data-bind': 'x', children: child }))).not.toContain(
      'kovo-rendered-html',
    );
  });

  // F1 — server URL-scheme sanitizer (SPEC.md §4.8 + §5.2#10).
  // A dynamic URL value like `href={row.url}` must be scheme-checked at server render
  // time so `javascript:` sinks cannot appear in first-paint HTML.
  it('F1: neutralizes a dynamic javascript: href to "#" in server JSX', () => {
    // Red path (pre-fix): would have rendered `href="javascript:alert(1)"`.
    expect(html(jsx('a', { href: 'javascript:alert(1)', children: 'click' }))).toBe(
      '<a href="#">click</a>',
    );
  });

  it('F1: neutralizes javascript: src attributes', () => {
    expect(html(jsx('img', { src: 'javascript:alert(1)' }))).toBe('<img src="#">');
  });

  it('F1: neutralizes javascript: with embedded control chars (bypass attempt)', () => {
    expect(html(jsx('a', { href: 'java\nscript:alert(1)', children: 'x' }))).toBe(
      '<a href="#">x</a>',
    );
  });

  it('F1: passes safe https:// href through unchanged', () => {
    expect(
      html(jsx('a', { href: 'https://example.com/pricing', external: true, children: 'go' })),
    ).toBe('<a href="https://example.com/pricing" external>go</a>');
  });

  it('F1: passes relative href through unchanged', () => {
    expect(html(jsx('a', { href: '/cart', children: 'cart' }))).toBe('<a href="/cart">cart</a>');
  });

  it('F1: passes fragment href through unchanged', () => {
    expect(html(jsx('a', { href: '#section', children: 'sec' }))).toBe(
      '<a href="#section">sec</a>',
    );
  });

  it('F1: passes ftp:// href through unchanged (SPEC §4.8:347 includes ftp)', () => {
    expect(html(jsx('a', { href: 'ftp://files.example.com/path', children: 'ftp' }))).toBe(
      '<a href="ftp://files.example.com/path">ftp</a>',
    );
  });

  it('filters unsafe srcset candidates at server render time', () => {
    expect(
      html(
        jsx('img', {
          srcset: '/img/small.png 1x, javascript:alert(1) 2x, https://cdn.test/large.png 3x',
        }),
      ),
    ).toBe('<img srcset="/img/small.png 1x, https://cdn.test/large.png 3x">');
    expect(html(jsx('img', { srcset: 'javascript:alert(1) 1x' }))).toBe('<img>');
  });

  it('omits runtime string event handlers, srcdoc, and raw style text in server JSX', () => {
    expect(
      html(
        jsx('iframe', {
          onload: 'alert(1)',
          srcdoc: '<script>alert(1)</script>',
          style: 'background:url(javascript:alert(1))',
          title: 'safe',
        }),
      ),
    ).toBe('<iframe title="safe"></iframe>');
  });

  it('preserves Kovo delegated handler attributes while omitting native event handlers', () => {
    // SPEC.md §4.4 uses `on:*` as declarative Kovo handler metadata; only native
    // `on*` HTML event attributes are executable sinks under SPEC.md §4.8.
    expect(
      html(
        jsx('button', {
          onclick: 'alert(1)',
          'on:click': '/c/client.js#run',
          children: 'Run',
        }),
      ),
    ).toBe('<button on:click="/c/client.js#run">Run</button>');
  });

  it('renders style objects through property-level sanitizers', () => {
    expect(
      html(
        jsx('span', {
          style: {
            left: '25%',
            transform: 'translate(-50%, -50%)',
            width: 'url(javascript:alert(1))',
          },
        }),
      ),
    ).toBe('<span style="left: 25%; transform: translate(-50%, -50%)"></span>');
  });

  it('renders Kovo style records passed through style= in direct server JSX', () => {
    const styles = style.create({
      root: {
        backgroundColor: 'black',
        color: 'white',
      },
      inline: {
        marginTop: 4,
      },
    });

    expect(html(jsx('button', { style: styles.root, children: 'Buy' }))).toMatch(
      /^<button class="kv-style-bg-[^ ]+ kv-style-fg-[^"]+">Buy<\/button>$/,
    );
    expect(
      html(
        jsx('button', {
          class: 'manual',
          style: [styles.root, [styles.inline, { opacity: 0.8 }]],
          children: 'Buy',
        }),
      ),
    ).toMatch(
      /^<button class="manual kv-style-bg-[^ ]+ kv-style-fg-[^ ]+ kv-style-m-[^"]+" style="opacity:0.8">Buy<\/button>$/,
    );
  });

  it('lowers viewTransitionName to sanitized CSS in direct server JSX', () => {
    // SPEC.md §8: route-page helper JSX uses the runtime path, so framework-special
    // view-transition props must not leak as inert camelCase HTML attributes.
    expect(html(jsx('span', { viewTransitionName: 'page-hero', children: 'Hero' }))).toBe(
      '<span style="view-transition-name: page-hero">Hero</span>',
    );
    expect(html(jsx('span', { viewTransitionName: 'page hero', children: 'Hero' }))).toBe(
      '<span style="view-transition-name: page-hero">Hero</span>',
    );
    expect(html(jsx('span', { viewTransitionName: 'page-hero', children: 'Hero' }))).not.toContain(
      'viewTransitionName',
    );
  });

  it('renders raw HTML sinks only from trusted values', () => {
    const browserTrustedHtml = {
      [Symbol.toStringTag]: 'TrustedHTML',
      toString: () => '<i>browser trusted</i>',
    } as const;

    expect(
      html(
        jsx('section', {
          dangerouslySetInnerHTML: trustedHtml('<b>kovo trusted</b>'),
          children: 'ignored',
        }),
      ),
    ).toBe('<section><b>kovo trusted</b></section>');
    expect(html(jsx('section', { innerHTML: browserTrustedHtml }))).toBe(
      '<section><i>browser trusted</i></section>',
    );
    expect(html(jsx('section', { rawHtml: trustedHtml(browserTrustedHtml) }))).toBe(
      '<section><i>browser trusted</i></section>',
    );
    expect(html(jsx('section', { html: trustedHtml('<em>html helper</em>') }))).toBe(
      '<section><em>html helper</em></section>',
    );
  });

  it('safely no-ops dynamic plain strings and unbranded objects in raw HTML sinks', () => {
    expect(html(jsx('section', { dangerouslySetInnerHTML: '<img src=x onerror=alert(1)>' }))).toBe(
      '<section></section>',
    );
    expect(html(jsx('section', { innerHTML: { toString: () => '<i>not trusted</i>' } }))).toBe(
      '<section></section>',
    );
    expect(html(jsx('section', { rawHtml: '<b>not trusted</b>', title: 'copy' }))).toBe(
      '<section title="copy"></section>',
    );
    expect(html(jsx('section', { html: '<b>not trusted</b>' }))).toBe('<section></section>');
  });

  it('renders trusted HTML child values without escaping', () => {
    expect(html(jsx('section', { children: trustedHtml('<kovo-defer></kovo-defer>') }))).toBe(
      '<section><kovo-defer></kovo-defer></section>',
    );
  });

  it('renders void elements without closing tags', () => {
    expect(html(jsx('input', { name: 'quantity', type: 'number', min: 1 }))).toBe(
      '<input name="quantity" type="number" min="1">',
    );
    expect(html(jsx('img', { src: '/p1.png' }))).toBe('<img src="/p1.png">');
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

    expect(html(list)).toBe('<ol><li kovo-key="p1">p1</li><li kovo-key="p2">p2</li></ol>');
  });

  it('renders fragments and function components', () => {
    const Badge = (props: { children?: unknown }) =>
      jsx('span', { class: 'badge', children: props.children as string });

    expect(html(Fragment({ children: ['a', 'b'] }))).toBe('ab');
    expect(html(jsx(Badge, { children: 'Cart' }))).toBe('<span class="badge">Cart</span>');
  });

  it('aliases jsxs and jsxDEV to jsx for static and dev transforms', () => {
    expect(html(jsxs('span', { children: ['a', 'b'] }))).toBe('<span>ab</span>');
    expect(html(jsxDEV('span', { children: 'a' }))).toBe('<span>a</span>');
  });

  it('escapes plain text children while preserving nested framework HTML', () => {
    expect(html(jsx('p', { children: '<img src=x onerror=alert(1)>' }))).toBe(
      '<p>&lt;img src=x onerror=alert(1)&gt;</p>',
    );
    expect(
      html(
        jsx('section', {
          children: [jsx('strong', { children: 'safe' }), ' <script>alert(1)</script>'],
        }),
      ),
    ).toBe('<section><strong>safe</strong> &lt;script&gt;alert(1)&lt;/script&gt;</section>');
  });

  // A2 — per-submit Kovo-Idem hidden field (SPEC.md §10.3:1063/1065).
  // No-JS forms must carry a fresh idem token each render so the server replay
  // store can dedup Back-resubmit / double-submit.
  it('A2: emits a Kovo-Idem hidden field for every mutation form', () => {
    const addToCart = { key: 'cart/add' } as const;
    const rendered = html(jsx('form', { mutation: addToCart, children: '' }));
    expect(rendered).toMatch(/name="Kovo-Idem" value="[^"]+"/);
  });

  it('A2: the Kovo-Idem value is a non-empty cryptographic UUID', () => {
    const addToCart = { key: 'cart/add' } as const;
    const rendered = html(jsx('form', { mutation: addToCart, children: '' }));
    const match = /name="Kovo-Idem" value="([^"]+)"/.exec(rendered);
    expect(match).not.toBeNull();
    // RFC 4122 UUID format — 128 bits, cryptographically sourced.
    expect(match![1]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('A2: each render mints a distinct Kovo-Idem value (per-submit freshness)', () => {
    const addToCart = { key: 'cart/add' } as const;
    const html1 = html(jsx('form', { mutation: addToCart, children: '' }));
    const html2 = html(jsx('form', { mutation: addToCart, children: '' }));
    const match1 = /name="Kovo-Idem" value="([^"]+)"/.exec(html1);
    const match2 = /name="Kovo-Idem" value="([^"]+)"/.exec(html2);
    expect(match1![1]).not.toBe(match2![1]);
  });

  it('A2: does not emit a Kovo-Idem field for non-mutation forms', () => {
    expect(html(jsx('form', { action: '/search', children: '' }))).not.toContain('Kovo-Idem');
  });
});
