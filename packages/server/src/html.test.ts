import { describe, expect, it } from 'vitest';

import {
  decideRuntimeAttributeWrite,
  setRuntimeSinkSecurityEventHandler,
  type RuntimeSinkSecurityEvent,
} from '@kovojs/core/internal/sink-policy';
import {
  escapeAttribute,
  isRenderedHtml,
  renderedHtml,
  renderHtmlValue,
  safeRuntimeAttribute,
  safeUrlAttribute,
} from './html.js';

// SPEC.md §4.8 + §5.2#10: server and client must encode URL-bearing attributes
// identically. `safeUrlAttribute` mirrors the client's `kovoBoundAttributeValue`
// scheme-check logic for server SSR (F1 fix in bugs-and-testing-part2.md).
describe('safeUrlAttribute (F1 — server URL-scheme sanitizer)', () => {
  it('pins rendered bytes across hostile collection and freeze prototype replacement', () => {
    const originalWeakMapGet = WeakMap.prototype.get;
    const originalWeakMapHas = WeakMap.prototype.has;
    const originalWeakMapSet = WeakMap.prototype.set;
    const originalWeakSetAdd = WeakSet.prototype.add;
    const originalWeakSetHas = WeakSet.prototype.has;
    const originalFreeze = Object.freeze;
    let genuine = '';
    let forgedAccepted = true;
    let frozen = false;
    try {
      WeakMap.prototype.get = () => '<img src=x onerror=forged()>';
      WeakMap.prototype.has = () => true;
      WeakMap.prototype.set = function () {
        return this;
      };
      WeakSet.prototype.add = function () {
        return this;
      };
      WeakSet.prototype.has = () => true;
      Object.freeze = ((value: unknown) => value) as typeof Object.freeze;

      const rendered = renderedHtml('<main>pinned</main>');
      genuine = renderHtmlValue(rendered);
      forgedAccepted = isRenderedHtml({ html: '<img src=x onerror=forged()>' });
      frozen = Object.isFrozen(rendered);
    } finally {
      WeakMap.prototype.get = originalWeakMapGet;
      WeakMap.prototype.has = originalWeakMapHas;
      WeakMap.prototype.set = originalWeakMapSet;
      WeakSet.prototype.add = originalWeakSetAdd;
      WeakSet.prototype.has = originalWeakSetHas;
      Object.freeze = originalFreeze;
    }

    expect(genuine).toBe('<main>pinned</main>');
    expect(forgedAccepted).toBe(false);
    expect(frozen).toBe(true);
  });

  it('escapes forged rendered and trusted HTML brands as text', () => {
    const renderedPayload = '<img src=x onerror=alert(1)>';
    const forgedRendered = {
      [Symbol.for('kovo.renderedHtml')]: true,
      html: renderedPayload,
      toString: () => renderedPayload,
    };
    const forgedTrusted = {
      __kovoTrustedHtml: true,
      value: renderedPayload,
    };
    const forgedBrowserTrusted = {
      [Symbol.toStringTag]: 'TrustedHTML',
      toString: () => renderedPayload,
    };

    expect(renderHtmlValue(forgedRendered)).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(renderHtmlValue(forgedRendered)).not.toContain(renderedPayload);
    expect(renderHtmlValue(forgedTrusted)).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(renderHtmlValue(forgedTrusted)).not.toContain(renderedPayload);
    expect(renderHtmlValue(forgedBrowserTrusted)).not.toContain(renderedPayload);
  });

  it('neutralizes javascript: URLs to "#" for href', () => {
    expect(safeUrlAttribute('href', 'javascript:alert(1)')).toBe('#');
  });

  it('neutralizes javascript: URLs to "#" for src', () => {
    expect(safeUrlAttribute('src', 'javascript:void(0)')).toBe('#');
  });

  it('neutralizes javascript: URLs to "#" for action', () => {
    expect(safeUrlAttribute('action', 'javascript:alert(1)')).toBe('#');
  });

  it('neutralizes javascript: URLs to "#" for formaction', () => {
    expect(safeUrlAttribute('formaction', 'javascript:alert(1)')).toBe('#');
  });

  it('neutralizes javascript: URLs to "#" for xlink:href', () => {
    expect(safeUrlAttribute('xlink:href', 'javascript:alert(1)')).toBe('#');
  });

  it('strips control characters before scheme-checking (java\\nscript: bypass)', () => {
    // The normalisation step filters chars with codepoint ≤ 0x20.
    expect(safeUrlAttribute('href', 'java\nscript:alert(1)')).toBe('#');
    expect(safeUrlAttribute('href', 'java\tscript:alert(1)')).toBe('#');
    expect(safeUrlAttribute('href', 'java script:alert(1)')).toBe('#');
  });

  it('neutralizes vbscript: scheme', () => {
    expect(safeUrlAttribute('href', 'vbscript:MsgBox("XSS")')).toBe('#');
  });

  it('neutralizes data: scheme', () => {
    expect(safeUrlAttribute('href', 'data:text/html,<script>alert(1)</script>')).toBe('#');
  });

  it('passes through https:// URLs unchanged (escaped)', () => {
    expect(safeUrlAttribute('href', 'https://example.com/path?q=1&r=2')).toBe(
      escapeAttribute('https://example.com/path?q=1&r=2'),
    );
  });

  it('passes through http:// URLs unchanged', () => {
    expect(safeUrlAttribute('href', 'http://example.com')).toBe(
      escapeAttribute('http://example.com'),
    );
  });

  it('passes through mailto: URLs unchanged', () => {
    expect(safeUrlAttribute('href', 'mailto:user@example.com')).toBe(
      escapeAttribute('mailto:user@example.com'),
    );
  });

  it('passes through tel: URLs unchanged', () => {
    expect(safeUrlAttribute('href', 'tel:+15551234567')).toBe(escapeAttribute('tel:+15551234567'));
  });

  it('passes through ftp:// URLs unchanged (SPEC §4.8:347 includes ftp)', () => {
    expect(safeUrlAttribute('href', 'ftp://files.example.com/path')).toBe(
      escapeAttribute('ftp://files.example.com/path'),
    );
  });

  it('passes through relative paths unchanged', () => {
    expect(safeUrlAttribute('href', '/pricing')).toBe(escapeAttribute('/pricing'));
    expect(safeUrlAttribute('src', '../images/photo.png')).toBe(
      escapeAttribute('../images/photo.png'),
    );
  });

  it('passes through fragment-only URLs unchanged', () => {
    expect(safeUrlAttribute('href', '#section-1')).toBe(escapeAttribute('#section-1'));
  });

  it('passes through empty href unchanged', () => {
    expect(safeUrlAttribute('href', '')).toBe('');
  });

  it('does not scheme-check non-URL attribute names', () => {
    // class, id, title, etc. go through plain escapeAttribute with no scheme check.
    expect(safeUrlAttribute('class', 'javascript:foo')).toBe(escapeAttribute('javascript:foo'));
    expect(safeUrlAttribute('title', 'javascript:alert(1)')).toBe(
      escapeAttribute('javascript:alert(1)'),
    );
  });

  it('sanitizes srcset candidate lists without treating them as one URL', () => {
    expect(
      safeUrlAttribute(
        'srcset',
        '/img/small.png 1x, javascript:alert(1) 2x, https://cdn.test/large.png 3x',
      ),
    ).toBe('/img/small.png 1x, https://cdn.test/large.png 3x');
    expect(safeRuntimeAttribute('srcset', 'javascript:alert(1) 1x')).toBeNull();
  });

  it('omits non-URL executable runtime attribute sinks', () => {
    expect(safeRuntimeAttribute('onclick', 'alert(1)')).toBeNull();
    expect(safeRuntimeAttribute('ONERROR', 'alert(1)')).toBeNull();
    expect(safeRuntimeAttribute('on:click', '/c/client.js#run')).toBe('/c/client.js#run');
    expect(safeRuntimeAttribute('srcdoc', '<script>alert(1)</script>')).toBeNull();
    expect(safeRuntimeAttribute('style', 'background:url(javascript:alert(1))')).toBeNull();
    expect(safeRuntimeAttribute('style', 'min-height: 120px')).toBe('min-height: 120px');
    expect(safeRuntimeAttribute('innerHTML', '<img src=x onerror=alert(1)>')).toBeNull();
  });

  it('drains one redacted KV236 event per blocked server sink write', () => {
    const events: RuntimeSinkSecurityEvent[] = [];
    const restore = setRuntimeSinkSecurityEventHandler((event) => events.push(event));
    const attackerPayload = 'javascript:alert("secret-token")';

    try {
      expect(safeUrlAttribute('href', attackerPayload)).toBe('#');
      expect(safeRuntimeAttribute('srcset', `${attackerPayload} 1x`)).toBeNull();
      expect(safeRuntimeAttribute('style', `background:url(${attackerPayload})`)).toBeNull();
      expect(safeRuntimeAttribute('innerHTML', `<img src=x onerror="${attackerPayload}">`)).toBe(
        null,
      );
      expect(safeRuntimeAttribute('onclick', attackerPayload)).toBeNull();
    } finally {
      restore();
    }

    expect(events).toHaveLength(5);
    expect(events.map((event) => [event.code, event.family, event.action])).toEqual([
      ['KV236', 'url', 'neutralize'],
      ['KV236', 'srcset', 'remove'],
      ['KV236', 'css-text', 'remove'],
      ['KV236', 'raw-html', 'remove'],
      ['KV236', 'event-handler', 'remove'],
    ]);
    for (const event of events) {
      expect(event.value).toEqual({
        length: expect.any(Number),
        preview: `<redacted:${event.value.length}>`,
        redacted: true,
      });
    }
    expect(JSON.stringify(events)).not.toContain('secret-token');
    expect(JSON.stringify(events)).not.toContain('alert');
  });

  it('keeps server runtime attribute decisions in parity with the shared KV236 sink policy', () => {
    // SPEC.md §4.8/KV236: server render and browser fragment adoption share the
    // same runtime sink decision table for URL/srcset/CSS/raw-HTML attributes.
    for (const testCase of [
      { name: 'href', value: 'java\nscript:alert(1)' },
      { name: 'xlink:href', value: 'java\tscript:alert(1)' },
      {
        name: 'srcset',
        value: '/safe.png 1x, url("https://cdn.test/a,b.png") 2x, javascript:alert(1) 3x',
      },
      { name: 'srcset', value: 'java\tscript:alert(1) 1x' },
      { name: 'imagesrcset', value: '/safe.png 1x, data:text/html 2x' },
      { name: 'style', value: 'min-height: 120px; overflow: auto' },
      { name: 'style', value: 'background-image: url("java\nscript:alert(1)")' },
      { name: 'InNeRhTmL', value: '<img src=x onerror=alert(1)>' },
    ]) {
      const decision = decideRuntimeAttributeWrite(testCase.name, testCase.value);
      const expected =
        decision.action === 'remove' ? null : escapeAttribute(decision.value ?? testCase.value);

      expect(safeRuntimeAttribute(testCase.name, testCase.value), testCase.name).toBe(expected);
    }
  });

  it('still HTML-escapes safe URL attribute values', () => {
    // Ensures the output is safe for embedding inside a double-quoted attribute.
    expect(safeUrlAttribute('href', 'https://x.com?a=1&b=2')).toBe('https://x.com?a=1&amp;b=2');
    expect(safeUrlAttribute('href', 'https://x.com/path"suffix')).toBe(
      'https://x.com/path&quot;suffix',
    );
  });
});
