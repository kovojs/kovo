import {
  dataDisabled,
  dispatchCancelableChange,
  mergeDataAttributes,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
} from '../lib/index.js';

export type OtpFieldInputMode =
  | 'decimal'
  | 'email'
  | 'none'
  | 'numeric'
  | 'search'
  | 'tel'
  | 'text'
  | 'url';

export interface OtpFieldState {
  disabled?: boolean;
  form?: string;
  inputMode?: OtpFieldInputMode;
  invalid?: boolean;
  length?: number;
  name?: string;
  pattern?: string;
  required?: boolean;
  value?: string;
}

export interface OtpFieldRootAttributeOptions extends OtpFieldState {
  descriptionId?: string;
  errorId?: string;
  id?: string;
  labelledBy?: string;
}

export interface OtpFieldHiddenInputAttributeOptions extends OtpFieldState {
  id?: string;
}

export interface OtpFieldInputAttributeOptions extends OtpFieldState {
  id?: string;
  label?: string;
  labelledBy?: string;
  slotIndex: number;
}

export type OtpFieldChangeReason = 'delete' | 'input' | 'paste' | 'programmatic';

export type OtpFieldChangeDetail = PrimitiveChangeDetail<OtpFieldChangeReason, string>;

export interface OtpFieldChangeOptions {
  onValueChange?: (detail: OtpFieldChangeDetail) => void;
}

export interface OtpFieldChangeResult {
  changed: boolean;
  complete: boolean;
  detail?: OtpFieldChangeDetail;
  focusIndex?: number;
  value: string;
}

export interface OtpFieldMoveResult {
  focusIndex: number;
}

export type OtpFieldPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

type OtpFieldInputTarget = { value: string } | null;
type OtpFieldRestorableTarget = { value?: string } | null;

export type OtpFieldInputEvent = Event & {
  readonly currentTarget: OtpFieldInputTarget;
  readonly target?: { value?: string } | null;
};
export type OtpFieldKeyboardEvent = Event & {
  readonly currentTarget?: OtpFieldRestorableTarget;
  readonly key: string;
};
export type OtpFieldPasteEvent = Event & {
  readonly clipboardData: { getData(format: string): string } | null;
  readonly currentTarget?: OtpFieldRestorableTarget;
  readonly target?: { value?: string } | null;
};

export function otpFieldComplete(state: OtpFieldState): boolean {
  return normalizeOtpFieldValue(state.value, state.length).length === otpFieldLength(state.length);
}

export function otpFieldSlotValue(state: OtpFieldState, slotIndex: number): string {
  return (
    otpFieldChars(state.value, state.length)[normalizeOtpFieldSlotIndex(state, slotIndex)] ?? ''
  );
}

export function otpFieldRootAttributes(
  options: OtpFieldRootAttributeOptions = {},
): OtpFieldPrimitiveAttributes {
  const describedBy = otpFieldDescribedBy(options);

  return Object.freeze({
    ...otpFieldDataAttributes(options),
    role: 'group',
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
    ...(describedBy === '' ? {} : { 'aria-describedby': describedBy }),
    ...(options.disabled === true ? { 'aria-disabled': 'true' } : {}),
    ...(options.invalid === true ? { 'aria-invalid': 'true' } : {}),
  });
}

export function otpFieldHiddenInputAttributes(
  options: OtpFieldHiddenInputAttributeOptions = {},
): OtpFieldPrimitiveAttributes {
  const value = normalizeOtpFieldValue(options.value, options.length);

  // SPEC.md §6.3: form() typing validates real named controls; otp-field
  // submits one aggregate native control while visible slot inputs stay unnamed.
  return Object.freeze({
    ...otpFieldDataAttributes(options),
    'aria-hidden': 'true',
    'data-slot': 'hidden-input',
    autoComplete: 'one-time-code',
    disabled: options.disabled === true,
    ...(options.form === undefined ? {} : { form: options.form }),
    inputMode: otpFieldInputMode(options.inputMode),
    maxLength: otpFieldLength(options.length),
    minLength: otpFieldLength(options.length),
    tabIndex: -1,
    type: 'text',
    value,
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(options.pattern === undefined ? {} : { pattern: options.pattern }),
    ...(options.required === true ? { required: true } : {}),
  });
}

