#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { nonSymlinkDescendant } from './lib/non-symlink-path.mjs';
import { repoRoot as defaultRepoRoot } from './public-packages.mjs';

export const KNOWN_FAILURE_REGISTER_SCHEMA = 'kovo-known-failures/v1';
export const KNOWN_FAILURE_PROBE_RESULT_SCHEMA = 'kovo-known-failure-probe-result/v1';
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
const OWNERSHIP_LEDGER = 'plans/devex-gates.md';
const STATES = new Set(['executable', 'pending-repro', 'retired']);
const PROBE_OUTCOMES = new Set(['defect-reproduced', 'desired-behavior']);
const PROBE_CADENCES = new Set(['per-pr', 'nightly']);

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
  const files = [];
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile() && entry.name.endsWith('.mjs')) {
        files.push(path.relative(repoRoot, absolute).split(path.sep).join('/'));
      }
    }
  }
  walk(directory);
  return files.sort(compareStrings);
}

function canonicalProbePath(value) {
  if (
    typeof value !== 'string' ||
    path.isAbsolute(value) ||
    value.includes('\\') ||
    path.posix.normalize(value) !== value ||
    !value.startsWith(`${PROBE_DIRECTORY}/`) ||
    value === `${PROBE_DIRECTORY}/` ||
    !value.endsWith('.mjs')
  ) {
    return false;
  }
  const relative = path.posix.relative(PROBE_DIRECTORY, value);
  return relative !== '' && relative !== '..' && !relative.startsWith('../');
}

function regularProbePathFinding(repoRoot, probePath) {
  try {
    nonSymlinkDescendant(repoRoot, probePath, {
      kind: 'file',
      label: 'mapped probe',
    });
  } catch (error) {
    return `${probePath}: ${error.message}`;
  }
  return null;
}

function commandPairCount(command, flag, value) {
  let count = 0;
  for (let index = 0; index < command.length - 1; index += 1) {
    if (command[index] === flag && command[index + 1] === value) count += 1;
  }
  return count;
}

function resolveOwnershipLedger(repoRoot, register, options) {
  if (register?.ownershipLedger !== OWNERSHIP_LEDGER) {
    return {
      finding: `ownershipLedger must be ${OWNERSHIP_LEDGER}`,
      text: null,
    };
  }
  if (options.ledgerResolver) {
    const resolved = options.ledgerResolver({
      claimedPath: register.ownershipLedger,
      repoRoot,
    });
    return typeof resolved === 'string'
      ? { finding: null, text: resolved }
      : {
          finding: `${register.ownershipLedger}: ownership ledger could not be resolved`,
          text: null,
        };
  }
  const absolute = path.resolve(repoRoot, register.ownershipLedger);
  if (
    !absolute.startsWith(`${repoRoot}${path.sep}`) ||
    !existsSync(absolute) ||
    !lstatSync(absolute).isFile() ||
    lstatSync(absolute).isSymbolicLink()
  ) {
    return {
      finding: `${register.ownershipLedger}: ownership ledger must exist as a regular repository file`,
      text: null,
    };
  }
  return { finding: null, text: readFileSync(absolute, 'utf8') };
}

