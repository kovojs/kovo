import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { analyzeNavigationAttribution } from '../benchmarks/harness/scenarios.mjs';
import { ratifyPerformanceBaseline } from './perf-baseline-ratify.mjs';
import {
  PERF_COMPARISON_BUDGET_SCHEMA,
  comparisonBudgetBaselineFindings,
  comparisonBudgetFindings,
  deriveComparisonPerformanceBudget,
  evaluateComparisonPerformanceBudget,
  renderComparisonBudgetMarkdown,
} from './perf-comparison-budget.mjs';
import { canonicalJson } from './perf-regression-check.mjs';

describe('browser/server comparison budgets', () => {
  it('derives directional browser budgets from five linked raw reports', () => {
    const entries = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
    const baseline = ratifyPerformanceBaseline(entries);

    const budget = deriveComparisonPerformanceBudget(baseline, { baselineEntries: entries });

    expect(budget.schema).toBe(PERF_COMPARISON_BUDGET_SCHEMA);
    expect(comparisonBudgetBaselineFindings(baseline, entries)).toEqual([]);
    expect(comparisonBudgetFindings(budget)).toEqual([]);
    expect(budget.targetAssessment).toMatchObject({ failures: [], status: 'pass' });
    expect(budget.targetAssessment.checks.map((check) => check.id)).toEqual([
      'matched-l1/browser//mobile.navigation.navToPaintMs.median-vs-next',
      'matched-l1/browser//mobile.navigation.sessionBytes.throughDestinationPaint.total.median-vs-next',
    ]);
    expect(budget.targetAssessment.checks).toEqual([
      expect.objectContaining({ kind: 'milestone', publicationImpact: 'completion' }),
      expect.objectContaining({
        kind: 'competitive-target',
        publicationImpact: 'follow-on',
      }),
    ]);
    expect(budget.metrics['matched-l1/browser//mobile.navigation.navToPaintMs']).toMatchObject({
      direction: 'lower-is-better',
      kind: 'ratified-regression-ceiling',
    });
    expect(
      budget.metrics['matched-l1/browser//lighthouse.mobile.listing.performanceScore'],
    ).toMatchObject({
      direction: 'higher-is-better',
      kind: 'ratified-regression-floor',
    });
    expect(budget.metrics['matched-l1/browser//bfcache.evidenceComplete']).toMatchObject({
      kind: 'exact-availability-floor',
      minimum: 1,
    });
    expect(budget.metrics['matched-l1/browser//bfcache.restored']).toMatchObject({
      direction: 'higher-is-better',
      kind: 'ratified-regression-floor',
    });
    expect(budget.metrics['matched-l1/browser//bfcache.applicable']).toMatchObject({
      direction: null,
      kind: 'informational',
    });
    const markdown = renderComparisonBudgetMarkdown(budget);
    expect(markdown).toContain('# Ratified browser performance baseline');
    expect(markdown).toContain(entries[0].location);
    expect(markdown).toContain('capability-matched');
    expect(markdown).toContain('same-document navigation');
    expect(markdown).toContain('bfcache.applicable');
    expect(markdown).toContain('| Target | Role | Observed | Operator | Limit | Verdict |');
    expect(markdown).toContain('| follow-on |');
  });

  it('evaluates a new same-subject report and enforces the matched L1 navigation target', () => {
    const entries = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
    const baseline = ratifyPerformanceBaseline(entries);
    const budget = deriveComparisonPerformanceBudget(baseline, { baselineEntries: entries });
    const candidate = reportEntry(5, 'browser').report;

    const passing = evaluateComparisonPerformanceBudget(budget, candidate);
    expect(passing.verdict.status).toBe('pass');
    expect(
      passing.checks.find((check) =>
        check.id.endsWith('mobile.navigation.navToPaintMs.median-vs-next'),
      ),
    ).toMatchObject({ kind: 'milestone' });
    expect(
      passing.checks.find((check) =>
        check.id.endsWith(
          'mobile.navigation.sessionBytes.throughDestinationPaint.total.median-vs-next',
        ),
      ),
    ).toMatchObject({ kind: 'competitive-target' });
    candidate.analysis['matched-l1/browser//mobile.navigation.navToPaintMs'].kovo.median = 250;
    expect(evaluateComparisonPerformanceBudget(budget, candidate).verdict).toMatchObject({
      status: 'regression',
    });
  });

  it('derives and enforces server throughput targets separately by posture', () => {
    const entries = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'server'));
    const baseline = ratifyPerformanceBaseline(entries);
    const budget = deriveComparisonPerformanceBudget(baseline, { baselineEntries: entries });
    const candidate = reportEntry(5, 'server').report;

    expect(comparisonBudgetFindings(budget)).toEqual([]);
    expect(budget.targetAssessment).toMatchObject({ failures: [], status: 'pass' });
    expect(budget.targetAssessment.checks).toHaveLength(12);
    expect(budget.targetAssessment.checks.every((check) => check.id.includes('-identity-'))).toBe(
      true,
    );
    expect(
      budget.targetAssessment.checks.every(
        (check) => check.kind === 'competitive-target' && check.publicationImpact === 'follow-on',
      ),
    ).toBe(true);
    expect(budget.policy.representations).toEqual({
      cachedComparisonEncoding: 'identity',
      forcedDynamicComparisonEncoding: 'identity',
      kovoBrotliPosture: 'required-raw-measurement-not-a-paired-next-target',
      nextBrotliPosture: 'unsupported',
    });
    expect(evaluateComparisonPerformanceBudget(budget, candidate).verdict.status).toBe('pass');
    candidate.analysis[
      'matched-runtime/server/dynamic-listing-identity-c1/requestsPerSecond'
    ].kovo.median = 70;
    expect(evaluateComparisonPerformanceBudget(budget, candidate).verdict.failures).toContain(
      'matched-runtime/server/dynamic-listing-identity-c1/requestsPerSecond.median-vs-next',
    );

    const shortened = structuredClone(budget);
    shortened.targetAssessment.checks.pop();
    resealBudget(shortened);
    expect(comparisonBudgetFindings(shortened)).toContain(
      'budget target assessment is not derived from ratified evidence',
    );

    const weakened = structuredClone(budget);
    weakened.policy.targets.cachedThroughputMinimumRatio = 0;
    resealBudget(weakened);
    expect(comparisonBudgetFindings(weakened)).toContain(
      'budget competitive target policy differs from the declared target census',
    );
  });

  it('refuses derivation when a downloaded report no longer matches its ratified digest', () => {
    const entries = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
    const baseline = ratifyPerformanceBaseline(entries);
    entries[0] = { ...entries[0], rawText: `${entries[0].rawText} ` };

    expect(() => deriveComparisonPerformanceBudget(baseline, { baselineEntries: entries })).toThrow(
      'does not match its ratified content/link identity',
    );
  });

  it('refuses shortened browser evidence and a partial server matrix', () => {
    const browserEntries = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
    for (const entry of browserEntries) {
      entry.report.workloadIdentity.identity.policies.skipLighthouse = true;
      refreshEntry(entry);
    }
    const browserBaseline = ratifyPerformanceBaseline(browserEntries);
    expect(browserBaseline.verdict.status).toBe('ratified');
    expect(() =>
      deriveComparisonPerformanceBudget(browserBaseline, { baselineEntries: browserEntries }),
    ).toThrow(/browser workload is not 30 samples, 5 Lighthouse runs, 10 bfcache traversals/u);

    const missingBfcache = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
    for (const entry of missingBfcache) {
      delete entry.report.analysis['matched-l0/browser//bfcache.evidenceComplete'];
      refreshEntry(entry);
    }
    const missingBaseline = ratifyPerformanceBaseline(missingBfcache);
    expect(missingBaseline.verdict.status).toBe('ratified');
    expect(() =>
      deriveComparisonPerformanceBudget(missingBaseline, { baselineEntries: missingBfcache }),
    ).toThrow(/matched-l0\/browser\/\/bfcache\.evidenceComplete is unavailable/u);

    const missingSessionBytes = Array.from({ length: 5 }, (_, index) =>
      reportEntry(index, 'browser'),
    );
    for (const entry of missingSessionBytes) {
      delete entry.report.analysis[
        'matched-l1/browser//mobile.navigation.sessionBytes.throughDestinationPaint.total'
      ];
      refreshEntry(entry);
    }
    const missingSessionBaseline = ratifyPerformanceBaseline(missingSessionBytes);
    expect(() =>
      deriveComparisonPerformanceBudget(missingSessionBaseline, {
        baselineEntries: missingSessionBytes,
      }),
    ).toThrow(/sessionBytes\.throughDestinationPaint\.total is unavailable/u);

    for (const requiredMetric of [
      'default/browser//desktop.coldLoad.fcpMs',
      'default/browser//desktop.navigation.navAttribution.phases.style.durationMs',
      'matched-l0/browser//mobile.navigation.navAttribution.phases.responseProcessingDomApply.durationMs',
      'matched-l1/browser//mobile.navigation.navAttribution.phases.responseProcessingDomApply.durationMs',
      'matched-l1/browser//lighthouse.mobile.detail.lcpMs',
    ]) {
      const missingMetric = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
      for (const entry of missingMetric) {
        delete entry.report.analysis[requiredMetric];
        refreshEntry(entry);
      }
      const baseline = ratifyPerformanceBaseline(missingMetric);
      expect(() =>
        deriveComparisonPerformanceBudget(baseline, { baselineEntries: missingMetric }),
      ).toThrow(`required browser metric ${requiredMetric} is unavailable`);
    }

    const prefetchedDefault = Array.from({ length: 5 }, (_, index) =>
      reportEntry(index, 'browser'),
    );
    for (const entry of prefetchedDefault) {
      for (const formFactor of ['desktop', 'mobile']) {
        for (const phase of ['server', 'transfer', 'responseProcessingDomApply']) {
          delete entry.report.analysis[
            `default/browser//${formFactor}.navigation.navAttribution.phases.${phase}.durationMs`
          ];
        }
      }
      refreshEntry(entry);
    }
    const prefetchedDefaultBaseline = ratifyPerformanceBaseline(prefetchedDefault);
    expect(prefetchedDefaultBaseline.verdict.status).toBe('ratified');
    const prefetchedDefaultBudget = deriveComparisonPerformanceBudget(prefetchedDefaultBaseline, {
      baselineEntries: prefetchedDefault,
    });
    const prefetchedDefaultHoldout = reportEntry(5, 'browser').report;
    for (const formFactor of ['desktop', 'mobile']) {
      for (const phase of ['server', 'transfer', 'responseProcessingDomApply']) {
        delete prefetchedDefaultHoldout.analysis[
          `default/browser//${formFactor}.navigation.navAttribution.phases.${phase}.durationMs`
        ];
      }
    }
    expect(
      evaluateComparisonPerformanceBudget(prefetchedDefaultBudget, prefetchedDefaultHoldout).verdict
        .reasons,
    ).toEqual([]);

    const serverEntries = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'server'));
    for (const entry of serverEntries) {
      entry.report.workloadIdentity.identity.policies.server.routes = ['listing'];
      refreshEntry(entry);
    }
    const serverBaseline = ratifyPerformanceBaseline(serverEntries);
    expect(serverBaseline.verdict.status).toBe('ratified');
    expect(() =>
      deriveComparisonPerformanceBudget(serverBaseline, { baselineEntries: serverEntries }),
    ).toThrow(
      /server workload is not the full 7-sample route\/encoding\/mode\/concurrency matrix/u,
    );
  });

  it("requires the exact raw browser census and both entrants' measured runtime posture", () => {
    const omitted = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
    omitted[2].report.rawCells.pop();
    refreshEntry(omitted[2]);
    expect(() =>
      deriveComparisonPerformanceBudget(ratifyPerformanceBaseline(omitted), {
        baselineEntries: omitted,
      }),
    ).toThrow(/raw browser cell census is not the exact 12 cells/u);

    const kovoScript = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
    const kovoDefault = kovoScript[0].report.rawCells.find(
      (cell) => cell.framework === 'kovo' && cell.lane === 'default',
    );
    kovoDefault.report.apps[0].conditions.desktop.coldLoad.iterations[0].fixtureScriptCount = 1;
    kovoDefault.report.apps[0].conditions.desktop.coldLoad.iterations[0].bytes.js = 1;
    refreshEntry(kovoScript[0]);
    expect(() =>
      deriveComparisonPerformanceBudget(ratifyPerformanceBaseline(kovoScript), {
        baselineEntries: kovoScript,
      }),
    ).toThrow(/Kovo L0 zero-JavaScript posture is not proved/u);

    const kovoBytes = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
    const kovoL0Bytes = kovoBytes[3].report.rawCells.find(
      (cell) => cell.framework === 'kovo' && cell.lane === 'matched-l0',
    );
    kovoL0Bytes.report.apps[0].conditions.mobile.coldLoad.iterations[0].bytes.js = 1;
    refreshEntry(kovoBytes[3]);
    expect(() =>
      deriveComparisonPerformanceBudget(ratifyPerformanceBaseline(kovoBytes), {
        baselineEntries: kovoBytes,
      }),
    ).toThrow(/Kovo L0 zero-JavaScript posture is not proved/u);

    const nextScript = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
    const nextL0 = nextScript[4].report.rawCells.find(
      (cell) => cell.framework === 'nextjs' && cell.lane === 'matched-l0',
    );
    nextL0.report.apps[0].conditions.mobile.coldLoad.iterations[0].fixtureScriptCount = 0;
    refreshEntry(nextScript[4]);
    expect(() =>
      deriveComparisonPerformanceBudget(ratifyPerformanceBaseline(nextScript), {
        baselineEntries: nextScript,
      }),
    ).toThrow(/Next default\/L0 script posture is not proved/u);

    const nextDefaultScript = Array.from({ length: 5 }, (_, index) =>
      reportEntry(index, 'browser'),
    );
    const nextDefault = nextDefaultScript[1].report.rawCells.find(
      (cell) => cell.framework === 'nextjs' && cell.lane === 'default',
    );
    nextDefault.report.apps[0].conditions.desktop.coldLoad.iterations[0].fixtureScriptCount = 0;
    refreshEntry(nextDefaultScript[1]);
    expect(() =>
      deriveComparisonPerformanceBudget(ratifyPerformanceBaseline(nextDefaultScript), {
        baselineEntries: nextDefaultScript,
      }),
    ).toThrow(/Next default\/L0 script posture is not proved/u);

    const scriptlessL1 = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
    const kovoL1Script = scriptlessL1[2].report.rawCells.find(
      (cell) => cell.framework === 'kovo' && cell.lane === 'matched-l1',
    );
    kovoL1Script.report.apps[0].conditions.desktop.coldLoad.iterations[0].fixtureScriptCount = 0;
    refreshEntry(scriptlessL1[2]);
    expect(() =>
      deriveComparisonPerformanceBudget(ratifyPerformanceBaseline(scriptlessL1), {
        baselineEntries: scriptlessL1,
      }),
    ).toThrow(/matched-L1 script posture is not proved/u);

    const impossibleBytes = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
    const nextByteSample = impossibleBytes[0].report.rawCells.find(
      (cell) => cell.framework === 'nextjs' && cell.lane === 'default',
    ).report.apps[0].conditions.mobile.coldLoad.iterations[0];
    nextByteSample.bytes.total = nextByteSample.bytes.js - 1;
    refreshEntry(impossibleBytes[0]);
    expect(() =>
      deriveComparisonPerformanceBudget(ratifyPerformanceBaseline(impossibleBytes), {
        baselineEntries: impossibleBytes,
      }),
    ).toThrow(/raw script\/byte posture is malformed/u);

    const clean = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
    const budget = deriveComparisonPerformanceBudget(ratifyPerformanceBaseline(clean), {
      baselineEntries: clean,
    });
    const holdout = reportEntry(5, 'browser').report;
    const kovoL1 = holdout.rawCells.find(
      (cell) => cell.framework === 'kovo' && cell.lane === 'matched-l1',
    );
    kovoL1.report.apps[0].conditions.desktop.navigation.iterations[0].navDocumentReplaced = 1;
    expect(evaluateComparisonPerformanceBudget(budget, holdout).verdict).toMatchObject({
      status: 'unproven',
    });

    const nextHoldout = reportEntry(6, 'browser').report;
    const nextL1 = nextHoldout.rawCells.find(
      (cell) => cell.framework === 'nextjs' && cell.lane === 'matched-l1',
    );
    nextL1.report.apps[0].conditions.mobile.navigation.iterations[0].navAttribution.primaryResponse.contentType =
      'application/json';
    expect(evaluateComparisonPerformanceBudget(budget, nextHoldout).verdict).toMatchObject({
      status: 'unproven',
    });
  });

  it('rejects per-occurrence browser census skew even when aggregate totals remain exact', () => {
    const expectRawSplitRejection = (mutate, pattern) => {
      const entries = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
      mutate(entries[0].report);
      refreshEntry(entries[0]);
      const baseline = ratifyPerformanceBaseline(entries);
      expect(baseline.verdict.status).toBe('ratified');
      expect(() =>
        deriveComparisonPerformanceBudget(baseline, { baselineEntries: entries }),
      ).toThrow(pattern);
    };
    const pair = (report) =>
      report.rawCells
        .filter((cell) => cell.lane === 'default' && cell.framework === 'kovo')
        .sort((left, right) => left.occurrence - right.occurrence);

    expectRawSplitRejection((report) => {
      for (const [cell, count] of pair(report).map((cell, occurrence) => [
        cell,
        [29, 1][occurrence],
      ])) {
        cell.report.iterations = count;
        for (const condition of Object.values(cell.report.apps[0].conditions)) {
          for (const scenario of ['coldLoad', 'navigation', 'ttiProbe']) {
            const first = condition[scenario].iterations[0];
            condition[scenario].iterations = Array.from({ length: count }, () =>
              structuredClone(first),
            );
          }
        }
      }
    }, /iteration census differs from its exact occurrence split/u);

    expectRawSplitRejection((report) => {
      for (const [cell, count] of pair(report).map((cell, occurrence) => [
        cell,
        [1, 4][occurrence],
      ])) {
        for (const lighthouse of cell.report.apps[0].lighthouse) {
          lighthouse.repeats = count;
          lighthouse.samples = Array.from({ length: count }, () => ({}));
        }
      }
    }, /Lighthouse\[0\] raw census is malformed/u);

    expectRawSplitRejection((report) => {
      for (const [cell, count] of pair(report).map((cell, occurrence) => [
        cell,
        [1, 9][occurrence],
      ])) {
        cell.report.apps[0].bfcache.iterations = Array.from({ length: count }, () => ({}));
      }
    }, /bfcache traversal census differs from its exact occurrence split/u);

    expectRawSplitRejection((report) => {
      const cells = pair(report);
      cells[0].report.warmups = 3;
      cells[1].report.warmups = 0;
    }, /warmup census differs from its exact occurrence split/u);

    expectRawSplitRejection((report) => {
      [report.rawCells[0], report.rawCells[1]] = [report.rawCells[1], report.rawCells[0]];
    }, /execution order differs from serialized Kovo,Next,Next,Kovo policy/u);

    expectRawSplitRejection((report) => {
      const lighthouse = pair(report)[0].report.apps[0].lighthouse;
      lighthouse[1].path = lighthouse[0].path;
    }, /Lighthouse\[1\] raw census is malformed/u);
  });

  it('rejects a self-asserted matched-L1 navigation whose authoritative witness is invalid', () => {
    const entries = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
    const nextL1 = entries[0].report.rawCells.find(
      (cell) => cell.framework === 'nextjs' && cell.lane === 'matched-l1',
    );
    nextL1.report.apps[0].conditions.mobile.navigation.iterations[0].navAttribution.primaryResponse.networkWitness.identity =
      digest('forged witness');
    refreshEntry(entries[0]);

    expect(() =>
      deriveComparisonPerformanceBudget(ratifyPerformanceBaseline(entries), {
        baselineEntries: entries,
      }),
    ).toThrow(/navigation attribution primary response is invalid/u);
  });

  it('rejects a consistently resealed matched-L1 response for the wrong destination route', () => {
    const attack = (report) => {
      const attribution = matchedL1Attribution(report, 'nextjs', 'mobile');
      const primary = attribution.primaryResponse;
      primary.url = 'http://localhost:4820/not-the-measured-detail-route';
      primary.traceContext.targetPath = '/not-the-measured-detail-route';
      primary.networkWitness.facts.url = primary.url;
      resealNavigationAttribution(attribution);
    };
    const entries = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
    attack(entries[0].report);
    refreshEntry(entries[0]);
    const baseline = ratifyPerformanceBaseline(entries);
    expect(baseline.verdict.status).toBe('ratified');
    expect(() => deriveComparisonPerformanceBudget(baseline, { baselineEntries: entries })).toThrow(
      /matched-L1 navigation is not bound to the exact measured detail target/u,
    );

    const clean = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
    const budget = deriveComparisonPerformanceBudget(ratifyPerformanceBaseline(clean), {
      baselineEntries: clean,
    });
    const holdout = reportEntry(5, 'browser').report;
    attack(holdout);
    expect(evaluateComparisonPerformanceBudget(budget, holdout).verdict).toMatchObject({
      reasons: expect.arrayContaining([
        expect.stringMatching(
          /matched-L1 navigation is not bound to the exact measured detail target/u,
        ),
      ]),
      status: 'unproven',
    });
  });

  it('rejects a consistently resealed Kovo document-navigation witness', () => {
    const attack = (report) => {
      const attribution = matchedL1Attribution(report, 'kovo', 'desktop');
      const primary = attribution.primaryResponse;
      primary.resourceType = 'document';
      primary.networkWitness.facts.resourceType = 'document';
      primary.networkWitness.facts.isNavigationRequest = true;
      resealNavigationAttribution(attribution);
    };
    const entries = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
    attack(entries[0].report);
    refreshEntry(entries[0]);
    const baseline = ratifyPerformanceBaseline(entries);
    expect(baseline.verdict.status).toBe('ratified');
    expect(() => deriveComparisonPerformanceBudget(baseline, { baselineEntries: entries })).toThrow(
      /Kovo document-parts fetch posture is not proved/u,
    );

    const clean = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
    const budget = deriveComparisonPerformanceBudget(ratifyPerformanceBaseline(clean), {
      baselineEntries: clean,
    });
    const holdout = reportEntry(5, 'browser').report;
    attack(holdout);
    expect(evaluateComparisonPerformanceBudget(budget, holdout).verdict).toMatchObject({
      reasons: expect.arrayContaining([
        expect.stringMatching(/Kovo document-parts fetch posture is not proved/u),
      ]),
      status: 'unproven',
    });
  });

  it('requires cold-load JavaScript and total bytes for every lane and form factor', () => {
    for (const requiredMetric of [
      'default/browser//desktop.coldLoad.bytes.js',
      'matched-l0/browser//mobile.coldLoad.bytes.total',
      'matched-l1/browser//desktop.coldLoad.bytes.total',
    ]) {
      const entries = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
      for (const entry of entries) {
        delete entry.report.analysis[requiredMetric];
        refreshEntry(entry);
      }
      expect(() =>
        deriveComparisonPerformanceBudget(ratifyPerformanceBaseline(entries), {
          baselineEntries: entries,
        }),
      ).toThrow(`required browser metric ${requiredMetric} is unavailable`);
    }
  });

  it('rejects omitted identity targets, fabricated paired Brotli, and missing raw Brotli proof', () => {
    const missingIdentity = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'server'));
    for (const entry of missingIdentity) {
      delete entry.report.analysis[
        'matched-runtime/server/hit-detail-identity-c32/requestsPerSecond'
      ];
      refreshEntry(entry);
    }
    const missingIdentityBaseline = ratifyPerformanceBaseline(missingIdentity);
    expect(() =>
      deriveComparisonPerformanceBudget(missingIdentityBaseline, {
        baselineEntries: missingIdentity,
      }),
    ).toThrow(/required server target metric .*hit-detail-identity-c32/u);

    const fabricatedBrotli = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'server'));
    for (const entry of fabricatedBrotli) {
      entry.report.analysis['matched-runtime/server/hit-listing-br-c1/requestsPerSecond'] = metric(
        120,
        125,
        7,
      );
      refreshEntry(entry);
    }
    const fabricatedBaseline = ratifyPerformanceBaseline(fabricatedBrotli);
    expect(() =>
      deriveComparisonPerformanceBudget(fabricatedBaseline, { baselineEntries: fabricatedBrotli }),
    ).toThrow(/fabricates a paired Brotli comparison/u);

    const missingRawBrotli = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'server'));
    for (const entry of missingRawBrotli) {
      entry.report.rawCells.pop();
      refreshEntry(entry);
    }
    const missingRawBaseline = ratifyPerformanceBaseline(missingRawBrotli);
    expect(() =>
      deriveComparisonPerformanceBudget(missingRawBaseline, { baselineEntries: missingRawBrotli }),
    ).toThrow(/Brotli raw cell census is incomplete/u);

    const cleanEntries = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'server'));
    const cleanBaseline = ratifyPerformanceBaseline(cleanEntries);
    const budget = deriveComparisonPerformanceBudget(cleanBaseline, {
      baselineEntries: cleanEntries,
    });
    const hostileHoldout = reportEntry(5, 'server').report;
    hostileHoldout.rawCells.pop();
    expect(evaluateComparisonPerformanceBudget(budget, hostileHoldout).verdict).toMatchObject({
      status: 'unproven',
    });
  });

  it.each(['browser', 'server'])(
    'executes the documented %s ratify and derive commands against five Actions runs',
    (subject) => {
      const root = mkdtempSync(path.join(os.tmpdir(), `kovo-${subject}-publication-cli-`));
      try {
        const entries = Array.from({ length: 5 }, (_, index) => reportEntry(index, subject));
        const reportPaths = entries.map((entry, index) => {
          const reportPath = path.join(root, `run-${String(index)}-comparison.json`);
          writeFileSync(reportPath, entry.rawText);
          return reportPath;
        });
        const baselinePath = path.join(root, `${subject}-baseline.json`);
        const budgetPath = path.join(root, `${subject}-budget.json`);
        const markdownPath = path.join(root, `${subject}-baseline.md`);
        const ratifier = fileURLToPath(new URL('./perf-baseline-ratify.mjs', import.meta.url));
        const ratification = spawnSync(
          process.execPath,
          [
            ratifier,
            ...reportPaths.flatMap((reportPath, index) => [
              '--report',
              reportPath,
              '--location',
              entries[index].location,
            ]),
            '--out',
            baselinePath,
          ],
          { encoding: 'utf8' },
        );
        expect(ratification).toMatchObject({ status: 0, stderr: '' });
        const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
        expect(new Set(baseline.reports.map(({ runUrl }) => runUrl)).size).toBe(5);
        expect(baseline.identity).toMatchObject({
          host: entries[0].report.host.digest,
          locks: entries[0].report.source.locks,
          source: entries[0].report.source.commit,
          workload: entries[0].report.workloadIdentity.digest,
        });

        const derivation = spawnSync(
          process.execPath,
          [
            fileURLToPath(new URL('./perf-comparison-budget.mjs', import.meta.url)),
            'derive',
            '--baseline',
            baselinePath,
            ...reportPaths.flatMap((reportPath) => ['--report', reportPath]),
            '--out',
            budgetPath,
            '--markdown-out',
            markdownPath,
          ],
          { encoding: 'utf8' },
        );
        expect(derivation).toMatchObject({ status: 0, stderr: '' });
        expect(JSON.parse(readFileSync(budgetPath, 'utf8')).subject.kind).toBe(subject);
        expect(readFileSync(markdownPath, 'utf8')).toContain(entries[0].location);

        writeFileSync(reportPaths[0], `${entries[0].rawText} `);
        const hostile = spawnSync(
          process.execPath,
          [
            fileURLToPath(new URL('./perf-comparison-budget.mjs', import.meta.url)),
            'derive',
            '--baseline',
            baselinePath,
            ...reportPaths.flatMap((reportPath) => ['--report', reportPath]),
            '--out',
            budgetPath,
          ],
          { encoding: 'utf8' },
        );
        expect(hostile.status).toBe(2);
        expect(hostile.stderr).toContain('does not match its ratified content/link identity');
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
  );
});

