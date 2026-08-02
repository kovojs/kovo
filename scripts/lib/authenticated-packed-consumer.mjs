import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { authenticatedPackedJourneyPackagesFromManifestBytes } from '../golden-journey/packed-package-auth.mjs';
import { packedManifestMaxBytes } from '../release-packages.mjs';
import { readBoundedRegularFile } from './bounded-regular-file.mjs';
import { readPackageTarballSnapshot } from './deterministic-tarball.mjs';

/**
 * Authenticate one authoritative bounded manifest snapshot and snapshot its exact tarball bytes.
 * The final path reread detects ordinary drift but is diagnostic only: authentication and the
 * reported digest are both derived from the first Buffer, so an A→B→A replacement cannot mix them.
 */
export function loadAuthenticatedPackedConsumerInputs(packedManifest, dependencies = {}) {
  const resolvedManifest = path.resolve(packedManifest);
  // Repository-internal deterministic race seam; production callers always omit dependencies.
  const readManifestBytes = dependencies.readManifestBytes ?? readAuthenticatedManifestBytes;
  const authenticateManifestBytes =
    dependencies.authenticateManifestBytes ?? authenticatedPackedJourneyPackagesFromManifestBytes;
  const authoritativeManifest = readManifestBytes(resolvedManifest);
  assertBoundedManifestBuffer(authoritativeManifest);
  const manifestSha256 = `sha256:${createHash('sha256')
    .update(authoritativeManifest)
    .digest('hex')}`;
  const authenticated = authenticateManifestBytes(resolvedManifest, authoritativeManifest);
  const packages = snapshotAuthenticatedTarballBytes(authenticated);
  const finalManifest = readManifestBytes(resolvedManifest);
  if (!Buffer.isBuffer(finalManifest) || !authoritativeManifest.equals(finalManifest)) {
    throw new Error('authenticated packed consumer manifest changed while snapshotting tarballs');
  }
  return Object.freeze({
    manifestSha256,
    packages,
  });
}

function readAuthenticatedManifestBytes(resolvedManifest) {
  return readBoundedRegularFile(
    resolvedManifest,
    packedManifestMaxBytes,
    'authenticated packed consumer manifest',
  );
}

function assertBoundedManifestBuffer(value) {
  if (!Buffer.isBuffer(value) || value.byteLength > packedManifestMaxBytes) {
    throw new TypeError(
      `authenticated packed consumer manifest reader must return a Buffer no larger than ${String(packedManifestMaxBytes)}`,
    );
  }
}

/** Re-hash exact authenticated tarball bytes before any consumer can use them. */
export function snapshotAuthenticatedTarballBytes(authenticatedPackages) {
  if (!(authenticatedPackages instanceof Map) || authenticatedPackages.size === 0) {
    throw new TypeError('authenticated packed consumer requires authenticated package records');
  }
  const snapshots = new Map();
  for (const [name, pkg] of authenticatedPackages) {
    if (
      pkg?.name !== name ||
      typeof pkg.tarballPath !== 'string' ||
      !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(pkg.sha512 ?? '') ||
      !Array.isArray(pkg.entries)
    ) {
      throw new TypeError(`authenticated packed consumer received invalid ${name}`);
    }
    const tarballBytes = readPackageTarballSnapshot(pkg.tarballPath);
    const observedSha512 = `sha512-${createHash('sha512').update(tarballBytes).digest('base64')}`;
    if (observedSha512 !== pkg.sha512) {
      throw new Error(`${name} tarball changed after packed-manifest authentication`);
    }
    snapshots.set(name, Object.freeze({ ...pkg, tarballBytes: Buffer.from(tarballBytes) }));
  }
  return snapshots;
}

/** Materialize immutable private tarballs so package-manager reads cannot race the source set. */
export function materializeAuthenticatedTarballSet(authenticatedPackages, destination) {
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  const tarballNames = new Set();
  const materialized = new Map();
  for (const [name, pkg] of authenticatedPackages) {
    if (!Buffer.isBuffer(pkg?.tarballBytes)) {
      throw new TypeError(`authenticated packed consumer is missing snapshotted ${name} bytes`);
    }
    const tarballName = path.basename(pkg.tarballPath);
    if (!/^[a-z0-9][a-z0-9._-]*\.tgz$/u.test(tarballName) || tarballNames.has(tarballName)) {
      throw new Error(`authenticated packed consumer received ambiguous tarball ${tarballName}`);
    }
    tarballNames.add(tarballName);
    const tarballPath = path.join(destination, tarballName);
    writeFileSync(tarballPath, pkg.tarballBytes, { flag: 'wx', mode: 0o400 });
    const observedSha512 = `sha512-${createHash('sha512')
      .update(readPackageTarballSnapshot(tarballPath))
      .digest('base64')}`;
    if (observedSha512 !== pkg.sha512) {
      throw new Error(`${name} private tarball snapshot does not match the authenticated manifest`);
    }
    materialized.set(
      name,
      Object.freeze({
        entries: pkg.entries,
        manifest: pkg.manifest,
        name: pkg.name,
        sha512: pkg.sha512,
        tarballPath: realpathSync(tarballPath),
        version: pkg.version,
      }),
    );
  }
  return materialized;
}

/** Bind direct Kovo dependencies and every transitive Kovo override to private file URLs. */
export function rewriteScaffoldDependenciesToPackedTarballs(appRoot, packedPackages) {
  const packageJsonPath = path.join(appRoot, 'package.json');
  const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const overrides = { ...manifest.pnpm?.overrides };
  for (const [name, pkg] of [...packedPackages].sort(([left], [right]) =>
    compareUtf8(left, right),
  )) {
    const specifier = pathToFileURL(pkg.tarballPath).href;
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      if (manifest[field] && Object.hasOwn(manifest[field], name)) {
        manifest[field][name] = specifier;
      }
    }
    if (name.startsWith('@kovojs/')) overrides[name] = specifier;
  }
  manifest.pnpm = { ...manifest.pnpm, overrides };
  writeFileSync(packageJsonPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}
