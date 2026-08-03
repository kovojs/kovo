import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  createRatifiedDevexBaselinePolicyCandidate,
  runnerMinutes,
  validateDevexBaselinePolicy,
  validateDevexCiPolicy,
  validateDevexRatificationCandidateCensus,
  validateRatifiedDevexBaselinePolicyCandidate,
} from './devex-ci-policy.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const ci = readJson('devex-ci-policy.json');
const baseline = readJson('devex-baseline-policy.json');
const budgets = readJson('devex-budgets.json');
const workflowSources = policyWorkflowSources(ci);

describe('DevEx CI and baseline policy', () => {
  it('keeps every gate mapped and below the explicit per-PR/nightly runner-minute caps', () => {
    expect(validateDevexCiPolicy(ci, { workflowSources })).toEqual([]);
    expect(runnerMinutes(ci.gates, 'per-pr')).toBe(147);
    expect(runnerMinutes(ci.gates, 'nightly')).toBe(290);
    expect(runnerMinutes(ci.gates, 'manual')).toBe(240);
  });

  it('rejects unbudgeted jobs, drifted commands, and browser use before installation', () => {
    const overspent = structuredClone(ci);
    overspent.gates.find((gate) => gate.id === 'pr-scorecard').runnerCount = 2;
    expect(validateDevexCiPolicy(overspent, { workflowSources })).toContain(
      'per-PR DevEx gates cost 207 runner-minutes, above budget 147',
    );

    const underdeclaredTimeout = structuredClone(ci);
    underdeclaredTimeout.gates.find((gate) => gate.id === 'pr-known-failures').budgetMinutes = 86;
    expect(
      validateDevexCiPolicy(underdeclaredTimeout, {
        workflowSources: policyWorkflowSources(underdeclaredTimeout),
      }),
    ).toContain('gates[0] step budget must be enforced by its exact timeout command');

    const drifted = structuredClone(ci);
    drifted.gates.find((gate) => gate.id === 'pr-scorecard').commands[0] =
      'vp exec node scripts/invented-benchmark.mjs';
    expect(validateDevexCiPolicy(drifted, { workflowSources })).toContain(
      'gates[1] workflow is missing command "vp exec node scripts/invented-benchmark.mjs"',
    );

    const browserAfterJourney = new Map(workflowSources);
    const workflow = browserAfterJourney.get('.github/workflows/devex-nightly.yml');
    const journeyCommand = ci.gates.find((gate) => gate.id === 'nightly-packed-journeys')
      .commands[0];
    browserAfterJourney.set(
      '.github/workflows/devex-nightly.yml',
      workflow
        .replace('      - uses: ./.github/actions/playwright-install\n', '')
        .replace(
          `      - run: ${journeyCommand}`,
          `      - run: ${journeyCommand}\n      - uses: ./.github/actions/playwright-install`,
        ),
    );
    expect(validateDevexCiPolicy(ci, { workflowSources: browserAfterJourney })).toContain(
      'gates[4] must install the declared browser before its journey command',
    );

    const unnamedRunner = new Map(workflowSources);
    unnamedRunner.set(
      '.github/workflows/devex-nightly.yml',
      unnamedRunner
        .get('.github/workflows/devex-nightly.yml')
        .replace(
          'KOVO_DEVEX_RUNNER_NAME=github-hosted-ubuntu-24.04-accepted',
          'KOVO_DEVEX_RUNNER_NAME=unreviewed-runner',
        ),
    );
    expect(validateDevexCiPolicy(ci, { workflowSources: unnamedRunner })).toContain(
      'gates[3] must identify the exact accepted hosted-runner fingerprint',
    );

    const deleted = structuredClone(ci);
    deleted.gates = deleted.gates.filter((gate) => gate.id !== 'nightly-full-catalog');
    expect(validateDevexCiPolicy(deleted, { workflowSources })).toContain(
      'gates must retain required DevEx gate nightly-full-catalog',
    );

    const releaseBypass = structuredClone(ci);
    delete releaseBypass.gates.find((gate) => gate.id === 'nightly-benchmark').releaseRequired;
    expect(validateDevexCiPolicy(releaseBypass, { workflowSources })).toContain(
      'releaseAuthority must cover every nightly DevEx gate',
    );

    const partialJourney = structuredClone(ci);
    partialJourney.gates.find((gate) => gate.id === 'nightly-packed-journeys').commands = [
      'vp exec node scripts/golden-journey.mjs --scenario packed-apps --samples 1',
    ];
    expect(validateDevexCiPolicy(partialJourney, { workflowSources })).toContain(
      'gates[4] must bind both packed starters and the offline agent to one retained N>=5 release scorecard',
    );

    const discardedJourney = structuredClone(ci);
    delete discardedJourney.gates.find((gate) => gate.id === 'nightly-packed-journeys')
      .preserveReportOnFailure;
    expect(validateDevexCiPolicy(discardedJourney, { workflowSources })).toContain(
      'gates[4] must bind both packed starters and the offline agent to one retained N>=5 release scorecard',
    );

    const nonBindingBenchmark = structuredClone(ci);
    nonBindingBenchmark.gates.find((gate) => gate.id === 'nightly-benchmark').commands[1] =
      nonBindingBenchmark.gates
        .find((gate) => gate.id === 'nightly-benchmark')
        .commands[1].replace(' --require-ratified', '');
    expect(validateDevexCiPolicy(nonBindingBenchmark, { workflowSources })).toContain(
      'gates[3] must collect N>=5 and fail closed before runner budget ratification',
    );

    const tooFewCatalogSamples = structuredClone(ci);
    tooFewCatalogSamples.gates.find((gate) => gate.id === 'nightly-full-catalog').commands[0] =
      tooFewCatalogSamples.gates
        .find((gate) => gate.id === 'nightly-full-catalog')
        .commands[0].replace('--samples 5', '--samples 4');
    expect(validateDevexCiPolicy(tooFewCatalogSamples, { workflowSources })).toContain(
      'gates[5] must retain five authenticated all-44 RSS samples and redacted failures',
    );

    const discardedCatalogReport = structuredClone(ci);
    delete discardedCatalogReport.gates.find((gate) => gate.id === 'nightly-full-catalog')
      .preserveReportOnFailure;
    expect(validateDevexCiPolicy(discardedCatalogReport, { workflowSources })).toContain(
      'gates[5] must retain five authenticated all-44 RSS samples and redacted failures',
    );

    const partialTransaction = structuredClone(ci);
    partialTransaction.gates.find((gate) => gate.id === 'manual-hosted-ratification').commands[4] =
      partialTransaction.gates
        .find((gate) => gate.id === 'manual-hosted-ratification')
        .commands[4].replace(
          ' --baseline-record-path baselines/devex-hosted-full-catalog-v1.json',
          '',
        );
    expect(validateDevexCiPolicy(partialTransaction, { workflowSources })).toContain(
      'gates[6] must collect one-runner N=5 benchmark, golden, and full-catalog evidence before one clean transactional budget write',
    );

    const dirtyAudit = new Map(workflowSources);
    dirtyAudit.set(
      '.github/workflows/devex-nightly.yml',
      dirtyAudit
        .get('.github/workflows/devex-nightly.yml')
        .replace('      - run: test -z "$(git status --porcelain=v1 --untracked-files=all)"\n', ''),
    );
    expect(validateDevexCiPolicy(ci, { workflowSources: dirtyAudit })).toContain(
      'gates[6] must collect one-runner N=5 benchmark, golden, and full-catalog evidence before one clean transactional budget write',
    );

    const tooFewAuditSamples = structuredClone(ci);
    tooFewAuditSamples.gates.find((gate) => gate.id === 'manual-hosted-ratification').commands[1] =
      tooFewAuditSamples.gates
        .find((gate) => gate.id === 'manual-hosted-ratification')
        .commands[1].replace('--samples 5', '--samples 4');
    expect(validateDevexCiPolicy(tooFewAuditSamples, { workflowSources })).toContain(
      'gates[6] must collect one-runner N=5 benchmark, golden, and full-catalog evidence before one clean transactional budget write',
    );

    for (const fragment of [
      'createRatifiedDevexBaselinePolicyCandidate(checkoutPolicy)',
      'git show HEAD:devex-budgets.json > "$RUNNER_TEMP/kovo-devex-ratification/inherited-devex-budgets.json"',
      'KOVO_DEVEX_INHERITED_BUDGETS: ${{ runner.temp }}/kovo-devex-ratification/inherited-devex-budgets.json',
      'vp exec node scripts/devex-benchmark.mjs --check-budgets --budgets "$KOVO_DEVEX_CANDIDATE_ROOT/devex-budgets.json" --inherited-budgets "$KOVO_DEVEX_INHERITED_BUDGETS" --inherited-provenance-root "$GITHUB_WORKSPACE"',
      'vp exec node scripts/devex-ci-policy.mjs --candidate-root "$KOVO_DEVEX_CANDIDATE_ROOT"',
      'test "$actual_status" = \' M devex-budgets.json\'',
    ]) {
      const incompleteCandidate = new Map(workflowSources);
      incompleteCandidate.set(
        '.github/workflows/devex-nightly.yml',
        incompleteCandidate.get('.github/workflows/devex-nightly.yml').replace(fragment, ''),
      );
      expect(validateDevexCiPolicy(ci, { workflowSources: incompleteCandidate })).toContain(
        'gates[6] must hand off and validate the exact five-file ratification candidate without checkout baseline writes',
      );
    }

    const checkoutBaselineWrite = new Map(workflowSources);
    checkoutBaselineWrite.set(
      '.github/workflows/devex-nightly.yml',
      checkoutBaselineWrite
        .get('.github/workflows/devex-nightly.yml')
        .replace(
          '          cp benchmark.json "$KOVO_DEVEX_CANDIDATE_ROOT/baselines/devex-hosted-benchmark-v1.json"',
          '          cp benchmark.json "$KOVO_DEVEX_CANDIDATE_ROOT/baselines/devex-hosted-benchmark-v1.json"\n          cp benchmark.json baselines/devex-hosted-benchmark-v1.json',
        ),
    );
    expect(validateDevexCiPolicy(ci, { workflowSources: checkoutBaselineWrite })).toContain(
      'gates[6] must hand off and validate the exact five-file ratification candidate without checkout baseline writes',
    );

    const lateInheritedSnapshot = new Map(workflowSources);
    const snapshot =
      'git show HEAD:devex-budgets.json > "$RUNNER_TEMP/kovo-devex-ratification/inherited-devex-budgets.json"';
    const transaction = ci.gates
      .find((gate) => gate.id === 'manual-hosted-ratification')
      .commands.find((command) => command.includes(' --ratify '));
    lateInheritedSnapshot.set(
      '.github/workflows/devex-nightly.yml',
      lateInheritedSnapshot
        .get('.github/workflows/devex-nightly.yml')
        .replace(snapshot, '')
        .replace(transaction, `${transaction}\n      - run: ${snapshot}`),
    );
    expect(validateDevexCiPolicy(ci, { workflowSources: lateInheritedSnapshot })).toContain(
      'gates[6] must collect one-runner N=5 benchmark, golden, and full-catalog evidence before one clean transactional budget write',
    );

    const earlyTransaction = new Map(workflowSources);
    const cleanCheckout = 'test -z "$(git status --porcelain=v1 --untracked-files=all)"';
    earlyTransaction.set(
      '.github/workflows/devex-nightly.yml',
      earlyTransaction
        .get('.github/workflows/devex-nightly.yml')
        .replace(cleanCheckout, '')
        .replace(transaction, `${transaction}\n      - run: ${cleanCheckout}`),
    );
    expect(validateDevexCiPolicy(ci, { workflowSources: earlyTransaction })).toContain(
      'gates[6] must collect one-runner N=5 benchmark, golden, and full-catalog evidence before one clean transactional budget write',
    );

    const earlyCandidateValidation = new Map(workflowSources);
    const candidateValidation =
      'vp exec node scripts/devex-benchmark.mjs --check-budgets --budgets "$KOVO_DEVEX_CANDIDATE_ROOT/devex-budgets.json" --inherited-budgets "$KOVO_DEVEX_INHERITED_BUDGETS" --inherited-provenance-root "$GITHUB_WORKSPACE"';
    earlyCandidateValidation.set(
      '.github/workflows/devex-nightly.yml',
      earlyCandidateValidation
        .get('.github/workflows/devex-nightly.yml')
        .replace(candidateValidation, '')
        .replace(transaction, `${candidateValidation}\n      - run: ${transaction}`),
    );
    expect(validateDevexCiPolicy(ci, { workflowSources: earlyCandidateValidation })).toContain(
      'gates[6] must collect one-runner N=5 benchmark, golden, and full-catalog evidence before one clean transactional budget write',
    );
  });

  it('reconciles only ratification posture and requires the complete regular-file candidate', () => {
    const candidate = createRatifiedDevexBaselinePolicyCandidate(baseline);
    expect(candidate).toEqual({
      ...baseline,
      status: 'ratified',
      blockers: [],
    });
    expect(validateRatifiedDevexBaselinePolicyCandidate(baseline, candidate)).toEqual([]);

    const drifted = structuredClone(candidate);
    drifted.collection.baselineSampleCount = 6;
    expect(validateRatifiedDevexBaselinePolicyCandidate(baseline, drifted)).toEqual([
      'candidate baseline policy must differ from checkout only by status=ratified and blockers=[]',
    ]);
    expect(validateRatifiedDevexBaselinePolicyCandidate(baseline, baseline)).toEqual([
      'candidate baseline policy must differ from checkout only by status=ratified and blockers=[]',
    ]);

    const candidateRoot = mkdtempSync(path.join(os.tmpdir(), 'kovo-devex-candidate-'));
    try {
      mkdirSync(path.join(candidateRoot, 'baselines'));
      for (const relative of [
        'baselines/devex-hosted-benchmark-v1.json',
        'baselines/devex-hosted-full-catalog-v1.json',
        'baselines/devex-hosted-golden-journey-v1.json',
        'devex-baseline-policy.json',
        'devex-budgets.json',
      ]) {
        writeFileSync(path.join(candidateRoot, relative), '{}\n');
      }
      expect(validateDevexRatificationCandidateCensus(candidateRoot)).toEqual([]);

      writeFileSync(path.join(candidateRoot, 'unexpected.json'), '{}\n');
      expect(validateDevexRatificationCandidateCensus(candidateRoot)).toContain(
        'ratification candidate must contain exactly baselines/devex-hosted-benchmark-v1.json, baselines/devex-hosted-full-catalog-v1.json, baselines/devex-hosted-golden-journey-v1.json, devex-baseline-policy.json, devex-budgets.json',
      );
      rmSync(path.join(candidateRoot, 'unexpected.json'));
      mkdirSync(path.join(candidateRoot, 'unexpected'));
      expect(validateDevexRatificationCandidateCensus(candidateRoot)).toContain(
        'ratification candidate must contain only the baselines directory',
      );
      rmSync(path.join(candidateRoot, 'unexpected'), { recursive: true });
      rmSync(path.join(candidateRoot, 'devex-baseline-policy.json'));
      symlinkSync(
        path.join(candidateRoot, 'devex-budgets.json'),
        path.join(candidateRoot, 'devex-baseline-policy.json'),
      );
      expect(validateDevexRatificationCandidateCensus(candidateRoot)).toContain(
        'ratification candidate entry must not be a symbolic link: devex-baseline-policy.json',
      );
    } finally {
      rmSync(candidateRoot, { recursive: true, force: true });
    }
  });

  it('requires N>=5, exact statistics, reviewed targets, and an exact accepted runner', () => {
    expect(validateDevexBaselinePolicy(baseline, budgets, ci)).toEqual([]);
    expect(baseline.referenceRunner.machineClass).toMatchObject({
      repositoryVisibility: 'public',
      label: 'ubuntu-24.04',
      vcpus: 4,
      memoryBytes: 16 * 1024 * 1024 * 1024,
      ephemeralStorageBytes: 14 * 1024 * 1024 * 1024,
    });
    expect(baseline.collection).toMatchObject({
      baselineSampleCount: 5,
      evaluationSampleCount: 5,
    });
    expect(baseline.fullCatalogCollection).toMatchObject({
      artifact: 'kovo-devex-full-catalog',
      reportSchema: 'kovo-devex-full-catalog/v1',
      sampleCount: 5,
      workloadSchema: 'kovo-devex-full-catalog-workload/v1',
    });
    expect(baseline.ratification.noiseMultipliers).toEqual({
      deterministic: 0,
      statistical: 3,
    });
    expect(baseline.ratification).toMatchObject({
      atomicBudgetWrite: true,
      dispatchInput: 'ratify_hosted_budgets',
      requiresExactCleanSourceRevision: true,
      requiresExactRunnerFingerprint: true,
      sampleCount: 5,
    });
    const runnerBoundMetricIds = Object.entries(budgets.metrics)
      .filter(
        ([, metric]) =>
          ['benchmark', 'golden-journey', 'full-catalog'].includes(metric.source) &&
          metric.binding !== 'packed-artifact',
      )
      .map(([metricId]) => metricId);
    const proposedMetricIds = Object.values(baseline.ratification.targetProposals).flatMap(
      (metrics) => Object.keys(metrics),
    );
    expect(runnerBoundMetricIds).toHaveLength(14);
    expect(proposedMetricIds.toSorted()).toEqual(runnerBoundMetricIds.toSorted());
    expect(
      runnerBoundMetricIds.every((metricId) =>
        Number.isFinite(budgets.metrics[metricId].provisionalTarget),
      ),
    ).toBe(true);

    const tooSmall = structuredClone(baseline);
    tooSmall.collection.baselineSampleCount = 4;
    tooSmall.collection.evaluationSampleCount = 4;
    tooSmall.collection.command = tooSmall.collection.command.replace('--samples 5', '--samples 4');
    expect(validateDevexBaselinePolicy(tooSmall, budgets, ci)).toEqual(
      expect.arrayContaining([
        'collection.baselineSampleCount must be at least 5',
        'collection.evaluationSampleCount must be at least 5',
        'collection must map to the declared nightly CI gate and exact command',
      ]),
    );

    const tooFewCatalogSamples = structuredClone(baseline);
    tooFewCatalogSamples.fullCatalogCollection.sampleCount = 4;
    tooFewCatalogSamples.fullCatalogCollection.command =
      tooFewCatalogSamples.fullCatalogCollection.command.replace('--samples 5', '--samples 4');
    expect(validateDevexBaselinePolicy(tooFewCatalogSamples, budgets, ci)).toContain(
      'fullCatalogCollection must bind N>=5 authenticated retained evidence to KF-DEVEX-007 retirement',
    );

    const weakenedCatalogRetirement = structuredClone(baseline);
    weakenedCatalogRetirement.fullCatalogCollection.retirementCondition =
      'The catalog command ran.';
    expect(validateDevexBaselinePolicy(weakenedCatalogRetirement, budgets, ci)).toContain(
      'fullCatalogCollection must bind N>=5 authenticated retained evidence to KF-DEVEX-007 retirement',
    );

    const prematurelyRatified = structuredClone(budgets);
    prematurelyRatified.metrics['check.cold.durationMs'].ratification = {};
    expect(validateDevexBaselinePolicy(baseline, prematurelyRatified, ci)).toContain(
      'an unratified baseline policy cannot contain runner-bound metric ratifications',
    );

    const journeyRatified = structuredClone(budgets);
    journeyRatified.metrics['dev.ready.cold.durationMs'].ratification = {};
    expect(validateDevexBaselinePolicy(baseline, journeyRatified, ci)).not.toContain(
      'an unratified baseline policy cannot contain runner-bound metric ratifications',
    );

    const driftedRunner = structuredClone(baseline);
    driftedRunner.referenceRunner.fingerprintInputs =
      driftedRunner.referenceRunner.fingerprintInputs.slice(1);
    expect(validateDevexBaselinePolicy(driftedRunner, budgets, ci)).toContain(
      'accepted GitHub-hosted runner must bind the exact ubuntu-24.04 fingerprint and fail closed on drift',
    );

    const driftedMachine = structuredClone(baseline);
    driftedMachine.referenceRunner.machineClass.vcpus = 8;
    expect(validateDevexBaselinePolicy(driftedMachine, budgets, ci)).toContain(
      'accepted GitHub-hosted runner must bind the exact ubuntu-24.04 fingerprint and fail closed on drift',
    );

    const driftedNoise = structuredClone(baseline);
    driftedNoise.ratification.noiseMultipliers.statistical = 5;
    expect(validateDevexBaselinePolicy(driftedNoise, budgets, ci)).toContain(
      'ratification must preserve the fail-closed reviewed v7 procedure',
    );

    const nonAtomic = structuredClone(baseline);
    nonAtomic.ratification.atomicBudgetWrite = false;
    nonAtomic.ratification.command = nonAtomic.ratification.command.replace(' --write', '');
    expect(validateDevexBaselinePolicy(nonAtomic, budgets, ci)).toContain(
      'ratification must preserve the fail-closed reviewed v7 procedure',
    );

    const droppedPair = structuredClone(baseline);
    droppedPair.ratification.command = droppedPair.ratification.command.replace(
      ' --baseline-record-path baselines/devex-hosted-full-catalog-v1.json',
      '',
    );
    expect(validateDevexBaselinePolicy(droppedPair, budgets, ci)).toContain(
      'ratification must preserve the fail-closed reviewed v7 procedure',
    );

    const inventedTarget = structuredClone(baseline);
    inventedTarget.ratification.targetProposals.benchmark['check.cold.durationMs'].budget = 1;
    expect(validateDevexBaselinePolicy(inventedTarget, budgets, ci)).toContain(
      'ratification must preserve the fail-closed reviewed v7 procedure',
    );

    const missingTargetBudget = structuredClone(budgets);
    missingTargetBudget.metrics['check.cold.peakRssBytes'].provisionalTarget = null;
    const missingTargetProposal = structuredClone(baseline);
    delete missingTargetProposal.ratification.targetProposals.benchmark['check.cold.peakRssBytes'];
    expect(validateDevexBaselinePolicy(missingTargetProposal, missingTargetBudget, ci)).toContain(
      'ratification must preserve the fail-closed reviewed v7 procedure',
    );
  });
});

