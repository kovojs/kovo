#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import {
  readPackageTarballSnapshot,
  validatedPackageTarballEntries,
} from './lib/deterministic-tarball.mjs';
import { packWithoutLifecycleScripts } from './lib/pack-without-lifecycle.mjs';
import { derivePublishPlan, uiVendoredHelperSourcePaths } from './build-publish.mjs';
import { normalizePackageExports, resolveSourceExportTarget } from './package-exports.mjs';
import { publicPackages, repoRoot } from './public-packages.mjs';

export const packSecuritySnapshotPath = path.join(repoRoot, 'scripts', 'pack-security.files.json');
export const rootNpmConfigPath = path.join(repoRoot, '.npmrc');

const maxPackedFileBytes = 16 * 1024 * 1024;
const allowedTopLevelFiles = new Set([
  'package.json',
  'README.md',
  'LICENSE',
  'LICENSE.md',
  'NOTICE',
]);
const safeFirstPartyRegistry = 'https://registry.npmjs.org/';
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
const createKovoExampleManifestPath = 'dist/examples/manifest.json';
const createKovoExampleNames = ['commerce', 'crm'];
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

export function collectFirstPartyScopes(packageNames) {
  return [...new Set(packageNames.flatMap(scopeNameFromPackageName))].sort(compareStrings);
}

export function validateFirstPartyScopeRegistryPolicy({
  npmConfigText,
  npmConfigPath = '.npmrc',
  packageNames,
}) {
  const findings = [];
  const config = parseIniAssignments(npmConfigText);
  const scopes = collectFirstPartyScopes(packageNames).filter((scope) => scope.startsWith('@'));
  const unscoped = [...new Set(packageNames.filter((name) => !name.startsWith('@')))].sort(
    compareStrings,
  );
  const requiredRegistries = scopes.map((scope) => ({
    key: `${scope}:registry`,
    subject: `first-party scope ${scope}`,
  }));
  if (unscoped.length > 0) {
    requiredRegistries.push({
      key: 'registry',
      subject: `unscoped first-party package${unscoped.length === 1 ? '' : 's'} ${unscoped.join(', ')}`,
    });
  }

  for (const { key, subject } of requiredRegistries) {
    const configuredRegistry = config.get(key);
    if (!configuredRegistry) {
      findings.push(
        `${npmConfigPath}: missing ${key} pin; ${subject} must resolve from ${safeFirstPartyRegistry}`,
      );
      continue;
    }
    if (configuredRegistry.includes('${')) {
      findings.push(
        `${npmConfigPath}: ${key} must be a literal registry URL; got ${JSON.stringify(configuredRegistry)}`,
      );
      continue;
    }
    const normalizedRegistry = normalizeRegistryUrl(configuredRegistry);
    if (normalizedRegistry === undefined) {
      findings.push(
        `${npmConfigPath}: ${key} must be a valid registry URL; got ${JSON.stringify(configuredRegistry)}`,
      );
      continue;
    }
    if (normalizedRegistry !== safeFirstPartyRegistry) {
      findings.push(
        `${npmConfigPath}: ${key} must resolve to ${safeFirstPartyRegistry}; got ${normalizedRegistry}`,
      );
    }
  }

  return findings;
}

