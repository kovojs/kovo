import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  PERF_PUBLICATION_INPUT_SCHEMA,
  authenticatePerformancePublicationCampaign,
  authenticatePerformancePublicationInput,
  buildProfilePublicationFindings,
  derivePerformancePublication,
  loadCommittedPerformanceBudgets,
  performancePublicationFindings,
  performancePublicationResultFindings,
  renderPerformancePublicationMarkdown,
  writePerformancePublicationOutputs,
} from './perf-publication-gate.mjs';
import { createPerformanceArtifactDescriptorCustody } from './lib/perf-artifact-custody.mjs';
import { deriveBuildProfileSetAnalysis } from './lib/perf-build-profile-classifier.mjs';
import {
  deriveBuildProcessCpuEvidence,
  mergeBuildProcessProfiles,
} from './perf-build-session-profile.mjs';
import { KOVO_BUILD_SOURCE_PHASES } from './perf-build-benchmark.mjs';
import { canonicalJson } from './perf-regression-check.mjs';
import { comparisonTargetCheckSpecifications } from './perf-comparison-budget.mjs';
import {
  PACKED_KOVO_PRODUCT_WORKLOAD_POLICY,
  fixturePackedKovoProductIdentity,
} from './fixtures/perf-packed-product-identity.mjs';

