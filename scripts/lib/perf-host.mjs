import { createHash } from 'node:crypto';
import os from 'node:os';

export const PERF_HOST_SCHEMA = 'kovo-performance-host/v1';

/** Stable machine/runtime identity. Ephemeral load belongs in a report's hostSamples instead. */
export function performanceHostFingerprint({
  browserVersions = [],
  runnerImage = process.env.KOVO_PERF_RUNNER_IMAGE ?? null,
} = {}) {
  const cpu = os.cpus()[0];
  const facts = {
    arch: process.arch,
    browsers: [...new Set(browserVersions.filter(nonEmptyString))].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
    cpu: cpu ? { count: os.cpus().length, model: cpu.model } : null,
    node: process.version,
    platform: process.platform,
    release: os.release(),
    runnerImage: nonEmptyString(runnerImage) ? runnerImage : null,
    totalMemoryBytes: os.totalmem(),
  };
  return {
    ...facts,
    digest: `sha256:${createHash('sha256').update(canonicalJson(facts)).digest('hex')}`,
    schema: PERF_HOST_SCHEMA,
  };
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
