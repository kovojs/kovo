#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { readZipMember } from './lib/perf-artifact-custody.mjs';
import { executionIdentityFindings } from './lib/perf-execution.mjs';
import {
  PACKED_KOVO_PRODUCT_WORKLOAD_POLICY,
  packedKovoProductIdentityFindings,
} from './lib/perf-packed-kovo-product.mjs';
import { canonicalJson, performanceHostFingerprintFindings } from './lib/perf-host.mjs';
import { performanceGateWorkloadIdentity } from './perf-gate.mjs';
import { workloadIdentityFindings } from './perf-regression-check.mjs';

export const PERF_PUBLICATION_COLLECTION_SCHEMA = 'kovo-performance-publication-collection/v3';
export const PERF_PUBLICATION_INPUT_SCHEMA = 'kovo-performance-publication-input/v5';
export const PERF_PUBLICATION_REPOSITORY = 'kovojs/kovo';

/** Raw regular files emitted beside the manifest: selected evidence + campaign authority/candidates. */
export function performancePublicationManifestRawFileCount({ candidateCount, runCount }) {
  if (
    !Number.isSafeInteger(candidateCount?.families) ||
    candidateCount.families < 42 ||
    !Number.isSafeInteger(candidateCount?.productionBytes) ||
    candidateCount.productionBytes < 1 ||
    !Number.isSafeInteger(runCount) ||
    runCount < 1
  ) {
    throw new TypeError('publication raw-file count requires valid candidate and run censuses');
  }
  return 216 + 2 * runCount + 5 * (candidateCount.families + candidateCount.productionBytes);
}

const PERF_REALISTIC_WORKFLOW_NAME = 'Perf Realistic Tier';
const PERF_REALISTIC_WORKFLOW_PATH = '.github/workflows/perf-realistic.yml';
const COMPARISON_REPORT_SCHEMA = 'kovo-next-performance-comparison/v1';
const CHECK_REPORT_SCHEMA = 'kovo-perf-report/v1';
const COMMIT_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const MAX_API_BYTES = 1024 * 1024;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_REPORT_BYTES = 128 * 1024 * 1024;
const MAX_RUNS = 10_000;
const MAX_CAMPAIGN_RUNS = 100;
const execFileAsync = promisify(execFile);

const REQUIRED_LOCKS = Object.freeze([
  'pnpm-lock.yaml',
  'benchmarks/nextjs/pnpm-lock.yaml',
  'benchmarks/harness/pnpm-lock.yaml',
]);
export const PERF_PUBLICATION_PRODUCTION_BYTES_METRICS = Object.freeze([
  'production.criticalPath.wireBytes',
  'production.document.wireBytes',
  'production.inlineBootstrap.gzipBytes',
  'production.inlineBootstrap.identityBytes',
  'production.navigation.wireBytes',
]);
export const PERF_PUBLICATION_PRODUCTION_BYTES = Object.freeze({
  artifactName: 'kovo-perf-bytes',
  budgetFailureStep: 'Evaluate against perf-budgets.json',
  budgetFailureSuccessSteps: Object.freeze([
    'Measure critical-path, navigation and bootstrap bytes',
    'Run actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
  ]),
  cell: 'bytes',
  componentCount: 24,
  reportMember: 'bytes.json',
  reportSchema: CHECK_REPORT_SCHEMA,
  workflowJobKey: 'bytes',
  workflowJobName: 'Production bytes',
});

export const PERF_PUBLICATION_FAMILY_NAMES = Object.freeze([
  'browser',
  'dev-n24',
  'dev-n216',
  'build-n24',
  'build-n216',
  'server',
  'check',
]);

export const PERF_PUBLICATION_FAMILIES = Object.freeze({
  browser: familyPolicy({
    artifactName: 'kovo-perf-browser-matrix',
    cell: 'browser',
    reportMember: 'comparison.json',
    workflowJobKey: 'browser-matrix',
    workflowJobName: 'Browser matrix',
  }),
  'dev-n24': familyPolicy({
    artifactName: 'kovo-perf-dev-n24',
    cell: 'dev',
    corpusSize: 24,
    packedProduct: true,
    reportMember: 'comparison.json',
    workflowJobKey: 'dev-matrix',
    workflowJobName: 'N=24 developer loop',
  }),
  'dev-n216': familyPolicy({
    artifactName: 'kovo-perf-dev-n216',
    cell: 'dev',
    corpusSize: 216,
    packedProduct: true,
    reportMember: 'comparison.json',
    workflowJobKey: 'dev-matrix',
    workflowJobName: 'N=216 developer loop',
  }),
  'build-n24': familyPolicy({
    artifactName: 'kovo-perf-build-n24',
    cell: 'build',
    corpusSize: 24,
    packedProduct: true,
    reportMember: 'comparison.json',
    workflowJobKey: 'build-matrix',
    workflowJobName: 'N=24 production builds',
  }),
  'build-n216': familyPolicy({
    artifactName: 'kovo-perf-build-n216',
    cell: 'build',
    corpusSize: 216,
    packedProduct: true,
    reportMember: 'comparison.json',
    workflowJobKey: 'build-matrix',
    workflowJobName: 'N=216 production builds',
  }),
  server: familyPolicy({
    artifactName: 'kovo-perf-server-matrix',
    cell: 'server',
    reportMember: 'comparison.json',
    workflowJobKey: 'server-matrix',
    workflowJobName: 'Matched production throughput',
  }),
  check: familyPolicy({
    artifactName: 'kovo-perf-check-scaling',
    cell: 'check-scaling',
    reportMember: 'check-scaling.json',
    reportSchema: CHECK_REPORT_SCHEMA,
    workflowJobKey: 'check-scaling',
    workflowJobName: 'Check scaling',
  }),
});

const FAMILY_BY_ARTIFACT = new Map(
  PERF_PUBLICATION_FAMILY_NAMES.map((familyName) => [
    PERF_PUBLICATION_FAMILIES[familyName].artifactName,
    familyName,
  ]),
);

const EVIDENCE_KEYS = Object.freeze([
  'apiMetadata',
  'archive',
  'jobsApiMetadata',
  'report',
  'runApiMetadata',
]);

/**
 * Download one or more completed baseline workflow runs into an immutable, external custody pool.
 * The final directory does not appear until every selected artifact has been validated and saved.
 */
export async function collectPerformancePublicationRuns({
  campaignFirstRunId,
  campaignLastRunId,
  checkoutDirectory,
  operations = defaultCollectionOperations(),
  outDirectory,
  repository,
  runIds,
  sourceSha,
}) {
  validateCommonOptions({ checkoutDirectory, outDirectory, repository, sourceSha });
  const normalizedRunIds = validateRunIds(runIds);
  const campaignBoundary = validateCampaignBoundary({
    firstRunId: campaignFirstRunId,
    lastRunId: campaignLastRunId,
  });
  requireOperation(operations, 'inspectCheckout');
  const boundary = await externalOutputBoundary({
    checkoutDirectory,
    inspectCheckout: (directory) => operations.inspectCheckout(directory),
    outDirectory,
    sourceSha,
  });
  requireOperation(operations, 'fetchApi');
  const observedNow = validNow(operations.now?.() ?? new Date().toISOString());

  return publishAtomicDirectory(boundary, 'collect', async (stagingDirectory) => {
    const workflowRunsApiBytes = await fetchBoundedApi(
      operations,
      campaignRunsApiPath(repository, sourceSha),
      MAX_API_BYTES,
      'campaign workflow-runs API',
    );
    const workflowRuns = parseJsonBytes(workflowRunsApiBytes, 'campaign workflow-runs API');
    const campaignRunIds = validateCampaignRunCensus(workflowRuns, {
      boundary: campaignBoundary,
      requestedRunIds: normalizedRunIds,
      sourceSha,
    });
    const workflowRunsApiMetadata = await writeContentAddressedCustodyFile(
      stagingDirectory,
      'campaign/workflow-runs.api.json',
      workflowRunsApiBytes,
    );
    const candidates = [];
    const productionBytes = [];
    const campaignRuns = [];
    const campaignArtifactListings = new Map();
    for (const runId of campaignRunIds) {
      const runApiEndpoint = runApiPath(repository, runId);
      const jobsApiEndpoint = `${runApiEndpoint}/jobs?filter=all&per_page=100`;
      const artifactsApiEndpoint = `${runApiEndpoint}/artifacts?per_page=100`;
      const [runApiBytes, jobsApiBytes, artifactsApiBytes] = await Promise.all([
        fetchBoundedApi(operations, runApiEndpoint, MAX_API_BYTES, 'workflow run API'),
        fetchBoundedApi(operations, jobsApiEndpoint, MAX_API_BYTES, 'all-attempt jobs API'),
        fetchBoundedApi(operations, artifactsApiEndpoint, MAX_API_BYTES, 'run artifacts API'),
      ]);
      const runMetadata = parseJsonBytes(runApiBytes, 'workflow run API');
      validateRunMetadata(runMetadata, { repository, runId, sourceSha });
      const jobsMetadata = parseJsonBytes(jobsApiBytes, 'all-attempt jobs API');
      validateJobsCensus(jobsMetadata);
      const artifactListing = parseJsonBytes(artifactsApiBytes, 'run artifacts API');
      campaignArtifactListings.set(runId, artifactListing);
      const publicationArtifacts = enumeratePublicationArtifacts(artifactListing, runId);
      if (publicationArtifacts.length === 0) {
        throw new TypeError(`workflow run ${String(runId)} has no literal publication artifact`);
      }
      const campaignRoot = path.posix.join('campaign', 'runs', String(runId));
      const [runApiMetadata, artifactsApiMetadata] = await Promise.all([
        writeContentAddressedCustodyFile(
          stagingDirectory,
          path.posix.join(campaignRoot, 'run.api.json'),
          runApiBytes,
        ),
        writeContentAddressedCustodyFile(
          stagingDirectory,
          path.posix.join(campaignRoot, 'artifacts.api.json'),
          artifactsApiBytes,
        ),
      ]);
      campaignRuns.push({
        artifactsApiMetadata,
        runApiMetadata,
        runCreatedAt: runMetadata.created_at,
        runId,
      });

      for (const { artifactId, familyName, kind } of publicationArtifacts) {
        const artifactApiEndpoint = artifactApiPath(repository, artifactId);
        const [artifactApiBytes, archiveBytes] = await Promise.all([
          fetchBoundedApi(operations, artifactApiEndpoint, MAX_API_BYTES, 'artifact API'),
          fetchBoundedApi(
            operations,
            `${artifactApiEndpoint}/zip`,
            MAX_ARCHIVE_BYTES,
            'artifact ZIP',
          ),
        ]);
        const policy =
          kind === 'family'
            ? PERF_PUBLICATION_FAMILIES[familyName]
            : PERF_PUBLICATION_PRODUCTION_BYTES;
        const reportBytes = readOnlyZipMember(archiveBytes, policy.reportMember);
        const common = {
          archiveBytes,
          artifactApiBytes,
          jobsApiBytes,
          now: observedNow,
          reportBytes,
          repository,
          runApiBytes,
          sourceSha,
        };
        if (kind === 'family') {
          const validated = validateCollectedCandidateBytes({
            ...common,
            expectedArtifactId: artifactId,
            familyName,
          });
          const descriptor = await writeCollectedEvidence(
            stagingDirectory,
            path.posix.join(
              'runs',
              String(validated.summary.runId),
              validated.summary.family,
              String(validated.summary.artifactId),
            ),
            policy.reportMember,
            common,
          );
          candidates.push({ ...validated.summary, descriptor });
        } else {
          const validated = validateCollectedProductionBytesCandidateBytes({
            ...common,
            expectedArtifactId: artifactId,
          });
          const descriptor = await writeCollectedEvidence(
            stagingDirectory,
            path.posix.join(
              'runs',
              String(validated.summary.runId),
              'production-bytes',
              String(validated.summary.artifactId),
            ),
            policy.reportMember,
            common,
          );
          productionBytes.push({ ...validated.summary, descriptor });
        }
      }
    }

    validateCandidateDistinctness(candidates, { allowSharedRunAcrossFamilies: true });
    validateProductionBytesCandidateDistinctness(productionBytes);
    validateCrossInventoryDistinctness(candidates, productionBytes);
    candidates.sort(candidateInventoryOrder);
    productionBytes.sort(candidateChronologyOrder);
    const campaign = {
      boundary: campaignBoundary,
      runs: campaignRuns.sort(campaignRunOrder),
      workflowRunsApiMetadata,
    };
    validateCampaignCandidateInventory(campaignRuns, candidates, productionBytes, {
      artifactListings: campaignArtifactListings,
    });
    const ledger = {
      campaign,
      candidates,
      productionBytes,
      repository,
      runIds: campaignRunIds,
      schema: PERF_PUBLICATION_COLLECTION_SCHEMA,
      sourceCommit: sourceSha,
    };
    await writeExclusive(
      path.join(stagingDirectory, 'collection.json'),
      Buffer.from(`${JSON.stringify(ledger, null, 2)}\n`, 'utf8'),
    );
    return { ledger };
  });
}

