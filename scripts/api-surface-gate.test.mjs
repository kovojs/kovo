import { readFileSync } from 'node:fs';
import path from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  baselineToRemove,
  classifyExport,
  compareViolations,
  computeSurfaceReport,
  recursiveRatchetComparison,
} from './api-surface-gate.mjs';
import { repoRoot } from './public-packages.mjs';

/**
 * The api-surface gate is only meaningful if its baseline stays in sync with the
 * real public surface and its ratchet actually catches new leaks (plan Phase 3).
 */

describe('api-surface gate', () => {
  let surfaceReport;

  beforeAll(() => {
    surfaceReport = computeSurfaceReport();
  });

  it('keeps the committed baseline in sync with the real public surface', () => {
    const baseline = JSON.parse(
      readFileSync(path.join(repoRoot, 'api-surface-baseline.json'), 'utf8'),
    );
    const current = surfaceReport.undocumentedPublic;
    // No drift in either direction: every current violation is baselined, and the
    // baseline lists nothing already fixed (regenerate with --write after curating).
    const { added, removed } = compareViolations(baseline.toDocument, current);
    expect(added, `new undocumented/untagged public exports: ${added.join(', ')}`).toEqual([]);
    expect(removed, `baseline lists fixed exports — regenerate: ${removed.join(', ')}`).toEqual([]);
  });

  it('keeps the committed recursive-publicness baseline in sync', () => {
    const baseline = JSON.parse(
      readFileSync(path.join(repoRoot, 'api-surface-baseline.json'), 'utf8'),
    );
    const current = surfaceReport.recursivePublicnessViolations;
    const { added, removed, overBudget } = recursiveRatchetComparison(
      baseline,
      surfaceReport.recursivePublicnessDetails,
    );
    expect(added, `new recursive publicness violations: ${added.join(', ')}`).toEqual([]);
    expect(
      removed,
      `recursive baseline lists fixed exports — regenerate: ${removed.join(', ')}`,
    ).toEqual([]);
    expect(overBudget).toEqual([]);
    expect(baseline.recursivePublicness.total).toBe(current.length);
  });

  it('does not expose style compiler/provenance helper types through the public style surface', () => {
    const current = surfaceReport.recursivePublicnessViolations;
    expect(
      current.filter(
        (violation) =>
          violation.startsWith('@kovojs/style#') &&
          /(?:AtomicRule|CompiledStyle|StyleIdentityOptions)/.test(violation),
      ),
    ).toEqual([]);
  });

  it('uses the v2 exact-identity and per-package recursive baseline', () => {
    const baseline = JSON.parse(
      readFileSync(path.join(repoRoot, 'api-surface-baseline.json'), 'utf8'),
    );
    expect(baseline.schema).toBe('kovo-api-surface-baseline/v2');
    expect(Array.isArray(baseline.toDocument)).toBe(true);
    expect(baselineToRemove(baseline)).toHaveLength(baseline.recursivePublicness.total);
    for (const packageBaseline of Object.values(baseline.recursivePublicness.packages)) {
      expect(packageBaseline.maximum).toBe(packageBaseline.violations.length);
      expect(packageBaseline.violations).toEqual(
        [...packageBaseline.violations].sort((left, right) => left.localeCompare(right)),
      );
    }
    expect(baseline).not.toHaveProperty('toRemove');
    expect(baseline).not.toHaveProperty('violations');
    expect(baseline).not.toHaveProperty('recursivePublicnessViolations');
  });

  it('rejects identity swaps even when a package remains under its numeric budget', () => {
    const baseline = {
      schema: 'kovo-api-surface-baseline/v2',
      recursivePublicness: {
        total: 1,
        packages: {
          '@kovojs/core': { maximum: 1, violations: ['old leak'] },
        },
      },
    };
    const comparison = recursiveRatchetComparison(baseline, [
      { id: 'different leak', package: '@kovojs/core' },
    ]);
    expect(comparison.added).toEqual(['different leak']);
    expect(comparison.removed).toEqual(['old leak']);
    expect(comparison.overBudget).toEqual([]);
  });

  it('rejects moving recursive debt into a package with no budget', () => {
    const baseline = {
      schema: 'kovo-api-surface-baseline/v2',
      recursivePublicness: {
        total: 1,
        packages: {
          '@kovojs/core': { maximum: 1, violations: ['old leak'] },
        },
      },
    };
    const comparison = recursiveRatchetComparison(baseline, [
      { id: 'new leak', package: '@kovojs/server' },
    ]);
    expect(comparison.overBudget).toEqual([{ package: '@kovojs/server', count: 1, maximum: 0 }]);
  });

  it('accepts only a descending recursive-publicness repair', () => {
    const baseline = {
      schema: 'kovo-api-surface-baseline/v2',
      recursivePublicness: {
        total: 2,
        packages: {
          '@kovojs/core': { maximum: 2, violations: ['fixed leak', 'remaining leak'] },
        },
      },
    };
    const comparison = recursiveRatchetComparison(baseline, [
      { id: 'remaining leak', package: '@kovojs/core' },
    ]);
    expect(comparison.added).toEqual([]);
    expect(comparison.removed).toEqual(['fixed leak']);
    expect(comparison.overBudget).toEqual([]);
    expect(comparison.counts).toEqual({ '@kovojs/core': 1 });
  });

  it('does not expose harness verifier internals through public harness options', () => {
    const current = surfaceReport.recursivePublicnessViolations;
    expect(
      current.filter(
        (violation) =>
          violation.startsWith('@kovojs/test./harness#KovoTestHarnessOptions') &&
          /(?:DbVerificationConfig|TouchGraph)/.test(violation),
      ),
    ).toEqual([]);
  });

  it('does not expose internal/public-adjacent test helper implementation types', () => {
    const current = surfaceReport.recursivePublicnessViolations;
    expect(
      current.filter(
        (violation) =>
          /@kovojs\/test\.(?:\/html-fragment|\/sqlite)#/.test(violation) &&
          /(?:HtmlJsonScriptFact|BetterSqliteHandle|BetterSqliteStatement)/.test(violation),
      ),
    ).toEqual([]);
  });

  it('detects a newly leaked (untagged, undocumented) public export', () => {
    const baseline = ['@kovojs/core#existingThing'];
    const current = ['@kovojs/core#existingThing', '@kovojs/core#brandNewLeak'];
    const { added } = compareViolations(baseline, current);
    expect(added).toEqual(['@kovojs/core#brandNewLeak']);
  });

  it('recognizes when a baselined violation has been documented or tagged', () => {
    const baseline = ['@kovojs/core#fixedThing', '@kovojs/core#stillBad'];
    const current = ['@kovojs/core#stillBad'];
    const { added, removed } = compareViolations(baseline, current);
    expect(added).toEqual([]);
    expect(removed).toEqual(['@kovojs/core#fixedThing']);
  });

  it('rejects @internal and @generated symbols on public entrypoints', () => {
    expect(
      classifyExport({ tier: 'public', documented: true, internal: true, generated: false }),
    ).toBe('internal-on-public');
    expect(
      classifyExport({ tier: 'public', documented: true, internal: false, generated: true }),
    ).toBe('generated-on-public');
  });

  it('allows generated ABI symbols only on generated entrypoints', () => {
    expect(
      classifyExport({ tier: 'generated', documented: false, internal: false, generated: true }),
    ).toBeNull();
    expect(
      classifyExport({ tier: 'generated', documented: true, internal: false, generated: false }),
    ).toBeNull();
    expect(
      classifyExport({ tier: 'generated', documented: false, internal: false, generated: false }),
    ).toBe('untagged-on-generated');
    expect(
      classifyExport({ tier: 'generated', documented: false, internal: true, generated: false }),
    ).toBe('internal-on-generated');
  });

  it('allows internal symbols only on internal entrypoints', () => {
    expect(
      classifyExport({ tier: 'internal', documented: false, internal: true, generated: false }),
    ).toBeNull();
    expect(
      classifyExport({ tier: 'internal', documented: true, internal: false, generated: false }),
    ).toBeNull();
    expect(
      classifyExport({ tier: 'internal', documented: false, internal: false, generated: false }),
    ).toBe('untagged-on-internal');
    expect(
      classifyExport({ tier: 'internal', documented: false, internal: false, generated: true }),
    ).toBe('generated-on-internal');
  });
});
