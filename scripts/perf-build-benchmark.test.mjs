import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  applyBuildBenchmarkEdit,
  artifactBytesForOutputs,
  parseBuildPhaseCensus,
  runBuildBenchmark,
  summarizeBuildSamples,
} from './perf-build-benchmark.mjs';

const roots = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { force: true, recursive: true });
});

function temporaryRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'kovo-build-benchmark-test-'));
  roots.push(root);
  return root;
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

  it('recomputes workload shape integrity and refuses a zero-byte missing output', () => {
    const root = temporaryRoot();
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
    const corpus = path.join(root, 'manifest.json');
    writeFileSync(corpus, `${JSON.stringify(manifest)}\n`);
    const report = runBuildBenchmark({
      corpus,
      framework: 'nextjs',
      iterations: 1,
      mode: 'clean',
      warmups: 0,
    });
    expect(report.integrity).toMatchObject({
      complete: false,
      errors: ['sample 1 produced no bytes in its declared outputs'],
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
      runBuildBenchmark({
        corpus,
        framework: 'nextjs',
        iterations: 1,
        mode: 'clean',
        warmups: 0,
      }),
    ).toThrow('does not authenticate');
  });

  it('alternates distinct same-width edit revisions and restores the original source', () => {
    const root = temporaryRoot();
    mkdirSync(path.join(root, 'src'));
    const sourcePath = path.join(root, 'src/leaf.ts');
    const observationsPath = path.join(root, 'observations');
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
    const corpus = path.join(root, 'manifest.json');
    writeFileSync(corpus, `${JSON.stringify(manifest)}\n`);

    const report = runBuildBenchmark({
      corpus,
      framework: 'nextjs',
      iterations: 3,
      mode: 'edit',
      warmups: 0,
    });

    expect(report.integrity).toMatchObject({ complete: true, errors: [], misses: 0 });
    expect(readFileSync(observationsPath, 'utf8')).toBe(
      'export const revision = 1;\n' +
        'export const revision = 2;\n' +
        'export const revision = 1;\n',
    );
    expect(readFileSync(sourcePath, 'utf8')).toBe(original);
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
