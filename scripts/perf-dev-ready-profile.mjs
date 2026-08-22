#!/usr/bin/env node
/**
 * Authenticated cold-first-ready diagnostics for the rejected query-identity development spike.
 *
 * This runner is deliberately not an acceptance benchmark. It profiles one paused-before-user-code
 * N=216 fresh-ready window in each fixed B,S,S,B cell, and publishes perturbed wall/RSS values only
 * as diagnostic context. Exact candidate preparation, source/lock custody, packed-product identity,
 * corpus verification, host admission, process ownership, and browser-visible readiness come from
 * the existing development benchmark machinery.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  realpathSync,
  readSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chromium } from 'playwright';

import {
  cleanGeneratedOutputs,
  DEV_PROFILED_PROCESS_INVOCATION_SCHEMA,
  launchDevSessionAfterHandoff,
  loadCorpusManifest,
  materializeEntrantCommand,
  measureFreshReady,
  normalizedFreshReadyFailureStage,
  verifyCorpusSources,
} from '../benchmarks/corpora/dev-loop.mjs';
import { DEV_SESSION_PORT_STRIDE } from '../benchmarks/corpora/generate.mjs';
import {
  DEFAULT_DEV_PORT_BASE,
  inspectDevPortAllocation,
  validateDevPortAllocationEvidence,
} from '../benchmarks/harness/dev-port-allocation.mjs';
import {
  connectPausedDevInspector,
  DEV_PAUSED_INSPECTOR_BOOTSTRAP_SCHEMA,
} from './perf-dev-edit-profile.mjs';
import {
  acquireTimingLock,
  collectWorktreeState,
  createDevGenerationHostAdmission,
  DEV_CRITICAL_PATH_CANDIDATE,
  DEV_GENERATION_CANDIDATE_BINDING_SCHEMA,
  inspectGeneratedDevCorpus,
  prepareDevGenerationSpike,
  sampleHostLoad,
  worktreeStabilityFindings,
} from './perf-dev-generation-spike.mjs';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { canonicalJson, performanceHostFingerprint } from './lib/perf-host.mjs';
import { verifyPackedKovoProductFixture } from './lib/perf-packed-kovo-product.mjs';
import { validReadyRouteProbe } from './lib/perf-ready-route.mjs';

export const DEV_READY_PROFILE_SCHEMA = 'kovo-dev-ready-profile/v1';
export const DEV_READY_PROFILE_WINDOW_SCHEMA = 'kovo-dev-ready-profile-window/v1';
export const DEV_READY_PROFILE_CPU_ARTIFACT_SCHEMA = 'kovo-dev-ready-profile-cpu/v1';
export const DEV_READY_PROFILE_COVERAGE_ARTIFACT_SCHEMA = 'kovo-dev-ready-profile-coverage/v1';
export const DEV_READY_PROFILE_ANALYSIS_SCHEMA = 'kovo-dev-ready-profile-analysis/v1';
export const DEV_READY_PROFILE_RANKING_SCHEMA = 'kovo-dev-ready-profile-ranking/v1';
export const DEV_READY_PROFILE_CONTROLLER_BINDING_SCHEMA =
  'kovo-dev-ready-profile-controller-binding/v1';
export const DEV_READY_PROFILE_SCHEDULE = Object.freeze([
  Object.freeze({ lane: 'baseline', occurrence: 0, scheduleIndex: 0 }),
  Object.freeze({ lane: 'spike', occurrence: 0, scheduleIndex: 1 }),
  Object.freeze({ lane: 'spike', occurrence: 1, scheduleIndex: 2 }),
  Object.freeze({ lane: 'baseline', occurrence: 1, scheduleIndex: 3 }),
]);

const CPU_SAMPLING_INTERVAL_US = 500;
const MAX_CPU_PROFILE_BYTES = 256 * 1024 * 1024;
const MAX_COVERAGE_BYTES = 128 * 1024 * 1024;
const MAX_COVERAGE_SCRIPTS = 20_000;
const MAX_COVERAGE_FUNCTIONS_PER_SCRIPT = 100_000;
const MAX_COVERAGE_RANGES_PER_FUNCTION = 10_000;
const MAX_EVIDENCE_STRING = 8_192;
const MAX_CONTROLLER_FILE_BYTES = 32 * 1024 * 1024;
const MAX_CONTROLLER_BINDING_BYTES = 4 * 1024 * 1024;
const MAX_ATTRIBUTION_FILE_BYTES = 64 * 1024 * 1024;
const PROFILE_TARGETS = Object.freeze([
  Object.freeze({ name: 'queryPlanBootstrapInputForComponent', required: true }),
  Object.freeze({ name: 'resolveViteComponentQueryRuntimeNames', required: true }),
  Object.freeze({ name: 'resolveComponentQueryRuntimeNames', required: true }),
  Object.freeze({ name: 'queryIdentityCompilerOptions', required: true }),
  Object.freeze({ name: 'exactEntryCompilerHost', required: true }),
  Object.freeze({ name: 'resolveFreshDirectQueryRuntimeNames', required: false }),
  Object.freeze({ name: 'freshDirectImportedQueryRuntimeName', required: false }),
]);
const DIAGNOSTIC_ONLY_POLICY = Object.freeze({
  acceptanceEligible: false,
  cpuSamplingIntervalMicros: CPU_SAMPLING_INTERVAL_US,
  excludedFromAcceptance: Object.freeze([
    'durationMs',
    'paintFenceMs',
    'peakRssBytes',
    'rssSamples',
  ]),
  preciseCoverage: Object.freeze({ callCount: true, detailed: true }),
  profilerPerturbsWallAndRss: true,
  readyWindowsPerCell: 1,
  schedule: 'baseline,spike,spike,baseline',
  status: 'diagnostic-only',
  window: 'paused-before-user-code-through-browser-visible-ready',
});
const CONTROLLER_LOCK_FILES = Object.freeze([
  'pnpm-lock.yaml',
  'benchmarks/nextjs/pnpm-lock.yaml',
  'benchmarks/harness/pnpm-lock.yaml',
]);
const CONTROLLER_FILES = Object.freeze([
  'benchmarks/corpora/dev-loop.mjs',
  'benchmarks/corpora/dev-process-marker.mjs',
  'benchmarks/corpora/generate.mjs',
  'benchmarks/harness/dev-port-allocation.mjs',
  'packages/icons/scripts/icon-plan.mjs',
  'scripts/component-catalog-schema.mjs',
  'scripts/lib/bounded-regular-file.mjs',
  'scripts/lib/cli-entry.mjs',
  'scripts/lib/deterministic-tarball.mjs',
  'scripts/lib/pack-without-lifecycle.mjs',
  'scripts/lib/perf-dev-session-evidence.mjs',
  'scripts/lib/perf-execution.mjs',
  'scripts/lib/perf-host.mjs',
  'scripts/lib/perf-packed-kovo-product.mjs',
  'scripts/lib/perf-provenance.mjs',
  'scripts/lib/perf-ready-route.mjs',
  'scripts/lib/process-tree-rss.mjs',
  'scripts/lib/repo-root.mjs',
  'scripts/package-exports.mjs',
  'scripts/perf-cli-startup-benchmark.mjs',
  'scripts/perf-dev-edit-profile.mjs',
  'scripts/perf-dev-generation-spike.mjs',
  'scripts/perf-dev-ready-profile-bootstrap.mjs',
  'scripts/perf-dev-ready-profile.mjs',
  'scripts/public-packages.mjs',
  'scripts/release-packages.mjs',
]);
const CONTROLLER_MANIFEST_FILE = 'package.json';
const CONTROLLER_BOUND_PATHS = Object.freeze(
  [CONTROLLER_MANIFEST_FILE, ...CONTROLLER_LOCK_FILES, ...CONTROLLER_FILES].sort(),
);
const EXPECTED_PROFILE_FILES = Object.freeze(
  DEV_READY_PROFILE_SCHEDULE.flatMap((cell) => {
    const stem = `cell-${String(cell.scheduleIndex).padStart(3, '0')}-${cell.lane}`;
    return [`${stem}.coverage.json`, `${stem}.cpuprofile`];
  }).sort((left, right) => left.localeCompare(right)),
);
const READY_PROFILE_SEAL_CAPABILITY = Symbol('kovo.dev-ready-profile.seal-capability');
const controllerRoot = realpathSync(fileURLToPath(new URL('..', import.meta.url)));

export function devReadyProfileSchedule(portBase = DEFAULT_DEV_PORT_BASE) {
  boundedPort(portBase, 'profile port base');
  return DEV_READY_PROFILE_SCHEDULE.map((cell) => {
    const port = portBase + cell.scheduleIndex * DEV_SESSION_PORT_STRIDE;
    const inspectorPort = port + 1;
    boundedPort(port, `profile cell ${String(cell.scheduleIndex)} port`);
    boundedPort(inspectorPort, `profile cell ${String(cell.scheduleIndex)} Inspector port`);
    return { ...cell, inspectorPort, port };
  });
}

function normalizeProfilerCellIdentity(value, inspectorPort) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Number.isSafeInteger(value.scheduleIndex) ||
    !Number.isSafeInteger(value.occurrence) ||
    !Number.isSafeInteger(value.port)
  ) {
    throw new TypeError('fresh-ready profiler cell identity is incomplete');
  }
  const scheduled = DEV_READY_PROFILE_SCHEDULE[value.scheduleIndex];
  if (
    scheduled === undefined ||
    value.lane !== scheduled.lane ||
    value.occurrence !== scheduled.occurrence ||
    boundedPort(value.port, 'profile cell port') + 1 !== inspectorPort
  ) {
    throw new Error('fresh-ready profiler cell identity is schedule-confused');
  }
  return {
    inspectorPort,
    lane: value.lane,
    occurrence: value.occurrence,
    port: value.port,
    scheduleIndex: value.scheduleIndex,
  };
}

function normalizeAttributionRoots(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('fresh-ready attribution roots are required');
  }
  const entries = Object.entries(value)
    .map(([label, root]) => {
      if (!/^[a-z][a-z0-9-]{0,31}$/u.test(label)) {
        throw new TypeError('fresh-ready attribution root label is malformed');
      }
      return { label, root: canonicalDirectory(root, `${label} attribution root`) };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
  if (
    entries.length < 1 ||
    new Set(entries.map((entry) => entry.root)).size !== entries.length ||
    entries.some((entry, index) =>
      entries.some(
        (other, otherIndex) =>
          index !== otherIndex &&
          (isWithinOrEqual(entry.root, other.root) || isWithinOrEqual(other.root, entry.root)),
      ),
    )
  ) {
    throw new Error('fresh-ready attribution roots alias or contain one another');
  }
  return entries;
}

function captureReadyAttribution(cpu, coverage, { roots }) {
  const cpuUrls = cpu.nodes.map((node) => node.callFrame.url).filter(isFileBackedRuntimeUrl);
  const coverageUrls = coverage.result.map((script) => script.url).filter(isFileBackedRuntimeUrl);
  return {
    coverage: captureFileUrlCensus(coverageUrls, roots, 'coverage'),
    cpu: captureFileUrlCensus(cpuUrls, roots, 'CPU'),
  };
}

function captureFileUrlCensus(urls, roots, label) {
  const byPath = new Map();
  for (const rawUrl of [...new Set(urls)].sort((left, right) => left.localeCompare(right))) {
    const url = rawUrl.startsWith('file:') ? new URL(rawUrl) : pathToFileURL(rawUrl);
    if (url.protocol !== 'file:') throw new Error(`${label} attribution contains a non-file URL`);
    const filesystemUrl = new URL(url);
    filesystemUrl.search = '';
    filesystemUrl.hash = '';
    const declared = fileURLToPath(filesystemUrl);
    const absolute = realpathSync(declared);
    const matches = roots.filter((entry) => isWithinOrEqual(entry.root, absolute));
    if (matches.length !== 1) {
      throw new Error(`${label} file URL is outside or ambiguous across attribution roots`);
    }
    const existing = byPath.get(absolute);
    if (existing !== undefined) {
      existing.urls.push(rawUrl);
      existing.urls.sort((left, right) => left.localeCompare(right));
      continue;
    }
    const source = readStableReadyProfileFile(
      absolute,
      MAX_ATTRIBUTION_FILE_BYTES,
      `${label} attribution source`,
      { allowMultipleLinks: true },
    );
    const root = matches[0];
    byPath.set(absolute, {
      bytes: source.bytes.byteLength,
      contentBase64: source.bytes.toString('base64'),
      identity: source.identity,
      map: captureSourceMapEvidence(absolute, source.bytes, root, label),
      path: path.relative(root.root, absolute).split(path.sep).join('/'),
      root: root.label,
      sha256: sha256(source.bytes),
      urls: [rawUrl],
    });
  }
  return [...byPath.values()].sort((left, right) =>
    `${left.root}/${left.path}`.localeCompare(`${right.root}/${right.path}`),
  );
}

function isFileBackedRuntimeUrl(value) {
  return typeof value === 'string' && (value.startsWith('file:') || path.isAbsolute(value));
}

function captureSourceMapEvidence(sourcePath, bytes, root, label) {
  const source = bytes.toString('utf8');
  const matches = [
    ...source.matchAll(
      /(?:\/\/[#@]\s*sourceMappingURL=([^\s]+)|\/\*[#@]\s*sourceMappingURL=([^*]+?)\s*\*\/)/gu,
    ),
  ];
  const reference = matches.at(-1)?.[1] ?? matches.at(-1)?.[2] ?? null;
  if (reference === null) return { kind: 'none' };
  if (reference.startsWith('data:')) {
    return { kind: 'inline', sha256: sha256(Buffer.from(reference)), value: reference };
  }
  const mapUrl = new URL(reference, pathToFileURL(sourcePath));
  if (mapUrl.protocol !== 'file:' || mapUrl.search !== '' || mapUrl.hash !== '') {
    throw new Error(`${label} attribution source map URL is not a canonical file URL`);
  }
  const mapPath = realpathSync(fileURLToPath(mapUrl));
  if (!isWithinOrEqual(root.root, mapPath)) {
    throw new Error(`${label} attribution source map escaped its source root`);
  }
  const map = readStableReadyProfileFile(
    mapPath,
    MAX_ATTRIBUTION_FILE_BYTES,
    `${label} attribution source map`,
    { allowMultipleLinks: true },
  );
  return {
    bytes: map.bytes.byteLength,
    contentBase64: map.bytes.toString('base64'),
    identity: map.identity,
    kind: 'file',
    path: path.relative(root.root, mapPath).split(path.sep).join('/'),
    sha256: sha256(map.bytes),
  };
}

/** Start one exact Inspector window while the packed CLI is still paused at `--inspect-brk`. */
export async function createDevReadyProfiler(options, dependencies = {}) {
  const expectedPid = boundedInteger(
    options.expectedPid,
    1,
    Number.MAX_SAFE_INTEGER,
    'expectedPid',
  );
  const inspectorPort = boundedPort(options.inspectorPort, 'Inspector port');
  const processMarker = requiredString(options.processMarker, 'process marker');
  const profileDir = canonicalDirectory(options.profileDir, 'profile directory');
  const artifactStem = boundedArtifactStem(options.artifactStem);
  // The packed launcher deliberately retains its lexical absolute path in argv. On macOS that
  // commonly means `/var/...` while realpath authority is `/private/var/...`. Keep those two
  // identities separate: Inspector authenticates the exact lexical argv, while filesystem
  // containment is proven against canonical paths (SPEC §6.6 rule 6).
  const lexicalConsumerRoot = exactLexicalAbsolutePath(
    options.consumerRoot,
    'packed consumer root',
  );
  const consumerRoot = canonicalDirectory(lexicalConsumerRoot, 'packed consumer root');
  const productDigest = validSha256(options.productDigest, 'packed product digest');
  const expectedEntrypoint = exactLexicalAbsolutePath(
    options.expectedEntrypoint,
    'packed CLI entrypoint',
  );
  authenticatePackedEntrypointPath({
    canonicalConsumerRoot: consumerRoot,
    expectedEntrypoint,
    lexicalConsumerRoot,
  });
  const cell = normalizeProfilerCellIdentity(options.cell, inspectorPort);
  const attributionRoots = normalizeAttributionRoots(
    options.attributionRoots ?? { consumer: consumerRoot },
  );
  const reservation = reserveArtifactStem(profileDir, artifactStem);
  let session;
  try {
    session = await (dependencies.connectInspector ?? connectPausedDevInspector)({
      expectedDevPort: cell.port,
      expectedEntrypoint,
      expectedPid,
      inspectorPort,
      invocation: options.inspectorInvocation,
      processMarker,
      samplingIntervalMicros: CPU_SAMPLING_INTERVAL_US,
    });
    validateReadyInspectorIdentity(session?.identity, { expectedPid, processMarker });
    if (
      typeof session.close !== 'function' ||
      typeof session.send !== 'function' ||
      typeof session.startAndResume !== 'function'
    ) {
      throw new Error('fresh-ready Inspector session omitted its one-shot profiling capability');
    }
    const invocation = session.invocation;
    const binding = {
      bootstrap: session.identity.bootstrap,
      cell,
      inspectorProcess: {
        pid: expectedPid,
        processMarkerSha256: sha256(Buffer.from(processMarker)),
        targetId: session.identity.targetId,
      },
      invocation,
      productDigest,
      schema: 'kovo-dev-ready-profile-window-binding/v1',
    };
    if (!validReadyInspectorBinding(binding, inspectorPort)) {
      throw new Error('Inspector target was not the exact paused packed CLI invocation');
    }
    let active = false;
    let closed = false;
    let captured = false;

    async function closeSession() {
      if (closed) return;
      closed = true;
      try {
        session.close();
      } finally {
        reservation.release();
      }
    }

    async function startAndResume() {
      if (closed || active || captured) throw new Error('fresh-ready profiler cannot be restarted');
      try {
        await session.startAndResume();
        active = true;
      } catch (error) {
        await abort();
        throw error;
      }
    }

    async function captureAtReady() {
      if (!active || closed || captured) {
        throw new Error('fresh-ready profiler has no active window to capture');
      }
      const [cpuResult, coverageResult] = await Promise.all([
        session.send('Profiler.stop'),
        session.send('Profiler.takePreciseCoverage'),
      ]);
      await session.send('Profiler.stopPreciseCoverage');
      active = false;
      const cpu = validateReadyCpuProfile(cpuResult?.profile);
      const coverage = validateReadyPreciseCoverage(coverageResult);
      const callEvidence = exactReadyCallEvidence(coverage, { consumerRoot });
      const attribution = captureReadyAttribution(cpu, coverage, { roots: attributionRoots });
      const cpuArtifact = {
        attribution: attribution.cpu,
        binding,
        profile: cpu,
        schema: DEV_READY_PROFILE_CPU_ARTIFACT_SCHEMA,
      };
      const coverageArtifact = {
        attribution: attribution.coverage,
        binding,
        calls: callEvidence.calls,
        coverage,
        product: { digest: productDigest, scriptAssets: callEvidence.scriptAssets },
        schema: DEV_READY_PROFILE_COVERAGE_ARTIFACT_SCHEMA,
      };
      const cpuBytes = serializedArtifactBytes(cpuArtifact, MAX_CPU_PROFILE_BYTES, 'CPU profile');
      const coverageBytes = serializedArtifactBytes(
        coverageArtifact,
        MAX_COVERAGE_BYTES,
        'precise coverage',
      );
      const artifact = reservation.write(cpuBytes, coverageBytes);
      artifact.cpu.schema = DEV_READY_PROFILE_CPU_ARTIFACT_SCHEMA;
      artifact.coverage.schema = DEV_READY_PROFILE_COVERAGE_ARTIFACT_SCHEMA;
      captured = true;
      await closeSession();
      return {
        artifact,
        attribution,
        binding,
        calls: callEvidence.calls,
        diagnosticOnly: DIAGNOSTIC_ONLY_POLICY,
        inspectorProcess: {
          ...binding.inspectorProcess,
        },
        invocation,
        product: {
          digest: productDigest,
          scriptAssets: callEvidence.scriptAssets,
        },
        schema: DEV_READY_PROFILE_WINDOW_SCHEMA,
      };
    }

    async function abort() {
      if (closed) return;
      if (active) {
        await Promise.allSettled([
          session.send('Profiler.stop'),
          session.send('Profiler.stopPreciseCoverage'),
        ]);
        active = false;
      }
      await closeSession();
    }

    return { abort, captureAtReady, startAndResume };
  } catch (error) {
    try {
      session?.close?.();
    } finally {
      reservation.release();
    }
    throw error;
  }
}

