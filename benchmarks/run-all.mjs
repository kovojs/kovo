#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

import { runAppBenchmark } from './harness/run.mjs';
import { writeReport } from './harness/report.mjs';

const benchmarkRoot = fileURLToPath(new URL('.', import.meta.url));
const resultsDir = path.join(benchmarkRoot, 'results');

const allApps = [
  {
    build: ['pnpm', ['--dir', path.join(benchmarkRoot, 'kovo'), 'run', 'build']],
    cwd: path.join(benchmarkRoot, 'kovo'),
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
const skipBuild = process.argv.includes('--skip-build');

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
  const server = spawn(app.start[0], app.start[1], {
    cwd: app.cwd,
    env: { ...process.env, HOST: '127.0.0.1', HOSTNAME: '127.0.0.1', PORT: String(app.port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  pipeServerLogs(app.id, server);
  // A server that dies mid-run leaves the scenarios timing a dead origin, so surface it loudly.
  let serverExit = null;
  server.on('exit', (code, signal) => {
    serverExit = `${app.id} server exited early (code ${code}, signal ${signal}).`;
    process.stderr.write(`[${app.id}] ${serverExit}\n`);
  });
  try {
    const origin = `http://127.0.0.1:${app.port}`;
    await waitForHttp(origin);
    results.push(await runAppBenchmark({ app, iterations, lighthouse: runLighthouse, origin }));
    if (serverExit) throw new Error(serverExit);
  } finally {
    await stopServer(server);
  }
}

const output = {
  generatedAt: new Date().toISOString(),
  iterations,
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

function pipeServerLogs(id, server) {
  server.stdout.on('data', (chunk) => {
    process.stdout.write(`[${id}] ${chunk}`);
  });
  server.stderr.on('data', (chunk) => {
    process.stderr.write(`[${id}] ${chunk}`);
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

async function waitForHttp(origin) {
  const deadline = Date.now() + 30000;
  let lastError;
  while (Date.now() < deadline) {
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
