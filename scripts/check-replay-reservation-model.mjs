#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';

export const repoRoot = findRepoRoot();
export const replayModelSchema = 'kovo.replay-reservation-model/v1';
export const replayCounterexampleSchema = 'kovo.replay-tlc-counterexample/v1';
export const replayToolchainSchema = 'kovo.replay-tlc-toolchain/v1';

const paths = Object.freeze({
  boundary: 'packages/cli/src/replay-model-boundary.json',
  ci: '.github/workflows/ci.yml',
  evictConfig: 'formal/replay/broken/ReplayReservationEvictPending.cfg',
  evictCounterexample: 'formal/replay/counterexamples/evict-pending-double-execute.json',
  model: 'formal/ReplayReservation.tla',
  naiveConfig: 'formal/replay/broken/ReplayReservationNaiveWatermark.cfg',
  naiveCounterexample: 'formal/replay/counterexamples/naive-watermark-resurrection.json',
  packageJson: 'package.json',
  positiveConfig: 'formal/ReplayReservation.cfg',
  postgresReplay: 'packages/server/src/postgres-replay.ts',
  protocol: 'formal/replay/protocol-alphabet.json',
  replay: 'packages/server/src/replay.ts',
  spec: 'spec/10-data-plane.md',
  toolchain: 'formal/replay/tlc-toolchain.json',
});

const invariantNames = Object.freeze([
  'TypeOK',
  'NoDoubleExecute',
  'RefuseNeverEvict',
  'MonotoneReclaimedThrough',
  'NoResurrection',
  'BoundedAdmission',
]);

const modeledActionOperators = Object.freeze({
  'replay.abort': 'Abort',
  'replay.commit': 'Commit',
  'replay.read': 'Read',
  'replay.reclaimCommitted': 'ReclaimOne',
  'replay.releasePending': 'ReleasePending',
  'replay.reserve': 'Reserve',
  'replay.settle': 'Settle',
});

const counterexampleCases = Object.freeze([
  {
    actions: ['Init', 'Reserve', 'Execute', 'EvictPending', 'Reserve', 'Execute'],
    configPath: paths.evictConfig,
    counterexamplePath: paths.evictCounterexample,
    invariant: 'NoDoubleExecute',
    variables: [
      'admissionSlot',
      'claim',
      'executions',
      'owner',
      'pendingEvicted',
      'phase',
      'status',
    ],
    variant: 'evict-pending',
  },
  {
    actions: [
      'Init',
      'Settle',
      'Tick',
      'ReclaimOne',
      'Tick',
      'BackwardClockStep',
      'CleanupAfterRollback',
      'Reserve',
    ],
    configPath: paths.naiveConfig,
    counterexamplePath: paths.naiveCounterexample,
    invariant: 'NoResurrection',
    variables: [
      'admissionSlot',
      'backwardClockSteps',
      'claim',
      'clock',
      'executions',
      'highestReclaimedThrough',
      'owner',
      'phase',
      'reclaimed',
      'reclaimedThrough',
      'status',
    ],
    variant: 'naive-watermark',
  },
]);

function asciiCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function json(pathname, root = repoRoot) {
  return JSON.parse(readFileSync(path.join(root, pathname), 'utf8'));
}

function text(pathname, root = repoRoot) {
  return readFileSync(path.join(root, pathname), 'utf8');
}

function sortedUnique(values) {
  return [...new Set(values)].sort(asciiCompare);
}

