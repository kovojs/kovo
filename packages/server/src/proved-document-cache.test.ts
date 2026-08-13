import type { CacheInfluenceManifest } from '@kovojs/core/internal/cache-influence';
import { afterEach, describe, expect, it } from 'vitest';

import { publicAccess } from './access.js';
import { createApp, createRequestHandler } from './app.js';
import { installGeneratedCacheInfluenceManifestForCommand } from './generated-cache-influence-registry.js';
import { route } from './route.js';

/**
 * SPEC §9.5 "Proved-document caching" (plans/good-perf.md O14/D9): the compiler-emitted
 * `document:` cache-influence entry is the ONLY evidence that can open the proved-document tier,
 * and every runtime credential signal rejects — including against a FORGED public-proved manifest.
 * The binding safety property: no proof gap can ever make a private document publicly cacheable.
 */

const PROVED_CACHE_CONTROL = 'public, max-age=0, must-revalidate';

let releaseManifest: (() => void) | undefined;

afterEach(() => {
  releaseManifest?.();
  releaseManifest = undefined;
});

function publicProvedEntry(root: string) {
  return {
    authored: { posture: 'public' as const },
    axes: [
      { kind: 'url-path' as const, role: 'cache-key' as const },
      { kind: 'url-search' as const, role: 'cache-key' as const },
    ],
    closedReasons: [],
    root,
    surface: 'document' as const,
    vary: [],
    verdict: 'public-proved' as const,
  };
}

function cookieClosedEntry(root: string) {
  return {
    authored: { posture: 'public' as const },
    axes: [
      { kind: 'url-path' as const, role: 'cache-key' as const },
      { kind: 'url-search' as const, role: 'cache-key' as const },
      { kind: 'cookie' as const, role: 'shared-cache-closed' as const },
    ],
    closedReasons: ['cookie-influence' as const],
    root,
    surface: 'document' as const,
    vary: [],
    verdict: 'shared-cache-closed' as const,
  };
}

function installManifest(entries: CacheInfluenceManifest['entries']): void {
  releaseManifest = installGeneratedCacheInfluenceManifestForCommand({
    entries,
    schema: 'kovo-cache-influence/v1',
  });
}

