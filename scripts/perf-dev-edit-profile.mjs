#!/usr/bin/env node
/**
 * Exact edit-to-paint CPU/allocation diagnostics for the generated developer corpora.
 *
 * `benchmarks/corpora/dev-loop.mjs` owns the browser-visible window. This helper speaks Inspector
 * to that exact dev-server process and starts/stops both samplers around each measured source write
 * through the destination paint fence. Profile-perturbed wall/RSS values remain diagnostic-only.
 */
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DEV_EDIT_PROFILE_SCHEMA = 'kovo-dev-edit-profile/v1';
export const DEV_EDIT_PROFILE_CLASSIFIER = 'kovo-dev-edit-profile-classifier/stack-v3';
export const DEV_EDIT_PROFILE_AUDIT_SCHEMA = 'kovo-dev-edit-profile-audit/v1';
export const DEV_PAUSED_INSPECTOR_BOOTSTRAP_SCHEMA = 'kovo-paused-inspector-bootstrap/v1';
export const DEV_EDIT_PROFILE_CATEGORIES = Object.freeze([
  'self-time',
  'allocation',
  'module-evaluation',
  'vite-transform',
  'ssr-generation',
  'asynchronous-proof-convergence',
]);

const CPU_SAMPLING_INTERVAL_US = 500;
const HEAP_SAMPLING_INTERVAL_BYTES = 32_768;
const CONNECTION_TIMEOUT_MS = 15_000;
const INSPECTOR_TARGET_LIST_MAX_CHARS = 64 * 1024;
const INSPECTOR_TARGET_LIST_MAX_ENTRIES = 64;
const INSPECTOR_INVOCATION_MAX_STRING = 8_192;
const pausedInspectorSessions = new WeakMap();

class PausedInspectorTerminalError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'PausedInspectorTerminalError';
  }
}

export async function createDevEditProfiler(options, dependencies = {}) {
  const framework = requiredString(options.framework, 'framework');
  if (framework !== 'kovo') {
    throw new TypeError('Exact Inspector dev profiling currently supports only Kovo.');
  }
  const inspectorPort = boundedInteger(options.inspectorPort, 1_024, 65_535, 'inspectorPort');
  const expectedPid = boundedInteger(
    options.expectedPid,
    1,
    Number.MAX_SAFE_INTEGER,
    'expectedPid',
  );
  const processMarker = requiredProcessMarker(options.processMarker);
  const modules = boundedInteger(options.modules, 1, 10_000, 'modules');
  const profileDir = path.resolve(requiredString(options.profileDir, 'profileDir'));
  const workload = {
    classifier: DEV_EDIT_PROFILE_CLASSIFIER,
    cpuSamplingIntervalMicros: CPU_SAMPLING_INTERVAL_US,
    framework,
    heapSamplingIntervalBytes: HEAP_SAMPLING_INTERVAL_BYTES,
    inspectorProcess: {
      pid: expectedPid,
      processMarkerSha256: sha256(processMarker),
    },
    modules,
    profileScope: 'measured-source-write-through-destination-paint',
    schema: 'kovo-dev-edit-profile-workload/v1',
  };
  await mkdir(profileDir, { recursive: true, mode: 0o700 });
  const session = await (dependencies.connectInspector ?? connectDevInspector)({
    expectedPid,
    inspectorPort,
    processMarker,
  });
  validateInspectorIdentity(session.identity, { expectedPid, processMarker });
  const rawWindows = [];
  const observations = [];
  let active = null;
  let closed = false;

  await session.send('Profiler.enable');
  await session.send('Profiler.setSamplingInterval', { interval: CPU_SAMPLING_INTERVAL_US });
  await session.send('HeapProfiler.enable');

  async function startWindow(identity) {
    assertOpen(closed);
    if (active !== null) throw new Error('a diagnostic edit window is already active');
    const normalized = normalizeWindowIdentity(identity);
    await Promise.all([
      session.send('Profiler.start'),
      session.send('HeapProfiler.startSampling', {
        includeObjectsCollectedByMajorGC: true,
        includeObjectsCollectedByMinorGC: true,
        samplingInterval: HEAP_SAMPLING_INTERVAL_BYTES,
      }),
    ]);
    active = normalized;
  }

  async function stopWindow(identity) {
    assertOpen(closed);
    const normalized = normalizeWindowIdentity(identity);
    if (active === null || canonicalIdentity(active) !== canonicalIdentity(normalized)) {
      throw new Error('diagnostic edit window identity does not match the active window');
    }
    const [cpuResult, heapResult] = await Promise.all([
      session.send('Profiler.stop'),
      session.send('HeapProfiler.stopSampling'),
    ]);
    const raw = { cpu: cpuResult?.profile, heap: heapResult?.profile };
    // Both Inspector samplers have stopped before their payloads are validated. Clear the active
    // marker now so a validation failure cannot issue a second, misleading pair of stop commands.
    active = null;
    let analysis;
    try {
      analysis = analyzeDevEditProfiles(raw);
    } catch (error) {
      await retainRejectedWindow({ error, identity: normalized, profileDir, raw });
      throw error;
    }
    const fileStem = `${normalized.editClass}-${String(normalized.iteration).padStart(3, '0')}`;
    const cpuBytes = Buffer.from(`${JSON.stringify(raw.cpu)}\n`);
    const heapBytes = Buffer.from(`${JSON.stringify(raw.heap)}\n`);
    const cpuFile = `${fileStem}.cpuprofile`;
    const heapFile = `${fileStem}.heapprofile`;
    await Promise.all([
      writeFile(path.join(profileDir, cpuFile), cpuBytes, { flag: 'wx', mode: 0o600 }),
      writeFile(path.join(profileDir, heapFile), heapBytes, { flag: 'wx', mode: 0o600 }),
    ]);
    const artifact = {
      cpu: { bytes: cpuBytes.byteLength, file: cpuFile, sha256: sha256(cpuBytes) },
      heap: { bytes: heapBytes.byteLength, file: heapFile, sha256: sha256(heapBytes) },
    };
    rawWindows.push({ analysis, artifact, identity: normalized });
    const observation = {
      activeCpuSamples: analysis.census.activeCpuSamples,
      allocatedBytes: analysis.census.allocatedBytes,
      artifact,
      editClass: normalized.editClass,
      iteration: normalized.iteration,
      negativeCpuTimeDeltas: analysis.census.negativeCpuTimeDeltas,
      topAllocationFrames: analysis.topAllocationFrames,
      topFive: analysis.topFive,
      topSelfFrames: analysis.topSelfFrames,
    };
    observations.push(observation);
    return observation;
  }

  async function abortWindow() {
    if (closed || active === null) return;
    await Promise.allSettled([
      session.send('Profiler.stop'),
      session.send('HeapProfiler.stopSampling'),
    ]);
    active = null;
  }

  return {
    abortWindow,
    async close() {
      if (closed) return;
      await abortWindow();
      closed = true;
      session.close();
    },
    startWindow,
    stopWindow,
    summary() {
      if (active !== null) throw new Error('cannot summarize an active diagnostic edit window');
      const editWindowCounts = {};
      for (const { identity } of rawWindows) {
        editWindowCounts[identity.editClass] = (editWindowCounts[identity.editClass] ?? 0) + 1;
      }
      const authenticatedWorkload = { ...workload, editWindowCounts };
      return summarizeProfileWindows(rawWindows, {
        cpuSamplingIntervalMicros: CPU_SAMPLING_INTERVAL_US,
        heapSamplingIntervalBytes: HEAP_SAMPLING_INTERVAL_BYTES,
        observations,
        workload: {
          ...authenticatedWorkload,
          digest: sha256(JSON.stringify(authenticatedWorkload)),
        },
      });
    },
  };
}

