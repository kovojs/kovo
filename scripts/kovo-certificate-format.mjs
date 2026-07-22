import { createHash } from 'node:crypto';
import path from 'node:path';

/** The exact Plan 3 §2.1 authority vocabulary carried by kovo.certificate/v1. */
export const kovoCertificateCapabilityDomain = Object.freeze([
  'crypto-acquisition',
  'database-driver',
  'digest',
  'dynamic-loader',
  'filesystem',
  'network',
  'process',
  'vm',
  'worker',
]);

const securityRootKinds = Object.freeze([
  'agent-tool-callback',
  'application',
  'durable-task',
  'endpoint',
  'layout',
  'mutation',
  'query',
  'route',
  'scheduled-task',
  'serialized-browser-handler',
  'webhook',
]);

const automaticPackageLifecycleScripts = new Set([
  'dependencies',
  'install',
  'postinstall',
  'postpack',
  'postprepare',
  'preinstall',
  'prepack',
  'prepare',
  'preprepare',
  'prepublish',
  'prepublishOnly',
]);

/**
 * Turn the real search-side analyzer record into kovo.certificate/v1 without re-reading source.
 * This deliberately contains no parser, worklist input discovery, package resolver, or dependency.
 */
export function generateKovoCertificateFromAnalysis(analysis, policyBytes) {
  validateKovoCertificateAnalysis(analysis);
  if (!(policyBytes instanceof Uint8Array)) throw policyError('must be supplied as exact bytes');
  const policySnapshot = Buffer.from(policyBytes);
  const policy = parseKovoCertificatePolicyBytes(policySnapshot);
  const modules = analysis.artifacts.map((entry) => entry.path);
  const summaries = new Map(
    modules.map((module) => [module, new Set(analysis.localCapabilities[module])]),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const [from, to] of analysis.edges) {
      const importer = summaries.get(from);
      for (const capability of summaries.get(to)) {
        if (importer.has(capability)) continue;
        importer.add(capability);
        changed = true;
      }
    }
  }

  const posture = kovoCertificatePolicyFactsFromAnalysis(analysis);
  const doors = posture.doors;
  requirePolicyEquality('artifacts', policy.artifacts, analysis.artifacts);
  requirePolicyEquality('roots', policy.roots, analysis.roots);
  requirePolicyEquality('doors', policy.doors, doors);
  requirePolicyEquality('opaque', policy.opaque, analysis.opaque);

  return {
    artifacts: modules,
    cap: Object.fromEntries(
      modules.map((module) => [module, sortCapabilities([...summaries.get(module)])]),
    ),
    domain: [...kovoCertificateCapabilityDomain],
    doors,
    edges: analysis.edges,
    opaque: analysis.opaque,
    policySha512: sha512(policySnapshot),
    roots: analysis.roots,
    schema: 'kovo.certificate/v1',
  };
}

/** Produce the search-side facts used only to propose a separately reviewed policy update. */
export function kovoCertificatePolicyFactsFromAnalysis(analysis) {
  validateKovoCertificateAnalysis(analysis);
  return {
    artifacts: analysis.artifacts,
    doors: summarizeReachableDoors({
      doors: analysis.doors,
      edges: analysis.edges,
      roots: analysis.roots,
    }),
    opaque: analysis.opaque,
    roots: analysis.roots,
  };
}

export function stableKovoCertificateJson(certificate) {
  return `${JSON.stringify(certificate, null, 2)}\n`;
}

export function stableKovoCertificatePolicyJson(policy) {
  return `${JSON.stringify(sortJsonValue(policy), null, 2)}\n`;
}

export function parseKovoCertificatePolicyBytes(input) {
  if (!(input instanceof Uint8Array)) throw policyError('must be supplied as exact bytes');
  if (input.byteLength > 1024 * 1024) throw policyError('must not exceed 1 MiB');
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(input);
  } catch {
    throw policyError('bytes must be valid UTF-8');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw policyError('bytes must contain valid JSON');
  }
  const policy = normalizeKovoCertificatePolicy(parsed);
  if (text !== stableKovoCertificatePolicyJson(policy)) {
    throw policyError('bytes must use canonical two-space JSON with one trailing newline');
  }
  return policy;
}

