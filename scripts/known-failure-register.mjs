#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { repoRoot as defaultRepoRoot } from './public-packages.mjs';

export const KNOWN_FAILURE_REGISTER_SCHEMA = 'kovo-known-failures/v1';
export const DESIRED_BEHAVIOR_EXIT_CODE = 0;
export const REPRODUCED_DEFECT_EXIT_CODE = 1;
export const INFRASTRUCTURE_ERROR_EXIT_CODE = 2;
export const BASELINE_KNOWN_FAILURE_IDS = Object.freeze([
  'KF-DEVEX-001',
  'KF-DEVEX-002',
  'KF-DEVEX-003',
  'KF-DEVEX-004',
  'KF-DEVEX-005',
  'KF-DEVEX-006',
  'KF-DEVEX-007',
  'KF-DEVEX-008',
  'KF-DEVEX-009',
  'KF-DEVEX-010',
]);
export const BASELINE_KNOWN_FAILURE_OWNERSHIP = Object.freeze({
  'KF-DEVEX-001': Object.freeze({
    fixTrack: 'Track 1',
    owner: 'Track 1 development-origin work item',
    scorecardGates: ['G1'],
  }),
  'KF-DEVEX-002': Object.freeze({
    fixTrack: 'Track 1',
    owner: 'Track 1 dev-reporter work item',
    scorecardGates: ['G2'],
  }),
  'KF-DEVEX-003': Object.freeze({
    fixTrack: 'Track 1',
    owner: 'Track 1 help/version exit-contract work item',
    scorecardGates: ['G5'],
  }),
  'KF-DEVEX-004': Object.freeze({
    fixTrack: 'Track 1',
    owner: 'Track 1 source-proof work item',
    scorecardGates: ['G7'],
  }),
  'KF-DEVEX-005': Object.freeze({
    fixTrack: 'Track 1',
    owner: 'Track 1 transactional-build work item',
    scorecardGates: ['G8'],
  }),
  'KF-DEVEX-006': Object.freeze({
    fixTrack: 'Track 1',
    owner: 'Track 1 source/deployment-proof split work item',
    scorecardGates: ['G1', 'G7'],
  }),
  'KF-DEVEX-007': Object.freeze({
    fixTrack: 'Track 1',
    owner: 'Track 1 kovo-add source-closure work item',
    scorecardGates: ['G4'],
  }),
  'KF-DEVEX-008': Object.freeze({
    fixTrack: 'Track 5',
    owner: 'Track 5b test-harness batch',
    scorecardGates: ['G24'],
  }),
  'KF-DEVEX-009': Object.freeze({
    fixTrack: 'Track 3',
    owner: 'Track 3 version-matched agent-docs work item',
    scorecardGates: ['G13'],
  }),
  'KF-DEVEX-010': Object.freeze({
    fixTrack: 'Track 1',
    owner: 'Track 1 diagnostic-empathy work item',
    scorecardGates: ['G9'],
  }),
});

const REGISTER_PATH = 'scripts/known-failure-register.json';
const PROBE_DIRECTORY = 'scripts/known-failure-probes';
const STATES = new Set(['executable', 'pending-repro', 'retired']);

