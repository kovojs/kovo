import { describe, expect, it } from 'vitest';

import {
  assertKovoModuleRef,
  formatKovoModuleRef,
  kovoModuleRef,
  parseKovoModuleRef,
  parseKovoModuleRefList,
} from './module-ref.js';

describe('module-ref core contract', () => {
  it('parses handler and derive refs into structured facts', () => {
    expect(parseKovoModuleRef('/c/cart.client.js#Cart$click', 'handler')).toEqual({
      exportName: 'Cart$click',
      kind: 'handler',
      url: '/c/cart.client.js',
    });
    expect(parseKovoModuleRef('/c/__v/v1/cart.client.js?hash=1#Cart$isEmpty', 'derive')).toEqual({
      exportName: 'Cart$isEmpty',
      kind: 'derive',
      url: '/c/__v/v1/cart.client.js?hash=1',
    });
  });

  it('formats refs only from structured facts', () => {
    expect(formatKovoModuleRef(kovoModuleRef('/c/cart.client.js', 'Cart$click', 'handler'))).toBe(
      '/c/cart.client.js#Cart$click',
    );
  });

  it('parses whitespace-separated handler attributes', () => {
    expect(
      parseKovoModuleRefList('/c/a.client.js#A$click /c/b.client.js#B$click', 'handler'),
    ).toEqual([
      { exportName: 'A$click', kind: 'handler', url: '/c/a.client.js' },
      { exportName: 'B$click', kind: 'handler', url: '/c/b.client.js' },
    ]);
  });

  it('rejects malformed refs fail-closed', () => {
    expect(parseKovoModuleRef('/c/cart.client.js', 'handler')).toBeUndefined();
    expect(parseKovoModuleRef('#Cart$click', 'handler')).toBeUndefined();
    expect(parseKovoModuleRef('/c/cart.client.js#', 'handler')).toBeUndefined();
    expect(() => assertKovoModuleRef('/c/cart.client.js', 'handler')).toThrow(
      'Invalid handler reference: /c/cart.client.js',
    );
  });

  it('rejects formatting ambiguous URLs with hash fragments', () => {
    expect(() =>
      formatKovoModuleRef(kovoModuleRef('/c/cart.client.js#old', 'Cart$click', 'handler')),
    ).toThrow('Kovo module ref URL must be non-empty and contain no hash: /c/cart.client.js#old');
  });
});
