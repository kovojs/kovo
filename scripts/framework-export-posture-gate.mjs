#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { exportedSymbolsReport } from './exported-symbols.mjs';
import { declaredPackageExportSubpaths } from './package-exports.mjs';
import {
  apiBoundaryTier,
  loadPublicPackages,
  publicEntrySubpaths,
  repoRoot,
} from './public-packages.mjs';

export const FRAMEWORK_EXPORT_POSTURE_SCHEMA = 'kovo-framework-public-runtime-export-posture/v1';
export const FRAMEWORK_EXPORT_POSTURE_LEDGER = path.join(
  repoRoot,
  'security/framework-public-runtime-export-posture.json',
);
export const FRAMEWORK_EXPORT_POSTURE_GENERATED = path.join(
  repoRoot,
  'packages/compiler/src/security/framework-public-runtime-export-posture.generated.ts',
);

const FRAMEWORK_SOURCE_IMPLEMENTATION_PREFIX = 'kovo-source-tree-sha256:';
const FRAMEWORK_PACKED_IMPLEMENTATION_PREFIX = 'kovo-packed-tree-sha256:';
const FRAMEWORK_COMPILER_SELF_SOURCE_IMPLEMENTATION_PREFIX =
  'kovo-compiler-self-source-tree-sha256:';
const FRAMEWORK_COMPILER_SELF_PACKED_IMPLEMENTATION_PREFIX =
  'kovo-compiler-self-packed-tree-sha256:';
const FRAMEWORK_COMPILER_PACKAGE = '@kovojs/compiler';
const FRAMEWORK_COMPILER_SOURCE_CATALOG_FILE =
  'src/security/framework-public-runtime-export-posture.generated.ts';
const FRAMEWORK_COMPILER_PACKED_CATALOG_FILES = new Set([
  'dist/internal.mjs',
  'dist/internal.mjs.map',
]);

const rawCapabilities = new Set([
  'database-driver',
  'dynamic-loader',
  'filesystem',
  'network',
  'process',
  'vm',
  'worker',
]);
const dispositions = new Set(['authority-free', 'framework-door', 'request-closed']);
const rootKinds = new Set([
  'agent-tool-callback',
  'application',
  'durable-task',
  'endpoint',
  'layout',
  'mutation',
  'none',
  'query',
  'route',
  'serialized-browser-handler',
  'webhook',
]);
const securityRoles = new Set([
  'audit-introspection',
  'bootstrap-wiring',
  'capability-escape',
  'framework-door',
  'module-initializer',
  'ordinary-runtime',
  'request-closed',
  'root-factory',
  'secret-flow',
  'security-control',
  'sink-adapter',
  'trust-escape',
]);

/** Read the reviewer-authored first-party runtime export posture ledger. */
export function readFrameworkExportPostureLedger(fileName = FRAMEWORK_EXPORT_POSTURE_LEDGER) {
  return JSON.parse(readFileSync(fileName, 'utf8'));
}

/**
 * Compute the actual manifest-declared public runtime surface.
 *
 * Runtime membership comes from TypeScript symbol value flags, not text or naming conventions.
 * Every public subpath also gets an explicit `<module>` member for evaluation/side-effect posture.
 */