export function validateReadyCpuProfile(profile) {
  if (
    profile === null ||
    typeof profile !== 'object' ||
    !Array.isArray(profile.nodes) ||
    profile.nodes.length === 0 ||
    !Array.isArray(profile.samples) ||
    profile.samples.length === 0 ||
    !Array.isArray(profile.timeDeltas) ||
    profile.timeDeltas.length !== profile.samples.length ||
    !Number.isSafeInteger(profile.startTime) ||
    !Number.isSafeInteger(profile.endTime) ||
    profile.endTime < profile.startTime
  ) {
    throw new TypeError('fresh-ready CPU profile is incomplete');
  }
  const ids = new Set();
  for (const node of profile.nodes) {
    if (
      !Number.isSafeInteger(node?.id) ||
      node.id < 1 ||
      ids.has(node.id) ||
      node.callFrame === null ||
      typeof node.callFrame !== 'object' ||
      typeof node.callFrame.functionName !== 'string' ||
      typeof node.callFrame.url !== 'string' ||
      !(node.children === undefined || Array.isArray(node.children)) ||
      (Array.isArray(node.children) && new Set(node.children).size !== node.children.length)
    ) {
      throw new TypeError('fresh-ready CPU profile contains a malformed or duplicate node');
    }
    ids.add(node.id);
  }
  if (
    profile.samples.some((id) => !Number.isSafeInteger(id) || !ids.has(id)) ||
    profile.timeDeltas.some((delta) => !Number.isSafeInteger(delta)) ||
    profile.nodes.some((node) => (node.children ?? []).some((id) => !ids.has(id)))
  ) {
    throw new TypeError('fresh-ready CPU samples do not match their node/time census');
  }
  return profile;
}

export function validateReadyPreciseCoverage(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    !finiteNonNegative(value.timestamp) ||
    !Array.isArray(value.result) ||
    value.result.length === 0 ||
    value.result.length > MAX_COVERAGE_SCRIPTS
  ) {
    throw new TypeError('fresh-ready precise coverage is incomplete');
  }
  const scriptIds = new Set();
  for (const script of value.result) {
    if (
      typeof script?.scriptId !== 'string' ||
      script.scriptId.length === 0 ||
      script.scriptId.length > 256 ||
      scriptIds.has(script.scriptId) ||
      typeof script.url !== 'string' ||
      script.url.length > MAX_EVIDENCE_STRING ||
      !Array.isArray(script.functions) ||
      script.functions.length > MAX_COVERAGE_FUNCTIONS_PER_SCRIPT
    ) {
      throw new TypeError('fresh-ready precise coverage contains a malformed script');
    }
    scriptIds.add(script.scriptId);
    for (const fn of script.functions) validateCoverageFunction(fn);
  }
  return value;
}

export function exactReadyCallEvidence(coverage, { consumerRoot }) {
  validateReadyPreciseCoverage(coverage);
  const canonicalConsumerRoot = canonicalDirectory(consumerRoot, 'packed consumer root');
  const assets = new Map();
  const calls = [];
  for (const target of PROFILE_TARGETS) {
    const instances = [];
    for (const script of coverage.result) {
      for (const fn of script.functions) {
        if (fn.functionName !== target.name) continue;
        const asset = authenticatedCoverageAsset(script.url, canonicalConsumerRoot);
        const outer = outerCoverageRange(fn.ranges);
        if (!bundleRangeDeclaresFunction(asset.source, outer, target.name)) {
          throw new Error(
            `precise coverage range for ${target.name} does not match its authenticated script`,
          );
        }
        assets.set(asset.relativePath, asset.evidence);
        instances.push({
          callCount: outer.count,
          ranges: fn.ranges.map((range) => ({ ...range })),
          script: asset.relativePath,
          scriptId: script.scriptId,
        });
      }
    }
    if (target.required && instances.length === 0) {
      throw new Error(`precise coverage omitted required production function ${target.name}`);
    }
    calls.push({
      callCount: instances.reduce((total, instance) => total + instance.callCount, 0),
      instances,
      name: target.name,
      present: instances.length > 0,
      required: target.required,
    });
  }
  return {
    calls,
    scriptAssets: [...assets.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([file, evidence]) => ({ file, ...evidence })),
  };
}

/** Rank only Inspector sample/call counts; profiled wall time is intentionally excluded. */
export function analyzeReadyProfileEvidence(cpu, coverage, attribution) {
  return classifyReadyProfileEvidence(cpu, coverage, attribution).ranking;
}

