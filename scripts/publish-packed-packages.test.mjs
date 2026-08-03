import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  packedBytesSha256,
  packedTarballSha512,
  publishPackedPackages,
  readPackedReleaseManifest,
  validatePackedReleaseManifest,
} from './publish-packed-packages.mjs';
import { packedManifestMaxBytes } from './release-packages.mjs';

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
  return packedManifest.packages.map(({ manifest: packedPackageManifest, name, version }) => ({
    manifest: { ...packedPackageManifest, publishConfig: {} },
    name,
    version,
  }));
}

describe('publish-packed-packages', () => {
  it('owns the fixed packed-manifest and tarball digest formats', () => {
    const bytes = Buffer.from('abc');
    expect(packedBytesSha256(bytes)).toBe(
      'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(packedTarballSha512(bytes)).toBe(
      'sha512-3a81oZNherrMQXNJriBBMRLm+k6JqX6iCp7u5ktV05ohkpkqJ0/BqDa6PCOj/uu9RU1EI2Q86A4qmslPpUyknw==',
    );
    expect(() => packedBytesSha256('abc')).toThrow('packed manifest digest input must be a Buffer');
    expect(() => packedTarballSha512('abc')).toThrow(
      'packed tarball digest input must be a Buffer',
    );
  });

  it('bounds the downloaded release manifest before allocating or parsing it', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-packed-manifest-limit-'));
    const sparseManifest = path.join(root, 'packed-packages.json');
    try {
      writeFileSync(sparseManifest, '{}');
      truncateSync(sparseManifest, packedManifestMaxBytes + 1);
      expect(() => readPackedReleaseManifest(sparseManifest)).toThrow(
        `packed release manifest must be a regular non-symlink file no larger than ${packedManifestMaxBytes}`,
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

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
    expect(exec.mock.calls[0][0]).toBe('npm');
    expect(exec.mock.calls[0][1]).toEqual([
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
        releasePackagesFn: () => releasePackagesFor(manifest()),
        verifyPackedAttestationFn,
      }),
    ).toThrow('must be @kovojs/a@1.2.3');
    expect(verifyPackedAttestationFn).not.toHaveBeenCalled();
    expect(npmPublishedState).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  it('rejects path escapes, package-set drift, duplicates, and packed identity drift', () => {
    const expected = [
      {
        manifest: { name: '@kovojs/a', publishConfig: {}, version: '1.2.3' },
        name: '@kovojs/a',
        version: '1.2.3',
      },
      {
        manifest: { name: '@kovojs/b', publishConfig: {}, version: '1.2.3' },
        name: '@kovojs/b',
        version: '1.2.3',
      },
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

  it('rejects self-attested dependency, export, import, bin, and script drift', () => {
    const sourceManifest = {
      bin: { example: './dist/bin.mjs' },
      dependencies: { reviewed: '1.0.0' },
      exports: { '.': { default: './dist/index.mjs', types: './dist/index.d.mts' } },
      imports: { '#internal': './dist/internal.mjs' },
      name: '@kovojs/a',
      publishConfig: {},
      scripts: { check: 'vitest --run' },
      version: '1.2.3',
    };
    const packed = {
      ...manifest().packages[0],
      manifest: { ...sourceManifest },
    };
    delete packed.manifest.publishConfig;
    const expected = [{ manifest: sourceManifest, name: '@kovojs/a', version: '1.2.3' }];
    expect(validatePackedReleaseManifest({ packages: [packed] }, expected)).toHaveLength(1);

    for (const attackedManifest of [
      { ...packed.manifest, dependencies: { reviewed: '1.0.0', unreviewed: '9.9.9' } },
      { ...packed.manifest, exports: { '.': './dist/attacker.mjs' } },
      { ...packed.manifest, imports: { '#internal': './dist/attacker.mjs' } },
      { ...packed.manifest, bin: { example: './dist/attacker.mjs' } },
      { ...packed.manifest, scripts: { check: 'node attacker.mjs' } },
    ]) {
      expect(() =>
        validatePackedReleaseManifest(
          { packages: [{ ...packed, manifest: attackedManifest }] },
          expected,
        ),
      ).toThrow('does not match the reviewed source-derived manifest');
    }
  });

  it('preserves order-sensitive export and import condition maps', () => {
    const sourceManifest = {
      exports: { '.': { import: './dist/import.mjs', default: './dist/default.mjs' } },
      imports: { '#mode': { node: './dist/node.mjs', default: './dist/default.mjs' } },
      name: '@kovojs/a',
      publishConfig: {},
      version: '1.2.3',
    };
    const packed = {
      ...manifest().packages[0],
      manifest: {
        ...sourceManifest,
        exports: { '.': { default: './dist/default.mjs', import: './dist/import.mjs' } },
        imports: { '#mode': { default: './dist/default.mjs', node: './dist/node.mjs' } },
      },
    };
    delete packed.manifest.publishConfig;

    expect(() =>
      validatePackedReleaseManifest({ packages: [packed] }, [
        { manifest: sourceManifest, name: '@kovojs/a', version: '1.2.3' },
      ]),
    ).toThrow('does not match the reviewed source-derived manifest');
  });
});
