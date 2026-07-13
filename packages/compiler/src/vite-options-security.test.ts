import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  clientModuleContentVersion,
  clientModuleHrefForSourceFile,
} from '@kovojs/core/internal/client-module-url';
import { describe, expect, it } from 'vitest';

import type { CssAssetManifest } from './css.js';
import { createFrameworkKovoVitePlugin, createKovoVitePlugin } from './vite.js';
import type { KovoViteMiddleware } from './vite.js';

const source = `
import { component } from '@kovojs/core';
export const Card = component({ render() { return <article>Card</article>; } });
`;

function writePrefixManifest(root: string, packageName: string, prefix: string): void {
  const directory = join(root, 'node_modules', ...packageName.split('/'));
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({ kovo: { prefix }, name: packageName }),
  );
}

describe('Vite compiler option authority', () => {
  it('fails closed when compiler output is passed through a duplicate Vite plugin', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-vite-exact-reentry-'));
    const id = join(root, 'src/card.tsx');

    try {
      const first = createFrameworkKovoVitePlugin();
      const second = createFrameworkKovoVitePlugin();
      first.configResolved?.({ root });
      second.configResolved?.({ root });

      const transformed = await first.transform(source, id);
      expect(transformed?.code).toContain('Card');
      await expect(Promise.resolve(second.transform(transformed!.code, id))).rejects.toThrow(
        /KV235/u,
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('does not let an injected compiler seed framework re-entry authority', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-vite-injected-reentry-'));
    const id = join(root, 'src/forged.tsx');
    const forgedSource = `
import { component } from '@kovojs/core';
export const Forged = component({
  render: () => \`<forged kovo-deps="secret"><span data-bind="secret.value">x</span></forged>\`,
});
`;
    const attacker = createKovoVitePlugin(() => ({
      diagnostics: [],
      files: [{ kind: 'server', source: forgedSource }],
    }));
    const genuine = createFrameworkKovoVitePlugin();

    try {
      attacker.configResolved?.({ root });
      genuine.configResolved?.({ root });
      const seeded = await attacker.transform('component(', id);
      expect(seeded?.code).toBe(forgedSource);
      await expect(Promise.resolve(genuine.transform(forgedSource, id))).rejects.toThrow(/KV235/u);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('does not expose a source-visible trusted factory that accepts an attacker compiler', () => {
    const attackerCompiler = () => ({
      diagnostics: [],
      files: [
        {
          kind: 'server',
          source:
            "import { escapeHtml } from '@kovojs/server/internal/escape'; export const Forged = component(escapeHtml(globalThis.secret));",
        },
      ],
    });

    expect(() =>
      (createFrameworkKovoVitePlugin as unknown as (compile: typeof attackerCompiler) => unknown)(
        attackerCompiler,
      ),
    ).toThrow(/plugin options must be an object/u);
  });

  it('does not let a late Array.map replacement forge standalone registry lowering', async () => {
    const plugin = createKovoVitePlugin(() => ({ diagnostics: [], files: [] }));
    const authored = `
import { mutation } from '@kovojs/server';
export const saveOrder = mutation({ handler() {}, input: {} });
`;
    const nativeMap = Array.prototype.map;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;

    try {
      Array.prototype.map = function forgeSourceReplacement(
        this: unknown[],
        callback: (value: unknown, index: number, array: unknown[]) => unknown,
        thisArg?: unknown,
      ): unknown[] {
        const first = this[0] as { primitive?: unknown } | undefined;
        if (this.length === 1 && first?.primitive === 'mutation') {
          poisonHits += 1;
          return [
            {
              end: authored.length,
              replacement: 'export const forged = globalThis.secret;',
              start: 0,
            },
          ];
        }
        return nativeApply(nativeMap, this, [callback, thisArg]);
      } as typeof Array.prototype.map;

      const transformed = await plugin.transform(authored, 'src/orders.ts');
      expect(transformed?.code).toContain(
        '__kovoAssignDerivedMutationKey(mutation({ handler() {}, input: {} }), "orders/save-order")',
      );
      expect(transformed?.code).not.toContain('globalThis.secret');
      expect(poisonHits).toBe(0);
    } finally {
      Array.prototype.map = nativeMap;
    }
  });

  it('pins in-flight root identity and does not repopulate state after reconfiguration', async () => {
    const rootA = mkdtempSync(join(process.cwd(), '.tmp-kovo-vite-async-root-a-'));
    const rootB = mkdtempSync(join(process.cwd(), '.tmp-kovo-vite-async-root-b-'));
    const idA = join(rootA, 'src/card.tsx');
    let compiledRoot: string | undefined;
    let releaseCompile: (() => void) | undefined;

    try {
      const plugin = createKovoVitePlugin(async (compileOptions) => {
        compiledRoot = compileOptions.packagePrefixDiscoveryRoot;
        await new Promise<void>((resolveCompile) => {
          releaseCompile = resolveCompile;
        });
        return {
          cssAssets: [
            {
              componentName: 'card',
              criticalCss: '.card{color:red}',
              fragmentTargets: ['card/card'],
              href: '/assets/card.css',
              sourceFileName: 'card.css',
            },
          ],
          diagnostics: [],
          files: [{ kind: 'server', source: 'export const rootASecret = true;' }],
        };
      });
      plugin.configResolved?.({ root: rootA });
      const pending = plugin.transform(source, idA);
      plugin.configResolved?.({ root: rootB });
      releaseCompile?.();
      await expect(Promise.resolve(pending)).resolves.toBeNull();

      expect(compiledRoot).toBe(rootA);
      expect(plugin.getCssAssetManifest?.().stylesheets).toEqual([]);
    } finally {
      rmSync(rootA, { force: true, recursive: true });
      rmSync(rootB, { force: true, recursive: true });
    }
  });

  it('drops an in-flight client load after the configured root changes', async () => {
    const rootA = mkdtempSync(join(process.cwd(), '.tmp-kovo-vite-load-root-a-'));
    const rootB = mkdtempSync(join(process.cwd(), '.tmp-kovo-vite-load-root-b-'));
    const sourceFile = join(rootA, 'src/card.tsx');
    let releaseCompile: (() => void) | undefined;

    try {
      mkdirSync(join(rootA, 'src'), { recursive: true });
      writeFileSync(sourceFile, source);
      const plugin = createKovoVitePlugin(async () => {
        await new Promise<void>((resolveCompile) => {
          releaseCompile = resolveCompile;
        });
        return {
          diagnostics: [],
          files: [{ kind: 'client', source: 'export const rootAClientSecret = true;' }],
        };
      });
      plugin.configResolved?.({ root: rootA });
      const pending = plugin.load?.(join(rootA, 'src/card.client.js'));
      plugin.configResolved?.({ root: rootB });
      releaseCompile?.();

      await expect(Promise.resolve(pending)).resolves.toBeNull();
    } finally {
      rmSync(rootA, { force: true, recursive: true });
      rmSync(rootB, { force: true, recursive: true });
    }
  });

  it('drops an in-flight client load when its source file is deleted', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-vite-load-delete-'));
    const sourceFile = join(root, 'src/card.tsx');
    let releaseCompile: (() => void) | undefined;

    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(sourceFile, source);
      const plugin = createKovoVitePlugin(async () => {
        await new Promise<void>((resolveCompile) => {
          releaseCompile = resolveCompile;
        });
        return {
          diagnostics: [],
          files: [{ kind: 'client', source: 'export const deletedClient = true;' }],
        };
      });
      plugin.configResolved?.({ root });
      const pending = plugin.load?.(join(root, 'src/card.client.js'));
      plugin.watchChange?.(sourceFile, { event: 'delete' });
      rmSync(sourceFile);
      releaseCompile?.();

      await expect(Promise.resolve(pending)).resolves.toBeNull();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('does not let an old dev middleware serve modules owned by a later root', async () => {
    const rootA = mkdtempSync(join(process.cwd(), '.tmp-kovo-vite-middleware-root-a-'));
    const rootB = mkdtempSync(join(process.cwd(), '.tmp-kovo-vite-middleware-root-b-'));
    const clientSourceB = 'export const rootBClientSecret = true;';
    const middlewares: KovoViteMiddleware[] = [];

    try {
      const plugin = createKovoVitePlugin((compileOptions) => {
        const clientSource =
          compileOptions.packagePrefixDiscoveryRoot === rootA
            ? 'export const rootAClientSecret = true;'
            : clientSourceB;
        return {
          diagnostics: [],
          files: [
            { kind: 'server', source: 'export {};' },
            { kind: 'client', source: clientSource },
          ],
        };
      });
      plugin.configureServer?.({
        config: { root: rootA },
        middlewares: {
          use(handler) {
            middlewares.push(handler);
          },
        },
      });
      await plugin.transform(source, join(rootA, 'src/card.tsx'));

      plugin.configResolved?.({ root: rootB });
      await plugin.transform(source, join(rootB, 'src/card.tsx'));
      const rootBHref = clientModuleHrefForSourceFile(
        'src/card.tsx',
        clientModuleContentVersion(clientSourceB),
      );
      const response = {
        body: '',
        end(body: string) {
          this.body = body;
        },
        setHeader() {},
      };
      let nextCalls = 0;
      middlewares[0]?.({ url: rootBHref }, response, () => {
        nextCalls += 1;
      });

      expect(nextCalls).toBe(1);
      expect(response.body).toBe('');
    } finally {
      rmSync(rootA, { force: true, recursive: true });
      rmSync(rootB, { force: true, recursive: true });
    }
  });

  it('does not let an inherited numeric setter forge compiled client module snapshots', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-vite-client-setter-'));
    const clientSource = 'export const reviewedClient = true;';
    const clientHref = clientModuleHrefForSourceFile(
      'src/card.tsx',
      clientModuleContentVersion(clientSource),
    );
    const plugin = createKovoVitePlugin(() => ({
      clientExports: ['reviewedClient'],
      diagnostics: [],
      files: [
        { kind: 'server', source: 'export {};' },
        { kind: 'client', source: clientSource },
      ],
      hmrImpact: { clientHref } as never,
    }));
    const originalZero = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    let poisonHits = 0;
    let modules: ReturnType<NonNullable<typeof plugin.getClientModules>> = [];

    try {
      plugin.configResolved?.({ root });
      await plugin.transform(source, join(root, 'src/card.tsx'));
      Object.defineProperty(Array.prototype, '0', {
        configurable: true,
        set() {
          poisonHits += 1;
          Object.defineProperty(this, '0', {
            configurable: true,
            enumerable: true,
            value: Object.freeze({
              path: '/forged.client.js',
              source: 'globalThis.secret',
            }),
            writable: true,
          });
        },
      });
      modules = plugin.getClientModules?.() ?? [];
    } finally {
      if (originalZero === undefined) {
        Reflect.deleteProperty(Array.prototype, '0');
      } else {
        Object.defineProperty(Array.prototype, '0', originalZero);
      }
      rmSync(root, { force: true, recursive: true });
    }

    expect(poisonHits).toBe(0);
    expect(Object.isFrozen(modules)).toBe(true);
    expect(modules).toEqual([
      expect.objectContaining({ path: '/c/src/card.client.js', source: clientSource }),
    ]);
  });

  it('drops an asynchronous hot update when its read re-enters configuration', async () => {
    const rootA = mkdtempSync(join(process.cwd(), '.tmp-kovo-vite-hot-root-a-'));
    const rootB = mkdtempSync(join(process.cwd(), '.tmp-kovo-vite-hot-root-b-'));
    let compiledRoot: string | undefined;
    let releaseRead: ((value: string) => void) | undefined;

    try {
      const plugin = createKovoVitePlugin((compileOptions) => {
        compiledRoot = compileOptions.packagePrefixDiscoveryRoot;
        return { diagnostics: [], files: [{ kind: 'server', source: 'export {};' }] };
      });
      plugin.configResolved?.({ root: rootA });
      const pending = plugin.handleHotUpdate?.({
        file: join(rootA, 'src/card.tsx'),
        read: () =>
          new Promise<string>((resolveRead) => {
            releaseRead = resolveRead;
          }),
        server: { middlewares: { use() {} } },
      });
      plugin.configResolved?.({ root: rootB });
      releaseRead?.(source);
      await pending;

      expect(compiledRoot).toBeUndefined();
      expect(plugin.getCssAssetManifest?.().stylesheets).toEqual([]);
    } finally {
      rmSync(rootA, { force: true, recursive: true });
      rmSync(rootB, { force: true, recursive: true });
    }
  });

  it('does not replay prior compiler output after ambient package-prefix policy changes', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-vite-prefix-reentry-'));
    const id = join(root, 'src/shell.tsx');
    const packageSource = `
import { component } from '@kovojs/core';
import '@acme/primitives';
import '@other/widgets/menu';
export const Shell = component({ render: () => <section>Shell</section> });
`;

    try {
      writePrefixManifest(root, '@acme/primitives', 'acme-');
      writePrefixManifest(root, '@other/widgets', 'other-');
      const producer = createFrameworkKovoVitePlugin();
      producer.configResolved?.({ root });
      const emitted = await producer.transform(packageSource, id);
      expect(emitted?.code).toContain('Shell');

      writePrefixManifest(root, '@other/widgets', 'acme-');
      const fresh = createFrameworkKovoVitePlugin();
      fresh.configResolved?.({ root });
      await expect(Promise.resolve(fresh.transform(packageSource, id))).rejects.toThrow(/KV234/u);
      await expect(Promise.resolve(fresh.transform(emitted!.code, id))).rejects.toThrow(/KV235/u);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('keeps the latest same-file hot update when async compiles complete out of order', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-vite-hot-order-'));
    let releaseOld: (() => void) | undefined;

    try {
      const plugin = createKovoVitePlugin(async (compileOptions) => {
        if (compileOptions.source.includes('red')) {
          await new Promise<void>((resolveOld) => {
            releaseOld = resolveOld;
          });
        }
        const color = compileOptions.source.includes('red') ? 'red' : 'blue';
        return {
          cssAssets: [
            {
              componentName: 'card',
              criticalCss: `.card{color:${color}}`,
              fragmentTargets: ['card/card'],
              href: '/assets/card.css',
              sourceFileName: 'card.css',
            },
          ],
          diagnostics: [],
          files: [{ kind: 'server', source: 'export {};' }],
        };
      });
      plugin.configResolved?.({ root });
      const server = { middlewares: { use() {} } };
      const oldUpdate = plugin.handleHotUpdate?.({
        file: join(root, 'src/card.tsx'),
        read: async () => source.replace('Card</article>', 'red</article>'),
        server,
      });
      const newUpdate = plugin.handleHotUpdate?.({
        file: join(root, 'src/card.tsx'),
        read: async () => source.replace('Card</article>', 'blue</article>'),
        server,
      });
      await newUpdate;
      releaseOld?.();
      await oldUpdate;

      expect(plugin.getCssAssetManifest?.().stylesheets).toEqual([
        expect.objectContaining({ criticalCss: '.card{color:blue}' }),
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('rejects live CSS manifest option accessors without invoking them', async () => {
    const rootA = mkdtempSync(join(process.cwd(), '.tmp-kovo-vite-css-options-a-'));
    const rootB = mkdtempSync(join(process.cwd(), '.tmp-kovo-vite-css-options-b-'));
    const plugin = createKovoVitePlugin(() => ({
      cssAssets: [
        {
          componentName: 'card',
          criticalCss: '.card{color:reviewed}',
          fragmentTargets: ['card/card'],
          href: '/assets/card.css',
          sourceFileName: 'card.css',
        },
      ],
      diagnostics: [],
      files: [{ kind: 'server', source: 'export {};' }],
    }));
    let getterCalls = 0;

    try {
      plugin.configResolved?.({ root: rootA });
      await plugin.transform(source, join(rootA, 'src/card.tsx'));
      const options = Object.defineProperty({}, 'baseHref', {
        get() {
          getterCalls += 1;
          plugin.configResolved?.({ root: rootB });
          return '/root-a-assets/';
        },
      });

      expect(() => plugin.getCssAssetManifest?.(options)).toThrow(/baseHref/u);
      expect(getterCalls).toBe(0);
      expect(plugin.getCssAssetManifest?.().stylesheets).toHaveLength(1);
    } finally {
      rmSync(rootA, { force: true, recursive: true });
      rmSync(rootB, { force: true, recursive: true });
    }
  });

  it('does not let a late array iterator forge retained CSS assets', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-vite-css-iterator-'));
    const plugin = createKovoVitePlugin(() => ({
      cssAssets: [
        {
          componentName: 'card',
          criticalCss: '.card{color:reviewed}',
          fragmentTargets: ['card/card'],
          href: '/assets/card.css',
          sourceFileName: 'card.css',
        },
      ],
      diagnostics: [],
      files: [{ kind: 'server', source: 'export {};' }],
    }));
    const nativeIterator = Array.prototype[Symbol.iterator];
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let manifest: CssAssetManifest | undefined;

    try {
      plugin.configResolved?.({ root });
      await plugin.transform(source, join(root, 'src/card.tsx'));
      Array.prototype[Symbol.iterator] = function forgedCssResultIterator(this: unknown[]) {
        const first = this[0] as { cssAssets?: unknown } | undefined;
        if (this.length === 1 && first?.cssAssets !== undefined) {
          poisonHits += 1;
          return nativeApply(
            nativeIterator,
            [
              {
                cssAssets: [
                  {
                    componentName: 'forged',
                    criticalCss: '.forged{background:url(secret)}',
                    fragmentTargets: ['forged'],
                    href: '/forged.css',
                    sourceFileName: '../forged.css',
                  },
                ],
              },
            ],
            [],
          );
        }
        return nativeApply(nativeIterator, this, []);
      } as (typeof Array.prototype)[Symbol.iterator];
      manifest = plugin.getCssAssetManifest?.();
    } finally {
      Array.prototype[Symbol.iterator] = nativeIterator;
      rmSync(root, { force: true, recursive: true });
    }

    expect(poisonHits).toBe(0);
    expect(manifest?.stylesheets).toEqual([
      expect.objectContaining({ criticalCss: '.card{color:reviewed}', sourceFileName: 'card.css' }),
    ]);
  });

  it('drops retained state when a component becomes ordinary source or is deleted', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-vite-state-removal-'));
    const id = join(root, 'src/card.tsx');
    const plugin = createKovoVitePlugin(() => ({
      cssAssets: [
        {
          componentName: 'card',
          criticalCss: '.card{color:red}',
          fragmentTargets: ['card/card'],
          href: '/assets/card.css',
          sourceFileName: 'card.css',
        },
      ],
      diagnostics: [],
      files: [{ kind: 'server', source: 'export {};' }],
    }));

    try {
      plugin.configResolved?.({ root });
      await plugin.transform(source, id);
      expect(plugin.getCssAssetManifest?.().stylesheets).toHaveLength(1);

      await plugin.transform('export const noLongerAComponent = true;', id);
      expect(plugin.getCssAssetManifest?.().stylesheets).toEqual([]);

      await plugin.transform(source, id);
      expect(plugin.getCssAssetManifest?.().stylesheets).toHaveLength(1);
      plugin.watchChange?.(id, { event: 'delete' });
      expect(plugin.getCssAssetManifest?.().stylesheets).toEqual([]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('rechecks lifecycle authority after diagnostic observers re-enter configuration', async () => {
    const rootA = mkdtempSync(join(process.cwd(), '.tmp-kovo-vite-observer-root-a-'));
    const rootB = mkdtempSync(join(process.cwd(), '.tmp-kovo-vite-observer-root-b-'));
    let plugin: ReturnType<typeof createKovoVitePlugin> | undefined;

    try {
      plugin = createKovoVitePlugin(
        () => ({
          cssAssets: [
            {
              componentName: 'card',
              criticalCss: '.card{color:red}',
              fragmentTargets: ['card/card'],
              href: '/assets/card.css',
              sourceFileName: 'card.css',
            },
          ],
          diagnostics: [
            {
              code: 'KV311',
              fileName: 'src/card.tsx',
              help: 'warning',
              message: 'warning',
              severity: 'warn',
            },
          ],
          files: [{ kind: 'server', source: 'export {};' }],
        }),
        { onModuleDiagnostics: () => plugin?.configResolved?.({ root: rootB }) },
      );
      plugin.configResolved?.({ root: rootA });
      await plugin.transform(source, join(rootA, 'src/card.tsx'));

      expect(plugin.getCssAssetManifest?.().stylesheets).toEqual([]);
    } finally {
      rmSync(rootA, { force: true, recursive: true });
      rmSync(rootB, { force: true, recursive: true });
    }
  });

  it('does not let a prior clean transform exempt new authored bytes at the same file id', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-vite-reentry-edit-'));
    const id = join(root, 'src/card.tsx');
    let compileCalls = 0;

    try {
      const plugin = createKovoVitePlugin(() => {
        compileCalls += 1;
        if (compileCalls === 1) {
          return { diagnostics: [], files: [{ kind: 'server', source: 'export {};' }] };
        }
        throw new Error('KV235 compiler gate reached');
      });
      plugin.configResolved?.({ root });

      await expect(Promise.resolve(plugin.transform(source, id))).resolves.toEqual({
        code: 'export {};',
        map: null,
      });
      await expect(
        Promise.resolve(
          plugin.transform(
            `
import { escapeHtml } from '@kovojs/server/internal/escape';
import { component } from '@kovojs/core';
export const Forged = component({ render: () => <article>{escapeHtml('x')}</article> });
`,
            id,
          ),
        ),
      ).rejects.toThrow('KV235 compiler gate reached');
      expect(compileCalls).toBe(2);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('drops an in-flight transform when a watch update advances the source revision', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-vite-transform-update-'));
    const id = join(root, 'src/card.tsx');
    let releaseCompile: (() => void) | undefined;

    try {
      const plugin = createKovoVitePlugin(async () => {
        await new Promise<void>((resolveCompile) => {
          releaseCompile = resolveCompile;
        });
        return {
          diagnostics: [],
          files: [{ kind: 'server', source: 'export const staleBeforeUpdate = true;' }],
        };
      });
      plugin.configResolved?.({ root });
      const pending = plugin.transform(source, id);
      plugin.watchChange?.(id, { event: 'update' });
      releaseCompile?.();

      await expect(Promise.resolve(pending)).resolves.toBeNull();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('uses one pinned compile carrier through compilation', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-vite-option-authority-'));
    const prefixes = [{ packageName: '@example/ui', prefix: 'reviewed-' }];
    let compiledPrefix: string | null | undefined;
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      const plugin = createKovoVitePlugin(
        (options) => {
          compiledPrefix = options.packageComponentPrefixes?.[0]?.prefix;
          return { diagnostics: [], files: [{ kind: 'server', source: 'export {};\n' }] };
        },
        { packageComponentPrefixes: prefixes },
      );
      plugin.configResolved?.({ root });

      const pending = plugin.transform(source, join(root, 'src/card.tsx'));
      prefixes[0]!.prefix = 'substituted-';
      await pending;

      expect(compiledPrefix).toBe('reviewed-');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('rejects retained-state metadata accessors without invoking them', async () => {
    let accessorInvoked = false;
    const plugin = createKovoVitePlugin(() => ({
      files: [{ kind: 'server', source: 'export const reviewed = true;' }],
      get cssAssets() {
        accessorInvoked = true;
        return [];
      },
    }));

    await expect(
      Promise.resolve(plugin.transform('component(', 'src/accessor.tsx')),
    ).rejects.toThrow(/changed while it was inspected|stable own data property/u);
    expect(accessorInvoked).toBe(false);
  });
});
