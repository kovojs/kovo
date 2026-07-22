#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { readBoundedRegularFile } from './lib/bounded-regular-file.mjs';
import {
  validatePackedReleaseManifest,
  verifyPackedAttestation,
} from './publish-packed-packages.mjs';
import {
  manifestPath,
  packedManifestMaxBytes,
  releasePackages,
  repoRoot,
} from './release-packages.mjs';

const certificatePath = path.join(repoRoot, 'security', 'kovo-certificate-v1.json');
const policyPath = path.join(repoRoot, 'security', 'kovo-certificate-policy-v1.json');
const MAX_POLICY_BYTES = 1024 * 1024;
const MAX_CERTIFICATE_BYTES = 2 * 1024 * 1024;
const MAX_DEPENDENCY_MANIFEST_BYTES = 1024 * 1024;

/**
 * Verify the final `.release` tarball bytes rather than repacking source trees. Each tarball first
 * passes the bounded canonical parser and its manifest/hash attestation; policy-owned packages are
 * then materialized directly from those validated bytes for the standalone certificate checker.
 */
export function verifyPackedReleaseCertificate({
  certificateFile = certificatePath,
  exec = execFileSync,
  expectedPackages = releasePackages(),
  packedManifestFile = manifestPath,
  policyFile = policyPath,
} = {}) {
  const packedManifest = JSON.parse(
    readBoundedRegularFile(
      packedManifestFile,
      packedManifestMaxBytes,
      'packed release manifest',
    ).toString('utf8'),
  );
  const packages = validatePackedReleaseManifest(packedManifest, expectedPackages);
  const packageByName = new Map(packages.map((entry) => [entry.name, entry]));
  const policyBytes = readBoundedRegularFile(policyFile, MAX_POLICY_BYTES, 'certificate policy');
  const certificateBytes = readBoundedRegularFile(
    certificateFile,
    MAX_CERTIFICATE_BYTES,
    'certificate',
  );
  const policy = JSON.parse(policyBytes.toString('utf8'));
  if (!Array.isArray(policy?.packages) || policy.packages.length === 0) {
    throw new TypeError('certificate policy has no package census');
  }

  const verifiedTarballs = new Map(
    packages.map((pkg) => [
      pkg.name,
      verifyPackedAttestation(pkg, path.resolve(repoRoot, pkg.tarball)),
    ]),
  );

  const stagingRoot = mkdtempSync(path.join(tmpdir(), 'kovo-packed-release-certificate-'));
  const artifactRoot = path.join(stagingRoot, 'artifacts');
  mkdirSync(artifactRoot);
  try {
    for (const policyPackage of policy.packages) {
      const packageName = policyPackage?.name;
      if (
        typeof packageName !== 'string' ||
        !/^@kovojs\/[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(packageName)
      ) {
        throw new TypeError('certificate policy contains an invalid package name');
      }
      const packedPackage = packageByName.get(packageName);
      if (packedPackage === undefined) {
        throw new TypeError(
          `${packageName}: certificate policy package is absent from final release`,
        );
      }
      const entries = verifiedTarballs.get(packageName).entries;
      const packageRoot = path.join(artifactRoot, packageName);
      for (const entry of entries) {
        const relativePath = entry.name.slice('package/'.length);
        const target = path.join(packageRoot, ...relativePath.split('/'));
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, entry.data, {
          flag: 'wx',
          mode: entry.executable ? 0o755 : 0o644,
        });
      }
    }

    const evidenceRoot = path.join(stagingRoot, 'evidence');
    mkdirSync(evidenceRoot, { recursive: true });
    const certificateSnapshot = path.join(evidenceRoot, 'certificate.json');
    const policySnapshot = path.join(evidenceRoot, 'policy.json');
    writeFileSync(certificateSnapshot, certificateBytes, { flag: 'wx', mode: 0o600 });
    writeFileSync(policySnapshot, policyBytes, { flag: 'wx', mode: 0o600 });
    const authenticatedVerifier = authenticatePackedVerifier({
      artifactRoot,
      policy,
      stagingRoot,
      verifiedTarballs,
    });

    try {
      return exec(
        process.execPath,
        [
          authenticatedVerifier,
          certificateSnapshot,
          '--policy',
          policySnapshot,
          '--artifacts',
          artifactRoot,
        ],
        { cwd: repoRoot, encoding: 'utf8' },
      );
    } catch (error) {
      const stdout = typeof error?.stdout === 'string' ? error.stdout : '';
      const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
      throw new Error(`${stdout}${stderr}`.trim() || 'final packed release certificate failed');
    }
  } finally {
    rmSync(stagingRoot, { force: true, recursive: true });
  }
}