export function analyzeDevEditProfiles({ cpu, heap }) {
  const cpuTimeline = validateCpuProfile(cpu);
  validateHeapProfile(heap);
  const cpuFrames = cpuFrameSamples(cpu, cpuTimeline);
  const activeCpuSamples = cpuFrames.reduce((total, entry) => total + entry.samples, 0);
  const totalCpuMicros = cpuFrames.reduce((total, entry) => total + entry.selfTimeMicros, 0);
  if (activeCpuSamples === 0) throw new TypeError('CPU profile contains zero active samples');
  if (totalCpuMicros <= 0) throw new TypeError('CPU profile contains zero active self time');
  const allocationFrames = heapFrameAllocations(heap);
  const allocatedBytes = allocationFrames.reduce((total, entry) => total + entry.bytes, 0);
  const categoryMap = new Map(
    DEV_EDIT_PROFILE_CATEGORIES.map((category) => [
      category,
      { allocationBytes: 0, cpuSamples: 0, selfTimeMicros: 0 },
    ]),
  );
  const unknownCpu = { samples: 0, selfTimeMicros: 0 };
  const unknownAllocation = { bytes: 0 };

  for (const entry of cpuFrames) {
    categoryMap.get('self-time').cpuSamples += entry.samples;
    categoryMap.get('self-time').selfTimeMicros += entry.selfTimeMicros;
    if (entry.categories.length === 0) {
      unknownCpu.samples += entry.samples;
      unknownCpu.selfTimeMicros += entry.selfTimeMicros;
    }
    for (const category of entry.categories) {
      categoryMap.get(category).cpuSamples += entry.samples;
      categoryMap.get(category).selfTimeMicros += entry.selfTimeMicros;
    }
  }
  for (const entry of allocationFrames) {
    categoryMap.get('allocation').allocationBytes += entry.bytes;
    if (entry.categories.length === 0) unknownAllocation.bytes += entry.bytes;
    for (const category of entry.categories) {
      categoryMap.get(category).allocationBytes += entry.bytes;
    }
  }

  const rankedCategories = [...categoryMap].map(([category, counts]) =>
    categoryEvidence(category, counts, { allocatedBytes, totalCpuMicros }),
  );
  const topFive = rankedCategories
    .sort(compareCategoryEvidence)
    .filter((entry) => entry.cpuSelfSamples > 0 || entry.allocationBytes > 0)
    .slice(0, 5)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
  const topSelfFrames = aggregateCpuFrames(cpuFrames)
    .sort(
      (left, right) =>
        right.selfTimeMicros - left.selfTimeMicros ||
        right.samples - left.samples ||
        frameKey(left.frame).localeCompare(frameKey(right.frame)),
    )
    .slice(0, 5)
    .map((entry, index) => ({
      ...entry.frame,
      rank: index + 1,
      selfSamples: entry.samples,
      selfTimeMicros: entry.selfTimeMicros,
    }));
  const topAllocationFrames = aggregateAllocationFrames(allocationFrames)
    .sort(
      (left, right) =>
        right.bytes - left.bytes || frameKey(left.frame).localeCompare(frameKey(right.frame)),
    )
    .slice(0, 5)
    .map((entry, index) => ({ ...entry.frame, allocatedBytes: entry.bytes, rank: index + 1 }));

  return {
    categories: DEV_EDIT_PROFILE_CATEGORIES.map((category) => {
      const ranked = topFive.find((entry) => entry.category === category);
      const counts = categoryMap.get(category);
      const observed = counts.cpuSamples > 0 || counts.allocationBytes > 0;
      const evidence = categoryEvidence(category, counts, { allocatedBytes, totalCpuMicros });
      return {
        ...evidence,
        ruling: ranked
          ? 'present-in-current-top-five'
          : observed
            ? 'observed-outside-current-top-five'
            : 'retired-absent-from-current-profile',
        topFiveRank: ranked?.rank ?? null,
      };
    }),
    census: {
      activeCpuSamples,
      allocatedBytes,
      cpuNodes: cpu.nodes.length,
      heapNodes: countHeapNodes(heap.head),
      negativeCpuTimeDeltas: cpuTimeline.negativeTimeDeltas,
      totalCpuSamples: cpu.samples.length,
      totalCpuSelfMicros: totalCpuMicros,
      unknownAllocationBytes: unknownAllocation.bytes,
      unknownCpuSamples: unknownCpu.samples,
      unknownCpuSelfMicros: unknownCpu.selfTimeMicros,
    },
    note: 'Category evidence can overlap. Unknown frames remain unattributed; CPU and heap samples are never converted into invented phase durations.',
    classifier: DEV_EDIT_PROFILE_CLASSIFIER,
    topAllocationFrames,
    topFive,
    topSelfFrames,
  };
}

