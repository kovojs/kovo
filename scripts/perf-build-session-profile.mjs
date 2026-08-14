#!/usr/bin/env node
/**
 * Diagnostic-only N=216 warm-build CPU-profile producer.
 *
 * Kovo's one-shot build deliberately runs analyze/client/server/final in separate processes so
 * their compiler heaps never overlap. A parent-only Inspector profile would therefore describe
 * waiting, not the build. This producer enables Node's CPU profiler for the exact manifest-owned
 * build process tree, discards the benchmark wrapper profile, and losslessly remaps the retained
 * V8 node graphs into one standard V8 profile per warm mode. The fixed reviewed classifier then
 * derives the only session-eligibility claim. Profiled durations are never published.
 *
 * SPEC.md §5.2 rule 9: warmth is diagnostic evidence only. Every profiled invocation still runs
 * the current-source verifier and deployment proof through the ordinary one-shot build command.
 */
import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { performanceWorkloadIdentity } from '../benchmarks/compare.mjs';
import {
  BUILD_BENCHMARK_SCHEMA,
  runBuildBenchmark,
  sameSourceState,
} from './perf-build-benchmark.mjs';
import {
  PERF_BUILD_SESSION_PROFILE_SCHEMA,
  PERF_BUILD_SESSION_PROFILE_CLASSIFIER,
} from './perf-build-budget.mjs';
import {
  deriveBuildProfileSetAnalysis,
  PERF_BUILD_PROFILE_CLASSIFIER,
} from './lib/perf-build-profile-classifier.mjs';
import { executionIdentityFindings, performanceExecutionIdentity } from './lib/perf-execution.mjs';
import {
  canonicalJson,
  performanceHostFingerprint,
  performanceHostFingerprintFindings,
} from './lib/perf-host.mjs';
import { collectPerformanceProvenance } from './lib/perf-provenance.mjs';
import { measureProcessTreeCommand } from './lib/process-tree-rss.mjs';

export const BUILD_PROFILE_ARTIFACT_NAME = 'kovo-perf-build-profile-n216';
export const BUILD_PROFILE_MODES = Object.freeze(['unchanged', 'edit']);
export const BUILD_PROFILE_PROCESS_TREE_SCHEMA = 'kovo-build-process-tree-cpu-profile/v1';
export const BUILD_PROFILE_CAPTURE_SCHEMA = 'kovo-build-cpu-profile-capture/v1';
export const BUILD_PROFILE_PROCESS_CPU_SCHEMA = 'kovo-build-process-tree-cpu/v1';
export const BUILD_PROFILE_PROCESS_CENSUS_SCHEMA = 'kovo-build-process-census/v1';
export const BUILD_PROFILE_PROCESS_ROLE_CLASSIFIER = 'kovo-build-exec-argv-role/v1';
export const BUILD_PROFILE_CORPUS_SIZE = 216;
export const BUILD_PROFILE_WARMUPS = 3;
// A complete throwaway N=216 capture at 500us perturbed workers beyond their deadline. The
// coarser 10ms interval completed all four one-shot workers and produced all nine expected Node
// profiles; profiled durations remain diagnostic-only.
export const BUILD_PROFILE_SAMPLING_INTERVAL_US = 10_000;

const BUILD_PROFILE_BUILD_SAMPLES = 10;
const BUILD_PROFILE_TIMEOUT_MS = 30 * 60 * 1_000;
const MAX_PROCESS_TRACE_BYTES = 16 * 1024 * 1024;
const MAX_STRACE_STRING_BYTES = 16 * 1024;
const MAX_INPUT_PROFILE_BYTES = 128 * 1024 * 1024;
const MAX_AGGREGATE_PROFILE_BYTES = 512 * 1024 * 1024;
const REQUIRED_LOCKS = Object.freeze([
  'pnpm-lock.yaml',
  'benchmarks/nextjs/pnpm-lock.yaml',
  'benchmarks/harness/pnpm-lock.yaml',
]);
const REQUIRED_WORKER_MARKERS = Object.freeze([
  'produceKovoBuildOneShotAnalysis',
  'produceKovoBuildOneShotClientPhase',
  'produceKovoBuildOneShotServerPhase',
  'finishKovoBuildOneShot',
]);
const CPU_PROFILE_FLAG_PATTERN = /(?:^|\s)--cpu-prof(?:\s|=|$)/u;
const CPU_PROFILE_NAME_PATTERN = /^CPU\.\d{8}\.\d{6}\.(\d+)\.(\d+)\.(\d+)\.cpuprofile$/u;
const SAFE_EXECUTABLE_PATTERN = /^\/[A-Za-z0-9_+./:@=-]{1,4096}$/u;
const STRACE_PATH = '/usr/bin/strace';
const TIME_PATH = '/usr/bin/time';
const ENV_PATH = '/usr/bin/env';
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** Produce both authenticated diagnostic reports and their exact raw profile bytes. */
export async function produceBuildSessionProfiles(options = {}, dependencies = {}) {
  const outDir = path.resolve(requiredString(options.outDir, 'output directory'));
  const corpusManifest = path.resolve(
    options.corpusManifest ??
      path.join(repoRoot, 'benchmarks/kovo/.corpora/kovo/n216/manifest.json'),
  );
  const requireProvider = options.requireProvider;
  if (requireProvider !== undefined && requireProvider !== 'github-actions') {
    throw new TypeError('build profile provider must be github-actions when specified');
  }

  const collectSource = dependencies.collectSource ?? collectPerformanceProvenance;
  const sourceOptions = { lockFiles: [...REQUIRED_LOCKS], repoRoot };
  const source = collectSource(sourceOptions);
  requireCleanSource(source, 'pre-profile source');
  if (
    process.env.KOVO_PERF_SOURCE_SHA !== undefined &&
    source.commit !== process.env.KOVO_PERF_SOURCE_SHA
  ) {
    throw new TypeError('build profile source differs from KOVO_PERF_SOURCE_SHA');
  }

  const execution = (dependencies.executionIdentity ?? performanceExecutionIdentity)();
  const executionFindings = executionIdentityFindings(execution, { requireProvider });
  if (executionFindings.length > 0) {
    throw new TypeError(`build profile execution identity: ${executionFindings.join('; ')}`);
  }
  if (requireProvider === 'github-actions' && execution.github?.job !== 'build-profile') {
    throw new TypeError('hosted build profile must execute in the exact build-profile job');
  }
  const host = (dependencies.hostFingerprint ?? performanceHostFingerprint)();
  const hostFindings = performanceHostFingerprintFindings(host);
  if (hostFindings.length > 0) {
    throw new TypeError(`build profile host identity: ${hostFindings.join('; ')}`);
  }
  if (requireProvider === 'github-actions' && host.runnerImage === null) {
    throw new TypeError('hosted build profile runner image identity is absent');
  }

  const workloadIdentity = await (dependencies.workloadIdentity ?? defaultBuildWorkloadIdentity)();
  requireBuildWorkloadIdentity(workloadIdentity);
  const manifest = await readBuildManifest(corpusManifest);
  const scratchRoot = await mkdtemp(path.join(os.tmpdir(), 'kovo-build-profile-'));
  const outputs = [];
  try {
    for (const mode of BUILD_PROFILE_MODES) {
      const modeRoot = path.join(scratchRoot, mode);
      await mkdir(modeRoot, { recursive: true });
      const warmReport = await (dependencies.runWarmBuild ?? defaultWarmBuild)({
        corpusManifest,
        mode,
        scratchRoot: modeRoot,
      });
      const warmFindings = buildBenchmarkFindings(warmReport, {
        expectedCommand: manifest.build.command,
        expectedIterations: BUILD_PROFILE_WARMUPS,
        expectedMode: 'unchanged',
        expectedSource: source,
      });
      if (warmFindings.length > 0) {
        throw new TypeError(`${mode} build profile warmups: ${warmFindings.join('; ')}`);
      }

      const capture = await (dependencies.runProfiledBuild ?? defaultProfiledBuild)({
        corpusManifest,
        mode,
        scratchRoot: modeRoot,
      });
      const profileFindings = buildBenchmarkFindings(capture.report, {
        expectedCommand: manifest.build.command,
        expectedIterations: 1,
        expectedMode: mode,
        expectedSource: source,
      });
      if (profileFindings.length > 0) {
        throw new TypeError(`${mode} profiled build: ${profileFindings.join('; ')}`);
      }
      requireProfiledCaptureConsistency(capture);

      const rawProfiles = capture.profileInputs
        .map((entry) => ({
          ...entry,
          member: `raw-${mode}-${entry.role}-pid-${String(entry.pid)}.cpuprofile`,
        }))
        .sort((left, right) => left.member.localeCompare(right.member));
      const merged = mergeBuildProcessProfiles(rawProfiles);
      const profileSetAnalysis = (dependencies.deriveProfileSet ?? deriveBuildProfileSetAnalysis)(
        rawProfiles.map(({ bytes, role }) => ({ bytes, role })),
        {
          nativeOrUnprofiledSamples: capture.processCpu.cause.equivalentSamples,
          requireConfigStaticTrust: profiledConfigTrustExecuted(capture.report),
        },
      );
      const topFive = profileSetAnalysis.topFive;
      const sourceAfter = collectSource(sourceOptions);
      requireCleanSource(sourceAfter, `${mode} post-profile source`);
      if (!sameSourceState(source, sourceAfter)) {
        throw new TypeError(`${mode} build profile changed repository source provenance`);
      }
      const rawFileName = `build-${mode}.cpuprofile`;
      const report = createBuildSessionProfileReport({
        capture: {
          ...merged.census,
          processCensus: capture.processCensus,
          processCpu: capture.processCpu,
          profileSetAnalysis,
        },
        execution,
        host,
        manifest,
        mode,
        processCpuArtifact: {
          bytes: capture.processCpuBytes.length,
          fileName: `process-cpu-${mode}.txt`,
          sha256: sha256(capture.processCpuBytes),
        },
        profileArtifacts: rawProfiles.map((entry) => ({
          activeSamples: entry.facts.activeSamples,
          bytes: entry.bytes.length,
          idleSamples: entry.facts.idleSamples,
          member: entry.member,
          negativeTimeDeltas: entry.facts.negativeTimeDeltas,
          nodes: entry.facts.nodes,
          pid: entry.pid,
          role: entry.role,
          samples: entry.facts.samples,
          sha256: sha256(entry.bytes),
          waitSamples: entry.facts.waitSamples,
        })),
        profileBytes: merged.bytes,
        rawFileName,
        source,
        sourceAfter,
        topFive,
        workloadIdentity,
      });
      outputs.push({
        mode,
        processCpuBytes: capture.processCpuBytes,
        profileBytes: merged.bytes,
        rawProfiles,
        report,
      });
    }

    const finalSource = collectSource(sourceOptions);
    requireCleanSource(finalSource, 'post-profile source');
    if (!sameSourceState(source, finalSource)) {
      throw new TypeError('build profile source changed across the two-mode capture');
    }
    await writeProfileArtifact(outDir, outputs);
    return {
      artifactName: BUILD_PROFILE_ARTIFACT_NAME,
      files: outputs.flatMap(({ mode, rawProfiles }) => [
        `profile-${mode}.json`,
        `build-${mode}.cpuprofile`,
        `process-cpu-${mode}.txt`,
        ...rawProfiles.map(({ member }) => member),
      ]),
      outDir,
      reports: Object.fromEntries(outputs.map(({ mode, report }) => [mode, report])),
    };
  } finally {
    await rm(scratchRoot, { force: true, recursive: true });
  }
}