export function validatePackedPackage({
  allowedSourceFiles = [],
  files,
  manifest,
  packageName,
  readFileBytes,
  readTextFile,
  targetFiles,
}) {
  const findings = [];
  const fileSet = new Set(files.map((file) => file.path));
  const createKovoExampleAssets =
    packageName === 'create-kovo'
      ? validateCreateKovoExampleAssets({ files, readFileBytes, readTextFile })
      : { allowedSourceFiles: [], findings: [] };
  findings.push(...createKovoExampleAssets.findings);
  const allowedSourceFileSet = new Set([
    ...allowedSourceFiles,
    ...createKovoExampleAssets.allowedSourceFiles,
  ]);

  for (const target of targetFiles) {
    if (!packedTargetExists(target, files, fileSet)) {
      findings.push(`${packageName}: publish target missing from tarball: ${target}`);
    }
  }

  for (const file of files) {
    const rel = file.path;
    const base = path.posix.basename(rel);
    const segments = rel.split('/').map((segment) => segment.toLowerCase());
    const starterTemplate = isAllowedStarterTemplate(packageName, rel);

    if (base === '.env' || base.startsWith('.env.')) {
      findings.push(`${packageName}: tarball includes environment file ${rel}`);
    }

    const forbiddenSegment = segments.find((segment) => forbiddenPathSegments.has(segment));
    if (forbiddenSegment) {
      findings.push(`${packageName}: tarball includes ${forbiddenSegment} path ${rel}`);
    }

    const allowedSource = allowedSourceFileSet.has(rel);

    if (
      !rel.startsWith('dist/') &&
      !allowedTopLevelFiles.has(rel) &&
      !starterTemplate &&
      !allowedSource
    ) {
      findings.push(`${packageName}: unexpected top-level tarball file ${rel}`);
    }

    if (
      sourceFilePattern.test(rel) &&
      !declarationPattern.test(rel) &&
      !starterTemplate &&
      !allowedSource
    ) {
      findings.push(`${packageName}: unexpected source file ${rel}`);
    }

    if (file.size > maxPackedFileBytes) {
      findings.push(
        `${packageName}: oversized packed file ${rel} (${file.size} bytes, max ${maxPackedFileBytes})`,
      );
    }

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
    if (!packedTargetExists(target, files, fileSet)) {
      findings.push(`${packageName}: packed manifest target missing from tarball: ${target}`);
    }
  }

  if (packageName === '@kovojs/better-auth') {
    findings.push(...validateBetterAuthMountAuthorityPack({ manifest, readTextFile }));
  }
  if (packageName === '@kovojs/verify') {
    findings.push(...validateSelfContainedVerifierPack({ files, manifest, readTextFile }));
  }

  return findings;
}

/**
 * create-kovo ships authored example sources intentionally. The packed manifest is the only
 * source-file allowlist: it must be structurally trustworthy before any entry can bypass the
 * generic source rejection, and the tarball bytes are then checked independently against it.
 */
