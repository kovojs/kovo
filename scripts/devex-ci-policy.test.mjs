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
    expect(runnerMinutes(ci.gates, 'per-pr')).toBe(60);
    expect(runnerMinutes(ci.gates, 'nightly')).toBe(290);
  });

  it('rejects unbudgeted jobs, drifted commands, and browser use before installation', () => {
    const overspent = structuredClone(ci);
    overspent.gates[0].runnerCount = 2;
    expect(validateDevexCiPolicy(overspent, { workflowSources })).toContain(
      'per-PR DevEx gates cost 120 runner-minutes, above budget 60',
    );

    const drifted = structuredClone(ci);
    drifted.gates[0].commands[0] = 'vp exec node scripts/invented-benchmark.mjs';
    expect(validateDevexCiPolicy(drifted, { workflowSources })).toContain(
      'gates[0] workflow is missing command "vp exec node scripts/invented-benchmark.mjs"',
    );

    const browserAfterJourney = new Map(workflowSources);
    const workflow = browserAfterJourney.get('.github/workflows/devex-nightly.yml');
    browserAfterJourney.set(
      '.github/workflows/devex-nightly.yml',
      workflow.replace(
        '      - uses: ./.github/actions/playwright-install\n      - run: vp exec node scripts/golden-journey.mjs',
        '      - run: vp exec node scripts/golden-journey.mjs\n      - uses: ./.github/actions/playwright-install',
      ),
    );
    expect(validateDevexCiPolicy(ci, { workflowSources: browserAfterJourney })).toContain(
      'gates[3] must install the declared browser before its journey command',
    );
  });

  it('requires N>=5, exact statistics, reviewed targets, and no binding from the observational runner', () => {
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
      'an observational runner cannot produce binding metric ratifications',
    );
  });
});

function readJson(relative) {
  return JSON.parse(readFileSync(path.join(repoRoot, relative), 'utf8'));
}

function policyWorkflowSources(policy) {
  const byWorkflow = new Map();
  for (const gate of policy.gates) {
    const existing = byWorkflow.get(gate.workflow) ?? 'on:\n  pull_request:\njobs:\n';
    const lines = [
      `  ${gate.job}:`,
      `    # devex-gate: ${gate.id}`,
      '    runs-on: ubuntu-24.04',
      `    timeout-minutes: ${String(gate.timeoutMinutes)}`,
      '    steps:',
    ];
    if (gate.requiresBrowser) {
      lines.push('      - uses: ./.github/actions/playwright-install');
    }
    for (const command of gate.commands) lines.push(`      - run: ${command}`);
    if (gate.prVisible) {
      lines.push(
        '      - run: vp exec node scripts/report.mjs --github-summary "$GITHUB_STEP_SUMMARY"',
      );
    }
    byWorkflow.set(gate.workflow, `${existing}${lines.join('\n')}\n`);
  }
  return byWorkflow;
}
