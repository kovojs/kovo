#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  PERF_REALISTIC_WORKFLOW_PATH,
  authenticatePerformanceArtifactEvidence,
  createPerformanceArtifactDescriptorCustody,
  fetchGitHubCampaignWorkflowRunsApiResponse,
  fetchGitHubWorkflowArtifactsApiResponse,
  fetchGitHubWorkflowJobsApiResponse,
  fetchGitHubWorkflowRunApiResponse,
  readPerformanceArtifactCustodyFile,
  snapshotPerformanceArtifactCustodyFile,
  verifyPerformanceArtifactCustodyFileSnapshot,
} from './lib/perf-artifact-custody.mjs';
import { executionIdentityFindings } from './lib/perf-execution.mjs';
import {
  buildProfileConfigStaticTrustRequired,
  deriveBuildProfileSetAnalysis,
  PERF_BUILD_PROFILE_REQUIRED_ROLES,
} from './lib/perf-build-profile-classifier.mjs';
import {
  BUILD_PROFILE_PROCESS_CENSUS_SCHEMA,
  BUILD_PROFILE_PROCESS_ROLE_CLASSIFIER,
  deriveBuildProcessCpuEvidence,
  mergeBuildProcessProfiles,
} from './perf-build-session-profile.mjs';
import { ratifyPerformanceBaseline } from './perf-baseline-ratify.mjs';
import {
  comparisonBudgetBaselineFindings,
  comparisonBudgetFindings,
  comparisonTargetCheckSpecifications,
  deriveComparisonPerformanceBudget,
  evaluateComparisonPerformanceBudget,
} from './perf-comparison-budget.mjs';
import {
  PERF_BUILD_SESSION_PROFILE_CLASSIFIER,
  PERF_BUILD_SESSION_PROFILE_SCHEMA,
  assessBuildForegroundSession,
  buildBudgetBaselineFindings,
  buildPersistenceAssessmentFindings,
  buildBudgetFindings,
  deriveBuildPerformanceBudget,
  evaluateBuildPerformanceBudget,
} from './perf-build-budget.mjs';
import {
  checkBudgetBaselineFindings,
  checkBudgetFindings,
  deriveCheckPerformanceBudget,
  evaluateCheckPerformanceBudget,
} from './perf-check-budget.mjs';
import {
  deriveDevPerformanceBudget,
  devBudgetBaselineFindings,
  devBudgetFindings,
  evaluateDevPerformanceBudget,
} from './perf-dev-budget.mjs';
import {
  PACKED_KOVO_PRODUCT_WORKLOAD_POLICY,
  packedComparisonProductEvidenceFindings,
  packedKovoProductIdentityFindings,
} from './lib/perf-packed-kovo-product.mjs';
import { canonicalJson, workloadIdentityFindings } from './perf-regression-check.mjs';
import { performanceHostFingerprintFindings } from './lib/perf-host.mjs';
import {
  evaluateReport,
  PERF_BUDGETS_SCHEMA,
  performanceGateWorkloadIdentity,
} from './perf-gate.mjs';

export const PERF_PUBLICATION_INPUT_SCHEMA = 'kovo-performance-publication-input/v6';
export const PERF_PUBLICATION_SCHEMA = 'kovo-performance-publication/v8';
export const PERF_PUBLICATION_REPOSITORY = 'kovojs/kovo';

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const GIT_BLOB_PATTERN = /^[0-9a-f]{40}$/u;
const MAX_API_RESPONSE_BYTES = 1024 * 1024;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_REPORT_BYTES = 128 * 1024 * 1024;
const MAX_CAMPAIGN_RUNS = 100;
const TERMINAL_JOB_CONCLUSIONS = Object.freeze([
  'action_required',
  'cancelled',
  'failure',
  'neutral',
  'skipped',
  'stale',
  'startup_failure',
  'success',
  'timed_out',
]);
const PERF_PUBLICATION_JSON_NAME = 'performance-publication.json';
const PERF_PUBLICATION_MARKDOWN_NAME = 'performance-publication.md';
const PERF_PUBLICATION_EVIDENCE_DIRECTORY_NAME = 'evidence';
const execFileAsync = promisify(execFile);
const REQUIRED_LOCKS = Object.freeze([
  'pnpm-lock.yaml',
  'benchmarks/nextjs/pnpm-lock.yaml',
  'benchmarks/harness/pnpm-lock.yaml',
]);
const BUILD_MODES = Object.freeze(['clean', 'unchanged', 'edit']);
const BUILD_PROFILE_MODES = Object.freeze(['unchanged', 'edit']);
const DEV_PERFORMANCE_METRICS = Object.freeze([
  'edit.leafMs',
  'edit.entryMs',
  'edit.dataMs',
  'edit.syntaxErrorMs',
  'edit.recoveryMs',
  'edit.peakRssBytes',
  'ready.durationMs',
  'ready.peakRssBytes',
]);
const BUILD_PERSISTENCE_DECISION_REQUIRED_FAILURE =
  'build-persistence:foreground-session-implementation-and-measured-decision-required';
const BUILD_PROFILE_ARTIFACT_NAME = 'kovo-perf-build-profile-n216';
const BUILD_PROFILE_WORKFLOW_JOB = Object.freeze({
  artifact: Object.freeze({
    name: 'kovo-perf-build-profile-n216',
    path: '${{ runner.temp }}/kovo-perf/build-profile-n216',
  }),
  key: 'build-profile',
  name: 'N=216 build CPU profiles',
  triggerPolicy: 'build-profile',
});
const BASELINE_TRIGGER_SCOPES = Object.freeze({
  pull_request: 'pull-request:labeled/perf-measure-baselines',
  schedule: 'schedule:baseline-matrix',
  workflow_dispatch: 'workflow-dispatch:measurement_scope=baselines-or-all',
});
const BUILD_PROFILE_TRIGGER_SCOPES = Object.freeze({
  pull_request: 'pull-request:labeled/perf-measure-decisions-or-build-profile',
  workflow_dispatch:
    'workflow-dispatch:measurement_scope=decisions-or-all;decision_focus=all-or-build-profile',
});
const PRODUCTION_BYTES_TRIGGER_SCOPES = Object.freeze({
  pull_request: 'pull-request:every-event',
});
const PRODUCTION_BYTES_METRICS = Object.freeze([
  'production.criticalPath.wireBytes',
  'production.document.wireBytes',
  'production.inlineBootstrap.gzipBytes',
  'production.inlineBootstrap.identityBytes',
  'production.navigation.wireBytes',
]);
const PRODUCTION_BYTES_CONFIG = Object.freeze({
  artifactName: 'kovo-perf-bytes',
  budgetFailureStep: 'Evaluate against perf-budgets.json',
  budgetFailureSuccessSteps: Object.freeze([
    'Measure critical-path, navigation and bootstrap bytes',
    'Run actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
  ]),
  componentCount: 24,
  reportMember: 'bytes.json',
  workflowJob: Object.freeze({
    artifact: Object.freeze({
      name: 'kovo-perf-bytes',
      path: '${{ runner.temp }}/kovo-perf/bytes.json',
    }),
    key: 'bytes',
    name: 'Production bytes',
    triggerPolicy: 'production-bytes',
  }),
});
const FAMILY_NAMES = Object.freeze([
  'browser',
  'dev-n24',
  'dev-n216',
  'build-n24',
  'build-n216',
  'server',
  'check',
]);

const FAMILY_CONFIG = Object.freeze({
  browser: familyConfig({
    architecture:
      'Default/as-shipped, matched L0, and matched L1 remain separate. Zero JavaScript is proved only for Kovo L0; Next matched L0 still ships JavaScript. Same-document and document-replacing navigation are not conflated. Matched-L1 mobile navigation at no more than 2x Next is the blocking first milestone; session bytes at no more than 50% of Next remain a separately reported follow-on target.',
    artifactName: 'kovo-perf-browser-matrix',
    baselineFindings: comparisonBudgetBaselineFindings,
    budgetFindings: comparisonBudgetFindings,
    comparisonPosture: 'kovo-vs-next',
    derive: deriveComparisonPerformanceBudget,
    evaluate: evaluateComparisonPerformanceBudget,
    reportMember: 'comparison.json',
    targetKinds: ['milestone', 'competitive-target'],
    workflowJob: workflowJob({
      artifactName: 'kovo-perf-browser-matrix',
      artifactPath: '${{ runner.temp }}/kovo-perf/browser',
      key: 'browser-matrix',
      name: 'Browser matrix',
    }),
  }),
  'dev-n24': familyConfig({
    architecture:
      'The generated N=24 corpus is capability matched. Ready, edit-to-paint, diagnostic, recovery, state-survival, and process-tree RSS evidence remain one indivisible subject. This campaign has no authenticated historical-current-Kovo comparator for the 30% ready and 20% leaf/entry improvement milestones, so those deltas remain explicitly unassessed; the Kovo-vs-Next ratios are separate reported follow-on targets.',
    artifactName: 'kovo-perf-dev-n24',
    baselineFindings: devBudgetBaselineFindings,
    budgetFindings: devBudgetFindings,
    comparisonPosture: 'kovo-vs-next',
    corpusSize: 24,
    derive: deriveDevPerformanceBudget,
    evaluate: evaluateDevPerformanceBudget,
    reportMember: 'comparison.json',
    targetKinds: ['competitive-target', 'regression', 'target'],
    workflowJob: workflowJob({
      artifactName: 'kovo-perf-dev-n${{ matrix.corpus }}',
      artifactPath: '${{ runner.temp }}/kovo-perf/dev-n${{ matrix.corpus }}',
      key: 'dev-matrix',
      name: 'N=24 developer loop',
    }),
  }),
  'dev-n216': familyConfig({
    architecture:
      'The generated N=216 corpus is capability matched. Ready, edit-to-paint, diagnostic, recovery, state-survival, and process-tree RSS evidence remain one indivisible subject. This campaign has no authenticated historical-current-Kovo comparator for the 30% ready and 20% leaf/entry improvement milestones, so those deltas remain explicitly unassessed; the Kovo-vs-Next ratios are separate reported follow-on targets.',
    artifactName: 'kovo-perf-dev-n216',
    baselineFindings: devBudgetBaselineFindings,
    budgetFindings: devBudgetFindings,
    comparisonPosture: 'kovo-vs-next',
    corpusSize: 216,
    derive: deriveDevPerformanceBudget,
    evaluate: evaluateDevPerformanceBudget,
    reportMember: 'comparison.json',
    targetKinds: ['competitive-target', 'regression', 'target'],
    workflowJob: workflowJob({
      artifactName: 'kovo-perf-dev-n${{ matrix.corpus }}',
      artifactPath: '${{ runner.temp }}/kovo-perf/dev-n${{ matrix.corpus }}',
      key: 'dev-matrix',
      name: 'N=216 developer loop',
    }),
  }),
  'build-n24': familyConfig({
    architecture:
      'The generated N=24 corpus preserves separate clean, unchanged, and edited production-build modes plus the authenticated source-proof/deploy-proof phase boundary.',
    artifactName: 'kovo-perf-build-n24',
    baselineFindings: buildBudgetBaselineFindings,
    budgetFindings: buildBudgetFindings,
    comparisonPosture: 'kovo-vs-next',
    corpusSize: 24,
    derive: deriveBuildPerformanceBudget,
    evaluate: evaluateBuildPerformanceBudget,
    reportMember: 'comparison.json',
    targetKinds: ['milestone'],
    workflowJob: workflowJob({
      artifactName: 'kovo-perf-build-n${{ matrix.corpus }}',
      artifactPath: '${{ runner.temp }}/kovo-perf/build-n${{ matrix.corpus }}',
      key: 'build-matrix',
      name: 'N=24 production builds',
    }),
  }),
  'build-n216': familyConfig({
    architecture:
      'The generated N=216 corpus preserves separate clean, unchanged, and edited production-build modes plus the authenticated source-proof/deploy-proof phase boundary.',
    artifactName: 'kovo-perf-build-n216',
    baselineFindings: buildBudgetBaselineFindings,
    budgetFindings: buildBudgetFindings,
    comparisonPosture: 'kovo-vs-next',
    corpusSize: 216,
    derive: deriveBuildPerformanceBudget,
    evaluate: evaluateBuildPerformanceBudget,
    reportMember: 'comparison.json',
    targetKinds: ['milestone'],
    workflowJob: workflowJob({
      artifactName: 'kovo-perf-build-n${{ matrix.corpus }}',
      artifactPath: '${{ runner.temp }}/kovo-perf/build-n${{ matrix.corpus }}',
      key: 'build-matrix',
      name: 'N=216 production builds',
    }),
  }),
  server: familyConfig({
    architecture:
      'Proved HIT, conditional 304, and forced-dynamic cells remain separate across route, encoding, and concurrency. Competitive HIT and forced-dynamic checks use representation-matched identity responses and are reported follow-on targets; Kovo Brotli remains required raw measurement evidence because Next Brotli is unsupported, never a fabricated paired win. This campaign has no authenticated historical-current-Kovo comparator for the 10% forced-dynamic improvement milestone, so that delta remains explicitly unassessed rather than inferred from a Kovo-vs-Next ratio.',
    artifactName: 'kovo-perf-server-matrix',
    baselineFindings: comparisonBudgetBaselineFindings,
    budgetFindings: comparisonBudgetFindings,
    comparisonPosture: 'kovo-vs-next',
    derive: deriveComparisonPerformanceBudget,
    evaluate: evaluateComparisonPerformanceBudget,
    reportMember: 'comparison.json',
    targetKinds: ['competitive-target'],
    workflowJob: workflowJob({
      artifactName: 'kovo-perf-server-matrix',
      artifactPath: '${{ runner.temp }}/kovo-perf/server',
      key: 'server-matrix',
      name: 'Matched production throughput',
    }),
  }),
  check: familyConfig({
    architecture:
      'Check scaling is a Kovo-only N=8,24,72,216 ladder. It enforces Kovo product targets and must not be represented as a Kovo-vs-Next comparison.',
    artifactName: 'kovo-perf-check-scaling',
    baselineFindings: checkBudgetBaselineFindings,
    budgetFindings: checkBudgetFindings,
    comparisonPosture: 'kovo-only',
    derive: deriveCheckPerformanceBudget,
    evaluate: evaluateCheckPerformanceBudget,
    reportMember: 'check-scaling.json',
    targetKinds: ['target'],
    workflowJob: workflowJob({
      artifactName: 'kovo-perf-check-scaling',
      artifactPath: '${{ runner.temp }}/kovo-perf/check-scaling.json',
      key: 'check-scaling',
      name: 'Check scaling',
    }),
  }),
});

/** Authenticate all 42 family reports plus the separate deterministic Production-bytes sidecar. */
export async function authenticatePerformancePublicationInput(
  input,
  {
    baseDirectory = process.cwd(),
    descriptorReadHook,
    fetchCampaignWorkflowRunsApi = fetchGitHubCampaignWorkflowRunsApiResponse,
    fetchArtifactApi,
    fetchWorkflowArtifactsApi = fetchGitHubWorkflowArtifactsApiResponse,
    fetchWorkflowFileApi,
    fetchWorkflowJobsApi = fetchGitHubWorkflowJobsApiResponse,
    fetchWorkflowRunApi,
    filesystemCensusHook,
    loadPerformanceBudgets = loadCommittedPerformanceBudgets,
    loadTrustedWorkflow,
    manifestPath = path.join(baseDirectory, 'performance-publication-input.json'),
    now = new Date().toISOString(),
    repositoryDirectory = process.cwd(),
  } = {},
) {
  validateInputManifest(input);
  validateBuildProfileEvidencePair(input.buildProfiles);
  validateCampaignManifest(input.campaign);
  const openingManifestCensus = await authenticateManifestFilesystemCensus(input, {
    baseDirectory,
    manifestPath,
    phase: 'opening',
    snapshotHook: filesystemCensusHook,
  });
  const descriptorCustody = await createPerformanceArtifactDescriptorCustody({
    baseDirectory: openingManifestCensus.baseDirectory,
    openingFileCensus: openingManifestCensus.files,
  });
  const manifestRelativePath = openingManifestCensus.manifestRelativePath;
  const manifestBytes = await readPerformanceArtifactCustodyFile(manifestRelativePath, {
    custody: descriptorCustody,
    descriptorKey: 'manifest',
    label: 'performance publication manifest',
    maximumBytes: MAX_API_RESPONSE_BYTES,
    readHook: descriptorReadHook,
  });
  if (
    canonicalJson(parseCampaignJson(manifestBytes, 'performance publication manifest')) !==
    canonicalJson(input)
  ) {
    throw new TypeError('parsed manifest differs from its stable on-disk custody bytes');
  }
  const families = {};
  for (const familyName of FAMILY_NAMES) {
    const config = FAMILY_CONFIG[familyName];
    const descriptor = input.families[familyName];
    const baseline = [];
    for (const [index, evidence] of descriptor.baseline.entries()) {
      try {
        baseline.push(
          await authenticatePerformanceArtifactEvidence(evidence, {
            baseDirectory,
            descriptorCustody,
            descriptorReadHook,
            expectedArtifactName: config.artifactName,
            expectedArchiveMembers: [config.reportMember],
            expectedReportMember: config.reportMember,
            expectedWorkflowJob: config.workflowJob,
            fetchArtifactApi,
            fetchWorkflowFileApi,
            fetchWorkflowJobsApi,
            fetchWorkflowRunApi,
            loadTrustedWorkflow,
            now,
            repository: input.repository,
            repositoryDirectory,
          }),
        );
      } catch (error) {
        throw contextualError(`${familyName} baseline[${String(index)}]`, error);
      }
    }
    let holdout;
    try {
      holdout = await authenticatePerformanceArtifactEvidence(descriptor.holdout, {
        baseDirectory,
        descriptorCustody,
        descriptorReadHook,
        expectedArtifactName: config.artifactName,
        expectedArchiveMembers: [config.reportMember],
        expectedReportMember: config.reportMember,
        expectedWorkflowJob: config.workflowJob,
        fetchArtifactApi,
        fetchWorkflowFileApi,
        fetchWorkflowJobsApi,
        fetchWorkflowRunApi,
        loadTrustedWorkflow,
        now,
        repository: input.repository,
        repositoryDirectory,
      });
    } catch (error) {
      throw contextualError(`${familyName} holdout`, error);
    }
    families[familyName] = { baseline, holdout };
  }
  const buildProfiles = [];
  for (const mode of BUILD_PROFILE_MODES) {
    if (input.buildProfiles === undefined) break;
    try {
      const entry = await authenticatePerformanceArtifactEvidence(input.buildProfiles[mode], {
        baseDirectory,
        descriptorCustody,
        descriptorCustodyShare: { archive: 'build-profile-archive' },
        descriptorReadHook,
        expectedArtifactName: BUILD_PROFILE_ARTIFACT_NAME,
        expectedAuxiliaryMemberGroup: {
          prefix: `raw-${mode}-`,
          suffix: '.cpuprofile',
        },
        expectedAuxiliaryMembers: [`build-${mode}.cpuprofile`, `process-cpu-${mode}.txt`],
        expectedReportMember: `profile-${mode}.json`,
        expectedWorkflowJob: BUILD_PROFILE_WORKFLOW_JOB,
        fetchArtifactApi,
        fetchWorkflowFileApi,
        fetchWorkflowJobsApi,
        fetchWorkflowRunApi,
        loadTrustedWorkflow,
        now,
        repository: input.repository,
        repositoryDirectory,
      });
      const profileFindings = buildProfilePublicationFindings(entry, mode);
      if (profileFindings.length > 0) throw new TypeError(profileFindings.join('\n'));
      buildProfiles.push(entry);
    } catch (error) {
      throw contextualError(`build profile ${mode}`, error);
    }
  }
  const buildProfileFindings = buildProfileEntrySetFindings(buildProfiles);
  if (buildProfileFindings.length > 0) {
    throw new TypeError(`build profile evidence: ${buildProfileFindings.join('\n')}`);
  }
  let productionBytes;
  try {
    productionBytes = await authenticatePerformanceArtifactEvidence(input.productionBytes, {
      allowedProducerJobConclusions: ['failure', 'success'],
      allowedProducerFailureStep: PRODUCTION_BYTES_CONFIG.budgetFailureStep,
      requiredProducerSuccessSteps: PRODUCTION_BYTES_CONFIG.budgetFailureSuccessSteps,
      baseDirectory,
      descriptorCustody,
      descriptorReadHook,
      expectedArtifactName: PRODUCTION_BYTES_CONFIG.artifactName,
      expectedArchiveMembers: [PRODUCTION_BYTES_CONFIG.reportMember],
      expectedReportMember: PRODUCTION_BYTES_CONFIG.reportMember,
      expectedWorkflowJob: PRODUCTION_BYTES_CONFIG.workflowJob,
      fetchArtifactApi,
      fetchWorkflowFileApi,
      fetchWorkflowJobsApi,
      fetchWorkflowRunApi,
      loadTrustedWorkflow,
      now,
      repository: input.repository,
      repositoryDirectory,
    });
    const reportFindings = productionBytesReportFindings(productionBytes.report);
    if (reportFindings.length > 0) throw new TypeError(reportFindings.join('\n'));
    if (typeof loadPerformanceBudgets !== 'function') {
      throw new TypeError('committed performance budget loader is unavailable');
    }
    const trustedBudgets = await loadPerformanceBudgets({
      repositoryDirectory,
      sourceSha: productionBytes.report.source.commit,
    });
    productionBytes = { ...productionBytes, ...trustedBudgets };
  } catch (error) {
    throw contextualError('Production bytes', error);
  }
  let campaign;
  try {
    campaign = await authenticatePerformancePublicationCampaign(input.campaign, {
      authenticateArtifactEvidence: authenticatePerformanceArtifactEvidence,
      baseDirectory,
      custody: descriptorCustody,
      descriptorReadHook,
      fetchArtifactApi,
      fetchCampaignWorkflowRunsApi,
      fetchWorkflowFileApi,
      fetchWorkflowArtifactsApi,
      fetchWorkflowJobsApi,
      fetchWorkflowRunApi: fetchWorkflowRunApi ?? fetchGitHubWorkflowRunApiResponse,
      loadTrustedWorkflow,
      now,
      repository: input.repository,
      repositoryDirectory,
      selectedFamilies: families,
      selectedProductionBytes: productionBytes,
    });
  } catch (error) {
    throw contextualError('campaign chronology', error);
  }
  const closingManifestCensus = await authenticateManifestFilesystemCensus(input, {
    baseDirectory: descriptorCustody.baseDirectory,
    manifestPath,
    phase: 'closing',
    snapshotHook: filesystemCensusHook,
  });
  if (canonicalJson(closingManifestCensus) !== canonicalJson(openingManifestCensus)) {
    throw new TypeError(
      'performance publication custody identity or content changed between opening and closing census',
    );
  }
  return { buildProfiles, campaign, families, productionBytes, repository: input.repository };
}

function validateBuildProfileEvidencePair(descriptors) {
  if (descriptors === undefined) return;
  const distinctFields = ['apiMetadata', 'jobsApiMetadata', 'report', 'runApiMetadata'];
  if (
    descriptors.unchanged?.archive !== descriptors.edit?.archive ||
    distinctFields.some((field) => descriptors.unchanged?.[field] === descriptors.edit?.[field])
  ) {
    throw new TypeError(
      'build profile modes may share only one exact archive; all other custody files must be distinct',
    );
  }
}

export async function authenticateManifestFilesystemCensus(
  input,
  { baseDirectory, manifestPath, phase = 'standalone', snapshotHook },
) {
  if (!['closing', 'opening', 'standalone'].includes(phase)) {
    throw new TypeError('manifest custody census phase is invalid');
  }
  if (snapshotHook !== undefined && typeof snapshotHook !== 'function') {
    throw new TypeError('manifest custody snapshot hook is invalid');
  }
  const resolvedBaseDirectory = await realpath(path.resolve(baseDirectory));
  const requestedManifest = path.resolve(manifestPath);
  const manifestFacts = await lstat(requestedManifest);
  if (!manifestFacts.isFile() || manifestFacts.isSymbolicLink() || manifestFacts.nlink !== 1) {
    throw new TypeError('performance publication manifest must be one unique regular file');
  }
  const resolvedManifest = await realpath(requestedManifest);
  const manifestRelativePath = manifestRelativeFile(
    resolvedBaseDirectory,
    resolvedManifest,
    'manifest',
  );
  const references = manifestCustodyReferences(input);
  references.push({
    kind: 'manifest',
    maximumBytes: MAX_API_RESPONSE_BYTES,
    path: manifestRelativePath,
  });
  const pathUses = new Map();
  for (const reference of references) {
    if (!safeManifestRelativePath(reference.path)) {
      throw new TypeError(`${reference.kind} is not a canonical safe relative path`);
    }
    const uses = pathUses.get(reference.path) ?? [];
    uses.push(reference);
    pathUses.set(reference.path, uses);
  }
  for (const [relativePath, uses] of pathUses) {
    const allowedBuildArchiveShare =
      uses.length === 2 && uses.every(({ kind }) => kind === 'build-profile archive');
    if (uses.length !== 1 && !allowedBuildArchiveShare) {
      throw new TypeError(`${relativePath} is referenced by multiple manifest custody roles`);
    }
    if (new Set(uses.map(({ maximumBytes }) => maximumBytes)).size !== 1) {
      throw new TypeError(`${relativePath} has conflicting manifest custody byte bounds`);
    }
  }
  const expectedFiles = new Map(
    [...pathUses].map(([relativePath, uses]) => [
      relativePath,
      { kind: uses[0].kind, maximumBytes: uses[0].maximumBytes },
    ]),
  );
  const expectedDirectories = new Set();
  for (const relativePath of expectedFiles.keys()) {
    const parts = relativePath.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      expectedDirectories.add(parts.slice(0, index).join('/'));
    }
  }
  const seenFiles = new Set();
  const seenInodes = new Set();
  const snapshots = [];
  await walkManifestCustodyDirectory(resolvedBaseDirectory, '', {
    expectedDirectories,
    expectedFiles,
    rootDirectory: resolvedBaseDirectory,
    seenFiles,
    seenInodes,
    snapshotHook,
    snapshots,
    phase,
  });
  if (
    seenFiles.size !== expectedFiles.size ||
    [...expectedFiles.keys()].some((relativePath) => !seenFiles.has(relativePath))
  ) {
    throw new TypeError('manifest custody directory is missing one or more referenced files');
  }
  snapshots.sort((left, right) => left.path.localeCompare(right.path));
  const verifiedFiles = new Set();
  const verifiedInodes = new Set();
  const snapshotsByPath = new Map(snapshots.map((snapshot) => [snapshot.path, snapshot]));
  await verifyManifestCustodyDirectory(resolvedBaseDirectory, '', {
    expectedDirectories,
    expectedFiles,
    rootDirectory: resolvedBaseDirectory,
    seenFiles: verifiedFiles,
    seenInodes: verifiedInodes,
    snapshotsByPath,
  });
  if (
    verifiedFiles.size !== expectedFiles.size ||
    [...expectedFiles.keys()].some((relativePath) => !verifiedFiles.has(relativePath))
  ) {
    throw new TypeError('final manifest custody identity sweep is missing a referenced file');
  }
  return Object.freeze({
    baseDirectory: resolvedBaseDirectory,
    files: Object.freeze(snapshots),
    manifestRelativePath,
  });
}

async function walkManifestCustodyDirectory(
  absoluteDirectory,
  relativeDirectory,
  {
    expectedDirectories,
    expectedFiles,
    phase,
    rootDirectory,
    seenFiles,
    seenInodes,
    snapshotHook,
    snapshots,
  },
) {
  const before = await lstat(absoluteDirectory);
  if (!before.isDirectory() || before.isSymbolicLink()) {
    throw new TypeError('manifest custody traversal encountered a non-directory or symlink');
  }
  const entries = (await readdir(absoluteDirectory)).sort((left, right) =>
    left.localeCompare(right),
  );
  for (const name of entries) {
    const relativePath = relativeDirectory === '' ? name : `${relativeDirectory}/${name}`;
    const absolutePath = path.join(absoluteDirectory, name);
    const facts = await lstat(absolutePath);
    if (facts.isSymbolicLink()) {
      throw new TypeError(`${relativePath} is an untrusted symlink in manifest custody`);
    }
    if (facts.isDirectory()) {
      if (!expectedDirectories.has(relativePath)) {
        throw new TypeError(`${relativePath} is an unreferenced manifest custody directory`);
      }
      await walkManifestCustodyDirectory(absolutePath, relativePath, {
        expectedDirectories,
        expectedFiles,
        phase,
        rootDirectory,
        seenFiles,
        seenInodes,
        snapshotHook,
        snapshots,
      });
      continue;
    }
    if (!facts.isFile() || facts.nlink !== 1) {
      throw new TypeError(`${relativePath} is not a unique regular manifest custody file`);
    }
    const expected = expectedFiles.get(relativePath);
    if (expected === undefined) {
      throw new TypeError(`${relativePath} is an unreferenced manifest custody file`);
    }
    const snapshot = await snapshotPerformanceArtifactCustodyFile(relativePath, {
      baseDirectory: rootDirectory,
      label: `${expected.kind} manifest custody file`,
      maximumBytes: expected.maximumBytes,
    });
    const inode = `${String(snapshot.dev)}:${String(snapshot.ino)}`;
    if (seenInodes.has(inode)) {
      throw new TypeError(`${relativePath} hardlink-aliases another manifest custody file`);
    }
    seenInodes.add(inode);
    seenFiles.add(relativePath);
    snapshots.push(snapshot);
    await snapshotHook?.({ phase, relativePath, stage: 'hashed' });
  }
  const after = await lstat(absoluteDirectory);
  if (
    after.dev !== before.dev ||
    after.ino !== before.ino ||
    after.mode !== before.mode ||
    after.mtimeMs !== before.mtimeMs ||
    after.ctimeMs !== before.ctimeMs
  ) {
    throw new TypeError('manifest custody directory changed while it was enumerated');
  }
}

