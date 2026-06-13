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

export interface MenubarItem {
  disabled?: boolean;
  hasPopup?: boolean;
  label?: string;
  parentValue?: string;
  textValue?: string;
  value: string;
}

export interface MenubarState {
  activeValue?: string;
  dir?: TextDirection;
  disabled?: boolean;
  items?: readonly MenubarItem[];
  loop?: boolean;
  openValue?: string;
  orientation?: CollectionOrientation;
}

export interface MenubarRootAttributeOptions extends MenubarState {
  descriptionId?: string;
  id?: string;
  label?: string;
  labelledBy?: string;
}

export interface MenubarItemAttributeOptions extends MenubarState {
  contentId?: string;
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemParentValue?: string;
  itemValue: string;
}

export interface MenubarSubmenuAttributeOptions extends MenubarState {
  id?: string;
  labelledBy?: string;
  value: string;
}

export interface MenubarGroupAttributeOptions extends MenubarState {
  id?: string;
  labelledBy?: string;
}

export interface MenubarSeparatorAttributeOptions {
  id?: string;
}

export type MenubarOpenChangeReason =
  | 'escape-key'
  | 'item-click'
  | 'item-keyboard'
  | 'item-pointer-enter'
  | 'item-select'
  | 'programmatic';

export type MenubarSelectReason = 'item-click' | 'keyboard' | 'programmatic';

export type MenubarOpenChangeDetail = PrimitiveChangeDetail<
  MenubarOpenChangeReason,
  string | undefined
>;

export type MenubarSelectDetail = PrimitiveChangeDetail<MenubarSelectReason, string>;

export interface MenubarChangeOptions {
  onOpenChange?: (detail: MenubarOpenChangeDetail) => void;
  onSelect?: (detail: MenubarSelectDetail) => void;
}

export interface MenubarOpenChangeResult {
  changed: boolean;
  detail?: MenubarOpenChangeDetail;
  openValue: string | undefined;
}

export interface MenubarSelectResult {
  detail?: MenubarSelectDetail;
  open: MenubarOpenChangeResult;
  selected: boolean;
  value: string;
}

export interface MenubarMoveOptions {
  loop?: boolean;
  parentValue?: string;
}

export interface MenubarMoveResult {
  activeIndex: number;
  activeValue: string | undefined;
  parentValue: string | undefined;
}

export interface MenubarTypeaheadOptions extends MenubarMoveOptions {
  currentValue?: string;
  now: number;
  state?: TypeaheadState;
  timeoutMs?: number;
}

export interface MenubarTypeaheadResult extends MenubarMoveResult {
  state: TypeaheadState;
}

export type MenubarPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

export type MenubarItemEvent = Event;
export type MenubarKeyboardEvent = Event & { readonly key: string };

export function menubarRootAttributes(
  options: MenubarRootAttributeOptions = {},
): MenubarPrimitiveAttributes {
  return Object.freeze({
    ...menubarDataAttributes(options),
    role: 'menubar',
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.label === undefined ? {} : { 'aria-label': options.label }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
    ...(options.descriptionId === undefined ? {} : { 'aria-describedby': options.descriptionId }),
    ...(menubarDataOrientation(options.orientation) === 'vertical'
      ? { 'aria-orientation': 'vertical' }
      : {}),
    ...(options.disabled === true ? { 'aria-disabled': 'true' } : {}),
  });
}

export function menubarItemAttributes(
  options: MenubarItemAttributeOptions,
): MenubarPrimitiveAttributes {
  const disabled = menubarItemDisabled(options, options.itemValue, options.itemParentValue);
  const highlighted = menubarItemHighlighted(options);
  const popup = menubarItemHasPopup(options);
  const enabledContentId = disabled ? undefined : options.contentId;

  return Object.freeze({
    ...menubarItemDataAttributes(options),
    role: 'menuitem',
    tabIndex: highlighted && !disabled ? 0 : -1,
    value: options.itemValue,
    ...(popup
      ? { 'aria-haspopup': 'menu', 'aria-expanded': String(menubarItemOpen(options)) }
      : {}),
    ...(enabledContentId === undefined ? {} : { 'aria-controls': enabledContentId }),
    ...(disabled ? { 'aria-disabled': 'true' } : {}),
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.itemLabel === undefined ? {} : { label: options.itemLabel }),
  });
}

