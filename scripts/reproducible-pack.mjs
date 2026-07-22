#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';

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
    first: readJson(options.first),
    second: readJson(options.second),
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

function readJson(file) {
  return JSON.parse(readFileSync(path.resolve(file), 'utf8'));
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
