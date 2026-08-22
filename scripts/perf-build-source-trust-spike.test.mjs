import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  aggregateBuildSourceTrustCells,
  authenticateBuildSourceTrustRoots,
  BUILD_SOURCE_TRUST_ARTIFACT_SCHEMA,
  BUILD_SOURCE_TRUST_BOUNDARY_POLICY,
  BUILD_SOURCE_TRUST_BOUNDARY_POLICY_SCHEMA,
  BUILD_SOURCE_TRUST_CANDIDATE,
  BUILD_SOURCE_TRUST_CANDIDATE_BINDING_SCHEMA,
  BUILD_SOURCE_TRUST_SPIKE_SCHEMA,
  BUILD_SOURCE_TRUST_TRANSIENT_CACHE_SCHEMA,
  bindBuildSourceTrustArtifactProvenanceLock,
  buildSourceTrustAdapterFailure,
  buildSourceTrustBoundaryPolicyFindings,
  buildSourceTrustNonTimingDiagnostics,
  buildSourceTrustSchedule,
  buildSourceTrustVerdict,
  createBuildSourceTrustHostAdmission,
  executeBuildSourceTrustCell,
  gitPatchId,
  inspectBuildSourceTrustArtifact,
  inspectExternalKovoCorpus,
  removeBuildSourceTrustColdTransientCache,
  pairedBuildSourceTrustBootstrap,
  parseBuildSourceTrustArgs,
  prepareBuildSourceTrustSpike,
  sameBuildSourceTrustCorpusWorkload,
  summarizeBuildSourceTrustMetric,
  validateBuildSourceTrustCell,
} from './perf-build-source-trust-spike.mjs';
import { fixturePackedKovoProductIdentity } from './fixtures/perf-packed-product-identity.mjs';
import {
  assertPackedCorpusIsolation,
  materializePackedKovoCommand,
  normalizedPackedKovoCommand,
} from './lib/perf-packed-kovo-product.mjs';

