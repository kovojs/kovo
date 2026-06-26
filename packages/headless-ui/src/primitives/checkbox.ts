import {
  checkedState,
  dataDisabled,
  dispatchCancelableChange,
  mergeDataAttributes,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
} from '../lib/index.js';

/**
 * State snapshot consumed by the Checkbox primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CheckboxCheckedState } from '@kovojs/headless-ui/checkbox';
 *
 * const value: CheckboxCheckedState = {} as CheckboxCheckedState;
 * ```
 */
export type CheckboxCheckedState = boolean | 'indeterminate';

/**
 * Reason token reported by the Checkbox primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CheckboxChangeReason } from '@kovojs/headless-ui/checkbox';
 *
 * const value: CheckboxChangeReason = {} as CheckboxChangeReason;
 * ```
 */
export type CheckboxChangeReason = 'programmatic' | 'trigger-click';

/**
 * Cancelable change detail emitted by the Checkbox primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CheckboxChangeDetail } from '@kovojs/headless-ui/checkbox';
 *
 * const value: CheckboxChangeDetail = {} as CheckboxChangeDetail;
 * ```
 */
export type CheckboxChangeDetail = PrimitiveChangeDetail<
  CheckboxChangeReason,
  CheckboxCheckedState
>;

/**
 * State snapshot consumed by the Checkbox primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CheckboxState } from '@kovojs/headless-ui/checkbox';
 *
 * const value: CheckboxState = {} as CheckboxState;
 * ```
 */
export interface CheckboxState {
  checked: CheckboxCheckedState;
  disabled?: boolean;
  name?: string;
  required?: boolean;
  value?: string;
}

/**
 * Options accepted by the Checkbox primitive checkbox change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CheckboxChangeOptions } from '@kovojs/headless-ui/checkbox';
 *
 * const value: CheckboxChangeOptions = {} as CheckboxChangeOptions;
 * ```
 */
export interface CheckboxChangeOptions {
  onCheckedChange?: (detail: CheckboxChangeDetail) => void;
}

/**
 * Result returned by the Checkbox primitive checkbox change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CheckboxChangeResult } from '@kovojs/headless-ui/checkbox';
 *
 * const value: CheckboxChangeResult = {} as CheckboxChangeResult;
 * ```
 */
export interface CheckboxChangeResult {
  changed: boolean;
  checked: CheckboxCheckedState;
  detail?: CheckboxChangeDetail;
}

/**
 * Serializable attribute record returned by Checkbox primitive builders.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CheckboxPrimitiveAttributes } from '@kovojs/headless-ui/checkbox';
 *
 * const value: CheckboxPrimitiveAttributes = {} as CheckboxPrimitiveAttributes;
 * ```
 */
export type CheckboxPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | string>>;

/**
 * Event shape consumed by the Checkbox primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CheckboxTriggerEvent } from '@kovojs/headless-ui/checkbox';
 *
 * const value: CheckboxTriggerEvent = {} as CheckboxTriggerEvent;
 * ```
 */
export type CheckboxTriggerEvent = Event;

/**
 * Public interface used by the Checkbox primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { CheckboxNativeInput } from '@kovojs/headless-ui/checkbox';
 *
 * const value: CheckboxNativeInput = {} as CheckboxNativeInput;
 * ```
 */
export interface CheckboxNativeInput {
  indeterminate: boolean;
}

/**
 * Builds the checkbox root attributes record for the Checkbox primitive.
 *
 * Emits `aria-checked`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { checkboxRootAttributes } from '@kovojs/headless-ui/checkbox';
 *
 * const input = {} as Parameters<typeof checkboxRootAttributes>[0];
 * const result = checkboxRootAttributes(input);
 * ```
 */
