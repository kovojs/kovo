// @kovo-security-classifier-corpus finite-security-operation-ir
import { describe, expect, it } from 'vitest';

import { validateCacheGenerality } from './check-cache-generality.mjs';

const manifest = {
  entries: [
    {
      authored: { cacheControl: 'public, max-age=60', posture: 'public' },
      axes: [
        { kind: 'url-path', role: 'cache-key' },
        { kind: 'url-search', role: 'cache-key' },
        { kind: 'request-header', name: 'accept-language', role: 'vary' },
      ],
      closedReasons: [],
      root: 'query:catalog',
      surface: 'query',
      vary: ['accept-language'],
      verdict: 'public-proved',
    },
  ],
  schema: 'kovo-cache-influence/v1',
};

describe('check:cache-generality', () => {
  it('diffs authored cache intent against the compiler manifest', () => {
    // @kovo-security-certifies C13 cache-generality-manifest-drift
    expect(
      validateCacheGenerality({
        authoredIntents: [
          {
            cacheControl: 'public, max-age=60',
            posture: 'public',
            root: 'query:catalog',
            surface: 'query',
          },
        ],
        manifest,
      }),
    ).toMatchObject({ ok: true });

    const missing = structuredClone(manifest);
    missing.entries = [];
    expect(
      validateCacheGenerality({
        authoredIntents: [
          {
            cacheControl: 'public, max-age=60',
            posture: 'public',
            root: 'query:catalog',
            surface: 'query',
          },
        ],
        manifest: missing,
      }).findings,
    ).toContain('query:catalog: public cache intent has no compiler-derived manifest entry');

    const drifted = structuredClone(manifest);
    drifted.entries[0].authored.cacheControl = 'public, max-age=600';
    expect(
      validateCacheGenerality({
        authoredIntents: [
          {
            cacheControl: 'public, max-age=60',
            posture: 'public',
            root: 'query:catalog',
            surface: 'query',
          },
        ],
        manifest: drifted,
      }).findings.join('\n'),
    ).toContain('authored cache intent differs from compiler manifest');
  });

  it('rejects Vary tokens not derived from named request-header axes', () => {
    const poisoned = structuredClone(manifest);
    poisoned.entries[0].vary = ['accept-language', 'cookie', 'url-search'];
    expect(validateCacheGenerality({ authoredIntents: [], manifest: poisoned }).findings).toEqual(
      expect.arrayContaining([
        'query:catalog: Vary token cookie is not a compiler-derived request-header axis',
        'query:catalog: Vary token url-search is not a compiler-derived request-header axis',
      ]),
    );
  });
});