function classifyReadyProfileEvidence(cpu, coverage, attribution) {
  validateReadyCpuProfile(cpu);
  validateReadyPreciseCoverage(coverage);
  if (!validRetainedAttribution(attribution)) {
    throw new Error('ready-profile ranking requires authenticated retained attribution');
  }
  const cpuUrls = authenticatedRuntimeUrls(attribution.cpu, 'CPU');
  const coverageUrls = authenticatedRuntimeUrls(attribution.coverage, 'coverage');
  const cpuEntries = new Map();
  const callEntries = new Map();
  const nodes = new Map(cpu.nodes.map((node) => [node.id, node]));
  let idleSamples = 0;
  let unattributedSamples = 0;
  for (const nodeId of cpu.samples) {
    const frame = nodes.get(nodeId).callFrame;
    if (frame.functionName === '(idle)') {
      idleSamples += 1;
      continue;
    }
    const source = cpuUrls.get(frame.url);
    if (source === undefined) {
      if (isFileBackedRuntimeUrl(frame.url)) {
        throw new Error('ready-profile CPU ranking found an unauthenticated file-backed frame');
      }
      unattributedSamples += 1;
      continue;
    }
    if (
      !Number.isSafeInteger(frame.lineNumber) ||
      frame.lineNumber < 0 ||
      !Number.isSafeInteger(frame.columnNumber) ||
      frame.columnNumber < 0
    ) {
      throw new Error('ready-profile CPU ranking found a malformed frame position');
    }
    const identity = {
      columnNumber: frame.columnNumber,
      functionName: frame.functionName.length === 0 ? '(anonymous)' : frame.functionName,
      lineNumber: frame.lineNumber,
      path: source.path,
      root: source.root,
    };
    addRankedCount(cpuEntries, identity, 'selfSamples', 1);
  }

  let authenticatedFunctions = 0;
  let unattributedFunctions = 0;
  let authenticatedCallCount = 0;
  let unattributedCallCount = 0;
  for (const script of coverage.result) {
    const source = coverageUrls.get(script.url);
    if (source === undefined && isFileBackedRuntimeUrl(script.url)) {
      throw new Error('ready-profile call ranking found an unauthenticated file-backed script');
    }
    for (const fn of script.functions) {
      const range = outerCoverageRange(fn.ranges);
      if (source === undefined) {
        unattributedFunctions += 1;
        unattributedCallCount = safeEvidenceSum(
          unattributedCallCount,
          range.count,
          'unattributed coverage calls',
        );
        continue;
      }
      authenticatedFunctions += 1;
      authenticatedCallCount = safeEvidenceSum(
        authenticatedCallCount,
        range.count,
        'authenticated coverage calls',
      );
      const identity = {
        endOffset: range.endOffset,
        functionName: fn.functionName.length === 0 ? '(anonymous)' : fn.functionName,
        path: source.path,
        root: source.root,
        startOffset: range.startOffset,
      };
      addRankedCount(callEntries, identity, 'callCount', range.count);
    }
  }
  const rankedSamples = [...cpuEntries.values()].reduce(
    (total, entry) => safeEvidenceSum(total, entry.selfSamples, 'ranked CPU samples'),
    0,
  );
  const totalSamples = safeEvidenceSum(
    safeEvidenceSum(rankedSamples, idleSamples, 'CPU sample census'),
    unattributedSamples,
    'CPU sample census',
  );
  if (totalSamples !== cpu.samples.length) {
    throw new Error('ready-profile CPU ranking census does not close');
  }
  const ranking = readyProfileRanking(
    {
      census: {
        authenticatedFrames: cpuEntries.size,
        idleSamples,
        rankedSamples,
        totalSamples,
        unattributedSamples,
      },
      entries: cpuEntries,
    },
    {
      census: {
        authenticatedCallCount,
        authenticatedFunctions,
        authenticatedIdentities: callEntries.size,
        totalCallCount: safeEvidenceSum(
          authenticatedCallCount,
          unattributedCallCount,
          'coverage call census',
        ),
        totalFunctions: safeEvidenceSum(
          authenticatedFunctions,
          unattributedFunctions,
          'coverage function census',
        ),
        unattributedCallCount,
        unattributedFunctions,
      },
      entries: callEntries,
    },
  );
  return { callEntries, cpuEntries, ranking };
}

function authenticatedRuntimeUrls(entries, label) {
  if (!Array.isArray(entries)) throw new Error(`${label} attribution census is missing`);
  const urls = new Map();
  for (const entry of entries) {
    if (
      typeof entry?.root !== 'string' ||
      !/^[a-z][a-z0-9-]{0,31}$/u.test(entry.root) ||
      typeof entry.path !== 'string' ||
      entry.path.length === 0 ||
      entry.path.length > MAX_EVIDENCE_STRING ||
      !validPortableRankPath(entry.path) ||
      !Array.isArray(entry.urls) ||
      entry.urls.length === 0
    ) {
      throw new Error(`${label} attribution identity is malformed`);
    }
    for (const url of entry.urls) {
      if (typeof url !== 'string' || !isFileBackedRuntimeUrl(url) || urls.has(url)) {
        throw new Error(`${label} attribution URL census is malformed or duplicate`);
      }
      urls.set(url, { path: entry.path, root: entry.root });
    }
  }
  return urls;
}

function addRankedCount(entries, identity, countName, count) {
  const key = canonicalJson(identity);
  const existing = entries.get(key);
  entries.set(key, {
    [countName]: safeEvidenceSum(existing?.[countName] ?? 0, count, countName),
    identity,
  });
}

function safeEvidenceSum(left, right, label) {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(`ready-profile ${label} exceeded its integer evidence bound`);
  }
  return result;
}

function readyProfileRanking(cpu, calls) {
  const topFive = (entries, countName) =>
    [...entries.values()]
      .sort(
        (left, right) =>
          right[countName] - left[countName] ||
          compareEvidenceStrings(canonicalJson(left.identity), canonicalJson(right.identity)),
      )
      .slice(0, 5)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
  return {
    calls: { census: calls.census, topFive: topFive(calls.entries, 'callCount') },
    cpu: { census: cpu.census, topFive: topFive(cpu.entries, 'selfSamples') },
    schema: DEV_READY_PROFILE_RANKING_SCHEMA,
  };
}

export function attachReadyProfileSealCapability(cell, roots) {
  if (
    cell === null ||
    typeof cell !== 'object' ||
    cell[READY_PROFILE_SEAL_CAPABILITY] !== undefined
  ) {
    throw new TypeError('fresh-ready seal capability target is invalid or already bound');
  }
  const normalized = normalizeAttributionRoots(roots);
  Object.defineProperty(cell, READY_PROFILE_SEAL_CAPABILITY, {
    configurable: false,
    enumerable: false,
    value: Object.freeze({
      roots: Object.freeze(
        Object.fromEntries(normalized.map((entry) => [entry.label, entry.root])),
      ),
    }),
    writable: false,
  });
  return cell;
}

/** Re-open and authenticate the exact eight raw files before packed consumers are cleaned. */
export function sealDevReadyProfileArtifacts(options, dependencies = {}) {
  const profileDir = canonicalDirectory(options.profileDir, 'profile artifact directory');
  const schedule = options.schedule;
  const cells = options.cells;
  if (
    !Array.isArray(schedule) ||
    schedule.length !== DEV_READY_PROFILE_SCHEDULE.length ||
    !Array.isArray(cells) ||
    cells.length !== schedule.length
  ) {
    throw new Error('fresh-ready artifact seal requires the complete serialized schedule');
  }
  const directoryBefore = lstatSync(profileDir, { bigint: true });
  if (!directoryBefore.isDirectory() || directoryBefore.isSymbolicLink()) {
    throw new Error('fresh-ready artifact root is not a non-symlink directory');
  }
  const entries = readdirSync(profileDir, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort((left, right) => left.localeCompare(right));
  if (
    entries.some((entry) => !entry.isFile() || entry.isSymbolicLink()) ||
    canonicalJson(names) !== canonicalJson(EXPECTED_PROFILE_FILES)
  ) {
    throw new Error('fresh-ready artifact directory does not contain the exact eight-file census');
  }
  dependencies.afterDirectoryCensus?.({ profileDir });
  const readStable = dependencies.readStableFile ?? readStableReadyProfileFile;
  const inodeOwners = new Set();
  const sealedCells = [];
  const classifiedCells = [];
  for (let index = 0; index < schedule.length; index += 1) {
    const expected = schedule[index];
    const cell = cells[index];
    validateReadyProfileCell(cell, expected);
    const capability = cell[READY_PROFILE_SEAL_CAPABILITY];
    if (capability === undefined) {
      throw new Error('fresh-ready cell omitted its private seal capability');
    }
    const roots = normalizeAttributionRoots(capability.roots);
    const consumerRoot = roots.find((entry) => entry.label === 'consumer')?.root;
    if (consumerRoot === undefined) {
      throw new Error('fresh-ready cell seal capability omitted the packed consumer root');
    }
    const cpu = reopenArtifact(
      profileDir,
      cell.profile.artifact.cpu,
      MAX_CPU_PROFILE_BYTES,
      readStable,
    );
    const coverage = reopenArtifact(
      profileDir,
      cell.profile.artifact.coverage,
      MAX_COVERAGE_BYTES,
      readStable,
    );
    for (const artifact of [cpu, coverage]) {
      const inode = `${artifact.identity.dev}:${artifact.identity.ino}`;
      if (inodeOwners.has(inode)) {
        throw new Error('fresh-ready artifacts alias or duplicate an inode across cells');
      }
      inodeOwners.add(inode);
    }
    const cpuEnvelope = parseArtifactEnvelope(
      cpu.bytes,
      DEV_READY_PROFILE_CPU_ARTIFACT_SCHEMA,
      'CPU',
    );
    const coverageEnvelope = parseArtifactEnvelope(
      coverage.bytes,
      DEV_READY_PROFILE_COVERAGE_ARTIFACT_SCHEMA,
      'coverage',
    );
    if (
      canonicalJson(cpuEnvelope.binding) !== canonicalJson(cell.profile.binding) ||
      canonicalJson(coverageEnvelope.binding) !== canonicalJson(cell.profile.binding) ||
      coverageEnvelope.product?.digest !== cell.profile.product.digest ||
      canonicalJson(coverageEnvelope.calls) !== canonicalJson(cell.profile.calls) ||
      canonicalJson(coverageEnvelope.product?.scriptAssets) !==
        canonicalJson(cell.profile.product.scriptAssets)
    ) {
      throw new Error('fresh-ready artifact envelope is cross-bound to the wrong cell or product');
    }
    const rawCpu = validateReadyCpuProfile(cpuEnvelope.profile);
    const rawCoverage = validateReadyPreciseCoverage(coverageEnvelope.coverage);
    const recomputedCalls = exactReadyCallEvidence(rawCoverage, { consumerRoot });
    if (
      canonicalJson(recomputedCalls.calls) !== canonicalJson(cell.profile.calls) ||
      canonicalJson(recomputedCalls.scriptAssets) !==
        canonicalJson(cell.profile.product.scriptAssets)
    ) {
      throw new Error('retained coverage no longer proves the exact call/range/script evidence');
    }
    const recomputedAttribution = captureReadyAttribution(rawCpu, rawCoverage, { roots });
    if (
      canonicalJson(recomputedAttribution) !== canonicalJson(cell.profile.attribution) ||
      canonicalJson(cpuEnvelope.attribution) !== canonicalJson(recomputedAttribution.cpu) ||
      canonicalJson(coverageEnvelope.attribution) !==
        canonicalJson(recomputedAttribution.coverage) ||
      !validRetainedAttribution(recomputedAttribution)
    ) {
      throw new Error('retained file-backed frame attribution is incomplete or changed');
    }
    const classified = classifyReadyProfileEvidence(rawCpu, rawCoverage, recomputedAttribution);
    classifiedCells.push({
      ...classified,
      lane: expected.lane,
      scheduleIndex: expected.scheduleIndex,
    });
    sealedCells.push({
      artifacts: {
        coverage: { ...cell.profile.artifact.coverage, sealed: true },
        cpu: { ...cell.profile.artifact.cpu, sealed: true },
      },
      binding: cell.profile.binding,
    });
  }
  const directoryAfter = lstatSync(profileDir, { bigint: true });
  if (!sameStableFileStat(directoryBefore, directoryAfter)) {
    throw new Error('fresh-ready artifact directory changed while being sealed');
  }
  const analysis = aggregateReadyProfileAnalysis(classifiedCells);
  if (!validReadyProfileAnalysis(analysis)) {
    throw new Error('fresh-ready retained ranking is malformed or incomplete');
  }
  return {
    analysis,
    cells: sealedCells,
    directory: { files: EXPECTED_PROFILE_FILES, identity: stableFileIdentity(directoryAfter) },
    schema: 'kovo-dev-ready-profile-artifact-seal/v1',
  };
}

function aggregateReadyProfileAnalysis(cells) {
  if (
    cells.length !== DEV_READY_PROFILE_SCHEDULE.length ||
    cells.some(
      (cell, index) =>
        cell.scheduleIndex !== index || cell.lane !== DEV_READY_PROFILE_SCHEDULE[index].lane,
    )
  ) {
    throw new Error('ready-profile ranking cells are schedule-confused');
  }
  const aggregate = (selected) => {
    const cpuEntries = new Map();
    const callEntries = new Map();
    const cpuCensus = {
      authenticatedFrames: 0,
      idleSamples: 0,
      rankedSamples: 0,
      totalSamples: 0,
      unattributedSamples: 0,
    };
    const callCensus = {
      authenticatedCallCount: 0,
      authenticatedFunctions: 0,
      authenticatedIdentities: 0,
      totalCallCount: 0,
      totalFunctions: 0,
      unattributedCallCount: 0,
      unattributedFunctions: 0,
    };
    for (const cell of selected) {
      for (const entry of cell.cpuEntries.values()) {
        addRankedCount(cpuEntries, entry.identity, 'selfSamples', entry.selfSamples);
      }
      for (const entry of cell.callEntries.values()) {
        addRankedCount(callEntries, entry.identity, 'callCount', entry.callCount);
      }
      for (const key of ['idleSamples', 'rankedSamples', 'totalSamples', 'unattributedSamples']) {
        cpuCensus[key] = safeEvidenceSum(
          cpuCensus[key],
          cell.ranking.cpu.census[key],
          `aggregate ${key}`,
        );
      }
      for (const key of [
        'authenticatedCallCount',
        'authenticatedFunctions',
        'totalCallCount',
        'totalFunctions',
        'unattributedCallCount',
        'unattributedFunctions',
      ]) {
        callCensus[key] = safeEvidenceSum(
          callCensus[key],
          cell.ranking.calls.census[key],
          `aggregate ${key}`,
        );
      }
    }
    cpuCensus.authenticatedFrames = cpuEntries.size;
    callCensus.authenticatedIdentities = callEntries.size;
    return readyProfileRanking(
      { census: cpuCensus, entries: cpuEntries },
      { census: callCensus, entries: callEntries },
    );
  };
  return {
    cells: cells.map((cell) => ({
      lane: cell.lane,
      ranking: cell.ranking,
      scheduleIndex: cell.scheduleIndex,
    })),
    lanes: ['baseline', 'spike'].map((lane) => {
      const selected = cells.filter((cell) => cell.lane === lane);
      return { lane, ranking: aggregate(selected), windows: selected.length };
    }),
    overall: { ranking: aggregate(cells), windows: cells.length },
    policy: {
      coverageMetric: 'precise-coverage-outer-range-call-count',
      cpuMetric: 'inspector-self-sample-count',
      top: 5,
      wallTimeClaims: false,
    },
    schema: DEV_READY_PROFILE_ANALYSIS_SCHEMA,
  };
}

export function validReadyProfileAnalysis(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.schema !== DEV_READY_PROFILE_ANALYSIS_SCHEMA ||
    canonicalJson(value.policy) !==
      canonicalJson({
        coverageMetric: 'precise-coverage-outer-range-call-count',
        cpuMetric: 'inspector-self-sample-count',
        top: 5,
        wallTimeClaims: false,
      }) ||
    !Array.isArray(value.cells) ||
    value.cells.length !== DEV_READY_PROFILE_SCHEDULE.length ||
    value.cells.some(
      (cell, index) =>
        cell?.scheduleIndex !== index ||
        cell.lane !== DEV_READY_PROFILE_SCHEDULE[index].lane ||
        !validReadyProfileRanking(cell.ranking),
    ) ||
    !Array.isArray(value.lanes) ||
    value.lanes.length !== 2 ||
    value.lanes.some(
      (lane, index) =>
        lane?.lane !== ['baseline', 'spike'][index] ||
        lane.windows !== 2 ||
        !validReadyProfileRanking(lane.ranking),
    ) ||
    value.overall?.windows !== DEV_READY_PROFILE_SCHEDULE.length ||
    !validReadyProfileRanking(value.overall?.ranking)
  ) {
    return false;
  }
  return true;
}

