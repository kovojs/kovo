#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { SECURITY_GATE_MUTANTS } from './security-gate-mutations.mjs';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot } from './lib/repo-root.mjs';

export const securityFuzzCampaignSchema = 'kovo.security-fuzz-campaign/v1';
export const securityFuzzCounterexampleSchema = 'kovo.security-fuzz-counterexample/v1';
export const defaultSecurityFuzzCampaignPath = 'security/security-fuzz-campaign.json';
export const defaultSecurityFuzzWorkflowPath = '.github/workflows/security-nightly.yml';
export const defaultSecurityFuzzReleaseWorkflowPath = '.github/workflows/release.yml';
export const securityFuzzReleaseCommand = 'pnpm run test:security-fuzz-release';

const expectedFamilyOrder = Object.freeze([
  'egress',
  'authority',
  'csrf',
  'redos',
  'headers',
  'mutations',
]);

const expectedSeeds = Object.freeze({
  egress: Object.freeze({ algorithm: 'lcg32', value: '0x6b6f766f', version: 1 }),
  authority: Object.freeze({
    algorithm: 'closed-grammar-corpus',
    value: 'request-authority-grammar/v1',
    version: 1,
  }),
  csrf: Object.freeze({ algorithm: 'state-model', value: 'csrf-lifecycle/v1', version: 1 }),
  redos: Object.freeze({ algorithm: 'mulberry32', value: '0x00000434', version: 1 }),
  headers: Object.freeze({
    algorithm: 'closed-hostile-wire-corpus',
    value: 'real-http-header-roundtrip/v1',
    version: 1,
  }),
  mutations: Object.freeze({
    algorithm: 'enrolled-branch-deletion',
    value: 'security-gate-mutants/v1',
    version: 1,
  }),
});

const expectedCoverage = Object.freeze({
  egress: Object.freeze(['undeclared-before-dns', 'framework-dispatcher-seal']),
  authority: Object.freeze([
    'single-valid-authority',
    'trusted-proxy-scheme-precedence',
    'duplicate-forwarded-scheme-precedence',
    'malformed-or-duplicate-host-wire-rejection',
    'http2-authority-host-exclusivity',
  ]),
  csrf: Object.freeze([
    'anonymous-mint-deliver-rotate-replay',
    'session-rotation-before-replay',
    'origin-before-replay',
  ]),
  redos: Object.freeze([
    'minimized-catastrophic-cases',
    'full-ceiling-hostile-corpus',
    'bounded-work-slope',
    'real-schema-ceiling',
    'supported-grammar-differential',
  ]),
  headers: Object.freeze([
    'duplicate-request-fields',
    'multi-set-cookie',
    'private-cache-floor',
    'vary-cookie-merge',
    'transport-ambiguity-rejection',
    'control-output-rejection',
    'malformed-input-rejection',
  ]),
});

const expectedCaseSeeds = Object.freeze({
  'redos/full-ceiling-hostile-corpus': Object.freeze({
    algorithm: 'xorshift32',
    value: '0x4b563433',
    version: 1,
  }),
});

const expectedSourceSeedAnchors = Object.freeze({
  'egress/undeclared-before-dns': "?? '0x6b6f766f'",
  'redos/full-ceiling-hostile-corpus': 'seed: 0x4b56_3433',
  'redos/supported-grammar-differential': "?? '0x00000434'",
});

const expectedDifferentialMarkers = Object.freeze({
  'redos/supported-grammar-differential': 'KOVO_CROSS_IMPLEMENTATION_DISAGREEMENT',
  'headers/real-http-header-roundtrip': 'KOVO_CROSS_IMPLEMENTATION_DISAGREEMENT',
});

const expectedProfiles = Object.freeze({
  nightly: Object.freeze({
    maxWallMs: 1_800_000,
    replayTimeoutMs: 300_000,
    families: Object.freeze({
      egress: Object.freeze({
        maxWallMs: 90_000,
        caseExecutionBudget: 2,
        generatedInputBudget: 256,
      }),
      authority: Object.freeze({ maxWallMs: 180_000, caseExecutionBudget: 5 }),
      csrf: Object.freeze({ maxWallMs: 120_000, caseExecutionBudget: 3 }),
      redos: Object.freeze({
        maxWallMs: 420_000,
        caseExecutionBudget: 5,
        generatedInputBudget: 5_000,
      }),
      headers: Object.freeze({ maxWallMs: 180_000, caseExecutionBudget: 1 }),
      mutations: Object.freeze({ maxWallMs: 720_000, caseExecutionBudget: 1 }),
    }),
  }),
  release: Object.freeze({
    maxWallMs: 7_200_000,
    replayTimeoutMs: 600_000,
    families: Object.freeze({
      egress: Object.freeze({
        maxWallMs: 180_000,
        caseExecutionBudget: 2,
        generatedInputBudget: 256,
      }),
      authority: Object.freeze({ maxWallMs: 360_000, caseExecutionBudget: 5 }),
      csrf: Object.freeze({ maxWallMs: 240_000, caseExecutionBudget: 3 }),
      redos: Object.freeze({
        maxWallMs: 1_800_000,
        caseExecutionBudget: 5,
        generatedInputBudget: 100_000,
      }),
      headers: Object.freeze({ maxWallMs: 360_000, caseExecutionBudget: 1 }),
      mutations: Object.freeze({ maxWallMs: 1_800_000, caseExecutionBudget: 1 }),
    }),
  }),
});