export function validateKovoCertificateAnalysis(analysis) {
  if (!isPlainRecord(analysis)) throw analysisError('record must be a plain object');
  const expectedKeys = [
    'artifacts',
    'doors',
    'edges',
    'localCapabilities',
    'opaque',
    'roots',
    'schema',
  ];
  if (canonicalJson(Object.keys(analysis).sort(compareStrings)) !== canonicalJson(expectedKeys)) {
    throw analysisError('top-level schema drift');
  }
  if (analysis.schema !== 'kovo.certificate-analysis/v1') {
    throw analysisError('schema must be kovo.certificate-analysis/v1');
  }
  if (!Array.isArray(analysis.artifacts) || analysis.artifacts.length === 0) {
    throw analysisError('artifacts must be a non-empty array');
  }
  const modules = [];
  for (const [index, artifact] of analysis.artifacts.entries()) {
    if (
      !isPlainRecord(artifact) ||
      canonicalJson(Object.keys(artifact).sort(compareStrings)) !==
        canonicalJson(['path', 'sha512'])
    ) {
      throw analysisError(`artifacts[${index}] has schema drift`);
    }
    if (!validModuleId(artifact.path)) {
      throw analysisError(`artifacts[${index}].path is not a canonical packed module id`);
    }
    if (!validSha512(artifact.sha512)) {
      throw analysisError(`artifacts[${index}].sha512 is not a canonical integrity`);
    }
    modules.push(artifact.path);
  }
  assertSortedUnique(modules, 'artifact modules');
  const moduleSet = new Set(modules);

  if (!isPlainRecord(analysis.localCapabilities)) {
    throw analysisError('localCapabilities must be a plain object');
  }
  const capabilityModules = Object.keys(analysis.localCapabilities).sort(compareStrings);
  if (canonicalJson(capabilityModules) !== canonicalJson(modules)) {
    throw analysisError('localCapabilities must cover the exact artifact module set');
  }
  for (const module of modules) {
    const capabilities = analysis.localCapabilities[module];
    if (
      !Array.isArray(capabilities) ||
      capabilities.some((entry) => !kovoCertificateCapabilityDomain.includes(entry)) ||
      canonicalJson(capabilities) !== canonicalJson(sortCapabilities(capabilities))
    ) {
      throw analysisError(`${module} has an invalid local capability set`);
    }
  }

  validateEdges(analysis.edges, moduleSet);
  validateRoots(analysis.roots, moduleSet);
  validateDoors(analysis.doors, moduleSet);
  validateOpaque(analysis.opaque, moduleSet);
}

function validateEdges(edges, moduleSet) {
  if (!Array.isArray(edges)) throw analysisError('edges must be an array');
  const keys = [];
  for (const [index, edge] of edges.entries()) {
    if (
      !Array.isArray(edge) ||
      edge.length !== 2 ||
      !moduleSet.has(edge[0]) ||
      !moduleSet.has(edge[1])
    ) {
      throw analysisError(`edges[${index}] is not an in-graph pair`);
    }
    keys.push(`${edge[0]}\0${edge[1]}`);
  }
  assertSortedUnique(keys, 'edges');
}

function validateRoots(roots, moduleSet) {
  if (!Array.isArray(roots)) throw analysisError('roots must be an array');
  const keys = [];
  for (const [index, root] of roots.entries()) {
    if (
      !isPlainRecord(root) ||
      canonicalJson(Object.keys(root).sort(compareStrings)) !==
        canonicalJson(['module', 'rootKind']) ||
      !moduleSet.has(root.module) ||
      !securityRootKinds.includes(root.rootKind)
    ) {
      throw analysisError(`roots[${index}] is invalid`);
    }
    keys.push(`${root.module}\0${root.rootKind}`);
  }
  assertSortedUnique(keys, 'roots');
}

function validateDoors(doors, moduleSet) {
  if (!Array.isArray(doors)) throw analysisError('doors must be an array');
  const keys = [];
  for (const [index, door] of doors.entries()) {
    if (
      !isPlainRecord(door) ||
      canonicalJson(Object.keys(door).sort(compareStrings)) !==
        canonicalJson(['escapeId', 'module', 'site']) ||
      !moduleSet.has(door.module) ||
      !kovoCertificateCapabilityDomain.includes(door.escapeId) ||
      typeof door.site !== 'string' ||
      door.site === ''
    ) {
      throw analysisError(`doors[${index}] is invalid`);
    }
    keys.push(`${door.module}\0${door.escapeId}\0${door.site}`);
  }
  assertSortedUnique(keys, 'doors');
}

