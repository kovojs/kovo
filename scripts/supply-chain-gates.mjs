#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { collectFiles } from './lib/source-files.mjs';
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
const approvedNpmPublishAuthorities = Object.freeze(['scripts/publish-packed-packages.mjs']);
const auditSeverityRank = Object.freeze({ info: 0, low: 1, moderate: 2, high: 3, critical: 4 });
const auditSeverities = Object.freeze(Object.keys(auditSeverityRank));
const auditReportKeys = Object.freeze(['actions', 'advisories', 'metadata', 'muted']);
const auditMetadataKeys = Object.freeze([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'totalDependencies',
  'vulnerabilities',
]);
const programmaticPublishPattern =
  /\b(?:exec|execFile|execFileSync|spawn|spawnSync)\s*\(\s*['"](?:npm|pnpm|vp)['"][\s\S]{0,800}?['"]publish['"]/u;
const shellPublishPattern = /(?:^|\s)(?:vp\s+exec\s+)?(?:npm|pnpm)\s+publish(?:\s|$)/mu;

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

export function verifyNpmPublishAuthority(sources) {
  const actual = sources
    .filter(({ text }) => programmaticPublishPattern.test(text) || shellPublishPattern.test(text))
    .map(({ path: filePath }) => filePath)
    .sort(compareStrings);
  if (JSON.stringify(actual) !== JSON.stringify(approvedNpmPublishAuthorities)) {
    throw new Error(
      `npm publish authority must be exactly ${JSON.stringify(approvedNpmPublishAuthorities)}; got ${JSON.stringify(actual)}`,
    );
  }
}

function compareStrings(left, right) {
  return left.localeCompare(right);
}

export function parseAuditFindings(auditJson, minimumSeverity = 'moderate') {
  validatePnpmAuditReport(auditJson);
  const floor = auditSeverityRank[minimumSeverity];
  if (floor === undefined) throw new Error(`Unknown audit severity: ${minimumSeverity}`);

  return Object.values(auditJson.advisories).filter((finding) => {
    return auditSeverityRank[finding.severity] >= floor;
  });
}

export function parsePnpmAuditResult(result) {
  if (result?.error || result?.signal || result?.status === null) {
    throw new Error('pnpm audit execution failed before producing a complete report');
  }
  if (result?.status !== 0 && result?.status !== 1) {
    throw new Error(`pnpm audit exited with unexpected status ${String(result?.status)}`);
  }
  if (typeof result.stdout !== 'string' || result.stdout.trim() === '') {
    throw new Error('pnpm audit produced no JSON report');
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error('pnpm audit output was not valid JSON');
  }
  if (isRecord(report) && Object.hasOwn(report, 'error')) {
    throw new Error('pnpm audit output was an execution error, not an audit report');
  }
  validatePnpmAuditReport(report);

  const advisoryCount = Object.keys(report.advisories).length;
  const expectedStatus = advisoryCount === 0 ? 0 : 1;
  if (result.status !== expectedStatus) {
    throw new Error(
      `pnpm audit status ${result.status} disagrees with ${advisoryCount} reported advisory identit${advisoryCount === 1 ? 'y' : 'ies'}`,
    );
  }
  return report;
}

export function validatePnpmAuditReport(report) {
  requireExactKeys(report, auditReportKeys, 'pnpm audit top-level');
  if (!Array.isArray(report.actions)) throw new Error('pnpm audit actions must be an array');
  if (!Array.isArray(report.muted)) throw new Error('pnpm audit muted must be an array');
  if (report.muted.length !== 0) {
    throw new Error(
      'pnpm audit reported muted advisories; Kovo requires complete advisory evidence',
    );
  }
  if (!isRecord(report.advisories)) {
    throw new Error('pnpm audit advisories must be an object keyed by advisory id');
  }

  requireExactKeys(report.metadata, auditMetadataKeys, 'pnpm audit metadata');
  for (const countName of auditMetadataKeys.slice(0, -1)) {
    requireCount(report.metadata[countName], `pnpm audit metadata.${countName}`);
  }
  requireExactKeys(
    report.metadata.vulnerabilities,
    auditSeverities,
    'pnpm audit metadata.vulnerabilities',
  );
  for (const severity of auditSeverities) {
    requireCount(
      report.metadata.vulnerabilities[severity],
      `pnpm audit metadata.vulnerabilities.${severity}`,
    );
  }

  const advisoryCounts = Object.fromEntries(auditSeverities.map((severity) => [severity, 0]));
  for (const [key, advisory] of Object.entries(report.advisories)) {
    if (!/^[1-9]\d*$/u.test(key) || !Number.isSafeInteger(Number(key))) {
      throw new Error(
        `pnpm audit advisory key ${JSON.stringify(key)} is not a positive integer id`,
      );
    }
    if (!isRecord(advisory)) throw new Error(`pnpm audit advisory ${key} must be an object`);
    if (advisory.id !== Number(key)) {
      throw new Error(`pnpm audit advisory ${key} id does not match its map key`);
    }
    if (typeof advisory.module_name !== 'string' || advisory.module_name.length === 0) {
      throw new Error(`pnpm audit advisory ${key} module_name must be a nonempty string`);
    }
    if (!Object.hasOwn(auditSeverityRank, advisory.severity)) {
      throw new Error(
        `pnpm audit advisory ${key} has unknown severity ${JSON.stringify(advisory.severity)}`,
      );
    }
    if (
      advisory.github_advisory_id !== undefined &&
      advisory.github_advisory_id !== null &&
      (typeof advisory.github_advisory_id !== 'string' || advisory.github_advisory_id.length === 0)
    ) {
      throw new Error(`pnpm audit advisory ${key} github_advisory_id must be null or nonempty`);
    }
    if (!Array.isArray(advisory.findings) || advisory.findings.length === 0) {
      throw new Error(`pnpm audit advisory ${key} findings must be a nonempty array`);
    }
    for (const [findingIndex, finding] of advisory.findings.entries()) {
      if (!isRecord(finding)) {
        throw new Error(`pnpm audit advisory ${key} finding ${findingIndex} must be an object`);
      }
      if (typeof finding.version !== 'string' || finding.version.length === 0) {
        throw new Error(
          `pnpm audit advisory ${key} finding ${findingIndex} version must be nonempty`,
        );
      }
      if (
        !Array.isArray(finding.paths) ||
        finding.paths.length === 0 ||
        finding.paths.some((pathValue) => typeof pathValue !== 'string' || pathValue.length === 0)
      ) {
        throw new Error(
          `pnpm audit advisory ${key} finding ${findingIndex} paths must be nonempty strings`,
        );
      }
    }
    advisoryCounts[advisory.severity] += 1;
  }

  const mismatchedSeverities = auditSeverities.filter(
    (severity) => advisoryCounts[severity] !== report.metadata.vulnerabilities[severity],
  );
  if (mismatchedSeverities.length > 0) {
    throw new Error(
      `pnpm audit metadata vulnerability counts disagree with advisory identities for ${mismatchedSeverities.join(', ')}`,
    );
  }
  return report;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireExactKeys(value, expectedKeys, label) {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const actualKeys = Object.keys(value).sort(compareStrings);
  const expected = [...expectedKeys].sort(compareStrings);
  if (JSON.stringify(actualKeys) !== JSON.stringify(expected)) {
    throw new Error(`${label} keys must be exactly ${JSON.stringify(expected)}`);
  }
}

function requireCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative safe integer`);
  }
}

function main() {
  const rootPackageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const packageManifests = publicPackages().map((pkg) =>
    JSON.parse(readFileSync(path.join(repoRoot, 'packages', pkg.dir, 'package.json'), 'utf8')),
  );
  verifyBuildScriptPolicy(rootPackageJson, packageManifests);
  verifyNpmPublishAuthority(readPublishAuthoritySources());

  const audit = readAuditReport();
  const findings = parseAuditFindings(audit, process.env.KOVO_AUDIT_LEVEL ?? 'moderate');
  if (findings.length > 0) {
    const details = findings
      .map((finding) => {
        const id = finding.github_advisory_id ?? finding.id;
        return `${finding.severity} ${finding.module_name} (${id})`;
      })
      .join(', ');
    throw new Error(
      `pnpm audit found ${findings.length} production advisor${findings.length === 1 ? 'y' : 'ies'} at or above ${process.env.KOVO_AUDIT_LEVEL ?? 'moderate'}: ${details}`,
    );
  }

  console.log('Supply-chain policy gates passed.');
}

function readPublishAuthoritySources() {
  const files = collectFiles(repoRoot, ['scripts', '.github/workflows', 'packages'], {
    includeFile: ({ relativePath }) =>
      (/\.[cm]?[jt]s$/u.test(relativePath) &&
        !/\.(?:test|spec)\.[cm]?[jt]s$/u.test(relativePath)) ||
      /\.ya?ml$/u.test(relativePath) ||
      relativePath.endsWith('/package.json'),
    skipDirectory: ({ name }) => name === 'dist' || name === 'node_modules',
  });
  files.push('package.json');
  files.sort(compareStrings);
  return files.map((filePath) => ({
    path: filePath,
    text: readFileSync(path.join(repoRoot, filePath), 'utf8'),
  }));
}

function readAuditReport() {
  const result = spawnSync('pnpm', ['audit', '--prod', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 8 * 1024 * 1024,
  });
  return parsePnpmAuditResult(result);
}

if (isMainEntry(import.meta.url)) await runGate(main);
