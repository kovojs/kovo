import { describe, expect, it } from 'vitest';

import { cn } from './class-names.js';

describe('cn', () => {
  it('joins string, array, and dictionary inputs with stable token order', () => {
    expect(
      cn('inline-flex items-center', ['gap-2', false, null, ['text-sm']], {
        'opacity-50': true,
        'pointer-events-none': false,
      }),
    ).toBe('inline-flex items-center gap-2 text-sm opacity-50');
  });

  it('dedupes repeated class tokens without reordering first appearances', () => {
    expect(cn('px-3 py-2', 'px-3', { 'py-2 font-medium': true })).toBe('px-3 py-2 font-medium');
  });

  it('omits empty and disabled inputs', () => {
    expect(cn('', undefined, null, false, [], { hidden: undefined })).toBe('');
  });
});
