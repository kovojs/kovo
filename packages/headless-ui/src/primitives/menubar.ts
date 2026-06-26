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
  scheduleDeferred,
  type CollectionOrientation,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
  type TextDirection,
  type TypeaheadState,
} from '../lib/index.js';

/**
 * Public interface used by the Menubar primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { MenubarItem } from '@kovojs/headless-ui/menubar';
 *
 * const value: MenubarItem = {} as MenubarItem;
 * ```
 */
export interface MenubarItem {
  disabled?: boolean;
  hasPopup?: boolean;
  label?: string;
  parentValue?: string;
  textValue?: string;
  value: string;
}

/**
 * State snapshot consumed by the Menubar primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { MenubarState } from '@kovojs/headless-ui/menubar';
 *
 * const value: MenubarState = {} as MenubarState;
 * ```
 */
export interface MenubarState {
  activeValue?: string;
  dir?: TextDirection;
  disabled?: boolean;
  items?: readonly MenubarItem[];
  loop?: boolean;
  openValue?: string;
  orientation?: CollectionOrientation;
}

/**
 * Options accepted by the Menubar primitive menubar root attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { MenubarRootAttributeOptions } from '@kovojs/headless-ui/menubar';
 *
 * const value: MenubarRootAttributeOptions = {} as MenubarRootAttributeOptions;
 * ```
 */
export interface MenubarRootAttributeOptions extends MenubarState {
  descriptionId?: string;
  id?: string;
  label?: string;
  labelledBy?: string;
}

/**
 * Options accepted by the Menubar primitive menubar item attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { MenubarItemAttributeOptions } from '@kovojs/headless-ui/menubar';
 *
 * const value: MenubarItemAttributeOptions = {} as MenubarItemAttributeOptions;
 * ```
 */
export interface MenubarItemAttributeOptions extends MenubarState {
  contentId?: string;
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemParentValue?: string;
  itemValue: string;
}

/**
 * Options accepted by the Menubar primitive menubar submenu attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { MenubarSubmenuAttributeOptions } from '@kovojs/headless-ui/menubar';
 *
 * const value: MenubarSubmenuAttributeOptions = {} as MenubarSubmenuAttributeOptions;
 * ```
 */
export interface MenubarSubmenuAttributeOptions extends MenubarState {
  id?: string;
  labelledBy?: string;
  value: string;
}

/**
 * Options accepted by the Menubar primitive menubar group attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { MenubarGroupAttributeOptions } from '@kovojs/headless-ui/menubar';
 *
 * const value: MenubarGroupAttributeOptions = {} as MenubarGroupAttributeOptions;
 * ```
 */
export interface MenubarGroupAttributeOptions extends MenubarState {
  id?: string;
  labelledBy?: string;
}

/**
 * Options accepted by the Menubar primitive menubar separator attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { MenubarSeparatorAttributeOptions } from '@kovojs/headless-ui/menubar';
 *
 * const value: MenubarSeparatorAttributeOptions = {} as MenubarSeparatorAttributeOptions;
 * ```
 */
export interface MenubarSeparatorAttributeOptions {
  id?: string;
}

/**
 * Reason token reported by the Menubar primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { MenubarOpenChangeReason } from '@kovojs/headless-ui/menubar';
 *
 * const value: MenubarOpenChangeReason = {} as MenubarOpenChangeReason;
 * ```
 */
export type MenubarOpenChangeReason =
  | 'escape-key'
  | 'item-click'
  | 'item-keyboard'
  | 'item-pointer-enter'
  | 'item-select'
  | 'programmatic';

/**
 * Reason token reported by the Menubar primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { MenubarSelectReason } from '@kovojs/headless-ui/menubar';
 *
 * const value: MenubarSelectReason = {} as MenubarSelectReason;
 * ```
 */
export type MenubarSelectReason = 'item-click' | 'keyboard' | 'programmatic';

/**
 * Cancelable change detail emitted by the Menubar primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { MenubarOpenChangeDetail } from '@kovojs/headless-ui/menubar';
 *
 * const value: MenubarOpenChangeDetail = {} as MenubarOpenChangeDetail;
 * ```
 */
export type MenubarOpenChangeDetail = PrimitiveChangeDetail<
  MenubarOpenChangeReason,
  string | undefined
>;

/**
 * Cancelable change detail emitted by the Menubar primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { MenubarSelectDetail } from '@kovojs/headless-ui/menubar';
 *
 * const value: MenubarSelectDetail = {} as MenubarSelectDetail;
 * ```
 */
export type MenubarSelectDetail = PrimitiveChangeDetail<MenubarSelectReason, string>;