export function summarizeProfileWindows(windows, options = {}) {
  if (!Array.isArray(windows) || windows.length === 0) {
    throw new TypeError('at least one exact edit profile window is required');
  }
  const expectedCategories = new Set(DEV_EDIT_PROFILE_CATEGORIES);
  const aggregate = new Map(
    DEV_EDIT_PROFILE_CATEGORIES.map((category) => [
      category,
      { allocationBytes: 0, cpuSamples: 0, selfTimeMicros: 0 },
    ]),
  );
  let activeCpuSamples = 0;
  let allocatedBytes = 0;
  let negativeCpuTimeDeltas = 0;
  let totalCpuSelfMicros = 0;
  for (const window of windows) {
    for (const category of window.analysis.categories) {
      if (!expectedCategories.has(category.category)) {
        throw new TypeError(`unknown profile category ${String(category.category)}`);
      }
      const counts = aggregate.get(category.category);
      counts.allocationBytes += category.allocationBytes;
      counts.cpuSamples += category.cpuSelfSamples;
      counts.selfTimeMicros += category.selfTimeMicros;
    }
    activeCpuSamples += window.analysis.census.activeCpuSamples;
    allocatedBytes += window.analysis.census.allocatedBytes;
    negativeCpuTimeDeltas += window.analysis.census.negativeCpuTimeDeltas;
    totalCpuSelfMicros += window.analysis.census.totalCpuSelfMicros;
  }
  const ranking = [...aggregate]
    .map(([category, counts]) =>
      categoryEvidence(category, counts, { allocatedBytes, totalCpuMicros: totalCpuSelfMicros }),
    )
    .sort(compareCategoryEvidence);
  const topFive = ranking
    .filter((entry) => entry.cpuSelfSamples > 0 || entry.allocationBytes > 0)
    .slice(0, 5)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
  return {
    categories: ranking.map((entry) => ({
      ...entry,
      ruling:
        entry.cpuSelfSamples === 0 && entry.allocationBytes === 0
          ? 'retired-absent-from-current-profile'
          : topFive.some((candidate) => candidate.category === entry.category)
            ? 'present-in-current-top-five'
            : 'observed-outside-current-top-five',
      topFiveRank: topFive.find((candidate) => candidate.category === entry.category)?.rank ?? null,
    })),
    census: { activeCpuSamples, allocatedBytes, negativeCpuTimeDeltas, totalCpuSelfMicros },
    diagnosticOnly: {
      profilerPerturbsDurations: true,
      publishTimingClaims: false,
      reason:
        'Inspector CPU and heap samplers perturb edit-to-paint duration and RSS; only ranked self/allocation evidence is diagnostic.',
    },
    classifier: DEV_EDIT_PROFILE_CLASSIFIER,
    profileArtifacts: windows.map(({ artifact, identity }) => ({ artifact, ...identity })),
    sampling: {
      cpuIntervalMicros: options.cpuSamplingIntervalMicros ?? CPU_SAMPLING_INTERVAL_US,
      heapIntervalBytes: options.heapSamplingIntervalBytes ?? HEAP_SAMPLING_INTERVAL_BYTES,
    },
    schema: DEV_EDIT_PROFILE_SCHEMA,
    topFive,
    windowCount: windows.length,
    windows: options.observations ?? [],
    workload: options.workload ?? null,
  };
}

/** Re-read every retained Inspector file and reproduce the report summary from those exact bytes. */
export async function auditDevEditProfileArtifacts({ diagnostic, profileDir }) {
  if (diagnostic?.schema !== DEV_EDIT_PROFILE_SCHEMA) {
    throw new TypeError(`diagnostic report must use ${DEV_EDIT_PROFILE_SCHEMA}`);
  }
  if (diagnostic.classifier !== DEV_EDIT_PROFILE_CLASSIFIER) {
    throw new TypeError(`diagnostic report must use ${DEV_EDIT_PROFILE_CLASSIFIER}`);
  }
  if (!Array.isArray(diagnostic.windows) || diagnostic.windows.length === 0) {
    throw new TypeError('diagnostic report must retain exact profile windows');
  }
  const { digest: workloadDigest, ...workloadFacts } = diagnostic.workload ?? {};
  if (
    workloadDigest !== sha256(JSON.stringify(workloadFacts)) ||
    workloadFacts.classifier !== DEV_EDIT_PROFILE_CLASSIFIER ||
    workloadFacts.cpuSamplingIntervalMicros !== diagnostic.sampling?.cpuIntervalMicros ||
    workloadFacts.heapSamplingIntervalBytes !== diagnostic.sampling?.heapIntervalBytes
  ) {
    throw new TypeError('diagnostic workload identity is invalid');
  }
  const root = path.resolve(requiredString(profileDir, 'profile directory'));
  const expectedFiles = new Map();
  const editWindowCounts = {};
  const rawWindows = [];
  const observations = [];
  for (const expected of diagnostic.windows) {
    const identity = normalizeWindowIdentity(expected);
    editWindowCounts[identity.editClass] = (editWindowCounts[identity.editClass] ?? 0) + 1;
    const stem = `${identity.editClass}-${String(identity.iteration).padStart(3, '0')}`;
    const artifact = expected.artifact;
    for (const [kind, extension] of [
      ['cpu', 'cpuprofile'],
      ['heap', 'heapprofile'],
    ]) {
      const reference = artifact?.[kind];
      const expectedFile = `${stem}.${extension}`;
      if (
        reference?.file !== expectedFile ||
        !Number.isSafeInteger(reference?.bytes) ||
        reference.bytes <= 0 ||
        !/^sha256:[0-9a-f]{64}$/u.test(reference?.sha256 ?? '') ||
        expectedFiles.has(expectedFile)
      ) {
        throw new TypeError(`diagnostic ${kind} artifact is invalid for ${stem}`);
      }
      expectedFiles.set(expectedFile, reference);
    }
  }
  if (JSON.stringify(editWindowCounts) !== JSON.stringify(workloadFacts.editWindowCounts)) {
    throw new TypeError('diagnostic workload window census differs from retained windows');
  }
  const entries = await readdir(root, { withFileTypes: true });
  const observedFiles = entries
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const expectedNames = [...expectedFiles.keys()].sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(observedFiles) !== JSON.stringify(expectedNames)) {
    throw new Error('raw profile file census differs from the diagnostic report');
  }
  const authenticatedFiles = [];
  for (const expected of diagnostic.windows) {
    const identity = normalizeWindowIdentity(expected);
    const raw = {};
    for (const kind of ['cpu', 'heap']) {
      const reference = expected.artifact[kind];
      const absolutePath = path.join(root, reference.file);
      const stat = await lstat(absolutePath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(`raw profile artifact is not a regular file: ${reference.file}`);
      }
      const bytes = await readFile(absolutePath);
      const digest = sha256(bytes);
      if (bytes.byteLength !== reference.bytes || digest !== reference.sha256) {
        throw new Error(`raw profile artifact digest differs: ${reference.file}`);
      }
      try {
        raw[kind] = JSON.parse(bytes.toString('utf8'));
      } catch (error) {
        throw new TypeError(
          `raw profile artifact is not JSON: ${reference.file}: ${errorMessage(error)}`,
        );
      }
      authenticatedFiles.push({
        bytes: bytes.byteLength,
        file: reference.file,
        sha256: digest,
      });
    }
    const analysis = analyzeDevEditProfiles(raw);
    const observation = {
      activeCpuSamples: analysis.census.activeCpuSamples,
      allocatedBytes: analysis.census.allocatedBytes,
      artifact: expected.artifact,
      editClass: identity.editClass,
      iteration: identity.iteration,
      negativeCpuTimeDeltas: analysis.census.negativeCpuTimeDeltas,
      topAllocationFrames: analysis.topAllocationFrames,
      topFive: analysis.topFive,
      topSelfFrames: analysis.topSelfFrames,
    };
    observations.push(observation);
    rawWindows.push({ analysis, artifact: expected.artifact, identity });
  }
  const reproduced = summarizeProfileWindows(rawWindows, {
    cpuSamplingIntervalMicros: diagnostic.sampling?.cpuIntervalMicros,
    heapSamplingIntervalBytes: diagnostic.sampling?.heapIntervalBytes,
    observations,
    workload: diagnostic.workload,
  });
  if (JSON.stringify(reproduced) !== JSON.stringify(diagnostic)) {
    throw new Error('raw profile analysis does not reproduce the diagnostic report');
  }
  authenticatedFiles.sort((left, right) => left.file.localeCompare(right.file));
  return {
    authenticatedFiles,
    classifier: DEV_EDIT_PROFILE_CLASSIFIER,
    complete: true,
    profileSetSha256: sha256(JSON.stringify(authenticatedFiles)),
    schema: DEV_EDIT_PROFILE_AUDIT_SCHEMA,
    summarySha256: sha256(JSON.stringify(diagnostic)),
    windowCount: diagnostic.windowCount,
  };
}

