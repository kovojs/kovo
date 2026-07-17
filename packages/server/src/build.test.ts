import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { Dirent } from 'node:fs';
import {
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import {
  request as nodeHttpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { connect as netConnect } from 'node:net';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import * as packageBuildApi from '@kovojs/server/build';
import { createApp, createRequestHandler } from './app.js';
import { resolveRequestClientIp } from './app-load-shed.js';
import { computeRenderPlanFingerprint } from './client-modules.js';
import { renderedHtml } from './html.js';
import { route } from './route.js';
import {
  cloudflare as cloudflareToken,
  node as nodeToken,
  vercel as vercelToken,
  type NodePresetOptions,
  type VercelPresetOptions,
} from './build.js';
import { resolveKovoBuildPreset, type KovoBuildPreset } from '@kovojs/server/internal/build-preset';
import { stylesheet, type StylesheetAsset } from './hints.js';
import { writeKovoNeutralBuild } from './neutral-build.js';
import {
  nodeRequestToWebRequest as liveNodeRequestToWebRequest,
  writeWebResponseToNode as liveWriteWebResponseToNode,
} from './node.js';
import { query } from './query.js';
import { s } from './schema.js';
import { task } from './api/data.js';
import { verifyCsrfRequestOriginFloor } from './csrf.js';
import { isTrustedSecureRequest } from './request-scheme.js';
import { MAX_REQUEST_QUERY_ENTRIES, MAX_REQUEST_URL_CHARACTERS } from './request-url-limits.js';

const runtimeClientModulePath = /^\/c\/__v\/[^/]+\/kovo-runtime\.client\.js$/;
const runtimeClientModuleFile = /^c\/__v\/[^/]+\/kovo-runtime\.client\.js$/;
const testRenderPlanFingerprint = computeRenderPlanFingerprint({
  test: 'field:id',
});

interface NodeAdapterModule {
  nodeRequestToWebRequest(
    request: IncomingMessage,
    options?: {
      origin?: string | ((request: IncomingMessage) => string);
      trustedProxy?: boolean;
    },
    response?: ServerResponse,
  ): Request;
  rejectInvalidNodeRequestAuthority(request: IncomingMessage, response: ServerResponse): boolean;
  rejectNodeRequestTargetLimit(request: IncomingMessage, response: ServerResponse): boolean;
  vercelRequestToWebRequest(request: IncomingMessage, response?: ServerResponse): Request;
  writeWebResponseToNode(
    response: Response,
    nodeResponse: ServerResponse,
    method?: string,
  ): Promise<void>;
}

function presetEngine(token: object): KovoBuildPreset {
  const preset = resolveKovoBuildPreset(token);
  if (preset === undefined) throw new TypeError('Expected a framework-owned build preset token.');
  return preset;
}

function node(...args: Parameters<typeof nodeToken>): KovoBuildPreset {
  return presetEngine(nodeToken(...args));
}

function vercel(...args: Parameters<typeof vercelToken>): KovoBuildPreset {
  return presetEngine(vercelToken(...args));
}

function cloudflare(...args: Parameters<typeof cloudflareToken>): KovoBuildPreset {
  return presetEngine(cloudflareToken(...args));
}

describe('server build-time deployment API', () => {
  it('exposes the build subpath without promoting it to the runtime root', () => {
    expect(packageBuildApi.cloudflare).toBe(cloudflareToken);
    expect(packageBuildApi.node).toBe(nodeToken);
    expect(packageBuildApi.vercel).toBe(vercelToken);
    expect(packageBuildApi).not.toHaveProperty('writeKovoNeutralBuild');
    const nodePreset = nodeToken();
    const vercelPreset = vercelToken({ maxDuration: 10, regions: ['iad1'] });
    const cloudflarePreset = cloudflareToken({
      compatibilityDate: '2026-06-18',
      name: 'kovo-test',
    });
    if (false) {
      // @ts-expect-error SPEC §5.2/§9.6: app-authored structural descriptors are not presets.
      packageBuildApi.defineConfig({ preset: { name: 'node' } });
      // @ts-expect-error Built-in preset authority is private and cannot be invoked from the token.
      void nodePreset.emit;
    }
    for (const token of [nodePreset, vercelPreset, cloudflarePreset]) {
      expect(Object.isFrozen(token)).toBe(true);
      expect(token).not.toHaveProperty('capabilities');
      expect(token).not.toHaveProperty('emit');
      expect(token).not.toHaveProperty('inspect');
      expect(token).not.toHaveProperty('name');
      expect(Reflect.ownKeys(token)).toHaveLength(1);
      expect(typeof Reflect.ownKeys(token)[0]).toBe('symbol');
    }
    expect(presetEngine(nodePreset)).toMatchObject({
      capabilities: { jobRunner: { adapter: 'node-in-process', mode: 'serve-and-run' } },
      name: 'node',
    });
    expect(presetEngine(vercelPreset).name).toBe('vercel');
    expect(presetEngine(cloudflarePreset).name).toBe('cloudflare');
    expect(node({ jobRunner: false }).capabilities).toBeUndefined();
    expect(node({ jobRunner: false }).name).toBe('node');
    expect(
      presetEngine(
        nodeToken({
          retention: {
            hours: 24,
            immutableClientModules: 'retained',
            priorTokenQueryReads: 'retained',
          },
        }),
      ),
    ).toMatchObject({ name: 'node' });
  });

  it('rejects symlinked built-in preset roots and destination parents without writing outside', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-preset-output-boundary-'));

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/dynamic', {
              guard: () => true,
              page: () => renderedHtml('<main>Dynamic</main>'),
            }),
          ],
        }),
        outDir: join(root, '.kovo'),
        serverHandlerSource:
          'export default async function handler() { return new Response("safe"); }\n',
      });
      const cases = [
        { parent: 'client', preset: node({ dockerfile: false }), name: 'node' },
        { parent: 'functions', preset: vercel(), name: 'vercel' },
        {
          parent: 'server',
          preset: cloudflare({ compatibilityDate: '2026-06-18', name: 'boundary-test' }),
          name: 'cloudflare',
        },
      ] as const;

      for (const entry of cases) {
        const rootOutside = join(root, `${entry.name}-root-outside`);
        const linkedRoot = join(root, `${entry.name}-linked-root`);
        await mkdir(rootOutside);
        await symlink(rootOutside, linkedRoot, 'dir');
        await expect(
          entry.preset.emit!(build, {
            declaredEnv: [],
            log() {},
            outDir: linkedRoot,
            readNeutral: () => build,
          }),
        ).rejects.toThrow(/(?:symbolic-link|not a directory|cannot use)/u);
        await expect(readdir(rootOutside)).resolves.toEqual([]);

        const parentOutside = join(root, `${entry.name}-parent-outside`);
        const parentRoot = join(root, `${entry.name}-parent-root`);
        await mkdir(parentOutside);
        await mkdir(parentRoot);
        await symlink(parentOutside, join(parentRoot, entry.parent), 'dir');
        await expect(
          entry.preset.emit!(build, {
            declaredEnv: [],
            log() {},
            outDir: parentRoot,
            readNeutral: () => build,
          }),
        ).rejects.toThrow(/(?:symbolic link|symbolic-link|output parent|cannot write)/u);
        await expect(readdir(parentOutside)).resolves.toEqual([]);
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('rejects a symlinked neutral-build output root without writing outside', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-neutral-output-boundary-'));
    const outside = join(root, 'outside');
    const outDir = join(root, 'linked-output');
    await mkdir(outside);
    await symlink(outside, outDir, 'dir');

    try {
      await expect(
        writeKovoNeutralBuild({
          app: createApp({ routes: [] }),
          outDir,
          serverHandlerSource: 'export default function handler() {}\n',
        }),
      ).rejects.toThrow(/symbolic-link|symbolic link|cannot use/u);
      await expect(readdir(outside)).resolves.toEqual([]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('writes a deterministic neutral build layout from app-shell build inputs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-neutral-build-'));

    try {
      const distDir = join(root, 'dist');
      await mkdir(join(distDir, '.vite'), { recursive: true });
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'assets/cart.css'), '.cart { color: green; }');
      await writeFile(join(distDir, 'assets/cart.js'), 'export const asset = true;');
      await writeFile(join(distDir, 'logo.svg'), '<svg viewBox="0 0 1 1"></svg>');
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
                return renderedHtml(
                  '<main>Cart <img src="/logo.svg" alt=""> <button on:click="/c/__v/cart-v1/cart.client.js#Cart$click">Click</button></main>',
                );
              },
            }),
          ],
        }),
        clientModules: [
          {
            path: '/c/cart.client.js',
            renderPlanFingerprint: testRenderPlanFingerprint,
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

      await expect(
        readFile(join(outDir, 'client/c/__v/cart-v1/cart.client.js'), 'utf8'),
      ).resolves.toBe('export const cart = true;');
      await expect(readFile(join(outDir, 'client/assets/cart.css'), 'utf8')).resolves.toBe(
        '.cart { color: green; }',
      );
      await expect(readFile(join(outDir, 'client/assets/cart.js'), 'utf8')).resolves.toBe(
        'export const asset = true;',
      );
      await expect(readFile(join(outDir, 'server/handler.mjs'), 'utf8')).resolves.toBe(
        'export default async function handler() { return new Response("ok"); }\n',
      );
      await expect(readFile(join(outDir, 'static/cart/index.html'), 'utf8')).resolves.toContain(
        '<img src="/logo.svg"',
      );
      await expect(
        readFile(join(outDir, 'static/c/__v/cart-v1/cart.client.js'), 'utf8'),
      ).resolves.toBe('export const cart = true;');
      await expect(readFile(join(outDir, 'static/logo.svg'), 'utf8')).resolves.toBe(
        '<svg viewBox="0 0 1 1"></svg>',
      );
      await expect(readFile(join(outDir, 'static/assets/cart.css'), 'utf8')).resolves.toBe(
        '.cart { color: green; }',
      );
      await expect(readJson(join(outDir, 'manifest.json'))).resolves.toEqual({
        assets: [
          { file: 'assets/cart.css', href: '/assets/cart.css', path: '/assets/cart.css' },
          { file: 'assets/cart.js', href: '/assets/cart.js', path: '/assets/cart.js' },
        ],
        clientModules: [
          {
            file: 'c/__v/cart-v1/cart.client.js',
            href: '/c/__v/cart-v1/cart.client.js',
            path: '/c/__v/cart-v1/cart.client.js',
            version: 'cart-v1',
          },
          {
            file: expect.stringMatching(runtimeClientModuleFile),
            href: expect.stringMatching(runtimeClientModulePath),
            path: expect.stringMatching(runtimeClientModulePath),
            version: expect.stringMatching(/^[a-f0-9]+$/),
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
        tasks: [],
        version: 'kovo-neutral-build/v1',
      });
      await expect(readJson(join(outDir, 'routes.json'))).resolves.toEqual({
        routes: [
          {
            export: {
              paths: ['/cart'],
              policy: 'static',
            },
            path: '/cart',
          },
        ],
        version: 'kovo-neutral-build/v1',
      });
      await expect(readJson(join(outDir, 'meta.json'))).resolves.toEqual({
        hasServerHandler: true,
        staticOnly: true,
        tasks: [],
        version: 'kovo-neutral-build/v1',
      });
      expect(build).toMatchObject({
        clientModules: [
          { href: '/c/__v/cart-v1/cart.client.js' },
          {
            file: expect.stringMatching(runtimeClientModuleFile),
            href: expect.stringMatching(runtimeClientModulePath),
            path: expect.stringMatching(runtimeClientModulePath),
            version: expect.stringMatching(/^[a-f0-9]+$/),
          },
        ],
        outDir,
        routeHints: [{ routePath: '/cart' }],
        serverHandlerPath: join(outDir, 'server/handler.mjs'),
        staticOutput: {
          complete: true,
          dir: join(outDir, 'static'),
          manifestPath: join(outDir, 'static/kovo-static-manifest.json'),
          routeDocuments: [{ path: '/cart', routePath: '/cart' }],
        },
        staticOnly: true,
        tasks: [],
        version: 'kovo-neutral-build/v1',
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('materializes declared and build-owned CSS into neutral stylesheet assets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-neutral-build-css-'));

    try {
      const distDir = join(root, 'dist');
      await mkdir(join(distDir, '.vite'), { recursive: true });
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'assets/styles.css'), 'main { color: rebeccapurple; }\n');
      await writeFile(
        join(distDir, '.vite/manifest.json'),
        JSON.stringify({
          'src/app.ts': {
            css: ['assets/styles.css'],
            file: 'assets/app.js',
          },
        }),
      );
      await writeFile(join(distDir, 'assets/app.js'), 'export const app = true;');

      const appStylesheet = stylesheet('./styles.css', {
        criticalCss: ':root{--brand:teal}',
      });
      const routeStylesheet = stylesheet('./route.css', {
        criticalCss: '.route-shell{display:grid}',
      });
      const outDir = join(root, 'dist', '.kovo');
      await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/', {
              page() {
                return renderedHtml('<main class="route-shell">Home</main>');
              },
              stylesheets: [routeStylesheet],
            }),
          ],
          stylesheets: [appStylesheet],
        }),
        buildStylesheetCss: [
          { css: '.kovo-ui-button{display:inline-flex}', href: '/assets/styles.css' },
          { css: '.route-card{color:teal}', href: '/assets/routes/index.css' },
        ],
        manifestFile: join(distDir, '.vite/manifest.json'),
        outDir,
      });

      const builtStyles = await readFile(join(outDir, 'client/assets/styles.css'), 'utf8');
      expect(builtStyles).toContain(':root{--brand:teal}');
      expect(builtStyles).toContain('.kovo-ui-button{display:inline-flex}');
      expect(builtStyles).toContain('main { color: rebeccapurple; }');
      await expect(readFile(join(outDir, 'client/assets/route.css'), 'utf8')).resolves.toBe(
        '.route-shell{display:grid}\n',
      );
      await expect(readFile(join(outDir, 'client/assets/routes/index.css'), 'utf8')).resolves.toBe(
        '.route-card{color:teal}\n',
      );

      await expect(readFile(join(outDir, 'static/assets/route.css'), 'utf8')).resolves.toBe(
        '.route-shell{display:grid}\n',
      );
      await expect(readFile(join(outDir, 'static/assets/routes/index.css'), 'utf8')).resolves.toBe(
        '.route-card{color:teal}\n',
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('C218 keeps post-replay static stylesheet bytes authoritative after late intrinsic replacement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-neutral-build-css-push-'));
    const originalPush = Array.prototype.push;
    const originalIterator = Array.prototype[Symbol.iterator];
    const originalJoin = Array.prototype.join;
    const originalMapGet = Map.prototype.get;
    const originalMapSet = Map.prototype.set;
    const originalTrim = String.prototype.trim;
    const NativeURL = globalThis.URL;
    const approvedCss = '.public-shell{display:block}';
    const buildOwnedCss = '.framework-owned{color:teal}';
    const attackerCss = '@import url("https://attacker.invalid/cross-route.css");';

    try {
      const outDir = join(root, 'dist', '.kovo');
      const app = createApp({
        routes: [
          route('/poison', {
            page() {
              Array.prototype.push = function (...items) {
                if (items[0] === approvedCss) items[0] = attackerCss;
                return Reflect.apply(originalPush, this, items);
              } as typeof Array.prototype.push;
              Array.prototype[Symbol.iterator] = function () {
                const first = this[0] as { css?: unknown } | undefined;
                return Reflect.apply(
                  originalIterator,
                  first?.css === buildOwnedCss
                    ? [
                        {
                          css: attackerCss,
                          href: '/assets/styles.css',
                        },
                      ]
                    : this,
                  [],
                );
              } as (typeof Array.prototype)[Symbol.iterator];
              Array.prototype.join = function (separator) {
                if (this[0] === approvedCss) return attackerCss;
                return Reflect.apply(originalJoin, this, [separator]);
              } as typeof Array.prototype.join;
              Map.prototype.get = function (key: unknown) {
                const value = Reflect.apply(originalMapGet, this, [key]);
                if (
                  key === '/assets/styles.css' &&
                  Array.isArray(value) &&
                  value[0] === approvedCss
                ) {
                  return [attackerCss];
                }
                return value;
              } as typeof Map.prototype.get;
              Map.prototype.set = function (key: unknown, value: unknown) {
                return Reflect.apply(originalMapSet, this, [
                  key,
                  key === '/assets/styles.css' && Array.isArray(value) ? [attackerCss] : value,
                ]);
              } as typeof Map.prototype.set;
              String.prototype.trim = function () {
                const value = Reflect.apply(originalTrim, this, []);
                return value === approvedCss ? attackerCss : value;
              };
              globalThis.URL = class CrossBindStylesheetUrl extends NativeURL {
                constructor(input: string | URL, base?: string | URL) {
                  super(input === '/assets/styles.css' ? '/assets/cross-route.css' : input, base);
                }
              } as typeof URL;
              return renderedHtml('<main>Poison setup</main>');
            },
          }),
          route('/public', {
            page: () => renderedHtml('<main class="public-shell">Public</main>'),
          }),
        ],
        stylesheets: [stylesheet('./styles.css', { criticalCss: approvedCss })],
      });

      await writeKovoNeutralBuild({
        app,
        buildStylesheetCss: [{ css: buildOwnedCss, href: '/assets/styles.css' }],
        outDir,
      });

      const clientCss = await readFile(join(outDir, 'client/assets/styles.css'), 'utf8');
      const staticCss = await readFile(join(outDir, 'static/assets/styles.css'), 'utf8');
      const publicHtml = await readFile(join(outDir, 'static/public/index.html'), 'utf8');
      expect(clientCss).toContain(approvedCss);
      expect(clientCss).toContain(buildOwnedCss);
      expect(clientCss).not.toContain(attackerCss);
      expect(publicHtml).toContain('<link rel="stylesheet" href="/assets/styles.css">');
      expect(staticCss).toContain(approvedCss);
      expect(staticCss).toContain(buildOwnedCss);
      expect(staticCss).not.toContain(attackerCss);
    } finally {
      globalThis.URL = NativeURL;
      String.prototype.trim = originalTrim;
      Map.prototype.set = originalMapSet;
      Map.prototype.get = originalMapGet;
      Array.prototype.join = originalJoin;
      Array.prototype[Symbol.iterator] = originalIterator;
      Array.prototype.push = originalPush;
      await rm(root, { force: true, recursive: true });
    }
  });

  it('C223 does not publish symlinked external secrets after late Dirent replacement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-neutral-public-symlink-'));
    const originalIsFile = Dirent.prototype.isFile;

    try {
      const distDir = join(root, 'dist');
      await mkdir(join(distDir, '.vite'), { recursive: true });
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'assets/app.js'), 'export const app = true;');
      await writeFile(
        join(distDir, '.vite/manifest.json'),
        JSON.stringify({
          'src/app.ts': {
            file: 'assets/app.js',
          },
        }),
      );
      const externalSecret = join(root, 'server-secret.env');
      await writeFile(externalSecret, 'KOVO_SERVER_SECRET=must-not-publish\n', 'utf8');
      await symlink(externalSecret, join(distDir, 'public-note.txt'));

      const app = createApp({
        routes: [
          route('/poison', {
            page() {
              Dirent.prototype.isFile = function () {
                if (this.name === 'public-note.txt') return true;
                return Reflect.apply(originalIsFile, this, []);
              };
              return renderedHtml('<main>Poison setup</main>');
            },
          }),
          route('/public', {
            page: () => renderedHtml('<main>Public</main>'),
          }),
        ],
      });
      const outDir = join(root, '.kovo');

      await expect(
        writeKovoNeutralBuild({
          app,
          manifestFile: join(distDir, '.vite/manifest.json'),
          outDir,
        }),
      ).rejects.toThrow(/symlinks and non-regular filesystem entries are not publishable/u);

      await expect(readFile(join(outDir, 'public/public-note.txt'), 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await expect(readFile(externalSecret, 'utf8')).resolves.toBe(
        'KOVO_SERVER_SECRET=must-not-publish\n',
      );
    } finally {
      Dirent.prototype.isFile = originalIsFile;
      await rm(root, { force: true, recursive: true });
    }
  });

  it('materializes local stylesheet source files declared by an app module', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-neutral-build-local-css-'));

    try {
      const srcDir = join(root, 'src');
      await mkdir(srcDir, { recursive: true });
      await writeFile(join(srcDir, 'local.css'), '.local-source { color: teal; }\n', 'utf8');
      const serverEntry = pathToFileURL(join(process.cwd(), 'packages/server/src/index.ts')).href;
      const appModule = join(srcDir, 'app.mjs');
      await writeFile(
        appModule,
        [
          `import { createApp, route, stylesheet, trustedHtml } from ${JSON.stringify(serverEntry)};`,
          'export const app = createApp({',
          '  routes: [',
          "    route('/', {",
          "      stylesheets: [stylesheet('./local.css')],",
          '      page: () => trustedHtml(\'<main class="local-source">Home</main>\'),',
          '    }),',
          '  ],',
          '});',
          '',
        ].join('\n'),
        'utf8',
      );
      const { app } = (await import(`${pathToFileURL(appModule).href}?t=${Date.now()}`)) as {
        app: ReturnType<typeof createApp>;
      };
      const outDir = join(root, 'dist', '.kovo');

      await writeKovoNeutralBuild({ app, outDir });

      await expect(readFile(join(outDir, 'client/assets/local.css'), 'utf8')).resolves.toBe(
        '.local-source { color: teal; }\n',
      );
      await expect(readFile(join(outDir, 'static/assets/local.css'), 'utf8')).resolves.toBe(
        '.local-source { color: teal; }\n',
      );
      await expect(readFile(join(outDir, 'static/index.html'), 'utf8')).resolves.toContain(
        'href="/assets/local.css"',
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('does not materialize local stylesheet sources from forged symbols', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-neutral-build-forged-css-'));

    try {
      const srcDir = join(root, 'src');
      const outDir = join(root, 'dist', '.kovo');
      await mkdir(srcDir, { recursive: true });
      await writeFile(join(srcDir, 'secret.css'), '.secret { color: red; }\n', 'utf8');
      const forgedStylesheet = {
        href: '/assets/forged.css',
        [Symbol.for('kovo.stylesheet.source')]: join(srcDir, 'secret.css'),
        [Symbol.for('kovo.stylesheet.sourcePath')]: './secret.css',
      } as StylesheetAsset;

      await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/', {
              page: () => renderedHtml('<main>Home</main>'),
              stylesheets: [forgedStylesheet],
            }),
          ],
        }),
        outDir,
        stylesheetSourceRoot: srcDir,
      });

      await expect(readFile(join(outDir, 'client/assets/forged.css'), 'utf8')).rejects.toThrow();
      await expect(readFile(join(outDir, 'static/assets/forged.css'), 'utf8')).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('rejects stylesheetSourceRoot fallback paths outside the configured root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-neutral-build-css-root-'));

    try {
      const srcDir = join(root, 'src');
      await mkdir(srcDir, { recursive: true });
      await writeFile(join(root, 'outside.css'), '.outside { color: red; }\n', 'utf8');
      const escapedStylesheet = withNoStylesheetCallerFile(() => stylesheet('../outside.css'));

      await expect(
        writeKovoNeutralBuild({
          app: createApp({
            routes: [
              route('/', {
                page: () => renderedHtml('<main>Home</main>'),
                stylesheets: [escapedStylesheet],
              }),
            ],
          }),
          outDir: join(root, 'dist', '.kovo'),
          stylesheetSourceRoot: srcDir,
        }),
      ).rejects.toThrow('outside stylesheetSourceRoot');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('fails neutral builds before shipping missing local stylesheet links', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-neutral-build-missing-css-'));

    try {
      const srcDir = join(root, 'src');
      await mkdir(srcDir, { recursive: true });
      const serverEntry = pathToFileURL(join(process.cwd(), 'packages/server/src/index.ts')).href;
      const appModule = join(srcDir, 'app.mjs');
      await writeFile(
        appModule,
        [
          `import { createApp, route, stylesheet, trustedHtml } from ${JSON.stringify(serverEntry)};`,
          'export const app = createApp({',
          '  routes: [',
          "    route('/', {",
          "      stylesheets: [stylesheet('./missing.css')],",
          "      page: () => trustedHtml('<main>Home</main>'),",
          '    }),',
          '  ],',
          '});',
          '',
        ].join('\n'),
        'utf8',
      );
      const { app } = (await import(`${pathToFileURL(appModule).href}?t=${Date.now()}`)) as {
        app: ReturnType<typeof createApp>;
      };

      await expect(
        writeKovoNeutralBuild({ app, outDir: join(root, 'dist', '.kovo') }),
      ).rejects.toThrow(
        "KV229 neutral build cannot materialize stylesheet '/assets/missing.css' from local source",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('overwrites stylesheet assets deterministically when rebuilding into a reused output dir', async () => {
    // M2 (bugs-part4 L12-1): the §14 retention design reuses the output dir, so a
    // 2nd+ build must recompute each stylesheet from current inputs. Previously
    // `materializeNeutralStylesheetAssets` folded the prior on-disk stylesheet back
    // in, so the second build retained stale rules and duplicated current ones.
    const root = await mkdtemp(join(tmpdir(), 'kovo-neutral-build-rebuild-'));

    try {
      const distDir = join(root, 'dist');
      await mkdir(join(distDir, '.vite'), { recursive: true });
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'assets/styles.css'), 'main{color:red}\n');
      await writeFile(
        join(distDir, '.vite/manifest.json'),
        JSON.stringify({
          'src/app.ts': {
            css: ['assets/styles.css'],
            file: 'assets/app.js',
          },
        }),
      );
      await writeFile(join(distDir, 'assets/app.js'), 'export const app = true;');

      const outDir = join(distDir, '.kovo');
      const buildApp = (criticalCss: string) =>
        createApp({
          routes: [
            route('/', {
              page() {
                return renderedHtml('<main>Home</main>');
              },
            }),
          ],
          stylesheets: [stylesheet('./styles.css', { criticalCss })],
        });
      // A build-owned-only stylesheet with no Vite asset to copy: this is the path
      // where `copyNeutralStaticAssets` does not overwrite the output before
      // materialization, so a stale-disk-read would retain prior rules.
      const ownedHref = '/assets/routes/index.css';

      // First build emits a multi-line stylesheet ("A\nB"): two critical rules and a
      // two-rule build-owned chunk.
      await writeKovoNeutralBuild({
        app: buildApp(':root{--brand:teal}\n.legacy{color:gray}'),
        buildStylesheetCss: [
          { css: '.btn{display:flex}', href: '/assets/styles.css' },
          { css: '.card{color:teal}\n.stale-card{color:gray}', href: ownedHref },
        ],
        manifestFile: join(distDir, '.vite/manifest.json'),
        outDir,
      });

      // Second build into the SAME output dir drops the legacy/stale rules ("A").
      await writeKovoNeutralBuild({
        app: buildApp(':root{--brand:teal}'),
        buildStylesheetCss: [
          { css: '.btn{display:flex}', href: '/assets/styles.css' },
          { css: '.card{color:teal}', href: ownedHref },
        ],
        manifestFile: join(distDir, '.vite/manifest.json'),
        outDir,
      });

      const secondVite = await readFile(join(outDir, 'client/assets/styles.css'), 'utf8');
      const secondOwned = await readFile(join(outDir, 'client', ownedHref.slice(1)), 'utf8');
      // Recomputed purely from current inputs: stale rules gone, no duplication.
      expect(secondVite).toBe(':root{--brand:teal}\n.btn{display:flex}\nmain{color:red}\n');
      expect(secondVite).not.toContain('.legacy{color:gray}');
      expect(secondOwned).toBe('.card{color:teal}\n');
      expect(secondOwned).not.toContain('.stale-card{color:gray}');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('AUD-007: emits KV417 when presets cannot prove deploy-skew retention support', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-client-retention-'));

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/', {
              page() {
                return renderedHtml('<main>Home</main>');
              },
            }),
          ],
        }),
        clientModules: [
          {
            path: '/c/app.client.js',
            renderPlanFingerprint: testRenderPlanFingerprint,
            source: 'export const app = true;',
            version: 'app-v1',
          },
        ],
        outDir: join(root, '.kovo'),
      });

      expect(node().inspect!(build, { declaredEnv: [] })).toEqual([
        clientModuleRetentionError('node'),
      ]);
      expect(vercel().inspect!(build, { declaredEnv: [] })).toEqual([
        clientModuleRetentionError('vercel'),
      ]);
      await expect(cloudflare().inspect!(build, { declaredEnv: [] })).resolves.toEqual([
        clientModuleRetentionError('cloudflare'),
      ]);

      // SPEC §14: the serving layer may configure a supported skew window upward, but not below the
      // 24-hour prior-version floor.
      const underFloorRetention = {
        hours: 23,
        immutableClientModules: 'retained' as const,
        priorTokenQueryReads: 'retained' as const,
      };
      expect(node({ retention: underFloorRetention }).inspect!(build, { declaredEnv: [] })).toEqual(
        [clientModuleRetentionError('node')],
      );
      expect(
        node({
          retention: {
            hours: 24,
            immutableClientModules: 'retained',
            priorTokenQueryReads: 'retained',
          },
        }).inspect!(build, { declaredEnv: [] }),
      ).toEqual([]);
      expect(
        vercel({
          retention: {
            hours: 48,
            immutableClientModules: 'retained',
            priorTokenQueryReads: 'retained',
          },
        }).inspect!(build, { declaredEnv: [] }),
      ).toEqual([]);
      await expect(
        cloudflare({
          retention: {
            hours: 24,
            immutableClientModules: 'retained',
            priorTokenQueryReads: 'retained',
          },
        }).inspect!(build, { declaredEnv: [] }),
      ).resolves.toEqual([]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('C202 keeps KV417 retention policy blocking after route-time Array.filter replacement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-client-retention-filter-'));
    const originalFilter = Array.prototype.filter;
    let poisonHits = 0;

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/', {
              page() {
                Array.prototype.filter = function omitVersionedClientModules(callback, thisArg) {
                  for (let index = 0; index < this.length; index += 1) {
                    const candidate = this[index] as { path?: unknown } | undefined;
                    if (
                      typeof candidate?.path === 'string' &&
                      candidate.path.startsWith('/c/__v/') &&
                      !candidate.path.endsWith('/kovo-runtime.client.js')
                    ) {
                      poisonHits += 1;
                      return [];
                    }
                  }
                  return Reflect.apply(originalFilter, this, [callback, thisArg]);
                } as typeof Array.prototype.filter;
                return renderedHtml('<main>Home</main>');
              },
            }),
          ],
        }),
        clientModules: [
          {
            path: '/c/app.client.js',
            renderPlanFingerprint: testRenderPlanFingerprint,
            source: 'export const app = true;',
            version: 'app-v1',
          },
        ],
        outDir: join(root, '.kovo'),
      });

      expect(node().inspect!(build, { declaredEnv: [] })).toEqual([
        clientModuleRetentionError('node'),
      ]);
      expect(poisonHits).toBe(0);
    } finally {
      Array.prototype.filter = originalFilter;
      await rm(root, { force: true, recursive: true });
    }
  });

  it('C205 keeps retention and JobRunner diagnostics after route-time iterator replacement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-preset-diagnostic-iterator-'));
    const originalIterator = Array.prototype[Symbol.iterator];
    let poisonHits = 0;

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/', {
              page() {
                Array.prototype[Symbol.iterator] = function omitPresetDiagnostics() {
                  const first = this[0] as { code?: unknown } | undefined;
                  if (first?.code === 'KV417' || first?.code === 'KV445') {
                    poisonHits += 1;
                    return Reflect.apply(originalIterator, [], []);
                  }
                  return Reflect.apply(originalIterator, this, []);
                } as (typeof Array.prototype)[Symbol.iterator];
                return renderedHtml('<main>Home</main>');
              },
            }),
          ],
        }),
        clientModules: [
          {
            path: '/c/app.client.js',
            renderPlanFingerprint: testRenderPlanFingerprint,
            source: 'export const app = true;',
            version: 'app-v1',
          },
        ],
        outDir: join(root, '.kovo'),
        serverHandlerSource: 'export default async () => new Response("ok");\n',
      });
      const inspectionBuild = { ...build, tasks: [{ key: 'receipt/send' }] };
      const expected = [
        clientModuleRetentionError('node'),
        missingJobRunnerError('node', 'receipt/send'),
      ];

      expect(node({ jobRunner: false }).inspect!(inspectionBuild, { declaredEnv: [] })).toEqual(
        expected,
      );
      expect(vercel().inspect!(inspectionBuild, { declaredEnv: [] })).toEqual([
        clientModuleRetentionError('vercel'),
        missingJobRunnerError('vercel', 'receipt/send'),
      ]);
      await expect(cloudflare().inspect!(inspectionBuild, { declaredEnv: [] })).resolves.toEqual([
        clientModuleRetentionError('cloudflare'),
        missingJobRunnerError('cloudflare', 'receipt/send'),
      ]);
      expect(poisonHits).toBe(0);
    } finally {
      Array.prototype[Symbol.iterator] = originalIterator;
      await rm(root, { force: true, recursive: true });
    }
  });

  it('C205 keeps missing-handler diagnostics after route-time Array.push replacement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-preset-diagnostic-push-'));
    const originalPush = Array.prototype.push;
    let poisonHits = 0;

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/', {
              page() {
                Array.prototype.push = function omitMissingHandler(...items) {
                  const first = items[0] as { code?: unknown } | undefined;
                  if (
                    first?.code === 'node-missing-handler' ||
                    first?.code === 'vercel-missing-handler' ||
                    first?.code === 'cloudflare-missing-handler'
                  ) {
                    poisonHits += 1;
                    return this.length;
                  }
                  return Reflect.apply(originalPush, this, items);
                } as typeof Array.prototype.push;
                return renderedHtml('<main>Home</main>');
              },
            }),
          ],
        }),
        outDir: join(root, '.kovo'),
      });
      const dynamicBuild = { ...build };
      delete dynamicBuild.serverHandlerPath;
      delete dynamicBuild.staticOutput;

      const nodeDiagnostics = node().inspect!(dynamicBuild, { declaredEnv: [] });
      const vercelDiagnostics = vercel().inspect!(dynamicBuild, { declaredEnv: [] });
      const cloudflareDiagnostics = await cloudflare().inspect!(dynamicBuild, { declaredEnv: [] });
      const poisonHitsAfterInspection = poisonHits;
      Array.prototype.push = originalPush;

      expect(nodeDiagnostics).toEqual([
        {
          code: 'node-missing-handler',
          message: 'The node preset requires a neutral build with server/handler.mjs.',
          severity: 'error',
        },
      ]);
      expect(vercelDiagnostics).toEqual([
        {
          code: 'vercel-missing-handler',
          message: 'The vercel preset requires a neutral build with server/handler.mjs.',
          severity: 'error',
        },
      ]);
      expect(cloudflareDiagnostics).toEqual([
        {
          code: 'cloudflare-missing-handler',
          message: 'The cloudflare preset requires a neutral build with server/handler.mjs.',
          severity: 'error',
        },
      ]);
      expect(poisonHitsAfterInspection).toBe(0);
    } finally {
      Array.prototype.push = originalPush;
      await rm(root, { force: true, recursive: true });
    }
  });

  it('fails closed when a task-using build targets a preset without a JobRunner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-task-preset-runner-'));
    const sendReceipt = task('receipt/send', {
      input: s.object({ orderId: s.string() }),
      async run() {},
    });

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/', {
              page() {
                return renderedHtml('<main>Home</main>');
              },
            }),
          ],
          tasks: [sendReceipt],
        }),
        outDir: join(root, '.kovo'),
        serverHandlerSource:
          'export default async function handler() { return new Response("ok"); }\n',
      });

      await expect(readJson(join(root, '.kovo/manifest.json'))).resolves.toMatchObject({
        tasks: [{ key: 'receipt/send' }],
      });
      await expect(readJson(join(root, '.kovo/meta.json'))).resolves.toMatchObject({
        tasks: [{ key: 'receipt/send' }],
      });
      expect(build.tasks).toEqual([{ key: 'receipt/send' }]);
      expect(node().inspect!(build, { declaredEnv: [] })).toEqual([]);
      expect(
        node().inspect!(build, {
          declaredEnv: [],
          readServerHandlerSource() {
            return "import { sqliteTable } from 'drizzle-orm/sqlite-core';\n";
          },
        }),
      ).toEqual([]);
      expect(
        node().inspect!(build, {
          declaredEnv: [],
          readServerHandlerSource() {
            return "import Database from 'better-sqlite3';\n";
          },
        }),
      ).toEqual([sqliteDurableTaskStoreError('node', 'receipt/send')]);
      await expect(
        node().inspect!(build, {
          declaredEnv: [],
          async readServerHandlerSource() {
            return "import Database from 'better-sqlite3';\n";
          },
        }),
      ).resolves.toEqual([sqliteDurableTaskStoreError('node', 'receipt/send')]);
      expect(node({ jobRunner: false }).inspect!(build, { declaredEnv: [] })).toEqual([
        missingJobRunnerError('node', 'receipt/send'),
      ]);
      expect(vercel().inspect!(build, { declaredEnv: [] })).toEqual([
        missingJobRunnerError('vercel', 'receipt/send'),
      ]);
      await expect(cloudflare().inspect!(build, { declaredEnv: [] })).resolves.toEqual([
        missingJobRunnerError('cloudflare', 'receipt/send'),
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('does not let late task traversal omit durable-task deployment authority', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-neutral-task-intrinsics-'));
    const sendReceipt = task('receipt/send', {
      input: s.object({ orderId: s.string() }),
      async run() {},
    });
    const app = createApp({
      routes: [
        route('/', {
          page() {
            return renderedHtml('<main>Home</main>');
          },
        }),
      ],
      tasks: [sendReceipt],
    });
    const originalMap = Array.prototype.map;
    let poisonHits = 0;

    try {
      Array.prototype.map = function omitDurableTasks(this: unknown, callback, thisArg) {
        if (this === app.tasks) {
          poisonHits += 1;
          return [];
        }
        return Reflect.apply(originalMap, this, [callback, thisArg]);
      } as typeof Array.prototype.map;

      const build = await writeKovoNeutralBuild({ app, outDir: join(root, '.kovo') });

      expect(build.tasks).toEqual([{ key: 'receipt/send' }]);
      expect(build.staticOnly).toBe(false);
      await expect(readJson(join(root, '.kovo/manifest.json'))).resolves.toMatchObject({
        tasks: [{ key: 'receipt/send' }],
      });
      await expect(readJson(join(root, '.kovo/meta.json'))).resolves.toMatchObject({
        staticOnly: false,
        tasks: [{ key: 'receipt/send' }],
      });
      expect(poisonHits).toBe(0);
    } finally {
      Array.prototype.map = originalMap;
      await rm(root, { force: true, recursive: true });
    }
  });

  it('C228 keeps durable-task metadata and dynamic preset authority after an inherited index setter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-neutral-task-index-setter-'));
    const originalZero = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    const originalLength = Object.getOwnPropertyDescriptor(Array.prototype, 'length');
    const nativeDefineProperty = Object.defineProperty;
    const sendReceipt = task('receipt/send', {
      input: s.object({ orderId: s.string() }),
      async run() {},
    });
    let poisonRuns = 0;
    let suppressedTaskCommits = 0;

    try {
      const app = createApp({
        db: () => ({
          async query(text: string) {
            if (text === 'select now() as now') {
              return { rows: [{ now: '2026-06-30T07:15:30.000Z' }] };
            }
            return { rowCount: 0, rows: [] };
          },
        }),
        routes: [
          route('/poison', {
            page() {
              poisonRuns += 1;
              nativeDefineProperty(Array.prototype, '0', {
                configurable: true,
                set(value: unknown) {
                  if (
                    typeof value === 'object' &&
                    value !== null &&
                    (value as { key?: unknown }).key === 'receipt/send'
                  ) {
                    suppressedTaskCommits += 1;
                    return;
                  }
                  nativeDefineProperty(this, '0', {
                    configurable: true,
                    enumerable: true,
                    value,
                    writable: true,
                  });
                },
              });
              return renderedHtml('<main>Poison setup</main>');
            },
          }),
        ],
        tasks: [sendReceipt],
      });
      const outDir = join(root, '.kovo');
      expect(app.diagnostics).toEqual([]);
      const build = await writeKovoNeutralBuild({
        app,
        outDir,
        serverHandlerSource:
          'export default async function handler() { return new Response("dynamic"); }\n',
      });
      expect(build).toMatchObject({
        staticOnly: false,
        tasks: [{ key: 'receipt/send' }],
      });
      expect(vercel({ jobRunner: false }).inspect!(build, { declaredEnv: [] })).toEqual([
        missingJobRunnerError('vercel', 'receipt/send'),
      ]);
      const vercelOutDir = join(root, '.vercel/output');
      await vercel().emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: vercelOutDir,
        readNeutral() {
          return build;
        },
      });
      const functionEmitted = await stat(join(vercelOutDir, 'functions/kovo.func/index.cjs')).then(
        () => true,
        () => false,
      );

      expect(functionEmitted).toBe(true);
      expect(poisonRuns).toBe(1);
      expect(build.tasks).toEqual([{ key: 'receipt/send' }]);
      expect(build.staticOnly).toBe(false);
      await expect(readJson(join(outDir, 'manifest.json'))).resolves.toMatchObject({
        tasks: [{ key: 'receipt/send' }],
      });
      await expect(readJson(join(outDir, 'meta.json'))).resolves.toMatchObject({
        staticOnly: false,
        tasks: [{ key: 'receipt/send' }],
      });
      expect(suppressedTaskCommits).toBe(0);
    } finally {
      if (originalZero === undefined) delete Array.prototype[0];
      else nativeDefineProperty(Array.prototype, '0', originalZero);
      if (originalLength !== undefined) {
        nativeDefineProperty(Array.prototype, 'length', originalLength);
      }
      await rm(root, { force: true, recursive: true });
    }
  });

  it('fails closed when node runner-only mode is selected before an emitted runner entrypoint exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-node-runner-only-'));

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/', {
              page() {
                return renderedHtml('<main>Home</main>');
              },
            }),
          ],
        }),
        outDir: join(root, '.kovo'),
        serverHandlerSource:
          'export default async function handler() { return new Response("ok"); }\n',
      });

      expect(
        node({ jobRunner: { mode: 'runner-only' } }).inspect!(build, { declaredEnv: [] }),
      ).toEqual([
        {
          code: 'node-runner-only-unsupported',
          message:
            'The node preset runner-only JobRunner mode is not emitted yet because the neutral server bundle does not expose a standalone task-runner entrypoint. Use node() or node({ jobRunner: { mode: "serve-and-run" } }) for the in-process JobRunner, or deploy a supported external runner adapter when one is added.',
          severity: 'error',
        },
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('emits app-registered client modules by default in neutral builds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-neutral-build-default-modules-'));
    const app = createApp({
      routes: [
        route('/app', {
          page() {
            return renderedHtml('<main>App</main>');
          },
        }),
      ],
    });
    app.clientModules.put({
      path: '/c/app.client.js',
      source: 'export const appClient = true;',
      version: 'app-v1',
    });

    try {
      const outDir = join(root, '.kovo');
      const build = await writeKovoNeutralBuild({
        app,
        outDir,
        serverHandlerSource:
          'export default async function handler() { return new Response("ok"); }\n',
      });

      await expect(
        readFile(join(outDir, 'client/c/__v/app-v1/app.client.js'), 'utf8'),
      ).resolves.toBe('export const appClient = true;');
      await expect(readJson(join(outDir, 'manifest.json'))).resolves.toMatchObject({
        clientModules: [
          {
            file: 'c/__v/app-v1/app.client.js',
            href: '/c/__v/app-v1/app.client.js',
            path: '/c/__v/app-v1/app.client.js',
            version: 'app-v1',
          },
          expect.objectContaining({
            file: expect.stringMatching(runtimeClientModuleFile),
            href: expect.stringMatching(runtimeClientModulePath),
            path: expect.stringMatching(runtimeClientModulePath),
          }),
        ],
      });
      expect(build.clientModules).toEqual([
        {
          file: 'c/__v/app-v1/app.client.js',
          href: '/c/__v/app-v1/app.client.js',
          path: '/c/__v/app-v1/app.client.js',
          source: 'export const appClient = true;',
          version: 'app-v1',
        },
        expect.objectContaining({
          file: expect.stringMatching(runtimeClientModuleFile),
          href: expect.stringMatching(runtimeClientModulePath),
          path: expect.stringMatching(runtimeClientModulePath),
          source: expect.stringContaining('installKovoDeferredRuntime'),
        }),
      ]);
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
              guard: () => true,
              page() {
                return renderedHtml('<main>Hello</main>');
              },
            }),
          ],
        }),
        clientModules: [
          {
            path: '/c/cart.client.js',
            renderPlanFingerprint: testRenderPlanFingerprint,
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
const originalObjectEntries = Object.entries;
export default async function handler(request) {
  const url = new URL(request.url);
  if (url.pathname === '/request-bridge-poison') {
    const applied = Reflect.set(Object, 'entries', function selectiveOriginSubstitution(value) {
      const entries = Reflect.apply(originalObjectEntries, Object, [value]);
      if (!entries.some(([name]) => name === 'origin')) return entries;
      return entries.map(([name, entry]) => [
        name,
        name === 'origin' ? 'https://trusted.example' : entry,
      ]);
    });
    return new Response(applied ? 'armed' : 'blocked');
  }
  if (url.pathname === '/request-bridge-echo') {
    return new Response(request.method + ':' + request.headers.get('origin'));
  }
  if (url.pathname === '/declared-oversized') {
    return new Response('Payload Too Large', { status: 413 });
  }
  if (url.pathname === '/chunked-oversized') {
    await request.body?.getReader().read();
    return new Response('Payload Too Large', { status: 413 });
  }
  if (url.pathname === '/cookies') {
    const headers = new Headers({ 'content-type': 'text/plain; charset=utf-8' });
    headers.append('set-cookie', 'session=s1; Path=/; HttpOnly');
    headers.append('set-cookie', 'csrf=c1; Path=/; SameSite=Strict');
    return new Response('cookies', { headers });
  }
  return new Response(
    'route:' + url.pathname + ':' + url.origin + ':' + request.headers.get('x-from-test'),
    {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
    },
  );
}
`,
      });

      const logs: string[] = [];
      const nodeOutDir = join(root, 'node-output');
      await node({ dockerfile: false }).emit!(build, {
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
      const nodeServer = await readFile(join(nodeOutDir, 'server.mjs'), 'utf8');
      expect(nodeServer).toContain('armIncompleteNodeRequestClose');
      expect(nodeServer).toContain("await import('./node-adapter.mjs')");
      expect(nodeServer).not.toContain("from './node-adapter.mjs';");
      const nodeAdapter = await readFile(join(nodeOutDir, 'node-adapter.mjs'), 'utf8');
      expect(nodeAdapter).toContain('export function nodeRequestToWebRequest');
      expect(nodeAdapter).toContain('export function rejectInvalidNodeRequestAuthority');
      expect(nodeAdapter).toContain('export function rejectNodeRequestTargetLimit');
      expect(nodeAdapter).toContain('export function rejectUnsafeNodeMutationTarget');
      expect(nodeAdapter).toContain('export async function writeWebResponseToNode');
      expect(nodeAdapter).toContain('const setCookies = apply(nativeHeadersGetSetCookie');
      expect(nodeAdapter).not.toContain('typeof headers.getSetCookie');
      expect(nodeAdapter).toContain("[nodeHeaders, 'set-cookie', {");
      expect(nodeAdapter).toContain(':authority');
      expect(nodeAdapter).toContain("if (name[0] === ':')");
      expect(nodeAdapter).toContain('const signal = apply(nativeAbortControllerSignalGetter');
      expect(nodeAdapter).toContain('apply(nativeSocketRemoteAddressGetter');
      expect(nodeAdapter).toContain('headers: snapshotNodeHeaders(nodeRequest)');
      expect(nodeAdapter).toContain("'__kovoPeerAddress'");
      expect(nodeServer).not.toContain('function nodeRequestToWebRequest');
      expect(nodeServer).not.toContain('function responseHeadersToNodeHeaders');
      expect(nodeServer).toContain('apply(nativeServerResponseDestroy, nodeResponse, [])');
      expect(nodeServer).toContain('const headersTimeoutMs = 10_000;');
      expect(nodeServer).toContain('const requestTimeoutMs = 30_000;');
      expect(nodeServer).toContain('server.headersTimeout = headersTimeoutMs;');
      expect(nodeServer).toContain('server.requestTimeout = requestTimeoutMs;');
      expect(nodeServer).toContain("'[kovo] unhandled node server error'");
      expect(nodeServer).toContain('const createNodeDiagnosticRecord = (');
      expect(nodeServer).toContain("await import('./server/handler.mjs')");
      expect(nodeServer).not.toContain('sanitizeDiagnosticUrl.toString');
      expect(
        nodeServer.indexOf('rejectNodeRequestTargetLimit(nodeRequest, nodeResponse)'),
      ).toBeLessThan(nodeServer.indexOf('await maybeServeStatic(rawTarget, method, nodeResponse)'));
      expect(
        nodeServer.indexOf('rejectInvalidNodeRequestAuthority(nodeRequest, nodeResponse)'),
      ).toBeLessThan(nodeServer.indexOf('await maybeServeStatic(rawTarget, method, nodeResponse)'));
      expect(
        nodeServer.indexOf('rejectNodeRequestTargetLimit(nodeRequest, nodeResponse)'),
      ).toBeLessThan(nodeServer.indexOf('await loadHandler()'));

      const emittedNodeAdapter = (await import(
        `${pathToFileURL(join(nodeOutDir, 'node-adapter.mjs')).href}?t=${Date.now()}`
      )) as NodeAdapterModule;
      await expectEmittedAdapterParity(emittedNodeAdapter);

      const server = await startGeneratedNodeServer(join(nodeOutDir, 'server.mjs'));
      const baseUrl = server.baseUrl;

      try {
        for (const target of [
          '/_m/a/%2e/b',
          '/_m/a/%2E/b',
          '/_m/x/a/%2e%2E/b',
          '/_m/a/%2f/b',
          '/_m/a/%5C/b',
          '/_m/a/./b',
          '/_m/x/a/../b',
          'http://proxy.invalid/_m/a/%2e/b',
        ]) {
          const aliasResponse = await rawHttpExchange(
            baseUrl,
            rawMutationRequest(target, 'EMITTED_NODE_ALIAS_CREDENTIAL'),
          );
          expect(aliasResponse).toContain('HTTP/1.1 404');
          expect(aliasResponse).toContain('Not Found');
          expect(aliasResponse).not.toContain('EMITTED_NODE_ALIAS_CREDENTIAL');
        }
        const canonicalMutationPath = await rawHttpExchange(
          baseUrl,
          rawMutationRequest('/_m/a/b', 'EMITTED_NODE_CANONICAL_CREDENTIAL'),
        );
        expect(canonicalMutationPath).toContain('HTTP/1.1 200');
        expect(canonicalMutationPath).toContain('route:/_m/a/b:');

        const postedAsset = await rawHttpExchange(
          baseUrl,
          'POST /assets/cart.css HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
        );
        expect(postedAsset).toContain('route:/assets/cart.css:');
        expect(postedAsset).not.toContain('body { color: navy; }');

        for (const authorityHeaders of [
          'Host: victim.example@evil.example',
          'Host: victim.example/ignored',
          'Host: victim.example\\ignored',
          'Host: victim.example\r\nHost: evil.example',
        ]) {
          const invalidAuthority = await rawHttpExchange(
            baseUrl,
            `GET /assets/cart.css HTTP/1.1\r\n${authorityHeaders}\r\nConnection: close\r\n\r\n`,
          );
          expect(invalidAuthority).toContain('HTTP/1.1 400');
          expect(invalidAuthority).toContain('Bad Request');
          expect(invalidAuthority).not.toContain('body { color: navy; }');
        }

        const fetchedAsset = await fetch(`${baseUrl}/assets/cart.css`);
        await expect(fetchedAsset.text()).resolves.toBe('body { color: navy; }');

        const declaredOversized = await rawHttpExchange(
          baseUrl,
          'POST /declared-oversized HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\nContent-Length: 1000000\r\n\r\n',
        );
        expect(declaredOversized).toContain('HTTP/1.1 413');
        expect(declaredOversized).toMatch(/connection: close/i);

        const chunkedOversized = await rawHttpExchange(
          baseUrl,
          'POST /chunked-oversized HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nabcde\r\n',
        );
        expect(chunkedOversized).toContain('HTTP/1.1 413');
        expect(chunkedOversized).toMatch(/connection: close/i);

        const incompleteStatic = await rawHttpExchange(
          baseUrl,
          'GET /assets/cart.css HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\nContent-Length: 1000000\r\n\r\n',
        );
        expect(incompleteStatic).toContain('HTTP/1.1 200');
        expect(incompleteStatic).toMatch(/connection: close/i);
        expect(incompleteStatic).toContain('body { color: navy; }');

        const routeResponse = await fetch(`${baseUrl}/hello?cart=1`, {
          headers: {
            // SPEC §9.5: generated Node output must not trust forwarded scheme headers by default.
            'x-forwarded-proto': 'https',
            'x-from-test': 'route-header',
          },
        });
        await expect(routeResponse.text()).resolves.toBe(
          `route:/hello:http://${new URL(baseUrl).host}:route-header`,
        );
        expect(routeResponse.headers.get('content-type')).toBe('text/plain; charset=utf-8');

        const bridgePoison = await fetch(`${baseUrl}/request-bridge-poison`);
        await expect(bridgePoison.text()).resolves.toBe('blocked');
        const exactBridgeResponse = await fetch(`${baseUrl}/request-bridge-echo`, {
          headers: { Origin: 'https://attacker.example' },
        });
        await expect(exactBridgeResponse.text()).resolves.toBe('GET:https://attacker.example');

        const cookieResponse = await nodeGet(baseUrl, '/cookies');
        expect(cookieResponse.headers['set-cookie']).toEqual([
          'session=s1; Path=/; HttpOnly',
          'csrf=c1; Path=/; SameSite=Strict',
        ]);

        const clientModuleResponse = await fetch(`${baseUrl}/c/__v/cart-v1/cart.client.js`);
        await expect(clientModuleResponse.text()).resolves.toBe('export const cart = true;');
        expect(clientModuleResponse.headers.get('cache-control')).toBe(
          'public, max-age=31536000, immutable',
        );
        expect(clientModuleResponse.headers.get('cross-origin-resource-policy')).toBe(
          'same-origin',
        );
        expect(clientModuleResponse.headers.get('x-content-type-options')).toBe('nosniff');
        expect(clientModuleResponse.headers.get('access-control-allow-origin')).toBeNull();
        expect(clientModuleResponse.headers.get('vary')).toBeNull();
        expect(clientModuleResponse.headers.get('set-cookie')).toBeNull();
        expect(clientModuleResponse.headers.get('content-type')).toBe(
          'text/javascript; charset=utf-8',
        );

        const assetResponse = await fetch(`${baseUrl}/assets/cart.css`);
        await expect(assetResponse.text()).resolves.toBe('body { color: navy; }');
        expect(assetResponse.headers.get('cache-control')).toBe(
          'public, max-age=0, must-revalidate',
        );
        expect(assetResponse.headers.get('cross-origin-resource-policy')).toBe('same-origin');
        expect(assetResponse.headers.get('x-content-type-options')).toBe('nosniff');
        expect(assetResponse.headers.get('access-control-allow-origin')).toBeNull();
        expect(assetResponse.headers.get('vary')).toBeNull();
        expect(assetResponse.headers.get('set-cookie')).toBeNull();
        expect(assetResponse.headers.get('content-type')).toBe('text/css; charset=utf-8');

        const missingClientModule = await fetch(`${baseUrl}/c/__v/cart-v1/missing.client.js`);
        expect(missingClientModule.status).toBe(404);
        expect(missingClientModule.headers.get('cache-control')).toBe('no-store');
        expect(missingClientModule.headers.get('cross-origin-resource-policy')).toBe('same-origin');
        expect(missingClientModule.headers.get('x-content-type-options')).toBe('nosniff');
        expect(missingClientModule.headers.get('vary')).toBeNull();
        expect(missingClientModule.headers.get('set-cookie')).toBeNull();
      } finally {
        await server.close();
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('serializes control and Unicode emitted Node static-file disposition filenames', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-node-preset-filename-controls-'));
    let server: GeneratedServerProcess | undefined;

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/dynamic', {
              guard: () => true,
              page: () => renderedHtml('<main>Dynamic</main>'),
            }),
          ],
        }),
        outDir: join(root, '.kovo'),
        serverHandlerSource:
          'export default async function handler() { return new Response("dynamic"); }\n',
      });
      const nodeOutDir = join(root, 'node-output');
      await node({ dockerfile: false }).emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: nodeOutDir,
        readNeutral() {
          return build;
        },
      });

      const fileName = 'safe\u0001\u007f.js';
      await mkdir(join(nodeOutDir, 'client', 'assets'), { recursive: true });
      await writeFile(join(nodeOutDir, 'client', 'assets', fileName), 'safe-asset');
      server = await startGeneratedNodeServer(join(nodeOutDir, 'server.mjs'));
      const baseUrl = server.baseUrl;

      const response = await fetch(`${baseUrl}/assets/${encodeURIComponent(fileName)}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-disposition')).toBe('inline; filename="safe__.js"');
      await expect(response.text()).resolves.toBe('safe-asset');

      const unicodeFileName = 'emoji-💣.txt';
      await writeFile(join(nodeOutDir, 'client', 'assets', unicodeFileName), 'unicode-asset');
      const unicodeResponse = await fetch(
        `${baseUrl}/assets/${encodeURIComponent(unicodeFileName)}`,
      );
      expect(unicodeResponse.status).toBe(200);
      expect(unicodeResponse.headers.get('content-disposition')).toBe(
        `inline; filename="emoji-_.txt"; filename*=UTF-8''emoji-%F0%9F%92%A3.txt`,
      );
      await expect(unicodeResponse.text()).resolves.toBe('unicode-asset');
    } finally {
      if (server !== undefined) await server.close();
      await rm(root, { force: true, recursive: true });
    }
  });

  it('logs unhandled production node server errors to stderr before returning a 500', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-node-preset-errors-'));

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/boom', {
              page() {
                return renderedHtml('<main>Boom</main>');
              },
            }),
          ],
        }),
        outDir: join(root, '.kovo'),
        serverHandlerSource: `
export default async function handler(request) {
  throw new Error('boom from generated handler at ' + request.url);
}
`,
      });
      const nodeOutDir = join(root, 'node-output');

      await node({ dockerfile: false }).emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: nodeOutDir,
        readNeutral() {
          return build;
        },
      });

      const server = await startGeneratedNodeServer(join(nodeOutDir, 'server.mjs'));
      const baseUrl = server.baseUrl;

      try {
        const response = await fetch(
          `${baseUrl}/boom?kovo-cap=NODE_CAPABILITY_SHOULD_NEVER_LOG&State=oauth&state=duplicate`,
          { method: 'POST' },
        );
        expect(response.status).toBe(500);
        await expect(response.text()).resolves.toBe('Internal Server Error');
        await waitForGeneratedServerStderr(server, 'boom from generated handler');
      } finally {
        await server.close();
      }

      const generatedStderr = server.stderr();
      expect(generatedStderr).toContain('[kovo] unhandled node server error');
      expect(generatedStderr).toContain("method: 'POST'");
      expect(generatedStderr).toContain("url: '/boom?kovo-cap&State&state'");
      expect(generatedStderr).toContain(
        'Error: boom from generated handler at /boom?kovo-cap&State&state',
      );
      expect(generatedStderr).toContain('handler');
      expect(generatedStderr).not.toContain('NODE_CAPABILITY_SHOULD_NEVER_LOG');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('does not expose generated static metadata through encoded separator aliases', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-node-static-metadata-alias-'));

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({}),
        outDir: join(root, '.kovo'),
        serverHandlerSource:
          'export default async function handler() { return new Response("dynamic fallback"); }\n',
      });
      const nodeOutDir = join(root, 'node-output');
      await node({ dockerfile: false }).emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: nodeOutDir,
        readNeutral() {
          return build;
        },
      });

      const metadataSecret = 'KOVO_STATIC_METADATA_MUST_NOT_BE_PUBLIC';
      await mkdir(join(nodeOutDir, 'static'), { recursive: true });
      await writeFile(join(nodeOutDir, 'static', '_headers'), metadataSecret, 'utf8');
      await writeFile(
        join(nodeOutDir, 'static', 'kovo-static-manifest.json'),
        metadataSecret,
        'utf8',
      );
      await mkdir(join(nodeOutDir, 'static', 'assets'), { recursive: true });
      await writeFile(
        join(nodeOutDir, 'static', 'assets', 'root-confusion.js'),
        metadataSecret,
        'utf8',
      );
      await writeFile(join(nodeOutDir, 'static', 'public.txt'), 'public control', 'utf8');

      const server = await startGeneratedNodeServer(join(nodeOutDir, 'server.mjs'));
      try {
        const direct = await fetch(`${server.baseUrl}/_headers`);
        await expect(direct.text()).resolves.not.toContain(metadataSecret);

        for (const path of [
          '/x%2f..%2f_headers',
          '/x%2F..%2F_headers',
          '/x%5c..%5c_headers',
          '/x%2f..%2fkovo-static-manifest.json',
          '/x%2f..%2fassets%2froot-confusion.js',
        ]) {
          const encodedAlias = await rawHttpExchange(
            server.baseUrl,
            `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`,
          );
          expect(encodedAlias, path).not.toContain(metadataSecret);
        }

        const publicControl = await fetch(`${server.baseUrl}/public.txt`);
        expect(publicControl.status).toBe(200);
        await expect(publicControl.text()).resolves.toBe('public control');
      } finally {
        await server.close();
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('keeps emitted Node static-file confinement after an authored handler poisons globals', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-node-static-intrinsics-'));

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({}),
        outDir: join(root, '.kovo'),
        serverHandlerSource: `
import { createRequire, syncBuiltinESMExports } from 'node:module';

const require = createRequire(import.meta.url);
const nodeHttp = require('node:http');
const nodePath = require('node:path');
const OriginalURL = globalThis.URL;
const originalReflectApply = Reflect.apply;
const originalStartsWith = String.prototype.startsWith;
const originalSlice = String.prototype.slice;
Reflect.set(nodeHttp, 'createServer', function poisonedCreateServer() {
  globalThis.__kovoPoisonedNodeCreateServerHits =
    (globalThis.__kovoPoisonedNodeCreateServerHits ?? 0) + 1;
  throw new Error('POISONED_NODE_CREATE_SERVER');
});
syncBuiltinESMExports();

export default async function handler() {
  Reflect.set(globalThis, 'URL', function SelectiveURL(input, base) {
    if (base === 'http://kovo.local' && typeof input === 'string' && input.includes('%2e')) {
      return { pathname: input };
    }
    return new OriginalURL(input, base);
  });
  Reflect.set(String.prototype, 'startsWith', function selectiveStartsWith(search, position) {
    if (
      typeof search === 'string' &&
      originalReflectApply(originalSlice, search, [-8]) === '/client/'
    ) {
      return true;
    }
    return originalReflectApply(originalStartsWith, this, [search, position]);
  });
  Reflect.set(nodePath, 'sep', '');
  syncBuiltinESMExports();
  return new Response('poison armed', {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });

}
`,
      });
      const nodeOutDir = join(root, 'node-output');
      await node({ dockerfile: false }).emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: nodeOutDir,
        readNeutral() {
          return build;
        },
      });
      await mkdir(join(nodeOutDir, 'client', 'assets'), { recursive: true });
      await mkdir(join(nodeOutDir, 'client-secret'), { recursive: true });
      const secret = 'NODE_STATIC_CONFINEMENT_SECRET';
      await writeFile(join(nodeOutDir, 'secret.txt'), secret, 'utf8');
      await writeFile(join(nodeOutDir, 'client-secret', 'secret.txt'), secret, 'utf8');

      // Execute the unchanged emitted entry in a dedicated child realm; its generated listener
      // lazily imports the authored handler under the already-installed runtime lock.
      const server = await startGeneratedNodeServer(join(nodeOutDir, 'server.mjs'));
      const baseUrl = server.baseUrl;

      try {
        const arm = await fetch(`${baseUrl}/arm`);
        await expect(arm.text()).resolves.toBe('poison armed');
        const traversal = await rawHttpExchange(
          baseUrl,
          'GET /assets/%2e%2e/%2e%2e/secret.txt HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n',
        );

        expect(traversal).not.toContain(secret);
        const synchronizedPathTraversal = await rawHttpExchange(
          baseUrl,
          'GET /assets/..%2f..%2fclient-secret/secret.txt HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n',
        );
        expect(synchronizedPathTraversal).not.toContain(secret);
      } finally {
        await server.close();
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('binds emitted Node static bytes to one contained file identity across path swaps', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-node-static-identity-'));

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({}),
        outDir: join(root, '.kovo'),
        serverHandlerSource: 'export default async () => new Response("handler");\n',
      });
      const nodeOutDir = join(root, 'node-output');
      await node({ dockerfile: false }).emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: nodeOutDir,
        readNeutral() {
          return build;
        },
      });

      // SPEC §10.6: the generated artifact must read on the exact descriptor whose canonical
      // contained inode was validated; O_NOFOLLOW alone does not cover intermediate-directory
      // replacement, and realpath/stat followed by readFile(path) reopens an untrusted name.
      const serverSource = await readFile(join(nodeOutDir, 'server.mjs'), 'utf8');
      expect(serverSource).toContain('openFileDescriptor(path, fsReadOnlyNoFollowFlags');
      expect(serverSource).toContain('statFileDescriptor(fileDescriptor');
      expect(serverSource).toContain('readFileDescriptor(fileDescriptor');
      expect(serverSource).toContain('sameStaticFileIdentity(expectedStat, openedStat)');
      expect(serverSource).toContain('staticPathRetainsIdentity(realRoot, resolved, expectedStat)');
      expect(serverSource).not.toContain('body: await readFile(resolved)');

      const assets = join(nodeOutDir, 'client', 'assets');
      await mkdir(assets, { recursive: true });
      const finalTarget = join(assets, 'race.txt');
      const finalParked = join(assets, 'race.parked');
      const finalSwap = join(assets, 'race.swap');
      const outsideFile = join(root, 'outside-file.txt');
      const outsideFileSecret = 'GENERATED_NODE_FINAL_COMPONENT_SECRET';
      await writeFile(finalTarget, 'SAFE_STATIC_BYTES');
      await link(finalTarget, finalParked);
      await writeFile(outsideFile, outsideFileSecret);

      const directoryTarget = join(assets, 'race-dir');
      const directoryParked = join(assets, 'race-dir.parked');
      const outsideDirectory = join(root, 'outside-directory');
      const outsideDirectorySecret = 'GENERATED_NODE_INTERMEDIATE_DIRECTORY_SECRET';
      await mkdir(directoryTarget);
      await mkdir(outsideDirectory);
      await writeFile(join(directoryTarget, 'race.txt'), 'SAFE_DIRECTORY_BYTES');
      await writeFile(join(outsideDirectory, 'race.txt'), outsideDirectorySecret);

      const server = await startGeneratedNodeServer(join(nodeOutDir, 'server.mjs'));
      const baseUrl = server.baseUrl;
      let running = true;
      const turn = (): Promise<void> =>
        new Promise((resolvePromise) => setImmediate(resolvePromise));
      const finalSwapper = (async () => {
        while (running) {
          await symlink(outsideFile, finalSwap);
          await rename(finalSwap, finalTarget);
          await turn();
          await link(finalParked, finalSwap);
          await rename(finalSwap, finalTarget);
          await turn();
        }
      })();
      const directorySwapper = (async () => {
        while (running) {
          await rename(directoryTarget, directoryParked);
          await symlink(outsideDirectory, directoryTarget, 'dir');
          await turn();
          await unlink(directoryTarget);
          await rename(directoryParked, directoryTarget);
          await turn();
        }
      })();

      try {
        for (let round = 0; round < 50; round += 1) {
          const bodies = await Promise.all(
            Array.from({ length: 20 }, async (_value, index) => {
              const path = index % 2 === 0 ? '/assets/race.txt' : '/assets/race-dir/race.txt';
              try {
                return await (await fetch(`${baseUrl}${path}`)).text();
              } catch {
                return '';
              }
            }),
          );
          expect(bodies).not.toContain(outsideFileSecret);
          expect(bodies).not.toContain(outsideDirectorySecret);
        }
      } finally {
        running = false;
        await Promise.all([finalSwapper, directorySwapper]);
        await server.close();
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('pins emitted Node static-root identity and rejects hardlinked outside inodes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-node-static-root-identity-'));

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({}),
        outDir: join(root, '.kovo'),
        serverHandlerSource: 'export default async () => new Response("handler");\n',
      });
      const nodeOutDir = join(root, 'node-output');
      await node({ dockerfile: false }).emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: nodeOutDir,
        readNeutral() {
          return build;
        },
      });

      const clientRoot = join(nodeOutDir, 'client');
      const assets = join(clientRoot, 'assets');
      const safeAsset = join(assets, 'root-swap.js');
      const outsideSecret = join(root, 'outside-secret.js');
      await mkdir(assets, { recursive: true });
      await writeFile(safeAsset, 'SAFE_REVIEWED_STATIC_BYTES', 'utf8');
      await writeFile(outsideSecret, 'OUTSIDE_HARDLINK_SECRET', 'utf8');
      await link(outsideSecret, join(assets, 'hardlink.js'));

      const serverSource = await readFile(join(nodeOutDir, 'server.mjs'), 'utf8');
      expect(serverSource).toContain('staticRootRetainsIdentity(root, realRoot, rootStat)');
      expect(serverSource).toContain("const links = ownDataValue(fileStat, 'nlink')");
      expect(serverSource).toContain('links === 1');

      const server = await startGeneratedNodeServer(join(nodeOutDir, 'server.mjs'));
      const baseUrl = server.baseUrl;

      try {
        const reviewed = await fetch(`${baseUrl}/assets/root-swap.js`);
        expect(reviewed.status).toBe(200);
        await expect(reviewed.text()).resolves.toBe('SAFE_REVIEWED_STATIC_BYTES');

        const hardlink = await fetch(`${baseUrl}/assets/hardlink.js`);
        expect(hardlink.status).toBe(404);
        await expect(hardlink.text()).resolves.not.toContain('OUTSIDE_HARDLINK_SECRET');

        await rename(clientRoot, `${clientRoot}.reviewed`);
        await mkdir(join(clientRoot, 'assets'), { recursive: true });
        await writeFile(safeAsset, 'ATTACKER_REPLACEMENT_BYTES', 'utf8');

        const replacement = await fetch(`${baseUrl}/assets/root-swap.js`);
        expect(replacement.status).toBe(404);
        await expect(replacement.text()).resolves.not.toContain('ATTACKER_REPLACEMENT_BYTES');
      } finally {
        await server.close();
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('pins emitted Node Response fields before authored getters can substitute output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-node-response-intrinsics-'));

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({}),
        outDir: join(root, '.kovo'),
        serverHandlerSource: `
const properties = ['body', 'headers', 'status', 'statusText'];
const descriptors = new Map(properties.map((property) => [
  property,
  Object.getOwnPropertyDescriptor(Response.prototype, property),
]));
const safe = new Response('SAFE-EMITTED-RESPONSE', {
  headers: { 'content-type': 'text/plain; charset=utf-8' },
  status: 200,
});
const attacker = new Response('<script>emittedAttackerOutput()</script>', {
  headers: {
    'content-type': 'text/html; charset=utf-8',
    'set-cookie': 'admin=attacker; Path=/; HttpOnly',
  },
  status: 201,
  statusText: 'ATTACKER',
});

export default async function handler() {
  for (const property of properties) {
    const descriptor = descriptors.get(property);
    Reflect.defineProperty(Response.prototype, property, {
      ...descriptor,
      get() {
        return Reflect.apply(descriptor.get, this === safe ? attacker : this, []);
      },
    });
  }
  return safe;
}
`,
      });
      const nodeOutDir = join(root, 'node-output');
      await node({ dockerfile: false }).emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: nodeOutDir,
        readNeutral() {
          return build;
        },
      });

      const server = await startGeneratedNodeServer(join(nodeOutDir, 'server.mjs'));
      const baseUrl = server.baseUrl;

      try {
        const response = await fetch(baseUrl);
        expect(response.status).toBe(200);
        expect(response.headers.get('set-cookie')).toBeNull();
        await expect(response.text()).resolves.toBe('SAFE-EMITTED-RESPONSE');
      } finally {
        await server.close();
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('pins emitted Node response writers before an authored handler can replace the transport', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-node-native-transport-'));

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({}),
        outDir: join(root, '.kovo'),
        serverHandlerSource: `
import { ServerResponse } from 'node:http';
const originalWriteHead = ServerResponse.prototype.writeHead;
const originalEnd = ServerResponse.prototype.end;

export default async function handler() {
  Reflect.set(ServerResponse.prototype, 'writeHead', function attackerWriteHead() {
    return Reflect.apply(originalWriteHead, this, [202, 'ATTACKER', {
      'content-type': 'text/html; charset=utf-8',
      'set-cookie': 'admin=attacker; Path=/; HttpOnly',
    }]);
  });
  Reflect.set(ServerResponse.prototype, 'end', function attackerEnd() {
    return Reflect.apply(originalEnd, this, ['<script>emittedNativeTransportAttacker()</script>']);
  });
  return new Response('SAFE-EMITTED-NATIVE-TRANSPORT', {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
    status: 200,
  });
}
`,
      });
      const nodeOutDir = join(root, 'node-output');
      await node({ dockerfile: false }).emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: nodeOutDir,
        readNeutral() {
          return build;
        },
      });

      const server = await startGeneratedNodeServer(join(nodeOutDir, 'server.mjs'));
      const baseUrl = server.baseUrl;

      try {
        const response = await fetch(baseUrl);
        expect(response.status).toBe(200);
        expect(response.headers.get('set-cookie')).toBeNull();
        await expect(response.text()).resolves.toBe('SAFE-EMITTED-NATIVE-TRANSPORT');
      } finally {
        await server.close();
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('does not serialize attacker source through a late Function.toString replacement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-node-source-injection-'));
    const originalFunctionToString = Function.prototype.toString;

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({}),
        outDir: join(root, '.kovo'),
        serverHandlerSource: `
export default async function handler() {
  return new Response('safe');
}
`,
      });
      Function.prototype.toString = function selectiveFunctionSource() {
        if (this.name === 'generatedNodeDiagnosticFactory') {
          return `function generatedNodeDiagnosticFactory() {
            globalThis.__kovoGeneratedNodeSourceInjection = 'ATTACKER-CODE-RAN';
            return () => ({ error: 'forged', method: 'GET', url: '/' });
          }`;
        }
        return Reflect.apply(originalFunctionToString, this, []);
      };

      const nodeOutDir = join(root, 'node-output');
      await node({ dockerfile: false }).emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: nodeOutDir,
        readNeutral() {
          return build;
        },
      });
      Function.prototype.toString = originalFunctionToString;
      const emittedSource = await readFile(join(nodeOutDir, 'server.mjs'), 'utf8');
      expect(emittedSource).not.toContain('ATTACKER-CODE-RAN');

      const childGlobals = importGeneratedRuntimeEntry(join(nodeOutDir, 'server.mjs'), [
        '__kovoGeneratedNodeSourceInjection',
      ]);
      expect(childGlobals.__kovoGeneratedNodeSourceInjection).toBeUndefined();
    } finally {
      Function.prototype.toString = originalFunctionToString;
      await rm(root, { force: true, recursive: true });
    }
  });

  it('emits all executable presets from boot-pinned serializers after late source coercion poison', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-all-preset-source-injection-'));
    const originalJsonStringify = JSON.stringify;
    const originalFunctionToString = Function.prototype.toString;
    const originalRegExpToString = RegExp.prototype.toString;
    const marker = 'KOVO_ALL_PRESET_SOURCE_INJECTION';

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({}),
        outDir: join(root, '.kovo'),
        serverHandlerSource: `
export default async function handler() {
  return new Response('safe');
}
`,
      });
      JSON.stringify = (() =>
        `(()=>{globalThis.__kovoAllPresetSourceInjection=true;return '${marker}'})()`) as typeof JSON.stringify;
      Function.prototype.toString = function poisonedFunctionSource() {
        if (this.name.includes('generated')) {
          return `function generated() { globalThis.__kovoAllPresetSourceInjection = true; } /* ${marker} */`;
        }
        return Reflect.apply(originalFunctionToString, this, []);
      };
      RegExp.prototype.toString = function poisonedRegExpSource() {
        return `/x/;globalThis.__kovoAllPresetSourceInjection=true;/*${marker}*/`;
      };

      const emitContext = (outDir: string) => ({
        declaredEnv: [],
        log() {},
        outDir,
        readNeutral() {
          return build;
        },
      });
      const nodeOut = join(root, 'node');
      const vercelOut = join(root, 'vercel');
      const cloudflareOut = join(root, 'cloudflare');
      await node({ dockerfile: false }).emit!(build, emitContext(nodeOut));
      await vercel().emit!(build, emitContext(vercelOut));
      await cloudflare({ compatibilityDate: '2026-06-18', name: 'serializer-proof' }).emit!(
        build,
        emitContext(cloudflareOut),
      );

      const executableSources = await Promise.all([
        readFile(join(nodeOut, 'server.mjs'), 'utf8'),
        readFile(join(nodeOut, 'node-adapter.mjs'), 'utf8'),
        readFile(join(vercelOut, 'functions/kovo.func/index.cjs'), 'utf8'),
        readFile(join(vercelOut, 'functions/kovo.func/node-adapter.mjs'), 'utf8'),
        readFile(join(cloudflareOut, 'worker.mjs'), 'utf8'),
      ]);
      for (const source of executableSources) expect(source).not.toContain(marker);

      JSON.stringify = originalJsonStringify;
      Function.prototype.toString = originalFunctionToString;
      RegExp.prototype.toString = originalRegExpToString;
      const sha256 = (source: string): string => createHash('sha256').update(source).digest('hex');
      await expect(readJson(join(nodeOut, 'kovo-artifact-integrity.json'))).resolves.toEqual({
        algorithm: 'sha256',
        files: {
          'node-adapter.mjs': sha256(executableSources[1]!),
          'server.mjs': sha256(executableSources[0]!),
        },
      });
      await expect(
        readJson(join(vercelOut, 'functions/kovo.func/kovo-artifact-integrity.json')),
      ).resolves.toEqual({
        algorithm: 'sha256',
        files: {
          'index.cjs': sha256(executableSources[2]!),
          'node-adapter.mjs': sha256(executableSources[3]!),
        },
      });
      await expect(readJson(join(cloudflareOut, 'kovo-artifact-integrity.json'))).resolves.toEqual({
        algorithm: 'sha256',
        files: { 'worker.mjs': sha256(executableSources[4]!) },
      });
      for (const entryPath of [
        join(nodeOut, 'server.mjs'),
        join(vercelOut, 'functions/kovo.func/index.cjs'),
        join(cloudflareOut, 'worker.mjs'),
      ]) {
        const childGlobals = importGeneratedRuntimeEntry(entryPath, [
          '__kovoAllPresetSourceInjection',
        ]);
        expect(childGlobals.__kovoAllPresetSourceInjection).toBeUndefined();
      }
    } finally {
      JSON.stringify = originalJsonStringify;
      Function.prototype.toString = originalFunctionToString;
      RegExp.prototype.toString = originalRegExpToString;
      await rm(root, { force: true, recursive: true });
    }
  });

  it('scrubs secret-tagged material from generated node server error logs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-node-preset-secret-errors-'));

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/boom', {
              page() {
                return renderedHtml('<main>Boom</main>');
              },
            }),
          ],
        }),
        outDir: join(root, '.kovo'),
        serverHandlerSource: `
export default async function handler() {
  const token = {
    [Symbol.toStringTag]: 'Secret',
    toJSON() { return '[secret]'; },
    toString() { return '[secret]'; },
  };
  Object.defineProperty(token, 'raw', { value: 'sk_live_q5_generated_node', enumerable: false });
  throw { reason: 'provider failed', token };
}
`,
      });
      const nodeOutDir = join(root, 'node-output');

      await node({ dockerfile: false }).emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: nodeOutDir,
        readNeutral() {
          return build;
        },
      });

      const server = await startGeneratedNodeServer(join(nodeOutDir, 'server.mjs'));
      const baseUrl = server.baseUrl;

      try {
        const response = await fetch(`${baseUrl}/boom`, { method: 'POST' });
        expect(response.status).toBe(500);
        await waitForGeneratedServerStderr(server, 'provider failed');
      } finally {
        await server.close();
      }

      const generatedStderr = server.stderr();
      expect(generatedStderr).toContain("reason: 'provider failed'");
      expect(generatedStderr).toContain("token: '[secret]'");
      expect(generatedStderr).not.toContain('sk_live_q5_generated_node');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('redacts isolated request credentials and controls from post-response node errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-node-preset-stream-errors-'));
    const basicPassword = 'BASIC_PASSWORD_SHOULD_NOT_LOG';
    const basic = Buffer.from(`basic-user:${basicPassword}`).toString('base64');

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({}),
        outDir: join(root, '.kovo'),
        serverHandlerSource: `
export default async function handler(request) {
  const url = new URL(request.url);
  const cookie = /sid=([^;]+)/.exec(request.headers.get('cookie') ?? '')?.[1] ?? '';
  const authorization = request.headers.get('authorization') ?? '';
  const basicPassword = Buffer.from(authorization.replace(/^Basic\\s+/i, ''), 'base64')
    .toString('utf8')
    .split(':')[1] ?? '';
  const failure = url.pathname === '/proxy-stream-error'
    ? new Proxy({}, {
        getOwnPropertyDescriptor() { throw new Error('getter trap must not escape'); },
      })
    : new Error(
        'stream failed query=' + url.searchParams.get('apiKeyV2') +
        ' cookie=' + cookie +
        ' header=' + request.headers.get('x-api-key') +
        ' basic=' + basicPassword +
        '\\nFORGED-LINE\\u001b[31m',
      );
  let started = false;
  return new Response(new ReadableStream({
    async pull(controller) {
      if (!started) {
        started = true;
        controller.enqueue(new TextEncoder().encode('partial-'));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
      controller.error(failure);
    },
  }), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
`,
      });
      const nodeOutDir = join(root, 'node-output');
      await node({ dockerfile: false }).emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: nodeOutDir,
        readNeutral() {
          return build;
        },
      });

      const server = await startGeneratedNodeServer(join(nodeOutDir, 'server.mjs'));
      const baseUrl = server.baseUrl;

      try {
        const response = await fetch(
          `${baseUrl}/stream-error?apiKeyV2=QUERY_SECRET_SHOULD_NOT_LOG`,
          {
            headers: {
              Authorization: `Basic ${basic}`,
              Cookie: 'sid=COOKIE_SECRET_SHOULD_NOT_LOG',
              'X-API-Key': 'HEADER_SECRET_SHOULD_NOT_LOG',
            },
          },
        );
        expect(response.status).toBe(200);
        await expect(response.text()).rejects.toThrow();

        const proxyResponse = await fetch(`${baseUrl}/proxy-stream-error`);
        expect(proxyResponse.status).toBe(200);
        await expect(proxyResponse.text()).rejects.toThrow();
        await waitForGeneratedServerErrorCount(server, 2);
      } finally {
        await server.close();
      }

      const generatedStderr = server.stderr();
      expect(generatedStderr.match(/\[kovo\] unhandled node server error/gu)).toHaveLength(2);
      expect(generatedStderr).toContain('[redacted]');
      expect(generatedStderr).toContain('\\\\u000aFORGED-LINE\\\\u001b[31m');
      expect(generatedStderr).not.toContain('\u001b');
      expect(generatedStderr).not.toContain('QUERY_SECRET_SHOULD_NOT_LOG');
      expect(generatedStderr).not.toContain('COOKIE_SECRET_SHOULD_NOT_LOG');
      expect(generatedStderr).not.toContain('HEADER_SECRET_SHOULD_NOT_LOG');
      expect(generatedStderr).not.toContain(basicPassword);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('keeps generated Node diagnostics useful under selective ambient intrinsic poisoning', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-node-preset-poisoned-errors-'));

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({}),
        outDir: join(root, '.kovo'),
        serverHandlerSource: `
const originalGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const originalReplaceAll = String.prototype.replaceAll;
const originalSort = Array.prototype.sort;
export default async function handler(request) {
  Reflect.set(Object, 'getOwnPropertyDescriptor', function (_target, property) {
    if (property === 'stack') throw new Error('ambient descriptor reached generated logger');
    return Reflect.apply(originalGetOwnPropertyDescriptor, Object, arguments);
  });
  Reflect.set(String.prototype, 'replaceAll', function (search, replacement) {
    if (search === 'POISON_LOG_SECRET') {
      throw new Error('ambient replaceAll reached generated logger');
    }
    return Reflect.apply(originalReplaceAll, this, [search, replacement]);
  });
  Reflect.set(Array.prototype, 'sort', function (compare) {
    for (let index = 0; index < this.length; index += 1) {
      if (this[index] === 'POISON_LOG_SECRET') {
        throw new Error('ambient sort reached generated logger');
      }
    }
    return Reflect.apply(originalSort, this, [compare]);
  });
  throw new Error(
    'generated poison at ' + request.url +
    ' token=POISON_LOG_SECRET\\nFORGED-LINE\\u001b[31m'
  );
}
`,
      });
      const nodeOutDir = join(root, 'node-output');
      await node({ dockerfile: false }).emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: nodeOutDir,
        readNeutral() {
          return build;
        },
      });
      const server = await startGeneratedNodeServer(join(nodeOutDir, 'server.mjs'));
      const baseUrl = server.baseUrl;

      try {
        const response = await fetch(`${baseUrl}/poison?apiKey=POISON_LOG_SECRET`, {
          method: 'POST',
        });
        expect(response.status).toBe(500);
        await expect(response.text()).resolves.toBe('Internal Server Error');
        await waitForGeneratedServerStderr(server, 'generated poison');
      } finally {
        await server.close();
      }

      const generatedStderr = server.stderr();
      expect(generatedStderr).toContain("method: 'POST'");
      expect(generatedStderr).toContain("url: '/poison?apiKey'");
      expect(generatedStderr).toContain('generated poison at /poison?apiKey');
      expect(generatedStderr).toContain('token=[redacted]');
      expect(generatedStderr).toContain('\\\\u000aFORGED-LINE\\\\u001b[31m');
      expect(generatedStderr).not.toContain('POISON_LOG_SECRET');
      expect(generatedStderr).not.toContain('\u001b');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('emits an installable Dockerfile and runtime package for the node preset by default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-node-preset-dockerfile-'));

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/', {
              guard: () => true,
              page() {
                return renderedHtml('<main>Home</main>');
              },
            }),
          ],
        }),
        outDir: join(root, '.kovo'),
        serverHandlerSource:
          'export default async function handler() { return new Response("ok"); }\n',
      });
      const nodeOutDir = join(root, 'node-output');

      await node().emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: nodeOutDir,
        readNeutral() {
          return build;
        },
      });

      const dockerfile = await readFile(join(nodeOutDir, 'Dockerfile'), 'utf8');
      expect(dockerfile).toContain(
        'FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd',
      );
      expect(dockerfile).toContain('USER node');
      expect(dockerfile.indexOf('USER node')).toBeLessThan(dockerfile.indexOf('npm ci'));
      expect(dockerfile).toContain('COPY --chown=node:node package.json ./');
      expect(dockerfile).toContain('COPY --chown=node:node . .');
      expect(dockerfile).toContain('npm ci --omit=dev --ignore-scripts');
      expect(dockerfile).toContain(
        'corepack pnpm install --prod --frozen-lockfile --ignore-scripts',
      );
      expect(dockerfile).toContain(
        'corepack yarn install --production --frozen-lockfile --ignore-scripts',
      );
      expect(dockerfile).toContain('corepack yarn install --immutable --mode=skip-builds');
      expect(dockerfile).toContain('refusing an unlocked production install');
      expect(dockerfile).toContain('CMD ["node", "server.mjs"]');

      const runtimePackage = JSON.parse(
        await readFile(join(nodeOutDir, 'package.json'), 'utf8'),
      ) as {
        dependencies?: Record<string, string>;
        scripts?: Record<string, string>;
        type?: string;
      };
      expect(runtimePackage.type).toBe('module');
      expect(runtimePackage.scripts?.start).toBe('NODE_ENV=production node server.mjs');
      expect(runtimePackage.dependencies).toBeDefined();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('does not inherit app-mutated NODE_OPTIONS in generated-JavaScript validation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-preset-validation-environment-'));
    const preloadPath = join(root, 'attacker-preload.cjs');
    const markerPath = join(root, 'attacker-preload-ran');
    const previousNodeOptions = process.env.NODE_OPTIONS;

    try {
      await writeFile(
        preloadPath,
        `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'ran');\n`,
        'utf8',
      );
      const build = await writeKovoNeutralBuild({
        app: createApp({ routes: [route('/', { page: () => renderedHtml('<main>Home</main>') })] }),
        outDir: join(root, '.kovo'),
        serverHandlerSource: 'export default async () => new Response("ok");\n',
      });
      const preset = node({ dockerfile: false });

      process.env.NODE_OPTIONS = `--require=${preloadPath}`;
      await preset.emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: join(root, 'node-output'),
        projectRoot: root,
        readNeutral() {
          return build;
        },
      });

      await expect(stat(markerPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previousNodeOptions;
      await rm(root, { force: true, recursive: true });
    }
  });

  it('C213 keeps runtime package metadata and lockfile authoritative after route-time poisoning', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-node-runtime-package-intrinsics-'));
    const originalJsonParse = JSON.parse;
    const originalIterator = Array.prototype[Symbol.iterator];
    let parsePoisonHits = 0;
    let iteratorPoisonHits = 0;

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/', {
              page() {
                JSON.parse = function replaceRuntimePackage(text, reviver) {
                  if (typeof text === 'string' && text.includes('"name": "kovo-monorepo"')) {
                    parsePoisonHits += 1;
                    return {
                      dependencies: { 'attacker-runtime': '9.9.9' },
                      devDependencies: { 'attacker-dev-runtime': '9.9.9' },
                      name: 'attacker-runtime',
                      optionalDependencies: { 'attacker-optional-runtime': '9.9.9' },
                      packageManager: 'npm@0.0.0',
                    };
                  }
                  return originalJsonParse(text, reviver);
                } as typeof JSON.parse;
                Array.prototype[Symbol.iterator] = function omitRuntimeLockfile() {
                  if (
                    this[0] === 'package-lock.json' &&
                    this[1] === 'npm-shrinkwrap.json' &&
                    this[2] === 'pnpm-lock.yaml'
                  ) {
                    iteratorPoisonHits += 1;
                    return Reflect.apply(originalIterator, [], []);
                  }
                  return Reflect.apply(originalIterator, this, []);
                } as (typeof Array.prototype)[Symbol.iterator];
                return renderedHtml('<main>Home</main>');
              },
            }),
          ],
        }),
        outDir: join(root, '.kovo'),
        serverHandlerSource: 'export default async () => new Response("ok");\n',
      });
      const nodeOutDir = join(root, 'node-output');
      await node().emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: nodeOutDir,
        readNeutral() {
          return build;
        },
      });
      const runtimePackageText = await readFile(join(nodeOutDir, 'package.json'), 'utf8');
      let copiedLockfile = true;
      try {
        await readFile(join(nodeOutDir, 'pnpm-lock.yaml'));
      } catch {
        copiedLockfile = false;
      }
      const parseHitsAfterEmit = parsePoisonHits;
      const iteratorHitsAfterEmit = iteratorPoisonHits;
      JSON.parse = originalJsonParse;
      Array.prototype[Symbol.iterator] = originalIterator;

      const runtimePackage = JSON.parse(runtimePackageText) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        name?: string;
        packageManager?: string;
        pnpm?: { overrides?: Record<string, string> };
      };
      expect(runtimePackage.name).toBe('kovo-monorepo-server');
      expect(runtimePackage.packageManager).toBe('pnpm@10.12.1');
      expect(runtimePackage.dependencies).not.toHaveProperty('attacker-runtime');
      expect(runtimePackage.devDependencies).not.toHaveProperty('attacker-dev-runtime');
      expect(runtimePackage.devDependencies).toHaveProperty('vitest', '4.1.8');
      expect(runtimePackage.pnpm?.overrides).toEqual({ esbuild: '0.28.1' });
      expect(copiedLockfile).toBe(true);
      expect(parseHitsAfterEmit).toBe(0);
      expect(iteratorHitsAfterEmit).toBe(0);
      expect(() =>
        execFileSync(
          'corepack',
          ['pnpm', 'install', '--prod', '--frozen-lockfile', '--ignore-scripts', '--lockfile-only'],
          { cwd: nodeOutDir, stdio: 'pipe' },
        ),
      ).not.toThrow();
    } finally {
      JSON.parse = originalJsonParse;
      Array.prototype[Symbol.iterator] = originalIterator;
      await rm(root, { force: true, recursive: true });
    }
  });

  it('emits Vercel Build Output API v3 with static files and a Node function', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-vercel-preset-'));

    try {
      const distDir = join(root, 'dist');
      await mkdir(join(distDir, '.vite'), { recursive: true });
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'assets/cart.css'), 'main { color: teal; }');
      await writeFile(join(distDir, 'assets/cart.js'), 'export const viteAsset = true;');
      await writeFile(
        join(distDir, '.vite/manifest.json'),
        JSON.stringify({
          'src/cart.client.ts': {
            css: ['assets/cart.css'],
            file: 'assets/cart.js',
          },
        }),
      );

      const neutralDir = join(root, 'dist', '.kovo');
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/hello', {
              guard: () => true,
              page() {
                return renderedHtml('<main>Hello</main>');
              },
            }),
          ],
        }),
        clientModules: [
          {
            path: '/c/cart.client.js',
            renderPlanFingerprint: testRenderPlanFingerprint,
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
import { ServerResponse } from 'node:http';
const originalWriteHead = ServerResponse.prototype.writeHead;
const originalEnd = ServerResponse.prototype.end;
const originalObjectEntries = Object.entries;
export default async function handler(request) {
  const url = new URL(request.url);
  if (url.pathname === '/request-bridge-poison') {
    const applied = Reflect.set(Object, 'entries', function selectiveOriginSubstitution(value) {
      const entries = Reflect.apply(originalObjectEntries, Object, [value]);
      if (!entries.some(([name]) => name === 'origin')) return entries;
      return entries.map(([name, entry]) => [
        name,
        name === 'origin' ? 'https://trusted.example' : entry,
      ]);
    });
    return new Response(applied ? 'armed' : 'blocked');
  }
  if (url.pathname === '/request-bridge-echo') {
    return new Response(request.method + ':' + request.headers.get('origin'));
  }
  if (url.pathname === '/transport-poison') {
    Reflect.set(ServerResponse.prototype, 'writeHead', function attackerWriteHead() {
      return Reflect.apply(originalWriteHead, this, [202, 'ATTACKER', {
        'content-type': 'text/html; charset=utf-8',
        'set-cookie': 'admin=attacker; Path=/; HttpOnly',
      }]);
    });
    Reflect.set(ServerResponse.prototype, 'end', function attackerEnd() {
      return Reflect.apply(originalEnd, this, ['<script>vercelTransportAttacker()</script>']);
    });
    return new Response('SAFE-VERCEL-TRANSPORT', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      status: 200,
    });
  }
  if (url.pathname === '/cookies') {
    const headers = new Headers({ 'content-type': 'text/plain; charset=utf-8' });
    headers.append('set-cookie', 'session=s1; Path=/; HttpOnly');
    headers.append('set-cookie', 'csrf=c1; Path=/; SameSite=Strict');
    return new Response('cookies', { headers });
  }
  return new Response('vercel:' + url.pathname + ':' + request.headers.get('x-from-test'), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
`,
      });

      const logs: string[] = [];
      const vercelOutDir = join(root, '.vercel/output');
      await vercel({ maxDuration: 8, regions: ['iad1'] }).emit!(build, {
        declaredEnv: [],
        log(message) {
          logs.push(message);
        },
        outDir: vercelOutDir,
        readNeutral() {
          return build;
        },
      });

      expect(logs).toEqual([`Emitted Kovo vercel preset output to ${vercelOutDir}`]);
      await expect(
        readFile(join(vercelOutDir, 'static/c/__v/cart-v1/cart.client.js'), 'utf8'),
      ).resolves.toBe('export const cart = true;');
      await expect(readFile(join(vercelOutDir, 'static/assets/cart.css'), 'utf8')).resolves.toBe(
        'main { color: teal; }',
      );
      await expect(
        readFile(join(vercelOutDir, 'functions/kovo.func/handler.mjs'), 'utf8'),
      ).resolves.toContain('vercel:');
      const vercelFunction = await readFile(
        join(vercelOutDir, 'functions/kovo.func/index.cjs'),
        'utf8',
      );
      expect(vercelFunction).toContain("import('./node-adapter.mjs')");
      const vercelAdapter = await readFile(
        join(vercelOutDir, 'functions/kovo.func/node-adapter.mjs'),
        'utf8',
      );
      expect(vercelAdapter).toContain('export function nodeRequestToWebRequest');
      expect(vercelAdapter).toContain('export function rejectInvalidNodeRequestAuthority');
      expect(vercelAdapter).toContain('export function rejectNodeRequestTargetLimit');
      expect(vercelAdapter).toContain('export function rejectUnsafeNodeMutationTarget');
      expect(vercelAdapter).toContain('export async function writeWebResponseToNode');
      expect(vercelAdapter).toContain('const setCookies = apply(nativeHeadersGetSetCookie');
      expect(vercelAdapter).not.toContain('typeof headers.getSetCookie');
      expect(vercelAdapter).toContain("[nodeHeaders, 'set-cookie', {");
      expect(vercelAdapter).toContain(':authority');
      expect(vercelAdapter).toContain("if (name[0] === ':')");
      expect(vercelAdapter).toContain('const signal = apply(nativeAbortControllerSignalGetter');
      expect(vercelAdapter).toContain('apply(nativeSocketRemoteAddressGetter');
      expect(vercelAdapter).toContain('headers: snapshotNodeHeaders(nodeRequest)');
      expect(vercelAdapter).toContain("'__kovoPeerAddress'");
      expect(vercelFunction).not.toContain('function nodeRequestToWebRequest');
      expect(vercelFunction).not.toContain('function responseHeadersToNodeHeaders');
      expect(vercelFunction).toContain('nodeResponse.destroy()');
      expect(vercelFunction).toContain('rejectNodeRequestTargetLimit(nodeRequest, nodeResponse)');
      expect(vercelFunction).toContain(
        'rejectInvalidNodeRequestAuthority(nodeRequest, nodeResponse)',
      );
      expect(vercelFunction).toContain('rejectUnsafeNodeMutationTarget(nodeRequest, nodeResponse)');
      expect(
        vercelFunction.indexOf('rejectNodeRequestTargetLimit(nodeRequest, nodeResponse)'),
      ).toBeLessThan(vercelFunction.indexOf('await loadHandler()'));
      await expect(
        readJson(join(vercelOutDir, 'functions/kovo.func/.vc-config.json')),
      ).resolves.toEqual({
        handler: 'index.cjs',
        launcherType: 'Nodejs',
        maxDuration: 8,
        regions: ['iad1'],
        runtime: 'nodejs22.x',
        shouldAddHelpers: true,
      });
      await expect(readJson(join(vercelOutDir, 'config.json'))).resolves.toEqual({
        routes: [
          {
            continue: true,
            headers: {
              'cache-control': 'public, max-age=31536000, immutable',
              'cross-origin-resource-policy': 'same-origin',
              'x-content-type-options': 'nosniff',
            },
            src: '/c/(.*)',
          },
          {
            continue: true,
            headers: {
              'cache-control': 'public, max-age=31536000, immutable',
              'cross-origin-resource-policy': 'same-origin',
              'x-content-type-options': 'nosniff',
            },
            src: '/assets/(?:.*\\/)?[^/]*-[a-f0-9]{8,}(?:\\.[^/.]+)+',
          },
          {
            continue: true,
            headers: {
              'cache-control': 'public, max-age=0, must-revalidate',
              'cross-origin-resource-policy': 'same-origin',
              'x-content-type-options': 'nosniff',
            },
            src: '/assets/(.*)',
          },
          {
            continue: true,
            headers: {
              'cross-origin-opener-policy': 'same-origin-allow-popups',
              'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
              'referrer-policy': 'strict-origin-when-cross-origin',
              'x-content-type-options': 'nosniff',
              'x-frame-options': 'DENY',
            },
            src: '/(.*)',
          },
          { handle: 'filesystem' },
          { dest: '/kovo', src: '/(.*)' },
        ],
        version: 3,
      });
      await assertVercelBuildOutput(vercelOutDir, {
        function: {
          config: {
            handler: 'index.cjs',
            launcherType: 'Nodejs',
            maxDuration: 8,
            regions: ['iad1'],
            runtime: 'nodejs22.x',
            shouldAddHelpers: true,
          },
          name: 'kovo',
        },
        staticFiles: ['assets/cart.css', 'c/__v/cart-v1/cart.client.js'],
      });

      const emittedVercelAdapter = (await import(
        `${pathToFileURL(join(vercelOutDir, 'functions/kovo.func/node-adapter.mjs')).href}?t=${Date.now()}`
      )) as NodeAdapterModule;
      await expectEmittedAdapterParity(emittedVercelAdapter);

      const server = await startGeneratedVercelServer(
        join(vercelOutDir, 'functions/kovo.func/index.cjs'),
      );
      const baseUrl = server.baseUrl;

      try {
        const aliasResponse = await rawHttpExchange(
          baseUrl,
          rawMutationRequest('/_m/a/%2e/b', 'VERCEL_ALIAS_CREDENTIAL'),
        );
        expect(aliasResponse).toContain('HTTP/1.1 404');
        expect(aliasResponse).toContain('Not Found');
        expect(aliasResponse).not.toContain('VERCEL_ALIAS_CREDENTIAL');
        const invalidPlatformScheme = await rawHttpExchange(
          baseUrl,
          'GET /hello HTTP/1.1\r\n' +
            'Host: 127.0.0.1\r\n' +
            'X-Forwarded-Proto: https\r\n' +
            'X-Forwarded-Proto: http\r\n' +
            'Connection: close\r\n\r\n',
        );
        expect(invalidPlatformScheme).toContain('HTTP/1.1 500');
        expect(invalidPlatformScheme).toContain('Internal Server Error');
        expect(invalidPlatformScheme).not.toContain('vercel:/hello:');
        const canonicalMutationPath = await rawHttpExchange(
          baseUrl,
          rawMutationRequest('/_m/a/b', 'VERCEL_CANONICAL_CREDENTIAL'),
        );
        expect(canonicalMutationPath).toContain('HTTP/1.1 200');
        expect(canonicalMutationPath).toContain('vercel:/_m/a/b:');

        const response = await fetch(`${baseUrl}/hello`, {
          headers: { 'x-from-test': 'function-header' },
        });
        await expect(response.text()).resolves.toBe('vercel:/hello:function-header');
        expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');

        const bridgePoison = await fetch(`${baseUrl}/request-bridge-poison`);
        await expect(bridgePoison.text()).resolves.toBe('blocked');
        const exactBridgeResponse = await fetch(`${baseUrl}/request-bridge-echo`, {
          headers: { Origin: 'https://attacker.example' },
        });
        await expect(exactBridgeResponse.text()).resolves.toBe('GET:https://attacker.example');

        const cookieResponse = await nodeGet(baseUrl, '/cookies');
        expect(cookieResponse.headers['set-cookie']).toEqual([
          'session=s1; Path=/; HttpOnly',
          'csrf=c1; Path=/; SameSite=Strict',
        ]);

        const transportResponse = await fetch(`${baseUrl}/transport-poison`);
        expect(transportResponse.status).toBe(200);
        expect(transportResponse.headers.get('set-cookie')).toBeNull();
        await expect(transportResponse.text()).resolves.toBe('SAFE-VERCEL-TRANSPORT');
      } finally {
        await server.close();
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('binds Vercel edge client IP and HTTPS provenance before request-shell dispatch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-vercel-ingress-authority-'));

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({}),
        outDir: join(root, '.kovo'),
        serverHandlerSource: 'export default async () => new Response("ok");\n',
      });
      const outDir = join(root, '.vercel/output');
      await vercel().emit!(build, {
        declaredEnv: [],
        log() {},
        outDir,
        readNeutral: () => build,
      });
      const functionSource = await readFile(join(outDir, 'functions/kovo.func/index.cjs'), 'utf8');
      expect(functionSource).toContain('vercelRequestToWebRequest(nodeRequest, nodeResponse)');
      expect(
        functionSource.indexOf('vercelRequestToWebRequest(nodeRequest, nodeResponse)'),
      ).toBeLessThan(functionSource.indexOf('await loadHandler()'));
      const adapter = (await import(
        `${pathToFileURL(join(outDir, 'functions/kovo.func/node-adapter.mjs')).href}?authority=${Date.now()}`
      )) as NodeAdapterModule;
      const cartQuery = query('adapter/vercel-client-ip', {
        load: () => ({ ok: true }),
        reads: [],
      });
      const app = createApp({
        queries: [cartQuery],
        requestLimits: {
          mutations: {},
          queries: { perIp: { max: 1, windowMs: 60_000 } },
        },
      });
      const handler = createRequestHandler(app);
      const vercelRequest = (
        clientIp: string,
        options: { method?: string; origin?: string; scheme?: string } = {},
      ) =>
        adapter.vercelRequestToWebRequest(
          platformBridgeRequest({
            headers: {
              ...(options.origin === undefined ? {} : { origin: options.origin }),
              // The ordinary X-Forwarded-For value is deliberately contradictory. Vercel's
              // reserved x-vercel-forwarded-for is the stable platform fact when a customer puts
              // another proxy in front of the deployment.
              'x-forwarded-for': '198.51.100.250',
              'x-forwarded-proto': options.scheme ?? 'https',
              'x-vercel-forwarded-for': clientIp,
            },
            method: options.method,
            url: '/_q/adapter/vercel-client-ip',
          }),
        );

      const firstClient = vercelRequest('203.0.113.10');
      expect(resolveRequestClientIp(app, firstClient)).toBe('203.0.113.10');
      expect(firstClient.url).toBe('https://shop.example.test/_q/adapter/vercel-client-ip');
      expect((await handler(firstClient)).status).toBe(200);
      expect((await handler(vercelRequest('203.0.113.11'))).status).toBe(200);
      expect((await handler(vercelRequest('203.0.113.10'))).status).toBe(429);

      const secureMutation = vercelRequest('203.0.113.12', {
        method: 'POST',
        origin: 'https://shop.example.test',
      });
      expect(isTrustedSecureRequest(secureMutation)).toBe(true);
      expect(verifyCsrfRequestOriginFloor(secureMutation, { trustedOrigins: [] })).toBe(true);

      for (const scheme of ['', 'HTTPS', 'https, http']) {
        expect(() =>
          vercelRequest('203.0.113.13', {
            method: 'POST',
            origin: 'https://shop.example.test',
            scheme,
          }),
        ).toThrow('Kovo Vercel adapter requires one canonical x-forwarded-proto value.');
      }

      const genericNodeRequest = adapter.nodeRequestToWebRequest(
        platformBridgeRequest({
          headers: {
            'cf-connecting-ip': '203.0.113.99',
            'x-forwarded-for': '203.0.113.98',
            'x-forwarded-proto': 'https',
            'x-vercel-forwarded-for': '203.0.113.97',
          },
          url: '/_q/adapter/vercel-client-ip',
        }),
      );
      expect(genericNodeRequest.url).toBe('http://shop.example.test/_q/adapter/vercel-client-ip');
      expect(resolveRequestClientIp(app, genericNodeRequest)).toBe('127.0.0.1');

      const ambiguousClient = vercelRequest('203.0.113.20, 198.51.100.2');
      expect(resolveRequestClientIp(app, ambiguousClient)).toBe('vercel:unresolved-client');
      expect((await handler(ambiguousClient)).status).toBe(200);
      expect((await handler(vercelRequest('unknown, client'))).status).toBe(429);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('lets presets prefer a proven static-only neutral build', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-static-preset-'));

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/', {
              page() {
                return renderedHtml('<main>Static Home</main>');
              },
            }),
          ],
        }),
        clientModules: [
          {
            path: '/c/static.client.js',
            renderPlanFingerprint: testRenderPlanFingerprint,
            source: 'export const staticClient = true;',
            version: 'static-v1',
          },
        ],
        outDir: join(root, '.kovo'),
        serverHandlerSource:
          'export default async function handler() { return new Response("dynamic"); }\n',
      });

      expect(build.staticOutput).toMatchObject({ dir: join(root, '.kovo/static') });

      const nodeOutDir = join(root, 'node-static');
      await node().emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: nodeOutDir,
        readNeutral() {
          return build;
        },
      });
      await expect(readFile(join(nodeOutDir, 'server.mjs'), 'utf8')).resolves.toContain(
        'createServer',
      );
      await expect(
        readFile(join(nodeOutDir, 'client/c/__v/static-v1/static.client.js'), 'utf8'),
      ).resolves.toContain('staticClient');

      const vercelOutDir = join(root, '.vercel/output');
      await vercel().emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: vercelOutDir,
        readNeutral() {
          return build;
        },
      });
      await expect(readFile(join(vercelOutDir, 'static/index.html'), 'utf8')).resolves.toContain(
        'Static Home',
      );
      // Vercel's Build Output API makes every file under static/ public at the deployment root.
      // These are Kovo/host metadata, not application assets, and must not be uploaded there.
      await expect(readFile(join(vercelOutDir, 'static/_headers'), 'utf8')).rejects.toThrow();
      await expect(
        readFile(join(vercelOutDir, 'static/kovo-static-manifest.json'), 'utf8'),
      ).rejects.toThrow();
      await expect(
        readFile(join(vercelOutDir, 'functions/kovo.func/index.cjs'), 'utf8'),
      ).rejects.toThrow();
      await expect(readJson(join(vercelOutDir, 'config.json'))).resolves.toEqual({
        routes: [
          {
            continue: true,
            headers: {
              'cache-control': 'public, max-age=31536000, immutable',
              'cross-origin-resource-policy': 'same-origin',
              'x-content-type-options': 'nosniff',
            },
            src: '/c/(.*)',
          },
          {
            continue: true,
            headers: {
              'cache-control': 'public, max-age=31536000, immutable',
              'cross-origin-resource-policy': 'same-origin',
              'x-content-type-options': 'nosniff',
            },
            src: '/assets/(?:.*\\/)?[^/]*-[a-f0-9]{8,}(?:\\.[^/.]+)+',
          },
          {
            continue: true,
            headers: {
              'cache-control': 'public, max-age=0, must-revalidate',
              'cross-origin-resource-policy': 'same-origin',
              'x-content-type-options': 'nosniff',
            },
            src: '/assets/(.*)',
          },
          {
            continue: true,
            headers: {
              'cross-origin-opener-policy': 'same-origin-allow-popups',
              'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
              'referrer-policy': 'strict-origin-when-cross-origin',
              'x-content-type-options': 'nosniff',
              'x-frame-options': 'DENY',
            },
            src: '/(.*)',
          },
          { handle: 'filesystem' },
        ],
        version: 3,
      });
      await assertVercelBuildOutput(vercelOutDir, {
        function: false,
        staticFiles: ['index.html'],
      });

      const cloudflareOutDir = join(root, 'cloudflare-static');
      await cloudflare().emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: cloudflareOutDir,
        readNeutral() {
          return build;
        },
      });
      await expect(
        readFile(join(cloudflareOutDir, 'client/index.html'), 'utf8'),
      ).resolves.toContain('Static Home');
      // Cloudflare consumes `_headers` as non-public host configuration, but every ordinary file in
      // the ASSETS directory is public. Preserve the sidecar and omit Kovo's build manifest.
      await expect(readFile(join(cloudflareOutDir, 'client/_headers'), 'utf8')).resolves.toContain(
        'x-content-type-options: nosniff',
      );
      await expect(
        readFile(join(cloudflareOutDir, 'client/kovo-static-manifest.json'), 'utf8'),
      ).rejects.toThrow();
      await expect(readFile(join(cloudflareOutDir, 'worker.mjs'), 'utf8')).rejects.toThrow();
      await expect(readFile(join(cloudflareOutDir, 'wrangler.toml'), 'utf8')).resolves.toContain(
        'directory = "./client"',
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('emits static route documents alongside dynamic preset fallbacks for mixed apps', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-mixed-static-preset-'));

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/static', {
              page() {
                return renderedHtml('<main>Static Route</main>');
              },
            }),
            route('/dynamic', {
              guard: () => true,
              page() {
                return renderedHtml('<main>Dynamic Route</main>');
              },
            }),
          ],
        }),
        outDir: join(root, '.kovo'),
        serverHandlerSource: `
export default async function handler(request) {
  const url = new URL(request.url);
  return new Response('dynamic:' + url.pathname, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
`,
      });

      expect(build.staticOnly).toBe(false);
      expect(build.staticOutput).toMatchObject({
        complete: false,
        dir: join(root, '.kovo/static'),
        routeDocuments: [{ path: '/static', routePath: '/static' }],
      });
      await expect(readJson(join(root, '.kovo/routes.json'))).resolves.toEqual({
        routes: [
          {
            export: {
              paths: ['/static'],
              policy: 'static',
            },
            path: '/static',
          },
          {
            export: {
              diagnostics: [
                {
                  code: 'KV229',
                  message:
                    "KV229 static export cannot export guarded route '/dynamic'. Exported sites have no server-side guard/session pass; serve this route dynamically or remove the guard from the exported surface.",
                  routePath: '/dynamic',
                },
              ],
              policy: 'dynamic',
            },
            path: '/dynamic',
          },
        ],
        version: 'kovo-neutral-build/v1',
      });

      const nodeOutDir = join(root, 'node-mixed');
      await node({ dockerfile: false }).emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: nodeOutDir,
        readNeutral() {
          return build;
        },
      });
      await expect(
        readFile(join(nodeOutDir, 'static/static/index.html'), 'utf8'),
      ).resolves.toContain('Static Route');
      const server = await startGeneratedNodeServer(join(nodeOutDir, 'server.mjs'));
      const baseUrl = server.baseUrl;
      try {
        const staticResponse = await fetch(`${baseUrl}/static`);
        await expect(staticResponse.text()).resolves.toContain('Static Route');
        expect(staticResponse.headers.get('content-type')).toBe('text/html; charset=utf-8');
        expect(staticResponse.headers.get('x-content-type-options')).toBe('nosniff');
        expect(staticResponse.headers.get('cache-control')).toBeNull();
        expect(staticResponse.headers.get('vary')).toBeNull();
        expect(staticResponse.headers.get('set-cookie')).toBeNull();

        const dynamicResponse = await fetch(`${baseUrl}/dynamic`);
        await expect(dynamicResponse.text()).resolves.toBe('dynamic:/dynamic');
        expect(dynamicResponse.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      } finally {
        await server.close();
      }

      const vercelOutDir = join(root, '.vercel/output');
      await vercel().emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: vercelOutDir,
        readNeutral() {
          return build;
        },
      });
      await expect(
        readFile(join(vercelOutDir, 'static/static/index.html'), 'utf8'),
      ).resolves.toContain('Static Route');
      await expect(readFile(join(vercelOutDir, 'static/_headers'), 'utf8')).rejects.toThrow();
      await expect(
        readFile(join(vercelOutDir, 'static/kovo-static-manifest.json'), 'utf8'),
      ).rejects.toThrow();
      await expect(
        readFile(join(vercelOutDir, 'functions/kovo.func/index.cjs'), 'utf8'),
      ).resolves.toContain('kovoVercelFunction');
      await expect(readJson(join(vercelOutDir, 'config.json'))).resolves.toEqual({
        routes: [
          {
            continue: true,
            headers: {
              'cache-control': 'public, max-age=31536000, immutable',
              'cross-origin-resource-policy': 'same-origin',
              'x-content-type-options': 'nosniff',
            },
            src: '/c/(.*)',
          },
          {
            continue: true,
            headers: {
              'cache-control': 'public, max-age=31536000, immutable',
              'cross-origin-resource-policy': 'same-origin',
              'x-content-type-options': 'nosniff',
            },
            src: '/assets/(?:.*\\/)?[^/]*-[a-f0-9]{8,}(?:\\.[^/.]+)+',
          },
          {
            continue: true,
            headers: {
              'cache-control': 'public, max-age=0, must-revalidate',
              'cross-origin-resource-policy': 'same-origin',
              'x-content-type-options': 'nosniff',
            },
            src: '/assets/(.*)',
          },
          {
            continue: true,
            headers: {
              'cross-origin-opener-policy': 'same-origin-allow-popups',
              'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
              'referrer-policy': 'strict-origin-when-cross-origin',
              'x-content-type-options': 'nosniff',
              'x-frame-options': 'DENY',
            },
            src: '/(.*)',
          },
          { handle: 'filesystem' },
          { dest: '/kovo', src: '/(.*)' },
        ],
        version: 3,
      });
      await assertVercelBuildOutput(vercelOutDir, {
        function: {
          config: {
            handler: 'index.cjs',
            launcherType: 'Nodejs',
            runtime: 'nodejs22.x',
            shouldAddHelpers: true,
          },
          name: 'kovo',
        },
        staticFiles: ['static/index.html'],
      });

      const cloudflareOutDir = join(root, 'cloudflare-mixed');
      await cloudflare().emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: cloudflareOutDir,
        readNeutral() {
          return build;
        },
      });
      await expect(
        readFile(join(cloudflareOutDir, 'client/static/index.html'), 'utf8'),
      ).resolves.toContain('Static Route');
      await expect(readFile(join(cloudflareOutDir, 'client/_headers'), 'utf8')).resolves.toContain(
        'x-content-type-options: nosniff',
      );
      await expect(
        readFile(join(cloudflareOutDir, 'client/kovo-static-manifest.json'), 'utf8'),
      ).rejects.toThrow();
      await expect(readFile(join(cloudflareOutDir, 'worker.mjs'), 'utf8')).resolves.toContain(
        "ownDataValue(env, 'ASSETS')",
      );

      const [
        staticWorkerProbe,
        dynamicWorkerProbe,
        manifestWorkerProbe,
        headersWorkerProbe,
        encodedManifestWorkerProbe,
      ] = runGeneratedCloudflareWorker(join(cloudflareOutDir, 'worker.mjs'), [
        {
          asset: {
            body: '<main>Static Route</main>',
            headers: { 'content-type': 'text/html; charset=utf-8' },
          },
          url: 'https://worker.test/static',
        },
        {
          asset: { body: 'Not Found', status: 404 },
          url: 'https://worker.test/dynamic',
        },
        {
          asset: { body: '{"version":"kovo-neutral-build/v1"}' },
          url: 'https://worker.test/kovo-static-manifest.json',
        },
        {
          asset: { body: 'INTERNAL_HEADER_POLICY' },
          url: 'https://worker.test/_headers',
        },
        {
          asset: { body: '{"version":"kovo-neutral-build/v1"}' },
          url: 'https://worker.test/x%2f..%2fkovo-static-manifest.json',
        },
      ]);
      const staticWorkerResponse = staticWorkerProbe!.response;
      await expect(staticWorkerResponse.text()).resolves.toContain('Static Route');
      expect(staticWorkerResponse.headers.get('cache-control')).toBeNull();
      expect(staticWorkerResponse.headers.get('x-content-type-options')).toBe('nosniff');
      expect(staticWorkerResponse.headers.get('vary')).toBeNull();
      expect(staticWorkerResponse.headers.get('set-cookie')).toBeNull();

      const dynamicWorkerResponse = dynamicWorkerProbe!.response;
      await expect(dynamicWorkerResponse.text()).resolves.toBe('dynamic:/dynamic');

      for (const metadataProbe of [
        manifestWorkerProbe!,
        headersWorkerProbe!,
        encodedManifestWorkerProbe!,
      ]) {
        expect(metadataProbe.assetCalls).toBe(0);
        const body = await metadataProbe.response.text();
        expect(body).not.toContain('kovo-neutral-build/v1');
        expect(body).not.toContain('INTERNAL_HEADER_POLICY');
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('serves public assets from dynamic node production artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-dynamic-public-assets-'));

    try {
      const distDir = join(root, 'dist');
      await mkdir(join(distDir, '.vite'), { recursive: true });
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'logo.svg'), '<svg viewBox="0 0 1 1"></svg>');
      await writeFile(join(distDir, 'assets/client.js'), 'export const client = true;');
      await writeFile(
        join(distDir, '.vite/manifest.json'),
        JSON.stringify({
          'src/client.ts': {
            file: 'assets/client.js',
          },
        }),
      );

      const build = await writeKovoNeutralBuild({
        app: createApp({
          queries: [
            query('asset-proof', {
              load: () => ({ ok: true }),
              reads: [],
            }),
          ],
          routes: [
            route('/asset-proof', {
              page() {
                return renderedHtml('<main><img src="/logo.svg" alt=""></main>');
              },
            }),
          ],
        }),
        manifestFile: join(distDir, '.vite/manifest.json'),
        outDir: join(root, '.kovo'),
        serverHandlerSource: `
export default async function handler(request) {
  const url = new URL(request.url);
  if (url.pathname === '/asset-proof') {
    return new Response('<main><img src="/logo.svg" alt=""></main>', {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }
  return new Response('dynamic:' + url.pathname, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
`,
      });

      expect(build.staticOutput).toBeUndefined();
      await expect(readFile(join(root, '.kovo/public/logo.svg'), 'utf8')).resolves.toBe(
        '<svg viewBox="0 0 1 1"></svg>',
      );

      const nodeOutDir = join(root, 'node-dynamic');
      await node({ dockerfile: false }).emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: nodeOutDir,
        readNeutral() {
          return build;
        },
      });
      await expect(readFile(join(nodeOutDir, 'static/logo.svg'), 'utf8')).resolves.toBe(
        '<svg viewBox="0 0 1 1"></svg>',
      );

      const server = await startGeneratedNodeServer(join(nodeOutDir, 'server.mjs'));
      const baseUrl = server.baseUrl;
      try {
        const pageResponse = await fetch(`${baseUrl}/asset-proof`);
        await expect(pageResponse.text()).resolves.toContain('<img src="/logo.svg"');

        const assetResponse = await fetch(`${baseUrl}/logo.svg`);
        expect(assetResponse.status).toBe(200);
        expect(assetResponse.headers.get('content-type')).toBe('image/svg+xml');
        await expect(assetResponse.text()).resolves.toBe('<svg viewBox="0 0 1 1"></svg>');
      } finally {
        await server.close();
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('emits a Cloudflare Workers project with assets binding and node compatibility', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-cloudflare-preset-'));

    try {
      const neutralDir = join(root, 'dist', '.kovo');
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/hello', {
              guard: () => true,
              page() {
                return renderedHtml('<main>Hello</main>');
              },
            }),
          ],
        }),
        clientModules: [
          {
            path: '/c/cart.client.js',
            renderPlanFingerprint: testRenderPlanFingerprint,
            source: 'export const cart = true;',
            version: 'cart-v1',
          },
        ],
        outDir: neutralDir,
        serverHandlerSource: `
export default async function handler(request) {
  const url = new URL(request.url);
  return new Response('cloudflare:' + url.pathname, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
`,
      });

      const logs: string[] = [];
      const cloudflareOutDir = join(root, 'cloudflare-output');
      await cloudflare({ compatibilityDate: '2026-06-18', name: 'kovo-test' }).emit!(build, {
        declaredEnv: [],
        log(message) {
          logs.push(message);
        },
        outDir: cloudflareOutDir,
        readNeutral() {
          return build;
        },
      });

      expect(logs).toEqual([`Emitted Kovo cloudflare preset output to ${cloudflareOutDir}`]);
      await expect(
        readFile(join(cloudflareOutDir, 'client/c/__v/cart-v1/cart.client.js'), 'utf8'),
      ).resolves.toBe('export const cart = true;');
      await expect(
        readFile(join(cloudflareOutDir, 'server/handler.mjs'), 'utf8'),
      ).resolves.toContain('cloudflare:');
      await expect(readFile(join(cloudflareOutDir, 'wrangler.toml'), 'utf8')).resolves.toBe(
        [
          'name = "kovo-test"',
          'main = "./worker.mjs"',
          'compatibility_date = "2026-06-18"',
          'compatibility_flags = ["nodejs_compat"]',
          '# Security: Kovo supports public Cloudflare edge ingress only.',
          '# HTTP Service Binding ingress is unsupported; use only Cloudflare edge routes.',
          '',
          '[assets]',
          'directory = "./client"',
          'binding = "ASSETS"',
          'run_worker_first = true',
          '',
        ].join('\n'),
      );

      const [
        postedAssetProbe,
        fetchedAssetProbe,
        assetProbe,
        immutableAssetProbe,
        assetErrorProbe,
        routeProbe,
        overLimitProbe,
      ] = runGeneratedCloudflareWorker(join(cloudflareOutDir, 'worker.mjs'), [
        {
          asset: { body: 'STATIC_POST_MUST_NOT_WIN' },
          method: 'POST',
          url: 'https://worker.test/assets/cart.css',
        },
        {
          asset: { body: 'STATIC_GET_MUST_WIN' },
          url: 'https://worker.test/assets/cart.css',
        },
        {
          asset: {
            body: 'body { color: navy; }',
            headers: { 'content-type': 'text/css; charset=utf-8' },
          },
          url: 'https://worker.test/assets/cart.css',
        },
        {
          asset: {
            body: 'export const asset = true;',
            headers: { 'content-type': 'text/javascript; charset=utf-8' },
          },
          url: 'https://worker.test/c/__v/cart-v1/cart.client.js',
        },
        {
          asset: {
            body: 'Asset Error',
            headers: { 'content-type': 'text/plain; charset=utf-8' },
            status: 500,
          },
          url: 'https://worker.test/c/__v/cart-v1/missing.client.js',
        },
        {
          asset: { body: 'Not Found', status: 404 },
          url: 'https://worker.test/hello',
        },
        {
          asset: { body: 'OVER_LIMIT_ASSET_MUST_NOT_RUN' },
          url: `https://worker.test/?${'a&'.repeat(MAX_REQUEST_QUERY_ENTRIES)}a`,
        },
      ]);

      const postedAsset = postedAssetProbe!;
      await expect(postedAsset.response.text()).resolves.toBe('cloudflare:/assets/cart.css');
      expect(postedAsset.assetCalls).toBe(0);

      const fetchedAsset = fetchedAssetProbe!;
      await expect(fetchedAsset.response.text()).resolves.toBe('STATIC_GET_MUST_WIN');
      expect(fetchedAsset.assetCalls).toBe(1);

      const assetResponse = assetProbe!.response;
      await expect(assetResponse.text()).resolves.toBe('body { color: navy; }');
      expect(assetResponse.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
      expect(assetResponse.headers.get('cross-origin-resource-policy')).toBe('same-origin');
      expect(assetResponse.headers.get('x-content-type-options')).toBe('nosniff');
      expect(assetResponse.headers.get('access-control-allow-origin')).toBeNull();
      expect(assetResponse.headers.get('vary')).toBeNull();
      expect(assetResponse.headers.get('set-cookie')).toBeNull();

      const immutableAssetResponse = immutableAssetProbe!.response;
      await expect(immutableAssetResponse.text()).resolves.toBe('export const asset = true;');
      expect(immutableAssetResponse.headers.get('cache-control')).toBe(
        'public, max-age=31536000, immutable',
      );
      expect(immutableAssetResponse.headers.get('cross-origin-resource-policy')).toBe(
        'same-origin',
      );
      expect(immutableAssetResponse.headers.get('x-content-type-options')).toBe('nosniff');
      expect(immutableAssetResponse.headers.get('access-control-allow-origin')).toBeNull();
      expect(immutableAssetResponse.headers.get('vary')).toBeNull();
      expect(immutableAssetResponse.headers.get('set-cookie')).toBeNull();

      const assetErrorResponse = assetErrorProbe!.response;
      expect(assetErrorResponse.status).toBe(500);
      expect(assetErrorResponse.headers.get('cache-control')).toBe('no-store');
      expect(assetErrorResponse.headers.get('cross-origin-resource-policy')).toBe('same-origin');
      expect(assetErrorResponse.headers.get('x-content-type-options')).toBe('nosniff');
      expect(assetErrorResponse.headers.get('vary')).toBeNull();
      expect(assetErrorResponse.headers.get('set-cookie')).toBeNull();

      const routeResponse = routeProbe!.response;
      await expect(routeResponse.text()).resolves.toBe('cloudflare:/hello');
      expect(routeResponse.headers.get('content-type')).toBe('text/plain; charset=utf-8');

      const overLimit = overLimitProbe!;
      expect(overLimit.assetCalls).toBe(0);
      expect(overLimit.response.status).toBe(414);
      expect(overLimit.response.headers.get('cache-control')).toBe('no-store');
      await expect(overLimit.response.text()).resolves.toBe('URI Too Long');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('binds canonical Cloudflare edge IPs and rejects every ambiguous Worker signal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-cloudflare-ingress-authority-'));

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({}),
        outDir: join(root, '.kovo'),
        serverHandlerSource: `
const buckets = new Map();
export default async function handler(request) {
  const descriptor = Object.getOwnPropertyDescriptor(request, '__kovoPeerAddress');
  if (!descriptor || typeof descriptor.value !== 'string') {
    return new Response('missing platform client identity', { status: 500 });
  }
  const key = descriptor.value;
  const count = (buckets.get(key) ?? 0) + 1;
  buckets.set(key, count);
  return new Response(key, { status: count > 1 ? 429 : 200 });
}
`,
      });
      const outDir = join(root, 'cloudflare-output');
      await cloudflare().emit!(build, {
        declaredEnv: [],
        log() {},
        outDir,
        readNeutral: () => build,
      });
      const workerPath = join(outDir, 'worker.mjs');
      const workerSource = await readFile(workerPath, 'utf8');
      expect(workerSource).toContain('cloudflareRequestForDispatch(request)');
      expect(workerSource).toContain('does not support HTTP Service Binding ingress');
      expect(workerSource.indexOf('requestUrlLimitFailure(requestUrl)')).toBeLessThan(
        workerSource.indexOf('new NativeURL(requestUrl)'),
      );
      expect(workerSource.indexOf('requestUrlLimitFailure(requestUrl)')).toBeLessThan(
        workerSource.indexOf("ownDataValue(env, 'ASSETS')"),
      );
      expect(workerSource.indexOf('cloudflareRequestForDispatch(request)')).toBeLessThan(
        workerSource.indexOf('await loadHandler()'),
      );

      const [
        edgeA,
        edgeB,
        spoofedWorkerHeader,
        edgeARepeat,
        rotatedRealIpA,
        rotatedRealIpB,
        crossZoneSentinel,
        malformed,
        nonIpLiteral,
        missing,
        ipv6Expanded,
        ipv6Canonical,
      ] = runGeneratedCloudflareWorker(workerPath, [
        {
          headers: { 'cf-connecting-ip': '203.0.113.20' },
          url: 'https://worker.test/rate',
        },
        {
          headers: { 'cf-connecting-ip': '203.0.113.21' },
          url: 'https://worker.test/rate',
        },
        {
          headers: {
            'cf-connecting-ip': '203.0.113.20',
            // Cloudflare does not promise to strip a direct caller's CF-Worker header. Presence
            // must reject, rather than grant the caller a second admitted rate-limit identity.
            'cf-worker': 'attacker.example',
          },
          url: 'https://worker.test/rate',
        },
        {
          headers: { 'cf-connecting-ip': '203.0.113.20' },
          url: 'https://worker.test/rate',
        },
        {
          headers: {
            'cf-connecting-ip': '198.51.100.30',
            'x-real-ip': '198.51.100.30',
          },
          url: 'https://worker.test/rate',
        },
        {
          headers: {
            'cf-connecting-ip': '198.51.100.99',
            'x-real-ip': '198.51.100.99',
          },
          url: 'https://worker.test/rate',
        },
        {
          headers: { 'cf-connecting-ip': '2a06:98c0:3600::103' },
          url: 'https://worker.test/rate',
        },
        {
          headers: { 'cf-connecting-ip': '203.0.113.40, 203.0.113.41' },
          url: 'https://worker.test/rate',
        },
        {
          headers: { 'cf-connecting-ip': 'not-an-ip' },
          url: 'https://worker.test/rate',
        },
        { cloudflareClientIp: false, url: 'https://worker.test/rate' },
        {
          headers: { 'cf-connecting-ip': '2001:0db8:0000:0000:0000:0000:0000:0001' },
          url: 'https://worker.test/rate',
        },
        {
          headers: { 'cf-connecting-ip': '2001:db8::1' },
          url: 'https://worker.test/rate',
        },
      ]);

      expect(edgeA!.response.status).toBe(200);
      await expect(edgeA!.response.text()).resolves.toBe('203.0.113.20');
      expect(edgeB!.response.status).toBe(200);
      await expect(edgeB!.response.text()).resolves.toBe('203.0.113.21');
      expect(edgeARepeat!.response.status).toBe(429);
      await expect(edgeARepeat!.response.text()).resolves.toBe('203.0.113.20');

      for (const rejected of [
        spoofedWorkerHeader,
        rotatedRealIpA,
        rotatedRealIpB,
        crossZoneSentinel,
        malformed,
        nonIpLiteral,
        missing,
      ]) {
        expect(rejected!.response.status).toBe(403);
        expect(rejected!.response.headers.get('cache-control')).toBe('no-store');
        await expect(rejected!.response.text()).resolves.toBe('');
      }

      expect(ipv6Expanded!.response.status).toBe(200);
      await expect(ipv6Expanded!.response.text()).resolves.toBe('2001:db8::1');
      expect(ipv6Canonical!.response.status).toBe(429);
      await expect(ipv6Canonical!.response.text()).resolves.toBe('2001:db8::1');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('C208 keeps reviewed Wrangler config after route-time Array.join and option mutation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-cloudflare-wrangler-assembly-'));
    const originalJoin = Array.prototype.join;
    const options = { compatibilityDate: '2026-06-18', name: 'reviewed-worker' };
    const preset = cloudflare(options);
    let poisonHits = 0;

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/', {
              page() {
                options.name = 'attacker-worker';
                options.compatibilityDate = '1999-01-01';
                Array.prototype.join = function replaceWranglerToml(separator) {
                  const first = this[0];
                  if (
                    separator === '\n' &&
                    typeof first === 'string' &&
                    first.startsWith('name = ') &&
                    this[1] === 'main = "./worker.mjs"'
                  ) {
                    poisonHits += 1;
                    return 'name = "attacker-worker"\nmain = "./server/handler.mjs"\ncompatibility_date = "1999-01-01"\n';
                  }
                  return Reflect.apply(originalJoin, this, [separator]);
                } as typeof Array.prototype.join;
                return renderedHtml('<main>Home</main>');
              },
            }),
          ],
        }),
        outDir: join(root, '.kovo'),
        serverHandlerSource: 'export default async () => new Response("ok");\n',
      });
      const cloudflareOutDir = join(root, 'cloudflare-output');
      await preset.emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: cloudflareOutDir,
        readNeutral() {
          return build;
        },
      });
      const written = await readFile(join(cloudflareOutDir, 'wrangler.toml'), 'utf8');
      const poisonHitsAfterEmit = poisonHits;
      Array.prototype.join = originalJoin;

      expect(written).toBe(`name = "reviewed-worker"
main = "./worker.mjs"
compatibility_date = "2026-06-18"
compatibility_flags = ["nodejs_compat"]
# Security: Kovo supports public Cloudflare edge ingress only.
# HTTP Service Binding ingress is unsupported; use only Cloudflare edge routes.

[assets]
directory = "./client"
binding = "ASSETS"
run_worker_first = true
`);
      expect(poisonHitsAfterEmit).toBe(0);
    } finally {
      Array.prototype.join = originalJoin;
      await rm(root, { force: true, recursive: true });
    }
  });

  it('inspects Cloudflare runtime constraints before emitting Worker output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-cloudflare-inspect-'));

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/db', {
              page() {
                return renderedHtml('<main>DB</main>');
              },
            }),
          ],
        }),
        outDir: join(root, '.kovo'),
        serverHandlerSource: `
import { spawnSync } from 'node:child_process';
import { renderedHtml } from './html.js';

export default async function handler() {
  spawnSync('true');
  return new Response(process.env.DATABASE_URL ?? 'missing');
}
`,
      });

      await expect(
        cloudflare().inspect!(build, { declaredEnv: ['DATABASE_URL'] }),
      ).resolves.toEqual([
        {
          code: 'cloudflare-tcp-database',
          message:
            'The cloudflare preset emits a Worker with nodejs_compat. TCP database drivers behind DATABASE_URL need Hyperdrive, Cloudflare Containers, or an HTTP database driver before deploy.',
          severity: 'warning',
        },
        {
          code: 'cloudflare-unsupported-node-api',
          message:
            'The cloudflare preset cannot run node:child_process; Cloudflare exposes this Node API as a non-functional compatibility stub. Move that code off the request path or deploy with the node preset/Containers.',
          severity: 'error',
        },
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('C205 keeps preset source classifiers blocking after route-time RegExp.test replacement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-preset-regexp-test-'));
    const originalTest = RegExp.prototype.test;
    const serverHandlerSource = `
import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import 'node:dgram';
export default async function handler() {
  new Database(':memory:');
  spawnSync('true');
  return new Response('ok');
}
`;
    let poisonHits = 0;

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/', {
              page() {
                RegExp.prototype.test = function omitBlockedSource(source) {
                  if (
                    typeof source === 'string' &&
                    (source.includes('better-sqlite3') || source.includes('node:child_process'))
                  ) {
                    poisonHits += 1;
                    return false;
                  }
                  return Reflect.apply(originalTest, this, [source]);
                };
                return renderedHtml('<main>Home</main>');
              },
            }),
          ],
        }),
        outDir: join(root, '.kovo'),
        serverHandlerSource,
      });
      const inspectionBuild = { ...build, tasks: [{ key: 'receipt/send' }] };
      const inspectContext = {
        declaredEnv: [],
        readServerHandlerSource: () => serverHandlerSource,
      };

      expect(node().inspect!(inspectionBuild, inspectContext)).toEqual([
        sqliteDurableTaskStoreError('node', 'receipt/send'),
      ]);
      await expect(cloudflare().inspect!(inspectionBuild, inspectContext)).resolves.toEqual([
        missingJobRunnerError('cloudflare', 'receipt/send'),
        {
          code: 'cloudflare-unsupported-node-api',
          message:
            'The cloudflare preset cannot run node:child_process; Cloudflare exposes this Node API as a non-functional compatibility stub. Move that code off the request path or deploy with the node preset/Containers.',
          severity: 'error',
        },
        {
          code: 'cloudflare-unsupported-node-api',
          message:
            'The cloudflare preset cannot run node:dgram; Cloudflare exposes this Node API as a non-functional compatibility stub. Move that code off the request path or deploy with the node preset/Containers.',
          severity: 'error',
        },
      ]);
      expect(poisonHits).toBe(0);
    } finally {
      RegExp.prototype.test = originalTest;
      await rm(root, { force: true, recursive: true });
    }
  });

  it('keeps emitted Cloudflare static security headers after handler-module poisoning', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-cloudflare-static-intrinsics-'));

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({}),
        outDir: join(root, '.kovo'),
        serverHandlerSource: `
const originalHeadersSet = Headers.prototype.set;
const originalReflectApply = Reflect.apply;
Reflect.set(Headers.prototype, 'set', function selectiveSet(name, value) {
  if (name === 'x-content-type-options') return;
  return originalReflectApply(originalHeadersSet, this, [name, value]);
});

export default async function handler() {
  return new Response('dynamic');
}
`,
      });
      const cloudflareOutDir = join(root, 'cloudflare-output');
      await cloudflare().emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: cloudflareOutDir,
        readNeutral() {
          return build;
        },
      });
      const [armProbe, assetProbe] = runGeneratedCloudflareWorker(
        join(cloudflareOutDir, 'worker.mjs'),
        [
          { url: 'https://worker.test/arm' },
          {
            asset: {
              body: 'body { color: navy; }',
              headers: { 'content-type': 'text/css; charset=utf-8' },
            },
            url: 'https://worker.test/assets/app.css',
          },
        ],
      );
      const arm = armProbe!.response;
      await expect(arm.text()).resolves.toBe('dynamic');
      const response = assetProbe!.response;

      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('pins Node preset authority before later app/config option mutation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-node-preset-option-authority-'));
    const options = {
      dockerfile: false,
      jobRunner: { mode: 'serve-and-run' as const },
      retention: {
        hours: 24,
        immutableClientModules: 'retained' as const,
        priorTokenQueryReads: 'retained' as const,
      },
    } satisfies NodePresetOptions;
    const preset = node(options);
    const reviewedEmit = preset.emit;
    const reviewedCapability = preset.capabilities?.jobRunner;

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({}),
        clientModules: [
          {
            path: '/c/app.client.js',
            renderPlanFingerprint: testRenderPlanFingerprint,
            source: 'export const app = true;',
            version: 'app-v1',
          },
        ],
        outDir: join(root, '.kovo'),
        serverHandlerSource: 'export default async () => new Response("ok");\n',
      });
      options.dockerfile = true;
      options.jobRunner.mode = 'runner-only';
      options.retention.hours = 0;
      expect(Reflect.set(preset, 'emit', async () => {})).toBe(false);
      expect(Reflect.set(reviewedCapability!, 'mode', 'attacker-runner')).toBe(false);
      expect(preset.emit).toBe(reviewedEmit);

      expect(preset.capabilities).toEqual({
        jobRunner: { adapter: 'node-in-process', mode: 'serve-and-run' },
      });
      expect(preset.inspect!(build, { declaredEnv: [] })).toEqual([]);

      const outDir = join(root, 'node-output');
      await preset.emit!(build, {
        declaredEnv: [],
        log() {},
        outDir,
        projectRoot: root,
        readNeutral: () => build,
      });
      await expect(stat(join(outDir, 'Dockerfile'))).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('pins Vercel preset authority before later app/config option mutation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-vercel-preset-option-authority-'));
    const options = {
      maxDuration: 8,
      memory: 1024,
      regions: ['iad1'],
      retention: {
        hours: 24,
        immutableClientModules: 'retained' as const,
        priorTokenQueryReads: 'retained' as const,
      },
    } satisfies VercelPresetOptions;
    const preset = vercel(options);

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({}),
        clientModules: [
          {
            path: '/c/app.client.js',
            renderPlanFingerprint: testRenderPlanFingerprint,
            source: 'export const app = true;',
            version: 'app-v1',
          },
        ],
        outDir: join(root, '.kovo'),
        serverHandlerSource: 'export default async () => new Response("ok");\n',
      });
      options.maxDuration = 1;
      options.memory = 128;
      options.regions[0] = 'attacker1';
      options.retention.hours = 0;

      expect(preset.inspect!(build, { declaredEnv: [] })).toEqual([]);

      const outDir = join(root, 'vercel-output');
      await preset.emit!(build, {
        declaredEnv: [],
        log() {},
        outDir,
        readNeutral: () => build,
      });
      await expect(
        readJson(join(outDir, 'functions/kovo.func/.vc-config.json')),
      ).resolves.toMatchObject({ maxDuration: 8, memory: 1024, regions: ['iad1'] });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('does not inherit missing built-in preset options after construction', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-preset-option-prototype-authority-'));
    const nodePreset = node({ dockerfile: false });
    const vercelPreset = vercel();
    const cloudflarePreset = cloudflare();
    const objectPrototype = Object.prototype as Record<string, unknown>;

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({}),
        outDir: join(root, '.kovo'),
        serverHandlerSource: 'export default async () => new Response("ok");\n',
      });
      objectPrototype.maxDuration = 1;
      objectPrototype.memory = 128;
      objectPrototype.regions = ['attacker1'];
      objectPrototype.name = 'attacker-worker';
      objectPrototype.compatibilityDate = '1999-01-01';

      const nodeOutDir = join(root, 'node-output');
      await nodePreset.emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: nodeOutDir,
        projectRoot: root,
        readNeutral: () => build,
      });
      await expect(stat(join(nodeOutDir, 'Dockerfile'))).rejects.toThrow();

      const vercelOutDir = join(root, 'vercel-output');
      await vercelPreset.emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: vercelOutDir,
        readNeutral: () => build,
      });
      await expect(
        readJson(join(vercelOutDir, 'functions/kovo.func/.vc-config.json')),
      ).resolves.not.toMatchObject({ maxDuration: 1, memory: 128, regions: ['attacker1'] });

      const cloudflareOutDir = join(root, 'cloudflare-output');
      await cloudflarePreset.emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: cloudflareOutDir,
        readNeutral: () => build,
      });
      const wrangler = await readFile(join(cloudflareOutDir, 'wrangler.toml'), 'utf8');
      expect(wrangler).toContain('name = "kovo-app"');
      expect(wrangler).toContain('compatibility_date = "2024-09-23"');
      expect(wrangler).not.toContain('attacker-worker');
    } finally {
      delete objectPrototype.maxDuration;
      delete objectPrototype.memory;
      delete objectPrototype.regions;
      delete objectPrototype.name;
      delete objectPrototype.compatibilityDate;
      await rm(root, { force: true, recursive: true });
    }
  });

  it('rejects accessor-backed and invalid numeric built-in preset options at construction', () => {
    let getterHits = 0;
    const accessorOptions = Object.defineProperty({}, 'maxDuration', {
      enumerable: true,
      get() {
        getterHits += 1;
        return 8;
      },
    });
    expect(() => vercel(accessorOptions)).toThrow(/accessor-backed/u);
    expect(getterHits).toBe(0);
    expect(() => vercel({ maxDuration: Number.NaN })).toThrow(/positive safe integer/u);
    expect(() => vercel({ memory: Number.POSITIVE_INFINITY })).toThrow(/positive safe integer/u);
    expect(() =>
      node({
        retention: {
          hours: -1,
          immutableClientModules: 'retained',
          priorTokenQueryReads: 'retained',
        },
      }),
    ).toThrow(/finite non-negative safe integer/u);
  });
});