export function otpFieldInputAttributes(
  options: OtpFieldInputAttributeOptions,
): OtpFieldPrimitiveAttributes {
  const slotIndex = normalizeOtpFieldSlotIndex(options, options.slotIndex);
  const value = otpFieldSlotValue(options, slotIndex);

  return Object.freeze({
    ...mergeDataAttributes(
      otpFieldDataAttributes(options),
      value === '' ? undefined : { 'data-filled': '' },
    ),
    'aria-label': options.label ?? `One-time code character ${slotIndex + 1}`,
    'data-slot': String(slotIndex),
    autoComplete: slotIndex === 0 ? 'one-time-code' : 'off',
    disabled: options.disabled === true,
    inputMode: otpFieldInputMode(options.inputMode),
    maxLength: 1,
    type: 'text',
    value,
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
    ...(options.pattern === undefined ? {} : { pattern: options.pattern }),
    ...(options.required === true ? { required: true } : {}),
    ...(options.invalid === true ? { 'aria-invalid': 'true' } : {}),
  });
}

export function setOtpFieldValue(
  state: OtpFieldState,
  value: string,
  reason: OtpFieldChangeReason,
  options: OtpFieldChangeOptions = {},
): OtpFieldChangeResult {
  const currentValue = normalizeOtpFieldValue(state.value, state.length);
  const nextValue = normalizeOtpFieldValue(value, state.length);

  if (state.disabled || currentValue === nextValue) {
    return otpFieldChangeResult(false, currentValue, state);
  }

  const detail = dispatchCancelableChange({ reason, value: nextValue }, options.onValueChange);
  if (detail.defaultPrevented) {
    return otpFieldChangeResult(false, currentValue, state, detail);
  }

  return otpFieldChangeResult(true, nextValue, state, detail);
}

export function setOtpFieldSlotValue(
  state: OtpFieldState,
  slotIndex: number,
  inputValue: string,
  reason: OtpFieldChangeReason,
  options: OtpFieldChangeOptions = {},
): OtpFieldChangeResult {
  const nextValue = otpFieldValueWithSlotInput(state, slotIndex, inputValue);
  const result = setOtpFieldValue(state, nextValue, reason, options);
  const focusIndex = otpFieldFocusIndexAfterInput(state, slotIndex, inputValue);

  return { ...result, focusIndex };
}

export function otpFieldMoveFocus(
  state: OtpFieldState,
  slotIndex: number,
  key: string,
): OtpFieldMoveResult | undefined {
  const currentIndex = normalizeOtpFieldSlotIndex(state, slotIndex);
  const lastIndex = otpFieldLength(state.length) - 1;

  if (key === 'ArrowLeft') return { focusIndex: Math.max(0, currentIndex - 1) };
  if (key === 'ArrowRight') return { focusIndex: Math.min(lastIndex, currentIndex + 1) };
  if (key === 'Home') return { focusIndex: 0 };
  if (key === 'End') return { focusIndex: lastIndex };

  return undefined;
}

export function otpFieldValueFromString(value: string, length?: number): string {
  return normalizeOtpFieldValue(value, length);
}

