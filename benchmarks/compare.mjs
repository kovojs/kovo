#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseIntegerFlag, readArg, readIntegerArg } from './harness/args.mjs';
import { bfcacheIterationFindings } from './harness/bfcache.mjs';
import {
  LIGHTHOUSE_METRIC_KEYS,
  lighthouseBrowserIdentityFindings,
  lighthouseSampleFailureFindings,
  lighthouseTimeoutPolicyFindings,
} from './harness/lighthouse-policy.mjs';
import { BROWSER_BENCHMARK_SCHEMA } from './harness/schema.mjs';
import { navigationAttributionFindings, sessionBytePhaseFindings } from './harness/scenarios.mjs';
import {
  BROWSER_FIXTURE_IDENTITY_SCHEMA,
  BROWSER_FIXTURE_RENDERED_EVIDENCE_SCHEMA,
  browserFixtureIdentity,
} from './browser-fixture-identity.mjs';
import {
  DEV_PORT_ALLOCATION_POSTURE,
  DEV_SESSION_PORT_STRIDE,
  generateCorpus,
} from './corpora/generate.mjs';
import { DEFAULT_DEV_PORT_BASE } from './harness/dev-port-allocation.mjs';
import {
  MATCHED_SERVER_SEMANTIC_CONTRACT_SCHEMA,
  MATCHED_SERVER_SEMANTIC_EVIDENCE_SCHEMA,
  MATCHED_SERVER_SEMANTIC_SOURCE,
  MATCHED_SERVER_SEMANTIC_SOURCE_SCHEMA,
  matchedServerSemanticContract,
} from './shared/server-semantic-contract.mjs';
import {
  canonicalJson,
  PERF_HOST_SCHEMA,
  performanceHostFingerprint,
  validPerformanceHostFingerprint,
} from '../scripts/lib/perf-host.mjs';
import { collectPerformanceProvenance } from '../scripts/lib/perf-provenance.mjs';
import {
  createPackedKovoProductFixture,
  PACKED_KOVO_PRODUCT_WORKLOAD_POLICY,
  packedKovoProductIdentityFindings,
  packedKovoProductWorkloadPolicyFindings,
} from '../scripts/lib/perf-packed-kovo-product.mjs';
import { devSessionHandoffFindings } from '../scripts/lib/perf-dev-session-evidence.mjs';
import {
  executionIdentityFindings,
  performanceExecutionIdentity,
} from '../scripts/lib/perf-execution.mjs';
import {
  SERVER_BENCHMARK_SCHEMA,
  SERVER_CONCURRENCIES,
  SERVER_ENCODINGS,
  SERVER_MODES,
  SERVER_PREPARE_SCHEMA,
  SERVER_ROUTES,
  serverConditions,
} from '../scripts/perf-server-benchmark.mjs';
import { preparePackedCliBenchmark } from '../scripts/perf-cli-startup-benchmark.mjs';

export const COMPARE_SCHEMA = 'kovo-next-performance-comparison/v1';
export const BROWSER_PREPARE_SCHEMA = 'kovo-browser-benchmark-prepare/v1';
export const COMPARE_ADAPTER_FAILURE_SCHEMA = 'kovo-comparison-adapter-failure/v1';
export const EXECUTION_ORDER = Object.freeze(['kovo', 'nextjs', 'nextjs', 'kovo']);
export const WORKLOAD_IDENTITY_SCHEMA = 'kovo-performance-workload-identity/v1';

const DEV_EDIT_CLASSES = Object.freeze(['leaf', 'entry', 'data', 'syntaxError', 'recovery']);
const DEV_LOOP_REPORT_SCHEMA = 'kovo-dev-loop-report/v1';
const MAX_COMPARISON_RAW_REPORT_BYTES = 64 * 1024 * 1024;
const DEFAULT_HOST_SETTLE_MAX_MS = 30_000;
const DEFAULT_HOST_SETTLE_POLL_MS = 1_000;
const MAX_HOST_SETTLE_MAX_MS = 60_000;

const benchmarkRoot = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = path.resolve(benchmarkRoot, '..');
const lanes = Object.freeze(['default', 'matched-l0', 'matched-l1']);
const buildModes = Object.freeze(['clean', 'unchanged', 'edit']);
const defaultCells = Object.freeze(['browser', 'dev', 'build', 'server']);
const lockFiles = Object.freeze([
  'pnpm-lock.yaml',
  'benchmarks/nextjs/pnpm-lock.yaml',
  'benchmarks/harness/pnpm-lock.yaml',
]);

