import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  SECURITY_BUILD_CERTIFICATION_SOURCES,
  SECURITY_BUILD_PROOFS,
  extractMetamorphicSeedCodes,
  securityTestBuildGateViolations,
} from './security-test-build-gate.mjs';

describe('security-test-build-gate', () => {
  it('keeps the enrolled fixture-only security corpus tied to real kovo build tests', () => {
    expect(securityTestBuildGateViolations()).toEqual([]);
  });

  it('extracts only object-literal diagnostic seed codes', () => {
    expect(
      extractMetamorphicSeedCodes(`
        const ignored = 'KV999';
        export const seeds = [
          { code: 'KV426', label: 'trusted HTML' },
          { code: "KV330", label: 'direct DB' },
          { other: 'KV414' },
        ];
      `),
    ).toEqual(['KV330', 'KV426']);
  });

  it('fails when a fixture-only security seed has no production build proof', () => {
    withTempRepo((repoRoot) => {
      writeFixtureSource(repoRoot, "export const seeds = [{ code: 'KV426' }];");

      expect(
        securityTestBuildGateViolations({
          certificationSources: SECURITY_BUILD_CERTIFICATION_SOURCES,
          proofs: [],
          repoRoot,
        }),
      ).toContain(
        'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts KV426: security certification has no real kovo build proof',
      );
    });
  });

  it('rejects proof tests that assert the diagnostic from a fixture path only', () => {
    withTempRepo((repoRoot) => {
      writeFixtureSource(repoRoot, "export const seeds = [{ code: 'KV426' }];");
      writeProofFile(
        repoRoot,
        [
          "import { compileComponentModule } from '../packages/compiler/src/index.js';",
          "it('fixture-only trustedHtml proof', () => {",
          "  const result = compileComponentModule({ fileName: 'x.tsx', source: '' });",
          "  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('KV426');",
          '});',
        ].join('\n'),
      );

      expect(
        securityTestBuildGateViolations({
          certificationSources: SECURITY_BUILD_CERTIFICATION_SOURCES,
          proofs: [
            {
              buildInvocation: 'cli-main-build',
              code: 'KV426',
              proofFile: 'packages/cli/src/index.kovo-build.test.ts',
              sourceFile: 'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts',
              testName: 'fixture-only trustedHtml proof',
            },
          ],
          repoRoot,
        }),
      ).toContain(
        'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts KV426 -> packages/cli/src/index.kovo-build.test.ts: proof test does not exercise the declared production build path (cli-main-build)',
      );
    });
  });

  it('rejects skipped proof tests even when they mention a real build path', () => {
    withTempRepo((repoRoot) => {
      writeFixtureSource(repoRoot, "export const seeds = [{ code: 'KV426' }];");
      writeProofFile(
        repoRoot,
        [
          "it.skip('skipped trustedHtml proof', async () => {",
          "  const exitCode = await mainAsync(['build', './app.ts', '--out', './dist']);",
          "  expect(errorOutput).toContain('KV426');",
          '});',
        ].join('\n'),
      );

      expect(
        securityTestBuildGateViolations({
          certificationSources: SECURITY_BUILD_CERTIFICATION_SOURCES,
          proofs: [
            {
              buildInvocation: 'cli-main-build',
              code: 'KV426',
              proofFile: 'packages/cli/src/index.kovo-build.test.ts',
              sourceFile: 'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts',
              testName: 'skipped trustedHtml proof',
            },
          ],
          repoRoot,
        }),
      ).toContain(
        'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts KV426 -> packages/cli/src/index.kovo-build.test.ts: proof test is skipped or todo',
      );
    });
  });

  it('keeps starter buildProductionArtifact tied to kovo build --no-cache', () => {
    withTempRepo((repoRoot) => {
      writeFixtureSource(repoRoot, "export const seeds = [{ code: 'KV435' }];");
      writeStarterProofFile(
        repoRoot,
        [
          "it('starter secret proof', () => {",
          '  buildProductionArtifact(root);',
          "  expect(output).toContain('KV435');",
          '});',
        ].join('\n'),
      );
      writeStarterBuildHelper(repoRoot, 'export function buildProductionArtifact() {}\n');

      expect(
        securityTestBuildGateViolations({
          certificationSources: SECURITY_BUILD_CERTIFICATION_SOURCES,
          proofs: [
            {
              buildInvocation: 'starter-build-production-artifact',
              code: 'KV435',
              proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
              sourceFile: 'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts',
              testName: 'starter secret proof',
            },
          ],
          repoRoot,
        }),
      ).toContain(
        'packages/create-kovo/src/index.build.test-support.ts: starter-build-production-artifact helper is missing required build evidence "execFileSync"',
      );
    });
  });

  it('allows production artifact proofs to require semantic evidence instead of a literal diagnostic code', () => {
    withTempRepo((repoRoot) => {
      writeFixtureSource(repoRoot, "export const seeds = [{ code: 'KV311' }];");
      writeIslandDeriveProofFile(
        repoRoot,
        [
          "it('artifact island derive proof', async () => {",
          '  buildProductionArtifact(root);',
          '  expect(pageErrors).toEqual([]);',
          '  expect(consoleErrors).toEqual([]);',
          '});',
        ].join('\n'),
      );
      writeStarterBuildHelper(repoRoot, validStarterBuildHelperSource());

      expect(
        securityTestBuildGateViolations({
          certificationSources: SECURITY_BUILD_CERTIFICATION_SOURCES,
          proofs: [
            {
              buildInvocation: 'starter-build-production-artifact',
              code: 'KV311',
              proofFile: 'packages/create-kovo/src/index.build.prod-artifact.island-derive.test.ts',
              requiredNeedles: [
                'buildProductionArtifact(root)',
                'expect(pageErrors).toEqual([])',
                'expect(consoleErrors).toEqual([])',
              ],
              sourceFile: 'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts',
              testName: 'artifact island derive proof',
            },
          ],
          repoRoot,
        }),
      ).toEqual([]);
    });
  });

  it('rejects stale manifest rows that no longer match an enrolled source seed', () => {
    withTempRepo((repoRoot) => {
      writeFixtureSource(repoRoot, "export const seeds = [{ code: 'KV426' }];");
      writeProofFile(
        repoRoot,
        [
          "it('build trustedHtml proof', async () => {",
          "  const exitCode = await mainAsync(['build', './app.ts', '--out', './dist']);",
          "  expect(errorOutput).toContain('KV330');",
          '});',
        ].join('\n'),
      );

      expect(
        securityTestBuildGateViolations({
          certificationSources: SECURITY_BUILD_CERTIFICATION_SOURCES,
          proofs: [
            {
              buildInvocation: 'cli-main-build',
              code: 'KV330',
              proofFile: 'packages/cli/src/index.kovo-build.test.ts',
              sourceFile: 'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts',
              testName: 'build trustedHtml proof',
            },
          ],
          repoRoot,
        }),
      ).toEqual(
        expect.arrayContaining([
          'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts KV426: security certification has no real kovo build proof',
          'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts KV330 -> packages/cli/src/index.kovo-build.test.ts: proof is stale; source does not certify KV330',
        ]),
      );
    });
  });

  it('keeps the default proof manifest focused on the default certification source', () => {
    expect(
      SECURITY_BUILD_PROOFS.every((proof) =>
        SECURITY_BUILD_CERTIFICATION_SOURCES.some((source) => source.file === proof.sourceFile),
      ),
    ).toBe(true);
  });
});

