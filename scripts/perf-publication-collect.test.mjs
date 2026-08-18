import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  PERF_PUBLICATION_COLLECTION_SCHEMA,
  PERF_PUBLICATION_FAMILIES,
  PERF_PUBLICATION_FAMILY_NAMES,
  PERF_PUBLICATION_INPUT_SCHEMA,
  collectPerformancePublicationRuns,
  createPerformancePublicationManifest,
  loadPerformancePublicationCollections,
  performancePublicationManifestRawFileCount,
  performancePublicationCohortDigest,
  selectPerformancePublicationCohorts,
  selectPerformancePublicationProductionBytes,
  validateCollectedCandidateBytes,
  validateCollectedProductionBytesCandidateBytes,
} from './perf-publication-collect.mjs';
import {
  authenticateManifestFilesystemCensus,
  authenticatePerformancePublicationInput,
} from './perf-publication-gate.mjs';
import {
  PACKED_KOVO_PRODUCT_WORKLOAD_POLICY,
  fixturePackedKovoProductIdentity,
} from './fixtures/perf-packed-product-identity.mjs';
import { canonicalJson } from './lib/perf-host.mjs';

const REPOSITORY = 'kovojs/kovo';
const SOURCE = 'a'.repeat(40);
const PRODUCTION_BYTES_BUDGET_FAILURE_STEP = 'Evaluate against perf-budgets.json';
const PRODUCTION_BYTES_REQUIRED_SUCCESS_STEPS = [
  'Measure critical-path, navigation and bootstrap bytes',
  'Run actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
];
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('metrics-blind performance publication collection', () => {
  it('ignores metrics while immutable run chronology chooses five baselines and one holdout', () => {
    const candidates = selectionCandidates();
    candidates.reverse();
    const before = selectedIds(selectPerformancePublicationCohorts(candidates));

    for (const candidate of candidates) {
      candidate.report.analysis = {
        arbitrary: {
          kovo: { median: candidate.runId % 2 === 0 ? 1 : 999_999 },
          nextjs: { median: candidate.runId % 2 === 0 ? 999_999 : 1 },
        },
      };
      candidate.report.metrics = { invented: { value: -candidate.runId } };
      candidate.report.rawCells = [{ durationMs: Number.MAX_SAFE_INTEGER - candidate.runId }];
      candidate.report.budgets = { arbitrary: candidate.runId % 2 === 0 ? 0 : 999_999 };
      candidate.report.verdict = {
        failures: candidate.runId % 2 === 0 ? ['invented'] : [],
        status: candidate.runId % 2 === 0 ? 'blocked' : 'pass',
      };
    }
    const after = selectedIds(selectPerformancePublicationCohorts(candidates));

    expect(after).toEqual(before);
    for (const familyName of PERF_PUBLICATION_FAMILY_NAMES) {
      expect(after[familyName]).toEqual(
        candidates
          .filter((candidate) => candidate.family === familyName)
          .sort(chronology)
          .slice(0, 6)
          .map((candidate) => candidate.runId),
      );
    }
  });

  it('selects the earliest Production bytes sidecar without observing its metrics', () => {
    const candidates = [3, 1, 2].map((runId) => productionBytesSelectionCandidate(runId));
    const before = selectPerformancePublicationProductionBytes(candidates).runId;
    for (const candidate of candidates) {
      candidate.report.metrics = Object.fromEntries(
        Object.keys(candidate.report.metrics).map((metric) => [
          metric,
          { value: candidate.runId === 1 ? Number.MAX_SAFE_INTEGER : 0 },
        ]),
      );
      candidate.report.budgets = { maximum: candidate.runId === 1 ? 0 : Number.MAX_SAFE_INTEGER };
      candidate.report.verdict = { status: candidate.runId === 1 ? 'blocked' : 'pass' };
    }
    const after = selectPerformancePublicationProductionBytes(candidates).runId;

    expect(before).toBe(1);
    expect(after).toBe(before);
  });

  it('fails closed on multiple qualifying cohorts unless an exact cohort or unique host is selected', () => {
    const candidates = selectionCandidates();
    expect(() =>
      selectPerformancePublicationCohorts(candidates, {
        cohortSelections: new Map([
          ['browser', performancePublicationCohortDigest(candidates[0].report, 'browser')],
        ]),
      }),
    ).toThrow('selector is unnecessary');
    const second = Array.from({ length: 6 }, (_, index) =>
      selectionCandidate('browser', 50_000 + index, {
        hostDigest: digest('browser-second-host'),
      }),
    );
    const ambiguous = [...candidates, ...second];
    expect(() => selectPerformancePublicationCohorts(ambiguous)).toThrow(
      'browser has multiple qualifying cohorts',
    );

    const cohortDigest = performancePublicationCohortDigest(second[0].report, 'browser');
    const byCohort = selectPerformancePublicationCohorts(ambiguous, {
      cohortSelections: new Map([['browser', cohortDigest]]),
    });
    expect(byCohort.browser.map((candidate) => candidate.runId)).toEqual(
      second.map((candidate) => candidate.runId),
    );
    const byHost = selectPerformancePublicationCohorts(ambiguous, {
      cohortSelections: new Map([['browser', second[0].hostDigest]]),
    });
    expect(byHost.browser.map((candidate) => candidate.runId)).toEqual(
      second.map((candidate) => candidate.runId),
    );
  });

  it('collects raw gh-api bytes atomically without changing the measured checkout', async () => {
    const root = await temporaryRoot();
    const checkout = await realDirectory(path.join(root, 'checkout'));
    await writeFile(path.join(checkout, 'sentinel'), 'unchanged\n');
    const campaign = campaignFixture([{ family: 'browser', runId: 1001 }]);
    const out = path.join(root, 'collection');
    const before = await directorySnapshot(checkout);

    const result = await collectPerformancePublicationRuns({
      ...campaignBoundary(campaign),
      checkoutDirectory: checkout,
      operations: fixtureOperations(campaign, checkout),
      outDirectory: out,
      repository: REPOSITORY,
      runIds: [1001],
      sourceSha: SOURCE,
    });

    expect(await directorySnapshot(checkout)).toEqual(before);
    expect(result.ledger).toMatchObject({
      repository: REPOSITORY,
      schema: PERF_PUBLICATION_COLLECTION_SCHEMA,
      sourceCommit: SOURCE,
    });
    const entry = result.ledger.candidates[0];
    const source = campaign.byRun.get(1001);
    await expect(readFile(path.join(out, entry.descriptor.apiMetadata))).resolves.toEqual(
      source.artifactApiBytes,
    );
    await expect(readFile(path.join(out, entry.descriptor.runApiMetadata))).resolves.toEqual(
      source.runApiBytes,
    );
    await expect(readFile(path.join(out, entry.descriptor.jobsApiMetadata))).resolves.toEqual(
      source.jobsApiBytes,
    );
    await expect(readFile(path.join(out, entry.descriptor.archive))).resolves.toEqual(
      source.archiveBytes,
    );
    await expect(readFile(path.join(out, entry.descriptor.report))).resolves.toEqual(
      source.reportBytes,
    );
  });

  it('retains a qualifying Production bytes artifact even when the selected run has no family artifact', async () => {
    const root = await temporaryRoot();
    const checkout = await realDirectory(path.join(root, 'checkout'));
    const campaign = campaignFixture([{ family: 'browser', productionBytes: true, runId: 1001 }]);
    const fixture = campaign.byRun.get(1001);
    campaign.endpoints.set(
      `repos/${REPOSITORY}/actions/runs/1001/artifacts?per_page=100`,
      jsonBytes({
        artifacts: [{ id: fixture.productionBytes.artifact.id, name: 'kovo-perf-bytes' }],
        total_count: 1,
      }),
    );

    const result = await collectPerformancePublicationRuns({
      ...campaignBoundary(campaign),
      checkoutDirectory: checkout,
      operations: fixtureOperations(campaign, checkout),
      outDirectory: path.join(root, 'bytes-only'),
      repository: REPOSITORY,
      runIds: [1001],
      sourceSha: SOURCE,
    });

    expect(result.ledger.candidates).toEqual([]);
    expect(result.ledger.productionBytes).toHaveLength(1);
  });

  it('never publishes a partial collection after a later authenticated API call fails', async () => {
    const root = await temporaryRoot();
    const checkout = await realDirectory(path.join(root, 'checkout'));
    const campaign = campaignFixture([
      { family: 'browser', runId: 1001 },
      { family: 'server', runId: 1002 },
    ]);
    const operations = fixtureOperations(campaign, checkout);
    const fetchApi = operations.fetchApi.bind(operations);
    operations.fetchApi = async (endpoint, options) => {
      if (endpoint === `repos/${REPOSITORY}/actions/artifacts/21002`) {
        throw new Error('injected API failure');
      }
      return fetchApi(endpoint, options);
    };
    const out = path.join(root, 'partial-must-not-exist');

    await expect(
      collectPerformancePublicationRuns({
        ...campaignBoundary(campaign),
        checkoutDirectory: checkout,
        operations,
        outDirectory: out,
        repository: REPOSITORY,
        runIds: [1001, 1002],
        sourceSha: SOURCE,
      }),
    ).rejects.toThrow('injected API failure');
    await expect(lstat(out)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readdir(root)).filter((name) => name.includes('staging'))).toEqual([]);
  });

  it('rejects omitted campaign runs, candidates, raw listings, and altered run chronology', async () => {
    const root = await temporaryRoot();
    const checkout = await realDirectory(path.join(root, 'checkout'));
    const campaign = campaignFixture(
      [1001, 1002, 1003].map((runId) => ({
        family: 'browser',
        productionBytes: true,
        runId,
      })),
    );
    const collection = path.join(root, 'complete-campaign');
    await collectPerformancePublicationRuns({
      ...campaignBoundary(campaign),
      checkoutDirectory: checkout,
      operations: fixtureOperations(campaign, checkout),
      outDirectory: collection,
      repository: REPOSITORY,
      runIds: [1001, 1002, 1003],
      sourceSha: SOURCE,
    });
    const ledgerPath = path.join(collection, 'collection.json');
    const original = JSON.parse(await readFile(ledgerPath, 'utf8'));

    const omittedCandidate = structuredClone(original);
    omittedCandidate.productionBytes.shift();
    await writeFile(ledgerPath, `${JSON.stringify(omittedCandidate, null, 2)}\n`);
    await expect(loadOneCollection(checkout, collection)).rejects.toThrow(
      'omits or invents a campaign artifact-listing candidate',
    );

    const omittedRun = structuredClone(original);
    omittedRun.runIds.splice(1, 1);
    omittedRun.campaign.runs.splice(1, 1);
    omittedRun.candidates = omittedRun.candidates.filter(({ runId }) => runId !== 1002);
    omittedRun.productionBytes = omittedRun.productionBytes.filter(({ runId }) => runId !== 1002);
    await writeFile(ledgerPath, `${JSON.stringify(omittedRun, null, 2)}\n`);
    await expect(loadOneCollection(checkout, collection)).rejects.toThrow(
      /complete preregistered campaign boundary census|workflow-runs authority/u,
    );

    const alteredCreatedAt = structuredClone(original);
    alteredCreatedAt.campaign.runs[0].runCreatedAt = '2026-08-13T00:00:30.000Z';
    await writeFile(ledgerPath, `${JSON.stringify(alteredCreatedAt, null, 2)}\n`);
    await expect(loadOneCollection(checkout, collection)).rejects.toThrow(
      'created_at differs from raw run authority',
    );

    await writeFile(ledgerPath, `${JSON.stringify(original, null, 2)}\n`);
    const listingReference = original.campaign.runs[0].artifactsApiMetadata;
    await writeFile(path.join(collection, listingReference.path), '{}\n');
    await expect(loadOneCollection(checkout, collection)).rejects.toThrow(
      'content-addressed custody reference',
    );
  });

  it('rejects missing and ambiguous literal family artifacts before publishing', async () => {
    const root = await temporaryRoot();
    const checkout = await realDirectory(path.join(root, 'checkout'));
    const missing = campaignFixture([{ family: 'browser', runId: 1001 }]);
    missing.endpoints.set(
      `repos/${REPOSITORY}/actions/runs/1001/artifacts?per_page=100`,
      jsonBytes({ artifacts: [], total_count: 0 }),
    );
    await expect(
      collectPerformancePublicationRuns({
        ...campaignBoundary(missing),
        checkoutDirectory: checkout,
        operations: fixtureOperations(missing, checkout),
        outDirectory: path.join(root, 'missing'),
        repository: REPOSITORY,
        runIds: [1001],
        sourceSha: SOURCE,
      }),
    ).rejects.toThrow('no literal publication artifact');

    const ambiguous = campaignFixture([{ family: 'browser', runId: 1002 }]);
    ambiguous.endpoints.set(
      `repos/${REPOSITORY}/actions/runs/1002/artifacts?per_page=100`,
      jsonBytes({
        artifacts: [
          { id: 21002, name: 'kovo-perf-browser-matrix' },
          { id: 99999, name: 'kovo-perf-browser-matrix' },
        ],
        total_count: 2,
      }),
    );
    await expect(
      collectPerformancePublicationRuns({
        ...campaignBoundary(ambiguous),
        checkoutDirectory: checkout,
        operations: fixtureOperations(ambiguous, checkout),
        outDirectory: path.join(root, 'ambiguous'),
        repository: REPOSITORY,
        runIds: [1002],
        sourceSha: SOURCE,
      }),
    ).rejects.toThrow('ambiguous baseline-family artifacts');
  });

  it('rejects expired, wrong-run, wrong-source, wrong-workflow, and wrong-family evidence', () => {
    const cases = [
      ['expired', (fixture) => updateArtifact(fixture, { expired: true })],
      [
        'wrong run',
        (fixture) =>
          updateArtifact(fixture, {
            workflow_run: { ...fixture.artifact.workflow_run, id: 9999 },
          }),
      ],
      [
        'wrong source',
        (fixture) =>
          updateRun(fixture, {
            head_commit: { id: 'b'.repeat(40) },
            head_sha: 'b'.repeat(40),
          }),
      ],
      ['wrong workflow', (fixture) => updateRun(fixture, { path: '.github/workflows/ci.yml' })],
      [
        'wrong family',
        (fixture) => {
          fixture.report.workloadIdentity.identity.cells = ['server'];
          resealWorkloadAndArchive(fixture);
        },
      ],
      [
        'post-run source drift',
        (fixture) => {
          fixture.report.sourceAfter.commit = 'b'.repeat(40);
          resealWorkloadAndArchive(fixture);
        },
      ],
    ];
    for (const [label, mutate] of cases) {
      const fixture = campaignFixture([{ family: 'browser', runId: 1001 }]).byRun.get(1001);
      mutate(fixture);
      expect(() => validateFixture(fixture), label).toThrow();
    }
  });

  it('authenticates the exact Production bytes report and rejects every identity/census drift', () => {
    const make = () =>
      campaignFixture([{ family: 'browser', productionBytes: true, runId: 1001 }]).byRun.get(1001)
        .productionBytes;
    expect(() => validateProductionBytesFixture(make())).not.toThrow();
    const failedBudgetJob = make();
    markProductionBudgetFailure(failedBudgetJob);
    expect(() => validateProductionBytesFixture(failedBudgetJob)).not.toThrow();
    const cases = [
      ['artifact', (fixture) => updateArtifact(fixture, { name: 'kovo-perf-not-bytes' })],
      [
        'producer',
        (fixture) => {
          fixture.jobs.jobs.find(({ name }) => name === 'Production bytes').name = 'Other';
          fixture.jobsApiBytes = jsonBytes(fixture.jobs);
        },
      ],
      [
        'wrong failed producer step',
        (fixture) => {
          markProductionBudgetFailure(fixture);
          const producer = fixture.jobs.jobs.find(({ name }) => name === 'Production bytes');
          producer.steps.find(({ name }) => name === PRODUCTION_BYTES_BUDGET_FAILURE_STEP).name =
            'Other failed step';
          fixture.jobsApiBytes = jsonBytes(fixture.jobs);
        },
      ],
      [
        'skipped measurement on failed producer',
        (fixture) => {
          markProductionBudgetFailure(fixture);
          fixture.jobs.jobs
            .find(({ name }) => name === 'Production bytes')
            .steps.find(
              ({ name }) => name === PRODUCTION_BYTES_REQUIRED_SUCCESS_STEPS[0],
            ).conclusion = 'skipped';
          fixture.jobsApiBytes = jsonBytes(fixture.jobs);
        },
      ],
      [
        'failed upload on failed producer',
        (fixture) => {
          markProductionBudgetFailure(fixture);
          fixture.jobs.jobs
            .find(({ name }) => name === 'Production bytes')
            .steps.find(
              ({ name }) => name === PRODUCTION_BYTES_REQUIRED_SUCCESS_STEPS[1],
            ).conclusion = 'failure';
          fixture.jobsApiBytes = jsonBytes(fixture.jobs);
        },
      ],
      [
        'source',
        (fixture) => {
          fixture.report.source.commit = 'b'.repeat(40);
          resealProductionBytesFixture(fixture);
        },
      ],
      [
        'sourceAfter',
        (fixture) => {
          fixture.report.sourceAfter.commit = 'b'.repeat(40);
          resealProductionBytesFixture(fixture);
        },
      ],
      [
        'lock',
        (fixture) => {
          fixture.report.sourceAfter.locks['pnpm-lock.yaml'] = digest('wrong-lock');
          resealProductionBytesFixture(fixture);
        },
      ],
      [
        'execution',
        (fixture) => {
          fixture.report.execution.github.job = 'server-matrix';
          resealProductionBytesExecution(fixture);
        },
      ],
      [
        'integrity',
        (fixture) => {
          fixture.report.integrity.complete = false;
          resealProductionBytesFixture(fixture);
        },
      ],
      [
        'suite',
        (fixture) => {
          fixture.report.suite = 'ssr';
          resealProductionBytesFixture(fixture);
        },
      ],
      [
        'components',
        (fixture) => {
          fixture.report.options.componentCount = 23;
          resealProductionBytesFixture(fixture);
        },
      ],
      [
        'host-v2',
        (fixture) => {
          fixture.report.host.schema = 'kovo-performance-host/v1';
          resealProductionBytesFixture(fixture);
        },
      ],
      [
        'foreign workload adapter',
        (fixture) => {
          fixture.report.workloadIdentity.identity.adapters.foreign = 'v1';
          fixture.report.workloadIdentity.digest = digest(
            canonicalJson(fixture.report.workloadIdentity.identity),
          );
          resealProductionBytesFixture(fixture);
        },
      ],
      [
        'foreign workload wrapper',
        (fixture) => {
          fixture.report.workloadIdentity.foreign = true;
          resealProductionBytesFixture(fixture);
        },
      ],
      [
        'foreign workload policy',
        (fixture) => {
          fixture.report.workloadIdentity.identity.policies.foreign = true;
          fixture.report.workloadIdentity.digest = digest(
            canonicalJson(fixture.report.workloadIdentity.identity),
          );
          resealProductionBytesFixture(fixture);
        },
      ],
      [
        'metric census',
        (fixture) => {
          delete fixture.report.metrics['production.navigation.wireBytes'];
          fixture.report.metrics.invented = { value: 1 };
          resealProductionBytesFixture(fixture);
        },
      ],
    ];
    for (const [label, mutate] of cases) {
      const fixture = make();
      mutate(fixture);
      expect(() => validateProductionBytesFixture(fixture), label).toThrow();
    }
  });

  it('rejects duplicate Production bytes artifacts in one workflow run', async () => {
    const root = await temporaryRoot();
    const checkout = await realDirectory(path.join(root, 'checkout'));
    const campaign = campaignFixture([{ family: 'browser', productionBytes: true, runId: 1001 }]);
    const fixture = campaign.byRun.get(1001);
    campaign.endpoints.set(
      `repos/${REPOSITORY}/actions/runs/1001/artifacts?per_page=100`,
      jsonBytes({
        artifacts: [
          { id: fixture.artifact.id, name: fixture.artifact.name },
          { id: fixture.productionBytes.artifact.id, name: 'kovo-perf-bytes' },
          { id: 999_999, name: 'kovo-perf-bytes' },
        ],
        total_count: 3,
      }),
    );

    await expect(
      collectPerformancePublicationRuns({
        ...campaignBoundary(campaign),
        checkoutDirectory: checkout,
        operations: fixtureOperations(campaign, checkout),
        outDirectory: path.join(root, 'duplicate-bytes'),
        repository: REPOSITORY,
        runIds: [1001],
        sourceSha: SOURCE,
      }),
    ).rejects.toThrow('ambiguous Production bytes artifacts');
  });

  it('rejects unsafe and duplicate ZIP member paths through the shared bounded parser', () => {
    const fixture = campaignFixture([{ family: 'browser', runId: 1001 }]).byRun.get(1001);
    for (const archive of [
      storedZip([{ bytes: fixture.reportBytes, name: '../comparison.json' }]),
      storedZip([
        { bytes: fixture.reportBytes, name: 'comparison.json' },
        { bytes: fixture.reportBytes, name: 'comparison.json' },
      ]),
      storedZip([
        { bytes: fixture.reportBytes, name: 'comparison.json' },
        { bytes: Buffer.from('unexpected\n'), name: 'extra.txt' },
      ]),
    ]) {
      fixture.archiveBytes = archive;
      updateArtifact(fixture, {
        digest: digest(archive),
        size_in_bytes: archive.length,
      });
      expect(() => validateFixture(fixture)).toThrow(/ZIP|unsafe|duplicate/u);
    }
  });

  it('rejects traversal, symlink, hardlink, and in-checkout output aliases', async () => {
    const root = await temporaryRoot();
    const checkout = await realDirectory(path.join(root, 'checkout'));
    const collection = path.join(root, 'collection');
    const campaign = campaignFixture([{ family: 'browser', runId: 1001 }]);
    const result = await collectPerformancePublicationRuns({
      ...campaignBoundary(campaign),
      checkoutDirectory: checkout,
      operations: fixtureOperations(campaign, checkout),
      outDirectory: collection,
      repository: REPOSITORY,
      runIds: [1001],
      sourceSha: SOURCE,
    });
    await expect(
      collectPerformancePublicationRuns({
        ...campaignBoundary(campaign),
        checkoutDirectory: checkout,
        operations: fixtureOperations(campaign, checkout),
        outDirectory: path.join(checkout, 'forbidden'),
        repository: REPOSITORY,
        runIds: [1001],
        sourceSha: SOURCE,
      }),
    ).rejects.toThrow('outside the measured checkout');

    const ledgerPath = path.join(collection, 'collection.json');
    const original = JSON.parse(await readFile(ledgerPath, 'utf8'));
    const traversal = structuredClone(original);
    traversal.candidates[0].descriptor.report = '../comparison.json';
    await writeFile(ledgerPath, `${JSON.stringify(traversal, null, 2)}\n`);
    await expect(loadOneCollection(checkout, collection)).rejects.toThrow('safe relative path');

    await writeFile(ledgerPath, `${JSON.stringify(original, null, 2)}\n`);
    const descriptor = result.ledger.candidates[0].descriptor;
    const reportPath = path.join(collection, descriptor.report);
    const runPath = path.join(collection, descriptor.runApiMetadata);
    await unlink(reportPath);
    await symlink(runPath, reportPath);
    await expect(loadOneCollection(checkout, collection)).rejects.toThrow(/regular file|symlink/u);

    await unlink(reportPath);
    await link(runPath, reportPath);
    await expect(loadOneCollection(checkout, collection)).rejects.toThrow('hardlink alias');
  });

  it('requires checkout, collection roots, and manifest output to be pairwise disjoint', async () => {
    const root = await temporaryRoot();
    const ancestorCollection = await realDirectory(path.join(root, 'ancestor-collection'));
    const nestedCheckout = await realDirectory(path.join(ancestorCollection, 'checkout'));
    await expect(loadOneCollection(nestedCheckout, ancestorCollection)).rejects.toThrow(
      'outside and disjoint from the measured checkout',
    );

    const checkout = await realDirectory(path.join(root, 'checkout'));
    const outerCollection = await realDirectory(path.join(root, 'outer-collection'));
    const innerCollection = await realDirectory(path.join(outerCollection, 'inner-collection'));
    await expect(
      loadPerformancePublicationCollections({
        checkoutRoot: checkout,
        collectionDirectories: [outerCollection, innerCollection],
        repository: REPOSITORY,
        sourceSha: SOURCE,
      }),
    ).rejects.toThrow('exactly one complete campaign');

    const campaign = campaignFixture([{ family: 'browser', runId: 1001 }]);
    const collection = path.join(root, 'collection');
    await collectPerformancePublicationRuns({
      ...campaignBoundary(campaign),
      checkoutDirectory: checkout,
      operations: fixtureOperations(campaign, checkout),
      outDirectory: collection,
      repository: REPOSITORY,
      runIds: [1001],
      sourceSha: SOURCE,
    });
    const nestedOutput = path.join(collection, 'forbidden-publication');
    await expect(
      createPerformancePublicationManifest({
        checkoutDirectory: checkout,
        collectionDirectories: [collection],
        operations: fixtureOperations(campaign, checkout),
        outDirectory: nestedOutput,
        repository: REPOSITORY,
        sourceSha: SOURCE,
      }),
    ).rejects.toThrow('manifest output must be disjoint');
    await expect(lstat(nestedOutput)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('emits the exact self-contained seven-family five-plus-one manifest', async () => {
    const root = await temporaryRoot();
    const checkout = await realDirectory(path.join(root, 'checkout'));
    const assignments = [];
    let runId = 10_000;
    for (const family of PERF_PUBLICATION_FAMILY_NAMES) {
      for (let index = 0; index < 7; index += 1) {
        assignments.push({
          family,
          productionBytes: assignments.length < 2,
          runId: runId++,
        });
      }
    }
    const campaign = campaignFixture(assignments);
    const collection = path.join(root, 'collection');
    await collectPerformancePublicationRuns({
      ...campaignBoundary(campaign),
      checkoutDirectory: checkout,
      operations: fixtureOperations(campaign, checkout),
      outDirectory: collection,
      repository: REPOSITORY,
      runIds: assignments.map(({ runId: value }) => value),
      sourceSha: SOURCE,
    });
    const publication = path.join(root, 'publication');
    const result = await createPerformancePublicationManifest({
      checkoutDirectory: checkout,
      collectionDirectories: [collection],
      operations: fixtureOperations(campaign, checkout),
      outDirectory: publication,
      repository: REPOSITORY,
      sourceSha: SOURCE,
    });

    expect(result.manifest.schema).toBe(PERF_PUBLICATION_INPUT_SCHEMA);
    expect(Object.keys(result.manifest)).toEqual([
      'campaign',
      'families',
      'productionBytes',
      'repository',
      'schema',
    ]);
    expect(Object.keys(result.manifest.families)).toEqual(PERF_PUBLICATION_FAMILY_NAMES);
    for (const familyName of PERF_PUBLICATION_FAMILY_NAMES) {
      const family = result.manifest.families[familyName];
      expect(family.baseline).toHaveLength(5);
      expect(Object.keys(family.holdout).sort()).toEqual(
        ['apiMetadata', 'archive', 'jobsApiMetadata', 'report', 'runApiMetadata'].sort(),
      );
      for (const descriptor of [...family.baseline, family.holdout]) {
        for (const relative of Object.values(descriptor)) {
          expect(path.isAbsolute(relative)).toBe(false);
          await expect(readFile(path.join(publication, relative))).resolves.not.toHaveLength(0);
        }
      }
    }
    expect(Object.keys(result.manifest.productionBytes).sort()).toEqual(
      ['apiMetadata', 'archive', 'jobsApiMetadata', 'report', 'runApiMetadata'].sort(),
    );
    for (const relative of Object.values(result.manifest.productionBytes)) {
      await expect(readFile(path.join(publication, relative))).resolves.not.toHaveLength(0);
    }
    expect(result.manifest.campaign.familyCandidates).toHaveLength(49);
    expect(result.manifest.campaign.productionBytesCandidates).toHaveLength(2);
    for (const candidate of [
      ...result.manifest.campaign.familyCandidates,
      ...result.manifest.campaign.productionBytesCandidates,
    ]) {
      for (const relative of Object.values(candidate.descriptor)) {
        await expect(readFile(path.join(publication, relative))).resolves.not.toHaveLength(0);
      }
    }
    const publicationFiles = await regularFileCensus(publication);
    expect(publicationFiles.length - 1).toBe(
      performancePublicationManifestRawFileCount({
        candidateCount: {
          families: result.manifest.campaign.familyCandidates.length,
          productionBytes: result.manifest.campaign.productionBytesCandidates.length,
        },
        runCount: result.manifest.campaign.runs.length,
      }),
    );
    const manifestPath = path.join(publication, 'performance-publication-input.json');
    const manifestCensus = await authenticateManifestFilesystemCensus(result.manifest, {
      baseDirectory: publication,
      manifestPath,
    });
    expect(manifestCensus).toMatchObject({
      files: expect.any(Array),
      manifestRelativePath: 'performance-publication-input.json',
    });
    expect(manifestCensus.files).toHaveLength(publicationFiles.length);
    expect(manifestCensus.files).toContainEqual({
      contentDigest: digest(await readFile(manifestPath)),
      ctimeMs: expect.any(Number),
      dev: expect.any(Number),
      ino: expect.any(Number),
      mode: expect.any(Number),
      mtimeMs: expect.any(Number),
      nlink: 1,
      path: 'performance-publication-input.json',
      size: (await lstat(manifestPath)).size,
    });

    const extra = path.join(publication, 'unused.bin');
    await writeFile(extra, 'unused');
    await expectManifestCensusFailure(result.manifest, publication, /unreferenced/u);
    await unlink(extra);

    const nestedExtra = path.join(publication, 'unused', 'nested.bin');
    await mkdir(path.dirname(nestedExtra), { recursive: true });
    await writeFile(nestedExtra, 'unused');
    await expectManifestCensusFailure(result.manifest, publication, /unreferenced/u);
    await rm(path.join(publication, 'unused'), { recursive: true });

    const symlinkPath = path.join(publication, 'unused-link');
    await symlink('performance-publication-input.json', symlinkPath);
    await expectManifestCensusFailure(result.manifest, publication, /symlink/u);
    await unlink(symlinkPath);

    const fifoPath = path.join(publication, 'unused-fifo');
    execFileSync('mkfifo', [fifoPath]);
    await expectManifestCensusFailure(result.manifest, publication, /regular/u);
    await unlink(fifoPath);

    const socketPath = path.join(publication, 'unused.sock');
    const server = createServer();
    const originalWorkingDirectory = process.cwd();
    let serverListening = false;
    process.chdir(publication);
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen('unused.sock', resolve);
      });
      serverListening = true;
      await expectManifestCensusFailure(result.manifest, publication, /regular/u);
    } finally {
      if (serverListening) {
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
      process.chdir(originalWorkingDirectory);
      await rm(socketPath, { force: true });
    }

    const reportRelative = result.manifest.campaign.familyCandidates[0].descriptor.report;
    const reportPath = path.join(publication, reportRelative);
    const reportBytes = await readFile(reportPath);
    await unlink(reportPath);
    await expectManifestCensusFailure(result.manifest, publication, /missing/u);
    await writeFile(reportPath, reportBytes);

    const otherReport = path.join(
      publication,
      result.manifest.campaign.familyCandidates[1].descriptor.report,
    );
    await unlink(reportPath);
    await link(otherReport, reportPath);
    await expectManifestCensusFailure(result.manifest, publication, /hardlink|unique regular/u);
    await unlink(reportPath);
    await writeFile(reportPath, reportBytes);

    await unlink(reportPath);
    await mkdir(reportPath);
    await expectManifestCensusFailure(result.manifest, publication, /non-directory|directory/u);
    await rm(reportPath, { recursive: true });
    await writeFile(reportPath, reportBytes);

    const traversal = structuredClone(result.manifest);
    traversal.campaign.familyCandidates[0].descriptor.report = '../outside.json';
    await expectManifestCensusFailure(
      traversal,
      publication,
      /canonical safe relative path|malformed/u,
    );

    let networkCalls = 0;
    const gateOperations = performanceGateFixtureOperations(campaign, () => {
      networkCalls += 1;
    });
    await writeFile(extra, 'present-before-authentication');
    await expect(
      authenticatePerformancePublicationInput(result.manifest, {
        ...gateOperations,
        baseDirectory: publication,
        manifestPath,
      }),
    ).rejects.toThrow(/unreferenced/u);
    expect(networkCalls).toBe(0);
    await unlink(extra);

    let injected = false;
    await expect(
      authenticatePerformancePublicationInput(result.manifest, {
        ...gateOperations,
        baseDirectory: publication,
        async descriptorReadHook({ descriptorKey }) {
          if (descriptorKey !== 'manifest' || injected) return;
          injected = true;
          await writeFile(extra, 'added-after-opening-manifest');
        },
        manifestPath,
      }),
    ).rejects.toThrow(/unreferenced/u);
    expect(injected).toBe(true);
    expect(networkCalls).toBeGreaterThan(0);
    await unlink(extra);

    await expect(
      authenticatePerformancePublicationInput(result.manifest, {
        ...gateOperations,
        baseDirectory: publication,
        manifestPath,
      }),
    ).resolves.toMatchObject({ repository: REPOSITORY });

    const firstSelectedReport = path.join(
      publication,
      result.manifest.families.browser.baseline[0].report,
    );
    const firstSelectedReportBytes = await readFile(firstSelectedReport);
    const firstSelectedReportOpeningInode = (await lstat(firstSelectedReport)).ino;
    const secondSelectedApi = result.manifest.families.browser.baseline[1].apiMetadata;
    let replacedAfterRead = false;
    await expect(
      authenticatePerformancePublicationInput(result.manifest, {
        ...gateOperations,
        baseDirectory: publication,
        async descriptorReadHook({ relativePath }) {
          if (replacedAfterRead || relativePath !== secondSelectedApi) return;
          replacedAfterRead = true;
          const replacement = `${firstSelectedReport}.replacement`;
          await writeFile(replacement, firstSelectedReportBytes);
          await unlink(firstSelectedReport);
          await rename(replacement, firstSelectedReport);
        },
        manifestPath,
      }),
    ).rejects.toThrow(/opening and closing census/u);
    expect(replacedAfterRead).toBe(true);
    expect((await lstat(firstSelectedReport)).ino).not.toBe(firstSelectedReportOpeningInode);
    await unlink(firstSelectedReport);
    await writeFile(firstSelectedReport, firstSelectedReportBytes);

    const manifestBytes = await readFile(manifestPath);
    const manifestOpeningInode = (await lstat(manifestPath)).ino;
    let replacedManifest = false;
    await expect(
      authenticatePerformancePublicationInput(result.manifest, {
        ...gateOperations,
        baseDirectory: publication,
        async descriptorReadHook({ relativePath }) {
          if (
            replacedManifest ||
            relativePath !== result.manifest.families.browser.baseline[0].apiMetadata
          ) {
            return;
          }
          replacedManifest = true;
          const replacement = `${manifestPath}.replacement`;
          await writeFile(replacement, manifestBytes);
          await unlink(manifestPath);
          await rename(replacement, manifestPath);
        },
        manifestPath,
      }),
    ).rejects.toThrow(/opening and closing census/u);
    expect(replacedManifest).toBe(true);
    expect((await lstat(manifestPath)).ino).not.toBe(manifestOpeningInode);
    await unlink(manifestPath);
    await writeFile(manifestPath, manifestBytes);

    const sameLengthTamper = Buffer.from(firstSelectedReportBytes);
    sameLengthTamper[0] = sameLengthTamper[0] === 0x7b ? 0x5b : 0x7b;
    const originalSelectedFacts = await lstat(firstSelectedReport);
    let rewroteInPlace = false;
    await expect(
      authenticatePerformancePublicationInput(result.manifest, {
        ...gateOperations,
        baseDirectory: publication,
        async descriptorReadHook({ relativePath }) {
          if (rewroteInPlace || relativePath !== secondSelectedApi) return;
          rewroteInPlace = true;
          await writeFile(firstSelectedReport, sameLengthTamper);
          await writeFile(firstSelectedReport, firstSelectedReportBytes);
          await utimes(
            firstSelectedReport,
            originalSelectedFacts.atime,
            originalSelectedFacts.mtime,
          );
        },
        manifestPath,
      }),
    ).rejects.toThrow(/opening and closing census/u);
    expect(rewroteInPlace).toBe(true);
    expect(await readFile(firstSelectedReport)).toEqual(firstSelectedReportBytes);
    const restoredSelectedFacts = await lstat(firstSelectedReport);
    expect(restoredSelectedFacts.ino).toBe(originalSelectedFacts.ino);
    expect(restoredSelectedFacts.ctimeMs).not.toBe(originalSelectedFacts.ctimeMs);

    let rewroteBeforeDescriptorAuthentication = false;
    await expect(
      authenticatePerformancePublicationInput(result.manifest, {
        ...gateOperations,
        baseDirectory: publication,
        async descriptorReadHook({ descriptorKey }) {
          if (rewroteBeforeDescriptorAuthentication || descriptorKey !== 'manifest') return;
          rewroteBeforeDescriptorAuthentication = true;
          await writeFile(firstSelectedReport, sameLengthTamper);
        },
        manifestPath,
      }),
    ).rejects.toThrow(/opening custody census/u);
    expect(rewroteBeforeDescriptorAuthentication).toBe(true);
    await writeFile(firstSelectedReport, firstSelectedReportBytes);

    const latestBytesCandidate = result.manifest.campaign.productionBytesCandidates.at(-1);
    const latestReport = path.join(publication, latestBytesCandidate.descriptor.report);
    const latestReportBytes = await readFile(latestReport);
    const latestReportOpeningInode = (await lstat(latestReport)).ino;
    let replacedLatestRead = false;
    await expect(
      authenticatePerformancePublicationInput(result.manifest, {
        ...gateOperations,
        baseDirectory: publication,
        async fetchArtifactApi(options) {
          const response = await gateOperations.fetchArtifactApi(options);
          if (!replacedLatestRead && options.artifactId === latestBytesCandidate.artifactId) {
            replacedLatestRead = true;
            const replacement = `${latestReport}.replacement`;
            await writeFile(replacement, latestReportBytes);
            await unlink(latestReport);
            await rename(replacement, latestReport);
          }
          return response;
        },
        manifestPath,
      }),
    ).rejects.toThrow(/opening and closing census/u);
    expect(replacedLatestRead).toBe(true);
    expect((await lstat(latestReport)).ino).not.toBe(latestReportOpeningInode);
    await unlink(latestReport);
    await writeFile(latestReport, latestReportBytes);

    let firstClosingRelativePath;
    let firstClosingBytes;
    let rewroteAfterClosingHash = false;
    await expect(
      authenticatePerformancePublicationInput(result.manifest, {
        ...gateOperations,
        baseDirectory: publication,
        async filesystemCensusHook({ phase, relativePath, stage }) {
          if (phase !== 'closing' || stage !== 'hashed') return;
          if (firstClosingRelativePath === undefined) {
            firstClosingRelativePath = relativePath;
            firstClosingBytes = await readFile(path.join(publication, relativePath));
            return;
          }
          if (rewroteAfterClosingHash) return;
          rewroteAfterClosingHash = true;
          const tampered = Buffer.from(firstClosingBytes);
          tampered[0] ^= 0x01;
          await writeFile(path.join(publication, firstClosingRelativePath), tampered);
        },
        manifestPath,
      }),
    ).rejects.toThrow(/hashed custody census/u);
    expect(rewroteAfterClosingHash).toBe(true);
    await writeFile(path.join(publication, firstClosingRelativePath), firstClosingBytes);

    let deletedAfterRead = false;
    await expect(
      authenticatePerformancePublicationInput(result.manifest, {
        ...gateOperations,
        baseDirectory: publication,
        async descriptorReadHook({ relativePath }) {
          if (deletedAfterRead || relativePath !== secondSelectedApi) return;
          deletedAfterRead = true;
          await unlink(firstSelectedReport);
        },
        manifestPath,
      }),
    ).rejects.toThrow(/ENOENT|missing/u);
    expect(deletedAfterRead).toBe(true);
    await writeFile(firstSelectedReport, firstSelectedReportBytes);
  });
});

