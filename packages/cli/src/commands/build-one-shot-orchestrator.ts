import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';

import { parseKovoCommandInvocation } from '../commands-manifest.js';
import type { KovoCommandSecurityDisposition } from './security-disposition.js';
import {
  inspectKovoBuildOneShotHandoff,
  KOVO_BUILD_ONE_SHOT_MAX_WIRE_BYTES,
} from './build-one-shot-handoff.js';

// A one-shot analysis can itself run the bounded 420s static-trust worker. The outer phase retains
// more than twice that measured ceiling so loaded CI remains viable, while every spawn/input/work/
// output/close path still has a fixed framework-owned wall deadline.
const kovoBuildOneShotWorkerTimeoutMs = 900_000;
const kovoBuildOneShotInputCloseTimeoutMs = 30_000;
const capturedClearTimeout = globalThis.clearTimeout.bind(globalThis);
const capturedSetTimeout = globalThis.setTimeout.bind(globalThis);
const capturedProcessKill = process.kill.bind(process);
const capturedProcessPlatform = process.platform;
const oneShotParentSignals = ['SIGHUP', 'SIGINT', 'SIGTERM'] as const;

/** Run packed/source one-shot source checking or build phases without retaining phase heaps. */
export function runKovoIsolatedOneShotInvocation(
  args: readonly string[],
  binPath: string,
  security: KovoCommandSecurityDisposition,
): Promise<number | undefined> {
  return runKovoIsolatedOneShotInvocationAsync(args, binPath, security);
}