function reportEntry(index, subject) {
  const runId = String(5001 + index);
  const source = {
    commit: 'd'.repeat(40),
    dirty: false,
    dirtyPaths: [],
    locks: {
      'benchmarks/harness/pnpm-lock.yaml': digest('harness lock'),
      'benchmarks/nextjs/pnpm-lock.yaml': digest('next lock'),
      'pnpm-lock.yaml': digest('root lock'),
    },
  };
  const hostFacts = {
    arch: 'x64',
    browsers: subject === 'browser' ? ['chromium 148'] : [],
    cpu: { count: 4, model: 'Fixture CPU' },
    memoryCapacityClassBytes: 16 * 1024 ** 3,
    node: 'v24.19.0',
    platform: 'linux',
    release: '6.11.0',
    runnerImage: 'github-actions/ubuntu-24.04 ImageVersionDigest=sha256:fixture',
  };
  const policies =
    subject === 'browser'
      ? {
          bfcacheIterations: 10,
          browserSamples: 30,
          buildSamples: 30,
          corpusSize: 24,
          devEditSamples: 30,
          devReadySamples: 15,
          lighthouseRuns: 5,
          server: serverPolicy(),
          skipLighthouse: false,
          warmups: 3,
        }
      : {
          bfcacheIterations: 10,
          browserSamples: 30,
          buildSamples: 30,
          corpusSize: 24,
          devEditSamples: 30,
          devReadySamples: 15,
          lighthouseRuns: 5,
          server: serverPolicy(),
          skipLighthouse: false,
          warmups: 3,
        };
  const workloadFacts = {
    adapters: { compare: 'kovo-next-performance-comparison/v1' },
    cells: [subject],
    corpus: {},
    lanes: subject === 'browser' ? ['default', 'matched-l0', 'matched-l1'] : ['matched-runtime'],
    policies,
  };
  const github = {
    eventSha: 'd'.repeat(40),
    job: `${subject}-matrix`,
    repository: 'kovojs/kovo',
    runAttempt: '1',
    runId,
    runUrl: `https://github.com/kovojs/kovo/actions/runs/${runId}`,
    serverUrl: 'https://github.com',
    sha: 'd'.repeat(40),
    workflowRef: `kovojs/kovo/.github/workflows/perf-realistic.yml@${'d'.repeat(40)}`,
    workflowSha: 'd'.repeat(40),
  };
  const executionFacts = {
    complete: true,
    github,
    provider: 'github-actions',
    startedAt: `2026-08-14T00:00:${String(index).padStart(2, '0')}.000Z`,
  };
  const analysis = subject === 'browser' ? browserAnalysis(index) : serverAnalysis(index);
  const report = {
    analysis,
    execution: {
      ...executionFacts,
      digest: digest(canonicalJson(executionFacts)),
      schema: 'kovo-performance-execution/v1',
    },
    generatedAt: executionFacts.startedAt,
    host: {
      ...hostFacts,
      digest: digest(canonicalJson(hostFacts)),
      schema: 'kovo-performance-host/v2',
      totalMemoryBytes: 16 * 1024 ** 3,
    },
    hostSamples: [{ ceiling: 1, loadAverage: [0.2, 0.2, 0.2], loadPerCpu: 0.05 }],
    integrity: {
      comparatorMatched: true,
      ...(subject === 'server' ? { comparator: { serverMatrix: serverSupportCensus() } } : {}),
      executionAuthenticated: true,
      publishable: true,
      serialized: true,
      sourceStable: true,
      workloadAuthenticated: true,
    },
    schema: 'kovo-next-performance-comparison/v1',
    ...(subject === 'browser'
      ? { rawCells: browserRawCells() }
      : { rawCells: serverBrotliRawCells() }),
    source,
    sourceAfter: structuredClone(source),
    verdict: { reasons: [], status: 'measured' },
    workloadIdentity: {
      complete: true,
      digest: digest(canonicalJson(workloadFacts)),
      identity: workloadFacts,
      schema: 'kovo-performance-workload-identity/v1',
    },
  };
  const rawText = `${JSON.stringify(report)}\n`;
  return {
    contentDigest: digest(rawText),
    location: `https://github.com/kovojs/kovo/actions/runs/${runId}/artifacts/${String(6001 + index)}`,
    rawText,
    report,
  };
}