async function expectManifestCensusFailure(manifest, directory, expectation) {
  await expect(
    authenticateManifestFilesystemCensus(manifest, {
      baseDirectory: directory,
      manifestPath: path.join(directory, 'performance-publication-input.json'),
    }),
  ).rejects.toThrow(expectation);
}

async function regularFileCensus(directory, relative = '') {
  const result = [];
  for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
    const child = relative === '' ? entry.name : path.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...(await regularFileCensus(directory, child)));
    else if (entry.isFile()) result.push(child);
  }
  return result;
}

function performanceGateFixtureOperations(campaign, onNetwork) {
  const workflowBytes = readFileSync(path.resolve('.github/workflows/perf-realistic.yml'));
  const workflowBlobSha = createHash('sha1')
    .update(`blob ${String(workflowBytes.length)}\0`)
    .update(workflowBytes)
    .digest('hex');
  const workflowApiBytes = jsonBytes({
    content: workflowBytes.toString('base64'),
    download_url: `https://raw.githubusercontent.com/${REPOSITORY}/${SOURCE}/.github/workflows/perf-realistic.yml`,
    encoding: 'base64',
    git_url: `https://api.github.com/repos/${REPOSITORY}/git/blobs/${workflowBlobSha}`,
    html_url: `https://github.com/${REPOSITORY}/blob/${SOURCE}/.github/workflows/perf-realistic.yml`,
    name: 'perf-realistic.yml',
    path: '.github/workflows/perf-realistic.yml',
    sha: workflowBlobSha,
    size: workflowBytes.length,
    type: 'file',
    url: `https://api.github.com/repos/${REPOSITORY}/contents/.github/workflows/perf-realistic.yml?ref=${SOURCE}`,
  });
  const tracked = (value) => {
    onNetwork();
    return Buffer.from(value);
  };
  const workflowRuns = [...campaign.byRun.values()].map((fixture) => fixture.run);
  const budgets = {
    metrics: Object.fromEntries(
      [
        'production.criticalPath.wireBytes',
        'production.document.wireBytes',
        'production.inlineBootstrap.gzipBytes',
        'production.inlineBootstrap.identityBytes',
        'production.navigation.wireBytes',
      ].map((metricId) => [metricId, { loadSensitive: false, max: 1_000_000, unit: 'bytes' }]),
    ),
    schema: 'kovo-perf-budgets/v1',
  };
  const budgetBytes = jsonBytes(budgets);
  return {
    fetchArtifactApi: async ({ artifactId }) =>
      tracked(
        campaign.endpoints.get(`repos/${REPOSITORY}/actions/artifacts/${String(artifactId)}`),
      ),
    fetchCampaignWorkflowRunsApi: async () =>
      tracked(jsonBytes({ total_count: workflowRuns.length, workflow_runs: workflowRuns })),
    fetchWorkflowArtifactsApi: async ({ workflowRunId }) =>
      tracked(
        campaign.endpoints.get(
          `repos/${REPOSITORY}/actions/runs/${String(workflowRunId)}/artifacts?per_page=100`,
        ),
      ),
    fetchWorkflowFileApi: async () => tracked(workflowApiBytes),
    fetchWorkflowJobsApi: async ({ workflowRunId }) =>
      tracked(
        campaign.endpoints.get(
          `repos/${REPOSITORY}/actions/runs/${String(workflowRunId)}/jobs?filter=all&per_page=100`,
        ),
      ),
    fetchWorkflowRunApi: async ({ workflowRunId }) =>
      tracked(campaign.endpoints.get(`repos/${REPOSITORY}/actions/runs/${String(workflowRunId)}`)),
    loadPerformanceBudgets: async () => ({
      budgetBytes,
      budgetIdentity: {
        byteLength: budgetBytes.length,
        contentDigest: digest(budgetBytes),
        path: 'perf-budgets.json',
        schema: budgets.schema,
        sourceCommit: SOURCE,
      },
      budgets,
    }),
    loadTrustedWorkflow: async () => ({ bytes: workflowBytes, headSha: SOURCE }),
    now: '2026-08-14T00:00:00.000Z',
  };
}