/**
 * Read one complete campaign custody pool, select one exact six-run cohort per family without
 * using performance metrics, and publish a self-contained final gate manifest plus chronology.
 */
export async function createPerformancePublicationManifest({
  checkoutDirectory,
  cohortSelections = new Map(),
  collectionDirectories,
  operations = defaultCollectionOperations(),
  outDirectory,
  repository,
  sourceSha,
}) {
  validateCommonOptions({ checkoutDirectory, outDirectory, repository, sourceSha });
  requireOperation(operations, 'inspectCheckout');
  const boundary = await externalOutputBoundary({
    checkoutDirectory,
    inspectCheckout: (directory) => operations.inspectCheckout(directory),
    outDirectory,
    sourceSha,
  });
  const selections = validateCohortSelections(cohortSelections);
  const inventory = await loadPerformancePublicationCollections({
    checkoutRoot: boundary.checkoutRoot,
    collectionDirectories,
    manifestOutput: boundary.output,
    repository,
    sourceSha,
  });
  const selected = selectPerformancePublicationCohorts(inventory.candidates, {
    cohortSelections: selections,
  });
  const productionBytes = selectPerformancePublicationProductionBytes(inventory.productionBytes);
  validateSelectedPublicationIdentity(selected, productionBytes, sourceSha);

  return publishAtomicDirectory(boundary, 'manifest', async (stagingDirectory) => {
    const families = {};
    for (const familyName of PERF_PUBLICATION_FAMILY_NAMES) {
      const family = selected[familyName];
      const descriptors = [];
      for (const [index, candidate] of family.entries()) {
        const slot = index < 5 ? `baseline-${String(index + 1)}` : 'holdout';
        descriptors.push(await copyCandidateCustody(stagingDirectory, familyName, slot, candidate));
      }
      families[familyName] = {
        baseline: descriptors.slice(0, 5),
        holdout: descriptors[5],
      };
    }
    const productionBytesDescriptor = await copyCandidateCustody(
      stagingDirectory,
      'production-bytes',
      'selected',
      productionBytes,
      PERF_PUBLICATION_PRODUCTION_BYTES.reportMember,
      { topLevel: true },
    );
    const campaign = await copyCampaignCustody(stagingDirectory, inventory.campaign, {
      candidates: inventory.candidates,
      cohortSelections: selections,
      productionBytesCandidates: inventory.productionBytes,
      selectedProductionBytes: productionBytes,
    });
    const manifest = {
      campaign,
      families,
      productionBytes: productionBytesDescriptor,
      repository,
      schema: PERF_PUBLICATION_INPUT_SCHEMA,
    };
    await writeExclusive(
      path.join(stagingDirectory, 'performance-publication-input.json'),
      Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    );
    return {
      manifest,
      selected: {
        families: selectedInventory(selected),
        productionBytes: {
          artifactId: productionBytes.artifactId,
          runCreatedAt: productionBytes.runCreatedAt,
          runId: productionBytes.runId,
        },
      },
    };
  });
}

/** Exact metrics-blind cohort facts. `analysis`, raw timing samples, and generated timestamps do not enter. */
export function performancePublicationCohortIdentity(report, familyName) {
  const policy = requiredFamilyPolicy(familyName);
  const identity = {
    host: report?.host?.digest ?? null,
    locks: report?.source?.locks ?? null,
    sourceCommit: report?.source?.commit ?? null,
    workload: report?.workloadIdentity ?? null,
    ...(policy.packedProduct
      ? {
          product: {
            artifact: report?.productArtifact ?? null,
            policy: report?.workloadIdentity?.identity?.productArtifactPolicy ?? null,
          },
        }
      : {}),
  };
  return identity;
}

export function performancePublicationCohortDigest(report, familyName) {
  return sha256(
    Buffer.from(canonicalJson(performancePublicationCohortIdentity(report, familyName))),
  );
}

/** Select first five baselines and the sixth holdout by immutable run chronology. */
export function selectPerformancePublicationCohorts(
  candidates,
  { cohortSelections = new Map() } = {},
) {
  if (!Array.isArray(candidates)) throw new TypeError('collection candidates must be an array');
  const selections = validateCohortSelections(cohortSelections);
  validateCandidateDistinctness(candidates, { allowSharedRunAcrossFamilies: true });
  const result = {};
  for (const familyName of PERF_PUBLICATION_FAMILY_NAMES) {
    const familyCandidates = candidates.filter((candidate) => candidate.family === familyName);
    const groups = new Map();
    for (const candidate of familyCandidates) {
      validateCandidateSelectionFacts(candidate, familyName);
      const digest = performancePublicationCohortDigest(candidate.report, familyName);
      if (candidate.cohortDigest !== undefined && candidate.cohortDigest !== digest) {
        throw new TypeError(`${familyName} candidate cohort digest differs from its report`);
      }
      const members = groups.get(digest) ?? [];
      members.push({ ...candidate, cohortDigest: digest });
      groups.set(digest, members);
    }
    const qualifying = [...groups.entries()]
      .map(([digest, members]) => [digest, [...members].sort(candidateChronologyOrder)])
      .filter(([, members]) => members.length >= 6)
      .sort(([left], [right]) => left.localeCompare(right));
    if (qualifying.length === 0) {
      throw new TypeError(`${familyName} has no exact identity cohort with six independent runs`);
    }
    const requested = selections.get(familyName);
    let eligible = qualifying;
    if (requested !== undefined) {
      if (qualifying.length === 1) {
        throw new TypeError(
          `${familyName} cohort selector is unnecessary for one qualifying cohort`,
        );
      }
      eligible = qualifying.filter(
        ([digest, members]) => digest === requested || members[0]?.hostDigest === requested,
      );
      if (eligible.length !== 1) {
        throw new TypeError(
          `${familyName} selector ${requested} does not identify one exact qualifying cohort`,
        );
      }
    } else if (qualifying.length !== 1) {
      throw new TypeError(
        `${familyName} has multiple qualifying cohorts: ${qualifying
          .map(([digest]) => digest)
          .join(', ')}`,
      );
    }
    const chosen = eligible[0][1].slice(0, 6);
    requireSixDistinct(chosen, familyName);
    result[familyName] = chosen;
  }
  return result;
}

/** Select the one Production-bytes sidecar solely by immutable run chronology. */
export function selectPerformancePublicationProductionBytes(candidates) {
  if (!Array.isArray(candidates)) {
    throw new TypeError('production bytes candidates must be an array');
  }
  validateProductionBytesCandidateDistinctness(candidates);
  if (candidates.length === 0) {
    throw new TypeError('no authenticated Production bytes sidecar is available');
  }
  return [...candidates].sort(candidateChronologyOrder)[0];
}

/** Testable byte boundary shared by network collection and offline manifest revalidation. */
export function validateCollectedCandidateBytes({
  archiveBytes,
  artifactApiBytes,
  expectedArtifactId,
  familyName,
  jobsApiBytes,
  now,
  reportBytes,
  repository,
  runApiBytes,
  sourceSha,
}) {
  const policy = requiredFamilyPolicy(familyName);
  validateRepository(repository);
  validateSourceSha(sourceSha);
  const observedNow = validNow(now ?? new Date().toISOString());
  const boundedArchive = boundedBytes(archiveBytes, MAX_ARCHIVE_BYTES, 'artifact ZIP');
  const boundedArtifactApi = boundedBytes(artifactApiBytes, MAX_API_BYTES, 'artifact API metadata');
  const boundedJobsApi = boundedBytes(jobsApiBytes, MAX_API_BYTES, 'all-attempt jobs API');
  const boundedReport = boundedBytes(reportBytes, MAX_REPORT_BYTES, 'extracted report');
  const boundedRunApi = boundedBytes(runApiBytes, MAX_API_BYTES, 'workflow run API metadata');
  const artifact = parseJsonBytes(boundedArtifactApi, 'artifact API metadata');
  const jobs = parseJsonBytes(boundedJobsApi, 'all-attempt jobs API');
  const report = parseJsonBytes(boundedReport, 'extracted report');
  const run = parseJsonBytes(boundedRunApi, 'workflow run API metadata');
  const runId = positiveInteger(run?.id, 'workflow run id');
  validateRunMetadata(run, { repository, runId, sourceSha });
  validateJobsCensus(jobs);

  const artifactId = positiveInteger(artifact?.id, 'artifact id');
  if (expectedArtifactId !== undefined && artifactId !== expectedArtifactId) {
    throw new TypeError('artifact API identity differs from the run artifact listing');
  }
  validateArtifactMetadata(artifact, {
    archiveBytes: boundedArchive,
    artifactId,
    now: observedNow,
    policy,
    repository,
    run,
    runId,
    sourceSha,
  });
  validateExpectedJob(jobs, { policy, repository, run, runId, sourceSha });
  const archiveReport = readOnlyZipMember(boundedArchive, policy.reportMember);
  if (!archiveReport.equals(boundedReport)) {
    throw new TypeError(`saved report bytes differ from ZIP member ${policy.reportMember}`);
  }
  validateFamilyReport(report, {
    familyName,
    policy,
    repository,
    run,
    runId,
    sourceSha,
  });

  const cohortIdentity = performancePublicationCohortIdentity(report, familyName);
  const cohortDigest = sha256(Buffer.from(canonicalJson(cohortIdentity)));
  return {
    report,
    summary: {
      artifactId,
      cohortDigest,
      executionDigest: report.execution.digest,
      family: familyName,
      hostDigest: report.host.digest,
      runCreatedAt: run.created_at,
      runId,
    },
  };
}