function validReadyProfileRanking(value) {
  if (
    value?.schema !== DEV_READY_PROFILE_RANKING_SCHEMA ||
    !validReadyCpuRanking(value.cpu) ||
    !validReadyCallRanking(value.calls)
  ) {
    return false;
  }
  return true;
}

function validReadyCpuRanking(value) {
  const census = value?.census;
  return (
    validEvidenceCensus(census, [
      'authenticatedFrames',
      'idleSamples',
      'rankedSamples',
      'totalSamples',
      'unattributedSamples',
    ]) &&
    census.totalSamples ===
      census.rankedSamples + census.idleSamples + census.unattributedSamples &&
    validTopFive(value.topFive, 'selfSamples', census.authenticatedFrames, validCpuRankIdentity)
  );
}

function validReadyCallRanking(value) {
  const census = value?.census;
  return (
    validEvidenceCensus(census, [
      'authenticatedCallCount',
      'authenticatedFunctions',
      'authenticatedIdentities',
      'totalCallCount',
      'totalFunctions',
      'unattributedCallCount',
      'unattributedFunctions',
    ]) &&
    census.totalCallCount === census.authenticatedCallCount + census.unattributedCallCount &&
    census.totalFunctions === census.authenticatedFunctions + census.unattributedFunctions &&
    validTopFive(value.topFive, 'callCount', census.authenticatedIdentities, validCallRankIdentity)
  );
}

function validEvidenceCensus(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    sameExactStringSet(Object.keys(value), keys) &&
    keys.every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0)
  );
}

function validTopFive(value, countName, identities, validIdentity) {
  if (!Array.isArray(value) || value.length !== Math.min(5, identities)) return false;
  const keys = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    const key = canonicalJson(entry?.identity);
    if (
      entry?.rank !== index + 1 ||
      !Number.isSafeInteger(entry[countName]) ||
      entry[countName] < 0 ||
      !validIdentity(entry.identity) ||
      keys.has(key)
    ) {
      return false;
    }
    keys.add(key);
    if (index > 0) {
      const prior = value[index - 1];
      if (
        prior[countName] < entry[countName] ||
        (prior[countName] === entry[countName] &&
          compareEvidenceStrings(canonicalJson(prior.identity), key) >= 0)
      ) {
        return false;
      }
    }
  }
  return true;
}

function validCpuRankIdentity(value) {
  return (
    validRankSourceIdentity(value) &&
    sameExactStringSet(Object.keys(value), [
      'columnNumber',
      'functionName',
      'lineNumber',
      'path',
      'root',
    ]) &&
    Number.isSafeInteger(value.lineNumber) &&
    value.lineNumber >= 0 &&
    Number.isSafeInteger(value.columnNumber) &&
    value.columnNumber >= 0
  );
}

function validCallRankIdentity(value) {
  return (
    validRankSourceIdentity(value) &&
    sameExactStringSet(Object.keys(value), [
      'endOffset',
      'functionName',
      'path',
      'root',
      'startOffset',
    ]) &&
    Number.isSafeInteger(value.startOffset) &&
    value.startOffset >= 0 &&
    Number.isSafeInteger(value.endOffset) &&
    value.endOffset > value.startOffset
  );
}

function validRankSourceIdentity(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.functionName === 'string' &&
    value.functionName.length > 0 &&
    value.functionName.length <= 1_024 &&
    typeof value.root === 'string' &&
    /^[a-z][a-z0-9-]{0,31}$/u.test(value.root) &&
    typeof value.path === 'string' &&
    value.path.length > 0 &&
    value.path.length <= MAX_EVIDENCE_STRING &&
    validPortableRankPath(value.path)
  );
}

