import {
  dataDisabled,
  dispatchCancelableChange,
  mergeDataAttributes,
  pressedState,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
} from '../lib/index.js';

export type ToggleChangeReason = 'programmatic' | 'trigger-click';

export type ToggleChangeDetail = PrimitiveChangeDetail<ToggleChangeReason, boolean>;

export interface ToggleState {
  disabled?: boolean;
  pressed: boolean;
}

export interface ToggleChangeOptions {
  onPressedChange?: (detail: ToggleChangeDetail) => void;
}

export interface ToggleChangeResult {
  changed: boolean;
  detail?: ToggleChangeDetail;
  pressed: boolean;
}

export type TogglePrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | string>>;

export type ToggleTriggerEvent = Event;

export function toggleRootAttributes(state: ToggleState): TogglePrimitiveAttributes {
  return Object.freeze({
    ...mergeDataAttributes(pressedState(state.pressed), dataDisabled(state.disabled === true)),
    'aria-pressed': String(state.pressed),
    disabled: state.disabled === true,
    type: 'button',
  });
}

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

export function togglePressed(
  state: ToggleState,
  reason: ToggleChangeReason,
  options: ToggleChangeOptions = {},
): ToggleChangeResult {
  return setTogglePressed(state, !state.pressed, reason, options);
}

/**
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