function withNoStylesheetCallerFile<T>(callback: () => T): T {
  const previous = Error.prepareStackTrace;
  Error.prepareStackTrace = () => 'Error\n    at stylesheet (file:///workspace/hints.ts:1:1)';
  try {
    return callback();
  } finally {
    Error.prepareStackTrace = previous;
  }
}

async function expectEmittedAdapterParity(adapter: NodeAdapterModule): Promise<void> {
  const untrustedLiveRequest = liveNodeRequestToWebRequest(adapterParityRequest());
  const untrustedEmittedRequest = adapter.nodeRequestToWebRequest(adapterParityRequest());
  // SPEC §9.5 / RFC 9113 §8.3.1: a peer controls `:scheme`; neither the live nor generated
  // adapter may treat `https` on cleartext HTTP/2 as proof without trusted-proxy posture.
  expect(untrustedLiveRequest.url).toBe('http://h2.example.test/from-url?x=1');
  expect(untrustedEmittedRequest.url).toBe(untrustedLiveRequest.url);

  const appendedForwardingChain = adapterParityRequest();
  appendedForwardingChain.headers['x-forwarded-proto'] = 'http, https';
  const emittedAppendedForwardingChain = adapter.nodeRequestToWebRequest(appendedForwardingChain, {
    trustedProxy: true,
  });
  expect(emittedAppendedForwardingChain.url).toBe('https://h2.example.test/from-url?x=1');

  const duplicateForwardingHeaders = adapterParityRequest();
  duplicateForwardingHeaders.headers['x-forwarded-proto'] = ['https', 'http'];
  const emittedDuplicateForwardingHeaders = adapter.nodeRequestToWebRequest(
    duplicateForwardingHeaders,
    { trustedProxy: true },
  );
  expect(emittedDuplicateForwardingHeaders.url).toBe('http://h2.example.test/from-url?x=1');

  const forwardingOws = adapterParityRequest();
  forwardingOws.headers['x-forwarded-proto'] = 'attacker-value, \t https \t';
  expect(adapter.nodeRequestToWebRequest(forwardingOws, { trustedProxy: true }).url).toBe(
    'https://h2.example.test/from-url?x=1',
  );

  for (const invalid of ['', 'https, ', 'https, ftp', []] as const) {
    const invalidForwarding = adapterParityRequest();
    invalidForwarding.headers['x-forwarded-proto'] = invalid;
    expect(() =>
      adapter.nodeRequestToWebRequest(invalidForwarding, { trustedProxy: true }),
    ).toThrow(/must end in http or https|must end in an own string/u);
  }

  for (const invalid of ['', 'javascript', 'https, http', ['https']] as const) {
    const liveInvalidPseudo = adapterParityRequest();
    liveInvalidPseudo.headers[':scheme'] = invalid;
    expect(() => liveNodeRequestToWebRequest(liveInvalidPseudo, { trustedProxy: true })).toThrow(
      'Trusted HTTP/2 :scheme must identify one http or https scheme.',
    );

    const emittedInvalidPseudo = adapterParityRequest();
    emittedInvalidPseudo.headers[':scheme'] = invalid;
    expect(() =>
      adapter.nodeRequestToWebRequest(emittedInvalidPseudo, { trustedProxy: true }),
    ).toThrow('Trusted HTTP/2 :scheme must identify one http or https scheme.');
  }

  const forwardedSchemePrecedence = adapterParityRequest();
  forwardedSchemePrecedence.headers[':scheme'] = 'javascript';
  forwardedSchemePrecedence.headers['x-forwarded-proto'] = 'https';
  expect(
    adapter.nodeRequestToWebRequest(forwardedSchemePrecedence, { trustedProxy: true }).url,
  ).toBe('https://h2.example.test/from-url?x=1');

  const uppercasePseudoScheme = adapterParityRequest();
  uppercasePseudoScheme.headers[':scheme'] = 'HTTPS';
  expect(adapter.nodeRequestToWebRequest(uppercasePseudoScheme, { trustedProxy: true }).url).toBe(
    'https://h2.example.test/from-url?x=1',
  );

  for (const authority of [
    '',
    'victim.example@evil.example',
    'victim.example/ignored',
    'victim.example\\ignored',
    'victim.example?ignored',
    'victim.example#ignored',
    'victim.example, evil.example',
    'victim.example:99999',
  ]) {
    const liveInvalidAuthority = adapterParityRequest();
    delete liveInvalidAuthority.headers[':authority'];
    liveInvalidAuthority.headers.host = authority;
    expect(() => liveNodeRequestToWebRequest(liveInvalidAuthority)).toThrow(
      'Kovo Node adapter request authority must be one valid host[:port].',
    );

    const emittedInvalidAuthority = adapterParityRequest();
    delete emittedInvalidAuthority.headers[':authority'];
    emittedInvalidAuthority.headers.host = authority;
    expect(() => adapter.nodeRequestToWebRequest(emittedInvalidAuthority)).toThrow(
      'Kovo Node adapter request authority must be one valid host[:port].',
    );
  }

  const duplicateHost = adapterParityRequest();
  delete duplicateHost.headers[':authority'];
  duplicateHost.headers.host = 'victim.example';
  duplicateHost.rawHeaders = ['Host', 'victim.example', 'Host', 'evil.example'];
  let authorityBody = '';
  let authorityStatus = 0;
  const authorityResponse = Object.assign(new EventEmitter(), {
    end(value?: string) {
      authorityBody = value ?? '';
      return this;
    },
    headersSent: false,
    writeHead(value: number) {
      authorityStatus = value;
      return this;
    },
  }) as unknown as ServerResponse;
  expect(adapter.rejectInvalidNodeRequestAuthority(duplicateHost, authorityResponse)).toBe(true);
  expect({ body: authorityBody, status: authorityStatus }).toEqual({
    body: 'Bad Request',
    status: 400,
  });

  const validIpv6Authority = adapterParityRequest();
  delete validIpv6Authority.headers[':authority'];
  validIpv6Authority.headers.host = '[2001:db8::1]:8080';
  expect(adapter.nodeRequestToWebRequest(validIpv6Authority).url).toBe(
    'http://[2001:db8::1]:8080/from-url?x=1',
  );

  const liveRequest = liveNodeRequestToWebRequest(adapterParityRequest(), { trustedProxy: true });
  const emittedRequest = adapter.nodeRequestToWebRequest(adapterParityRequest(), {
    trustedProxy: true,
  });

  // SPEC §9.5 / RFC 9113 §8.3.1: live and emitted adapters must use `:authority` for the URL,
  // drop pseudo-headers themselves, and replace a divergent app-visible Host with that same
  // authority so application code never receives two competing request-target authorities.
  expect(emittedRequest.url).toBe(liveRequest.url);
  expect(emittedRequest.headers.get('x-from-test')).toBe(liveRequest.headers.get('x-from-test'));
  expect(emittedRequest.headers.get('host')).toBe('h2.example.test');
  expect(() => emittedRequest.headers.get(':authority')).toThrow();

  for (const target of [
    `/?${'a&'.repeat(MAX_REQUEST_QUERY_ENTRIES)}a`,
    `/${'a'.repeat(MAX_REQUEST_URL_CHARACTERS)}`,
  ]) {
    const overLimitRequest = adapterParityRequest();
    Object.assign(overLimitRequest, { complete: true, url: target });
    expect(() => adapter.nodeRequestToWebRequest(overLimitRequest)).toThrow(
      'Kovo Node request target exceeds the SPEC §9.5 resource ceiling.',
    );

    let body = '';
    let status = 0;
    const response = {
      end(value?: string) {
        body = value ?? '';
        return this;
      },
      headersSent: false,
      writeHead(value: number) {
        status = value;
        return this;
      },
    } as unknown as ServerResponse;
    expect(adapter.rejectNodeRequestTargetLimit(overLimitRequest, response)).toBe(true);
    expect({ body, status }).toEqual({ body: 'URI Too Long', status: 414 });
  }

  for (const target of [
    '/%2e/_m/a/b',
    '/x/%2e%2e/_m/a/b',
    '//_m/a/b',
    '////_m/a/b',
    '/_m/a/%2e/b',
    '\\_m\\a\\b',
    'http://attacker.test/_m/a/b',
    'https://h2.example.test/_m/a/b',
    'http:///attacker.test/_m/a/b',
    'http:////attacker.test/_m/a/b',
    'http://///attacker.test/_m/a/b',
    'https:////attacker.test/_m/a/b',
    'http:/attacker.test/_m/a/b',
    'http:attacker.test/_m/a/b',
    'http:\\\\attacker.test\\_m\\a\\b',
    'foo:/_m/a/b',
    'http://proxy.invalid\\_m\\a\\%2e\\b',
  ]) {
    const unsafeMutationRequest = adapterParityRequest();
    unsafeMutationRequest.method = 'POST';
    unsafeMutationRequest.url = target;
    expect(() => adapter.nodeRequestToWebRequest(unsafeMutationRequest)).toThrow(
      'Reserved mutation request targets must use their canonical raw path.',
    );
  }

  let invalidTargetOriginCalls = 0;
  for (const target of ['http://[::1', 'https://attacker.test:99999/_m/a/b', 'foo://[']) {
    const invalidAbsoluteRequest = adapterParityRequest();
    invalidAbsoluteRequest.url = target;
    expect(() =>
      adapter.nodeRequestToWebRequest(invalidAbsoluteRequest, {
        origin() {
          invalidTargetOriginCalls += 1;
          return 'https://h2.example.test';
        },
      }),
    ).toThrow('Reserved mutation request targets must use their canonical raw path.');
  }
  expect(invalidTargetOriginCalls).toBe(0);

  const originalIncludes = String.prototype.includes;
  const originalRegExpTest = RegExp.prototype.test;
  const originalMin = Math.min;
  String.prototype.includes = () => false;
  RegExp.prototype.test = () => false;
  Math.min = () => 1 / 0;
  try {
    for (const target of [
      '/_m/a/%2f/b',
      '/_m/a/%2e/b',
      '/_m/a/./b',
      '\\_m\\a\\b',
      'http://attacker.test/_m/a/b',
    ]) {
      const unsafeMutationRequest = adapterParityRequest();
      unsafeMutationRequest.headers = { host: 'h2.example.test', 'x-from-test': 'yes' };
      unsafeMutationRequest.method = 'POST';
      unsafeMutationRequest.url = target;
      expect(() => adapter.nodeRequestToWebRequest(unsafeMutationRequest)).toThrow(
        'Reserved mutation request targets must use their canonical raw path.',
      );
    }

    const canonicalUnderPoison = adapterParityRequest();
    canonicalUnderPoison.headers = { host: 'h2.example.test', 'x-from-test': 'yes' };
    canonicalUnderPoison.url = '/_m/a/b';
    expect(
      adapter.nodeRequestToWebRequest(canonicalUnderPoison, {
        origin: 'https://h2.example.test',
      }).url,
    ).toBe('https://h2.example.test/_m/a/b');
  } finally {
    String.prototype.includes = originalIncludes;
    RegExp.prototype.test = originalRegExpTest;
    Math.min = originalMin;
  }

  const canonicalMutationRequest = adapterParityRequest();
  canonicalMutationRequest.url = '/_m/a/b';
  expect(
    adapter.nodeRequestToWebRequest(canonicalMutationRequest, { trustedProxy: true }).url,
  ).toBe('https://h2.example.test/_m/a/b');

  const liveHeaders = await capturedNodeHeaders(liveWriteWebResponseToNode);
  const emittedHeaders = await capturedNodeHeaders(adapter.writeWebResponseToNode);
  expect(emittedHeaders).toEqual(liveHeaders);
  expect(emittedHeaders['set-cookie']).toEqual([
    'session=s1; Path=/; HttpOnly',
    'csrf=c1; Path=/; SameSite=Strict',
  ]);
}

