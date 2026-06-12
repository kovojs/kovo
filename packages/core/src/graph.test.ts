import { describe, expect, it } from 'vitest';

import { validateFwExplainInput } from './graph.js';

describe('fw graph input validation', () => {
  it('reports unknown diagnostic codes at the element path', () => {
    expect(
      validateFwExplainInput({
        lints: [{ code: 'FW999', site: 'cart.tsx:1' }],
      }),
    ).toEqual([
      {
        message: 'unknown diagnostic code "FW999"',
        path: 'lints[0].code',
      },
    ]);
  });

  it('validates unresolved touch graph diagnostic codes before rendering', () => {
    expect(
      validateFwExplainInput({
        touchGraph: {
          'cart.add': {
            touches: [],
            unresolved: [{ code: 'FW999', message: 'unknown', site: 'cart.ts:1' }],
          },
        },
      }),
    ).toEqual([
      {
        message: 'unknown diagnostic code "FW999"',
        path: 'touchGraph."cart.add".unresolved[0].code',
      },
    ]);
  });

  it('requires package component prefix facts to be an array', () => {
    expect(
      validateFwExplainInput({
        packageComponentPrefixes: { packageName: '@jiso/headless-ui', prefix: 'jiso-' },
      }),
    ).toEqual([
      {
        message: 'packageComponentPrefixes must be an array',
        path: 'packageComponentPrefixes',
      },
    ]);
  });
});
