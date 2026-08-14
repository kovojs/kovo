#!/usr/bin/env node
/**
 * Serialized production-build adapter for benchmarks/compare.mjs.
 *
 * The corpus manifest owns each framework's argv, output roots, and deterministic one-line edit.
 * This runner only executes that declared contract and records wall time, process-tree RSS,
 * artifact bytes, and Kovo's nested source/worker phase censuses. It deliberately has no framework
 * command defaults: a report whose command was inferred independently of its corpus is not a
 * matched comparison.
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { loadavg } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { collectPerformanceProvenance } from './lib/perf-provenance.mjs';
import { measureProcessTreeCommand } from './lib/process-tree-rss.mjs';

export const BUILD_BENCHMARK_SCHEMA = 'kovo-build-benchmark/v1';
export const KOVO_BUILD_PHASE_ATTRIBUTION_SCHEMA = 'kovo-build-phase-attribution/v1';
export const KOVO_BUILD_SOURCE_PHASES = Object.freeze([
  'lifecycle-policy',
  'config-trust',
  'typescript',
  'project-quality',
  'sound-subset',
  'session-authority',
  'app-source-trust',
  'stylesheet',
  'app-evaluation',
  'build-check-graph',
  'graph-diagnostics',
]);
export const KOVO_BUILD_WORKER_PHASES = Object.freeze(['analyze', 'client', 'server', 'final']);
const CORPUS_SCHEMA = 'kovo-dev-corpus/v1';
const CORPUS_OWNER_FILE = '.kovo-benchmark-corpus-owner.json';
const CORPUS_OWNER_SCHEMA = 'kovo-benchmark-corpus-owner/v1';
const BUILD_OUTPUT_CONTRACT = 'required-nonempty-and-cleanup-absent/v1';
const KOVO_SOURCE_PHASE_SCHEMA = 'kovo-build-source-phase-census/v1';
const KOVO_WORKER_PHASE_SCHEMA = 'kovo-build-worker-phase-census/v1';
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1_000;
const IGNORED_CORPUS_NAMES = new Set([CORPUS_OWNER_FILE, 'manifest.json', 'node_modules']);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export function parseBuildPhaseCensus(output) {
  const text = String(output);
  return {
    source: parseLastProtocolLine(text, KOVO_SOURCE_PHASE_SCHEMA),
    workers: parseLastProtocolLine(text, KOVO_WORKER_PHASE_SCHEMA),
  };
}

/**
 * Attribute one Kovo build wall observation without adding overlapping clocks.
 *
 * The source-check census is nested inside the `analyze` worker. SPEC §5.2 rule 9 makes that
 * current-source proof distinct from the later deploy-proof workers, so adding the source phase
 * durations to the worker durations would double-count work and invent an attribution. The four
 * worker durations are the only authenticated sequential envelope. Everything outside that
 * envelope is reported as a measured CLI/startup residual.
 */
export function attributeKovoBuildWallTime({ durationMs, expectedSourcePath, phaseCensus }) {
  const errors = [];
  const source = phaseCensus?.source;
  const workers = phaseCensus?.workers;
  const wallDurationMs = finiteNonNegativeNumber(durationMs, 'wall duration', errors);
  validateKovoBuildSourceCensus(source, expectedSourcePath, errors);
  const workerEnvelopeMs = validateKovoBuildWorkerCensus(workers, expectedSourcePath, errors);
  let residualMs = null;
  if (wallDurationMs !== null && workerEnvelopeMs !== null) {
    const candidate = wallDurationMs - workerEnvelopeMs;
    if (!Number.isFinite(candidate) || candidate < 0) {
      errors.push('worker phase envelope exceeds measured build wall time');
    } else {
      residualMs = candidate;
    }
  }
  const complete = errors.length === 0 && residualMs !== null;
  return {
    cliStartupTail: {
      durationMs: complete ? residualMs : null,
      source: {
        envelope: `${KOVO_WORKER_PHASE_SCHEMA}.totalWorkerMs`,
        operation: 'wall-minus-sequential-worker-envelope',
        wall: 'measureProcessTreeCommand.durationMs',
      },
      status: complete ? 'measured-residual' : 'unproven',
    },
    complete,
    errors,
    phaseEnvelope: {
      durationMs: workerEnvelopeMs,
      phases: [...KOVO_BUILD_WORKER_PHASES],
      source: `${KOVO_WORKER_PHASE_SCHEMA}.totalWorkerMs`,
      status: workerEnvelopeMs === null ? 'unproven' : 'authenticated-sequential',
    },
    schema: KOVO_BUILD_PHASE_ATTRIBUTION_SCHEMA,
    sourceCheck: {
      nestedWithin: 'analyze',
      phases: [...KOVO_BUILD_SOURCE_PHASES],
      source: KOVO_SOURCE_PHASE_SCHEMA,
      status: errors.some((error) => error.startsWith('source census'))
        ? 'unproven'
        : 'authenticated-nested',
    },
    wallDurationMs,
  };
}

