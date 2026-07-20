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

/**
 * Turn the real search-side analyzer record into kovo.certificate/v1 without re-reading source.
 * This deliberately contains no parser, worklist input discovery, package resolver, or dependency.
 */
export function generateKovoCertificateFromAnalysis(analysis) {
  validateKovoCertificateAnalysis(analysis);
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

  return {
    artifacts: analysis.artifacts,
    cap: Object.fromEntries(
      modules.map((module) => [module, sortCapabilities([...summaries.get(module)])]),
    ),
    domain: [...kovoCertificateCapabilityDomain],
    doors: summarizeReachableDoors({
      doors: analysis.doors,
      edges: analysis.edges,
      roots: analysis.roots,
    }),
    edges: analysis.edges,
    opaque: analysis.opaque,
    roots: analysis.roots,
    schema: 'kovo.certificate/v1',
  };
}

export function stableKovoCertificateJson(certificate) {
  return `${JSON.stringify(certificate, null, 2)}\n`;
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
    /^@kovojs\/[a-z0-9-]+\/dist\/[A-Za-z0-9_./-]+\.mjs$/u.test(value) &&
    !value.includes('/../')
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
  return JSON.stringify(value);
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