describe('proved-document validator tier and cache (SPEC §9.5, D9)', () => {
  it('stamps validators, serves repeats from cache, and answers If-None-Match with a 0-byte 304', async () => {
    installManifest([publicProvedEntry('document:/')]);
    let renders = 0;
    const handler = createRequestHandler(
      createApp({
        routes: [
          route('/', {
            access: publicAccess('proved-document positive fixture'),
            page: () => {
              renders += 1;
              return 'proved document body';
            },
          }),
        ],
      }),
    );

    const first = await handler(new Request('https://cache.example.test/'));
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe(PROVED_CACHE_CONTROL);
    const etag = first.headers.get('etag');
    expect(etag).toMatch(/^"[A-Za-z0-9_-]+"$/u);
    expect(first.headers.get('last-modified')).toBeTruthy();
    const firstBody = await first.text();
    expect(firstBody).toContain('proved document body');
    expect(renders).toBe(1);

    const second = await handler(new Request('https://cache.example.test/'));
    expect(second.status).toBe(200);
    expect(second.headers.get('etag')).toBe(etag);
    expect(await second.text()).toBe(firstBody);
    expect(renders).toBe(1); // served from the proved-document cache, not re-rendered

    const conditional = await handler(
      new Request('https://cache.example.test/', {
        headers: { 'if-none-match': etag! },
      }),
    );
    expect(conditional.status).toBe(304);
    expect(conditional.headers.get('etag')).toBe(etag);
    expect(await conditional.text()).toBe('');
    expect(renders).toBe(1);

    // Weak-comparison: a W/-prefixed candidate still validates (RFC 9110 §13.1.2).
    const weak = await handler(
      new Request('https://cache.example.test/', {
        headers: { 'if-none-match': `W/${etag}` },
      }),
    );
    expect(weak.status).toBe(304);
  });

  it('keys the cache on URL search and never leaks across paths', async () => {
    installManifest([publicProvedEntry('document:/'), publicProvedEntry('document:/other')]);
    let renders = 0;
    const handler = createRequestHandler(
      createApp({
        routes: [
          route('/', {
            access: publicAccess('proved-document keying fixture'),
            page: () => {
              renders += 1;
              return 'home';
            },
          }),
          route('/other', {
            access: publicAccess('proved-document keying fixture'),
            page: () => {
              renders += 1;
              return 'other';
            },
          }),
        ],
      }),
    );

    await handler(new Request('https://cache.example.test/'));
    await handler(new Request('https://cache.example.test/?q=1'));
    await handler(new Request('https://cache.example.test/?q=2'));
    expect(renders).toBe(3); // each search string is a distinct cache-key axis value

    const other = await handler(new Request('https://cache.example.test/other'));
    expect(await other.text()).toContain('other');
    expect(renders).toBe(4);

    await handler(new Request('https://cache.example.test/?q=1'));
    expect(renders).toBe(4); // exact repeat is a hit
  });

  it('bypasses the cache for credential-bearing requests in both directions', async () => {
    installManifest([publicProvedEntry('document:/')]);
    let renders = 0;
    const handler = createRequestHandler(
      createApp({
        routes: [
          route('/', {
            access: publicAccess('proved-document credential floor fixture'),
            page: () => {
              renders += 1;
              return 'body';
            },
          }),
        ],
      }),
    );

    // Prime the cache anonymously.
    await handler(new Request('https://cache.example.test/'));
    expect(renders).toBe(1);

    // A cookie-bearing request is never served from the cache and stays at the credential floor.
    const withCookie = await handler(
      new Request('https://cache.example.test/', { headers: { cookie: 'sid=1' } }),
    );
    expect(renders).toBe(2);
    expect(withCookie.headers.get('cache-control')).toContain('no-store');
    expect(withCookie.headers.get('etag')).toBeNull();

    // An Authorization-bearing request likewise.
    const withAuthorization = await handler(
      new Request('https://cache.example.test/', {
        headers: { authorization: 'Bearer token' },
      }),
    );
    expect(renders).toBe(3);
    expect(withAuthorization.headers.get('cache-control')).toContain('no-store');

    // And neither credentialed render was admitted: the anonymous entry still serves.
    const anonymous = await handler(new Request('https://cache.example.test/'));
    expect(renders).toBe(3);
    expect(anonymous.headers.get('cache-control')).toBe(PROVED_CACHE_CONTROL);
  });

  it('never opens the tier for a guarded route even when the manifest is forged public-proved', async () => {
    installManifest([
      publicProvedEntry('document:/access-guarded'),
      publicProvedEntry('document:/legacy-guarded'),
    ]);
    let renders = 0;
    const allow = () => true as const;
    const handler = createRequestHandler(
      createApp({
        routes: [
          route('/access-guarded', {
            access: [allow],
            page: () => {
              renders += 1;
              return 'guarded';
            },
          }),
          route('/legacy-guarded', {
            guard: allow,
            page: () => {
              renders += 1;
              return 'guarded';
            },
          }),
        ],
      }),
    );

    for (const path of ['/access-guarded', '/legacy-guarded']) {
      const first = await handler(new Request(`https://cache.example.test${path}`));
      const second = await handler(new Request(`https://cache.example.test${path}`));
      expect(first.headers.get('cache-control')).toContain('no-store');
      expect(first.headers.get('etag')).toBeNull();
      expect(second.headers.get('cache-control')).toContain('no-store');
    }
    expect(renders).toBe(4); // every request rendered; nothing was cached
  });

  it('never opens the tier when a session principal resolves, even with a forged manifest', async () => {
    installManifest([publicProvedEntry('document:/')]);
    let renders = 0;
    const handler = createRequestHandler(
      createApp({
        routes: [
          route('/', {
            access: publicAccess('session floor fixture'),
            page: () => {
              renders += 1;
              return 'per-principal';
            },
          }),
        ],
        sessionProvider: () => ({ user: { id: 'u1' } }),
      }),
    );

    const first = await handler(new Request('https://cache.example.test/'));
    const second = await handler(new Request('https://cache.example.test/'));
    expect(first.headers.get('cache-control')).toContain('no-store');
    expect(first.headers.get('etag')).toBeNull();
    expect(second.headers.get('cache-control')).toContain('no-store');
    expect(renders).toBe(2);
  });

  it('keeps the floor when the compiler verdict is closed (cookie influence)', async () => {
    installManifest([cookieClosedEntry('document:/')]);
    let renders = 0;
    const handler = createRequestHandler(
      createApp({
        routes: [
          route('/', {
            access: publicAccess('closed verdict fixture'),
            page: () => {
              renders += 1;
              return 'cookie-dependent';
            },
          }),
        ],
      }),
    );

    const first = await handler(new Request('https://cache.example.test/'));
    const second = await handler(new Request('https://cache.example.test/'));
    expect(first.headers.get('cache-control')).toBe('private, no-store');
    expect(first.headers.get('vary')).toContain('Cookie');
    expect(first.headers.get('etag')).toBeNull();
    expect(renders).toBe(2);
    expect(second.status).toBe(200);
  });

  it('keeps the floor when no document manifest entry exists at all', async () => {
    // No manifest installed: the registry has no `document:/` root.
    let renders = 0;
    const handler = createRequestHandler(
      createApp({
        routes: [
          route('/', {
            access: publicAccess('missing manifest fixture'),
            page: () => {
              renders += 1;
              return 'unproven';
            },
          }),
        ],
      }),
    );

    const first = await handler(new Request('https://cache.example.test/'));
    const second = await handler(new Request('https://cache.example.test/'));
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('private, no-store');
    expect(first.headers.get('vary')).toContain('Cookie');
    expect(first.headers.get('etag')).toBeNull();
    expect(renders).toBe(2);
    expect(second.status).toBe(200);
  });

  it('caches the negotiated document-parts representation separately from text/html', async () => {
    installManifest([publicProvedEntry('document:/')]);
    let renders = 0;
    const handler = createRequestHandler(
      createApp({
        routes: [
          route('/', {
            access: publicAccess('variant keying fixture'),
            page: () => {
              renders += 1;
              return 'variant body';
            },
          }),
        ],
      }),
    );

    const html = await handler(new Request('https://cache.example.test/'));
    expect(html.headers.get('content-type')).toContain('text/html');
    expect(renders).toBe(1);

    const parts = await handler(
      new Request('https://cache.example.test/', {
        headers: { accept: 'application/vnd.kovo.document-parts+json' },
      }),
    );
    expect(renders).toBe(2);
    const partsAgain = await handler(
      new Request('https://cache.example.test/', {
        headers: { accept: 'application/vnd.kovo.document-parts+json' },
      }),
    );
    expect(renders).toBe(2);
    if (parts.headers.get('content-type')?.includes('document-parts')) {
      expect(partsAgain.headers.get('content-type')).toContain('document-parts');
      expect(await partsAgain.text()).toBe(await parts.text());
    }

    const htmlAgain = await handler(new Request('https://cache.example.test/'));
    expect(htmlAgain.headers.get('content-type')).toContain('text/html');
    expect(renders).toBe(2);
  });

  it('serves HEAD from the same proved entry without a body', async () => {
    installManifest([publicProvedEntry('document:/')]);
    let renders = 0;
    const handler = createRequestHandler(
      createApp({
        routes: [
          route('/', {
            access: publicAccess('head fixture'),
            page: () => {
              renders += 1;
              return 'head body';
            },
          }),
        ],
      }),
    );

    await handler(new Request('https://cache.example.test/'));
    const head = await handler(new Request('https://cache.example.test/', { method: 'HEAD' }));
    expect(head.status).toBe(200);
    expect(head.headers.get('cache-control')).toBe(PROVED_CACHE_CONTROL);
    expect(await head.text()).toBe('');
    expect(renders).toBe(1);
  });
});
