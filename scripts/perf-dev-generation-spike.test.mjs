import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  aggregateDevGenerationCells,
  authenticateGenerationCandidateRoots,
  DEV_CRITICAL_PATH_CANDIDATE,
  DEV_GENERATION_ADAPTER_FAILURE_SCHEMA,
  DEV_GENERATION_CANDIDATE_BINDING_SCHEMA,
  DEV_GENERATION_PRODUCT_BOUNDARY_SCHEMA,
  DEV_GENERATION_PRODUCT_POLICY,
  DEV_GENERATION_PRODUCT_POLICY_SCHEMA,
  DEV_GENERATION_SPIKE_PREPARE_SCHEMA,
  DEV_GENERATION_SPIKE_SCHEMA,
  devGenerationPackedCorpusOptions,
  devGenerationSchedule,
  inspectGeneratedDevCorpus,
  inspectDevGenerationProductBoundary,
  pairedBootstrapImprovementCi,
  parseDevGenerationSpikeArgs,
  prepareDevGenerationSpike,
  runDevGenerationSpike,
  summarizeFailedAdapterReport,
  summarizeDevMetric,
  validateDevGenerationCell,
} from './perf-dev-generation-spike.mjs';
import { canonicalJson } from './lib/perf-host.mjs';

const EDIT_CLASSES = ['leaf', 'entry', 'data', 'syntaxError', 'recovery'];
const temporaryRoots = [];
const digest = (seed) => `sha256:${seed.repeat(64).slice(0, 64)}`;

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('dev-generation candidate comparator', () => {
  it('versions packed evidence so source-checkout v2 reports cannot be reinterpreted', () => {
    expect(DEV_GENERATION_SPIKE_SCHEMA).toBe('kovo-dev-generation-spike-comparison/v3');
    expect(DEV_GENERATION_SPIKE_PREPARE_SCHEMA).toBe('kovo-dev-generation-spike-prepare/v3');
    expect(DEV_GENERATION_CANDIDATE_BINDING_SCHEMA).toBe(
      'kovo-dev-generation-candidate-binding/v3',
    );
    expect(DEV_GENERATION_ADAPTER_FAILURE_SCHEMA).toBe('kovo-dev-generation-adapter-failure/v3');
    expect(DEV_GENERATION_PRODUCT_BOUNDARY_SCHEMA).toBe(
      'kovo-dev-generation-packed-product-boundary/v3',
    );
    expect(DEV_GENERATION_PRODUCT_POLICY).toEqual({
      artifactIdentity: 'kovo-packed-product-identity/v1',
      corpusGeneration: 'separate-per-lane-with-deferred-dependencies',
      corpusIsolation: 'fresh-external-os-tmpdir-without-ancestor-node-modules',
      laneIdentityComparison: 'concrete-identities-report-bound-but-not-required-equal',
      liveDescriptorVerification:
        'separate-regular-consumer-descriptor-plus-adapter-before-and-after',
      preparationAdmission: 'quiet-host-before-preparation-and-before-each-timed-block',
      preparationTiming: 'build-pack-frozen-install-and-corpus-generation-outside-samples',
      rawReportBinding: 'exact-product-identity-required-before-and-after',
      schema: DEV_GENERATION_PRODUCT_POLICY_SCHEMA,
    });
  });

  it('binds the profile-driven development critical-path candidate identity', () => {
    expect(DEV_CRITICAL_PATH_CANDIDATE).toEqual({
      commit: '336925d40e11024b54206908997dbdfe0f43a391',
      parent: 'eb16f11734a2ab635a8207f2e6ece4612713f248',
      patchId: '5e5fb7c71081a556bf8c83824ab3858637714547',
      patchSha256: 'sha256:766a13947b40a065b67013ae4b357c24b036bfb2a0f373cb5f9b93658989b913',
      paths: [
        'packages/compiler/src/query-runtime-identities.test.ts',
        'packages/compiler/src/scan/query-runtime-identities.ts',
        'packages/compiler/src/vite.test.ts',
        'packages/compiler/src/vite.ts',
        'packages/server/src/vite-data-plane-gate.test.ts',
        'packages/server/src/vite.ts',
      ],
      tree: 'a0fe15cde24918aad0ce69a759441586bfd1663b',
    });
  });

  it('uses B,S,S,B and splits full and smoke sample totals exactly', () => {
    expect(devGenerationSchedule({ editSamples: 30, readySamples: 15, warmups: 3 })).toEqual([
      {
        editSamples: 15,
        lane: 'baseline',
        occurrence: 0,
        readySamples: 8,
        scheduleIndex: 0,
        warmups: 2,
      },
      {
        editSamples: 15,
        lane: 'spike',
        occurrence: 0,
        readySamples: 8,
        scheduleIndex: 1,
        warmups: 2,
      },
      {
        editSamples: 15,
        lane: 'spike',
        occurrence: 1,
        readySamples: 7,
        scheduleIndex: 2,
        warmups: 1,
      },
      {
        editSamples: 15,
        lane: 'baseline',
        occurrence: 1,
        readySamples: 7,
        scheduleIndex: 3,
        warmups: 1,
      },
    ]);
    expect(devGenerationSchedule({ editSamples: 2, readySamples: 2, warmups: 0 })).toEqual([
      expect.objectContaining({ lane: 'baseline', occurrence: 0, editSamples: 1, readySamples: 1 }),
      expect.objectContaining({ lane: 'spike', occurrence: 0, editSamples: 1, readySamples: 1 }),
      expect.objectContaining({ lane: 'spike', occurrence: 1, editSamples: 1, readySamples: 1 }),
      expect.objectContaining({ lane: 'baseline', occurrence: 1, editSamples: 1, readySamples: 1 }),
    ]);
  });

  it('pins each packed corpus to deferred dependency generation under its external root', () => {
    const externalRoot = temporaryDirectory('kovo-dev-generation-deferred-corpus-');
    expect(devGenerationPackedCorpusOptions(externalRoot, 216)).toEqual({
      dependencyMode: 'deferred',
      framework: 'kovo',
      outDir: realpathSync(externalRoot),
      size: 216,
    });
    expect(() => devGenerationPackedCorpusOptions(externalRoot, 25)).toThrow(/24 or 216/u);
  });

  it('reports median/MAD/p95 and deterministic paired bootstrap evidence', () => {
    expect(summarizeDevMetric([1, 3, 9])).toEqual({ mad: 2, median: 3, p95: 9, samples: 3 });
    expect(
      pairedBootstrapImprovementCi([100, 100, 100], [75, 75, 75], { iterations: 500 }),
    ).toEqual([25, 25]);
    expect(() => pairedBootstrapImprovementCi([1], [1, 2])).toThrow(/identical sample counts/u);
  });

  it('retains bounded child-report diagnostics when an adapter exits nonzero', () => {
    const errors = Array.from({ length: 14 }, (_, index) => `failure-${String(index)}`);
    const bytes = Buffer.from('{"authenticated":"raw-child-report"}');
    expect(
      summarizeFailedAdapterReport(
        {
          editSession: { error: 'edit session failed' },
          integrity: { errors },
          readySamples: [
            { error: 'ready timed out', iteration: 0, success: false },
            { error: null, iteration: 1, success: true },
          ],
          schema: 'kovo-dev-loop-report/v1',
          verdict: { status: 'unproven' },
        },
        bytes,
      ),
    ).toEqual({
      browserRequestFailures: null,
      browserUnexpectedErrors: null,
      editSessionError: 'edit session failed',
      integrityErrors: errors.slice(0, 12),
      misses: null,
      readyFailures: [{ error: 'ready timed out', iteration: 0 }],
      reportBytes: bytes.byteLength,
      reportSha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      schema: 'kovo-dev-loop-report/v1',
      verdict: 'unproven',
    });
  });

  it('authenticates an exact clean one-commit profile-driven patch binding', () => {
    const fixture = candidateFixture();
    const binding = authenticateGenerationCandidateRoots(
      {
        baselineRoot: fixture.baseline,
        candidate: fixture.candidate,
        candidateRepository: fixture.repository,
        spikeRoot: fixture.spike,
      },
      fixture.dependencies,
    );

    expect(binding).toMatchObject({
      baseline: { commit: fixture.baselineCommit, root: realpathSync(fixture.baseline) },
      candidate: {
        patchId: fixture.candidate.patchId,
        patchSha256: fixture.candidate.patchSha256,
        paths: fixture.candidate.paths,
      },
      spike: { commit: fixture.spikeCommit, parent: fixture.baselineCommit },
    });
  });

  it('applies the exact candidate patch atop a newer unrelated clean source commit', () => {
    const fixture = realRebasedCandidateFixture();
    const binding = authenticateGenerationCandidateRoots({
      baselineRoot: fixture.baseline,
      candidate: fixture.candidate,
      candidateRepository: fixture.repository,
      spikeRoot: fixture.spike,
    });

    expect(binding).toMatchObject({
      baseline: { commit: fixture.sourceCommit },
      candidate: fixture.candidate,
      schema: 'kovo-dev-generation-candidate-binding/v3',
      spike: { parent: fixture.sourceCommit },
    });
    expect(fixture.sourceCommit).not.toBe(fixture.candidate.parent);
  });

  it('rejects candidate identity drift, patch drift, and dirty roots', () => {
    const identityDrift = candidateFixture();
    expect(() =>
      authenticateGenerationCandidateRoots(
        {
          baselineRoot: identityDrift.baseline,
          candidate: { ...identityDrift.candidate, tree: 'f'.repeat(40) },
          candidateRepository: identityDrift.repository,
          spikeRoot: identityDrift.spike,
        },
        identityDrift.dependencies,
      ),
    ).toThrow(/object identity/u);

    const drift = candidateFixture();
    expect(() =>
      authenticateGenerationCandidateRoots(
        {
          baselineRoot: drift.baseline,
          candidate: drift.candidate,
          candidateRepository: drift.repository,
          spikeRoot: drift.spike,
        },
        {
          ...drift.dependencies,
          patch: (_root, from) => Buffer.from(from === 'parent' ? 'patch' : 'drift'),
        },
      ),
    ).toThrow(/does not exactly match/u);

    const dirty = candidateFixture({
      spikeStatus: ' M packages/server/src/security-bootstrap.test.ts',
    });
    expect(() =>
      authenticateGenerationCandidateRoots(
        {
          baselineRoot: dirty.baseline,
          candidate: dirty.candidate,
          candidateRepository: dirty.repository,
          spikeRoot: dirty.spike,
        },
        dirty.dependencies,
      ),
    ).toThrow(/must be clean/u);
  });

  it('rejects a prior-schema candidate binding before preparation can reinterpret it', async () => {
    await expect(
      prepareDevGenerationSpike(
        { baselineRoot: '/unused-baseline', size: 24, spikeRoot: '/unused-spike' },
        {
          authenticateRoots: () => ({
            ...preparedFixture('/unused-baseline', '/unused-spike').candidateBinding,
            schema: 'kovo-dev-generation-candidate-binding/v2',
          }),
        },
      ),
    ).rejects.toThrow(/prior evidence cannot be reinterpreted/u);
  });

  it('prepares and cleans separate report-bound products for baseline and spike', async () => {
    const baselineRoot = temporaryDirectory('kovo-dev-generation-prepare-products-baseline-');
    const spikeRoot = temporaryDirectory('kovo-dev-generation-prepare-products-spike-');
    const baseline = sourceState('a'.repeat(40));
    const spike = sourceState('b'.repeat(40));
    const corpus = corpusIdentity();
    const cleanup = { baseline: vi.fn(), spike: vi.fn() };
    const preparePackedLane = vi.fn(async ({ lane, root, size, source }) => {
      const product = productCapability(source, `separate-${lane}`);
      return {
        cleanup: cleanup[lane],
        consumerRoot: product.consumerRoot,
        corpus,
        descriptorPath: product.descriptorPath,
        externalRoot: product.externalRoot,
        identity: product.identity,
        manifestPath: product.manifestPath,
        sourceAfter: source,
        tooling: toolingIdentity(),
      };
    });
    const binding = {
      baseline: { commit: baseline.commit, root: baselineRoot },
      candidate: { commit: 'c'.repeat(40), patchId: 'd'.repeat(40), patchSha256: digest('e') },
      schema: DEV_GENERATION_CANDIDATE_BINDING_SCHEMA,
      spike: { commit: spike.commit, parent: baseline.commit, root: spikeRoot },
    };
    const prepared = await prepareDevGenerationSpike(
      {
        baselineRoot,
        installTimeoutMs: 600_000,
        size: 24,
        spikeRoot,
      },
      {
        authenticateRoots: () => binding,
        collectState: (root) => (root === baselineRoot ? baseline : spike),
        preparePackedLane,
      },
    );

    expect(preparePackedLane).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ lane: 'baseline', root: baselineRoot, size: 24, source: baseline }),
      expect.any(Object),
    );
    expect(preparePackedLane).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ lane: 'spike', root: spikeRoot, size: 24, source: spike }),
      expect.any(Object),
    );
    expect(prepared.products.baseline.externalRoot).not.toBe(prepared.products.spike.externalRoot);
    expect(prepared.products.baseline.identity.digest).not.toBe(
      prepared.products.spike.identity.digest,
    );
    expect(prepared.productBoundary).toMatchObject({
      complete: true,
      policy: DEV_GENERATION_PRODUCT_POLICY,
      separateConsumersAndDescriptors: true,
      separatePreparationRoots: true,
    });

    prepared.cleanup();
    prepared.cleanup();
    expect(cleanup.baseline).toHaveBeenCalledOnce();
    expect(cleanup.spike).toHaveBeenCalledOnce();
  });

  it('rejects two arms that alias one authenticated consumer descriptor', async () => {
    const baselineRoot = temporaryDirectory('kovo-dev-generation-alias-baseline-');
    const spikeRoot = temporaryDirectory('kovo-dev-generation-alias-spike-');
    const states = {
      baseline: sourceState('a'.repeat(40)),
      spike: sourceState('b'.repeat(40)),
    };
    const products = {
      baseline: productCapability(states.baseline, 'alias-baseline'),
      spike: productCapability(states.spike, 'alias-spike'),
    };
    products.spike.consumerRoot = products.baseline.consumerRoot;
    products.spike.descriptorPath = products.baseline.descriptorPath;
    const binding = {
      baseline: { commit: states.baseline.commit, root: baselineRoot },
      candidate: { commit: 'c'.repeat(40), patchId: 'd'.repeat(40), patchSha256: digest('e') },
      schema: DEV_GENERATION_CANDIDATE_BINDING_SCHEMA,
      spike: { commit: states.spike.commit, parent: states.baseline.commit, root: spikeRoot },
    };

    await expect(
      prepareDevGenerationSpike(
        { baselineRoot, installTimeoutMs: 600_000, size: 24, spikeRoot },
        {
          authenticateRoots: () => binding,
          collectState: (root) => (root === baselineRoot ? states.baseline : states.spike),
          preparePackedLane: async ({ lane, source }) => ({
            cleanup() {},
            consumerRoot: products[lane].consumerRoot,
            corpus: corpusIdentity(),
            descriptorPath: products[lane].descriptorPath,
            externalRoot: products[lane].externalRoot,
            identity: products[lane].identity,
            manifestPath: products[lane].manifestPath,
            sourceAfter: source,
            tooling: toolingIdentity(),
          }),
        },
      ),
    ).rejects.toThrow(/separate packed product consumers\/descriptors/u);
  });

  it('authenticates a generated N=24 corpus and enforces literal localhost', () => {
    const root = temporaryDirectory('kovo-dev-generation-corpus-');
    const workload = {
      buildOutputContract: 'required-nonempty-and-cleanup-absent/v1',
      componentImportFanout: 24,
      devPortAllocationPosture: 'unique-exact-port-outside-host-ephemeral/v2',
      editClasses: EDIT_CLASSES,
      editSavePosture: 'posix-sibling-temp-write-rename/v1',
      routes: 4,
      stateSurface: 'local-counter',
      workloadModules: 24,
    };
    const sourceFiles = [{ bytes: 1, file: 'src/app.tsx', sha256: digest('b') }];
    const sourceDigest = `sha256:${createHash('sha256')
      .update(JSON.stringify(sourceFiles))
      .digest('hex')}`;
    const manifest = {
      dev: {
        command: {
          argv: ['node_modules/.bin/kovo', 'dev', '--host', 'localhost', '--port', '{port}'],
        },
      },
      framework: 'kovo',
      modules: 24,
      routes: 4,
      schema: 'kovo-dev-corpus/v1',
      shapeDigest: createHash('sha256').update(JSON.stringify(workload)).digest('hex'),
      sourceDigest,
      sourceFiles,
      workload,
    };
    const manifestPath = path.join(root, 'manifest.json');
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);

    expect(inspectGeneratedDevCorpus(manifestPath, root)).toMatchObject({
      devPortAllocationPosture: 'unique-exact-port-outside-host-ephemeral/v2',
      editClasses: EDIT_CLASSES,
      editSavePosture: 'posix-sibling-temp-write-rename/v1',
      modules: 24,
      routes: 4,
      shapeDigest: `sha256:${manifest.shapeDigest}`,
      sourceDigest,
    });

    manifest.dev.command.argv = ['kovo', 'dev', '--host', '127.0.0.1', '--port', '{port}'];
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    expect(() => inspectGeneratedDevCorpus(manifestPath, root)).toThrow(/literal localhost/u);
  });

  it('validates browser-visible correctness, source identity, and RSS for each cell', () => {
    const state = sourceState('a'.repeat(40));
    const corpus = corpusIdentity();
    const product = productCapability(state, 'cell-validation');
    const cell = scheduledCell(
      'baseline',
      0,
      fakeAdapterReport({
        commit: state.commit,
        corpus,
        editSamples: 1,
        latency: 100,
        locks: state.locks,
        port: 49_750,
        product,
        readySamples: 1,
      }),
      0,
      product,
    );
    expect(
      validateDevGenerationCell(cell, {
        commit: state.commit,
        corpus,
        locks: state.locks,
        product,
      }),
    ).toEqual([]);

    // A browser request failure remains blocking even if the adapter classified its surrounding
    // syntax-error phase as expected. Startup polling now happens outside the browser instead.
    cell.report.integrity.browser.requestFailedCount = 1;
    expect(
      validateDevGenerationCell(cell, {
        commit: state.commit,
        corpus,
        locks: state.locks,
        product,
      }),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/adapter correctness failure/u)]));

    cell.report.integrity.browser.requestFailedCount = 0;
    cell.report.readySamples[0].readinessProbe.transientFailures = 99;
    expect(
      validateDevGenerationCell(cell, {
        commit: state.commit,
        corpus,
        locks: state.locks,
        product,
      }),
    ).toEqual(
      expect.arrayContaining([expect.stringMatching(/fresh-ready evidence is incomplete/u)]),
    );

    cell.report.readySamples[0].readinessProbe.transientFailures = 0;
    cell.report.readySamples[0].browserContextClosed = false;
    expect(
      validateDevGenerationCell(cell, {
        commit: state.commit,
        corpus,
        locks: state.locks,
        product,
      }),
    ).toEqual(
      expect.arrayContaining([expect.stringMatching(/fresh-ready evidence is incomplete/u)]),
    );

    cell.report.readySamples[0].browserContextClosed = true;
    delete cell.report.editSession.browserContextClosed;
    expect(
      validateDevGenerationCell(cell, {
        commit: state.commit,
        corpus,
        locks: state.locks,
        product,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/edit-session readiness or RSS evidence is incomplete/u),
      ]),
    );

    cell.report.editSession.browserContextClosed = true;
    cell.report.samples[0].dataStateSurvived = false;
    expect(
      validateDevGenerationCell(cell, {
        commit: state.commit,
        corpus,
        locks: state.locks,
        product,
      }),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/lost state during data/u)]));
  });

  it('fails closed on per-arm product, CLI confinement, policy, and external-root drift', () => {
    const baseline = sourceState('a'.repeat(40));
    const spike = sourceState('b'.repeat(40));
    const corpus = corpusIdentity();
    const baselineProduct = productCapability(baseline, 'boundary-baseline');
    const spikeProduct = productCapability(spike, 'boundary-spike');
    const report = fakeAdapterReport({
      commit: baseline.commit,
      corpus,
      editSamples: 1,
      latency: 100,
      locks: baseline.locks,
      port: 49_750,
      product: baselineProduct,
      readySamples: 1,
    });

    expect(baselineProduct.identity.digest).not.toBe(spikeProduct.identity.digest);
    expect(inspectDevGenerationProductBoundary(report, baselineProduct)).toMatchObject({
      complete: true,
      corpus: {
        ancestorDependencyIsolationVerified: true,
        reportBound: true,
      },
      productArtifact: {
        reportBound: true,
        verifiedBeforeAndAfter: true,
      },
    });

    const wrongArm = structuredClone(report);
    wrongArm.productArtifact = spikeProduct.identity;
    expect(inspectDevGenerationProductBoundary(wrongArm, baselineProduct)).toMatchObject({
      complete: false,
      errors: expect.arrayContaining([expect.stringMatching(/differs from its prepared lane/u)]),
    });

    const workspaceCli = structuredClone(report);
    workspaceCli.integrity.command.argv[1] = '/workspace/packages/cli/dist/bin.mjs';
    expect(inspectDevGenerationProductBoundary(workspaceCli, baselineProduct)).toMatchObject({
      complete: false,
      errors: expect.arrayContaining([expect.stringMatching(/normalized packed Kovo CLI/u)]),
    });

    const missingAfterProof = structuredClone(report);
    missingAfterProof.integrity.productArtifact.afterVerified = false;
    expect(inspectDevGenerationProductBoundary(missingAfterProof, baselineProduct)).toMatchObject({
      complete: false,
      errors: expect.arrayContaining([expect.stringMatching(/before and after/u)]),
    });

    const policyDrift = {
      ...baselineProduct,
      policy: { ...DEV_GENERATION_PRODUCT_POLICY, schema: 'source-checkout-policy/v2' },
    };
    expect(inspectDevGenerationProductBoundary(report, policyDrift)).toMatchObject({
      complete: false,
      errors: expect.arrayContaining([expect.stringMatching(/policy drift/u)]),
    });

    const wrongExternalCorpus = structuredClone(report);
    wrongExternalCorpus.corpus.manifestPath = spikeProduct.manifestPath;
    expect(inspectDevGenerationProductBoundary(wrongExternalCorpus, baselineProduct)).toMatchObject(
      {
        complete: false,
        errors: expect.arrayContaining([
          expect.stringMatching(/differs from its prepared external corpus/u),
        ]),
      },
    );
  });

  it('accepts four causal wins while syntax stays flat, correct, and below its p95 target', () => {
    const cells = comparisonCells();
    for (const cell of cells) cell.report.bundleBytes = cell.lane === 'spike' ? 1_000_000 : 1;
    const result = aggregateDevGenerationCells(cells, decisionPolicy());

    expect(result.correctness).toMatchObject({ complete: true, misses: 0, stateLost: 0 });
    expect(result.metrics.leafMs).toMatchObject({
      baseline: { mad: 0, median: 100, p95: 100, samples: 30 },
      pairedImprovement: { bootstrap95Ci: [25, 25], median: 25, samples: 30 },
      spike: { median: 75 },
      spikeMedianImprovementPercent: 25,
      spikeP95ImprovementPercent: 25,
    });
    expect(result.acceptance).toMatchObject({
      candidateAccepted: true,
      candidateP95Targets: {
        recoveryMs: { maximumMs: 2_000, observedMs: 75, passed: true },
        syntaxErrorMs: { maximumMs: 1_000, observedMs: 100, passed: true },
      },
      decisionSamplePolicy: { complete: true },
      excludedProxyEvidence: ['bundleBytes', 'emittedBytes', 'moduleCount'],
      guardrails: {
        editPeakRssBytes: { passed: true },
        readyMs: { passed: true },
        readyPeakRssBytes: { passed: true },
        syntaxErrorMs: {
          median: { observedImprovementPercent: 0, passed: true },
          p95: { observedImprovementPercent: 0, passed: true },
          passed: true,
        },
      },
      requiredBrowserVisibleMetrics: ['leafMs', 'entryMs', 'dataMs', 'recoveryMs'],
      rule: 'profiled-causal-edit-wins-and-noncausal-target-guardrails/packed-v3',
    });
    expect(
      Object.values(result.acceptance.causalMetricAcceptance).every((metric) => metric.passed),
    ).toBe(true);

    cells[0].report.samples[0].syntaxErrorDiagnosticSignal = '';
    const incorrect = aggregateDevGenerationCells(cells, decisionPolicy());
    expect(incorrect.correctness.complete).toBe(false);
    expect(incorrect.acceptance.candidateAccepted).toBe(false);
  });

  it('rejects causal median, p95-regression, and absolute-target failures', () => {
    const medianMiss = comparisonCells();
    for (const cell of medianMiss.filter((value) => value.lane === 'spike')) {
      for (const sample of cell.report.samples) sample.leafMs = 91;
    }
    expect(
      aggregateDevGenerationCells(medianMiss, decisionPolicy()).acceptance.causalMetricAcceptance
        .leafMs,
    ).toMatchObject({ improvementAtLeast10Percent: false, passed: false });

    const p95Regression = comparisonCells();
    for (const cell of p95Regression.filter((value) => value.lane === 'spike')) {
      cell.report.samples.at(-1).syntaxErrorMs = 106;
    }
    expect(
      aggregateDevGenerationCells(p95Regression, decisionPolicy()).acceptance.guardrails
        .syntaxErrorMs,
    ).toMatchObject({
      median: { observedImprovementPercent: 0, passed: true },
      p95: { observedImprovementPercent: -6, passed: false },
      passed: false,
    });

    const syntaxTarget = comparisonCells({
      baselineSyntaxLatency: 1_100,
      spikeSyntaxLatency: 1_100,
    });
    expect(
      aggregateDevGenerationCells(syntaxTarget, decisionPolicy()).acceptance.candidateP95Targets
        .syntaxErrorMs,
    ).toEqual({ maximumMs: 1_000, observedMs: 1_100, passed: false });

    const recoveryTarget = comparisonCells({
      baselineCausalLatency: 3_000,
      spikeCausalLatency: 2_500,
    });
    const recoveryResult = aggregateDevGenerationCells(recoveryTarget, decisionPolicy());
    expect(recoveryResult.acceptance.causalMetricAcceptance.recoveryMs.passed).toBe(true);
    expect(recoveryResult.acceptance.candidateP95Targets.recoveryMs).toEqual({
      maximumMs: 2_000,
      observedMs: 2_500,
      passed: false,
    });
    expect(recoveryResult.acceptance.candidateAccepted).toBe(false);
  });

  it('requires median and p95 guardrails plus the full preregistered sample policy', () => {
    const readyP95Regression = comparisonCells();
    for (const cell of readyP95Regression.filter((value) => value.lane === 'spike')) {
      cell.report.readySamples.at(-1).durationMs = 106;
    }
    const p95 = aggregateDevGenerationCells(readyP95Regression, decisionPolicy());
    expect(p95.acceptance.guardrails.readyMs).toMatchObject({
      median: { passed: true },
      p95: { observedImprovementPercent: -6, passed: false },
      passed: false,
    });

    const editRssMedianRegression = comparisonCells();
    for (const cell of editRssMedianRegression.filter((value) => value.lane === 'spike')) {
      cell.report.editSession.peakRssBytes = 1_060;
    }
    expect(
      aggregateDevGenerationCells(editRssMedianRegression, decisionPolicy()).acceptance.guardrails
        .editPeakRssBytes,
    ).toMatchObject({
      median: { observedImprovementPercent: -6, passed: false },
      p95: { observedImprovementPercent: -6, passed: false },
      passed: false,
    });

    const short = comparisonCells();
    const shortPolicy = { ...decisionPolicy(), editSamples: 2, readySamples: 2, warmups: 0 };
    expect(
      aggregateDevGenerationCells(short, shortPolicy).acceptance.decisionSamplePolicy,
    ).toMatchObject({ complete: false, declaredComplete: false });
  });

  it('serializes the real-adapter seam as B,S,S,B and keeps smoke evidence unproven', async () => {
    const baselineRoot = temporaryDirectory('kovo-dev-generation-baseline-');
    const spikeRoot = temporaryDirectory('kovo-dev-generation-spike-');
    const prepared = preparedFixture(baselineRoot, spikeRoot);
    const calls = [];
    const events = [];
    const sampleCounts = new Map();
    let released = false;
    const report = await runDevGenerationSpike(
      {
        baselineRoot,
        bootstrapIterations: 500,
        hostSettleMaxMs: 10,
        hostSettlePollMs: 10,
        measure: true,
        quickSmoke: true,
        spikeRoot,
      },
      {
        acquireLock: () => {
          events.push('lock:acquire');
          return {
            release: () => {
              events.push('lock:release');
              released = true;
            },
          };
        },
        collectState: (root) =>
          prepared.source.before[root === baselineRoot ? 'baseline' : 'spike'],
        hostFingerprint: () => ({ schema: 'test-host/v1' }),
        prepare: async () => prepared,
        runAdapter: async (options) => {
          const lane = options.root === baselineRoot ? 'baseline' : 'spike';
          events.push(`adapter:${String(options.port)}`);
          calls.push({
            lane,
            manifestPath: options.manifestPath,
            port: options.port,
            productDigest: options.packedProduct.identity.digest,
            readyTimeoutMs: options.readyTimeoutMs,
            timeoutMs: options.timeoutMs,
          });
          const state = prepared.source.before[lane];
          return fakeAdapterReport({
            commit: state.commit,
            corpus: prepared.corpus[lane],
            editSamples: options.editSamples,
            latency: lane === 'baseline' ? 100 : 75,
            locks: state.locks,
            port: options.port,
            product: options.packedProduct,
            readyLatency: lane === 'baseline' ? 100 : 95,
            readySamples: options.readySamples,
            rss: 1_000,
            warmups: options.warmups,
          });
        },
        sampleHost: (label, ceiling) => {
          events.push(`host:${label}`);
          const count = sampleCounts.get(label) ?? 0;
          sampleCounts.set(label, count + 1);
          const oneMinuteLoad =
            label === 'post-timing' || (label === 'block-1-spike' && count === 0) ? 20 : 0.1;
          return {
            at: '2026-08-13T00:00:00.000Z',
            ceiling,
            comparable: oneMinuteLoad / 10 <= ceiling,
            cpuCount: 10,
            label,
            loadAverage: [oneMinuteLoad, oneMinuteLoad, oneMinuteLoad],
            loadPerCpu: oneMinuteLoad / 10,
          };
        },
        waitForHost: async (milliseconds) => {
          events.push(`wait:${String(milliseconds)}`);
        },
      },
    );

    expect(calls).toEqual([
      {
        lane: 'baseline',
        manifestPath: prepared.products.baseline.manifestPath,
        port: 20_000,
        productDigest: prepared.products.baseline.identity.digest,
        readyTimeoutMs: 600_000,
        timeoutMs: 1_800_000,
      },
      {
        lane: 'spike',
        manifestPath: prepared.products.spike.manifestPath,
        port: 20_128,
        productDigest: prepared.products.spike.identity.digest,
        readyTimeoutMs: 600_000,
        timeoutMs: 1_800_000,
      },
      {
        lane: 'spike',
        manifestPath: prepared.products.spike.manifestPath,
        port: 20_256,
        productDigest: prepared.products.spike.identity.digest,
        readyTimeoutMs: 600_000,
        timeoutMs: 1_800_000,
      },
      {
        lane: 'baseline',
        manifestPath: prepared.products.baseline.manifestPath,
        port: 20_384,
        productDigest: prepared.products.baseline.identity.digest,
        readyTimeoutMs: 600_000,
        timeoutMs: 1_800_000,
      },
    ]);
    expect(events).toEqual([
      'host:pre-preparation',
      'lock:acquire',
      'host:block-0-baseline',
      'adapter:20000',
      'host:block-1-spike',
      'wait:10',
      'host:block-1-spike',
      'adapter:20128',
      'host:block-2-spike',
      'adapter:20256',
      'host:block-3-baseline',
      'adapter:20384',
      'host:post-timing',
      'lock:release',
    ]);
    expect(released).toBe(true);
    expect(report.hostSamples).toHaveLength(5);
    expect(report.hostSamples.every((sample) => sample.comparable)).toBe(true);
    expect(report.hostSamples[2]).toMatchObject({
      gatesTiming: true,
      label: 'block-1-spike',
      settle: { rejectedObservations: 1, waitedMs: 10 },
    });
    expect(report.hostDiagnostics).toEqual([
      expect.objectContaining({
        comparable: false,
        gatesTiming: false,
        label: 'post-timing',
        loadPerCpu: 2,
        phase: 'host-diagnostic',
        posture: 'post-timing',
      }),
    ]);
    expect(report.analysis.acceptance.decisionSamplePolicy).toMatchObject({
      complete: false,
      declaredComplete: false,
    });
    expect(report.integrity).toMatchObject({
      complete: false,
      errors: [expect.stringContaining('packed v3 decision sample policy')],
      serialized: true,
      sourceStable: true,
    });
    expect(report.verdict).toMatchObject({
      reasons: [expect.stringContaining('packed v3 decision sample policy')],
      status: 'unproven',
    });
  });

  it('classifies a complete full-policy threshold miss as reject, not unproven', async () => {
    const baselineRoot = temporaryDirectory('kovo-dev-generation-reject-baseline-');
    const spikeRoot = temporaryDirectory('kovo-dev-generation-reject-spike-');
    const prepared = preparedFixture(baselineRoot, spikeRoot);
    const report = await runDevGenerationSpike(
      {
        baselineRoot,
        bootstrapIterations: 500,
        hostSettleMaxMs: 10,
        hostSettlePollMs: 10,
        measure: true,
        spikeRoot,
      },
      {
        acquireLock: () => ({ release: () => undefined }),
        collectState: (root) =>
          prepared.source.before[root === baselineRoot ? 'baseline' : 'spike'],
        hostFingerprint: () => ({ schema: 'test-host/v1' }),
        prepare: async () => prepared,
        runAdapter: async (options) => {
          const lane = options.root === baselineRoot ? 'baseline' : 'spike';
          const state = prepared.source.before[lane];
          return fakeAdapterReport({
            commit: state.commit,
            corpus: prepared.corpus[lane],
            editSamples: options.editSamples,
            latencies: {
              data: lane === 'baseline' ? 100 : 75,
              entry: lane === 'baseline' ? 100 : 75,
              leaf: lane === 'baseline' ? 100 : 91,
              recovery: lane === 'baseline' ? 100 : 75,
              syntaxError: 100,
            },
            locks: state.locks,
            port: options.port,
            product: options.packedProduct,
            readyLatency: 100,
            readySamples: options.readySamples,
            warmups: options.warmups,
          });
        },
        sampleHost: comparableHostSample,
      },
    );

    expect(report.integrity).toMatchObject({ complete: true, errors: [] });
    expect(report.analysis.acceptance.causalMetricAcceptance.leafMs.passed).toBe(false);
    expect(report.verdict).toMatchObject({
      reasons: [expect.stringContaining('did not satisfy every packed v3 causal win')],
      status: 'reject',
    });
  });

  it('retains a failed raw adapter cell and cannot claim correctness from a short schedule', async () => {
    const baselineRoot = temporaryDirectory('kovo-dev-generation-failed-baseline-');
    const spikeRoot = temporaryDirectory('kovo-dev-generation-failed-spike-');
    const prepared = preparedFixture(baselineRoot, spikeRoot);
    const state = prepared.source.before.baseline;
    const failedReport = fakeAdapterReport({
      commit: state.commit,
      corpus: prepared.corpus.baseline,
      editSamples: 1,
      latency: 100,
      locks: state.locks,
      port: 49_750,
      product: prepared.products.baseline,
      readySamples: 1,
    });
    failedReport.integrity.complete = false;
    failedReport.integrity.errors = ['ready lifecycle failed', 'raw adapter failure'];
    failedReport.integrity.misses = 3;
    failedReport.integrity.browser.requestFailedCount = 4;
    failedReport.verdict.status = 'unproven';
    const adapterError = new Error('adapter exited nonzero');
    adapterError.adapterFailure = {
      evidence: {
        process: { error: null, signal: null, status: 1 },
        rawReport: {
          available: true,
          reportBytes: 1_234,
          reportSha256: digest('b'),
          schema: 'kovo-dev-loop-report/v1',
          verdict: 'unproven',
        },
        schema: 'kovo-dev-generation-adapter-failure/v3',
        summary: { integrityErrors: failedReport.integrity.errors },
      },
      report: failedReport,
    };

    const report = await runDevGenerationSpike(
      { baselineRoot, measure: true, quickSmoke: true, spikeRoot },
      {
        acquireLock: () => ({ release: () => undefined }),
        collectState: (root) =>
          prepared.source.before[root === baselineRoot ? 'baseline' : 'spike'],
        hostFingerprint: () => ({ schema: 'test-host/v1' }),
        prepare: async () => prepared,
        runAdapter: async () => {
          throw adapterError;
        },
        sampleHost: comparableHostSample,
      },
    );

    expect(report.cells).toHaveLength(1);
    expect(report.cells[0]).toMatchObject({
      adapterFailure: {
        rawReport: { reportBytes: 1_234, reportSha256: digest('b') },
        schema: 'kovo-dev-generation-adapter-failure/v3',
      },
      report: failedReport,
    });
    expect(report.analysis.correctness).toMatchObject({
      adapterErrors: 2,
      adapterProcessFailures: 1,
      adapterUnproven: 1,
      browserRequestFailures: 4,
      complete: false,
      completeSchedule: false,
      expectedCells: 4,
      misses: 3,
      observedCells: 1,
    });
    expect(report.analysis.acceptance.candidateAccepted).toBe(false);
    expect(report.integrity.complete).toBe(false);
    expect(report.verdict.status).toBe('unproven');
  });

  it('summarizes malformed-but-valid JSON adapter reports without losing raw custody', () => {
    const bytes = Buffer.from('{"integrity":{"errors":{},"misses":"many"},"readySamples":{}}');

    expect(() => summarizeFailedAdapterReport(JSON.parse(bytes), bytes)).not.toThrow();
    expect(summarizeFailedAdapterReport(JSON.parse(bytes), bytes)).toEqual(
      expect.objectContaining({
        integrityErrors: [],
        misses: null,
        readyFailures: [],
        reportBytes: bytes.byteLength,
        reportSha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        schema: null,
        verdict: null,
      }),
    );
  });

  it('aggregates a malformed retained adapter report as incomplete instead of throwing', () => {
    const report = {
      integrity: {
        browser: { requestFailedCount: 'unknown', unexpectedErrorCount: null },
        complete: false,
        errors: {},
        misses: 'unknown',
      },
      readySamples: {},
      samples: {},
      verdict: { status: 'unproven' },
    };
    const cells = [
      {
        adapterFailure: { schema: 'kovo-dev-generation-adapter-failure/v3' },
        lane: 'baseline',
        occurrence: 0,
        report,
        scheduleIndex: 0,
      },
    ];

    expect(() =>
      aggregateDevGenerationCells(cells, { bootstrapIterations: 100, seed: 1 }),
    ).not.toThrow();
    expect(
      aggregateDevGenerationCells(cells, { bootstrapIterations: 100, seed: 1 }).correctness,
    ).toMatchObject({
      adapterErrors: 1,
      adapterProcessFailures: 1,
      complete: false,
      completeSchedule: false,
      misses: 1,
    });
  });

  it('supports authentication-only preparation and refuses implicit timing', async () => {
    const baselineRoot = temporaryDirectory('kovo-dev-generation-prepare-baseline-');
    const spikeRoot = temporaryDirectory('kovo-dev-generation-prepare-spike-');
    const prepared = preparedFixture(baselineRoot, spikeRoot);
    prepared.cleanup = vi.fn();
    const runAdapter = vi.fn();
    const report = await runDevGenerationSpike(
      { baselineRoot, prepareOnly: true, quickSmoke: true, spikeRoot },
      {
        hostFingerprint: () => ({ schema: 'test-host/v1' }),
        prepare: async () => prepared,
        runAdapter,
      },
    );

    expect(runAdapter).not.toHaveBeenCalled();
    expect(prepared.cleanup).toHaveBeenCalledOnce();
    expect(report).toMatchObject({
      integrity: { complete: true, matchedCorpus: true, sourceStable: true },
      mode: 'prepare-only',
      verdict: { status: 'prepared' },
    });
    expect(() =>
      parseDevGenerationSpikeArgs(['--baseline-root', baselineRoot, '--spike-root', spikeRoot]),
    ).toThrow(/explicitly authorize timing/u);
    expect(
      parseDevGenerationSpikeArgs([
        '--baseline-root',
        baselineRoot,
        '--spike-root',
        spikeRoot,
        '--size',
        '216',
        '--ready-timeout-ms',
        '600000',
        '--timeout-ms',
        '3600000',
        '--measure',
      ]),
    ).toMatchObject({ measure: true, readyTimeoutMs: 600_000, size: 216, timeoutMs: 3_600_000 });
  });

  it('marks source-checkout v2 preparation evidence unproven under the packed v3 boundary', async () => {
    const baselineRoot = temporaryDirectory('kovo-dev-generation-v2-prepare-baseline-');
    const spikeRoot = temporaryDirectory('kovo-dev-generation-v2-prepare-spike-');
    const prepared = preparedFixture(baselineRoot, spikeRoot);
    prepared.productBoundary.schema = 'kovo-dev-generation-packed-product-boundary/v2';

    const report = await runDevGenerationSpike(
      { baselineRoot, prepareOnly: true, quickSmoke: true, spikeRoot },
      {
        hostFingerprint: () => ({ schema: 'test-host/v1' }),
        prepare: async () => prepared,
      },
    );

    expect(report).toMatchObject({
      integrity: {
        complete: false,
        errors: [expect.stringMatching(/packed v3 preparation boundary evidence/u)],
      },
      schema: DEV_GENERATION_SPIKE_PREPARE_SCHEMA,
      verdict: {
        reasons: [expect.stringMatching(/packed v3 preparation boundary evidence/u)],
        status: 'unproven',
      },
    });
  });

  it('refuses a loaded host before taking the timing lock or launching an adapter', async () => {
    const baselineRoot = temporaryDirectory('kovo-dev-generation-load-baseline-');
    const spikeRoot = temporaryDirectory('kovo-dev-generation-load-spike-');
    const prepared = preparedFixture(baselineRoot, spikeRoot);
    const acquireLock = vi.fn();
    const runAdapter = vi.fn();

    await expect(
      runDevGenerationSpike(
        {
          baselineRoot,
          hostSettleMaxMs: 0,
          measure: true,
          quickSmoke: true,
          spikeRoot,
        },
        {
          acquireLock,
          prepare: async () => prepared,
          runAdapter,
          sampleHost: (label, ceiling) => ({
            at: '2026-08-13T00:00:00.000Z',
            ceiling,
            comparable: false,
            cpuCount: 10,
            label,
            loadAverage: [20, 20, 20],
            loadPerCpu: 2,
          }),
        },
      ),
    ).rejects.toThrow(/no timing process was started/u);
    expect(acquireLock).not.toHaveBeenCalled();
    expect(runAdapter).not.toHaveBeenCalled();
  });

  it('fails closed on a loaded pre-block admission without timing that block', async () => {
    const baselineRoot = temporaryDirectory('kovo-dev-generation-block-load-baseline-');
    const spikeRoot = temporaryDirectory('kovo-dev-generation-block-load-spike-');
    const prepared = preparedFixture(baselineRoot, spikeRoot);
    const release = vi.fn();
    const runAdapter = vi.fn();

    const report = await runDevGenerationSpike(
      {
        baselineRoot,
        hostSettleMaxMs: 0,
        measure: true,
        quickSmoke: true,
        spikeRoot,
      },
      {
        acquireLock: () => ({ release }),
        collectState: (root) =>
          prepared.source.before[root === baselineRoot ? 'baseline' : 'spike'],
        hostFingerprint: () => ({ schema: 'test-host/v1' }),
        prepare: async () => prepared,
        runAdapter,
        sampleHost: (label, ceiling) => {
          const oneMinuteLoad = label === 'pre-preparation' ? 0.1 : 20;
          return {
            at: '2026-08-13T00:00:00.000Z',
            ceiling,
            comparable: oneMinuteLoad / 10 <= ceiling,
            cpuCount: 10,
            label,
            loadAverage: [oneMinuteLoad, oneMinuteLoad, oneMinuteLoad],
            loadPerCpu: oneMinuteLoad / 10,
          };
        },
      },
    );

    expect(runAdapter).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
    expect(report.hostSamples).toHaveLength(2);
    expect(report.hostSamples[1]).toMatchObject({
      comparable: false,
      gatesTiming: true,
      label: 'block-0-baseline',
      posture: 'post-benchmark',
    });
    expect(report.hostDiagnostics).toEqual([]);
    expect(report.integrity).toMatchObject({
      complete: false,
      errors: expect.arrayContaining([
        expect.stringContaining('block 0: post-benchmark host load'),
        expect.stringContaining('packed v3 product boundary evidence'),
      ]),
    });
  });

  it('records an unproven host range and refuses every timing control before launch', async () => {
    const baselineRoot = temporaryDirectory('kovo-dev-generation-range-baseline-');
    const spikeRoot = temporaryDirectory('kovo-dev-generation-range-spike-');
    const prepared = preparedFixture(baselineRoot, spikeRoot);
    const acquireLock = vi.fn();
    const runAdapter = vi.fn();
    const sampleHost = vi.fn();
    const report = await runDevGenerationSpike(
      { baselineRoot, measure: true, quickSmoke: true, spikeRoot },
      {
        acquireLock,
        collectState: (root) =>
          prepared.source.before[root === baselineRoot ? 'baseline' : 'spike'],
        inspectPortAllocation: async ({ basePort, inspectorPorts, ports }) => ({
          basePort,
          complete: false,
          errors: ['host ephemeral port range is unproven: unsupported host'],
          hostEphemeral: {
            complete: false,
            error: 'unsupported host',
            platform: 'aix',
            probe: null,
            ranges: [],
            schema: 'kovo-host-ephemeral-port-ranges/v1',
            scope: 'tcp-loopback-v4-v6/v1',
          },
          inspectorPorts,
          overlaps: [],
          ports,
          posture: 'unique-exact-port-outside-host-ephemeral/v2',
          schema: 'kovo-dev-port-allocation/v1',
        }),
        prepare: async () => prepared,
        runAdapter,
        sampleHost,
      },
    );

    expect(sampleHost).not.toHaveBeenCalled();
    expect(acquireLock).not.toHaveBeenCalled();
    expect(runAdapter).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      integrity: {
        complete: false,
        errors: expect.arrayContaining([
          expect.stringContaining('host ephemeral port range is unproven'),
          expect.stringContaining('packed v3 product boundary evidence'),
        ]),
      },
      portAllocation: { complete: false, hostEphemeral: { platform: 'aix' } },
      verdict: { status: 'unproven' },
    });
  });
});

