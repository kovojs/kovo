#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { manifestPath, repoRoot } from './release-packages.mjs';

const tag = readTag(process.argv);
const dryRun = process.argv.includes('--dry-run');

if (!existsSync(manifestPath)) {
  throw new Error(`Missing packed package manifest: ${manifestPath}`);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (!Array.isArray(manifest.packages) || manifest.packages.length === 0) {
  throw new Error(`${manifestPath} does not contain any packed packages`);
}

for (const pkg of manifest.packages) {
  const tarball = path.resolve(repoRoot, pkg.tarball);
  verifyPackedAttestation(pkg, tarball);
  if (publishedVersion(pkg.name, pkg.version) === pkg.version) {
    console.log(`Skipping ${pkg.name}@${pkg.version}; version is already published.`);
    continue;
  }
  console.log(`Publishing ${pkg.name}@${pkg.version} with dist-tag ${tag}`);
  if (dryRun) {
    continue;
  }
  execFileSync('npm', ['publish', tarball, '--tag', tag, '--access', 'public', '--provenance'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
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

function publishedVersion(name, version) {
  try {
    return execFileSync('npm', ['view', `${name}@${version}`, 'version', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .trim()
      .replace(/^"|"$/g, '');
  } catch {
    return null;
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
