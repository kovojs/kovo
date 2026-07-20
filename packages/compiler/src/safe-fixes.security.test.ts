import { describe, expect, it } from 'vitest';

import {
  analyzeSafeComponentFixes,
  proveSafeComponentRewrite,
} from './safe-fixes.js';
import { measureAgentAuthoredCostToGreenCorpus } from './security/cost-to-green-corpus.js';

describe('SPEC §5.2 / §11.4 safe cost-to-green rewrites', () => {
  it('removes a redundant derived binding stamp and proves emitted behavior is unchanged', () => {
    const source = `
export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <span data-bind="cart.count">{cart.count}</span>,
});
`;

    const result = analyzeSafeComponentFixes({ fileName: 'cart-badge.tsx', source });

    expect(result.status).toBe('fixable');
    if (result.status !== 'fixable') return;
    expect(result.edits).toMatchObject([
      { code: 'KV223', editAtoms: 1, recipe: 'remove-derived-stamp' },
    ]);
    expect(result.source).not.toContain('data-bind="cart.count"');
    expect(result.behaviorFingerprintAfter).toBe(result.behaviorFingerprintBefore);
    expect(result.diagnosticsAfter).toEqual([]);
  });

  it('removes only behavior-equivalent primitive-owned overrides', () => {
    const equivalent = `
export const Toggle = component({
  render: () => <button data-state="closed" data-state="closed">Toggle</button>,
});
`;
    const conflicting = `
export const Toggle = component({
  render: () => <button role="button" role="link">Toggle</button>,
});
`;

    const fixed = analyzeSafeComponentFixes({ fileName: 'toggle.tsx', source: equivalent });
    expect(fixed.status).toBe('fixable');
    if (fixed.status === 'fixable') {
      expect(fixed.edits).toMatchObject([
        { code: 'KV232', editAtoms: 1, recipe: 'remove-behavior-equivalent-override' },
      ]);
      expect(fixed.diagnosticsAfter).toEqual([]);
      expect(fixed.behaviorFingerprintAfter).toBe(fixed.behaviorFingerprintBefore);
    }

    const refused = analyzeSafeComponentFixes({ fileName: 'toggle.tsx', source: conflicting });
    expect(refused).toMatchObject({
      blockedCodes: ['KV232'],
      status: 'blocked',
    });
    expect(refused.reason).toContain('emitted behavior');
  });

  it('fails closed for ambiguous output-safety diagnostics instead of synthesizing an escape', () => {
    const source = `
export const Link = component({
  render: ({ profile }) => <a href={profile.next}>Next</a>,
});
`;

    expect(analyzeSafeComponentFixes({ fileName: 'link.tsx', source })).toMatchObject({
      blockedCodes: ['KV236'],
      status: 'blocked',
    });
  });

  // @kovo-security-certifies C13 cost-to-green-safe-rewrite-analyzer-binding
  it('kills rewrite and analyzer-drift mutants before source is accepted as green', () => {
    const source = `
export const Toggle = component({
  render: () => <button data-state="closed" data-state="closed">Toggle</button>,
});
`;
    const planned = analyzeSafeComponentFixes({ fileName: 'toggle.tsx', source });
    expect(planned.status).toBe('fixable');
    if (planned.status !== 'fixable') return;

    const rewriteMutant = planned.source.replace(
      'data-state="closed"',
      'data-state="attacker-selected"',
    );
    expect(
      proveSafeComponentRewrite({
        expectedBehaviorFingerprint: planned.behaviorFingerprintBefore,
        fileName: 'toggle.tsx',
        source: rewriteMutant,
        targetCodes: ['KV232'],
      }),
    ).toMatchObject({ ok: false, reason: 'emitted-behavior-drift' });

    expect(
      proveSafeComponentRewrite({
        expectedBehaviorFingerprint: planned.behaviorFingerprintBefore,
        fileName: 'toggle.tsx',
        source,
        targetCodes: ['KV223'],
      }),
    ).toMatchObject({ ok: false, reason: 'target-diagnostic-remains' });
  });

  it('measures the agent-authored corpus and owns every escape-cheaper defect', () => {
    const report = measureAgentAuthoredCostToGreenCorpus();

    expect(report.schema).toBe('kovo.cost-to-green/v1');
    expect(report.highestTrafficSafeCodes).toEqual(['KV232', 'KV223']);
    expect(report.diagnostics).toMatchObject([
      {
        code: 'KV236',
        defectOwner: 'compiler-output-safety',
        escapeEditAtoms: 2,
        safeEditAtoms: null,
        status: 'framework-defect',
        traffic: 5,
      },
      {
        code: 'KV232',
        costDelta: -1,
        escapeEditAtoms: 2,
        safeEditAtoms: 1,
        status: 'safe-rewrite',
        traffic: 4,
      },
      {
        code: 'KV223',
        costDelta: -1,
        escapeEditAtoms: 2,
        safeEditAtoms: 1,
        status: 'safe-rewrite',
        traffic: 3,
      },
    ]);
    for (const row of report.diagnostics) {
      if (row.status === 'framework-defect') expect(row.defectOwner).toMatch(/\S/);
    }
  });
});