const expectedPackageScripts = Object.freeze({
  'check:security-fuzz-campaign': 'node scripts/security-fuzz-campaign.mjs --check',
  'test:security-fuzz-nightly': 'node scripts/security-fuzz-campaign.mjs --profile nightly',
  'test:security-fuzz-release': 'node scripts/security-fuzz-campaign.mjs --profile release',
});

const allowedDecisionRoles = new Set([
  'normative',
  'differential-triage',
  'normative-with-differential-triage',
]);

export function loadSecurityFuzzCampaign({
  campaignPath = defaultSecurityFuzzCampaignPath,
  rootDir = repoRoot(),
} = {}) {
  return JSON.parse(readFileSync(path.join(rootDir, campaignPath), 'utf8'));
}

export function validateSecurityFuzzCampaignDocument(
  document,
  {
    expectedMutantCount = SECURITY_GATE_MUTANTS.length,
    rootDir = repoRoot(),
    verifySources = true,
  } = {},
) {
  const findings = [];
  if (!plainObject(document)) return result(['campaign root must be an object']);

  if (document.schema !== securityFuzzCampaignSchema) {
    findings.push(`schema must be ${securityFuzzCampaignSchema}`);
  }
  if (document.campaignVersion !== 1) findings.push('campaignVersion must be 1');
  if (document.releaseCommand !== securityFuzzReleaseCommand) {
    findings.push(`releaseCommand must be ${securityFuzzReleaseCommand}`);
  }
  if (
    !plainObject(document.verdictPolicy) ||
    document.verdictPolicy.normativePropertyOwnsSafetyVerdict !== true ||
    document.verdictPolicy.crossImplementationDisagreement !== 'triage-only'
  ) {
    findings.push(
      'verdictPolicy must reserve safe/unsafe for the normative property and classify cross-implementation disagreement as triage-only',
    );
  }
  if (
    !plainObject(document.failureArtifacts) ||
    document.failureArtifacts.directory !== '.kovo/security-failures/security-fuzz-campaign' ||
    document.failureArtifacts.schema !== securityFuzzCounterexampleSchema ||
    document.failureArtifacts.minimizationUnit !== 'one independently replayable manifest case' ||
    document.failureArtifacts.retentionDays !== 30
  ) {
    findings.push(
      'failureArtifacts must pin the replayable minimized-counterexample contract and 30-day retention',
    );
  }

  validateMutationHarness(document.mutationHarness, expectedMutantCount, findings);
  if (!deepEqual(document.profiles, expectedProfiles)) {
    findings.push('profiles must preserve the reviewed nightly/release wall and execution budgets');
  }

  const families = Array.isArray(document.families) ? document.families : [];
  if (!Array.isArray(document.families)) findings.push('families must be an array');
  const ids = families.map((family) => family?.id);
  if (!deepEqual(ids, expectedFamilyOrder)) {
    findings.push(`family order must be exactly ${expectedFamilyOrder.join(', ')}`);
  }

  const seenCaseIds = new Set();
  for (const family of families) {
    if (!plainObject(family) || typeof family.id !== 'string') {
      findings.push('each family must be an object with a string id');
      continue;
    }
    const id = family.id;
    if (!expectedFamilyOrder.includes(id)) {
      findings.push(`unknown family ${id}`);
      continue;
    }
    if (!deepEqual(family.seed, expectedSeeds[id])) {
      findings.push(`${id}: seed must preserve its reviewed algorithm, value, and version`);
    }
    validateCoverage(family, expectedMutantCount, findings);
    validateCases(family, seenCaseIds, findings, { rootDir, verifySources });
    for (const profile of ['nightly', 'release']) {
      if (
        document.profiles?.[profile]?.families?.[id]?.caseExecutionBudget !== family.cases?.length
      ) {
        findings.push(`${profile}/${id}: caseExecutionBudget must equal enrolled case count`);
      }
    }
  }

  const redos = families.find((family) => family?.id === 'redos');
  const differential = redos?.cases?.find(
    (testCase) => testCase?.id === 'supported-grammar-differential',
  );
  for (const profile of ['nightly', 'release']) {
    const expectedBudget = expectedProfiles[profile].families.redos.generatedInputBudget;
    const environment = differential?.profileEnv?.[profile];
    if (
      environment?.KOVO_LINEAR_REGEX_FUZZ_CASES !== String(expectedBudget) ||
      environment?.KOVO_LINEAR_REGEX_FUZZ_SEED !== expectedSeeds.redos.value
    ) {
      findings.push(
        `${profile}: ReDoS fuzzer environment must pin seed and generated-input budget`,
      );
    }
  }
  const egress = families.find((family) => family?.id === 'egress');
  const undeclaredBeforeDns = egress?.cases?.find(
    (testCase) => testCase?.id === 'undeclared-before-dns',
  );
  for (const profile of ['nightly', 'release']) {
    const expectedBudget = expectedProfiles[profile].families.egress.generatedInputBudget;
    if (
      undeclaredBeforeDns?.profileEnv?.[profile]?.KOVO_EGRESS_FUZZ_INPUTS !== String(expectedBudget)
    ) {
      findings.push(`${profile}: egress fuzzer environment must pin its generated-input budget`);
    }
  }

  return result(findings, {
    caseCount: families.reduce(
      (total, family) => total + (Array.isArray(family?.cases) ? family.cases.length : 0),
      0,
    ),
    familyCount: families.length,
    mutantCount: expectedMutantCount,
  });
}