function adapterParityRequest(): IncomingMessage {
  const socket = Object.assign(new EventEmitter(), {
    encrypted: false,
    remoteAddress: '203.0.113.9',
  }) as Socket & { encrypted?: boolean };
  return Object.assign(new EventEmitter(), {
    headers: {
      ':authority': 'h2.example.test',
      ':method': 'GET',
      ':path': '/from-pseudo',
      ':scheme': 'https',
      host: 'attacker.example.test',
      'x-from-test': ['one', 'two'],
    },
    method: 'GET',
    socket,
    url: '/from-url?x=1',
  }) as IncomingMessage;
}

function platformBridgeRequest(options: {
  headers: Readonly<Record<string, string>>;
  method?: string;
  peerAddress?: string;
  url: string;
}): IncomingMessage {
  const socket = Object.assign(new EventEmitter(), {
    encrypted: false,
    remoteAddress: options.peerAddress ?? '127.0.0.1',
  }) as Socket & { encrypted?: boolean };
  return Object.assign(Readable.from([]), {
    headers: { host: 'shop.example.test', ...options.headers },
    httpVersion: '1.1',
    method: options.method ?? 'GET',
    socket,
    url: options.url,
  }) as IncomingMessage;
}

async function capturedNodeHeaders(
  writeWebResponseToNode: NodeAdapterModule['writeWebResponseToNode'],
): Promise<Record<string, string | string[]>> {
  const response = new Response(null, { status: 204 });
  response.headers.append('set-cookie', 'session=s1; Path=/; HttpOnly');
  response.headers.append('set-cookie', 'csrf=c1; Path=/; SameSite=Strict');
  response.headers.set('x-from-test', 'kept');
  let captured: Record<string, string | string[]> = {};
  const nodeResponse = {
    end() {
      return this;
    },
    writeHead(_status: number, _statusText: string, headers: Record<string, string | string[]>) {
      captured = headers;
      return this;
    },
  } as unknown as ServerResponse;

  await writeWebResponseToNode(response, nodeResponse, 'GET');
  return captured;
}

