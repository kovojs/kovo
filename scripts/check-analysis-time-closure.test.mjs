import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  checkAnalysisTimeClosure,
  collectAnalysisImportGraph,
  collectSecurityRatchetFindings,
  deriveTransitiveSubjects,
  discoverGateEntrypoints,
  subjectLabel,
} from './check-analysis-time-closure.mjs';
import { collectWorkspacePackageJsons } from './check-tcb-boundary.mjs';
import {
  parsePnpmPackageIntegrities,
  parsePnpmSnapshotDependencies,
} from './lib/pnpm-lock-packages.mjs';

const shaA =
  'sha512-y2TvuxSZPDyQakkFRPZHKFm+KKVqIisdg9/CZwm9ftvKXLP8NRWj38/ODjNbr43SsoXqNuAisEf1GdCxqWcdBw==';
const shaB =
  'sha512-z2TvuxSZPDyQakkFRPZHKFm+KKVqIisdg9/CZwm9ftvKXLP8NRWj38/ODjNbr43SsoXqNuAisEf1GdCxqWcdBw==';

describe('analysis-time closure', () => {
  it('discovers new check entrypoints and recursively referenced root scripts', () => {
    const files = new Set([
      'scripts/first.mjs',
      'scripts/second.mjs',
      'packages/compiler/src/index.ts',
    ]);
    const discovered = discoverGateEntrypoints({
      compileEntrypoints: ['packages/compiler/src/index.ts'],
      exists: (file) => files.has(file),
      rootManifest: {
        scripts: {
          check: 'pnpm run check:first',
          'check:first': 'node scripts/first.mjs && pnpm run proof',
          proof: 'vitest --run scripts/second.mjs',
        },
      },
      workspaceManifests: [],
    });

    expect(discovered.findings).toEqual([]);
    expect(discovered.entrypoints).toEqual([
      'packages/compiler/src/index.ts',
      'scripts/first.mjs',
      'scripts/second.mjs',
    ]);
    expect(discovered.commandPackages).toEqual(['vitest']);
  });

  it('enrolls child test entrypoints declared after an isolated gate runner', () => {
    const files = new Set([
      'scripts/isolated-runner.ts',
      'packages/framework/src/security-proof.test.ts',
    ]);
    const discovered = discoverGateEntrypoints({
      compileEntrypoints: [],
      exists: (file) => files.has(file),
      rootManifest: {
        scripts: {
          check: 'pnpm run test:isolated',
          'test:isolated':
            'node --experimental-strip-types scripts/isolated-runner.ts packages/framework/src/security-proof.test.ts',
        },
      },
      workspaceManifests: [],
    });

    expect(discovered.findings).toEqual([]);
    expect(discovered.entrypoints).toEqual([
      'packages/framework/src/security-proof.test.ts',
      'scripts/isolated-runner.ts',
    ]);
  });

  it('discovers gate entrypoints hidden behind the reviewed cost-runner registry', () => {
    const registryPath = 'security/plan3-security-gate-commands.json';
    const files = new Map([
      ['packages/better-auth/src/lifecycle-inheritance.test.ts', ''],
      ['scripts/check-auth-provider-pin.mjs', ''],
      [
        registryPath,
        JSON.stringify({
          gates: [
            { execution: 'self-check', id: 'cost-budget-manifest' },
            {
              id: 'auth-provider-pin',
              steps: [
                { command: ['node', 'scripts/check-auth-provider-pin.mjs'] },
                {
                  command: [
                    'pnpm',
                    'exec',
                    'vitest',
                    '--run',
                    'packages/better-auth/src/lifecycle-inheritance.test.ts',
                  ],
                },
              ],
            },
          ],
          schema: 'kovo.plan3-security-gate-commands/v1',
        }),
      ],
    ]);
    const discovered = discoverGateEntrypoints({
      compileEntrypoints: [],
      exists: (file) => files.has(file),
      readText: (file) => files.get(file),
      rootManifest: {
        scripts: {
          check: 'node scripts/security-cost-budget-runner.mjs --check',
        },
      },
      workspaceManifests: [],
    });

    expect(discovered.findings).toEqual([]);
    expect(discovered.entrypoints).toEqual([
      'packages/better-auth/src/lifecycle-inheritance.test.ts',
      'scripts/check-auth-provider-pin.mjs',
    ]);
    expect(discovered.commandPackages).toEqual(['vitest']);
  });

  it('follows first-party command bins and rejects an unclassified gate executable', () => {
    const files = new Set(['packages/cli/src/bin.ts']);
    const discovered = discoverGateEntrypoints({
      compileEntrypoints: [],
      exists: (file) => files.has(file),
      rootManifest: {
        scripts: {
          check: 'kovo verify && vp exec rogue-linter .',
        },
      },
      workspaceManifests: [
        {
          manifest: { bin: { kovo: './src/bin.ts' }, name: '@kovojs/cli' },
          path: 'packages/cli/package.json',
        },
      ],
    });

    expect(discovered.entrypoints).toContain('packages/cli/src/bin.ts');
    expect(discovered.commandPackages).toEqual(['vite-plus']);
    expect(discovered.findings).toContain(
      'package.json#check: gate command executable rogue-linter has no analysis-time package enrollment',
    );
  });

  it('walks local/workspace imports, ignores type-only imports, and records dynamic acquisitions', () => {
    const files = {
      'packages/core/package.json': JSON.stringify({
        exports: { '.': './src/index.ts' },
        name: '@kovojs/core',
      }),
      'packages/core/src/index.ts': "export { value } from './value.js';\n",
      'packages/core/src/value.ts': 'export const value = 1;\n',
      'scripts/gate.mjs': `
        import { createRequire as makeRequire } from 'node:module';
        import type { Ignore } from 'type-only-package';
        import { value } from '@kovojs/core';
        import ts from 'typescript';
        const localRequire = makeRequire(import.meta.url);
        localRequire.resolve('integrity-tool/subpath');
        const appModulePath = '/app/src/app.tsx';
        const stylesheetSpecifier = '@kovojs/ui/button';
        makeRequire(appModulePath).resolve(stylesheetSpecifier);
        const typescriptPath = localRequire.resolve('typescript');
        localRequire(resolvePlugin());
        localRequire(typescriptPath);
        await import(resolvePlugin());
        export { value, ts };
      `,
    };
    const workspace = new Map([
      [
        '@kovojs/core',
        {
          manifest: JSON.parse(files['packages/core/package.json']),
          path: 'packages/core/package.json',
        },
      ],
    ]);
    const graph = collectAnalysisImportGraph({
      entrypoints: ['scripts/gate.mjs'],
      exists: (file) => Object.hasOwn(files, file),
      readText: (file) => files[file],
      workspacePackages: workspace,
    });

    expect(graph.findings).toEqual([]);
    expect(graph.files).toEqual([
      'packages/core/src/index.ts',
      'packages/core/src/value.ts',
      'scripts/gate.mjs',
    ]);
    expect(graph.externalPackages).toEqual(['integrity-tool', 'typescript']);
    expect(graph.dynamicAcquisitions).toEqual([
      {
        expression: 'import(resolvePlugin())',
        id: 'scripts/gate.mjs#import#import(resolvePlugin())',
        kind: 'import',
      },
      {
        expression: 'makeRequire(appModulePath).resolve(stylesheetSpecifier)',
        id: 'scripts/gate.mjs#require.resolve#makeRequire(appModulePath).resolve(stylesheetSpecifier)',
        kind: 'require.resolve',
      },
      {
        expression: 'localRequire(resolvePlugin())',
        id: 'scripts/gate.mjs#require#localRequire(resolvePlugin())',
        kind: 'require',
      },
      {
        expression: 'localRequire(typescriptPath)',
        id: 'scripts/gate.mjs#require#localRequire(typescriptPath)',
        kind: 'require',
      },
    ]);
  });

  it('excludes generated Next output while retaining every authored manifest', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-analysis-workspaces-'));
    try {
      const authoredNext = join(root, 'benchmarks/nextjs/package.json');
      const authoredDuplicate = join(root, 'benchmarks/alternate/package.json');
      const generatedNext = join(
        root,
        'benchmarks/nextjs/.next/standalone/benchmarks/nextjs/package.json',
      );
      for (const manifestPath of [authoredNext, authoredDuplicate, generatedNext]) {
        mkdirSync(dirname(manifestPath), { recursive: true });
        writeFileSync(manifestPath, '{"name":"kovo-benchmark-nextjs"}\n', 'utf8');
      }

      expect(collectWorkspacePackageJsons(root)).toEqual([
        'package.json',
        'benchmarks/alternate/package.json',
        'benchmarks/nextjs/package.json',
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('still rejects duplicate identities in authored manifest paths', () => {
    const files = {
      'package.json': '{"name":"root","scripts":{}}',
      'benchmarks/alternate/package.json': '{"name":"kovo-benchmark-nextjs"}',
      'benchmarks/nextjs/package.json': '{"name":"kovo-benchmark-nextjs"}',
      'pnpm-lock.yaml': `lockfileVersion: '9.0'
packages:
  unused@1.0.0:
    resolution: {integrity: ${shaA}}
snapshots:
  unused@1.0.0: {}
`,
    };
    const manifest = {
      analysisTimeClosure: {
        compileEntrypoints: [],
        dynamicAcquisitions: [],
        maxPackageCount: 0,
        roots: [],
        schema: 'kovo.security.analysis-time-closure/v1',
        subjects: [],
      },
      budgets: { totalTcbMaxLines: 0 },
      entries: [],
      securityRatchet: {
        limits: { analysisClosureSize: 0, entryCount: 0, totalTcbMaxLines: 0 },
        reviewedRaises: [],
        schema: 'kovo.security.tcb-ratchet/v1',
      },
    };
    const result = checkAnalysisTimeClosure({
      exists: (file) => Object.hasOwn(files, file),
      manifest,
      previousManifest: null,
      readText: (file) => files[file],
      repoRoot: '/repo',
      workspacePackageJsons: [
        'package.json',
        'benchmarks/alternate/package.json',
        'benchmarks/nextjs/package.json',
      ],
    });

    expect(result.findings).toEqual([
      'benchmarks/nextjs/package.json: duplicate workspace name kovo-benchmark-nextjs',
    ]);
  });

  it('rejects a local import that escapes the repository root', () => {
    const graph = collectAnalysisImportGraph({
      entrypoints: ['scripts/gate.mjs'],
      exists: () => true,
      readText: () => "import '../../outside.mjs';\n",
      workspacePackages: new Map(),
    });

    expect(graph.findings).toEqual([
      'scripts/gate.mjs: cannot resolve local analysis import ../../outside.mjs',
    ]);
    expect(graph.files).toEqual(['scripts/gate.mjs']);
  });

  it('derives the full optional-inclusive transitive integrity closure', () => {
    const lockfile = `packages:
  root@1.0.0:
    resolution: {integrity: ${shaA}}
  child@2.0.0:
    resolution: {integrity: ${shaB}}
snapshots:
  root@1.0.0:
    optionalDependencies:
      child: 2.0.0
  child@2.0.0: {}
`;
    const packages = parsePnpmPackageIntegrities(lockfile).packages;
    const snapshots = parsePnpmSnapshotDependencies(lockfile).snapshots;
    const derived = deriveTransitiveSubjects({
      packages,
      roots: [{ dependency: 'root', id: 'analysis.root', integrity: shaA, pinnedVersion: '1.0.0' }],
      snapshots,
    });

    expect(derived.findings).toEqual([]);
    expect(derived.subjects).toEqual([
      subjectLabel('child', '2.0.0', shaB),
      subjectLabel('root', '1.0.0', shaA),
    ]);
  });

  it('kills a same-version transitive integrity swap', () => {
    const packages = parsePnpmPackageIntegrities(`packages:
  root@1.0.0:
    resolution: {integrity: ${shaB}}
`).packages;
    const snapshots = parsePnpmSnapshotDependencies('snapshots:\n  root@1.0.0: {}\n').snapshots;
    const derived = deriveTransitiveSubjects({
      packages,
      roots: [{ dependency: 'root', id: 'analysis.root', integrity: shaA, pinnedVersion: '1.0.0' }],
      snapshots,
    });

    expect(derived.findings.join('\n')).toContain(
      `root@1.0.0 integrity ${shaA} does not match lockfile ${shaB}`,
    );
  });

  it('kills a budget or closure-size increase without a reviewed-raise marker', () => {
    const previous = ratchetManifest({
      analysisClosureSize: 10,
      entryCount: 4,
      totalTcbMaxLines: 100,
    });
    const current = ratchetManifest({
      analysisClosureSize: 11,
      entryCount: 4,
      totalTcbMaxLines: 101,
    });

    expect(
      collectSecurityRatchetFindings({ currentManifest: current, previousManifest: previous }).join(
        '\n',
      ),
    ).toContain(
      'ratchet increase for analysisClosureSize, totalTcbMaxLines requires exactly one appended reviewed-raise marker',
    );
  });

  it('accepts an explicit exact reviewed-raise marker and rejects marker tampering', () => {
    const from = { analysisClosureSize: 10, entryCount: 4, totalTcbMaxLines: 100 };
    const to = { analysisClosureSize: 11, entryCount: 5, totalTcbMaxLines: 105 };
    const marker = {
      from,
      id: 'SEC-REVIEW-1',
      reason: 'One reviewed choke and its dependency were enrolled.',
      review: 'security-review/SEC-REVIEW-1',
      to,
    };
    const previous = ratchetManifest(from);
    const current = ratchetManifest(to, [marker]);

    expect(
      collectSecurityRatchetFindings({ currentManifest: current, previousManifest: previous }),
    ).toEqual([]);
    current.securityRatchet.reviewedRaises[0] = { ...marker, from: { ...from, entryCount: 3 } };
    expect(
      collectSecurityRatchetFindings({ currentManifest: current, previousManifest: previous }).join(
        '\n',
      ),
    ).toContain('reviewed-raise marker from must equal the previous ratchet limits');
  });

  it('kills a marker appended without an actual ratchet increase', () => {
    const limits = { analysisClosureSize: 10, entryCount: 4, totalTcbMaxLines: 100 };
    const previous = ratchetManifest(limits);
    const current = ratchetManifest(limits, [
      { from: limits, id: 'fake', reason: 'fake', review: 'fake', to: limits },
    ]);

    expect(
      collectSecurityRatchetFindings({ currentManifest: current, previousManifest: previous }).join(
        '\n',
      ),
    ).toContain('a reviewed-raise marker may only be appended with an actual ratchet increase');
  });
});

function ratchetManifest(limits, reviewedRaises = []) {
  return {
    securityRatchet: {
      limits,
      reviewedRaises,
      schema: 'kovo.security.tcb-ratchet/v1',
    },
  };
}