function validateMutationHarness(value, expectedMutantCount, findings) {
  if (!plainObject(value)) {
    findings.push('mutationHarness must be an object');
    return;
  }
  if (!deepEqual(value.command, ['node', 'scripts/security-gate-mutations.mjs'])) {
    findings.push('mutationHarness.command must invoke the enrolled harness directly');
  }
  if (value.expectedMutants !== expectedMutantCount) {
    findings.push(
      `mutationHarness.expectedMutants must equal the enrolled denominator ${expectedMutantCount}`,
    );
  }
  if (value.requiredScorePercent !== 100) {
    findings.push('mutationHarness.requiredScorePercent must be exactly 100');
  }
}

function validateCoverage(family, expectedMutantCount, findings) {
  const coverage = family.coverage;
  if (!plainObject(coverage)) {
    findings.push(`${family.id}: coverage must be an object`);
    return;
  }
  if (family.id === 'mutations') {
    if (coverage.unit !== 'mutant' || coverage.denominator !== expectedMutantCount) {
      findings.push(`${family.id}: coverage denominator must equal ${expectedMutantCount} mutants`);
    }
    if (
      family.cases?.length !== 1 ||
      !deepEqual(family.cases[0]?.covers, ['all-enrolled-mutants'])
    ) {
      findings.push('mutations: the sole case must cover all-enrolled-mutants');
    }
    return;
  }
  const expected = expectedCoverage[family.id];
  if (
    coverage.unit !== 'normative-obligation' ||
    coverage.denominator !== expected.length ||
    !sameStringSet(coverage.obligations, expected)
  ) {
    findings.push(
      `${family.id}: coverage must preserve all ${expected.length} reviewed obligations`,
    );
  }
  const covered = Array.isArray(family.cases)
    ? family.cases.flatMap((testCase) => (Array.isArray(testCase?.covers) ? testCase.covers : []))
    : [];
  if (!sameStringSet(covered, expected) || new Set(covered).size !== covered.length) {
    findings.push(`${family.id}: cases must cover each obligation exactly once`);
  }
}

function validateCases(family, seenCaseIds, findings, { rootDir, verifySources }) {
  const cases = Array.isArray(family.cases) ? family.cases : [];
  if (!Array.isArray(family.cases) || cases.length === 0) {
    findings.push(`${family.id}: cases must be a non-empty array`);
    return;
  }
  for (const [index, testCase] of cases.entries()) {
    const label = `${family.id}.cases[${index}]`;
    if (!plainObject(testCase) || typeof testCase.id !== 'string' || testCase.id === '') {
      findings.push(`${label}: case must have a non-empty id`);
      continue;
    }
    const qualifiedId = `${family.id}/${testCase.id}`;
    if (seenCaseIds.has(qualifiedId)) findings.push(`${label}: duplicate case id ${qualifiedId}`);
    seenCaseIds.add(qualifiedId);
    const expectedCaseSeed = expectedCaseSeeds[qualifiedId];
    if (
      (expectedCaseSeed !== undefined && !deepEqual(testCase.seed, expectedCaseSeed)) ||
      (expectedCaseSeed === undefined && testCase.seed !== undefined)
    ) {
      findings.push(
        `${qualifiedId}: case seed must preserve its reviewed algorithm, value, and version`,
      );
    }
    if (!allowedDecisionRoles.has(testCase.decisionRole)) {
      findings.push(`${qualifiedId}: decisionRole must use the closed verdict vocabulary`);
    }
    if (!Array.isArray(testCase.covers) || testCase.covers.length === 0) {
      findings.push(`${qualifiedId}: covers must be a non-empty array`);
    }
    if (testCase.kind === 'mutation-harness') {
      if (family.id !== 'mutations' || testCase.id !== 'security-gate-mutations') {
        findings.push(
          `${qualifiedId}: mutation-harness is reserved for the enrolled mutation case`,
        );
      }
      continue;
    }
    if (testCase.kind !== 'vitest') {
      findings.push(`${qualifiedId}: kind must be vitest or mutation-harness`);
      continue;
    }
    if (
      !safeRelativePath(testCase.file) ||
      (!testCase.file.endsWith('.test.ts') && !testCase.file.endsWith('.test.tsx'))
    ) {
      findings.push(`${qualifiedId}: file must be one relative TypeScript test path`);
      continue;
    }
    if (typeof testCase.testName !== 'string' || testCase.testName === '') {
      findings.push(`${qualifiedId}: testName must be non-empty`);
      continue;
    }
    if (verifySources) {
      const absolutePath = path.join(rootDir, testCase.file);
      if (!existsSync(absolutePath)) {
        findings.push(`${qualifiedId}: test file does not exist: ${testCase.file}`);
      } else {
        const source = readFileSync(absolutePath, 'utf8');
        if (!source.includes(testCase.testName)) {
          findings.push(`${qualifiedId}: testName no longer exists in ${testCase.file}`);
        }
        const seedAnchor = expectedSourceSeedAnchors[qualifiedId];
        if (seedAnchor !== undefined && !source.includes(seedAnchor)) {
          findings.push(`${qualifiedId}: source no longer pins reviewed seed anchor ${seedAnchor}`);
        }
        const differentialMarker = expectedDifferentialMarkers[qualifiedId];
        if (differentialMarker !== undefined && !source.includes(differentialMarker)) {
          findings.push(
            `${qualifiedId}: source must distinguish differential triage with ${differentialMarker}`,
          );
        }
      }
    }
  }
}

