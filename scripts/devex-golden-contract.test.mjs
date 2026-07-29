import { describe, expect, it } from 'vitest';

import {
  createRunnerFingerprint,
  evaluateBudgets,
  ratifyBudgets,
  validateBudgets,
} from './devex-benchmark.mjs';
import {
  DEVEX_GOLDEN_PHASE_CONTRACT,
  DEVEX_GOLDEN_RELEASE_REPORT_SCHEMA,
  buildGoldenReleaseScorecard,
  validateGoldenReleaseScorecard,
} from './devex-golden-contract.mjs';

const runner = createRunnerFingerprint({
  name: 'github-hosted-ubuntu-24.04-accepted',
  platform: 'linux',
  arch: 'x64',
  node: 'v24.18.0',
  cpuModel: 'fixture-cpu',
  packageManager: 'pnpm@10.12.1',
  osImage: `github-actions/ubuntu-24.04@sha256:${'a'.repeat(64)}`,
});

describe('golden release evidence contract', () => {
  it('projects exact dual-dialect install and ready samples beside the offline agent proof', () => {
    const report = releaseReport(1);

    expect(report.schema).toBe(DEVEX_GOLDEN_RELEASE_REPORT_SCHEMA);
    expect(validateGoldenReleaseScorecard(report)).toEqual([]);
    expect(report.metrics).toMatchObject({
      'create.install.cold.durationMs': { samples: [100, 101], unit: 'ms' },
      'create.install.installedBytes': { samples: [1_000, 1_001], unit: 'bytes' },
      'dev.ready.cold.durationMs': { samples: [10, 11], unit: 'ms' },
      'dev.ready.warm.durationMs': { samples: [5, 6], unit: 'ms' },
    });
    expect(report.agent.network).toMatchObject({
      loopback: 'denied',
      mode: 'deny',
      packageManagerOffline: true,
    });
  });

  it('rejects missing warm readiness, forged samples, and an online agent', () => {
    const missingWarm = structuredClone(releaseReport(1));
    missingWarm.packedApps.variants[0].phases = missingWarm.packedApps.variants[0].phases.filter(
      (phase) => phase.name !== 'ready-warm',
    );
    expect(validateGoldenReleaseScorecard(missingWarm)).toContain(
      'report.packedApps.variants[0] must retain the exact successful phase contract',
    );

    const forgedMetric = structuredClone(releaseReport(1));
    forgedMetric.metrics['dev.ready.cold.durationMs'].samples[0] = 1;
    expect(validateGoldenReleaseScorecard(forgedMetric)).toContain(
      'report.metrics must project exact packed journey observations',
    );

    const online = structuredClone(releaseReport(1));
    online.agent.network.mode = 'audit';
    expect(validateGoldenReleaseScorecard(online)).toContain(
      'report.agent did not prove strict offline execution',
    );

    const duplicateDialect = structuredClone(releaseReport(1));
    duplicateDialect.packedApps.variants[1].dialect = 'postgres';
    expect(validateGoldenReleaseScorecard(duplicateDialect)).toContain(
      'report.packedApps must bind one postgres and one sqlite variant for every sample',
    );

    const mismatchedRunner = structuredClone(releaseReport(1));
    mismatchedRunner.provenance.osImage = `github-actions/ubuntu-24.04@sha256:${'e'.repeat(64)}`;
    expect(validateGoldenReleaseScorecard(mismatchedRunner)).toContain(
      'report.provenance must match the named runner fingerprint',
    );
  });

  it('keeps journey budgets source-scoped and requires N>=5 before they can bind', () => {
    const baseline = releaseReport(5);
    const budgets = budgetFixture();
    const baselineBytes = Buffer.from(`${JSON.stringify(baseline, null, 2)}\n`);
    const baselinePath = 'baselines/golden-release-fixture.json';
    const proposal = {
      schema: 'kovo-devex-budget-proposal/v6',
      runnerFingerprint: runner,
      metrics: {
        'create.install.cold.durationMs': {
          budget: 1_000,
          noiseMultiplier: 2,
          targetRationale: 'Keep packed cold installation inside the reviewed evaluator budget.',
        },
        'create.install.installedBytes': {
          budget: 2_000,
          noiseMultiplier: 0,
          targetRationale: 'Bound the exact installed dependency tree for both starter dialects.',
        },
        'dev.ready.cold.durationMs': {
          budget: 100,
          noiseMultiplier: 2,
          targetRationale: 'Keep packed cold readiness inside the first-run evaluator target.',
        },
        'dev.ready.warm.durationMs': {
          budget: 50,
          noiseMultiplier: 2,
          targetRationale: 'Keep packed warm readiness inside the ordinary edit-loop target.',
        },
      },
    };

    const ratified = ratifyBudgets(budgets, baseline, proposal, {
      baselineReportBytes: baselineBytes,
      baselineReportPath: baselinePath,
    });
    const provenance = {
      baselineReports: new Map([[baselinePath, baselineBytes]]),
    };

    expect(ratified.runner).toEqual({ status: 'unratified', fingerprint: null });
    expect(ratified.workload).toEqual({ status: 'unratified', identity: null });
    expect(validateBudgets(ratified, provenance)).toEqual([]);
    expect(evaluateBudgets(ratified, baseline, provenance).pass).toBe(true);

    const anotherRunner = structuredClone(baseline);
    anotherRunner.runner.cpuModel = 'different-cpu';
    anotherRunner.runner = createRunnerFingerprint(anotherRunner.runner);
    const evaluation = evaluateBudgets(ratified, anotherRunner, provenance);
    expect(evaluation.pass).toBe(false);
    expect(
      evaluation.results.find((result) => result.metric === 'dev.ready.cold.durationMs'),
    ).toMatchObject({ status: 'runner-mismatch' });
  });
});

