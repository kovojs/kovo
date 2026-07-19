#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { classifyRawCapabilityModuleSpecifier } from '../packages/compiler/src/security/capability-closure-model.ts';
import {
  certificateProbePackageConfigs,
  certificateProbePackageNames,
  probePublishedModuleIdentity,
} from './certificate-module-identity-probe.mjs';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { normalizePackageExports, resolveExportTarget } from './package-exports.mjs';
import { collectFiles } from './lib/source-files.mjs';
import { repoRoot } from './public-packages.mjs';

export const kovoCertificatePath = path.join(repoRoot, 'security', 'kovo-certificate-v1.json');
export const kovoCertificateLexicalAuthorityPath = path.join(
  repoRoot,
  'security',
  'certificate-lexical-authority.json',
);
export const kovoCertificateDoorPosturePath = path.join(
  repoRoot,
  'security',
  'certificate-door-posture.json',
);

const packSnapshotPath = path.join(repoRoot, 'scripts', 'pack-security.files.json');
const posturePath = path.join(repoRoot, 'security', 'framework-public-runtime-export-posture.json');

export const kovoCertificateCapabilityDomain = Object.freeze([
  'database-driver',
  'dynamic-loader',
  'filesystem',
  'network',
  'process',
  'vm',
  'worker',
]);

const lexicalRoutes = Object.freeze([
  ['re-exported-bindings', 'modeled'],
  ['computed-dynamic-import', 'modeled'],
  ['eval', 'plan-3-4.6'],
  ['new-function', 'plan-3-4.6'],
  ['host-globals', 'plan-3-4.6'],
  ['native-addons', 'modeled-and-plan-3-4.6'],
  ['wasm', 'modeled-and-plan-3-4.6'],
]);

/**
 * Search-side certificate generation. This is deliberately allowed a fixpoint; the disjoint
 * `@kovojs/verify` checker is not. Published module extraction stays in the TypeScript probe while
 * the checker re-parses bytes with its sole pinned parser dependency (Plan 3 §2.1).
 */
