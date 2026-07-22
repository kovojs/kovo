import { trustedHtml } from '@kovojs/browser';
import { clientModuleRepresentationDigest } from '@kovojs/core/internal/client-module-url';
import { describe, expect, it, vi } from 'vitest';

import { createApp, createRequestHandler } from './app.js';
import {
  computeRenderPlanFingerprint,
  createMemoryVersionedClientModuleStore,
  replaceVersionedClientModuleBuildSnapshot,
  snapshotVersionedClientModuleRegistry,
  versionedClientModuleHref,
  type VersionedClientModuleActiveSnapshot,
  type VersionedClientModuleInput,
  type VersionedClientModuleStore,
} from './client-modules.js';
import { query } from './query.js';
import { route } from './route.js';

describe('runtime coherence', () => {
  it('does not reread a custom store before rejecting missing or malformed build identity', async () => {
    const backing = createMemoryVersionedClientModuleStore();
    const calls = { read: 0, replace: 0, resolve: 0, retain: 0 };
    const store: VersionedClientModuleStore = {
      readActiveSnapshot() {
        calls.read += 1;
        return backing.readActiveSnapshot();
      },
      replaceActiveSnapshot(snapshot) {
        calls.replace += 1;
        backing.replaceActiveSnapshot(snapshot);
      },
      resolve(href) {
        calls.resolve += 1;
        return backing.resolve(href);
      },
      retain(module) {
        calls.retain += 1;
        backing.retain(module);
      },
    };
    const load = vi.fn(() => ({ ok: true }));
    const app = createApp({
      clientModules: store,
      queries: [query('coherence/read', { load, reads: [] })],
    });
    const moduleHref = app.clientModules.put({
      path: '/c/coherence.client.js',
      source: 'export const safe = true;',
    });
    const handler = createRequestHandler(app);
    const buildToken = app.clientModules.buildToken();
    store.readActiveSnapshot = () => {
      throw new Error('late read method substitution');
    };
    store.replaceActiveSnapshot = () => {
      throw new Error('late replace method substitution');
    };
    store.retain = () => {
      throw new Error('late retain method substitution');
    };
    store.resolve = () => ({
      body: 'export const attacker = true;',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 200 as const,
    });
    calls.read = calls.replace = calls.resolve = calls.retain = 0;

    for (const headers of [
      { 'Kovo-Fragment': 'true' },
      { 'Kovo-Build': 'malformed', 'Kovo-Fragment': 'true' },
    ]) {
      const response = await handler(new Request('https://kovo.local/_q/%E0%A4%A', { headers }));
      expect(response.status).toBe(409);
      expect(response.headers.get('Kovo-Build')).toBe(buildToken);
      expect(response.headers.get('Kovo-Build-Skew')).toBe('true');
    }

    expect(load).not.toHaveBeenCalled();
    expect(calls).toEqual({ read: 0, replace: 0, resolve: 0, retain: 0 });
    expect(Object.isFrozen(app.clientModules)).toBe(true);
    expect(Reflect.set(app.clientModules, 'buildToken', () => 'attacker')).toBe(false);
    expect(app.clientModules.buildToken()).toBe(buildToken);

    const moduleResponse = await handler(new Request(`https://kovo.local${moduleHref}`));
    expect(moduleResponse.status).toBe(200);
    expect(moduleResponse.headers.get('Content-Type')).toBe('text/javascript; charset=utf-8');
    await expect(moduleResponse.text()).resolves.toBe('export const safe = true;');
    expect(calls).toEqual({ read: 0, replace: 0, resolve: 1, retain: 0 });
  });

  it('snapshots the current dev token once for each request after publication', async () => {
    const registry = snapshotVersionedClientModuleRegistry(
      createMemoryVersionedClientModuleStore(),
    );
    const app = createApp({
      clientModules: registry,
      queries: [query('coherence/read', { load: () => ({ ok: true }), reads: [] })],
      routes: [route('/', { page: () => trustedHtml('<main>coherent</main>') })],
    });
    const handler = createRequestHandler(app);
    const admittedBuild = app.clientModules.buildToken();

    app.clientModules.put({
      path: '/c/next.client.js',
      source: 'export const generation = 2;',
    });
    createRequestHandler(app);
    const liveBuild = app.clientModules.buildToken();
    expect(liveBuild).not.toBe(admittedBuild);

    const documentResponse = await handler(new Request('https://kovo.local/'));
    const documentBody = await documentResponse.text();
    expect(documentResponse.headers.get('Kovo-Build')).toBe(liveBuild);
    expect(documentBody).toContain(`name="kovo-build" content="${liveBuild}"`);

    const staleReadResponse = await handler(
      new Request('https://kovo.local/_q/coherence%2Fread', {
        headers: { 'Kovo-Build': admittedBuild, 'Kovo-Fragment': 'true' },
      }),
    );
    expect(staleReadResponse.status).toBe(409);
    expect(staleReadResponse.headers.get('Kovo-Build')).toBe(liveBuild);

    const readResponse = await handler(
      new Request('https://kovo.local/_q/coherence%2Fread', {
        headers: { 'Kovo-Build': liveBuild, 'Kovo-Fragment': 'true' },
      }),
    );
    expect(readResponse.status).toBe(200);
    expect(readResponse.headers.get('Kovo-Build')).toBe(liveBuild);
  });

  it('keeps one admitted document on its old snapshot while dev publication rotates', async () => {
    const backing = createMemoryVersionedClientModuleStore();
    const oldModule: VersionedClientModuleInput = {
      path: '/c/cart.client.js',
      source: 'export const generation = 1;',
    };
    const oldSnapshot: VersionedClientModuleActiveSnapshot = {
      modules: [oldModule],
      renderPlanFingerprint: computeRenderPlanFingerprint({ old: 'field:id' }),
    };
    backing.retain(oldModule);
    backing.replaceActiveSnapshot(oldSnapshot);
    const registry = snapshotVersionedClientModuleRegistry(backing);
    const oldHref = versionedClientModuleHref(
      oldModule.path,
      clientModuleRepresentationDigest(oldModule.source),
    );

    let releaseRender!: () => void;
    const renderReleased = new Promise<void>((resolve) => {
      releaseRender = resolve;
    });
    let markRenderStarted!: () => void;
    const renderStarted = new Promise<void>((resolve) => {
      markRenderStarted = resolve;
    });
    const app = createApp({
      clientModules: registry,
      routes: [
        route('/', {
          modulepreloads: [oldHref],
          async page() {
            markRenderStarted();
            await renderReleased;
            return trustedHtml(`<button on:click="${oldHref}#Cart$run">Run</button>`);
          },
        }),
      ],
    });
    const handler = createRequestHandler(app);
    const admittedBuild = app.clientModules.buildToken();
    const documentPromise = handler(new Request('https://kovo.local/'));
    await renderStarted;

    replaceVersionedClientModuleBuildSnapshot(registry, {
      modules: [{ path: '/c/cart.client.js', source: 'export const generation = 3;' }],
      renderPlanFingerprint: computeRenderPlanFingerprint({ latest: 'field:id' }),
    });
    const liveBuild = app.clientModules.buildToken();
    expect(liveBuild).not.toBe(admittedBuild);
    releaseRender();

    const document = await documentPromise;
    const documentBody = await document.text();
    expect(document.headers.get('Kovo-Build')).toBe(admittedBuild);
    expect(documentBody).toContain(`name="kovo-build" content="${admittedBuild}"`);
    expect(documentBody).toContain(oldHref);
    const retained = await handler(new Request(`https://kovo.local${oldHref}`));
    expect(retained.status).toBe(200);
    await expect(retained.text()).resolves.toBe(oldModule.source);

    const staleRead = await handler(
      new Request('https://kovo.local/_q/missing', {
        headers: { 'Kovo-Build': admittedBuild, 'Kovo-Fragment': 'true' },
      }),
    );
    expect(staleRead.status).toBe(409);
    expect(staleRead.headers.get('Kovo-Build')).toBe(liveBuild);
  });

  it('stamps configured and fallback error documents with the admitted build', async () => {
    const app = createApp({
      errorShells: {
        notFound: () => trustedHtml('<main>configured missing</main>'),
      },
      onError: () => {},
      routes: [
        route('/boom', {
          page() {
            throw new Error('private failure');
          },
        }),
      ],
    });
    const handler = createRequestHandler(app);
    const buildToken = app.clientModules.buildToken();

    for (const [path, status] of [
      ['/missing', 404],
      ['/boom', 500],
    ] as const) {
      const response = await handler(new Request(`https://kovo.local${path}`));
      const body = await response.text();
      expect(response.status).toBe(status);
      expect(response.headers.get('Kovo-Build')).toBe(buildToken);
      expect(body).toContain(`name="kovo-build" content="${buildToken}"`);
    }
  });

  it('keeps a configured error shell on the request snapshot during dev rotation', async () => {
    const registry = snapshotVersionedClientModuleRegistry(
      createMemoryVersionedClientModuleStore(),
    );
    let releaseRender!: () => void;
    const renderReleased = new Promise<void>((resolve) => {
      releaseRender = resolve;
    });
    let markRenderStarted!: () => void;
    const renderStarted = new Promise<void>((resolve) => {
      markRenderStarted = resolve;
    });
    const app = createApp({
      clientModules: registry,
      errorShells: {
        serverError: () => trustedHtml('<main>configured failure</main>'),
      },
      onError: () => {},
      routes: [
        route('/boom', {
          async page() {
            markRenderStarted();
            await renderReleased;
            throw new Error('private failure');
          },
        }),
      ],
    });
    const handler = createRequestHandler(app);
    const admittedBuild = app.clientModules.buildToken();
    const responsePromise = handler(new Request('https://kovo.local/boom'));
    await renderStarted;

    replaceVersionedClientModuleBuildSnapshot(registry, {
      modules: [{ path: '/c/new.client.js', source: 'export const generation = 2;' }],
      renderPlanFingerprint: computeRenderPlanFingerprint({ next: 'field:id' }),
    });
    expect(app.clientModules.buildToken()).not.toBe(admittedBuild);
    releaseRender();

    const response = await responsePromise;
    const body = await response.text();
    expect(response.status).toBe(500);
    expect(response.headers.get('Kovo-Build')).toBe(admittedBuild);
    expect(body).toContain('<main>configured failure</main>');
    expect(body).toContain(`name="kovo-build" content="${admittedBuild}"`);
  });
});
