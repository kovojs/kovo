import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  applyBuildBenchmarkEdit,
  artifactBytesForOutputs,
  inspectBuildOutputContract,
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
  });
});
