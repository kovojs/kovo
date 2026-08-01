import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildCommand,
  derivePublishedPackageManifest,
  derivePublishPlan,
  uiVendoredHelperSourcePaths,
  uiVendoredSourceHashes,
  uiVendoredSourceHelperHashes,
} from './build-publish.mjs';
import {
  importPathForPackageSubpath,
  isSourceTarget,
  normalizePackageExports,
  resolveExportTarget,
  resolveSourceExportTarget,
  sourceStem,
} from './package-exports.mjs';
import { publicPackages, repoRoot } from './public-packages.mjs';

describe('package export resolver', () => {
  it('normalizes root exports and subpath maps', () => {
    expect(normalizePackageExports('./src/index.ts')).toEqual({ '.': './src/index.ts' });
    expect(
      normalizePackageExports({
        '.': './src/index.ts',
        './build': './src/build.ts',
      }),
    ).toEqual({
      '.': './src/index.ts',
      './build': './src/build.ts',
    });
  });

  it('resolves conditional and array exports with source precedence', () => {
    expect(
      resolveSourceExportTarget({
        types: './dist/index.d.mts',
        default: './dist/index.mjs',
        source: './src/index.ts',
      }),
    ).toBe('./src/index.ts');

    expect(
      resolveSourceExportTarget([
        './dist/fallback.mjs',
        { development: './src/development.tsx', default: './dist/development.mjs' },
      ]),
    ).toBe('./src/development.tsx');

    expect(
      resolveSourceExportTarget({
        browser: { default: './dist/browser.mjs' },
        node: { import: './src/node.ts' },
      }),
    ).toBe('./src/node.ts');
  });

  it('distinguishes any resolved target from source-backed targets', () => {
    const target = {
      types: './dist/index.d.mts',
      default: './dist/index.mjs',
    };
    expect(resolveExportTarget(target)).toBe('./dist/index.mjs');
    expect(resolveSourceExportTarget(target)).toBeNull();
  });

  it('formats import paths and source stems deterministically', () => {
    expect(importPathForPackageSubpath('@kovojs/server', '.')).toBe('@kovojs/server');
    expect(importPathForPackageSubpath('@kovojs/server', './build')).toBe('@kovojs/server/build');
    expect(sourceStem('./src/internal/app-shell-vite.ts')).toBe('internal/app-shell-vite');
    expect(sourceStem('./src/button.tsx')).toBe('button');
  });

  it('accepts only canonical shell-safe TypeScript source targets', () => {
    expect(isSourceTarget('./src/index.ts')).toBe(true);
    expect(isSourceTarget('./src/internal/app-shell_v2.tsx')).toBe(true);

    for (const target of [
      './src/../outside.ts',
      './src/a/../../outside.tsx',
      './src/a\\outside.ts',
      './src/a//outside.ts',
      './src/a/./outside.ts',
      './src/a/.ts',
      './src/with space.ts',
      './src/with;command.ts',
      './src/with$(command).ts',
      './src/with%2fescape.ts',
      './src/with?query.ts',
      './src/with#fragment.ts',
      './dist/index.ts',
      './src/index.mjs',
      './src/index.js',
    ]) {
      expect(isSourceTarget(target), target).toBe(false);
      expect(() => sourceStem(target), target).toThrow('expected a ./src/<path>.ts(x) target');
    }
  });

  it('drives publish plan entries, exports, and bin targets from the same resolver', () => {
    expect(
      derivePublishPlan({
        bin: {
          kovo: { source: './src/bin.ts', default: './dist/bin.mjs' },
        },
        exports: {
          '.': {
            source: './src/index.ts',
            types: './dist/index.d.mts',
            default: './dist/index.mjs',
          },
          './button': [{ default: './dist/button.mjs' }, { development: './src/button.tsx' }],
        },
      }),
    ).toEqual({
      entries: ['src/bin.ts', 'src/button.tsx', 'src/index.ts'],
      publishConfig: {
        bin: { kovo: './dist/bin.mjs' },
        exports: {
          '.': {
            types: './dist/index.d.mts',
            default: './dist/index.mjs',
          },
          './button': {
            types: './dist/button.d.mts',
            default: './dist/button.mjs',
          },
        },
      },
      targetFiles: [
        'dist/bin.mjs',
        'dist/button.d.mts',
        'dist/button.mjs',
        'dist/index.d.mts',
        'dist/index.mjs',
      ],
    });
  });

  it('includes typed and authored-MJS private publish entries in the exact proof set', () => {
    expect(
      derivePublishPlan({
        exports: {
          '.': './src/index.ts',
        },
        kovoPublish: {
          extraEntries: ['./src/commands/sound-subset.mjs', './src/compile.ts'],
        },
      }),
    ).toEqual({
      entries: ['src/commands/sound-subset.mjs', 'src/compile.ts', 'src/index.ts'],
      publishConfig: {
        exports: {
          '.': {
            types: './dist/index.d.mts',
            default: './dist/index.mjs',
          },
        },
      },
      targetFiles: [
        'dist/commands/sound-subset.mjs',
        'dist/compile.d.mts',
        'dist/compile.mjs',
        'dist/index.d.mts',
        'dist/index.mjs',
      ],
    });

    for (const target of [
      './dist/compile.mjs',
      './src/../outside.ts',
      './src/a/../../outside.mjs',
      './src/a\\outside.mjs',
      './src/a//outside.ts',
      './src/a/./outside.ts',
      './src/a/.mjs',
      './src/with space.mjs',
      './src/with;command.ts',
      './src/with$(command).mjs',
      './src/with%2fescape.mjs',
      './src/with?query.mjs',
      './src/with#fragment.mjs',
      './src/unsupported.js',
    ]) {
      expect(
        () =>
          derivePublishPlan({
            exports: { '.': './src/index.ts' },
            kovoPublish: { extraEntries: [target] },
          }),
        target,
      ).toThrow('kovoPublish.extraEntries target does not target ./src');
    }

    expect(() =>
      derivePublishPlan({
        exports: { '.': './src/index.ts' },
        kovoPublish: { extraEntries: ['./src/index.mjs'] },
      }),
    ).toThrow(
      'publish entries src/index.ts and src/index.mjs collide on generated target dist/index.mjs',
    );
    expect(() =>
      derivePublishPlan({
        kovoPublish: { extraEntries: ['./src/worker.ts', './src/worker.tsx'] },
      }),
    ).toThrow(
      'publish entries src/worker.ts and src/worker.tsx collide on generated target dist/worker.mjs',
    );
    expect(
      derivePublishPlan({
        kovoPublish: { extraEntries: ['./src/worker.ts', './src/worker.ts'] },
      }).entries,
    ).toEqual(['src/worker.ts']);
  });

  it('keeps the Cloudflare dgram floor behind a private stable server dist entry', () => {
    const server = JSON.parse(readFileSync('packages/server/package.json', 'utf8'));
    const plan = derivePublishPlan(server);

    expect(server.kovoPublish?.extraEntries).toContain('./src/egress-dgram.ts');
    expect(server.exports).not.toHaveProperty('./egress-dgram');
    expect(server.publishConfig?.exports).not.toHaveProperty('./egress-dgram');
    expect(plan.entries).toContain('src/egress-dgram.ts');
    expect(plan.targetFiles).toEqual(
      expect.arrayContaining(['dist/egress-dgram.d.mts', 'dist/egress-dgram.mjs']),
    );
  });

  it('builds every server runtime entry as one private fixed-name module graph', () => {
    const server = JSON.parse(readFileSync('packages/server/package.json', 'utf8'));
    expect(server.kovoPublish?.extraEntries).toEqual([
      './src/egress-dgram.ts',
      './src/internal/generated-build-client-modules.ts',
      './src/internal/generated-handler-runtime.ts',
      './src/sql-parser-authority-cloudflare.ts',
      './src/sql-parser-authority-snapshot.ts',
    ]);
    const plan = derivePublishPlan(server);
    const phases = server.scripts?.['build:dist']?.split(' && ') ?? [];
    const buildArguments = phases[0]?.split(' ') ?? [];

    expect(phases).toHaveLength(1);
    expect(buildCommand(plan, server)).toBe(server.scripts['build:dist']);
    expect(buildArguments).toContain('src/index.ts');
    expect(buildArguments).toContain('src/internal/generated-build-client-modules.ts');
    expect(buildArguments).toContain('src/internal/generated-handler-runtime.ts');
    expect(buildArguments).toContain('src/sql-parser-authority-cloudflare.ts');
    expect(buildArguments).toContain('src/sql-parser-authority-snapshot.ts');
    expect(buildArguments).toContain('--dts');
    expect(buildArguments).toContain('--unbundle');
    expect(server.exports).not.toHaveProperty('./internal/generated-handler-runtime');
    expect(server.publishConfig?.exports).not.toHaveProperty(
      './internal/generated-handler-runtime',
    );
    expect(server.exports).not.toHaveProperty('./internal/sql-parser-authority-cloudflare');
    expect(server.publishConfig?.exports).not.toHaveProperty(
      './internal/sql-parser-authority-cloudflare',
    );
  });

  it('keeps the exact CLI private runtime-entry denominator without inventing MJS declarations', () => {
    const cli = JSON.parse(readFileSync('packages/cli/package.json', 'utf8'));
    const privateEntries = [
      './src/commands/build-one-shot-analyze-worker.ts',
      './src/commands/build-one-shot-check-final-worker.ts',
      './src/commands/build-one-shot-check-worker.ts',
      './src/commands/build-one-shot-client-worker.ts',
      './src/commands/build-one-shot-final-worker.ts',
      './src/commands/build-one-shot-server-worker.ts',
      './src/commands/build-static-trust-worker.ts',
      './src/commands/sound-subset.mjs',
      './src/test-runner-config.ts',
      './src/test-runtime-bootstrap.ts',
    ];
    expect(cli.kovoPublish?.extraEntries).toEqual(privateEntries);

    const plan = derivePublishPlan(cli);
    expect(plan.entries).toEqual(
      expect.arrayContaining(privateEntries.map((entry) => entry.slice(2))),
    );
    expect(plan.targetFiles).toContain('dist/commands/sound-subset.mjs');
    expect(plan.targetFiles).not.toContain('dist/commands/sound-subset.d.mts');
    expect(buildCommand(plan, cli)).toBe(cli.scripts['build:dist']);
  });

  it('retains reviewed package-specific generated files and post-build steps', () => {
    const createKovo = JSON.parse(readFileSync('packages/create-kovo/package.json', 'utf8'));
    const createPlan = derivePublishPlan(createKovo);
    expect(buildCommand(createPlan, createKovo)).toBe(
      'vp pack src/index.ts --dts && node scripts/build-example-assets.mjs',
    );
    expect(buildCommand(createPlan, createKovo)).toBe(createKovo.scripts['build:dist']);

    const verifyPackage = publicPackages().find((pkg) => pkg.name === '@kovojs/verify');
    expect(verifyPackage).toBeDefined();
    const verifyDirectory = path.join(repoRoot, 'packages', verifyPackage.dir);
    const verifyManifest = JSON.parse(
      readFileSync(path.join(verifyDirectory, 'package.json'), 'utf8'),
    );
    const generated = derivePublishedPackageManifest(
      verifyPackage,
      verifyManifest,
      verifyDirectory,
    ).manifest;
    expect(generated.files).toEqual(['dist', 'NOTICE', 'README.md']);
  });

  it('keeps the workspace-only server Vite resolver out of published packages', () => {
    expect(
      derivePublishPlan({
        name: '@kovojs/server',
        exports: {
          '.': './src/index.ts',
          './vite': './src/vite-source.ts',
        },
      }),
    ).toEqual({
      entries: ['src/index.ts', 'src/vite.ts'],
      publishConfig: {
        exports: {
          '.': {
            types: './dist/index.d.mts',
            default: './dist/index.mjs',
          },
          './vite': {
            types: './dist/vite.d.mts',
            default: './dist/vite.mjs',
          },
        },
      },
      targetFiles: ['dist/index.d.mts', 'dist/index.mjs', 'dist/vite.d.mts', 'dist/vite.mjs'],
    });
  });

  it('makes the CLI docs snapshot part of the generated publish proof', () => {
    const manifest = {
      name: '@kovojs/cli',
      bin: { kovo: './src/bin.ts' },
      exports: { '.': './src/api.ts', './internal': './src/index.ts' },
    };
    const plan = derivePublishPlan(manifest);

    expect(plan.targetFiles).toContain('dist/kovo-docs.snapshot.json.gz');
    expect(buildCommand(plan, manifest)).toBe(
      'vp pack src/api.ts src/bin.ts src/index.ts --dts && node ../../scripts/agent-docs-snapshot.mjs',
    );
  });

  it('regenerates all tracked public manifests byte-idempotently', () => {
    for (const pkg of publicPackages()) {
      const directory = path.join(repoRoot, 'packages', pkg.dir);
      const manifestPath = path.join(directory, 'package.json');
      const trackedBytes = readFileSync(manifestPath, 'utf8');
      const tracked = JSON.parse(trackedBytes);
      const first = derivePublishedPackageManifest(pkg, tracked, directory).manifest;
      const firstBytes = `${JSON.stringify(first, null, 2)}\n`;
      expect(firstBytes, `${pkg.name} first generation`).toBe(trackedBytes);

      const second = derivePublishedPackageManifest(pkg, first, directory).manifest;
      expect(`${JSON.stringify(second, null, 2)}\n`, `${pkg.name} second generation`).toBe(
        firstBytes,
      );
    }
  });

  it('generates the exact component and helper hash ledgers for packed UI source', () => {
    const manifest = JSON.parse(readFileSync('packages/ui/package.json', 'utf8'));
    const packageRoot = path.resolve('packages/ui');
    const generatedComponents = uiVendoredSourceHashes(packageRoot, manifest);
    const generatedHelpers = uiVendoredSourceHelperHashes(packageRoot);

    expect(generatedComponents).toEqual(manifest.kovo.vendoredSourceHashes);
    expect(Object.keys(generatedHelpers)).toEqual(uiVendoredHelperSourcePaths);
    expect(generatedHelpers).toEqual(manifest.kovo.vendoredSourceHelperHashes);
  });

  it('refuses to generate helper authority from a symlink', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-ui-helper-ledger-'));
    try {
      mkdirSync(path.join(root, 'src'), { recursive: true });
      for (const helperPath of uiVendoredHelperSourcePaths) {
        writeFileSync(
          path.join(root, helperPath),
          `export const helper = ${JSON.stringify(helperPath)};\n`,
        );
      }
      rmSync(path.join(root, 'src/theme.ts'));
      symlinkSync('safe-url.ts', path.join(root, 'src/theme.ts'));

      expect(() => uiVendoredSourceHelperHashes(root)).toThrow(/regular non-symlink/u);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('refuses component symlinks under the same source policy as helpers', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-ui-component-ledger-'));
    try {
      mkdirSync(path.join(root, 'src'), { recursive: true });
      writeFileSync(path.join(root, 'src/real-button.tsx'), 'export const Button = true;\n');
      symlinkSync('real-button.tsx', path.join(root, 'src/button.tsx'));

      expect(() =>
        uiVendoredSourceHashes(root, {
          exports: { './button': './src/button.tsx' },
        }),
      ).toThrow(/regular non-symlink/u);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('refuses a symlinked src parent and bounded-read overflow', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-ui-source-parent-ledger-'));
    const outside = mkdtempSync(path.join(tmpdir(), 'kovo-ui-source-parent-outside-'));
    try {
      for (const helperPath of uiVendoredHelperSourcePaths) {
        writeFileSync(
          path.join(outside, path.basename(helperPath)),
          `export const helper = ${JSON.stringify(helperPath)};\n`,
        );
      }
      symlinkSync(outside, path.join(root, 'src'), 'dir');
      expect(() => uiVendoredSourceHelperHashes(root)).toThrow(/src parent.*non-symlink/u);

      rmSync(path.join(root, 'src'));
      mkdirSync(path.join(root, 'src'));
      for (const helperPath of uiVendoredHelperSourcePaths) {
        writeFileSync(path.join(root, helperPath), 'export const helper = true;\n');
      }
      writeFileSync(path.join(root, 'src/theme.ts'), 'x'.repeat(2 * 1024 * 1024 + 1));
      expect(() => uiVendoredSourceHelperHashes(root)).toThrow(/read bound/u);
    } finally {
      rmSync(root, { force: true, recursive: true });
      rmSync(outside, { force: true, recursive: true });
    }
  });
});