function candidateFixture({ spikeStatus = '' } = {}) {
  const root = temporaryDirectory('kovo-dev-generation-candidate-');
  const paths = {
    baseline: path.join(root, 'baseline'),
    repository: path.join(root, 'repository'),
    spike: path.join(root, 'spike'),
  };
  for (const directory of Object.values(paths)) mkdirSync(directory);
  const baseline = realpathSync(paths.baseline);
  const spike = realpathSync(paths.spike);
  const repository = realpathSync(paths.repository);
  const baselineCommit = 'a'.repeat(40);
  const spikeCommit = 'b'.repeat(40);
  const patch = Buffer.from('patch');
  const candidate = {
    commit: 'c'.repeat(40),
    parent: 'parent',
    patchId: 'd'.repeat(40),
    patchSha256: `sha256:${createHash('sha256').update(patch).digest('hex')}`,
    paths: ['one.ts', 'two.ts'],
    tree: 'e'.repeat(40),
  };
  const command = (directory, args) => `${directory}|${args.join(' ')}`;
  const answers = new Map([
    [command(baseline, ['rev-parse', '--show-toplevel']), baseline],
    [command(spike, ['rev-parse', '--show-toplevel']), spike],
    [command(baseline, ['rev-parse', 'HEAD']), baselineCommit],
    [command(spike, ['rev-parse', 'HEAD']), spikeCommit],
    [command(baseline, ['status', '--porcelain=v1', '--untracked-files=all']), ''],
    [command(spike, ['status', '--porcelain=v1', '--untracked-files=all']), spikeStatus],
    [command(spike, ['rev-parse', 'HEAD^']), baselineCommit],
    [command(spike, ['merge-base', baselineCommit, spikeCommit]), baselineCommit],
    [command(spike, ['rev-list', '--count', `${baselineCommit}..${spikeCommit}`]), '1'],
    [command(repository, ['rev-parse', `${candidate.commit}^{commit}`]), candidate.commit],
    [command(repository, ['rev-parse', `${candidate.commit}^`]), candidate.parent],
    [command(repository, ['rev-parse', `${candidate.commit}^{tree}`]), candidate.tree],
    [
      command(spike, ['diff', '--name-status', '--no-renames', baselineCommit, spikeCommit]),
      'M\tone.ts\nM\ttwo.ts',
    ],
  ]);
  const git = (directory, args) => {
    const key = command(directory, args);
    if (!answers.has(key)) throw new Error(`unexpected git request ${key}`);
    return answers.get(key);
  };
  return {
    baseline,
    baselineCommit,
    candidate,
    dependencies: {
      git,
      patch: () => patch,
      patchId: () => candidate.patchId,
    },
    repository,
    spike,
    spikeCommit,
  };
}