function readJson(relative) {
  return JSON.parse(readFileSync(path.join(repoRoot, relative), 'utf8'));
}

function policyWorkflowSources(policy) {
  const byWorkflow = new Map();
  for (const gate of policy.gates) {
    const triggers =
      gate.cadence === 'nightly'
        ? 'name: DevEx Nightly\non:\n  schedule:\n    - cron: "0 0 * * *"\n  workflow_dispatch:\n'
        : 'name: CI\non:\n  pull_request:\n';
    const existing = byWorkflow.get(gate.workflow) ?? `${triggers}jobs:\n`;
    const lines = [
      `  ${gate.job}:`,
      `    # devex-gate: ${gate.id}`,
      ...(gate.id === 'manual-hosted-ratification'
        ? ['    if: ${{ inputs.ratify_hosted_budgets }}']
        : []),
      ...(gate.runWhenDependenciesFail ? ['    if: ${{ always() }}'] : []),
      '    runs-on: ubuntu-24.04',
      ...(gate.scope === 'job' ? [`    timeout-minutes: ${String(gate.timeoutMinutes)}`] : []),
      '    steps:',
    ];
    if (gate.requiresBrowser) {
      lines.push('      - uses: ./.github/actions/playwright-install');
    }
    if (
      [
        'nightly-benchmark',
        'nightly-full-catalog',
        'nightly-packed-journeys',
        'manual-hosted-ratification',
        'pr-scorecard',
      ].includes(gate.id)
    ) {
      lines.push(
        '      - run: |',
        '          printf \'%s\\n\' "${ImageOS:-unknown}" "${ImageVersion:-unknown}"',
        '          cat /etc/os-release',
        '          echo "KOVO_DEVEX_RUNNER_NAME=github-hosted-ubuntu-24.04-accepted"',
      );
    }
    if (gate.id === 'manual-hosted-ratification') {
      lines.push(
        '      - run: git show HEAD:devex-budgets.json > "$RUNNER_TEMP/kovo-devex-ratification/inherited-devex-budgets.json"',
      );
    }
    for (const command of gate.commands) {
      if (gate.id === 'manual-hosted-ratification' && command.includes(' --ratify ')) {
        lines.push('      - run: test -z "$(git status --porcelain=v1 --untracked-files=all)"');
      }
      lines.push(`      - run: ${command}`);
    }
    if (gate.id === 'manual-hosted-ratification') {
      lines.push(
        '      - env:',
        '          KOVO_DEVEX_CANDIDATE_ROOT: ${{ runner.temp }}/kovo-devex-ratification/candidate',
        '          KOVO_DEVEX_INHERITED_BUDGETS: ${{ runner.temp }}/kovo-devex-ratification/inherited-devex-budgets.json',
        '        run: |',
        '          cp devex-budgets.json "$KOVO_DEVEX_CANDIDATE_ROOT/devex-budgets.json"',
        '          cp benchmark.json "$KOVO_DEVEX_CANDIDATE_ROOT/baselines/devex-hosted-benchmark-v1.json"',
        '          cp golden.json "$KOVO_DEVEX_CANDIDATE_ROOT/baselines/devex-hosted-golden-journey-v1.json"',
        '          cp catalog.json "$KOVO_DEVEX_CANDIDATE_ROOT/baselines/devex-hosted-full-catalog-v1.json"',
        '          const candidatePolicy = createRatifiedDevexBaselinePolicyCandidate(checkoutPolicy)',
        "          path.join(process.env.KOVO_DEVEX_CANDIDATE_ROOT, 'devex-baseline-policy.json')",
        '          vp exec node scripts/devex-benchmark.mjs --check-budgets --budgets "$KOVO_DEVEX_CANDIDATE_ROOT/devex-budgets.json" --inherited-budgets "$KOVO_DEVEX_INHERITED_BUDGETS" --inherited-provenance-root "$GITHUB_WORKSPACE"',
        '          vp exec node scripts/devex-ci-policy.mjs --candidate-root "$KOVO_DEVEX_CANDIDATE_ROOT"',
        '          git diff --check -- devex-budgets.json',
        '          test "$actual_status" = \' M devex-budgets.json\'',
      );
    }
    if (gate.preserveReportOnFailure) {
      lines.push(
        '      - if: always()',
        '        with:',
        `          name: ${
          gate.id === 'nightly-packed-journeys'
            ? 'kovo-devex-golden-journey'
            : gate.id === 'nightly-full-catalog'
              ? 'kovo-devex-full-catalog'
              : gate.id === 'manual-hosted-ratification'
                ? 'kovo-devex-ratification-audit'
                : 'kovo-devex-baseline'
        }`,
        ...(gate.id === 'nightly-packed-journeys'
          ? [
              '          path: ${{ runner.temp }}/kovo-devex-golden',
              '          include-hidden-files: true',
            ]
          : gate.id === 'nightly-full-catalog'
            ? [
                '          path: ${{ runner.temp }}/kovo-devex-full-catalog',
                '          include-hidden-files: true',
              ]
            : gate.id === 'manual-hosted-ratification'
              ? [
                  '          path: ${{ runner.temp }}/kovo-devex-ratification',
                  '          include-hidden-files: true',
                ]
              : []),
      );
    }
    if (gate.prVisible) {
      lines.push(
        '      - run: vp exec node scripts/report.mjs --github-summary "$GITHUB_STEP_SUMMARY"',
        '      - run: |',
        `          printf '%s\\n' '${JSON.stringify({
          schema: 'kovo-devex-pr-report/v1',
          pass: false,
          error: 'report-unavailable',
        })}'`,
        '          cat "$RUNNER_TEMP/kovo-devex-pr/report.md" >> "$GITHUB_STEP_SUMMARY"',
      );
    }
    byWorkflow.set(gate.workflow, `${existing}${lines.join('\n')}\n`);
  }
  return byWorkflow;
}
