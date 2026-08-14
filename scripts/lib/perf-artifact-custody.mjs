import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { inflateRawSync } from 'node:zlib';

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const GIT_BLOB_PATTERN = /^[0-9a-f]{40}$/u;
export const PERF_REALISTIC_WORKFLOW_PATH = '.github/workflows/perf-realistic.yml';
const PERF_REALISTIC_WORKFLOW_NAME = 'Perf Realistic Tier';
const UPLOAD_ARTIFACT_ACTION = 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02';
const WORKFLOW_TRIGGER_POLICIES = Object.freeze({
  baseline: Object.freeze({
    condition:
      "${{ github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && (inputs.measurement_scope == 'baselines' || inputs.measurement_scope == 'all')) || (github.event_name == 'pull_request' && github.event.action == 'labeled' && github.event.label.name == 'perf-measure-baselines') }}",
    scopes: Object.freeze({
      pull_request: 'pull-request:labeled/perf-measure-baselines',
      schedule: 'schedule:baseline-matrix',
      workflow_dispatch: 'workflow-dispatch:measurement_scope=baselines-or-all',
    }),
  }),
  'build-profile': Object.freeze({
    condition:
      "${{ (github.event_name == 'workflow_dispatch' && (inputs.measurement_scope == 'decisions' || inputs.measurement_scope == 'all') && (inputs.decision_focus == 'all' || inputs.decision_focus == 'build-profile')) || (github.event_name == 'pull_request' && github.event.action == 'labeled' && (github.event.label.name == 'perf-measure-decisions' || github.event.label.name == 'perf-measure-build-profile')) }}",
    scopes: Object.freeze({
      pull_request: 'pull-request:labeled/perf-measure-decisions-or-build-profile',
      workflow_dispatch:
        'workflow-dispatch:measurement_scope=decisions-or-all;decision_focus=all-or-build-profile',
    }),
  }),
  'production-bytes': Object.freeze({
    condition: "${{ github.event_name == 'pull_request' }}",
    scopes: Object.freeze({
      pull_request: 'pull-request:every-event',
    }),
  }),
});
const MAX_ZIP_ENTRIES = 10_000;
const MAX_API_RESPONSE_BYTES = 1024 * 1024;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_REPORT_BYTES = 128 * 1024 * 1024;
const MAX_AUXILIARY_MEMBERS = 128;
const execFileAsync = promisify(execFile);

/**
 * Authenticate one extracted performance report through byte-identical live GitHub artifact, run,
 * and job API responses, the exact downloaded ZIP bytes, the exact report member bytes, and the
 * workflow definition GitHub evaluated. This is evidence custody, not a claim that
 * repository-controlled JSON can replace GitHub's external authority boundary.
 */