export function validateSecurityFuzzWorkflowSource(source) {
  const findings = [];
  const requiredLines = [
    'name: Security Fuzz Campaign',
    '  schedule:',
    "    - cron: '37 8 * * *'",
    '  workflow_dispatch:',
    '      profile:',
    '          - nightly',
    '          - release',
    'permissions:',
    '  contents: read',
    '    timeout-minutes: 150',
    '      - uses: ./.github/actions/kovo-setup',
    '        run: vp exec pnpm run check:security-fuzz-campaign',
    '        run: vp exec pnpm run test:security-fuzz-nightly',
    '        run: vp exec pnpm run test:security-fuzz-release',
    '        if: failure()',
    '          if-no-files-found: ignore',
    '          path: .kovo/security-failures/**',
    '          retention-days: 30',
  ];
  for (const line of requiredLines) {
    if (!workflowHasLine(source, line)) findings.push(`workflow must include line ${line.trim()}`);
  }
  validatePinnedWorkflowActions(source, findings);
  validateWorkflowPnpmCommands(source, findings);
  if (
    !/if:\s*github\.event_name != 'workflow_dispatch' \|\| inputs\.profile == 'nightly'/u.test(
      source,
    )
  ) {
    findings.push('workflow must run the nightly profile for schedules and nightly dispatches');
  }
  if (
    !/if:\s*github\.event_name == 'workflow_dispatch' && inputs\.profile == 'release'/u.test(source)
  ) {
    findings.push('workflow must reserve the release profile for explicit dispatch');
  }
  return result(findings);
}

export function validateSecurityFuzzReleaseWorkflowSource(source) {
  const findings = [];
  const prepareStart = source.indexOf('\n  prepare:\n');
  const publishStart = source.indexOf('\n  publish:\n');
  if (prepareStart < 0 || publishStart <= prepareStart) {
    return result(['release workflow must retain ordered prepare and publish jobs']);
  }
  const prepare = source.slice(prepareStart, publishStart);
  const publish = source.slice(publishStart);
  const requiredPrepareLines = [
    '    timeout-minutes: 240',
    '      - run: vp install --frozen-lockfile',
    '      - name: Run deterministic release security fuzz campaign',
    '        run: vp exec pnpm run test:security-fuzz-release',
    '      - name: Archive release security fuzz counterexamples',
    '        if: failure()',
    '        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
    '          if-no-files-found: ignore',
    '          name: kovo-release-security-fuzz-failures-${{ github.sha }}',
    '          path: .kovo/security-failures/**',
    '          retention-days: 30',
    '        run: vp exec pnpm run check:supply-chain',
  ];
  for (const line of requiredPrepareLines) {
    if (!workflowHasLine(prepare, line)) {
      findings.push(`release prepare job must include line ${line.trim()}`);
    }
  }

  const installIndex = prepare.indexOf('run: vp install --frozen-lockfile');
  const fuzzIndex = prepare.indexOf('run: vp exec pnpm run test:security-fuzz-release');
  const artifactIndex = prepare.indexOf('name: Archive release security fuzz counterexamples');
  const supplyChainIndex = prepare.indexOf('run: vp exec pnpm run check:supply-chain');
  if (
    installIndex < 0 ||
    fuzzIndex <= installIndex ||
    artifactIndex <= fuzzIndex ||
    supplyChainIndex <= artifactIndex
  ) {
    findings.push(
      'release prepare job must install, run the exact fuzz command, preserve failures, then continue release gates',
    );
  }
  if (workflowLineCount(source, '        run: vp exec pnpm run test:security-fuzz-release') !== 1) {
    findings.push('release workflow must invoke the exact release fuzz command once');
  }
  if (
    publish.includes('test:security-fuzz-release') ||
    publish.includes('.kovo/security-failures')
  ) {
    findings.push('release fuzz execution and failure artifacts must stay outside the OIDC job');
  }
  validatePinnedWorkflowActions(source, findings);
  validateWorkflowPnpmCommands(source, findings);
  return result(findings);
}

