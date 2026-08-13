import { describe, expect, it } from 'vitest';

import {
  bootstrapMedianCi,
  browserReportIntegrityFindings,
  comparisonVerdict,
  EXECUTION_ORDER,
  fixtureProof,
  pairedAnalysis,
  summarize,
  ttiInteractionProof,
  validateDevCell,
} from './compare.mjs';

describe('serialized comparison analysis', () => {
  it('pins the alternating K,N,N,K execution order', () => {
    expect(EXECUTION_ORDER).toEqual(['kovo', 'nextjs', 'nextjs', 'kovo']);
  });

  it('reports raw-summary statistics without dropping sample counts', () => {
    expect(summarize([1, 2, 3, 4, 100])).toEqual({ mad: 1, median: 3, p95: 100, samples: 5 });
  });

  it('computes a deterministic paired bootstrap interval', () => {
    expect(bootstrapMedianCi([1, 2, 3, 4], { iterations: 1_000, seed: 42 })).toEqual([1, 4]);
  });

  it('pairs raw browser samples by lane/cell/metric', () => {
    const cells = [
      browserCell('kovo', 0, [10, 12]),
      browserCell('nextjs', 0, [20, 22]),
      browserCell('nextjs', 1, [40]),
      browserCell('kovo', 1, [30]),
    ];
    const analysis = pairedAnalysis(cells, { bootstrapIterations: 100, seed: 3 });
    expect(analysis['matched-l1/browser//desktop.navigation.navToPaintMs']).toMatchObject({
      kovo: { median: 12, samples: 3 },
      nextjs: { median: 22, samples: 3 },
      pairedDifference: { direction: 'kovo-minus-nextjs', median: -10, samples: 3 },
    });
  });

  it('pairs dev edit and independent fresh-ready samples', () => {
    const cells = [
      devCell('kovo', 0, [10, 12], [100]),
      devCell('nextjs', 0, [20, 22], [200]),
      devCell('nextjs', 1, [40], [400]),
      devCell('kovo', 1, [30], [300]),
    ];
    const analysis = pairedAnalysis(cells, { bootstrapIterations: 100, seed: 4 });
    expect(analysis['corpus-n24/dev//edit.leafMs'].pairedDifference).toMatchObject({
      median: -10,
      samples: 3,
    });
    expect(analysis['corpus-n24/dev//ready.durationMs'].pairedDifference).toMatchObject({
      median: -100,
      samples: 2,
    });
  });

  it('marks provenance or comparator mismatches unproven', () => {
    expect(
      comparisonVerdict({
        integrity: { comparatorMatched: false, serialized: true, sourceStable: false },
        source: { dirty: true },
      }),
    ).toEqual({
      reasons: [
        'source provenance is dirty',
        'source provenance changed during run',
        'comparator pairing is incomplete',
      ],
      status: 'unproven',
    });
  });

  it('uses truthful per-framework script contracts for default and matched fixtures', () => {
    const zeroScriptFixture = {
      fixtureBootstrapValid: 1,
      fixtureContentValid: 1,
      fixtureControlsValid: 1,
      fixtureCssValid: 1,
      fixtureLaneValid: 1,
      fixtureScriptCount: 0,
    };
    expect(fixtureProof(zeroScriptFixture, { framework: 'kovo', lane: 'default' })).toBe(true);
    expect(fixtureProof(zeroScriptFixture, { framework: 'kovo', lane: 'matched-l0' })).toBe(true);
    expect(fixtureProof(zeroScriptFixture, { framework: 'kovo', lane: 'matched-l1' })).toBe(false);
    expect(fixtureProof(zeroScriptFixture, { framework: 'nextjs', lane: 'default' })).toBe(false);
    expect(
      fixtureProof(
        { ...zeroScriptFixture, fixtureScriptCount: 1 },
        { framework: 'nextjs', lane: 'default' },
      ),
    ).toBe(true);
  });

  it('accepts native default checkout without inventing matched-L1 state evidence', () => {
    expect(
      ttiInteractionProof({ checkoutConfirmed: 1, stateMutationConfirmed: 0 }, 'default'),
    ).toBe(true);
    expect(
      ttiInteractionProof({ checkoutConfirmed: 1, stateMutationConfirmed: 0 }, 'matched-l1'),
    ).toBe(false);
  });

  it('requires a complete browser-adapter integrity verdict and exact policy', () => {
    const policy = {
      bfcacheIterations: 5,
      iterations: 15,
      lighthouseRepeats: 3,
      listingPath: '/',
      scenarios: ['coldLoad', 'ttiProbe', 'navigation'],
      warmups: 2,
    };
    expect(
      browserReportIntegrityFindings({ integrity: { complete: true, errors: [], policy } }, policy),
    ).toEqual([]);
    expect(
      browserReportIntegrityFindings(
        { integrity: { complete: false, errors: ['page error'], policy } },
        { ...policy, iterations: 14 },
      ),
    ).toEqual([
      'browser integrity verdict is incomplete',
      'browser integrity errors are present or unavailable',
      'browser integrity policy iterations mismatch',
    ]);
  });

  it('requires exact dev ready/edit counts, stable source, and clean browser evidence', () => {
    const reasons = [];
    validateDevCell(
      {
        framework: 'kovo',
        lane: 'corpus-n24',
        report: {
          framework: 'kovo',
          integrity: {
            browser: { requestFailedCount: 0, responseCount: 1, unexpectedErrorCount: 0 },
            editCounts: { data: 30, entry: 30, leaf: 30, recovery: 30, syntaxError: 30 },
            iterations: 30,
            readyIterations: 15,
            source: { stable: true },
            warmups: 3,
          },
          readySamples: Array.from({ length: 15 }, () => ({})),
          source: { commit: 'abc', dirty: false, locks: { root: 'one' } },
          sourceAfter: { commit: 'abc', dirty: false, locks: { root: 'one' } },
        },
      },
      { iterations: 30, readyIterations: 15, reasons, warmups: 3 },
    );
    expect(reasons).toEqual([]);

    const mismatched = [];
    validateDevCell(
      {
        framework: 'kovo',
        lane: 'corpus-n24',
        report: {
          framework: 'kovo',
          integrity: {
            browser: { requestFailedCount: 1, responseCount: 0, unexpectedErrorCount: 1 },
            editCounts: {},
            iterations: 29,
            readyIterations: 14,
            source: { stable: false },
            warmups: 2,
          },
          readySamples: [],
          source: { commit: 'abc', dirty: false, locks: {} },
          sourceAfter: { commit: 'def', dirty: true, locks: {} },
        },
      },
      { iterations: 30, readyIterations: 15, reasons: mismatched, warmups: 3 },
    );
    expect(mismatched).toContain('corpus-n24/kovo/dev ready iteration policy mismatch');
    expect(mismatched).toContain('corpus-n24/kovo/dev source stability failure');
    expect(mismatched).toContain('corpus-n24/kovo/dev browser error evidence');
  });
});

function browserCell(framework, occurrence, values) {
  return {
    cell: 'browser',
    framework,
    lane: 'matched-l1',
    occurrence,
    report: {
      apps: [
        {
          conditions: {
            desktop: {
              navigation: { iterations: values.map((navToPaintMs) => ({ navToPaintMs })) },
            },
          },
        },
      ],
    },
  };
}

function devCell(framework, occurrence, editValues, readyValues) {
  return {
    cell: 'dev',
    framework,
    lane: 'corpus-n24',
    occurrence,
    report: {
      readySamples: readyValues.map((durationMs) => ({ durationMs })),
      samples: editValues.map((leafMs) => ({ leafMs })),
    },
  };
}
