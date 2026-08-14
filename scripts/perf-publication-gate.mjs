#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { authenticatePerformanceArtifactEvidence } from './lib/perf-artifact-custody.mjs';
import { ratifyPerformanceBaseline } from './perf-baseline-ratify.mjs';
import {
  comparisonBudgetFindings,
  deriveComparisonPerformanceBudget,
  evaluateComparisonPerformanceBudget,
} from './perf-comparison-budget.mjs';
import {
  assessBuildForegroundSession,
  buildPersistenceAssessmentFindings,
  buildBudgetFindings,
  deriveBuildPerformanceBudget,
  evaluateBuildPerformanceBudget,
} from './perf-build-budget.mjs';
import {
  checkBudgetFindings,
  deriveCheckPerformanceBudget,
  evaluateCheckPerformanceBudget,
} from './perf-check-budget.mjs';
import {
  deriveDevPerformanceBudget,
  devBudgetFindings,
  evaluateDevPerformanceBudget,
} from './perf-dev-budget.mjs';
import { canonicalJson } from './perf-regression-check.mjs';

export const PERF_PUBLICATION_INPUT_SCHEMA = 'kovo-performance-publication-input/v1';
export const PERF_PUBLICATION_SCHEMA = 'kovo-performance-publication/v1';
export const PERF_PUBLICATION_REPOSITORY = 'kovojs/kovo';

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const REQUIRED_LOCKS = Object.freeze([
  'pnpm-lock.yaml',
  'benchmarks/nextjs/pnpm-lock.yaml',
  'benchmarks/harness/pnpm-lock.yaml',
]);
const BUILD_MODES = Object.freeze(['clean', 'unchanged', 'edit']);
const BUILD_PROFILE_MODES = Object.freeze(['unchanged', 'edit']);
const BUILD_PROFILE_ARTIFACT_NAME = 'kovo-perf-build-profile-n216';
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
      'Default/as-shipped, matched L0, and matched L1 remain separate. Inert L0 documents retain zero JavaScript; same-document and document-replacing navigation are not conflated.',
    artifactName: 'kovo-perf-browser-matrix',
    budgetFindings: comparisonBudgetFindings,
    comparisonPosture: 'kovo-vs-next',
    derive: deriveComparisonPerformanceBudget,
    evaluate: evaluateComparisonPerformanceBudget,
    reportMember: 'comparison.json',
    targetKinds: ['target'],
  }),
  'dev-n24': familyConfig({
    architecture:
      'The generated N=24 corpus is capability matched. Ready, edit-to-paint, diagnostic, recovery, state-survival, and process-tree RSS evidence remain one indivisible subject.',
    artifactName: 'kovo-perf-dev-n24',
    budgetFindings: devBudgetFindings,
    comparisonPosture: 'kovo-vs-next',
    corpusSize: 24,
    derive: deriveDevPerformanceBudget,
    evaluate: evaluateDevPerformanceBudget,
    reportMember: 'comparison.json',
    targetKinds: ['competitive-target', 'target'],
  }),
  'dev-n216': familyConfig({
    architecture:
      'The generated N=216 corpus is capability matched. Ready, edit-to-paint, diagnostic, recovery, state-survival, and process-tree RSS evidence remain one indivisible subject.',
    artifactName: 'kovo-perf-dev-n216',
    budgetFindings: devBudgetFindings,
    comparisonPosture: 'kovo-vs-next',
    corpusSize: 216,
    derive: deriveDevPerformanceBudget,
    evaluate: evaluateDevPerformanceBudget,
    reportMember: 'comparison.json',
    targetKinds: ['competitive-target', 'target'],
  }),
  'build-n24': familyConfig({
    architecture:
      'The generated N=24 corpus preserves separate clean, unchanged, and edited production-build modes plus the authenticated source-proof/deploy-proof phase boundary.',
    artifactName: 'kovo-perf-build-n24',
    budgetFindings: buildBudgetFindings,
    comparisonPosture: 'kovo-vs-next',
    corpusSize: 24,
    derive: deriveBuildPerformanceBudget,
    evaluate: evaluateBuildPerformanceBudget,
    reportMember: 'comparison.json',
    targetKinds: ['milestone'],
  }),
  'build-n216': familyConfig({
    architecture:
      'The generated N=216 corpus preserves separate clean, unchanged, and edited production-build modes plus the authenticated source-proof/deploy-proof phase boundary.',
    artifactName: 'kovo-perf-build-n216',
    budgetFindings: buildBudgetFindings,
    comparisonPosture: 'kovo-vs-next',
    corpusSize: 216,
    derive: deriveBuildPerformanceBudget,
    evaluate: evaluateBuildPerformanceBudget,
    reportMember: 'comparison.json',
    targetKinds: ['milestone'],
  }),
  server: familyConfig({
    architecture:
      'Proved HIT, conditional 304, and forced-dynamic cells remain separate across route, encoding, and concurrency. Unsupported postures cannot become zero-cost wins.',
    artifactName: 'kovo-perf-server-matrix',
    budgetFindings: comparisonBudgetFindings,
    comparisonPosture: 'kovo-vs-next',
    derive: deriveComparisonPerformanceBudget,
    evaluate: evaluateComparisonPerformanceBudget,
    reportMember: 'comparison.json',
    targetKinds: ['target'],
  }),
  check: familyConfig({
    architecture:
      'Check scaling is a Kovo-only N=8,24,72,216 ladder. It enforces Kovo product targets and must not be represented as a Kovo-vs-Next comparison.',
    artifactName: 'kovo-perf-check-scaling',
    budgetFindings: checkBudgetFindings,
    comparisonPosture: 'kovo-only',
    derive: deriveCheckPerformanceBudget,
    evaluate: evaluateCheckPerformanceBudget,
    reportMember: 'check-scaling.json',
    targetKinds: ['target'],
  }),
});