export function generateKovoCertificate({
  internalDoorPosture = JSON.parse(readFileSync(kovoCertificateDoorPosturePath, 'utf8')),
  packageConfigs = certificateProbePackageConfigs(repoRoot),
  posture = JSON.parse(readFileSync(posturePath, 'utf8')),
  seedPackageNames = certificateProbePackageNames,
  snapshot = JSON.parse(readFileSync(packSnapshotPath, 'utf8')),
} = {}) {
  const configsByName = new Map(packageConfigs.map((config) => [config.name, config]));
  for (const packageName of seedPackageNames) {
    if (!configsByName.has(packageName)) {
      throw new Error(`Certificate seed package is not configured: ${packageName}`);
    }
  }

  // Close the set of package dist trees needed for exact first-party resolution. Whole trees are
  // retained so an injected sibling chunk is visible to an outside directory verifier.
  const closedPackageNames = new Set(seedPackageNames);
  let report;
  for (let pass = 0; pass <= packageConfigs.length; pass += 1) {
    report = probePublishedModuleIdentity({
      allowOpaqueComputedImports: true,
      packageConfigs,
      packageNames: [...closedPackageNames].sort(compareStrings),
      snapshot,
      validateOnlySelectedPackages: true,
    });
    let changed = false;
    for (const [, target] of report.resolvedEdges) {
      const packageName = packageNameFromModule(target);
      if (!closedPackageNames.has(packageName)) {
        closedPackageNames.add(packageName);
        changed = true;
      }
    }
    if (!changed) break;
    if (pass === packageConfigs.length) {
      throw new Error('Certificate first-party package closure did not converge');
    }
  }
  if (report === undefined) throw new Error('Certificate module probe did not run');

  const modules = [...closedPackageNames]
    .sort(compareStrings)
    .flatMap((packageName) =>
      exactPackageModules(snapshot, packageName).map((modulePath) =>
        moduleId(packageName, modulePath),
      ),
    )
    .sort(compareStrings);
  const reachable = new Set(modules);
  const edges = report.resolvedEdges.sort(compareTuples);
  const localCapabilities = new Map(modules.map((module) => [module, new Set()]));
  for (const [module, specifier] of report.externalImports) {
    if (!reachable.has(module)) continue;
    const capability = classifyRawCapabilityModuleSpecifier(specifier);
    if (capability !== undefined) localCapabilities.get(module).add(capability);
  }
  const summaries = new Map(
    modules.map((module) => [module, new Set(localCapabilities.get(module))]),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const [from, to] of edges) {
      const importer = summaries.get(from);
      for (const capability of summaries.get(to)) {
        if (importer.has(capability)) continue;
        importer.add(capability);
        changed = true;
      }
    }
  }

  const artifacts = modules.map((module) => {
    const config = configsByName.get(packageNameFromModule(module));
    if (config === undefined) throw new Error(`Certificate module has no package: ${module}`);
    const bytes = readFileSync(path.join(config.rootDir, modulePathFromId(module)));
    return {
      path: module,
      sha512: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    };
  });
  const cap = Object.fromEntries(
    modules.map((module) => [module, sortCapabilities([...summaries.get(module)])]),
  );
  const postureResult = postureFacts({
    configsByName,
    posture,
    reachable,
  });
  const internalDoors = internalDoorFacts({
    configsByName,
    posture: internalDoorPosture,
    reachable,
    snapshot,
  });
  const roots = postureResult.roots;
  const doors = summarizeReachableDoors({
    doors: [...postureResult.doors, ...internalDoors],
    edges,
    roots,
  });
  const opaqueByKey = new Map();
  for (const entry of report.opaqueModules.filter((entry) => reachable.has(entry.module))) {
    opaqueByKey.set(`${entry.module}\0${entry.reason}`, entry);
  }
  for (const [module, specifier] of report.externalImports) {
    if (!reachable.has(module) || classifyRawCapabilityModuleSpecifier(specifier) !== undefined) {
      continue;
    }
    const entry = { module, reason: externalOpaqueReason(specifier) };
    opaqueByKey.set(`${entry.module}\0${entry.reason}`, entry);
  }
  const opaque = [...opaqueByKey.values()].sort(
    (left, right) =>
      compareStrings(left.module, right.module) || compareStrings(left.reason, right.reason),
  );

  return {
    artifacts,
    cap,
    domain: [...kovoCertificateCapabilityDomain],
    doors,
    edges,
    opaque,
    roots,
    schema: 'kovo.certificate/v1',
  };
}

export function stableKovoCertificateJson(certificate) {
  return `${JSON.stringify(certificate, null, 2)}\n`;
}

export function validateCertificateLexicalAuthorityLedger(input) {
  const findings = [];
  if (!isPlainRecord(input)) return ['lexical authority ledger must be a plain object'];
  if (input.schema !== 'kovo.certificate-lexical-authority/v1') {
    findings.push('lexical authority ledger schema must be kovo.certificate-lexical-authority/v1');
  }
  if (!Array.isArray(input.routes))
    return [...findings, 'lexical authority routes must be an array'];
  if (input.routes.length !== lexicalRoutes.length) {
    findings.push(`lexical authority ledger must contain exactly ${lexicalRoutes.length} routes`);
  }
  for (const [index, expected] of lexicalRoutes.entries()) {
    const row = input.routes[index];
    if (!isPlainRecord(row)) {
      findings.push(`lexical authority routes[${index}] must be a plain object`);
      continue;
    }
    if (
      JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(['evidence', 'route', 'status'])
    ) {
      findings.push(`lexical authority routes[${index}] has schema drift`);
    }
    if (row.route !== expected[0] || row.status !== expected[1]) {
      findings.push(`lexical authority routes[${index}] must be ${expected[0]} -> ${expected[1]}`);
    }
    if (
      typeof row.evidence !== 'string' ||
      row.evidence.trim() !== row.evidence ||
      row.evidence === ''
    ) {
      findings.push(`lexical authority routes[${index}] must name non-empty evidence`);
    }
  }
  return findings;
}