export function validateCreateKovoExampleAssets({ files, readFileBytes, readTextFile }) {
  const findings = [];
  const packedManifestFiles = files.filter((file) => file.path === createKovoExampleManifestPath);
  if (packedManifestFiles.length === 0) {
    return {
      allowedSourceFiles: [],
      findings: ['create-kovo: packed example asset manifest is missing'],
    };
  }
  if (packedManifestFiles.length !== 1) {
    return {
      allowedSourceFiles: [],
      findings: ['create-kovo: packed example asset manifest must appear exactly once'],
    };
  }

  const manifestText = readTextFile(createKovoExampleManifestPath);
  if (manifestText === undefined) {
    return {
      allowedSourceFiles: [],
      findings: ['create-kovo: packed example asset manifest bytes are unreadable'],
    };
  }

  let assetManifest;
  try {
    assetManifest = JSON.parse(manifestText);
  } catch {
    return {
      allowedSourceFiles: [],
      findings: ['create-kovo: packed example asset manifest is malformed JSON'],
    };
  }

  if (
    !isPlainObject(assetManifest) ||
    !hasExactKeys(assetManifest, ['examples', 'schema']) ||
    assetManifest.schema !== 'create-kovo-example-assets/v1' ||
    !isPlainObject(assetManifest.examples)
  ) {
    return {
      allowedSourceFiles: [],
      findings: ['create-kovo: packed example asset manifest has an invalid top-level shape'],
    };
  }

  const exampleNames = Object.keys(assetManifest.examples).sort(compareStrings);
  if (stableJson(exampleNames) !== stableJson(createKovoExampleNames)) {
    return {
      allowedSourceFiles: [],
      findings: [
        `create-kovo: packed example asset manifest must contain exactly ${createKovoExampleNames.join(', ')}`,
      ],
    };
  }

  const declaredFiles = new Map();
  let manifestShapeIsValid = true;
  for (const exampleName of createKovoExampleNames) {
    const example = assetManifest.examples[exampleName];
    if (
      !isPlainObject(example) ||
      !hasExactKeys(example, ['files']) ||
      !Array.isArray(example.files)
    ) {
      findings.push(
        `create-kovo: packed example asset manifest entry ${exampleName} must contain only a files array`,
      );
      manifestShapeIsValid = false;
      continue;
    }

    const seenRelativePaths = new Set();
    for (const [index, file] of example.files.entries()) {
      const label = `${exampleName}.files[${index}]`;
      if (
        !isPlainObject(file) ||
        !hasExactKeys(file, ['bytes', 'path', 'sha256']) ||
        !Number.isSafeInteger(file.bytes) ||
        file.bytes < 0 ||
        file.bytes > maxPackedFileBytes ||
        typeof file.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(file.sha256)
      ) {
        findings.push(`create-kovo: packed example asset metadata is invalid at ${label}`);
        manifestShapeIsValid = false;
        continue;
      }
      if (!isSafeCreateKovoExampleAssetPath(file.path)) {
        findings.push(
          `create-kovo: packed example asset manifest contains unsafe path at ${label}: ${String(file.path)}`,
        );
        manifestShapeIsValid = false;
        continue;
      }
      if (seenRelativePaths.has(file.path)) {
        findings.push(
          `create-kovo: packed example asset manifest duplicates ${exampleName}/${file.path}`,
        );
        manifestShapeIsValid = false;
        continue;
      }
      seenRelativePaths.add(file.path);
      declaredFiles.set(`dist/examples/${exampleName}/${file.path}`, file);
    }
  }

  if (!manifestShapeIsValid) {
    return { allowedSourceFiles: [], findings };
  }

  const packedAssetPaths = files
    .map((file) => file.path)
    .filter(
      (filePath) =>
        filePath.startsWith('dist/examples/') && filePath !== createKovoExampleManifestPath,
    );
  const packedAssetPathSet = new Set(packedAssetPaths);
  if (packedAssetPathSet.size !== packedAssetPaths.length) {
    const duplicatePaths = [
      ...new Set(
        packedAssetPaths.filter((filePath, index) => packedAssetPaths.indexOf(filePath) !== index),
      ),
    ].sort(compareStrings);
    for (const duplicatePath of duplicatePaths) {
      findings.push(`create-kovo: packed example asset appears more than once: ${duplicatePath}`);
    }
  }

  for (const packedPath of [...packedAssetPathSet].sort(compareStrings)) {
    if (!declaredFiles.has(packedPath)) {
      findings.push(`create-kovo: unlisted packed example asset ${packedPath}`);
    }
  }

  for (const [packedPath, expected] of [...declaredFiles.entries()].sort(([left], [right]) =>
    compareStrings(left, right),
  )) {
    if (!packedAssetPathSet.has(packedPath)) {
      findings.push(`create-kovo: declared packed example asset is missing: ${packedPath}`);
      continue;
    }
    const bytes = readFileBytes?.(packedPath);
    if (!Buffer.isBuffer(bytes)) {
      findings.push(`create-kovo: packed example asset bytes are unreadable: ${packedPath}`);
      continue;
    }
    if (bytes.byteLength !== expected.bytes) {
      findings.push(
        `create-kovo: packed example asset size mismatch for ${packedPath}: expected ${expected.bytes}, observed ${bytes.byteLength}`,
      );
    }
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== expected.sha256) {
      findings.push(`create-kovo: packed example asset SHA-256 mismatch for ${packedPath}`);
    }
  }

  return {
    allowedSourceFiles: [...declaredFiles.keys()]
      .filter((filePath) => sourceFilePattern.test(filePath) && !declarationPattern.test(filePath))
      .sort(compareStrings),
    findings,
  };
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  return (
    isPlainObject(value) &&
    stableJson(Object.keys(value).sort(compareStrings)) ===
      stableJson([...expectedKeys].sort(compareStrings))
  );
}

