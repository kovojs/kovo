import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  SECURITY_BUILD_CERTIFICATION_SOURCES,
  SECURITY_BUILD_PROOFS,
  generateParanoidGeneratorAcceptanceCases,
  generateReadSourceFamilyCases,
  generateSecurityWrappingCases,
  generateTrustedOutputSinkPositionCases,
  extractMetamorphicSeedCodes,
  extractSecurityCertificationMarkers,
  paranoidGeneratorAcceptanceProofNeedles,
  readSourceFamilyProofNeedles,
  securityTestBuildGateViolations,
  securityWrappingProofNeedles,
  trustedOutputSinkPositionProofNeedles,
} from './security-test-build-gate.mjs';

const METAMORPHIC_CERTIFICATION_SOURCES = SECURITY_BUILD_CERTIFICATION_SOURCES.filter(
  (source) => source.claimExtractor === 'metamorphic-seed-codes',
);

describe('security-test-build-gate', () => {
  it('keeps the enrolled security proof-scope enrollment corpus tied to real kovo build tests', () => {
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

  it('extracts explicit security proof-scope enrollment markers without treating incidental KV mentions as certification', () => {
    expect(
      extractSecurityCertificationMarkers(`
        expect(output).toContain('KV426');
        // @kovo-security-certifies KV426 trusted-html-barrel
        /* @kovo-security-certifies KV435 secret-wire */
      `),
    ).toEqual([
      { claimId: 'trusted-html-barrel', code: 'KV426' },
      { claimId: 'secret-wire', code: 'KV435' },
    ]);
  });

  it('generates deterministic trusted-output SINK-position proof cases from a seeded grammar', () => {
    const defaultCases = generateTrustedOutputSinkPositionCases();
    const sameSeedCases = generateTrustedOutputSinkPositionCases({
      seed: 'dec-g:kv426:trusted-output:v1',
    });
    const alternateSeedCases = generateTrustedOutputSinkPositionCases({
      seed: 'dec-g:kv426:trusted-output:order-a',
    });

    expect(defaultCases).toEqual(sameSeedCases);
    expect(defaultCases).not.toEqual(alternateSeedCases);
    expect(new Set(defaultCases.map((testCase) => testCase.sink))).toEqual(
      new Set(['trustedHtml', 'trustedUrl']),
    );
    expect(new Set(defaultCases.map((testCase) => testCase.source))).toEqual(
      new Set(['request', 'query']),
    );
    expect(new Set(defaultCases.map((testCase) => testCase.wrapping))).toEqual(
      new Set(['direct-call', 'helper-call', 'component-prop']),
    );
    expect(trustedOutputSinkPositionProofNeedles().sort()).toEqual([
      'trustedHtml() sends request-derived data',
      'trustedUrl() sends query-derived data',
      'trustedUrl() sends query-derived data',
    ]);
  });

  it('generates deterministic read-SOURCE proof cases across request query and DB-read families', () => {
    const defaultCases = generateReadSourceFamilyCases();
    const sameSeedCases = generateReadSourceFamilyCases({ seed: 'dec-g:read-source:v1' });
    const alternateSeedCases = generateReadSourceFamilyCases({ seed: 'b' });

    expect(defaultCases).toEqual(sameSeedCases);
    expect(defaultCases).not.toEqual(alternateSeedCases);
    expect(new Set(defaultCases.map((testCase) => testCase.family))).toEqual(
      new Set(['request', 'query', 'db-read']),
    );
    expect(readSourceFamilyProofNeedles().sort()).toEqual([
      'query="secrets0" path="secrets0\\.accessToken"',
      'trustedHtml() sends request-derived data',
      'trustedUrl() sends query-derived data',
    ]);
  });

  it('generates deterministic wrapping proof cases across security surfaces', () => {
    const defaultCases = generateSecurityWrappingCases();
    const sameSeedCases = generateSecurityWrappingCases({ seed: 'dec-g:wrapping:v1' });
    const alternateSeedCases = generateSecurityWrappingCases({
      seed: 'dec-g:wrapping:order-a',
    });

    expect(defaultCases).toEqual(sameSeedCases);
    expect(defaultCases).not.toEqual(alternateSeedCases);
    expect(new Set(defaultCases.map((testCase) => testCase.form))).toEqual(
      new Set(['alias', 'component-prop', 'direct', 'helper', 'local-wrapper']),
    );
    expect(securityWrappingProofNeedles().sort()).toEqual([
      'query="secrets0" path="secrets0\\.accessToken"',
      'query="secrets1" path="secrets1\\.password"',
      'query="secrets3" path="secrets3\\.accessToken"',
      'trustedHtml() sends request-derived data',
      'trustedHtml() sends request-derived data',
    ]);
  });

  it('generates deterministic paranoid acceptance cases for read and write paths', () => {
    const defaultCases = generateParanoidGeneratorAcceptanceCases();
    const sameSeedCases = generateParanoidGeneratorAcceptanceCases({
      seed: 'dec-h:phase-5-1:paranoid:v1',
    });
    const alternateSeedCases = generateParanoidGeneratorAcceptanceCases({ seed: 'a' });

    expect(defaultCases).toEqual(sameSeedCases);
    expect(defaultCases).not.toEqual(alternateSeedCases);
    expect(new Set(defaultCases.map((testCase) => testCase.expectation))).toEqual(
      new Set(['blocked-read', 'allowed-read', 'allowed-write', 'blocked-write', 'status-clean']),
    );
    expect(
      new Set(
        defaultCases
          .filter((testCase) => typeof testCase.route === 'string')
          .map((testCase) => testCase.route),
      ),
    ).toEqual(
      new Set([
        '/_m/mutations/add-contact',
        '/_m/paranoid-phase5-write-boundary-proof/phase5-boxed-secret-raw-write-proof',
        '/_q/queries/sqlite-secret-alias-query',
        '/_q/queries/sqlite-secret-cte-query',
        '/_q/queries/sqlite-secret-reveal-query',
        '/api/phase5-write-boundary-proof',
      ]),
    );
    expect(defaultCases.filter((testCase) => testCase.expectation === 'blocked-read')).toHaveLength(
      2,
    );
    expect(paranoidGeneratorAcceptanceProofNeedles().sort()).toEqual([
      "KOVO_PARANOID: '1'",
      'addParanoidPhase5WriteBoundaryProof(root)',
      'addSqliteRuntimeSecretProvenanceProof(root)',
      "addStarterMutationDbScopeProof(root, { mode: 'runtime-table-choke' })",
      'buildParanoidProductionArtifact(root)',
      "dialect: 'sqlite'",
      "expect(output()).toContain('KV406')",
      "expect(output()).toContain('KV435')",
      'expectAllowedReadShapes(origin, jar, output)',
      'expectBlockedReadShapes(origin, jar)',
      'expectBlockedWrites(origin, jar, output)',
      'expectStarterInScopeWrite(origin, jar, output)',
      'expectWriteStatus(origin, output)',
      'pruneParanoidPhase5SqliteReadSet(root)',
      'writeKovoProject(root, {',
    ]);
  });

  it('requires real build proof for explicitly enrolled non-metamorphic security proof-scope enrollments', () => {
    withTempRepo((repoRoot) => {
      writeUnitCertificationSource(
        repoRoot,
        [
          "it('unit trustedHtml certification', () => {",
          "  expect(diagnostics).toContain('KV426');",
          '});',
          '// @kovo-security-certifies KV426 trusted-html-unit',
        ].join('\n'),
      );

      expect(
        securityTestBuildGateViolations({
          certificationSources: [
            {
              claimExtractor: 'security-certification-markers',
              description: 'unit security proof-scope enrollment declarations',
              file: 'packages/drizzle/src/unit-security.test.ts',
            },
          ],
          proofs: [],
          repoRoot,
        }),
      ).toContain(
        'packages/drizzle/src/unit-security.test.ts KV426/trusted-html-unit: security proof-scope enrollment has no real kovo build proof',
      );
    });
  });

  it('does not require every unit test that mentions a security code to be a build proof', () => {
    withTempRepo((repoRoot) => {
      writeUnitCertificationSource(
        repoRoot,
        [
          "it('diagnostic formatting stays stable', () => {",
          "  expect(formatDiagnostic('KV426')).toContain('KV426');",
          '});',
        ].join('\n'),
      );

      expect(
        securityTestBuildGateViolations({
          certificationSources: [
            {
              claimExtractor: 'security-certification-markers',
              description: 'unit security proof-scope enrollment declarations',
              file: 'packages/drizzle/src/unit-security.test.ts',
            },
          ],
          proofs: [],
          repoRoot,
        }),
      ).toEqual([]);
    });
  });

  it('rejects stale marker proof rows that cite a security fact no longer certified by the source', () => {
    withTempRepo((repoRoot) => {
      writeUnitCertificationSource(
        repoRoot,
        '// @kovo-security-certifies KV426 trusted-html-current\n',
      );
      writeProofFile(
        repoRoot,
        [
          "it('build trustedHtml proof', async () => {",
          "  const exitCode = await mainAsync(['build', './app.ts', '--out', './dist']);",
          "  expect(errorOutput).toContain('KV426');",
          '});',
        ].join('\n'),
      );

      expect(
        securityTestBuildGateViolations({
          certificationSources: [
            {
              claimExtractor: 'security-certification-markers',
              description: 'unit security proof-scope enrollment declarations',
              file: 'packages/drizzle/src/unit-security.test.ts',
            },
          ],
          proofs: [
            {
              buildInvocation: 'cli-main-build',
              claimId: 'trusted-html-old',
              code: 'KV426',
              proofFile: 'packages/cli/src/index.kovo-build.test.ts',
              sourceFile: 'packages/drizzle/src/unit-security.test.ts',
              testName: 'build trustedHtml proof',
            },
          ],
          repoRoot,
        }),
      ).toEqual(
        expect.arrayContaining([
          'packages/drizzle/src/unit-security.test.ts KV426/trusted-html-current: security proof-scope enrollment has no real kovo build proof',
          'packages/drizzle/src/unit-security.test.ts KV426/trusted-html-old -> packages/cli/src/index.kovo-build.test.ts: proof is stale; source does not enroll KV426/trusted-html-old',
        ]),
      );
    });
  });

  it('fails when a fixture-only security seed has no production build proof', () => {
    withTempRepo((repoRoot) => {
      writeFixtureSource(repoRoot, "export const seeds = [{ code: 'KV426' }];");

      expect(
        securityTestBuildGateViolations({
          certificationSources: METAMORPHIC_CERTIFICATION_SOURCES,
          proofs: [],
          repoRoot,
        }),
      ).toContain(
        'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts KV426: security proof-scope enrollment has no real kovo build proof',
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
          certificationSources: METAMORPHIC_CERTIFICATION_SOURCES,
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
          certificationSources: METAMORPHIC_CERTIFICATION_SOURCES,
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

  it('keeps starter production build helpers tied to kovo build invocations', () => {
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
          certificationSources: METAMORPHIC_CERTIFICATION_SOURCES,
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
          certificationSources: METAMORPHIC_CERTIFICATION_SOURCES,
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

  it('consumes generated trusted-output SINK-position evidence in the proof gate', () => {
    withTempRepo((repoRoot) => {
      writeStarterProofFile(
        repoRoot,
        [
          '// @kovo-security-certifies KV426 trusted-output-prod-artifact',
          "it('trusted output proof', () => {",
          '  addTrustedOutputProvenanceBuildProof(unsafeRoot);',
          '  buildProductionArtifact(unsafeRoot);',
          '  addTrustedOutputProvenanceBuildProof(safeRoot, { unsafe: false });',
          '  buildReusableProductionArtifact(safeRoot);',
          "  expect(output).toContain('KV426');",
          "  expect(output).toContain('trustedUrl() sends query-derived data');",
          '});',
        ].join('\n'),
      );
      writeStarterBuildHelper(repoRoot, validStarterBuildHelperSource());

      expect(
        securityTestBuildGateViolations({
          certificationSources: [
            {
              claimExtractor: 'security-certification-markers',
              description: 'starter security proof-scope enrollment declarations',
              file: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
            },
          ],
          proofs: [
            {
              buildInvocation: 'starter-build-production-artifact',
              claimId: 'trusted-output-prod-artifact',
              code: 'KV426',
              proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
              requiredNeedles: [
                'addTrustedOutputProvenanceBuildProof(unsafeRoot)',
                'buildProductionArtifact(unsafeRoot)',
                'addTrustedOutputProvenanceBuildProof(safeRoot, { unsafe: false })',
                'buildReusableProductionArtifact(safeRoot)',
                'KV426',
                ...trustedOutputSinkPositionProofNeedles(),
              ],
              sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
              testName: 'trusted output proof',
            },
          ],
          repoRoot,
        }),
      ).toContain(
        'packages/create-kovo/src/index.build.prod-artifact.security.test.ts KV426/trusted-output-prod-artifact -> packages/create-kovo/src/index.build.prod-artifact.security.test.ts: proof test is missing required evidence "trustedHtml() sends request-derived data"',
      );
    });
  });

  it('recognizes paranoid starter production builds as real build proofs', () => {
    withTempRepo((repoRoot) => {
      writeStarterProofFile(
        repoRoot,
        [
          '// @kovo-security-certifies KV435 runtime-secret-view-egress',
          "it('paranoid secret view proof', () => {",
          '  addSecretViewEgressProof(root);',
          '  buildParanoidProductionArtifact(root);',
          "  expect(output).toContain('KV435');",
          "  expect(output).toContain('Secret runtime value cannot cross');",
          '  await fetch(`${origin}/_q/secret-view-egress`);',
          '});',
        ].join('\n'),
      );
      writeStarterBuildHelper(repoRoot, validStarterBuildHelperSource());

      expect(
        securityTestBuildGateViolations({
          certificationSources: [
            {
              claimExtractor: 'security-certification-markers',
              description: 'starter security proof-scope enrollment declarations',
              file: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
            },
          ],
          proofs: [
            {
              buildInvocation: 'starter-build-production-artifact',
              claimId: 'runtime-secret-view-egress',
              code: 'KV435',
              proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
              requiredNeedles: [
                'addSecretViewEgressProof(root)',
                'buildParanoidProductionArtifact(root)',
                'KV435',
                'Secret runtime value cannot cross',
                '/_q/secret-view-egress',
              ],
              sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
              testName: 'paranoid secret view proof',
            },
          ],
          repoRoot,
        }),
      ).toEqual([]);
    });
  });

  it('allows proof manifests to require evidence from helper sources outside the test block', () => {
    withTempRepo((repoRoot) => {
      writeFixtureSource(repoRoot, "export const seeds = [{ code: 'KV426' }];");
      writeProofFile(
        repoRoot,
        [
          "it('build trustedHtml sibling proof', async () => {",
          "  const exitCode = await mainAsync(['build', './app.ts', '--out', './dist']);",
          "  expect(errorOutput).toContain('KV426');",
          '});',
          "it('unrelated proof', () => {});",
          '',
          'function trustedHtmlSiblingSource() {',
          '  return "import * as safeHtml from \'./safe-html.js\';";',
          '}',
        ].join('\n'),
      );

      expect(
        securityTestBuildGateViolations({
          certificationSources: METAMORPHIC_CERTIFICATION_SOURCES,
          proofs: [
            {
              buildInvocation: 'cli-main-build',
              code: 'KV426',
              proofFile: 'packages/cli/src/index.kovo-build.test.ts',
              requiredProofFileNeedles: ["import * as safeHtml from './safe-html.js';"],
              sourceFile: 'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts',
              testName: 'build trustedHtml sibling proof',
            },
          ],
          repoRoot,
        }),
      ).toEqual([]);
    });
  });

  it('rejects proof files missing proof-file-wide required evidence', () => {
    withTempRepo((repoRoot) => {
      writeFixtureSource(repoRoot, "export const seeds = [{ code: 'KV426' }];");
      writeProofFile(
        repoRoot,
        [
          "it('build trustedHtml sibling proof', async () => {",
          "  const exitCode = await mainAsync(['build', './app.ts', '--out', './dist']);",
          "  expect(errorOutput).toContain('KV426');",
          '});',
        ].join('\n'),
      );

      expect(
        securityTestBuildGateViolations({
          certificationSources: METAMORPHIC_CERTIFICATION_SOURCES,
          proofs: [
            {
              buildInvocation: 'cli-main-build',
              code: 'KV426',
              proofFile: 'packages/cli/src/index.kovo-build.test.ts',
              requiredProofFileNeedles: ["import * as safeHtml from './safe-html.js';"],
              sourceFile: 'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts',
              testName: 'build trustedHtml sibling proof',
            },
          ],
          repoRoot,
        }),
      ).toContain(
        'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts KV426 -> packages/cli/src/index.kovo-build.test.ts: proof file is missing required evidence "import * as safeHtml from \'./safe-html.js\';"',
      );
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
          certificationSources: METAMORPHIC_CERTIFICATION_SOURCES,
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
          'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts KV426: security proof-scope enrollment has no real kovo build proof',
          'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts KV330 -> packages/cli/src/index.kovo-build.test.ts: proof is stale; source does not enroll KV330',
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

  it('keeps the KV426 export-star resolver proof enrolled in the real build gate', () => {
    expect(
      SECURITY_BUILD_PROOFS.find(
        (proof) =>
          proof.code === 'KV426' &&
          proof.testName ===
            'resolves star trustedHtml/trustedUrl barrels and literal element access during production build preflight',
      ),
    ).toMatchObject({
      buildInvocation: 'cli-main-build',
      requiredProofFileNeedles: expect.arrayContaining([
        "import * as safeHtml from './safe-html.js';",
      ]),
      requiredNeedles: expect.arrayContaining([
        'KV426',
        "export * from './safe-html-root'",
        'trustedHtmlStarBarrelElementAccessPreflightComponentSource()',
      ]),
    });
  });

  it('keeps the KV311 island-derive proof enrolled in the production artifact gate', () => {
    expect(
      SECURITY_BUILD_PROOFS.find(
        (proof) => proof.code === 'KV311' && proof.claimId === 'island-derive-prod-artifact',
      ),
    ).toMatchObject({
      buildInvocation: 'starter-build-production-artifact',
      proofFile: 'packages/create-kovo/src/index.build.prod-artifact.island-derive.test.ts',
      requiredNeedles: expect.arrayContaining([
        'buildReusableProductionArtifact(root)',
        'assertProdArtifactSinkCensus(root',
        'expect(pageErrors).toEqual([])',
        'expect(consoleErrors).toEqual([])',
      ]),
    });
  });

  it('keeps the KV426 trusted-output safe sibling enrolled in the production artifact gate', () => {
    expect(
      SECURITY_BUILD_PROOFS.find(
        (proof) => proof.code === 'KV426' && proof.claimId === 'trusted-output-prod-artifact',
      ),
    ).toMatchObject({
      buildInvocation: 'starter-build-production-artifact',
      proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
      requiredNeedles: expect.arrayContaining([
        'addTrustedOutputProvenanceBuildProof(unsafeRoot)',
        'buildProductionArtifact(unsafeRoot)',
        'addTrustedOutputProvenanceBuildProof(safeRoot, { unsafe: false })',
        'buildReusableProductionArtifact(safeRoot)',
      ]),
    });
  });

  it('keeps the KV426 TrustedUrl attribute type gate enrolled in the production artifact gate', () => {
    expect(
      SECURITY_BUILD_PROOFS.find(
        (proof) => proof.code === 'KV426' && proof.claimId === 'trusted-url-attribute-type-gate',
      ),
    ).toMatchObject({
      buildInvocation: 'starter-build-production-artifact',
      proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
      requiredNeedles: expect.arrayContaining([
        'addTrustedUrlAttributeTypeGateProof(root)',
        'buildProductionArtifact(root)',
        'TrustedUrl',
        'AttributeValue',
      ]),
    });
  });

  it('keeps the KV433 storage query write proof enrolled for every storage write verb', () => {
    expect(
      SECURITY_BUILD_PROOFS.find(
        (proof) => proof.code === 'KV433' && proof.claimId === 'storage-query-write-prod-artifact',
      ),
    ).toMatchObject({
      buildInvocation: 'starter-build-production-artifact',
      proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
      requiredNeedles: expect.arrayContaining([
        'addStorageQueryWriteProof(root)',
        'buildProductionArtifact(root)',
        'operation=put',
        'operation=delete',
        'operation=store',
        'operation=upload',
      ]),
    });
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

function writeUnitCertificationSource(repoRoot, source) {
  writeFile(repoRoot, 'packages/drizzle/src/unit-security.test.ts', source);
}

function validStarterBuildHelperSource() {
  return [
    "import { execFileSync } from 'node:child_process';",
    'export function buildProductionArtifact(root) {',
    "  return execFileSync('kovo', ['build', './src/app.tsx', '--no-cache'], { cwd: root });",
    '}',
    'export function buildReusableProductionArtifact(root) {',
    "  return execFileSync('kovo', ['build', './src/app.tsx'], { cwd: root });",
    '}',
    'export function buildParanoidProductionArtifact(root) {',
    "  return execFileSync('kovo', ['build', './src/app.tsx', '--no-cache'], {",
    '    cwd: root,',
    "    env: { KOVO_PARANOID: '1' },",
    '  });',
    '}',
  ].join('\n');
}

function writeFile(repoRoot, relativePath, source) {
  const fullPath = path.join(repoRoot, relativePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, source, 'utf8');
}