/** Authenticate all 42 report paths (five baselines and one holdout for seven families). */
export async function authenticatePerformancePublicationInput(
  input,
  { baseDirectory = process.cwd(), fetchArtifactApi, now = new Date().toISOString() } = {},
) {
  validateInputManifest(input);
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
            expectedArtifactName: config.artifactName,
            expectedReportMember: config.reportMember,
            fetchArtifactApi,
            now,
            repository: input.repository,
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
        expectedArtifactName: config.artifactName,
        expectedReportMember: config.reportMember,
        fetchArtifactApi,
        now,
        repository: input.repository,
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
      buildProfiles.push(
        await authenticatePerformanceArtifactEvidence(input.buildProfiles[mode], {
          baseDirectory,
          expectedArtifactName: BUILD_PROFILE_ARTIFACT_NAME,
          expectedReportMember: `profile-${mode}.json`,
          fetchArtifactApi,
          now,
          repository: input.repository,
        }),
      );
    } catch (error) {
      throw contextualError(`build profile ${mode}`, error);
    }
  }
  return { buildProfiles, families, repository: input.repository };
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
  const structureFindings = authenticatedInputFindings(authenticated);
  const allEntries = familyEntries(authenticated);
  const identityFindings = exactPublicationIdentityFindings(allEntries);
  const reasons = [...structureFindings, ...identityFindings];
  const documents = {};
  const families = {};
  const sourceCommit = allEntries[0]?.report?.source?.commit ?? null;
  const locks = allEntries[0]?.report?.source?.locks ?? null;

  for (const familyName of FAMILY_NAMES) {
    const config = operations[familyName];
    const evidence = authenticated?.families?.[familyName];
    if (!validOperation(config) || !validAuthenticatedFamily(evidence)) {
      reasons.push(`${familyName} derivation inputs are unavailable`);
      families[familyName] = unavailableFamilySummary(familyName);
      continue;
    }
    try {
      const baseline = ratify(evidence.baseline);
      if (baseline?.verdict?.status !== 'ratified') {
        throw new TypeError(
          `baseline is ${String(baseline?.verdict?.status)}: ${(baseline?.verdict?.reasons ?? []).join('; ')}`,
        );
      }
      const budget = config.derive(baseline, { baselineEntries: evidence.baseline });
      const budgetFindings = config.budgetFindings(budget);
      if (budgetFindings.length > 0) {
        throw new TypeError(`derived budget is invalid: ${budgetFindings.join('; ')}`);
      }
      const evaluation = config.evaluate(budget, evidence.holdout.report);
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
      const evaluationStatus = evaluation?.verdict?.status;
      const familyStatus =
        evaluationStatus === 'unproven'
          ? 'unproven'
          : evaluationStatus === 'pass' && targetAssessment.status === 'pass'
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
        holdoutEvaluation: evaluationReference(evaluation),
        status: familyStatus,
        targetAssessment,
        workload: baseline.identity.workload,
      };
    } catch (error) {
      reasons.push(`${familyName} ${error instanceof Error ? error.message : String(error)}`);
      families[familyName] = unavailableFamilySummary(familyName);
    }
  }

  let buildPersistenceAssessment;
  try {
    if (typeof assessBuildPersistence !== 'function') {
      throw new TypeError('build persistence assessor is unavailable');
    }
    buildPersistenceAssessment = assessBuildPersistence({
      n24Budget: documents['build-n24']?.budget,
      n216Budget: documents['build-n216']?.budget,
      profileEntries: buildProfileEntries ?? authenticated?.buildProfiles ?? [],
    });
    const assessmentFindings = buildPersistenceAssessmentFindings(buildPersistenceAssessment);
    if (assessmentFindings.length > 0) {
      throw new TypeError(assessmentFindings.join('; '));
    }
    if (buildPersistenceAssessment.verdict.status === 'unproven') {
      const persistenceFindings = buildPersistenceAssessment.verdict.findings;
      reasons.push(
        ...(persistenceFindings.length > 0
          ? persistenceFindings.map((finding) => `build persistence ${finding}`)
          : [`build persistence is ${buildPersistenceAssessment.verdict.outcome}`]),
      );
    }
  } catch (error) {
    reasons.push(`build persistence ${error instanceof Error ? error.message : String(error)}`);
    buildPersistenceAssessment = assessBuildForegroundSession({});
  }

  const uniqueReasons = [...new Set(reasons)].sort();
  const failures = blockingFailures(families);
  const status =
    uniqueReasons.length > 0 || FAMILY_NAMES.some((name) => families[name]?.status === 'unproven')
      ? 'unproven'
      : FAMILY_NAMES.some((name) => families[name]?.status !== 'pass')
        ? 'blocked'
        : 'publishable';
  const facts = {
    buildPersistenceAssessment,
    families,
    fixtureSources: fixtureSources(sourceCommit),
    generatedAt,
    identity: { locks, sourceCommit },
    repository: authenticated?.repository ?? null,
    schema: PERF_PUBLICATION_SCHEMA,
    verdict: { failures, reasons: uniqueReasons, status },
  };
  const publication = { ...facts, digest: sha256Canonical(facts) };
  return { documents, publication };
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
      findings.push(...evaluationReferenceFindings(family.holdoutEvaluation, familyName));
      if (
        family.holdoutEvaluation?.candidate?.execution !== family.evidence.holdout.execution ||
        family.holdoutEvaluation?.candidate?.sourceCommit !== family.evidence.holdout.sourceCommit
      ) {
        findings.push(`${familyName} holdout evaluation candidate differs from its evidence`);
      }
      const expectedFamilyStatus =
        family.holdoutEvaluation?.status === 'unproven'
          ? 'unproven'
          : family.holdoutEvaluation?.status === 'pass' &&
              family.targetAssessment?.status === 'pass'
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
  const expectedFailures = blockingFailures(publication.families ?? {});
  if (canonicalJson(publication.verdict?.failures) !== canonicalJson(expectedFailures)) {
    findings.push('publication blocking failures are not derived from its families');
  }
  const expectedStatus =
    (verdictReasons?.length ?? 0) > 0 ||
    FAMILY_NAMES.some((name) => publication.families?.[name]?.status === 'unproven')
      ? 'unproven'
      : FAMILY_NAMES.some((name) => publication.families?.[name]?.status !== 'pass')
        ? 'blocked'
        : 'publishable';
  if (publication.verdict?.status !== expectedStatus) {
    findings.push('publication verdict is not derived from its family census');
  }
  return [...new Set(findings)].sort();
}

