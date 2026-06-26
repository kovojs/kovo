import {
  checkedState,
  dataDisabled,
  dispatchCancelableChange,
  mergeDataAttributes,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
} from '../lib/index.js';

/**
 * Reason token reported by the Switch primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SwitchChangeReason } from '@kovojs/headless-ui/switch';
 *
 * const value: SwitchChangeReason = {} as SwitchChangeReason;
 * ```
 */
export type SwitchChangeReason = 'programmatic' | 'trigger-click';

/**
 * Cancelable change detail emitted by the Switch primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SwitchChangeDetail } from '@kovojs/headless-ui/switch';
 *
 * const value: SwitchChangeDetail = {} as SwitchChangeDetail;
 * ```
 */
export type SwitchChangeDetail = PrimitiveChangeDetail<SwitchChangeReason, boolean>;

/**
 * State snapshot consumed by the Switch primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SwitchState } from '@kovojs/headless-ui/switch';
 *
 * const value: SwitchState = {} as SwitchState;
 * ```
 */
export interface SwitchState {
  checked: boolean;
  disabled?: boolean;
  form?: string;
  name?: string;
  required?: boolean;
  value?: string;
}

/**
 * Options accepted by the Switch primitive switch change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SwitchChangeOptions } from '@kovojs/headless-ui/switch';
 *
 * const value: SwitchChangeOptions = {} as SwitchChangeOptions;
 * ```
 */
export interface SwitchChangeOptions {
  onCheckedChange?: (detail: SwitchChangeDetail) => void;
}

/**
 * Result returned by the Switch primitive switch change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SwitchChangeResult } from '@kovojs/headless-ui/switch';
 *
 * const value: SwitchChangeResult = {} as SwitchChangeResult;
 * ```
 */
export interface SwitchChangeResult {
  changed: boolean;
  checked: boolean;
  detail?: SwitchChangeDetail;
}

/**
 * Serializable attribute record returned by Switch primitive builders.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SwitchPrimitiveAttributes } from '@kovojs/headless-ui/switch';
 *
 * const value: SwitchPrimitiveAttributes = {} as SwitchPrimitiveAttributes;
 * ```
 */
export type SwitchPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | string>>;

/**
 * Event shape consumed by the Switch primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SwitchTriggerEvent } from '@kovojs/headless-ui/switch';
 *
 * const value: SwitchTriggerEvent = {} as SwitchTriggerEvent;
 * ```
 */
export type SwitchTriggerEvent = Event;

/**
 * Builds the switch root attributes record for the Switch primitive.
 *
 * Emits `aria-checked`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { switchRootAttributes } from '@kovojs/headless-ui/switch';
 *
 * const input = {} as Parameters<typeof switchRootAttributes>[0];
 * const result = switchRootAttributes(input);
 * ```
 */
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

/**
 * Computes the set switch checked transition for the Switch primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { setSwitchChecked } from '@kovojs/headless-ui/switch';
 *
 * const input = {} as Parameters<typeof setSwitchChecked>[0];
 * const state = {} as Parameters<typeof setSwitchChecked>[1];
 * const options = {} as Parameters<typeof setSwitchChecked>[2];
 * const detail = {} as Parameters<typeof setSwitchChecked>[3];
 * const result = setSwitchChecked(input, state, options, detail);
 * ```
 */
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

/**
 * Computes the toggle switch transition for the Switch primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toggleSwitch } from '@kovojs/headless-ui/switch';
 *
 * const input = {} as Parameters<typeof toggleSwitch>[0];
 * const state = {} as Parameters<typeof toggleSwitch>[1];
 * const options = {} as Parameters<typeof toggleSwitch>[2];
 * const result = toggleSwitch(input, state, options);
 * ```
 */
export function toggleSwitch(
  state: SwitchState,
  reason: SwitchChangeReason,
  options: SwitchChangeOptions = {},
): SwitchChangeResult {
  return setSwitchChecked(state, !state.checked, reason, options);
}

/**
 * Handles the switch trigger click interaction for the Switch primitive.
 *
 * @example
 * ```ts
 * import { switchTriggerClick } from '@kovojs/headless-ui/switch';
 *
 * const input = {} as Parameters<typeof switchTriggerClick>[0];
 * const state = {} as Parameters<typeof switchTriggerClick>[1];
 * const options = {} as Parameters<typeof switchTriggerClick>[2];
 * const result = switchTriggerClick(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
