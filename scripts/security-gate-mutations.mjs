#!/usr/bin/env node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as sinkPolicyGate from './check-sink-policy-gate.mjs';
import * as securityTestBuildGate from './security-test-build-gate.mjs';

const thisFile = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(thisFile);
const sinkPolicyGatePath = path.join(scriptsDir, 'check-sink-policy-gate.mjs');
const securityTestBuildGatePath = path.join(scriptsDir, 'security-test-build-gate.mjs');

const missingRealBuildProofBranch = [
  '      if (!proofs.some((proof) => proof.sourceFile === source.file && proof.code === code)) {',
  '        violations.push(',
  '          `${source.file} ${code}: security certification has no real kovo build proof`,',
  '        );',
  '      }',
].join('\n');

const removedMissingRealBuildProofBranch = [
  '      if (false && !proofs.some((proof) => proof.sourceFile === source.file && proof.code === code)) {',
  '        violations.push(',
  '          `${source.file} ${code}: security certification has no real kovo build proof`,',
  '        );',
  '      }',
].join('\n');

const skippedProofBranch = [
  '  if (proofTestIsSkippedOrTodo(testBlock)) {',
  '    violations.push(`${label}: proof test is skipped or todo`);',
  '  }',
].join('\n');

const removedSkippedProofBranch = [
  '  if (false && proofTestIsSkippedOrTodo(testBlock)) {',
  '    violations.push(`${label}: proof test is skipped or todo`);',
  '  }',
].join('\n');

const requiredProofEvidenceBranch = [
  '    if (!testBlock.includes(needle)) {',
  '      violations.push(',
  '        `${label}: proof test is missing required evidence ${JSON.stringify(needle)}`,',
  '      );',
  '    }',
].join('\n');

const removedRequiredProofEvidenceBranch = [
  '    if (false && !testBlock.includes(needle)) {',
  '      violations.push(',
  '        `${label}: proof test is missing required evidence ${JSON.stringify(needle)}`,',
  '      );',
  '    }',
].join('\n');

const productionBuildInvocationBranch = [
  '  if (!testBlockHasBuildInvocation(testBlock, proof.buildInvocation)) {',
  '    violations.push(',
  '      `${label}: proof test does not exercise the declared production build path (${proof.buildInvocation})`,',
  '    );',
  '  }',
].join('\n');

const removedProductionBuildInvocationBranch = [
  '  if (false && !testBlockHasBuildInvocation(testBlock, proof.buildInvocation)) {',
  '    violations.push(',
  '      `${label}: proof test does not exercise the declared production build path (${proof.buildInvocation})`,',
  '    );',
  '  }',
].join('\n');

const buildHelperEvidenceBranch = [
  '    if (!helperText.includes(needle)) {',
  '      violations.push(',
  '        `${helper.file}: ${buildInvocation} helper is missing required build evidence ${JSON.stringify(',
  '          needle,',
  '        )}`,',
  '      );',
  '    }',
].join('\n');

const removedBuildHelperEvidenceBranch = [
  '    if (false && !helperText.includes(needle)) {',
  '      violations.push(',
  '        `${helper.file}: ${buildInvocation} helper is missing required build evidence ${JSON.stringify(',
  '          needle,',
  '        )}`,',
  '      );',
  '    }',
].join('\n');

const sqlGuardEnvBranch = [
  '  if (/\\bKOVO_SQL_GUARD\\b/.test(source)) {',
  "    addFinding('KOVO_SQL_GUARD env knob');",
  '  }',
].join('\n');

const removedSqlGuardEnvBranch = [
  '  if (false && /\\bKOVO_SQL_GUARD\\b/.test(source)) {',
  "    addFinding('KOVO_SQL_GUARD env knob');",
  '  }',
].join('\n');

const managedDbThrowBranch = [
  '    if (!returnsOnValidThenThrows) {',
  '      findings.push(`${filePath}: managed DB handle must throw on failed SQL validation`);',
  '    }',
].join('\n');

const removedManagedDbThrowBranch = [
  '    if (false && !returnsOnValidThenThrows) {',
  '      findings.push(`${filePath}: managed DB handle must throw on failed SQL validation`);',
  '    }',
].join('\n');

const responseFragmentTrustedHtmlRouteBranch = [
  '  if (trustedHtmlSinkRoutes.length !== 2) {',
  '    findings.push(',
  '      `${filePath}: response-fragment HTML sink must route exactly two template.innerHTML writes through trustedHtml(); found ${trustedHtmlSinkRoutes.length}`,',
  '    );',
  '  }',
].join('\n');