function withTempRepo(callback) {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'kovo-security-build-gate-'));
  try {
    callback(repoRoot);
  } finally {
    rmSync(repoRoot, { force: true, recursive: true });
  }
}

function writeFixtureSource(repoRoot, source) {
  writeFile(
    repoRoot,
    'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts',
    source,
  );
}

function writeProofFile(repoRoot, source) {
  writeFile(repoRoot, 'packages/cli/src/index.kovo-build.test.ts', source);
}

function writeStarterProofFile(repoRoot, source) {
  writeFile(
    repoRoot,
    'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    source,
  );
}

function writeIslandDeriveProofFile(repoRoot, source) {
  writeFile(
    repoRoot,
    'packages/create-kovo/src/index.build.prod-artifact.island-derive.test.ts',
    source,
  );
}

function writeStarterBuildHelper(repoRoot, source) {
  writeFile(repoRoot, 'packages/create-kovo/src/index.build.test-support.ts', source);
}

function validStarterBuildHelperSource() {
  return [
    "import { execFileSync } from 'node:child_process';",
    'export function buildProductionArtifact(root) {',
    "  return execFileSync('kovo', ['build', './src/app.tsx', '--no-cache'], { cwd: root });",
    '}',
  ].join('\n');
}

function writeFile(repoRoot, relativePath, source) {
  const fullPath = path.join(repoRoot, relativePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, source, 'utf8');
}
