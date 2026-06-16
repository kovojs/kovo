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

export type TabsActivationMode = 'automatic' | 'manual';

export interface TabsItem {
  disabled?: boolean;
  value: string;
}

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

export interface TabsRootAttributeOptions extends TabsState {
  id?: string;
}

export interface TabsListAttributeOptions extends TabsState {
  descriptionId?: string;
  id?: string;
  label?: string;
  labelledBy?: string;
}

export interface TabsTriggerAttributeOptions extends TabsState {
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
  panelId?: string;
}

export interface TabsPanelAttributeOptions extends TabsState {
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
  triggerId?: string;
}

export type TabsChangeReason = 'keyboard' | 'programmatic' | 'trigger-click';

export type TabsChangeDetail = PrimitiveChangeDetail<TabsChangeReason, string | undefined>;

export interface TabsChangeOptions {
  onValueChange?: (detail: TabsChangeDetail) => void;
}

export interface TabsChangeResult {
  changed: boolean;
  detail?: TabsChangeDetail;
  value: string | undefined;
}

export interface TabsMoveResult {
  index: number;
  value: string | undefined;
}

export interface TabsKeyboardResult extends TabsMoveResult {
  activeValue: string | undefined;
  changed: boolean;
  detail?: TabsChangeDetail;
}

export type TabsPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

export type TabsKeyboardEvent = Event & { readonly key: string };
export type TabsTriggerEvent = Event;

export function tabsItemSelected(options: TabsTriggerAttributeOptions): boolean {
  return options.value === options.itemValue;
}

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

export function tabsRootAttributes(
  options: TabsRootAttributeOptions = {},
): TabsPrimitiveAttributes {
  return Object.freeze({
    ...tabsDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

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

  const intent = navigationIntentFromKey(event.key, {
    ...(state.dir === undefined ? {} : { dir: state.dir }),
    ...(state.orientation === undefined ? {} : { orientation: state.orientation }),
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
