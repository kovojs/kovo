import { BaseError } from 'ts-morph';
import { describe, expect, it } from 'vitest';

import './static-security-authority.js';

describe('Drizzle static security authority', () => {
  it('locks third-party error prototypes without freezing the shared host Error prototype', () => {
    // SPEC §6.6 rule 6: ts-morph remains immutable after bootstrap, while unrelated host error
    // constructors must retain the ordinary ability to install an own `name` property.
    expect(Object.isFrozen(BaseError.prototype)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(Error.prototype, 'name')).toMatchObject({
      configurable: true,
      writable: true,
    });

    class DownstreamError extends Error {
      constructor() {
        super('downstream error');
        this.name = 'DownstreamError';
      }
    }

    expect(new DownstreamError().name).toBe('DownstreamError');
  });
});
