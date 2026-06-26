import {
  dataDisabled,
  dataOrientation,
  dataState,
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

/**
 * Public type used by the Tabs primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { TabsActivationMode } from '@kovojs/headless-ui/tabs';
 *
 * const value: TabsActivationMode = {} as TabsActivationMode;
 * ```
 */
export type TabsActivationMode = 'automatic' | 'manual';

/**
 * Public interface used by the Tabs primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { TabsItem } from '@kovojs/headless-ui/tabs';
 *
 * const value: TabsItem = {} as TabsItem;
 * ```
 */
export interface TabsItem {
  disabled?: boolean;
  value: string;
}

/**
 * State snapshot consumed by the Tabs primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { TabsState } from '@kovojs/headless-ui/tabs';
 *
 * const value: TabsState = {} as TabsState;
 * ```
 */
export interface TabsState {
  activationMode?: TabsActivationMode;
  activeValue?: string;
  dir?: TextDirection;
  disabled?: boolean;
  items?: readonly TabsItem[];
  loop?: boolean;
  orientation?: CollectionOrientation;
  value?: string;
}

/**
 * Options accepted by the Tabs primitive tabs root attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { TabsRootAttributeOptions } from '@kovojs/headless-ui/tabs';
 *
 * const value: TabsRootAttributeOptions = {} as TabsRootAttributeOptions;
 * ```
 */
export interface TabsRootAttributeOptions extends TabsState {
  id?: string;
}

/**
 * Options accepted by the Tabs primitive tabs list attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { TabsListAttributeOptions } from '@kovojs/headless-ui/tabs';
 *
 * const value: TabsListAttributeOptions = {} as TabsListAttributeOptions;
 * ```
 */
export interface TabsListAttributeOptions extends TabsState {
  descriptionId?: string;
  id?: string;
  label?: string;
  labelledBy?: string;
}

/**
 * Options accepted by the Tabs primitive tabs trigger attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { TabsTriggerAttributeOptions } from '@kovojs/headless-ui/tabs';
 *
 * const value: TabsTriggerAttributeOptions = {} as TabsTriggerAttributeOptions;
 * ```
 */
export interface TabsTriggerAttributeOptions extends TabsState {
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
  panelId?: string;
}

/**
 * Options accepted by the Tabs primitive tabs panel attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { TabsPanelAttributeOptions } from '@kovojs/headless-ui/tabs';
 *
 * const value: TabsPanelAttributeOptions = {} as TabsPanelAttributeOptions;
 * ```
 */
export interface TabsPanelAttributeOptions extends TabsState {
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
  triggerId?: string;
}

/**
 * Reason token reported by the Tabs primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { TabsChangeReason } from '@kovojs/headless-ui/tabs';
 *
 * const value: TabsChangeReason = {} as TabsChangeReason;
 * ```
 */
export type TabsChangeReason = 'keyboard' | 'programmatic' | 'trigger-click';

/**
 * Cancelable change detail emitted by the Tabs primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { TabsChangeDetail } from '@kovojs/headless-ui/tabs';
 *
 * const value: TabsChangeDetail = {} as TabsChangeDetail;
 * ```
 */
export type TabsChangeDetail = PrimitiveChangeDetail<TabsChangeReason, string | undefined>;

/**
 * Options accepted by the Tabs primitive tabs change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { TabsChangeOptions } from '@kovojs/headless-ui/tabs';
 *
 * const value: TabsChangeOptions = {} as TabsChangeOptions;
 * ```
 */
export interface TabsChangeOptions {
  onValueChange?: (detail: TabsChangeDetail) => void;
}

/**
 * Result returned by the Tabs primitive tabs change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { TabsChangeResult } from '@kovojs/headless-ui/tabs';
 *
 * const value: TabsChangeResult = {} as TabsChangeResult;
 * ```
 */
export interface TabsChangeResult {
  changed: boolean;
  detail?: TabsChangeDetail;
  value: string | undefined;
}

/**
 * Result returned by the Tabs primitive tabs move.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { TabsMoveResult } from '@kovojs/headless-ui/tabs';
 *
 * const value: TabsMoveResult = {} as TabsMoveResult;
 * ```
 */
export interface TabsMoveResult {
  index: number;
  value: string | undefined;
}

/**
 * Result returned by the Tabs primitive tabs keyboard.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { TabsKeyboardResult } from '@kovojs/headless-ui/tabs';
 *
 * const value: TabsKeyboardResult = {} as TabsKeyboardResult;
 * ```
 */
export interface TabsKeyboardResult extends TabsMoveResult {
  activeValue: string | undefined;
  changed: boolean;
  detail?: TabsChangeDetail;
}

/**
 * Serializable attribute record returned by Tabs primitive builders.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { TabsPrimitiveAttributes } from '@kovojs/headless-ui/tabs';
 *
 * const value: TabsPrimitiveAttributes = {} as TabsPrimitiveAttributes;
 * ```
 */
export type TabsPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

/**
 * Event shape consumed by the Tabs primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { TabsKeyboardEvent } from '@kovojs/headless-ui/tabs';
 *
 * const value: TabsKeyboardEvent = {} as TabsKeyboardEvent;
 * ```
 */
export type TabsKeyboardEvent = Event & { readonly key: string };

/**
 * Event shape consumed by the Tabs primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { TabsTriggerEvent } from '@kovojs/headless-ui/tabs';
 *
 * const value: TabsTriggerEvent = {} as TabsTriggerEvent;
 * ```
 */
export type TabsTriggerEvent = Event;

/**
 * Computes tabs item selected for the Tabs primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { tabsItemSelected } from '@kovojs/headless-ui/tabs';
 *
 * const input = {} as Parameters<typeof tabsItemSelected>[0];
 * const result = tabsItemSelected(input);
 * ```
 */
export function tabsItemSelected(options: TabsTriggerAttributeOptions): boolean {
  return options.value === options.itemValue;
}

/**
 * Computes tabs roving index for the Tabs primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { tabsRovingIndex } from '@kovojs/headless-ui/tabs';
 *
 * const input = {} as Parameters<typeof tabsRovingIndex>[0];
 * const result = tabsRovingIndex(input);
 * ```
 */
export function tabsRovingIndex(state: TabsState): number {
  const items = state.items ?? [];
  if (items.length === 0) return -1;

  const activeIndex = items.findIndex(
    (item) => item.value === state.activeValue && !tabsItemDisabled(state, item.value),
  );
  if (activeIndex >= 0) return activeIndex;

  const selectedIndex = items.findIndex(
    (item) => item.value === state.value && !tabsItemDisabled(state, item.value),
  );
  if (selectedIndex >= 0) return selectedIndex;

  return moveCollectionIndex('first', {
    currentIndex: -1,
    items: tabsNavigationItems(state),
  });
}

/**
 * Builds the tabs root attributes record for the Tabs primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { tabsRootAttributes } from '@kovojs/headless-ui/tabs';
 *
 * const input = {} as Parameters<typeof tabsRootAttributes>[0];
 * const result = tabsRootAttributes(input);
 * ```
 */
export function tabsRootAttributes(
  options: TabsRootAttributeOptions = {},
): TabsPrimitiveAttributes {
  return Object.freeze({
    ...tabsDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

/**
 * Builds the tabs list attributes record for the Tabs primitive.
 *
 * Emits `aria-describedby`, `aria-disabled`, `aria-label`, `aria-labelledby`, `aria-orientation`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { tabsListAttributes } from '@kovojs/headless-ui/tabs';
 *
 * const input = {} as Parameters<typeof tabsListAttributes>[0];
 * const result = tabsListAttributes(input);
 * ```
 */
export function tabsListAttributes(
  options: TabsListAttributeOptions = {},
): TabsPrimitiveAttributes {
  return Object.freeze({
    ...tabsDataAttributes(options),
    role: 'tablist',
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.label === undefined ? {} : { 'aria-label': options.label }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
    ...(options.descriptionId === undefined ? {} : { 'aria-describedby': options.descriptionId }),
    ...(tabsDataOrientation(options.orientation) === 'vertical'
      ? { 'aria-orientation': 'vertical' }
      : {}),
    ...(options.disabled === true ? { 'aria-disabled': 'true' } : {}),
  });
}

/**
 * Builds the tabs trigger attributes record for the Tabs primitive.
 *
 * Emits `aria-controls`, `aria-selected`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { tabsTriggerAttributes } from '@kovojs/headless-ui/tabs';
 *
 * const input = {} as Parameters<typeof tabsTriggerAttributes>[0];
 * const result = tabsTriggerAttributes(input);
 * ```
 */
export function tabsTriggerAttributes(
  options: TabsTriggerAttributeOptions,
): TabsPrimitiveAttributes {
  const disabled = tabsItemDisabled(options, options.itemValue);
  const selected = tabsItemSelected(options);

  return Object.freeze({
    ...tabsItemDataAttributes(options),
    'aria-selected': String(selected),
    disabled,
    role: 'tab',
    tabIndex: tabsItemTabIndex(options),
    type: 'button',
    value: options.itemValue,
    ...(options.panelId === undefined ? {} : { 'aria-controls': options.panelId }),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

/**
 * Builds the tabs panel attributes record for the Tabs primitive.
 *
 * Emits `aria-labelledby`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { tabsPanelAttributes } from '@kovojs/headless-ui/tabs';
 *
 * const input = {} as Parameters<typeof tabsPanelAttributes>[0];
 * const result = tabsPanelAttributes(input);
 * ```
 */
export function tabsPanelAttributes(options: TabsPanelAttributeOptions): TabsPrimitiveAttributes {
  const selected = tabsItemSelected(options);

  return Object.freeze({
    ...tabsItemDataAttributes(options),
    hidden: !selected,
    role: 'tabpanel',
    ...(selected ? { tabIndex: 0 } : {}),
    ...(options.triggerId === undefined ? {} : { 'aria-labelledby': options.triggerId }),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

/**
 * Computes the set tabs value transition for the Tabs primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { setTabsValue } from '@kovojs/headless-ui/tabs';
 *
 * const input = {} as Parameters<typeof setTabsValue>[0];
 * const state = {} as Parameters<typeof setTabsValue>[1];
 * const options = {} as Parameters<typeof setTabsValue>[2];
 * const detail = {} as Parameters<typeof setTabsValue>[3];
 * const result = setTabsValue(input, state, options, detail);
 * ```
 */
export function setTabsValue(
  state: TabsState,
  value: string | undefined,
  reason: TabsChangeReason,
  options: TabsChangeOptions = {},
): TabsChangeResult {
  if (state.disabled || state.value === value || tabsValueDisabled(state, value)) {
    return { changed: false, value: state.value };
  }

  const detail = dispatchCancelableChange({ reason, value }, options.onValueChange);
  if (detail.defaultPrevented) {
    return { changed: false, detail, value: state.value };
  }

  return { changed: true, detail, value };
}

/**
 * Handles the tabs move focus interaction for the Tabs primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { tabsMoveFocus } from '@kovojs/headless-ui/tabs';
 *
 * const input = {} as Parameters<typeof tabsMoveFocus>[0];
 * const state = {} as Parameters<typeof tabsMoveFocus>[1];
 * const result = tabsMoveFocus(input, state);
 * ```
 */
export function tabsMoveFocus(state: TabsState, intent: NavigationIntent): TabsMoveResult {
  const items = state.items ?? [];
  if (state.disabled || items.length === 0) return { index: -1, value: state.activeValue };

  const currentIndex = tabsRovingIndex(state);
  if (currentIndex < 0) return { index: -1, value: state.activeValue };

  const index = moveCollectionIndex(intent, {
    currentIndex,
    items: tabsNavigationItems(state),
    ...(state.loop === undefined ? {} : { loop: state.loop }),
  });

  return {
    index,
    value: index < 0 ? state.activeValue : items[index]?.value,
  };
}

/**
 * Handles the tabs trigger click interaction for the Tabs primitive.
 *
 * @example
 * ```ts
 * import { tabsTriggerClick } from '@kovojs/headless-ui/tabs';
 *
 * const input = {} as Parameters<typeof tabsTriggerClick>[0];
 * const state = {} as Parameters<typeof tabsTriggerClick>[1];
 * const options = {} as Parameters<typeof tabsTriggerClick>[2];
 * const result = tabsTriggerClick(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function tabsTriggerClick(
  event: TabsTriggerEvent,
  state: TabsTriggerAttributeOptions,
  options: TabsChangeOptions = {},
): TabsChangeResult | undefined {
  if (event.defaultPrevented) return;

  const result = setTabsValue(state, state.itemValue, 'trigger-click', options);
  if (!result.changed) {
    event.preventDefault();
  }

  return result;
}

/**
 * Handles the tabs key down interaction for the Tabs primitive.
 *
 * @example
 * ```ts
 * import { tabsKeyDown } from '@kovojs/headless-ui/tabs';
 *
 * const input = {} as Parameters<typeof tabsKeyDown>[0];
 * const state = {} as Parameters<typeof tabsKeyDown>[1];
 * const options = {} as Parameters<typeof tabsKeyDown>[2];
 * const result = tabsKeyDown(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function tabsKeyDown(
  event: TabsKeyboardEvent,
  state: TabsState,
  options: TabsChangeOptions = {},
): TabsKeyboardResult | undefined {
  if (event.defaultPrevented) return;

  if (tabsActivationKey(event.key)) {
    const activeValue = state.activeValue ?? state.value;
    if (
      state.disabled === true ||
      activeValue === undefined ||
      tabsValueDisabled(state, activeValue)
    ) {
      return;
    }

    const result = setTabsValue(state, activeValue, 'keyboard', options);
    event.preventDefault();

    return {
      ...result,
      activeValue,
      index: tabsRovingIndex({ ...state, activeValue }),
    };
  }

  // SPEC.md §4.6 + rules/accessibility-conformance.md (WAI-ARIA APG): default the
  // navigation orientation to the rendered default ('horizontal', matching
  // tabsDataOrientation) instead of 'both', so a horizontal tablist responds to
  // Left/Right only and off-axis arrows fall through to the browser. Mirrors the
  // toolbar/menubar peers (`state.orientation ?? 'horizontal'`).
  const intent = navigationIntentFromKey(event.key, {
    ...(state.dir === undefined ? {} : { dir: state.dir }),
    orientation: state.orientation ?? 'horizontal',
  });
  if (intent === undefined) return;

  const next = tabsMoveFocus(state, intent);
  event.preventDefault();

  if (next.index < 0) {
    return {
      ...next,
      activeValue: state.activeValue,
      changed: false,
      value: state.value,
    };
  }

  if (tabsActivationMode(state) === 'manual') {
    return {
      ...next,
      activeValue: next.value,
      changed: false,
      value: state.value,
    };
  }

  const result = setTabsValue(state, next.value, 'keyboard', options);
  return {
    ...result,
    activeValue: next.value,
    index: next.index,
  };
}

function tabsDataAttributes(state: TabsState): PrimitiveDataAttributes {
  return mergeDataAttributes(
    dataOrientation(tabsDataOrientation(state.orientation)),
    dataDisabled(state.disabled === true),
  );
}

function tabsItemDataAttributes(options: TabsTriggerAttributeOptions): PrimitiveDataAttributes {
  return mergeDataAttributes(
    dataState(tabsItemSelected(options) ? 'active' : 'inactive'),
    dataDisabled(tabsItemDisabled(options, options.itemValue)),
  );
}

function tabsItemTabIndex(options: TabsTriggerAttributeOptions): number {
  if (tabsItemDisabled(options, options.itemValue)) return -1;

  const itemIndex = options.items?.findIndex((item) => item.value === options.itemValue) ?? -1;
  if (itemIndex >= 0) return itemIndex === tabsRovingIndex(options) ? 0 : -1;

  return tabsItemSelected(options) ? 0 : -1;
}

function tabsItemDisabled(state: TabsState & { itemDisabled?: boolean }, value: string): boolean {
  return (
    state.disabled === true ||
    state.itemDisabled === true ||
    state.items?.find((item) => item.value === value)?.disabled === true
  );
}

function tabsValueDisabled(state: TabsState, value: string | undefined): boolean {
  return value !== undefined && tabsItemDisabled(state, value);
}

function tabsNavigationItems(state: TabsState): readonly { disabled?: boolean }[] {
  return (state.items ?? []).map((item) => ({
    disabled: state.disabled === true || item.disabled === true,
  }));
}

function tabsDataOrientation(
  orientation: CollectionOrientation | undefined,
): 'horizontal' | 'vertical' {
  return orientation === 'vertical' ? 'vertical' : 'horizontal';
}

function tabsActivationMode(state: TabsState): TabsActivationMode {
  return state.activationMode === 'manual' ? 'manual' : 'automatic';
}

function tabsActivationKey(key: string): boolean {
  return key === 'Enter' || key === ' ' || key === 'Spacebar';
}
