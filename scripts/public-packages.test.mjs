import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  generatedEntrySubpaths,
  internalEntrySubpaths,
  documentedPackages,
  loadPublicPackages,
  privatePackages,
  publicEntrySubpaths,
  publicPackages,
  repoRoot,
} from './public-packages.mjs';

/**
 * The public/internal boundary is only meaningful if it is exhaustive and
 * enforced (plan api-cleanup Phase 2). These tests assert that every workspace
 * package is classified, that the classification matches each package.json's
 * `private` flag, and that the documented set is well-formed.
 */

function workspacePackageDirs() {
  const packagesDir = path.join(repoRoot, 'packages');
  return (
    readdirSync(packagesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      // node_modules (a pnpm hoisting artifact) and dot-dirs are not workspace packages.
      .filter((entry) => entry.name !== 'node_modules' && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
  );
}

function packageJson(dir) {
  return JSON.parse(readFileSync(path.join(repoRoot, 'packages', dir, 'package.json'), 'utf8'));
}

describe('public-packages manifest', () => {
  const manifest = loadPublicPackages();

  it('classifies every workspace package under packages/* exactly once', () => {
    const classifiedDirs = manifest.map((pkg) => pkg.dir).sort();
    expect(new Set(classifiedDirs).size, 'no duplicate dirs').toBe(classifiedDirs.length);
    expect(classifiedDirs).toEqual(
      [...workspacePackageDirs()].sort((left, right) => left.localeCompare(right)),
    );
  });

  it('matches each package.json name and exists on disk', () => {
    for (const pkg of manifest) {
      expect(packageJson(pkg.dir).name, `name for ${pkg.dir}`).toBe(pkg.name);
      expect(['public', 'private']).toContain(pkg.visibility);
    }
  });

  it('classifies the CLI package as @kovojs/cli while preserving the kovo bin', () => {
    const cli = manifest.find((pkg) => pkg.dir === 'cli');
    expect(cli?.name).toBe('@kovojs/cli');
    expect(cli?.kind).toBe('cli');
    expect(publicEntrySubpaths(cli)).toEqual(['.']);
    expect(internalEntrySubpaths(cli)).toEqual(['./internal']);

    const cliPackage = packageJson('cli');
    expect(cliPackage.bin).toEqual({ kovo: './src/bin.ts' });
    expect(cliPackage.publishConfig?.bin).toEqual({ kovo: './dist/bin.mjs' });
  });

  it('requires every private package to set "private": true', () => {
    for (const pkg of privatePackages()) {
      expect(packageJson(pkg.dir).private, `${pkg.name} must set private:true`).toBe(true);
    }
  });

  it('requires public packages NOT to set "private": true', () => {
    for (const pkg of publicPackages()) {
      expect(packageJson(pkg.dir).private ?? false, `${pkg.name} must be publishable`).toBe(false);
    }
  });

  it('has a well-formed documented set (unique slugs and orders)', () => {
    const docs = documentedPackages();
    expect(docs.length).toBeGreaterThan(0);
    const slugs = docs.map((pkg) => pkg.slug);
    const orders = docs.map((pkg) => pkg.order);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(orders).size).toBe(orders.length);
    for (const pkg of docs) {
      expect(typeof pkg.description).toBe('string');
      expect(pkg.description.length).toBeGreaterThan(0);
      // Documented packages are, by definition, public.
      expect(publicPackages().some((p) => p.name === pkg.name)).toBe(true);
      expect(pkg.publicEntries.length, `${pkg.name} public API docs entries`).toBeGreaterThan(0);
    }
  });

  it('declares each public package export subpath in exactly one boundary tier', () => {
    for (const pkg of publicPackages()) {
      const pkgJson = packageJson(pkg.dir);
      const exportedSubpaths = Object.keys(pkgJson.exports ?? {}).sort();
      const publicSubpaths = publicEntrySubpaths(pkg);
      const generatedSubpaths = generatedEntrySubpaths(pkg);
      const internalSubpaths = internalEntrySubpaths(pkg);
      const declaredSubpaths = [...publicSubpaths, ...generatedSubpaths, ...internalSubpaths].sort(
        (left, right) => left.localeCompare(right),
      );

      expect(pkg.apiBoundary, `${pkg.name} must declare apiBoundary metadata`).toBeDefined();
      expect(new Set(declaredSubpaths).size, `${pkg.name} boundary subpaths are unique`).toBe(
        declaredSubpaths.length,
      );
      expect(declaredSubpaths, `${pkg.name} apiBoundary must match package.json exports`).toEqual(
        exportedSubpaths,
      );
    }
  });

  it('keeps generated and internal subpaths out of the public API reference manifest', () => {
    for (const pkg of documentedPackages()) {
      const source = manifest.find((entry) => entry.name === pkg.name);
      const nonPublicSubpaths = [
        ...generatedEntrySubpaths(source),
        ...internalEntrySubpaths(source),
      ];
      for (const subpath of nonPublicSubpaths) {
        expect(pkg.publicEntries, `${pkg.name} docs must not include ${subpath}`).not.toContain(
          subpath,
        );
      }
    }
  });

  it('classifies the server app-shell Vite bridge as public and raw Vite internals as internal', () => {
    const server = manifest.find((pkg) => pkg.name === '@kovojs/server');
    expect(server).toBeDefined();
    expect(publicEntrySubpaths(server)).toContain('./app-shell/vite');
    expect(internalEntrySubpaths(server)).toContain('./internal/app-shell-vite');
    expect(internalEntrySubpaths(server)).not.toContain('./app-shell/vite');
    expect(publicEntrySubpaths(server)).not.toContain('./internal/app-shell-vite');
  });
});
