import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  authenticatePerformanceArtifactEvidence,
  readZipMember,
} from './perf-artifact-custody.mjs';

const temporaryDirectories = [];
const baselineCondition = [
  "${{ github.event_name == 'schedule' ||",
  "(github.event_name == 'workflow_dispatch' &&",
  "(inputs.measurement_scope == 'baselines' || inputs.measurement_scope == 'all')) ||",
  "(github.event_name == 'pull_request' && github.event.action == 'labeled' &&",
  "github.event.label.name == 'perf-measure-baselines') }}",
];
const buildProfileCondition = [
  "${{ (github.event_name == 'workflow_dispatch' &&",
  "(inputs.measurement_scope == 'decisions' || inputs.measurement_scope == 'all') &&",
  "(inputs.decision_focus == 'all' || inputs.decision_focus == 'build-profile')) ||",
  "(github.event_name == 'pull_request' && github.event.action == 'labeled' &&",
  "(github.event.label.name == 'perf-measure-decisions' ||",
  "github.event.label.name == 'perf-measure-build-profile')) }}",
];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('performance artifact custody', () => {
  it('binds the API record, ZIP digest, exact member, report, run, repository, and source', async () => {
    const fixture = writeArtifactFixture();

    const authenticated = await authenticatePerformanceArtifactEvidence(fixture.evidence, {
      baseDirectory: fixture.directory,
      expectedArtifactName: 'kovo-perf-browser-matrix',
      expectedReportMember: 'comparison.json',
      expectedWorkflowJob: {
        key: 'browser-matrix',
        name: 'Browser matrix',
        triggerPolicy: 'baseline',
      },
      fetchArtifactApi: async () => fixture.liveApiBytes,
      fetchWorkflowFileApi: async () => fixture.liveWorkflowApiBytes,
      fetchWorkflowJobsApi: async () => fixture.liveJobsApiBytes,
      fetchWorkflowRunApi: async () => fixture.liveRunApiBytes,
      loadTrustedWorkflow: async () => fixture.trustedWorkflow,
      now: '2026-08-14T00:00:00.000Z',
      repository: 'kovojs/kovo',
    });

    expect(authenticated.report).toEqual(fixture.report);
    expect(authenticated.rawText).toBe(fixture.reportText);
    expect(authenticated.custody).toMatchObject({
      apiUrl: 'https://api.github.com/repos/kovojs/kovo/actions/artifacts/2001',
      archiveDownloadUrl: 'https://api.github.com/repos/kovojs/kovo/actions/artifacts/2001/zip',
      artifactId: 2001,
      artifactName: 'kovo-perf-browser-matrix',
      location: 'https://github.com/kovojs/kovo/actions/runs/1001/artifacts/2001',
      reportMember: 'comparison.json',
      runUrl: 'https://github.com/kovojs/kovo/actions/runs/1001',
      workflow: {
        event: 'workflow_dispatch',
        path: '.github/workflows/perf-realistic.yml',
        triggerScope: 'workflow-dispatch:measurement_scope=baselines-or-all',
        workflowApiUrl:
          'https://api.github.com/repos/kovojs/kovo/contents/.github/workflows/perf-realistic.yml?ref=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      workflowRunId: 1001,
    });
    expect(authenticated.contentDigest).toBe(digest(fixture.reportText));
    expect(authenticated.custody.archiveDigest).toBe(digest(readFileSync(fixture.archivePath)));
  });

  it.each([
    ['archive digest', (fixture) => ({ ...fixture.metadata, digest: `sha256:${'0'.repeat(64)}` })],
    ['API URL', (fixture) => ({ ...fixture.metadata, url: `${fixture.metadata.url}/wrong` })],
    ['artifact name', (fixture) => ({ ...fixture.metadata, name: 'wrong-name' })],
    ['download census', (fixture) => ({ ...fixture.metadata, download_count: 0 })],
    [
      'workflow source',
      (fixture) => ({
        ...fixture.metadata,
        workflow_run: { ...fixture.metadata.workflow_run, head_sha: 'b'.repeat(40) },
      }),
    ],
    ['retention', (fixture) => ({ ...fixture.metadata, expired: true })],
  ])('rejects a mismatched %s', async (_label, mutate) => {
    const fixture = writeArtifactFixture();
    const mutatedBytes = Buffer.from(`${JSON.stringify(mutate(fixture))}\n`);
    writeFileSync(fixture.apiPath, mutatedBytes);
    fixture.liveApiBytes = mutatedBytes;

    await expect(
      authenticatePerformanceArtifactEvidence(fixture.evidence, {
        baseDirectory: fixture.directory,
        expectedArtifactName: 'kovo-perf-browser-matrix',
        expectedReportMember: 'comparison.json',
        expectedWorkflowJob: {
          key: 'browser-matrix',
          name: 'Browser matrix',
          triggerPolicy: 'baseline',
        },
        fetchArtifactApi: async () => fixture.liveApiBytes,
        fetchWorkflowFileApi: async () => fixture.liveWorkflowApiBytes,
        fetchWorkflowJobsApi: async () => fixture.liveJobsApiBytes,
        fetchWorkflowRunApi: async () => fixture.liveRunApiBytes,
        loadTrustedWorkflow: async () => fixture.trustedWorkflow,
        now: '2026-08-14T00:00:00.000Z',
        repository: 'kovojs/kovo',
      }),
    ).rejects.toThrow();
  });

  it('fails closed when the saved API response is not byte-identical to the live response', async () => {
    const fixture = writeArtifactFixture();

    await expect(
      authenticatePerformanceArtifactEvidence(fixture.evidence, {
        baseDirectory: fixture.directory,
        expectedArtifactName: 'kovo-perf-browser-matrix',
        expectedReportMember: 'comparison.json',
        expectedWorkflowJob: {
          key: 'browser-matrix',
          name: 'Browser matrix',
          triggerPolicy: 'baseline',
        },
        fetchArtifactApi: async () => Buffer.from('{}\n'),
        fetchWorkflowFileApi: async () => fixture.liveWorkflowApiBytes,
        fetchWorkflowJobsApi: async () => fixture.liveJobsApiBytes,
        fetchWorkflowRunApi: async () => fixture.liveRunApiBytes,
        loadTrustedWorkflow: async () => fixture.trustedWorkflow,
        now: '2026-08-14T00:00:00.000Z',
        repository: 'kovojs/kovo',
      }),
    ).rejects.toThrow('differs byte-for-byte from the live response');
  });

  it.each([
    ['alternate workflow', (run) => ({ ...run, path: '.github/workflows/other.yml' })],
    ['failed run', (run) => ({ ...run, conclusion: 'failure' })],
    ['non-baseline trigger', (run) => ({ ...run, event: 'push' })],
    ['different attempt', (run) => ({ ...run, run_attempt: 2 })],
  ])('rejects live authority from an %s', async (_label, mutate) => {
    const fixture = writeArtifactFixture();
    replaceRunApiFixture(fixture, mutate(fixture.runMetadata));

    await expect(authenticateFixture(fixture)).rejects.toThrow();
  });

  it('binds a pull-request baseline to the immutable run head and ignores the mutable PR head', async () => {
    const fixture = writeArtifactFixture({ event: 'pull_request' });
    const advancedPullRequest = {
      ...fixture.runMetadata,
      pull_requests: [{ head: { repo: { id: 101 }, sha: 'c'.repeat(40) } }],
    };
    replaceRunApiFixture(fixture, advancedPullRequest);

    const authenticated = await authenticateFixture(fixture);

    expect(authenticated.custody.workflow).toMatchObject({
      event: 'pull_request',
      headSha: fixture.sourceCommit,
      sourceSha: fixture.sourceCommit,
      triggerScope: 'pull-request:labeled/perf-measure-baselines',
    });
  });

  it('binds the build-profile job to only its reviewed decision triggers', async () => {
    const fixture = writeArtifactFixture({
      event: 'pull_request',
      jobKey: 'build-profile',
      jobName: 'N=216 build CPU profiles',
      triggerPolicy: 'build-profile',
    });

    const authenticated = await authenticateFixture(fixture);

    expect(authenticated.custody.workflow).toMatchObject({
      event: 'pull_request',
      job: { key: 'build-profile', name: 'N=216 build CPU profiles' },
      triggerPolicy: 'build-profile',
      triggerScope: 'pull-request:labeled/perf-measure-decisions-or-build-profile',
    });
  });

  it('binds trigger scope to the exact workflow bytes and a clean measured-source checkout', async () => {
    const fixture = writeArtifactFixture();
    const weakened = workflowFixtureSource('browser-matrix').replace(
      "github.event.label.name == 'perf-measure-baselines'",
      "github.event.label.name == 'anything'",
    );
    replaceWorkflowApiFixture(fixture, weakened);
    fixture.trustedWorkflow = { bytes: Buffer.from(weakened), headSha: fixture.sourceCommit };

    await expect(authenticateFixture(fixture)).rejects.toThrow(
      'workflow family job condition differs from the exact reviewed trigger policy',
    );

    const wrongCheckout = writeArtifactFixture();
    wrongCheckout.trustedWorkflow = {
      ...wrongCheckout.trustedWorkflow,
      headSha: 'c'.repeat(40),
    };
    await expect(authenticateFixture(wrongCheckout)).rejects.toThrow(
      'trusted local workflow is not bound to the measured source checkout',
    );
  });

  it('rejects workflow API bytes that differ from the locally reviewed workflow', async () => {
    const fixture = writeArtifactFixture();
    replaceWorkflowApiFixture(
      fixture,
      workflowFixtureSource('browser-matrix').replace('name: Browser matrix', 'name: Other'),
    );

    await expect(authenticateFixture(fixture)).rejects.toThrow(
      'workflow run definition differs byte-for-byte',
    );
  });

  it.each([
    ['wrong family job', (job) => ({ ...job, name: 'Matched production throughput' })],
    ['failed family job', (job) => ({ ...job, conclusion: 'failure' })],
    ['foreign run', (job) => ({ ...job, run_id: 9999 })],
  ])('rejects a %s in the live job census', async (_label, mutate) => {
    const fixture = writeArtifactFixture();
    const jobsMetadata = {
      ...fixture.jobsMetadata,
      jobs: [mutate(fixture.jobsMetadata.jobs[0])],
    };
    replaceJobsApiFixture(fixture, jobsMetadata);

    await expect(authenticateFixture(fixture)).rejects.toThrow();
  });

  it.each(['run', 'jobs'])(
    'rejects a saved %s API response that differs from live GitHub',
    async (kind) => {
      const fixture = writeArtifactFixture();
      const options =
        kind === 'run'
          ? { fetchWorkflowRunApi: async () => Buffer.from('{}\n') }
          : { fetchWorkflowJobsApi: async () => Buffer.from('{}\n') };

      await expect(authenticateFixture(fixture, options)).rejects.toThrow(
        `saved workflow ${kind} API response differs byte-for-byte`,
      );
    },
  );

  it('rejects extracted bytes that are not the authenticated ZIP member', async () => {
    const fixture = writeArtifactFixture();
    writeFileSync(fixture.reportPath, `${fixture.reportText} `);

    await expect(
      authenticatePerformanceArtifactEvidence(fixture.evidence, {
        baseDirectory: fixture.directory,
        expectedArtifactName: 'kovo-perf-browser-matrix',
        expectedReportMember: 'comparison.json',
        expectedWorkflowJob: {
          key: 'browser-matrix',
          name: 'Browser matrix',
          triggerPolicy: 'baseline',
        },
        fetchArtifactApi: async () => fixture.liveApiBytes,
        fetchWorkflowFileApi: async () => fixture.liveWorkflowApiBytes,
        fetchWorkflowJobsApi: async () => fixture.liveJobsApiBytes,
        fetchWorkflowRunApi: async () => fixture.liveRunApiBytes,
        loadTrustedWorkflow: async () => fixture.trustedWorkflow,
        now: '2026-08-14T00:00:00.000Z',
        repository: 'kovojs/kovo',
      }),
    ).rejects.toThrow('extracted report bytes differ');
  });

  it('rejects an oversized sparse artifact before reading or parsing its bytes', async () => {
    const fixture = writeArtifactFixture();
    truncateSync(fixture.archivePath, 512 * 1024 * 1024 + 1);

    await expect(
      authenticatePerformanceArtifactEvidence(fixture.evidence, {
        baseDirectory: fixture.directory,
        expectedArtifactName: 'kovo-perf-browser-matrix',
        expectedReportMember: 'comparison.json',
        expectedWorkflowJob: {
          key: 'browser-matrix',
          name: 'Browser matrix',
          triggerPolicy: 'baseline',
        },
        fetchArtifactApi: async () => fixture.liveApiBytes,
        fetchWorkflowFileApi: async () => fixture.liveWorkflowApiBytes,
        fetchWorkflowJobsApi: async () => fixture.liveJobsApiBytes,
        fetchWorkflowRunApi: async () => fixture.liveRunApiBytes,
        loadTrustedWorkflow: async () => fixture.trustedWorkflow,
        now: '2026-08-14T00:00:00.000Z',
        repository: 'kovojs/kovo',
      }),
    ).rejects.toThrow('artifact ZIP is not a bounded regular file');
  });

  it('binds an optional raw auxiliary member to the same authenticated ZIP', async () => {
    const rawProfile = Buffer.from('{"nodes":[],"samples":[],"timeDeltas":[]}\n');
    const fixture = writeArtifactFixture({
      auxiliary: { bytes: rawProfile, name: 'build-unchanged.cpuprofile' },
    });

    const authenticated = await authenticateFixture(fixture, {
      expectedAuxiliaryMember: 'build-unchanged.cpuprofile',
    });

    expect(authenticated.auxiliary).toMatchObject({
      contentDigest: digest(rawProfile),
      member: 'build-unchanged.cpuprofile',
    });
    expect(authenticated.auxiliary.bytes).toEqual(rawProfile);
    expect(authenticated.custody).toMatchObject({
      auxiliaryByteLength: rawProfile.length,
      auxiliaryContentDigest: digest(rawProfile),
      auxiliaryMember: 'build-unchanged.cpuprofile',
    });
    await expect(
      authenticateFixture(fixture, { expectedAuxiliaryMember: 'missing.cpuprofile' }),
    ).rejects.toThrow('ZIP member missing.cpuprofile is unavailable');
  });

  it('binds every original process profile and the fixed CPU-accounting member', async () => {
    const members = [
      { bytes: Buffer.from('cpu-user-us=1000\ncpu-system-us=500\n'), name: 'process-cpu-edit.txt' },
      { bytes: Buffer.from('{"nodes":[1]}'), name: 'raw-edit-client-pid-13.cpuprofile' },
      { bytes: Buffer.from('{"nodes":[2]}'), name: 'raw-edit-server-pid-17.cpuprofile' },
    ];
    const fixture = writeArtifactFixture({ auxiliaries: members });

    const authenticated = await authenticateFixture(fixture, {
      expectedAuxiliaryMemberGroup: { prefix: 'raw-edit-', suffix: '.cpuprofile' },
      expectedAuxiliaryMembers: ['process-cpu-edit.txt'],
    });

    expect(authenticated.auxiliaries.map(({ member }) => member)).toEqual([
      'process-cpu-edit.txt',
      'raw-edit-client-pid-13.cpuprofile',
      'raw-edit-server-pid-17.cpuprofile',
    ]);
    expect(authenticated.custody.auxiliaryMembers).toEqual(
      authenticated.auxiliaries.map(({ bytes, contentDigest, member }) => ({
        byteLength: bytes.length,
        contentDigest,
        member,
      })),
    );

    await expect(
      authenticateFixture(fixture, {
        expectedAuxiliaryMemberGroup: { prefix: 'raw-unchanged-', suffix: '.cpuprofile' },
        expectedAuxiliaryMembers: ['process-cpu-edit.txt'],
      }),
    ).rejects.toThrow('auxiliary member group is empty');
  });

  it('rejects unsafe or duplicate ZIP member identities', () => {
    expect(() =>
      readZipMember(
        storedZip([{ name: '../comparison.json', bytes: Buffer.from('{}') }]),
        '../comparison.json',
      ),
    ).toThrow('ZIP member name is unsafe');
    expect(() =>
      readZipMember(
        storedZip([
          { name: 'comparison.json', bytes: Buffer.from('{}') },
          { name: 'comparison.json', bytes: Buffer.from('{}') },
        ]),
        'comparison.json',
      ),
    ).toThrow('duplicate ZIP member');
  });
});

function writeArtifactFixture({
  auxiliary,
  auxiliaries = [],
  event = 'workflow_dispatch',
  jobKey = 'browser-matrix',
  jobName = 'Browser matrix',
  triggerPolicy = 'baseline',
} = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'kovo-perf-custody-'));
  temporaryDirectories.push(directory);
  const sourceCommit = 'a'.repeat(40);
  const eventSha = sourceCommit;
  const report = {
    execution: {
      github: {
        eventSha,
        job: jobKey,
        repository: 'kovojs/kovo',
        runAttempt: '1',
        runId: '1001',
        runUrl: 'https://github.com/kovojs/kovo/actions/runs/1001',
        serverUrl: 'https://github.com',
        sha: sourceCommit,
        workflowRef: 'kovojs/kovo/.github/workflows/perf-realistic.yml@refs/heads/main',
      },
    },
    source: { commit: sourceCommit },
  };
  const reportText = `${JSON.stringify(report, null, 2)}\n`;
  const archive = storedZip([
    { name: 'comparison.json', bytes: Buffer.from(reportText) },
    { name: 'raw/extra.json', bytes: Buffer.from('{"ok":true}\n') },
    ...(auxiliary === undefined ? [] : [auxiliary]),
    ...auxiliaries,
  ]);
  const metadata = {
    archive_download_url: 'https://api.github.com/repos/kovojs/kovo/actions/artifacts/2001/zip',
    created_at: '2026-08-13T23:00:00Z',
    digest: digest(archive),
    download_count: 1,
    expired: false,
    expires_at: '2026-11-11T23:00:00Z',
    id: 2001,
    name: 'kovo-perf-browser-matrix',
    size_in_bytes: archive.length,
    updated_at: '2026-08-13T23:01:00Z',
    url: 'https://api.github.com/repos/kovojs/kovo/actions/artifacts/2001',
    workflow_run: {
      head_branch: 'main',
      head_repository_id: 101,
      head_sha: eventSha,
      id: 1001,
      repository_id: 101,
    },
  };
  const runMetadata = {
    conclusion: 'success',
    event,
    head_branch: 'main',
    head_repository: { full_name: 'kovojs/kovo', id: 101 },
    head_sha: eventSha,
    html_url: 'https://github.com/kovojs/kovo/actions/runs/1001',
    id: 1001,
    jobs_url: 'https://api.github.com/repos/kovojs/kovo/actions/runs/1001/jobs',
    name: 'Perf Realistic Tier',
    path: '.github/workflows/perf-realistic.yml',
    pull_requests:
      event === 'pull_request' ? [{ head: { repo: { id: 101 }, sha: 'b'.repeat(40) } }] : [],
    repository: { full_name: 'kovojs/kovo', id: 101 },
    run_attempt: 1,
    status: 'completed',
    url: 'https://api.github.com/repos/kovojs/kovo/actions/runs/1001',
  };
  const jobsMetadata = {
    jobs: [
      {
        completed_at: '2026-08-13T23:02:00Z',
        conclusion: 'success',
        head_sha: eventSha,
        id: 3001,
        name: jobName,
        run_attempt: 1,
        run_id: 1001,
        started_at: '2026-08-13T22:00:00Z',
        status: 'completed',
        url: 'https://api.github.com/repos/kovojs/kovo/actions/jobs/3001',
      },
    ],
    total_count: 1,
  };
  const workflowText = workflowFixtureSource(jobKey, jobName, triggerPolicy);
  const workflowMetadata = workflowFileMetadata(workflowText, eventSha);
  const apiPath = path.join(directory, 'artifact.api.json');
  const archivePath = path.join(directory, 'artifact.zip');
  const jobsApiPath = path.join(directory, 'jobs.api.json');
  const reportPath = path.join(directory, 'comparison.json');
  const runApiPath = path.join(directory, 'run.api.json');
  writeFileSync(apiPath, `${JSON.stringify(metadata, null, 2)}\n`);
  writeFileSync(archivePath, archive);
  writeFileSync(jobsApiPath, `${JSON.stringify(jobsMetadata, null, 2)}\n`);
  writeFileSync(reportPath, reportText);
  writeFileSync(runApiPath, `${JSON.stringify(runMetadata, null, 2)}\n`);
  return {
    apiPath,
    archivePath,
    directory,
    eventSha,
    evidence: {
      apiMetadata: path.basename(apiPath),
      archive: path.basename(archivePath),
      jobsApiMetadata: path.basename(jobsApiPath),
      report: path.basename(reportPath),
      runApiMetadata: path.basename(runApiPath),
    },
    jobsApiPath,
    jobsMetadata,
    liveApiBytes: Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`),
    liveJobsApiBytes: Buffer.from(`${JSON.stringify(jobsMetadata, null, 2)}\n`),
    liveRunApiBytes: Buffer.from(`${JSON.stringify(runMetadata, null, 2)}\n`),
    liveWorkflowApiBytes: Buffer.from(`${JSON.stringify(workflowMetadata, null, 2)}\n`),
    metadata,
    expectedWorkflowJob: { key: jobKey, name: jobName, triggerPolicy },
    report,
    reportPath,
    reportText,
    runApiPath,
    runMetadata,
    sourceCommit,
    trustedWorkflow: { bytes: Buffer.from(workflowText), headSha: sourceCommit },
    workflowMetadata,
  };
}

function authenticateFixture(fixture, overrides = {}) {
  return authenticatePerformanceArtifactEvidence(fixture.evidence, {
    baseDirectory: fixture.directory,
    expectedArtifactName: 'kovo-perf-browser-matrix',
    expectedReportMember: 'comparison.json',
    expectedWorkflowJob: fixture.expectedWorkflowJob,
    fetchArtifactApi: async () => fixture.liveApiBytes,
    fetchWorkflowFileApi: async () => fixture.liveWorkflowApiBytes,
    fetchWorkflowJobsApi: async () => fixture.liveJobsApiBytes,
    fetchWorkflowRunApi: async () => fixture.liveRunApiBytes,
    loadTrustedWorkflow: async () => fixture.trustedWorkflow,
    now: '2026-08-14T00:00:00.000Z',
    repository: 'kovojs/kovo',
    ...overrides,
  });
}

function replaceWorkflowApiFixture(fixture, workflowText) {
  fixture.workflowMetadata = workflowFileMetadata(workflowText, fixture.eventSha);
  fixture.liveWorkflowApiBytes = Buffer.from(
    `${JSON.stringify(fixture.workflowMetadata, null, 2)}\n`,
  );
}

function workflowFixtureSource(jobKey, jobName = 'Browser matrix', triggerPolicy = 'baseline') {
  const condition = triggerPolicy === 'build-profile' ? buildProfileCondition : baselineCondition;
  return [
    'name: Perf Realistic Tier',
    '',
    'jobs:',
    `  ${jobKey}:`,
    `    name: ${jobName}`,
    '    if: >-',
    ...condition.map((line) => `      ${line}`),
    '    runs-on: ubuntu-24.04',
    '',
  ].join('\n');
}

function workflowFileMetadata(workflowText, headSha) {
  const bytes = Buffer.from(workflowText);
  const blobSha = createHash('sha1')
    .update(`blob ${String(bytes.length)}\0`)
    .update(bytes)
    .digest('hex');
  const apiUrl = `https://api.github.com/repos/kovojs/kovo/contents/.github/workflows/perf-realistic.yml?ref=${headSha}`;
  return {
    content: bytes.toString('base64'),
    download_url: `https://raw.githubusercontent.com/kovojs/kovo/${headSha}/.github/workflows/perf-realistic.yml`,
    encoding: 'base64',
    git_url: `https://api.github.com/repos/kovojs/kovo/git/blobs/${blobSha}`,
    html_url: `https://github.com/kovojs/kovo/blob/${headSha}/.github/workflows/perf-realistic.yml`,
    name: 'perf-realistic.yml',
    path: '.github/workflows/perf-realistic.yml',
    sha: blobSha,
    size: bytes.length,
    type: 'file',
    url: apiUrl,
  };
}

function replaceRunApiFixture(fixture, metadata) {
  fixture.runMetadata = metadata;
  fixture.liveRunApiBytes = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`);
  writeFileSync(fixture.runApiPath, fixture.liveRunApiBytes);
}

function replaceJobsApiFixture(fixture, metadata) {
  fixture.jobsMetadata = metadata;
  fixture.liveJobsApiBytes = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`);
  writeFileSync(fixture.jobsApiPath, fixture.liveJobsApiBytes);
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
