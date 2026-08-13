import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { canonicalJson, performanceHostFingerprint } from './perf-host.mjs';

describe('performance host fingerprint', () => {
  it('canonicalizes key order and excludes ephemeral load', () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: 3 } })).toBe('{"a":{"x":3,"y":2},"z":1}');
    const host = performanceHostFingerprint({
      browserVersions: ['Chromium 1', 'Chromium 1'],
      runnerImage: 'github-actions/ubuntu-24.04 ImageOS=ubuntu24 ImageVersion=sha256:fixture',
    });
    expect(host).toMatchObject({
      browsers: ['Chromium 1'],
      runnerImage: 'github-actions/ubuntu-24.04 ImageOS=ubuntu24 ImageVersion=sha256:fixture',
      schema: 'kovo-performance-host/v1',
    });
    expect(host.digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    const { digest, schema, ...facts } = host;
    expect(digest).toBe(
      `sha256:${createHash('sha256').update(canonicalJson(facts)).digest('hex')}`,
    );
    expect(schema).toBe('kovo-performance-host/v1');
    expect(host).not.toHaveProperty('loadAverage');
  });

  it('records local runs with an explicit null runner image', () => {
    expect(performanceHostFingerprint({ runnerImage: null }).runnerImage).toBeNull();
  });
});
