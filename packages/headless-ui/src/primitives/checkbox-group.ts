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

export interface CheckboxGroupItem {
  disabled?: boolean;
  value: string;
}

export interface CheckboxGroupState {
  activeValue?: string;
  dir?: TextDirection;
  disabled?: boolean;
  form?: string;
  invalid?: boolean;
  items?: readonly CheckboxGroupItem[];
  loop?: boolean;
  name?: string;
  orientation?: CollectionOrientation;
  required?: boolean;
  value?: readonly string[];
}

export interface CheckboxGroupRootAttributeOptions extends CheckboxGroupState {
  descriptionId?: string;
  errorId?: string;
  id?: string;
  labelledBy?: string;
}

export interface CheckboxGroupItemAttributeOptions extends CheckboxGroupState {
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
}

export interface CheckboxGroupControlAttributeOptions extends CheckboxGroupItemAttributeOptions {
  controlId?: string;
}

export interface CheckboxGroupLabelAttributeOptions extends CheckboxGroupItemAttributeOptions {
  controlId?: string;
}

export type CheckboxGroupChangeReason = 'item-click' | 'programmatic';

export type CheckboxGroupChangeDetail = PrimitiveChangeDetail<
  CheckboxGroupChangeReason,
  readonly string[]
>;

export interface CheckboxGroupChangeOptions {
  onValueChange?: (detail: CheckboxGroupChangeDetail) => void;
}

export interface CheckboxGroupChangeResult {
  changed: boolean;
  detail?: CheckboxGroupChangeDetail;
  value: readonly string[];
}

export interface CheckboxGroupMoveResult {
  index: number;
  value: string | undefined;
}

export type CheckboxGroupPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

export type CheckboxGroupItemEvent = Event & {
  readonly currentTarget: (EventTarget & { checked?: boolean }) | null;
};
export type CheckboxGroupKeyboardEvent = Event & { readonly key: string };

export function checkboxGroupItemChecked(options: CheckboxGroupItemAttributeOptions): boolean {
  return checkboxGroupValue(options).includes(options.itemValue);
}

export function checkboxGroupRovingIndex(state: CheckboxGroupState): number {
  const items = state.items ?? [];
  if (items.length === 0) return -1;

  const activeIndex = items.findIndex(
    (item) => item.value === state.activeValue && !checkboxGroupItemDisabled(state, item.value),
  );
  if (activeIndex >= 0) return activeIndex;

  const checkedIndex = items.findIndex(
    (item) =>
      checkboxGroupItemChecked({ ...state, itemValue: item.value }) &&
      !checkboxGroupItemDisabled(state, item.value),
  );
  if (checkedIndex >= 0) return checkedIndex;

  return moveCollectionIndex('first', {
    currentIndex: -1,
    items: checkboxGroupNavigationItems(state),
  });
}

export function checkboxGroupRootAttributes(
  options: CheckboxGroupRootAttributeOptions = {},
): CheckboxGroupPrimitiveAttributes {
  const describedBy = checkboxGroupDescribedBy(options);

  return Object.freeze({
    ...checkboxGroupDataAttributes(options),
    role: 'group',
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
    ...(describedBy === '' ? {} : { 'aria-describedby': describedBy }),
    ...(options.disabled === true ? { 'aria-disabled': 'true' } : {}),
    ...(options.invalid === true ? { 'aria-invalid': 'true' } : {}),
    ...(options.required === true ? { 'aria-required': 'true' } : {}),
  });
}

