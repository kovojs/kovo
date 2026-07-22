import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './lib/repo-root.mjs';
import {
  buildSecurityFuzzSuccessRecord,
  classifySecurityFuzzFailure,
  createSecurityFuzzChildEnvironment,
  currentCodeSubjectSha,
  loadSecurityFuzzCampaign,
  parseMutationOutcome,
  parseMutationScore,
  parseVitestCaseResult,
  validateDefaultSecurityFuzzCampaign,
  validateSecurityFuzzCampaignDocument,
  validateSecurityFuzzPackageScripts,
  validateSecurityFuzzReleaseWorkflowSource,
  validateSecurityFuzzSuccessRecord,
  validateSecurityFuzzWorkflowSource,
} from './security-fuzz-campaign.mjs';

const rootDir = repoRoot();

describe('deterministic security fuzz campaign contract', () => {
  it('accepts the committed campaign, workflow, package scripts, and live mutation denominator', () => {
    expect(validateDefaultSecurityFuzzCampaign({ rootDir })).toMatchObject({
      findings: [],
      ok: true,
      summary: { caseCount: 21, familyCount: 7 },
    });
  });

  it('rejects seed or verdict-policy drift for every required family', () => {
    const source = loadSecurityFuzzCampaign({ rootDir });
    for (const family of source.families) {
      const document = structuredClone(source);
      document.families.find((candidate) => candidate.id === family.id).seed.value += '-drift';
      expect(validateSecurityFuzzCampaignDocument(document, { rootDir }).findings).toContain(
        `${family.id}: seed must preserve its reviewed algorithm, value, and version`,
      );
    }

    const caseSeedDrift = structuredClone(source);
    caseSeedDrift.families
      .find((family) => family.id === 'redos')
      .cases.find((testCase) => testCase.id === 'full-ceiling-hostile-corpus').seed.value =
      '0x00000000';
    expect(validateSecurityFuzzCampaignDocument(caseSeedDrift, { rootDir }).findings).toContain(
      'redos/full-ceiling-hostile-corpus: case seed must preserve its reviewed algorithm, value, and version',
    );

    const policyDrift = structuredClone(source);
    policyDrift.verdictPolicy.crossImplementationDisagreement = 'unsafe';
    expect(validateSecurityFuzzCampaignDocument(policyDrift, { rootDir }).findings).toEqual(
      expect.arrayContaining([expect.stringContaining('triage-only')]),
    );

    const successArtifactDrift = structuredClone(source);
    successArtifactDrift.successArtifacts.qualification = 'campaign command passed';
    expect(
      validateSecurityFuzzCampaignDocument(successArtifactDrift, { rootDir }).findings,
    ).toContain(
      'successArtifacts must pin the 30-day authenticated terminal-workflow qualification and durable evidence schema',
    );
  });

  it('rejects nightly/release wall, execution, generated-input, and profile-seed drift', () => {
    const source = loadSecurityFuzzCampaign({ rootDir });
    const wallDrift = structuredClone(source);
    wallDrift.profiles.nightly.families.authority.maxWallMs += 1;
    expect(validateSecurityFuzzCampaignDocument(wallDrift, { rootDir }).findings).toContain(
      'profiles must preserve the reviewed nightly/release wall and execution budgets',
    );

    const executionDrift = structuredClone(source);
    executionDrift.profiles.release.families.csrf.caseExecutionBudget -= 1;
    expect(validateSecurityFuzzCampaignDocument(executionDrift, { rootDir }).ok).toBe(false);

    const generatedInputDrift = structuredClone(source);
    generatedInputDrift.profiles.release.families.redos.generatedInputBudget -= 1;
    expect(validateSecurityFuzzCampaignDocument(generatedInputDrift, { rootDir }).ok).toBe(false);

    const environmentDrift = structuredClone(source);
    environmentDrift.families
      .find((family) => family.id === 'redos')
      .cases.find(
        (testCase) => testCase.id === 'supported-grammar-differential',
      ).profileEnv.nightly.KOVO_LINEAR_REGEX_FUZZ_SEED = '0x00000000';
    expect(validateSecurityFuzzCampaignDocument(environmentDrift, { rootDir }).findings).toContain(
      'nightly: ReDoS fuzzer environment must pin seed and generated-input budget',
    );

    const egressEnvironmentDrift = structuredClone(source);
    egressEnvironmentDrift.families
      .find((family) => family.id === 'egress')
      .cases.find(
        (testCase) => testCase.id === 'undeclared-before-dns',
      ).profileEnv.release.KOVO_EGRESS_FUZZ_INPUTS = '4';
    expect(
      validateSecurityFuzzCampaignDocument(egressEnvironmentDrift, { rootDir }).findings,
    ).toContain('release: egress fuzzer environment must pin its generated-input budget');
  });

  it('rejects missing families, obligations, case enrollment, and mutation denominator drift', () => {
    const source = loadSecurityFuzzCampaign({ rootDir });
    const missingFamily = structuredClone(source);
    missingFamily.families.splice(1, 1);
    expect(validateSecurityFuzzCampaignDocument(missingFamily, { rootDir }).findings).toEqual(
      expect.arrayContaining([expect.stringContaining('family order must be exactly')]),
    );

    const coverageDrift = structuredClone(source);
    coverageDrift.families.find((family) => family.id === 'headers').coverage.denominator = 6;
    expect(validateSecurityFuzzCampaignDocument(coverageDrift, { rootDir }).findings).toContain(
      'headers: coverage must preserve all 7 reviewed obligations',
    );

    const missingCase = structuredClone(source);
    missingCase.families.find((family) => family.id === 'csrf').cases.pop();
    expect(validateSecurityFuzzCampaignDocument(missingCase, { rootDir }).findings).toContain(
      'csrf: cases must cover each obligation exactly once',
    );

    const mutationDrift = structuredClone(source);
    mutationDrift.mutationHarness.expectedMutants -= 1;
    mutationDrift.families.find((family) => family.id === 'mutations').coverage.denominator -= 1;
    expect(validateSecurityFuzzCampaignDocument(mutationDrift, { rootDir }).findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('mutationHarness.expectedMutants must equal'),
        expect.stringContaining('coverage denominator must equal'),
      ]),
    );

    const scoreDrift = structuredClone(source);
    scoreDrift.mutationHarness.requiredScorePercent = 99;
    expect(validateSecurityFuzzCampaignDocument(scoreDrift, { rootDir }).findings).toContain(
      'mutationHarness.requiredScorePercent must be exactly 100',
    );

    const mutationCoverageDrift = structuredClone(source);
    mutationCoverageDrift.families.find((family) => family.id === 'mutations').cases[0].covers = [
      'sampled-mutants',
    ];
    expect(
      validateSecurityFuzzCampaignDocument(mutationCoverageDrift, { rootDir }).findings,
    ).toContain('mutations: the sole case must cover all-enrolled-mutants');
  });

  it('rejects workflow schedule, pinning, vp, profile, and failure-artifact drift', () => {
    const source = readFileSync(
      path.join(rootDir, '.github/workflows/security-nightly.yml'),
      'utf8',
    );
    expect(validateSecurityFuzzWorkflowSource(source)).toEqual({
      findings: [],
      ok: true,
      summary: {},
    });

    for (const [needle, replacement, finding] of [
      ["cron: '37 8 * * *'", "cron: '0 0 * * 0'", 'cron'],
      [
        'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5',
        'actions/checkout@v4',
        'SHA-pinned',
      ],
      [
        'vp exec pnpm run test:security-fuzz-nightly',
        'pnpm run test:security-fuzz-nightly',
        'through vp',
      ],
      ['if: failure()', 'if: success()', 'if: failure()'],
      ['if: success()', 'if: always()', 'if: success()'],
      [
        'path: .kovo/security-evidence/security-fuzz-campaign/*.json',
        'path: /tmp/success.json',
        'security-evidence',
      ],
      ['path: .kovo/security-failures/**', 'path: /tmp/logs', 'security-failures'],
      ['timeout-minutes: 150', 'timeout-minutes: 120', 'timeout-minutes: 150'],
      ['- release', '- quick', '- release'],
    ]) {
      const check = validateSecurityFuzzWorkflowSource(source.replace(needle, replacement));
      expect(check.ok, `${needle} must be load-bearing`).toBe(false);
      expect(check.findings.join('\n')).toContain(finding);
    }

    const commentedSchedule = source.replace(
      "    - cron: '37 8 * * *'",
      "    # - cron: '37 8 * * *'",
    );
    expect(validateSecurityFuzzWorkflowSource(commentedSchedule).findings).toContain(
      "workflow must include line - cron: '37 8 * * *'",
    );

    const decoySuccess = source
      .replace(
        '      - name: Validate versioned campaign contract\n        run:',
        '      - name: Validate versioned campaign contract\n        if: success()\n        run:',
      )
      .replace(
        '      - name: Archive successful campaign evidence\n        if: success()',
        '      - name: Archive successful campaign evidence\n        if: always()',
      );
    expect(validateSecurityFuzzWorkflowSource(decoySuccess).findings).toContain(
      'successful evidence upload step must retain its exact condition, action/command, and mapping',
    );
  });

  it('builds digest-bound success evidence that still requires a terminal-green workflow', () => {
    const campaign = loadSecurityFuzzCampaign({ rootDir });
    const executions = campaign.families.flatMap((family) =>
      family.cases.map((testCase) => ({
        caseId: testCase.id,
        covers: [...testCase.covers],
        decisionRole: testCase.decisionRole,
        familyId: family.id,
        status: 'passed',
      })),
    );
    const record = buildSecurityFuzzSuccessRecord({
      campaign,
      codeSubjectSha: '0123456789abcdef0123456789abcdef01234567',
      endedAt: '2026-07-20T12:05:00Z',
      environment: {
        GITHUB_ACTIONS: 'true',
        GITHUB_EVENT_NAME: 'schedule',
        GITHUB_REF: 'refs/heads/main',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_RUN_ID: '1234',
        GITHUB_SHA: '0123456789abcdef0123456789abcdef01234567',
        GITHUB_WORKFLOW: 'Security Fuzz Campaign',
      },
      executions,
      mutationScore: {
        killed: campaign.mutationHarness.expectedMutants,
        percentage: 100,
        survivors: 0,
        total: campaign.mutationHarness.expectedMutants,
      },
      profileName: 'nightly',
      rootDir,
      startedAt: '2026-07-20T12:00:00Z',
    });
    expect(validateSecurityFuzzSuccessRecord(record, { campaign, rootDir })).toEqual({
      findings: [],
      ok: true,
      summary: {},
    });
    expect(record).toMatchObject({
      analyzerSoundness: {
        canaryRecall: { detected: 2, total: 2 },
        semanticCoverage: { passed: 5, total: 5 },
        unresolvedObservedOutsidePredicted: 0,
      },
      execution: { casesExecuted: 21 },
      normativePropertyViolations: 0,
      qualification: expect.stringContaining('authenticated GitHub Actions API proof'),
      qualificationEvidence: {
        authenticatedTerminalConclusion: null,
        state: 'pending-authenticated-terminal-green-actions-verification',
      },
      workflow: { eventName: 'schedule', inGitHubActions: true, runId: '1234' },
    });

    for (const mutate of [
      (document) => (document.campaign.sha256 = '0'.repeat(64)),
      (document) => (document.analyzerSoundness.canaryRecall.detected = 1),
      (document) => (document.mutation.survivors = 1),
      (document) => (document.qualification = 'command-only'),
      (document) => (document.qualificationEvidence.authenticatedTerminalConclusion = 'success'),
      (document) => document.execution.cases.pop(),
      (document) => document.execution.cases.push(document.execution.cases[0]),
    ]) {
      const mutant = structuredClone(record);
      mutate(mutant);
      expect(validateSecurityFuzzSuccessRecord(mutant, { campaign, rootDir }).ok).toBe(false);
    }
    expect(() =>
      buildSecurityFuzzSuccessRecord({
        campaign,
        codeSubjectSha: '0123456789abcdef0123456789abcdef01234567',
        endedAt: '2026-07-20T12:05:00Z',
        executions: executions.slice(1),
        mutationScore: {
          killed: campaign.mutationHarness.expectedMutants,
          percentage: 100,
          survivors: 0,
          total: campaign.mutationHarness.expectedMutants,
        },
        profileName: 'nightly',
        rootDir,
        startedAt: '2026-07-20T12:00:00Z',
      }),
    ).toThrow('every declared security fuzz case must execute exactly once');
  });

  it('cross-checks GITHUB_SHA against the checked-out commit', () => {
    const actual = currentCodeSubjectSha(rootDir, {});
    expect(actual).toMatch(/^[0-9a-f]{40}$/u);
    expect(() => currentCodeSubjectSha(rootDir, { GITHUB_SHA: '0'.repeat(40) })).toThrow(
      'does not equal checked-out code subject',
    );
  });

  it('runs the exact release profile before packing and preserves failures outside OIDC', () => {
    const source = readFileSync(path.join(rootDir, '.github/workflows/release.yml'), 'utf8');
    expect(validateSecurityFuzzReleaseWorkflowSource(source)).toEqual({
      findings: [],
      ok: true,
      summary: {},
    });

    for (const [needle, replacement, finding] of [
      [
        '"$KOVO_RELEASE_PNPM_CLI" run check:grammar-containment',
        '"$KOVO_RELEASE_PNPM_CLI" run check:grammar-containment-disabled',
        'check:grammar-containment',
      ],
      [
        '"$KOVO_RELEASE_PNPM_CLI" run test:security-fuzz-release',
        '"$KOVO_RELEASE_PNPM_CLI" run test:security-fuzz-nightly',
        'release fuzz command',
      ],
      ['timeout-minutes: 240', 'timeout-minutes: 120', 'timeout-minutes: 240'],
      [
        'name: Archive release security fuzz counterexamples',
        'name: Ignore release security fuzz counterexamples',
        'Archive release security fuzz counterexamples',
      ],
      ['path: .kovo/security-failures/**', 'path: /tmp/logs', 'security-failures'],
    ]) {
      const check = validateSecurityFuzzReleaseWorkflowSource(source.replace(needle, replacement));
      expect(check.ok, `${needle} must be load-bearing`).toBe(false);
      expect(check.findings.join('\n')).toContain(finding);
    }
  });

  it('pins the exact root release command in both manifest and package scripts', () => {
    const packageDocument = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    expect(validateSecurityFuzzPackageScripts(packageDocument).ok).toBe(true);

    const packageDrift = structuredClone(packageDocument);
    packageDrift.scripts['test:security-fuzz-release'] =
      'node scripts/security-fuzz-campaign.mjs --profile nightly';
    expect(validateSecurityFuzzPackageScripts(packageDrift).findings).toContain(
      'package.json scripts.test:security-fuzz-release must equal node scripts/security-fuzz-campaign.mjs --profile release',
    );

    const campaignDrift = loadSecurityFuzzCampaign({ rootDir });
    campaignDrift.releaseCommand = 'pnpm test';
    expect(validateSecurityFuzzCampaignDocument(campaignDrift, { rootDir }).findings).toContain(
      'releaseCommand must be pnpm run test:security-fuzz-release',
    );
  });

  it('strips ambient replay controls before enforcing the fixed profile budget', () => {
    expect(
      createSecurityFuzzChildEnvironment(
        {
          KOVO_EGRESS_FUZZ_REPLAY_FILE: 'manifest-replay.json',
          KOVO_SECURITY_FUZZ_SEED: 'fixed-seed',
        },
        {
          KOVO_EGRESS_FUZZ_REPLAY_FILE: 'ambient-egress-replay.json',
          KOVO_LINEAR_REGEX_FUZZ_REPLAY_FILE: 'ambient-redos-replay.json',
          KOVO_SECURITY_FUZZ_SEED: 'ambient-seed',
          SAFE_AMBIENT_VALUE: 'preserved',
        },
      ),
    ).toEqual({
      KOVO_SECURITY_FUZZ_SEED: 'fixed-seed',
      SAFE_AMBIENT_VALUE: 'preserved',
    });
  });
});

