#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot } from './release-packages.mjs';

export const DEVEX_CI_POLICY_SCHEMA = 'kovo-devex-ci-policy/v2';
export const DEVEX_BASELINE_POLICY_SCHEMA = 'kovo-devex-baseline-policy/v2';

const CADENCES = new Set(['per-pr', 'nightly', 'manual']);
const GATE_SCOPES = new Set(['job', 'step']);
const REQUIRED_GATE_IDS = Object.freeze([
  'pr-known-failures',
  'pr-scorecard',
  'nightly-package-producer',
  'nightly-benchmark',
  'nightly-packed-journeys',
  'nightly-full-catalog',
]);
const HOSTED_RUNNER_FINGERPRINT_INPUTS = Object.freeze([
  'ImageOS',
  'ImageVersion',
  '/etc/os-release',
  'process.platform',
  'process.arch',
  'process.version',
  'os.cpus()[0].model',
  'packageManager',
]);

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
    if (!GATE_SCOPES.has(gate?.scope)) findings.push(`${label}.scope must be job or step`);
    if (!canonicalWorkflowPath(gate?.workflow)) {
      findings.push(`${label}.workflow must be a canonical .github/workflows YAML path`);
    }
    if (!/^[a-z][a-z0-9-]+$/u.test(gate?.job ?? '')) {
      findings.push(`${label}.job must be a stable workflow job ID`);
    }
    const jobKey = `${gate?.workflow}\0${gate?.job}`;
    if (gate?.scope === 'job') {
      if (jobs.has(jobKey)) findings.push(`${label} duplicates a budgeted workflow job`);
      jobs.add(jobKey);
      if (
        !Number.isSafeInteger(gate?.timeoutMinutes) ||
        gate.timeoutMinutes < 1 ||
        gate.timeoutMinutes > 240
      ) {
        findings.push(`${label}.timeoutMinutes must be an integer from 1 through 240`);
      }
    } else if (gate?.timeoutMinutes !== undefined) {
      findings.push(`${label}.timeoutMinutes is reserved for job-scoped gates`);
    }
    if (
      !Number.isSafeInteger(gate?.budgetMinutes) ||
      gate.budgetMinutes < 1 ||
      gate.budgetMinutes > 240
    ) {
      findings.push(`${label}.budgetMinutes must be an integer from 1 through 240`);
    } else if (gate?.scope === 'job' && gate.timeoutMinutes !== gate.budgetMinutes) {
      findings.push(`${label}.budgetMinutes must equal the enforced job timeout`);
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
    if (gate?.runWhenDependenciesFail !== undefined && gate.runWhenDependenciesFail !== true) {
      findings.push(`${label}.runWhenDependenciesFail may only be true when present`);
    }
    if (gate?.releaseRequired !== undefined && gate.releaseRequired !== true) {
      findings.push(`${label}.releaseRequired may only be true when present`);
    }
    if (gate?.preserveReportOnFailure !== undefined && gate.preserveReportOnFailure !== true) {
      findings.push(`${label}.preserveReportOnFailure may only be true when present`);
    }
    if (gate?.releaseRequired === true && gate.cadence !== 'nightly') {
      findings.push(`${label}.releaseRequired is reserved for nightly gates`);
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
    if (
      gate.scope === 'job' &&
      !segment.includes(`timeout-minutes: ${String(gate.timeoutMinutes)}`)
    ) {
      findings.push(`${label} workflow timeout does not match policy`);
    }
    if (
      gate.scope === 'step' &&
      !gate.commands.some((command) =>
        command.startsWith(`timeout ${String(gate.budgetMinutes)}m `),
      )
    ) {
      findings.push(`${label} step budget must be enforced by its exact timeout command`);
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
    if (gate.runWhenDependenciesFail === true && !segment.includes('if: ${{ always() }}')) {
      findings.push(`${label} must run when its dependencies fail`);
    }
    if (
      gate.preserveReportOnFailure === true &&
      (!segment.includes('if: always()') || !segment.includes('name: kovo-devex-baseline'))
    ) {
      findings.push(`${label} must preserve its benchmark report after a budget breach`);
    }
    if (
      ['nightly-benchmark', 'pr-scorecard'].includes(gate.id) &&
      (!segment.includes('${ImageOS:-unknown}') ||
        !segment.includes('${ImageVersion:-unknown}') ||
        !segment.includes('cat /etc/os-release') ||
        !segment.includes('KOVO_DEVEX_RUNNER_NAME=github-hosted-ubuntu-24.04-accepted'))
    ) {
      findings.push(`${label} must identify the exact accepted hosted-runner fingerprint`);
    }
    if (gate.requiresBrowser) {
      const browserAction = segment.indexOf('./.github/actions/playwright-install');
      const journey = segment.indexOf(gate.commands[0]);
      if (browserAction === -1 || journey === -1 || browserAction > journey) {
        findings.push(`${label} must install the declared browser before its journey command`);
      }
    }
  }
  for (const id of REQUIRED_GATE_IDS) {
    if (!ids.has(id)) findings.push(`gates must retain required DevEx gate ${id}`);
  }
  findings.push(
    ...validatePullRequestDelivery(policy, workflowSources),
    ...validateReleaseAuthority(policy, workflowSources, options),
  );
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
  if (!['pinned-reference', 'github-hosted-accepted'].includes(policy?.referenceRunner?.kind)) {
    findings.push('referenceRunner.kind is invalid');
  }
  if (typeof policy?.referenceRunner?.binding !== 'boolean') {
    findings.push('referenceRunner.binding must be boolean');
  }
  if (
    policy?.referenceRunner?.kind === 'github-hosted-accepted' &&
    (policy.referenceRunner.binding !== true ||
      policy.referenceRunner.label !== 'ubuntu-24.04' ||
      policy.referenceRunner.runnerName !== 'github-hosted-ubuntu-24.04-accepted' ||
      policy.referenceRunner.mismatchPosture !== 'fail-closed' ||
      JSON.stringify(policy.referenceRunner.fingerprintInputs) !==
        JSON.stringify(HOSTED_RUNNER_FINGERPRINT_INPUTS))
  ) {
    findings.push(
      'accepted GitHub-hosted runner must bind the exact ubuntu-24.04 fingerprint and fail closed on drift',
    );
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
    ) ||
    !String(policy?.collection?.command ?? '').includes('--evaluate') ||
    !String(policy?.collection?.command ?? '').includes('--output ')
  ) {
    findings.push(
      'collection.command must bind its declared sample count, retained report, and budget evaluation',
    );
  }
  if (
    typeof policy?.collection?.sampleUnit !== 'string' ||
    policy.collection.sampleUnit.length < 40 ||
    typeof policy?.collection?.hostVariancePosture !== 'string' ||
    !policy.collection.hostVariancePosture.includes('exact runner fingerprint')
  ) {
    findings.push('collection must define sample independence and cross-runner noise posture');
  }
  const gate = ciPolicy?.gates?.find((candidate) => candidate.id === policy?.collection?.gateId);
  if (
    !gate ||
    gate.cadence !== 'nightly' ||
    gate.releaseRequired !== true ||
    gate.workflow !== policy?.collection?.workflow ||
    !gate.commands.includes(policy?.collection?.command)
  ) {
    findings.push('collection must map to the declared nightly CI gate and exact command');
  }
  if (
    policy?.ratification?.proposalSchema !== 'kovo-devex-budget-proposal/v6' ||
    policy?.ratification?.requiresExactRunnerFingerprint !== true ||
    policy?.ratification?.requiresHumanTargetRationale !== true ||
    policy?.ratification?.thresholdFormula !== budgets?.procedure?.thresholdFormula ||
    !String(policy?.ratification?.command ?? '').includes('--ratify') ||
    !String(policy?.ratification?.command ?? '').includes('--proposal')
  ) {
    findings.push('ratification must preserve the fail-closed reviewed v6 procedure');
  }
  if (
    !Array.isArray(policy?.blockers) ||
    policy.blockers.some((item) => item.length < 40) ||
    (policy.status === 'ratified' && policy.blockers.length > 0)
  ) {
    findings.push('blockers must be a substantive array');
  }
  const runnerBoundRatifications = Object.values(budgets?.metrics ?? {}).filter(
    (metric) => metric?.ratification !== null && metric?.binding !== 'packed-artifact',
  );
  if (policy?.referenceRunner?.binding !== true && runnerBoundRatifications.length > 0) {
    findings.push('a non-binding runner cannot produce runner-bound metric ratifications');
  }
  if (policy?.status === 'unratified' && runnerBoundRatifications.length > 0) {
    findings.push('an unratified baseline policy cannot contain runner-bound metric ratifications');
  }
  if (policy?.status === 'ratified' && runnerBoundRatifications.length === 0) {
    findings.push('a ratified baseline policy requires at least one runner-bound metric');
  }
  return findings;
}

