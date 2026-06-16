import {
  checkedState,
  dataDisabled,
  dataOrientation,
  dispatchCancelableChange,
  mergeDataAttributes,
  moveCollectionIndex,
  navigationIntentFromKey,
  type CollectionOrientation,
  type NavigationIntent,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
  type TextDirection,
} from '../lib/index.js';

export interface RadioGroupItem {
  disabled?: boolean;
  value: string;
}

export interface RadioGroupState {
  dir?: TextDirection;
  disabled?: boolean;
  form?: string;
  invalid?: boolean;
  items?: readonly RadioGroupItem[];
  loop?: boolean;
  name?: string;
  orientation?: CollectionOrientation;
  required?: boolean;
  value?: string;
}

export interface RadioGroupRootAttributeOptions extends RadioGroupState {
  descriptionId?: string;
  errorId?: string;
  id?: string;
  labelledBy?: string;
}

export interface RadioGroupItemAttributeOptions extends RadioGroupState {
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
}

export interface RadioGroupRadioAttributeOptions extends RadioGroupItemAttributeOptions {
  controlId?: string;
}

export interface RadioGroupLabelAttributeOptions extends RadioGroupItemAttributeOptions {
  controlId?: string;
}

export type RadioGroupChangeReason = 'item-click' | 'keyboard' | 'programmatic';

export type RadioGroupChangeDetail = PrimitiveChangeDetail<
  RadioGroupChangeReason,
  string | undefined
>;

export interface RadioGroupChangeOptions {
  onValueChange?: (detail: RadioGroupChangeDetail) => void;
}

export interface RadioGroupChangeResult {
  changed: boolean;
  detail?: RadioGroupChangeDetail;
  value: string | undefined;
}

export interface RadioGroupMoveResult {
  index: number;
  value: string | undefined;
}

export type RadioGroupPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

export type RadioGroupItemEvent = Event;
export type RadioGroupKeyboardEvent = Event & { readonly key: string };

export function radioGroupItemChecked(options: RadioGroupItemAttributeOptions): boolean {
  return options.value === options.itemValue;
}

export function radioGroupRovingIndex(state: RadioGroupState): number {
  const items = state.items ?? [];
  if (items.length === 0) return -1;

  const selectedIndex = items.findIndex(
    (item) => item.value === state.value && !radioGroupItemDisabled(state, item.value),
  );
  if (selectedIndex >= 0) return selectedIndex;

  return moveCollectionIndex('first', {
    currentIndex: -1,
    items: radioGroupNavigationItems(state),
  });
}

export function radioGroupRootAttributes(
  options: RadioGroupRootAttributeOptions = {},
): RadioGroupPrimitiveAttributes {
  const describedBy = radioGroupDescribedBy(options);

  return Object.freeze({
    ...radioGroupDataAttributes(options),
    role: 'radiogroup',
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
    ...(describedBy === '' ? {} : { 'aria-describedby': describedBy }),
    ...(options.disabled === true ? { 'aria-disabled': 'true' } : {}),
    ...(options.invalid === true ? { 'aria-invalid': 'true' } : {}),
    ...(options.required === true ? { 'aria-required': 'true' } : {}),
  });
}

