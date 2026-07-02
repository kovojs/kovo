import { describe, expect, it } from 'vitest';

import { enforceOrThrow, PROVEN_SAFE, provenUnsafe, unproven } from './classifier-verdict.js';

describe('classifier verdicts', () => {
  it('allows only proven-safe verdicts through the enforcer', () => {
    expect(() => enforceOrThrow(PROVEN_SAFE, () => new Error('closed'))).not.toThrow();
    expect(() =>
      enforceOrThrow(provenUnsafe(['contacts']), () => new Error('closed unsafe')),
    ).toThrow('closed unsafe');
    expect(() =>
      enforceOrThrow(unproven('parse ambiguity'), () => new Error('closed unproven')),
    ).toThrow('closed unproven');
  });
});