interface GeneratedServerProcess {
  readonly baseUrl: string;
  close(): Promise<void>;
  stderr(): string;
}

interface GeneratedWorkerAssetResponse {
  readonly body: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly status?: number;
}

interface GeneratedWorkerRequest {
  readonly asset?: GeneratedWorkerAssetResponse;
  readonly body?: string;
  /** `false` simulates caller-constructed ingress without Cloudflare edge metadata. */
  readonly cloudflareClientIp?: false | string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly method?: string;
  readonly url: string;
}

interface GeneratedWorkerResult {
  readonly assetCalls: number;
  readonly response: Response;
}

// Generated entries eagerly and irreversibly lock their request-safe realm (SPEC §6.6). Exercise
// those exact bytes in disposable child processes so one deployment probe cannot freeze Vitest's
// shared worker or weaken the emitted artifact just to make a broad build suite reusable.
async function startGeneratedNodeServer(serverPath: string): Promise<GeneratedServerProcess> {
  const source = `
const imported = await import(${JSON.stringify(pathToFileURL(serverPath).href)});
const server = imported.createKovoNodeServer();
server.listen(0, '127.0.0.1', () => {
  console.log('KOVO_GENERATED_TEST_SERVER:' + server.address().port);
});
`;
  return await startGeneratedServerProcess(['--input-type=module', '--eval', source]);
}