const FAMILY_NAMES = [
  'browser',
  'dev-n24',
  'dev-n216',
  'build-n24',
  'build-n216',
  'server',
  'check',
];
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('seven-family performance publication gate', () => {
  it('live-reauthenticates the complete preregistered campaign and earliest bytes candidate', async () => {
    const fixture = writeCampaignAuthenticationFixture();
    const result = await authenticatePerformancePublicationCampaign(fixture.campaign, {
      authenticateArtifactEvidence: fixture.authenticateArtifactEvidence,
      custody: await createPerformanceArtifactDescriptorCustody({
        baseDirectory: fixture.directory,
      }),
      fetchCampaignWorkflowRunsApi: async () => fixture.liveWorkflowRunsBytes,
      fetchWorkflowArtifactsApi: async ({ workflowRunId }) =>
        fixture.liveArtifactsByRun.get(workflowRunId),
      fetchWorkflowRunApi: async ({ workflowRunId }) => fixture.liveRunById.get(workflowRunId),
      repository: 'kovojs/kovo',
      selectedFamilies: fixture.selectedFamilies,
      selectedProductionBytes: fixture.selectedProductionBytes,
    });

    expect(result.runs).toHaveLength(7);
    expect(result.productionBytes.map(({ artifactId }) => artifactId)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);

    for (const mutate of [
      (value) => {
        value.campaign.runs.splice(1, 1);
      },
      (value) => {
        value.campaign.productionBytes.shift();
      },
      (value) => {
        value.campaign.runs[0].runCreatedAt = '2026-08-13T00:00:30.000Z';
      },
      (value) => {
        const listing = JSON.parse(value.liveArtifactsByRun.get(10_001).toString('utf8'));
        listing.artifacts.splice(2, 1);
        value.liveArtifactsByRun.set(
          10_001,
          Buffer.from(
            `${JSON.stringify({ artifacts: listing.artifacts, total_count: listing.artifacts.length })}\n`,
          ),
        );
      },
    ]) {
      const adversarial = writeCampaignAuthenticationFixture();
      mutate(adversarial);
      await expect(
        authenticatePerformancePublicationCampaign(adversarial.campaign, {
          authenticateArtifactEvidence: adversarial.authenticateArtifactEvidence,
          custody: await createPerformanceArtifactDescriptorCustody({
            baseDirectory: adversarial.directory,
          }),
          fetchCampaignWorkflowRunsApi: async () => adversarial.liveWorkflowRunsBytes,
          fetchWorkflowArtifactsApi: async ({ workflowRunId }) =>
            adversarial.liveArtifactsByRun.get(workflowRunId),
          fetchWorkflowRunApi: async ({ workflowRunId }) =>
            adversarial.liveRunById.get(workflowRunId),
          repository: 'kovojs/kovo',
          selectedFamilies: adversarial.selectedFamilies,
          selectedProductionBytes: adversarial.selectedProductionBytes,
        }),
      ).rejects.toThrow(/omits|chronology|created_at|artifact census|identity is malformed/u);
    }
  });

  it('enforces the pull-request Production bytes floor from authenticated run authority', async () => {
    const missing = writeCampaignAuthenticationFixture();
    omitCampaignProductionBytes(missing, 10_007, { listingEvent: 'workflow_dispatch' });
    await expect(
      authenticatePerformancePublicationCampaign(
        missing.campaign,
        await campaignAuthenticationOptions(missing),
      ),
    ).rejects.toThrow(
      'pull_request campaign run 10007 must expose exactly one literal Production bytes artifact',
    );

    const duplicate = writeCampaignAuthenticationFixture();
    rewriteCampaignRunArtifacts(duplicate, 10_007, (listing) => {
      listing.artifacts.push({ id: 999_999, name: 'kovo-perf-bytes' });
      listing.total_count = listing.artifacts.length;
    });
    await expect(
      authenticatePerformancePublicationCampaign(
        duplicate.campaign,
        await campaignAuthenticationOptions(duplicate),
      ),
    ).rejects.toThrow('campaign run 10007 has ambiguous publication artifacts');
  });

  it('rejects dispatch and scheduled runs from pull-request publication campaigns', async () => {
    for (const event of ['workflow_dispatch', 'schedule']) {
      const fixture = writeCampaignAuthenticationFixture();
      rewriteCampaignRunEvent(fixture, 10_007, event);
      omitCampaignProductionBytes(fixture, 10_007);

      await expect(
        authenticatePerformancePublicationCampaign(
          fixture.campaign,
          await campaignAuthenticationOptions(fixture),
        ),
      ).rejects.toThrow('campaign workflow-runs API contains foreign run identity');
    }
  });

  it('allows an authenticated dispatch preflight outside the inclusive campaign boundary', async () => {
    const fixture = writeCampaignAuthenticationFixture();
    const reference = fixture.campaign.workflowRunsApiMetadata;
    const censusFile = path.join(fixture.directory, reference.path);
    const census = JSON.parse(readFileSync(censusFile, 'utf8'));
    census.workflow_runs.unshift({
      ...structuredClone(census.workflow_runs[0]),
      created_at: '2026-08-12T23:59:00.000Z',
      event: 'workflow_dispatch',
      id: 10_000,
    });
    census.total_count = census.workflow_runs.length;
    fixture.liveWorkflowRunsBytes = rewriteCampaignReference(fixture, reference, census);

    await expect(
      authenticatePerformancePublicationCampaign(
        fixture.campaign,
        await campaignAuthenticationOptions(fixture),
      ),
    ).resolves.toMatchObject({
      runs: expect.arrayContaining([expect.objectContaining({ runId: 10_001 })]),
    });
  });

  it('rejects an event spoof in the authenticated per-run authority', async () => {
    const fixture = writeCampaignAuthenticationFixture();
    rewriteCampaignRunEvent(fixture, 10_007, 'workflow_dispatch', { updateCensus: false });
    omitCampaignProductionBytes(fixture, 10_007);

    await expect(
      authenticatePerformancePublicationCampaign(
        fixture.campaign,
        await campaignAuthenticationOptions(fixture),
      ),
    ).rejects.toThrow('campaign run 10007 authority is malformed');
  });

  it('authenticates every literal candidate and independently derives first-five-plus-sixth selection', async () => {
    const fixture = writeCampaignAuthenticationFixture();
    const result = await authenticatePerformancePublicationCampaign(
      fixture.campaign,
      await campaignAuthenticationOptions(fixture),
    );

    expect(result.familyCandidates).toHaveLength(49);
    expect(result.productionBytesCandidates).toHaveLength(7);
    for (const familyName of FAMILY_NAMES) {
      const candidates = result.familyCandidates.filter(
        (candidate) => candidate.family === familyName,
      );
      expect(result.selectedFamilies[familyName]).toEqual(candidates.slice(0, 6));
    }

    const dirtyUnselected = writeCampaignAuthenticationFixture();
    const dirtyCandidate = dirtyUnselected.campaign.familyCandidates
      .filter(({ family }) => family === 'browser')
      .at(-1);
    const dirtyEvidence = await dirtyUnselected.authenticateArtifactEvidence(
      dirtyCandidate.descriptor,
    );
    dirtyEvidence.report.source.dirty = true;
    await expect(
      authenticatePerformancePublicationCampaign(
        dirtyUnselected.campaign,
        await campaignAuthenticationOptions(dirtyUnselected),
      ),
    ).rejects.toThrow(/wrong or dirty/u);

    const sourceDriftedUnselected = writeCampaignAuthenticationFixture();
    const sourceDriftedCandidate = sourceDriftedUnselected.campaign.familyCandidates
      .filter(({ family }) => family === 'browser')
      .at(-1);
    const sourceDriftedEvidence = await sourceDriftedUnselected.authenticateArtifactEvidence(
      sourceDriftedCandidate.descriptor,
    );
    sourceDriftedEvidence.report.sourceAfter.commit = 'b'.repeat(40);
    await expect(
      authenticatePerformancePublicationCampaign(
        sourceDriftedUnselected.campaign,
        await campaignAuthenticationOptions(sourceDriftedUnselected),
      ),
    ).rejects.toThrow(/source changed during measurement/u);

    const unmeasured = writeCampaignAuthenticationFixture();
    const unmeasuredCandidate = unmeasured.campaign.familyCandidates
      .filter(({ family }) => family === 'server')
      .at(-1);
    const unmeasuredEvidence = await unmeasured.authenticateArtifactEvidence(
      unmeasuredCandidate.descriptor,
    );
    unmeasuredEvidence.report.verdict.status = 'unproven';
    await expect(
      authenticatePerformancePublicationCampaign(
        unmeasured.campaign,
        await campaignAuthenticationOptions(unmeasured),
      ),
    ).rejects.toThrow(/not measured/u);

    const malformed = writeCampaignAuthenticationFixture();
    const malformedCandidate = malformed.campaign.familyCandidates
      .filter(({ family }) => family === 'check')
      .at(-1);
    const malformedEvidence = await malformed.authenticateArtifactEvidence(
      malformedCandidate.descriptor,
    );
    malformedEvidence.report.schema = 'invented-report/v1';
    await expect(
      authenticatePerformancePublicationCampaign(
        malformed.campaign,
        await campaignAuthenticationOptions(malformed),
      ),
    ).rejects.toThrow(/report schema differs/u);

    const omitted = writeCampaignAuthenticationFixture();
    omitted.campaign.familyCandidates.splice(6, 1);
    await expect(
      authenticatePerformancePublicationCampaign(
        omitted.campaign,
        await campaignAuthenticationOptions(omitted),
      ),
    ).rejects.toThrow(/omits or invents/u);

    const invented = writeCampaignAuthenticationFixture();
    invented.campaign.familyCandidates[0].artifactId = 999_999;
    await expect(
      authenticatePerformancePublicationCampaign(
        invented.campaign,
        await campaignAuthenticationOptions(invented),
      ),
    ).rejects.toThrow(/omits or invents/u);

    const omittedBytes = writeCampaignAuthenticationFixture();
    omittedBytes.campaign.productionBytesCandidates.pop();
    await expect(
      authenticatePerformancePublicationCampaign(
        omittedBytes.campaign,
        await campaignAuthenticationOptions(omittedBytes),
      ),
    ).rejects.toThrow(/omits or invents/u);

    const invalidBytes = writeCampaignAuthenticationFixture();
    const invalidBytesCandidate = invalidBytes.campaign.productionBytesCandidates.at(-1);
    const invalidBytesEvidence = await invalidBytes.authenticateArtifactEvidence(
      invalidBytesCandidate.descriptor,
    );
    invalidBytesEvidence.report.source.dirty = true;
    await expect(
      authenticatePerformancePublicationCampaign(
        invalidBytes.campaign,
        await campaignAuthenticationOptions(invalidBytes),
      ),
    ).rejects.toThrow(/source and dependency-lock identity are malformed/u);
  });

  it('rejects cherry-picked descriptors, outside-boundary substitutions, and unnecessary selectors', async () => {
    const cherryPicked = writeCampaignAuthenticationFixture();
    const seventh = cherryPicked.campaign.familyCandidates.filter(
      ({ family }) => family === 'browser',
    )[6];
    cherryPicked.selectedFamilies.browser.holdout = await cherryPicked.authenticateArtifactEvidence(
      seventh.descriptor,
    );
    await expect(
      authenticatePerformancePublicationCampaign(
        cherryPicked.campaign,
        await campaignAuthenticationOptions(cherryPicked),
      ),
    ).rejects.toThrow(/selected descriptor\[5\] differs/u);

    const outsideBoundary = writeCampaignAuthenticationFixture();
    outsideBoundary.selectedFamilies.browser.baseline[0] = structuredClone(
      outsideBoundary.selectedFamilies.browser.baseline[0],
    );
    outsideBoundary.selectedFamilies.browser.baseline[0].custody.workflowRunId = 9_999;
    await expect(
      authenticatePerformancePublicationCampaign(
        outsideBoundary.campaign,
        await campaignAuthenticationOptions(outsideBoundary),
      ),
    ).rejects.toThrow(/selected descriptor\[0\] differs/u);

    const outsideCandidate = writeCampaignAuthenticationFixture();
    outsideCandidate.campaign.familyCandidates[0].runId = 9_999;
    await expect(
      authenticatePerformancePublicationCampaign(
        outsideCandidate.campaign,
        await campaignAuthenticationOptions(outsideCandidate),
      ),
    ).rejects.toThrow(/identity is malformed/u);

    const unnecessarySelector = writeCampaignAuthenticationFixture();
    unnecessarySelector.campaign.cohortSelections.browser =
      unnecessarySelector.campaign.familyCandidates.find(
        ({ family }) => family === 'browser',
      ).cohortDigest;
    await expect(
      authenticatePerformancePublicationCampaign(
        unnecessarySelector.campaign,
        await campaignAuthenticationOptions(unnecessarySelector),
      ),
    ).rejects.toThrow(/selector is unnecessary/u);
  });

  it('keeps metrics, timings, verdict details, and budgets outside candidate selection', async () => {
    const fixture = writeCampaignAuthenticationFixture();
    for (const candidate of fixture.campaign.familyCandidates) {
      const evidence = await fixture.authenticateArtifactEvidence(candidate.descriptor);
      evidence.report.analysis = { adversarial: { value: candidate.runId } };
      evidence.report.budgets = { arbitrary: candidate.artifactId };
      evidence.report.metrics = { invented: { value: -candidate.runId } };
      evidence.report.rawCells = [{ durationMs: Number.MAX_SAFE_INTEGER - candidate.runId }];
      evidence.report.verdict = {
        failures: [String(candidate.artifactId)],
        reasons: [String(candidate.runId)],
        status: 'measured',
      };
    }
    const result = await authenticatePerformancePublicationCampaign(
      fixture.campaign,
      await campaignAuthenticationOptions(fixture),
    );
    for (const familyName of FAMILY_NAMES) {
      expect(result.selectedFamilies[familyName]).toEqual(
        result.familyCandidates.filter((candidate) => candidate.family === familyName).slice(0, 6),
      );
    }
  });

  it('publishes only after five ratified reports and one independent passing holdout per family', () => {
    const authenticated = authenticatedFixture();
    expect(authenticated.campaign.productionBytesCandidates[0]).toMatchObject({
      contentDigest: authenticated.productionBytes.custody.reportContentDigest,
      executionDigest: authenticated.productionBytes.report.execution.digest,
    });
    const options = fixtureDerivationOptions();
    const result = derivePerformancePublication(authenticated, options);

    expect(result.publication.verdict).toEqual({
      failures: [],
      reasons: [],
      status: 'publishable',
    });
    expect(performancePublicationFindings(result.publication)).toEqual([]);
    expect(
      performancePublicationResultFindings(result, {
        assessBuildPersistence: options.assessBuildPersistence,
        authenticated,
        operations: options.operations,
        ratify: (entries) => options.ratify(entries),
      }),
    ).toEqual([]);
    expect(Object.keys(result.documents)).toEqual(FAMILY_NAMES);
    expect(result.publication.productionBytes).toMatchObject({
      componentCount: 24,
      failures: [],
      status: 'pass',
    });
    expect(result.publication.productionBytes.metricVerdicts).toHaveLength(5);
    const chronologyTamper = structuredClone(result.publication);
    chronologyTamper.campaign.productionBytes = [];
    resealPublication(chronologyTamper);
    expect(performancePublicationFindings(chronologyTamper)).toContain(
      'Production bytes chronology or earliest selection is malformed',
    );
    for (const familyName of FAMILY_NAMES) {
      expect(result.publication.families[familyName]).toMatchObject({
        status: 'pass',
        targetAssessment: {
          baseline: { status: 'pass' },
          holdout: { status: 'pass' },
          status: 'pass',
        },
      });
      expect(result.publication.families[familyName].evidence.baseline).toHaveLength(5);
    }
    const markdown = renderFixturePublication(result, { authenticated, options });
    expect(markdown).toContain('Verdict: **publishable**');
    expect(markdown).toContain('independent holdout');
    expect(markdown).toContain('Kovo-only');
    expect(markdown).toContain('https://github.com/kovojs/kovo/tree/');
    expect(markdown).toContain('Production bytes sidecar');
    expect(markdown).toContain('perf-budgets.json');
    expect(markdown).toContain('### Default/as shipped');
    expect(markdown).toContain('### Matched L0');
    expect(markdown).toContain('### Matched L1');
    expect(
      markdown.match(
        /\| Metric \| Kovo median \| Kovo p95 \| Next median \| Next p95 \| Budget policy \|/gu,
      ),
    ).toHaveLength(3);
    expect(markdown).toContain('median of five independent run medians');
    expect(markdown).toContain('sixth run is the independent holdout and is not pooled');
    expect(markdown).toContain('Next matched L0 still ships JavaScript');
    expect(markdown).toContain('document-parts response and preserves the document');
    expect(markdown).toContain('is not additive and is not a decode or morph split');
    expect(markdown).toContain('[Derived browser budget](evidence/browser-budget.json)');
    expect(markdown).toContain(
      '| default/browser//desktop.coldLoad.bytes.js | 10 | 11 | 20 | 21 |',
    );
    for (const metric of Object.keys(result.documents.browser.budget.metrics)) {
      expect(markdown.split(`| ${metric} |`)).toHaveLength(2);
    }
    for (const lane of ['default', 'matched-l0', 'matched-l1']) {
      const positions = Object.keys(result.documents.browser.budget.metrics)
        .filter((metric) => metric.startsWith(`${lane}/browser//`))
        .sort((left, right) => left.localeCompare(right))
        .map((metric) => markdown.indexOf(`| ${metric} |`));
      expect(positions).toEqual([...positions].sort((left, right) => left - right));
    }
    expect(() => renderPerformancePublicationMarkdown(result.publication)).toThrow(
      /must contain only documents and publication/u,
    );
  });

  it('makes any deterministic byte-budget failure publication-blocking', () => {
    const authenticated = authenticatedFixture();
    const metricId = 'production.navigation.wireBytes';
    authenticated.productionBytes.report.metrics[metricId].value = 1_001;
    authenticated.productionBytes.custody.workflow.conclusion = 'failure';
    authenticated.productionBytes.custody.workflow.job.conclusion = 'failure';
    authenticated.productionBytes.custody.workflow.job.failureStep = {
      conclusion: 'failure',
      name: 'Evaluate against perf-budgets.json',
      number: 2,
      status: 'completed',
    };
    authenticated.productionBytes.custody.workflow.job.requiredSuccessSteps = [
      {
        conclusion: 'success',
        name: 'Measure critical-path, navigation and bootstrap bytes',
        number: 1,
        status: 'completed',
      },
      {
        conclusion: 'success',
        name: 'Run actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
        number: 3,
        status: 'completed',
      },
    ];

    const result = derivePerformancePublication(authenticated, fixtureDerivationOptions());

    expect(result.publication.productionBytes).toMatchObject({
      failures: [metricId],
      status: 'blocked',
    });
    expect(result.publication.verdict).toMatchObject({
      failures: [`production-bytes:${metricId}`],
      status: 'blocked',
    });
    expect(performancePublicationFindings(result.publication)).toEqual([]);

    result.publication.productionBytes.evidence.workflow.job.requiredSuccessSteps[1].conclusion =
      'skipped';
    resealPublication(result.publication);
    expect(performancePublicationFindings(result.publication)).toContain(
      'Production bytes live workflow family job differs from policy',
    );
  });

  it('refuses browser-row curation or metrics outside the three declared lanes', () => {
    const authenticated = authenticatedFixture();
    const options = fixtureDerivationOptions();
    const result = derivePerformancePublication(authenticated, options);
    result.documents.browser.budget.metrics['curated/browser//headline'] = structuredClone(
      result.documents.browser.budget.metrics['default/browser//desktop.coldLoad.bytes.js'],
    );
    const budgetReference = result.publication.families.browser.documents.budget;
    budgetReference.contentDigest = digest(
      `${JSON.stringify(result.documents.browser.budget, null, 2)}\n`,
    );
    budgetReference.semanticDigest = canonicalDigest(result.documents.browser.budget);
    resealPublication(result.publication);

    expect(() => renderFixturePublication(result, { authenticated, options })).toThrow(
      /does not belong to exactly one browser lane/u,
    );

    const emptyLane = derivePerformancePublication(authenticated, options);
    for (const metric of Object.keys(emptyLane.documents.browser.budget.metrics)) {
      if (metric.startsWith('matched-l1/browser//')) {
        delete emptyLane.documents.browser.budget.metrics[metric];
      }
    }
    const emptyLaneReference = emptyLane.publication.families.browser.documents.budget;
    emptyLaneReference.contentDigest = digest(
      `${JSON.stringify(emptyLane.documents.browser.budget, null, 2)}\n`,
    );
    emptyLaneReference.semanticDigest = canonicalDigest(emptyLane.documents.browser.budget);
    resealPublication(emptyLane.publication);
    expect(() => renderFixturePublication(emptyLane, { authenticated, options })).toThrow(
      /browser budget table lane matched-l1 has no metrics/u,
    );
  });

  it('keeps malformed, unbudgeted, or sourceAfter-drifted byte evidence unproven', () => {
    for (const mutate of [
      (entry) => {
        entry.budgets.metrics['production.document.wireBytes'].max = null;
      },
      (entry) => {
        entry.budgets.metrics['production.document.wireBytes'].max = -1;
      },
      (entry) => {
        entry.report.sourceAfter.commit = 'b'.repeat(40);
      },
      (entry) => {
        delete entry.report.metrics['production.inlineBootstrap.gzipBytes'];
      },
      (entry) => {
        entry.report.host.schema = 'kovo-performance-host/v1';
      },
      (entry) => {
        entry.report.workloadIdentity.identity.adapters.foreign = 'v1';
        entry.report.workloadIdentity.digest = canonicalDigest(
          entry.report.workloadIdentity.identity,
        );
      },
      (entry) => {
        entry.report.workloadIdentity.foreign = true;
      },
      (entry) => {
        entry.report.workloadIdentity.identity.policies.foreign = true;
        entry.report.workloadIdentity.digest = canonicalDigest(
          entry.report.workloadIdentity.identity,
        );
      },
    ]) {
      const authenticated = authenticatedFixture();
      mutate(authenticated.productionBytes);
      const result = derivePerformancePublication(authenticated, fixtureDerivationOptions());
      expect(result.publication.productionBytes.status).toBe('unproven');
      expect(result.publication.verdict.status).toBe('unproven');
      expect(performancePublicationFindings(result.publication)).toEqual([]);
    }
  });

  it('reproduces the Production bytes assessment canonically from report and budget evidence', () => {
    const authenticated = authenticatedFixture();
    const options = fixtureDerivationOptions();
    const result = derivePerformancePublication(authenticated, options);
    result.publication.productionBytes.metricVerdicts[0].value += 1;
    resealPublication(result.publication);

    expect(
      performancePublicationResultFindings(result, {
        assessBuildPersistence: options.assessBuildPersistence,
        authenticated,
        operations: options.operations,
        ratify: (entries) => options.ratify(entries),
      }),
    ).toContain(
      'Production bytes assessment differs from authenticated report and committed budget reproduction',
    );
  });

  it('binds perf-budgets.json bytes to the exact clean measured-source commit', async () => {
    const repository = mkdtempSync(path.join(os.tmpdir(), 'kovo-perf-budget-custody-'));
    temporaryDirectories.push(repository);
    const budgets = authenticatedFixture().productionBytes.budgets;
    const bytes = Buffer.from(`${JSON.stringify(budgets, null, 2)}\n`);
    writeFileSync(path.join(repository, 'perf-budgets.json'), bytes);
    execFileSync('git', ['init', '--quiet'], { cwd: repository });
    execFileSync('git', ['add', 'perf-budgets.json'], { cwd: repository });
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
      loadCommittedPerformanceBudgets({ repositoryDirectory: repository, sourceSha }),
    ).resolves.toMatchObject({
      budgetIdentity: {
        byteLength: bytes.length,
        contentDigest: digest(bytes),
        path: 'perf-budgets.json',
        sourceCommit: sourceSha,
      },
      budgets,
    });

    writeFileSync(path.join(repository, 'perf-budgets.json'), `${bytes.toString('utf8')} `);
    await expect(
      loadCommittedPerformanceBudgets({ repositoryDirectory: repository, sourceSha }),
    ).rejects.toThrow('uncommitted or untracked changes');
  });

  it('reports a dev competitive-target miss without blocking the completion gate', () => {
    const options = fixtureDerivationOptions();
    options.operations['dev-n216'] = {
      ...options.operations['dev-n216'],
      evaluate: (budget, candidate) => {
        const evaluation = fixtureEvaluation('dev-n216', budget, candidate);
        const id = 'corpus-n216/dev//ready.durationMs.median-vs-next';
        const check = evaluation.checks.find((entry) => entry.id === id);
        check.status = 'fail';
        check.value = 2.5;
        evaluation.verdict = { failures: [id], reasons: [], status: 'regression' };
        return evaluation;
      },
    };

    const authenticated = authenticatedFixture();
    const result = derivePerformancePublication(authenticated, options);

    const family = result.publication.families['dev-n216'];
    expect(result.publication.verdict).toMatchObject({ failures: [], status: 'publishable' });
    expect(family).toMatchObject({
      holdoutEvaluation: {
        blockingFailures: [],
        failures: ['corpus-n216/dev//ready.durationMs.median-vs-next'],
        followOnFailures: ['corpus-n216/dev//ready.durationMs.median-vs-next'],
        status: 'regression',
      },
      status: 'pass',
      targetAssessment: {
        blockingFailures: [],
        blockingStatus: 'pass',
        followOnFailures: ['holdout:corpus-n216/dev//ready.durationMs.median-vs-next'],
        followOnStatus: 'fail',
        status: 'fail',
      },
    });
    const markdown = renderFixturePublication(result, { authenticated, options });
    expect(markdown).toContain(
      'holdout [follow-on] corpus-n216/dev//ready.durationMs.median-vs-next: 2.5000 <= 2 — fail',
    );
    expect(markdown).toContain('## Reported follow-on misses (non-blocking)');
  });

  it('keeps browser navigation blocking while session bytes remain a failed follow-on', () => {
    const authenticated = authenticatedFixture();
    const sessionOptions = fixtureDerivationOptions();
    sessionOptions.operations.browser = {
      ...sessionOptions.operations.browser,
      evaluate: (budget, candidate) => {
        const evaluation = fixtureEvaluation('browser', budget, candidate);
        const id =
          'matched-l1/browser//mobile.navigation.sessionBytes.throughDestinationPaint.total.median-vs-next';
        const check = evaluation.checks.find((entry) => entry.id === id);
        check.status = 'fail';
        check.value = 0.75;
        evaluation.verdict = { failures: [id], reasons: [], status: 'regression' };
        return evaluation;
      },
    };
    const sessionResult = derivePerformancePublication(authenticated, sessionOptions);
    expect(sessionResult.publication).toMatchObject({
      families: {
        browser: {
          status: 'pass',
          targetAssessment: { blockingStatus: 'pass', followOnStatus: 'fail', status: 'fail' },
        },
      },
      verdict: { failures: [], status: 'publishable' },
    });
    expect(
      renderFixturePublication(sessionResult, { authenticated, options: sessionOptions }),
    ).toContain(
      'holdout [follow-on] matched-l1/browser//mobile.navigation.sessionBytes.throughDestinationPaint.total.median-vs-next: 0.7500 <= 0.5000 — fail',
    );

    const navigationOptions = fixtureDerivationOptions();
    navigationOptions.operations.browser = {
      ...navigationOptions.operations.browser,
      evaluate: (budget, candidate) => {
        const evaluation = fixtureEvaluation('browser', budget, candidate);
        const id = 'matched-l1/browser//mobile.navigation.navToPaintMs.median-vs-next';
        const check = evaluation.checks.find((entry) => entry.id === id);
        check.status = 'fail';
        check.value = 2.5;
        evaluation.verdict = { failures: [id], reasons: [], status: 'regression' };
        return evaluation;
      },
    };
    const navigationResult = derivePerformancePublication(authenticated, navigationOptions);
    expect(navigationResult.publication.families.browser).toMatchObject({
      status: 'blocked',
      targetAssessment: { blockingStatus: 'fail', followOnStatus: 'pass', status: 'fail' },
    });
    expect(navigationResult.publication.verdict).toMatchObject({
      failures: expect.arrayContaining([
        'browser:matched-l1/browser//mobile.navigation.navToPaintMs.median-vs-next',
        'browser:holdout:matched-l1/browser//mobile.navigation.navToPaintMs.median-vs-next',
      ]),
      status: 'blocked',
    });
  });

  it('reports server competitive misses while regression and unknown failures stay blocking', () => {
    const authenticated = authenticatedFixture();
    const baselineOptions = fixtureDerivationOptions();
    baselineOptions.operations.server = {
      ...baselineOptions.operations.server,
      derive: (baseline) => {
        const budget = fixtureBudget('server', baseline);
        const check = budget.targetAssessment.checks[0];
        check.observed = check.limit - 0.1;
        check.status = 'fail';
        budget.targetAssessment.failures = [check.id];
        budget.targetAssessment.status = 'fail';
        return budget;
      },
    };
    const baselineResult = derivePerformancePublication(authenticated, baselineOptions);
    expect(baselineResult.publication).toMatchObject({
      families: {
        server: {
          status: 'pass',
          targetAssessment: {
            blockingStatus: 'not-applicable',
            followOnFailures: [expect.stringMatching(/^baseline:/u)],
            followOnStatus: 'fail',
          },
        },
      },
      verdict: { failures: [], status: 'publishable' },
    });

    const competitiveOptions = fixtureDerivationOptions();
    competitiveOptions.operations.server = {
      ...competitiveOptions.operations.server,
      evaluate: (budget, candidate) => {
        const evaluation = fixtureEvaluation('server', budget, candidate);
        const id =
          'matched-runtime/server/dynamic-detail-identity-c32/requestsPerSecond.median-vs-next';
        const check = evaluation.checks.find((entry) => entry.id === id);
        check.status = 'fail';
        check.value = 0.7;
        evaluation.verdict = { failures: [id], reasons: [], status: 'regression' };
        return evaluation;
      },
    };
    const competitiveResult = derivePerformancePublication(authenticated, competitiveOptions);
    expect(competitiveResult.publication).toMatchObject({
      families: {
        server: {
          holdoutEvaluation: { blockingFailures: [], followOnFailures: [expect.any(String)] },
          status: 'pass',
          targetAssessment: { blockingStatus: 'not-applicable', followOnStatus: 'fail' },
        },
      },
      verdict: { failures: [], status: 'publishable' },
    });

    const unknownOptions = fixtureDerivationOptions();
    unknownOptions.operations.server = {
      ...unknownOptions.operations.server,
      evaluate: (budget, candidate) => {
        const evaluation = fixtureEvaluation('server', budget, candidate);
        const id = 'server/future-unclassified-check';
        evaluation.checks.push({ id, kind: 'future-kind', limit: 1, status: 'fail', value: 2 });
        evaluation.verdict = { failures: [id], reasons: [], status: 'regression' };
        return evaluation;
      },
    };
    const unknownResult = derivePerformancePublication(authenticated, unknownOptions);
    expect(unknownResult.publication.families.server).toMatchObject({
      holdoutEvaluation: {
        blockingFailures: ['server/future-unclassified-check'],
        followOnFailures: [],
      },
      status: 'blocked',
    });
    expect(unknownResult.publication.verdict).toMatchObject({
      failures: ['server:server/future-unclassified-check'],
      status: 'blocked',
    });
  });

  it('does not let an unknown failed check borrow a known follow-on failure identity', () => {
    const authenticated = authenticatedFixture();
    const options = fixtureDerivationOptions();
    options.operations.server = {
      ...options.operations.server,
      evaluate: (budget, candidate) => {
        const evaluation = fixtureEvaluation('server', budget, candidate);
        const id =
          'matched-runtime/server/dynamic-detail-identity-c32/requestsPerSecond.median-vs-next';
        evaluation.checks.push({
          id,
          kind: 'future-kind',
          limit: 1,
          status: 'fail',
          value: 2,
        });
        evaluation.verdict = { failures: [id], reasons: [], status: 'regression' };
        return evaluation;
      },
    };

    const result = derivePerformancePublication(authenticated, options);

    expect(result.publication.families.server.status).toBe('unproven');
    expect(result.publication.verdict.status).toBe('unproven');
    expect(result.publication.verdict.reasons.join('\n')).toMatch(
      /holdout evaluation check identities are duplicated/u,
    );
  });

  it('does not let a failed check disappear from the evaluation verdict', () => {
    const authenticated = authenticatedFixture();
    const options = fixtureDerivationOptions();
    options.operations.server = {
      ...options.operations.server,
      evaluate: (budget, candidate) => {
        const evaluation = fixtureEvaluation('server', budget, candidate);
        evaluation.checks.push({
          id: 'server/future-unclassified-check',
          kind: 'future-kind',
          limit: 1,
          status: 'fail',
          value: 2,
        });
        return evaluation;
      },
    };

    const result = derivePerformancePublication(authenticated, options);

    expect(result.publication.families.server.status).toBe('unproven');
    expect(result.publication.verdict.status).toBe('unproven');
    expect(result.publication.verdict.reasons.join('\n')).toMatch(
      /holdout evaluation failures do not match its failed checks/u,
    );
  });

  it('preserves a coherent unproven holdout evaluation with no checks', () => {
    const authenticated = authenticatedFixture();
    const options = fixtureDerivationOptions();
    options.operations.server = {
      ...options.operations.server,
      evaluate: (budget, candidate) => ({
        ...fixtureEvaluation('server', budget, candidate),
        checks: [],
        verdict: {
          failures: [],
          reasons: ['candidate comparison evidence is unavailable'],
          status: 'unproven',
        },
      }),
    };

    const result = derivePerformancePublication(authenticated, options);

    expect(result.publication.families.server.status).toBe('unproven');
    expect(result.publication.verdict).toMatchObject({
      reasons: ['server holdout candidate comparison evidence is unavailable'],
      status: 'unproven',
    });
  });

  it.each([
    ['build-n24', 'corpus-n24/build/clean/durationMs.median-vs-next'],
    ['check', 'check.appSourceTrust.marginalScalingExponent.absolute-target'],
  ])('keeps %s milestone/product failures publication-blocking', (familyName, id) => {
    const authenticated = authenticatedFixture();
    const options = fixtureDerivationOptions();
    options.operations[familyName] = {
      ...options.operations[familyName],
      evaluate: (budget, candidate) => {
        const evaluation = fixtureEvaluation(familyName, budget, candidate);
        const check = evaluation.checks.find((entry) => entry.id === id);
        check.status = 'fail';
        check.value = check.limit + 1;
        evaluation.verdict = { failures: [id], reasons: [], status: 'regression' };
        return evaluation;
      },
    };
    const result = derivePerformancePublication(authenticated, options);
    expect(result.publication.families[familyName]).toMatchObject({
      holdoutEvaluation: { blockingFailures: [id], followOnFailures: [] },
      status: 'blocked',
      targetAssessment: { blockingStatus: 'fail', followOnStatus: 'not-applicable' },
    });
    expect(result.publication.verdict).toMatchObject({
      failures: expect.arrayContaining([`${familyName}:${id}`, `${familyName}:holdout:${id}`]),
      status: 'blocked',
    });
  });

  it('keeps dev absolute-latency targets publication-blocking', () => {
    const authenticated = authenticatedFixture();
    const options = fixtureDerivationOptions();
    options.operations['dev-n24'] = {
      ...options.operations['dev-n24'],
      evaluate: (budget, candidate) => {
        const evaluation = fixtureEvaluation('dev-n24', budget, candidate);
        const id = 'corpus-n24/dev//edit.syntaxErrorMs.p95-target';
        const check = evaluation.checks.find((entry) => entry.id === id);
        check.status = 'fail';
        check.value = 1_001;
        evaluation.verdict = { failures: [id], reasons: [], status: 'regression' };
        return evaluation;
      },
    };
    const result = derivePerformancePublication(authenticated, options);
    expect(result.publication.families['dev-n24']).toMatchObject({
      status: 'blocked',
      targetAssessment: { blockingStatus: 'fail', followOnStatus: 'pass' },
    });
    expect(result.publication.verdict.status).toBe('blocked');
  });

  it('reports unproven when the holdout reuses a baseline workflow run', () => {
    const authenticated = authenticatedFixture();
    authenticated.families.server.holdout.report.execution.github.runUrl =
      authenticated.families.server.baseline[0].report.execution.github.runUrl;

    const result = derivePerformancePublication(authenticated, fixtureDerivationOptions());

    expect(result.publication.verdict.status).toBe('unproven');
    expect(result.publication.verdict.reasons.join('\n')).toContain(
      'server holdout reuses a baseline workflow run',
    );
    expect(result.publication.families.server.status).toBe('unproven');
  });

  it('reports dev/build publication as unproven when report-bound product evidence is absent or leaks into Next', () => {
    const missing = authenticatedFixture();
    missing.families['dev-n24'].holdout.report.productArtifact = null;

    const missingResult = derivePerformancePublication(missing, fixtureDerivationOptions());

    expect(missingResult.publication.verdict.status).toBe('unproven');
    expect(missingResult.publication.verdict.reasons.join('\n')).toContain(
      'dev-n24 packed product evidence is invalid',
    );
    expect(missingResult.publication.families['dev-n24'].status).toBe('unproven');

    const contaminated = authenticatedFixture();
    const nextCell = contaminated.families['build-n216'].holdout.report.rawCells.find(
      (cell) => cell.framework === 'nextjs',
    );
    nextCell.report.integrity.productArtifact = {
      afterVerified: true,
      beforeVerified: true,
      required: true,
    };

    const contaminatedResult = derivePerformancePublication(
      contaminated,
      fixtureDerivationOptions(),
    );

    expect(contaminatedResult.publication.verdict.status).toBe('unproven');
    expect(contaminatedResult.publication.verdict.reasons.join('\n')).toContain(
      'holdout packed-next/nextjs/build carried Kovo product evidence',
    );
    expect(contaminatedResult.publication.families['build-n216'].status).toBe('unproven');
  });

  it('reports unproven for cross-family source, lock, execution, or custody divergence', () => {
    const authenticated = authenticatedFixture();
    const entry = authenticated.families.check.holdout;
    entry.report.source.locks = {
      ...entry.report.source.locks,
      'pnpm-lock.yaml': digest('changed'),
    };
    entry.report.execution.digest =
      authenticated.families.browser.baseline[0].report.execution.digest;
    entry.custody.reportContentDigest = digest('wrong');

    const result = derivePerformancePublication(authenticated, fixtureDerivationOptions());

    expect(result.publication.verdict.status).toBe('unproven');
    expect(result.publication.verdict.reasons.join('\n')).toMatch(
      /dependency locks differ|duplicate execution identity|custody content digest differs/u,
    );
  });

  it('refuses a short or incomplete seven-family input before reading any path', async () => {
    const input = {
      campaign: campaignManifestStub(),
      families: Object.fromEntries(
        FAMILY_NAMES.map((name) => [
          name,
          {
            baseline: Array.from({ length: name === 'browser' ? 4 : 5 }, () => ({})),
            holdout: {},
          },
        ]),
      ),
      productionBytes: {},
      repository: 'kovojs/kovo',
      schema: PERF_PUBLICATION_INPUT_SCHEMA,
    };

    await expect(authenticatePerformancePublicationInput(input)).rejects.toThrow(
      'browser must contain exactly five baseline reports and one holdout',
    );
    delete input.families.check;
    await expect(authenticatePerformancePublicationInput(input)).rejects.toThrow(
      'exact seven-family census',
    );

    const profileInput = {
      buildProfiles: { unchanged: {} },
      campaign: campaignManifestStub(),
      families: Object.fromEntries(
        FAMILY_NAMES.map((name) => [
          name,
          { baseline: Array.from({ length: 5 }, () => ({})), holdout: {} },
        ]),
      ),
      productionBytes: {},
      repository: 'kovojs/kovo',
      schema: PERF_PUBLICATION_INPUT_SCHEMA,
    };
    await expect(authenticatePerformancePublicationInput(profileInput)).rejects.toThrow(
      'buildProfiles must contain exactly unchanged and edit evidence',
    );

    const shared = {
      apiMetadata: 'profile/artifact.api.json',
      archive: 'profile/artifact.zip',
      jobsApiMetadata: 'profile/jobs.api.json',
      report: 'profile/unchanged.json',
      runApiMetadata: 'profile/run.api.json',
    };
    profileInput.buildProfiles = {
      edit: { ...shared, report: 'profile/edit.json' },
      unchanged: shared,
    };
    await expect(authenticatePerformancePublicationInput(profileInput)).rejects.toThrow(
      'may share only one exact archive',
    );

    delete profileInput.buildProfiles;
    delete profileInput.productionBytes;
    await expect(authenticatePerformancePublicationInput(profileInput)).rejects.toThrow(
      'one Production bytes evidence descriptor',
    );
  });

  it('writes content-addressed family documents plus the aggregate JSON and Markdown', async () => {
    const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'kovo-perf-publication-')));
    temporaryDirectories.push(directory);
    const authenticated = authenticatedFixture();
    const options = fixtureDerivationOptions();
    const result = derivePerformancePublication(authenticated, options);
    const root = path.join(directory, 'publication');
    const evidenceDirectory = path.join(root, 'evidence');
    const out = path.join(root, 'performance-publication.json');
    const markdownOut = path.join(root, 'performance-publication.md');

    await writePerformancePublicationOutputs(result, {
      assessBuildPersistence: options.assessBuildPersistence,
      authenticated,
      evidenceDirectory,
      markdownOut,
      operations: options.operations,
      out,
      ratify: (entries) => options.ratify(entries),
    });

    const publication = JSON.parse(readFileSync(out, 'utf8'));
    expect(performancePublicationFindings(publication)).toEqual([]);
    expect(readFileSync(markdownOut, 'utf8')).toContain('Verdict: **publishable**');
    expect(readdirSync(root).sort()).toEqual([
      'evidence',
      'performance-publication.json',
      'performance-publication.md',
    ]);
    expect(readdirSync(evidenceDirectory)).toHaveLength(21);
    expect(readdirSync(evidenceDirectory).some((name) => name.includes('production-bytes'))).toBe(
      false,
    );
    for (const familyName of FAMILY_NAMES) {
      for (const kind of ['baseline', 'budget', 'evaluation']) {
        const file = readFileSync(path.join(evidenceDirectory, `${familyName}-${kind}.json`));
        expect(digest(file)).toBe(publication.families[familyName].documents[kind].contentDigest);
      }
    }
  });

  it('accepts a completed failed workflow run when the referenced producer job succeeded', () => {
    const authenticated = authenticatedFixture();
    authenticated.families.browser.baseline[0].custody.workflow.conclusion = 'failure';

    const result = derivePerformancePublication(authenticated, fixtureDerivationOptions());

    expect(result.publication.verdict.status).toBe('publishable');
    expect(performancePublicationFindings(result.publication)).toEqual([]);
    expect(result.publication.families.browser.evidence.baseline[0].workflow).toMatchObject({
      conclusion: 'failure',
      job: { conclusion: 'success', name: 'Browser matrix' },
      status: 'completed',
    });
  });

  it('rejects a readback directory containing evidence outside the exact 21-file census', async () => {
    const directory = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), 'kovo-perf-publication-extra-')),
    );
    temporaryDirectories.push(directory);
    const root = path.join(directory, 'publication');
    const evidenceDirectory = path.join(root, 'evidence');
    mkdirSync(path.join(evidenceDirectory, 'nested'), { recursive: true });
    writeFileSync(path.join(evidenceDirectory, 'nested', 'stale.json'), '{}\n');
    const authenticated = authenticatedFixture();
    const options = fixtureDerivationOptions();
    const result = derivePerformancePublication(authenticated, options);

    await expect(
      writePerformancePublicationOutputs(result, {
        assessBuildPersistence: options.assessBuildPersistence,
        authenticated,
        evidenceDirectory,
        markdownOut: path.join(root, 'performance-publication.md'),
        operations: options.operations,
        out: path.join(root, 'performance-publication.json'),
        ratify: (entries) => options.ratify(entries),
      }),
    ).rejects.toThrow(/partial or extra inventory/u);
  });

  it('rejects publication symlinks and output paths outside the exact 23-file layout', async () => {
    const directory = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), 'kovo-perf-publication-layout-')),
    );
    temporaryDirectories.push(directory);
    const authenticated = authenticatedFixture();
    const options = fixtureDerivationOptions();
    const result = derivePerformancePublication(authenticated, options);
    const wrongRoot = path.join(directory, 'wrong');
    await expect(
      writePerformancePublicationOutputs(result, {
        assessBuildPersistence: options.assessBuildPersistence,
        authenticated,
        evidenceDirectory: path.join(wrongRoot, 'evidence'),
        markdownOut: path.join(wrongRoot, 'performance-publication.md'),
        operations: options.operations,
        out: path.join(wrongRoot, 'publication.json'),
        ratify: (entries) => options.ratify(entries),
      }),
    ).rejects.toThrow(/must use publication/u);

    const aliasRoot = path.join(directory, 'alias');
    await expect(
      writePerformancePublicationOutputs(result, {
        assessBuildPersistence: options.assessBuildPersistence,
        authenticated,
        evidenceDirectory: `${aliasRoot}/nested/../evidence`,
        markdownOut: path.join(aliasRoot, 'performance-publication.md'),
        operations: options.operations,
        out: path.join(aliasRoot, 'performance-publication.json'),
        ratify: (entries) => options.ratify(entries),
      }),
    ).rejects.toThrow(/canonical absolute path without layout aliases/u);

    const realParent = path.join(directory, 'real-parent');
    const aliasParent = path.join(directory, 'alias-parent');
    mkdirSync(path.join(realParent, 'sub'), { recursive: true });
    symlinkSync(realParent, aliasParent);
    const ancestorAliasRoot = path.join(aliasParent, 'sub', 'publication');
    await expect(
      writePerformancePublicationOutputs(result, {
        assessBuildPersistence: options.assessBuildPersistence,
        authenticated,
        evidenceDirectory: path.join(ancestorAliasRoot, 'evidence'),
        markdownOut: path.join(ancestorAliasRoot, 'performance-publication.md'),
        operations: options.operations,
        out: path.join(ancestorAliasRoot, 'performance-publication.json'),
        ratify: (entries) => options.ratify(entries),
      }),
    ).rejects.toThrow(/symlink ancestor or realpath alias/u);
    expect(existsSync(path.join(realParent, 'sub', 'publication'))).toBe(false);

    const root = path.join(directory, 'publication');
    mkdirSync(root);
    symlinkSync(directory, path.join(root, 'evidence'));
    await expect(
      writePerformancePublicationOutputs(result, {
        assessBuildPersistence: options.assessBuildPersistence,
        authenticated,
        evidenceDirectory: path.join(root, 'evidence'),
        markdownOut: path.join(root, 'performance-publication.md'),
        operations: options.operations,
        out: path.join(root, 'performance-publication.json'),
        ratify: (entries) => options.ratify(entries),
      }),
    ).rejects.toThrow(/partial or extra inventory/u);
  });

  it('detects aggregate-manifest mutation through its canonical digest', () => {
    const result = derivePerformancePublication(authenticatedFixture(), fixtureDerivationOptions());
    result.publication.families.browser.status = 'blocked';

    expect(performancePublicationFindings(result.publication)).toContain(
      'publication digest is not derived from its facts',
    );
  });

  it('rejects a resealed evidence reference whose workflow head differs from its source', () => {
    const result = derivePerformancePublication(authenticatedFixture(), fixtureDerivationOptions());
    const evidence = result.publication.families.browser.evidence.baseline[0];
    const advancedSha = 'c'.repeat(40);
    evidence.workflow.workflowSha = advancedSha;
    evidence.workflow.workflowHeadSha = advancedSha;
    evidence.workflow.workflowApiUrl = `https://api.github.com/repos/kovojs/kovo/contents/.github/workflows/perf-realistic.yml?ref=${advancedSha}`;
    resealPublication(result.publication);

    expect(performancePublicationFindings(result.publication)).toContain(
      'browser baseline live workflow authority differs from baseline policy',
    );
  });

  it('publishes the build-session assessment and reports profile-required as unproven', () => {
    const options = fixtureDerivationOptions();
    options.assessBuildPersistence = ({ n24Budget, n216Budget }) =>
      fixturePersistenceAssessment(n24Budget, n216Budget, {
        findings: ['current authenticated N=216 unchanged and edit CPU profiles are required'],
        outcome: 'profile-required',
        rationale: 'current-profile-required',
      });

    const authenticated = authenticatedFixture();
    const result = derivePerformancePublication(authenticated, options);

    expect(result.publication.buildPersistenceAssessment.verdict).toMatchObject({
      outcome: 'profile-required',
      status: 'unproven',
    });
    expect(result.publication.verdict.status).toBe('unproven');
    expect(result.publication.verdict.reasons).toContain(
      'build persistence current authenticated N=216 unchanged and edit CPU profiles are required',
    );
    expect(performancePublicationFindings(result.publication)).toEqual([]);
    expect(
      performancePublicationResultFindings(result, {
        assessBuildPersistence: options.assessBuildPersistence,
        authenticated,
        operations: options.operations,
        ratify: (entries) => options.ratify(entries),
      }),
    ).toEqual([]);
    expect(renderFixturePublication(result, { authenticated, options })).toContain(
      'Outcome: **profile-required** (current-profile-required).',
    );
  });

  it('keeps an unresolved build-session predicate unproven rather than blocking or publishing', () => {
    const options = fixtureDerivationOptions();
    const finding =
      'mixed warm-cell evidence satisfies neither not-warranted shortcut nor the N=216 warrant predicate';
    options.assessBuildPersistence = ({ n24Budget, n216Budget }) =>
      fixturePersistenceAssessment(n24Budget, n216Budget, {
        findings: [finding],
        outcome: 'unproven',
        rationale: 'mixed-evidence-unresolved',
      });

    const authenticated = authenticatedFixture();
    const result = derivePerformancePublication(authenticated, options);

    expect(result.publication.verdict).toEqual({
      failures: [],
      reasons: [`build persistence ${finding}`],
      status: 'unproven',
    });
    expect(performancePublicationFindings(result.publication)).toEqual([]);

    const forged = structuredClone(result.publication);
    forged.verdict = { failures: [], reasons: [], status: 'publishable' };
    resealPublication(forged);
    expect(performancePublicationFindings(forged)).toEqual(
      expect.arrayContaining([
        'publication verdict does not retain the unproven build persistence findings',
        'publication verdict is not derived from its family and sidecar census',
      ]),
    );
    expect(() =>
      renderFixturePublication({ ...result, publication: forged }, { authenticated, options }),
    ).toThrow(/unproven build persistence findings/u);
  });

  it('returns no partial output when an unproven browser cannot produce all 21 documents', async () => {
    const authenticated = authenticatedFixture();
    const options = fixtureDerivationOptions();
    options.operations.browser = {
      ...options.operations.browser,
      derive() {
        throw new TypeError('raw browser posture is unproven');
      },
    };
    const result = derivePerformancePublication(authenticated, options);
    expect(result.publication.verdict.status).toBe('unproven');
    expect(result.documents.browser).toBeUndefined();
    expect(
      performancePublicationResultFindings(result, {
        assessBuildPersistence: options.assessBuildPersistence,
        authenticated,
        operations: options.operations,
        ratify: (entries) => options.ratify(entries),
      }),
    ).toEqual(
      expect.arrayContaining([
        'browser budget table metrics are unavailable',
        'publication does not retain the exact 21 derived documents',
      ]),
    );
    expect(() => renderFixturePublication(result, { authenticated, options })).toThrow(
      /Performance publication result is invalid/u,
    );

    const directory = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), 'kovo-perf-publication-unproven-browser-')),
    );
    temporaryDirectories.push(directory);
    const root = path.join(directory, 'publication');
    await expect(
      writePerformancePublicationOutputs(result, {
        assessBuildPersistence: options.assessBuildPersistence,
        authenticated,
        evidenceDirectory: path.join(root, 'evidence'),
        markdownOut: path.join(root, 'performance-publication.md'),
        operations: options.operations,
        out: path.join(root, 'performance-publication.json'),
        ratify: (entries) => options.ratify(entries),
      }),
    ).rejects.toThrow(/Performance publication result is invalid/u);
    expect(existsSync(root)).toBe(false);
  });

  it('requires a measured foreground-session decision when the authenticated predicate warrants it', () => {
    const options = fixtureDerivationOptions();
    const profileEntries = buildProfileEntryPairFixture();
    options.assessBuildPersistence = ({ n24Budget, n216Budget }) =>
      fixturePersistenceAssessment(n24Budget, n216Budget, {
        outcome: 'warranted',
        profileEntries,
        rationale: 'n216-miss-upper-residual-and-session-eligible-top-five-proven',
      });

    const authenticated = authenticatedFixture();
    const result = derivePerformancePublication(authenticated, options);
    const requiredFailure =
      'build-persistence:foreground-session-implementation-and-measured-decision-required';

    expect(result.publication.buildPersistenceAssessment.verdict).toMatchObject({
      findings: [],
      outcome: 'warranted',
      status: 'decided',
    });
    expect(result.publication.verdict).toMatchObject({
      failures: [requiredFailure],
      reasons: [],
      status: 'blocked',
    });
    expect(performancePublicationFindings(result.publication)).toEqual([]);
    expect(
      performancePublicationResultFindings(result, {
        assessBuildPersistence: options.assessBuildPersistence,
        authenticated,
        operations: options.operations,
        ratify: (entries) => options.ratify(entries),
      }),
    ).toEqual([]);
    expect(renderFixturePublication(result, { authenticated, options })).toContain(
      `- ${requiredFailure}`,
    );

    const forged = structuredClone(result.publication);
    forged.verdict = { failures: [], reasons: [], status: 'publishable' };
    resealPublication(forged);

    expect(performancePublicationFindings(forged)).toEqual(
      expect.arrayContaining([
        'publication blocking failures are not derived from its families and build persistence decision',
        'publication verdict is not derived from its family and sidecar census',
      ]),
    );
    expect(() =>
      renderFixturePublication({ ...result, publication: forged }, { authenticated, options }),
    ).toThrow(/publication blocking failures are not derived/u);
  });

  it('retains data-plane regression checks in the exact dev publication census', () => {
    const authenticated = authenticatedFixture();
    const options = fixtureDerivationOptions();
    const result = derivePerformancePublication(authenticated, options);
    const dataP95 = 'corpus-n24/dev//edit.dataMs.p95';

    for (const phase of ['baseline', 'holdout']) {
      expect(result.publication.families['dev-n24'].targetAssessment[phase].checks).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: dataP95, kind: 'regression' })]),
      );
    }
    expect(renderFixturePublication(result, { authenticated, options })).toContain(dataP95);

    const forged = structuredClone(result.publication);
    for (const phase of ['baseline', 'holdout']) {
      forged.families['dev-n24'].targetAssessment[phase].checks = forged.families[
        'dev-n24'
      ].targetAssessment[phase].checks.filter(({ id }) => id !== dataP95);
    }
    resealPublication(forged);

    expect(performancePublicationFindings(forged)).toEqual(
      expect.arrayContaining([
        'dev-n24 baseline target check census differs from policy',
        'dev-n24 holdout target check census differs from policy',
      ]),
    );
    expect(() =>
      renderFixturePublication({ ...result, publication: forged }, { authenticated, options }),
    ).toThrow(/dev-n24 baseline target check census differs from policy/u);
  });

  it('blocks the aggregate when an otherwise measured dev holdout regresses on dataMs', () => {
    const authenticated = authenticatedFixture();
    const options = fixtureDerivationOptions();
    options.operations['dev-n24'] = {
      ...options.operations['dev-n24'],
      evaluate: (budget, candidate) => {
        const evaluation = fixtureEvaluation('dev-n24', budget, candidate);
        const id = 'corpus-n24/dev//edit.dataMs.p95';
        const check = evaluation.checks.find((entry) => entry.id === id);
        check.status = 'fail';
        check.value = check.limit + 1;
        evaluation.verdict = { failures: [id], reasons: [], status: 'regression' };
        return evaluation;
      },
    };

    const result = derivePerformancePublication(authenticated, options);

    expect(result.publication.families['dev-n24']).toMatchObject({
      holdoutEvaluation: {
        failures: ['corpus-n24/dev//edit.dataMs.p95'],
        status: 'regression',
      },
      status: 'blocked',
      targetAssessment: {
        holdout: {
          failures: ['corpus-n24/dev//edit.dataMs.p95'],
          status: 'fail',
        },
        status: 'fail',
      },
    });
    expect(result.publication.verdict).toMatchObject({
      failures: [
        'dev-n24:corpus-n24/dev//edit.dataMs.p95',
        'dev-n24:holdout:corpus-n24/dev//edit.dataMs.p95',
      ],
      status: 'blocked',
    });
    expect(performancePublicationFindings(result.publication)).toEqual([]);
    expect(renderFixturePublication(result, { authenticated, options })).toContain(
      'holdout [completion] corpus-n24/dev//edit.dataMs.p95',
    );
  });

  it('rejects a self-consistently resealed evaluation and target policy mutation', async () => {
    const authenticated = authenticatedFixture();
    const options = fixtureDerivationOptions();
    const result = derivePerformancePublication(authenticated, options);
    const evaluation = result.documents.browser.evaluation;
    evaluation.checks[0].limit = 1_000_000;
    const reference = result.publication.families.browser.documents.evaluation;
    reference.contentDigest = digest(`${JSON.stringify(evaluation, null, 2)}\n`);
    reference.semanticDigest = canonicalDigest(evaluation);
    result.publication.families.browser.targetAssessment.holdout.checks[0].limit = 1_000_000;
    resealPublication(result.publication);

    expect(performancePublicationFindings(result.publication)).toContain(
      'browser holdout target check census differs from policy',
    );
    const findings = performancePublicationResultFindings(result, {
      assessBuildPersistence: options.assessBuildPersistence,
      authenticated,
      operations: options.operations,
      ratify: (entries) => options.ratify(entries),
    });
    expect(findings.join('\n')).toMatch(/evaluation document differs|aggregate summary differs/u);
    expect(() => renderFixturePublication(result, { authenticated, options })).toThrow(
      /Performance publication result is invalid/u,
    );

    const directory = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), 'kovo-perf-publication-mutation-')),
    );
    temporaryDirectories.push(directory);
    const root = path.join(directory, 'publication');
    await expect(
      writePerformancePublicationOutputs(result, {
        assessBuildPersistence: options.assessBuildPersistence,
        authenticated,
        evidenceDirectory: path.join(root, 'evidence'),
        markdownOut: path.join(root, 'performance-publication.md'),
        operations: options.operations,
        out: path.join(root, 'performance-publication.json'),
        ratify: (entries) => options.ratify(entries),
      }),
    ).rejects.toThrow('Performance publication result is invalid');
  });

  it('rejects resealed missing checks and a fabricated paired Brotli target', () => {
    const missing = derivePerformancePublication(
      authenticatedFixture(),
      fixtureDerivationOptions(),
    ).publication;
    missing.families.browser.targetAssessment.baseline.checks.pop();
    resealPublication(missing);
    expect(performancePublicationFindings(missing)).toContain(
      'browser baseline target check census differs from policy',
    );

    const fabricated = derivePerformancePublication(
      authenticatedFixture(),
      fixtureDerivationOptions(),
    ).publication;
    fabricated.families.server.targetAssessment.holdout.checks[0].id =
      'matched-runtime/server/hit-listing-br-c1/requestsPerSecond.median-vs-next';
    resealPublication(fabricated);
    expect(performancePublicationFindings(fabricated)).toContain(
      'server holdout target check census differs from policy',
    );
  });

  it('rejects a resealed attempt to relabel a blocking failure as follow-on', () => {
    const authenticated = authenticatedFixture();
    const options = fixtureDerivationOptions();
    options.operations['dev-n24'] = {
      ...options.operations['dev-n24'],
      evaluate: (budget, candidate) => {
        const evaluation = fixtureEvaluation('dev-n24', budget, candidate);
        const id = 'corpus-n24/dev//edit.dataMs.p95';
        const check = evaluation.checks.find((entry) => entry.id === id);
        check.status = 'fail';
        check.value = check.limit + 1;
        evaluation.verdict = { failures: [id], reasons: [], status: 'regression' };
        return evaluation;
      },
    };
    const publication = derivePerformancePublication(authenticated, options).publication;
    const evaluation = publication.families['dev-n24'].holdoutEvaluation;
    evaluation.followOnFailures = [...evaluation.blockingFailures];
    evaluation.blockingFailures = [];
    resealPublication(publication);

    expect(performancePublicationFindings(publication)).toContain(
      'dev-n24 holdout evaluation blocking/follow-on partition is not derived from policy',
    );
  });

  it.each(['build-n24', 'check'])(
    'rejects a resealed %s completion-check relabel in the aggregate validator',
    (familyName) => {
      const authenticated = authenticatedFixture();
      const options = fixtureDerivationOptions();
      options.operations[familyName] = {
        ...options.operations[familyName],
        evaluate: (budget, candidate) => {
          const evaluation = fixtureEvaluation(familyName, budget, candidate);
          const check = evaluation.checks[0];
          check.status = 'fail';
          check.value = check.limit + 1;
          evaluation.verdict = {
            failures: [check.id],
            reasons: [],
            status: 'regression',
          };
          return evaluation;
        },
      };
      const publication = derivePerformancePublication(authenticated, options).publication;
      const family = publication.families[familyName];
      const id = family.targetAssessment.holdout.checks[0].id;
      const holdout = family.targetAssessment.holdout;
      holdout.checks[0].kind = 'competitive-target';
      holdout.checks[0].publicationImpact = 'follow-on';
      holdout.blockingFailures = [];
      holdout.blockingStatus = 'not-applicable';
      holdout.followOnFailures = [id];
      holdout.followOnStatus = 'fail';
      family.targetAssessment.blockingFailures = [];
      family.targetAssessment.blockingStatus = 'pass';
      family.targetAssessment.followOnFailures = [`holdout:${id}`];
      family.targetAssessment.followOnStatus = 'fail';
      family.holdoutEvaluation.blockingFailures = [];
      family.holdoutEvaluation.followOnFailures = [id];
      family.status = 'pass';
      publication.verdict = { failures: [], reasons: [], status: 'publishable' };
      resealPublication(publication);

      expect(performancePublicationFindings(publication)).toContain(
        `${familyName} holdout target check census differs from policy`,
      );
    },
  );

  it('rejects a resealed deletion of one complete family document set', () => {
    const authenticated = authenticatedFixture();
    const options = fixtureDerivationOptions();
    const result = derivePerformancePublication(authenticated, options);
    const family = result.publication.families.browser;
    result.publication.families.browser = {
      architecture: family.architecture,
      comparisonPosture: family.comparisonPosture,
      documents: null,
      evidence: null,
      host: null,
      holdoutEvaluation: null,
      status: 'unproven',
      targetAssessment: null,
      workload: null,
    };
    delete result.documents.browser;
    result.publication.verdict = {
      failures: [],
      reasons: ['browser evidence was removed'],
      status: 'unproven',
    };
    resealPublication(result.publication);

    expect(performancePublicationFindings(result.publication)).toEqual([]);
    expect(
      performancePublicationResultFindings(result, {
        assessBuildPersistence: options.assessBuildPersistence,
        authenticated,
        operations: options.operations,
        ratify: (entries) => options.ratify(entries),
      }).join('\n'),
    ).toMatch(/browser baseline document differs|exact 21 derived documents/u);
  });

  it('rejects a self-consistently resealed build-persistence assessment mutation', () => {
    const authenticated = authenticatedFixture();
    const options = fixtureDerivationOptions();
    const result = derivePerformancePublication(authenticated, options);
    result.publication.buildPersistenceAssessment.cells[0].wall.kovoP95Ms += 1;
    resealDocument(result.publication.buildPersistenceAssessment);
    resealPublication(result.publication);

    expect(performancePublicationFindings(result.publication)).toEqual([]);
    expect(
      performancePublicationResultFindings(result, {
        assessBuildPersistence: options.assessBuildPersistence,
        authenticated,
        operations: options.operations,
        ratify: (entries) => options.ratify(entries),
      }).join('\n'),
    ).toContain('build persistence assessment differs from its exact budgets and profile evidence');
  });

  it('accepts the required config-static-trust profile when source posture executed it', () => {
    const entry = buildProfileEntryFixture('unchanged');

    expect(entry.report.profileArtifacts.map(({ role }) => role)).toContain('config-static-trust');
    expect(buildProfilePublicationFindings(entry, 'unchanged')).toEqual([]);
  });

  it('accepts a build profile from a completed failed run when its producer job succeeded', () => {
    const entry = buildProfileEntryFixture('unchanged');
    entry.custody.workflow.conclusion = 'failure';

    expect(buildProfilePublicationFindings(entry, 'unchanged')).toEqual([]);
  });

  it.each(['not-applicable', 'reused-authenticated'])(
    'accepts the exact eight-role profile set when config trust is %s',
    (configTrustStatus) => {
      const entry = buildProfileEntryFixture('unchanged', {
        configTrustStatus,
      });

      expect(entry.report.profileArtifacts.map(({ role }) => role)).not.toContain(
        'config-static-trust',
      );
      expect(buildProfilePublicationFindings(entry, 'unchanged')).toEqual([]);
    },
  );

  it('rejects a missing config-static-trust process when source posture executed it', () => {
    const entry = buildProfileEntryFixture('unchanged');
    entry.report.capture.processCensus.processes =
      entry.report.capture.processCensus.processes.filter(
        ({ role }) => role !== 'config-static-trust',
      );
    resealBuildProfileEntry(entry);

    expect(buildProfilePublicationFindings(entry, 'unchanged').join('\n')).toContain(
      'process PID/role census is incomplete or duplicated',
    );
  });

  it('rejects a missing config-static-trust profile when source posture executed it', () => {
    const entry = buildProfileEntryFixture('unchanged', {
      configTrustStatus: 'not-applicable',
    });
    profileConfigTrustPhase(entry).status = 'executed';
    resealBuildProfileEntry(entry);

    expect(buildProfilePublicationFindings(entry, 'unchanged')).toContain(
      'unchanged original-process profile census differs from policy',
    );
  });

  it('rejects an extra config-static-trust profile when source posture did not execute it', () => {
    const entry = buildProfileEntryFixture('unchanged');
    profileConfigTrustPhase(entry).status = 'reused-authenticated';
    resealBuildProfileEntry(entry);

    expect(buildProfilePublicationFindings(entry, 'unchanged')).toContain(
      'unchanged original-process profile census differs from policy',
    );
  });

  it('rejects malformed or timing-bearing source phase posture before raw derivation', () => {
    const entry = buildProfileEntryFixture('unchanged');
    entry.report.sourcePhasePosture.phases[0].durationMs = 1;
    resealBuildProfileEntry(entry);

    expect(buildProfilePublicationFindings(entry, 'unchanged').join('\n')).toContain(
      'unchanged build profile source phase posture is unavailable',
    );
  });

  it('fails closed instead of throwing on malformed build-profile evidence', () => {
    const entry = buildProfileEntryFixture('unchanged');
    entry.rawText = {};
    entry.report.profileArtifacts = [null];
    entry.custody.archiveMembers = [null];

    expect(() => buildProfilePublicationFindings(entry, 'unchanged')).not.toThrow();
    expect(buildProfilePublicationFindings(entry, 'unchanged').length).toBeGreaterThan(0);
  });

  it('rejects a dispatch build profile whose evaluated workflow is not the measured source', () => {
    const entry = buildProfileEntryFixture('unchanged');
    const advancedSha = 'c'.repeat(40);
    entry.custody.workflow.workflowSha = advancedSha;
    entry.custody.workflow.workflowHeadSha = advancedSha;
    entry.custody.workflow.workflowApiUrl = `https://api.github.com/repos/kovojs/kovo/contents/.github/workflows/perf-realistic.yml?ref=${advancedSha}`;
    entry.report.execution.github.workflowSha = advancedSha;
    resealBuildProfileEntry(entry);

    expect(buildProfilePublicationFindings(entry, 'unchanged')).toContain(
      'unchanged build profile workflow authority differs from policy',
    );
  });

  it('requires the shared build-profile ZIP to equal the exact two-mode declared union', () => {
    const authenticated = authenticatedFixture();
    authenticated.buildProfiles = buildProfileEntryPairFixture();
    const options = fixtureDerivationOptions();

    expect(derivePerformancePublication(authenticated, options).publication.verdict.status).toBe(
      'publishable',
    );

    for (const entry of authenticated.buildProfiles) {
      entry.custody.archiveMembers.push(
        archiveMemberFixture('undeclared-stale.bin', Buffer.from('stale')),
      );
      entry.custody.archiveMembers.sort((left, right) => left.member.localeCompare(right.member));
    }
    expect(
      derivePerformancePublication(authenticated, options).publication.verdict.reasons.join('\n'),
    ).toContain('build profile ZIP census differs from the exact two-mode declared union');
  });

  it('rejects a resealed authored top five that differs from the raw process profiles', () => {
    const entry = buildProfileEntryFixture('unchanged');
    entry.report.topFive[0].selfSamples += 1;
    entry.report.capture.profileSetAnalysis.topFive[0].selfSamples += 1;
    resealBuildProfileEntry(entry);

    expect(buildProfilePublicationFindings(entry, 'unchanged').join('\n')).toContain(
      'profile analysis and top five are not derived from raw originals',
    );
  });

  it('rejects resealed wait-sample and process-role claims not present in raw evidence', () => {
    const entry = buildProfileEntryFixture('unchanged');
    entry.report.profileArtifacts[0].waitSamples -= 1;
    entry.report.profileArtifacts[0].activeSamples += 1;
    entry.report.capture.profileSetAnalysis.profileCensus[0].waitSamples -= 1;
    entry.report.capture.profileSetAnalysis.profileCensus[0].activeSamples += 1;
    entry.report.capture.processCensus.processes[1].role = 'native-one-shot';
    resealBuildProfileEntry(entry);

    const findings = buildProfilePublicationFindings(entry, 'unchanged').join('\n');
    expect(findings).toContain('sample census is not derived from raw bytes');
    expect(findings).toContain('process PID, role, executable, or entry identity is malformed');
  });

  it('rejects a self-consistently rebound convenience profile that is not the raw-profile merge', () => {
    const entry = buildProfileEntryFixture('unchanged');
    const auxiliary = entry.auxiliaries.find(
      ({ member }) => member === 'build-unchanged.cpuprofile',
    );
    auxiliary.bytes = Buffer.concat([auxiliary.bytes, Buffer.from('\n')]);
    auxiliary.contentDigest = digest(auxiliary.bytes);
    entry.report.profileArtifact.bytes = auxiliary.bytes.length;
    entry.report.profileArtifact.sha256 = auxiliary.contentDigest;
    rebindAuxiliaryCustody(entry, auxiliary);
    resealBuildProfileEntry(entry);

    expect(buildProfilePublicationFindings(entry, 'unchanged').join('\n')).toContain(
      'merged profile convenience bytes are not derived from raw originals',
    );
  });
});