function realRebasedCandidateFixture() {
  const container = temporaryDirectory('kovo-dev-generation-rebased-candidate-');
  const repository = path.join(container, 'repository');
  const baseline = path.join(container, 'baseline');
  const spike = path.join(container, 'spike');
  mkdirSync(repository);
  const git = (cwd, args, options = {}) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options,
    });
  git(repository, ['init', '--quiet']);
  git(repository, ['config', 'user.name', 'Kovo test']);
  git(repository, ['config', 'user.email', 'kovo-test@invalid.example']);
  writeFileSync(path.join(repository, 'one.ts'), 'export const one = 1;\n');
  writeFileSync(path.join(repository, 'two.ts'), 'export const two = 2;\n');
  writeFileSync(path.join(repository, 'unrelated.md'), 'base\n');
  git(repository, ['add', '.']);
  git(repository, ['commit', '--quiet', '-m', 'base']);
  const parent = git(repository, ['rev-parse', 'HEAD']).trim();
  git(repository, ['branch', 'candidate']);
  git(repository, ['checkout', '--quiet', 'candidate']);
  writeFileSync(path.join(repository, 'one.ts'), 'export const one = 11;\n');
  writeFileSync(path.join(repository, 'two.ts'), 'export const two = 22;\n');
  git(repository, ['add', 'one.ts', 'two.ts']);
  git(repository, ['commit', '--quiet', '-m', 'candidate']);
  const commit = git(repository, ['rev-parse', 'HEAD']).trim();
  const tree = git(repository, ['rev-parse', 'HEAD^{tree}']).trim();
  const patch = execFileSync('git', [
    '-C',
    repository,
    'diff',
    '--binary',
    '--full-index',
    '--no-ext-diff',
    parent,
    commit,
  ]);
  const patchIdInput = execFileSync('git', [
    '-C',
    repository,
    'show',
    '--pretty=format:',
    '--binary',
    '--no-ext-diff',
    commit,
  ]);
  const patchId = execFileSync('git', ['patch-id', '--stable'], { input: patchIdInput })
    .toString('utf8')
    .trim()
    .split(/\s+/u)[0];
  git(repository, ['checkout', '--quiet', '-b', 'source', parent]);
  writeFileSync(path.join(repository, 'unrelated.md'), 'newer unrelated source\n');
  git(repository, ['add', 'unrelated.md']);
  git(repository, ['commit', '--quiet', '-m', 'newer unrelated source']);
  const sourceCommit = git(repository, ['rev-parse', 'HEAD']).trim();
  git(repository, ['checkout', '--quiet', 'candidate']);
  git(repository, ['worktree', 'add', '--quiet', baseline, 'source']);
  git(repository, ['worktree', 'add', '--quiet', '-b', 'spike', spike, 'source']);
  git(spike, ['cherry-pick', '--quiet', commit]);

  return {
    baseline,
    candidate: {
      commit,
      parent,
      patchId,
      patchSha256: `sha256:${createHash('sha256').update(patch).digest('hex')}`,
      paths: ['one.ts', 'two.ts'],
      tree,
    },
    repository,
    sourceCommit,
    spike,
  };
}