/** Validate the small reviewer-owned source ledger behind non-public framework doors. */
export function validateCertificateDoorPosture(input) {
  const findings = [];
  if (!isPlainRecord(input)) return ['certificate door posture must be a plain object'];
  const topKeys = Object.keys(input).sort(compareStrings);
  const allowedTopKeys =
    input.$comment === undefined ? ['doors', 'schema'] : ['$comment', 'doors', 'schema'];
  if (JSON.stringify(topKeys) !== JSON.stringify(allowedTopKeys)) {
    findings.push('certificate door posture has schema drift');
  }
  if (input.schema !== 'kovo.certificate-door-posture/v1') {
    findings.push('certificate door posture schema must be kovo.certificate-door-posture/v1');
  }
  if (!Array.isArray(input.doors))
    return [...findings, 'certificate door posture doors must be an array'];

  const seen = new Set();
  for (const [index, row] of input.doors.entries()) {
    const label = `certificate door posture doors[${index}]`;
    if (!isPlainRecord(row)) {
      findings.push(`${label} must be a plain object`);
      continue;
    }
    if (
      JSON.stringify(Object.keys(row).sort(compareStrings)) !==
      JSON.stringify(['capabilities', 'id', 'packageName', 'source', 'sourceSha512'])
    ) {
      findings.push(`${label} has schema drift`);
    }
    if (typeof row.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(row.id)) {
      findings.push(`${label}.id must be a stable kebab-case identifier`);
    } else if (seen.has(row.id)) {
      findings.push(`${label}.id is duplicated`);
    } else {
      seen.add(row.id);
    }
    if (typeof row.packageName !== 'string' || !/^@kovojs\/[a-z0-9-]+$/u.test(row.packageName)) {
      findings.push(`${label}.packageName must be a first-party package name`);
    }
    if (
      typeof row.source !== 'string' ||
      !row.source.startsWith('src/') ||
      !row.source.endsWith('.ts') ||
      row.source.includes('\\') ||
      path.posix.normalize(row.source) !== row.source
    ) {
      findings.push(`${label}.source must be a canonical package-relative src/*.ts path`);
    }
    if (!validSha512(row.sourceSha512)) {
      findings.push(`${label}.sourceSha512 must be a canonical sha512 integrity`);
    }
    if (!Array.isArray(row.capabilities) || row.capabilities.length === 0) {
      findings.push(`${label}.capabilities must be a non-empty array`);
    } else if (
      JSON.stringify(row.capabilities) !== JSON.stringify(sortCapabilities(row.capabilities)) ||
      row.capabilities.some((capability) => !kovoCertificateCapabilityDomain.includes(capability))
    ) {
      findings.push(`${label}.capabilities must be unique and in the frozen domain order`);
    }
  }
  return findings;
}

export function certificateCheckerHonestyNumbers(rootDir = repoRoot) {
  const runtimeFiles = collectFiles(path.join(rootDir, 'packages', 'verify'), ['src'], {
    absolute: true,
    includeFile: ({ relativePath }) =>
      relativePath.endsWith('.ts') && !relativePath.endsWith('.test.ts'),
  });
  const lines = runtimeFiles.reduce(
    (total, file) => total + readFileSync(file, 'utf8').split(/\r?\n/u).length,
    0,
  );
  const manifest = JSON.parse(
    readFileSync(path.join(rootDir, 'packages', 'verify', 'package.json'), 'utf8'),
  );
  const dependencies = Object.entries(manifest.dependencies ?? {}).sort(([left], [right]) =>
    compareStrings(left, right),
  );
  return { dependencies, lines, runtimeFiles: runtimeFiles.length };
}

