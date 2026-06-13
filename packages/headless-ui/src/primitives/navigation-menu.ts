import {
  dataDisabled,
  dataOrientation,
  dataState,
  dispatchCancelableChange,
  findTypeaheadMatch,
  mergeDataAttributes,
  moveCollectionIndex,
  navigationIntentFromKey,
  nextTypeaheadState,
  openState,
  type CollectionOrientation,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
  type TextDirection,
  type TypeaheadState,
} from '../lib/index.js';

export interface NavigationMenuItem {
  disabled?: boolean;
  hasContent?: boolean;
  label?: string;
  textValue?: string;
  value: string;
}

export interface NavigationMenuState {
  activeValue?: string;
  dir?: TextDirection;
  disabled?: boolean;
  items?: readonly NavigationMenuItem[];
  loop?: boolean;
  openValue?: string;
  orientation?: CollectionOrientation;
}

export interface NavigationMenuRootAttributeOptions extends NavigationMenuState {
  descriptionId?: string;
  id?: string;
  label?: string;
  labelledBy?: string;
}

export interface NavigationMenuListAttributeOptions extends NavigationMenuState {
  id?: string;
  labelledBy?: string;
}

export interface NavigationMenuItemAttributeOptions extends NavigationMenuState {
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
}

export interface NavigationMenuTriggerAttributeOptions extends NavigationMenuState {
  contentId?: string;
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemValue: string;
}

export interface NavigationMenuContentAttributeOptions extends NavigationMenuState {
  id?: string;
  labelledBy?: string;
  value: string;
}

export interface NavigationMenuLinkAttributeOptions extends NavigationMenuState {
  href?: string;
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemValue: string;
}

export interface NavigationMenuViewportAttributeOptions extends NavigationMenuState {
  id?: string;
}

export interface NavigationMenuIndicatorAttributeOptions extends NavigationMenuState {
  id?: string;
}

export type NavigationMenuOpenChangeReason =
  | 'escape-key'
  | 'link-select'
  | 'programmatic'
  | 'trigger-click'
  | 'trigger-focus'
  | 'trigger-keyboard'
  | 'trigger-pointer-enter';

export type NavigationMenuSelectReason = 'link-click' | 'programmatic';

export type NavigationMenuOpenChangeDetail = PrimitiveChangeDetail<
  NavigationMenuOpenChangeReason,
  string | undefined
>;

export type NavigationMenuSelectDetail = PrimitiveChangeDetail<NavigationMenuSelectReason, string>;

export interface NavigationMenuChangeOptions {
  onOpenChange?: (detail: NavigationMenuOpenChangeDetail) => void;
  onSelect?: (detail: NavigationMenuSelectDetail) => void;
}

export interface NavigationMenuOpenChangeResult {
  changed: boolean;
  detail?: NavigationMenuOpenChangeDetail;
  openValue: string | undefined;
}

export interface NavigationMenuSelectResult {
  detail?: NavigationMenuSelectDetail;
  open: NavigationMenuOpenChangeResult;
  selected: boolean;
  value: string;
}

export interface NavigationMenuMoveOptions {
  loop?: boolean;
}

export interface NavigationMenuMoveResult {
  activeIndex: number;
  activeValue: string | undefined;
}

export interface NavigationMenuTypeaheadOptions extends NavigationMenuMoveOptions {
  currentValue?: string;
  now: number;
  state?: TypeaheadState;
  timeoutMs?: number;
}

export interface NavigationMenuTypeaheadResult extends NavigationMenuMoveResult {
  state: TypeaheadState;
}

export type NavigationMenuPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

export type NavigationMenuTriggerEvent = Event;
export type NavigationMenuLinkEvent = Event;
export type NavigationMenuKeyboardEvent = Event & { readonly key: string };

export function navigationMenuRootAttributes(
  options: NavigationMenuRootAttributeOptions = {},
): NavigationMenuPrimitiveAttributes {
  return Object.freeze({
    ...navigationMenuDataAttributes(options),
    role: 'navigation',
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.label === undefined ? {} : { 'aria-label': options.label }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
    ...(options.descriptionId === undefined ? {} : { 'aria-describedby': options.descriptionId }),
    ...(navigationMenuDataOrientation(options.orientation) === 'vertical'
      ? { 'aria-orientation': 'vertical' }
      : {}),
    ...(options.disabled === true ? { 'aria-disabled': 'true' } : {}),
  });
}

