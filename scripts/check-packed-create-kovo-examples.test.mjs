import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  assertExampleScaffoldReleaseVersions,
  assertExampleUsesAuthenticatedTarballs,
  assertRetainedExampleBuildPosture,
  packedExampleVerificationCommands,
  parsePackedCreateKovoExamplesArgs,
  snapshotAuthenticatedTarballBytes,
} from './check-packed-create-kovo-examples.mjs';

describe('packed create-kovo examples gate', () => {
  it('accepts only an explicit packed-manifest input', () => {
    expect(parsePackedCreateKovoExamplesArgs([]).packedManifest).toMatch(
      /\.release\/packed-packages\.json$/u,
    );
    expect(
      parsePackedCreateKovoExamplesArgs(['--packed-manifest', '/tmp/release/packed-packages.json']),
    ).toEqual({ packedManifest: '/tmp/release/packed-packages.json' });
    expect(() => parsePackedCreateKovoExamplesArgs(['--fresh-pack'])).toThrow(
      'Unknown packed create-kovo examples argument',
    );
    expect(() => parsePackedCreateKovoExamplesArgs(['--packed-manifest'])).toThrow(
      '--packed-manifest requires a value',
    );
    expect(() =>
      parsePackedCreateKovoExamplesArgs([
        '--packed-manifest',
        '/tmp/one',
        '--packed-manifest',
        '/tmp/two',
      ]),
    ).toThrow('--packed-manifest may be provided only once');
  });

  it('fails closed when authenticated tarball bytes drift before use', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'kovo-packed-example-snapshot-'));
    try {
      const tarballPath = path.join(root, 'package.tgz');
      writeFileSync(tarballPath, 'changed bytes');
      const packages = new Map([
        [
          '@kovojs/core',
          {
            entries: [],
            name: '@kovojs/core',
            sha512: `sha512-${createHash('sha512').update('authenticated bytes').digest('base64')}`,
            tarballPath,
          },
        ],
      ]);
      expect(() => snapshotAuthenticatedTarballBytes(packages)).toThrow(
        '@kovojs/core tarball changed after packed-manifest authentication',
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('requires creator versions, dependency tarballs, and the retained SPEC §14 posture', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'kovo-packed-example-contract-'));
    try {
      const appRoot = path.join(root, 'app');
      const tarballRoot = path.join(root, 'tarballs');
      mkdirSync(appRoot, { recursive: true });
      mkdirSync(tarballRoot, { recursive: true });
      const packages = new Map(
        ['@kovojs/cli', '@kovojs/core'].map((name) => {
          const tarballPath = path.join(tarballRoot, `${name.slice('@kovojs/'.length)}.tgz`);
          writeFileSync(tarballPath, name);
          return [
            name,
            {
              name,
              tarballPath,
              version: '0.3.0',
            },
          ];
        }),
      );
      writeFileSync(
        path.join(appRoot, 'package.json'),
        `${JSON.stringify(
          {
            name: 'packed-crm',
            scripts: {
              build: 'kovo build ./src/scaffold-app.tsx',
              check: 'kovo check',
              test: 'vitest --run --config vitest.config.ts',
              typecheck: 'tsc --noEmit',
            },
            dependencies: {
              '@kovojs/core': '0.3.0',
            },
            devDependencies: {
              '@kovojs/cli': '0.3.0',
            },
          },
          null,
          2,
        )}\n`,
      );
      assertExampleScaffoldReleaseVersions(appRoot, packages, 'crm');

      const packedManifest = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
      for (const field of ['dependencies', 'devDependencies']) {
        for (const name of Object.keys(packedManifest[field])) {
          packedManifest[field][name] = pathToFileURL(packages.get(name).tarballPath).href;
        }
      }
      packedManifest.pnpm = {
        overrides: Object.fromEntries(
          [...packages].map(([name, pkg]) => [name, pathToFileURL(pkg.tarballPath).href]),
        ),
      };
      writeFileSync(
        path.join(appRoot, 'package.json'),
        `${JSON.stringify(packedManifest, null, 2)}\n`,
      );
      assertExampleUsesAuthenticatedTarballs(appRoot, packages, 'crm');

      writeFileSync(
        path.join(appRoot, 'kovo.config.ts'),
        [
          "import { defineConfig, node } from '@kovojs/server/build';",
          '',
          'export default defineConfig({',
          '  preset: node({',
          '    retention: {',
          '      hours: 24,',
          "      immutableClientModules: 'retained',",
          "      priorTokenQueryReads: 'retained',",
          '    },',
          '  }),',
          '});',
          '',
          '// SPEC §14: this declaration is a deployment assertion.',
          '',
        ].join('\n'),
      );
      assertRetainedExampleBuildPosture(appRoot, 'crm');

      packedManifest.dependencies['@kovojs/core'] = 'workspace:*';
      writeFileSync(
        path.join(appRoot, 'package.json'),
        `${JSON.stringify(packedManifest, null, 2)}\n`,
      );
      expect(() => assertExampleUsesAuthenticatedTarballs(appRoot, packages, 'crm')).toThrow(
        'is not an installable packed specifier',
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('names every required consumer phase explicitly', () => {
    expect(packedExampleVerificationCommands('/tmp/store')).toEqual([
      {
        command: [
          'pnpm',
          'install',
          '--ignore-workspace',
          '--no-frozen-lockfile',
          '--ignore-scripts',
          '--strict-peer-dependencies',
          '--store-dir',
          '/tmp/store',
        ],
        phase: 'install',
      },
      {
        command: ['pnpm', 'exec', 'kovo', 'check', 'lifecycle'],
        phase: 'lifecycle',
      },
      { command: ['pnpm', 'rebuild'], phase: 'rebuild' },
      { command: ['pnpm', 'exec', 'tsc', '--noEmit'], phase: 'typecheck' },
      {
        command: ['pnpm', 'exec', 'vitest', '--run', '--config', 'vitest.config.ts'],
        phase: 'test',
      },
      {
        command: ['pnpm', 'exec', 'kovo', 'check', 'source', './src/scaffold-app.tsx'],
        phase: 'check',
      },
      {
        command: ['pnpm', 'exec', 'kovo', 'build', './src/scaffold-app.tsx'],
        phase: 'build',
      },
    ]);
  });
});