function selectionCandidates() {
  let runId = 1_000;
  return PERF_PUBLICATION_FAMILY_NAMES.flatMap((familyName) =>
    Array.from({ length: 6 }, () => selectionCandidate(familyName, runId++)),
  );
}

function selectionCandidate(familyName, runId, { hostDigest = digest(`${familyName}:host`) } = {}) {
  const policy = PERF_PUBLICATION_FAMILIES[familyName];
  const locks = lockIdentity();
  const product = policy.packedProduct
    ? fixturePackedKovoProductIdentity({ locks, seed: 'shared-product', sourceCommit: SOURCE })
    : null;
  const workload = {
    complete: true,
    digest: digest(`${familyName}:workload`),
    identity: {
      cells: [policy.cell],
      ...(policy.packedProduct
        ? { productArtifactPolicy: PACKED_KOVO_PRODUCT_WORKLOAD_POLICY }
        : {}),
    },
    schema: 'kovo-performance-workload-identity/v1',
  };
  const report = {
    analysis: { arbitrary: { kovo: { median: runId }, nextjs: { median: runId + 1 } } },
    execution: { digest: digest(`execution:${String(runId)}`) },
    host: { digest: hostDigest },
    productArtifact: product,
    source: { commit: SOURCE, locks },
    workloadIdentity: workload,
  };
  const candidate = {
    artifactId: 100_000 + runId,
    executionDigest: report.execution.digest,
    family: familyName,
    hostDigest,
    report,
    runCreatedAt: timestamp(runId),
    runId,
  };
  candidate.cohortDigest = performancePublicationCohortDigest(report, familyName);
  return candidate;
}

