import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { publicPackages, repoRoot as publicPackageRepoRoot } from './public-packages.mjs';

export const repoRoot = publicPackageRepoRoot;
export const releaseDir = path.join(repoRoot, '.release');
export const tarballDir = path.join(releaseDir, 'tarballs');
export const manifestPath = path.join(releaseDir, 'packed-packages.json');
export const packedManifestMaxBytes = 4 * 1024 * 1024;

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
      // Optional peers are supplied by a consumer and do not impose publish order. In particular,
      // @kovojs/better-auth depends on @kovojs/server while server's isolated Better Auth bridge
      // names it as an optional peer; treating that reverse integration edge as a hard dependency
      // creates a false release cycle even though server can be packed without the peer installed.
      if (key === 'peerDependencies' && manifest.peerDependenciesMeta?.[name]?.optional === true) {
        continue;
      }
      if (typeof version === 'string' && version.startsWith('workspace:')) {
        names.add(name);
      }
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right));
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

/** Derive the only packed package.json accepted from one reviewed workspace manifest. */
export function expectedPackedManifest(sourceManifest, releaseVersions) {
  if (!sourceManifest || typeof sourceManifest !== 'object' || Array.isArray(sourceManifest)) {
    throw new TypeError('reviewed source manifest must be an object');
  }
  if (!(releaseVersions instanceof Map)) {
    throw new TypeError('release version inventory must be a Map');
  }
  const expected = JSON.parse(JSON.stringify(sourceManifest));
  const publishConfig = expected.publishConfig;
  if (!publishConfig || typeof publishConfig !== 'object' || Array.isArray(publishConfig)) {
    throw new TypeError(`${String(expected.name)} has no reviewed publishConfig object`);
  }
  const publishKeys = Object.keys(publishConfig);
  if (publishKeys.some((key) => key !== 'bin' && key !== 'exports')) {
    throw new TypeError(
      `${String(expected.name)} uses an unsupported publishConfig transform: ${publishKeys.join(', ')}`,
    );
  }
  for (const key of publishKeys) expected[key] = publishConfig[key];
  delete expected.publishConfig;

  if (
    expected.scripts &&
    typeof expected.scripts === 'object' &&
    !Array.isArray(expected.scripts)
  ) {
    delete expected.scripts.prepack;
  }

  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    const dependencies = expected[field];
    if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) continue;
    for (const [name, range] of Object.entries(dependencies)) {
      if (typeof range !== 'string' || !range.startsWith('workspace:')) continue;
      if (range !== 'workspace:*') {
        throw new TypeError(`${String(expected.name)} ${field}.${name} uses unsupported ${range}`);
      }
      const version = releaseVersions.get(name);
      if (typeof version !== 'string') {
        throw new TypeError(
          `${String(expected.name)} ${field}.${name} is absent from release inventory`,
        );
      }
      dependencies[name] = version;
    }
  }

  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
    'peerDependenciesMeta',
  ]) {
    const record = expected[field];
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
    expected[field] = Object.fromEntries(
      Object.entries(record).sort(([left], [right]) =>
        Buffer.compare(Buffer.from(left), Buffer.from(right)),
      ),
    );
  }
  return expected;
}

export function assertPackedManifestMatchesSource(
  packedManifest,
  sourceManifest,
  releaseVersions,
  label = String(sourceManifest?.name),
) {
  const expected = expectedPackedManifest(sourceManifest, releaseVersions);
  const orderSensitiveMapsMatch = ['exports', 'imports'].every(
    (field) => JSON.stringify(packedManifest?.[field]) === JSON.stringify(expected[field]),
  );
  if (!isDeepStrictEqual(packedManifest, expected) || !orderSensitiveMapsMatch) {
    throw new Error(`${label} packed manifest does not match the reviewed source-derived manifest`);
  }
}
