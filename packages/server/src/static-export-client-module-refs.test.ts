import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createApp, createRequestHandler } from './app.js';
import { createMemoryVersionedClientModuleRegistry } from './client-modules.js';
import { route } from './route.js';
import { exportStaticApp } from './static-export.js';

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
          page: () => `<main><button on:click="${cartHref}#Cart$add">Add</button></main>`,
        }),
      ],
    });

    const result = await exportStaticApp(app);

    expect(result.clientModules).toEqual([
      {
        body: 'export const cart = "dry-run";',
        headers: {
          'cache-control': 'public, max-age=31536000, immutable',
          'content-type': 'text/javascript; charset=utf-8',
        },
        href: `${cartHref}#Cart$add`,
        path: '/c/cart.client.js',
        status: 200,
      },
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
            page: () => `<main><button on:click="${menuHref}#Menu$open">Open menu</button></main>`,
          }),
        ],
      });
      const handler = createRequestHandler(app);

      const result = await exportStaticApp(app, { outDir });

      expect(result.clientModules.map((artifact) => artifact.href)).toEqual([
        cartHref,
        `${menuHref}#Menu$open`,
      ]);
      expect(result.clientModules.map((artifact) => artifact.path)).toEqual([
        '/c/cart.client.js',
        '/c/menu.client.js',
      ]);

      const cartResponse = await handler(new Request(`https://kovo.local${cartHref}`));
      const menuResponse = await handler(new Request(`https://kovo.local${menuHref}`));
      await expect(readFile(path.join(outDir, 'c/cart.client.js'), 'utf8')).resolves.toBe(
        await cartResponse.text(),
      );
      await expect(readFile(path.join(outDir, 'c/menu.client.js'), 'utf8')).resolves.toBe(
        await menuResponse.text(),
      );
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
            page: () => `<main><button on:click="${menuUrl}#Menu$open">Open menu</button></main>`,
          }),
        ],
      });

      const result = await exportStaticApp(app, {
        origin: 'https://shop.example.test',
        outDir,
      });

      expect(result.clientModules.map((artifact) => artifact.href)).toEqual([
        '/c/cart.client.js?v=cart-absolute',
        '/c/menu.client.js?v=menu-absolute#Menu$open',
      ]);
      await expect(readFile(path.join(outDir, 'c/cart.client.js'), 'utf8')).resolves.toBe(
        'export const cart = "absolute-build";',
      );
      await expect(readFile(path.join(outDir, 'c/menu.client.js'), 'utf8')).resolves.toBe(
        'export const menu = "absolute-build";',
      );
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('rejects referenced client modules that replay to non-JavaScript before writing files', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-'));
    try {
      const app = createApp({
        clientModules: {
          buildToken() {
            return '';
          },
          entries() {
            return [];
          },
          put() {
            throw new Error('unused');
          },
          resolve() {
            return {
              body: '<!doctype html><h1>Wrong handler</h1>',
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
              status: 200,
            };
          },
        },
        routes: [
          route('/', {
            modulepreloads: ['/c/cart.client.js?v=cart-1'],
            page: () => '<main>Home</main>',
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
      const app = createApp({
        clientModules: {
          buildToken() {
            return '';
          },
          entries() {
            return [];
          },
          put() {
            throw new Error('unused');
          },
          resolve() {
            return {
              body: 'export const unsafe = true;',
              headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
              status: 200,
            };
          },
        },
        routes: [
          route('/unsafe', {
            modulepreloads: [badHref],
            page: () => '<main>Unsafe module path</main>',
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