async function verifyManifestCustodyDirectory(
  absoluteDirectory,
  relativeDirectory,
  { expectedDirectories, expectedFiles, rootDirectory, seenFiles, seenInodes, snapshotsByPath },
) {
  const before = await lstat(absoluteDirectory);
  if (!before.isDirectory() || before.isSymbolicLink()) {
    throw new TypeError('final manifest custody sweep encountered a non-directory or symlink');
  }
  const entries = (await readdir(absoluteDirectory)).sort((left, right) =>
    left.localeCompare(right),
  );
  for (const name of entries) {
    const relativePath = relativeDirectory === '' ? name : `${relativeDirectory}/${name}`;
    const absolutePath = path.join(absoluteDirectory, name);
    const facts = await lstat(absolutePath);
    if (facts.isSymbolicLink()) {
      throw new TypeError(
        `${relativePath} is an untrusted symlink in final manifest custody sweep`,
      );
    }
    if (facts.isDirectory()) {
      if (!expectedDirectories.has(relativePath)) {
        throw new TypeError(`${relativePath} is an unreferenced final manifest custody directory`);
      }
      await verifyManifestCustodyDirectory(absolutePath, relativePath, {
        expectedDirectories,
        expectedFiles,
        rootDirectory,
        seenFiles,
        seenInodes,
        snapshotsByPath,
      });
      continue;
    }
    const expected = expectedFiles.get(relativePath);
    const snapshot = snapshotsByPath.get(relativePath);
    if (!facts.isFile() || facts.nlink !== 1 || expected === undefined || snapshot === undefined) {
      throw new TypeError(`${relativePath} differs from the final manifest custody file census`);
    }
    await verifyPerformanceArtifactCustodyFileSnapshot(snapshot, {
      baseDirectory: rootDirectory,
      label: `${expected.kind} final manifest custody file`,
    });
    const inode = `${String(snapshot.dev)}:${String(snapshot.ino)}`;
    if (seenFiles.has(relativePath) || seenInodes.has(inode)) {
      throw new TypeError(`${relativePath} aliases final manifest custody identity`);
    }
    seenFiles.add(relativePath);
    seenInodes.add(inode);
  }
  const after = await lstat(absoluteDirectory);
  if (
    after.dev !== before.dev ||
    after.ino !== before.ino ||
    after.mode !== before.mode ||
    after.mtimeMs !== before.mtimeMs ||
    after.ctimeMs !== before.ctimeMs
  ) {
    throw new TypeError('manifest custody directory changed during final identity sweep');
  }
}

function manifestCustodyReferences(input) {
  const references = [];
  const addDescriptor = (descriptor, prefix, { buildProfile = false } = {}) => {
    validateManifestEvidenceDescriptor(descriptor, prefix);
    for (const key of ['apiMetadata', 'archive', 'jobsApiMetadata', 'report', 'runApiMetadata']) {
      references.push({
        kind: buildProfile && key === 'archive' ? 'build-profile archive' : `${prefix} ${key}`,
        maximumBytes:
          key === 'archive'
            ? MAX_ARCHIVE_BYTES
            : key === 'report'
              ? MAX_REPORT_BYTES
              : MAX_API_RESPONSE_BYTES,
        path: descriptor[key],
      });
    }
  };
  for (const familyName of FAMILY_NAMES) {
    const family = input.families[familyName];
    for (const [index, descriptor] of family.baseline.entries()) {
      addDescriptor(descriptor, `${familyName} baseline[${String(index)}]`);
    }
    addDescriptor(family.holdout, `${familyName} holdout`);
  }
  addDescriptor(input.productionBytes, 'Production bytes');
  references.push({
    kind: 'campaign workflow-runs API',
    maximumBytes: MAX_API_RESPONSE_BYTES,
    path: input.campaign.workflowRunsApiMetadata.path,
  });
  for (const run of input.campaign.runs) {
    references.push(
      {
        kind: `campaign run ${String(run.runId)} artifacts API`,
        maximumBytes: MAX_API_RESPONSE_BYTES,
        path: run.artifactsApiMetadata.path,
      },
      {
        kind: `campaign run ${String(run.runId)} run API`,
        maximumBytes: MAX_API_RESPONSE_BYTES,
        path: run.runApiMetadata.path,
      },
    );
  }
  for (const candidate of input.campaign.familyCandidates) {
    addDescriptor(
      candidate.descriptor,
      `campaign ${candidate.family} candidate ${String(candidate.artifactId)}`,
    );
  }
  for (const candidate of input.campaign.productionBytesCandidates) {
    addDescriptor(
      candidate.descriptor,
      `campaign Production bytes candidate ${String(candidate.artifactId)}`,
    );
  }
  if (input.buildProfiles !== undefined) {
    for (const mode of BUILD_PROFILE_MODES) {
      addDescriptor(input.buildProfiles[mode], `build profile ${mode}`, { buildProfile: true });
    }
  }
  return references;
}

function validateManifestEvidenceDescriptor(descriptor, label) {
  const keys = ['apiMetadata', 'archive', 'jobsApiMetadata', 'report', 'runApiMetadata'];
  if (
    !ownRecord(descriptor) ||
    canonicalJson(Object.keys(descriptor).sort()) !== canonicalJson(keys) ||
    keys.some((key) => !safeManifestRelativePath(descriptor[key])) ||
    new Set(keys.map((key) => descriptor[key])).size !== keys.length
  ) {
    throw new TypeError(`${label} evidence descriptor is malformed or aliases itself`);
  }
}

function manifestRelativeFile(root, file, label) {
  const relative = path.relative(root, file).split(path.sep).join('/');
  if (!safeManifestRelativePath(relative)) {
    throw new TypeError(`${label} is outside the manifest custody directory`);
  }
  return relative;
}

