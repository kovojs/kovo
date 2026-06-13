import {
  checkedState,
  dataDisabled,
  dispatchCancelableChange,
  mergeDataAttributes,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
} from '../lib/index.js';

export type CheckboxCheckedState = boolean | 'indeterminate';

export type CheckboxChangeReason = 'programmatic' | 'trigger-click';

export type CheckboxChangeDetail = PrimitiveChangeDetail<
  CheckboxChangeReason,
  CheckboxCheckedState
>;

export interface CheckboxState {
  checked: CheckboxCheckedState;
  disabled?: boolean;
  name?: string;
  required?: boolean;
  value?: string;
}

export interface CheckboxChangeOptions {
  onCheckedChange?: (detail: CheckboxChangeDetail) => void;
}

export interface CheckboxChangeResult {
  changed: boolean;
  checked: CheckboxCheckedState;
  detail?: CheckboxChangeDetail;
}

export type CheckboxPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | string>>;

export type CheckboxTriggerEvent = Event;

export interface CheckboxNativeInput {
  indeterminate: boolean;
}

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

export function applyCheckboxIndeterminate(
  input: CheckboxNativeInput,
  checked: CheckboxCheckedState,
): void {
  input.indeterminate = checked === 'indeterminate';
}

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

export function toggleCheckbox(
  state: CheckboxState,
  reason: CheckboxChangeReason,
  options: CheckboxChangeOptions = {},
): CheckboxChangeResult {
  return setCheckboxChecked(state, nextCheckboxChecked(state.checked), reason, options);
}

/**
 * @jisoPrimitiveHandler
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