/**
 * Merge raw Node process profiles without inventing stack ancestry across processes.
 *
 * One synthetic root owns each input root, node IDs are remapped, and every original sample and
 * time delta is retained. Inputs without an exact Kovo CLI module are benchmark/tool wrappers and
 * are excluded before aggregation; all Kovo CLI/worker subprocess profiles remain included.
 */
export function mergeBuildProcessProfiles(profileInputs) {
  if (!Array.isArray(profileInputs) || profileInputs.length === 0) {
    throw new TypeError('profiled build produced no process CPU profiles');
  }
  let inputBytes = 0;
  const parsed = profileInputs.map((entry, index) => {
    if (!Buffer.isBuffer(entry?.bytes) || entry.bytes.length === 0) {
      throw new TypeError(`process CPU profile ${String(index + 1)} is empty`);
    }
    if (entry.bytes.length > MAX_INPUT_PROFILE_BYTES) {
      throw new TypeError(`process CPU profile ${String(index + 1)} exceeds its byte limit`);
    }
    inputBytes += entry.bytes.length;
    if (inputBytes > MAX_AGGREGATE_PROFILE_BYTES) {
      throw new TypeError('process CPU profile input census exceeds its aggregate byte limit');
    }
    let profile;
    try {
      profile = JSON.parse(entry.bytes.toString('utf8'));
    } catch {
      throw new TypeError(`process CPU profile ${String(index + 1)} is not JSON`);
    }
    const facts = validateRawProcessProfile(profile, index);
    if (
      entry.pid !== undefined &&
      (!Number.isSafeInteger(entry.pid) || entry.pid < 1 || typeof entry.role !== 'string')
    ) {
      throw new TypeError(`process CPU profile ${String(index + 1)} has invalid role custody`);
    }
    return {
      bytes: entry.bytes,
      digest: sha256(entry.bytes),
      facts,
      member: entry.member ?? null,
      pid: entry.pid ?? null,
      profile,
      role: entry.role ?? null,
    };
  });
  const included = parsed.sort((left, right) =>
    (left.member ?? left.digest).localeCompare(right.member ?? right.digest),
  );

  const nodes = [];
  const samples = [];
  const timeDeltas = [];
  const syntheticRootChildren = [];
  let nextId = 2;
  for (const entry of included) {
    const idMap = new Map();
    for (const node of entry.profile.nodes) idMap.set(node.id, nextId++);
    const childIds = new Set(entry.profile.nodes.flatMap((node) => node.children ?? []));
    for (const node of entry.profile.nodes) {
      const remapped = {
        ...node,
        id: idMap.get(node.id),
        ...(node.children === undefined
          ? {}
          : { children: node.children.map((child) => idMap.get(child)) }),
      };
      nodes.push(remapped);
      if (!childIds.has(node.id)) syntheticRootChildren.push(remapped.id);
    }
    samples.push(...entry.profile.samples.map((sample) => idMap.get(sample)));
    timeDeltas.push(...entry.profile.timeDeltas);
  }
  nodes.unshift({
    callFrame: {
      columnNumber: -1,
      functionName: '(kovo process tree)',
      lineNumber: -1,
      scriptId: '0',
      url: '',
    },
    children: syntheticRootChildren,
    hitCount: 0,
    id: 1,
  });
  const mergedClockDuration = included.reduce(
    (sum, { profile }) => sum + (profile.endTime - profile.startTime),
    0,
  );
  if (!Number.isFinite(mergedClockDuration) || mergedClockDuration < 0) {
    throw new TypeError('merged build CPU profile clock is invalid');
  }
  const profile = {
    endTime: mergedClockDuration,
    kovoProcessTree: {
      includedProfiles: included.map(({ bytes, digest, facts, member, pid, role }) => ({
        activeSamples: facts.activeSamples,
        bytes: bytes.length,
        idleSamples: facts.idleSamples,
        member,
        negativeTimeDeltas: facts.negativeTimeDeltas,
        nodes: facts.nodes,
        pid,
        role,
        samples: facts.samples,
        sha256: digest,
        waitSamples: facts.waitSamples,
      })),
      schema: BUILD_PROFILE_PROCESS_TREE_SCHEMA,
    },
    nodes,
    samples,
    startTime: 0,
    timeDeltas,
  };
  const bytes = Buffer.from(JSON.stringify(profile));
  if (bytes.length > MAX_AGGREGATE_PROFILE_BYTES) {
    throw new TypeError('merged build CPU profile exceeds its byte limit');
  }
  const markerFunctions = new Set(
    nodes.map((node) => node.callFrame?.functionName).filter((value) => typeof value === 'string'),
  );
  const missingWorkers = REQUIRED_WORKER_MARKERS.filter((marker) => !markerFunctions.has(marker));
  if (missingWorkers.length > 0) {
    throw new TypeError(
      `build CPU profile omitted one-shot worker markers: ${missingWorkers.join(', ')}`,
    );
  }
  return {
    bytes,
    census: {
      complete: true,
      excludedNonKovoProfiles: 0,
      includedProfiles: included.length,
      inputProfiles: parsed.length,
      mergedNodes: nodes.length,
      mergedSamples: samples.length,
      merger: 'lossless-node-id-remap-with-synthetic-root/v1',
      processProfiles: profile.kovoProcessTree.includedProfiles,
      schema: BUILD_PROFILE_CAPTURE_SCHEMA,
    },
  };
}