function classifyFrame(frame) {
  const text = `${frame.functionName} ${frame.url ?? ''}`;
  const categories = [];
  if (
    /(?:(?:ModuleRunner|ESModulesEvaluator|evaluateModule|runInlinedModule|ssrLoadModule|runnerImport)[\w$]*|\bimport\b)/iu.test(
      text,
    )
  ) {
    categories.push('module-evaluation');
  }
  if (
    /(?:transformRequest|transformWithEsbuild|pluginContainer|environmentModuleGraph|loadAndTransform|doTransform)[\w$]*/iu.test(
      text,
    )
  ) {
    categories.push('vite-transform');
  }
  if (
    /(?:renderDocument|renderAppDocument|renderRoute|renderJsx|renderNode|renderChildren|renderComponent|ssrRender)[\w$]*/iu.test(
      text,
    )
  ) {
    categories.push('ssr-generation');
  }
  if (
    /(?:validateGeneration|stage|prepareBuildApp|analy[sz](?:e|is)|prove|proof|diagnostic|conformance|security)[\w$]*/iu.test(
      text,
    )
  ) {
    categories.push('asynchronous-proof-convergence');
  }
  return categories;
}

function cpuFrameSamples(profile, timeline) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const categoryCache = new Map();
  const counts = new Map();
  for (const { nodeId, selfTimeMicros } of timeline.samples) {
    const node = nodes.get(nodeId);
    const frame = node === undefined ? undefined : normalizedFrame(node.callFrame);
    if (frame === undefined || isIdleFrame(frame)) continue;
    const categories = cpuStackCategories(nodeId, nodes, timeline.parents, categoryCache);
    const key = JSON.stringify([frame, categories]);
    const prior = counts.get(key);
    counts.set(key, {
      categories,
      frame,
      samples: (prior?.samples ?? 0) + 1,
      selfTimeMicros: (prior?.selfTimeMicros ?? 0) + selfTimeMicros,
    });
  }
  return [...counts.values()];
}

/**
 * CDP time deltas are signed protocol integers. V8 can emit a small negative delta when samples
 * arrive out of timestamp order, and Chromium reconstructs the timestamps before sorting the
 * timestamp/sample pairs. Keep the Inspector arrays untouched and normalize only this derived
 * analysis view.
 */
function normalizedCpuTimeline(profile) {
  let timestamp = profile.startTime;
  let negativeTimeDeltas = 0;
  const samples = profile.samples.map((nodeId, originalIndex) => {
    const delta = profile.timeDeltas[originalIndex];
    if (!Number.isSafeInteger(delta)) {
      throw new TypeError(
        `CPU profile time delta ${String(originalIndex)} is not a safe integer: ${String(delta)}`,
      );
    }
    if (delta < 0) negativeTimeDeltas += 1;
    timestamp += delta;
    if (!Number.isSafeInteger(timestamp)) {
      throw new TypeError(
        `CPU profile sample timestamp ${String(originalIndex)} is not a safe integer`,
      );
    }
    if (timestamp < profile.startTime || timestamp > profile.endTime) {
      throw new TypeError(
        `CPU profile sample timestamp ${String(originalIndex)} is outside the profile time range (${String(timestamp)} not in [${String(profile.startTime)}, ${String(profile.endTime)}])`,
      );
    }
    return { nodeId, originalIndex, timestamp };
  });
  samples.sort(
    (left, right) => left.timestamp - right.timestamp || left.originalIndex - right.originalIndex,
  );
  let previousTimestamp = profile.startTime;
  return {
    negativeTimeDeltas,
    samples: samples.map((sample) => {
      const selfTimeMicros = sample.timestamp - previousTimestamp;
      previousTimestamp = sample.timestamp;
      return { nodeId: sample.nodeId, selfTimeMicros };
    }),
  };
}

function heapFrameAllocations(profile) {
  const counts = new Map();
  function visit(node, ancestorCategories = []) {
    const frame = normalizedFrame(node.callFrame);
    const categories = mergeCategories(ancestorCategories, classifyFrame(node.callFrame));
    const bytes = node.selfSize ?? 0;
    if (bytes > 0) {
      const key = JSON.stringify([frame, categories]);
      const prior = counts.get(key);
      counts.set(key, { bytes: (prior?.bytes ?? 0) + bytes, categories, frame });
    }
    for (const child of node.children ?? []) visit(child, categories);
  }
  visit(profile.head);
  return [...counts.values()];
}

function cpuNodeParents(nodes) {
  const parents = new Map();
  for (const node of nodes) {
    for (const child of node.children ?? []) {
      const prior = parents.get(child);
      if (prior !== undefined && prior !== node.id) {
        throw new TypeError(`CPU profile node ${String(child)} has multiple parents`);
      }
      parents.set(child, node.id);
    }
  }
  return parents;
}

function validateCpuParentGraph(ids, parents) {
  const resolved = new Set();
  for (const id of ids) {
    if (resolved.has(id)) continue;
    const visiting = new Set();
    let cursor = id;
    while (cursor !== undefined && !resolved.has(cursor)) {
      if (visiting.has(cursor)) {
        throw new TypeError('CPU profile parent graph contains a cycle');
      }
      visiting.add(cursor);
      cursor = parents.get(cursor);
    }
    for (const visited of visiting) resolved.add(visited);
  }
}

function cpuStackCategories(nodeId, nodes, parents, cache) {
  const cached = cache.get(nodeId);
  if (cached !== undefined) return cached;
  const visiting = new Set();
  let cursor = nodeId;
  let categories = [];
  while (cursor !== undefined) {
    if (visiting.has(cursor)) throw new TypeError('CPU profile parent graph contains a cycle');
    visiting.add(cursor);
    const node = nodes.get(cursor);
    if (node === undefined) break;
    categories = mergeCategories(categories, classifyFrame(node.callFrame));
    cursor = parents.get(cursor);
  }
  cache.set(nodeId, categories);
  return categories;
}

function mergeCategories(left, right) {
  const observed = new Set([...left, ...right]);
  return DEV_EDIT_PROFILE_CATEGORIES.filter(
    (category) => category !== 'self-time' && category !== 'allocation' && observed.has(category),
  );
}