describe('mutation score parser', () => {
  const exact = [
    'Security gate mutation harness passed (2 mutants killed).',
    '  - first/drop-check: killed focused first proof',
    '  - second/weaken-door: killed focused second proof',
    '',
  ].join('\n');

  it('reports exact killed/total rows and score', () => {
    expect(parseMutationScore(exact)).toMatchObject({
      killed: 2,
      percentage: 100,
      total: 2,
    });
  });

  it('fails closed on survivors, summary drift, missing rows, or duplicate rows', () => {
    expect(() =>
      parseMutationScore('Security gate mutation harness failed:\n  - first: survived; no error'),
    ).toThrow('exactly one killed/total summary');
    expect(() => parseMutationScore(exact.replace('mutants killed', 'mutations killed'))).toThrow(
      'exactly one killed/total summary',
    );
    expect(() =>
      parseMutationScore(
        exact.replace('  - second/weaken-door: killed focused second proof\n', ''),
      ),
    ).toThrow('reports 1 rows');
    expect(() =>
      parseMutationScore(exact.replace('second/weaken-door', 'first/drop-check')),
    ).toThrow('duplicate killed mutant rows');
  });

  it('reports an exact killed/total score while retaining survivor and harness-failure classes', () => {
    expect(
      parseMutationOutcome({
        exitCode: 1,
        expectedTotal: 4,
        stderr: [
          'Security gate mutation harness failed:',
          '  - first/drop-check: survived; mutated gate still passed',
          '  - second/setup: harness-failed; setup failed',
          '',
        ].join('\n'),
        stdout: '',
      }),
    ).toMatchObject({ failed: 2, killed: 2, percentage: 50, survivors: 1, total: 4 });
    expect(() =>
      parseMutationOutcome({
        exitCode: 1,
        expectedTotal: 4,
        stderr: 'process crashed',
        stdout: '',
      }),
    ).toThrow('harness failure summary');
  });
});

