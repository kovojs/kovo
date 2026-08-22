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
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import {
  cleanGeneratedOutputs,
  launchDevSessionAfterHandoff,
  loadCorpusManifest,
  materializeEntrantCommand,
  measureFreshReady,
  verifyCorpusSources,
} from '../benchmarks/corpora/dev-loop.mjs';
import { DEV_SESSION_PORT_STRIDE } from '../benchmarks/corpora/generate.mjs';
import {
  DEFAULT_DEV_PORT_BASE,
  inspectDevPortAllocation,
  validateDevPortAllocationEvidence,
} from '../benchmarks/harness/dev-port-allocation.mjs';
import { connectDevInspector } from './perf-dev-edit-profile.mjs';
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
const CONTROLLER_FILES = Object.freeze([
  'benchmarks/corpora/dev-loop.mjs',
  'benchmarks/corpora/generate.mjs',
  'benchmarks/harness/dev-port-allocation.mjs',
  'scripts/lib/perf-packed-kovo-product.mjs',
  'scripts/lib/perf-ready-route.mjs',
  'scripts/perf-dev-edit-profile.mjs',
  'scripts/perf-dev-generation-spike.mjs',
  'scripts/perf-dev-ready-profile.mjs',
]);
const controllerRoot = fileURLToPath(new URL('..', import.meta.url));

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
  const consumerRoot = canonicalDirectory(options.consumerRoot, 'packed consumer root');
  const productDigest = validSha256(options.productDigest, 'packed product digest');
  const reservation = reserveArtifactStem(profileDir, artifactStem);
  let session;
  try {
    session = await (dependencies.connectInspector ?? connectDevInspector)({
      expectedPid,
      inspectorPort,
      processMarker,
    });
    validateReadyInspectorIdentity(session?.identity, { expectedPid, processMarker });
    const invocation = await readPausedInspectorInvocation(session, inspectorPort);
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
      await session.send('Profiler.enable');
      await session.send('Profiler.setSamplingInterval', { interval: CPU_SAMPLING_INTERVAL_US });
      await session.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
      await session.send('Profiler.start');
      active = true;
      try {
        await session.send('Runtime.runIfWaitingForDebugger');
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
      const cpuBytes = serializedArtifactBytes(cpu, MAX_CPU_PROFILE_BYTES, 'CPU profile');
      const coverageBytes = serializedArtifactBytes(
        coverage,
        MAX_COVERAGE_BYTES,
        'precise coverage',
      );
      const artifact = reservation.write(cpuBytes, coverageBytes);
      captured = true;
      await closeSession();
      return {
        artifact,
        calls: callEvidence.calls,
        diagnosticOnly: DIAGNOSTIC_ONLY_POLICY,
        inspectorProcess: {
          pid: expectedPid,
          processMarkerSha256: sha256(Buffer.from(processMarker)),
          targetId: session.identity.targetId,
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
        const source = readFileSync(asset.absolutePath, 'utf8');
        if (!bundleRangeDeclaresFunction(source, outer, target.name)) {
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

export async function runDevReadyProfile(options = {}, dependencies = {}) {
  const policy = normalizeReadyProfileOptions(options);
  const collectControllerState =
    dependencies.collectControllerState ?? collectDevReadyProfileControllerState;
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
      installTimeoutMs: policy.installTimeoutMs,
      size: 216,
      spikeRoot: policy.spikeRoot,
    },
    dependencies.preparationDependencies ?? {},
  );
  try {
    assertPreparedReadyProfile(prepared);
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
            priorSession = `ready-profile[${String(scheduled.scheduleIndex)}]`;
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
    const complete = errors.length === 0 && cells.length === DEV_READY_PROFILE_SCHEDULE.length;
    const report = {
      candidate: prepared.candidateBinding,
      cells,
      controller: { after: controllerAfter, before: controllerBefore, stable: controllerStable },
      finishedAt: new Date().toISOString(),
      host: (dependencies.hostFingerprint ?? performanceHostFingerprint)(),
      hostDiagnostics: postTimingHost === null ? [] : [postTimingHost],
      hostSamples,
      integrity: {
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
  const collectState = dependencies.collectState ?? collectWorktreeState;
  const git = dependencies.git ?? controllerGitOutput;
  const state = collectState(root);
  const tree = git(root, ['rev-parse', 'HEAD^{tree}']);
  const scripts = Object.fromEntries(
    CONTROLLER_FILES.map((relativePath) => {
      const absolutePath = path.join(root, relativePath);
      const stat = lstatSync(absolutePath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(`diagnostic controller file is not regular: ${relativePath}`);
      }
      const bytes = readFileSync(absolutePath);
      return [
        relativePath,
        {
          bytes: bytes.byteLength,
          gitBlob: git(root, ['rev-parse', `HEAD:${relativePath}`]),
          sha256: sha256(bytes),
        },
      ];
    }),
  );
  return { ...state, root, scripts, tree };
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
  const targetSession = `ready-profile[${String(options.scheduleIndex)}]`;
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
      consumerRoot: packedBefore.consumerRoot,
      expectedPid: launched.session.pid,
      inspectorPort: options.inspectorPort,
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
  return {
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
    processMarker: launched.session.processMarker,
    profile: observation.readyDiagnostic,
    scheduleIndex: options.scheduleIndex,
  };
}

export function validateProfiledReadyObservation(observation) {
  if (
    observation?.success !== true ||
    observation.browserContextClosed !== true ||
    observation.lifecycle?.complete !== true ||
    !finiteNonNegative(observation.durationMs) ||
    !finiteNonNegative(observation.paintFenceMs) ||
    !Number.isSafeInteger(observation.peakRssBytes) ||
    observation.peakRssBytes < 1 ||
    !Number.isSafeInteger(observation.rssSamples) ||
    observation.rssSamples < 1 ||
    observation.browser?.requestFailedCount !== 0 ||
    observation.browser?.unexpectedErrorCount !== 0 ||
    !validReadyRouteProbe(observation.readinessProbe) ||
    observation.readyDiagnostic?.schema !== DEV_READY_PROFILE_WINDOW_SCHEMA ||
    observation.readyDiagnostic?.diagnosticOnly?.acceptanceEligible !== false
  ) {
    throw new Error('fresh-ready profiled observation is incomplete or not diagnostic-only');
  }
  return observation;
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

function assertPreparedReadyProfile(prepared) {
  if (
    prepared?.candidateBinding?.schema !== DEV_GENERATION_CANDIDATE_BINDING_SCHEMA ||
    prepared.candidateBinding.baseline?.commit !== DEV_CRITICAL_PATH_CANDIDATE.parent ||
    prepared.candidateBinding.spike?.commit !== DEV_CRITICAL_PATH_CANDIDATE.commit ||
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
  if (
    cell?.scheduleIndex !== expected.scheduleIndex ||
    cell.lane !== expected.lane ||
    cell.occurrence !== expected.occurrence ||
    cell.profile?.schema !== DEV_READY_PROFILE_WINDOW_SCHEMA ||
    cell.profile?.diagnosticOnly?.acceptanceEligible !== false ||
    cell.authentication?.product?.beforeVerified !== true ||
    cell.authentication?.product?.afterVerified !== true ||
    cell.authentication?.corpus?.beforeVerified !== true ||
    cell.authentication?.corpus?.afterVerified !== true ||
    cell.observation?.success !== true
  ) {
    throw new Error('fresh-ready diagnostic cell is incomplete or schedule-confused');
  }
}

function validateControllerState(value, phase) {
  if (
    value === null ||
    typeof value !== 'object' ||
    value.dirty !== false ||
    !Array.isArray(value.dirtyPaths) ||
    value.dirtyPaths.length !== 0 ||
    !/^[0-9a-f]{40,64}$/u.test(value.commit ?? '') ||
    !/^[0-9a-f]{40,64}$/u.test(value.tree ?? '') ||
    value.scripts === null ||
    typeof value.scripts !== 'object' ||
    Object.keys(value.scripts).length !== CONTROLLER_FILES.length ||
    CONTROLLER_FILES.some(
      (file) =>
        !Number.isSafeInteger(value.scripts[file]?.bytes) ||
        value.scripts[file].bytes < 1 ||
        !/^[0-9a-f]{40,64}$/u.test(value.scripts[file]?.gitBlob ?? '') ||
        !/^sha256:[0-9a-f]{64}$/u.test(value.scripts[file]?.sha256 ?? ''),
    )
  ) {
    throw new Error(`diagnostic controller is dirty or unauthenticated ${phase}`);
  }
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
  const stat = lstatSync(declaredPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('target precise-coverage script is not a regular file');
  }
  const absolutePath = realpathSync(declaredPath);
  if (!isWithinOrEqual(consumerRoot, absolutePath)) {
    throw new Error('target precise-coverage script escaped the authenticated packed consumer');
  }
  const mapPath = `${declaredPath}.map`;
  const mapStat = lstatSync(mapPath);
  if (!mapStat.isFile() || mapStat.isSymbolicLink()) {
    throw new Error('target precise-coverage script has no regular source map');
  }
  const mapRealPath = realpathSync(mapPath);
  if (!isWithinOrEqual(consumerRoot, mapRealPath)) {
    throw new Error('target precise-coverage source map escaped the packed consumer');
  }
  const bytes = readFileSync(absolutePath);
  const mapBytes = readFileSync(mapRealPath);
  if (!bytes.toString('utf8').includes(`sourceMappingURL=${path.basename(mapPath)}`)) {
    throw new Error('target precise-coverage script does not bind its sibling source map');
  }
  return {
    absolutePath,
    evidence: {
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      sourceMap: { bytes: mapBytes.byteLength, sha256: sha256(mapBytes) },
    },
    relativePath: path.relative(consumerRoot, absolutePath).split(path.sep).join('/'),
  };
}

async function readPausedInspectorInvocation(session, inspectorPort) {
  const result = await session.send('Runtime.evaluate', {
    expression: '({execArgv:globalThis.process?.execArgv??null})',
    returnByValue: true,
  });
  const execArgv = result?.result?.value?.execArgv;
  const expected = `--inspect-brk=127.0.0.1:${String(inspectorPort)}`;
  if (
    !Array.isArray(execArgv) ||
    execArgv.length > 32 ||
    execArgv.some(
      (value) =>
        typeof value !== 'string' || value.length === 0 || value.length > MAX_EVIDENCE_STRING,
    ) ||
    execArgv.filter((value) => value === expected).length !== 1 ||
    execArgv.some(
      (value) =>
        value !== expected &&
        (value.startsWith('--inspect=') || value.startsWith('--inspect-brk=')),
    )
  ) {
    throw new Error('Inspector target was not the exact paused packed CLI invocation');
  }
  return { execArgv, pauseFlag: expected };
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
    identity.targetId.length > 256
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
        writeFileSync(cpuPath, cpuBytes, { flag: 'wx', mode: 0o600 });
        cpuWritten = true;
        writeFileSync(coveragePath, coverageBytes, { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if (cpuWritten) rmSync(cpuPath, { force: true });
        throw error;
      }
      return {
        cpu: artifactEvidence(cpuPath, cpuBytes, profileDir),
        coverage: artifactEvidence(coveragePath, coverageBytes, profileDir),
      };
    },
  };
}

function artifactEvidence(file, bytes, root) {
  return {
    bytes: bytes.byteLength,
    file: path.relative(root, file).split(path.sep).join('/'),
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

function controllerGitOutput(root, args) {
  try {
    return String(
      execFileSync('git', ['-C', root, ...args], {
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    ).trim();
  } catch (error) {
    throw new Error(`diagnostic controller Git authentication failed: ${errorMessage(error)}`);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseDevReadyProfileArgs(argv);
  const report = await runDevReadyProfile(parsed);
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(path.resolve(parsed.out), serialized, { flag: 'wx', mode: 0o600 });
  process.stdout.write(serialized);
  return report.verdict.status === 'diagnostic-only' ? 0 : 1;
}

if (isMainEntry(import.meta.url)) await runGate(() => main());