function safeManifestRelativePath(value) {
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

export async function authenticatePerformancePublicationCampaign(
  campaign,
  {
    authenticateArtifactEvidence = authenticatePerformanceArtifactEvidence,
    baseDirectory = process.cwd(),
    custody,
    descriptorReadHook,
    fetchArtifactApi,
    fetchCampaignWorkflowRunsApi,
    fetchWorkflowFileApi,
    fetchWorkflowArtifactsApi,
    fetchWorkflowJobsApi = fetchGitHubWorkflowJobsApiResponse,
    fetchWorkflowRunApi,
    loadTrustedWorkflow,
    now,
    repository,
    repositoryDirectory,
    selectedFamilies,
    selectedProductionBytes,
  },
) {
  validateCampaignManifest(campaign);
  for (const [label, operation] of [
    ['campaign workflow-runs', fetchCampaignWorkflowRunsApi],
    ['campaign workflow artifacts', fetchWorkflowArtifactsApi],
    ['campaign workflow jobs', fetchWorkflowJobsApi],
    ['campaign workflow run', fetchWorkflowRunApi],
  ]) {
    if (typeof operation !== 'function') throw new TypeError(`live ${label} API fetch is required`);
  }
  if (typeof authenticateArtifactEvidence !== 'function') {
    throw new TypeError('campaign artifact authenticator is required');
  }
  const sourceSha = selectedProductionBytes?.report?.source?.commit;
  if (!COMMIT_PATTERN.test(sourceSha ?? '')) {
    throw new TypeError('campaign source commit is unavailable');
  }
  const savedWorkflowRunsBytes = await readCampaignCustodyReference(
    campaign.workflowRunsApiMetadata,
    'campaign workflow-runs API',
    { custody, descriptorReadHook },
  );
  const liveWorkflowRunsBytes = await fetchCampaignWorkflowRunsApi({ repository, sourceSha });
  const savedWorkflowRuns = parseCampaignJson(savedWorkflowRunsBytes, 'campaign workflow-runs API');
  const liveWorkflowRuns = parseCampaignJson(
    liveWorkflowRunsBytes,
    'live campaign workflow-runs API',
  );
  const savedRunCensus = campaignWorkflowRunsAuthorityProjection(savedWorkflowRuns, {
    boundary: campaign.boundary,
    sourceSha,
  });
  const liveRunCensus = campaignWorkflowRunsAuthorityProjection(liveWorkflowRuns, {
    boundary: campaign.boundary,
    sourceSha,
  });
  if (canonicalJson(savedRunCensus) !== canonicalJson(liveRunCensus)) {
    throw new TypeError('saved campaign workflow-runs authority differs from the live response');
  }
  const manifestRunIds = campaign.runs.map((run) => run.runId);
  if (canonicalJson(manifestRunIds) !== canonicalJson(savedRunCensus.map((run) => run.runId))) {
    throw new TypeError('campaign manifest omits or invents a preregistered workflow run');
  }
  const runs = [];
  const derivedProductionBytes = [];
  for (const run of campaign.runs) {
    const [savedRunBytes, savedArtifactsBytes, liveRunBytes, liveArtifactsBytes] =
      await Promise.all([
        readCampaignCustodyReference(
          run.runApiMetadata,
          `campaign run ${String(run.runId)} run API`,
          { custody, descriptorReadHook },
        ),
        readCampaignCustodyReference(
          run.artifactsApiMetadata,
          `campaign run ${String(run.runId)} artifacts API`,
          { custody, descriptorReadHook },
        ),
        fetchWorkflowRunApi({ repository, workflowRunId: run.runId }),
        fetchWorkflowArtifactsApi({ repository, workflowRunId: run.runId }),
      ]);
    const savedRun = parseCampaignJson(savedRunBytes, 'campaign workflow run API');
    const liveRun = parseCampaignJson(liveRunBytes, 'live campaign workflow run API');
    const savedRunAuthority = campaignRunAuthorityProjection(savedRun, {
      repository,
      runId: run.runId,
      sourceSha,
    });
    const liveRunAuthority = campaignRunAuthorityProjection(liveRun, {
      repository,
      runId: run.runId,
      sourceSha,
    });
    if (canonicalJson(savedRunAuthority) !== canonicalJson(liveRunAuthority)) {
      throw new TypeError(
        `campaign run ${String(run.runId)} saved authority differs from the live response`,
      );
    }
    const censusRunAuthority = savedRunCensus.find((entry) => entry.runId === run.runId);
    if (canonicalJson(savedRunAuthority) !== canonicalJson(censusRunAuthority)) {
      throw new TypeError(
        `campaign run ${String(run.runId)} authority differs from the workflow-runs census`,
      );
    }
    if (run.runCreatedAt !== savedRunAuthority.runCreatedAt) {
      throw new TypeError(`campaign run ${String(run.runId)} created_at differs from authority`);
    }
    const savedArtifacts = campaignArtifactsAuthorityProjection(
      parseCampaignJson(savedArtifactsBytes, 'campaign workflow artifacts API'),
      run.runId,
    );
    const liveArtifacts = campaignArtifactsAuthorityProjection(
      parseCampaignJson(liveArtifactsBytes, 'live campaign workflow artifacts API'),
      run.runId,
    );
    if (canonicalJson(savedArtifacts) !== canonicalJson(liveArtifacts)) {
      throw new TypeError(
        `campaign run ${String(run.runId)} artifact census differs from the live response`,
      );
    }
    validateCampaignPublicationArtifactFloor(
      savedArtifacts.publicationArtifacts,
      savedRunAuthority,
    );
    for (const artifact of savedArtifacts.publicationArtifacts) {
      if (artifact.kind === 'production-bytes') {
        derivedProductionBytes.push({
          artifactId: artifact.artifactId,
          runCreatedAt: run.runCreatedAt,
          runId: run.runId,
        });
      }
    }
    runs.push({
      artifactsApiAuthorityDigest: sha256Canonical(savedArtifacts.authority),
      artifactsApiResponseDigest: sha256Bytes(savedArtifactsBytes),
      liveArtifactsApiResponseDigest: sha256Bytes(liveArtifactsBytes),
      publicationArtifacts: savedArtifacts.publicationArtifacts,
      runApiAuthorityDigest: sha256Canonical(savedRunAuthority),
      runApiResponseDigest: sha256Bytes(savedRunBytes),
      runCreatedAt: run.runCreatedAt,
      runId: run.runId,
    });
  }
  derivedProductionBytes.sort(campaignChronologyOrder);
  if (canonicalJson(campaign.productionBytes) !== canonicalJson(derivedProductionBytes)) {
    throw new TypeError('campaign Production bytes chronology omits or invents a listed candidate');
  }
  const authenticatedCandidates = await authenticateCampaignCandidates(campaign, {
    authenticateArtifactEvidence,
    baseDirectory,
    custody,
    descriptorReadHook,
    fetchArtifactApi,
    fetchWorkflowFileApi,
    fetchWorkflowJobsApi,
    fetchWorkflowRunApi,
    loadTrustedWorkflow,
    now,
    repository,
    repositoryDirectory,
    runAuthorities: savedRunCensus,
    runs,
    sourceSha,
  });
  const selectedFamilyCandidates = selectGateCampaignFamilyCandidates(
    authenticatedCandidates.familyCandidates,
    campaign.cohortSelections,
  );
  assertSelectedFamilyDescriptors(selectedFamilyCandidates, selectedFamilies);
  const selected = authenticatedCandidates.productionBytesCandidates[0];
  if (
    canonicalJson(campaign.selectedProductionBytes) !==
      canonicalJson(candidateChronologyIdentity(selected)) ||
    selected?.artifactId !== selectedProductionBytes?.custody?.artifactId ||
    selected?.runId !== selectedProductionBytes?.custody?.workflowRunId ||
    selected?.executionDigest !== selectedProductionBytes?.report?.execution?.digest ||
    selected?.contentDigest !== selectedProductionBytes?.contentDigest
  ) {
    throw new TypeError('Production bytes evidence is not the earliest campaign candidate');
  }
  return {
    boundary: campaign.boundary,
    cohortSelections: campaign.cohortSelections,
    familyCandidates: authenticatedCandidates.familyCandidates.map(campaignCandidateReference),
    excludedFamilyArtifacts: authenticatedCandidates.excludedFamilyArtifacts,
    productionBytes: derivedProductionBytes,
    productionBytesCandidates: authenticatedCandidates.productionBytesCandidates.map(
      campaignCandidateReference,
    ),
    runs,
    selectedFamilies: Object.fromEntries(
      FAMILY_NAMES.map((familyName) => [
        familyName,
        selectedFamilyCandidates[familyName].map(campaignCandidateReference),
      ]),
    ),
    selectedProductionBytes: candidateChronologyIdentity(selected),
    workflowRunsApiAuthorityDigest: sha256Canonical(savedRunCensus),
    workflowRunsApiResponseDigest: sha256Bytes(savedWorkflowRunsBytes),
    liveWorkflowRunsApiResponseDigest: sha256Bytes(liveWorkflowRunsBytes),
  };
}

async function authenticateCampaignFamilyInventory(
  campaign,
  {
    baseDirectory,
    custody,
    descriptorReadHook,
    fetchWorkflowJobsApi,
    repository,
    runAuthorities,
    runs,
    sourceSha,
  },
) {
  const listedArtifactIds = new Set();
  const productionCandidatesByRun = new Map();
  for (const candidate of campaign.productionBytesCandidates) {
    if (productionCandidatesByRun.has(candidate.runId)) {
      throw new TypeError('campaign run has ambiguous Production bytes job custody');
    }
    productionCandidatesByRun.set(candidate.runId, candidate);
  }
  const openingFileCensus =
    custody?.openingFiles instanceof Map ? [...custody.openingFiles.values()] : undefined;
  const jobsCustody = await createPerformanceArtifactDescriptorCustody({
    baseDirectory: custody?.baseDirectory ?? baseDirectory,
    ...(openingFileCensus === undefined ? {} : { openingFileCensus }),
  });
  const excludedFamilyArtifacts = [];
  const familyCandidates = [];
  const productionBytes = [];
  const liveJobsByRun = new Map();
  const producersByRun = new Map();
  for (const run of runs) {
    const runAuthorityMatches = runAuthorities.filter((entry) => entry.runId === run.runId);
    if (runAuthorityMatches.length !== 1) {
      throw new TypeError(`campaign run ${String(run.runId)} job authority is unavailable`);
    }
    const runAuthority = runAuthorityMatches[0];
    const productionArtifacts = run.publicationArtifacts.filter(
      (artifact) => artifact.kind === 'production-bytes',
    );
    const productionCandidate = productionCandidatesByRun.get(run.runId);
    if (
      productionArtifacts.length !== 1 ||
      productionCandidate === undefined ||
      productionCandidate.artifactId !== productionArtifacts[0].artifactId
    ) {
      throw new TypeError(
        `campaign run ${String(run.runId)} Production bytes candidate custody omits or invents its literal artifact`,
      );
    }
    const savedJobsBytes = await readPerformanceArtifactCustodyFile(
      productionCandidate.descriptor.jobsApiMetadata,
      {
        custody: jobsCustody,
        descriptorKey: `campaign-jobs:${String(run.runId)}`,
        label: `campaign run ${String(run.runId)} workflow jobs API`,
        maximumBytes: MAX_API_RESPONSE_BYTES,
        readHook: descriptorReadHook,
      },
    );
    const liveJobsBytes = campaignApiResponseBytes(
      await fetchWorkflowJobsApi({ repository, workflowRunId: run.runId }),
      `live campaign run ${String(run.runId)} workflow jobs API`,
    );
    const savedJobs = parseCampaignJson(
      savedJobsBytes,
      `campaign run ${String(run.runId)} workflow jobs API`,
    );
    const liveJobs = parseCampaignJson(
      liveJobsBytes,
      `live campaign run ${String(run.runId)} workflow jobs API`,
    );
    const savedJobsAuthority = campaignWorkflowJobsAuthorityProjection(savedJobs, run.runId);
    const liveJobsAuthority = campaignWorkflowJobsAuthorityProjection(liveJobs, run.runId);
    if (canonicalJson(savedJobsAuthority) !== canonicalJson(liveJobsAuthority)) {
      throw new TypeError(
        `campaign run ${String(run.runId)} saved workflow jobs authority differs from the live response`,
      );
    }
    producersByRun.set(
      run.runId,
      new Map(
        FAMILY_NAMES.map((family) => [
          family,
          campaignFamilyProducerJob(liveJobs, family, { repository, run: runAuthority, sourceSha }),
        ]),
      ),
    );
    liveJobsByRun.set(run.runId, liveJobsBytes);
  }
  for (const run of runs) {
    const classification = classifyCampaignPublicationArtifacts(
      run.publicationArtifacts,
      producersByRun.get(run.runId),
      run.runId,
    );
    for (const artifact of run.publicationArtifacts) {
      if (listedArtifactIds.has(artifact.artifactId)) {
        throw new TypeError('campaign artifact listing identities are duplicated across runs');
      }
      listedArtifactIds.add(artifact.artifactId);
    }
    familyCandidates.push(
      ...classification.familyCandidates.map(({ artifactId, family }) => ({
        artifactId,
        family,
        runCreatedAt: run.runCreatedAt,
        runId: run.runId,
      })),
    );
    excludedFamilyArtifacts.push(...classification.excludedFamilyArtifacts);
    productionBytes.push({
      artifactId: run.publicationArtifacts.find((artifact) => artifact.kind === 'production-bytes')
        .artifactId,
      runCreatedAt: run.runCreatedAt,
      runId: run.runId,
    });
  }
  familyCandidates.sort(campaignCandidateInventoryOrder);
  excludedFamilyArtifacts.sort(excludedFamilyArtifactOrder);
  productionBytes.sort(campaignChronologyOrder);
  return { excludedFamilyArtifacts, familyCandidates, liveJobsByRun, productionBytes };
}

function classifyCampaignPublicationArtifacts(publicationArtifacts, producers, runId) {
  const familyArtifacts = new Map(
    publicationArtifacts
      .filter((artifact) => artifact.kind === 'family')
      .map((artifact) => [artifact.family, artifact]),
  );
  const familyCandidates = [];
  const excludedFamilyArtifacts = [];
  for (const family of FAMILY_NAMES) {
    const producer = producers.get(family);
    const artifact = familyArtifacts.get(family);
    if (producer.conclusion === 'success') {
      if (artifact === undefined) {
        throw new TypeError(
          `successful ${FAMILY_CONFIG[family].workflowJob.name} producer has no literal ${FAMILY_CONFIG[family].artifactName} artifact`,
        );
      }
      familyCandidates.push({ artifactId: artifact.artifactId, family });
    } else if (artifact !== undefined) {
      excludedFamilyArtifacts.push({
        artifactId: artifact.artifactId,
        conclusion: producer.conclusion,
        family,
        producerJobId: producer.id,
        runId,
      });
    }
  }
  return { excludedFamilyArtifacts, familyCandidates };
}

function campaignFamilyProducerJob(jobsMetadata, family, { repository, run, sourceSha }) {
  const jobName = FAMILY_CONFIG[family].workflowJob.name;
  const matches = jobsMetadata.jobs.filter(
    (job) => job?.name === jobName && job?.run_attempt === run.runAttempt,
  );
  if (matches.length !== 1) {
    throw new TypeError(
      `campaign run ${String(run.runId)} jobs API has ${String(matches.length)} exact ${jobName} producers`,
    );
  }
  const job = matches[0];
  const startedAt = Date.parse(job?.started_at ?? '');
  const completedAt = Date.parse(job?.completed_at ?? '');
  if (
    run.status !== 'completed' ||
    !Number.isSafeInteger(run.runAttempt) ||
    run.runAttempt < 1 ||
    !Number.isSafeInteger(job?.id) ||
    job.id < 1 ||
    job.run_id !== run.runId ||
    job.run_attempt !== run.runAttempt ||
    job.head_sha !== sourceSha ||
    job.status !== 'completed' ||
    !TERMINAL_JOB_CONCLUSIONS.includes(job.conclusion) ||
    job.url !== `https://api.github.com/repos/${repository}/actions/jobs/${String(job?.id)}` ||
    !validCampaignJobTimestamp(job.started_at) ||
    !validCampaignJobTimestamp(job.completed_at) ||
    startedAt > completedAt
  ) {
    throw new TypeError(
      `campaign run ${String(run.runId)} ${jobName} producer authority is malformed or foreign`,
    );
  }
  return job;
}

function validCampaignJobTimestamp(value) {
  return (
    nonEmptyString(value) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function campaignWorkflowJobsAuthorityProjection(listing, runId) {
  if (
    !ownRecord(listing) ||
    !Number.isSafeInteger(listing.total_count) ||
    listing.total_count < 1 ||
    listing.total_count > 100 ||
    !Array.isArray(listing.jobs) ||
    listing.jobs.length !== listing.total_count
  ) {
    throw new TypeError(
      `campaign run ${String(runId)} workflow jobs API census is incomplete or exceeds one page`,
    );
  }
  const ids = listing.jobs.map((job) => job?.id);
  if (ids.some((id) => !Number.isSafeInteger(id) || id < 1) || new Set(ids).size !== ids.length) {
    throw new TypeError(
      `campaign run ${String(runId)} workflow jobs API identities are missing or duplicated`,
    );
  }
  return {
    jobs: listing.jobs
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
    total_count: listing.total_count,
  };
}

function campaignApiResponseBytes(value, label) {
  let bytes;
  try {
    bytes = Buffer.from(value);
  } catch {
    throw new TypeError(`${label} bytes are unavailable`);
  }
  if (bytes.length < 1 || bytes.length > MAX_API_RESPONSE_BYTES) {
    throw new TypeError(`${label} bytes are unavailable`);
  }
  return bytes;
}

async function authenticateCampaignCandidates(
  campaign,
  {
    authenticateArtifactEvidence,
    baseDirectory,
    custody,
    descriptorReadHook,
    fetchArtifactApi,
    fetchWorkflowFileApi,
    fetchWorkflowJobsApi,
    fetchWorkflowRunApi,
    loadTrustedWorkflow,
    now,
    repository,
    repositoryDirectory,
    runAuthorities,
    runs,
    sourceSha,
  },
) {
  const classified = await authenticateCampaignFamilyInventory(campaign, {
    baseDirectory,
    custody,
    descriptorReadHook,
    fetchWorkflowJobsApi,
    repository,
    runAuthorities,
    runs,
    sourceSha,
  });
  const declaredFamilyListing = campaign.familyCandidates
    .map(({ artifactId, family, runCreatedAt, runId }) => ({
      artifactId,
      family,
      runCreatedAt,
      runId,
    }))
    .sort(campaignCandidateInventoryOrder);
  if (canonicalJson(classified.familyCandidates) !== canonicalJson(declaredFamilyListing)) {
    throw new TypeError(
      'campaign family candidate custody omits or invents an eligible artifact, or admits an ineligible artifact',
    );
  }
  if (
    canonicalJson(classified.excludedFamilyArtifacts) !==
    canonicalJson(campaign.excludedFamilyArtifacts)
  ) {
    throw new TypeError('campaign excluded family artifact census differs from job authority');
  }
  const declaredProductionListing = campaign.productionBytesCandidates
    .map(({ artifactId, runCreatedAt, runId }) => ({ artifactId, runCreatedAt, runId }))
    .sort(campaignChronologyOrder);
  if (canonicalJson(classified.productionBytes) !== canonicalJson(declaredProductionListing)) {
    throw new TypeError(
      'campaign Production bytes candidate custody omits or invents a listed artifact',
    );
  }

  const common = {
    baseDirectory,
    descriptorCustody: custody,
    descriptorReadHook,
    fetchArtifactApi,
    fetchWorkflowFileApi,
    fetchWorkflowJobsApi: async ({ repository: requestedRepository, workflowRunId }) => {
      if (requestedRepository !== repository || !classified.liveJobsByRun.has(workflowRunId)) {
        throw new TypeError('campaign candidate requested foreign workflow jobs authority');
      }
      return Buffer.from(classified.liveJobsByRun.get(workflowRunId));
    },
    fetchWorkflowRunApi,
    loadTrustedWorkflow,
    now,
    repository,
    repositoryDirectory,
  };
  const familyCandidates = [];
  for (const candidate of campaign.familyCandidates) {
    const config = FAMILY_CONFIG[candidate.family];
    const authenticated = await authenticateArtifactEvidence(candidate.descriptor, {
      ...common,
      expectedArtifactName: config.artifactName,
      expectedArchiveMembers: [config.reportMember],
      expectedReportMember: config.reportMember,
      expectedWorkflowJob: config.workflowJob,
    });
    const run = runAuthorities.find((entry) => entry.runId === candidate.runId);
    const findings = campaignFamilyCandidateFindings(candidate, authenticated, sourceSha, {
      repository,
      run,
    });
    if (findings.length > 0) {
      throw new TypeError(
        `${candidate.family} campaign candidate ${String(candidate.artifactId)}: ${findings.join('\n')}`,
      );
    }
    familyCandidates.push({ ...candidate, ...authenticated });
  }
  const productionBytesCandidates = [];
  for (const candidate of campaign.productionBytesCandidates) {
    const authenticated = await authenticateArtifactEvidence(candidate.descriptor, {
      ...common,
      allowedProducerJobConclusions: ['failure', 'success'],
      allowedProducerFailureStep: PRODUCTION_BYTES_CONFIG.budgetFailureStep,
      requiredProducerSuccessSteps: PRODUCTION_BYTES_CONFIG.budgetFailureSuccessSteps,
      expectedArtifactName: PRODUCTION_BYTES_CONFIG.artifactName,
      expectedArchiveMembers: [PRODUCTION_BYTES_CONFIG.reportMember],
      expectedReportMember: PRODUCTION_BYTES_CONFIG.reportMember,
      expectedWorkflowJob: PRODUCTION_BYTES_CONFIG.workflowJob,
    });
    const findings = [
      ...productionBytesReportFindings(authenticated.report),
      ...(authenticated.custody?.artifactId !== candidate.artifactId ||
      authenticated.custody?.workflowRunId !== candidate.runId ||
      authenticated.report?.execution?.digest !== candidate.executionDigest
        ? ['candidate identity differs from authenticated artifact/report custody']
        : []),
      ...(authenticated.report?.source?.commit !== sourceSha
        ? ['candidate source differs from campaign source']
        : []),
    ];
    if (findings.length > 0) {
      throw new TypeError(
        `Production bytes campaign candidate ${String(candidate.artifactId)}: ${findings.join('\n')}`,
      );
    }
    productionBytesCandidates.push({ ...candidate, ...authenticated });
  }
  productionBytesCandidates.sort(campaignChronologyOrder);
  return {
    excludedFamilyArtifacts: classified.excludedFamilyArtifacts,
    familyCandidates,
    productionBytesCandidates,
  };
}

function campaignFamilyCandidateFindings(candidate, authenticated, sourceSha, { repository, run }) {
  const findings = [];
  const report = authenticated?.report;
  const familyName = candidate.family;
  const policy = FAMILY_CONFIG[familyName];
  const comparison = familyName !== 'check';
  const packedProduct = familyName.startsWith('dev-') || familyName.startsWith('build-');
  const expectedSchema = comparison ? 'kovo-next-performance-comparison/v1' : 'kovo-perf-report/v1';
  if (!ownRecord(report) || report.schema !== expectedSchema) {
    findings.push(`${familyName} report schema differs`);
  }
  if (
    authenticated?.custody?.artifactId !== candidate.artifactId ||
    authenticated?.custody?.workflowRunId !== candidate.runId ||
    report?.execution?.digest !== candidate.executionDigest ||
    report?.host?.digest !== candidate.hostDigest ||
    report?.source?.commit !== sourceSha
  ) {
    findings.push('selection identity differs from authenticated artifact/report custody');
  }
  if (
    report?.source?.commit !== sourceSha ||
    report?.source?.dirty !== false ||
    canonicalJson(report?.source?.dirtyPaths) !== canonicalJson([])
  ) {
    findings.push(`${familyName} report source is wrong or dirty`);
  }
  if (canonicalJson(report?.source) !== canonicalJson(report?.sourceAfter)) {
    findings.push(`${familyName} report source changed during measurement`);
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
  const runUrl = `https://github.com/${repository}/actions/runs/${String(candidate.runId)}`;
  const workflowRefPrefix = `${repository}/${PERF_REALISTIC_WORKFLOW_PATH}@`;
  if (
    github?.repository !== repository ||
    github?.serverUrl !== 'https://github.com' ||
    github?.runUrl !== runUrl ||
    String(github?.runId ?? '') !== String(candidate.runId) ||
    String(github?.runAttempt ?? '') !== String(run?.runAttempt) ||
    github?.sha !== sourceSha ||
    github?.job !== policy.workflowJob.key ||
    !nonEmptyString(github?.workflowRef) ||
    !github.workflowRef.startsWith(workflowRefPrefix) ||
    !COMMIT_PATTERN.test(github?.eventSha ?? '') ||
    !COMMIT_PATTERN.test(github?.workflowSha ?? '') ||
    (run?.event === 'pull_request'
      ? github.eventSha !== github.workflowSha
      : github.eventSha !== sourceSha || github.workflowSha !== sourceSha)
  ) {
    findings.push(`${familyName} report execution differs from its workflow run and job`);
  }
  const expectedCell = campaignFamilyCell(candidate.family);
  const expectedCorpus = policy.corpusSize;
  if (
    canonicalJson(report?.workloadIdentity?.identity?.cells) !== canonicalJson([expectedCell]) ||
    (Number.isSafeInteger(expectedCorpus) &&
      report?.workloadIdentity?.identity?.policies?.corpusSize !== expectedCorpus)
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
  if (comparison) {
    if (report?.integrity?.comparatorMatched !== true) {
      findings.push(`${familyName} comparator integrity is incomplete`);
    }
  } else if (report?.integrity?.complete !== true || report?.suite !== 'check-scaling') {
    findings.push('check report completeness or suite identity differs');
  }
  if (report?.verdict?.status !== 'measured') {
    findings.push(`${familyName} report is not measured`);
  }
  if (packedProduct) {
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
  } else if (comparison && report?.productArtifact !== null) {
    findings.push(`${familyName} unexpectedly carries packed product identity`);
  }
  const cohortDigest = campaignFamilyCohortDigest(report, candidate.family);
  if (candidate.cohortDigest !== cohortDigest) {
    findings.push('cohort digest differs from authenticated metrics-blind selection inputs');
  }
  return [...new Set(findings)];
}

function selectGateCampaignFamilyCandidates(candidates, cohortSelections) {
  const result = {};
  for (const familyName of FAMILY_NAMES) {
    const groups = new Map();
    for (const candidate of candidates.filter((entry) => entry.family === familyName)) {
      const digest = campaignFamilyCohortDigest(candidate.report, familyName);
      const members = groups.get(digest) ?? [];
      members.push(candidate);
      groups.set(digest, members);
    }
    const qualifying = [...groups.entries()]
      .map(([digest, members]) => [digest, [...members].sort(campaignChronologyOrder)])
      .filter(([, members]) => members.length >= 6)
      .sort(([left], [right]) => left.localeCompare(right));
    if (qualifying.length === 0) {
      throw new TypeError(`${familyName} has no authenticated six-run campaign cohort`);
    }
    const selector = cohortSelections[familyName];
    if (qualifying.length === 1 && selector !== undefined) {
      throw new TypeError(`${familyName} cohort selector is unnecessary for one qualifying cohort`);
    }
    if (qualifying.length > 1 && selector === undefined) {
      throw new TypeError(`${familyName} has multiple qualifying cohorts without explicit choice`);
    }
    const eligible =
      selector === undefined
        ? qualifying
        : qualifying.filter(
            ([digest, members]) => digest === selector || members[0]?.hostDigest === selector,
          );
    if (eligible.length !== 1) {
      throw new TypeError(`${familyName} cohort selector does not identify one qualifying cohort`);
    }
    result[familyName] = eligible[0][1].slice(0, 6);
  }
  return result;
}

function assertSelectedFamilyDescriptors(selectedCandidates, selectedFamilies) {
  for (const familyName of FAMILY_NAMES) {
    const selectedEvidence = [
      ...(selectedFamilies?.[familyName]?.baseline ?? []),
      selectedFamilies?.[familyName]?.holdout,
    ];
    const candidates = selectedCandidates[familyName] ?? [];
    if (selectedEvidence.length !== 6 || candidates.length !== 6) {
      throw new TypeError(`${familyName} selected descriptor census is not exactly five plus one`);
    }
    for (let index = 0; index < 6; index += 1) {
      const evidence = selectedEvidence[index];
      const candidate = candidates[index];
      if (
        evidence?.custody?.artifactId !== candidate.artifactId ||
        evidence?.custody?.workflowRunId !== candidate.runId ||
        evidence?.report?.execution?.digest !== candidate.executionDigest ||
        evidence?.contentDigest !== candidate.contentDigest
      ) {
        throw new TypeError(
          `${familyName} selected descriptor[${String(index)}] differs from gate-derived campaign selection`,
        );
      }
    }
  }
}

function campaignFamilyCohortDigest(report, familyName) {
  return sha256Canonical({
    host: report?.host?.digest ?? null,
    locks: report?.source?.locks ?? null,
    sourceCommit: report?.source?.commit ?? null,
    workload: report?.workloadIdentity ?? null,
    ...(familyName.startsWith('dev-') || familyName.startsWith('build-')
      ? {
          product: {
            artifact: report?.productArtifact ?? null,
            policy: report?.workloadIdentity?.identity?.productArtifactPolicy ?? null,
          },
        }
      : {}),
  });
}

function campaignFamilyCell(familyName) {
  if (familyName.startsWith('dev-')) return 'dev';
  if (familyName.startsWith('build-')) return 'build';
  return familyName === 'check' ? 'check-scaling' : familyName;
}

function campaignCandidateInventoryOrder(left, right) {
  return (
    campaignChronologyOrder(left, right) ||
    FAMILY_NAMES.indexOf(left.family) - FAMILY_NAMES.indexOf(right.family) ||
    left.artifactId - right.artifactId
  );
}

function excludedFamilyArtifactOrder(left, right) {
  return (
    left.runId - right.runId ||
    left.artifactId - right.artifactId ||
    String(left.family ?? '').localeCompare(String(right.family ?? ''))
  );
}

function candidateChronologyIdentity(candidate) {
  return {
    artifactId: candidate.artifactId,
    runCreatedAt: candidate.runCreatedAt,
    runId: candidate.runId,
  };
}

function campaignCandidateReference(candidate) {
  return {
    artifactId: candidate.artifactId,
    ...(candidate.family === undefined
      ? {}
      : {
          cohortDigest: candidate.cohortDigest,
          family: candidate.family,
          hostDigest: candidate.hostDigest,
        }),
    contentDigest: candidate.contentDigest,
    executionDigest: candidate.executionDigest,
    runCreatedAt: candidate.runCreatedAt,
    runId: candidate.runId,
  };
}

async function readCampaignCustodyReference(reference, label, { custody, descriptorReadHook }) {
  validateCampaignCustodyReference(reference, label);
  const bytes = await readPerformanceArtifactCustodyFile(reference.path, {
    custody,
    descriptorKey: `campaign:${label}`,
    label,
    maximumBytes: MAX_API_RESPONSE_BYTES,
    readHook: descriptorReadHook,
  });
  if (bytes.length !== reference.byteLength || sha256Bytes(bytes) !== reference.contentDigest) {
    throw new TypeError(`${label} differs from its content-addressed manifest reference`);
  }
  return bytes;
}

function validateCampaignManifest(campaign) {
  if (
    !ownRecord(campaign) ||
    canonicalJson(Object.keys(campaign).sort()) !==
      canonicalJson([
        'boundary',
        'cohortSelections',
        'excludedFamilyArtifacts',
        'familyCandidates',
        'productionBytes',
        'productionBytesCandidates',
        'runs',
        'selectedProductionBytes',
        'workflowRunsApiMetadata',
      ])
  ) {
    throw new TypeError('manifest campaign field census differs');
  }
  const firstRunId = campaign?.boundary?.firstRunId;
  const lastRunId = campaign?.boundary?.lastRunId;
  if (
    !ownRecord(campaign.boundary) ||
    canonicalJson(Object.keys(campaign.boundary).sort()) !==
      canonicalJson(['firstRunId', 'lastRunId']) ||
    !Number.isSafeInteger(firstRunId) ||
    !Number.isSafeInteger(lastRunId) ||
    firstRunId < 1 ||
    firstRunId > lastRunId
  ) {
    throw new TypeError('manifest campaign boundary is malformed');
  }
  validateCampaignCustodyReference(campaign.workflowRunsApiMetadata, 'campaign workflow-runs API');
  if (
    !ownRecord(campaign.cohortSelections) ||
    Object.keys(campaign.cohortSelections).some(
      (family) =>
        !FAMILY_NAMES.includes(family) ||
        !DIGEST_PATTERN.test(campaign.cohortSelections[family] ?? ''),
    )
  ) {
    throw new TypeError('manifest campaign cohort selections are malformed');
  }
  if (
    !Array.isArray(campaign.runs) ||
    campaign.runs.length < 1 ||
    campaign.runs.length > MAX_CAMPAIGN_RUNS
  ) {
    throw new TypeError('manifest campaign run census is unavailable');
  }
  for (const run of campaign.runs) {
    if (
      !ownRecord(run) ||
      canonicalJson(Object.keys(run).sort()) !==
        canonicalJson(['artifactsApiMetadata', 'runApiMetadata', 'runCreatedAt', 'runId']) ||
      !Number.isSafeInteger(run.runId) ||
      run.runId < firstRunId ||
      run.runId > lastRunId ||
      !validExactTimestamp(run.runCreatedAt)
    ) {
      throw new TypeError('manifest campaign run identity is malformed');
    }
    validateCampaignCustodyReference(
      run.runApiMetadata,
      `campaign run ${String(run.runId)} run API`,
    );
    validateCampaignCustodyReference(
      run.artifactsApiMetadata,
      `campaign run ${String(run.runId)} artifacts API`,
    );
  }
  if (
    new Set(campaign.runs.map((run) => run.runId)).size !== campaign.runs.length ||
    canonicalJson([...campaign.runs].sort(campaignChronologyOrder)) !== canonicalJson(campaign.runs)
  ) {
    throw new TypeError('manifest campaign run chronology is duplicated or non-canonical');
  }
  if (!Array.isArray(campaign.familyCandidates) || campaign.familyCandidates.length < 42) {
    throw new TypeError('manifest campaign family candidate census is incomplete');
  }
  const familyCandidateArtifacts = new Set();
  const familyCandidateExecutions = new Set();
  const familyCandidateRuns = new Set();
  const manifestRuns = new Map(campaign.runs.map((run) => [run.runId, run]));
  const excludedFamilyArtifacts = validateExcludedFamilyArtifacts(
    campaign.excludedFamilyArtifacts,
    [...manifestRuns.keys()],
  );
  for (const candidate of campaign.familyCandidates) {
    if (
      !ownRecord(candidate) ||
      canonicalJson(Object.keys(candidate).sort()) !==
        canonicalJson([
          'artifactId',
          'cohortDigest',
          'descriptor',
          'executionDigest',
          'family',
          'hostDigest',
          'runCreatedAt',
          'runId',
        ]) ||
      !FAMILY_NAMES.includes(candidate.family) ||
      !Number.isSafeInteger(candidate.artifactId) ||
      candidate.artifactId < 1 ||
      !Number.isSafeInteger(candidate.runId) ||
      !DIGEST_PATTERN.test(candidate.cohortDigest ?? '') ||
      !DIGEST_PATTERN.test(candidate.executionDigest ?? '') ||
      !DIGEST_PATTERN.test(candidate.hostDigest ?? '') ||
      !validExactTimestamp(candidate.runCreatedAt) ||
      manifestRuns.get(candidate.runId)?.runCreatedAt !== candidate.runCreatedAt
    ) {
      throw new TypeError('manifest campaign family candidate identity is malformed');
    }
    validateManifestEvidenceDescriptor(
      candidate.descriptor,
      `campaign ${candidate.family} candidate ${String(candidate.artifactId)}`,
    );
    const runFamily = `${String(candidate.runId)}:${candidate.family}`;
    if (
      familyCandidateArtifacts.has(candidate.artifactId) ||
      familyCandidateExecutions.has(candidate.executionDigest) ||
      familyCandidateRuns.has(runFamily) ||
      excludedFamilyArtifacts.artifactIds.has(candidate.artifactId) ||
      excludedFamilyArtifacts.runFamilies.has(runFamily)
    ) {
      throw new TypeError('manifest campaign family candidate identities are duplicated');
    }
    familyCandidateArtifacts.add(candidate.artifactId);
    familyCandidateExecutions.add(candidate.executionDigest);
    familyCandidateRuns.add(runFamily);
  }
  if (
    canonicalJson([...campaign.familyCandidates].sort(campaignCandidateInventoryOrder)) !==
    canonicalJson(campaign.familyCandidates)
  ) {
    throw new TypeError('manifest campaign family candidate chronology is non-canonical');
  }
  if (
    !Array.isArray(campaign.productionBytesCandidates) ||
    campaign.productionBytesCandidates.length < 1
  ) {
    throw new TypeError('manifest campaign Production bytes candidate census is incomplete');
  }
  const productionCandidateArtifacts = new Set();
  const productionCandidateExecutions = new Set();
  const productionCandidateRuns = new Set();
  for (const candidate of campaign.productionBytesCandidates) {
    if (
      !ownRecord(candidate) ||
      canonicalJson(Object.keys(candidate).sort()) !==
        canonicalJson(['artifactId', 'descriptor', 'executionDigest', 'runCreatedAt', 'runId']) ||
      !Number.isSafeInteger(candidate.artifactId) ||
      candidate.artifactId < 1 ||
      !Number.isSafeInteger(candidate.runId) ||
      !DIGEST_PATTERN.test(candidate.executionDigest ?? '') ||
      !validExactTimestamp(candidate.runCreatedAt) ||
      manifestRuns.get(candidate.runId)?.runCreatedAt !== candidate.runCreatedAt ||
      familyCandidateArtifacts.has(candidate.artifactId) ||
      excludedFamilyArtifacts.artifactIds.has(candidate.artifactId) ||
      familyCandidateExecutions.has(candidate.executionDigest) ||
      productionCandidateArtifacts.has(candidate.artifactId) ||
      productionCandidateExecutions.has(candidate.executionDigest) ||
      productionCandidateRuns.has(candidate.runId)
    ) {
      throw new TypeError('manifest campaign Production bytes candidate identity is malformed');
    }
    validateManifestEvidenceDescriptor(
      candidate.descriptor,
      `campaign Production bytes candidate ${String(candidate.artifactId)}`,
    );
    productionCandidateArtifacts.add(candidate.artifactId);
    productionCandidateExecutions.add(candidate.executionDigest);
    productionCandidateRuns.add(candidate.runId);
  }
  if (
    canonicalJson([...campaign.productionBytesCandidates].sort(campaignChronologyOrder)) !==
    canonicalJson(campaign.productionBytesCandidates)
  ) {
    throw new TypeError('manifest campaign Production bytes candidate chronology is non-canonical');
  }
  for (const [label, value] of [
    ['Production bytes chronology', campaign.productionBytes],
    ['selected Production bytes', [campaign.selectedProductionBytes]],
  ]) {
    if (
      !Array.isArray(value) ||
      value.length < 1 ||
      value.some(
        (candidate) =>
          !ownRecord(candidate) ||
          canonicalJson(Object.keys(candidate).sort()) !==
            canonicalJson(['artifactId', 'runCreatedAt', 'runId']) ||
          !Number.isSafeInteger(candidate.artifactId) ||
          candidate.artifactId < 1 ||
          !Number.isSafeInteger(candidate.runId) ||
          !validExactTimestamp(candidate.runCreatedAt),
      )
    ) {
      throw new TypeError(`manifest campaign ${label} is malformed`);
    }
  }
}

function validateCampaignCustodyReference(reference, label) {
  if (
    !ownRecord(reference) ||
    canonicalJson(Object.keys(reference).sort()) !==
      canonicalJson(['byteLength', 'contentDigest', 'path']) ||
    !Number.isSafeInteger(reference.byteLength) ||
    reference.byteLength < 1 ||
    !DIGEST_PATTERN.test(reference.contentDigest ?? '') ||
    !nonEmptyString(reference.path)
  ) {
    throw new TypeError(`${label} content-addressed reference is malformed`);
  }
}

function validateExcludedFamilyArtifacts(entries, runIds) {
  if (!Array.isArray(entries) || entries.length > FAMILY_NAMES.length * runIds.length) {
    throw new TypeError('manifest campaign excluded family artifact census exceeds its boundary');
  }
  const artifactIds = new Set();
  const producerJobIds = new Set();
  const runFamilies = new Set();
  for (const entry of entries) {
    const runFamily = `${String(entry?.runId)}:${String(entry?.family)}`;
    if (
      !ownRecord(entry) ||
      canonicalJson(Object.keys(entry).sort()) !==
        canonicalJson(['artifactId', 'conclusion', 'family', 'producerJobId', 'runId']) ||
      !runIds.includes(entry.runId) ||
      !FAMILY_NAMES.includes(entry.family) ||
      !Number.isSafeInteger(entry.artifactId) ||
      entry.artifactId < 1 ||
      !Number.isSafeInteger(entry.producerJobId) ||
      entry.producerJobId < 1 ||
      entry.conclusion === 'success' ||
      !TERMINAL_JOB_CONCLUSIONS.includes(entry.conclusion)
    ) {
      throw new TypeError('manifest campaign excluded family artifact identity is malformed');
    }
    if (
      artifactIds.has(entry.artifactId) ||
      producerJobIds.has(entry.producerJobId) ||
      runFamilies.has(runFamily)
    ) {
      throw new TypeError('manifest campaign excluded family artifact identities are duplicated');
    }
    artifactIds.add(entry.artifactId);
    producerJobIds.add(entry.producerJobId);
    runFamilies.add(runFamily);
  }
  if (canonicalJson([...entries].sort(excludedFamilyArtifactOrder)) !== canonicalJson(entries)) {
    throw new TypeError('manifest campaign excluded family artifact chronology is non-canonical');
  }
  return { artifactIds, producerJobIds, runFamilies };
}

function campaignWorkflowRunsAuthorityProjection(listing, { boundary, sourceSha }) {
  if (
    !ownRecord(listing) ||
    !Number.isSafeInteger(listing.total_count) ||
    listing.total_count < 1 ||
    listing.total_count > MAX_CAMPAIGN_RUNS ||
    !Array.isArray(listing.workflow_runs) ||
    listing.workflow_runs.length !== listing.total_count
  ) {
    throw new TypeError('campaign workflow-runs API census is incomplete or exceeds one page');
  }
  const ids = listing.workflow_runs.map((run) => run?.id);
  if (ids.some((id) => !Number.isSafeInteger(id) || id < 1) || new Set(ids).size !== ids.length) {
    throw new TypeError('campaign workflow-runs API identities are missing or duplicated');
  }
  if (
    listing.workflow_runs.some(
      (run) =>
        run?.head_sha !== sourceSha ||
        run?.name !== 'Perf Realistic Tier' ||
        run?.path !== PERF_REALISTIC_WORKFLOW_PATH ||
        !Object.hasOwn(BASELINE_TRIGGER_SCOPES, run?.event) ||
        !validExactTimestamp(run?.created_at),
    )
  ) {
    throw new TypeError('campaign workflow-runs API contains foreign run identity');
  }
  const runs = listing.workflow_runs
    .filter((run) => run.id >= boundary.firstRunId && run.id <= boundary.lastRunId)
    .map((run) => {
      if (
        run?.head_sha !== sourceSha ||
        run?.name !== 'Perf Realistic Tier' ||
        run?.path !== PERF_REALISTIC_WORKFLOW_PATH ||
        run?.event !== 'pull_request' ||
        !validExactTimestamp(run?.created_at)
      ) {
        throw new TypeError('campaign workflow-runs API contains foreign run identity');
      }
      return {
        conclusion: run.conclusion ?? null,
        event: run.event,
        runCreatedAt: run.created_at,
        runId: run.id,
        runAttempt: run.run_attempt,
        status: run.status,
      };
    })
    .sort(campaignChronologyOrder);
  if (
    runs.length < 1 ||
    !runs.some((run) => run.runId === boundary.firstRunId) ||
    !runs.some((run) => run.runId === boundary.lastRunId)
  ) {
    throw new TypeError('campaign boundary endpoints are absent from workflow-runs authority');
  }
  return runs;
}

function campaignRunAuthorityProjection(run, { repository, runId, sourceSha }) {
  const apiUrl = `https://api.github.com/repos/${repository}/actions/runs/${String(runId)}`;
  if (
    !ownRecord(run) ||
    run.id !== runId ||
    run.head_sha !== sourceSha ||
    run.name !== 'Perf Realistic Tier' ||
    run.path !== PERF_REALISTIC_WORKFLOW_PATH ||
    run.event !== 'pull_request' ||
    run.url !== apiUrl ||
    run.artifacts_url !== `${apiUrl}/artifacts` ||
    !validExactTimestamp(run.created_at)
  ) {
    throw new TypeError(`campaign run ${String(runId)} authority is malformed`);
  }
  return {
    conclusion: run.conclusion ?? null,
    event: run.event,
    runAttempt: run.run_attempt,
    runCreatedAt: run.created_at,
    runId,
    status: run.status,
  };
}

function campaignArtifactsAuthorityProjection(listing, runId) {
  if (
    !ownRecord(listing) ||
    !Number.isSafeInteger(listing.total_count) ||
    listing.total_count < 0 ||
    listing.total_count > MAX_CAMPAIGN_RUNS ||
    !Array.isArray(listing.artifacts) ||
    listing.artifacts.length !== listing.total_count
  ) {
    throw new TypeError(`campaign run ${String(runId)} artifact census is incomplete`);
  }
  const ids = listing.artifacts.map((artifact) => artifact?.id);
  if (ids.some((id) => !Number.isSafeInteger(id) || id < 1) || new Set(ids).size !== ids.length) {
    throw new TypeError(`campaign run ${String(runId)} artifact identities are duplicated`);
  }
  const byArtifactName = new Map(
    Object.entries(FAMILY_CONFIG).map(([family, config]) => [config.artifactName, family]),
  );
  const publicationArtifacts = [];
  for (const artifact of listing.artifacts) {
    const family = byArtifactName.get(artifact?.name);
    if (family !== undefined) {
      publicationArtifacts.push({ artifactId: artifact.id, family, kind: 'family' });
    } else if (artifact?.name === PRODUCTION_BYTES_CONFIG.artifactName) {
      publicationArtifacts.push({ artifactId: artifact.id, kind: 'production-bytes' });
    }
  }
  const roles = publicationArtifacts.map((artifact) => artifact.family ?? artifact.kind);
  if (new Set(roles).size !== roles.length) {
    throw new TypeError(`campaign run ${String(runId)} has ambiguous publication artifacts`);
  }
  publicationArtifacts.sort((left, right) => left.artifactId - right.artifactId);
  return {
    authority: listing.artifacts
      .map((artifact) => structuredClone(artifact))
      .sort((left, right) => left.id - right.id),
    publicationArtifacts,
    totalCount: listing.total_count,
  };
}

function validateCampaignPublicationArtifactFloor(publicationArtifacts, runAuthority) {
  const runId = runAuthority?.runId;
  if (runAuthority?.event !== 'pull_request') {
    throw new TypeError(
      `campaign run ${String(runId)} is not a pull_request publication campaign run`,
    );
  }
  if (publicationArtifacts.length === 0) {
    throw new TypeError(`campaign run ${String(runId)} has no literal publication artifact`);
  }
  const productionBytesCount = publicationArtifacts.filter(
    (artifact) => artifact.kind === 'production-bytes',
  ).length;
  if (productionBytesCount !== 1) {
    throw new TypeError(
      `pull_request campaign run ${String(runId)} must expose exactly one literal Production bytes artifact`,
    );
  }
}

function campaignChronologyOrder(left, right) {
  const timestamp = Date.parse(left.runCreatedAt) - Date.parse(right.runCreatedAt);
  return timestamp === 0 ? left.runId - right.runId : timestamp;
}

function parseCampaignJson(bytes, label) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > MAX_API_RESPONSE_BYTES) {
    throw new TypeError(`${label} bytes are unavailable`);
  }
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new TypeError(`${label} is not valid JSON`);
  }
}

/** Read perf-budgets.json only from the exact clean measured-source checkout. */
export async function loadCommittedPerformanceBudgets({ repositoryDirectory, sourceSha }) {
  if (!COMMIT_PATTERN.test(sourceSha ?? '')) {
    throw new TypeError('performance budget source SHA is unavailable');
  }
  const requestedRoot = await realpath(path.resolve(repositoryDirectory ?? process.cwd()));
  const { stdout: rootOutput } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
    cwd: requestedRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
  });
  const root = await realpath(rootOutput.trim());
  if (root !== requestedRoot) {
    throw new TypeError('performance budget checkout must be the exact Git worktree root');
  }
  const budgetPath = path.join(root, 'perf-budgets.json');
  const [facts, resolvedBudgetPath] = await Promise.all([lstat(budgetPath), realpath(budgetPath)]);
  if (
    !facts.isFile() ||
    facts.isSymbolicLink() ||
    resolvedBudgetPath !== budgetPath ||
    facts.size < 1 ||
    facts.size > 1024 * 1024
  ) {
    throw new TypeError('committed perf-budgets.json is not a bounded regular file');
  }
  const [{ stdout: headOutput }, { stdout: statusOutput }, { stdout: committedBytes }, bytes] =
    await Promise.all([
      execFileAsync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        timeout: 30_000,
      }),
      execFileAsync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        timeout: 30_000,
      }),
      execFileAsync('git', ['show', 'HEAD:perf-budgets.json'], {
        cwd: root,
        encoding: 'buffer',
        maxBuffer: 1024 * 1024,
        timeout: 30_000,
      }),
      readFile(budgetPath),
    ]);
  const after = await lstat(budgetPath);
  if (
    !after.isFile() ||
    after.isSymbolicLink() ||
    after.dev !== facts.dev ||
    after.ino !== facts.ino ||
    after.size !== facts.size ||
    after.mtimeMs !== facts.mtimeMs ||
    bytes.length !== facts.size
  ) {
    throw new TypeError('perf-budgets.json changed while it was authenticated');
  }
  if (headOutput.trim() !== sourceSha) {
    throw new TypeError('performance budget checkout HEAD differs from the measured source SHA');
  }
  if (statusOutput !== '') {
    throw new TypeError('performance budget checkout has uncommitted or untracked changes');
  }
  if (!Buffer.isBuffer(committedBytes) || !bytes.equals(committedBytes)) {
    throw new TypeError('perf-budgets.json differs from committed measured-source bytes');
  }
  const budgets = parseOutputJson(bytes, 'committed perf-budgets.json');
  const budgetFindings = productionBytesBudgetFindings(budgets);
  if (budgetFindings.length > 0) {
    throw new TypeError(budgetFindings.join('\n'));
  }
  return {
    budgetBytes: Buffer.from(bytes),
    budgetIdentity: {
      byteLength: bytes.length,
      contentDigest: sha256Bytes(bytes),
      path: 'perf-budgets.json',
      schema: budgets.schema,
      sourceCommit: sourceSha,
    },
    budgets,
  };
}

