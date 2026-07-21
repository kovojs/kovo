#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { parseTimePeakRssBytes } from './lib/process-cost.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';

export const PLAN3_COST_BUDGET_SCHEMA = 'kovo.plan3-security-gate-budgets/v1';
export const DEFAULT_PLAN3_COST_BUDGET_FILE = 'security/plan3-security-gate-budgets.json';
export const PLAN3_GATE_COMMAND_SCHEMA = 'kovo.plan3-security-gate-commands/v1';
export const DEFAULT_PLAN3_GATE_COMMAND_FILE = 'security/plan3-security-gate-commands.json';
export const DEFAULT_PLAN3_COST_REPORT_DIRECTORY = '.kovo/security-evidence/plan3-cost';

// This is deliberately independent of the manifest. A deleted or newly invented row therefore
// changes a reviewed denominator in code instead of silently redefining the budget population.
export const PLAN3_SECURITY_GATE_DENOMINATOR = Object.freeze([
  'cost-budget-manifest',
  'artifact-provenance-build',
  'security-guarantee',
  'hermetic-proof-stage',
  'provenance-closure',
  'authorization-matrix',
  'rls-emission-door',
  'grammar-containment',
  'label-clause-map',
  'pack-security',
  'certificate-module-identity',
  'certificate',
  'emission-constructor-closure',
  'phase3-agent-mediation',
  'phase3-grant-graph',
  'phase3-environment-contract',
  'phase3-derived-dataset',
  'phase3-dependency-capabilities',
  'escape-census',
  'declassification-census',
  'provenance-precision-register',
  'analyzable-fragment',
  'security-event-answerability',
  'advisory-feed',
  'auth-provider-pin',
  'c9-sink-inventory',
  'replay-model',
  'protocol-alphabet',
  'model-honesty-boundary',
  'decided-surface',
  'metric-e-rounds',
]);

const PHASE3_GATE_IDS = Object.freeze([
  'phase3-agent-mediation',
  'phase3-grant-graph',
  'phase3-environment-contract',
  'phase3-derived-dataset',
  'phase3-dependency-capabilities',
]);
const HERMETIC_PROOF_STAGE_COMMAND = Object.freeze(['node', 'scripts/hermetic-proof-stage.mjs']);

export function loadPlan3CostBudgetManifest(options = {}) {
  const root = options.repoRoot ?? findRepoRoot();
  const manifestFile = options.manifestFile ?? DEFAULT_PLAN3_COST_BUDGET_FILE;
  const manifest = JSON.parse(readFileSync(path.resolve(root, manifestFile), 'utf8'));
  const commands = loadPlan3GateCommandRegistry({ repoRoot: root });
  const findings = [
    ...validatePlan3CostBudgetManifest(manifest),
    ...validatePlan3GateCommandRegistry(commands, manifest),
    ...validatePlan3CostRepositoryBindings(manifest, root),
  ];
  if (findings.length > 0) {
    throw new TypeError(`Plan 3 cost-budget manifest is invalid:\n${findings.join('\n')}`);
  }
  return manifest;
}

export function loadPlan3GateCommandRegistry(options = {}) {
  const root = options.repoRoot ?? findRepoRoot();
  const commandFile = options.commandFile ?? DEFAULT_PLAN3_GATE_COMMAND_FILE;
  return JSON.parse(readFileSync(path.resolve(root, commandFile), 'utf8'));
}

export function validatePlan3GateCommandRegistry(registry, manifest) {
  const findings = [];
  if (!isRecord(registry)) return ['command registry must be an object'];
  if (registry.schema !== PLAN3_GATE_COMMAND_SCHEMA) {
    findings.push(`command registry schema must be ${PLAN3_GATE_COMMAND_SCHEMA}`);
  }
  if (!Array.isArray(registry.gates)) {
    findings.push('command registry gates must be an array');
    return findings;
  }
  const ids = registry.gates.map((gate) => gate?.id);
  if (!sameArray(ids, PLAN3_SECURITY_GATE_DENOMINATOR)) {
    findings.push(
      `command registry denominator/order drifted: expected ${PLAN3_SECURITY_GATE_DENOMINATOR.join(', ')}, received ${ids.join(', ')}`,
    );
  }
  const manifestById = new Map(
    Array.isArray(manifest?.gates) ? manifest.gates.map((gate) => [gate?.id, gate]) : [],
  );
  for (const [index, commandGate] of registry.gates.entries()) {
    const label = `command registry gates[${index}]`;
    if (!isRecord(commandGate) || typeof commandGate.id !== 'string') {
      findings.push(`${label} must carry an id`);
      continue;
    }
    const budgetGate = manifestById.get(commandGate.id);
    if (budgetGate === undefined) {
      findings.push(`${label} ${commandGate.id} has no matching budget row`);
      continue;
    }
    if (budgetGate.execution === 'self-check') {
      if (
        commandGate.execution !== 'self-check' ||
        commandGate.steps !== undefined ||
        !sameArray(Object.keys(commandGate).sort(), ['execution', 'id'])
      ) {
        findings.push(`${label} must retain the exact non-recursive self-check vector`);
      }
      continue;
    }
    if (
      commandGate.execution !== undefined ||
      !Array.isArray(commandGate.steps) ||
      JSON.stringify(commandGate.steps) !== JSON.stringify(budgetGate.steps)
    ) {
      findings.push(`${label} ${commandGate.id} differs from its independently reviewed steps`);
      continue;
    }
    for (const [stepIndex, step] of commandGate.steps.entries()) {
      const command = step?.command;
      if (
        Array.isArray(command) &&
        ((command[0] === 'node' && ['-e', '--eval'].includes(command[1])) ||
          ['bash', 'sh', 'zsh'].includes(command[0]))
      ) {
        findings.push(
          `${label}.steps[${stepIndex}] uses an opaque shell/eval vector instead of a reviewed gate entrypoint`,
        );
      }
    }
  }
  return findings;
}

