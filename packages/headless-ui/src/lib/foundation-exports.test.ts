import { describe, expect, it } from 'vitest';

import {
  cn as rootCn,
  defineVariants as rootDefineVariants,
  jisoUiTokenSheet as rootTokenSheet,
  jisoUiTokenSheetCss as rootTokenSheetCss,
} from '../index.js';
import {
  cn as libCn,
  defineVariants as libDefineVariants,
  jisoUiTokenSheet as libTokenSheet,
  jisoUiTokenSheetCss as libTokenSheetCss,
} from './index.js';

describe('foundation helper exports', () => {
  it('exports class helpers from the package root and lib subpath barrels', () => {
    expect(rootCn('inline-flex', { hidden: false })).toBe('inline-flex');
    expect(libCn('inline-flex', { hidden: false })).toBe('inline-flex');

    expect(rootDefineVariants).toBe(libDefineVariants);
  });

  it('exports token sheet helpers from the package root and lib subpath barrels', () => {
    expect(rootTokenSheet).toBe(libTokenSheet);
    expect(rootTokenSheetCss).toBe(libTokenSheetCss);
    expect(rootTokenSheetCss).toContain('--jiso-color-background');
  });
});