function renderFixturePublication(result, { authenticated, options }) {
  return renderPerformancePublicationMarkdown(result, {
    assessBuildPersistence: options.assessBuildPersistence,
    authenticated,
    operations: options.operations,
    ratify: (entries) => options.ratify(entries),
  });
}

function fixtureDerivationOptions() {
  return {
    assessBuildPersistence: ({ n24Budget, n216Budget }) =>
      fixturePersistenceAssessment(n24Budget, n216Budget),
    generatedAt: '2026-08-14T00:00:00.000Z',
    operations: Object.fromEntries(
      FAMILY_NAMES.map((familyName) => [
        familyName,
        {
          baselineFindings: () => [],
          budgetFindings: () => [],
          derive: (baseline) => fixtureBudget(familyName, baseline),
          evaluate: (budget, candidate) => fixtureEvaluation(familyName, budget, candidate),
          targetKinds: targetKinds(familyName),
        },
      ]),
    ),
    ratify(entries) {
      const first = entries[0].report;
      return {
        generatedAt: '2026-08-14T00:00:00.000Z',
        identity: {
          host: first.host.digest,
          locks: first.source.locks,
          source: first.source.commit,
          workload: first.workloadIdentity.digest,
        },
        metrics: {},
        policy: { maxLoadPerCpu: 1, minRuns: 5, minSamples: 5, requireProvider: 'github-actions' },
        reports: entries.map((entry) => ({
          contentDigest: entry.contentDigest,
          execution: entry.report.execution.digest,
          location: entry.location,
          runUrl: entry.report.execution.github.runUrl,
        })),
        schema: 'kovo-performance-baseline/v1',
        subject: {
          host: first.host,
          locks: first.source.locks,
          sourceCommit: first.source.commit,
          workloadIdentity: first.workloadIdentity,
        },
        verdict: { reasons: [], status: 'ratified' },
      };
    },
  };
}