describe('focused Vitest result parser', () => {
  const title = 'normative property owns this verdict';
  const report = {
    numFailedTests: 0,
    numPassedTests: 1,
    success: true,
    testResults: [
      {
        assertionResults: [
          { status: 'passed', title },
          { status: 'skipped', title: 'unselected neighbor' },
        ],
      },
    ],
  };

  it('requires exactly one selected passing oracle', () => {
    expect(parseVitestCaseResult(JSON.stringify(report), title)).toEqual({ passed: 1, title });
  });

  it('rejects a skipped selector, duplicate selection, failure, or reporter drift', () => {
    expect(() =>
      parseVitestCaseResult(
        JSON.stringify({
          ...report,
          numPassedTests: 0,
          testResults: [{ assertionResults: [{ status: 'skipped', title }] }],
        }),
        title,
      ),
    ).toThrow('exactly one passing test');
    expect(() =>
      parseVitestCaseResult(
        JSON.stringify({
          ...report,
          numPassedTests: 2,
          testResults: [
            {
              assertionResults: [
                { status: 'passed', title },
                { status: 'passed', title },
              ],
            },
          ],
        }),
        title,
      ),
    ).toThrow('exactly one passing test');
    expect(() =>
      parseVitestCaseResult(
        JSON.stringify({ ...report, numFailedTests: 1, success: false }),
        title,
      ),
    ).toThrow('exactly one passing test');
    expect(() => parseVitestCaseResult('not-json', title)).toThrow('one JSON report');
  });
});