export function artifactBytesForOutputs(root, outputs) {
  const resolvedRoot = path.resolve(root);
  const targets = new Set();
  let bytes = 0;
  for (const output of outputs) {
    for (const target of resolveDeclaredOutputTargets(resolvedRoot, output)) {
      targets.add(target);
    }
  }
  for (const target of targets) bytes += artifactPathBytes(target);
  return bytes;
}

export function inspectBuildOutputContract(root, outputs) {
  const contract = validateBuildOutputContract(outputs);
  const resolvedRoot = path.resolve(root);
  const requiredNonempty = contract.requiredNonempty.map((output) => {
    const targets = resolveDeclaredOutputTargets(resolvedRoot, output);
    return {
      bytes: artifactBytesForOutputs(resolvedRoot, [output]),
      output,
      targets: targets.map((target) => portableRelativePath(resolvedRoot, target)),
    };
  });
  const absent = contract.absent.map((output) => ({
    matches: resolveDeclaredOutputTargets(resolvedRoot, output).map((target) =>
      portableRelativePath(resolvedRoot, target),
    ),
    output,
  }));
  return {
    absent,
    complete:
      requiredNonempty.every((entry) => entry.bytes > 0) &&
      absent.every((entry) => entry.matches.length === 0),
    requiredNonempty,
    totalBytes: artifactBytesForOutputs(resolvedRoot, contract.requiredNonempty),
  };
}

export function sameSourceState(left, right) {
  return (
    left?.commit === right?.commit &&
    JSON.stringify(left?.dirtyPaths) === JSON.stringify(right?.dirtyPaths) &&
    JSON.stringify(left?.locks) === JSON.stringify(right?.locks)
  );
}

export function applyBuildBenchmarkEdit(root, edit, revision) {
  const file = confinedPath(root, requiredString(edit?.file, 'build.edit.file'));
  const search = requiredString(edit?.search, 'build.edit.search');
  const template = requiredString(edit?.replacementTemplate, 'build.edit.replacementTemplate');
  const source = readFileSync(file, 'utf8');
  const first = source.indexOf(search);
  if (first < 0 || source.indexOf(search, first + search.length) >= 0) {
    throw new TypeError('build.edit.search must occur exactly once in the declared file');
  }
  const replacement = template
    .replaceAll('{{revision}}', String(revision))
    .replaceAll('{revision}', String(revision))
    .replaceAll('$REVISION', String(revision));
  if (replacement === template) {
    throw new TypeError(
      'build.edit.replacementTemplate must contain {revision}, {{revision}}, or $REVISION',
    );
  }
  writeFileSync(
    file,
    `${source.slice(0, first)}${replacement}${source.slice(first + search.length)}`,
  );
  return { file, source };
}

export function summarizeBuildSamples(samples) {
  const durations = samples.map((sample) => sample.durationMs).sort((left, right) => left - right);
  const median = quantile(durations, 0.5);
  const deviations = durations
    .map((value) => Math.abs(value - median))
    .sort((left, right) => left - right);
  const phaseEvidence = samples.flatMap((sample, index) =>
    sample.phaseCensus === null || sample.phaseCensus === undefined
      ? []
      : [
          {
            attribution: sample.phaseAttribution ?? null,
            census: sample.phaseCensus,
            sample: index + 1,
          },
        ],
  );
  return {
    artifactBytes: samples.at(-1)?.artifactBytes ?? 0,
    durationMadMs: quantile(deviations, 0.5),
    durationMedianMs: median,
    durationP95Ms: quantile(durations, 0.95),
    ...(phaseEvidence.length === 0 ? {} : { phaseEvidence }),
    peakRssBytes: Math.max(0, ...samples.map((sample) => sample.peakRssBytes)),
  };
}

