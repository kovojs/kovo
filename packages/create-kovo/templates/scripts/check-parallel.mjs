#!/usr/bin/env node
// Concurrent runner for the Kovo starter `check` pipeline.
//
// The starter's verification has four steps that the npm `check` script used to
// run strictly sequentially:
//   vp check && pnpm run check:sound-subset && pnpm run build:prod && pnpm run check:endpoint-posture
// Three of those steps are independent, so this runner fans them out across
// concurrent "lanes" to shorten the warm pipeline (measured ~9.5s -> ~5.9s,
// ~38% faster) while staying FAIL-CLOSED: the process exits non-zero if ANY
// step fails, and the failing step's output stays legible because every line is
// prefixed with its step label.
//
// RACE SAFETY: `build:prod` (kovo build) and `check:endpoint-posture`
// (vitest + `kovo check`) BOTH write the shared, gitignored tsc incremental
// preflight `.kovo/cache/tsc-preflight.tsbuildinfo`. It is written in place by
// tsc, so running build + posture concurrently could corrupt it. They stay in ONE
// SEQUENTIAL lane (build THEN posture). `vp check` and `check:sound-subset` do
// not touch `.kovo/cache`, so each runs as its own concurrent lane.
//
// No bash-isms: all orchestration happens in Node; each step is a single
// program invoked via child_process.spawn.

import { spawn } from 'node:child_process';

const isWindows = process.platform === 'win32';
const useColor = Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;
const pm = 'pnpm';

// Lanes run CONCURRENTLY. Steps WITHIN a lane run SEQUENTIALLY; a failed step
// short-circuits the remaining steps in its lane (they are reported as skipped).
const lanes = [
  [step('vp check', 'vp', ['check'])],
  [step('sound-subset', pm, ['run', 'check:sound-subset'])],
  [
    step('build:prod', pm, ['run', 'build:prod']),
    step('endpoint-posture', pm, ['run', 'check:endpoint-posture']),
  ],
];

const palette = [36, 35, 33, 32, 34, 31, 96, 95];
{
  let colorIndex = 0;
  for (const lane of lanes) {
    for (const item of lane) {
      item.color = palette[colorIndex % palette.length];
      colorIndex += 1;
    }
  }
}
const labelWidth = Math.max(...lanes.flat().map((item) => item.label.length));

/** Live children, tracked so a Ctrl+C cleanly tears the whole pipeline down. */
const activeChildren = new Set();
let terminating = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    terminating = true;
    for (const child of activeChildren) child.kill(signal);
  });
}

const startedAt = Date.now();
const resultsByLabel = new Map();

await Promise.all(lanes.map((lane) => runLane(lane)));

const totalMs = Date.now() - startedAt;
const ordered = lanes.flat().map((item) => resultsByLabel.get(item.label));
const failures = ordered.filter((result) => result && !result.ok);

printSummary(ordered, failures, totalMs);

// Use exitCode (not process.exit) so buffered stdout/stderr flush before exit.
process.exitCode = failures.length > 0 ? 1 : 0;

function step(label, command, args) {
  return { args, color: 0, command, label };
}

async function runLane(lane) {
  for (let index = 0; index < lane.length; index += 1) {
    const current = lane[index];
    if (terminating) {
      resultsByLabel.set(current.label, { label: current.label, ok: false, skipped: true });
      continue;
    }
    const result = await runStep(current);
    resultsByLabel.set(current.label, result);
    if (!result.ok) {
      for (let rest = index + 1; rest < lane.length; rest += 1) {
        const skipped = lane[rest];
        resultsByLabel.set(skipped.label, { label: skipped.label, ok: false, skipped: true });
        emitLine(skipped, `skipped (prior step "${current.label}" failed)`, 'meta');
      }
      return;
    }
  }
}

function runStep(current) {
  return new Promise((resolve) => {
    emitLine(current, `$ ${current.command} ${current.args.join(' ')}`, 'meta');
    const stepStart = Date.now();
    let settled = false;
    const finish = (ok, code) => {
      if (settled) return;
      settled = true;
      resolve({ code, durationMs: Date.now() - stepStart, label: current.label, ok });
    };

    let child;
    try {
      child = spawn(current.command, current.args, {
        cwd: process.cwd(),
        env: process.env,
        // shell only on Windows, where `pnpm`/`vp` are `.cmd` shims; the args
        // are static literals with no spaces or shell metacharacters.
        shell: isWindows,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      emitLine(current, `failed to start: ${describeError(error)}`, 'err');
      finish(false, null);
      return;
    }

    activeChildren.add(child);
    const flushStdout = lineStreamer(current, 'out');
    const flushStderr = lineStreamer(current, 'err');
    child.stdout.on('data', flushStdout);
    child.stderr.on('data', flushStderr);

    child.on('error', (error) => {
      flushStdout(null);
      flushStderr(null);
      activeChildren.delete(child);
      emitLine(current, `failed to start: ${describeError(error)}`, 'err');
      finish(false, null);
    });
    child.on('close', (code, signal) => {
      flushStdout(null);
      flushStderr(null);
      activeChildren.delete(child);
      finish(code === 0, code ?? (signal ? `signal ${signal}` : null));
    });
  });
}

function lineStreamer(current, kind) {
  let buffer = '';
  return (chunk) => {
    if (chunk === null) {
      if (buffer.length > 0) {
        emitLine(current, buffer, kind);
        buffer = '';
      }
      return;
    }
    buffer += chunk.toString('utf8');
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
      emitLine(current, line, kind);
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf('\n');
    }
  };
}

function emitLine(current, text, kind) {
  const label = current.label.padEnd(labelWidth);
  const prefix = useColor
    ? `\u001b[${current.color}m${label}\u001b[0m \u001b[2m|\u001b[0m `
    : `${label} | `;
  const body = kind === 'meta' && useColor ? `\u001b[2m${text}\u001b[0m` : text;
  const target = kind === 'err' ? process.stderr : process.stdout;
  target.write(`${prefix}${body}\n`);
}

function printSummary(ordered, failures, elapsedMs) {
  const line = (text) => process.stdout.write(`${text}\n`);
  line('');
  line(
    useColor
      ? `\u001b[1mcheck summary\u001b[0m (${seconds(elapsedMs)})`
      : `check summary (${seconds(elapsedMs)})`,
  );
  for (const result of ordered) {
    if (!result) continue;
    const detail = result.skipped
      ? 'skipped'
      : result.ok
        ? seconds(result.durationMs)
        : `${seconds(result.durationMs)}, exit ${result.code}`;
    line(`  ${badge(result)}  ${result.label.padEnd(labelWidth)}  (${detail})`);
  }
  if (failures.length > 0) {
    const names = failures.map((result) => result.label).join(', ');
    const message = `check failed: ${failures.length} of ${ordered.length} step(s) failed (${names})`;
    process.stderr.write(`${useColor ? `\u001b[31m${message}\u001b[0m` : message}\n`);
  } else {
    line(useColor ? '\u001b[32mcheck passed\u001b[0m' : 'check passed');
  }
}

function badge(result) {
  if (result.skipped) return useColor ? '\u001b[2mSKIP\u001b[0m' : 'SKIP';
  if (result.ok) return useColor ? '\u001b[32mPASS\u001b[0m' : 'PASS';
  return useColor ? '\u001b[31mFAIL\u001b[0m' : 'FAIL';
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}