/** Authenticate the deterministic Production-bytes sidecar before it enters immutable custody. */
export function validateCollectedProductionBytesCandidateBytes({
  archiveBytes,
  artifactApiBytes,
  expectedArtifactId,
  jobsApiBytes,
  now,
  reportBytes,
  repository,
  runApiBytes,
  sourceSha,
}) {
  const policy = PERF_PUBLICATION_PRODUCTION_BYTES;
  validateRepository(repository);
  validateSourceSha(sourceSha);
  const observedNow = validNow(now ?? new Date().toISOString());
  const boundedArchive = boundedBytes(archiveBytes, MAX_ARCHIVE_BYTES, 'artifact ZIP');
  const boundedArtifactApi = boundedBytes(artifactApiBytes, MAX_API_BYTES, 'artifact API metadata');
  const boundedJobsApi = boundedBytes(jobsApiBytes, MAX_API_BYTES, 'all-attempt jobs API');
  const boundedReport = boundedBytes(reportBytes, MAX_REPORT_BYTES, 'extracted report');
  const boundedRunApi = boundedBytes(runApiBytes, MAX_API_BYTES, 'workflow run API metadata');
  const artifact = parseJsonBytes(boundedArtifactApi, 'artifact API metadata');
  const jobs = parseJsonBytes(boundedJobsApi, 'all-attempt jobs API');
  const report = parseJsonBytes(boundedReport, 'extracted report');
  const run = parseJsonBytes(boundedRunApi, 'workflow run API metadata');
  const runId = positiveInteger(run?.id, 'workflow run id');
  validateRunMetadata(run, { repository, runId, sourceSha });
  if (run.event !== 'pull_request') {
    throw new TypeError('Production bytes workflow run must use the PR-only trigger');
  }
  validateJobsCensus(jobs);

  const artifactId = positiveInteger(artifact?.id, 'artifact id');
  if (expectedArtifactId !== undefined && artifactId !== expectedArtifactId) {
    throw new TypeError('artifact API identity differs from the run artifact listing');
  }
  validateArtifactMetadata(artifact, {
    archiveBytes: boundedArchive,
    artifactId,
    now: observedNow,
    policy,
    repository,
    run,
    runId,
    sourceSha,
  });
  validateExpectedJob(jobs, {
    allowedConclusions: ['failure', 'success'],
    allowedFailureStep: policy.budgetFailureStep,
    requiredSuccessSteps: policy.budgetFailureSuccessSteps,
    policy,
    repository,
    run,
    runId,
    sourceSha,
  });
  const archiveReport = readOnlyZipMember(boundedArchive, policy.reportMember);
  if (!archiveReport.equals(boundedReport)) {
    throw new TypeError(`saved report bytes differ from ZIP member ${policy.reportMember}`);
  }
  validateProductionBytesReport(report, { repository, run, runId, sourceSha });

  return {
    report,
    summary: {
      artifactId,
      executionDigest: report.execution.digest,
      runCreatedAt: run.created_at,
      runId,
    },
  };
}

export async function loadPerformancePublicationCollections({
  checkoutRoot,
  collectionDirectories,
  manifestOutput,
  repository,
  sourceSha,
}) {
  if (!Array.isArray(collectionDirectories) || collectionDirectories.length !== 1) {
    throw new TypeError('exactly one complete campaign --collection directory is required');
  }
  const normalizedCheckoutRoot = await realpath(path.resolve(checkoutRoot));
  const normalizedManifestOutput =
    manifestOutput === undefined ? undefined : path.resolve(manifestOutput);
  const roots = [];
  for (const collectionDirectory of collectionDirectories) {
    const root = await resolveExternalDirectory(
      collectionDirectory,
      normalizedCheckoutRoot,
      'collection',
    );
    if (normalizedManifestOutput !== undefined && pathsOverlap(root, normalizedManifestOutput)) {
      throw new TypeError('manifest output must be disjoint from every collection directory');
    }
    if (roots.some((existing) => pathsOverlap(existing, root))) {
      throw new TypeError('collection directories must be pairwise disjoint');
    }
    roots.push(root);
  }

  const candidates = [];
  const productionBytes = [];
  const seenFiles = new Set();
  const seenInodes = new Set();
  let campaign;
  for (const root of roots) {
    const ledgerPath = path.join(root, 'collection.json');
    const ledgerFacts = await boundedRegularFile(ledgerPath, MAX_API_BYTES, 'collection ledger');
    const ledger = parseJsonBytes(ledgerFacts.bytes, 'collection ledger');
    validateCollectionLedger(ledger, { repository, sourceSha });
    campaign = await loadCollectedCampaign(root, ledger.campaign, {
      repository,
      seenFiles,
      seenInodes,
      sourceSha,
    });
    for (const entry of ledger.candidates) {
      const loaded = await loadCollectedCandidate(root, entry, {
        repository,
        seenFiles,
        seenInodes,
        sourceSha,
      });
      candidates.push(loaded);
    }
    for (const entry of ledger.productionBytes) {
      const loaded = await loadCollectedProductionBytesCandidate(root, entry, {
        repository,
        seenFiles,
        seenInodes,
        sourceSha,
      });
      productionBytes.push(loaded);
    }
  }
  validateCandidateDistinctness(candidates, { allowSharedRunAcrossFamilies: true });
  validateProductionBytesCandidateDistinctness(productionBytes);
  validateCrossInventoryDistinctness(candidates, productionBytes);
  validateCampaignCandidateInventory(campaign.runs, candidates, productionBytes, {
    artifactListings: campaign.artifactListings,
  });
  return { campaign, candidates, productionBytes };
}

function familyPolicy({
  artifactName,
  cell,
  corpusSize = null,
  packedProduct = false,
  reportMember,
  reportSchema = COMPARISON_REPORT_SCHEMA,
  workflowJobKey,
  workflowJobName,
}) {
  return Object.freeze({
    artifactName,
    cell,
    corpusSize,
    packedProduct,
    reportMember,
    reportSchema,
    workflowJobKey,
    workflowJobName,
  });
}

function requiredFamilyPolicy(familyName) {
  if (!Object.hasOwn(PERF_PUBLICATION_FAMILIES, familyName)) {
    throw new TypeError(`unknown performance publication family ${String(familyName)}`);
  }
  return PERF_PUBLICATION_FAMILIES[familyName];
}

function validateCommonOptions({ checkoutDirectory, outDirectory, repository, sourceSha }) {
  if (!nonEmptyString(checkoutDirectory)) throw new TypeError('--checkout is required');
  if (!nonEmptyString(outDirectory)) throw new TypeError('--out is required');
  validateRepository(repository);
  validateSourceSha(sourceSha);
}

function validateRepository(repository) {
  if (repository !== PERF_PUBLICATION_REPOSITORY) {
    throw new TypeError(`repository must be ${PERF_PUBLICATION_REPOSITORY}`);
  }
}

function validateSourceSha(sourceSha) {
  if (!COMMIT_PATTERN.test(sourceSha ?? '')) {
    throw new TypeError('source SHA must be an exact lowercase 40- or 64-hex commit');
  }
}

function validateRunIds(runIds) {
  if (!Array.isArray(runIds) || runIds.length < 1 || runIds.length > MAX_RUNS) {
    throw new TypeError('one to 10000 repeated --run IDs are required');
  }
  const normalized = runIds.map((value) => {
    const text = String(value);
    if (!/^[1-9][0-9]*$/u.test(text)) throw new TypeError(`invalid workflow run ID ${text}`);
    const number = Number(text);
    if (!Number.isSafeInteger(number)) throw new TypeError(`workflow run ID ${text} is unsafe`);
    return number;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError('workflow run IDs must be distinct');
  }
  return normalized;
}

function validateCohortSelections(value) {
  const selections = value instanceof Map ? new Map(value) : new Map(Object.entries(value ?? {}));
  for (const [familyName, digest] of selections) {
    requiredFamilyPolicy(familyName);
    if (!DIGEST_PATTERN.test(digest ?? '')) {
      throw new TypeError(`${familyName} cohort selector must be an exact sha256 digest`);
    }
  }
  return selections;
}

function validNow(value) {
  if (!nonEmptyString(value) || !Number.isFinite(Date.parse(value))) {
    throw new TypeError('collection clock is invalid');
  }
  return value;
}

async function externalOutputBoundary({
  checkoutDirectory,
  inspectCheckout,
  outDirectory,
  sourceSha,
}) {
  if (typeof inspectCheckout !== 'function') {
    throw new TypeError('checkout inspection operation is required');
  }
  const checkoutRoot = await realpath(path.resolve(checkoutDirectory));
  const checkoutFacts = await inspectCheckout(checkoutRoot);
  const inspectedRoot = await realpath(path.resolve(checkoutFacts?.root ?? ''));
  if (inspectedRoot !== checkoutRoot) {
    throw new TypeError('--checkout must be the exact Git worktree root');
  }
  if (checkoutFacts?.head !== sourceSha) {
    throw new TypeError('measured checkout HEAD differs from --source');
  }
  if (checkoutFacts?.status !== '') {
    throw new TypeError('measured checkout is not clean');
  }
  const requestedOutput = path.resolve(outDirectory);
  const outputParent = await realpath(path.dirname(requestedOutput));
  const output = path.join(outputParent, path.basename(requestedOutput));
  if (
    path.basename(output) === '' ||
    path.basename(output) === '.' ||
    path.basename(output) === '..'
  ) {
    throw new TypeError('--out must name a new directory');
  }
  if (containedBy(checkoutRoot, output)) {
    throw new TypeError('--out must remain outside the measured checkout');
  }
  const parentFacts = await lstat(outputParent);
  if (!parentFacts.isDirectory() || parentFacts.isSymbolicLink()) {
    throw new TypeError('--out parent must be a real directory');
  }
  try {
    await lstat(output);
    throw new TypeError('--out must not already exist');
  } catch (error) {
    if (error instanceof TypeError) throw error;
    if (error?.code !== 'ENOENT') throw error;
  }
  return { checkoutRoot, output, outputParent };
}

async function publishAtomicDirectory(boundary, label, produce) {
  const stagingDirectory = await mkdtemp(
    path.join(boundary.outputParent, `.kovo-perf-${label}-staging-`),
  );
  await chmod(stagingDirectory, 0o700);
  let published = false;
  try {
    const result = await produce(stagingDirectory);
    await rename(stagingDirectory, boundary.output);
    published = true;
    return { directory: boundary.output, ...result };
  } finally {
    if (!published) {
      await rm(stagingDirectory, { force: true, recursive: true });
    }
  }
}

async function fetchBoundedApi(operations, endpoint, maximumBytes, label) {
  const value = await operations.fetchApi(endpoint, { label, maximumBytes });
  return boundedBytes(value, maximumBytes, label);
}

function boundedBytes(value, maximumBytes, label) {
  const bytes = Buffer.from(value ?? []);
  if (bytes.length < 1 || bytes.length > maximumBytes) {
    throw new TypeError(`${label} is empty or exceeds its ${String(maximumBytes)}-byte bound`);
  }
  return bytes;
}

function parseJsonBytes(bytes, label) {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) {
    throw new TypeError(`${label} is not canonical UTF-8`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new TypeError(`${label} is not valid JSON`);
  }
}

function readOnlyZipMember(archiveBytes, memberName) {
  // The shared custody parser authenticates every local/central record, path, bound, CRC, and
  // payload. This additional census check keeps collection aligned with the publication gate's
  // literal one-report artifacts without introducing a second extraction implementation.
  const bytes = readZipMember(archiveBytes, memberName);
  if (authenticatedZipEntryCount(archiveBytes) !== 1) {
    throw new TypeError('artifact ZIP must contain exactly its one literal report member');
  }
  return bytes;
}

function authenticatedZipEntryCount(bytes) {
  const first = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= first; offset -= 1) {
    if (
      bytes.readUInt32LE(offset) === 0x06054b50 &&
      offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length
    ) {
      return bytes.readUInt16LE(offset + 10);
    }
  }
  // `readZipMember` has already authenticated a real EOCD, so this is unreachable unless bytes
  // changed through an exotic Buffer alias between the two synchronous checks.
  throw new TypeError('artifact ZIP census changed during extraction');
}

function validateRunMetadata(run, { repository, runId, sourceSha }) {
  const apiUrl = runApiUrl(repository, runId);
  const runUrl = `https://github.com/${repository}/actions/runs/${String(runId)}`;
  const repositoryId = run?.repository?.id;
  const headRepositoryId = run?.head_repository?.id;
  const findings = [];
  if (!ownRecord(run) || run.id !== runId) findings.push('workflow run identity differs');
  if (
    run?.url !== apiUrl ||
    run?.html_url !== runUrl ||
    run?.jobs_url !== `${apiUrl}/jobs` ||
    run?.artifacts_url !== `${apiUrl}/artifacts`
  ) {
    findings.push('workflow run URLs are not canonical');
  }
  if (
    run?.repository?.full_name !== repository ||
    run?.head_repository?.full_name !== repository ||
    !Number.isSafeInteger(repositoryId) ||
    repositoryId < 1 ||
    headRepositoryId !== repositoryId
  ) {
    findings.push('workflow run repository identity differs');
  }
  if (
    run?.head_sha !== sourceSha ||
    run?.head_commit?.id !== sourceSha ||
    !COMMIT_PATTERN.test(run?.head_sha ?? '')
  ) {
    findings.push('workflow run source identity differs');
  }
  if (run?.name !== PERF_REALISTIC_WORKFLOW_NAME || run?.path !== PERF_REALISTIC_WORKFLOW_PATH) {
    findings.push('workflow run is not the realistic performance workflow');
  }
  if (run?.status !== 'completed') findings.push('workflow run is not completed');
  if (!['pull_request', 'schedule', 'workflow_dispatch'].includes(run?.event)) {
    findings.push('workflow run trigger is not a baseline-capable event');
  }
  if (!Number.isSafeInteger(run?.run_attempt) || run.run_attempt < 1) {
    findings.push('workflow run attempt is unavailable');
  }
  if (!validTimestamp(run?.created_at)) findings.push('workflow run created_at is unavailable');
  if (findings.length > 0) throw new TypeError(findings.join('\n'));
}

