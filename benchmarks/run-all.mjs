#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

import { runAppBenchmark } from './harness/run.mjs';
import { DEFAULT_LIGHTHOUSE_REPEATS } from './harness/lighthouse.mjs';
import { SETTLE_DEFAULTS } from './harness/scenarios.mjs';
import { writeReport } from './harness/report.mjs';

const benchmarkRoot = fileURLToPath(new URL('.', import.meta.url));
const resultsDir = path.join(benchmarkRoot, 'results');

// Every entrant is started with NODE_ENV=production. Kovo additionally requires deployment
// attestation material in that posture: `registerGeneratedRuntimePostureManifest` throws
// "Production runtime posture registration requires KOVO_ATTESTATION_DEPLOYMENT_ID and
// KOVO_ATTESTATION_SECRET" (SPEC §11.2) at module load. Because the framework itself refuses to
// boot in production without them, a Kovo server that answers HTTP with these set is, by
// construction, in production posture — that is the posture check, not a claim in a comment.
//
// plans/good-perf.md O15: run-all.mjs previously never set NODE_ENV, so Kovo was benchmarked in
// DEVELOPMENT posture against a Next.js production standalone build for every published number.
const runId = randomBytes(6).toString('hex');
const kovoAttestation = {
  KOVO_ATTESTATION_DEPLOYMENT_ID: `deployment:kovo-benchmark-${runId}`,
  KOVO_ATTESTATION_SECRET: randomBytes(32).toString('hex'),
};

/** Log fragments that prove a server is NOT in the posture this harness claims it is in. */
const DEVELOPMENT_POSTURE_MARKERS = [' in development', 'development posture'];

const allApps = [
  {
    build: ['pnpm', ['--dir', path.join(benchmarkRoot, 'kovo'), 'run', 'build']],
    cwd: path.join(benchmarkRoot, 'kovo'),
    env: { NODE_ENV: 'production', ...kovoAttestation },
    framework: 'Kovo',
    id: 'kovo',
    port: 4310,
    start: ['pnpm', ['run', 'start']],
    versions: {
      kovo: await packageVersion(path.join(benchmarkRoot, 'kovo/package.json'), '@kovojs/server'),
    },
  },
  {
    build: ['pnpm', ['--dir', path.join(benchmarkRoot, 'nextjs'), 'run', 'build']],
    cwd: path.join(benchmarkRoot, 'nextjs'),
    env: { NODE_ENV: 'production' },
    framework: 'Next.js App Router',
    id: 'nextjs',
    port: 4311,
    start: ['node', ['.next/standalone/benchmarks/nextjs/server.js']],
    versions: await dependencyVersions(path.join(benchmarkRoot, 'nextjs/package.json'), [
      'next',
      'react',
      'react-dom',
    ]),
  },
  {
    build: ['pnpm', ['--dir', path.join(benchmarkRoot, 'tanstack'), 'run', 'build']],
    cwd: path.join(benchmarkRoot, 'tanstack'),
    env: { NODE_ENV: 'production' },
    framework: 'TanStack Start',
    id: 'tanstack',
    port: 4312,
    start: ['pnpm', ['run', 'start']],
    versions: await dependencyVersions(path.join(benchmarkRoot, 'tanstack/package.json'), [
      '@tanstack/react-start',
      '@tanstack/react-router',
      'react',
      'react-dom',
    ]),
  },
];

const iterations = Number(readArg('--iterations') ?? process.env.BENCH_ITERATIONS ?? '10');
const runLighthouse = !process.argv.includes('--skip-lighthouse');
const lighthouseRepeats = Number(readArg('--lighthouse-runs') ?? DEFAULT_LIGHTHOUSE_REPEATS);
const bfcacheIterations = Number(readArg('--bfcache-iterations') ?? '3');
const skipBuild = process.argv.includes('--skip-build');
const settle = {
  maxMs: Number(readArg('--settle-max-ms') ?? SETTLE_DEFAULTS.maxMs),
  quietMs: Number(readArg('--settle-quiet-ms') ?? SETTLE_DEFAULTS.quietMs),
};