function validPortableRankPath(value) {
  if (path.isAbsolute(value) || value.includes('\\')) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function compareEvidenceStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function reopenArtifact(profileDir, evidence, maximum, readStable) {
  const file = path.resolve(profileDir, ...evidence.file.split('/'));
  if (!isWithinOrEqual(profileDir, file)) throw new Error('fresh-ready artifact escaped its root');
  const observed = readStable(file, maximum, `fresh-ready artifact ${evidence.file}`);
  if (
    observed.bytes.byteLength !== evidence.bytes ||
    sha256(observed.bytes) !== evidence.sha256 ||
    observed.identity.dev !== evidence.dev ||
    observed.identity.ino !== evidence.ino ||
    observed.identity.mode !== evidence.mode ||
    observed.identity.nlink !== evidence.nlink ||
    observed.identity.mtimeNs !== evidence.mtimeNs ||
    observed.identity.ctimeNs !== evidence.ctimeNs
  ) {
    throw new Error(`fresh-ready artifact identity or bytes changed: ${evidence.file}`);
  }
  return observed;
}

function parseArtifactEnvelope(bytes, schema, label) {
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} artifact is not JSON: ${errorMessage(error)}`);
  }
  if (parsed === null || typeof parsed !== 'object' || parsed.schema !== schema) {
    throw new Error(`${label} artifact schema is missing or confused`);
  }
  return parsed;
}

function validRetainedAttribution(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return ['cpu', 'coverage'].every(
    (kind) =>
      Array.isArray(value[kind]) &&
      value[kind].every(
        (entry) =>
          Buffer.from(entry.contentBase64 ?? '', 'base64').byteLength === entry.bytes &&
          sha256(Buffer.from(entry.contentBase64 ?? '', 'base64')) === entry.sha256 &&
          (entry.map?.kind !== 'file' ||
            (Buffer.from(entry.map.contentBase64 ?? '', 'base64').byteLength === entry.map.bytes &&
              sha256(Buffer.from(entry.map.contentBase64 ?? '', 'base64')) === entry.map.sha256)),
      ),
  );
}

export async function runDevReadyProfile(options = {}, dependencies = {}) {
  const policy = normalizeReadyProfileOptions(options);
  const collectControllerState =
    dependencies.collectControllerState ??
    (() =>
      collectDevReadyProfileControllerState({
        binding: dependencies.controllerBinding,
      }));
  const controllerBefore = collectControllerState();
  validateControllerState(controllerBefore, 'before preparation');
  const schedule = devReadyProfileSchedule(policy.portBase);
  const expectedPorts = schedule.map((cell) => cell.port);
  const expectedInspectorPorts = schedule.map((cell) => cell.inspectorPort);
  const portAllocation = validateDevPortAllocationEvidence(
    await (dependencies.inspectPortAllocation ?? inspectDevPortAllocation)(
      {
        basePort: policy.portBase,
        inspectorPorts: expectedInspectorPorts,
        ports: expectedPorts,
      },
      dependencies.portAllocationDependencies ?? {},
    ),
    {
      basePort: policy.portBase,
      inspectorPorts: expectedInspectorPorts,
      ports: expectedPorts,
    },
  );
  if (!portAllocation.complete) {
    throw new Error(
      `fresh-ready profile port allocation refused: ${portAllocation.errors.join('; ')}`,
    );
  }

  const hostAdmission = (dependencies.createHostAdmission ?? createDevGenerationHostAdmission)({
    ceiling: policy.maxLoadPerCpu,
    maxWaitMs: policy.hostSettleMaxMs,
    pollMs: policy.hostSettlePollMs,
    sampleHost: dependencies.sampleHost ?? sampleHostLoad,
    wait: dependencies.waitForHost,
  });
  const hostSamples = [];
  const initialHost = await hostAdmission.admit('pre-preparation');
  hostSamples.push(initialHost);
  if (!initialHost.comparable) {
    throw new Error('quiet-host admission refused before preparation; no profiled process started');
  }
  hostAdmission.markBenchmarkWork();

  const prepare = dependencies.prepare ?? prepareDevGenerationSpike;
  const prepared = await prepare(
    {
      baselineRoot: policy.baselineRoot,
      candidateRepository: policy.spikeRoot,
      installTimeoutMs: policy.installTimeoutMs,
      size: 216,
      spikeRoot: policy.spikeRoot,
    },
    dependencies.preparationDependencies ?? {},
  );
  try {
    assertPreparedReadyProfile(prepared, policy);
    assertEvidenceOutsideMeasuredRoots(policy, prepared);
    mkdirSync(policy.profileDir, { mode: 0o700, recursive: false });

    const collectState = dependencies.collectState ?? collectWorktreeState;
    const runCell = dependencies.runCell ?? runReadyProfileCell;
    const acquireLock = dependencies.acquireLock ?? acquireTimingLock;
    const launchBrowser = dependencies.launchBrowser ?? (() => chromium.launch({ headless: true }));
    const cells = [];
    const errors = [];
    let browser;
    let priorProcessMarker = null;
    let priorSession = null;
    let postTimingHost = null;
    const timingLock = acquireLock(policy.timingLockPath);
    try {
      try {
        browser = await launchBrowser();
        for (const scheduled of schedule) {
          const host = await hostAdmission.admit(
            `block-${String(scheduled.scheduleIndex)}-${scheduled.lane}`,
          );
          hostSamples.push(host);
          if (!host.comparable) {
            errors.push(
              `block ${String(scheduled.scheduleIndex)} quiet-host admission refused before profiling`,
            );
            break;
          }
          const expectedState = prepared.source.before[scheduled.lane];
          const sourceBefore = collectState(prepared.roots[scheduled.lane]);
          const beforeFindings = worktreeStabilityFindings(
            expectedState,
            sourceBefore,
            scheduled.lane,
          );
          if (beforeFindings.length > 0) {
            errors.push(...beforeFindings);
            break;
          }
          try {
            const cell = await runCell(
              {
                browser,
                expectedCorpus: prepared.corpus[scheduled.lane],
                inspectorPort: scheduled.inspectorPort,
                lane: scheduled.lane,
                manifestPath: prepared.manifestPaths[scheduled.lane],
                occurrence: scheduled.occurrence,
                port: scheduled.port,
                priorProcessMarker,
                priorSession,
                product: prepared.products[scheduled.lane],
                profileDir: policy.profileDir,
                readyTimeoutMs: policy.readyTimeoutMs,
                root: prepared.roots[scheduled.lane],
                scheduleIndex: scheduled.scheduleIndex,
                sourceState: sourceBefore,
              },
              dependencies.cellDependencies ?? {},
            );
            validateReadyProfileCell(cell, scheduled);
            cells.push(cell);
            priorProcessMarker = cell.processMarker;
            priorSession = `ready[${String(scheduled.scheduleIndex)}]`;
          } catch (error) {
            errors.push(
              `block ${String(scheduled.scheduleIndex)} ${scheduled.lane}: ${errorMessage(error)}`,
            );
            break;
          }
          const sourceAfterCell = collectState(prepared.roots[scheduled.lane]);
          const afterFindings = worktreeStabilityFindings(
            expectedState,
            sourceAfterCell,
            scheduled.lane,
          );
          if (afterFindings.length > 0) {
            errors.push(...afterFindings);
            break;
          }
        }
        if (cells.length > 0) postTimingHost = await hostAdmission.observe('post-timing');
      } finally {
        await browser?.close?.();
      }
    } finally {
      timingLock.release();
    }

    const controllerAfter = collectControllerState();
    const controllerStable = canonicalJson(controllerAfter) === canonicalJson(controllerBefore);
    if (!controllerStable)
      errors.push('diagnostic controller changed during fresh-ready profiling');
    const sourceAfter = {
      baseline: collectState(prepared.roots.baseline),
      spike: collectState(prepared.roots.spike),
    };
    for (const lane of ['baseline', 'spike']) {
      errors.push(
        ...worktreeStabilityFindings(prepared.source.before[lane], sourceAfter[lane], lane),
      );
    }
    let artifactSeal = null;
    if (errors.length === 0 && cells.length === DEV_READY_PROFILE_SCHEDULE.length) {
      try {
        artifactSeal = (dependencies.sealArtifacts ?? sealDevReadyProfileArtifacts)(
          { cells, profileDir: policy.profileDir, schedule },
          dependencies.sealDependencies ?? {},
        );
      } catch (error) {
        errors.push(`artifact sealing: ${errorMessage(error)}`);
      }
    }
    const analysis =
      artifactSeal?.analysis === undefined ? null : structuredClone(artifactSeal.analysis);
    const analysisBound =
      validReadyProfileAnalysis(analysis) &&
      canonicalJson(analysis) === canonicalJson(artifactSeal?.analysis);
    if (
      errors.length === 0 &&
      cells.length === DEV_READY_PROFILE_SCHEDULE.length &&
      artifactSeal?.schema !== 'kovo-dev-ready-profile-artifact-seal/v1'
    ) {
      errors.push('artifact seal omitted the exact retained profile census');
    }
    if (
      errors.length === 0 &&
      cells.length === DEV_READY_PROFILE_SCHEDULE.length &&
      !analysisBound
    ) {
      errors.push('artifact seal omitted the authenticated deterministic CPU/call ranking');
    }
    const complete =
      errors.length === 0 &&
      cells.length === DEV_READY_PROFILE_SCHEDULE.length &&
      artifactSeal?.schema === 'kovo-dev-ready-profile-artifact-seal/v1' &&
      analysisBound;
    const report = {
      analysis,
      artifactSeal,
      candidate: prepared.candidateBinding,
      cells,
      controller: { after: controllerAfter, before: controllerBefore, stable: controllerStable },
      finishedAt: new Date().toISOString(),
      host: (dependencies.hostFingerprint ?? performanceHostFingerprint)(),
      hostDiagnostics: postTimingHost === null ? [] : [postTimingHost],
      hostSamples,
      integrity: {
        analysisBound,
        artifactsSealed: artifactSeal?.schema === 'kovo-dev-ready-profile-artifact-seal/v1',
        complete,
        controllerStable,
        errors: [...new Set(errors)],
        exactSchedule:
          cells.length === DEV_READY_PROFILE_SCHEDULE.length &&
          cells.every(
            (cell, index) =>
              cell.lane === DEV_READY_PROFILE_SCHEDULE[index].lane &&
              cell.occurrence === DEV_READY_PROFILE_SCHEDULE[index].occurrence &&
              cell.scheduleIndex === index,
          ),
        productAndCorpusVerifiedBeforeAndAfter:
          cells.length === DEV_READY_PROFILE_SCHEDULE.length &&
          cells.every(
            (cell) =>
              cell.authentication.product.afterVerified &&
              cell.authentication.product.beforeVerified &&
              cell.authentication.corpus.afterVerified &&
              cell.authentication.corpus.beforeVerified,
          ),
        serialized: true,
        sourceStable: errors.every((error) => !error.includes('source') && !error.includes('lock')),
      },
      policy: DIAGNOSTIC_ONLY_POLICY,
      portAllocation,
      schema: DEV_READY_PROFILE_SCHEMA,
      sourceAfter,
      verdict: {
        reasons: complete ? [] : [...new Set(errors)],
        status: complete ? 'diagnostic-only' : 'unproven',
      },
    };
    return report;
  } finally {
    prepared.cleanup();
  }
}

export function collectDevReadyProfileControllerState(dependencies = {}) {
  const root = canonicalDirectory(
    dependencies.root ?? controllerRoot,
    'diagnostic controller root',
  );
  const binding = validateControllerBinding(dependencies.binding);
  if (realpathSync(binding.privateRoot) !== root) {
    throw new Error('diagnostic controller binding names a different immutable checkout');
  }
  const readStable = dependencies.readStableFile ?? readStableReadyProfileFile;
  const observedBytes = new Map();
  const observed = Object.fromEntries(
    CONTROLLER_BOUND_PATHS.map((relativePath) => {
      const expected = binding.files[relativePath];
      const snapshot = readStable(
        path.join(root, ...relativePath.split('/')),
        MAX_CONTROLLER_FILE_BYTES,
        `controller ${relativePath}`,
      );
      const observedSha = sha256(snapshot.bytes);
      if (
        snapshot.bytes.byteLength !== expected.bytes ||
        observedSha !== expected.sha256 ||
        canonicalJson(snapshot.identity) !== canonicalJson(expected.snapshotIdentity) ||
        !validGitObjectId(expected.gitBlob)
      ) {
        throw new Error(`immutable controller bytes differ from committed blob: ${relativePath}`);
      }
      observedBytes.set(relativePath, snapshot.bytes);
      return [
        relativePath,
        { ...snapshot.identity, gitBlob: expected.gitBlob, sha256: observedSha },
      ];
    }),
  );
  const manifest = JSON.parse(observedBytes.get(CONTROLLER_MANIFEST_FILE).toString('utf8'));
  const pnpmVersion = String(
    dependencies.pnpmVersion ??
      execFileSync('pnpm', ['--version'], {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
  ).trim();
  if (
    manifest.packageManager !== binding.packageManager ||
    pnpmVersion !== binding.pnpmVersion ||
    binding.packageManager !== `pnpm@${binding.pnpmVersion}`
  ) {
    throw new Error('immutable controller package-manager identity differs from its binding');
  }
  return {
    commit: binding.commit,
    dirty: false,
    dirtyPaths: [],
    immutableSnapshot: true,
    locks: Object.fromEntries(CONTROLLER_LOCK_FILES.map((file) => [file, observed[file]])),
    manifest: observed[CONTROLLER_MANIFEST_FILE],
    packageManager: binding.packageManager,
    pnpmVersion: binding.pnpmVersion,
    scripts: Object.fromEntries(CONTROLLER_FILES.map((file) => [file, observed[file]])),
    tree: binding.tree,
  };
}

export async function runReadyProfileCell(options, dependencies = {}) {
  const loadManifest = dependencies.loadManifest ?? loadCorpusManifest;
  const verifySources = dependencies.verifySources ?? verifyCorpusSources;
  const inspectCorpus = dependencies.inspectCorpus ?? inspectGeneratedDevCorpus;
  const verifyProduct = dependencies.verifyProduct ?? verifyPackedKovoProductFixture;
  const cleanOutputs = dependencies.cleanOutputs ?? cleanGeneratedOutputs;
  const materializeCommand = dependencies.materializeCommand ?? materializeEntrantCommand;
  const launch = dependencies.launch ?? launchDevSessionAfterHandoff;
  const createProfiler = dependencies.createProfiler ?? createDevReadyProfiler;
  const measure = dependencies.measure ?? measureFreshReady;

  const loaded = await loadManifest(options.manifestPath);
  if (loaded.manifest.modules !== 216 || loaded.manifest.framework !== 'kovo') {
    throw new Error('fresh-ready profile requires the exact generated Kovo N=216 corpus');
  }
  await verifySources(loaded);
  const corpusBefore = inspectCorpus(options.manifestPath, options.product.externalRoot);
  if (canonicalJson(corpusBefore) !== canonicalJson(options.expectedCorpus)) {
    throw new Error('prepared corpus identity drifted before fresh-ready profiling');
  }
  const packedBefore = verifyProduct(
    options.product.descriptorPath,
    options.product.identity.digest,
    options.sourceState,
  );
  await cleanOutputs(loaded.appRoot, loaded.manifest.build.outputs);
  const command = materializeCommand(
    loaded.manifest.dev.command,
    loaded.appRoot,
    options.port,
    packedBefore,
  );
  const targetSession = `ready[${String(options.scheduleIndex)}]`;
  const launched = await launch({
    appRoot: loaded.appRoot,
    command,
    inspectorPauseOnStart: true,
    inspectorPort: options.inspectorPort,
    priorProcessMarker: options.priorProcessMarker,
    priorSession: options.priorSession,
    targetSession,
  });
  if (launched.session === null) throw new Error(launched.handoff.error);

  let profiler;
  let measurementStarted = false;
  let observation;
  try {
    profiler = await createProfiler({
      artifactStem: `cell-${String(options.scheduleIndex).padStart(3, '0')}-${options.lane}`,
      attributionRoots: { consumer: packedBefore.consumerRoot, corpus: loaded.appRoot },
      cell: {
        lane: options.lane,
        occurrence: options.occurrence,
        port: options.port,
        scheduleIndex: options.scheduleIndex,
      },
      consumerRoot: packedBefore.consumerRoot,
      expectedPid: launched.session.pid,
      expectedEntrypoint: packedBefore.cliEntry,
      inspectorPort: options.inspectorPort,
      inspectorInvocation: launched.session.inspectorInvocation,
      processMarker: launched.session.processMarker,
      productDigest: options.product.identity.digest,
      profileDir: options.profileDir,
    });
    await profiler.startAndResume();
    measurementStarted = true;
    observation = await measure(
      {
        appRoot: loaded.appRoot,
        browser: options.browser,
        command,
        iteration: 0,
        manifest: loaded.manifest,
        readyTimeoutMs: options.readyTimeoutMs,
        session: launched.session,
        started: launched.started,
      },
      { readyDiagnostic: profiler },
    );
  } catch (error) {
    await profiler?.abort?.();
    if (!measurementStarted) await launched.session.stop();
    throw error;
  }
  validateProfiledReadyObservation(observation);

  await verifySources(await loadManifest(options.manifestPath));
  const corpusAfter = inspectCorpus(options.manifestPath, options.product.externalRoot);
  if (canonicalJson(corpusAfter) !== canonicalJson(corpusBefore)) {
    throw new Error('generated corpus identity drifted during fresh-ready profiling');
  }
  verifyProduct(
    options.product.descriptorPath,
    options.product.identity.digest,
    options.sourceState,
  );
  const cell = {
    authentication: {
      corpus: { afterVerified: true, beforeVerified: true, identity: corpusBefore },
      product: {
        afterVerified: true,
        beforeVerified: true,
        digest: options.product.identity.digest,
      },
    },
    handoff: launched.handoff,
    inspectorPort: options.inspectorPort,
    lane: options.lane,
    observation: {
      browser: observation.browser,
      browserContextClosed: observation.browserContextClosed,
      durationMs: observation.durationMs,
      lifecycle: observation.lifecycle,
      paintFenceMs: observation.paintFenceMs,
      peakRssBytes: observation.peakRssBytes,
      readinessProbe: observation.readinessProbe,
      rssSamples: observation.rssSamples,
      success: observation.success,
    },
    occurrence: options.occurrence,
    port: options.port,
    process: {
      pid: launched.session.pid,
      processMarkerSha256: sha256(Buffer.from(launched.session.processMarker)),
    },
    processMarker: launched.session.processMarker,
    profile: observation.readyDiagnostic,
    scheduleIndex: options.scheduleIndex,
  };
  return attachReadyProfileSealCapability(cell, {
    consumer: packedBefore.consumerRoot,
    corpus: loaded.appRoot,
  });
}

export function profiledReadyObservationFindings(observation) {
  const observed = observation ?? {};
  const findings = [];
  const reject = (invalid, field, expected, value, describe = boundedObservedScalar) => {
    if (!invalid) return;
    findings.push(`${field}: expected ${expected}; observed ${describe(value)}`);
  };

  reject(observed.success !== true, 'success', 'true', observed.success);
  reject(
    observed.browserContextClosed !== true,
    'browserContextClosed',
    'true',
    observed.browserContextClosed,
  );
  reject(
    observed.lifecycle?.complete !== true,
    'lifecycle.complete',
    'true',
    observed.lifecycle?.complete,
  );
  reject(
    !finiteNonNegative(observed.durationMs),
    'durationMs',
    'a finite non-negative number',
    observed.durationMs,
  );
  reject(
    !finiteNonNegative(observed.paintFenceMs),
    'paintFenceMs',
    'a finite non-negative number',
    observed.paintFenceMs,
  );
  reject(
    !Number.isSafeInteger(observed.peakRssBytes) || observed.peakRssBytes < 1,
    'peakRssBytes',
    'a positive safe integer',
    observed.peakRssBytes,
  );
  reject(
    !Number.isSafeInteger(observed.rssSamples) || observed.rssSamples < 1,
    'rssSamples',
    'a positive safe integer',
    observed.rssSamples,
  );
  reject(
    observed.browser?.requestFailedCount !== 0,
    'browser.requestFailedCount',
    '0',
    observed.browser?.requestFailedCount,
  );
  reject(
    observed.browser?.unexpectedErrorCount !== 0,
    'browser.unexpectedErrorCount',
    '0',
    observed.browser?.unexpectedErrorCount,
  );
  reject(
    !validReadyRouteProbe(observed.readinessProbe),
    'readinessProbe',
    'an exact successful root-route probe',
    observed.readinessProbe,
    boundedReadyRouteProbeObservation,
  );
  reject(
    observed.readyDiagnostic?.schema !== DEV_READY_PROFILE_WINDOW_SCHEMA,
    'readyDiagnostic.schema',
    DEV_READY_PROFILE_WINDOW_SCHEMA,
    observed.readyDiagnostic?.schema,
  );
  reject(
    observed.readyDiagnostic?.diagnosticOnly?.acceptanceEligible !== false,
    'readyDiagnostic.diagnosticOnly.acceptanceEligible',
    'false',
    observed.readyDiagnostic?.diagnosticOnly?.acceptanceEligible,
  );
  if (findings.length > 0) {
    findings.push(
      profiledReadyObservationErrorContext(observed.error, observed.failureStage),
    );
  }
  return Object.freeze(findings);
}

export function validateProfiledReadyObservation(observation) {
  const findings = profiledReadyObservationFindings(observation);
  if (findings.length > 0) {
    throw new Error(`fresh-ready profiled observation rejected: ${findings.join('; ')}`);
  }
  return observation;
}

function boundedObservedScalar(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'number(NaN)';
    if (value === Number.POSITIVE_INFINITY) return 'number(Infinity)';
    if (value === Number.NEGATIVE_INFINITY) return 'number(-Infinity)';
    if (Object.is(value, -0)) return 'number(-0)';
    return `number(${String(value)})`;
  }
  if (typeof value === 'string') return `string(length=${String(value.length)})`;
  if (Array.isArray(value)) return `array(length=${String(value.length)})`;
  return typeof value;
}

function boundedReadyRouteProbeObservation(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return boundedObservedScalar(value);
  }
  return [
    `object(keys=${String(Object.keys(value).length)}`,
    `attempts=${boundedObservedScalar(value.attempts)}`,
    `path=${value.path === '/' ? 'root' : boundedObservedScalar(value.path)}`,
    `status=${boundedObservedScalar(value.status)}`,
    `transientFailures=${boundedObservedScalar(value.transientFailures)})`,
  ].join(',');
}

function profiledReadyObservationErrorContext(error, failureStage) {
  const source = typeof error === 'string' ? error : '';
  return [
    'errorContext',
    `stage=${normalizedFreshReadyFailureStage(failureStage)}`,
    `category=${profiledReadyObservationErrorCategory(source)}`,
    `utf8Bytes=${String(Buffer.byteLength(source, 'utf8'))}`,
    `sha256=${sha256Utf8(source)}`,
  ].join(',');
}

function profiledReadyObservationErrorCategory(source) {
  const hasStage = (...prefixes) =>
    prefixes.some(
      (prefix) => source.startsWith(prefix) || source.includes(`; ${prefix}`),
    );
  if (hasStage('dev process exited before ready:')) return 'process-exited-before-ready';
  if (hasStage('dev ready route probe timed out:')) return 'route-probe-timeout';
  if (hasStage('dev ready shared deadline expired')) return 'shared-deadline';
  if (hasStage('dev ready timed out:')) return 'dev-ready-timeout';
  if (hasStage('browser context close:', 'browser telemetry recorded ')) return 'browser';
  if (
    hasStage('fresh-ready diagnostic ', 'fresh-ready profiler ', 'fresh-ready Inspector ')
  ) {
    return 'profiler';
  }
  if (
    hasStage(
      'fresh ready did not produce process-tree RSS evidence',
      'process-tree RSS ',
    )
  ) {
    return 'rss';
  }
  return 'other';
}

function sha256Utf8(value) {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

export function parseDevReadyProfileArgs(argv) {
  const options = {};
  const booleanFlags = new Set(['--diagnose']);
  const valueFlags = new Set([
    '--baseline-root',
    '--host-settle-max-ms',
    '--host-settle-poll-ms',
    '--install-timeout-ms',
    '--max-load-per-cpu',
    '--out',
    '--port-base',
    '--profile-dir',
    '--ready-timeout-ms',
    '--spike-root',
    '--timing-lock',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (booleanFlags.has(flag)) {
      if (options.diagnose === true) throw new TypeError(`duplicate ${flag}`);
      options.diagnose = true;
      continue;
    }
    if (!valueFlags.has(flag)) {
      throw new TypeError(`unsupported fresh-ready profile option: ${String(flag)}`);
    }
    const value = argv[++index];
    if (value === undefined) throw new TypeError(`${flag} requires a value`);
    const key = flag.slice(2).replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase());
    if (Object.hasOwn(options, key)) throw new TypeError(`duplicate ${flag}`);
    options[key] = [
      '--baseline-root',
      '--out',
      '--profile-dir',
      '--spike-root',
      '--timing-lock',
    ].includes(flag)
      ? value
      : Number(value);
  }
  return options;
}

function normalizeReadyProfileOptions(options) {
  if (options.diagnose !== true) {
    throw new TypeError('explicit --diagnose authorization is required');
  }
  const baselineRoot = path.resolve(requiredString(options.baselineRoot, 'baseline root'));
  const spikeRoot = path.resolve(requiredString(options.spikeRoot, 'spike root'));
  if (baselineRoot === spikeRoot) throw new TypeError('baseline and spike roots must differ');
  const outPath = path.resolve(requiredString(options.out ?? options.outPath, 'output report'));
  const profileDir = path.resolve(options.profileDir ?? `${outPath}.profiles`);
  if (existsSync(outPath)) throw new Error(`output report already exists: ${outPath}`);
  if (existsSync(profileDir)) throw new Error(`profile directory already exists: ${profileDir}`);
  return {
    baselineRoot,
    hostSettleMaxMs: boundedInteger(
      options.hostSettleMaxMs ?? 30_000,
      0,
      60_000,
      'host settle max ms',
    ),
    hostSettlePollMs: boundedInteger(
      options.hostSettlePollMs ?? 1_000,
      10,
      60_000,
      'host settle poll ms',
    ),
    installTimeoutMs: boundedInteger(
      options.installTimeoutMs ?? 600_000,
      1_000,
      3_600_000,
      'install timeout ms',
    ),
    maxLoadPerCpu: finitePositive(options.maxLoadPerCpu ?? 1, 'max load per CPU'),
    outPath,
    portBase: boundedPort(options.portBase ?? DEFAULT_DEV_PORT_BASE, 'profile port base'),
    profileDir,
    readyTimeoutMs: boundedInteger(
      options.readyTimeoutMs ?? 600_000,
      1_000,
      1_800_000,
      'ready timeout ms',
    ),
    spikeRoot,
    timingLockPath: path.resolve(
      options.timingLock ??
        options.timingLockPath ??
        path.join(os.tmpdir(), 'kovo-performance-timing.lock'),
    ),
  };
}

function assertPreparedReadyProfile(prepared, policy) {
  if (
    prepared?.candidateBinding?.schema !== DEV_GENERATION_CANDIDATE_BINDING_SCHEMA ||
    prepared.candidateBinding.baseline?.commit !== DEV_CRITICAL_PATH_CANDIDATE.parent ||
    prepared.candidateBinding.spike?.commit !== DEV_CRITICAL_PATH_CANDIDATE.commit ||
    prepared.candidateBinding.baseline?.root !== policy.baselineRoot ||
    prepared.candidateBinding.spike?.root !== policy.spikeRoot ||
    prepared.corpus?.baseline?.modules !== 216 ||
    prepared.corpus?.spike?.modules !== 216 ||
    canonicalJson(prepared.corpus.baseline) !== canonicalJson(prepared.corpus.spike) ||
    typeof prepared.cleanup !== 'function'
  ) {
    throw new Error('fresh-ready diagnostic preparation is not the exact packed N=216 pair');
  }
}

function assertEvidenceOutsideMeasuredRoots(policy, prepared) {
  const forbidden = [
    controllerRoot,
    policy.baselineRoot,
    policy.spikeRoot,
    prepared.products.baseline.externalRoot,
    prepared.products.spike.externalRoot,
    path.dirname(prepared.products.baseline.descriptorPath),
    path.dirname(prepared.products.spike.descriptorPath),
  ].map((root) => path.resolve(root));
  for (const target of [policy.outPath, policy.profileDir]) {
    if (forbidden.some((root) => isWithin(root, target))) {
      throw new Error('fresh-ready diagnostic evidence must remain outside measured roots');
    }
  }
}

function validateReadyProfileCell(cell, expected) {
  const profile = cell?.profile;
  const expectedStem = `cell-${String(expected.scheduleIndex).padStart(3, '0')}-${expected.lane}`;
  const markerSha =
    typeof cell?.processMarker === 'string' ? sha256(Buffer.from(cell.processMarker)) : null;
  const expectedBinding = {
    inspectorPort: expected.inspectorPort,
    lane: expected.lane,
    occurrence: expected.occurrence,
    port: expected.port,
    scheduleIndex: expected.scheduleIndex,
  };
  if (
    cell?.scheduleIndex !== expected.scheduleIndex ||
    cell.lane !== expected.lane ||
    cell.occurrence !== expected.occurrence ||
    cell.port !== expected.port ||
    cell.inspectorPort !== expected.inspectorPort ||
    profile?.schema !== DEV_READY_PROFILE_WINDOW_SCHEMA ||
    profile?.diagnosticOnly?.acceptanceEligible !== false ||
    profile.binding?.schema !== 'kovo-dev-ready-profile-window-binding/v1' ||
    canonicalJson(profile.binding.cell) !== canonicalJson(expectedBinding) ||
    canonicalJson(profile.binding.inspectorProcess) !== canonicalJson(profile.inspectorProcess) ||
    profile.binding.productDigest !== profile.product?.digest ||
    profile.binding.productDigest !== cell.authentication?.product?.digest ||
    profile.binding.inspectorProcess?.pid !== cell.process?.pid ||
    profile.binding.inspectorProcess?.processMarkerSha256 !== markerSha ||
    cell.process?.processMarkerSha256 !== markerSha ||
    !validReadyInspectorBinding(profile.binding, expected.inspectorPort) ||
    !validReadyCalls(profile.calls) ||
    !Array.isArray(profile.product?.scriptAssets) ||
    !Array.isArray(profile.attribution?.cpu) ||
    !Array.isArray(profile.attribution?.coverage) ||
    !validArtifactEvidence(
      profile.artifact?.cpu,
      `${expectedStem}.cpuprofile`,
      DEV_READY_PROFILE_CPU_ARTIFACT_SCHEMA,
    ) ||
    !validArtifactEvidence(
      profile.artifact?.coverage,
      `${expectedStem}.coverage.json`,
      DEV_READY_PROFILE_COVERAGE_ARTIFACT_SCHEMA,
    ) ||
    cell.authentication?.product?.beforeVerified !== true ||
    cell.authentication?.product?.afterVerified !== true ||
    cell.authentication?.corpus?.beforeVerified !== true ||
    cell.authentication?.corpus?.afterVerified !== true ||
    cell.observation?.success !== true
  ) {
    throw new Error('fresh-ready diagnostic cell is incomplete or schedule-confused');
  }
}

function validReadyInspectorBinding(binding, inspectorPort) {
  const expectedFlag = `--inspect-brk=127.0.0.1:${String(inspectorPort)}`;
  const expectedArgv = [
    expectedFlag,
    binding.invocation?.entrypoint,
    'dev',
    './src/app.tsx',
    '--host',
    'localhost',
    '--strict-port',
    '--port',
    String(binding.cell?.port),
  ];
  return (
    Number.isSafeInteger(binding.inspectorProcess?.pid) &&
    binding.inspectorProcess.pid > 0 &&
    /^sha256:[0-9a-f]{64}$/u.test(binding.inspectorProcess.processMarkerSha256 ?? '') &&
    typeof binding.inspectorProcess.targetId === 'string' &&
    binding.inspectorProcess.targetId.length > 0 &&
    binding.bootstrap?.schema === DEV_PAUSED_INSPECTOR_BOOTSTRAP_SCHEMA &&
    binding.bootstrap.targetId === binding.inspectorProcess.targetId &&
    binding.bootstrap.contextName ===
      `${process.execPath}[${String(binding.inspectorProcess.pid)}]` &&
    binding.bootstrap.contextOrigin === '' &&
    binding.bootstrap.processGlobals === 'pid-argv-execArgv-undefined' &&
    binding.bootstrap.processMarkerMatched === true &&
    binding.invocation?.schema === DEV_PROFILED_PROCESS_INVOCATION_SCHEMA &&
    binding.invocation.executable === process.execPath &&
    Array.isArray(binding.invocation.argv) &&
    binding.invocation.argv.length === expectedArgv.length &&
    binding.invocation.argv.every((argument, index) => argument === expectedArgv[index]) &&
    typeof binding.invocation.entrypoint === 'string' &&
    path.isAbsolute(binding.invocation.entrypoint) &&
    path.resolve(binding.invocation.entrypoint) === binding.invocation.entrypoint &&
    /^sha256:[0-9a-f]{64}$/u.test(binding.invocation.argvSha256 ?? '') &&
    binding.invocation.argvSha256 ===
      sha256(JSON.stringify([binding.invocation.executable, ...binding.invocation.argv])) &&
    sameExactStringSet(Object.keys(binding.invocation), [
      'argv',
      'argvSha256',
      'entrypoint',
      'executable',
      'execArgv',
      'pauseFlag',
      'schema',
    ]) &&
    binding.invocation?.pauseFlag === expectedFlag &&
    Array.isArray(binding.invocation.execArgv) &&
    binding.invocation.execArgv.filter((value) => value === expectedFlag).length === 1 &&
    binding.invocation.execArgv.every(
      (value) =>
        typeof value === 'string' &&
        (value === expectedFlag ||
          (!value.startsWith('--inspect=') && !value.startsWith('--inspect-brk='))),
    )
  );
}

function validReadyCalls(value) {
  if (
    !Array.isArray(value) ||
    value.length !== PROFILE_TARGETS.length ||
    value.some((call, index) => call?.name !== PROFILE_TARGETS[index].name)
  ) {
    return false;
  }
  return value.every(
    (call, index) =>
      call.required === PROFILE_TARGETS[index].required &&
      typeof call.present === 'boolean' &&
      Number.isSafeInteger(call.callCount) &&
      call.callCount >= 0 &&
      Array.isArray(call.instances) &&
      call.present === call.instances.length > 0 &&
      (!call.required || call.present) &&
      call.instances.every(
        (instance) =>
          Number.isSafeInteger(instance.callCount) &&
          instance.callCount >= 0 &&
          typeof instance.script === 'string' &&
          instance.script.length > 0 &&
          typeof instance.scriptId === 'string' &&
          instance.scriptId.length > 0 &&
          Array.isArray(instance.ranges) &&
          instance.ranges.length > 0 &&
          instance.ranges.every(
            (range) =>
              Number.isSafeInteger(range.startOffset) &&
              Number.isSafeInteger(range.endOffset) &&
              Number.isSafeInteger(range.count) &&
              range.startOffset >= 0 &&
              range.endOffset > range.startOffset &&
              range.count >= 0,
          ),
      ) &&
      call.callCount === call.instances.reduce((total, instance) => total + instance.callCount, 0),
  );
}

function validArtifactEvidence(value, file, schema) {
  return (
    value !== null &&
    typeof value === 'object' &&
    value.file === file &&
    value.schema === schema &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes > 0 &&
    /^[0-9]+$/u.test(value.dev ?? '') &&
    /^[0-9]+$/u.test(value.ino ?? '') &&
    /^[0-9]+$/u.test(value.mode ?? '') &&
    /^[0-9]+$/u.test(value.mtimeNs ?? '') &&
    /^[0-9]+$/u.test(value.ctimeNs ?? '') &&
    value.nlink === 1 &&
    /^sha256:[0-9a-f]{64}$/u.test(value.sha256 ?? '')
  );
}

function validateControllerBinding(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.schema !== DEV_READY_PROFILE_CONTROLLER_BINDING_SCHEMA ||
    !validGitObjectId(value.commit) ||
    !validGitObjectId(value.tree) ||
    typeof value.privateRoot !== 'string' ||
    !path.isAbsolute(value.privateRoot) ||
    !validPnpmIdentity(value.packageManager, value.pnpmVersion) ||
    value.files === null ||
    typeof value.files !== 'object' ||
    Array.isArray(value.files) ||
    !sameExactStringSet(Object.keys(value.files), CONTROLLER_BOUND_PATHS) ||
    CONTROLLER_BOUND_PATHS.some((file) => !validCommittedFileBinding(value.files[file]))
  ) {
    throw new Error('immutable diagnostic controller binding is malformed');
  }
  return value;
}

function validateControllerState(value, phase) {
  if (
    value === null ||
    typeof value !== 'object' ||
    value.dirty !== false ||
    !Array.isArray(value.dirtyPaths) ||
    value.dirtyPaths.length !== 0 ||
    value.immutableSnapshot !== true ||
    !validGitObjectId(value.commit) ||
    !validGitObjectId(value.tree) ||
    value.locks === null ||
    typeof value.locks !== 'object' ||
    Array.isArray(value.locks) ||
    !sameExactStringSet(Object.keys(value.locks), CONTROLLER_LOCK_FILES) ||
    CONTROLLER_LOCK_FILES.some((file) => !validObservedControllerFile(value.locks[file])) ||
    !validPnpmIdentity(value.packageManager, value.pnpmVersion) ||
    !validObservedControllerFile(value.manifest) ||
    value.scripts === null ||
    typeof value.scripts !== 'object' ||
    Array.isArray(value.scripts) ||
    !sameExactStringSet(Object.keys(value.scripts), CONTROLLER_FILES) ||
    CONTROLLER_FILES.some((file) => !validObservedControllerFile(value.scripts[file]))
  ) {
    throw new Error(`diagnostic controller is dirty or unauthenticated ${phase}`);
  }
}

function validCommittedFileBinding(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes > 0 &&
    validGitObjectId(value.gitBlob) &&
    /^sha256:[0-9a-f]{64}$/u.test(value.sha256 ?? '') &&
    validStableIdentity(value.snapshotIdentity, value.bytes)
  );
}

function validObservedControllerFile(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes > 0 &&
    validGitObjectId(value.gitBlob) &&
    /^sha256:[0-9a-f]{64}$/u.test(value.sha256 ?? '') &&
    /^[0-9]+$/u.test(value.dev ?? '') &&
    /^[0-9]+$/u.test(value.ino ?? '') &&
    /^[0-9]+$/u.test(value.mode ?? '') &&
    /^[0-9]+$/u.test(value.mtimeNs ?? '') &&
    /^[0-9]+$/u.test(value.ctimeNs ?? '') &&
    value.nlink === 1
  );
}

function validStableIdentity(value, expectedBytes) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.bytes === expectedBytes &&
    /^[0-9]+$/u.test(value.dev ?? '') &&
    /^[0-9]+$/u.test(value.ino ?? '') &&
    /^[0-9]+$/u.test(value.mode ?? '') &&
    /^[0-9]+$/u.test(value.mtimeNs ?? '') &&
    /^[0-9]+$/u.test(value.ctimeNs ?? '') &&
    value.nlink === 1
  );
}

function validPnpmIdentity(packageManager, pnpmVersion) {
  return (
    /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(
      pnpmVersion ?? '',
    ) && packageManager === `pnpm@${pnpmVersion}`
  );
}

function validGitObjectId(value) {
  return /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(value ?? '');
}

function sameExactStringSet(left, right) {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort((a, b) => a.localeCompare(b));
  const sortedRight = [...right].sort((a, b) => a.localeCompare(b));
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function validateCoverageFunction(fn) {
  if (
    fn === null ||
    typeof fn !== 'object' ||
    typeof fn.functionName !== 'string' ||
    fn.functionName.length > 1_024 ||
    typeof fn.isBlockCoverage !== 'boolean' ||
    !Array.isArray(fn.ranges) ||
    fn.ranges.length === 0 ||
    fn.ranges.length > MAX_COVERAGE_RANGES_PER_FUNCTION
  ) {
    throw new TypeError('fresh-ready precise coverage contains a malformed function');
  }
  for (const range of fn.ranges) {
    if (
      !Number.isSafeInteger(range?.startOffset) ||
      !Number.isSafeInteger(range?.endOffset) ||
      !Number.isSafeInteger(range?.count) ||
      range.startOffset < 0 ||
      range.endOffset <= range.startOffset ||
      range.count < 0
    ) {
      throw new TypeError('fresh-ready precise coverage contains a malformed range');
    }
  }
  outerCoverageRange(fn.ranges);
}

function outerCoverageRange(ranges) {
  const outer = ranges[0];
  if (
    ranges.some(
      (range) => range.startOffset < outer.startOffset || range.endOffset > outer.endOffset,
    )
  ) {
    throw new TypeError('precise coverage function ranges escape their outer range');
  }
  return outer;
}

function bundleRangeDeclaresFunction(source, range, functionName) {
  const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const rangedHeader = source.slice(
    range.startOffset,
    Math.min(range.endOffset, range.startOffset + 512),
  );
  const direct = new RegExp(
    `^(?:\\s|/\\*[\\s\\S]*?\\*/|//[^\\n]*\\n)*(?:(?:async\\s+)?function(?:\\s*\\*)?\\s+${escaped}\\s*\\(|(?:const|let|var)\\s+${escaped}\\s*=|(?:async\\s+)?${escaped}\\s*\\()`,
    'u',
  );
  if (direct.test(rangedHeader)) return true;
  const bindingContext = source.slice(
    Math.max(0, range.startOffset - 256),
    Math.min(range.endOffset, range.startOffset + 256),
  );
  return new RegExp(
    `(?:const|let|var)\\s+${escaped}\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[$A-Z_a-z][$\\w]*)\\s*=>`,
    'u',
  ).test(bindingContext);
}