function productionBytesSelectionCandidate(runId) {
  return {
    artifactId: 200_000 + runId,
    executionDigest: digest(`bytes-execution:${String(runId)}`),
    report: {
      execution: { digest: digest(`bytes-execution:${String(runId)}`) },
      metrics: Object.fromEntries(
        [
          'production.criticalPath.wireBytes',
          'production.document.wireBytes',
          'production.inlineBootstrap.gzipBytes',
          'production.inlineBootstrap.identityBytes',
          'production.navigation.wireBytes',
        ].map((metric) => [metric, { value: runId }]),
      ),
    },
    runCreatedAt: timestamp(runId),
    runId,
  };
}

function selectedIds(selected) {
  return Object.fromEntries(
    PERF_PUBLICATION_FAMILY_NAMES.map((familyName) => [
      familyName,
      selected[familyName].map((candidate) => candidate.runId),
    ]),
  );
}

function chronology(left, right) {
  const delta = Date.parse(left.runCreatedAt) - Date.parse(right.runCreatedAt);
  return delta === 0 ? left.runId - right.runId : delta;
}

function campaignFixture(assignments) {
  const endpoints = new Map();
  const byRun = new Map();
  const locks = lockIdentity();
  const productArtifact = fixturePackedKovoProductIdentity({
    locks,
    seed: 'campaign-product',
    sourceCommit: SOURCE,
  });
  for (const [index, assignment] of assignments.entries()) {
    const fixture = reportFixture({
      artifactId: 20_000 + assignment.runId,
      event: assignment.productionBytes === true ? 'pull_request' : 'workflow_dispatch',
      familyName: assignment.family,
      index,
      locks,
      productArtifact,
      runId: assignment.runId,
    });
    let bytesFixture = null;
    if (assignment.productionBytes === true) {
      bytesFixture = productionBytesReportFixture({
        artifactId: 120_000 + assignment.runId,
        familyFixture: fixture,
        index,
        locks,
      });
      fixture.jobs.jobs.push(bytesFixture.jobs.jobs[0]);
      fixture.jobs.total_count = fixture.jobs.jobs.length;
      fixture.jobsApiBytes = jsonBytes(fixture.jobs);
      bytesFixture.jobs = fixture.jobs;
      bytesFixture.jobsApiBytes = fixture.jobsApiBytes;
    }
    fixture.productionBytes = bytesFixture;
    byRun.set(assignment.runId, fixture);
    const runPath = `repos/${REPOSITORY}/actions/runs/${String(assignment.runId)}`;
    const artifactPath = `repos/${REPOSITORY}/actions/artifacts/${String(fixture.artifact.id)}`;
    endpoints.set(runPath, fixture.runApiBytes);
    endpoints.set(`${runPath}/jobs?filter=all&per_page=100`, fixture.jobsApiBytes);
    endpoints.set(
      `${runPath}/artifacts?per_page=100`,
      jsonBytes({
        artifacts: [
          { id: fixture.artifact.id, name: fixture.artifact.name },
          ...(bytesFixture === null
            ? []
            : [{ id: bytesFixture.artifact.id, name: bytesFixture.artifact.name }]),
        ],
        total_count: bytesFixture === null ? 1 : 2,
      }),
    );
    endpoints.set(artifactPath, fixture.artifactApiBytes);
    endpoints.set(`${artifactPath}/zip`, fixture.archiveBytes);
    if (bytesFixture !== null) {
      const bytesArtifactPath = `repos/${REPOSITORY}/actions/artifacts/${String(bytesFixture.artifact.id)}`;
      endpoints.set(bytesArtifactPath, bytesFixture.artifactApiBytes);
      endpoints.set(`${bytesArtifactPath}/zip`, bytesFixture.archiveBytes);
    }
  }
  return { byRun, endpoints };
}