function isSafeCreateKovoExampleAssetPath(relativePath) {
  if (
    typeof relativePath !== 'string' ||
    relativePath.length === 0 ||
    relativePath.includes('\\') ||
    relativePath.includes('\0') ||
    path.posix.isAbsolute(relativePath)
  ) {
    return false;
  }
  const segments = relativePath.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return false;
  }
  const lower = relativePath.toLowerCase();
  return !(
    lower === '.env' ||
    lower.startsWith('.env.') ||
    lower.includes('/.env') ||
    lower === 'node_modules' ||
    lower.startsWith('node_modules/') ||
    lower.includes('/node_modules/') ||
    lower === '.git' ||
    lower.startsWith('.git/') ||
    lower.includes('/.git/') ||
    /(?:^|\/)(?:id_[rd]sa|.*\.(?:key|pem|p12|pfx))$/u.test(lower)
  );
}

/**
 * The certificate checker executes from its reviewer-hashed dist tree. Runtime dependencies would
 * reopen module resolution onto adjacent bytes that are not subjects of that reviewer policy.
 */
export function validateSelfContainedVerifierPack({ files, manifest, readTextFile }) {
  const findings = [];
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    const dependencies = manifest?.[field];
    if (
      dependencies !== undefined &&
      (typeof dependencies !== 'object' ||
        dependencies === null ||
        Array.isArray(dependencies) ||
        Object.keys(dependencies).length > 0)
    ) {
      findings.push(`@kovojs/verify: packed ${field} must be empty; parser bytes belong in dist`);
    }
  }
  if (!files.some((file) => file.path === 'NOTICE')) {
    findings.push('@kovojs/verify: packed NOTICE must retain the bundled parser license');
  }
  for (const file of files.filter((entry) => entry.path.endsWith('.mjs'))) {
    const source = readTextFile(file.path);
    if (source !== undefined && hasBareAcornImport(source)) {
      findings.push(
        `@kovojs/verify: ${file.path} resolves acorn outside reviewer-authenticated dist bytes`,
      );
    }
  }
  return findings;
}