export function validateSecurityFuzzPackageScripts(packageDocument) {
  const findings = [];
  for (const [name, expected] of Object.entries(expectedPackageScripts)) {
    if (packageDocument?.scripts?.[name] !== expected) {
      findings.push(`package.json scripts.${name} must equal ${expected}`);
    }
  }
  const check = packageDocument?.scripts?.check;
  if (typeof check !== 'string' || !check.includes('pnpm run check:security-fuzz-campaign')) {
    findings.push('package.json check must enroll check:security-fuzz-campaign');
  }
  return result(findings);
}

export function parseMutationScore(output) {
  const summaries = [
    ...output.matchAll(/Security gate mutation harness passed \((\d+) mutants killed\)\./gu),
  ];
  if (summaries.length !== 1) {
    throw new Error('mutation output must contain exactly one killed/total summary');
  }
  const total = Number(summaries[0][1]);
  const killedNames = [...output.matchAll(/^  - (.+): killed .+$/gmu)].map((match) => match[1]);
  if (new Set(killedNames).size !== killedNames.length) {
    throw new Error('mutation output contains duplicate killed mutant rows');
  }
  if (killedNames.length !== total) {
    throw new Error(
      `mutation output summary says ${total} killed but reports ${killedNames.length} rows`,
    );
  }
  return Object.freeze({
    killed: killedNames.length,
    killedNames: Object.freeze(killedNames),
    percentage: total === 0 ? 0 : (killedNames.length / total) * 100,
    total,
  });
}

export function parseMutationOutcome({ exitCode, expectedTotal, stderr, stdout }) {
  if (exitCode === 0) {
    const score = parseMutationScore(stdout);
    return Object.freeze({
      ...score,
      failed: 0,
      failedMutants: Object.freeze([]),
      survivors: 0,
    });
  }
  if (!stderr.includes('Security gate mutation harness failed:')) {
    throw new Error('failed mutation output must contain the harness failure summary');
  }
  const failedMutants = [
    ...stderr.matchAll(/^  - (.+): (survived|baseline-failed|harness-failed|unknown); .+$/gmu),
  ].map((match) => Object.freeze({ name: match[1], status: match[2] }));
  if (failedMutants.length === 0) {
    throw new Error('failed mutation output must name at least one non-killed mutant');
  }
  if (new Set(failedMutants.map((mutant) => mutant.name)).size !== failedMutants.length) {
    throw new Error('failed mutation output contains duplicate mutant rows');
  }
  if (failedMutants.length > expectedTotal) {
    throw new Error('failed mutation output exceeds the enrolled mutation denominator');
  }
  const killed = expectedTotal - failedMutants.length;
  return Object.freeze({
    failed: failedMutants.length,
    failedMutants: Object.freeze(failedMutants),
    killed,
    killedNames: Object.freeze([]),
    percentage: expectedTotal === 0 ? 0 : (killed / expectedTotal) * 100,
    survivors: failedMutants.filter((mutant) => mutant.status === 'survived').length,
    total: expectedTotal,
  });
}

export function parseVitestCaseResult(output, expectedTitle) {
  let report;
  try {
    report = JSON.parse(output);
  } catch {
    throw new Error('Vitest case output must be one JSON report');
  }
  const assertions = Array.isArray(report?.testResults)
    ? report.testResults.flatMap((testResult) =>
        Array.isArray(testResult?.assertionResults) ? testResult.assertionResults : [],
      )
    : [];
  const selected = assertions.filter((assertion) => assertion?.title === expectedTitle);
  if (
    report?.success !== true ||
    report?.numFailedTests !== 0 ||
    report?.numPassedTests !== 1 ||
    selected.length !== 1 ||
    selected[0]?.status !== 'passed'
  ) {
    throw new Error(
      `Vitest case must execute exactly one passing test named ${JSON.stringify(expectedTitle)}`,
    );
  }
  return Object.freeze({ passed: 1, title: expectedTitle });
}

export function validateDefaultSecurityFuzzCampaign({ rootDir = repoRoot() } = {}) {
  const campaign = loadSecurityFuzzCampaign({ rootDir });
  const campaignCheck = validateSecurityFuzzCampaignDocument(campaign, { rootDir });
  const workflowCheck = validateSecurityFuzzWorkflowSource(
    readFileSync(path.join(rootDir, defaultSecurityFuzzWorkflowPath), 'utf8'),
  );
  const releaseWorkflowCheck = validateSecurityFuzzReleaseWorkflowSource(
    readFileSync(path.join(rootDir, defaultSecurityFuzzReleaseWorkflowPath), 'utf8'),
  );
  const packageCheck = validateSecurityFuzzPackageScripts(
    JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8')),
  );
  return result(
    [
      ...campaignCheck.findings,
      ...workflowCheck.findings,
      ...releaseWorkflowCheck.findings,
      ...packageCheck.findings,
    ],
    campaignCheck.summary,
  );
}

