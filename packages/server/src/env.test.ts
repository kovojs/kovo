import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import {
  committedSecretWaiver,
  CreateAppBootError,
  estimateEntropyBits,
  isCreateAppBootError,
  looksLikeCommittedSecret,
  resolveBootMode,
  validateAppEnv,
} from './env.js';
import { s } from './schema.js';

// A real, length-clearing secret (~43 base64url chars ≈ 192 bits), matching what the
// anonymous-CSRF path mints with `randomBytes(32).toString('base64url')`.
const STRONG_SECRET = 'pX2k9QwErT7yUiOpAsDfGhJkLzXcVbNmQwErTyUiOpA';
const sessionId = () => 'session-1';

describe('validateAppEnv — framework secret refuse-to-boot (SPEC §6.6)', () => {
  describe('production: refuses boot (by-construction at the chokepoint)', () => {
    it('throws CreateAppBootError on an empty csrf secret', () => {
      expect(() => validateAppEnv({ csrfSecret: '' }, { mode: 'production' })).toThrow(
        CreateAppBootError,
      );
    });

    it('throws on a too-short csrf secret with an actionable message', () => {
      let caught: unknown;
      try {
        validateAppEnv({ csrfSecret: 'short' }, { mode: 'production' });
      } catch (error) {
        caught = error;
      }
      expect(isCreateAppBootError(caught)).toBe(true);
      const error = caught as CreateAppBootError;
      expect(error.issues).toHaveLength(1);
      expect(error.issues[0]).toMatchObject({
        code: 'too-short',
        path: 'csrf.secret',
        fatal: true,
      });
      expect(error.message).toContain('csrf.secret');
      expect(error.message).toContain('randomBytes');
    });

    it('throws on a non-string secret', () => {
      const error = captureBootError(() =>
        validateAppEnv({ csrfSecret: 1234 as unknown }, { mode: 'production' }),
      );
      expect(error.issues[0]).toMatchObject({ code: 'invalid', path: 'csrf.secret', fatal: true });
    });

    it('does not throw on a strong secret', () => {
      expect(() =>
        validateAppEnv({ csrfSecret: STRONG_SECRET }, { mode: 'production' }),
      ).not.toThrow();
    });

    it('does not throw when no csrf secret is configured (CSRF is opt-in)', () => {
      expect(() => validateAppEnv({}, { mode: 'production' })).not.toThrow();
    });

    it('warns (does not throw) on a long-but-low-entropy secret', () => {
      const warnings: string[] = [];
      validateAppEnv(
        { csrfSecret: 'a'.repeat(64) },
        { mode: 'production', onWarn: (m) => warnings.push(m) },
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('advisory');
      expect(warnings[0]).toContain('entropy');
    });
  });

  describe('development: lenient (warn, never brick localhost)', () => {
    it('warns instead of throwing on an empty secret', () => {
      const warnings: string[] = [];
      expect(() =>
        validateAppEnv(
          { csrfSecret: '' },
          { mode: 'development', onWarn: (m) => warnings.push(m) },
        ),
      ).not.toThrow();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('WOULD-REFUSE-BOOT-IN-PROD');
      expect(warnings[0]).toContain('csrf.secret');
    });

    it('warns on a too-short secret without throwing', () => {
      const warnings: string[] = [];
      validateAppEnv(
        { csrfSecret: 'nope' },
        { mode: 'development', onWarn: (m) => warnings.push(m) },
      );
      expect(warnings).toHaveLength(1);
    });

    it('stays silent for a strong secret', () => {
      const warnings: string[] = [];
      validateAppEnv(
        { csrfSecret: STRONG_SECRET },
        { mode: 'development', onWarn: (m) => warnings.push(m) },
      );
      expect(warnings).toHaveLength(0);
    });
  });

  describe('app env schema (createApp({ env }))', () => {
    const envSchema = s.object({ DATABASE_URL: s.string(), API_TOKEN: s.string() });

    it('throws CreateAppBootError in prod when a required env var is missing', () => {
      const error = captureBootError(() =>
        validateAppEnv(
          { csrfSecret: STRONG_SECRET },
          { mode: 'production', env: envSchema, envSource: { DATABASE_URL: 'postgres://x' } },
        ),
      );
      expect(error.issues.some((i) => i.path.startsWith('env.') && i.fatal)).toBe(true);
    });

    it('passes when all required env vars are present', () => {
      expect(() =>
        validateAppEnv(
          { csrfSecret: STRONG_SECRET },
          {
            mode: 'production',
            env: envSchema,
            envSource: { DATABASE_URL: 'postgres://x', API_TOKEN: 'tok' },
          },
        ),
      ).not.toThrow();
    });

    it('warns (not throws) on a missing env var in development', () => {
      const warnings: string[] = [];
      validateAppEnv(
        { csrfSecret: STRONG_SECRET },
        {
          mode: 'development',
          env: envSchema,
          envSource: {},
          onWarn: (m) => warnings.push(m),
        },
      );
      expect(warnings).toHaveLength(1);
    });
  });
});

describe('committed-secret lint (audit-grade, SPEC §6.6)', () => {
  it('flags a hardcoded high-entropy secret literal', () => {
    expect(looksLikeCommittedSecret('Kx9' + 'aB3cD7eF2gH5jK8mN1pQ4rS6tU0vW9xY2zA5bC8dE')).toBe(
      true,
    );
  });

  it('does not flag a short/low-entropy value', () => {
    expect(looksLikeCommittedSecret('changeme')).toBe(false);
    expect(looksLikeCommittedSecret('a'.repeat(64))).toBe(false);
  });

  it('a waiver suppresses the flag', () => {
    const secret = 'Zq7' + 'rT4yU8iO1pA5sD9fG3hJ6kL0xC4vB8nM2qW7eR1tY';
    expect(looksLikeCommittedSecret(secret)).toBe(true);
    committedSecretWaiver(secret, { justification: 'public sample token in a fixture' });
    expect(looksLikeCommittedSecret(secret)).toBe(false);
  });

  it('a waiver requires a justification', () => {
    expect(() => committedSecretWaiver('x', { justification: '' })).toThrow(/justification/);
  });
});

describe('helpers', () => {
  it('estimateEntropyBits is ~0 for a repeated char and high for random', () => {
    expect(estimateEntropyBits('a'.repeat(64))).toBeLessThan(1);
    expect(estimateEntropyBits(STRONG_SECRET)).toBeGreaterThan(64);
  });

  it('resolveBootMode honors explicit mode and falls back to NODE_ENV', () => {
    expect(resolveBootMode('production')).toBe('production');
    expect(resolveBootMode('development')).toBe('development');
  });
});

describe('createApp boot integration (the chokepoint)', () => {
  it('boots fine in dev with a weak secret (warns, not bricks)', () => {
    expect(() => createApp({ csrf: { secret: 'weak', sessionId } })).not.toThrow();
  });

  it('boots fine with a strong secret', () => {
    expect(() => createApp({ csrf: { secret: STRONG_SECRET, sessionId } })).not.toThrow();
  });

  it('refuses to boot in production with a missing secret (NODE_ENV=production)', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => createApp({ csrf: { secret: '', sessionId } })).toThrow(CreateAppBootError);
      // a strong secret boots fine even in production
      expect(() => createApp({ csrf: { secret: STRONG_SECRET, sessionId } })).not.toThrow();
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it('refuses to boot in production when a declared env var is missing', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() =>
        createApp({
          csrf: { secret: STRONG_SECRET, sessionId },
          env: s.object({ DATABASE_URL: s.string() }),
          envSource: {},
        }),
      ).toThrow(CreateAppBootError);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });
});

function captureBootError(run: () => void): CreateAppBootError {
  try {
    run();
  } catch (error) {
    if (isCreateAppBootError(error)) return error;
    throw error;
  }
  throw new Error('expected CreateAppBootError, but nothing was thrown');
}