function hasBareAcornImport(source) {
  return [
    /\bfrom\s*["']acorn(?:\/[^"']*)?["']/u,
    /\bimport\s*(?:\(\s*)?["']acorn(?:\/[^"']*)?["']/u,
    /\brequire\s*\(\s*["']acorn(?:\/[^"']*)?["']/u,
  ].some((pattern) => pattern.test(source));
}

/**
 * The Better Auth mount adapter mint is deliberately package-private. Node's exports map is the
 * packed-package enforcement boundary: no wildcard or deep adapter subpath may make the shared
 * implementation chunk importable, and the one server bridge may expose only validation and
 * invocation (SPEC §6.6/§9.1).
 */
export function validateBetterAuthMountAuthorityPack({ manifest, readTextFile }) {
  const findings = [];
  const exportsMap = manifest.exports;
  if (!exportsMap || typeof exportsMap !== 'object' || Array.isArray(exportsMap)) {
    return ['@kovojs/better-auth: packed manifest must declare an explicit exports map'];
  }

  const bridgeSubpath = './internal/server-mount-adapter';
  for (const [subpath, exportedTarget] of Object.entries(exportsMap)) {
    if (subpath.includes('*')) {
      findings.push(
        '@kovojs/better-auth: packed exports must not contain a wildcard that can expose the private mount-adapter chunk',
      );
    }
    if (subpath.includes('mount-adapter') && subpath !== bridgeSubpath) {
      findings.push(
        `@kovojs/better-auth: packed exports expose forbidden mount-adapter subpath ${subpath}`,
      );
    }
    if (
      subpath !== bridgeSubpath &&
      collectExportTargetStrings(exportedTarget).some((target) => target.includes('mount-adapter'))
    ) {
      findings.push(
        `@kovojs/better-auth: packed export ${subpath} targets the private mount-adapter implementation`,
      );
    }
  }

  const bridgeTargets = collectExportTargetStrings(exportsMap[bridgeSubpath]);
  if (bridgeTargets.length === 0) {
    findings.push(
      '@kovojs/better-auth: packed exports are missing the fixed server mount-adapter bridge',
    );
  }
  for (const target of bridgeTargets) {
    const rel = stripLeadingDot(target);
    const source = readTextFile(rel);
    if (source === undefined) {
      findings.push(`@kovojs/better-auth: packed server mount-adapter bridge is missing ${rel}`);
      continue;
    }
    if (source.includes('createBetterAuthMountAdapter')) {
      findings.push(
        `@kovojs/better-auth: packed server mount-adapter bridge ${rel} exposes the private adapter mint`,
      );
    }
  }

  return findings;
}

function collectExportTargetStrings(value) {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.values(value).flatMap(collectExportTargetStrings);
}

function isAllowedStarterTemplate(packageName, rel) {
  return packageName === 'create-kovo' && rel.startsWith('templates/');
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

function packedTargetExists(target, files, fileSet) {
  if (!target.includes('*')) return fileSet.has(target);
  const pattern = wildcardTargetPattern(target);
  return files.some((file) => pattern.test(file.path));
}

function wildcardTargetPattern(target) {
  const escaped = target.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]+');
  return new RegExp(`^${escaped}$`);
}

export function allowedPublishedSourceFiles(pkgJson) {
  if (pkgJson.name === '@kovojs/icons') return ['catalog.json'];
  if (pkgJson.name !== '@kovojs/ui') return [];

  const files = new Set(['catalog.json', 'registry.json']);
  for (const [subpath, target] of Object.entries(normalizePackageExports(pkgJson.exports))) {
    if (subpath === '.' || !subpath.startsWith('./')) continue;
    const sourceTarget = resolveSourceExportTarget(target);
    if (sourceTarget === null) continue;
    const sourceFile = sourceTarget.replace(/^\.\//, '');
    if (/^src\/[^/]+\.tsx$/.test(sourceFile)) files.add(sourceFile);
  }

  for (const helper of uiVendoredHelperSourcePaths) {
    files.add(helper);
  }

  return [...files].sort(compareStrings);
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

function scopeNameFromPackageName(packageName) {
  if (typeof packageName !== 'string' || !packageName.startsWith('@')) return [];
  const slashIndex = packageName.indexOf('/');
  if (slashIndex <= 1) return [];
  return [packageName.slice(0, slashIndex)];
}

function parseIniAssignments(text) {
  const assignments = new Map();
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    assignments.set(key, value);
  }
  return assignments;
}

function normalizeRegistryUrl(value) {
  try {
    const registryUrl = new URL(value);
    return registryUrl.toString();
  } catch {
    return undefined;
  }
}

function packageDir(pkg) {
  return path.join(repoRoot, 'packages', pkg.dir);
}

function packPackage(pkg, destination) {
  return packWithoutLifecycleScripts({ dirPath: packageDir(pkg), name: pkg.name }, destination);
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

function createReader(files) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  return (rel) => {
    const file = byPath.get(rel);
    if (!file) return undefined;
    const bytes = file.bytes ?? readFileSync(file.diskPath);
    return bytes.toString('utf8');
  };
}

function createByteReader(files) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  return (rel) => {
    const file = byPath.get(rel);
    if (!file) return undefined;
    return file.bytes ?? readFileSync(file.diskPath);
  };
}

function readPackedManifest(files, packageName) {
  const file = files.find((candidate) => candidate.path === 'package.json');
  if (!file) throw new Error(`${packageName}: tarball does not include package.json`);
  const bytes = file.bytes ?? readFileSync(file.diskPath);
  return JSON.parse(bytes.toString('utf8'));
}

export function buildPackSecuritySnapshot(packages) {
  return {
    packages: Object.fromEntries(
      packages
        .map((pkg) => [pkg.name, pkg.files.map((file) => file.path).sort(compareStrings)])
        .sort(([left], [right]) => compareStrings(left, right)),
    ),
  };
}

export function readPackSecuritySnapshot() {
  return JSON.parse(readFileSync(packSecuritySnapshotPath, 'utf8'));
}

/** Inspect entries returned by validatedPackageTarballEntries without a second extractor view. */
export function inspectValidatedPackedEntries({ entries, packageJson, packageName }) {
  const files = entries
    .map((entry) => ({
      bytes: entry.data,
      path: normalizePackedPath(entry.name),
      size: entry.data.byteLength,
    }))
    .sort((left, right) => compareStrings(left.path, right.path));
  return inspectPackedFiles({ files, packageJson, packageName });
}

function inspectPackedFiles({ files, packageJson, packageName }) {
  const plan = derivePublishPlan(packageJson);
  const manifest = readPackedManifest(files, packageName);
  const findings = validatePackedPackage({
    allowedSourceFiles: allowedPublishedSourceFiles(packageJson),
    files,
    manifest,
    packageName,
    readFileBytes: createByteReader(files),
    readTextFile: createReader(files),
    targetFiles: plan.targetFiles,
  });
  return { files, findings, manifest };
}

export function assertNoPackSecurityFindings(findings) {
  if (findings.length > 0) {
    throw new Error(`Pack-security findings:\n  ${findings.join('\n  ')}`);
  }
}

function readWorkspacePackageNames() {
  return readdirSync(path.join(repoRoot, 'packages'))
    .map((dir) => path.join(repoRoot, 'packages', dir, 'package.json'))
    .filter((manifestPath) => existsSync(manifestPath))
    .map((manifestPath) => JSON.parse(readFileSync(manifestPath, 'utf8')).name)
    .filter((name) => typeof name === 'string');
}

function main() {
  const write = process.argv.includes('--write');
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'kovo-pack-security-'));
  const packedPackages = [];
  const findings = validateFirstPartyScopeRegistryPolicy({
    npmConfigText: readFileSync(rootNpmConfigPath, 'utf8'),
    npmConfigPath: path.relative(repoRoot, rootNpmConfigPath),
    packageNames: readWorkspacePackageNames(),
  });

  try {
    for (const pkg of publicPackages()) {
      const pkgJson = JSON.parse(readFileSync(path.join(packageDir(pkg), 'package.json'), 'utf8'));
      console.log(`Packing ${pkg.name} for tarball security inspection...`);
      const tarballPath = packPackage(pkg, tempDir);
      const entries = validatedPackageTarballEntries(readPackageTarballSnapshot(tarballPath));
      const { files, findings: packageFindings } = inspectValidatedPackedEntries({
        entries,
        packageJson: pkgJson,
        packageName: pkg.name,
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

  assertNoPackSecurityFindings(findings);

  const snapshot = buildPackSecuritySnapshot(packedPackages);
  if (write) {
    writeFileSync(packSecuritySnapshotPath, stableJson(snapshot), 'utf8');
    console.log(`Wrote ${path.relative(repoRoot, packSecuritySnapshotPath)}`);
  } else {
    assertSnapshotMatches(snapshot, readPackSecuritySnapshot());
    console.log('Pack-security file snapshots match.');
  }
}

if (isMainEntry(import.meta.url)) await runGate(main);
