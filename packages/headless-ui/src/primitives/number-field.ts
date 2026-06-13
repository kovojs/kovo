import {
  dataDisabled,
  dispatchCancelableChange,
  mergeDataAttributes,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
} from '../lib/index.js';

export type NumberFieldValue = number | undefined;

export interface NumberFieldState {
  disabled?: boolean;
  invalid?: boolean;
  max?: number;
  min?: number;
  name?: string;
  required?: boolean;
  step?: number;
  value?: NumberFieldValue;
}

export interface NumberFieldRootAttributeOptions extends NumberFieldState {
  id?: string;
}

export interface NumberFieldInputAttributeOptions extends NumberFieldState {
  descriptionId?: string;
  errorId?: string;
  form?: string;
  id?: string;
  label?: string;
  labelledBy?: string;
}

export interface NumberFieldButtonAttributeOptions extends NumberFieldState {
  id?: string;
  inputId?: string;
  label?: string;
}

export type NumberFieldChangeReason = 'decrement' | 'increment' | 'input' | 'programmatic';

export type NumberFieldChangeDetail = PrimitiveChangeDetail<
  NumberFieldChangeReason,
  NumberFieldValue
>;

export interface NumberFieldChangeOptions {
  onValueChange?: (detail: NumberFieldChangeDetail) => void;
}

export interface NumberFieldChangeResult {
  changed: boolean;
  detail?: NumberFieldChangeDetail;
  value: NumberFieldValue;
}

export type NumberFieldPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

export type NumberFieldButtonEvent = Event;
export type NumberFieldInputEvent = Event & {
  readonly currentTarget: { value: string } | null;
};