export function computeFrameworkRuntimeSurface({
  compilerPackedTreeSha256,
  includePackedImplementation = false,
} = {}) {
  const reportByPackage = new Map(exportedSymbolsReport().packages.map((pkg) => [pkg.name, pkg]));
  const packages = [];
  const emptyPackages = [];
  const findings = [];

  for (const declared of loadPublicPackages().filter((pkg) => pkg.visibility === 'public')) {
    const manifestPath = path.join(repoRoot, 'packages', declared.dir, 'package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const boundarySubpaths = [...publicEntrySubpaths(declared)].sort(compareStrings);
    const publicSubpaths = declaredPackageExportSubpaths(manifest)
      .filter((subpath) => apiBoundaryTier(declared, subpath) === 'public')
      .sort(compareStrings);
    if (canonicalJson(boundarySubpaths) !== canonicalJson(publicSubpaths)) {
      findings.push(
        `${declared.name}: public-packages.json public boundary differs from manifest-declared public exports`,
      );
    }
    const sourceTreeSha256 = productionSourceTreeSha256(
      path.join(repoRoot, 'packages', declared.dir),
      declared.name,
    );
    const identity = {
      implementationVariants: frameworkImplementationVariants(
        manifest,
        path.join(repoRoot, 'packages', declared.dir),
        sourceTreeSha256,
        includePackedImplementation,
        compilerPackedTreeSha256,
      ),
      packageName: declared.name,
      packageVersion: manifest.version,
      sourceTreeSha256,
    };
    if (publicSubpaths.length === 0) {
      emptyPackages.push({ ...identity, manifestVariants: manifestVariants(manifest) });
      continue;
    }

    const report = reportByPackage.get(declared.name);
    const entryBySubpath = new Map(report?.exports.map((entry) => [entry.subpath, entry]) ?? []);
    const members = {};
    for (const subpath of publicSubpaths) {
      const entry = entryBySubpath.get(subpath);
      if (entry === undefined) {
        findings.push(
          `${declared.name}${subpath}: public runtime source entry could not be inspected`,
        );
      }
      const runtimeNames =
        entry?.symbols
          .filter((symbol) => symbol.kind.split('+').includes('value'))
          .map((symbol) => symbol.name)
          .sort(compareStrings) ?? [];
      members[subpath] = ['<module>', ...runtimeNames];
    }
    packages.push({
      ...identity,
      manifestVariants: manifestVariants(manifest),
      members,
    });
  }

  return {
    emptyPackages: emptyPackages.sort(byPackageName),
    findings,
    packages: packages.sort(byPackageName),
  };
}

/** Expand the grouped reviewed ledger into exact compiler/threat-matrix rows. */
export function expandFrameworkExportPostureLedger(ledger) {
  const rows = [];
  for (const pkg of arrayOrEmpty(ledger?.packages)) {
    for (const group of arrayOrEmpty(pkg?.postureGroups)) {
      if (!isRecord(group?.members)) continue;
      for (const [subpath, names] of Object.entries(group.members)) {
        for (const name of arrayOrEmpty(names)) {
          rows.push({
            capabilities: arrayOrEmpty(group.capabilities),
            disposition: group.disposition,
            groupId: group.id,
            id: memberId(pkg.packageName, subpath, name),
            matrix: group.matrix,
            name,
            packageName: pkg.packageName,
            reason: group.reason,
            rootKind: group.rootKind,
            securityRole: group.securityRole,
            subpath,
          });
        }
      }
    }
  }
  return rows.sort((left, right) => compareStrings(left.id, right.id));
}

/**
 * Validate exact ledger equality with package manifests, public subpaths, conditional arms,
 * fingerprints, and TypeScript runtime exports. No new member receives a default disposition.
 */
export function validateFrameworkExportPosture({
  actual = computeFrameworkRuntimeSurface(),
  ledger = readFrameworkExportPostureLedger(),
} = {}) {
  const findings = [];
  if (!isRecord(ledger)) return ['framework export posture ledger must be an object'];
  if (ledger.schema !== FRAMEWORK_EXPORT_POSTURE_SCHEMA) {
    findings.push(`ledger schema must equal ${FRAMEWORK_EXPORT_POSTURE_SCHEMA}`);
  }
  if (
    !isNonBlank(ledger.summaryVersion) ||
    !/^kovo-framework-public-runtime-export-posture\/\d{4}-\d{2}-\d{2}\.\d+$/u.test(
      ledger.summaryVersion,
    )
  ) {
    findings.push('ledger summaryVersion must be an exact dated framework-posture version');
  }
  findings.push(...arrayOrEmpty(actual.findings));

  validateEmptyPackages(ledger.emptyPublicPackages, actual.emptyPackages, findings);
  const actualPackages = new Map(actual.packages.map((pkg) => [pkg.packageName, pkg]));
  const seenPackages = new Set();
  const ledgerRows = [];

  for (const [packageIndex, pkg] of arrayOrEmpty(ledger.packages).entries()) {
    const label = `packages[${packageIndex}]`;
    if (!isRecord(pkg) || !isNonBlank(pkg.packageName)) {
      findings.push(`${label}.packageName must be non-blank`);
      continue;
    }
    if (seenPackages.has(pkg.packageName)) {
      findings.push(`duplicate framework posture package: ${pkg.packageName}`);
    }
    seenPackages.add(pkg.packageName);
    const expected = actualPackages.get(pkg.packageName);
    if (expected === undefined) {
      findings.push(`stale/unknown framework posture package: ${pkg.packageName}`);
    } else {
      if (pkg.packageVersion !== expected.packageVersion) {
        findings.push(
          `${pkg.packageName}: reviewed version ${String(pkg.packageVersion)} is stale for ${expected.packageVersion}`,
        );
      }
      if (pkg.sourceTreeSha256 !== expected.sourceTreeSha256) {
        findings.push(`${pkg.packageName}: reviewed production source tree digest is stale`);
      }
      if (canonicalJson(pkg.manifestVariants) !== canonicalJson(expected.manifestVariants)) {
        findings.push(
          `${pkg.packageName}: manifest fingerprints, conditional export arms, or exact targets are stale`,
        );
      }
    }
    validatePostureGroups(pkg, label, ledgerRows, findings);
  }

  const missingPackages = [...actualPackages.keys()].filter((name) => !seenPackages.has(name));
  if (missingPackages.length > 0) {
    findings.push(
      `framework posture packages missing: ${missingPackages.sort(compareStrings).join(', ')}`,
    );
  }

  const expectedIds = actual.packages.flatMap((pkg) =>
    Object.entries(pkg.members).flatMap(([subpath, names]) =>
      names.map((name) => memberId(pkg.packageName, subpath, name)),
    ),
  );
  compareExactStringSet(
    ledgerRows.map((row) => row.id),
    expectedIds,
    'reviewed runtime posture members',
    findings,
  );

  const runtimeIds = expectedIds.filter((id) => !id.endsWith('\0<module>')).sort(compareStrings);
  const memberIds = [...expectedIds].sort(compareStrings);
  if (ledger.runtimeSurfaceSha256 !== stringDigest(runtimeIds)) {
    findings.push('runtimeSurfaceSha256 is stale for the manifest-declared runtime exports');
  }
  if (ledger.postureMemberSha256 !== stringDigest(memberIds)) {
    findings.push('postureMemberSha256 is stale for runtime exports plus <module> entries');
  }
  if (
    ledger.classificationSha256 !== classificationDigest(expandFrameworkExportPostureLedger(ledger))
  ) {
    findings.push(
      'classificationSha256 is stale for reviewed authority/root/security/matrix posture',
    );
  }

  return [...new Set(findings)].sort(compareStrings);
}

/** Render the compiler-owned, package-local index derived only from the reviewed ledger. */
export function renderFrameworkExportPostureGenerated(ledger, actual) {
  const groups = arrayOrEmpty(ledger.packages).flatMap((pkg) =>
    arrayOrEmpty(pkg.postureGroups).map((group) => [
      pkg.packageName,
      group.disposition,
      group.capabilities,
      group.rootKind,
      group.reason ?? null,
      Object.entries(group.members ?? {}).sort(([left], [right]) => compareStrings(left, right)),
    ]),
  );
  const actualByPackage = new Map(
    [...arrayOrEmpty(actual?.packages), ...arrayOrEmpty(actual?.emptyPackages)].map((pkg) => [
      pkg.packageName,
      pkg,
    ]),
  );
  const packages = [
    ...arrayOrEmpty(ledger.packages).map((pkg) => ({ ...pkg, empty: false })),
    ...arrayOrEmpty(ledger.emptyPublicPackages).map((pkg) => ({ ...pkg, empty: true })),
  ]
    .map((pkg) => {
      const subpaths = [
        ...new Set(
          arrayOrEmpty(pkg.postureGroups).flatMap((group) =>
            isRecord(group.members) ? Object.keys(group.members) : [],
          ),
        ),
      ].sort(compareStrings);
      const implementationByFingerprint = new Map(
        arrayOrEmpty(actualByPackage.get(pkg.packageName)?.implementationVariants).map(
          (variant) => [variant.fingerprint, variant.digests],
        ),
      );
      return [
        pkg.packageName,
        pkg.packageVersion,
        arrayOrEmpty(pkg.manifestVariants).map((variant) => [
          variant.fingerprint,
          subpaths.map((subpath) => [
            subpath,
            exportArmEvidence(variant.exports, subpath).conditions,
          ]),
          implementationByFingerprint.get(variant.fingerprint) ?? [],
        ]),
      ];
    })
    .sort(([left], [right]) => compareStrings(left, right));
  return [
    '// Generated from security/framework-public-runtime-export-posture.json.',
    '// Do not edit by hand. Run `node scripts/framework-export-posture-gate.mjs --write-generated`',
    '// only after reviewing the ledger diff. SPEC.md §6.6; compiler rule 10.',
    '',
    "import type { CapabilityRootKind, RawCapabilityKind } from './capability-closure-model.js';",
    '',
    'export type FrameworkExportPostureDisposition =',
    "  | 'authority-free'",
    "  | 'framework-door'",
    "  | 'request-closed';",
    "export type FrameworkExportPostureRootKind = CapabilityRootKind | 'none';",
    'export type FrameworkExportPosturePackage = readonly [',
    '  packageName: string,',
    '  packageVersion: string,',
    '  manifestVariants: readonly (readonly [',
    '    fingerprint: string,',
    '    subpaths: readonly (readonly [subpath: string, conditions: readonly string[]])[],',
    '    implementationDigests: readonly string[],',
    '  ])[],',
    '];',
    'export type FrameworkExportPostureGroup = readonly [',
    '  packageName: string,',
    '  disposition: FrameworkExportPostureDisposition,',
    '  capabilities: readonly RawCapabilityKind[],',
    '  rootKind: FrameworkExportPostureRootKind,',
    '  reason: string | null,',
    '  members: readonly (readonly [subpath: string, names: readonly string[]])[],',
    '];',
    '',
    'export const frameworkExportPostureSummaryVersion =',
    `  ${quoteTypeScriptString(ledger.summaryVersion)} as const;`,
    '',
    '// Compact generated closed membership; expanded formatting triples parse input.',
    '// prettier-ignore',
    `export const frameworkExportPosturePackages: readonly FrameworkExportPosturePackage[] = ${renderGeneratedPackages(packages)};`,
    '',
    '// Compact generated closed membership; expanded formatting triples parse input.',
    '// prettier-ignore',
    `export const frameworkExportPostureGroups: readonly FrameworkExportPostureGroup[] = ${renderGeneratedGroups(groups)};`,
    '',
  ].join('\n');
}

function quoteTypeScriptString(value) {
  const json = JSON.stringify(String(value));
  return `'${json.slice(1, -1).replaceAll('\\"', '"').replaceAll("'", "\\'")}'`;
}

function renderGeneratedPackages(packages) {
  const rendered = packages.map(([name, version, variants]) => {
    const renderedVariants = variants.map(
      ([fingerprint, subpaths, implementationDigests]) =>
        `    [${JSON.stringify(fingerprint)}, [\n${subpaths
          .map((row) => `      ${JSON.stringify(row)},`)
          .join('\n')}\n    ], ${JSON.stringify(implementationDigests)}],`,
    );
    return `  [${JSON.stringify(name)}, ${JSON.stringify(version)}, [\n${renderedVariants.join('\n')}\n  ]],`;
  });
  return `[\n${rendered.join('\n')}\n]`;
}

function renderGeneratedGroups(groups) {
  const rendered = groups.map(
    ([packageName, disposition, capabilities, rootKind, reason, members]) =>
      `  [${JSON.stringify(packageName)}, ${JSON.stringify(disposition)}, ${JSON.stringify(capabilities)}, ${JSON.stringify(rootKind)}, ${JSON.stringify(reason)}, [\n${members
        .map((row) => `    ${JSON.stringify(row)},`)
        .join('\n')}\n  ]],`,
  );
  return `[\n${rendered.join('\n')}\n]`;
}

function validateEmptyPackages(rows, expectedRows, findings) {
  const actualByName = new Map(expectedRows.map((row) => [row.packageName, row]));
  const seen = new Set();
  for (const [index, row] of arrayOrEmpty(rows).entries()) {
    const label = `emptyPublicPackages[${index}]`;
    if (!isRecord(row) || !isNonBlank(row.packageName)) {
      findings.push(`${label}.packageName must be non-blank`);
      continue;
    }
    if (seen.has(row.packageName))
      findings.push(`duplicate empty public package: ${row.packageName}`);
    seen.add(row.packageName);
    const expected = actualByName.get(row.packageName);
    if (expected === undefined) {
      findings.push(`stale empty public package posture: ${row.packageName}`);
      continue;
    }
    if (row.packageVersion !== expected.packageVersion) {
      findings.push(`${row.packageName}: empty-package version is stale`);
    }
    if (row.sourceTreeSha256 !== expected.sourceTreeSha256) {
      findings.push(`${row.packageName}: empty-package production source tree digest is stale`);
    }
    if (canonicalJson(row.manifestVariants) !== canonicalJson(expected.manifestVariants)) {
      findings.push(`${row.packageName}: empty-package manifest variants are stale`);
    }
  }
  const missing = [...actualByName.keys()].filter((name) => !seen.has(name));
  if (missing.length > 0) findings.push(`empty public packages missing: ${missing.join(', ')}`);
}

function validatePostureGroups(pkg, packageLabel, rows, findings) {
  const seenGroups = new Set();
  const seenMembers = new Set();
  for (const [groupIndex, group] of arrayOrEmpty(pkg.postureGroups).entries()) {
    const label = `${packageLabel}.postureGroups[${groupIndex}]`;
    if (!isRecord(group) || !isNonBlank(group.id)) {
      findings.push(`${label}.id must be non-blank`);
      continue;
    }
    if (seenGroups.has(group.id))
      findings.push(`${pkg.packageName}: duplicate posture group ${group.id}`);
    seenGroups.add(group.id);
    if (!dispositions.has(group.disposition)) {
      findings.push(`${label}.disposition is unknown: ${String(group.disposition)}`);
    }
    const capabilities = stringArray(group.capabilities, `${label}.capabilities`, findings);
    for (const capability of capabilities) {
      if (!rawCapabilities.has(capability))
        findings.push(`${label}: unknown capability ${capability}`);
    }
    if (group.disposition === 'authority-free' && capabilities.length > 0) {
      findings.push(`${label}: authority-free posture cannot carry raw capabilities`);
    }
    if (group.disposition === 'framework-door' && capabilities.length === 0) {
      findings.push(`${label}: framework-door posture must name raw capabilities`);
    }
    if (group.disposition === 'request-closed' && !isNonBlank(group.reason)) {
      findings.push(`${label}: request-closed posture must explain why it closes`);
    }
    if (!rootKinds.has(group.rootKind)) {
      findings.push(`${label}.rootKind must explicitly name a supported root kind or none`);
    }
    if (group.disposition === 'request-closed' && group.rootKind !== 'none') {
      findings.push(`${label}: request-closed members cannot mint an active root factory`);
    }
    if (!securityRoles.has(group.securityRole)) {
      findings.push(`${label}.securityRole must explicitly name a reviewed role`);
    }
    validateReview(group.review, `${label}.review`, findings);
    validateMatrixPosture(group.matrix, `${label}.matrix`, findings);
    if (!isRecord(group.members)) {
      findings.push(`${label}.members must be an object`);
      continue;
    }
    for (const [subpath, names] of Object.entries(group.members)) {
      if (!isNonBlank(subpath)) findings.push(`${label}.members has a blank subpath`);
      for (const name of stringArray(names, `${label}.members[${subpath}]`, findings)) {
        const id = memberId(pkg.packageName, subpath, name);
        if (seenMembers.has(id)) findings.push(`duplicate reviewed runtime posture member: ${id}`);
        seenMembers.add(id);
        rows.push({ id });
      }
    }
  }
}

function validateReview(review, label, findings) {
  if (!isRecord(review)) {
    findings.push(`${label} must be an object`);
    return;
  }
  if (!isNonBlank(review.id)) findings.push(`${label}.id must be non-blank`);
  if (!isNonBlank(review.basis)) findings.push(`${label}.basis must be non-blank`);
  const evidence = stringArray(review.evidence, `${label}.evidence`, findings);
  if (evidence.length === 0) findings.push(`${label}.evidence must not be empty`);
  for (const entry of evidence) {
    const absolute = path.resolve(repoRoot, entry);
    const relative = path.relative(repoRoot, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !existsSync(absolute)) {
      findings.push(`${label}: stale or escaping evidence path ${entry}`);
    }
  }
}

function validateMatrixPosture(matrix, label, findings) {
  if (!isRecord(matrix) || !isNonBlank(matrix.surface)) {
    findings.push(`${label}.surface must be non-blank`);
    return;
  }
  if (!isRecord(matrix.cells) || Object.keys(matrix.cells).length === 0) {
    findings.push(`${label}.cells must be a non-empty object`);
    return;
  }
  for (const [category, proof] of Object.entries(matrix.cells)) {
    if (!['A', 'Au', 'C', 'I'].includes(category)) {
      findings.push(`${label}.cells has unknown threat category ${category}`);
    }
    if (!isNonBlank(proof)) findings.push(`${label}.cells.${category} must name a proof`);
  }
}

function manifestVariants(manifest) {
  const variants = manifestVariantCandidates(manifest).map((variant) => ({
    exports: variant.exports,
    fingerprint: capabilityManifestFingerprint(variant),
  }));
  return [...new Map(variants.map((variant) => [variant.fingerprint, variant])).values()].sort(
    (left, right) => compareStrings(left.fingerprint, right.fingerprint),
  );
}

function manifestVariantCandidates(manifest) {
  return [
    manifest,
    {
      ...manifest,
      ...(isRecord(manifest.publishConfig) ? manifest.publishConfig : {}),
    },
  ];
}

function frameworkImplementationVariants(
  manifest,
  packageRoot,
  sourceTreeSha256,
  includePackedImplementation,
  compilerPackedTreeSha256,
) {
  const candidates = manifestVariantCandidates(manifest);
  const packedTreeSha256 = includePackedImplementation
    ? manifest.name === FRAMEWORK_COMPILER_PACKAGE && compilerPackedTreeSha256 !== undefined
      ? compilerPackedTreeSha256
      : productionPackedTreeSha256(packageRoot, manifest.name)
    : undefined;
  const byFingerprint = new Map();
  for (const [index, candidate] of candidates.entries()) {
    const fingerprint = capabilityManifestFingerprint(candidate);
    const digest =
      index === 0
        ? `${manifest.name === FRAMEWORK_COMPILER_PACKAGE ? FRAMEWORK_COMPILER_SELF_SOURCE_IMPLEMENTATION_PREFIX : FRAMEWORK_SOURCE_IMPLEMENTATION_PREFIX}${sourceTreeSha256}`
        : packedTreeSha256 === undefined
          ? undefined
          : `${manifest.name === FRAMEWORK_COMPILER_PACKAGE ? FRAMEWORK_COMPILER_SELF_PACKED_IMPLEMENTATION_PREFIX : FRAMEWORK_PACKED_IMPLEMENTATION_PREFIX}${packedTreeSha256}`;
    if (digest === undefined) continue;
    const digests = byFingerprint.get(fingerprint) ?? new Set();
    digests.add(digest);
    byFingerprint.set(fingerprint, digests);
  }
  return [...byFingerprint.entries()]
    .map(([fingerprint, digests]) => ({
      digests: [...digests].sort(compareStrings),
      fingerprint,
    }))
    .sort((left, right) => compareStrings(left.fingerprint, right.fingerprint));
}

function capabilityManifestFingerprint(manifest) {
  const securityShape = {
    exports: ownValue(manifest, 'exports'),
    imports: ownValue(manifest, 'imports'),
    main: ownValue(manifest, 'main'),
    module: ownValue(manifest, 'module'),
    name: ownValue(manifest, 'name'),
    type: ownValue(manifest, 'type'),
    version: ownValue(manifest, 'version'),
  };
  return `sha256:${createHash('sha256').update(canonicalJson(securityShape)).digest('hex')}`;
}

export function productionSourceTreeSha256(
  packageRoot,
  packageName,
  readSourceFile = readFileSync,
) {
  const sourceRoot = path.join(packageRoot, 'src');
  if (!existsSync(sourceRoot)) {
    throw new Error(`framework source implementation is missing ${sourceRoot}`);
  }
  if (!lstatSync(sourceRoot).isDirectory()) {
    throw new Error(`framework source implementation root is not a directory ${sourceRoot}`);
  }
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`framework source implementation contains non-file entry ${absolute}`);
      }
      files.push(absolute);
    }
  };
  visit(sourceRoot);
  files.sort(compareStrings);
  const hash = createHash('sha256');
  let normalizedCompilerCatalog = false;
  for (const fileName of files) {
    const relativeFileName = path.relative(packageRoot, fileName).split(path.sep).join('/');
    const input = readSourceFile(fileName);
    let sourceBytes = Buffer.isBuffer(input) ? Buffer.from(input) : Buffer.from(input);
    if (
      packageName === FRAMEWORK_COMPILER_PACKAGE &&
      relativeFileName === FRAMEWORK_COMPILER_SOURCE_CATALOG_FILE
    ) {
      const normalized = normalizeCompilerCatalogSelfDigestBytes(sourceBytes);
      requireExactCompilerSelfDigestMarkers(normalized, relativeFileName);
      sourceBytes = normalized.bytes;
      normalizedCompilerCatalog = true;
    } else if (countFrameworkImplementationDigestMarkers(sourceBytes) > 0) {
      throw new Error(
        `framework implementation digest marker escaped the compiler's exact generated catalog artifact: ${relativeFileName}`,
      );
    }
    hash.update(relativeFileName);
    hash.update('\0');
    hash.update(sourceBytes);
    hash.update('\0');
  }
  if (packageName === FRAMEWORK_COMPILER_PACKAGE && !normalizedCompilerCatalog) {
    throw new Error(
      'compiler source implementation is missing its exact generated catalog artifact',
    );
  }
  return hash.digest('hex');
}

