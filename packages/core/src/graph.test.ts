import { describe, expect, it } from 'vitest';

import { validateKovoExplainInput } from './graph.js';

describe('kovo graph input validation', () => {
  it('reports unknown diagnostic codes at the element path', () => {
    expect(
      validateKovoExplainInput({
        lints: [{ code: 'KV999', site: 'cart.tsx:1' }],
      }),
    ).toEqual([
      {
        message: 'unknown diagnostic code "KV999"',
        path: 'lints[0].code',
      },
    ]);
  });

  it('validates unresolved touch graph diagnostic codes before rendering', () => {
    expect(
      validateKovoExplainInput({
        touchGraph: {
          'cart.add': {
            touches: [],
            unresolved: [{ code: 'KV999', message: 'unknown', site: 'cart.ts:1' }],
          },
        },
      }),
    ).toEqual([
      {
        message: 'unknown diagnostic code "KV999"',
        path: 'touchGraph."cart.add".unresolved[0].code',
      },
    ]);
  });

  it('requires package component prefix facts to be an array', () => {
    expect(
      validateKovoExplainInput({
        packageComponentPrefixes: { packageName: '@kovojs/headless-ui', prefix: 'kovo-' },
      }),
    ).toEqual([
      {
        message: 'packageComponentPrefixes must be an array',
        path: 'packageComponentPrefixes',
      },
    ]);
  });
});
