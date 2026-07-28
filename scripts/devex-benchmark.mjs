#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseTimePeakRssBytes } from './lib/process-cost.mjs';
import { repoRoot as defaultRepoRoot } from './public-packages.mjs';

export const DEVEX_BUDGETS_SCHEMA = 'kovo-devex-budgets/v1';
export const DEVEX_BENCHMARK_SCENARIO_SCHEMA = 'kovo-devex-benchmark-scenario/v1';
export const DEVEX_BENCHMARK_REPORT_SCHEMA = 'kovo-devex-benchmark-report/v1';
export const DEVEX_BUDGET_PROPOSAL_SCHEMA = 'kovo-devex-budget-proposal/v1';

const PHASES = Object.freeze(['cold', 'warm', 'oneFileIncremental']);
const METRIC_UNITS = new Set(['bytes', 'ms']);
const STATISTICS = new Set(['median', 'p95']);

function compareStrings(left, right) {
  return left.localeCompare(right);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  const absolute = path.resolve(filePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`);
}

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function median(values) {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.some((value) => !Number.isFinite(value))
  ) {
    throw new Error('median requires a non-empty array of finite numbers');
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function percentile(values, quantile) {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.some((value) => !Number.isFinite(value)) ||
    !Number.isFinite(quantile) ||
    quantile < 0 ||
    quantile > 1
  ) {
    throw new Error('percentile requires finite samples and a quantile between zero and one');
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
  return sorted[index];
}

export function statisticValue(values, statistic) {
  if (statistic === 'median') return median(values);
  if (statistic === 'p95') return percentile(values, 0.95);
  throw new Error(`Unsupported statistic: ${statistic}`);
}

export function medianAbsoluteDeviation(values) {
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
}

function validateCommand(command, label) {
  if (
    !Array.isArray(command) ||
    command.length === 0 ||
    command.some((part) => typeof part !== 'string' || part.length === 0)
  ) {
    throw new Error(`${label} must be a non-empty string array`);
  }
}

export function validateBenchmarkScenario(scenario) {
  const findings = [];
  if (scenario?.schema !== DEVEX_BENCHMARK_SCENARIO_SCHEMA) {
    findings.push(`scenario.schema must be ${DEVEX_BENCHMARK_SCENARIO_SCHEMA}`);
  }
  if (typeof scenario?.name !== 'string' || scenario.name.trim().length === 0) {
    findings.push('scenario.name must be a non-empty string');
  }
  for (const phase of PHASES) {
    try {
      validateCommand(scenario?.phases?.[phase]?.command, `scenario.phases.${phase}.command`);
    } catch (error) {
      findings.push(error.message);
    }
  }
  const files = scenario?.browserBootstrap?.files;
  if (
    !Array.isArray(files) ||
    files.length === 0 ||
    files.some((file) => typeof file !== 'string')
  ) {
    findings.push('scenario.browserBootstrap.files must be a non-empty string array');
  }
  if (
    scenario?.runnerName !== undefined &&
    (typeof scenario.runnerName !== 'string' || scenario.runnerName.trim().length === 0)
  ) {
    findings.push('scenario.runnerName must be a non-empty string when provided');
  }
  return findings;
}

function runnerFingerprint(runnerName) {
  return {
    name: runnerName ?? null,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cpuModel: os.cpus()[0]?.model ?? 'unknown',
  };
}

function timeInvocation(command, platform) {
  if (!existsSync('/usr/bin/time')) return null;
  if (platform === 'darwin') return ['/usr/bin/time', ['-l', ...command]];
  if (platform === 'linux') return ['/usr/bin/time', ['-v', ...command]];
  return null;
}

/**
 * Measure a command without a shell. `/usr/bin/time` owns peak RSS; the monotonic clock owns
 * duration so command stderr cannot forge either metric.
 */
export function measureCommand(command, options = {}) {
  validateCommand(command, 'command');
  const cwd = path.resolve(options.cwd ?? defaultRepoRoot);
  const platform = options.platform ?? process.platform;
  const invocation = timeInvocation(command, platform);
  const executable = invocation?.[0] ?? command[0];
  const args = invocation?.[1] ?? command.slice(1);
  const spawn = options.spawnSync ?? spawnSync;
  const started = process.hrtime.bigint();
  const result = spawn(executable, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
  const peakRssBytes =
    invocation === null ? null : (parseTimePeakRssBytes(result.stderr ?? '', platform) ?? null);
  return {
    durationMs,
    peakRssBytes,
    exitCode: result.status,
    signal: result.signal ?? null,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error?.message ?? null,
  };
}

export function browserBootstrapBytes(files, options = {}) {
  const root = path.resolve(options.root ?? defaultRepoRoot);
  let total = 0;
  const measured = [];
  for (const relative of [...files].sort(compareStrings)) {
    const absolute = path.resolve(root, relative);
    const rootPrefix = `${root}${path.sep}`;
    if (absolute !== root && !absolute.startsWith(rootPrefix)) {
      throw new Error(`browser bootstrap path escapes scenario root: ${relative}`);
    }
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      throw new Error(`browser bootstrap file is missing: ${relative}`);
    }
    const bytes = statSync(absolute).size;
    total += bytes;
    measured.push({ path: relative.split(path.sep).join('/'), bytes });
  }
  return { bytes: total, files: measured };
}

function sampleSummary(samples) {
  return {
    count: samples.length,
    min: Math.min(...samples),
    median: median(samples),
    p95: percentile(samples, 0.95),
    max: Math.max(...samples),
    medianAbsoluteDeviation: medianAbsoluteDeviation(samples),
  };
}

/**
 * Run all three scorecard timing profiles. Tests inject `measure` so statistical and schema
 * behavior are deterministic; production calls use the real monotonic/RSS measurement.
 */
export function runBenchmarkScenario(scenario, options = {}) {
  const findings = validateBenchmarkScenario(scenario);
  if (findings.length > 0)
    throw new Error(`Invalid benchmark scenario:\n- ${findings.join('\n- ')}`);
  const samples = options.samples ?? 5;
  if (!Number.isInteger(samples) || samples <= 0) {
    throw new Error('samples must be a positive integer');
  }
  const root = path.resolve(options.root ?? defaultRepoRoot);
  const measure = options.measure ?? ((command, context) => measureCommand(command, context));
  const metrics = {};
  const commands = {};

  for (const phase of PHASES) {
    const phaseConfig = scenario.phases[phase];
    const durationSamples = [];
    const rssSamples = [];
    commands[phase] = {
      command: [...phaseConfig.command],
      cwd: phaseConfig.cwd ?? '.',
    };
    for (let index = 0; index < samples; index += 1) {
      const result = measure(phaseConfig.command, {
        cwd: path.resolve(root, phaseConfig.cwd ?? '.'),
        phase,
        sampleIndex: index,
      });
      if (result.exitCode !== 0 || result.signal || result.error) {
        throw new Error(
          `${phase} sample ${index + 1} failed: exit=${String(result.exitCode)} signal=${String(
            result.signal,
          )} ${result.error ?? result.stderr ?? ''}`.trim(),
        );
      }
      if (!finiteNonNegative(result.durationMs)) {
        throw new Error(`${phase} sample ${index + 1} returned an invalid duration`);
      }
      durationSamples.push(result.durationMs);
      if (result.peakRssBytes !== null && result.peakRssBytes !== undefined) {
        if (!finiteNonNegative(result.peakRssBytes)) {
          throw new Error(`${phase} sample ${index + 1} returned invalid peak RSS`);
        }
        rssSamples.push(result.peakRssBytes);
      }
    }
    metrics[`check.${phase}.durationMs`] = {
      unit: 'ms',
      samples: durationSamples,
      summary: sampleSummary(durationSamples),
    };
    metrics[`check.${phase}.peakRssBytes`] = {
      unit: 'bytes',
      samples: rssSamples,
      summary: rssSamples.length === 0 ? null : sampleSummary(rssSamples),
    };
  }

  const browser = browserBootstrapBytes(scenario.browserBootstrap.files, { root });
  metrics['browser.bootstrapBytes'] = {
    unit: 'bytes',
    samples: [browser.bytes],
    summary: sampleSummary([browser.bytes]),
    files: browser.files,
  };

  return {
    schema: DEVEX_BENCHMARK_REPORT_SCHEMA,
    scenario: scenario.name,
    runner: runnerFingerprint(scenario.runnerName),
    sampleCount: samples,
    commands,
    metrics,
  };
}

export function validateBudgets(budgets) {
  const findings = [];
  if (budgets?.schema !== DEVEX_BUDGETS_SCHEMA) {
    findings.push(`schema must be ${DEVEX_BUDGETS_SCHEMA}`);
  }
  if (!Number.isInteger(budgets?.procedure?.minimumStatisticalSamples)) {
    findings.push('procedure.minimumStatisticalSamples must be an integer');
  } else if (budgets.procedure.minimumStatisticalSamples < 2) {
    findings.push('procedure.minimumStatisticalSamples must be at least 2');
  }
  if (!STATISTICS.has(budgets?.procedure?.statistic)) {
    findings.push('procedure.statistic must be median or p95');
  }
  if (budgets?.procedure?.noiseStatistic !== 'median-absolute-deviation') {
    findings.push('procedure.noiseStatistic must be median-absolute-deviation');
  }
  if (budgets?.procedure?.thresholdFormula !== 'budget + noiseMultiplier * noise') {
    findings.push('procedure.thresholdFormula must be budget + noiseMultiplier * noise');
  }
  if (!budgets?.metrics || typeof budgets.metrics !== 'object' || Array.isArray(budgets.metrics)) {
    findings.push('metrics must be an object');
    return findings;
  }
  for (const [metricId, metric] of Object.entries(budgets.metrics)) {
    if (!METRIC_UNITS.has(metric?.unit)) findings.push(`${metricId}.unit must be bytes or ms`);
    if (metric?.direction !== 'max') findings.push(`${metricId}.direction must be max`);
    if (!['deterministic', 'statistical'].includes(metric?.sampling)) {
      findings.push(`${metricId}.sampling must be deterministic or statistical`);
    }
    if (metric?.provisionalTarget !== null && !finiteNonNegative(metric?.provisionalTarget)) {
      findings.push(`${metricId}.provisionalTarget must be null or a non-negative number`);
    }
    if (metric?.ratification === null) continue;
    const record = metric?.ratification;
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      findings.push(`${metricId}.ratification must be null or an object`);
      continue;
    }
    if (typeof record.targetRationale !== 'string' || record.targetRationale.trim().length < 12) {
      findings.push(`${metricId}.ratification.targetRationale must be substantive`);
    }
    if (!finiteNonNegative(record.budget)) findings.push(`${metricId}.ratification.budget invalid`);
    if (!finiteNonNegative(record.noise)) findings.push(`${metricId}.ratification.noise invalid`);
    if (!finiteNonNegative(record.noiseMultiplier)) {
      findings.push(`${metricId}.ratification.noiseMultiplier invalid`);
    }
    if (!finiteNonNegative(record.threshold)) {
      findings.push(`${metricId}.ratification.threshold invalid`);
    } else {
      const expected = record.budget + record.noiseMultiplier * record.noise;
      if (Math.abs(record.threshold - expected) > Number.EPSILON * Math.max(1, expected)) {
        findings.push(`${metricId}.ratification.threshold does not match the recorded formula`);
      }
    }
    if (!Number.isInteger(record.sampleCount) || record.sampleCount <= 0) {
      findings.push(`${metricId}.ratification.sampleCount invalid`);
    }
    if (!STATISTICS.has(record.statistic)) {
      findings.push(`${metricId}.ratification.statistic must be median or p95`);
    }
    if (!finiteNonNegative(record.baseline)) {
      findings.push(`${metricId}.ratification.baseline invalid`);
    }
    if (typeof record.runner !== 'string' || record.runner.length === 0) {
      findings.push(`${metricId}.ratification.runner is required`);
    }
  }
  return findings;
}

function validateProposal(proposal) {
  const findings = [];
  if (proposal?.schema !== DEVEX_BUDGET_PROPOSAL_SCHEMA) {
    findings.push(`proposal.schema must be ${DEVEX_BUDGET_PROPOSAL_SCHEMA}`);
  }
  if (typeof proposal?.runner !== 'string' || proposal.runner.trim().length === 0) {
    findings.push('proposal.runner must be a non-empty string');
  }
  if (
    !proposal?.metrics ||
    typeof proposal.metrics !== 'object' ||
    Array.isArray(proposal.metrics)
  ) {
    findings.push('proposal.metrics must be an object');
  }
  return findings;
}

/**
 * Ratification is deliberately a second operation over an already-recorded baseline. A proposal
 * supplies the product target and rationale; the harness never invents a threshold from one run.
 */
export function ratifyBudgets(budgets, baselineReport, proposal) {
  const findings = [...validateBudgets(budgets), ...validateProposal(proposal)];
  if (baselineReport?.schema !== DEVEX_BENCHMARK_REPORT_SCHEMA) {
    findings.push(`baseline report schema must be ${DEVEX_BENCHMARK_REPORT_SCHEMA}`);
  }
  if (findings.length > 0)
    throw new Error(`Cannot ratify DevEx budgets:\n- ${findings.join('\n- ')}`);
  if (baselineReport.runner?.name !== proposal.runner) {
    throw new Error(
      `baseline runner ${JSON.stringify(baselineReport.runner?.name)} does not match proposal runner ${JSON.stringify(proposal.runner)}`,
    );
  }

  const updated = structuredClone(budgets);
  updated.runner = {
    status: 'ratified',
    name: proposal.runner,
    requirements: budgets.runner?.requirements ?? [],
    baselineFingerprint: baselineReport.runner,
  };

  for (const [metricId, proposed] of Object.entries(proposal.metrics)) {
    const metric = updated.metrics[metricId];
    if (!metric) throw new Error(`proposal references unknown metric: ${metricId}`);
    const baselineMetric = baselineReport.metrics?.[metricId];
    const samples = baselineMetric?.samples;
    if (
      !Array.isArray(samples) ||
      samples.length === 0 ||
      samples.some((value) => !finiteNonNegative(value))
    ) {
      throw new Error(`baseline report has no valid samples for ${metricId}`);
    }
    const requiredSamples =
      metric.sampling === 'deterministic' ? 1 : updated.procedure.minimumStatisticalSamples;
    if (samples.length < requiredSamples) {
      throw new Error(
        `${metricId} has ${samples.length} baseline samples; ${requiredSamples} required`,
      );
    }
    if (!finiteNonNegative(proposed.budget)) {
      throw new Error(`${metricId} proposal budget must be a non-negative number`);
    }
    if (
      typeof proposed.targetRationale !== 'string' ||
      proposed.targetRationale.trim().length < 12
    ) {
      throw new Error(`${metricId} proposal targetRationale must be substantive`);
    }
    const statistic = proposed.statistic ?? updated.procedure.statistic;
    if (!STATISTICS.has(statistic)) throw new Error(`${metricId} statistic is unsupported`);
    const noiseMultiplier = proposed.noiseMultiplier;
    if (!finiteNonNegative(noiseMultiplier)) {
      throw new Error(`${metricId} proposal noiseMultiplier must be non-negative`);
    }
    const noise = metric.sampling === 'deterministic' ? 0 : medianAbsoluteDeviation(samples);
    const budget = proposed.budget;
    metric.ratification = {
      runner: proposal.runner,
      baselineReportSchema: baselineReport.schema,
      baselineScenario: baselineReport.scenario,
      sampleCount: samples.length,
      statistic,
      baseline: statisticValue(samples, statistic),
      targetRationale: proposed.targetRationale,
      budget,
      noiseStatistic: updated.procedure.noiseStatistic,
      noise,
      noiseMultiplier,
      threshold: budget + noiseMultiplier * noise,
    };
  }
  const validation = validateBudgets(updated);
  if (validation.length > 0) {
    throw new Error(`Ratified DevEx budgets are invalid:\n- ${validation.join('\n- ')}`);
  }
  return updated;
}

export function evaluateBudgets(budgets, report) {
  const findings = validateBudgets(budgets);
  if (findings.length > 0) throw new Error(`Invalid DevEx budgets:\n- ${findings.join('\n- ')}`);
  if (report?.schema !== DEVEX_BENCHMARK_REPORT_SCHEMA) {
    throw new Error(`report.schema must be ${DEVEX_BENCHMARK_REPORT_SCHEMA}`);
  }
  const results = [];
  for (const [metricId, metric] of Object.entries(budgets.metrics)) {
    if (metric.ratification === null) {
      results.push({ metric: metricId, status: 'unratified' });
      continue;
    }
    if (report.runner?.name !== metric.ratification.runner) {
      results.push({
        metric: metricId,
        status: 'runner-mismatch',
        expectedRunner: metric.ratification.runner,
        actualRunner: report.runner?.name ?? null,
      });
      continue;
    }
    const samples = report.metrics?.[metricId]?.samples;
    if (!Array.isArray(samples) || samples.length === 0) {
      results.push({
        metric: metricId,
        status: 'missing',
        threshold: metric.ratification.threshold,
      });
      continue;
    }
    const observed = statisticValue(samples, metric.ratification.statistic);
    results.push({
      metric: metricId,
      status: observed > metric.ratification.threshold ? 'breach' : 'pass',
      observed,
      statistic: metric.ratification.statistic,
      threshold: metric.ratification.threshold,
    });
  }
  return {
    pass: results.every(
      (result) => !['breach', 'missing', 'runner-mismatch'].includes(result.status),
    ),
    results,
  };
}

function parseArgs(argv) {
  const args = {
    budgets: path.join(defaultRepoRoot, 'devex-budgets.json'),
    samples: 5,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--scenario') args.scenario = argv[++index];
    else if (arg === '--samples') args.samples = Number(argv[++index]);
    else if (arg === '--output') args.output = argv[++index];
    else if (arg === '--budgets') args.budgets = argv[++index];
    else if (arg === '--evaluate') args.evaluate = true;
    else if (arg === '--ratify') args.ratify = true;
    else if (arg === '--baseline') args.baseline = argv[++index];
    else if (arg === '--proposal') args.proposal = argv[++index];
    else if (arg === '--write') args.write = true;
    else if (arg === '--check-budgets') args.checkBudgets = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/devex-benchmark.mjs --scenario <file> [--samples N] [--output <file>] [--evaluate]',
    '  node scripts/devex-benchmark.mjs --ratify --baseline <report> --proposal <file> [--write]',
    '  node scripts/devex-benchmark.mjs --check-budgets',
    '',
    'Budgets remain non-binding until a separate baseline report and proposal ratify them.',
    '',
  ].join('\n');
}

export function runDevexBenchmark(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(usage());
    return 0;
  }
  const budgets = readJson(path.resolve(args.budgets));
  if (args.checkBudgets) {
    const findings = validateBudgets(budgets);
    if (findings.length > 0) {
      process.stderr.write(`${findings.join('\n')}\n`);
      return 1;
    }
    process.stdout.write(
      `devex-budgets/v1 metrics=${Object.keys(budgets.metrics).length} ratified=${
        Object.values(budgets.metrics).filter((metric) => metric.ratification !== null).length
      }\nOK\n`,
    );
    return 0;
  }
  if (args.ratify) {
    if (!args.baseline || !args.proposal) {
      throw new Error('--ratify requires --baseline and --proposal');
    }
    const updated = ratifyBudgets(
      budgets,
      readJson(path.resolve(args.baseline)),
      readJson(path.resolve(args.proposal)),
    );
    if (args.write) writeJson(args.budgets, updated);
    else process.stdout.write(`${JSON.stringify(updated, null, 2)}\n`);
    return 0;
  }
  if (!args.scenario) {
    process.stderr.write(usage());
    return 2;
  }
  const scenarioPath = path.resolve(args.scenario);
  const report = runBenchmarkScenario(readJson(scenarioPath), {
    root: path.dirname(scenarioPath),
    samples: args.samples,
  });
  if (args.evaluate) report.evaluation = evaluateBudgets(budgets, report);
  if (args.output) writeJson(args.output, report);
  else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.evaluation?.pass === false ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = runDevexBenchmark();
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}
