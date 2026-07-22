#!/usr/bin/env node
import { isDeepStrictEqual } from 'node:util';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { readBoundedRegularFile } from './lib/bounded-regular-file.mjs';
import {
  readPackedReleaseManifest,
  validatePackedReleaseManifest,
} from './publish-packed-packages.mjs';
import { releasePackages } from './release-packages.mjs';
import {
  reproduciblePackAttestationClaim,
  reproduciblePackAttestationExclusions,
  reproduciblePackAttestationSchema,
} from './reproducible-pack.mjs';

export const reproduciblePackAttestationMaxBytes = 1024 * 1024;

export function verifyReproducibleReleaseSubjects({
  attestation,
  expectedPackages = releasePackages(),
  expectedSource,
  packedManifest,
}) {
  const packages = validatePackedReleaseManifest(packedManifest, expectedPackages);
  if (packedManifest?.schema !== 'kovo.packed-public-packages/v2') {
    throw new TypeError('packed release manifest has an invalid schema');
  }
  if (!/^[0-9a-f]{40,64}$/u.test(expectedSource ?? '')) {
    throw new TypeError('expected release source must be a full lowercase Git object id');
  }
  assertExactKeys(
    attestation,
    [
      'buildEnvironments',
      'claim',
      'deterministicInputs',
      'excludes',
      'schema',
      'source',
      'subjects',
    ],
    'reproducible-pack attestation',
  );
  if (
    attestation.schema !== reproduciblePackAttestationSchema ||
    attestation.source !== expectedSource ||
    attestation.claim !== reproduciblePackAttestationClaim ||
    !isDeepStrictEqual(attestation.excludes, reproduciblePackAttestationExclusions) ||
    !isDeepStrictEqual(attestation.deterministicInputs, packedManifest.deterministicInputs)
  ) {
    throw new TypeError('reproducible-pack attestation posture does not match this release');
  }
  if (!Array.isArray(attestation.buildEnvironments) || attestation.buildEnvironments.length !== 2) {
    throw new TypeError('reproducible-pack attestation must contain two build environments');
  }
  const buildIds = attestation.buildEnvironments
    .map((environment) => environment?.id)
    .sort((left, right) => String(left).localeCompare(String(right), 'en'));
  if (!isDeepStrictEqual(buildIds, ['clean-checkout-a', 'clean-checkout-b'])) {
    throw new TypeError('reproducible-pack attestation does not name both clean builds');
  }
  if (!Array.isArray(attestation.subjects) || attestation.subjects.length !== packages.length) {
    throw new TypeError('reproducible-pack attestation package count does not match this release');
  }

  const subjects = new Map();
  for (const subject of attestation.subjects) {
    assertExactKeys(subject, ['name', 'sha512'], 'reproducible-pack subject');
    if (
      typeof subject.name !== 'string' ||
      !/^sha512-[A-Za-z0-9+/]{86}==$/u.test(subject.sha512 ?? '') ||
      subjects.has(subject.name)
    ) {
      throw new TypeError('reproducible-pack attestation contains an invalid package subject');
    }
    subjects.set(subject.name, subject.sha512);
  }
  for (const pkg of packages) {
    const identity = `${pkg.name}@${pkg.version}`;
    if (subjects.get(identity) !== pkg.sha512) {
      throw new TypeError(`${identity} does not match its two-build reproducible sha512 subject`);
    }
  }
  return packages;
}

export function readReproduciblePackAttestation(file) {
  return JSON.parse(
    readBoundedRegularFile(
      file,
      reproduciblePackAttestationMaxBytes,
      'reproducible-pack attestation',
    ).toString('utf8'),
  );
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--attestation', '--source'].includes(flag) || !value || values.has(flag)) {
      throw new TypeError(
        'Usage: verify-reproducible-release-subjects --attestation FILE --source SHA',
      );
    }
    values.set(flag, value);
  }
  if (!values.has('--attestation') || !values.has('--source')) {
    throw new TypeError(
      'Usage: verify-reproducible-release-subjects --attestation FILE --source SHA',
    );
  }
  return { attestationFile: values.get('--attestation'), source: values.get('--source') };
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort((left, right) => left.localeCompare(right, 'en'));
  const exact = [...expected].sort((left, right) => left.localeCompare(right, 'en'));
  if (!isDeepStrictEqual(actual, exact)) {
    throw new TypeError(`${label} has an invalid shape`);
  }
}

function main() {
  const { attestationFile, source } = parseArgs(process.argv.slice(2));
  const packages = verifyReproducibleReleaseSubjects({
    attestation: readReproduciblePackAttestation(attestationFile),
    expectedSource: source,
    packedManifest: readPackedReleaseManifest(),
  });
  process.stdout.write(
    `PASS ${packages.length} packed release tarballs match the exact two-build CI subjects\n`,
  );
}

if (isMainEntry(import.meta.url)) await runGate(main);
