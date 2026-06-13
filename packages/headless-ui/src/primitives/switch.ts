import {
  checkedState,
  dataDisabled,
  dispatchCancelableChange,
  mergeDataAttributes,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
} from '../lib/index.js';

export type SwitchChangeReason = 'programmatic' | 'trigger-click';

export type SwitchChangeDetail = PrimitiveChangeDetail<SwitchChangeReason, boolean>;

export interface SwitchState {
  checked: boolean;
  disabled?: boolean;
  form?: string;
  name?: string;
  required?: boolean;
  value?: string;
}

export interface SwitchChangeOptions {
  onCheckedChange?: (detail: SwitchChangeDetail) => void;
}

export interface SwitchChangeResult {
  changed: boolean;
  checked: boolean;
  detail?: SwitchChangeDetail;
}

export type SwitchPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | string>>;

export type SwitchTriggerEvent = Event;

export function switchRootAttributes(state: SwitchState): SwitchPrimitiveAttributes {
  return Object.freeze({
    ...mergeDataAttributes(checkedState(state.checked), dataDisabled(state.disabled === true)),
    'aria-checked': String(state.checked),
    checked: state.checked,
    disabled: state.disabled === true,
    // SPEC.md §6.3: form() typing validates real named controls; switch keeps
    // a native checkbox as the submitted control, including external form owners.
    ...(state.form === undefined ? {} : { form: state.form }),
    ...(state.name === undefined ? {} : { name: state.name }),
    role: 'switch',
    ...(state.required === true ? { required: true } : {}),
    type: 'checkbox',
    ...(state.value === undefined ? {} : { value: state.value }),
  });
}

export function setSwitchChecked(
  state: SwitchState,
  checked: boolean,
  reason: SwitchChangeReason,
  options: SwitchChangeOptions = {},
): SwitchChangeResult {
  if (state.disabled || state.checked === checked) {
    return { changed: false, checked: state.checked };
  }

  const detail = dispatchCancelableChange({ reason, value: checked }, options.onCheckedChange);
  if (detail.defaultPrevented) {
    return { changed: false, checked: state.checked, detail };
  }

  return { changed: true, checked, detail };
}

export function toggleSwitch(
  state: SwitchState,
  reason: SwitchChangeReason,
  options: SwitchChangeOptions = {},
): SwitchChangeResult {
  return setSwitchChecked(state, !state.checked, reason, options);
}

/**
 * @jisoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function switchTriggerClick(
  event: SwitchTriggerEvent,
  state: SwitchState,
  options: SwitchChangeOptions = {},
): SwitchChangeResult | undefined {
  if (event.defaultPrevented) return;

  const result = toggleSwitch(state, 'trigger-click', options);
  if (!result.changed) {
    event.preventDefault();
  }

  return result;
}
