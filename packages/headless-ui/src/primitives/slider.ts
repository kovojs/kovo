import {
  dataDisabled,
  dataOrientation,
  dispatchCancelableChange,
  mergeDataAttributes,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
} from '../lib/index.js';

export type SliderOrientation = 'horizontal' | 'vertical';

export interface SliderState {
  disabled?: boolean;
  invalid?: boolean;
  max?: number;
  min?: number;
  name?: string;
  orientation?: SliderOrientation;
  required?: boolean;
  step?: number;
  value?: number;
}

export interface SliderRootAttributeOptions extends SliderState {
  id?: string;
}

export interface SliderInputAttributeOptions extends SliderState {
  descriptionId?: string;
  errorId?: string;
  form?: string;
  id?: string;
  label?: string;
  labelledBy?: string;
  valueText?: string;
}

export interface SliderPartAttributeOptions extends SliderState {
  id?: string;
}

export type SliderChangeReason = 'input' | 'programmatic';

export type SliderChangeDetail = PrimitiveChangeDetail<SliderChangeReason, number>;

export interface SliderChangeOptions {
  onValueChange?: (detail: SliderChangeDetail) => void;
}

export interface SliderChangeResult {
  changed: boolean;
  detail?: SliderChangeDetail;
  value: number;
}

export interface SliderComputedState {
  max: number;
  min: number;
  orientation: SliderOrientation;
  step: number;
  value: number;
  valueRatio: number;
}

export type SliderPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

export type SliderInputEvent = Event & {
  readonly currentTarget: { value: string } | null;
};

export function sliderValueState(options: SliderState = {}): SliderComputedState {
  const min = normalizeSliderMin(options.min);
  const max = normalizeSliderMax(options.max, min);
  const step = normalizeSliderStep(options.step);
  const value = normalizeSliderValue(options.value, min, max, options.step);

  return Object.freeze({
    max,
    min,
    orientation: sliderOrientation(options.orientation),
    step,
    value,
    valueRatio: (value - min) / (max - min),
  });
}

export function sliderRootAttributes(
  options: SliderRootAttributeOptions = {},
): SliderPrimitiveAttributes {
  return Object.freeze({
    ...sliderDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

export function sliderInputAttributes(
  options: SliderInputAttributeOptions = {},
): SliderPrimitiveAttributes {
  const state = sliderValueState(options);
  const describedBy = sliderDescribedBy(options);

  // SPEC.md §6.3: form() typing validates real named controls; slider keeps
  // the native range input as the submitted control.
  return Object.freeze({
    ...sliderDataAttributes(options),
    ...(describedBy === '' ? {} : { 'aria-describedby': describedBy }),
    ...(options.invalid === true ? { 'aria-invalid': 'true' } : {}),
    ...(state.orientation === 'vertical' ? { 'aria-orientation': 'vertical' } : {}),
    ...(options.label === undefined ? {} : { 'aria-label': options.label }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
    ...(options.valueText === undefined ? {} : { 'aria-valuetext': options.valueText }),
    disabled: options.disabled === true,
    ...(options.form === undefined ? {} : { form: options.form }),
    ...(options.id === undefined ? {} : { id: options.id }),
    max: state.max,
    min: state.min,
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(options.required === true ? { required: true } : {}),
    step: state.step,
    type: 'range',
    value: state.value,
  });
}

export function sliderTrackAttributes(
  options: SliderPartAttributeOptions = {},
): SliderPrimitiveAttributes {
  return sliderPartAttributes(options, 'track');
}

export function sliderRangeAttributes(
  options: SliderPartAttributeOptions = {},
): SliderPrimitiveAttributes {
  return sliderPartAttributes(options, 'range');
}

export function sliderThumbAttributes(
  options: SliderPartAttributeOptions = {},
): SliderPrimitiveAttributes {
  return sliderPartAttributes(options, 'thumb');
}

export function sliderValueFromString(value: string, state: SliderState = {}): number {
  const parsed = Number(value.trim());
  const computed = sliderValueState(state);
  return normalizeSliderValue(parsed, computed.min, computed.max, state.step);
}

export function setSliderValue(
  state: SliderState,
  value: number,
  reason: SliderChangeReason,
  options: SliderChangeOptions = {},
): SliderChangeResult {
  const current = sliderValueState(state);
  const nextValue = normalizeSliderValue(value, current.min, current.max, state.step);

  if (state.disabled || current.value === nextValue) {
    return { changed: false, value: current.value };
  }

  const detail = dispatchCancelableChange({ reason, value: nextValue }, options.onValueChange);
  if (detail.defaultPrevented) {
    return { changed: false, detail, value: current.value };
  }

  return { changed: true, detail, value: nextValue };
}

/**
 * @jisoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function sliderInput(
  event: SliderInputEvent,
  state: SliderState,
  options: SliderChangeOptions = {},
): SliderChangeResult | undefined {
  if (event.defaultPrevented) return;

  if (event.currentTarget === null) return;

  const result = setSliderValue(
    state,
    sliderValueFromString(event.currentTarget.value, state),
    'input',
    options,
  );
  if (!result.changed) {
    event.currentTarget.value = String(result.value);
    event.preventDefault();
  }

  return result;
}

function sliderPartAttributes(
  options: SliderPartAttributeOptions,
  part: 'range' | 'thumb' | 'track',
): SliderPrimitiveAttributes {
  const state = sliderValueState(options);

  return Object.freeze({
    ...sliderDataAttributes(options),
    'aria-hidden': 'true',
    'data-part': part,
    'data-value-ratio': String(state.valueRatio),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

function sliderDataAttributes(state: SliderState): PrimitiveDataAttributes {
  const computed = sliderValueState(state);

  return mergeDataAttributes(
    dataDisabled(state.disabled === true),
    dataOrientation(computed.orientation),
    state.invalid === true ? { 'data-invalid': '' } : undefined,
    state.required === true ? { 'data-required': '' } : undefined,
    {
      'data-max': String(computed.max),
      'data-min': String(computed.min),
      'data-value': String(computed.value),
    },
  );
}

function normalizeSliderMin(min: number | undefined): number {
  return sliderFinite(min) ? min : 0;
}

function normalizeSliderMax(max: number | undefined, min: number): number {
  const normalizedMax = sliderFinite(max) ? max : 100;
  return normalizedMax > min ? normalizedMax : min + 1;
}

function normalizeSliderStep(step: number | undefined): number {
  return sliderFinite(step) && step > 0 ? step : 1;
}

function normalizeSliderValue(
  value: number | undefined,
  min: number,
  max: number,
  step?: number,
): number {
  if (!sliderFinite(value)) return min;
  const bounded = Math.min(Math.max(value, min), max);
  if (!sliderFinite(step) || step <= 0) return bounded;

  const stepped = min + Math.round((bounded - min) / step) * step;
  return Math.min(Math.max(roundSliderValue(stepped, step), min), max);
}

function sliderOrientation(orientation: SliderOrientation | undefined): SliderOrientation {
  return orientation === 'vertical' ? 'vertical' : 'horizontal';
}

function sliderFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function roundSliderValue(value: number, step: number): number {
  const stepText = String(step);
  const decimalIndex = stepText.indexOf('.');
  const precision = decimalIndex === -1 ? 0 : stepText.length - decimalIndex - 1;
  return Number(value.toFixed(Math.min(precision, 12)));
}

function sliderDescribedBy(options: {
  descriptionId?: string;
  errorId?: string;
  invalid?: boolean;
}): string {
  return [options.descriptionId, options.invalid === true ? options.errorId : undefined]
    .filter((id): id is string => id !== undefined && id.length > 0)
    .join(' ');
}