async function startGeneratedVercelServer(entryPath: string): Promise<GeneratedServerProcess> {
  const source = `
import { createServer } from 'node:http';
const imported = await import(${JSON.stringify(pathToFileURL(entryPath).href)});
const handler = imported.default ?? imported;
const server = createServer((request, response) => handler(request, response));
server.listen(0, '127.0.0.1', () => {
  console.log('KOVO_GENERATED_TEST_SERVER:' + server.address().port);
});
`;
  return await startGeneratedServerProcess(['--input-type=module', '--eval', source]);
}

async function startGeneratedServerProcess(
  args: readonly string[],
): Promise<GeneratedServerProcess> {
  const child = spawn(process.execPath, [...args], {
    env: {
      ...process.env,
      HOST: '127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout: string[] = [];
  const stderr: string[] = [];
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => stdout.push(chunk));
  child.stderr.on('data', (chunk: string) => stderr.push(chunk));

  let port: number;
  try {
    port = await waitForGeneratedServerReady(child, stdout, stderr);
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill('SIGTERM');
      await exited;
    },
    stderr() {
      return stderr.join('');
    },
  };
}

async function waitForGeneratedServerReady(
  child: ReturnType<typeof spawn>,
  stdout: readonly string[],
  stderr: readonly string[],
): Promise<number> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const port = /KOVO_GENERATED_TEST_SERVER:(\d+)/u.exec(stdout.join(''))?.[1];
    if (port !== undefined) return Number(port);
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Generated server exited before listening (exit=${child.exitCode}, signal=${child.signalCode}):\nstdout=${stdout.join('')}\nstderr=${stderr.join('')}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for generated server:\n${stderr.join('')}`);
}

function importGeneratedRuntimeEntry(
  entryPath: string,
  globalNames: readonly string[] = [],
): Readonly<Record<string, unknown>> {
  const source = `
await import(${JSON.stringify(pathToFileURL(entryPath).href)});
const names = ${JSON.stringify(globalNames)};
const result = Object.fromEntries(names.map((name) => [name, globalThis[name]]));
process.stdout.write(JSON.stringify(result));
`;
  const stdout = execFileSync(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', '--input-type=module', '--eval', source],
    { encoding: 'utf8', timeout: 20_000 },
  );
  return JSON.parse(stdout) as Readonly<Record<string, unknown>>;
}

function runGeneratedCloudflareWorker(
  workerPath: string,
  requests: readonly GeneratedWorkerRequest[],
): readonly GeneratedWorkerResult[] {
  const encodedInput = Buffer.from(JSON.stringify(requests)).toString('base64');
  const source = `
const requests = JSON.parse(Buffer.from(process.env.KOVO_BUILD_TEST_PROBE, 'base64').toString());
delete process.env.KOVO_BUILD_TEST_PROBE;
const worker = (await import(${JSON.stringify(pathToFileURL(workerPath).href)})).default;
const results = [];
for (const probe of requests) {
  let assetCalls = 0;
  const env = probe.asset === undefined ? {} : {
    ASSETS: {
      async fetch() {
        assetCalls += 1;
        return new Response(probe.asset.body, {
          headers: probe.asset.headers,
          status: probe.asset.status,
        });
      },
    },
  };
  const response = await worker.fetch(new Request(probe.url, {
    body: probe.body,
    headers: probe.cloudflareClientIp === false ? probe.headers : {
      'cf-connecting-ip': probe.cloudflareClientIp ?? '203.0.113.254',
      ...probe.headers,
    },
    method: probe.method,
  }), env);
  results.push({
    assetCalls,
    body: await response.text(),
    headers: [...response.headers.entries()],
    status: response.status,
  });
}
process.stdout.write(JSON.stringify(results));
`;
  const stdout = execFileSync(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', '--input-type=module', '--eval', source],
    {
      encoding: 'utf8',
      env: { ...process.env, KOVO_BUILD_TEST_PROBE: encodedInput },
      timeout: 20_000,
    },
  );
  const results = JSON.parse(stdout) as readonly {
    readonly assetCalls: number;
    readonly body: string;
    readonly headers: readonly [string, string][];
    readonly status: number;
  }[];
  return results.map((result) => ({
    assetCalls: result.assetCalls,
    response: new Response(result.body, {
      headers: result.headers.map(([name, value]): [string, string] => [name, value]),
      status: result.status,
    }),
  }));
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

type VercelFunctionExpectation =
  | false
  | {
      config: Record<string, unknown>;
      name: string;
    };

async function assertVercelBuildOutput(
  outDir: string,
  expected: {
    function: VercelFunctionExpectation;
    staticFiles: readonly string[];
  },
): Promise<void> {
  expect(await sortedDirNames(outDir)).toEqual(
    expected.function === false
      ? ['config.json', 'static']
      : ['config.json', 'functions', 'static'],
  );

  const config = await readJson(join(outDir, 'config.json'));
  expectVercelConfig(config);

  const staticDir = join(outDir, 'static');
  expect((await stat(staticDir)).isDirectory()).toBe(true);
  for (const filePath of expected.staticFiles) {
    const file = await stat(join(staticDir, filePath));
    expect(file.isFile(), filePath).toBe(true);
  }

  if (expected.function === false) {
    await expect(stat(join(outDir, 'functions'))).rejects.toThrow();
    return;
  }

  const functionDir = join(outDir, 'functions', `${expected.function.name}.func`);
  expect((await stat(functionDir)).isDirectory()).toBe(true);
  await expect(readJson(join(functionDir, '.vc-config.json'))).resolves.toEqual(
    expected.function.config,
  );

  const functionConfig = expected.function.config;
  expect(functionConfig).toMatchObject({
    handler: expect.any(String),
    launcherType: 'Nodejs',
    runtime: expect.stringMatching(/^nodejs\d+\.x$/),
  });
  expect((await stat(join(functionDir, String(functionConfig.handler)))).isFile()).toBe(true);
}

function expectVercelConfig(config: unknown): void {
  expect(config).toMatchObject({ version: 3 });
  if (!isRecord(config) || config.routes === undefined) return;
  expect(Array.isArray(config.routes)).toBe(true);
  for (const routeEntry of config.routes as unknown[]) {
    expect(isRecord(routeEntry), JSON.stringify(routeEntry)).toBe(true);
    const hasSource = typeof (routeEntry as Record<string, unknown>).src === 'string';
    const hasHandler = typeof (routeEntry as Record<string, unknown>).handle === 'string';
    expect(hasSource || hasHandler, JSON.stringify(routeEntry)).toBe(true);
  }
}

async function sortedDirNames(dir: string): Promise<string[]> {
  return (await readdir(dir)).sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clientModuleRetentionError(presetName: string) {
  return {
    code: 'KV417',
    message: `The ${presetName} preset cannot prove the SPEC §14 deploy-skew retention floor for immutable /c/__v/... modules and prior-token /_q reads. Configure ${presetName}({ retention: { hours: 24, immutableClientModules: 'retained', priorTokenQueryReads: 'retained' } }) only when the serving layer retains prior build artifacts and query-read support for at least 24 hours, or use a preset/adapter that declares that support.`,
    severity: 'error',
  };
}

function missingJobRunnerError(presetName: string, taskList: string) {
  return {
    code: 'KV445',
    message: `The ${presetName} preset declares no JobRunner capability but this build registers durable task(s): ${taskList}. SPEC §9.6 requires presets that support task()/request.schedule() to declare a real drainer; use the node preset's in-process JobRunner, or configure a preset/adapter with a cron-drain or external queue runner before deploying.`,
    severity: 'error',
  };
}

