import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export const DEFAULT_TEST_PROCESS_MAX_OUTPUT_BYTES = 64 * 1024;
export const DEFAULT_TEST_PROCESS_TERMINATION_GRACE_MS = 2_000;
export const DEFAULT_TEST_PROCESS_KILL_GRACE_MS = 5_000;
export const DEFAULT_TEST_PROCESS_ROOT_EXIT_TIMEOUT_MS = 5_000;
export const DEFAULT_TEST_PROCESS_STREAM_CLOSE_TIMEOUT_MS = 5_000;

const DEFAULT_CENSUS_INTERVAL_MS = 100;
const DEFAULT_CENSUS_TIMEOUT_MS = 1_000;
const PROCESS_TABLE_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

/**
 * Run one test-owned command under a hard parent deadline. The supervisor continuously records the
 * recursive descendant closure because a child can create a detached process group that no longer
 * belongs to the root group by cleanup time.
 */
export async function runBoundedTestProcess(invocation) {
  const limits = validateInvocation(invocation);
  const started = process.hrtime.bigint();
  const output = combinedOutput(limits.maxOutputBytes);
  let resolveOverflow;
  const overflow = new Promise((resolve) => {
    resolveOverflow = resolve;
  });

  const child = spawn(invocation.command, [...invocation.args], {
    cwd: invocation.cwd,
    detached: process.platform !== 'win32',
    env: invocation.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => {
    if (output.push('stdout', chunk)) resolveOverflow('output-overflow');
  });
  child.stderr.on('data', (chunk) => {
    if (output.push('stderr', chunk)) resolveOverflow('output-overflow');
  });

  let exitSettled = false;
  const exited = new Promise((resolveExit) => {
    const settle = (result) => {
      if (exitSettled) return;
      exitSettled = true;
      resolveExit(result);
    };
    child.once('error', (error) => settle({ error: error.message, exitCode: null, signal: null }));
    child.once('exit', (exitCode, signal) => settle({ error: null, exitCode, signal }));
  });
  const closed = new Promise((resolveClose) => {
    child.once('close', () => resolveClose(true));
    child.once('error', () => resolveClose(true));
  });

  const knownDescendants = new Map();
  let stopCensus = false;
  let censusFailureMessage = null;
  let resolveCensusFailure;
  const censusFailure = new Promise((resolve) => {
    resolveCensusFailure = resolve;
  });
  const censusLoop = superviseDescendantCensus({
    censusIntervalMs: limits.censusIntervalMs,
    censusTimeoutMs: limits.censusTimeoutMs,
    knownDescendants,
    onFailure(message) {
      if (censusFailureMessage !== null) return;
      censusFailureMessage = message;
      resolveCensusFailure('census-failure');
    },
    rootPid: child.pid,
    shouldStop: () => stopCensus,
  });

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
      censusFailure.then((kind) => ({ kind })),
    ]);
  } finally {
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
  }

  const cleanupProblems = [];
  if (censusFailureMessage !== null) cleanupProblems.push(censusFailureMessage);
  if (child.pid !== undefined) {
    try {
      await terminateObservedProcessTree(child.pid, knownDescendants, limits);
    } catch (error) {
      cleanupProblems.push(errorMessage(error));
      try {
        fallbackForceKillObservedGroups(child.pid, knownDescendants, limits);
      } catch (fallbackError) {
        cleanupProblems.push(
          `forced observed-group fallback failed: ${errorMessage(fallbackError)}`,
        );
      }
    }
  }

  const firstExit = first.kind === 'exit' ? first.result : undefined;
  const exit = firstExit ?? (await promiseWithin(exited, limits.rootExitTimeoutMs));
  if (exit === undefined) {
    cleanupProblems.push(
      `root process did not exit within ${String(limits.rootExitTimeoutMs)}ms after tree cleanup`,
    );
  }
  if ((await promiseWithin(closed, limits.streamCloseTimeoutMs)) === undefined) {
    cleanupProblems.push(
      `root process streams did not close within ${String(limits.streamCloseTimeoutMs)}ms after tree cleanup`,
    );
  }

  stopCensus = true;
  await censusLoop;
  if (censusFailureMessage !== null && !cleanupProblems.includes(censusFailureMessage)) {
    cleanupProblems.push(censusFailureMessage);
  }
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
  return (
    (options.terminationGraceMs ?? DEFAULT_TEST_PROCESS_TERMINATION_GRACE_MS) +
    (options.killGraceMs ?? DEFAULT_TEST_PROCESS_KILL_GRACE_MS) +
    (options.rootExitTimeoutMs ?? DEFAULT_TEST_PROCESS_ROOT_EXIT_TIMEOUT_MS) +
    (options.streamCloseTimeoutMs ?? DEFAULT_TEST_PROCESS_STREAM_CLOSE_TIMEOUT_MS)
  );
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
  return limits;
}