function validateOpaque(opaque, moduleSet) {
  if (!Array.isArray(opaque)) throw analysisError('opaque must be an array');
  const keys = [];
  for (const [index, entry] of opaque.entries()) {
    if (
      !isPlainRecord(entry) ||
      canonicalJson(Object.keys(entry).sort(compareStrings)) !==
        canonicalJson(['module', 'reason']) ||
      !moduleSet.has(entry.module) ||
      typeof entry.reason !== 'string' ||
      entry.reason === ''
    ) {
      throw analysisError(`opaque[${index}] is invalid`);
    }
    keys.push(`${entry.module}\0${entry.reason}`);
  }
  assertSortedUnique(keys, 'opaque entries');
}

function normalizeKovoCertificatePolicy(input) {
  if (!isPlainRecord(input)) throw policyError('record must be a plain object');
  requireExactKeys(
    input,
    ['artifacts', 'doors', 'opaque', 'packages', 'roots', 'schema'],
    'policy',
  );
  if (input.schema !== 'kovo.certificate-policy/v1') {
    throw policyError('schema must be kovo.certificate-policy/v1');
  }
  if (!Array.isArray(input.artifacts) || input.artifacts.length === 0) {
    throw policyError('artifacts must be a non-empty array');
  }
  const artifacts = input.artifacts.map((entry, index) => {
    if (!isPlainRecord(entry)) throw policyError(`artifacts[${index}] must be a plain object`);
    requireExactKeys(entry, ['path', 'sha512'], `artifacts[${index}]`);
    if (!validModuleId(entry.path) || !validSha512(entry.sha512)) {
      throw policyError(`artifacts[${index}] must contain a canonical path and sha512`);
    }
    return { path: entry.path, sha512: entry.sha512 };
  });
  assertPolicySortedUnique(
    artifacts.map((entry) => entry.path),
    'artifacts',
  );
  const moduleSet = new Set(artifacts.map((entry) => entry.path));
  try {
    validateRoots(input.roots, moduleSet);
    validateDoors(input.doors, moduleSet);
    validateOpaque(input.opaque, moduleSet);
  } catch (error) {
    throw policyError(error instanceof Error ? error.message : 'authority posture is invalid');
  }
  if (!Array.isArray(input.packages) || input.packages.length === 0) {
    throw policyError('packages must be a non-empty array');
  }
  const packages = input.packages.map((entry, index) =>
    normalizePolicyPackage(entry, index, moduleSet),
  );
  assertPolicySortedUnique(
    packages.map((entry) => entry.name),
    'packages',
  );
  const artifactPackages = [
    ...new Set(artifacts.map((entry) => entry.path.split('/').slice(0, 2).join('/'))),
  ].sort(compareStrings);
  if (canonicalJson(packages.map((entry) => entry.name)) !== canonicalJson(artifactPackages)) {
    throw policyError('packages must exactly equal the package set named by artifacts');
  }
  return {
    artifacts,
    doors: input.doors,
    opaque: input.opaque,
    packages,
    roots: input.roots,
    schema: 'kovo.certificate-policy/v1',
  };
}

