import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { canonicalJson, performanceHostFingerprint } from './perf-host.mjs';
import {
  PERF_MEMORY_CAPACITY_QUANTUM_BYTES,
  performanceHostFingerprintFindings,
  performanceMemoryCapacityClass,
} from './perf-host.mjs';

describe('performance host fingerprint', () => {
  it('canonicalizes key order and excludes ephemeral load', () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: 3 } })).toBe('{"a":{"x":3,"y":2},"z":1}');
    const host = performanceHostFingerprint({
      browserVersions: ['Chromium 1', 'Chromium 1'],
      runnerImage: 'github-actions/ubuntu-24.04 ImageOS=ubuntu24 ImageVersion=sha256:fixture',
    });
    expect(host).toMatchObject({
      browsers: ['Chromium 1'],
      memoryCapacityClassBytes: expect.any(Number),
      runnerImage: 'github-actions/ubuntu-24.04 ImageOS=ubuntu24 ImageVersion=sha256:fixture',
      schema: 'kovo-performance-host/v2',
    });
    expect(host.digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    const { digest, schema, totalMemoryBytes, ...cohort } = host;
    expect(digest).toBe(
      `sha256:${createHash('sha256').update(canonicalJson(cohort)).digest('hex')}`,
    );
    expect(schema).toBe('kovo-performance-host/v2');
    expect(totalMemoryBytes).toBeGreaterThan(0);
    expect(host).not.toHaveProperty('loadAverage');
  });

  it('cohorts small raw-memory variance while retaining and authenticating both observations', () => {
    const firstTotal = 16_766_427_136;
    const secondTotal = 16_766_414_848;
    const first = performanceHostFingerprint({ totalMemoryBytes: firstTotal });
    const second = performanceHostFingerprint({ totalMemoryBytes: secondTotal });

    expect(performanceMemoryCapacityClass(firstTotal)).toBe(16 * 1024 ** 3);
    expect(performanceMemoryCapacityClass(secondTotal)).toBe(16 * 1024 ** 3);
    expect(first.memoryCapacityClassBytes).toBe(16 * PERF_MEMORY_CAPACITY_QUANTUM_BYTES);
    expect(first.digest).toBe(second.digest);
    expect(first.totalMemoryBytes).toBe(firstTotal);
    expect(second.totalMemoryBytes).toBe(secondTotal);
    expect(performanceHostFingerprintFindings(first)).toEqual([]);
    expect(performanceHostFingerprintFindings(second)).toEqual([]);
  });

  it('rejects forged capacity classes, cohort fields, and raw-memory census drift', () => {
    const host = performanceHostFingerprint({ totalMemoryBytes: 16_766_427_136 });
    const forgedCapacity = { ...host, memoryCapacityClassBytes: 32 * 1024 ** 3 };
    expect(performanceHostFingerprintFindings(forgedCapacity)).toEqual(
      expect.arrayContaining([
        'memory capacity class is not derived from raw total memory',
        'host digest is not derived from normalized cohort facts',
      ]),
    );
    expect(performanceHostFingerprintFindings({ ...host, release: 'forged-kernel' })).toContain(
      'host digest is not derived from normalized cohort facts',
    );
    expect(performanceHostFingerprintFindings({ ...host, totalMemoryBytes: 0 })).toContain(
      'raw total memory is unavailable',
    );
    expect(performanceHostFingerprint({ totalMemoryBytes: 8 * 1024 ** 3 }).digest).not.toBe(
      host.digest,
    );
  });

  it('records local runs with an explicit null runner image', () => {
    expect(performanceHostFingerprint({ runnerImage: null }).runnerImage).toBeNull();
  });
});