function aggregateCpuFrames(frames) {
  const counts = new Map();
  for (const entry of frames) {
    const key = frameKey(entry.frame);
    const prior = counts.get(key);
    counts.set(key, {
      frame: entry.frame,
      samples: (prior?.samples ?? 0) + entry.samples,
      selfTimeMicros: (prior?.selfTimeMicros ?? 0) + entry.selfTimeMicros,
    });
  }
  return [...counts.values()];
}

function aggregateAllocationFrames(frames) {
  const counts = new Map();
  for (const entry of frames) {
    const key = frameKey(entry.frame);
    const prior = counts.get(key);
    counts.set(key, { bytes: (prior?.bytes ?? 0) + entry.bytes, frame: entry.frame });
  }
  return [...counts.values()];
}

function categoryEvidence(category, counts, { allocatedBytes, totalCpuMicros }) {
  const allocationPercent =
    allocatedBytes === 0 ? null : percent(counts.allocationBytes, allocatedBytes);
  const cpuSelfPercent = percent(counts.selfTimeMicros, totalCpuMicros);
  return {
    allocationBytes: counts.allocationBytes,
    allocationPercent,
    category,
    cpuSelfPercent,
    cpuSelfSamples: counts.cpuSamples,
    dominantPercent: Math.max(cpuSelfPercent, allocationPercent ?? 0),
    evidence:
      category === 'allocation'
        ? 'Inspector HeapProfiler sampling within exact edit-to-paint window'
        : category === 'self-time'
          ? 'Inspector CPU self time from sampled time deltas within exact edit-to-paint window'
          : 'Stack-attributed Inspector CPU self time and HeapProfiler sampling within exact edit-to-paint window',
    selfTimeMicros: counts.selfTimeMicros,
    status:
      category === 'allocation' && allocatedBytes === 0
        ? 'unavailable'
        : counts.cpuSamples === 0 && counts.allocationBytes === 0
          ? 'absent'
          : 'observed',
  };
}

function compareCategoryEvidence(left, right) {
  return (
    right.dominantPercent - left.dominantPercent ||
    right.cpuSelfPercent - left.cpuSelfPercent ||
    (right.allocationPercent ?? -1) - (left.allocationPercent ?? -1) ||
    left.category.localeCompare(right.category)
  );
}

function validateCpuProfile(profile) {
  if (!Array.isArray(profile?.nodes) || profile.nodes.length === 0) {
    throw new TypeError('CPU profile must contain nodes');
  }
  if (!Array.isArray(profile.samples) || profile.samples.length === 0) {
    throw new TypeError('CPU profile must contain samples');
  }
  if (
    !Number.isSafeInteger(profile.startTime) ||
    !Number.isSafeInteger(profile.endTime) ||
    profile.endTime < profile.startTime ||
    !Number.isSafeInteger(profile.endTime - profile.startTime)
  ) {
    throw new TypeError('CPU profile must contain a safe-integer ordered time range');
  }
  const invalidTimeDelta = Array.isArray(profile.timeDeltas)
    ? profile.timeDeltas.findIndex((value) => !Number.isSafeInteger(value))
    : -1;
  if (
    !Array.isArray(profile.timeDeltas) ||
    profile.timeDeltas.length !== profile.samples.length ||
    invalidTimeDelta !== -1
  ) {
    const timeDeltaCount = Array.isArray(profile.timeDeltas) ? profile.timeDeltas.length : 'absent';
    const invalidDetail =
      invalidTimeDelta === -1
        ? 'none'
        : `${String(invalidTimeDelta)}:${String(profile.timeDeltas[invalidTimeDelta])}`;
    throw new TypeError(
      `CPU profile must contain one safe-integer signed time delta per sample (samples=${String(profile.samples.length)}, timeDeltas=${String(timeDeltaCount)}, invalid=${invalidDetail})`,
    );
  }
  const ids = new Set();
  for (const node of profile.nodes) {
    if (
      !Number.isSafeInteger(node?.id) ||
      node?.callFrame === undefined ||
      (node.children !== undefined && !Array.isArray(node.children)) ||
      (Array.isArray(node.children) && new Set(node.children).size !== node.children.length) ||
      ids.has(node.id)
    ) {
      throw new TypeError('CPU profile contains invalid or duplicate nodes');
    }
    ids.add(node.id);
  }
  if (
    profile.samples.some((id) => !ids.has(id)) ||
    profile.nodes.some((node) => (node.children ?? []).some((id) => !ids.has(id)))
  ) {
    throw new TypeError('CPU profile contains unknown sample or child nodes');
  }
  const parents = cpuNodeParents(profile.nodes);
  validateCpuParentGraph(ids, parents);
  return { ...normalizedCpuTimeline(profile), parents };
}

async function retainRejectedWindow({ error, identity, profileDir, raw }) {
  const stem = `${identity.editClass}-${String(identity.iteration).padStart(3, '0')}`;
  const rejectionDir = path.join(profileDir, 'rejected');
  await mkdir(rejectionDir, { recursive: true, mode: 0o700 });
  const cpuBytes = exactJsonBytes(raw.cpu, 'rejected CPU profile');
  const heapBytes = exactJsonBytes(raw.heap, 'rejected heap profile');
  const artifacts = {
    cpu: {
      bytes: cpuBytes.byteLength,
      file: `${stem}.cpuprofile`,
      sha256: sha256(cpuBytes),
    },
    heap: {
      bytes: heapBytes.byteLength,
      file: `${stem}.heapprofile`,
      sha256: sha256(heapBytes),
    },
  };
  const rejection = {
    artifacts,
    error: errorMessage(error),
    identity,
    profileShape: {
      cpu: inspectorCpuProfileShape(raw.cpu),
      heap: inspectorHeapProfileShape(raw.heap),
    },
    schema: 'kovo-dev-edit-profile-rejection/v1',
  };
  await Promise.all([
    writeFile(path.join(rejectionDir, artifacts.cpu.file), cpuBytes, { flag: 'wx', mode: 0o600 }),
    writeFile(path.join(rejectionDir, artifacts.heap.file), heapBytes, {
      flag: 'wx',
      mode: 0o600,
    }),
    writeFile(
      path.join(rejectionDir, `${stem}.rejection.json`),
      Buffer.from(`${JSON.stringify(rejection, null, 2)}\n`),
      { flag: 'wx', mode: 0o600 },
    ),
  ]);
}

function exactJsonBytes(value, label) {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string') throw new TypeError(`${label} is not JSON-serializable`);
  return Buffer.from(`${serialized}\n`);
}

function inspectorCpuProfileShape(profile) {
  return {
    endTime: Number.isFinite(profile?.endTime) ? profile.endTime : null,
    nodes: Array.isArray(profile?.nodes) ? profile.nodes.length : null,
    samples: Array.isArray(profile?.samples) ? profile.samples.length : null,
    startTime: Number.isFinite(profile?.startTime) ? profile.startTime : null,
    timeDeltas: Array.isArray(profile?.timeDeltas) ? profile.timeDeltas.length : null,
  };
}

