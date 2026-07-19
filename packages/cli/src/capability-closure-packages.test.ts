import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
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
  implementationFiles: readonly { fileName: string; label: string }[];
  manifestPath: string;
  packageRoot: string;
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
  const manifestPath = join(installedStyleRoot, 'package.json');
  if (layout === 'workspace-source') {
    cpSync(join(workspaceStyleRoot, 'src'), join(installedStyleRoot, 'src'), { recursive: true });
    writeFileSync(manifestPath, `${JSON.stringify(workspaceManifest, null, 2)}\n`);
  } else {
    execFileSync('pnpm', ['--filter', '@kovojs/style', 'build:dist'], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
    cpSync(join(workspaceStyleRoot, 'dist'), join(installedStyleRoot, 'dist'), {
      recursive: true,
    });
    writeFileSync(
      manifestPath,
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
  const implementationFiles =
    layout === 'workspace-source'
      ? [{ fileName: join(installedStyleRoot, 'src/index.ts'), label: 'resolved source entry' }]
      : packedImplementationMutationFiles(installedStyleRoot);
  return {
    importer,
    implementationFiles,
    manifestPath,
    packageRoot: installedStyleRoot,
    source,
  };
}

function packedImplementationMutationFiles(
  packageRoot: string,
): readonly { fileName: string; label: string }[] {
  const distRoot = join(packageRoot, 'dist');
  const files = readdirSync(distRoot).sort();
  const named = (label: string, predicate: (fileName: string) => boolean) => {
    const fileName = files.find(predicate);
    if (fileName === undefined) throw new Error(`packed fixture has no ${label}`);
    return { fileName: join(distRoot, fileName), label };
  };
  return [
    { fileName: join(distRoot, 'index.mjs'), label: 'resolved entry' },
    named(
      'non-entry chunk',
      (fileName) => fileName.endsWith('.mjs') && !['index.mjs', 'internal.mjs'].includes(fileName),
    ),
    named('non-entry source map', (fileName) => fileName.endsWith('.mjs.map')),
    named(
      'non-entry declaration',
      (fileName) =>
        fileName.endsWith('.d.mts') && !['index.d.mts', 'internal.d.mts'].includes(fileName),
    ),
  ];
}

function analyzeFirstPartyFixture(importer: string, source: string) {
  return analyzeCapabilityClosure({
    files: [{ fileName: 'app.ts', source }],
    packages: resolveFirstPartyFixture(importer),
  });
}

function resolveFirstPartyFixture(importer: string) {
  return resolveCapabilityPackages(
    [
      { importedNames: ['route'], specifier: '@kovojs/server' },
      { importedNames: ['tokens'], specifier: '@kovojs/style' },
    ],
    importer,
  );
}

function firstPartyCompilerCatalogFixture(): {
  catalogFile: string;
  importer: string;
  source: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'kovo-first-party-compiler-catalog-'));
  roots.push(root);
  const scopeRoot = join(root, 'node_modules/@kovojs');
  const installedCompilerRoot = join(scopeRoot, 'compiler');
  mkdirSync(installedCompilerRoot, { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
  cpSync(join(repoRoot, 'packages/compiler/src'), join(installedCompilerRoot, 'src'), {
    recursive: true,
  });
  cpSync(
    join(repoRoot, 'packages/compiler/package.json'),
    join(installedCompilerRoot, 'package.json'),
  );
  symlinkSync(join(repoRoot, 'packages/server'), join(scopeRoot, 'server'), 'dir');
  const importer = join(root, 'app.mjs');
  const source = `
    import { route } from '@kovojs/server';
    import { analyzeCapabilityClosure as compilerInternal } from '@kovojs/compiler/internal';
    export const page = route('/compiler', { render() { return compilerInternal; } });
  `;
  writeFileSync(importer, source);
  return {
    catalogFile: join(
      installedCompilerRoot,
      'src/security/framework-public-runtime-export-posture.generated.ts',
    ),
    importer,
    source,
  };
}

describe('capability package resolution', () => {
  it.each(['workspace-source', 'packed-dist'] as const)(
    'binds the actual first-party compiler verdict to %s implementation bytes',
    (layout) => {
      const fixture = firstPartyImplementationFixture(layout);
      const baselinePackages = resolveFirstPartyFixture(fixture.importer);
      expect(
        analyzeCapabilityClosure({
          files: [{ fileName: 'app.ts', source: fixture.source }],
          packages: baselinePackages,
        }).diagnostics,
      ).toEqual([]);

      const manifest = JSON.parse(readFileSync(fixture.manifestPath, 'utf8')) as Record<
        string,
        unknown
      >;
      manifest.implementationDigest = baselinePackages.find(
        (fact) => fact.packageName === '@kovojs/style',
      )?.implementationDigest;
      writeFileSync(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      expect(analyzeFirstPartyFixture(fixture.importer, fixture.source).diagnostics).toEqual([]);

      for (const implementation of fixture.implementationFiles) {
        const baseline = readFileSync(implementation.fileName);
        writeFileSync(
          implementation.fileName,
          Buffer.concat([
            baseline,
            Buffer.from(`\n// same-version ${implementation.label} drift\n`),
          ]),
        );

        const drifted = analyzeFirstPartyFixture(fixture.importer, fixture.source);
        expect(drifted.diagnostics, implementation.label).toHaveLength(1);
        expect(drifted.diagnostics[0]?.message, implementation.label).toContain(
          'installed implementation digest does not match',
        );

        writeFileSync(implementation.fileName, baseline);
        expect(
          analyzeFirstPartyFixture(fixture.importer, fixture.source).diagnostics,
          implementation.label,
        ).toEqual([]);
      }

      const implementationRoot = join(
        fixture.packageRoot,
        layout === 'workspace-source' ? 'src' : 'dist',
      );
      const movedImplementationRoot = `${implementationRoot}-symlink-target`;
      renameSync(implementationRoot, movedImplementationRoot);
      symlinkSync(movedImplementationRoot, implementationRoot, 'dir');
      const linkedRoot = analyzeFirstPartyFixture(fixture.importer, fixture.source);
      expect(linkedRoot.diagnostics).toHaveLength(1);
      expect(linkedRoot.diagnostics[0]?.message).toContain(
        'no compiler-derived installed implementation digest',
      );
      rmSync(implementationRoot);
      renameSync(movedImplementationRoot, implementationRoot);

      if (layout === 'workspace-source') {
        const runtimeAsset = join(fixture.packageRoot, 'src/runtime-template.json');
        writeFileSync(runtimeAsset, '{"template":"drift"}\n');
        const assetDrift = analyzeFirstPartyFixture(fixture.importer, fixture.source);
        expect(assetDrift.diagnostics).toHaveLength(1);
        expect(assetDrift.diagnostics[0]?.message).toContain(
          'installed implementation digest does not match',
        );
        rmSync(runtimeAsset);

        const runtimeLink = join(fixture.packageRoot, 'src/runtime-link.ts');
        symlinkSync(join(fixture.packageRoot, 'src/index.ts'), runtimeLink);
        const linked = analyzeFirstPartyFixture(fixture.importer, fixture.source);
        expect(linked.diagnostics).toHaveLength(1);
        expect(linked.diagnostics[0]?.message).toContain(
          'no compiler-derived installed implementation digest',
        );
        rmSync(runtimeLink);

        rmSync(join(fixture.packageRoot, 'src'), { recursive: true });
        const missingSource = analyzeFirstPartyFixture(fixture.importer, fixture.source);
        expect(missingSource.diagnostics).toHaveLength(1);
        expect(missingSource.diagnostics[0]?.message).toContain(
          'could not be resolved to one exact installed manifest',
        );
      }
    },
  );

  it('hashes repeated first-party subpaths once and never walks third-party dist trees', () => {
    const firstParty = firstPartyImplementationFixture('workspace-source');
    const firstPartyWalks: string[] = [];
    const facts = resolveCapabilityPackages(
      [
        { importedNames: ['tokens'], specifier: '@kovojs/style' },
        { importedNames: ['style'], specifier: '@kovojs/style/internal' },
      ],
      firstParty.importer,
      {
        onImplementationTreeWalk(packageRoot, layout) {
          firstPartyWalks.push(`${packageRoot}:${layout}`);
        },
      },
    );
    expect(facts).toHaveLength(2);
    expect(new Set(facts.map((fact) => fact.implementationDigest)).size).toBe(1);
    expect(firstPartyWalks).toHaveLength(1);

    const thirdParty = fixtureRoot();
    const packageRoot = join(thirdParty.root, 'node_modules/safe-parser');
    const manifestPath = join(packageRoot, 'package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    manifest.exports = { '.': { default: './dist/index.js', import: './dist/index.js' } };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    mkdirSync(join(packageRoot, 'dist'));
    writeFileSync(join(packageRoot, 'dist/index.js'), 'export const value = 1;\n');
    const thirdPartyWalks: string[] = [];
    const [thirdPartyFact] = resolveCapabilityPackages(
      [{ importedNames: ['value'], specifier: 'safe-parser' }],
      thirdParty.importer,
      {
        onImplementationTreeWalk(packageRoot, layout) {
          thirdPartyWalks.push(`${packageRoot}:${layout}`);
        },
      },
    );
    expect(thirdPartyFact).toMatchObject({ exportStatus: 'resolved', packageName: 'safe-parser' });
    expect(thirdPartyFact).not.toHaveProperty('implementationDigest');
    expect(thirdPartyWalks).toEqual([]);
  });

  it('closes source compiler catalog permission and non-self digest drift', () => {
    const fixture = firstPartyCompilerCatalogFixture();
    const requests = [
      { importedNames: ['route'], specifier: '@kovojs/server' },
      {
        importedNames: ['analyzeCapabilityClosure'],
        specifier: '@kovojs/compiler/internal',
      },
    ];
    const analyzeFixture = () =>
      analyzeCapabilityClosure({
        files: [{ fileName: 'app.ts', source: fixture.source }],
        packages: resolveCapabilityPackages(requests, fixture.importer),
      });
    const baseline = analyzeFixture();
    expect(baseline.diagnostics).toHaveLength(1);
    expect(baseline.diagnostics[0]?.message).toContain(
      'does not classify public subpath ./internal',
    );

    const catalog = readFileSync(fixture.catalogFile, 'utf8');
    const mutations = [
      catalog.replace('"authority-free"', '"request-closed"'),
      catalog.replace(
        /kovo-source-tree-sha256:[a-f0-9]{64}/u,
        `kovo-source-tree-sha256:${'0'.repeat(64)}`,
      ),
    ];
    for (const mutation of mutations) {
      expect(mutation).not.toBe(catalog);
      writeFileSync(fixture.catalogFile, mutation);
      const drifted = analyzeFixture();
      expect(drifted.diagnostics).toHaveLength(1);
      expect(drifted.diagnostics[0]?.code).toBe('KV448');
      expect(drifted.diagnostics[0]?.message).toContain(
        'installed implementation digest does not match',
      );
      writeFileSync(fixture.catalogFile, catalog);
    }
  });

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