export function radioGroupItemAttributes(
  options: RadioGroupItemAttributeOptions,
): RadioGroupPrimitiveAttributes {
  return Object.freeze({
    ...radioGroupItemDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

export function radioGroupRadioAttributes(
  options: RadioGroupRadioAttributeOptions,
): RadioGroupPrimitiveAttributes {
  const disabled = radioGroupItemDisabled(options, options.itemValue);
  const checked = radioGroupItemChecked(options);

  // SPEC.md §6.3: form() typing validates real named controls; radio-group
  // preserves native radio inputs instead of synthesizing hidden fields.
  return Object.freeze({
    ...radioGroupItemDataAttributes(options),
    'aria-checked': String(checked),
    checked,
    disabled,
    tabIndex: radioGroupItemTabIndex(options),
    type: 'radio',
    value: options.itemValue,
    ...(options.controlId === undefined ? {} : { id: options.controlId }),
    ...(options.form === undefined ? {} : { form: options.form }),
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(options.required === true ? { required: true } : {}),
  });
}

export function radioGroupLabelAttributes(
  options: RadioGroupLabelAttributeOptions,
): RadioGroupPrimitiveAttributes {
  return Object.freeze({
    ...radioGroupItemDataAttributes(options),
    ...(options.controlId === undefined ? {} : { for: options.controlId }),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

export function setRadioGroupValue(
  state: RadioGroupState,
  value: string | undefined,
  reason: RadioGroupChangeReason,
  options: RadioGroupChangeOptions = {},
): RadioGroupChangeResult {
  if (state.disabled || state.value === value || radioGroupValueDisabled(state, value)) {
    return { changed: false, value: state.value };
  }

  const detail = dispatchCancelableChange({ reason, value }, options.onValueChange);
  if (detail.defaultPrevented) {
    return { changed: false, detail, value: state.value };
  }

  return { changed: true, detail, value };
}

export function radioGroupMoveValue(
  state: RadioGroupState,
  intent: NavigationIntent,
): RadioGroupMoveResult {
  const items = state.items ?? [];
  if (state.disabled || items.length === 0) return { index: -1, value: state.value };

  const currentIndex = radioGroupRovingIndex(state);
  if (currentIndex < 0) return { index: -1, value: state.value };

  const index = moveCollectionIndex(intent, {
    currentIndex,
    items: radioGroupNavigationItems(state),
    ...(state.loop === undefined ? {} : { loop: state.loop }),
  });

  return {
    index,
    value: index < 0 ? state.value : items[index]?.value,
  };
}

/**
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function radioGroupItemClick(
  event: RadioGroupItemEvent,
  state: RadioGroupItemAttributeOptions,
  options: RadioGroupChangeOptions = {},
): RadioGroupChangeResult | undefined {
  if (event.defaultPrevented) return;

  const result = setRadioGroupValue(state, state.itemValue, 'item-click', options);
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
export function radioGroupKeyDown(
  event: RadioGroupKeyboardEvent,
  state: RadioGroupState,
  options: RadioGroupChangeOptions = {},
): RadioGroupChangeResult | undefined {
  if (event.defaultPrevented) return;

  const intent = navigationIntentFromKey(event.key, {
    ...(state.dir === undefined ? {} : { dir: state.dir }),
    ...(state.orientation === undefined ? {} : { orientation: state.orientation }),
  });
  if (intent === undefined) return;

  const next = radioGroupMoveValue(state, intent);
  if (next.index < 0) return;

  const result = setRadioGroupValue(state, next.value, 'keyboard', options);
  event.preventDefault();

  return result;
}

function radioGroupDataAttributes(state: RadioGroupState): PrimitiveDataAttributes {
  return mergeDataAttributes(
    dataOrientation(radioGroupDataOrientation(state.orientation)),
    dataDisabled(state.disabled === true),
    state.invalid === true ? { 'data-invalid': '' } : undefined,
    state.required === true ? { 'data-required': '' } : undefined,
  );
}

function radioGroupItemDataAttributes(
  options: RadioGroupItemAttributeOptions,
): PrimitiveDataAttributes {
  return mergeDataAttributes(
    checkedState(radioGroupItemChecked(options)),
    dataDisabled(radioGroupItemDisabled(options, options.itemValue)),
  );
}

function radioGroupItemTabIndex(options: RadioGroupItemAttributeOptions): number {
  if (radioGroupItemDisabled(options, options.itemValue)) return -1;

  const itemIndex = options.items?.findIndex((item) => item.value === options.itemValue) ?? -1;
  if (itemIndex >= 0) return itemIndex === radioGroupRovingIndex(options) ? 0 : -1;

  return radioGroupItemChecked(options) ? 0 : -1;
}

function radioGroupItemDisabled(
  state: RadioGroupState & { itemDisabled?: boolean },
  value: string,
): boolean {
  return (
    state.disabled === true ||
    state.itemDisabled === true ||
    state.items?.find((item) => item.value === value)?.disabled === true
  );
}

function radioGroupValueDisabled(state: RadioGroupState, value: string | undefined): boolean {
  return value !== undefined && radioGroupItemDisabled(state, value);
}

function radioGroupNavigationItems(state: RadioGroupState): readonly { disabled?: boolean }[] {
  return (state.items ?? []).map((item) => ({
    disabled: state.disabled === true || item.disabled === true,
  }));
}

function radioGroupDataOrientation(
  orientation: CollectionOrientation | undefined,
): 'horizontal' | 'vertical' {
  return orientation === 'horizontal' ? 'horizontal' : 'vertical';
}

function radioGroupDescribedBy(options: {
  descriptionId?: string;
  errorId?: string;
  invalid?: boolean;
}): string {
  return [options.descriptionId, options.invalid === true ? options.errorId : undefined]
    .filter((id): id is string => id !== undefined && id.length > 0)
    .join(' ');
}
