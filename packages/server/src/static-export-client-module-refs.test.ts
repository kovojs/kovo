import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';
import { trustedHtml } from '@kovojs/browser';
import {
  kovoDeferredRuntimeModulePath,
  kovoDeferredRuntimeModuleSource,
} from '@kovojs/browser/internal/inline-loader';
import { clientModuleRepresentationDigest } from '@kovojs/core/internal/client-module-url';

import { createApp, createRequestHandler } from './app.js';
import {
  createMemoryVersionedClientModuleRegistry,
  versionedClientModuleHref,
  type VersionedClientModuleInput,
  type VersionedClientModuleStore,
} from './client-modules.js';
import { route } from './route.js';
import { exportStaticApp } from './static-export.js';

const runtimeClientModuleHref = versionedClientModuleHref(
  kovoDeferredRuntimeModulePath,
  clientModuleRepresentationDigest(kovoDeferredRuntimeModuleSource),
);
const runtimeClientModuleArtifact = expect.objectContaining({
  href: runtimeClientModuleHref,
  path: runtimeClientModuleHref,
  status: 200,
});

const clientModuleHref = (module: VersionedClientModuleInput): string =>
  versionedClientModuleHref(module.path, clientModuleRepresentationDigest(module.source));

describe('server static export', () => {
  it('discovers referenced client modules without requiring an output directory', async () => {
    const registry = createMemoryVersionedClientModuleRegistry();
    const cartHref = registry.put({
      path: '/c/cart.client.js',
      source: 'export const cart = "dry-run";',
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
          'x-content-type-options': 'nosniff',
        },
        href: `${cartHref}#Cart$add`,
        path: cartHref,
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
      });
      const menuHref = registry.put({
        path: '/c/menu.client.js',
        source: 'export const menu = "build-1";',
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
      const referencedHrefs = [cartHref, `${menuHref}#Menu$open`].sort();

      expect(result.clientModules.map((artifact) => artifact.href)).toEqual([
        ...referencedHrefs,
        runtimeClientModuleHref,
      ]);
      expect(result.clientModules.map((artifact) => artifact.path)).toEqual([
        ...referencedHrefs.map((href) => href.split('#', 1)[0]),
        runtimeClientModuleHref,
      ]);

      const cartResponse = await handler(new Request(`https://kovo.local${cartHref}`));
      const menuResponse = await handler(new Request(`https://kovo.local${menuHref}`));
      await expect(
        readFile(path.join(outDir, cartHref.slice(1)), 'utf8'),
      ).resolves.toBe(await cartResponse.text());
      await expect(
        readFile(path.join(outDir, menuHref.slice(1)), 'utf8'),
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
    });
    const privateHref = registry.put({
      path: '/c/private-admin.client.js',
      source: 'export const serverOnlyAdminToken = "internal-build-token";',
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
        publicHref,
        runtimeClientModuleHref,
      ]);
      expect(result.clientModules.map((artifact) => artifact.body)).not.toContain(
        'export const serverOnlyAdminToken = "internal-build-token";',
      );
      await expect(
        readFile(path.join(outDir, privateHref.slice(1)), 'utf8'),
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
      });
      const menuHref = registry.put({
        path: '/c/menu.client.js',
        source: 'export const menu = "absolute-build";',
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
      const referencedHrefs = [cartHref, `${menuHref}#Menu$open`].sort();

      expect(result.clientModules.map((artifact) => artifact.href)).toEqual([
        ...referencedHrefs,
        runtimeClientModuleHref,
      ]);
      await expect(
        readFile(path.join(outDir, cartHref.slice(1)), 'utf8'),
      ).resolves.toBe('export const cart = "absolute-build";');
      await expect(
        readFile(path.join(outDir, menuHref.slice(1)), 'utf8'),
      ).resolves.toBe('export const menu = "absolute-build";');
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('rejects referenced client modules that replay to non-JavaScript before writing files', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-'));
    try {
      const cartModule = {
        path: '/c/cart.client.js',
        source: 'export const cart = "wrong-content-type";',
      };
      const cartHref = clientModuleHref(cartModule);
      const retained = new Map<string, VersionedClientModuleInput>([
        [cartHref, cartModule],
      ]);
      const clientModules: VersionedClientModuleStore = {
        entries() {
          return [cartModule];
        },
        put(module) {
          const href = clientModuleHref(module);
          retained.set(href, { path: module.path, source: module.source });
          return href;
        },
        resolve(href) {
          const module = retained.get(href);
          if (module === undefined) {
            return {
              body: 'Not Found',
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
              status: 404,
            };
          }
          return {
            body: module.source,
            headers: {
              'Content-Type':
                href === cartHref
                  ? 'text/html; charset=utf-8'
                  : 'text/javascript; charset=utf-8',
            },
            status: 200,
          };
        },
      };
      const app = createApp({
        clientModules,
        routes: [
          route('/', {
            modulepreloads: [cartHref],
            page: () => trustedHtml('<main>Home</main>'),
          }),
        ],
      });

      expect(() => app.clientModules.resolve(cartHref)).toThrow(
        'Client-module store returned non-canonical representation metadata.',
      );

      await expect(exportStaticApp(app, { outDir })).rejects.toMatchObject({
        code: 'KV229',
        diagnostics: [
          {
            code: 'KV229',
            message: expect.stringContaining(
              `client module '${cartHref}' because the app handler returned status 404 with Content-Type 'text/plain; charset=utf-8'`,
            ),
            routePath: cartHref,
          },
        ],
      });
      await expect(readFile(path.join(outDir, 'index.html'))).rejects.toThrow();
      await expect(readFile(path.join(outDir, cartHref.slice(1)))).rejects.toThrow();
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('refuses unsafe client module output paths', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-'));
    try {
      const unsafeModule = {
        path: '/c/%2Fescape.client.js',
        source: 'export const unsafe = true;',
      };
      const badHref = clientModuleHref(unsafeModule);
      const retained = new Map<string, VersionedClientModuleInput>([
        [badHref, unsafeModule],
      ]);
      const clientModules: VersionedClientModuleStore = {
        entries() {
          return [unsafeModule];
        },
        put(module) {
          const href = clientModuleHref(module);
          retained.set(href, { path: module.path, source: module.source });
          return href;
        },
        resolve(href) {
          const module = retained.get(href);
          if (module === undefined) {
            return {
              body: 'Not Found',
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
              status: 404,
            };
          }
          return {
            body: module.source,
            headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
            status: 200,
          };
        },
      };
      const app = createApp({
        clientModules,
        routes: [
          route('/unsafe', {
            page: () =>
              trustedHtml(
                `<main>Unsafe module path<script type="module" src="${badHref}"></script></main>`,
              ),
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