export function checkboxRootAttributes(state: CheckboxState): CheckboxPrimitiveAttributes {
  const checked = state.checked === true;

  return Object.freeze({
    ...mergeDataAttributes(checkedState(state.checked), dataDisabled(state.disabled === true)),
    'aria-checked': state.checked === 'indeterminate' ? 'mixed' : String(state.checked),
    checked,
    disabled: state.disabled === true,
    ...(state.name === undefined ? {} : { name: state.name }),
    ...(state.required === true ? { required: true } : {}),
    type: 'checkbox',
    ...(state.value === undefined ? {} : { value: state.value }),
  });
}

/**
 * Computes apply checkbox indeterminate for the Checkbox primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { applyCheckboxIndeterminate } from '@kovojs/headless-ui/checkbox';
 *
 * const input = {} as Parameters<typeof applyCheckboxIndeterminate>[0];
 * const state = {} as Parameters<typeof applyCheckboxIndeterminate>[1];
 * const result = applyCheckboxIndeterminate(input, state);
 * ```
 */
export function applyCheckboxIndeterminate(
  input: CheckboxNativeInput,
  checked: CheckboxCheckedState,
): void {
  input.indeterminate = checked === 'indeterminate';
}

/**
 * Computes the set checkbox checked transition for the Checkbox primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { setCheckboxChecked } from '@kovojs/headless-ui/checkbox';
 *
 * const input = {} as Parameters<typeof setCheckboxChecked>[0];
 * const state = {} as Parameters<typeof setCheckboxChecked>[1];
 * const options = {} as Parameters<typeof setCheckboxChecked>[2];
 * const detail = {} as Parameters<typeof setCheckboxChecked>[3];
 * const result = setCheckboxChecked(input, state, options, detail);
 * ```
 */
export function setCheckboxChecked(
  state: CheckboxState,
  checked: CheckboxCheckedState,
  reason: CheckboxChangeReason,
  options: CheckboxChangeOptions = {},
): CheckboxChangeResult {
  if (state.disabled || state.checked === checked) {
    return { changed: false, checked: state.checked };
  }

  const detail = dispatchCancelableChange({ reason, value: checked }, options.onCheckedChange);
  if (detail.defaultPrevented) {
    return { changed: false, checked: state.checked, detail };
  }

  return { changed: true, checked, detail };
}

/**
 * Computes the toggle checkbox transition for the Checkbox primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toggleCheckbox } from '@kovojs/headless-ui/checkbox';
 *
 * const input = {} as Parameters<typeof toggleCheckbox>[0];
 * const state = {} as Parameters<typeof toggleCheckbox>[1];
 * const options = {} as Parameters<typeof toggleCheckbox>[2];
 * const result = toggleCheckbox(input, state, options);
 * ```
 */
export function toggleCheckbox(
  state: CheckboxState,
  reason: CheckboxChangeReason,
  options: CheckboxChangeOptions = {},
): CheckboxChangeResult {
  return setCheckboxChecked(state, nextCheckboxChecked(state.checked), reason, options);
}

/**
 * Handles the checkbox trigger click interaction for the Checkbox primitive.
 *
 * @example
 * ```ts
 * import { checkboxTriggerClick } from '@kovojs/headless-ui/checkbox';
 *
 * const input = {} as Parameters<typeof checkboxTriggerClick>[0];
 * const state = {} as Parameters<typeof checkboxTriggerClick>[1];
 * const options = {} as Parameters<typeof checkboxTriggerClick>[2];
 * const result = checkboxTriggerClick(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function checkboxTriggerClick(
  event: CheckboxTriggerEvent,
  state: CheckboxState,
  options: CheckboxChangeOptions = {},
): CheckboxChangeResult | undefined {
  if (event.defaultPrevented) return;

  const result = toggleCheckbox(state, 'trigger-click', options);
  if (!result.changed) {
    event.preventDefault();
  }

  return result;
}

function nextCheckboxChecked(checked: CheckboxCheckedState): boolean {
  return checked === 'indeterminate' ? true : !checked;
}