/**
 * Options accepted by the Menubar primitive menubar change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { MenubarChangeOptions } from '@kovojs/headless-ui/menubar';
 *
 * const value: MenubarChangeOptions = {} as MenubarChangeOptions;
 * ```
 */
export interface MenubarChangeOptions {
  onOpenChange?: (detail: MenubarOpenChangeDetail) => void;
  onSelect?: (detail: MenubarSelectDetail) => void;
}

/**
 * Result returned by the Menubar primitive menubar open change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { MenubarOpenChangeResult } from '@kovojs/headless-ui/menubar';
 *
 * const value: MenubarOpenChangeResult = {} as MenubarOpenChangeResult;
 * ```
 */
export interface MenubarOpenChangeResult {
  changed: boolean;
  detail?: MenubarOpenChangeDetail;
  openValue: string | undefined;
}

/**
 * Result returned by the Menubar primitive menubar select.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { MenubarSelectResult } from '@kovojs/headless-ui/menubar';
 *
 * const value: MenubarSelectResult = {} as MenubarSelectResult;
 * ```
 */
export interface MenubarSelectResult {
  detail?: MenubarSelectDetail;
  open: MenubarOpenChangeResult;
  selected: boolean;
  value: string;
}

/**
 * Options accepted by the Menubar primitive menubar move.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { MenubarMoveOptions } from '@kovojs/headless-ui/menubar';
 *
 * const value: MenubarMoveOptions = {} as MenubarMoveOptions;
 * ```
 */
export interface MenubarMoveOptions {
  loop?: boolean;
  parentValue?: string;
}

/**
 * Result returned by the Menubar primitive menubar move.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { MenubarMoveResult } from '@kovojs/headless-ui/menubar';
 *
 * const value: MenubarMoveResult = {} as MenubarMoveResult;
 * ```
 */
export interface MenubarMoveResult {
  activeIndex: number;
  activeValue: string | undefined;
  parentValue: string | undefined;
}

/**
 * Options accepted by the Menubar primitive menubar typeahead.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { MenubarTypeaheadOptions } from '@kovojs/headless-ui/menubar';
 *
 * const value: MenubarTypeaheadOptions = {} as MenubarTypeaheadOptions;
 * ```
 */
export interface MenubarTypeaheadOptions extends MenubarMoveOptions {
  currentValue?: string;
  now: number;
  state?: TypeaheadState;
  timeoutMs?: number;
}

/**
 * Result returned by the Menubar primitive menubar typeahead.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { MenubarTypeaheadResult } from '@kovojs/headless-ui/menubar';
 *
 * const value: MenubarTypeaheadResult = {} as MenubarTypeaheadResult;
 * ```
 */
export interface MenubarTypeaheadResult extends MenubarMoveResult {
  state: TypeaheadState;
}

/**
 * Serializable attribute record returned by Menubar primitive builders.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { MenubarPrimitiveAttributes } from '@kovojs/headless-ui/menubar';
 *
 * const value: MenubarPrimitiveAttributes = {} as MenubarPrimitiveAttributes;
 * ```
 */
export type MenubarPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

/**
 * Event shape consumed by the Menubar primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { MenubarItemEvent } from '@kovojs/headless-ui/menubar';
 *
 * const value: MenubarItemEvent = {} as MenubarItemEvent;
 * ```
 */
export type MenubarItemEvent = Event;

/**
 * Event shape consumed by the Menubar primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { MenubarKeyboardEvent } from '@kovojs/headless-ui/menubar';
 *
 * const value: MenubarKeyboardEvent = {} as MenubarKeyboardEvent;
 * ```
 */
export type MenubarKeyboardEvent = Event & { readonly key: string };

/**
 * Event shape consumed by the Menubar primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { MenubarFocusEvent } from '@kovojs/headless-ui/menubar';
 *
 * const value: MenubarFocusEvent = {} as MenubarFocusEvent;
 * ```
 */
export type MenubarFocusEvent = Event & {
  readonly currentTarget?: {
    ownerDocument?: {
      getElementById?: (id: string) => unknown;
    };
  } | null;
  readonly target?: {
    ownerDocument?: {
      getElementById?: (id: string) => unknown;
    };
  } | null;
};

/**
 * Options accepted by the Menubar primitive menubar focus.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { MenubarFocusOptions } from '@kovojs/headless-ui/menubar';
 *
 * const value: MenubarFocusOptions = {} as MenubarFocusOptions;
 * ```
 */
export interface MenubarFocusOptions {
  defer?: boolean;
  schedule?: (callback: () => void) => void;
}

