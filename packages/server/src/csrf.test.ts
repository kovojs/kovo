import { describe, expect, it } from 'vitest';

import { csrfField, csrfToken, validateCsrfToken } from './csrf.js';

describe('csrf helpers', () => {
  const request = { sessionId: 'session-1' };
  const csrf = {
    field: 'csrf<input>',
    secret: 'secret',
    sessionId(input: typeof request): string | undefined {
      return input.sessionId;
    },
  };

  it('renders an escaped hidden field for the signed session token', () => {
    const token = csrfToken(request, csrf);

    expect(csrfField(request, csrf)).toBe(
      `<input type="hidden" name="csrf&lt;input&gt;" value="${token}">`,
    );
  });

  it('validates only the matching token for the configured field', () => {
    const token = csrfToken(request, csrf);

    expect(validateCsrfToken({ 'csrf<input>': token }, request, csrf)).toBe(true);
    expect(validateCsrfToken({ 'csrf<input>': `${token}x` }, request, csrf)).toBe(false);
    expect(validateCsrfToken({ 'csrf<input>': token }, { sessionId: '' }, csrf)).toBe(false);
  });
});
