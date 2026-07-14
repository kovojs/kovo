import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  clientModuleContentVersion,
  clientModuleHrefForSourceFile,
  parseVersionedClientModuleTarget,
  versionedClientModuleRequestKey,
} from '@kovojs/core/internal/client-module-url';

import {
  computeRenderPlanFingerprint,
  createMemoryVersionedClientModuleRegistry,
  RENDER_PLAN_GRAMMAR_VERSION,
  renderVersionedClientModuleResponse,
  versionedClientModuleHref,
} from './client-modules.js';
import { ensureKovoLoaderRuntimeClientModule } from './loader-runtime-client-module.js';

const clientModuleUrlIntrinsicsUrl = new URL(
  '../../core/src/internal/client-module-url-intrinsics.ts',
  import.meta.url,
).href;
const clientModuleRegistryIntrinsicsUrl = new URL(
  './client-module-registry-intrinsics.ts',
  import.meta.url,
).href;

// ─── D1 + DEPLOY-3: render-plan fingerprint & never-empty token ───────────────

describe('render-plan fingerprint and grammar version (D1, DEPLOY-3)', () => {
  it('RENDER_PLAN_GRAMMAR_VERSION is a non-empty stable string', () => {
    expect(typeof RENDER_PLAN_GRAMMAR_VERSION).toBe('string');
    expect(RENDER_PLAN_GRAMMAR_VERSION.length).toBeGreaterThan(0);
  });

  it('computeRenderPlanFingerprint returns different values for different shape inputs (D1)', () => {
    const fpA = computeRenderPlanFingerprint({ cart: 'field:id,count', product: 'field:id,name' });
    const fpB = computeRenderPlanFingerprint({ cart: 'field:id,count', product: 'field:id,price' });
    expect(fpA).not.toBe(fpB);
  });

  it('computeRenderPlanFingerprint is deterministic and key-order independent', () => {
    const fp1 = computeRenderPlanFingerprint({ a: 'x', b: 'y' });
    const fp2 = computeRenderPlanFingerprint({ b: 'y', a: 'x' });
    expect(fp1).toBe(fp2);
  });

  it('length-frames query names and shapes instead of trusting delimiters', () => {
    expect(computeRenderPlanFingerprint({ a: 'x', b: 'y' })).not.toBe(
      computeRenderPlanFingerprint({ 'a:x\nb': 'y' }),
    );
    expect(computeRenderPlanFingerprint({ '🧪:\u0000': '\n,名' })).not.toBe(
      computeRenderPlanFingerprint({ '🧪': '\u0000:\n,名' }),
    );
  });

  it('buildToken() is never empty even with zero registered modules (DEPLOY-3)', () => {
    const registry = createMemoryVersionedClientModuleRegistry();
    expect(Object.isFrozen(registry)).toBe(true);
    const token = registry.buildToken();
    expect(token).toBeTruthy();
    expect(token.length).toBeGreaterThan(0);
  });

  it('two registries with identical modules but different renderPlanFingerprint produce different tokens (D1)', () => {
    const fp1 = computeRenderPlanFingerprint({ cart: 'field:id,count' });
    const fp2 = computeRenderPlanFingerprint({ cart: 'field:id,total' });

    const registryA = createMemoryVersionedClientModuleRegistry({ renderPlanFingerprint: fp1 });
    const registryB = createMemoryVersionedClientModuleRegistry({ renderPlanFingerprint: fp2 });

    // Same module registrations in both
    for (const r of [registryA, registryB]) {
      r.put({ path: '/c/cart.client.js', source: 'export {}', version: 'v1' });
    }

    expect(registryA.buildToken()).not.toBe(registryB.buildToken());
  });

  it('setRenderPlanFingerprint changes buildToken() without re-registering modules (D1)', () => {
    const registry = createMemoryVersionedClientModuleRegistry();
    registry.put({ path: '/c/cart.client.js', source: 'export {}', version: 'v1' });

    const tokenBefore = registry.buildToken();
    const fp = computeRenderPlanFingerprint({ cart: 'field:id,count' });
    registry.setRenderPlanFingerprint?.(fp);
    const tokenAfter = registry.buildToken();

    expect(tokenBefore).not.toBe(tokenAfter);
  });

  it('setRenderPlanFingerprint is stable — calling with the same value preserves the token', () => {
    const fp = computeRenderPlanFingerprint({ cart: 'field:id,count' });
    const registry = createMemoryVersionedClientModuleRegistry({ renderPlanFingerprint: fp });
    const token1 = registry.buildToken();
    registry.setRenderPlanFingerprint?.(fp);
    const token2 = registry.buildToken();
    expect(token1).toBe(token2);
  });
});

