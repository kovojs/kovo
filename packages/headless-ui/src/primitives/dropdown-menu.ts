import {
  dataDisabled,
  dataState,
  dispatchCancelableChange,
  findTypeaheadMatch,
  mergeDataAttributes,
  moveCollectionIndex,
  navigationIntentFromKey,
  nextTypeaheadState,
  openState,
  scheduleDeferred,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
  type TypeaheadState,
} from '../lib/index.js';

/**
 * Public interface used by the Dropdown Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DropdownMenuItem } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const value: DropdownMenuItem = {} as DropdownMenuItem;
 * ```
 */
export interface DropdownMenuItem {
  disabled?: boolean;
  label?: string;
  textValue?: string;
  value: string;
}

/**
 * State snapshot consumed by the Dropdown Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DropdownMenuState } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const value: DropdownMenuState = {} as DropdownMenuState;
 * ```
 */
export interface DropdownMenuState {
  disabled?: boolean;
  highlightedValue?: string;
  items?: readonly DropdownMenuItem[];
  open?: boolean;
}

/**
 * Options accepted by the Dropdown Menu primitive dropdown menu root attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DropdownMenuRootAttributeOptions } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const value: DropdownMenuRootAttributeOptions = {} as DropdownMenuRootAttributeOptions;
 * ```
 */
export interface DropdownMenuRootAttributeOptions extends DropdownMenuState {
  id?: string;
}

/**
 * Options accepted by the Dropdown Menu primitive dropdown menu trigger attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DropdownMenuTriggerAttributeOptions } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const value: DropdownMenuTriggerAttributeOptions = {} as DropdownMenuTriggerAttributeOptions;
 * ```
 */
export interface DropdownMenuTriggerAttributeOptions extends DropdownMenuState {
  contentId?: string;
  id?: string;
  labelledBy?: string;
}

/**
 * Options accepted by the Dropdown Menu primitive dropdown menu content attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DropdownMenuContentAttributeOptions } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const value: DropdownMenuContentAttributeOptions = {} as DropdownMenuContentAttributeOptions;
 * ```
 */
export interface DropdownMenuContentAttributeOptions extends DropdownMenuState {
  id?: string;
  labelledBy?: string;
}

/**
 * Options accepted by the Dropdown Menu primitive dropdown menu item attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DropdownMenuItemAttributeOptions } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const value: DropdownMenuItemAttributeOptions = {} as DropdownMenuItemAttributeOptions;
 * ```
 */
export interface DropdownMenuItemAttributeOptions extends DropdownMenuState {
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemValue: string;
}

/**
 * Options accepted by the Dropdown Menu primitive dropdown menu group attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DropdownMenuGroupAttributeOptions } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const value: DropdownMenuGroupAttributeOptions = {} as DropdownMenuGroupAttributeOptions;
 * ```
 */
export interface DropdownMenuGroupAttributeOptions extends DropdownMenuState {
  id?: string;
  labelledBy?: string;
}

/**
 * Options accepted by the Dropdown Menu primitive dropdown menu separator attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DropdownMenuSeparatorAttributeOptions } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const value: DropdownMenuSeparatorAttributeOptions = {} as DropdownMenuSeparatorAttributeOptions;
 * ```
 */
export interface DropdownMenuSeparatorAttributeOptions {
  id?: string;
}

/**
 * Reason token reported by the Dropdown Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DropdownMenuOpenChangeReason } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const value: DropdownMenuOpenChangeReason = {} as DropdownMenuOpenChangeReason;
 * ```
 */
export type DropdownMenuOpenChangeReason =
  | 'arrow-key'
  | 'escape-key'
  | 'item-select'
  | 'programmatic'
  | 'trigger-click';

/**
 * Reason token reported by the Dropdown Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DropdownMenuSelectReason } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const value: DropdownMenuSelectReason = {} as DropdownMenuSelectReason;
 * ```
 */
export type DropdownMenuSelectReason = 'item-click' | 'item-keyboard' | 'programmatic';

/**
 * Cancelable change detail emitted by the Dropdown Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DropdownMenuOpenChangeDetail } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const value: DropdownMenuOpenChangeDetail = {} as DropdownMenuOpenChangeDetail;
 * ```
 */
export type DropdownMenuOpenChangeDetail = PrimitiveChangeDetail<
  DropdownMenuOpenChangeReason,
  boolean
