import { Buffer } from 'node:buffer';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Saturated hosted shards have crossed the former 90s build ceiling. Keep the child finite while
// giving measured CI contention 2x headroom; every outer Vitest timeout adds bounded reap time.
export const KOVO_BUILD_TEST_PROCESS_DEADLINE_MS = 180_000;
export const KOVO_EXPLAIN_TEST_PROCESS_DEADLINE_MS = 30_000;
export const KOVO_TEST_PROCESS_CLEANUP_HEADROOM_MS = 10_000;

const DEFAULT_MAX_CAPTURED_OUTPUT_BYTES = 16 * 1024 * 1024;
const sourceCliPath = fileURLToPath(new URL('../src/bin.ts', import.meta.url));

export interface BoundedProcessResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

export interface BoundedKovoCliOptions {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly deadlineMs: number;
  readonly env?: NodeJS.ProcessEnv;
  readonly maxCapturedOutputBytes?: number;
}

interface BoundedProcessOptions extends BoundedKovoCliOptions {
  readonly executable: string;
  readonly label: string;
}

interface CapturedOutput {
  bytes: number;
  readonly chunks: Buffer[];
}

export function kovoCliTestTimeoutMs(...childDeadlinesMs: readonly number[]): number {
  return (
    childDeadlinesMs.reduce((total, deadlineMs) => total + deadlineMs, 0) +
    KOVO_TEST_PROCESS_CLEANUP_HEADROOM_MS
  );
}

export function runBoundedKovoCli(options: BoundedKovoCliOptions): Promise<BoundedProcessResult> {
  return runBoundedProcess({
    ...options,
    args: [
      '--disable-warning=ExperimentalWarning',
      '--experimental-transform-types',
      sourceCliPath,
      ...options.args,
    ],
    env: { ...process.env, KOVO_CLI_TRANSFORM_TYPES: '1', ...options.env },
    executable: process.execPath,
    label: 'Kovo CLI',
  });
}

/** @internal Generic seam for proving the bounded CLI test runner without running a Kovo build. */
export function runBoundedProcessForTesting(
  options: Omit<BoundedProcessOptions, 'label'> & { readonly label?: string },
): Promise<BoundedProcessResult> {
  return runBoundedProcess({ ...options, label: options.label ?? 'Child process' });
}

function runBoundedProcess(options: BoundedProcessOptions): Promise<BoundedProcessResult> {
  assertPositiveInteger(options.deadlineMs, 'deadlineMs');
  const maxCapturedOutputBytes =
    options.maxCapturedOutputBytes ?? DEFAULT_MAX_CAPTURED_OUTPUT_BYTES;
  assertPositiveInteger(maxCapturedOutputBytes, 'maxCapturedOutputBytes');

  const child = spawn(options.executable, [...options.args], {
    cwd: options.cwd,
    detached: process.platform !== 'win32',
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const stderr: CapturedOutput = { bytes: 0, chunks: [] };
  const stdout: CapturedOutput = { bytes: 0, chunks: [] };

  return new Promise<BoundedProcessResult>((resolve, reject) => {
    let capturedBytes = 0;
    let settled = false;
    let terminalError: Error | undefined;

    const failClosed = (error: Error): void => {
      if (settled || terminalError !== undefined) return;
      terminalError = error;
      // A detached descendant can retain a pipe after its parent exits. Close this process's
      // endpoints before terminating the tree so failure settlement cannot depend on inherited fds.
      child.stdout.destroy();
      child.stderr.destroy();
      terminateProcessTree(child);
    };
    const capture = (output: CapturedOutput, chunk: Buffer): void => {
      if (terminalError !== undefined) return;
      const remaining = maxCapturedOutputBytes - capturedBytes;
      if (remaining > 0) {
        const capturedChunk = chunk.byteLength <= remaining ? chunk : chunk.subarray(0, remaining);
        output.chunks.push(capturedChunk);
        output.bytes += capturedChunk.byteLength;
        capturedBytes += capturedChunk.byteLength;
      }
      if (chunk.byteLength > remaining) {
        failClosed(
          new TypeError(
            `${options.label} exceeded its ${String(maxCapturedOutputBytes)}-byte output capture limit.`,
          ),
        );
      }
    };

    child.stdout.on('data', (chunk: Buffer) => capture(stdout, chunk));
    child.stdout.on('error', (error) => failClosed(error));
    child.stderr.on('data', (chunk: Buffer) => capture(stderr, chunk));
    child.stderr.on('error', (error) => failClosed(error));
    child.on('error', (error) => {
      failClosed(
        new TypeError(`${options.label} failed to start: ${error.message}`, { cause: error }),
      );
    });
    const deadline = setTimeout(() => {
      failClosed(
        new TypeError(
          `${options.label} exceeded its ${String(options.deadlineMs)}ms deadline and was terminated.`,
        ),
      );
    }, options.deadlineMs);
    child.on('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      const result = {
        exitCode: exitCode ?? 1,
        stderr: Buffer.concat(stderr.chunks, stderr.bytes).toString('utf8'),
        stdout: Buffer.concat(stdout.chunks, stdout.bytes).toString('utf8'),
      };
      if (terminalError !== undefined) {
        reject(withCapturedOutput(terminalError, result));
        return;
      }
      if (exitCode === null) {
        reject(
          withCapturedOutput(
            new TypeError(`${options.label} exited via signal ${String(signal)}.`),
            result,
          ),
        );
        return;
      }
      resolve(result);
    });
  });
}

function withCapturedOutput(error: Error, result: BoundedProcessResult): Error {
  const output = [
    result.stderr === '' ? undefined : `stderr:\n${result.stderr}`,
    result.stdout === '' ? undefined : `stdout:\n${result.stdout}`,
  ].filter((entry): entry is string => entry !== undefined);
  if (output.length === 0) return error;
  return new TypeError(`${error.message}\n${output.join('\n')}`, { cause: error });
}

function terminateProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;

  if (process.platform === 'win32') {
    const taskkill = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    taskkill.once('error', () => terminateProcess(pid));
    taskkill.once('exit', (exitCode) => {
      if (exitCode !== 0) terminateProcess(pid);
    });
    return;
  }

  // The source CLI owns detached one-shot workers. Snapshot and terminate descendants as well as
  // the root group so a timed-out test cannot strand a worker in a separate POSIX process group.
  for (const descendantPid of descendantProcessIds(pid).reverse()) {
    terminateProcessGroupOrProcess(descendantPid);
  }
  terminateProcessGroupOrProcess(pid);
}

function descendantProcessIds(rootPid: number): number[] {
  const processes = spawnSync('ps', ['-A', '-o', 'pid=', '-o', 'ppid='], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 2_000,
    windowsHide: true,
  });
  if (processes.error !== undefined || processes.status !== 0) return [];

  const children = new Map<number, number[]>();
  for (const line of processes.stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/u.exec(line);
    if (match === null) continue;
    const pid = Number(match[1]);
    const parentPid = Number(match[2]);
    const siblings = children.get(parentPid) ?? [];
    siblings.push(pid);
    children.set(parentPid, siblings);
  }

  const descendants: number[] = [];
  const pending = [...(children.get(rootPid) ?? [])];
  for (let index = 0; index < pending.length; index += 1) {
    const pid = pending[index];
    if (pid === undefined) continue;
    descendants.push(pid);
    pending.push(...(children.get(pid) ?? []));
  }
  return descendants;
}

function terminateProcessGroupOrProcess(pid: number): void {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    terminateProcess(pid);
  }
}

function terminateProcess(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // Process exit can race output overflow, a deadline, or taskkill fallback.
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
}