export function validatePlan3CostRepositoryBindings(manifest, root = findRepoRoot()) {
  const findings = [];
  const gate = Array.isArray(manifest?.gates)
    ? manifest.gates.find((row) => row?.id === 'hermetic-proof-stage')
    : undefined;
  let hermetic;
  try {
    hermetic = JSON.parse(
      readFileSync(path.join(root, 'security/hermetic-proof-stage.json'), 'utf8'),
    );
  } catch (error) {
    findings.push(`hermetic proof memory binding could not be read: ${String(error)}`);
    return findings;
  }
  if (
    gate?.isolatedMemory?.kind !== 'docker-cgroup' ||
    hermetic?.linuxRunner?.memoryMiB !== gate.isolatedMemory.ceilingMiB ||
    hermetic?.linuxRunner?.memorySwapMiB !== gate.isolatedMemory.ceilingMiB
  ) {
    findings.push(
      'hermetic proof Docker memory/swap limits must equal the independently budgeted isolated-memory ceiling',
    );
  }
  try {
    findings.push(
      ...validatePlan3WorkflowRunnerBindings(
        manifest,
        readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'),
      ),
    );
  } catch (error) {
    findings.push(
      `Plan 3 workflow runner bindings could not be read: ${
        error instanceof Error ? error.message : 'unknown workflow read failure'
      }`,
    );
  }
  return findings;
}

export function validatePlan3WorkflowRunnerBindings(manifest, workflow) {
  const { findings, runners } = parseWorkflowJobRunners(workflow);
  const expectedRunner = manifest?.intendedRunner?.ciImage?.replace('github-actions/', '');
  const jobIds = new Set(
    Array.isArray(manifest?.gates) ? manifest.gates.map((gate) => gate?.ciJob) : [],
  );
  for (const jobId of jobIds) {
    if (typeof jobId !== 'string') continue;
    const actualRunner = runners.get(jobId);
    if (actualRunner !== expectedRunner) {
      findings.push(
        `Plan 3 CI job ${jobId} must run on exact image ${expectedRunner}; received ${
          actualRunner ?? 'no literal runs-on value'
        }`,
      );
    }
  }
  return findings;
}

