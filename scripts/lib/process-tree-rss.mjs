#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PROCESS_TREE_RSS_SCHEMA = 'kovo-process-tree-rss/v1';

const DEFAULT_SAMPLE_INTERVAL_MS = 50;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_RESULT_BYTES = 64 * 1024;

/**
 * Measure the resident bytes held concurrently by a command and every live descendant.
 *
 * `resourceUsage().maxRSS` and `/usr/bin/time` report a process high-water mark, not the peak
 * sum of a concurrently live process tree. Kovo's check/build commands deliberately fan out, so
 * the DevEx budget needs the latter. A small Node supervisor samples the OS process table while
 * keeping argv execution shell-free.
 */
export function measureProcessTreeCommand(command, options = {}) {
  validateCommand(command);
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'kovo-process-tree-rss-'));
  const resultPath = path.join(temporaryRoot, 'result.json');
  const timeoutMs = boundedInteger(
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    1_000,
    60 * 60 * 1000,
    'timeoutMs',
  );
  const sampleIntervalMs = boundedInteger(
    options.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS,
    10,
    1_000,
    'sampleIntervalMs',
  );
  try {
    const supervisor = spawnSync(
      process.execPath,
      [
        fileURLToPath(import.meta.url),
        '--worker',
        '--result',
        resultPath,
        '--interval',
        String(sampleIntervalMs),
        '--timeout',
        String(timeoutMs),
        '--',
        ...command,
      ],
      {
        cwd: path.resolve(options.cwd ?? process.cwd()),
        encoding: 'utf8',
        env: { ...process.env, ...options.env },
        maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutMs + 5_000,
      },
    );
    let report = null;
    try {
      const bytes = readFileSync(resultPath);
      if (bytes.byteLength > MAX_RESULT_BYTES) {
        throw new Error('process-tree RSS report exceeded its evidence bound');
      }
      report = JSON.parse(bytes.toString('utf8'));
      assertProcessTreeReport(report);
    } catch (error) {
      return {
        durationMs: null,
        peakRssBytes: null,
        sampleCount: 0,
        exitCode: null,
        signal: supervisor.signal ?? null,
        stdout: supervisor.stdout ?? '',
        stderr: supervisor.stderr ?? '',
        error:
          supervisor.error?.message ??
          `process-tree RSS supervisor did not produce authenticated evidence: ${
            error instanceof Error ? error.message : String(error)
          }`,
      };
    }
    return {
      durationMs: report.durationMs,
      peakRssBytes: report.peakRssBytes,
      sampleCount: report.sampleCount,
      exitCode: report.exitCode,
      signal: report.signal,
      stdout: supervisor.stdout ?? '',
      stderr: supervisor.stderr ?? '',
      error:
        supervisor.error?.message ??
        (supervisor.status === 0 || supervisor.status === report.exitCode ? null : report.error),
    };
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

/**
 * Parse one `ps -axo pid=,ppid=,rss=` snapshot and sum the root plus every descendant.
 * Exported for adversarial tests; malformed rows are ignored rather than guessed.
 */
export function processTreeRssBytes(psOutput, rootPid) {
  if (!Number.isSafeInteger(rootPid) || rootPid <= 0) {
    throw new TypeError('rootPid must be a positive safe integer');
  }
  const rows = [];
  for (const line of String(psOutput).split(/\r?\n/u)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/u.exec(line);
    if (!match) continue;
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
    rows.push({ pid, parentPid, rssKiB });
  }

  const descendants = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (!descendants.has(row.pid) && descendants.has(row.parentPid)) {
        descendants.add(row.pid);
        changed = true;
      }
    }
  }
  return (
    rows.filter((row) => descendants.has(row.pid)).reduce((total, row) => total + row.rssKiB, 0) *
    1024
  );
}

