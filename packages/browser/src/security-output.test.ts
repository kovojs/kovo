import { describe, expect, it, vi } from 'vitest';

import {
  GENERATED_ONLY_SEMANTIC_ATTRIBUTES,
  GENERATED_ONLY_SEMANTIC_ATTRIBUTE_PREFIXES,
} from '@kovojs/core/internal/semantic-attributes';
import {
  setRuntimeSinkSecurityEventHandler,
  type RuntimeSinkSecurityEvent,
} from '@kovojs/core/internal/sink-policy';
import {
  isBrowserTrustedHtml,
  isKovoTrustedHtml,
  isKovoTrustedUrl,
  kovoBoundAttributeValue,
  kovoEscapeHtml,
  kovoSafeUrl,
  kovoStyleProperties,
  kovoStyleProperty,
  kovoTrustedHtmlContent,
  safeRichHtml,
  sanitizeRichHtml,
  trustedHtml,
  trustedUrl,
} from './security-output.js';
import type { TrustedHtml, TrustedUrl } from './security-output.js';

// SPEC §6.6: the public types are only author-time guardrails. Plain structural objects must not
// satisfy the trusted wrappers; runtime enforcement remains the module-private WeakSets below.
// @ts-expect-error structural objects cannot mint Kovo TrustedHtml.
const forgedTrustedHtmlType: TrustedHtml = { value: '<b>unsafe</b>' };
// @ts-expect-error structural objects cannot mint Kovo TrustedUrl.
const forgedTrustedUrlType: TrustedUrl = { value: 'javascript:alert(1)' };