export function parseWorkflowJobRunners(workflow) {
  const findings = [];
  const runners = new Map();
  let inJobs = false;
  let currentJob;
  for (const line of workflow.split(/\r?\n/u)) {
    if (!inJobs) {
      if (/^jobs:\s*(?:#.*)?$/u.test(line)) inJobs = true;
      continue;
    }
    if (/^[^\s#]/u.test(line)) break;
    const job = /^  ([A-Za-z0-9_-]+):\s*(?:#.*)?$/u.exec(line);
    if (job) {
      currentJob = job[1];
      continue;
    }
    const runner = /^    runs-on:\s*([^\s#]+)\s*(?:#.*)?$/u.exec(line);
    if (!runner || currentJob === undefined) continue;
    if (runners.has(currentJob)) {
      findings.push(`Plan 3 workflow job ${currentJob} has more than one runs-on declaration`);
      continue;
    }
    runners.set(currentJob, runner[1]);
  }
  if (!inJobs) findings.push('Plan 3 workflow has no literal jobs mapping');
  return { findings, runners };
}

export function validatePlan3CostBudgetManifest(manifest) {
  const findings = [];
  if (!isRecord(manifest)) return ['manifest must be an object'];
  if (manifest.schema !== PLAN3_COST_BUDGET_SCHEMA) {
    findings.push(`manifest schema must be ${PLAN3_COST_BUDGET_SCHEMA}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}\.\d+$/u.test(manifest.budgetVersion ?? '')) {
    findings.push('budgetVersion must be a dated, revisioned value such as 2026-07-21.1');
  }
  validateIntendedRunner(manifest.intendedRunner, findings);
  validateMeasurement(manifest.measurement, findings);

  if (!Array.isArray(manifest.gates)) {
    findings.push('gates must be an array');
    return findings;
  }

  const ids = [];
  const seen = new Set();
  for (const [index, gate] of manifest.gates.entries()) {
    const label = `gates[${index}]`;
    if (!isRecord(gate)) {
      findings.push(`${label} must be an object`);
      continue;
    }
    if (typeof gate.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(gate.id)) {
      findings.push(`${label}.id must be a stable kebab-case identifier`);
      continue;
    }
    ids.push(gate.id);
    if (seen.has(gate.id)) findings.push(`duplicate gate id ${gate.id}`);
    seen.add(gate.id);
    validateGate(gate, label, findings);
  }

  if (!sameArray(ids, PLAN3_SECURITY_GATE_DENOMINATOR)) {
    findings.push(
      `gate denominator/order drifted: expected ${PLAN3_SECURITY_GATE_DENOMINATOR.join(', ')}, received ${ids.join(', ')}`,
    );
  }
  const phase3Ids = manifest.gates
    .filter((gate) => gate.groups?.includes('phase3'))
    .map((gate) => gate.id);
  if (!sameArray(phase3Ids, PHASE3_GATE_IDS)) {
    findings.push(
      `phase3 focused denominator drifted: expected ${PHASE3_GATE_IDS.join(', ')}, received ${phase3Ids.join(', ')}`,
    );
  }
  return findings;
}

function validateIntendedRunner(value, findings) {
  if (!isRecord(value)) {
    findings.push('intendedRunner must be an object');
    return;
  }
  const expected = {
    architecture: 'x64',
    ciImage: 'github-actions/ubuntu-24.04',
    node: '24.18.0',
    operatingSystem: 'linux',
    scheduling: 'one gate at a time within its job',
  };
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value[key] !== expectedValue) {
      findings.push(`intendedRunner.${key} must equal ${JSON.stringify(expectedValue)}`);
    }
  }
  if (!sameArray(Object.keys(value).sort(), Object.keys(expected).sort())) {
    findings.push('intendedRunner must contain exactly the reviewed runner calibration fields');
  }
}

function validateMeasurement(value, findings) {
  if (!isRecord(value)) {
    findings.push('measurement must be an object');
    return;
  }
  if (
    !Number.isSafeInteger(value.sampleIntervalMs) ||
    value.sampleIntervalMs < 25 ||
    value.sampleIntervalMs > 1000
  ) {
    findings.push('measurement.sampleIntervalMs must be an integer from 25 through 1000');
  }
  if (typeof value.wallTime !== 'string' || !value.wallTime.includes('monotonic elapsed time')) {
    findings.push('measurement.wallTime must name monotonic elapsed time');
  }
  if (
    typeof value.peakRss !== 'string' ||
    !value.peakRss.includes('process-tree RSS') ||
    !value.peakRss.includes('/usr/bin/time')
  ) {
    findings.push('measurement.peakRss must name process-tree sampling and /usr/bin/time');
  }
}

function validateGate(gate, label, findings) {
  if (!Number.isSafeInteger(gate.budgetVersion) || gate.budgetVersion < 1) {
    findings.push(`${label}.budgetVersion must be a positive integer`);
  }
  if (
    !Array.isArray(gate.planSections) ||
    gate.planSections.length === 0 ||
    gate.planSections.some((section) => typeof section !== 'string' || section.length === 0)
  ) {
    findings.push(`${label}.planSections must contain at least one stable section id`);
  }
  if (!['static-core', 'hermetic-proof', 'publish-readiness'].includes(gate.ciJob)) {
    findings.push(`${label}.ciJob must name an intended existing CI job`);
  }
  if (typeof gate.entrypoint !== 'string' || !gate.entrypoint.startsWith('pnpm run ')) {
    findings.push(`${label}.entrypoint must name the public pnpm script that executes the budget`);
  }
  if (
    !Array.isArray(gate.groups) ||
    gate.groups.some((group) => typeof group !== 'string' || group.length === 0) ||
    new Set(gate.groups).size !== gate.groups.length
  ) {
    findings.push(`${label}.groups must be a unique string array`);
  }
  if (!Number.isSafeInteger(gate.wallTimeCeilingMs) || gate.wallTimeCeilingMs < 1000) {
    findings.push(`${label}.wallTimeCeilingMs must be an enforced integer ceiling`);
  }
  if (!Number.isSafeInteger(gate.peakRssCeilingMiB) || gate.peakRssCeilingMiB < 64) {
    findings.push(`${label}.peakRssCeilingMiB must be an enforced integer ceiling`);
  }
  if (gate.id === 'hermetic-proof-stage') {
    if (
      !isRecord(gate.isolatedMemory) ||
      gate.isolatedMemory.kind !== 'docker-cgroup' ||
      !Number.isSafeInteger(gate.isolatedMemory.ceilingMiB) ||
      gate.isolatedMemory.ceilingMiB < 64 ||
      !Number.isSafeInteger(gate.isolatedMemory.combinedCeilingMiB) ||
      gate.isolatedMemory.combinedCeilingMiB !==
        gate.peakRssCeilingMiB + gate.isolatedMemory.ceilingMiB
    ) {
      findings.push(
        `${label}.isolatedMemory must split an exact combined ceiling between host RSS and Docker cgroup memory`,
      );
    }
  } else if (gate.isolatedMemory !== undefined) {
    findings.push(`${label}.isolatedMemory is reserved for the Docker-backed hermetic proof gate`);
  }

  const selfCheck = gate.execution === 'self-check';
  if (selfCheck && gate.id !== 'cost-budget-manifest') {
    findings.push(`${label}.execution self-check is reserved for cost-budget-manifest`);
  }
  if (gate.id === 'cost-budget-manifest' && !selfCheck) {
    findings.push(`${label} must use the non-recursive self-check execution`);
  }
  if (selfCheck) {
    if (gate.steps !== undefined) findings.push(`${label}.steps must be absent for self-check`);
  } else if (!Array.isArray(gate.steps) || gate.steps.length === 0) {
    findings.push(`${label}.steps must contain at least one command`);
  } else {
    for (const [stepIndex, step] of gate.steps.entries()) {
      const stepLabel = `${label}.steps[${stepIndex}]`;
      if (
        !isRecord(step) ||
        !Array.isArray(step.command) ||
        step.command.length === 0 ||
        step.command.some((argument) => typeof argument !== 'string' || argument.length === 0)
      ) {
        findings.push(`${stepLabel}.command must be a non-empty argv array`);
      }
      if (step?.buildIntegrated !== undefined && step.buildIntegrated !== true) {
        findings.push(`${stepLabel}.buildIntegrated may only be present with value true`);
      }
    }
  }
  if (
    gate.id === 'hermetic-proof-stage' &&
    (gate.steps.length !== 1 ||
      !sameArray(gate.steps[0]?.command ?? [], HERMETIC_PROOF_STAGE_COMMAND))
  ) {
    findings.push(`${label} must retain the exact measured hermetic-proof-stage worker command`);
  }

  const buildSteps = gate.steps?.filter((step) => step.buildIntegrated === true).length ?? 0;
  if (!isRecord(gate.buildTime)) {
    findings.push(`${label}.buildTime must be an object`);
  } else if (gate.buildTime.status === 'enforced') {
    if (!Number.isSafeInteger(gate.buildTime.ceilingMs) || gate.buildTime.ceilingMs < 1000) {
      findings.push(`${label}.buildTime.ceilingMs must be an enforced integer ceiling`);
    }
    if (gate.buildTime.ceilingMs > gate.wallTimeCeilingMs) {
      findings.push(`${label}.buildTime.ceilingMs cannot exceed the gate wall ceiling`);
    }
    if (typeof gate.buildTime.scope !== 'string' || gate.buildTime.scope.length < 30) {
      findings.push(`${label}.buildTime.scope must describe the end-to-end build boundary`);
    }
    if (buildSteps === 0) {
      findings.push(`${label} enforces build time but marks no build-integrated step`);
    }
  } else if (gate.buildTime.status === 'not-applicable') {
    if (
      typeof gate.buildTime.reviewedReason !== 'string' ||
      gate.buildTime.reviewedReason.length < 30
    ) {
      findings.push(`${label}.buildTime.reviewedReason must explain the reviewed N/A decision`);
    }
    if (gate.buildTime.ceilingMs !== undefined || gate.buildTime.scope !== undefined) {
      findings.push(`${label}.buildTime N/A rows cannot carry an unused ceiling or scope`);
    }
    if (buildSteps !== 0) {
      findings.push(`${label} marks a build-integrated step while declaring build time N/A`);
    }
  } else {
    findings.push(`${label}.buildTime.status must be enforced or not-applicable`);
  }
}

export function parsePlan3CostBudgetArguments(argv) {
  if (sameArray(argv, ['--check'])) return { mode: 'check', forwardedArgs: [] };
  if (sameArray(argv, ['--all'])) return { mode: 'all', forwardedArgs: [] };
  if (argv[0] === '--group' && typeof argv[1] === 'string' && argv.length === 2) {
    return { group: argv[1], mode: 'group', forwardedArgs: [] };
  }
  if (argv[0] === '--gate' && typeof argv[1] === 'string') {
    const forwardedArgs = argv.slice(2);
    if (forwardedArgs[0] === '--') forwardedArgs.shift();
    return { gateId: argv[1], mode: 'gate', forwardedArgs };
  }
  throw new TypeError(
    'Usage: security-cost-budget-runner.mjs --check | --gate <id> [-- <args>] | --group <id> | --all',
  );
}

export function evaluateGateBudget(gate, measurement, options = {}) {
  const findings = [];
  if (!Number.isFinite(measurement.wallTimeMs) || measurement.wallTimeMs < 0) {
    findings.push(`${gate.id}: wall-time measurement is unavailable`);
  } else if (measurement.wallTimeMs > gate.wallTimeCeilingMs) {
    findings.push(
      `${gate.id}: wall ${formatMs(measurement.wallTimeMs)} exceeds ${formatMs(gate.wallTimeCeilingMs)}`,
    );
  }

  if (measurement.peakRssMiB === null) {
    if (options.requireRss === true) {
      findings.push(`${gate.id}: peak-RSS measurement is unavailable on the intended runner`);
    }
  } else if (!Number.isFinite(measurement.peakRssMiB) || measurement.peakRssMiB < 0) {
    findings.push(`${gate.id}: peak-RSS measurement is invalid`);
  } else if (measurement.peakRssMiB > gate.peakRssCeilingMiB) {
    findings.push(
      `${gate.id}: peak RSS ${formatMiB(measurement.peakRssMiB)} exceeds ${formatMiB(gate.peakRssCeilingMiB)}`,
    );
  }

  if (gate.buildTime.status === 'enforced') {
    if (!Number.isFinite(measurement.buildTimeMs) || measurement.buildTimeMs < 0) {
      findings.push(`${gate.id}: build-time measurement is unavailable`);
    } else if (measurement.buildTimeMs > gate.buildTime.ceilingMs) {
      findings.push(
        `${gate.id}: build ${formatMs(measurement.buildTimeMs)} exceeds ${formatMs(gate.buildTime.ceilingMs)}`,
      );
    }
  } else if (measurement.buildTimeMs !== 0) {
    findings.push(`${gate.id}: a build-time measurement appeared on a reviewed N/A row`);
  }
  return { findings, ok: findings.length === 0 };
}

export function evaluateRunnerCalibration(intendedRunner, options = {}) {
  const env = options.env ?? process.env;
  if (env.GITHUB_ACTIONS !== 'true' || runnerMatches(intendedRunner, options)) return [];
  return [
    'Plan 3 cost budgets require the exact reviewed GitHub Actions calibration ' +
      `${intendedRunner.ciImage}, ${intendedRunner.operatingSystem}/${intendedRunner.architecture}, ` +
      `Node ${intendedRunner.node}`,
  ];
}

export async function runBudgetedGate(gate, manifest, options = {}) {
  if (gate.execution === 'self-check') {
    throw new TypeError('The self-check row must execute through runManifestSelfCheck().');
  }
  const root = options.repoRoot ?? findRepoRoot();
  const forwardedArgs = options.forwardedArgs ?? [];
  const startedAt = performance.now();
  let buildTimeMs = 0;
  let peakRssMiB = 0;
  let rssAvailable = false;
  let failedStep = null;

  for (const [stepIndex, step] of gate.steps.entries()) {
    const elapsed = performance.now() - startedAt;
    const remainingWallMs = gate.wallTimeCeilingMs - elapsed;
    const remainingBuildMs =
      step.buildIntegrated === true
        ? gate.buildTime.ceilingMs - buildTimeMs
        : Number.POSITIVE_INFINITY;
    const timeoutMs = Math.max(1, Math.min(remainingWallMs, remainingBuildMs));
    const command = [...step.command];
    if (stepIndex === gate.steps.length - 1) command.push(...forwardedArgs);
    const result = await runMeasuredCommand(command, {
      env: options.env ?? process.env,
      memoryCeilingMiB: gate.peakRssCeilingMiB,
      repoRoot: root,
      sampleIntervalMs: manifest.measurement.sampleIntervalMs,
      timeoutMs,
    });
    if (result.peakRssMiB !== null) {
      peakRssMiB = Math.max(peakRssMiB, result.peakRssMiB);
      rssAvailable = true;
    }
    if (step.buildIntegrated === true) buildTimeMs += result.wallTimeMs;
    if (result.exitCode !== 0 || result.terminationReason !== null) {
      failedStep = {
        command,
        exitCode: result.exitCode,
        index: stepIndex,
        terminationReason: result.terminationReason,
      };
      break;
    }
  }

  const measurement = {
    buildTimeMs,
    peakRssMiB: rssAvailable ? peakRssMiB : null,
    wallTimeMs: performance.now() - startedAt,
  };
  const runnerOptions = {
    architecture: options.architecture,
    env: options.env ?? process.env,
    node: options.node,
    platform: options.platform,
  };
  const intendedRunner = runnerMatches(manifest.intendedRunner, runnerOptions);
  const verdict = evaluateGateBudget(gate, measurement, { requireRss: intendedRunner });
  verdict.findings.unshift(...evaluateRunnerCalibration(manifest.intendedRunner, runnerOptions));
  verdict.ok = verdict.findings.length === 0;
  if (failedStep !== null) {
    verdict.findings.unshift(
      `${gate.id}: step ${failedStep.index + 1} failed${
        failedStep.exitCode === null ? '' : ` with exit ${failedStep.exitCode}`
      }${
        failedStep.terminationReason === null ? '' : ` (${String(failedStep.terminationReason)})`
      }`,
    );
    verdict.ok = false;
  }
  writeGateReport(
    root,
    gate,
    manifest,
    measurement,
    verdict,
    failedStep,
    options.reportDirectory,
    runnerOptions,
  );
  printGateResult(gate, manifest, measurement, verdict, intendedRunner);
  if (!verdict.ok) throw new Error(verdict.findings.join('\n'));
  return { measurement, verdict };
}

export function runManifestSelfCheck(manifest, options = {}) {
  const gate = manifest.gates.find((row) => row.id === 'cost-budget-manifest');
  if (!gate) throw new TypeError('cost-budget-manifest row is missing');
  const startedAt = options.startedAt ?? performance.now();
  const maxRssKiB = process.resourceUsage().maxRSS;
  const measurement = {
    buildTimeMs: 0,
    peakRssMiB: Number.isFinite(maxRssKiB) ? maxRssKiB / 1024 : null,
    wallTimeMs: performance.now() - startedAt,
  };
  const runnerOptions = {
    architecture: options.architecture,
    env: options.env ?? process.env,
    node: options.node,
    platform: options.platform,
  };
  const intendedRunner = runnerMatches(manifest.intendedRunner, runnerOptions);
  const verdict = evaluateGateBudget(gate, measurement, { requireRss: intendedRunner });
  verdict.findings.unshift(...evaluateRunnerCalibration(manifest.intendedRunner, runnerOptions));
  verdict.ok = verdict.findings.length === 0;
  writeGateReport(
    options.repoRoot ?? findRepoRoot(),
    gate,
    manifest,
    measurement,
    verdict,
    null,
    options.reportDirectory,
    runnerOptions,
  );
  printGateResult(gate, manifest, measurement, verdict, intendedRunner);
  if (!verdict.ok) throw new Error(verdict.findings.join('\n'));
  return { measurement, verdict };
}

export async function runMeasuredCommand(command, options) {
  const root = options.repoRoot;
  const timeFile = path.join(
    os.tmpdir(),
    `kovo-plan3-cost-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`,
  );
  const invocation = timeInvocation(command, timeFile);
  const startedAt = performance.now();
  let sampledPeakKiB = 0;
  let rssAvailable = false;
  let terminationReason = null;
  let settled = false;
  let terminationCleanup = Promise.resolve(true);
  let terminationRequested = false;

  const child = spawn(invocation.file, invocation.args, {
    cwd: root,
    detached: process.platform !== 'win32',
    env: options.env,
    stdio: 'inherit',
  });

  const relaySignal = (signal) => {
    if (settled || terminationReason !== null) return;
    terminationReason = `runner received ${signal}`;
    terminationRequested = true;
    terminationCleanup = terminateChildTree(child);
  };
  const relayInterrupt = () => relaySignal('SIGINT');
  const relayTermination = () => relaySignal('SIGTERM');
  process.once('SIGINT', relayInterrupt);
  process.once('SIGTERM', relayTermination);

  const sample = () => {
    const rssKiB = collectProcessTreeRssKiB(child.pid);
    if (rssKiB === null) return;
    rssAvailable = true;
    sampledPeakKiB = Math.max(sampledPeakKiB, rssKiB);
    if (rssKiB / 1024 > options.memoryCeilingMiB && terminationReason === null) {
      terminationReason = `peak RSS exceeded ${options.memoryCeilingMiB} MiB`;
      terminationRequested = true;
      terminationCleanup = terminateChildTree(child);
    }
  };
  sample();
  const sampler = setInterval(sample, options.sampleIntervalMs);
  sampler.unref();
  const timeout = setTimeout(() => {
    if (settled || terminationReason !== null) return;
    terminationReason = `time ceiling exceeded after ${formatMs(options.timeoutMs)}`;
    terminationRequested = true;
    terminationCleanup = terminateChildTree(child);
  }, options.timeoutMs);
  timeout.unref();

  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal && terminationReason === null) terminationReason = `terminated by ${signal}`;
      resolve(code);
    });
  }).finally(() => {
    settled = true;
    clearInterval(sampler);
    clearTimeout(timeout);
    process.removeListener('SIGINT', relayInterrupt);
    process.removeListener('SIGTERM', relayTermination);
  });

  if (terminationRequested) {
    const terminated = await terminationCleanup;
    if (!terminated) {
      terminationReason = `${terminationReason ?? 'termination requested'}; process group survived SIGKILL`;
    }
  }

  const wallTimeMs = performance.now() - startedAt;
  let timePeakKiB = null;
  try {
    timePeakKiB = parseTimePeakRssKiB(readFileSync(timeFile, 'utf8'), process.platform);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  try {
    unlinkSync(timeFile);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      process.stderr.write(`plan3-cost could not remove timing file: ${String(error)}\n`);
    }
  }
  if (timePeakKiB !== null) rssAvailable = true;
  const peakRssKiB = Math.max(sampledPeakKiB, timePeakKiB ?? 0);
  return {
    exitCode,
    peakRssMiB: rssAvailable ? peakRssKiB / 1024 : null,
    terminationReason,
    wallTimeMs,
  };
}

function timeInvocation(command, timeFile) {
  if (process.platform === 'linux') {
    return { file: '/usr/bin/time', args: ['-v', '-o', timeFile, '--', ...command] };
  }
  if (process.platform === 'darwin') {
    return { file: '/usr/bin/time', args: ['-l', '-o', timeFile, ...command] };
  }
  return { file: command[0], args: command.slice(1) };
}

export function parseTimePeakRssKiB(output, platform) {
  const bytes = parseTimePeakRssBytes(output, platform);
  return bytes === undefined ? null : bytes / 1024;
}

export function collectProcessTreeRssKiB(rootPid, options = {}) {
  if (!Number.isSafeInteger(rootPid) || rootPid <= 0) return null;
  const platform = options.platform ?? process.platform;
  if (platform === 'linux') return collectLinuxProcessTreeRssKiB(rootPid, options);
  if (platform === 'darwin') return collectDarwinProcessTreeRssKiB(rootPid, options);
  return null;
}

function collectLinuxProcessTreeRssKiB(rootPid, options) {
  const procRoot = options.procRoot ?? '/proc';
  let entries;
  try {
    entries = readdirSync(procRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  const rows = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) continue;
    try {
      const status = readFileSync(path.join(procRoot, entry.name, 'status'), 'utf8');
      const pid = Number(/^Pid:\s+(\d+)/mu.exec(status)?.[1]);
      const parentPid = Number(/^PPid:\s+(\d+)/mu.exec(status)?.[1]);
      const rssKiB = Number(/^VmRSS:\s+(\d+)\s+kB/mu.exec(status)?.[1] ?? 0);
      if (Number.isSafeInteger(pid) && Number.isSafeInteger(parentPid)) {
        rows.push({ parentPid, pid, rssKiB });
      }
    } catch {
      // Processes may exit between directory enumeration and status reads.
    }
  }
  return sumDescendantRssKiB(rootPid, rows);
}

function collectDarwinProcessTreeRssKiB(rootPid, options) {
  const result = (options.spawnSync ?? spawnSync)('/bin/ps', ['-axo', 'pid=,ppid=,rss='], {
    encoding: 'utf8',
  });
  if (result.status !== 0 || typeof result.stdout !== 'string') return null;
  const rows = result.stdout
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/u).map(Number))
    .filter(
      ([pid, parentPid, rssKiB]) =>
        Number.isSafeInteger(pid) && Number.isSafeInteger(parentPid) && Number.isFinite(rssKiB),
    )
    .map(([pid, parentPid, rssKiB]) => ({ parentPid, pid, rssKiB }));
  return sumDescendantRssKiB(rootPid, rows);
}

export function sumDescendantRssKiB(rootPid, rows) {
  const children = new Map();
  const rssByPid = new Map();
  for (const row of rows) {
    rssByPid.set(row.pid, row.rssKiB);
    const siblings = children.get(row.parentPid) ?? [];
    siblings.push(row.pid);
    children.set(row.parentPid, siblings);
  }
  if (!rssByPid.has(rootPid)) return 0;
  let total = 0;
  const pending = [rootPid];
  const visited = new Set();
  while (pending.length > 0) {
    const pid = pending.pop();
    if (visited.has(pid)) continue;
    visited.add(pid);
    total += rssByPid.get(pid) ?? 0;
    pending.push(...(children.get(pid) ?? []));
  }
  return total;
}

async function terminateChildTree(child) {
  signalChildTree(child, 'SIGTERM');
  if (await waitForChildTreeExit(child, 2000)) return true;
  signalChildTree(child, 'SIGKILL');
  return waitForChildTreeExit(child, 2000);
}

function signalChildTree(child, signal) {
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function childTreeExists(child) {
  if (process.platform === 'win32') return child.exitCode === null && child.signalCode === null;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    throw error;
  }
}

async function waitForChildTreeExit(child, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (childTreeExists(child)) {
    const remainingMs = deadline - performance.now();
    if (remainingMs <= 0) return false;
    await new Promise((resolve) => {
      setTimeout(resolve, Math.min(25, remainingMs));
    });
  }
  return true;
}

function writeGateReport(
  root,
  gate,
  manifest,
  measurement,
  verdict,
  failedStep,
  reportDirectory = DEFAULT_PLAN3_COST_REPORT_DIRECTORY,
  runnerOptions = {},
) {
  const directory = path.resolve(root, reportDirectory);
  mkdirSync(directory, { recursive: true });
  const report = {
    schema: 'kovo.plan3-security-gate-cost-report/v1',
    budgetSchema: manifest.schema,
    budgetVersion: manifest.budgetVersion,
    gate: {
      buildTime: gate.buildTime,
      budgetVersion: gate.budgetVersion,
      id: gate.id,
      ...(gate.isolatedMemory === undefined ? {} : { isolatedMemory: gate.isolatedMemory }),
      peakRssCeilingMiB: gate.peakRssCeilingMiB,
      planSections: gate.planSections,
      wallTimeCeilingMs: gate.wallTimeCeilingMs,
    },
    measurement: {
      buildTimeMs: round(measurement.buildTimeMs),
      peakRssMiB: measurement.peakRssMiB === null ? null : round(measurement.peakRssMiB),
      runner: `${process.platform}-${process.arch}`,
      runnerMatchesIntended: runnerMatches(manifest.intendedRunner, runnerOptions),
      wallTimeMs: round(measurement.wallTimeMs),
    },
    result: {
      failedStep,
      findings: verdict.findings,
      ok: verdict.ok,
    },
  };
  writeFileSync(path.join(directory, `${gate.id}.json`), `${JSON.stringify(report, null, 2)}\n`);
}

function printGateResult(gate, manifest, measurement, verdict, intendedRunner) {
  const build =
    gate.buildTime.status === 'enforced'
      ? `${formatMs(measurement.buildTimeMs)}/${formatMs(gate.buildTime.ceilingMs)}`
      : 'N/A';
  const rss =
    measurement.peakRssMiB === null
      ? `unavailable/${gate.peakRssCeilingMiB} MiB`
      : `${formatMiB(measurement.peakRssMiB)}/${formatMiB(gate.peakRssCeilingMiB)}`;
  const isolated =
    gate.isolatedMemory === undefined
      ? ''
      : ` isolated=${formatMiB(gate.isolatedMemory.ceilingMiB)}/${formatMiB(gate.isolatedMemory.combinedCeilingMiB)} combined`;
  process.stdout.write(
    `plan3-cost gate=${gate.id} budget=${manifest.budgetVersion}.${gate.budgetVersion} wall=${formatMs(measurement.wallTimeMs)}/${formatMs(gate.wallTimeCeilingMs)} rss=${rss}${isolated} build=${build} runner=${process.platform}-${process.arch}${intendedRunner ? '' : ':non-calibration'} ${verdict.ok ? 'OK' : 'FAILED'}\n`,
  );
}

export function runnerMatches(intendedRunner, options = {}) {
  const env = options.env ?? process.env;
  const node = options.node ?? process.versions.node;
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;
  let osRelease = options.osRelease;
  if (osRelease === undefined && platform === 'linux') {
    try {
      osRelease = readFileSync('/etc/os-release', 'utf8');
    } catch {
      osRelease = '';
    }
  }
  return (
    platform === intendedRunner.operatingSystem &&
    architecture === intendedRunner.architecture &&
    node === intendedRunner.node &&
    env.GITHUB_ACTIONS === 'true' &&
    env.RUNNER_OS === 'Linux' &&
    env.ImageOS === 'ubuntu24' &&
    osReleaseField(osRelease ?? '', 'ID') === 'ubuntu' &&
    osReleaseField(osRelease ?? '', 'VERSION_ID') === '24.04'
  );
}

function osReleaseField(source, name) {
  const match = new RegExp(`^${name}=(?:"([^"]*)"|'([^']*)'|([^\\s#]+))$`, 'mu').exec(source);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

async function main(argv = process.argv.slice(2)) {
  const startedAt = performance.now();
  const root = findRepoRoot();
  const parsed = parsePlan3CostBudgetArguments(argv);
  const manifest = loadPlan3CostBudgetManifest({ repoRoot: root });
  if (parsed.mode === 'check') {
    runManifestSelfCheck(manifest, { repoRoot: root, startedAt });
    process.stdout.write(
      `plan3-cost denominator=${manifest.gates.length} build-integrated=${manifest.gates.filter((gate) => gate.buildTime.status === 'enforced').length} reviewed-na=${manifest.gates.filter((gate) => gate.buildTime.status === 'not-applicable').length}\n`,
    );
    return;
  }

  let gates;
  if (parsed.mode === 'gate') {
    gates = manifest.gates.filter((gate) => gate.id === parsed.gateId);
    if (gates.length === 0) throw new TypeError(`Unknown Plan 3 cost-budget gate ${parsed.gateId}`);
  } else if (parsed.mode === 'group') {
    gates = manifest.gates.filter((gate) => gate.groups.includes(parsed.group));
    if (gates.length === 0)
      throw new TypeError(`Unknown or empty Plan 3 cost-budget group ${parsed.group}`);
  } else {
    gates = manifest.gates.filter((gate) => gate.execution !== 'self-check');
  }

  for (const gate of gates) {
    await runBudgetedGate(gate, manifest, {
      forwardedArgs: parsed.forwardedArgs,
      repoRoot: root,
    });
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function formatMs(value) {
  return `${Math.round(value)}ms`;
}

function formatMiB(value) {
  return `${Math.round(value * 10) / 10} MiB`;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

if (isMainEntry(import.meta.url)) await runGate(main);