function reportFixture({
  artifactId,
  event = 'workflow_dispatch',
  familyName,
  index,
  locks,
  productArtifact,
  runId,
}) {
  const policy = PERF_PUBLICATION_FAMILIES[familyName];
  const repositoryId = 777;
  const runCreatedAt = new Date(Date.UTC(2026, 7, 13, 0, index, 0)).toISOString();
  const jobStartedAt = new Date(Date.parse(runCreatedAt) + 1_000).toISOString();
  const jobCompletedAt = new Date(Date.parse(runCreatedAt) + 20_000).toISOString();
  const artifactCreatedAt = new Date(Date.parse(runCreatedAt) + 10_000).toISOString();
  const artifactUpdatedAt = new Date(Date.parse(runCreatedAt) + 15_000).toISOString();
  const runPath = `repos/${REPOSITORY}/actions/runs/${String(runId)}`;
  const runApiUrl = `https://api.github.com/${runPath}`;
  const runUrl = `https://github.com/${REPOSITORY}/actions/runs/${String(runId)}`;
  const run = {
    artifacts_url: `${runApiUrl}/artifacts`,
    conclusion: 'failure',
    created_at: runCreatedAt,
    event,
    head_branch: 'agent/perf-baselines',
    head_commit: { id: SOURCE },
    head_repository: { full_name: REPOSITORY, id: repositoryId },
    head_sha: SOURCE,
    html_url: runUrl,
    id: runId,
    jobs_url: `${runApiUrl}/jobs`,
    name: 'Perf Realistic Tier',
    path: '.github/workflows/perf-realistic.yml',
    ...(event === 'pull_request' ? { pull_requests: [{ number: 7 }] } : {}),
    repository: { full_name: REPOSITORY, id: repositoryId },
    run_attempt: 1,
    status: 'completed',
    url: runApiUrl,
  };
  const jobId = 30_000 + runId;
  const jobs = {
    jobs: [
      {
        completed_at: jobCompletedAt,
        conclusion: 'success',
        head_sha: SOURCE,
        id: jobId,
        name: policy.workflowJobName,
        run_attempt: 1,
        run_id: runId,
        started_at: jobStartedAt,
        status: 'completed',
        url: `https://api.github.com/repos/${REPOSITORY}/actions/jobs/${String(jobId)}`,
      },
    ],
    total_count: 1,
  };
  const hostFacts = {
    arch: 'x64',
    browsers: familyName === 'browser' ? ['Chrome 140.0.0'] : [],
    cpu: { count: 4, model: 'Fixture CPU' },
    memoryCapacityClassBytes: 16 * 1024 ** 3,
    node: 'v24.19.0',
    platform: 'linux',
    release: '6.11.0',
    runnerImage: 'ubuntu24@fixture',
  };
  const host = {
    ...hostFacts,
    digest: digest(canonicalJson(hostFacts)),
    schema: 'kovo-performance-host/v2',
    totalMemoryBytes: 16 * 1024 ** 3,
  };
  const workloadFacts = {
    adapters: {},
    cells: [policy.cell],
    corpus: {},
    lanes: ['fixture'],
    ...(policy.packedProduct ? { productArtifactPolicy: PACKED_KOVO_PRODUCT_WORKLOAD_POLICY } : {}),
    policies: policy.corpusSize === null ? {} : { corpusSize: policy.corpusSize },
  };
  const workloadIdentity = {
    complete: true,
    digest: digest(canonicalJson(workloadFacts)),
    identity: workloadFacts,
    schema: 'kovo-performance-workload-identity/v1',
  };
  const github = {
    eventSha: SOURCE,
    job: policy.workflowJobKey,
    repository: REPOSITORY,
    runAttempt: '1',
    runId: String(runId),
    runUrl,
    serverUrl: 'https://github.com',
    sha: SOURCE,
    workflowRef:
      event === 'pull_request'
        ? `${REPOSITORY}/.github/workflows/perf-realistic.yml@refs/pull/7/merge`
        : `${REPOSITORY}/.github/workflows/perf-realistic.yml@refs/heads/agent/perf-baselines`,
    workflowSha: SOURCE,
  };
  const executionFacts = {
    complete: true,
    github,
    provider: 'github-actions',
    startedAt: jobStartedAt,
  };
  const execution = {
    ...executionFacts,
    digest: digest(canonicalJson(executionFacts)),
    schema: 'kovo-performance-execution/v1',
  };
  const source = { commit: SOURCE, dirty: false, dirtyPaths: [], locks };
  const report = {
    ...(policy.reportSchema === 'kovo-perf-report/v1'
      ? { metrics: { fixture: { value: index } }, suite: 'check-scaling' }
      : { analysis: { fixture: { kovo: { median: index }, nextjs: { median: index + 1 } } } }),
    execution,
    generatedAt: jobCompletedAt,
    host,
    hostSamples: [],
    integrity: {
      ...(policy.reportSchema === 'kovo-perf-report/v1'
        ? { complete: true }
        : { comparatorMatched: true }),
      executionAuthenticated: true,
      publishable: true,
      serialized: true,
      sourceStable: true,
      workloadAuthenticated: true,
    },
    ...(policy.reportSchema === 'kovo-perf-report/v1'
      ? {}
      : { productArtifact: policy.packedProduct ? productArtifact : null }),
    schema: policy.reportSchema,
    source,
    sourceAfter: structuredClone(source),
    verdict: { reasons: [], status: 'measured' },
    workloadIdentity,
  };
  const reportBytes = jsonBytes(report);
  const archiveBytes = storedZip([{ bytes: reportBytes, name: policy.reportMember }]);
  const artifactApiUrl = `https://api.github.com/repos/${REPOSITORY}/actions/artifacts/${String(artifactId)}`;
  const artifact = {
    archive_download_url: `${artifactApiUrl}/zip`,
    created_at: artifactCreatedAt,
    digest: digest(archiveBytes),
    expired: false,
    expires_at: '2099-11-11T00:00:00Z',
    id: artifactId,
    name: policy.artifactName,
    size_in_bytes: archiveBytes.length,
    updated_at: artifactUpdatedAt,
    url: artifactApiUrl,
    workflow_run: {
      head_branch: run.head_branch,
      head_repository_id: repositoryId,
      head_sha: SOURCE,
      id: runId,
      repository_id: repositoryId,
    },
  };
  return {
    archiveBytes,
    artifact,
    artifactApiBytes: jsonBytes(artifact),
    familyName,
    jobs,
    jobsApiBytes: jsonBytes(jobs),
    report,
    reportBytes,
    run,
    runApiBytes: jsonBytes(run),
  };
}

