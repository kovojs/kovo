import {
  dataDisabled,
  dataOrientation,
  dispatchCancelableChange,
  mergeDataAttributes,
  moveCollectionIndex,
  navigationIntentFromKey,
  pressedState,
  type CollectionOrientation,
  type NavigationIntent,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
  type TextDirection,
} from '../lib/index.js';

export type ToggleGroupType = 'multiple' | 'single';
export type ToggleGroupValue = readonly string[] | string | undefined;

export interface ToggleGroupItem {
  disabled?: boolean;
  value: string;
}

export interface ToggleGroupState {
  activeValue?: string;
  collapsible?: boolean;
  dir?: TextDirection;
  disabled?: boolean;
  items?: readonly ToggleGroupItem[];
  loop?: boolean;
  orientation?: CollectionOrientation;
  type?: ToggleGroupType;
  value?: ToggleGroupValue;
}

export interface ToggleGroupRootAttributeOptions extends ToggleGroupState {
  descriptionId?: string;
  id?: string;
  labelledBy?: string;
}

export interface ToggleGroupItemAttributeOptions extends ToggleGroupState {
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
}

export type ToggleGroupChangeReason = 'item-click' | 'programmatic';

export type ToggleGroupChangeDetail = PrimitiveChangeDetail<
  ToggleGroupChangeReason,
  ToggleGroupValue
>;

export interface ToggleGroupChangeOptions {
  onValueChange?: (detail: ToggleGroupChangeDetail) => void;
}

export interface ToggleGroupChangeResult {
  changed: boolean;
  detail?: ToggleGroupChangeDetail;
  value: ToggleGroupValue;
}

export interface ToggleGroupMoveResult {
  index: number;
  value: string | undefined;
}

export type ToggleGroupPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

export type ToggleGroupItemEvent = Event;
export type ToggleGroupKeyboardEvent = Event & { readonly key: string };

export function toggleGroupItemPressed(options: ToggleGroupItemAttributeOptions): boolean {
  if (toggleGroupType(options) === 'multiple') {
    return Array.isArray(options.value) && options.value.includes(options.itemValue);
  }

  return options.value === options.itemValue;
}

export function toggleGroupRovingIndex(state: ToggleGroupState): number {
  const items = state.items ?? [];
  if (items.length === 0) return -1;

  const activeIndex = items.findIndex(
    (item) => item.value === state.activeValue && !toggleGroupItemDisabled(state, item.value),
  );
  if (activeIndex >= 0) return activeIndex;

  const pressedIndex = items.findIndex(
    (item) =>
      toggleGroupItemPressed({ ...state, itemValue: item.value }) &&
      !toggleGroupItemDisabled(state, item.value),
  );
  if (pressedIndex >= 0) {
    return pressedIndex;
  }

  return moveCollectionIndex('first', {
    currentIndex: -1,
    items: toggleGroupNavigationItems(state),
  });
}

export function toggleGroupRootAttributes(
  options: ToggleGroupRootAttributeOptions = {},
): ToggleGroupPrimitiveAttributes {
  return Object.freeze({
    ...toggleGroupDataAttributes(options),
    role: 'group',
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
    ...(options.descriptionId === undefined ? {} : { 'aria-describedby': options.descriptionId }),
    ...(options.disabled === true ? { 'aria-disabled': 'true' } : {}),
  });
}