export function productionBytesReportFindings(report) {
  const findings = [];
  if (!ownRecord(report) || report.schema !== 'kovo-perf-report/v1') {
    findings.push('report schema must be kovo-perf-report/v1');
  }
  const expectedSourceKeys = ['commit', 'dirty', 'dirtyPaths', 'locks'];
  for (const [label, source] of [
    ['source', report?.source],
    ['sourceAfter', report?.sourceAfter],
  ]) {
    if (
      !ownRecord(source) ||
      canonicalJson(Object.keys(source).sort()) !== canonicalJson(expectedSourceKeys) ||
      !COMMIT_PATTERN.test(source.commit ?? '') ||
      source.dirty !== false ||
      canonicalJson(source.dirtyPaths) !== canonicalJson([]) ||
      !ownRecord(source.locks) ||
      canonicalJson(Object.keys(source.locks).sort()) !==
        canonicalJson([...REQUIRED_LOCKS].sort()) ||
      REQUIRED_LOCKS.some((lock) => !DIGEST_PATTERN.test(source.locks[lock] ?? ''))
    ) {
      findings.push(`${label} and dependency-lock identity are malformed`);
    }
  }
  if (canonicalJson(report?.source) !== canonicalJson(report?.sourceAfter)) {
    findings.push('sourceAfter differs from source');
  }
  if (
    report?.execution?.provider !== 'github-actions' ||
    report?.execution?.complete !== true ||
    !DIGEST_PATTERN.test(report?.execution?.digest ?? '') ||
    report?.execution?.github?.job !== PRODUCTION_BYTES_CONFIG.workflowJob.key ||
    report?.execution?.github?.sha !== report?.source?.commit
  ) {
    findings.push('execution identity is malformed or belongs to the wrong job/source');
  }
  findings.push(
    ...executionIdentityFindings(report?.execution, { requireProvider: 'github-actions' }),
  );
  findings.push(
    ...performanceHostFingerprintFindings(report?.host).map((finding) => `host ${finding}`),
  );
  const expectedIntegrity = [
    'complete',
    'executionAuthenticated',
    'publishable',
    'serialized',
    'sourceStable',
    'workloadAuthenticated',
  ];
  if (
    !ownRecord(report?.integrity) ||
    canonicalJson(Object.keys(report.integrity).sort()) !== canonicalJson(expectedIntegrity) ||
    expectedIntegrity.some((field) => report.integrity[field] !== true)
  ) {
    findings.push('integrity census is malformed or incomplete');
  }
  const expectedWorkload = performanceGateWorkloadIdentity('bytes', {
    componentCount: PRODUCTION_BYTES_CONFIG.componentCount,
  });
  if (
    report?.suite !== 'bytes' ||
    report?.options?.componentCount !== PRODUCTION_BYTES_CONFIG.componentCount
  ) {
    findings.push('suite or componentCount differs from the exact Production bytes policy');
  }
  if (canonicalJson(report?.workloadIdentity) !== canonicalJson(expectedWorkload)) {
    findings.push('workload identity differs from the exact Production bytes wrapper and policy');
  }
  if (
    !ownRecord(report?.metrics) ||
    canonicalJson(Object.keys(report.metrics).sort()) !==
      canonicalJson([...PRODUCTION_BYTES_METRICS].sort())
  ) {
    findings.push('metric census is not the exact five Production bytes metrics');
  } else {
    for (const metricId of PRODUCTION_BYTES_METRICS) {
      const observation = report.metrics[metricId];
      if (
        !ownRecord(observation) ||
        canonicalJson(Object.keys(observation)) !== canonicalJson(['value']) ||
        !Number.isSafeInteger(observation.value) ||
        observation.value < 0
      ) {
        findings.push(`${metricId} observation is malformed`);
      }
    }
  }
  if (
    report?.verdict?.status !== 'measured' ||
    canonicalJson(report?.verdict?.reasons) !== canonicalJson([])
  ) {
    findings.push('report verdict is not measured');
  }
  return [...new Set(findings)].sort();
}

function productionBytesBudgetFindings(budgets) {
  const findings = [];
  if (!ownRecord(budgets) || budgets.schema !== PERF_BUDGETS_SCHEMA) {
    findings.push(`perf budgets schema must be ${PERF_BUDGETS_SCHEMA}`);
    return findings;
  }
  for (const metricId of PRODUCTION_BYTES_METRICS) {
    const budget = budgets.metrics?.[metricId];
    if (
      !ownRecord(budget) ||
      budget.unit !== 'bytes' ||
      budget.loadSensitive !== false ||
      !Number.isSafeInteger(budget.max) ||
      budget.max < 0
    ) {
      findings.push(`${metricId} committed deterministic byte budget is unavailable`);
    }
  }
  return findings;
}

function productionBytesBudgetCustodyFindings(entry, sourceCommit) {
  const findings = [];
  const bytes = entry?.budgetBytes;
  const identity = entry?.budgetIdentity;
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 1024 * 1024) {
    return ['committed perf-budgets.json bytes are unavailable'];
  }
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) {
    findings.push('committed perf-budgets.json bytes are not canonical UTF-8');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    findings.push('committed perf-budgets.json bytes are not valid JSON');
  }
  if (parsed !== undefined && canonicalJson(parsed) !== canonicalJson(entry?.budgets)) {
    findings.push('parsed perf-budgets.json differs from the retained budget document');
  }
  if (
    !ownRecord(identity) ||
    identity.path !== 'perf-budgets.json' ||
    identity.schema !== PERF_BUDGETS_SCHEMA ||
    identity.sourceCommit !== sourceCommit ||
    identity.byteLength !== bytes.length ||
    identity.contentDigest !== sha256Bytes(bytes)
  ) {
    findings.push('perf-budgets.json byte identity is malformed or unbound');
  }
  return findings;
}

/**
 * Re-ratify, derive, and independently evaluate every authenticated family. `operations` is an
 * explicit test seam; the CLI always uses the closed default map above.
 */
export function derivePerformancePublication(
  authenticated,
  {
    assessBuildPersistence = assessBuildForegroundSession,
    buildProfileEntries,
    generatedAt = new Date().toISOString(),
    operations = FAMILY_CONFIG,
    ratify = ratifyPerformanceBaseline,
  } = {},
) {
  if (!validExactTimestamp(generatedAt)) {
    throw new TypeError('publication generatedAt must be a valid timestamp');
  }
  const structureFindings = authenticatedInputFindings(authenticated);
  const allEntries = familyEntries(authenticated);
  const identityFindings = exactPublicationIdentityFindings(allEntries);
  const reasons = [...structureFindings, ...identityFindings];
  const documents = {};
  const families = {};
  const sourceCommit = allEntries[0]?.report?.source?.commit ?? null;
  const locks = allEntries[0]?.report?.source?.locks ?? null;
  const profileEntries = buildProfileEntries ?? authenticated?.buildProfiles ?? [];
  reasons.push(...buildProfileEntrySetFindings(profileEntries));

  for (const familyName of FAMILY_NAMES) {
    const config = operations[familyName];
    const evidence = authenticated?.families?.[familyName];
    if (!validOperation(config) || !validAuthenticatedFamily(evidence)) {
      reasons.push(`${familyName} derivation inputs are unavailable`);
      families[familyName] = unavailableFamilySummary(familyName);
      continue;
    }
    try {
      if (familyName.startsWith('dev-') || familyName.startsWith('build-')) {
        const productFindings = [...evidence.baseline, evidence.holdout].flatMap((entry, index) =>
          packedComparisonProductEvidenceFindings(
            entry.report,
            `${index < evidence.baseline.length ? `baseline[${String(index)}]` : 'holdout'}`,
            { required: true },
          ),
        );
        if (productFindings.length > 0) {
          throw new TypeError(`packed product evidence is invalid: ${productFindings.join('; ')}`);
        }
      }
      const baseline = { ...ratify(evidence.baseline), generatedAt };
      if (baseline?.verdict?.status !== 'ratified') {
        throw new TypeError(
          `baseline is ${String(baseline?.verdict?.status)}: ${(baseline?.verdict?.reasons ?? []).join('; ')}`,
        );
      }
      const baselineFindings = config.baselineFindings(baseline, evidence.baseline);
      if (baselineFindings.length > 0) {
        throw new TypeError(`ratified baseline is invalid: ${baselineFindings.join('; ')}`);
      }
      const budget = config.derive(baseline, { baselineEntries: evidence.baseline });
      const budgetFindings = config.budgetFindings(budget);
      if (budgetFindings.length > 0) {
        throw new TypeError(`derived budget is invalid: ${budgetFindings.join('; ')}`);
      }
      const evaluation = config.evaluate(budget, evidence.holdout.report);
      const evaluationFindings = holdoutEvaluationIntegrityFindings(
        evaluation,
        budget,
        evidence.holdout.report,
      );
      if (evaluationFindings.length > 0) {
        throw new TypeError(`holdout evaluation is malformed: ${evaluationFindings.join('; ')}`);
      }
      const independentFindings = independentHoldoutFindings(
        baseline,
        evidence.holdout,
        sourceCommit,
      );
      if (independentFindings.length > 0) {
        throw new TypeError(independentFindings.join('; '));
      }
      const baselineAssessment = baselineTargetAssessment(familyName, budget);
      const holdoutAssessment = holdoutTargetAssessment(config, evaluation);
      const targetAssessment = combineTargetAssessments(baselineAssessment, holdoutAssessment);
      const targetFindings =
        targetAssessment.status === 'unproven'
          ? []
          : targetAssessmentFindings(targetAssessment, familyName);
      if (targetFindings.length > 0) {
        throw new TypeError(`target assessment is invalid: ${targetFindings.join('; ')}`);
      }
      const evaluationStatus = evaluation?.verdict?.status;
      const holdoutEvaluation = evaluationReference(evaluation, targetAssessment);
      const familyStatus =
        evaluationStatus === 'unproven' || targetAssessment.status === 'unproven'
          ? 'unproven'
          : holdoutEvaluation.blockingFailures.length === 0 &&
              ['pass', 'not-applicable'].includes(targetAssessment.blockingStatus)
            ? 'pass'
            : 'blocked';
      if (!['pass', 'regression', 'unproven'].includes(evaluationStatus)) {
        throw new TypeError('holdout evaluation verdict is malformed');
      }
      if (familyStatus === 'unproven') {
        reasons.push(
          ...evaluation.verdict.reasons.map((reason) => `${familyName} holdout ${reason}`),
        );
      }
      const familyDocuments = {
        baseline,
        budget,
        evaluation,
      };
      documents[familyName] = familyDocuments;
      families[familyName] = {
        architecture: FAMILY_CONFIG[familyName].architecture,
        comparisonPosture: FAMILY_CONFIG[familyName].comparisonPosture,
        documents: documentReferences(familyName, familyDocuments),
        evidence: {
          baseline: evidence.baseline.map((entry) => evidenceReference(entry)),
          holdout: evidenceReference(evidence.holdout),
        },
        host: baseline.identity.host,
        holdoutEvaluation,
        status: familyStatus,
        targetAssessment,
        workload: baseline.identity.workload,
      };
    } catch (error) {
      reasons.push(`${familyName} ${error instanceof Error ? error.message : String(error)}`);
      families[familyName] = unavailableFamilySummary(familyName);
    }
  }

  const productionBytes = deriveProductionBytesAssessment(
    authenticated?.productionBytes,
    sourceCommit,
    locks,
  );
  reasons.push(...productionBytes.reasons.map((reason) => `production bytes ${reason}`));

  let buildPersistenceAssessment;
  try {
    if (typeof assessBuildPersistence !== 'function') {
      throw new TypeError('build persistence assessor is unavailable');
    }
    buildPersistenceAssessment = assessBuildPersistence({
      n24Budget: documents['build-n24']?.budget,
      n216Budget: documents['build-n216']?.budget,
      profileEntries,
    });
    const assessmentInputs = {
      n24Budget: documents['build-n24']?.budget,
      n216Budget: documents['build-n216']?.budget,
      profileEntries,
    };
    const assessmentFindings = buildPersistenceAssessmentFindings(
      buildPersistenceAssessment,
      assessBuildPersistence === assessBuildForegroundSession ? assessmentInputs : undefined,
    );
    if (assessmentFindings.length > 0) {
      throw new TypeError(assessmentFindings.join('; '));
    }
    reasons.push(...buildPersistencePublicationReasons(buildPersistenceAssessment));
  } catch (error) {
    reasons.push(`build persistence ${error instanceof Error ? error.message : String(error)}`);
    buildPersistenceAssessment = assessBuildForegroundSession({});
    reasons.push(...buildPersistencePublicationReasons(buildPersistenceAssessment));
  }

  const uniqueReasons = [...new Set(reasons)].sort((left, right) => left.localeCompare(right));
  const failures = [
    ...blockingFailures(families),
    ...buildPersistenceBlockingFailures(buildPersistenceAssessment),
    ...productionBytes.failures.map((failure) => `production-bytes:${failure}`),
  ].sort((left, right) => left.localeCompare(right));
  const status =
    uniqueReasons.length > 0 ||
    productionBytes.status === 'unproven' ||
    FAMILY_NAMES.some((name) => families[name]?.status === 'unproven')
      ? 'unproven'
      : failures.length > 0 ||
          productionBytes.status !== 'pass' ||
          FAMILY_NAMES.some((name) => families[name]?.status !== 'pass')
        ? 'blocked'
        : 'publishable';
  const facts = {
    buildPersistenceAssessment,
    campaign: authenticated?.campaign ?? null,
    families,
    fixtureSources: fixtureSources(sourceCommit),
    generatedAt,
    identity: { locks, sourceCommit },
    productionBytes,
    repository: authenticated?.repository ?? null,
    schema: PERF_PUBLICATION_SCHEMA,
    verdict: { failures, reasons: uniqueReasons, status },
  };
  const publication = { ...facts, digest: sha256Canonical(facts) };
  return { documents, publication };
}

/**
 * Recompute the complete publication result from authenticated raw evidence. Unlike the aggregate
 * manifest's self-hash, this closes over the 21 retained baseline/budget/evaluation documents and
 * the family policy functions that produced them.
 */
export function performancePublicationResultFindings(
  result,
  {
    assessBuildPersistence = assessBuildForegroundSession,
    authenticated,
    buildProfileEntries,
    operations = FAMILY_CONFIG,
    ratify = ratifyPerformanceBaseline,
  } = {},
) {
  if (
    !ownRecord(result) ||
    canonicalJson(Object.keys(result).sort()) !== canonicalJson(['documents', 'publication'])
  ) {
    return ['publication result must contain only documents and publication'];
  }
  const publication = result.publication;
  const findings = [
    ...performancePublicationFindings(publication),
    ...authenticatedInputFindings(authenticated),
    ...exactPublicationIdentityFindings(familyEntries(authenticated)),
    ...browserPublicationTableFindings(result?.documents?.browser?.budget),
  ];
  const profileEntries = buildProfileEntries ?? authenticated?.buildProfiles ?? [];
  let reproduced;
  try {
    reproduced = derivePerformancePublication(authenticated, {
      assessBuildPersistence,
      buildProfileEntries: profileEntries,
      generatedAt: publication?.generatedAt,
      operations,
      ratify,
    });
  } catch (error) {
    findings.push(
      `publication reproduction failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (reproduced !== undefined) {
    for (const familyName of FAMILY_NAMES) {
      for (const kind of ['baseline', 'budget', 'evaluation']) {
        if (
          canonicalJson(result.documents?.[familyName]?.[kind]) !==
          canonicalJson(reproduced.documents?.[familyName]?.[kind])
        ) {
          findings.push(
            `${familyName} ${kind} document differs from authenticated raw-evidence reproduction`,
          );
        }
      }
      if (
        canonicalJson(publication?.families?.[familyName]) !==
        canonicalJson(reproduced.publication?.families?.[familyName])
      ) {
        findings.push(`${familyName} aggregate summary differs from exact reproduction`);
      }
    }
    if (
      canonicalJson(publication?.buildPersistenceAssessment) !==
      canonicalJson(reproduced.publication?.buildPersistenceAssessment)
    ) {
      findings.push(
        'build persistence assessment differs from its exact budgets and profile evidence',
      );
    }
    if (
      canonicalJson(publication?.productionBytes) !==
      canonicalJson(reproduced.publication?.productionBytes)
    ) {
      findings.push(
        'Production bytes assessment differs from authenticated report and committed budget reproduction',
      );
    }
    if (canonicalJson(publication) !== canonicalJson(reproduced.publication)) {
      findings.push('aggregate publication differs from authenticated raw-evidence reproduction');
    }
    if (canonicalJson(result.documents) !== canonicalJson(reproduced.documents)) {
      findings.push(
        'publication document set differs from authenticated raw-evidence reproduction',
      );
    }
    const documentCount = Object.values(reproduced.documents).reduce(
      (count, documents) => count + Object.keys(documents).length,
      0,
    );
    if (
      documentCount !== FAMILY_NAMES.length * 3 ||
      Object.keys(reproduced.documents).length !== FAMILY_NAMES.length
    ) {
      findings.push('publication does not retain the exact 21 derived documents');
    }
  }
  return [...new Set(findings)].sort();
}

function assertPerformancePublicationResult(result, validation) {
  const findings = performancePublicationResultFindings(result, validation);
  if (findings.length > 0) {
    throw new TypeError(`Performance publication result is invalid:\n${findings.join('\n')}`);
  }
}

export function performancePublicationFindings(publication) {
  if (!ownRecord(publication) || publication.schema !== PERF_PUBLICATION_SCHEMA) {
    return [`publication is not ${PERF_PUBLICATION_SCHEMA}`];
  }
  const findings = [];
  const { digest, ...facts } = publication;
  if (!DIGEST_PATTERN.test(digest ?? '') || digest !== sha256Canonical(facts)) {
    findings.push('publication digest is not derived from its facts');
  }
  if (publication.repository !== PERF_PUBLICATION_REPOSITORY) {
    findings.push('publication repository is not the canonical Kovo repository');
  }
  findings.push(...campaignPublicationFindings(publication.campaign, publication));
  if (!COMMIT_PATTERN.test(publication.identity?.sourceCommit ?? '')) {
    findings.push('publication source commit is unavailable');
  }
  for (const lock of REQUIRED_LOCKS) {
    if (!DIGEST_PATTERN.test(publication.identity?.locks?.[lock] ?? '')) {
      findings.push(`publication ${lock} identity is unavailable`);
    }
  }
  if (
    canonicalJson(publication.fixtureSources) !==
    canonicalJson(fixtureSources(publication.identity?.sourceCommit))
  ) {
    findings.push('publication fixture sources are not derived from its source commit');
  }
  if (
    canonicalJson(Object.keys(publication.families ?? {}).sort()) !==
    canonicalJson([...FAMILY_NAMES].sort())
  ) {
    findings.push('publication family census is incomplete');
  }
  findings.push(...productionBytesAssessmentFindings(publication.productionBytes, publication));
  findings.push(
    ...buildPersistenceAssessmentFindings(publication.buildPersistenceAssessment).map(
      (finding) => `build persistence ${finding}`,
    ),
  );
  const publishedBuildBudgetDigests = {
    n24: publication.families?.['build-n24']?.documents?.budget?.semanticDigest ?? null,
    n216: publication.families?.['build-n216']?.documents?.budget?.semanticDigest ?? null,
  };
  if (
    publication.buildPersistenceAssessment?.budgets?.n24 !== publishedBuildBudgetDigests.n24 ||
    publication.buildPersistenceAssessment?.budgets?.n216 !== publishedBuildBudgetDigests.n216
  ) {
    findings.push('build persistence assessment differs from its published build budgets');
  }
  const retainedEvidence = [];
  for (const familyName of FAMILY_NAMES) {
    const family = publication.families?.[familyName];
    if (!ownRecord(family) || !['pass', 'blocked', 'unproven'].includes(family.status)) {
      findings.push(`${familyName} status is unavailable`);
      continue;
    }
    if (
      family.architecture !== FAMILY_CONFIG[familyName].architecture ||
      family.comparisonPosture !== FAMILY_CONFIG[familyName].comparisonPosture
    ) {
      findings.push(`${familyName} architecture or comparison posture differs from policy`);
    }
    if (family.status !== 'unproven') {
      if (family.evidence?.baseline?.length !== 5 || !ownRecord(family.evidence?.holdout)) {
        findings.push(`${familyName} does not retain five baseline links and one holdout link`);
      }
      const familyEvidence = [
        ...(family.evidence?.baseline ?? []).map((entry) => ['baseline', entry]),
        ['holdout', family.evidence?.holdout],
      ];
      for (const [role, evidence] of familyEvidence) {
        findings.push(
          ...evidenceReferenceFindings(
            evidence,
            `${familyName} ${role}`,
            FAMILY_CONFIG[familyName],
            publication,
            family,
          ),
        );
      }
      retainedEvidence.push(...familyEvidence.map(([, evidence]) => evidence));
      const baselineRunUrls = family.evidence.baseline.map((entry) => entry.runUrl);
      if (new Set(baselineRunUrls).size !== 5) {
        findings.push(`${familyName} baseline workflow runs are not distinct`);
      }
      if (baselineRunUrls.includes(family.evidence.holdout.runUrl)) {
        findings.push(`${familyName} holdout reuses a baseline workflow run`);
      }
      findings.push(...targetAssessmentFindings(family.targetAssessment, familyName));
      findings.push(
        ...evaluationReferenceFindings(
          family.holdoutEvaluation,
          familyName,
          family.targetAssessment,
        ),
      );
      if (
        family.holdoutEvaluation?.candidate?.execution !== family.evidence.holdout.execution ||
        family.holdoutEvaluation?.candidate?.sourceCommit !== family.evidence.holdout.sourceCommit
      ) {
        findings.push(`${familyName} holdout evaluation candidate differs from its evidence`);
      }
      const expectedFamilyStatus =
        family.holdoutEvaluation?.status === 'unproven' ||
        family.targetAssessment?.status === 'unproven'
          ? 'unproven'
          : family.holdoutEvaluation?.blockingFailures?.length === 0 &&
              ['pass', 'not-applicable'].includes(family.targetAssessment?.blockingStatus)
            ? 'pass'
            : 'blocked';
      if (family.status !== expectedFamilyStatus) {
        findings.push(`${familyName} status is not derived from its holdout and targets`);
      }
      for (const kind of ['baseline', 'budget', 'evaluation']) {
        if (!validDocumentReference(family.documents?.[kind], familyName, kind)) {
          findings.push(`${familyName} ${kind} document reference is malformed`);
        }
      }
    }
  }
  if (retainedEvidence.length > 0) {
    for (const [label, select] of [
      ['artifact API URL', (entry) => entry?.apiUrl],
      ['artifact archive digest', (entry) => entry?.archiveDigest],
      ['artifact identity', (entry) => entry?.artifactId],
      ['artifact location', (entry) => entry?.location],
      ['execution identity', (entry) => entry?.execution],
      ['report content digest', (entry) => entry?.reportContentDigest],
    ]) {
      if (new Set(retainedEvidence.map(select)).size !== retainedEvidence.length) {
        findings.push(`publication has duplicate ${String(label)}`);
      }
    }
  }
  if (!['publishable', 'blocked', 'unproven'].includes(publication.verdict?.status)) {
    findings.push('publication verdict is unavailable');
  }
  const verdictReasons = publication.verdict?.reasons;
  if (
    !Array.isArray(verdictReasons) ||
    verdictReasons.some((reason) => !nonEmptyString(reason)) ||
    canonicalJson(verdictReasons) !== canonicalJson(sortedUniqueStrings(verdictReasons ?? []))
  ) {
    findings.push('publication verdict reasons are malformed');
  }
  const requiredPersistenceReasons = buildPersistencePublicationReasons(
    publication.buildPersistenceAssessment,
  );
  if (
    requiredPersistenceReasons.some(
      (reason) => !Array.isArray(verdictReasons) || !verdictReasons.includes(reason),
    )
  ) {
    findings.push('publication verdict does not retain the unproven build persistence findings');
  }
  const requiredProductionBytesReasons = (publication.productionBytes?.reasons ?? []).map(
    (reason) => `production bytes ${String(reason)}`,
  );
  if (
    requiredProductionBytesReasons.some(
      (reason) => !Array.isArray(verdictReasons) || !verdictReasons.includes(reason),
    )
  ) {
    findings.push('publication verdict does not retain the unproven Production bytes findings');
  }
  const expectedFailures = [
    ...blockingFailures(publication.families ?? {}),
    ...buildPersistenceBlockingFailures(publication.buildPersistenceAssessment),
    ...(publication.productionBytes?.failures ?? []).map(
      (failure) => `production-bytes:${String(failure)}`,
    ),
  ].sort((left, right) => left.localeCompare(right));
  if (canonicalJson(publication.verdict?.failures) !== canonicalJson(expectedFailures)) {
    findings.push(
      'publication blocking failures are not derived from its families and build persistence decision',
    );
  }
  const expectedStatus =
    (verdictReasons?.length ?? 0) > 0 ||
    publication.productionBytes?.status === 'unproven' ||
    publication.buildPersistenceAssessment?.verdict?.status === 'unproven' ||
    FAMILY_NAMES.some((name) => publication.families?.[name]?.status === 'unproven')
      ? 'unproven'
      : expectedFailures.length > 0 ||
          publication.productionBytes?.status !== 'pass' ||
          FAMILY_NAMES.some((name) => publication.families?.[name]?.status !== 'pass')
        ? 'blocked'
        : 'publishable';
  if (publication.verdict?.status !== expectedStatus) {
    findings.push('publication verdict is not derived from its family and sidecar census');
  }
  return [...new Set(findings)].sort();
}

export function renderPerformancePublicationMarkdown(result, validation = {}) {
  assertPerformancePublicationResult(result, validation);
  const publication = result.publication;
  const lines = [
    '# Kovo realistic performance publication gate',
    '',
    `Verdict: **${publication.verdict.status}**. Source: \`${publication.identity.sourceCommit}\`.`,
    '',
    'A Kovo-vs-Next first-milestone publication is eligible only when all seven family gates pass. The check row is deliberately Kovo-only and does not manufacture a Next.js comparison. Competitive follow-on misses remain reported as failures, but do not masquerade as completion failures or block this first-milestone gate.',
    '',
    '| Family | Posture | Host | Workload | Baseline completion | Baseline follow-on | Holdout completion | Holdout follow-on | Publication gate |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const familyName of FAMILY_NAMES) {
    const family = publication.families[familyName];
    lines.push(
      `| ${familyName} | ${family.comparisonPosture} | ${code(family.host)} | ${code(family.workload)} | ${family.targetAssessment?.baseline?.blockingStatus ?? 'unproven'} | ${family.targetAssessment?.baseline?.followOnStatus ?? 'unproven'} | ${family.targetAssessment?.holdout?.blockingStatus ?? 'unproven'} | ${family.targetAssessment?.holdout?.followOnStatus ?? 'unproven'} | ${family.status} |`,
    );
  }
  const productionBytes = publication.productionBytes;
  lines.push(
    '',
    '## Production bytes sidecar',
    '',
    `Outcome: **${productionBytes.status}** at componentCount=${String(productionBytes.componentCount)}.`,
  );
  if (productionBytes.budget !== null) {
    lines.push(
      '',
      `Committed budget: \`${productionBytes.budget.path}\` (${String(productionBytes.budget.byteLength)} bytes, \`${productionBytes.budget.contentDigest}\`).`,
    );
  }
  if (productionBytes.evidence?.location) {
    lines.push(
      '',
      `[Authenticated Production bytes artifact ${productionBytes.evidence.artifactId}](${productionBytes.evidence.location})`,
    );
  }
  if (productionBytes.metricVerdicts.length > 0) {
    lines.push('', '| Metric | Observed | Maximum | Verdict |', '| --- | ---: | ---: | --- |');
    for (const metric of productionBytes.metricVerdicts) {
      lines.push(
        `| ${metric.metricId} | ${formatNumber(metric.value)} | ${formatNumber(metric.budget)} | ${metric.status} |`,
      );
    }
  }
  const persistence = publication.buildPersistenceAssessment;
  lines.push(
    '',
    '## Foreground build-session decision',
    '',
    `Outcome: **${persistence.verdict.outcome}** (${persistence.verdict.rationale}).`,
    '',
    '| Corpus | Mode | Wall ratio | RSS ratio | Kovo p95 (ms) | Artifact p95 (bytes) | Upper / wall | Milestone |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |',
  );
  for (const cell of persistence.cells) {
    lines.push(
      `| N=${String(cell.corpusSize)} | ${cell.mode} | ${formatNumber(cell.milestone.wallMedianVsNextRatio)} | ${formatNumber(cell.milestone.peakRssMedianVsNextRatio)} | ${formatNumber(cell.wall.kovoP95Ms)} | ${formatNumber(cell.artifactBytes.kovoP95)} | ${formatNumber(cell.residualUpper.medianRatio)} | ${cell.milestone.status} |`,
    );
  }
  if (persistence.verdict.findings.length > 0) {
    lines.push('', 'Decision findings:', '');
    for (const finding of persistence.verdict.findings) lines.push(`- ${finding}`);
  }
  if (persistence.profiles.length > 0) {
    lines.push('', 'Authenticated N=216 CPU profiles:', '');
    for (const profile of persistence.profiles) {
      lines.push(`- [${profile.mode} ${profile.execution}](${profile.location})`);
    }
  }
  lines.push('', '## Exact fixture sources', '');
  for (const [label, url] of Object.entries(publication.fixtureSources)) {
    lines.push(`- [${label}](${url})`);
  }
  lines.push(...renderBrowserComparisonMarkdownLines(result));
  for (const familyName of FAMILY_NAMES) {
    if (familyName === 'browser') continue;
    const family = publication.families[familyName];
    lines.push('', `## ${familyName}`, '', family.architecture, '');
    if (family.status === 'unproven') {
      lines.push('Evidence is unproven; no claim may be published.');
      continue;
    }
    lines.push(
      `Completion floor: baseline **${family.targetAssessment.baseline.blockingStatus}**, holdout **${family.targetAssessment.holdout.blockingStatus}**. Reported follow-on targets: baseline **${family.targetAssessment.baseline.followOnStatus}**, holdout **${family.targetAssessment.holdout.followOnStatus}**.`,
      '',
      'Target assessment (a follow-on miss remains `fail`; its role is reported separately):',
      '',
    );
    for (const phase of ['baseline', 'holdout']) {
      for (const check of family.targetAssessment[phase].checks) {
        lines.push(
          `- ${phase} [${check.publicationImpact}] ${check.id}: ${formatNumber(check.observed)} ${check.operator} ${formatNumber(check.limit)} — ${check.status}`,
        );
      }
    }
    lines.push('', 'Raw evidence:', '');
    for (const evidence of family.evidence.baseline) {
      lines.push(`- [baseline ${evidence.execution}](${evidence.location})`);
    }
    lines.push(
      `- [independent holdout ${family.evidence.holdout.execution}](${family.evidence.holdout.location})`,
    );
  }
  if (publication.verdict.reasons.length > 0) {
    lines.push('', '## Unproven findings', '');
    for (const reason of publication.verdict.reasons) lines.push(`- ${reason}`);
  }
  if (publication.verdict.failures.length > 0) {
    lines.push('', '## Blocking failures', '');
    for (const failure of publication.verdict.failures) lines.push(`- ${failure}`);
  }
  const followOnFailures = FAMILY_NAMES.flatMap((familyName) =>
    (publication.families[familyName]?.targetAssessment?.followOnFailures ?? []).map(
      (failure) => `${familyName}:${failure}`,
    ),
  ).sort((left, right) => left.localeCompare(right));
  if (followOnFailures.length > 0) {
    lines.push('', '## Reported follow-on misses (non-blocking)', '');
    for (const failure of followOnFailures) lines.push(`- ${failure}`);
  }
  lines.push('');
  return lines.join('\n');
}

function browserPublicationTableFindings(budget) {
  if (!ownRecord(budget?.metrics) || Object.keys(budget.metrics).length === 0) {
    return ['browser budget table metrics are unavailable'];
  }
  const findings = [];
  const laneCounts = new Map(['default', 'matched-l0', 'matched-l1'].map((lane) => [lane, 0]));
  for (const [metric, entry] of Object.entries(budget.metrics)) {
    const lane = /^(default|matched-l0|matched-l1)\/browser\/\//u.exec(metric)?.[1];
    if (lane === undefined) {
      findings.push(`browser budget metric ${metric} does not belong to exactly one browser lane`);
    } else {
      laneCounts.set(lane, laneCounts.get(lane) + 1);
    }
    if (
      !ownRecord(entry?.baseline) ||
      !['kovoMedian', 'kovoP95', 'nextMedian', 'nextP95'].every((field) =>
        Number.isFinite(entry.baseline[field]),
      )
    ) {
      findings.push(`browser budget metric ${metric} absolute baseline values are unavailable`);
    }
    if (!nonEmptyString(browserBudgetPolicy(entry))) {
      findings.push(`browser budget metric ${metric} policy is unavailable`);
    }
  }
  for (const [lane, count] of laneCounts) {
    if (count === 0) findings.push(`browser budget table lane ${lane} has no metrics`);
  }
  return [...new Set(findings)].sort((left, right) => left.localeCompare(right));
}

function renderBrowserComparisonMarkdownLines(result) {
  const publication = result.publication;
  const family = publication.families.browser;
  const budget = result.documents.browser.budget;
  const lines = [
    '',
    '## Browser comparison: explicit lanes',
    '',
    family.architecture,
    '',
    'Each median is the median of five independent run medians. Each p95 is the median of the five within-run p95 values. The sixth run is the independent holdout and is not pooled into either baseline statistic.',
    '',
    'The default/as-shipped lane is intentionally capability-mismatched: Kovo uses its native L0 cart while Next uses a hydrated mutable cart. Zero JavaScript applies only to Kovo L0; Next matched L0 still ships JavaScript. Matched L1 equalizes cart capability, but Kovo uses an observed document-parts response and preserves the document while Next uses an observed `text/html` document navigation and replaces it. `responseProcessingDomApply` overlaps transfer, parser, style, and layout; it is not additive and is not a decode or morph split.',
    '',
    'Authenticated derivation inputs:',
    '',
    '- [Derived browser budget](evidence/browser-budget.json)',
    `- [Measured source](https://github.com/${PERF_PUBLICATION_REPOSITORY}/tree/${publication.identity.sourceCommit})`,
  ];
  for (const [label, url] of Object.entries(publication.fixtureSources)) {
    lines.push(`- [${label}](${url})`);
  }
  for (const [index, evidence] of family.evidence.baseline.entries()) {
    lines.push(`- [baseline ${String(index + 1)}: ${evidence.execution}](${evidence.location})`);
  }
  lines.push(
    `- [independent holdout: ${family.evidence.holdout.execution}](${family.evidence.holdout.location})`,
  );
  const laneTitles = {
    default: 'Default/as shipped',
    'matched-l0': 'Matched L0',
    'matched-l1': 'Matched L1',
  };
  for (const lane of ['default', 'matched-l0', 'matched-l1']) {
    const rows = Object.entries(budget.metrics)
      .filter(([metric]) => metric.startsWith(`${lane}/browser//`))
      .sort(([left], [right]) => left.localeCompare(right));
    lines.push(
      '',
      `### ${laneTitles[lane]}`,
      '',
      '| Metric | Kovo median | Kovo p95 | Next median | Next p95 | Budget policy |',
      '| --- | ---: | ---: | ---: | ---: | --- |',
    );
    for (const [metric, entry] of rows) {
      lines.push(
        `| ${metric.replaceAll('|', '\\|')} | ${formatNumber(entry.baseline.kovoMedian)} | ${formatNumber(entry.baseline.kovoP95)} | ${formatNumber(entry.baseline.nextMedian)} | ${formatNumber(entry.baseline.nextP95)} | ${browserBudgetPolicy(entry)} |`,
      );
    }
  }
  lines.push(
    '',
    `Browser completion floor: baseline **${family.targetAssessment.baseline.blockingStatus}**, holdout **${family.targetAssessment.holdout.blockingStatus}**. Reported follow-on targets: baseline **${family.targetAssessment.baseline.followOnStatus}**, holdout **${family.targetAssessment.holdout.followOnStatus}**.`,
    '',
    'Browser target assessment (a follow-on miss remains `fail`; its role is reported separately):',
    '',
  );
  for (const phase of ['baseline', 'holdout']) {
    for (const check of family.targetAssessment[phase].checks) {
      lines.push(
        `- ${phase} [${check.publicationImpact}] ${check.id}: ${formatNumber(check.observed)} ${check.operator} ${formatNumber(check.limit)} — ${check.status}`,
      );
    }
  }
  return lines;
}

function browserBudgetPolicy(entry) {
  if (entry?.kind === 'informational') return 'informational';
  if (entry?.kind === 'exact-availability-floor' && Number.isFinite(entry.minimum)) {
    return `minimum ${formatNumber(entry.minimum)}`;
  }
  if (
    entry?.kind === 'ratified-regression-ceiling' &&
    Number.isFinite(entry.medianMaximum) &&
    Number.isFinite(entry.p95Maximum)
  ) {
    return `median <= ${formatNumber(entry.medianMaximum)}; p95 <= ${formatNumber(entry.p95Maximum)}`;
  }
  if (
    entry?.kind === 'ratified-regression-floor' &&
    Number.isFinite(entry.medianMinimum) &&
    Number.isFinite(entry.p95Minimum)
  ) {
    return `median >= ${formatNumber(entry.medianMinimum)}; p95 >= ${formatNumber(entry.p95Minimum)}`;
  }
  return '';
}

export async function writePerformancePublicationOutputs(
  result,
  {
    assessBuildPersistence,
    authenticated,
    buildProfileEntries,
    evidenceDirectory,
    markdownOut,
    operations,
    out,
    ratify,
  },
) {
  for (const [label, value] of [
    ['evidenceDirectory', evidenceDirectory],
    ['markdownOut', markdownOut],
    ['out', out],
  ]) {
    if (!nonEmptyString(value)) throw new TypeError(`${label} is required`);
  }
  const validation = {
    assessBuildPersistence,
    authenticated,
    buildProfileEntries,
    operations,
    ratify,
  };
  assertPerformancePublicationResult(result, validation);
  const markdown = renderPerformancePublicationMarkdown(result, validation);
  const layout = await performancePublicationOutputLayout({ evidenceDirectory, markdownOut, out });
  await prepareEmptyPerformancePublicationRoot(layout);
  for (const familyName of FAMILY_NAMES) {
    for (const kind of ['baseline', 'budget', 'evaluation']) {
      const document = result.documents[familyName][kind];
      await writeFile(
        path.join(layout.evidenceDirectory, `${familyName}-${kind}.json`),
        prettyJson(document),
        { flag: 'wx' },
      );
    }
  }
  await writeFile(layout.out, prettyJson(result.publication), { flag: 'wx' });
  await writeFile(layout.markdownOut, markdown, { flag: 'wx' });
  await validateWrittenPerformancePublicationOutputs(result, {
    ...layout,
    validation,
  });
}

async function validateWrittenPerformancePublicationOutputs(
  expected,
  { evidenceDirectory, markdownOut, out, root, validation },
) {
  await assertExactPerformancePublicationInventory(root);
  const publicationBytes = await readFile(out);
  if (!publicationBytes.equals(Buffer.from(prettyJson(expected.publication)))) {
    throw new TypeError('written publication JSON differs from the validated in-memory result');
  }
  const publication = parseOutputJson(publicationBytes, 'written publication JSON');
  const documents = {};
  for (const familyName of FAMILY_NAMES) {
    documents[familyName] = {};
    for (const kind of ['baseline', 'budget', 'evaluation']) {
      const file = path.join(evidenceDirectory, `${familyName}-${kind}.json`);
      const bytes = await readFile(file);
      const reference = publication.families?.[familyName]?.documents?.[kind];
      if (sha256Bytes(bytes) !== reference?.contentDigest) {
        throw new TypeError(`written ${familyName} ${kind} bytes differ from its content digest`);
      }
      const document = parseOutputJson(bytes, `written ${familyName} ${kind} document`);
      if (!bytes.equals(Buffer.from(prettyJson(document)))) {
        throw new TypeError(`written ${familyName} ${kind} document is not canonical JSON`);
      }
      documents[familyName][kind] = document;
    }
  }
  const readBack = { documents, publication };
  assertPerformancePublicationResult(readBack, validation);
  const markdownBytes = await readFile(markdownOut);
  if (
    !markdownBytes.equals(Buffer.from(renderPerformancePublicationMarkdown(readBack, validation)))
  ) {
    throw new TypeError('written publication Markdown differs from the validated complete result');
  }
  await assertExactPerformancePublicationInventory(root);
}

function performanceEvidenceMemberNames() {
  return FAMILY_NAMES.flatMap((familyName) =>
    ['baseline', 'budget', 'evaluation'].map((kind) => `${familyName}-${kind}.json`),
  ).sort((left, right) => left.localeCompare(right));
}

async function performancePublicationOutputLayout({ evidenceDirectory, markdownOut, out }) {
  const supplied = { evidenceDirectory, markdownOut, out };
  for (const [label, value] of Object.entries(supplied)) {
    if (!path.isAbsolute(value) || value !== path.resolve(value)) {
      throw new TypeError(`${label} must be one canonical absolute path without layout aliases`);
    }
  }
  const root = path.dirname(out);
  const expected = {
    evidenceDirectory: path.join(root, PERF_PUBLICATION_EVIDENCE_DIRECTORY_NAME),
    markdownOut: path.join(root, PERF_PUBLICATION_MARKDOWN_NAME),
    out: path.join(root, PERF_PUBLICATION_JSON_NAME),
  };
  if (
    evidenceDirectory !== expected.evidenceDirectory ||
    markdownOut !== expected.markdownOut ||
    out !== expected.out ||
    new Set(Object.values(expected)).size !== 3
  ) {
    throw new TypeError(
      'performance publication outputs must use publication/{performance-publication.json,performance-publication.md,evidence/*.json}',
    );
  }
  await assertCanonicalExistingPublicationPath(
    path.dirname(root),
    'performance publication output parent',
  );
  return { ...expected, root };
}

async function prepareEmptyPerformancePublicationRoot(layout) {
  let rootStat;
  try {
    rootStat = await lstat(layout.root);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const parent = await lstat(path.dirname(layout.root));
    if (!parent.isDirectory() || parent.isSymbolicLink()) {
      throw new TypeError('performance publication output parent must be one real directory');
    }
    await mkdir(layout.root);
    rootStat = await lstat(layout.root);
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new TypeError('performance publication output root must be one real directory');
  }
  await assertCanonicalExistingPublicationPath(layout.root, 'performance publication output root');
  const existing = await readdir(layout.root);
  if (existing.length !== 0) {
    throw new TypeError(
      'performance publication output root must be absent or empty; partial or extra inventory is rejected',
    );
  }
  await mkdir(layout.evidenceDirectory);
}

async function assertExactPerformancePublicationInventory(root) {
  const expectedRootMembers = [
    PERF_PUBLICATION_EVIDENCE_DIRECTORY_NAME,
    PERF_PUBLICATION_JSON_NAME,
    PERF_PUBLICATION_MARKDOWN_NAME,
  ].sort((left, right) => left.localeCompare(right));
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new TypeError('written performance publication root is not one real directory');
  }
  await assertCanonicalExistingPublicationPath(root, 'written performance publication root');
  const rootMembers = (await readdir(root)).sort((left, right) => left.localeCompare(right));
  if (canonicalJson(rootMembers) !== canonicalJson(expectedRootMembers)) {
    throw new TypeError('written performance publication root is not the exact 23-file layout');
  }
  for (const name of [PERF_PUBLICATION_JSON_NAME, PERF_PUBLICATION_MARKDOWN_NAME]) {
    const member = await lstat(path.join(root, name));
    if (!member.isFile() || member.isSymbolicLink()) {
      throw new TypeError(`written performance publication ${name} is not one regular file`);
    }
    await assertCanonicalExistingPublicationPath(
      path.join(root, name),
      `written performance publication ${name}`,
    );
  }
  const evidenceDirectory = path.join(root, PERF_PUBLICATION_EVIDENCE_DIRECTORY_NAME);
  const evidenceStat = await lstat(evidenceDirectory);
  if (!evidenceStat.isDirectory() || evidenceStat.isSymbolicLink()) {
    throw new TypeError('written performance evidence member is not one real directory');
  }
  await assertCanonicalExistingPublicationPath(
    evidenceDirectory,
    'written performance evidence directory',
  );
  const expectedEvidence = performanceEvidenceMemberNames();
  const evidenceMembers = (await readdir(evidenceDirectory)).sort((left, right) =>
    left.localeCompare(right),
  );
  if (canonicalJson(evidenceMembers) !== canonicalJson(expectedEvidence)) {
    throw new TypeError('written performance evidence directory is not the exact 21-file census');
  }
  for (const name of evidenceMembers) {
    const member = await lstat(path.join(evidenceDirectory, name));
    if (!member.isFile() || member.isSymbolicLink()) {
      throw new TypeError(`written performance evidence ${name} is not one regular file`);
    }
    await assertCanonicalExistingPublicationPath(
      path.join(evidenceDirectory, name),
      `written performance evidence ${name}`,
    );
  }
}

