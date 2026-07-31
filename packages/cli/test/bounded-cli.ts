import { fileURLToPath } from 'node:url';

import { runBoundedTestProcess } from '../../create-kovo/src/index.test-process-supervisor.mjs';

// Saturated hosted shards have crossed the former 90s build ceiling. Keep the child finite while
// giving measured CI contention 2x headroom; every outer Vitest timeout adds bounded reap time.
export const KOVO_BUILD_TEST_PROCESS_DEADLINE_MS = 180_000;
export const KOVO_EXPLAIN_TEST_PROCESS_DEADLINE_MS = 30_000;
export const KOVO_TEST_PROCESS_CLEANUP_HEADROOM_MS = 10_000;

const DEFAULT_MAX_CAPTURED_OUTPUT_BYTES = 16 * 1024 * 1024;
const TEST_PROCESS_TERMINATION_GRACE_MS = 1_000;
const TEST_PROCESS_KILL_GRACE_MS = 3_000;
const TEST_PROCESS_ROOT_EXIT_TIMEOUT_MS = 2_000;
const TEST_PROCESS_STREAM_CLOSE_TIMEOUT_MS = 2_000;
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

async function runBoundedProcess(options: BoundedProcessOptions): Promise<BoundedProcessResult> {
  assertPositiveInteger(options.deadlineMs, 'deadlineMs');
  const maxCapturedOutputBytes =
    options.maxCapturedOutputBytes ?? DEFAULT_MAX_CAPTURED_OUTPUT_BYTES;
  assertPositiveInteger(maxCapturedOutputBytes, 'maxCapturedOutputBytes');

  const outcome = await runBoundedTestProcess({
    args: options.args,
    command: options.executable,
    cwd: options.cwd,
    ...(options.env === undefined ? {} : { env: options.env }),
    killGraceMs: TEST_PROCESS_KILL_GRACE_MS,
    maxOutputBytes: maxCapturedOutputBytes,
    rootExitTimeoutMs: TEST_PROCESS_ROOT_EXIT_TIMEOUT_MS,
    streamCloseTimeoutMs: TEST_PROCESS_STREAM_CLOSE_TIMEOUT_MS,
    supervisorTimeoutMs: options.deadlineMs,
    terminationGraceMs: TEST_PROCESS_TERMINATION_GRACE_MS,
  });
  const result = {
    exitCode: outcome.exitCode ?? 1,
    stderr: outcome.stderr,
    stdout: outcome.stdout,
  };
  if (outcome.timedOut) {
    throw withCapturedOutput(
      new TypeError(
        `${options.label} exceeded its ${String(options.deadlineMs)}ms deadline and was terminated.`,
      ),
      result,
    );
  }
  if (outcome.outputOverflowed) {
    throw withCapturedOutput(
      new TypeError(
        `${options.label} exceeded its ${String(maxCapturedOutputBytes)}-byte output capture limit.`,
      ),
      result,
    );
  }
  if (outcome.cleanupError !== null) {
    throw withCapturedOutput(
      new TypeError(`${options.label} process-tree cleanup failed: ${outcome.cleanupError}`),
      result,
    );
  }
  if (outcome.error !== null) {
    throw withCapturedOutput(
      new TypeError(`${options.label} failed to start: ${outcome.error}`),
      result,
    );
  }
  if (outcome.signal !== null) {
    throw withCapturedOutput(
      new TypeError(`${options.label} exited via signal ${outcome.signal}.`),
      result,
    );
  }
  return result;
}

function withCapturedOutput(error: Error, result: BoundedProcessResult): Error {
  const output = [
    result.stderr === '' ? undefined : `stderr:\n${result.stderr}`,
    result.stdout === '' ? undefined : `stdout:\n${result.stdout}`,
  ].filter((entry): entry is string => entry !== undefined);
  if (output.length === 0) return error;
  return new TypeError(`${error.message}\n${output.join('\n')}`, { cause: error });
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
}
