import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  cpuProfileFileHits,
  evaluateMetric,
  evaluateReport,
  fitLogLogExponent,
  marginalLogLogExponent,
  formatEvaluation,
  median,
  medianAbsoluteDeviation,
  parseCheckPhaseCensus,
  phaseDurationMs,
  PERF_BUDGETS_SCHEMA,
  reportSuites,
} from './perf-gate.mjs';
import {
  materializePerfWorkload,
  perfWorkloadChildren,
  perfWorkloadComponentSource,
  perfWorkloadEditedComponent,
} from './perf-workload.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

describe('perf budgets document', () => {
  const budgets = JSON.parse(readFileSync(path.join(repoRoot, 'perf-budgets.json'), 'utf8'));

  it('is the realistic tier and names the toy tier it complements', () => {
    expect(budgets.schema).toBe(PERF_BUDGETS_SCHEMA);
    expect(budgets.tier.name).toBe('realistic');
    expect(budgets.tier.workload).toContain('scripts/perf-workload.mjs');
  });

  it('justifies every numeric budget with the samples it came from', () => {
    for (const [metricId, metric] of Object.entries(budgets.metrics)) {
      expect(typeof metric.rationale, metricId).toBe('string');
      expect(metric.rationale.length, metricId).toBeGreaterThan(40);
      if (metric.max === null) {
        // An unmeasured budget must say so out loud rather than carry an invented number.
        expect(metric.rationale, metricId).toMatch(/UNMEASURED|correctness/u);
        continue;
      }
      expect(Number.isFinite(metric.max), metricId).toBe(true);
      if (metric.samples === undefined) continue;
      expect(metric.samples.length, metricId).toBeGreaterThanOrEqual(2);
      expect(metric.max, `${metricId} budget must clear its worst sample`).toBeGreaterThanOrEqual(
        Math.max(...metric.samples),
      );
    }
  });

  it('marks every wall-clock budget load-sensitive and every byte budget not', () => {
    for (const [metricId, metric] of Object.entries(budgets.metrics)) {
      if (metric.unit === 'bytes' || metric.unit === 'exponent') {
        expect(metric.loadSensitive, metricId).toBe(false);
      }
      if (metric.loadSensitive === true) {
        expect(Number.isFinite(metric.maxLoadAverage), metricId).toBe(true);
      }
    }
  });
});

// A budget nobody has ever seen go red is a budget nobody knows is wired up. This drives the
// committed baseline — the actual runs perf-budgets.json was calibrated from — through the same
// evaluator CI uses, and pins BOTH directions for every budgeted metric: the recorded baseline
// passes, and a value one step past the budget fails.
describe('perf gate regression sensitivity', () => {
  const budgets = JSON.parse(readFileSync(path.join(repoRoot, 'perf-budgets.json'), 'utf8'));
  const baseline = JSON.parse(
    readFileSync(path.join(repoRoot, 'reports/perf-baseline-2026-08-08.json'), 'utf8'),
  );

  const budgetedObservations = baseline.suites.flatMap((suite) =>
    Object.entries(suite.metrics)
      .filter(([metricId]) => Number.isFinite(budgets.metrics[metricId]?.max))
      .map(([metricId, observation]) => ({ metricId, observation, suite: suite.suite })),
  );

  it('covers every budgeted metric with a recorded baseline observation', () => {
    const budgeted = Object.entries(budgets.metrics)
      .filter(([, metric]) => Number.isFinite(metric.max))
      .map(([metricId]) => metricId)
      .sort();
    expect(budgetedObservations.map((entry) => entry.metricId).sort()).toEqual(budgeted);
  });

  it('passes the baseline every gate was calibrated from', () => {
    for (const suite of baseline.suites) {
      const results = evaluateReport(budgets, suite);
      const failed = results.filter((result) => result.status === 'fail');
      expect(failed, `${suite.suite}: ${formatEvaluation(results)}`).toEqual([]);
    }
  });

  it.each(budgetedObservations)(
    'fails $metricId when the observation regresses past its budget',
    ({ metricId, observation }) => {
      const budget = budgets.metrics[metricId];
      // One representable step past the budget, in whichever direction is worse for this metric.
      // `requestsPerSecondFloor` is a negated throughput floor, so "worse" is still "larger".
      const regressed = {
        ...observation,
        value: budget.max + Math.max(Math.abs(budget.max) * 0.01, 1e-6),
      };
      expect(evaluateMetric(budget, { ...observation, value: budget.max }).status).toBe('pass');
      expect(evaluateMetric(budget, regressed).status).toBe('fail');
    },
  );

  // The specific regressions this tier exists to catch, expressed as the byte counts actually
  // measured on 2026-08-08 rather than as arbitrary over-budget numbers.
  it.each([
    {
      metricId: 'production.criticalPath.wireBytes',
      regressed: 22415,
      why: 'O4 catalog pruning falls back to the full @kovojs/ui sheet (122,439 B raw / 16,664 B br)',
    },
    {
      metricId: 'production.document.wireBytes',
      regressed: 27213,
      why: 'the document ships uncompressed identity bytes',
    },
    {
      metricId: 'production.navigation.wireBytes',
      regressed: 5748,
      why: 'enhanced navigation falls back to a full text/html document',
    },
    {
      metricId: 'production.inlineBootstrap.gzipBytes',
      regressed: 10500,
      why: "the bootstrap grows to the framework's own inlineKovoLoaderGzipByteBudget ceiling",
    },
    {
      metricId: 'check.appSourceTrust.marginalScalingExponent',
      regressed: 1.44,
      why: 'the quadratic app-source-trust term returns (worst-case-for-detection signature)',
    },
    {
      metricId: 'check.total.marginalScalingExponent',
      regressed: 1.409,
      why: 'total check cost grows faster than linearly in module count',
    },
  ])('fails $metricId when $why', ({ metricId, regressed }) => {
    const result = evaluateMetric(budgets.metrics[metricId], {
      loadAverage: 1,
      value: regressed,
    });
    expect(result.status).toBe('fail');
  });
});

