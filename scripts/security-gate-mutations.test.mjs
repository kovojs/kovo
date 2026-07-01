import { describe, expect, it } from 'vitest';

import {
  SECURITY_GATE_MUTANTS,
  applyExactMutation,
  runSecurityGateMutationHarness,
} from './security-gate-mutations.mjs';

describe('security-gate-mutations', () => {
  it('kills the missing real-build proof branch deletion mutant', async () => {
    await expect(runSecurityGateMutationHarness()).resolves.toEqual([
      expect.objectContaining({
        name: 'security-test-build-gate/drop-missing-real-build-proof',
        status: 'killed',
      }),
    ]);
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