export function runBuildBenchmark(options, dependencies = {}) {
  const manifestPath = path.resolve(requiredString(options.corpus, '--corpus'));
  const manifestText = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText);
  const framework = options.framework;
  const mode = options.mode;
  const iterations = positiveInteger(options.iterations, '--iterations');
  const warmups = nonNegativeInteger(options.warmups ?? (mode === 'clean' ? 0 : 1), '--warmups');
  const timeoutMs = positiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, '--timeout');
  validateCorpusManifest(manifest, framework);
  if (mode !== 'clean' && mode !== 'unchanged' && mode !== 'edit') {
    throw new TypeError('--mode must be clean, unchanged, or edit');
  }
  const corpusRoot = path.dirname(manifestPath);
  const command = manifest.build.command;
  const commandCwd = confinedPath(
    corpusRoot,
    requiredString(command.cwd, 'build.command.cwd'),
    true,
  );
  const argv = stringArray(command.argv, 'build.command.argv');
  const outputs = validateBuildOutputContract(manifest.build.outputs);
  const outputPatterns = [...outputs.requiredNonempty, ...outputs.absent];
  const commandEnv = stringRecord(command.env, 'build.command.env');
  const kovoPhaseCensusSource = framework === 'kovo' ? declaredKovoBuildSource(argv) : null;
  const edit = manifest.build.edit;
  const originalEditSource =
    mode === 'edit'
      ? readFileSync(
          confinedPath(corpusRoot, requiredString(edit?.file, 'build.edit.file')),
          'utf8',
        )
      : undefined;
  const samples = [];
  const errors = [];
  const manifestDigest = `sha256:${createHash('sha256').update(manifestText).digest('hex')}`;
  const corpusBefore = captureCorpusState({
    corpusRoot,
    manifest,
    manifestDigest,
    manifestPath,
    outputs,
  });
  assertCorpusMatchesManifest(corpusBefore, manifest, 'pre-run');
  const collectProvenance =
    dependencies.collectPerformanceProvenance ?? collectPerformanceProvenance;
  const measureCommand = dependencies.measureProcessTreeCommand ?? measureProcessTreeCommand;
  const source = collectProvenance({
    lockFiles: [
      'pnpm-lock.yaml',
      'benchmarks/nextjs/pnpm-lock.yaml',
      'benchmarks/harness/pnpm-lock.yaml',
    ],
    repoRoot,
  });
  const run = () =>
    measureCommand(argv, {
      cwd: commandCwd,
      env: {
        ...commandEnv,
        ...(kovoPhaseCensusSource === null
          ? {}
          : { KOVO_DEVEX_BUILD_PHASE_CENSUS_SOURCE: kovoPhaseCensusSource }),
      },
      sampleIntervalMs: 50,
      timeoutMs,
    });

  const guardedRun = (scope) => {
    let before;
    try {
      before = captureCorpusState({
        corpusRoot,
        manifest,
        manifestDigest,
        manifestPath,
        outputs,
      });
    } catch (error) {
      errors.push(`${scope} pre-command corpus integrity: ${errorMessage(error)}`);
      return null;
    }
    let measured;
    try {
      measured = run();
    } catch (error) {
      errors.push(`${scope} command execution: ${errorMessage(error)}`);
      return null;
    }
    let after;
    try {
      after = captureCorpusState({
        corpusRoot,
        manifest,
        manifestDigest,
        manifestPath,
        outputs,
      });
    } catch (error) {
      errors.push(`${scope} post-command corpus integrity: ${errorMessage(error)}`);
      return { after: null, before, measured, stable: false };
    }
    const stable = before.digest === after.digest;
    if (!stable) errors.push(`${scope} changed the authenticated corpus source state`);
    return { after, before, measured, stable };
  };

  let corpusAfter = null;
  let sourceAfter = null;

  try {
    cleanDeclaredOutputs(corpusRoot, outputPatterns);
    for (let index = 0; index < warmups; index += 1) {
      if (mode === 'clean') cleanDeclaredOutputs(corpusRoot, outputPatterns);
      const guarded = guardedRun(`warmup ${String(index + 1)}`);
      if (guarded === null) break;
      const warmup = guarded.measured;
      if (warmup.exitCode !== 0 || warmup.error !== null) {
        errors.push(`warmup ${String(index + 1)} failed: ${commandFailure(warmup)}`);
        break;
      }
    }
    for (let index = 0; errors.length === 0 && index < iterations; index += 1) {
      if (mode === 'clean') cleanDeclaredOutputs(corpusRoot, outputPatterns);
      if (mode === 'edit') {
        writeFileSync(
          confinedPath(corpusRoot, requiredString(edit.file, 'build.edit.file')),
          originalEditSource,
        );
        // Alternate two same-width revisions. Every sample starts from the identical source and
        // changes the declared leaf, while avoiding progressively longer revision text as the
        // iteration count grows.
        applyBuildBenchmarkEdit(corpusRoot, edit, (index % 2) + 1);
      }
      const beforeLoadAverage = loadavg()[0];
      const guarded = guardedRun(`sample ${String(index + 1)}`);
      if (guarded === null) break;
      const measured = guarded.measured;
      const combinedOutput = `${measured.stdout}\n${measured.stderr}`;
      let outputCensus;
      try {
        outputCensus = inspectBuildOutputContract(corpusRoot, outputs);
      } catch (error) {
        outputCensus = {
          absent: [],
          complete: false,
          error: errorMessage(error),
          requiredNonempty: [],
          totalBytes: 0,
        };
      }
      let phaseCensus = null;
      let phaseAttribution = null;
      if (framework === 'kovo') {
        try {
          phaseCensus = parseBuildPhaseCensus(combinedOutput);
          phaseAttribution = attributeKovoBuildWallTime({
            durationMs: measured.durationMs,
            expectedSourcePath: kovoPhaseCensusSource,
            phaseCensus,
          });
        } catch (error) {
          phaseAttribution = {
            cliStartupTail: {
              durationMs: null,
              source: {
                envelope: `${KOVO_WORKER_PHASE_SCHEMA}.totalWorkerMs`,
                operation: 'wall-minus-sequential-worker-envelope',
                wall: 'measureProcessTreeCommand.durationMs',
              },
              status: 'unproven',
            },
            complete: false,
            errors: [`phase census parse failed: ${errorMessage(error)}`],
            phaseEnvelope: {
              durationMs: null,
              phases: [...KOVO_BUILD_WORKER_PHASES],
              source: `${KOVO_WORKER_PHASE_SCHEMA}.totalWorkerMs`,
              status: 'unproven',
            },
            schema: KOVO_BUILD_PHASE_ATTRIBUTION_SCHEMA,
            sourceCheck: {
              nestedWithin: 'analyze',
              phases: [...KOVO_BUILD_SOURCE_PHASES],
              source: KOVO_SOURCE_PHASE_SCHEMA,
              status: 'unproven',
            },
            wallDurationMs: measured.durationMs,
          };
        }
      }
      const sample = {
        artifactBytes: outputCensus.totalBytes,
        corpus: {
          afterDigest: guarded.after?.digest ?? null,
          beforeDigest: guarded.before.digest,
          stable: guarded.stable,
        },
        durationMs: measured.durationMs,
        exitCode: measured.exitCode,
        loadAverage: beforeLoadAverage,
        outputCensus,
        peakRssBytes: measured.peakRssBytes,
        phaseAttribution,
        phaseCensus,
      };
      samples.push(sample);
      const sampleNumber = String(index + 1);
      if (measured.exitCode !== 0 || measured.error !== null) {
        errors.push(`sample ${sampleNumber} failed: ${commandFailure(measured)}`);
      } else {
        for (const output of outputCensus.requiredNonempty) {
          if (output.bytes === 0) {
            errors.push(
              `sample ${sampleNumber} required output ${output.output} was empty or missing`,
            );
          }
        }
        for (const output of outputCensus.absent) {
          if (output.matches.length > 0) {
            errors.push(
              `sample ${sampleNumber} left forbidden output ${output.output}: ${output.matches.join(', ')}`,
            );
          }
        }
        if (outputCensus.error !== undefined) {
          errors.push(`sample ${sampleNumber} output census: ${outputCensus.error}`);
        }
      }
      if (framework === 'kovo' && sample.phaseAttribution?.complete !== true) {
        errors.push(
          `sample ${sampleNumber} omitted authenticated Kovo build phase attribution: ${
            sample.phaseAttribution?.errors?.join('; ') ?? 'phase attribution is unavailable'
          }`,
        );
      }
      if (measured.exitCode !== 0 || measured.error !== null) break;
    }
  } finally {
    if (originalEditSource !== undefined) {
      writeFileSync(
        confinedPath(corpusRoot, requiredString(edit.file, 'build.edit.file')),
        originalEditSource,
      );
    }
    try {
      corpusAfter = captureCorpusState({
        corpusRoot,
        manifest,
        manifestDigest,
        manifestPath,
        outputs,
      });
      assertCorpusMatchesManifest(corpusAfter, manifest, 'post-run');
      if (corpusAfter.digest !== corpusBefore.digest) {
        errors.push('post-run corpus source state differs from pre-run state');
      }
    } catch (error) {
      errors.push(`post-run corpus integrity: ${errorMessage(error)}`);
    }
    try {
      sourceAfter = collectProvenance({
        lockFiles: [
          'pnpm-lock.yaml',
          'benchmarks/nextjs/pnpm-lock.yaml',
          'benchmarks/harness/pnpm-lock.yaml',
        ],
        repoRoot,
      });
      if (!sameSourceState(source, sourceAfter)) {
        errors.push('repository source provenance changed during measurement');
      }
    } catch (error) {
      errors.push(`post-run source provenance: ${errorMessage(error)}`);
    }
  }

  const validSamples = samples.filter(
    (sample) =>
      sample.exitCode === 0 &&
      sample.outputCensus?.complete === true &&
      sample.corpus?.stable === true &&
      (framework !== 'kovo' || sample.phaseAttribution?.complete === true),
  ).length;
  const misses = iterations - validSamples;
  const corpusStable = corpusAfter?.digest === corpusBefore.digest;
  const sourceStable = sameSourceState(source, sourceAfter);
  const complete =
    samples.length === iterations &&
    errors.length === 0 &&
    misses === 0 &&
    corpusStable &&
    sourceStable;
  return {
    corpus: {
      approximateLoc: manifest.approximateLoc,
      manifestDigest,
      manifestPath: portableRelativePath(repoRoot, manifestPath),
      modules: manifest.modules,
      routes: manifest.routes,
      schema: manifest.schema,
      shapeDigest: manifest.shapeDigest,
      ...(manifest.sourceDigest === undefined ? {} : { sourceDigest: manifest.sourceDigest }),
      workload: manifest.workload,
    },
    framework,
    integrity: {
      command: { argv, cwd: path.relative(corpusRoot, commandCwd) || '.' },
      complete,
      corpus: { after: corpusAfter, before: corpusBefore, stable: corpusStable },
      errors,
      iterations,
      misses,
      outputRoots: outputs,
      source: { after: sourceAfter, before: source, stable: sourceStable },
      warmups,
    },
    mode,
    samples,
    schema: BUILD_BENCHMARK_SCHEMA,
    source,
    sourceAfter,
    summary: summarizeBuildSamples(samples),
  };
}