function browserAnalysis(index) {
  const analysis = {};
  for (const lane of ['default', 'matched-l0', 'matched-l1']) {
    analysis[`${lane}/browser//bfcache.applicable`] = booleanMetric(0, 1, 10);
    analysis[`${lane}/browser//bfcache.evidenceComplete`] = booleanMetric(1, 1, 10);
    analysis[`${lane}/browser//bfcache.restored`] = booleanMetric(1, 0, 10);
    for (const formFactor of ['desktop', 'mobile']) {
      for (const leaf of ['fcpMs', 'lcpMs', 'bytes.js', 'bytes.total']) {
        analysis[`${lane}/browser//${formFactor}.coldLoad.${leaf}`] = metric(200 + index, 220, 30);
      }
      analysis[`${lane}/browser//${formFactor}.navigation.navToPaintMs`] = metric(
        100 + index,
        120,
        30,
      );
      for (const phase of [
        'server',
        'transfer',
        'responseProcessingDomApply',
        'style',
        'layout',
        'paint',
      ]) {
        analysis[
          `${lane}/browser//${formFactor}.navigation.navAttribution.phases.${phase}.durationMs`
        ] = metric(10 + index / 10, 12, 30);
      }
      for (const phase of [
        'initial',
        'automaticPrefetch',
        'preClickBackground',
        'click',
        'postClick',
        'throughClick',
        'throughDestinationPaint',
        'settledSession',
      ]) {
        const kovo = phase === 'throughDestinationPaint' && lane === 'matched-l1' ? 40 : 80;
        analysis[`${lane}/browser//${formFactor}.navigation.sessionBytes.${phase}.total`] = metric(
          kovo,
          100,
          30,
        );
      }
      for (const route of ['listing', 'detail']) {
        for (const leaf of ['fcpMs', 'lcpMs']) {
          analysis[`${lane}/browser//lighthouse.${formFactor}.${route}.${leaf}`] = metric(
            200 + index,
            220,
            5,
          );
        }
        analysis[`${lane}/browser//lighthouse.${formFactor}.${route}.performanceScore`] = metric(
          0.9,
          0.8,
          5,
        );
      }
    }
  }
  return analysis;
}

