#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot } from './release-packages.mjs';

export const DEVEX_CI_POLICY_SCHEMA = 'kovo-devex-ci-policy/v1';
export const DEVEX_BASELINE_POLICY_SCHEMA = 'kovo-devex-baseline-policy/v1';

const CADENCES = new Set(['per-pr', 'nightly', 'manual']);

export function validateDevexCiPolicy(policy, options = {}) {
  const findings = [];
  if (policy?.schema !== DEVEX_CI_POLICY_SCHEMA) {
    findings.push(`schema must be ${DEVEX_CI_POLICY_SCHEMA}`);
  }
  for (const [field, value] of [
    ['perPullRequestRunnerMinutes', policy?.budgets?.perPullRequestRunnerMinutes],
    ['nightlyRunnerMinutes', policy?.budgets?.nightlyRunnerMinutes],
  ]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 1_000) {
      findings.push(`budgets.${field} must be an integer from 1 through 1000`);
    }
  }
  if (!Array.isArray(policy?.gates) || policy.gates.length === 0) {
    findings.push('gates must be a non-empty array');
    return findings;
  }
  const ids = new Set();
  const jobs = new Set();
  const workflowSources = new Map();
  for (const [index, gate] of policy.gates.entries()) {
    const label = `gates[${index}]`;
    if (!/^[a-z][a-z0-9-]+$/u.test(gate?.id ?? '')) {
      findings.push(`${label}.id must be a stable kebab-case ID`);
    } else if (ids.has(gate.id)) {
      findings.push(`${label}.id is duplicated`);
    } else {
      ids.add(gate.id);
    }
    if (!CADENCES.has(gate?.cadence)) findings.push(`${label}.cadence is invalid`);
    if (!canonicalWorkflowPath(gate?.workflow)) {
      findings.push(`${label}.workflow must be a canonical .github/workflows YAML path`);
    }
    if (!/^[a-z][a-z0-9-]+$/u.test(gate?.job ?? '')) {
      findings.push(`${label}.job must be a stable workflow job ID`);
    }
    const jobKey = `${gate?.workflow}\0${gate?.job}`;
    if (jobs.has(jobKey)) findings.push(`${label} duplicates a workflow job`);
    jobs.add(jobKey);
    if (
      !Number.isSafeInteger(gate?.timeoutMinutes) ||
      gate.timeoutMinutes < 1 ||
      gate.timeoutMinutes > 240
    ) {
      findings.push(`${label}.timeoutMinutes must be an integer from 1 through 240`);
    }
    if (!Number.isSafeInteger(gate?.runnerCount) || gate.runnerCount < 1 || gate.runnerCount > 20) {
      findings.push(`${label}.runnerCount must be an integer from 1 through 20`);
    }
    if (
      !Array.isArray(gate?.commands) ||
      gate.commands.length === 0 ||
      gate.commands.some((command) => typeof command !== 'string' || command.trim().length < 8)
    ) {
      findings.push(`${label}.commands must contain bounded executable commands`);
    }
    if (typeof gate?.prVisible !== 'boolean') findings.push(`${label}.prVisible must be boolean`);
    if (gate?.cadence === 'per-pr' && gate?.prVisible !== true) {
      findings.push(`${label} per-PR gate must publish PR-visible evidence`);
    }
    if (gate?.requiresBrowser !== undefined && gate.requiresBrowser !== true) {
      findings.push(`${label}.requiresBrowser may only be true when present`);
    }
    if (!canonicalWorkflowPath(gate?.workflow)) continue;
    let source = workflowSources.get(gate.workflow);
    if (source === undefined) {
      source = workflowSource(gate.workflow, options);
      workflowSources.set(gate.workflow, source);
    }
    if (source === null) {
      findings.push(`${label}.workflow cannot be resolved`);
      continue;
    }
    const segment = gateSegment(source, gate);
    if (segment === null) {
      findings.push(`${label} has no unique # devex-gate marker under job ${gate.job}`);
      continue;
    }
    if (!segment.includes(`timeout-minutes: ${String(gate.timeoutMinutes)}`)) {
      findings.push(`${label} workflow timeout does not match policy`);
    }
    if (!segment.includes('runs-on: ubuntu-24.04')) {
      findings.push(`${label} must pin ubuntu-24.04 rather than ubuntu-latest`);
    }
    for (const command of gate.commands ?? []) {
      if (!segment.includes(command)) {
        findings.push(`${label} workflow is missing command ${JSON.stringify(command)}`);
      }
    }
    if (gate.prVisible && !segment.includes('$GITHUB_STEP_SUMMARY')) {
      findings.push(`${label} must write its bounded report to GITHUB_STEP_SUMMARY`);
    }
    if (gate.requiresBrowser) {
      const browserAction = segment.indexOf('./.github/actions/playwright-install');
      const journey = segment.indexOf(gate.commands[0]);
      if (browserAction === -1 || journey === -1 || browserAction > journey) {
        findings.push(`${label} must install the declared browser before its journey command`);
      }
    }
  }
  const perPr = runnerMinutes(policy.gates, 'per-pr');
  const nightly = runnerMinutes(policy.gates, 'nightly');
  if (perPr > policy?.budgets?.perPullRequestRunnerMinutes) {
    findings.push(
      `per-PR DevEx gates cost ${String(perPr)} runner-minutes, above budget ${String(policy?.budgets?.perPullRequestRunnerMinutes)}`,
    );
  }
  if (nightly > policy?.budgets?.nightlyRunnerMinutes) {
    findings.push(
      `nightly DevEx gates cost ${String(nightly)} runner-minutes, above budget ${String(policy?.budgets?.nightlyRunnerMinutes)}`,
    );
  }
  return findings;
}

