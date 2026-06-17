import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Loader + helpers for `public-packages.json`, the single source of truth for the
 * public/internal package boundary (plan `plans/api-boudnary.md` Phase 1; see
 * `rules/api-surface.md`). Both the API-reference generator and the api-surface CI
 * gate read the boundary from here so it can never drift between docs and enforcement.
 */

export const repoRoot = fileURLToPath(new URL('../', import.meta.url));
export const manifestPath = path.join(repoRoot, 'public-packages.json');

export function loadPublicPackages() {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.packages)) {
    throw new Error('public-packages.json: missing "packages" array');
  }
  return manifest.packages;
}

/** Packages an outside consumer may depend on. */
export function publicPackages() {
  return loadPublicPackages().filter((pkg) => pkg.visibility === 'public');
}

/** Repo-internal packages no outside consumer should import. */
export function privatePackages() {
  return loadPublicPackages().filter((pkg) => pkg.visibility === 'private');
}

function boundaryList(pkg, key) {
  const value = pkg.apiBoundary?.[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`public-packages.json: ${pkg.name}.apiBoundary.${key} must be an array`);
  }
  return value;
}

/** App-facing public export subpaths for one public package. */
export function publicEntrySubpaths(pkg) {
  return boundaryList(pkg, 'public');
}

/** Compiler-emitted generated ABI export subpaths for one public package. */
export function generatedEntrySubpaths(pkg) {
  return boundaryList(pkg, 'generated');
}

/** Repo-internal export subpaths for one public package. */
export function internalEntrySubpaths(pkg) {
  return boundaryList(pkg, 'internal');
}

/** Boundary tier for a package export subpath. Unknown subpaths stay public by default. */
export function apiBoundaryTier(pkg, subpath) {
  if (generatedEntrySubpaths(pkg).includes(subpath)) return 'generated';
  if (internalEntrySubpaths(pkg).includes(subpath)) return 'internal';
  return 'public';
}

/**
 * Packages whose public surface is rendered into the generated API reference,
 * flattened to the shape api-ref.mjs consumes and sorted by display order.
 */
export function documentedPackages() {
  return loadPublicPackages()
    .filter((pkg) => pkg.apiRef)
    .map((pkg) => ({
      name: pkg.name,
      dir: pkg.dir,
      publicEntries: publicEntrySubpaths(pkg),
      ...pkg.apiRef,
    }))
    .sort((a, b) => a.order - b.order);
}
