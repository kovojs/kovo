import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import * as packageBuildApi from '@kovojs/server/build';
import { createApp } from './app.js';
import { route } from './route.js';
import { node, writeKovoNeutralBuild } from './build.js';

describe('server build-time deployment API', () => {
  it('exposes the build subpath without promoting it to the runtime root', () => {
    expect(packageBuildApi.node).toBe(node);
    expect(packageBuildApi.writeKovoNeutralBuild).toBe(writeKovoNeutralBuild);
    expect(node()).toMatchObject({ name: 'node', options: {} });
    expect(node({ dockerfile: false })).toMatchObject({
      name: 'node',
      options: { dockerfile: false },
    });
  });

  it('writes a deterministic neutral build layout from app-shell build inputs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-neutral-build-'));

    try {
      const distDir = join(root, 'dist');
      await mkdir(join(distDir, '.vite'), { recursive: true });
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'assets/cart.css'), '.cart { color: green; }');
      await writeFile(join(distDir, 'assets/cart.js'), 'export const asset = true;');
      await writeFile(
        join(distDir, '.vite/manifest.json'),
        JSON.stringify({
          'src/cart.client.ts': {
            css: ['assets/cart.css'],
            file: 'assets/cart.js',
          },
        }),
      );

      const outDir = join(root, 'dist', '.kovo');
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/cart', {
              page() {
                return '<main>Cart</main>';
              },
            }),
          ],
        }),
        clientModules: [
          {
            path: '/c/cart.client.js',
            source: 'export const cart = true;',
            version: 'cart-v1',
          },
        ],
        manifestFile: join(distDir, '.vite/manifest.json'),
        outDir,
        routeEntryMap: {
          '/cart': 'src/cart.client.ts',
        },
        serverHandlerSource:
          'export default async function handler() { return new Response("ok"); }\n',
      });

      await expect(readFile(join(outDir, 'client/c/cart.client.js'), 'utf8')).resolves.toBe(
        'export const cart = true;',
      );
      await expect(readFile(join(outDir, 'client/assets/cart.css'), 'utf8')).resolves.toBe(
        '.cart { color: green; }',
      );
      await expect(readFile(join(outDir, 'client/assets/cart.js'), 'utf8')).resolves.toBe(
        'export const asset = true;',
      );
      await expect(readFile(join(outDir, 'server/handler.mjs'), 'utf8')).resolves.toBe(
        'export default async function handler() { return new Response("ok"); }\n',
      );
      await expect(readJson(join(outDir, 'manifest.json'))).resolves.toEqual({
        assets: [
          { file: 'assets/cart.css', href: '/assets/cart.css', path: '/assets/cart.css' },
          { file: 'assets/cart.js', href: '/assets/cart.js', path: '/assets/cart.js' },
        ],
        clientModules: [
          {
            file: 'c/cart.client.js',
            href: '/c/cart.client.js?v=cart-v1',
            path: '/c/cart.client.js',
            version: 'cart-v1',
          },
        ],
        routeHints: [
          {
            hints: {
              modulepreloads: ['/assets/cart.js'],
              stylesheets: ['/assets/cart.css'],
            },
            routePath: '/cart',
          },
        ],
        version: 'kovo-neutral-build/v1',
      });
      await expect(readJson(join(outDir, 'routes.json'))).resolves.toEqual({
        routes: [{ path: '/cart' }],
        version: 'kovo-neutral-build/v1',
      });
      await expect(readJson(join(outDir, 'meta.json'))).resolves.toEqual({
        hasServerHandler: true,
        version: 'kovo-neutral-build/v1',
      });
      expect(build).toMatchObject({
        clientModules: [{ href: '/c/cart.client.js?v=cart-v1' }],
        outDir,
        routeHints: [{ routePath: '/cart' }],
        serverHandlerPath: join(outDir, 'server/handler.mjs'),
        version: 'kovo-neutral-build/v1',
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('emits a standalone node server that serves immutable client files before route fallback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-node-preset-'));

    try {
      const distDir = join(root, 'dist');
      await mkdir(join(distDir, '.vite'), { recursive: true });
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'assets/cart.css'), 'body { color: navy; }');
      await writeFile(
        join(distDir, '.vite/manifest.json'),
        JSON.stringify({
          'src/cart.client.ts': {
            css: ['assets/cart.css'],
            file: 'assets/cart.js',
          },
        }),
      );
      await writeFile(join(distDir, 'assets/cart.js'), 'export const viteAsset = true;');

      const neutralDir = join(root, 'dist', '.kovo');
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/hello', {
              page() {
                return '<main>Hello</main>';
              },
            }),
          ],
        }),
        clientModules: [
          {
            path: '/c/cart.client.js',
            source: 'export const cart = true;',
            version: 'cart-v1',
          },
        ],
        manifestFile: join(distDir, '.vite/manifest.json'),
        outDir: neutralDir,
        routeEntryMap: {
          '/hello': 'src/cart.client.ts',
        },
        serverHandlerSource: `
export default async function handler(request) {
  const url = new URL(request.url);
  return new Response('route:' + url.pathname + ':' + request.headers.get('x-from-test'), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
`,
      });

      const logs: string[] = [];
      const nodeOutDir = join(root, 'node-output');
      await node({ dockerfile: false }).emit(build, {
        declaredEnv: [],
        log(message) {
          logs.push(message);
        },
        outDir: nodeOutDir,
        readNeutral() {
          return build;
        },
      });

      await expect(readFile(join(nodeOutDir, 'Dockerfile'))).rejects.toThrow();
      expect(logs).toEqual([`Emitted Kovo node preset output to ${nodeOutDir}`]);

      const serverModule = (await import(pathToFileURL(join(nodeOutDir, 'server.mjs')).href)) as {
        createKovoNodeServer(): Server;
      };
      const server = serverModule.createKovoNodeServer();
      const baseUrl = await listen(server);

      try {
        const routeResponse = await fetch(`${baseUrl}/hello?cart=1`, {
          headers: { 'x-from-test': 'route-header' },
        });
        await expect(routeResponse.text()).resolves.toBe('route:/hello:route-header');
        expect(routeResponse.headers.get('content-type')).toBe('text/plain; charset=utf-8');

        const clientModuleResponse = await fetch(`${baseUrl}/c/cart.client.js?v=cart-v1`);
        await expect(clientModuleResponse.text()).resolves.toBe('export const cart = true;');
        expect(clientModuleResponse.headers.get('cache-control')).toBe(
          'public, max-age=31536000, immutable',
        );
        expect(clientModuleResponse.headers.get('content-type')).toBe(
          'text/javascript; charset=utf-8',
        );

        const assetResponse = await fetch(`${baseUrl}/assets/cart.css`);
        await expect(assetResponse.text()).resolves.toBe('body { color: navy; }');
        expect(assetResponse.headers.get('cache-control')).toBe(
          'public, max-age=31536000, immutable',
        );
        expect(assetResponse.headers.get('content-type')).toBe('text/css; charset=utf-8');
      } finally {
        await close(server);
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('emits a minimal Dockerfile for the node preset by default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-node-preset-dockerfile-'));

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/', {
              page() {
                return '<main>Home</main>';
              },
            }),
          ],
        }),
        outDir: join(root, '.kovo'),
        serverHandlerSource:
          'export default async function handler() { return new Response("ok"); }\n',
      });
      const nodeOutDir = join(root, 'node-output');

      await node().emit(build, {
        declaredEnv: [],
        log() {},
        outDir: nodeOutDir,
        readNeutral() {
          return build;
        },
      });

      await expect(readFile(join(nodeOutDir, 'Dockerfile'), 'utf8')).resolves.toContain(
        'CMD ["node", "server.mjs"]',
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected node preset test server to listen on an ephemeral port.');
  }

  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