function browserRawCells() {
  const attributions = {
    kovo: validNavigationAttribution('kovo'),
    nextjs: validNavigationAttribution('nextjs'),
  };
  const schedule = [
    { framework: 'kovo', occurrence: 0 },
    { framework: 'nextjs', occurrence: 0 },
    { framework: 'nextjs', occurrence: 1 },
    { framework: 'kovo', occurrence: 1 },
  ];
  return ['default', 'matched-l0', 'matched-l1'].flatMap((lane) =>
    schedule.map(({ framework, occurrence }) => {
      const iterations = 15;
      const lighthouseRepeats = occurrence === 0 ? 3 : 2;
      const listingPath =
        lane === 'default' ? '/' : lane === 'matched-l0' ? '/matched/l0' : '/matched/l1';
      const detailPath = `${listingPath === '/' ? '' : listingPath}/product/linen-field-jacket`;
      const coldSample = () => {
        const zeroJavaScript = framework === 'kovo' && lane !== 'matched-l1';
        return {
          bytes: { js: zeroJavaScript ? 0 : 100, total: 1_000 },
          fixtureScriptCount: zeroJavaScript ? 0 : 1,
        };
      };
      const navigationSample = () => ({
        ...(lane === 'matched-l1'
          ? framework === 'kovo'
            ? {
                navAttribution: attributions.kovo,
                navDocumentReplaced: 0,
              }
            : {
                navAttribution: attributions.nextjs,
                navDocumentReplaced: 1,
              }
          : {}),
      });
      const condition = () => ({
        coldLoad: { iterations: Array.from({ length: iterations }, coldSample) },
        navigation: { iterations: Array.from({ length: iterations }, navigationSample) },
        ttiProbe: {
          iterations: lane === 'matched-l0' ? [] : Array.from({ length: iterations }, () => ({})),
        },
      });
      return {
        cell: 'browser',
        framework,
        lane,
        occurrence,
        report: {
          apps: [
            {
              app: framework,
              bfcache: { iterations: Array.from({ length: 5 }, () => ({})) },
              conditions: { desktop: condition(), mobile: condition() },
              lighthouse: ['desktop', 'mobile'].flatMap((formFactor) =>
                [listingPath, detailPath].map((lighthousePath) => ({
                  formFactor,
                  path: lighthousePath,
                  repeats: lighthouseRepeats,
                  samples: Array.from({ length: lighthouseRepeats }, () => ({})),
                })),
              ),
            },
          ],
          iterations,
          lane,
          schema: 'kovo-browser-benchmark/v1',
          warmups: occurrence === 0 ? 2 : 1,
        },
      };
    }),
  );
}

