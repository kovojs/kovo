import { describe, expect, it } from 'vitest';

import {
  cn as internalCn,
  defineVariants as internalDefineVariants,
  kovoUiTokenSheet as internalTokenSheet,
  kovoUiTokenSheetCss as internalTokenSheetCss,
} from '../internal.js';
import {
  cn as libCn,
  defineVariants as libDefineVariants,
  kovoUiTokenSheet as libTokenSheet,
  kovoUiTokenSheetCss as libTokenSheetCss,
} from './index.js';

describe('foundation helper exports', () => {
  it('exports class helpers from the internal and lib subpath barrels', () => {
    expect(internalCn('inline-flex', { hidden: false })).toBe('inline-flex');
    expect(libCn('inline-flex', { hidden: false })).toBe('inline-flex');

    expect(internalDefineVariants).toBe(libDefineVariants);
  });

  it('exports token sheet helpers from the internal and lib subpath barrels', () => {
    expect(internalTokenSheet).toBe(libTokenSheet);
    expect(internalTokenSheetCss).toBe(libTokenSheetCss);
    expect(internalTokenSheetCss).toContain('--kovo-color-background');
  });
});