// ─── D1 / DEPLOY-3: module-less app stamps non-empty kovo-build meta ──────────
// (integration test — requires app-document; lives here for co-location with the registry tests)

describe('versioned client modules', () => {
  it('uses the shared core client-module ABI for hrefs, versions, and request parsing', () => {
    const version = clientModuleContentVersion('export const ok = true;');
    const href = clientModuleHrefForSourceFile('components/cart.tsx', version);

    expect(href).toBe(`/c/__v/${version}/components/cart.client.js`);
    expect(versionedClientModuleHref('/c/components/cart.client.js#Cart$add', version)).toBe(
      `/c/__v/${version}/components/cart.client.js#Cart$add`,
    );
    expect(parseVersionedClientModuleTarget(href)).toEqual({
      path: '/c/components/cart.client.js',
      version,
    });
    expect(versionedClientModuleRequestKey(`/c/components/cart.client.js?v=${version}`)).toBe(
      `/c/components/cart.client.js?v=${version}`,
    );
  });

  it('retains old versioned client module responses after newer deploys register', () => {
    const registry = createMemoryVersionedClientModuleRegistry();
    const oldHref = registry.put({
      path: '/c/cart.client.js',
      source: 'export const version = "old";',
      version: 'old',
    });
    const newHref = registry.put({
      path: '/c/cart.client.js',
      source: 'export const version = "new";',
      version: 'new',
    });

    expect(oldHref).toBe('/c/__v/old/cart.client.js');
    expect(newHref).toBe('/c/__v/new/cart.client.js');
    expect(registry.resolve(oldHref)).toEqual({
      body: 'export const version = "old";',
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Content-Type': 'text/javascript; charset=utf-8',
      },
      status: 200,
    });
    expect(registry.resolve(newHref)).toMatchObject({
      body: 'export const version = "new";',
      status: 200,
    });
    expect(registry.resolve('/c/cart.client.js?v=old')).toMatchObject({
      body: 'export const version = "old";',
      status: 200,
    });
  });

  it('keeps exact immutable module ownership after late Map.get cross-binding', () => {
    const registry = createMemoryVersionedClientModuleRegistry();
    const publicHref = registry.put({
      path: '/c/public.client.js',
      source: 'export const role = "public";',
      version: 'public-v1',
    });
    registry.put({
      path: '/c/admin.client.js',
      source: 'export const token = "ADMIN_SECRET";',
      version: 'admin-v1',
    });
    const originalGet = Map.prototype.get;
    Map.prototype.get = function (key: unknown) {
      if (key === '/c/public.client.js\0public-v1') {
        return originalGet.call(this, '/c/admin.client.js\0admin-v1');
      }
      return originalGet.call(this, key);
    };

    try {
      expect(registry.resolve(publicHref)).toMatchObject({
        body: 'export const role = "public";',
        status: 200,
      });
    } finally {
      Map.prototype.get = originalGet;
    }
  });

  it('recomputes build tokens from exact sorted inputs after late sort, join, and hash poisoning', () => {
    const registry = createMemoryVersionedClientModuleRegistry();
    registry.put({ path: '/c/a.client.js', source: 'export {};', version: 'a-v1' });
    const first = registry.buildToken();
    const hashPrototype = Object.getPrototypeOf(createHash('sha256')) as {
      digest: (...args: unknown[]) => unknown;
      update: (...args: unknown[]) => unknown;
    };
    const originalDigest = hashPrototype.digest;
    const originalUpdate = hashPrototype.update;
    const originalJoin = Array.prototype.join;
    const originalSort = Array.prototype.sort;
    Array.prototype.join = () => 'FORGED_BUILD_INPUT';
    Array.prototype.sort = function () {
      return this;
    };
    hashPrototype.update = function () {
      return this;
    };
    hashPrototype.digest = () => '0'.repeat(64);

    try {
      registry.put({ path: '/c/z.client.js', source: 'export {};', version: 'z-v2' });
      const second = registry.buildToken();
      registry.setRenderPlanFingerprint?.('shape-v2');
      const third = registry.buildToken();
      expect(second).not.toBe(first);
      expect(third).not.toBe(second);
      expect(third).toMatch(/^[0-9a-f]{16}$/);
    } finally {
      hashPrototype.digest = originalDigest;
      hashPrototype.update = originalUpdate;
      Array.prototype.join = originalJoin;
      Array.prototype.sort = originalSort;
    }
  });

  it('pins URL path/version reconstruction after late URL and scalar poisoning', () => {
    const registry = createMemoryVersionedClientModuleRegistry();
    const publicHref = registry.put({
      path: '/c/public.client.js',
      source: 'export const role = "public";',
      version: 'public/v1',
    });
    registry.put({
      path: '/c/admin.client.js',
      source: 'export const role = "admin";',
      version: 'admin-v1',
    });
    const pathnameDescriptor = Object.getOwnPropertyDescriptor(URL.prototype, 'pathname')!;
    const originalSearchGet = URLSearchParams.prototype.get;
    const originalDecode = globalThis.decodeURIComponent;
    const originalEncode = globalThis.encodeURIComponent;
    const originalIndexOf = String.prototype.indexOf;
    const originalSlice = String.prototype.slice;
    const originalStartsWith = String.prototype.startsWith;
    Object.defineProperty(URL.prototype, 'pathname', {
      configurable: true,
      get: () => '/c/__v/admin-v1/admin.client.js',
    });
    URLSearchParams.prototype.get = () => 'admin-v1';
    globalThis.decodeURIComponent = () => 'admin-v1';
    globalThis.encodeURIComponent = () => 'admin-v1';
    String.prototype.indexOf = () => -1;
    String.prototype.slice = () => '/c/admin.client.js';
    String.prototype.startsWith = () => true;

    try {
      expect(renderVersionedClientModuleResponse(registry, publicHref)).toMatchObject({
        body: 'export const role = "public";',
        status: 200,
      });
    } finally {
      String.prototype.startsWith = originalStartsWith;
      String.prototype.slice = originalSlice;
      String.prototype.indexOf = originalIndexOf;
      globalThis.encodeURIComponent = originalEncode;
      globalThis.decodeURIComponent = originalDecode;
      URLSearchParams.prototype.get = originalSearchGet;
      Object.defineProperty(URL.prototype, 'pathname', pathnameDescriptor);
    }
  });

  it('snapshots registration inputs instead of re-reading later caller mutation', () => {
    const registry = createMemoryVersionedClientModuleRegistry();
    const input = {
      contentType: 'application/javascript',
      path: '/c/public.client.js',
      source: 'export const role = "public";',
      version: 'public-v1',
    };
    const href = registry.put(input);
    input.contentType = 'text/html';
    input.path = '/c/admin.client.js';
    input.source = '<script>attack()</script>';
    input.version = 'admin-v1';

    expect(registry.resolve(href)).toMatchObject({
      body: 'export const role = "public";',
      headers: { 'Content-Type': 'application/javascript' },
      status: 200,
    });
  });

  it('keeps loader runtime registry identity after late WeakMap cross-binding', () => {
    const puts: string[] = [];
    const victimRegistry = {
      buildToken: () => 'victim',
      entries: () => [],
      put: () => {
        puts[puts.length] = 'victim';
        return '/c/__v/victim/runtime.client.js';
      },
      resolve: () => ({ body: 'Not Found', headers: {}, status: 404 as const }),
    };
    const attackerRegistry = {
      ...victimRegistry,
      put: () => '/c/__v/attacker/admin.client.js',
    };
    ensureKovoLoaderRuntimeClientModule(attackerRegistry);
    const originalGet = WeakMap.prototype.get;
    const originalSet = WeakMap.prototype.set;
    WeakMap.prototype.get = () => '/c/__v/attacker/admin.client.js';
    WeakMap.prototype.set = function () {
      return this;
    };

    let href: string;
    try {
      href = ensureKovoLoaderRuntimeClientModule(victimRegistry);
    } finally {
      WeakMap.prototype.get = originalGet;
      WeakMap.prototype.set = originalSet;
    }
    expect(href!).toBe('/c/__v/victim/runtime.client.js');
    expect(puts).toEqual(['victim']);
  });

  it('fails closed when URL normalization controls were poisoned before their import', async () => {
    const pathnameDescriptor = Object.getOwnPropertyDescriptor(URL.prototype, 'pathname')!;
    Object.defineProperty(URL.prototype, 'pathname', {
      configurable: true,
      get: () => '/c/forged.client.js',
    });
    try {
      const controls = await import(`${clientModuleUrlIntrinsicsUrl}?preimport-url-poison`);
      expect(() =>
        controls.snapshotClientModuleUrl('/c/safe.client.js', 'https://kovo.local'),
      ).toThrow(/client-module security bootstrap failed/);
    } finally {
      Object.defineProperty(URL.prototype, 'pathname', pathnameDescriptor);
    }
  });

  it('fails closed when build-token hash controls were poisoned before their import', async () => {
    const prototype = Object.getPrototypeOf(createHash('sha256')) as {
      update: (...args: unknown[]) => unknown;
    };
    const originalUpdate = prototype.update;
    prototype.update = function () {
      return this;
    };
    try {
      await expect(
        import(`${clientModuleRegistryIntrinsicsUrl}?preimport-hash-poison`),
      ).rejects.toThrow(/hash controls failed their semantic check/);
    } finally {
      prototype.update = originalUpdate;
    }
  });

  it('AUD-007: rejects count-based retention that can evict below the 24-hour floor', () => {
    expect(() => createMemoryVersionedClientModuleRegistry({ maxVersionsPerPath: 1 })).toThrow(
      /KV417: .*SPEC §14.*24 hours/,
    );
  });

  it('enumerates normalized client modules deterministically without exposing registry state', () => {
    const registry = createMemoryVersionedClientModuleRegistry();
    registry.put({
      path: 'https://kovo.local/c/z.client.js',
      source: 'export const z = true;',
      version: 'z-v1',
    });
    registry.put({
      contentType: 'application/javascript',
      path: '/c/a.client.js',
      source: 'export const a = true;',
      version: 'a-v1',
    });

    const entries = registry.entries();
    expect(entries).toEqual([
      {
        contentType: 'application/javascript',
        path: '/c/a.client.js',
        source: 'export const a = true;',
        version: 'a-v1',
      },
      {
        path: '/c/z.client.js',
        source: 'export const z = true;',
        version: 'z-v1',
      },
    ]);

    (entries[0] as { source: string }).source = 'mutated';
    expect(registry.resolve('/c/a.client.js?v=a-v1')).toMatchObject({
      body: 'export const a = true;',
    });
  });

  it('serves versioned client module requests through the immutable registry', () => {
    const registry = createMemoryVersionedClientModuleRegistry();
    const href = registry.put({
      contentType: 'text/javascript; charset=utf-8',
      path: '/c/cart.client.js',
      source: 'export const version = "build-1";',
      version: 'build-1',
    });

    expect(renderVersionedClientModuleResponse(registry, { url: href })).toEqual({
      body: 'export const version = "build-1";',
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Content-Type': 'text/javascript; charset=utf-8',
      },
      status: 200,
    });
    expect(renderVersionedClientModuleResponse(registry, { url: '/c/cart.client.js' })).toEqual({
      body: 'Not Found',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      status: 404,
    });
    const onError = vi.fn();
    expect(
      renderVersionedClientModuleResponse(registry, {
        onError,
        url: '/assets/cart.client.js',
      }),
    ).toEqual({
      body: 'Not Found',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      status: 404,
    });
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0]?.[1]).toEqual({
      operation: 'client-module',
      url: '/assets/cart.client.js',
    });
  });
});
