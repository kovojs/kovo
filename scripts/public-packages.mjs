import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Loader + helpers for `public-packages.json`, the single source of truth for the
 * public/internal package boundary (plan `plans/api-cleanup.md` Phase 2; see
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

/**
 * Packages whose public surface is rendered into the generated API reference,
 * flattened to the shape api-ref.mjs consumes and sorted by display order.
 */
export function documentedPackages() {
  return loadPublicPackages()
    .filter((pkg) => pkg.apiRef)
    .map((pkg) => ({ name: pkg.name, dir: pkg.dir, ...pkg.apiRef }))
    .sort((a, b) => a.order - b.order);
}