function toolingIdentity() {
  return {
    corpusGeneratorSha256: digest('f'),
    devLoopAdapterSha256: digest('0'),
    packedProductIdentitySchema: 'kovo-packed-product-identity/v1',
    packedProductPreparationSha256: digest('7'),
    packedProductVerifierSha256: digest('8'),
    productPolicySchema: DEV_GENERATION_PRODUCT_POLICY_SCHEMA,
    readyRouteValidatorSha256: digest('1'),
  };
}

function preparedFixture(baselineRoot, spikeRoot) {
  const baseline = sourceState('a'.repeat(40));
  const spike = sourceState('b'.repeat(40));
  const corpus = corpusIdentity();
  const products = {
    baseline: productCapability(baseline, 'prepared-baseline'),
    spike: productCapability(spike, 'prepared-spike'),
  };
  return {
    candidateBinding: {
      baseline: { commit: baseline.commit, root: baselineRoot },
      candidate: { commit: 'c'.repeat(40), patchId: 'd'.repeat(40), patchSha256: digest('e') },
      schema: 'kovo-dev-generation-candidate-binding/v3',
      spike: { commit: spike.commit, parent: baseline.commit, root: spikeRoot },
    },
    cleanup() {},
    corpus: { baseline: corpus, spike: corpus },
    frozenInstall: {
      baseline: products.baseline.identity.identity.consumer.frozenInstall,
      separatePerLane: true,
      spike: products.spike.identity.identity.consumer.frozenInstall,
    },
    manifestPaths: {
      baseline: products.baseline.manifestPath,
      spike: products.spike.manifestPath,
    },
    productBoundary: {
      complete: true,
      identities: {
        baseline: products.baseline.identity,
        spike: products.spike.identity,
      },
      policy: DEV_GENERATION_PRODUCT_POLICY,
      schema: DEV_GENERATION_PRODUCT_BOUNDARY_SCHEMA,
      separateConsumersAndDescriptors: true,
      separatePreparationRoots: true,
    },
    products,
    roots: { baseline: baselineRoot, spike: spikeRoot },
    source: {
      after: { baseline, spike },
      before: { baseline, spike },
      stable: true,
    },
    tooling: {
      baseline: {
        corpusGeneratorSha256: digest('f'),
        devLoopAdapterSha256: digest('0'),
        packedProductIdentitySchema: 'kovo-packed-product-identity/v1',
        packedProductPreparationSha256: digest('7'),
        packedProductVerifierSha256: digest('8'),
        productPolicySchema: DEV_GENERATION_PRODUCT_POLICY_SCHEMA,
        readyRouteValidatorSha256: digest('1'),
      },
      spike: {
        corpusGeneratorSha256: digest('f'),
        devLoopAdapterSha256: digest('0'),
        packedProductIdentitySchema: 'kovo-packed-product-identity/v1',
        packedProductPreparationSha256: digest('7'),
        packedProductVerifierSha256: digest('8'),
        productPolicySchema: DEV_GENERATION_PRODUCT_POLICY_SCHEMA,
        readyRouteValidatorSha256: digest('1'),
      },
    },
  };
}

