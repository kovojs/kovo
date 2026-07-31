import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export const DEFAULT_TEST_PROCESS_MAX_OUTPUT_BYTES = 64 * 1024;
export const DEFAULT_TEST_PROCESS_TERMINATION_GRACE_MS = 2_000;
export const DEFAULT_TEST_PROCESS_KILL_GRACE_MS = 5_000;
export const DEFAULT_TEST_PROCESS_ROOT_EXIT_TIMEOUT_MS = 5_000;
export const DEFAULT_TEST_PROCESS_STREAM_CLOSE_TIMEOUT_MS = 5_000;

const DEFAULT_CENSUS_INTERVAL_MS = 100;
const DEFAULT_CENSUS_TIMEOUT_MS = 5_000;
const PROCESS_CENSUS_MAX_BYTES = 32 * 1024 * 1024;
const PROCESS_CENSUS_MAX_LINE_BYTES = 2 * 1024 * 1024;
const PROCESS_MARKER_PREFIX = 'KOVO_TEST_PROCESS_MARKER_';

/**
 * Run one test-owned command under a hard parent deadline. Each run adds a unique inherited
 * environment-variable name. Cleanup finds that marker globally instead of relying on ancestry,
 * which survives setsid/detach, intermediate-parent exit, and reparenting.
 */
export async function runBoundedTestProcess(invocation) {
  assertSupportedTestProcessPlatform();
  return runBoundedTestProcessWithDependencies(invocation, defaultSupervisorDependencies());
}

/** Test-only dependency seam for deterministic census/reuse/deadline regression coverage. */
export async function runBoundedTestProcessForTest(invocation, overrides = {}) {
  assertSupportedTestProcessPlatform();
  return runBoundedTestProcessWithDependencies(invocation, {
    ...defaultSupervisorDependencies(),
    ...overrides,
  });
}

export function assertSupportedTestProcessPlatform(platform = process.platform) {
  if (platform === 'linux' || platform === 'darwin') return;
  throw new Error(
    `bounded test process supervision supports only the repository's Linux and macOS test hosts; received ${platform}`,
  );
}

function markedChildEnvironment(requestedEnvironment, markerName) {
  const environment = { ...(requestedEnvironment ?? process.env) };
  for (const name of Object.keys(environment)) {
    if (name.startsWith(PROCESS_MARKER_PREFIX)) delete environment[name];
  }
  for (const [name, value] of Object.entries(process.env)) {
    if (name.startsWith(PROCESS_MARKER_PREFIX) && value === '1') environment[name] = value;
  }
  environment[markerName] = '1';
  return environment;
}

