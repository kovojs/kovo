import { afterEach, describe, expect, it, vi } from 'vitest';

const passwordMocks = vi.hoisted(() => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));

vi.mock('@kovojs/server', () => passwordMocks);

import { betterAuthHashPassword, betterAuthVerifyPassword } from './password.js';

afterEach(() => {
  passwordMocks.hashPassword.mockReset();
  passwordMocks.verifyPassword.mockReset();
});

describe('Better Auth password boundary', () => {
  it('routes password hashing through the pinned Kovo Argon2 sink', async () => {
    passwordMocks.hashPassword.mockResolvedValue('$argon2id$v=19$proof');

    await expect(betterAuthHashPassword('secret password')).resolves.toBe('$argon2id$v=19$proof');
    expect(passwordMocks.hashPassword).toHaveBeenCalledExactlyOnceWith('secret password');
  });

  it('accepts only the exact positive Kovo verifier result', async () => {
    passwordMocks.verifyPassword
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, reason: 'mismatch' })
      .mockResolvedValueOnce({ ok: 1 });

    await expect(
      betterAuthVerifyPassword({ hash: 'argon digest', password: 'correct password' }),
    ).resolves.toBe(true);
    await expect(
      betterAuthVerifyPassword({ hash: 'argon digest', password: 'wrong password' }),
    ).resolves.toBe(false);
    await expect(
      betterAuthVerifyPassword({ hash: 'forged result', password: 'truthy result' }),
    ).resolves.toBe(false);
    expect(passwordMocks.verifyPassword).toHaveBeenNthCalledWith(
      1,
      'correct password',
      'argon digest',
    );
  });
});
