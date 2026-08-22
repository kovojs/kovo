import { execFile } from 'node:child_process';

const MAX_PS_BYTES = 16 * 1024 * 1024;

/** Parse portable `ps time=` forms: [[days-]hours:]minutes:seconds[.fraction]. */
export function parseProcessCpuSeconds(value) {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/u.exec(String(value).trim());
  if (!match) return null;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3]);
  const seconds = Number(match[4]);
  if (![days, hours, minutes, seconds].every(Number.isFinite) || minutes > 59 || seconds >= 60) {
    return null;
  }
  return days * 86_400 + hours * 3_600 + minutes * 60 + seconds;
}

/**
 * Sum RSS and accumulated CPU time for one live root plus all descendants in a `ps` snapshot.
 * Malformed rows are rejected from evidence instead of being guessed into the measured tree.
 */
export function processTreeMetrics(psOutput, rootPid) {
  if (!Number.isSafeInteger(rootPid) || rootPid <= 0) {
    throw new TypeError('rootPid must be a positive safe integer');
  }
  const rows = [];
  for (const line of String(psOutput).split(/\r?\n/u)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s*$/u.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const parentPid = Number(match[2]);
    const rssKiB = Number(match[3]);
    const cpuSeconds = parseProcessCpuSeconds(match[4]);
    if (
      !Number.isSafeInteger(pid) ||
      !Number.isSafeInteger(parentPid) ||
      !Number.isSafeInteger(rssKiB) ||
      cpuSeconds === null
    ) {
      continue;
    }
    rows.push({ cpuSeconds, parentPid, pid, rssKiB });
  }
  const members = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (!members.has(row.pid) && members.has(row.parentPid)) {
        members.add(row.pid);
        changed = true;
      }
    }
  }
  const tree = rows.filter((row) => members.has(row.pid));
  return {
    cpuSeconds: tree.reduce((total, row) => total + row.cpuSeconds, 0),
    processCount: tree.length,
    rssBytes: tree.reduce((total, row) => total + row.rssKiB, 0) * 1024,
  };
}

export function processTreeSnapshot(rootPid, exec = execFile) {
  return new Promise((resolve, reject) => {
    exec(
      'ps',
      ['-axo', 'pid=,ppid=,rss=,time='],
      { encoding: 'utf8', maxBuffer: MAX_PS_BYTES },
      (error, stdout) => (error ? reject(error) : resolve(processTreeMetrics(stdout, rootPid))),
    );
  });
}

/**
 * Measure server-only accumulated CPU and peak process-tree RSS around an async load window.
 * The generator is a sibling process, never a descendant, so it cannot inflate these numbers.
 */
export async function measureProcessTreeWindow(rootPid, task, options = {}) {
  const snapshot = options.snapshot ?? ((pid) => processTreeSnapshot(pid));
  const intervalMs = boundedInteger(options.intervalMs ?? 100, 25, 1_000, 'intervalMs');
  const before = await snapshot(rootPid);
  let peakRssBytes = before.rssBytes;
  let rssSamples = 1;
  let samplingError = null;
  let inFlight = Promise.resolve();
  const sample = () => {
    inFlight = inFlight
      .then(() => snapshot(rootPid))
      .then((value) => {
        peakRssBytes = Math.max(peakRssBytes, value.rssBytes);
        rssSamples += 1;
      })
      .catch((error) => {
        samplingError ??= error instanceof Error ? error.message : String(error);
      });
  };
  const timer = setInterval(sample, intervalMs);
  const started = process.hrtime.bigint();
  let value;
  try {
    value = await task();
  } finally {
    clearInterval(timer);
    await inFlight;
  }
  const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
  const after = await snapshot(rootPid);
  peakRssBytes = Math.max(peakRssBytes, after.rssBytes);
  rssSamples += 1;
  const cpuMs = Math.max(0, (after.cpuSeconds - before.cpuSeconds) * 1_000);
  return {
    metrics: {
      cpuMs,
      cpuPercent: durationMs === 0 ? 0 : (cpuMs / durationMs) * 100,
      durationMs,
      peakProcessCount: Math.max(before.processCount, after.processCount),
      peakRssBytes,
      rssSamples,
      samplingError,
    },
    value,
  };
}

function boundedInteger(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}
