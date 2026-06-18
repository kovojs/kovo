import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
        serverHandlerSource: 'export default async function handler() { return new Response("ok"); }\n',
      });

      await expect(readFile(join(outDir, 'client/c/cart.client.js'), 'utf8')).resolves.toBe(
        'export const cart = true;',
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
});

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8'));
}
