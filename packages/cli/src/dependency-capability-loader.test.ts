// @kovo-security-classifier-corpus dependency-capability-loader
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { build as viteBuild } from 'vite-plus';

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
          /KV448.*safe-parser.*(?:resolved outside its exact package export target|escaped the supported build-server)/u,
        );
      }
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
