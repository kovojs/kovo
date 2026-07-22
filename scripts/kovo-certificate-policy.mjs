#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { analyzeKovoCertificate, kovoCertificatePolicyPath } from './kovo-certificate.mjs';
import {
  kovoCertificatePolicyFactsFromAnalysis,
  parseKovoCertificatePolicyBytes,
  stableKovoCertificatePolicyJson,
} from './kovo-certificate-format.mjs';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { packWithoutLifecycleScripts } from './lib/pack-without-lifecycle.mjs';
import { publicPackages, repoRoot } from './public-packages.mjs';

/**
 * Propose a new reviewer-owned policy from fresh analysis plus actual packed manifests.
 * This command is intentionally not a check or a certificate-generation prerequisite: its diff
 * is the review event that owns exact implementation bytes, roots, doors, opaque premises, and
 * the complete installed package manifests.
 */
export function proposeKovoCertificatePolicy({
  analysis = analyzeKovoCertificate(),
  readPackedManifest = packAndReadManifest,
} = {}) {
  const facts = kovoCertificatePolicyFactsFromAnalysis(analysis);
  const packageNames = [
    ...new Set(facts.artifacts.map((entry) => entry.path.split('/').slice(0, 2).join('/'))),
  ].sort(compareStrings);
  const packages = packageNames.map((name) => ({
    manifest: readPackedManifest(name),
    name,
  }));
  const policy = {
    artifacts: facts.artifacts,
    doors: facts.doors,
    opaque: facts.opaque,
    packages,
    roots: facts.roots,
    schema: 'kovo.certificate-policy/v1',
  };
  parseKovoCertificatePolicyBytes(Buffer.from(stableKovoCertificatePolicyJson(policy)));
  return policy;
}

export function packAndReadManifest(
  packageName,
  {
    cwd = repoRoot,
    packageDirectory = defaultPackageDirectory,
    pack = packWithoutLifecycleScripts,
  } = {},
) {
  const outputRoot = mkdtempSync(path.join(tmpdir(), 'kovo-certificate-policy-pack-'));
  try {
    const tarballPath = pack(
      { dirPath: packageDirectory(packageName, cwd), name: packageName },
      outputRoot,
    );
    const bytes = execFileSync('tar', ['-xOf', tarballPath, 'package/package.json']);
    const manifest = JSON.parse(bytes.toString('utf8'));
    if (
      manifest === null ||
      typeof manifest !== 'object' ||
      Array.isArray(manifest) ||
      manifest.name !== packageName ||
      Object.hasOwn(manifest, 'publishConfig')
    ) {
      throw new Error(`${packageName}: packed manifest is not an installed package manifest`);
    }
    return manifest;
  } finally {
    rmSync(outputRoot, { force: true, recursive: true });
  }
}

function defaultPackageDirectory(packageName, cwd) {
  const entry = publicPackages().find((candidate) => candidate.name === packageName);
  if (entry === undefined) throw new Error(`${packageName}: package directory is not declared`);
  return path.join(cwd, 'packages', entry.dir);
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function main() {
  if (!process.argv.includes('--write')) {
    throw new Error(
      'Policy proposal requires --write and a human review of security/kovo-certificate-policy-v1.json',
    );
  }
  const policy = proposeKovoCertificatePolicy();
  const bytes = stableKovoCertificatePolicyJson(policy);
  writeFileSync(kovoCertificatePolicyPath, bytes, 'utf8');
  // Re-read the committed bytes so a write or encoding substitution cannot be hidden.
  parseKovoCertificatePolicyBytes(readFileSync(kovoCertificatePolicyPath));
  process.stdout.write(
    `proposed kovo.certificate-policy/v1 artifacts=${policy.artifacts.length} packages=${policy.packages.length} roots=${policy.roots.length} doors=${policy.doors.length} opaque=${policy.opaque.length}; review the full diff before regenerating the certificate\n`,
  );
}

if (isMainEntry(import.meta.url)) await runGate(main);
