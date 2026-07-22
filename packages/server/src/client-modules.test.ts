import { createHash } from 'node:crypto';

import {
  clientModuleHrefForSourceFile,
  clientModuleRepresentationDigest,
  parseVersionedClientModuleTarget,
  versionedClientModuleRequestKey,
} from '@kovojs/core/internal/client-module-url';
import { describe, expect, it, vi } from 'vitest';

import { clientModuleBuildTokenHash } from './client-module-registry-intrinsics.js';
import {
  computeRenderPlanFingerprint,
  createMemoryVersionedClientModuleRegistry,
  finalizeVersionedClientModuleBuild,
  RENDER_PLAN_GRAMMAR_VERSION,
  renderVersionedClientModuleResponse,
  replaceVersionedClientModuleBuildSnapshot,
  snapshotVersionedClientModuleRegistry,
  versionedClientModuleHref,
  type VersionedClientModuleInput,
  type VersionedClientModuleRegistry,
  type VersionedClientModuleStore,
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

function createRegistry(store = createMemoryVersionedClientModuleRegistry()): VersionedClientModuleRegistry {
  return snapshotVersionedClientModuleRegistry(store);
}

describe('render-plan and app-build identities', () => {
  it('keeps a full render fingerprint and a full non-empty module-less app token', () => {
    expect(RENDER_PLAN_GRAMMAR_VERSION).toBeTruthy();
    const fingerprint = computeRenderPlanFingerprint({});
    const registry = createRegistry();

    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(registry.buildToken()).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('moves on projected grammar facts without changing module representations', () => {
    const module = { path: '/c/cart.client.js', source: 'export {}' };
    const first = createRegistry();
    const second = createRegistry();
    replaceVersionedClientModuleBuildSnapshot(first, {
      modules: [module],
      renderPlanFingerprint: computeRenderPlanFingerprint({ cart: 'field:id,count' }),
    });
    replaceVersionedClientModuleBuildSnapshot(second, {
      modules: [module],
      renderPlanFingerprint: computeRenderPlanFingerprint({ cart: 'field:id,total' }),
    });
    expect(first.entries()).toEqual(second.entries());
    expect(first.buildToken()).not.toBe(second.buildToken());
  });

  it('byte-length-frames app-token inputs instead of trusting delimiters', () => {
    const fingerprint = computeRenderPlanFingerprint({});
    expect(clientModuleBuildTokenHash(fingerprint, ['a', 'b\nc'])).not.toBe(
      clientModuleBuildTokenHash(fingerprint, ['a\nb', 'c']),
    );
    expect(clientModuleBuildTokenHash(fingerprint, ['名🙂', '\0:x'])).toMatch(
      /^[0-9a-f]{64}$/u,
    );
  });

  it('is invariant to registration order and retained resolver history', () => {
    const one = { path: '/c/a.client.js', source: 'export const a = 1;' };
    const two = { path: '/c/z.client.js', source: 'export const z = 2;' };
    const history = { path: '/c/a.client.js', source: 'export const a = 0;' };
    const fingerprint = computeRenderPlanFingerprint({ cart: 'id' });

    const storeA = createMemoryVersionedClientModuleRegistry();
    const registryA = createRegistry(storeA);
    registryA.put(history);
    replaceVersionedClientModuleBuildSnapshot(registryA, {
      modules: [two, one],
      renderPlanFingerprint: fingerprint,
    });

    const registryB = createRegistry();
    replaceVersionedClientModuleBuildSnapshot(registryB, {
      modules: [one, two],
      renderPlanFingerprint: fingerprint,
    });

    expect(registryA.buildToken()).toBe(registryB.buildToken());
    expect(storeA.resolve(clientHref(history))).toMatchObject({ body: history.source, status: 200 });
    expect(registryA.entries()).toEqual(registryB.entries());
  });

  it('includes simultaneous active representations for one logical path', () => {
    const oldModule = { path: '/c/cart.client.js', source: 'export const generation = 1;' };
    const newModule = { path: '/c/cart.client.js', source: 'export const generation = 2;' };
    const fingerprint = computeRenderPlanFingerprint({});
    const both = createRegistry();
    const currentOnly = createRegistry();

    replaceVersionedClientModuleBuildSnapshot(both, {
      modules: [oldModule, newModule],
      renderPlanFingerprint: fingerprint,
    });
    replaceVersionedClientModuleBuildSnapshot(currentOnly, {
      modules: [newModule],
      renderPlanFingerprint: fingerprint,
    });

    expect(both.entries()).toHaveLength(2);
    expect(new Set(both.entries().map(clientHref))).toEqual(
      new Set([clientHref(oldModule), clientHref(newModule)]),
    );
    expect(both.buildToken()).not.toBe(currentOnly.buildToken());
  });

  it('ignores custom identity methods and seals one frozen production scalar', () => {
    const backing = createMemoryVersionedClientModuleRegistry();
    const attackerToken = vi.fn(() => 'attacker-token');
    const attackerSetter = vi.fn();
    const registry = snapshotVersionedClientModuleRegistry({
      entries: () => backing.entries(),
      put: (module) => backing.put(module),
      resolve: (href) => backing.resolve(href),
      buildToken: attackerToken,
      setRenderPlanFingerprint: attackerSetter,
    } as VersionedClientModuleStore & {
      buildToken(): string;
      setRenderPlanFingerprint(value: string): void;
    });
    registry.put({ path: '/c/a.client.js', source: 'export {}' });
    const token = finalizeVersionedClientModuleBuild(
      registry,
      computeRenderPlanFingerprint({ a: 'shape' }),
    );

    expect(token).toMatch(/^[0-9a-f]{64}$/u);
    expect(registry.buildToken()).toBe(token);
    expect(attackerToken).not.toHaveBeenCalled();
    expect(attackerSetter).not.toHaveBeenCalled();
    expect(() => registry.put({ path: '/c/b.client.js', source: 'export {}' })).toThrow(/KV417/);
    expect(registry.buildToken()).toBe(token);
  });
});

describe('immutable client-module representations', () => {
  it('uses one full-digest URL grammar and rejects former query/author versions', () => {
    const digest = clientModuleRepresentationDigest('export const ok = true;');
    const href = clientModuleHrefForSourceFile('components/cart.tsx', digest);

    expect(href).toBe(`/c/__v/${digest}/components/cart.client.js`);
    expect(versionedClientModuleHref('/c/components/cart.client.js#Cart$add', digest)).toBe(
      `/c/__v/${digest}/components/cart.client.js#Cart$add`,
    );
    expect(parseVersionedClientModuleTarget(href)).toEqual({
      digest,
      path: '/c/components/cart.client.js',
    });
    expect(versionedClientModuleRequestKey(href)).toBe(new URL(href, 'https://kovo.local').pathname);
    expect(versionedClientModuleRequestKey(`/c/components/cart.client.js?v=${digest}`)).toBeUndefined();
    expect(parseVersionedClientModuleTarget('/c/__v/cart-v1/components/cart.client.js')).toBeUndefined();
  });

  it('retains old bytes while the facade active manifest can exclude them', () => {
    const store = createMemoryVersionedClientModuleRegistry();
    const registry = createRegistry(store);
    const oldModule = { path: '/c/cart.client.js', source: 'export const version = "old";' };
    const newModule = { path: '/c/cart.client.js', source: 'export const version = "new";' };
    const oldHref = registry.put(oldModule);
    replaceVersionedClientModuleBuildSnapshot(registry, {
      modules: [newModule],
      renderPlanFingerprint: computeRenderPlanFingerprint({}),
    });

    expect(registry.entries()).toEqual([newModule]);
    expect(registry.resolve(oldHref)).toMatchObject({ body: oldModule.source, status: 200 });
    expect(registry.resolve('/c/cart.client.js?v=old')).toMatchObject({ status: 404 });
  });

  it('snapshots registration input and always serves fixed metadata', () => {
    const registry = createRegistry();
    const input = { path: '/c/public.client.js', source: 'export const role = "public";' };
    const href = registry.put(input);
    input.path = '/c/admin.client.js';
    input.source = '<script>attack()</script>';

    expect(registry.resolve(href)).toEqual({
      body: 'export const role = "public";',
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Content-Type': 'text/javascript; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      },
      status: 200,
    });
  });

  it('rejects a custom store href, body, or content-type mismatch', () => {
    const source = 'export const safe = true;';
    const expectedHref = clientHref({ path: '/c/safe.client.js', source });
    const wrongHrefStore: VersionedClientModuleStore = {
      entries: () => [],
      put: () => '/c/__v/' + '0'.repeat(64) + '/safe.client.js',
      resolve: () => ({ body: source, headers: {}, status: 200 }),
    };
    expect(() => createRegistry(wrongHrefStore).put({ path: '/c/safe.client.js', source })).toThrow(
      /framework-derived href/,
    );

    for (const response of [
      {
        body: 'export const attacker = true;',
        headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
        status: 200 as const,
      },
      {
        body: source,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        status: 200 as const,
      },
    ]) {
      const store: VersionedClientModuleStore = {
        entries: () => [{ path: '/c/safe.client.js', source }],
        put: () => expectedHref,
        resolve: () => response,
      };
      expect(() => createRegistry(store).resolve(expectedHref)).toThrow(/bytes|metadata/);
    }
  });

  it('keeps exact ownership after late Map and hash prototype poisoning', () => {
    const registry = createRegistry();
    const publicHref = registry.put({
      path: '/c/public.client.js',
      source: 'export const role = "public";',
    });
    registry.put({ path: '/c/admin.client.js', source: 'export const secret = true;' });
    const originalGet = Map.prototype.get;
    const hashPrototype = Object.getPrototypeOf(createHash('sha256')) as {
      digest: (...args: unknown[]) => unknown;
      update: (...args: unknown[]) => unknown;
    };
    const originalDigest = hashPrototype.digest;
    const originalUpdate = hashPrototype.update;
    Map.prototype.get = () => undefined;
    hashPrototype.update = function () {
      return this;
    };
    hashPrototype.digest = () => '0'.repeat(64);
    try {
      expect(registry.resolve(publicHref)).toMatchObject({
        body: 'export const role = "public";',
        status: 200,
      });
      expect(registry.buildToken()).toMatch(/^[0-9a-f]{64}$/u);
    } finally {
      Map.prototype.get = originalGet;
      hashPrototype.digest = originalDigest;
      hashPrototype.update = originalUpdate;
    }
  });

  it('serves only canonical requests through the framework facade', () => {
    const registry = createRegistry();
    const href = registry.put({
      path: '/c/cart.client.js',
      source: 'export const version = "build-1";',
    });
    expect(renderVersionedClientModuleResponse(registry, { url: href })).toMatchObject({
      body: 'export const version = "build-1";',
      status: 200,
    });
    expect(renderVersionedClientModuleResponse(registry, { url: '/c/cart.client.js' })).toMatchObject(
      { status: 404 },
    );
    const onError = vi.fn();
    expect(
      renderVersionedClientModuleResponse(registry, {
        onError,
        url: '/assets/cart.client.js',
      }),
    ).toMatchObject({ status: 404 });
    expect(onError).toHaveBeenCalledOnce();
  });

  it('keeps loader runtime registry identity after late WeakMap poisoning', () => {
    const victim = createRegistry();
    const first = ensureKovoLoaderRuntimeClientModule(victim);
    const originalGet = WeakMap.prototype.get;
    const originalSet = WeakMap.prototype.set;
    WeakMap.prototype.get = () => '/c/__v/' + '0'.repeat(64) + '/admin.client.js';
    WeakMap.prototype.set = function () {
      return this;
    };
    let observed: string;
    try {
      observed = ensureKovoLoaderRuntimeClientModule(victim);
    } finally {
      WeakMap.prototype.get = originalGet;
      WeakMap.prototype.set = originalSet;
    }
    expect(observed!).toBe(first);
  });

  it('fails closed when URL or build-token controls were poisoned before import', async () => {
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

    const prototype = Object.getPrototypeOf(createHash('sha256')) as {
      update: (...args: unknown[]) => unknown;
    };
    const originalUpdate = prototype.update;
    prototype.update = function () {
      return this;
    };
    try {
      await expect(import(`${clientModuleRegistryIntrinsicsUrl}?preimport-hash-poison`)).rejects.toThrow(
        /hash controls failed their semantic check/,
      );
    } finally {
      prototype.update = originalUpdate;
    }
  });

  it('refuses count-based retention below the 24-hour floor', () => {
    expect(() => createMemoryVersionedClientModuleRegistry({ maxVersionsPerPath: 1 })).toThrow(
      /KV417: .*SPEC §14.*24 hours/,
    );
  });
});

function clientHref(module: VersionedClientModuleInput): string {
  return versionedClientModuleHref(
    module.path,
    clientModuleRepresentationDigest(module.source),
  );
}
