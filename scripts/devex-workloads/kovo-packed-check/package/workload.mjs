import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

const CHECK_PHASE_CENSUS_SCHEMA = 'kovo-check-phase-census/v1';
const CHECK_WATCH_SCHEMA = 'kovo-check-watch/v1';
const CHECK_WATCH_CENSUS_SCHEMA = 'kovo-check-phase-census/v2';
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
  let sourceRevision = SOURCE_VARIANTS.indexOf(readFileSync(SOURCE_PATH, 'utf8'));
  if (sourceRevision === -1) {
    child.kill('SIGINT');
    throw new Error('incremental check session source does not match a reviewed revision');
  }
  let started = process.hrtime.bigint();

  try {
    observations.push(await nextWatchObservation(lines, child, stderr, 0, sourceRevision, started));
    for (let sampleIndex = 0; sampleIndex < samples; sampleIndex += 1) {
      sourceRevision = sourceRevision === 0 ? 1 : 0;
      started = process.hrtime.bigint();
      writeFileSync(SOURCE_PATH, SOURCE_VARIANTS[sourceRevision]);
      observations.push(
        await nextWatchObservation(lines, child, stderr, sampleIndex + 1, sourceRevision, started),
      );
    }
  } finally {
    child.kill('SIGINT');
    await Promise.race([
      new Promise((resolveExit) => child.once('exit', resolveExit)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
    lines.return?.();
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
  child,
  stderr,
  expectedRevision,
  expectedSourceRevision,
  started,
) {
  const next = await Promise.race([
    lines.next(),
    new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `packed Kovo incremental check timed out at revision ${expectedRevision}: ${stderr}`,
            ),
          ),
        120_000,
      ),
    ),
  ]);
  if (next.done || typeof next.value !== 'string') {
    throw new Error(
      `packed Kovo incremental check exited before revision ${expectedRevision}: ${stderr}`,
    );
  }
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
  validateWatchPhases(record.phaseCensus.phases);
  return Object.freeze({
    analysisDigest: record.input.entry.digest,
    checkGraphDigest: record.phaseCensus.checkGraphDigest,
    closureDigest: record.input.closureDigest,
    diagnosticPhases: record.phaseCensus.phases,
    durationMs: Number(process.hrtime.bigint() - started) / 1e6,
    peakRssBytes: processRssBytes(child.pid),
    projectDigest: record.input.projectDigest,
    revision: expectedRevision,
    sourceRevision: expectedSourceRevision,
  });
}

function validateWatchPhases(phases) {
  if (!Array.isArray(phases) || phases.length !== CHECK_PHASES.length) {
    throw new Error('packed Kovo incremental check omitted diagnostic phases');
  }
  for (let index = 0; index < CHECK_PHASES.length; index += 1) {
    const [name] = CHECK_PHASES[index];
    const phase = phases[index];
    if (
      phase?.name !== name ||
      !['executed', 'not-applicable', 'reused-authenticated'].includes(phase?.status) ||
      !Number.isFinite(phase?.durationMs) ||
      phase.durationMs < 0 ||
      !/^sha256:[0-9a-f]{64}$/u.test(phase?.inputDigest ?? '')
    ) {
      throw new Error(`packed Kovo incremental check did not prove diagnostic phase ${name}`);
    }
  }
}

function processRssBytes(pid) {
  const result = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const kibibytes = Number.parseInt(result.stdout.trim(), 10);
  return Number.isSafeInteger(kibibytes) && kibibytes >= 0 ? kibibytes * 1024 : null;
}