export function numberFieldRootAttributes(
  options: NumberFieldRootAttributeOptions = {},
): NumberFieldPrimitiveAttributes {
  return Object.freeze({
    ...numberFieldDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

export function numberFieldInputAttributes(
  options: NumberFieldInputAttributeOptions = {},
): NumberFieldPrimitiveAttributes {
  const describedBy = numberFieldDescribedBy(options);

  // SPEC.md §6.3: form() typing validates real named controls; number-field
  // preserves a native number input instead of synthesizing hidden fields.
  return Object.freeze({
    ...numberFieldDataAttributes(options),
    ...(describedBy === '' ? {} : { 'aria-describedby': describedBy }),
    ...(options.invalid === true ? { 'aria-invalid': 'true' } : {}),
    ...(options.label === undefined ? {} : { 'aria-label': options.label }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
    disabled: options.disabled === true,
    ...(options.form === undefined ? {} : { form: options.form }),
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(numberFieldFinite(options.max) ? { max: options.max } : {}),
    ...(numberFieldFinite(options.min) ? { min: options.min } : {}),
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(options.required === true ? { required: true } : {}),
    ...(numberFieldFinite(options.step) && options.step > 0 ? { step: options.step } : {}),
    type: 'number',
    ...(options.value === undefined ? {} : { value: options.value }),
  });
}

export function numberFieldIncrementAttributes(
  options: NumberFieldButtonAttributeOptions = {},
): NumberFieldPrimitiveAttributes {
  return numberFieldStepButtonAttributes(options, 'increment');
}

export function numberFieldDecrementAttributes(
  options: NumberFieldButtonAttributeOptions = {},
): NumberFieldPrimitiveAttributes {
  return numberFieldStepButtonAttributes(options, 'decrement');
}

export function setNumberFieldValue(
  state: NumberFieldState,
  value: NumberFieldValue,
  reason: NumberFieldChangeReason,
  options: NumberFieldChangeOptions = {},
): NumberFieldChangeResult {
  const nextValue = normalizeNumberFieldValue(value);
  const currentValue = normalizeNumberFieldValue(state.value);

  if (state.disabled || currentValue === nextValue) {
    return { changed: false, value: currentValue };
  }

  const detail = dispatchCancelableChange({ reason, value: nextValue }, options.onValueChange);
  if (detail.defaultPrevented) {
    return { changed: false, detail, value: currentValue };
  }

  return { changed: true, detail, value: nextValue };
}

export function incrementNumberFieldValue(
  state: NumberFieldState,
  options: NumberFieldChangeOptions = {},
): NumberFieldChangeResult {
  return setNumberFieldValue(state, numberFieldStepValue(state, 'increment'), 'increment', options);
}

export function decrementNumberFieldValue(
  state: NumberFieldState,
  options: NumberFieldChangeOptions = {},
): NumberFieldChangeResult {
  return setNumberFieldValue(state, numberFieldStepValue(state, 'decrement'), 'decrement', options);
}

export function numberFieldValueFromString(value: string): NumberFieldValue {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;

  const nextValue = Number(trimmed);
  return numberFieldFinite(nextValue) ? nextValue : undefined;
}

/**
 * @jisoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function numberFieldInput(
  event: NumberFieldInputEvent,
  state: NumberFieldState,
  options: NumberFieldChangeOptions = {},
): NumberFieldChangeResult | undefined {
  if (event.defaultPrevented) return;

  if (event.currentTarget === null) return;

  const result = setNumberFieldValue(
    state,
    numberFieldValueFromString(event.currentTarget.value),
    'input',
    options,
  );
  if (!result.changed) {
    event.currentTarget.value = numberFieldInputValue(result.value);
    event.preventDefault();
  }

  return result;
}

/**
 * @jisoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function numberFieldIncrementClick(
  event: NumberFieldButtonEvent,
  state: NumberFieldState,
  options: NumberFieldChangeOptions = {},
): NumberFieldChangeResult | undefined {
  if (event.defaultPrevented) return;

  const result = incrementNumberFieldValue(state, options);
  if (!result.changed) {
    event.preventDefault();
  }

  return result;
}

/**
 * @jisoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function numberFieldDecrementClick(
  event: NumberFieldButtonEvent,
  state: NumberFieldState,
  options: NumberFieldChangeOptions = {},
): NumberFieldChangeResult | undefined {
  if (event.defaultPrevented) return;

  const result = decrementNumberFieldValue(state, options);
  if (!result.changed) {
    event.preventDefault();
  }

  return result;
}

function numberFieldStepButtonAttributes(
  options: NumberFieldButtonAttributeOptions,
  direction: 'decrement' | 'increment',
): NumberFieldPrimitiveAttributes {
  const disabled =
    direction === 'increment'
      ? !numberFieldCanIncrement(options)
      : !numberFieldCanDecrement(options);

  return Object.freeze({
    ...mergeDataAttributes(numberFieldDataAttributes(options), dataDisabled(disabled), {
      'data-action': direction,
    }),
    'aria-label':
      options.label ?? (direction === 'increment' ? 'Increase value' : 'Decrease value'),
    disabled,
    type: 'button',
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.inputId === undefined ? {} : { 'aria-controls': options.inputId }),
  });
}

function numberFieldDataAttributes(state: NumberFieldState): PrimitiveDataAttributes {
  return mergeDataAttributes(
    dataDisabled(state.disabled === true),
    state.invalid === true ? { 'data-invalid': '' } : undefined,
    state.required === true ? { 'data-required': '' } : undefined,
  );
}

function numberFieldStepValue(
  state: NumberFieldState,
  direction: 'decrement' | 'increment',
): NumberFieldValue {
  const step = numberFieldStep(state.step);
  const currentValue = normalizeNumberFieldValue(state.value);
  const nextValue =
    currentValue === undefined
      ? numberFieldEmptyStepValue(state, direction)
      : numberFieldAlignedStepValue(state, currentValue, step, direction);

  return clampNumberFieldValue(nextValue, state);
}

function numberFieldEmptyStepValue(
  state: NumberFieldState,
  direction: 'decrement' | 'increment',
): number {
  if (direction === 'decrement' && numberFieldFinite(state.max)) return state.max;
  if (numberFieldFinite(state.min)) return state.min;
  return 0;
}

function numberFieldCanIncrement(state: NumberFieldState): boolean {
  if (state.disabled === true) return false;

  const value = normalizeNumberFieldValue(state.value);
  return value === undefined || !numberFieldFinite(state.max) || value < state.max;
}

function numberFieldCanDecrement(state: NumberFieldState): boolean {
  if (state.disabled === true) return false;

  const value = normalizeNumberFieldValue(state.value);
  return value === undefined || !numberFieldFinite(state.min) || value > state.min;
}

function numberFieldAlignedStepValue(
  state: NumberFieldState,
  value: number,
  step: number,
  direction: 'decrement' | 'increment',
): number {
  if (!numberFieldFinite(state.min)) {
    return value + (direction === 'increment' ? step : -step);
  }

  const base = state.min;
  const offset = (value - base) / step;

  if (Number.isInteger(offset)) {
    return value + (direction === 'increment' ? step : -step);
  }

  const alignedOffset = direction === 'increment' ? Math.ceil(offset) : Math.floor(offset);
  return base + alignedOffset * step;
}

function clampNumberFieldValue(value: number, state: NumberFieldState): number {
  if (numberFieldFinite(state.min) && value < state.min) return state.min;
  if (numberFieldFinite(state.max) && value > state.max) return state.max;
  return value;
}

function normalizeNumberFieldValue(value: NumberFieldValue): NumberFieldValue {
  return numberFieldFinite(value) ? value : undefined;
}

function numberFieldInputValue(value: NumberFieldValue): string {
  return value === undefined ? '' : String(value);
}

function numberFieldStep(step: number | undefined): number {
  return numberFieldFinite(step) && step > 0 ? step : 1;
}

function numberFieldFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function numberFieldDescribedBy(options: {
  descriptionId?: string;
  errorId?: string;
  invalid?: boolean;
}): string {
  return [options.descriptionId, options.invalid === true ? options.errorId : undefined]
    .filter((id): id is string => id !== undefined && id.length > 0)
    .join(' ');
}
