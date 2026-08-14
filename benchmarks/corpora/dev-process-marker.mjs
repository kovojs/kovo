import { execFile } from 'node:child_process';

export const DEV_PROCESS_MARKER_PREFIX = 'KOVO_PERF_DEV_SESSION_';

const PROCESS_CENSUS_MAX_BYTES = 32 * 1024 * 1024;
const PROCESS_CENSUS_TIMEOUT_MS = 2_000;
const PROCESS_CENSUS_FIELDS = 'pid=,ppid=,pgid=,stat=,command=';
let markerSequence = 0n;

/**
 * Mint a non-secret environment-variable name inherited by the complete dev process tree.
 * Unlike PID ancestry or a process group, the marker survives setsid(), detach, and reparenting.
 */
export function createDevProcessMarker(environment = process.env) {
  for (;;) {
    markerSequence += 1n;
    const marker = `${DEV_PROCESS_MARKER_PREFIX}${process.pid.toString(36).toUpperCase()}_${process.hrtime
      .bigint()
      .toString(36)
      .toUpperCase()}_${markerSequence.toString(36).toUpperCase()}`;
    if (environment[marker] === undefined) return marker;
  }
}

/** Add the owned marker without accepting a caller-provided value or mutating the input bag. */
export function markedDevProcessEnvironment(environment, marker) {
  assertDevProcessMarker(marker);
  return { ...environment, [marker]: '1' };
}

/**
 * Observe every live process carrying the exact inherited marker. `ps eww` is deliberately global:
 * a detached or reparented descendant is no longer discoverable from the launcher's PID/PGID.
 */
export async function snapshotMarkedDevProcesses(marker, dependencies = {}) {
  assertDevProcessMarker(marker);
  const snapshot = dependencies.snapshotProcessTable ?? processCensusSnapshot;
  return parseMarkedDevProcessCensus(await snapshot(), marker);
}

/**
 * Signal only identities that still carry the marker in a fresh census. The second census narrows
 * the PID-reuse race between observation and signaling; the inherited marker is the ownership
 * boundary, while the final census-to-kill interval remains an unavoidable operating-system race.
 */
export async function signalMarkedDevProcesses(marker, signal, dependencies = {}) {
  assertDevProcessMarker(marker);
  assertCleanupSignal(signal);
  const snapshot =
    dependencies.snapshotMarkedProcesses ?? ((value) => snapshotMarkedDevProcesses(value));
  const signalProcess = dependencies.signalProcess ?? ((pid, value) => process.kill(pid, value));
  const observed = await snapshot(marker);
  const signaled = [];
  for (const candidate of observed) {
    const current = (await snapshot(marker)).find((record) => record.pid === candidate.pid);
    if (current === undefined) continue;
    try {
      signalProcess(current.pid, signal);
      signaled.push(current.pid);
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
  return { observed, signaled };
}

/** Parse one bounded GNU procps/BSD `ps` census without retaining command/environment bytes. */
export function parseMarkedDevProcessCensus(output, marker) {
  assertDevProcessMarker(marker);
  const records = [];
  for (const line of String(output).split(/\r?\n/u)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/u.exec(line);
    if (match === null || !containsEnvironmentEntry(match[5], marker, '1')) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const pgid = Number(match[3]);
    if (
      !Number.isSafeInteger(pid) ||
      pid <= 0 ||
      ![ppid, pgid].every((value) => Number.isSafeInteger(value) && value >= 0) ||
      match[4].startsWith('Z')
    ) {
      continue;
    }
    records.push({ pgid, pid, ppid, state: match[4] });
  }
  return records.toSorted((left, right) => left.pid - right.pid);
}

export function devProcessCensusArguments(platform = process.platform) {
  if (platform !== 'linux' && platform !== 'darwin') {
    throw new Error(
      `dev process marker census supports only Linux and macOS performance hosts; received ${platform}`,
    );
  }
  return ['eww', '-A', '-o', PROCESS_CENSUS_FIELDS];
}

function processCensusSnapshot() {
  return new Promise((resolve, reject) => {
    execFile(
      'ps',
      devProcessCensusArguments(),
      {
        encoding: 'utf8',
        maxBuffer: PROCESS_CENSUS_MAX_BYTES,
        timeout: PROCESS_CENSUS_TIMEOUT_MS,
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
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

function assertDevProcessMarker(marker) {
  if (
    typeof marker !== 'string' ||
    !new RegExp(`^${DEV_PROCESS_MARKER_PREFIX}[A-Z0-9_]+$`, 'u').test(marker)
  ) {
    throw new TypeError('dev process marker must be a framework-minted environment-variable name');
  }
}

function assertCleanupSignal(signal) {
  if (signal !== 'SIGTERM' && signal !== 'SIGKILL') {
    throw new TypeError('dev process marker cleanup signal must be SIGTERM or SIGKILL');
  }
}