const removedResponseFragmentTrustedHtmlRouteBranch = [
  '  if (false && trustedHtmlSinkRoutes.length !== 2) {',
  '    findings.push(',
  '      `${filePath}: response-fragment HTML sink must route exactly two template.innerHTML writes through trustedHtml(); found ${trustedHtmlSinkRoutes.length}`,',
  '    );',
  '  }',
].join('\n');

export const SECURITY_GATE_MUTANTS = [
  {
    baseModule: securityTestBuildGate,
    description:
      'Deletes the branch that turns an enrolled fixture-only security seed without a real build proof into a violation.',
    expectedKiller:
      'fixture-only security seed without production build proof must report the missing proof',
    name: 'security-test-build-gate/drop-missing-real-build-proof',
    replacement: removedMissingRealBuildProofBranch,
    search: missingRealBuildProofBranch,
    sourceFile: securityTestBuildGatePath,
    test: assertMissingRealBuildProofIsCaught,
  },
  {
    baseModule: securityTestBuildGate,
    description: 'Deletes the branch that rejects skipped or todo real-build proof tests.',
    expectedKiller: 'skipped security proof tests must not certify M2 build fidelity',
    name: 'security-test-build-gate/drop-skipped-proof-rejection',
    replacement: removedSkippedProofBranch,
    search: skippedProofBranch,
    sourceFile: securityTestBuildGatePath,
    test: assertSkippedProofIsCaught,
  },
  {
    baseModule: securityTestBuildGate,
    description: 'Deletes the branch that requires proof-specific diagnostic or artifact evidence.',
    expectedKiller: 'KV435 and KV311 proof rows must assert their enrolled evidence',
    name: 'security-test-build-gate/drop-required-proof-evidence',
    replacement: removedRequiredProofEvidenceBranch,
    search: requiredProofEvidenceBranch,
    sourceFile: securityTestBuildGatePath,
    test: assertRequiredProofEvidenceIsCaught,
  },
  {
    baseModule: securityTestBuildGate,
    description:
      'Deletes the branch that rejects fixture-only proof tests without the declared production build invocation.',
    expectedKiller: 'B3 resolver proofs must call the real kovo build path',
    name: 'security-test-build-gate/drop-production-build-invocation-check',
    replacement: removedProductionBuildInvocationBranch,
    search: productionBuildInvocationBranch,
    sourceFile: securityTestBuildGatePath,
    test: assertFixtureOnlyProofIsCaught,
  },
  {
    baseModule: securityTestBuildGate,
    description: 'Deletes the branch that pins starter artifact helpers to kovo build --no-cache.',
    expectedKiller: 'starter production artifact proofs must route through kovo build --no-cache',
    name: 'security-test-build-gate/drop-starter-helper-evidence',
    replacement: removedBuildHelperEvidenceBranch,
    search: buildHelperEvidenceBranch,
    sourceFile: securityTestBuildGatePath,
    test: assertStarterHelperEvidenceIsCaught,
  },
  {
    baseModule: sinkPolicyGate,
    description: 'Deletes the SQL guard environment downgrade detector.',
    expectedKiller: 'H/I SQL guard downgrade env knobs must stay forbidden',
    name: 'check-sink-policy-gate/drop-sql-guard-env-detector',
    replacement: removedSqlGuardEnvBranch,
    search: sqlGuardEnvBranch,
    sourceFile: sinkPolicyGatePath,
    test: assertSqlGuardEnvDowngradeIsCaught,
  },
  {
    baseModule: sinkPolicyGate,
    description: 'Deletes the managed-DB failed-validation throw invariant.',
    expectedKiller: 'H/I managed DB handles must throw instead of warning on failed SQL validation',
    name: 'check-sink-policy-gate/drop-managed-db-throw-invariant',
    replacement: removedManagedDbThrowBranch,
    search: managedDbThrowBranch,
    sourceFile: sinkPolicyGatePath,
    test: assertManagedDbThrowInvariantIsCaught,
  },
  {
    baseModule: sinkPolicyGate,
    description: 'Deletes the response-fragment trustedHtml routing count invariant.',
    expectedKiller:
      'C2 trusted fragment sinks must route every innerHTML write through trustedHtml',
    name: 'check-sink-policy-gate/drop-response-fragment-trustedhtml-route-count',
    replacement: removedResponseFragmentTrustedHtmlRouteBranch,
    search: responseFragmentTrustedHtmlRouteBranch,
    sourceFile: sinkPolicyGatePath,
    test: assertResponseFragmentTrustedHtmlRouteCountIsCaught,
  },
];

