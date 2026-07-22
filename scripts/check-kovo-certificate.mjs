#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { packWithoutLifecycleScripts } from './lib/pack-without-lifecycle.mjs';
import { publicPackages } from './public-packages.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const certificatePath = path.join(repoRoot, 'security', 'kovo-certificate-v1.json');
const policyPath = path.join(repoRoot, 'security', 'kovo-certificate-policy-v1.json');

export function verifyCommittedKovoCertificate({
  certificateFile = certificatePath,
  cwd = repoRoot,
  exec = execFileSync,
  packageDirectory = defaultPackageDirectory,
  pack = packWithoutLifecycleScripts,
  policyFile = policyPath,
} = {}) {
  const policy = JSON.parse(readFileSync(policyFile, 'utf8'));
  const packages = policy.packages.map((entry) => entry.name);
  const artifactRoot = mkdtempSync(path.join(tmpdir(), 'kovo-certificate-artifacts-'));
  try {
    for (const packageName of packages) {
      const packRoot = mkdtempSync(path.join(tmpdir(), 'kovo-certificate-pack-'));
      const extractRoot = mkdtempSync(path.join(tmpdir(), 'kovo-certificate-extract-'));
      try {
        const tarballPath = pack(
          { dirPath: packageDirectory(packageName, cwd), name: packageName },
          packRoot,
        );
        execFileSync('tar', ['-xzf', tarballPath, '-C', extractRoot], { stdio: 'ignore' });
        const target = path.join(artifactRoot, packageName);
        mkdirSync(target, { recursive: true });
        cpSync(path.join(extractRoot, 'package'), target, { recursive: true });
      } finally {
        rmSync(packRoot, { force: true, recursive: true });
        rmSync(extractRoot, { force: true, recursive: true });
      }
    }
    try {
      return exec(
        process.execPath,
        [
          path.join(cwd, 'packages', 'verify', 'dist', 'bin.mjs'),
          certificateFile,
          '--policy',
          policyFile,
          '--artifacts',
          artifactRoot,
        ],
        { cwd, encoding: 'utf8' },
      );
    } catch (error) {
      const stdout = typeof error?.stdout === 'string' ? error.stdout : '';
      const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
      throw new Error(`${stdout}${stderr}`.trim() || 'standalone certificate checker failed');
    }
  } finally {
    rmSync(artifactRoot, { force: true, recursive: true });
  }
}

function defaultPackageDirectory(packageName, cwd) {
  const entry = publicPackages().find((candidate) => candidate.name === packageName);
  if (entry === undefined) throw new Error(`${packageName}: package directory is not declared`);
  return path.join(cwd, 'packages', entry.dir);
}

function main() {
  process.stdout.write(verifyCommittedKovoCertificate());
}

if (isMainEntry(import.meta.url)) await runGate(main);