export function renderPerformancePublicationMarkdown(publication) {
  const findings = performancePublicationFindings(publication);
  if (findings.length > 0) {
    throw new TypeError(`Cannot render malformed performance publication:\n${findings.join('\n')}`);
  }
  const lines = [
    '# Kovo realistic performance publication gate',
    '',
    `Verdict: **${publication.verdict.status}**. Source: \`${publication.identity.sourceCommit}\`.`,
    '',
    'A Kovo-vs-Next claim is eligible only when all seven rows pass. The check row is deliberately Kovo-only and does not manufacture a Next.js comparison.',
    '',
    '| Family | Posture | Host | Workload | Baseline targets | Holdout targets | Holdout gate |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const familyName of FAMILY_NAMES) {
    const family = publication.families[familyName];
    lines.push(
      `| ${familyName} | ${family.comparisonPosture} | ${code(family.host)} | ${code(family.workload)} | ${family.targetAssessment?.baseline?.status ?? 'unproven'} | ${family.targetAssessment?.holdout?.status ?? 'unproven'} | ${family.status} |`,
    );
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
  for (const familyName of FAMILY_NAMES) {
    const family = publication.families[familyName];
    lines.push('', `## ${familyName}`, '', family.architecture, '');
    if (family.status === 'unproven') {
      lines.push('Evidence is unproven; no claim may be published.');
      continue;
    }
    lines.push('Target assessment:', '');
    for (const phase of ['baseline', 'holdout']) {
      for (const check of family.targetAssessment[phase].checks) {
        lines.push(
          `- ${phase} ${check.id}: ${formatNumber(check.observed)} ${check.operator} ${formatNumber(check.limit)} — ${check.status}`,
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
  lines.push('');
  return lines.join('\n');
}

export async function writePerformancePublicationOutputs(
  result,
  { evidenceDirectory, markdownOut, out },
) {
  for (const [label, value] of [
    ['evidenceDirectory', evidenceDirectory],
    ['markdownOut', markdownOut],
    ['out', out],
  ]) {
    if (!nonEmptyString(value)) throw new TypeError(`${label} is required`);
  }
  const resolvedEvidence = path.resolve(evidenceDirectory);
  await mkdir(resolvedEvidence, { recursive: true });
  for (const [familyName, documents] of Object.entries(result.documents)) {
    for (const [kind, document] of Object.entries(documents)) {
      await writeFile(
        path.join(resolvedEvidence, `${familyName}-${kind}.json`),
        prettyJson(document),
        { flag: 'w' },
      );
    }
  }
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await writeFile(path.resolve(out), prettyJson(result.publication), { flag: 'w' });
  await mkdir(path.dirname(path.resolve(markdownOut)), { recursive: true });
  await writeFile(
    path.resolve(markdownOut),
    renderPerformancePublicationMarkdown(result.publication),
    { flag: 'w' },
  );
}

function baselineTargetAssessment(familyName, budget) {
  if (familyName === 'browser' || familyName === 'server') {
    return normalizeTargetAssessment(
      budget.targetAssessment,
      familyName === 'server' ? '>=' : '<=',
      'target',
    );
  }
  if (familyName.startsWith('dev-')) return devBaselineTargetAssessment(budget);
  if (familyName.startsWith('build-')) return buildBaselineTargetAssessment(budget);
  return checkBaselineTargetAssessment(budget);
}

function devBaselineTargetAssessment(budget) {
  const size = budget.subject?.corpusSize;
  const prefix = `corpus-n${String(size)}/dev//`;
  const targets = budget.policy?.targets;
  const checks = [
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
  ];
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
      checks: [],
      failures: [],
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

function normalizeTargetAssessment(value, operator, kind) {
  if (!ownRecord(value) || !Array.isArray(value.checks)) {
    throw new TypeError('baseline target assessment is unavailable');
  }
  const normalized = assessmentFromChecks(
    value.checks.map((check) => ({
      id: check.id,
      kind,
      limit: check.limit,
      observed: check.observed,
      operator,
      status: check.status,
    })),
  );
  if (
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
  const reasons = holdout.reasons ?? [];
  return {
    baseline,
    failures,
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
  for (const check of checks) {
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
  const failures = checks.filter((check) => check.status === 'fail').map((check) => check.id);
  return { checks, failures, status: failures.length === 0 ? 'pass' : 'fail' };
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

function evaluationReference(evaluation) {
  return {
    candidate: {
      execution: evaluation?.candidate?.execution ?? null,
      sourceCommit: evaluation?.candidate?.sourceCommit ?? null,
    },
    failures: sortedUniqueStrings(evaluation?.verdict?.failures ?? []),
    reasons: sortedUniqueStrings(evaluation?.verdict?.reasons ?? []),
    status: evaluation?.verdict?.status ?? null,
  };
}

function blockingFailures(families) {
  return FAMILY_NAMES.flatMap((familyName) => {
    const family = families[familyName];
    if (family?.status !== 'blocked') return [];
    return [
      ...new Set([
        ...(family.targetAssessment?.failures ?? []),
        ...(family.holdoutEvaluation?.failures ?? []),
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

function validateInputManifest(input) {
  if (!ownRecord(input) || input.schema !== PERF_PUBLICATION_INPUT_SCHEMA) {
    throw new TypeError(`manifest must be ${PERF_PUBLICATION_INPUT_SCHEMA}`);
  }
  const expectedKeys = [
    ...(input.buildProfiles === undefined ? [] : ['buildProfiles']),
    'families',
    'repository',
    'schema',
  ].sort((left, right) => left.localeCompare(right));
  if (canonicalJson(Object.keys(input).sort()) !== canonicalJson(expectedKeys)) {
    throw new TypeError(
      'manifest must contain only schema, repository, families, and optional buildProfiles',
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
  return findings;
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
  return Object.freeze({ ...value, targetKinds: Object.freeze([...value.targetKinds]) });
}

function validOperation(value) {
  return (
    ownRecord(value) &&
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
    const checkIds = new Set();
    const expectedFailures = [];
    for (const check of assessment.checks) {
      if (
        !nonEmptyString(check?.id) ||
        !nonEmptyString(check?.kind) ||
        !['<=', '>='].includes(check?.operator) ||
        !Number.isFinite(check?.limit) ||
        !['pass', 'fail'].includes(check?.status) ||
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
      if (expectedStatus === 'fail') expectedFailures.push(check.id);
    }
    const expectedPhaseStatus = expectedFailures.length === 0 ? 'pass' : 'fail';
    if (
      canonicalJson(assessment.failures) !== canonicalJson(expectedFailures) ||
      assessment.status !== expectedPhaseStatus
    ) {
      findings.push(`${familyName} ${phase} target verdict is not derived from its checks`);
    }
    assessments[phase] = { failures: expectedFailures, status: expectedPhaseStatus };
  }
  if (assessments.baseline && assessments.holdout) {
    const expectedFailures = [
      ...assessments.baseline.failures.map((failure) => `baseline:${failure}`),
      ...assessments.holdout.failures.map((failure) => `holdout:${failure}`),
    ];
    const expectedStatus =
      assessments.baseline.status === 'pass' && assessments.holdout.status === 'pass'
        ? 'pass'
        : 'fail';
    if (
      canonicalJson(value.failures) !== canonicalJson(expectedFailures) ||
      value.status !== expectedStatus ||
      !Array.isArray(value.reasons) ||
      value.reasons.length !== 0
    ) {
      findings.push(`${familyName} combined target verdict is not derived from both phases`);
    }
  }
  return findings;
}

function evaluationReferenceFindings(value, familyName) {
  if (!ownRecord(value) || !['pass', 'regression', 'unproven'].includes(value.status)) {
    return [`${familyName} holdout evaluation summary is unavailable`];
  }
  const findings = [];
  const failures = Array.isArray(value.failures) ? value.failures : [];
  const reasons = Array.isArray(value.reasons) ? value.reasons : [];
  for (const field of ['failures', 'reasons']) {
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
  return findings;
}

function evidenceReferenceFindings(value, label, config, publication, family) {
  if (!ownRecord(value)) return [`${label} evidence reference is unavailable`];
  const findings = [];
  for (const field of [
    'apiResponseDigest',
    'archiveDigest',
    'liveApiResponseDigest',
    'reportContentDigest',
    'execution',
    'host',
    'workload',
  ]) {
    if (!DIGEST_PATTERN.test(value[field] ?? '')) findings.push(`${label} ${field} is malformed`);
  }
  if (value.liveApiResponseDigest !== value.apiResponseDigest) {
    findings.push(`${label} saved and live API response digests differ`);
  }
  if (!COMMIT_PATTERN.test(value.sourceCommit ?? '')) {
    findings.push(`${label} source commit is malformed`);
  }
  if (!Number.isSafeInteger(value.artifactId) || value.artifactId < 1) {
    findings.push(`${label} artifact ID is malformed`);
  }
  if (!Number.isSafeInteger(value.workflowRunId) || value.workflowRunId < 1) {
    findings.push(`${label} workflow run ID is malformed`);
  }
  const apiUrl = `https://api.github.com/repos/${PERF_PUBLICATION_REPOSITORY}/actions/artifacts/${String(value.artifactId)}`;
  const runUrl = `https://github.com/${PERF_PUBLICATION_REPOSITORY}/actions/runs/${String(value.workflowRunId)}`;
  if (
    value.apiUrl !== apiUrl ||
    value.archiveDownloadUrl !== `${apiUrl}/zip` ||
    value.runUrl !== runUrl ||
    value.location !== `${runUrl}/artifacts/${String(value.artifactId)}`
  ) {
    findings.push(`${label} artifact URLs are not derived from canonical IDs`);
  }
  if (value.artifactName !== config.artifactName || value.reportMember !== config.reportMember) {
    findings.push(`${label} artifact name or report member differs from policy`);
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

function contextualError(context, error) {
  return new TypeError(`${context}: ${error instanceof Error ? error.message : String(error)}`);
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
  });
  const result = derivePerformancePublication(authenticated);
  await writePerformancePublicationOutputs(result, {
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