/** Create the exact report schema already consumed by the build persistence assessor. */
export function createBuildSessionProfileReport({
  capture,
  execution,
  host,
  manifest,
  mode,
  processCpuArtifact,
  profileArtifacts,
  profileBytes,
  rawFileName,
  source,
  sourceAfter,
  topFive,
  workloadIdentity,
}) {
  if (!BUILD_PROFILE_MODES.includes(mode)) throw new TypeError('unsupported build profile mode');
  if (!Buffer.isBuffer(profileBytes) || profileBytes.length === 0) {
    throw new TypeError('build profile bytes are unavailable');
  }
  if (PERF_BUILD_SESSION_PROFILE_CLASSIFIER !== PERF_BUILD_PROFILE_CLASSIFIER) {
    throw new TypeError('build profile classifier contract differs from the persistence assessor');
  }
  const sourceStable = sameSourceState(source, sourceAfter);
  if (
    capture?.complete !== true ||
    capture?.processCensus?.complete !== true ||
    capture?.processCpu?.complete !== true ||
    capture?.profileSetAnalysis?.complete !== true ||
    capture.profileSetAnalysis.classifier !== PERF_BUILD_PROFILE_CLASSIFIER ||
    !sourceStable ||
    !Array.isArray(profileArtifacts) ||
    profileArtifacts.length < 1 ||
    canonicalJson(topFive) !== canonicalJson(capture.profileSetAnalysis.topFive)
  ) {
    throw new TypeError('build profile capture is incomplete');
  }
  const artifactMembers = [
    rawFileName,
    `process-cpu-${mode}.txt`,
    `profile-${mode}.json`,
    ...profileArtifacts.map(({ member }) => member),
  ].sort((left, right) => left.localeCompare(right));
  const facts = {
    artifactMembers,
    buildInvocation: {
      adapter: BUILD_BENCHMARK_SCHEMA,
      argv: [...manifest.build.command.argv],
      cwd: manifest.build.command.cwd,
      env: { ...manifest.build.command.env },
      manifest: {
        bytes: manifest.bytes,
        path: manifest.relativePath,
        sha256: manifest.sha256,
        shapeDigest: `sha256:${manifest.value.shapeDigest}`,
        sourceDigest: manifest.value.sourceDigest,
      },
      mode,
      profiledIterations: 1,
      warmups: BUILD_PROFILE_WARMUPS,
      ...(mode === 'edit'
        ? {
            edit: {
              ...manifest.build.edit,
              profiledRevision: 1,
              sourceRestoredAfterProfile: true,
            },
          }
        : {}),
    },
    capture,
    classifier: PERF_BUILD_PROFILE_CLASSIFIER,
    diagnosticOnly: { profilerPerturbsDurations: true, publishTimingClaims: false },
    execution,
    host,
    integrity: {
      complete: true,
      errors: [],
      profileFlushedBeforeExit: true,
      processCensusComplete: true,
      processCpuComplete: true,
      sourceStable,
    },
    processCpuArtifact,
    profileArtifact: {
      bytes: profileBytes.length,
      fileName: rawFileName,
      sha256: sha256(profileBytes),
    },
    profileArtifacts,
    schema: PERF_BUILD_SESSION_PROFILE_SCHEMA,
    source,
    sourceAfter,
    subject: {
      baselineWorkloadDigest: workloadIdentity.digest,
      corpusSize: BUILD_PROFILE_CORPUS_SIZE,
      mode,
    },
    topFive,
    verdict: { reasons: [], status: 'diagnostic' },
    workloadIdentity,
  };
  return { ...facts, digest: sha256(Buffer.from(canonicalJson(facts))) };
}

export function parseBuildProfileArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--corpus', '--out-dir', '--require-provider'].includes(key) || !value) {
      throw new TypeError(`unknown or incomplete build profile option ${String(key)}`);
    }
    if (Object.hasOwn(values, key)) throw new TypeError(`duplicate build profile option ${key}`);
    values[key] = value;
  }
  return {
    ...(values['--corpus'] === undefined
      ? {}
      : { corpusManifest: path.resolve(values['--corpus']) }),
    outDir: path.resolve(requiredString(values['--out-dir'], 'output directory')),
    ...(values['--require-provider'] === undefined
      ? {}
      : { requireProvider: values['--require-provider'] }),
  };
}

async function defaultBuildWorkloadIdentity() {
  return performanceWorkloadIdentity(
    {
      cells: ['build'],
      corpusSize: BUILD_PROFILE_CORPUS_SIZE,
      iterations: BUILD_PROFILE_BUILD_SAMPLES,
      warmups: BUILD_PROFILE_WARMUPS,
    },
    ['build'],
  );
}

function defaultWarmBuild({ corpusManifest }) {
  return runBuildBenchmark({
    corpus: corpusManifest,
    framework: 'kovo',
    iterations: BUILD_PROFILE_WARMUPS,
    mode: 'unchanged',
    timeoutMs: BUILD_PROFILE_TIMEOUT_MS,
    warmups: 0,
  });
}

async function defaultProfiledBuild({ corpusManifest, mode, scratchRoot }) {
  const profilerDir = path.join(scratchRoot, 'process-profiles');
  const tracePath = path.join(scratchRoot, 'process.trace');
  const processCpuPath = path.join(scratchRoot, 'process-cpu.txt');
  await mkdir(profilerDir, { mode: 0o700, recursive: true });
  await Promise.all([
    requireExecutable(STRACE_PATH, 'strace'),
    requireExecutable(TIME_PATH, 'GNU time'),
    requireExecutable(ENV_PATH, 'env'),
  ]);
  const existingNodeOptions = process.env.NODE_OPTIONS ?? '';
  if (CPU_PROFILE_FLAG_PATTERN.test(existingNodeOptions)) {
    throw new TypeError('NODE_OPTIONS already contains --cpu-prof; profile ownership is ambiguous');
  }
  const profilerOptions = [
    '--cpu-prof',
    `--cpu-prof-dir=${JSON.stringify(profilerDir)}`,
    `--cpu-prof-interval=${String(BUILD_PROFILE_SAMPLING_INTERVAL_US)}`,
  ].join(' ');
  const profiledNodeOptions = `${existingNodeOptions} ${profilerOptions}`.trim();
  let measuredCommands = 0;
  const report = runBuildBenchmark(
    {
      corpus: corpusManifest,
      framework: 'kovo',
      iterations: 1,
      mode,
      timeoutMs: BUILD_PROFILE_TIMEOUT_MS,
      warmups: 0,
    },
    {
      measureProcessTreeCommand(command, commandOptions) {
        measuredCommands += 1;
        if (measuredCommands !== 1) {
          throw new TypeError('profiled build attempted more than one measured command');
        }
        return measureProcessTreeCommand(
          [
            STRACE_PATH,
            '-f',
            '-qq',
            '-s',
            String(MAX_STRACE_STRING_BYTES),
            '-e',
            'trace=process',
            '-o',
            tracePath,
            TIME_PATH,
            '-f',
            `kovo-build-process-cpu/v1 interval=${String(BUILD_PROFILE_SAMPLING_INTERVAL_US)} user=%U system=%S exit=%x`,
            '-o',
            processCpuPath,
            ENV_PATH,
            `NODE_OPTIONS=${profiledNodeOptions}`,
            ...command,
          ],
          {
            ...commandOptions,
            // The RSS supervisor is evidence infrastructure, not part of the build process tree.
            // Only /usr/bin/env below time/strace receives the profiling flags.
            env: {
              ...commandOptions.env,
              LC_ALL: 'C',
              NODE_OPTIONS: existingNodeOptions,
            },
          },
        );
      },
    },
  );
  if (measuredCommands !== 1) throw new TypeError('profiled build command census is incomplete');
  const processCpuBytes = await readFile(processCpuPath);
  const entries = await readdir(profilerDir, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile() || !entry.name.endsWith('.cpuprofile'))) {
    throw new TypeError('profile directory contains an unexpected member');
  }
  const rawProfileInputs = (
    await Promise.all(
      entries
        .map(({ name }) => name)
        .sort((left, right) => left.localeCompare(right))
        .map(async (name) => {
          const identity = parseCpuProfileName(name);
          const bytes = await readFile(path.join(profilerDir, name));
          const profile = parseRawProfile(bytes);
          return {
            bytes,
            facts: validateRawProcessProfile(profile, identity.pid),
            name,
            pid: identity.pid,
          };
        }),
    )
  ).sort((left, right) => left.pid - right.pid);
  let sanitizedTrace;
  try {
    const traceMetadata = await stat(tracePath);
    if (traceMetadata.size < 1 || traceMetadata.size > MAX_PROCESS_TRACE_BYTES) {
      throw new TypeError('build process trace has an invalid bounded size');
    }
    sanitizedTrace = sanitizeBuildProcessTrace(await readFile(tracePath), {
      cwd: path.dirname(corpusManifest),
    });
  } finally {
    // Static-trust worker argv contains an authentication key and challenge. Raw strace bytes are
    // never an artifact, report field, diagnostic, or retained scratch member.
    await rm(tracePath, { force: true });
  }
  const authenticated = await authenticateBuildProcessCensus({
    profileInputs: rawProfileInputs,
    report,
    sanitizedTrace,
  });
  const { processCensus } = authenticated;
  let { profileInputs } = authenticated;
  const inspectedProfiles = deriveBuildProfileSetAnalysis(
    profileInputs.map(({ bytes, role }) => ({ bytes, role })),
    { requireConfigStaticTrust: profiledConfigTrustExecuted(report) },
  );
  profileInputs = profileInputs.map((entry, index) => {
    const census = inspectedProfiles.profileCensus[index];
    if (
      census.role !== entry.role ||
      census.activeSamples + census.idleSamples + census.waitSamples !== census.samples
    ) {
      throw new TypeError('build CPU profile sample census is inconsistent');
    }
    return {
      ...entry,
      facts: {
        activeSamples: census.activeSamples,
        idleSamples: census.idleSamples,
        negativeTimeDeltas: census.negativeTimeDeltas,
        nodes: census.nodes,
        samples: census.samples,
        waitSamples: census.waitSamples,
      },
    };
  });
  const processCpu = deriveBuildProcessCpuEvidence({
    processCensus,
    processCpuBytes,
    profileInputs,
  });
  return {
    processCensus,
    processCpu,
    processCpuBytes,
    profileInputs,
    report,
  };
}

