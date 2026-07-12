import { describe, expect, it } from 'vitest';

import { canonicalJson } from './canonical-json.js';

describe('canonicalJson', () => {
  it('encodes undefined array slots as null without aliasing an empty array', () => {
    expect(canonicalJson([])).toBe('[]');
    expect(canonicalJson([undefined])).toBe('[null]');
    expect(canonicalJson(['left', undefined, 'right'])).toBe('["left",null,"right"]');
  });
});