describe('safe/unsafe verdict ownership', () => {
  const normativeCase = {
    decisionRole: 'normative',
    kind: 'vitest',
    testName: 'normative property',
  };

  it('labels only a selected normative assertion failure unsafe', () => {
    const stdout = JSON.stringify({
      testResults: [{ assertionResults: [{ status: 'failed', title: 'normative property' }] }],
    });
    expect(
      classifySecurityFuzzFailure(normativeCase, { error: undefined, stderr: '', stdout }),
    ).toEqual({
      classification: 'normative-property-violation',
      safetyVerdict: 'unsafe',
    });
  });

  it('keeps differential, mutation, timeout, and reporter failures verdict-neutral', () => {
    expect(
      classifySecurityFuzzFailure(
        { ...normativeCase, decisionRole: 'differential-triage' },
        { error: undefined, stderr: '', stdout: '' },
      ),
    ).toMatchObject({
      classification: 'cross-implementation-disagreement-triage',
      safetyVerdict: 'undetermined',
    });
    expect(
      classifySecurityFuzzFailure(
        { decisionRole: 'normative', kind: 'mutation-harness' },
        {
          error: undefined,
          mutationScore: { survivors: 1 },
          stderr: '',
          stdout: '',
        },
      ),
    ).toMatchObject({ classification: 'mutation-survivor', safetyVerdict: 'undetermined' });
    expect(
      classifySecurityFuzzFailure(normativeCase, {
        error: 'case exceeded budget',
        stderr: '',
        stdout: '',
      }),
    ).toMatchObject({
      classification: 'campaign-infrastructure-failure',
      safetyVerdict: 'undetermined',
    });
    expect(
      classifySecurityFuzzFailure(normativeCase, {
        error: undefined,
        stderr: '',
        stdout: 'KOVO_CROSS_IMPLEMENTATION_DISAGREEMENT',
      }),
    ).toMatchObject({
      classification: 'cross-implementation-disagreement-triage',
      safetyVerdict: 'undetermined',
    });
  });
});