export async function runComparison(options = {}) {
  const execution = performanceExecutionIdentity();
  const executionAuthenticated = executionIdentityFindings(execution).length === 0;
  const cells = options.cells ?? defaultCells;
  for (const cell of cells) assertMember('--cells', cell, defaultCells);
  if (new Set(cells).size !== cells.length) throw new Error('--cells must not contain duplicates.');
  assertMember('--corpus-size', options.corpusSize ?? 24, [24, 216]);
  if ((cells.includes('browser') || cells.includes('server')) && options.skipBuild === true) {
    throw new Error(
      '--skip-build is unavailable for browser/server comparisons; each comparison prepares fresh production artifacts once.',
    );
  }
  if (cells.includes('server')) {
    assertServerMatrixOptions(options);
  }
  const quietHostPolicy = comparisonQuietHostPolicy(options);
  for (const lane of options.lanes ?? lanes) assertMember('--lanes', lane, lanes);
  for (const mode of options.buildModes ?? buildModes)
    assertMember('--build-modes', mode, buildModes);
  const devSchedule = cells.includes('dev')
    ? devSampleSchedule({
        editSamples: options.devIterations ?? 30,
        readySamples: options.devReadyIterations ?? 15,
        warmups: options.devWarmups ?? 3,
      })
    : [];
  const devPortBase = options.devPortBase ?? DEFAULT_DEV_PORT_BASE;
  if (!Number.isSafeInteger(devPortBase) || devPortBase < 1_024) {
    throw new TypeError('dev port base must be an integer at or above 1024');
  }
  if (
    devSchedule.some(
      ({ readySamples, scheduleIndex }) =>
        devPortBase + scheduleIndex * DEV_SESSION_PORT_STRIDE + readySamples > 65_535,
    )
  ) {
    throw new TypeError('dev port ranges exceed 65535');
  }
  const provenance = collectPerformanceProvenance({
    lockFiles,
    repoRoot,
  });
  const dirtyOverride = provenance.dirty && options.allowDirty === true;
  if (provenance.dirty && !dirtyOverride) {
    const workloadIdentity = await performanceWorkloadIdentity(options, cells);
    const outDir = path.resolve(options.outDir ?? path.join(benchmarkRoot, 'results'));
    await mkdir(outDir, { recursive: true });
    const report = {
      analysis: {},
      browserPreparation: [],
      execution,
      generatedAt: new Date().toISOString(),
      host: performanceHostFingerprint(),
      hostSamples: [],
      integrity: {
        alternatingOrder: EXECUTION_ORDER,
        cells,
        comparatorMatched: false,
        executionAuthenticated,
        serialized: true,
        sourceStable: true,
        workloadAuthenticated: workloadIdentity.complete,
      },
      productArtifact: null,
      rawCells: [],
      schema: COMPARE_SCHEMA,
      serverPreparation: [],
      source: provenance,
      sourceAfter: provenance,
      workloadIdentity,
    };
    report.verdict = comparisonVerdict(report);
    const output = path.join(outDir, 'comparison.json');
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    throw new Error(
      `Comparison is unproven: ${report.verdict.reasons.join('; ')}. Evidence preserved at ${output}.`,
    );
  }

  const outDir = path.resolve(options.outDir ?? path.join(benchmarkRoot, 'results'));
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'kovo-next-compare-'));
  const iterations = options.iterations ?? 30;
  const warmups = options.warmups ?? 3;
  const occurrenceCounts = splitAcrossOccurrences(iterations);
  const warmupCounts = splitAcrossOccurrences(warmups);
  const bfcacheCounts = splitAcrossOccurrences(options.bfcacheIterations ?? 10);
  const lighthouseCounts = splitAcrossOccurrences(options.lighthouseRuns ?? 5);
  const hostSamples = [];
  const rawCells = [];
  const browserPreparation = [];
  const serverPreparation = [];
  let packedProductFixture = null;
  let packedKovoCorpusManifest = null;
  const quietHost = createQuietHostAdmission({
    ceiling: options.maxLoadPerCpu ?? 1,
    maxWaitMs: quietHostPolicy.maxWaitMs,
    pollMs: quietHostPolicy.pollMs,
    samples: hostSamples,
  });
  let executionError = null;
  await mkdir(outDir, { recursive: true });
  try {
    let workloadOptions = options;
    if (cells.includes('dev') || cells.includes('build')) {
      const prepared = await preparePackedCliBenchmark(options.packedProductPreparation ?? {});
      try {
        const sourceAfterPreparation = collectPerformanceProvenance({ lockFiles, repoRoot });
        packedProductFixture = createPackedKovoProductFixture({
          prepared,
          source: provenance,
          sourceAfter: sourceAfterPreparation,
        });
        packedKovoCorpusManifest = await generateCorpus({
          dependencyMode: 'deferred',
          framework: 'kovo',
          outDir: path.join(scratch, 'packed-kovo-corpus'),
          size: options.corpusSize ?? 24,
        });
        packedProductFixture.bindCorpus(packedKovoCorpusManifest);
      } catch (error) {
        if (packedProductFixture === null) prepared.cleanup();
        else {
          packedProductFixture.cleanup();
          packedProductFixture = null;
        }
        throw error;
      }
      workloadOptions = {
        ...options,
        corpusManifests: {
          kovo: packedKovoCorpusManifest,
          nextjs: corpusManifest('nextjs', options.corpusSize ?? 24),
        },
      };
    }
    const workloadIdentity = await performanceWorkloadIdentity(workloadOptions, cells);
    const initialHost = await quietHost.admit('suite-start');
    if (!initialHost.comparable) executionError = quietHostFailure(initialHost);

    if (cells.includes('browser') && !executionError) {
      quietHost.markBenchmarkWork();
      browserPreparation.push(...(await prepareBrowserEntrants()));
      const incomplete = browserPreparation.filter((report) => report.integrity.complete !== true);
      if (incomplete.length > 0) {
        executionError = incomplete
          .flatMap((report) =>
            report.integrity.errors.map((error) => `${report.framework}: ${error}`),
          )
          .join('; ');
      }
    }
    if (cells.includes('browser') && !executionError) {
      for (const lane of options.lanes ?? lanes) {
        assertMember('--lanes', lane, lanes);
        for (const [orderIndex, framework] of EXECUTION_ORDER.entries()) {
          const occurrence = occurrenceIndex(orderIndex, framework);
          const sampleCount = occurrenceCounts[occurrence];
          const warmupCount = warmupCounts[occurrence];
          const host = await quietHost.admit(`${lane}/browser/${framework}/${String(occurrence)}`);
          if (!host.comparable) {
            executionError = quietHostFailure(host);
            break;
          }
          const resultFile = path.join(scratch, `${lane}-${orderIndex}-browser.json`);
          const retainedReference = `raw/${lane}-${String(orderIndex)}-${framework}-browser-failed.json`;
          const captured = await runBrowserComparisonAdapterCell({
            adapter: {
              args: [
                path.join(benchmarkRoot, 'run-all.mjs'),
                '--apps',
                framework,
                '--lane',
                lane,
                '--iterations',
                String(sampleCount),
                '--warmups',
                String(warmupCount),
                ...(options.skipLighthouse
                  ? ['--skip-lighthouse']
                  : ['--lighthouse-runs', String(Math.max(1, lighthouseCounts[occurrence]))]),
                '--bfcache-iterations',
                String(Math.max(1, bfcacheCounts[occurrence])),
                '--skip-build',
                '--out-dir',
                path.join(scratch, `${lane}-${orderIndex}-browser-out`),
                '--result-file',
                resultFile,
              ],
              cwd: repoRoot,
              label: `${lane}/${framework}/browser/${occurrence}`,
            },
            cell: {
              cell: 'browser',
              framework,
              lane,
              occurrence,
            },
            resultFile,
            retainedFile: path.join(outDir, retainedReference),
            retainedReference,
          });
          rawCells.push(captured.cell);
          if (captured.error !== null) {
            executionError = captured.error;
            break;
          }
        }
        if (executionError) break;
      }
    }

    if (cells.includes('dev') && !executionError) {
      const corpusLane = `corpus-n${options.corpusSize ?? 24}`;
      for (const scheduled of devSchedule) {
        const { framework, occurrence, scheduleIndex } = scheduled;
        const host = await quietHost.admit(`${corpusLane}/dev/${framework}/${String(occurrence)}`);
        if (!host.comparable) {
          executionError = quietHostFailure(host);
          break;
        }
        quietHost.markBenchmarkWork();
        const resultFile = path.join(scratch, `${corpusLane}-${scheduleIndex}-dev.json`);
        const retainedReference = `raw/${corpusLane}-${String(scheduleIndex)}-${framework}-failed.json`;
        const captured = await runDevComparisonAdapterCell({
          adapter: {
            args: [
              path.join(benchmarkRoot, 'corpora/dev-loop.mjs'),
              '--manifest',
              comparisonCorpusManifest(
                framework,
                options.corpusSize ?? 24,
                packedKovoCorpusManifest,
              ),
              '--iterations',
              String(scheduled.editSamples),
              '--ready-iterations',
              String(scheduled.readySamples),
              '--warmups',
              String(scheduled.warmups),
              '--port',
              String(devPortBase + scheduleIndex * DEV_SESSION_PORT_STRIDE),
              '--out',
              resultFile,
              ...(framework === 'kovo'
                ? [
                    '--packed-product',
                    packedProductFixture.descriptorPath,
                    '--packed-product-digest',
                    packedProductFixture.identity.digest,
                  ]
                : []),
            ],
            cwd: repoRoot,
            label: `${corpusLane}/${framework}/dev/${occurrence}`,
          },
          cell: {
            cell: 'dev',
            framework,
            lane: corpusLane,
            occurrence,
            port: devPortBase + scheduleIndex * DEV_SESSION_PORT_STRIDE,
            schedule: scheduled,
          },
          resultFile,
          retainedFile: path.join(outDir, retainedReference),
          retainedReference,
        });
        rawCells.push(captured.cell);
        if (captured.error !== null) {
          executionError = captured.error;
          break;
        }
      }
    }

    if (cells.includes('build') && !executionError) {
      const corpusLane = `corpus-n${options.corpusSize ?? 24}`;
      for (const mode of options.buildModes ?? buildModes) {
        assertMember('--build-modes', mode, buildModes);
        for (const [orderIndex, framework] of EXECUTION_ORDER.entries()) {
          const occurrence = occurrenceIndex(orderIndex, framework);
          const sampleCount = occurrenceCounts[occurrence];
          const warmupCount = warmupCounts[occurrence];
          const host = await quietHost.admit(
            `${corpusLane}/build-${mode}/${framework}/${String(occurrence)}`,
          );
          if (!host.comparable) {
            executionError = quietHostFailure(host);
            break;
          }
          quietHost.markBenchmarkWork();
          const manifest = comparisonCorpusManifest(
            framework,
            options.corpusSize ?? 24,
            packedKovoCorpusManifest,
          );
          const resultFile = path.join(scratch, `${corpusLane}-${orderIndex}-build-${mode}.json`);
          try {
            await runAdapter({
              args: [
                path.join(repoRoot, 'scripts/perf-build-benchmark.mjs'),
                '--framework',
                framework,
                '--corpus',
                manifest,
                '--mode',
                mode,
                '--iterations',
                String(sampleCount),
                '--warmups',
                String(warmupCount),
                '--out',
                resultFile,
                ...(framework === 'kovo'
                  ? [
                      '--packed-product',
                      packedProductFixture.descriptorPath,
                      '--packed-product-digest',
                      packedProductFixture.identity.digest,
                    ]
                  : []),
              ],
              cwd: repoRoot,
              label: `${corpusLane}/${framework}/build-${mode}/${occurrence}`,
            });
          } catch (error) {
            executionError = error instanceof Error ? error.message : String(error);
            break;
          }
          rawCells.push({
            cell: 'build',
            framework,
            lane: corpusLane,
            mode,
            occurrence,
            report: JSON.parse(await readFile(resultFile, 'utf8')),
          });
        }
        if (executionError) break;
      }
    }

    if (cells.includes('server') && !executionError) {
      for (const [frameworkIndex, framework] of ['kovo', 'nextjs'].entries()) {
        const host = await quietHost.admit(`server/prepare/${framework}`);
        if (!host.comparable) {
          executionError = quietHostFailure(host);
          break;
        }
        quietHost.markBenchmarkWork();
        const resultFile = path.join(scratch, `server-prepare-${framework}.json`);
        try {
          await runAdapter({
            args: [
              path.join(repoRoot, 'scripts/perf-server-benchmark.mjs'),
              '--framework',
              framework,
              '--prepare-only',
              '--port',
              String((options.serverPortBase ?? 50_310) + frameworkIndex),
              ...(options.skipBuild ? ['--skip-build'] : []),
              ...(options.allowDirty ? ['--allow-dirty'] : []),
              '--out',
              resultFile,
            ],
            cwd: repoRoot,
            label: `server/prepare/${framework}`,
          });
        } catch (error) {
          executionError = error instanceof Error ? error.message : String(error);
          break;
        }
        serverPreparation.push(JSON.parse(await readFile(resultFile, 'utf8')));
      }

      const matrix = serverConditions({
        concurrencies: options.serverConcurrencies ?? SERVER_CONCURRENCIES,
        encodings: options.serverEncodings ?? SERVER_ENCODINGS,
        modes: options.serverModes ?? SERVER_MODES,
        routes: options.serverRoutes ?? SERVER_ROUTES,
      });
      for (const condition of matrix) {
        if (executionError) break;
        const schedule = serverSampleSchedule(options.serverSamples ?? 7);
        for (const [scheduleIndex, scheduled] of schedule.entries()) {
          const host = await quietHost.admit(
            `matched-runtime/${condition.key}/${scheduled.framework}/${String(
              scheduled.occurrence,
            )}`,
          );
          if (!host.comparable) {
            executionError = quietHostFailure(host);
            break;
          }
          quietHost.markBenchmarkWork();
          const frameworkIndex = scheduled.framework === 'kovo' ? 0 : 1;
          const resultFile = path.join(
            scratch,
            `server-${condition.key}-${String(scheduleIndex)}-${scheduled.framework}.json`,
          );
          try {
            await runAdapter({
              args: [
                path.join(repoRoot, 'scripts/perf-server-benchmark.mjs'),
                '--framework',
                scheduled.framework,
                '--mode',
                condition.mode,
                '--route',
                condition.route,
                '--encoding',
                condition.encoding,
                '--concurrency',
                String(condition.concurrency),
                '--warmup-ms',
                String(options.serverWarmupMs ?? 5_000),
                '--duration-ms',
                String(options.serverDurationMs ?? 15_000),
                '--port',
                String((options.serverPortBase ?? 50_310) + frameworkIndex),
                '--skip-build',
                ...(options.allowDirty ? ['--allow-dirty'] : []),
                '--out',
                resultFile,
              ],
              cwd: repoRoot,
              label: `matched-runtime/${condition.key}/${scheduled.framework}/${String(
                scheduled.occurrence,
              )}`,
            });
          } catch (error) {
            executionError = error instanceof Error ? error.message : String(error);
            break;
          }
          rawCells.push({
            cell: 'server',
            framework: scheduled.framework,
            lane: 'matched-runtime',
            mode: condition.key,
            occurrence: scheduled.occurrence,
            report: JSON.parse(await readFile(resultFile, 'utf8')),
            scheduleIndex,
            serverCondition: condition,
          });
        }
      }
    }

    const analysis = pairedAnalysis(rawCells, {
      bootstrapIterations: options.bootstrapIterations ?? 10_000,
      seed: options.seed ?? 0x4b4f564f,
    });
    const finalProvenance = collectPerformanceProvenance({
      lockFiles,
      repoRoot,
    });
    const sourceStable = sameSourceState(provenance, finalProvenance);
    const report = {
      analysis,
      browserPreparation,
      execution,
      generatedAt: new Date().toISOString(),
      host: performanceHostFingerprint({ browserVersions: observedBrowserVersions(rawCells) }),
      hostSamples,
      integrity: {
        alternatingOrder: EXECUTION_ORDER,
        cells,
        comparator: await comparatorIntegrity(rawCells, {
          browserPreparation,
          cells,
          corpusSize: options.corpusSize ?? 24,
          bfcacheIterations: options.bfcacheIterations ?? 10,
          devIterations: options.devIterations ?? 30,
          devOccurrenceSchedule: devSchedule,
          devPortBase,
          devReadyIterations: options.devReadyIterations ?? 15,
          devWarmups: options.devWarmups ?? 3,
          fixtureIdentity: workloadIdentity.identity.fixture,
          iterations,
          lanes: options.lanes ?? lanes,
          lighthouseRuns: options.lighthouseRuns ?? 5,
          modes: options.buildModes ?? buildModes,
          corpusManifests: workloadOptions.corpusManifests,
          productArtifact: packedProductFixture?.identity ?? null,
          serverConcurrencies: options.serverConcurrencies ?? SERVER_CONCURRENCIES,
          serverDurationMs: options.serverDurationMs ?? 15_000,
          serverEncodings: options.serverEncodings ?? SERVER_ENCODINGS,
          serverHostSettleMaxMs: quietHostPolicy.maxWaitMs,
          serverHostSettlePollMs: quietHostPolicy.pollMs,
          serverModes: options.serverModes ?? SERVER_MODES,
          serverPreparation,
          serverRoutes: options.serverRoutes ?? SERVER_ROUTES,
          serverSamples: options.serverSamples ?? 7,
          serverSemanticIdentity: workloadIdentity.identity.serverSemantic,
          serverWarmupMs: options.serverWarmupMs ?? 5_000,
          skipLighthouse: options.skipLighthouse === true,
          source: provenance,
          warmups,
          workloadIdentity,
        }),
        comparatorMatched: false,
        executionAuthenticated,
        executionError,
        hostLoadCeilingPerCpu: options.maxLoadPerCpu ?? 1,
        serialized: true,
        sourceStable,
        publishable: !dirtyOverride,
        workloadAuthenticated: workloadIdentity.complete,
      },
      policy: {
        bfcacheIterations: options.bfcacheIterations ?? 10,
        bootstrapIterations: options.bootstrapIterations ?? 10_000,
        browserSamples: iterations,
        devEditSamples: options.devIterations ?? 30,
        devEditSessionSamples: devSchedule.filter(({ framework }) => framework === 'kovo').length,
        devOccurrenceSchedule: devSchedule,
        devPortAllocationPosture: DEV_PORT_ALLOCATION_POSTURE,
        devPortBase,
        devPortStride: DEV_SESSION_PORT_STRIDE,
        devReadySamples: options.devReadyIterations ?? 15,
        devWarmups: options.devWarmups ?? 3,
        lighthouseRunsPerCell: options.lighthouseRuns ?? 5,
        quietHost: {
          ceilingPerCpu: options.maxLoadPerCpu ?? 1,
          maxTotalWaitMs: quietHostPolicy.maxWaitMs,
          pollMs: quietHostPolicy.pollMs,
          posture: 'pre-benchmark-admission-then-post-benchmark-settle',
        },
        server: {
          concurrencies: options.serverConcurrencies ?? SERVER_CONCURRENCIES,
          durationMs: options.serverDurationMs ?? 15_000,
          encodings: options.serverEncodings ?? SERVER_ENCODINGS,
          hostSettleMaxMs: quietHostPolicy.maxWaitMs,
          hostSettlePollMs: quietHostPolicy.pollMs,
          modes: options.serverModes ?? SERVER_MODES,
          routes: options.serverRoutes ?? SERVER_ROUTES,
          samplesPerFrameworkCondition: options.serverSamples ?? 7,
          warmupMs: options.serverWarmupMs ?? 5_000,
        },
        warmups,
      },
      productArtifact: packedProductFixture?.identity ?? null,
      rawCells,
      schema: COMPARE_SCHEMA,
      serverPreparation,
      source: provenance,
      sourceAfter: finalProvenance,
      workloadIdentity,
    };
    report.integrity.comparatorMatched = report.integrity.comparator.matched;
    report.verdict = comparisonVerdict(report);
    const output = path.join(outDir, 'comparison.json');
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    if (report.verdict.status !== 'measured') {
      throw new Error(
        `Comparison is unproven: ${report.verdict.reasons.join('; ')}. Evidence preserved at ${output}.`,
      );
    }
    return { output, report };
  } finally {
    try {
      await rm(scratch, { force: true, recursive: true });
    } finally {
      packedProductFixture?.cleanup();
    }
  }
}

export function comparisonVerdict(report) {
  const reasons = [];
  if (report.source?.dirty) reasons.push('source provenance is dirty');
  if (
    report.integrity?.sourceStable !== true ||
    canonicalJson(report.source) !== canonicalJson(report.sourceAfter)
  ) {
    reasons.push('source provenance changed during run');
  }
  if (report.integrity?.comparatorMatched !== true)
    reasons.push('comparator pairing is incomplete');
  for (const reason of report.integrity?.comparator?.reasons ?? []) reasons.push(reason);
  if (report.integrity?.executionError) reasons.push(report.integrity.executionError);
  if (report.integrity?.executionAuthenticated !== true) {
    reasons.push('execution identity is incomplete');
  } else {
    for (const reason of executionIdentityFindings(report.execution)) reasons.push(reason);
  }
  if (report.integrity?.serialized !== true) reasons.push('cells were not serialized');
  if (report.integrity?.workloadAuthenticated !== true)
    reasons.push('workload identity is incomplete');
  return {
    reasons: [...new Set(reasons)],
    status: reasons.length === 0 ? 'measured' : 'unproven',
  };
}

export function pairedAnalysis(cells, { bootstrapIterations = 10_000, seed = 1 } = {}) {
  const groups = new Map();
  for (const cell of cells) {
    for (const metric of rawMetricSeries(cell)) {
      const key = [cell.lane, cell.cell, cell.mode ?? '', metric.name].join('/');
      const group = groups.get(key) ?? { kovo: new Map(), nextjs: new Map(), metric: metric.name };
      group[cell.framework].set(cell.occurrence, metric.values);
      groups.set(key, group);
    }
  }
  const output = {};
  for (const [key, group] of groups) {
    const pairs = [];
    const kovo = [];
    const nextjs = [];
    const occurrences = [...group.kovo.keys()]
      .filter((occurrence) => group.nextjs.has(occurrence))
      .sort((left, right) => left - right);
    for (const occurrence of occurrences) {
      const kovoValues = group.kovo.get(occurrence) ?? [];
      const nextValues = group.nextjs.get(occurrence) ?? [];
      const samples = Math.min(kovoValues.length, nextValues.length);
      for (let index = 0; index < samples; index += 1) {
        kovo.push(kovoValues[index]);
        nextjs.push(nextValues[index]);
        pairs.push(kovoValues[index] - nextValues[index]);
      }
    }
    if (pairs.length === 0) continue;
    output[key] = {
      kovo: summarize(kovo),
      nextjs: summarize(nextjs),
      pairedDifference: {
        bootstrap95Ci: bootstrapMedianCi(pairs, { iterations: bootstrapIterations, seed }),
        direction: 'kovo-minus-nextjs',
        median: percentile(pairs, 50),
        samples: pairs.length,
      },
    };
    seed += 1;
  }
  return output;
}