function authenticatedCoverageAsset(urlValue, consumerRoot) {
  if (typeof urlValue !== 'string' || !urlValue.startsWith('file:')) {
    throw new Error('target precise-coverage script is not a file URL');
  }
  const url = new URL(urlValue);
  if (url.search !== '' || url.hash !== '') {
    throw new Error('target precise-coverage script URL contains search/hash data');
  }
  const declaredPath = fileURLToPath(url);
  const absolutePath = realpathSync(declaredPath);
  if (!isWithinOrEqual(consumerRoot, absolutePath)) {
    throw new Error('target precise-coverage script escaped the authenticated packed consumer');
  }
  const mapPath = `${declaredPath}.map`;
  const mapRealPath = realpathSync(mapPath);
  if (!isWithinOrEqual(consumerRoot, mapRealPath)) {
    throw new Error('target precise-coverage source map escaped the packed consumer');
  }
  const source = readStableReadyProfileFile(
    absolutePath,
    MAX_ATTRIBUTION_FILE_BYTES,
    'target precise-coverage script',
    { allowMultipleLinks: true },
  );
  const sourceMap = readStableReadyProfileFile(
    mapRealPath,
    MAX_ATTRIBUTION_FILE_BYTES,
    'target precise-coverage source map',
    { allowMultipleLinks: true },
  );
  const bytes = source.bytes;
  const mapBytes = sourceMap.bytes;
  if (!bytes.toString('utf8').includes(`sourceMappingURL=${path.basename(mapPath)}`)) {
    throw new Error('target precise-coverage script does not bind its sibling source map');
  }
  return {
    absolutePath,
    evidence: {
      bytes: bytes.byteLength,
      identity: source.identity,
      sha256: sha256(bytes),
      sourceMap: {
        bytes: mapBytes.byteLength,
        identity: sourceMap.identity,
        sha256: sha256(mapBytes),
      },
    },
    relativePath: path.relative(consumerRoot, absolutePath).split(path.sep).join('/'),
    source: bytes.toString('utf8'),
  };
}

