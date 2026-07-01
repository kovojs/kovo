#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

import { parseSemver } from './bump.mjs';
import { readNpmPublishedState } from './npm-registry-state.mjs';
import { releasePackages } from './release-packages.mjs';

export function validateReleaseInput(
  version,
  {
    env = process.env,
    log = console.log,
    npmPublishedState = readNpmPublishedState,
    releasePackagesFn = releasePackages,
    verifyExactCommitChecksFn = verifyExactCommitChecks,
  } = {},
) {
  if (!version || !parseSemver(version)) {
    throw new Error(
      `Expected a valid semver release version argument; received: ${version ?? '(none)'}`,
    );
  }

  const ref = env.GITHUB_REF;
  if (ref && ref !== 'refs/heads/main') {
    throw new Error(`Release workflow must run from refs/heads/main; received ${ref}`);
  }

  const packages = releasePackagesFn();
  const mismatched = packages.filter((pkg) => pkg.version !== version);
  if (mismatched.length > 0) {
    throw new Error(
      `Release input ${version} does not match every public package:\n` +
        mismatched.map((pkg) => `  ${pkg.name}: ${pkg.version}`).join('\n'),
    );
  }

  if (env.SKIP_NPM_PUBLISHED_CHECK !== '1') {
    const states = packages.map((pkg) => ({
      name: pkg.name,
      result: npmPublishedState(pkg.name, version),
    }));
    const registryErrors = states.filter(({ result }) => result.state === 'error');
    if (registryErrors.length > 0) {
      throw new Error(
        `Failed to verify npm published state for release ${version}:\n` +
          registryErrors
            .map(({ name, result }) => `  ${name}@${version}: ${result.detail}`)
            .join('\n'),
      );
    }
    const alreadyPublished = states
      .filter(({ result }) => result.state === 'published')
      .map(({ name }) => name);
    if (alreadyPublished.length > 0) {
      log(
        `Release ${version} is partially published; these packages will be skipped on publish:\n` +
          alreadyPublished.map((name) => `  ${name}@${version}`).join('\n'),
      );
    }
  }

  if (env.GITHUB_ACTIONS === 'true' && env.SKIP_RELEASE_CHECKS !== '1') {
    verifyExactCommitChecksFn();
  }

  log(`Release input ${version} is valid for ${packages.length} public packages.`);
}

const version = process.argv[2];
if (isMainModule()) {
  validateReleaseInput(version);
}

function verifyExactCommitChecks() {
  const repo = requiredEnv('GITHUB_REPOSITORY');
  const sha = requiredEnv('GITHUB_SHA');
  const requiredChecks = (process.env.REQUIRED_RELEASE_CHECKS ?? 'check')
    .split(',')
    .map((check) => check.trim())
    .filter(Boolean);
  if (requiredChecks.length === 0) {
    throw new Error('REQUIRED_RELEASE_CHECKS must name at least one exact-commit CI check');
  }

  const checkRuns = JSON.parse(
    execFileSync('gh', ['api', `/repos/${repo}/commits/${sha}/check-runs`, '-q', '.check_runs'], {
      encoding: 'utf8',
    }),
  );
  const statuses = JSON.parse(
    execFileSync('gh', ['api', `/repos/${repo}/commits/${sha}/status`, '-q', '.statuses'], {
      encoding: 'utf8',
    }),
  );

  const passed = new Set();
  for (const run of checkRuns) {
    if (run?.status === 'completed' && run?.conclusion === 'success') passed.add(run.name);
  }
  for (const status of statuses) {
    if (status?.state === 'success') passed.add(status.context);
  }

  const missing = requiredChecks.filter((check) => !passed.has(check));
  if (missing.length > 0) {
    throw new Error(
      `Release commit ${sha} is missing successful required check(s): ${missing.join(', ')}`,
    );
  }
  console.log(`Release commit ${sha} has required successful checks: ${requiredChecks.join(', ')}`);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for release check verification`);
  return value;
}

function isMainModule() {
  return process.argv[1] === new URL(import.meta.url).pathname;
}
