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
  largeStep?: number;
  max?: number;
  min?: number;
  name?: string;
  required?: boolean;
  smallStep?: number;
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
  readonly target?: { value?: string } | null;
};
export type NumberFieldKeyboardEvent = Event & {
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly key: string;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
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
 * @kovoPrimitiveHandler
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

  const input = numberFieldInputEventTarget(event);
  if (input === undefined) return;

  const result = setNumberFieldValue(
    state,
    numberFieldValueFromString(input.value),
    'input',
    options,
  );
  if (!result.changed) {
    input.value = numberFieldInputValue(result.value);
    event.preventDefault();
  }

  return result;
}

/**
 * @kovoPrimitiveHandler
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
 * @kovoPrimitiveHandler
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

/**
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function numberFieldKeyDown(
  event: NumberFieldKeyboardEvent,
  state: NumberFieldState,
  options: NumberFieldChangeOptions = {},
): NumberFieldChangeResult | undefined {
  if (event.defaultPrevented) return;

  const result = numberFieldKeyboardValueChange(event, state, options);
  if (result === undefined) return;

  event.preventDefault();

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
  stepOverride?: number,
): NumberFieldValue {
  const step = stepOverride ?? numberFieldSmallStep(state);
  const currentValue = normalizeNumberFieldValue(state.value);
  const nextValue =
    currentValue === undefined
      ? numberFieldEmptyStepValue(state, direction)
      : numberFieldAlignedStepValue(state, currentValue, step, direction);

  return clampNumberFieldValue(nextValue, state);
}

function numberFieldKeyboardValueChange(
  event: NumberFieldKeyboardEvent,
  state: NumberFieldState,
  options: NumberFieldChangeOptions,
): NumberFieldChangeResult | undefined {
  if (event.defaultPrevented) return;

  const direction =
    event.key === 'ArrowUp' || event.key === 'PageUp'
      ? 'increment'
      : event.key === 'ArrowDown' || event.key === 'PageDown'
        ? 'decrement'
        : undefined;

  if (direction !== undefined) {
    const step = numberFieldKeyboardStep(event, state);
    return setNumberFieldValue(
      state,
      numberFieldStepValue(state, direction, step),
      direction,
      options,
    );
  }

  if (event.key === 'Home' && numberFieldFinite(state.min)) {
    return setNumberFieldValue(state, state.min, 'decrement', options);
  }

  if (event.key === 'End' && numberFieldFinite(state.max)) {
    return setNumberFieldValue(state, state.max, 'increment', options);
  }

  return undefined;
}

function numberFieldKeyboardStep(event: NumberFieldKeyboardEvent, state: NumberFieldState): number {
  return event.key === 'PageUp' ||
    event.key === 'PageDown' ||
    event.shiftKey === true ||
    event.metaKey === true ||
    event.ctrlKey === true ||
    event.altKey === true
    ? numberFieldLargeStep(state)
    : numberFieldSmallStep(state);
}

function numberFieldInputEventTarget(event: NumberFieldInputEvent): { value: string } | undefined {
  if (event.currentTarget !== null) return event.currentTarget;
  const target = event.target;
  if (target && typeof target.value === 'string') return target as { value: string };
  return undefined;
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
    // J4: snap to step precision so fractional steps don't accumulate IEEE-754
    // noise (e.g. 0.1+0.1+0.1 → 0.30000000000000004).
    return roundNumberFieldValue(value + (direction === 'increment' ? step : -step), step);
  }

  const base = state.min;
  // J4: round the offset before the integer test. Without rounding, an on-grid
  // value like 0.6 reads as 5.999…/0.1 = 5.999… (off-grid) → Math.ceil snaps it
  // back to 6 → the spinner stutters at ~0.6 and never reaches 0.7. Rounding the
  // offset first makes the on-grid check robust, matching native <input>.
  const rawOffset = (value - base) / step;
  const offset = roundNumberFieldOffset(rawOffset);

  if (Number.isInteger(offset)) {
    return roundNumberFieldValue(value + (direction === 'increment' ? step : -step), step);
  }

  const alignedOffset = direction === 'increment' ? Math.ceil(offset) : Math.floor(offset);
  return roundNumberFieldValue(base + alignedOffset * step, step);
}

// J4 (mirrors slider.ts roundSliderValue): snap a computed value to the step's
// decimal precision so fractional-step arithmetic lands on the visible grid.
function roundNumberFieldValue(value: number, step: number): number {
  const stepText = String(step);
  const decimalIndex = stepText.indexOf('.');
  const precision = decimalIndex === -1 ? 0 : stepText.length - decimalIndex - 1;
  return Number(value.toFixed(Math.min(precision, 12)));
}

// J4: collapse near-integer float error so the on-grid (Number.isInteger) test
// recognizes values that are integral to ~12 decimals (5.999… → 6).
function roundNumberFieldOffset(offset: number): number {
  const rounded = Number(offset.toFixed(12));
  return Number.isInteger(rounded) ? rounded : offset;
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

function numberFieldSmallStep(state: NumberFieldState): number {
  if (numberFieldFinite(state.smallStep) && state.smallStep > 0) return state.smallStep;
  if (numberFieldFinite(state.step) && state.step > 0) return state.step;
  return 1;
}

function numberFieldLargeStep(state: NumberFieldState): number {
  if (numberFieldFinite(state.largeStep) && state.largeStep > 0) return state.largeStep;
  return numberFieldSmallStep(state) * 10;
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
