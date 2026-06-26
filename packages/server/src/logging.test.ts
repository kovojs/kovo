import { describe, expect, it } from 'vitest';

import { formatLogMessage, neutralizeLogValue } from './logging.js';

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
});