function validateJobsCensus(jobs) {
  if (
    !ownRecord(jobs) ||
    !Array.isArray(jobs.jobs) ||
    !Number.isSafeInteger(jobs.total_count) ||
    jobs.total_count < 1 ||
    jobs.total_count > 100 ||
    jobs.total_count !== jobs.jobs.length
  ) {
    throw new TypeError('all-attempt jobs API census is incomplete or exceeds one page');
  }
  const ids = jobs.jobs.map((job) => job?.id);
  if (ids.some((id) => !Number.isSafeInteger(id) || id < 1) || new Set(ids).size !== ids.length) {
    throw new TypeError('all-attempt jobs API contains missing or duplicate job identities');
  }
}

function enumeratePublicationArtifacts(listing, runId) {
  if (
    !ownRecord(listing) ||
    !Array.isArray(listing.artifacts) ||
    !Number.isSafeInteger(listing.total_count) ||
    listing.total_count < 0 ||
    listing.total_count > 100 ||
    listing.total_count !== listing.artifacts.length
  ) {
    throw new TypeError('run artifacts API census is incomplete or exceeds one page');
  }
  const ids = listing.artifacts.map((artifact) => artifact?.id);
  if (ids.some((id) => !Number.isSafeInteger(id) || id < 1) || new Set(ids).size !== ids.length) {
    throw new TypeError('run artifacts API contains missing or duplicate artifact identities');
  }
  const familyArtifacts = listing.artifacts
    .filter((artifact) => FAMILY_BY_ARTIFACT.has(artifact?.name))
    .map((artifact) => ({
      artifactId: artifact.id,
      familyName: FAMILY_BY_ARTIFACT.get(artifact.name),
      kind: 'family',
    }));
  const familyNames = familyArtifacts.map(({ familyName }) => familyName);
  if (new Set(familyNames).size !== familyNames.length) {
    throw new TypeError(`workflow run ${String(runId)} has ambiguous baseline-family artifacts`);
  }
  const productionBytes = listing.artifacts
    .filter((artifact) => artifact?.name === PERF_PUBLICATION_PRODUCTION_BYTES.artifactName)
    .map((artifact) => ({ artifactId: artifact.id, familyName: null, kind: 'production-bytes' }));
  if (productionBytes.length > 1) {
    throw new TypeError(`workflow run ${String(runId)} has ambiguous Production bytes artifacts`);
  }
  familyArtifacts.sort(
    (left, right) =>
      PERF_PUBLICATION_FAMILY_NAMES.indexOf(left.familyName) -
      PERF_PUBLICATION_FAMILY_NAMES.indexOf(right.familyName),
  );
  return [...familyArtifacts, ...productionBytes];
}

function validateArtifactMetadata(
  artifact,
  { archiveBytes, artifactId, now, policy, repository, run, runId, sourceSha },
) {
  const apiUrl = artifactApiUrl(repository, artifactId);
  const findings = [];
  if (!ownRecord(artifact) || artifact?.id !== artifactId) {
    findings.push('artifact API identity differs');
  }
  if (artifact?.name !== policy.artifactName) {
    findings.push(`artifact name is not ${policy.artifactName}`);
  }
  if (artifact?.url !== apiUrl || artifact?.archive_download_url !== `${apiUrl}/zip`) {
    findings.push('artifact API URLs are not canonical');
  }
  if (artifact?.expired !== false) findings.push('artifact is expired');
  const expiresAt = Date.parse(artifact?.expires_at ?? '');
  if (!Number.isFinite(expiresAt) || Date.parse(now) >= expiresAt) {
    findings.push('artifact retention has expired or is unavailable');
  }
  if (
    artifact?.digest !== sha256(archiveBytes) ||
    !DIGEST_PATTERN.test(artifact?.digest ?? '') ||
    artifact?.size_in_bytes !== archiveBytes.length
  ) {
    findings.push('artifact ZIP bytes differ from GitHub artifact metadata');
  }
  if (
    artifact?.workflow_run?.id !== runId ||
    artifact?.workflow_run?.head_sha !== sourceSha ||
    artifact?.workflow_run?.head_branch !== run?.head_branch ||
    artifact?.workflow_run?.repository_id !== run?.repository?.id ||
    artifact?.workflow_run?.head_repository_id !== run?.head_repository?.id
  ) {
    findings.push('artifact workflow identity differs from the workflow run');
  }
  const createdAt = Date.parse(artifact?.created_at ?? '');
  const updatedAt = Date.parse(artifact?.updated_at ?? '');
  if (
    !Number.isFinite(createdAt) ||
    !Number.isFinite(updatedAt) ||
    !Number.isFinite(expiresAt) ||
    createdAt > updatedAt ||
    updatedAt > expiresAt
  ) {
    findings.push('artifact timestamps are unavailable or non-monotonic');
  }
  if (findings.length > 0) throw new TypeError(findings.join('\n'));
}

function validateExpectedJob(
  jobsMetadata,
  {
    allowedConclusions = ['success'],
    allowedFailureStep = null,
    requiredSuccessSteps = [],
    policy,
    repository,
    run,
    runId,
    sourceSha,
  },
) {
  if (
    allowedConclusions.includes('failure') &&
    (!nonEmptyString(allowedFailureStep) ||
      allowedFailureStep.trim() !== allowedFailureStep ||
      !Array.isArray(requiredSuccessSteps) ||
      requiredSuccessSteps.length !== 2 ||
      new Set(requiredSuccessSteps).size !== requiredSuccessSteps.length ||
      requiredSuccessSteps.some(
        (step) => !nonEmptyString(step) || step.trim() !== step || step === allowedFailureStep,
      ))
  ) {
    throw new TypeError('failed producer authorization requires exact ordered workflow steps');
  }
  const matches = jobsMetadata.jobs.filter(
    (job) => job?.name === policy.workflowJobName && job?.run_attempt === run.run_attempt,
  );
  if (matches.length !== 1) {
    throw new TypeError(
      `all-attempt jobs API has ${String(matches.length)} exact ${policy.workflowJobName} producers`,
    );
  }
  const job = matches[0];
  const jobId = positiveInteger(job?.id, 'workflow job id');
  const steps = Array.isArray(job?.steps) ? job.steps : [];
  const failedSteps = steps.filter((step) => step?.conclusion === 'failure');
  const failureStepMatches = steps.filter((step) => step?.name === allowedFailureStep);
  const requiredSuccessStepMatches = requiredSuccessSteps.map((name) =>
    steps.filter((step) => step?.name === name),
  );
  const failureStep = failureStepMatches[0];
  const matchedSuccessSteps = requiredSuccessStepMatches.map(([step]) => step);
  const authorizedFailure =
    job?.conclusion === 'failure' &&
    requiredSuccessSteps.length === 2 &&
    failedSteps.length === 1 &&
    failureStepMatches.length === 1 &&
    failureStep?.conclusion === 'failure' &&
    failureStep?.status === 'completed' &&
    Number.isSafeInteger(failureStep?.number) &&
    failureStep.number > 0 &&
    requiredSuccessStepMatches.every(
      (matches) =>
        matches.length === 1 &&
        matches[0]?.conclusion === 'success' &&
        matches[0]?.status === 'completed' &&
        Number.isSafeInteger(matches[0]?.number) &&
        matches[0].number > 0,
    ) &&
    matchedSuccessSteps[0].number < failureStep.number &&
    failureStep.number < matchedSuccessSteps[1].number;
  if (
    job?.run_id !== runId ||
    job?.run_attempt !== run.run_attempt ||
    job?.head_sha !== sourceSha ||
    job?.status !== 'completed' ||
    !allowedConclusions.includes(job?.conclusion) ||
    (job?.conclusion === 'failure' && !authorizedFailure) ||
    job?.url !== `https://api.github.com/repos/${repository}/actions/jobs/${String(jobId)}` ||
    !validTimestamp(job?.started_at) ||
    !validTimestamp(job?.completed_at) ||
    Date.parse(job.started_at) > Date.parse(job.completed_at)
  ) {
    throw new TypeError('expected artifact producer is not one exact authorized workflow job');
  }
}

function validateFamilyReport(report, { familyName, policy, repository, run, runId, sourceSha }) {
  const findings = [];
  if (!ownRecord(report) || report.schema !== policy.reportSchema) {
    findings.push(`${familyName} report schema differs`);
  }
  if (
    report?.source?.commit !== sourceSha ||
    report?.source?.dirty !== false ||
    canonicalJson(report?.source?.dirtyPaths) !== canonicalJson([])
  ) {
    findings.push(`${familyName} report source is wrong or dirty`);
  }
  if (
    !ownRecord(report?.source?.locks) ||
    REQUIRED_LOCKS.some((lock) => !DIGEST_PATTERN.test(report.source.locks[lock] ?? ''))
  ) {
    findings.push(`${familyName} report dependency-lock identity is incomplete`);
  }
  findings.push(
    ...performanceHostFingerprintFindings(report?.host).map(
      (finding) => `${familyName} ${finding}`,
    ),
  );
  findings.push(...workloadIdentityFindings(report?.workloadIdentity, familyName));
  findings.push(
    ...executionIdentityFindings(report?.execution, { requireProvider: 'github-actions' }).map(
      (finding) => `${familyName} ${finding}`,
    ),
  );
  const github = report?.execution?.github;
  const runUrl = `https://github.com/${repository}/actions/runs/${String(runId)}`;
  const workflowRefPrefix = `${repository}/${PERF_REALISTIC_WORKFLOW_PATH}@`;
  if (
    github?.repository !== repository ||
    github?.serverUrl !== 'https://github.com' ||
    github?.runUrl !== runUrl ||
    String(github?.runId ?? '') !== String(runId) ||
    String(github?.runAttempt ?? '') !== String(run.run_attempt) ||
    github?.sha !== sourceSha ||
    github?.job !== policy.workflowJobKey ||
    !nonEmptyString(github?.workflowRef) ||
    !github.workflowRef.startsWith(workflowRefPrefix) ||
    !COMMIT_PATTERN.test(github?.eventSha ?? '') ||
    !COMMIT_PATTERN.test(github?.workflowSha ?? '') ||
    (run.event === 'pull_request'
      ? github.eventSha !== github.workflowSha
      : github.eventSha !== sourceSha || github.workflowSha !== sourceSha)
  ) {
    findings.push(`${familyName} report execution differs from its workflow run and job`);
  }
  if (
    canonicalJson(report?.workloadIdentity?.identity?.cells) !== canonicalJson([policy.cell]) ||
    (policy.corpusSize !== null &&
      report?.workloadIdentity?.identity?.policies?.corpusSize !== policy.corpusSize)
  ) {
    findings.push(`${familyName} report carries the wrong family workload`);
  }
  for (const field of [
    'executionAuthenticated',
    'publishable',
    'serialized',
    'sourceStable',
    'workloadAuthenticated',
  ]) {
    if (report?.integrity?.[field] !== true) {
      findings.push(`${familyName} integrity.${field} is not true`);
    }
  }
  if (policy.reportSchema === COMPARISON_REPORT_SCHEMA) {
    if (report?.integrity?.comparatorMatched !== true) {
      findings.push(`${familyName} comparator integrity is incomplete`);
    }
  } else if (report?.integrity?.complete !== true || report?.suite !== 'check-scaling') {
    findings.push('check report completeness or suite identity differs');
  }
  if (report?.verdict?.status !== 'measured') {
    findings.push(`${familyName} report is not measured`);
  }
  if (policy.packedProduct) {
    if (
      canonicalJson(report?.workloadIdentity?.identity?.productArtifactPolicy) !==
      canonicalJson(PACKED_KOVO_PRODUCT_WORKLOAD_POLICY)
    ) {
      findings.push(`${familyName} packed product policy differs`);
    }
    findings.push(
      ...packedKovoProductIdentityFindings(report?.productArtifact, report?.source).map(
        (finding) => `${familyName} ${finding}`,
      ),
    );
  } else if (policy.reportSchema === COMPARISON_REPORT_SCHEMA && report?.productArtifact !== null) {
    findings.push(`${familyName} unexpectedly carries packed product identity`);
  }
  if (findings.length > 0) throw new TypeError([...new Set(findings)].join('\n'));
}