function comparisonCells({
  baselineCausalLatency = 100,
  baselineSyntaxLatency = 100,
  spikeCausalLatency = 75,
  spikeSyntaxLatency = 100,
} = {}) {
  const corpus = corpusIdentity();
  const states = { baseline: sourceState('a'.repeat(40)), spike: sourceState('b'.repeat(40)) };
  const products = {
    baseline: productCapability(states.baseline, 'comparison-baseline'),
    spike: productCapability(states.spike, 'comparison-spike'),
  };
  return devGenerationSchedule({ editSamples: 30, readySamples: 15, warmups: 3 }).map(
    (scheduled) => {
      const { lane, occurrence, scheduleIndex } = scheduled;
      const state = states[lane];
      return scheduledCell(
        lane,
        occurrence,
        fakeAdapterReport({
          commit: state.commit,
          corpus,
          editSamples: scheduled.editSamples,
          latencies: {
            data: lane === 'baseline' ? baselineCausalLatency : spikeCausalLatency,
            entry: lane === 'baseline' ? baselineCausalLatency : spikeCausalLatency,
            leaf: lane === 'baseline' ? baselineCausalLatency : spikeCausalLatency,
            recovery: lane === 'baseline' ? baselineCausalLatency : spikeCausalLatency,
            syntaxError: lane === 'baseline' ? baselineSyntaxLatency : spikeSyntaxLatency,
          },
          locks: state.locks,
          port: 49_750 + scheduleIndex * 128,
          product: products[lane],
          readyLatency: 100,
          readySamples: scheduled.readySamples,
          rss: 1_000,
          warmups: scheduled.warmups,
        }),
        scheduleIndex,
        products[lane],
      );
    },
  );
}

