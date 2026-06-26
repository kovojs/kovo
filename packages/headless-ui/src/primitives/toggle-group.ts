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

/**
 * Public type used by the Toggle Group primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToggleGroupType } from '@kovojs/headless-ui/toggle-group';
 *
 * const value: ToggleGroupType = {} as ToggleGroupType;
 * ```
 */
export type ToggleGroupType = 'multiple' | 'single';

/**
 * Public type used by the Toggle Group primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToggleGroupValue } from '@kovojs/headless-ui/toggle-group';
 *
 * const value: ToggleGroupValue = {} as ToggleGroupValue;
 * ```
 */
export type ToggleGroupValue = readonly string[] | string | undefined;

/**
 * Public interface used by the Toggle Group primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToggleGroupItem } from '@kovojs/headless-ui/toggle-group';
 *
 * const value: ToggleGroupItem = {} as ToggleGroupItem;
 * ```
 */
export interface ToggleGroupItem {
  disabled?: boolean;
  value: string;
}

/**
 * State snapshot consumed by the Toggle Group primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToggleGroupState } from '@kovojs/headless-ui/toggle-group';
 *
 * const value: ToggleGroupState = {} as ToggleGroupState;
 * ```
 */
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

/**
 * Options accepted by the Toggle Group primitive toggle group root attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToggleGroupRootAttributeOptions } from '@kovojs/headless-ui/toggle-group';
 *
 * const value: ToggleGroupRootAttributeOptions = {} as ToggleGroupRootAttributeOptions;
 * ```
 */
export interface ToggleGroupRootAttributeOptions extends ToggleGroupState {
  descriptionId?: string;
  id?: string;
  labelledBy?: string;
}

/**
 * Options accepted by the Toggle Group primitive toggle group item attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToggleGroupItemAttributeOptions } from '@kovojs/headless-ui/toggle-group';
 *
 * const value: ToggleGroupItemAttributeOptions = {} as ToggleGroupItemAttributeOptions;
 * ```
 */
export interface ToggleGroupItemAttributeOptions extends ToggleGroupState {
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
}

/**
 * Reason token reported by the Toggle Group primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToggleGroupChangeReason } from '@kovojs/headless-ui/toggle-group';
 *
 * const value: ToggleGroupChangeReason = {} as ToggleGroupChangeReason;
 * ```
 */
export type ToggleGroupChangeReason = 'item-click' | 'programmatic';

/**
 * Cancelable change detail emitted by the Toggle Group primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToggleGroupChangeDetail } from '@kovojs/headless-ui/toggle-group';
 *
 * const value: ToggleGroupChangeDetail = {} as ToggleGroupChangeDetail;
 * ```
 */
export type ToggleGroupChangeDetail = PrimitiveChangeDetail<
  ToggleGroupChangeReason,
  ToggleGroupValue
>;

/**
 * Options accepted by the Toggle Group primitive toggle group change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToggleGroupChangeOptions } from '@kovojs/headless-ui/toggle-group';
 *
 * const value: ToggleGroupChangeOptions = {} as ToggleGroupChangeOptions;
 * ```
 */
export interface ToggleGroupChangeOptions {
  onValueChange?: (detail: ToggleGroupChangeDetail) => void;
}

/**
 * Result returned by the Toggle Group primitive toggle group change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToggleGroupChangeResult } from '@kovojs/headless-ui/toggle-group';
 *
 * const value: ToggleGroupChangeResult = {} as ToggleGroupChangeResult;
 * ```
 */
export interface ToggleGroupChangeResult {
  changed: boolean;
  detail?: ToggleGroupChangeDetail;
  value: ToggleGroupValue;
}

/**
 * Result returned by the Toggle Group primitive toggle group move.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToggleGroupMoveResult } from '@kovojs/headless-ui/toggle-group';
 *
 * const value: ToggleGroupMoveResult = {} as ToggleGroupMoveResult;
 * ```
 */
export interface ToggleGroupMoveResult {
  index: number;
  value: string | undefined;
}

/**
 * Serializable attribute record returned by Toggle Group primitive builders.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToggleGroupPrimitiveAttributes } from '@kovojs/headless-ui/toggle-group';
 *
 * const value: ToggleGroupPrimitiveAttributes = {} as ToggleGroupPrimitiveAttributes;
 * ```
 */
export type ToggleGroupPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

/**
 * Event shape consumed by the Toggle Group primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToggleGroupItemEvent } from '@kovojs/headless-ui/toggle-group';
 *
 * const value: ToggleGroupItemEvent = {} as ToggleGroupItemEvent;
 * ```
 */
export type ToggleGroupItemEvent = Event;

/**
 * Event shape consumed by the Toggle Group primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToggleGroupKeyboardEvent } from '@kovojs/headless-ui/toggle-group';
 *
 * const value: ToggleGroupKeyboardEvent = {} as ToggleGroupKeyboardEvent;
 * ```
 */