function validateReadyInspectorIdentity(identity, expected) {
  if (
    identity === null ||
    typeof identity !== 'object' ||
    identity.pid !== expected.expectedPid ||
    identity.processMarkerMatched !== true ||
    identity.processMarkerSha256 !== sha256(Buffer.from(expected.processMarker)) ||
    typeof identity.targetId !== 'string' ||
    identity.targetId.length === 0 ||
    identity.targetId.length > 256 ||
    identity.bootstrap?.schema !== DEV_PAUSED_INSPECTOR_BOOTSTRAP_SCHEMA ||
    identity.bootstrap.targetId !== identity.targetId ||
    identity.bootstrap.contextName !== `${process.execPath}[${String(expected.expectedPid)}]` ||
    identity.bootstrap.contextOrigin !== '' ||
    identity.bootstrap.processGlobals !== 'pid-argv-execArgv-undefined' ||
    identity.bootstrap.processMarkerMatched !== true
  ) {
    throw new Error('fresh-ready Inspector target does not belong to the spawned process');
  }
}

function reserveArtifactStem(profileDir, stem) {
  const cpuPath = path.join(profileDir, `${stem}.cpuprofile`);
  const coveragePath = path.join(profileDir, `${stem}.coverage.json`);
  const lockPath = path.join(profileDir, `.${stem}.lock`);
  if (existsSync(cpuPath) || existsSync(coveragePath)) {
    throw new Error(`fresh-ready artifact already exists for ${stem}`);
  }
  const descriptor = openSync(lockPath, 'wx', 0o600);
  closeSync(descriptor);
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      try {
        unlinkSync(lockPath);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    },
    write(cpuBytes, coverageBytes) {
      if (released) throw new Error('fresh-ready artifact reservation is already released');
      let cpuWritten = false;
      try {
        const cpu = writeExclusiveArtifact(cpuPath, cpuBytes, profileDir);
        cpuWritten = true;
        const coverage = writeExclusiveArtifact(coveragePath, coverageBytes, profileDir);
        return { coverage, cpu };
      } catch (error) {
        if (cpuWritten) rmSync(cpuPath, { force: true });
        throw error;
      }
    },
  };
}

