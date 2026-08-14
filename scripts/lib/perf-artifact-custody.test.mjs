import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  authenticatePerformanceArtifactEvidence,
  createPerformanceArtifactDescriptorCustody,
  loadLocalTrustedPerformanceWorkflow,
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
const productionBytesBudgetFailureStep = 'Evaluate against perf-budgets.json';
const productionBytesRequiredSuccessSteps = [
  'Measure critical-path, navigation and bootstrap bytes',
  'Run actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('performance artifact custody', () => {
  it('rejects absolute, traversal, and within-descriptor path aliases before parsing', async () => {
    const fixture = writeArtifactFixture();
    for (const mutate of [
      (evidence) => {
        evidence.report = fixture.reportPath;
      },
      (evidence) => {
        evidence.report = '../report.json';
      },
      (evidence) => {
        evidence.report = evidence.runApiMetadata;
      },
    ]) {
      const evidence = structuredClone(fixture.evidence);
      mutate(evidence);
      await expect(authenticateFixture({ ...fixture, evidence })).rejects.toThrow(
        /canonical safe relative path|paths must be distinct/u,
      );
    }
  });

  it('rejects symlink, hardlink, cross-descriptor, and read-swap aliases', async () => {
    for (const kind of ['symlink', 'hardlink']) {
      const fixture = writeArtifactFixture();
      unlinkSync(fixture.reportPath);
      if (kind === 'symlink') symlinkSync(fixture.runApiPath, fixture.reportPath);
      else linkSync(fixture.runApiPath, fixture.reportPath);
      await expect(authenticateFixture(fixture)).rejects.toThrow(/regular file|link|inode/u);
    }

    const shared = writeArtifactFixture();
    const descriptorCustody = await createPerformanceArtifactDescriptorCustody({
      baseDirectory: shared.directory,
    });
    await expect(authenticateFixture(shared, { descriptorCustody })).resolves.toBeDefined();
    await expect(authenticateFixture(shared, { descriptorCustody })).rejects.toThrow(
      'aliases another custody file',
    );

    const swapped = writeArtifactFixture();
    let swappedOnce = false;
    await expect(
      authenticateFixture(swapped, {
        descriptorReadHook({ descriptorKey, file }) {
          if (descriptorKey !== 'report' || swappedOnce) return;
          swappedOnce = true;
          renameSync(file, `${file}.original`);
          writeFileSync(file, swapped.reportText);
        },
      }),
    ).rejects.toThrow('changed while being read');
  });

  it('binds the API record, ZIP digest, exact member, report, run, repository, and source', async () => {
    const fixture = writeArtifactFixture();

    const authenticated = await authenticatePerformanceArtifactEvidence(fixture.evidence, {
      baseDirectory: fixture.directory,
      expectedArtifactName: 'kovo-perf-browser-matrix',
      expectedArchiveMembers: fixture.archiveMembers,
      expectedReportMember: 'comparison.json',
      expectedWorkflowJob: fixture.expectedWorkflowJob,
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
      archiveByteLength: readFileSync(fixture.archivePath).length,
      artifactId: 2001,
      artifactName: 'kovo-perf-browser-matrix',
      location: 'https://github.com/kovojs/kovo/actions/runs/1001/artifacts/2001',
      reportMember: 'comparison.json',
      runUrl: 'https://github.com/kovojs/kovo/actions/runs/1001',
      workflow: {
        artifactUpload: {
          action: 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
          concreteName: 'kovo-perf-browser-matrix',
          job: 'browser-matrix',
          name: 'kovo-perf-browser-matrix',
          path: '${{ runner.temp }}/kovo-perf/browser',
        },
        event: 'workflow_dispatch',
        path: '.github/workflows/perf-realistic.yml',
        triggerScope: 'workflow-dispatch:measurement_scope=baselines-or-all',
        workflowApiUrl:
          'https://api.github.com/repos/kovojs/kovo/contents/.github/workflows/perf-realistic.yml?ref=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        workflowSha: fixture.eventSha,
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
        expectedArchiveMembers: fixture.archiveMembers,
        expectedReportMember: 'comparison.json',
        expectedWorkflowJob: fixture.expectedWorkflowJob,
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

  it('accepts byte-different JSON encodings with the same immutable artifact authority', async () => {
    const fixture = writeArtifactFixture();
    fixture.liveApiBytes = Buffer.from(JSON.stringify(fixture.metadata));

    const authenticated = await authenticateFixture(fixture);
    expect(authenticated.custody.liveApiResponseDigest).not.toBe(
      authenticated.custody.apiResponseDigest,
    );
    expect(authenticated.custody.liveApiAuthorityDigest).toBe(
      authenticated.custody.apiAuthorityDigest,
    );
  });

  it('rejects a byte-valid live response whose immutable artifact authority changed', async () => {
    const fixture = writeArtifactFixture();
    fixture.liveApiBytes = Buffer.from(
      JSON.stringify({ ...fixture.metadata, digest: `sha256:${'0'.repeat(64)}` }),
    );

    await expect(authenticateFixture(fixture)).rejects.toThrow(
      'saved artifact API authority differs from the live response',
    );
  });

  it.each([
    ['alternate workflow', (run) => ({ ...run, path: '.github/workflows/other.yml' })],
    ['incomplete run', (run) => ({ ...run, conclusion: null, status: 'in_progress' })],
    ['mismatched head commit', (run) => ({ ...run, head_commit: { id: 'c'.repeat(40) } })],
    ['non-baseline trigger', (run) => ({ ...run, event: 'push' })],
    ['different attempt', (run) => ({ ...run, run_attempt: 2 })],
  ])('rejects live authority from an %s', async (_label, mutate) => {
    const fixture = writeArtifactFixture();
    replaceRunApiFixture(fixture, mutate(fixture.runMetadata));

    await expect(authenticateFixture(fixture)).rejects.toThrow();
  });

  it('accepts a completed failed run when the unique artifact producer job succeeded', async () => {
    const fixture = writeArtifactFixture();
    const producer = fixture.jobsMetadata.jobs[0];
    replaceRunApiFixture(fixture, { ...fixture.runMetadata, conclusion: 'failure' });
    replaceJobsApiFixture(fixture, {
      jobs: [
        producer,
        {
          ...producer,
          conclusion: 'failure',
          id: 3002,
          name: 'Production bytes',
          url: 'https://api.github.com/repos/kovojs/kovo/actions/jobs/3002',
        },
      ],
      total_count: 2,
    });

    await expect(authenticateFixture(fixture)).resolves.toMatchObject({
      custody: {
        workflow: {
          conclusion: 'failure',
          job: { conclusion: 'success', id: 3001, name: 'Browser matrix' },
          status: 'completed',
        },
      },
    });
  });

  it('rejects a completed run with more than one exact artifact producer job', async () => {
    const fixture = writeArtifactFixture();
    const producer = fixture.jobsMetadata.jobs[0];
    replaceJobsApiFixture(fixture, {
      jobs: [
        producer,
        {
          ...producer,
          id: 3002,
          url: 'https://api.github.com/repos/kovojs/kovo/actions/jobs/3002',
        },
      ],
      total_count: 2,
    });

    await expect(authenticateFixture(fixture)).rejects.toThrow(
      'workflow jobs API has 2 exact Browser matrix jobs for run attempt 1; expected one',
    );
  });

  it('binds a pull-request baseline to the immutable run head and ignores the mutable PR head', async () => {
    const fixture = writeArtifactFixture({ event: 'pull_request' });
    let fetchedWorkflowSha = null;
    const advancedPullRequest = {
      ...fixture.runMetadata,
      pull_requests: fixture.runMetadata.pull_requests.map((pullRequest) => ({
        ...pullRequest,
        head: { ...pullRequest.head, sha: 'c'.repeat(40) },
      })),
    };
    fixture.liveRunApiBytes = Buffer.from(`${JSON.stringify(advancedPullRequest)}\n`);

    const authenticated = await authenticateFixture(fixture, {
      fetchWorkflowFileApi: async ({ workflowSha }) => {
        fetchedWorkflowSha = workflowSha;
        return fixture.liveWorkflowApiBytes;
      },
    });

    expect(authenticated.custody.workflow).toMatchObject({
      event: 'pull_request',
      headSha: fixture.sourceCommit,
      sourceSha: fixture.sourceCommit,
      triggerScope: 'pull-request:labeled/perf-measure-baselines',
      workflowHeadSha: fixture.eventSha,
      workflowRef: 'kovojs/kovo/.github/workflows/perf-realistic.yml@refs/pull/7/merge',
      workflowSha: fixture.eventSha,
    });
    expect(fetchedWorkflowSha).toBe(fixture.eventSha);
    expect(fetchedWorkflowSha).not.toBe(fixture.sourceCommit);
    expect(authenticated.custody.liveRunApiResponseDigest).not.toBe(
      authenticated.custody.runApiResponseDigest,
    );
    expect(authenticated.custody.liveRunApiAuthorityDigest).toBe(
      authenticated.custody.runApiAuthorityDigest,
    );
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

  it('binds Production bytes to its exact PR-only trigger and authenticated upload', async () => {
    const options = {
      expectedArtifactName: 'kovo-perf-bytes',
      jobKey: 'bytes',
      jobName: 'Production bytes',
      triggerPolicy: 'production-bytes',
      workflowArtifactName: 'kovo-perf-bytes',
      workflowArtifactPath: '${{ runner.temp }}/kovo-perf/bytes.json',
    };
    const fixture = writeArtifactFixture({ ...options, event: 'pull_request' });
    const workflow = readFileSync(path.resolve('.github/workflows/perf-realistic.yml'), 'utf8');
    replaceWorkflowApiFixture(fixture, workflow);
    fixture.trustedWorkflow = { bytes: Buffer.from(workflow), headSha: fixture.sourceCommit };

    const authenticated = await authenticateFixture(fixture);

    expect(authenticated.custody.workflow).toMatchObject({
      artifactUpload: {
        action: 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
        concreteName: 'kovo-perf-bytes',
        job: 'bytes',
        name: 'kovo-perf-bytes',
        path: '${{ runner.temp }}/kovo-perf/bytes.json',
      },
      event: 'pull_request',
      job: { key: 'bytes', name: 'Production bytes' },
      triggerPolicy: 'production-bytes',
      triggerScope: 'pull-request:every-event',
    });

    replaceRunApiFixture(fixture, { ...fixture.runMetadata, conclusion: 'failure' });
    replaceJobsApiFixture(fixture, {
      ...fixture.jobsMetadata,
      jobs: fixture.jobsMetadata.jobs.map((job) => ({
        ...job,
        conclusion: 'failure',
        steps: job.steps.map((step) =>
          step.name === productionBytesBudgetFailureStep
            ? { ...step, conclusion: 'failure' }
            : step,
        ),
      })),
    });
    await expect(
      authenticateFixture(fixture, {
        allowedProducerJobConclusions: ['failure', 'success'],
        allowedProducerFailureStep: productionBytesBudgetFailureStep,
        requiredProducerSuccessSteps: productionBytesRequiredSuccessSteps,
      }),
    ).resolves.toMatchObject({
      custody: {
        workflow: {
          job: {
            conclusion: 'failure',
            failureStep: {
              conclusion: 'failure',
              name: productionBytesBudgetFailureStep,
              number: 2,
              status: 'completed',
            },
            requiredSuccessSteps: [
              {
                conclusion: 'success',
                name: productionBytesRequiredSuccessSteps[0],
                number: 1,
                status: 'completed',
              },
              {
                conclusion: 'success',
                name: productionBytesRequiredSuccessSteps[1],
                number: 3,
                status: 'completed',
              },
            ],
          },
        },
      },
    });
    await expect(authenticateFixture(fixture)).rejects.toThrow(
      'expected workflow artifact producer job is not authorized',
    );

    const authorizedJobs = structuredClone(fixture.jobsMetadata);
    for (const mutate of [
      (job) => {
        job.steps.find(({ name }) => name === productionBytesBudgetFailureStep).name =
          'Some other failed step';
      },
      (job) => {
        job.steps.find(({ name }) => name === productionBytesRequiredSuccessSteps[0]).conclusion =
          'skipped';
      },
      (job) => {
        job.steps.find(({ name }) => name === productionBytesRequiredSuccessSteps[1]).conclusion =
          'failure';
      },
    ]) {
      const wrongFailure = structuredClone(authorizedJobs);
      mutate(wrongFailure.jobs[0]);
      replaceJobsApiFixture(fixture, wrongFailure);
      await expect(
        authenticateFixture(fixture, {
          allowedProducerJobConclusions: ['failure', 'success'],
          allowedProducerFailureStep: productionBytesBudgetFailureStep,
          requiredProducerSuccessSteps: productionBytesRequiredSuccessSteps,
        }),
      ).rejects.toThrow('expected workflow artifact producer job is not authorized');
    }

    await expect(authenticateFixture(writeArtifactFixture(options))).rejects.toThrow(
      'workflow run event workflow_dispatch is not a reviewed trigger',
    );
  });

  it('rejects a PR report that conflates the measured head with the evaluated merge workflow', async () => {
    const fixture = writeArtifactFixture({
      event: 'pull_request',
      reportedWorkflowSha: 'a'.repeat(40),
    });

    await expect(authenticateFixture(fixture)).rejects.toThrow(
      'report execution does not match the live workflow run and expected job',
    );
  });

  it('rejects a workflow ref that is not the exact pull-request merge ref', async () => {
    const fixture = writeArtifactFixture({
      event: 'pull_request',
      reportedWorkflowRef: 'kovojs/kovo/.github/workflows/perf-realistic.yml@refs/heads/main',
    });

    await expect(authenticateFixture(fixture)).rejects.toThrow(
      'report execution does not match the live workflow run and expected job',
    );
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

  it('requires raw evidence and output staging to remain outside the clean measured checkout', async () => {
    const repository = mkdtempSync(path.join(os.tmpdir(), 'kovo-perf-custody-repository-'));
    temporaryDirectories.push(repository);
    const workflowDirectory = path.join(repository, '.github', 'workflows');
    mkdirSync(workflowDirectory, { recursive: true });
    const workflow = workflowFixtureSource('browser-matrix');
    writeFileSync(path.join(workflowDirectory, 'perf-realistic.yml'), workflow);
    execFileSync('git', ['init', '--quiet'], { cwd: repository });
    execFileSync('git', ['add', '.github/workflows/perf-realistic.yml'], { cwd: repository });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Kovo Test',
        '-c',
        'user.email=kovo-test@example.invalid',
        'commit',
        '--quiet',
        '-m',
        'fixture',
      ],
      { cwd: repository },
    );
    const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim();

    await expect(
      loadLocalTrustedPerformanceWorkflow({ repositoryDirectory: repository, sourceSha }),
    ).resolves.toMatchObject({ headSha: sourceSha });

    writeFileSync(path.join(repository, 'raw-evidence.json'), '{}\n');
    await expect(
      loadLocalTrustedPerformanceWorkflow({ repositoryDirectory: repository, sourceSha }),
    ).rejects.toThrow('publication checkout has uncommitted or untracked changes');
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

  it('rejects an expected artifact upload routed through a different workflow job', async () => {
    const fixture = writeArtifactFixture();
    const misrouted = `${workflowFixtureSource('browser-matrix').replace(
      '          name: kovo-perf-browser-matrix',
      '          name: kovo-perf-unrelated',
    )}${foreignUploadJob({
      name: 'kovo-perf-browser-matrix',
      path: '${{ runner.temp }}/kovo-perf/browser',
    })}`;
    replaceWorkflowApiFixture(fixture, misrouted);
    fixture.trustedWorkflow = { bytes: Buffer.from(misrouted), headSha: fixture.sourceCommit };

    await expect(authenticateFixture(fixture)).rejects.toThrow(
      'workflow job browser-matrix does not uniquely own the reviewed kovo-perf-browser-matrix upload',
    );
  });

  it('rejects a foreign concrete upload that collides with an expected matrix template', async () => {
    const fixture = writeArtifactFixture({
      expectedArtifactName: 'kovo-perf-dev-n24',
      jobKey: 'dev-matrix',
      jobName: 'N=24 developer loop',
      workflowArtifactName: 'kovo-perf-dev-n${{ matrix.corpus }}',
      workflowArtifactPath: '${{ runner.temp }}/kovo-perf/dev-n${{ matrix.corpus }}',
    });
    const overlapping = `${fixture.workflowText}${foreignUploadJob({
      name: 'kovo-perf-dev-n24',
      path: '${{ runner.temp }}/forged',
    })}`;
    replaceWorkflowApiFixture(fixture, overlapping);
    fixture.trustedWorkflow = { bytes: Buffer.from(overlapping), headSha: fixture.sourceCommit };

    await expect(authenticateFixture(fixture)).rejects.toThrow(
      'workflow job dev-matrix does not uniquely own the reviewed kovo-perf-dev-n${{ matrix.corpus }} upload',
    );
  });

  it('rejects an unpinned or wrong-path upload step in the expected workflow job', async () => {
    const fixture = writeArtifactFixture();
    const wrongUpload = fixture.workflowText
      .replace(
        'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
        `actions/upload-artifact@${'0'.repeat(40)}`,
      )
      .replace(
        '          path: ${{ runner.temp }}/kovo-perf/browser',
        '          path: ${{ runner.temp }}/kovo-perf/other',
      );
    replaceWorkflowApiFixture(fixture, wrongUpload);
    fixture.trustedWorkflow = { bytes: Buffer.from(wrongUpload), headSha: fixture.sourceCommit };

    await expect(authenticateFixture(fixture)).rejects.toThrow(
      'workflow job browser-matrix does not uniquely own the reviewed kovo-perf-browser-matrix upload',
    );
  });

  it.each([
    [
      'check-scaling',
      'Check scaling',
      'kovo-perf-check-scaling',
      'kovo-perf-check-scaling',
      '${{ runner.temp }}/kovo-perf/check-scaling.json',
    ],
    [
      'browser-matrix',
      'Browser matrix',
      'kovo-perf-browser-matrix',
      'kovo-perf-browser-matrix',
      '${{ runner.temp }}/kovo-perf/browser',
    ],
    [
      'dev-matrix',
      'N=24 developer loop',
      'kovo-perf-dev-n24',
      'kovo-perf-dev-n${{ matrix.corpus }}',
      '${{ runner.temp }}/kovo-perf/dev-n${{ matrix.corpus }}',
    ],
    [
      'build-matrix',
      'N=24 production builds',
      'kovo-perf-build-n24',
      'kovo-perf-build-n${{ matrix.corpus }}',
      '${{ runner.temp }}/kovo-perf/build-n${{ matrix.corpus }}',
    ],
    [
      'server-matrix',
      'Matched production throughput',
      'kovo-perf-server-matrix',
      'kovo-perf-server-matrix',
      '${{ runner.temp }}/kovo-perf/server',
    ],
    [
      'build-profile',
      'N=216 build CPU profiles',
      'kovo-perf-build-profile-n216',
      'kovo-perf-build-profile-n216',
      '${{ runner.temp }}/kovo-perf/build-profile-n216',
      'build-profile',
    ],
  ])(
    'authenticates the real %s job upload contract',
    async (
      jobKey,
      jobName,
      expectedArtifactName,
      workflowArtifactName,
      workflowArtifactPath,
      triggerPolicy = 'baseline',
    ) => {
      const fixture = writeArtifactFixture({
        expectedArtifactName,
        jobKey,
        jobName,
        triggerPolicy,
        workflowArtifactName,
        workflowArtifactPath,
      });
      const workflow = readFileSync(path.resolve('.github/workflows/perf-realistic.yml'), 'utf8');
      replaceWorkflowApiFixture(fixture, workflow);
      fixture.trustedWorkflow = { bytes: Buffer.from(workflow), headSha: fixture.sourceCommit };

      await expect(authenticateFixture(fixture)).resolves.toMatchObject({
        custody: { artifactName: expectedArtifactName },
      });
    },
  );

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
        `saved workflow ${kind} API authority differs from the live response`,
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
        expectedArchiveMembers: fixture.archiveMembers,
        expectedReportMember: 'comparison.json',
        expectedWorkflowJob: fixture.expectedWorkflowJob,
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

  it('rejects an artifact with any member outside the exact expected census', async () => {
    const fixture = writeArtifactFixture();

    await expect(
      authenticateFixture(fixture, { expectedArchiveMembers: ['comparison.json'] }),
    ).rejects.toThrow('ZIP member census differs from the exact expected artifact members');
  });

  it('CRC-checks every member in the artifact, including an unselected auxiliary', () => {
    const archive = storedZip([
      { name: 'comparison.json', bytes: Buffer.from('{}') },
      { name: 'unselected.txt', bytes: Buffer.from('untampered') },
    ]);
    const payloadOffset = archive.indexOf(Buffer.from('untampered'));
    archive[payloadOffset] ^= 0xff;

    expect(() => readZipMember(archive, 'comparison.json')).toThrow(
      'ZIP member unselected.txt CRC-32 differs',
    );
  });

  it('rejects an oversized sparse artifact before reading or parsing its bytes', async () => {
    const fixture = writeArtifactFixture();
    truncateSync(fixture.archivePath, 512 * 1024 * 1024 + 1);

    await expect(
      authenticatePerformanceArtifactEvidence(fixture.evidence, {
        baseDirectory: fixture.directory,
        expectedArtifactName: 'kovo-perf-browser-matrix',
        expectedArchiveMembers: fixture.archiveMembers,
        expectedReportMember: 'comparison.json',
        expectedWorkflowJob: fixture.expectedWorkflowJob,
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
  expectedArtifactName = 'kovo-perf-browser-matrix',
  jobKey = 'browser-matrix',
  jobName = 'Browser matrix',
  reportedWorkflowRef,
  reportedWorkflowSha,
  triggerPolicy = 'baseline',
  workflowArtifactName = expectedArtifactName,
  workflowArtifactPath = '${{ runner.temp }}/kovo-perf/browser',
} = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'kovo-perf-custody-'));
  temporaryDirectories.push(directory);
  const sourceCommit = 'a'.repeat(40);
  const eventSha = event === 'pull_request' ? 'd'.repeat(40) : sourceCommit;
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
        workflowRef:
          reportedWorkflowRef ??
          (event === 'pull_request'
            ? 'kovojs/kovo/.github/workflows/perf-realistic.yml@refs/pull/7/merge'
            : 'kovojs/kovo/.github/workflows/perf-realistic.yml@refs/heads/main'),
        workflowSha: reportedWorkflowSha ?? eventSha,
      },
    },
    source: { commit: sourceCommit },
  };
  const reportText = `${JSON.stringify(report, null, 2)}\n`;
  const archiveEntries = [
    { name: 'comparison.json', bytes: Buffer.from(reportText) },
    { name: 'raw/extra.json', bytes: Buffer.from('{"ok":true}\n') },
    ...(auxiliary === undefined ? [] : [auxiliary]),
    ...auxiliaries,
  ];
  const archive = storedZip(archiveEntries);
  const metadata = {
    archive_download_url: 'https://api.github.com/repos/kovojs/kovo/actions/artifacts/2001/zip',
    created_at: '2026-08-13T23:00:00Z',
    digest: digest(archive),
    expired: false,
    expires_at: '2026-11-11T23:00:00Z',
    id: 2001,
    name: expectedArtifactName,
    size_in_bytes: archive.length,
    updated_at: '2026-08-13T23:01:00Z',
    url: 'https://api.github.com/repos/kovojs/kovo/actions/artifacts/2001',
    workflow_run: {
      head_branch: 'main',
      head_repository_id: 101,
      head_sha: sourceCommit,
      id: 1001,
      repository_id: 101,
    },
  };
  const runMetadata = {
    conclusion: 'success',
    event,
    head_branch: 'main',
    head_commit: { id: sourceCommit },
    head_repository: { full_name: 'kovojs/kovo', id: 101 },
    head_sha: sourceCommit,
    html_url: 'https://github.com/kovojs/kovo/actions/runs/1001',
    id: 1001,
    jobs_url: 'https://api.github.com/repos/kovojs/kovo/actions/runs/1001/jobs',
    name: 'Perf Realistic Tier',
    path: '.github/workflows/perf-realistic.yml',
    pull_requests:
      event === 'pull_request'
        ? [
            {
              head: { repo: { id: 101 }, sha: 'b'.repeat(40) },
              id: 7001,
              number: 7,
              url: 'https://api.github.com/repos/kovojs/kovo/pulls/7',
            },
          ]
        : [],
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
        head_sha: sourceCommit,
        id: 3001,
        name: jobName,
        run_attempt: 1,
        run_id: 1001,
        ...(triggerPolicy === 'production-bytes' ? { steps: productionBytesJobSteps() } : {}),
        started_at: '2026-08-13T22:00:00Z',
        status: 'completed',
        url: 'https://api.github.com/repos/kovojs/kovo/actions/jobs/3001',
      },
    ],
    total_count: 1,
  };
  const workflowArtifact = { name: workflowArtifactName, path: workflowArtifactPath };
  const workflowText = workflowFixtureSource(jobKey, jobName, triggerPolicy, workflowArtifact);
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
    archiveMembers: archiveEntries.map(({ name }) => name),
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
    expectedArtifactName,
    expectedWorkflowJob: { artifact: workflowArtifact, key: jobKey, name: jobName, triggerPolicy },
    report,
    reportPath,
    reportText,
    runApiPath,
    runMetadata,
    sourceCommit,
    trustedWorkflow: { bytes: Buffer.from(workflowText), headSha: sourceCommit },
    workflowMetadata,
    workflowText,
  };
}

function productionBytesJobSteps() {
  return [
    {
      completed_at: '2026-08-13T22:01:00Z',
      conclusion: 'success',
      name: productionBytesRequiredSuccessSteps[0],
      number: 1,
      started_at: '2026-08-13T22:00:00Z',
      status: 'completed',
    },
    {
      completed_at: '2026-08-13T22:02:00Z',
      conclusion: 'success',
      name: productionBytesBudgetFailureStep,
      number: 2,
      started_at: '2026-08-13T22:01:00Z',
      status: 'completed',
    },
    {
      completed_at: '2026-08-13T22:03:00Z',
      conclusion: 'success',
      name: productionBytesRequiredSuccessSteps[1],
      number: 3,
      started_at: '2026-08-13T22:02:00Z',
      status: 'completed',
    },
  ];
}

function authenticateFixture(fixture, overrides = {}) {
  return authenticatePerformanceArtifactEvidence(fixture.evidence, {
    baseDirectory: fixture.directory,
    expectedArtifactName: fixture.expectedArtifactName,
    expectedArchiveMembers: fixture.archiveMembers,
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

function workflowFixtureSource(
  jobKey,
  jobName = 'Browser matrix',
  triggerPolicy = 'baseline',
  artifact = {
    name: 'kovo-perf-browser-matrix',
    path: '${{ runner.temp }}/kovo-perf/browser',
  },
) {
  const condition =
    triggerPolicy === 'build-profile'
      ? buildProfileCondition
      : triggerPolicy === 'production-bytes'
        ? ["${{ github.event_name == 'pull_request' }}"]
        : baselineCondition;
  const conditionLines =
    triggerPolicy === 'production-bytes'
      ? [`    if: ${condition[0]}`]
      : ['    if: >-', ...condition.map((line) => `      ${line}`)];
  return [
    'name: Perf Realistic Tier',
    '',
    'jobs:',
    `  ${jobKey}:`,
    `    name: ${jobName}`,
    ...conditionLines,
    '    runs-on: ubuntu-24.04',
    '    steps:',
    '      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
    '        if: always()',
    '        with:',
    '          if-no-files-found: warn',
    `          name: ${artifact.name}`,
    `          path: ${artifact.path}`,
    '          retention-days: 90',
    '',
  ].join('\n');
}

function foreignUploadJob({ name, path: artifactPath }) {
  return [
    '  foreign-uploader:',
    '    name: Foreign uploader',
    '    runs-on: ubuntu-24.04',
    '    steps:',
    '      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
    '        if: always()',
    '        with:',
    '          if-no-files-found: warn',
    `          name: ${name}`,
    `          path: ${artifactPath}`,
    '          retention-days: 90',
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
