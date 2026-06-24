#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

import { parseSemver } from './bump.mjs';
import { releasePackages } from './release-packages.mjs';

const version = process.argv[2];

if (!version || !parseSemver(version)) {
  throw new Error(
    `Expected a valid semver release version argument; received: ${version ?? '(none)'}`,
  );
}

const ref = process.env.GITHUB_REF;
if (ref && ref !== 'refs/heads/main') {
  throw new Error(`Release workflow must run from refs/heads/main; received ${ref}`);
}

const packages = releasePackages();
const mismatched = packages.filter((pkg) => pkg.version !== version);
if (mismatched.length > 0) {
  throw new Error(
    `Release input ${version} does not match every public package:\n` +
      mismatched.map((pkg) => `  ${pkg.name}: ${pkg.version}`).join('\n'),
  );
}

if (process.env.SKIP_NPM_PUBLISHED_CHECK !== '1') {
  const alreadyPublished = packages.filter(
    (pkg) => publishedVersion(pkg.name, version) === version,
  );
  if (alreadyPublished.length > 0) {
    console.log(
      `Release ${version} is partially published; these packages will be skipped on publish:\n` +
        alreadyPublished.map((pkg) => `  ${pkg.name}@${version}`).join('\n'),
    );
  }
}

console.log(`Release input ${version} is valid for ${packages.length} public packages.`);

function publishedVersion(name, requestedVersion) {
  try {
    return execFileSync('npm', ['view', `${name}@${requestedVersion}`, 'version', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .trim()
      .replace(/^"|"$/g, '');
  } catch {
    return null;
  }
}