function campaignManifestStub() {
  const reference = (pathValue) => ({
    byteLength: 1,
    contentDigest: digest(pathValue),
    path: pathValue,
  });
  const selectedProductionBytes = {
    artifactId: 1,
    runCreatedAt: '2026-08-13T00:00:00Z',
    runId: 1,
  };
  return {
    boundary: { firstRunId: 1, lastRunId: 1 },
    productionBytes: [selectedProductionBytes],
    runs: [
      {
        artifactsApiMetadata: reference('campaign/artifacts.api.json'),
        runApiMetadata: reference('campaign/run.api.json'),
        runCreatedAt: selectedProductionBytes.runCreatedAt,
        runId: 1,
      },
    ],
    selectedProductionBytes,
    workflowRunsApiMetadata: reference('campaign/workflow-runs.api.json'),
  };
}

function fixturePersistenceAssessment(
  n24Budget,
  n216Budget,
  {
    findings = [],
    outcome = 'not-warranted',
    profileEntries = [],
    rationale = 'all-warm-cells-meet-first-milestone',
  } = {},
) {
  const facts = {
    budgets: { n24: n24Budget.digest, n216: n216Budget.digest },
    cells: [n24Budget, n216Budget].flatMap((budget) =>
      ['unchanged', 'edit'].map((mode) => {
        const profileBranch =
          ['profile-required', 'warranted'].includes(outcome) &&
          budget.subject.corpusSize === 216 &&
          mode === 'unchanged';
        return {
          artifactBytes: { kovoMedian: 1_000, kovoP95: 1_010 },
          corpusSize: budget.subject.corpusSize,
          milestone: {
            peakRssMedianVsNextRatio: 1,
            status: profileBranch ? 'fail' : 'pass',
            wallMedianVsNextRatio: profileBranch ? 6.1 : 1,
          },
          mode,
          residualUpper: { medianRatio: profileBranch ? 0.1 : 0.05, samples: 50 },
          wall: {
            kovoMedianMs: profileBranch ? 610 : 100,
            kovoP95Ms: profileBranch ? 620 : 110,
            nextMedianMs: 100,
          },
        };
      }),
    ),
    policy: {
      appSourceTrustEligible: false,
      diskCacheEligible: false,
      sessionEligiblePhases: ['config-trust', 'typescript', 'stylesheet'],
      upperWallMinimumRatio: 0.1,
    },
    profiles: profileEntries.map((entry) => ({
      ...entry.custody,
      contentDigest: entry.contentDigest,
      execution: entry.report.execution.digest,
      location: entry.location,
      mode: entry.report.subject.mode,
      profileArtifact: entry.report.profileArtifact,
      reportDigest: entry.report.digest,
      topFive: entry.report.topFive,
    })),
    schema: 'kovo-build-persistence-assessment/v1',
    verdict: {
      findings,
      outcome,
      rationale,
      status: ['profile-required', 'unproven'].includes(outcome) ? 'unproven' : 'decided',
    },
  };
  return { ...facts, digest: digest(canonicalJson(facts)) };
}