export function runnerMinutes(gates, cadence) {
  return gates
    .filter((gate) => gate.cadence === cadence)
    .reduce((total, gate) => total + gate.budgetMinutes * gate.runnerCount, 0);
}

function validatePullRequestDelivery(policy, workflowSources) {
  const findings = [];
  const delivery = policy?.pullRequestDelivery;
  if (
    !canonicalWorkflowPath(delivery?.workflow) ||
    delivery?.transport !== 'github-check-step-summary' ||
    delivery?.writePermissions !== false
  ) {
    findings.push(
      'pullRequestDelivery must use a read-only GitHub check step summary from a canonical workflow',
    );
    return findings;
  }
  const expectedSignals = ['docs-freshness', 'public-surface', 'speed-deltas'];
  if (
    !Array.isArray(delivery.requiredSignals) ||
    JSON.stringify(
      [...delivery.requiredSignals].sort((left, right) => left.localeCompare(right)),
    ) !== JSON.stringify(expectedSignals)
  ) {
    findings.push('pullRequestDelivery.requiredSignals must contain the exact three DevEx reports');
  }
  const source = workflowSources.get(delivery.workflow);
  if (source === null || source === undefined) {
    findings.push('pullRequestDelivery.workflow cannot be resolved');
    return findings;
  }
  if (!/^\s{2}pull_request:\s*$/mu.test(source)) {
    findings.push('pullRequestDelivery.workflow must run on every pull_request');
  }
  if (
    /^\s*pull-requests:\s*write\s*$/mu.test(source) ||
    /^\s*permissions:\s*write-all\s*$/mu.test(source)
  ) {
    findings.push('pullRequestDelivery.workflow must not request pull-request write authority');
  }
  if (
    !source.includes(
      '{"schema":"kovo-devex-pr-report/v1","pass":false,"error":"report-unavailable"}',
    ) ||
    !source.includes('cat "$RUNNER_TEMP/kovo-devex-pr/report.md" >> "$GITHUB_STEP_SUMMARY"')
  ) {
    findings.push(
      'pullRequestDelivery.workflow must publish a bounded fail-closed fallback report',
    );
  }
  const visible = policy.gates.filter(
    (gate) => gate.cadence === 'per-pr' && gate.prVisible === true,
  );
  if (
    visible.length !== 1 ||
    visible[0].workflow !== delivery.workflow ||
    !visible[0].commands.includes('vp exec node scripts/devex-pr-report.mjs')
  ) {
    findings.push('exactly one per-PR gate must publish the three-signal DevEx report');
  }
  return findings;
}

