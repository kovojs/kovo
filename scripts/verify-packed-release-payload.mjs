#!/usr/bin/env node
import { lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { readBoundedRegularFile } from './lib/bounded-regular-file.mjs';
import { readPackageTarballSnapshot } from './lib/deterministic-tarball.mjs';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import {
  validatePackedReleaseManifest,
  verifyPackedAttestationBytes,
} from './publish-packed-packages.mjs';
import { packedManifestMaxBytes, releaseDir, releasePackages } from './release-packages.mjs';

const manifestName = 'packed-packages.json';
const tarballDirectoryName = 'tarballs';

/**
 * Authenticate the complete regular-file census of one downloaded producer payload, then
 * materialize only its bounded snapshots into an empty release root. The artifact input is not
 * an archive: no adversarial pathname or compression parser runs before these checks.
 */
export function sealPackedReleasePayload({
  expectedPackages = releasePackages(),
  inputRoot,
  outputRoot = releaseDir,
} = {}) {
  if (typeof inputRoot !== 'string' || inputRoot.length === 0) {
    throw new TypeError('producer payload input root is required');
  }
  const root = path.resolve(inputRoot);
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new TypeError('producer payload root must be a non-symlink directory');
  }
  assertExactDirectoryEntries(root, [manifestName, tarballDirectoryName], 'producer payload');

  const manifestBytes = readBoundedRegularFile(
    path.join(root, manifestName),
    packedManifestMaxBytes,
    'producer packed release manifest',
  );
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest?.schema !== 'kovo.packed-public-packages/v2') {
    throw new TypeError('packed release payload has an invalid schema');
  }
  const packages = validatePackedReleaseManifest(manifest, expectedPackages);
  const expectedTarballs = packages.map((pkg) => exactTarballBasename(pkg));
  if (new Set(expectedTarballs).size !== expectedTarballs.length) {
    throw new TypeError('packed release payload repeats a tarball filename');
  }

  const inputTarballs = path.join(root, tarballDirectoryName);
  const tarballDirectoryStat = lstatSync(inputTarballs);
  if (!tarballDirectoryStat.isDirectory() || tarballDirectoryStat.isSymbolicLink()) {
    throw new TypeError('producer tarballs entry must be a non-symlink directory');
  }
  assertExactDirectoryEntries(inputTarballs, expectedTarballs, 'producer tarball directory');

  const tarballSnapshots = packages.map((pkg, index) => {
    const bytes = readPackageTarballSnapshot(path.join(inputTarballs, expectedTarballs[index]));
    verifyPackedAttestationBytes(pkg, bytes);
    return bytes;
  });

  const destination = path.resolve(outputRoot);
  const destinationFromRoot = path.relative(root, destination);
  const rootFromDestination = path.relative(destination, root);
  if (
    destination === root ||
    (!destinationFromRoot.startsWith(`..${path.sep}`) && destinationFromRoot !== '..') ||
    (!rootFromDestination.startsWith(`..${path.sep}`) && rootFromDestination !== '..')
  ) {
    throw new TypeError('sealed release destination must not overlap the untrusted input root');
  }
  let createdDestination = false;
  try {
    mkdirSync(destination, { mode: 0o700 });
    createdDestination = true;
    mkdirSync(path.join(destination, tarballDirectoryName), { mode: 0o700 });
    writeFileSync(path.join(destination, manifestName), manifestBytes, {
      flag: 'wx',
      mode: 0o600,
    });
    for (const [index, basename] of expectedTarballs.entries()) {
      writeFileSync(
        path.join(destination, tarballDirectoryName, basename),
        tarballSnapshots[index],
        {
          flag: 'wx',
          mode: 0o600,
        },
      );
    }
    assertExactDirectoryEntries(
      destination,
      [manifestName, tarballDirectoryName],
      'sealed release payload',
    );
    assertExactDirectoryEntries(
      path.join(destination, tarballDirectoryName),
      expectedTarballs,
      'sealed release tarball directory',
    );
    return packages;
  } catch (error) {
    if (createdDestination) rmSync(destination, { force: true, recursive: true });
    throw error;
  }
}

function exactTarballBasename(pkg) {
  const prefix = '.release/tarballs/';
  if (
    typeof pkg?.tarball !== 'string' ||
    !pkg.tarball.startsWith(prefix) ||
    pkg.tarball.slice(prefix.length).includes('/')
  ) {
    throw new TypeError(`${String(pkg?.name)} tarball path is not a direct release tarball`);
  }
  const basename = pkg.tarball.slice(prefix.length);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/u.test(basename)) {
    throw new TypeError(`${String(pkg.name)} tarball filename is not canonical ASCII`);
  }
  return basename;
}

function assertExactDirectoryEntries(directory, expectedNames, label) {
  const expected = [...expectedNames].map((name) => Buffer.from(name)).sort(Buffer.compare);
  const observed = readdirSync(directory, { encoding: 'buffer' }).sort(Buffer.compare);
  if (
    observed.length !== expected.length ||
    observed.some((name, index) => !name.equals(expected[index]))
  ) {
    throw new TypeError(`${label} does not have the exact expected entry census`);
  }
}

export function parseVerifyPackedReleasePayloadArgs(argv) {
  if (argv.length !== 2 || argv[0] !== '--input' || !argv[1]) {
    throw new TypeError('Usage: verify-packed-release-payload --input DIRECTORY');
  }
  return { inputRoot: argv[1] };
}

function main() {
  const packages = sealPackedReleasePayload(
    parseVerifyPackedReleasePayloadArgs(process.argv.slice(2)),
  );
  process.stdout.write(`PASS ${packages.length} packed release payloads match reviewed source\n`);
}

if (isMainEntry(import.meta.url)) await runGate(main);