async function runBoundedTestProcessWithDependencies(invocation, dependencies) {
  const limits = validateInvocation(invocation);
  const started = process.hrtime.bigint();
  const markerName = `${PROCESS_MARKER_PREFIX}${randomBytes(24).toString('hex').toUpperCase()}`;
  const output = combinedOutput(limits.maxOutputBytes);
  let resolveOverflow;
  const overflow = new Promise((resolve) => {
    resolveOverflow = resolve;
  });

  const child = spawn(invocation.command, [...invocation.args], {
    cwd: invocation.cwd,
    detached: true,
    env: markedChildEnvironment(invocation.env, markerName),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const onStdout = (chunk) => {
    if (output.push('stdout', chunk)) resolveOverflow('output-overflow');
  };
  const onStderr = (chunk) => {
    if (output.push('stderr', chunk)) resolveOverflow('output-overflow');
  };
  child.stdout.on('data', onStdout);
  child.stderr.on('data', onStderr);

  let exitSettled = false;
  let settleExit;
  const exited = new Promise((resolveExit) => {
    settleExit = (result) => {
      if (exitSettled) return;
      exitSettled = true;
      resolveExit(result);
    };
  });
  const onChildError = (error) =>
    settleExit({ error: error.message, exitCode: null, signal: null });
  const onChildExit = (exitCode, signal) => settleExit({ error: null, exitCode, signal });
  child.once('error', onChildError);
  child.once('exit', onChildExit);
  let closeSettled = false;
  let settleClose;
  const closed = new Promise((resolveClose) => {
    settleClose = () => {
      if (closeSettled) return;
      closeSettled = true;
      resolveClose(true);
    };
  });
  const onChildClose = () => settleClose();
  const onChildErrorClose = () => settleClose();
  child.once('close', onChildClose);
  child.once('error', onChildErrorClose);

  let deadlineTimer;
  const deadline = new Promise((resolveDeadline) => {
    deadlineTimer = setTimeout(() => resolveDeadline('timeout'), invocation.supervisorTimeoutMs);
  });
  let first;
  try {
    first = await Promise.race([
      exited.then((result) => ({ kind: 'exit', result })),
      deadline.then((kind) => ({ kind })),
      overflow.then((kind) => ({ kind })),
    ]);
  } finally {
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
  }

  const cleanupProblems = [];
  const cleanupDeadlineAtMs = safeDeadline(
    dependencies.now(),
    boundedTestProcessCleanupBudgetMs(limits),
  );
  try {
    await terminateMarkedProcessTree(markerName, limits, cleanupDeadlineAtMs, dependencies);
  } catch (error) {
    cleanupProblems.push(errorMessage(error));
    disposeChildStreams(child, onStdout, onStderr);
  }

  const firstExit = first.kind === 'exit' ? first.result : undefined;
  const rootExitDeadlineAtMs = phaseDeadline(
    dependencies.now(),
    limits.rootExitTimeoutMs,
    cleanupDeadlineAtMs,
  );
  const exit =
    firstExit ??
    (await promiseBefore(exited, rootExitDeadlineAtMs, dependencies.now, dependencies.delay));
  if (exit === undefined) {
    cleanupProblems.push(
      `root process did not exit before the cleanup deadline (${String(limits.rootExitTimeoutMs)}ms root-exit allowance)`,
    );
    disposeChildStreams(child, onStdout, onStderr);
  }

  const streamCloseDeadlineAtMs = phaseDeadline(
    dependencies.now(),
    limits.streamCloseTimeoutMs,
    cleanupDeadlineAtMs,
  );
  if (
    !closeSettled &&
    (await promiseBefore(closed, streamCloseDeadlineAtMs, dependencies.now, dependencies.delay)) ===
      undefined
  ) {
    cleanupProblems.push(
      `root process streams did not close before the cleanup deadline (${String(limits.streamCloseTimeoutMs)}ms stream-close allowance)`,
    );
    disposeChildStreams(child, onStdout, onStderr);
  }

  child.stdout.off('data', onStdout);
  child.stderr.off('data', onStderr);
  child.off('error', onChildError);
  child.off('error', onChildErrorClose);
  child.off('exit', onChildExit);
  child.off('close', onChildClose);
  if (cleanupProblems.length > 0) disposeChildStreams(child, onStdout, onStderr);
  const captured = output.read();
  return {
    cleanupError: cleanupProblems.length === 0 ? null : cleanupProblems.join('; '),
    durationMs: Number(process.hrtime.bigint() - started) / 1e6,
    error: exit?.error ?? null,
    exitCode: exit?.exitCode ?? null,
    outputOverflowed: output.didOverflow(),
    signal: exit?.signal ?? null,
    stderr: captured.stderr,
    stdout: captured.stdout,
    timedOut: first.kind === 'timeout',
  };
}

export function boundedTestProcessCleanupBudgetMs(options = {}) {
  const values = [
    options.terminationGraceMs ?? DEFAULT_TEST_PROCESS_TERMINATION_GRACE_MS,
    options.killGraceMs ?? DEFAULT_TEST_PROCESS_KILL_GRACE_MS,
    options.rootExitTimeoutMs ?? DEFAULT_TEST_PROCESS_ROOT_EXIT_TIMEOUT_MS,
    options.streamCloseTimeoutMs ?? DEFAULT_TEST_PROCESS_STREAM_CLOSE_TIMEOUT_MS,
  ];
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new TypeError('bounded test process cleanup budget must be a positive safe integer');
  }
  return total;
}

function validateInvocation(invocation) {
  if (typeof invocation !== 'object' || invocation === null) {
    throw new TypeError('bounded test process invocation must be an object');
  }
  if (typeof invocation.command !== 'string' || invocation.command === '') {
    throw new TypeError('bounded test process command must be non-empty');
  }
  if (!Array.isArray(invocation.args) || invocation.args.some((arg) => typeof arg !== 'string')) {
    throw new TypeError('bounded test process args must contain only strings');
  }
  if (typeof invocation.cwd !== 'string' || invocation.cwd === '') {
    throw new TypeError('bounded test process cwd must be non-empty');
  }
  positiveInteger(invocation.supervisorTimeoutMs, 'bounded test process supervisor timeout');

  const limits = {
    censusIntervalMs: invocation.censusIntervalMs ?? DEFAULT_CENSUS_INTERVAL_MS,
    censusTimeoutMs: invocation.censusTimeoutMs ?? DEFAULT_CENSUS_TIMEOUT_MS,
    killGraceMs: invocation.killGraceMs ?? DEFAULT_TEST_PROCESS_KILL_GRACE_MS,
    maxOutputBytes: invocation.maxOutputBytes ?? DEFAULT_TEST_PROCESS_MAX_OUTPUT_BYTES,
    rootExitTimeoutMs: invocation.rootExitTimeoutMs ?? DEFAULT_TEST_PROCESS_ROOT_EXIT_TIMEOUT_MS,
    streamCloseTimeoutMs:
      invocation.streamCloseTimeoutMs ?? DEFAULT_TEST_PROCESS_STREAM_CLOSE_TIMEOUT_MS,
    terminationGraceMs: invocation.terminationGraceMs ?? DEFAULT_TEST_PROCESS_TERMINATION_GRACE_MS,
  };
  for (const [label, value] of Object.entries(limits)) {
    positiveInteger(value, `bounded test process ${label}`);
  }
  boundedTestProcessCleanupBudgetMs(limits);
  return limits;
}

async function terminateMarkedProcessTree(markerName, limits, cleanupDeadlineAtMs, dependencies) {
  const termDeadlineAtMs = phaseDeadline(
    dependencies.now(),
    limits.terminationGraceMs,
    cleanupDeadlineAtMs,
  );
  if (
    await signalMarkedProcessesWithin(
      markerName,
      'SIGTERM',
      termDeadlineAtMs,
      cleanupDeadlineAtMs,
      limits,
      dependencies,
    )
  ) {
    return;
  }

  const killDeadlineAtMs = phaseDeadline(
    dependencies.now(),
    limits.killGraceMs,
    cleanupDeadlineAtMs,
  );
  if (
    await signalMarkedProcessesWithin(
      markerName,
      'SIGKILL',
      killDeadlineAtMs,
      cleanupDeadlineAtMs,
      limits,
      dependencies,
    )
  ) {
    return;
  }

  const table = await censusBefore(
    markerName,
    cleanupDeadlineAtMs,
    limits.censusTimeoutMs,
    dependencies,
  );
  const survivors = markedSurvivors(table);
  throw new Error(
    `marked process-tree cleanup reached its absolute deadline; survivors: ${formatSurvivors(survivors)}`,
  );
}

async function signalMarkedProcessesWithin(
  markerName,
  signal,
  phaseDeadlineAtMs,
  cleanupDeadlineAtMs,
  limits,
  dependencies,
) {
  for (;;) {
    if (dependencies.now() >= cleanupDeadlineAtMs) return false;
    const table = await censusBefore(
      markerName,
      cleanupDeadlineAtMs,
      limits.censusTimeoutMs,
      dependencies,
    );
    const survivors = markedSurvivors(table);
    if (survivors.length === 0) return true;
    await signalIdentityCheckedSurvivors(
      markerName,
      survivors,
      signal,
      cleanupDeadlineAtMs,
      limits,
      dependencies,
    );
    if (dependencies.now() >= phaseDeadlineAtMs) return false;
    await delayBefore(
      Math.min(limits.censusIntervalMs, phaseDeadlineAtMs - dependencies.now()),
      phaseDeadlineAtMs,
      dependencies,
    );
  }
}

async function signalIdentityCheckedSurvivors(
  markerName,
  initialSurvivors,
  signal,
  deadlineAtMs,
  limits,
  dependencies,
) {
  for (const survivor of initialSurvivors) {
    const table = await censusBefore(
      markerName,
      deadlineAtMs,
      limits.censusTimeoutMs,
      dependencies,
    );
    const current = table.get(survivor.pid);
    if (current === undefined || !current.marked || isZombie(current)) continue;
    try {
      dependencies.signalProcess(current.pid, signal);
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ESRCH') throw error;
    }
  }
}

async function censusBefore(markerName, deadlineAtMs, censusTimeoutMs, dependencies) {
  const now = dependencies.now();
  if (now >= deadlineAtMs)
    throw new Error('process census could not start before cleanup deadline');
  return dependencies.snapshotProcessTable(
    markerName,
    Math.min(deadlineAtMs, safeDeadline(now, censusTimeoutMs)),
  );
}

function defaultSupervisorDependencies() {
  return {
    delay,
    now: Date.now,
    signalProcess(pid, signal) {
      process.kill(pid, signal);
    },
    snapshotProcessTable,
  };
}

async function snapshotProcessTable(markerName, deadlineAtMs) {
  const remainingMs = deadlineAtMs - Date.now();
  if (remainingMs <= 0) throw new Error('process census deadline exhausted');

  return new Promise((resolve, reject) => {
    const table = new Map();
    const census = spawn('ps', ['eww', '-axo', 'pid=,ppid=,pgid=,stat=,command='], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    census.stdout.setEncoding('utf8');
    let settled = false;
    let totalBytes = 0;
    let remainder = '';

    const dispose = () => {
      clearTimeout(timer);
      remainder = '';
      census.stdout.removeAllListeners();
      census.stderr.removeAllListeners();
      census.removeAllListeners();
      census.on('error', ignoreDisposedCensusError);
      census.stdout.on('error', ignoreDisposedCensusError);
      census.stderr.on('error', ignoreDisposedCensusError);
      census.stdout.destroy();
      census.stderr.destroy();
      census.unref();
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      try {
        census.kill('SIGKILL');
      } catch {
        // The census may have exited between failure detection and the kill attempt.
      }
      dispose();
      reject(error);
    };
    const timer = setTimeout(
      () => fail(new Error('process census exceeded its absolute deadline')),
      remainingMs,
    );

    census.once('error', (error) =>
      fail(new Error(`process census could not start: ${error.message}`)),
    );
    census.stdout.on('data', (chunk) => {
      totalBytes += Buffer.byteLength(chunk);
      if (totalBytes > PROCESS_CENSUS_MAX_BYTES) {
        fail(new Error('process census exceeded its bounded read allowance'));
        return;
      }
      remainder += chunk;
      if (
        Buffer.byteLength(remainder) > PROCESS_CENSUS_MAX_LINE_BYTES &&
        !remainder.includes('\n')
      ) {
        fail(new Error('process census encountered an overlong process record'));
        return;
      }
      for (;;) {
        const newline = remainder.indexOf('\n');
        if (newline < 0) break;
        const line = remainder.slice(0, newline);
        remainder = remainder.slice(newline + 1);
        if (Buffer.byteLength(line) > PROCESS_CENSUS_MAX_LINE_BYTES) {
          fail(new Error('process census encountered an overlong process record'));
          return;
        }
        const record = parseProcessCensusLine(line, markerName);
        if (record !== undefined) table.set(record.pid, record);
      }
      if (Buffer.byteLength(remainder) > PROCESS_CENSUS_MAX_LINE_BYTES) {
        fail(new Error('process census encountered an overlong process record'));
      }
    });
    census.stdout.on('error', (error) =>
      fail(new Error(`process census stdout failed: ${error.message}`)),
    );
    census.stderr.on('data', (chunk) => {
      totalBytes += Buffer.byteLength(chunk);
      if (totalBytes > PROCESS_CENSUS_MAX_BYTES) {
        fail(new Error('process census exceeded its bounded read allowance'));
      }
    });
    census.stderr.on('error', (error) =>
      fail(new Error(`process census stderr failed: ${error.message}`)),
    );
    census.once('close', (code, signal) => {
      if (settled) return;
      if (remainder !== '') {
        const record = parseProcessCensusLine(remainder, markerName);
        if (record !== undefined) table.set(record.pid, record);
      }
      if (code !== 0) {
        fail(new Error(`process census exited unsuccessfully (${signal ?? code ?? 'unknown'})`));
        return;
      }
      settled = true;
      dispose();
      resolve(table);
    });
  });
}

function parseProcessCensusLine(line, markerName) {
  const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/u.exec(line);
  if (match === null) return undefined;
  const pid = Number(match[1]);
  const ppid = Number(match[2]);
  const pgid = Number(match[3]);
  if (![pid, ppid, pgid].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    return undefined;
  }
  return {
    marked: containsEnvironmentEntry(match[5], markerName, '1'),
    pgid,
    pid,
    ppid,
    state: match[4],
  };
}

function containsEnvironmentEntry(commandAndEnvironment, name, value) {
  const entry = `${name}=${value}`;
  let offset = 0;
  for (;;) {
    const index = commandAndEnvironment.indexOf(entry, offset);
    if (index < 0) return false;
    const before = index === 0 ? ' ' : commandAndEnvironment[index - 1];
    const afterIndex = index + entry.length;
    const after =
      afterIndex === commandAndEnvironment.length ? ' ' : commandAndEnvironment[afterIndex];
    if (/\s/u.test(before) && /\s/u.test(after)) return true;
    offset = index + entry.length;
  }
}

function markedSurvivors(table) {
  return [...table.values()]
    .filter((record) => record.marked && !isZombie(record))
    .toSorted((left, right) => left.pid - right.pid);
}

function isZombie(record) {
  return record.state.startsWith('Z');
}

function formatSurvivors(survivors) {
  if (survivors.length === 0) return 'none observed at final census';
  return survivors
    .map(
      (record) => `${String(record.pid)}(ppid=${String(record.ppid)},pgid=${String(record.pgid)})`,
    )
    .join(', ');
}

async function delayBefore(durationMs, deadlineAtMs, dependencies) {
  const remainingMs = deadlineAtMs - dependencies.now();
  if (remainingMs <= 0) return;
  await dependencies.delay(Math.min(Math.max(1, durationMs), remainingMs));
}

async function promiseBefore(promise, deadlineAtMs, now, delayFunction) {
  const remainingMs = deadlineAtMs - now();
  if (remainingMs <= 0) return undefined;
  return Promise.race([promise, delayFunction(remainingMs).then(() => undefined)]);
}

function phaseDeadline(now, allowanceMs, cleanupDeadlineAtMs) {
  return Math.min(cleanupDeadlineAtMs, safeDeadline(now, allowanceMs));
}

function safeDeadline(now, allowanceMs) {
  const deadline = now + allowanceMs;
  if (!Number.isSafeInteger(deadline))
    throw new TypeError('process deadline must be a safe integer');
  return deadline;
}

function disposeChildStreams(child, onStdout, onStderr) {
  child.stdout.off('data', onStdout);
  child.stderr.off('data', onStderr);
  child.stdout.destroy();
  child.stderr.destroy();
  child.unref();
}

function combinedOutput(limit) {
  const chunks = { stderr: [], stdout: [] };
  let capturedBytes = 0;
  let overflowed = false;
  return {
    didOverflow() {
      return overflowed;
    },
    push(channel, value) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      const remaining = Math.max(0, limit - capturedBytes);
      if (remaining > 0) {
        const captured = chunk.byteLength <= remaining ? chunk : chunk.subarray(0, remaining);
        chunks[channel].push(Buffer.from(captured));
        capturedBytes += captured.byteLength;
      }
      if (chunk.byteLength <= remaining || overflowed) return false;
      overflowed = true;
      return true;
    },
    read() {
      return {
        stderr: Buffer.concat(chunks.stderr).toString('utf8'),
        stdout: Buffer.concat(chunks.stdout).toString('utf8'),
      };
    },
  };
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function ignoreDisposedCensusError() {
  // The census is killed and unreferenced before disposal. Ignore only late subprocess errors after
  // the owning promise has already settled and every parser/output listener has been detached.
}
