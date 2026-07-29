import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  runnerMinutes,
  validateDevexBaselinePolicy,
  validateDevexCiPolicy,
} from './devex-ci-policy.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const ci = readJson('devex-ci-policy.json');
const baseline = readJson('devex-baseline-policy.json');
const budgets = readJson('devex-budgets.json');
const workflowSources = policyWorkflowSources(ci);

describe('DevEx CI and baseline policy', () => {
  it('keeps every gate mapped and below the explicit per-PR/nightly runner-minute caps', () => {
    expect(validateDevexCiPolicy(ci, { workflowSources })).toEqual([]);
    expect(runnerMinutes(ci.gates, 'per-pr')).toBe(65);
    expect(runnerMinutes(ci.gates, 'nightly')).toBe(290);
  });

  it('rejects unbudgeted jobs, drifted commands, and browser use before installation', () => {
    const overspent = structuredClone(ci);
    overspent.gates.find((gate) => gate.id === 'pr-scorecard').runnerCount = 2;
    expect(validateDevexCiPolicy(overspent, { workflowSources })).toContain(
      'per-PR DevEx gates cost 125 runner-minutes, above budget 65',
    );

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
  });

  it('requires N>=5, exact statistics, reviewed targets, and an exact accepted runner', () => {
    expect(validateDevexBaselinePolicy(baseline, budgets, ci)).toEqual([]);

    const tooSmall = structuredClone(baseline);
    tooSmall.collection.sampleCount = 4;
    tooSmall.collection.command = tooSmall.collection.command.replace('--samples 5', '--samples 4');
    expect(validateDevexBaselinePolicy(tooSmall, budgets, ci)).toEqual(
      expect.arrayContaining([
        'collection.sampleCount must be at least 5',
        'collection must map to the declared nightly CI gate and exact command',
      ]),
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
      ...(gate.runWhenDependenciesFail ? ['    if: ${{ always() }}'] : []),
      '    runs-on: ubuntu-24.04',
      ...(gate.scope === 'job' ? [`    timeout-minutes: ${String(gate.timeoutMinutes)}`] : []),
      '    steps:',
    ];
    if (gate.requiresBrowser) {
      lines.push('      - uses: ./.github/actions/playwright-install');
    }
    if (['nightly-benchmark', 'nightly-packed-journeys', 'pr-scorecard'].includes(gate.id)) {
      lines.push(
        '      - run: |',
        '          printf \'%s\\n\' "${ImageOS:-unknown}" "${ImageVersion:-unknown}"',
        '          cat /etc/os-release',
        '          echo "KOVO_DEVEX_RUNNER_NAME=github-hosted-ubuntu-24.04-accepted"',
      );
    }
    for (const command of gate.commands) lines.push(`      - run: ${command}`);
    if (gate.preserveReportOnFailure) {
      lines.push(
        '      - if: always()',
        '        with:',
        `          name: ${
          gate.id === 'nightly-packed-journeys'
            ? 'kovo-devex-golden-journey'
            : 'kovo-devex-baseline'
        }`,
        ...(gate.id === 'nightly-packed-journeys'
          ? [
              '          path: ${{ runner.temp }}/kovo-devex-golden',
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