async function assertCanonicalExistingPublicationPath(value, label) {
  const member = await lstat(value);
  if (member.isSymbolicLink()) throw new TypeError(`${label} must not be a symlink`);
  const resolved = await realpath(value);
  if (resolved !== value) {
    throw new TypeError(`${label} has a symlink ancestor or realpath alias`);
  }
}

function baselineTargetAssessment(familyName, budget) {
  if (familyName === 'browser' || familyName === 'server') {
    return normalizeTargetAssessment(budget.targetAssessment);
  }
  if (familyName.startsWith('dev-')) return devBaselineTargetAssessment(budget);
  if (familyName.startsWith('build-')) return buildBaselineTargetAssessment(budget);
  return checkBaselineTargetAssessment(budget);
}

function devBaselineTargetAssessment(budget) {
  const size = budget.subject?.corpusSize;
  const prefix = `corpus-n${String(size)}/dev//`;
  const targets = budget.policy?.targets;
  const checks = DEV_PERFORMANCE_METRICS.flatMap((suffix) => {
    const metric = `${prefix}${suffix}`;
    const entry = budget.metrics?.[metric];
    return [
      upperTargetCheck(
        `${metric}.median`,
        entry?.baseline?.median,
        entry?.medianMaximum,
        'regression',
      ),
      upperTargetCheck(`${metric}.p95`, entry?.baseline?.p95, entry?.p95Maximum, 'regression'),
    ];
  });
  checks.push(
    ratioBudgetCheck(
      `${prefix}ready.durationMs.median-vs-next`,
      budget.metrics?.[`${prefix}ready.durationMs`]?.baseline,
      targets?.readyMedianVsNextMaximumRatio,
      'competitive-target',
    ),
    ratioBudgetCheck(
      `${prefix}edit.leafMs.median-vs-next`,
      budget.metrics?.[`${prefix}edit.leafMs`]?.baseline,
      targets?.leafMedianVsNextMaximumRatio,
      'competitive-target',
    ),
    ratioBudgetCheck(
      `${prefix}edit.entryMs.median-vs-next`,
      budget.metrics?.[`${prefix}edit.entryMs`]?.baseline,
      targets?.entryMedianVsNextMaximumRatio,
      'competitive-target',
    ),
    upperTargetCheck(
      `${prefix}edit.syntaxErrorMs.p95-target`,
      budget.metrics?.[`${prefix}edit.syntaxErrorMs`]?.baseline?.p95,
      targets?.syntaxErrorP95MaximumMs,
      'target',
    ),
    upperTargetCheck(
      `${prefix}edit.recoveryMs.p95-target`,
      budget.metrics?.[`${prefix}edit.recoveryMs`]?.baseline?.p95,
      targets?.recoveryP95MaximumMs,
      'target',
    ),
  );
  return assessmentFromChecks(checks);
}

function buildBaselineTargetAssessment(budget) {
  const size = budget.subject?.corpusSize;
  const targets = budget.policy?.targets;
  const checks = [];
  for (const mode of BUILD_MODES) {
    const prefix = `corpus-n${String(size)}/build/${mode}/`;
    checks.push(
      ratioBudgetCheck(
        `${prefix}durationMs.median-vs-next`,
        budget.metrics?.[`${prefix}durationMs`]?.baseline,
        targets?.wallMedianVsNextMaximumRatio,
        'milestone',
      ),
      ratioBudgetCheck(
        `${prefix}peakRssBytes.median-vs-next`,
        budget.metrics?.[`${prefix}peakRssBytes`]?.baseline,
        targets?.peakRssMedianVsNextMaximumRatio,
        'milestone',
      ),
    );
  }
  return assessmentFromChecks(checks);
}

function checkBaselineTargetAssessment(budget) {
  const checks = Object.entries(budget.metrics ?? {}).map(([metric, entry]) =>
    upperTargetCheck(
      `${metric}.ratified-p95-target`,
      entry?.baseline?.p95,
      entry?.targetMaximum,
      'target',
    ),
  );
  return assessmentFromChecks(checks);
}

function holdoutTargetAssessment(config, evaluation) {
  if (evaluation?.verdict?.status === 'unproven') {
    return {
      blockingFailures: [],
      blockingStatus: 'unproven',
      checks: [],
      failures: [],
      followOnFailures: [],
      followOnStatus: 'unproven',
      reasons: sortedUniqueStrings(evaluation?.verdict?.reasons ?? []),
      status: 'unproven',
    };
  }
  const checks = (evaluation?.checks ?? [])
    .filter((check) => config.targetKinds.includes(check?.kind))
    .map((check) => ({
      id: check.id,
      kind: check.kind,
      limit: check.limit,
      observed: check.observed ?? check.value ?? null,
      operator: targetOperator(check.id),
      status: check.status,
    }));
  if (checks.length === 0) throw new TypeError('holdout target assessment is empty');
  return assessmentFromChecks(checks);
}

function normalizeTargetAssessment(value) {
  if (!ownRecord(value) || !Array.isArray(value.checks)) {
    throw new TypeError('baseline target assessment is unavailable');
  }
  const normalized = assessmentFromChecks(
    value.checks.map((check) => ({
      id: check.id,
      kind: check.kind,
      limit: check.limit,
      observed: check.observed,
      operator: check.operator,
      status: check.status,
    })),
  );
  if (
    canonicalJson(value.checks) !== canonicalJson(normalized.checks) ||
    canonicalJson(value.failures) !== canonicalJson(normalized.failures) ||
    value.status !== normalized.status
  ) {
    throw new TypeError('baseline target assessment is not derived from its checks');
  }
  return normalized;
}

function combineTargetAssessments(baseline, holdout) {
  const failures = [
    ...baseline.failures.map((failure) => `baseline:${failure}`),
    ...holdout.failures.map((failure) => `holdout:${failure}`),
  ];
  const blockingFailures = [
    ...baseline.blockingFailures.map((failure) => `baseline:${failure}`),
    ...holdout.blockingFailures.map((failure) => `holdout:${failure}`),
  ];
  const followOnFailures = [
    ...baseline.followOnFailures.map((failure) => `baseline:${failure}`),
    ...holdout.followOnFailures.map((failure) => `holdout:${failure}`),
  ];
  const reasons = holdout.reasons ?? [];
  return {
    baseline,
    blockingFailures,
    blockingStatus: combineAssessmentCategoryStatus(
      baseline.blockingStatus,
      holdout.blockingStatus,
    ),
    failures,
    followOnFailures,
    followOnStatus: combineAssessmentCategoryStatus(
      baseline.followOnStatus,
      holdout.followOnStatus,
    ),
    holdout,
    reasons,
    status:
      baseline.status === 'pass' && holdout.status === 'pass'
        ? 'pass'
        : baseline.status === 'unproven' || holdout.status === 'unproven'
          ? 'unproven'
          : 'fail',
  };
}

function assessmentFromChecks(checks) {
  if (!Array.isArray(checks) || checks.length === 0) {
    throw new TypeError('target assessment has no checks');
  }
  const classifiedChecks = checks.map((check) => ({
    ...check,
    publicationImpact: targetPublicationImpact(check?.kind),
  }));
  for (const check of classifiedChecks) {
    if (
      !nonEmptyString(check?.id) ||
      !nonEmptyString(check?.kind) ||
      !['<=', '>='].includes(check?.operator) ||
      !Number.isFinite(check?.limit) ||
      !['pass', 'fail'].includes(check?.status) ||
      (check.status === 'pass' && !Number.isFinite(check?.observed)) ||
      (Number.isFinite(check?.observed) &&
        check.status !==
          (check.operator === '<='
            ? check.observed <= check.limit
              ? 'pass'
              : 'fail'
            : check.observed >= check.limit
              ? 'pass'
              : 'fail'))
    ) {
      throw new TypeError(`target check ${String(check?.id)} is malformed`);
    }
  }
  const failures = classifiedChecks
    .filter((check) => check.status === 'fail')
    .map((check) => check.id);
  const blockingFailures = classifiedChecks
    .filter((check) => check.status === 'fail' && check.publicationImpact === 'completion')
    .map((check) => check.id);
  const followOnFailures = classifiedChecks
    .filter((check) => check.status === 'fail' && check.publicationImpact === 'follow-on')
    .map((check) => check.id);
  const blockingCheckCount = classifiedChecks.filter(
    (check) => check.publicationImpact === 'completion',
  ).length;
  const followOnCheckCount = classifiedChecks.length - blockingCheckCount;
  return {
    blockingFailures,
    blockingStatus:
      blockingCheckCount === 0 ? 'not-applicable' : blockingFailures.length === 0 ? 'pass' : 'fail',
    checks: classifiedChecks,
    failures,
    followOnFailures,
    followOnStatus:
      followOnCheckCount === 0 ? 'not-applicable' : followOnFailures.length === 0 ? 'pass' : 'fail',
    status: failures.length === 0 ? 'pass' : 'fail',
  };
}

function combineAssessmentCategoryStatus(left, right) {
  if (left === 'unproven' || right === 'unproven') return 'unproven';
  if (left === 'fail' || right === 'fail') return 'fail';
  if (left === 'not-applicable' && right === 'not-applicable') return 'not-applicable';
  return 'pass';
}

function targetPublicationImpact(kind) {
  return kind === 'competitive-target' ? 'follow-on' : 'completion';
}

function ratioBudgetCheck(id, evidence, limit, kind) {
  const observed =
    Number.isFinite(evidence?.median) &&
    Number.isFinite(evidence?.nextMedian) &&
    evidence.nextMedian > 0
      ? evidence.median / evidence.nextMedian
      : null;
  return upperTargetCheck(id, observed, limit, kind);
}

function upperTargetCheck(id, observed, limit, kind) {
  return {
    id,
    kind,
    limit,
    observed,
    operator: '<=',
    status:
      Number.isFinite(observed) && Number.isFinite(limit) && observed <= limit ? 'pass' : 'fail',
  };
}

function targetOperator(id) {
  return id.includes('/requestsPerSecond.') ? '>=' : '<=';
}

function holdoutEvaluationIntegrityFindings(evaluation, budget, candidate) {
  if (!ownRecord(evaluation)) return ['holdout evaluation is unavailable'];
  const findings = [];
  if (evaluation.budget !== budget?.digest) {
    findings.push('holdout evaluation budget identity differs');
  }
  if (
    evaluation.candidate?.execution !== candidate?.execution?.digest ||
    evaluation.candidate?.sourceCommit !== candidate?.source?.commit
  ) {
    findings.push('holdout evaluation candidate identity differs');
  }
  const checks = Array.isArray(evaluation.checks) ? evaluation.checks : [];
  if (!Array.isArray(evaluation.checks)) {
    findings.push('holdout evaluation check census is unavailable');
  } else if (checks.length === 0 && evaluation.verdict?.status !== 'unproven') {
    findings.push('proved holdout evaluation check census is empty');
  }
  const checkIds = checks.map((check) => check?.id);
  if (checkIds.some((id) => !nonEmptyString(id))) {
    findings.push('holdout evaluation check identity is malformed');
  }
  if (new Set(checkIds).size !== checkIds.length) {
    findings.push('holdout evaluation check identities are duplicated');
  }
  if (
    checks.some(
      (check) =>
        !ownRecord(check) ||
        !nonEmptyString(check.kind) ||
        !Number.isFinite(check.limit) ||
        !['pass', 'fail'].includes(check.status) ||
        !Number.isFinite(check.observed ?? check.value),
    )
  ) {
    findings.push('holdout evaluation check is malformed');
  }
  const failures = evaluation.verdict?.failures;
  const reasons = evaluation.verdict?.reasons;
  if (
    !Array.isArray(failures) ||
    failures.some((failure) => !nonEmptyString(failure)) ||
    new Set(failures).size !== failures.length
  ) {
    findings.push('holdout evaluation failures are malformed or duplicated');
  }
  if (
    !Array.isArray(reasons) ||
    reasons.some((reason) => !nonEmptyString(reason)) ||
    new Set(reasons).size !== reasons.length
  ) {
    findings.push('holdout evaluation reasons are malformed or duplicated');
  }
  const expectedFailures = checks
    .filter((check) => check?.status === 'fail' && nonEmptyString(check?.id))
    .map((check) => check.id)
    .sort((left, right) => left.localeCompare(right));
  const suppliedFailures = Array.isArray(failures)
    ? [...failures].sort((left, right) => String(left).localeCompare(String(right)))
    : [];
  if (canonicalJson(suppliedFailures) !== canonicalJson(expectedFailures)) {
    findings.push('holdout evaluation failures do not match its failed checks');
  }
  const expectedStatus =
    Array.isArray(reasons) && reasons.length > 0
      ? 'unproven'
      : expectedFailures.length > 0
        ? 'regression'
        : 'pass';
  if (evaluation.verdict?.status !== expectedStatus) {
    findings.push('holdout evaluation verdict is not derived from its checks and reasons');
  }
  return [...new Set(findings)].sort((left, right) => left.localeCompare(right));
}

function independentHoldoutFindings(baseline, holdout, sourceCommit) {
  const findings = [];
  if (holdout?.report?.source?.commit !== sourceCommit) {
    findings.push('holdout source commit differs from the publication source');
  }
  if (
    baseline?.reports?.some((report) => report.execution === holdout?.report?.execution?.digest)
  ) {
    findings.push('holdout reuses a baseline execution identity');
  }
  if (
    baseline?.reports?.some(
      (report) => report.runUrl === holdout?.report?.execution?.github?.runUrl,
    )
  ) {
    findings.push('holdout reuses a baseline workflow run');
  }
  return findings;
}

