import { describe, expect, it } from 'vitest';

import {
  MUTATION_IDEM_MAX_AGE_MS,
  MUTATION_IDEM_MAX_FUTURE_SKEW_MS,
  mintMutationIdemToken,
  parseMutationIdemToken,
  validateMutationIdemToken,
} from './mutation-idem.js';

const NOW = 1_768_000_000_000;
const NONCE = '0123456789abcdef'.repeat(2);

function tokenAt(issuedAtMs: number, nonce = NONCE): string {
  return `v1_${issuedAtMs}_${nonce}`;
}

describe('time-scoped mutation idempotency tokens (SPEC §10.3)', () => {
  it('mints a canonical server-time token with an exact 16-byte nonce', () => {
    const token = mintMutationIdemToken(NOW);
    const match = /^v1_([0-9]{13})_([0-9a-f]{32})$/u.exec(token);

    expect(match?.[1]).toBe(String(NOW));
    expect(match?.[2]).toHaveLength(32);
    expect(Buffer.from(match?.[2] ?? '', 'hex')).toHaveLength(16);
  });

  it('returns frozen issued-at and exclusive-expiry facts for durable-store reuse', () => {
    const token = tokenAt(NOW);
    const facts = parseMutationIdemToken(token);

    expect(facts).toEqual({
      expiresAtMs: NOW + MUTATION_IDEM_MAX_AGE_MS,
      issuedAtMs: NOW,
      token,
    });
    expect(Object.isFrozen(facts)).toBe(true);
  });

  it.each([
    ['legacy timeless token', `idem_${NONCE}`],
    ['legacy UUID', '123e4567-e89b-42d3-a456-426614174000'],
    ['wrong version', `v2_${NOW}_${NONCE}`],
    ['short timestamp', `v1_123_${NONCE}`],
    ['short nonce', `v1_${NOW}_${NONCE.slice(2)}`],
    ['uppercase nonce', `v1_${NOW}_${NONCE.toUpperCase()}`],
    ['non-hex nonce', `v1_${NOW}_${'z'.repeat(32)}`],
  ])('rejects a malformed %s', (_label, token) => {
    expect(parseMutationIdemToken(token)).toBeUndefined();
    expect(validateMutationIdemToken(token, NOW)).toBeUndefined();
  });

  it('accepts through the last millisecond of the 24-hour horizon and rejects exact expiry', () => {
    const token = tokenAt(NOW);

    expect(validateMutationIdemToken(token, NOW + MUTATION_IDEM_MAX_AGE_MS - 1)?.token).toBe(token);
    expect(validateMutationIdemToken(token, NOW + MUTATION_IDEM_MAX_AGE_MS)).toBeUndefined();
  });

  it('accepts the exact future-skew boundary and rejects one millisecond beyond it', () => {
    expect(
      validateMutationIdemToken(tokenAt(NOW + MUTATION_IDEM_MAX_FUTURE_SKEW_MS), NOW)?.issuedAtMs,
    ).toBe(NOW + MUTATION_IDEM_MAX_FUTURE_SKEW_MS);
    expect(
      validateMutationIdemToken(tokenAt(NOW + MUTATION_IDEM_MAX_FUTURE_SKEW_MS + 1), NOW),
    ).toBeUndefined();
  });
});