function validateCorpusManifest(manifest, framework) {
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    Array.isArray(manifest) ||
    manifest.schema !== CORPUS_SCHEMA ||
    manifest.framework !== framework ||
    (framework !== 'kovo' && framework !== 'nextjs') ||
    !manifest.build ||
    typeof manifest.build !== 'object' ||
    Array.isArray(manifest.build)
  ) {
    throw new TypeError('corpus manifest does not match the requested framework/build schema');
  }
  const shapeDigest = requiredString(manifest.shapeDigest, 'shapeDigest');
  if (!/^[0-9a-f]{64}$/u.test(shapeDigest)) {
    throw new TypeError('shapeDigest must be one lowercase SHA-256 digest');
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(requiredString(manifest.sourceDigest, 'sourceDigest'))) {
    throw new TypeError('sourceDigest must be one prefixed lowercase SHA-256 digest');
  }
  validateSourceFiles(manifest.sourceFiles);
  if (sha256(JSON.stringify(manifest.sourceFiles)) !== manifest.sourceDigest) {
    throw new TypeError('sourceDigest does not authenticate sourceFiles');
  }
  if (
    !manifest.workload ||
    typeof manifest.workload !== 'object' ||
    Array.isArray(manifest.workload)
  ) {
    throw new TypeError('workload must be an object');
  }
  const recomputedShapeDigest = createHash('sha256')
    .update(JSON.stringify(manifest.workload))
    .digest('hex');
  if (shapeDigest !== recomputedShapeDigest) {
    throw new TypeError('shapeDigest does not authenticate the declared workload');
  }
  const modules = positiveInteger(manifest.modules, 'modules');
  const routes = positiveInteger(manifest.routes, 'routes');
  if (
    manifest.workload.componentImportFanout !== modules ||
    manifest.workload.workloadModules !== modules ||
    manifest.workload.routes !== routes ||
    manifest.workload.buildOutputContract !== BUILD_OUTPUT_CONTRACT
  ) {
    throw new TypeError('corpus size metadata does not match the authenticated workload');
  }
  validateBuildOutputContract(manifest.build.outputs);
}