>;

/**
 * Cancelable change detail emitted by the Dropdown Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DropdownMenuSelectDetail } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const value: DropdownMenuSelectDetail = {} as DropdownMenuSelectDetail;
 * ```
 */
export type DropdownMenuSelectDetail = PrimitiveChangeDetail<DropdownMenuSelectReason, string>;

/**
 * Options accepted by the Dropdown Menu primitive dropdown menu change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DropdownMenuChangeOptions } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const value: DropdownMenuChangeOptions = {} as DropdownMenuChangeOptions;
 * ```
 */
export interface DropdownMenuChangeOptions {
  onOpenChange?: (detail: DropdownMenuOpenChangeDetail) => void;
  onSelect?: (detail: DropdownMenuSelectDetail) => void;
}

/**
 * Result returned by the Dropdown Menu primitive dropdown menu open change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DropdownMenuOpenChangeResult } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const value: DropdownMenuOpenChangeResult = {} as DropdownMenuOpenChangeResult;
 * ```
 */
export interface DropdownMenuOpenChangeResult {
  changed: boolean;
  detail?: DropdownMenuOpenChangeDetail;
  open: boolean;
}

/**
 * Result returned by the Dropdown Menu primitive dropdown menu select.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DropdownMenuSelectResult } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const value: DropdownMenuSelectResult = {} as DropdownMenuSelectResult;
 * ```
 */
export interface DropdownMenuSelectResult {
  detail?: DropdownMenuSelectDetail;
  open: DropdownMenuOpenChangeResult;
  selected: boolean;
  value: string;
}

/**
 * Result returned by the Dropdown Menu primitive dropdown menu move.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DropdownMenuMoveResult } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const value: DropdownMenuMoveResult = {} as DropdownMenuMoveResult;
 * ```
 */
export interface DropdownMenuMoveResult {
  highlightedIndex: number;
  highlightedValue: string | undefined;
}

/**
 * Options accepted by the Dropdown Menu primitive dropdown menu typeahead.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DropdownMenuTypeaheadOptions } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const value: DropdownMenuTypeaheadOptions = {} as DropdownMenuTypeaheadOptions;
 * ```
 */
export interface DropdownMenuTypeaheadOptions {
  currentValue?: string;
  loop?: boolean;
  now: number;
  state?: TypeaheadState;
  timeoutMs?: number;
}

/**
 * Result returned by the Dropdown Menu primitive dropdown menu typeahead.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DropdownMenuTypeaheadResult } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const value: DropdownMenuTypeaheadResult = {} as DropdownMenuTypeaheadResult;
 * ```
 */
export interface DropdownMenuTypeaheadResult extends DropdownMenuMoveResult {
  state: TypeaheadState;
}

/**
 * Serializable attribute record returned by Dropdown Menu primitive builders.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DropdownMenuPrimitiveAttributes } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const value: DropdownMenuPrimitiveAttributes = {} as DropdownMenuPrimitiveAttributes;
 * ```
 */
export type DropdownMenuPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

/**
 * Event shape consumed by the Dropdown Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DropdownMenuTriggerEvent } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const value: DropdownMenuTriggerEvent = {} as DropdownMenuTriggerEvent;
 * ```
 */
export type DropdownMenuTriggerEvent = Event;

/**
 * Event shape consumed by the Dropdown Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DropdownMenuItemEvent } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const value: DropdownMenuItemEvent = {} as DropdownMenuItemEvent;
 * ```
 */
export type DropdownMenuItemEvent = Event;

/**
 * Event shape consumed by the Dropdown Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DropdownMenuKeyboardEvent } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const value: DropdownMenuKeyboardEvent = {} as DropdownMenuKeyboardEvent;
 * ```
 */
export type DropdownMenuKeyboardEvent = Event & { readonly key: string };

/**
 * Event shape consumed by the Dropdown Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DropdownMenuFocusEvent } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const value: DropdownMenuFocusEvent = {} as DropdownMenuFocusEvent;
 * ```
 */
