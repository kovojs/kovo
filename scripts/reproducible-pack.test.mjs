import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  comparePackedPackageManifests,
  parseReproduciblePackArgs,
  readAuthenticatedPackedPackageManifest,
} from './reproducible-pack.mjs';

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

  it('rehashes each producer tarball and rejects a lying one-producer manifest', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-reproducible-producer-'));
    try {
      mkdirSync(path.join(root, 'tarballs'));
      const tarball = Buffer.from('producer-a exact tarball bytes');
      writeFileSync(path.join(root, 'tarballs', 'core.tgz'), tarball);
      const packed = {
        packages: [
          {
            name: '@kovojs/core',
            sha512: `sha512-${createHash('sha512').update(tarball).digest('base64')}`,
            tarball: '.release/tarballs/core.tgz',
            version: '0.2.0',
          },
        ],
      };
      const manifestPath = path.join(root, 'packed-packages.json');
      writeFileSync(manifestPath, JSON.stringify(packed));
      expect(readAuthenticatedPackedPackageManifest(manifestPath)).toEqual(packed);

      packed.packages[0].sha512 = shaB;
      writeFileSync(manifestPath, JSON.stringify(packed));
      expect(() => readAuthenticatedPackedPackageManifest(manifestPath)).toThrow(
        'tarball bytes do not match the declared sha512',
      );

      packed.packages[0].sha512 = `sha512-${createHash('sha512').update(tarball).digest('base64')}`;
      writeFileSync(manifestPath, JSON.stringify(packed));
      writeFileSync(path.join(root, 'tarballs', 'surplus.tgz'), 'surplus');
      expect(() => readAuthenticatedPackedPackageManifest(manifestPath)).toThrow(
        'exact expected entry census',
      );
      rmSync(path.join(root, 'tarballs', 'surplus.tgz'));
      rmSync(path.join(root, 'tarballs', 'core.tgz'));
      symlinkSync(manifestPath, path.join(root, 'tarballs', 'core.tgz'));
      expect(() => readAuthenticatedPackedPackageManifest(manifestPath)).toThrow(
        'regular non-symlink file',
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('keeps the two-clean-checkout proof and attestation in required CI', () => {
    const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
    const releaseNodeAction = readFileSync(
      new URL('../.github/actions/kovo-release-node/action.yml', import.meta.url),
      'utf8',
    );
    const releasePnpmAction = readFileSync(
      new URL('../.github/actions/kovo-release-pnpm/action.yml', import.meta.url),
      'utf8',
    );
    const jobs = workflow.slice(
      workflow.indexOf('  reproducible-pack-a:'),
      workflow.indexOf('\n  test:', workflow.indexOf('  reproducible-pack:')),
    );

    expect(jobs.match(/uses: actions\/checkout@[0-9a-f]{40}/gu)).toHaveLength(3);
    expect(jobs).toContain('  reproducible-pack-a:');
    expect(jobs).toContain('  reproducible-pack-b:');
    expect(jobs).toContain('      - reproducible-pack-a');
    expect(jobs).toContain('      - reproducible-pack-b');
    expect(jobs).not.toContain('voidzero-dev/setup-vp@');
    expect(jobs.match(/uses: \.\/\.github\/actions\/kovo-release-node/gmu)).toHaveLength(1);
    expect(jobs.match(/uses: \.\/\.github\/actions\/kovo-release-pnpm/gmu)).toHaveLength(2);
    expect(releaseNodeAction).toContain(
      'NODE_ARCHIVE_SHA256: 55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742',
    );
    expect(releasePnpmAction).toContain(
      'pnpm@10.12.1+sha512.f0dda8580f0ee9481c5c79a1d927b9164f2c478e90992ad268bbb2465a736984391d6333d2c327913578b2804af33474ca554ba29c04a8b13060a717675ae3ac',
    );
    expect(jobs.match(/"\$KOVO_RELEASE_PNPM_CLI" install --frozen-lockfile/gu)).toHaveLength(2);
    expect(jobs.match(/"\$KOVO_RELEASE_PNPM_CLI" run check:publish/gu)).toHaveLength(2);
    expect(jobs).toContain('.release/tarballs/*.tgz');
    expect(jobs.match(/include-hidden-files: true/gu)).toHaveLength(2);
    expect(jobs).toContain('Compare public tarball subjects without build dependencies');
    expect(jobs).toContain('node-v24.18.0-linux-x64/bin/node scripts/reproducible-pack.mjs');
    expect(jobs).toContain('path: ${{ runner.temp }}/reproducible-pack-attestation.json');
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
