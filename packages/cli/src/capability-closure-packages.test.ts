import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  capabilityManifestFingerprint,
  readCapabilityPackageSummaries,
  resolveCapabilityPackages,
} from './capability-closure-packages.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function fixtureRoot(): { importer: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'kovo-capability-packages-'));
  roots.push(root);
  const packageRoot = join(root, 'node_modules/safe-parser');
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
  const manifest = {
    name: 'safe-parser',
    version: '1.2.3',
    type: 'module',
    exports: {
      '.': {
        types: './index.d.ts',
        browser: './browser.js',
        import: './index.js',
        default: './index.js',
      },
      './feature': {
        node: { import: './feature.js', require: './feature.cjs' },
        default: './feature.js',
      },
    },
  };
  writeFileSync(join(packageRoot, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const file of ['index.js', 'browser.js', 'feature.js', 'feature.cjs']) {
    writeFileSync(join(packageRoot, file), 'export const value = 1;\n');
  }
  writeFileSync(join(packageRoot, 'index.d.ts'), 'export declare const value: number;\n');
  const importer = join(root, 'app.mjs');
  writeFileSync(importer, 'export {};\n');
  return { importer, root };
}

describe('capability package resolution', () => {
  it('keeps Node built-ins out of filesystem package-metadata resolution', () => {
    const { importer } = fixtureRoot();
    expect(
      resolveCapabilityPackages(
        [
          { importedNames: ['readFileSync'], specifier: 'node:fs' },
          { importedNames: ['resolve'], specifier: 'path' },
        ],
        importer,
      ),
    ).toEqual([]);
  });

  it('pins package version, manifest fingerprint, and every conditional export arm', () => {
    const { importer } = fixtureRoot();
    const facts = resolveCapabilityPackages(
      [
        { importedNames: ['value'], specifier: 'safe-parser' },
        { importedNames: ['value'], specifier: 'safe-parser/feature' },
      ],
      importer,
    );
    expect(facts).toHaveLength(2);
    expect(facts[0]).toMatchObject({
      conditions: ['browser', 'default', 'import', 'types'],
      exportStatus: 'resolved',
      packageName: 'safe-parser',
      packageVersion: '1.2.3',
      specifier: 'safe-parser',
    });
    expect(facts[1]).toMatchObject({
      conditions: ['default', 'import', 'node', 'require'],
      exportStatus: 'resolved',
      specifier: 'safe-parser/feature',
    });
    expect(facts[0]!.manifestFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(facts[0]!.manifestFingerprint).toBe(facts[1]!.manifestFingerprint);
  });

  it('marks absent conditional subpaths unresolved instead of inheriting a root verdict', () => {
    const { importer } = fixtureRoot();
    const facts = resolveCapabilityPackages(
      [{ importedNames: ['value'], specifier: 'safe-parser/missing' }],
      importer,
    );
    // The package identity is still pinned, but the requested export stays explicitly unresolved
    // so the compiler turns it into KV448 instead of inheriting the root verdict.
    expect(facts).toEqual([
      expect.objectContaining({
        conditions: [],
        exportStatus: 'unresolved',
        packageName: 'safe-parser',
        specifier: 'safe-parser/missing',
      }),
    ]);
  });

  it('fingerprints security-relevant manifest fields canonically', () => {
    const left = capabilityManifestFingerprint({
      exports: { '.': { default: './index.js', import: './index.js' } },
      name: 'pkg',
      version: '1.0.0',
    });
    const reordered = capabilityManifestFingerprint({
      version: '1.0.0',
      name: 'pkg',
      exports: { '.': { import: './index.js', default: './index.js' } },
    });
    const changed = capabilityManifestFingerprint({
      exports: { '.': { default: './other.js', import: './index.js' } },
      name: 'pkg',
      version: '1.0.0',
    });
    expect(left).toBe(reordered);
    expect(changed).not.toBe(left);
  });

  it('loads an exact summary ledger and fails closed on unknown or malformed authority fields', () => {
    const { root } = fixtureRoot();
    const summary = {
      schema: 'kovo-package-capability-summaries/v1',
      packages: [
        {
          schema: 'kovo-package-capabilities/v1',
          packageName: 'safe-parser',
          packageVersion: '1.2.3',
          manifestFingerprint: 'sha256:reviewed',
          summaryVersion: 'safe-parser/1',
          entries: [
            {
              subpath: '.',
              conditions: ['types', 'import', 'default', 'browser'],
              exports: [{ name: 'parse', disposition: 'pure', capabilities: [] }],
            },
          ],
        },
      ],
    };
    writeFileSync(join(root, 'kovo.capabilities.json'), `${JSON.stringify(summary, null, 2)}\n`);
    expect(readCapabilityPackageSummaries(root)).toEqual([
      expect.objectContaining({
        packageName: 'safe-parser',
        source: 'kovo.capabilities.json',
        summaryVersion: 'safe-parser/1',
      }),
    ]);

    writeFileSync(
      join(root, 'kovo.capabilities.json'),
      `${JSON.stringify({ ...summary, unexpected: true })}\n`,
    );
    expect(() => readCapabilityPackageSummaries(root)).toThrow(
      '$.unexpected is not a supported field',
    );

    const forged = {
      ...summary,
      packages: [
        {
          ...summary.packages[0]!,
          entries: [
            {
              ...summary.packages[0]!.entries[0]!,
              exports: [
                {
                  ...summary.packages[0]!.entries[0]!.exports[0]!,
                  capabilities: ['ambient-root'],
                },
              ],
            },
          ],
        },
      ],
    };
    writeFileSync(join(root, 'kovo.capabilities.json'), `${JSON.stringify(forged)}\n`);
    expect(() => readCapabilityPackageSummaries(root)).toThrow('unknown capability ambient-root');
  });
});