/**
 * Exact packed-package implementation identity. Every shipped dist byte participates. Only the
 * reviewed compiler catalog artifact census receives the two self-payload normalizations; the
 * whole-package marker scan rejects those payloads anywhere else.
 */
export function productionPackedTreeSha256(
  packageRoot,
  packageName,
  readImplementationFile = readFileSync,
) {
  const distRoot = path.join(packageRoot, 'dist');
  if (!existsSync(distRoot)) {
    throw new Error(`packed framework implementation is missing ${distRoot}`);
  }
  if (!lstatSync(distRoot).isDirectory()) {
    throw new Error(`packed framework implementation root is not a directory ${distRoot}`);
  }
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`packed framework implementation contains non-file entry ${absolute}`);
      }
      files.push(absolute);
    }
  };
  visit(distRoot);
  files.sort(compareStrings);
  const hash = createHash('sha256');
  const normalizedCompilerCatalogs = new Set();
  for (const fileName of files) {
    const relativeFileName = path.relative(packageRoot, fileName).split(path.sep).join('/');
    const input = readImplementationFile(fileName);
    let implementationBytes = Buffer.isBuffer(input) ? Buffer.from(input) : Buffer.from(input);
    const isCompilerCatalog =
      packageName === FRAMEWORK_COMPILER_PACKAGE &&
      FRAMEWORK_COMPILER_PACKED_CATALOG_FILES.has(relativeFileName);
    if (isCompilerCatalog) {
      const normalized = normalizeCompilerCatalogSelfDigestBytes(implementationBytes);
      requireExactCompilerSelfDigestMarkers(normalized, relativeFileName);
      implementationBytes = normalized.bytes;
      normalizedCompilerCatalogs.add(relativeFileName);
    } else if (countFrameworkImplementationDigestMarkers(implementationBytes) > 0) {
      throw new Error(
        `framework implementation digest marker escaped the compiler's exact generated catalog artifact: ${relativeFileName}`,
      );
    }
    hash.update(relativeFileName);
    hash.update('\0');
    hash.update(implementationBytes);
    hash.update('\0');
  }
  if (
    packageName === FRAMEWORK_COMPILER_PACKAGE &&
    normalizedCompilerCatalogs.size !== FRAMEWORK_COMPILER_PACKED_CATALOG_FILES.size
  ) {
    throw new Error(
      'compiler packed implementation is missing a reviewed generated catalog artifact',
    );
  }
  return hash.digest('hex');
}

