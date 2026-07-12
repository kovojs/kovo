import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  __resetKovoTrustedTypePolicyForTest,
  kovoCreateHTML,
  kovoCreateScriptURL,
} from './trusted-types.js';
import { kovoTrustedHtmlContent, safeRichHtml } from './security-output.js';

// SF (secure-framework Tier 3): the framework Trusted Types policy seam. These tests pin
// the load-bearing properties the CSP floor depends on: absent host controls are a transparent
// passthrough, structural lookalikes never become output authority, and genuine browser controls
// are covered by the three-engine suite.

const globalWithTrustedTypes = globalThis as {
  __kovo_tt?: { createHTML(input: string): unknown } | null;
  trustedTypes?: unknown;
};

describe('kovo Trusted Types policy seam', () => {
  const originalTrustedTypes = Object.getOwnPropertyDescriptor(globalThis, 'trustedTypes');

  afterEach(() => {
    if (originalTrustedTypes === undefined) {
      delete globalWithTrustedTypes.trustedTypes;
    } else {
      Object.defineProperty(globalThis, 'trustedTypes', originalTrustedTypes);
    }
    delete globalWithTrustedTypes.__kovo_tt;
    __resetKovoTrustedTypePolicyForTest();
  });

  it('ignores a caller-owned policy cache present before module initialization', async () => {
    globalWithTrustedTypes.__kovo_tt = {
      createHTML() {
        return '<img data-kovo-preimport-policy-attack src="x">';
      },
    };
    vi.resetModules();

    const fresh = await import('./trusted-types.js');

    expect(fresh.kovoCreateHTML('<strong>framework-safe</strong>')).toBe(
      '<strong>framework-safe</strong>',
    );
  });

  it('passes HTML/script URLs through verbatim when Trusted Types is unavailable', () => {
    delete globalWithTrustedTypes.trustedTypes;
    __resetKovoTrustedTypePolicyForTest();

    expect(kovoCreateHTML('<p>hi</p>')).toBe('<p>hi</p>');
    expect(kovoCreateScriptURL('/c/__v/1/m.js')).toBe('/c/__v/1/m.js');
  });

  it('rejects a structural Trusted Types factory without platform value brands', () => {
    const created: string[] = [];
    let policyCalls = 0;
    globalWithTrustedTypes.trustedTypes = {
      createPolicy(name: string, rules: { createHTML?: (s: string) => string }) {
        created.push(name);
        return {
          createHTML(input: string) {
            policyCalls += 1;
            return { __brand: 'TrustedHTML', toString: () => rules.createHTML?.(input) ?? input };
          },
          createScriptURL(input: string) {
            return { toString: () => input };
          },
        };
      },
    };
    __resetKovoTrustedTypePolicyForTest();

    const out1 = kovoCreateHTML('<a>one</a>');
    const out2 = kovoCreateHTML('<a>two</a>');
    // A caller-owned structural factory cannot manufacture the browser's TrustedHTML internal
    // slot, so boot validation keeps the exact raw bytes and never invokes it.
    expect(created).toEqual([]);
    expect(policyCalls).toBe(0);
    expect(String(out1)).toBe('<a>one</a>');
    expect(String(out2)).toBe('<a>two</a>');
  });

  it('falls back to the raw string if policy creation throws (duplicate-policy CSP)', () => {
    globalWithTrustedTypes.trustedTypes = {
      createPolicy() {
        throw new Error('Policy "kovo" already exists.');
      },
    };
    __resetKovoTrustedTypePolicyForTest();

    // A create failure must never break hydration — fall back to the raw string.
    expect(kovoCreateHTML('<p>safe</p>')).toBe('<p>safe</p>');
  });

  it('keeps sanitized rich HTML exact under a structural policy lookalike', () => {
    const htmlInputs: string[] = [];
    globalWithTrustedTypes.trustedTypes = {
      createPolicy(_name: string, rules: { createHTML?: (s: string) => string }) {
        return {
          createHTML(input: string) {
            htmlInputs.push(input);
            return {
              [Symbol.toStringTag]: 'TrustedHTML',
              toString: () => rules.createHTML?.(input) ?? input,
            };
          },
          createScriptURL(input: string) {
            return { toString: () => input };
          },
        };
      },
    };
    __resetKovoTrustedTypePolicyForTest();

    const rich = safeRichHtml('<p onclick="bad()">ok<script>bad()</script></p>');

    expect(htmlInputs).toEqual([]);
    expect(kovoTrustedHtmlContent(rich)).toBe('<p>ok</p>');
  });
});