const temporaryRoots = [];
const SOURCE_PHASES = [
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
];
const WORKER_PHASES = ['analyze', 'client', 'server', 'final'];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('build source-trust candidate decision', () => {
  it('binds the sealed candidate and exact external packed-product posture', () => {
    expect(BUILD_SOURCE_TRUST_SPIKE_SCHEMA).toBe('kovo-build-source-trust-spike/v1');
    expect(BUILD_SOURCE_TRUST_CANDIDATE_BINDING_SCHEMA).toBe(
      'kovo-build-source-trust-candidate-binding/v1',
    );
    expect(BUILD_SOURCE_TRUST_BOUNDARY_POLICY_SCHEMA).toBe(
      'kovo-build-source-trust-boundary-policy/v1',
    );
    expect(BUILD_SOURCE_TRUST_BOUNDARY_POLICY).toEqual({
      artifactProvenanceLock: 'measured-source-root-copy-manifest-bound',
      coldBuildTransientCache:
        'required-single-tsbuildinfo-removed-after-adapter-before-compared-artifact-census',
      comparedArtifact: 'byte-exact-non-cache-.kovo-and-dist-after-transient-cache-custody',
      concreteIdentity: 'report-bound-per-arm',
      corpusIsolation: 'external-root-without-ancestor-node-modules',
      hostAdmission: 'before-preparation-and-before-every-measured-block',
      kovo: 'required',
      nextjs: 'forbidden-zero-cells',
      preparationTiming: 'after-preparation-host-admission-and-outside-samples',
      productIdentitySchema: 'kovo-packed-product-identity/v1',
      schema: BUILD_SOURCE_TRUST_BOUNDARY_POLICY_SCHEMA,
      sharedIsolationPolicySchema: 'kovo-packed-product-workload-policy/v1',
      timedWarmups: 0,
    });
    expect(buildSourceTrustBoundaryPolicyFindings(BUILD_SOURCE_TRUST_BOUNDARY_POLICY)).toEqual([]);
    expect(BUILD_SOURCE_TRUST_CANDIDATE).toEqual({
      commit: 'ef242a30662b767fec6f44bd23dfeeb700bd5c66',
      parent: '81742e2285dda9f5419bb4531ed83b5dbfe0bb1c',
      patchBytes: 65_349,
      patchId: '98c01cb77fde51a19fd23fbe5f8a7061bfc459c1',
      patchSha256: 'sha256:e71178ed5d9ab24439331005b0f77c830a7ada2c77c8f6e10b552bd60cf18e65',
      pathChanges: [
        {
          path: 'packages/cli/src/capability-closure-packages.test.ts',
          status: 'M',
        },
        {
          path: 'packages/cli/src/capability-closure-packages.ts',
          status: 'M',
        },
        { path: 'packages/cli/src/commands/build-export.ts', status: 'M' },
        {
          path: 'packages/cli/src/dependency-capability-loader.test.ts',
          status: 'M',
        },
        {
          path: 'packages/cli/src/dependency-capability-loader.ts',
          status: 'M',
        },
        {
          path: 'scripts/check-spec-conformance-closure.mjs',
          status: 'M',
        },
        { path: 'security/diagnostic-conformance-evidence.json', status: 'M' },
        {
          path: 'security/framework-public-runtime-export-posture.json',
          status: 'M',
        },
      ],
      ref: 'refs/heads/perf-spike/build-package-snapshot-sealed-20260822',
      tree: 'd8c1f334f3c6035b26c42ed017823f5c025b2a4d',
    });
  });

  it('expands exactly five serialized B,S,S,B repetitions into ten samples per arm', () => {
    const schedule = buildSourceTrustSchedule();
    expect(schedule).toHaveLength(20);
    expect(schedule.map((cell) => cell.lane)).toEqual(
      Array.from({ length: 5 }, () => ['baseline', 'spike', 'spike', 'baseline']).flat(),
    );
    expect(
      schedule.filter((cell) => cell.lane === 'baseline').map((cell) => cell.occurrence),
    ).toEqual(Array.from({ length: 10 }, (_unused, index) => index));
    expect(schedule.filter((cell) => cell.lane === 'spike').map((cell) => cell.occurrence)).toEqual(
      Array.from({ length: 10 }, (_unused, index) => index),
    );
    expect(buildSourceTrustSchedule(1)).toEqual([
      { lane: 'baseline', occurrence: 0, position: 0, repetition: 0, scheduleIndex: 0 },
      { lane: 'spike', occurrence: 0, position: 1, repetition: 0, scheduleIndex: 1 },
      { lane: 'spike', occurrence: 1, position: 2, repetition: 0, scheduleIndex: 2 },
      { lane: 'baseline', occurrence: 1, position: 3, repetition: 0, scheduleIndex: 3 },
    ]);
  });

  it('reports count, median, MAD, p95 and deterministic paired bootstrap evidence', () => {
    expect(summarizeBuildSourceTrustMetric([9, 1, 3])).toEqual({
      count: 3,
      mad: 2,
      median: 3,
      p95: 8.399999999999999,
    });
    expect(
      pairedBuildSourceTrustBootstrap([100, 100, 100], [80, 80, 80], { iterations: 500 }),
    ).toEqual([20, 20]);
    expect(() => pairedBuildSourceTrustBootstrap([1], [1, 2])).toThrow(/identical sample counts/u);
  });

  it('authenticates exact object, direct-commit patch bytes, patch-id and status/path census', () => {
    const fixture = candidateFixture();
    const binding = authenticateBuildSourceTrustRoots(
      {
        baselineRoot: fixture.baseline,
        candidate: fixture.candidate,
        candidateRepository: fixture.repository,
        spikeRoot: fixture.spike,
      },
      fixture.dependencies,
    );
    expect(binding).toEqual({
      baseline: { commit: fixture.baselineCommit, root: realpathSync(fixture.baseline) },
      candidate: fixture.candidate,
      schema: BUILD_SOURCE_TRUST_CANDIDATE_BINDING_SCHEMA,
      spike: {
        commit: fixture.spikeCommit,
        parent: fixture.baselineCommit,
        root: realpathSync(fixture.spike),
      },
    });
  });

  it('rejects dirty or non-direct roots, identity drift, patch drift and path drift', () => {
    const dirty = candidateFixture({ spikeStatus: ' M packages/compiler/src/scan/parse.ts' });
    expect(() =>
      authenticateBuildSourceTrustRoots(
        {
          baselineRoot: dirty.baseline,
          candidate: dirty.candidate,
          candidateRepository: dirty.repository,
          spikeRoot: dirty.spike,
        },
        dirty.dependencies,
      ),
    ).toThrow(/must be clean/u);

    const patchDrift = candidateFixture();
    expect(() =>
      authenticateBuildSourceTrustRoots(
        {
          baselineRoot: patchDrift.baseline,
          candidate: patchDrift.candidate,
          candidateRepository: patchDrift.repository,
          spikeRoot: patchDrift.spike,
        },
        { ...patchDrift.dependencies, patch: () => Buffer.from('different') },
      ),
    ).toThrow(/does not exactly match/u);

    const pathDrift = candidateFixture({ pathStatus: 'M\tunexpected.ts' });
    expect(() =>
      authenticateBuildSourceTrustRoots(
        {
          baselineRoot: pathDrift.baseline,
          candidate: pathDrift.candidate,
          candidateRepository: pathDrift.repository,
          spikeRoot: pathDrift.spike,
        },
        pathDrift.dependencies,
      ),
    ).toThrow(/path census differs/u);

    const rangeDrift = candidateFixture({ rangeCount: '2' });
    expect(() =>
      authenticateBuildSourceTrustRoots(
        {
          baselineRoot: rangeDrift.baseline,
          candidate: rangeDrift.candidate,
          candidateRepository: rangeDrift.repository,
          spikeRoot: rangeDrift.spike,
        },
        rangeDrift.dependencies,
      ),
    ).toThrow(/exactly one commit/u);

    const headDrift = candidateFixture();
    expect(() =>
      authenticateBuildSourceTrustRoots(
        {
          baselineRoot: headDrift.baseline,
          candidate: { ...headDrift.candidate, parent: 'x'.repeat(40) },
          candidateRepository: headDrift.repository,
          spikeRoot: headDrift.spike,
        },
        headDrift.dependencies,
      ),
    ).toThrow(/sealed candidate parent\/commit pair/u);

    const refDrift = candidateFixture();
    let refReads = 0;
    expect(() =>
      authenticateBuildSourceTrustRoots(
        {
          baselineRoot: refDrift.baseline,
          candidate: refDrift.candidate,
          candidateRepository: refDrift.repository,
          spikeRoot: refDrift.spike,
        },
        {
          ...refDrift.dependencies,
          git(root, args) {
            if (args.join(' ') === `rev-parse ${refDrift.candidate.ref}^{commit}`) {
              refReads += 1;
              return refReads === 1 ? refDrift.candidate.commit : 'd'.repeat(40);
            }
            return refDrift.dependencies.git(root, args);
          },
        },
      ),
    ).toThrow(/durable ref moved/u);
  });

  it('derives patch IDs from binary bytes without allowing external diff drivers', () => {
    const root = temporaryDirectory('kovo-build-source-patch-id-');
    execFileSync('git', ['init', '--quiet', root]);
    execFileSync('git', ['-C', root, 'config', 'user.email', 'perf-test@example.invalid']);
    execFileSync('git', ['-C', root, 'config', 'user.name', 'Perf Test']);
    writeFileSync(path.join(root, '.gitattributes'), '*.bin diff=hostile\n');
    writeFileSync(path.join(root, 'payload.bin'), Buffer.from([0, 1, 2, 3]));
    execFileSync('git', ['-C', root, 'add', '.gitattributes', 'payload.bin']);
    execFileSync('git', ['-C', root, 'commit', '--quiet', '-m', 'base']);
    const base = String(execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'])).trim();
    execFileSync('git', ['-C', root, 'config', 'diff.hostile.command', 'false']);

    writeFileSync(path.join(root, 'payload.bin'), Buffer.from([0, 4, 5, 6]));
    execFileSync('git', ['-C', root, 'add', 'payload.bin']);
    execFileSync('git', ['-C', root, 'commit', '--quiet', '-m', 'first binary candidate']);
    const first = gitPatchId(root, 'HEAD');

    execFileSync('git', ['-C', root, 'switch', '--quiet', '--detach', base]);
    writeFileSync(path.join(root, 'payload.bin'), Buffer.from([0, 7, 8, 9]));
    execFileSync('git', ['-C', root, 'add', 'payload.bin']);
    execFileSync('git', ['-C', root, 'commit', '--quiet', '-m', 'second binary candidate']);
    const second = gitPatchId(root, 'HEAD');

    expect(first).toMatch(/^[0-9a-f]{40}$/u);
    expect(second).toMatch(/^[0-9a-f]{40}$/u);
    expect(second).not.toBe(first);
  });

  it('passes packed preparation through the shared fixture contract under the prepared key', async () => {
    const baseline = preparationSourceRoot('baseline');
    const spike = preparationSourceRoot('spike');
    const packed = { cleanup: vi.fn() };
    const createPackedFixture = vi.fn((options) => {
      expect(options).toEqual({
        prepared: packed,
        source: baseline.state,
        sourceAfter: baseline.state,
      });
      expect(options).not.toHaveProperty('packed');
      throw new Error('fixture-contract-proved');
    });

    await expect(
      prepareBuildSourceTrustSpike(
        {
          baselineRoot: baseline.root,
          candidateBinding: {
            baseline: { commit: baseline.state.commit, root: baseline.root },
            candidate: BUILD_SOURCE_TRUST_CANDIDATE,
            schema: BUILD_SOURCE_TRUST_CANDIDATE_BINDING_SCHEMA,
            spike: {
              commit: spike.state.commit,
              parent: baseline.state.commit,
              root: spike.root,
            },
          },
          installTimeoutMs: 60_000,
          size: 24,
          spikeRoot: spike.root,
        },
        {
          loadRootModules: async () => ({
            collectProvenance: () => baseline.state,
            createPackedFixture,
            preparePacked: async () => packed,
          }),
        },
      ),
    ).rejects.toThrow('fixture-contract-proved');
    expect(createPackedFixture).toHaveBeenCalledOnce();
    expect(packed.cleanup).toHaveBeenCalledOnce();
  });

  it('hashes the exact output tree, census, bytes, modes and content without following links', () => {
    const root = temporaryDirectory('kovo-build-source-artifact-');
    mkdirSync(path.join(root, '.kovo'), { recursive: true });
    mkdirSync(path.join(root, 'dist/assets'), { recursive: true });
    writeFileSync(path.join(root, '.kovo/manifest.json'), '{}\n');
    writeFileSync(path.join(root, 'dist/index.mjs'), 'export default 1;\n');
    writeFileSync(path.join(root, 'dist/assets/a.css'), 'a{}\n');
    const first = inspectBuildSourceTrustArtifact(root, {
      absent: ['.kovo-build-stage-*'],
      requiredNonempty: ['.kovo', 'dist'],
    });
    expect(first.schema).toBe(BUILD_SOURCE_TRUST_ARTIFACT_SCHEMA);
    expect(first.entries.map((entry) => entry.path)).toEqual([
      '.kovo',
      '.kovo/manifest.json',
      'dist',
      'dist/assets',
      'dist/assets/a.css',
      'dist/index.mjs',
    ]);
    expect(first.totalBytes).toBe(Buffer.byteLength('{}\nexport default 1;\na{}\n'));
    writeFileSync(path.join(root, 'dist/index.mjs'), 'export default 2;\n');
    const second = inspectBuildSourceTrustArtifact(root, {
      absent: ['.kovo-build-stage-*'],
      requiredNonempty: ['.kovo', 'dist'],
    });
    expect(second.totalBytes).toBe(first.totalBytes);
    expect(second.digest).not.toBe(first.digest);
  });

  it('removes only the exact cold TypeScript cache and retains authenticated byte custody', () => {
    const root = temporaryDirectory('kovo-build-source-cold-cache-');
    const cacheRoot = path.join(root, '.kovo/cache');
    const cachePath = path.join(cacheRoot, 'tsc-preflight.tsbuildinfo');
    const cacheBytes = Buffer.from('{"root":"/invocation/path"}\n');
    mkdirSync(cacheRoot, { recursive: true });
    writeFileSync(cachePath, cacheBytes);
    const custody = removeBuildSourceTrustColdTransientCache(root);
    expect(custody).toMatchObject({
      absentAfter: true,
      before: {
        entries: [
          { path: '.kovo/cache', type: 'directory' },
          {
            bytes: cacheBytes.byteLength,
            path: '.kovo/cache/tsc-preflight.tsbuildinfo',
            sha256: sha256(cacheBytes),
            type: 'file',
          },
        ],
        totalBytes: cacheBytes.byteLength,
      },
      complete: true,
      mutation: {
        confinedTo: '.kovo/cache',
        operations: ['unlink:tsc-preflight.tsbuildinfo', 'rmdir:.kovo/cache'],
      },
      outsideTiming: true,
      parent: { emptyAfter: true, path: '.kovo', retainedAfter: true },
      path: '.kovo/cache',
      schema: BUILD_SOURCE_TRUST_TRANSIENT_CACHE_SCHEMA,
      stage: 'after-adapter-return-before-compared-artifact-census',
    });
    expect(custody.before.digest).toBe(
      sha256(
        Buffer.from(
          JSON.stringify({
            entries: custody.before.entries,
            totalBytes: custody.before.totalBytes,
          }),
        ),
      ),
    );
    expect(existsSync(cacheRoot)).toBe(false);
    expect(existsSync(path.join(root, '.kovo'))).toBe(true);
  });

  it('refuses extra, symlinked, or hardlinked cold-cache entries without deleting them', () => {
    const extraRoot = temporaryDirectory('kovo-build-source-cold-cache-extra-');
    const extraCache = path.join(extraRoot, '.kovo/cache');
    mkdirSync(extraCache, { recursive: true });
    writeFileSync(path.join(extraCache, 'tsc-preflight.tsbuildinfo'), 'cache\n');
    writeFileSync(path.join(extraCache, 'unexpected'), 'retain me\n');
    expect(() => removeBuildSourceTrustColdTransientCache(extraRoot)).toThrow(
      /only tsc-preflight/u,
    );
    expect(readFileSync(path.join(extraCache, 'unexpected'), 'utf8')).toBe('retain me\n');

    for (const alias of ['symlink', 'hardlink']) {
      const root = temporaryDirectory(`kovo-build-source-cold-cache-${alias}-`);
      const cacheRoot = path.join(root, '.kovo/cache');
      const cachePath = path.join(cacheRoot, 'tsc-preflight.tsbuildinfo');
      const outside = path.join(root, 'outside-cache');
      mkdirSync(cacheRoot, { recursive: true });
      writeFileSync(outside, 'outside\n');
      if (alias === 'symlink') symlinkSync(outside, cachePath);
      else linkSync(outside, cachePath);
      expect(() => removeBuildSourceTrustColdTransientCache(root)).toThrow(
        alias === 'symlink' ? /contains symlink/u : /contains hardlink/u,
      );
      expect(readFileSync(outside, 'utf8')).toBe('outside\n');
    }

    const rootAlias = temporaryDirectory('kovo-build-source-cold-cache-root-alias-');
    const outsideKovo = path.join(rootAlias, 'outside-kovo');
    mkdirSync(path.join(outsideKovo, 'cache'), { recursive: true });
    writeFileSync(path.join(outsideKovo, 'cache/tsc-preflight.tsbuildinfo'), 'outside root\n');
    symlinkSync(outsideKovo, path.join(rootAlias, '.kovo'));
    expect(() => removeBuildSourceTrustColdTransientCache(rootAlias)).toThrow(
      /.kovo root must be a regular non-symlink directory/u,
    );
    expect(readFileSync(path.join(outsideKovo, 'cache/tsc-preflight.tsbuildinfo'), 'utf8')).toBe(
      'outside root\n',
    );

    const directoryAlias = temporaryDirectory('kovo-build-source-cold-cache-dir-alias-');
    const outsideCache = path.join(directoryAlias, 'outside-cache');
    mkdirSync(path.join(directoryAlias, '.kovo'));
    mkdirSync(outsideCache);
    writeFileSync(path.join(outsideCache, 'tsc-preflight.tsbuildinfo'), 'outside directory\n');
    symlinkSync(outsideCache, path.join(directoryAlias, '.kovo/cache'));
    expect(() => removeBuildSourceTrustColdTransientCache(directoryAlias)).toThrow(
      /contains symlink .kovo\/cache/u,
    );
    expect(readFileSync(path.join(outsideCache, 'tsc-preflight.tsbuildinfo'), 'utf8')).toBe(
      'outside directory\n',
    );
  });

  it('copies the measured source lock into the external corpus and reseals its source manifest', () => {
    const root = temporaryDirectory('kovo-build-source-provenance-lock-');
    const sourceRoot = path.join(root, 'source');
    const corpusRoot = path.join(root, 'corpus');
    const lockBytes = Buffer.from('lockfileVersion: 9\n# authenticated source lock\n');
    mkdirSync(sourceRoot);
    mkdirSync(corpusRoot);
    writeFileSync(path.join(sourceRoot, 'pnpm-lock.yaml'), lockBytes);
    writeFileSync(path.join(corpusRoot, 'package.json'), '{}\n');
    const packageEvidence = {
      bytes: 3,
      file: 'package.json',
      sha256: sha256(Buffer.from('{}\n')),
    };
    const manifestPath = path.join(corpusRoot, 'manifest.json');
    writeFileSync(
      manifestPath,
      `${JSON.stringify({ sourceDigest: digest('old'), sourceFiles: [packageEvidence] })}\n`,
    );

    const evidence = bindBuildSourceTrustArtifactProvenanceLock({
      expectedSha256: sha256(lockBytes),
      manifestPath,
      sourceRoot,
    });
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(evidence).toEqual({
      bytes: lockBytes.byteLength,
      path: 'pnpm-lock.yaml',
      sha256: sha256(lockBytes),
      source: 'measured-source-root-lock',
    });
    expect(readFileSync(path.join(corpusRoot, 'pnpm-lock.yaml'))).toEqual(lockBytes);
    expect(manifest.sourceFiles).toEqual([
      packageEvidence,
      { bytes: lockBytes.byteLength, file: 'pnpm-lock.yaml', sha256: sha256(lockBytes) },
    ]);
    expect(manifest.sourceDigest).toBe(sha256(Buffer.from(JSON.stringify(manifest.sourceFiles))));
    expect(readFileSync(manifestPath, 'utf8')).toBe(`${JSON.stringify(manifest, null, 2)}\n`);
    expect(() =>
      bindBuildSourceTrustArtifactProvenanceLock({
        expectedSha256: sha256(lockBytes),
        manifestPath,
        sourceRoot,
      }),
    ).toThrow(/already contains/u);
  });

  it('rejects source-lock and manifest aliases before resealing external corpus custody', () => {
    for (const alias of ['symlink', 'hardlink']) {
      const root = temporaryDirectory(`kovo-build-source-manifest-${alias}-`);
      const sourceRoot = path.join(root, 'source');
      const corpusRoot = path.join(root, 'corpus');
      const outsideManifest = path.join(root, 'outside-manifest.json');
      const manifestPath = path.join(corpusRoot, 'manifest.json');
      const lockBytes = Buffer.from('lockfileVersion: 9\n');
      const manifestBytes = Buffer.from(
        `${JSON.stringify({ sourceDigest: digest('old'), sourceFiles: [] })}\n`,
      );
      mkdirSync(sourceRoot);
      mkdirSync(corpusRoot);
      writeFileSync(path.join(sourceRoot, 'pnpm-lock.yaml'), lockBytes);
      writeFileSync(outsideManifest, manifestBytes);
      if (alias === 'symlink') symlinkSync(outsideManifest, manifestPath);
      else linkSync(outsideManifest, manifestPath);

      expect(() =>
        bindBuildSourceTrustArtifactProvenanceLock({
          expectedSha256: sha256(lockBytes),
          manifestPath,
          sourceRoot,
        }),
      ).toThrow(/manifest must be a single-link regular file/u);
      expect(readFileSync(outsideManifest)).toEqual(manifestBytes);
    }

    const root = temporaryDirectory('kovo-build-source-lock-symlink-');
    const sourceRoot = path.join(root, 'source');
    const corpusRoot = path.join(root, 'corpus');
    const outsideLock = path.join(root, 'outside-lock.yaml');
    const manifestPath = path.join(corpusRoot, 'manifest.json');
    const lockBytes = Buffer.from('lockfileVersion: 9\n');
    mkdirSync(sourceRoot);
    mkdirSync(corpusRoot);
    writeFileSync(outsideLock, lockBytes);
    symlinkSync(outsideLock, path.join(sourceRoot, 'pnpm-lock.yaml'));
    writeFileSync(
      manifestPath,
      `${JSON.stringify({ sourceDigest: digest('old'), sourceFiles: [] })}\n`,
    );
    expect(() =>
      bindBuildSourceTrustArtifactProvenanceLock({
        expectedSha256: sha256(lockBytes),
        manifestPath,
        sourceRoot,
      }),
    ).toThrow(/source pnpm lock must be a single-link regular non-symlink file/u);

    const collisionRoot = temporaryDirectory('kovo-build-source-reseal-collision-');
    const collisionSource = path.join(collisionRoot, 'source');
    const collisionCorpus = path.join(collisionRoot, 'corpus');
    const collisionManifest = path.join(collisionCorpus, 'manifest.json');
    const collisionTemp = path.join(
      collisionCorpus,
      `.manifest.json.reseal-${String(process.pid)}`,
    );
    const collisionBytes = Buffer.from('unowned collision\n');
    mkdirSync(collisionSource);
    mkdirSync(collisionCorpus);
    writeFileSync(path.join(collisionSource, 'pnpm-lock.yaml'), lockBytes);
    writeFileSync(
      collisionManifest,
      `${JSON.stringify({ sourceDigest: digest('old'), sourceFiles: [] })}\n`,
    );
    writeFileSync(collisionTemp, collisionBytes);
    expect(() =>
      bindBuildSourceTrustArtifactProvenanceLock({
        expectedSha256: sha256(lockBytes),
        manifestPath: collisionManifest,
        sourceRoot: collisionSource,
      }),
    ).toThrow(/EEXIST/u);
    expect(readFileSync(collisionTemp)).toEqual(collisionBytes);
  });

  it('retains actionable adapter diagnostics instead of masking failure as an empty artifact', async () => {
    const root = temporaryDirectory('kovo-build-source-adapter-failure-');
    const scriptsRoot = path.join(root, 'scripts');
    const corpusRoot = path.join(root, 'corpus');
    const rawRoot = path.join(root, 'raw');
    mkdirSync(scriptsRoot);
    mkdirSync(corpusRoot);
    mkdirSync(rawRoot);
    const manifestPath = path.join(corpusRoot, 'manifest.json');
    writeFileSync(manifestPath, '{}\n');
    writeFileSync(
      path.join(scriptsRoot, 'perf-build-benchmark.mjs'),
      [
        "import { writeFileSync } from 'node:fs';",
        "const out = process.argv[process.argv.indexOf('--out') + 1];",
        "const diagnostic = { bytes: 45, sha256: 'sha256:' + 'a'.repeat(64), text: 'ERROR exact packed build root cause', truncated: false };",
        "writeFileSync(out, JSON.stringify({ integrity: { errors: ['sample 1 failed: exit 1: ERROR exact packed build root cause'], outputRoots: { absent: ['.kovo-build-stage-*'], requiredNonempty: ['.kovo', 'dist'] } }, samples: [{ commandDiagnostics: { schema: 'kovo-build-command-diagnostics/v1', stderr: diagnostic, stdout: { ...diagnostic, text: '' } } }] }));",
        'process.exitCode = 1;',
      ].join('\n'),
    );
    const cell = await executeBuildSourceTrustCell({
      lane: 'baseline',
      laneEvidence: {
        descriptorPath: path.join(root, 'descriptor.json'),
        manifestPath,
        product: { digest: digest('product') },
        root,
      },
      occurrence: 0,
      position: 0,
      rawPath: path.join(rawRoot, '00-baseline.json'),
      repetition: 0,
      scheduleIndex: 0,
      timeoutMs: 60_000,
    });
    expect(cell.artifact).toBeNull();
    expect(cell.processFailure).toMatchObject({
      exitCode: 1,
      message: expect.stringContaining('ERROR exact packed build root cause'),
      signal: null,
      stage: 'build-adapter',
    });
    expect(cell.processFailure.message).not.toContain('build artifact tree is empty');
    expect(cell.raw.retained).toBe(true);
    const envelope = JSON.parse(
      readFileSync(path.join(rawRoot, '00-baseline.failure.json'), 'utf8'),
    );
    expect(envelope).toMatchObject({
      error: expect.stringContaining('ERROR exact packed build root cause'),
      rawReport: { path: 'raw/00-baseline.json', retained: true },
      schema: 'kovo-build-source-trust-spike-failure/v1',
    });
  });

  it('orders successful adapter return before cache custody and the final compared census', async () => {
    const root = temporaryDirectory('kovo-build-source-adapter-success-');
    const scriptsRoot = path.join(root, 'scripts');
    const corpusRoot = path.join(root, 'corpus');
    const rawRoot = path.join(root, 'raw');
    mkdirSync(scriptsRoot);
    mkdirSync(corpusRoot);
    mkdirSync(rawRoot);
    const manifestPath = path.join(corpusRoot, 'manifest.json');
    writeFileSync(manifestPath, '{}\n');
    writeFileSync(
      path.join(scriptsRoot, 'perf-build-benchmark.mjs'),
      [
        "import { mkdirSync, writeFileSync } from 'node:fs';",
        "import path from 'node:path';",
        'const value = (name) => process.argv[process.argv.indexOf(name) + 1];',
        "const corpusRoot = path.dirname(value('--corpus'));",
        "const cache = Buffer.from('cache-bytes');",
        "const dist = Buffer.from('dist-bytes');",
        "mkdirSync(path.join(corpusRoot, '.kovo/cache'), { recursive: true });",
        "mkdirSync(path.join(corpusRoot, 'dist'), { recursive: true });",
        "writeFileSync(path.join(corpusRoot, '.kovo/cache/tsc-preflight.tsbuildinfo'), cache);",
        "writeFileSync(path.join(corpusRoot, 'dist/index.mjs'), dist);",
        "const report = { integrity: { outputRoots: { absent: ['.kovo-build-stage-*'], requiredNonempty: ['.kovo', 'dist'] } }, samples: [{ artifactBytes: cache.byteLength + dist.byteLength, outputCensus: { complete: true, requiredNonempty: [{ bytes: cache.byteLength, output: '.kovo', targets: ['.kovo'] }, { bytes: dist.byteLength, output: 'dist', targets: ['dist'] }] } }], summary: { artifactBytes: cache.byteLength + dist.byteLength } };",
        "writeFileSync(value('--out'), JSON.stringify(report));",
      ].join('\n'),
    );
    const cell = await executeBuildSourceTrustCell({
      lane: 'baseline',
      laneEvidence: {
        descriptorPath: path.join(root, 'descriptor.json'),
        manifestPath,
        product: { digest: digest('product') },
        root,
      },
      occurrence: 0,
      position: 0,
      rawPath: path.join(rawRoot, '00-baseline.json'),
      repetition: 0,
      scheduleIndex: 0,
      timeoutMs: 60_000,
    });
    expect(cell.processFailure).toBeNull();
    expect(cell.report.samples[0].artifactBytes).toBe(Buffer.byteLength('cache-bytesdist-bytes'));
    expect(cell.artifact).toMatchObject({
      entries: [
        { path: '.kovo', type: 'directory' },
        { path: 'dist', type: 'directory' },
        { bytes: Buffer.byteLength('dist-bytes'), path: 'dist/index.mjs', type: 'file' },
      ],
      requiredOutputs: ['.kovo', 'dist'],
      totalBytes: Buffer.byteLength('dist-bytes'),
    });
    expect(cell.artifact.entries.some((entry) => entry.path.startsWith('.kovo/cache'))).toBe(false);
    expect(cell.transientCache).toMatchObject({
      absentAfter: true,
      before: { totalBytes: Buffer.byteLength('cache-bytes') },
      complete: true,
      distIntegrityDiagnostic: {
        outsideTiming: true,
        unchanged: true,
      },
      outsideTiming: true,
      parent: { emptyAfter: true, path: '.kovo', retainedAfter: true },
    });
    expect(existsSync(path.join(corpusRoot, '.kovo/cache'))).toBe(false);
    expect(readFileSync(path.join(corpusRoot, 'dist/index.mjs'), 'utf8')).toBe('dist-bytes');
  });

  it('summarizes raw build diagnostics ahead of generic adapter output', () => {
    const failure = buildSourceTrustAdapterFailure(
      { error: undefined, signal: null, status: 1, stderr: '' },
      {
        integrity: { errors: ['sample 1 failed'] },
        samples: [
          {
            commandDiagnostics: {
              stderr: { text: 'ERROR retained root cause' },
              stdout: { text: 'protocol output' },
            },
          },
        ],
      },
    );
    expect(failure).toMatchObject({
      exitCode: 1,
      message: expect.stringContaining('ERROR retained root cause'),
      stage: 'build-adapter',
    });
  });

  it('normalizes only non-timing phase diagnostics while retaining exact names and statuses', () => {
    const first = syntheticReport({ durationMs: 100, lane: 'baseline', rss: 1_000 });
    const second = syntheticReport({ durationMs: 80, lane: 'spike', rss: 900 });
    expect(buildSourceTrustNonTimingDiagnostics(first)).toEqual(
      buildSourceTrustNonTimingDiagnostics(second),
    );
    expect(buildSourceTrustNonTimingDiagnostics(first).source.phases).toEqual(
      SOURCE_PHASES.map((name) => ({ name, status: 'executed' })),
    );
    expect(buildSourceTrustNonTimingDiagnostics(first).workers.phases).toEqual(
      WORKER_PHASES.map((name) => ({ name, status: 0 })),
    );
  });

  it('keeps concrete packed command bytes report-bound while matching the stable workload policy', () => {
    const baseline = {
      ...syntheticCorpus('baseline'),
      approximateLoc: 100,
      workload: { workloadModules: 216 },
    };
    const spike = {
      ...structuredClone(baseline),
      boundary: syntheticCorpus('spike').boundary,
    };
    expect(sameBuildSourceTrustCorpusWorkload(baseline, spike)).toBe(true);
    spike.boundary.normalizedCommand.argv[2] = 'dev';
    expect(sameBuildSourceTrustCorpusWorkload(baseline, spike)).toBe(false);

    const wrapperDrift = structuredClone(baseline);
    wrapperDrift.boundary.declaredCommandEntry = '<workspace>/node_modules/.bin/kovo';
    expect(sameBuildSourceTrustCorpusWorkload(baseline, wrapperDrift)).toBe(false);

    const executedDrift = structuredClone(baseline);
    executedDrift.boundary.actualCommand = '<workspace>/packages/cli/src/bin.ts';
    expect(sameBuildSourceTrustCorpusWorkload(baseline, executedDrift)).toBe(false);
  });

  it('authenticates the declared wrapper and materialized direct CLI as distinct command facts', () => {
    const fixture = externalCommandBoundaryFixture();
    const inspected = inspectExternalKovoCorpus(fixture.options);
    expect(inspected.boundary).toMatchObject({
      actualCommand: '<packed-consumer>/node_modules/@kovojs/cli/dist/bin.mjs',
      actualCommandSha256: sha256(fixture.cliBytes),
      declaredCommandEntry: '<packed-consumer>/node_modules/.bin/kovo',
      declaredCommandEntrySha256: sha256(fixture.wrapperBytes),
    });

    expect(() =>
      inspectExternalKovoCorpus({
        ...fixture.options,
        expectedArtifactProvenanceLock: {
          ...fixture.options.expectedArtifactProvenanceLock,
          sha256: digest('changed-lock'),
        },
      }),
    ).toThrow(/artifact-provenance lock is not source-bound and manifest-bound/u);

    expect(() =>
      inspectExternalKovoCorpus({
        ...fixture.options,
        product: {
          ...fixture.options.product,
          consumerDependencyRoot: fixture.rogueDependencyRoot,
        },
      }),
    ).toThrow(/declared command escapes its packed dependency root/u);

    expect(() =>
      inspectExternalKovoCorpus({
        ...fixture.options,
        tooling: {
          ...fixture.options.tooling,
          materializePackedCommand(command, product, appRoot) {
            const materialized = materializePackedKovoCommand(command, product, appRoot);
            return {
              ...materialized,
              argv: [materialized.argv[0], fixture.rogueCli, ...materialized.argv.slice(2)],
            };
          },
        },
      }),
    ).toThrow(/materialized command does not resolve to the authenticated packed CLI/u);
  });

  it('rejects symlinked and hardlinked manifests during external corpus inspection', () => {
    for (const alias of ['symlink', 'hardlink']) {
      const fixture = externalCommandBoundaryFixture();
      const manifestPath = fixture.options.manifestPath;
      const outsideManifest = path.join(path.dirname(path.dirname(manifestPath)), 'outside.json');
      const manifestBytes = readFileSync(manifestPath);
      writeFileSync(outsideManifest, manifestBytes);
      unlinkSync(manifestPath);
      if (alias === 'symlink') symlinkSync(outsideManifest, manifestPath);
      else linkSync(outsideManifest, manifestPath);
      expect(() => inspectExternalKovoCorpus(fixture.options)).toThrow(
        /manifest must be a single-link regular file inside the canonical corpus root/u,
      );
      expect(readFileSync(outsideManifest)).toEqual(manifestBytes);
    }
  });

  it('rejects every ordering field in the structured A/B boundary policy', () => {
    for (const [field, value] of [
      ['artifactProvenanceLock', 'implicit-ancestor-lock'],
      ['coldBuildTransientCache', 'normalized-after-census'],
      ['comparedArtifact', 'dist-only'],
      ['hostAdmission', 'after-preparation-only'],
      ['preparationTiming', 'before-host-admission'],
      ['timedWarmups', 1],
      ['corpusIsolation', 'workspace-ancestor-allowed'],
      ['sharedIsolationPolicySchema', 'kovo-packed-product-workload-policy/v0'],
    ]) {
      expect(
        buildSourceTrustBoundaryPolicyFindings({
          ...BUILD_SOURCE_TRUST_BOUNDARY_POLICY,
          [field]: value,
        }),
      ).toEqual(['build source-trust boundary policy or measurement order is incomplete']);
    }
  });

  it('validates clean packed Kovo evidence, exact source/corpus/artifact, and raw custody', () => {
    const cell = syntheticCell({ durationMs: 100, lane: 'baseline', occurrence: 0, rss: 1_000 });
    const expected = syntheticExpected('baseline');
    expect(validateBuildSourceTrustCell(cell, expected)).toEqual([]);
    const wrongProduct = structuredClone(cell);
    wrongProduct.report.integrity.productArtifact.afterVerified = false;
    expect(validateBuildSourceTrustCell(wrongProduct, expected)).toContain(
      '0:baseline exact packed Kovo product evidence is unavailable',
    );
    const unsafeProduct = structuredClone(cell);
    const unsafeExpected = structuredClone(expected);
    unsafeProduct.report.productArtifact.identity.integrity.workspaceSourceLoaded = true;
    unsafeExpected.product = structuredClone(unsafeProduct.report.productArtifact);
    expect(validateBuildSourceTrustCell(unsafeProduct, unsafeExpected)).toContain(
      '0:baseline exact packed Kovo product evidence is unavailable',
    );
    const next = structuredClone(cell);
    next.report.framework = 'nextjs';
    expect(validateBuildSourceTrustCell(next, expected)).toContain(
      '0:baseline is not a clean Kovo build',
    );
    const commandDrift = structuredClone(cell);
    commandDrift.report.integrity.command.argv[0] = 'node_modules/.bin/kovo';
    expect(validateBuildSourceTrustCell(commandDrift, expected)).toContain(
      '0:baseline command or output contract differs from the authenticated corpus',
    );
    const processFailure = structuredClone(cell);
    processFailure.processFailure = { signal: 'SIGKILL' };
    expect(validateBuildSourceTrustCell(processFailure, expected)).toContain(
      '0:baseline measured sample is incomplete',
    );
    const cacheDrift = structuredClone(cell);
    cacheDrift.transientCache.before.entries[1].sha256 = digest('changed-cache');
    expect(validateBuildSourceTrustCell(cacheDrift, expected)).toContain(
      '0:baseline cold build transient cache custody is incomplete',
    );
    const distDrift = structuredClone(cell);
    distDrift.transientCache.distIntegrityDiagnostic.after.digest = digest('changed-dist');
    expect(validateBuildSourceTrustCell(distDrift, expected)).toContain(
      '0:baseline dist changed during transient cache removal or final .kovo is not exactly empty',
    );
    const retainedKovoEntry = structuredClone(cell);
    retainedKovoEntry.artifact.entries.splice(1, 0, {
      mode: 0o700,
      path: '.kovo/unexpected',
      type: 'directory',
    });
    expect(validateBuildSourceTrustCell(retainedKovoEntry, expected)).toContain(
      '0:baseline dist changed during transient cache removal or final .kovo is not exactly empty',
    );
    const accountingDrift = structuredClone(cell);
    accountingDrift.report.samples[0].artifactBytes += 1;
    expect(validateBuildSourceTrustCell(accountingDrift, expected)).toContain(
      '0:baseline exact output tree evidence is incomplete',
    );
  });

  it('accepts a corpus only with a >=10% median win, positive paired CI, and both p95 guards', () => {
    const analysis = aggregateBuildSourceTrustCells(
      syntheticCells({
        baselineDuration: 100,
        baselineRss: 1_000,
        spikeDuration: 80,
        spikeRss: 950,
      }),
      decisionPolicy(216),
    );
    expect(analysis.schedule.complete).toBe(true);
    expect(analysis.correctness).toMatchObject({
      artifactExact: true,
      complete: true,
      diagnosticsExact: true,
      frameworkCensus: { kovo: 20, nextjs: 0 },
      nextjsProductArtifact: null,
    });
    expect(analysis.metrics.totalWallMs.baseline).toEqual({
      count: 10,
      mad: 0,
      median: 100,
      p95: 100,
    });
    expect(analysis.metrics.totalWallMs.spikeMedianImprovementPercent).toBe(20);
    expect(analysis.metrics.totalWallMs.pairedImprovement.bootstrap95Ci).toEqual([20, 20]);
    expect(analysis.acceptance.candidateAccepted).toBe(true);

    const tooSmall = aggregateBuildSourceTrustCells(
      syntheticCells({
        baselineDuration: 100,
        baselineRss: 1_000,
        spikeDuration: 91,
        spikeRss: 950,
      }),
      decisionPolicy(216),
    );
    expect(tooSmall.acceptance.wallPrimary.medianImprovementAtLeast10Percent).toBe(false);
    expect(tooSmall.acceptance.candidateAccepted).toBe(false);
  });

  it('applies the same primary wall threshold at N=24', () => {
    const pass = aggregateBuildSourceTrustCells(
      syntheticCells({
        baselineDuration: 100,
        baselineRss: 1_000,
        spikeDuration: 80,
        spikeRss: 950,
      }),
      decisionPolicy(24),
    );
    expect(pass.acceptance.wallPrimary.passed).toBe(true);
    expect(pass.acceptance.p95Guardrails.totalWallMs.passed).toBe(true);
    expect(pass.acceptance.p95Guardrails.peakRssBytes.passed).toBe(true);
    expect(pass.acceptance.candidateAccepted).toBe(true);

    const fail = aggregateBuildSourceTrustCells(
      syntheticCells({
        baselineDuration: 100,
        baselineRss: 1_000,
        spikeDuration: 91,
        spikeRss: 1_000,
      }),
      decisionPolicy(24),
    );
    expect(fail.acceptance.wallPrimary.medianImprovementAtLeast10Percent).toBe(false);
    expect(fail.acceptance.candidateAccepted).toBe(false);
  });

  it('rejects byte-different output and diagnostic drift even when timing wins', () => {
    const artifactDrift = syntheticCells({
      baselineDuration: 100,
      baselineRss: 1_000,
      spikeDuration: 70,
      spikeRss: 900,
    });
    artifactDrift[1].artifact.digest = digest('artifact-drift');
    expect(
      aggregateBuildSourceTrustCells(artifactDrift, decisionPolicy(216)).correctness.complete,
    ).toBe(false);

    const diagnosticDrift = syntheticCells({
      baselineDuration: 100,
      baselineRss: 1_000,
      spikeDuration: 70,
      spikeRss: 900,
    });
    diagnosticDrift[1].report.samples[0].phaseCensus.source.checkGraphDigest = digest('changed');
    const diagnosticAnalysis = aggregateBuildSourceTrustCells(diagnosticDrift, decisionPolicy(216));
    expect(diagnosticAnalysis.correctness.complete).toBe(false);

    const artifactAnalysis = aggregateBuildSourceTrustCells(artifactDrift, decisionPolicy(216));
    expect(
      buildSourceTrustVerdict({
        analysis: artifactAnalysis,
        complete: false,
        errors: [],
        policy: decisionPolicy(216),
      }),
    ).toMatchObject({
      reasons: ['compared build artifacts are not byte-exact across lanes'],
      status: 'unproven',
    });
    expect(
      buildSourceTrustVerdict({
        analysis: diagnosticAnalysis,
        complete: false,
        errors: [],
        policy: decisionPolicy(216),
      }),
    ).toMatchObject({
      reasons: ['non-timing build diagnostics differ across lanes'],
      status: 'unproven',
    });
  });

  it('shares one bounded host-settle budget and marks post-preparation admissions', async () => {
    const waits = [];
    const loads = [8, 8, 1, 1];
    const admission = createBuildSourceTrustHostAdmission({
      ceiling: 1,
      maxWaitMs: 20,
      pollMs: 10,
      sampleHost: () => ({ cpuCount: 4, loadAverage: [loads.shift(), 0, 0] }),
      wait: async (milliseconds) => waits.push(milliseconds),
    });
    const initial = await admission.admit('pre-preparation');
    expect(initial).toMatchObject({
      comparable: true,
      phase: 'quiet-host-admission',
      posture: 'pre-benchmark',
      settle: { rejectedObservations: 2, waitedMs: 20 },
    });
    admission.markBenchmarkWork();
    const block = await admission.admit('block-0-baseline');
    expect(block).toMatchObject({
      comparable: true,
      phase: 'quiet-host-settle',
      posture: 'post-benchmark',
    });
    expect(waits).toEqual([10, 10]);
    expect(admission.policy()).toMatchObject({ remainingWaitMs: 0, totalWaitedMs: 20 });
  });

  it('requires explicit timing authorization and parses only bounded decision inputs', () => {
    expect(
      parseBuildSourceTrustArgs([
        '--baseline-root',
        '/baseline',
        '--spike-root',
        '/spike',
        '--size',
        '216',
        '--repetitions',
        '5',
        '--measure',
        '--out',
        '/out/report.json',
      ]),
    ).toMatchObject({
      baselineRoot: '/baseline',
      measure: true,
      out: '/out/report.json',
      repetitions: 5,
      size: 216,
      spikeRoot: '/spike',
    });
    expect(() => parseBuildSourceTrustArgs(['--size', '216'])).toThrow(/explicit --measure/u);
    expect(() => parseBuildSourceTrustArgs(['--measure', '--unknown', '1'])).toThrow(
      /unsupported/u,
    );
  });
});

function syntheticCells({ baselineDuration, baselineRss, spikeDuration, spikeRss }) {
  return buildSourceTrustSchedule().map((scheduled) =>
    syntheticCell({
      ...scheduled,
      durationMs: scheduled.lane === 'baseline' ? baselineDuration : spikeDuration,
      rss: scheduled.lane === 'baseline' ? baselineRss : spikeRss,
    }),
  );
}

function syntheticCell({
  durationMs,
  lane,
  occurrence,
  position = lane === 'baseline' ? 0 : 1,
  repetition = 0,
  rss,
  scheduleIndex = 0,
}) {
  const artifact = syntheticArtifact();
  return {
    artifact,
    findings: [],
    lane,
    occurrence,
    position,
    processFailure: null,
    raw: {
      bytes: 100,
      path: `raw/${scheduleIndex}-${lane}.json`,
      retained: true,
      sha256: digest('raw'),
    },
    repetition,
    report: syntheticReport({ durationMs, lane, rss }),
    scheduleIndex,
    transientCache: syntheticTransientCache(),
  };
}

function syntheticReport({ durationMs, lane, rss }) {
  const source = syntheticExpected(lane).source;
  const product = syntheticProduct(lane);
  const corpus = syntheticCorpus(lane);
  const phaseCensus = {
    source: {
      checkGraphDigest: digest('graph'),
      complete: true,
      phases: SOURCE_PHASES.map((name, index) => ({
        durationMs: durationMs / (index + 10),
        name,
        status: 'executed',
      })),
      schema: 'kovo-build-source-phase-census/v1',
      source: {
        codeUnitLength: 100,
        contentHash: digest('source'),
        encoding: 'utf16le',
        path: 'src/app.tsx',
      },
      sourceSetDigest: digest('set'),
    },
    workers: {
      complete: true,
      phases: WORKER_PHASES.map((name, index) => ({
        durationMs: durationMs / (index + 2),
        name,
        status: 0,
      })),
      schema: 'kovo-build-worker-phase-census/v1',
      sourcePath: 'src/app.tsx',
      totalWorkerMs: durationMs - 1,
    },
  };
  return {
    corpus,
    framework: 'kovo',
    integrity: {
      command: {
        argv: [
          'node',
          '<packed-kovo>/node_modules/@kovojs/cli/dist/bin.mjs',
          'build',
          './src/app.tsx',
        ],
        cwd: '.',
        env: {},
        productArtifactDigest: product.digest,
      },
      complete: true,
      errors: [],
      iterations: 1,
      misses: 0,
      outputRoots: { absent: ['.kovo-build-stage-*'], requiredNonempty: ['.kovo', 'dist'] },
      productArtifact: { afterVerified: true, beforeVerified: true, required: true },
      source: { after: source, before: source, stable: true },
      warmups: 0,
    },
    mode: 'clean',
    productArtifact: product,
    samples: [
      {
        artifactBytes: syntheticArtifact().totalBytes + syntheticTransientCache().before.totalBytes,
        durationMs,
        exitCode: 0,
        outputCensus: {
          complete: true,
          requiredNonempty: [
            {
              bytes: syntheticTransientCache().before.totalBytes,
              output: '.kovo',
              targets: ['.kovo'],
            },
            { bytes: syntheticArtifact().totalBytes, output: 'dist', targets: ['dist'] },
          ],
        },
        peakRssBytes: rss,
        phaseAttribution: {
          cliStartupTail: {
            durationMs: 1,
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
            durationMs: durationMs - 1,
            phases: WORKER_PHASES,
            source: 'kovo-build-worker-phase-census/v1.totalWorkerMs',
            status: 'authenticated-sequential',
          },
          schema: 'kovo-build-phase-attribution/v1',
          sourceCheck: {
            nestedWithin: 'analyze',
            phases: SOURCE_PHASES,
            source: 'kovo-build-source-phase-census/v1',
            status: 'authenticated-nested',
          },
          wallDurationMs: durationMs,
        },
        phaseCensus,
      },
    ],
    schema: 'kovo-build-benchmark/v1',
    source,
    sourceAfter: source,
    summary: {
      artifactBytes: syntheticArtifact().totalBytes + syntheticTransientCache().before.totalBytes,
    },
  };
}

function syntheticExpected(lane) {
  const source = syntheticSource(lane);
  return {
    commit: source.commit,
    corpus: syntheticCorpus(lane),
    product: syntheticProduct(lane),
    source,
  };
}

function syntheticCorpus(lane = 'baseline') {
  const product = syntheticProduct(lane);
  return {
    boundary: {
      actualCommand: '<packed-consumer>/node_modules/@kovojs/cli/dist/bin.mjs',
      actualCommandSha256: digest(`${lane}-cli`),
      appRoot: '<external-corpus>',
      artifactProvenanceLock: {
        bytes: 100,
        path: 'pnpm-lock.yaml',
        sha256: digest('root-lock'),
        source: 'measured-source-root-lock',
      },
      declaredCommandEntry: '<packed-consumer>/node_modules/.bin/kovo',
      declaredCommandEntrySha256: digest(`${lane}-wrapper`),
      normalizedCommand: {
        argv: [
          'node',
          '<packed-kovo>/node_modules/@kovojs/cli/dist/bin.mjs',
          'build',
          './src/app.tsx',
        ],
        cwd: '.',
        env: {},
        productArtifactDigest: product.digest,
      },
      policy: BUILD_SOURCE_TRUST_BOUNDARY_POLICY,
      workspaceAncestorAvailable: false,
    },
    build: {
      outputs: { absent: ['.kovo-build-stage-*'], requiredNonempty: ['.kovo', 'dist'] },
    },
    manifestDigest: digest('manifest'),
    modules: 216,
    routes: 4,
    schema: 'kovo-dev-corpus/v1',
    shapeDigest: 'a'.repeat(64),
    sourceDigest: digest('corpus'),
  };
}

function syntheticProduct(lane) {
  const source = syntheticSource(lane);
  return fixturePackedKovoProductIdentity({
    locks: source.locks,
    seed: `${lane}-product`,
    sourceCommit: source.commit,
  });
}

function syntheticSource(lane) {
  return {
    commit: lane === 'baseline' ? 'b'.repeat(40) : 'c'.repeat(40),
    dirty: false,
    dirtyPaths: [],
    locks: {
      'benchmarks/harness/pnpm-lock.yaml': digest('harness-lock'),
      'benchmarks/nextjs/pnpm-lock.yaml': digest('next-lock'),
      'pnpm-lock.yaml': digest('root-lock'),
    },
  };
}

function syntheticArtifact() {
  const identity = {
    entries: [
      { mode: 0o700, path: '.kovo', type: 'directory' },
      { mode: 0o755, path: 'dist', type: 'directory' },
      {
        bytes: 10,
        mode: 0o644,
        path: 'dist/index.mjs',
        sha256: digest('file'),
        type: 'file',
      },
    ],
    requiredOutputs: ['.kovo', 'dist'],
    schema: BUILD_SOURCE_TRUST_ARTIFACT_SCHEMA,
    totalBytes: 10,
  };
  return { ...identity, digest: sha256(Buffer.from(JSON.stringify(identity))) };
}

function syntheticTransientCache() {
  const entries = [
    { mode: 0o700, path: '.kovo/cache', type: 'directory' },
    {
      bytes: 4,
      mode: 0o600,
      path: '.kovo/cache/tsc-preflight.tsbuildinfo',
      sha256: digest('cache'),
      type: 'file',
    },
  ];
  const beforeIdentity = { entries, totalBytes: 4 };
  const distEntries = syntheticArtifact().entries.filter(
    (entry) => entry.path === 'dist' || entry.path.startsWith('dist/'),
  );
  const distIdentity = {
    entries: distEntries,
    requiredOutputs: ['dist'],
    schema: BUILD_SOURCE_TRUST_ARTIFACT_SCHEMA,
    totalBytes: 10,
  };
  const distSummary = {
    digest: sha256(Buffer.from(JSON.stringify(distIdentity))),
    entries: distEntries.length,
    totalBytes: 10,
  };
  return {
    absentAfter: true,
    before: {
      ...beforeIdentity,
      digest: sha256(Buffer.from(JSON.stringify(beforeIdentity))),
    },
    complete: true,
    distIntegrityDiagnostic: {
      after: distSummary,
      before: { ...distSummary },
      outsideTiming: true,
      unchanged: true,
    },
    mutation: {
      confinedTo: '.kovo/cache',
      operations: ['unlink:tsc-preflight.tsbuildinfo', 'rmdir:.kovo/cache'],
    },
    outsideTiming: true,
    parent: { emptyAfter: true, path: '.kovo', retainedAfter: true },
    path: '.kovo/cache',
    schema: BUILD_SOURCE_TRUST_TRANSIENT_CACHE_SCHEMA,
    stage: 'after-adapter-return-before-compared-artifact-census',
  };
}

function decisionPolicy(size) {
  return { bootstrapIterations: 500, repetitions: 5, seed: 1, size };
}

function externalCommandBoundaryFixture() {
  const root = temporaryDirectory('kovo-build-source-command-boundary-');
  const consumerRoot = path.join(root, 'consumer');
  const consumerDependencyRoot = path.join(consumerRoot, 'node_modules');
  const cliEntry = path.join(consumerDependencyRoot, '@kovojs/cli/dist/bin.mjs');
  const wrapper = path.join(consumerDependencyRoot, '.bin/kovo');
  const corpusRoot = path.join(root, 'corpus');
  const sourceRoot = path.join(root, 'source');
  const rogueDependencyRoot = path.join(root, 'rogue-dependencies');
  const rogueCli = path.join(root, 'rogue-cli.mjs');
  const cliBytes = Buffer.from('export default "packed-cli";\n');
  const lockBytes = Buffer.from('lockfileVersion: 9\n');
  const wrapperBytes = Buffer.from('#!/bin/sh\nexec ../@kovojs/cli/dist/bin.mjs "$@"\n');
  mkdirSync(path.dirname(cliEntry), { recursive: true });
  mkdirSync(path.dirname(wrapper), { recursive: true });
  mkdirSync(corpusRoot);
  mkdirSync(sourceRoot);
  mkdirSync(rogueDependencyRoot);
  writeFileSync(cliEntry, cliBytes);
  writeFileSync(wrapper, wrapperBytes);
  writeFileSync(path.join(corpusRoot, 'pnpm-lock.yaml'), lockBytes);
  writeFileSync(rogueCli, 'export default "rogue";\n');
  symlinkSync(consumerDependencyRoot, path.join(corpusRoot, 'node_modules'), 'dir');
  const sourceFiles = [
    { bytes: lockBytes.byteLength, file: 'pnpm-lock.yaml', sha256: sha256(lockBytes) },
  ];
  const manifest = {
    approximateLoc: 100,
    build: {
      command: { argv: ['node_modules/.bin/kovo', 'build', './src/app.tsx'], cwd: '.', env: {} },
      outputs: { absent: ['.kovo-build-stage-*'], requiredNonempty: ['.kovo', 'dist'] },
    },
    framework: 'kovo',
    modules: 24,
    routes: 4,
    schema: 'kovo-dev-corpus/v1',
    shapeDigest: digest('shape'),
    sourceDigest: sha256(Buffer.from(JSON.stringify(sourceFiles))),
    sourceFiles,
    workload: {
      buildOutputContract: 'required-nonempty-and-cleanup-absent/v1',
      componentImportFanout: 24,
      workloadModules: 24,
    },
  };
  const manifestPath = path.join(corpusRoot, 'corpus.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
  const product = {
    cliEntry,
    consumerDependencyRoot,
    consumerRoot,
    dependencyRoot: consumerDependencyRoot,
    identity: {
      digest: digest('packed-product'),
      schema: 'kovo-packed-product-identity/v1',
    },
  };
  return {
    cliBytes,
    options: {
      corpusRoot,
      expectedArtifactProvenanceLock: {
        bytes: lockBytes.byteLength,
        path: 'pnpm-lock.yaml',
        sha256: sha256(lockBytes),
        source: 'measured-source-root-lock',
      },
      manifestPath,
      product,
      roots: [sourceRoot],
      size: 24,
      tooling: {
        assertCorpusIsolation: assertPackedCorpusIsolation,
        materializePackedCommand: materializePackedKovoCommand,
        normalizedPackedCommand: normalizedPackedKovoCommand,
      },
    },
    rogueCli,
    rogueDependencyRoot,
    wrapperBytes,
  };
}

function preparationSourceRoot(lane) {
  const container = temporaryDirectory(`kovo-build-source-preparation-${lane}-`);
  const root = path.join(container, 'source');
  const lockBytes = Buffer.from('lockfileVersion: 9\n');
  mkdirSync(path.join(root, 'benchmarks/harness'), { recursive: true });
  mkdirSync(path.join(root, 'benchmarks/nextjs'), { recursive: true });
  writeFileSync(path.join(root, 'pnpm-lock.yaml'), lockBytes);
  writeFileSync(path.join(root, 'benchmarks/harness/pnpm-lock.yaml'), lockBytes);
  writeFileSync(path.join(root, 'benchmarks/nextjs/pnpm-lock.yaml'), lockBytes);
  writeFileSync(path.join(root, 'lane.txt'), `${lane}\n`);
  execFileSync('git', ['init', '--quiet', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'perf-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Perf Test']);
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '--quiet', '-m', lane]);
  return {
    root: realpathSync(root),
    state: {
      commit: String(execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'])).trim(),
      dirty: false,
      dirtyPaths: [],
      locks: {
        'benchmarks/harness/pnpm-lock.yaml': sha256(lockBytes),
        'benchmarks/nextjs/pnpm-lock.yaml': sha256(lockBytes),
        'pnpm-lock.yaml': sha256(lockBytes),
      },
    },
  };
}

function candidateFixture({ pathStatus, rangeCount = '1', spikeStatus = '' } = {}) {
  const container = temporaryDirectory('kovo-build-source-candidate-');
  const repository = path.join(container, 'repository');
  const baseline = path.join(container, 'baseline');
  const spike = path.join(container, 'spike');
  for (const root of [repository, baseline, spike]) mkdirSync(root);
  const commit = 'c'.repeat(40);
  const parent = 'p'.repeat(40);
  const baselineCommit = parent;
  const spikeCommit = commit;
  const tree = 't'.repeat(40);
  const patch = Buffer.from('exact binary full-index patch');
  const patchId = 'i'.repeat(40);
  const pathChanges = [
    { path: 'packages/compiler/src/scan/new.test.ts', status: 'A' },
    { path: 'packages/compiler/src/scan/parse.ts', status: 'M' },
  ];
  const candidate = {
    commit,
    parent,
    patchBytes: patch.byteLength,
    patchId,
    patchSha256: sha256(patch),
    pathChanges,
    ref: 'refs/heads/perf-spike/test-package-snapshot',
    tree,
  };
  const roots = new Map([
    [realpathSync(repository), 'repository'],
    [realpathSync(baseline), 'baseline'],
    [realpathSync(spike), 'spike'],
  ]);
  const git = (root, args) => {
    const kind = roots.get(realpathSync(root));
    const command = args.join(' ');
    if (command === 'rev-parse --show-toplevel') return realpathSync(root);
    if (command === 'status --porcelain=v1 --untracked-files=all') {
      return kind === 'spike' ? spikeStatus : '';
    }
    if (command === 'rev-parse HEAD') return kind === 'baseline' ? baselineCommit : spikeCommit;
    if (command === 'rev-parse HEAD^') return baselineCommit;
    if (command === `merge-base ${baselineCommit} ${spikeCommit}`) return baselineCommit;
    if (command === `rev-list --count ${baselineCommit}..${spikeCommit}`) return rangeCount;
    if (command === `rev-parse ${commit}^{commit}`) return commit;
    if (command === `rev-parse ${commit}^`) return parent;
    if (command === `rev-parse ${commit}^{tree}`) return tree;
    if (command === `rev-parse ${candidate.ref}^{commit}`) return commit;
    if (command === `diff --name-status --no-renames ${baselineCommit} ${spikeCommit}`) {
      return pathStatus ?? pathChanges.map((entry) => `${entry.status}\t${entry.path}`).join('\n');
    }
    throw new Error(`unexpected fake git command for ${kind}: ${command}`);
  };
  return {
    baseline,
    baselineCommit,
    candidate,
    dependencies: {
      git,
      patch: () => patch,
      patchId: () => patchId,
    },
    repository,
    spike,
    spikeCommit,
  };
}

function temporaryDirectory(prefix) {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function digest(seed) {
  return `sha256:${String(seed)
    .repeat(64)
    .slice(0, 64)
    .replace(/[^0-9a-f]/gu, 'a')}`;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}