function normalizeCompilerCatalogSelfDigestBytes(input) {
  const bytes = Buffer.from(input);
  const sourceMatches = normalizeDigestPayloads(
    bytes,
    FRAMEWORK_COMPILER_SELF_SOURCE_IMPLEMENTATION_PREFIX,
  );
  const packedMatches = normalizeDigestPayloads(
    bytes,
    FRAMEWORK_COMPILER_SELF_PACKED_IMPLEMENTATION_PREFIX,
  );
  return { bytes, packedMatches, sourceMatches };
}

function requireExactCompilerSelfDigestMarkers(normalized, relativeFileName) {
  if (normalized.sourceMatches !== 1 || normalized.packedMatches !== 1) {
    throw new Error(
      `compiler catalog ${relativeFileName} contains source=${normalized.sourceMatches} packed=${normalized.packedMatches} self-digest payloads; expected exactly one each`,
    );
  }
}

function normalizeDigestPayloads(bytes, prefix) {
  const prefixBytes = Buffer.from(prefix);
  let matches = 0;
  let offset = 0;
  while (offset < bytes.length) {
    const found = bytes.indexOf(prefixBytes, offset);
    if (found < 0) break;
    const start = found + prefixBytes.length;
    const end = start + 64;
    const candidate = bytes.subarray(start, end).toString('ascii');
    const next = bytes[end];
    if (/^[a-f0-9]{64}$/u.test(candidate) && (next === undefined || !isLowerHexByte(next))) {
      bytes.fill(0x30, start, end);
      matches += 1;
    }
    offset = Math.max(end, found + 1);
  }
  return matches;
}

