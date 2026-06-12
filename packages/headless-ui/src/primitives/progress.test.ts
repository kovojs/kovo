import { describe, expect, it } from 'vitest';

import {
  progressRootAttributes as exportedProgressRootAttributes,
  progressValueState as exportedProgressValueState,
} from '../index.js';
import { progressRootAttributes, progressValueState } from './progress.js';

describe('headless-ui progress primitive', () => {
  it('builds native progress attributes for determinate progress', () => {
    expect(progressRootAttributes({ max: 10, value: 4 })).toEqual({
      'data-max': '10',
      'data-state': 'loading',
      'data-value': '4',
      max: 10,
      value: 4,
    });
  });

  it('omits value for indeterminate native progress', () => {
    expect(progressRootAttributes()).toEqual({
      'data-max': '1',
      'data-state': 'indeterminate',
      max: 1,
    });
  });

  it('normalizes invalid ranges and clamps determinate values', () => {
    expect(progressValueState({ max: 0, value: 2 })).toEqual({
      max: 1,
      state: 'complete',
      value: 1,
      valueRatio: 1,
    });

    expect(progressValueState({ max: 8, value: -3 })).toEqual({
      max: 8,
      state: 'loading',
      value: 0,
      valueRatio: 0,
    });
  });

  it('treats null, undefined, and non-finite values as indeterminate', () => {
    expect(progressValueState({ max: 5, value: null })).toEqual({
      max: 5,
      state: 'indeterminate',
      value: null,
      valueRatio: null,
    });

    expect(progressValueState({ max: 5, value: Number.NaN })).toEqual({
      max: 5,
      state: 'indeterminate',
      value: null,
      valueRatio: null,
    });
  });

  it('marks completed progress and preserves optional value text', () => {
    expect(progressRootAttributes({ max: 10, value: 10, valueText: 'Uploaded' })).toEqual({
      'aria-valuetext': 'Uploaded',
      'data-max': '10',
      'data-state': 'complete',
      'data-value': '10',
      max: 10,
      value: 10,
    });
  });

  it('returns frozen records', () => {
    expect(Object.isFrozen(progressValueState({ value: 0.5 }))).toBe(true);
    expect(Object.isFrozen(progressRootAttributes({ value: 0.5 }))).toBe(true);
  });

  it('is exported through the package root', () => {
    expect(exportedProgressRootAttributes).toBe(progressRootAttributes);
    expect(exportedProgressValueState).toBe(progressValueState);
  });
});