/** Parse strace process events into bounded non-secret PID/executable/entry-role facts only. */
export function sanitizeBuildProcessTrace(traceBytes, { cwd = repoRoot } = {}) {
  if (!Buffer.isBuffer(traceBytes) || traceBytes.length < 1) {
    throw new TypeError('build process trace is unavailable');
  }
  if (traceBytes.length > MAX_PROCESS_TRACE_BYTES) {
    throw new TypeError('build process trace exceeds its byte limit');
  }
  const parentByPid = new Map();
  const processChildren = new Set();
  const pendingCloneByPid = new Map();
  const finalExecByPid = new Map();
  for (const line of traceBytes.toString('utf8').split(/\r?\n/u)) {
    if (line.length === 0) continue;
    const prefix = /^(?:\[pid\s+)?(\d+)\]?\s+/u.exec(line);
    if (!prefix) continue;
    const pid = Number(prefix[1]);
    if (!Number.isSafeInteger(pid) || pid < 1) throw new TypeError('malformed build process trace');
    const event = line.slice(prefix[0].length);
    const executed = parseSuccessfulExecve(event, cwd);
    if (executed !== null) {
      finalExecByPid.set(pid, executed);
      continue;
    }
    const clone = parseTraceCloneEvent(event, pendingCloneByPid.get(pid));
    if (clone.pending !== undefined) {
      pendingCloneByPid.set(pid, clone.pending);
      continue;
    }
    if (clone.resolved !== undefined) {
      pendingCloneByPid.delete(pid);
      if (clone.resolved.thread) continue;
      const childPid = clone.resolved.childPid;
      if (parentByPid.has(childPid)) {
        throw new TypeError('malformed build process trace parent relation');
      }
      parentByPid.set(childPid, pid);
      processChildren.add(childPid);
    }
  }
  if (pendingCloneByPid.size > 0) {
    throw new TypeError('build process trace has an unfinished process creation event');
  }
  const executedParent = (pid) => {
    const visited = new Set();
    let parentPid = parentByPid.get(pid) ?? null;
    while (parentPid !== null && !finalExecByPid.has(parentPid)) {
      if (visited.has(parentPid)) {
        throw new TypeError('build process trace parent relation is cyclic');
      }
      visited.add(parentPid);
      parentPid = parentByPid.get(parentPid) ?? null;
    }
    return parentPid;
  };
  const processes = [...finalExecByPid]
    .map(([pid, executed]) => ({
      entryPath: executed.entryPath,
      executable: executed.executable,
      parentPid: executedParent(pid),
      pid,
      role: executed.role,
      roleEvidence: executed.roleEvidence,
    }))
    .sort((left, right) => left.pid - right.pid);
  if (processes.length === 0 || processes.length > 4_096) {
    throw new TypeError('build process trace executable census is incomplete');
  }
  return {
    classifier: BUILD_PROFILE_PROCESS_ROLE_CLASSIFIER,
    forkOnlyProcesses: [...processChildren].filter((pid) => !finalExecByPid.has(pid)).length,
    processes,
    schema: BUILD_PROFILE_PROCESS_CENSUS_SCHEMA,
  };
}

export function deriveBuildProcessCpuEvidence({ processCensus, processCpuBytes, profileInputs }) {
  if (!Buffer.isBuffer(processCpuBytes) || processCpuBytes.length > 4_096) {
    throw new TypeError('build recursive CPU report has an invalid size');
  }
  const match =
    /^kovo-build-process-cpu\/v1 interval=(\d+) user=(\d+\.\d{1,6}) system=(\d+\.\d{1,6}) exit=(\d+)\n?$/u.exec(
      processCpuBytes.toString('utf8'),
    );
  if (!match || Number(match[1]) !== BUILD_PROFILE_SAMPLING_INTERVAL_US || match[4] !== '0') {
    throw new TypeError('build recursive CPU report is malformed');
  }
  const user = decimalSecondsEvidence(match[2]);
  const system = decimalSecondsEvidence(match[3]);
  const userMicros = user.micros;
  const systemMicros = system.micros;
  const totalMicros = userMicros + systemMicros;
  if (!Number.isSafeInteger(totalMicros) || totalMicros < 1) {
    throw new TypeError('build recursive CPU total is unavailable');
  }
  const activeV8Samples = profileInputs.reduce((sum, entry) => sum + entry.facts.activeSamples, 0);
  const idleV8Samples = profileInputs.reduce((sum, entry) => sum + entry.facts.idleSamples, 0);
  const waitV8Samples = profileInputs.reduce((sum, entry) => sum + entry.facts.waitSamples, 0);
  const profiledActiveMicros = activeV8Samples * BUILD_PROFILE_SAMPLING_INTERVAL_US;
  if (totalMicros < profiledActiveMicros) {
    throw new TypeError('build V8 sample CPU exceeds recursive CPU');
  }
  const residualMicros = totalMicros - profiledActiveMicros;
  const uncertaintyMicros =
    user.resolutionMicros +
    system.resolutionMicros +
    2 * profileInputs.length * BUILD_PROFILE_SAMPLING_INTERVAL_US;
  if (residualMicros > 0 && residualMicros <= uncertaintyMicros) {
    throw new TypeError(
      'build native-or-unprofiled CPU residual is within measurement uncertainty',
    );
  }
  const residualEquivalentSamples =
    residualMicros === 0
      ? 0
      : Math.floor((residualMicros - uncertaintyMicros) / BUILD_PROFILE_SAMPLING_INTERVAL_US);
  if (!Number.isSafeInteger(residualEquivalentSamples) || residualEquivalentSamples < 0) {
    throw new TypeError('build native-or-unprofiled CPU residual is not conservatively measurable');
  }
  if (
    processCensus?.processes?.some(({ role }) => role === 'native-one-shot') &&
    residualEquivalentSamples === 0
  ) {
    throw new TypeError('build native descendant has no conservatively measurable CPU residual');
  }
  return {
    cause: {
      cause: 'native-or-unprofiled',
      equivalentSamples: residualEquivalentSamples,
      sessionEligibility: 'one-shot-or-ineligible',
    },
    collector: {
      recursive: true,
      tool: TIME_PATH,
    },
    complete: true,
    fixedProfilerIntervalMicros: BUILD_PROFILE_SAMPLING_INTERVAL_US,
    idleV8Samples,
    profiledActiveMicros,
    profiledActiveV8Samples: activeV8Samples,
    residualMicros,
    schema: BUILD_PROFILE_PROCESS_CPU_SCHEMA,
    systemMicros,
    totalMicros,
    uncertainty: {
      policy: 'gnu-time-resolution-plus-two-profiler-intervals-per-process/v1',
      systemResolutionMicros: system.resolutionMicros,
      totalMicros: uncertaintyMicros,
      userResolutionMicros: user.resolutionMicros,
    },
    userMicros,
    waitV8Samples,
  };
}

