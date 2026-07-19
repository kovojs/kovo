import { hash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createKovoArtifactProvenance,
  resolveKovoArtifactProvenance,
} from './artifact-provenance.js';

const GUARANTEE_HASH = `sha256:${'a'.repeat(64)}`;

describe('build artifact provenance', () => {
  it('changes for every identity input while normalizing set-like package order', () => {
    const create = (overrides: Partial<Parameters<typeof createKovoArtifactProvenance>[0]> = {}) =>
      createKovoArtifactProvenance({
        frameworkPackages: [
          { name: '@kovojs/server', version: '2.0.0' },
          { name: '@kovojs/core', version: '1.0.0' },
          { name: '@kovojs/core', version: '1.0.0' },
        ],
        pnpmLockBytes: 'lockfileVersion: 9\n',
        securityGuarantees: {
          canonicalHash: GUARANTEE_HASH,
          schema: 'kovo.security.guarantees/v1',
        },
        ...overrides,
      });

    const base = create();
    expect(base.frameworkPackages).toEqual([
      { name: '@kovojs/core', version: '1.0.0' },
      { name: '@kovojs/server', version: '2.0.0' },
    ]);
    expect(base.pnpmLock.contentHash).toBe(
      `sha256:${hash('sha256', 'lockfileVersion: 9\n', 'hex')}`,
    );

    const changed = [
      create({
        frameworkPackages: [
          { name: '@kovojs/core', version: '1.0.1' },
          { name: '@kovojs/server', version: '2.0.0' },
        ],
      }),
      create({ graphSchemaVersion: 'kovo.graph/v2' }),
      create({ pnpmLockBytes: 'lockfileVersion: 9\n# changed\n' }),
      create({
        securityGuarantees: {
          canonicalHash: `sha256:${'b'.repeat(64)}`,
          schema: 'kovo.security.guarantees/v1',
        },
      }),
    ];
    expect(new Set([base, ...changed].map((value) => JSON.stringify(value))).size).toBe(5);
    expect(() =>
      create({ frameworkPackages: [{ name: '@kovojs/core', version: '/private/tmp/kovo' }] }),
    ).toThrow(/invalid semantic version/u);
  });

  it('records every distinct version reached through the app and CLI resolution contexts', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-artifact-provenance-'));
    const appRoot = join(root, 'app');
    const appModulePath = join(appRoot, 'app.mjs');
    const cliRoot = join(appRoot, 'node_modules/@kovojs/cli');
    const cliEntryPath = join(cliRoot, 'index.js');

    try {
      mkdirSync(appRoot, { recursive: true });
      writeFileSync(appModulePath, 'export default {};\n');
      writeFileSync(join(appRoot, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
      writeFileSync(
        join(appRoot, 'package.json'),
        JSON.stringify({
          dependencies: {
            '@kovojs/core': '1.0.0',
            '@kovojs/server': '2.0.0',
          },
          devDependencies: { '@kovojs/cli': '4.0.0' },
          optionalDependencies: { '@kovojs/missing': '1.0.0' },
          type: 'module',
        }),
      );
      writePackage(cliRoot, {
        dependencies: { '@kovojs/compiler': '3.0.0' },
        kovoBuildProvenance: {
          securityGuarantees: {
            canonicalHash: GUARANTEE_HASH,
            schema: 'kovo.security.guarantees/v1',
          },
        },
        name: '@kovojs/cli',
        version: '4.0.0',
      });
      writePackage(join(appRoot, 'node_modules/@kovojs/compiler'), {
        exports: { './internal': './index.js' },
        name: '@kovojs/compiler',
        version: '3.0.0',
      });
      writePackage(join(appRoot, 'node_modules/@kovojs/core'), {
        name: '@kovojs/core',
        version: '1.0.0',
      });
      const serverRoot = join(appRoot, 'node_modules/@kovojs/server');
      writePackage(serverRoot, {
        dependencies: { '@kovojs/core': '2.0.0' },
        name: '@kovojs/server',
        version: '2.0.0',
      });
      writePackage(join(serverRoot, 'node_modules/@kovojs/core'), {
        name: '@kovojs/core',
        version: '2.0.0',
      });

      expect(resolveKovoArtifactProvenance({ appModulePath, cliEntryPath })).toMatchObject({
        frameworkPackages: [
          { name: '@kovojs/cli', version: '4.0.0' },
          { name: '@kovojs/compiler', version: '3.0.0' },
          { name: '@kovojs/core', version: '1.0.0' },
          { name: '@kovojs/core', version: '2.0.0' },
          { name: '@kovojs/server', version: '2.0.0' },
        ],
        graphSchemaVersion: 'kovo.graph/v1',
        pnpmLock: {
          contentHash: `sha256:${hash('sha256', 'lockfileVersion: 9.0\n', 'hex')}`,
        },
        schema: 'kovo.artifact.provenance/v1',
        securityGuarantees: {
          canonicalHash: GUARANTEE_HASH,
          schema: 'kovo.security.guarantees/v1',
        },
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('fails closed when no pnpm lockfile is in the app ancestry', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-artifact-provenance-no-lock-'));
    const cliRoot = join(root, 'cli');
    const cliEntryPath = join(cliRoot, 'index.js');
    const appModulePath = join(root, 'app.mjs');
    try {
      writeFileSync(appModulePath, 'export default {};\n');
      writePackage(cliRoot, {
        kovoBuildProvenance: {
          securityGuarantees: {
            canonicalHash: GUARANTEE_HASH,
            schema: 'kovo.security.guarantees/v1',
          },
        },
        name: '@kovojs/cli',
        version: '1.0.0',
      });
      expect(() => resolveKovoArtifactProvenance({ appModulePath, cliEntryPath })).toThrow(
        /requires a pnpm-lock\.yaml ancestor/u,
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

function writePackage(
  root: string,
  manifest: Record<string, unknown> & { name: string; version: string },
): void {
  mkdirSync(dirname(root), { recursive: true });
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify({ main: './index.js', type: 'module', ...manifest }, null, 2)}\n`,
  );
  writeFileSync(join(root, 'index.js'), 'export default {};\n');
}