export function menubarSubmenuAttributes(
  options: MenubarSubmenuAttributeOptions,
): MenubarPrimitiveAttributes {
  const open = options.openValue === options.value;

  return Object.freeze({
    ...mergeDataAttributes(openState(open), dataDisabled(options.disabled === true)),
    role: 'menu',
    tabIndex: -1,
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
    ...(open ? {} : { hidden: true }),
  });
}

export function menubarGroupAttributes(
  options: MenubarGroupAttributeOptions = {},
): MenubarPrimitiveAttributes {
  return Object.freeze({
    ...menubarDataAttributes(options),
    role: 'group',
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
  });
}

export function menubarSeparatorAttributes(
  options: MenubarSeparatorAttributeOptions = {},
): MenubarPrimitiveAttributes {
  return Object.freeze({
    role: 'separator',
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

export function menubarItemHighlighted(options: MenubarItemAttributeOptions): boolean {
  return options.activeValue === options.itemValue;
}

export function menubarItemOpen(options: MenubarItemAttributeOptions): boolean {
  return options.openValue === options.itemValue;
}

export function setMenubarOpenValue(
  state: MenubarState,
  openValue: string | undefined,
  reason: MenubarOpenChangeReason,
  options: MenubarChangeOptions = {},
): MenubarOpenChangeResult {
  if (state.disabled || state.openValue === openValue || menubarItemDisabled(state, openValue)) {
    return { changed: false, openValue: state.openValue };
  }

  const detail = dispatchCancelableChange({ reason, value: openValue }, options.onOpenChange);
  if (detail.defaultPrevented) {
    return { changed: false, detail, openValue: state.openValue };
  }

  return { changed: true, detail, openValue };
}

export function toggleMenubarOpenValue(
  state: MenubarState,
  value: string,
  reason: MenubarOpenChangeReason,
  options: MenubarChangeOptions = {},
): MenubarOpenChangeResult {
  return setMenubarOpenValue(state, state.openValue === value ? undefined : value, reason, options);
}

export function selectMenubarItem(
  state: MenubarState,
  value: string,
  reason: MenubarSelectReason,
  options: MenubarChangeOptions = {},
): MenubarSelectResult {
  if (state.disabled || menubarItemDisabled(state, value)) {
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
    open: setMenubarOpenValue(state, undefined, 'item-select', options),
    selected: true,
    value,
  };
}

export function menubarMove(
  state: MenubarState,
  key: string,
  options: MenubarMoveOptions = {},
): MenubarMoveResult | undefined {
  if (state.disabled) return undefined;

  const parentValue = options.parentValue;
  const intent = navigationIntentFromKey(key, {
    ...(state.dir === undefined ? {} : { dir: state.dir }),
    orientation: parentValue === undefined ? (state.orientation ?? 'horizontal') : 'vertical',
  });
  if (intent === undefined) return undefined;

  const items = menubarItemsForParent(state, parentValue);
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
    parentValue,
  };
}

export function menubarTypeahead(
  state: MenubarState,
  key: string,
  options: MenubarTypeaheadOptions,
): MenubarTypeaheadResult {
  const parentValue = options.parentValue;
  const nextState = nextMenubarTypeaheadState(state, key, options);
  if (state.disabled || nextState.buffer === '') {
    return {
      activeIndex: -1,
      activeValue: options.currentValue ?? state.activeValue,
      parentValue,
      state: nextState,
    };
  }

  const collection = menubarItemsForParent(state, parentValue);
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
    parentValue,
    state: nextState,
  };
}

/**
 * @jisoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function menubarSubmenuTriggerClick(
  event: MenubarItemEvent,
  state: MenubarItemAttributeOptions,
  options: MenubarChangeOptions = {},
): MenubarOpenChangeResult | undefined {
  if (event.defaultPrevented) return;

  const result = toggleMenubarOpenValue(state, state.itemValue, 'item-click', options);
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
export function menubarItemPointerEnter(
  event: MenubarItemEvent,
  state: MenubarItemAttributeOptions,
  options: MenubarChangeOptions = {},
): MenubarOpenChangeResult | undefined {
  if (event.defaultPrevented) return;
  if (state.openValue === undefined || !menubarItemHasPopup(state)) return;

  return setMenubarOpenValue(state, state.itemValue, 'item-pointer-enter', options);
}

/**
 * @jisoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function menubarItemClick(
  event: MenubarItemEvent,
  state: MenubarItemAttributeOptions,
  options: MenubarChangeOptions = {},
): MenubarSelectResult | undefined {
  if (event.defaultPrevented) return;

  const result = selectMenubarItem(state, state.itemValue, 'item-click', options);
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
export function menubarItemKeyDown(
  event: MenubarKeyboardEvent,
  state: MenubarItemAttributeOptions,
  options: MenubarChangeOptions = {},
): MenubarSelectResult | undefined {
  if (event.defaultPrevented) return;
  if (!menubarItemActivationKey(event.key)) return;

  const result = selectMenubarItem(state, state.itemValue, 'keyboard', options);
  event.preventDefault();

  return result;
}

/**
 * @jisoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function menubarKeyDown(
  event: MenubarKeyboardEvent,
  state: MenubarState,
  options: MenubarChangeOptions = {},
): MenubarOpenChangeResult | undefined {
  if (event.defaultPrevented) return;

  if (event.key === 'Escape') {
    const result = setMenubarOpenValue(state, undefined, 'escape-key', options);
    if (result.changed) event.preventDefault();
    return result;
  }

  if (
    state.activeValue !== undefined &&
    (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
    menubarItemHasPopup({ ...state, itemValue: state.activeValue })
  ) {
    const result = setMenubarOpenValue(state, state.activeValue, 'item-keyboard', options);
    if (result.changed) event.preventDefault();
    return result;
  }

  return undefined;
}

function menubarDataAttributes(state: MenubarState): PrimitiveDataAttributes {
  return mergeDataAttributes(
    openState(state.openValue !== undefined),
    dataOrientation(menubarDataOrientation(state.orientation)),
    dataDisabled(state.disabled === true),
  );
}

function menubarItemDataAttributes(options: MenubarItemAttributeOptions): PrimitiveDataAttributes {
  return mergeDataAttributes(
    dataState(menubarItemHighlighted(options) ? 'active' : 'inactive'),
    dataDisabled(menubarItemDisabled(options, options.itemValue, options.itemParentValue)),
    menubarItemHighlighted(options) ? { 'data-highlighted': '' } : undefined,
  );
}

function menubarItemDisabled(
  state: MenubarState & { itemDisabled?: boolean },
  value: string | undefined,
  parentValue?: string,
): boolean {
  if (value === undefined) return false;
  const item = state.items?.find(
    (candidate) =>
      candidate.value === value &&
      (parentValue === undefined || candidate.parentValue === parentValue),
  );

  return state.disabled === true || state.itemDisabled === true || item?.disabled === true;
}

function menubarItemHasPopup(options: MenubarItemAttributeOptions): boolean {
  return (
    options.contentId !== undefined ||
    options.items?.find(
      (item) => item.value === options.itemValue && item.parentValue === options.itemParentValue,
    )?.hasPopup === true ||
    options.items?.some((item) => item.parentValue === options.itemValue) === true
  );
}

function menubarItemsForParent(
  state: MenubarState,
  parentValue: string | undefined,
): readonly MenubarItem[] {
  return (state.items ?? []).filter((item) => item.parentValue === parentValue);
}

function nextMenubarTypeaheadState(
  state: MenubarState,
  key: string,
  options: MenubarTypeaheadOptions,
): TypeaheadState {
  return nextTypeaheadState(
    state.disabled ? undefined : options.state,
    key,
    options.now,
    options.timeoutMs,
  );
}

function menubarDataOrientation(
  orientation: CollectionOrientation | undefined,
): 'horizontal' | 'vertical' {
  return orientation === 'vertical' ? 'vertical' : 'horizontal';
}

function menubarItemActivationKey(key: string): boolean {
  return key === 'Enter' || key === ' ' || key === 'Spacebar';
}
