/** Standard `data-state` token values emitted by headless primitive attribute helpers. */
export type PrimitiveStateToken =
  | 'active'
  | 'checked'
  | 'closed'
  | 'disabled'
  | 'hidden'
  | 'indeterminate'
  | 'inactive'
  | 'off'
  | 'on'
  | 'open'
  | 'pressed'
  | 'unchecked'
  | 'visible';

/** Data attributes emitted by headless primitive attribute helpers. */
export type PrimitiveDataAttributes = Readonly<Record<`data-${string}`, string>>;

/** Shared ARIA/native-disabled wiring for trigger-like controls across primitives. */
export interface TriggerAttributesOptions {
  controlsId?: string | undefined;
  disabled?: boolean | undefined;
  disabledBehavior?: 'aria' | 'native' | 'none' | undefined;
  haspopup?: string | undefined;
  labelledBy?: string | undefined;
  nativeDisabledPresence?: 'always' | 'when-disabled' | undefined;
  open?: boolean | undefined;
  stripControlsWhenDisabled?: boolean | undefined;
}

export function dataState(state: PrimitiveStateToken): PrimitiveDataAttributes {
  return { 'data-state': state };
}

export function dataDisabled(disabled: boolean): PrimitiveDataAttributes {
  return disabled ? { 'data-disabled': '' } : {};
}

export function dataOrientation(orientation: 'horizontal' | 'vertical'): PrimitiveDataAttributes {
  return { 'data-orientation': orientation };
}

export function openState(open: boolean): PrimitiveDataAttributes {
  return dataState(open ? 'open' : 'closed');
}

export function checkedState(checked: boolean | 'indeterminate'): PrimitiveDataAttributes {
  if (checked === 'indeterminate') return dataState('indeterminate');
  return dataState(checked ? 'checked' : 'unchecked');
}

export function pressedState(pressed: boolean): PrimitiveDataAttributes {
  return dataState(pressed ? 'pressed' : 'off');
}

export function triggerAttributes(
  options: TriggerAttributesOptions,
): Readonly<Record<string, string | boolean>> {
  const {
    controlsId,
    disabled = false,
    disabledBehavior = 'native',
    haspopup,
    labelledBy,
    nativeDisabledPresence = 'always',
    open = false,
    stripControlsWhenDisabled = false,
  } = options;
  const emittedControlsId = disabled && stripControlsWhenDisabled ? undefined : controlsId;

  return Object.freeze({
    'aria-expanded': String(open),
    ...(haspopup === undefined ? {} : { 'aria-haspopup': haspopup }),
    ...(emittedControlsId === undefined ? {} : { 'aria-controls': emittedControlsId }),
    ...(labelledBy === undefined ? {} : { 'aria-labelledby': labelledBy }),
    ...(disabledBehavior === 'aria' && disabled ? { 'aria-disabled': 'true' } : {}),
    ...(disabledBehavior === 'native' && (disabled || nativeDisabledPresence === 'always')
      ? { disabled }
      : {}),
  });
}

export function mergeDataAttributes(
  ...attributes: readonly (PrimitiveDataAttributes | undefined)[]
): PrimitiveDataAttributes {
  return Object.freeze(Object.assign({}, ...attributes));
}