export async function runSecurityFuzzCampaign(
  profileName,
  { campaign, rootDir = repoRoot(), stream = true } = {},
) {
  const document = campaign ?? loadSecurityFuzzCampaign({ rootDir });
  const check = validateSecurityFuzzCampaignDocument(document, { rootDir });
  if (!check.ok) throw new Error(formatFindings('security fuzz campaign contract', check.findings));
  if (profileName !== 'nightly' && profileName !== 'release') {
    throw new Error('profile must be nightly or release');
  }

  const profile = document.profiles[profileName];
  const artifactRoot = path.join(rootDir, document.failureArtifacts.directory, profileName);
  rmSync(artifactRoot, { force: true, recursive: true });
  const campaignStarted = performance.now();
  const failures = [];
  const summaries = [];

  for (const family of document.families) {
    const familyStarted = performance.now();
    const familyBudget = profile.families[family.id];
    process.stdout.write(
      `security-fuzz ${profileName}/${family.id}: seed=${family.seed.value} coverage=${family.coverage.denominator}\n`,
    );
    for (const testCase of family.cases) {
      const campaignRemaining = profile.maxWallMs - (performance.now() - campaignStarted);
      const familyRemaining = familyBudget.maxWallMs - (performance.now() - familyStarted);
      const timeoutMs = Math.floor(Math.min(campaignRemaining, familyRemaining));
      if (timeoutMs <= 0) {
        const budgetFailure = {
          error: `wall budget exhausted before ${family.id}/${testCase.id}`,
          exitCode: null,
          ok: false,
          signal: null,
          stderr: '',
          stdout: '',
          timedOut: true,
        };
        const record = await persistFailure({
          document,
          family,
          first: budgetFailure,
          profile,
          profileName,
          rootDir,
          testCase,
        });
        failures.push(record);
        continue;
      }
      const execution = await executeCase({
        document,
        family,
        profileName,
        rootDir,
        stream,
        testCase,
        timeoutMs,
      });
      if (!execution.ok) {
        if (execution.mutationScore !== undefined) {
          process.stderr.write(
            `security-fuzz mutation score: ${execution.mutationScore.killed}/${execution.mutationScore.total} (${execution.mutationScore.percentage.toFixed(2)}%); survivors=${execution.mutationScore.survivors} failed=${execution.mutationScore.failed}\n`,
          );
        }
        const record = await persistFailure({
          document,
          family,
          first: execution,
          profile,
          profileName,
          rootDir,
          testCase,
        });
        failures.push(record);
      } else if (execution.mutationScore !== undefined) {
        summaries.push(execution.mutationScore);
        process.stdout.write(
          `security-fuzz mutation score: ${execution.mutationScore.killed}/${execution.mutationScore.total} (${execution.mutationScore.percentage.toFixed(2)}%)\n`,
        );
      } else {
        process.stdout.write(`security-fuzz ${family.id}/${testCase.id}: passed 1/1\n`);
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `security fuzz ${profileName} failed (${failures.length} cases); replay artifacts: ${path.relative(rootDir, artifactRoot)}`,
    );
  }
  const mutationScore = summaries[0];
  if (
    mutationScore === undefined ||
    mutationScore.killed !== document.mutationHarness.expectedMutants ||
    mutationScore.total !== document.mutationHarness.expectedMutants ||
    mutationScore.percentage !== document.mutationHarness.requiredScorePercent
  ) {
    throw new Error('security fuzz campaign did not produce its exact mutation score');
  }
  process.stdout.write(
    `Security fuzz campaign ${profileName} passed: families=${document.families.length} cases=${check.summary.caseCount} mutation=${mutationScore.killed}/${mutationScore.total}.\n`,
  );
  return { failures, mutationScore, profile: profileName };
}

async function executeCase({
  document,
  family,
  profileName,
  rootDir,
  stream,
  testCase,
  timeoutMs,
}) {
  const invocation = caseInvocation({ document, family, profileName, rootDir, testCase });
  const execution = await executeInvocation(invocation, {
    rootDir,
    stream: stream && testCase.kind === 'mutation-harness',
    timeoutMs,
  });
  if (testCase.kind === 'vitest') {
    if (!execution.ok) return execution;
    try {
      const vitestResult = parseVitestCaseResult(execution.stdout, testCase.testName);
      return { ...execution, vitestResult };
    } catch (error) {
      return {
        ...execution,
        error: error instanceof Error ? error.message : String(error),
        ok: false,
      };
    }
  }
  try {
    const mutationScore = parseMutationOutcome({
      exitCode: execution.exitCode,
      expectedTotal: document.mutationHarness.expectedMutants,
      stderr: execution.stderr,
      stdout: execution.stdout,
    });
    if (
      mutationScore.total !== document.mutationHarness.expectedMutants ||
      (execution.ok &&
        (mutationScore.killed !== document.mutationHarness.expectedMutants ||
          mutationScore.percentage !== document.mutationHarness.requiredScorePercent))
    ) {
      throw new Error(
        `mutation score ${mutationScore.killed}/${mutationScore.total} does not equal the required ${document.mutationHarness.requiredScorePercent}% over denominator ${document.mutationHarness.expectedMutants}`,
      );
    }
    return { ...execution, mutationScore, ok: execution.ok && mutationScore.failed === 0 };
  } catch (error) {
    return {
      ...execution,
      error: error instanceof Error ? error.message : String(error),
      ok: false,
    };
  }
}

function caseInvocation({ document, family, profileName, rootDir, testCase }) {
  const profileEnvironment = plainObject(testCase.profileEnv?.[profileName])
    ? testCase.profileEnv[profileName]
    : {};
  const environment = {
    KOVO_SECURITY_FUZZ_FAMILY: family.id,
    KOVO_SECURITY_FUZZ_PROFILE: profileName,
    KOVO_SECURITY_FUZZ_SEED: (testCase.seed ?? family.seed).value,
    ...profileEnvironment,
  };
  if (testCase.kind === 'mutation-harness') {
    const [command, ...args] = document.mutationHarness.command;
    return {
      args,
      command: command === 'node' ? process.execPath : command,
      environment,
      replayCommand: shellCommand(environment, [command, ...args]),
    };
  }
  const vitestPath = path.join(rootDir, 'node_modules/vitest/vitest.mjs');
  const args = [
    vitestPath,
    '--run',
    testCase.file,
    '--testNamePattern',
    `${escapeRegex(testCase.testName)}$`,
    '--no-file-parallelism',
    '--reporter=json',
  ];
  return {
    args,
    command: process.execPath,
    environment,
    replayCommand: shellCommand(environment, [
      'pnpm',
      'exec',
      'vitest',
      '--run',
      testCase.file,
      '--testNamePattern',
      `${escapeRegex(testCase.testName)}$`,
      '--no-file-parallelism',
      '--reporter=json',
    ]),
  };
}

async function executeInvocation(invocation, { rootDir, stream, timeoutMs }) {
  return await new Promise((resolve) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: rootDir,
      env: { ...process.env, ...invocation.environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stream) process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stream) process.stderr.write(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        error: error.message,
        exitCode: null,
        ok: false,
        signal: null,
        stderr,
        stdout,
        timedOut,
      });
    });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        error: timedOut ? `case exceeded ${timeoutMs}ms` : undefined,
        exitCode,
        ok: !timedOut && exitCode === 0,
        signal,
        stderr,
        stdout,
        timedOut,
      });
    });
  });
}

