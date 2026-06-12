import { describe, expect, it, vi } from 'vitest';

import { reportMalformedJson, reportRuntimeError } from './error-policy.js';

describe('runtime error policy', () => {
  it('routes malformed wire JSON through one reporter seam', () => {
    const onError = vi.fn();
    const cause = new SyntaxError('expected value');

    // SPEC.md §10.3: mutation responses render query/fragment wire chunks for runtime apply.
    reportMalformedJson(onError, 'fw-query cart', cause);

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(String(onError.mock.calls[0]?.[0].message)).toContain('Malformed JSON in fw-query cart');
    expect(onError.mock.calls[0]?.[0]).toHaveProperty('cause', cause);
  });

  it('keeps reporter delivery optional for tolerant parse paths', () => {
    expect(() => reportRuntimeError(undefined, new Error('ignored'))).not.toThrow();
  });
});