function compareStrings(left, right) {
  return left.localeCompare(right);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function substantive(value, minimum = 12) {
  return typeof value === 'string' && value.trim().length >= minimum;
}

function relativeProbeFiles(repoRoot) {
  const directory = path.join(repoRoot, PROBE_DIRECTORY);
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
    .map((entry) => `${PROBE_DIRECTORY}/${entry.name}`)
    .sort(compareStrings);
}

/** Validate schema, the closed baseline denominator, and both missing and stale probe mappings. */
export function validateKnownFailureRegister(register, options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const findings = [];
  if (register?.schema !== KNOWN_FAILURE_REGISTER_SCHEMA) {
    findings.push(`schema must be ${KNOWN_FAILURE_REGISTER_SCHEMA}`);
  }
  if (Object.hasOwn(register ?? {}, 'protocol')) {
    findings.push('protocol is runner-owned and must not be redefined by register data');
  }
  if (!Array.isArray(register?.entries)) {
    findings.push('entries must be an array');
    return findings;
  }

  const ids = new Set();
  const registeredPaths = new Set();
  for (const entry of register.entries) {
    if (!/^KF-DEVEX-\d{3}$/u.test(entry?.id ?? '')) {
      findings.push(`${entry?.id ?? '<missing id>'}: invalid stable ID`);
      continue;
    }
    if (ids.has(entry.id)) findings.push(`${entry.id}: duplicate ID`);
    ids.add(entry.id);
    if (!substantive(entry.title)) findings.push(`${entry.id}: title must be substantive`);
    if (!STATES.has(entry.state)) findings.push(`${entry.id}: invalid state ${entry.state}`);
    if (!substantive(entry.desiredBehavior)) {
      findings.push(`${entry.id}: desiredBehavior must be substantive`);
    }
    const expectedOwnership = BASELINE_KNOWN_FAILURE_OWNERSHIP[entry.id];
    if (entry.owner !== expectedOwnership?.owner) {
      findings.push(`${entry.id}: owner must match its charter implementation work item`);
    }
    if (entry.childLedger !== 'devex-gates.md') {
      findings.push(`${entry.id}: childLedger must be the Track 2 ledger devex-gates.md`);
    }
    if (!substantive(entry.observedLayer, 4)) {
      findings.push(`${entry.id}: observedLayer must identify the observed packed layer`);
    }
    if (!substantive(entry.retirementCondition, 24)) {
      findings.push(`${entry.id}: retirementCondition must be substantive`);
    }
    if (
      entry.planOwnership?.registerTrack !== 'Track 0' ||
      entry.planOwnership?.reproducerTrack !== 'Track 2' ||
      entry.planOwnership?.fixTrack !== expectedOwnership?.fixTrack ||
      JSON.stringify(entry.planOwnership?.scorecardGates) !==
        JSON.stringify(expectedOwnership?.scorecardGates)
    ) {
      findings.push(`${entry.id}: planOwnership must match the charter track and scorecard gates`);
    }

    const probe = entry.probe;
    if (!probe || typeof probe !== 'object' || Array.isArray(probe)) {
      findings.push(`${entry.id}: probe mapping is required`);
      continue;
    }
    if (
      typeof probe.path !== 'string' ||
      !probe.path.startsWith(`${PROBE_DIRECTORY}/`) ||
      path.isAbsolute(probe.path)
    ) {
      findings.push(`${entry.id}: probe.path must be a repository-relative probe path`);
    } else {
      registeredPaths.add(probe.path);
      if (!existsSync(path.join(repoRoot, probe.path))) {
        findings.push(`${entry.id}: mapped probe is missing: ${probe.path}`);
      }
    }
    if (
      !Array.isArray(probe.command) ||
      probe.command.length < 2 ||
      probe.command.some((part) => typeof part !== 'string' || part.length === 0)
    ) {
      findings.push(`${entry.id}: probe.command must be a non-empty argv array`);
    } else if (probe.command[1] !== probe.path) {
      findings.push(`${entry.id}: probe.command must execute its mapped probe.path`);
    }
    if (!Number.isInteger(probe.timeoutMs) || probe.timeoutMs < 1000 || probe.timeoutMs > 600000) {
      findings.push(`${entry.id}: probe.timeoutMs must be between 1s and 10m`);
    }
    if (probe.packedInput !== true) findings.push(`${entry.id}: probe must use packed input`);

    if (entry.state === 'pending-repro' && !substantive(entry.gap, 24)) {
      findings.push(`${entry.id}: pending repro requires an honest substantive gap`);
    }
    if (
      entry.state === 'retired' &&
      (!substantive(entry.retirement?.evidence, 20) ||
        !substantive(entry.retirement?.verification, 8))
    ) {
      findings.push(`${entry.id}: retired entry requires evidence and a verification command`);
    }
  }

  const expected = new Set(BASELINE_KNOWN_FAILURE_IDS);
  for (const id of BASELINE_KNOWN_FAILURE_IDS) {
    if (!ids.has(id)) findings.push(`missing baseline known-failure ID: ${id}`);
  }
  for (const id of ids) {
    if (!expected.has(id)) findings.push(`unreviewed known-failure ID: ${id}`);
  }

  for (const probePath of relativeProbeFiles(repoRoot)) {
    if (!registeredPaths.has(probePath)) findings.push(`stale unregistered probe: ${probePath}`);
  }
  return findings;
}

function substituteCommand(command, options) {
  return command.map((part) => {
    if (part === '{packedManifest}') {
      if (!options.packedManifest) {
        throw new Error('executable packed probes require --packed-manifest <path>');
      }
      return path.resolve(options.packedManifest);
    }
    return part;
  });
}

/**
 * Expected-failure protocol:
 * - 1: the desired-behavior assertion failed, so the known defect is still reproduced (XFAIL).
 * - 0: desired behavior now passes (XPASS); CI turns red until the entry is retired with proof.
 * - anything else / timeout: infrastructure error, never accepted as reproduction evidence.
 */
export function runKnownFailureProbes(register, options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const findings = validateKnownFailureRegister(register, { repoRoot });
  if (findings.length > 0) {
    return {
      schemaValid: false,
      executableClosureComplete: false,
      pass: false,
      findings,
      results: [],
    };
  }
  const spawn = options.spawnSync ?? spawnSync;
  const results = [];
  for (const entry of register.entries) {
    if (entry.state === 'pending-repro') {
      results.push({ id: entry.id, status: 'pending-repro', gap: entry.gap });
      continue;
    }
    if (entry.state === 'retired') {
      results.push({ id: entry.id, status: 'retired' });
      continue;
    }
    let command;
    try {
      command = substituteCommand(entry.probe.command, options);
    } catch (error) {
      results.push({ id: entry.id, status: 'infrastructure-error', detail: error.message });
      continue;
    }
    const result = spawn(command[0], command.slice(1), {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, ...options.env },
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: entry.probe.timeoutMs,
    });
    if (result.status === REPRODUCED_DEFECT_EXIT_CODE && !result.signal && !result.error) {
      results.push({
        id: entry.id,
        status: 'xfail',
        detail: (result.stderr || result.stdout || '').trim(),
      });
    } else if (result.status === DESIRED_BEHAVIOR_EXIT_CODE && !result.signal && !result.error) {
      results.push({
        id: entry.id,
        status: 'xpass',
        detail: (result.stdout || '').trim(),
      });
    } else {
      results.push({
        id: entry.id,
        status: 'infrastructure-error',
        detail:
          result.error?.message ??
          result.signal ??
          (result.stderr || result.stdout || `exit ${String(result.status)}`).trim(),
      });
    }
  }
  const executableClosureComplete = results.every(
    (result) => result.status === 'retired' || ['xfail', 'xpass'].includes(result.status),
  );
  const executableOutcomesAccepted = results.every((result) =>
    ['pending-repro', 'retired', 'xfail'].includes(result.status),
  );
  return {
    schemaValid: true,
    executableClosureComplete,
    pass: executableClosureComplete && executableOutcomesAccepted,
    findings: [],
    results,
  };
}