export function checkboxGroupItemAttributes(
  options: CheckboxGroupItemAttributeOptions,
): CheckboxGroupPrimitiveAttributes {
  return Object.freeze({
    ...checkboxGroupItemDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

export function checkboxGroupControlAttributes(
  options: CheckboxGroupControlAttributeOptions,
): CheckboxGroupPrimitiveAttributes {
  const disabled = checkboxGroupItemDisabled(options, options.itemValue);
  const checked = checkboxGroupItemChecked(options);

  // SPEC.md §6.3: form() typing validates real named controls; checkbox-group
  // preserves native checkbox inputs instead of synthesizing hidden fields.
  return Object.freeze({
    ...checkboxGroupItemDataAttributes(options),
    'aria-checked': String(checked),
    checked,
    disabled,
    tabIndex: checkboxGroupItemTabIndex(options),
    type: 'checkbox',
    value: options.itemValue,
    ...(options.controlId === undefined ? {} : { id: options.controlId }),
    ...(options.form === undefined ? {} : { form: options.form }),
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(options.required === true ? { required: true } : {}),
  });
}

export function checkboxGroupLabelAttributes(
  options: CheckboxGroupLabelAttributeOptions,
): CheckboxGroupPrimitiveAttributes {
  return Object.freeze({
    ...checkboxGroupItemDataAttributes(options),
    ...(options.controlId === undefined ? {} : { for: options.controlId }),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

export function setCheckboxGroupValue(
  state: CheckboxGroupState,
  value: readonly string[],
  reason: CheckboxGroupChangeReason,
  options: CheckboxGroupChangeOptions = {},
): CheckboxGroupChangeResult {
  if (state.disabled) {
    return { changed: false, value: checkboxGroupValue(state) };
  }

  const normalizedValue = normalizeCheckboxGroupValue(value);
  if (
    checkboxGroupValueEqual(checkboxGroupValue(state), normalizedValue) ||
    checkboxGroupValueIncludesDisabled(state, normalizedValue)
  ) {
    return { changed: false, value: checkboxGroupValue(state) };
  }

  const detail = dispatchCancelableChange(
    { reason, value: normalizedValue },
    options.onValueChange,
  );
  if (detail.defaultPrevented) {
    return { changed: false, detail, value: checkboxGroupValue(state) };
  }

  return { changed: true, detail, value: normalizedValue };
}

export function toggleCheckboxGroupItem(
  state: CheckboxGroupItemAttributeOptions,
  reason: CheckboxGroupChangeReason,
  options: CheckboxGroupChangeOptions = {},
): CheckboxGroupChangeResult {
  if (checkboxGroupItemDisabled(state, state.itemValue)) {
    return { changed: false, value: checkboxGroupValue(state) };
  }

  return setCheckboxGroupValue(state, nextCheckboxGroupValue(state), reason, options);
}

export function checkboxGroupMoveFocus(
  state: CheckboxGroupState,
  intent: NavigationIntent,
): CheckboxGroupMoveResult {
  const items = state.items ?? [];
  if (state.disabled || items.length === 0) return { index: -1, value: state.activeValue };

  const currentIndex = checkboxGroupRovingIndex(state);
  if (currentIndex < 0) return { index: -1, value: state.activeValue };

  const index = moveCollectionIndex(intent, {
    currentIndex,
    items: checkboxGroupNavigationItems(state),
    ...(state.loop === undefined ? {} : { loop: state.loop }),
  });

  return {
    index,
    value: index < 0 ? state.activeValue : items[index]?.value,
  };
}

/**
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function checkboxGroupItemClick(
  event: CheckboxGroupItemEvent,
  state: CheckboxGroupItemAttributeOptions,
  options: CheckboxGroupChangeOptions = {},
): CheckboxGroupChangeResult | undefined {
  if (event.defaultPrevented) return;

  const result = toggleCheckboxGroupItem(state, 'item-click', options);
  if (!result.changed) {
    if (event.currentTarget !== null) {
      event.currentTarget.checked = checkboxGroupItemChecked(state);
    }
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
export function checkboxGroupKeyDown(
  event: CheckboxGroupKeyboardEvent,
  state: CheckboxGroupState,
): CheckboxGroupMoveResult | undefined {
  if (event.defaultPrevented) return;

  const intent = navigationIntentFromKey(event.key, {
    ...(state.dir === undefined ? {} : { dir: state.dir }),
    ...(state.orientation === undefined ? {} : { orientation: state.orientation }),
  });
  if (intent === undefined) return;

  const result = checkboxGroupMoveFocus(state, intent);
  if (result.index < 0) return result;

  event.preventDefault();

  return result;
}

function checkboxGroupDataAttributes(state: CheckboxGroupState): PrimitiveDataAttributes {
  return mergeDataAttributes(
    dataOrientation(checkboxGroupDataOrientation(state.orientation)),
    dataDisabled(state.disabled === true),
    state.invalid === true ? { 'data-invalid': '' } : undefined,
    state.required === true ? { 'data-required': '' } : undefined,
  );
}

function checkboxGroupItemDataAttributes(
  options: CheckboxGroupItemAttributeOptions,
): PrimitiveDataAttributes {
  return mergeDataAttributes(
    checkedState(checkboxGroupItemChecked(options)),
    dataDisabled(checkboxGroupItemDisabled(options, options.itemValue)),
  );
}

function checkboxGroupItemTabIndex(options: CheckboxGroupItemAttributeOptions): number {
  if (checkboxGroupItemDisabled(options, options.itemValue)) return -1;

  const itemIndex = options.items?.findIndex((item) => item.value === options.itemValue) ?? -1;
  if (itemIndex >= 0) return itemIndex === checkboxGroupRovingIndex(options) ? 0 : -1;

  return checkboxGroupItemChecked(options) ? 0 : -1;
}

function checkboxGroupItemDisabled(
  state: CheckboxGroupState & { itemDisabled?: boolean },
  value: string,
): boolean {
  return (
    state.disabled === true ||
    state.itemDisabled === true ||
    state.items?.find((item) => item.value === value)?.disabled === true
  );
}

function checkboxGroupValueIncludesDisabled(
  state: CheckboxGroupState,
  value: readonly string[],
): boolean {
  return value.some((itemValue) => checkboxGroupItemDisabled(state, itemValue));
}

function checkboxGroupNavigationItems(
  state: CheckboxGroupState,
): readonly { disabled?: boolean }[] {
  return (state.items ?? []).map((item) => ({
    disabled: state.disabled === true || item.disabled === true,
  }));
}

function checkboxGroupDataOrientation(
  orientation: CollectionOrientation | undefined,
): 'horizontal' | 'vertical' {
  return orientation === 'horizontal' ? 'horizontal' : 'vertical';
}

function checkboxGroupDescribedBy(options: {
  descriptionId?: string;
  errorId?: string;
  invalid?: boolean;
}): string {
  return [options.descriptionId, options.invalid === true ? options.errorId : undefined]
    .filter((id): id is string => id !== undefined && id.length > 0)
    .join(' ');
}

function checkboxGroupValue(state: CheckboxGroupState): readonly string[] {
  return normalizeCheckboxGroupValue(state.value ?? []);
}

function nextCheckboxGroupValue(state: CheckboxGroupItemAttributeOptions): readonly string[] {
  const current = checkboxGroupValue(state);
  if (current.includes(state.itemValue)) {
    return current.filter((value) => value !== state.itemValue);
  }
  return [...current, state.itemValue];
}

function normalizeCheckboxGroupValue(value: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(value)]);
}

function checkboxGroupValueEqual(
  currentValue: readonly string[],
  nextValue: readonly string[],
): boolean {
  if (currentValue.length !== nextValue.length) return false;
  return currentValue.every((value, index) => value === nextValue[index]);
}