export async function authenticatePerformanceArtifactEvidence(
  evidence,
  {
    baseDirectory = process.cwd(),
    descriptorCustody,
    descriptorCustodyShare = {},
    descriptorReadHook,
    expectedArtifactName,
    allowedProducerJobConclusions = ['success'],
    allowedProducerFailureStep = null,
    requiredProducerSuccessSteps = [],
    expectedArchiveMembers,
    expectedAuxiliaryMember,
    expectedAuxiliaryMemberGroup,
    expectedAuxiliaryMembers,
    expectedReportMember,
    expectedWorkflowJob,
    fetchArtifactApi = fetchGitHubArtifactApiResponse,
    fetchWorkflowFileApi = fetchGitHubWorkflowFileApiResponse,
    fetchWorkflowJobsApi = fetchGitHubWorkflowJobsApiResponse,
    fetchWorkflowRunApi = fetchGitHubWorkflowRunApiResponse,
    loadTrustedWorkflow = loadLocalTrustedPerformanceWorkflow,
    now,
    repository,
    repositoryDirectory = process.cwd(),
  },
) {
  validateEvidenceDescriptor(evidence);
  if (!REPOSITORY_PATTERN.test(repository ?? '')) {
    throw new TypeError('repository must be an exact owner/name identity');
  }
  if (!nonEmptyString(expectedArtifactName) || !safeZipPath(expectedReportMember)) {
    throw new TypeError('expected artifact name and report member are required');
  }
  validateExpectedAuxiliaryMembers({
    expectedAuxiliaryMember,
    expectedAuxiliaryMemberGroup,
    expectedAuxiliaryMembers,
    expectedReportMember,
  });
  validateExpectedArchiveMembers(expectedArchiveMembers, expectedReportMember);
  validateExpectedWorkflowJob(expectedWorkflowJob);
  validateAllowedProducerJobConclusions(
    allowedProducerJobConclusions,
    allowedProducerFailureStep,
    requiredProducerSuccessSteps,
  );
  const custody =
    descriptorCustody ?? (await createPerformanceArtifactDescriptorCustody({ baseDirectory }));
  const [apiBytes, archiveBytes, jobsApiBytes, reportBytes, runApiBytes] = await Promise.all([
    readPerformanceArtifactCustodyFile(evidence.apiMetadata, {
      custody,
      descriptorKey: 'apiMetadata',
      label: 'artifact API metadata',
      maximumBytes: MAX_API_RESPONSE_BYTES,
      readHook: descriptorReadHook,
      shareGroup: descriptorCustodyShare.apiMetadata,
    }),
    readPerformanceArtifactCustodyFile(evidence.archive, {
      custody,
      descriptorKey: 'archive',
      label: 'artifact ZIP',
      maximumBytes: MAX_ARCHIVE_BYTES,
      readHook: descriptorReadHook,
      shareGroup: descriptorCustodyShare.archive,
    }),
    readPerformanceArtifactCustodyFile(evidence.jobsApiMetadata, {
      custody,
      descriptorKey: 'jobsApiMetadata',
      label: 'workflow jobs API metadata',
      maximumBytes: MAX_API_RESPONSE_BYTES,
      readHook: descriptorReadHook,
      shareGroup: descriptorCustodyShare.jobsApiMetadata,
    }),
    readPerformanceArtifactCustodyFile(evidence.report, {
      custody,
      descriptorKey: 'report',
      label: 'extracted performance report',
      maximumBytes: MAX_REPORT_BYTES,
      readHook: descriptorReadHook,
      shareGroup: descriptorCustodyShare.report,
    }),
    readPerformanceArtifactCustodyFile(evidence.runApiMetadata, {
      custody,
      descriptorKey: 'runApiMetadata',
      label: 'workflow run API metadata',
      maximumBytes: MAX_API_RESPONSE_BYTES,
      readHook: descriptorReadHook,
      shareGroup: descriptorCustodyShare.runApiMetadata,
    }),
  ]);
  const metadata = parseJsonBytes(apiBytes, 'artifact API metadata');
  const jobsMetadata = parseJsonBytes(jobsApiBytes, 'workflow jobs API metadata');
  const report = parseJsonBytes(reportBytes, 'extracted performance report');
  const runMetadata = parseJsonBytes(runApiBytes, 'workflow run API metadata');

  const archiveDigest = sha256Bytes(archiveBytes);
  const reportContentDigest = sha256Bytes(reportBytes);
  const archiveCensus = authenticateZipArchive(archiveBytes);
  const archiveMemberNames = archiveCensus.map(({ member }) => member);
  if (
    expectedArchiveMembers !== undefined &&
    JSON.stringify([...archiveMemberNames].sort((left, right) => left.localeCompare(right))) !==
      JSON.stringify([...expectedArchiveMembers].sort((left, right) => left.localeCompare(right)))
  ) {
    throw new TypeError('ZIP member census differs from the exact expected artifact members');
  }
  const memberBytes = archiveCensus.find(({ member }) => member === expectedReportMember)?.bytes;
  if (!Buffer.isBuffer(memberBytes)) {
    throw new TypeError(`ZIP member ${expectedReportMember} is unavailable`);
  }
  if (!memberBytes.equals(reportBytes)) {
    throw new TypeError(`extracted report bytes differ from ZIP member ${expectedReportMember}`);
  }
  const auxiliaryNames = resolveExpectedAuxiliaryMembers(archiveCensus, {
    expectedAuxiliaryMember,
    expectedAuxiliaryMemberGroup,
    expectedAuxiliaryMembers,
  });
  const archiveByMember = new Map(archiveCensus.map((entry) => [entry.member, entry]));
  const auxiliaries = auxiliaryNames.map((member) => {
    const entry = archiveByMember.get(member);
    if (entry === undefined) throw new TypeError(`ZIP member ${member} is unavailable`);
    return { bytes: entry.bytes, member };
  });

  const artifactId = positiveInteger(metadata?.id, 'artifact API id');
  for (const [label, fetchApi] of [
    ['artifact', fetchArtifactApi],
    ['workflow file', fetchWorkflowFileApi],
    ['workflow jobs', fetchWorkflowJobsApi],
    ['workflow run', fetchWorkflowRunApi],
  ]) {
    if (typeof fetchApi !== 'function') {
      throw new TypeError(`live ${String(label)} API fetch is required`);
    }
  }
  if (typeof loadTrustedWorkflow !== 'function') {
    throw new TypeError('clean local workflow checkout authentication is required');
  }
  const workflowRunId = positiveInteger(metadata?.workflow_run?.id, 'artifact workflow run id');
  const workflowSha = report?.execution?.github?.workflowSha;
  const sourceSha = report?.source?.commit;
  if (!COMMIT_PATTERN.test(workflowSha ?? '')) {
    throw new TypeError('report workflow SHA is unavailable');
  }
  let liveApiBytes;
  let liveWorkflowApiBytes;
  let liveJobsApiBytes;
  let liveRunApiBytes;
  let trustedWorkflow;
  try {
    [liveApiBytes, liveWorkflowApiBytes, liveJobsApiBytes, liveRunApiBytes, trustedWorkflow] =
      await Promise.all([
        fetchLiveApiBytes(fetchArtifactApi, { artifactId, repository }),
        fetchLiveApiBytes(fetchWorkflowFileApi, {
          repository,
          workflowSha,
        }),
        fetchLiveApiBytes(fetchWorkflowJobsApi, { repository, workflowRunId }),
        fetchLiveApiBytes(fetchWorkflowRunApi, { repository, workflowRunId }),
        loadTrustedWorkflow({ repositoryDirectory, sourceSha }),
      ]);
  } catch (error) {
    throw new TypeError(
      `live GitHub API verification failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const liveMetadata = parseJsonBytes(liveApiBytes, 'live artifact API metadata');
  const liveJobsMetadata = parseJsonBytes(liveJobsApiBytes, 'live workflow jobs API metadata');
  const liveRunMetadata = parseJsonBytes(liveRunApiBytes, 'live workflow run API metadata');
  const authorityPairs = [
    {
      label: 'artifact',
      live: artifactAuthorityProjection(liveMetadata),
      saved: artifactAuthorityProjection(metadata),
    },
    {
      label: 'workflow jobs',
      live: workflowJobsAuthorityProjection(liveJobsMetadata),
      saved: workflowJobsAuthorityProjection(jobsMetadata),
    },
    {
      label: 'workflow run',
      live: workflowRunAuthorityProjection(liveRunMetadata),
      saved: workflowRunAuthorityProjection(runMetadata),
    },
  ];
  for (const { label, live, saved } of authorityPairs) {
    if (JSON.stringify(saved) !== JSON.stringify(live)) {
      throw new TypeError(`saved ${label} API authority differs from the live response`);
    }
  }
  const apiUrl = `https://api.github.com/repos/${repository}/actions/artifacts/${String(artifactId)}`;
  const archiveDownloadUrl = `${apiUrl}/zip`;
  const runApiUrl = `https://api.github.com/repos/${repository}/actions/runs/${String(workflowRunId)}`;
  const jobsApiUrl = `${runApiUrl}/jobs?filter=all&per_page=100`;
  const runUrl = `https://github.com/${repository}/actions/runs/${String(workflowRunId)}`;
  const location = `${runUrl}/artifacts/${String(artifactId)}`;
  const findings = [];
  if (metadata?.name !== expectedArtifactName) {
    findings.push(`artifact name is ${String(metadata?.name)}, expected ${expectedArtifactName}`);
  }
  if (metadata?.url !== apiUrl) findings.push('artifact API URL is not derived from its identity');
  if (metadata?.archive_download_url !== archiveDownloadUrl) {
    findings.push('artifact archive API URL is not derived from its identity');
  }
  if (metadata?.expired !== false) findings.push('artifact API record is expired');
  if (metadata?.digest !== archiveDigest || !DIGEST_PATTERN.test(metadata?.digest ?? '')) {
    findings.push('downloaded artifact ZIP digest differs from the GitHub artifact API digest');
  }
  if (metadata?.size_in_bytes !== archiveBytes.length) {
    findings.push('downloaded artifact ZIP size differs from the GitHub artifact API size');
  }
  if (report?.execution?.github?.runUrl !== runUrl) {
    findings.push('report execution run URL differs from the artifact workflow run');
  }
  if (String(report?.execution?.github?.runId ?? '') !== String(workflowRunId)) {
    findings.push('report execution run ID differs from the artifact workflow run');
  }
  if (report?.execution?.github?.repository !== repository) {
    findings.push('report execution repository differs from the artifact repository');
  }
  const workflowAuthority = authenticateWorkflowAuthority({
    artifactMetadata: metadata,
    allowedProducerJobConclusions,
    allowedProducerFailureStep,
    requiredProducerSuccessSteps,
    expectedArtifactName,
    expectedWorkflowJob,
    jobsApiUrl,
    jobsMetadata,
    report,
    repository,
    runApiUrl,
    runMetadata,
    runUrl,
    trustedWorkflow,
    workflowApiBytes: liveWorkflowApiBytes,
    workflowSha,
    workflowRunId,
  });
  findings.push(...workflowAuthority.findings);
  const createdAt = validTimestamp(metadata?.created_at, 'artifact created_at', findings);
  const updatedAt = validTimestamp(metadata?.updated_at, 'artifact updated_at', findings);
  const expiresAt = validTimestamp(metadata?.expires_at, 'artifact expires_at', findings);
  if (
    Number.isFinite(createdAt) &&
    Number.isFinite(updatedAt) &&
    Number.isFinite(expiresAt) &&
    (createdAt > updatedAt || updatedAt > expiresAt)
  ) {
    findings.push('artifact API timestamps are not monotonic');
  }
  const expectedJobStartedAt = Date.parse(workflowAuthority.facts.job.startedAt ?? '');
  const expectedJobCompletedAt = Date.parse(workflowAuthority.facts.job.completedAt ?? '');
  if (
    Number.isFinite(createdAt) &&
    Number.isFinite(updatedAt) &&
    Number.isFinite(expectedJobStartedAt) &&
    Number.isFinite(expectedJobCompletedAt) &&
    (createdAt < expectedJobStartedAt ||
      createdAt > expectedJobCompletedAt ||
      updatedAt < expectedJobStartedAt ||
      updatedAt > expectedJobCompletedAt)
  ) {
    findings.push('artifact timestamps fall outside the expected producer job');
  }
  const observedNow =
    now instanceof Date ? now.getTime() : Date.parse(now ?? new Date().toISOString());
  if (!Number.isFinite(observedNow)) throw new TypeError('now must be a valid timestamp');
  if (Number.isFinite(expiresAt) && observedNow >= expiresAt) {
    findings.push('artifact retention expired before publication verification');
  }
  if (findings.length > 0) throw new TypeError(findings.join('\n'));

  return {
    contentDigest: reportContentDigest,
    custody: {
      apiResponseDigest: sha256Bytes(apiBytes),
      apiAuthorityDigest: sha256Authority(artifactAuthorityProjection(metadata)),
      apiUrl,
      archiveByteLength: archiveBytes.length,
      archiveDigest,
      archiveDownloadUrl,
      archiveMembers: archiveCensus.map(({ bytes: _bytes, ...facts }) => facts),
      artifactId,
      artifactDigest: metadata.digest,
      artifactName: metadata.name,
      artifactSizeInBytes: metadata.size_in_bytes,
      createdAt: metadata.created_at,
      expiresAt: metadata.expires_at,
      jobsApiResponseDigest: sha256Bytes(jobsApiBytes),
      jobsApiAuthorityDigest: sha256Authority(workflowJobsAuthorityProjection(jobsMetadata)),
      jobsApiUrl,
      liveApiResponseDigest: sha256Bytes(liveApiBytes),
      liveApiAuthorityDigest: sha256Authority(artifactAuthorityProjection(liveMetadata)),
      liveJobsApiResponseDigest: sha256Bytes(liveJobsApiBytes),
      liveJobsApiAuthorityDigest: sha256Authority(
        workflowJobsAuthorityProjection(liveJobsMetadata),
      ),
      liveRunApiResponseDigest: sha256Bytes(liveRunApiBytes),
      liveRunApiAuthorityDigest: sha256Authority(workflowRunAuthorityProjection(liveRunMetadata)),
      liveApiVerifiedAt: new Date(observedNow).toISOString(),
      location,
      ...(auxiliaries.length === 0
        ? {}
        : {
            auxiliaryMembers: auxiliaries.map(({ bytes, member }) => ({
              byteLength: bytes.length,
              contentDigest: sha256Bytes(bytes),
              member,
            })),
            ...(expectedAuxiliaryMember === undefined
              ? {}
              : {
                  auxiliaryByteLength: auxiliaries[0].bytes.length,
                  auxiliaryContentDigest: sha256Bytes(auxiliaries[0].bytes),
                  auxiliaryMember: auxiliaries[0].member,
                }),
          }),
      reportContentDigest,
      reportMember: expectedReportMember,
      runApiResponseDigest: sha256Bytes(runApiBytes),
      runApiAuthorityDigest: sha256Authority(workflowRunAuthorityProjection(runMetadata)),
      runApiUrl,
      runUrl,
      updatedAt: metadata.updated_at,
      workflow: workflowAuthority.facts,
      workflowApiResponseDigest: sha256Bytes(liveWorkflowApiBytes),
      workflowRunId,
    },
    ...(auxiliaries.length === 0
      ? {}
      : {
          auxiliaries: auxiliaries.map(({ bytes, member }) => ({
            bytes,
            contentDigest: sha256Bytes(bytes),
            member,
          })),
          ...(expectedAuxiliaryMember === undefined
            ? {}
            : {
                auxiliary: {
                  bytes: auxiliaries[0].bytes,
                  contentDigest: sha256Bytes(auxiliaries[0].bytes),
                  member: auxiliaries[0].member,
                },
              }),
        }),
    location,
    rawText: reportBytes.toString('utf8'),
    report,
  };
}

/** Fetch the canonical API record through the authenticated GitHub CLI. No offline CLI mode exists. */
export async function fetchGitHubArtifactApiResponse({ artifactId, repository }) {
  if (!REPOSITORY_PATTERN.test(repository ?? '')) {
    throw new TypeError('repository must be an exact owner/name identity');
  }
  positiveInteger(artifactId, 'artifact API id');
  return fetchGitHubApiResponse(
    `repos/${repository}/actions/artifacts/${String(artifactId)}`,
    'artifact',
  );
}

/** Fetch one canonical workflow-run record; callers cannot substitute an offline cache. */
export async function fetchGitHubWorkflowRunApiResponse({ repository, workflowRunId }) {
  validateWorkflowRunFetchIdentity(repository, workflowRunId);
  return fetchGitHubApiResponse(
    `repos/${repository}/actions/runs/${String(workflowRunId)}`,
    'workflow run',
  );
}

/** Fetch the complete one-page artifact census for one campaign run. */
export async function fetchGitHubWorkflowArtifactsApiResponse({ repository, workflowRunId }) {
  validateWorkflowRunFetchIdentity(repository, workflowRunId);
  return fetchGitHubApiResponse(
    `repos/${repository}/actions/runs/${String(workflowRunId)}/artifacts?per_page=100`,
    'workflow artifacts',
  );
}

/** Fetch the exact-source workflow-run census that seals a preregistered campaign boundary. */
export async function fetchGitHubCampaignWorkflowRunsApiResponse({ repository, sourceSha }) {
  if (!REPOSITORY_PATTERN.test(repository ?? '')) {
    throw new TypeError('repository must be an exact owner/name identity');
  }
  if (!COMMIT_PATTERN.test(sourceSha ?? '')) {
    throw new TypeError('campaign source SHA is unavailable');
  }
  return fetchGitHubApiResponse(
    `repos/${repository}/actions/workflows/perf-realistic.yml/runs?head_sha=${sourceSha}&per_page=100`,
    'campaign workflow runs',
  );
}

/** Fetch the bounded all-attempt job census used to prove the exact successful matrix job. */
export async function fetchGitHubWorkflowJobsApiResponse({ repository, workflowRunId }) {
  validateWorkflowRunFetchIdentity(repository, workflowRunId);
  return fetchGitHubApiResponse(
    `repos/${repository}/actions/runs/${String(workflowRunId)}/jobs?filter=all&per_page=100`,
    'workflow jobs',
  );
}

/** Fetch the exact workflow file at the runner-authenticated evaluated-workflow SHA. */
export async function fetchGitHubWorkflowFileApiResponse({ repository, workflowSha }) {
  if (!REPOSITORY_PATTERN.test(repository ?? '')) {
    throw new TypeError('repository must be an exact owner/name identity');
  }
  if (!COMMIT_PATTERN.test(workflowSha ?? '')) {
    throw new TypeError('evaluated workflow SHA is unavailable');
  }
  return fetchGitHubApiResponse(
    `repos/${repository}/contents/${PERF_REALISTIC_WORKFLOW_PATH}?ref=${workflowSha}`,
    'workflow file',
  );
}

/** Bind publication to a clean checkout of the measured source and its reviewed workflow bytes. */
export async function loadLocalTrustedPerformanceWorkflow({ repositoryDirectory, sourceSha }) {
  if (!COMMIT_PATTERN.test(sourceSha ?? '')) {
    throw new TypeError('workflow source SHA is unavailable');
  }
  const directory = path.resolve(repositoryDirectory ?? process.cwd());
  const { stdout: rootOutput } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
    cwd: directory,
    encoding: 'utf8',
    maxBuffer: MAX_API_RESPONSE_BYTES,
    timeout: 30_000,
  });
  const root = rootOutput.trim();
  if (!nonEmptyString(root)) throw new TypeError('workflow checkout root is unavailable');
  const [{ stdout: headOutput }, { stdout: statusOutput }, { stdout: committedBytes }, bytes] =
    await Promise.all([
      execFileAsync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: MAX_API_RESPONSE_BYTES,
        timeout: 30_000,
      }),
      execFileAsync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: MAX_API_RESPONSE_BYTES,
        timeout: 30_000,
      }),
      execFileAsync('git', ['show', `HEAD:${PERF_REALISTIC_WORKFLOW_PATH}`], {
        cwd: root,
        encoding: 'buffer',
        maxBuffer: MAX_API_RESPONSE_BYTES,
        timeout: 30_000,
      }),
      readBoundedRegularFile(
        path.join(root, PERF_REALISTIC_WORKFLOW_PATH),
        MAX_API_RESPONSE_BYTES,
        'trusted local workflow',
      ),
    ]);
  const headSha = headOutput.trim();
  if (headSha !== sourceSha) {
    throw new TypeError('publication checkout HEAD differs from the measured source SHA');
  }
  if (statusOutput !== '') {
    throw new TypeError('publication checkout has uncommitted or untracked changes');
  }
  if (!Buffer.isBuffer(committedBytes) || !bytes.equals(committedBytes)) {
    throw new TypeError('trusted local performance workflow differs from committed HEAD bytes');
  }
  return { bytes, headSha };
}

