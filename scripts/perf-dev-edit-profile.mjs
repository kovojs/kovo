#!/usr/bin/env node
/**
 * Exact edit-to-paint CPU/allocation diagnostics for the generated developer corpora.
 *
 * `benchmarks/corpora/dev-loop.mjs` owns the browser-visible window. This helper speaks Inspector
 * to that exact dev-server process and starts/stops both samplers around each measured source write
 * through the destination paint fence. Profile-perturbed wall/RSS values remain diagnostic-only.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DEV_EDIT_PROFILE_SCHEMA = 'kovo-dev-edit-profile/v1';
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

export async function createDevEditProfiler(options, dependencies = {}) {
  const framework = requiredString(options.framework, 'framework');
  if (framework !== 'kovo') {
    throw new TypeError('Exact Inspector dev profiling currently supports only Kovo.');
  }
  const inspectorPort = boundedInteger(options.inspectorPort, 1_024, 65_535, 'inspectorPort');
  const modules = boundedInteger(options.modules, 1, 10_000, 'modules');
  const profileDir = path.resolve(requiredString(options.profileDir, 'profileDir'));
  const workload = {
    framework,
    modules,
    profileScope: 'measured-source-write-through-destination-paint',
    schema: 'kovo-dev-edit-profile-workload/v1',
  };
  await mkdir(profileDir, { recursive: true, mode: 0o700 });
  const session = await (dependencies.connectInspector ?? connectInspector)({ inspectorPort });
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
    const raw = validateRawWindow({ cpu: cpuResult?.profile, heap: heapResult?.profile });
    const analysis = analyzeDevEditProfiles(raw);
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
      topAllocationFrames: analysis.topAllocationFrames,
      topFive: analysis.topFive,
      topSelfFrames: analysis.topSelfFrames,
    };
    observations.push(observation);
    active = null;
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
      return summarizeProfileWindows(rawWindows, {
        cpuSamplingIntervalMicros: CPU_SAMPLING_INTERVAL_US,
        heapSamplingIntervalBytes: HEAP_SAMPLING_INTERVAL_BYTES,
        observations,
        workload: { ...workload, digest: sha256(JSON.stringify(workload)) },
      });
    },
  };
}

export function analyzeDevEditProfiles({ cpu, heap }) {
  validateCpuProfile(cpu);
  validateHeapProfile(heap);
  const cpuFrames = cpuFrameSamples(cpu);
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
    const categories = classifyFrame(entry.frame);
    categoryMap.get('self-time').cpuSamples += entry.samples;
    categoryMap.get('self-time').selfTimeMicros += entry.selfTimeMicros;
    if (categories.length === 0) {
      unknownCpu.samples += entry.samples;
      unknownCpu.selfTimeMicros += entry.selfTimeMicros;
    }
    for (const category of categories) {
      categoryMap.get(category).cpuSamples += entry.samples;
      categoryMap.get(category).selfTimeMicros += entry.selfTimeMicros;
    }
  }
  for (const entry of allocationFrames) {
    categoryMap.get('allocation').allocationBytes += entry.bytes;
    if (classifyFrame(entry.frame).length === 0) unknownAllocation.bytes += entry.bytes;
  }

  const topFive = [...categoryMap]
    .map(([category, counts]) => ({
      allocationBytes: counts.allocationBytes,
      allocationPercent:
        allocatedBytes === 0 ? null : percent(counts.allocationBytes, allocatedBytes),
      category,
      cpuSelfPercent: percent(counts.selfTimeMicros, totalCpuMicros),
      cpuSelfSamples: counts.cpuSamples,
      selfTimeMicros: counts.selfTimeMicros,
      evidence:
        category === 'allocation'
          ? 'Inspector HeapProfiler sampling within exact edit-to-paint window'
          : 'Inspector CPU self time from sampled time deltas within exact edit-to-paint window',
      status:
        category === 'allocation' && allocatedBytes === 0
          ? 'unavailable'
          : counts.cpuSamples === 0 && counts.allocationBytes === 0
            ? 'absent'
            : 'observed',
    }))
    .sort(
      (left, right) =>
        right.selfTimeMicros - left.selfTimeMicros ||
        right.allocationBytes - left.allocationBytes ||
        left.category.localeCompare(right.category),
    )
    .filter((entry) => entry.cpuSelfSamples > 0 || entry.allocationBytes > 0)
    .slice(0, 5)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
  const topSelfFrames = cpuFrames
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
  const topAllocationFrames = allocationFrames
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
      return {
        allocationBytes: counts.allocationBytes,
        allocationPercent:
          allocatedBytes === 0 ? null : percent(counts.allocationBytes, allocatedBytes),
        category,
        cpuSelfPercent: percent(counts.selfTimeMicros, totalCpuMicros),
        cpuSelfSamples: counts.cpuSamples,
        selfTimeMicros: counts.selfTimeMicros,
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
      totalCpuSamples: cpu.samples.length,
      totalCpuSelfMicros: totalCpuMicros,
      unknownAllocationBytes: unknownAllocation.bytes,
      unknownCpuSamples: unknownCpu.samples,
      unknownCpuSelfMicros: unknownCpu.selfTimeMicros,
    },
    note: 'Category evidence can overlap. Unknown frames remain unattributed; CPU and heap samples are never converted into invented phase durations.',
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
    totalCpuSelfMicros += window.analysis.census.totalCpuSelfMicros;
  }
  const ranking = [...aggregate]
    .map(([category, counts]) => ({
      allocationBytes: counts.allocationBytes,
      allocationPercent:
        allocatedBytes === 0 ? null : percent(counts.allocationBytes, allocatedBytes),
      category,
      cpuSelfPercent: percent(counts.selfTimeMicros, totalCpuSelfMicros),
      cpuSelfSamples: counts.cpuSamples,
      selfTimeMicros: counts.selfTimeMicros,
    }))
    .sort(
      (left, right) =>
        right.selfTimeMicros - left.selfTimeMicros ||
        right.allocationBytes - left.allocationBytes ||
        left.category.localeCompare(right.category),
    );
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
    census: { activeCpuSamples, allocatedBytes, totalCpuSelfMicros },
    diagnosticOnly: {
      profilerPerturbsDurations: true,
      publishTimingClaims: false,
      reason:
        'Inspector CPU and heap samplers perturb edit-to-paint duration and RSS; only ranked self/allocation evidence is diagnostic.',
    },
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

function classifyFrame(frame) {
  const text = `${frame.functionName} ${frame.url ?? ''}`;
  const categories = [];
  if (
    /\b(?:ModuleRunner|ESModulesEvaluator|evaluateModule|runInlinedModule|ssrLoadModule|runnerImport|import)\b/iu.test(
      text,
    )
  ) {
    categories.push('module-evaluation');
  }
  if (
    /(?:node_modules\/vite|vite\/(?:dist|src)|\b(?:transformRequest|transformWithEsbuild|pluginContainer|environmentModuleGraph)\b)/iu.test(
      text,
    )
  ) {
    categories.push('vite-transform');
  }
  if (
    /\b(?:renderDocument|renderAppDocument|renderRoute|renderJsx|renderNode|renderChildren|renderComponent|ssrRender)\b/iu.test(
      text,
    )
  ) {
    categories.push('ssr-generation');
  }
  if (
    /\b(?:validateGeneration|stage|prepareBuildApp|analy[sz]e|prove|proof|diagnostic|conformance|security)\b/iu.test(
      text,
    )
  ) {
    categories.push('asynchronous-proof-convergence');
  }
  return categories;
}

function cpuFrameSamples(profile) {
  const frames = new Map(profile.nodes.map((node) => [node.id, normalizedFrame(node.callFrame)]));
  const counts = new Map();
  for (let index = 0; index < profile.samples.length; index += 1) {
    const nodeId = profile.samples[index];
    const frame = frames.get(nodeId);
    if (frame === undefined || isIdleFrame(frame)) continue;
    const key = JSON.stringify(frame);
    const prior = counts.get(key);
    counts.set(key, {
      frame,
      samples: (prior?.samples ?? 0) + 1,
      selfTimeMicros: (prior?.selfTimeMicros ?? 0) + profile.timeDeltas[index],
    });
  }
  return [...counts.values()];
}

function heapFrameAllocations(profile) {
  const counts = new Map();
  function visit(node) {
    const frame = normalizedFrame(node.callFrame);
    const bytes = node.selfSize ?? 0;
    if (bytes > 0) {
      const key = JSON.stringify(frame);
      const prior = counts.get(key);
      counts.set(key, { bytes: (prior?.bytes ?? 0) + bytes, frame });
    }
    for (const child of node.children ?? []) visit(child);
  }
  visit(profile.head);
  return [...counts.values()];
}

function validateRawWindow(raw) {
  validateCpuProfile(raw?.cpu);
  validateHeapProfile(raw?.heap);
  return raw;
}

function validateCpuProfile(profile) {
  if (!Array.isArray(profile?.nodes) || profile.nodes.length === 0) {
    throw new TypeError('CPU profile must contain nodes');
  }
  if (!Array.isArray(profile.samples) || profile.samples.length === 0) {
    throw new TypeError('CPU profile must contain samples');
  }
  if (
    !Array.isArray(profile.timeDeltas) ||
    profile.timeDeltas.length !== profile.samples.length ||
    profile.timeDeltas.some((value) => !Number.isFinite(value) || value < 0)
  ) {
    throw new TypeError('CPU profile must contain one finite time delta per sample');
  }
  const ids = new Set();
  for (const node of profile.nodes) {
    if (!Number.isSafeInteger(node?.id) || node?.callFrame === undefined || ids.has(node.id)) {
      throw new TypeError('CPU profile contains invalid or duplicate nodes');
    }
    ids.add(node.id);
  }
  if (profile.samples.some((id) => !ids.has(id))) {
    throw new TypeError('CPU profile contains unknown sample nodes');
  }
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

async function connectInspector({ inspectorPort }) {
  const deadline = Date.now() + CONNECTION_TIMEOUT_MS;
  let target;
  let lastError = 'Inspector did not answer';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${String(inspectorPort)}/json/list`);
      if (!response.ok) throw new Error(`Inspector returned HTTP ${String(response.status)}`);
      const list = await response.json();
      target = list.find((entry) => typeof entry?.webSocketDebuggerUrl === 'string');
      if (target !== undefined) break;
      lastError = 'Inspector did not expose a websocket target';
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (target === undefined) throw new Error(lastError);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
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
  });
  return {
    close() {
      socket.close();
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
  try {
    const url = new URL(value);
    if (url.protocol === 'file:') return path.basename(url.pathname);
  } catch {
    // Preserve Inspector's node: and synthetic URLs below.
  }
  return value.length > 256 ? `${value.slice(0, 253)}...` : value;
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
