import { describe, expect, it, vi } from 'vitest';

import { publishPackedPackages } from './publish-packed-packages.mjs';

function manifest() {
  return {
    packages: [
      {
        name: '@kovojs/a',
        version: '1.2.3',
        tarball: '.release/tarballs/a-1.2.3.tgz',
        sha512: 'unused',
        files: [],
        manifest: {},
      },
    ],
  };
}

describe('publish-packed-packages', () => {
  it('publishes missing packages and skips published ones', () => {
    const exec = vi.fn();
    const log = vi.fn();
    publishPackedPackages(['node', 'scripts/publish-packed-packages.mjs', '--tag', 'next'], {
      env: {},
      exec,
      log,
      manifest: {
        packages: [
          manifest().packages[0],
          {
            ...manifest().packages[0],
            name: '@kovojs/b',
            tarball: '.release/tarballs/b-1.2.3.tgz',
          },
        ],
      },
      verifyPackedAttestationFn: vi.fn(),
      npmPublishedState: (name) =>
        name === '@kovojs/a' ? { state: 'published' } : { state: 'missing' },
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
    ]);
  });

  it('fails closed on ambiguous registry state by default', () => {
    expect(() =>
      publishPackedPackages(['node', 'scripts/publish-packed-packages.mjs'], {
        env: {},
        exec: vi.fn(),
        manifest: manifest(),
        verifyPackedAttestationFn: vi.fn(),
        npmPublishedState: () => ({ state: 'error', detail: 'npm ERR! code E401' }),
      }),
    ).toThrowError('Failed to verify npm published state for @kovojs/a@1.2.3:\nnpm ERR! code E401');
  });

  it('allows ambiguous registry state during dry-run without publishing', () => {
    const exec = vi.fn();
    const log = vi.fn();
    publishPackedPackages(['node', 'scripts/publish-packed-packages.mjs', '--dry-run'], {
      env: {},
      exec,
      log,
      manifest: manifest(),
      verifyPackedAttestationFn: vi.fn(),
      npmPublishedState: () => ({ state: 'error', detail: 'socket hang up' }),
    });

    expect(exec).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      'Dry run: unable to verify published state for @kovojs/a@1.2.3; continuing without publish.\nsocket hang up',
    );
  });

  it('allows an explicit override to publish on ambiguous registry state', () => {
    const exec = vi.fn();
    const log = vi.fn();
    publishPackedPackages(['node', 'scripts/publish-packed-packages.mjs'], {
      env: { SKIP_NPM_PUBLISHED_CHECK: '1' },
      exec,
      log,
      manifest: manifest(),
      verifyPackedAttestationFn: vi.fn(),
      npmPublishedState: () => ({ state: 'error', detail: 'socket hang up' }),
    });

    expect(log).toHaveBeenCalledWith(
      'Warning: skipping published-state verification for @kovojs/a@1.2.3 because SKIP_NPM_PUBLISHED_CHECK=1.\nsocket hang up',
    );
    expect(log).toHaveBeenCalledWith('Publishing @kovojs/a@1.2.3 with dist-tag latest');
    expect(exec).toHaveBeenCalledTimes(1);
  });
});