async function runKovoIsolatedOneShotInvocationAsync(
  args: readonly string[],
  binPath: string,
  security: KovoCommandSecurityDisposition,
): Promise<number | undefined> {
  const check =
    args[0] === 'check' ? parseKovoCommandInvocation('check', args.slice(1)) : undefined;
  if (check?.ok && (check.value.form === 'source-default' || check.value.form === 'source')) {
    try {
      const analysis = await runWorker(binPath, 'check', args.slice(1), security, undefined, true);
      if (analysis.status !== 0) return analysis.status;
      if (!Buffer.isBuffer(analysis.control)) {
        throw new TypeError('Kovo check analysis worker omitted its private handoff.');
      }
      const inspection = inspectKovoBuildOneShotHandoff(analysis.control);
      return (
        await runWorker(
          binPath,
          'check-final',
          [JSON.stringify(inspection.identity), ...args.slice(1)],
          security,
          analysis.control,
        )
      ).status;
    } catch (error) {
      process.stderr.write(
        `kovo check isolation failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return 1;
    }
  }
  const build =
    args[0] === 'build' ? parseKovoCommandInvocation('build', args.slice(1)) : undefined;
  if (!build?.ok) return undefined;

  try {
    const analysis = await runWorker(binPath, 'analyze', args.slice(1), security, undefined, true);
    if (analysis.status !== 0) return analysis.status;
    if (!Buffer.isBuffer(analysis.control)) {
      throw new TypeError('Kovo build analysis worker omitted its private handoff.');
    }
    const inspection = inspectKovoBuildOneShotHandoff(analysis.control);
    let wire = analysis.control;
    for (const phase of ['client', 'server'] as const) {
      const result = await runWorker(
        binPath,
        phase,
        [JSON.stringify(inspection.identity), ...args.slice(1)],
        security,
        wire,
        true,
      );
      if (result.status !== 0) return result.status;
      if (!Buffer.isBuffer(result.control)) {
        throw new TypeError(`Kovo build ${phase} worker omitted its private handoff.`);
      }
      const nextInspection = inspectKovoBuildOneShotHandoff(result.control);
      if (JSON.stringify(nextInspection.identity) !== JSON.stringify(inspection.identity)) {
        throw new TypeError(`Kovo build ${phase} worker changed the invocation identity.`);
      }
      wire = result.control;
    }
    return (
      await runWorker(
        binPath,
        'final',
        [JSON.stringify(inspection.identity), ...args.slice(1)],
        security,
        wire,
      )
    ).status;
  } catch (error) {
    process.stderr.write(
      `kovo build isolation failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

interface OneShotWorkerResult {
  readonly control?: Buffer | string | null;
  readonly status: number;
}

function runWorker(
  binPath: string,
  phase: 'analyze' | 'check' | 'check-final' | 'client' | 'final' | 'server',
  args: readonly string[],
  security: KovoCommandSecurityDisposition,
  input?: Buffer,
  captureControl = false,
): Promise<OneShotWorkerResult> {
  const sourceMode = binPath.endsWith('.ts');
  const worker = sourceMode
    ? resolve(dirname(binPath), `commands/build-one-shot-${phase}-worker.ts`)
    : resolveOneShotWorker(binPath, phase);
  return runBoundedOneShotWorkerProcess({
    args: [
      '--expose-gc',
      '--max-old-space-size=1600',
      '--max-semi-space-size=1',
      '--optimize-for-size',
      ...(sourceMode
        ? [
            '--disable-warning=ExperimentalWarning',
            '--experimental-transform-types',
            '--import',
            pathToFileURL(resolve(dirname(binPath), 'commands/build-static-trust-source-hook.mjs'))
              .href,
          ]
        : []),
      worker,
      ...args,
    ],
    captureControl,
    cwd: security.invocationCwd,
    env: security.invocationEnv,
    executable: process.execPath,
    ...(input === undefined ? {} : { input }),
    maxControlBytes: KOVO_BUILD_ONE_SHOT_MAX_WIRE_BYTES,
    phase,
    timeoutMs: kovoBuildOneShotWorkerTimeoutMs,
  });
}

interface OneShotWorkerProcessOptions {
  readonly args: readonly string[];
  readonly captureControl: boolean;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly executable: string;
  readonly input?: Buffer;
  readonly maxControlBytes: number;
  readonly phase: string;
  readonly timeoutMs: number;
}

function runBoundedOneShotWorkerProcess(
  options: OneShotWorkerProcessOptions,
): Promise<OneShotWorkerResult> {
  // Pin first, then authenticate the exact bytes that this sole framework-owned writer forwards.
  // Workers consume one authenticated frame and intentionally do not use EOF as a second framing
  // oracle; whole-stream trailing-byte rejection therefore belongs here, before every input spawn.
  if (
    options.input !== undefined &&
    options.input.byteLength > KOVO_BUILD_ONE_SHOT_MAX_WIRE_BYTES
  ) {
    throw new TypeError('Kovo build handoff exceeded its byte limit.');
  }
  const pinnedInput = options.input === undefined ? undefined : Buffer.from(options.input);
  if (pinnedInput !== undefined) inspectKovoBuildOneShotHandoff(pinnedInput);

  const child = spawn(options.executable, options.args, {
    cwd: options.cwd,
    detached: capturedProcessPlatform !== 'win32',
    env: options.env,
    stdio: [
      'inherit',
      'inherit',
      'inherit',
      pinnedInput === undefined ? 'ignore' : 'pipe',
      options.captureControl ? 'pipe' : 'ignore',
    ],
    windowsHide: true,
  });
  const removeParentCleanup = installOneShotWorkerParentCleanup(child);
  return new Promise<OneShotWorkerResult>((resolveResult, reject) => {
    let settled = false;
    let terminalError: Error | undefined;
    let total = 0;
    const chunks: Buffer[] = [];
    let inputCloseTimer: ReturnType<typeof setTimeout> | undefined;
    const failClosed = (error: Error): void => {
      if (settled || terminalError !== undefined) return;
      terminalError = error;
      // SIGKILL cannot run a worker's transaction catch block. An unpromoted
      // `.kovo-build-stage-*` may therefore remain as non-deploy residue, but the transactional
      // final output stays untouched. The thin parent does not wildcard-delete sibling stages:
      // without an authenticated owner path that could destroy a concurrent build's transaction.
      // Close the parent endpoints immediately as well: a malicious or defective descendant could
      // otherwise escape the worker process group while retaining fd4 and suppress `close` forever.
      child.stdio[3]?.destroy();
      child.stdio[4]?.destroy();
      terminateOneShotWorkerProcessTree(child);
    };
    child.on('error', failClosed);
    child.stdio[4]?.on('data', (chunk: Buffer) => {
      if (terminalError !== undefined) return;
      total += chunk.byteLength;
      if (total > options.maxControlBytes) {
        failClosed(new TypeError('Kovo build handoff exceeded its byte limit.'));
        return;
      }
      chunks[chunks.length] = chunk;
    });
    child.stdio[4]?.on('error', failClosed);
    child.stdio[3]?.on('error', failClosed);
    const deadline = capturedSetTimeout(() => {
      failClosed(
        new TypeError(
          `Kovo build ${options.phase} worker exceeded its ${String(options.timeoutMs)}ms deadline.`,
        ),
      );
    }, options.timeoutMs);
    child.on('close', (status) => {
      if (settled) return;
      settled = true;
      removeParentCleanup();
      capturedClearTimeout(deadline);
      if (inputCloseTimer !== undefined) capturedClearTimeout(inputCloseTimer);
      child.stdio[3]?.destroy();
      child.stdio[4]?.destroy();
      if (terminalError !== undefined) {
        reject(terminalError);
        return;
      }
      resolveResult({
        ...(options.captureControl ? { control: Buffer.concat(chunks, total) } : {}),
        status: status ?? 1,
      });
    });
    if (pinnedInput !== undefined) {
      const inputStream = child.stdio[3] as Writable | null;
      if (inputStream === null) {
        failClosed(new TypeError('Kovo build worker omitted its private input channel.'));
        return;
      }
      // `end()` is the ordinary cleanup path. Destroying after its write callback makes the fd
      // closure explicit; the bounded fallback prevents a rare delayed shutdown from hanging the
      // phase after every authenticated byte has already left the parent queue.
      inputCloseTimer = capturedSetTimeout(
        () => inputStream.destroy(),
        kovoBuildOneShotInputCloseTimeoutMs,
      );
      inputStream.end(pinnedInput, () => {
        if (inputCloseTimer !== undefined) capturedClearTimeout(inputCloseTimer);
        inputCloseTimer = undefined;
        inputStream.destroy();
      });
    }
  });
}

function installOneShotWorkerParentCleanup(child: ChildProcess): () => void {
  let removed = false;
  let terminated = false;
  const terminateSynchronously = (): void => {
    if (terminated) return;
    terminated = true;
    child.stdio[3]?.destroy();
    child.stdio[4]?.destroy();
    terminateOneShotWorkerProcessTreeSynchronously(child);
  };
  const onExit = (): void => terminateSynchronously();
  const signalHandlers = oneShotParentSignals.map((signal) => {
    const handler = (): void => {
      remove();
      terminateSynchronously();
      try {
        // Removing this scoped listener first restores Node's default signal disposition, so the
        // CLI preserves its original signal exit instead of swallowing Ctrl-C/SIGTERM.
        capturedProcessKill(process.pid, signal);
      } catch {
        process.exit(signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 129);
      }
    };
    return { handler, signal };
  });
  const remove = (): void => {
    if (removed) return;
    removed = true;
    process.removeListener('exit', onExit);
    for (const { handler, signal } of signalHandlers) process.removeListener(signal, handler);
  };
  process.once('exit', onExit);
  for (const { handler, signal } of signalHandlers) process.once(signal, handler);
  return remove;
}

function terminateOneShotWorkerProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (capturedProcessPlatform !== 'win32') {
    try {
      capturedProcessKill(-pid, 'SIGKILL');
      return;
    } catch {
      terminateOneShotWorkerProcess(pid);
      return;
    }
  }
  const taskkill = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  taskkill.once('error', () => terminateOneShotWorkerProcess(pid));
  taskkill.once('exit', (code) => {
    if (code !== 0) terminateOneShotWorkerProcess(pid);
  });
}

function terminateOneShotWorkerProcessTreeSynchronously(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (capturedProcessPlatform !== 'win32') {
    try {
      capturedProcessKill(-pid, 'SIGKILL');
      return;
    } catch {
      terminateOneShotWorkerProcess(pid);
      return;
    }
  }
  // Node does not run asynchronous callbacks during `exit`, and a signal handler immediately
  // restores the caller's signal disposition. Wait for Windows' process-tree primitive here so a
  // parent exit cannot strand descendants after an async taskkill launch.
  const result = spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
    stdio: 'ignore',
    timeout: 5_000,
    windowsHide: true,
  });
  if (result.error !== undefined || result.status !== 0) terminateOneShotWorkerProcess(pid);
}

function terminateOneShotWorkerProcess(pid: number): void {
  try {
    capturedProcessKill(pid, 'SIGKILL');
  } catch {
    // Process exit can race a deadline, stream failure, or taskkill fallback.
  }
}

/** @internal Deterministic one-shot deadline and transport seam for focused orchestration tests. */
export function boundedKovoBuildOneShotWorkerForTesting(
  executable: string,
  args: readonly string[],
  timeoutMs: number,
  input?: Buffer,
  maxControlBytes = KOVO_BUILD_ONE_SHOT_MAX_WIRE_BYTES,
): Promise<OneShotWorkerResult> {
  return runBoundedOneShotWorkerProcess({
    args,
    captureControl: true,
    cwd: process.cwd(),
    env: process.env,
    executable,
    ...(input === undefined ? {} : { input }),
    maxControlBytes,
    phase: 'test',
    timeoutMs,
  });
}

function resolveOneShotWorker(
  binPath: string,
  phase: 'analyze' | 'check' | 'check-final' | 'client' | 'final' | 'server',
): string {
  const packaged = resolve(dirname(binPath), `commands/build-one-shot-${phase}-worker.mjs`);
  if (existsSync(packaged)) return packaged;
  return resolve(dirname(binPath), `cli/src/commands/build-one-shot-${phase}-worker.mjs`);
}