function exactPublicationIdentityFindings(entries) {
  if (entries.length !== FAMILY_NAMES.length * 6) {
    return [`publication has ${String(entries.length)} reports; expected 42`];
  }
  const findings = [];
  const first = entries[0]?.report;
  const uniqueFields = [
    ['artifact API URL', (entry) => entry.custody?.apiUrl],
    ['artifact archive digest', (entry) => entry.custody?.archiveDigest],
    ['artifact identity', (entry) => entry.custody?.artifactId],
    ['artifact location', (entry) => entry.location],
    ['execution identity', (entry) => entry.report?.execution?.digest],
    ['report content digest', (entry) => entry.contentDigest],
  ];
  for (const [label, select] of uniqueFields) {
    const values = entries.map(select);
    if (values.some((value) => value === undefined || value === null || value === '')) {
      findings.push(`${String(label)} census is incomplete`);
    } else if (new Set(values).size !== values.length) {
      findings.push(`duplicate ${String(label)}`);
    }
  }
  for (const [index, entry] of entries.entries()) {
    if (entry.report?.source?.commit !== first?.source?.commit) {
      findings.push(`report[${String(index)}] source commit differs across publication`);
    }
    if (canonicalJson(entry.report?.source?.locks) !== canonicalJson(first?.source?.locks)) {
      findings.push(`report[${String(index)}] dependency locks differ across publication`);
    }
    if (entry.report?.execution?.github?.sha !== entry.report?.source?.commit) {
      findings.push(`report[${String(index)}] execution source identity differs`);
    }
    if (entry.custody?.reportContentDigest !== entry.contentDigest) {
      findings.push(`report[${String(index)}] custody content digest differs`);
    }
    if (
      entry.custody?.workflow?.workflowContentDigest !==
      entries[0]?.custody?.workflow?.workflowContentDigest
    ) {
      findings.push(`report[${String(index)}] trusted workflow bytes differ across publication`);
    }
  }
  if (!COMMIT_PATTERN.test(first?.source?.commit ?? '')) {
    findings.push('publication source commit is unavailable');
  }
  for (const lock of REQUIRED_LOCKS) {
    if (!DIGEST_PATTERN.test(first?.source?.locks?.[lock] ?? '')) {
      findings.push(`publication ${lock} identity is unavailable`);
    }
  }
  return [...new Set(findings)].sort();
}

function deriveProductionBytesAssessment(entry, sourceCommit, locks) {
  const reasons = [];
  if (!ownRecord(entry)) {
    reasons.push('authenticated sidecar is unavailable');
  }
  reasons.push(...productionBytesReportFindings(entry?.report));
  reasons.push(...productionBytesBudgetFindings(entry?.budgets));
  reasons.push(...productionBytesBudgetCustodyFindings(entry, sourceCommit));
  if (
    entry?.report?.source?.commit !== sourceCommit ||
    entry?.report?.sourceAfter?.commit !== sourceCommit ||
    canonicalJson(entry?.report?.source?.locks) !== canonicalJson(locks) ||
    canonicalJson(entry?.report?.sourceAfter?.locks) !== canonicalJson(locks)
  ) {
    reasons.push('source or dependency locks differ from the 42-family publication identity');
  }
  const budget = entry?.budgetIdentity;
  if (
    !ownRecord(budget) ||
    budget.path !== 'perf-budgets.json' ||
    budget.schema !== PERF_BUDGETS_SCHEMA ||
    budget.sourceCommit !== sourceCommit ||
    !Number.isSafeInteger(budget.byteLength) ||
    budget.byteLength < 1 ||
    !DIGEST_PATTERN.test(budget.contentDigest ?? '')
  ) {
    reasons.push('committed perf-budgets.json byte identity is unavailable or unbound');
  }
  let metricVerdicts = [];
  if (reasons.length === 0) {
    metricVerdicts = evaluateReport(entry.budgets, entry.report).map((result) => ({
      budget: result.budget ?? null,
      metricId: result.metricId,
      reason: result.reason ?? null,
      status: result.status,
      value: result.value,
    }));
    if (
      canonicalJson(metricVerdicts.map(({ metricId }) => metricId)) !==
      canonicalJson([...PRODUCTION_BYTES_METRICS].sort())
    ) {
      reasons.push('evaluated metric census differs from the exact five metrics');
    }
  }
  const failures = metricVerdicts
    .filter(({ status }) => status === 'fail')
    .map(({ metricId }) => metricId)
    .sort();
  const nonDecisions = metricVerdicts.filter(
    ({ status }) => status !== 'pass' && status !== 'fail',
  );
  if (nonDecisions.length > 0) {
    reasons.push(
      ...nonDecisions.map(({ metricId, status }) => `${metricId} evaluated as ${String(status)}`),
    );
  }
  const uniqueReasons = [...new Set(reasons)].sort();
  return {
    budget: ownRecord(budget) ? { ...budget } : null,
    componentCount: PRODUCTION_BYTES_CONFIG.componentCount,
    evidence: ownRecord(entry) ? evidenceReference(entry) : null,
    failures,
    host: entry?.report?.host?.digest ?? null,
    metricVerdicts,
    reasons: uniqueReasons,
    status: uniqueReasons.length > 0 ? 'unproven' : failures.length > 0 ? 'blocked' : 'pass',
    workload: entry?.report?.workloadIdentity?.digest ?? null,
  };
}

function evidenceReference(entry) {
  return {
    ...entry.custody,
    execution: entry.report?.execution?.digest ?? null,
    host: entry.report?.host?.digest ?? null,
    locks: entry.report?.source?.locks ?? null,
    sourceCommit: entry.report?.source?.commit ?? null,
    workload: entry.report?.workloadIdentity?.digest ?? null,
  };
}

function evaluationReference(evaluation, targetAssessment) {
  const failures = sortedUniqueStrings(evaluation?.verdict?.failures ?? []);
  const partitions = evaluationFailurePartitions(failures, targetAssessment);
  return {
    blockingFailures: partitions.blockingFailures,
    candidate: {
      execution: evaluation?.candidate?.execution ?? null,
      sourceCommit: evaluation?.candidate?.sourceCommit ?? null,
    },
    failures,
    followOnFailures: partitions.followOnFailures,
    reasons: sortedUniqueStrings(evaluation?.verdict?.reasons ?? []),
    status: evaluation?.verdict?.status ?? null,
  };
}

function evaluationFailurePartitions(failures, targetAssessment) {
  const followOnIds = new Set(
    (targetAssessment?.holdout?.checks ?? [])
      .filter((check) => check?.publicationImpact === 'follow-on')
      .map((check) => check.id),
  );
  return {
    blockingFailures: failures.filter((failure) => !followOnIds.has(failure)),
    followOnFailures: failures.filter((failure) => followOnIds.has(failure)),
  };
}

function buildPersistencePublicationReasons(assessment) {
  if (assessment?.verdict?.status !== 'unproven') return [];
  const persistenceFindings = Array.isArray(assessment.verdict.findings)
    ? assessment.verdict.findings
    : [];
  return persistenceFindings.length > 0
    ? persistenceFindings.map((finding) => `build persistence ${String(finding)}`)
    : [`build persistence is ${String(assessment.verdict.outcome)}`];
}

function buildPersistenceBlockingFailures(assessment) {
  return assessment?.verdict?.outcome === 'warranted'
    ? [BUILD_PERSISTENCE_DECISION_REQUIRED_FAILURE]
    : [];
}

function blockingFailures(families) {
  return FAMILY_NAMES.flatMap((familyName) => {
    const family = families[familyName];
    if (family?.status !== 'blocked') return [];
    return [
      ...new Set([
        ...(family.targetAssessment?.blockingFailures ?? []),
        ...(family.holdoutEvaluation?.blockingFailures ?? []),
      ]),
    ].map((failure) => `${familyName}:${failure}`);
  }).sort();
}

function documentReferences(familyName, documents) {
  return Object.fromEntries(
    Object.entries(documents).map(([kind, document]) => [
      kind,
      {
        contentDigest: sha256Bytes(prettyJson(document)),
        fileName: `${familyName}-${kind}.json`,
        schema: document?.schema ?? null,
        semanticDigest: document?.digest ?? sha256Canonical(document),
      },
    ]),
  );
}

function fixtureSources(sourceCommit) {
  const root = `https://github.com/${PERF_PUBLICATION_REPOSITORY}/tree/${String(sourceCommit)}`;
  return {
    'Kovo fixture': `${root}/benchmarks/kovo`,
    'Next.js fixture': `${root}/benchmarks/nextjs`,
    'generated corpus source': `${root}/benchmarks/corpora`,
    'matched fixture contract': `${root}/benchmarks/shared`,
  };
}