function validNavigationAttribution(framework) {
  const next = framework === 'nextjs';
  const contentType = next ? 'text/html' : 'application/vnd.kovo.document-parts+json';
  const resourceType = next ? 'document' : 'fetch';
  const traceResourceType = next ? 'Document' : 'Other';
  const targetPath = '/matched/l1/product/linen-field-jacket';
  const url = `http://localhost:4820${targetPath}`;
  return analyzeNavigationAttribution({
    clickTsUs: 1_000_000,
    destinationMarkTsUs: 1_100_000,
    destinationPaintTsUs: 1_120_000,
    epochOffsetMs: 1_000,
    mainFrameId: 'main-frame',
    networkEvents: [browserNetworkRequest({ resourceType: traceResourceType, url })],
    records: [
      {
        bytes: 0,
        frameScope: 'top-level',
        headers: next ? {} : { accept: 'application/vnd.kovo.document-parts+json' },
        isNavigationRequest: next,
        method: 'GET',
        resourceType,
        responseHeaders: { 'content-type': `${contentType}; charset=utf-8` },
        startedEpochMs: 0,
        status: 200,
        timing: { requestStart: 10, responseEnd: 50, responseStart: 30, startTime: 1_990 },
        url,
      },
    ],
    targetPath,
    traceEvents: [
      ...browserTraceResponse({
        contentType,
        requestStartTsUs: 1_000_000,
        resourceType: traceResourceType,
        responseEndTsUs: 1_040_000,
        responseStartTsUs: 1_020_000,
        url,
      }),
      { name: 'Paint', ts: 1_120_000 },
    ],
  });
}