function inspectorHeapProfileShape(profile) {
  return {
    hasHead: profile?.head !== null && typeof profile?.head === 'object',
    samples: Array.isArray(profile?.samples) ? profile.samples.length : null,
  };
}

function validateHeapProfile(profile) {
  if (!profile?.head?.callFrame || !Array.isArray(profile.head.children)) {
    throw new TypeError('heap profile must contain a sampling tree');
  }
  const ids = new Set();
  const visit = (node) => {
    if (
      !Number.isSafeInteger(node?.id) ||
      ids.has(node.id) ||
      !node.callFrame ||
      !Array.isArray(node.children) ||
      !Number.isFinite(node.selfSize) ||
      node.selfSize < 0
    ) {
      throw new TypeError('heap profile contains an invalid or duplicate node');
    }
    ids.add(node.id);
    for (const child of node.children) visit(child);
  };
  visit(profile.head);
}

export async function connectDevInspector(options, dependencies = {}) {
  const inspectorPort = boundedInteger(options.inspectorPort, 1_024, 65_535, 'inspectorPort');
  const expectedPid = boundedInteger(
    options.expectedPid,
    1,
    Number.MAX_SAFE_INTEGER,
    'expectedPid',
  );
  const processMarker = requiredProcessMarker(options.processMarker);
  const fetchInspector = dependencies.fetch ?? fetch;
  const openSession = dependencies.openSession ?? openInspectorSession;
  const now = dependencies.now ?? (() => Date.now());
  const pause =
    dependencies.delay ??
    ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const timeoutMs = boundedInteger(
    dependencies.timeoutMs ?? CONNECTION_TIMEOUT_MS,
    1,
    60_000,
    'Inspector connection timeout',
  );
  const deadline = now() + timeoutMs;
  let lastError = 'Inspector did not answer';
  while (now() < deadline) {
    try {
      const response = await fetchInspector(`http://127.0.0.1:${String(inspectorPort)}/json/list`);
      if (!response.ok) throw new Error(`Inspector returned HTTP ${String(response.status)}`);
      const targets = parseInspectorTargetList(await response.text(), inspectorPort);
      for (const target of targets) {
        let session;
        try {
          session = await openSession(target.webSocketDebuggerUrl);
          const identity = await readInspectorIdentity(session, processMarker, target.id);
          if (
            identity.pid === expectedPid &&
            identity.processMarkerMatched === true &&
            identity.targetId === target.id
          ) {
            return { ...session, identity };
          }
          lastError = 'Inspector target did not belong to the spawned dev session';
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
        session?.close();
      }
      if (targets.length === 0) lastError = 'Inspector did not expose a websocket target';
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await pause(Math.max(1, Math.min(25, deadline - now())));
  }
  throw new Error(lastError);
}

/**
 * Authenticate a Node `--inspect-brk` target before Node bootstrap advances. At this phase Node
 * intentionally exposes the inherited environment but not `process.pid`, `process.argv`, or
 * `process.execArgv`; PID authority therefore comes from the exact default Runtime execution-context
 * name, while invocation authority comes from the framework-owned spawn record. The returned
 * one-shot capability starts both cold samplers before it releases the runtime.
 */
export async function connectPausedDevInspector(options, dependencies = {}) {
  const inspectorPort = boundedInteger(options.inspectorPort, 1_024, 65_535, 'inspectorPort');
  const expectedPid = boundedInteger(
    options.expectedPid,
    1,
    Number.MAX_SAFE_INTEGER,
    'expectedPid',
  );
  const processMarker = requiredProcessMarker(options.processMarker);
  const expectedDevPort = boundedInteger(options.expectedDevPort, 1_024, 65_535, 'dev port');
  const samplingIntervalMicros = boundedInteger(
    options.samplingIntervalMicros,
    100,
    10_000,
    'Inspector CPU sampling interval',
  );
  const invocation = validatePausedInspectorInvocation(options.invocation, {
    expectedDevPort,
    expectedEntrypoint: options.expectedEntrypoint,
    inspectorPort,
  });
  const fetchInspector = dependencies.fetch ?? fetch;
  const openSession = dependencies.openSession ?? openInspectorSession;
  const now = dependencies.now ?? (() => Date.now());
  const pause =
    dependencies.delay ??
    ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const timeoutMs = boundedInteger(
    dependencies.timeoutMs ?? CONNECTION_TIMEOUT_MS,
    1,
    60_000,
    'Inspector connection timeout',
  );
  const deadline = now() + timeoutMs;
  let lastError = 'paused Inspector did not answer';
  while (now() < deadline) {
    try {
      const response = await fetchInspector(`http://127.0.0.1:${String(inspectorPort)}/json/list`);
      if (!response.ok) throw new Error(`Inspector returned HTTP ${String(response.status)}`);
      const targets = parseInspectorTargetList(await response.text(), inspectorPort);
      for (const target of targets) {
        let session;
        try {
          session = await openSession(target.webSocketDebuggerUrl);
          const bootstrap = await readPausedBootstrapIdentity(
            session,
            { expectedPid, processMarker, targetId: target.id },
            { deadline, now, pause },
          );
          if (!bootstrap.processMarkerMatched) {
            lastError = 'paused Inspector target did not carry the spawned session marker';
            session.close();
            continue;
          }
          const authenticated = {
            close() {
              pausedInspectorSessions.delete(authenticated);
              session.close();
            },
            identity: {
              bootstrap,
              pid: expectedPid,
              processMarkerMatched: true,
              processMarkerSha256: sha256(processMarker),
              targetId: target.id,
            },
            invocation,
            send(method, params) {
              return session.send(method, params);
            },
            async startAndResume() {
              const state = pausedInspectorSessions.get(authenticated);
              if (state?.phase !== 'authenticated-pre-bootstrap' || state.targetId !== target.id) {
                throw new Error('paused Inspector session custody changed before runtime advance');
              }
              let coverageActive = false;
              let profilerActive = false;
              try {
                await session.send('Profiler.enable');
                await session.send('Profiler.setSamplingInterval', {
                  interval: samplingIntervalMicros,
                });
                await session.send('Profiler.startPreciseCoverage', {
                  callCount: true,
                  detailed: true,
                });
                coverageActive = true;
                await session.send('Profiler.start');
                profilerActive = true;
                dependencies.beforeRuntimeAdvance?.({ bootstrap, invocation, target });
                state.phase = 'profiling-pre-bootstrap';
                await session.send('Runtime.runIfWaitingForDebugger');
                state.phase = 'advanced';
              } catch (error) {
                await Promise.allSettled([
                  ...(profilerActive ? [session.send('Profiler.stop')] : []),
                  ...(coverageActive ? [session.send('Profiler.stopPreciseCoverage')] : []),
                ]);
                authenticated.close();
                throw error;
              }
            },
          };
          pausedInspectorSessions.set(authenticated, {
            phase: 'authenticated-pre-bootstrap',
            targetId: target.id,
          });
          return authenticated;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          session?.close();
          if (error instanceof PausedInspectorTerminalError) throw error;
        }
      }
      if (targets.length === 0) lastError = 'Inspector did not expose a websocket target';
    } catch (error) {
      if (error instanceof PausedInspectorTerminalError) throw error.cause ?? error;
      lastError = error instanceof Error ? error.message : String(error);
    }
    await pause(Math.max(1, Math.min(25, deadline - now())));
  }
  throw new Error(lastError);
}

function validatePausedInspectorInvocation(
  value,
  { expectedDevPort, expectedEntrypoint, inspectorPort },
) {
  const entrypoint = requiredString(expectedEntrypoint, 'paused Inspector packed entrypoint');
  if (!path.isAbsolute(entrypoint) || path.resolve(entrypoint) !== entrypoint) {
    throw new TypeError('paused Inspector packed entrypoint must be an absolute normalized path');
  }
  const expectedFlag = `--inspect-brk=127.0.0.1:${String(inspectorPort)}`;
  const expectedArgv = [
    expectedFlag,
    entrypoint,
    'dev',
    './src/app.tsx',
    '--host',
    'localhost',
    '--strict-port',
    '--port',
    String(expectedDevPort),
  ];
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !sameExactStringSet(Object.keys(value), [
      'argv',
      'executable',
      'pauseOnStart',
      'port',
      'schema',
    ]) ||
    value.schema !== 'kovo-profiled-process-invocation/v1' ||
    value.executable !== process.execPath ||
    value.pauseOnStart !== true ||
    value.port !== inspectorPort ||
    !Array.isArray(value.argv) ||
    value.argv.length !== expectedArgv.length ||
    value.argv.some(
      (argument) =>
        typeof argument !== 'string' ||
        argument.length === 0 ||
        argument.length > INSPECTOR_INVOCATION_MAX_STRING,
    ) ||
    value.argv.some((argument, index) => argument !== expectedArgv[index]) ||
    value.argv.filter((argument) => argument === expectedFlag).length !== 1 ||
    value.argv.some(
      (argument, index) =>
        index !== 0 &&
        (argument === '--inspect' ||
          argument === '--inspect-brk' ||
          argument.startsWith('--inspect=') ||
          argument.startsWith('--inspect-brk=')),
    )
  ) {
    throw new Error(
      'paused Inspector launch record is not the exact packed --inspect-brk invocation',
    );
  }
  return Object.freeze({
    argv: Object.freeze([...value.argv]),
    argvSha256: sha256(JSON.stringify([value.executable, ...value.argv])),
    entrypoint,
    executable: value.executable,
    execArgv: Object.freeze([expectedFlag]),
    pauseFlag: expectedFlag,
    schema: value.schema,
  });
}

async function readPausedBootstrapIdentity(
  session,
  { expectedPid, processMarker, targetId },
  { deadline, now, pause },
) {
  if (typeof session?.onEvent !== 'function') {
    throw new TypeError('paused Inspector session does not expose protocol events');
  }
  const events = [];
  let protocolError = null;
  const unsubscribe = session.onEvent((event) => {
    if (event?.error instanceof Error) {
      protocolError ??= event.error;
    } else if (event?.method === 'Runtime.executionContextCreated') {
      events.push(event.params);
    }
  });
  try {
    await session.send('Runtime.enable');
    while (events.length === 0 && protocolError === null && now() < deadline) {
      await pause(Math.max(1, Math.min(5, deadline - now())));
    }
    if (events.length > 0 && protocolError === null && now() < deadline) {
      await pause(Math.max(1, Math.min(5, deadline - now())));
    }
  } finally {
    unsubscribe();
  }
  if (protocolError !== null) throw protocolError;
  if (events.length !== 1) {
    throw new Error(
      events.length === 0
        ? 'paused Inspector omitted its default execution context'
        : 'paused Inspector exposed a duplicate execution-context census',
    );
  }
  const context = events[0]?.context;
  if (
    context === null ||
    typeof context !== 'object' ||
    Array.isArray(context) ||
    !Number.isSafeInteger(context.id) ||
    context.id <= 0 ||
    typeof context.name !== 'string' ||
    context.name.length === 0 ||
    context.name.length > INSPECTOR_INVOCATION_MAX_STRING ||
    context.origin !== '' ||
    context.auxData === null ||
    typeof context.auxData !== 'object' ||
    Array.isArray(context.auxData) ||
    context.auxData.isDefault !== true
  ) {
    throw new Error('paused Inspector default execution context was malformed');
  }
  const evaluated = await session.send('Runtime.evaluate', {
    contextId: context.id,
    expression: `({processMarkerMatched:globalThis.process?.env?.[${JSON.stringify(
      processMarker,
    )}]==='1',pidType:typeof globalThis.process?.pid,argvType:typeof globalThis.process?.argv,execArgvType:typeof globalThis.process?.execArgv})`,
    returnByValue: true,
  });
  const value = evaluated?.result?.value;
  const markerMatched = value?.processMarkerMatched === true;
  const expectedContextName = `${process.execPath}[${String(expectedPid)}]`;
  if (
    evaluated?.exceptionDetails !== undefined ||
    evaluated?.result?.type !== 'object' ||
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof value.processMarkerMatched !== 'boolean' ||
    value.pidType !== 'undefined' ||
    value.argvType !== 'undefined' ||
    value.execArgvType !== 'undefined' ||
    context.name !== expectedContextName
  ) {
    const error = new PausedInspectorTerminalError(
      'paused Inspector target was not the expected unadvanced Node bootstrap context',
    );
    if (markerMatched) throw error;
    return {
      contextId: context.id,
      contextName: context.name,
      processMarkerMatched: false,
      schema: DEV_PAUSED_INSPECTOR_BOOTSTRAP_SCHEMA,
      targetId,
    };
  }
  return Object.freeze({
    contextId: context.id,
    contextName: context.name,
    contextOrigin: context.origin,
    processGlobals: 'pid-argv-execArgv-undefined',
    processMarkerMatched: markerMatched,
    schema: DEV_PAUSED_INSPECTOR_BOOTSTRAP_SCHEMA,
    targetId,
  });
}

async function openInspectorSession(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  const eventListeners = new Set();
  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      for (const listener of eventListeners) {
        listener({
          error: new Error('Inspector emitted malformed JSON'),
          method: null,
          params: null,
        });
      }
      socket.close();
      return;
    }
    if (message === null || typeof message !== 'object' || Array.isArray(message)) {
      for (const listener of eventListeners) {
        listener({
          error: new Error('Inspector emitted a malformed protocol message'),
          method: null,
          params: null,
        });
      }
      socket.close();
      return;
    }
    if (message.id === undefined) {
      if (
        typeof message.method !== 'string' ||
        message.method.length === 0 ||
        message.params === null ||
        typeof message.params !== 'object' ||
        Array.isArray(message.params)
      ) {
        for (const listener of eventListeners) {
          listener({
            error: new Error('Inspector emitted a malformed event'),
            method: null,
            params: null,
          });
        }
        socket.close();
        return;
      }
      for (const listener of eventListeners) {
        listener({ error: null, method: message.method, params: message.params });
      }
      return;
    }
    const request = pending.get(message.id);
    if (request === undefined) return;
    pending.delete(message.id);
    if (message.error !== undefined) {
      request.reject(new Error(`Inspector ${request.method}: ${String(message.error.message)}`));
    } else request.resolve(message.result ?? {});
  });
  socket.addEventListener('close', () => {
    for (const request of pending.values()) request.reject(new Error('Inspector socket closed'));
    pending.clear();
    for (const listener of eventListeners) {
      listener({ error: new Error('Inspector socket closed'), method: null, params: null });
    }
    eventListeners.clear();
  });
  return {
    close() {
      socket.close();
    },
    onEvent(listener) {
      if (typeof listener !== 'function')
        throw new TypeError('Inspector event listener is required');
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { method, reject, resolve });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

function parseInspectorTargetList(source, inspectorPort) {
  if (
    typeof source !== 'string' ||
    source.length < 2 ||
    source.length > INSPECTOR_TARGET_LIST_MAX_CHARS
  ) {
    throw new TypeError('Inspector target list exceeded its evidence bound');
  }
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new TypeError('Inspector target list was not valid JSON');
  }
  if (!Array.isArray(value) || value.length > INSPECTOR_TARGET_LIST_MAX_ENTRIES) {
    throw new TypeError('Inspector target list had an invalid entry census');
  }
  const targets = [];
  const ids = new Set();
  for (const entry of value) {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      typeof entry.id !== 'string' ||
      entry.id.length < 1 ||
      entry.id.length > 256 ||
      ids.has(entry.id) ||
      typeof entry.webSocketDebuggerUrl !== 'string'
    ) {
      throw new TypeError('Inspector target identity was malformed');
    }
    const url = new URL(entry.webSocketDebuggerUrl);
    if (
      url.protocol !== 'ws:' ||
      url.hostname !== '127.0.0.1' ||
      Number(url.port) !== inspectorPort ||
      url.username !== '' ||
      url.password !== '' ||
      url.search !== '' ||
      url.hash !== '' ||
      url.pathname !== `/${entry.id}`
    ) {
      throw new TypeError('Inspector websocket target escaped the exact loopback endpoint');
    }
    ids.add(entry.id);
    targets.push({ id: entry.id, webSocketDebuggerUrl: url.href });
  }
  return targets;
}

