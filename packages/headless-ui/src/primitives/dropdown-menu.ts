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
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
  type TypeaheadState,
} from '../lib/index.js';

export interface DropdownMenuItem {
  disabled?: boolean;
  label?: string;
  textValue?: string;
  value: string;
}

export interface DropdownMenuState {
  disabled?: boolean;
  highlightedValue?: string;
  items?: readonly DropdownMenuItem[];
  open?: boolean;
}

export interface DropdownMenuRootAttributeOptions extends DropdownMenuState {
  id?: string;
}

export interface DropdownMenuTriggerAttributeOptions extends DropdownMenuState {
  contentId?: string;
  id?: string;
  labelledBy?: string;
}

export interface DropdownMenuContentAttributeOptions extends DropdownMenuState {
  id?: string;
  labelledBy?: string;
}

export interface DropdownMenuItemAttributeOptions extends DropdownMenuState {
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemValue: string;
}

export interface DropdownMenuGroupAttributeOptions extends DropdownMenuState {
  id?: string;
  labelledBy?: string;
}

export interface DropdownMenuSeparatorAttributeOptions {
  id?: string;
}

export type DropdownMenuOpenChangeReason =
  | 'arrow-key'
  | 'escape-key'
  | 'item-select'
  | 'programmatic'
  | 'trigger-click';

export type DropdownMenuSelectReason = 'item-click' | 'programmatic';

export type DropdownMenuOpenChangeDetail = PrimitiveChangeDetail<
  DropdownMenuOpenChangeReason,
  boolean
>;

export type DropdownMenuSelectDetail = PrimitiveChangeDetail<DropdownMenuSelectReason, string>;

export interface DropdownMenuChangeOptions {
  onOpenChange?: (detail: DropdownMenuOpenChangeDetail) => void;
  onSelect?: (detail: DropdownMenuSelectDetail) => void;
}

export interface DropdownMenuOpenChangeResult {
  changed: boolean;
  detail?: DropdownMenuOpenChangeDetail;
  open: boolean;
}

export interface DropdownMenuSelectResult {
  detail?: DropdownMenuSelectDetail;
  open: DropdownMenuOpenChangeResult;
  selected: boolean;
  value: string;
}

export interface DropdownMenuMoveResult {
  highlightedIndex: number;
  highlightedValue: string | undefined;
}

export interface DropdownMenuTypeaheadOptions {
  currentValue?: string;
  loop?: boolean;
  now: number;
  state?: TypeaheadState;
  timeoutMs?: number;
}

export interface DropdownMenuTypeaheadResult extends DropdownMenuMoveResult {
  state: TypeaheadState;
}

export type DropdownMenuPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

export type DropdownMenuTriggerEvent = Event;
export type DropdownMenuItemEvent = Event;
export type DropdownMenuKeyboardEvent = Event & { readonly key: string };

export function dropdownMenuRootAttributes(
  options: DropdownMenuRootAttributeOptions = {},
): DropdownMenuPrimitiveAttributes {
  return Object.freeze({
    ...dropdownMenuDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

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

export function dropdownMenuSeparatorAttributes(
  options: DropdownMenuSeparatorAttributeOptions = {},
): DropdownMenuPrimitiveAttributes {
  return Object.freeze({
    role: 'separator',
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

export function dropdownMenuItemHighlighted(options: DropdownMenuItemAttributeOptions): boolean {
  return options.highlightedValue === options.itemValue;
}

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

export function toggleDropdownMenu(
  state: DropdownMenuState,
  reason: DropdownMenuOpenChangeReason,
  options: DropdownMenuChangeOptions = {},
): DropdownMenuOpenChangeResult {
  return setDropdownMenuOpen(state, !(state.open === true), reason, options);
}

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

  return {
    detail,
    open: setDropdownMenuOpen(state, false, 'item-select', options),
    selected: true,
    value,
  };
}

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
 * @jisoPrimitiveHandler
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
 * @jisoPrimitiveHandler
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
 * @jisoPrimitiveHandler
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
