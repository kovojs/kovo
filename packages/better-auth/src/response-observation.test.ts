import { describe, expect, it, vi } from 'vitest';

vi.mock('./internal/runtime-lock.js', () => ({
  assertBetterAuthRuntimeRealmLocked: vi.fn(),
}));

import {
  normalizeBetterAuthAccountOperation,
  normalizeBetterAuthPasswordResetResponse,
} from './internal.js';

describe('Better Auth account response normalization', () => {
  it.each([
    [200, { user: { id: 'private-new-account-id' } }],
    [422, { code: 'USER_ALREADY_EXISTS', message: 'account exists' }],
  ])('maps upstream signup status %i to the same generic accepted result', async (status, body) => {
    const response = new Response(JSON.stringify(body), {
      headers: {
        'content-type': 'application/json',
        'set-cookie': status === 200 ? 'session=private; HttpOnly; Secure' : '',
      },
      status,
    });
    await expect(
      normalizeBetterAuthAccountOperation(response, {
        redirectTo: '/check-email',
        status: 'signed-up',
      }),
    ).resolves.toEqual({ redirectTo: '/check-email', status: 'signed-up' });
    expect(response.bodyUsed).toBe(true);
  });

  it.each([
    [200, { message: 'reset sent' }],
    [200, { message: 'if that account exists, reset sent' }],
    [404, { code: 'USER_NOT_FOUND' }],
  ])('normalizes password-reset provider world status %i', async (status, body) => {
    const response = new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
      status,
    });
    await expect(normalizeBetterAuthPasswordResetResponse(response)).resolves.toEqual({
      redirectTo: '/',
      status: 'recovery-accepted',
    });
    expect(response.bodyUsed).toBe(true);
  });
});