function fixtureBudget(familyName, baseline) {
  const common = {
    baseline: { reports: baseline.reports, sourceCommit: baseline.identity.source },
    digest: digest(`${familyName}-budget`),
    policy: {},
    schema: `fixture-${familyName}-budget/v1`,
    subject: {},
  };
  if (familyName === 'browser') {
    return {
      ...common,
      metrics: Object.fromEntries(
        ['default', 'matched-l0', 'matched-l1'].flatMap((lane, laneIndex) =>
          [
            [`${lane}/browser//desktop.coldLoad.bytes.js`, 10 + laneIndex],
            [`${lane}/browser//mobile.navigation.navToPaintMs`, 100 + laneIndex],
          ].map(([metric, value]) => [
            metric,
            {
              baseline: {
                kovoMedian: value,
                kovoP95: value + 1,
                nextMedian: value + 10,
                nextP95: value + 11,
                pairedMedian: -10,
                runs: 5,
              },
              direction: 'lower-is-better',
              kind: 'ratified-regression-ceiling',
              medianMaximum: value * 1.05,
              p95Maximum: (value + 1) * 1.05,
            },
          ]),
        ),
      ),
      targetAssessment: {
        checks: fixtureComparisonTargetChecks('browser'),
        failures: [],
        status: 'pass',
      },
    };
  }
  if (familyName === 'server') {
    return {
      ...common,
      targetAssessment: {
        checks: fixtureComparisonTargetChecks('server'),
        failures: [],
        status: 'pass',
      },
    };
  }
  const corpusSize = familyName.endsWith('n216') ? 216 : 24;
  common.subject.corpusSize = corpusSize;
  if (familyName.startsWith('dev-')) {
    const prefix = `corpus-n${String(corpusSize)}/dev//`;
    common.policy.targets = {
      entryMedianVsNextMaximumRatio: 3,
      leafMedianVsNextMaximumRatio: 2,
      readyMedianVsNextMaximumRatio: 2,
      recoveryP95MaximumMs: 2_000,
      syntaxErrorP95MaximumMs: 1_000,
    };
    common.metrics = Object.fromEntries(
      [
        'edit.leafMs',
        'edit.entryMs',
        'edit.dataMs',
        'edit.syntaxErrorMs',
        'edit.recoveryMs',
        'edit.peakRssBytes',
        'ready.durationMs',
        'ready.peakRssBytes',
      ].map((suffix) => [
        `${prefix}${suffix}`,
        {
          baseline: { median: 100, nextMedian: 100, p95: 200 },
          medianMaximum: 105,
          p95Maximum: 210,
        },
      ]),
    );
    return common;
  }
  if (familyName.startsWith('build-')) {
    common.policy.targets = {
      peakRssMedianVsNextMaximumRatio: 2,
      wallMedianVsNextMaximumRatio: 6,
    };
    common.metrics = {};
    for (const mode of ['clean', 'unchanged', 'edit']) {
      for (const metric of ['durationMs', 'peakRssBytes']) {
        common.metrics[`corpus-n${String(corpusSize)}/build/${mode}/${metric}`] = {
          baseline: { median: 100, nextMedian: 100 },
        };
      }
    }
    return common;
  }
  common.metrics = {
    'check.appSourceTrust.marginalScalingExponent': {
      baseline: { p95: 1 },
      targetMaximum: 1.3,
    },
    'check.peakRssBytes': { baseline: { p95: 1_000 }, targetMaximum: 3 * 1024 ** 3 },
    'check.total.marginalScalingExponent': { baseline: { p95: 0.9 }, targetMaximum: 1 },
  };
  return common;
}

function fixtureEvaluation(familyName, budget, candidate) {
  const kind = targetKinds(familyName)[0];
  const checks =
    familyName === 'browser' || familyName === 'server'
      ? comparisonTargetCheckSpecifications(familyName).map((specification) => ({
          id: specification.id,
          kind: specification.kind,
          limit: specification.limit,
          status: 'pass',
          value: passingTargetObservation(specification),
        }))
      : familyName.startsWith('dev-')
        ? fixtureDevEvaluationChecks(budget)
        : familyName.startsWith('build-')
          ? fixtureBuildEvaluationChecks(budget)
          : familyName === 'check'
            ? fixtureCheckEvaluationChecks(budget)
            : [
                {
                  id: `${familyName}.target`,
                  kind,
                  limit: 2,
                  status: 'pass',
                  value: 1,
                },
              ];
  return {
    budget: budget.digest,
    candidate: { execution: candidate.execution.digest, sourceCommit: candidate.source.commit },
    checks,
    schema: `fixture-${familyName}-evaluation/v1`,
    verdict: { failures: [], reasons: [], status: 'pass' },
  };
}

function fixtureBuildEvaluationChecks(budget) {
  return ['clean', 'unchanged', 'edit'].flatMap((mode) => {
    const prefix = `corpus-n${String(budget.subject.corpusSize)}/build/${mode}/`;
    return [
      {
        id: `${prefix}durationMs.median-vs-next`,
        kind: 'milestone',
        limit: 6,
        status: 'pass',
        value: 1,
      },
      {
        id: `${prefix}peakRssBytes.median-vs-next`,
        kind: 'milestone',
        limit: 2,
        status: 'pass',
        value: 1,
      },
    ];
  });
}

function fixtureCheckEvaluationChecks(budget) {
  return Object.entries(budget.metrics).map(([metric, entry]) => ({
    id: `${metric}.absolute-target`,
    kind: 'target',
    limit: entry.targetMaximum,
    status: 'pass',
    value: entry.baseline.p95,
  }));
}

function fixtureDevEvaluationChecks(budget) {
  const prefix = `corpus-n${String(budget.subject.corpusSize)}/dev//`;
  return [
    ...Object.entries(budget.metrics).flatMap(([metric, entry]) => [
      {
        id: `${metric}.median`,
        kind: 'regression',
        limit: entry.medianMaximum,
        status: 'pass',
        value: entry.baseline.median,
      },
      {
        id: `${metric}.p95`,
        kind: 'regression',
        limit: entry.p95Maximum,
        status: 'pass',
        value: entry.baseline.p95,
      },
    ]),
    {
      id: `${prefix}ready.durationMs.median-vs-next`,
      kind: 'competitive-target',
      limit: 2,
      status: 'pass',
      value: 1,
    },
    {
      id: `${prefix}edit.leafMs.median-vs-next`,
      kind: 'competitive-target',
      limit: 2,
      status: 'pass',
      value: 1,
    },
    {
      id: `${prefix}edit.entryMs.median-vs-next`,
      kind: 'competitive-target',
      limit: 3,
      status: 'pass',
      value: 1,
    },
    {
      id: `${prefix}edit.syntaxErrorMs.p95-target`,
      kind: 'target',
      limit: 1_000,
      status: 'pass',
      value: 200,
    },
    {
      id: `${prefix}edit.recoveryMs.p95-target`,
      kind: 'target',
      limit: 2_000,
      status: 'pass',
      value: 200,
    },
  ];
}

function fixtureComparisonTargetChecks(familyName) {
  return comparisonTargetCheckSpecifications(familyName).map((specification) => ({
    id: specification.id,
    kind: specification.kind,
    limit: specification.limit,
    observed: passingTargetObservation(specification),
    operator: specification.operator,
    publicationImpact: specification.kind === 'competitive-target' ? 'follow-on' : 'completion',
    status: 'pass',
  }));
}

function passingTargetObservation(specification) {
  return specification.operator === '<=' ? specification.limit / 2 : specification.limit + 0.1;
}

function targetKinds(familyName) {
  if (familyName.startsWith('dev-')) return ['competitive-target', 'regression', 'target'];
  if (familyName.startsWith('build-')) return ['milestone'];
  if (familyName === 'browser') return ['milestone', 'competitive-target'];
  if (familyName === 'server') return ['competitive-target'];
  return ['target'];
}