async function authenticateBuildProcessCensus({ profileInputs, report, sanitizedTrace }) {
  const profileByPid = new Map(profileInputs.map((entry) => [entry.pid, entry]));
  if (profileByPid.size !== profileInputs.length) {
    throw new TypeError('build CPU profile PID census is duplicated');
  }
  const executableCache = new Map();
  const nodeRealPath = await realpath(process.execPath);
  const processes = [];
  const authenticatedProfiles = [];
  for (const processEntry of sanitizedTrace.processes) {
    const executable = await executableIdentity(processEntry.executable, executableCache);
    let entry = null;
    const role = processEntry.role;
    if (nodeProcessRole(role)) {
      if (executable.realPath !== nodeRealPath) {
        throw new TypeError('authenticated build Node role did not execute the pinned Node binary');
      }
      const profile = profileByPid.get(processEntry.pid);
      if (profile === undefined) {
        throw new TypeError('a Node build descendant omitted its raw CPU profile');
      }
      entry = await executableIdentity(processEntry.entryPath, executableCache);
      requireRoleEntryIdentity(role, entry.realPath);
      authenticatedProfiles.push({ ...profile, role });
    } else if (role === 'collector-time' && executable.realPath === (await realpath(TIME_PATH))) {
      if (profileByPid.has(processEntry.pid)) {
        throw new TypeError('recursive CPU collector unexpectedly emitted a Node profile');
      }
    } else if (role === 'native-one-shot' && executable.realPath !== nodeRealPath) {
      if (profileByPid.has(processEntry.pid)) {
        throw new TypeError('native build descendant unexpectedly emitted a Node profile');
      }
    } else {
      throw new TypeError('build process tree contains an unauthenticated executable role');
    }
    processes.push({
      entry,
      executable,
      parentPid: processEntry.parentPid,
      pid: processEntry.pid,
      role,
      roleEvidence: processEntry.roleEvidence,
    });
  }
  const observedPids = new Set(processes.map(({ pid }) => pid));
  for (const pid of profileByPid.keys()) {
    if (!observedPids.has(pid)) {
      throw new TypeError('raw CPU profile PID is absent from the complete process trace');
    }
  }
  requireExactProfileRoles(authenticatedProfiles, report);
  if (!processes.some(({ role }) => role === 'collector-time')) {
    throw new TypeError('recursive CPU collector process is absent from the process trace');
  }
  const roots = processes.filter(
    ({ parentPid }) => parentPid === null || !observedPids.has(parentPid),
  );
  if (roots.length !== 1 || roots[0].role !== 'collector-time') {
    throw new TypeError('build process trace does not have one recursive CPU collector root');
  }
  return {
    processCensus: {
      classifier: BUILD_PROFILE_PROCESS_ROLE_CLASSIFIER,
      complete: true,
      forkOnlyProcesses: sanitizedTrace.forkOnlyProcesses,
      processes,
      schema: BUILD_PROFILE_PROCESS_CENSUS_SCHEMA,
      tools: {
        env: await executableIdentity(ENV_PATH, executableCache),
        node: await executableIdentity(process.execPath, executableCache),
        strace: await executableIdentity(STRACE_PATH, executableCache),
        time: await executableIdentity(TIME_PATH, executableCache),
      },
    },
    profileInputs: authenticatedProfiles.sort((left, right) => left.pid - right.pid),
  };
}

function requireExactProfileRoles(profileInputs, report) {
  const sourcePhases = new Map(
    (report?.samples?.[0]?.phaseCensus?.source?.phases ?? []).map((phase) => [
      phase.name,
      phase.status,
    ]),
  );
  const expected = [
    'bootstrap',
    'orchestrator',
    'analyze',
    'app-static-trust',
    'client',
    'server',
    'final',
  ];
  if (sourcePhases.get('typescript') === 'executed') expected.push('typescript');
  if (sourcePhases.get('config-trust') === 'executed') expected.push('config-static-trust');
  const actual = profileInputs
    .map(({ role }) => role)
    .sort((left, right) => left.localeCompare(right));
  expected.sort((left, right) => left.localeCompare(right));
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new TypeError('build raw CPU profile process-role census is incomplete');
  }
}

function requireProfiledCaptureConsistency(capture) {
  if (
    !ownRecord(capture) ||
    !Array.isArray(capture.profileInputs) ||
    capture.profileInputs.length < 1 ||
    !Buffer.isBuffer(capture.processCpuBytes)
  ) {
    throw new TypeError('profiled build process capture is incomplete');
  }

  const profilePids = new Set();
  for (const [index, profile] of capture.profileInputs.entries()) {
    if (
      !ownRecord(profile) ||
      !Number.isSafeInteger(profile.pid) ||
      profile.pid < 1 ||
      profilePids.has(profile.pid) ||
      typeof profile.role !== 'string'
    ) {
      throw new TypeError('profiled build process profile custody is malformed or duplicated');
    }
    profilePids.add(profile.pid);
    const facts = validateRawProcessProfile(parseRawProfile(profile.bytes), index);
    if (canonicalJson(facts) !== canonicalJson(profile.facts)) {
      throw new TypeError('profiled build process profile census differs from its raw bytes');
    }
  }
  requireExactProfileRoles(capture.profileInputs, capture.report);

  const processCensus = capture.processCensus;
  const processes = processCensus?.processes;
  const tools = processCensus?.tools;
  if (
    processCensus?.schema !== BUILD_PROFILE_PROCESS_CENSUS_SCHEMA ||
    processCensus?.classifier !== BUILD_PROFILE_PROCESS_ROLE_CLASSIFIER ||
    processCensus?.complete !== true ||
    !Number.isSafeInteger(processCensus?.forkOnlyProcesses) ||
    processCensus.forkOnlyProcesses < 0 ||
    !Array.isArray(processes) ||
    !ownRecord(tools) ||
    canonicalJson(Object.keys(tools).sort((left, right) => left.localeCompare(right))) !==
      canonicalJson(['env', 'node', 'strace', 'time']) ||
    Object.values(tools).some((identity) => !completeExecutableIdentity(identity))
  ) {
    throw new TypeError('profiled build process census is incomplete');
  }

  const processPids = new Set();
  const profileKeys = capture.profileInputs
    .map(({ pid, role }) => `${String(pid)}:${role}`)
    .sort((left, right) => left.localeCompare(right));
  const processKeys = [];
  for (const processEntry of processes) {
    if (
      !ownRecord(processEntry) ||
      !Number.isSafeInteger(processEntry.pid) ||
      processEntry.pid < 1 ||
      processPids.has(processEntry.pid) ||
      !(processEntry.parentPid === null || Number.isSafeInteger(processEntry.parentPid)) ||
      typeof processEntry.roleEvidence !== 'string' ||
      processEntry.roleEvidence.length === 0 ||
      !completeExecutableIdentity(processEntry.executable)
    ) {
      throw new TypeError('profiled build process PID census is malformed or duplicated');
    }
    processPids.add(processEntry.pid);
    if (nodeProcessRole(processEntry.role)) {
      if (
        !completeExecutableIdentity(processEntry.entry) ||
        !sameExecutableIdentity(processEntry.executable, tools.node)
      ) {
        throw new TypeError('profiled build Node process identity is inconsistent');
      }
      processKeys.push(`${String(processEntry.pid)}:${processEntry.role}`);
    } else if (processEntry.role === 'collector-time') {
      if (!sameExecutableIdentity(processEntry.executable, tools.time)) {
        throw new TypeError('profiled build CPU collector identity is inconsistent');
      }
    } else if (processEntry.role !== 'native-one-shot') {
      throw new TypeError('profiled build process role census contains an unsupported role');
    }
  }
  processKeys.sort((left, right) => left.localeCompare(right));
  if (canonicalJson(processKeys) !== canonicalJson(profileKeys)) {
    throw new TypeError('profiled build process census differs from its raw profile custody');
  }
  if (processes.filter(({ role }) => role === 'collector-time').length !== 1) {
    throw new TypeError('profiled build process census lacks one recursive CPU collector');
  }
  for (const processEntry of processes) {
    if (
      processEntry.parentPid !== null &&
      (processEntry.parentPid === processEntry.pid || !processPids.has(processEntry.parentPid))
    ) {
      throw new TypeError('profiled build process parent census is malformed');
    }
    const visited = new Set();
    let current = processEntry;
    while (current.parentPid !== null) {
      if (visited.has(current.pid)) {
        throw new TypeError('profiled build process parent census is cyclic');
      }
      visited.add(current.pid);
      current = processes.find(({ pid }) => pid === current.parentPid);
    }
    if (current.role !== 'collector-time') {
      throw new TypeError('profiled build process is outside the recursive CPU collector tree');
    }
  }

  const derivedProcessCpu = deriveBuildProcessCpuEvidence({
    processCensus,
    processCpuBytes: capture.processCpuBytes,
    profileInputs: capture.profileInputs,
  });
  if (canonicalJson(derivedProcessCpu) !== canonicalJson(capture.processCpu)) {
    throw new TypeError('profiled build recursive CPU evidence differs from its raw inputs');
  }
}

