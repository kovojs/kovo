#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  ESCAPE_CENSUS_DOORS,
  ESCAPE_CENSUS_PREDECESSOR,
  evaluateEscapeCensus,
  formatEscapeCensusReport,
  loadEscapeCensusConfig,
  runEscapeCensusCli,
} from './escape-census-gate.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = resolve(repoRoot, 'security/fixtures/escape-census-real-app');
const fixtureApp = resolve(fixtureRoot, 'app.tsx');
const fixtureCache = resolve(fixtureRoot, '.kovo');
const fixtureOut = resolve(fixtureRoot, 'dist');

export const ESCAPE_CENSUS_BASELINE_COMMAND = 'pnpm run check:escape-census:baseline';
export const ESCAPE_CENSUS_GATE_COMMAND =
  'node scripts/escape-census-gate.mjs --config security/escape-census-config.json';
export const ESCAPE_CENSUS_BASELINE_CONFIG = 'security/escape-census-config.json';

const defaultConfigPath = resolve(repoRoot, ESCAPE_CENSUS_BASELINE_CONFIG);
const defaultBaselinePath = resolve(repoRoot, 'security/escape-census-baseline.json');
const expectedNegativeCheckIds = Object.freeze([
  'budget-ceiling',
  'missing-producer-provenance',
  'wrong-producer-provenance',
]);

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonBlank(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `${label} is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function loadEscapeCensusInputs(configPath = defaultConfigPath) {
  const inputs = loadEscapeCensusConfig(configPath);
  if (inputs.apps.length === 0) {
    throw new TypeError('escape census config must declare at least one app');
  }
  return inputs;
}

/** Load the exact unsigned reviewer subjects emitted beside every configured production graph. */
export function loadEscapeCensusReviewSubjects(configPath = defaultConfigPath) {
  const absoluteConfig = resolve(configPath);
  const config = readJson(absoluteConfig, 'escape census config');
  if (!record(config) || config.schema !== 'kovo.escape-census-config/v1') {
    throw new TypeError('config must use kovo.escape-census-config/v1');
  }
  if (!Array.isArray(config.apps)) throw new TypeError('config.apps must be an array');
  const base = dirname(absoluteConfig);
  return config.apps.map((entry, index) => {
    if (
      !record(entry) ||
      !nonBlank(entry.app) ||
      !nonBlank(entry.package) ||
      !nonBlank(entry.graph)
    ) {
      throw new TypeError(`config.apps[${index}] lacks an exact app/package/graph identity`);
    }
    const graphPath = resolve(base, entry.graph);
    const manifest = readJson(
      resolve(dirname(graphPath), 'escape-census-review-subjects.json'),
      `apps[${index}] escape-census review subjects`,
    );
    if (
      !record(manifest) ||
      manifest.schema !== 'kovo.escape-census-review-subjects/v1' ||
      !/^sha256:[a-f0-9]{64}$/u.test(manifest.artifactSubject ?? '') ||
      !Array.isArray(manifest.subjects)
    ) {
      throw new TypeError(`apps[${index}] escape-census review subject manifest is malformed`);
    }
    return {
      app: entry.app,
      manifest,
      package: entry.package,
    };
  });
}

const reviewDoorByTrustKind = Object.freeze({
  allowControlChars: 'allowControlChars',
  csrfFalse: 'csrf:false',
  kovoAnalyzerSummary: 'kovoAnalyzerSummary',
  trustedHtml: 'trustedHtml',
  trustedSql: 'trustedSql',
});

/**
 * Independently derive the reviewer manifest from authoritative graph producers. This oracle does
 * not consume the CLI emitter, so the baseline gate catches an emitter that drops or cross-joins a
 * producer site while retaining the same counted root (SPEC §§6.6 and 11.2).
 */
export function deriveEscapeCensusReviewManifest(graph, label = 'escape census graph') {
  if (!record(graph)) throw new TypeError(`${label} must be an object`);
  const artifactSubject = graph.runtimePosture?.artifactSubject;
  if (typeof artifactSubject !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(artifactSubject)) {
    throw new TypeError(`${label} lacks its build-owned artifact subject`);
  }
  const subjectGraph = {};
  for (const key of Object.keys(graph)) {
    if (key !== 'runtimePosture') subjectGraph[key] = graph[key];
  }
  const computedArtifactSubject = `sha256:${createHash('sha256')
    .update(canonicalArtifactJson(subjectGraph), 'utf8')
    .digest('hex')}`;
  if (computedArtifactSubject !== artifactSubject) {
    throw new TypeError(
      `${label} artifact subject mismatch expected=${artifactSubject} actual=${computedArtifactSubject}`,
    );
  }
  if (!Array.isArray(graph.trustEscapes)) {
    throw new TypeError(`${label} lacks its authoritative trustEscapes array`);
  }
  if (!Array.isArray(graph.components) || !Array.isArray(graph.mutations)) {
    throw new TypeError(`${label} lacks its authoritative components or mutations array`);
  }
  const analyzedAppSources = reviewAnalysisInputs(graph.analysisInputs, label);
  const executableCsrfRoots = reviewExecutableCsrfRoots(graph.mutations, label);

  const roots = new Map();
  const csrfSitesByCountedRoot = new Map();
  const addRoot = (door, root, site) => {
    const stableRoot = reviewAuditText(root, `${label} ${door} root`);
    const stableSite = reviewSite(site, `${label} ${door} site`);
    const siteKey = JSON.stringify(stableSite);
    const key = `${door}\u0000${stableRoot}`;
    const entry = roots.get(key) ?? { door, root: stableRoot, sites: new Map() };
    entry.sites.set(siteKey, stableSite);
    roots.set(key, entry);
  };
  const trustBindingsByKind = new Map();

  for (const [index, escape] of graph.trustEscapes.entries()) {
    if (!record(escape) || typeof escape.kind !== 'string') {
      throw new TypeError(`${label} trustEscapes[${index}] is malformed`);
    }
    const boundSite = reviewTrustEscapeSite(
      escape,
      `${label} trustEscapes[${index}]`,
      analyzedAppSources,
    );
    if (escape.kind === 'trustedHtml' || escape.kind === 'trustedSql') {
      const exactBindings = trustBindingsByKind.get(escape.kind) ?? new Map();
      const exactRoot = reviewAuditText(escape.root, `${label} trustEscapes[${index}].root`);
      const identity = `${boundSite.sourceHash}\u0000${boundSite.sliceHash}`;
      const previous = exactBindings.get(exactRoot);
      if (previous !== undefined && previous.identity !== identity) {
        throw new TypeError(`${label} trustEscapes[${index}] conflicts at ${exactRoot}`);
      }
      exactBindings.set(exactRoot, {
        identity,
        sliceHash: boundSite.sliceHash,
        sourceHash: boundSite.sourceHash,
      });
      trustBindingsByKind.set(escape.kind, exactBindings);
    }
    const door = reviewDoorByTrustKind[escape.kind];
    if (door === undefined) continue;
    if (door !== 'csrf:false') {
      addRoot(door, escape.root, boundSite);
      continue;
    }
    if (escape.countedRootDisposition === 'linked') {
      const countedRoot = reviewAuditText(
        escape.countedRoot,
        `${label} trustEscapes[${index}].countedRoot`,
      );
      const expectedCountedRoot = exactCountedCsrfRoot(escape, executableCsrfRoots);
      if (countedRoot !== expectedCountedRoot) {
        throw new TypeError(`${label} csrf producer carries the wrong exact counted root`);
      }
      const sites = csrfSitesByCountedRoot.get(countedRoot) ?? new Map();
      sites.set(JSON.stringify(boundSite), boundSite);
      csrfSitesByCountedRoot.set(countedRoot, sites);
    } else if (escape.countedRootDisposition === 'proven-unreachable') {
      if (
        escape.countedRoot !== undefined ||
        exactCountedCsrfRoot(escape, executableCsrfRoots) !== undefined
      ) {
        throw new TypeError(`${label} unreachable csrf producer carries a counted root`);
      }
    } else {
      throw new TypeError(`${label} csrf producer lacks a closed counted-root disposition`);
    }
  }

  for (const [componentIndex, component] of graph.components.entries()) {
    if (!record(component) || !nonBlank(component.name)) {
      throw new TypeError(`${label} components[${componentIndex}] is malformed`);
    }
    if (
      component.securityOperations !== undefined &&
      !Array.isArray(component.securityOperations)
    ) {
      throw new TypeError(`${label} components[${componentIndex}] has malformed operations`);
    }
    const handlerRoots = new Set();
    for (const [operationIndex, operation] of (component.securityOperations ?? []).entries()) {
      if (!record(operation) || operation.kind !== 'server.handler.root') continue;
      const handlerRoot = reviewAuditText(
        operation.target,
        `${label} components[${componentIndex}].securityOperations[${operationIndex}].target`,
      );
      if (handlerRoots.has(handlerRoot)) {
        throw new TypeError(
          `${label} components[${componentIndex}] duplicates handler root ${handlerRoot}`,
        );
      }
      handlerRoots.add(handlerRoot);
    }
    const semantic = component.securitySemanticGraph;
    if (semantic === undefined) {
      if (handlerRoots.size > 0) {
        throw new TypeError(
          `${label} components[${componentIndex}] has handler roots without a semantic graph`,
        );
      }
      continue;
    }
    if (
      !record(semantic) ||
      semantic.schema !== 'kovo-security-semantic-graph/v3' ||
      !exactRelativeAnalysisPath(semantic.sourceFile) ||
      analyzedAppSources.get(semantic.sourceFile) === undefined ||
      !Array.isArray(semantic.roots)
    ) {
      throw new TypeError(`${label} components[${componentIndex}] has a malformed semantic graph`);
    }
    const semanticRoots = new Set();
    for (const [rootIndex, semanticRoot] of semantic.roots.entries()) {
      if (
        !record(semanticRoot) ||
        !nonBlank(semanticRoot.root) ||
        !record(semanticRoot.binding) ||
        semanticRoot.binding.root !== semanticRoot.root ||
        !nonBlank(semanticRoot.binding.factory) ||
        !record(semanticRoot.binding.factoryCallSpan) ||
        !Number.isSafeInteger(semanticRoot.binding.factoryCallSpan.start) ||
        !Number.isSafeInteger(semanticRoot.binding.factoryCallSpan.end) ||
        !Array.isArray(semanticRoot.traces)
      ) {
        throw new TypeError(
          `${label} components[${componentIndex}].roots[${rootIndex}] is malformed`,
        );
      }
      if (semanticRoots.has(semanticRoot.root)) {
        throw new TypeError(
          `${label} components[${componentIndex}] duplicates semantic root ${semanticRoot.root}`,
        );
      }
      semanticRoots.add(semanticRoot.root);
      for (const [traceIndex, trace] of semanticRoot.traces.entries()) {
        if (
          !record(trace) ||
          trace.verdict !== 'proved' ||
          !record(trace.sink) ||
          typeof trace.sink.sliceHash !== 'string' ||
          !/^sha256:[a-f0-9]{64}$/u.test(trace.sink.sliceHash) ||
          (trace.sink.door !== 'ctx.fetch' &&
            trace.sink.door !== 'trustedHtml' &&
            trace.sink.door !== 'trustedSql')
        ) {
          continue;
        }
        if (
          !record(trace.sink.span) ||
          !Number.isSafeInteger(trace.sink.span.start) ||
          !Number.isSafeInteger(trace.sink.span.end) ||
          trace.sink.span.start < 0 ||
          trace.sink.span.end <= trace.sink.span.start
        ) {
          throw new TypeError(
            `${label} components[${componentIndex}].roots[${rootIndex}].traces[${traceIndex}] lacks an exact sink span`,
          );
        }
        const source = analyzedAppSources.get(semantic.sourceFile);
        if (trace.sink.span.end > source.codeUnitLength) {
          throw new TypeError(
            `${label} components[${componentIndex}].roots[${rootIndex}].traces[${traceIndex}] escapes its analyzed source`,
          );
        }
        if (trace.sink.door === 'trustedHtml' || trace.sink.door === 'trustedSql') {
          const exactRoot = `${semantic.sourceFile}:${trace.sink.span.start}:${trace.sink.span.end}`;
          const exactBinding = trustBindingsByKind.get(trace.sink.door)?.get(exactRoot);
          if (
            exactBinding === undefined ||
            exactBinding.sourceHash !== source.contentHash ||
            exactBinding.sliceHash !== trace.sink.sliceHash
          ) {
            throw new TypeError(
              `${label} components[${componentIndex}].roots[${rootIndex}].traces[${traceIndex}] lacks its exact ${trace.sink.door} trust fact`,
            );
          }
        }
        if (trace.sink.door !== 'ctx.fetch') continue;
        addRoot('ctx.fetch', semanticRoot.root, {
          encoding: 'utf16le',
          file: semantic.sourceFile,
          sliceHash: trace.sink.sliceHash,
          sourceHash: source.contentHash,
          sourceLength: source.codeUnitLength,
          span: { end: trace.sink.span.end, start: trace.sink.span.start },
        });
      }
    }
    for (const handlerRoot of handlerRoots) {
      if (!semanticRoots.has(handlerRoot)) {
        throw new TypeError(
          `${label} components[${componentIndex}] handler root ${handlerRoot} lacks a semantic root`,
        );
      }
    }
    for (const semanticRoot of semanticRoots) {
      if (!handlerRoots.has(semanticRoot)) {
        throw new TypeError(
          `${label} components[${componentIndex}] semantic root ${semanticRoot} lacks a handler-root operation`,
        );
      }
    }
  }

  for (const [mutationIndex, mutation] of graph.mutations.entries()) {
    if (!record(mutation)) {
      throw new TypeError(`${label} mutations[${mutationIndex}] is malformed`);
    }
    if (mutation.csrf !== 'exempt') continue;
    const key = reviewAuditText(mutation.key, `${label} mutations[${mutationIndex}].key`);
    const countedRoot = `mutation:${key}`;
    const sites = csrfSitesByCountedRoot.get(countedRoot);
    if (!(sites instanceof Map) || sites.size === 0) {
      throw new TypeError(`${label} csrf-exempt mutation ${key} lacks producer sites`);
    }
    for (const site of sites.values()) addRoot('csrf:false', countedRoot, site);
  }
  for (const countedRoot of csrfSitesByCountedRoot.keys()) {
    if (!executableCsrfRoots.has(countedRoot)) {
      throw new TypeError(`${label} carries a csrf producer relation for an uncounted root`);
    }
  }

  const subjects = [...roots.values()]
    .sort((left, right) =>
      left.door === right.door
        ? compareCodeUnits(left.root, right.root)
        : compareCodeUnits(left.door, right.door),
    )
    .map((entry) => ({
      artifactSubject,
      door: entry.door,
      root: entry.root,
      schema: 'kovo.escape-census-review/v1',
      sites: [...entry.sites.entries()]
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([, site]) => site),
    }));
  return { artifactSubject, schema: 'kovo.escape-census-review-subjects/v1', subjects };
}

function reviewExecutableCsrfRoots(value, label) {
  const roots = new Set();
  for (const [index, mutation] of value.entries()) {
    if (!record(mutation)) throw new TypeError(`${label} mutations[${index}] is malformed`);
    if (mutation.csrf !== 'exempt') continue;
    const key = reviewAuditText(mutation.key, `${label} mutations[${index}].key`);
    roots.add(`mutation:${key}`);
  }
  return roots;
}

function exactCountedCsrfRoot(escape, executableRoots) {
  if (nonBlank(escape.root) && executableRoots.has(escape.root)) return escape.root;
  if (!nonBlank(escape.source) || !record(escape.sourceBinding)) return undefined;
  const candidate = `mutation:${derivedRegistryKey(escape.sourceBinding.file, escape.source)}`;
  return executableRoots.has(candidate) ? candidate : undefined;
}

function derivedRegistryKey(file, binding) {
  const normalized = file.replace(/\\/gu, '/').replace(/\.[^./]+$/u, '');
  const parts = normalized.split('/').filter((part) => part.length > 0);
  let root = -1;
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index] === 'src') root = index;
    if (
      index <= parts.length - 3 &&
      parts[index] === 'tests' &&
      parts[index + 1] === 'integration' &&
      parts[index + 2] === 'fixtures'
    ) {
      root = index + 2;
      break;
    }
  }
  const namespace = parts
    .slice(root + 1)
    .map(kebabRegistryPart)
    .join('/');
  const leaf = kebabRegistryPart(binding);
  return namespace.length === 0 ? leaf : `${namespace}/${leaf}`;
}

function kebabRegistryPart(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .replace(/_/gu, '-')
    .toLowerCase();
}

function reviewAuditText(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 4_096 ||
    value.trim() !== value
  ) {
    throw new TypeError(`${label} must be exact printable audit text`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x061c ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x2028 && code <= 0x202e) ||
      (code >= 0x2060 && code <= 0x206f) ||
      code === 0xfeff
    ) {
      throw new TypeError(`${label} must be exact printable audit text`);
    }
  }
  return value;
}

function reviewAnalysisInputs(value, label) {
  if (
    !record(value) ||
    !exactRecordKeys(value, ['runtimeTarget', 'schema', 'sources']) ||
    value.schema !== 'kovo.analysis.inputs/v1' ||
    !['cloudflare', 'node', 'vercel'].includes(value.runtimeTarget) ||
    !Array.isArray(value.sources)
  ) {
    throw new TypeError(`${label} lacks its exact analyzed-source input manifest`);
  }
  const appSources = new Map();
  let previousKey;
  for (const [index, source] of value.sources.entries()) {
    if (
      !record(source) ||
      !exactRecordKeys(source, ['codeUnitLength', 'contentHash', 'encoding', 'path', 'role']) ||
      !Number.isSafeInteger(source.codeUnitLength) ||
      source.codeUnitLength < 0 ||
      typeof source.contentHash !== 'string' ||
      !/^sha256:[a-f0-9]{64}$/u.test(source.contentHash) ||
      source.encoding !== 'utf16le' ||
      !exactRelativeAnalysisPath(source.path) ||
      !['app', 'client-entry', 'config'].includes(source.role)
    ) {
      throw new TypeError(`${label} analysisInputs.sources[${index}] is malformed`);
    }
    const key = `${source.role}\u0000${source.path}`;
    if (previousKey !== undefined && compareCodeUnits(previousKey, key) >= 0) {
      throw new TypeError(`${label} analysis inputs must be uniquely code-unit sorted`);
    }
    previousKey = key;
    if (source.role === 'app') {
      appSources.set(source.path, {
        codeUnitLength: source.codeUnitLength,
        contentHash: source.contentHash,
      });
    }
  }
  if (appSources.size === 0) throw new TypeError(`${label} analysis inputs contain no app source`);
  return appSources;
}

function reviewSite(value, label) {
  if (
    !record(value) ||
    !exactRecordKeys(value, [
      'encoding',
      'file',
      'sliceHash',
      'sourceHash',
      'sourceLength',
      'span',
    ]) ||
    value.encoding !== 'utf16le' ||
    !exactRelativeAnalysisPath(value.file) ||
    typeof value.sliceHash !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/u.test(value.sliceHash) ||
    typeof value.sourceHash !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/u.test(value.sourceHash) ||
    !Number.isSafeInteger(value.sourceLength) ||
    value.sourceLength < 0 ||
    !record(value.span) ||
    !exactRecordKeys(value.span, ['end', 'start']) ||
    !Number.isSafeInteger(value.span.start) ||
    !Number.isSafeInteger(value.span.end) ||
    value.span.start < 0 ||
    value.span.end <= value.span.start ||
    value.span.end > value.sourceLength
  ) {
    throw new TypeError(`${label} lacks an exact analyzed-source identity`);
  }
  return {
    encoding: 'utf16le',
    file: value.file,
    sliceHash: value.sliceHash,
    sourceHash: value.sourceHash,
    sourceLength: value.sourceLength,
    span: { end: value.span.end, start: value.span.start },
  };
}

function exactRelativeAnalysisPath(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 4_096 ||
    value.trim() !== value ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.includes(':')
  ) {
    return false;
  }
  const parts = value.split('/');
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x061c ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x2028 && code <= 0x202e) ||
      (code >= 0x2060 && code <= 0x206f) ||
      code === 0xfeff
    ) {
      return false;
    }
  }
  return true;
}

function reviewTrustEscapeSite(escape, label, analyzedAppSources) {
  const site = reviewAuditText(escape.site, `${label}.site`);
  const binding = escape.sourceBinding;
  if (
    !record(binding) ||
    !exactRecordKeys(binding, ['encoding', 'file', 'sliceHash', 'sourceHash', 'span']) ||
    binding.encoding !== 'utf16le' ||
    !nonBlank(binding.file) ||
    typeof binding.sourceHash !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/u.test(binding.sourceHash) ||
    typeof binding.sliceHash !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/u.test(binding.sliceHash) ||
    !record(binding.span) ||
    !exactRecordKeys(binding.span, ['end', 'start']) ||
    !Number.isSafeInteger(binding.span.start) ||
    !Number.isSafeInteger(binding.span.end) ||
    binding.span.start < 0 ||
    binding.span.end <= binding.span.start ||
    !exactRelativeAnalysisPath(binding.file) ||
    analyzedAppSources.get(binding.file) === undefined ||
    binding.sourceHash !== analyzedAppSources.get(binding.file)?.contentHash ||
    binding.span.end > analyzedAppSources.get(binding.file)?.codeUnitLength ||
    !site.startsWith(`${binding.file}:`) ||
    !/^[1-9][0-9]*$/u.test(site.slice(binding.file.length + 1)) ||
    (escape.kind !== 'csrfFalse' &&
      escape.root !== `${binding.file}:${binding.span.start}:${binding.span.end}`)
  ) {
    throw new TypeError(`${label} lacks an exact UTF-16 source binding`);
  }
  const source = analyzedAppSources.get(binding.file);
  return {
    encoding: 'utf16le',
    file: binding.file,
    sliceHash: binding.sliceHash,
    sourceHash: source.contentHash,
    sourceLength: source.codeUnitLength,
    span: { end: binding.span.end, start: binding.span.start },
  };
}

function exactRecordKeys(value, expected) {
  const keys = Object.keys(value).sort(compareCodeUnits);
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Match the build-owned canonical graph serialization without trusting graph.runtimePosture. */
function canonicalArtifactJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('artifact subject graph must be finite JSON');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalArtifactJson(entry)).join(',')}]`;
  }
  if (record(value)) {
    return `{${Object.keys(value)
      .sort(compareCodeUnits)
      .map((key) => `${JSON.stringify(key)}:${canonicalArtifactJson(value[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('artifact subject graph must be exact JSON data');
}

function exactJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requireExact(value, expected, label) {
  if (!exactJson(value, expected)) {
    throw new Error(
      `${label} drifted\nexpected=${JSON.stringify(expected)}\nactual=${JSON.stringify(value)}`,
    );
  }
}

function appInput(inputs, app) {
  const match = inputs.apps.find((entry) => entry.app === app);
  if (!match) throw new Error(`negative check names unknown app ${JSON.stringify(app)}`);
  return match;
}

function negativeBudgetFindings(inputs, check, report) {
  if (!ESCAPE_CENSUS_DOORS.includes(check.door)) {
    throw new Error(`budget-ceiling names unsupported door ${JSON.stringify(check.door)}`);
  }
  const packageReport = report.packages.find((entry) => entry.package === check.package);
  const count = packageReport?.doors?.[check.door];
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new Error('budget-ceiling must target a non-zero observed escape count');
  }
  const candidate = structuredClone(inputs);
  const packageBudgets = candidate.budgets?.packages?.[check.package];
  if (!record(packageBudgets)) {
    throw new Error(`budget-ceiling names unknown package ${JSON.stringify(check.package)}`);
  }
  packageBudgets[check.door] = count - 1;
  return evaluateEscapeCensus(candidate).findings;
}

function negativeProvenanceFindings(inputs, check, wrongSource) {
  const candidate = structuredClone(inputs);
  const graph = appInput(candidate, check.app).graph;
  if (!record(graph)) throw new Error(`${check.id} requires an object graph`);
  if (wrongSource) {
    if (!ESCAPE_CENSUS_DOORS.includes(check.door)) {
      throw new Error(`${check.id} names unsupported door ${JSON.stringify(check.door)}`);
    }
    if (!record(graph.escapeCensus?.sources)) {
      throw new Error(`${check.id} requires producer provenance to mutate`);
    }
    graph.escapeCensus.sources[check.door] = 'unreviewed-producer';
  } else {
    delete graph.escapeCensus;
  }
  return evaluateEscapeCensus(candidate).findings;
}

/**
 * Verify the exact report and the persisted, fail-closed negative controls. Metric E measures
 * declared escape authority; it remains narrower than the framework's security proof (SPEC §2).
 */
export function verifyEscapeCensusBaseline({ baseline, inputs, reviewSubjects }) {
  if (!record(baseline) || baseline.schema !== 'kovo.escape-census-baseline/v2') {
    throw new TypeError('baseline must use kovo.escape-census-baseline/v2');
  }
  requireExact(baseline.command, ESCAPE_CENSUS_BASELINE_COMMAND, 'baseline command');
  requireExact(baseline.gateCommand, ESCAPE_CENSUS_GATE_COMMAND, 'baseline gate command');
  requireExact(baseline.config, ESCAPE_CENSUS_BASELINE_CONFIG, 'baseline config path');
  requireExact(baseline.predecessor, ESCAPE_CENSUS_PREDECESSOR, 'baseline predecessor anchor');

  const result = evaluateEscapeCensus(inputs);
  if (result.findings.length > 0) {
    throw new Error(`representative census failed:\n${result.findings.join('\n')}`);
  }
  requireExact(result.report, baseline.report, 'escape census baseline report');
  if (!Array.isArray(reviewSubjects)) {
    throw new TypeError('current build escape-census review subjects must be an array');
  }
  const producerSubjects = inputs.apps.map((entry, index) => ({
    app: entry.app,
    manifest: deriveEscapeCensusReviewManifest(entry.graph, `apps[${index}] graph`),
    package: entry.package,
  }));
  requireExact(
    reviewSubjects,
    producerSubjects,
    'escape census review subjects versus independent producer oracle',
  );
  requireExact(reviewSubjects, baseline.reviewSubjects, 'escape census baseline review subjects');

  if (!Array.isArray(baseline.negativeChecks)) {
    throw new TypeError('baseline.negativeChecks must be an array');
  }
  requireExact(
    baseline.negativeChecks.map((check) => check?.id),
    expectedNegativeCheckIds,
    'baseline negative-check membership',
  );
  for (const check of baseline.negativeChecks) {
    if (!record(check) || !Array.isArray(check.expectedFindings)) {
      throw new TypeError('each baseline negative check must declare expectedFindings');
    }
    const findings =
      check.id === 'budget-ceiling'
        ? negativeBudgetFindings(inputs, check, result.report)
        : negativeProvenanceFindings(inputs, check, check.id === 'wrong-producer-provenance');
    requireExact(findings, check.expectedFindings, `negative check ${check.id}`);
  }
  return result.report;
}

export function buildEscapeCensusRepresentativeApp() {
  rmSync(fixtureCache, { force: true, recursive: true });
  rmSync(fixtureOut, { force: true, recursive: true });
  const frameworkModules = resolve(fixtureRoot, 'node_modules/@kovojs');
  rmSync(resolve(fixtureRoot, 'node_modules'), { force: true, recursive: true });
  mkdirSync(frameworkModules, { recursive: true });
  symlinkSync(resolve(repoRoot, 'packages/browser'), resolve(frameworkModules, 'browser'));
  symlinkSync(resolve(repoRoot, 'packages/core'), resolve(frameworkModules, 'core'));
  symlinkSync(resolve(repoRoot, 'packages/server'), resolve(frameworkModules, 'server'));
  const cli = resolve(repoRoot, 'packages/cli/src/bin.ts');
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      cli,
      'build',
      fixtureApp,
      '--out',
      fixtureOut,
      '--preset',
      'node',
    ],
    {
      cwd: fixtureRoot,
      encoding: 'utf8',
      env: { ...process.env, VERCEL: '1' },
    },
  );
  if (result.error || result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(nonBlank).join('\n');
    throw new Error(
      `representative kovo build failed${result.error ? `: ${result.error.message}` : ''}${detail ? `\n${detail}` : ''}`,
    );
  }
  if (!existsSync(resolve(fixtureCache, 'cache/tsc-preflight.tsbuildinfo'))) {
    throw new Error('representative kovo build did not execute its local TypeScript preflight');
  }
  const graphPath = resolve(fixtureOut, '.kovo/graph.json');
  if (!existsSync(graphPath)) throw new Error('representative kovo build emitted no graph.json');
  return graphPath;
}