async function fetchGitHubApiResponse(endpoint, label) {
  const { stdout } = await execFileAsync('gh', ['api', endpoint], {
    encoding: 'buffer',
    maxBuffer: MAX_API_RESPONSE_BYTES,
    timeout: 30_000,
  });
  if (!Buffer.isBuffer(stdout) || stdout.length === 0) {
    throw new TypeError(`GitHub ${label} API returned no bytes`);
  }
  return stdout;
}

function authenticateWorkflowAuthority({
  artifactMetadata,
  allowedProducerJobConclusions,
  allowedProducerFailureStep,
  requiredProducerSuccessSteps,
  expectedArtifactName,
  expectedWorkflowJob,
  jobsApiUrl,
  jobsMetadata,
  report,
  repository,
  runApiUrl,
  runMetadata,
  runUrl,
  trustedWorkflow,
  workflowApiBytes,
  workflowSha,
  workflowRunId,
}) {
  const findings = [];
  const github = report?.execution?.github;
  const runAttempt = runMetadata?.run_attempt;
  const event = runMetadata?.event;
  const triggerPolicy = WORKFLOW_TRIGGER_POLICIES[expectedWorkflowJob.triggerPolicy];
  const triggerScope = triggerPolicy?.scopes?.[event] ?? null;
  const repositoryId = runMetadata?.repository?.id;
  const headRepositoryId = runMetadata?.head_repository?.id;
  const runHeadSha = runMetadata?.head_sha;
  const sourceSha = report?.source?.commit;
  const workflowDefinition = authenticateWorkflowDefinition({
    expectedArtifactName,
    expectedWorkflowJob,
    repository,
    sourceSha,
    trustedWorkflow,
    workflowApiBytes,
    workflowSha,
  });
  findings.push(...workflowDefinition.findings);

  if (!ownRecord(runMetadata)) findings.push('workflow run API response is not an object');
  if (runMetadata?.id !== workflowRunId) findings.push('workflow run API identity differs');
  if (
    runMetadata?.url !== runApiUrl ||
    runMetadata?.html_url !== runUrl ||
    runMetadata?.jobs_url !== `${runApiUrl}/jobs`
  ) {
    findings.push('workflow run API URLs are not derived from its identity');
  }
  if (
    runMetadata?.repository?.full_name !== repository ||
    runMetadata?.head_repository?.full_name !== repository ||
    !Number.isSafeInteger(repositoryId) ||
    repositoryId < 1 ||
    !Number.isSafeInteger(headRepositoryId) ||
    headRepositoryId < 1 ||
    headRepositoryId !== repositoryId
  ) {
    findings.push('workflow run repository or head repository is not canonical');
  }
  if (runMetadata?.head_commit?.id !== runHeadSha) {
    findings.push('workflow run head commit identity differs from its immutable head SHA');
  }
  if (
    artifactMetadata?.workflow_run?.repository_id !== repositoryId ||
    artifactMetadata?.workflow_run?.head_repository_id !== headRepositoryId ||
    artifactMetadata?.workflow_run?.head_branch !== runMetadata?.head_branch ||
    artifactMetadata?.workflow_run?.head_sha !== runHeadSha
  ) {
    findings.push('artifact workflow identity differs from the live workflow run');
  }
  if (
    runMetadata?.name !== PERF_REALISTIC_WORKFLOW_NAME ||
    runMetadata?.path !== PERF_REALISTIC_WORKFLOW_PATH
  ) {
    findings.push('workflow run did not originate from the realistic performance workflow');
  }
  if (!Number.isSafeInteger(runAttempt) || runAttempt < 1) {
    findings.push('workflow run attempt is unavailable');
  }
  if (runMetadata?.status !== 'completed') {
    findings.push('workflow run is not completed');
  }
  if (triggerScope === null) {
    findings.push(`workflow run event ${String(event)} is not a reviewed trigger`);
  }
  if (!COMMIT_PATTERN.test(runHeadSha ?? '')) {
    findings.push('workflow run head SHA is unavailable');
  }
  if (!COMMIT_PATTERN.test(sourceSha ?? '')) findings.push('workflow source SHA is unavailable');
  if (!sourceCommitMatchesRun(runMetadata, sourceSha)) {
    findings.push('report source commit differs from the immutable workflow run head SHA');
  }
  if (
    !COMMIT_PATTERN.test(github?.eventSha ?? '') ||
    !COMMIT_PATTERN.test(github?.workflowSha ?? '') ||
    github?.workflowSha !== workflowSha ||
    (event === 'pull_request'
      ? github?.eventSha !== github?.workflowSha
      : github?.eventSha !== runHeadSha || github?.workflowSha !== runHeadSha) ||
    github?.sha !== sourceSha ||
    github?.repository !== repository ||
    github?.serverUrl !== 'https://github.com' ||
    github?.runUrl !== runUrl ||
    String(github?.runId ?? '') !== String(workflowRunId) ||
    String(github?.runAttempt ?? '') !== String(runAttempt) ||
    github?.job !== expectedWorkflowJob.key ||
    !validWorkflowReference(github?.workflowRef, repository, event, runMetadata)
  ) {
    findings.push('report execution does not match the live workflow run and expected job');
  }

  const jobs = Array.isArray(jobsMetadata?.jobs) ? jobsMetadata.jobs : [];
  if (
    !ownRecord(jobsMetadata) ||
    !Number.isSafeInteger(jobsMetadata?.total_count) ||
    jobsMetadata.total_count < 1 ||
    jobsMetadata.total_count > 100 ||
    jobsMetadata.total_count !== jobs.length
  ) {
    findings.push('workflow jobs API census is incomplete or exceeds the one-page bound');
  }
  const matchingJobs = jobs.filter(
    (job) => job?.name === expectedWorkflowJob.name && job?.run_attempt === runAttempt,
  );
  if (matchingJobs.length !== 1) {
    findings.push(
      `workflow jobs API has ${String(matchingJobs.length)} exact ${expectedWorkflowJob.name} jobs for run attempt ${String(runAttempt)}; expected one`,
    );
  }
  const job = matchingJobs[0] ?? null;
  const jobId = job?.id;
  const steps = Array.isArray(job?.steps) ? job.steps : [];
  const failedSteps = steps.filter((step) => step?.conclusion === 'failure');
  const failureStepMatches = steps.filter((step) => step?.name === allowedProducerFailureStep);
  const requiredSuccessStepMatches = requiredProducerSuccessSteps.map((name) =>
    steps.filter((step) => step?.name === name),
  );
  const authorizedFailureStep = failureStepMatches[0] ?? null;
  const authorizedRequiredSuccessSteps = requiredSuccessStepMatches.map(
    ([requiredStep]) => requiredStep,
  );
  const authorizedFailure =
    job?.conclusion === 'failure' &&
    requiredProducerSuccessSteps.length === 2 &&
    failedSteps.length === 1 &&
    failureStepMatches.length === 1 &&
    authorizedFailureStep?.conclusion === 'failure' &&
    authorizedFailureStep?.status === 'completed' &&
    Number.isSafeInteger(authorizedFailureStep?.number) &&
    authorizedFailureStep.number > 0 &&
    requiredSuccessStepMatches.every(
      (matches) =>
        matches.length === 1 &&
        matches[0]?.conclusion === 'success' &&
        matches[0]?.status === 'completed' &&
        Number.isSafeInteger(matches[0]?.number) &&
        matches[0].number > 0,
    ) &&
    authorizedRequiredSuccessSteps[0].number < authorizedFailureStep.number &&
    authorizedFailureStep.number < authorizedRequiredSuccessSteps[1].number;
  if (
    job !== null &&
    (!Number.isSafeInteger(jobId) ||
      jobId < 1 ||
      job.run_id !== workflowRunId ||
      job.run_attempt !== runAttempt ||
      job.head_sha !== runHeadSha ||
      job.status !== 'completed' ||
      !allowedProducerJobConclusions.includes(job.conclusion) ||
      (job.conclusion === 'failure' && !authorizedFailure) ||
      job.url !== `https://api.github.com/repos/${repository}/actions/jobs/${String(jobId)}`)
  ) {
    findings.push('expected workflow artifact producer job is not authorized in the live run');
  }
  const jobStartedAt = validTimestamp(job?.started_at, 'workflow job started_at', findings);
  const jobCompletedAt = validTimestamp(job?.completed_at, 'workflow job completed_at', findings);
  if (
    Number.isFinite(jobStartedAt) &&
    Number.isFinite(jobCompletedAt) &&
    jobStartedAt > jobCompletedAt
  ) {
    findings.push('workflow job timestamps are not monotonic');
  }

  return {
    facts: {
      conclusion: runMetadata?.conclusion ?? null,
      event: event ?? null,
      headSha: runHeadSha ?? null,
      job: {
        apiUrl:
          Number.isSafeInteger(jobId) && jobId > 0
            ? `https://api.github.com/repos/${repository}/actions/jobs/${String(jobId)}`
            : null,
        completedAt: job?.completed_at ?? null,
        conclusion: job?.conclusion ?? null,
        failureStep: !authorizedFailure
          ? null
          : {
              conclusion: authorizedFailureStep.conclusion,
              name: authorizedFailureStep.name,
              number: authorizedFailureStep.number,
              status: authorizedFailureStep.status,
            },
        id: jobId ?? null,
        key: expectedWorkflowJob.key,
        name: expectedWorkflowJob.name,
        requiredSuccessSteps: !authorizedFailure
          ? []
          : authorizedRequiredSuccessSteps.map((step) => ({
              conclusion: step.conclusion,
              name: step.name,
              number: step.number,
              status: step.status,
            })),
        runAttempt: job?.run_attempt ?? null,
        startedAt: job?.started_at ?? null,
        status: job?.status ?? null,
      },
      jobsApiUrl,
      name: runMetadata?.name ?? null,
      path: runMetadata?.path ?? null,
      runApiUrl,
      runAttempt: runAttempt ?? null,
      sourceSha: sourceSha ?? null,
      status: runMetadata?.status ?? null,
      triggerPolicy: expectedWorkflowJob.triggerPolicy,
      triggerScope,
      artifactUpload: workflowDefinition.facts.artifactUpload,
      workflowApiUrl: workflowDefinition.facts.apiUrl,
      workflowContentDigest: workflowDefinition.facts.contentDigest,
      workflowGitBlobSha: workflowDefinition.facts.gitBlobSha,
      workflowHeadSha: workflowDefinition.facts.workflowSha,
      workflowRef: github?.workflowRef ?? null,
      workflowSha: workflowDefinition.facts.workflowSha,
    },
    findings,
  };
}

