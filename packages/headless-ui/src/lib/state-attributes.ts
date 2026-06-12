export type PrimitiveStateToken =
  | 'active'
  | 'checked'
  | 'closed'
  | 'disabled'
  | 'indeterminate'
  | 'inactive'
  | 'off'
  | 'on'
  | 'open'
  | 'pressed'
  | 'unchecked';

export type PrimitiveDataAttributes = Readonly<Record<`data-${string}`, string>>;

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

export function mergeDataAttributes(
  ...attributes: readonly (PrimitiveDataAttributes | undefined)[]
): PrimitiveDataAttributes {
  return Object.freeze(Object.assign({}, ...attributes));
}
