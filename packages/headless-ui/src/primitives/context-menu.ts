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

export interface ContextMenuPoint {
  x: number;
  y: number;
}

export interface ContextMenuItem {
  disabled?: boolean;
  label?: string;
  textValue?: string;
  value: string;
}

export interface ContextMenuState {
  disabled?: boolean;
  highlightedValue?: string;
  items?: readonly ContextMenuItem[];
  open?: boolean;
  point?: ContextMenuPoint;
}

export interface ContextMenuRootAttributeOptions extends ContextMenuState {
  id?: string;
}

export interface ContextMenuTriggerAttributeOptions extends ContextMenuState {
  contentId?: string;
  id?: string;
  labelledBy?: string;
}

export interface ContextMenuContentAttributeOptions extends ContextMenuState {
  id?: string;
  labelledBy?: string;
}

export interface ContextMenuItemAttributeOptions extends ContextMenuState {
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemValue: string;
}

export interface ContextMenuGroupAttributeOptions extends ContextMenuState {
  id?: string;
  labelledBy?: string;
}

export interface ContextMenuSeparatorAttributeOptions {
  id?: string;
}

export type ContextMenuOpenChangeReason =
  | 'escape-key'
  | 'item-select'
  | 'keyboard-open'
  | 'programmatic'
  | 'trigger-context-menu';

export type ContextMenuSelectReason = 'item-click' | 'item-keyboard' | 'programmatic';

export type ContextMenuOpenChangeDetail = PrimitiveChangeDetail<
  ContextMenuOpenChangeReason,
  boolean
>;

export type ContextMenuSelectDetail = PrimitiveChangeDetail<ContextMenuSelectReason, string>;

export interface ContextMenuChangeOptions {
  onOpenChange?: (detail: ContextMenuOpenChangeDetail) => void;
  onSelect?: (detail: ContextMenuSelectDetail) => void;
}

export interface ContextMenuOpenChangeResult {
  changed: boolean;
  detail?: ContextMenuOpenChangeDetail;
  open: boolean;
  point?: ContextMenuPoint;
}

export interface ContextMenuSelectResult {
  detail?: ContextMenuSelectDetail;
  open: ContextMenuOpenChangeResult;
  selected: boolean;
  value: string;
}

export interface ContextMenuMoveResult {
  highlightedIndex: number;
  highlightedValue: string | undefined;
}

export interface ContextMenuTypeaheadOptions {
  currentValue?: string;
  loop?: boolean;
  now: number;
  state?: TypeaheadState;
  timeoutMs?: number;
}

export interface ContextMenuTypeaheadResult extends ContextMenuMoveResult {
  state: TypeaheadState;
}

export type ContextMenuPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