function validateProductionBytesReport(report, { repository, run, runId, sourceSha }) {
  const policy = PERF_PUBLICATION_PRODUCTION_BYTES;
  const findings = [];
  if (!ownRecord(report) || report.schema !== policy.reportSchema) {
    findings.push('Production bytes report schema differs');
  }
  const expectedSourceKeys = ['commit', 'dirty', 'dirtyPaths', 'locks'];
  for (const [label, source] of [
    ['source', report?.source],
    ['sourceAfter', report?.sourceAfter],
  ]) {
    if (
      !ownRecord(source) ||
      canonicalJson(Object.keys(source).sort()) !== canonicalJson(expectedSourceKeys) ||
      source.commit !== sourceSha ||
      source.dirty !== false ||
      canonicalJson(source.dirtyPaths) !== canonicalJson([]) ||
      !ownRecord(source.locks) ||
      canonicalJson(Object.keys(source.locks).sort()) !==
        canonicalJson([...REQUIRED_LOCKS].sort()) ||
      REQUIRED_LOCKS.some((lock) => !DIGEST_PATTERN.test(source.locks[lock] ?? ''))
    ) {
      findings.push(`Production bytes report ${label} or dependency locks differ`);
    }
  }
  if (canonicalJson(report?.source) !== canonicalJson(report?.sourceAfter)) {
    findings.push('Production bytes report source changed during measurement');
  }
  findings.push(
    ...executionIdentityFindings(report?.execution, { requireProvider: 'github-actions' }).map(
      (finding) => `Production bytes ${finding}`,
    ),
  );
  findings.push(
    ...performanceHostFingerprintFindings(report?.host).map(
      (finding) => `Production bytes host ${finding}`,
    ),
  );
  const github = report?.execution?.github;
  const runUrl = `https://github.com/${repository}/actions/runs/${String(runId)}`;
  const workflowRefPrefix = `${repository}/${PERF_REALISTIC_WORKFLOW_PATH}@`;
  if (
    github?.repository !== repository ||
    github?.serverUrl !== 'https://github.com' ||
    github?.runUrl !== runUrl ||
    String(github?.runId ?? '') !== String(runId) ||
    String(github?.runAttempt ?? '') !== String(run.run_attempt) ||
    github?.sha !== sourceSha ||
    github?.job !== policy.workflowJobKey ||
    !nonEmptyString(github?.workflowRef) ||
    !github.workflowRef.startsWith(workflowRefPrefix) ||
    !COMMIT_PATTERN.test(github?.eventSha ?? '') ||
    !COMMIT_PATTERN.test(github?.workflowSha ?? '') ||
    github.eventSha !== github.workflowSha
  ) {
    findings.push('Production bytes report execution differs from its workflow run and job');
  }
  if (report?.suite !== policy.cell || report?.options?.componentCount !== policy.componentCount) {
    findings.push('Production bytes suite or component-count identity differs');
  }
  findings.push(...workloadIdentityFindings(report?.workloadIdentity, 'Production bytes'));
  if (
    canonicalJson(report?.workloadIdentity) !==
    canonicalJson(
      performanceGateWorkloadIdentity(policy.cell, { componentCount: policy.componentCount }),
    )
  ) {
    findings.push('Production bytes workload differs from the exact gate wrapper and policy');
  }
  const expectedIntegrityKeys = [
    'complete',
    'executionAuthenticated',
    'publishable',
    'serialized',
    'sourceStable',
    'workloadAuthenticated',
  ];
  if (
    !ownRecord(report?.integrity) ||
    canonicalJson(Object.keys(report.integrity).sort()) !==
      canonicalJson(expectedIntegrityKeys.sort()) ||
    expectedIntegrityKeys.some((field) => report.integrity[field] !== true)
  ) {
    findings.push('Production bytes report integrity census is incomplete');
  }
  const metricNames = Object.keys(report?.metrics ?? {}).sort();
  if (
    !ownRecord(report?.metrics) ||
    canonicalJson(metricNames) !==
      canonicalJson([...PERF_PUBLICATION_PRODUCTION_BYTES_METRICS].sort())
  ) {
    findings.push('Production bytes report must contain the exact five metric census');
  } else {
    for (const metricName of PERF_PUBLICATION_PRODUCTION_BYTES_METRICS) {
      const observation = report.metrics[metricName];
      if (
        !ownRecord(observation) ||
        canonicalJson(Object.keys(observation)) !== canonicalJson(['value']) ||
        !Number.isSafeInteger(observation.value) ||
        observation.value < 0
      ) {
        findings.push(`Production bytes metric ${metricName} is malformed`);
      }
    }
  }
  if (
    report?.verdict?.status !== 'measured' ||
    canonicalJson(report?.verdict?.reasons) !== canonicalJson([])
  ) {
    findings.push('Production bytes report verdict is not measured');
  }
  if (findings.length > 0) throw new TypeError([...new Set(findings)].join('\n'));
}

async function writeCollectedEvidence(stagingDirectory, relativeRoot, reportMember, bytes) {
  const absoluteRoot = path.join(stagingDirectory, ...relativeRoot.split('/'));
  await mkdir(absoluteRoot, { mode: 0o700, recursive: true });
  const descriptor = {
    apiMetadata: path.posix.join(relativeRoot, 'artifact.api.json'),
    archive: path.posix.join(relativeRoot, 'artifact.zip'),
    jobsApiMetadata: path.posix.join(relativeRoot, 'jobs.api.json'),
    report: path.posix.join(relativeRoot, reportMember),
    runApiMetadata: path.posix.join(relativeRoot, 'run.api.json'),
  };
  await Promise.all([
    writeExclusive(
      path.join(stagingDirectory, ...descriptor.apiMetadata.split('/')),
      bytes.artifactApiBytes,
    ),
    writeExclusive(
      path.join(stagingDirectory, ...descriptor.archive.split('/')),
      bytes.archiveBytes,
    ),
    writeExclusive(
      path.join(stagingDirectory, ...descriptor.jobsApiMetadata.split('/')),
      bytes.jobsApiBytes,
    ),
    writeExclusive(path.join(stagingDirectory, ...descriptor.report.split('/')), bytes.reportBytes),
    writeExclusive(
      path.join(stagingDirectory, ...descriptor.runApiMetadata.split('/')),
      bytes.runApiBytes,
    ),
  ]);
  return descriptor;
}

async function writeExclusive(file, bytes) {
  await writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
}

async function writeContentAddressedCustodyFile(stagingDirectory, relativePath, bytes) {
  await mkdir(path.dirname(path.join(stagingDirectory, ...relativePath.split('/'))), {
    mode: 0o700,
    recursive: true,
  });
  await writeExclusive(path.join(stagingDirectory, ...relativePath.split('/')), bytes);
  return {
    byteLength: bytes.length,
    contentDigest: sha256(bytes),
    path: relativePath,
  };
}

function validateCampaignBoundary(boundary) {
  const firstRunId = campaignBoundaryRunId(boundary?.firstRunId, 'campaign first run id');
  const lastRunId = campaignBoundaryRunId(boundary?.lastRunId, 'campaign last run id');
  if (firstRunId > lastRunId) {
    throw new TypeError('campaign first run ID must not exceed its last run ID');
  }
  return { firstRunId, lastRunId };
}

function campaignBoundaryRunId(value, label) {
  const text = String(value ?? '');
  if (!/^[1-9][0-9]*$/u.test(text)) throw new TypeError(`${label} is unavailable`);
  const runId = Number(text);
  if (!Number.isSafeInteger(runId)) throw new TypeError(`${label} is unsafe`);
  return runId;
}

function validateCampaignRunCensus(listing, { boundary, requestedRunIds, sourceSha }) {
  if (
    !ownRecord(listing) ||
    !Number.isSafeInteger(listing.total_count) ||
    listing.total_count < 1 ||
    listing.total_count > MAX_CAMPAIGN_RUNS ||
    !Array.isArray(listing.workflow_runs) ||
    listing.total_count !== listing.workflow_runs.length
  ) {
    throw new TypeError('campaign workflow-runs API census is incomplete or exceeds one page');
  }
  const allIds = listing.workflow_runs.map((run) => run?.id);
  if (
    allIds.some((runId) => !Number.isSafeInteger(runId) || runId < 1) ||
    new Set(allIds).size !== allIds.length ||
    listing.workflow_runs.some(
      (run) =>
        run?.head_sha !== sourceSha ||
        run?.name !== PERF_REALISTIC_WORKFLOW_NAME ||
        run?.path !== PERF_REALISTIC_WORKFLOW_PATH ||
        !validTimestamp(run?.created_at),
    )
  ) {
    throw new TypeError('campaign workflow-runs API contains foreign or malformed run identity');
  }
  const runIds = listing.workflow_runs
    .filter((run) => run.id >= boundary.firstRunId && run.id <= boundary.lastRunId)
    .map((run) => run.id)
    .sort(numericOrder);
  if (
    !runIds.includes(boundary.firstRunId) ||
    !runIds.includes(boundary.lastRunId) ||
    canonicalJson(runIds) !== canonicalJson([...requestedRunIds].sort(numericOrder))
  ) {
    throw new TypeError(
      'requested run IDs must equal the complete preregistered campaign boundary census',
    );
  }
  return runIds;
}

function validateContentAddressedCustodyReference(value, label) {
  if (
    !ownRecord(value) ||
    canonicalJson(Object.keys(value).sort()) !==
      canonicalJson(['byteLength', 'contentDigest', 'path']) ||
    !Number.isSafeInteger(value.byteLength) ||
    value.byteLength < 1 ||
    !DIGEST_PATTERN.test(value.contentDigest ?? '') ||
    !safeRelativePath(value.path)
  ) {
    throw new TypeError(`${label} content-addressed custody reference is malformed`);
  }
}

function validateCampaignLedger(campaign, runIds) {
  if (
    !ownRecord(campaign) ||
    canonicalJson(Object.keys(campaign).sort()) !==
      canonicalJson(['boundary', 'runs', 'workflowRunsApiMetadata'])
  ) {
    throw new TypeError('collection campaign field census differs');
  }
  const boundary = validateCampaignBoundary(campaign.boundary);
  if (boundary.firstRunId !== Math.min(...runIds) || boundary.lastRunId !== Math.max(...runIds)) {
    throw new TypeError('collection run census differs from its preregistered campaign boundary');
  }
  validateContentAddressedCustodyReference(
    campaign.workflowRunsApiMetadata,
    'campaign workflow-runs API',
  );
  if (!Array.isArray(campaign.runs) || campaign.runs.length !== runIds.length) {
    throw new TypeError('collection campaign run chronology is incomplete');
  }
  for (const run of campaign.runs) {
    if (
      !ownRecord(run) ||
      canonicalJson(Object.keys(run).sort()) !==
        canonicalJson(['artifactsApiMetadata', 'runApiMetadata', 'runCreatedAt', 'runId']) ||
      !runIds.includes(run.runId) ||
      !validTimestamp(run.runCreatedAt)
    ) {
      throw new TypeError('collection campaign run identity is malformed');
    }
    validateContentAddressedCustodyReference(
      run.artifactsApiMetadata,
      `campaign run ${String(run.runId)} artifacts API`,
    );
    validateContentAddressedCustodyReference(
      run.runApiMetadata,
      `campaign run ${String(run.runId)} run API`,
    );
  }
  if (
    new Set(campaign.runs.map((run) => run.runId)).size !== runIds.length ||
    canonicalJson([...campaign.runs].sort(campaignRunOrder)) !== canonicalJson(campaign.runs)
  ) {
    throw new TypeError('collection campaign chronology is duplicated or not canonical');
  }
}