function writeExclusiveArtifact(file, bytes, root) {
  let descriptor;
  let created = false;
  let evidence;
  let failure;
  try {
    descriptor = openSync(
      file,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        (fsConstants.O_NOFOLLOW ?? 0),
      0o600,
    );
    created = true;
    writeFileSync(descriptor, bytes);
    const handle = fstatSync(descriptor, { bigint: true });
    const pathStat = lstatSync(file, { bigint: true });
    if (
      !handle.isFile() ||
      handle.nlink !== 1n ||
      handle.size !== BigInt(bytes.byteLength) ||
      !sameStableFileStat(handle, pathStat)
    ) {
      throw new Error('fresh-ready artifact changed identity while being written');
    }
    evidence = artifactEvidence(file, bytes, root, handle);
  } catch (error) {
    failure = error;
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch (error) {
        failure ??= error;
      }
    }
  }
  if (failure !== undefined) {
    if (created) rmSync(file, { force: true });
    throw failure;
  }
  return evidence;
}

function artifactEvidence(file, bytes, root, stat) {
  return {
    bytes: bytes.byteLength,
    ctimeNs: String(stat.ctimeNs),
    dev: String(stat.dev),
    file: path.relative(root, file).split(path.sep).join('/'),
    ino: String(stat.ino),
    mode: String(stat.mode),
    mtimeNs: String(stat.mtimeNs),
    nlink: Number(stat.nlink),
    sha256: sha256(bytes),
  };
}

function serializedArtifactBytes(value, maximum, label) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  if (bytes.byteLength < 3 || bytes.byteLength > maximum) {
    throw new Error(`${label} exceeds its retained artifact bound`);
  }
  return bytes;
}

/** Stable bounded evidence read with final-component no-follow and path/descriptor identity. */
export function readStableReadyProfileFile(file, maximum, label, dependencies = {}) {
  if (!Number.isSafeInteger(maximum) || maximum < 1) {
    throw new TypeError(`${label} has an invalid byte bound`);
  }
  const absolute = path.resolve(requiredString(file, `${label} path`));
  const lstat = dependencies.lstat ?? ((target) => lstatSync(target, { bigint: true }));
  const fstat = dependencies.fstat ?? ((descriptor) => fstatSync(descriptor, { bigint: true }));
  const open = dependencies.open ?? openSync;
  const close = dependencies.close ?? closeSync;
  const read = dependencies.read ?? readSync;
  const realpath = dependencies.realpath ?? realpathSync;
  const uniqueLink = dependencies.allowMultipleLinks !== true;
  const beforePath = lstat(absolute);
  if (
    !beforePath.isFile() ||
    beforePath.isSymbolicLink() ||
    beforePath.nlink < 1n ||
    (uniqueLink && beforePath.nlink !== 1n) ||
    beforePath.size < 1n ||
    beforePath.size > BigInt(maximum) ||
    realpath(absolute) !== absolute
  ) {
    throw new Error(`${label} is not a bounded uniquely linked regular file`);
  }
  dependencies.afterLstat?.({ file: absolute, stat: beforePath });
  let descriptor;
  try {
    descriptor = open(
      absolute,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0),
    );
    const beforeHandle = fstat(descriptor);
    if (
      !beforeHandle.isFile() ||
      beforeHandle.nlink < 1n ||
      (uniqueLink && beforeHandle.nlink !== 1n) ||
      beforeHandle.size > BigInt(maximum) ||
      !sameStableFileStat(beforePath, beforeHandle)
    ) {
      throw new Error(`${label} changed identity while being opened`);
    }
    const buffer = Buffer.alloc(Number(beforeHandle.size) + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const count = read(descriptor, buffer, offset, buffer.byteLength - offset, null);
      if (!Number.isSafeInteger(count) || count < 0 || count > buffer.byteLength - offset) {
        throw new Error(`${label} returned an invalid read count`);
      }
      if (count === 0) break;
      offset += count;
    }
    if (offset !== Number(beforeHandle.size) || offset > maximum) {
      throw new Error(`${label} changed size while being read`);
    }
    const afterHandle = fstat(descriptor);
    const afterPath = lstat(absolute);
    if (
      realpath(absolute) !== absolute ||
      !sameStableFileStat(beforeHandle, afterHandle) ||
      !sameStableFileStat(afterHandle, afterPath)
    ) {
      throw new Error(`${label} changed while being read`);
    }
    return {
      bytes: Buffer.from(buffer.subarray(0, offset)),
      identity: stableFileIdentity(afterHandle),
    };
  } finally {
    if (descriptor !== undefined) close(descriptor);
  }
}

function sameStableFileStat(left, right) {
  return (
    left.isFile() === right.isFile() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function stableFileIdentity(stat) {
  return {
    bytes: Number(stat.size),
    ctimeNs: String(stat.ctimeNs),
    dev: String(stat.dev),
    ino: String(stat.ino),
    mode: String(stat.mode),
    mtimeNs: String(stat.mtimeNs),
    nlink: Number(stat.nlink),
  };
}

function exactLexicalAbsolutePath(value, label) {
  const declared = requiredString(value, label);
  const resolved = path.resolve(declared);
  if (!path.isAbsolute(declared) || resolved !== declared) {
    throw new TypeError(`${label} must be an absolute normalized path`);
  }
  return declared;
}

function authenticatePackedEntrypointPath({
  canonicalConsumerRoot,
  expectedEntrypoint,
  lexicalConsumerRoot,
}) {
  if (!isWithin(lexicalConsumerRoot, expectedEntrypoint)) {
    throw new TypeError('packed CLI entrypoint escaped the lexical packed consumer');
  }
  const before = lstatSync(expectedEntrypoint, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new TypeError('packed CLI entrypoint must be a regular non-symlink file');
  }
  const canonicalEntrypoint = realpathSync(expectedEntrypoint);
  const canonical = lstatSync(canonicalEntrypoint, { bigint: true });
  const after = lstatSync(expectedEntrypoint, { bigint: true });
  if (!sameStableFileStat(before, canonical) || !sameStableFileStat(before, after)) {
    throw new Error('packed CLI entrypoint was substituted during path authentication');
  }
  if (!isWithin(canonicalConsumerRoot, canonicalEntrypoint)) {
    throw new TypeError('packed CLI entrypoint escaped the canonical packed consumer');
  }
}

function canonicalDirectory(value, label) {
  const resolved = path.resolve(requiredString(value, label));
  const stat = lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new TypeError(`${label} must be a non-symlink directory`);
  }
  return realpathSync(resolved);
}

function boundedArtifactStem(value) {
  const stem = requiredString(value, 'artifact stem');
  if (!/^cell-[0-9]{3}-(?:baseline|spike)$/u.test(stem)) {
    throw new TypeError('fresh-ready artifact stem is invalid');
  }
  return stem;
}

function boundedInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(
      `${label} must be an integer from ${String(minimum)} to ${String(maximum)}`,
    );
  }
  return value;
}

function boundedPort(value, label) {
  return boundedInteger(value, 1_024, 65_535, label);
}

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function finitePositive(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be a finite positive number`);
  }
  return value;
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_EVIDENCE_STRING) {
    throw new TypeError(`${label} is required`);
  }
  return value;
}

function validSha256(value, label) {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value ?? '')) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function isWithinOrEqual(parent, child) {
  return parent === child || isWithin(parent, child);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function controllerBindingFromEnvironment(environment = process.env) {
  const bindingPath = requiredString(
    environment.KOVO_DEV_READY_PROFILE_CONTROLLER_BINDING,
    'controller binding path',
  );
  const expectedSha = validSha256(
    environment.KOVO_DEV_READY_PROFILE_CONTROLLER_BINDING_SHA256,
    'controller binding digest',
  );
  const snapshot = readStableReadyProfileFile(
    bindingPath,
    MAX_CONTROLLER_BINDING_BYTES,
    'controller binding',
  );
  if (sha256(snapshot.bytes) !== expectedSha) {
    throw new Error('controller binding bytes differ from the bootstrap digest');
  }
  const binding = validateControllerBinding(JSON.parse(snapshot.bytes.toString('utf8')));
  if (
    canonicalDirectory(binding.privateRoot, 'bound immutable controller root') !== controllerRoot
  ) {
    throw new Error('controller module was not imported from its bound immutable checkout');
  }
  return binding;
}

export function devReadyProfileFailureDiagnostic(report) {
  if (report?.verdict?.status === 'diagnostic-only') return null;
  const reasons = Array.isArray(report?.verdict?.reasons)
    ? report.verdict.reasons
        .filter((reason) => typeof reason === 'string')
        .slice(0, 16)
        .map((reason) => reason.slice(0, 512))
    : [];
  return `fresh-ready diagnostic did not complete: ${JSON.stringify({
    reasons,
    status: report?.verdict?.status ?? 'missing',
  })}`.slice(0, 8192);
}

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseDevReadyProfileArgs(argv);
  const controllerBinding = controllerBindingFromEnvironment();
  const report = await runDevReadyProfile(parsed, { controllerBinding });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(path.resolve(parsed.out), serialized, { flag: 'wx', mode: 0o600 });
  process.stdout.write(serialized);
  const failureDiagnostic = devReadyProfileFailureDiagnostic(report);
  if (failureDiagnostic !== null) process.stderr.write(`${failureDiagnostic}\n`);
  return report.verdict.status === 'diagnostic-only' ? 0 : 1;
}

if (isMainEntry(import.meta.url)) await runGate(() => main());