function declaredKovoBuildSource(argv) {
  const buildIndex = argv.indexOf('build');
  const declared = buildIndex < 0 ? undefined : argv[buildIndex + 1];
  if (
    typeof declared !== 'string' ||
    declared.length === 0 ||
    declared.startsWith('--') ||
    path.isAbsolute(declared)
  ) {
    throw new TypeError('Kovo build command must declare one project-relative source entry');
  }
  const normalized = path.posix.normalize(declared.replaceAll('\\', '/')).replace(/^\.\//u, '');
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new TypeError('Kovo build phase census source escapes the corpus root');
  }
  return normalized;
}

function validateKovoBuildSourceCensus(census, expectedSourcePath, errors) {
  if (!ownRecord(census) || census.schema !== KOVO_SOURCE_PHASE_SCHEMA) {
    errors.push(`source census is not ${KOVO_SOURCE_PHASE_SCHEMA}`);
    return;
  }
  if (census.complete !== true) errors.push('source census is incomplete');
  if (!digest(census.checkGraphDigest)) errors.push('source census checkGraphDigest is invalid');
  if (!digest(census.sourceSetDigest)) errors.push('source census sourceSetDigest is invalid');
  if (
    !ownRecord(census.source) ||
    census.source.path !== expectedSourcePath ||
    census.source.encoding !== 'utf16le' ||
    !Number.isSafeInteger(census.source.codeUnitLength) ||
    census.source.codeUnitLength < 0 ||
    !digest(census.source.contentHash)
  ) {
    errors.push('source census source identity is invalid');
  }
  validateExactPhaseSequence(census.phases, KOVO_BUILD_SOURCE_PHASES, 'source census', errors, {
    statuses: new Set(['executed', 'not-applicable', 'reused-authenticated']),
  });
}

