import { type PrimitiveDataAttributes } from '../lib/index.js';

/**
 * State snapshot consumed by the Progress primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ProgressDataState } from '@kovojs/headless-ui/progress';
 *
 * const value: ProgressDataState = {} as ProgressDataState;
 * ```
 */
export type ProgressDataState = 'complete' | 'indeterminate' | 'loading';

/**
 * Options accepted by the Progress primitive progress attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ProgressAttributeOptions } from '@kovojs/headless-ui/progress';
 *
 * const value: ProgressAttributeOptions = {} as ProgressAttributeOptions;
 * ```
 */
export interface ProgressAttributeOptions {
  max?: number;
  value?: number | null;
  valueText?: string;
}

/**
 * State snapshot consumed by the Progress primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ProgressComputedState } from '@kovojs/headless-ui/progress';
 *
 * const value: ProgressComputedState = {} as ProgressComputedState;
 * ```
 */
export interface ProgressComputedState {
  max: number;
  state: ProgressDataState;
  value: number | null;
  valueRatio: number | null;
}

/**
 * Serializable attribute record returned by Progress primitive builders.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ProgressPrimitiveAttributes } from '@kovojs/headless-ui/progress';
 *
 * const value: ProgressPrimitiveAttributes = {} as ProgressPrimitiveAttributes;
 * ```
 */
export type ProgressPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, number | string>>;

/**
 * Computes progress value state for the Progress primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { progressValueState } from '@kovojs/headless-ui/progress';
 *
 * const input = {} as Parameters<typeof progressValueState>[0];
 * const result = progressValueState(input);
 * ```
 */
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

/**
 * Builds the progress root attributes record for the Progress primitive.
 *
 * Emits `aria-valuetext`, `data-max`, `data-state`, `data-value`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { progressRootAttributes } from '@kovojs/headless-ui/progress';
 *
 * const input = {} as Parameters<typeof progressRootAttributes>[0];
 * const result = progressRootAttributes(input);
 * ```
 */
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
