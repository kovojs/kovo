import type { BetterAuthRateLimitBucketConsumer } from '@kovojs/server/internal/better-auth';
import { frameworkScopedKey, scopedKeyFactsFor } from '@kovojs/core/internal/storage';
import type { BetterAuthRateLimitOptions } from 'better-auth';

const credentialRateLimitWindowSeconds = 10;
const credentialRateLimitMax = 3;
const defaultBucketCount = 65_536;
const maximumRateLimitKeyLength = 1_024;

interface BoundedRateLimitStorageOptions {
  /** Smaller powers are test-only and make deterministic collision tests inexpensive. */
  bucketCount?: number;
}

/**
 * Construct Kovo's bounded, atomic Better Auth credential limiter.
 *
 * Better Auth still sees `storage: 'database'` so its schema metadata includes `rateLimit`, but
 * every runtime decision goes through `customStorage.consume`. `get` and `set` deliberately throw:
 * an upstream fallback must fail loud rather than silently reintroduce a concurrent bypass.
 *
 * This module is private to the first-party SQLite/Postgres binding constructors.
 */
export function createBetterAuthBoundedRateLimitStorage(
  secret: string,
  consumeBucket: BetterAuthRateLimitBucketConsumer,
  options: BoundedRateLimitStorageOptions = {},
): BetterAuthRateLimitOptions {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new TypeError(
      'Better Auth bounded rate-limit storage requires validated signing material.',
    );
  }
  if (typeof consumeBucket !== 'function') {
    throw new TypeError(
      'Better Auth bounded rate-limit storage requires an atomic bucket consumer.',
    );
  }
  const bucketCount = options.bucketCount ?? defaultBucketCount;
  if (!Number.isInteger(bucketCount) || bucketCount < 1 || bucketCount > defaultBucketCount) {
    throw new TypeError('Better Auth bounded rate-limit bucket count must be 1..65536.');
  }

  const encoder = new TextEncoder();
  const signingKey = crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  );

  async function bucketFor(rawKey: string): Promise<string> {
    assertCredentialRateLimitKey(rawKey);
    const sourceFrame = scopedKeyFactsFor(
      frameworkScopedKey('better-auth-rate-limit', rawKey),
    ).frame;
    const digest = new Uint8Array(
      await crypto.subtle.sign('HMAC', await signingKey, encoder.encode(sourceFrame)),
    );
    const bucket = (((digest[0] ?? 0) << 8) | (digest[1] ?? 0)) % bucketCount;
    return bucket.toString(16).padStart(4, '0');
  }

  const disabledFallback = async (): Promise<never> => {
    throw new Error(
      'KV414: Better Auth rate-limit fallback is disabled; atomic customStorage.consume is required (SPEC §6.6).',
    );
  };

  const postCredentialRule = (request: Request) =>
    request.method === 'POST'
      ? { max: credentialRateLimitMax, window: credentialRateLimitWindowSeconds }
      : false;

  return {
    customRules: {
      '/sign-in/email': postCredentialRule,
      '/sign-up/email': postCredentialRule,
      '/**': false,
    },
    customStorage: {
      get: disabledFallback,
      set: disabledFallback,
      async consume(rawKey, rule) {
        if (
          typeof rule !== 'object' ||
          rule === null ||
          rule.max !== credentialRateLimitMax ||
          rule.window !== credentialRateLimitWindowSeconds
        ) {
          throw new Error(
            'KV414: Better Auth attempted to consume an unreviewed credential rate-limit rule.',
          );
        }
        const allowed = await consumeBucket({
          bucketKey: frameworkScopedKey('better-auth-rate-limit', await bucketFor(rawKey)),
          max: credentialRateLimitMax,
          windowMs: credentialRateLimitWindowSeconds * 1_000,
        });
        return {
          allowed,
          retryAfter: allowed ? null : credentialRateLimitWindowSeconds,
        };
      },
    },
    enabled: true,
    // Metadata only: Better Auth's schema census declares rateLimit for database storage, while
    // getRateLimitStorage() gives customStorage precedence for every runtime request.
    storage: 'database',
  };
}

function assertCredentialRateLimitKey(rawKey: string): void {
  if (
    typeof rawKey !== 'string' ||
    rawKey.length === 0 ||
    rawKey.length > maximumRateLimitKeyLength
  ) {
    throw new Error('KV414: Better Auth supplied an invalid credential rate-limit key.');
  }
  const separator = rawKey.lastIndexOf('|');
  const path = separator < 0 ? '' : rawKey.slice(separator + 1);
  if (separator < 1 || (path !== '/sign-in/email' && path !== '/sign-up/email')) {
    throw new Error('KV414: Better Auth supplied an unreviewed credential rate-limit path.');
  }
}