function validateReleaseAuthority(policy, workflowSources, options) {
  const findings = [];
  const authority = policy?.releaseAuthority;
  if (
    !canonicalWorkflowPath(authority?.workflow) ||
    !canonicalWorkflowPath(authority?.requiredWorkflowPath) ||
    !Number.isSafeInteger(authority?.requiredWorkflowId) ||
    authority.requiredWorkflowId < 1 ||
    authority?.requiredWorkflowName !== 'DevEx Nightly' ||
    authority?.requiredBranch !== 'main'
  ) {
    findings.push('releaseAuthority must bind the canonical exact DevEx Nightly workflow');
    return findings;
  }
  const release = workflowSource(authority.workflow, {
    ...options,
    workflowSources,
  });
  if (release === null) {
    findings.push('releaseAuthority.workflow cannot be resolved');
    return findings;
  }
  const workflowId = String(authority.requiredWorkflowId);
  for (const required of [
    `/actions/workflows/${workflowId}/runs?branch=main&head_sha=`,
    `.workflow_id == ${workflowId}`,
    `.path == "${authority.requiredWorkflowPath}"`,
    '.head_branch == "main"',
    '.head_sha == $sha',
    '.conclusion == "success"',
    'devex-run-id=',
  ]) {
    if (!release.includes(required)) {
      findings.push(
        `releaseAuthority.workflow is missing exact nightly authorization ${JSON.stringify(required)}`,
      );
    }
  }
  const releaseGates = policy.gates.filter((gate) => gate.releaseRequired === true);
  const nightlyGates = policy.gates.filter((gate) => gate.cadence === 'nightly');
  if (
    releaseGates.length !== nightlyGates.length ||
    releaseGates.some(
      (gate) => gate.cadence !== 'nightly' || gate.workflow !== authority.requiredWorkflowPath,
    )
  ) {
    findings.push('releaseAuthority must cover every nightly DevEx gate');
  }
  const nightly = workflowSources.get(authority.requiredWorkflowPath);
  if (nightly === null || nightly === undefined || !/^name:\s*DevEx Nightly\s*$/mu.test(nightly)) {
    findings.push('releaseAuthority.requiredWorkflowName must match the nightly workflow');
  }
  return findings;
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
