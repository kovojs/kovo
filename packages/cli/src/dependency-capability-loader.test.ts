// @kovo-security-classifier-corpus dependency-capability-loader
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';
import { build as viteBuild, createServer as createViteServer } from 'vite-plus';

import {
  assertDependencyCapabilityImport,
  dependencyCapabilityLoaderVitePlugin,
  type AppDependencyCapabilityManifest,
} from './dependency-capability-loader.js';
import { resolveCapabilityPackageImport } from './capability-closure-packages.js';

const manifest: AppDependencyCapabilityManifest = {
  dependencies: [
    {
      entries: [
        {
          conditions: ['default', 'import'],
          importers: ['app.mjs'],
          imports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
          rootKinds: ['route'],
          sites: ['app.mjs:1:1'],
          specifier: 'safe-parser',
        },
      ],
      manifestFingerprint: 'sha256:safe-parser-v1',
      packageName: 'safe-parser',
      packageVersion: '1.2.3',
      summaryVersion: 'safe-parser-review/1',
      verdict: 'open',
    },
  ],
  schema: 'kovo-app-dependency-capabilities/v1',
};

describe('SPEC §6.6 app dependency loader attenuation', () => {
  // @kovo-security-certifies C13 dependency-complete-ssr-wiring
  it('forces complete dependency traversal in both supported SSR app-evaluation lanes', () => {
    const source = readFileSync(new URL('./commands/build-export.ts', import.meta.url), 'utf8');
    for (const functionName of ['loadBuildAppModule', 'loadExportAppModule']) {
      const start = source.indexOf(`async function ${functionName}(`);
      const end = source.indexOf('\nasync function ', start + 1);
      expect(start, `${functionName} must remain present`).toBeGreaterThanOrEqual(0);
      expect(source.slice(start, end === -1 ? undefined : end)).toContain(
        'ssr: dependencyCapabilityCompleteSsrOptions()',
      );
    }
  });

  // @kovo-security-certifies C13 dependency-capability-loader-identity
  it('admits only the exact censused dependency import and installed identity', () => {
    expect(
      assertDependencyCapabilityImport(manifest, 'safe-parser', {
        conditions: ['default', 'import'],
        exportStatus: 'resolved',
        manifestFingerprint: 'sha256:safe-parser-v1',
        packageName: 'safe-parser',
        packageVersion: '1.2.3',
        specifier: 'safe-parser',
      }),
    ).toMatchObject({ packageName: 'safe-parser', summaryVersion: 'safe-parser-review/1' });

    for (const source of ['safe-parser/hidden', 'surprise-loader']) {
      expect(() =>
        assertDependencyCapabilityImport(manifest, source, {
          conditions: ['default', 'import'],
          exportStatus: 'resolved',
          manifestFingerprint: 'sha256:safe-parser-v1',
          packageName: 'safe-parser',
          packageVersion: '1.2.3',
          specifier: source,
        }),
      ).toThrow(/KV448.*absent from the compiler-derived dependency manifest/u);
    }

    for (const installed of [
      { packageVersion: '1.2.4' },
      { manifestFingerprint: 'sha256:substituted' },
      { conditions: ['default', 'require'] },
    ]) {
      expect(() =>
        assertDependencyCapabilityImport(manifest, 'safe-parser', {
          conditions: ['default', 'import'],
          exportStatus: 'resolved',
          manifestFingerprint: 'sha256:safe-parser-v1',
          packageName: 'safe-parser',
          packageVersion: '1.2.3',
          specifier: 'safe-parser',
          ...installed,
        }),
      ).toThrow(/KV448.*identity drifted after capability census/u);
    }

    expect(() => assertDependencyCapabilityImport(manifest, 'safe-parser', undefined)).toThrow(
      /KV448.*identity drifted after capability census/u,
    );

    for (const missing of ['rootKinds', 'sites'] as const) {
      const malformed = JSON.parse(JSON.stringify(manifest)) as AppDependencyCapabilityManifest;
      delete (malformed.dependencies[0]!.entries[0]! as unknown as Record<string, unknown>)[
        missing
      ];
      expect(() =>
        dependencyCapabilityLoaderVitePlugin(
          '/app.mjs',
          [{ fileName: 'app.mjs', source: "import 'safe-parser';" }],
          malformed,
        ),
      ).toThrow(/KV448.*manifest dependency\[0\] entry\[0\] is malformed/u);
    }
  });

  // @kovo-security-certifies C13 dependency-capability-loader-closed-verdict
  it('never turns a raw or closed manifest row into loader authority', () => {
    for (const disposition of ['raw', 'framework-door'] as const) {
      const closed: AppDependencyCapabilityManifest = {
        ...manifest,
        dependencies: [
          {
            ...manifest.dependencies[0]!,
            entries: [
              {
                ...manifest.dependencies[0]!.entries[0]!,
                imports: [{ capabilities: ['network'], disposition, name: 'parse' }],
              },
            ],
            verdict: 'closed',
          },
        ],
      };
      expect(() =>
        assertDependencyCapabilityImport(closed, 'safe-parser', {
          conditions: ['default', 'import'],
          exportStatus: 'resolved',
          manifestFingerprint: 'sha256:safe-parser-v1',
          packageName: 'safe-parser',
          packageVersion: '1.2.3',
          specifier: 'safe-parser',
        }),
      ).toThrow(/KV448.*does not carry an open least-authority verdict/u);
    }

    for (const disposition of ['raw', 'request-closed'] as const) {
      const retainedUnsafeImport: AppDependencyCapabilityManifest = {
        ...manifest,
        dependencies: [
          {
            ...manifest.dependencies[0]!,
            entries: [
              {
                ...manifest.dependencies[0]!.entries[0]!,
                imports: [{ capabilities: ['network'], disposition, name: 'parse' }],
              },
            ],
            verdict: 'open',
          },
        ],
      };
      expect(() =>
        assertDependencyCapabilityImport(retainedUnsafeImport, 'safe-parser', {
          conditions: ['default', 'import'],
          exportStatus: 'resolved',
          manifestFingerprint: 'sha256:safe-parser-v1',
          packageName: 'safe-parser',
          packageVersion: '1.2.3',
          specifier: 'safe-parser',
        }),
      ).toThrow(/KV448.*does not carry an open least-authority verdict/u);
    }
  });

  it('enforces the manifest in a real Vite import path before admitting app dependencies', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-dependency-loader-'));
    const appModulePath = join(root, 'app.mjs');
    const packageRoot = join(root, 'node_modules', 'safe-parser');
    const outDir = join(root, 'dist');
    const source = "import { parse } from 'safe-parser';\nexport const value = parse('ok');\n";
    try {
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(
        join(packageRoot, 'package.json'),
        JSON.stringify({
          exports: {
            '.': { default: './index.js', import: './index.js' },
            './hidden': './hidden.js',
          },
          name: 'safe-parser',
          type: 'module',
          version: '1.2.3',
        }),
        'utf8',
      );
      writeFileSync(
        join(packageRoot, 'index.js'),
        'export const parse = value => value;\n',
        'utf8',
      );
      writeFileSync(join(packageRoot, 'hidden.js'), 'export const hidden = true;\n', 'utf8');
      writeFileSync(appModulePath, source, 'utf8');
      const installed = resolveCapabilityPackageImport('safe-parser', appModulePath);
      expect(installed).toBeDefined();
      const exactManifest: AppDependencyCapabilityManifest = {
        dependencies: [
          {
            entries: [
              {
                conditions: installed!.conditions,
                importers: ['app.mjs'],
                imports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
                rootKinds: ['route'],
                sites: ['app.mjs:1:1'],
                specifier: 'safe-parser',
              },
            ],
            manifestFingerprint: installed!.manifestFingerprint,
            packageName: installed!.packageName,
            packageVersion: installed!.packageVersion,
            summaryVersion: 'safe-parser-review/1',
            verdict: 'open',
          },
        ],
        schema: 'kovo-app-dependency-capabilities/v1',
      };
      const build = (approvedSource: string, candidateManifest = exactManifest) =>
        viteBuild({
          build: { emptyOutDir: true, outDir, rollupOptions: { input: appModulePath } },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: basename(appModulePath), source: approvedSource }],
              candidateManifest,
            ),
          ],
          root,
        });

      await expect(build(source)).resolves.toBeDefined();

      await expect(
        viteBuild({
          build: { emptyOutDir: true, outDir, rollupOptions: { input: appModulePath } },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: basename(appModulePath), source }],
              exactManifest,
            ),
          ],
          resolve: { alias: { 'safe-parser': join(packageRoot, 'hidden.js') } },
          root,
        }),
      ).rejects.toThrow(/KV448.*alias resolves outside its exact package export target/u);

      const widenedSource =
        "import { hidden } from 'safe-parser/hidden';\nexport const value = hidden;\n";
      writeFileSync(appModulePath, widenedSource, 'utf8');
      await expect(build(widenedSource)).rejects.toThrow(
        /KV448.*safe-parser\/hidden.*absent from the compiler-derived dependency manifest/u,
      );

      writeFileSync(appModulePath, source, 'utf8');
      writeFileSync(
        join(packageRoot, 'package.json'),
        JSON.stringify({
          exports: {
            '.': { default: './index.js', import: './index.js' },
            './hidden': './hidden.js',
          },
          name: 'safe-parser',
          type: 'module',
          version: '1.2.4',
        }),
        'utf8',
      );
      await expect(build(source)).rejects.toThrow(
        /KV448.*identity drifted after capability census/u,
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('forces ESM and literal CommonJS dependencies into production SSR artifacts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-dependency-ssr-loader-'));
    const packageRoot = join(root, 'node_modules', 'safe-parser');
    try {
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(
        join(packageRoot, 'package.json'),
        JSON.stringify({
          exports: { '.': './index.js' },
          name: 'safe-parser',
          type: 'module',
          version: '1.2.3',
        }),
      );
      writeFileSync(join(packageRoot, 'index.js'), 'export const parse = value => value;\n');

      for (const fixture of [
        {
          fileName: 'app.mjs',
          source: "import { parse } from 'safe-parser'; export const value = parse('esm');\n",
        },
        {
          fileName: 'app.cjs',
          source: "const { parse } = require('safe-parser'); exports.value = parse('cjs');\n",
        },
      ]) {
        const appModulePath = join(root, fixture.fileName);
        const outDir = join(root, `dist-${fixture.fileName}`);
        writeFileSync(appModulePath, fixture.source);
        const installed = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
        const exactManifest: AppDependencyCapabilityManifest = {
          dependencies: [
            {
              entries: [
                {
                  conditions: installed.conditions,
                  importers: [fixture.fileName],
                  imports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
                  rootKinds: ['route'],
                  sites: [`${fixture.fileName}:1:1`],
                  specifier: 'safe-parser',
                },
              ],
              manifestFingerprint: installed.manifestFingerprint,
              packageName: installed.packageName,
              packageVersion: installed.packageVersion,
              summaryVersion: 'safe-parser-review/1',
              verdict: 'open',
            },
          ],
          schema: 'kovo-app-dependency-capabilities/v1',
        };
        const plugin = () =>
          dependencyCapabilityLoaderVitePlugin(
            appModulePath,
            [{ fileName: fixture.fileName, source: fixture.source }],
            exactManifest,
            'build-server',
            { allowNodeBuiltins: true },
          );
        const config = {
          build: {
            emptyOutDir: true,
            outDir,
            rollupOptions: {
              input: appModulePath,
              output: { entryFileNames: 'entry.mjs' },
            },
            ssr: true,
          },
          configFile: false as const,
          logLevel: 'silent' as const,
          plugins: [plugin()],
          root,
          ssr: { noExternal: ['safe-parser'] },
        };
        await expect(viteBuild(config)).resolves.toBeDefined();
        const emitted = readFileSync(join(outDir, 'entry.mjs'), 'utf8');
        expect(emitted).not.toMatch(/(?:from|require|__require)\s*\(?['"]safe-parser['"]/u);

        await expect(
          viteBuild({ ...config, plugins: [plugin()], ssr: { external: ['safe-parser'] } }),
        ).rejects.toThrow(
          /KV448.*safe-parser.*(?:overlaps a trusted SSR external|resolved outside its exact package export target|escaped the supported build-server)/u,
        );
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-bundle-owned-chunk-identity
  it('admits bundle-owned sibling chunks without treating their filenames as package externals', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-owned-chunk-')));
    const appModulePath = join(root, 'app.mjs');
    const handlerPath = join(root, 'handler.mjs');
    const outDir = join(root, 'dist');
    const appSource =
      "export async function run() { return (await import('./handler.mjs')).handler(); }\n";
    const handlerSource = "export const handler = () => 'owned';\n";
    try {
      writeFileSync(appModulePath, appSource);
      writeFileSync(handlerPath, handlerSource);
      await expect(
        viteBuild({
          build: {
            emptyOutDir: true,
            outDir,
            rollupOptions: {
              input: appModulePath,
              output: { chunkFileNames: '[name].mjs', entryFileNames: '[name].mjs' },
            },
            ssr: true,
          },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [
                { fileName: 'app.mjs', source: appSource },
                { fileName: 'handler.mjs', source: handlerSource },
              ],
              { dependencies: [], schema: 'kovo-app-dependency-capabilities/v1' },
              'build-server',
            ),
          ],
          root,
          ssr: { noExternal: true },
        }),
      ).resolves.toBeDefined();
      expect(readFileSync(join(outDir, 'app.mjs'), 'utf8')).toMatch(
        /import\(["']\.\/handler\.mjs["']\)/u,
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-transitive-bundle-closure
  it('rejects uncensused transitive packages even when a supported SSR artifact bundles them', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-dependency-transitive-loader-'));
    const appModulePath = join(root, 'app.mjs');
    const packageRoot = join(root, 'node_modules', 'safe-parser');
    const helperRoot = join(root, 'node_modules', 'helper-parser');
    const outDir = join(root, 'dist');
    const source = "import { parse } from 'safe-parser'; export const value = parse('safe');\n";
    try {
      for (const [directory, packageName] of [
        [packageRoot, 'safe-parser'],
        [helperRoot, 'helper-parser'],
      ] as const) {
        mkdirSync(directory, { recursive: true });
        writeFileSync(
          join(directory, 'package.json'),
          JSON.stringify({
            ...(packageName === 'safe-parser'
              ? { dependencies: { 'helper-parser': '1.0.0' } }
              : {}),
            exports: { '.': './index.js' },
            name: packageName,
            type: 'module',
            version: packageName === 'safe-parser' ? '1.2.3' : '1.0.0',
          }),
        );
      }
      writeFileSync(
        join(packageRoot, 'index.js'),
        "import { helper } from 'helper-parser'; export const parse = value => helper(value);\n",
      );
      writeFileSync(join(helperRoot, 'index.js'), 'export const helper = value => value;\n');
      writeFileSync(appModulePath, source);
      const installed = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
      const exactManifest: AppDependencyCapabilityManifest = {
        dependencies: [
          {
            entries: [
              {
                conditions: installed.conditions,
                importers: ['app.mjs'],
                imports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
                rootKinds: ['route'],
                sites: ['app.mjs:1:1'],
                specifier: 'safe-parser',
              },
            ],
            manifestFingerprint: installed.manifestFingerprint,
            packageName: installed.packageName,
            packageVersion: installed.packageVersion,
            summaryVersion: 'safe-parser-review/1',
            verdict: 'open',
          },
        ],
        schema: 'kovo-app-dependency-capabilities/v1',
      };
      const plugin = () =>
        dependencyCapabilityLoaderVitePlugin(
          appModulePath,
          [{ fileName: 'app.mjs', source }],
          exactManifest,
          'build-server',
        );
      const build = (noExternal: true | readonly string[]) =>
        viteBuild({
          build: {
            emptyOutDir: true,
            outDir,
            rollupOptions: { input: appModulePath, output: { entryFileNames: 'entry.mjs' } },
            ssr: true,
          },
          configFile: false,
          logLevel: 'silent',
          plugins: [plugin()],
          root,
          ssr: { noExternal },
        });

      for (const noExternal of [['safe-parser'] as const, true] as const) {
        await expect(build(noExternal)).rejects.toThrow(
          /KV448.*uncensused transitive dependency helper-parser imported by reviewed package safe-parser/u,
        );
      }
      expect(() => readFileSync(join(outDir, 'entry.mjs'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-transitive-ssr-pre-evaluation
  it('rejects an uncensused transitive before supported SSR app evaluation', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-transitive-ssr-')));
    const appModulePath = join(root, 'app.mjs');
    const packageRoot = join(root, 'node_modules', 'safe-parser');
    const helperRoot = join(root, 'node_modules', 'helper-parser');
    const executedPath = join(root, 'helper-executed');
    const source = "import { parse } from 'safe-parser'; export const value = parse('safe');\n";
    let server: Awaited<ReturnType<typeof createViteServer>> | undefined;
    try {
      for (const [directory, packageName] of [
        [packageRoot, 'safe-parser'],
        [helperRoot, 'helper-parser'],
      ] as const) {
        mkdirSync(directory, { recursive: true });
        writeFileSync(
          join(directory, 'package.json'),
          JSON.stringify({
            ...(packageName === 'safe-parser'
              ? { dependencies: { 'helper-parser': '1.0.0' } }
              : {}),
            exports: { '.': './index.js' },
            name: packageName,
            type: 'module',
            version: packageName === 'safe-parser' ? '1.2.3' : '1.0.0',
          }),
        );
      }
      writeFileSync(
        join(packageRoot, 'index.js'),
        "import { helper } from 'helper-parser'; export const parse = value => helper(value);\n",
      );
      writeFileSync(
        join(helperRoot, 'index.js'),
        `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(
          executedPath,
        )}, 'executed'); export const helper = value => value;\n`,
      );
      writeFileSync(appModulePath, source);
      const installed = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
      const exactManifest: AppDependencyCapabilityManifest = {
        dependencies: [
          {
            entries: [
              {
                conditions: installed.conditions,
                importers: ['app.mjs'],
                imports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
                rootKinds: ['route'],
                sites: ['app.mjs:1:1'],
                specifier: 'safe-parser',
              },
            ],
            manifestFingerprint: installed.manifestFingerprint,
            packageName: installed.packageName,
            packageVersion: installed.packageVersion,
            summaryVersion: 'safe-parser-review/1',
            verdict: 'open',
          },
        ],
        schema: 'kovo-app-dependency-capabilities/v1',
      };
      server = await createViteServer({
        appType: 'custom',
        configFile: false,
        logLevel: 'silent',
        plugins: [
          dependencyCapabilityLoaderVitePlugin(
            appModulePath,
            [{ fileName: 'app.mjs', source }],
            exactManifest,
            'build-app',
          ),
        ],
        root,
        server: { hmr: false },
        ssr: { noExternal: true },
      });

      await expect(server.ssrLoadModule('/app.mjs')).rejects.toThrow(
        /KV448.*uncensused transitive dependency helper-parser imported by reviewed package safe-parser/u,
      );
      expect(() => readFileSync(executedPath, 'utf8')).toThrow();
    } finally {
      await server?.close();
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-cjs-loader-alias-pre-evaluation
  it('rejects a reviewed CJS loader alias whose resolved child would evade Vite resolution', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-cjs-alias-')));
    const appModulePath = join(root, 'app.mjs');
    const packageRoot = join(root, 'node_modules', 'safe-parser');
    const helperRoot = join(root, 'node_modules', 'helper-parser');
    const outDir = join(root, 'dist');
    const source = "import { parse } from 'safe-parser'; export const value = parse('safe');\n";
    try {
      for (const [directory, packageName] of [
        [packageRoot, 'safe-parser'],
        [helperRoot, 'helper-parser'],
      ] as const) {
        mkdirSync(directory, { recursive: true });
        writeFileSync(
          join(directory, 'package.json'),
          JSON.stringify({
            ...(packageName === 'safe-parser'
              ? { dependencies: { 'helper-parser': '1.0.0' } }
              : {}),
            exports: { '.': './index.cjs' },
            name: packageName,
            type: 'commonjs',
            version: packageName === 'safe-parser' ? '1.2.3' : '1.0.0',
          }),
        );
      }
      writeFileSync(
        join(packageRoot, 'index.cjs'),
        [
          'const load = require;',
          "const helperPath = load.resolve('helper-parser');",
          'load(helperPath);',
          'exports.parse = value => value;',
          '',
        ].join('\n'),
      );
      writeFileSync(
        join(helperRoot, 'index.cjs'),
        "globalThis.__KOVO_UNCENSUSED_REQUIRE_ALIAS__ = 'EXECUTED';\n",
      );
      writeFileSync(appModulePath, source);
      const installed = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
      const exactManifest: AppDependencyCapabilityManifest = {
        dependencies: [
          {
            entries: [
              {
                conditions: installed.conditions,
                importers: ['app.mjs'],
                imports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
                rootKinds: ['route'],
                sites: ['app.mjs:1:1'],
                specifier: 'safe-parser',
              },
            ],
            manifestFingerprint: installed.manifestFingerprint,
            packageName: installed.packageName,
            packageVersion: installed.packageVersion,
            summaryVersion: 'safe-parser-review/1',
            verdict: 'open',
          },
        ],
        schema: 'kovo-app-dependency-capabilities/v1',
      };

      await expect(
        viteBuild({
          build: {
            emptyOutDir: true,
            outDir,
            rollupOptions: { input: appModulePath, output: { entryFileNames: 'entry.mjs' } },
            ssr: true,
          },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: 'app.mjs', source }],
              exactManifest,
              'build-server',
              { allowNodeBuiltins: true },
            ),
          ],
          root,
          ssr: { noExternal: true },
        }),
      ).rejects.toThrow(
        /KV448.*reviewed package safe-parser aliases CommonJS loader authority/u,
      );
      expect(() => readFileSync(join(outDir, 'entry.mjs'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-relative-nested-package-boundary
  it('rejects a relative edge from a reviewed package into a nested package boundary', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-relative-nested-')));
    const appModulePath = join(root, 'app.mjs');
    const packageRoot = join(root, 'node_modules', 'safe-parser');
    const helperRoot = join(packageRoot, 'node_modules', 'helper-parser');
    const outDir = join(root, 'dist');
    const source = "import { parse } from 'safe-parser'; export const value = parse('safe');\n";
    try {
      for (const [directory, packageName] of [
        [packageRoot, 'safe-parser'],
        [helperRoot, 'helper-parser'],
      ] as const) {
        mkdirSync(directory, { recursive: true });
        writeFileSync(
          join(directory, 'package.json'),
          JSON.stringify({
            exports: { '.': './index.cjs' },
            name: packageName,
            type: 'commonjs',
            version: packageName === 'safe-parser' ? '1.2.3' : '1.0.0',
          }),
        );
      }
      writeFileSync(
        join(packageRoot, 'index.cjs'),
        [
          "require('./node_modules/helper-parser/index.cjs');",
          'exports.parse = value => value;',
          '',
        ].join('\n'),
      );
      writeFileSync(
        join(helperRoot, 'index.cjs'),
        "globalThis.__KOVO_RELATIVE_NESTED_PACKAGE__ = 'EXECUTED';\n",
      );
      writeFileSync(appModulePath, source);
      const installed = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
      const exactManifest: AppDependencyCapabilityManifest = {
        dependencies: [
          {
            entries: [
              {
                conditions: installed.conditions,
                importers: ['app.mjs'],
                imports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
                rootKinds: ['route'],
                sites: ['app.mjs:1:1'],
                specifier: 'safe-parser',
              },
            ],
            manifestFingerprint: installed.manifestFingerprint,
            packageName: installed.packageName,
            packageVersion: installed.packageVersion,
            summaryVersion: 'safe-parser-review/1',
            verdict: 'open',
          },
        ],
        schema: 'kovo-app-dependency-capabilities/v1',
      };

      await expect(
        viteBuild({
          build: {
            emptyOutDir: true,
            outDir,
            rollupOptions: { input: appModulePath, output: { entryFileNames: 'entry.mjs' } },
            ssr: true,
          },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: 'app.mjs', source }],
              exactManifest,
              'build-server',
              { allowNodeBuiltins: true },
            ),
          ],
          root,
          ssr: { noExternal: true },
        }),
      ).rejects.toThrow(/KV448.*nested package boundary.*safe-parser/u);
      expect(() => readFileSync(join(outDir, 'entry.mjs'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-vite-ignore-artifact-closure
  it.each(['relative', 'file URL'] as const)(
    'rejects a Vite-ignored %s import that remains outside the bundle-owned artifact',
    async (kind) => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-vite-ignore-')));
      const appModulePath = join(root, 'app.mjs');
      const packageRoot = join(root, 'node_modules', 'safe-parser');
      const helperPath = join(root, kind === 'relative' ? 'helper.mjs' : 'helper-file.mjs');
      const outDir = join(root, 'dist');
      const source = "import { parse } from 'safe-parser'; export const value = parse('safe');\n";
      try {
        mkdirSync(packageRoot, { recursive: true });
        writeFileSync(
          join(packageRoot, 'package.json'),
          JSON.stringify({
            exports: { '.': './index.mjs' },
            name: 'safe-parser',
            type: 'module',
            version: '1.2.3',
          }),
        );
        const specifier =
          kind === 'relative' ? '../helper.mjs' : pathToFileURL(helperPath).href;
        writeFileSync(
          join(packageRoot, 'index.mjs'),
          [
            `await import(/* @vite-ignore */ ${JSON.stringify(specifier)});`,
            'export const parse = value => value;',
            '',
          ].join('\n'),
        );
        writeFileSync(
          helperPath,
          `globalThis.__KOVO_VITE_IGNORE_${kind === 'relative' ? 'RELATIVE' : 'FILE'}__ = 'EXECUTED';\n`,
        );
        writeFileSync(appModulePath, source);
        const installed = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
        const exactManifest: AppDependencyCapabilityManifest = {
          dependencies: [
            {
              entries: [
                {
                  conditions: installed.conditions,
                  importers: ['app.mjs'],
                  imports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
                  rootKinds: ['route'],
                  sites: ['app.mjs:1:1'],
                  specifier: 'safe-parser',
                },
              ],
              manifestFingerprint: installed.manifestFingerprint,
              packageName: installed.packageName,
              packageVersion: installed.packageVersion,
              summaryVersion: 'safe-parser-review/1',
              verdict: 'open',
            },
          ],
          schema: 'kovo-app-dependency-capabilities/v1',
        };

        await expect(
          viteBuild({
            build: {
              emptyOutDir: true,
              outDir,
              rollupOptions: { input: appModulePath, output: { entryFileNames: 'entry.mjs' } },
              ssr: true,
            },
            configFile: false,
            logLevel: 'silent',
            plugins: [
              dependencyCapabilityLoaderVitePlugin(
                appModulePath,
                [{ fileName: 'app.mjs', source }],
                exactManifest,
                'build-server',
                { allowNodeBuiltins: true },
              ),
            ],
            root,
            ssr: { noExternal: true },
          }),
        ).rejects.toThrow(/KV448.*unresolved module target.*bundle-owned artifact/u);
        expect(() => readFileSync(join(outDir, 'entry.mjs'), 'utf8')).toThrow();
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
  );

  // @kovo-security-certifies C13 dependency-builtin-ssr-pre-evaluation
  it('rejects a reviewed package builtin import before supported SSR app evaluation', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-builtin-ssr-')));
    const appModulePath = join(root, 'app.mjs');
    const packageRoot = join(root, 'node_modules', 'safe-parser');
    const source = "import { parse } from 'safe-parser'; export const value = parse('safe');\n";
    let server: Awaited<ReturnType<typeof createViteServer>> | undefined;
    try {
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(
        join(packageRoot, 'package.json'),
        JSON.stringify({
          exports: { '.': './index.js' },
          name: 'safe-parser',
          type: 'module',
          version: '1.2.3',
        }),
      );
      writeFileSync(
        join(packageRoot, 'index.js'),
        "import { readFileSync } from 'node:fs'; export const parse = () => readFileSync;\n",
      );
      writeFileSync(appModulePath, source);
      const installed = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
      const exactManifest: AppDependencyCapabilityManifest = {
        dependencies: [
          {
            entries: [
              {
                conditions: installed.conditions,
                importers: ['app.mjs'],
                imports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
                rootKinds: ['route'],
                sites: ['app.mjs:1:1'],
                specifier: 'safe-parser',
              },
            ],
            manifestFingerprint: installed.manifestFingerprint,
            packageName: installed.packageName,
            packageVersion: installed.packageVersion,
            summaryVersion: 'safe-parser-review/1',
            verdict: 'open',
          },
        ],
        schema: 'kovo-app-dependency-capabilities/v1',
      };
      server = await createViteServer({
        appType: 'custom',
        configFile: false,
        logLevel: 'silent',
        plugins: [
          dependencyCapabilityLoaderVitePlugin(
            appModulePath,
            [{ fileName: 'app.mjs', source }],
            exactManifest,
            'export',
          ),
        ],
        root,
        server: { hmr: false },
        ssr: { noExternal: true },
      });

      await expect(server.ssrLoadModule('/app.mjs')).rejects.toThrow(
        /KV448.*uncensused transitive dependency node:fs imported by reviewed package safe-parser/u,
      );
    } finally {
      await server?.close();
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-direct-ssr-external-pre-evaluation
  it('rejects a direct app dependency that overlaps a trusted SSR host external', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-direct-external-ssr-')));
    const appModulePath = join(root, 'app.mjs');
    const packageRoot = join(root, 'node_modules', 'typescript');
    const executedPath = join(root, 'external-executed');
    const source = "import { value } from 'typescript'; export { value };\n";
    try {
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(
        join(packageRoot, 'package.json'),
        JSON.stringify({
          exports: { '.': './index.js' },
          name: 'typescript',
          type: 'module',
          version: '6.0.3',
        }),
      );
      writeFileSync(
        join(packageRoot, 'index.js'),
        `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(
          executedPath,
        )}, 'executed'); export const value = 'forged';\n`,
      );
      writeFileSync(appModulePath, source);
      const installed = resolveCapabilityPackageImport('typescript', appModulePath)!;
      const exactManifest: AppDependencyCapabilityManifest = {
        dependencies: [
          {
            entries: [
              {
                conditions: installed.conditions,
                importers: ['app.mjs'],
                imports: [{ capabilities: [], disposition: 'pure', name: 'value' }],
                rootKinds: ['route'],
                sites: ['app.mjs:1:1'],
                specifier: 'typescript',
              },
            ],
            manifestFingerprint: installed.manifestFingerprint,
            packageName: installed.packageName,
            packageVersion: installed.packageVersion,
            summaryVersion: 'typescript-review/1',
            verdict: 'open',
          },
        ],
        schema: 'kovo-app-dependency-capabilities/v1',
      };
      await expect(
        createViteServer({
          appType: 'custom',
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: 'app.mjs', source }],
              exactManifest,
              'build-app',
            ),
          ],
          root,
          server: { hmr: false },
          ssr: { external: ['typescript'], noExternal: true },
        }),
      ).rejects.toThrow(/KV448.*typescript.*overlaps a trusted SSR external/u);
      expect(() => readFileSync(executedPath, 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-transitive-reviewed-external
  it('rejects a reviewed package reaching a raw runtime external that skipped resolveId', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-external-loader-')));
    const appModulePath = join(root, 'app.mjs');
    const packageRoot = join(root, 'node_modules', 'safe-parser');
    const source = "import { parse } from 'safe-parser'; export const value = parse('safe');\n";
    try {
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(
        join(packageRoot, 'package.json'),
        JSON.stringify({
          dependencies: { pg: '8.16.3' },
          exports: { '.': './index.js' },
          name: 'safe-parser',
          type: 'module',
          version: '1.2.3',
        }),
      );
      writeFileSync(
        join(packageRoot, 'index.js'),
        "import { Client } from 'pg'; export const parse = value => [value, Client];\n",
      );
      writeFileSync(appModulePath, source);
      const installed = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
      const exactManifest: AppDependencyCapabilityManifest = {
        dependencies: [
          {
            entries: [
              {
                conditions: installed.conditions,
                importers: ['app.mjs'],
                imports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
                rootKinds: ['route'],
                sites: ['app.mjs:1:1'],
                specifier: 'safe-parser',
              },
            ],
            manifestFingerprint: installed.manifestFingerprint,
            packageName: installed.packageName,
            packageVersion: installed.packageVersion,
            summaryVersion: 'safe-parser-review/1',
            verdict: 'open',
          },
        ],
        schema: 'kovo-app-dependency-capabilities/v1',
      };

      await expect(
        viteBuild({
          build: {
            outDir: join(root, 'dist'),
            rollupOptions: { external: (id) => id === 'pg', input: appModulePath },
            ssr: true,
          },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: 'app.mjs', source }],
              exactManifest,
              'build-server',
              { allowRuntimeExternal: (id) => id === 'pg' },
            ),
          ],
          root,
          ssr: { noExternal: ['safe-parser'] },
        }),
      ).rejects.toThrow(
        /KV448.*uncensused transitive dependency pg imported by reviewed package safe-parser/u,
      );
      expect(() => readFileSync(join(root, 'dist', 'app.mjs'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-package-root-containment
  it('rejects relative and symlink escapes from an admitted third-party package root', async () => {
    for (const escapeKind of ['relative', 'symlink'] as const) {
      const root = realpathSync(
        mkdtempSync(join(tmpdir(), `kovo-dependency-${escapeKind}-escape-`)),
      );
      const appModulePath = join(root, 'app.mjs');
      const packageRoot = join(root, 'node_modules', 'safe-parser');
      const escapePath = join(root, 'escape.mjs');
      const source = "import { parse } from 'safe-parser'; export const value = parse('safe');\n";
      try {
        mkdirSync(packageRoot, { recursive: true });
        writeFileSync(
          join(packageRoot, 'package.json'),
          JSON.stringify({
            exports: { '.': './index.js' },
            name: 'safe-parser',
            type: 'module',
            version: '1.2.3',
          }),
        );
        writeFileSync(
          join(packageRoot, 'index.js'),
          `export { parse } from ${JSON.stringify(escapeKind === 'relative' ? '../../escape.mjs' : './linked.mjs')};\n`,
        );
        writeFileSync(
          escapePath,
          "import { readFileSync } from 'node:fs'; export const parse = value => [value, readFileSync];\n",
        );
        if (escapeKind === 'symlink') symlinkSync(escapePath, join(packageRoot, 'linked.mjs'));
        writeFileSync(appModulePath, source);
        const installed = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
        const exactManifest: AppDependencyCapabilityManifest = {
          dependencies: [
            {
              entries: [
                {
                  conditions: installed.conditions,
                  importers: ['app.mjs'],
                  imports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
                  rootKinds: ['route'],
                  sites: ['app.mjs:1:1'],
                  specifier: 'safe-parser',
                },
              ],
              manifestFingerprint: installed.manifestFingerprint,
              packageName: installed.packageName,
              packageVersion: installed.packageVersion,
              summaryVersion: 'safe-parser-review/1',
              verdict: 'open',
            },
          ],
          schema: 'kovo-app-dependency-capabilities/v1',
        };

        await expect(
          viteBuild({
            build: {
              outDir: join(root, 'dist'),
              rollupOptions: { input: appModulePath },
              ssr: true,
            },
            configFile: false,
            logLevel: 'silent',
            plugins: [
              dependencyCapabilityLoaderVitePlugin(
                appModulePath,
                [{ fileName: 'app.mjs', source }],
                exactManifest,
                'build-server',
                { allowNodeBuiltins: true },
              ),
            ],
            root,
            ssr: { noExternal: true },
          }),
        ).rejects.toThrow(
          new RegExp(
            `KV448.*reviewed package safe-parser ${escapeKind} import escapes its exact package root`,
            'u',
          ),
        );
        expect(() => readFileSync(join(root, 'dist', 'app.mjs'), 'utf8')).toThrow();
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    }
  });

  // @kovo-security-certifies C13 dependency-inline-html-module-closure
  it('rejects inline HTML module proxies outside the immutable approved-source snapshot', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-inline-html-')));
    const appModulePath = join(root, 'src', 'app.ts');
    const packageRoot = join(root, 'node_modules', 'safe-parser');
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(appModulePath, 'export const app = true;\n');
      writeFileSync(
        join(root, 'index.html'),
        [
          '<!doctype html>',
          '<script type="module">',
          "import { parse } from 'safe-parser';",
          "document.body.textContent = parse('uncensused');",
          '</script>',
        ].join('\n'),
      );
      writeFileSync(
        join(packageRoot, 'package.json'),
        JSON.stringify({
          exports: { '.': './index.js' },
          name: 'safe-parser',
          type: 'module',
          version: '1.2.3',
        }),
      );
      writeFileSync(join(packageRoot, 'index.js'), 'export const parse = value => value;\n');

      await expect(
        viteBuild({
          build: { emptyOutDir: true, outDir: join(root, 'dist') },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: 'app.ts', source: 'export const app = true;\n' }],
              { dependencies: [], schema: 'kovo-app-dependency-capabilities/v1' },
              'build-client',
            ),
          ],
          root,
        }),
      ).rejects.toThrow(
        /KV448.*inline HTML module is outside the immutable approved-source snapshot/u,
      );
      expect(() => readFileSync(join(root, 'dist', 'index.html'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-external-html-module-snapshot
  it('rejects an external HTML module script outside the immutable approved-source snapshot', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-html-module-')));
    const appModulePath = join(root, 'app.mjs');
    const packageRoot = join(root, 'node_modules', 'safe-client');
    const outDir = join(root, 'dist');
    const appSource = "export const app = 'approved';\n";
    try {
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(appModulePath, appSource);
      writeFileSync(
        join(root, 'index.html'),
        '<!doctype html><script type="module" src="/node_modules/safe-client/index.js"></script>',
      );
      writeFileSync(
        join(packageRoot, 'package.json'),
        JSON.stringify({ name: 'safe-client', type: 'module', version: '1.0.0' }),
      );
      writeFileSync(
        join(packageRoot, 'index.js'),
        "globalThis.__UNCENSUSED_CLIENT_PACKAGE__ = 'executed';\n",
      );

      await expect(
        viteBuild({
          build: { emptyOutDir: true, outDir },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: 'app.mjs', source: appSource }],
              { dependencies: [], schema: 'kovo-app-dependency-capabilities/v1' },
              'build-client',
            ),
          ],
          root,
        }),
      ).rejects.toThrow(/KV448.*HTML module.*immutable approved-source snapshot/u);
      expect(() => readFileSync(join(outDir, 'index.html'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-html-resolved-module-snapshot
  it('rejects an approved HTML module URL when Vite aliases it outside the snapshot', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-html-alias-')));
    const appModulePath = join(root, 'src', 'client.ts');
    const packageRoot = join(root, 'node_modules', 'safe-client');
    const outDir = join(root, 'dist');
    const appSource = "globalThis.__KOVO_APPROVED_CLIENT__ = 'loaded';\n";
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(appModulePath, appSource);
      writeFileSync(
        join(root, 'index.html'),
        '<!doctype html><script type="module" src="/src/client.ts"></script>',
      );
      writeFileSync(
        join(packageRoot, 'package.json'),
        JSON.stringify({ name: 'safe-client', type: 'module', version: '1.0.0' }),
      );
      writeFileSync(
        join(packageRoot, 'index.js'),
        "globalThis.__UNCENSUSED_CLIENT_PACKAGE__ = 'executed';\n",
      );

      await expect(
        viteBuild({
          build: { emptyOutDir: true, outDir },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: 'client.ts', source: appSource }],
              { dependencies: [], schema: 'kovo-app-dependency-capabilities/v1' },
              'build-client',
            ),
          ],
          resolve: {
            alias: [{ find: '/src/client.ts', replacement: join(packageRoot, 'index.js') }],
          },
          root,
        }),
      ).rejects.toThrow(/KV448.*HTML module.*immutable approved-source snapshot/u);
      expect(() => readFileSync(join(outDir, 'index.html'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-html-public-shadow-snapshot
  it.each([
    ['ordinary module', ''],
    ['Vite-ignored module', ' vite-ignore'],
  ])('rejects an approved-looking %s shadowed by a public asset', async (_label, ignore) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-html-public-shadow-')));
    const appModulePath = join(root, 'src', 'client.ts');
    const publicModulePath = join(root, 'public', 'src', 'client.ts');
    const outDir = join(root, 'dist');
    const appSource = "globalThis.__KOVO_APPROVED_CLIENT__ = 'loaded';\n";
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      mkdirSync(dirname(publicModulePath), { recursive: true });
      writeFileSync(appModulePath, appSource);
      writeFileSync(
        publicModulePath,
        "globalThis.__KOVO_PUBLIC_SHADOW_PACKAGE__ = 'EXECUTED';\n",
      );
      writeFileSync(
        join(root, 'index.html'),
        `<!doctype html><script type="module"${ignore} src="/src/client.ts"></script>`,
      );

      await expect(
        viteBuild({
          build: { emptyOutDir: true, outDir },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: 'client.ts', source: appSource }],
              { dependencies: [], schema: 'kovo-app-dependency-capabilities/v1' },
              'build-client',
            ),
          ],
          root,
        }),
      ).rejects.toThrow(/KV448.*public asset shadows approved HTML module/u);
      expect(() => readFileSync(join(outDir, 'index.html'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-html-authored-execution-closure
  it.each([
    [
      'event handler',
      '<body onload="globalThis.__KOVO_HTML_HANDLER_PWNED__=\'EXECUTED\'">',
      /KV448.*raw HTML event handler.*compiler-owned JSX lowering/u,
    ],
    [
      'nested srcdoc document',
      '<iframe srcdoc="&lt;script type=\'module\' src=\'data:text/javascript,parent.__KOVO_SRCDOC_PWNED__%3D%27EXECUTED%27\'&gt;&lt;/script&gt;"></iframe>',
      /KV448.*nested HTML document.*immutable approved-source snapshot/u,
    ],
    [
      'base URL retarget',
      '<base href="https://attacker.invalid/">',
      /KV448.*raw HTML base URL.*immutable approved-source snapshot/u,
    ],
  ])('rejects raw HTML %s outside compiler-owned closure', async (_label, fragment, error) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-html-execution-')));
    const appModulePath = join(root, 'src', 'client.ts');
    const outDir = join(root, 'dist');
    const appSource = "globalThis.__KOVO_APPROVED_CLIENT__ = 'loaded';\n";
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(appModulePath, appSource);
      writeFileSync(
        join(root, 'index.html'),
        [
          '<!doctype html>',
          '<script type="module" src="/src/client.ts"></script>',
          fragment,
        ].join('\n'),
      );

      await expect(
        viteBuild({
          build: { emptyOutDir: true, outDir },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: 'client.ts', source: appSource }],
              { dependencies: [], schema: 'kovo-app-dependency-capabilities/v1' },
              'build-client',
            ),
          ],
          root,
        }),
      ).rejects.toThrow(error);
      expect(() => readFileSync(join(outDir, 'index.html'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-html-url-module-snapshot
  it.each([
    [
      'data URL',
      'module',
      "data:text/javascript,globalThis.__KOVO_DATA_SCRIPT_PWNED__%3D'EXECUTED'",
      '',
    ],
    [
      'character-reference encoded data URL',
      'module',
      "&#x64;ata:text/javascript,globalThis.__KOVO_DATA_SCRIPT_PWNED__%3D'EXECUTED'",
      '',
    ],
    ['absolute HTTPS URL', 'module', 'https://attacker.invalid/remote-pwn.js', ''],
    [
      'legacy JavaScript MIME URL',
      'text/javascript1.5',
      "data:text/javascript,globalThis.__KOVO_LEGACY_TYPE_PWNED__%3D'EXECUTED'",
      '',
    ],
    [
      'module after a browser-valid bogus comment close',
      'module',
      "data:text/javascript,globalThis.__KOVO_COMMENT_CLOSE_PWNED__%3D'EXECUTED'",
      '<!-- harmless --!>',
    ],
    [
      'module after an abrupt empty-comment close',
      'module',
      "data:text/javascript,globalThis.__KOVO_ABRUPT_COMMENT_PWNED__%3D'EXECUTED'",
      '<!-->',
    ],
    [
      'module after an abrupt dash-comment close',
      'module',
      "data:text/javascript,globalThis.__KOVO_DASH_COMMENT_PWNED__%3D'EXECUTED'",
      '<!--->',
    ],
    [
      'module after a script-looking quoted attribute value',
      'module',
      "data:text/javascript,globalThis.__KOVO_ATTRIBUTE_DECOY_PWNED__%3D'EXECUTED'",
      '<div data-decoy="<script type=application/json>"></div>',
    ],
    [
      'module after a script-looking RCDATA value',
      'module',
      "data:text/javascript,globalThis.__KOVO_RCDATA_DECOY_PWNED__%3D'EXECUTED'",
      '<textarea><script type=application/json></textarea>',
    ],
  ])(
    'rejects an executable HTML %s outside the approved snapshot',
    async (_label, type, src, prefix) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-html-url-')));
    const appModulePath = join(root, 'src', 'client.ts');
    const outDir = join(root, 'dist');
    const appSource = "globalThis.__KOVO_APPROVED_CLIENT__ = 'loaded';\n";
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(appModulePath, appSource);
      writeFileSync(
        join(root, 'index.html'),
        [
          '<!doctype html>',
          '<script type="module" src="/src/client.ts"></script>',
          prefix,
          `<script type="${type}" src="${src}"></script>`,
        ].join('\n'),
      );

      await expect(
        viteBuild({
          build: { emptyOutDir: true, outDir },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: 'client.ts', source: appSource }],
              { dependencies: [], schema: 'kovo-app-dependency-capabilities/v1' },
              'build-client',
            ),
          ],
          root,
        }),
      ).rejects.toThrow(/KV448.*immutable approved-source snapshot/u);
      expect(() => readFileSync(join(outDir, 'index.html'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
    },
  );

  it('binds a nested package edge to the helper that actually resolves it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-dependency-nested-loader-'));
    const appModulePath = join(root, 'app.mjs');
    const helperPath = join(root, 'features', 'helper.mjs');
    const topPackageRoot = join(root, 'node_modules', 'safe-parser');
    const nestedPackageRoot = join(root, 'features', 'node_modules', 'safe-parser');
    try {
      for (const [packageRoot, version] of [
        [topPackageRoot, '1.2.3'],
        [nestedPackageRoot, '2.0.0'],
      ] as const) {
        mkdirSync(packageRoot, { recursive: true });
        writeFileSync(
          join(packageRoot, 'package.json'),
          JSON.stringify({
            exports: { '.': './index.js' },
            name: 'safe-parser',
            type: 'module',
            version,
          }),
        );
        writeFileSync(join(packageRoot, 'index.js'), 'export const parse = value => value;\n');
      }
      mkdirSync(join(root, 'features'), { recursive: true });
      const appSource = "import { value } from './features/helper.mjs'; export { value };\n";
      const helperSource =
        "import { parse } from 'safe-parser'; export const value = parse('nested');\n";
      writeFileSync(appModulePath, appSource);
      writeFileSync(helperPath, helperSource);
      const reviewedTop = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
      const wrongImporterManifest: AppDependencyCapabilityManifest = {
        dependencies: [
          {
            entries: [
              {
                conditions: reviewedTop.conditions,
                importers: ['features/helper.mjs'],
                imports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
                rootKinds: ['route'],
                sites: ['features/helper.mjs:1:1'],
                specifier: 'safe-parser',
              },
            ],
            manifestFingerprint: reviewedTop.manifestFingerprint,
            packageName: reviewedTop.packageName,
            packageVersion: reviewedTop.packageVersion,
            summaryVersion: 'safe-parser-review/1',
            verdict: 'open',
          },
        ],
        schema: 'kovo-app-dependency-capabilities/v1',
      };
      await expect(
        viteBuild({
          build: { outDir: join(root, 'dist'), rollupOptions: { input: appModulePath }, ssr: true },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [
                { fileName: 'app.mjs', source: appSource },
                { fileName: 'features/helper.mjs', source: helperSource },
              ],
              wrongImporterManifest,
              'build-server',
            ),
          ],
          root,
          ssr: { noExternal: ['safe-parser'] },
        }),
      ).rejects.toThrow(/KV448.*safe-parser identity drifted after capability census/u);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