/**
 * @jisoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function otpFieldInput(
  event: OtpFieldInputEvent,
  state: OtpFieldState & { slotIndex: number },
  options: OtpFieldChangeOptions = {},
): OtpFieldChangeResult | undefined {
  if (event.defaultPrevented) return;

  const input = otpFieldInputEventTarget(event);
  if (input === undefined) return;

  const result = setOtpFieldSlotValue(
    state,
    state.slotIndex,
    input.value,
    'input',
    options,
  );
  if (!result.changed) {
    restoreOtpFieldSlotTargetValue(input, state, result.value);
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
export function otpFieldKeyDown(
  event: OtpFieldKeyboardEvent,
  state: OtpFieldState & { slotIndex: number },
  options: OtpFieldChangeOptions = {},
): OtpFieldChangeResult | OtpFieldMoveResult | undefined {
  if (event.defaultPrevented) return;

  if (event.key === 'Backspace' || event.key === 'Delete') {
    const result = setOtpFieldSlotValue(state, state.slotIndex, '', 'delete', options);
    if (!result.changed) {
      restoreOtpFieldSlotTargetValue(event.currentTarget ?? null, state, result.value);
    }
    event.preventDefault();
    return result;
  }

  const move = otpFieldMoveFocus(state, state.slotIndex, event.key);
  if (move === undefined) return;

  event.preventDefault();
  return move;
}

/**
 * @jisoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function otpFieldPaste(
  event: OtpFieldPasteEvent,
  state: OtpFieldState & { slotIndex: number },
  options: OtpFieldChangeOptions = {},
): OtpFieldChangeResult | undefined {
  if (event.defaultPrevented) return;

  const text = event.clipboardData?.getData('text') ?? '';
  if (text === '') return;

  const result = setOtpFieldSlotValue(state, state.slotIndex, text, 'paste', options);
  if (!result.changed) {
    restoreOtpFieldSlotTargetValue(otpFieldRestorableEventTarget(event), state, result.value);
  }
  event.preventDefault();

  return result;
}

function otpFieldInputEventTarget(
  event: OtpFieldInputEvent,
): { value: string } | undefined {
  if (event.currentTarget && typeof event.currentTarget.value === 'string') {
    return event.currentTarget;
  }

  const target = event.target;
  if (target && typeof target.value === 'string') return target as { value: string };
  return undefined;
}

function otpFieldRestorableEventTarget(event: {
  readonly currentTarget?: OtpFieldRestorableTarget;
  readonly target?: { value?: string } | null;
}): OtpFieldRestorableTarget {
  if (event.currentTarget && typeof event.currentTarget.value === 'string') {
    return event.currentTarget;
  }

  const target = event.target;
  if (target && typeof target.value === 'string') return target;
  return null;
}

function restoreOtpFieldSlotTargetValue(
  target: OtpFieldRestorableTarget,
  state: OtpFieldState & { slotIndex: number },
  value: string,
): void {
  if (target === null || typeof target.value !== 'string') return;

  target.value = otpFieldSlotValue({ ...state, value }, state.slotIndex);
}

function otpFieldDataAttributes(state: OtpFieldState): PrimitiveDataAttributes {
  return mergeDataAttributes(
    dataDisabled(state.disabled === true),
    otpFieldComplete(state) ? { 'data-complete': '' } : undefined,
    state.invalid === true ? { 'data-invalid': '' } : undefined,
    state.required === true ? { 'data-required': '' } : undefined,
  );
}

function otpFieldValueWithSlotInput(
  state: OtpFieldState,
  slotIndex: number,
  inputValue: string,
): string {
  const length = otpFieldLength(state.length);
  const index = normalizeOtpFieldSlotIndex(state, slotIndex);
  const chars = otpFieldChars(state.value, length);
  const inputChars = otpFieldChars(inputValue, length - index);

  if (inputChars.length === 0) {
    chars.splice(index, 1);
    return chars.join('');
  }

  for (let offset = 0; offset < inputChars.length && index + offset < length; offset += 1) {
    chars[index + offset] = inputChars[offset] ?? '';
  }

  return chars.join('');
}

function otpFieldFocusIndexAfterInput(
  state: OtpFieldState,
  slotIndex: number,
  inputValue: string,
): number {
  const index = normalizeOtpFieldSlotIndex(state, slotIndex);
  const inputLength = otpFieldChars(inputValue, state.length).length;
  if (inputLength === 0) return index;

  return Math.min(otpFieldLength(state.length) - 1, index + inputLength);
}

function otpFieldChangeResult(
  changed: boolean,
  value: string,
  state: OtpFieldState,
  detail?: OtpFieldChangeDetail,
): OtpFieldChangeResult {
  return {
    changed,
    complete: value.length === otpFieldLength(state.length),
    ...(detail === undefined ? {} : { detail }),
    value,
  };
}

function normalizeOtpFieldValue(value: string | undefined, length: number | undefined): string {
  return otpFieldChars(value, length).join('');
}

function otpFieldChars(value: string | undefined, length: number | undefined): string[] {
  return Array.from(value ?? '')
    .filter((character) => character.trim() !== '')
    .slice(0, otpFieldLength(length));
}

function otpFieldLength(length: number | undefined): number {
  if (typeof length !== 'number' || !Number.isFinite(length)) return 6;

  return Math.max(1, Math.floor(length));
}

function normalizeOtpFieldSlotIndex(state: OtpFieldState, slotIndex: number): number {
  if (!Number.isFinite(slotIndex)) return 0;

  return Math.min(Math.max(0, Math.floor(slotIndex)), otpFieldLength(state.length) - 1);
}

function otpFieldInputMode(inputMode: OtpFieldInputMode | undefined): OtpFieldInputMode {
  return inputMode ?? 'numeric';
}

function otpFieldDescribedBy(options: {
  descriptionId?: string;
  errorId?: string;
  invalid?: boolean;
}): string {
  return [options.descriptionId, options.invalid === true ? options.errorId : undefined]
    .filter((id): id is string => id !== undefined && id.length > 0)
    .join(' ');
}