function validateCollectionLedger(ledger, { repository, sourceSha }) {
  const keys = [
    'campaign',
    'candidates',
    'productionBytes',
    'repository',
    'runIds',
    'schema',
    'sourceCommit',
  ];
  if (
    !ownRecord(ledger) ||
    ledger.schema !== PERF_PUBLICATION_COLLECTION_SCHEMA ||
    canonicalJson(Object.keys(ledger).sort()) !== canonicalJson(keys.sort()) ||
    ledger.repository !== repository ||
    ledger.sourceCommit !== sourceSha
  ) {
    throw new TypeError('collection ledger identity or field census differs');
  }
  validateRunIds(ledger.runIds);
  validateCampaignLedger(ledger.campaign, ledger.runIds);
  if (
    !Array.isArray(ledger.candidates) ||
    ledger.candidates.length > PERF_PUBLICATION_FAMILY_NAMES.length * ledger.runIds.length
  ) {
    throw new TypeError('collection family candidate census exceeds its run boundary');
  }
  for (const entry of ledger.candidates) validateLedgerCandidate(entry, ledger.runIds);
  if (
    !Array.isArray(ledger.productionBytes) ||
    ledger.productionBytes.length > ledger.runIds.length
  ) {
    throw new TypeError('collection Production bytes census exceeds its run boundary');
  }
  for (const entry of ledger.productionBytes) {
    validateProductionBytesLedgerCandidate(entry, ledger.runIds);
  }
  if (ledger.candidates.length === 0 && ledger.productionBytes.length === 0) {
    throw new TypeError('collection candidate census is empty');
  }
}

function validateLedgerCandidate(entry, runIds) {
  const keys = [
    'artifactId',
    'cohortDigest',
    'descriptor',
    'executionDigest',
    'family',
    'hostDigest',
    'runCreatedAt',
    'runId',
  ];
  if (
    !ownRecord(entry) ||
    canonicalJson(Object.keys(entry).sort()) !== canonicalJson(keys.sort()) ||
    !runIds.includes(entry.runId) ||
    !Number.isSafeInteger(entry.artifactId) ||
    entry.artifactId < 1 ||
    !DIGEST_PATTERN.test(entry.cohortDigest ?? '') ||
    !DIGEST_PATTERN.test(entry.executionDigest ?? '') ||
    !DIGEST_PATTERN.test(entry.hostDigest ?? '') ||
    !validTimestamp(entry.runCreatedAt)
  ) {
    throw new TypeError('collection candidate identity or field census differs');
  }
  requiredFamilyPolicy(entry.family);
  validateEvidenceDescriptor(entry.descriptor);
}

function validateProductionBytesLedgerCandidate(entry, runIds) {
  const keys = ['artifactId', 'descriptor', 'executionDigest', 'runCreatedAt', 'runId'];
  if (
    !ownRecord(entry) ||
    canonicalJson(Object.keys(entry).sort()) !== canonicalJson(keys.sort()) ||
    !runIds.includes(entry.runId) ||
    !Number.isSafeInteger(entry.artifactId) ||
    entry.artifactId < 1 ||
    !DIGEST_PATTERN.test(entry.executionDigest ?? '') ||
    !validTimestamp(entry.runCreatedAt)
  ) {
    throw new TypeError('collection Production bytes identity or field census differs');
  }
  validateEvidenceDescriptor(entry.descriptor);
}

function validateEvidenceDescriptor(descriptor) {
  if (
    !ownRecord(descriptor) ||
    canonicalJson(Object.keys(descriptor).sort()) !== canonicalJson([...EVIDENCE_KEYS].sort())
  ) {
    throw new TypeError('custody descriptor must contain the exact five publication paths');
  }
  for (const key of EVIDENCE_KEYS) {
    if (!safeRelativePath(descriptor[key])) {
      throw new TypeError(`${key} is not a canonical safe relative path`);
    }
  }
  if (new Set(EVIDENCE_KEYS.map((key) => descriptor[key])).size !== EVIDENCE_KEYS.length) {
    throw new TypeError('custody descriptor paths alias one another');
  }
}

async function loadCollectedCampaign(
  collectionRoot,
  campaign,
  { repository, seenFiles, seenInodes, sourceSha },
) {
  const workflowRunsApi = await loadContentAddressedCustodyReference(
    collectionRoot,
    campaign.workflowRunsApiMetadata,
    'campaign workflow-runs API',
    { seenFiles, seenInodes },
  );
  const listing = parseJsonBytes(workflowRunsApi.bytes, 'campaign workflow-runs API');
  const expectedRunIds = campaign.runs.map((run) => run.runId).sort(numericOrder);
  const authenticatedRunIds = validateCampaignRunCensus(listing, {
    boundary: campaign.boundary,
    requestedRunIds: expectedRunIds,
    sourceSha,
  });
  const artifactListings = new Map();
  const runs = [];
  for (const run of campaign.runs) {
    const [runApi, artifactsApi] = await Promise.all([
      loadContentAddressedCustodyReference(
        collectionRoot,
        run.runApiMetadata,
        `campaign run ${String(run.runId)} run API`,
        { seenFiles, seenInodes },
      ),
      loadContentAddressedCustodyReference(
        collectionRoot,
        run.artifactsApiMetadata,
        `campaign run ${String(run.runId)} artifacts API`,
        { seenFiles, seenInodes },
      ),
    ]);
    const runMetadata = parseJsonBytes(runApi.bytes, 'campaign workflow run API');
    validateRunMetadata(runMetadata, {
      repository,
      runId: run.runId,
      sourceSha,
    });
    if (runMetadata.created_at !== run.runCreatedAt) {
      throw new TypeError('campaign run created_at differs from raw run authority');
    }
    const artifactListing = parseJsonBytes(artifactsApi.bytes, 'campaign run artifacts API');
    enumeratePublicationArtifacts(artifactListing, run.runId);
    artifactListings.set(run.runId, artifactListing);
    runs.push({
      ...run,
      artifactsApiFile: artifactsApi.fileFacts,
      runApiFile: runApi.fileFacts,
    });
  }
  if (canonicalJson(authenticatedRunIds) !== canonicalJson(expectedRunIds)) {
    throw new TypeError('campaign run chronology differs from its workflow-runs authority');
  }
  return {
    boundary: campaign.boundary,
    artifactListings,
    runs,
    workflowRunsApiFile: workflowRunsApi.fileFacts,
    workflowRunsApiMetadata: campaign.workflowRunsApiMetadata,
  };
}

async function loadContentAddressedCustodyReference(
  root,
  reference,
  label,
  { seenFiles, seenInodes },
) {
  validateContentAddressedCustodyReference(reference, label);
  const file = path.resolve(root, ...reference.path.split('/'));
  if (!containedBy(root, file)) throw new TypeError(`${label} escapes its collection root`);
  const facts = await boundedRegularFile(file, MAX_API_BYTES, label);
  if (
    facts.realPath !== file ||
    facts.linkCount !== 1 ||
    facts.bytes.length !== reference.byteLength ||
    sha256(facts.bytes) !== reference.contentDigest
  ) {
    throw new TypeError(`${label} differs from its content-addressed custody reference`);
  }
  const inode = `${String(facts.device)}:${String(facts.inode)}`;
  if (seenFiles.has(file) || seenInodes.has(inode)) {
    throw new TypeError(`${label} aliases another collection custody file`);
  }
  seenFiles.add(file);
  seenInodes.add(inode);
  return {
    bytes: facts.bytes,
    fileFacts: {
      byteLength: facts.bytes.length,
      contentDigest: sha256(facts.bytes),
      device: facts.device,
      file,
      inode: facts.inode,
    },
  };
}

function validateCampaignCandidateInventory(
  runs,
  candidates,
  productionBytes,
  { artifactListings },
) {
  const expectedFamilies = [];
  const expectedProduction = [];
  for (const run of runs) {
    const listing = artifactListings.get(run.runId);
    if (listing === undefined) {
      throw new TypeError(`campaign run ${String(run.runId)} artifact listing is unavailable`);
    }
    for (const artifact of enumeratePublicationArtifacts(listing, run.runId)) {
      if (artifact.kind === 'family') {
        expectedFamilies.push({
          artifactId: artifact.artifactId,
          family: artifact.familyName,
          runId: run.runId,
        });
      } else {
        expectedProduction.push({ artifactId: artifact.artifactId, runId: run.runId });
      }
    }
  }
  const actualFamilies = candidates.map(({ artifactId, family, runId }) => ({
    artifactId,
    family,
    runId,
  }));
  const actualProduction = productionBytes.map(({ artifactId, runId }) => ({ artifactId, runId }));
  const order = (left, right) =>
    numericOrder(left.runId, right.runId) ||
    numericOrder(left.artifactId, right.artifactId) ||
    String(left.family ?? '').localeCompare(String(right.family ?? ''));
  if (
    canonicalJson(expectedFamilies.sort(order)) !== canonicalJson(actualFamilies.sort(order)) ||
    canonicalJson(expectedProduction.sort(order)) !== canonicalJson(actualProduction.sort(order))
  ) {
    throw new TypeError(
      'collection candidate inventory omits or invents a campaign artifact-listing candidate',
    );
  }
}

async function loadCollectedCandidate(
  collectionRoot,
  ledgerEntry,
  { repository, seenFiles, seenInodes, sourceSha },
) {
  const { bytes, files } = await loadCollectedEvidenceFiles(
    collectionRoot,
    ledgerEntry.descriptor,
    ledgerEntry.family,
    { seenFiles, seenInodes },
  );
  const validated = validateCollectedCandidateBytes({
    archiveBytes: bytes.archive,
    artifactApiBytes: bytes.apiMetadata,
    expectedArtifactId: ledgerEntry.artifactId,
    familyName: ledgerEntry.family,
    jobsApiBytes: bytes.jobsApiMetadata,
    reportBytes: bytes.report,
    repository,
    runApiBytes: bytes.runApiMetadata,
    sourceSha,
  });
  const expectedLedgerFacts = { ...validated.summary, descriptor: ledgerEntry.descriptor };
  if (canonicalJson(expectedLedgerFacts) !== canonicalJson(ledgerEntry)) {
    throw new TypeError(`${ledgerEntry.family} collection ledger differs from raw custody bytes`);
  }
  return { ...validated.summary, descriptorFiles: files, report: validated.report };
}

async function loadCollectedProductionBytesCandidate(
  collectionRoot,
  ledgerEntry,
  { repository, seenFiles, seenInodes, sourceSha },
) {
  const { bytes, files } = await loadCollectedEvidenceFiles(
    collectionRoot,
    ledgerEntry.descriptor,
    'Production bytes',
    { seenFiles, seenInodes },
  );
  const validated = validateCollectedProductionBytesCandidateBytes({
    archiveBytes: bytes.archive,
    artifactApiBytes: bytes.apiMetadata,
    expectedArtifactId: ledgerEntry.artifactId,
    jobsApiBytes: bytes.jobsApiMetadata,
    reportBytes: bytes.report,
    repository,
    runApiBytes: bytes.runApiMetadata,
    sourceSha,
  });
  const expectedLedgerFacts = { ...validated.summary, descriptor: ledgerEntry.descriptor };
  if (canonicalJson(expectedLedgerFacts) !== canonicalJson(ledgerEntry)) {
    throw new TypeError('Production bytes collection ledger differs from raw custody bytes');
  }
  return { ...validated.summary, descriptorFiles: files, report: validated.report };
}