function sameValues(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cfgConstant(configText, name) {
  return configText.match(new RegExp(`^\\s*${name}\\s*=\\s*(\\S+)\\s*$`, 'mu'))?.[1];
}

function cfgHasInvariant(configText, invariant) {
  return new RegExp(`^\\s*(?:INVARIANTS?\\s+)?${invariant}\\s*$`, 'mu').test(configText);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function loadReplayModelInputs(root = repoRoot) {
  return {
    boundary: json(paths.boundary, root),
    ciText: text(paths.ci, root),
    counterexamples: Object.fromEntries(
      counterexampleCases.map((entry) => [entry.variant, json(entry.counterexamplePath, root)]),
    ),
    evictConfigText: text(paths.evictConfig, root),
    modelText: text(paths.model, root),
    naiveConfigText: text(paths.naiveConfig, root),
    packageJson: json(paths.packageJson, root),
    positiveConfigText: text(paths.positiveConfig, root),
    postgresReplayText: text(paths.postgresReplay, root),
    protocol: json(paths.protocol, root),
    replayText: text(paths.replay, root),
    specText: text(paths.spec, root),
    toolchain: json(paths.toolchain, root),
  };
}

export function validateReplayModelContract(inputs) {
  const findings = [];
  const {
    boundary,
    ciText,
    counterexamples,
    evictConfigText,
    modelText,
    naiveConfigText,
    packageJson,
    positiveConfigText,
    postgresReplayText,
    protocol,
    replayText,
    specText,
    toolchain,
  } = inputs;

  if (toolchain?.schema !== replayToolchainSchema) {
    findings.push(`toolchain schema must be ${replayToolchainSchema}`);
  }
  if (!/^v\d+\.\d+\.\d+$/u.test(toolchain?.tlc?.release ?? '')) {
    findings.push('TLC release must be an exact vMAJOR.MINOR.PATCH tag');
  }
  if (!/^[a-f0-9]{64}$/u.test(toolchain?.tlc?.sha256 ?? '')) {
    findings.push('TLC artifact must carry an exact sha256 digest');
  }
  if (!/^[a-f0-9]{40}$/u.test(toolchain?.tlc?.publishedSha1 ?? '')) {
    findings.push('TLC artifact must retain the release-published sha1 digest');
  }
  if (
    typeof toolchain?.tlc?.url !== 'string' ||
    !toolchain.tlc.url.includes(`/releases/download/${toolchain?.tlc?.release}/tla2tools.jar`)
  ) {
    findings.push('TLC URL must bind the exact release tag and tla2tools.jar asset');
  }
  if (!/^\d+\.\d+\.\d+\+\d+$/u.test(toolchain?.java?.version ?? '')) {
    findings.push('Java runtime must be exact-pinned including its build number');
  }
  if (!/^actions\/setup-java@[a-f0-9]{40}$/u.test(toolchain?.java?.ciAction ?? '')) {
    findings.push('Java CI action must be pinned to a full commit SHA');
  }
  if (toolchain?.java?.distribution !== 'temurin') {
    findings.push('Java distribution must be the reviewed Temurin runtime');
  }
  if (toolchain?.execution?.workers !== 1 || toolchain?.execution?.fingerprintPolynomial !== 0) {
    findings.push('TLC execution must pin one worker and fingerprint polynomial 0');
  }

  const expectedBounds = {
    backwardClockSteps: 1,
    crashPoints: 1,
    identities: 2,
    replicas: 2,
    slots: 2,
  };
  if (!sameValues(boundary?.bounds, expectedBounds)) {
    findings.push(`model boundary bounds must equal ${JSON.stringify(expectedBounds)}`);
  }
  if (boundary?.status !== 'bounded-model-checked') {
    findings.push('model boundary status must be bounded-model-checked');
  }
  const evidence = boundary?.modelCheckingEvidence;
  if (
    evidence?.checker !== 'TLC' ||
    evidence?.release !== toolchain?.tlc?.release ||
    evidence?.sha256 !== toolchain?.tlc?.sha256 ||
    evidence?.java !== `${toolchain?.java?.distribution}-${toolchain?.java?.version}` ||
    evidence?.positiveConfig !== paths.positiveConfig ||
    !sameValues(evidence?.invariants, invariantNames)
  ) {
    findings.push(
      'model boundary TLC evidence must match the pinned toolchain and positive config',
    );
  }

  const rawMarkers = [...modelText.matchAll(/^\s*\\\* @kovo-model-action (\S+)\s*$/gmu)].map(
    (match) => match[1],
  );
  const markers = sortedUnique(rawMarkers);
  if (markers.length !== rawMarkers.length) {
    findings.push('TLA action markers must not contain duplicates');
  }
  const modeled = sortedUnique(boundary?.modeledActions ?? []);
  if (!sameValues(markers, modeled)) {
    findings.push('TLA action markers must exactly equal the honesty-boundary modeled actions');
  }
  const protocolActions = new Set(protocol?.actions ?? []);
  for (const action of markers) {
    if (!protocolActions.has(action))
      findings.push(`${action} is absent from the protocol alphabet`);
  }
  const statementActions = new Set((protocol?.statements ?? []).map((entry) => entry?.action));
  for (const action of markers) {
    if (!statementActions.has(action)) {
      findings.push(`${action} has no source-derived protocol statement`);
    }
  }
  for (const [action, operator] of Object.entries(modeledActionOperators)) {
    const markerIndex = modelText.indexOf(`\\* @kovo-model-action ${action}`);
    const operatorIndex = modelText.indexOf(`${operator}(`, markerIndex);
    if (markerIndex === -1 || operatorIndex === -1 || operatorIndex - markerIndex > 1_200) {
      findings.push(`${action} marker must remain adjacent to its ${operator} model action`);
    }
  }

  for (const fragment of [
    'Expiry(identity) > reclaimedThrough',
    'Cardinality(PendingIdentities) <= Cardinality(Slots)',
    'NoDoubleExecute ==',
    'RefuseNeverEvict ==',
    'MonotoneReclaimedThrough ==',
    'NoResurrection ==',
    'BackwardClockStep ==',
    'Crash(replica) ==',
  ]) {
    if (!modelText.includes(fragment)) findings.push(`TLA model is missing ${fragment}`);
  }

  const configChecks = [
    [positiveConfigText, 'AllowPendingEviction', 'FALSE', 'positive config'],
    [positiveConfigText, 'NaiveWatermark', 'FALSE', 'positive config'],
    [evictConfigText, 'AllowPendingEviction', 'TRUE', 'evict-pending config'],
    [evictConfigText, 'NaiveWatermark', 'FALSE', 'evict-pending config'],
    [naiveConfigText, 'AllowPendingEviction', 'FALSE', 'naive-watermark config'],
    [naiveConfigText, 'NaiveWatermark', 'TRUE', 'naive-watermark config'],
  ];
  for (const [configText, name, expected, label] of configChecks) {
    if (cfgConstant(configText, name) !== expected) {
      findings.push(`${label} must set ${name} = ${expected}`);
    }
  }
  const boundedConstants = Object.freeze({
    Identity1: 'identity_1',
    Identity2: 'identity_2',
    NoIdentity: 'no_identity',
    NoReplica: 'no_replica',
    NoSlot: 'no_slot',
    Replica1: 'replica_1',
    Replica2: 'replica_2',
    Slot1: 'slot_1',
    Slot2: 'slot_2',
  });
  for (const [configText, label] of [
    [positiveConfigText, 'positive config'],
    [evictConfigText, 'evict-pending config'],
    [naiveConfigText, 'naive-watermark config'],
  ]) {
    for (const [name, expected] of Object.entries(boundedConstants)) {
      if (cfgConstant(configText, name) !== expected) {
        findings.push(`${label} must set ${name} = ${expected}`);
      }
    }
  }
  for (const invariant of invariantNames) {
    if (!cfgHasInvariant(positiveConfigText, invariant)) {
      findings.push(`positive config must check ${invariant}`);
    }
  }
  if (!cfgHasInvariant(evictConfigText, 'NoDoubleExecute')) {
    findings.push('evict-pending config must target NoDoubleExecute');
  }
  if (!cfgHasInvariant(naiveConfigText, 'NoResurrection')) {
    findings.push('naive-watermark config must target NoResurrection');
  }

  const normalizedPostgres = postgresReplayText.replace(/\s+/gu, ' ');
  for (const fragment of [
    'FOR UPDATE',
    'SET reclaimed_through = GREATEST(',
    'admission_slot = candidate.slot',
    'ON CONFLICT DO NOTHING RETURNING generation',
  ]) {
    if (!normalizedPostgres.includes(fragment)) {
      findings.push(`Postgres replay source lost modeled semantic anchor: ${fragment}`);
    }
  }
  if (!replayText.includes("{ kind: 'unavailable' }")) {
    findings.push('replay admission source lost the fail-closed unavailable result');
  }
  if (!/REFUSES[\s\S]{0,240}rather than EVICTING/u.test(replayText)) {
    findings.push('replay admission source lost the refuse-never-evict anchor');
  }

  for (const entry of counterexampleCases) {
    const counterexample = counterexamples?.[entry.variant];
    if (counterexample?.schema !== replayCounterexampleSchema) {
      findings.push(`${entry.variant} counterexample schema is not ${replayCounterexampleSchema}`);
      continue;
    }
    if (
      counterexample.variant !== entry.variant ||
      counterexample.invariant !== entry.invariant ||
      !sameValues(counterexample.actions, entry.actions)
    ) {
      findings.push(`${entry.variant} counterexample identity/action contract drifted`);
    }
  }

  const modelScript = packageJson?.scripts?.['check:replay-model'];
  if (modelScript !== 'node scripts/security-cost-budget-runner.mjs --gate replay-model') {
    findings.push('package.json must expose check:replay-model through the TLC gate');
  }
  if (!packageJson?.scripts?.check?.includes('pnpm run check:replay-model')) {
    findings.push('the root check chain must invoke check:replay-model');
  }
  if (!ciText.includes(`uses: ${toolchain?.java?.ciAction}`)) {
    findings.push('CI must use the exact-pinned Java setup action');
  }
  if (!ciText.includes(`distribution: ${toolchain?.java?.distribution}`)) {
    findings.push('CI must select the pinned Java distribution');
  }
  if (!ciText.includes(`java-version: '${toolchain?.java?.version}'`)) {
    findings.push('CI must select the exact-pinned Java runtime build');
  }
  if (!ciText.includes("KOVO_TLA_OFFLINE: '1'")) {
    findings.push('CI must run the checked model with tool download disabled');
  }
  if (!ciText.includes('check-replay-reservation-model.mjs --prepare')) {
    findings.push('CI must prepare and digest-check the TLC artifact before offline proof');
  }
  if (!specText.includes('bounded-model-checked') || !specText.includes(toolchain?.tlc?.release)) {
    findings.push('SPEC must disclose the bounded TLC evidence and pinned release');
  }
  if (!/does not prove Postgres/u.test(specText)) {
    findings.push('SPEC must state that bounded TLC evidence does not prove Postgres');
  }

  return { findings, ok: findings.length === 0 };
}

function cacheJarPath(toolchain) {
  return path.join(
    homedir(),
    '.cache',
    'kovo',
    'tla2tools',
    toolchain.tlc.release,
    'tla2tools.jar',
  );
}

function verifyJar(jarPath, toolchain) {
  if (!existsSync(jarPath)) return false;
  const actual = sha256(readFileSync(jarPath));
  if (actual !== toolchain.tlc.sha256) {
    throw new Error(
      `Pinned TLC digest mismatch for ${jarPath}: expected ${toolchain.tlc.sha256}, got ${actual}`,
    );
  }
  return true;
}

async function acquireTlcJar(toolchain) {
  const override = process.env.KOVO_TLA2TOOLS_JAR;
  const jarPath = override ? path.resolve(override) : cacheJarPath(toolchain);
  if (verifyJar(jarPath, toolchain)) return jarPath;
  if (override) throw new Error(`KOVO_TLA2TOOLS_JAR does not exist: ${jarPath}`);
  if (process.env.KOVO_TLA_OFFLINE === '1') {
    throw new Error(
      `Pinned TLC artifact is absent at ${jarPath}; run check-replay-reservation-model.mjs --prepare before the offline gate.`,
    );
  }

  const response = await fetch(toolchain.tlc.url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Unable to fetch pinned TLC ${toolchain.tlc.release}: HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== toolchain.tlc.sha256) {
    throw new Error(
      `Downloaded TLC digest mismatch: expected ${toolchain.tlc.sha256}, got ${actual}`,
    );
  }
  mkdirSync(path.dirname(jarPath), { recursive: true });
  const temporary = `${jarPath}.${process.pid}.tmp`;
  writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
  renameSync(temporary, jarPath);
  return jarPath;
}

function javaBinary() {
  if (process.env.KOVO_JAVA_BIN) return path.resolve(process.env.KOVO_JAVA_BIN);
  if (process.env.JAVA_HOME) return path.join(process.env.JAVA_HOME, 'bin', 'java');
  return 'java';
}

function verifyJava(java, toolchain) {
  const result = spawnSync(java, ['-version'], { encoding: 'utf8' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.error) {
    throw new Error(
      `Unable to execute the pinned Java runtime (${java}): ${result.error.message}. ` +
        'Install the exact runtime or set KOVO_JAVA_BIN.',
    );
  }
  const expectedVersion = toolchain.java.version.split('+')[0];
  if (
    result.status !== 0 ||
    !output.includes(`version "${expectedVersion}`) ||
    !output.includes(`Temurin-${toolchain.java.version}`)
  ) {
    throw new Error(
      `Java runtime must be ${toolchain.java.distribution}-${toolchain.java.version}; observed:\n${output.trim()}`,
    );
  }
}

function runTlc({ configPath, coverage, jarPath, java, toolchain }) {
  const temporary = mkdtempSync(path.join(tmpdir(), 'kovo-replay-tlc-'));
  try {
    copyFileSync(path.join(repoRoot, paths.model), path.join(temporary, 'ReplayReservation.tla'));
    copyFileSync(path.join(repoRoot, configPath), path.join(temporary, 'model.cfg'));
    const args = [
      '-XX:+UseParallelGC',
      '-jar',
      jarPath,
      '-workers',
      String(toolchain.execution.workers),
      '-fp',
      String(toolchain.execution.fingerprintPolynomial),
      '-seed',
      '0',
      '-cleanup',
      '-metadir',
      path.join(temporary, 'states'),
      ...(coverage ? ['-coverage', '0'] : ['-difftrace']),
      '-config',
      'model.cfg',
      'ReplayReservation',
    ];
    const result = spawnSync(java, args, {
      cwd: temporary,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    return {
      output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
      status: result.status,
    };
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
}

function actionName(descriptor) {
  if (descriptor === 'Initial predicate') return 'Init';
  return descriptor.match(/^([A-Za-z][A-Za-z0-9]*)/u)?.[1] ?? descriptor;
}

export function normalizeTlcCounterexample(output, entry) {
  const violated = output.match(/Error: Invariant (\S+) is violated\./u)?.[1];
  if (violated !== entry.invariant) {
    throw new Error(
      `${entry.variant} must violate ${entry.invariant}; TLC reported ${String(violated)}`,
    );
  }
  const states = [];
  const pattern = /^State (\d+): <([^>]+)>\n([\s\S]*?)(?=\nState \d+:|\n\d+ states generated)/gmu;
  for (const match of output.matchAll(pattern)) {
    const assignments = new Map();
    for (const assignment of match[3].matchAll(/^\/\\\s+([A-Za-z][A-Za-z0-9]*)\s*=\s*(.+)$/gmu)) {
      assignments.set(assignment[1], assignment[2].trim().replace(/\s+/gu, ' '));
    }
    const changes = {};
    for (const variable of [...entry.variables].sort(asciiCompare)) {
      if (assignments.has(variable)) changes[variable] = assignments.get(variable);
    }
    states.push({ action: actionName(match[2]), changes, step: Number(match[1]) });
  }
  const actions = states.map((state) => state.action);
  if (!sameValues(actions, entry.actions)) {
    throw new Error(
      `${entry.variant} counterexample action trace drifted: expected ${entry.actions.join(' -> ')}, got ${actions.join(' -> ')}`,
    );
  }
  return {
    schema: replayCounterexampleSchema,
    actions,
    invariant: entry.invariant,
    model: paths.model,
    states,
    variant: entry.variant,
  };
}

function coverageCount(output, operator) {
  const match = output.match(
    new RegExp(`^<${operator}\\b[^\\n]*>:\\s+(\\d+)(?::(\\d+))?\\s*$`, 'mu'),
  );
  if (!match) return undefined;
  return Number(match[1]) + Number(match[2] ?? 0);
}

async function checkModel({ printCounterexamples = false, writeCounterexamples = false } = {}) {
  const inputs = loadReplayModelInputs();
  const contract = validateReplayModelContract(inputs);
  if (!contract.ok) {
    throw new Error(
      `Replay model contract failed:\n${contract.findings.map((finding) => `- ${finding}`).join('\n')}`,
    );
  }

  const jarPath = await acquireTlcJar(inputs.toolchain);
  const java = javaBinary();
  verifyJava(java, inputs.toolchain);

  const positive = runTlc({
    configPath: paths.positiveConfig,
    coverage: true,
    jarPath,
    java,
    toolchain: inputs.toolchain,
  });
  if (
    positive.status !== 0 ||
    !positive.output.includes('Model checking completed. No error has been found.') ||
    !/\d+ distinct states found, 0 states left on queue\./u.test(positive.output)
  ) {
    throw new Error(`Positive ReplayReservation model did not close:\n${positive.output}`);
  }
  for (const operator of [
    ...Object.values(modeledActionOperators),
    'BackwardClockStep',
    'Crash',
    'Refuse',
  ]) {
    const count = coverageCount(positive.output, operator);
    if (count === undefined || count === 0) {
      throw new Error(`Positive ReplayReservation model did not exercise ${operator}`);
    }
  }
  if (coverageCount(positive.output, 'EvictPending') !== 0) {
    throw new Error('Positive ReplayReservation model unexpectedly enabled pending eviction');
  }

  const normalized = [];
  for (const entry of counterexampleCases) {
    const broken = runTlc({
      configPath: entry.configPath,
      coverage: false,
      jarPath,
      java,
      toolchain: inputs.toolchain,
    });
    const counterexample = normalizeTlcCounterexample(broken.output, entry);
    normalized.push(counterexample);
    const committed = inputs.counterexamples[entry.variant];
    if (!writeCounterexamples && !sameValues(counterexample, committed)) {
      throw new Error(
        `${entry.variant} TLC trace does not equal ${entry.counterexamplePath}; ` +
          'the model or committed counterexample drifted.',
      );
    }
    if (writeCounterexamples) {
      writeFileSync(
        path.join(repoRoot, entry.counterexamplePath),
        `${JSON.stringify(counterexample, null, 2)}\n`,
      );
    }
  }

  if (printCounterexamples) {
    process.stdout.write(`${JSON.stringify(normalized, null, 2)}\n`);
    return;
  }
  const stateMatch = positive.output.match(/(\d+) states generated, (\d+) distinct states found/u);
  console.log(
    `ReplayReservation TLC ${inputs.toolchain.tlc.release} passed: ` +
      `${stateMatch?.[1] ?? '?'} generated/${stateMatch?.[2] ?? '?'} distinct states, ` +
      `${invariantNames.length} invariants, 2 faithful broken counterexamples.`,
  );
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const allowed = new Set(['--prepare', '--print-counterexamples', '--write-counterexamples']);
  for (const argument of args) {
    if (!allowed.has(argument)) throw new Error(`Unknown replay-model argument: ${argument}`);
  }
  const inputs = loadReplayModelInputs();
  const contract = validateReplayModelContract(inputs);
  if (!contract.ok) {
    throw new Error(
      `Replay model contract failed:\n${contract.findings.map((finding) => `- ${finding}`).join('\n')}`,
    );
  }
  if (args.has('--prepare')) {
    const jarPath = await acquireTlcJar(inputs.toolchain);
    console.log(
      `Prepared TLC ${inputs.toolchain.tlc.release} at ${jarPath} (${inputs.toolchain.tlc.sha256}).`,
    );
    return;
  }
  await checkModel({
    printCounterexamples: args.has('--print-counterexamples'),
    writeCounterexamples: args.has('--write-counterexamples'),
  });
}

if (isMainEntry(import.meta.url)) await runGate(main);