async function superviseDescendantCensus({
  censusIntervalMs,
  censusTimeoutMs,
  knownDescendants,
  onFailure,
  rootPid,
  shouldStop,
}) {
  if (!Number.isSafeInteger(rootPid) || rootPid <= 0) return;
  while (!shouldStop()) {
    try {
      const table = snapshotProcessTable(censusTimeoutMs);
      mergeRecursiveDescendants(rootPid, knownDescendants, table);
    } catch (error) {
      onFailure(`recursive descendant census failed: ${errorMessage(error)}`);
      return;
    }
    await delay(censusIntervalMs);
  }
}

async function terminateObservedProcessTree(rootPid, knownDescendants, limits) {
  if (process.platform === 'win32') {
    const termStopped = await signalObservedWindowsTreeWithin(
      rootPid,
      knownDescendants,
      false,
      limits.terminationGraceMs,
      limits,
    );
    if (termStopped) return;
    const killStopped = await signalObservedWindowsTreeWithin(
      rootPid,
      knownDescendants,
      true,
      limits.killGraceMs,
      limits,
    );
    if (killStopped) return;
  } else {
    const termStopped = await signalObservedPosixTreeWithin(
      rootPid,
      knownDescendants,
      'SIGTERM',
      limits.terminationGraceMs,
      limits,
    );
    if (termStopped) return;
    const killStopped = await signalObservedPosixTreeWithin(
      rootPid,
      knownDescendants,
      'SIGKILL',
      limits.killGraceMs,
      limits,
    );
    if (killStopped) return;
  }

  const table = snapshotProcessTable(limits.censusTimeoutMs);
  mergeRecursiveDescendants(rootPid, knownDescendants, table);
  const survivors = observedSurvivors(rootPid, knownDescendants, table);
  throw new Error(
    `process-tree cleanup could not verify exit after SIGTERM and SIGKILL; survivors: ${formatSurvivors(survivors)}`,
  );
}

async function signalObservedPosixTreeWithin(rootPid, knownDescendants, signal, timeoutMs, limits) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const table = snapshotProcessTable(limits.censusTimeoutMs);
    mergeRecursiveDescendants(rootPid, knownDescendants, table);
    const survivors = observedSurvivors(rootPid, knownDescendants, table);
    if (survivors.length === 0) return true;
    signalPosixSurvivors(rootPid, survivors, signal);
    if (Date.now() >= deadline) return false;
    await delay(Math.min(limits.censusIntervalMs, Math.max(1, deadline - Date.now())));
  }
}

async function signalObservedWindowsTreeWithin(
  rootPid,
  knownDescendants,
  force,
  timeoutMs,
  limits,
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const table = snapshotProcessTable(limits.censusTimeoutMs);
    mergeRecursiveDescendants(rootPid, knownDescendants, table);
    const survivors = observedSurvivors(rootPid, knownDescendants, table);
    if (survivors.length === 0) return true;
    for (const pid of [rootPid, ...survivors.map((record) => record.pid)].toSorted(
      (left, right) => right - left,
    )) {
      const remainingMs = Math.max(1, deadline - Date.now());
      const args = ['/pid', String(pid), '/t'];
      if (force) args.push('/f');
      spawnSync('taskkill.exe', args, {
        stdio: 'ignore',
        timeout: Math.min(limits.censusTimeoutMs, remainingMs),
        windowsHide: true,
      });
    }
    if (Date.now() >= deadline) return false;
    await delay(Math.min(limits.censusIntervalMs, Math.max(1, deadline - Date.now())));
  }
}

function signalPosixSurvivors(rootPid, survivors, signal) {
  const processGroups = new Set(survivors.map((record) => record.pgid).filter((pgid) => pgid > 0));
  if (survivors.some((record) => record.pid === rootPid || record.pgid === rootPid)) {
    processGroups.add(rootPid);
  }
  for (const pgid of [...processGroups].toSorted((left, right) => {
    if (left === rootPid) return 1;
    if (right === rootPid) return -1;
    return right - left;
  })) {
    try {
      process.kill(-pgid, signal);
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ESRCH') throw error;
    }
  }
  for (const record of survivors) {
    try {
      process.kill(record.pid, signal);
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ESRCH') throw error;
    }
  }
}