function completeExecutableIdentity(value) {
  return (
    ownRecord(value) &&
    typeof value.path === 'string' &&
    value.path.length > 0 &&
    typeof value.realPath === 'string' &&
    value.realPath.length > 0 &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes > 0 &&
    /^sha256:[0-9a-f]{64}$/u.test(value.sha256 ?? '')
  );
}

function sameExecutableIdentity(left, right) {
  return (
    completeExecutableIdentity(left) &&
    completeExecutableIdentity(right) &&
    left.realPath === right.realPath &&
    left.bytes === right.bytes &&
    left.sha256 === right.sha256
  );
}

function profiledConfigTrustExecuted(report) {
  const samples = report?.samples;
  if (!Array.isArray(samples) || samples.length !== 1) {
    throw new TypeError('profiled build phase census is unavailable');
  }
  const phases = samples[0]?.phaseCensus?.source?.phases;
  if (!Array.isArray(phases))
    throw new TypeError('profiled build source phase census is unavailable');
  const config = phases.filter(({ name }) => name === 'config-trust');
  if (
    config.length !== 1 ||
    (config[0].status !== 'executed' && config[0].status !== 'not-applicable')
  ) {
    throw new TypeError('profiled build config-trust phase posture is unavailable');
  }
  return config[0].status === 'executed';
}

function parseSuccessfulExecve(event, cwd) {
  if (!event.startsWith('execve(') || !/\)\s+=\s+0$/u.test(event)) return null;
  let cursor = 'execve('.length;
  const executableString = readStraceString(event, cursor);
  cursor = executableString.next;
  if (!event.startsWith(', [', cursor)) {
    throw new TypeError('malformed build process trace exec arguments');
  }
  cursor += 3;
  const argv = [];
  let argvBytes = 0;
  while (cursor < event.length) {
    while (event[cursor] === ' ') cursor += 1;
    if (event[cursor] === ']') break;
    if (argv.length >= 64 || event.startsWith('...', cursor)) {
      throw new TypeError('build process trace exec arguments exceed their bound');
    }
    const argument = readStraceString(event, cursor);
    argvBytes += Buffer.byteLength(argument.value);
    if (argvBytes > 64 * 1024) {
      throw new TypeError('build process trace exec arguments exceed their byte bound');
    }
    argv.push(argument.value);
    cursor = argument.next;
    while (event[cursor] === ' ') cursor += 1;
    if (event[cursor] === ',') cursor += 1;
    else if (event[cursor] !== ']') {
      throw new TypeError('malformed build process trace exec argument separator');
    }
  }
  if (event[cursor] !== ']') throw new TypeError('malformed build process trace exec arguments');
  const executable = path.isAbsolute(executableString.value)
    ? executableString.value
    : path.resolve(cwd, executableString.value);
  if (!SAFE_EXECUTABLE_PATTERN.test(executable)) {
    throw new TypeError('malformed build process trace executable');
  }
  const classified = classifyBuildExec({ argv, cwd, executable });
  // `argv` can contain static-trust authentication material. Only the finite non-secret result
  // escapes this stack frame; callers delete the raw trace immediately after this pass.
  return { executable, ...classified };
}

function readStraceString(source, start) {
  if (source[start] !== '"') throw new TypeError('malformed build process trace string');
  let value = '';
  let cursor = start + 1;
  while (cursor < source.length) {
    const character = source[cursor];
    if (character === '"') return { next: cursor + 1, value };
    if (character !== '\\') {
      value += character;
      cursor += 1;
      continue;
    }
    const escaped = source[cursor + 1];
    const decoded = { '"': '"', '\\': '\\', n: '\n', r: '\r', t: '\t' }[escaped];
    if (decoded === undefined) {
      throw new TypeError('build process trace contains an unsupported string escape');
    }
    value += decoded;
    cursor += 2;
  }
  throw new TypeError('unterminated build process trace string');
}

function classifyBuildExec({ argv, cwd, executable }) {
  if (executable === TIME_PATH) {
    return { entryPath: null, role: 'collector-time', roleEvidence: 'gnu-time-exec/v1' };
  }
  if (/\/(?:@esbuild\/[^/]+|esbuild)\/bin\/esbuild$/u.test(executable)) {
    return { entryPath: null, role: 'native-one-shot', roleEvidence: 'esbuild-exec/v1' };
  }
  const matches = [];
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    const normalized = value.replaceAll('\\', '/');
    let role = null;
    let evidence = null;
    if (/\/(?:packages\/cli\/src|node_modules\/@kovojs\/cli\/src)\/bin\.ts$/u.test(normalized)) {
      role = argv.slice(1, index).includes('--experimental-transform-types')
        ? 'orchestrator'
        : 'bootstrap';
      evidence = `${role}-source-bin-exec/v1`;
    } else if (
      /\/(?:packages\/cli\/dist|node_modules\/@kovojs\/cli\/dist)\/bin\.mjs$/u.test(normalized)
    ) {
      role = 'orchestrator';
      evidence = 'orchestrator-packed-bin-exec/v1';
    } else {
      const worker = /\/build-one-shot-(analyze|client|server|final)-worker\.(?:ts|mjs)$/u.exec(
        normalized,
      )?.[1];
      if (worker !== undefined) {
        role = worker;
        evidence = `${worker}-worker-entry-exec/v1`;
      } else if (/\/build-static-trust-worker\.(?:ts|mjs)$/u.test(normalized)) {
        const request = argv[index + 1];
        const kinds =
          typeof request === 'string'
            ? [...request.matchAll(/(?<!\\)"kind":"(app|config)"/gu)].map((match) => match[1])
            : [];
        if (kinds.length !== 1) {
          throw new TypeError('static-trust exec omitted its exact non-secret role kind');
        }
        role = `${kinds[0]}-static-trust`;
        evidence = `${role}-worker-entry-exec/v1`;
      } else if (normalized.endsWith('/node_modules/typescript/bin/tsc')) {
        role = 'typescript';
        evidence = 'typescript-cli-entry-exec/v1';
      }
    }
    if (role !== null) {
      matches.push({
        entryPath: path.resolve(cwd, value),
        role,
        roleEvidence: evidence,
      });
    }
  }
  if (matches.length > 1) throw new TypeError('build process exec has ambiguous role entries');
  return (
    matches[0] ?? {
      entryPath: null,
      role: 'native-one-shot',
      roleEvidence: 'native-unprofiled-exec/v1',
    }
  );
}

