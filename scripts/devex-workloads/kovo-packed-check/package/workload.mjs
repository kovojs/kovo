import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

const CHECK_PHASE_CENSUS_SCHEMA = 'kovo-check-phase-census/v1';
const CHECK_WATCH_SCHEMA = 'kovo-check-watch/v1';
const CHECK_WATCH_CENSUS_SCHEMA = 'kovo-check-phase-census/v2';
const PROCESS_TREE_SAMPLE_INTERVAL_MS = 20;
const CHECK_PHASES = Object.freeze([
  ['lifecycle-policy', 'not-applicable'],
  ['config-trust', 'executed'],
  ['typescript', 'not-applicable'],
  ['project-quality', 'not-applicable'],
  ['sound-subset', 'not-applicable'],
  ['session-authority', 'executed'],
  ['app-source-trust', 'executed'],
  ['stylesheet', 'executed'],
  ['app-evaluation', 'executed'],
  ['build-check-graph', 'executed'],
  ['graph-diagnostics', 'executed'],
]);
const ALWAYS_EXECUTED_INCREMENTAL_PHASES = new Set([
  'app-evaluation',
  'build-check-graph',
  'graph-diagnostics',
]);
const EDIT_DEPENDENT_PHASES = new Set([
  'session-authority',
  'app-source-trust',
  'stylesheet',
  'app-evaluation',
  'build-check-graph',
  'graph-diagnostics',
]);
const EDIT_INVARIANT_PHASES = new Set([
  'lifecycle-policy',
  'config-trust',
  'typescript',
  'project-quality',
  'sound-subset',
]);

export const SOURCE_PATH = 'src/components/counter-island.tsx';
export const SOURCE_VARIANTS = Object.freeze([
  `/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { s } from '@kovojs/server';

import { app } from '../kovo.js';

export const benchmarkRevision = 0;
export const benchmarkQuery = app.query({
  access: app.publicAccess('DevEx packed reference query'),
  load: () => ({ label: 'ready' }),
  output: s.object({ label: s.string() }),
});

export const CounterIsland = component({
  queries: { benchmark: benchmarkQuery },
  state: () => ({ count: 0 }),
  render: ({ benchmark }, state) => (
    <button
      aria-label="increment benchmark counter"
      data-revision="zero"
      type="button"
      onClick={() => {
        state.count += 1;
      }}
    >
      {benchmark.label}: {state.count}
    </button>
  ),
});
`,
  `/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { s } from '@kovojs/server';

import { app } from '../kovo.js';

export const benchmarkRevision = 1;
export const benchmarkQuery = app.query({
  access: app.publicAccess('DevEx packed reference query'),
  load: () => ({ label: 'ready' }),
  output: s.object({ label: s.string() }),
});

export const CounterIsland = component({
  queries: { benchmark: benchmarkQuery },
  state: () => ({ count: 0 }),
  render: ({ benchmark }, state) => (
    <button
      aria-label="increment benchmark counter"
      data-revision="one"
      type="button"
      onClick={() => {
        state.count += 1;
      }}
    >
      {benchmark.label}: {state.count}
    </button>
  ),
});
`,
]);

export const SOURCE_DIAGNOSTIC_VARIANT = `/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { s } from '@kovojs/server';

import { app } from '../kovo.js';

export const benchmarkRevision = -1;
export const benchmarkQuery = app.query({
  access: app.publicAccess('DevEx packed reference query'),
  load: () => ({ label: 'ready' }),
  output: s.object({ label: s.string() }),
});

export const CounterIsland = component({
  queries: { benchmark: benchmarkQuery },
  state: () => ({ count: 0 }),
  render: ({ benchmark }, state) =>
    \`<button data-revision="diagnostic">\${benchmark.label}: \${state.count}</button>\`,
});
`;

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function timeInvocation(command) {
  if (process.platform === 'darwin') return ['/usr/bin/time', ['-l', ...command]];
  if (process.platform === 'linux') return ['/usr/bin/time', ['-v', ...command]];
  return null;
}

function peakRssBytes(stderr) {
  if (process.platform === 'darwin') {
    const match = /^\s*(\d+)\s+maximum resident set size\s*$/mu.exec(stderr);
    return match ? Number(match[1]) : null;
  }
  if (process.platform === 'linux') {
    const match = /^\s*Maximum resident set size \(kbytes\):\s*(\d+)\s*$/mu.exec(stderr);
    return match ? Number(match[1]) * 1024 : null;
  }
  return null;
}