function authenticatePackedVerifier({ artifactRoot, policy, stagingRoot, verifiedTarballs }) {
  if (!Array.isArray(policy.artifacts) || policy.artifacts.length === 0) {
    throw new TypeError('certificate policy has no artifact subjects');
  }
  const prefix = '@kovojs/verify/dist/';
  const expected = new Map();
  for (const artifact of policy.artifacts) {
    if (
      !artifact ||
      typeof artifact !== 'object' ||
      typeof artifact.path !== 'string' ||
      !artifact.path.startsWith(prefix)
    ) {
      continue;
    }
    if (
      typeof artifact.sha512 !== 'string' ||
      !/^sha512-[A-Za-z0-9+/]{86}==$/u.test(artifact.sha512) ||
      expected.has(artifact.path)
    ) {
      throw new TypeError('certificate policy has an invalid @kovojs/verify artifact subject');
    }
    expected.set(artifact.path, artifact.sha512);
  }
  const verified = verifiedTarballs.get('@kovojs/verify');
  if (verified === undefined || expected.size === 0) {
    throw new TypeError('final release has no reviewer-authenticated @kovojs/verify runtime');
  }
  const actual = new Map(
    verified.entries
      .filter((entry) => /^package\/dist\/.+\.mjs$/u.test(entry.name))
      .map((entry) => [`@kovojs/verify/${entry.name.slice('package/'.length)}`, entry.data]),
  );
  if (
    actual.size !== expected.size ||
    [...actual.keys()].some((artifactPath) => !expected.has(artifactPath))
  ) {
    throw new TypeError('packed @kovojs/verify runtime does not equal reviewer policy scope');
  }
  for (const [artifactPath, bytes] of actual) {
    const observed = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    if (observed !== expected.get(artifactPath)) {
      throw new TypeError(`${artifactPath} does not match its reviewer-owned sha512`);
    }
  }

  const verifierPackage = policy.packages.find((pkg) => pkg?.name === '@kovojs/verify');
  const dependencies = verifierPackage?.manifest?.dependencies;
  if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
    throw new TypeError('reviewer policy has no @kovojs/verify parser dependency');
  }
  const dependencyEntries = Object.entries(dependencies);
  if (dependencyEntries.length !== 1) {
    throw new TypeError('reviewer policy must name exactly one @kovojs/verify parser dependency');
  }
  const [dependencyName, dependencyVersion] = dependencyEntries[0];
  if (
    !/^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u.test(
      dependencyName,
    ) ||
    typeof dependencyVersion !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(dependencyVersion)
  ) {
    throw new TypeError('reviewer policy has an invalid @kovojs/verify parser dependency');
  }
  const dependencyRoot = realpathSync(
    path.join(repoRoot, 'packages', 'verify', 'node_modules', dependencyName),
  );
  const dependencyManifest = JSON.parse(
    readBoundedRegularFile(
      path.join(dependencyRoot, 'package.json'),
      MAX_DEPENDENCY_MANIFEST_BYTES,
      `${dependencyName} manifest`,
    ).toString('utf8'),
  );
  if (
    dependencyManifest.name !== dependencyName ||
    dependencyManifest.version !== dependencyVersion
  ) {
    throw new TypeError(`${dependencyName} does not match the reviewer-owned parser version`);
  }
  const dependencyLink = path.join(stagingRoot, 'node_modules', ...dependencyName.split('/'));
  mkdirSync(path.dirname(dependencyLink), { recursive: true });
  symlinkSync(dependencyRoot, dependencyLink, 'dir');

  const verifier = path.join(artifactRoot, '@kovojs', 'verify', 'dist', 'bin.mjs');
  if (!actual.has('@kovojs/verify/dist/bin.mjs')) {
    throw new TypeError('reviewer policy has no @kovojs/verify executable subject');
  }
  return verifier;
}

function main() {
  process.stdout.write(verifyPackedReleaseCertificate());
}

if (isMainEntry(import.meta.url)) await runGate(main);
