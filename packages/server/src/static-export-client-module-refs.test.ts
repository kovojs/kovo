import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';
import { trustedHtml } from '@kovojs/browser';

import { createApp, createRequestHandler } from './app.js';
import { createMemoryVersionedClientModuleRegistry } from './client-modules.js';
import { route } from './route.js';
import { exportStaticApp } from './static-export.js';

const runtimeClientModulePath = /^\/c\/__v\/[^/]+\/kovo-runtime\.client\.js$/;
const runtimeClientModuleArtifact = expect.objectContaining({
  href: expect.stringMatching(runtimeClientModulePath),
  path: expect.stringMatching(runtimeClientModulePath),
  status: 200,
});

describe('server static export', () => {
  it('discovers referenced client modules without requiring an output directory', async () => {
    const registry = createMemoryVersionedClientModuleRegistry();
    const cartHref = registry.put({
      path: '/c/cart.client.js',
      source: 'export const cart = "dry-run";',
      version: 'cart-dry-run',
    });
    const app = createApp({
      clientModules: registry,
      routes: [
        route('/cart', {
          page: () =>
            trustedHtml(`<main><button on:click="${cartHref}#Cart$add">Add</button></main>`),
        }),
      ],
    });

    const result = await exportStaticApp(app);

    expect(result.clientModules).toEqual([
      {
        body: 'export const cart = "dry-run";',
        headers: {
          'cache-control': 'public, max-age=31536000, immutable',
          'cross-origin-resource-policy': 'same-origin',
          'content-type': 'text/javascript; charset=utf-8',
        },
        href: `${cartHref}#Cart$add`,
        path: '/c/__v/cart-dry-run/cart.client.js',
        status: 200,
      },
      runtimeClientModuleArtifact,
    ]);
  });

  it('copies referenced versioned client modules through the same handler bytes', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-'));
    try {
      const registry = createMemoryVersionedClientModuleRegistry();
      const cartHref = registry.put({
        path: '/c/cart.client.js',
        source: 'export const cart = "build-1";',
        version: 'cart-1',
      });
      const menuHref = registry.put({
        path: '/c/menu.client.js',
        source: 'export const menu = "build-1";',
        version: 'menu-1',
      });
      const app = createApp({
        clientModules: registry,
        routes: [
          route('/cart', {
            modulepreloads: [cartHref],
            page: () =>
              trustedHtml(
                `<main><button on:click="${menuHref}#Menu$open">Open menu</button></main>`,
              ),
          }),
        ],
      });
      const handler = createRequestHandler(app);

      const result = await exportStaticApp(app, { outDir });

      expect(result.clientModules.map((artifact) => artifact.href)).toEqual([
        cartHref,
        `${menuHref}#Menu$open`,
        expect.stringMatching(runtimeClientModulePath),
      ]);
      expect(result.clientModules.map((artifact) => artifact.path)).toEqual([
        '/c/__v/cart-1/cart.client.js',
        '/c/__v/menu-1/menu.client.js',
        expect.stringMatching(runtimeClientModulePath),
      ]);

      const cartResponse = await handler(new Request(`https://kovo.local${cartHref}`));
      const menuResponse = await handler(new Request(`https://kovo.local${menuHref}`));
      await expect(
        readFile(path.join(outDir, 'c/__v/cart-1/cart.client.js'), 'utf8'),
      ).resolves.toBe(await cartResponse.text());
      await expect(
        readFile(path.join(outDir, 'c/__v/menu-1/menu.client.js'), 'utf8'),
      ).resolves.toBe(await menuResponse.text());
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('does not publish registered but unreferenced modules after Set.add replacement', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-module-set-'));
    const registry = createMemoryVersionedClientModuleRegistry();
    const publicHref = registry.put({
      path: '/c/public.client.js',
      source: 'export const publicModule = true;',
      version: 'public-build',
    });
    const privateHref = registry.put({
      path: '/c/private-admin.client.js',
      source: 'export const serverOnlyAdminToken = "internal-build-token";',
      version: 'private-build',
    });
    const originalAdd = Set.prototype.add;
    let result: Awaited<ReturnType<typeof exportStaticApp>>;

    try {
      const app = createApp({
        clientModules: registry,
        routes: [
          route('/', {
            page() {
              Set.prototype.add = function (value) {
                const added = Reflect.apply(originalAdd, this, [value]);
                if (typeof value === 'string' && value.indexOf(publicHref) !== -1) {
                  Reflect.apply(originalAdd, this, [privateHref]);
                }
                return added;
              };
              return trustedHtml(
                `<main><button on:click="${publicHref}#Public$run">Run</button></main>`,
              );
            },
          }),
        ],
      });

      result = await exportStaticApp(app, { outDir });
    } finally {
      Set.prototype.add = originalAdd;
    }

    try {
      expect(result.clientModules.map((artifact) => artifact.path)).toEqual([
        '/c/__v/public-build/public.client.js',
        expect.stringMatching(runtimeClientModulePath),
      ]);
      expect(result.clientModules.map((artifact) => artifact.body)).not.toContain(
        'export const serverOnlyAdminToken = "internal-build-token";',
      );
      await expect(
        readFile(path.join(outDir, 'c/__v/private-build/private-admin.client.js'), 'utf8'),
      ).rejects.toThrow();
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('copies same-origin absolute client module refs from exported documents and Link headers', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-'));
    try {
      const registry = createMemoryVersionedClientModuleRegistry();
      const cartHref = registry.put({
        path: '/c/cart.client.js',
        source: 'export const cart = "absolute-build";',
        version: 'cart-absolute',
      });
      const menuHref = registry.put({
        path: '/c/menu.client.js',
        source: 'export const menu = "absolute-build";',
        version: 'menu-absolute',
      });
      const cartUrl = new URL(cartHref, 'https://shop.example.test').href;
      const menuUrl = new URL(menuHref, 'https://shop.example.test').href;
      const app = createApp({
        clientModules: registry,
        routes: [
          route('/cart', {
            modulepreloads: [cartUrl],
            page: () =>
              trustedHtml(
                `<main><button on:click="${menuUrl}#Menu$open">Open menu</button></main>`,
              ),
          }),
        ],
      });

      const result = await exportStaticApp(app, {
        origin: 'https://shop.example.test',
        outDir,
      });

      expect(result.clientModules.map((artifact) => artifact.href)).toEqual([
        '/c/__v/cart-absolute/cart.client.js',
        '/c/__v/menu-absolute/menu.client.js#Menu$open',
        expect.stringMatching(runtimeClientModulePath),
      ]);
      await expect(
        readFile(path.join(outDir, 'c/__v/cart-absolute/cart.client.js'), 'utf8'),
      ).resolves.toBe('export const cart = "absolute-build";');
      await expect(
        readFile(path.join(outDir, 'c/__v/menu-absolute/menu.client.js'), 'utf8'),
      ).resolves.toBe('export const menu = "absolute-build";');
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('rejects referenced client modules that replay to non-JavaScript before writing files', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-'));
    try {
      const clientModules = {
        buildToken() {
          return 'static-export-wrong-content-type';
        },
        entries() {
          return [];
        },
        put(module: { path: string; version: string }) {
          return `/c/__v/${module.version}/${module.path.slice('/c/'.length)}`;
        },
        resolve(href?: string) {
          if (href?.includes('/kovo-runtime.client.js')) {
            return {
              body: 'export {};',
              headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
              status: 200,
            };
          }
          return {
            body: '<!doctype html><h1>Wrong handler</h1>',
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
            status: 200,
          };
        },
      };
      const app = createApp({
        clientModules,
        routes: [
          route('/', {
            modulepreloads: ['/c/cart.client.js?v=cart-1'],
            page: () => trustedHtml('<main>Home</main>'),
          }),
        ],
      });

      await expect(exportStaticApp(app, { outDir })).rejects.toMatchObject({
        code: 'KV229',
        diagnostics: [
          {
            code: 'KV229',
            message: expect.stringContaining(
              "client module '/c/cart.client.js?v=cart-1' because the app handler returned status 200 with Content-Type 'text/html; charset=utf-8'",
            ),
            routePath: '/c/cart.client.js',
          },
        ],
      });
      await expect(readFile(path.join(outDir, 'index.html'))).rejects.toThrow();
      await expect(readFile(path.join(outDir, 'c', 'cart.client.js'))).rejects.toThrow();
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('refuses unsafe client module output paths', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-'));
    try {
      const badHref = '/c/%2Fescape.client.js?v=v1';
      const clientModules = {
        buildToken() {
          return 'static-export-unsafe-path';
        },
        entries() {
          return [];
        },
        put(module: { path: string; version: string }) {
          return `/c/__v/${module.version}/${module.path.slice('/c/'.length)}`;
        },
        resolve(href?: string) {
          if (href?.includes('/kovo-runtime.client.js')) {
            return {
              body: 'export {};',
              headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
              status: 200,
            };
          }
          return {
            body: 'export const unsafe = true;',
            headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
            status: 200,
          };
        },
      };
      const app = createApp({
        clientModules,
        routes: [
          route('/unsafe', {
            modulepreloads: [badHref],
            page: () => trustedHtml('<main>Unsafe module path</main>'),
          }),
        ],
      });

      await expect(exportStaticApp(app, { outDir })).rejects.toMatchObject({
        code: 'KV229',
        diagnostics: [
          {
            code: 'KV229',
            message: expect.stringContaining('unsafe client module path segment'),
            routePath: '/c/%2Fescape.client.js',
          },
        ],
      });
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });
});
