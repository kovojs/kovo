import { describe, expect, it } from 'vitest';
import { secret } from '@kovojs/core';

import {
  formatLogMessage,
  neutralizeLogValue,
  scrubConsoleArgs,
  scrubSecretLifecycleValue,
} from './logging.js';

describe('log-channel neutralization', () => {
  it('renders control characters as visible escapes', () => {
    expect(neutralizeLogValue('line\r\nnext\t\x1b[31m\x7f')).toBe(
      'line\\u000d\\u000anext\\u0009\\u001b[31m\\u007f',
    );
  });

  it('neutralizes interpolated values in formatted log messages', () => {
    expect(formatLogMessage`request failed: ${'/search?q=a\r\nforged=true'}`).toBe(
      'request failed: /search?q=a\\u000d\\u000aforged=true',
    );
  });

  it('scrubs secret-tagged values before logger formatting', () => {
    const token = secret('sk_live_q5_logger');

    expect(neutralizeLogValue({ token })).toBe('[object Object]');
    expect(formatLogMessage`token=${token}`).toBe('token=[secret]');
    expect(JSON.stringify(scrubSecretLifecycleValue({ nested: [token] }))).toBe(
      '{"nested":["[secret]"]}',
    );
  });

  it('scrubs structured console arguments without mutating non-secret inputs', () => {
    const plain = { ok: true };
    const token = secret('sk_live_q5_console');
    const args = scrubConsoleArgs(['message', { plain, token }]);

    expect(args).toEqual(['message', { plain, token: '[secret]' }]);
    expect(JSON.stringify(args)).not.toContain('sk_live_q5_console');
    expect(scrubSecretLifecycleValue(plain)).toBe(plain);
  });
});
