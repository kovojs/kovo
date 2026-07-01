#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { readNpmPublishedState } from './npm-registry-state.mjs';
import { manifestPath, repoRoot } from './release-packages.mjs';

export function publishPackedPackages(
  args = process.argv,
  {
    env = process.env,
    exec = execFileSync,
    log = console.log,
    manifest = null,
    npmPublishedState = readNpmPublishedState,
    verifyPackedAttestationFn = verifyPackedAttestation,
  } = {},
) {
  const tag = readTag(args);
  const dryRun = args.includes('--dry-run');

  if (manifest === null && !existsSync(manifestPath)) {
    throw new Error(`Missing packed package manifest: ${manifestPath}`);
  }

  const loadedManifest = manifest ?? JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(loadedManifest.packages) || loadedManifest.packages.length === 0) {
    throw new Error(`${manifestPath} does not contain any packed packages`);
  }

  for (const pkg of loadedManifest.packages) {
    const tarball = path.resolve(repoRoot, pkg.tarball);
    verifyPackedAttestationFn(pkg, tarball);
    const state = npmPublishedState(pkg.name, pkg.version);
    if (state.state === 'published') {
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
      if (env.SKIP_NPM_PUBLISHED_CHECK !== '1') {
        throw new Error(
          `Failed to verify npm published state for ${pkg.name}@${pkg.version}:\n${state.detail}`,
        );
      }
      log(
        `Warning: skipping published-state verification for ${pkg.name}@${pkg.version} because SKIP_NPM_PUBLISHED_CHECK=1.\n${state.detail}`,
      );
    }
    log(`Publishing ${pkg.name}@${pkg.version} with dist-tag ${tag}`);
    if (dryRun) {
      continue;
    }
    exec('npm', ['publish', tarball, '--tag', tag, '--access', 'public', '--provenance'], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
  }
}

if (isMainModule()) {
  publishPackedPackages(process.argv);
}

function verifyPackedAttestation(pkg, tarball) {
  if (!existsSync(tarball)) {
    throw new Error(`Missing tarball for ${pkg.name}: ${tarball}`);
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
