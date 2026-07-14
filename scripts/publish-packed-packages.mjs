#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { npmPublicRegistry, readNpmPublishedState } from './npm-registry-state.mjs';
import { manifestPath, releasePackages, repoRoot, tarballDir } from './release-packages.mjs';

export function publishPackedPackages(
  args = process.argv,
  {
    exec = execFileSync,
    log = console.log,
    manifest = null,
    npmPublishedState = readNpmPublishedState,
    releasePackagesFn = releasePackages,
    verifyPackedAttestationFn = verifyPackedAttestation,
  } = {},
) {
  const tag = readTag(args);
  const dryRun = args.includes('--dry-run');

  if (manifest === null && !existsSync(manifestPath)) {
    throw new Error(`Missing packed package manifest: ${manifestPath}`);
  }

  const loadedManifest = manifest ?? JSON.parse(readFileSync(manifestPath, 'utf8'));
  const packages = validatePackedReleaseManifest(loadedManifest, releasePackagesFn());

  for (const pkg of packages) {
    const tarball = path.resolve(repoRoot, pkg.tarball);
    verifyPackedAttestationFn(pkg, tarball);
    const state = npmPublishedState(pkg.name, pkg.version);
    if (state.state === 'published') {
      if (state.integrity !== pkg.sha512) {
        throw new Error(
          `${pkg.name}@${pkg.version} is already published with dist.integrity ${state.integrity}, but the verified local tarball is ${pkg.sha512}`,
        );
      }
      log(`Skipping ${pkg.name}@${pkg.version}; version is already published.`);
      continue;
    }
    if (state.state === 'error') {
      if (dryRun) {
        log(
          `Dry run: unable to verify published state for ${pkg.name}@${pkg.version}; continuing without publish.\n${state.detail}`,
        );
        continue;
      }
      throw new Error(
        `Failed to verify npm published state for ${pkg.name}@${pkg.version}:\n${state.detail}`,
      );
    }
    log(`Publishing ${pkg.name}@${pkg.version} with dist-tag ${tag}`);
    if (dryRun) {
      continue;
    }
    exec(
      'vp',
      [
        'exec',
        'npm',
        'publish',
        tarball,
        '--tag',
        tag,
        '--access',
        'public',
        '--provenance',
        '--registry',
        npmPublicRegistry,
      ],
      {
        cwd: repoRoot,
        stdio: 'inherit',
      },
    );
  }
}

export function validatePackedReleaseManifest(manifest, expectedPackages) {
  if (!Array.isArray(manifest?.packages) || manifest.packages.length === 0) {
    throw new Error(`${manifestPath} does not contain any packed packages`);
  }
  if (!Array.isArray(expectedPackages) || expectedPackages.length === 0) {
    throw new Error('Release package inventory is empty');
  }
  if (manifest.packages.length !== expectedPackages.length) {
    throw new Error(
      `${manifestPath} package count mismatch: expected ${expectedPackages.length}, got ${manifest.packages.length}`,
    );
  }

  const seenNames = new Set();
  const seenTarballs = new Set();
  for (const [index, expected] of expectedPackages.entries()) {
    const pkg = manifest.packages[index];
    if (!pkg || typeof pkg !== 'object') {
      throw new Error(`${manifestPath} package ${index} is not an object`);
    }
    if (pkg.name !== expected.name || pkg.version !== expected.version) {
      throw new Error(
        `${manifestPath} package ${index} must be ${expected.name}@${expected.version}; got ${String(pkg.name)}@${String(pkg.version)}`,
      );
    }
    if (seenNames.has(pkg.name)) {
      throw new Error(`${manifestPath} contains duplicate package ${pkg.name}`);
    }
    seenNames.add(pkg.name);
    if (pkg.manifest?.name !== expected.name || pkg.manifest?.version !== expected.version) {
      throw new Error(
        `${pkg.name}@${pkg.version} packed manifest name/version does not match the release inventory`,
      );
    }
    if (typeof pkg.tarball !== 'string' || pkg.tarball.length === 0) {
      throw new Error(`${pkg.name}@${pkg.version} has no tarball path`);
    }
    const tarball = path.resolve(repoRoot, pkg.tarball);
    const relativeTarball = path.relative(tarballDir, tarball);
    if (
      relativeTarball === '' ||
      relativeTarball.startsWith(`..${path.sep}`) ||
      relativeTarball === '..' ||
      path.isAbsolute(relativeTarball) ||
      path.extname(relativeTarball) !== '.tgz'
    ) {
      throw new Error(`${pkg.name}@${pkg.version} tarball must be a .tgz inside ${tarballDir}`);
    }
    if (seenTarballs.has(tarball)) {
      throw new Error(`${manifestPath} reuses tarball path ${pkg.tarball}`);
    }
    seenTarballs.add(tarball);
  }

  return manifest.packages;
}

if (isMainModule()) {
  publishPackedPackages(process.argv);
}

export function verifyPackedAttestation(pkg, tarball) {
  if (!existsSync(tarball)) {
    throw new Error(`Missing tarball for ${pkg.name}: ${tarball}`);
  }
  const tarballStat = lstatSync(tarball);
  if (tarballStat.isSymbolicLink() || !tarballStat.isFile()) {
    throw new Error(`${pkg.name} tarball must be a regular non-symlink file`);
  }
  const realTarballRoot = realpathSync(tarballDir);
  const realTarball = realpathSync(tarball);
  const realRelativeTarball = path.relative(realTarballRoot, realTarball);
  if (
    realRelativeTarball === '' ||
    realRelativeTarball.startsWith(`..${path.sep}`) ||
    realRelativeTarball === '..' ||
    path.isAbsolute(realRelativeTarball)
  ) {
    throw new Error(`${pkg.name} tarball resolves outside ${tarballDir}`);
  }
  const expectedSha512 = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`;
  if (pkg.sha512 !== expectedSha512) {
    throw new Error(`${pkg.name} tarball sha512 attestation mismatch`);
  }

  const files = execFileSync('tar', ['-tf', tarball], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .sort();
  if (JSON.stringify(pkg.files) !== JSON.stringify(files)) {
    throw new Error(`${pkg.name} tarball file-list attestation mismatch`);
  }

  const packedManifest = JSON.parse(
    execFileSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' }),
  );
  if (JSON.stringify(pkg.manifest) !== JSON.stringify(packedManifest)) {
    throw new Error(`${pkg.name} packed manifest attestation mismatch`);
  }
}

function readTag(args) {
  const index = args.indexOf('--tag');
  if (index === -1) return 'latest';
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error('Expected a value after --tag');
  }
  if (!/^[a-z][a-z0-9._-]*$/i.test(value)) {
    throw new Error(`Invalid npm dist-tag: ${value}`);
  }
  return value;
}

function isMainModule() {
  return process.argv[1] === new URL(import.meta.url).pathname;
}