export function runEscapeCensusBaseline({
  baselinePath = defaultBaselinePath,
  build = true,
  configPath = defaultConfigPath,
} = {}) {
  if (build) buildEscapeCensusRepresentativeApp();
  const baseline = readJson(resolve(baselinePath), 'escape census baseline');
  const inputs = loadEscapeCensusInputs(configPath);
  const reviewSubjects = loadEscapeCensusReviewSubjects(configPath);
  const report = verifyEscapeCensusBaseline({ baseline, inputs, reviewSubjects });

  const output = { stderr: '', stdout: '' };
  const io = {
    stderr: { write: (chunk) => (output.stderr += String(chunk)) },
    stdout: { write: (chunk) => (output.stdout += String(chunk)) },
  };
  const gateCode = runEscapeCensusCli(['--config', resolve(configPath)], io);
  if (gateCode !== 0 || output.stderr !== '') {
    throw new Error(`persisted gate command failed\n${output.stderr}`);
  }
  requireExact(output.stdout, formatEscapeCensusReport(report), 'persisted gate output');

  process.stdout.write(
    [
      'kovo.escape-census-baseline/v2',
      `COMMAND ${ESCAPE_CENSUS_BASELINE_COMMAND}`,
      `GATE ${ESCAPE_CENSUS_GATE_COMMAND}`,
      output.stdout.trimEnd(),
      ...expectedNegativeCheckIds.map((id) => `NEGATIVE id=${id} OK`),
      'OK',
      '',
    ].join('\n'),
  );
  return 0;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = runEscapeCensusBaseline();
  } catch (error) {
    process.stderr.write(
      `Escape census baseline failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