function authenticatedFixture() {
  const sourceCommit = 'a'.repeat(40);
  const locks = {
    'benchmarks/harness/pnpm-lock.yaml': digest('harness-lock'),
    'benchmarks/nextjs/pnpm-lock.yaml': digest('next-lock'),
    'pnpm-lock.yaml': digest('root-lock'),
  };
  const productArtifact = fixturePackedKovoProductIdentity({
    locks,
    seed: 'publication',
    sourceCommit,
  });
  let artifactId = 2_000;
  const families = {};
  for (const familyName of FAMILY_NAMES) {
    const entries = Array.from({ length: 6 }, (_, index) => {
      artifactId += 1;
      const runId = artifactId + 10_000;
      const label = `${familyName}-${String(index)}`;
      const contentDigest = digest(`${label}-report`);
      const runUrl = `https://github.com/kovojs/kovo/actions/runs/${String(runId)}`;
      const runApiUrl = `https://api.github.com/repos/kovojs/kovo/actions/runs/${String(runId)}`;
      const jobsApiUrl = `${runApiUrl}/jobs?filter=all&per_page=100`;
      const location = `${runUrl}/artifacts/${String(artifactId)}`;
      const job = workflowJob(familyName);
      const jobId = artifactId + 20_000;
      const productCell = familyName.startsWith('dev-')
        ? 'dev'
        : familyName.startsWith('build-')
          ? 'build'
          : null;
      return {
        contentDigest,
        custody: {
          apiAuthorityDigest: digest(`${label}-artifact-authority`),
          apiResponseDigest: digest(`${label}-api`),
          apiUrl: `https://api.github.com/repos/kovojs/kovo/actions/artifacts/${String(artifactId)}`,
          archiveDigest: digest(`${label}-archive`),
          archiveByteLength: 123,
          archiveDownloadUrl: `https://api.github.com/repos/kovojs/kovo/actions/artifacts/${String(artifactId)}/zip`,
          archiveMembers: [
            {
              byteLength: 3,
              compressedByteLength: 3,
              compressionMethod: 0,
              contentDigest,
              crc32: 'crc32:00000000',
              member: familyName === 'check' ? 'check-scaling.json' : 'comparison.json',
            },
          ],
          artifactId,
          artifactDigest: digest(`${label}-archive`),
          artifactName: artifactName(familyName),
          artifactSizeInBytes: 123,
          createdAt: '2026-08-13T00:00:00Z',
          expiresAt: '2026-11-11T00:00:00Z',
          jobsApiAuthorityDigest: digest(`${label}-jobs-authority`),
          jobsApiResponseDigest: digest(`${label}-jobs-api`),
          jobsApiUrl,
          liveApiAuthorityDigest: digest(`${label}-artifact-authority`),
          liveApiResponseDigest: digest(`${label}-live-api`),
          liveJobsApiResponseDigest: digest(`${label}-live-jobs-api`),
          liveJobsApiAuthorityDigest: digest(`${label}-jobs-authority`),
          liveRunApiResponseDigest: digest(`${label}-live-run-api`),
          liveRunApiAuthorityDigest: digest(`${label}-run-authority`),
          liveApiVerifiedAt: '2026-08-13T23:59:00Z',
          location,
          reportContentDigest: contentDigest,
          reportMember: familyName === 'check' ? 'check-scaling.json' : 'comparison.json',
          runApiAuthorityDigest: digest(`${label}-run-authority`),
          runApiResponseDigest: digest(`${label}-run-api`),
          runApiUrl,
          runUrl,
          updatedAt: '2026-08-13T00:01:00Z',
          workflowApiResponseDigest: digest(`${label}-workflow-api`),
          workflow: {
            artifactUpload: workflowArtifactUpload(familyName),
            conclusion: 'success',
            event: 'workflow_dispatch',
            headSha: sourceCommit,
            job: {
              apiUrl: `https://api.github.com/repos/kovojs/kovo/actions/jobs/${String(jobId)}`,
              completedAt: '2026-08-13T00:01:00Z',
              conclusion: 'success',
              id: jobId,
              key: job.key,
              name: job.name,
              runAttempt: 1,
              startedAt: '2026-08-13T00:00:00Z',
              status: 'completed',
            },
            jobsApiUrl,
            name: 'Perf Realistic Tier',
            path: '.github/workflows/perf-realistic.yml',
            runApiUrl,
            runAttempt: 1,
            sourceSha: sourceCommit,
            status: 'completed',
            triggerPolicy: 'baseline',
            triggerScope: 'workflow-dispatch:measurement_scope=baselines-or-all',
            workflowApiUrl: `https://api.github.com/repos/kovojs/kovo/contents/.github/workflows/perf-realistic.yml?ref=${sourceCommit}`,
            workflowContentDigest: digest('trusted-workflow'),
            workflowGitBlobSha: 'f'.repeat(40),
            workflowHeadSha: sourceCommit,
            workflowRef: 'kovojs/kovo/.github/workflows/perf-realistic.yml@refs/heads/main',
            workflowSha: sourceCommit,
          },
          workflowRunId: runId,
        },
        location,
        rawText: '{}\n',
        report: {
          execution: {
            digest: digest(`${label}-execution`),
            github: { runUrl, sha: sourceCommit },
          },
          host: { digest: digest(`${familyName}-host`) },
          ...(productCell === null
            ? {}
            : {
                productArtifact,
                rawCells: [
                  {
                    cell: productCell,
                    framework: 'kovo',
                    lane: 'packed-kovo',
                    report: {
                      integrity: {
                        productArtifact: {
                          afterVerified: true,
                          beforeVerified: true,
                          required: true,
                        },
                      },
                      productArtifact,
                    },
                  },
                  {
                    cell: productCell,
                    framework: 'nextjs',
                    lane: 'packed-next',
                    report: {
                      integrity: {
                        productArtifact: {
                          afterVerified: true,
                          beforeVerified: false,
                          required: false,
                        },
                      },
                      productArtifact: null,
                    },
                  },
                ],
              }),
          source: { commit: sourceCommit, dirty: false, dirtyPaths: [], locks },
          workloadIdentity: {
            digest: digest(`${familyName}-workload`),
            ...(productCell === null
              ? {}
              : {
                  identity: {
                    cells: [productCell],
                    productArtifactPolicy: PACKED_KOVO_PRODUCT_WORKLOAD_POLICY,
                  },
                }),
          },
        },
      };
    });
    families[familyName] = { baseline: entries.slice(0, 5), holdout: entries[5] };
  }
  const productionBytes = productionBytesAuthenticatedFixture({
    artifactId: artifactId + 1,
    locks,
    sourceCommit,
  });
  return {
    campaign: authenticatedCampaignFixture(productionBytes, families),
    families,
    productionBytes,
    repository: 'kovojs/kovo',
  };
}

function productionBytesAuthenticatedFixture({ artifactId, locks, sourceCommit }) {
  const runId = artifactId + 10_000;
  const jobId = artifactId + 20_000;
  const runUrl = `https://github.com/kovojs/kovo/actions/runs/${String(runId)}`;
  const runApiUrl = `https://api.github.com/repos/kovojs/kovo/actions/runs/${String(runId)}`;
  const jobsApiUrl = `${runApiUrl}/jobs?filter=all&per_page=100`;
  const apiUrl = `https://api.github.com/repos/kovojs/kovo/actions/artifacts/${String(artifactId)}`;
  const contentDigest = digest('production-bytes-report');
  const archiveDigest = digest('production-bytes-archive');
  const source = { commit: sourceCommit, dirty: false, dirtyPaths: [], locks };
  const github = {
    eventSha: sourceCommit,
    job: 'bytes',
    repository: 'kovojs/kovo',
    runAttempt: '1',
    runId: String(runId),
    runUrl,
    serverUrl: 'https://github.com',
    sha: sourceCommit,
    workflowRef: 'kovojs/kovo/.github/workflows/perf-realistic.yml@refs/pull/7/merge',
    workflowSha: sourceCommit,
  };
  const executionFacts = {
    complete: true,
    github,
    provider: 'github-actions',
    startedAt: '2026-08-13T00:00:00Z',
  };
  const workloadFacts = {
    adapters: { perfGate: 'kovo-perf-report/v1', workload: 'kovo-realistic-workload/v1' },
    cells: ['bytes'],
    policies: { componentCount: 24 },
  };
  const report = {
    execution: {
      ...executionFacts,
      digest: canonicalDigest(executionFacts),
      schema: 'kovo-performance-execution/v1',
    },
    integrity: {
      complete: true,
      executionAuthenticated: true,
      publishable: true,
      serialized: true,
      sourceStable: true,
      workloadAuthenticated: true,
    },
    metrics: Object.fromEntries(
      productionBytesMetricIds().map((metricId, index) => [metricId, { value: 100 + index }]),
    ),
    options: { componentCount: 24 },
    schema: 'kovo-perf-report/v1',
    source,
    sourceAfter: structuredClone(source),
    suite: 'bytes',
    verdict: { reasons: [], status: 'measured' },
    workloadIdentity: {
      complete: true,
      digest: canonicalDigest(workloadFacts),
      identity: workloadFacts,
      schema: 'kovo-performance-workload-identity/v1',
    },
    host: hostFingerprintFixture(),
  };
  const budgets = {
    metrics: Object.fromEntries(
      productionBytesMetricIds().map((metricId) => [
        metricId,
        { loadSensitive: false, max: 1_000, unit: 'bytes' },
      ]),
    ),
    schema: 'kovo-perf-budgets/v1',
  };
  const budgetBytes = Buffer.from(`${JSON.stringify(budgets, null, 2)}\n`);
  const workflow = {
    artifactUpload: {
      action: 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
      concreteName: 'kovo-perf-bytes',
      job: 'bytes',
      name: 'kovo-perf-bytes',
      path: '${{ runner.temp }}/kovo-perf/bytes.json',
    },
    conclusion: 'success',
    event: 'pull_request',
    headSha: sourceCommit,
    job: {
      apiUrl: `https://api.github.com/repos/kovojs/kovo/actions/jobs/${String(jobId)}`,
      completedAt: '2026-08-13T00:01:00Z',
      conclusion: 'success',
      failureStep: null,
      id: jobId,
      key: 'bytes',
      name: 'Production bytes',
      requiredSuccessSteps: [],
      runAttempt: 1,
      startedAt: '2026-08-13T00:00:00Z',
      status: 'completed',
    },
    jobsApiUrl,
    name: 'Perf Realistic Tier',
    path: '.github/workflows/perf-realistic.yml',
    runApiUrl,
    runAttempt: 1,
    sourceSha: sourceCommit,
    status: 'completed',
    triggerPolicy: 'production-bytes',
    triggerScope: 'pull-request:every-event',
    workflowApiUrl: `https://api.github.com/repos/kovojs/kovo/contents/.github/workflows/perf-realistic.yml?ref=${sourceCommit}`,
    workflowContentDigest: digest('trusted-workflow'),
    workflowGitBlobSha: 'f'.repeat(40),
    workflowHeadSha: sourceCommit,
    workflowRef: 'kovojs/kovo/.github/workflows/perf-realistic.yml@refs/pull/7/merge',
    workflowSha: sourceCommit,
  };
  return {
    budgetBytes,
    budgetIdentity: {
      byteLength: budgetBytes.length,
      contentDigest: digest(budgetBytes),
      path: 'perf-budgets.json',
      schema: 'kovo-perf-budgets/v1',
      sourceCommit,
    },
    budgets,
    contentDigest,
    custody: {
      apiAuthorityDigest: digest('production-bytes-artifact-authority'),
      apiResponseDigest: digest('production-bytes-api'),
      apiUrl,
      archiveByteLength: 123,
      archiveDigest,
      archiveDownloadUrl: `${apiUrl}/zip`,
      archiveMembers: [
        {
          byteLength: 3,
          compressedByteLength: 3,
          compressionMethod: 0,
          contentDigest,
          crc32: 'crc32:00000000',
          member: 'bytes.json',
        },
      ],
      artifactDigest: archiveDigest,
      artifactId,
      artifactName: 'kovo-perf-bytes',
      artifactSizeInBytes: 123,
      createdAt: '2026-08-13T00:00:00Z',
      expiresAt: '2026-11-11T00:00:00Z',
      jobsApiAuthorityDigest: digest('production-bytes-jobs-authority'),
      jobsApiResponseDigest: digest('production-bytes-jobs-api'),
      jobsApiUrl,
      liveApiAuthorityDigest: digest('production-bytes-artifact-authority'),
      liveApiResponseDigest: digest('production-bytes-live-api'),
      liveApiVerifiedAt: '2026-08-13T23:59:00Z',
      liveJobsApiAuthorityDigest: digest('production-bytes-jobs-authority'),
      liveJobsApiResponseDigest: digest('production-bytes-live-jobs-api'),
      liveRunApiAuthorityDigest: digest('production-bytes-run-authority'),
      liveRunApiResponseDigest: digest('production-bytes-live-run-api'),
      location: `${runUrl}/artifacts/${String(artifactId)}`,
      reportContentDigest: contentDigest,
      reportMember: 'bytes.json',
      runApiAuthorityDigest: digest('production-bytes-run-authority'),
      runApiResponseDigest: digest('production-bytes-run-api'),
      runApiUrl,
      runUrl,
      updatedAt: '2026-08-13T00:01:00Z',
      workflow,
      workflowApiResponseDigest: digest('production-bytes-workflow-api'),
      workflowRunId: runId,
    },
    location: `${runUrl}/artifacts/${String(artifactId)}`,
    rawText: '{}\n',
    report,
  };
}

function hostFingerprintFixture() {
  const facts = {
    arch: 'x64',
    browsers: [],
    cpu: { count: 4, model: 'Fixture CPU' },
    memoryCapacityClassBytes: 16 * 1024 ** 3,
    node: 'v24.19.0',
    platform: 'linux',
    release: '6.11.0',
    runnerImage: 'ubuntu24@fixture',
  };
  return {
    ...facts,
    digest: canonicalDigest(facts),
    schema: 'kovo-performance-host/v2',
    totalMemoryBytes: 16 * 1024 ** 3,
  };
}

function authenticatedCampaignFixture(productionBytes, families) {
  const runId = productionBytes.custody.workflowRunId;
  const runCreatedAt = '2026-08-13T00:00:00Z';
  const selectedProductionBytes = {
    artifactId: productionBytes.custody.artifactId,
    runCreatedAt,
    runId,
  };
  const familyCandidates = [];
  const selectedFamilies = {};
  const runs = [];
  for (const familyName of FAMILY_NAMES) {
    selectedFamilies[familyName] = [];
    for (const entry of [...families[familyName].baseline, families[familyName].holdout]) {
      const candidate = {
        artifactId: entry.custody.artifactId,
        cohortDigest: campaignTestCohortDigest(entry.report, familyName),
        contentDigest: entry.contentDigest,
        executionDigest: entry.report.execution.digest,
        family: familyName,
        hostDigest: entry.report.host.digest,
        runCreatedAt,
        runId: entry.custody.workflowRunId,
      };
      familyCandidates.push(candidate);
      selectedFamilies[familyName].push(candidate);
      runs.push({
        artifactsApiAuthorityDigest: digest(
          `campaign-${String(candidate.runId)}-artifacts-authority`,
        ),
        artifactsApiResponseDigest: digest(
          `campaign-${String(candidate.runId)}-artifacts-response`,
        ),
        liveArtifactsApiResponseDigest: digest(
          `campaign-${String(candidate.runId)}-live-artifacts`,
        ),
        publicationArtifacts: [
          { artifactId: candidate.artifactId, family: familyName, kind: 'family' },
        ],
        runApiAuthorityDigest: digest(`campaign-${String(candidate.runId)}-run-authority`),
        runApiResponseDigest: digest(`campaign-${String(candidate.runId)}-run-response`),
        runCreatedAt,
        runId: candidate.runId,
      });
    }
  }
  const productionBytesCandidate = {
    artifactId: productionBytes.custody.artifactId,
    contentDigest: productionBytes.contentDigest,
    executionDigest: productionBytes.report.execution.digest,
    runCreatedAt,
    runId,
  };
  runs.push({
    artifactsApiAuthorityDigest: digest('campaign-artifacts-authority'),
    artifactsApiResponseDigest: digest('campaign-artifacts-response'),
    liveArtifactsApiResponseDigest: digest('campaign-live-artifacts-response'),
    publicationArtifacts: [
      { artifactId: productionBytes.custody.artifactId, kind: 'production-bytes' },
    ],
    runApiAuthorityDigest: digest('campaign-run-authority'),
    runApiResponseDigest: digest('campaign-run-response'),
    runCreatedAt,
    runId,
  });
  runs.sort((left, right) => left.runId - right.runId);
  familyCandidates.sort((left, right) => left.runId - right.runId);
  return {
    boundary: { firstRunId: runs[0].runId, lastRunId: runs.at(-1).runId },
    cohortSelections: {},
    familyCandidates,
    liveWorkflowRunsApiResponseDigest: digest('campaign-live-runs'),
    productionBytes: [selectedProductionBytes],
    productionBytesCandidates: [productionBytesCandidate],
    runs,
    selectedFamilies,
    selectedProductionBytes,
    workflowRunsApiAuthorityDigest: digest('campaign-runs-authority'),
    workflowRunsApiResponseDigest: digest('campaign-runs-response'),
  };
}

function productionBytesMetricIds() {
  return [
    'production.criticalPath.wireBytes',
    'production.document.wireBytes',
    'production.inlineBootstrap.gzipBytes',
    'production.inlineBootstrap.identityBytes',
    'production.navigation.wireBytes',
  ];
}

function writeCampaignAuthenticationFixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'kovo-perf-campaign-gate-'));
  temporaryDirectories.push(directory);
  const sourceCommit = 'a'.repeat(40);
  const runIds = [10_001, 10_002, 10_003, 10_004, 10_005, 10_006, 10_007];
  const locks = {
    'benchmarks/harness/pnpm-lock.yaml': digest('harness-lock'),
    'benchmarks/nextjs/pnpm-lock.yaml': digest('next-lock'),
    'pnpm-lock.yaml': digest('root-lock'),
  };
  const productArtifact = fixturePackedKovoProductIdentity({
    locks,
    seed: 'campaign-authentication',
    sourceCommit,
  });
  const liveRunById = new Map();
  const liveArtifactsByRun = new Map();
  const authenticatedByReport = new Map();
  const writeReference = (relativePath, value) => {
    const file = path.join(directory, relativePath);
    mkdirSync(path.dirname(file), { recursive: true });
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    writeFileSync(file, bytes);
    return { byteLength: bytes.length, contentDigest: digest(bytes), path: relativePath };
  };
  const workflowRuns = [];
  const runs = [];
  const productionBytes = [];
  const productionBytesCandidates = [];
  const familyCandidates = [];
  const selectedFamilies = Object.fromEntries(
    FAMILY_NAMES.map((familyName) => [familyName, { baseline: [], holdout: null }]),
  );
  for (const [index, runId] of runIds.entries()) {
    const runCreatedAt = `2026-08-13T00:0${String(index)}:00.000Z`;
    const apiUrl = `https://api.github.com/repos/kovojs/kovo/actions/runs/${String(runId)}`;
    const run = {
      artifacts_url: `${apiUrl}/artifacts`,
      conclusion: 'success',
      created_at: runCreatedAt,
      event: 'pull_request',
      head_sha: sourceCommit,
      id: runId,
      name: 'Perf Realistic Tier',
      path: '.github/workflows/perf-realistic.yml',
      run_attempt: 1,
      status: 'completed',
      url: apiUrl,
    };
    const artifacts = [];
    for (const [familyIndex, familyName] of FAMILY_NAMES.entries()) {
      const artifactId = 20_000 + index * 100 + familyIndex;
      const cell = familyName.startsWith('dev-')
        ? 'dev'
        : familyName.startsWith('build-')
          ? 'build'
          : familyName === 'check'
            ? 'check-scaling'
            : familyName;
      const identity = {
        cells: [cell],
        policies: {
          ...(familyName.includes('n24') ? { corpusSize: 24 } : {}),
          ...(familyName.includes('n216') ? { corpusSize: 216 } : {}),
        },
        ...(familyName.startsWith('dev-') || familyName.startsWith('build-')
          ? { productArtifactPolicy: PACKED_KOVO_PRODUCT_WORKLOAD_POLICY }
          : {}),
      };
      const workloadIdentity = {
        complete: true,
        digest: canonicalDigest(identity),
        identity,
        schema: 'kovo-performance-workload-identity/v1',
      };
      const github = {
        eventSha: sourceCommit,
        job: campaignFamilyWorkflowJob(familyName),
        repository: 'kovojs/kovo',
        runAttempt: '1',
        runId: String(runId),
        runUrl: `https://github.com/kovojs/kovo/actions/runs/${String(runId)}`,
        serverUrl: 'https://github.com',
        sha: sourceCommit,
        workflowRef: 'kovojs/kovo/.github/workflows/perf-realistic.yml@refs/pull/7/merge',
        workflowSha: sourceCommit,
      };
      const executionFacts = {
        complete: true,
        github,
        provider: 'github-actions',
        startedAt: new Date(Date.parse(runCreatedAt) + familyIndex).toISOString(),
      };
      const source = { commit: sourceCommit, dirty: false, dirtyPaths: [], locks };
      const report = {
        execution: {
          ...executionFacts,
          digest: canonicalDigest(executionFacts),
          schema: 'kovo-performance-execution/v1',
        },
        host: hostFingerprintFixture(),
        integrity: {
          ...(familyName === 'check' ? { complete: true } : { comparatorMatched: true }),
          executionAuthenticated: true,
          publishable: true,
          serialized: true,
          sourceStable: true,
          workloadAuthenticated: true,
        },
        ...(familyName.startsWith('dev-') || familyName.startsWith('build-')
          ? { productArtifact }
          : familyName === 'check'
            ? {}
            : { productArtifact: null }),
        schema:
          familyName === 'check' ? 'kovo-perf-report/v1' : 'kovo-next-performance-comparison/v1',
        source,
        sourceAfter: structuredClone(source),
        ...(familyName === 'check' ? { suite: 'check-scaling' } : {}),
        verdict: { reasons: [], status: 'measured' },
        workloadIdentity,
      };
      const descriptor = campaignCandidateDescriptor(`campaign/${familyName}-${String(runId)}`);
      const authenticated = {
        contentDigest: digest(`campaign-${familyName}-${String(runId)}-report`),
        custody: { artifactId, workflowRunId: runId },
        report,
      };
      const cohortDigest = campaignTestCohortDigest(report, familyName);
      familyCandidates.push({
        artifactId,
        cohortDigest,
        descriptor,
        executionDigest: report.execution.digest,
        family: familyName,
        hostDigest: report.host.digest,
        runCreatedAt,
        runId,
      });
      authenticatedByReport.set(descriptor.report, authenticated);
      const selected = selectedFamilies[familyName];
      if (index < 5) selected.baseline.push(authenticated);
      else if (index === 5) selected.holdout = authenticated;
      artifacts.push({ id: artifactId, name: artifactName(familyName) });
    }
    const productionArtifactId = index + 1;
    const productionAuthenticated = productionBytesAuthenticatedFixture({
      artifactId: productionArtifactId,
      locks,
      sourceCommit,
    });
    const productionDescriptor = campaignCandidateDescriptor(
      `campaign/production-bytes-${String(runId)}`,
    );
    productionBytesCandidates.push({
      artifactId: productionArtifactId,
      descriptor: productionDescriptor,
      executionDigest: productionAuthenticated.report.execution.digest,
      runCreatedAt,
      runId,
    });
    authenticatedByReport.set(productionDescriptor.report, productionAuthenticated);
    artifacts.push({ id: productionArtifactId, name: 'kovo-perf-bytes' });
    const artifactDocument = { artifacts, total_count: artifacts.length };
    workflowRuns.push(run);
    const runBytes = Buffer.from(`${JSON.stringify(run, null, 2)}\n`);
    const artifactBytes = Buffer.from(`${JSON.stringify(artifactDocument, null, 2)}\n`);
    liveRunById.set(runId, runBytes);
    liveArtifactsByRun.set(runId, artifactBytes);
    runs.push({
      artifactsApiMetadata: writeReference(
        `campaign/${String(runId)}-artifacts.json`,
        artifactDocument,
      ),
      runApiMetadata: writeReference(`campaign/${String(runId)}-run.json`, run),
      runCreatedAt,
      runId,
    });
    productionBytes.push({ artifactId: productionArtifactId, runCreatedAt, runId });
  }
  const workflowRunsDocument = { total_count: workflowRuns.length, workflow_runs: workflowRuns };
  const selectedProductionBytes = productionBytes[0];
  familyCandidates.sort(
    (left, right) =>
      Date.parse(left.runCreatedAt) - Date.parse(right.runCreatedAt) ||
      left.runId - right.runId ||
      FAMILY_NAMES.indexOf(left.family) - FAMILY_NAMES.indexOf(right.family) ||
      left.artifactId - right.artifactId,
  );
  return {
    campaign: {
      boundary: { firstRunId: runIds[0], lastRunId: runIds.at(-1) },
      cohortSelections: {},
      familyCandidates,
      productionBytes,
      productionBytesCandidates,
      runs,
      selectedProductionBytes,
      workflowRunsApiMetadata: writeReference('campaign/workflow-runs.json', workflowRunsDocument),
    },
    directory,
    authenticateArtifactEvidence: async (descriptor) =>
      authenticatedByReport.get(descriptor.report),
    liveArtifactsByRun,
    liveRunById,
    liveWorkflowRunsBytes: Buffer.from(`${JSON.stringify(workflowRunsDocument, null, 2)}\n`),
    selectedFamilies,
    selectedProductionBytes: authenticatedByReport.get(
      productionBytesCandidates[0].descriptor.report,
    ),
  };
}

async function campaignAuthenticationOptions(fixture) {
  return {
    authenticateArtifactEvidence: fixture.authenticateArtifactEvidence,
    custody: await createPerformanceArtifactDescriptorCustody({
      baseDirectory: fixture.directory,
    }),
    fetchCampaignWorkflowRunsApi: async () => fixture.liveWorkflowRunsBytes,
    fetchWorkflowArtifactsApi: async ({ workflowRunId }) =>
      fixture.liveArtifactsByRun.get(workflowRunId),
    fetchWorkflowRunApi: async ({ workflowRunId }) => fixture.liveRunById.get(workflowRunId),
    repository: 'kovojs/kovo',
    selectedFamilies: fixture.selectedFamilies,
    selectedProductionBytes: fixture.selectedProductionBytes,
  };
}

function rewriteCampaignReference(fixture, reference, document) {
  const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`);
  writeFileSync(path.join(fixture.directory, reference.path), bytes);
  reference.byteLength = bytes.length;
  reference.contentDigest = digest(bytes);
  return bytes;
}

function rewriteCampaignRunArtifacts(fixture, runId, mutate) {
  const run = fixture.campaign.runs.find((entry) => entry.runId === runId);
  const file = path.join(fixture.directory, run.artifactsApiMetadata.path);
  const listing = JSON.parse(readFileSync(file, 'utf8'));
  mutate(listing);
  const bytes = rewriteCampaignReference(fixture, run.artifactsApiMetadata, listing);
  fixture.liveArtifactsByRun.set(runId, Buffer.from(bytes));
}

function omitCampaignProductionBytes(fixture, runId, { listingEvent } = {}) {
  rewriteCampaignRunArtifacts(fixture, runId, (listing) => {
    listing.artifacts = listing.artifacts.filter(({ name }) => name !== 'kovo-perf-bytes');
    listing.total_count = listing.artifacts.length;
    if (listingEvent !== undefined) listing.event = listingEvent;
  });
  fixture.campaign.productionBytes = fixture.campaign.productionBytes.filter(
    (candidate) => candidate.runId !== runId,
  );
  fixture.campaign.productionBytesCandidates = fixture.campaign.productionBytesCandidates.filter(
    (candidate) => candidate.runId !== runId,
  );
}

function rewriteCampaignRunEvent(fixture, runId, event, { updateCensus = true } = {}) {
  const run = fixture.campaign.runs.find((entry) => entry.runId === runId);
  const runFile = path.join(fixture.directory, run.runApiMetadata.path);
  const runDocument = JSON.parse(readFileSync(runFile, 'utf8'));
  runDocument.event = event;
  const runBytes = rewriteCampaignReference(fixture, run.runApiMetadata, runDocument);
  fixture.liveRunById.set(runId, Buffer.from(runBytes));

  if (updateCensus) {
    const reference = fixture.campaign.workflowRunsApiMetadata;
    const censusFile = path.join(fixture.directory, reference.path);
    const census = JSON.parse(readFileSync(censusFile, 'utf8'));
    census.workflow_runs.find((entry) => entry.id === runId).event = event;
    fixture.liveWorkflowRunsBytes = rewriteCampaignReference(fixture, reference, census);
  }
}

function campaignFamilyWorkflowJob(familyName) {
  if (familyName === 'browser') return 'browser-matrix';
  if (familyName.startsWith('dev-')) return 'dev-matrix';
  if (familyName.startsWith('build-')) return 'build-matrix';
  if (familyName === 'server') return 'server-matrix';
  return 'check-scaling';
}

function campaignCandidateDescriptor(prefix) {
  return {
    apiMetadata: `${prefix}.artifact-api.json`,
    archive: `${prefix}.zip`,
    jobsApiMetadata: `${prefix}.jobs-api.json`,
    report: `${prefix}.report.json`,
    runApiMetadata: `${prefix}.run-api.json`,
  };
}

function campaignTestCohortDigest(report, familyName) {
  return canonicalDigest({
    host: report.host.digest,
    locks: report.source.locks,
    sourceCommit: report.source.commit,
    workload: report.workloadIdentity,
    ...(familyName.startsWith('dev-') || familyName.startsWith('build-')
      ? {
          product: {
            artifact: report.productArtifact,
            policy: report.workloadIdentity.identity.productArtifactPolicy,
          },
        }
      : {}),
  });
}

function digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function canonicalDigest(value) {
  return digest(canonicalJson(value));
}

function resealPublication(publication) {
  const facts = { ...publication };
  delete facts.digest;
  publication.digest = canonicalDigest(facts);
}

function resealDocument(document) {
  const facts = { ...document };
  delete facts.digest;
  document.digest = canonicalDigest(facts);
}

function buildProfileEntryFixture(mode, { configTrustStatus = 'executed' } = {}) {
  const sourceCommit = 'a'.repeat(40);
  const workflowRunId = 9_001;
  const artifactId = 9_002;
  const requireConfigStaticTrust = configTrustStatus === 'executed';
  const rawInputs = buildRawProfileFixtures(mode, { requireConfigStaticTrust });
  const inspected = deriveBuildProfileSetAnalysis(
    rawInputs.map(({ bytes, role }) => ({ bytes, role })),
    { nativeOrUnprofiledSamples: 0, requireConfigStaticTrust },
  );
  const profileInputs = rawInputs.map((entry, index) => ({
    ...entry,
    facts: {
      activeSamples: inspected.profileCensus[index].activeSamples,
      idleSamples: inspected.profileCensus[index].idleSamples,
      negativeTimeDeltas: inspected.profileCensus[index].negativeTimeDeltas,
      nodes: inspected.profileCensus[index].nodes,
      samples: inspected.profileCensus[index].samples,
      waitSamples: inspected.profileCensus[index].waitSamples,
    },
  }));
  const processCensus = buildProcessCensusFixture(profileInputs);
  const processCpuBytes = Buffer.from(
    'kovo-build-process-cpu/v1 interval=10000 user=5.000000 system=0.000000 exit=0\n',
  );
  const processCpu = deriveBuildProcessCpuEvidence({
    processCensus,
    processCpuBytes,
    profileInputs,
  });
  const profileSetAnalysis = deriveBuildProfileSetAnalysis(
    profileInputs.map(({ bytes, role }) => ({ bytes, role })),
    {
      nativeOrUnprofiledSamples: processCpu.cause.equivalentSamples,
      requireConfigStaticTrust,
    },
  );
  const merged = mergeBuildProcessProfiles(profileInputs);
  const profileArtifacts = profileInputs.map((entry, index) => ({
    activeSamples: profileSetAnalysis.profileCensus[index].activeSamples,
    bytes: entry.bytes.length,
    idleSamples: profileSetAnalysis.profileCensus[index].idleSamples,
    member: entry.member,
    negativeTimeDeltas: profileSetAnalysis.profileCensus[index].negativeTimeDeltas,
    nodes: profileSetAnalysis.profileCensus[index].nodes,
    pid: entry.pid,
    role: entry.role,
    samples: profileSetAnalysis.profileCensus[index].samples,
    sha256: digest(entry.bytes),
    waitSamples: profileSetAnalysis.profileCensus[index].waitSamples,
  }));
  const mergedMember = `build-${mode}.cpuprofile`;
  const processCpuMember = `process-cpu-${mode}.txt`;
  const reportMember = `profile-${mode}.json`;
  const artifactMembers = [
    mergedMember,
    processCpuMember,
    reportMember,
    ...profileArtifacts.map(({ member }) => member),
  ].sort((left, right) => left.localeCompare(right));
  const locks = {
    'benchmarks/harness/pnpm-lock.yaml': digest('harness-lock'),
    'benchmarks/nextjs/pnpm-lock.yaml': digest('next-lock'),
    'pnpm-lock.yaml': digest('root-lock'),
  };
  const source = { commit: sourceCommit, dirty: false, dirtyPaths: [], locks };
  const reportFacts = {
    artifactMembers,
    capture: {
      ...merged.census,
      processCensus,
      processCpu,
      profileSetAnalysis,
    },
    classifier: 'kovo-build-session-eligibility/phase-v1',
    diagnosticOnly: { profilerPerturbsDurations: true, publishTimingClaims: false },
    execution: {
      digest: digest('build-profile-execution'),
      github: {
        runUrl: `https://github.com/kovojs/kovo/actions/runs/${String(workflowRunId)}`,
        sha: sourceCommit,
        workflowSha: sourceCommit,
      },
    },
    host: { digest: digest('build-profile-host') },
    integrity: {
      complete: true,
      errors: [],
      processCensusComplete: true,
      processCpuComplete: true,
      profileFlushedBeforeExit: true,
      sourceStable: true,
    },
    processCpuArtifact: {
      bytes: processCpuBytes.length,
      fileName: processCpuMember,
      sha256: digest(processCpuBytes),
    },
    profileArtifact: {
      bytes: merged.bytes.length,
      fileName: mergedMember,
      sha256: digest(merged.bytes),
    },
    profileArtifacts,
    schema: 'kovo-build-session-cpu-profile/v1',
    source,
    sourceAfter: structuredClone(source),
    sourcePhasePosture: {
      complete: true,
      phases: KOVO_BUILD_SOURCE_PHASES.map((name) => ({
        name,
        status: name === 'config-trust' ? configTrustStatus : 'executed',
      })),
      schema: 'kovo-build-source-phase-posture/v1',
    },
    subject: {
      baselineWorkloadDigest: digest('build-profile-workload'),
      corpusSize: 216,
      mode,
    },
    topFive: profileSetAnalysis.topFive,
    verdict: { reasons: [], status: 'diagnostic' },
    workloadIdentity: { digest: digest('build-profile-workload') },
  };
  const report = { ...reportFacts, digest: canonicalDigest(reportFacts) };
  const rawText = `${JSON.stringify(report, null, 2)}\n`;
  const contentDigest = digest(rawText);
  const auxiliaries = [
    { bytes: merged.bytes, contentDigest: digest(merged.bytes), member: mergedMember },
    {
      bytes: processCpuBytes,
      contentDigest: digest(processCpuBytes),
      member: processCpuMember,
    },
    ...profileInputs.map(({ bytes, member }) => ({
      bytes,
      contentDigest: digest(bytes),
      member,
    })),
  ];
  const auxiliaryMembers = auxiliaries.map(({ bytes, contentDigest: memberDigest, member }) => ({
    byteLength: bytes.length,
    contentDigest: memberDigest,
    member,
  }));
  const reportArchiveMember = archiveMemberFixture(reportMember, Buffer.from(rawText));
  const archiveMembers = [
    reportArchiveMember,
    ...auxiliaries.map(({ bytes, member }) => archiveMemberFixture(member, bytes)),
  ].sort((left, right) => left.member.localeCompare(right.member));
  const apiUrl = `https://api.github.com/repos/kovojs/kovo/actions/artifacts/${String(artifactId)}`;
  const runApiUrl = `https://api.github.com/repos/kovojs/kovo/actions/runs/${String(workflowRunId)}`;
  const runUrl = `https://github.com/kovojs/kovo/actions/runs/${String(workflowRunId)}`;
  const jobsApiUrl = `${runApiUrl}/jobs?filter=all&per_page=100`;
  const location = `${runUrl}/artifacts/${String(artifactId)}`;
  const jobId = 9_003;
  return {
    auxiliaries,
    contentDigest,
    custody: {
      apiAuthorityDigest: digest('profile-artifact-authority'),
      apiResponseDigest: digest('profile-artifact-api'),
      apiUrl,
      archiveByteLength: 50_000,
      archiveDigest: digest('profile-archive'),
      archiveDownloadUrl: `${apiUrl}/zip`,
      archiveMembers,
      artifactDigest: digest('profile-archive'),
      artifactId,
      artifactName: 'kovo-perf-build-profile-n216',
      artifactSizeInBytes: 50_000,
      auxiliaryMembers,
      createdAt: '2026-08-13T22:00:00Z',
      expiresAt: '2026-11-11T22:00:00Z',
      jobsApiAuthorityDigest: digest('profile-jobs-authority'),
      jobsApiResponseDigest: digest('profile-jobs-api'),
      jobsApiUrl,
      liveApiAuthorityDigest: digest('profile-artifact-authority'),
      liveApiResponseDigest: digest('profile-live-artifact-api'),
      liveApiVerifiedAt: '2026-08-13T23:59:00Z',
      liveJobsApiAuthorityDigest: digest('profile-jobs-authority'),
      liveJobsApiResponseDigest: digest('profile-live-jobs-api'),
      liveRunApiAuthorityDigest: digest('profile-run-authority'),
      liveRunApiResponseDigest: digest('profile-live-run-api'),
      location,
      reportContentDigest: contentDigest,
      reportMember,
      runApiAuthorityDigest: digest('profile-run-authority'),
      runApiResponseDigest: digest('profile-run-api'),
      runApiUrl,
      runUrl,
      updatedAt: '2026-08-13T23:00:00Z',
      workflow: {
        artifactUpload: {
          action: 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
          concreteName: 'kovo-perf-build-profile-n216',
          job: 'build-profile',
          name: 'kovo-perf-build-profile-n216',
          path: '${{ runner.temp }}/kovo-perf/build-profile-n216',
        },
        conclusion: 'success',
        event: 'workflow_dispatch',
        headSha: sourceCommit,
        job: {
          apiUrl: `https://api.github.com/repos/kovojs/kovo/actions/jobs/${String(jobId)}`,
          completedAt: '2026-08-13T23:00:00Z',
          conclusion: 'success',
          id: jobId,
          key: 'build-profile',
          name: 'N=216 build CPU profiles',
          runAttempt: 1,
          startedAt: '2026-08-13T22:00:00Z',
          status: 'completed',
        },
        jobsApiUrl,
        name: 'Perf Realistic Tier',
        path: '.github/workflows/perf-realistic.yml',
        runApiUrl,
        runAttempt: 1,
        sourceSha: sourceCommit,
        status: 'completed',
        triggerPolicy: 'build-profile',
        triggerScope:
          'workflow-dispatch:measurement_scope=decisions-or-all;decision_focus=all-or-build-profile',
        workflowApiUrl: `https://api.github.com/repos/kovojs/kovo/contents/.github/workflows/perf-realistic.yml?ref=${sourceCommit}`,
        workflowContentDigest: digest('profile-workflow-content'),
        workflowGitBlobSha: 'f'.repeat(40),
        workflowHeadSha: sourceCommit,
        workflowRef: 'kovojs/kovo/.github/workflows/perf-realistic.yml@refs/heads/main',
        workflowSha: sourceCommit,
      },
      workflowApiResponseDigest: digest('profile-workflow-api'),
      workflowRunId,
    },
    location,
    rawText,
    report,
  };
}

