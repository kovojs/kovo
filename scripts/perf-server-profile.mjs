#!/usr/bin/env node
/**
 * Diagnostic-only forced-dynamic SSR CPU profile for plans/good-perf.md Phase 3.
 *
 * The existing server adapter owns production build/start, matched route/status/header/body checks,
 * node:http keep-alive load, process serialization, and source provenance. This wrapper only swaps
 * the generated server's Node entry for an Inspector launcher that can flush a raw CPU profile on
 * SIGTERM. Profiler-perturbed latency/throughput is deliberately omitted from the report.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { readArg, readIntegerArg } from '../benchmarks/harness/args.mjs';
import { canonicalJson, performanceHostFingerprint } from './lib/perf-host.mjs';
import {
  runServerBenchmark,
  SERVER_BENCHMARK_SCHEMA,
  SERVER_PREPARE_SCHEMA,
} from './perf-server-benchmark.mjs';

export const SERVER_PROFILE_REPORT_SCHEMA = 'kovo-forced-dynamic-ssr-profile/v1';
export const SERVER_PROFILE_WORKLOAD_SCHEMA = 'kovo-forced-dynamic-ssr-profile-workload/v1';
export const SERVER_PROFILE_SAMPLING_INTERVAL_US = 500;

const DEFAULT_DURATION_MS = 15_000;
const DEFAULT_WARMUP_MS = 5_000;
const PROFILE_LAUNCHER = fileURLToPath(
  new URL('./lib/perf-cpu-profile-launcher.mjs', import.meta.url),
);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export const HISTORICAL_SSR_HYPOTHESES = Object.freeze([
  Object.freeze({
    id: 'jsx-lowering',
    label: 'JSX lowering / compiler transforms',
    patterns: Object.freeze([
      /(?:^|\/)packages\/compiler\//iu,
      /\b(?:compileComponentModule|lower[^ ]*jsx|jsx[^ ]*lower|transform[^ ]*jsx)\b/iu,
    ]),
  }),
  Object.freeze({
    id: 'hkdf-hmac',
    label: 'HKDF/HMAC key derivation and signing',
    patterns: Object.freeze([/\b(?:hkdf|hmac|createHmac|derive[^ ]*key)\b/iu]),
  }),
  Object.freeze({
    id: 'request-proxy',
    label: 'request Proxy construction/access',
    patterns: Object.freeze([
      /\b(?:pinnedRequestCarrier(?:OwnData)?|requestProxy|create[^ ]*request[^ ]*proxy|proxy[^ ]*request)\b/iu,
    ]),
  }),
  Object.freeze({
    id: 'head-serialization',
    label: 'per-request head serialization',
    patterns: Object.freeze([
      /\b(?:renderHeadChildren|renderPageHints|serialize[^ ]*head|head[^ ]*serial|render[^ ]*head)\b/iu,
    ]),
  }),
  Object.freeze({
    id: 'csp-rescan',
    label: 'CSP rescanning',
    patterns: Object.freeze([
      /\b(?:rescan[^ ]*csp|csp[^ ]*rescan|scan[^ ]*csp|csp[^ ]*scan|contentSecurityPolicy[^ ]*scan)\b/iu,
      /\bstyleAttributeCspInlineMetadata\b/u,
    ]),
  }),
  Object.freeze({
    historicalClaimPercent: 38,
    id: 'reflect-apply',
    label: 'Reflect.apply-shaped invocation',
    patterns: Object.freeze([
      /\bReflect\.apply\b/u,
      /\bapply\$\d+\b/u,
      /\b(?:securityApply|formHelperApply|witnessReflectApply|invoke\$\d+)\b/u,
    ]),
  }),
]);

export function createProfiledServerSpawner(options, dependencies = {}) {
  const profilePath = path.resolve(requiredString(options.profilePath, 'profilePath'));
  const samplingIntervalMicros = boundedInteger(
    options.samplingIntervalMicros ?? SERVER_PROFILE_SAMPLING_INTERVAL_US,
    100,
    10_000,
    'samplingIntervalMicros',
  );
  const spawnProcess = dependencies.spawnProcess ?? spawn;
  const launcherPath = dependencies.launcherPath ?? PROFILE_LAUNCHER;
  return (command, args, spawnOptions) => {
    if (command !== process.execPath || !Array.isArray(args) || args.length !== 1) {
      throw new TypeError('profile wrapper expected one generated server entry under current Node');
    }
    const entryPath = path.resolve(spawnOptions.cwd, args[0]);
    return spawnProcess(command, [launcherPath, entryPath], {
      ...spawnOptions,
      env: {
        ...spawnOptions.env,
        KOVO_PERF_CPU_PROFILE_INTERVAL_US: String(samplingIntervalMicros),
        KOVO_PERF_CPU_PROFILE_PATH: profilePath,
      },
    });
  };
}

export function analyzeCpuProfile(profile) {
  if (!profile || typeof profile !== 'object') throw new TypeError('CPU profile must be an object');
  if (!Array.isArray(profile.nodes) || profile.nodes.length === 0) {
    throw new TypeError('CPU profile must contain nodes');
  }
  if (!Array.isArray(profile.samples) || profile.samples.length === 0) {
    throw new TypeError('CPU profile must contain samples');
  }
  const nodes = new Map();
  for (const node of profile.nodes) {
    if (!Number.isSafeInteger(node?.id) || !node?.callFrame) {
      throw new TypeError('CPU profile contains an invalid node');
    }
    nodes.set(node.id, node.callFrame);
  }
  const pathSamples = new Map();
  const categorySamples = new Map();
  const hypothesisSamples = new Map(HISTORICAL_SSR_HYPOTHESES.map(({ id }) => [id, 0]));
  let activeSamples = 0;
  let idleSamples = 0;
  let missingNodeSamples = 0;
  for (const nodeId of profile.samples) {
    const frame = nodes.get(nodeId);
    if (!frame) {
      missingNodeSamples += 1;
      continue;
    }
    const normalized = normalizedFrame(frame);
    if (isIdleFrame(normalized)) {
      idleSamples += 1;
      continue;
    }
    activeSamples += 1;
    const key = canonicalJson(normalized);
    const currentPath = pathSamples.get(key);
    pathSamples.set(key, {
      frame: normalized,
      samples: (currentPath?.samples ?? 0) + 1,
    });
    const category = hotPathCategory(normalized);
    categorySamples.set(category, (categorySamples.get(category) ?? 0) + 1);
    const haystack = frameHaystack(normalized);
    for (const hypothesis of HISTORICAL_SSR_HYPOTHESES) {
      if (hypothesis.patterns.some((pattern) => pattern.test(haystack))) {
        hypothesisSamples.set(hypothesis.id, hypothesisSamples.get(hypothesis.id) + 1);
      }
    }
  }
  if (activeSamples === 0) throw new TypeError('CPU profile contains zero active samples');
  const allPaths = [...pathSamples.values()]
    .sort((left, right) => right.samples - left.samples || frameSort(left.frame, right.frame))
    .map((entry, index) => ({
      ...entry.frame,
      rank: index + 1,
      selfPercent: percent(entry.samples, activeSamples),
      selfSamples: entry.samples,
    }));
  const topHotPaths = allPaths.slice(0, 5);
  const topCategories = [...categorySamples]
    .sort(
      ([leftName, left], [rightName, right]) => right - left || leftName.localeCompare(rightName),
    )
    .slice(0, 5)
    .map(([category, samples], index) => ({
      category,
      rank: index + 1,
      selfPercent: percent(samples, activeSamples),
      selfSamples: samples,
    }));
  const hypotheses = HISTORICAL_SSR_HYPOTHESES.map((hypothesis) => {
    const samples = hypothesisSamples.get(hypothesis.id);
    const topFiveRanks = topHotPaths
      .filter((entry) => hypothesis.patterns.some((pattern) => pattern.test(frameHaystack(entry))))
      .map((entry) => entry.rank);
    const observedSelfPercent = percent(samples, activeSamples);
    return {
      ...(hypothesis.historicalClaimPercent === undefined
        ? {}
        : {
            historicalClaimPercent: hypothesis.historicalClaimPercent,
            observedClaimGapPercentagePoints:
              observedSelfPercent - hypothesis.historicalClaimPercent,
          }),
      id: hypothesis.id,
      label: hypothesis.label,
      observedSelfPercent,
      selfSamples: samples,
      ruling:
        topFiveRanks.length === 0
          ? 'refuted-as-current-top-five-hot-path'
          : 'present-in-current-top-five',
      topFiveRanks,
    };
  });
  return {
    census: {
      activeSamples,
      idleSamples,
      missingNodeSamples,
      nodes: profile.nodes.length,
      totalSamples: profile.samples.length,
    },
    hypotheses,
    profileClock: {
      endTime: finiteNumber(profile.endTime, 'profile.endTime'),
      startTime: finiteNumber(profile.startTime, 'profile.startTime'),
    },
    topCategories,
    topHotPaths,
  };
}

export async function runForcedDynamicServerProfile(options, dependencies = {}) {
  const benchmarkRunner = dependencies.benchmarkRunner ?? runServerBenchmark;
  const profilePath = path.resolve(requiredString(options.profileOut, '--profile-out'));
  if (existsSync(profilePath) && options.overwrite !== true) {
    throw new Error(`raw CPU profile already exists: ${profilePath}`);
  }
  await mkdir(path.dirname(profilePath), { recursive: true });
  if (options.overwrite === true) await rm(profilePath, { force: true });
  const route = options.route ?? 'listing';
  if (route !== 'listing' && route !== 'detail')
    throw new TypeError('--route must be listing or detail');
  const port = boundedInteger(options.port ?? 50_330, 1_024, 65_535, '--port');
  const durationMs = boundedInteger(
    options.durationMs ?? DEFAULT_DURATION_MS,
    25,
    60_000,
    '--duration-ms',
  );
  const warmupMs = boundedInteger(options.warmupMs ?? DEFAULT_WARMUP_MS, 25, 60_000, '--warmup-ms');
  const samplingIntervalMicros = boundedInteger(
    options.samplingIntervalMicros ?? SERVER_PROFILE_SAMPLING_INTERVAL_US,
    100,
    10_000,
    'samplingIntervalMicros',
  );
  const benchmarkDependencies = dependencies.benchmarkDependencies ?? {};
  let preparation = null;
  if (options.skipBuild !== true) {
    preparation = await benchmarkRunner(
      {
        allowDirty: options.allowDirty,
        framework: 'kovo',
        port,
        prepareOnly: true,
      },
      benchmarkDependencies,
    );
  }
  const spawnProcess = createProfiledServerSpawner(
    {
      profilePath,
      samplingIntervalMicros,
    },
    dependencies,
  );
  const benchmark = await benchmarkRunner(
    {
      allowDirty: options.allowDirty,
      concurrency: 32,
      durationMs,
      encoding: 'identity',
      framework: 'kovo',
      mode: 'dynamic',
      port,
      route,
      skipBuild: true,
      warmupMs,
    },
    { ...benchmarkDependencies, spawnProcess },
  );
  const rawProfile = await readFile(profilePath);
  const parsedProfile = JSON.parse(rawProfile);
  const analysis = analyzeCpuProfile(parsedProfile);
  const errors = profileIntegrityErrors({
    analysis,
    benchmark,
    preparation,
    skipBuild: options.skipBuild,
  });
  const sourceStable = sameSourceState(benchmark.source, benchmark.sourceAfter);
  if (!sourceStable) errors.push('source provenance changed during profile');
  const sourceClean = benchmark.source?.dirty === false;
  if (!sourceClean && options.allowDirty !== true) errors.push('source provenance is dirty');
  const workloadFacts = {
    benchmarkSchema: benchmark.schema,
    buildPreparation:
      options.skipBuild === true
        ? 'reused-existing-production-build'
        : 'prepared-current-production-build',
    condition: benchmark.condition,
    correctnessBodySha256: benchmark.correctness?.bodySha256 ?? null,
    durationMs,
    loadGenerator: 'scripts/perf-server-benchmark.mjs node:http keep-alive',
    profileSamplingIntervalMicros: samplingIntervalMicros,
    profileScope: 'server-import-readiness-warmup-measurement-and-shutdown',
    schema: SERVER_PROFILE_WORKLOAD_SCHEMA,
    warmupMs,
  };
  const complete = errors.length === 0;
  return {
    analysis,
    benchmarkEvidence: {
      condition: benchmark.condition,
      correctness: benchmark.correctness,
      environment: benchmark.environment,
      framework: benchmark.framework,
      integrity: benchmark.integrity,
      schema: benchmark.schema,
    },
    diagnosticOnly: {
      profilerPerturbsRuntime: true,
      publishTimingClaims: false,
      reason:
        'Inspector sampling and launcher shutdown perturb the process; this report ranks CPU self samples only.',
    },
    environment: {
      host: benchmark.environment?.host ?? performanceHostFingerprint(),
    },
    integrity: {
      complete,
      errors: [...new Set(errors)],
      profileFlushedBeforeExit: rawProfile.byteLength > 0,
      sourceClean,
      sourceStable,
    },
    preparation:
      preparation === null
        ? { schema: null, skipped: true }
        : {
            integrity: preparation.integrity,
            schema: preparation.schema,
            skipped: false,
            source: preparation.source,
            sourceAfter: preparation.sourceAfter,
          },
    profileArtifact: {
      bytes: rawProfile.byteLength,
      fileName: path.basename(profilePath),
      sha256: sha256(rawProfile),
    },
    schema: SERVER_PROFILE_REPORT_SCHEMA,
    source: benchmark.source,
    sourceAfter: benchmark.sourceAfter,
    verdict: {
      reasons: [...new Set(errors)],
      status: complete && sourceClean ? 'diagnostic' : 'unproven',
    },
    workload: {
      ...workloadFacts,
      digest: sha256(canonicalJson(workloadFacts)),
    },
  };
}

export function validateServerProfileReport(report) {
  const findings = [];
  if (report?.schema !== SERVER_PROFILE_REPORT_SCHEMA)
    findings.push('schema is not SSR profile v1');
  if (report?.diagnosticOnly?.publishTimingClaims !== false) {
    findings.push('profile report must refuse timing claims');
  }
  if (report?.benchmarkEvidence?.schema !== SERVER_BENCHMARK_SCHEMA) {
    findings.push('matched server benchmark evidence is missing');
  }
  if (report?.benchmarkEvidence?.framework !== 'kovo') {
    findings.push('matched server benchmark is not Kovo');
  }
  if (report?.benchmarkEvidence?.integrity?.complete !== true) {
    findings.push('matched server benchmark integrity is incomplete');
  }
  const condition = report?.benchmarkEvidence?.condition;
  if (
    condition?.mode !== 'dynamic' ||
    condition?.encoding !== 'identity' ||
    condition?.concurrency !== 32 ||
    !['listing', 'detail'].includes(condition?.route) ||
    !String(condition?.path ?? '').startsWith('/matched/')
  ) {
    findings.push('profile workload is not forced-dynamic identity c32');
  }
  const cacheControl = String(
    report?.benchmarkEvidence?.correctness?.cacheControl ?? '',
  ).toLowerCase();
  if (!cacheControl.includes('private') || !cacheControl.includes('no-store')) {
    findings.push('matched forced-dynamic response cache posture is missing');
  }
  if (!isSha256(report?.benchmarkEvidence?.correctness?.bodySha256)) {
    findings.push('matched response body identity is missing');
  }
  if (!isSha256(report?.profileArtifact?.sha256)) {
    findings.push('raw profile digest is missing');
  }
  if (!(Number(report?.profileArtifact?.bytes) > 0)) findings.push('raw profile is empty');
  if (report?.integrity?.profileFlushedBeforeExit !== true) {
    findings.push('raw profile flush is unproven');
  }
  if (!Array.isArray(report?.analysis?.topHotPaths) || report.analysis.topHotPaths.length !== 5) {
    findings.push('top-five hot paths are missing');
  }
  if (
    !Array.isArray(report?.analysis?.topCategories) ||
    report.analysis.topCategories.length === 0
  ) {
    findings.push('hot-path categories are missing');
  }
  const hypothesisIds = report?.analysis?.hypotheses?.map((entry) => entry.id) ?? [];
  if (
    JSON.stringify(hypothesisIds) !==
    JSON.stringify(HISTORICAL_SSR_HYPOTHESES.map((entry) => entry.id))
  ) {
    findings.push('historical hypothesis census is incomplete');
  }
  for (const hypothesis of report?.analysis?.hypotheses ?? []) {
    const expectedRuling =
      Array.isArray(hypothesis.topFiveRanks) && hypothesis.topFiveRanks.length > 0
        ? 'present-in-current-top-five'
        : 'refuted-as-current-top-five-hot-path';
    if (
      !Number.isFinite(hypothesis.observedSelfPercent) ||
      hypothesis.observedSelfPercent < 0 ||
      !Number.isSafeInteger(hypothesis.selfSamples) ||
      hypothesis.selfSamples < 0
    ) {
      findings.push(`historical hypothesis ${String(hypothesis.id)} has invalid observations`);
    }
    if (hypothesis.ruling !== expectedRuling) {
      findings.push(`historical hypothesis ${String(hypothesis.id)} has an invalid ruling`);
    }
  }
  const reflect = report?.analysis?.hypotheses?.find((entry) => entry.id === 'reflect-apply');
  if (reflect?.historicalClaimPercent !== 38)
    findings.push('38% Reflect.apply claim is not tested');
  const workload = report?.workload;
  if (workload && typeof workload === 'object') {
    const { digest, ...facts } = workload;
    if (digest !== sha256(canonicalJson(facts))) findings.push('workload digest is invalid');
    if (
      workload.benchmarkSchema !== report?.benchmarkEvidence?.schema ||
      workload.correctnessBodySha256 !== report?.benchmarkEvidence?.correctness?.bodySha256 ||
      canonicalJson(workload.condition) !== canonicalJson(report?.benchmarkEvidence?.condition)
    ) {
      findings.push('profile workload identity differs from benchmark evidence');
    }
  } else {
    findings.push('workload identity is missing');
  }
  if (
    workload?.schema !== SERVER_PROFILE_WORKLOAD_SCHEMA ||
    !Number.isSafeInteger(workload?.durationMs) ||
    !Number.isSafeInteger(workload?.warmupMs) ||
    !Number.isSafeInteger(workload?.profileSamplingIntervalMicros) ||
    workload?.buildPreparation !== 'prepared-current-production-build' ||
    workload?.profileScope !== 'server-import-readiness-warmup-measurement-and-shutdown'
  ) {
    findings.push('profile workload scope is incomplete');
  }
  if (!report?.source?.commit || !sameSourceState(report.source, report.sourceAfter)) {
    findings.push('source identity is missing or unstable');
  }
  if (
    report?.preparation?.skipped !== false ||
    report?.preparation?.schema !== SERVER_PREPARE_SCHEMA ||
    report?.preparation?.integrity?.complete !== true ||
    !sameSourceState(report?.preparation?.source, report?.preparation?.sourceAfter) ||
    !sameSourceState(report?.preparation?.sourceAfter, report?.source)
  ) {
    findings.push('production preparation identity is missing or unstable');
  }
  if (
    report?.integrity?.complete !== true ||
    report?.integrity?.sourceClean !== true ||
    report?.integrity?.sourceStable !== true ||
    report?.source?.dirty !== false ||
    report?.verdict?.status !== 'diagnostic'
  ) {
    findings.push('profile is not a clean, complete diagnostic');
  }
  return findings;
}

function profileIntegrityErrors({ analysis, benchmark, preparation, skipBuild }) {
  const errors = [];
  if (skipBuild) errors.push('production preparation was explicitly skipped');
  if (!skipBuild && preparation?.schema !== SERVER_PREPARE_SCHEMA) {
    errors.push('production preparation report is missing');
  }
  if (!skipBuild && preparation?.integrity?.complete !== true) {
    errors.push('production preparation was incomplete');
  }
  if (
    !skipBuild &&
    (!sameSourceState(preparation?.source, preparation?.sourceAfter) ||
      !sameSourceState(preparation?.sourceAfter, benchmark?.source))
  ) {
    errors.push('production preparation source identity differs from the profiled source');
  }
  if (benchmark?.schema !== SERVER_BENCHMARK_SCHEMA)
    errors.push('server benchmark schema mismatch');
  if (benchmark?.framework !== 'kovo') errors.push('profiled benchmark was not Kovo');
  if (benchmark?.integrity?.complete !== true) {
    errors.push(...(benchmark?.integrity?.errors ?? ['server benchmark was incomplete']));
  }
  if (benchmark?.verdict?.status !== 'measured') errors.push('server benchmark was unproven');
  if (
    benchmark?.condition?.mode !== 'dynamic' ||
    benchmark?.condition?.encoding !== 'identity' ||
    benchmark?.condition?.concurrency !== 32
  ) {
    errors.push('server profile condition was not forced-dynamic identity c32');
  }
  const cacheControl = String(benchmark?.correctness?.cacheControl ?? '').toLowerCase();
  if (!cacheControl.includes('private') || !cacheControl.includes('no-store')) {
    errors.push('forced-dynamic response omitted private/no-store cache posture');
  }
  if (!benchmark?.correctness?.bodySha256) errors.push('matched response body identity is missing');
  if (analysis.census.missingNodeSamples !== 0)
    errors.push('CPU profile contains unknown sample nodes');
  return errors;
}

function normalizedFrame(frame) {
  return {
    columnNumber: integerOrZero(frame.columnNumber),
    functionName:
      typeof frame.functionName === 'string' && frame.functionName.length > 0
        ? frame.functionName
        : '(anonymous)',
    lineNumber: integerOrZero(frame.lineNumber),
    url: portableProfileUrl(frame.url),
  };
}

function portableProfileUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (value.startsWith('node:')) return value;
  if (value.startsWith('file:')) {
    try {
      const filePath = fileURLToPath(value);
      const relative = path.relative(repoRoot, filePath);
      if (
        relative !== '..' &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
      ) {
        return relative.split(path.sep).join('/');
      }
      return path.basename(filePath);
    } catch {
      return '<invalid-file-url>';
    }
  }
  return value.length > 256 ? `${value.slice(0, 253)}...` : value;
}

function isIdleFrame(frame) {
  return /^(?:\(idle\)|\(program\)|\(root\))$/u.test(frame.functionName);
}

function hotPathCategory(frame) {
  const text = frameHaystack(frame);
  if (/\(garbage collector\)/iu.test(text)) return 'garbage-collection';
  if (/\b(?:formHelperSnapshotRecord|ownDataValue|formHelperDefineDataProperty)\b/u.test(text)) {
    return 'form-property-snapshot';
  }
  if (/\b(?:renderJsx|renderNode|renderChildren|renderComponent)[^ ]*\b/iu.test(text)) {
    return 'jsx-rendering';
  }
  if (/\b(?:hkdf|hmac|createHmac|derive[^ ]*key|crypto)[^ ]*\b/iu.test(text)) {
    return 'cryptography';
  }
  if (/\b(?:head|csp|contentSecurityPolicy)[^ ]*\b/iu.test(text)) return 'head-and-csp';
  if (/\b(?:request|route|dispatch|appDocument|renderDocument)[^ ]*\b/iu.test(text)) {
    return 'request-and-routing';
  }
  if (frame.url?.startsWith('node:') || frame.url === null) return 'node-v8-native';
  if (frame.url.includes('benchmarks/kovo/dist/server')) return 'generated-kovo-server';
  if (frame.url.includes('node_modules/')) return 'dependency';
  return 'other-javascript';
}

function frameHaystack(frame) {
  return `${frame.functionName} ${frame.url ?? ''}`;
}

function frameSort(left, right) {
  return frameHaystack(left).localeCompare(frameHaystack(right));
}

function sameSourceState(left, right) {
  return (
    left?.commit === right?.commit &&
    JSON.stringify(left?.dirtyPaths) === JSON.stringify(right?.dirtyPaths) &&
    JSON.stringify(left?.locks) === JSON.stringify(right?.locks)
  );
}

function integerOrZero(value) {
  return Number.isSafeInteger(value) ? value : 0;
}

function finiteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new TypeError(`${name} is invalid`);
  return value;
}

function percent(value, total) {
  return (value / total) * 100;
}

function boundedInteger(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} must be an integer between ${String(min)} and ${String(max)}`);
  }
  return value;
}

function requiredString(value, name) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} is required`);
  return value;
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function isSha256(value) {
  return /^sha256:[a-f0-9]{64}$/u.test(String(value ?? ''));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const output = readArg('--out');
  const profileOut = readArg('--profile-out');
  if (!output) throw new Error('--out is required');
  if (!profileOut) throw new Error('--profile-out is required');
  const report = await runForcedDynamicServerProfile({
    allowDirty: process.argv.includes('--allow-dirty'),
    durationMs: readIntegerArg('--duration-ms', {
      fallback: DEFAULT_DURATION_MS,
      max: 60_000,
      min: 25,
    }),
    overwrite: process.argv.includes('--overwrite'),
    port: readIntegerArg('--port', { fallback: 50_330, max: 65_535, min: 1_024 }),
    profileOut,
    route: readArg('--route') ?? 'listing',
    skipBuild: process.argv.includes('--skip-build'),
    warmupMs: readIntegerArg('--warmup-ms', {
      fallback: DEFAULT_WARMUP_MS,
      max: 60_000,
      min: 25,
    }),
  });
  await writeFile(path.resolve(output), `${JSON.stringify(report, null, 2)}\n`);
  const findings = validateServerProfileReport(report);
  if (findings.length > 0 || report.verdict.status !== 'diagnostic') {
    process.stderr.write(
      `forced-dynamic SSR profile is unproven: ${[...findings, ...report.verdict.reasons].join('; ')}\n`,
    );
    process.exitCode = 2;
  }
}
