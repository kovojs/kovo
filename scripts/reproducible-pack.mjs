#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { readBoundedRegularFile } from './lib/bounded-regular-file.mjs';
import { readPackageTarballSnapshot } from './lib/deterministic-tarball.mjs';
import { packedManifestMaxBytes } from './release-packages.mjs';

export const reproduciblePackAttestationSchema = 'kovo.reproducible-pack-attestation/v1';
export const reproduciblePackAttestationClaim =
  'Identical source and declared deterministic inputs produced byte-identical public package tarballs in two clean checkouts.';
export const reproduciblePackAttestationExclusions = Object.freeze([
  'Runtime-host integrity after publication or deployment.',
  'Behavioral correctness of enrolled build tools beyond the separately reviewed TCB contract.',
]);

export function comparePackedPackageManifests({ first, second, source }) {
  const findings = [];
  for (const [label, manifest] of [
    ['first', first],
    ['second', second],
  ]) {
    if (manifest?.schema !== 'kovo.packed-public-packages/v2') {
      findings.push(`${label} manifest schema must be kovo.packed-public-packages/v2`);
    }
    if (!manifest?.buildEnvironment || typeof manifest.buildEnvironment !== 'object') {
      findings.push(`${label} manifest is missing buildEnvironment`);
    }
    if (!manifest?.deterministicInputs || typeof manifest.deterministicInputs !== 'object') {
      findings.push(`${label} manifest is missing deterministicInputs`);
    }
    if (!Array.isArray(manifest?.packages))
      findings.push(`${label} manifest packages must be an array`);
  }
  if (findings.length > 0) return { findings, ok: false };
  if (JSON.stringify(first.deterministicInputs) !== JSON.stringify(second.deterministicInputs)) {
    findings.push('deterministic input contracts differ between build environments');
  }

  const firstPackages = packageSubjects(first.packages, 'first', findings);
  const secondPackages = packageSubjects(second.packages, 'second', findings);
  for (const name of [...new Set([...firstPackages.keys(), ...secondPackages.keys()])].sort(
    (left, right) => left.localeCompare(right, 'en'),
  )) {
    const firstSubject = firstPackages.get(name);
    const secondSubject = secondPackages.get(name);
    if (!firstSubject) {
      findings.push(`first build is missing ${name}`);
    } else if (!secondSubject) {
      findings.push(`second build is missing ${name}`);
    } else if (firstSubject !== secondSubject) {
      findings.push(`${name} differs: ${firstSubject} != ${secondSubject}`);
    }
  }

  const subjects = [...firstPackages.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([name, sha512]) => ({ name, sha512 }));
  return {
    attestation: {
      buildEnvironments: [first.buildEnvironment, second.buildEnvironment],
      claim: reproduciblePackAttestationClaim,
      deterministicInputs: first.deterministicInputs,
      excludes: reproduciblePackAttestationExclusions,
      schema: reproduciblePackAttestationSchema,
      source,
      subjects,
    },
    findings,
    ok: findings.length === 0,
  };
}

export function parseReproduciblePackArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--first', '--out', '--second', '--source'].includes(flag) || !value) {
      throw new Error(
        'Usage: reproducible-pack --first FILE --second FILE --out FILE --source REVISION',
      );
    }
    if (values.has(flag)) throw new Error(`Duplicate ${flag}`);
    values.set(flag, value);
  }
  for (const flag of ['--first', '--out', '--second', '--source']) {
    if (!values.has(flag)) throw new Error(`Missing ${flag}`);
  }
  return {
    first: values.get('--first'),
    out: values.get('--out'),
    second: values.get('--second'),
    source: values.get('--source'),
  };
}

export function main({ argv = process.argv.slice(2) } = {}) {
  const options = parseReproduciblePackArgs(argv);
  const comparison = comparePackedPackageManifests({
    first: readAuthenticatedPackedPackageManifest(options.first),
    second: readAuthenticatedPackedPackageManifest(options.second),
    source: options.source,
  });
  for (const finding of comparison.findings) process.stderr.write(`${finding}\n`);
  if (!comparison.ok) return false;
  writeFileSync(options.out, `${JSON.stringify(comparison.attestation, null, 2)}\n`);
  process.stdout.write(
    `reproducible-pack/v1 ${comparison.attestation.subjects.length} public tarball subjects match\n`,
  );
  return true;
}