function browserNetworkRequest({ resourceType, url }) {
  return {
    frameId: 'main-frame',
    initiator:
      resourceType.toLowerCase() === 'document'
        ? { type: 'other' }
        : { fetchType: 'fetch', type: 'script' },
    loaderId: 'main-loader',
    request: { method: 'GET', url },
    requestId: 'trace-request-1',
    type: resourceType,
  };
}

function browserTraceResponse({
  contentType,
  requestStartTsUs,
  resourceType,
  responseEndTsUs,
  responseStartTsUs,
  url,
}) {
  return [
    {
      args: {
        data: {
          frame: 'main-frame',
          initiator:
            resourceType.toLowerCase() === 'document'
              ? { type: 'other' }
              : { fetchType: 'fetch', type: 'script' },
          loaderId: 'main-loader',
          requestId: 'trace-request-1',
          requestMethod: 'GET',
          resourceType,
          url,
        },
      },
      name: 'ResourceSendRequest',
      ts: requestStartTsUs,
    },
    {
      args: {
        data: {
          headers: [{ name: 'Content-Type', value: contentType }],
          mimeType: contentType,
          requestId: 'trace-request-1',
          statusCode: 200,
          timing: {
            receiveHeadersEnd: (responseStartTsUs - requestStartTsUs) / 1_000,
            requestTime: requestStartTsUs / 1_000_000,
            sendStart: 0,
          },
        },
      },
      name: 'ResourceReceiveResponse',
      ts: responseStartTsUs + 50,
    },
    {
      args: {
        data: {
          didFail: false,
          finishTime: responseEndTsUs / 1_000_000,
          requestId: 'trace-request-1',
        },
      },
      name: 'ResourceFinish',
      ts: responseEndTsUs + 50,
    },
  ];
}

