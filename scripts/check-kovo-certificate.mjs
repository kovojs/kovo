#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const certificatePath = path.join(repoRoot, 'security', 'kovo-certificate-v1.json');

export function verifyCommittedKovoCertificate({ exec = execFileSync } = {}) {
  const certificate = JSON.parse(readFileSync(certificatePath, 'utf8'));
  const packages = [
    ...new Set(certificate.artifacts.map((entry) => entry.path.split('/').slice(0, 2).join('/'))),
  ].sort(compareStrings);
  const artifactRoot = mkdtempSync(path.join(tmpdir(), 'kovo-certificate-artifacts-'));
  try {
    for (const packageName of packages) {
      const directory = packageName.split('/')[1];
      const source = path.join(repoRoot, 'packages', directory);
      const target = path.join(artifactRoot, packageName);
      mkdirSync(target, { recursive: true });
      cpSync(path.join(source, 'package.json'), path.join(target, 'package.json'));
      cpSync(path.join(source, 'dist'), path.join(target, 'dist'), { recursive: true });
    }
    try {
      return exec(
        process.execPath,
        [
          path.join(repoRoot, 'packages', 'verify', 'dist', 'bin.mjs'),
          certificatePath,
          '--artifacts',
          artifactRoot,
        ],
        { cwd: repoRoot, encoding: 'utf8' },
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

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function main() {
  process.stdout.write(verifyCommittedKovoCertificate());
}

if (isMainEntry(import.meta.url)) await runGate(main);