function parseTraceCloneEvent(event, pending) {
  const unfinished = /^(clone3?|fork|vfork)\((.*)<unfinished \.\.\.>$/u.exec(event);
  if (unfinished) {
    if (pending !== undefined) {
      throw new TypeError('build process trace overlaps process creation events');
    }
    return {
      pending: {
        syscall: unfinished[1],
        thread: unfinished[2].includes('CLONE_THREAD'),
      },
    };
  }
  const resumed = /^<\.\.\. (clone3?|fork|vfork) resumed>(.*)\s+=\s+(\d+)$/u.exec(event);
  if (resumed) {
    if (pending === undefined || pending.syscall !== resumed[1]) {
      throw new TypeError('build process trace resumes an unknown process creation event');
    }
    return {
      resolved: {
        childPid: positiveTracePid(resumed[3]),
        thread: pending.thread || resumed[2].includes('CLONE_THREAD'),
      },
    };
  }
  const complete = /^(clone3?|fork|vfork)\((.*)\)\s+=\s+(\d+)$/u.exec(event);
  if (complete) {
    return {
      resolved: {
        childPid: positiveTracePid(complete[3]),
        thread: complete[2].includes('CLONE_THREAD'),
      },
    };
  }
  return {};
}

function positiveTracePid(value) {
  const pid = Number(value);
  if (!Number.isSafeInteger(pid) || pid < 1) {
    throw new TypeError('malformed build process trace child PID');
  }
  return pid;
}

function nodeProcessRole(role) {
  return [
    'bootstrap',
    'orchestrator',
    'analyze',
    'typescript',
    'config-static-trust',
    'app-static-trust',
    'client',
    'server',
    'final',
  ].includes(role);
}

function requireRoleEntryIdentity(role, realPath) {
  const normalized = realPath.replaceAll('\\', '/');
  const patterns = {
    bootstrap: /\/(?:packages\/cli\/src|node_modules\/@kovojs\/cli\/src)\/bin\.ts$/u,
    orchestrator:
      /\/(?:packages\/cli|node_modules\/@kovojs\/cli)\/(?:src\/bin\.ts|dist\/bin\.mjs)$/u,
    analyze: /\/build-one-shot-analyze-worker\.(?:ts|mjs)$/u,
    typescript: /\/node_modules\/typescript\/bin\/tsc$/u,
    'config-static-trust': /\/build-static-trust-worker\.(?:ts|mjs)$/u,
    'app-static-trust': /\/build-static-trust-worker\.(?:ts|mjs)$/u,
    client: /\/build-one-shot-client-worker\.(?:ts|mjs)$/u,
    server: /\/build-one-shot-server-worker\.(?:ts|mjs)$/u,
    final: /\/build-one-shot-final-worker\.(?:ts|mjs)$/u,
  };
  if (!patterns[role]?.test(normalized) || !realPath.startsWith(`${repoRoot}${path.sep}`)) {
    throw new TypeError('build process role entry is not an authenticated framework source');
  }
}

function parseCpuProfileName(name) {
  const match = CPU_PROFILE_NAME_PATTERN.exec(name);
  if (!match) throw new TypeError('Node CPU profile filename has an unexpected shape');
  const pid = Number(match[1]);
  const threadId = Number(match[2]);
  const sequence = Number(match[3]);
  if (
    !Number.isSafeInteger(pid) ||
    pid < 1 ||
    threadId !== 0 ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1
  ) {
    throw new TypeError('Node CPU profile filename identity is unavailable');
  }
  return { pid, sequence, threadId };
}

function parseRawProfile(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > MAX_INPUT_PROFILE_BYTES) {
    throw new TypeError('raw process CPU profile has an invalid byte size');
  }
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new TypeError('raw process CPU profile is not JSON');
  }
}

async function executableIdentity(filePath, cache) {
  if (!SAFE_EXECUTABLE_PATTERN.test(filePath)) {
    throw new TypeError('build process executable path is malformed');
  }
  const realPath = await realpath(filePath);
  const cached = cache.get(realPath);
  if (cached !== undefined) return cached;
  const metadata = await stat(realPath);
  if (!metadata.isFile() || metadata.size < 1 || !Number.isSafeInteger(metadata.size)) {
    throw new TypeError('build process executable identity is unavailable');
  }
  const identity = {
    bytes: metadata.size,
    path: filePath,
    realPath,
    sha256: sha256(await readFile(realPath)),
  };
  cache.set(realPath, identity);
  return identity;
}

async function requireExecutable(filePath, label) {
  let metadata;
  try {
    metadata = await stat(filePath);
  } catch {
    throw new TypeError(`${label} is unavailable on this profile host`);
  }
  if (!metadata.isFile() || (metadata.mode & 0o111) === 0) {
    throw new TypeError(`${label} is unavailable on this profile host`);
  }
}

function decimalSecondsEvidence(value) {
  const match = /^(\d+)\.(\d{1,6})$/u.exec(value);
  if (!match) throw new TypeError('build recursive CPU seconds are malformed');
  const whole = BigInt(match[1]);
  const fractionText = match[2];
  const fraction = BigInt(fractionText.padEnd(6, '0'));
  const micros = whole * 1_000_000n + fraction;
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError('build recursive CPU seconds exceed their bound');
  }
  return {
    micros: Number(micros),
    resolutionMicros: 10 ** (6 - fractionText.length),
  };
}

async function readBuildManifest(manifestPath) {
  const bytes = await readFile(manifestPath);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new TypeError('N=216 Kovo corpus manifest is not JSON');
  }
  if (
    value?.schema !== 'kovo-dev-corpus/v1' ||
    value.framework !== 'kovo' ||
    value.modules !== BUILD_PROFILE_CORPUS_SIZE ||
    !ownRecord(value.build) ||
    !ownRecord(value.build.command) ||
    !Array.isArray(value.build.command.argv) ||
    value.build.command.argv.some((entry) => typeof entry !== 'string' || entry.length === 0) ||
    typeof value.build.command.cwd !== 'string' ||
    !ownRecord(value.build.command.env) ||
    !ownRecord(value.build.edit) ||
    !/^[0-9a-f]{64}$/u.test(value.shapeDigest ?? '') ||
    !/^sha256:[0-9a-f]{64}$/u.test(value.sourceDigest ?? '')
  ) {
    throw new TypeError('N=216 Kovo corpus manifest is malformed');
  }
  const absoluteRoot = path.dirname(manifestPath);
  const relativePath = path.relative(repoRoot, manifestPath).split(path.sep).join('/');
  if (relativePath.startsWith('../') || path.isAbsolute(relativePath)) {
    throw new TypeError('N=216 Kovo corpus manifest is outside the repository');
  }
  return {
    absoluteRoot,
    build: value.build,
    bytes: bytes.length,
    relativePath,
    sha256: sha256(bytes),
    value,
  };
}

function buildBenchmarkFindings(
  report,
  { expectedCommand, expectedIterations, expectedMode, expectedSource },
) {
  const findings = [];
  if (report?.schema !== BUILD_BENCHMARK_SCHEMA) findings.push('adapter schema differs');
  if (report?.framework !== 'kovo') findings.push('adapter framework is not Kovo');
  if (report?.mode !== expectedMode) findings.push('adapter mode differs');
  if (
    report?.integrity?.complete !== true ||
    report.integrity.iterations !== expectedIterations ||
    report.integrity.warmups !== 0 ||
    report.integrity.misses !== 0 ||
    canonicalJson(report.integrity.errors) !== canonicalJson([])
  ) {
    findings.push('adapter integrity census is incomplete');
  }
  if (
    canonicalJson(report?.integrity?.command) !==
    canonicalJson({ argv: expectedCommand.argv, cwd: expectedCommand.cwd })
  ) {
    findings.push('adapter command differs from the manifest-owned invocation');
  }
  if (
    !sameSourceState(report?.source, expectedSource) ||
    !sameSourceState(report?.sourceAfter, expectedSource) ||
    report?.integrity?.source?.stable !== true
  ) {
    findings.push('adapter source identity is not clean and stable');
  }
  if (
    report?.corpus?.modules !== BUILD_PROFILE_CORPUS_SIZE ||
    report?.integrity?.corpus?.stable !== true
  ) {
    findings.push('adapter N=216 corpus identity is incomplete or unstable');
  }
  if (!Array.isArray(report?.samples) || report.samples.length !== expectedIterations) {
    findings.push('adapter sample census is incomplete');
  } else if (
    report.samples.some(
      (sample) =>
        sample?.exitCode !== 0 ||
        sample?.outputCensus?.complete !== true ||
        sample?.corpus?.stable !== true ||
        sample?.phaseAttribution?.complete !== true,
    )
  ) {
    findings.push('adapter sample proof is incomplete');
  }
  return findings;
}

