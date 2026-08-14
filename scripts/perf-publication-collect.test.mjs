import { createHash } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
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
  performancePublicationCohortDigest,
  selectPerformancePublicationCohorts,
  validateCollectedCandidateBytes,
} from './perf-publication-collect.mjs';
import {
  PACKED_KOVO_PRODUCT_WORKLOAD_POLICY,
  fixturePackedKovoProductIdentity,
} from './fixtures/perf-packed-product-identity.mjs';
import { canonicalJson } from './lib/perf-host.mjs';

const REPOSITORY = 'kovojs/kovo';
const SOURCE = 'a'.repeat(40);
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

  it('fails closed on multiple qualifying cohorts unless an exact cohort or unique host is selected', () => {
    const candidates = selectionCandidates();
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
        checkoutDirectory: checkout,
        operations: fixtureOperations(missing, checkout),
        outDirectory: path.join(root, 'missing'),
        repository: REPOSITORY,
        runIds: [1001],
        sourceSha: SOURCE,
      }),
    ).rejects.toThrow('no literal baseline-family artifact');

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
    ];
    for (const [label, mutate] of cases) {
      const fixture = campaignFixture([{ family: 'browser', runId: 1001 }]).byRun.get(1001);
      mutate(fixture);
      expect(() => validateFixture(fixture), label).toThrow();
    }
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
      checkoutDirectory: checkout,
      operations: fixtureOperations(campaign, checkout),
      outDirectory: collection,
      repository: REPOSITORY,
      runIds: [1001],
      sourceSha: SOURCE,
    });
    await expect(
      collectPerformancePublicationRuns({
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

  it('emits the exact self-contained seven-family five-plus-one manifest', async () => {
    const root = await temporaryRoot();
    const checkout = await realDirectory(path.join(root, 'checkout'));
    const assignments = [];
    let runId = 10_000;
    for (const family of PERF_PUBLICATION_FAMILY_NAMES) {
      for (let index = 0; index < 6; index += 1) assignments.push({ family, runId: runId++ });
    }
    const campaign = campaignFixture(assignments);
    const collection = path.join(root, 'collection');
    await collectPerformancePublicationRuns({
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
    expect(Object.keys(result.manifest)).toEqual(['families', 'repository', 'schema']);
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
  });
});

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
      familyName: assignment.family,
      index,
      locks,
      productArtifact,
      runId: assignment.runId,
    });
    byRun.set(assignment.runId, fixture);
    const runPath = `repos/${REPOSITORY}/actions/runs/${String(assignment.runId)}`;
    const artifactPath = `repos/${REPOSITORY}/actions/artifacts/${String(fixture.artifact.id)}`;
    endpoints.set(runPath, fixture.runApiBytes);
    endpoints.set(`${runPath}/jobs?filter=all&per_page=100`, fixture.jobsApiBytes);
    endpoints.set(
      `${runPath}/artifacts?per_page=100`,
      jsonBytes({
        artifacts: [{ id: fixture.artifact.id, name: fixture.artifact.name }],
        total_count: 1,
      }),
    );
    endpoints.set(artifactPath, fixture.artifactApiBytes);
    endpoints.set(`${artifactPath}/zip`, fixture.archiveBytes);
  }
  return { byRun, endpoints };
}

function reportFixture({ artifactId, familyName, index, locks, productArtifact, runId }) {
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
    event: 'workflow_dispatch',
    head_branch: 'agent/perf-baselines',
    head_commit: { id: SOURCE },
    head_repository: { full_name: REPOSITORY, id: repositoryId },
    head_sha: SOURCE,
    html_url: runUrl,
    id: runId,
    jobs_url: `${runApiUrl}/jobs`,
    name: 'Perf Realistic Tier',
    path: '.github/workflows/perf-realistic.yml',
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
    workflowRef: `${REPOSITORY}/.github/workflows/perf-realistic.yml@refs/heads/agent/perf-baselines`,
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
    source: { commit: SOURCE, dirty: false, dirtyPaths: [], locks },
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

function fixtureOperations(campaign, checkout) {
  return {
    async fetchApi(endpoint) {
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