function authenticateWorkflowDefinition({
  expectedArtifactName,
  expectedWorkflowJob,
  repository,
  sourceSha,
  trustedWorkflow,
  workflowApiBytes,
  workflowSha,
}) {
  const findings = [];
  const metadata = parseJsonBytes(workflowApiBytes, 'workflow file API metadata');
  const apiUrl = `https://api.github.com/repos/${repository}/contents/${PERF_REALISTIC_WORKFLOW_PATH}?ref=${String(workflowSha)}`;
  const workflowBytes = decodeGitHubFileContent(metadata, findings);
  const gitBlobSha = gitBlobDigest(workflowBytes);
  const expectedRawUrl = `https://raw.githubusercontent.com/${repository}/${String(workflowSha)}/${PERF_REALISTIC_WORKFLOW_PATH}`;
  const expectedHtmlUrl = `https://github.com/${repository}/blob/${String(workflowSha)}/${PERF_REALISTIC_WORKFLOW_PATH}`;
  if (
    metadata?.type !== 'file' ||
    metadata?.encoding !== 'base64' ||
    metadata?.name !== path.basename(PERF_REALISTIC_WORKFLOW_PATH) ||
    metadata?.path !== PERF_REALISTIC_WORKFLOW_PATH ||
    metadata?.size !== workflowBytes.length ||
    metadata?.url !== apiUrl ||
    metadata?.download_url !== expectedRawUrl ||
    metadata?.html_url !== expectedHtmlUrl ||
    !GIT_BLOB_PATTERN.test(metadata?.sha ?? '') ||
    metadata?.sha !== gitBlobSha ||
    metadata?.git_url !== `https://api.github.com/repos/${repository}/git/blobs/${gitBlobSha}`
  ) {
    findings.push('workflow file API identity or Git blob digest differs');
  }
  if (
    !ownRecord(trustedWorkflow) ||
    !Buffer.isBuffer(trustedWorkflow.bytes) ||
    trustedWorkflow.headSha !== sourceSha
  ) {
    findings.push('trusted local workflow is not bound to the measured source checkout');
  } else if (!workflowBytes.equals(trustedWorkflow.bytes)) {
    findings.push('workflow run definition differs byte-for-byte from the reviewed local workflow');
  }
  try {
    const condition = workflowJobCondition(workflowBytes.toString('utf8'), expectedWorkflowJob.key);
    if (condition !== WORKFLOW_TRIGGER_POLICIES[expectedWorkflowJob.triggerPolicy]?.condition) {
      findings.push('workflow family job condition differs from the exact reviewed trigger policy');
    }
  } catch (error) {
    findings.push(error instanceof Error ? error.message : String(error));
  }
  let artifactUpload = null;
  try {
    artifactUpload = authenticateWorkflowArtifactUpload(
      workflowBytes.toString('utf8'),
      expectedWorkflowJob,
      expectedArtifactName,
    );
  } catch (error) {
    findings.push(error instanceof Error ? error.message : String(error));
  }
  return {
    facts: {
      apiUrl,
      artifactUpload,
      contentDigest: sha256Bytes(workflowBytes),
      gitBlobSha: metadata?.sha ?? null,
      workflowSha: workflowSha ?? null,
    },
    findings,
  };
}