function rawMetricSeries(cell) {
  if (cell.cell === 'server' && cell.report?.support?.status === 'unsupported') return [];
  if (cell.cell === 'browser') {
    const app = cell.report.apps?.[0];
    const output = [];
    for (const [condition, scenarios] of Object.entries(app?.conditions ?? {})) {
      for (const [scenario, value] of Object.entries(scenarios ?? {})) {
        if (!Array.isArray(value?.iterations)) continue;
        for (const name of numericLeafNames(value.iterations)) {
          output.push({
            name: `${condition}.${scenario}.${name}`,
            values: value.iterations
              .map((iteration) => readLeaf(iteration, name))
              .filter(Number.isFinite),
          });
        }
      }
    }
    for (const lighthouse of app?.lighthouse ?? []) {
      const route = lighthouse.path === app?.integrity?.policy?.listingPath ? 'listing' : 'detail';
      for (const name of numericLeafNames(lighthouse.samples ?? [])) {
        output.push({
          name: `lighthouse.${lighthouse.formFactor}.${route}.${name}`,
          values: lighthouse.samples
            .map((sample) => readLeaf(sample, name))
            .filter(Number.isFinite),
        });
      }
    }
    const bfcache = app?.bfcache?.iterations ?? [];
    if (bfcache.length > 0) {
      output.push(
        {
          name: 'bfcache.applicable',
          values: bfcache.map((sample) => (sample?.applicable === true ? 1 : 0)),
        },
        {
          name: 'bfcache.evidenceComplete',
          values: bfcache.map((sample) => (sample?.evidenceComplete === true ? 1 : 0)),
        },
        {
          name: 'bfcache.restored',
          values: bfcache.map((sample) => (sample?.restored === true ? 1 : 0)),
        },
      );
    }
    return output;
  }
  if (cell.cell === 'dev') {
    return devMetricSeries(cell.report);
  }
  const samples = cell.report.samples ?? cell.report.rawSamples ?? [];
  return prefixedMetricSeries(samples);
}

function devMetricSeries(report) {
  const editSamples = Array.isArray(report?.samples) ? report.samples : [];
  const readySamples = Array.isArray(report?.readySamples) ? report.readySamples : [];
  const editPeakRssBytes = report?.editSession?.peakRssBytes;
  return [
    ...prefixedMetricSeries(editSamples, 'edit', { requireComplete: true }),
    ...prefixedMetricSeries(readySamples, 'ready', { requireComplete: true }),
    ...DEV_EDIT_CLASSES.map((editClass) => ({
      name: `edit.${editClass}StateSurvived`,
      values: editSamples.map((sample) => (sample?.[`${editClass}StateSurvived`] === true ? 1 : 0)),
    })),
    {
      name: 'edit.sampleAvailable',
      values: editSamples.map((sample) => (devEditSampleAvailable(sample) ? 1 : 0)),
    },
    {
      name: 'edit.syntaxErrorDiagnosticAvailable',
      values: editSamples.map((sample) =>
        typeof sample?.syntaxErrorDiagnosticSignal === 'string' &&
        sample.syntaxErrorDiagnosticSignal.length > 0
          ? 1
          : 0,
      ),
    },
    {
      name: 'edit.peakRssBytes',
      values: Number.isFinite(editPeakRssBytes) ? [editPeakRssBytes] : [],
    },
    {
      name: 'ready.successAvailable',
      values: readySamples.map((sample) => (sample?.success === true ? 1 : 0)),
    },
  ];
}

function devEditSampleAvailable(sample) {
  return (
    DEV_EDIT_CLASSES.every(
      (editClass) =>
        Number.isFinite(sample?.[`${editClass}Ms`]) &&
        sample?.[`${editClass}StateSurvived`] === true,
    ) &&
    typeof sample?.syntaxErrorDiagnosticSignal === 'string' &&
    sample.syntaxErrorDiagnosticSignal.length > 0
  );
}

function prefixedMetricSeries(samples, prefix = '', { requireComplete = false } = {}) {
  return numericLeafNames(samples)
    .map((name) => ({
      name: prefix ? `${prefix}.${name}` : name,
      values: samples.map((sample) => readLeaf(sample, name)).filter(Number.isFinite),
    }))
    .filter((series) => !requireComplete || series.values.length === samples.length);
}

function numericLeafNames(values) {
  const names = new Set();
  for (const value of values) visitLeaves(value, '', names);
  return [...names].sort();
}

function visitLeaves(value, prefix, names) {
  for (const [key, child] of Object.entries(value ?? {})) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child))
      visitLeaves(child, name, names);
    else if (Number.isFinite(child)) names.add(name);
  }
}

function readLeaf(value, name) {
  return name.split('.').reduce((child, key) => child?.[key], value);
}

export function summarize(values) {
  return {
    mad: percentile(
      values.map((value) => Math.abs(value - percentile(values, 50))),
      50,
    ),
    median: percentile(values, 50),
    p95: percentile(values, 95),
    samples: values.length,
  };
}

export function bootstrapMedianCi(values, { iterations = 10_000, seed = 1 } = {}) {
  if (values.length === 0) return [null, null];
  const random = seededRandom(seed);
  const medians = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const resample = Array.from(
      { length: values.length },
      () => values[Math.floor(random() * values.length)],
    );
    medians.push(percentile(resample, 50));
  }
  return [percentile(medians, 2.5), percentile(medians, 97.5)];
}

function percentile(values, pct) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1)];
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function splitAcrossOccurrences(total) {
  if (!Number.isInteger(total) || total < 0)
    throw new Error(`Sample total must be >= 0, got ${total}.`);
  return [Math.ceil(total / 2), Math.floor(total / 2)];
}

/** Split declared dev totals across the serialized K,N,N,K occurrences exactly once. */
export function devSampleSchedule({ editSamples, readySamples, warmups }) {
  const editCounts = splitAcrossOccurrences(
    boundedComparisonInteger(editSamples, 2, 100, 'dev edit samples'),
  );
  const readyCounts = splitAcrossOccurrences(
    boundedComparisonInteger(readySamples, 2, 100, 'dev ready samples'),
  );
  const warmupCounts = splitAcrossOccurrences(
    boundedComparisonInteger(warmups, 0, 10, 'dev warmups'),
  );
  const occurrences = { kovo: 0, nextjs: 0 };
  return EXECUTION_ORDER.map((framework, scheduleIndex) => {
    const occurrence = occurrences[framework]++;
    return {
      editSamples: editCounts[occurrence],
      framework,
      occurrence,
      readySamples: readyCounts[occurrence],
      scheduleIndex,
      warmups: warmupCounts[occurrence],
    };
  });
}

function boundedComparisonInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(
      `${label} must be an integer from ${String(minimum)} through ${String(maximum)}.`,
    );
  }
  return value;
}

/** Repeat K,N,N,K and truncate only after both frameworks own the requested sample count. */
export function serverSampleSchedule(samples = 7) {
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > 100) {
    throw new Error(`Server samples must be an integer between 1 and 100, got ${String(samples)}.`);
  }
  const counts = { kovo: 0, nextjs: 0 };
  const schedule = [];
  while (counts.kovo < samples || counts.nextjs < samples) {
    for (const framework of EXECUTION_ORDER) {
      if (counts[framework] >= samples) continue;
      schedule.push({ framework, occurrence: counts[framework] });
      counts[framework] += 1;
    }
  }
  return schedule;
}

function occurrenceIndex(orderIndex, framework) {
  return EXECUTION_ORDER.slice(0, orderIndex + 1).filter((value) => value === framework).length - 1;
}

function corpusManifest(framework, size) {
  return path.join(benchmarkRoot, framework, '.corpora', framework, `n${size}`, 'manifest.json');
}

function comparisonCorpusManifest(framework, size, packedKovoManifest) {
  if (framework !== 'kovo') return corpusManifest(framework, size);
  if (typeof packedKovoManifest !== 'string' || packedKovoManifest.length === 0) {
    throw new TypeError('packed Kovo corpus manifest is unavailable');
  }
  return packedKovoManifest;
}

/**
 * Admit a quiet host before any benchmark work, then classify later admissions as bounded
 * post-benchmark settling. One total wait budget is shared by the whole comparison, so adding more
 * cells cannot multiply the worst-case delay. Rejected observations stay nested under the final
 * admission record: ratifiers evaluate the load that actually admitted the cell without losing the
 * evidence that settling was required.
 */