function decisionPolicy() {
  return {
    bootstrapIterations: 500,
    editSamples: 30,
    readySamples: 15,
    seed: 1,
    warmups: 3,
  };
}

function scheduledCell(lane, occurrence, report, scheduleIndex = 0, product = null) {
  return {
    editSamples: report.integrity.iterations,
    lane,
    occurrence,
    port: Number(new URL(report.integrity.command.origin).port),
    productBoundary:
      product === null
        ? { complete: true, schema: DEV_GENERATION_PRODUCT_BOUNDARY_SCHEMA }
        : inspectDevGenerationProductBoundary(report, product),
    readySamples: report.integrity.readyIterations,
    report,
    scheduleIndex,
    warmups: report.integrity.warmups,
  };
}

function fakeAdapterReport({
  commit,
  corpus,
  editSamples,
  latency,
  latencies = {},
  locks,
  port,
  product,
  readyLatency = latency,
  readySamples,
  rss = 1_000,
  warmups = 0,
}) {
  const source = { commit, dirty: false, dirtyPaths: [], locks };
  const samples = Array.from({ length: editSamples }, (_, iteration) => ({
    ...Object.fromEntries(
      EDIT_CLASSES.flatMap((editClass) => [
        [`${editClass}Ms`, latencies[editClass] ?? latency],
        [`${editClass}PaintFenceMs`, 1],
        [`${editClass}ServerGenerationMs`, (latencies[editClass] ?? latency) / 2],
        [`${editClass}StateSurvived`, true],
        [`${editClass}WriteMs`, 1],
      ]),
    ),
    iteration,
    syntaxErrorDiagnosticSignal: 'framework-owned diagnostic',
  }));
  return {
    corpus: {
      devPortAllocationPosture: corpus.devPortAllocationPosture,
      editSavePosture: corpus.editSavePosture,
      manifestDigest: corpus.manifestDigest,
      manifestPath: product.manifestPath,
      modules: corpus.modules,
      routes: corpus.routes,
      shapeDigest: corpus.shapeDigest.slice('sha256:'.length),
      sourceDigest: corpus.sourceDigest,
    },
    editSession: {
      browserContextClosed: true,
      lifecycle: completeStop(port + readySamples),
      peakRssBytes: rss,
      readinessProbe: readyRouteProbe(),
      rssSamples: 2,
    },
    framework: 'kovo',
    integrity: {
      browser: {
        requestFailedCount: 0,
        responseCount: 2,
        unexpectedErrorCount: 0,
      },
      command: {
        argv: [
          'node',
          '<packed-kovo>/node_modules/@kovojs/cli/dist/bin.mjs',
          'dev',
          '--host',
          'localhost',
          '--port',
          String(port),
        ],
        cwd: '.',
        env: {},
        origin: `http://localhost:${String(port)}`,
        productArtifactDigest: product.identity.digest,
      },
      complete: true,
      editCounts: Object.fromEntries(EDIT_CLASSES.map((editClass) => [editClass, editSamples])),
      errors: [],
      handoffs: Array.from({ length: readySamples + 1 }, (_, index) =>
        completeHandoff(port + index, index, readySamples),
      ),
      iterations: editSamples,
      misses: 0,
      portAllocation: completePortAllocation(
        port,
        Array.from({ length: readySamples + 1 }, (_, index) => port + index),
      ),
      readyIterations: readySamples,
      productArtifact: { afterVerified: true, beforeVerified: true, required: true },
      source: { stable: true },
      warmups,
    },
    readySamples: Array.from({ length: readySamples }, (_, iteration) => ({
      browserContextClosed: true,
      durationMs: readyLatency,
      iteration,
      lifecycle: completeStop(port + iteration),
      peakRssBytes: rss,
      readinessProbe: readyRouteProbe(),
      rssSamples: 2,
      success: true,
    })),
    samples,
    schema: 'kovo-dev-loop-report/v1',
    productArtifact: product.identity,
    source,
    sourceAfter: source,
    verdict: { status: 'measured' },
  };
}

