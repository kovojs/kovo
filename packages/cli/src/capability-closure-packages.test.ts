import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeCapabilityClosure } from '@kovojs/compiler/internal';
import { afterEach, describe, expect, it } from 'vitest';

import {
  capabilityManifestFingerprint,
  readCapabilityPackageSummaries,
  resolveCapabilityPackages,
} from './capability-closure-packages.js';

const roots: string[] = [];
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

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

function firstPartyImplementationFixture(layout: 'packed-dist' | 'workspace-source'): {
  importer: string;
  mutateImplementation: () => void;
  source: string;
} {
  const root = mkdtempSync(join(tmpdir(), `kovo-first-party-${layout}-`));
  roots.push(root);
  const scopeRoot = join(root, 'node_modules/@kovojs');
  const installedStyleRoot = join(scopeRoot, 'style');
  mkdirSync(installedStyleRoot, { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');

  const workspaceStyleRoot = join(repoRoot, 'packages/style');
  const workspaceManifest = JSON.parse(
    readFileSync(join(workspaceStyleRoot, 'package.json'), 'utf8'),
  ) as Record<string, unknown> & { publishConfig?: Record<string, unknown> };
  if (layout === 'workspace-source') {
    cpSync(join(workspaceStyleRoot, 'src'), join(installedStyleRoot, 'src'), { recursive: true });
    writeFileSync(
      join(installedStyleRoot, 'package.json'),
      `${JSON.stringify(workspaceManifest, null, 2)}\n`,
    );
  } else {
    execFileSync('pnpm', ['--filter', '@kovojs/style', 'build:dist'], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
    cpSync(join(workspaceStyleRoot, 'dist'), join(installedStyleRoot, 'dist'), {
      recursive: true,
    });
    writeFileSync(
      join(installedStyleRoot, 'package.json'),
      `${JSON.stringify({ ...workspaceManifest, ...workspaceManifest.publishConfig }, null, 2)}\n`,
    );
  }

  symlinkSync(join(repoRoot, 'packages/server'), join(scopeRoot, 'server'), 'dir');
  const importer = join(root, 'app.mjs');
  const source = `
    import { route } from '@kovojs/server';
    import { tokens } from '@kovojs/style';
    export const page = route('/theme', { render() { return tokens; } });
  `;
  writeFileSync(importer, source);
  const implementationFile = join(
    installedStyleRoot,
    layout === 'workspace-source' ? 'src/index.ts' : 'dist/index.mjs',
  );
  return {
    importer,
    mutateImplementation: () => {
      writeFileSync(
        implementationFile,
        `${readFileSync(implementationFile, 'utf8')}\nexport const sameVersionDrift = true;\n`,
      );
    },
    source,
  };
}

function analyzeFirstPartyFixture(importer: string, source: string) {
  const packages = resolveCapabilityPackages(
    [
      { importedNames: ['route'], specifier: '@kovojs/server' },
      { importedNames: ['tokens'], specifier: '@kovojs/style' },
    ],
    importer,
  );
  return analyzeCapabilityClosure({
    files: [{ fileName: 'app.ts', source }],
    packages,
  });
}

describe('capability package resolution', () => {
  it.each(['workspace-source', 'packed-dist'] as const)(
    'binds the actual first-party compiler verdict to %s implementation bytes',
    (layout) => {
      const fixture = firstPartyImplementationFixture(layout);
      expect(analyzeFirstPartyFixture(fixture.importer, fixture.source).diagnostics).toEqual([]);

      fixture.mutateImplementation();

      const drifted = analyzeFirstPartyFixture(fixture.importer, fixture.source);
      expect(drifted.diagnostics).toHaveLength(1);
      expect(drifted.diagnostics[0]?.message).toContain(
        'installed implementation digest does not match',
      );
    },
  );

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