function productionBytesReportFixture({ artifactId, familyFixture, index, locks }) {
  const { run } = familyFixture;
  const runId = run.id;
  const runUrl = run.html_url;
  const jobStartedAt = new Date(Date.parse(run.created_at) + 2_000).toISOString();
  const jobCompletedAt = new Date(Date.parse(run.created_at) + 18_000).toISOString();
  const github = {
    eventSha: SOURCE,
    job: 'bytes',
    repository: REPOSITORY,
    runAttempt: '1',
    runId: String(runId),
    runUrl,
    serverUrl: 'https://github.com',
    sha: SOURCE,
    workflowRef: `${REPOSITORY}/.github/workflows/perf-realistic.yml@refs/pull/7/merge`,
    workflowSha: SOURCE,
  };
  const executionFacts = {
    complete: true,
    github,
    provider: 'github-actions',
    startedAt: jobStartedAt,
  };
  const source = { commit: SOURCE, dirty: false, dirtyPaths: [], locks };
  const workloadFacts = {
    adapters: { perfGate: 'kovo-perf-report/v1', workload: 'kovo-realistic-workload/v1' },
    cells: ['bytes'],
    policies: { componentCount: 24 },
  };
  const report = {
    execution: {
      ...executionFacts,
      digest: digest(canonicalJson(executionFacts)),
      schema: 'kovo-performance-execution/v1',
    },
    generatedAt: jobCompletedAt,
    host: familyFixture.report.host,
    integrity: {
      complete: true,
      executionAuthenticated: true,
      publishable: true,
      serialized: true,
      sourceStable: true,
      workloadAuthenticated: true,
    },
    metrics: Object.fromEntries(
      [
        'production.criticalPath.wireBytes',
        'production.document.wireBytes',
        'production.inlineBootstrap.gzipBytes',
        'production.inlineBootstrap.identityBytes',
        'production.navigation.wireBytes',
      ].map((metric, metricIndex) => [metric, { value: 100 + index + metricIndex }]),
    ),
    options: { componentCount: 24 },
    schema: 'kovo-perf-report/v1',
    source,
    sourceAfter: structuredClone(source),
    suite: 'bytes',
    verdict: { reasons: [], status: 'measured' },
    workloadIdentity: {
      complete: true,
      digest: digest(canonicalJson(workloadFacts)),
      identity: workloadFacts,
      schema: 'kovo-performance-workload-identity/v1',
    },
  };
  const reportBytes = jsonBytes(report);
  const archiveBytes = storedZip([{ bytes: reportBytes, name: 'bytes.json' }]);
  const apiUrl = `https://api.github.com/repos/${REPOSITORY}/actions/artifacts/${String(artifactId)}`;
  const artifact = {
    archive_download_url: `${apiUrl}/zip`,
    created_at: new Date(Date.parse(run.created_at) + 10_000).toISOString(),
    digest: digest(archiveBytes),
    expired: false,
    expires_at: '2099-11-11T00:00:00Z',
    id: artifactId,
    name: 'kovo-perf-bytes',
    size_in_bytes: archiveBytes.length,
    updated_at: new Date(Date.parse(run.created_at) + 15_000).toISOString(),
    url: apiUrl,
    workflow_run: {
      head_branch: run.head_branch,
      head_repository_id: run.head_repository.id,
      head_sha: SOURCE,
      id: runId,
      repository_id: run.repository.id,
    },
  };
  const jobId = 130_000 + runId;
  const jobs = {
    jobs: [
      {
        completed_at: jobCompletedAt,
        conclusion: 'success',
        head_sha: SOURCE,
        id: jobId,
        name: 'Production bytes',
        run_attempt: 1,
        run_id: runId,
        steps: [
          {
            completed_at: new Date(Date.parse(run.created_at) + 7_000).toISOString(),
            conclusion: 'success',
            name: PRODUCTION_BYTES_REQUIRED_SUCCESS_STEPS[0],
            number: 1,
            started_at: new Date(Date.parse(run.created_at) + 3_000).toISOString(),
            status: 'completed',
          },
          {
            completed_at: new Date(Date.parse(run.created_at) + 12_000).toISOString(),
            conclusion: 'success',
            name: PRODUCTION_BYTES_BUDGET_FAILURE_STEP,
            number: 2,
            started_at: new Date(Date.parse(run.created_at) + 8_000).toISOString(),
            status: 'completed',
          },
          {
            completed_at: new Date(Date.parse(run.created_at) + 17_000).toISOString(),
            conclusion: 'success',
            name: PRODUCTION_BYTES_REQUIRED_SUCCESS_STEPS[1],
            number: 3,
            started_at: new Date(Date.parse(run.created_at) + 13_000).toISOString(),
            status: 'completed',
          },
        ],
        started_at: jobStartedAt,
        status: 'completed',
        url: `https://api.github.com/repos/${REPOSITORY}/actions/jobs/${String(jobId)}`,
      },
    ],
    total_count: 1,
  };
  return {
    archiveBytes,
    artifact,
    artifactApiBytes: jsonBytes(artifact),
    jobs,
    jobsApiBytes: jsonBytes(jobs),
    report,
    reportBytes,
    run,
    runApiBytes: jsonBytes(run),
  };
}