function countFrameworkImplementationDigestMarkers(input) {
  return [
    FRAMEWORK_SOURCE_IMPLEMENTATION_PREFIX,
    FRAMEWORK_PACKED_IMPLEMENTATION_PREFIX,
    FRAMEWORK_COMPILER_SELF_SOURCE_IMPLEMENTATION_PREFIX,
    FRAMEWORK_COMPILER_SELF_PACKED_IMPLEMENTATION_PREFIX,
  ].reduce((count, prefix) => count + countDigestPayloads(input, prefix), 0);
}

function countDigestPayloads(input, prefix) {
  const bytes = Buffer.from(input);
  const prefixBytes = Buffer.from(prefix);
  let matches = 0;
  let offset = 0;
  while (offset < bytes.length) {
    const found = bytes.indexOf(prefixBytes, offset);
    if (found < 0) break;
    const start = found + prefixBytes.length;
    const end = start + 64;
    const candidate = bytes.subarray(start, end).toString('ascii');
    const next = bytes[end];
    if (/^[a-f0-9]{64}$/u.test(candidate) && (next === undefined || !isLowerHexByte(next))) {
      matches += 1;
    }
    offset = Math.max(end, found + 1);
  }
  return matches;
}

function isLowerHexByte(value) {
  return (value >= 0x30 && value <= 0x39) || (value >= 0x61 && value <= 0x66);
}