function sqliteDurableTaskStoreError(presetName: string, taskList: string) {
  return {
    code: 'KV446',
    message: `The ${presetName} preset's default JobRunner persists durable task(s) in the Postgres _kovo_jobs store, but this build registers durable task(s): ${taskList} and the server bundle uses SQLite/better-sqlite3. SPEC §9.6 requires the node JobRunner's Postgres durable-task store; use a Postgres-compatible app db for durable tasks or remove task()/request.schedule() until a supported SQLite durable queue adapter exists.`,
    severity: 'error',
  };
}

async function nodeGet(
  baseUrl: string,
  pathname: string,
): Promise<{ body: string; headers: IncomingHttpHeaders; statusCode: number }> {
  const url = new URL(pathname, baseUrl);
  return await new Promise((resolve, reject) => {
    const request = nodeHttpRequest(
      {
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        port: url.port,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () => {
          resolve({
            body,
            headers: response.headers,
            statusCode: response.statusCode ?? 0,
          });
        });
      },
    );
    request.on('error', reject);
    request.end();
  });
}

async function rawHttpExchange(baseUrl: string, wireRequest: string): Promise<string> {
  const url = new URL(baseUrl);
  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = netConnect({ host: url.hostname, port: Number(url.port) });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Timed out waiting for the incomplete HTTP request socket to close.'));
    }, 2_000);

    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.once('connect', () => socket.write(wireRequest));
    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    socket.once('close', () => {
      clearTimeout(timeout);
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

function rawMutationRequest(target: string, credential: string): string {
  return [
    `POST ${target} HTTP/1.1`,
    'Host: 127.0.0.1',
    'Connection: close',
    `Authorization: Bearer ${credential}`,
    `Cookie: sid=${credential}`,
    'Content-Length: 0',
    '',
    '',
  ].join('\r\n');
}

async function waitForGeneratedServerStderr(
  server: GeneratedServerProcess,
  expected: string,
): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!server.stderr().includes(expected) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if (!server.stderr().includes(expected)) {
    throw new Error(`Timed out waiting for generated Node stderr to include ${expected}.`);
  }
}

async function waitForGeneratedServerErrorCount(
  server: GeneratedServerProcess,
  count: number,
): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (
    (server.stderr().match(/\[kovo\] unhandled node server error/gu)?.length ?? 0) < count &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if ((server.stderr().match(/\[kovo\] unhandled node server error/gu)?.length ?? 0) < count) {
    throw new Error(`Timed out waiting for ${count} generated Node stderr entries.`);
  }
}