async function persistFailure({
  document,
  family,
  first,
  profile,
  profileName,
  rootDir,
  testCase,
}) {
  const invocation = caseInvocation({ document, family, profileName, rootDir, testCase });
  const replay = await executeCase({
    document,
    family,
    profileName,
    rootDir,
    stream: false,
    testCase,
    timeoutMs: profile.replayTimeoutMs,
  });
  const failureClassification = classifySecurityFuzzFailure(testCase, first);
  const replayVerified = !replay.ok && !replay.timedOut;
  const record = {
    schema: securityFuzzCounterexampleSchema,
    campaignVersion: document.campaignVersion,
    profile: profileName,
    family: family.id,
    caseId: testCase.id,
    seed: testCase.seed ?? family.seed,
    decisionRole: testCase.decisionRole,
    classification: failureClassification.classification,
    safetyVerdict: failureClassification.safetyVerdict,
    minimization: replayVerified ? 'single independently invocable manifest case' : 'unconfirmed',
    replayVerified,
    replay: {
      argv: [invocation.command, ...invocation.args],
      command: invocation.replayCommand,
      environment: invocation.environment,
    },
    firstFailure: executionSnapshot(first),
    replayFailure: executionSnapshot(replay),
  };
  const directory = path.join(
    rootDir,
    document.failureArtifacts.directory,
    profileName,
    safeSegment(family.id),
    safeSegment(testCase.id),
  );
  mkdirSync(directory, { recursive: true });
  const filename = replayVerified ? 'minimized-counterexample.json' : 'unconfirmed-failure.json';
  const destination = path.join(directory, filename);
  writeFileSync(destination, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  process.stderr.write(
    `security-fuzz ${profileName}/${family.id}/${testCase.id}: ${record.classification}; ${path.relative(rootDir, destination)}\n`,
  );
  return record;
}

export function classifySecurityFuzzFailure(testCase, execution) {
  const combinedOutput = `${execution.stdout}\n${execution.stderr}\n${execution.error ?? ''}`;
  if (
    testCase.decisionRole === 'differential-triage' ||
    combinedOutput.includes('KOVO_CROSS_IMPLEMENTATION_DISAGREEMENT')
  ) {
    return {
      classification: 'cross-implementation-disagreement-triage',
      safetyVerdict: 'undetermined',
    };
  }
  if (testCase.kind === 'mutation-harness') {
    return {
      classification:
        execution.mutationScore?.survivors > 0 ? 'mutation-survivor' : 'mutation-harness-failure',
      safetyVerdict: 'undetermined',
    };
  }
  if (selectedVitestAssertionFailed(execution.stdout, testCase.testName)) {
    return { classification: 'normative-property-violation', safetyVerdict: 'unsafe' };
  }
  return { classification: 'campaign-infrastructure-failure', safetyVerdict: 'undetermined' };
}

function selectedVitestAssertionFailed(output, expectedTitle) {
  try {
    const report = JSON.parse(output);
    const assertions = Array.isArray(report?.testResults)
      ? report.testResults.flatMap((testResult) =>
          Array.isArray(testResult?.assertionResults) ? testResult.assertionResults : [],
        )
      : [];
    return assertions.some(
      (assertion) => assertion?.title === expectedTitle && assertion.status === 'failed',
    );
  } catch {
    return false;
  }
}

function executionSnapshot(execution) {
  return {
    error: execution.error ?? null,
    exitCode: execution.exitCode,
    signal: execution.signal,
    stderr: tail(execution.stderr, 24_000),
    stdout: tail(execution.stdout, 24_000),
    timedOut: execution.timedOut,
    ...(execution.mutationScore === undefined ? {} : { mutationScore: execution.mutationScore }),
  };
}

function tail(value, limit) {
  return value.length <= limit ? value : value.slice(-limit);
}

function shellCommand(environment, argv) {
  return [
    ...Object.entries(environment).map(([name, value]) => `${name}=${shellQuote(value)}`),
    ...argv.map(shellQuote),
  ].join(' ');
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=+-]+$/u.test(text)) return text;
  return `'${text.replaceAll("'", `'"'"'`)}'`;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function safeSegment(value) {
  return value.replace(/[^A-Za-z0-9._-]/gu, '_');
}