export function buildProfilePublicationFindings(entry, expectedMode) {
  const findings = [];
  const report = entry?.report;
  const custody = entry?.custody;
  const workflow = custody?.workflow;
  const reportMember = `profile-${expectedMode}.json`;
  const mergedMember = `build-${expectedMode}.cpuprofile`;
  const processCpuMember = `process-cpu-${expectedMode}.txt`;
  const rawTextBytes =
    typeof entry?.rawText === 'string' ? Buffer.from(entry.rawText, 'utf8') : Buffer.alloc(0);
  let rawTextMatches = false;
  try {
    rawTextMatches =
      typeof entry?.rawText === 'string' &&
      canonicalJson(JSON.parse(entry.rawText)) === canonicalJson(report);
  } catch {
    rawTextMatches = false;
  }
  if (
    !ownRecord(report) ||
    report.schema !== PERF_BUILD_SESSION_PROFILE_SCHEMA ||
    report.classifier !== PERF_BUILD_SESSION_PROFILE_CLASSIFIER ||
    report.subject?.mode !== expectedMode
  ) {
    findings.push(`${expectedMode} build profile report schema, classifier, or mode differs`);
  }
  const { digest: reportDigest, ...reportFacts } = ownRecord(report) ? report : {};
  if (
    !DIGEST_PATTERN.test(entry?.contentDigest ?? '') ||
    entry.contentDigest !== sha256Bytes(rawTextBytes) ||
    !rawTextMatches ||
    custody?.reportContentDigest !== entry?.contentDigest ||
    !DIGEST_PATTERN.test(reportDigest ?? '') ||
    reportDigest !== sha256Canonical(reportFacts)
  ) {
    findings.push(`${expectedMode} build profile report bytes or semantic digest differ`);
  }
  if (
    custody?.artifactName !== BUILD_PROFILE_ARTIFACT_NAME ||
    custody?.reportMember !== reportMember ||
    custody?.location !== entry?.location ||
    custody?.artifactDigest !== custody?.archiveDigest ||
    custody?.artifactSizeInBytes !== custody?.archiveByteLength ||
    workflow?.triggerPolicy !== 'build-profile' ||
    BUILD_PROFILE_TRIGGER_SCOPES[workflow?.event] !== workflow?.triggerScope ||
    (workflow?.event !== 'pull_request' && workflow?.workflowSha !== report?.source?.commit) ||
    workflow?.job?.key !== BUILD_PROFILE_WORKFLOW_JOB.key ||
    workflow?.job?.name !== BUILD_PROFILE_WORKFLOW_JOB.name ||
    workflow?.sourceSha !== report?.source?.commit ||
    workflow?.headSha !== report?.source?.commit ||
    workflow?.workflowSha !== report?.execution?.github?.workflowSha ||
    workflow?.workflowHeadSha !== workflow?.workflowSha ||
    !workflowArtifactUploadMatches(
      workflow?.artifactUpload,
      BUILD_PROFILE_WORKFLOW_JOB,
      BUILD_PROFILE_ARTIFACT_NAME,
    ) ||
    !DIGEST_PATTERN.test(custody?.workflowApiResponseDigest ?? '') ||
    !DIGEST_PATTERN.test(workflow?.workflowContentDigest ?? '')
  ) {
    findings.push(`${expectedMode} build profile workflow authority differs from policy`);
  }
  findings.push(...buildProfileAuthorityDigestFindings(custody, expectedMode));

  const artifacts = Array.isArray(report?.profileArtifacts) ? report.profileArtifacts : [];
  let requireConfigStaticTrust = null;
  try {
    requireConfigStaticTrust = buildProfileConfigStaticTrustRequired(report?.sourcePhasePosture);
  } catch (error) {
    findings.push(
      `${expectedMode} build profile source phase posture is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const expectedRoles = [
    ...PERF_BUILD_PROFILE_REQUIRED_ROLES,
    ...(requireConfigStaticTrust === true ? ['config-static-trust'] : []),
  ].sort((left, right) => left.localeCompare(right));
  const artifactRoles = artifacts
    .map((artifact) => artifact?.role)
    .sort((left, right) => String(left).localeCompare(String(right)));
  const artifactMembers = artifacts.map((artifact) => artifact?.member);
  if (
    requireConfigStaticTrust === null ||
    artifacts.length !== expectedRoles.length ||
    canonicalJson(artifactRoles) !== canonicalJson(expectedRoles) ||
    new Set(artifactMembers).size !== artifacts.length ||
    canonicalJson(artifactMembers) !==
      canonicalJson(
        [...artifactMembers].sort((left, right) => String(left).localeCompare(String(right))),
      )
  ) {
    findings.push(`${expectedMode} original-process profile census differs from policy`);
  }

  const auxiliaryMap = authenticatedAuxiliaryMap(entry, expectedMode, findings);
  const rawInputs = [];
  const artifactPids = new Set();
  for (const artifact of artifacts) {
    const memberMatch = new RegExp(
      `^raw-${expectedMode}-([a-z][a-z0-9-]*)-pid-([1-9][0-9]*)\\.cpuprofile$`,
      'u',
    ).exec(artifact?.member ?? '');
    const auxiliary = auxiliaryMap.get(artifact?.member);
    if (
      memberMatch === null ||
      artifact?.role !== memberMatch?.[1] ||
      artifact?.pid !== Number(memberMatch?.[2]) ||
      artifactPids.has(artifact?.pid) ||
      !ownRecord(auxiliary) ||
      artifact?.bytes !== auxiliary?.bytes?.length ||
      artifact?.sha256 !== auxiliary?.contentDigest
    ) {
      findings.push(`${expectedMode} original-process profile identity differs from custody`);
      continue;
    }
    artifactPids.add(artifact.pid);
    rawInputs.push({
      bytes: auxiliary.bytes,
      member: artifact.member,
      pid: artifact.pid,
      role: artifact.role,
    });
  }
  const expectedModeMembers = [
    mergedMember,
    processCpuMember,
    reportMember,
    ...artifactMembers,
  ].sort((left, right) => String(left).localeCompare(String(right)));
  if (canonicalJson(report?.artifactMembers) !== canonicalJson(expectedModeMembers)) {
    findings.push(`${expectedMode} declared artifact member census differs from raw evidence`);
  }
  const expectedAuxiliaryMembers = [mergedMember, processCpuMember, ...artifactMembers].sort(
    (left, right) => String(left).localeCompare(String(right)),
  );
  if (
    canonicalJson([...auxiliaryMap.keys()].sort((left, right) => left.localeCompare(right))) !==
    canonicalJson(expectedAuxiliaryMembers)
  ) {
    findings.push(`${expectedMode} authenticated auxiliary member census differs`);
  }

  const mergedAuxiliary = auxiliaryMap.get(mergedMember);
  const cpuAuxiliary = auxiliaryMap.get(processCpuMember);
  if (
    !ownRecord(mergedAuxiliary) ||
    report?.profileArtifact?.fileName !== mergedMember ||
    report?.profileArtifact?.bytes !== mergedAuxiliary?.bytes?.length ||
    report?.profileArtifact?.sha256 !== mergedAuxiliary?.contentDigest
  ) {
    findings.push(`${expectedMode} merged profile convenience artifact differs from custody`);
  }
  if (
    !ownRecord(cpuAuxiliary) ||
    report?.processCpuArtifact?.fileName !== processCpuMember ||
    report?.processCpuArtifact?.bytes !== cpuAuxiliary?.bytes?.length ||
    report?.processCpuArtifact?.sha256 !== cpuAuxiliary?.contentDigest
  ) {
    findings.push(`${expectedMode} recursive CPU artifact differs from custody`);
  }

  if (rawInputs.length === artifacts.length && rawInputs.length > 0) {
    try {
      if (requireConfigStaticTrust === null) {
        throw new TypeError('config static-trust role posture is unavailable');
      }
      const inspected = deriveBuildProfileSetAnalysis(
        rawInputs.map(({ bytes, role }) => ({ bytes, role })),
        { nativeOrUnprofiledSamples: 0, requireConfigStaticTrust },
      );
      for (const [index, artifact] of artifacts.entries()) {
        const profile = inspected.profileCensus[index];
        if (
          profile?.role !== artifact.role ||
          profile?.nodes !== artifact.nodes ||
          profile?.samples !== artifact.samples ||
          profile?.activeSamples !== artifact.activeSamples ||
          profile?.idleSamples !== artifact.idleSamples ||
          profile?.waitSamples !== artifact.waitSamples ||
          profile?.negativeTimeDeltas !== artifact.negativeTimeDeltas ||
          profile?.activeSamples + profile?.idleSamples + profile?.waitSamples !== profile?.samples
        ) {
          findings.push(
            `${expectedMode} original-process profile sample census is not derived from raw bytes`,
          );
        }
        rawInputs[index].facts = {
          activeSamples: profile.activeSamples,
          idleSamples: profile.idleSamples,
          negativeTimeDeltas: profile.negativeTimeDeltas,
          nodes: profile.nodes,
          samples: profile.samples,
          waitSamples: profile.waitSamples,
        };
      }

      const processCensusFindings = buildProfileProcessCensusFindings(
        report?.capture?.processCensus,
        artifacts,
        expectedRoles,
      );
      findings.push(...processCensusFindings.map((finding) => `${expectedMode} ${finding}`));
      if (processCensusFindings.length === 0 && Buffer.isBuffer(cpuAuxiliary?.bytes)) {
        const processCpu = deriveBuildProcessCpuEvidence({
          processCensus: report.capture.processCensus,
          processCpuBytes: cpuAuxiliary.bytes,
          profileInputs: rawInputs,
        });
        if (canonicalJson(processCpu) !== canonicalJson(report?.capture?.processCpu)) {
          findings.push(`${expectedMode} recursive CPU evidence is not derived from raw bytes`);
        }
        const analysis = deriveBuildProfileSetAnalysis(
          rawInputs.map(({ bytes, role }) => ({ bytes, role })),
          {
            nativeOrUnprofiledSamples: processCpu.cause.equivalentSamples,
            requireConfigStaticTrust,
          },
        );
        if (
          canonicalJson(analysis) !== canonicalJson(report?.capture?.profileSetAnalysis) ||
          canonicalJson(analysis.topFive) !== canonicalJson(report?.topFive)
        ) {
          findings.push(
            `${expectedMode} profile analysis and top five are not derived from raw originals`,
          );
        }
      }

      if (Buffer.isBuffer(mergedAuxiliary?.bytes)) {
        const merged = mergeBuildProcessProfiles(rawInputs);
        if (!merged.bytes.equals(mergedAuxiliary.bytes)) {
          findings.push(
            `${expectedMode} merged profile convenience bytes are not derived from raw originals`,
          );
        }
        if (!captureContainsExactMergedCensus(report?.capture, merged.census)) {
          findings.push(`${expectedMode} merged profile census is not derived from raw originals`);
        }
      }
    } catch (error) {
      findings.push(
        `${expectedMode} raw process profile reproduction failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return [...new Set(findings)].sort();
}

function buildProfileAuthorityDigestFindings(custody, mode) {
  const findings = [];
  for (const field of [
    'apiAuthorityDigest',
    'apiResponseDigest',
    'archiveDigest',
    'jobsApiAuthorityDigest',
    'jobsApiResponseDigest',
    'liveApiAuthorityDigest',
    'liveApiResponseDigest',
    'liveJobsApiAuthorityDigest',
    'liveJobsApiResponseDigest',
    'liveRunApiAuthorityDigest',
    'liveRunApiResponseDigest',
    'reportContentDigest',
    'runApiAuthorityDigest',
    'runApiResponseDigest',
    'workflowApiResponseDigest',
  ]) {
    if (!DIGEST_PATTERN.test(custody?.[field] ?? '')) {
      findings.push(`${mode} build profile ${field} is malformed`);
    }
  }
  if (
    custody?.apiAuthorityDigest !== custody?.liveApiAuthorityDigest ||
    custody?.jobsApiAuthorityDigest !== custody?.liveJobsApiAuthorityDigest ||
    custody?.runApiAuthorityDigest !== custody?.liveRunApiAuthorityDigest
  ) {
    findings.push(`${mode} saved and live build profile authority projections differ`);
  }
  if (
    !Number.isSafeInteger(custody?.artifactId) ||
    custody.artifactId < 1 ||
    !Number.isSafeInteger(custody?.workflowRunId) ||
    custody.workflowRunId < 1 ||
    !Number.isSafeInteger(custody?.archiveByteLength) ||
    custody.archiveByteLength < 1 ||
    custody?.artifactSizeInBytes !== custody?.archiveByteLength ||
    custody?.artifactDigest !== custody?.archiveDigest
  ) {
    findings.push(`${mode} build profile artifact identity is malformed`);
    return findings;
  }
  const apiUrl = `https://api.github.com/repos/${PERF_PUBLICATION_REPOSITORY}/actions/artifacts/${String(custody.artifactId)}`;
  const runApiUrl = `https://api.github.com/repos/${PERF_PUBLICATION_REPOSITORY}/actions/runs/${String(custody.workflowRunId)}`;
  const runUrl = `https://github.com/${PERF_PUBLICATION_REPOSITORY}/actions/runs/${String(custody.workflowRunId)}`;
  const workflow = custody.workflow;
  const workflowApiUrl = `https://api.github.com/repos/${PERF_PUBLICATION_REPOSITORY}/contents/${PERF_REALISTIC_WORKFLOW_PATH}?ref=${String(workflow?.workflowSha)}`;
  if (
    custody.apiUrl !== apiUrl ||
    custody.archiveDownloadUrl !== `${apiUrl}/zip` ||
    custody.runApiUrl !== runApiUrl ||
    custody.jobsApiUrl !== `${runApiUrl}/jobs?filter=all&per_page=100` ||
    custody.runUrl !== runUrl ||
    custody.location !== `${runUrl}/artifacts/${String(custody.artifactId)}`
  ) {
    findings.push(`${mode} build profile URLs are not derived from canonical IDs`);
  }
  if (
    !ownRecord(workflow) ||
    workflow.name !== 'Perf Realistic Tier' ||
    workflow.path !== PERF_REALISTIC_WORKFLOW_PATH ||
    workflow.status !== 'completed' ||
    !COMMIT_PATTERN.test(workflow.headSha ?? '') ||
    !COMMIT_PATTERN.test(workflow.sourceSha ?? '') ||
    !COMMIT_PATTERN.test(workflow.workflowSha ?? '') ||
    workflow.workflowHeadSha !== workflow.workflowSha ||
    workflow.workflowApiUrl !== workflowApiUrl ||
    !validWorkflowReference(workflow.workflowRef) ||
    !GIT_BLOB_PATTERN.test(workflow.workflowGitBlobSha ?? '') ||
    !Number.isSafeInteger(workflow.runAttempt) ||
    workflow.runAttempt < 1 ||
    workflow.runApiUrl !== runApiUrl ||
    workflow.jobsApiUrl !== `${runApiUrl}/jobs?filter=all&per_page=100`
  ) {
    findings.push(`${mode} build profile workflow identity is malformed`);
  }
  const job = workflow?.job;
  if (
    !ownRecord(job) ||
    job.key !== BUILD_PROFILE_WORKFLOW_JOB.key ||
    job.name !== BUILD_PROFILE_WORKFLOW_JOB.name ||
    job.status !== 'completed' ||
    job.conclusion !== 'success' ||
    job.runAttempt !== workflow?.runAttempt ||
    !Number.isSafeInteger(job.id) ||
    job.id < 1 ||
    job.apiUrl !==
      `https://api.github.com/repos/${PERF_PUBLICATION_REPOSITORY}/actions/jobs/${String(job.id)}` ||
    !validExactTimestamp(job.startedAt) ||
    !validExactTimestamp(job.completedAt) ||
    Date.parse(job.startedAt) > Date.parse(job.completedAt)
  ) {
    findings.push(`${mode} build profile producer job identity is malformed`);
  }
  findings.push(
    ...archiveMemberCensusFindings(custody.archiveMembers).map(
      (finding) => `${mode} build profile ${finding}`,
    ),
  );
  return findings;
}

function authenticatedAuxiliaryMap(entry, mode, findings) {
  const result = new Map();
  const auxiliaries = entry?.auxiliaries;
  const custodyMembers = entry?.custody?.auxiliaryMembers;
  const archiveMembers = entry?.custody?.archiveMembers;
  if (
    !Array.isArray(auxiliaries) ||
    !Array.isArray(custodyMembers) ||
    !Array.isArray(archiveMembers) ||
    auxiliaries.length !== custodyMembers.length
  ) {
    findings.push(`${mode} grouped profile auxiliaries are unavailable`);
    return result;
  }
  const custodyByMember = new Map(custodyMembers.map((member) => [member?.member, member]));
  const archiveByMember = new Map(archiveMembers.map((member) => [member?.member, member]));
  if (
    custodyByMember.size !== custodyMembers.length ||
    archiveByMember.size !== archiveMembers.length
  ) {
    findings.push(`${mode} grouped profile auxiliary or archive census is duplicated`);
    return result;
  }
  for (const auxiliary of auxiliaries) {
    const custody = custodyByMember.get(auxiliary?.member);
    const archive = archiveByMember.get(auxiliary?.member);
    if (
      !nonEmptyString(auxiliary?.member) ||
      result.has(auxiliary.member) ||
      !Buffer.isBuffer(auxiliary?.bytes) ||
      auxiliary.bytes.length < 1 ||
      auxiliary.contentDigest !== sha256Bytes(auxiliary.bytes) ||
      custody?.byteLength !== auxiliary.bytes.length ||
      custody?.contentDigest !== auxiliary.contentDigest ||
      archive?.byteLength !== auxiliary.bytes.length ||
      archive?.contentDigest !== auxiliary.contentDigest
    ) {
      findings.push(`${mode} grouped profile auxiliary differs from ZIP custody`);
      continue;
    }
    result.set(auxiliary.member, auxiliary);
  }
  return result;
}

function archiveMemberCensusFindings(members) {
  if (!Array.isArray(members) || members.length < 1) {
    return ['ZIP member census is unavailable'];
  }
  const findings = [];
  const names = members.map((member) => member?.member);
  if (
    names.some((member) => !safeArchiveMemberName(member)) ||
    new Set(names).size !== names.length ||
    canonicalJson(names) !==
      canonicalJson([...names].sort((left, right) => String(left).localeCompare(String(right))))
  ) {
    findings.push('ZIP member names are unsafe, duplicated, or unsorted');
  }
  for (const member of members) {
    if (
      canonicalJson(Object.keys(member ?? {}).sort()) !==
        canonicalJson([
          'byteLength',
          'compressedByteLength',
          'compressionMethod',
          'contentDigest',
          'crc32',
          'member',
        ]) ||
      !Number.isSafeInteger(member?.byteLength) ||
      member.byteLength < 1 ||
      !Number.isSafeInteger(member?.compressedByteLength) ||
      member.compressedByteLength < 0 ||
      ![0, 8].includes(member?.compressionMethod) ||
      !DIGEST_PATTERN.test(member?.contentDigest ?? '') ||
      !/^crc32:[0-9a-f]{8}$/u.test(member?.crc32 ?? '')
    ) {
      findings.push('ZIP member authentication facts are malformed');
    }
  }
  return findings;
}

function buildProfileProcessCensusFindings(processCensus, artifacts, expectedNodeRoles) {
  if (
    !ownRecord(processCensus) ||
    processCensus.schema !== BUILD_PROFILE_PROCESS_CENSUS_SCHEMA ||
    processCensus.classifier !== BUILD_PROFILE_PROCESS_ROLE_CLASSIFIER ||
    processCensus.complete !== true ||
    !Number.isSafeInteger(processCensus.forkOnlyProcesses) ||
    processCensus.forkOnlyProcesses < 0 ||
    !Array.isArray(processCensus.processes) ||
    !Array.isArray(expectedNodeRoles) ||
    !ownRecord(processCensus.tools) ||
    canonicalJson(Object.keys(processCensus).sort()) !==
      canonicalJson(['classifier', 'complete', 'forkOnlyProcesses', 'processes', 'schema', 'tools'])
  ) {
    return ['process census schema or completeness differs'];
  }
  const findings = [];
  const tools = processCensus.tools;
  if (
    canonicalJson(Object.keys(tools).sort()) !== canonicalJson(['env', 'node', 'strace', 'time'])
  ) {
    findings.push('process census tool census differs');
  }
  for (const [name, expectedPath] of [
    ['env', '/usr/bin/env'],
    ['strace', '/usr/bin/strace'],
    ['time', '/usr/bin/time'],
  ]) {
    if (!executableIdentityMatches(tools[name]) || tools[name].realPath !== expectedPath) {
      findings.push(`process census ${name} tool identity is malformed`);
    }
  }
  if (!executableIdentityMatches(tools.node)) {
    findings.push('process census Node tool identity is malformed');
  }
  const processes = processCensus.processes;
  const processByPid = new Map(processes.map((process) => [process?.pid, process]));
  const artifactByPid = new Map(artifacts.map((artifact) => [artifact?.pid, artifact]));
  const expectedNodeRoleSet = new Set(expectedNodeRoles);
  const allowedRoles = new Set([...expectedNodeRoles, 'collector-time', 'native-one-shot']);
  const roleEvidence = {
    analyze: 'analyze-worker-entry-exec/v1',
    'app-static-trust': 'app-static-trust-worker-entry-exec/v1',
    bootstrap: 'bootstrap-source-bin-exec/v1',
    client: 'client-worker-entry-exec/v1',
    'config-static-trust': 'config-static-trust-worker-entry-exec/v1',
    'collector-time': 'gnu-time-exec/v1',
    final: 'final-worker-entry-exec/v1',
    'native-one-shot': ['esbuild-exec/v1', 'native-unprofiled-exec/v1'],
    orchestrator: ['orchestrator-source-bin-exec/v1', 'orchestrator-packed-bin-exec/v1'],
    server: 'server-worker-entry-exec/v1',
    typescript: 'typescript-cli-entry-exec/v1',
  };
  for (const process of processes) {
    const expectedEvidence = roleEvidence[process?.role];
    const evidenceMatches = Array.isArray(expectedEvidence)
      ? expectedEvidence.includes(process?.roleEvidence)
      : process?.roleEvidence === expectedEvidence;
    const nodeRole = expectedNodeRoleSet.has(process?.role);
    if (
      !Number.isSafeInteger(process?.pid) ||
      process.pid < 1 ||
      !(
        process?.parentPid === null ||
        (Number.isSafeInteger(process?.parentPid) && process.parentPid > 0)
      ) ||
      !allowedRoles.has(process?.role) ||
      !evidenceMatches ||
      !executableIdentityMatches(process?.executable) ||
      canonicalJson(Object.keys(process ?? {}).sort()) !==
        canonicalJson(['entry', 'executable', 'parentPid', 'pid', 'role', 'roleEvidence']) ||
      (nodeRole &&
        (!executableIdentityMatches(process?.entry) ||
          canonicalJson(process.executable) !== canonicalJson(tools.node))) ||
      (!nodeRole && process?.entry !== null)
    ) {
      findings.push('process PID, role, executable, or entry identity is malformed');
    }
    if (
      nodeRole &&
      (artifactByPid.get(process?.pid)?.role !== process.role ||
        !roleEntryPathMatches(process.role, process?.entry?.realPath))
    ) {
      findings.push('process census Node role differs from raw profile custody');
    }
    if (
      process?.role === 'collector-time' &&
      canonicalJson(process.executable) !== canonicalJson(tools.time)
    ) {
      findings.push('recursive CPU collector executable differs from the pinned tool');
    }
    if (process?.role === 'native-one-shot') {
      const isEsbuild = /\/(?:@esbuild\/[^/]+|esbuild)\/bin\/esbuild$/u.test(
        process?.executable?.realPath ?? '',
      );
      if (
        (process.roleEvidence === 'esbuild-exec/v1' && !isEsbuild) ||
        (process.roleEvidence === 'native-unprofiled-exec/v1' &&
          canonicalJson(process.executable) === canonicalJson(tools.node))
      ) {
        findings.push('native one-shot executable contradicts its authenticated role evidence');
      }
    }
  }
  if (
    processByPid.size !== processes.length ||
    processes.filter((process) => process?.role === 'collector-time').length !== 1 ||
    processes.filter((process) => expectedNodeRoleSet.has(process?.role)).length !==
      artifacts.length ||
    !processes.some((process) => process?.role === 'native-one-shot')
  ) {
    findings.push('process PID/role census is incomplete or duplicated');
  }
  const roots = processes.filter((process) => process?.parentPid === null);
  if (roots.length !== 1 || roots[0]?.role !== 'collector-time') {
    findings.push('process census does not have one recursive collector root');
  }
  for (const process of processes) {
    if (!ownRecord(process)) continue;
    const visited = new Set();
    let current = process;
    while (current !== undefined && current.parentPid !== null) {
      if (visited.has(current.pid)) {
        findings.push('process census parent graph is cyclic');
        break;
      }
      visited.add(current.pid);
      current = processByPid.get(current.parentPid);
      if (current === undefined) {
        findings.push('process census parent graph is disconnected');
        break;
      }
    }
    if (current !== undefined && current !== roots[0]) {
      findings.push('process census node does not descend from the collector root');
    }
  }
  return [...new Set(findings)].sort();
}

function executableIdentityMatches(value) {
  return (
    ownRecord(value) &&
    canonicalJson(Object.keys(value).sort()) ===
      canonicalJson(['bytes', 'path', 'realPath', 'sha256']) &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes > 0 &&
    typeof value.path === 'string' &&
    path.isAbsolute(value.path) &&
    typeof value.realPath === 'string' &&
    path.isAbsolute(value.realPath) &&
    DIGEST_PATTERN.test(value.sha256 ?? '')
  );
}

function roleEntryPathMatches(role, value) {
  if (!nonEmptyString(value)) return false;
  const normalized = value.replaceAll('\\', '/');
  const patterns = {
    analyze: /\/build-one-shot-analyze-worker\.(?:ts|mjs)$/u,
    'app-static-trust': /\/build-static-trust-worker\.(?:ts|mjs)$/u,
    bootstrap: /\/(?:packages\/cli\/src|node_modules\/@kovojs\/cli\/src)\/bin\.ts$/u,
    client: /\/build-one-shot-client-worker\.(?:ts|mjs)$/u,
    'config-static-trust': /\/build-static-trust-worker\.(?:ts|mjs)$/u,
    final: /\/build-one-shot-final-worker\.(?:ts|mjs)$/u,
    orchestrator:
      /\/(?:packages\/cli|node_modules\/@kovojs\/cli)\/(?:src\/bin\.ts|dist\/bin\.mjs)$/u,
    server: /\/build-one-shot-server-worker\.(?:ts|mjs)$/u,
    typescript: /\/node_modules\/typescript\/bin\/tsc$/u,
  };
  return patterns[role]?.test(normalized) === true;
}

function captureContainsExactMergedCensus(capture, census) {
  if (!ownRecord(capture) || !ownRecord(census)) return false;
  const expectedKeys = [
    ...Object.keys(census),
    'processCensus',
    'processCpu',
    'profileSetAnalysis',
  ].sort((left, right) => left.localeCompare(right));
  if (
    canonicalJson(Object.keys(capture).sort((left, right) => left.localeCompare(right))) !==
    canonicalJson(expectedKeys)
  ) {
    return false;
  }
  return Object.entries(census).every(
    ([field, value]) => canonicalJson(capture[field]) === canonicalJson(value),
  );
}

function validateInputManifest(input) {
  if (!ownRecord(input) || input.schema !== PERF_PUBLICATION_INPUT_SCHEMA) {
    throw new TypeError(`manifest must be ${PERF_PUBLICATION_INPUT_SCHEMA}`);
  }
  if (!ownRecord(input.productionBytes)) {
    throw new TypeError('manifest must contain one Production bytes evidence descriptor');
  }
  const expectedKeys = [
    ...(input.buildProfiles === undefined ? [] : ['buildProfiles']),
    'campaign',
    'families',
    'productionBytes',
    'repository',
    'schema',
  ].sort((left, right) => left.localeCompare(right));
  if (canonicalJson(Object.keys(input).sort()) !== canonicalJson(expectedKeys)) {
    throw new TypeError(
      'manifest must contain only schema, repository, campaign, families, productionBytes, and optional buildProfiles',
    );
  }
  if (input.repository !== PERF_PUBLICATION_REPOSITORY) {
    throw new TypeError(`manifest repository must be ${PERF_PUBLICATION_REPOSITORY}`);
  }
  if (
    canonicalJson(Object.keys(input.families ?? {}).sort()) !==
    canonicalJson([...FAMILY_NAMES].sort())
  ) {
    throw new TypeError('manifest must contain the exact seven-family census');
  }
  for (const familyName of FAMILY_NAMES) {
    const family = input.families[familyName];
    if (
      !ownRecord(family) ||
      canonicalJson(Object.keys(family).sort()) !== canonicalJson(['baseline', 'holdout']) ||
      !Array.isArray(family.baseline) ||
      family.baseline.length !== 5 ||
      !ownRecord(family.holdout)
    ) {
      throw new TypeError(
        `${familyName} must contain exactly five baseline reports and one holdout`,
      );
    }
  }
  if (
    input.buildProfiles !== undefined &&
    (!ownRecord(input.buildProfiles) ||
      canonicalJson(Object.keys(input.buildProfiles).sort()) !==
        canonicalJson([...BUILD_PROFILE_MODES].sort()))
  ) {
    throw new TypeError('buildProfiles must contain exactly unchanged and edit evidence');
  }
}

function campaignPublicationFindings(campaign, publication) {
  if (!ownRecord(campaign)) return ['chronology is unavailable'];
  const findings = [];
  const expectedCampaignKeys = [
    'boundary',
    'cohortSelections',
    'excludedFamilyArtifacts',
    'familyCandidates',
    'liveWorkflowRunsApiResponseDigest',
    'productionBytes',
    'productionBytesCandidates',
    'runs',
    'selectedFamilies',
    'selectedProductionBytes',
    'workflowRunsApiAuthorityDigest',
    'workflowRunsApiResponseDigest',
  ];
  if (canonicalJson(Object.keys(campaign).sort()) !== canonicalJson(expectedCampaignKeys.sort())) {
    findings.push('field census differs from the authenticated campaign aggregate');
  }
  const boundary = campaign.boundary;
  if (
    !ownRecord(boundary) ||
    !Number.isSafeInteger(boundary.firstRunId) ||
    !Number.isSafeInteger(boundary.lastRunId) ||
    boundary.firstRunId < 1 ||
    boundary.firstRunId > boundary.lastRunId
  ) {
    findings.push('boundary is malformed');
  }
  if (
    !Array.isArray(campaign.runs) ||
    campaign.runs.length < 1 ||
    campaign.runs.length > MAX_CAMPAIGN_RUNS ||
    new Set(campaign.runs.map((run) => run?.runId)).size !== campaign.runs.length ||
    canonicalJson([...campaign.runs].sort(campaignChronologyOrder)) !== canonicalJson(campaign.runs)
  ) {
    findings.push('run chronology is incomplete, duplicated, or non-canonical');
  }
  if (
    Array.isArray(campaign.runs) &&
    (!campaign.runs.some((run) => run?.runId === boundary?.firstRunId) ||
      !campaign.runs.some((run) => run?.runId === boundary?.lastRunId))
  ) {
    findings.push('run chronology does not retain both campaign boundary endpoints');
  }
  const derivedFamilyCandidates = [];
  const derivedProductionBytes = [];
  const excludedArtifactsById = new Map();
  const seenExcludedArtifacts = new Set();
  try {
    validateExcludedFamilyArtifacts(
      campaign.excludedFamilyArtifacts,
      (campaign.runs ?? []).map((run) => run?.runId),
    );
    for (const exclusion of campaign.excludedFamilyArtifacts) {
      excludedArtifactsById.set(exclusion.artifactId, exclusion);
    }
  } catch (error) {
    findings.push(error instanceof Error ? error.message : String(error));
  }
  const artifactIds = new Set();
  for (const run of campaign.runs ?? []) {
    for (const artifact of run?.publicationArtifacts ?? []) {
      const expectedKeys =
        artifact?.kind === 'family' ? ['artifactId', 'family', 'kind'] : ['artifactId', 'kind'];
      if (
        !ownRecord(artifact) ||
        canonicalJson(Object.keys(artifact).sort()) !== canonicalJson(expectedKeys) ||
        !Number.isSafeInteger(artifact.artifactId) ||
        artifact.artifactId < 1 ||
        !['family', 'production-bytes'].includes(artifact.kind) ||
        (artifact.kind === 'family' && !FAMILY_NAMES.includes(artifact.family)) ||
        artifactIds.has(artifact.artifactId)
      ) {
        findings.push(`run ${String(run?.runId)} publication artifact census is malformed`);
        continue;
      }
      artifactIds.add(artifact.artifactId);
      if (artifact.kind === 'family') {
        const exclusion = excludedArtifactsById.get(artifact.artifactId);
        if (exclusion === undefined) {
          derivedFamilyCandidates.push({
            artifactId: artifact.artifactId,
            family: artifact.family,
            runCreatedAt: run.runCreatedAt,
            runId: run.runId,
          });
        } else if (exclusion.runId === run.runId && exclusion.family === artifact.family) {
          seenExcludedArtifacts.add(artifact.artifactId);
        } else {
          findings.push('excluded family artifact differs from the raw campaign listing');
        }
      } else {
        if (excludedArtifactsById.has(artifact.artifactId)) {
          findings.push('Production bytes artifact is misclassified as excluded family evidence');
        }
        derivedProductionBytes.push({
          artifactId: artifact.artifactId,
          runCreatedAt: run.runCreatedAt,
          runId: run.runId,
        });
      }
    }
  }
  if (
    [...excludedArtifactsById.keys()].some((artifactId) => !seenExcludedArtifacts.has(artifactId))
  ) {
    findings.push('excluded family artifact census invents an unlisted campaign artifact');
  }
  derivedFamilyCandidates.sort(campaignCandidateInventoryOrder);
  derivedProductionBytes.sort(campaignChronologyOrder);
  const familyCandidates = campaign.familyCandidates;
  if (
    !Array.isArray(familyCandidates) ||
    familyCandidates.length < 42 ||
    canonicalJson([...familyCandidates].sort(campaignCandidateInventoryOrder)) !==
      canonicalJson(familyCandidates)
  ) {
    findings.push('family candidate census is incomplete or non-canonical');
  }
  const familyCandidateArtifacts = new Set();
  const familyCandidateExecutions = new Set();
  const familyCandidateRuns = new Set();
  for (const candidate of familyCandidates ?? []) {
    const expectedKeys = [
      'artifactId',
      'cohortDigest',
      'contentDigest',
      'executionDigest',
      'family',
      'hostDigest',
      'runCreatedAt',
      'runId',
    ];
    const runFamily = `${String(candidate?.runId)}:${String(candidate?.family)}`;
    if (
      !ownRecord(candidate) ||
      canonicalJson(Object.keys(candidate).sort()) !== canonicalJson(expectedKeys) ||
      !FAMILY_NAMES.includes(candidate.family) ||
      !Number.isSafeInteger(candidate.artifactId) ||
      candidate.artifactId < 1 ||
      !Number.isSafeInteger(candidate.runId) ||
      !validExactTimestamp(candidate.runCreatedAt) ||
      !DIGEST_PATTERN.test(candidate.cohortDigest ?? '') ||
      !DIGEST_PATTERN.test(candidate.contentDigest ?? '') ||
      !DIGEST_PATTERN.test(candidate.executionDigest ?? '') ||
      !DIGEST_PATTERN.test(candidate.hostDigest ?? '') ||
      familyCandidateArtifacts.has(candidate.artifactId) ||
      familyCandidateExecutions.has(candidate.executionDigest) ||
      familyCandidateRuns.has(runFamily)
    ) {
      findings.push('family candidate reference census is malformed or duplicated');
      continue;
    }
    familyCandidateArtifacts.add(candidate.artifactId);
    familyCandidateExecutions.add(candidate.executionDigest);
    familyCandidateRuns.add(runFamily);
  }
  const familyCandidateListing = (familyCandidates ?? [])
    .map(({ artifactId, family, runCreatedAt, runId }) => ({
      artifactId,
      family,
      runCreatedAt,
      runId,
    }))
    .sort(campaignCandidateInventoryOrder);
  if (canonicalJson(familyCandidateListing) !== canonicalJson(derivedFamilyCandidates)) {
    findings.push('family candidate references omit or invent a campaign artifact');
  }
  const productionBytesCandidates = campaign.productionBytesCandidates;
  if (
    !Array.isArray(productionBytesCandidates) ||
    productionBytesCandidates.length < 1 ||
    canonicalJson([...productionBytesCandidates].sort(campaignChronologyOrder)) !==
      canonicalJson(productionBytesCandidates)
  ) {
    findings.push('Production bytes candidate census is incomplete or non-canonical');
  }
  const productionCandidateArtifacts = new Set();
  const productionCandidateExecutions = new Set();
  const productionCandidateRuns = new Set();
  for (const candidate of productionBytesCandidates ?? []) {
    const expectedKeys = [
      'artifactId',
      'contentDigest',
      'executionDigest',
      'runCreatedAt',
      'runId',
    ];
    if (
      !ownRecord(candidate) ||
      canonicalJson(Object.keys(candidate).sort()) !== canonicalJson(expectedKeys) ||
      !Number.isSafeInteger(candidate.artifactId) ||
      candidate.artifactId < 1 ||
      !Number.isSafeInteger(candidate.runId) ||
      !validExactTimestamp(candidate.runCreatedAt) ||
      !DIGEST_PATTERN.test(candidate.contentDigest ?? '') ||
      !DIGEST_PATTERN.test(candidate.executionDigest ?? '') ||
      familyCandidateArtifacts.has(candidate.artifactId) ||
      familyCandidateExecutions.has(candidate.executionDigest) ||
      productionCandidateArtifacts.has(candidate.artifactId) ||
      productionCandidateExecutions.has(candidate.executionDigest) ||
      productionCandidateRuns.has(candidate.runId)
    ) {
      findings.push('Production bytes candidate reference census is malformed or duplicated');
      continue;
    }
    productionCandidateArtifacts.add(candidate.artifactId);
    productionCandidateExecutions.add(candidate.executionDigest);
    productionCandidateRuns.add(candidate.runId);
  }
  const productionCandidateListing = (productionBytesCandidates ?? []).map(
    candidateChronologyIdentity,
  );
  if (canonicalJson(productionCandidateListing) !== canonicalJson(derivedProductionBytes)) {
    findings.push('Production bytes candidate references omit or invent a campaign artifact');
  }
  if (
    !Array.isArray(campaign.productionBytes) ||
    campaign.productionBytes.length < 1 ||
    canonicalJson([...campaign.productionBytes].sort(campaignChronologyOrder)) !==
      canonicalJson(campaign.productionBytes) ||
    canonicalJson(campaign.selectedProductionBytes) !==
      canonicalJson(campaign.productionBytes[0]) ||
    canonicalJson(campaign.productionBytes) !== canonicalJson(derivedProductionBytes)
  ) {
    findings.push('Production bytes chronology or earliest selection is malformed');
  }
  if (
    !ownRecord(campaign.cohortSelections) ||
    Object.entries(campaign.cohortSelections).some(
      ([family, selector]) =>
        !FAMILY_NAMES.includes(family) || !DIGEST_PATTERN.test(selector ?? ''),
    )
  ) {
    findings.push('cohort selections are malformed');
  }
  let derivedFamilySelection;
  try {
    derivedFamilySelection = selectAggregateCampaignFamilies(
      familyCandidates ?? [],
      campaign.cohortSelections ?? {},
    );
  } catch (error) {
    findings.push(error instanceof Error ? error.message : String(error));
  }
  if (
    !ownRecord(campaign.selectedFamilies) ||
    canonicalJson(Object.keys(campaign.selectedFamilies).sort()) !==
      canonicalJson([...FAMILY_NAMES].sort())
  ) {
    findings.push('selected family census is incomplete');
  }
  for (const familyName of FAMILY_NAMES) {
    const selectedCandidates = campaign.selectedFamilies?.[familyName];
    if (
      !Array.isArray(selectedCandidates) ||
      selectedCandidates.length !== 6 ||
      canonicalJson(selectedCandidates) !== canonicalJson(derivedFamilySelection?.[familyName])
    ) {
      findings.push(`${familyName} selection is not the campaign-derived first five plus sixth`);
      continue;
    }
    const evidence = publication?.families?.[familyName]?.evidence;
    if (ownRecord(evidence)) {
      const selectedEvidence = [
        ...(Array.isArray(evidence.baseline) ? evidence.baseline : []),
        evidence.holdout,
      ];
      for (let index = 0; index < 6; index += 1) {
        const candidate = selectedCandidates[index];
        const reference = selectedEvidence[index];
        if (
          candidate.artifactId !== reference?.artifactId ||
          candidate.runId !== reference?.workflowRunId ||
          candidate.executionDigest !== reference?.execution ||
          candidate.contentDigest !== reference?.reportContentDigest
        ) {
          findings.push(`${familyName} selected evidence differs from campaign candidate custody`);
        }
      }
    }
  }
  const selected = campaign.selectedProductionBytes;
  const evidence = publication?.productionBytes?.evidence;
  if (
    ownRecord(evidence) &&
    (selected?.artifactId !== evidence.artifactId || selected?.runId !== evidence.workflowRunId)
  ) {
    findings.push('earliest Production bytes selection differs from publication evidence');
  }
  if (
    ownRecord(evidence) &&
    productionBytesCandidates?.[0]?.executionDigest !== evidence.execution
  ) {
    findings.push('Production bytes candidate execution differs from publication evidence');
  }
  if (
    ownRecord(evidence) &&
    productionBytesCandidates?.[0]?.contentDigest !== evidence.reportContentDigest
  ) {
    findings.push('Production bytes candidate content differs from publication evidence');
  }
  for (const digestField of [
    'workflowRunsApiAuthorityDigest',
    'workflowRunsApiResponseDigest',
    'liveWorkflowRunsApiResponseDigest',
  ]) {
    if (!DIGEST_PATTERN.test(campaign[digestField] ?? '')) {
      findings.push(`${digestField} is unavailable`);
    }
  }
  for (const run of campaign.runs ?? []) {
    if (
      !Number.isSafeInteger(run?.runId) ||
      !validExactTimestamp(run?.runCreatedAt) ||
      !Array.isArray(run?.publicationArtifacts) ||
      !DIGEST_PATTERN.test(run?.artifactsApiAuthorityDigest ?? '') ||
      !DIGEST_PATTERN.test(run?.artifactsApiResponseDigest ?? '') ||
      !DIGEST_PATTERN.test(run?.liveArtifactsApiResponseDigest ?? '') ||
      !DIGEST_PATTERN.test(run?.runApiAuthorityDigest ?? '') ||
      !DIGEST_PATTERN.test(run?.runApiResponseDigest ?? '')
    ) {
      findings.push(`run ${String(run?.runId)} authenticated chronology is malformed`);
    }
  }
  return [...new Set(findings)].sort();
}

function selectAggregateCampaignFamilies(candidates, cohortSelections) {
  const result = {};
  for (const familyName of FAMILY_NAMES) {
    const groups = new Map();
    for (const candidate of candidates.filter((entry) => entry.family === familyName)) {
      const members = groups.get(candidate.cohortDigest) ?? [];
      members.push(candidate);
      groups.set(candidate.cohortDigest, members);
    }
    const qualifying = [...groups.entries()]
      .map(([digest, members]) => [digest, [...members].sort(campaignChronologyOrder)])
      .filter(([, members]) => members.length >= 6)
      .sort(([left], [right]) => left.localeCompare(right));
    const selector = cohortSelections[familyName];
    if (qualifying.length === 0) {
      throw new TypeError(`${familyName} has no authenticated six-run campaign cohort`);
    }
    if (qualifying.length === 1 && selector !== undefined) {
      throw new TypeError(`${familyName} cohort selector is unnecessary for one qualifying cohort`);
    }
    if (qualifying.length > 1 && selector === undefined) {
      throw new TypeError(`${familyName} has multiple qualifying cohorts without explicit choice`);
    }
    const eligible =
      selector === undefined
        ? qualifying
        : qualifying.filter(
            ([digest, members]) => digest === selector || members[0]?.hostDigest === selector,
          );
    if (eligible.length !== 1) {
      throw new TypeError(`${familyName} cohort selector does not identify one qualifying cohort`);
    }
    result[familyName] = eligible[0][1].slice(0, 6);
  }
  return result;
}

function authenticatedInputFindings(authenticated) {
  const findings = [];
  if (!ownRecord(authenticated) || authenticated.repository !== PERF_PUBLICATION_REPOSITORY) {
    findings.push('authenticated publication repository is unavailable');
  }
  if (
    canonicalJson(Object.keys(authenticated?.families ?? {}).sort()) !==
    canonicalJson([...FAMILY_NAMES].sort())
  ) {
    findings.push('authenticated publication family census is incomplete');
  }
  for (const familyName of FAMILY_NAMES) {
    if (!validAuthenticatedFamily(authenticated?.families?.[familyName])) {
      findings.push(`${familyName} authenticated evidence is incomplete`);
    }
  }
  if (!ownRecord(authenticated?.productionBytes)) {
    findings.push('authenticated Production bytes evidence is unavailable');
  } else {
    findings.push(
      ...productionBytesReportFindings(authenticated.productionBytes.report).map(
        (finding) => `Production bytes ${finding}`,
      ),
      ...productionBytesBudgetFindings(authenticated.productionBytes.budgets).map(
        (finding) => `Production bytes ${finding}`,
      ),
      ...productionBytesBudgetCustodyFindings(
        authenticated.productionBytes,
        authenticated.productionBytes.report?.source?.commit,
      ).map((finding) => `Production bytes ${finding}`),
    );
  }
  findings.push(
    ...campaignPublicationFindings(authenticated?.campaign, {
      families: Object.fromEntries(
        FAMILY_NAMES.map((familyName) => [
          familyName,
          {
            evidence: {
              baseline: (authenticated?.families?.[familyName]?.baseline ?? []).map(
                evidenceReference,
              ),
              holdout: ownRecord(authenticated?.families?.[familyName]?.holdout)
                ? evidenceReference(authenticated.families[familyName].holdout)
                : null,
            },
          },
        ]),
      ),
      identity: { sourceCommit: authenticated?.productionBytes?.report?.source?.commit },
      productionBytes: {
        evidence: {
          artifactId: authenticated?.productionBytes?.custody?.artifactId,
          execution: authenticated?.productionBytes?.report?.execution?.digest,
          reportContentDigest: authenticated?.productionBytes?.contentDigest,
          workflowRunId: authenticated?.productionBytes?.custody?.workflowRunId,
        },
      },
    }).map((finding) => `campaign ${finding}`),
  );
  return findings;
}

function buildProfileEntrySetFindings(entries) {
  if (!Array.isArray(entries) || ![0, 2].includes(entries.length)) {
    return ['authenticated build profile census must be empty or exactly unchanged and edit'];
  }
  const findings = [];
  const modes = new Set();
  for (const [index, entry] of entries.entries()) {
    const mode = entry?.report?.subject?.mode;
    if (!BUILD_PROFILE_MODES.includes(mode) || modes.has(mode)) {
      findings.push(`build profile[${String(index)}] mode is unavailable or duplicated`);
      continue;
    }
    modes.add(mode);
    findings.push(...buildProfilePublicationFindings(entry, mode));
  }
  if (
    entries.length === 2 &&
    canonicalJson([...modes].sort((left, right) => left.localeCompare(right))) !==
      canonicalJson([...BUILD_PROFILE_MODES].sort((left, right) => left.localeCompare(right)))
  ) {
    findings.push('authenticated build profile modes are incomplete');
  }
  if (entries.length === 2 && modes.size === 2) {
    const [first, second] = entries;
    for (const field of [
      'apiAuthorityDigest',
      'apiUrl',
      'archiveByteLength',
      'archiveDigest',
      'archiveDownloadUrl',
      'artifactDigest',
      'artifactId',
      'artifactName',
      'artifactSizeInBytes',
      'createdAt',
      'expiresAt',
      'jobsApiAuthorityDigest',
      'jobsApiUrl',
      'location',
      'runApiAuthorityDigest',
      'runApiUrl',
      'runUrl',
      'updatedAt',
      'workflowApiResponseDigest',
      'workflowRunId',
    ]) {
      if (canonicalJson(first?.custody?.[field]) !== canonicalJson(second?.custody?.[field])) {
        findings.push(`build profile modes do not share one ${field}`);
      }
    }
    if (
      canonicalJson(first?.custody?.archiveMembers) !==
        canonicalJson(second?.custody?.archiveMembers) ||
      canonicalJson(first?.custody?.workflow) !== canonicalJson(second?.custody?.workflow)
    ) {
      findings.push('build profile modes do not share one archive and workflow authority');
    }
    if (
      first?.report?.execution?.digest !== second?.report?.execution?.digest ||
      first?.report?.source?.commit !== second?.report?.source?.commit ||
      canonicalJson(first?.report?.source?.locks) !==
        canonicalJson(second?.report?.source?.locks) ||
      first?.report?.host?.digest !== second?.report?.host?.digest ||
      first?.report?.workloadIdentity?.digest !== second?.report?.workloadIdentity?.digest
    ) {
      findings.push('build profile modes do not share one execution, source, host, and workload');
    }
    const declaredMembers = entries.flatMap((entry) => entry?.report?.artifactMembers ?? []);
    const expectedMembers = [...declaredMembers].sort((left, right) =>
      String(left).localeCompare(String(right)),
    );
    const archiveMembers = first?.custody?.archiveMembers ?? [];
    const observedMembers = archiveMembers.map((member) => member?.member);
    if (
      expectedMembers.length === 0 ||
      new Set(expectedMembers).size !== expectedMembers.length ||
      canonicalJson(observedMembers) !== canonicalJson(expectedMembers)
    ) {
      findings.push('build profile ZIP census differs from the exact two-mode declared union');
    }
    const archiveByMember = new Map(archiveMembers.map((member) => [member?.member, member]));
    for (const entry of entries) {
      const reportMember = entry?.custody?.reportMember;
      if (
        archiveByMember.get(reportMember)?.contentDigest !== entry?.contentDigest ||
        archiveByMember.get(reportMember)?.byteLength !==
          (typeof entry?.rawText === 'string' ? Buffer.byteLength(entry.rawText, 'utf8') : -1)
      ) {
        findings.push('build profile report member differs from the shared ZIP census');
      }
    }
  }
  return [...new Set(findings)].sort();
}

function validAuthenticatedFamily(value) {
  return (
    ownRecord(value) &&
    Array.isArray(value.baseline) &&
    value.baseline.length === 5 &&
    ownRecord(value.holdout)
  );
}

function familyEntries(authenticated) {
  return FAMILY_NAMES.flatMap((name) => {
    const family = authenticated?.families?.[name];
    return validAuthenticatedFamily(family) ? [...family.baseline, family.holdout] : [];
  });
}

function familyConfig(value) {
  return Object.freeze({
    ...value,
    targetKinds: Object.freeze([...value.targetKinds]),
    workflowJob: Object.freeze({
      ...value.workflowJob,
      artifact: Object.freeze({ ...value.workflowJob.artifact }),
    }),
  });
}

function workflowJob({ artifactName, artifactPath, key, name }) {
  return {
    artifact: { name: artifactName, path: artifactPath },
    key,
    name,
    triggerPolicy: 'baseline',
  };
}

function validOperation(value) {
  return (
    ownRecord(value) &&
    typeof value.baselineFindings === 'function' &&
    typeof value.derive === 'function' &&
    typeof value.evaluate === 'function' &&
    typeof value.budgetFindings === 'function' &&
    Array.isArray(value.targetKinds)
  );
}

function unavailableFamilySummary(familyName) {
  return {
    architecture: FAMILY_CONFIG[familyName].architecture,
    comparisonPosture: FAMILY_CONFIG[familyName].comparisonPosture,
    documents: null,
    evidence: null,
    host: null,
    holdoutEvaluation: null,
    status: 'unproven',
    targetAssessment: null,
    workload: null,
  };
}

function targetAssessmentFindings(value, familyName) {
  const findings = [];
  if (!ownRecord(value) || !['pass', 'fail', 'unproven'].includes(value.status)) {
    return [`${familyName} target assessment is unavailable`];
  }
  if (
    canonicalJson(Object.keys(value).sort()) !==
    canonicalJson(
      [
        'baseline',
        'blockingFailures',
        'blockingStatus',
        'failures',
        'followOnFailures',
        'followOnStatus',
        'holdout',
        'reasons',
        'status',
      ].sort(),
    )
  ) {
    findings.push(`${familyName} combined target assessment field census differs from policy`);
  }
  const assessments = {};
  for (const phase of ['baseline', 'holdout']) {
    const assessment = value[phase];
    if (
      !ownRecord(assessment) ||
      !Array.isArray(assessment.checks) ||
      assessment.checks.length === 0
    ) {
      findings.push(`${familyName} ${phase} target assessment is empty`);
      continue;
    }
    if (
      canonicalJson(Object.keys(assessment).sort()) !==
      canonicalJson(
        [
          'blockingFailures',
          'blockingStatus',
          'checks',
          'failures',
          'followOnFailures',
          'followOnStatus',
          'status',
        ].sort(),
      )
    ) {
      findings.push(`${familyName} ${phase} target assessment field census differs from policy`);
    }
    const checkIds = new Set();
    for (const check of assessment.checks) {
      if (
        !nonEmptyString(check?.id) ||
        !nonEmptyString(check?.kind) ||
        !['<=', '>='].includes(check?.operator) ||
        !Number.isFinite(check?.limit) ||
        !['pass', 'fail'].includes(check?.status) ||
        check?.publicationImpact !== targetPublicationImpact(check?.kind) ||
        checkIds.has(check?.id)
      ) {
        findings.push(`${familyName} ${phase} target check is malformed or duplicated`);
        continue;
      }
      checkIds.add(check.id);
      const expectedStatus =
        Number.isFinite(check.observed) &&
        (check.operator === '<=' ? check.observed <= check.limit : check.observed >= check.limit)
          ? 'pass'
          : 'fail';
      if (check.status !== expectedStatus) {
        findings.push(`${familyName} ${phase} target check ${check.id} status is not derived`);
      }
    }
    if (familyName === 'browser' || familyName === 'server') {
      const expectedCensus = comparisonTargetCheckSpecifications(familyName).map(
        ({ id, kind, limit, operator }) => ({ id, kind, limit, operator }),
      );
      const observedCensus = assessment.checks.map((check) => ({
        id: check?.id,
        kind: check?.kind,
        limit: check?.limit,
        operator: check?.operator,
      }));
      if (canonicalJson(observedCensus) !== canonicalJson(expectedCensus)) {
        findings.push(`${familyName} ${phase} target check census differs from policy`);
      }
    } else if (familyName.startsWith('dev-')) {
      const expectedCensus = devTargetCheckSpecifications(familyName);
      const observedCensus = assessment.checks.map((check) => ({
        id: check?.id,
        kind: check?.kind,
        operator: check?.operator,
      }));
      if (
        canonicalJson(observedCensus) !==
        canonicalJson(expectedCensus.map(({ id, kind, operator }) => ({ id, kind, operator })))
      ) {
        findings.push(`${familyName} ${phase} target check census differs from policy`);
      }
      for (const specification of expectedCensus) {
        if (!Number.isFinite(specification.limit)) continue;
        const observed = assessment.checks.find((check) => check?.id === specification.id);
        if (observed?.limit !== specification.limit) {
          findings.push(`${familyName} ${phase} target check limits differ from policy`);
        }
      }
    } else if (familyName.startsWith('build-')) {
      const expectedCensus = buildTargetCheckSpecifications(familyName);
      const observedCensus = assessment.checks.map((check) => ({
        id: check?.id,
        kind: check?.kind,
        limit: check?.limit,
        operator: check?.operator,
      }));
      if (canonicalJson(observedCensus) !== canonicalJson(expectedCensus)) {
        findings.push(`${familyName} ${phase} target check census differs from policy`);
      }
    } else if (familyName === 'check') {
      const expectedCensus = checkTargetCheckSpecifications(phase);
      const observedCensus = assessment.checks.map((check) => ({
        id: check?.id,
        kind: check?.kind,
        limit: check?.limit,
        operator: check?.operator,
      }));
      if (canonicalJson(observedCensus) !== canonicalJson(expectedCensus)) {
        findings.push(`${familyName} ${phase} target check census differs from policy`);
      }
    }
    let expectedAssessment;
    try {
      expectedAssessment = assessmentFromChecks(
        assessment.checks.map(({ id, kind, limit, observed, operator, status }) => ({
          id,
          kind,
          limit,
          observed,
          operator,
          status,
        })),
      );
    } catch {
      findings.push(`${familyName} ${phase} target verdict is not derived from its checks`);
      continue;
    }
    if (canonicalJson(assessment) !== canonicalJson(expectedAssessment)) {
      findings.push(`${familyName} ${phase} target verdict is not derived from its checks`);
    }
    assessments[phase] = expectedAssessment;
  }
  if (assessments.baseline && assessments.holdout) {
    const expected = combineTargetAssessments(assessments.baseline, assessments.holdout);
    if (
      canonicalJson({
        blockingFailures: value.blockingFailures,
        blockingStatus: value.blockingStatus,
        failures: value.failures,
        followOnFailures: value.followOnFailures,
        followOnStatus: value.followOnStatus,
        reasons: value.reasons,
        status: value.status,
      }) !==
      canonicalJson({
        blockingFailures: expected.blockingFailures,
        blockingStatus: expected.blockingStatus,
        failures: expected.failures,
        followOnFailures: expected.followOnFailures,
        followOnStatus: expected.followOnStatus,
        reasons: expected.reasons,
        status: expected.status,
      })
    ) {
      findings.push(`${familyName} combined target verdict is not derived from both phases`);
    }
  }
  return findings;
}

function devTargetCheckSpecifications(familyName) {
  const corpusSize = familyName === 'dev-n24' ? 24 : familyName === 'dev-n216' ? 216 : null;
  const prefix = `corpus-n${String(corpusSize)}/dev//`;
  return [
    ...DEV_PERFORMANCE_METRICS.flatMap((suffix) => {
      const metric = `${prefix}${suffix}`;
      return [
        { id: `${metric}.median`, kind: 'regression', operator: '<=' },
        { id: `${metric}.p95`, kind: 'regression', operator: '<=' },
      ];
    }),
    {
      id: `${prefix}ready.durationMs.median-vs-next`,
      kind: 'competitive-target',
      limit: 2,
      operator: '<=',
    },
    {
      id: `${prefix}edit.leafMs.median-vs-next`,
      kind: 'competitive-target',
      limit: 2,
      operator: '<=',
    },
    {
      id: `${prefix}edit.entryMs.median-vs-next`,
      kind: 'competitive-target',
      limit: 3,
      operator: '<=',
    },
    {
      id: `${prefix}edit.syntaxErrorMs.p95-target`,
      kind: 'target',
      limit: 1_000,
      operator: '<=',
    },
    {
      id: `${prefix}edit.recoveryMs.p95-target`,
      kind: 'target',
      limit: 2_000,
      operator: '<=',
    },
  ];
}

function buildTargetCheckSpecifications(familyName) {
  const corpusSize = familyName === 'build-n24' ? 24 : familyName === 'build-n216' ? 216 : null;
  return BUILD_MODES.flatMap((mode) => {
    const prefix = `corpus-n${String(corpusSize)}/build/${mode}/`;
    return [
      {
        id: `${prefix}durationMs.median-vs-next`,
        kind: 'milestone',
        limit: 6,
        operator: '<=',
      },
      {
        id: `${prefix}peakRssBytes.median-vs-next`,
        kind: 'milestone',
        limit: 2,
        operator: '<=',
      },
    ];
  });
}

function checkTargetCheckSpecifications(phase) {
  const suffix = phase === 'baseline' ? 'ratified-p95-target' : 'absolute-target';
  return [
    ['check.appSourceTrust.marginalScalingExponent', 1.3],
    ['check.peakRssBytes', 3 * 1024 ** 3],
    ['check.total.marginalScalingExponent', 1],
  ].map(([metric, limit]) => ({
    id: `${metric}.${suffix}`,
    kind: 'target',
    limit,
    operator: '<=',
  }));
}

function evaluationReferenceFindings(value, familyName, targetAssessment) {
  if (!ownRecord(value) || !['pass', 'regression', 'unproven'].includes(value.status)) {
    return [`${familyName} holdout evaluation summary is unavailable`];
  }
  const findings = [];
  if (
    canonicalJson(Object.keys(value).sort()) !==
    canonicalJson(
      ['blockingFailures', 'candidate', 'failures', 'followOnFailures', 'reasons', 'status'].sort(),
    )
  ) {
    findings.push(`${familyName} holdout evaluation summary field census differs from policy`);
  }
  const failures = Array.isArray(value.failures) ? value.failures : [];
  const reasons = Array.isArray(value.reasons) ? value.reasons : [];
  for (const field of ['blockingFailures', 'failures', 'followOnFailures', 'reasons']) {
    if (
      !Array.isArray(value[field]) ||
      value[field].some((item) => !nonEmptyString(item)) ||
      canonicalJson(value[field]) !== canonicalJson(sortedUniqueStrings(value[field] ?? []))
    ) {
      findings.push(`${familyName} holdout evaluation ${field} are malformed`);
    }
  }
  if (
    !DIGEST_PATTERN.test(value.candidate?.execution ?? '') ||
    !COMMIT_PATTERN.test(value.candidate?.sourceCommit ?? '')
  ) {
    findings.push(`${familyName} holdout evaluation candidate identity is unavailable`);
  }
  if (
    (value.status === 'pass' && (failures.length > 0 || reasons.length > 0)) ||
    (value.status === 'regression' && (failures.length === 0 || reasons.length > 0)) ||
    (value.status === 'unproven' && reasons.length === 0)
  ) {
    findings.push(`${familyName} holdout evaluation verdict is internally inconsistent`);
  }
  const expectedPartitions = evaluationFailurePartitions(failures, targetAssessment);
  if (
    canonicalJson(value.blockingFailures) !== canonicalJson(expectedPartitions.blockingFailures) ||
    canonicalJson(value.followOnFailures) !== canonicalJson(expectedPartitions.followOnFailures)
  ) {
    findings.push(
      `${familyName} holdout evaluation blocking/follow-on partition is not derived from policy`,
    );
  }
  return findings;
}

function productionBytesAssessmentFindings(value, publication) {
  if (!ownRecord(value)) return ['Production bytes assessment is unavailable'];
  const findings = [];
  const expectedKeys = [
    'budget',
    'componentCount',
    'evidence',
    'failures',
    'host',
    'metricVerdicts',
    'reasons',
    'status',
    'workload',
  ];
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson(expectedKeys)) {
    findings.push('Production bytes assessment field census differs');
  }
  if (value.componentCount !== PRODUCTION_BYTES_CONFIG.componentCount) {
    findings.push('Production bytes componentCount differs from policy');
  }
  const reasons = value.reasons;
  if (
    !Array.isArray(reasons) ||
    reasons.some((reason) => !nonEmptyString(reason)) ||
    canonicalJson(reasons) !== canonicalJson(sortedUniqueStrings(reasons ?? []))
  ) {
    findings.push('Production bytes reasons are malformed');
  }
  const metrics = Array.isArray(value.metricVerdicts) ? value.metricVerdicts : [];
  const metricIds = metrics.map(({ metricId }) => metricId);
  const exactMetricCensus =
    canonicalJson(metricIds) === canonicalJson([...PRODUCTION_BYTES_METRICS].sort());
  if ((reasons?.length ?? 0) === 0 && !exactMetricCensus) {
    findings.push('Production bytes verdict does not contain the exact five metrics');
  }
  for (const metric of metrics) {
    if (
      !ownRecord(metric) ||
      canonicalJson(Object.keys(metric).sort()) !==
        canonicalJson(['budget', 'metricId', 'reason', 'status', 'value']) ||
      !PRODUCTION_BYTES_METRICS.includes(metric.metricId) ||
      !Number.isSafeInteger(metric.budget) ||
      metric.budget < 0 ||
      !Number.isSafeInteger(metric.value) ||
      metric.value < 0 ||
      metric.reason !== null ||
      metric.status !== (metric.value <= metric.budget ? 'pass' : 'fail')
    ) {
      findings.push(`Production bytes metric ${String(metric?.metricId)} verdict is malformed`);
    }
  }
  const expectedFailures = metrics
    .filter(({ status }) => status === 'fail')
    .map(({ metricId }) => metricId)
    .sort();
  if (canonicalJson(value.failures) !== canonicalJson(expectedFailures)) {
    findings.push('Production bytes failures are not derived from metric verdicts');
  }
  const expectedStatus =
    (reasons?.length ?? 0) > 0 ? 'unproven' : expectedFailures.length > 0 ? 'blocked' : 'pass';
  if (value.status !== expectedStatus) {
    findings.push('Production bytes status is not derived from its evidence and metrics');
  }
  if (value.status !== 'unproven') {
    if (
      !ownRecord(value.budget) ||
      value.budget.path !== 'perf-budgets.json' ||
      value.budget.schema !== PERF_BUDGETS_SCHEMA ||
      value.budget.sourceCommit !== publication.identity?.sourceCommit ||
      !Number.isSafeInteger(value.budget.byteLength) ||
      value.budget.byteLength < 1 ||
      !DIGEST_PATTERN.test(value.budget.contentDigest ?? '')
    ) {
      findings.push('Production bytes committed budget identity is malformed or unbound');
    }
    findings.push(
      ...evidenceReferenceFindings(
        value.evidence,
        'Production bytes',
        PRODUCTION_BYTES_CONFIG,
        publication,
        value,
        {
          allowedJobConclusions: ['failure', 'success'],
          allowedJobFailureStep: PRODUCTION_BYTES_CONFIG.budgetFailureStep,
          requiredJobSuccessSteps: PRODUCTION_BYTES_CONFIG.budgetFailureSuccessSteps,
          triggerPolicy: 'production-bytes',
          triggerScopes: PRODUCTION_BYTES_TRIGGER_SCOPES,
        },
      ),
    );
  }
  return [...new Set(findings)].sort();
}

function evidenceReferenceFindings(
  value,
  label,
  config,
  publication,
  family,
  {
    allowedJobConclusions = ['success'],
    allowedJobFailureStep = null,
    requiredJobSuccessSteps = [],
    triggerPolicy = 'baseline',
    triggerScopes = BASELINE_TRIGGER_SCOPES,
  } = {},
) {
  if (!ownRecord(value)) return [`${label} evidence reference is unavailable`];
  const findings = [];
  for (const field of [
    'apiAuthorityDigest',
    'apiResponseDigest',
    'archiveDigest',
    'jobsApiAuthorityDigest',
    'jobsApiResponseDigest',
    'liveApiResponseDigest',
    'liveApiAuthorityDigest',
    'liveJobsApiResponseDigest',
    'liveJobsApiAuthorityDigest',
    'liveRunApiResponseDigest',
    'liveRunApiAuthorityDigest',
    'reportContentDigest',
    'runApiAuthorityDigest',
    'runApiResponseDigest',
    'workflowApiResponseDigest',
    'execution',
    'host',
    'workload',
  ]) {
    if (!DIGEST_PATTERN.test(value[field] ?? '')) findings.push(`${label} ${field} is malformed`);
  }
  if (value.liveApiAuthorityDigest !== value.apiAuthorityDigest) {
    findings.push(`${label} saved and live artifact authority projections differ`);
  }
  if (value.liveJobsApiAuthorityDigest !== value.jobsApiAuthorityDigest) {
    findings.push(`${label} saved and live workflow jobs authority projections differ`);
  }
  if (value.liveRunApiAuthorityDigest !== value.runApiAuthorityDigest) {
    findings.push(`${label} saved and live workflow run authority projections differ`);
  }
  if (!COMMIT_PATTERN.test(value.sourceCommit ?? '')) {
    findings.push(`${label} source commit is malformed`);
  }
  if (!Number.isSafeInteger(value.artifactId) || value.artifactId < 1) {
    findings.push(`${label} artifact ID is malformed`);
  }
  if (
    !DIGEST_PATTERN.test(value.artifactDigest ?? '') ||
    value.artifactDigest !== value.archiveDigest ||
    !Number.isSafeInteger(value.archiveByteLength) ||
    value.archiveByteLength < 1 ||
    value.artifactSizeInBytes !== value.archiveByteLength
  ) {
    findings.push(`${label} local ZIP identity differs from GitHub artifact authority`);
  }
  if (!Number.isSafeInteger(value.workflowRunId) || value.workflowRunId < 1) {
    findings.push(`${label} workflow run ID is malformed`);
  }
  const apiUrl = `https://api.github.com/repos/${PERF_PUBLICATION_REPOSITORY}/actions/artifacts/${String(value.artifactId)}`;
  const runApiUrl = `https://api.github.com/repos/${PERF_PUBLICATION_REPOSITORY}/actions/runs/${String(value.workflowRunId)}`;
  const jobsApiUrl = `${runApiUrl}/jobs?filter=all&per_page=100`;
  const runUrl = `https://github.com/${PERF_PUBLICATION_REPOSITORY}/actions/runs/${String(value.workflowRunId)}`;
  if (
    value.apiUrl !== apiUrl ||
    value.archiveDownloadUrl !== `${apiUrl}/zip` ||
    value.jobsApiUrl !== jobsApiUrl ||
    value.runApiUrl !== runApiUrl ||
    value.runUrl !== runUrl ||
    value.location !== `${runUrl}/artifacts/${String(value.artifactId)}`
  ) {
    findings.push(`${label} artifact URLs are not derived from canonical IDs`);
  }
  if (value.artifactName !== config.artifactName || value.reportMember !== config.reportMember) {
    findings.push(`${label} artifact name or report member differs from policy`);
  }
  const archiveFindings = archiveMemberCensusFindings(value.archiveMembers);
  const reportArchiveMember = value.archiveMembers?.[0];
  if (
    archiveFindings.length > 0 ||
    value.archiveMembers?.length !== 1 ||
    reportArchiveMember?.member !== config.reportMember ||
    reportArchiveMember?.contentDigest !== value.reportContentDigest
  ) {
    findings.push(`${label} ZIP member census differs from the exact report artifact`);
  }
  const workflow = value.workflow;
  const expectedTriggerScope = triggerScopes[workflow?.event] ?? null;
  const workflowApiUrl = `https://api.github.com/repos/${PERF_PUBLICATION_REPOSITORY}/contents/${PERF_REALISTIC_WORKFLOW_PATH}?ref=${String(workflow?.workflowSha)}`;
  if (
    !ownRecord(workflow) ||
    workflow.name !== 'Perf Realistic Tier' ||
    workflow.path !== PERF_REALISTIC_WORKFLOW_PATH ||
    workflow.status !== 'completed' ||
    workflow.triggerPolicy !== triggerPolicy ||
    workflow.sourceSha !== value.sourceCommit ||
    !COMMIT_PATTERN.test(workflow.headSha ?? '') ||
    workflow.headSha !== value.sourceCommit ||
    !COMMIT_PATTERN.test(workflow.workflowSha ?? '') ||
    (workflow.event !== 'pull_request' && workflow.workflowSha !== value.sourceCommit) ||
    !validWorkflowReference(workflow.workflowRef) ||
    !Number.isSafeInteger(workflow.runAttempt) ||
    workflow.runAttempt < 1 ||
    workflow.runApiUrl !== runApiUrl ||
    workflow.jobsApiUrl !== jobsApiUrl ||
    workflow.workflowApiUrl !== workflowApiUrl ||
    workflow.workflowHeadSha !== workflow.workflowSha ||
    !workflowArtifactUploadMatches(
      workflow.artifactUpload,
      config.workflowJob,
      config.artifactName,
    ) ||
    !DIGEST_PATTERN.test(workflow.workflowContentDigest ?? '') ||
    !GIT_BLOB_PATTERN.test(workflow.workflowGitBlobSha ?? '') ||
    expectedTriggerScope === null ||
    workflow.triggerScope !== expectedTriggerScope
  ) {
    findings.push(`${label} live workflow authority differs from ${triggerPolicy} policy`);
  }
  const job = workflow?.job;
  const requiredSuccessSteps = Array.isArray(job?.requiredSuccessSteps)
    ? job.requiredSuccessSteps
    : [];
  const validRequiredSuccessSteps =
    requiredSuccessSteps.length === requiredJobSuccessSteps.length &&
    requiredSuccessSteps.every(
      (step, index) =>
        ownRecord(step) &&
        canonicalJson(Object.keys(step).sort()) ===
          canonicalJson(['conclusion', 'name', 'number', 'status']) &&
        step.conclusion === 'success' &&
        step.name === requiredJobSuccessSteps[index] &&
        Number.isSafeInteger(step.number) &&
        step.number > 0 &&
        step.status === 'completed',
    );
  const validFailureStep =
    job?.conclusion === 'failure' &&
    ownRecord(job?.failureStep) &&
    canonicalJson(Object.keys(job.failureStep).sort()) ===
      canonicalJson(['conclusion', 'name', 'number', 'status']) &&
    job.failureStep.conclusion === 'failure' &&
    job.failureStep.name === allowedJobFailureStep &&
    Number.isSafeInteger(job.failureStep.number) &&
    job.failureStep.number > 0 &&
    job.failureStep.status === 'completed' &&
    validRequiredSuccessSteps &&
    requiredSuccessSteps.length === 2 &&
    requiredSuccessSteps[0].number < job.failureStep.number &&
    job.failureStep.number < requiredSuccessSteps[1].number;
  if (
    !ownRecord(job) ||
    job.key !== config.workflowJob.key ||
    job.name !== config.workflowJob.name ||
    job.status !== 'completed' ||
    !allowedJobConclusions.includes(job.conclusion) ||
    (job.conclusion === 'failure' && !validFailureStep) ||
    (job.conclusion === 'success' &&
      allowedJobFailureStep !== null &&
      (job.failureStep !== null ||
        !Array.isArray(job.requiredSuccessSteps) ||
        requiredSuccessSteps.length !== 0)) ||
    job.runAttempt !== workflow?.runAttempt ||
    !Number.isSafeInteger(job.id) ||
    job.id < 1 ||
    job.apiUrl !==
      `https://api.github.com/repos/${PERF_PUBLICATION_REPOSITORY}/actions/jobs/${String(job.id)}` ||
    !validExactTimestamp(job.startedAt) ||
    !validExactTimestamp(job.completedAt) ||
    Date.parse(job.startedAt) > Date.parse(job.completedAt)
  ) {
    findings.push(`${label} live workflow family job differs from policy`);
  }
  if (
    value.sourceCommit !== publication.identity?.sourceCommit ||
    canonicalJson(value.locks) !== canonicalJson(publication.identity?.locks)
  ) {
    findings.push(`${label} source or dependency locks differ from publication identity`);
  }
  if (value.host !== family.host || value.workload !== family.workload) {
    findings.push(`${label} host or workload differs within its family cohort`);
  }
  const createdAt = Date.parse(value.createdAt ?? '');
  const updatedAt = Date.parse(value.updatedAt ?? '');
  const expiresAt = Date.parse(value.expiresAt ?? '');
  const generatedAt = Date.parse(publication.generatedAt ?? '');
  const liveApiVerifiedAt = Date.parse(value.liveApiVerifiedAt ?? '');
  if (
    ![createdAt, updatedAt, expiresAt, generatedAt, liveApiVerifiedAt].every(Number.isFinite) ||
    createdAt > updatedAt ||
    updatedAt > expiresAt ||
    liveApiVerifiedAt > generatedAt ||
    liveApiVerifiedAt >= expiresAt ||
    generatedAt >= expiresAt
  ) {
    findings.push(`${label} artifact retention timestamps are malformed or expired`);
  }
  return findings;
}

function validDocumentReference(value, familyName, kind) {
  return (
    ownRecord(value) &&
    value.fileName === `${familyName}-${kind}.json` &&
    nonEmptyString(value.schema) &&
    DIGEST_PATTERN.test(value.contentDigest ?? '') &&
    DIGEST_PATTERN.test(value.semanticDigest ?? '')
  );
}

function validWorkflowReference(value) {
  const prefix = `${PERF_PUBLICATION_REPOSITORY}/${PERF_REALISTIC_WORKFLOW_PATH}@`;
  return nonEmptyString(value) && value.startsWith(prefix) && value.length > prefix.length;
}

function workflowArtifactUploadMatches(value, expectedJob, concreteName) {
  return (
    ownRecord(value) &&
    canonicalJson(Object.keys(value).sort()) ===
      canonicalJson(['action', 'concreteName', 'job', 'name', 'path']) &&
    value.action === 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02' &&
    value.concreteName === concreteName &&
    value.job === expectedJob.key &&
    value.name === expectedJob.artifact?.name &&
    value.path === expectedJob.artifact?.path
  );
}

function safeArchiveMemberName(value) {
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

function contextualError(context, error) {
  return new TypeError(`${context}: ${error instanceof Error ? error.message : String(error)}`);
}

function parseOutputJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new TypeError(`${label} is not valid JSON`);
  }
}

function prettyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function code(value) {
  return value === null || value === undefined ? 'unproven' : `\`${String(value)}\``;
}

function formatNumber(value) {
  return Number.isFinite(value)
    ? Number.isInteger(value)
      ? String(value)
      : value.toFixed(4)
    : 'unavailable';
}

function sha256Canonical(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function sha256Bytes(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function ownRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function validExactTimestamp(value) {
  const milliseconds = Date.parse(value ?? '');
  return nonEmptyString(value) && Number.isFinite(milliseconds);
}

function sortedUniqueStrings(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function parseOptions(args) {
  if (args.length % 2 !== 0) throw new TypeError(`incomplete option ${String(args.at(-1))}`);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (
      !['--evidence-dir', '--manifest', '--markdown-out', '--out'].includes(key) ||
      !value ||
      value.startsWith('--') ||
      Object.hasOwn(options, key)
    ) {
      throw new TypeError(`unknown, incomplete, or duplicate option ${String(key)}`);
    }
    options[key] = value;
  }
  return options;
}

function requiredOption(options, key) {
  if (!nonEmptyString(options[key])) throw new TypeError(`${key} is required`);
  return options[key];
}

async function main(args) {
  const options = parseOptions(args);
  const manifestPath = path.resolve(requiredOption(options, '--manifest'));
  const input = JSON.parse(await readFile(manifestPath, 'utf8'));
  const authenticated = await authenticatePerformancePublicationInput(input, {
    baseDirectory: path.dirname(manifestPath),
    manifestPath,
  });
  const result = derivePerformancePublication(authenticated);
  assertPerformancePublicationResult(result, { authenticated });
  await writePerformancePublicationOutputs(result, {
    authenticated,
    evidenceDirectory: requiredOption(options, '--evidence-dir'),
    markdownOut: requiredOption(options, '--markdown-out'),
    out: requiredOption(options, '--out'),
  });
  process.stdout.write(
    `${result.publication.schema} ${result.publication.verdict.status} ${result.publication.digest}\n`,
  );
  for (const reason of result.publication.verdict.reasons) {
    process.stdout.write(`UNPROVEN ${reason}\n`);
  }
  for (const failure of result.publication.verdict.failures) {
    process.stdout.write(`BLOCKED ${failure}\n`);
  }
  process.exitCode =
    result.publication.verdict.status === 'publishable'
      ? 0
      : result.publication.verdict.status === 'blocked'
        ? 1
        : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
