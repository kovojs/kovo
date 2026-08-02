import { KNOWN_FAILURE_COMMAND_CLEANUP_PHASE_TIMEOUT_MS } from './known-failure-probe-deadlines.mjs';

const COMMAND_OUTPUT_LIMIT_BYTES = 32 * 1024 * 1024;
const DIAGNOSTIC_LIMIT_BYTES = 32 * 1024;

/**
 * Run one packed known-failure command under a phase-owned deadline and marker-based process-tree
 * cleanup. The marker census is required because a timed-out CLI can outlive its immediate parent
 * through a detached compiler/runtime child; a direct `spawnSync` timeout cannot prove cleanup.
 */
export async function runKnownFailureProbeCommand(invocation, dependencies = {}) {
  validateInvocation(invocation);
  // Repository-only proof seam: this supervisor is test infrastructure, never packed/public API.
  const runProcess =
    dependencies.runProcess ??
    (await import('../../packages/create-kovo/src/index.test-process-supervisor.mjs'))
      .runBoundedTestProcess;
  const result = await runProcess({
    args: invocation.args,
    captureOutput: true,
    censusTimeoutMs: KNOWN_FAILURE_COMMAND_CLEANUP_PHASE_TIMEOUT_MS,
    command: invocation.command,
    cwd: invocation.cwd,
    env: invocation.env,
    forwardOutput: false,
    killGraceMs: KNOWN_FAILURE_COMMAND_CLEANUP_PHASE_TIMEOUT_MS,
    maxOutputBytes: COMMAND_OUTPUT_LIMIT_BYTES,
    rootExitTimeoutMs: KNOWN_FAILURE_COMMAND_CLEANUP_PHASE_TIMEOUT_MS,
    streamCloseTimeoutMs: KNOWN_FAILURE_COMMAND_CLEANUP_PHASE_TIMEOUT_MS,
    supervisorTimeoutMs: invocation.timeoutMs,
    terminationGraceMs: KNOWN_FAILURE_COMMAND_CLEANUP_PHASE_TIMEOUT_MS,
  });

  const failures = [];
  if (result.timedOut) failures.push(`exceeded its ${String(invocation.timeoutMs)}ms deadline`);
  if (result.outputOverflowed) failures.push('exceeded its 32 MiB combined-output ceiling');
  if (result.cleanupError) {
    failures.push(`could not prove process-tree cleanup: ${String(result.cleanupError)}`);
  }
  if (result.error) failures.push(`failed to execute: ${String(result.error)}`);
  if (result.signal) failures.push(`ended with signal ${String(result.signal)}`);
  if (result.exitCode === null || !Number.isInteger(result.exitCode)) {
    failures.push('did not return an integer exit status');
  }
  if (failures.length > 0) {
    throw new Error(
      `${invocation.label} ${failures.join('; ')} (elapsed=${formatDuration(result.durationMs)})` +
        formatOutput(result.stdout, result.stderr),
    );
  }

  return {
    durationMs: result.durationMs,
    error: null,
    signal: null,
    status: result.exitCode,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  };
}

function validateInvocation(invocation) {
  if (typeof invocation !== 'object' || invocation === null) {
    throw new TypeError('known-failure command invocation must be an object');
  }
  for (const field of ['command', 'cwd', 'label']) {
    if (typeof invocation[field] !== 'string' || invocation[field] === '') {
      throw new TypeError(`known-failure command ${field} must be non-empty`);
    }
  }
  if (!Array.isArray(invocation.args) || invocation.args.some((arg) => typeof arg !== 'string')) {
    throw new TypeError('known-failure command args must contain only strings');
  }
  if (!Number.isSafeInteger(invocation.timeoutMs) || invocation.timeoutMs <= 0) {
    throw new TypeError('known-failure command timeoutMs must be a positive safe integer');
  }
}

function formatDuration(value) {
  return Number.isFinite(value) && value >= 0 ? `${Math.ceil(value)}ms` : 'unavailable';
}

function formatOutput(stdout, stderr) {
  const rendered = `\n--- stdout ---\n${stdout ?? ''}\n--- stderr ---\n${stderr ?? ''}`;
  const bytes = Buffer.from(rendered);
  if (bytes.byteLength <= DIAGNOSTIC_LIMIT_BYTES) return rendered;
  const marker = Buffer.from('\n... packed command output truncated ...\n');
  const retainedBytes = DIAGNOSTIC_LIMIT_BYTES - marker.byteLength;
  const headBytes = Math.floor(retainedBytes / 2);
  const tailBytes = retainedBytes - headBytes;
  return Buffer.concat([
    bytes.subarray(0, headBytes),
    marker,
    bytes.subarray(bytes.byteLength - tailBytes),
  ]).toString('utf8');
}
