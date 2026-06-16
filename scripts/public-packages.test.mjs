import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  documentedPackages,
  loadPublicPackages,
  privatePackages,
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
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function packageJson(dir) {
  return JSON.parse(readFileSync(path.join(repoRoot, 'packages', dir, 'package.json'), 'utf8'));
}

describe('public-packages manifest', () => {
  const manifest = loadPublicPackages();

  it('classifies every workspace package under packages/* exactly once', () => {
    const classifiedDirs = manifest.map((pkg) => pkg.dir).sort();
    expect(new Set(classifiedDirs).size, 'no duplicate dirs').toBe(classifiedDirs.length);
    expect(classifiedDirs).toEqual([...workspacePackageDirs()].sort());
  });

  it('matches each package.json name and exists on disk', () => {
    for (const pkg of manifest) {
      expect(packageJson(pkg.dir).name, `name for ${pkg.dir}`).toBe(pkg.name);
      expect(['public', 'private']).toContain(pkg.visibility);
    }
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
    }
  });
});
