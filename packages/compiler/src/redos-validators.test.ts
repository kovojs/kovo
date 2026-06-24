import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';

describe('ReDoS-safe string validators', () => {
  it('accepts compile-visible safe pattern literals', () => {
    const result = compile(`
import { component } from '@kovojs/core';
import { s } from '@kovojs/server';

const input = s.object({ sku: s.string().pattern('[A-Z]{3}-\\\\d{4}') });

export const ProductSearch = component({
  render: () => <form><input name="sku" /></form>,
});
`);

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV434')).toEqual([]);
  });

  it('reports KV434 for dynamic pattern arguments', () => {
    const result = compile(`
import { component } from '@kovojs/core';
import { s } from '@kovojs/server';

const dynamicPattern = process.env.SKU_PATTERN ?? '[A-Z]+';
const input = s.object({ sku: s.string().pattern(dynamicPattern) });

export const ProductSearch = component({
  render: () => <form><input name="sku" /></form>,
});
`);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV434',
          message: expect.stringContaining('pattern argument is not a literal'),
        }),
      ]),
    );
  });

  it('reports KV434 for nested quantified pattern literals', () => {
    const result = compile(`
import { component } from '@kovojs/core';
import { s } from '@kovojs/server';

const input = s.object({ token: s.string().pattern('(a+)+') });

export const ProductSearch = component({
  render: () => <form><input name="token" /></form>,
});
`);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV434',
          message: expect.stringContaining('nested quantified groups'),
        }),
      ]),
    );
  });

  it('allows unsafeRegex as an audited escape and emits a capability fact', () => {
    const result = compile(`
import { component } from '@kovojs/core';
import { s, unsafeRegex } from '@kovojs/server';

const input = s.object({
  token: s.string().pattern(unsafeRegex(/^(a+)+$/u, 'legacy bounded token import')),
});

export const ProductSearch = component({
  render: () => <form><input name="token" /></form>,
});
`);

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV434')).toEqual([]);
    expect(result.capabilities).toEqual([
      expect.objectContaining({
        kind: 'unsafeRegex',
        reason: 'legacy bounded token import',
        source: '/^(a+)+$/u',
      }),
    ]);
  });
});

function compile(source: string): ReturnType<typeof compileComponentModule> {
  return compileComponentModule({
    fileName: 'components/product-search.tsx',
    source,
  });
}