function serverAnalysis(index) {
  const analysis = {};
  for (const mode of ['dynamic', 'hit']) {
    for (const route of ['listing', 'detail']) {
      for (const concurrency of [1, 8, 32]) {
        const prefix = `matched-runtime/server/${mode}-${route}-identity-c${String(concurrency)}`;
        analysis[`${prefix}/requestsPerSecond`] = metric(95 + index, 100, 7);
        analysis[`${prefix}/p95Ms`] = metric(10 + index / 10, 12, 7);
      }
    }
  }
  return analysis;
}

function serverSupportCensus() {
  return {
    completeSupportedMatrix: true,
    excludedUnsupported: serverConditionKeys('br').map((condition) => ({
      condition,
      unsupportedFrameworks: ['nextjs'],
    })),
    findings: [],
    supported: serverConditionKeys('identity'),
  };
}

function serverBrotliRawCells() {
  return serverConditionKeys('br').flatMap((condition) => {
    const [mode, route, encoding, concurrencyText] = condition.split('-');
    const concurrency = Number(concurrencyText.slice(1));
    const declaredMode = mode === 'hit' ? 'HIT' : mode === '304' ? '304' : 'dynamic';
    return ['kovo', 'nextjs'].flatMap((framework) =>
      Array.from({ length: 7 }, (_, occurrence) => ({
        cell: 'server',
        framework,
        lane: 'matched-runtime',
        mode: condition,
        occurrence,
        report: {
          condition: {
            concurrency,
            encoding,
            key: condition,
            mode: declaredMode,
            route,
          },
          correctness: { contentEncoding: framework === 'kovo' && mode !== '304' ? 'br' : null },
          framework,
          samples: framework === 'kovo' ? [{ requestsPerSecond: 125 }] : [],
          support: { status: framework === 'kovo' ? 'supported' : 'unsupported' },
          verdict: { status: framework === 'kovo' ? 'measured' : 'unsupported' },
        },
      })),
    );
  });
}

