import { describe, expect, it } from 'vitest';

import {
  markNormalizedSessionProvider,
  sessionProviderBoundary,
} from './session-provider-boundary.js';

describe('session provider boundary markers', () => {
  it('reads normalized provider markers across duplicate module instances', () => {
    const provider = async () => null;
    Object.defineProperty(provider, Symbol.for('kovo.normalizedSessionProvider'), {
      value: 'delegated',
    });

    expect(sessionProviderBoundary(provider)).toBe('delegated');
  });

  it('keeps framework-authored markers non-enumerable on provider functions', () => {
    const provider = markNormalizedSessionProvider(async () => null, 'owned');

    expect(sessionProviderBoundary(provider)).toBe('owned');
    expect(Object.keys(provider)).toEqual([]);
  });
});