function normalizePolicyPackage(input, index, moduleSet) {
  const label = `packages[${index}]`;
  if (!isPlainRecord(input)) throw policyError(`${label} must be a plain object`);
  requireExactKeys(input, ['manifest', 'name'], label);
  if (!/^@kovojs\/[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(input.name)) {
    throw policyError(`${label}.name is invalid`);
  }
  if (!isPlainRecord(input.manifest) || input.manifest.name !== input.name) {
    throw policyError(`${label}.manifest must be a plain installed manifest with the exact name`);
  }
  if (Object.hasOwn(input.manifest, 'publishConfig')) {
    throw policyError(`${label}.manifest must not contain publishConfig`);
  }
  assertJsonValue(input.manifest, `${label}.manifest`);
  assertInstalledManifestSecurity(input.manifest, input.name);
  for (const target of packageManifestRuntimeTargets(input.manifest, input.name)) {
    if (!moduleSet.has(target)) {
      throw policyError(`${label}.manifest runtime target ${target} is outside policy artifacts`);
    }
  }
  return { manifest: input.manifest, name: input.name };
}

function packageManifestRuntimeTargets(manifest, packageName) {
  const targets = new Set();
  if (manifest.exports !== undefined) {
    const exportsMap = packageExportsMap(manifest.exports);
    for (const subpath of Object.keys(exportsMap)) {
      if (!validExportSubpath(subpath)) {
        throw policyError(`${packageName} exports contains unsupported subpath ${subpath}`);
      }
      targets.add(
        packageManifestTarget(
          singleRuntimeTarget(exportsMap[subpath], `${packageName} export ${subpath}`),
          packageName,
        ),
      );
    }
  }
  if (manifest.bin !== undefined) {
    const entries =
      typeof manifest.bin === 'string'
        ? [[packageName.slice(packageName.indexOf('/') + 1), manifest.bin]]
        : isPlainRecord(manifest.bin)
          ? Object.entries(manifest.bin)
          : undefined;
    if (entries === undefined) throw policyError(`${packageName} bin must be a string or object`);
    for (const [name, target] of entries) {
      if (typeof name !== 'string' || name === '' || typeof target !== 'string') {
        throw policyError(`${packageName} bin names and targets must be strings`);
      }
      targets.add(packageManifestTarget(target, packageName));
    }
  }
  for (const field of ['main', 'module']) {
    if (manifest[field] === undefined) continue;
    if (typeof manifest[field] !== 'string') {
      throw policyError(`${packageName} ${field} must be a string`);
    }
    targets.add(packageManifestTarget(manifest[field], packageName));
  }
  return targets;
}

function assertInstalledManifestSecurity(manifest, packageName) {
  if (Object.hasOwn(manifest, 'browser')) {
    throw policyError(`${packageName} browser remaps are unsupported`);
  }
  if (manifest.scripts !== undefined) {
    if (!isPlainRecord(manifest.scripts)) {
      throw policyError(`${packageName} scripts must be a plain object`);
    }
    for (const [name, command] of Object.entries(manifest.scripts)) {
      if (typeof command !== 'string') {
        throw policyError(`${packageName} script ${name} must be a string`);
      }
      if (automaticPackageLifecycleScripts.has(name) && command.trim() !== '') {
        throw policyError(`${packageName} automatic lifecycle script ${name} is forbidden`);
      }
    }
  }
  if (manifest.imports === undefined) return;
  if (!isPlainRecord(manifest.imports)) {
    throw policyError(`${packageName} imports must be a plain object`);
  }
  for (const [specifier, value] of Object.entries(manifest.imports)) {
    if (!/^#[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(specifier)) {
      throw policyError(`${packageName} imports key ${JSON.stringify(specifier)} is unsupported`);
    }
    packageManifestRelativeTarget(
      singleRuntimeTarget(value, `${packageName} import ${JSON.stringify(specifier)}`),
      packageName,
    );
  }
}

function packageExportsMap(value) {
  if (!isPlainRecord(value)) return { '.': value };
  return Object.keys(value).some((key) => key === '.' || key.startsWith('./'))
    ? value
    : { '.': value };
}

function singleRuntimeTarget(value, label) {
  const targets = [...collectRuntimeTargets(value)];
  if (targets.length !== 1) {
    throw policyError(`${label} must collapse all runtime conditions and fallbacks to one target`);
  }
  return targets[0];
}

function collectRuntimeTargets(value) {
  if (typeof value === 'string') return new Set([value]);
  if (Array.isArray(value)) {
    const targets = new Set();
    for (const entry of value) {
      for (const target of collectRuntimeTargets(entry)) targets.add(target);
    }
    return targets;
  }
  if (!isPlainRecord(value)) {
    throw policyError('runtime export conditions and fallbacks must end in string targets');
  }
  const targets = new Set();
  for (const key of Object.keys(value)) {
    if (key === 'types' || key.startsWith('types@')) {
      assertDeclarationOnlyTargets(value[key], `condition ${JSON.stringify(key)}`);
      continue;
    }
    for (const target of collectRuntimeTargets(value[key])) targets.add(target);
  }
  return targets;
}

function assertDeclarationOnlyTargets(value, label) {
  if (typeof value === 'string') {
    if (
      !/^\.\/dist\/[A-Za-z0-9_./-]+\.d\.(?:cts|mts|ts)$/u.test(value) ||
      path.posix.normalize(value) !== value.slice(2)
    ) {
      throw policyError(`${label} must end only in canonical ./dist/*.d.ts declaration targets`);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) throw policyError(`${label} must not be empty`);
    for (const entry of value) assertDeclarationOnlyTargets(entry, label);
    return;
  }
  if (!isPlainRecord(value) || Object.keys(value).length === 0) {
    throw policyError(`${label} must contain only declaration targets`);
  }
  for (const entry of Object.values(value)) assertDeclarationOnlyTargets(entry, label);
}

function packageManifestTarget(value, packageName) {
  if (
    typeof value !== 'string' ||
    !value.startsWith('./dist/') ||
    value.includes('\\') ||
    value.includes('%') ||
    value.includes('?') ||
    value.includes('#') ||
    !value.endsWith('.mjs') ||
    path.posix.normalize(value) !== value.slice(2)
  ) {
    throw policyError(`${packageName} runtime target ${String(value)} must be ./dist/*.mjs`);
  }
  return `${packageName}/${value.slice(2)}`;
}

function packageManifestRelativeTarget(value, packageName) {
  if (
    typeof value !== 'string' ||
    !value.startsWith('./') ||
    value.includes('\\') ||
    value.includes('%') ||
    value.includes('?') ||
    value.includes('#') ||
    path.posix.normalize(value) !== value.slice(2)
  ) {
    throw policyError(`${packageName} package import target ${String(value)} is not canonical`);
  }
  return value;
}

function validExportSubpath(value) {
  return (
    value === '.' ||
    (typeof value === 'string' &&
      /^\.\/[A-Za-z0-9_./-]+$/u.test(value) &&
      !value.includes('*') &&
      path.posix.normalize(value) === value.slice(2))
  );
}

function assertJsonValue(value, label, depth = 0) {
  if (depth > 64) throw policyError(`${label} exceeds the JSON depth limit`);
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      assertJsonValue(entry, `${label}[${index}]`, depth + 1);
    }
    return;
  }
  if (!isPlainRecord(value)) throw policyError(`${label} must contain only JSON data`);
  for (const [key, entry] of Object.entries(value)) {
    assertJsonValue(entry, `${label}.${key}`, depth + 1);
  }
}

