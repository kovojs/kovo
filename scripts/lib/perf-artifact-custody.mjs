import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { inflateRawSync } from 'node:zlib';

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const GIT_BLOB_PATTERN = /^[0-9a-f]{40}$/u;
export const PERF_REALISTIC_WORKFLOW_PATH = '.github/workflows/perf-realistic.yml';
const PERF_REALISTIC_WORKFLOW_NAME = 'Perf Realistic Tier';
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
    expectedArtifactName,
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
  validateExpectedWorkflowJob(expectedWorkflowJob);

  const apiPath = path.resolve(baseDirectory, evidence.apiMetadata);
  const archivePath = path.resolve(baseDirectory, evidence.archive);
  const jobsApiPath = path.resolve(baseDirectory, evidence.jobsApiMetadata);
  const reportPath = path.resolve(baseDirectory, evidence.report);
  const runApiPath = path.resolve(baseDirectory, evidence.runApiMetadata);
  const [apiBytes, archiveBytes, jobsApiBytes, reportBytes, runApiBytes] = await Promise.all([
    readBoundedRegularFile(apiPath, MAX_API_RESPONSE_BYTES, 'artifact API metadata'),
    readBoundedRegularFile(archivePath, MAX_ARCHIVE_BYTES, 'artifact ZIP'),
    readBoundedRegularFile(jobsApiPath, MAX_API_RESPONSE_BYTES, 'workflow jobs API metadata'),
    readBoundedRegularFile(reportPath, MAX_REPORT_BYTES, 'extracted performance report'),
    readBoundedRegularFile(runApiPath, MAX_API_RESPONSE_BYTES, 'workflow run API metadata'),
  ]);
  const metadata = parseJsonBytes(apiBytes, 'artifact API metadata');
  const jobsMetadata = parseJsonBytes(jobsApiBytes, 'workflow jobs API metadata');
  const report = parseJsonBytes(reportBytes, 'extracted performance report');
  const runMetadata = parseJsonBytes(runApiBytes, 'workflow run API metadata');

  const archiveDigest = sha256Bytes(archiveBytes);
  const reportContentDigest = sha256Bytes(reportBytes);
  const memberBytes = readZipMember(archiveBytes, expectedReportMember);
  if (!memberBytes.equals(reportBytes)) {
    throw new TypeError(`extracted report bytes differ from ZIP member ${expectedReportMember}`);
  }
  const auxiliaryNames = resolveExpectedAuxiliaryMembers(archiveBytes, {
    expectedAuxiliaryMember,
    expectedAuxiliaryMemberGroup,
    expectedAuxiliaryMembers,
  });
  const auxiliaries = readZipMembers(archiveBytes, auxiliaryNames);

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
  const workflowHeadSha = runMetadata?.head_sha;
  const sourceSha = report?.source?.commit;
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
          workflowHeadSha,
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
  for (const [label, liveBytes, savedBytes] of [
    ['artifact', liveApiBytes, apiBytes],
    ['workflow jobs', liveJobsApiBytes, jobsApiBytes],
    ['workflow run', liveRunApiBytes, runApiBytes],
  ]) {
    if (!liveBytes.equals(savedBytes)) {
      throw new TypeError(
        `saved ${label} API response differs byte-for-byte from the live response`,
      );
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
  if (!Number.isSafeInteger(metadata?.download_count) || metadata.download_count < 1) {
    findings.push('artifact API record does not prove the retained ZIP was downloaded');
  }
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
    workflowHeadSha,
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
      apiUrl,
      archiveDigest,
      archiveDownloadUrl,
      artifactId,
      artifactName: metadata.name,
      createdAt: metadata.created_at,
      downloadCount: metadata.download_count,
      expiresAt: metadata.expires_at,
      jobsApiResponseDigest: sha256Bytes(jobsApiBytes),
      jobsApiUrl,
      liveApiResponseDigest: sha256Bytes(liveApiBytes),
      liveJobsApiResponseDigest: sha256Bytes(liveJobsApiBytes),
      liveRunApiResponseDigest: sha256Bytes(liveRunApiBytes),
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

/** Fetch the bounded all-attempt job census used to prove the exact successful matrix job. */
export async function fetchGitHubWorkflowJobsApiResponse({ repository, workflowRunId }) {
  validateWorkflowRunFetchIdentity(repository, workflowRunId);
  return fetchGitHubApiResponse(
    `repos/${repository}/actions/runs/${String(workflowRunId)}/jobs?filter=all&per_page=100`,
    'workflow jobs',
  );
}

/** Fetch the exact workflow file at the workflow-run event SHA. */
export async function fetchGitHubWorkflowFileApiResponse({ repository, workflowHeadSha }) {
  if (!REPOSITORY_PATTERN.test(repository ?? '')) {
    throw new TypeError('repository must be an exact owner/name identity');
  }
  if (!COMMIT_PATTERN.test(workflowHeadSha ?? '')) {
    throw new TypeError('workflow head SHA is unavailable');
  }
  return fetchGitHubApiResponse(
    `repos/${repository}/contents/${PERF_REALISTIC_WORKFLOW_PATH}?ref=${workflowHeadSha}`,
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
  const [{ stdout: headOutput }, { stdout: statusOutput }, bytes] = await Promise.all([
    execFileAsync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: MAX_API_RESPONSE_BYTES,
      timeout: 30_000,
    }),
    execFileAsync(
      'git',
      ['status', '--porcelain=v1', '--untracked-files=all', '--', PERF_REALISTIC_WORKFLOW_PATH],
      {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: MAX_API_RESPONSE_BYTES,
        timeout: 30_000,
      },
    ),
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
    throw new TypeError('trusted local performance workflow has uncommitted changes');
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
  workflowHeadSha,
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
    expectedWorkflowJob,
    repository,
    sourceSha,
    trustedWorkflow,
    workflowApiBytes,
    workflowHeadSha,
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
    headRepositoryId < 1
  ) {
    findings.push('workflow run repository or head repository is not canonical');
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
  if (runMetadata?.status !== 'completed' || runMetadata?.conclusion !== 'success') {
    findings.push('workflow run is not completed successfully');
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
    (event !== 'pull_request' && github?.eventSha !== runHeadSha) ||
    github?.sha !== sourceSha ||
    github?.repository !== repository ||
    github?.serverUrl !== 'https://github.com' ||
    github?.runUrl !== runUrl ||
    String(github?.runId ?? '') !== String(workflowRunId) ||
    String(github?.runAttempt ?? '') !== String(runAttempt) ||
    github?.job !== expectedWorkflowJob.key ||
    !validWorkflowReference(github?.workflowRef, repository)
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
  if (
    job !== null &&
    (!Number.isSafeInteger(jobId) ||
      jobId < 1 ||
      job.run_id !== workflowRunId ||
      job.run_attempt !== runAttempt ||
      job.head_sha !== runHeadSha ||
      job.status !== 'completed' ||
      job.conclusion !== 'success' ||
      job.url !== `https://api.github.com/repos/${repository}/actions/jobs/${String(jobId)}`)
  ) {
    findings.push('expected workflow family job is not an exact successful job in the live run');
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
        id: jobId ?? null,
        key: expectedWorkflowJob.key,
        name: expectedWorkflowJob.name,
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
      workflowApiUrl: workflowDefinition.facts.apiUrl,
      workflowContentDigest: workflowDefinition.facts.contentDigest,
      workflowGitBlobSha: workflowDefinition.facts.gitBlobSha,
      workflowHeadSha: workflowDefinition.facts.headSha,
    },
    findings,
  };
}

function authenticateWorkflowDefinition({
  expectedWorkflowJob,
  repository,
  sourceSha,
  trustedWorkflow,
  workflowApiBytes,
  workflowHeadSha,
}) {
  const findings = [];
  const metadata = parseJsonBytes(workflowApiBytes, 'workflow file API metadata');
  const apiUrl = `https://api.github.com/repos/${repository}/contents/${PERF_REALISTIC_WORKFLOW_PATH}?ref=${String(workflowHeadSha)}`;
  const workflowBytes = decodeGitHubFileContent(metadata, findings);
  const gitBlobSha = gitBlobDigest(workflowBytes);
  const expectedRawUrl = `https://raw.githubusercontent.com/${repository}/${String(workflowHeadSha)}/${PERF_REALISTIC_WORKFLOW_PATH}`;
  const expectedHtmlUrl = `https://github.com/${repository}/blob/${String(workflowHeadSha)}/${PERF_REALISTIC_WORKFLOW_PATH}`;
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
  return {
    facts: {
      apiUrl,
      contentDigest: sha256Bytes(workflowBytes),
      gitBlobSha: metadata?.sha ?? null,
      headSha: workflowHeadSha ?? null,
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
  const job = next === null ? tail : tail.slice(0, next.index);
  const match = /^    if: >-\n((?:      .*\n)+)/gmu.exec(job);
  if (match === null || job.slice(match.index + match[0].length).includes('\n    if:')) {
    throw new TypeError(`workflow job ${jobKey} has no unique folded if condition`);
  }
  return match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');
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

function validWorkflowReference(value, repository) {
  const prefix = `${repository}/${PERF_REALISTIC_WORKFLOW_PATH}@`;
  return nonEmptyString(value) && value.startsWith(prefix) && value.length > prefix.length;
}

function validateExpectedWorkflowJob(value) {
  if (
    !ownRecord(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify(['key', 'name', 'triggerPolicy']) ||
    !/^[a-z0-9-]+$/u.test(value.key ?? '') ||
    !nonEmptyString(value.name) ||
    !Object.hasOwn(WORKFLOW_TRIGGER_POLICIES, value.triggerPolicy)
  ) {
    throw new TypeError(
      'expected workflow job must contain exact key, name, and reviewed triggerPolicy fields',
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
  return readZipMembers(archiveBytes, [memberName])[0].bytes;
}

function readZipMembers(archiveBytes, memberNames) {
  if (!Buffer.isBuffer(archiveBytes)) throw new TypeError('ZIP archive must be a Buffer');
  if (archiveBytes.length > MAX_ARCHIVE_BYTES) {
    throw new TypeError('ZIP archive exceeds the safety bound');
  }
  if (
    !Array.isArray(memberNames) ||
    memberNames.length > MAX_AUXILIARY_MEMBERS ||
    memberNames.some((memberName) => !safeZipPath(memberName)) ||
    new Set(memberNames).size !== memberNames.length
  ) {
    throw new TypeError('ZIP member selection is unsafe or duplicated');
  }
  if (memberNames.length === 0) return [];
  const selectedNames = new Set(memberNames);
  const entries = zipEntryCensus(archiveBytes);
  const selected = entries.filter(({ name }) => selectedNames.has(name));
  if (selected.length !== memberNames.length) {
    const available = new Set(selected.map(({ name }) => name));
    const missing = memberNames.find((memberName) => !available.has(memberName));
    throw new TypeError(`ZIP member ${String(missing)} is unavailable`);
  }
  const uncompressedBytes = selected.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
  if (selected.some(({ uncompressedSize }) => uncompressedSize > MAX_REPORT_BYTES)) {
    throw new TypeError('selected ZIP member exceeds the per-member size bound');
  }
  if (!Number.isSafeInteger(uncompressedBytes) || uncompressedBytes > MAX_ARCHIVE_BYTES) {
    throw new TypeError('selected ZIP member census exceeds the aggregate size bound');
  }
  const selectedByName = new Map(selected.map((entry) => [entry.name, entry]));
  return memberNames.map((member) => ({
    bytes: inflateSelectedMember(archiveBytes, selectedByName.get(member)),
    member,
  }));
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
  return entries;
}

function resolveExpectedAuxiliaryMembers(
  archiveBytes,
  { expectedAuxiliaryMember, expectedAuxiliaryMemberGroup, expectedAuxiliaryMembers },
) {
  if (expectedAuxiliaryMember !== undefined) return [expectedAuxiliaryMember];
  const fixed = expectedAuxiliaryMembers ?? [];
  if (expectedAuxiliaryMemberGroup === undefined) return [...fixed];
  const matches = zipEntryCensus(archiveBytes)
    .map(({ name }) => name)
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
    if (!nonEmptyString(value[key]) || value[key].trim() !== value[key]) {
      throw new TypeError(`${key} must be a non-empty path`);
    }
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