function markProductionBudgetFailure(fixture) {
  const producer = fixture.jobs.jobs.find(({ name }) => name === 'Production bytes');
  producer.conclusion = 'failure';
  producer.steps.find(({ name }) => name === PRODUCTION_BYTES_BUDGET_FAILURE_STEP).conclusion =
    'failure';
  fixture.jobsApiBytes = jsonBytes(fixture.jobs);
  fixture.run.conclusion = 'failure';
  fixture.runApiBytes = jsonBytes(fixture.run);
}

function fixtureOperations(campaign, checkout) {
  return {
    async fetchApi(endpoint) {
      if (
        endpoint ===
        `repos/${REPOSITORY}/actions/workflows/perf-realistic.yml/runs?head_sha=${SOURCE}&per_page=100`
      ) {
        const workflowRuns = [...campaign.byRun.values()].map((fixture) => fixture.run);
        return jsonBytes({ total_count: workflowRuns.length, workflow_runs: workflowRuns });
      }
      const value = campaign.endpoints.get(endpoint);
      if (value === undefined) throw new Error(`unexpected API endpoint ${endpoint}`);
      return Buffer.from(value);
    },
    async inspectCheckout() {
      return { head: SOURCE, root: checkout, status: '' };
    },
    now() {
      return '2026-08-14T00:00:00.000Z';
    },
  };
}

