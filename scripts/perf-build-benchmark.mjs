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
const CORPUS_SCHEMA = 'kovo-dev-corpus/v1';
const KOVO_SOURCE_PHASE_SCHEMA = 'kovo-build-source-phase-census/v1';
const KOVO_WORKER_PHASE_SCHEMA = 'kovo-build-worker-phase-census/v1';
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1_000;
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export function parseBuildPhaseCensus(output) {
  const text = String(output);
  return {
    source: parseLastProtocolLine(text, KOVO_SOURCE_PHASE_SCHEMA),
    workers: parseLastProtocolLine(text, KOVO_WORKER_PHASE_SCHEMA),
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
  return {
    artifactBytes: samples.at(-1)?.artifactBytes ?? 0,
    durationMadMs: quantile(deviations, 0.5),
    durationMedianMs: median,
    durationP95Ms: quantile(durations, 0.95),
    peakRssBytes: Math.max(0, ...samples.map((sample) => sample.peakRssBytes)),
  };
}

export function runBuildBenchmark(options) {
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
  const outputs = stringArray(manifest.build.outputs, 'build.outputs');
  const commandEnv = stringRecord(command.env, 'build.command.env');
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
  const source = collectPerformanceProvenance({
    lockFiles: ['pnpm-lock.yaml', 'benchmarks/nextjs/pnpm-lock.yaml'],
    repoRoot,
  });
  const run = () =>
    measureProcessTreeCommand(argv, {
      cwd: commandCwd,
      env: {
        ...commandEnv,
        ...(framework === 'kovo' ? { KOVO_DEVEX_BUILD_PHASE_CENSUS_SOURCE: 'src/app.tsx' } : {}),
      },
      sampleIntervalMs: 50,
      timeoutMs,
    });

  try {
    cleanDeclaredOutputs(corpusRoot, outputs);
    for (let index = 0; index < warmups; index += 1) {
      if (mode === 'clean') cleanDeclaredOutputs(corpusRoot, outputs);
      const warmup = run();
      if (warmup.exitCode !== 0 || warmup.error !== null) {
        errors.push(`warmup ${String(index + 1)} failed: ${commandFailure(warmup)}`);
        break;
      }
    }
    for (let index = 0; errors.length === 0 && index < iterations; index += 1) {
      if (mode === 'clean') cleanDeclaredOutputs(corpusRoot, outputs);
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
      const measured = run();
      const combinedOutput = `${measured.stdout}\n${measured.stderr}`;
      const sample = {
        artifactBytes: artifactBytesForOutputs(corpusRoot, outputs),
        durationMs: measured.durationMs,
        exitCode: measured.exitCode,
        loadAverage: beforeLoadAverage,
        peakRssBytes: measured.peakRssBytes,
        phaseCensus: framework === 'kovo' ? parseBuildPhaseCensus(combinedOutput) : null,
      };
      samples.push(sample);
      const sampleNumber = String(index + 1);
      if (measured.exitCode !== 0 || measured.error !== null) {
        errors.push(`sample ${sampleNumber} failed: ${commandFailure(measured)}`);
      } else if (sample.artifactBytes === 0) {
        errors.push(`sample ${sampleNumber} produced no bytes in its declared outputs`);
      } else if (framework === 'kovo' && sample.phaseCensus?.source?.complete !== true) {
        errors.push(`sample ${sampleNumber} omitted a complete Kovo source-phase census`);
      } else if (framework === 'kovo' && sample.phaseCensus?.workers?.complete !== true) {
        errors.push(`sample ${sampleNumber} omitted a complete Kovo worker-phase census`);
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
  }

  const validSamples = samples.filter(
    (sample) =>
      sample.exitCode === 0 &&
      sample.artifactBytes > 0 &&
      (framework !== 'kovo' ||
        (sample.phaseCensus?.source?.complete === true &&
          sample.phaseCensus?.workers?.complete === true)),
  ).length;
  const misses = iterations - validSamples;
  const complete = samples.length === iterations && errors.length === 0 && misses === 0;
  return {
    corpus: {
      approximateLoc: manifest.approximateLoc,
      manifestDigest: `sha256:${createHash('sha256').update(manifestText).digest('hex')}`,
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
      errors,
      iterations,
      misses,
      outputRoots: outputs,
      warmups,
    },
    mode,
    samples,
    schema: BUILD_BENCHMARK_SCHEMA,
    source,
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
  if (
    manifest.sourceDigest !== undefined &&
    !/^sha256:[0-9a-f]{64}$/u.test(requiredString(manifest.sourceDigest, 'sourceDigest'))
  ) {
    throw new TypeError('sourceDigest must be one prefixed lowercase SHA-256 digest');
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
    manifest.workload.routes !== routes
  ) {
    throw new TypeError('corpus size metadata does not match the authenticated workload');
  }
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