// `--apps kovo,nextjs` restricts the run to a subset of entrants so one entrant that cannot build
// does not block the rest of the comparison. `--out-dir` redirects results away from the committed
// `benchmarks/results/` snapshot.
const appFilter = readArg('--apps')
  ?.split(',')
  .map((id) => id.trim())
  .filter(Boolean);
const apps = appFilter ? allApps.filter((app) => appFilter.includes(app.id)) : allApps;
if (apps.length === 0) throw new Error(`No benchmark apps matched --apps ${readArg('--apps')}.`);

const outDir = readArg('--out-dir') ? path.resolve(readArg('--out-dir')) : resultsDir;

// `--port-base 4810` shifts every entrant's listen port so two benchmark runs on the same machine
// cannot silently measure each other's server. Without this, a stale listener on the default port
// is indistinguishable from a healthy start: `waitForHttp` just sees a 200 and proceeds.
const portBase = readArg('--port-base') ? Number(readArg('--port-base')) : null;
if (portBase !== null) {
  if (!Number.isInteger(portBase) || portBase < 1024 || portBase > 65000) {
    throw new Error(`--port-base must be an integer between 1024 and 65000, got ${portBase}.`);
  }
  const basePort = Math.min(...allApps.map((app) => app.port));
  for (const app of allApps) app.port = portBase + (app.port - basePort);
}

await mkdir(outDir, { recursive: true });

if (!skipBuild) {
  for (const app of apps) {
    await runCommand(app.build[0], app.build[1], { cwd: benchmarkRoot, label: `${app.id}:build` });
  }
}

// Fail fast if any entrant's port is already taken. `waitForHttp` cannot tell a healthy start from
// a foreign listener left behind by another run: both answer 200, so the benchmark would silently
// measure someone else's process. Checking every port up front also avoids burning the first
// entrant's run before discovering the second entrant's port is occupied.
for (const app of apps) {
  if (await portInUse(app.port)) {
    throw new Error(
      `Port ${app.port} (${app.id}) is already in use. Another benchmark run or a stale server is ` +
        `holding it; stop it or pass --port-base to move this run out of the way.`,
    );
  }
}