async function readInspectorIdentity(session, processMarker, targetId) {
  const result = await session.send('Runtime.evaluate', {
    expression: `({pid:globalThis.process?.pid??null,processMarkerMatched:globalThis.process?.env?.[${JSON.stringify(processMarker)}]==='1'})`,
    returnByValue: true,
  });
  const value = result?.result?.value;
  return validateInspectorIdentity(
    {
      pid: value?.pid,
      processMarkerMatched: value?.processMarkerMatched,
      processMarkerSha256: sha256(processMarker),
      targetId,
    },
    { processMarker },
  );
}

function validateInspectorIdentity(value, expected = {}) {
  if (
    value === null ||
    typeof value !== 'object' ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 0 ||
    value.processMarkerMatched !== true ||
    value.processMarkerSha256 !== sha256(requiredProcessMarker(expected.processMarker)) ||
    typeof value.targetId !== 'string' ||
    value.targetId.length < 1 ||
    value.targetId.length > 256 ||
    (expected.expectedPid !== undefined && value.pid !== expected.expectedPid)
  ) {
    throw new TypeError('Inspector target identity did not match the spawned dev session');
  }
  return {
    pid: value.pid,
    processMarkerMatched: true,
    processMarkerSha256: value.processMarkerSha256,
    targetId: value.targetId,
  };
}