describe('runtime output-context helpers', () => {
  it('keeps HTML escaping, rich-text sanitization, and URL checks pinned after prototype changes', () => {
    const attacker = '<img src=x onerror=alert(1)>';
    const originalReplace = String.prototype.replace;
    const originalReplaceAll = String.prototype.replaceAll;
    const originalTrim = String.prototype.trim;
    const originalSlice = String.prototype.slice;
    const originalIndexOf = String.prototype.indexOf;
    const originalStartsWith = String.prototype.startsWith;
    const originalCharCodeAt = String.prototype.charCodeAt;
    const originalToLowerCase = String.prototype.toLowerCase;
    const originalExec = RegExp.prototype.exec;
    const originalTest = RegExp.prototype.test;
    const originalMap = Array.prototype.map;
    const originalJoin = Array.prototype.join;
    let escaped = '';
    let safeUrl = '';
    let rich = '';

    try {
      String.prototype.replace = function () {
        return attacker;
      };
      String.prototype.replaceAll = function () {
        return attacker;
      };
      String.prototype.trim = function () {
        return attacker;
      };
      String.prototype.slice = function () {
        return attacker;
      };
      String.prototype.indexOf = () => -1;
      String.prototype.startsWith = () => false;
      String.prototype.charCodeAt = () => 0;
      String.prototype.toLowerCase = function () {
        return 'forged-safe';
      };
      RegExp.prototype.exec = () => null;
      RegExp.prototype.test = () => false;
      Array.prototype.map = (() => [attacker]) as typeof Array.prototype.map;
      Array.prototype.join = () => attacker;

      escaped = kovoEscapeHtml(attacker);
      safeUrl = kovoSafeUrl('java\nscript:alert(1)');
      rich = sanitizeRichHtml(
        '<p title="&quot;"><script>bad()</script><a href="javascript:alert(1)">ok</a></p>',
      );
    } finally {
      String.prototype.replace = originalReplace;
      String.prototype.replaceAll = originalReplaceAll;
      String.prototype.trim = originalTrim;
      String.prototype.slice = originalSlice;
      String.prototype.indexOf = originalIndexOf;
      String.prototype.startsWith = originalStartsWith;
      String.prototype.charCodeAt = originalCharCodeAt;
      String.prototype.toLowerCase = originalToLowerCase;
      RegExp.prototype.exec = originalExec;
      RegExp.prototype.test = originalTest;
      Array.prototype.map = originalMap;
      Array.prototype.join = originalJoin;
    }

    expect(escaped).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(safeUrl).toBe('#');
    expect(rich).toBe('<p title="&amp;quot;"><a href="#">ok</a></p>');
    expect(rich).not.toContain(attacker);
  });

  it('escapes HTML-fragment placeholders and neutralizes unsafe URL attributes', () => {
    expect(kovoEscapeHtml('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;',
    );
    expect(kovoBoundAttributeValue('href', 'java\tscript:alert(1)')).toBe('#');
    expect(kovoBoundAttributeValue('href', '/products/p1')).toBe('/products/p1');
    expect(kovoBoundAttributeValue('title', '<b>copy</b>')).toBe('<b>copy</b>');
  });

  it('passes author-vouched trustedUrl values through unsafe-scheme neutralization (SPEC §4.8)', () => {
    const dangerousUrl = trustedUrl('javascript:alert(1)');
    const imageUrl = trustedUrl('data:image/png;base64,AAAA', 'reviewed CDN image');

    expect(dangerousUrl).toEqual({ value: 'javascript:alert(1)' });
    expect('__kovoTrustedUrl' in dangerousUrl).toBe(false);
    expect(imageUrl).toEqual({
      reason: 'reviewed CDN image',
      value: 'data:image/png;base64,AAAA',
    });
    expect('__kovoTrustedUrl' in imageUrl).toBe(false);
    expect(isKovoTrustedUrl(trustedUrl('data:text/html,x'))).toBe(true);
    expect(isKovoTrustedUrl('data:text/html,x')).toBe(false);

    // An unbranded unsafe URL is neutralized; the trusted brand is emitted verbatim.
    expect(kovoSafeUrl('javascript:alert(1)')).toBe('#');
    expect(kovoSafeUrl(trustedUrl('javascript:alert(1)'))).toBe('javascript:alert(1)');

    // The compiler-emitted bound-attribute path honors the brand too.
    expect(kovoBoundAttributeValue('href', 'data:text/html,evil')).toBe('#');
    expect(kovoBoundAttributeValue('href', trustedUrl('data:image/png;base64,AAAA'))).toBe(
      'data:image/png;base64,AAAA',
    );
  });

  // bugz H6 (SPEC §4.8 KV236 / §6.6): historical `__kovoTrustedUrl`/`__kovoTrustedHtml`
  // properties, process-global symbols, and hand-built object literals must NOT be treated as
  // author-vouched. Only the module-private WeakSet witness mints trust.
  it('rejects a structurally-forged trust brand from wire/query JSON', () => {
    const forgedUrl = JSON.parse(
      '{"__kovoTrustedUrl":true,"value":"javascript:alert(document.cookie)"}',
    );
    const forgedHtml = JSON.parse(
      '{"__kovoTrustedHtml":true,"value":"<img src=x onerror=alert(1)>"}',
    );
    const symbolForgedHtml = {
      [Symbol.for('kovo.security.trustedHtml')]: true,
      __kovoTrustedHtml: true,
      value: '<img src=x onerror=alert(1)>',
    };

    expect(isKovoTrustedUrl(forgedUrl)).toBe(false);
    expect(isKovoTrustedHtml(forgedHtml)).toBe(false);
    expect(isKovoTrustedHtml(symbolForgedHtml)).toBe(false);

    // A real javascript: string is still neutralized — the URL sink itself works.
    expect(kovoSafeUrl('javascript:alert(1)')).toBe('#');
    // The forged object is not author-vouched, so its inner `javascript:` payload is never
    // emitted verbatim (it stringifies to inert JSON instead of a live scheme).
    expect(kovoSafeUrl(forgedUrl)).not.toBe('javascript:alert(document.cookie)');
    expect(kovoSafeUrl(forgedUrl).startsWith('javascript:')).toBe(false);
    expect(kovoBoundAttributeValue('href', forgedUrl)).not.toBe(
      'javascript:alert(document.cookie)',
    );
    // Server twin (renderHtmlValue → kovoTrustedHtmlContent): the forged raw-HTML object no-ops.
    expect(kovoTrustedHtmlContent(forgedHtml)).toBe('');
    expect(kovoTrustedHtmlContent(symbolForgedHtml)).toBe('');

    // A hand-built object literal carrying the property is equally untrusted.
    const literal = { __kovoTrustedUrl: true as const, value: 'data:text/html,evil' };
    expect(isKovoTrustedUrl(literal)).toBe(false);
    expect(kovoSafeUrl(literal).startsWith('data:')).toBe(false);
  });

  it('does not let bare casts mint trusted output brands', () => {
    const castHtml = { value: '<img src=x onerror=alert(1)>' } as unknown as TrustedHtml;
    const castUrl = { value: 'javascript:alert(document.cookie)' } as unknown as TrustedUrl;

    expect(isKovoTrustedHtml(castHtml)).toBe(false);
    expect(isKovoTrustedUrl(castUrl)).toBe(false);
    expect(kovoTrustedHtmlContent(castHtml)).toBe('');
    expect(kovoSafeUrl(castUrl)).not.toBe('javascript:alert(document.cookie)');
    expect(kovoSafeUrl(castUrl).startsWith('javascript:')).toBe(false);
  });

  it('sanitizes generated CSS property values', () => {
    expect(kovoStyleProperty('view-transition-name', 'product hero')).toBe(
      'view-transition-name: product-hero',
    );
    expect(
      kovoStyleProperties({
        height: '28%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 'javascript:alert(1)',
      }),
    ).toBe('height: 28%; left: 50%; transform: translate(-50%, -50%)');
    expect(kovoStyleProperty('background-image', 'url(javascript:alert(1))')).toBe('');
  });

  it('filters srcset candidates and suppresses unsafe CSS text attribute writes', () => {
    expect(
      kovoBoundAttributeValue(
        'srcset',
        '/img/small.png 1x, javascript:alert(1) 2x, https://cdn.test/large.png 3x',
      ),
    ).toBe('/img/small.png 1x, https://cdn.test/large.png 3x');
    expect(kovoBoundAttributeValue('srcset', 'javascript:alert(1) 1x')).toBeNull();
    expect(kovoBoundAttributeValue('style', 'background:url(javascript:alert(1))')).toBeNull();
    expect(kovoBoundAttributeValue('style', 'min-height: 120px')).toBe('min-height: 120px');
  });

  it('unwraps only Kovo TrustedHtml and real browser TrustedHTML values', () => {
    const browserTrustedHtml = {
      [Symbol.toStringTag]: 'TrustedHTML',
      toString: () => '<i>browser trusted</i>',
    } as const;

    const html = trustedHtml('<b>safe</b>');
    expect(html).toEqual({ value: '<b>safe</b>' });
    expect('__kovoTrustedHtml' in html).toBe(false);
    expect(
      trustedHtml('<b>safe</b>', {
        reason: 'cms sanitizer owns rich text',
        source: 'cms.promo.body',
      }),
    ).toEqual({
      reason: 'cms sanitizer owns rich text',
      source: 'cms.promo.body',
      value: '<b>safe</b>',
    });
    expect(isKovoTrustedHtml(trustedHtml('<b>safe</b>'))).toBe(true);
    expect(isBrowserTrustedHtml(browserTrustedHtml)).toBe(false);
    expect(isBrowserTrustedHtml({ toString: () => '<i>not branded</i>' })).toBe(false);
    expect(kovoTrustedHtmlContent(trustedHtml('<b>safe</b>'))).toBe('<b>safe</b>');
    expect(kovoTrustedHtmlContent(trustedHtml(browserTrustedHtml))).toBe('');
    expect(kovoTrustedHtmlContent(browserTrustedHtml)).toBe('');
    expect(kovoTrustedHtmlContent('<img src=x onerror=alert(1)>')).toBe('');
    expect(kovoTrustedHtmlContent({ toString: () => '<i>not branded</i>' })).toBe('');
  });

  it('pins trusted carrier bytes and freezes public wrappers before raw sinks consume them', () => {
    let browserBytes = '<i>browser-safe</i>';
    const browserCarrier = {
      [Symbol.toStringTag]: 'TrustedHTML',
      toString: () => browserBytes,
    } as const;
    const html = trustedHtml(browserCarrier);
    const url = trustedUrl('javascript:reviewed()');
    const rich = safeRichHtml('<p>safe</p><script>blocked()</script>');

    expect(Object.isFrozen(html)).toBe(true);
    expect(Object.isFrozen(url)).toBe(true);
    expect(Object.isFrozen(rich)).toBe(true);
    expect(Reflect.set(html as object, 'value', '<img src=x onerror=alert(1)>')).toBe(false);
    expect(Reflect.set(url as object, 'value', 'javascript:alert(1)')).toBe(false);
    expect(() => Object.assign(rich, { value: '<script>alert(1)</script>' })).toThrow();
    expect(() =>
      Object.defineProperty(html, 'value', { value: '<script>alert(1)</script>' }),
    ).toThrow();

    // A foreign structural TrustedHTML-like source never crosses the browser-carrier boundary.
    browserBytes = '<img src=x onerror=alert(1)>';
    expect(kovoTrustedHtmlContent(html)).toBe('');
    expect(kovoSafeUrl(url)).toBe('javascript:reviewed()');
    expect(kovoTrustedHtmlContent(rich)).toBe('<p>safe</p>');
  });

  it('keeps witnesses, snapshots, and sanitizer allowlists pinned after ambient poisoning', () => {
    const securityPoisonSet = new Set<string>();
    const originalWeakMapGet = WeakMap.prototype.get;
    const originalWeakMapHas = WeakMap.prototype.has;
    const originalWeakMapSet = WeakMap.prototype.set;
    const originalWeakSetAdd = WeakSet.prototype.add;
    const originalWeakSetHas = WeakSet.prototype.has;
    const originalMapGet = Map.prototype.get;
    const originalMapHas = Map.prototype.has;
    const originalMapSet = Map.prototype.set;
    const originalSetAdd = Set.prototype.add;
    const originalSetHas = Set.prototype.has;
    const originalFreeze = Object.freeze;
    let genuine = '';
    let forged = 'unreached';
    let sanitized = '';
    let frozen = false;
    try {
      WeakMap.prototype.get = () => '<script>forged-map()</script>';
      WeakMap.prototype.has = () => true;
      WeakMap.prototype.set = function () {
        return this;
      };
      WeakSet.prototype.add = function () {
        return this;
      };
      WeakSet.prototype.has = () => true;
      Map.prototype.get = () => securityPoisonSet;
      Map.prototype.has = () => true;
      Map.prototype.set = function () {
        return this;
      };
      Set.prototype.add = function () {
        return this;
      };
      Set.prototype.has = () => true;
      Object.freeze = ((value: unknown) => value) as typeof Object.freeze;

      const trusted = trustedHtml('<strong>pinned</strong>');
      genuine = kovoTrustedHtmlContent(trusted);
      forged = kovoTrustedHtmlContent({ value: '<script>forged()</script>' });
      sanitized = sanitizeRichHtml('<p onclick="bad()">safe</p><script>bad()</script>');
      frozen = Object.isFrozen(trusted);
    } finally {
      WeakMap.prototype.get = originalWeakMapGet;
      WeakMap.prototype.has = originalWeakMapHas;
      WeakMap.prototype.set = originalWeakMapSet;
      WeakSet.prototype.add = originalWeakSetAdd;
      WeakSet.prototype.has = originalWeakSetHas;
      Map.prototype.get = originalMapGet;
      Map.prototype.has = originalMapHas;
      Map.prototype.set = originalMapSet;
      Set.prototype.add = originalSetAdd;
      Set.prototype.has = originalSetHas;
      Object.freeze = originalFreeze;
    }

    expect(genuine).toBe('<strong>pinned</strong>');
    expect(forged).toBe('');
    expect(sanitized).toBe('<p>safe</p>');
    expect(frozen).toBe(true);
  });

  it('rejects a TrustedHTML constructor installed after framework initialization', () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'TrustedHTML');
    class MutableTrustedHTML {
      readonly [Symbol.toStringTag] = 'TrustedHTML' as const;
      value = '<strong>first</strong>';
      toString(): string {
        return this.value;
      }
    }
    Object.defineProperty(globalThis, 'TrustedHTML', {
      configurable: true,
      value: MutableTrustedHTML,
    });
    try {
      const browserValue = new MutableTrustedHTML();
      expect(isBrowserTrustedHtml(browserValue)).toBe(false);
      expect(kovoTrustedHtmlContent(browserValue)).toBe('');
      browserValue.value = '<img src=x onerror=alert(1)>';
      expect(kovoTrustedHtmlContent(browserValue)).toBe('');
    } finally {
      if (previous === undefined) delete (globalThis as { TrustedHTML?: unknown }).TrustedHTML;
      else Object.defineProperty(globalThis, 'TrustedHTML', previous);
    }
  });

  it('rejects a structural TrustedHTML host installed before module initialization', async () => {
    const previousConstructor = Object.getOwnPropertyDescriptor(globalThis, 'TrustedHTML');
    const previousFactory = Object.getOwnPropertyDescriptor(globalThis, 'trustedTypes');
    class PlatformTrustedHTML {
      readonly [Symbol.toStringTag] = 'TrustedHTML' as const;
      value = '<strong>first</strong>';
      toString(): string {
        return this.value;
      }
    }
    const factory = {
      isHTML(value: unknown): boolean {
        return value instanceof PlatformTrustedHTML;
      },
    };
    Object.defineProperty(globalThis, 'TrustedHTML', {
      configurable: true,
      value: PlatformTrustedHTML,
    });
    Object.defineProperty(globalThis, 'trustedTypes', { configurable: true, value: factory });
    vi.resetModules();
    try {
      const fresh = await import('./security-output.js');
      const browserValue = new PlatformTrustedHTML();
      expect(fresh.isBrowserTrustedHtml(browserValue)).toBe(false);
      expect(fresh.kovoTrustedHtmlContent(browserValue)).toBe('');

      browserValue.value = '<img src=x onerror=alert(1)>';
      expect(fresh.kovoTrustedHtmlContent(browserValue)).toBe('');

      class LateFakeTrustedHTML {
        readonly [Symbol.toStringTag] = 'TrustedHTML' as const;
        toString(): string {
          return '<script>late-fake()</script>';
        }
      }
      Object.defineProperty(globalThis, 'TrustedHTML', {
        configurable: true,
        value: LateFakeTrustedHTML,
      });
      Object.defineProperty(globalThis, 'trustedTypes', {
        configurable: true,
        value: { isHTML: () => true },
      });
      expect(fresh.isBrowserTrustedHtml(new LateFakeTrustedHTML())).toBe(false);
      expect(fresh.isBrowserTrustedHtml({ toString: () => '<script>fake()</script>' })).toBe(false);
    } finally {
      if (previousConstructor === undefined) {
        delete (globalThis as { TrustedHTML?: unknown }).TrustedHTML;
      } else {
        Object.defineProperty(globalThis, 'TrustedHTML', previousConstructor);
      }
      if (previousFactory === undefined) {
        delete (globalThis as { trustedTypes?: unknown }).trustedTypes;
      } else {
        Object.defineProperty(globalThis, 'trustedTypes', previousFactory);
      }
      vi.resetModules();
    }
  });

  it('sanitizes CMS rich HTML before returning a trusted HTML brand', () => {
    const rich = safeRichHtml(
      '<p onclick="steal()">Hello <strong>world</strong><script>alert(1)</script>' +
        '<a href="javascript:alert(1)" target="popup" rel="noopener evil">link</a>' +
        '<img src="data:text/html,<svg onload=alert(1)>" srcset="/safe.png 1x, javascript:bad 2x" onerror="bad()">' +
        '<custom-tag data-x="<ok>">text</custom-tag></p>',
      { reason: 'cms body', source: 'posts.body' },
    );

    expect(rich.reason).toBe('cms body');
    expect(rich.source).toBe('posts.body');
    expect(kovoTrustedHtmlContent(rich)).toBe(
      '<p>Hello <strong>world</strong><a href="#" rel="noopener">link</a>' +
        '<img src="#" srcset="/safe.png 1x">text</p>',
    );
  });

  it('strips Kovo control-plane data attributes while retaining inert CMS metadata', () => {
    const rich = safeRichHtml(
      '<p data-cms-id="post-1" data-profile-id="public"' +
        ' data-bind="state.privateDraft" data-bind:aria-label="state.secret"' +
        ' data-bind-list="state.items" data-bind-prop:open="state.open"' +
        ' data-derive="/c/private.js#derive" data-derive-attr="title"' +
        ' data-plan="private-plan" data-p-account-id="victim"' +
        ' data-enhance data-mutation="account/delete" data-mutation-stream="true"' +
        ' data-stream data-stream-text="assistant:a1"' +
        ' data-stream-renderer="/c/private.js#render"' +
        ' data-kovo-module-allowlist="/c/private.js"' +
        ' data-state="armed" data-key="forged-key">Safe</p>',
    );

    expect(kovoTrustedHtmlContent(rich)).toBe(
      '<p data-cms-id="post-1" data-profile-id="public">Safe</p>',
    );
  });

  it('escapes malformed rich HTML text and closes allowed elements', () => {
    expect(sanitizeRichHtml('<p>one < two <em>three')).toBe('<p>one &lt; two <em>three</em></p>');
  });

  // F2: runtime must neutralize on* and srcdoc attribute sinks (KV236/SPEC §4.8:348)
  it('returns null for on* and srcdoc attribute names to suppress write', () => {
    expect(kovoBoundAttributeValue('onclick', 'alert(1)')).toBeNull();
    expect(kovoBoundAttributeValue('onerror', 'bad()')).toBeNull();
    expect(kovoBoundAttributeValue('onmouseover', 'x')).toBeNull();
    expect(kovoBoundAttributeValue('ONCLICK', 'alert(1)')).toBeNull();
    expect(kovoBoundAttributeValue('srcdoc', '<script>bad()</script>')).toBeNull();
    // Safe attributes still work normally.
    expect(kovoBoundAttributeValue('data-value', 'hello')).toBe('hello');
    expect(kovoBoundAttributeValue('aria-label', 'Close')).toBe('Close');
  });

  it('returns an explicit no-write sentinel for reviewed element-context controls', () => {
    expect(
      kovoBoundAttributeValue('src', '/uploads/attacker.js', { elementName: 'SCRIPT' }),
    ).toBeUndefined();
    expect(
      kovoBoundAttributeValue('rel', 'stylesheet', { elementName: 'LINK' }),
    ).toBeUndefined();
    expect(
      kovoBoundAttributeValue('sandbox', null, { elementName: 'IFRAME' }),
    ).toBeUndefined();
    expect(
      kovoBoundAttributeValue('src', '/uploads/attacker.html', { elementName: 'IFRAME' }),
    ).toBeUndefined();
    expect(
      kovoBoundAttributeValue(
        'src',
        trustedUrl('data:text/javascript,export default 1', 'reviewed executable asset'),
        { elementName: 'SCRIPT' },
      ),
    ).toBe('data:text/javascript,export default 1');
  });

  // @kovo-security-certifies C13 modular-dynamic-control-plane-runtime-floor
  it('removes compiler-generated control-plane names from modular dynamic bindings', () => {
    const reservedNames = [
      ...GENERATED_ONLY_SEMANTIC_ATTRIBUTES,
      ...GENERATED_ONLY_SEMANTIC_ATTRIBUTE_PREFIXES.map((prefix) => `${prefix}probe`),
    ];

    for (const name of reservedNames) {
      expect(kovoBoundAttributeValue(name, '/c/attacker.client.js#run'), name).toBeNull();
      expect(
        kovoBoundAttributeValue(name.toUpperCase(), '/c/attacker.client.js#run'),
        `${name} ASCII case`,
      ).toBeNull();
    }

    expect(kovoBoundAttributeValue('aria-label', 'Ready')).toBe('Ready');
    expect(kovoBoundAttributeValue('data-state', 'ready')).toBe('ready');
    expect(kovoBoundAttributeValue('title', 'Ready')).toBe('Ready');
  });

  it('drains one redacted KV236 event per blocked browser output sink write', () => {
    const events: RuntimeSinkSecurityEvent[] = [];
    const restore = setRuntimeSinkSecurityEventHandler((event) => events.push(event));
    const attackerPayload = 'javascript:alert("secret-token")';

    try {
      expect(kovoBoundAttributeValue('href', attackerPayload)).toBe('#');
      expect(kovoBoundAttributeValue('srcset', `${attackerPayload} 1x`)).toBeNull();
      expect(kovoBoundAttributeValue('style', `background:url(${attackerPayload})`)).toBeNull();
      expect(
        kovoBoundAttributeValue('innerHTML', `<img src=x onerror="${attackerPayload}">`),
      ).toBeNull();
      expect(kovoBoundAttributeValue('onclick', attackerPayload)).toBeNull();
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

  // F4: ftp must be in the runtime URL-scheme allowlist (SPEC §4.8:347)
  it('allows ftp: scheme URLs as safe bound attribute values', () => {
    expect(kovoBoundAttributeValue('href', 'ftp://example.com/x')).toBe('ftp://example.com/x');
    expect(kovoBoundAttributeValue('src', 'ftp://files.example.com/doc')).toBe(
      'ftp://files.example.com/doc',
    );
    // Unsafe schemes still blocked.
    expect(kovoBoundAttributeValue('href', 'javascript:alert(1)')).toBe('#');
  });
});