export function createQuietHostAdmission({
  ceiling = 1,
  maxWaitMs = DEFAULT_HOST_SETTLE_MAX_MS,
  pollMs = DEFAULT_HOST_SETTLE_POLL_MS,
  readLoad = () => ({ loadAverage: os.loadavg(), logicalCpuCount: os.cpus().length }),
  samples = [],
  timestamp = () => new Date().toISOString(),
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  if (!Array.isArray(samples)) throw new TypeError('host samples must be an array');
  assertQuietHostPolicy({ ceiling, maxWaitMs, pollMs });
  const budget = { remainingWaitMs: maxWaitMs, totalWaitedMs: 0 };
  let benchmarkWorkStarted = false;
  return {
    admit(context) {
      return waitForQuietHost(samples, ceiling, {
        budget,
        context,
        maxWaitMs,
        phase: benchmarkWorkStarted ? 'quiet-host-settle' : 'quiet-host-admission',
        pollMs,
        posture: benchmarkWorkStarted ? 'post-benchmark' : 'pre-benchmark',
        readLoad,
        timestamp,
        wait,
      });
    },
    markBenchmarkWork() {
      benchmarkWorkStarted = true;
    },
    policy() {
      return {
        ceiling,
        maxTotalWaitMs: maxWaitMs,
        pollMs,
        remainingWaitMs: budget.remainingWaitMs,
        totalWaitedMs: budget.totalWaitedMs,
      };
    },
  };
}

export async function waitForQuietHost(
  samples,
  ceiling,
  {
    budget,
    context = 'server',
    maxWaitMs = DEFAULT_HOST_SETTLE_MAX_MS,
    phase = 'quiet-host-settle',
    pollMs = DEFAULT_HOST_SETTLE_POLL_MS,
    posture = 'post-benchmark',
    readLoad = () => ({ loadAverage: os.loadavg(), logicalCpuCount: os.cpus().length }),
    timestamp = () => new Date().toISOString(),
    wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = {},
) {
  if (!Array.isArray(samples)) throw new TypeError('host samples must be an array');
  assertQuietHostPolicy({ ceiling, maxWaitMs, pollMs });
  if (
    budget !== undefined &&
    (!Number.isFinite(budget.remainingWaitMs) ||
      budget.remainingWaitMs < 0 ||
      !Number.isFinite(budget.totalWaitedMs) ||
      budget.totalWaitedMs < 0)
  ) {
    throw new TypeError('quiet-host total wait budget is invalid');
  }
  if (!boundedComparisonLabel(context)) throw new TypeError('quiet-host context is invalid');
  const availableWaitMs = Math.min(maxWaitMs, budget?.remainingWaitMs ?? maxWaitMs);
  const observations = [];
  let waitedMs = 0;
  let attempt = 0;
  while (true) {
    const observed = readLoad();
    const loadAverage = observed.loadAverage;
    const logicalCpuCount = observed.logicalCpuCount;
    const loadPerCpu =
      Array.isArray(loadAverage) &&
      Number.isFinite(loadAverage[0]) &&
      Number.isSafeInteger(logicalCpuCount) &&
      logicalCpuCount > 0
        ? loadAverage[0] / logicalCpuCount
        : null;
    const observation = {
      at: timestamp(),
      attempt,
      context,
      loadAverage,
      loadPerCpu,
      logicalCpuCount,
      phase,
      posture,
      waitedMs,
    };
    observations.push(observation);
    const comparable = Number.isFinite(loadPerCpu) && loadPerCpu >= 0 && loadPerCpu <= ceiling;
    if (comparable || waitedMs >= availableWaitMs) {
      const sample = {
        ...observation,
        ceiling,
        comparable,
        settle: {
          maxWaitMs: availableWaitMs,
          observations,
          pollMs,
          rejectedObservations: observations.filter(
            (entry) =>
              !Number.isFinite(entry.loadPerCpu) ||
              entry.loadPerCpu < 0 ||
              entry.loadPerCpu > ceiling,
          ).length,
          totalBudgetRemainingMs: budget?.remainingWaitMs ?? Math.max(0, maxWaitMs - waitedMs),
          waitedMs,
        },
      };
      samples.push(sample);
      return sample;
    }
    const remainingMs = availableWaitMs - waitedMs;
    const waitMs = Math.min(pollMs, remainingMs);
    await wait(waitMs);
    waitedMs += waitMs;
    if (budget !== undefined) {
      budget.remainingWaitMs = Math.max(0, budget.remainingWaitMs - waitMs);
      budget.totalWaitedMs += waitMs;
    }
    attempt += 1;
  }
}

/** Compatibility export for focused consumers of the former server-only settling helper. */
export function waitForServerHost(samples, ceiling, options = {}) {
  return waitForQuietHost(samples, ceiling, {
    ...options,
    phase: 'server-quiet-host-settle',
    posture: 'post-benchmark',
  });
}

function quietHostFailure(sample) {
  const observed = Number.isFinite(sample.loadPerCpu)
    ? sample.loadPerCpu.toFixed(3)
    : 'unavailable';
  return `${sample.posture} host load ${observed} per CPU exceeded ceiling ${String(
    sample.ceiling,
  )} after bounded ${String(sample.settle?.waitedMs ?? 0)}ms quiet-host admission`;
}

function assertQuietHostPolicy({ ceiling, maxWaitMs, pollMs }) {
  if (!Number.isFinite(ceiling) || ceiling <= 0) throw new TypeError('host ceiling is invalid');
  if (!Number.isSafeInteger(maxWaitMs) || maxWaitMs < 0 || maxWaitMs > MAX_HOST_SETTLE_MAX_MS) {
    throw new TypeError(
      `quiet-host total settle max must be between 0 and ${String(MAX_HOST_SETTLE_MAX_MS)}ms`,
    );
  }
  if (!Number.isSafeInteger(pollMs) || pollMs < 10 || pollMs > 60_000) {
    throw new TypeError('quiet-host settle poll must be between 10 and 60000ms');
  }
}

function comparisonQuietHostPolicy(options) {
  const maxWaitMs =
    options.hostSettleMaxMs ?? options.serverHostSettleMaxMs ?? DEFAULT_HOST_SETTLE_MAX_MS;
  const pollMs =
    options.hostSettlePollMs ?? options.serverHostSettlePollMs ?? DEFAULT_HOST_SETTLE_POLL_MS;
  assertQuietHostPolicy({ ceiling: options.maxLoadPerCpu ?? 1, maxWaitMs, pollMs });
  return { maxWaitMs, pollMs };
}

function assertServerMatrixOptions(options) {
  for (const concurrency of options.serverConcurrencies ?? SERVER_CONCURRENCIES)
    assertMember('--server-concurrencies', concurrency, SERVER_CONCURRENCIES);
  for (const encoding of options.serverEncodings ?? SERVER_ENCODINGS)
    assertMember('--server-encodings', encoding, SERVER_ENCODINGS);
  for (const mode of options.serverModes ?? SERVER_MODES)
    assertMember('--server-modes', mode, SERVER_MODES);
  for (const route of options.serverRoutes ?? SERVER_ROUTES)
    assertMember('--server-routes', route, SERVER_ROUTES);
  serverSampleSchedule(options.serverSamples ?? 7);
}

async function runAdapter({ args, cwd, label }) {
  await runChildProcess({ args, command: process.execPath, cwd, label });
}

/**
 * Preserve a failed browser adapter's exact report before comparison scratch cleanup. The browser
 * runner writes its partial result before rejecting, so per-metric Lighthouse failures and the
 * pinned browser identity remain inspectable instead of collapsing into one parent error string.
 */
export async function runBrowserComparisonAdapterCell(options, dependencies = {}) {
  const executeAdapter = dependencies.runAdapter ?? runAdapter;
  let processFailure = null;
  try {
    await executeAdapter(options.adapter);
  } catch (error) {
    processFailure = error;
  }

  const raw = await readComparisonAdapterReport(options.resultFile);
  const app = raw.report?.apps?.[0];
  const reportFailure =
    raw.error === null &&
    (raw.report?.schema !== BROWSER_BENCHMARK_SCHEMA ||
      raw.report?.adapterFailure !== null ||
      raw.report?.apps?.length !== 1 ||
      app?.integrity?.complete !== true ||
      !Array.isArray(app?.integrity?.errors) ||
      app.integrity.errors.length > 0)
      ? 'browser adapter report is not measured and complete'
      : null;
  const failed = processFailure !== null || raw.error !== null || reportFailure !== null;
  const cell = { ...options.cell, report: raw.report };
  if (!failed) return { cell, error: null };

  const retained = await retainComparisonAdapterReport(raw, options);
  cell.adapterFailure = validateComparisonAdapterFailure({
    process: comparisonProcessEvidence(processFailure),
    rawReport: {
      available: raw.custody.available,
      parseError: raw.parseError,
      reportBytes: raw.custody.reportBytes,
      reportSha256: raw.custody.reportSha256,
      retainedPath: retained.path,
      retentionError: retained.error,
      schema: optionalComparisonLabel(raw.report?.schema),
      verdict: optionalComparisonLabel(raw.report?.adapterFailure?.schema),
    },
    schema: COMPARE_ADAPTER_FAILURE_SCHEMA,
  });
  const reasons = [
    processFailure === null ? null : errorMessage(processFailure),
    raw.error,
    reportFailure,
    retained.error === null ? null : `failed adapter raw-report retention: ${retained.error}`,
  ].filter((value) => typeof value === 'string' && value.length > 0);
  return {
    cell,
    error: boundedComparisonDiagnostic(
      reasons.join('; ') || 'browser adapter evidence is incomplete',
    ),
  };
}

/**
 * Keep a failed dev adapter as an explicit scheduled cell. In particular, a nonzero adapter often
 * leaves the most useful lifecycle report behind; read and retain those exact bytes before the
 * scratch directory is removed.
 */
export async function runDevComparisonAdapterCell(options, dependencies = {}) {
  const executeAdapter = dependencies.runAdapter ?? runAdapter;
  let processFailure = null;
  try {
    await executeAdapter(options.adapter);
  } catch (error) {
    processFailure = error;
  }

  const raw = await readComparisonAdapterReport(options.resultFile);
  const reportFailure =
    raw.error === null &&
    (raw.report?.schema !== DEV_LOOP_REPORT_SCHEMA ||
      raw.report?.integrity?.complete !== true ||
      raw.report?.verdict?.status !== 'measured')
      ? 'dev adapter report is not measured and complete'
      : null;
  const failed = processFailure !== null || raw.error !== null || reportFailure !== null;
  const cell = { ...options.cell, report: raw.report };
  if (!failed) return { cell, error: null };

  const retained = await retainComparisonAdapterReport(raw, options);
  cell.adapterFailure = validateComparisonAdapterFailure({
    process: comparisonProcessEvidence(processFailure),
    rawReport: {
      available: raw.custody.available,
      parseError: raw.parseError,
      reportBytes: raw.custody.reportBytes,
      reportSha256: raw.custody.reportSha256,
      retainedPath: retained.path,
      retentionError: retained.error,
      schema: optionalComparisonLabel(raw.report?.schema),
      verdict: optionalComparisonLabel(raw.report?.verdict?.status),
    },
    schema: COMPARE_ADAPTER_FAILURE_SCHEMA,
  });
  const reasons = [
    processFailure === null ? null : errorMessage(processFailure),
    raw.error,
    reportFailure,
    retained.error === null ? null : `failed adapter raw-report retention: ${retained.error}`,
  ].filter((value) => typeof value === 'string' && value.length > 0);
  return {
    cell,
    error: boundedComparisonDiagnostic(reasons.join('; ') || 'dev adapter evidence is incomplete'),
  };
}

async function retainComparisonAdapterReport(raw, options) {
  let retainedPath = null;
  let retentionError = null;
  if (raw.bytes !== null) {
    try {
      await mkdir(path.dirname(options.retainedFile), { recursive: true });
      await writeFile(options.retainedFile, raw.bytes);
      retainedPath = options.retainedReference;
    } catch (error) {
      retentionError = boundedComparisonDiagnostic(errorMessage(error));
    }
  }
  return { error: retentionError, path: retainedPath };
}

async function readComparisonAdapterReport(resultFile) {
  let bytes;
  try {
    bytes = await readFile(resultFile);
  } catch (error) {
    const message = `comparison adapter report is unavailable: ${errorMessage(error)}`;
    return {
      bytes: null,
      custody: { available: false, reportBytes: null, reportSha256: null },
      error: boundedComparisonDiagnostic(message),
      parseError: null,
      report: null,
    };
  }
  const custody = {
    available: true,
    reportBytes: bytes.byteLength,
    reportSha256: comparisonSha256(bytes),
  };
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_COMPARISON_RAW_REPORT_BYTES) {
    const message = 'comparison adapter report is empty or exceeds its evidence bound';
    return { bytes, custody, error: message, parseError: message, report: null };
  }
  try {
    return {
      bytes,
      custody,
      error: null,
      parseError: null,
      report: JSON.parse(bytes.toString('utf8')),
    };
  } catch (error) {
    const message = boundedComparisonDiagnostic(
      `comparison adapter report is invalid JSON: ${errorMessage(error)}`,
    );
    return { bytes, custody, error: message, parseError: message, report: null };
  }
}

function comparisonProcessEvidence(error) {
  if (error === null) return { error: null, signal: null, status: 0 };
  return {
    error: boundedComparisonDiagnostic(errorMessage(error)),
    signal: optionalComparisonLabel(error?.adapterExit?.signal),
    status: Number.isSafeInteger(error?.adapterExit?.status) ? error.adapterExit.status : null,
  };
}

function validateComparisonAdapterFailure(value) {
  const raw = value?.rawReport;
  const processEvidence = value?.process;
  if (
    value?.schema !== COMPARE_ADAPTER_FAILURE_SCHEMA ||
    processEvidence === null ||
    typeof processEvidence !== 'object' ||
    !(processEvidence.error === null || boundedComparisonLabel(processEvidence.error)) ||
    !(processEvidence.signal === null || boundedComparisonLabel(processEvidence.signal)) ||
    !(processEvidence.status === null || Number.isSafeInteger(processEvidence.status)) ||
    raw === null ||
    typeof raw !== 'object' ||
    typeof raw.available !== 'boolean' ||
    !(raw.parseError === null || boundedComparisonLabel(raw.parseError)) ||
    !(raw.retainedPath === null || boundedComparisonLabel(raw.retainedPath)) ||
    !(raw.retentionError === null || boundedComparisonLabel(raw.retentionError)) ||
    !(raw.schema === null || boundedComparisonLabel(raw.schema)) ||
    !(raw.verdict === null || boundedComparisonLabel(raw.verdict))
  ) {
    throw new TypeError('comparison adapter failure evidence is malformed');
  }
  if (
    raw.available
      ? !Number.isSafeInteger(raw.reportBytes) ||
        raw.reportBytes < 0 ||
        !/^sha256:[0-9a-f]{64}$/u.test(raw.reportSha256 ?? '')
      : raw.reportBytes !== null || raw.reportSha256 !== null || raw.retainedPath !== null
  ) {
    throw new TypeError('comparison adapter raw-report custody is malformed');
  }
  if ((raw.retainedPath === null) !== (raw.retentionError !== null || !raw.available)) {
    throw new TypeError('comparison adapter raw-report retention is ambiguous');
  }
  return structuredClone(value);
}

function boundedComparisonDiagnostic(value) {
  return (
    String(value)
      .replace(/[\r\n\0]+/gu, ' ')
      .slice(0, 1_024) || '<empty>'
  );
}

function boundedComparisonLabel(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 1_024 &&
    !/[\r\n\0]/u.test(value)
  );
}

function optionalComparisonLabel(value) {
  return boundedComparisonLabel(value) ? value : null;
}

function comparisonSha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function runChildProcess({ args, command, cwd, label }) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      detached: process.platform !== 'win32',
      env: process.env,
      stdio: 'inherit',
    });
    child.once('error', (error) => {
      error.adapterExit = { signal: null, status: null };
      reject(error);
    });
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else {
        const error = new Error(`${label} failed (code ${code}, signal ${signal}).`);
        error.adapterExit = {
          signal: signal === null ? null : String(signal),
          status: Number.isSafeInteger(code) ? code : null,
        };
        reject(error);
      }
    });
    const forward = () => {
      if (child.exitCode !== null) return;
      if (process.platform === 'win32') child.kill('SIGTERM');
      else process.kill(-child.pid, 'SIGTERM');
    };
    process.once('SIGINT', forward);
    process.once('SIGTERM', forward);
    child.once('exit', () => {
      process.removeListener('SIGINT', forward);
      process.removeListener('SIGTERM', forward);
    });
  });
}