export function assertProcessTreeReport(report) {
  const keys =
    report && typeof report === 'object' && !Array.isArray(report)
      ? Object.keys(report).sort()
      : [];
  const expected = [
    'durationMs',
    'error',
    'exitCode',
    'peakRssBytes',
    'sampleCount',
    'sampleIntervalMs',
    'schema',
    'signal',
  ];
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    throw new TypeError('process-tree RSS report has an unexpected shape');
  }
  if (
    report.schema !== PROCESS_TREE_RSS_SCHEMA ||
    !finiteNonNegative(report.durationMs) ||
    !finiteNonNegative(report.peakRssBytes) ||
    !Number.isSafeInteger(report.sampleCount) ||
    report.sampleCount < 1 ||
    !Number.isSafeInteger(report.sampleIntervalMs) ||
    report.sampleIntervalMs < 10 ||
    (report.exitCode !== null &&
      (!Number.isSafeInteger(report.exitCode) || report.exitCode < 0 || report.exitCode > 255)) ||
    (report.signal !== null && typeof report.signal !== 'string') ||
    (report.error !== null && typeof report.error !== 'string')
  ) {
    throw new TypeError('process-tree RSS report contains invalid evidence');
  }
}

async function runWorker(argv) {
  const options = parseWorkerArgs(argv);
  const started = process.hrtime.bigint();
  const child = spawn(options.command[0], options.command.slice(1), {
    cwd: process.cwd(),
    detached: process.platform !== 'win32',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);

  let peakRssBytes = 0;
  let sampleCount = 0;
  let samplingError = null;
  const sample = () => {
    if (child.pid === undefined) return;
    const result = spawnSync('ps', ['-axo', 'pid=,ppid=,rss='], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.status !== 0 || result.signal || result.error) {
      samplingError =
        result.error?.message ?? result.signal ?? result.stderr?.trim() ?? 'ps failed';
      return;
    }
    peakRssBytes = Math.max(peakRssBytes, processTreeRssBytes(result.stdout, child.pid));
    sampleCount += 1;
  };
  sample();
  const timer = setInterval(sample, options.sampleIntervalMs);

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    terminateProcessGroup(child.pid, 'SIGTERM');
    setTimeout(() => terminateProcessGroup(child.pid, 'SIGKILL'), 2_000).unref();
  }, options.timeoutMs);

  const outcome = await new Promise((resolve) => {
    let settled = false;
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      resolve({ error: error.message, exitCode: null, signal: null });
    });
    child.once('exit', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      resolve({ error: null, exitCode, signal });
    });
  });
  clearInterval(timer);
  clearTimeout(timeout);
  sample();

  const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
  const error =
    outcome.error ??
    (timedOut
      ? `command exceeded ${String(options.timeoutMs)}ms`
      : samplingError === null
        ? null
        : `process-table sampling failed: ${String(samplingError)}`);
  const report = {
    durationMs,
    error,
    exitCode: outcome.exitCode,
    peakRssBytes,
    sampleCount: Math.max(1, sampleCount),
    sampleIntervalMs: options.sampleIntervalMs,
    schema: PROCESS_TREE_RSS_SCHEMA,
    signal: outcome.signal,
  };
  writeFileSync(options.resultPath, `${JSON.stringify(report)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  process.exitCode =
    outcome.exitCode === null ? 2 : outcome.exitCode === 0 && error !== null ? 2 : outcome.exitCode;
}

function parseWorkerArgs(argv) {
  let resultPath;
  let sampleIntervalMs = DEFAULT_SAMPLE_INTERVAL_MS;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let separator = -1;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') {
      separator = index;
      break;
    }
    const value = argv[index + 1];
    if (token === '--result' || token === '--interval' || token === '--timeout') {
      if (!value) throw new TypeError(`${token} requires a value`);
      index += 1;
      if (token === '--result') resultPath = path.resolve(value);
      if (token === '--interval') {
        sampleIntervalMs = boundedInteger(Number(value), 10, 1_000, 'sample interval');
      }
      if (token === '--timeout') {
        timeoutMs = boundedInteger(Number(value), 1_000, 60 * 60 * 1000, 'timeout');
      }
      continue;
    }
    throw new TypeError(`unknown process-tree worker option ${String(token)}`);
  }
  const command = separator === -1 ? [] : argv.slice(separator + 1);
  validateCommand(command);
  if (!resultPath) throw new TypeError('--result is required');
  return { command, resultPath, sampleIntervalMs, timeoutMs };
}

function terminateProcessGroup(pid, signal) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function validateCommand(command) {
  if (
    !Array.isArray(command) ||
    command.length === 0 ||
    command.some((part) => typeof part !== 'string' || part.length === 0)
  ) {
    throw new TypeError('command must be a non-empty argv array');
  }
}

function boundedInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function finiteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href &&
  process.argv[2] === '--worker'
) {
  try {
    await runWorker(process.argv.slice(3));
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 2;
  }
}
