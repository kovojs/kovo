import { afterEach, describe, expect, it } from 'vitest';

import {
  __resetKovoTrustedTypePolicyForTest,
  kovoCreateHTML,
  kovoCreateScriptURL,
} from './trusted-types.js';
import { kovoTrustedHtmlContent, safeRichHtml } from './security-output.js';

// SF (secure-framework Tier 3): the framework Trusted Types policy seam. These tests pin
// the two load-bearing properties the CSP floor depends on: (1) where Trusted Types is
// ABSENT (every non-Chromium browser / no CSP), the helpers are a TRANSPARENT passthrough
// so routing a sink through them is behavior-preserving and can never brick hydration;
// (2) where Trusted Types IS present, the helpers mint values through the single `kovo`
// policy created exactly ONCE (a second `createPolicy('kovo', …)` throws under the strict
// `trusted-types kovo` no-duplicates directive).

const globalWithTrustedTypes = globalThis as {
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
    __resetKovoTrustedTypePolicyForTest();
  });

  it('passes HTML/script URLs through verbatim when Trusted Types is unavailable', () => {
    delete globalWithTrustedTypes.trustedTypes;
    __resetKovoTrustedTypePolicyForTest();

    expect(kovoCreateHTML('<p>hi</p>')).toBe('<p>hi</p>');
    expect(kovoCreateScriptURL('/c/__v/1/m.js')).toBe('/c/__v/1/m.js');
  });

  it('routes through a single kovo policy created exactly once when available', () => {
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
    // The policy is created once (cached); both writes mint through it.
    expect(created).toEqual(['kovo']);
    expect(policyCalls).toBe(2);
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

  it('routes safeRichHtml output through the kovo policy after sanitizing', () => {
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

    expect(htmlInputs).toEqual(['<p>ok</p>']);
    expect(kovoTrustedHtmlContent(rich)).toBe('<p>ok</p>');
  });
});
