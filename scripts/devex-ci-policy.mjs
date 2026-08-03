#!/usr/bin/env node
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot } from './release-packages.mjs';

export const DEVEX_CI_POLICY_SCHEMA = 'kovo-devex-ci-policy/v2';
export const DEVEX_BASELINE_POLICY_SCHEMA = 'kovo-devex-baseline-policy/v5';

const CADENCES = new Set(['per-pr', 'nightly', 'manual']);
const GATE_SCOPES = new Set(['job', 'step']);
const REQUIRED_GATE_IDS = Object.freeze([
  'pr-known-failures',
  'pr-scorecard',
  'nightly-package-producer',
  'nightly-benchmark',
  'nightly-packed-journeys',
  'nightly-full-catalog',
  'manual-hosted-ratification',
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
const HOSTED_RUNNER_MACHINE_CLASS = Object.freeze({
  kind: 'github-hosted-standard-public',
  provider: 'github-actions',
  repositoryVisibility: 'public',
  label: 'ubuntu-24.04',
  arch: 'x64',
  vcpus: 4,
  memoryBytes: 16 * 1024 * 1024 * 1024,
  ephemeralStorageBytes: 14 * 1024 * 1024 * 1024,
  specificationSource:
    'https://docs.github.com/en/actions/reference/runners/github-hosted-runners#standard-github-hosted-runners-for-public-repositories',
});
const HOSTED_EVIDENCE_SOURCES = Object.freeze(['benchmark', 'golden-journey', 'full-catalog']);
const HOSTED_RUNNER_BOUND_METRIC_COUNT = 14;
const RATIFICATION_CANDIDATE_FILES = Object.freeze([
  'baselines/devex-hosted-benchmark-v1.json',
  'baselines/devex-hosted-full-catalog-v1.json',
  'baselines/devex-hosted-golden-journey-v1.json',
  'devex-baseline-policy.json',
  'devex-budgets.json',
]);

export function createRatifiedDevexBaselinePolicyCandidate(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new TypeError('baseline policy candidate source must be an object');
  }
  return {
    ...structuredClone(policy),
    status: 'ratified',
    blockers: [],
  };
}

export function validateRatifiedDevexBaselinePolicyCandidate(checkoutPolicy, candidatePolicy) {
  const expected = createRatifiedDevexBaselinePolicyCandidate(checkoutPolicy);
  return JSON.stringify(candidatePolicy) === JSON.stringify(expected)
    ? []
    : [
        'candidate baseline policy must differ from checkout only by status=ratified and blockers=[]',
      ];
}

export function validateDevexRatificationCandidateCensus(candidateRoot) {
  const root = path.resolve(candidateRoot);
  if (!existsSync(root) || !lstatSync(root).isDirectory()) {
    return ['ratification candidate root must be a directory'];
  }
  const findings = [];
  const observedDirectories = [];
  const observed = [];
  const visit = (directory, prefix = '') => {
    for (const name of readdirSync(directory).sort((left, right) => left.localeCompare(right))) {
      const relative = prefix === '' ? name : `${prefix}/${name}`;
      const absolute = path.join(directory, name);
      const entry = lstatSync(absolute);
      if (entry.isSymbolicLink()) {
        findings.push(`ratification candidate entry must not be a symbolic link: ${relative}`);
      } else if (entry.isDirectory()) {
        observedDirectories.push(relative);
        visit(absolute, relative);
      } else if (entry.isFile()) {
        observed.push(relative);
      } else {
        findings.push(`ratification candidate entry must be a regular file: ${relative}`);
      }
    }
  };
  visit(root);
  if (JSON.stringify(observedDirectories) !== JSON.stringify(['baselines'])) {
    findings.push('ratification candidate must contain only the baselines directory');
  }
  if (JSON.stringify(observed) !== JSON.stringify(RATIFICATION_CANDIDATE_FILES)) {
    findings.push(
      `ratification candidate must contain exactly ${RATIFICATION_CANDIDATE_FILES.join(', ')}`,
    );
  }
  return findings;
}

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
      !gate.commands.some((command) => commandEnforcesStepBudget(command, gate.budgetMinutes))
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
      (!segment.includes('if: always()') ||
        !segment.includes(
          gate.id === 'nightly-packed-journeys'
            ? 'name: kovo-devex-golden-journey'
            : gate.id === 'nightly-full-catalog'
              ? 'name: kovo-devex-full-catalog'
              : gate.id === 'manual-hosted-ratification'
                ? 'name: kovo-devex-ratification-audit'
                : 'name: kovo-devex-baseline',
        ))
    ) {
      findings.push(`${label} must preserve its report after a budget breach`);
    }
    if (
      [
        'nightly-benchmark',
        'nightly-full-catalog',
        'nightly-packed-journeys',
        'manual-hosted-ratification',
        'pr-scorecard',
      ].includes(gate.id) &&
      (!segment.includes('${ImageOS:-unknown}') ||
        !segment.includes('${ImageVersion:-unknown}') ||
        !segment.includes('cat /etc/os-release') ||
        !segment.includes('KOVO_DEVEX_RUNNER_NAME=github-hosted-ubuntu-24.04-accepted'))
    ) {
      findings.push(`${label} must identify the exact accepted hosted-runner fingerprint`);
    }
    if (
      gate.id === 'nightly-benchmark' &&
      !gate.commands.some(
        (command) => command.includes('--samples 5') && command.includes('--require-ratified'),
      )
    ) {
      findings.push(`${label} must collect N>=5 and fail closed before runner budget ratification`);
    }
    if (
      gate.id === 'nightly-packed-journeys' &&
      (gate.preserveReportOnFailure !== true ||
        !gate.commands.some(
          (command) =>
            command.includes('--scenario release-scorecard') &&
            command.includes('--samples 5') &&
            command.includes('--evaluate') &&
            command.includes('--require-ratified') &&
            command.includes('--report ') &&
            command.includes('--artifacts '),
        ) ||
        !segment.includes('path: ${{ runner.temp }}/kovo-devex-golden') ||
        !segment.includes('include-hidden-files: true'))
    ) {
      findings.push(
        `${label} must bind both packed starters and the offline agent to one retained N>=5 release scorecard`,
      );
    }
    if (
      gate.id === 'nightly-full-catalog' &&
      (gate.preserveReportOnFailure !== true ||
        !gate.commands.some(
          (command) =>
            command.includes('scripts/full-catalog-reproducer.mjs') &&
            command.includes('--samples 5') &&
            command.includes('--output ') &&
            command.includes('--artifacts '),
        ) ||
        !segment.includes('path: ${{ runner.temp }}/kovo-devex-full-catalog') ||
        !segment.includes('include-hidden-files: true'))
    ) {
      findings.push(
        `${label} must retain five authenticated all-44 RSS samples and redacted failures`,
      );
    }
    if (gate.id === 'manual-hosted-ratification') {
      const inheritedBudgetsSnapshot =
        'cp devex-budgets.json "$RUNNER_TEMP/kovo-devex-ratification/inherited-devex-budgets.json"';
      const transaction = gate.commands?.find((command) => command.includes(' --ratify '));
      const benchmark = gate.commands?.find(
        (command) =>
          command.includes('scripts/devex-benchmark.mjs --scenario ') &&
          command.includes('--samples 5') &&
          command.includes('/kovo-devex-ratification/benchmark.json'),
      );
      const golden = gate.commands?.find(
        (command) =>
          command.includes('scripts/golden-journey.mjs --scenario release-scorecard') &&
          command.includes('--samples 5') &&
          command.includes('/kovo-devex-ratification/golden/report.json'),
      );
      const fullCatalog = gate.commands?.find(
        (command) =>
          command.includes('scripts/full-catalog-reproducer.mjs') &&
          command.includes('--samples 5') &&
          command.includes('/kovo-devex-ratification/full-catalog/report.json'),
      );
      if (
        gate.cadence !== 'manual' ||
        gate.preserveReportOnFailure !== true ||
        gate.requiresBrowser !== true ||
        !segment.includes('if: ${{ inputs.ratify_hosted_budgets }}') ||
        !segment.includes('test -z "$(git status --porcelain=v1 --untracked-files=all)"') ||
        !segment.includes('path: ${{ runner.temp }}/kovo-devex-ratification') ||
        !segment.includes('include-hidden-files: true') ||
        benchmark === undefined ||
        golden === undefined ||
        fullCatalog === undefined ||
        transaction === undefined ||
        !segment.includes(inheritedBudgetsSnapshot) ||
        segment.indexOf(inheritedBudgetsSnapshot) > segment.indexOf(transaction) ||
        countOccurrences(transaction, ' --baseline "') !== 3 ||
        countOccurrences(transaction, ' --proposal "') !== 3 ||
        countOccurrences(transaction, ' --baseline-record-path ') !== 3 ||
        countOccurrences(transaction, ' --write') !== 1 ||
        !transaction.includes('--budgets devex-budgets.json') ||
        !transaction.includes('baselines/devex-hosted-benchmark-v1.json') ||
        !transaction.includes('baselines/devex-hosted-golden-journey-v1.json') ||
        !transaction.includes('baselines/devex-hosted-full-catalog-v1.json')
      ) {
        findings.push(
          `${label} must collect one-runner N=5 benchmark, golden, and full-catalog evidence before one clean transactional budget write`,
        );
      }
      const candidateHandoffFragments = [
        inheritedBudgetsSnapshot,
        'KOVO_DEVEX_CANDIDATE_ROOT: ${{ runner.temp }}/kovo-devex-ratification/candidate',
        'cp devex-budgets.json "$KOVO_DEVEX_CANDIDATE_ROOT/devex-budgets.json"',
        '"$KOVO_DEVEX_CANDIDATE_ROOT/baselines/devex-hosted-benchmark-v1.json"',
        '"$KOVO_DEVEX_CANDIDATE_ROOT/baselines/devex-hosted-golden-journey-v1.json"',
        '"$KOVO_DEVEX_CANDIDATE_ROOT/baselines/devex-hosted-full-catalog-v1.json"',
        'createRatifiedDevexBaselinePolicyCandidate(checkoutPolicy)',
        "path.join(process.env.KOVO_DEVEX_CANDIDATE_ROOT, 'devex-baseline-policy.json')",
        'KOVO_DEVEX_INHERITED_BUDGETS: ${{ runner.temp }}/kovo-devex-ratification/inherited-devex-budgets.json',
        'vp exec node scripts/devex-benchmark.mjs --check-budgets --budgets "$KOVO_DEVEX_CANDIDATE_ROOT/devex-budgets.json" --inherited-budgets "$KOVO_DEVEX_INHERITED_BUDGETS" --inherited-provenance-root "$GITHUB_WORKSPACE"',
        'vp exec node scripts/devex-ci-policy.mjs --candidate-root "$KOVO_DEVEX_CANDIDATE_ROOT"',
        'git diff --check -- devex-budgets.json',
        'test "$actual_status" = \' M devex-budgets.json\'',
      ];
      if (
        candidateHandoffFragments.some((fragment) => !segment.includes(fragment)) ||
        /^\s*cp\s+.*(?:^|\s)baselines\/devex-hosted-/mu.test(segment)
      ) {
        findings.push(
          `${label} must hand off and validate the exact five-file ratification candidate without checkout baseline writes`,
        );
      }
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
      JSON.stringify(policy.referenceRunner.machineClass) !==
        JSON.stringify(HOSTED_RUNNER_MACHINE_CLASS) ||
      JSON.stringify(policy.referenceRunner.machineClass) !==
        JSON.stringify(budgets?.runner?.machineClass) ||
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
  const requiredBaselineSamples = budgets?.procedure?.minimumBaselineStatisticalSamples;
  const requiredEvaluationSamples = budgets?.procedure?.minimumEvaluationStatisticalSamples;
  if (
    !Number.isSafeInteger(policy?.collection?.baselineSampleCount) ||
    policy.collection.baselineSampleCount < requiredBaselineSamples
  ) {
    findings.push(
      `collection.baselineSampleCount must be at least ${String(requiredBaselineSamples)}`,
    );
  }
  if (
    !Number.isSafeInteger(policy?.collection?.evaluationSampleCount) ||
    policy.collection.evaluationSampleCount < requiredEvaluationSamples
  ) {
    findings.push(
      `collection.evaluationSampleCount must be at least ${String(requiredEvaluationSamples)}`,
    );
  }
  if (policy?.collection?.baselineSampleCount !== policy?.collection?.evaluationSampleCount) {
    findings.push('collection must use one repeat count for retained baseline and evaluation data');
  }
  if (
    policy?.collection?.statistic !== budgets?.procedure?.statistic ||
    policy?.collection?.noiseStatistic !== budgets?.procedure?.noiseStatistic
  ) {
    findings.push('collection statistics must match the budget procedure');
  }
  if (
    !String(policy?.collection?.command ?? '').includes(
      `--samples ${String(policy?.collection?.evaluationSampleCount)}`,
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
  const fullCatalog = policy?.fullCatalogCollection;
  const fullCatalogGate = ciPolicy?.gates?.find(
    (candidate) => candidate.id === fullCatalog?.gateId,
  );
  if (
    fullCatalog?.reportSchema !== 'kovo-devex-full-catalog/v1' ||
    fullCatalog?.workloadSchema !== 'kovo-devex-full-catalog-workload/v1' ||
    !Number.isSafeInteger(fullCatalog?.sampleCount) ||
    fullCatalog.sampleCount < requiredBaselineSamples ||
    fullCatalog?.artifact !== 'kovo-devex-full-catalog' ||
    fullCatalog?.retirementCondition !==
      'The packed all-44-component fixture typechecks, checks, and builds with unimported copies under the ratified peak-RSS budget.' ||
    !String(fullCatalog?.command ?? '').includes(`--samples ${String(fullCatalog?.sampleCount)}`) ||
    !String(fullCatalog?.command ?? '').includes('--output ') ||
    !String(fullCatalog?.command ?? '').includes('--artifacts ') ||
    !fullCatalogGate ||
    fullCatalogGate.cadence !== 'nightly' ||
    fullCatalogGate.releaseRequired !== true ||
    fullCatalogGate.preserveReportOnFailure !== true ||
    fullCatalogGate.workflow !== fullCatalog?.workflow ||
    !fullCatalogGate.commands.includes(fullCatalog?.command)
  ) {
    findings.push(
      'fullCatalogCollection must bind N>=5 authenticated retained evidence to KF-DEVEX-007 retirement',
    );
  }
  const ratification = policy?.ratification;
  const ratificationGate = ciPolicy?.gates?.find(
    (candidate) => candidate.id === ratification?.gateId,
  );
  const ratificationCommand = String(ratification?.command ?? '');
  const expectedSources = ['benchmark', 'golden-journey', 'full-catalog'];
  const expectedBaselinePaths = {
    benchmark: 'baselines/devex-hosted-benchmark-v1.json',
    'golden-journey': 'baselines/devex-hosted-golden-journey-v1.json',
    'full-catalog': 'baselines/devex-hosted-full-catalog-v1.json',
  };
  if (
    ratification?.workflow !== '.github/workflows/devex-nightly.yml' ||
    ratification?.dispatchInput !== 'ratify_hosted_budgets' ||
    !Number.isSafeInteger(ratification?.sampleCount) ||
    ratification.sampleCount < requiredBaselineSamples ||
    JSON.stringify(ratification?.reportSources) !== JSON.stringify(expectedSources) ||
    JSON.stringify(ratification?.baselineRecordPaths) !== JSON.stringify(expectedBaselinePaths) ||
    ratification?.proposalSchema !== 'kovo-devex-budget-proposal/v7' ||
    ratification?.requiresExactRunnerFingerprint !== true ||
    ratification?.requiresExactCleanSourceRevision !== true ||
    ratification?.requiresHumanTargetRationale !== true ||
    ratification?.atomicBudgetWrite !== true ||
    ratification?.candidateArtifact !== 'kovo-devex-ratification-audit' ||
    JSON.stringify(ratification?.noiseMultipliers) !==
      JSON.stringify(budgets?.procedure?.noiseMultipliers) ||
    ratification?.thresholdFormula !== budgets?.procedure?.thresholdFormula ||
    countOccurrences(ratificationCommand, ' --baseline "') !== 3 ||
    countOccurrences(ratificationCommand, ' --proposal "') !== 3 ||
    countOccurrences(ratificationCommand, ' --baseline-record-path ') !== 3 ||
    countOccurrences(ratificationCommand, ' --write') !== 1 ||
    !ratificationCommand.includes('--budgets devex-budgets.json') ||
    Object.values(expectedBaselinePaths).some((value) => !ratificationCommand.includes(value)) ||
    validateTargetProposals(ratification?.targetProposals, budgets).length > 0 ||
    !ratificationGate ||
    ratificationGate.cadence !== 'manual' ||
    ratificationGate.workflow !== ratification?.workflow ||
    !ratificationGate.commands.includes(ratificationCommand)
  ) {
    findings.push('ratification must preserve the fail-closed reviewed v7 procedure');
  }
  if (
    !Array.isArray(policy?.blockers) ||
    policy.blockers.some((item) => item.length < 40) ||
    (policy.status === 'ratified' && policy.blockers.length > 0)
  ) {
    findings.push('blockers must be a substantive array');
  }
  const runnerBoundRatifications = Object.values(budgets?.metrics ?? {}).filter(
    (metric) =>
      metric?.source === 'benchmark' &&
      metric?.ratification !== null &&
      metric?.binding !== 'packed-artifact',
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

function validateTargetProposals(proposals, budgets) {
  const findings = [];
  const expectedSources = HOSTED_EVIDENCE_SOURCES;
  if (
    !proposals ||
    typeof proposals !== 'object' ||
    Array.isArray(proposals) ||
    JSON.stringify(Object.keys(proposals)) !== JSON.stringify(expectedSources)
  ) {
    return ['targetProposals must contain the exact hosted evidence sources'];
  }
  let runnerBoundMetricCount = 0;
  for (const [source, metrics] of Object.entries(proposals)) {
    const expectedMetricIds = Object.entries(budgets?.metrics ?? {})
      .filter(([, metric]) => metric?.source === source && metric?.binding !== 'packed-artifact')
      .map(([metricId]) => metricId);
    runnerBoundMetricCount += expectedMetricIds.length;
    if (
      !metrics ||
      typeof metrics !== 'object' ||
      Array.isArray(metrics) ||
      JSON.stringify(Object.keys(metrics)) !== JSON.stringify(expectedMetricIds)
    ) {
      findings.push(`targetProposals.${source} must contain every provisional product target`);
      continue;
    }
    for (const [metricId, proposal] of Object.entries(metrics)) {
      const metric = budgets?.metrics?.[metricId];
      if (
        metric?.source !== source ||
        !Number.isFinite(metric?.provisionalTarget) ||
        proposal?.budget !== metric.provisionalTarget ||
        Object.keys(proposal ?? {})
          .sort()
          .join(',') !== 'budget,targetRationale' ||
        typeof proposal?.targetRationale !== 'string' ||
        proposal.targetRationale.trim().length < 40
      ) {
        findings.push(
          `targetProposals.${source}.${metricId} must preserve its provisional product target and substantive rationale`,
        );
      }
    }
  }
  if (runnerBoundMetricCount !== HOSTED_RUNNER_BOUND_METRIC_COUNT) {
    findings.push(
      `targetProposals must cover exactly ${String(HOSTED_RUNNER_BOUND_METRIC_COUNT)} runner-bound metrics`,
    );
  }
  return findings;
}

export function runnerMinutes(gates, cadence) {
  return gates
    .filter((gate) => gate.cadence === cadence)
    .reduce((total, gate) => total + gate.budgetMinutes * gate.runnerCount, 0);
}

function commandEnforcesStepBudget(command, budgetMinutes) {
  const match = /^timeout(?: --kill-after=(\d+)s)? (\d+)m \S/u.exec(command);
  if (match === null || Number(match[2]) !== budgetMinutes) return false;
  if (match[1] === undefined) return true;
  const killAfterSeconds = Number(match[1]);
  return Number.isSafeInteger(killAfterSeconds) && killAfterSeconds >= 1 && killAfterSeconds <= 60;
}

function countOccurrences(value, fragment) {
  return typeof value === 'string' ? value.split(fragment).length - 1 : 0;
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

function parseDevexCiPolicyArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--candidate-root') {
      if (options.candidateRoot !== undefined) {
        throw new Error('--candidate-root may be provided only once');
      }
      const value = argv[++index];
      if (value === undefined || value.trim() === '') {
        throw new Error('--candidate-root requires a path');
      }
      options.candidateRoot = path.resolve(value);
    } else {
      throw new Error(`Unknown argument: ${String(argument)}`);
    }
  }
  return options;
}

async function main() {
  const options = parseDevexCiPolicyArgs(process.argv.slice(2));
  const ci = JSON.parse(readFileSync(path.join(repoRoot, 'devex-ci-policy.json'), 'utf8'));
  const checkoutBaseline = JSON.parse(
    readFileSync(path.join(repoRoot, 'devex-baseline-policy.json'), 'utf8'),
  );
  const candidateFindings =
    options.candidateRoot === undefined
      ? []
      : validateDevexRatificationCandidateCensus(options.candidateRoot);
  if (candidateFindings.length > 0) {
    process.stderr.write(`${candidateFindings.join('\n')}\n`);
    return 1;
  }
  const baseline =
    options.candidateRoot === undefined
      ? checkoutBaseline
      : JSON.parse(
          readFileSync(path.join(options.candidateRoot, 'devex-baseline-policy.json'), 'utf8'),
        );
  const budgets = JSON.parse(
    readFileSync(
      options.candidateRoot === undefined
        ? path.join(repoRoot, 'devex-budgets.json')
        : path.join(options.candidateRoot, 'devex-budgets.json'),
      'utf8',
    ),
  );
  const findings = [
    ...(options.candidateRoot === undefined
      ? []
      : validateRatifiedDevexBaselinePolicyCandidate(checkoutBaseline, baseline)),
    ...validateDevexCiPolicy(ci, { repoRoot }),
    ...validateDevexBaselinePolicy(baseline, budgets, ci),
  ];
  if (findings.length > 0) {
    process.stderr.write(`${findings.join('\n')}\n`);
    return 1;
  }
  process.stdout.write(
    `${DEVEX_CI_POLICY_SCHEMA} per-pr=${String(runnerMinutes(ci.gates, 'per-pr'))}/${String(ci.budgets.perPullRequestRunnerMinutes)} nightly=${String(runnerMinutes(ci.gates, 'nightly'))}/${String(ci.budgets.nightlyRunnerMinutes)} manual=${String(runnerMinutes(ci.gates, 'manual'))} baseline=${baseline.status} baseline-samples=${String(baseline.collection.baselineSampleCount)} evaluation-samples=${String(baseline.collection.evaluationSampleCount)}${options.candidateRoot === undefined ? '' : ' candidate=complete'}\n`,
  );
  return 0;
}

if (isMainEntry(import.meta.url)) await runGate(main);