function validateKovoBuildWorkerCensus(census, expectedSourcePath, errors) {
  if (!ownRecord(census) || census.schema !== KOVO_WORKER_PHASE_SCHEMA) {
    errors.push(`worker census is not ${KOVO_WORKER_PHASE_SCHEMA}`);
    return null;
  }
  if (census.complete !== true) errors.push('worker census is incomplete');
  if (census.sourcePath !== expectedSourcePath)
    errors.push('worker census source identity is invalid');
  const phaseDurations = validateExactPhaseSequence(
    census.phases,
    KOVO_BUILD_WORKER_PHASES,
    'worker census',
    errors,
    { statuses: new Set([0]) },
  );
  const declaredTotal = finiteNonNegativeNumber(
    census.totalWorkerMs,
    'worker census totalWorkerMs',
    errors,
  );
  if (phaseDurations === null || declaredTotal === null) return null;
  const computedTotal = phaseDurations.reduce((sum, value) => sum + value, 0);
  const tolerance = Math.max(1e-6, computedTotal * Number.EPSILON * 8);
  if (Math.abs(computedTotal - declaredTotal) > tolerance) {
    errors.push('worker census totalWorkerMs does not equal its sequential phase durations');
    return null;
  }
  return declaredTotal;
}

function validateExactPhaseSequence(phases, expectedNames, label, errors, { statuses }) {
  if (!Array.isArray(phases) || phases.length !== expectedNames.length) {
    errors.push(`${label} does not contain the complete ordered phase set`);
    return null;
  }
  const durations = [];
  for (let index = 0; index < expectedNames.length; index += 1) {
    const phase = phases[index];
    if (!ownRecord(phase) || phase.name !== expectedNames[index]) {
      errors.push(`${label} phase ${String(index + 1)} is not ${expectedNames[index]}`);
      continue;
    }
    if (!statuses.has(phase.status)) {
      errors.push(`${label} phase ${phase.name} has invalid status`);
    }
    const duration = finiteNonNegativeNumber(
      phase.durationMs,
      `${label} phase ${phase.name} duration`,
      errors,
    );
    if (duration !== null) durations.push(duration);
  }
  return durations.length === expectedNames.length ? durations : null;
}

function finiteNonNegativeNumber(value, label, errors) {
  if (!Number.isFinite(value) || value < 0) {
    errors.push(`${label} must be finite and non-negative`);
    return null;
  }
  return value;
}