function serverConditionKeys(encoding) {
  const keys = [];
  for (const concurrency of [1, 8, 32]) {
    for (const route of ['listing', 'detail']) {
      for (const mode of ['HIT', '304', 'dynamic']) {
        keys.push(`${mode.toLowerCase()}-${route}-${encoding}-c${String(concurrency)}`);
      }
    }
  }
  return keys;
}

function serverPolicy() {
  return {
    concurrencies: [1, 8, 32],
    durationMs: 15_000,
    encodings: ['identity', 'br'],
    hostSettleMaxMs: 30_000,
    hostSettlePollMs: 1_000,
    modes: ['HIT', '304', 'dynamic'],
    routes: ['listing', 'detail'],
    samples: 7,
    warmupMs: 5_000,
  };
}

function refreshEntry(entry) {
  const workload = entry.report.workloadIdentity;
  workload.digest = digest(canonicalJson(workload.identity));
  entry.rawText = `${JSON.stringify(entry.report)}\n`;
  entry.contentDigest = digest(entry.rawText);
}

function matchedL1Attribution(report, framework, formFactor) {
  const cell = report.rawCells.find(
    (candidate) => candidate.framework === framework && candidate.lane === 'matched-l1',
  );
  return cell.report.apps[0].conditions[formFactor].navigation.iterations[0].navAttribution;
}

function resealNavigationAttribution(attribution) {
  const primary = attribution.primaryResponse;
  primary.networkWitness.identity = digest(canonicalJson(primary.networkWitness.facts));
  const primaryFacts = { ...primary };
  delete primaryFacts.identity;
  delete primaryFacts.status;
  primary.identity = digest(canonicalJson(primaryFacts));
  const attributionFacts = { ...attribution };
  delete attributionFacts.evidenceDigest;
  attribution.evidenceDigest = digest(canonicalJson(attributionFacts));
}

function metric(kovo, nextjs, samples) {
  return {
    kovo: { mad: 1, median: kovo, p95: kovo + 1, samples },
    nextjs: { mad: 1, median: nextjs, p95: nextjs + 1, samples },
    pairedDifference: {
      bootstrap95Ci: [kovo - nextjs - 1, kovo - nextjs + 1],
      direction: 'kovo-minus-nextjs',
      median: kovo - nextjs,
      samples,
    },
  };
}

function booleanMetric(kovo, nextjs, samples) {
  return {
    kovo: { mad: 0, median: kovo, p95: kovo, samples },
    nextjs: { mad: 0, median: nextjs, p95: nextjs, samples },
    pairedDifference: {
      bootstrap95Ci: [kovo - nextjs, kovo - nextjs],
      direction: 'kovo-minus-nextjs',
      median: kovo - nextjs,
      samples,
    },
  };
}

function digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function resealBudget(budget) {
  const facts = { ...budget };
  delete facts.digest;
  budget.digest = digest(canonicalJson(facts));
}
