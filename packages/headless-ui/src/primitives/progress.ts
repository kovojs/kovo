import { type PrimitiveDataAttributes } from '../lib/index.js';

export type ProgressDataState = 'complete' | 'indeterminate' | 'loading';

export interface ProgressAttributeOptions {
  max?: number;
  value?: number | null;
  valueText?: string;
}

export interface ProgressComputedState {
  max: number;
  state: ProgressDataState;
  value: number | null;
  valueRatio: number | null;
}

export type ProgressPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, number | string>>;

export function progressValueState(options: ProgressAttributeOptions = {}): ProgressComputedState {
  const max = normalizeProgressMax(options.max);
  const value = normalizeProgressValue(options.value, max);

  if (value === null) {
    return Object.freeze({
      max,
      state: 'indeterminate',
      value,
      valueRatio: null,
    });
  }

  return Object.freeze({
    max,
    state: value >= max ? 'complete' : 'loading',
    value,
    valueRatio: value / max,
  });
}

export function progressRootAttributes(
  options: ProgressAttributeOptions = {},
): ProgressPrimitiveAttributes {
  const state = progressValueState(options);
  const valueAttributes =
    state.value === null
      ? {}
      : {
          'data-value': String(state.value),
          value: state.value,
        };

  return Object.freeze({
    'data-max': String(state.max),
    'data-state': state.state,
    max: state.max,
    ...valueAttributes,
    ...(options.valueText === undefined ? {} : { 'aria-valuetext': options.valueText }),
  });
}

function normalizeProgressMax(max: number | undefined): number {
  return max !== undefined && Number.isFinite(max) && max > 0 ? max : 1;
}

function normalizeProgressValue(value: number | null | undefined, max: number): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.min(Math.max(value, 0), max);
}