function exportArmEvidence(exportsValue, subpath) {
  const target = selectExportTarget(exportsValue, subpath);
  if (target === undefined || target === null) return { conditions: [], target: null };
  const conditions = new Set();
  const resolved = collectExportConditions(target, conditions);
  if (!resolved) return { conditions: [], target };
  if (conditions.size === 0) conditions.add('default');
  return { conditions: [...conditions].sort(compareStrings), target };
}

function selectExportTarget(exportsValue, subpath) {
  if (!isRecord(exportsValue)) return subpath === '.' ? exportsValue : undefined;
  const keys = Object.keys(exportsValue);
  const hasSubpaths = keys.some((key) => key === '.' || key.startsWith('./'));
  if (!hasSubpaths) return subpath === '.' ? exportsValue : undefined;
  if (Object.hasOwn(exportsValue, subpath)) return ownValue(exportsValue, subpath);
  const pattern = keys
    .filter((key) => key.includes('*') && exportPatternMatches(key, subpath))
    .sort((left, right) => exportPatternSpecificity(right) - exportPatternSpecificity(left))[0];
  return pattern === undefined ? undefined : ownValue(exportsValue, pattern);
}

function collectExportConditions(value, conditions) {
  if (typeof value === 'string') return value.length > 0;
  if (value === null) return false;
  if (Array.isArray(value)) {
    let found = false;
    for (const entry of value) found = collectExportConditions(entry, conditions) || found;
    return found;
  }
  if (!isRecord(value)) return false;
  let found = false;
  for (const key of Object.keys(value)) {
    if (key === '.' || key.startsWith('./')) return false;
    conditions.add(key);
    found = collectExportConditions(ownValue(value, key), conditions) || found;
  }
  return found;
}