export function knownFailureSummary(register) {
  return Object.fromEntries(
    [...STATES].map((state) => [
      state,
      register.entries.filter((entry) => entry.state === state).length,
    ]),
  );
}

function parseArgs(argv) {
  const args = {
    register: path.join(defaultRepoRoot, REGISTER_PATH),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--validate-schema') args.validateSchema = true;
    else if (arg === '--run-available') args.runAvailable = true;
    else if (arg === '--require-executable') args.requireExecutable = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--register') args.register = argv[++index];
    else if (arg === '--packed-manifest') args.packedManifest = argv[++index];
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    'Usage: node scripts/known-failure-register.mjs [--validate-schema | --run-available | --require-executable] [options]',
    '',
    '  --validate-schema        Validate data and mappings; does not claim executable closure.',
    '  --run-available          Run available expected-failure probes; remains red while gaps exist.',
    '  --packed-manifest <file> Supply the packed-public-packages manifest to packed probes.',
    '  --require-executable     Fail while any entry still has a pending repro gap.',
    '  --json                   Emit machine-readable results.',
    '',
  ].join('\n');
}

export function runKnownFailureRegister(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(usage());
    return 0;
  }
  const registerPath = path.resolve(args.register);
  const register = readJson(registerPath);
  const repoRoot = path.resolve(path.dirname(registerPath), '..');
  const findings = validateKnownFailureRegister(register, { repoRoot });
  if (findings.length > 0) {
    if (args.json) process.stdout.write(`${JSON.stringify({ pass: false, findings }, null, 2)}\n`);
    else
      process.stderr.write(
        `known-failures/v1\n${findings.map((item) => `FAIL ${item}`).join('\n')}\n`,
      );
    return 1;
  }
  const summary = knownFailureSummary(register);
  const executableClosureComplete = summary['pending-repro'] === 0;
  if (args.requireExecutable && !executableClosureComplete) {
    process.stderr.write(
      `known-failures/v1\nFAIL pending-repro=${summary['pending-repro']} (repro coverage is incomplete)\n`,
    );
    return 1;
  }
  if (args.runAvailable) {
    const result = runKnownFailureProbes(register, {
      repoRoot,
      packedManifest: args.packedManifest,
    });
    if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      process.stdout.write(
        `known-failures/v1 ${result.results
          .map((item) => `${item.id}=${item.status}`)
          .join(' ')}\n${
          result.executableClosureComplete
            ? result.pass
              ? 'EXECUTABLE_CLOSURE_COMPLETE'
              : 'EXECUTABLE_CLOSURE_FAILED'
            : `EXECUTABLE_CLOSURE_INCOMPLETE pending-repro=${summary['pending-repro']}`
        }\n`,
      );
    }
    return result.pass ? 0 : 1;
  }
  const output = {
    schema: register.schema,
    total: register.entries.length,
    ...summary,
    schemaValid: true,
    executableClosureComplete,
  };
  if (args.json) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  else {
    process.stdout.write(
      `known-failures/v1 total=${output.total} executable=${output.executable} pending-repro=${output['pending-repro']} retired=${output.retired}\nSCHEMA_VALID\n${
        executableClosureComplete ? 'EXECUTABLE_CLOSURE_COMPLETE' : 'EXECUTABLE_CLOSURE_INCOMPLETE'
      }\n`,
    );
  }
  return args.validateSchema ? 0 : executableClosureComplete ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = runKnownFailureRegister();
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}