export type ContextMenuTriggerEvent = Event & Readonly<{ clientX?: number; clientY?: number }>;
export type ContextMenuItemEvent = Event;
export type ContextMenuKeyboardEvent = Event & {
  readonly key: string;
  readonly shiftKey?: boolean;
};
export type ContextMenuFocusEvent = Event & {
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
export interface ContextMenuFocusOptions {
  defer?: boolean;
  schedule?: (callback: () => void) => void;
}

export function contextMenuRootAttributes(
  options: ContextMenuRootAttributeOptions = {},
): ContextMenuPrimitiveAttributes {
  return Object.freeze({
    ...contextMenuDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

export function contextMenuTriggerAttributes(
  options: ContextMenuTriggerAttributeOptions = {},
): ContextMenuPrimitiveAttributes {
  const enabledContentId = options.disabled === true ? undefined : options.contentId;

  return Object.freeze({
    ...contextMenuDataAttributes(options),
    'aria-expanded': String(options.open === true),
    'aria-haspopup': 'menu',
    role: 'button',
    ...(options.disabled === true ? { 'aria-disabled': 'true' } : {}),
    ...(enabledContentId === undefined
      ? {}
      : {
          'aria-controls': enabledContentId,
          'jiso-context-menu': enabledContentId,
        }),
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
  });
}

export function contextMenuContentAttributes(
  options: ContextMenuContentAttributeOptions = {},
): ContextMenuPrimitiveAttributes {
  return Object.freeze({
    ...contextMenuDataAttributes(options),
    role: 'menu',
    tabIndex: -1,
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
    ...(options.open === true ? {} : { hidden: true }),
    ...(options.point === undefined
      ? {}
      : {
          'data-anchor-x': String(options.point.x),
          'data-anchor-y': String(options.point.y),
        }),
  });
}

export function contextMenuItemAttributes(
  options: ContextMenuItemAttributeOptions,
): ContextMenuPrimitiveAttributes {
  const disabled = contextMenuItemDisabled(options, options.itemValue);
  const highlighted = contextMenuItemHighlighted(options);

  return Object.freeze({
    ...contextMenuItemDataAttributes(options),
    role: 'menuitem',
    tabIndex: highlighted && !disabled ? 0 : -1,
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(disabled ? { 'aria-disabled': 'true' } : {}),
    ...(options.itemLabel === undefined ? {} : { label: options.itemLabel }),
    value: options.itemValue,
  });
}

export function contextMenuGroupAttributes(
  options: ContextMenuGroupAttributeOptions = {},
): ContextMenuPrimitiveAttributes {
  return Object.freeze({
    ...contextMenuDataAttributes(options),
    role: 'group',
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
  });
}

export function contextMenuSeparatorAttributes(
  options: ContextMenuSeparatorAttributeOptions = {},
): ContextMenuPrimitiveAttributes {
  return Object.freeze({
    role: 'separator',
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

export function contextMenuItemHighlighted(options: ContextMenuItemAttributeOptions): boolean {
  return options.highlightedValue === options.itemValue;
}

export function setContextMenuOpen(
  state: ContextMenuState,
  open: boolean,
  reason: ContextMenuOpenChangeReason,
  options: ContextMenuChangeOptions = {},
  point?: ContextMenuPoint,
): ContextMenuOpenChangeResult {
  if (state.disabled || state.open === open) {
    return {
      changed: false,
      open: state.open === true,
      ...(state.point ? { point: state.point } : {}),
    };
  }

  const detail = dispatchCancelableChange({ reason, value: open }, options.onOpenChange);
  if (detail.defaultPrevented) {
    return {
      changed: false,
      detail,
      open: state.open === true,
      ...(state.point ? { point: state.point } : {}),
    };
  }

  return {
    changed: true,
    detail,
    open,
    ...((point ?? state.point) ? { point: point ?? state.point } : {}),
  };
}

export function toggleContextMenu(
  state: ContextMenuState,
  reason: ContextMenuOpenChangeReason,
  options: ContextMenuChangeOptions = {},
  point?: ContextMenuPoint,
): ContextMenuOpenChangeResult {
  return setContextMenuOpen(state, !(state.open === true), reason, options, point);
}

export function selectContextMenuItem(
  state: ContextMenuState,
  value: string,
  reason: ContextMenuSelectReason,
  options: ContextMenuChangeOptions = {},
): ContextMenuSelectResult {
  if (state.disabled || contextMenuItemDisabled(state, value)) {
    return {
      open: {
        changed: false,
        open: state.open === true,
        ...(state.point ? { point: state.point } : {}),
      },
      selected: false,
      value,
    };
  }

  const detail = dispatchCancelableChange({ reason, value }, options.onSelect);
  if (detail.defaultPrevented) {
    return {
      detail,
      open: {
        changed: false,
        open: state.open === true,
        ...(state.point ? { point: state.point } : {}),
      },
      selected: false,
      value,
    };
  }

  const openResult = setContextMenuOpen(state, false, 'item-select', options);
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

export function contextMenuMove(
  state: ContextMenuState,
  key: string,
  options: { loop?: boolean } = {},
): ContextMenuMoveResult | undefined {
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

export function contextMenuTypeahead(
  state: ContextMenuState,
  key: string,
  options: ContextMenuTypeaheadOptions,
): ContextMenuTypeaheadResult {
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
export function contextMenuTriggerContextMenu(
  event: ContextMenuTriggerEvent,
  state: ContextMenuState,
  options: ContextMenuChangeOptions = {},
): ContextMenuOpenChangeResult | undefined {
  if (event.defaultPrevented) return;

  const result = setContextMenuOpen(
    state,
    true,
    'trigger-context-menu',
    options,
    contextMenuPointFromEvent(event),
  );
  if (!state.disabled) {
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
export function contextMenuTriggerKeyDown(
  event: ContextMenuKeyboardEvent,
  state: ContextMenuState,
  options: ContextMenuChangeOptions = {},
): ContextMenuOpenChangeResult | undefined {
  if (event.defaultPrevented) return;
  if (event.key !== 'ContextMenu' && !(event.shiftKey === true && event.key === 'F10')) return;

  const result = setContextMenuOpen(state, true, 'keyboard-open', options);
  if (result.changed) {
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
export function contextMenuItemClick(
  event: ContextMenuItemEvent,
  state: ContextMenuItemAttributeOptions,
  options: ContextMenuChangeOptions = {},
): ContextMenuSelectResult | undefined {
  if (event.defaultPrevented) return;

  const result = selectContextMenuItem(state, state.itemValue, 'item-click', options);
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
export function contextMenuItemKeyDown(
  event: ContextMenuKeyboardEvent,
  state: ContextMenuItemAttributeOptions,
  options: ContextMenuChangeOptions = {},
): ContextMenuSelectResult | undefined {
  if (event.defaultPrevented) return;
  if (!contextMenuItemActivationKey(event.key)) return;

  const result = selectContextMenuItem(state, state.itemValue, 'item-keyboard', options);
  event.preventDefault();

  return result;
}

/**
 * @jisoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function contextMenuKeyDown(
  event: ContextMenuKeyboardEvent,
  state: ContextMenuState,
  options: ContextMenuChangeOptions = {},
): ContextMenuOpenChangeResult | undefined {
  if (event.defaultPrevented) return;

  if (event.key === 'Escape') {
    const result = setContextMenuOpen(state, false, 'escape-key', options);
    if (result.changed) event.preventDefault();
    return result;
  }

  return undefined;
}

export function contextMenuPointFromEvent(event: ContextMenuTriggerEvent): ContextMenuPoint {
  return { x: event.clientX ?? 0, y: event.clientY ?? 0 };
}

export function contextMenuFocusElement(
  event: ContextMenuFocusEvent,
  id: string | undefined,
  options: ContextMenuFocusOptions = {},
): boolean {
  if (!id) return false;

  const ownerDocument = event.currentTarget?.ownerDocument ?? event.target?.ownerDocument;
  const target = ownerDocument?.getElementById?.(id);
  if (typeof (target as { focus?: unknown } | undefined)?.focus !== 'function') return false;

  const focus = () => {
    (target as { focus(): void }).focus();
  };
  if (options.defer === true) {
    (options.schedule ?? ((callback) => setTimeout(callback, 0)))(focus);
  } else {
    focus();
  }
  return true;
}

function contextMenuDataAttributes(state: ContextMenuState): PrimitiveDataAttributes {
  return mergeDataAttributes(openState(state.open === true), dataDisabled(state.disabled === true));
}

function contextMenuItemDataAttributes(
  options: ContextMenuItemAttributeOptions,
): PrimitiveDataAttributes {
  return mergeDataAttributes(
    dataState(contextMenuItemHighlighted(options) ? 'active' : 'inactive'),
    dataDisabled(contextMenuItemDisabled(options, options.itemValue)),
    contextMenuItemHighlighted(options) ? { 'data-highlighted': '' } : undefined,
  );
}

function contextMenuItemDisabled(
  state: ContextMenuState & { itemDisabled?: boolean },
  value: string,
): boolean {
  return (
    state.disabled === true ||
    state.itemDisabled === true ||
    state.items?.find((item) => item.value === value)?.disabled === true
  );
}

function contextMenuItemActivationKey(key: string): boolean {
  return key === 'Enter' || key === ' ' || key === 'Spacebar';
}
