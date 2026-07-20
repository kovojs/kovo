import { describe, expect, it } from 'vitest';

import { analyzeSafeComponentFixes, proveSafeComponentRewrite } from './scan/safe-fixes.js';
import { measureAgentAuthoredCostToGreenCorpus } from './security/cost-to-green-corpus.js';

describe('SPEC §5.2 / §11.4 safe cost-to-green rewrites', () => {
  it('removes a redundant lowered-IR stamp and proves compiler-owned security lowering is green', () => {
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
    expect(result.proof).toBe('compiler-derived-security-hardening');
    expect(result.behaviorFingerprintBefore).toBeNull();
    expect(result.behaviorFingerprintAfter).toMatch(/^\{/);
    expect(result.diagnosticsAfter).toEqual([]);
  });

  it('removes only behavior-equivalent primitive-owned overrides', () => {
    const equivalent = `
export const Toggle = component({
  render: () => (
    <Tooltip.Trigger attrs={{ 'data-state': 'closed' }}>
      {(attrs) => <button {...attrs} data-state="open">Toggle</button>}
    </Tooltip.Trigger>
  ),
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
export const InlineScript = component({
  render: ({ profile }) => <script>{profile.inline}</script>,
});
`;

    expect(analyzeSafeComponentFixes({ fileName: 'inline-script.tsx', source })).toMatchObject({
      blockedCodes: ['KV236'],
      status: 'blocked',
    });

    const mismatchedStamp = `
export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <span data-bind="cart.count">{cart.total}</span>,
});
`;
    expect(
      analyzeSafeComponentFixes({ fileName: 'cart-badge.tsx', source: mismatchedStamp }),
    ).toMatchObject({
      blockedCodes: expect.arrayContaining(['KV222']),
      status: 'blocked',
    });

    const unsupportedKv223 = `
export const CartRegion = component({
  fragmentTarget: true,
  queries: { cart: cartQuery },
  render: ({ cart }) => <section>{cart.count}</section>,
});
`;
    expect(
      analyzeSafeComponentFixes({ fileName: 'cart-region.tsx', source: unsupportedKv223 }),
    ).toMatchObject({ blockedCodes: ['KV223'], status: 'blocked' });
  });

  // @kovo-security-certifies C13 cost-to-green-safe-rewrite-analyzer-binding
  it('kills rewrite and analyzer-drift mutants before source is accepted as green', () => {
    const source = `
export const Toggle = component({
  render: () => (
    <Tooltip.Trigger attrs={{ 'data-state': 'closed' }}>
      {(attrs) => <button {...attrs} data-state="open">Toggle</button>}
    </Tooltip.Trigger>
  ),
});
`;
    const planned = analyzeSafeComponentFixes({ fileName: 'toggle.tsx', source });
    expect(planned.status).toBe('fixable');
    if (planned.status !== 'fixable') return;
    expect(planned.proof).toBe('behavior-equivalent');
    if (planned.proof !== 'behavior-equivalent') return;

    const rewriteMutant = planned.source.replace(
      "'data-state': 'closed'",
      "'data-state': 'attacker-selected'",
    );
    expect(
      proveSafeComponentRewrite({
        edits: planned.edits,
        expectedBehaviorFingerprint: planned.behaviorFingerprintBefore,
        fileName: 'toggle.tsx',
        originalSource: source,
        proof: 'behavior-equivalent',
        source: rewriteMutant,
        targetCodes: ['KV232'],
      }),
    ).toMatchObject({ ok: false, reason: 'emitted-behavior-drift' });

    expect(
      proveSafeComponentRewrite({
        edits: planned.edits,
        expectedBehaviorFingerprint: planned.behaviorFingerprintBefore,
        fileName: 'toggle.tsx',
        originalSource: source,
        proof: 'behavior-equivalent',
        source,
        targetCodes: ['KV232'],
      }),
    ).toMatchObject({ ok: false, reason: 'target-diagnostic-remains' });

    const bindingSource = `
export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <span data-bind="cart.count">{cart.count}</span>,
});
`;
    const hardening = analyzeSafeComponentFixes({
      fileName: 'cart-badge.tsx',
      source: bindingSource,
    });
    expect(hardening.status).toBe('fixable');
    if (hardening.status !== 'fixable') return;
    expect(hardening.proof).toBe('compiler-derived-security-hardening');
    if (hardening.proof !== 'compiler-derived-security-hardening') return;
    expect(
      proveSafeComponentRewrite({
        edits: hardening.edits,
        fileName: 'cart-badge.tsx',
        originalSource: bindingSource,
        proof: hardening.proof,
        source: hardening.source.replace('{cart.count}', '{"attacker-selected"}'),
        targetCodes: ['KV223'],
      }),
    ).toMatchObject({ ok: false, reason: 'rewrite-shape-drift' });
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
