import { describe, expect, it, vi } from 'vitest';

const diagnosticEntropy = vi.hoisted(() => ({ available: true }));

vi.mock('./response-security-intrinsics.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./response-security-intrinsics.js')>();
  return {
    ...original,
    securityRandomUuid() {
      if (!diagnosticEntropy.available) {
        throw new Error('simulated unavailable diagnostic entropy');
      }
      return original.securityRandomUuid();
    },
  };
});

import { reportServerError } from './diagnostics.js';

describe('trusted-boundary diagnostic correlation ids', () => {
  it('falls back to the exact fixed-width monotone sequence when authority entropy fails', () => {
    diagnosticEntropy.available = false;
    const firstHook = vi.fn();
    const secondHook = vi.fn();

    reportServerError(firstHook, new Error('first'), { operation: 'route-page' });
    reportServerError(secondHook, new Error('second'), { operation: 'route-page' });

    expect(firstHook.mock.calls[0]?.[1].failure.correlationId).toBe(
      'ktb_00000000000000000000000000000001',
    );
    expect(secondHook.mock.calls[0]?.[1].failure.correlationId).toBe(
      'ktb_00000000000000000000000000000002',
    );
  });
});
