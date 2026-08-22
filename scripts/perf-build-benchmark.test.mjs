import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  BUILD_COMMAND_DIAGNOSTICS_SCHEMA,
  applyBuildBenchmarkEdit,
  artifactBytesForOutputs,
  attributeKovoBuildWallTime,
  buildCommandDiagnostics,
  inspectBuildOutputContract,
  KOVO_BUILD_PHASE_ATTRIBUTION_SCHEMA,
  KOVO_BUILD_SOURCE_PHASES,
  KOVO_BUILD_WORKER_PHASES,
  packedBuildProductOptions,
  parseBuildPhaseCensus,
  runBuildBenchmark,
  summarizeBuildSamples,
} from './perf-build-benchmark.mjs';

const roots = [];
const stableProvenance = Object.freeze({
  commit: 'a'.repeat(40),
  dirty: false,
  dirtyPaths: Object.freeze([]),
  locks: Object.freeze({
    'benchmarks/harness/pnpm-lock.yaml': `sha256:${'b'.repeat(64)}`,
    'benchmarks/nextjs/pnpm-lock.yaml': `sha256:${'c'.repeat(64)}`,
    'pnpm-lock.yaml': `sha256:${'d'.repeat(64)}`,
  }),
});

const stableDependencies = Object.freeze({
  collectPerformanceProvenance: () => structuredClone(stableProvenance),
});

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { force: true, recursive: true });
});

function temporaryRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'kovo-build-benchmark-test-'));
  roots.push(root);
  return root;
}

function writeCorpusManifest(root, manifest, sourcePaths = ['src/leaf.ts']) {
  manifest.workload.buildOutputContract = 'required-nonempty-and-cleanup-absent/v1';
  manifest.shapeDigest = createHash('sha256')
    .update(JSON.stringify(manifest.workload))
    .digest('hex');
  if (Array.isArray(manifest.build.outputs)) {
    manifest.build.outputs = { absent: [], requiredNonempty: manifest.build.outputs };
  }
  manifest.sourceFiles = sourcePaths
    .slice()
    .sort()
    .map((file) => {
      const bytes = readFileSync(path.join(root, file));
      return {
        bytes: bytes.byteLength,
        file,
        sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      };
    });
  manifest.sourceDigest = `sha256:${createHash('sha256')
    .update(JSON.stringify(manifest.sourceFiles))
    .digest('hex')}`;
  writeFileSync(
    path.join(root, '.kovo-benchmark-corpus-owner.json'),
    `${JSON.stringify({
      appRoot: root,
      framework: manifest.framework,
      modules: manifest.modules,
      schema: 'kovo-benchmark-corpus-owner/v1',
    })}\n`,
  );
  const corpus = path.join(root, 'manifest.json');
  writeFileSync(corpus, `${JSON.stringify(manifest)}\n`);
  return corpus;
}

function nextManifest(commandSource, outputs) {
  const workload = {
    componentImportFanout: 1,
    editClasses: ['leaf'],
    routes: 1,
    stateSurface: 'local-counter',
    workloadModules: 1,
  };
  return {
    approximateLoc: 1,
    build: {
      command: { argv: [process.execPath, '-e', commandSource], cwd: '.', env: {} },
      edit: {
        file: 'src/leaf.ts',
        replacementTemplate: 'revision-{revision}',
        search: 'revision-0',
      },
      outputs,
    },
    framework: 'nextjs',
    modules: 1,
    routes: 1,
    schema: 'kovo-dev-corpus/v1',
    shapeDigest: '',
    workload,
  };
}

