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
      url: '/account',
    };

    reportServerError(onError, error, context);

    expect(onError).toHaveBeenCalledWith(error, context);
  });

  it('removes every request query value from onError context, Request views, and error text', () => {
    const token = 'CAPABILITY_BEARER_SHOULD_NEVER_LOG';
    const request = new Request(
      `https://app.test/_kovo/storage/a?kovo-cap=${token}&State=oauth&state=duplicate`,
    );
    const error = new Error(`storage failed while reading ${request.url}`);
    error.name = `StorageError ${request.url}`;
    Object.defineProperty(error, 'requestUrl', {
      configurable: true,
      enumerable: true,
      value: request.url,
    });
    const onError = vi.fn();

    reportServerError(onError, error, {
      operation: 'app-request',
      request,
      url: `/_kovo/storage/a?kovo-cap=${token}&State=oauth&state=duplicate`,
    });

    expect(onError).toHaveBeenCalledTimes(1);
    const [reportedError, context] = onError.mock.calls[0]!;
    expect(context.url).toBe('/_kovo/storage/a?kovo-cap&State&state');
    expect(context.request).toBeInstanceOf(Request);
    expect(context.request).not.toBe(request);
    expect(context.request.url).toBe(
      'https://app.test/_kovo/storage/a?kovo-cap&State&state',
    );
    expect(context.request.clone().url).toBe(
      'https://app.test/_kovo/storage/a?kovo-cap&State&state',
    );
    expect(reportedError).toBeInstanceOf(Error);
    expect((reportedError as Error).message).toContain('/_kovo/storage/a?kovo-cap&State&state');
    expect((reportedError as Error).name).toContain('/_kovo/storage/a?kovo-cap&State&state');
    expect((reportedError as Error & { requestUrl?: string }).requestUrl).toBe(
      '/_kovo/storage/a?kovo-cap&State&state',
    );
    expect(JSON.stringify(onError.mock.calls)).not.toContain(token);
    expect(String((reportedError as Error).stack)).not.toContain(token);
  });

  it('applies the same URL sanitization before default stderr', () => {
    const token = 'RESET_BEARER_SHOULD_NEVER_LOG';
    const url = `/reset?Token=${token}&token=duplicate`;
    const error = new Error(`reset provider failed at ${url}`);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      reportServerError(undefined, error, { operation: 'app-request', url });
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(token);
      expect(errorSpy.mock.calls[0]?.[0]).toContain('url=/reset?Token&token');
      expect(String(errorSpy.mock.calls[0]?.[1])).toContain('/reset?Token&token');
    } finally {
      errorSpy.mockRestore();
    }
  });
});