export type ToggleGroupKeyboardEvent = Event & { readonly key: string };

/**
 * Computes the toggle group item pressed transition for the Toggle Group primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toggleGroupItemPressed } from '@kovojs/headless-ui/toggle-group';
 *
 * const input = {} as Parameters<typeof toggleGroupItemPressed>[0];
 * const result = toggleGroupItemPressed(input);
 * ```
 */
export function toggleGroupItemPressed(options: ToggleGroupItemAttributeOptions): boolean {
  if (toggleGroupType(options) === 'multiple') {
    return Array.isArray(options.value) && options.value.includes(options.itemValue);
  }

  return options.value === options.itemValue;
}

/**
 * Computes the toggle group roving index transition for the Toggle Group primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toggleGroupRovingIndex } from '@kovojs/headless-ui/toggle-group';
 *
 * const input = {} as Parameters<typeof toggleGroupRovingIndex>[0];
 * const result = toggleGroupRovingIndex(input);
 * ```
 */
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

/**
 * Builds the toggle group root attributes record for the Toggle Group primitive.
 *
 * Emits `aria-describedby`, `aria-disabled`, `aria-labelledby`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toggleGroupRootAttributes } from '@kovojs/headless-ui/toggle-group';
 *
 * const input = {} as Parameters<typeof toggleGroupRootAttributes>[0];
 * const result = toggleGroupRootAttributes(input);
 * ```
 */
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

/**
 * Builds the toggle group item attributes record for the Toggle Group primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toggleGroupItemAttributes } from '@kovojs/headless-ui/toggle-group';
 *
 * const input = {} as Parameters<typeof toggleGroupItemAttributes>[0];
 * const result = toggleGroupItemAttributes(input);
 * ```
 */
export function toggleGroupItemAttributes(
  options: ToggleGroupItemAttributeOptions,
): ToggleGroupPrimitiveAttributes {
  return Object.freeze({
    ...toggleGroupItemDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

/**
 * Builds the toggle group button attributes record for the Toggle Group primitive.
 *
 * Emits `aria-pressed`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toggleGroupButtonAttributes } from '@kovojs/headless-ui/toggle-group';
 *
 * const input = {} as Parameters<typeof toggleGroupButtonAttributes>[0];
 * const result = toggleGroupButtonAttributes(input);
 * ```
 */
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

/**
 * Computes the set toggle group value transition for the Toggle Group primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { setToggleGroupValue } from '@kovojs/headless-ui/toggle-group';
 *
 * const input = {} as Parameters<typeof setToggleGroupValue>[0];
 * const state = {} as Parameters<typeof setToggleGroupValue>[1];
 * const options = {} as Parameters<typeof setToggleGroupValue>[2];
 * const detail = {} as Parameters<typeof setToggleGroupValue>[3];
 * const result = setToggleGroupValue(input, state, options, detail);
 * ```
 */
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

/**
 * Computes the toggle group item value transition for the Toggle Group primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toggleGroupItemValue } from '@kovojs/headless-ui/toggle-group';
 *
 * const input = {} as Parameters<typeof toggleGroupItemValue>[0];
 * const state = {} as Parameters<typeof toggleGroupItemValue>[1];
 * const options = {} as Parameters<typeof toggleGroupItemValue>[2];
 * const result = toggleGroupItemValue(input, state, options);
 * ```
 */
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

/**
 * Computes the toggle group move focus transition for the Toggle Group primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toggleGroupMoveFocus } from '@kovojs/headless-ui/toggle-group';
 *
 * const input = {} as Parameters<typeof toggleGroupMoveFocus>[0];
 * const state = {} as Parameters<typeof toggleGroupMoveFocus>[1];
 * const result = toggleGroupMoveFocus(input, state);
 * ```
 */
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
 * Computes the toggle group item click transition for the Toggle Group primitive.
 *
 * @example
 * ```ts
 * import { toggleGroupItemClick } from '@kovojs/headless-ui/toggle-group';
 *
 * const input = {} as Parameters<typeof toggleGroupItemClick>[0];
 * const state = {} as Parameters<typeof toggleGroupItemClick>[1];
 * const options = {} as Parameters<typeof toggleGroupItemClick>[2];
 * const result = toggleGroupItemClick(input, state, options);
 * ```
 *
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
 * Computes the toggle group key down transition for the Toggle Group primitive.
 *
 * @example
 * ```ts
 * import { toggleGroupKeyDown } from '@kovojs/headless-ui/toggle-group';
 *
 * const input = {} as Parameters<typeof toggleGroupKeyDown>[0];
 * const state = {} as Parameters<typeof toggleGroupKeyDown>[1];
 * const result = toggleGroupKeyDown(input, state);
 * ```
 *
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