function requireBuildWorkloadIdentity(workload) {
  if (
    workload?.complete !== true ||
    workload.schema !== 'kovo-performance-workload-identity/v1' ||
    !/^sha256:[0-9a-f]{64}$/u.test(workload.digest ?? '') ||
    workload.digest !== sha256(Buffer.from(canonicalJson(workload.identity))) ||
    canonicalJson(workload.identity?.cells) !== canonicalJson(['build']) ||
    canonicalJson(workload.identity?.lanes) !== canonicalJson(['corpus-n216']) ||
    workload.identity?.policies?.corpusSize !== BUILD_PROFILE_CORPUS_SIZE ||
    workload.identity?.policies?.buildSamples !== BUILD_PROFILE_BUILD_SAMPLES ||
    workload.identity?.policies?.warmups !== BUILD_PROFILE_WARMUPS ||
    canonicalJson(workload.identity?.policies?.buildModes) !==
      canonicalJson(['clean', 'unchanged', 'edit'])
  ) {
    throw new TypeError('build profile workload differs from the publishable N=216 build matrix');
  }
}

function requireCleanSource(source, label) {
  if (
    !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(source?.commit ?? '') ||
    source?.dirty !== false ||
    canonicalJson(source?.dirtyPaths) !== canonicalJson([])
  ) {
    throw new TypeError(`${label} is not a clean committed revision`);
  }
  for (const lock of REQUIRED_LOCKS) {
    if (!/^sha256:[0-9a-f]{64}$/u.test(source?.locks?.[lock] ?? '')) {
      throw new TypeError(`${label} ${lock} identity is unavailable`);
    }
  }
}

function validateRawProcessProfile(profile, index) {
  if (
    !ownRecord(profile) ||
    !Array.isArray(profile.nodes) ||
    profile.nodes.length === 0 ||
    !Array.isArray(profile.samples) ||
    profile.samples.length === 0 ||
    !Array.isArray(profile.timeDeltas) ||
    profile.timeDeltas.length !== profile.samples.length
  ) {
    throw new TypeError(`process CPU profile ${String(index + 1)} has an invalid V8 census`);
  }
  const ids = new Set();
  const nodesById = new Map();
  for (const node of profile.nodes) {
    if (
      !ownRecord(node) ||
      !Number.isSafeInteger(node.id) ||
      node.id < 1 ||
      ids.has(node.id) ||
      !ownRecord(node.callFrame) ||
      typeof node.callFrame.functionName !== 'string' ||
      typeof node.callFrame.url !== 'string' ||
      (node.children !== undefined && !Array.isArray(node.children))
    ) {
      throw new TypeError(`process CPU profile ${String(index + 1)} has a malformed node`);
    }
    ids.add(node.id);
    nodesById.set(node.id, node);
  }
  const parentById = new Map();
  for (const node of profile.nodes) {
    for (const child of node.children ?? []) {
      if (!Number.isSafeInteger(child) || !ids.has(child) || parentById.has(child)) {
        throw new TypeError(`process CPU profile ${String(index + 1)} has an invalid parent graph`);
      }
      parentById.set(child, node.id);
    }
  }
  if (profile.samples.some((sample) => !Number.isSafeInteger(sample) || !ids.has(sample))) {
    throw new TypeError(`process CPU profile ${String(index + 1)} has an invalid sample reference`);
  }
  if (
    profile.timeDeltas.some((delta) => !Number.isSafeInteger(delta)) ||
    !Number.isFinite(profile.startTime) ||
    !Number.isFinite(profile.endTime) ||
    profile.endTime < profile.startTime
  ) {
    throw new TypeError(`process CPU profile ${String(index + 1)} has an invalid clock`);
  }
  let idleSamples = 0;
  let waitSamples = 0;
  for (const sample of profile.samples) {
    const frame = nodesById.get(sample).callFrame;
    if (frame.functionName === '(idle)' && frame.url === '') idleSamples += 1;
    else if (exactRawProfileWaitSample(sample, nodesById, parentById)) waitSamples += 1;
  }
  return {
    activeSamples: profile.samples.length - idleSamples - waitSamples,
    idleSamples,
    negativeTimeDeltas: profile.timeDeltas.filter((delta) => delta < 0).length,
    nodes: profile.nodes.length,
    samples: profile.samples.length,
    waitSamples,
  };
}

function exactRawProfileWaitSample(sampleId, nodesById, parentById) {
  const visited = new Set();
  let nodeId = sampleId;
  while (nodeId !== undefined) {
    if (visited.has(nodeId)) throw new TypeError('process CPU profile parent graph is cyclic');
    visited.add(nodeId);
    const frame = nodesById.get(nodeId)?.callFrame;
    if (frame?.functionName === 'spawnSync' && frame.url === 'node:internal/child_process') {
      return true;
    }
    nodeId = parentById.get(nodeId);
  }
  return false;
}

async function writeProfileArtifact(outDir, outputs) {
  if (outputs.length !== BUILD_PROFILE_MODES.length) {
    throw new TypeError('build profile output census must contain unchanged and edit');
  }
  try {
    const metadata = await lstat(outDir);
    if (metadata.isSymbolicLink()) throw new TypeError('build profile output cannot be a symlink');
    throw new TypeError('build profile output directory already exists');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const parent = path.dirname(outDir);
  await mkdir(parent, { recursive: true });
  const stage = await mkdtemp(path.join(parent, `.${path.basename(outDir)}-stage-`));
  try {
    for (const { mode, processCpuBytes, profileBytes, rawProfiles, report } of outputs) {
      await writeFile(path.join(stage, `build-${mode}.cpuprofile`), profileBytes, { flag: 'wx' });
      await writeFile(path.join(stage, `process-cpu-${mode}.txt`), processCpuBytes, {
        flag: 'wx',
      });
      for (const profile of rawProfiles) {
        await writeFile(path.join(stage, profile.member), profile.bytes, { flag: 'wx' });
      }
      await writeFile(
        path.join(stage, `profile-${mode}.json`),
        `${JSON.stringify(report, null, 2)}\n`,
        {
          flag: 'wx',
        },
      );
      const readback = await readFile(path.join(stage, `build-${mode}.cpuprofile`));
      if (
        readback.length !== report.profileArtifact.bytes ||
        sha256(readback) !== report.profileArtifact.sha256
      ) {
        throw new TypeError(`${mode} raw profile readback differs from its report identity`);
      }
      const cpuReadback = await readFile(path.join(stage, report.processCpuArtifact.fileName));
      if (
        cpuReadback.length !== report.processCpuArtifact.bytes ||
        sha256(cpuReadback) !== report.processCpuArtifact.sha256
      ) {
        throw new TypeError(`${mode} process CPU readback differs from its report identity`);
      }
      for (const identity of report.profileArtifacts) {
        const original = await readFile(path.join(stage, identity.member));
        if (original.length !== identity.bytes || sha256(original) !== identity.sha256) {
          throw new TypeError(`${mode} original process profile differs from its report identity`);
        }
      }
    }
    const members = (await readdir(stage)).sort((left, right) => left.localeCompare(right));
    const expected = outputs
      .flatMap(({ report }) => report.artifactMembers)
      .sort((left, right) => left.localeCompare(right));
    if (canonicalJson(members) !== canonicalJson(expected)) {
      throw new TypeError('build profile artifact member census differs');
    }
    await rename(stage, outDir);
  } catch (error) {
    await rm(stage, { force: true, recursive: true });
    throw error;
  }
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} is required`);
  return value;
}

function ownRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await produceBuildSessionProfiles(parseBuildProfileArgs(process.argv.slice(2)));
    process.stdout.write(
      `${BUILD_PROFILE_ARTIFACT_NAME} written to ${result.outDir} (${result.files.join(', ')})\n`,
    );
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exitCode = 1;
  }
}
