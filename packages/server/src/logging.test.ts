import { describe, expect, it } from 'vitest';
import { secret } from '@kovojs/core';

import {
  formatLogMessage,
  neutralizeLogValue,
  sanitizeDiagnosticText,
  sanitizeDiagnosticUrl,
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

  it('retains only pathname and ordered query-key names for diagnostic URLs', () => {
    const corpus = [
      [
        'https://app.test/_kovo/storage/a?kovo-cap=CAPABILITY&next=%2Faccount',
        '/_kovo/storage/a?kovo-cap&next',
      ],
      ['/oauth/callback?code=AUTH_CODE&state=STATE&state=SECOND', '/oauth/callback?code&state&state'],
      ['/reset?Token=RESET&token=lower&TOKEN=upper', '/reset?Token&token&TOKEN'],
      ['/encoded?%6b%6f%76%6f%2d%63%61%70=a%252Fb&x=%00', '/encoded?kovo-cap&x'],
      ['/plain/path#fragment-secret', '/plain/path'],
    ] as const;

    for (const [input, expected] of corpus) expect(sanitizeDiagnosticUrl(input)).toBe(expected);
  });

  it('removes request URLs from diagnostic error text without touching unrelated text', () => {
    const absolute = 'https://app.test/reset?token=RESET_SECRET&state=STATE_SECRET';
    const message = `backend failed for ${absolute} via /reset?token=RESET_SECRET&state=STATE_SECRET`;

    expect(sanitizeDiagnosticText(message, [absolute], sanitizeDiagnosticUrl)).toBe(
      'backend failed for /reset?token&state via /reset?token&state',
    );
  });
});