function exportPatternMatches(pattern, subpath) {
  const star = pattern.indexOf('*');
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  return subpath.startsWith(prefix) && subpath.endsWith(suffix);
}

function exportPatternSpecificity(pattern) {
  return pattern.replace('*', '').length;
}

function compareExactStringSet(actual, expected, label, findings) {
  const actualValues = stringArray(actual, label, findings);
  const actualSet = new Set(actualValues);
  const expectedSet = new Set(expected);
  const missing = [...expectedSet].filter((value) => !actualSet.has(value));
  const stale = [...actualSet].filter((value) => !expectedSet.has(value));
  if (missing.length > 0) findings.push(`${label} missing: ${summarize(missing)}`);
  if (stale.length > 0) findings.push(`${label} stale/unknown: ${summarize(stale)}`);
}

function stringArray(value, label, findings) {
  if (!Array.isArray(value)) {
    findings.push(`${label} must be an array`);
    return [];
  }
  const result = [];
  const seen = new Set();
  for (const entry of value) {
    if (!isNonBlank(entry)) {
      findings.push(`${label} entries must be non-blank strings`);
      continue;
    }
    if (seen.has(entry)) findings.push(`${label} contains duplicate ${entry}`);
    seen.add(entry);
    result.push(entry);
  }
  return result;
}

function stringDigest(values) {
  return createHash('sha256').update(values.join('\n')).digest('hex');
}

function classificationDigest(rows) {
  return createHash('sha256')
    .update(
      canonicalJson(
        rows.map((row) => ({
          capabilities: row.capabilities,
          disposition: row.disposition,
          id: row.id,
          matrix: row.matrix,
          reason: row.reason ?? null,
          rootKind: row.rootKind,
          securityRole: row.securityRole,
        })),
      ),
    )
    .digest('hex');
}

