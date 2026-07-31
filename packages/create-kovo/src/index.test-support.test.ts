import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { installStarterAppDependencies, resolveStarterInstallMode } from './index.test-support.js';

describe('create-kovo starter test support', () => {
  it('keeps local source fixtures linked unless CI supplies the same-run packed build', () => {
    expect(resolveStarterInstallMode('symlink', {})).toBe('symlink');
    expect(
      resolveStarterInstallMode('symlink', {
        KOVO_PACKED_PACKAGES_DIR: '/tmp/current-kovo-packages',
        KOVO_STARTER_SOURCE_FIXTURE_DEPENDENCIES: 'packed-current',
      }),
    ).toBe('packed');
  });

  it('moves link-local source fixtures onto current dist while preserving packed contracts', () => {
    const environment = {
      KOVO_PACKED_PACKAGES_DIR: '/tmp/current-kovo-packages',
      KOVO_STARTER_SOURCE_FIXTURE_DEPENDENCIES: 'packed-current',
    };
    expect(resolveStarterInstallMode('link-local', environment)).toBe('packed');
    expect(resolveStarterInstallMode('packed', environment)).toBe('packed');
  });

  it('fails closed on an absent same-run artifact or unknown CI posture', () => {
    expect(() =>
      resolveStarterInstallMode('symlink', {
        KOVO_STARTER_SOURCE_FIXTURE_DEPENDENCIES: 'packed-current',
      }),
    ).toThrow(/require KOVO_PACKED_PACKAGES_DIR/u);
    expect(() =>
      resolveStarterInstallMode('symlink', {
        KOVO_PACKED_PACKAGES_DIR: '/tmp/current-kovo-packages',
        KOVO_STARTER_SOURCE_FIXTURE_DEPENDENCIES: 'source-ish',
      }),
    ).toThrow(/must be "packed-current"/u);
  });

  it.each([
    ['missing manifest', undefined],
    [
      'invalid manifest',
      `${JSON.stringify({
        generatedBy: 'scripts/ci-shards.mjs pack-starter',
        tarballs: {},
      })}\n`,
    ],
  ])('does not delete or repack a packed-current artifact with a %s', (_label, manifest) => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-packed-current-failure-'));
    const artifact = join(root, 'artifact');
    mkdirSync(artifact);
    writeFileSync(join(artifact, 'download-marker.txt'), 'same-run artifact\n', 'utf8');
    if (manifest !== undefined) {
      writeFileSync(join(artifact, 'packed-kovo-packages.json'), manifest, 'utf8');
    }
    const before = readdirSync(artifact).toSorted();
    const previousDirectory = process.env.KOVO_PACKED_PACKAGES_DIR;
    const previousPosture = process.env.KOVO_STARTER_SOURCE_FIXTURE_DEPENDENCIES;
    process.env.KOVO_PACKED_PACKAGES_DIR = artifact;
    process.env.KOVO_STARTER_SOURCE_FIXTURE_DEPENDENCIES = 'packed-current';

    try {
      expect(() => installStarterAppDependencies(join(root, 'app'), 'symlink')).toThrow(
        /require a valid packed-kovo-packages\.json.+refusing to modify or repack/u,
      );
      expect(readdirSync(artifact).toSorted()).toEqual(before);
    } finally {
      restoreEnvironment('KOVO_PACKED_PACKAGES_DIR', previousDirectory);
      restoreEnvironment('KOVO_STARTER_SOURCE_FIXTURE_DEPENDENCIES', previousPosture);
      rmSync(root, { force: true, recursive: true });
    }
  });
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