function ownershipLedgerFindings(register, ledgerText) {
  const findings = [];
  if (!ledgerText.includes('plans/worldclass-devex.md') || !ledgerText.includes('Track 2')) {
    findings.push(`${OWNERSHIP_LEDGER}: must identify the Track 2 charter`);
  }
  const lines = ledgerText.split(/\r?\n/u);
  for (const entry of register.entries) {
    const ownership = BASELINE_KNOWN_FAILURE_OWNERSHIP[entry.id];
    if (!ownership) continue;
    const line = lines.find((candidate) => candidate.includes(entry.id));
    if (!line) {
      findings.push(`${OWNERSHIP_LEDGER}: missing ownership row for ${entry.id}`);
      continue;
    }
    if (!line.includes(ownership.owner) || !line.includes(ownership.fixTrack)) {
      findings.push(`${OWNERSHIP_LEDGER}: ${entry.id} does not name its implementation owner`);
    }
    if (!line.includes('Track 2')) {
      findings.push(`${OWNERSHIP_LEDGER}: ${entry.id} does not name Track 2 as repro owner`);
    }
    for (const gate of ownership.scorecardGates) {
      if (!new RegExp(`\\b${gate}\\b`, 'u').test(line)) {
        findings.push(`${OWNERSHIP_LEDGER}: ${entry.id} does not name scorecard gate ${gate}`);
      }
    }
  }
  return findings;
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
  const ownershipLedger = resolveOwnershipLedger(repoRoot, register, options);
  if (ownershipLedger.finding) findings.push(ownershipLedger.finding);
  else findings.push(...ownershipLedgerFindings(register, ownershipLedger.text));

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
    if (entry.childLedger !== OWNERSHIP_LEDGER) {
      findings.push(`${entry.id}: childLedger must be ${OWNERSHIP_LEDGER}`);
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
    if (!canonicalProbePath(probe.path)) {
      findings.push(
        `${entry.id}: probe.path must be canonical and strictly under ${PROBE_DIRECTORY}`,
      );
    } else {
      registeredPaths.add(probe.path);
      const pathFinding = regularProbePathFinding(repoRoot, probe.path);
      if (pathFinding) findings.push(`${entry.id}: ${pathFinding}`);
    }
    if (
      !Array.isArray(probe.command) ||
      probe.command.length < 2 ||
      probe.command.some((part) => typeof part !== 'string' || part.length === 0)
    ) {
      findings.push(`${entry.id}: probe.command must be a non-empty argv array`);
    } else {
      if (probe.command[0] !== 'node' || probe.command[1] !== probe.path) {
        findings.push(`${entry.id}: probe.command must execute only its mapped probe.path`);
      }
      if (commandPairCount(probe.command, '--id', entry.id) !== 1) {
        findings.push(`${entry.id}: probe.command must bind exactly one --id ${entry.id}`);
      }
      if (commandPairCount(probe.command, '--packed-manifest', '{packedManifest}') !== 1) {
        findings.push(
          `${entry.id}: probe.command must bind exactly one declared packed manifest input`,
        );
      }
    }
    if (!Number.isInteger(probe.timeoutMs) || probe.timeoutMs < 1000 || probe.timeoutMs > 900000) {
      findings.push(`${entry.id}: probe.timeoutMs must be between 1s and 15m`);
    }
    if (probe.packedInput !== true) findings.push(`${entry.id}: probe must use packed input`);
    if (probe.resultSchema !== KNOWN_FAILURE_PROBE_RESULT_SCHEMA) {
      findings.push(`${entry.id}: probe.resultSchema must be ${KNOWN_FAILURE_PROBE_RESULT_SCHEMA}`);
    }
    if (probe.cadence !== undefined && !PROBE_CADENCES.has(probe.cadence)) {
      findings.push(`${entry.id}: probe.cadence must be per-pr or nightly`);
    }
    if (entry.state !== 'pending-repro' && probe.path.endsWith('/pending.mjs')) {
      findings.push(`${entry.id}: executable and retired rows cannot use the pending probe`);
    }

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
      const packedManifest = path.resolve(options.packedManifest);
      if (
        !existsSync(packedManifest) ||
        !lstatSync(packedManifest).isFile() ||
        lstatSync(packedManifest).isSymbolicLink()
      ) {
        throw new Error('packed manifest input must be a regular non-symlink file');
      }
      return packedManifest;
    }
    return part;
  });
}

function classifiedProbeResult(entry, result) {
  if (result.signal || result.error || result.status === null) {
    return {
      id: entry.id,
      status: 'infrastructure-error',
      detail: result.error?.message ?? result.signal ?? 'probe did not return an exit status',
    };
  }
  if (result.stderr?.trim()) {
    return {
      id: entry.id,
      status: 'infrastructure-error',
      detail: `probe wrote unexpected stderr: ${result.stderr.trim()}`,
    };
  }
  let payload;
  try {
    payload = JSON.parse(result.stdout?.trim() ?? '');
  } catch {
    return {
      id: entry.id,
      status: 'infrastructure-error',
      detail: 'probe stdout was not one bounded JSON result',
    };
  }
  const keys =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? Object.keys(payload).sort(compareStrings)
      : [];
  if (
    JSON.stringify(keys) !== JSON.stringify(['id', 'outcome', 'schema']) ||
    payload.schema !== entry.probe.resultSchema ||
    payload.id !== entry.id ||
    !PROBE_OUTCOMES.has(payload.outcome)
  ) {
    return {
      id: entry.id,
      status: 'infrastructure-error',
      detail: 'probe result schema, row identity, or outcome was invalid',
    };
  }
  const expectedExit =
    payload.outcome === 'desired-behavior'
      ? DESIRED_BEHAVIOR_EXIT_CODE
      : REPRODUCED_DEFECT_EXIT_CODE;
  if (result.status !== expectedExit) {
    return {
      id: entry.id,
      status: 'infrastructure-error',
      detail: `probe outcome ${payload.outcome} contradicted exit ${String(result.status)}`,
    };
  }
  if (entry.state === 'retired') {
    return {
      id: entry.id,
      status: payload.outcome === 'desired-behavior' ? 'retired-pass' : 'retired-regression',
    };
  }
  return {
    id: entry.id,
    status: payload.outcome === 'desired-behavior' ? 'xpass' : 'xfail',
  };
}

