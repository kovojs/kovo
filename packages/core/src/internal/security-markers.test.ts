import { describe, expect, it } from 'vitest';

import { securityClassifier, securityDecisionMetadata, wireEmitter } from './security-markers.js';

describe('security decision markers', () => {
  it('preserves classifier call behavior while attaching non-enumerable metadata', () => {
    const classify = securityClassifier('test.classify', (value: string) => value.toUpperCase());

    expect(classify('ok')).toBe('OK');
    expect(Object.keys(classify)).toEqual([]);
    expect(securityDecisionMetadata(classify)).toEqual({
      kind: 'classifier',
      name: 'test.classify',
    });
  });

  it('preserves wire emitter call behavior while attaching non-enumerable metadata', () => {
    const emit = wireEmitter('test.emit', (value: number) => ({ body: String(value) }));

    expect(emit(7)).toEqual({ body: '7' });
    expect(Object.keys(emit)).toEqual([]);
    expect(securityDecisionMetadata(emit)).toEqual({
      kind: 'wire-emitter',
      name: 'test.emit',
    });
  });
});