function requiredProcessMarker(value) {
  if (typeof value !== 'string' || !/^KOVO_PERF_DEV_SESSION_[A-Z0-9_]+$/u.test(value)) {
    throw new TypeError('Inspector process marker is malformed');
  }
  return value;
}

function normalizeWindowIdentity(value) {
  if (!value || typeof value !== 'object')
    throw new TypeError('profile window identity is required');
  const editClass = requiredString(value.editClass, 'editClass');
  const iteration = boundedInteger(value.iteration, 0, 99, 'iteration');
  return { editClass, iteration };
}

function normalizedFrame(frame) {
  return {
    columnNumber: Number.isSafeInteger(frame?.columnNumber) ? frame.columnNumber : 0,
    functionName:
      typeof frame?.functionName === 'string' && frame.functionName.length > 0
        ? frame.functionName
        : '(anonymous)',
    lineNumber: Number.isSafeInteger(frame?.lineNumber) ? frame.lineNumber : 0,
    url: typeof frame?.url === 'string' && frame.url.length > 0 ? portableUrl(frame.url) : null,
  };
}

function portableUrl(value) {
  let candidate = value;
  try {
    const url = new URL(value);
    if (url.protocol === 'file:') candidate = decodeURIComponent(url.pathname);
  } catch {
    // Preserve Inspector's node: and synthetic URLs below.
  }
  const normalized = candidate.replaceAll('\\', '/');
  for (const marker of ['/packages/', '/benchmarks/', '/node_modules/']) {
    const index = normalized.lastIndexOf(marker);
    if (index !== -1) return normalized.slice(index + 1).slice(-256);
  }
  if (path.isAbsolute(candidate)) return path.basename(candidate);
  return normalized.length > 256 ? `...${normalized.slice(-253)}` : normalized;
}

function isIdleFrame(frame) {
  return /^(?:\(idle\)|\(program\)|\(root\))$/u.test(frame.functionName);
}

function countHeapNodes(node) {
  return 1 + (node.children ?? []).reduce((total, child) => total + countHeapNodes(child), 0);
}

function canonicalIdentity(value) {
  return `${value.editClass}:${String(value.iteration)}`;
}

function frameKey(frame) {
  return `${frame.functionName}:${frame.url ?? ''}:${String(frame.lineNumber)}:${String(frame.columnNumber)}`;
}

function assertOpen(closed) {
  if (closed) throw new Error('diagnostic profiler is closed');
}

function percent(value, total) {
  return total === 0 ? 0 : (value / total) * 100;
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function sameExactStringSet(left, right) {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort((a, b) => a.localeCompare(b));
  const sortedRight = [...right].sort((a, b) => a.localeCompare(b));
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function boundedInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(
      `${label} must be an integer from ${String(minimum)} through ${String(maximum)}`,
    );
  }
  return value;
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} is required`);
  return value;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