const results = [];
for (const app of apps) {
  const serverLog = [];
  const server = spawn(app.start[0], app.start[1], {
    cwd: app.cwd,
    env: {
      ...process.env,
      ...app.env,
      HOST: '127.0.0.1',
      HOSTNAME: '127.0.0.1',
      PORT: String(app.port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  pipeServerLogs(app.id, server, serverLog);
  // A server that dies mid-run leaves the scenarios timing a dead origin, so surface it loudly.
  let serverExit = null;
  server.on('exit', (code, signal) => {
    serverExit = `${app.id} server exited early (code ${code}, signal ${signal}).`;
    process.stderr.write(`[${app.id}] ${serverExit}\n`);
  });
  try {
    const origin = `http://127.0.0.1:${app.port}`;
    await waitForHttp(origin, () => serverExit);
    app.posture = {
      attestation: app.id === 'kovo' ? 'synthesized-per-run' : 'not-required',
      nodeEnv: app.env?.NODE_ENV ?? null,
    };
    results.push(
      await runAppBenchmark({
        app,
        bfcacheIterations,
        iterations,
        lighthouse: runLighthouse,
        lighthouseRepeats,
        origin,
        settle,
      }),
    );
    if (serverExit) throw new Error(serverExit);
    assertPostureMatched(app, serverLog);
    // Checked per entrant, not at the end: a rejected run should not first spend the remaining
    // entrants' wall clock producing numbers it is going to refuse to publish anyway.
    assertMeasurementIntegrity(results.slice(-1));
  } finally {
    await stopServer(server);
  }
}

const output = {
  generatedAt: new Date().toISOString(),
  iterations,
  lighthouseRepeats: runLighthouse ? lighthouseRepeats : 0,
  machine: {
    arch: os.arch(),
    cpus: os.cpus().length,
    // Load average AT THE END of the run. Wall-clock numbers taken above ~1.0 per core are not
    // comparable with numbers taken on an idle box; the report prints this so a reader can tell.
    loadAverage: os.loadavg(),
    node: process.version,
    platform: os.platform(),
    totalMemoryBytes: os.totalmem(),
  },
  runId,
  settle,
  apps: results,
};
const resultsPath = path.join(outDir, 'results.json');
const reportPath = path.join(outDir, 'report.md');
await writeFile(resultsPath, `${JSON.stringify(output, null, 2)}\n`);
await writeReport(resultsPath, reportPath);
process.stdout.write(`benchmark results written to ${path.relative(process.cwd(), reportPath)}\n`);

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

/**
 * Refuses to report numbers taken in a posture the run did not actually achieve.
 *
 * plans/good-perf.md O15 requires the harness to "either posture-match both entrants or fail loudly
 * and record the mismatch in the report. Do not silently continue."
 */
function assertPostureMatched(app, serverLog) {
  if (app.env?.NODE_ENV !== 'production') return;
  const offending = serverLog.filter((line) =>
    DEVELOPMENT_POSTURE_MARKERS.some((marker) => line.toLowerCase().includes(marker)),
  );
  if (offending.length > 0) {
    throw new Error(
      `${app.id} was started with NODE_ENV=production but reported development posture:\n` +
        offending.map((line) => `  ${line}`).join('\n'),
    );
  }
}

/**
 * Refuses to publish a run whose numbers were shaped by load shedding or server errors.
 *
 * Kovo's DEFAULT_PER_IP_RATE is 600 requests/minute for every source IP, and the whole benchmark
 * arrives from 127.0.0.1 (plans/good-perf.md O13). A shed run looks fast and plausible; without
 * this check it would be indistinguishable from a healthy one.
 */
function assertMeasurementIntegrity(runs) {
  const problems = [];
  for (const run of runs) {
    for (const [conditionName, condition] of Object.entries(run.conditions ?? {})) {
      for (const [scenarioName, scenario] of Object.entries(condition)) {
        for (const iteration of scenario?.iterations ?? []) {
          if (iteration.rateLimitedResponses > 0) {
            problems.push(
              `${run.app}/${conditionName}/${scenarioName}: ${iteration.rateLimitedResponses} ` +
                `HTTP 429 responses — the server shed load, so these timings are not comparable.`,
            );
          }
          if (iteration.errorResponses > 0) {
            problems.push(
              `${run.app}/${conditionName}/${scenarioName}: ${iteration.errorResponses} ` +
                `HTTP >=400 responses.`,
            );
          }
        }
      }
    }
  }
  if (problems.length > 0) {
    const unique = [...new Set(problems)];
    throw new Error(
      `Benchmark run rejected — the measurement was not clean:\n${unique
        .map((problem) => `  ${problem}`)
        .join('\n')}`,
    );
  }
}

async function dependencyVersions(packagePath, names) {
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  return Object.fromEntries(names.map((name) => [name, all[name] ?? 'n/a']));
}

async function packageVersion(packagePath, name) {
  return (await dependencyVersions(packagePath, [name]))[name];
}

function runCommand(command, args, { cwd, label }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed with exit code ${code}.`));
    });
  });
}

function pipeServerLogs(id, server, sink) {
  const record = (chunk) => {
    const text = String(chunk);
    for (const line of text.split('\n')) {
      if (line.trim().length > 0) sink.push(line);
    }
    return text;
  };
  server.stdout.on('data', (chunk) => {
    process.stdout.write(`[${id}] ${record(chunk)}`);
  });
  server.stderr.on('data', (chunk) => {
    process.stderr.write(`[${id}] ${record(chunk)}`);
  });
}

function portInUse(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(true));
    probe.once('listening', () => probe.close(() => resolve(false)));
    probe.listen(port, '127.0.0.1');
  });
}

async function waitForHttp(origin, exited) {
  const deadline = Date.now() + 30000;
  let lastError;
  while (Date.now() < deadline) {
    // A server that refuses to boot in the requested posture exits instead of listening; report
    // that instead of a 30 s timeout whose message blames the network.
    const exitMessage = exited?.();
    if (exitMessage) throw new Error(exitMessage);
    try {
      const response = await fetch(origin);
      if (response.status < 500) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${origin}: ${lastError?.message ?? 'no response'}`);
}

function stopServer(server) {
  return new Promise((resolve) => {
    if (server.exitCode !== null || server.signalCode !== null) {
      resolve();
      return;
    }
    server.once('exit', () => resolve());
    server.kill('SIGTERM');
    setTimeout(() => {
      if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
    }, 5000).unref();
  });
}