function postureFacts({ configsByName, posture, reachable }) {
  const rootsByKey = new Map();
  const doorsByKey = new Map();
  for (const packagePosture of posture.packages ?? []) {
    const config = configsByName.get(packagePosture.packageName);
    if (config === undefined) continue;
    for (const group of packagePosture.postureGroups ?? []) {
      for (const [subpath, members] of Object.entries(group.members ?? {})) {
        const target = resolveExportTarget(
          normalizePackageExports(config.publishExports)[subpath],
          {
            conditions: ['import', 'default'],
          },
        );
        if (typeof target !== 'string' || !target.endsWith('.mjs')) continue;
        const module = moduleId(config.name, target.replace(/^\.\//u, ''));
        if (!reachable.has(module)) continue;
        if (group.rootKind !== 'none') {
          const root = { module, rootKind: group.rootKind };
          rootsByKey.set(`${module}\0${group.rootKind}`, root);
        }
        if (group.disposition === 'framework-door') {
          const site = `framework-export-posture:${group.id}:${subpath}:${members.join(',')}`;
          for (const escapeId of group.capabilities ?? []) {
            const door = { escapeId, module, site };
            doorsByKey.set(`${module}\0${escapeId}\0${site}`, door);
          }
        }
      }
    }
  }
  return {
    doors: [...doorsByKey.values()].sort((left, right) =>
      compareStrings(
        `${left.module}\0${left.escapeId}\0${left.site}`,
        `${right.module}\0${right.escapeId}\0${right.site}`,
      ),
    ),
    roots: [...rootsByKey.values()].sort((left, right) =>
      compareStrings(`${left.module}\0${left.rootKind}`, `${right.module}\0${right.rootKind}`),
    ),
  };
}

function internalDoorFacts({ configsByName, posture, reachable, snapshot }) {
  const findings = validateCertificateDoorPosture(posture);
  if (findings.length > 0) {
    throw new Error(`Certificate internal-door posture findings:\n  - ${findings.join('\n  - ')}`);
  }
  const doors = [];
  for (const entry of posture.doors) {
    const config = configsByName.get(entry.packageName);
    if (config === undefined) {
      throw new Error(
        `Certificate internal door ${entry.id} names unknown package ${entry.packageName}`,
      );
    }
    const sourceBytes = readFileSync(path.join(config.rootDir, entry.source));
    const actualIntegrity = `sha512-${createHash('sha512').update(sourceBytes).digest('base64')}`;
    if (actualIntegrity !== entry.sourceSha512) {
      throw new Error(
        `Certificate internal door ${entry.id} source identity drifted: ${entry.packageName}/${entry.source}`,
      );
    }
    const module = packedModuleForSource({ config, entry, snapshot });
    if (!reachable.has(module)) {
      throw new Error(
        `Certificate internal door ${entry.id} packed module is outside the closed graph: ${module}`,
      );
    }
    for (const escapeId of entry.capabilities) {
      doors.push({
        escapeId,
        module,
        site: `certificate-internal-door:${entry.id}:${entry.source}`,
      });
    }
  }
  return doors;
}

function packedModuleForSource({ config, entry, snapshot }) {
  const packedFiles = snapshot?.packages?.[entry.packageName];
  if (!Array.isArray(packedFiles)) {
    throw new Error(`Certificate internal door ${entry.id} has no exact packed file list`);
  }
  const sourceAbsolute = path.resolve(config.rootDir, entry.source);
  const matches = [];
  for (const mapPath of packedFiles.filter(
    (file) => typeof file === 'string' && file.endsWith('.mjs.map'),
  )) {
    const mapAbsolute = path.join(config.rootDir, mapPath);
    const sourceMap = JSON.parse(readFileSync(mapAbsolute, 'utf8'));
    if (!Array.isArray(sourceMap.sources)) continue;
    const sourceRoot = typeof sourceMap.sourceRoot === 'string' ? sourceMap.sourceRoot : '';
    if (
      sourceMap.sources.some(
        (source) =>
          typeof source === 'string' &&
          path.resolve(path.dirname(mapAbsolute), sourceRoot, source) === sourceAbsolute,
      )
    ) {
      const modulePath = mapPath.slice(0, -'.map'.length);
      if (!packedFiles.includes(modulePath)) {
        throw new Error(
          `Certificate internal door ${entry.id} source map has no paired module: ${mapPath}`,
        );
      }
      matches.push(moduleId(entry.packageName, modulePath));
    }
  }
  if (matches.length !== 1) {
    throw new Error(
      `Certificate internal door ${entry.id} must map to exactly one packed module; found ${matches.length}`,
    );
  }
  return matches[0];
}

/**
 * The checker receives already-summarized door sets just as it receives already-summarized `cap`.
 * Keep the exact originating module/site in the summary string so a root admission never invents
 * authority; search-side graph reachability is the only operation the tiny checker does not repeat.
 */
function summarizeReachableDoors({ doors, edges, roots }) {
  const byModule = new Map();
  for (const [from, to] of edges) {
    const targets = byModule.get(from) ?? [];
    targets.push(to);
    byModule.set(from, targets);
  }
  const summarized = new Map();
  const append = (door) => {
    summarized.set(`${door.module}\0${door.escapeId}\0${door.site}`, door);
  };
  for (const door of doors) append(door);

  for (const root of roots) {
    const reachable = new Set();
    const queue = [root.module];
    for (let index = 0; index < queue.length; index += 1) {
      const module = queue[index];
      if (reachable.has(module)) continue;
      reachable.add(module);
      for (const target of byModule.get(module) ?? []) queue.push(target);
    }
    for (const door of doors) {
      if (!reachable.has(door.module) || door.module === root.module) continue;
      append({
        escapeId: door.escapeId,
        module: root.module,
        site: `certificate-door-summary:${door.module}:${door.site}`,
      });
    }
  }
  return [...summarized.values()].sort((left, right) =>
    compareStrings(
      `${left.module}\0${left.escapeId}\0${left.site}`,
      `${right.module}\0${right.escapeId}\0${right.site}`,
    ),
  );
}

function exactPackageModules(snapshot, packageName) {
  const files = snapshot?.packages?.[packageName];
  if (!Array.isArray(files)) {
    throw new Error(`Pack-security snapshot has no exact file list for ${packageName}`);
  }
  return files
    .filter((entry) => typeof entry === 'string' && entry.endsWith('.mjs'))
    .sort(compareStrings);
}

function moduleId(packageName, modulePath) {
  return `${packageName}/${modulePath}`;
}

function packageNameFromModule(module) {
  const parts = module.split('/');
  return `${parts[0]}/${parts[1]}`;
}

function modulePathFromId(module) {
  return module.split('/').slice(2).join('/');
}

function sortCapabilities(values) {
  const index = new Map(
    kovoCertificateCapabilityDomain.map((entry, position) => [entry, position]),
  );
  return [...new Set(values)].sort((left, right) => index.get(left) - index.get(right));
}

function externalOpaqueReason(specifier) {
  return `imports external module ${JSON.stringify(specifier)} outside the seven-kind lexical capability domain`;
}

function validSha512(value) {
  if (typeof value !== 'string' || !value.startsWith('sha512-')) return false;
  try {
    const encoded = value.slice('sha512-'.length);
    return (
      Buffer.from(encoded, 'base64').length === 64 &&
      Buffer.from(encoded, 'base64').toString('base64') === encoded
    );
  } catch {
    return false;
  }
}

function isPlainRecord(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function compareTuples(left, right) {
  return compareStrings(left[0], right[0]) || compareStrings(left[1], right[1]);
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function main() {
  const lexical = JSON.parse(readFileSync(kovoCertificateLexicalAuthorityPath, 'utf8'));
  const lexicalFindings = validateCertificateLexicalAuthorityLedger(lexical);
  if (lexicalFindings.length > 0) {
    throw new Error(
      `Certificate lexical authority findings:\n  - ${lexicalFindings.join('\n  - ')}`,
    );
  }
  const certificate = generateKovoCertificate();
  const generated = stableKovoCertificateJson(certificate);
  if (process.argv.includes('--write')) {
    writeFileSync(kovoCertificatePath, generated, 'utf8');
  } else {
    const committed = readFileSync(kovoCertificatePath, 'utf8');
    if (committed !== generated) {
      throw new Error(
        'security/kovo-certificate-v1.json drifted; rebuild packed packages and run pnpm run generate:certificate',
      );
    }
  }
  const honesty = certificateCheckerHonestyNumbers();
  process.stdout.write(
    `kovo.certificate/v1 artifacts=${certificate.artifacts.length} edges=${certificate.edges.length} roots=${certificate.roots.length} doors=${certificate.doors.length} opaque=${certificate.opaque.length} checker-runtime-files=${honesty.runtimeFiles} checker-loc=${honesty.lines} checker-runtime-dependency-closure=${honesty.dependencies.length} (${honesty.dependencies.map(([name, version]) => `${name}@${version}`).join(',')})\n`,
  );
}

if (isMainEntry(import.meta.url)) await runGate(main);