/**
 * Builds the menubar root attributes record for the Menubar primitive.
 *
 * Emits `aria-describedby`, `aria-disabled`, `aria-label`, `aria-labelledby`, `aria-orientation`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { menubarRootAttributes } from '@kovojs/headless-ui/menubar';
 *
 * const input = {} as Parameters<typeof menubarRootAttributes>[0];
 * const result = menubarRootAttributes(input);
 * ```
 */
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

/**
 * Builds the menubar item attributes record for the Menubar primitive.
 *
 * Emits `aria-controls`, `aria-disabled`, `aria-expanded`, `aria-haspopup`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { menubarItemAttributes } from '@kovojs/headless-ui/menubar';
 *
 * const input = {} as Parameters<typeof menubarItemAttributes>[0];
 * const result = menubarItemAttributes(input);
 * ```
 */
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

/**
 * Builds the menubar submenu attributes record for the Menubar primitive.
 *
 * Emits `aria-labelledby`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { menubarSubmenuAttributes } from '@kovojs/headless-ui/menubar';
 *
 * const input = {} as Parameters<typeof menubarSubmenuAttributes>[0];
 * const result = menubarSubmenuAttributes(input);
 * ```
 */
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

/**
 * Builds the menubar group attributes record for the Menubar primitive.
 *
 * Emits `aria-labelledby`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { menubarGroupAttributes } from '@kovojs/headless-ui/menubar';
 *
 * const input = {} as Parameters<typeof menubarGroupAttributes>[0];
 * const result = menubarGroupAttributes(input);
 * ```
 */
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

/**
 * Builds the menubar separator attributes record for the Menubar primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { menubarSeparatorAttributes } from '@kovojs/headless-ui/menubar';
 *
 * const input = {} as Parameters<typeof menubarSeparatorAttributes>[0];
 * const result = menubarSeparatorAttributes(input);
 * ```
 */