async function loadCollectedEvidenceFiles(
  collectionRoot,
  descriptor,
  label,
  { seenFiles, seenInodes },
) {
  const files = {};
  const bytes = {};
  const limits = {
    apiMetadata: MAX_API_BYTES,
    archive: MAX_ARCHIVE_BYTES,
    jobsApiMetadata: MAX_API_BYTES,
    report: MAX_REPORT_BYTES,
    runApiMetadata: MAX_API_BYTES,
  };
  for (const key of EVIDENCE_KEYS) {
    const file = path.resolve(collectionRoot, ...descriptor[key].split('/'));
    if (!containedBy(collectionRoot, file)) {
      throw new TypeError(`${label} ${key} escapes its collection root`);
    }
    const facts = await boundedRegularFile(file, limits[key], `${label} ${key}`);
    if (facts.realPath !== file || facts.linkCount !== 1) {
      throw new TypeError(`${label} ${key} is a symlink or hardlink alias`);
    }
    const inode = `${String(facts.device)}:${String(facts.inode)}`;
    if (seenFiles.has(file) || seenInodes.has(inode)) {
      throw new TypeError(`${label} custody files alias another candidate`);
    }
    seenFiles.add(file);
    seenInodes.add(inode);
    files[key] = {
      byteLength: facts.bytes.length,
      contentDigest: sha256(facts.bytes),
      device: facts.device,
      file,
      inode: facts.inode,
    };
    bytes[key] = facts.bytes;
  }
  return { bytes, files };
}

async function boundedRegularFile(file, maximumBytes, label) {
  const [facts, resolved] = await Promise.all([lstat(file), realpath(file)]);
  if (!facts.isFile() || facts.isSymbolicLink() || facts.size < 1 || facts.size > maximumBytes) {
    throw new TypeError(`${label} is not a bounded regular file`);
  }
  const bytes = await readFile(file);
  if (bytes.length !== facts.size || bytes.length > maximumBytes) {
    throw new TypeError(`${label} changed or exceeded its bound while being read`);
  }
  const after = await stat(file);
  if (
    after.dev !== facts.dev ||
    after.ino !== facts.ino ||
    after.size !== facts.size ||
    after.mtimeMs !== facts.mtimeMs
  ) {
    throw new TypeError(`${label} changed while being read`);
  }
  return {
    bytes,
    device: facts.dev,
    inode: facts.ino,
    linkCount: facts.nlink,
    realPath: resolved,
  };
}

function validateCandidateDistinctness(candidates, { allowSharedRunAcrossFamilies }) {
  const seenArtifactIds = new Set();
  const seenExecutionIds = new Set();
  const seenRunFamilies = new Set();
  const seenRuns = new Set();
  for (const candidate of candidates) {
    validateBasicCandidateFacts(candidate, candidate?.family);
    if (candidate.report !== undefined) {
      validateCandidateSelectionFacts(candidate, candidate.family);
    }
    if (seenArtifactIds.has(candidate.artifactId))
      throw new TypeError('duplicate artifact identity');
    if (seenExecutionIds.has(candidate.executionDigest)) {
      throw new TypeError('duplicate execution identity');
    }
    const runFamily = `${String(candidate.runId)}:${candidate.family}`;
    if (seenRunFamilies.has(runFamily)) throw new TypeError('duplicate family workflow run');
    if (!allowSharedRunAcrossFamilies && seenRuns.has(candidate.runId)) {
      throw new TypeError('duplicate workflow run identity');
    }
    seenArtifactIds.add(candidate.artifactId);
    seenExecutionIds.add(candidate.executionDigest);
    seenRunFamilies.add(runFamily);
    seenRuns.add(candidate.runId);
  }
}

function validateProductionBytesCandidateDistinctness(candidates) {
  const artifacts = new Set();
  const executions = new Set();
  const runs = new Set();
  for (const candidate of candidates) {
    if (
      !ownRecord(candidate) ||
      !Number.isSafeInteger(candidate.artifactId) ||
      candidate.artifactId < 1 ||
      !Number.isSafeInteger(candidate.runId) ||
      candidate.runId < 1 ||
      !DIGEST_PATTERN.test(candidate.executionDigest ?? '') ||
      !validTimestamp(candidate.runCreatedAt) ||
      (candidate.report !== undefined &&
        candidate.report?.execution?.digest !== candidate.executionDigest)
    ) {
      throw new TypeError('Production bytes candidate identity facts are incomplete');
    }
    if (artifacts.has(candidate.artifactId)) {
      throw new TypeError('duplicate Production bytes artifact identity');
    }
    if (executions.has(candidate.executionDigest)) {
      throw new TypeError('duplicate Production bytes execution identity');
    }
    if (runs.has(candidate.runId)) {
      throw new TypeError('duplicate Production bytes workflow run');
    }
    artifacts.add(candidate.artifactId);
    executions.add(candidate.executionDigest);
    runs.add(candidate.runId);
  }
}

function validateCrossInventoryDistinctness(candidates, productionBytes) {
  const familyArtifacts = new Set(candidates.map((candidate) => candidate.artifactId));
  const familyExecutions = new Set(candidates.map((candidate) => candidate.executionDigest));
  if (
    productionBytes.some(
      (candidate) =>
        familyArtifacts.has(candidate.artifactId) ||
        familyExecutions.has(candidate.executionDigest),
    )
  ) {
    throw new TypeError('Production bytes custody aliases a ratified family artifact or execution');
  }
}

function validateBasicCandidateFacts(candidate, familyName) {
  requiredFamilyPolicy(familyName);
  if (
    !ownRecord(candidate) ||
    candidate.family !== familyName ||
    !Number.isSafeInteger(candidate.runId) ||
    candidate.runId < 1 ||
    !Number.isSafeInteger(candidate.artifactId) ||
    candidate.artifactId < 1 ||
    !DIGEST_PATTERN.test(candidate.executionDigest ?? '') ||
    !DIGEST_PATTERN.test(candidate.hostDigest ?? '') ||
    !validTimestamp(candidate.runCreatedAt)
  ) {
    throw new TypeError(`${String(familyName)} candidate identity facts are incomplete`);
  }
}

function validateCandidateSelectionFacts(candidate, familyName) {
  validateBasicCandidateFacts(candidate, familyName);
  if (
    !ownRecord(candidate.report) ||
    candidate.report?.execution?.digest !== candidate.executionDigest ||
    candidate.report?.host?.digest !== candidate.hostDigest
  ) {
    throw new TypeError(`${String(familyName)} candidate selection facts are incomplete`);
  }
}

function requireSixDistinct(candidates, familyName) {
  if (candidates.length !== 6) throw new TypeError(`${familyName} selection is not six reports`);
  for (const { label, select } of [
    { label: 'run', select: (candidate) => candidate.runId },
    { label: 'artifact', select: (candidate) => candidate.artifactId },
    { label: 'execution', select: (candidate) => candidate.executionDigest },
  ]) {
    if (new Set(candidates.map(select)).size !== 6) {
      throw new TypeError(`${familyName} selected ${label} identities are not distinct`);
    }
  }
}

function validateSelectedPublicationIdentity(selected, productionBytes, sourceSha) {
  const all = PERF_PUBLICATION_FAMILY_NAMES.flatMap((familyName) => selected[familyName] ?? []);
  if (all.length !== 42) throw new TypeError('selected publication census is not 42 reports');
  const locks = all.map((candidate) => canonicalJson(candidate.report?.source?.locks));
  if (new Set(locks).size !== 1) {
    throw new TypeError('selected families do not share one exact dependency-lock identity');
  }
  if (all.some((candidate) => candidate.report?.source?.commit !== sourceSha)) {
    throw new TypeError('selected families do not share the exact requested source');
  }
  if (
    productionBytes?.report?.source?.commit !== sourceSha ||
    productionBytes?.report?.sourceAfter?.commit !== sourceSha ||
    canonicalJson(productionBytes?.report?.source?.locks) !== locks[0] ||
    canonicalJson(productionBytes?.report?.sourceAfter?.locks) !== locks[0]
  ) {
    throw new TypeError(
      'selected Production bytes sidecar does not share the exact source and dependency locks',
    );
  }
  const packed = all.filter(
    (candidate) => PERF_PUBLICATION_FAMILIES[candidate.family].packedProduct,
  );
  const products = packed.map((candidate) => canonicalJson(candidate.report?.productArtifact));
  if (new Set(products).size !== 1) {
    throw new TypeError('selected dev/build families do not share one concrete packed product');
  }
  validateCandidateDistinctness(all, { allowSharedRunAcrossFamilies: true });
  validateProductionBytesCandidateDistinctness([productionBytes]);
  validateCrossInventoryDistinctness(all, [productionBytes]);
}

async function copyCandidateCustody(
  stagingDirectory,
  familyName,
  slot,
  candidate,
  reportMember,
  { relativeRoot: requestedRelativeRoot, topLevel = false } = {},
) {
  const member = reportMember ?? requiredFamilyPolicy(familyName).reportMember;
  const relativeRoot =
    requestedRelativeRoot ??
    (topLevel ? path.posix.join(familyName, slot) : path.posix.join('families', familyName, slot));
  const targetRoot = path.join(stagingDirectory, ...relativeRoot.split('/'));
  await mkdir(targetRoot, { mode: 0o700, recursive: true });
  const descriptor = {
    apiMetadata: path.posix.join(relativeRoot, 'artifact.api.json'),
    archive: path.posix.join(relativeRoot, 'artifact.zip'),
    jobsApiMetadata: path.posix.join(relativeRoot, 'jobs.api.json'),
    report: path.posix.join(relativeRoot, member),
    runApiMetadata: path.posix.join(relativeRoot, 'run.api.json'),
  };
  for (const key of EVIDENCE_KEYS) {
    const source = candidate.descriptorFiles?.[key];
    if (!ownRecord(source))
      throw new TypeError(`${familyName} ${slot} ${key} source is unavailable`);
    const maximum =
      key === 'archive' ? MAX_ARCHIVE_BYTES : key === 'report' ? MAX_REPORT_BYTES : MAX_API_BYTES;
    const current = await boundedRegularFile(source.file, maximum, `${familyName} ${slot} ${key}`);
    if (
      current.device !== source.device ||
      current.inode !== source.inode ||
      current.bytes.length !== source.byteLength ||
      sha256(current.bytes) !== source.contentDigest
    ) {
      throw new TypeError(`${familyName} ${slot} ${key} changed after cohort selection`);
    }
    await writeExclusive(path.join(stagingDirectory, ...descriptor[key].split('/')), current.bytes);
  }
  return descriptor;
}

