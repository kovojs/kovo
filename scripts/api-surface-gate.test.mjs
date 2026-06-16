import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { compareViolations, computeViolations } from './api-surface-gate.mjs';
import { repoRoot } from './public-packages.mjs';

/**
 * The api-surface gate is only meaningful if its baseline stays in sync with the
 * real public surface and its ratchet actually catches new leaks (plan Phase 3).
 */

describe('api-surface gate', () => {
  it('keeps the committed baseline in sync with the real public surface', () => {
    const baseline = JSON.parse(
      readFileSync(path.join(repoRoot, 'api-surface-baseline.json'), 'utf8'),
    );
    const current = computeViolations();
    // No drift in either direction: every current violation is baselined, and the
    // baseline lists nothing already fixed (regenerate with --write after curating).
    const { added, removed } = compareViolations(baseline.violations, current);
    expect(added, `new undocumented/untagged public exports: ${added.join(', ')}`).toEqual([]);
    expect(removed, `baseline lists fixed exports — regenerate: ${removed.join(', ')}`).toEqual([]);
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
});