function releaseReport(sampleCount) {
  const packageNames = [
    '@kovojs/better-auth',
    '@kovojs/browser',
    '@kovojs/cli',
    '@kovojs/compiler',
    '@kovojs/core',
    '@kovojs/drizzle',
    '@kovojs/headless-ui',
    '@kovojs/icons',
    '@kovojs/server',
    '@kovojs/style',
    '@kovojs/test',
    '@kovojs/ui',
    '@kovojs/verify',
    'create-kovo',
  ];
  const packageSet = packageNames.map((name) => ({
    name,
    sha512: 'sha512-YQ==',
    version: '0.2.0',
  }));
  const variants = [];
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    for (const [dialectIndex, dialect] of ['postgres', 'sqlite'].entries()) {
      const offset = sampleIndex * 2 + dialectIndex;
      variants.push({
        schema: 'kovo.golden-journey/packed-app/v1',
        dialect,
        sampleIndex,
        pass: true,
        phases: DEVEX_GOLDEN_PHASE_CONTRACT.app.map((name) => ({
          durationMs:
            name === 'ready' ? 10 + offset : name === 'ready-warm' ? 5 + offset : 1 + offset,
          name,
          status: 0,
        })),
        install: {
          durationMs: 100 + offset,
          installedBytes: 1_000 + offset,
          installedFiles: 10,
          directProductionDependencies: 5,
          transitiveProductionDependencies: 5,
        },
        concepts: { counts: { environmentEdits: 0 } },
        buildPosture: {
          schema: 'kovo.golden-journey/build-posture/v1',
          configPath: 'kovo.config.ts',
          kind: 'controlled-retained-local-fixture',
          retention: {
            hours: 24,
            immutableClientModules: 'retained',
            priorTokenQueryReads: 'retained',
          },
        },
        styledUi: {
          bytes: 1_024,
          path: `evidence/${dialect}-${String(sampleIndex + 1)}/styled-ui.png`,
          sha256: `sha256:${'d'.repeat(64)}`,
          styled: {
            buttonBackground: 'rgb(0, 0, 0)',
            fontFamily: 'Inter',
            styleSheets: 1,
            styledSourceElements: 1,
          },
        },
        accessibility: {
          schema: 'kovo.golden-journey/accessibility/v1',
          states: [
            { name: 'login', violations: [] },
            { name: 'authenticated-crud', violations: [] },
          ],
          violations: 0,
        },
        failure: null,
      });
    }
  }
  const packedApps = {
    schema: 'kovo.golden-journey/packed-apps/v1',
    scenario: 'packed-apps',
    sampleCount,
    dialects: ['postgres', 'sqlite'],
    packageSet,
    variants,
    pass: true,
  };
  const agent = {
    schema: 'kovo.golden-journey/offline-agent/v1',
    scenario: 'offline-agent',
    pass: true,
    phases: DEVEX_GOLDEN_PHASE_CONTRACT.agent.map((name) => ({
      durationMs: 1,
      name,
      status: 0,
    })),
    network: {
      allowlist: [],
      loopback: 'denied',
      mode: 'deny',
      packageManagerOffline: true,
    },
  };
  return buildGoldenReleaseScorecard({
    agent,
    environment: {
      sourceCommit: 'b'.repeat(40),
      sourceTree: 'clean',
      packageManager: runner.packageManager,
      osImage: runner.osImage,
    },
    manifestSha256: `sha256:${'c'.repeat(64)}`,
    packedApps,
    runner,
  });
}

function budgetFixture() {
  const budgets = structuredClone(
    JSON.parse(globalThis.process.getBuiltinModule('node:fs').readFileSync('devex-budgets.json')),
  );
  for (const metric of Object.values(budgets.metrics)) metric.ratification = null;
  return budgets;
}