async function copyCampaignCustody(
  stagingDirectory,
  campaign,
  { candidates, cohortSelections, productionBytesCandidates, selectedProductionBytes },
) {
  if (!ownRecord(campaign) || !Array.isArray(campaign.runs)) {
    throw new TypeError('authenticated campaign custody is unavailable');
  }
  if (!Array.isArray(candidates)) {
    throw new TypeError('complete family candidate custody is unavailable');
  }
  if (!Array.isArray(productionBytesCandidates)) {
    throw new TypeError('complete Production bytes candidate custody is unavailable');
  }
  const workflowRunsApiMetadata = await copyContentAddressedCustodyFile(
    stagingDirectory,
    'campaign/workflow-runs.api.json',
    campaign.workflowRunsApiFile,
    'campaign workflow-runs API',
  );
  const runs = [];
  for (const run of campaign.runs) {
    const relativeRoot = path.posix.join('campaign', 'runs', String(run.runId));
    const [runApiMetadata, artifactsApiMetadata] = await Promise.all([
      copyContentAddressedCustodyFile(
        stagingDirectory,
        path.posix.join(relativeRoot, 'run.api.json'),
        run.runApiFile,
        `campaign run ${String(run.runId)} run API`,
      ),
      copyContentAddressedCustodyFile(
        stagingDirectory,
        path.posix.join(relativeRoot, 'artifacts.api.json'),
        run.artifactsApiFile,
        `campaign run ${String(run.runId)} artifacts API`,
      ),
    ]);
    runs.push({
      artifactsApiMetadata,
      runApiMetadata,
      runCreatedAt: run.runCreatedAt,
      runId: run.runId,
    });
  }
  const productionBytes = [];
  for (const run of runs) {
    const listing = campaign.artifactListings.get(run.runId);
    for (const artifact of enumeratePublicationArtifacts(listing, run.runId)) {
      if (artifact.kind === 'production-bytes') {
        productionBytes.push({
          artifactId: artifact.artifactId,
          runCreatedAt: run.runCreatedAt,
          runId: run.runId,
        });
      }
    }
  }
  productionBytes.sort(candidateChronologyOrder);
  const familyCandidates = [];
  for (const candidate of [...candidates].sort(candidateInventoryOrder)) {
    const relativeRoot = path.posix.join(
      'campaign',
      'candidates',
      candidate.family,
      `${String(candidate.runId)}-${String(candidate.artifactId)}`,
    );
    const descriptor = await copyCandidateCustody(
      stagingDirectory,
      candidate.family,
      'campaign-candidate',
      candidate,
      undefined,
      { relativeRoot },
    );
    familyCandidates.push({
      artifactId: candidate.artifactId,
      cohortDigest: candidate.cohortDigest,
      descriptor,
      executionDigest: candidate.executionDigest,
      family: candidate.family,
      hostDigest: candidate.hostDigest,
      runCreatedAt: candidate.runCreatedAt,
      runId: candidate.runId,
    });
  }
  const productionBytesCandidateCustody = [];
  for (const candidate of [...productionBytesCandidates].sort(candidateChronologyOrder)) {
    const relativeRoot = path.posix.join(
      'campaign',
      'candidates',
      'production-bytes',
      `${String(candidate.runId)}-${String(candidate.artifactId)}`,
    );
    const descriptor = await copyCandidateCustody(
      stagingDirectory,
      'production-bytes',
      'campaign-candidate',
      candidate,
      PERF_PUBLICATION_PRODUCTION_BYTES.reportMember,
      { relativeRoot },
    );
    productionBytesCandidateCustody.push({
      artifactId: candidate.artifactId,
      descriptor,
      executionDigest: candidate.executionDigest,
      runCreatedAt: candidate.runCreatedAt,
      runId: candidate.runId,
    });
  }
  const selected = {
    artifactId: selectedProductionBytes.artifactId,
    runCreatedAt: selectedProductionBytes.runCreatedAt,
    runId: selectedProductionBytes.runId,
  };
  if (canonicalJson(productionBytes[0]) !== canonicalJson(selected)) {
    throw new TypeError('selected Production bytes sidecar is not first in campaign chronology');
  }
  return {
    boundary: campaign.boundary,
    cohortSelections: Object.fromEntries(
      [...cohortSelections].sort(([left], [right]) => left.localeCompare(right)),
    ),
    familyCandidates,
    productionBytes,
    productionBytesCandidates: productionBytesCandidateCustody,
    runs,
    selectedProductionBytes: selected,
    workflowRunsApiMetadata,
  };
}

async function copyContentAddressedCustodyFile(stagingDirectory, relativePath, source, label) {
  if (!ownRecord(source)) throw new TypeError(`${label} source is unavailable`);
  const current = await boundedRegularFile(source.file, MAX_API_BYTES, label);
  if (
    current.device !== source.device ||
    current.inode !== source.inode ||
    current.bytes.length !== source.byteLength ||
    sha256(current.bytes) !== source.contentDigest
  ) {
    throw new TypeError(`${label} changed after campaign authentication`);
  }
  return writeContentAddressedCustodyFile(stagingDirectory, relativePath, current.bytes);
}

function selectedInventory(selected) {
  return Object.fromEntries(
    PERF_PUBLICATION_FAMILY_NAMES.map((familyName) => [
      familyName,
      selected[familyName].map((candidate, index) => ({
        artifactId: candidate.artifactId,
        cohortDigest: candidate.cohortDigest,
        role: index < 5 ? 'baseline' : 'holdout',
        runCreatedAt: candidate.runCreatedAt,
        runId: candidate.runId,
      })),
    ]),
  );
}

function candidateChronologyOrder(left, right) {
  const timestamp = Date.parse(left.runCreatedAt) - Date.parse(right.runCreatedAt);
  return timestamp === 0 ? numericOrder(left.runId, right.runId) : timestamp;
}

function campaignRunOrder(left, right) {
  return candidateChronologyOrder(left, right);
}

function candidateInventoryOrder(left, right) {
  const chronology = candidateChronologyOrder(left, right);
  if (chronology !== 0) return chronology;
  const family =
    PERF_PUBLICATION_FAMILY_NAMES.indexOf(left.family) -
    PERF_PUBLICATION_FAMILY_NAMES.indexOf(right.family);
  return family === 0 ? numericOrder(left.artifactId, right.artifactId) : family;
}

function numericOrder(left, right) {
  return left === right ? 0 : left < right ? -1 : 1;
}

async function resolveExternalDirectory(value, checkoutRoot, label) {
  if (!nonEmptyString(value)) throw new TypeError(`${label} directory is required`);
  const requested = path.resolve(value);
  const resolved = await realpath(requested);
  const facts = await lstat(requested);
  if (!facts.isDirectory() || facts.isSymbolicLink()) {
    throw new TypeError(`${label} path is not a real directory`);
  }
  if (pathsOverlap(checkoutRoot, resolved)) {
    throw new TypeError(
      `${label} directory must remain outside and disjoint from the measured checkout`,
    );
  }
  return resolved;
}

function pathsOverlap(left, right) {
  return containedBy(left, right) || containedBy(right, left);
}

function containedBy(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function safeRelativePath(value) {
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

function validTimestamp(value) {
  return (
    nonEmptyString(value) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
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

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function runApiPath(repository, runId) {
  return `repos/${repository}/actions/runs/${String(runId)}`;
}

function campaignRunsApiPath(repository, sourceSha) {
  return `repos/${repository}/actions/workflows/perf-realistic.yml/runs?head_sha=${sourceSha}&per_page=100`;
}

function runApiUrl(repository, runId) {
  return `https://api.github.com/${runApiPath(repository, runId)}`;
}

function artifactApiPath(repository, artifactId) {
  return `repos/${repository}/actions/artifacts/${String(artifactId)}`;
}

function artifactApiUrl(repository, artifactId) {
  return `https://api.github.com/${artifactApiPath(repository, artifactId)}`;
}

function requireOperation(operations, name) {
  if (typeof operations?.[name] !== 'function') {
    throw new TypeError(`${name} operation is required`);
  }
}

export function defaultCollectionOperations() {
  return {
    async fetchApi(endpoint, { label, maximumBytes }) {
      if (!nonEmptyString(endpoint) || endpoint.startsWith('/') || endpoint.includes('\0')) {
        throw new TypeError('GitHub API endpoint is unsafe');
      }
      let stdout;
      try {
        ({ stdout } = await execFileAsync('gh', ['api', endpoint], {
          encoding: 'buffer',
          maxBuffer: maximumBytes + 1,
          timeout: maximumBytes === MAX_ARCHIVE_BYTES ? 5 * 60_000 : 30_000,
        }));
      } catch (error) {
        throw new TypeError(
          `authenticated GitHub ${label} request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return stdout;
    },
    async inspectCheckout(directory) {
      const [{ stdout: root }, { stdout: head }, { stdout: statusOutput }] = await Promise.all([
        execFileAsync('git', ['rev-parse', '--show-toplevel'], {
          cwd: directory,
          encoding: 'utf8',
          maxBuffer: MAX_API_BYTES,
          timeout: 30_000,
        }),
        execFileAsync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
          cwd: directory,
          encoding: 'utf8',
          maxBuffer: MAX_API_BYTES,
          timeout: 30_000,
        }),
        execFileAsync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
          cwd: directory,
          encoding: 'utf8',
          maxBuffer: MAX_API_BYTES,
          timeout: 30_000,
        }),
      ]);
      return { head: head.trim(), root: root.trim(), status: statusOutput };
    },
    now() {
      return new Date().toISOString();
    },
  };
}

function parseCli(args) {
  const mode = args[0];
  if (!['collect', 'manifest'].includes(mode)) {
    throw new TypeError('first argument must be collect or manifest');
  }
  const values = new Map();
  const repeated = new Map([
    ['--cohort', []],
    ['--collection', []],
    ['--run', []],
  ]);
  for (let index = 1; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!nonEmptyString(value) || value.startsWith('--')) {
      throw new TypeError(`incomplete option ${String(key)}`);
    }
    if (repeated.has(key)) {
      repeated.get(key).push(value);
    } else if (
      [
        '--campaign-first-run',
        '--campaign-last-run',
        '--checkout',
        '--out',
        '--repository',
        '--source',
      ].includes(key)
    ) {
      if (values.has(key)) throw new TypeError(`duplicate option ${key}`);
      values.set(key, value);
    } else {
      throw new TypeError(`unknown option ${String(key)}`);
    }
  }
  const common = {
    checkoutDirectory: requiredCliValue(values, '--checkout'),
    outDirectory: requiredCliValue(values, '--out'),
    repository: requiredCliValue(values, '--repository'),
    sourceSha: requiredCliValue(values, '--source'),
  };
  if (mode === 'collect') {
    if (repeated.get('--collection').length > 0 || repeated.get('--cohort').length > 0) {
      throw new TypeError('collect mode accepts --run, not --collection or --cohort');
    }
    return {
      ...common,
      campaignFirstRunId: requiredCliValue(values, '--campaign-first-run'),
      campaignLastRunId: requiredCliValue(values, '--campaign-last-run'),
      mode,
      runIds: repeated.get('--run'),
    };
  }
  if (repeated.get('--run').length > 0) {
    throw new TypeError('manifest mode accepts --collection, not --run');
  }
  if (values.has('--campaign-first-run') || values.has('--campaign-last-run')) {
    throw new TypeError('campaign boundaries are preregistered in collect mode, not manifest mode');
  }
  const cohortSelections = new Map();
  for (const selection of repeated.get('--cohort')) {
    const selectionText = String(selection);
    const match = /^([a-z0-9-]+)=(sha256:[0-9a-f]{64})$/u.exec(selectionText);
    if (match === null || cohortSelections.has(match[1])) {
      throw new TypeError(`invalid or duplicate --cohort ${selectionText}`);
    }
    cohortSelections.set(match[1], match[2]);
  }
  return {
    ...common,
    cohortSelections,
    collectionDirectories: repeated.get('--collection'),
    mode,
  };
}

function requiredCliValue(values, key) {
  const value = values.get(key);
  if (!nonEmptyString(value)) throw new TypeError(`${key} is required`);
  return value;
}

async function main(args) {
  const options = parseCli(args);
  if (options.mode === 'collect') {
    const result = await collectPerformancePublicationRuns(options);
    process.stdout.write(
      `${PERF_PUBLICATION_COLLECTION_SCHEMA} ${result.directory} ${String(result.ledger.candidates.length)} candidates\n`,
    );
    for (const familyName of PERF_PUBLICATION_FAMILY_NAMES) {
      const groups = new Map();
      for (const candidate of result.ledger.candidates.filter(
        (entry) => entry.family === familyName,
      )) {
        groups.set(candidate.cohortDigest, (groups.get(candidate.cohortDigest) ?? 0) + 1);
      }
      for (const [digest, count] of [...groups].sort(([left], [right]) =>
        left.localeCompare(right),
      )) {
        process.stdout.write(`${familyName} ${digest} ${String(count)} reports\n`);
      }
    }
    return;
  }
  const result = await createPerformancePublicationManifest(options);
  process.stdout.write(
    `${PERF_PUBLICATION_INPUT_SCHEMA} ${path.join(result.directory, 'performance-publication-input.json')}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
