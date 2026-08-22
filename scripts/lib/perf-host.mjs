import { createHash } from 'node:crypto';
import os from 'node:os';

export const PERF_HOST_SCHEMA = 'kovo-performance-host/v2';
export const PERF_MEMORY_CAPACITY_QUANTUM_BYTES = 1024 ** 3;

const cohortKeys = Object.freeze([
  'arch',
  'browsers',
  'cpu',
  'memoryCapacityClassBytes',
  'node',
  'platform',
  'release',
  'runnerImage',
]);
const hostKeys = Object.freeze([...cohortKeys, 'digest', 'schema', 'totalMemoryBytes'].sort());

/**
 * Stable machine/runtime cohort identity. Raw memory remains reportable, while small hypervisor-
 * reserved-memory differences map to an explicit GiB capacity class. Ephemeral load belongs in a
 * report's hostSamples instead.
 */
export function performanceHostFingerprint({
  browserVersions = [],
  runnerImage = process.env.KOVO_PERF_RUNNER_IMAGE ?? null,
  totalMemoryBytes = os.totalmem(),
} = {}) {
  const cpu = os.cpus()[0];
  const cohort = {
    arch: process.arch,
    browsers: [...new Set(browserVersions.filter(nonEmptyString))].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
    cpu: cpu ? { count: os.cpus().length, model: cpu.model } : null,
    memoryCapacityClassBytes: performanceMemoryCapacityClass(totalMemoryBytes),
    node: process.version,
    platform: process.platform,
    release: os.release(),
    runnerImage: nonEmptyString(runnerImage) ? runnerImage : null,
  };
  return {
    ...cohort,
    digest: sha256Canonical(cohort),
    schema: PERF_HOST_SCHEMA,
    totalMemoryBytes,
  };
}

/** Normalize raw capacity to the nearest GiB; 16 GiB hosted runners remain one exact cohort. */
export function performanceMemoryCapacityClass(totalMemoryBytes) {
  if (!Number.isSafeInteger(totalMemoryBytes) || totalMemoryBytes <= 0) {
    throw new TypeError('total memory must be a positive safe integer');
  }
  return Math.max(
    PERF_MEMORY_CAPACITY_QUANTUM_BYTES,
    Math.round(totalMemoryBytes / PERF_MEMORY_CAPACITY_QUANTUM_BYTES) *
      PERF_MEMORY_CAPACITY_QUANTUM_BYTES,
  );
}

export function performanceHostFingerprintFindings(host) {
  if (!ownRecord(host) || host.schema !== PERF_HOST_SCHEMA) {
    return [`host fingerprint is not ${PERF_HOST_SCHEMA}`];
  }
  const findings = [];
  if (canonicalJson(Object.keys(host).sort()) !== canonicalJson(hostKeys)) {
    findings.push('host fact census is not the exact v2 schema');
  }
  let expectedCapacity = null;
  try {
    expectedCapacity = performanceMemoryCapacityClass(host.totalMemoryBytes);
  } catch {
    findings.push('raw total memory is unavailable');
  }
  if (expectedCapacity !== null && host.memoryCapacityClassBytes !== expectedCapacity) {
    findings.push('memory capacity class is not derived from raw total memory');
  }
  if (
    !nonEmptyString(host.arch) ||
    !validBrowsers(host.browsers) ||
    !validCpu(host.cpu) ||
    !nonEmptyString(host.node) ||
    !nonEmptyString(host.platform) ||
    !nonEmptyString(host.release) ||
    !(host.runnerImage === null || nonEmptyString(host.runnerImage))
  ) {
    findings.push('host cohort facts are malformed');
  }
  const cohort = Object.fromEntries(cohortKeys.map((key) => [key, host[key]]));
  if (
    !/^sha256:[0-9a-f]{64}$/u.test(host.digest ?? '') ||
    host.digest !== sha256Canonical(cohort)
  ) {
    findings.push('host digest is not derived from normalized cohort facts');
  }
  return [...new Set(findings)];
}

export function validPerformanceHostFingerprint(host) {
  return performanceHostFingerprintFindings(host).length === 0;
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function ownRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validBrowsers(value) {
  return (
    Array.isArray(value) &&
    value.every(nonEmptyString) &&
    canonicalJson(value) ===
      canonicalJson(
        [...new Set(value)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
      )
  );
}

function validCpu(value) {
  return (
    ownRecord(value) &&
    Number.isSafeInteger(value.count) &&
    value.count > 0 &&
    nonEmptyString(value.model) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson(['count', 'model'])
  );
}

function sha256Canonical(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}
