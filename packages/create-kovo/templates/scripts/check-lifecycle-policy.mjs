#!/usr/bin/env node
// SPEC §2 / plan 3 §3.5: generated apps deny dependency install scripts by default. This
// dependency-free check intentionally runs before `pnpm install` in CI, so weakening the pnpm door
// cannot execute an app-graph lifecycle script before the policy failure is reported.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const packageJsonPath = resolve(root, 'package.json');
const npmrcPath = resolve(root, '.npmrc');
const workspacePath = resolve(root, 'pnpm-workspace.yaml');
const expectedPackageManager = 'pnpm@10.12.1';
const expectedIgnored = ['esbuild'];
const reviewedNativePins = {
  '@node-rs/argon2': '2.0.2',
  'better-sqlite3': '12.11.1',
};

try {
  const packageJson = readJsonObject(packageJsonPath);
  const dependencies = ownRecord(packageJson, 'dependencies');
  const pnpm = ownRecord(packageJson, 'pnpm');
  const overrides = ownRecord(pnpm, 'overrides');
  const expectedAllowed = Object.hasOwn(dependencies, 'better-sqlite3')
    ? ['@node-rs/argon2', 'better-sqlite3']
    : ['@node-rs/argon2'];

  requireExactValue(
    packageJson.packageManager,
    expectedPackageManager,
    `packageManager must remain exactly ${expectedPackageManager}`,
  );
  requireExactArray(
    pnpm.onlyBuiltDependencies,
    expectedAllowed,
    'pnpm.onlyBuiltDependencies must equal the reviewed lifecycle build allowlist',
  );
  requireExactArray(
    pnpm.ignoredBuiltDependencies,
    expectedIgnored,
    'pnpm.ignoredBuiltDependencies must equal the reviewed no-build list',
  );

  for (const name of expectedAllowed) {
    const expectedVersion = reviewedNativePins[name];
    requireExactValue(
      dependencies[name],
      expectedVersion,
      `${name} lifecycle permission requires the exact direct dependency pin ${expectedVersion}`,
    );
    requireExactValue(
      overrides[name],
      expectedVersion,
      `${name} lifecycle permission requires a graph-wide override to ${expectedVersion}`,
    );
    for (const [selector, version] of Object.entries(overrides)) {
      if (overrideTargetsPackage(selector, name) && version !== expectedVersion) {
        throw new Error(
          `${selector} may not override lifecycle-permitted ${name} away from ${expectedVersion}`,
        );
      }
    }
  }

  for (const forbidden of [
    'allowBuilds',
    'dangerouslyAllowAllBuilds',
    'neverBuiltDependencies',
    'onlyBuiltDependenciesFile',
  ]) {
    if (Object.hasOwn(pnpm, forbidden)) {
      throw new Error(`package.json pnpm.${forbidden} is outside the generated lifecycle policy`);
    }
  }

  const npmrc = readNpmrc(npmrcPath);
  requireExactValue(
    npmrc.get('strict-dep-builds'),
    'true',
    'strict-dep-builds must be exactly true',
  );
  requireExactValue(
    npmrc.get('dangerously-allow-all-builds'),
    'false',
    'dangerously-allow-all-builds must be exactly false',
  );
  requireExactValue(
    npmrc.get('package-manager-strict-version'),
    'true',
    'package-manager-strict-version must be exactly true',
  );

  if (existsSync(workspacePath)) {
    const workspaceSource = readFileSync(workspacePath, 'utf8');
    const override = [
      'allowBuilds',
      'dangerouslyAllowAllBuilds',
      'ignoredBuiltDependencies',
      'neverBuiltDependencies',
      'onlyBuiltDependencies',
      'onlyBuiltDependenciesFile',
      'strictDepBuilds',
    ].find((name) => workspaceSource.includes(name));
    if (override !== undefined) {
      throw new Error(
        `pnpm-workspace.yaml must not override generated lifecycle setting ${override}`,
      );
    }
  }

  process.stdout.write(
    `[kovo:lifecycle-policy] PASS allowed=${expectedAllowed.join(',')} ignored=${expectedIgnored.join(',')}\n`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[kovo:lifecycle-policy] FAIL ${message}\n`);
  process.exitCode = 1;
}

function readJsonObject(path) {
  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `cannot parse ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must contain a JSON object`);
  }
  return value;
}

function ownRecord(record, key) {
  const value = record[key];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`package.json ${key} must be an object`);
  }
  return value;
}

function overrideTargetsPackage(selector, packageName) {
  return (
    selector === packageName ||
    selector.startsWith(`${packageName}@`) ||
    selector.endsWith(`>${packageName}`) ||
    selector.includes(`>${packageName}@`)
  );
}

function readNpmrc(path) {
  const entries = new Map();
  const lines = readFileSync(path, 'utf8').split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.length === 0 || line.startsWith('#') || line.startsWith(';')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) throw new Error(`.npmrc:${index + 1} must be a key=value entry`);
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (entries.has(key)) throw new Error(`.npmrc must not repeat ${key}`);
    entries.set(key, value);
  }
  return entries;
}

function requireExactArray(actual, expected, message) {
  if (!Array.isArray(actual) || JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

function requireExactValue(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}; received ${JSON.stringify(actual)}`);
  }
}
