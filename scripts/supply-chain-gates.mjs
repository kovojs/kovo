#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { publicPackages, repoRoot } from './public-packages.mjs';

const approvedBuiltDependencies = Object.freeze(['@node-rs/argon2', 'better-sqlite3']);
const allowedLifecycleScripts = Object.freeze({
  prepack: /^pnpm run build:dist$/,
});
const lifecycleScriptNames = new Set([
  'preinstall',
  'install',
  'postinstall',
  'prepublish',
  'prepublishOnly',
  'prepare',
  'prepack',
  'postpack',
  'publish',
  'postpublish',
]);

export function verifyBuildScriptPolicy(rootPackageJson, packageManifests) {
  const actual = [...(rootPackageJson.pnpm?.onlyBuiltDependencies ?? [])].sort(compareStrings);
  const expected = [...approvedBuiltDependencies].sort(compareStrings);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `pnpm.onlyBuiltDependencies must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
    );
  }

  const findings = [];
  for (const manifest of packageManifests) {
    for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
      if (!lifecycleScriptNames.has(name)) continue;
      const allow = allowedLifecycleScripts[name];
      if (!allow?.test(command)) findings.push(`${manifest.name}: scripts.${name}=${command}`);
    }
  }
  if (findings.length > 0) {
    throw new Error(`Unapproved lifecycle scripts:\n  ${findings.join('\n  ')}`);
  }
}

function compareStrings(left, right) {
  return left.localeCompare(right);
}

export function parseAuditFindings(auditJson, minimumSeverity = 'moderate') {
  const severityRank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
  const floor = severityRank[minimumSeverity];
  if (floor === undefined) throw new Error(`Unknown audit severity: ${minimumSeverity}`);

  const vulnerabilities = auditJson.vulnerabilities ?? {};
  return Object.values(vulnerabilities).filter((finding) => {
    const rank = severityRank[finding?.severity];
    return rank !== undefined && rank >= floor;
  });
}

function main() {
  const rootPackageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const packageManifests = publicPackages().map((pkg) =>
    JSON.parse(readFileSync(path.join(repoRoot, 'packages', pkg.dir, 'package.json'), 'utf8')),
  );
  verifyBuildScriptPolicy(rootPackageJson, packageManifests);

  const audit = JSON.parse(readAuditJson());
  const findings = parseAuditFindings(audit, process.env.KOVO_AUDIT_LEVEL ?? 'moderate');
  if (findings.length > 0) {
    throw new Error(
      `pnpm audit found ${findings.length} production vulnerabilit${findings.length === 1 ? 'y' : 'ies'} at or above ${process.env.KOVO_AUDIT_LEVEL ?? 'moderate'}`,
    );
  }

  console.log('Supply-chain policy gates passed.');
}

function readAuditJson() {
  try {
    return execFileSync('pnpm', ['audit', '--prod', '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (typeof error.stdout === 'string' && error.stdout.trim()) return error.stdout;
    throw error;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
) {
  main();
}