export type DropdownMenuFocusEvent = Event & {
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
 * Options accepted by the Dropdown Menu primitive dropdown menu focus.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { DropdownMenuFocusOptions } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const value: DropdownMenuFocusOptions = {} as DropdownMenuFocusOptions;
 * ```
 */
export interface DropdownMenuFocusOptions {
  defer?: boolean;
  schedule?: (callback: () => void) => void;
}

/**
 * Builds the dropdown menu root attributes record for the Dropdown Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { dropdownMenuRootAttributes } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const input = {} as Parameters<typeof dropdownMenuRootAttributes>[0];
 * const result = dropdownMenuRootAttributes(input);
 * ```
 */
export function dropdownMenuRootAttributes(
  options: DropdownMenuRootAttributeOptions = {},
): DropdownMenuPrimitiveAttributes {
  return Object.freeze({
    ...dropdownMenuDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

/**
 * Builds the dropdown menu trigger attributes record for the Dropdown Menu primitive.
 *
 * Emits `aria-controls`, `aria-expanded`, `aria-haspopup`, `aria-labelledby`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { dropdownMenuTriggerAttributes } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const input = {} as Parameters<typeof dropdownMenuTriggerAttributes>[0];
 * const result = dropdownMenuTriggerAttributes(input);
 * ```
 */
export function dropdownMenuTriggerAttributes(
  options: DropdownMenuTriggerAttributeOptions = {},
): DropdownMenuPrimitiveAttributes {
  const enabledContentId = options.disabled === true ? undefined : options.contentId;

  return Object.freeze({
    ...dropdownMenuDataAttributes(options),
    'aria-expanded': String(options.open === true),
    'aria-haspopup': 'menu',
    disabled: options.disabled === true,
    type: 'button',
    ...(enabledContentId === undefined ? {} : { 'aria-controls': enabledContentId }),
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
  });
}

/**
 * Builds the dropdown menu content attributes record for the Dropdown Menu primitive.
 *
 * Emits `aria-labelledby`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { dropdownMenuContentAttributes } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const input = {} as Parameters<typeof dropdownMenuContentAttributes>[0];
 * const result = dropdownMenuContentAttributes(input);
 * ```
 */
export function dropdownMenuContentAttributes(
  options: DropdownMenuContentAttributeOptions = {},
): DropdownMenuPrimitiveAttributes {
  return Object.freeze({
    ...dropdownMenuDataAttributes(options),
    role: 'menu',
    tabIndex: -1,
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
    ...(options.open === true ? {} : { hidden: true }),
  });
}

/**
 * Builds the dropdown menu item attributes record for the Dropdown Menu primitive.
 *
 * Emits `aria-disabled`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { dropdownMenuItemAttributes } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const input = {} as Parameters<typeof dropdownMenuItemAttributes>[0];
 * const result = dropdownMenuItemAttributes(input);
 * ```
 */
export function dropdownMenuItemAttributes(
  options: DropdownMenuItemAttributeOptions,
): DropdownMenuPrimitiveAttributes {
  const disabled = dropdownMenuItemDisabled(options, options.itemValue);
  const highlighted = dropdownMenuItemHighlighted(options);

  return Object.freeze({
    ...dropdownMenuItemDataAttributes(options),
    role: 'menuitem',
    tabIndex: highlighted && !disabled ? 0 : -1,
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(disabled ? { 'aria-disabled': 'true' } : {}),
    ...(options.itemLabel === undefined ? {} : { label: options.itemLabel }),
    value: options.itemValue,
  });
}

/**
 * Builds the dropdown menu group attributes record for the Dropdown Menu primitive.
 *
 * Emits `aria-labelledby`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { dropdownMenuGroupAttributes } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const input = {} as Parameters<typeof dropdownMenuGroupAttributes>[0];
 * const result = dropdownMenuGroupAttributes(input);
 * ```
 */
export function dropdownMenuGroupAttributes(
  options: DropdownMenuGroupAttributeOptions = {},
): DropdownMenuPrimitiveAttributes {
  return Object.freeze({
    ...dropdownMenuDataAttributes(options),
    role: 'group',
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
  });
}

/**
 * Builds the dropdown menu separator attributes record for the Dropdown Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { dropdownMenuSeparatorAttributes } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const input = {} as Parameters<typeof dropdownMenuSeparatorAttributes>[0];
 * const result = dropdownMenuSeparatorAttributes(input);
 * ```
 */
export function dropdownMenuSeparatorAttributes(
  options: DropdownMenuSeparatorAttributeOptions = {},
): DropdownMenuPrimitiveAttributes {
  return Object.freeze({
    role: 'separator',
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

/**
 * Computes dropdown menu item highlighted for the Dropdown Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { dropdownMenuItemHighlighted } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const input = {} as Parameters<typeof dropdownMenuItemHighlighted>[0];
 * const result = dropdownMenuItemHighlighted(input);
 * ```
 */
export function dropdownMenuItemHighlighted(options: DropdownMenuItemAttributeOptions): boolean {
  return options.highlightedValue === options.itemValue;
}

/**
 * Computes the set dropdown menu open transition for the Dropdown Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { setDropdownMenuOpen } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const input = {} as Parameters<typeof setDropdownMenuOpen>[0];
 * const state = {} as Parameters<typeof setDropdownMenuOpen>[1];
 * const options = {} as Parameters<typeof setDropdownMenuOpen>[2];
 * const detail = {} as Parameters<typeof setDropdownMenuOpen>[3];
 * const result = setDropdownMenuOpen(input, state, options, detail);
 * ```
 */
export function setDropdownMenuOpen(
  state: DropdownMenuState,
  open: boolean,
  reason: DropdownMenuOpenChangeReason,
  options: DropdownMenuChangeOptions = {},
): DropdownMenuOpenChangeResult {
  if (state.disabled || state.open === open) {
    return { changed: false, open: state.open === true };
  }

  const detail = dispatchCancelableChange({ reason, value: open }, options.onOpenChange);
  if (detail.defaultPrevented) {
    return { changed: false, detail, open: state.open === true };
  }

  return { changed: true, detail, open };
}

/**
 * Computes the toggle dropdown menu transition for the Dropdown Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toggleDropdownMenu } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const input = {} as Parameters<typeof toggleDropdownMenu>[0];
 * const state = {} as Parameters<typeof toggleDropdownMenu>[1];
 * const options = {} as Parameters<typeof toggleDropdownMenu>[2];
 * const result = toggleDropdownMenu(input, state, options);
 * ```
 */
export function toggleDropdownMenu(
  state: DropdownMenuState,
  reason: DropdownMenuOpenChangeReason,
  options: DropdownMenuChangeOptions = {},
): DropdownMenuOpenChangeResult {
  return setDropdownMenuOpen(state, !(state.open === true), reason, options);
}

/**
 * Computes the select dropdown menu item transition for the Dropdown Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { selectDropdownMenuItem } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const input = {} as Parameters<typeof selectDropdownMenuItem>[0];
 * const state = {} as Parameters<typeof selectDropdownMenuItem>[1];
 * const options = {} as Parameters<typeof selectDropdownMenuItem>[2];
 * const detail = {} as Parameters<typeof selectDropdownMenuItem>[3];
 * const result = selectDropdownMenuItem(input, state, options, detail);
 * ```
 */
export function selectDropdownMenuItem(
  state: DropdownMenuState,
  value: string,
  reason: DropdownMenuSelectReason,
  options: DropdownMenuChangeOptions = {},
): DropdownMenuSelectResult {
  if (state.disabled || dropdownMenuItemDisabled(state, value)) {
    return {
      open: { changed: false, open: state.open === true },
      selected: false,
      value,
    };
  }

  const detail = dispatchCancelableChange({ reason, value }, options.onSelect);
  if (detail.defaultPrevented) {
    return {
      detail,
      open: { changed: false, open: state.open === true },
      selected: false,
      value,
    };
  }

  const openResult = setDropdownMenuOpen(state, false, 'item-select', options);
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
 * Computes dropdown menu move for the Dropdown Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { dropdownMenuMove } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const input = {} as Parameters<typeof dropdownMenuMove>[0];
 * const state = {} as Parameters<typeof dropdownMenuMove>[1];
 * const options = {} as Parameters<typeof dropdownMenuMove>[2];
 * const result = dropdownMenuMove(input, state, options);
 * ```
 */
export function dropdownMenuMove(
  state: DropdownMenuState,
  key: string,
  options: { loop?: boolean } = {},
): DropdownMenuMoveResult | undefined {
  if (state.disabled) return undefined;

  const intent = navigationIntentFromKey(key, { orientation: 'vertical' });
  if (intent === undefined) return undefined;

  const items = state.items ?? [];
  const currentIndex = items.findIndex((item) => item.value === state.highlightedValue);
  const highlightedIndex = moveCollectionIndex(intent, {
    currentIndex,
    items,
    ...(options.loop === undefined ? {} : { loop: options.loop }),
  });

  return {
    highlightedIndex,
    highlightedValue: highlightedIndex < 0 ? undefined : items[highlightedIndex]?.value,
  };
}

/**
 * Computes dropdown menu typeahead for the Dropdown Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { dropdownMenuTypeahead } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const input = {} as Parameters<typeof dropdownMenuTypeahead>[0];
 * const state = {} as Parameters<typeof dropdownMenuTypeahead>[1];
 * const options = {} as Parameters<typeof dropdownMenuTypeahead>[2];
 * const result = dropdownMenuTypeahead(input, state, options);
 * ```
 */
export function dropdownMenuTypeahead(
  state: DropdownMenuState,
  key: string,
  options: DropdownMenuTypeaheadOptions,
): DropdownMenuTypeaheadResult {
  const nextState = nextTypeaheadState(
    state.disabled ? undefined : options.state,
    key,
    options.now,
    options.timeoutMs,
  );
  if (state.disabled || nextState.buffer === '') {
    return {
      highlightedIndex: -1,
      highlightedValue: options.currentValue ?? state.highlightedValue,
      state: nextState,
    };
  }

  const items = (state.items ?? []).map((item) => ({
    ...(item.disabled === undefined ? {} : { disabled: item.disabled }),
    textValue: item.textValue ?? item.label ?? item.value,
  }));
  const currentIndex = (state.items ?? []).findIndex(
    (item) => item.value === (options.currentValue ?? state.highlightedValue),
  );
  const highlightedIndex = findTypeaheadMatch({
    currentIndex,
    items,
    ...(options.loop === undefined ? {} : { loop: options.loop }),
    search: nextState.buffer,
  });

  return {
    highlightedIndex,
    highlightedValue:
      highlightedIndex < 0
        ? (options.currentValue ?? state.highlightedValue)
        : state.items?.[highlightedIndex]?.value,
    state: nextState,
  };
}

/**
 * Handles the dropdown menu trigger click interaction for the Dropdown Menu primitive.
 *
 * @example
 * ```ts
 * import { dropdownMenuTriggerClick } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const input = {} as Parameters<typeof dropdownMenuTriggerClick>[0];
 * const state = {} as Parameters<typeof dropdownMenuTriggerClick>[1];
 * const options = {} as Parameters<typeof dropdownMenuTriggerClick>[2];
 * const result = dropdownMenuTriggerClick(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function dropdownMenuTriggerClick(
  event: DropdownMenuTriggerEvent,
  state: DropdownMenuState,
  options: DropdownMenuChangeOptions = {},
): DropdownMenuOpenChangeResult | undefined {
  if (event.defaultPrevented) return;

  const result = toggleDropdownMenu(state, 'trigger-click', options);
  if (!result.changed) {
    event.preventDefault();
  }

  return result;
}

/**
 * Handles the dropdown menu trigger key down interaction for the Dropdown Menu primitive.
 *
 * @example
 * ```ts
 * import { dropdownMenuTriggerKeyDown } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const input = {} as Parameters<typeof dropdownMenuTriggerKeyDown>[0];
 * const state = {} as Parameters<typeof dropdownMenuTriggerKeyDown>[1];
 * const options = {} as Parameters<typeof dropdownMenuTriggerKeyDown>[2];
 * const result = dropdownMenuTriggerKeyDown(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function dropdownMenuTriggerKeyDown(
  event: DropdownMenuKeyboardEvent,
  state: DropdownMenuState,
  options: DropdownMenuChangeOptions = {},
): DropdownMenuOpenChangeResult | undefined {
  if (event.defaultPrevented) return;
  if (!dropdownMenuTriggerOpenKey(event.key)) return;

  const result = setDropdownMenuOpen(state, true, 'arrow-key', options);
  event.preventDefault();

  return result;
}

/**
 * Handles the dropdown menu item click interaction for the Dropdown Menu primitive.
 *
 * @example
 * ```ts
 * import { dropdownMenuItemClick } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const input = {} as Parameters<typeof dropdownMenuItemClick>[0];
 * const state = {} as Parameters<typeof dropdownMenuItemClick>[1];
 * const options = {} as Parameters<typeof dropdownMenuItemClick>[2];
 * const result = dropdownMenuItemClick(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function dropdownMenuItemClick(
  event: DropdownMenuItemEvent,
  state: DropdownMenuItemAttributeOptions,
  options: DropdownMenuChangeOptions = {},
): DropdownMenuSelectResult | undefined {
  if (event.defaultPrevented) return;

  const result = selectDropdownMenuItem(state, state.itemValue, 'item-click', options);
  if (!result.selected) {
    event.preventDefault();
  }

  return result;
}

/**
 * Handles the dropdown menu item key down interaction for the Dropdown Menu primitive.
 *
 * @example
 * ```ts
 * import { dropdownMenuItemKeyDown } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const input = {} as Parameters<typeof dropdownMenuItemKeyDown>[0];
 * const state = {} as Parameters<typeof dropdownMenuItemKeyDown>[1];
 * const options = {} as Parameters<typeof dropdownMenuItemKeyDown>[2];
 * const result = dropdownMenuItemKeyDown(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function dropdownMenuItemKeyDown(
  event: DropdownMenuKeyboardEvent,
  state: DropdownMenuItemAttributeOptions,
  options: DropdownMenuChangeOptions = {},
): DropdownMenuSelectResult | undefined {
  if (event.defaultPrevented) return;
  if (!dropdownMenuItemActivationKey(event.key)) return;

  const result = selectDropdownMenuItem(state, state.itemValue, 'item-keyboard', options);
  event.preventDefault();

  return result;
}

/**
 * Handles the dropdown menu key down interaction for the Dropdown Menu primitive.
 *
 * @example
 * ```ts
 * import { dropdownMenuKeyDown } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const input = {} as Parameters<typeof dropdownMenuKeyDown>[0];
 * const state = {} as Parameters<typeof dropdownMenuKeyDown>[1];
 * const options = {} as Parameters<typeof dropdownMenuKeyDown>[2];
 * const result = dropdownMenuKeyDown(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function dropdownMenuKeyDown(
  event: DropdownMenuKeyboardEvent,
  state: DropdownMenuState,
  options: DropdownMenuChangeOptions = {},
): DropdownMenuOpenChangeResult | undefined {
  if (event.defaultPrevented) return;

  if (event.key === 'Escape') {
    const result = setDropdownMenuOpen(state, false, 'escape-key', options);
    if (result.changed) event.preventDefault();
    return result;
  }

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    const result = setDropdownMenuOpen(state, true, 'arrow-key', options);
    if (result.changed) event.preventDefault();
    return result;
  }

  return undefined;
}

/**
 * Handles the dropdown menu focus element interaction for the Dropdown Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { dropdownMenuFocusElement } from '@kovojs/headless-ui/dropdown-menu';
 *
 * const input = {} as Parameters<typeof dropdownMenuFocusElement>[0];
 * const state = {} as Parameters<typeof dropdownMenuFocusElement>[1];
 * const options = {} as Parameters<typeof dropdownMenuFocusElement>[2];
 * const result = dropdownMenuFocusElement(input, state, options);
 * ```
 */
export function dropdownMenuFocusElement(
  event: DropdownMenuFocusEvent,
  id: string | undefined,
  options: DropdownMenuFocusOptions = {},
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

function dropdownMenuDataAttributes(state: DropdownMenuState): PrimitiveDataAttributes {
  return mergeDataAttributes(openState(state.open === true), dataDisabled(state.disabled === true));
}

function dropdownMenuItemDataAttributes(
  options: DropdownMenuItemAttributeOptions,
): PrimitiveDataAttributes {
  return mergeDataAttributes(
    dataState(dropdownMenuItemHighlighted(options) ? 'active' : 'inactive'),
    dataDisabled(dropdownMenuItemDisabled(options, options.itemValue)),
    dropdownMenuItemHighlighted(options) ? { 'data-highlighted': '' } : undefined,
  );
}

function dropdownMenuItemDisabled(
  state: DropdownMenuState & { itemDisabled?: boolean },
  value: string,
): boolean {
  return (
    state.disabled === true ||
    state.itemDisabled === true ||
    state.items?.find((item) => item.value === value)?.disabled === true
  );
}

function dropdownMenuItemActivationKey(key: string): boolean {
  return key === 'Enter' || key === ' ' || key === 'Spacebar';
}

function dropdownMenuTriggerOpenKey(key: string): boolean {
  return (
    key === 'Enter' || key === ' ' || key === 'Spacebar' || key === 'ArrowDown' || key === 'ArrowUp'
  );
}