function campaignBoundary(campaign) {
  const runIds = [...campaign.byRun.keys()];
  return {
    campaignFirstRunId: Math.min(...runIds),
    campaignLastRunId: Math.max(...runIds),
  };
}

function validateFixture(fixture) {
  return validateCollectedCandidateBytes({
    archiveBytes: fixture.archiveBytes,
    artifactApiBytes: fixture.artifactApiBytes,
    expectedArtifactId: fixture.artifact.id,
    familyName: fixture.familyName,
    jobsApiBytes: fixture.jobsApiBytes,
    now: '2026-08-14T00:00:00.000Z',
    reportBytes: fixture.reportBytes,
    repository: REPOSITORY,
    runApiBytes: fixture.runApiBytes,
    sourceSha: SOURCE,
  });
}

function validateProductionBytesFixture(fixture) {
  return validateCollectedProductionBytesCandidateBytes({
    archiveBytes: fixture.archiveBytes,
    artifactApiBytes: fixture.artifactApiBytes,
    expectedArtifactId: fixture.artifact.id,
    jobsApiBytes: fixture.jobsApiBytes,
    now: '2026-08-14T00:00:00.000Z',
    reportBytes: fixture.reportBytes,
    repository: REPOSITORY,
    runApiBytes: fixture.runApiBytes,
    sourceSha: SOURCE,
  });
}

function updateArtifact(fixture, fields) {
  Object.assign(fixture.artifact, fields);
  fixture.artifactApiBytes = jsonBytes(fixture.artifact);
}

function updateRun(fixture, fields) {
  Object.assign(fixture.run, fields);
  fixture.runApiBytes = jsonBytes(fixture.run);
}

function resealWorkloadAndArchive(fixture) {
  fixture.report.workloadIdentity.digest = digest(
    canonicalJson(fixture.report.workloadIdentity.identity),
  );
  fixture.reportBytes = jsonBytes(fixture.report);
  fixture.archiveBytes = storedZip([
    {
      bytes: fixture.reportBytes,
      name: PERF_PUBLICATION_FAMILIES[fixture.familyName].reportMember,
    },
  ]);
  updateArtifact(fixture, {
    digest: digest(fixture.archiveBytes),
    size_in_bytes: fixture.archiveBytes.length,
  });
}

function resealProductionBytesExecution(fixture) {
  const { digest: _digest, schema: _schema, ...facts } = fixture.report.execution;
  fixture.report.execution.digest = digest(canonicalJson(facts));
  resealProductionBytesFixture(fixture);
}

function resealProductionBytesFixture(fixture) {
  fixture.reportBytes = jsonBytes(fixture.report);
  fixture.archiveBytes = storedZip([{ bytes: fixture.reportBytes, name: 'bytes.json' }]);
  updateArtifact(fixture, {
    digest: digest(fixture.archiveBytes),
    size_in_bytes: fixture.archiveBytes.length,
  });
}

async function loadOneCollection(checkout, collection) {
  return loadPerformancePublicationCollections({
    checkoutRoot: checkout,
    collectionDirectories: [collection],
    repository: REPOSITORY,
    sourceSha: SOURCE,
  });
}

async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-perf-publication-collect-test-'));
  temporaryDirectories.push(root);
  return root;
}

async function realDirectory(directory) {
  await mkdir(directory, { recursive: true });
  return directory;
}

async function directorySnapshot(directory) {
  const names = await readdir(directory);
  return Promise.all(
    names.sort().map(async (name) => ({ name, bytes: await readFile(path.join(directory, name)) })),
  );
}

function lockIdentity() {
  return {
    'benchmarks/harness/pnpm-lock.yaml': digest('harness-lock'),
    'benchmarks/nextjs/pnpm-lock.yaml': digest('next-lock'),
    'pnpm-lock.yaml': digest('root-lock'),
  };
}

function timestamp(runId) {
  return new Date(Date.UTC(2026, 7, 13, 0, 0, runId)).toISOString();
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function storedZip(entries) {
  const localRecords = [];
  const centralRecords = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const bytes = Buffer.from(entry.bytes);
    const checksum = crc32(bytes);
    const local = Buffer.alloc(30 + name.length + bytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    bytes.copy(local, 30 + name.length);
    localRecords.push(local);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    centralRecords.push(central);
    localOffset += local.length;
  }
  const centralOffset = localOffset;
  const centralSize = centralRecords.reduce((total, record) => total + record.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([...localRecords, ...centralRecords, end]);
}

function digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
