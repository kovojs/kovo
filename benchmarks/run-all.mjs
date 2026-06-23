#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { runAppBenchmark } from './harness/run.mjs';
import { writeReport } from './harness/report.mjs';

const benchmarkRoot = fileURLToPath(new URL('.', import.meta.url));
const resultsDir = path.join(benchmarkRoot, 'results');

const apps = [
  {
    build: ['pnpm', ['--dir', path.join(benchmarkRoot, 'kovo'), 'run', 'build']],
    cwd: path.join(benchmarkRoot, 'kovo'),
    framework: 'Kovo',
    id: 'kovo',
    port: 4310,
    start: ['pnpm', ['run', 'start']],
    versions: { kovo: await packageVersion(path.join(benchmarkRoot, 'kovo/package.json'), '@kovojs/server') },
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

await mkdir(resultsDir, { recursive: true });

if (!skipBuild) {
  for (const app of apps) {
    await runCommand(app.build[0], app.build[1], { cwd: benchmarkRoot, label: `${app.id}:build` });
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
  try {
    const origin = `http://127.0.0.1:${app.port}`;
    await waitForHttp(origin);
    results.push(await runAppBenchmark({ app, iterations, lighthouse: runLighthouse, origin }));
  } finally {
    await stopServer(server);
  }
}

const output = {
  generatedAt: new Date().toISOString(),
  iterations,
  apps: results,
};
const resultsPath = path.join(resultsDir, 'results.json');
const reportPath = path.join(resultsDir, 'report.md');
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
  const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
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