export function validateDevexBaselinePolicy(policy, budgets, ciPolicy) {
  const findings = [];
  if (policy?.schema !== DEVEX_BASELINE_POLICY_SCHEMA) {
    findings.push(`baseline schema must be ${DEVEX_BASELINE_POLICY_SCHEMA}`);
  }
  if (policy?.status !== budgets?.runner?.status || policy?.status !== budgets?.workload?.status) {
    findings.push('baseline status must match both budget runner and workload status');
  }
  if (
    !['pinned-reference', 'github-hosted-observational'].includes(policy?.referenceRunner?.kind)
  ) {
    findings.push('referenceRunner.kind is invalid');
  }
  if (typeof policy?.referenceRunner?.binding !== 'boolean') {
    findings.push('referenceRunner.binding must be boolean');
  }
  if (
    typeof policy?.referenceRunner?.rationale !== 'string' ||
    policy.referenceRunner.rationale.trim().length < 40
  ) {
    findings.push('referenceRunner.rationale must be substantive');
  }
  const requiredSamples = budgets?.procedure?.minimumStatisticalSamples;
  if (
    !Number.isSafeInteger(policy?.collection?.sampleCount) ||
    policy.collection.sampleCount < requiredSamples
  ) {
    findings.push(`collection.sampleCount must be at least ${String(requiredSamples)}`);
  }
  if (
    policy?.collection?.statistic !== budgets?.procedure?.statistic ||
    policy?.collection?.noiseStatistic !== budgets?.procedure?.noiseStatistic
  ) {
    findings.push('collection statistics must match the budget procedure');
  }
  if (
    !String(policy?.collection?.command ?? '').includes(
      `--samples ${String(policy?.collection?.sampleCount)}`,
    )
  ) {
    findings.push('collection.command must bind its declared sample count');
  }
  const gate = ciPolicy?.gates?.find((candidate) => candidate.id === policy?.collection?.gateId);
  if (
    !gate ||
    gate.cadence !== 'nightly' ||
    gate.workflow !== policy?.collection?.workflow ||
    !gate.commands.includes(policy?.collection?.command)
  ) {
    findings.push('collection must map to the declared nightly CI gate and exact command');
  }
  if (
    policy?.ratification?.proposalSchema !== 'kovo-devex-budget-proposal/v5' ||
    policy?.ratification?.requiresExactRunnerFingerprint !== true ||
    policy?.ratification?.requiresHumanTargetRationale !== true ||
    policy?.ratification?.thresholdFormula !== budgets?.procedure?.thresholdFormula ||
    !String(policy?.ratification?.command ?? '').includes('--ratify') ||
    !String(policy?.ratification?.command ?? '').includes('--proposal')
  ) {
    findings.push('ratification must preserve the fail-closed reviewed v5 procedure');
  }
  if (!Array.isArray(policy?.blockers) || policy.blockers.some((item) => item.length < 40)) {
    findings.push('blockers must be a substantive array');
  }
  const runnerBoundRatifications = Object.values(budgets?.metrics ?? {}).filter(
    (metric) => metric?.ratification !== null && metric?.binding !== 'packed-artifact',
  );
  if (policy?.referenceRunner?.binding === false && runnerBoundRatifications.length > 0) {
    findings.push('an observational runner cannot produce runner-bound metric ratifications');
  }
  return findings;
}

export function runnerMinutes(gates, cadence) {
  return gates
    .filter((gate) => gate.cadence === cadence)
    .reduce((total, gate) => total + gate.timeoutMinutes * gate.runnerCount, 0);
}

function workflowSource(relative, options) {
  if (options.workflowSources?.has(relative)) return options.workflowSources.get(relative);
  const root = path.resolve(options.repoRoot ?? repoRoot);
  const absolute = path.resolve(root, relative);
  if (absolute === root || !absolute.startsWith(`${root}${path.sep}`) || !existsSync(absolute)) {
    return null;
  }
  return readFileSync(absolute, 'utf8');
}

function gateSegment(source, gate) {
  const lines = source.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === `  ${gate.job}:`);
  if (start === -1) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/u.test(lines[index])) {
      end = index;
      break;
    }
  }
  const jobSource = lines.slice(start, end).join('\n');
  const marker = `# devex-gate: ${gate.id}`;
  return jobSource.split(marker).length === 2 ? jobSource : null;
}

function canonicalWorkflowPath(value) {
  return (
    typeof value === 'string' &&
    /^\.github\/workflows\/[a-z0-9][a-z0-9-]*\.ya?ml$/u.test(value) &&
    path.posix.normalize(value) === value
  );
}

async function main() {
  const ci = JSON.parse(readFileSync(path.join(repoRoot, 'devex-ci-policy.json'), 'utf8'));
  const baseline = JSON.parse(
    readFileSync(path.join(repoRoot, 'devex-baseline-policy.json'), 'utf8'),
  );
  const budgets = JSON.parse(readFileSync(path.join(repoRoot, 'devex-budgets.json'), 'utf8'));
  const findings = [
    ...validateDevexCiPolicy(ci, { repoRoot }),
    ...validateDevexBaselinePolicy(baseline, budgets, ci),
  ];
  if (findings.length > 0) {
    process.stderr.write(`${findings.join('\n')}\n`);
    return 1;
  }
  process.stdout.write(
    `${DEVEX_CI_POLICY_SCHEMA} per-pr=${String(runnerMinutes(ci.gates, 'per-pr'))}/${String(ci.budgets.perPullRequestRunnerMinutes)} nightly=${String(runnerMinutes(ci.gates, 'nightly'))}/${String(ci.budgets.nightlyRunnerMinutes)} baseline=${baseline.status} samples=${String(baseline.collection.sampleCount)}\n`,
  );
  return 0;
}

if (isMainEntry(import.meta.url)) await runGate(main);
