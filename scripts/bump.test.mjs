import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { compareSemver, discoverPackageJsonPaths, packageRows, parseSemver } from './bump.mjs';

const tempDirs = [];

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function tempRepo() {
  const cwd = mkdtempSync(path.join(tmpdir(), 'kovo-bump-test-'));
  tempDirs.push(cwd);
  writeJson(path.join(cwd, 'package.json'), {
    name: 'root',
    version: '0.0.0',
    private: true,
    workspaces: ['packages/*', 'site'],
  });
  writeJson(path.join(cwd, 'packages/core/package.json'), {
    name: '@example/core',
    version: '0.1.0',
  });
  writeJson(path.join(cwd, 'packages/private/package.json'), {
    name: '@example/private',
    private: true,
  });
  writeJson(path.join(cwd, 'site/package.json'), {
    name: '@example/site',
    version: '0.0.0',
    private: true,
  });
  return cwd;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('bump semver helpers', () => {
  it('accepts strict semver versions', () => {
    expect(parseSemver('1.2.3')).toMatchObject({ major: 1, minor: 2, patch: 3 });
    expect(parseSemver('1.2.3-alpha.1+build.5')).toMatchObject({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: ['alpha', '1'],
      build: 'build.5',
    });
    expect(parseSemver('01.2.3')).toBeNull();
    expect(parseSemver('1.2')).toBeNull();
  });

  it('orders prerelease versions using semver precedence', () => {
    expect(compareSemver('0.2.0', '0.1.9')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0-alpha.2', '1.0.0-alpha.1')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0-alpha.10', '1.0.0-alpha.2')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0+build.2', '1.0.0+build.1')).toBe(0);
  });
});

describe('bump workspace discovery', () => {
  it('discovers root and workspace package files without nested templates', () => {
    const cwd = tempRepo();
    writeJson(path.join(cwd, 'packages/core/templates/package.json'), {
      name: '{{name}}',
    });

    expect(discoverPackageJsonPaths({ cwd })).toEqual([
      'package.json',
      'packages/core/package.json',
      'packages/private/package.json',
      'site/package.json',
    ]);
  });

  it('reports rows with missing versions without inventing a version', () => {
    const cwd = tempRepo();

    expect(packageRows({ cwd })).toContainEqual({
      path: 'packages/private/package.json',
      name: '@example/private',
      version: null,
      private: true,
    });
  });
});