function sourceAnalysisDigest(source) {
  return sha256(Buffer.from(source, 'utf16le'));
}

function sourceByteDigest(source) {
  return sha256(Buffer.from(source, 'utf8'));
}

function failBuild(result) {
  if (result.status === 0 && !result.signal && !result.error) return;
  throw new Error(
    result.error?.message ??
      result.signal ??
      result.stderr?.trim() ??
      result.stdout?.trim() ??
      `kovo build exited ${String(result.status)}`,
  );
}

function phaseCensus(output, source) {
  const line = String(output ?? '')
    .split(/\r?\n/u)
    .find((candidate) => candidate.startsWith(`${CHECK_PHASE_CENSUS_SCHEMA} `));
  if (line === undefined) {
    throw new Error('packed Kovo check omitted its authenticated diagnostic-phase census');
  }
  let evidence;
  try {
    evidence = JSON.parse(line.slice(CHECK_PHASE_CENSUS_SCHEMA.length + 1));
  } catch {
    throw new Error('packed Kovo check returned malformed diagnostic-phase census JSON');
  }
  if (
    evidence?.schema !== CHECK_PHASE_CENSUS_SCHEMA ||
    !/^sha256:[0-9a-f]{64}$/u.test(evidence?.checkGraphDigest ?? '') ||
    evidence?.source?.path !== SOURCE_PATH ||
    evidence?.source?.encoding !== 'utf16le' ||
    evidence?.source?.codeUnitLength !== source.length ||
    evidence?.source?.contentHash !== sourceAnalysisDigest(source) ||
    !Array.isArray(evidence?.phases) ||
    evidence.phases.length !== CHECK_PHASES.length
  ) {
    throw new Error('packed Kovo check returned diagnostic-phase evidence for the wrong source');
  }
  for (let index = 0; index < CHECK_PHASES.length; index += 1) {
    const [name, status] = CHECK_PHASES[index];
    const phase = evidence.phases[index];
    if (
      phase?.name !== name ||
      phase?.status !== status ||
      !Number.isFinite(phase?.durationMs) ||
      phase.durationMs < 0 ||
      (status === 'not-applicable' && phase.durationMs !== 0)
    ) {
      throw new Error(`packed Kovo check did not prove diagnostic phase ${name}`);
    }
  }
  return evidence;
}

function materializeAuthenticatedLockfile() {
  const expected = readFileSync('benchmark-lock.yaml');
  let observed;
  try {
    observed = readFileSync('pnpm-lock.yaml');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    writeFileSync('pnpm-lock.yaml', expected, { flag: 'wx' });
    observed = readFileSync('pnpm-lock.yaml');
  }
  if (!observed.equals(expected)) {
    throw new Error('packed Kovo app lockfile does not match its authenticated source bytes');
  }
}

export function runVerifiedBuild() {
  materializeAuthenticatedLockfile();
  const cli = path.resolve('node_modules/@kovojs/cli/dist/bin.mjs');
  const command = [process.execPath, cli, 'build', './src/app.tsx', '--out', './dist'];
  const invocation = timeInvocation(command);
  const executable = invocation?.[0] ?? command[0];
  const args = invocation?.[1] ?? command.slice(1);
  const started = process.hrtime.bigint();
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
  failBuild(result);
  if (!/^kovo-build\/v1\r?\n/mu.test(result.stdout ?? '')) {
    throw new Error('packed Kovo app build returned an unrecognized result');
  }

  const source = readFileSync(SOURCE_PATH, 'utf8');
  const analysisDigest = sourceAnalysisDigest(source);
  const graph = JSON.parse(readFileSync('dist/.kovo/graph.json', 'utf8'));
  const analysisInput = graph.analysisInputs?.sources?.find(
    (entry) => entry.path === SOURCE_PATH && entry.role === 'app',
  );
  if (
    analysisInput?.encoding !== 'utf16le' ||
    analysisInput?.codeUnitLength !== source.length ||
    analysisInput?.contentHash !== analysisDigest
  ) {
    throw new Error(
      'packed Kovo app build did not bind the edited component into compiler/security analysis',
    );
  }

  const manifest = JSON.parse(readFileSync('dist/.kovo/manifest.json', 'utf8'));
  const clientModule = manifest.clientModules?.find((entry) =>
    entry.path.endsWith('/src/components/counter-island.client.js'),
  );
  if (
    typeof clientModule?.file !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(clientModule?.digest ?? '') ||
    !clientModule.file.startsWith(`c/__v/${clientModule.digest}/`)
  ) {
    throw new Error('packed Kovo app build did not emit the compiler-owned island client module');
  }
  const clientSource = readFileSync(path.join('dist/.kovo/client', clientModule.file), 'utf8');
  if (!clientSource.includes('CounterIsland$queryUpdatePlans')) {
    throw new Error('packed Kovo client module bytes do not match compiler manifest provenance');
  }

  return {
    analysisDigest,
    clientDigest: clientModule.digest,
    clientFile: clientModule.file,
    durationMs,
    peakRssBytes: invocation === null ? null : peakRssBytes(result.stderr ?? ''),
  };
}

