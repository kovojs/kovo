#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  ESCAPE_CENSUS_DOORS,
  evaluateEscapeCensus,
  formatEscapeCensusReport,
  runEscapeCensusCli,
} from './escape-census-gate.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = resolve(repoRoot, 'security/fixtures/escape-census-real-app');
const fixtureApp = resolve(fixtureRoot, 'app.mjs');
const fixtureOut = resolve(fixtureRoot, 'dist');

export const ESCAPE_CENSUS_BASELINE_COMMAND = 'pnpm run check:escape-census:baseline';
export const ESCAPE_CENSUS_GATE_COMMAND =
  'node scripts/escape-census-gate.mjs --config security/escape-census-config.json';
export const ESCAPE_CENSUS_BASELINE_CONFIG = 'security/escape-census-config.json';

const defaultConfigPath = resolve(repoRoot, ESCAPE_CENSUS_BASELINE_CONFIG);
const defaultBaselinePath = resolve(repoRoot, 'security/escape-census-baseline.json');
const expectedNegativeCheckIds = Object.freeze([
  'budget-ceiling',
  'missing-producer-provenance',
  'wrong-producer-provenance',
]);

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonBlank(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `${label} is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function readRelativeJson(base, value, label) {
  if (!nonBlank(value)) throw new TypeError(`${label} path must be a non-blank string`);
  return readJson(resolve(base, value), label);
}

export function loadEscapeCensusInputs(configPath = defaultConfigPath) {
  const absoluteConfig = resolve(configPath);
  const config = readJson(absoluteConfig, 'escape census config');
  if (!record(config) || config.schema !== 'kovo.escape-census-config/v1') {
    throw new TypeError('escape census config must use kovo.escape-census-config/v1');
  }
  if (!Array.isArray(config.apps) || config.apps.length === 0) {
    throw new TypeError('escape census config must declare at least one app');
  }
  const base = dirname(absoluteConfig);
  return {
    apps: config.apps.map((entry, index) => {
      if (!record(entry)) throw new TypeError(`config.apps[${index}] must be an object`);
      return {
        app: entry.app,
        graph: readRelativeJson(base, entry.graph, `config.apps[${index}].graph`),
        package: entry.package,
      };
    }),
    budgets: readRelativeJson(base, config.budgets, 'config.budgets'),
    previousBudgets: readRelativeJson(base, config.previousBudgets, 'config.previousBudgets'),
  };
}

function exactJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requireExact(value, expected, label) {
  if (!exactJson(value, expected)) {
    throw new Error(
      `${label} drifted\nexpected=${JSON.stringify(expected)}\nactual=${JSON.stringify(value)}`,
    );
  }
}

function appInput(inputs, app) {
  const match = inputs.apps.find((entry) => entry.app === app);
  if (!match) throw new Error(`negative check names unknown app ${JSON.stringify(app)}`);
  return match;
}

function negativeBudgetFindings(inputs, check, report) {
  if (!ESCAPE_CENSUS_DOORS.includes(check.door)) {
    throw new Error(`budget-ceiling names unsupported door ${JSON.stringify(check.door)}`);
  }
  const packageReport = report.packages.find((entry) => entry.package === check.package);
  const count = packageReport?.doors?.[check.door];
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new Error('budget-ceiling must target a non-zero observed escape count');
  }
  const candidate = structuredClone(inputs);
  const packageBudgets = candidate.budgets?.packages?.[check.package];
  if (!record(packageBudgets)) {
    throw new Error(`budget-ceiling names unknown package ${JSON.stringify(check.package)}`);
  }
  packageBudgets[check.door] = count - 1;
  return evaluateEscapeCensus(candidate).findings;
}

function negativeProvenanceFindings(inputs, check, wrongSource) {
  const candidate = structuredClone(inputs);
  const graph = appInput(candidate, check.app).graph;
  if (!record(graph)) throw new Error(`${check.id} requires an object graph`);
  if (wrongSource) {
    if (!ESCAPE_CENSUS_DOORS.includes(check.door)) {
      throw new Error(`${check.id} names unsupported door ${JSON.stringify(check.door)}`);
    }
    if (!record(graph.escapeCensus?.sources)) {
      throw new Error(`${check.id} requires producer provenance to mutate`);
    }
    graph.escapeCensus.sources[check.door] = 'unreviewed-producer';
  } else {
    delete graph.escapeCensus;
  }
  return evaluateEscapeCensus(candidate).findings;
}

/**
 * Verify the exact report and the persisted, fail-closed negative controls. Metric E measures
 * declared escape authority; it remains narrower than the framework's security proof (SPEC §2).
 */
export function verifyEscapeCensusBaseline({ baseline, inputs }) {
  if (!record(baseline) || baseline.schema !== 'kovo.escape-census-baseline/v1') {
    throw new TypeError('baseline must use kovo.escape-census-baseline/v1');
  }
  requireExact(baseline.command, ESCAPE_CENSUS_BASELINE_COMMAND, 'baseline command');
  requireExact(baseline.gateCommand, ESCAPE_CENSUS_GATE_COMMAND, 'baseline gate command');
  requireExact(baseline.config, ESCAPE_CENSUS_BASELINE_CONFIG, 'baseline config path');

  const result = evaluateEscapeCensus(inputs);
  if (result.findings.length > 0) {
    throw new Error(`representative census failed:\n${result.findings.join('\n')}`);
  }
  requireExact(result.report, baseline.report, 'escape census baseline report');

  if (!Array.isArray(baseline.negativeChecks)) {
    throw new TypeError('baseline.negativeChecks must be an array');
  }
  requireExact(
    baseline.negativeChecks.map((check) => check?.id),
    expectedNegativeCheckIds,
    'baseline negative-check membership',
  );
  for (const check of baseline.negativeChecks) {
    if (!record(check) || !Array.isArray(check.expectedFindings)) {
      throw new TypeError('each baseline negative check must declare expectedFindings');
    }
    const findings =
      check.id === 'budget-ceiling'
        ? negativeBudgetFindings(inputs, check, result.report)
        : negativeProvenanceFindings(inputs, check, check.id === 'wrong-producer-provenance');
    requireExact(findings, check.expectedFindings, `negative check ${check.id}`);
  }
  return result.report;
}

export function buildEscapeCensusRepresentativeApp() {
  rmSync(fixtureOut, { force: true, recursive: true });
  const frameworkModules = resolve(fixtureRoot, 'node_modules/@kovojs');
  rmSync(resolve(fixtureRoot, 'node_modules'), { force: true, recursive: true });
  mkdirSync(frameworkModules, { recursive: true });
  symlinkSync(resolve(repoRoot, 'packages/server'), resolve(frameworkModules, 'server'));
  const cli = resolve(repoRoot, 'packages/cli/src/bin.ts');
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      cli,
      'build',
      fixtureApp,
      '--out',
      fixtureOut,
      '--preset',
      'node',
    ],
    {
      cwd: fixtureRoot,
      encoding: 'utf8',
      env: { ...process.env, VERCEL: '1' },
    },
  );
  if (result.error || result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(nonBlank).join('\n');
    throw new Error(
      `representative kovo build failed${result.error ? `: ${result.error.message}` : ''}${detail ? `\n${detail}` : ''}`,
    );
  }
  const graphPath = resolve(fixtureOut, '.kovo/graph.json');
  if (!existsSync(graphPath)) throw new Error('representative kovo build emitted no graph.json');
  return graphPath;
}

export function runEscapeCensusBaseline({
  baselinePath = defaultBaselinePath,
  build = true,
  configPath = defaultConfigPath,
} = {}) {
  if (build) buildEscapeCensusRepresentativeApp();
  const baseline = readJson(resolve(baselinePath), 'escape census baseline');
  const inputs = loadEscapeCensusInputs(configPath);
  const report = verifyEscapeCensusBaseline({ baseline, inputs });

  const output = { stderr: '', stdout: '' };
  const io = {
    stderr: { write: (chunk) => (output.stderr += String(chunk)) },
    stdout: { write: (chunk) => (output.stdout += String(chunk)) },
  };
  const gateCode = runEscapeCensusCli(['--config', resolve(configPath)], io);
  if (gateCode !== 0 || output.stderr !== '') {
    throw new Error(`persisted gate command failed\n${output.stderr}`);
  }
  requireExact(output.stdout, formatEscapeCensusReport(report), 'persisted gate output');

  process.stdout.write(
    [
      'kovo.escape-census-baseline/v1',
      `COMMAND ${ESCAPE_CENSUS_BASELINE_COMMAND}`,
      `GATE ${ESCAPE_CENSUS_GATE_COMMAND}`,
      output.stdout.trimEnd(),
      ...expectedNegativeCheckIds.map((id) => `NEGATIVE id=${id} OK`),
      'OK',
      '',
    ].join('\n'),
  );
  return 0;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = runEscapeCensusBaseline();
  } catch (error) {
    process.stderr.write(
      `Escape census baseline failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