function fallbackForceKillObservedGroups(rootPid, knownDescendants, limits) {
  if (process.platform === 'win32') {
    for (const pid of [rootPid, ...knownDescendants.keys()]) {
      spawnSync('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
        stdio: 'ignore',
        timeout: limits.killGraceMs,
        windowsHide: true,
      });
    }
    return;
  }
  const processGroups = new Set([rootPid]);
  for (const descendant of knownDescendants.values()) {
    if (descendant.pgid > 0) processGroups.add(descendant.pgid);
  }
  for (const pgid of processGroups) signalPosixProcessGroup(pgid, 'SIGKILL');
}

function snapshotProcessTable(timeoutMs) {
  if (process.platform === 'win32') return snapshotWindowsProcessTable(timeoutMs);
  const result = spawnSync('ps', ['-axo', 'pid=,ppid=,pgid=,stat=,lstart='], {
    encoding: 'utf8',
    maxBuffer: PROCESS_TABLE_MAX_OUTPUT_BYTES,
    timeout: timeoutMs,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`ps exited with ${String(result.status)}: ${result.stderr.trim()}`);
  }
  const table = new Map();
  for (const line of result.stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/u.exec(line);
    if (match === null) continue;
    const pid = Number(match[1]);
    table.set(pid, {
      pgid: Number(match[3]),
      pid,
      ppid: Number(match[2]),
      started: match[5],
      state: match[4],
    });
  }
  return table;
}

function snapshotWindowsProcessTable(timeoutMs) {
  const script = [
    'Get-CimInstance Win32_Process',
    '| Select-Object ProcessId,ParentProcessId,CreationDate',
    '| ConvertTo-Json -Compress',
  ].join(' ');
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      encoding: 'utf8',
      maxBuffer: PROCESS_TABLE_MAX_OUTPUT_BYTES,
      timeout: timeoutMs,
      windowsHide: true,
    },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`PowerShell process census exited with ${String(result.status)}`);
  }
  const source = result.stdout.trim();
  const records = source === '' ? [] : JSON.parse(source);
  const table = new Map();
  for (const value of Array.isArray(records) ? records : [records]) {
    const pid = Number(value.ProcessId);
    const ppid = Number(value.ParentProcessId);
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(ppid)) continue;
    table.set(pid, {
      pgid: pid,
      pid,
      ppid,
      started: String(value.CreationDate ?? ''),
      state: '',
    });
  }
  return table;
}

function mergeRecursiveDescendants(rootPid, knownDescendants, table) {
  const childrenByParent = new Map();
  for (const record of table.values()) {
    const children = childrenByParent.get(record.ppid) ?? [];
    children.push(record);
    childrenByParent.set(record.ppid, children);
  }
  const frontier = [rootPid];
  for (const [pid, identity] of knownDescendants) {
    const current = table.get(pid);
    if (current !== undefined && sameProcessIdentity(current, identity)) {
      knownDescendants.set(pid, current);
      frontier.push(pid);
    }
  }
  const visited = new Set(frontier);
  for (let index = 0; index < frontier.length; index += 1) {
    for (const child of childrenByParent.get(frontier[index]) ?? []) {
      if (visited.has(child.pid) || child.pid === process.pid) continue;
      visited.add(child.pid);
      frontier.push(child.pid);
      const previous = knownDescendants.get(child.pid);
      if (previous === undefined || sameProcessIdentity(child, previous)) {
        knownDescendants.set(child.pid, child);
      }
    }
  }
}

function observedSurvivors(rootPid, knownDescendants, table) {
  const records = [];
  const root = table.get(rootPid);
  if (root !== undefined && !isZombie(root)) records.push(root);
  for (const [pid, identity] of knownDescendants) {
    const current = table.get(pid);
    if (
      current !== undefined &&
      sameProcessIdentity(current, identity) &&
      !isZombie(current) &&
      !records.some((record) => record.pid === current.pid)
    ) {
      records.push(current);
    }
  }
  return records.toSorted((left, right) => left.pid - right.pid);
}

function sameProcessIdentity(current, observed) {
  return current.started === observed.started;
}

function isZombie(record) {
  return record.state.startsWith('Z');
}

function formatSurvivors(survivors) {
  if (survivors.length === 0) return 'unknown (census changed before verification)';
  return survivors
    .map(
      (record) => `${String(record.pid)}(ppid=${String(record.ppid)},pgid=${String(record.pgid)})`,
    )
    .join(', ');
}

function signalPosixProcessGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ESRCH') throw error;
  }
}

async function promiseWithin(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((resolveTimeout) => {
    timer = setTimeout(() => resolveTimeout(undefined), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
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
