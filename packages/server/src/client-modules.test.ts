import { createHash } from 'node:crypto';

import { kovoDeferredAppRuntimeModuleSource } from '@kovojs/browser/internal/deferred-app-runtime';
import {
  kovoDeferredAppRuntimeModuleHref,
  kovoDeferredAppRuntimeModulePath,
} from '@kovojs/browser/internal/deferred-app-runtime-identity';
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
  createMemoryVersionedClientModuleStore,
  createMemoryVersionedClientModuleRegistry,
  finalizeVersionedClientModuleBuild,
  RENDER_PLAN_GRAMMAR_VERSION,
  renderVersionedClientModuleResponse,
  replaceVersionedClientModuleBuildSnapshot,
  snapshotVersionedClientModuleRegistry,
  versionedClientModuleHref,
  type VersionedClientModuleInput,
  type VersionedClientModuleActiveSnapshot,
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

function createRegistry(
  store:
    | VersionedClientModuleStore
    | VersionedClientModuleRegistry = createMemoryVersionedClientModuleRegistry(),
): VersionedClientModuleRegistry {
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
    expect(clientModuleBuildTokenHash(fingerprint, ['名🙂', '\0:x'])).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('is invariant to registration order and retained resolver history', () => {
    const one = { path: '/c/a.client.js', source: 'export const a = 1;' };
    const two = { path: '/c/z.client.js', source: 'export const z = 2;' };
    const history = { path: '/c/a.client.js', source: 'export const a = 0;' };
    const fingerprint = computeRenderPlanFingerprint({ cart: 'id' });

    const storeA = createMemoryVersionedClientModuleRegistry();
    const registryA = createRegistry(storeA);
    replaceVersionedClientModuleBuildSnapshot(registryA, {
      modules: [history],
      renderPlanFingerprint: fingerprint,
    });
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
    expect(storeA.resolve(clientHref(history))).toMatchObject({
      body: history.source,
      status: 200,
    });
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
    const backing = createMemoryVersionedClientModuleStore();
    const attackerToken = vi.fn(() => 'attacker-token');
    const attackerSetter = vi.fn();
    const registry = snapshotVersionedClientModuleRegistry({
      readActiveSnapshot: () => backing.readActiveSnapshot(),
      replaceActiveSnapshot: (snapshot) => backing.replaceActiveSnapshot(snapshot),
      retain: (module) => backing.retain(module),
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
    expect(finalizeVersionedClientModuleBuild(registry)).toBe(token);
    expect(() => registry.put({ path: '/c/b.client.js', source: 'export {}' })).toThrow(/KV417/);
    expect(registry.buildToken()).toBe(token);
  });

  it('reconstructs the exact durable active snapshot after restart without promoting history', () => {
    const store = createMemoryVersionedClientModuleStore();
    const first = snapshotVersionedClientModuleRegistry(store);
    const oldModule = { path: '/c/cart.client.js', source: 'export const revision = 1;' };
    const activeModule = { path: '/c/cart.client.js', source: 'export const revision = 2;' };
    const fingerprint = computeRenderPlanFingerprint({ cart: 'field:id,total' });

    replaceVersionedClientModuleBuildSnapshot(first, {
      modules: [oldModule],
      renderPlanFingerprint: fingerprint,
    });
    replaceVersionedClientModuleBuildSnapshot(first, {
      modules: [activeModule],
      renderPlanFingerprint: fingerprint,
    });

    const restarted = snapshotVersionedClientModuleRegistry(store);
    expect(restarted.entries()).toEqual([activeModule]);
    expect(restarted.buildToken()).toBe(first.buildToken());
    expect(restarted.resolve(clientHref(oldModule))).toMatchObject({
      body: oldModule.source,
      status: 200,
    });
  });

  it('unions framework-mandatory and stable/manual modules into a complete replacement', () => {
    const registry = createRegistry();
    const tokenBeforeStaging = registry.buildToken();
    const loaderHref = ensureKovoLoaderRuntimeClientModule(registry);
    const manual = { path: '/c/manual.client.js', source: 'export const manual = true;' };
    const compiled = { path: '/c/compiled.client.js', source: 'export const compiled = true;' };
    registry.put(manual);

    expect(registry.entries()).toEqual([]);
    expect(registry.buildToken()).toBe(tokenBeforeStaging);

    replaceVersionedClientModuleBuildSnapshot(registry, {
      modules: [compiled],
      renderPlanFingerprint: computeRenderPlanFingerprint({ compiled: 'field:id' }),
    });

    expect(new Set(registry.entries().map(clientHref))).toEqual(
      new Set([loaderHref, clientHref(manual), clientHref(compiled)]),
    );
  });

  it('selects one immutable compiler-generated app runtime without staging the static fallback', () => {
    const registry = createRegistry();
    const runtime = {
      path: '/c/generated/app.client.js',
      source:
        '// @kovojs-ir\n// @kovojs-generated-app-runtime/v1\n' +
        `import ${JSON.stringify(kovoDeferredAppRuntimeModuleHref)};\n` +
        'export function installKovoDeferredRuntime() {}\n',
    };
    const generatedRuntime = {
      path: kovoDeferredAppRuntimeModulePath,
      source: kovoDeferredAppRuntimeModuleSource,
    };
    const optimism = {
      path: '/c/src/mutations.client.js',
      source:
        '// @kovojs-ir\n' +
        'export const kovoOptimisticMutationPlans = Object.freeze({ close: true });\n',
    };
    replaceVersionedClientModuleBuildSnapshot(registry, {
      modules: [optimism, runtime, generatedRuntime],
      renderPlanFingerprint: computeRenderPlanFingerprint({ deal: 'field:id,stage' }),
    });

    expect(ensureKovoLoaderRuntimeClientModule(registry)).toBe(clientHref(runtime));
    expect(registry.entries()).toHaveLength(3);
    expect(new Set(registry.entries().map(clientHref))).toEqual(
      new Set([clientHref(runtime), clientHref(generatedRuntime), clientHref(optimism)]),
    );
  });

  it('refuses a generated app bootstrap whose exact deferred runtime is missing', () => {
    const registry = createRegistry();
    const runtime = {
      path: '/c/generated/app.client.js',
      source:
        '// @kovojs-ir\n// @kovojs-generated-app-runtime/v1\n' +
        `import ${JSON.stringify(kovoDeferredAppRuntimeModuleHref)};\n` +
        'export function installKovoDeferredRuntime() {}\n',
    };
    replaceVersionedClientModuleBuildSnapshot(registry, {
      modules: [runtime],
      renderPlanFingerprint: computeRenderPlanFingerprint({ deal: 'field:id,stage' }),
    });

    expect(() => ensureKovoLoaderRuntimeClientModule(registry)).toThrow(
      /without exactly one active generated deferred runtime/u,
    );
  });

  it('refuses malformed or ambiguous active generated deferred runtimes', () => {
    const appRuntime = {
      path: '/c/generated/app.client.js',
      source:
        '// @kovojs-ir\n// @kovojs-generated-app-runtime/v1\n' +
        `import ${JSON.stringify(kovoDeferredAppRuntimeModuleHref)};\n` +
        'export function installKovoDeferredRuntime() {}\n',
    };
    const malformedRegistry = createRegistry();
    replaceVersionedClientModuleBuildSnapshot(malformedRegistry, {
      modules: [
        appRuntime,
        {
          path: kovoDeferredAppRuntimeModulePath,
          source: `${kovoDeferredAppRuntimeModuleSource}\n`,
        },
      ],
      renderPlanFingerprint: computeRenderPlanFingerprint({ deal: 'field:id,stage' }),
    });
    expect(() => ensureKovoLoaderRuntimeClientModule(malformedRegistry)).toThrow(
      /identity does not match its active compiler snapshot/u,
    );

    const ambiguousRegistry = createRegistry();
    replaceVersionedClientModuleBuildSnapshot(ambiguousRegistry, {
      modules: [
        appRuntime,
        {
          path: kovoDeferredAppRuntimeModulePath,
          source: kovoDeferredAppRuntimeModuleSource,
        },
        {
          path: kovoDeferredAppRuntimeModulePath,
          source: `${kovoDeferredAppRuntimeModuleSource}\n`,
        },
      ],
      renderPlanFingerprint: computeRenderPlanFingerprint({ deal: 'field:id,stage' }),
    });
    expect(() => ensureKovoLoaderRuntimeClientModule(ambiguousRegistry)).toThrow(
      /without exactly one active generated deferred runtime/u,
    );
  });

  it('refuses active compiler optimism without its generated app runtime', () => {
    const registry = createRegistry();
    replaceVersionedClientModuleBuildSnapshot(registry, {
      modules: [
        {
          path: '/c/src/mutations.client.js',
          source:
            '// @kovojs-ir\n' +
            'export const kovoOptimisticMutationPlans = Object.freeze({ close: true });\n',
        },
      ],
      renderPlanFingerprint: computeRenderPlanFingerprint({ deal: 'field:id,stage' }),
    });

    expect(() => ensureKovoLoaderRuntimeClientModule(registry)).toThrow(
      /optimistic plans without \/c\/generated\/app\.client\.js/u,
    );
  });

  it('refuses ambiguous active generated app runtimes', () => {
    const registry = createRegistry();
    replaceVersionedClientModuleBuildSnapshot(registry, {
      modules: [
        {
          path: '/c/generated/app.client.js',
          source:
            '// @kovojs-ir\n// @kovojs-generated-app-runtime/v1\n' +
            'export function installKovoDeferredRuntime() { return 1; }\n',
        },
        {
          path: '/c/generated/app.client.js',
          source:
            '// @kovojs-ir\n// @kovojs-generated-app-runtime/v1\n' +
            'export function installKovoDeferredRuntime() { return 2; }\n',
        },
      ],
      renderPlanFingerprint: computeRenderPlanFingerprint({ deal: 'field:id,stage' }),
    });

    expect(() => ensureKovoLoaderRuntimeClientModule(registry)).toThrow(
      /multiple active compiler-generated app runtimes/u,
    );
  });

  it('refuses a malformed module occupying the generated app runtime path', () => {
    const registry = createRegistry();
    replaceVersionedClientModuleBuildSnapshot(registry, {
      modules: [{ path: '/c/generated/app.client.js', source: 'export const forged = true;' }],
      renderPlanFingerprint: computeRenderPlanFingerprint({ deal: 'field:id,stage' }),
    });

    expect(() => ensureKovoLoaderRuntimeClientModule(registry)).toThrow(
      /malformed compiler-generated app runtime/u,
    );
  });

  it('does not publish an active snapshot or token when a late retain fails', () => {
    const backing = createMemoryVersionedClientModuleStore();
    let rejectSource: string | undefined;
    const store: VersionedClientModuleStore = {
      readActiveSnapshot: () => backing.readActiveSnapshot(),
      replaceActiveSnapshot: (snapshot) => backing.replaceActiveSnapshot(snapshot),
      retain(module) {
        if (module.source === rejectSource) throw new Error('late retain failed');
        backing.retain(module);
      },
      resolve: (href) => backing.resolve(href),
    };
    const registry = snapshotVersionedClientModuleRegistry(store);
    const current = { path: '/c/current.client.js', source: 'export const current = true;' };
    replaceVersionedClientModuleBuildSnapshot(registry, {
      modules: [current],
      renderPlanFingerprint: computeRenderPlanFingerprint({ current: 'field:id' }),
    });
    const tokenBefore = registry.buildToken();
    const snapshotBefore = backing.readActiveSnapshot();
    rejectSource = 'export const rejected = true;';

    expect(() =>
      replaceVersionedClientModuleBuildSnapshot(registry, {
        modules: [
          { path: '/c/retained.client.js', source: 'export const retained = true;' },
          { path: '/c/rejected.client.js', source: rejectSource! },
        ],
        renderPlanFingerprint: computeRenderPlanFingerprint({ next: 'field:id' }),
      }),
    ).toThrow('late retain failed');
    expect(registry.buildToken()).toBe(tokenBefore);
    expect(registry.entries()).toEqual([current]);
    expect(backing.readActiveSnapshot()).toEqual(snapshotBefore);
  });

  it('freezes committed module records and poisons a facade after unverifiable readback', () => {
    const backing = createMemoryVersionedClientModuleStore();
    let corruptReadback = false;
    let committedRecordFrozen = false;
    const store: VersionedClientModuleStore = {
      readActiveSnapshot() {
        const snapshot = backing.readActiveSnapshot();
        if (!corruptReadback) return snapshot;
        return {
          modules: [],
          renderPlanFingerprint: snapshot.renderPlanFingerprint,
        };
      },
      replaceActiveSnapshot(snapshot) {
        committedRecordFrozen = snapshot.modules.length > 0 && Object.isFrozen(snapshot.modules[0]);
        backing.replaceActiveSnapshot(snapshot);
        corruptReadback = true;
      },
      retain: (module) => backing.retain(module),
      resolve: (href) => backing.resolve(href),
    };
    const registry = snapshotVersionedClientModuleRegistry(store);

    expect(() =>
      replaceVersionedClientModuleBuildSnapshot(registry, {
        modules: [{ path: '/c/app.client.js', source: 'export const app = true;' }],
        renderPlanFingerprint: computeRenderPlanFingerprint({ app: 'field:id' }),
      }),
    ).toThrow(/KV417.*permanently closed/);
    expect(committedRecordFrozen).toBe(true);
    expect(() => registry.buildToken()).toThrow(/KV417.*permanently closed/);
    expect(() => registry.entries()).toThrow(/KV417.*permanently closed/);
  });

  it('rejects accessor and Proxy active snapshots without observing authored getters', () => {
    let getterCalls = 0;
    const methods = {
      replaceActiveSnapshot: () => {},
      retain: () => {},
      resolve: () => ({ body: 'Not Found', headers: {}, status: 404 as const }),
    };
    expect(() =>
      snapshotVersionedClientModuleRegistry({
        ...methods,
        readActiveSnapshot: () => ({
          get modules() {
            getterCalls += 1;
            return [];
          },
          renderPlanFingerprint: computeRenderPlanFingerprint({}),
        }),
      }),
    ).toThrow(/modules must be stable own data/);
    expect(getterCalls).toBe(0);

    const proxied = new Proxy<VersionedClientModuleActiveSnapshot>(
      {
        modules: [],
        renderPlanFingerprint: computeRenderPlanFingerprint({}),
      },
      {},
    );
    expect(() =>
      snapshotVersionedClientModuleRegistry({
        ...methods,
        readActiveSnapshot: () => proxied,
      }),
    ).toThrow(/non-Proxy object/);
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
    expect(versionedClientModuleRequestKey(href)).toBe(
      new URL(href, 'https://kovo.local').pathname,
    );
    expect(
      versionedClientModuleRequestKey(`/c/components/cart.client.js?v=${digest}`),
    ).toBeUndefined();
    expect(
      parseVersionedClientModuleTarget('/c/__v/cart-v1/components/cart.client.js'),
    ).toBeUndefined();
  });

  it('retains old bytes while the facade active manifest can exclude them', () => {
    const store = createMemoryVersionedClientModuleRegistry();
    const registry = createRegistry(store);
    const oldModule = { path: '/c/cart.client.js', source: 'export const version = "old";' };
    const newModule = { path: '/c/cart.client.js', source: 'export const version = "new";' };
    replaceVersionedClientModuleBuildSnapshot(registry, {
      modules: [oldModule],
      renderPlanFingerprint: computeRenderPlanFingerprint({}),
    });
    const oldHref = clientHref(oldModule);
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

  it('ignores store-supplied identity and rejects conflicting body or content-type overwrite', () => {
    const source = 'export const safe = true;';
    const expectedHref = clientHref({ path: '/c/safe.client.js', source });
    const retained: VersionedClientModuleInput[] = [];
    const noIdentityStore: VersionedClientModuleStore = {
      readActiveSnapshot: () => ({
        modules: [],
        renderPlanFingerprint: computeRenderPlanFingerprint({}),
      }),
      replaceActiveSnapshot: () => {},
      retain: (module) => {
        retained.push(module);
        return ('/c/__v/' + '0'.repeat(64) + '/forged.client.js') as unknown as void;
      },
      resolve: () => ({ body: source, headers: {}, status: 200 }),
    };
    expect(createRegistry(noIdentityStore).put({ path: '/c/safe.client.js', source })).toBe(
      expectedHref,
    );
    expect(retained).toEqual([{ path: '/c/safe.client.js', source }]);

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
        readActiveSnapshot: () => ({
          modules: [{ path: '/c/safe.client.js', source }],
          renderPlanFingerprint: computeRenderPlanFingerprint({}),
        }),
        replaceActiveSnapshot: () => {},
        retain: () => {},
        resolve: () => response,
      };
      expect(() => createRegistry(store).resolve(expectedHref)).toThrow(/bytes|metadata/);
    }
  });

  it('rejects accessor and Proxy response envelopes without invoking getters', () => {
    const source = 'export const safe = true;';
    const module = { path: '/c/safe.client.js', source };
    const href = clientHref(module);
    let getterCalls = 0;
    const storeFor = (response: unknown): VersionedClientModuleStore => ({
      readActiveSnapshot: () => ({
        modules: [module],
        renderPlanFingerprint: computeRenderPlanFingerprint({}),
      }),
      replaceActiveSnapshot: () => {},
      retain: () => {},
      resolve: () => response as ReturnType<VersionedClientModuleStore['resolve']>,
    });

    const accessorResponse = {
      get body() {
        getterCalls += 1;
        return source;
      },
      headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
      status: 200 as const,
    };
    expect(() => createRegistry(storeFor(accessorResponse)).resolve(href)).toThrow(
      /body must be stable own data/,
    );
    expect(getterCalls).toBe(0);

    const proxiedResponse = new Proxy(
      {
        body: source,
        headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
        status: 200 as const,
      },
      {},
    );
    expect(() => createRegistry(storeFor(proxiedResponse)).resolve(href)).toThrow(
      /non-Proxy object/,
    );
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
    expect(
      renderVersionedClientModuleResponse(registry, { url: '/c/cart.client.js' }),
    ).toMatchObject({ status: 404 });
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
      await expect(
        import(`${clientModuleRegistryIntrinsicsUrl}?preimport-hash-poison`),
      ).rejects.toThrow(/hash controls failed their semantic check/);
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
  return versionedClientModuleHref(module.path, clientModuleRepresentationDigest(module.source));
}