function digest(value) {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function ownRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateBuildOutputContract(value) {
  const keys = Object.keys(value ?? {}).sort();
  if (JSON.stringify(keys) !== JSON.stringify(['absent', 'requiredNonempty'])) {
    throw new TypeError('build.outputs must contain only absent and requiredNonempty');
  }
  const requiredNonempty = stringArray(value.requiredNonempty, 'build.outputs.requiredNonempty');
  if (!Array.isArray(value.absent)) {
    throw new TypeError('build.outputs.absent must be an array');
  }
  const absent = value.absent.map((entry) => requiredString(entry, 'build.outputs.absent'));
  const unique = new Set();
  for (const output of [...requiredNonempty, ...absent]) {
    validateOutputPattern(output);
    if (unique.has(output)) throw new TypeError(`build output is duplicated: ${output}`);
    unique.add(output);
  }
  return { absent, requiredNonempty };
}

function validateOutputPattern(output) {
  const star = output.indexOf('*');
  if (star >= 0 && (star !== output.length - 1 || output.indexOf('*', star + 1) >= 0)) {
    throw new TypeError('build output permits only one trailing * wildcard');
  }
  const pathValue = star < 0 ? output : `${output.slice(0, -1)}sentinel`;
  confinedPath('.', pathValue);
  if (star >= 0 && path.basename(output.slice(0, -1)).length < 2) {
    throw new TypeError('build output wildcard prefix is too broad');
  }
}

function validateSourceFiles(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('sourceFiles must be a non-empty array');
  }
  let prior = '';
  for (const entry of value) {
    const keys = Object.keys(entry ?? {}).sort();
    if (JSON.stringify(keys) !== JSON.stringify(['bytes', 'file', 'sha256'])) {
      throw new TypeError('sourceFiles entry has an unexpected shape');
    }
    const file = requiredString(entry.file, 'sourceFiles.file');
    confinedPath('.', file);
    if (file <= prior) throw new TypeError('sourceFiles must be unique and sorted');
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
      throw new TypeError(`sourceFiles byte count is invalid for ${file}`);
    }
    if (!/^sha256:[0-9a-f]{64}$/u.test(entry.sha256)) {
      throw new TypeError(`sourceFiles digest is invalid for ${file}`);
    }
    prior = file;
  }
}

function captureCorpusState({ corpusRoot, manifest, manifestDigest, manifestPath, outputs }) {
  const manifestBytes = readFileSync(manifestPath);
  const observedManifestDigest = sha256(manifestBytes);
  if (observedManifestDigest !== manifestDigest) {
    throw new TypeError('corpus manifest bytes changed during measurement');
  }
  const ownerPath = confinedPath(corpusRoot, CORPUS_OWNER_FILE);
  const ownerBytes = readFileSync(ownerPath);
  const owner = JSON.parse(ownerBytes.toString('utf8'));
  const ownerKeys = Object.keys(owner ?? {}).sort();
  if (
    JSON.stringify(ownerKeys) !== JSON.stringify(['appRoot', 'framework', 'modules', 'schema']) ||
    owner.schema !== CORPUS_OWNER_SCHEMA ||
    path.resolve(owner.appRoot ?? '') !== corpusRoot ||
    owner.framework !== manifest.framework ||
    owner.modules !== manifest.modules
  ) {
    throw new TypeError('corpus ownership sentinel does not authenticate this app root');
  }

  const expectedPaths = new Set();
  const sourceFiles = [];
  for (const entry of manifest.sourceFiles) {
    expectedPaths.add(entry.file);
    const filePath = confinedPath(corpusRoot, entry.file);
    const metadata = lstatSync(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new TypeError(`corpus source ${entry.file} is not a regular file`);
    }
    const bytes = readFileSync(filePath);
    sourceFiles.push({ bytes: bytes.byteLength, file: entry.file, sha256: sha256(bytes) });
  }
  const unexpected = listCorpusSourcePaths(corpusRoot, outputs).filter(
    (file) => !expectedPaths.has(file),
  );
  if (unexpected.length > 0) {
    throw new TypeError(`corpus contains unmanifested source files: ${unexpected.join(', ')}`);
  }
  const sourceDigest = sha256(JSON.stringify(sourceFiles));
  const state = {
    manifestDigest: observedManifestDigest,
    ownerDigest: sha256(ownerBytes),
    sourceDigest,
  };
  return { ...state, digest: sha256(JSON.stringify(state)) };
}

function assertCorpusMatchesManifest(state, manifest, phase) {
  if (state.sourceDigest !== manifest.sourceDigest) {
    throw new TypeError(`${phase} corpus sourceDigest does not match current source bytes`);
  }
}