function memberId(packageName, subpath, name) {
  return `${packageName}\0${subpath}\0${name}`;
}

function summarize(values) {
  const sorted = [...values].sort(compareStrings);
  return `${sorted.slice(0, 12).join(', ')}${sorted.length > 12 ? ` (+${sorted.length - 12} more)` : ''}`;
}

function canonicalJson(value) {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .filter((key) => ownValue(value, key) !== undefined)
      .sort(compareStrings)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(ownValue(value, key))}`);
    return `{${entries.join(',')}}`;
  }
  if (value === undefined) return 'null';
  throw new TypeError(`unsupported canonical JSON value: ${typeof value}`);
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function ownValue(value, key) {
  return isRecord(value) ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonBlank(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function byPackageName(left, right) {
  return compareStrings(left.packageName, right.packageName);
}

function buildFrameworkPackedArtifacts(packageNames) {
  for (const packageName of packageNames) {
    try {
      execFileSync('pnpm', ['--filter', packageName, 'run', 'build:dist'], {
        cwd: repoRoot,
        stdio: 'pipe',
      });
    } catch (error) {
      const stderr = Buffer.isBuffer(error?.stderr)
        ? error.stderr.toString('utf8').trim()
        : String(error?.stderr ?? '').trim();
      throw new Error(
        `failed to build exact packed implementation for ${packageName}${stderr === '' ? '' : `: ${stderr}`}`,
      );
    }
  }
}

function generatedPostureState(ledger) {
  const actual = computeFrameworkRuntimeSurface({ includePackedImplementation: true });
  return {
    actual,
    findings: validateFrameworkExportPosture({ actual, ledger }),
    generated: renderFrameworkExportPostureGenerated(ledger, actual),
  };
}

export function run(args = process.argv.slice(2)) {
  const ledger = readFrameworkExportPostureLedger();
  const writeGenerated = args.includes('--write-generated');
  const packageNames = loadPublicPackages()
    .filter((pkg) => pkg.visibility === 'public')
    .map((pkg) => pkg.name)
    .sort(compareStrings);
  let state;
  const findings = [];
  if (writeGenerated) {
    const sourceActual = computeFrameworkRuntimeSurface();
    findings.push(...validateFrameworkExportPosture({ actual: sourceActual, ledger }));
    if (findings.length === 0) {
      try {
        buildFrameworkPackedArtifacts(
          packageNames.filter((packageName) => packageName !== FRAMEWORK_COMPILER_PACKAGE),
        );
        const bootstrapActual = computeFrameworkRuntimeSurface({
          compilerPackedTreeSha256: '0'.repeat(64),
          includePackedImplementation: true,
        });
        writeFileSync(
          FRAMEWORK_EXPORT_POSTURE_GENERATED,
          renderFrameworkExportPostureGenerated(ledger, bootstrapActual),
        );
        buildFrameworkPackedArtifacts([FRAMEWORK_COMPILER_PACKAGE]);
        state = generatedPostureState(ledger);
        findings.push(...state.findings);
      } catch (error) {
        findings.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (state === undefined) state = { actual: sourceActual, findings, generated: '' };
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (findings.length > 0) break;
      const current = existsSync(FRAMEWORK_EXPORT_POSTURE_GENERATED)
        ? readFileSync(FRAMEWORK_EXPORT_POSTURE_GENERATED, 'utf8')
        : '';
      if (current === state.generated) break;
      writeFileSync(FRAMEWORK_EXPORT_POSTURE_GENERATED, state.generated);
      buildFrameworkPackedArtifacts(['@kovojs/compiler']);
      state = generatedPostureState(ledger);
      findings.push(...state.findings);
    }
    if (
      findings.length === 0 &&
      readFileSync(FRAMEWORK_EXPORT_POSTURE_GENERATED, 'utf8') !== state.generated
    ) {
      findings.push('generated compiler posture implementation digest did not reach a fixed point');
    }
  } else {
    try {
      buildFrameworkPackedArtifacts(packageNames);
      state = generatedPostureState(ledger);
      findings.push(...state.findings);
      if (
        !existsSync(FRAMEWORK_EXPORT_POSTURE_GENERATED) ||
        readFileSync(FRAMEWORK_EXPORT_POSTURE_GENERATED, 'utf8') !== state.generated
      ) {
        findings.push(
          'generated compiler posture index is stale; review the ledger, then run node scripts/framework-export-posture-gate.mjs --write-generated',
        );
      }
    } catch (error) {
      findings.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (findings.length > 0) {
    process.stderr.write(`${findings.sort(compareStrings).join('\n')}\n`);
    return 1;
  }
  const rows = expandFrameworkExportPostureLedger(ledger);
  const runtimeCount = rows.filter((row) => row.name !== '<module>').length;
  process.stdout.write(
    `framework-export-posture/v1 packages=${state?.actual.packages.length ?? 0} subpaths=${rows.length - runtimeCount} runtime=${runtimeCount} OK\n`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run();
}