export function navigationMenuListAttributes(
  options: NavigationMenuListAttributeOptions = {},
): NavigationMenuPrimitiveAttributes {
  return Object.freeze({
    ...navigationMenuDataAttributes(options),
    role: 'list',
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
  });
}

export function navigationMenuItemAttributes(
  options: NavigationMenuItemAttributeOptions,
): NavigationMenuPrimitiveAttributes {
  return Object.freeze({
    ...navigationMenuItemDataAttributes(options),
    role: 'listitem',
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

export function navigationMenuTriggerAttributes(
  options: NavigationMenuTriggerAttributeOptions,
): NavigationMenuPrimitiveAttributes {
  const disabled = navigationMenuItemDisabled(options, options.itemValue);
  const open = navigationMenuItemOpen(options);
  const enabledContentId = disabled ? undefined : options.contentId;

  return Object.freeze({
    ...navigationMenuTriggerDataAttributes(options),
    'aria-expanded': String(open),
    'aria-haspopup': 'true',
    disabled,
    tabIndex: navigationMenuItemHighlighted(options) && !disabled ? 0 : -1,
    type: 'button',
    value: options.itemValue,
    ...(enabledContentId === undefined ? {} : { 'aria-controls': enabledContentId }),
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.itemLabel === undefined ? {} : { label: options.itemLabel }),
  });
}

export function navigationMenuContentAttributes(
  options: NavigationMenuContentAttributeOptions,
): NavigationMenuPrimitiveAttributes {
  const open = options.openValue === options.value;

  return Object.freeze({
    ...mergeDataAttributes(openState(open), dataDisabled(options.disabled === true)),
    role: 'group',
    tabIndex: -1,
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
    ...(open ? {} : { hidden: true }),
  });
}

export function navigationMenuLinkAttributes(
  options: NavigationMenuLinkAttributeOptions,
): NavigationMenuPrimitiveAttributes {
  const disabled = navigationMenuItemDisabled(options, options.itemValue);

  return Object.freeze({
    ...navigationMenuItemDataAttributes(options),
    tabIndex: navigationMenuItemHighlighted(options) && !disabled ? 0 : -1,
    value: options.itemValue,
    ...(disabled ? { 'aria-disabled': 'true' } : {}),
    ...(disabled || options.href === undefined ? {} : { href: options.href }),
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.itemLabel === undefined ? {} : { label: options.itemLabel }),
  });
}

export function navigationMenuViewportAttributes(
  options: NavigationMenuViewportAttributeOptions = {},
): NavigationMenuPrimitiveAttributes {
  const open = options.openValue !== undefined;

  return Object.freeze({
    ...mergeDataAttributes(openState(open), dataDisabled(options.disabled === true)),
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(open ? {} : { hidden: true }),
  });
}

export function navigationMenuIndicatorAttributes(
  options: NavigationMenuIndicatorAttributeOptions = {},
): NavigationMenuPrimitiveAttributes {
  const open = options.openValue !== undefined;

  return Object.freeze({
    ...mergeDataAttributes(openState(open), dataDisabled(options.disabled === true)),
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(open ? {} : { hidden: true }),
  });
}

export function navigationMenuItemHighlighted(
  options: NavigationMenuItemAttributeOptions,
): boolean {
  return options.activeValue === options.itemValue;
}

export function navigationMenuItemOpen(options: NavigationMenuItemAttributeOptions): boolean {
  return options.openValue === options.itemValue;
}

export function setNavigationMenuOpenValue(
  state: NavigationMenuState,
  openValue: string | undefined,
  reason: NavigationMenuOpenChangeReason,
  options: NavigationMenuChangeOptions = {},
): NavigationMenuOpenChangeResult {
  if (
    state.disabled ||
    state.openValue === openValue ||
    navigationMenuItemDisabled(state, openValue)
  ) {
    return { changed: false, openValue: state.openValue };
  }

  const detail = dispatchCancelableChange({ reason, value: openValue }, options.onOpenChange);
  if (detail.defaultPrevented) {
    return { changed: false, detail, openValue: state.openValue };
  }

  return { changed: true, detail, openValue };
}

export function toggleNavigationMenuOpenValue(
  state: NavigationMenuState,
  value: string,
  reason: NavigationMenuOpenChangeReason,
  options: NavigationMenuChangeOptions = {},
): NavigationMenuOpenChangeResult {
  return setNavigationMenuOpenValue(
    state,
    state.openValue === value ? undefined : value,
    reason,
    options,
  );
}

export function selectNavigationMenuLink(
  state: NavigationMenuState,
  value: string,
  reason: NavigationMenuSelectReason,
  options: NavigationMenuChangeOptions = {},
): NavigationMenuSelectResult {
  if (state.disabled || navigationMenuItemDisabled(state, value)) {
    return {
      open: { changed: false, openValue: state.openValue },
      selected: false,
      value,
    };
  }

  const detail = dispatchCancelableChange({ reason, value }, options.onSelect);
  if (detail.defaultPrevented) {
    return {
      detail,
      open: { changed: false, openValue: state.openValue },
      selected: false,
      value,
    };
  }

  return {
    detail,
    open: setNavigationMenuOpenValue(state, undefined, 'link-select', options),
    selected: true,
    value,
  };
}

export function navigationMenuMove(
  state: NavigationMenuState,
  key: string,
  options: NavigationMenuMoveOptions = {},
): NavigationMenuMoveResult | undefined {
  if (state.disabled) return undefined;

  const intent = navigationIntentFromKey(key, {
    ...(state.dir === undefined ? {} : { dir: state.dir }),
    orientation: state.orientation ?? 'horizontal',
  });
  if (intent === undefined) return undefined;

  const items = state.items ?? [];
  const currentIndex = items.findIndex((item) => item.value === state.activeValue);
  const loop = options.loop ?? state.loop;
  const activeIndex = moveCollectionIndex(intent, {
    currentIndex,
    items,
    ...(loop === undefined ? {} : { loop }),
  });

  return {
    activeIndex,
    activeValue: activeIndex < 0 ? undefined : items[activeIndex]?.value,
  };
}

export function navigationMenuTypeahead(
  state: NavigationMenuState,
  key: string,
  options: NavigationMenuTypeaheadOptions,
): NavigationMenuTypeaheadResult {
  const nextState = nextNavigationMenuTypeaheadState(state, key, options);
  if (state.disabled || nextState.buffer === '') {
    return {
      activeIndex: -1,
      activeValue: options.currentValue ?? state.activeValue,
      state: nextState,
    };
  }

  const collection = state.items ?? [];
  const items = collection.map((item) => ({
    disabled: state.disabled === true || item.disabled === true,
    textValue: item.textValue ?? item.label ?? item.value,
  }));
  const currentIndex = collection.findIndex(
    (item) => item.value === (options.currentValue ?? state.activeValue),
  );
  const loop = options.loop ?? state.loop;
  const activeIndex = findTypeaheadMatch({
    currentIndex,
    items,
    ...(loop === undefined ? {} : { loop }),
    search: nextState.buffer,
  });

  return {
    activeIndex,
    activeValue:
      activeIndex < 0
        ? (options.currentValue ?? state.activeValue)
        : collection[activeIndex]?.value,
    state: nextState,
  };
}

/**
 * @jisoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function navigationMenuTriggerClick(
  event: NavigationMenuTriggerEvent,
  state: NavigationMenuTriggerAttributeOptions,
  options: NavigationMenuChangeOptions = {},
): NavigationMenuOpenChangeResult | undefined {
  if (event.defaultPrevented) return;

  const result = toggleNavigationMenuOpenValue(state, state.itemValue, 'trigger-click', options);
  if (!result.changed) {
    event.preventDefault();
  }

  return result;
}

/**
 * @jisoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function navigationMenuTriggerPointerEnter(
  event: NavigationMenuTriggerEvent,
  state: NavigationMenuTriggerAttributeOptions,
  options: NavigationMenuChangeOptions = {},
): NavigationMenuOpenChangeResult | undefined {
  if (event.defaultPrevented) return;
  if (!navigationMenuItemHasContent(state)) return;

  return setNavigationMenuOpenValue(state, state.itemValue, 'trigger-pointer-enter', options);
}

/**
 * @jisoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function navigationMenuTriggerFocus(
  event: NavigationMenuTriggerEvent,
  state: NavigationMenuTriggerAttributeOptions,
  options: NavigationMenuChangeOptions = {},
): NavigationMenuOpenChangeResult | undefined {
  if (event.defaultPrevented) return;
  if (!navigationMenuItemHasContent(state)) return;

  return setNavigationMenuOpenValue(state, state.itemValue, 'trigger-focus', options);
}

/**
 * @jisoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function navigationMenuLinkClick(
  event: NavigationMenuLinkEvent,
  state: NavigationMenuLinkAttributeOptions,
  options: NavigationMenuChangeOptions = {},
): NavigationMenuSelectResult | undefined {
  if (event.defaultPrevented) return;

  const result = selectNavigationMenuLink(state, state.itemValue, 'link-click', options);
  if (!result.selected) {
    event.preventDefault();
  }

  return result;
}

/**
 * @jisoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function navigationMenuKeyDown(
  event: NavigationMenuKeyboardEvent,
  state: NavigationMenuState,
  options: NavigationMenuChangeOptions = {},
): NavigationMenuOpenChangeResult | undefined {
  if (event.defaultPrevented) return;

  if (event.key === 'Escape') {
    const result = setNavigationMenuOpenValue(state, undefined, 'escape-key', options);
    if (result.changed) event.preventDefault();
    return result;
  }

  if (
    state.activeValue !== undefined &&
    navigationMenuKeyboardOpensContent(event.key) &&
    navigationMenuItemHasContent({ ...state, itemValue: state.activeValue })
  ) {
    const result = setNavigationMenuOpenValue(
      state,
      state.activeValue,
      'trigger-keyboard',
      options,
    );
    if (result.changed) event.preventDefault();
    return result;
  }

  return undefined;
}

function navigationMenuKeyboardOpensContent(key: string): boolean {
  return (
    key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ' || key === 'Spacebar'
  );
}

function navigationMenuDataAttributes(state: NavigationMenuState): PrimitiveDataAttributes {
  return mergeDataAttributes(
    openState(state.openValue !== undefined),
    dataOrientation(navigationMenuDataOrientation(state.orientation)),
    dataDisabled(state.disabled === true),
  );
}

function navigationMenuItemDataAttributes(
  options: NavigationMenuItemAttributeOptions,
): PrimitiveDataAttributes {
  return mergeDataAttributes(
    dataState(navigationMenuItemHighlighted(options) ? 'active' : 'inactive'),
    dataDisabled(navigationMenuItemDisabled(options, options.itemValue)),
    navigationMenuItemHighlighted(options) ? { 'data-highlighted': '' } : undefined,
  );
}

function navigationMenuTriggerDataAttributes(
  options: NavigationMenuTriggerAttributeOptions,
): PrimitiveDataAttributes {
  return mergeDataAttributes(
    openState(navigationMenuItemOpen(options)),
    dataDisabled(navigationMenuItemDisabled(options, options.itemValue)),
    navigationMenuItemHighlighted(options) ? { 'data-highlighted': '' } : undefined,
  );
}

function navigationMenuItemDisabled(
  state: NavigationMenuState & { itemDisabled?: boolean },
  value: string | undefined,
): boolean {
  if (value === undefined) return false;
  const item = state.items?.find((candidate) => candidate.value === value);

  return state.disabled === true || state.itemDisabled === true || item?.disabled === true;
}

function navigationMenuItemHasContent(
  options: NavigationMenuState & { contentId?: string; itemValue: string },
): boolean {
  return (
    options.contentId !== undefined ||
    options.items?.find((item) => item.value === options.itemValue)?.hasContent === true
  );
}

function nextNavigationMenuTypeaheadState(
  state: NavigationMenuState,
  key: string,
  options: NavigationMenuTypeaheadOptions,
): TypeaheadState {
  return nextTypeaheadState(
    state.disabled ? undefined : options.state,
    key,
    options.now,
    options.timeoutMs,
  );
}

function navigationMenuDataOrientation(
  orientation: CollectionOrientation | undefined,
): 'horizontal' | 'vertical' {
  return orientation === 'vertical' ? 'vertical' : 'horizontal';
}