function listCorpusSourcePaths(root, outputs, relative = '') {
  const result = [];
  for (const name of readdirSync(path.join(root, relative))) {
    if (relative === '' && IGNORED_CORPUS_NAMES.has(name)) continue;
    const child = relative === '' ? name : `${relative}/${name}`;
    if (relative === '' && outputPatternMatchesName(outputs, name)) continue;
    const target = path.join(root, child);
    const metadata = lstatSync(target);
    if (metadata.isSymbolicLink()) throw new TypeError(`unexpected corpus symlink ${child}`);
    if (metadata.isDirectory()) result.push(...listCorpusSourcePaths(root, outputs, child));
    else if (metadata.isFile()) result.push(child);
  }
  return result.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function outputPatternMatchesName(outputs, name) {
  for (const output of [...outputs.requiredNonempty, ...outputs.absent]) {
    if (path.dirname(output) !== '.') continue;
    const base = path.basename(output);
    if (base.endsWith('*') ? name.startsWith(base.slice(0, -1)) : name === base) return true;
  }
  return false;
}

function cleanDeclaredOutputs(root, outputs) {
  for (const output of outputs) {
    for (const target of resolveDeclaredOutputTargets(root, output)) {
      rmSync(target, { force: true, recursive: true });
    }
  }
}

function resolveDeclaredOutputTargets(root, output) {
  const value = requiredString(output, 'build output');
  const star = value.indexOf('*');
  if (star < 0) return [confinedPath(root, value)];
  if (star !== value.length - 1 || value.indexOf('*', star + 1) >= 0) {
    throw new TypeError('build output permits only one trailing * wildcard');
  }
  const baseNamePrefix = path.basename(value.slice(0, -1));
  if (baseNamePrefix.length < 2) throw new TypeError('build output wildcard prefix is too broad');
  const parent = confinedPath(root, path.dirname(value), true);
  if (!existsSync(parent)) return [];
  return readdirSync(parent)
    .filter((name) => name.startsWith(baseNamePrefix))
    .map((name) => confinedPath(root, path.join(path.relative(root, parent), name)));
}

function artifactPathBytes(target) {
  if (!existsSync(target)) return 0;
  const metadata = lstatSync(target);
  if (metadata.isSymbolicLink()) {
    throw new TypeError(`artifact census refuses symbolic link ${target}`);
  }
  if (metadata.isFile()) return statSync(target).size;
  if (!metadata.isDirectory()) return 0;
  let bytes = 0;
  for (const name of readdirSync(target)) bytes += artifactPathBytes(path.join(target, name));
  return bytes;
}

function confinedPath(root, relativePath, allowRoot = false) {
  if (path.isAbsolute(relativePath)) throw new TypeError('corpus paths must be relative');
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (
    (resolved === resolvedRoot && !allowRoot) ||
    (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`))
  ) {
    throw new TypeError(`corpus path escapes its root: ${relativePath}`);
  }
  return resolved;
}

function parseLastProtocolLine(output, schema) {
  let parsed = null;
  for (const line of output.split(/\r?\n/u)) {
    if (!line.startsWith(`${schema} `)) continue;
    const candidate = JSON.parse(line.slice(schema.length + 1));
    if (candidate?.schema !== schema) throw new TypeError(`${schema} line has a stale schema`);
    parsed = candidate;
  }
  return parsed;
}

function quantile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0)
    throw new TypeError(`${label} must be non-empty`);
  return value.map((entry) => requiredString(entry, label));
}

function stringRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, requiredString(entry, `${label}.${key}`)]),
  );
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} is required`);
  return value;
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new TypeError(`${label} must be positive`);
  return number;
}

function nonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`${label} must be non-negative`);
  }
  return number;
}

function commandFailure(measured) {
  return measured.error ?? measured.signal ?? `exit ${String(measured.exitCode)}`;
}

function portableRelativePath(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new TypeError(`invalid argument ${String(name)}`);
    }
    options[name.slice(2)] = value;
    index += 1;
  }
  return options;
}

async function main(argv) {
  const args = parseArgs(argv);
  const report = runBuildBenchmark({
    corpus: args.corpus,
    framework: args.framework,
    iterations: args.iterations,
    mode: args.mode,
    warmups: args.warmups,
    ...(args.timeout === undefined ? {} : { timeoutMs: Number(args.timeout) }),
  });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (args.out !== undefined) writeFileSync(path.resolve(args.out), serialized, 'utf8');
  process.stdout.write(serialized);
  if (!report.integrity.complete) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `build benchmark: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 2;
  }
}