function safeRelativePath(value) {
  return (
    typeof value === 'string' &&
    value !== '' &&
    !path.isAbsolute(value) &&
    !value.split(/[\\/]/u).includes('..')
  );
}

function workflowHasLine(source, expected) {
  return source.split(/\r?\n/u).includes(expected);
}

function workflowLineCount(source, expected) {
  return source.split(/\r?\n/u).filter((line) => line === expected).length;
}

function validatePinnedWorkflowActions(source, findings) {
  const actionUses = [...source.matchAll(/^\s*- uses:\s*([^\s]+)\s*$/gmu)].map((match) => match[1]);
  for (const action of actionUses) {
    if (action.startsWith('./')) continue;
    if (!/@[0-9a-f]{40}$/u.test(action)) {
      findings.push(`workflow action must be SHA-pinned: ${action}`);
    }
  }
}

function validateWorkflowPnpmCommands(source, findings) {
  for (const match of source.matchAll(/^\s*run:\s*(.+)$/gmu)) {
    const command = match[1];
    if (/\bpnpm\b/u.test(command) && !/^vp exec pnpm\b/u.test(command)) {
      findings.push(`workflow pnpm command must run through vp: ${command}`);
    }
  }
}

function sameStringSet(actual, expected) {
  if (!Array.isArray(actual) || actual.some((value) => typeof value !== 'string')) return false;
  return deepEqual(
    [...new Set(actual)].sort((left, right) => left.localeCompare(right)),
    [...expected].sort((left, right) => left.localeCompare(right)),
  );
}

function deepEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => deepEqual(value, right[index]))
    );
  }
  if (!plainObject(left) || !plainObject(right)) return false;
  const leftKeys = Object.keys(left).sort((a, b) => a.localeCompare(b));
  const rightKeys = Object.keys(right).sort((a, b) => a.localeCompare(b));
  return (
    deepEqual(leftKeys, rightKeys) && leftKeys.every((key) => deepEqual(left[key], right[key]))
  );
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function result(findings, summary = {}) {
  return { findings, ok: findings.length === 0, summary };
}

function formatFindings(label, findings) {
  return `${label} failed (${findings.length}):\n${findings.map((finding) => `- ${finding}`).join('\n')}`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--check') {
    const check = validateDefaultSecurityFuzzCampaign();
    if (!check.ok) {
      process.stderr.write(
        `${formatFindings('check-security-fuzz-campaign/v1', check.findings)}\n`,
      );
      return 1;
    }
    process.stdout.write(
      `check-security-fuzz-campaign/v1 OK families=${check.summary.familyCount} cases=${check.summary.caseCount} mutants=${check.summary.mutantCount}\n`,
    );
    return 0;
  }
  if (args.length === 2 && args[0] === '--profile') {
    await runSecurityFuzzCampaign(args[1]);
    return 0;
  }
  throw new Error(
    'usage: node scripts/security-fuzz-campaign.mjs --check | --profile nightly|release',
  );
}

if (isMainEntry(import.meta.url)) await runGate(main);
