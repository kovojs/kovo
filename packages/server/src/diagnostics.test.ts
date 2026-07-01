import { secret } from '@kovojs/core';
import { describe, expect, it, vi } from 'vitest';

import { reportServerError } from './diagnostics.js';

describe('reportServerError secret lifecycle (SPEC §6.6 / DEC5)', () => {
  it('scrubs secret-tagged error and context values before app diagnostics hooks', () => {
    const onError = vi.fn();
    const error = new Error('provider failed');
    Object.defineProperty(error, 'token', {
      configurable: true,
      enumerable: true,
      value: secret('sk_live_q5_report_error'),
    });
    const request = { headers: { authorization: secret('bearer_q5_report_context') } };

    reportServerError(onError, error, {
      operation: 'route-page',
      request,
      url: 'https://app.test/account',
    });

    expect(onError).toHaveBeenCalledTimes(1);
    const [reportedError, context] = onError.mock.calls[0]!;
    expect(reportedError).toBeInstanceOf(Error);
    expect(reportedError).not.toBe(error);
    expect((reportedError as Error & { token?: unknown }).token).toBe('[secret]');
    expect(context).toMatchObject({
      operation: 'route-page',
      request: { headers: { authorization: '[secret]' } },
    });
    expect(JSON.stringify(onError.mock.calls)).not.toContain('sk_live_q5_report');
  });

  it('preserves ordinary error and context identity when no secret tags are present', () => {
    const onError = vi.fn();
    const error = new Error('ordinary failure');
    const request = { id: 'req_1' };
    const context = {
      operation: 'route-page' as const,
      request,
      url: 'https://app.test/account',
    };

    reportServerError(onError, error, context);

    expect(onError).toHaveBeenCalledWith(error, context);
  });
});