export async function runSecurityGateMutationHarness({ mutants = SECURITY_GATE_MUTANTS } = {}) {
  const results = [];

  for (const mutant of mutants) {
    const result = {
      description: mutant.description,
      expectedKiller: mutant.expectedKiller,
      name: mutant.name,
      status: 'unknown',
    };

    try {
      await mutant.test(mutant.baseModule);
    } catch (error) {
      results.push({
        ...result,
        error: `baseline gate did not satisfy killer assertion: ${formatError(error)}`,
        status: 'baseline-failed',
      });
      continue;
    }

    const tempRoot = mkdtempSync(path.join(tmpdir(), 'kovo-security-gate-mutant-'));
    try {
      const mutantPath = path.join(tempRoot, path.basename(mutant.sourceFile));
      const sourceText = readFileSync(mutant.sourceFile, 'utf8');
      writeFileSync(mutantPath, applyExactMutation(sourceText, mutant), 'utf8');
      const mutantModule = await import(`${pathToFileURL(mutantPath).href}?mutant=${Date.now()}`);

      try {
        await mutant.test(mutantModule);
        results.push({
          ...result,
          error: 'mutated gate still satisfied the killer assertion',
          status: 'survived',
        });
      } catch (error) {
        results.push({
          ...result,
          killerFailure: formatError(error),
          status: 'killed',
        });
      }
    } catch (error) {
      results.push({
        ...result,
        error: `mutation harness failed before executing the killer assertion: ${formatError(error)}`,
        status: 'harness-failed',
      });
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  }

  return results;
}

export function applyExactMutation(sourceText, mutant) {
  const firstIndex = sourceText.indexOf(mutant.search);
  if (firstIndex === -1) {
    throw new Error(`${mutant.name}: mutation target was not found`);
  }
  const secondIndex = sourceText.indexOf(mutant.search, firstIndex + mutant.search.length);
  if (secondIndex !== -1) {
    throw new Error(`${mutant.name}: mutation target is not unique`);
  }
  return (
    sourceText.slice(0, firstIndex) +
    mutant.replacement +
    sourceText.slice(firstIndex + mutant.search.length)
  );
}

async function assertMissingRealBuildProofIsCaught(moduleUnderTest) {
  withTempRepo((repoRoot) => {
    writeFixtureSource(repoRoot, "export const seeds = [{ code: 'KV426' }];");
    const violations = moduleUnderTest.securityTestBuildGateViolations({
      certificationSources: moduleUnderTest.SECURITY_BUILD_CERTIFICATION_SOURCES,
      proofs: [],
      repoRoot,
    });
    assertIncludes(
      violations,
      'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts KV426: security certification has no real kovo build proof',
    );
  });
}

async function assertSkippedProofIsCaught(moduleUnderTest) {
  withTempRepo((repoRoot) => {
    writeFixtureSource(repoRoot, "export const seeds = [{ code: 'KV426' }];");
    writeCliBuildProofFile(
      repoRoot,
      [
        "it.skip('skipped trustedHtml proof', async () => {",
        "  const exitCode = await mainAsync(['build', './app.ts', '--out', './dist']);",
        "  expect(errorOutput).toContain('KV426');",
        '});',
      ].join('\n'),
    );

    const violations = moduleUnderTest.securityTestBuildGateViolations({
      certificationSources: moduleUnderTest.SECURITY_BUILD_CERTIFICATION_SOURCES,
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
    });
    assertIncludes(
      violations,
      'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts KV426 -> packages/cli/src/index.kovo-build.test.ts: proof test is skipped or todo',
    );
  });
}

async function assertRequiredProofEvidenceIsCaught(moduleUnderTest) {
  withTempRepo((repoRoot) => {
    writeFixtureSource(repoRoot, "export const seeds = [{ code: 'KV435' }];");
    writeStarterSecurityProofFile(
      repoRoot,
      ["it('starter secret proof', () => {", '  buildProductionArtifact(root);', '});'].join('\n'),
    );
    writeStarterBuildHelper(repoRoot, validStarterBuildHelperSource());

    const violations = moduleUnderTest.securityTestBuildGateViolations({
      certificationSources: moduleUnderTest.SECURITY_BUILD_CERTIFICATION_SOURCES,
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
    });
    assertIncludes(
      violations,
      'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts KV435 -> packages/create-kovo/src/index.build.prod-artifact.security.test.ts: proof test is missing required evidence "KV435"',
    );
  });
}

async function assertFixtureOnlyProofIsCaught(moduleUnderTest) {
  withTempRepo((repoRoot) => {
    writeFixtureSource(repoRoot, "export const seeds = [{ code: 'KV426' }];");
    writeCliBuildProofFile(
      repoRoot,
      [
        "import { compileComponentModule } from '../packages/compiler/src/index.js';",
        "it('fixture-only trustedHtml proof', () => {",
        "  const result = compileComponentModule({ fileName: 'x.tsx', source: '' });",
        "  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('KV426');",
        '});',
      ].join('\n'),
    );

    const violations = moduleUnderTest.securityTestBuildGateViolations({
      certificationSources: moduleUnderTest.SECURITY_BUILD_CERTIFICATION_SOURCES,
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
    });
    assertIncludes(
      violations,
      'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts KV426 -> packages/cli/src/index.kovo-build.test.ts: proof test does not exercise the declared production build path (cli-main-build)',
    );
  });
}

async function assertStarterHelperEvidenceIsCaught(moduleUnderTest) {
  withTempRepo((repoRoot) => {
    writeFixtureSource(repoRoot, "export const seeds = [{ code: 'KV435' }];");
    writeStarterSecurityProofFile(
      repoRoot,
      [
        "it('starter secret proof', () => {",
        '  buildProductionArtifact(root);',
        "  expect(output).toContain('KV435');",
        '});',
      ].join('\n'),
    );
    writeStarterBuildHelper(repoRoot, 'export function buildProductionArtifact() {}\n');

    const violations = moduleUnderTest.securityTestBuildGateViolations({
      certificationSources: moduleUnderTest.SECURITY_BUILD_CERTIFICATION_SOURCES,
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
    });
    assertIncludes(
      violations,
      'packages/create-kovo/src/index.build.test-support.ts: starter-build-production-artifact helper is missing required build evidence "execFileSync"',
    );
  });
}

async function assertSqlGuardEnvDowngradeIsCaught(moduleUnderTest) {
  const findings = moduleUnderTest.sqlGuardDowngradeFindings(
    'packages/server/src/sql-safe-handle.ts',
    'export const mode = process.env.KOVO_SQL_GUARD;',
  );
  assertIncludes(
    findings,
    'packages/server/src/sql-safe-handle.ts: SQL safety must remain default-deny; remove SQL guard downgrade path (KOVO_SQL_GUARD env knob)',
  );
}

async function assertManagedDbThrowInvariantIsCaught(moduleUnderTest) {
  const findings = moduleUnderTest.sqlSafetyInvariantFindings(
    'packages/server/src/sql-safe-handle.ts',
    `
      function assertManagedSqlStatement(statement: unknown): void {
        const validation = validateManagedSqlStatement(statement);
        if (validation.ok) return;
        console.warn(validation.message);
      }
    `,
  );
  assertIncludes(
    findings,
    'packages/server/src/sql-safe-handle.ts: managed DB handle must throw on failed SQL validation',
  );
}

async function assertResponseFragmentTrustedHtmlRouteCountIsCaught(moduleUnderTest) {
  const findings = moduleUnderTest.responseFragmentApplyInvariantFindings(
    'response-fragment-apply.ts',
    `
      function trustedHtml(h: string): string {
        const t = (globalThis as any).trustedTypes;
        return t ? t.createPolicy('kovo', { createHTML: (s: string) => s }).createHTML(h) : h;
      }
      export function p(fs, f) {
        for (const x of fs) {
          const e = f(x.target);
          const t = document.createElement('template');
          t.innerHTML = trustedHtml(x.html);
          for (const n of t.content.children) g(n);
          e.append(...t.content.childNodes);
        }
      }
      function d(e, h) {
        const t = document.createElement('template');
        t.innerHTML = h;
        const n = firstMorphElement(t.content);
        if (n) m(e, g(n));
      }
      function r(n: string): boolean {
        return /^on[^:]|^(srcdoc|dangerouslysetinnerhtml|innerhtml|outerhtml|inserthtml|insertadjacenthtml)$/.test(n);
      }
    `,
  );
  assertIncludes(
    findings,
    'response-fragment-apply.ts: response-fragment HTML sink must route exactly two template.innerHTML writes through trustedHtml(); found 1',
  );
}

function assertIncludes(values, expected) {
  if (values.includes(expected)) return;
  throw new Error(`expected ${JSON.stringify(values)} to include ${JSON.stringify(expected)}`);
}

function withTempRepo(callback) {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'kovo-security-gate-mutation-repo-'));
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

function writeCliBuildProofFile(repoRoot, source) {
  writeFile(repoRoot, 'packages/cli/src/index.kovo-build.test.ts', source);
}

function writeStarterSecurityProofFile(repoRoot, source) {
  writeFile(
    repoRoot,
    'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
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

function formatError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function main() {
  const results = await runSecurityGateMutationHarness();
  const failed = results.filter((result) => result.status !== 'killed');

  if (failed.length > 0) {
    process.stderr.write('Security gate mutation harness failed:\n');
    for (const result of failed) {
      process.stderr.write(`  - ${result.name}: ${result.status}; ${result.error}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `Security gate mutation harness passed (${results.length} mutants killed).\n`,
  );
  for (const result of results) {
    process.stdout.write(`  - ${result.name}: killed ${result.expectedKiller}\n`);
  }
}

if (process.argv[1] === thisFile) {
  await main();
}
