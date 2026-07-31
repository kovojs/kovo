import { realpathSync } from 'node:fs';
import path from 'node:path';

import { readPackageTarballSnapshot } from '../lib/deterministic-tarball.mjs';
import {
  readPackedReleaseManifest,
  validatePackedReleaseManifest,
  verifyPackedAttestationBytes,
} from '../publish-packed-packages.mjs';
import { releasePackages, repoRoot } from '../release-packages.mjs';

export function authenticatedPackedJourneyPackages(packedManifestPath) {
  const resolvedManifest = path.resolve(packedManifestPath);
  const manifest = readPackedReleaseManifest(resolvedManifest);
  const expectedPackages = releasePackages();
  const packages =
    packedManifestReleaseRoot(resolvedManifest) === path.resolve(repoRoot)
      ? validatePackedReleaseManifest(manifest, expectedPackages)
      : validateExternalPackedJourneyManifest(manifest, expectedPackages);
  return new Map(
    packages.map((pkg) => {
      const tarballPath = packedTarballPath(resolvedManifest, pkg.tarball);
      const verified = verifyPackedAttestationBytes(pkg, readPackageTarballSnapshot(tarballPath));
      return [
        pkg.name,
        Object.freeze({
          entries: verified.entries,
          manifest: pkg.manifest,
          name: pkg.name,
          sha512: pkg.sha512,
          tarballPath,
          version: pkg.version,
        }),
      ];
    }),
  );
}

export function packedTarballPath(packedManifestPath, relativeTarball) {
  const releaseRoot = packedManifestReleaseRoot(packedManifestPath);
  const tarballRoot = path.join(releaseRoot, '.release', 'tarballs');
  const candidate = path.resolve(releaseRoot, relativeTarball);
  const relative = path.relative(tarballRoot, candidate);
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    path.extname(relative) !== '.tgz'
  ) {
    throw new Error('packed journey tarball must stay inside its manifest release tarball root');
  }
  const realRoot = realpathSync(tarballRoot);
  const realCandidate = realpathSync(candidate);
  const realRelative = path.relative(realRoot, realCandidate);
  if (
    realRelative === '' ||
    realRelative === '..' ||
    realRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(realRelative)
  ) {
    throw new Error('packed journey tarball resolves outside its manifest release tarball root');
  }
  return realCandidate;
}

export function validateExternalPackedJourneyManifest(manifest, expectedPackages) {
  if (
    manifest?.schema !== 'kovo.packed-public-packages/v2' ||
    !Array.isArray(manifest?.packages) ||
    manifest.packages.length !== expectedPackages.length
  ) {
    throw new Error('external packed journey manifest has an invalid schema or package census');
  }
  const names = new Set();
  const tarballs = new Set();
  for (const [index, expected] of expectedPackages.entries()) {
    const pkg = manifest.packages[index];
    if (
      pkg?.name !== expected.name ||
      pkg?.version !== expected.version ||
      pkg?.manifest?.name !== expected.name ||
      pkg?.manifest?.version !== expected.version ||
      !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(pkg?.sha512 ?? '') ||
      !Array.isArray(pkg?.files) ||
      pkg.files.length === 0 ||
      typeof pkg?.tarball !== 'string' ||
      !/^\.release\/tarballs\/[a-z0-9][a-z0-9._-]*\.tgz$/u.test(pkg.tarball)
    ) {
      throw new Error(`external packed journey manifest package ${String(index)} is invalid`);
    }
    if (names.has(pkg.name) || tarballs.has(pkg.tarball)) {
      throw new Error('external packed journey manifest reuses a package or tarball identity');
    }
    names.add(pkg.name);
    tarballs.add(pkg.tarball);
  }
  return manifest.packages;
}

export function packageSetIdentity(packedPackages) {
  return [...packedPackages.values()]
    .map((pkg) => ({ name: pkg.name, sha512: pkg.sha512, version: pkg.version }))
    .sort((left, right) => compareUtf8(left.name, right.name));
}

function packedManifestReleaseRoot(packedManifestPath) {
  const manifestDirectory = path.dirname(path.resolve(packedManifestPath));
  return path.basename(manifestDirectory) === '.release'
    ? path.dirname(manifestDirectory)
    : path.resolve(repoRoot);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}