function requireExactKeys(input, expected, label) {
  if (canonicalJson(Object.keys(input).sort(compareStrings)) !== canonicalJson(expected)) {
    throw policyError(`${label} has schema drift`);
  }
}

function assertPolicySortedUnique(values, label) {
  if (values.some((value, index) => index > 0 && compareStrings(values[index - 1], value) >= 0)) {
    throw policyError(`${label} must be sorted and unique`);
  }
}

function requirePolicyEquality(label, expected, actual) {
  if (canonicalJson(expected) !== canonicalJson(actual)) {
    throw policyError(`${label} must exactly equal the analyzer-derived certificate ${label}`);
  }
}

function sha512(bytes) {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

function policyError(message) {
  return new Error(`Kovo certificate policy is invalid: ${message}`);
}

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

function sortCapabilities(values) {
  const index = new Map(
    kovoCertificateCapabilityDomain.map((entry, position) => [entry, position]),
  );
  return [...new Set(values)].sort((left, right) => index.get(left) - index.get(right));
}

function validModuleId(value) {
  return (
    typeof value === 'string' &&
    /^@kovojs\/[a-z0-9]+(?:-[a-z0-9]+)*\/dist\/[A-Za-z0-9_./-]+\.mjs$/u.test(value) &&
    path.posix.normalize(value) === value &&
    !value.split('/').some((segment) => segment === '.' || segment === '..')
  );
}

function validSha512(value) {
  if (typeof value !== 'string' || !value.startsWith('sha512-')) return false;
  const encoded = value.slice('sha512-'.length);
  const bytes = Buffer.from(encoded, 'base64');
  return bytes.length === 64 && bytes.toString('base64') === encoded;
}

function isPlainRecord(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function assertSortedUnique(values, label) {
  if (values.some((value, index) => index > 0 && compareStrings(values[index - 1], value) >= 0)) {
    throw analysisError(`${label} must be sorted and unique`);
  }
}

function analysisError(message) {
  return new Error(`Kovo certificate analysis is invalid: ${message}`);
}

function canonicalJson(value) {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value) {
  if (Array.isArray(value)) return value.map((entry) => sortJsonValue(entry));
  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareStrings)
        .map((key) => [key, sortJsonValue(value[key])]),
    );
  }
  return value;
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