describe('production build benchmark adapter', () => {
  it('retains bounded authenticated subprocess diagnostics for failed builds', () => {
    const root = temporaryRoot();
    mkdirSync(path.join(root, 'src'));
    writeFileSync(path.join(root, 'src/leaf.ts'), 'revision-0\n');
    const stderr = `kovo-build/v1\nERROR actionable packed build failure\n${'x'.repeat(20_000)}`;
    const stdout = 'kovo-build-worker-phase-census/v1 {"complete":false}\n';
    const corpus = writeCorpusManifest(
      root,
      nextManifest(
        `process.stderr.write(${JSON.stringify(stderr)}); process.stdout.write(${JSON.stringify(
          stdout,
        )}); process.exit(7);`,
        { absent: [], requiredNonempty: ['dist'] },
      ),
    );
    const report = runBuildBenchmark(
      { corpus, framework: 'nextjs', iterations: 1, mode: 'clean', warmups: 0 },
      stableDependencies,
    );
    const diagnostics = report.samples[0].commandDiagnostics;
    expect(report.integrity.errors[0]).toContain('exit 7: ERROR actionable packed build failure');
    expect(diagnostics.schema).toBe(BUILD_COMMAND_DIAGNOSTICS_SCHEMA);
    expect(diagnostics.stderr).toMatchObject({
      bytes: Buffer.byteLength(stderr),
      sha256: `sha256:${createHash('sha256').update(stderr).digest('hex')}`,
      truncated: true,
    });
    expect(diagnostics.stderr.text).toContain('ERROR actionable packed build failure');
    expect(diagnostics.stderr.text).toContain('[bounded diagnostic truncated]');
    expect(diagnostics.stdout).toEqual({
      bytes: Buffer.byteLength(stdout),
      sha256: `sha256:${createHash('sha256').update(stdout).digest('hex')}`,
      text: stdout,
      truncated: false,
    });
    expect(buildCommandDiagnostics({ stderr: '', stdout: '' })).toMatchObject({
      schema: BUILD_COMMAND_DIAGNOSTICS_SCHEMA,
      stderr: { bytes: 0, truncated: false },
      stdout: { bytes: 0, truncated: false },
    });
  });

  it('requires paired packed-product descriptor arguments', () => {
    const digest = `sha256:${'a'.repeat(64)}`;
    expect(packedBuildProductOptions({})).toEqual({});
    expect(
      packedBuildProductOptions({
        'packed-product': '/tmp/consumer/.kovo-perf-packed-product.json',
        'packed-product-digest': digest,
      }),
    ).toEqual({
      packedProduct: {
        descriptorPath: '/tmp/consumer/.kovo-perf-packed-product.json',
        digest,
      },
    });
    expect(() => packedBuildProductOptions({ 'packed-product': '/tmp/descriptor' })).toThrow(
      /packed product digest/u,
    );
    expect(() => packedBuildProductOptions({ 'packed-product-digest': digest })).toThrow(
      /packed product descriptor/u,
    );
  });

  it('extracts the complete nested Kovo source and worker censuses', () => {
    const source = {
      complete: true,
      phases: [{ durationMs: 12, name: 'typescript', status: 'executed' }],
      schema: 'kovo-build-source-phase-census/v1',
    };
    const workers = {
      complete: true,
      phases: [{ durationMs: 20, name: 'analyze', status: 0 }],
      schema: 'kovo-build-worker-phase-census/v1',
    };
    expect(
      parseBuildPhaseCensus(
        `noise\nkovo-build-source-phase-census/v1 ${JSON.stringify(source)}\n` +
          `kovo-build-worker-phase-census/v1 ${JSON.stringify(workers)}\n`,
      ),
    ).toEqual({ source, workers });
  });

  it('accounts for the CLI/startup tail from only the sequential worker envelope', () => {
    const phaseCensus = validKovoPhaseCensus();
    // SPEC §5.2 rule 9: source proof lives inside analyze; its timings cannot be added to the
    // deploy-proof worker envelope. Deliberately make that nested sum larger than analyze here.
    phaseCensus.source.phases.forEach((phase) => {
      phase.durationMs = 4;
    });
    const result = attributeKovoBuildWallTime({
      durationMs: 50,
      expectedSourcePath: 'src/app.tsx',
      phaseCensus,
    });
    expect(result).toEqual({
      cliStartupTail: {
        durationMs: 10,
        source: {
          envelope: 'kovo-build-worker-phase-census/v1.totalWorkerMs',
          operation: 'wall-minus-sequential-worker-envelope',
          wall: 'measureProcessTreeCommand.durationMs',
        },
        status: 'measured-residual',
      },
      complete: true,
      errors: [],
      phaseEnvelope: {
        durationMs: 40,
        phases: KOVO_BUILD_WORKER_PHASES,
        source: 'kovo-build-worker-phase-census/v1.totalWorkerMs',
        status: 'authenticated-sequential',
      },
      schema: KOVO_BUILD_PHASE_ATTRIBUTION_SCHEMA,
      sourceCheck: {
        nestedWithin: 'analyze',
        phases: KOVO_BUILD_SOURCE_PHASES,
        source: 'kovo-build-source-phase-census/v1',
        status: 'authenticated-nested',
      },
      wallDurationMs: 50,
    });
  });

  it('fails closed instead of clamping or guessing an invalid phase residual', () => {
    const phaseCensus = validKovoPhaseCensus();
    phaseCensus.workers.totalWorkerMs = 51;
    phaseCensus.workers.phases[3].durationMs = 21;
    const negative = attributeKovoBuildWallTime({
      durationMs: 50,
      expectedSourcePath: 'src/app.tsx',
      phaseCensus,
    });
    expect(negative.complete).toBe(false);
    expect(negative.cliStartupTail).toMatchObject({ durationMs: null, status: 'unproven' });
    expect(negative.errors).toContain('worker phase envelope exceeds measured build wall time');

    phaseCensus.workers.totalWorkerMs = 40;
    phaseCensus.workers.phases[3].durationMs = 10;
    phaseCensus.source.phases.pop();
    const incomplete = attributeKovoBuildWallTime({
      durationMs: 50,
      expectedSourcePath: 'src/app.tsx',
      phaseCensus,
    });
    expect(incomplete.complete).toBe(false);
    expect(incomplete.errors).toContain(
      'source census does not contain the complete ordered phase set',
    );
  });

  it('edits exactly one declared line and restores no implicit paths', () => {
    const root = temporaryRoot();
    mkdirSync(path.join(root, 'src'));
    const file = path.join(root, 'src/leaf.ts');
    writeFileSync(file, 'export const revision = 0;\n');
    applyBuildBenchmarkEdit(
      root,
      {
        file: 'src/leaf.ts',
        replacementTemplate: 'export const revision = {revision};',
        search: 'export const revision = 0;',
      },
      7,
    );
    expect(readFileSync(file, 'utf8')).toBe('export const revision = 7;\n');
    expect(() =>
      applyBuildBenchmarkEdit(
        root,
        {
          file: '../outside.ts',
          replacementTemplate: '{revision}',
          search: 'x',
        },
        1,
      ),
    ).toThrow(/escapes/u);
  });

  it('counts regular artifact bytes without following symlinks', () => {
    const root = temporaryRoot();
    mkdirSync(path.join(root, 'dist/nested'), { recursive: true });
    writeFileSync(path.join(root, 'dist/a'), '1234');
    writeFileSync(path.join(root, 'dist/nested/b'), '567');
    writeFileSync(path.join(root, 'outside'), 'must-not-be-counted');
    symlinkSync(path.join(root, 'outside'), path.join(root, 'dist/nested/link'));
    expect(artifactBytesForOutputs(root, ['dist', 'dist'])).toBe(7);
  });

  it('requires every output independently and rejects a leftover staging pattern', () => {
    const root = temporaryRoot();
    mkdirSync(path.join(root, '.kovo'));
    mkdirSync(path.join(root, 'dist'));
    writeFileSync(path.join(root, '.kovo/manifest.json'), '{}');
    writeFileSync(path.join(root, 'dist/server.mjs'), 'export {};');
    expect(
      inspectBuildOutputContract(root, {
        absent: ['.kovo-build-stage-*'],
        requiredNonempty: ['.kovo', 'dist'],
      }),
    ).toMatchObject({ complete: true, totalBytes: 12 });

    mkdirSync(path.join(root, '.kovo-build-stage-stale'));
    writeFileSync(path.join(root, '.kovo-build-stage-stale/partial'), 'partial');
    const stale = inspectBuildOutputContract(root, {
      absent: ['.kovo-build-stage-*'],
      requiredNonempty: ['.kovo', 'dist', 'missing-output'],
    });
    expect(stale.complete).toBe(false);
    expect(stale.requiredNonempty).toContainEqual({
      bytes: 0,
      output: 'missing-output',
      targets: ['missing-output'],
    });
    expect(stale.absent).toEqual([
      {
        matches: ['.kovo-build-stage-stale'],
        output: '.kovo-build-stage-*',
      },
    ]);
  });

  it('recomputes workload shape integrity and refuses a zero-byte missing output', () => {
    const root = temporaryRoot();
    mkdirSync(path.join(root, 'src'));
    writeFileSync(path.join(root, 'src/leaf.ts'), 'revision-0\n');
    const workload = {
      componentImportFanout: 24,
      editClasses: ['leaf', 'entry', 'data', 'syntaxError', 'recovery'],
      routes: 4,
      stateSurface: 'local-counter',
      workloadModules: 24,
    };
    const manifest = {
      approximateLoc: 100,
      build: {
        command: { argv: [process.execPath, '-e', 'process.exit(0)'], cwd: '.', env: {} },
        edit: {
          file: 'src/leaf.ts',
          replacementTemplate: 'revision-{revision}',
          search: 'revision-0',
        },
        outputs: ['dist'],
      },
      framework: 'nextjs',
      modules: 24,
      routes: 4,
      schema: 'kovo-dev-corpus/v1',
      shapeDigest: createHash('sha256').update(JSON.stringify(workload)).digest('hex'),
      workload,
    };
    const corpus = writeCorpusManifest(root, manifest);
    const report = runBuildBenchmark(
      {
        corpus,
        framework: 'nextjs',
        iterations: 1,
        mode: 'clean',
        warmups: 0,
      },
      stableDependencies,
    );
    expect(report.integrity).toMatchObject({
      complete: false,
      errors: ['sample 1 required output dist was empty or missing'],
      misses: 1,
      warmups: 0,
    });
    expect(report.samples).toMatchObject([{ artifactBytes: 0, exitCode: 0 }]);
    expect(report.corpus.manifestPath).toMatch(/manifest\.json$/u);
    expect(report.source.locks).toEqual({
      'benchmarks/harness/pnpm-lock.yaml': expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      'benchmarks/nextjs/pnpm-lock.yaml': expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      'pnpm-lock.yaml': expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    });

    writeFileSync(corpus, `${JSON.stringify({ ...manifest, shapeDigest: '0'.repeat(64) })}\n`);
    expect(() =>
      runBuildBenchmark(
        {
          corpus,
          framework: 'nextjs',
          iterations: 1,
          mode: 'clean',
          warmups: 0,
        },
        stableDependencies,
      ),
    ).toThrow('does not authenticate');
  });

  it('alternates distinct same-width edit revisions and restores the original source', () => {
    const root = temporaryRoot();
    mkdirSync(path.join(root, 'src'));
    const sourcePath = path.join(root, 'src/leaf.ts');
    const observationsPath = path.join(root, 'dist/observations');
    const original = 'export const revision = 0;\n';
    writeFileSync(sourcePath, original);
    const commandSource = [
      "const { appendFileSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');",
      "mkdirSync('dist', { recursive: true });",
      "const source = readFileSync('src/leaf.ts', 'utf8');",
      `appendFileSync(${JSON.stringify(observationsPath)}, source);`,
      "writeFileSync('dist/out.js', source);",
    ].join('\n');
    const workload = {
      componentImportFanout: 1,
      editClasses: ['leaf'],
      routes: 1,
      stateSurface: 'local-counter',
      workloadModules: 1,
    };
    const manifest = {
      approximateLoc: 1,
      build: {
        command: { argv: [process.execPath, '-e', commandSource], cwd: '.', env: {} },
        edit: {
          file: 'src/leaf.ts',
          replacementTemplate: 'export const revision = {revision};',
          search: 'export const revision = 0;',
        },
        outputs: ['dist'],
      },
      framework: 'nextjs',
      modules: 1,
      routes: 1,
      schema: 'kovo-dev-corpus/v1',
      shapeDigest: createHash('sha256').update(JSON.stringify(workload)).digest('hex'),
      workload,
    };
    const corpus = writeCorpusManifest(root, manifest);

    const report = runBuildBenchmark(
      {
        corpus,
        framework: 'nextjs',
        iterations: 3,
        mode: 'edit',
        warmups: 0,
      },
      stableDependencies,
    );

    expect(report.integrity).toMatchObject({ complete: true, errors: [], misses: 0 });
    expect(report.integrity.corpus.stable).toBe(true);
    expect(report.integrity.source.stable).toBe(true);
    expect(report.productArtifact).toBeNull();
    expect(report.integrity.productArtifact).toEqual({
      afterVerified: true,
      beforeVerified: false,
      required: false,
    });
    expect(report.sourceAfter).toMatchObject({
      commit: report.source.commit,
      dirtyPaths: report.source.dirtyPaths,
      locks: report.source.locks,
    });
    expect(readFileSync(observationsPath, 'utf8')).toBe(
      'export const revision = 1;\n' +
        'export const revision = 2;\n' +
        'export const revision = 1;\n',
    );
    expect(readFileSync(sourcePath, 'utf8')).toBe(original);
  });

  it('marks a build incomplete when one required output is missing despite other bytes', () => {
    const root = temporaryRoot();
    mkdirSync(path.join(root, 'src'));
    writeFileSync(path.join(root, 'src/leaf.ts'), 'revision-0\n');
    const commandSource = [
      "const { mkdirSync, writeFileSync } = require('node:fs');",
      "mkdirSync('dist', { recursive: true });",
      "writeFileSync('dist/out.js', 'nonzero');",
    ].join('\n');
    const corpus = writeCorpusManifest(
      root,
      nextManifest(commandSource, {
        absent: [],
        requiredNonempty: ['dist', 'server-output'],
      }),
    );
    const report = runBuildBenchmark(
      {
        corpus,
        framework: 'nextjs',
        iterations: 1,
        mode: 'clean',
        warmups: 0,
      },
      stableDependencies,
    );
    expect(report.samples[0]).toMatchObject({
      artifactBytes: 7,
      outputCensus: {
        complete: false,
        requiredNonempty: [
          { bytes: 7, output: 'dist' },
          { bytes: 0, output: 'server-output' },
        ],
      },
    });
    expect(report.integrity.errors).toContain(
      'sample 1 required output server-output was empty or missing',
    );
    expect(report.integrity.complete).toBe(false);
  });

  it('rejects a forbidden staging leftover after an otherwise successful build', () => {
    const root = temporaryRoot();
    mkdirSync(path.join(root, 'src'));
    writeFileSync(path.join(root, 'src/leaf.ts'), 'revision-0\n');
    const commandSource = [
      "const { mkdirSync, writeFileSync } = require('node:fs');",
      "mkdirSync('.next', { recursive: true });",
      "mkdirSync('.kovo-build-stage-stale', { recursive: true });",
      "writeFileSync('.next/out.js', 'ok');",
      "writeFileSync('.kovo-build-stage-stale/partial', 'bad');",
    ].join('\n');
    const corpus = writeCorpusManifest(
      root,
      nextManifest(commandSource, {
        absent: ['.kovo-build-stage-*'],
        requiredNonempty: ['.next'],
      }),
    );
    const report = runBuildBenchmark(
      {
        corpus,
        framework: 'nextjs',
        iterations: 1,
        mode: 'clean',
        warmups: 0,
      },
      stableDependencies,
    );
    expect(report.samples[0].outputCensus).toMatchObject({ complete: false });
    expect(report.integrity.errors).toContain(
      'sample 1 left forbidden output .kovo-build-stage-*: .kovo-build-stage-stale',
    );
  });

  it('detects command source drift and rejects a tampered ownership sentinel', () => {
    const root = temporaryRoot();
    mkdirSync(path.join(root, 'src'));
    writeFileSync(path.join(root, 'src/leaf.ts'), 'revision-0\n');
    writeFileSync(path.join(root, 'src/other.ts'), 'stable\n');
    const commandSource = [
      "const { mkdirSync, writeFileSync } = require('node:fs');",
      "mkdirSync('.next', { recursive: true });",
      "writeFileSync('.next/out.js', 'ok');",
      "writeFileSync('src/other.ts', 'mutated\\n');",
    ].join('\n');
    const manifest = nextManifest(commandSource, {
      absent: [],
      requiredNonempty: ['.next'],
    });
    const corpus = writeCorpusManifest(root, manifest, ['src/leaf.ts', 'src/other.ts']);
    const report = runBuildBenchmark(
      {
        corpus,
        framework: 'nextjs',
        iterations: 1,
        mode: 'clean',
        warmups: 0,
      },
      stableDependencies,
    );
    expect(report.samples[0].corpus.stable).toBe(false);
    expect(report.integrity.errors).toContain(
      'sample 1 changed the authenticated corpus source state',
    );
    expect(report.integrity.errors).toContain(
      'post-run corpus integrity: post-run corpus sourceDigest does not match current source bytes',
    );
    expect(report.integrity.complete).toBe(false);

    writeFileSync(
      path.join(root, '.kovo-benchmark-corpus-owner.json'),
      `${JSON.stringify({
        appRoot: root,
        extraAuthority: true,
        framework: 'nextjs',
        modules: 1,
        schema: 'kovo-benchmark-corpus-owner/v1',
      })}\n`,
    );
    expect(() =>
      runBuildBenchmark(
        {
          corpus,
          framework: 'nextjs',
          iterations: 1,
          mode: 'clean',
          warmups: 0,
        },
        stableDependencies,
      ),
    ).toThrow('ownership sentinel does not authenticate');
  });

  it('reports median, MAD, interpolated p95, RSS, and final artifact bytes', () => {
    expect(
      summarizeBuildSamples([
        { artifactBytes: 10, durationMs: 10, peakRssBytes: 100 },
        { artifactBytes: 11, durationMs: 20, peakRssBytes: 300 },
        { artifactBytes: 12, durationMs: 40, peakRssBytes: 200 },
      ]),
    ).toEqual({
      artifactBytes: 12,
      durationMadMs: 10,
      durationMedianMs: 20,
      durationP95Ms: 38,
      peakRssBytes: 300,
    });

    const phaseCensus = validKovoPhaseCensus();
    const phaseAttribution = attributeKovoBuildWallTime({
      durationMs: 50,
      expectedSourcePath: 'src/app.tsx',
      phaseCensus,
    });
    expect(
      summarizeBuildSamples([
        {
          artifactBytes: 12,
          durationMs: 50,
          peakRssBytes: 300,
          phaseAttribution,
          phaseCensus,
        },
      ]).phaseEvidence,
    ).toEqual([{ attribution: phaseAttribution, census: phaseCensus, sample: 1 }]);
  });
});

function validKovoPhaseCensus() {
  return {
    source: {
      checkGraphDigest: `sha256:${'a'.repeat(64)}`,
      complete: true,
      phases: KOVO_BUILD_SOURCE_PHASES.map((name) => ({
        durationMs: 1,
        name,
        status: 'executed',
      })),
      schema: 'kovo-build-source-phase-census/v1',
      source: {
        codeUnitLength: 100,
        contentHash: `sha256:${'b'.repeat(64)}`,
        encoding: 'utf16le',
        path: 'src/app.tsx',
      },
      sourceSetDigest: `sha256:${'c'.repeat(64)}`,
    },
    workers: {
      complete: true,
      phases: KOVO_BUILD_WORKER_PHASES.map((name) => ({
        durationMs: 10,
        name,
        status: 0,
      })),
      schema: 'kovo-build-worker-phase-census/v1',
      sourcePath: 'src/app.tsx',
      totalWorkerMs: 40,
    },
  };
}