function readyRouteProbe() {
  return { attempts: 1, path: '/', status: 200, transientFailures: 0 };
}

function productCapability(source, label) {
  const externalRoot = realpathSync(temporaryDirectory(`kovo-dev-generation-product-${label}-`));
  const productRoot = realpathSync(temporaryDirectory(`kovo-dev-generation-consumer-${label}-`));
  const consumerRoot = path.join(productRoot, 'consumer');
  mkdirSync(consumerRoot);
  const descriptorPath = path.join(consumerRoot, '.kovo-perf-packed-product.json');
  writeFileSync(descriptorPath, '{}\n');
  const appRoot = path.join(externalRoot, 'kovo', 'n24');
  mkdirSync(appRoot, { recursive: true });
  const manifestPath = path.join(appRoot, 'manifest.json');
  writeFileSync(manifestPath, '{}\n');
  return {
    consumerRoot,
    descriptorPath,
    externalRoot,
    identity: packedProductIdentity(source, label),
    manifestPath,
    policy: DEV_GENERATION_PRODUCT_POLICY,
  };
}

function packedProductIdentity(source, label) {
  const hash = (value) =>
    `sha256:${createHash('sha256').update(`${label}:${value}`).digest('hex')}`;
  const loadedFiles = ['@kovojs/cli/dist/bin.mjs'];
  const identity = {
    artifacts: [
      {
        files: 2,
        manifestSha256: hash('manifest'),
        name: '@kovojs/cli',
        packageContentSha256: hash('content'),
        tarballBytes: 1_024,
        tarballFile: 'kovojs-cli-0.3.0.tgz',
        tarballSha256: hash('tarball'),
        unpackedBytes: 2_048,
        version: '0.3.0',
      },
    ],
    build: {
      commands: [],
      packages: ['@kovojs/cli'],
      rootFrozenInstall: { argv: ['pnpm', 'install', '--offline', '--frozen-lockfile'] },
    },
    consumer: {
      frozenInstall: { argv: ['pnpm', 'install', '--frozen-lockfile'], lockSha256: hash('lock') },
      lockResolution: { argv: ['pnpm', 'install'] },
      manifestSha256: hash('consumer-manifest'),
      packageCensusMatched: 1,
      packageFilesMatched: 2,
      packageManager: 'pnpm@10.12.1',
      pnpmVersion: '10.12.1',
      root: '<isolated-consumer>',
    },
    integrity: {
      artifactAuthenticated: true,
      consumerFrozen: true,
      firstInstallMatchesFrozen: true,
      installedBytesMatchTarballs: true,
      packedResolutionConfined: true,
      workspaceSourceLoaded: false,
    },
    pack: { commands: [] },
    primaryCli: {
      installedBin: 'node_modules/@kovojs/cli/dist/bin.mjs',
      installedBinSha256: hash('bin'),
      name: '@kovojs/cli',
      packageContentSha256: hash('content'),
      tarballSha256: hash('tarball'),
      version: '0.3.0',
    },
    resolutionProof: {
      confined: true,
      loadedFileCount: loadedFiles.length,
      loadedFiles,
      normalizedTraceSha256: `sha256:${createHash('sha256')
        .update(JSON.stringify(loadedFiles))
        .digest('hex')}`,
      schema: 'kovo-packed-cli-resolution-proof/v1',
      workspaceSourceLoaded: false,
    },
    schema: 'kovo-packed-product-identity/v1',
    source: { commit: source.commit, locks: source.locks },
    typescript: {
      bytes: 1_024,
      contentSha256: hash('typescript'),
      files: 2,
      name: 'typescript',
      version: '6.0.3',
    },
  };
  return {
    digest: `sha256:${createHash('sha256')
      .update(Buffer.from(canonicalJson(identity)))
      .digest('hex')}`,
    identity,
    schema: 'kovo-packed-product-identity/v1',
  };
}

