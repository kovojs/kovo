import { describe, expect, it, vi } from 'vitest';

import {
  reportMalformedJson,
  reportRuntimeContextError,
  reportRuntimeError,
  reportRuntimeTargetError,
} from './error-policy.js';

describe('runtime error policy', () => {
  it('routes malformed wire JSON through one reporter seam', () => {
    const onError = vi.fn();
    const cause = new SyntaxError('expected value');

    // SPEC.md §10.3: mutation responses render query/fragment wire chunks for runtime apply.
    reportMalformedJson(onError, 'kovo-query cart', cause);

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(String(onError.mock.calls[0]?.[0].message)).toContain(
      'Malformed JSON in kovo-query cart',
    );
    expect(onError.mock.calls[0]?.[0]).toHaveProperty('cause', cause);
  });

  it('keeps reporter delivery optional for tolerant parse paths', () => {
    expect(() => reportRuntimeError(undefined, new Error('ignored'))).not.toThrow();
  });

  it('routes loader and event failures through one contextual error hook', () => {
    const onError = vi.fn();
    const error = new Error('handler failed');
    const event = { target: null, type: 'click' };

    // SPEC.md §4.4: the loader owns delegated handler and hydration diagnostics.
    reportRuntimeContextError(onError, error, { event, phase: 'delegated-event' });

    expect(onError).toHaveBeenCalledWith(error, { event, phase: 'delegated-event' });
  });

  it('routes form-layer failures through one target-aware hook', () => {
    const onError = vi.fn();
    const error = new Error('submit failed');
    const form = { action: '/_m/cart/add' };

    // SPEC.md §9.2: enhanced form failures are handled by the form layer when a
    // form-scoped reporter is present, not by the loader context fallback.
    reportRuntimeTargetError(onError, error, form);

    expect(onError).toHaveBeenCalledWith(error, form);
  });
});
