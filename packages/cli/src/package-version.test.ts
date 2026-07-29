import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { readCliPackageVersionFromModuleUrl } from './package-version.js';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'kovo-cli-version-'));
  temporaryRoots.push(root);
  return root;
}

function writeManifest(path: string, version = '1.2.3'): void {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'package.json'), JSON.stringify({ version }), 'utf8');
}

describe('readCliPackageVersionFromModuleUrl', () => {
  it('reads the adjacent package manifest used by source and published package builds', () => {
    const root = temporaryRoot();
    const packageRoot = join(root, 'packages', 'cli');
    const modulePath = join(packageRoot, 'src', 'package-version.mjs');
    writeManifest(packageRoot);

    expect(readCliPackageVersionFromModuleUrl(pathToFileURL(modulePath))).toBe('1.2.3');
  });

  it('reads the repository package manifest from the bundled root dist layout', () => {
    const root = temporaryRoot();
    const modulePath = join(root, 'dist', 'cli', 'src', 'index.mjs');
    writeManifest(join(root, 'packages', 'cli'), '4.5.6-next.7');

    expect(readCliPackageVersionFromModuleUrl(pathToFileURL(modulePath))).toBe('4.5.6-next.7');
  });

  it('does not hide an invalid adjacent package identity behind the repository fallback', () => {
    const root = temporaryRoot();
    const packageRoot = join(root, 'dist', 'cli');
    const modulePath = join(packageRoot, 'src', 'index.mjs');
    writeManifest(packageRoot, 'latest');
    writeManifest(join(root, 'packages', 'cli'), '7.8.9');

    expect(() => readCliPackageVersionFromModuleUrl(pathToFileURL(modulePath))).toThrow(
      '@kovojs/cli package.json is missing an exact semantic version',
    );
  });
});