async function prepareBrowserEntrants() {
  const definitions = [
    {
      artifacts: [path.join(repoRoot, 'benchmarks/kovo/dist/server/server.mjs')],
      command: ['exec', 'pnpm', '--dir', 'benchmarks/kovo', 'run', 'build'],
      framework: 'kovo',
    },
    {
      artifacts: [
        path.join(repoRoot, 'benchmarks/nextjs/.next/standalone/benchmarks/nextjs/server.js'),
      ],
      command: ['exec', 'pnpm', '--dir', 'benchmarks/nextjs', 'run', 'build'],
      framework: 'nextjs',
      generatedInput: path.join(repoRoot, 'benchmarks/nextjs/next-env.d.ts'),
    },
  ];
  const reports = [];
  for (const definition of definitions) {
    const source = collectPerformanceProvenance({ lockFiles, repoRoot });
    const errors = [];
    const generatedSnapshot =
      definition.generatedInput === undefined
        ? undefined
        : await readFile(definition.generatedInput);
    try {
      await runChildProcess({
        args: definition.command,
        command: 'vp',
        cwd: repoRoot,
        label: `browser/prepare/${definition.framework}`,
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    } finally {
      if (definition.generatedInput !== undefined) {
        await writeFile(definition.generatedInput, generatedSnapshot);
      }
    }
    const sourceAfter = collectPerformanceProvenance({ lockFiles, repoRoot });
    const missingArtifacts = definition.artifacts
      .filter((artifact) => !existsSync(artifact))
      .map((artifact) => path.relative(repoRoot, artifact));
    const sourceStable = sameSourceState(source, sourceAfter);
    if (!sourceStable) errors.push('source provenance changed during browser preparation');
    if (missingArtifacts.length > 0) {
      errors.push(`production artifacts are missing: ${missingArtifacts.join(', ')}`);
    }
    reports.push({
      artifacts: definition.artifacts.map((artifact) => path.relative(repoRoot, artifact)),
      framework: definition.framework,
      integrity: {
        complete: errors.length === 0 && !source.dirty,
        errors,
        publishable: !source.dirty,
        sourceStable,
      },
      schema: BROWSER_PREPARE_SCHEMA,
      source,
      sourceAfter,
    });
  }
  return reports;
}

function assertMember(flag, value, allowed) {
  if (!allowed.includes(value)) {
    throw new Error(`${flag} includes ${value}; expected ${allowed.join(', ')}.`);
  }
}

function sameSourceState(left, right) {
  return (
    left.commit === right.commit &&
    JSON.stringify(left.dirtyPaths) === JSON.stringify(right.dirtyPaths) &&
    JSON.stringify(left.locks) === JSON.stringify(right.locks)
  );
}

async function comparatorIntegrity(cells, policy) {
  const reasons = [];
  let serverMatrix = {
    completeSupportedMatrix: true,
    excludedUnsupported: [],
    supported: [],
  };
  const occurrenceCounts = splitAcrossOccurrences(policy.iterations);
  const warmupCounts = splitAcrossOccurrences(policy.warmups);
  const bfcacheCounts = splitAcrossOccurrences(policy.bfcacheIterations);
  const lighthouseCounts = splitAcrossOccurrences(policy.lighthouseRuns);
  const devSchedule = policy.cells.includes('dev')
    ? devSampleSchedule({
        editSamples: policy.devIterations,
        readySamples: policy.devReadyIterations,
        warmups: policy.devWarmups,
      })
    : [];
  const keys = new Map();
  for (const cell of cells) {
    const key = [cell.lane, cell.cell, cell.mode ?? ''].join('/');
    const frameworks = keys.get(key) ?? new Set();
    frameworks.add(cell.framework);
    keys.set(key, frameworks);
  }
  const expected = [];
  for (const cell of policy.cells) {
    const cellLanes =
      cell === 'browser'
        ? policy.lanes
        : cell === 'server'
          ? ['matched-runtime']
          : [`corpus-n${policy.corpusSize}`];
    for (const lane of cellLanes) {
      const modes =
        cell === 'build'
          ? policy.modes
          : cell === 'server'
            ? serverConditions({
                concurrencies: policy.serverConcurrencies,
                encodings: policy.serverEncodings,
                modes: policy.serverModes,
                routes: policy.serverRoutes,
              }).map((condition) => condition.key)
            : [''];
      for (const mode of modes) {
        expected.push([lane, cell, mode].join('/'));
      }
    }
  }
  for (const key of expected) {
    const expectedCell = key.split('/')[1];
    const relevant = cells.filter(
      (cell) => [cell.lane, cell.cell, cell.mode ?? ''].join('/') === key,
    );
    for (const framework of ['kovo', 'nextjs']) {
      const occurrences = relevant.filter((cell) => cell.framework === framework);
      const expectedOccurrences = expectedCell === 'server' ? policy.serverSamples : 2;
      if (occurrences.length !== expectedOccurrences)
        reasons.push(
          `${key}/${framework} did not produce ${String(expectedOccurrences)} occurrences`,
        );
      if (
        occurrences.length === expectedOccurrences &&
        occurrences
          .map((cell) => cell.occurrence)
          .sort((left, right) => left - right)
          .join(',') !== Array.from({ length: expectedOccurrences }, (_, index) => index).join(',')
      ) {
        reasons.push(`${key}/${framework} occurrence identities were incomplete`);
      }
      for (const occurrence of occurrences) {
        const scheduledDev = devSchedule.find(
          (entry) => entry.framework === framework && entry.occurrence === occurrence.occurrence,
        );
        const expectedSamples =
          occurrence.cell === 'dev'
            ? scheduledDev?.editSamples
            : occurrence.cell === 'server'
              ? 1
              : occurrenceCounts[occurrence.occurrence];
        if (occurrence.cell === 'browser') {
          validateBrowserCell(occurrence, {
            bfcache: Math.max(1, bfcacheCounts[occurrence.occurrence]),
            lighthouse: Math.max(1, lighthouseCounts[occurrence.occurrence]),
            measured: expectedSamples,
            fixtureIdentity: policy.fixtureIdentity,
            reasons,
            skipLighthouse: policy.skipLighthouse,
            warmups: warmupCounts[occurrence.occurrence],
          });
        } else if (
          !(occurrence.cell === 'server' && occurrence.report?.support?.status === 'unsupported') &&
          cellSampleCount(occurrence) !== expectedSamples
        ) {
          reasons.push(
            `${key}/${framework}/${occurrence.occurrence} expected ${expectedSamples} raw samples`,
          );
        }
        if (occurrence.cell === 'build') {
          if (occurrence.report?.framework !== framework)
            reasons.push(`${key}/${framework} report identity mismatch`);
          if (occurrence.report?.integrity?.iterations !== expectedSamples)
            reasons.push(`${key}/${framework} iteration policy mismatch`);
          if (occurrence.report?.integrity?.warmups !== warmupCounts[occurrence.occurrence])
            reasons.push(`${key}/${framework} warmup policy mismatch`);
        } else if (occurrence.cell === 'dev') {
          if (scheduledDev === undefined) {
            reasons.push(`${key}/${framework}/${occurrence.occurrence} schedule is unavailable`);
          } else {
            validateDevCell(occurrence, {
              iterations: scheduledDev.editSamples,
              devPortBase: policy.devPortBase,
              readyIterations: scheduledDev.readySamples,
              reasons,
              schedule: scheduledDev,
              warmups: scheduledDev.warmups,
            });
          }
        } else if (occurrence.cell === 'server') {
          validateServerCell(occurrence, { policy, reasons });
        }
      }
    }
    const expectedOrder =
      expectedCell === 'server'
        ? serverSampleSchedule(policy.serverSamples).map((value) => value.framework)
        : EXECUTION_ORDER;
    if (relevant.map((cell) => cell.framework).join(',') !== expectedOrder.join(',')) {
      reasons.push(`${key} execution order did not match ${expectedOrder.join(',')}`);
    }
  }
  if ([...keys.keys()].some((key) => !expected.includes(key)))
    reasons.push('unexpected comparator cell');

  if (policy.cells.includes('server')) {
    serverMatrix = classifyServerMatrixCells(cells, {
      conditionKeys: serverConditions({
        concurrencies: policy.serverConcurrencies,
        encodings: policy.serverEncodings,
        modes: policy.serverModes,
        routes: policy.serverRoutes,
      }).map((condition) => condition.key),
      samples: policy.serverSamples,
    });
    reasons.push(...serverMatrix.findings);
    reasons.push(
      ...serverSemanticMatrixFindings(cells, policy.fixtureIdentity, {
        routes: policy.serverRoutes,
        serverSemanticIdentity: policy.serverSemanticIdentity,
      }),
    );
  }

  const corpusDigests = {};
  if (policy.cells.includes('dev') || policy.cells.includes('build')) {
    for (const finding of packedKovoProductWorkloadPolicyFindings(
      policy.workloadIdentity?.identity?.productArtifactPolicy,
    )) {
      reasons.push(finding);
    }
    if (packedKovoProductIdentityFindings(policy.productArtifact, policy.source).length > 0) {
      reasons.push('packed Kovo product-artifact workload identity is incomplete');
    }
    for (const framework of ['kovo', 'nextjs']) {
      try {
        const manifest = JSON.parse(await readFile(policy.corpusManifests?.[framework], 'utf8'));
        corpusDigests[framework] = manifest.shapeDigest;
      } catch {
        corpusDigests[framework] = null;
        reasons.push(`${framework} corpus manifest is unavailable`);
      }
    }
    if (!corpusDigests.kovo || corpusDigests.kovo !== corpusDigests.nextjs) {
      reasons.push('Kovo/Next corpus shapeDigest mismatch');
    }
  }
  if (policy.cells.includes('browser') || policy.cells.includes('server')) {
    if (
      policy.fixtureIdentity?.schema !== BROWSER_FIXTURE_IDENTITY_SCHEMA ||
      policy.fixtureIdentity?.identity?.schema !== BROWSER_FIXTURE_IDENTITY_SCHEMA ||
      policy.fixtureIdentity?.digest !==
        comparisonSha256(canonicalJson(policy.fixtureIdentity?.identity))
    ) {
      reasons.push('capability-matched fixture workload identity is incomplete');
    }
  }
  if (policy.cells.includes('browser')) {
    for (const framework of ['kovo', 'nextjs']) {
      const preparation = policy.browserPreparation.filter(
        (report) => report.framework === framework,
      );
      const report = preparation[0];
      if (
        preparation.length !== 1 ||
        report?.schema !== BROWSER_PREPARE_SCHEMA ||
        report?.integrity?.complete !== true ||
        report?.source?.commit !== policy.source.commit ||
        !requiredLocksMatch(report?.source?.locks, policy.source.locks) ||
        report?.sourceAfter?.commit !== report?.source?.commit ||
        JSON.stringify(report?.sourceAfter?.locks) !== JSON.stringify(report?.source?.locks) ||
        report?.source?.dirty ||
        report?.sourceAfter?.dirty
      ) {
        reasons.push(`browser/${framework} preparation evidence is incomplete`);
      }
    }
  }
  if (policy.cells.includes('server')) {
    for (const framework of ['kovo', 'nextjs']) {
      const preparation = policy.serverPreparation.filter(
        (report) => report.framework === framework,
      );
      const report = preparation[0];
      if (
        preparation.length !== 1 ||
        report?.schema !== SERVER_PREPARE_SCHEMA ||
        report?.integrity?.complete !== true ||
        report?.source?.commit !== policy.source.commit ||
        !requiredLocksMatch(report?.source?.locks, policy.source.locks) ||
        !validHostFingerprint(report?.host) ||
        report?.sourceAfter?.commit !== report?.source?.commit ||
        JSON.stringify(report?.sourceAfter?.locks) !== JSON.stringify(report?.source?.locks) ||
        report?.source?.dirty ||
        report?.sourceAfter?.dirty
      ) {
        reasons.push(`server/${framework} preparation evidence is incomplete`);
      }
    }
  }

  for (const cell of cells) {
    if (!cell.report?.source) {
      reasons.push(`${cell.lane}/${cell.framework}/${cell.cell} missing source provenance`);
    } else {
      if (cell.report.source.commit !== policy.source.commit)
        reasons.push('cell source commit mismatch');
      if (!requiredLocksMatch(cell.report.source.locks, policy.source.locks)) {
        reasons.push('cell lock provenance mismatch');
      }
      if (cell.report.source.dirty)
        reasons.push(`${cell.lane}/${cell.framework}/${cell.cell} source is dirty`);
    }
    if (cell.cell === 'browser') {
      const samples = browserSamples(cell);
      if (
        samples.some(
          (sample) =>
            sample.errorResponses > 0 ||
            sample.failedRequests > 0 ||
            sample.rateLimitedResponses > 0 ||
            sample.pageErrors > 0 ||
            sample.settleTimedOut > 0 ||
            sample.navSettleTimedOut > 0,
        )
      ) {
        reasons.push(`${cell.lane}/${cell.framework} browser integrity failure`);
      }
    } else if (
      cell.report?.integrity?.complete === false ||
      (cell.report?.integrity?.errors?.length ?? 0) > 0 ||
      (cell.report?.integrity?.misses ?? 0) > 0 ||
      cell.report?.verdict?.status === 'unproven'
    ) {
      reasons.push(`${cell.lane}/${cell.framework}/${cell.mode ?? cell.cell} integrity failure`);
    }
    if (cell.cell === 'build') {
      if (cell.report?.corpus?.shapeDigest !== corpusDigests[cell.framework]) {
        reasons.push(`${cell.lane}/${cell.framework}/${cell.mode} corpus digest mismatch`);
      }
      if (cell.report?.mode !== cell.mode)
        reasons.push(`${cell.lane}/${cell.framework}/${cell.mode} mode mismatch`);
    } else if (cell.cell === 'dev') {
      if (cell.report?.corpus?.shapeDigest !== corpusDigests[cell.framework]) {
        reasons.push(`${cell.lane}/${cell.framework}/dev corpus digest mismatch`);
      }
    }
    if (cell.cell === 'dev' || cell.cell === 'build') {
      reasons.push(...productArtifactCellFindings(cell, policy.productArtifact));
    }
  }
  return {
    corpusDigests,
    matched: reasons.length === 0,
    reasons: [...new Set(reasons)].sort(),
    serverMatrix,
  };
}

export function productArtifactCellFindings(cell, expected) {
  const label = `${cell?.lane ?? 'unknown'}/${cell?.framework ?? 'unknown'}/${
    cell?.mode ?? cell?.cell ?? 'unknown'
  }`;
  if (cell?.framework === 'nextjs') {
    return cell.report?.productArtifact === null &&
      canonicalJson(cell.report?.integrity?.productArtifact) ===
        canonicalJson({ afterVerified: true, beforeVerified: false, required: false })
      ? []
      : [`${label} carried Kovo product evidence`];
  }
  if (cell?.framework !== 'kovo') return [`${label} has an unknown entrant identity`];
  return canonicalJson(cell.report?.productArtifact) === canonicalJson(expected) &&
    cell.report?.integrity?.productArtifact?.required === true &&
    cell.report?.integrity?.productArtifact?.beforeVerified === true &&
    cell.report?.integrity?.productArtifact?.afterVerified === true
    ? []
    : [`${label} packed product evidence is incomplete`];
}

/**
 * Partition the server matrix into paired timing cells and authenticated capability exclusions.
 * Unsupported cells remain in raw evidence but can never contribute numeric samples.
 */
export function classifyServerMatrixCells(cells, { conditionKeys, samples }) {
  const findings = [];
  const supported = [];
  const excludedUnsupported = [];
  for (const condition of conditionKeys) {
    const statuses = {};
    for (const framework of ['kovo', 'nextjs']) {
      const occurrences = cells.filter(
        (cell) =>
          cell.cell === 'server' &&
          cell.lane === 'matched-runtime' &&
          cell.mode === condition &&
          cell.framework === framework,
      );
      if (occurrences.length !== samples) {
        findings.push(
          `matched-runtime/server/${condition}/${framework} support census is incomplete`,
        );
        statuses[framework] = 'incomplete';
        continue;
      }
      const observed = [
        ...new Set(occurrences.map((cell) => cell.report?.support?.status ?? 'missing')),
      ];
      if (observed.length !== 1 || (observed[0] !== 'supported' && observed[0] !== 'unsupported')) {
        findings.push(
          `matched-runtime/server/${condition}/${framework} support status is inconsistent`,
        );
        statuses[framework] = 'incomplete';
      } else {
        statuses[framework] = observed[0];
      }
    }
    if (statuses.kovo === 'supported' && statuses.nextjs === 'supported') {
      supported.push(condition);
    } else if (
      (statuses.kovo === 'supported' || statuses.kovo === 'unsupported') &&
      (statuses.nextjs === 'supported' || statuses.nextjs === 'unsupported') &&
      (statuses.kovo === 'unsupported' || statuses.nextjs === 'unsupported')
    ) {
      excludedUnsupported.push({
        condition,
        unsupportedFrameworks: ['kovo', 'nextjs'].filter(
          (framework) => statuses[framework] === 'unsupported',
        ),
      });
    }
  }
  return {
    completeSupportedMatrix: findings.length === 0,
    excludedUnsupported,
    findings,
    supported,
  };
}

function validateDevCell(cell, expected) {
  const report = cell.report;
  const key = `${cell.lane}/${cell.framework}/dev`;
  if (cell.adapterFailure !== undefined) {
    expected.reasons.push(`${key} adapter process or report failed`);
  }
  if (report?.framework !== cell.framework)
    expected.reasons.push(`${key} report identity mismatch`);
  if (report?.integrity?.complete !== true || report?.verdict?.status !== 'measured') {
    expected.reasons.push(`${key} adapter evidence is unproven`);
  }
  if (report?.integrity?.iterations !== expected.iterations)
    expected.reasons.push(`${key} iteration policy mismatch`);
  if (report?.integrity?.readyIterations !== expected.readyIterations)
    expected.reasons.push(`${key} ready iteration policy mismatch`);
  if (report?.integrity?.warmups !== expected.warmups)
    expected.reasons.push(`${key} warmup policy mismatch`);
  if (report?.readySamples?.length !== expected.readyIterations)
    expected.reasons.push(`${key} ready sample count mismatch`);
  if (JSON.stringify(cell.schedule) !== JSON.stringify(expected.schedule)) {
    expected.reasons.push(`${key} occurrence schedule mismatch`);
  }
  const basePort = expected.devPortBase + expected.schedule.scheduleIndex * DEV_SESSION_PORT_STRIDE;
  expected.reasons.push(
    ...devSessionHandoffFindings(report, {
      basePort,
      readyIterations: expected.readyIterations,
    }).map((finding) => `${key} ${finding}`),
  );
  if (
    report?.sourceAfter?.commit !== report?.source?.commit ||
    JSON.stringify(report?.sourceAfter?.locks) !== JSON.stringify(report?.source?.locks) ||
    report?.sourceAfter?.dirty ||
    report?.integrity?.source?.stable !== true
  ) {
    expected.reasons.push(`${key} source stability failure`);
  }
  const editClasses = ['leaf', 'entry', 'data', 'syntaxError', 'recovery'];
  for (const editClass of editClasses) {
    if (report?.integrity?.editCounts?.[editClass] !== expected.iterations) {
      expected.reasons.push(`${key} ${editClass} count mismatch`);
    }
  }
  if (
    report?.integrity?.browser?.unexpectedErrorCount !== 0 ||
    report?.integrity?.browser?.requestFailedCount !== 0 ||
    !(report?.integrity?.browser?.responseCount > 0)
  ) {
    expected.reasons.push(`${key} browser error evidence`);
  }
}

export function validateServerCell(cell, expected) {
  const report = cell.report;
  const key = `${cell.lane}/${cell.framework}/${cell.mode}`;
  if (report?.schema !== SERVER_BENCHMARK_SCHEMA)
    expected.reasons.push(`${key} report schema mismatch`);
  if (report?.framework !== cell.framework)
    expected.reasons.push(`${key} report identity mismatch`);
  if (report?.condition?.key !== cell.mode)
    expected.reasons.push(`${key} condition identity mismatch`);
  const unsupported = report?.support?.status === 'unsupported';
  for (const finding of serverRawMetricCensusFindings(report, {
    samples: unsupported ? 0 : 1,
    support: unsupported ? 'unsupported' : 'supported',
  })) {
    expected.reasons.push(`${key} ${finding}`);
  }
  for (const finding of serverSemanticEvidenceFindings(
    report?.correctness,
    report?.condition?.route,
  )) {
    expected.reasons.push(`${key} ${finding}`);
  }
  if (unsupported) {
    const correctness = report?.correctness;
    if (
      cell.framework !== 'nextjs' ||
      report?.condition?.encoding !== 'br' ||
      report?.integrity?.complete !== true ||
      report?.integrity?.timingExcluded !== true ||
      report?.integrity?.misses !== 0 ||
      (report?.integrity?.errors?.length ?? -1) !== 0 ||
      report?.verdict?.status !== 'unsupported' ||
      report?.samples?.length !== 0 ||
      report?.support?.requestedContentEncoding !== 'br' ||
      report?.support?.observedContentEncoding !== null ||
      report?.support?.reason !== 'requested Brotli returned the identity representation' ||
      correctness?.status !== 200 ||
      correctness?.requestAcceptEncoding !== 'br' ||
      correctness?.requestIfNoneMatch !== null ||
      correctness?.contentEncoding !== null ||
      correctness?.bodySha256 !== correctness?.wireBodySha256 ||
      correctness?.bodyBytes !== correctness?.wireBodyBytes ||
      !/^sha256:[0-9a-f]{64}$/u.test(correctness?.bodySha256 ?? '') ||
      !correctness?.exactResponseHeaders ||
      correctness?.identityResponse?.status !== 200 ||
      correctness?.selectedResponse?.status !== 200 ||
      correctness?.selectedResponse?.contentEncoding !== null ||
      correctness?.selectedResponse?.bodySha256 !== correctness?.bodySha256
    ) {
      expected.reasons.push(`${key} unsupported response proof failure`);
    }
  } else {
    if (
      report?.support?.status !== 'supported' ||
      report?.integrity?.complete !== true ||
      report?.integrity?.timingExcluded !== false ||
      report?.verdict?.status !== 'measured'
    ) {
      expected.reasons.push(`${key} report is unproven`);
    }
    if (
      report?.integrity?.misses !== 0 ||
      report?.samples?.length !== 1 ||
      report.samples[0]?.misses !== 0 ||
      report.samples[0]?.failedRequests !== 0 ||
      !(report.samples[0]?.requests > 0) ||
      !(report.samples[0]?.reusedSockets > 0)
    ) {
      expected.reasons.push(`${key} request integrity failure`);
    }
    if (
      report?.correctness?.status !== (report?.condition?.mode === '304' ? 304 : 200) ||
      !/^sha256:[0-9a-f]{64}$/u.test(report?.correctness?.bodySha256 ?? '') ||
      !report?.correctness?.exactResponseHeaders ||
      (report?.condition?.encoding === 'br' &&
        report?.condition?.mode !== '304' &&
        report?.correctness?.contentEncoding !== 'br')
    ) {
      expected.reasons.push(`${key} response proof failure`);
    }
  }
  if (
    report?.condition?.concurrency !== cell.serverCondition?.concurrency ||
    report?.condition?.encoding !== cell.serverCondition?.encoding ||
    report?.condition?.mode !== cell.serverCondition?.mode ||
    report?.condition?.route !== cell.serverCondition?.route
  ) {
    expected.reasons.push(`${key} scheduled condition mismatch`);
  }
  if (
    report?.optimization?.provedDocumentCompressionCache !==
    (cell.framework === 'kovo' ? 'enabled' : 'not-applicable')
  ) {
    expected.reasons.push(`${key} optimization posture mismatch`);
  }
  if (
    report?.policy?.durationMs !== expected.policy.serverDurationMs ||
    report?.policy?.warmupMs !== expected.policy.serverWarmupMs ||
    (!unsupported &&
      (report?.samples?.[0]?.durationMs < expected.policy.serverDurationMs ||
        report?.samples?.[0]?.processTreeSamples < 1 ||
        !(report?.samples?.[0]?.peakRssBytes > 0) ||
        !Number.isFinite(report?.samples?.[0]?.serverCpuPercent)))
  ) {
    expected.reasons.push(`${key} timing/CPU/RSS evidence failure`);
  }
  if (
    report?.sourceAfter?.commit !== report?.source?.commit ||
    JSON.stringify(report?.sourceAfter?.locks) !== JSON.stringify(report?.source?.locks) ||
    report?.sourceAfter?.dirty ||
    report?.integrity?.sourceStable !== true
  ) {
    expected.reasons.push(`${key} source stability failure`);
  }
  if (!validHostFingerprint(report?.environment?.host)) {
    expected.reasons.push(`${key} host fingerprint failure`);
  }
}

/** Fail closed when a supported server occurrence omits any plan-owned metric. */
export function serverRawMetricCensusFindings(report, expected) {
  const findings = [];
  if (report?.support?.status !== expected.support) {
    findings.push(`support posture must be explicit ${expected.support}`);
  }
  if (!Array.isArray(report?.samples) || report.samples.length !== expected.samples) {
    findings.push(`raw metric census expected ${String(expected.samples)} samples`);
    return findings;
  }
  if (expected.support === 'unsupported') return findings;
  for (const [index, sample] of report.samples.entries()) {
    const where = `samples[${String(index)}]`;
    for (const name of [
      'requestsPerSecond',
      'p50Ms',
      'p95Ms',
      'p99Ms',
      'serverCpuMs',
      'serverCpuPercent',
      'peakRssBytes',
    ]) {
      if (!finiteNonNegative(sample?.[name])) findings.push(`${where}.${name} is absent`);
    }
    if (!(sample?.peakRssBytes > 0)) findings.push(`${where}.peakRssBytes is not positive`);
    if (!(sample?.requests > 0)) findings.push(`${where}.requests is not positive`);
    if (
      finiteNonNegative(sample?.p50Ms) &&
      finiteNonNegative(sample?.p95Ms) &&
      finiteNonNegative(sample?.p99Ms) &&
      !(sample.p50Ms <= sample.p95Ms && sample.p95Ms <= sample.p99Ms)
    ) {
      findings.push(`${where} latency quantiles are not monotone`);
    }
  }
  return [...new Set(findings)];
}

export function serverSemanticEvidenceFindings(correctness, route) {
  const semantic = correctness?.semanticContent;
  const findings = [];
  let expectedContractDigest = null;
  try {
    expectedContractDigest = comparisonSha256(canonicalJson(matchedServerSemanticContract(route)));
  } catch {
    findings.push('semantic route identity is unsupported');
  }
  if (
    semantic?.schema !== MATCHED_SERVER_SEMANTIC_EVIDENCE_SCHEMA ||
    semantic?.validated !== true ||
    semantic?.route !== route ||
    semantic?.identityBodySha256 !== correctness?.bodySha256
  ) {
    findings.push('semantic identity-body evidence is incomplete');
  }
  if (
    semantic?.contract?.schema !== MATCHED_SERVER_SEMANTIC_CONTRACT_SCHEMA ||
    !validSha256(semantic?.contract?.sha256) ||
    semantic?.contract?.sha256 !== expectedContractDigest ||
    !Number.isSafeInteger(semantic?.contract?.tokenCount) ||
    semantic.contract.tokenCount < 1 ||
    semantic?.evidence?.sha256 !== semantic?.contract?.sha256 ||
    semantic?.evidence?.tokenCount !== semantic?.contract?.tokenCount
  ) {
    findings.push('semantic contract/evidence digest is incomplete');
  }
  const sourceFiles = semantic?.source?.files;
  const expectedPaths = [
    'benchmarks/shared/catalog.json',
    'benchmarks/shared/matched-fixture.json',
    'benchmarks/shared/server-semantic-contract.mjs',
  ];
  if (
    semantic?.source?.schema !== MATCHED_SERVER_SEMANTIC_SOURCE_SCHEMA ||
    !Array.isArray(sourceFiles) ||
    sourceFiles.map((file) => file?.path).join(',') !== expectedPaths.join(',') ||
    sourceFiles.some(
      (file) => !Number.isSafeInteger(file?.bytes) || file.bytes < 1 || !validSha256(file?.sha256),
    ) ||
    semantic?.source?.sha256 !== comparisonSha256(canonicalJson(sourceFiles)) ||
    canonicalJson(semantic?.source) !== canonicalJson(MATCHED_SERVER_SEMANTIC_SOURCE)
  ) {
    findings.push('semantic source identity is incomplete');
  }
  return findings;
}

export function serverSemanticMatrixFindings(
  cells,
  fixtureIdentity,
  { routes = ['listing', 'detail'], serverSemanticIdentity } = {},
) {
  const findings = [];
  const serverCells = cells.filter((cell) => cell.cell === 'server');
  if (serverCells.length === 0) return findings;
  const sourceDigests = new Set();
  for (const route of routes) {
    const routeCells = serverCells.filter((cell) => cell.report?.condition?.route === route);
    const contracts = new Set();
    for (const cell of routeCells) {
      const semantic = cell.report?.correctness?.semanticContent;
      if (validSha256(semantic?.contract?.sha256)) contracts.add(semantic.contract.sha256);
      if (validSha256(semantic?.source?.sha256)) sourceDigests.add(semantic.source.sha256);
    }
    if (
      routeCells.length === 0 ||
      contracts.size !== 1 ||
      !contracts.has(serverSemanticIdentity?.contracts?.[route]?.sha256)
    ) {
      findings.push(`matched-runtime/server/${route} cross-entrant semantic contract mismatch`);
    }
  }
  if (
    sourceDigests.size !== 1 ||
    !sourceDigests.has(serverSemanticIdentity?.source?.sha256) ||
    canonicalJson(serverSemanticIdentity?.source) !== canonicalJson(MATCHED_SERVER_SEMANTIC_SOURCE)
  ) {
    findings.push('matched-runtime/server semantic source identity mismatch');
  }
  const firstSource = serverCells[0]?.report?.correctness?.semanticContent?.source?.files;
  const fixtureFiles = fixtureIdentity?.identity?.authority;
  if (
    !Array.isArray(firstSource) ||
    firstSource.find(({ path: filePath }) => filePath === 'benchmarks/shared/catalog.json')
      ?.sha256 !== fixtureFiles?.['shared/catalog.json']?.sha256 ||
    firstSource.find(({ path: filePath }) => filePath === 'benchmarks/shared/matched-fixture.json')
      ?.sha256 !== fixtureFiles?.['shared/matched-fixture.json']?.sha256
  ) {
    findings.push(
      'matched-runtime/server semantic source does not match workload fixture identity',
    );
  }
  return findings;
}

function validateBrowserCell(cell, expected) {
  if (cell.adapterFailure !== undefined) {
    expected.reasons.push(
      `${cell.lane}/${cell.framework} browser adapter process or report failed`,
    );
  }
  if (cell.report?.schema !== BROWSER_BENCHMARK_SCHEMA)
    expected.reasons.push(`${cell.lane}/${cell.framework} browser report schema mismatch`);
  if (cell.report?.apps?.length !== 1)
    expected.reasons.push(`${cell.lane}/${cell.framework} expected exactly one app report`);
  const app = cell.report?.apps?.[0];
  if (app?.app !== cell.framework)
    expected.reasons.push(`${cell.lane}/${cell.framework} app identity mismatch`);
  const expectedFramework = cell.framework === 'kovo' ? 'Kovo' : 'Next.js App Router';
  if (app?.framework !== expectedFramework)
    expected.reasons.push(`${cell.lane}/${cell.framework} framework identity mismatch`);
  if (cell.report?.lane !== cell.lane)
    expected.reasons.push(`${cell.lane}/${cell.framework} lane identity mismatch`);
  if (cell.report?.iterations !== expected.measured)
    expected.reasons.push(`${cell.lane}/${cell.framework} iteration policy mismatch`);
  if (cell.report?.warmups !== expected.warmups)
    expected.reasons.push(`${cell.lane}/${cell.framework} warmup policy mismatch`);
  if (app?.posture?.nodeEnv !== 'production')
    expected.reasons.push(`${cell.lane}/${cell.framework} production posture mismatch`);
  const listingPath =
    cell.lane === 'default' ? '/' : cell.lane === 'matched-l0' ? '/matched/l0' : '/matched/l1';
  const selectedScenarios =
    cell.lane === 'matched-l0'
      ? ['coldLoad', 'navigation']
      : ['coldLoad', 'ttiProbe', 'navigation'];
  for (const finding of browserReportIntegrityFindings(app, {
    bfcacheIterations: expected.bfcache,
    iterations: expected.measured,
    lighthouseRepeats: expected.skipLighthouse ? 0 : expected.lighthouse,
    listingPath,
    scenarios: selectedScenarios,
    warmups: expected.warmups,
  })) {
    expected.reasons.push(`${cell.lane}/${cell.framework} ${finding}`);
  }
  for (const finding of browserRawMetricCensusFindings(app, {
    bfcacheIterations: expected.bfcache,
    iterations: expected.measured,
    lighthouseRepeats: expected.skipLighthouse ? 0 : expected.lighthouse,
    scenarios: selectedScenarios,
    skipLighthouse: expected.skipLighthouse,
  })) {
    expected.reasons.push(`${cell.lane}/${cell.framework} ${finding}`);
  }
  try {
    if (new URL(app?.origin).hostname !== 'localhost')
      expected.reasons.push(`${cell.lane}/${cell.framework} hostname mismatch`);
  } catch {
    expected.reasons.push(`${cell.lane}/${cell.framework} origin is invalid`);
  }
  const expectedScenarios =
    cell.lane === 'matched-l0'
      ? { coldLoad: expected.measured, navigation: expected.measured, ttiProbe: 0 }
      : {
          coldLoad: expected.measured,
          navigation: expected.measured,
          ttiProbe: expected.measured,
        };
  for (const conditionName of ['desktop', 'mobile']) {
    const condition = app?.conditions?.[conditionName];
    for (const [scenarioName, sampleCount] of Object.entries(expectedScenarios)) {
      const samples = condition?.[scenarioName]?.iterations;
      if (!Array.isArray(samples) || samples.length !== sampleCount) {
        expected.reasons.push(
          `${cell.lane}/${cell.framework}/${conditionName}/${scenarioName} expected ${sampleCount} samples`,
        );
        continue;
      }
      if (
        scenarioName === 'coldLoad' &&
        samples.some((sample) => !fixtureProof(sample, cell, expected.fixtureIdentity))
      ) {
        expected.reasons.push(
          `${cell.lane}/${cell.framework}/${conditionName} fixture proof failed`,
        );
      }
      if (
        scenarioName === 'ttiProbe' &&
        samples.some((sample) => !ttiInteractionProof(sample, cell.lane))
      ) {
        expected.reasons.push(
          `${cell.lane}/${cell.framework}/${conditionName} interaction proof failed`,
        );
      }
      if (
        scenarioName === 'navigation' &&
        samples.some(
          (sample) =>
            sample.navPaintBoundary !== 'first-traced-frame-after-destination-marker' ||
            !Number.isFinite(sample.navToPaintMs) ||
            !Number.isFinite(sample.traceMarkerEpochSkewMs) ||
            Math.abs(sample.traceMarkerEpochSkewMs) > 250 ||
            navigationAttributionFindings(sample.navAttribution).length > 0 ||
            sessionBytePhaseFindings(sample.sessionBytes).length > 0 ||
            !Number.isFinite(sample.sessionBytes?.throughClick?.total) ||
            !Number.isFinite(sample.sessionBytes?.throughDestinationPaint?.total),
        )
      ) {
        expected.reasons.push(
          `${cell.lane}/${cell.framework}/${conditionName} navigation proof failed`,
        );
      }
    }
  }
  if (!expected.skipLighthouse) {
    if (app?.lighthouse?.length !== 4)
      expected.reasons.push(`${cell.lane}/${cell.framework} Lighthouse cells incomplete`);
    const productPath = `${listingPath === '/' ? '' : listingPath}/product/linen-field-jacket`;
    const expectedCells = new Set([
      `desktop:${listingPath}`,
      `desktop:${productPath}`,
      `mobile:${listingPath}`,
      `mobile:${productPath}`,
    ]);
    const actualCells = new Set(
      (app?.lighthouse ?? []).map((entry) => `${entry.formFactor}:${entry.path}`),
    );
    if (
      actualCells.size !== expectedCells.size ||
      [...expectedCells].some((identity) => !actualCells.has(identity))
    ) {
      expected.reasons.push(`${cell.lane}/${cell.framework} Lighthouse identity mismatch`);
    }
    for (const lighthouse of app?.lighthouse ?? []) {
      if (
        lighthouse.repeats !== expected.lighthouse ||
        lighthouse.samples?.length !== expected.lighthouse
      )
        expected.reasons.push(`${cell.lane}/${cell.framework} Lighthouse repeats mismatch`);
      if (Object.values(lighthouse.nullSamples ?? {}).some((value) => value !== 0))
        expected.reasons.push(`${cell.lane}/${cell.framework} Lighthouse null sample`);
      if (Object.values(lighthouse.metrics ?? {}).some((value) => !Number.isFinite(value)))
        expected.reasons.push(`${cell.lane}/${cell.framework} Lighthouse metric missing`);
      if (
        lighthouse.network?.tracked !== true ||
        lighthouse.network.errorResponses > 0 ||
        lighthouse.network.rateLimitedResponses > 0
      )
        expected.reasons.push(
          `${cell.lane}/${cell.framework} Lighthouse network integrity failure`,
        );
    }
  } else if ((app?.lighthouse?.length ?? 0) !== 0) {
    expected.reasons.push(`${cell.lane}/${cell.framework} unexpected Lighthouse cells`);
  }
  if (app?.bfcache?.available !== true || app?.bfcache?.iterations?.length !== expected.bfcache) {
    expected.reasons.push(`${cell.lane}/${cell.framework} bfcache sample mismatch`);
  }
  for (const sample of app?.bfcache?.iterations ?? []) {
    if (
      sample.evidenceComplete !== true ||
      bfcacheIterationFindings(sample, { listingPath }).length > 0 ||
      !(sample.network?.requests > 0)
    ) {
      expected.reasons.push(`${cell.lane}/${cell.framework} bfcache proof incomplete`);
    }
    if (
      sample.network?.errorResponses !== 0 ||
      sample.network?.failedRequests !== 0 ||
      sample.network?.pageErrors !== 0 ||
      sample.network?.rateLimitedResponses !== 0
    ) {
      expected.reasons.push(`${cell.lane}/${cell.framework} bfcache network integrity failure`);
    }
  }
  const bfcacheIterations = app?.bfcache?.iterations ?? [];
  const applicable = bfcacheIterations.filter((sample) => sample.applicable);
  const restored = applicable.filter((sample) => sample.restored);
  const aggregateReasons = [
    ...new Set(bfcacheIterations.flatMap((sample) => sample.notRestoredReasons ?? [])),
  ].sort();
  if (
    app?.bfcache?.applicableCount !== applicable.length ||
    app?.bfcache?.restoredCount !== restored.length ||
    app?.bfcache?.restoredRate !==
      (applicable.length === 0 ? null : restored.length / applicable.length) ||
    JSON.stringify(app?.bfcache?.notRestoredReasons) !== JSON.stringify(aggregateReasons)
  ) {
    expected.reasons.push(`${cell.lane}/${cell.framework} bfcache aggregate mismatch`);
  }
}

export function browserReportIntegrityFindings(app, expected) {
  const findings = [];
  if (app?.integrity?.complete !== true) findings.push('browser integrity verdict is incomplete');
  if (!Array.isArray(app?.integrity?.errors) || app.integrity.errors.length > 0) {
    findings.push('browser integrity errors are present or unavailable');
  }
  for (const [name, value] of Object.entries(expected)) {
    const actual = app?.integrity?.policy?.[name];
    if (JSON.stringify(actual) !== JSON.stringify(value)) {
      findings.push(`browser integrity policy ${name} mismatch`);
    }
  }
  return findings;
}

/**
 * Exact raw browser metric census owned by plans/good-perf.md. Generic numeric flattening is for
 * analysis only; it cannot establish that a required metric was measured in every raw sample.
 */
export function browserRawMetricCensusFindings(app, expected) {
  const findings = [];
  const selectedScenarios = new Set(expected.scenarios);
  for (const conditionName of ['desktop', 'mobile']) {
    const condition = app?.conditions?.[conditionName];
    if (!condition) {
      findings.push(`${conditionName} condition is absent from the raw metric census`);
      continue;
    }
    for (const scenarioName of ['coldLoad', 'ttiProbe', 'navigation']) {
      const samples = condition?.[scenarioName]?.iterations;
      const expectedCount = selectedScenarios.has(scenarioName) ? expected.iterations : 0;
      if (!Array.isArray(samples) || samples.length !== expectedCount) {
        findings.push(
          `${conditionName}/${scenarioName} raw metric census expected ${String(expectedCount)} samples`,
        );
        continue;
      }
      for (const [index, sample] of samples.entries()) {
        const where = `${conditionName}/${scenarioName}[${String(index)}]`;
        if (
          scenarioName === 'coldLoad' &&
          (!finiteNonNegative(sample?.fcpMs) || !finiteNonNegative(sample?.lcpMs))
        ) {
          findings.push(`${where} cold FCP/LCP census is incomplete`);
        }
        if (scenarioName === 'navigation') {
          if (
            sample?.navPaintBoundary !== 'first-traced-frame-after-destination-marker' ||
            !finiteNonNegative(sample?.navToPaintMs)
          ) {
            findings.push(`${where} navigation-to-paint census is incomplete`);
          }
          for (const finding of navigationAttributionFindings(sample?.navAttribution)) {
            findings.push(`${where} ${finding}`);
          }
          for (const finding of sessionBytePhaseFindings(sample?.sessionBytes)) {
            findings.push(`${where} ${finding}`);
          }
        }
      }
    }
  }

  const lighthouse = app?.lighthouse;
  if (expected.skipLighthouse) {
    if (!Array.isArray(lighthouse) || lighthouse.length !== 0) {
      findings.push('unexpected Lighthouse raw metric cells');
    }
  } else if (!Array.isArray(lighthouse) || lighthouse.length !== 4) {
    findings.push('Lighthouse raw metric census expected four cells');
  } else {
    const browserIdentities = new Set();
    for (const [index, cell] of lighthouse.entries()) {
      const where = `Lighthouse[${String(index)}]`;
      const browserFindings = lighthouseBrowserIdentityFindings(cell?.browser);
      if (browserFindings.length > 0) {
        findings.push(`${where} ${browserFindings.join('; ')}`);
      } else {
        browserIdentities.add(JSON.stringify(cell.browser));
      }
      for (const finding of lighthouseTimeoutPolicyFindings(cell?.policy)) {
        findings.push(`${where} ${finding}`);
      }
      if (!Array.isArray(cell?.failures)) {
        findings.push(`${where} sample failure evidence is absent`);
      } else if (cell.failures.length > 0) {
        findings.push(`${where} contains failed Lighthouse samples`);
        for (const failure of cell.failures) {
          for (const malformed of lighthouseSampleFailureFindings(failure)) {
            findings.push(`${where} ${malformed}`);
          }
        }
      }
      if (
        cell?.repeats !== expected.lighthouseRepeats ||
        cell?.samples?.length !== expected.lighthouseRepeats
      ) {
        findings.push(`${where} raw sample count mismatch`);
        continue;
      }
      for (const name of LIGHTHOUSE_METRIC_KEYS) {
        if (
          !finiteNonNegative(cell.metrics?.[name]) ||
          !finiteNonNegative(cell.spread?.[name]) ||
          cell.nullSamples?.[name] !== 0 ||
          cell.samples.some((sample) => !finiteNonNegative(sample?.[name]))
        ) {
          findings.push(`${where}.${name} raw metric census is incomplete`);
        }
      }
    }
    if (browserIdentities.size !== 1) {
      findings.push('Lighthouse browser identity differs across raw cells');
    }
    const lighthouseVersion = lighthouse[0]?.browser?.version;
    if (typeof lighthouseVersion !== 'string' || app?.bfcache?.browser !== lighthouseVersion) {
      findings.push('Lighthouse browser version differs from the Playwright bfcache browser');
    }
  }
  if (
    app?.bfcache?.available !== true ||
    app?.bfcache?.iterations?.length !== expected.bfcacheIterations
  ) {
    findings.push(
      `bfcache raw metric census expected ${String(expected.bfcacheIterations)} traversals`,
    );
  }
  return [...new Set(findings)];
}

export { validateDevCell };

function fixtureProof(sample, cell, fixtureIdentity) {
  const expectedScripts =
    cell.framework === 'kovo' && cell.lane !== 'matched-l1'
      ? sample.fixtureScriptCount === 0
      : sample.fixtureScriptCount > 0;
  const renderedContractDigest = fixtureIdentity?.identity?.renderedContracts?.[cell.lane]?.digest;
  const identityProof =
    fixtureIdentity === undefined ||
    (fixtureIdentity?.schema === BROWSER_FIXTURE_IDENTITY_SCHEMA &&
      sample.fixtureIdentitySchema === BROWSER_FIXTURE_IDENTITY_SCHEMA &&
      sample.fixtureRenderedEvidenceSchema === BROWSER_FIXTURE_RENDERED_EVIDENCE_SCHEMA &&
      sample.fixtureIdentityDigest === fixtureIdentity.digest &&
      sample.fixtureEvidenceValid === 1 &&
      sample.fixtureEvidenceDigest === renderedContractDigest &&
      sample.fixtureRenderedContractDigest === renderedContractDigest);
  return (
    sample.fixtureBootstrapValid === 1 &&
    sample.fixtureContentValid === 1 &&
    sample.fixtureControlsValid === 1 &&
    sample.fixtureCssValid === 1 &&
    sample.fixtureLaneValid === 1 &&
    expectedScripts &&
    identityProof
  );
}

export { fixtureProof };

function finiteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function validSha256(value) {
  return /^sha256:[0-9a-f]{64}$/u.test(value ?? '');
}

export function ttiInteractionProof(sample, lane) {
  return (
    sample.checkoutConfirmed === 1 && (lane !== 'matched-l1' || sample.stateMutationConfirmed === 1)
  );
}

function requiredLocksMatch(actual, expected) {
  return lockFiles.every((name) => actual?.[name] && actual[name] === expected?.[name]);
}

function observedBrowserVersions(cells) {
  const versions = [];
  for (const cell of cells) {
    const bfcacheVersion = cell.report?.apps?.[0]?.bfcache?.browser;
    if (typeof bfcacheVersion === 'string') versions.push(bfcacheVersion);
    for (const lighthouse of cell.report?.apps?.[0]?.lighthouse ?? []) {
      const lighthouseVersion = lighthouse?.browser?.version;
      if (typeof lighthouseVersion === 'string') versions.push(lighthouseVersion);
    }
    const devVersion = cell.report?.environment?.browser?.version;
    if (typeof devVersion === 'string') versions.push(devVersion);
  }
  return versions;
}

export function validHostFingerprint(host) {
  return host?.schema === PERF_HOST_SCHEMA && validPerformanceHostFingerprint(host);
}

export async function performanceWorkloadIdentity(
  options = {},
  cells = options.cells ?? defaultCells,
) {
  const corpusSize = options.corpusSize ?? 24;
  const quietHostPolicy = comparisonQuietHostPolicy(options);
  const devSchedule = cells.includes('dev')
    ? devSampleSchedule({
        editSamples: options.devIterations ?? 30,
        readySamples: options.devReadyIterations ?? 15,
        warmups: options.devWarmups ?? 3,
      })
    : [];
  const corpus = {};
  let complete = true;
  const serverSemantic = cells.includes('server')
    ? {
        contracts: Object.fromEntries(
          ['listing', 'detail'].map((route) => [
            route,
            {
              schema: MATCHED_SERVER_SEMANTIC_CONTRACT_SCHEMA,
              sha256: comparisonSha256(canonicalJson(matchedServerSemanticContract(route))),
            },
          ]),
        ),
        source: MATCHED_SERVER_SEMANTIC_SOURCE,
      }
    : null;
  let fixture = null;
  if (cells.includes('browser') || cells.includes('server')) {
    try {
      const fixtureResult = await browserFixtureIdentity();
      fixture = {
        digest: fixtureResult.digest,
        identity: fixtureResult.identity,
        schema: fixtureResult.schema,
      };
      if (!fixtureResult.complete) complete = false;
    } catch {
      complete = false;
    }
  }
  if (cells.includes('dev') || cells.includes('build')) {
    for (const framework of ['kovo', 'nextjs']) {
      try {
        const bytes = await readFile(
          options.corpusManifests?.[framework] ?? corpusManifest(framework, corpusSize),
        );
        const manifest = JSON.parse(bytes.toString('utf8'));
        const shapeDigest = `sha256:${createHash('sha256')
          .update(JSON.stringify(manifest.workload))
          .digest('hex')}`;
        corpus[framework] = {
          manifestDigest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
          shapeDigest: manifest.shapeDigest ? `sha256:${manifest.shapeDigest}` : null,
          sourceDigest: manifest.sourceDigest ?? null,
        };
        if (
          !/^sha256:[0-9a-f]{64}$/u.test(corpus[framework].shapeDigest ?? '') ||
          !/^sha256:[0-9a-f]{64}$/u.test(corpus[framework].sourceDigest ?? '') ||
          corpus[framework].shapeDigest !== shapeDigest
        ) {
          complete = false;
        }
      } catch {
        complete = false;
        corpus[framework] = null;
      }
    }
  }
  const identity = {
    adapters: {
      browser: BROWSER_BENCHMARK_SCHEMA,
      browserPrepare: BROWSER_PREPARE_SCHEMA,
      build: 'kovo-build-benchmark/v1',
      compare: COMPARE_SCHEMA,
      dev: 'kovo-dev-loop-report/v1',
      server: SERVER_BENCHMARK_SCHEMA,
      serverPrepare: SERVER_PREPARE_SCHEMA,
    },
    cells: [...cells],
    corpus,
    fixture,
    lanes: workloadLanes(options, cells, corpusSize),
    ...(cells.includes('dev') || cells.includes('build')
      ? { productArtifactPolicy: PACKED_KOVO_PRODUCT_WORKLOAD_POLICY }
      : {}),
    policies: {
      bfcacheIterations: options.bfcacheIterations ?? 10,
      browserSamples: options.iterations ?? 30,
      buildSamples: options.iterations ?? 30,
      buildModes: [...(options.buildModes ?? buildModes)],
      corpusSize,
      devEditSamples: options.devIterations ?? 30,
      devEditSessionSamples: devSchedule.filter(({ framework }) => framework === 'kovo').length,
      devOccurrenceSchedule: devSchedule,
      devPortAllocationPosture: DEV_PORT_ALLOCATION_POSTURE,
      devPortBase: options.devPortBase ?? DEFAULT_DEV_PORT_BASE,
      devPortStride: DEV_SESSION_PORT_STRIDE,
      devReadySamples: options.devReadyIterations ?? 15,
      devWarmups: options.devWarmups ?? 3,
      lighthouseRuns: options.lighthouseRuns ?? 5,
      quietHost: {
        ceilingPerCpu: options.maxLoadPerCpu ?? 1,
        maxTotalWaitMs: quietHostPolicy.maxWaitMs,
        pollMs: quietHostPolicy.pollMs,
        posture: 'pre-benchmark-admission-then-post-benchmark-settle',
      },
      skipLighthouse: options.skipLighthouse === true,
      server: {
        concurrencies: [...(options.serverConcurrencies ?? SERVER_CONCURRENCIES)],
        durationMs: options.serverDurationMs ?? 15_000,
        encodings: [...(options.serverEncodings ?? SERVER_ENCODINGS)],
        hostSettleMaxMs: quietHostPolicy.maxWaitMs,
        hostSettlePollMs: quietHostPolicy.pollMs,
        modes: [...(options.serverModes ?? SERVER_MODES)],
        routes: [...(options.serverRoutes ?? SERVER_ROUTES)],
        samples: options.serverSamples ?? 7,
        warmupMs: options.serverWarmupMs ?? 5_000,
      },
      warmups: options.warmups ?? 3,
    },
    serverSemantic,
  };
  if (
    (cells.includes('dev') || cells.includes('build')) &&
    corpus.kovo?.shapeDigest !== corpus.nextjs?.shapeDigest
  ) {
    complete = false;
  }
  if (
    (cells.includes('dev') || cells.includes('build')) &&
    packedKovoProductWorkloadPolicyFindings(identity.productArtifactPolicy).length > 0
  ) {
    complete = false;
  }
  if (
    cells.includes('server') &&
    (canonicalJson(serverSemantic?.source) !== canonicalJson(MATCHED_SERVER_SEMANTIC_SOURCE) ||
      ['listing', 'detail'].some(
        (route) =>
          serverSemantic?.contracts?.[route]?.sha256 !==
          comparisonSha256(canonicalJson(matchedServerSemanticContract(route))),
      ))
  ) {
    complete = false;
  }
  if (
    (cells.includes('browser') || cells.includes('server')) &&
    (fixture?.schema !== BROWSER_FIXTURE_IDENTITY_SCHEMA ||
      !/^sha256:[0-9a-f]{64}$/u.test(fixture?.digest ?? '') ||
      fixture?.identity?.schema !== BROWSER_FIXTURE_IDENTITY_SCHEMA)
  ) {
    complete = false;
  }
  return {
    complete,
    digest: `sha256:${createHash('sha256').update(canonicalJson(identity)).digest('hex')}`,
    identity,
    schema: WORKLOAD_IDENTITY_SCHEMA,
  };
}

function workloadLanes(options, cells, corpusSize) {
  const selected = [];
  if (cells.includes('browser')) selected.push(...(options.lanes ?? lanes));
  if (cells.includes('dev') || cells.includes('build')) {
    selected.push(`corpus-n${String(corpusSize)}`);
  }
  if (cells.includes('server')) selected.push('matched-runtime');
  return [...new Set(selected)];
}

function browserSamples(cell) {
  return Object.values(cell.report.apps?.[0]?.conditions ?? {}).flatMap((condition) =>
    Object.values(condition ?? {}).flatMap((scenario) => scenario?.iterations ?? []),
  );
}

function cellSampleCount(cell) {
  if (cell.cell === 'browser') return browserSamples(cell).length;
  if (cell.cell === 'dev') {
    return Array.isArray(cell.report?.samples) ? cell.report.samples.length : 0;
  }
  return (cell.report.samples ?? cell.report.rawSamples ?? []).length;
}

function readAliasedIntegerArg(primary, legacy, options) {
  const primaryValue = readArg(primary);
  const legacyValue = readArg(legacy);
  if (primaryValue !== undefined && legacyValue !== undefined) {
    throw new Error(`${primary} and legacy ${legacy} cannot be supplied together.`);
  }
  return parseIntegerFlag(primary, primaryValue ?? legacyValue, options);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cells = (readArg('--cells') ?? defaultCells.join(',')).split(',').filter(Boolean);
  const laneList = (readArg('--lanes') ?? lanes.join(',')).split(',').filter(Boolean);
  const { output } = await runComparison({
    allowDirty: process.argv.includes('--allow-dirty'),
    bfcacheIterations: readIntegerArg('--bfcache-iterations', { fallback: 10, max: 1_000 }),
    bootstrapIterations: readIntegerArg('--bootstrap-iterations', {
      fallback: 10_000,
      max: 1_000_000,
    }),
    cells,
    corpusSize: readIntegerArg('--corpus-size', { fallback: 24, max: 216 }),
    devIterations: readIntegerArg('--dev-iterations', { fallback: 30, max: 100 }),
    devPortBase: readIntegerArg('--dev-port-base', {
      fallback: DEFAULT_DEV_PORT_BASE,
      max: 65_024,
      min: 1_024,
    }),
    devReadyIterations: readIntegerArg('--dev-ready-iterations', { fallback: 15, max: 100 }),
    devWarmups: readIntegerArg('--dev-warmups', { fallback: 3, max: 10, min: 0 }),
    iterations: readIntegerArg('--iterations', { fallback: 30, max: 1_000 }),
    lanes: laneList,
    lighthouseRuns: readIntegerArg('--lighthouse-runs', { fallback: 5, max: 100 }),
    outDir: readArg('--out-dir'),
    skipBuild: process.argv.includes('--skip-build'),
    skipLighthouse: process.argv.includes('--skip-lighthouse'),
    serverConcurrencies: (readArg('--server-concurrencies') ?? SERVER_CONCURRENCIES.join(','))
      .split(',')
      .filter(Boolean)
      .map((value) => Number(value)),
    serverDurationMs: readIntegerArg('--server-duration-ms', {
      fallback: 15_000,
      max: 60_000,
      min: 25,
    }),
    serverEncodings: (readArg('--server-encodings') ?? SERVER_ENCODINGS.join(','))
      .split(',')
      .filter(Boolean),
    hostSettleMaxMs: readAliasedIntegerArg('--host-settle-max-ms', '--server-host-settle-max-ms', {
      fallback: DEFAULT_HOST_SETTLE_MAX_MS,
      max: MAX_HOST_SETTLE_MAX_MS,
      min: 0,
    }),
    hostSettlePollMs: readAliasedIntegerArg(
      '--host-settle-poll-ms',
      '--server-host-settle-poll-ms',
      {
        fallback: DEFAULT_HOST_SETTLE_POLL_MS,
        max: 60_000,
        min: 10,
      },
    ),
    serverModes: (readArg('--server-modes') ?? SERVER_MODES.join(',')).split(',').filter(Boolean),
    serverPortBase: readIntegerArg('--server-port-base', {
      fallback: 50_310,
      max: 65_500,
      min: 1_024,
    }),
    serverRoutes: (readArg('--server-routes') ?? SERVER_ROUTES.join(','))
      .split(',')
      .filter(Boolean),
    serverSamples: readIntegerArg('--server-samples', { fallback: 7, max: 100 }),
    serverWarmupMs: readIntegerArg('--server-warmup-ms', {
      fallback: 5_000,
      max: 60_000,
      min: 25,
    }),
    warmups: readIntegerArg('--warmups', { fallback: 3, max: 100, min: 0 }),
  });
  process.stdout.write(`comparison written to ${output}\n`);
}
