#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { publicPackages } from './public-packages.mjs';

const PLACEHOLDER_VERSION = '0.0.0-placeholder.0';
const REPOSITORY_URL = 'git+https://github.com/kovojs/kovo.git';

const args = new Set(process.argv.slice(2));
const publish = args.has('--publish');
const keepTemp = args.has('--keep-temp');

if (args.has('--help') || args.has('-h')) {
  printHelp();
  process.exit(0);
}

for (const arg of args) {
  if (!['--publish', '--keep-temp'].includes(arg)) {
    throw new Error(`Unknown option: ${arg}`);
  }
}

const packages = publicPackages().map((pkg) => pkg.name);
const registry = packages.map((name) => ({ name, version: npmViewVersion(name) }));
const missing = registry.filter((pkg) => pkg.version === null);

if (missing.length === 0) {
  console.log('All public packages already exist on npm; no placeholders are needed.');
  printExisting(registry);
  process.exit(0);
}

if (!publish) {
  console.log('Dry run: these public packages are missing from npm and need placeholders:');
  for (const pkg of missing) {
    console.log(`  ${pkg.name}@${PLACEHOLDER_VERSION}`);
  }
  console.log('\nRun with --publish after `npm login` to create them.');
  console.log('The script publishes missing packages only; existing packages are skipped.');
  process.exit(0);
}

const account = npmWhoami();
console.log(`Publishing placeholders as npm user: ${account}`);

const root = mkdtempSync(path.join(tmpdir(), 'kovo-npm-placeholders-'));
try {
  for (const pkg of missing) {
    publishPlaceholder(root, pkg.name);
  }
  console.log(`Published ${missing.length} placeholder package(s).`);
  console.log('Next: configure npm trusted publishing for every public package.');
} finally {
  if (keepTemp) {
    console.log(`Kept generated package directories at ${root}`);
  } else {
    rmSync(root, { recursive: true, force: true });
  }
}

function npmViewVersion(name) {
  try {
    return execFileSync('npm', ['view', name, 'version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function npmWhoami() {
  try {
    return execFileSync('npm', ['whoami'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new Error('npm is not logged in. Run `npm login`, then rerun with --publish.');
  }
}

function publishPlaceholder(root, name) {
  const dir = path.join(root, packageDirectoryName(name));
  rmSync(dir, { recursive: true, force: true });
  writePlaceholderPackage(dir, name);
  console.log(`Publishing ${name}@${PLACEHOLDER_VERSION}`);
  execFileSync('npm', ['publish', '--access', 'public', '--tag', 'placeholder'], {
    cwd: dir,
    stdio: 'inherit',
  });
}

function writePlaceholderPackage(dir, name) {
  mkdirSync(dir, { recursive: true });
  const manifest = {
    name,
    version: PLACEHOLDER_VERSION,
    description: 'Placeholder package. Real releases are published from https://github.com/kovojs/kovo.',
    repository: {
      type: 'git',
      url: REPOSITORY_URL,
    },
    files: ['README.md'],
    publishConfig: {
      access: 'public',
    },
  };
  writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    path.join(dir, 'README.md'),
    `# ${name}\n\nPlaceholder package for Kovo. Real releases are published from https://github.com/kovojs/kovo.\n`,
  );
}

function packageDirectoryName(name) {
  return name.replace(/^@/, '').replaceAll('/', '-');
}

function printExisting(registry) {
  const existing = registry.filter((pkg) => pkg.version !== null);
  if (existing.length === 0) return;
  console.log('\nExisting npm packages:');
  for (const pkg of existing) {
    console.log(`  ${pkg.name}@${pkg.version}`);
  }
}

function printHelp() {
  console.log(`Usage: pnpm run release:bootstrap-placeholders -- [--publish] [--keep-temp]

Creates initial npm package records for public Kovo packages that do not exist yet.

Default mode is a dry run. Use --publish only after logging in with npm.
Published placeholders use version ${PLACEHOLDER_VERSION} and dist-tag "placeholder".
Existing npm packages are always skipped.`);
}