function decodeGitHubFileContent(metadata, findings) {
  const content = metadata?.content;
  if (typeof content !== 'string') {
    findings.push('workflow file API content is unavailable');
    return Buffer.alloc(0);
  }
  const compact = content.replace(/[\r\n]/gu, '');
  if (
    compact.length === 0 ||
    compact.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(compact)
  ) {
    findings.push('workflow file API content is not canonical base64');
    return Buffer.alloc(0);
  }
  const bytes = Buffer.from(compact, 'base64');
  if (bytes.length > MAX_API_RESPONSE_BYTES || bytes.toString('base64') !== compact) {
    findings.push('workflow file API content is non-canonical or exceeds the safety bound');
    return Buffer.alloc(0);
  }
  return bytes;
}

function workflowJobCondition(workflow, jobKey) {
  const job = workflowJobBlock(workflow, jobKey);
  const folded = /^    if: >-\n((?:      .*\n)+)/gmu.exec(job);
  const literal = /^    if: (\$\{\{ [^\r\n]+ \}\})$/gmu.exec(job);
  const conditions = [...job.matchAll(/^    if:/gmu)];
  if (conditions.length !== 1 || (folded === null && literal === null)) {
    throw new TypeError(`workflow job ${jobKey} has no unique supported if condition`);
  }
  if (literal !== null) return literal[1];
  return folded[1]
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');
}

function workflowJobBlock(workflow, jobKey) {
  if (workflow.includes('\t') || workflow.includes('\r')) {
    throw new TypeError('trusted workflow uses unsupported indentation');
  }
  const marker = `  ${jobKey}:\n`;
  const start = workflow.indexOf(marker);
  if (start === -1 || workflow.indexOf(marker, start + marker.length) !== -1) {
    throw new TypeError(`workflow job ${jobKey} is unavailable or duplicated`);
  }
  const tail = workflow.slice(start + marker.length);
  const next = /^  [A-Za-z0-9_-]+:\n/gmu.exec(tail);
  return next === null ? tail : tail.slice(0, next.index);
}

function authenticateWorkflowArtifactUpload(workflow, expectedWorkflowJob, expectedArtifactName) {
  const blocks = workflowJobBlocks(workflow);
  const uploads = blocks.flatMap(({ job, source }) =>
    workflowUploadArtifactSteps(source).map((upload) => ({ ...upload, job })),
  );
  const candidates = uploads.filter(
    ({ name }) => name === expectedWorkflowJob.artifact.name || name === expectedArtifactName,
  );
  const exact = candidates.filter(
    ({ action, always, job, name, path: artifactPath }) =>
      action === UPLOAD_ARTIFACT_ACTION &&
      always === true &&
      job === expectedWorkflowJob.key &&
      name === expectedWorkflowJob.artifact.name &&
      artifactPath === expectedWorkflowJob.artifact.path,
  );
  if (exact.length !== 1 || candidates.length !== 1) {
    throw new TypeError(
      `workflow job ${expectedWorkflowJob.key} does not uniquely own the reviewed ${expectedWorkflowJob.artifact.name} upload`,
    );
  }
  return {
    action: exact[0].action,
    concreteName: expectedArtifactName,
    job: exact[0].job,
    name: exact[0].name,
    path: exact[0].path,
  };
}

function workflowJobBlocks(workflow) {
  const marker = '\njobs:\n';
  const start = workflow.indexOf(marker);
  if (start === -1 || workflow.indexOf(marker, start + marker.length) !== -1) {
    throw new TypeError('trusted workflow has no unique jobs mapping');
  }
  const tail = workflow.slice(start + marker.length);
  const nextTopLevel = /^[A-Za-z0-9_-]+:\n/gmu.exec(tail);
  const jobsSource = nextTopLevel === null ? tail : tail.slice(0, nextTopLevel.index);
  const matches = [...jobsSource.matchAll(/^  ([A-Za-z0-9_-]+):\n/gmu)];
  if (matches.length < 1) throw new TypeError('trusted workflow job census is empty');
  return matches.map((match, index) => ({
    job: match[1],
    source: jobsSource.slice(
      match.index + match[0].length,
      matches[index + 1]?.index ?? jobsSource.length,
    ),
  }));
}

function workflowUploadArtifactSteps(jobSource) {
  const starts = [...jobSource.matchAll(/^      - /gmu)];
  const uploads = [];
  for (const [index, start] of starts.entries()) {
    const step = jobSource.slice(start.index, starts[index + 1]?.index ?? jobSource.length);
    const actionMatches = [
      ...step.matchAll(/^(?:      - uses|        uses): (actions\/upload-artifact@\S+)$/gmu),
    ];
    const mentions = [...step.matchAll(/^\s+(?:- )?uses: actions\/upload-artifact@\S+$/gmu)];
    if (mentions.length === 0) continue;
    if (mentions.length !== 1 || actionMatches.length !== 1) {
      throw new TypeError('trusted workflow uses an unsupported upload-artifact step shape');
    }
    const names = [...step.matchAll(/^          name: (\S.*)$/gmu)];
    const paths = [...step.matchAll(/^          path: (\S.*)$/gmu)];
    if (names.length !== 1 || paths.length !== 1) {
      throw new TypeError('trusted workflow upload-artifact step has no unique name and path');
    }
    uploads.push({
      action: actionMatches[0][1],
      always: /^        if: always\(\)$/mu.test(step),
      name: names[0][1],
      path: paths[0][1],
    });
  }
  return uploads;
}

function gitBlobDigest(bytes) {
  return createHash('sha1')
    .update(`blob ${String(bytes.length)}\0`)
    .update(bytes)
    .digest('hex');
}

function sourceCommitMatchesRun(run, sourceSha) {
  if (!COMMIT_PATTERN.test(sourceSha ?? '')) return false;
  return run?.head_sha === sourceSha;
}

