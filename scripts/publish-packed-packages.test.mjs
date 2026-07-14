import { describe, expect, it, vi } from 'vitest';

import {
  publishPackedPackages,
  validatePackedReleaseManifest,
} from './publish-packed-packages.mjs';

const localIntegrity = `sha512-${'A'.repeat(86)}==`;

function manifest() {
  return {
    packages: [
      {
        name: '@kovojs/a',
        version: '1.2.3',
        tarball: '.release/tarballs/a-1.2.3.tgz',
        sha512: localIntegrity,
        files: [],
        manifest: { name: '@kovojs/a', version: '1.2.3' },
      },
    ],
  };
}

function releasePackagesFor(packedManifest) {
  return packedManifest.packages.map(({ name, version }) => ({ name, version }));
}

describe('publish-packed-packages', () => {
  it('publishes missing packages and skips published ones', () => {
    const exec = vi.fn();
    const log = vi.fn();
    const packedManifest = {
      packages: [
        manifest().packages[0],
        {
          ...manifest().packages[0],
          name: '@kovojs/b',
          tarball: '.release/tarballs/b-1.2.3.tgz',
          manifest: { name: '@kovojs/b', version: '1.2.3' },
        },
      ],
    };
    publishPackedPackages(['node', 'scripts/publish-packed-packages.mjs', '--tag', 'next'], {
      exec,
      log,
      manifest: packedManifest,
      releasePackagesFn: () => releasePackagesFor(packedManifest),
      verifyPackedAttestationFn: vi.fn(),
      npmPublishedState: (name) =>
        name === '@kovojs/a'
          ? { state: 'published', integrity: localIntegrity }
          : { state: 'missing' },
    });

    expect(log).toHaveBeenCalledWith('Skipping @kovojs/a@1.2.3; version is already published.');
    expect(log).toHaveBeenCalledWith('Publishing @kovojs/b@1.2.3 with dist-tag next');
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0][0]).toBe('vp');
    expect(exec.mock.calls[0][1]).toEqual([
      'exec',
      'npm',
      'publish',
      expect.stringContaining('.release/tarballs/b-1.2.3.tgz'),
      '--tag',
      'next',
      '--access',
      'public',
      '--provenance',
      '--registry',
      'https://registry.npmjs.org/',
    ]);
  });

  it('fails closed on ambiguous registry state by default', () => {
    expect(() =>
      publishPackedPackages(['node', 'scripts/publish-packed-packages.mjs'], {
        exec: vi.fn(),
        manifest: manifest(),
        releasePackagesFn: () => releasePackagesFor(manifest()),
        verifyPackedAttestationFn: vi.fn(),
        npmPublishedState: () => ({ state: 'error', detail: 'npm ERR! code E401' }),
      }),
    ).toThrowError('Failed to verify npm published state for @kovojs/a@1.2.3:\nnpm ERR! code E401');
  });

  it('allows ambiguous registry state during dry-run without publishing', () => {
    const exec = vi.fn();
    const log = vi.fn();
    publishPackedPackages(['node', 'scripts/publish-packed-packages.mjs', '--dry-run'], {
      exec,
      log,
      manifest: manifest(),
      releasePackagesFn: () => releasePackagesFor(manifest()),
      verifyPackedAttestationFn: vi.fn(),
      npmPublishedState: () => ({ state: 'error', detail: 'socket hang up' }),
    });

    expect(exec).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      'Dry run: unable to verify published state for @kovojs/a@1.2.3; continuing without publish.\nsocket hang up',
    );
  });

  it('does not let an environment override publish on ambiguous registry state', () => {
    const exec = vi.fn();
    expect(() =>
      publishPackedPackages(['node', 'scripts/publish-packed-packages.mjs'], {
        env: { SKIP_NPM_PUBLISHED_CHECK: '1' },
        exec,
        manifest: manifest(),
        releasePackagesFn: () => releasePackagesFor(manifest()),
        verifyPackedAttestationFn: vi.fn(),
        npmPublishedState: () => ({ state: 'error', detail: 'socket hang up' }),
      }),
    ).toThrow('socket hang up');
    expect(exec).not.toHaveBeenCalled();
  });

  it('fails closed when an already-published version has different bytes', () => {
    const exec = vi.fn();
    expect(() =>
      publishPackedPackages(['node', 'scripts/publish-packed-packages.mjs'], {
        exec,
        manifest: manifest(),
        releasePackagesFn: () => releasePackagesFor(manifest()),
        verifyPackedAttestationFn: vi.fn(),
        npmPublishedState: () => ({
          state: 'published',
          integrity: `sha512-${'B'.repeat(86)}==`,
        }),
      }),
    ).toThrow('already published with dist.integrity');
    expect(exec).not.toHaveBeenCalled();
  });

  it('rejects a self-attested decoy package and outside tarball before registry or publish', () => {
    const exec = vi.fn();
    const npmPublishedState = vi.fn(() => ({ state: 'missing' }));
    const verifyPackedAttestationFn = vi.fn();
    const attackedManifest = {
      packages: [
        {
          ...manifest().packages[0],
          name: '@kovojs/decoy',
          tarball: '../../outside-admin-1.2.3.tgz',
          manifest: { name: '@kovojs/decoy', version: '1.2.3' },
        },
      ],
    };

    expect(() =>
      publishPackedPackages(['node', 'scripts/publish-packed-packages.mjs'], {
        exec,
        manifest: attackedManifest,
        npmPublishedState,
        releasePackagesFn: () => [{ name: '@kovojs/a', version: '1.2.3' }],
        verifyPackedAttestationFn,
      }),
    ).toThrow('must be @kovojs/a@1.2.3');
    expect(verifyPackedAttestationFn).not.toHaveBeenCalled();
    expect(npmPublishedState).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  it('rejects path escapes, package-set drift, duplicates, and packed identity drift', () => {
    const expected = [
      { name: '@kovojs/a', version: '1.2.3' },
      { name: '@kovojs/b', version: '1.2.3' },
    ];
    const a = manifest().packages[0];
    const b = {
      ...a,
      name: '@kovojs/b',
      tarball: '.release/tarballs/b-1.2.3.tgz',
      manifest: { name: '@kovojs/b', version: '1.2.3' },
    };

    expect(() =>
      validatePackedReleaseManifest({ packages: [{ ...a, tarball: '../../outside.tgz' }] }, [
        expected[0],
      ]),
    ).toThrow('must be a .tgz inside');
    expect(() => validatePackedReleaseManifest({ packages: [a] }, expected)).toThrow(
      'package count mismatch',
    );
    expect(() =>
      validatePackedReleaseManifest({ packages: [a, b, { ...b, name: '@kovojs/c' }] }, expected),
    ).toThrow('package count mismatch');
    expect(() => validatePackedReleaseManifest({ packages: [a, { ...a }] }, expected)).toThrow();
    expect(() =>
      validatePackedReleaseManifest(
        { packages: [{ ...a, manifest: { name: '@kovojs/other', version: '1.2.3' } }] },
        [expected[0]],
      ),
    ).toThrow('packed manifest name/version does not match');
  });
});