/**
 * Expected-failure protocol:
 * - exit 1 plus the exact row-bound `defect-reproduced` result: XFAIL.
 * - exit 0 plus the exact row-bound `desired-behavior` result: XPASS until retirement.
 * - retired rows still execute and must return `desired-behavior`.
 * - malformed output, stderr, contradictory exits, crashes, and timeouts are infrastructure errors.
 */
export function runKnownFailureProbes(register, options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const findings = validateKnownFailureRegister(register, {
    repoRoot,
    ledgerResolver: options.ledgerResolver,
  });
  if (findings.length > 0) {
    return {
      schemaValid: false,
      executableClosureComplete: false,
      availablePass: false,
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
    const cadence = entry.probe.cadence ?? 'per-pr';
    if (options.cadence && options.cadence !== 'all' && cadence !== options.cadence) {
      results.push({ id: entry.id, status: 'deferred', cadence });
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
    results.push(classifiedProbeResult(entry, result));
  }
  const executableClosureComplete = results.every(
    (result) =>
      !['pending-repro', 'infrastructure-error'].includes(result.status) &&
      ['deferred', 'xfail', 'xpass', 'retired-pass', 'retired-regression'].includes(result.status),
  );
  const executableOutcomesAccepted = results.every((result) =>
    ['deferred', 'pending-repro', 'xfail', 'retired-pass'].includes(result.status),
  );
  return {
    schemaValid: true,
    executableClosureComplete,
    availablePass: executableOutcomesAccepted,
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
    else if (arg === '--ownership-ledger') args.ownershipLedger = argv[++index];
    else if (arg === '--packed-manifest') args.packedManifest = argv[++index];
    else if (arg === '--cadence') args.cadence = argv[++index];
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
    '  --run-available          Gate runnable expected-failure probes; pending gaps remain closure debt.',
    '  --packed-manifest <file> Supply the packed-public-packages manifest to packed probes.',
    '  --cadence <per-pr|nightly|all> Run only probes assigned to one CI cadence.',
    '  --ownership-ledger <file> Inject a ledger fixture; integration defaults to plans/devex-gates.md.',
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
  if (args.cadence !== undefined && !['per-pr', 'nightly', 'all'].includes(args.cadence)) {
    throw new Error('--cadence must be per-pr, nightly, or all');
  }
  const register = readJson(registerPath);
  const repoRoot = path.resolve(path.dirname(registerPath), '..');
  const ledgerResolver = args.ownershipLedger
    ? () => readFileSync(path.resolve(args.ownershipLedger), 'utf8')
    : undefined;
  const findings = validateKnownFailureRegister(register, { repoRoot, ledgerResolver });
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
      cadence: args.cadence ?? 'all',
      ledgerResolver,
    });
    if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      process.stdout.write(
        `known-failures/v1 ${result.results
          .map((item) => `${item.id}=${item.status}`)
          .join(
            ' ',
          )}\n${result.availablePass ? 'AVAILABLE_PROBES_PASS' : 'AVAILABLE_PROBES_FAILED'}\n${
          result.executableClosureComplete
            ? result.pass
              ? 'EXECUTABLE_CLOSURE_COMPLETE'
              : 'EXECUTABLE_CLOSURE_FAILED'
            : `EXECUTABLE_CLOSURE_INCOMPLETE pending-repro=${summary['pending-repro']}`
        }\n`,
      );
    }
    return result.availablePass ? 0 : 1;
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
