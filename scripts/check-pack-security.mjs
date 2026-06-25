#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { derivePublishPlan } from './build-publish.mjs';
import { publicPackages, repoRoot } from './public-packages.mjs';

export const packSecuritySnapshotPath = path.join(repoRoot, 'scripts', 'pack-security.files.json');

const maxPackedFileBytes = 16 * 1024 * 1024;
const allowedTopLevelFiles = new Set(['package.json', 'README.md', 'LICENSE', 'LICENSE.md']);
const forbiddenPathSegments = new Set([
  '__fixtures__',
  '__snapshots__',
  '__tests__',
  'fixture',
  'fixtures',
  'test',
  'tests',
]);
const sourceFilePattern = /\.(?:[cm]?ts|tsx|jsx)$/;
const declarationPattern = /\.d\.(?:[cm]?ts|ts)$/;
const sourcemapPattern = /\.map$/;
const textFilePattern = /\.(?:json|mjs|cjs|js|d\.[cm]?ts|map|md|txt|css)$/;
const secretPatterns = [
  { label: 'private key block', pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
  { label: 'AWS access key id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'GitHub token', pattern: /\bgh[opsu]_[A-Za-z0-9_]{36,}\b/ },
  { label: 'npm token', pattern: /\bnpm_[A-Za-z0-9]{36,}\b/ },
  {
    label: 'secret assignment',
    pattern:
      /\b(?:api[_-]?key|auth[_-]?token|client[_-]?secret|password|private[_-]?key|secret|token)\b\s*[:=]\s*["'][A-Za-z0-9+/_=-]{32,}/i,
  },
];

export function normalizePackedPath(entry) {
  return entry.replace(/^package\//, '').replace(/\\/g, '/');
}

export function validatePackedPackage({ files, manifest, packageName, readTextFile, targetFiles }) {
  const findings = [];
  const fileSet = new Set(files.map((file) => file.path));

  for (const target of targetFiles) {
    if (!fileSet.has(target)) {
      findings.push(`${packageName}: publish target missing from tarball: ${target}`);
    }
  }

  for (const file of files) {
    const rel = file.path;
    const base = path.posix.basename(rel);
    const segments = rel.split('/').map((segment) => segment.toLowerCase());

    if (base === '.env' || base.startsWith('.env.')) {
      findings.push(`${packageName}: tarball includes environment file ${rel}`);
    }

    const forbiddenSegment = segments.find((segment) => forbiddenPathSegments.has(segment));
    if (forbiddenSegment) {
      findings.push(`${packageName}: tarball includes ${forbiddenSegment} path ${rel}`);
    }

    if (!rel.startsWith('dist/') && !allowedTopLevelFiles.has(rel)) {
      findings.push(`${packageName}: unexpected top-level tarball file ${rel}`);
    }

    if (sourceFilePattern.test(rel) && !declarationPattern.test(rel)) {
      findings.push(`${packageName}: unexpected source file ${rel}`);
    }

    if (file.size > maxPackedFileBytes) {
      findings.push(
        `${packageName}: oversized packed file ${rel} (${file.size} bytes, max ${maxPackedFileBytes})`,
      );
    }

    if (!textFilePattern.test(rel)) continue;
    const text = readTextFile(rel);
    if (text === undefined) continue;

    for (const { label, pattern } of secretPatterns) {
      if (pattern.test(text)) {
        findings.push(`${packageName}: ${rel} matches ${label} secret pattern`);
      }
    }

    const highEntropy = findHighEntropySecretLikeString(text);
    if (highEntropy) {
      findings.push(
        `${packageName}: ${rel} contains high-entropy secret-like ${highEntropy.label}`,
      );
    }

    if (sourcemapPattern.test(rel)) {
      findings.push(...validateSourceMap(packageName, rel, text));
    }
  }

  const manifestTargets = collectManifestTargets(manifest);
  for (const target of manifestTargets) {
    if (!fileSet.has(target)) {
      findings.push(`${packageName}: packed manifest target missing from tarball: ${target}`);
    }
  }

  return findings;
}

export function collectManifestTargets(manifest) {
  const targets = new Set();
  collectExportTargets(manifest.exports, targets);
  collectBinTargets(manifest.bin, targets);
  return [...targets].sort(compareStrings);
}

function collectExportTargets(value, targets) {
  if (typeof value === 'string') {
    targets.add(stripLeadingDot(value));
    return;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const nested of Object.values(value)) {
    collectExportTargets(nested, targets);
  }
}

function collectBinTargets(value, targets) {
  if (typeof value === 'string') {
    targets.add(stripLeadingDot(value));
    return;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const target of Object.values(value)) {
    if (typeof target === 'string') targets.add(stripLeadingDot(target));
  }
}

function stripLeadingDot(target) {
  return target.replace(/^\.\//, '');
}

function validateSourceMap(packageName, rel, text) {
  const findings = [];
  let map;
  try {
    map = JSON.parse(text);
  } catch {
    findings.push(`${packageName}: ${rel} is not valid JSON sourcemap`);
    return findings;
  }

  const sourceRoot = typeof map.sourceRoot === 'string' ? map.sourceRoot : '';
  if (sourceRoot && isAbsoluteLocalPath(sourceRoot)) {
    findings.push(`${packageName}: ${rel} sourceRoot contains absolute local path`);
  }

  for (const source of Array.isArray(map.sources) ? map.sources : []) {
    if (typeof source === 'string' && isAbsoluteLocalPath(source)) {
      findings.push(
        `${packageName}: ${rel} source contains absolute local path ${redactPath(source)}`,
      );
    }
  }

  return findings;
}

function isAbsoluteLocalPath(value) {
  return (
    value.startsWith('/') ||
    value.startsWith('file:///') ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.includes('/Users/') ||
    value.includes('/home/')
  );
}

function redactPath(value) {
  if (value.startsWith('/')) return '/...';
  if (/^[A-Za-z]:[\\/]/.test(value)) return `${value.slice(0, 2)}/...`;
  return value.replace(/file:\/\/\/[^"'\s]+/, 'file:///...');
}

function findHighEntropySecretLikeString(text) {
  const contextual =
    /\b(?:api[_-]?key|auth[_-]?token|client[_-]?secret|password|private[_-]?key|secret|token)\b[\s:=,."'`-]{0,24}([A-Za-z0-9+/_=-]{40,})/gi;
  for (const match of text.matchAll(contextual)) {
    const candidate = match[1];
    if (looksLikeSecret(candidate)) {
      return { label: `string near "${match[0].slice(0, 24)}..."` };
    }
  }
  return undefined;
}

function looksLikeSecret(value) {
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value)) return false;
  const counts = new Map();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy >= 4.5;
}

export function assertSnapshotMatches(actualSnapshot, expectedSnapshot) {
  const actual = stableJson(actualSnapshot);
  const expected = stableJson(expectedSnapshot);
  if (actual !== expected) {
    throw new Error(
      `Pack-security file snapshot drifted. Run pnpm run check:pack-security -- --write after reviewing the tarball diff.`,
    );
  }
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function compareStrings(left, right) {
  return left.localeCompare(right);
}

function packageDir(pkg) {
  return path.join(repoRoot, 'packages', pkg.dir);
}

function packPackage(pkg, destination) {
  const output = execFileSync('pnpm', ['pack', '--json', '--pack-destination', destination], {
    cwd: packageDir(pkg),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const result = parsePackJson(output, pkg.name);
  const filename = Array.isArray(result) ? result[0]?.filename : result.filename;
  if (!filename || typeof filename !== 'string') {
    throw new Error(`${pkg.name}: pnpm pack --json did not report a filename`);
  }
  return path.isAbsolute(filename) ? filename : path.join(destination, path.basename(filename));
}

export function parsePackJson(output, packageName = 'package') {
  const trimmed = output.trim();
  if (!trimmed) throw new Error(`${packageName}: pnpm pack --json produced no JSON output`);
  const candidates = [trimmed, ...trailingJsonCandidates(trimmed)];
  for (const candidate of candidates) {
    if (!candidate || (!candidate.startsWith('{') && !candidate.startsWith('['))) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Keep scanning in case lifecycle output preceded the JSON payload.
    }
  }
  throw new Error(`${packageName}: could not parse pnpm pack --json output`);
}

function trailingJsonCandidates(output) {
  const starts = [];
  for (let index = 0; index < output.length; index += 1) {
    const char = output[index];
    if (char === '{' || char === '[') starts.push(index);
  }
  return starts.reverse().map((index) => output.slice(index).trim());
}

function readTarball(tarballPath, extractBaseDir) {
  const extractDir = mkdtempSync(path.join(extractBaseDir, 'extract-'));
  mkdirSync(extractDir, { recursive: true });
  execFileSync('tar', ['-xzf', tarballPath, '-C', extractDir], { stdio: 'ignore' });
  const packageDir = path.join(extractDir, 'package');
  return walkFiles(packageDir)
    .map((diskPath) => {
      const rel = path.relative(packageDir, diskPath).replace(/\\/g, '/');
      return { diskPath, path: rel, size: statSync(diskPath).size };
    })
    .sort((left, right) => compareStrings(left.path, right.path));
}

function walkFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function createReader(files) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  return (rel) => {
    const file = byPath.get(rel);
    if (!file) return undefined;
    const bytes = file.bytes ?? readFileSync(file.diskPath);
    if (bytes.includes(0)) return undefined;
    return bytes.toString('utf8');
  };
}

function readPackedManifest(files, packageName) {
  const file = files.find((candidate) => candidate.path === 'package.json');
  if (!file) throw new Error(`${packageName}: tarball does not include package.json`);
  const bytes = file.bytes ?? readFileSync(file.diskPath);
  return JSON.parse(bytes.toString('utf8'));
}

function buildSnapshot(packages) {
  return {
    packages: Object.fromEntries(
      packages
        .map((pkg) => [pkg.name, pkg.files.map((file) => file.path).sort(compareStrings)])
        .sort(([left], [right]) => compareStrings(left, right)),
    ),
  };
}

function readSnapshot() {
  return JSON.parse(readFileSync(packSecuritySnapshotPath, 'utf8'));
}

function main() {
  const write = process.argv.includes('--write');
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'kovo-pack-security-'));
  const packedPackages = [];
  const findings = [];

  try {
    for (const pkg of publicPackages()) {
      const pkgJson = JSON.parse(readFileSync(path.join(packageDir(pkg), 'package.json'), 'utf8'));
      const plan = derivePublishPlan(pkgJson);
      console.log(`Packing ${pkg.name} for tarball security inspection...`);
      const tarballPath = packPackage(pkg, tempDir);
      const files = readTarball(tarballPath, tempDir);
      const manifest = readPackedManifest(files, pkg.name);
      const packageFindings = validatePackedPackage({
        files,
        manifest,
        packageName: pkg.name,
        readTextFile: createReader(files),
        targetFiles: plan.targetFiles,
      });
      findings.push(...packageFindings);
      packedPackages.push({ files, name: pkg.name });
      if (packageFindings.length === 0) {
        console.log(`OK ${pkg.name}: ${files.length} packed file(s) inspected`);
      }
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  if (findings.length > 0) {
    throw new Error(`Pack-security findings:\n  ${findings.join('\n  ')}`);
  }

  const snapshot = buildSnapshot(packedPackages);
  if (write) {
    writeFileSync(packSecuritySnapshotPath, stableJson(snapshot), 'utf8');
    console.log(`Wrote ${path.relative(repoRoot, packSecuritySnapshotPath)}`);
  } else {
    assertSnapshotMatches(snapshot, readSnapshot());
    console.log('Pack-security file snapshots match.');
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
) {
  main();
}