export function runVerifiedCheck() {
  materializeAuthenticatedLockfile();
  const cli = path.resolve('node_modules/@kovojs/cli/dist/bin.mjs');
  const command = [process.execPath, cli, 'check', 'source', './src/app.tsx'];
  const invocation = timeInvocation(command);
  const executable = invocation?.[0] ?? command[0];
  const args = invocation?.[1] ?? command.slice(1);
  const started = process.hrtime.bigint();
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      KOVO_DEVEX_CHECK_PHASE_CENSUS_SOURCE: SOURCE_PATH,
    },
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
  failBuild(result);
  if (!/^kovo-check\/v1\r?\n/mu.test(result.stdout ?? '')) {
    throw new Error('packed Kovo app check returned an unrecognized result');
  }

  const source = readFileSync(SOURCE_PATH, 'utf8');
  const census = phaseCensus(result.stdout, source);
  return {
    analysisDigest: census.source.contentHash,
    checkGraphDigest: census.checkGraphDigest,
    diagnosticPhases: census.phases,
    durationMs,
    peakRssBytes: invocation === null ? null : peakRssBytes(result.stderr ?? ''),
  };
}

export async function runVerifiedIncrementalCheckSession(samples) {
  if (!Number.isSafeInteger(samples) || samples < 1) {
    throw new TypeError('incremental check session requires a positive sample count');
  }
  materializeAuthenticatedLockfile();
  const cli = path.resolve('node_modules/@kovojs/cli/dist/bin.mjs');
  const child = spawn(
    process.execPath,
    [cli, 'check', 'source', './src/app.tsx', '--watch', '--format', 'json'],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  if (child.pid === undefined || child.stdout === null || child.stderr === null) {
    throw new Error('packed Kovo incremental check session did not start');
  }
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-64 * 1024 * 1024);
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })[
    Symbol.asyncIterator
  ]();
  const observations = [];
  const phaseEvidence = incrementalPhaseEvidence();
  const processTree = createRevisionProcessTreeSampler(child.pid);
  let sourceRevision = SOURCE_VARIANTS.indexOf(readFileSync(SOURCE_PATH, 'utf8'));
  if (sourceRevision === -1) {
    processTree.stop();
    child.kill('SIGINT');
    throw new Error('incremental check session source does not match a reviewed revision');
  }
  processTree.beginRevision();
  let started = process.hrtime.bigint();

  try {
    observations.push(
      await nextWatchObservation(
        lines,
        () => stderr,
        processTree,
        phaseEvidence,
        0,
        sourceRevision,
        started,
      ),
    );
    for (let sampleIndex = 0; sampleIndex < samples; sampleIndex += 1) {
      sourceRevision = sourceRevision === 0 ? 1 : 0;
      processTree.beginRevision();
      started = process.hrtime.bigint();
      writeFileSync(SOURCE_PATH, SOURCE_VARIANTS[sourceRevision]);
      observations.push(
        await nextWatchObservation(
          lines,
          () => stderr,
          processTree,
          phaseEvidence,
          sampleIndex + 1,
          sourceRevision,
          started,
        ),
      );
    }
    validateCompleteIncrementalPhaseEvidence(phaseEvidence);
  } finally {
    processTree.stop();
    child.kill('SIGINT');
    await Promise.race([
      new Promise((resolveExit) => child.once('exit', resolveExit)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
    await lines.return?.();
  }
  return Object.freeze({
    observations: Object.freeze(observations),
    pid: child.pid,
    samples,
    schema: 'kovo-incremental-check-session/v1',
    sessionDigest: sha256(Buffer.from(JSON.stringify(observations), 'utf8')),
  });
}

async function nextWatchObservation(
  lines,
  stderr,
  processTree,
  phaseEvidence,
  expectedRevision,
  expectedSourceRevision,
  started,
) {
  let timeout;
  const next = await Promise.race([
    lines.next(),
    new Promise((_, reject) => {
      timeout = setTimeout(
        () =>
          reject(
            new Error(
              `packed Kovo incremental check timed out at revision ${expectedRevision}: ${stderr()}`,
            ),
          ),
        120_000,
      );
    }),
  ]).finally(() => clearTimeout(timeout));
  if (next.done || typeof next.value !== 'string') {
    throw new Error(
      `packed Kovo incremental check exited before revision ${expectedRevision}: ${stderr()}`,
    );
  }
  const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
  let record;
  try {
    record = JSON.parse(next.value);
  } catch {
    throw new Error('packed Kovo incremental check returned malformed JSONL');
  }
  const source = SOURCE_VARIANTS[expectedSourceRevision];
  if (
    record?.version !== CHECK_WATCH_SCHEMA ||
    record?.event !== 'revision' ||
    record?.revision !== expectedRevision ||
    record?.input?.schema !== 'kovo-check-input-proof/v1' ||
    record?.input?.status !== 'accepted' ||
    record?.input?.entry?.path !== SOURCE_PATH ||
    record?.input?.entry?.digest !== sourceByteDigest(source) ||
    !/^sha256:[0-9a-f]{64}$/u.test(record?.input?.closureDigest ?? '') ||
    !/^sha256:[0-9a-f]{64}$/u.test(record?.input?.projectDigest ?? '') ||
    record?.phaseCensus?.schema !== CHECK_WATCH_CENSUS_SCHEMA ||
    !/^sha256:[0-9a-f]{64}$/u.test(record?.phaseCensus?.checkGraphDigest ?? '') ||
    record?.check?.version !== 'kovo-diagnostic/v1' ||
    record?.check?.result?.protocol !== 'kovo-check/v1' ||
    record?.check?.result?.exitCode !== 0 ||
    !/^kovo-check\/v1\r?\nOK\r?\n/mu.test(record?.check?.result?.text ?? '')
  ) {
    throw new Error(`packed Kovo incremental check returned wrong revision ${expectedRevision}`);
  }
  validateWatchPhases(
    record.phaseCensus.phases,
    phaseEvidence,
    expectedRevision,
    expectedSourceRevision,
  );
  const rss = processTree.finishRevision();
  if (rss.peakRssBytes === null || rss.sampleCount < 1) {
    throw new Error(
      `packed Kovo incremental check could not measure process-tree RSS for revision ${expectedRevision}`,
    );
  }
  return Object.freeze({
    analysisDigest: record.input.entry.digest,
    checkGraphDigest: record.phaseCensus.checkGraphDigest,
    closureDigest: record.input.closureDigest,
    diagnosticPhases: record.phaseCensus.phases,
    durationMs,
    peakRssBytes: rss.peakRssBytes,
    processTreeSamples: rss.sampleCount,
    projectDigest: record.input.projectDigest,
    revision: expectedRevision,
    sourceRevision: expectedSourceRevision,
  });
}

function validateWatchPhases(phases, evidence, revision, sourceRevision) {
  if (!Array.isArray(phases) || phases.length !== CHECK_PHASES.length) {
    throw new Error('packed Kovo incremental check omitted diagnostic phases');
  }
  for (let index = 0; index < CHECK_PHASES.length; index += 1) {
    const [name, expectedStatus] = CHECK_PHASES[index];
    const phase = phases[index];
    const allowedStatuses =
      expectedStatus === 'not-applicable'
        ? ['not-applicable']
        : ALWAYS_EXECUTED_INCREMENTAL_PHASES.has(name)
          ? ['executed']
          : ['executed', 'reused-authenticated'];
    if (
      phase?.name !== name ||
      !allowedStatuses.includes(phase?.status) ||
      !Number.isFinite(phase?.durationMs) ||
      phase.durationMs < 0 ||
      ((phase.status === 'not-applicable' || phase.status === 'reused-authenticated') &&
        phase.durationMs !== 0) ||
      !/^sha256:[0-9a-f]{64}$/u.test(phase?.inputDigest ?? '')
    ) {
      throw new Error(`packed Kovo incremental check did not prove diagnostic phase ${name}`);
    }
    if (revision === 0 && phase.status === 'reused-authenticated') {
      throw new Error(`packed Kovo incremental check reused empty-session phase ${name}`);
    }
    const previousDigest = evidence.previousDigests.get(name);
    if (phase.status === 'reused-authenticated' && previousDigest !== phase.inputDigest) {
      throw new Error(`packed Kovo incremental check reused changed-input phase ${name}`);
    }
    if (
      expectedStatus === 'executed' &&
      previousDigest !== undefined &&
      previousDigest !== phase.inputDigest &&
      phase.status !== 'executed'
    ) {
      throw new Error(`packed Kovo incremental check skipped changed-input phase ${name}`);
    }
    evidence.previousDigests.set(name, phase.inputDigest);
    const sourceKey = `${name}\0${sourceRevision}`;
    const sourceDigest = evidence.digestsBySourceRevision.get(sourceKey);
    if (sourceDigest !== undefined && sourceDigest !== phase.inputDigest) {
      throw new Error(
        `packed Kovo incremental check mapped ${name} source revision ${sourceRevision} to inconsistent input digests`,
      );
    }
    evidence.digestsBySourceRevision.set(sourceKey, phase.inputDigest);
    if (EDIT_INVARIANT_PHASES.has(name)) {
      const invariant = evidence.invariantDigests.get(name);
      if (invariant !== undefined && invariant !== phase.inputDigest) {
        throw new Error(`packed Kovo incremental check changed invariant phase digest ${name}`);
      }
      evidence.invariantDigests.set(name, phase.inputDigest);
    }
  }
}

function incrementalPhaseEvidence() {
  return {
    digestsBySourceRevision: new Map(),
    invariantDigests: new Map(),
    previousDigests: new Map(),
  };
}

function validateCompleteIncrementalPhaseEvidence(evidence) {
  for (const name of EDIT_DEPENDENT_PHASES) {
    const first = evidence.digestsBySourceRevision.get(`${name}\0${0}`);
    const second = evidence.digestsBySourceRevision.get(`${name}\0${1}`);
    if (first === undefined || second === undefined || first === second) {
      throw new Error(
        `packed Kovo incremental check did not bind edited source into phase ${name}`,
      );
    }
  }
}

function createRevisionProcessTreeSampler(rootPid) {
  let peakRssBytes = null;
  let sampleCount = 0;
  const sample = () => {
    const result = spawnSync('ps', ['-axo', 'pid=,ppid=,rss='], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.status !== 0 || result.signal || result.error) return;
    const observed = processTreeRssBytesForTesting(result.stdout, rootPid);
    if (observed === null) return;
    peakRssBytes = peakRssBytes === null ? observed : Math.max(peakRssBytes, observed);
    sampleCount += 1;
  };
  sample();
  const timer = setInterval(sample, PROCESS_TREE_SAMPLE_INTERVAL_MS);
  return {
    beginRevision() {
      peakRssBytes = null;
      sampleCount = 0;
      sample();
    },
    finishRevision() {
      sample();
      return { peakRssBytes, sampleCount };
    },
    stop() {
      clearInterval(timer);
    },
  };
}

/** Parse one process table and sum the live root plus all descendants, excluding siblings. */
export function processTreeRssBytesForTesting(output, rootPid) {
  if (!Number.isSafeInteger(rootPid) || rootPid <= 0) {
    throw new TypeError('process-tree root PID must be a positive integer');
  }
  const rows = [];
  for (const line of String(output).split(/\r?\n/u)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/u.exec(line);
    if (match === null) continue;
    const pid = Number(match[1]);
    const parentPid = Number(match[2]);
    const rssKiB = Number(match[3]);
    if (
      !Number.isSafeInteger(pid) ||
      !Number.isSafeInteger(parentPid) ||
      !Number.isSafeInteger(rssKiB)
    ) {
      continue;
    }
    rows.push({ parentPid, pid, rssKiB });
  }
  if (!rows.some((row) => row.pid === rootPid)) return null;
  const descendants = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (descendants.has(row.pid) || !descendants.has(row.parentPid)) continue;
      descendants.add(row.pid);
      changed = true;
    }
  }
  return (
    rows.filter((row) => descendants.has(row.pid)).reduce((total, row) => total + row.rssKiB, 0) *
    1024
  );
}