describe('statistics', () => {
  it('takes medians of odd and even samples', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it('reports median absolute deviation', () => {
    expect(medianAbsoluteDeviation([10, 10, 10])).toBe(0);
    expect(medianAbsoluteDeviation([1, 2, 3, 4, 100])).toBe(1);
  });
});

describe('fitLogLogExponent', () => {
  it('reports 1 for exactly linear growth and 2 for quadratic', () => {
    const linear = fitLogLogExponent([
      { x: 8, y: 8 },
      { x: 24, y: 24 },
      { x: 72, y: 72 },
    ]);
    const quadratic = fitLogLogExponent([
      { x: 8, y: 64 },
      { x: 24, y: 576 },
      { x: 72, y: 5184 },
    ]);
    expect(linear).toBeCloseTo(1, 10);
    expect(quadratic).toBeCloseTo(2, 10);
  });

  it('refuses to fit fewer than two usable points or a degenerate ladder', () => {
    expect(fitLogLogExponent([{ x: 8, y: 8 }])).toBeNull();
    expect(
      fitLogLogExponent([
        { x: 8, y: 0 },
        { x: 24, y: 1 },
      ]),
    ).toBeNull();
    expect(
      fitLogLogExponent([
        { x: 8, y: 1 },
        { x: 8, y: 2 },
      ]),
    ).toBeNull();
  });
});

describe('marginalLogLogExponent', () => {
  it('reports 1 for linear and 2 for quadratic growth between the top two rungs', () => {
    expect(
      marginalLogLogExponent([
        { x: 8, y: 8 },
        { x: 24, y: 24 },
        { x: 72, y: 72 },
      ]),
    ).toBeCloseTo(1, 10);
    expect(
      marginalLogLogExponent([
        { x: 24, y: 576 },
        { x: 72, y: 5184 },
      ]),
    ).toBeCloseTo(2, 10);
  });

  // The property the whole-ladder OLS fit lacks, and the reason this is the gated statistic.
  //
  // Measured `app-source-trust` medians on the realistic workload, 2026-08-08 (ms):
  //   N=8 5377, N=24 6412, N=72 9727, N=216 30569.
  // A least-squares line through the TOP pair is y = 144.7*N - 691, i.e. the fixed cost is already
  // negligible up there — which is exactly the regime in which a growth exponent means what it
  // says. The bottom of the same ladder is the opposite regime (8->24 triples N for 1.19x cost),
  // and averaging the two is what makes the whole-ladder OLS fit unusable as a gate.
  const MEASURED_TRUST_LADDER = Object.freeze([
    { x: 8, y: 5377 },
    { x: 24, y: 6412 },
    { x: 72, y: 9727 },
    { x: 216, y: 30569 },
  ]);

  it('reports the measured ladder as very nearly linear at the top', () => {
    expect(marginalLogLogExponent(MEASURED_TRUST_LADDER)).toBeCloseTo(1.043, 2);
    // The same data through the whole-ladder fit reads as strongly sublinear, which is the trap.
    expect(fitLogLogExponent(MEASURED_TRUST_LADDER)).toBeLessThan(0.6);
  });

  it('separates a returned quadratic term from the measured linear behaviour', () => {
    // Worst case for detection: assume 5 s of the N=72 cost is irreducibly fixed and only the
    // remainder goes quadratic. Anything less fixed pushes the exponent further toward 2.0.
    const fixed = 5000;
    const variableAt72 = 9727 - fixed;
    const quadratic = [72, 216].map((n) => ({ x: n, y: fixed + variableAt72 * (n / 72) ** 2 }));
    expect(marginalLogLogExponent(quadratic)).toBeGreaterThan(1.4);
    // With no fixed floor at all the signature is the textbook 2.0.
    const pureQuadratic = [72, 216].map((n) => ({ x: n, y: 9727 * (n / 72) ** 2 }));
    expect(marginalLogLogExponent(pureQuadratic)).toBeCloseTo(2, 10);
  });

  it('is insensitive to a common contention factor applied to every rung', () => {
    const clean = [
      { x: 72, y: 9727 },
      { x: 216, y: 30569 },
    ];
    const contended = clean.map((point) => ({ x: point.x, y: point.y * 1.4 }));
    expect(marginalLogLogExponent(contended)).toBeCloseTo(marginalLogLogExponent(clean), 10);
  });

  it('refuses a degenerate or single-point ladder', () => {
    expect(marginalLogLogExponent([{ x: 8, y: 8 }])).toBeNull();
    expect(
      marginalLogLogExponent([
        { x: 8, y: 1 },
        { x: 8, y: 2 },
      ]),
    ).toBeNull();
  });
});

describe('check phase census parsing', () => {
  const complete =
    'kovo-check/v1\nOK\nkovo-check-phase-census/v1 {"phases":[{"durationMs":12.5,"name":"app-source-trust","status":"executed"}],"schema":"kovo-check-phase-census/v1"}';
  const incomplete =
    'kovo-check/v1\nERROR boom\nkovo-check-phase-census-incomplete/v1 {"complete":false,"failedPhase":{"elapsedMs":900,"name":"app-source-trust"},"phases":[],"schema":"kovo-check-phase-census-incomplete/v1"}';

  it('reads the success census', () => {
    const census = parseCheckPhaseCensus(complete);
    expect(census.complete).toBe(true);
    expect(phaseDurationMs(census, 'app-source-trust')).toBe(12.5);
  });

  it('reads the failure census and attributes the in-flight phase', () => {
    const census = parseCheckPhaseCensus(incomplete);
    expect(census.complete).toBe(false);
    // The whole point of the O17 census fix: a failing app still says where the time went.
    expect(phaseDurationMs(census, 'app-source-trust')).toBe(900);
    expect(phaseDurationMs(census, 'stylesheet')).toBeNull();
  });

  it('returns null when no census was requested', () => {
    expect(parseCheckPhaseCensus('kovo-check/v1\nOK')).toBeNull();
  });
});

describe('evaluateMetric', () => {
  it('passes at the budget and fails above it', () => {
    const budget = { loadSensitive: false, max: 100 };
    expect(evaluateMetric(budget, { value: 100 }).status).toBe('pass');
    expect(evaluateMetric(budget, { value: 100.1 }).status).toBe('fail');
  });

  it('reports an unmeasured budget as unbudgeted rather than passing it', () => {
    const result = evaluateMetric(
      { max: null, rationale: 'UNMEASURED on a quiet box' },
      { value: 5 },
    );
    expect(result.status).toBe('unbudgeted');
    expect(result.reason).toContain('UNMEASURED');
  });

  it('refuses to gate a wall-clock budget above its load ceiling', () => {
    const budget = { loadSensitive: true, max: 1000, maxLoadAverage: 8 };
    expect(evaluateMetric(budget, { loadAverage: 4, value: 5000 }).status).toBe('fail');
    const contended = evaluateMetric(budget, { loadAverage: 23.5, value: 5000 });
    expect(contended.status).toBe('unproven');
    expect(contended.reason).toContain('23.50');
  });

  it('still gates a load-sensitive budget when the runner did not report load', () => {
    const budget = { loadSensitive: true, max: 1000, maxLoadAverage: 8 };
    expect(evaluateMetric(budget, { value: 5000 }).status).toBe('fail');
  });

  it('reports a missing observation as unproven, never as a pass', () => {
    expect(evaluateMetric({ max: 10 }, { value: null }).status).toBe('unproven');
    expect(evaluateMetric({ max: 10 }, undefined).status).toBe('unproven');
  });
});

describe('reportSuites', () => {
  it('accepts a single suite report and the committed baseline bundle alike', () => {
    expect(reportSuites({ metrics: {}, suite: 'bytes' }, 'x.json')).toHaveLength(1);
    expect(reportSuites({ suites: [{ metrics: {} }, { metrics: {} }] }, 'x.json')).toHaveLength(2);
  });

  // "0 failed, 0 total" reads as green at a glance, so a file that carries no observations has to
  // be an error rather than a silent pass.
  it('throws rather than evaluating nothing', () => {
    expect(() => reportSuites({ suites: [] }, 'empty.json')).toThrow('no suite reports');
    expect(() => reportSuites({ host: {} }, 'wrong.json')).toThrow('is not a perf report');
    expect(() => reportSuites(null, 'null.json')).toThrow('is not a perf report');
  });
});

describe('evaluateReport', () => {
  it('sorts by metric id and counts failures in the rendered summary', () => {
    const budgets = {
      metrics: { 'a.metric': { max: 10 }, 'b.metric': { loadSensitive: false, max: 1 } },
    };
    const results = evaluateReport(budgets, {
      metrics: { 'b.metric': { value: 9 }, 'a.metric': { value: 1 } },
    });
    expect(results.map((result) => result.metricId)).toEqual(['a.metric', 'b.metric']);
    expect(formatEvaluation(results)).toContain('1 failed, 0 unproven, 2 total');
  });
});

describe('cpuProfileFileHits', () => {
  it('aggregates self-time hits per source file so a spawned worker is attributable', () => {
    const hits = cpuProfileFileHits({
      nodes: [
        { callFrame: { url: 'file:///repo/packages/compiler/src/scan/parse.ts' }, hitCount: 30 },
        { callFrame: { url: 'file:///repo/packages/compiler/src/scan/parse.ts' }, hitCount: 12 },
        { callFrame: { url: '' }, hitCount: 5 },
      ],
    });
    expect(hits).toEqual([
      ['parse.ts', 42],
      ['(native)', 5],
    ]);
  });
});

describe('realistic workload generator', () => {
  it('builds a fan-out-8 tree and stops at the component count', () => {
    expect(perfWorkloadChildren(0, 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(perfWorkloadChildren(0, 4)).toEqual([1, 2, 3]);
    expect(perfWorkloadChildren(1, 9)).toEqual([]);
    expect(perfWorkloadChildren(1, 12)).toEqual([9, 10, 11]);
  });

  it('makes the app non-inert by giving the root an interactive leaf', () => {
    const interactive = perfWorkloadComponentSource(0, 4, { interactive: true });
    expect(interactive).toContain("import { InteractiveLeaf } from './interactive-leaf.js';");
    expect(perfWorkloadComponentSource(1, 4, { interactive: true })).not.toContain(
      'InteractiveLeaf',
    );
    expect(perfWorkloadComponentSource(0, 4, { interactive: false })).not.toContain(
      'InteractiveLeaf',
    );
  });

  it('produces a byte-different edit for the dev loop', () => {
    const before = perfWorkloadComponentSource(3, 4);
    const after = perfWorkloadEditedComponent(3, 4, 7);
    expect(after).not.toBe(before);
    expect(after).toContain('componentRevision3 = 7');
  });

  it('materializes a self-contained app whose framework packages point at this checkout', () => {
    const root = path.join(repoRoot, '.tmp-kovo-perf-workload-unit');
    try {
      const workload = materializePerfWorkload({ componentCount: 3, repoRoot, root });
      expect(workload.fileCount).toBe(7);
      expect(readFileSync(path.join(root, 'src/app.tsx'), 'utf8')).toContain('interactiveQuery');
      expect(readFileSync(path.join(root, 'tsconfig.json'), 'utf8')).toContain('"strict": true');
      // The TypeScript preflight resolves from the app root, so both links have to exist.
      expect(
        readFileSync(path.join(root, 'node_modules/typescript/package.json'), 'utf8'),
      ).toContain('"name": "typescript"');
      expect(
        readFileSync(path.join(root, 'node_modules/@kovojs/server/package.json'), 'utf8'),
      ).toContain('@kovojs/server');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