export function menubarSeparatorAttributes(
  options: MenubarSeparatorAttributeOptions = {},
): MenubarPrimitiveAttributes {
  return Object.freeze({
    role: 'separator',
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

/**
 * Computes menubar item highlighted for the Menubar primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { menubarItemHighlighted } from '@kovojs/headless-ui/menubar';
 *
 * const input = {} as Parameters<typeof menubarItemHighlighted>[0];
 * const result = menubarItemHighlighted(input);
 * ```
 */
export function menubarItemHighlighted(options: MenubarItemAttributeOptions): boolean {
  return options.activeValue === options.itemValue;
}

/**
 * Computes menubar item open for the Menubar primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { menubarItemOpen } from '@kovojs/headless-ui/menubar';
 *
 * const input = {} as Parameters<typeof menubarItemOpen>[0];
 * const result = menubarItemOpen(input);
 * ```
 */
export function menubarItemOpen(options: MenubarItemAttributeOptions): boolean {
  return options.openValue === options.itemValue;
}

/**
 * Computes the set menubar open value transition for the Menubar primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { setMenubarOpenValue } from '@kovojs/headless-ui/menubar';
 *
 * const input = {} as Parameters<typeof setMenubarOpenValue>[0];
 * const state = {} as Parameters<typeof setMenubarOpenValue>[1];
 * const options = {} as Parameters<typeof setMenubarOpenValue>[2];
 * const detail = {} as Parameters<typeof setMenubarOpenValue>[3];
 * const result = setMenubarOpenValue(input, state, options, detail);
 * ```
 */
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

/**
 * Computes the toggle menubar open value transition for the Menubar primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toggleMenubarOpenValue } from '@kovojs/headless-ui/menubar';
 *
 * const input = {} as Parameters<typeof toggleMenubarOpenValue>[0];
 * const state = {} as Parameters<typeof toggleMenubarOpenValue>[1];
 * const options = {} as Parameters<typeof toggleMenubarOpenValue>[2];
 * const detail = {} as Parameters<typeof toggleMenubarOpenValue>[3];
 * const result = toggleMenubarOpenValue(input, state, options, detail);
 * ```
 */
export function toggleMenubarOpenValue(
  state: MenubarState,
  value: string,
  reason: MenubarOpenChangeReason,
  options: MenubarChangeOptions = {},
): MenubarOpenChangeResult {
  return setMenubarOpenValue(state, state.openValue === value ? undefined : value, reason, options);
}

/**
 * Computes the select menubar item transition for the Menubar primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { selectMenubarItem } from '@kovojs/headless-ui/menubar';
 *
 * const input = {} as Parameters<typeof selectMenubarItem>[0];
 * const state = {} as Parameters<typeof selectMenubarItem>[1];
 * const options = {} as Parameters<typeof selectMenubarItem>[2];
 * const detail = {} as Parameters<typeof selectMenubarItem>[3];
 * const result = selectMenubarItem(input, state, options, detail);
 * ```
 */
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

  const openResult = setMenubarOpenValue(state, undefined, 'item-select', options);
  if (!openResult.changed) {
    return {
      detail,
      open: openResult,
      selected: false,
      value,
    };
  }

  return {
    detail,
    open: openResult,
    selected: true,
    value,
  };
}

/**
 * Computes menubar move for the Menubar primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { menubarMove } from '@kovojs/headless-ui/menubar';
 *
 * const input = {} as Parameters<typeof menubarMove>[0];
 * const state = {} as Parameters<typeof menubarMove>[1];
 * const options = {} as Parameters<typeof menubarMove>[2];
 * const result = menubarMove(input, state, options);
 * ```
 */
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

/**
 * Computes menubar typeahead for the Menubar primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { menubarTypeahead } from '@kovojs/headless-ui/menubar';
 *
 * const input = {} as Parameters<typeof menubarTypeahead>[0];
 * const state = {} as Parameters<typeof menubarTypeahead>[1];
 * const options = {} as Parameters<typeof menubarTypeahead>[2];
 * const result = menubarTypeahead(input, state, options);
 * ```
 */
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
 * Handles the menubar submenu trigger click interaction for the Menubar primitive.
 *
 * @example
 * ```ts
 * import { menubarSubmenuTriggerClick } from '@kovojs/headless-ui/menubar';
 *
 * const input = {} as Parameters<typeof menubarSubmenuTriggerClick>[0];
 * const state = {} as Parameters<typeof menubarSubmenuTriggerClick>[1];
 * const options = {} as Parameters<typeof menubarSubmenuTriggerClick>[2];
 * const result = menubarSubmenuTriggerClick(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
 * Handles the menubar item pointer enter interaction for the Menubar primitive.
 *
 * @example
 * ```ts
 * import { menubarItemPointerEnter } from '@kovojs/headless-ui/menubar';
 *
 * const input = {} as Parameters<typeof menubarItemPointerEnter>[0];
 * const state = {} as Parameters<typeof menubarItemPointerEnter>[1];
 * const options = {} as Parameters<typeof menubarItemPointerEnter>[2];
 * const result = menubarItemPointerEnter(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
 * Handles the menubar item click interaction for the Menubar primitive.
 *
 * @example
 * ```ts
 * import { menubarItemClick } from '@kovojs/headless-ui/menubar';
 *
 * const input = {} as Parameters<typeof menubarItemClick>[0];
 * const state = {} as Parameters<typeof menubarItemClick>[1];
 * const options = {} as Parameters<typeof menubarItemClick>[2];
 * const result = menubarItemClick(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
 * Handles the menubar item key down interaction for the Menubar primitive.
 *
 * @example
 * ```ts
 * import { menubarItemKeyDown } from '@kovojs/headless-ui/menubar';
 *
 * const input = {} as Parameters<typeof menubarItemKeyDown>[0];
 * const state = {} as Parameters<typeof menubarItemKeyDown>[1];
 * const options = {} as Parameters<typeof menubarItemKeyDown>[2];
 * const result = menubarItemKeyDown(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
 * Handles the menubar key down interaction for the Menubar primitive.
 *
 * @example
 * ```ts
 * import { menubarKeyDown } from '@kovojs/headless-ui/menubar';
 *
 * const input = {} as Parameters<typeof menubarKeyDown>[0];
 * const state = {} as Parameters<typeof menubarKeyDown>[1];
 * const options = {} as Parameters<typeof menubarKeyDown>[2];
 * const result = menubarKeyDown(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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

/**
 * Handles the menubar focus element interaction for the Menubar primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { menubarFocusElement } from '@kovojs/headless-ui/menubar';
 *
 * const input = {} as Parameters<typeof menubarFocusElement>[0];
 * const state = {} as Parameters<typeof menubarFocusElement>[1];
 * const options = {} as Parameters<typeof menubarFocusElement>[2];
 * const result = menubarFocusElement(input, state, options);
 * ```
 */
export function menubarFocusElement(
  event: MenubarFocusEvent,
  id: string | undefined,
  options: MenubarFocusOptions = {},
): boolean {
  if (!id) return false;

  const ownerDocument = event.currentTarget?.ownerDocument ?? event.target?.ownerDocument;
  const target = ownerDocument?.getElementById?.(id);
  if (typeof (target as { focus?: unknown } | undefined)?.focus !== 'function') return false;

  const focus = () => {
    (target as { focus(): void }).focus();
  };
  if (options.defer === true) {
    // SPEC §4.3/§4.8: defer focus past the runtime update plan so the target is
    // revealed (un-hidden) before `.focus()` runs; see scheduleDeferred.
    (options.schedule ?? scheduleDeferred)(focus);
  } else {
    focus();
  }
  return true;
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