function buildProfileEntryPairFixture() {
  const entries = [buildProfileEntryFixture('unchanged'), buildProfileEntryFixture('edit')];
  const sharedArchiveMembers = entries
    .flatMap((entry) => entry.custody.archiveMembers)
    .sort((left, right) => left.member.localeCompare(right.member));
  for (const entry of entries) {
    entry.custody.archiveMembers = structuredClone(sharedArchiveMembers);
  }
  return entries;
}

function buildRawProfileFixtures(mode, { requireConfigStaticTrust = false } = {}) {
  const specs = [
    {
      functionName: 'produceKovoBuildOneShotAnalysis',
      role: 'analyze',
      url: 'file:///workspace/packages/cli/src/commands/build-export.ts',
    },
    {
      functionName: 'runPreEvaluationStaticTrustPreflight',
      role: 'app-static-trust',
      url: 'file:///workspace/packages/cli/src/commands/build-export.ts',
    },
    {
      functionName: 'runCli',
      role: 'bootstrap',
      url: 'file:///workspace/packages/cli/src/bin.ts',
    },
    {
      functionName: 'produceKovoBuildOneShotClientPhase',
      role: 'client',
      url: 'file:///workspace/packages/cli/src/commands/build-export.ts',
    },
    ...(requireConfigStaticTrust
      ? [
          {
            functionName: 'runPreEvaluationBuildConfigTrustPreflight',
            role: 'config-static-trust',
            url: 'file:///workspace/packages/cli/src/commands/build-export.ts',
          },
        ]
      : []),
    {
      functionName: 'finishKovoBuildOneShot',
      role: 'final',
      url: 'file:///workspace/packages/cli/src/commands/build-export.ts',
    },
    {
      functionName: 'runKovoIsolatedOneShotInvocationAsync',
      role: 'orchestrator',
      url: 'file:///workspace/packages/cli/src/commands/build-one-shot-orchestrator.ts',
    },
    {
      functionName: 'produceKovoBuildOneShotServerPhase',
      role: 'server',
      url: 'file:///workspace/packages/cli/src/commands/build-export.ts',
    },
    {
      functionName: 'executeCommandLine',
      role: 'typescript',
      url: 'file:///workspace/node_modules/typescript/lib/_tsc.js',
    },
  ];
  return specs.map((spec, index) => {
    const pid = 100 + index;
    const active = 6 + index;
    const wait = spec.role === 'bootstrap' ? 4 : 0;
    const idle = 1;
    const nodes = [
      {
        callFrame: profileCallFrame('(root)', ''),
        children: [2, 3, 4],
        hitCount: 0,
        id: 1,
      },
      { callFrame: profileCallFrame(spec.functionName, spec.url), hitCount: active, id: 2 },
      {
        callFrame: profileCallFrame('spawnSync', 'node:internal/child_process'),
        hitCount: wait,
        id: 3,
      },
      { callFrame: profileCallFrame('(idle)', ''), hitCount: idle, id: 4 },
    ];
    const samples = [
      ...Array.from({ length: active }, () => 2),
      ...Array.from({ length: wait }, () => 3),
      ...Array.from({ length: idle }, () => 4),
    ];
    const profile = {
      endTime: samples.length * 10_000,
      nodes,
      samples,
      startTime: 0,
      timeDeltas: samples.map(() => 10_000),
    };
    return {
      bytes: Buffer.from(JSON.stringify(profile)),
      member: `raw-${mode}-${spec.role}-pid-${String(pid)}.cpuprofile`,
      pid,
      role: spec.role,
    };
  });
}

function buildProcessCensusFixture(profileInputs) {
  const identity = (file) => ({
    bytes: 100,
    path: file,
    realPath: file,
    sha256: digest(file),
  });
  const tools = {
    env: identity('/usr/bin/env'),
    node: identity('/usr/bin/node'),
    strace: identity('/usr/bin/strace'),
    time: identity('/usr/bin/time'),
  };
  const entryPaths = {
    analyze: '/workspace/packages/cli/src/commands/build-one-shot-analyze-worker.ts',
    'app-static-trust': '/workspace/packages/cli/src/commands/build-static-trust-worker.ts',
    bootstrap: '/workspace/packages/cli/src/bin.ts',
    client: '/workspace/packages/cli/src/commands/build-one-shot-client-worker.ts',
    'config-static-trust': '/workspace/packages/cli/src/commands/build-static-trust-worker.ts',
    final: '/workspace/packages/cli/src/commands/build-one-shot-final-worker.ts',
    orchestrator: '/workspace/packages/cli/src/bin.ts',
    server: '/workspace/packages/cli/src/commands/build-one-shot-server-worker.ts',
    typescript: '/workspace/node_modules/typescript/bin/tsc',
  };
  const evidence = {
    analyze: 'analyze-worker-entry-exec/v1',
    'app-static-trust': 'app-static-trust-worker-entry-exec/v1',
    bootstrap: 'bootstrap-source-bin-exec/v1',
    client: 'client-worker-entry-exec/v1',
    'config-static-trust': 'config-static-trust-worker-entry-exec/v1',
    final: 'final-worker-entry-exec/v1',
    orchestrator: 'orchestrator-source-bin-exec/v1',
    server: 'server-worker-entry-exec/v1',
    typescript: 'typescript-cli-entry-exec/v1',
  };
  const collectorPid = 1;
  const bootstrapPid = profileInputs.find(({ role }) => role === 'bootstrap').pid;
  const orchestratorPid = profileInputs.find(({ role }) => role === 'orchestrator').pid;
  return {
    classifier: 'kovo-build-exec-argv-role/v1',
    complete: true,
    forkOnlyProcesses: 2,
    processes: [
      {
        entry: null,
        executable: tools.time,
        parentPid: null,
        pid: collectorPid,
        role: 'collector-time',
        roleEvidence: 'gnu-time-exec/v1',
      },
      ...profileInputs.map(({ pid, role }) => ({
        entry: identity(entryPaths[role]),
        executable: tools.node,
        parentPid:
          role === 'bootstrap'
            ? collectorPid
            : role === 'orchestrator'
              ? bootstrapPid
              : orchestratorPid,
        pid,
        role,
        roleEvidence: evidence[role],
      })),
      {
        entry: null,
        executable: identity('/workspace/node_modules/esbuild/bin/esbuild'),
        parentPid: orchestratorPid,
        pid: 999,
        role: 'native-one-shot',
        roleEvidence: 'esbuild-exec/v1',
      },
    ],
    schema: 'kovo-build-process-census/v1',
    tools,
  };
}

function profileCallFrame(functionName, url) {
  return { columnNumber: 0, functionName, lineNumber: 0, scriptId: '1', url };
}

function archiveMemberFixture(member, bytes) {
  return {
    byteLength: bytes.length,
    compressedByteLength: bytes.length,
    compressionMethod: 0,
    contentDigest: digest(bytes),
    crc32: 'crc32:00000000',
    member,
  };
}

function rebindAuxiliaryCustody(entry, auxiliary) {
  const custodyMember = entry.custody.auxiliaryMembers.find(
    ({ member }) => member === auxiliary.member,
  );
  custodyMember.byteLength = auxiliary.bytes.length;
  custodyMember.contentDigest = auxiliary.contentDigest;
  const archiveMember = entry.custody.archiveMembers.find(
    ({ member }) => member === auxiliary.member,
  );
  archiveMember.byteLength = auxiliary.bytes.length;
  archiveMember.compressedByteLength = auxiliary.bytes.length;
  archiveMember.contentDigest = auxiliary.contentDigest;
}

function resealBuildProfileEntry(entry) {
  resealDocument(entry.report);
  entry.rawText = `${JSON.stringify(entry.report, null, 2)}\n`;
  entry.contentDigest = digest(entry.rawText);
  entry.custody.reportContentDigest = entry.contentDigest;
  const archiveMember = entry.custody.archiveMembers.find(
    ({ member }) => member === entry.custody.reportMember,
  );
  archiveMember.byteLength = Buffer.byteLength(entry.rawText);
  archiveMember.compressedByteLength = archiveMember.byteLength;
  archiveMember.contentDigest = entry.contentDigest;
}

function profileConfigTrustPhase(entry) {
  const phase = entry.report.sourcePhasePosture.phases.find(({ name }) => name === 'config-trust');
  if (phase === undefined) throw new TypeError('fixture config-trust posture is unavailable');
  return phase;
}

function artifactName(familyName) {
  return {
    browser: 'kovo-perf-browser-matrix',
    'build-n216': 'kovo-perf-build-n216',
    'build-n24': 'kovo-perf-build-n24',
    check: 'kovo-perf-check-scaling',
    'dev-n216': 'kovo-perf-dev-n216',
    'dev-n24': 'kovo-perf-dev-n24',
    server: 'kovo-perf-server-matrix',
  }[familyName];
}

function workflowJob(familyName) {
  const job = {
    browser: { key: 'browser-matrix', name: 'Browser matrix' },
    'build-n216': { key: 'build-matrix', name: 'N=216 production builds' },
    'build-n24': { key: 'build-matrix', name: 'N=24 production builds' },
    check: { key: 'check-scaling', name: 'Check scaling' },
    'dev-n216': { key: 'dev-matrix', name: 'N=216 developer loop' },
    'dev-n24': { key: 'dev-matrix', name: 'N=24 developer loop' },
    server: { key: 'server-matrix', name: 'Matched production throughput' },
  }[familyName];
  return { ...job, triggerPolicy: 'baseline' };
}

function workflowArtifactUpload(familyName) {
  const artifact = {
    browser: {
      concreteName: 'kovo-perf-browser-matrix',
      job: 'browser-matrix',
      name: 'kovo-perf-browser-matrix',
      path: '${{ runner.temp }}/kovo-perf/browser',
    },
    'build-n216': {
      concreteName: 'kovo-perf-build-n216',
      job: 'build-matrix',
      name: 'kovo-perf-build-n${{ matrix.corpus }}',
      path: '${{ runner.temp }}/kovo-perf/build-n${{ matrix.corpus }}',
    },
    'build-n24': {
      concreteName: 'kovo-perf-build-n24',
      job: 'build-matrix',
      name: 'kovo-perf-build-n${{ matrix.corpus }}',
      path: '${{ runner.temp }}/kovo-perf/build-n${{ matrix.corpus }}',
    },
    check: {
      concreteName: 'kovo-perf-check-scaling',
      job: 'check-scaling',
      name: 'kovo-perf-check-scaling',
      path: '${{ runner.temp }}/kovo-perf/check-scaling.json',
    },
    'dev-n216': {
      concreteName: 'kovo-perf-dev-n216',
      job: 'dev-matrix',
      name: 'kovo-perf-dev-n${{ matrix.corpus }}',
      path: '${{ runner.temp }}/kovo-perf/dev-n${{ matrix.corpus }}',
    },
    'dev-n24': {
      concreteName: 'kovo-perf-dev-n24',
      job: 'dev-matrix',
      name: 'kovo-perf-dev-n${{ matrix.corpus }}',
      path: '${{ runner.temp }}/kovo-perf/dev-n${{ matrix.corpus }}',
    },
    server: {
      concreteName: 'kovo-perf-server-matrix',
      job: 'server-matrix',
      name: 'kovo-perf-server-matrix',
      path: '${{ runner.temp }}/kovo-perf/server',
    },
  }[familyName];
  return {
    action: 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
    ...artifact,
  };
}