function sourceState(commit) {
  return {
    commit,
    dirty: false,
    dirtyPaths: [],
    locks: {
      'benchmarks/harness/pnpm-lock.yaml': digest('3'),
      'benchmarks/nextjs/pnpm-lock.yaml': digest('2'),
      'pnpm-lock.yaml': digest('1'),
    },
    packageManager: 'pnpm@10.12.1',
    pnpmVersion: '10.12.1',
  };
}

function corpusIdentity() {
  return {
    devPortAllocationPosture: 'unique-exact-port-outside-host-ephemeral/v2',
    editClasses: EDIT_CLASSES,
    editSavePosture: 'posix-sibling-temp-write-rename/v1',
    manifestDigest: digest('4'),
    manifestPath: 'benchmarks/kovo/.corpora/kovo/n24/manifest.json',
    modules: 24,
    routes: 4,
    schema: 'kovo-dev-corpus/v1',
    shapeDigest: digest('5'),
    sourceDigest: digest('6'),
    stateSurface: 'local-counter',
  };
}

function completeHandoff(port, index, readySamples) {
  const target = index === readySamples ? 'edit-session' : `ready[${String(index)}]`;
  const from =
    index === 0
      ? null
      : index === readySamples
        ? `ready[${String(index - 1)}]`
        : `ready[${String(index - 1)}]`;
  return {
    attribution: {
      from,
      priorMarkerSha256: index === 0 ? null : digest('a'),
      to: target,
    },
    available: true,
    check: {
      addresses: [
        {
          address: '127.0.0.1',
          available: true,
          errorCode: null,
          family: 4,
          supported: true,
        },
        {
          address: '::1',
          available: true,
          errorCode: null,
          family: 6,
          supported: true,
        },
      ],
      checkedAt: '2026-08-13T00:00:00.000Z',
      durationMs: 1,
      probeError: null,
      sequence: 1,
    },
    complete: true,
    error: null,
    inspector: null,
    origin: `http://localhost:${String(port)}`,
    schema: 'kovo-dev-session-handoff/v2',
    socketEvidence: null,
  };
}

function completeStop(port) {
  return {
    complete: true,
    origin: `http://localhost:${String(port)}`,
    schema: 'kovo-dev-session-stop/v4',
    socketEvidence: null,
  };
}

function completePortAllocation(basePort, ports, inspectorPorts = []) {
  return {
    basePort,
    complete: true,
    errors: [],
    hostEphemeral: {
      complete: true,
      error: null,
      platform: 'linux',
      probe: {
        bytes: 12,
        contentBase64: 'NjAwMDAgNjU1MzUK',
        kind: 'procfs',
        locator: '/proc/sys/net/ipv4/ip_local_port_range',
        sha256: 'sha256:d57b94cd21854bf7ea2ebac4e57725b65b83a11ca7fab9ea7d1701cb6e73e5bf',
      },
      ranges: [{ label: 'default', maximum: 65_535, minimum: 60_000 }],
      schema: 'kovo-host-ephemeral-port-ranges/v1',
      scope: 'tcp-loopback-v4-v6/v1',
    },
    inspectorPorts,
    overlaps: [],
    ports,
    posture: 'unique-exact-port-outside-host-ephemeral/v2',
    schema: 'kovo-dev-port-allocation/v1',
  };
}

function comparableHostSample(label, ceiling) {
  return {
    at: '2026-08-13T00:00:00.000Z',
    ceiling,
    comparable: true,
    cpuCount: 10,
    label,
    loadAverage: [0.1, 0.1, 0.1],
    loadPerCpu: 0.01,
  };
}

function temporaryDirectory(prefix) {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}
