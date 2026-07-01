import { describe, expect, it } from 'vitest';

import {
  SECURITY_GATE_MUTANTS,
  applyExactMutation,
  runSecurityGateMutationHarness,
} from './security-gate-mutations.mjs';

describe('security-gate-mutations', () => {
  it('kills every enrolled security gate branch deletion mutant', async () => {
    const results = await runSecurityGateMutationHarness();

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'security-test-build-gate/drop-missing-real-build-proof',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'security-test-build-gate/drop-security-certification-marker-extractor',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'security-test-build-gate/drop-stale-proof-row-rejection',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'security-test-build-gate/drop-production-build-invocation-check',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'security-test-build-gate/drop-required-proof-file-evidence',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'security-test-build-gate/weaken-js-to-ts-sibling-proof-enrollment',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'security-test-build-gate/weaken-kv311-island-derive-proof-enrollment',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'security-test-build-gate/weaken-kv435-safe-sibling-proof-enrollment',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'check-sink-policy-gate/drop-sql-guard-env-detector',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'check-sink-policy-gate/drop-managed-db-throw-invariant',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'check-sink-policy-gate/drop-response-fragment-trustedhtml-route-count',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'fundamental-fixes-census-gate/drop-m5-forbidden-status-enforcement',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'fundamental-fixes-census-gate/drop-closed-row-m1-evidence-enforcement',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'fundamental-fixes-census-gate/drop-dialect-matrix-requirement',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'fundamental-fixes-census-gate/drift-resolver-expression-kind-denominator',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'fundamental-fixes-census-gate/drop-resolver-status-requirement',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'fundamental-fixes-census-gate/drop-resolver-coverage-expectation-requirement',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'fundamental-fixes-census-gate/drop-unknown-resolver-expression-kind-rejection',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'core-framework-identity/drop-element-access-kind-resolution',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'core-framework-identity/drop-element-access-canonicalization',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'core-framework-identity/drop-export-star-resolution',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'compiler-compile/drop-framework-identity-project-registration',
          status: 'killed',
        }),
        expect.objectContaining({
          name: 'compiler-vite/drop-js-to-ts-sibling-candidates',
          status: 'killed',
        }),
      ]),
    );
    expect(results.every((result) => result.status === 'killed')).toBe(true);
    expect(results.length).toBe(SECURITY_GATE_MUTANTS.length);
  });

  it('reports a surviving mutant when the branch mutation is a no-op', async () => {
    const noopMutant = {
      ...SECURITY_GATE_MUTANTS[0],
      name: 'security-test-build-gate/noop-missing-real-build-proof',
      replacement: SECURITY_GATE_MUTANTS[0].search,
    };

    await expect(runSecurityGateMutationHarness({ mutants: [noopMutant] })).resolves.toEqual([
      expect.objectContaining({
        name: 'security-test-build-gate/noop-missing-real-build-proof',
        status: 'survived',
      }),
    ]);
  });

  it('requires exact mutation targets so branch drift is not silently skipped', () => {
    expect(() =>
      applyExactMutation('const notTheBranch = true;', SECURITY_GATE_MUTANTS[0]),
    ).toThrow('mutation target was not found');
  });
});
