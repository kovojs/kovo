import { readFileSync } from 'node:fs';
import path from 'node:path';

import { publicPackages, repoRoot as publicPackageRepoRoot } from './public-packages.mjs';

export const repoRoot = publicPackageRepoRoot;
export const releaseDir = path.join(repoRoot, '.release');
export const tarballDir = path.join(releaseDir, 'tarballs');
export const manifestPath = path.join(releaseDir, 'packed-packages.json');

export function packageDir(pkg) {
  return path.join(repoRoot, 'packages', pkg.dir);
}

export function readPackageJson(pkg) {
  return JSON.parse(readFileSync(path.join(packageDir(pkg), 'package.json'), 'utf8'));
}

export function releasePackages() {
  const packages = publicPackages().map((pkg) => {
    const manifest = readPackageJson(pkg);
    if (manifest.private === true) {
      throw new Error(`${manifest.name} is listed as public but package.json has private: true`);
    }
    return {
      ...pkg,
      name: manifest.name,
      version: manifest.version,
      manifest,
      dirPath: packageDir(pkg),
    };
  });
  return sortByWorkspaceDependencies(packages);
}

function sortByWorkspaceDependencies(packages) {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const visited = new Set();
  const visiting = new Set();
  const ordered = [];

  function visit(pkg) {
    if (visited.has(pkg.name)) return;
    if (visiting.has(pkg.name)) {
      throw new Error(`Cycle detected in public package dependencies at ${pkg.name}`);
    }
    visiting.add(pkg.name);
    for (const depName of workspaceDependencyNames(pkg.manifest)) {
      const dep = byName.get(depName);
      if (dep) visit(dep);
    }
    visiting.delete(pkg.name);
    visited.add(pkg.name);
    ordered.push(pkg);
  }

  for (const pkg of packages) visit(pkg);
  return ordered;
}

function workspaceDependencyNames(manifest) {
  const names = new Set();
  for (const key of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, version] of Object.entries(manifest[key] ?? {})) {
      if (typeof version === 'string' && version.startsWith('workspace:')) {
        names.add(name);
      }
    }
  }
  return [...names].sort();
}

export function assertNoWorkspaceProtocols(manifest, label) {
  const findings = [];
  for (const key of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, version] of Object.entries(manifest[key] ?? {})) {
      if (typeof version === 'string' && version.startsWith('workspace:')) {
        findings.push(`${key}.${name}=${version}`);
      }
    }
  }
  if (findings.length > 0) {
    throw new Error(
      `${label} still contains workspace protocol dependencies:\n  ${findings.join('\n  ')}`,
    );
  }
}