function validWorkflowReference(value, repository, event, runMetadata) {
  const prefix = `${repository}/${PERF_REALISTIC_WORKFLOW_PATH}@`;
  if (!nonEmptyString(value) || !value.startsWith(prefix)) return false;
  const ref = value.slice(prefix.length);
  if (event === 'pull_request') {
    const pullRequests = Array.isArray(runMetadata?.pull_requests) ? runMetadata.pull_requests : [];
    if (
      pullRequests.length !== 1 ||
      !Number.isSafeInteger(pullRequests[0]?.number) ||
      pullRequests[0].number < 1
    ) {
      return false;
    }
    return ref === `refs/pull/${String(pullRequests[0].number)}/merge`;
  }
  if (!nonEmptyString(runMetadata?.head_branch)) return false;
  return (
    ref === `refs/heads/${runMetadata.head_branch}` ||
    (event === 'workflow_dispatch' && ref === `refs/tags/${runMetadata.head_branch}`)
  );
}

function validateExpectedWorkflowJob(value) {
  if (
    !ownRecord(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify(['artifact', 'key', 'name', 'triggerPolicy']) ||
    !/^[a-z0-9-]+$/u.test(value.key ?? '') ||
    !nonEmptyString(value.name) ||
    !Object.hasOwn(WORKFLOW_TRIGGER_POLICIES, value.triggerPolicy) ||
    !ownRecord(value.artifact) ||
    JSON.stringify(Object.keys(value.artifact).sort()) !== JSON.stringify(['name', 'path']) ||
    !nonEmptyString(value.artifact.name) ||
    !nonEmptyString(value.artifact.path) ||
    value.artifact.name.trim() !== value.artifact.name ||
    value.artifact.path.trim() !== value.artifact.path
  ) {
    throw new TypeError(
      'expected workflow job must contain exact artifact, key, name, and reviewed triggerPolicy fields',
    );
  }
}

function validateAllowedProducerJobConclusions(value, failureStep, requiredSuccessSteps) {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 2 ||
    new Set(value).size !== value.length ||
    value.some((conclusion) => !['failure', 'success'].includes(conclusion)) ||
    (value.includes('failure')
      ? !nonEmptyString(failureStep) ||
        failureStep.trim() !== failureStep ||
        !Array.isArray(requiredSuccessSteps) ||
        requiredSuccessSteps.length !== 2 ||
        new Set(requiredSuccessSteps).size !== requiredSuccessSteps.length ||
        requiredSuccessSteps.some(
          (step) => !nonEmptyString(step) || step.trim() !== step || step === failureStep,
        )
      : failureStep !== null ||
        !Array.isArray(requiredSuccessSteps) ||
        requiredSuccessSteps.length !== 0)
  ) {
    throw new TypeError(
      'allowed producer conclusions and ordered failure-step authorization are malformed',
    );
  }
}

function validateWorkflowRunFetchIdentity(repository, workflowRunId) {
  if (!REPOSITORY_PATTERN.test(repository ?? '')) {
    throw new TypeError('repository must be an exact owner/name identity');
  }
  positiveInteger(workflowRunId, 'workflow run id');
}

function parseJsonBytes(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new TypeError(`${label} is not valid JSON`);
  }
}

/**
 * GitHub embeds mutable current-PR data in historical run responses. Custody compares only the
 * immutable authority projection used by the gate while retaining the raw response digest for
 * audit. This lets a later PR push change pull_requests[].head.sha without rewriting history.
 */
function artifactAuthorityProjection(value) {
  return {
    archive_download_url: value?.archive_download_url ?? null,
    created_at: value?.created_at ?? null,
    digest: value?.digest ?? null,
    expired: value?.expired ?? null,
    expires_at: value?.expires_at ?? null,
    id: value?.id ?? null,
    name: value?.name ?? null,
    node_id: value?.node_id ?? null,
    size_in_bytes: value?.size_in_bytes ?? null,
    updated_at: value?.updated_at ?? null,
    url: value?.url ?? null,
    workflow_run: {
      head_branch: value?.workflow_run?.head_branch ?? null,
      head_repository_id: value?.workflow_run?.head_repository_id ?? null,
      head_sha: value?.workflow_run?.head_sha ?? null,
      id: value?.workflow_run?.id ?? null,
      repository_id: value?.workflow_run?.repository_id ?? null,
    },
  };
}

function workflowRunAuthorityProjection(value) {
  const pullRequests = Array.isArray(value?.pull_requests) ? value.pull_requests : [];
  return {
    conclusion: value?.conclusion ?? null,
    created_at: value?.created_at ?? null,
    event: value?.event ?? null,
    head_branch: value?.head_branch ?? null,
    head_commit: { id: value?.head_commit?.id ?? null },
    head_repository: {
      full_name: value?.head_repository?.full_name ?? null,
      id: value?.head_repository?.id ?? null,
    },
    head_sha: value?.head_sha ?? null,
    html_url: value?.html_url ?? null,
    id: value?.id ?? null,
    jobs_url: value?.jobs_url ?? null,
    name: value?.name ?? null,
    path: value?.path ?? null,
    pull_requests: pullRequests
      .map((pullRequest) => ({
        id: pullRequest?.id ?? null,
        number: pullRequest?.number ?? null,
        url: pullRequest?.url ?? null,
      }))
      .sort((left, right) => Number(left.id) - Number(right.id)),
    repository: {
      full_name: value?.repository?.full_name ?? null,
      id: value?.repository?.id ?? null,
    },
    run_attempt: value?.run_attempt ?? null,
    run_number: value?.run_number ?? null,
    run_started_at: value?.run_started_at ?? null,
    status: value?.status ?? null,
    updated_at: value?.updated_at ?? null,
    url: value?.url ?? null,
    workflow_id: value?.workflow_id ?? null,
  };
}

function workflowJobsAuthorityProjection(value) {
  const jobs = Array.isArray(value?.jobs) ? value.jobs : [];
  return {
    jobs: jobs
      .map((job) => ({
        completed_at: job?.completed_at ?? null,
        conclusion: job?.conclusion ?? null,
        head_branch: job?.head_branch ?? null,
        head_sha: job?.head_sha ?? null,
        html_url: job?.html_url ?? null,
        id: job?.id ?? null,
        name: job?.name ?? null,
        node_id: job?.node_id ?? null,
        run_attempt: job?.run_attempt ?? null,
        run_id: job?.run_id ?? null,
        steps: Array.isArray(job?.steps)
          ? job.steps
              .map((step) => ({
                completed_at: step?.completed_at ?? null,
                conclusion: step?.conclusion ?? null,
                name: step?.name ?? null,
                number: step?.number ?? null,
                started_at: step?.started_at ?? null,
                status: step?.status ?? null,
              }))
              .sort((left, right) => Number(left.number) - Number(right.number))
          : null,
        started_at: job?.started_at ?? null,
        status: job?.status ?? null,
        url: job?.url ?? null,
        workflow_name: job?.workflow_name ?? null,
      }))
      .sort((left, right) => Number(left.id) - Number(right.id)),
    total_count: value?.total_count ?? null,
  };
}

function sha256Authority(value) {
  return sha256Bytes(Buffer.from(JSON.stringify(value), 'utf8'));
}

async function fetchLiveApiBytes(fetchApi, identity) {
  const bytes = Buffer.from(await fetchApi(identity));
  if (bytes.length < 1 || bytes.length > MAX_API_RESPONSE_BYTES) {
    throw new TypeError('live API response is empty or exceeds the safety bound');
  }
  return bytes;
}

/** Read and authenticate one bounded regular-file member from a single-disk ZIP archive. */
export function readZipMember(archiveBytes, memberName) {
  if (!safeZipPath(memberName)) throw new TypeError('ZIP member name is unsafe');
  const entry = authenticateZipArchive(archiveBytes).find(({ member }) => member === memberName);
  if (entry === undefined) throw new TypeError(`ZIP member ${memberName} is unavailable`);
  return entry.bytes;
}

function authenticateZipArchive(archiveBytes) {
  if (!Buffer.isBuffer(archiveBytes)) throw new TypeError('ZIP archive must be a Buffer');
  if (archiveBytes.length > MAX_ARCHIVE_BYTES) {
    throw new TypeError('ZIP archive exceeds the safety bound');
  }
  const entries = zipEntryCensus(archiveBytes);
  return entries
    .map((entry) => {
      const bytes = inflateSelectedMember(archiveBytes, entry);
      return {
        byteLength: bytes.length,
        bytes,
        compressedByteLength: entry.compressedSize,
        compressionMethod: entry.method,
        contentDigest: sha256Bytes(bytes),
        crc32: `crc32:${entry.checksum.toString(16).padStart(8, '0')}`,
        member: entry.name,
      };
    })
    .sort((left, right) => left.member.localeCompare(right.member));
}

