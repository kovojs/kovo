import { describe, expect, it } from 'vitest';

import {
  meterRootAttributes as exportedMeterRootAttributes,
  meterValueState as exportedMeterValueState,
} from './meter.js';
import { meterRootAttributes, meterValueState } from './meter.js';

describe('headless-ui meter primitive', () => {
  it('builds native meter attributes with computed threshold data', () => {
    expect(meterRootAttributes({ high: 80, low: 20, max: 100, optimum: 90, value: 85 })).toEqual({
      'data-high': '80',
      'data-low': '20',
      'data-max': '100',
      'data-min': '0',
      'data-optimum': '90',
      'data-state': 'optimum',
      'data-value': '85',
      high: 80,
      low: 20,
      max: 100,
      min: 0,
      optimum: 90,
      value: 85,
    });
  });

  it('defaults to the native meter range and minimum value', () => {
    expect(meterValueState()).toEqual({
      high: 1,
      low: 0,
      max: 1,
      min: 0,
      optimum: 0.5,
      state: 'optimum',
      value: 0,
      valueRatio: 0,
    });
  });

  it('clamps values and repairs invalid ranges', () => {
    expect(meterValueState({ max: 0, min: 3, value: 7 })).toEqual({
      high: 4,
      low: 3,
      max: 4,
      min: 3,
      optimum: 3.5,
      state: 'optimum',
      value: 4,
      valueRatio: 1,
    });

    expect(meterValueState({ max: 10, min: 0, value: -3 })).toMatchObject({
      value: 0,
      valueRatio: 0,
    });
  });

  it('normalizes low and high thresholds into an ordered range', () => {
    expect(meterValueState({ high: 2, low: 8, max: 10, value: 5 })).toMatchObject({
      high: 8,
      low: 8,
      state: 'optimum',
    });
  });

  it('distinguishes optimum, suboptimum, and even-less-good regions', () => {
    expect(meterValueState({ high: 80, low: 20, max: 100, optimum: 90, value: 95 }).state).toBe(
      'optimum',
    );
    expect(meterValueState({ high: 80, low: 20, max: 100, optimum: 90, value: 50 }).state).toBe(
      'suboptimum',
    );
    expect(meterValueState({ high: 80, low: 20, max: 100, optimum: 90, value: 10 }).state).toBe(
      'even-less-good',
    );
  });

  it('preserves optional value text', () => {
    expect(meterRootAttributes({ max: 5, value: 3, valueText: '3 of 5 stars' })).toMatchObject({
      'aria-valuetext': '3 of 5 stars',
      value: 3,
    });
  });

  it('returns frozen records', () => {
    expect(Object.isFrozen(meterValueState({ value: 0.5 }))).toBe(true);
    expect(Object.isFrozen(meterRootAttributes({ value: 0.5 }))).toBe(true);
  });

  it('is exported through the package root', () => {
    expect(exportedMeterRootAttributes).toBe(meterRootAttributes);
    expect(exportedMeterValueState).toBe(meterValueState);
  });
});
