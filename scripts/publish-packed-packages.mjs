#!/usr/bin/env node
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
