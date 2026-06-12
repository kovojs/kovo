import { describe, expect, it } from 'vitest';

import { cn as rootCn, defineVariants as rootDefineVariants } from '../index.js';
import { cn as libCn, defineVariants as libDefineVariants } from './index.js';

describe('foundation helper exports', () => {
  it('exports class helpers from the package root and lib subpath barrels', () => {
    expect(rootCn('inline-flex', { hidden: false })).toBe('inline-flex');
    expect(libCn('inline-flex', { hidden: false })).toBe('inline-flex');

    expect(rootDefineVariants).toBe(libDefineVariants);
  });
});