function zipEntryCensus(archiveBytes) {
  const eocdOffset = findEndOfCentralDirectory(archiveBytes);
  const diskNumber = archiveBytes.readUInt16LE(eocdOffset + 4);
  const centralDisk = archiveBytes.readUInt16LE(eocdOffset + 6);
  const diskEntries = archiveBytes.readUInt16LE(eocdOffset + 8);
  const totalEntries = archiveBytes.readUInt16LE(eocdOffset + 10);
  const centralSize = archiveBytes.readUInt32LE(eocdOffset + 12);
  const centralOffset = archiveBytes.readUInt32LE(eocdOffset + 16);
  if (
    diskNumber !== 0 ||
    centralDisk !== 0 ||
    diskEntries !== totalEntries ||
    totalEntries === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw new TypeError('ZIP64 or multi-disk artifacts are unsupported');
  }
  if (totalEntries < 1 || totalEntries > MAX_ZIP_ENTRIES) {
    throw new TypeError('ZIP entry census is empty or exceeds the safety bound');
  }
  if (centralOffset + centralSize !== eocdOffset) {
    throw new TypeError('ZIP central directory bounds are inconsistent');
  }

  const names = new Set();
  const entries = [];
  let offset = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    requireBounds(archiveBytes, offset, 46, 'ZIP central directory entry');
    if (archiveBytes.readUInt32LE(offset) !== 0x02014b50) {
      throw new TypeError('ZIP central directory signature is invalid');
    }
    const flags = archiveBytes.readUInt16LE(offset + 8);
    const method = archiveBytes.readUInt16LE(offset + 10);
    const checksum = archiveBytes.readUInt32LE(offset + 16);
    const compressedSize = archiveBytes.readUInt32LE(offset + 20);
    const uncompressedSize = archiveBytes.readUInt32LE(offset + 24);
    const nameLength = archiveBytes.readUInt16LE(offset + 28);
    const extraLength = archiveBytes.readUInt16LE(offset + 30);
    const commentLength = archiveBytes.readUInt16LE(offset + 32);
    const startDisk = archiveBytes.readUInt16LE(offset + 34);
    const localOffset = archiveBytes.readUInt32LE(offset + 42);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    requireBounds(archiveBytes, offset, recordLength, 'ZIP central directory record');
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff ||
      startDisk !== 0
    ) {
      throw new TypeError('ZIP64 or multi-disk entries are unsupported');
    }
    if ((flags & 0x0001) !== 0) throw new TypeError('encrypted ZIP entries are unsupported');
    const nameBytes = archiveBytes.subarray(offset + 46, offset + 46 + nameLength);
    const name = decodeZipName(nameBytes);
    if (!safeZipPath(name)) throw new TypeError(`unsafe ZIP member path ${JSON.stringify(name)}`);
    if (names.has(name)) throw new TypeError(`duplicate ZIP member ${name}`);
    names.add(name);
    entries.push({ checksum, compressedSize, flags, localOffset, method, name, uncompressedSize });
    offset += recordLength;
  }
  if (offset !== eocdOffset) throw new TypeError('ZIP central directory census is inconsistent');
  const uncompressedBytes = entries.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
  if (entries.some(({ uncompressedSize }) => uncompressedSize > MAX_REPORT_BYTES)) {
    throw new TypeError('ZIP member exceeds the per-member size bound');
  }
  if (!Number.isSafeInteger(uncompressedBytes) || uncompressedBytes > MAX_ARCHIVE_BYTES) {
    throw new TypeError('ZIP member census exceeds the aggregate uncompressed-size bound');
  }
  return entries;
}

function resolveExpectedAuxiliaryMembers(
  archiveCensus,
  { expectedAuxiliaryMember, expectedAuxiliaryMemberGroup, expectedAuxiliaryMembers },
) {
  if (expectedAuxiliaryMember !== undefined) return [expectedAuxiliaryMember];
  const fixed = expectedAuxiliaryMembers ?? [];
  if (expectedAuxiliaryMemberGroup === undefined) return [...fixed];
  const matches = archiveCensus
    .map(({ member }) => member)
    .filter(
      (name) =>
        name.startsWith(expectedAuxiliaryMemberGroup.prefix) &&
        name.endsWith(expectedAuxiliaryMemberGroup.suffix),
    )
    .sort((left, right) => left.localeCompare(right));
  if (matches.length === 0) {
    throw new TypeError('ZIP auxiliary member group is empty');
  }
  const combined = [...fixed, ...matches];
  if (combined.length > MAX_AUXILIARY_MEMBERS || new Set(combined).size !== combined.length) {
    throw new TypeError('ZIP auxiliary member census is duplicated or exceeds the safety bound');
  }
  return combined;
}

function validateExpectedAuxiliaryMembers({
  expectedAuxiliaryMember,
  expectedAuxiliaryMemberGroup,
  expectedAuxiliaryMembers,
  expectedReportMember,
}) {
  const hasSingular = expectedAuxiliaryMember !== undefined;
  const hasFixed = expectedAuxiliaryMembers !== undefined;
  const hasGroup = expectedAuxiliaryMemberGroup !== undefined;
  if (hasSingular && (hasFixed || hasGroup)) {
    throw new TypeError('singular and grouped auxiliary ZIP member selection cannot be combined');
  }
  if (
    hasSingular &&
    (!safeZipPath(expectedAuxiliaryMember) || expectedAuxiliaryMember === expectedReportMember)
  ) {
    throw new TypeError('expected auxiliary member must be a distinct safe ZIP path');
  }
  if (
    hasFixed &&
    (!Array.isArray(expectedAuxiliaryMembers) ||
      expectedAuxiliaryMembers.length < 1 ||
      expectedAuxiliaryMembers.length > MAX_AUXILIARY_MEMBERS ||
      expectedAuxiliaryMembers.some(
        (member) => !safeZipPath(member) || member === expectedReportMember,
      ) ||
      new Set(expectedAuxiliaryMembers).size !== expectedAuxiliaryMembers.length)
  ) {
    throw new TypeError('expected auxiliary members must be distinct safe ZIP paths');
  }
  if (
    hasGroup &&
    (!ownRecord(expectedAuxiliaryMemberGroup) ||
      JSON.stringify(Object.keys(expectedAuxiliaryMemberGroup).sort()) !==
        JSON.stringify(['prefix', 'suffix']) ||
      !safeZipMemberFragment(expectedAuxiliaryMemberGroup.prefix) ||
      !safeZipMemberFragment(expectedAuxiliaryMemberGroup.suffix))
  ) {
    throw new TypeError('expected auxiliary member group must contain a safe prefix and suffix');
  }
}

function validateExpectedArchiveMembers(value, expectedReportMember) {
  if (value === undefined) return;
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAX_ZIP_ENTRIES ||
    value.some((member) => !safeZipPath(member)) ||
    new Set(value).size !== value.length ||
    !value.includes(expectedReportMember)
  ) {
    throw new TypeError(
      'expected archive members must be a distinct safe census containing the report member',
    );
  }
}

/**
 * One gate invocation owns one registry. Every descriptor path and inode is single-use except the
 * explicitly named build-profile ZIP, which is intentionally read once for each member report.
 */
export async function createPerformanceArtifactDescriptorCustody({
  baseDirectory = process.cwd(),
} = {}) {
  const requestedRoot = path.resolve(baseDirectory);
  const [facts, resolvedRoot] = await Promise.all([lstat(requestedRoot), realpath(requestedRoot)]);
  if (!facts.isDirectory() || facts.isSymbolicLink()) {
    throw new TypeError('artifact custody base directory must be one real directory');
  }
  return {
    baseDirectory: resolvedRoot,
    inodes: new Map(),
    paths: new Map(),
  };
}

