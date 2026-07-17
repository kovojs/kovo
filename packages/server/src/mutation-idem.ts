import { securityBufferToString, securityRandomBytes } from './response-security-intrinsics.js';
import {
  requestStateIsSafeInteger,
  requestStateNow,
  requestStateParseUnsignedInteger,
  requestStateRegExpTest,
  requestStateSlice,
  requestStateString,
} from './request-state-intrinsics.js';
import { witnessFreeze } from './security-witness-intrinsics.js';

/** SPEC §10.3: mutation replay truth is retained for the supported 24-hour retry horizon. */
export const MUTATION_IDEM_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

/** SPEC §10.3: tolerate small client/server clock drift without accepting unbounded future tokens. */
export const MUTATION_IDEM_MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;

const MUTATION_IDEM_TOKEN_PATTERN = /^v1_[0-9]{13}_[0-9a-f]{32}$/u;
const MUTATION_IDEM_ISSUED_AT_START = 3;
const MUTATION_IDEM_ISSUED_AT_END = 16;

/**
 * Immutable facts parsed from one canonical mutation idempotency token (SPEC §10.3).
 *
 * The replay policy consumes `token`, while durable stores may consume `issuedAtMs` and
 * `expiresAtMs` for expiry without re-reading or reparsing a caller-owned carrier.
 */
export interface MutationIdemTokenFacts {
  readonly expiresAtMs: number;
  readonly issuedAtMs: number;
  readonly token: string;
}

/** Parse the canonical versioned token grammar without making a clock decision. */
export function parseMutationIdemToken(value: unknown): MutationIdemTokenFacts | undefined {
  if (typeof value !== 'string' || !requestStateRegExpTest(MUTATION_IDEM_TOKEN_PATTERN, value)) {
    return undefined;
  }

  const issuedAtMs = requestStateParseUnsignedInteger(
    requestStateSlice(value, MUTATION_IDEM_ISSUED_AT_START, MUTATION_IDEM_ISSUED_AT_END),
  );
  if (issuedAtMs === undefined) return undefined;
  const expiresAtMs = issuedAtMs + MUTATION_IDEM_MAX_AGE_MS;
  if (!requestStateIsSafeInteger(expiresAtMs)) return undefined;

  return witnessFreeze({ expiresAtMs, issuedAtMs, token: value });
}

/**
 * Parse and enforce the exact mutation retry horizon before replay storage or handler dispatch.
 * The expiry boundary is exclusive: a token is stale when `nowMs === expiresAtMs`.
 */
export function validateMutationIdemToken(
  value: unknown,
  nowMs: number = requestStateNow(),
): MutationIdemTokenFacts | undefined {
  if (!requestStateIsSafeInteger(nowMs) || nowMs < 0) {
    throw new TypeError('Kovo mutation idempotency clock must be a non-negative integer.');
  }
  const facts = parseMutationIdemToken(value);
  if (facts === undefined) return undefined;
  if (facts.issuedAtMs > nowMs + MUTATION_IDEM_MAX_FUTURE_SKEW_MS) return undefined;
  if (nowMs >= facts.expiresAtMs) return undefined;
  return facts;
}

/** Mint a canonical server-time token carrying an exact 128-bit cryptographic nonce. */
export function mintMutationIdemToken(nowMs: number = requestStateNow()): string {
  if (!requestStateIsSafeInteger(nowMs) || nowMs < 1_000_000_000_000 || nowMs > 9_999_999_999_999) {
    throw new TypeError('Kovo mutation idempotency clock is outside the 13-digit epoch range.');
  }
  const issuedAt = requestStateString(nowMs);
  const nonce = securityBufferToString(securityRandomBytes(16), 'hex');
  return `v1_${issuedAt}_${nonce}`;
}