export function readAuthenticatedPackedPackageManifest(file) {
  const manifestPath = path.resolve(file);
  if (path.basename(manifestPath) !== 'packed-packages.json') {
    throw new TypeError('reproducible-pack manifest filename must be packed-packages.json');
  }
  const artifactRoot = path.dirname(manifestPath);
  assertNonSymlinkDirectory(artifactRoot, 'reproducible-pack artifact root');
  const manifest = JSON.parse(
    readBoundedRegularFile(
      manifestPath,
      packedManifestMaxBytes,
      'reproducible-pack manifest',
    ).toString('utf8'),
  );
  if (!Array.isArray(manifest?.packages) || manifest.packages.length === 0) {
    throw new TypeError('reproducible-pack manifest has no package subjects');
  }
  const seenTarballs = new Set();
  const expectedTarballNames = [];
  const tarballSubjects = [];
  for (const entry of manifest.packages) {
    if (
      typeof entry?.tarball !== 'string' ||
      !entry.tarball.startsWith('.release/tarballs/') ||
      path.posix.normalize(entry.tarball) !== entry.tarball ||
      entry.tarball.slice('.release/tarballs/'.length).includes('/') ||
      !/^sha512-[A-Za-z0-9+/]{86}==$/u.test(entry.sha512 ?? '')
    ) {
      throw new TypeError('reproducible-pack manifest contains an invalid tarball subject');
    }
    const relativeTarball = entry.tarball.slice('.release/'.length);
    const tarball = path.resolve(artifactRoot, ...relativeTarball.split('/'));
    const relativeToRoot = path.relative(artifactRoot, tarball);
    if (
      relativeToRoot.startsWith(`..${path.sep}`) ||
      relativeToRoot === '..' ||
      path.isAbsolute(relativeToRoot) ||
      seenTarballs.has(tarball)
    ) {
      throw new TypeError('reproducible-pack manifest contains an ambiguous tarball path');
    }
    seenTarballs.add(tarball);
    expectedTarballNames.push(path.basename(tarball));
    tarballSubjects.push({ entry, tarball });
  }
  assertExactDirectoryEntries(
    artifactRoot,
    ['packed-packages.json', 'tarballs'],
    'reproducible-pack artifact root',
  );
  const tarballsRoot = path.join(artifactRoot, 'tarballs');
  assertNonSymlinkDirectory(tarballsRoot, 'reproducible-pack tarball directory');
  assertExactDirectoryEntries(
    tarballsRoot,
    expectedTarballNames,
    'reproducible-pack tarball directory',
  );
  for (const { entry, tarball } of tarballSubjects) {
    const observed = `sha512-${createHash('sha512')
      .update(readPackageTarballSnapshot(tarball))
      .digest('base64')}`;
    if (observed !== entry.sha512) {
      throw new TypeError(`${String(entry.name)} tarball bytes do not match the declared sha512`);
    }
  }
  return manifest;
}

function assertNonSymlinkDirectory(directory, label) {
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new TypeError(`${label} must be a non-symlink directory`);
  }
}

function assertExactDirectoryEntries(directory, expectedNames, label) {
  const expected = [...expectedNames].map((name) => Buffer.from(name)).sort(Buffer.compare);
  const observed = readdirSync(directory, { encoding: 'buffer' }).sort(Buffer.compare);
  if (
    expected.length !== observed.length ||
    observed.some((name, index) => !name.equals(expected[index]))
  ) {
    throw new TypeError(`${label} does not have the exact expected entry census`);
  }
}

function packageSubjects(packages, label, findings) {
  const subjects = new Map();
  for (const entry of packages) {
    if (
      typeof entry?.name !== 'string' ||
      typeof entry?.version !== 'string' ||
      !/^sha512-[A-Za-z0-9+/]{86}==$/u.test(entry?.sha512)
    ) {
      findings.push(`${label} manifest contains an invalid package subject`);
      continue;
    }
    const name = `${entry.name}@${entry.version}`;
    if (subjects.has(name)) findings.push(`${label} manifest repeats ${name}`);
    subjects.set(name, entry.sha512);
  }
  return subjects;
}

if (isMainEntry(import.meta.url)) await runGate(main);
