import {
  dataDisabled,
  dispatchCancelableChange,
  mergeDataAttributes,
  pressedState,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
} from '../lib/index.js';

/**
 * Reason token reported by the Toggle primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToggleChangeReason } from '@kovojs/headless-ui/toggle';
 *
 * const value: ToggleChangeReason = {} as ToggleChangeReason;
 * ```
 */
export type ToggleChangeReason = 'programmatic' | 'trigger-click';

/**
 * Cancelable change detail emitted by the Toggle primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToggleChangeDetail } from '@kovojs/headless-ui/toggle';
 *
 * const value: ToggleChangeDetail = {} as ToggleChangeDetail;
 * ```
 */
export type ToggleChangeDetail = PrimitiveChangeDetail<ToggleChangeReason, boolean>;

/**
 * State snapshot consumed by the Toggle primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToggleState } from '@kovojs/headless-ui/toggle';
 *
 * const value: ToggleState = {} as ToggleState;
 * ```
 */
export interface ToggleState {
  disabled?: boolean;
  pressed: boolean;
}

/**
 * Options accepted by the Toggle primitive toggle change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToggleChangeOptions } from '@kovojs/headless-ui/toggle';
 *
 * const value: ToggleChangeOptions = {} as ToggleChangeOptions;
 * ```
 */
export interface ToggleChangeOptions {
  onPressedChange?: (detail: ToggleChangeDetail) => void;
}

/**
 * Result returned by the Toggle primitive toggle change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToggleChangeResult } from '@kovojs/headless-ui/toggle';
 *
 * const value: ToggleChangeResult = {} as ToggleChangeResult;
 * ```
 */
export interface ToggleChangeResult {
  changed: boolean;
  detail?: ToggleChangeDetail;
  pressed: boolean;
}

/**
 * Serializable attribute record returned by Toggle primitive builders.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { TogglePrimitiveAttributes } from '@kovojs/headless-ui/toggle';
 *
 * const value: TogglePrimitiveAttributes = {} as TogglePrimitiveAttributes;
 * ```
 */
export type TogglePrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | string>>;

/**
 * Event shape consumed by the Toggle primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToggleTriggerEvent } from '@kovojs/headless-ui/toggle';
 *
 * const value: ToggleTriggerEvent = {} as ToggleTriggerEvent;
 * ```
 */
export type ToggleTriggerEvent = Event;

/**
 * Builds the toggle root attributes record for the Toggle primitive.
 *
 * Emits `aria-pressed`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toggleRootAttributes } from '@kovojs/headless-ui/toggle';
 *
 * const input = {} as Parameters<typeof toggleRootAttributes>[0];
 * const result = toggleRootAttributes(input);
 * ```
 */
export function toggleRootAttributes(state: ToggleState): TogglePrimitiveAttributes {
  return Object.freeze({
    ...mergeDataAttributes(pressedState(state.pressed), dataDisabled(state.disabled === true)),
    'aria-pressed': String(state.pressed),
    disabled: state.disabled === true,
    type: 'button',
  });
}

/**
 * Computes the set toggle pressed transition for the Toggle primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { setTogglePressed } from '@kovojs/headless-ui/toggle';
 *
 * const input = {} as Parameters<typeof setTogglePressed>[0];
 * const state = {} as Parameters<typeof setTogglePressed>[1];
 * const options = {} as Parameters<typeof setTogglePressed>[2];
 * const detail = {} as Parameters<typeof setTogglePressed>[3];
 * const result = setTogglePressed(input, state, options, detail);
 * ```
 */
export function setTogglePressed(
  state: ToggleState,
  pressed: boolean,
  reason: ToggleChangeReason,
  options: ToggleChangeOptions = {},
): ToggleChangeResult {
  if (state.disabled || state.pressed === pressed) {
    return { changed: false, pressed: state.pressed };
  }

  const detail = dispatchCancelableChange({ reason, value: pressed }, options.onPressedChange);
  if (detail.defaultPrevented) {
    return { changed: false, detail, pressed: state.pressed };
  }

  return { changed: true, detail, pressed };
}

/**
 * Computes the toggle pressed transition for the Toggle primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { togglePressed } from '@kovojs/headless-ui/toggle';
 *
 * const input = {} as Parameters<typeof togglePressed>[0];
 * const state = {} as Parameters<typeof togglePressed>[1];
 * const options = {} as Parameters<typeof togglePressed>[2];
 * const result = togglePressed(input, state, options);
 * ```
 */
export function togglePressed(
  state: ToggleState,
  reason: ToggleChangeReason,
  options: ToggleChangeOptions = {},
): ToggleChangeResult {
  return setTogglePressed(state, !state.pressed, reason, options);
}

/**
 * Computes the toggle trigger click transition for the Toggle primitive.
 *
 * @example
 * ```ts
 * import { toggleTriggerClick } from '@kovojs/headless-ui/toggle';
 *
 * const input = {} as Parameters<typeof toggleTriggerClick>[0];
 * const state = {} as Parameters<typeof toggleTriggerClick>[1];
 * const options = {} as Parameters<typeof toggleTriggerClick>[2];
 * const result = toggleTriggerClick(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function toggleTriggerClick(
  event: ToggleTriggerEvent,
  state: ToggleState,
  options: ToggleChangeOptions = {},
): ToggleChangeResult | undefined {
  if (event.defaultPrevented) return;

  const result = togglePressed(state, 'trigger-click', options);
  if (!result.changed) {
    event.preventDefault();
  }

  return result;
}