export async function readPerformanceArtifactCustodyFile(
  relativePath,
  { custody, descriptorKey, label, maximumBytes = MAX_API_RESPONSE_BYTES, readHook, shareGroup },
) {
  if (!validDescriptorRelativePath(relativePath)) {
    throw new TypeError(`${String(descriptorKey)} is not a canonical safe relative path`);
  }
  if (
    !ownRecord(custody) ||
    !nonEmptyString(custody.baseDirectory) ||
    !(custody.paths instanceof Map) ||
    !(custody.inodes instanceof Map)
  ) {
    throw new TypeError('shared artifact descriptor custody registry is required');
  }
  if (!nonEmptyString(descriptorKey) || !nonEmptyString(label)) {
    throw new TypeError('artifact descriptor key and label are required');
  }
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new TypeError('artifact custody byte bound is invalid');
  }
  if (
    shareGroup !== undefined &&
    (descriptorKey !== 'archive' || shareGroup !== 'build-profile-archive')
  ) {
    throw new TypeError('only the exact build-profile archive may use shared descriptor custody');
  }
  const file = path.resolve(custody.baseDirectory, ...relativePath.split('/'));
  if (!containedBy(custody.baseDirectory, file)) {
    throw new TypeError(`${label} escapes its custody root`);
  }
  const beforePath = await lstat(file);
  if (
    !beforePath.isFile() ||
    beforePath.isSymbolicLink() ||
    beforePath.nlink !== 1 ||
    beforePath.size < 1 ||
    beforePath.size > maximumBytes
  ) {
    throw new TypeError(`${label} is not a bounded regular file with unique inode custody`);
  }
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const [beforeHandle, resolvedPath] = await Promise.all([handle.stat(), realpath(file)]);
    if (
      resolvedPath !== file ||
      !sameStableFile(beforePath, beforeHandle) ||
      beforeHandle.nlink !== 1
    ) {
      throw new TypeError(`${label} changed, aliases another inode, or is reached through a link`);
    }
    const bytes = await handle.readFile();
    if (bytes.length !== beforeHandle.size || bytes.length < 1 || bytes.length > maximumBytes) {
      throw new TypeError(`${label} changed or exceeded its bound while being read`);
    }
    if (readHook !== undefined) {
      if (typeof readHook !== 'function') throw new TypeError('descriptor read hook is invalid');
      await readHook({ descriptorKey, file, relativePath });
    }
    const [afterHandle, afterPath, afterResolvedPath] = await Promise.all([
      handle.stat(),
      lstat(file),
      realpath(file),
    ]);
    if (
      afterResolvedPath !== file ||
      afterPath.isSymbolicLink() ||
      afterPath.nlink !== 1 ||
      !sameStableFile(beforeHandle, afterHandle) ||
      !sameStableFile(beforeHandle, afterPath)
    ) {
      throw new TypeError(`${label} changed while being read`);
    }
    registerDescriptorCustody(custody, {
      descriptorKey,
      file,
      inode: `${String(afterHandle.dev)}:${String(afterHandle.ino)}`,
      shareGroup,
    });
    return bytes;
  } finally {
    await handle?.close();
  }
}

function registerDescriptorCustody(custody, facts) {
  const byPath = custody.paths.get(facts.file);
  const byInode = custody.inodes.get(facts.inode);
  if (byPath === undefined && byInode === undefined) {
    const entry = { ...facts, uses: 1 };
    custody.paths.set(facts.file, entry);
    custody.inodes.set(facts.inode, entry);
    return;
  }
  if (
    byPath === undefined ||
    byInode === undefined ||
    byPath !== byInode ||
    byPath.descriptorKey !== 'archive' ||
    facts.descriptorKey !== 'archive' ||
    byPath.shareGroup !== 'build-profile-archive' ||
    facts.shareGroup !== 'build-profile-archive' ||
    byPath.uses !== 1
  ) {
    throw new TypeError('artifact descriptor path or inode aliases another custody file');
  }
  byPath.uses += 1;
}

function sameStableFile(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function containedBy(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function validDescriptorRelativePath(value) {
  return (
    nonEmptyString(value) &&
    value.trim() === value &&
    !path.isAbsolute(value) &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    value.split('/').every((part) => part !== '' && part !== '.' && part !== '..') &&
    path.posix.normalize(value) === value
  );
}

async function readBoundedRegularFile(file, maximumBytes, label) {
  const facts = await stat(file);
  if (!facts.isFile() || facts.size < 1 || facts.size > maximumBytes) {
    throw new TypeError(`${label} is not a bounded regular file`);
  }
  const bytes = await readFile(file);
  if (bytes.length < 1 || bytes.length > maximumBytes) {
    throw new TypeError(`${label} exceeds the safety bound while being read`);
  }
  return bytes;
}

function inflateSelectedMember(archiveBytes, entry) {
  requireBounds(archiveBytes, entry.localOffset, 30, 'ZIP local header');
  if (archiveBytes.readUInt32LE(entry.localOffset) !== 0x04034b50) {
    throw new TypeError('ZIP local header signature is invalid');
  }
  const localFlags = archiveBytes.readUInt16LE(entry.localOffset + 6);
  const localMethod = archiveBytes.readUInt16LE(entry.localOffset + 8);
  const localChecksum = archiveBytes.readUInt32LE(entry.localOffset + 14);
  const localCompressedSize = archiveBytes.readUInt32LE(entry.localOffset + 18);
  const localUncompressedSize = archiveBytes.readUInt32LE(entry.localOffset + 22);
  const nameLength = archiveBytes.readUInt16LE(entry.localOffset + 26);
  const extraLength = archiveBytes.readUInt16LE(entry.localOffset + 28);
  const dataOffset = entry.localOffset + 30 + nameLength + extraLength;
  requireBounds(archiveBytes, entry.localOffset, 30 + nameLength + extraLength, 'ZIP local record');
  const localName = decodeZipName(
    archiveBytes.subarray(entry.localOffset + 30, entry.localOffset + 30 + nameLength),
  );
  if (
    localName !== entry.name ||
    localFlags !== entry.flags ||
    localMethod !== entry.method ||
    ((entry.flags & 0x0008) === 0 &&
      (localChecksum !== entry.checksum ||
        localCompressedSize !== entry.compressedSize ||
        localUncompressedSize !== entry.uncompressedSize))
  ) {
    throw new TypeError('ZIP local and central member identities differ');
  }
  requireBounds(archiveBytes, dataOffset, entry.compressedSize, 'ZIP member data');
  const compressed = archiveBytes.subarray(dataOffset, dataOffset + entry.compressedSize);
  let bytes;
  try {
    if (entry.method === 0) bytes = Buffer.from(compressed);
    else if (entry.method === 8) {
      bytes = inflateRawSync(compressed, { maxOutputLength: MAX_REPORT_BYTES });
    } else throw new TypeError(`unsupported ZIP compression method ${String(entry.method)}`);
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError(`ZIP member ${entry.name} cannot be decompressed`);
  }
  if (bytes.length !== entry.uncompressedSize) {
    throw new TypeError(`ZIP member ${entry.name} uncompressed size differs`);
  }
  if (crc32(bytes) !== entry.checksum) {
    throw new TypeError(`ZIP member ${entry.name} CRC-32 differs`);
  }
  return bytes;
}

function findEndOfCentralDirectory(bytes) {
  if (bytes.length < 22) throw new TypeError('ZIP archive is truncated');
  const first = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= first; offset -= 1) {
    if (
      bytes.readUInt32LE(offset) === 0x06054b50 &&
      offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length
    ) {
      return offset;
    }
  }
  throw new TypeError('ZIP end-of-central-directory record is unavailable');
}

function requireBounds(bytes, offset, length, label) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > bytes.length
  ) {
    throw new TypeError(`${label} exceeds archive bounds`);
  }
}

function decodeZipName(bytes) {
  const value = bytes.toString('utf8');
  if (!Buffer.from(value, 'utf8').equals(bytes))
    throw new TypeError('ZIP member name is not UTF-8');
  return value;
}

function safeZipPath(value) {
  return (
    nonEmptyString(value) &&
    value.trim() === value &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    !value.startsWith('/') &&
    !value.endsWith('/') &&
    value.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
  );
}

function safeZipMemberFragment(value) {
  return (
    nonEmptyString(value) &&
    value.trim() === value &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    !value.includes('..')
  );
}

function validateEvidenceDescriptor(value) {
  if (!ownRecord(value)) throw new TypeError('artifact evidence descriptor must be an object');
  const expected = ['apiMetadata', 'archive', 'jobsApiMetadata', 'report', 'runApiMetadata'];
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected)) {
    throw new TypeError(
      'artifact evidence descriptor must contain only apiMetadata, archive, jobsApiMetadata, report, runApiMetadata',
    );
  }
  for (const key of expected) {
    if (!validDescriptorRelativePath(value[key])) {
      throw new TypeError(`${key} is not a canonical safe relative path`);
    }
  }
  if (new Set(expected.map((key) => value[key])).size !== expected.length) {
    throw new TypeError('artifact evidence descriptor paths must be distinct');
  }
}

function validTimestamp(value, label, findings) {
  const milliseconds = Date.parse(value ?? '');
  if (!nonEmptyString(value) || !Number.isFinite(milliseconds)) {
    findings.push(`${label} is unavailable`);
    return Number.NaN;
  }
  return milliseconds;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} is unavailable`);
  return value;
}

function ownRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function sha256Bytes(value) {
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
