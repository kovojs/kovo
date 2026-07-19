// @kovo-security-classifier-corpus finite-security-operation-ir
import { describe, expect, it } from 'vitest';

import {
  cacheInfluenceManifestSchema,
  deriveCacheInfluenceManifestEntry,
} from './cache-influence.js';

describe('kovo-cache-influence/v1', () => {
  it('keeps cache-key, Vary, and shared-cache-closing axes structurally distinct', () => {
    // @kovo-security-certifies C13 cache-influence-static-closure
    const entry = deriveCacheInfluenceManifestEntry({
      authored: { cacheControl: 'public, max-age=60', posture: 'public' },
      influences: {
        authorization: true,
        cookie: true,
        frameworkState: true,
        principal: true,
        requestHeaders: ['Accept-Language', 'X-Branch', 'accept-language'],
        secret: true,
        session: true,
        unclassified: ['dynamic request-header name'],
        urlPath: true,
        urlSearch: true,
      },
      root: 'query:catalog',
      surface: 'query',
    });

    expect(cacheInfluenceManifestSchema).toBe('kovo-cache-influence/v1');
    expect(entry.vary).toEqual(['accept-language', 'x-branch']);
    expect(entry.axes).toEqual(
      expect.arrayContaining([
        { kind: 'url-path', role: 'cache-key' },
        { kind: 'url-search', role: 'cache-key' },
        { kind: 'request-header', name: 'accept-language', role: 'vary' },
        { kind: 'authorization', role: 'shared-cache-closed' },
        { kind: 'cookie', role: 'shared-cache-closed' },
        { kind: 'principal', role: 'shared-cache-closed' },
        { kind: 'session', role: 'shared-cache-closed' },
        { kind: 'framework-state', role: 'shared-cache-closed' },
        { kind: 'secret', role: 'shared-cache-closed' },
      ]),
    );
    expect(entry.vary).not.toContain('cookie');
    expect(entry.vary).not.toContain('authorization');
    expect(entry.vary).not.toContain('url-search');
    expect(entry.verdict).toBe('shared-cache-closed');
  });

  it('requires every external data version to contribute to the visible cache key', () => {
    const keyed = deriveCacheInfluenceManifestEntry({
      authored: { cacheControl: 'public, s-maxage=300', posture: 'public' },
      influences: {
        externalDataVersions: [
          { key: { axis: 'url-search', name: 'catalogVersion' }, name: 'catalog' },
        ],
        frameworkState: true,
        urlPath: true,
        urlSearch: true,
      },
      root: 'query:versioned-catalog',
      surface: 'query',
    });
    const unkeyed = deriveCacheInfluenceManifestEntry({
      authored: { cacheControl: 'public, s-maxage=300', posture: 'public' },
      influences: {
        externalDataVersions: [{ name: 'catalog' }],
        frameworkState: true,
        urlPath: true,
        urlSearch: true,
      },
      root: 'query:unkeyed-catalog',
      surface: 'query',
    });

    expect(keyed.verdict).toBe('public-proved');
    expect(keyed.axes).toContainEqual({
      key: { axis: 'url-search', name: 'catalogVersion' },
      kind: 'external-data-version',
      name: 'catalog',
      role: 'cache-key',
    });
    expect(unkeyed.verdict).toBe('shared-cache-closed');
    expect(unkeyed.closedReasons).toContain('external-data-version-without-key-contribution');
  });

  it('records an audited escape as retained obligation instead of derived evidence', () => {
    const entry = deriveCacheInfluenceManifestEntry({
      authored: {
        auditedEscape: {
          name: 'legacy-catalog-snapshot',
          retainedObligation: 'Operator must purge the CDN before publishing a new snapshot.',
        },
        cacheControl: 'public, s-maxage=60',
        posture: 'public',
      },
      influences: { unclassified: ['opaque helper transfer'], urlPath: true },
      root: 'endpoint:/legacy-catalog',
      surface: 'endpoint',
    });

    expect(entry.verdict).toBe('audited-escape');
    expect(entry.auditedEscape).toEqual({
      name: 'legacy-catalog-snapshot',
      retainedObligation: 'Operator must purge the CDN before publishing a new snapshot.',
    });
    expect(entry.closedReasons).toContain('unclassified-influence');
  });
});
