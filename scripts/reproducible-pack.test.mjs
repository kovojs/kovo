import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { comparePackedPackageManifests, parseReproduciblePackArgs } from './reproducible-pack.mjs';

const shaA =
  'sha512-y2TvuxSZPDyQakkFRPZHKFm+KKVqIisdg9/CZwm9ftvKXLP8NRWj38/ODjNbr43SsoXqNuAisEf1GdCxqWcdBw==';
const shaB =
  'sha512-z2TvuxSZPDyQakkFRPZHKFm+KKVqIisdg9/CZwm9ftvKXLP8NRWj38/ODjNbr43SsoXqNuAisEf1GdCxqWcdBw==';

describe('reproducible public package comparison', () => {
  it('attests identical sha512 subjects and records both build environments plus exclusions', () => {
    const first = manifest('checkout-a', shaA);
    const second = manifest('checkout-b', shaA);
    const result = comparePackedPackageManifests({ first, second, source: 'abc123' });

    expect(result.ok).toBe(true);
    expect(result.attestation).toMatchObject({
      buildEnvironments: [{ id: 'checkout-a' }, { id: 'checkout-b' }],
      excludes: expect.arrayContaining([expect.stringContaining('Runtime-host integrity')]),
      source: 'abc123',
      subjects: [{ name: '@kovojs/core@0.2.0', sha512: shaA }],
    });
  });

  it('kills a same-name/version tarball-byte mutation', () => {
    const result = comparePackedPackageManifests({
      first: manifest('checkout-a', shaA),
      second: manifest('checkout-b', shaB),
      source: 'abc123',
    });

    expect(result.ok).toBe(false);
    expect(result.findings.join('\n')).toContain(`@kovojs/core@0.2.0 differs: ${shaA} != ${shaB}`);
  });

  it('requires the complete explicit CLI contract', () => {
    expect(() => parseReproduciblePackArgs(['--first', 'a'])).toThrow('Missing --out');
  });

  it('keeps the two-clean-checkout proof and attestation in required CI', () => {
    const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
    const job = workflow.slice(
      workflow.indexOf('  reproducible-pack:'),
      workflow.indexOf('\n  test:', workflow.indexOf('  reproducible-pack:')),
    );

    expect(job.match(/uses: actions\/checkout@[0-9a-f]{40}/gu)).toHaveLength(2);
    expect(job).toContain('path: checkout-a');
    expect(job).toContain('path: checkout-b');
    expect(job.match(/run: vp install --frozen-lockfile/gu)).toHaveLength(2);
    expect(job.match(/run: vp exec pnpm run check:publish/gu)).toHaveLength(2);
    expect(job).toContain('vp exec node scripts/reproducible-pack.mjs');
    expect(job).toContain('path: checkout-a/.release/reproducible-pack-attestation.json');
    expect(workflow).toContain('      - reproducible-pack\n');
  });
});

function manifest(id, sha512) {
  return {
    buildEnvironment: { arch: 'x64', id, node: 'v24.18.0', platform: 'linux' },
    deterministicInputs: { ordering: 'bytewise-path', sourceDateEpoch: 499162500 },
    packages: [{ name: '@kovojs/core', sha512, version: '0.2.0' }],
    schema: 'kovo.packed-public-packages/v2',
  };
}