export function toggleGroupItemAttributes(
  options: ToggleGroupItemAttributeOptions,
): ToggleGroupPrimitiveAttributes {
  return Object.freeze({
    ...toggleGroupItemDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

export function toggleGroupButtonAttributes(
  options: ToggleGroupItemAttributeOptions,
): ToggleGroupPrimitiveAttributes {
  const disabled = toggleGroupItemDisabled(options, options.itemValue);
  const pressed = toggleGroupItemPressed(options);

  return Object.freeze({
    ...toggleGroupItemDataAttributes(options),
    'aria-pressed': String(pressed),
    disabled,
    tabIndex: toggleGroupItemTabIndex(options),
    type: 'button',
    value: options.itemValue,
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

export function setToggleGroupValue(
  state: ToggleGroupState,
  value: ToggleGroupValue,
  reason: ToggleGroupChangeReason,
  options: ToggleGroupChangeOptions = {},
): ToggleGroupChangeResult {
  if (state.disabled) {
    return { changed: false, value: state.value };
  }

  const normalizedValue = normalizeToggleGroupValue(state, value);
  if (
    toggleGroupValueEqual(state.value, normalizedValue) ||
    toggleGroupValueIncludesDisabled(state, normalizedValue)
  ) {
    return { changed: false, value: state.value };
  }

  const detail = dispatchCancelableChange(
    { reason, value: normalizedValue },
    options.onValueChange,
  );
  if (detail.defaultPrevented) {
    return { changed: false, detail, value: state.value };
  }

  return { changed: true, detail, value: normalizedValue };
}

export function toggleGroupItemValue(
  state: ToggleGroupItemAttributeOptions,
  reason: ToggleGroupChangeReason,
  options: ToggleGroupChangeOptions = {},
): ToggleGroupChangeResult {
  if (toggleGroupItemDisabled(state, state.itemValue)) {
    return { changed: false, value: state.value };
  }

  return setToggleGroupValue(state, nextToggleGroupValue(state), reason, options);
}

export function toggleGroupMoveFocus(
  state: ToggleGroupState,
  intent: NavigationIntent,
): ToggleGroupMoveResult {
  const items = state.items ?? [];
  if (state.disabled || items.length === 0) return { index: -1, value: state.activeValue };

  const currentIndex = toggleGroupRovingIndex(state);
  if (currentIndex < 0) return { index: -1, value: state.activeValue };

  const index = moveCollectionIndex(intent, {
    currentIndex,
    items: toggleGroupNavigationItems(state),
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
export function toggleGroupItemClick(
  event: ToggleGroupItemEvent,
  state: ToggleGroupItemAttributeOptions,
  options: ToggleGroupChangeOptions = {},
): ToggleGroupChangeResult | undefined {
  if (event.defaultPrevented) return;

  const result = toggleGroupItemValue(state, 'item-click', options);
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
export function toggleGroupKeyDown(
  event: ToggleGroupKeyboardEvent,
  state: ToggleGroupState,
): ToggleGroupMoveResult | undefined {
  if (event.defaultPrevented) return;

  // SPEC.md §4.6 + rules/accessibility-conformance.md (WAI-ARIA APG): default the
  // navigation orientation to the rendered default ('horizontal', matching
  // toggleGroupDataOrientation) instead of 'both', so a horizontal group responds to
  // Left/Right only and off-axis arrows fall through to the browser. Mirrors the
  // toolbar/menubar peers (`state.orientation ?? 'horizontal'`).
  const intent = navigationIntentFromKey(event.key, {
    ...(state.dir === undefined ? {} : { dir: state.dir }),
    orientation: state.orientation ?? 'horizontal',
  });
  if (intent === undefined) return;

  const result = toggleGroupMoveFocus(state, intent);
  if (result.index < 0) return;

  event.preventDefault();

  return result;
}

function toggleGroupDataAttributes(state: ToggleGroupState): PrimitiveDataAttributes {
  return mergeDataAttributes(
    dataOrientation(toggleGroupDataOrientation(state.orientation)),
    dataDisabled(state.disabled === true),
  );
}

function toggleGroupItemDataAttributes(
  options: ToggleGroupItemAttributeOptions,
): PrimitiveDataAttributes {
  return mergeDataAttributes(
    pressedState(toggleGroupItemPressed(options)),
    dataDisabled(toggleGroupItemDisabled(options, options.itemValue)),
  );
}

function toggleGroupItemTabIndex(options: ToggleGroupItemAttributeOptions): number {
  if (toggleGroupItemDisabled(options, options.itemValue)) return -1;

  const itemIndex = options.items?.findIndex((item) => item.value === options.itemValue) ?? -1;
  if (itemIndex >= 0) return itemIndex === toggleGroupRovingIndex(options) ? 0 : -1;

  return 0;
}

function toggleGroupItemDisabled(
  state: ToggleGroupState & { itemDisabled?: boolean },
  value: string,
): boolean {
  return (
    state.disabled === true ||
    state.itemDisabled === true ||
    state.items?.find((item) => item.value === value)?.disabled === true
  );
}

function toggleGroupValueIncludesDisabled(
  state: ToggleGroupState,
  value: ToggleGroupValue,
): boolean {
  if (value === undefined) return false;

  const values = Array.isArray(value) ? value : [value];
  return values.some((itemValue) => toggleGroupItemDisabled(state, itemValue));
}

function toggleGroupNavigationItems(state: ToggleGroupState): readonly { disabled?: boolean }[] {
  return (state.items ?? []).map((item) => ({
    disabled: state.disabled === true || item.disabled === true,
  }));
}

function toggleGroupDataOrientation(
  orientation: CollectionOrientation | undefined,
): 'horizontal' | 'vertical' {
  return orientation === 'vertical' ? 'vertical' : 'horizontal';
}

function toggleGroupType(state: ToggleGroupState): ToggleGroupType {
  return state.type === 'multiple' ? 'multiple' : 'single';
}

function nextToggleGroupValue(state: ToggleGroupItemAttributeOptions): ToggleGroupValue {
  if (toggleGroupType(state) === 'multiple') {
    const current = Array.isArray(state.value) ? state.value : [];
    if (current.includes(state.itemValue)) {
      return current.filter((value) => value !== state.itemValue);
    }
    return [...current, state.itemValue];
  }

  if (state.value === state.itemValue) {
    return state.collapsible === true ? undefined : state.value;
  }

  return state.itemValue;
}

function normalizeToggleGroupValue(
  state: ToggleGroupState,
  value: ToggleGroupValue,
): ToggleGroupValue {
  if (toggleGroupType(state) === 'multiple') {
    return Array.isArray(value) ? Object.freeze([...new Set(value)]) : [];
  }

  return Array.isArray(value) ? value[0] : value;
}

function toggleGroupValueEqual(left: ToggleGroupValue, right: ToggleGroupValue): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    const leftValues = Array.isArray(left) ? left : left === undefined ? [] : [left];
    const rightValues = Array.isArray(right) ? right : right === undefined ? [] : [right];
    return (
      leftValues.length === rightValues.length &&
      leftValues.every((value, index) => value === rightValues[index])
    );
  }

  return left === right;
}
