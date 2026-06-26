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
 * Public interface used by the Context Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ContextMenuPoint } from '@kovojs/headless-ui/context-menu';
 *
 * const value: ContextMenuPoint = {} as ContextMenuPoint;
 * ```
 */
export interface ContextMenuPoint {
  x: number;
  y: number;
}

/**
 * Public interface used by the Context Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ContextMenuItem } from '@kovojs/headless-ui/context-menu';
 *
 * const value: ContextMenuItem = {} as ContextMenuItem;
 * ```
 */
export interface ContextMenuItem {
  disabled?: boolean;
  label?: string;
  textValue?: string;
  value: string;
}

/**
 * State snapshot consumed by the Context Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ContextMenuState } from '@kovojs/headless-ui/context-menu';
 *
 * const value: ContextMenuState = {} as ContextMenuState;
 * ```
 */
export interface ContextMenuState {
  disabled?: boolean;
  highlightedValue?: string;
  items?: readonly ContextMenuItem[];
  open?: boolean;
  point?: ContextMenuPoint;
}

/**
 * Options accepted by the Context Menu primitive context menu root attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ContextMenuRootAttributeOptions } from '@kovojs/headless-ui/context-menu';
 *
 * const value: ContextMenuRootAttributeOptions = {} as ContextMenuRootAttributeOptions;
 * ```
 */
export interface ContextMenuRootAttributeOptions extends ContextMenuState {
  id?: string;
}

/**
 * Options accepted by the Context Menu primitive context menu trigger attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ContextMenuTriggerAttributeOptions } from '@kovojs/headless-ui/context-menu';
 *
 * const value: ContextMenuTriggerAttributeOptions = {} as ContextMenuTriggerAttributeOptions;
 * ```
 */
export interface ContextMenuTriggerAttributeOptions extends ContextMenuState {
  contentId?: string;
  id?: string;
  labelledBy?: string;
}

/**
 * Options accepted by the Context Menu primitive context menu content attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ContextMenuContentAttributeOptions } from '@kovojs/headless-ui/context-menu';
 *
 * const value: ContextMenuContentAttributeOptions = {} as ContextMenuContentAttributeOptions;
 * ```
 */
export interface ContextMenuContentAttributeOptions extends ContextMenuState {
  id?: string;
  labelledBy?: string;
}

/**
 * Options accepted by the Context Menu primitive context menu item attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ContextMenuItemAttributeOptions } from '@kovojs/headless-ui/context-menu';
 *
 * const value: ContextMenuItemAttributeOptions = {} as ContextMenuItemAttributeOptions;
 * ```
 */
export interface ContextMenuItemAttributeOptions extends ContextMenuState {
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemValue: string;
}

/**
 * Options accepted by the Context Menu primitive context menu group attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ContextMenuGroupAttributeOptions } from '@kovojs/headless-ui/context-menu';
 *
 * const value: ContextMenuGroupAttributeOptions = {} as ContextMenuGroupAttributeOptions;
 * ```
 */
export interface ContextMenuGroupAttributeOptions extends ContextMenuState {
  id?: string;
  labelledBy?: string;
}

/**
 * Options accepted by the Context Menu primitive context menu separator attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ContextMenuSeparatorAttributeOptions } from '@kovojs/headless-ui/context-menu';
 *
 * const value: ContextMenuSeparatorAttributeOptions = {} as ContextMenuSeparatorAttributeOptions;
 * ```
 */
export interface ContextMenuSeparatorAttributeOptions {
  id?: string;
}

/**
 * Reason token reported by the Context Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ContextMenuOpenChangeReason } from '@kovojs/headless-ui/context-menu';
 *
 * const value: ContextMenuOpenChangeReason = {} as ContextMenuOpenChangeReason;
 * ```
 */
export type ContextMenuOpenChangeReason =
  | 'escape-key'
  | 'item-select'
  | 'keyboard-open'
  | 'programmatic'
  | 'trigger-context-menu';

/**
 * Reason token reported by the Context Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ContextMenuSelectReason } from '@kovojs/headless-ui/context-menu';
 *
 * const value: ContextMenuSelectReason = {} as ContextMenuSelectReason;
 * ```
 */
export type ContextMenuSelectReason = 'item-click' | 'item-keyboard' | 'programmatic';

/**
 * Cancelable change detail emitted by the Context Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ContextMenuOpenChangeDetail } from '@kovojs/headless-ui/context-menu';
 *
 * const value: ContextMenuOpenChangeDetail = {} as ContextMenuOpenChangeDetail;
 * ```
 */
export type ContextMenuOpenChangeDetail = PrimitiveChangeDetail<
  ContextMenuOpenChangeReason,
  boolean
>;

/**
 * Cancelable change detail emitted by the Context Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ContextMenuSelectDetail } from '@kovojs/headless-ui/context-menu';
 *
 * const value: ContextMenuSelectDetail = {} as ContextMenuSelectDetail;
 * ```
 */
export type ContextMenuSelectDetail = PrimitiveChangeDetail<ContextMenuSelectReason, string>;

/**
 * Options accepted by the Context Menu primitive context menu change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ContextMenuChangeOptions } from '@kovojs/headless-ui/context-menu';
 *
 * const value: ContextMenuChangeOptions = {} as ContextMenuChangeOptions;
 * ```
 */
export interface ContextMenuChangeOptions {
  onOpenChange?: (detail: ContextMenuOpenChangeDetail) => void;
  onSelect?: (detail: ContextMenuSelectDetail) => void;
}

/**
 * Result returned by the Context Menu primitive context menu open change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ContextMenuOpenChangeResult } from '@kovojs/headless-ui/context-menu';
 *
 * const value: ContextMenuOpenChangeResult = {} as ContextMenuOpenChangeResult;
 * ```
 */
export interface ContextMenuOpenChangeResult {
  changed: boolean;
  detail?: ContextMenuOpenChangeDetail;
  open: boolean;
  point?: ContextMenuPoint;
}

/**
 * Result returned by the Context Menu primitive context menu select.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ContextMenuSelectResult } from '@kovojs/headless-ui/context-menu';
 *
 * const value: ContextMenuSelectResult = {} as ContextMenuSelectResult;
 * ```
 */
export interface ContextMenuSelectResult {
  detail?: ContextMenuSelectDetail;
  open: ContextMenuOpenChangeResult;
  selected: boolean;
  value: string;
}

/**
 * Result returned by the Context Menu primitive context menu move.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ContextMenuMoveResult } from '@kovojs/headless-ui/context-menu';
 *
 * const value: ContextMenuMoveResult = {} as ContextMenuMoveResult;
 * ```
 */
export interface ContextMenuMoveResult {
  highlightedIndex: number;
  highlightedValue: string | undefined;
}

/**
 * Options accepted by the Context Menu primitive context menu typeahead.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ContextMenuTypeaheadOptions } from '@kovojs/headless-ui/context-menu';
 *
 * const value: ContextMenuTypeaheadOptions = {} as ContextMenuTypeaheadOptions;
 * ```
 */
export interface ContextMenuTypeaheadOptions {
  currentValue?: string;
  loop?: boolean;
  now: number;
  state?: TypeaheadState;
  timeoutMs?: number;
}

/**
 * Result returned by the Context Menu primitive context menu typeahead.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ContextMenuTypeaheadResult } from '@kovojs/headless-ui/context-menu';
 *
 * const value: ContextMenuTypeaheadResult = {} as ContextMenuTypeaheadResult;
 * ```
 */
export interface ContextMenuTypeaheadResult extends ContextMenuMoveResult {
  state: TypeaheadState;
}

/**
 * Serializable attribute record returned by Context Menu primitive builders.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ContextMenuPrimitiveAttributes } from '@kovojs/headless-ui/context-menu';
 *
 * const value: ContextMenuPrimitiveAttributes = {} as ContextMenuPrimitiveAttributes;
 * ```
 */
export type ContextMenuPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

/**
 * Event shape consumed by the Context Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ContextMenuTriggerEvent } from '@kovojs/headless-ui/context-menu';
 *
 * const value: ContextMenuTriggerEvent = {} as ContextMenuTriggerEvent;
 * ```
 */
export type ContextMenuTriggerEvent = Event &
  Readonly<{
    clientX?: number;
    clientY?: number;
    // SPEC.md §4.4/§4.6: the inline loader sets this when it has already canceled
    // the native context menu synchronously (a chained handler runs after the
    // awaited import — too late to suppress the native menu). It lets this handler
    // tell that framework native-suppression apart from a genuine author
    // preventDefault, so it still opens the styled menu instead of bailing.
    kovoNativeDefaultManaged?: boolean;
  }>;

/**
 * Event shape consumed by the Context Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ContextMenuItemEvent } from '@kovojs/headless-ui/context-menu';
 *
 * const value: ContextMenuItemEvent = {} as ContextMenuItemEvent;
 * ```
 */
export type ContextMenuItemEvent = Event;

/**
 * Event shape consumed by the Context Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ContextMenuKeyboardEvent } from '@kovojs/headless-ui/context-menu';
 *
 * const value: ContextMenuKeyboardEvent = {} as ContextMenuKeyboardEvent;
 * ```
 */
export type ContextMenuKeyboardEvent = Event & {
  readonly key: string;
  readonly shiftKey?: boolean;
};

/**
 * Event shape consumed by the Context Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ContextMenuFocusEvent } from '@kovojs/headless-ui/context-menu';
 *
 * const value: ContextMenuFocusEvent = {} as ContextMenuFocusEvent;
 * ```
 */
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

/**
 * Options accepted by the Context Menu primitive context menu focus.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ContextMenuFocusOptions } from '@kovojs/headless-ui/context-menu';
 *
 * const value: ContextMenuFocusOptions = {} as ContextMenuFocusOptions;
 * ```
 */
export interface ContextMenuFocusOptions {
  defer?: boolean;
  schedule?: (callback: () => void) => void;
}

/**
 * Builds the context menu root attributes record for the Context Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { contextMenuRootAttributes } from '@kovojs/headless-ui/context-menu';
 *
 * const input = {} as Parameters<typeof contextMenuRootAttributes>[0];
 * const result = contextMenuRootAttributes(input);
 * ```
 */
export function contextMenuRootAttributes(
  options: ContextMenuRootAttributeOptions = {},
): ContextMenuPrimitiveAttributes {
  return Object.freeze({
    ...contextMenuDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

/**
 * Builds the context menu trigger attributes record for the Context Menu primitive.
 *
 * Emits `aria-controls`, `aria-disabled`, `aria-expanded`, `aria-haspopup`, `aria-labelledby`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { contextMenuTriggerAttributes } from '@kovojs/headless-ui/context-menu';
 *
 * const input = {} as Parameters<typeof contextMenuTriggerAttributes>[0];
 * const result = contextMenuTriggerAttributes(input);
 * ```
 */
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
          'kovo-context-menu': enabledContentId,
        }),
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
  });
}

/**
 * Builds the context menu content attributes record for the Context Menu primitive.
 *
 * Emits `aria-labelledby`, `data-anchor-x`, `data-anchor-y`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { contextMenuContentAttributes } from '@kovojs/headless-ui/context-menu';
 *
 * const input = {} as Parameters<typeof contextMenuContentAttributes>[0];
 * const result = contextMenuContentAttributes(input);
 * ```
 */
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

/**
 * Builds the context menu item attributes record for the Context Menu primitive.
 *
 * Emits `aria-disabled`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { contextMenuItemAttributes } from '@kovojs/headless-ui/context-menu';
 *
 * const input = {} as Parameters<typeof contextMenuItemAttributes>[0];
 * const result = contextMenuItemAttributes(input);
 * ```
 */
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

/**
 * Builds the context menu group attributes record for the Context Menu primitive.
 *
 * Emits `aria-labelledby`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { contextMenuGroupAttributes } from '@kovojs/headless-ui/context-menu';
 *
 * const input = {} as Parameters<typeof contextMenuGroupAttributes>[0];
 * const result = contextMenuGroupAttributes(input);
 * ```
 */
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

/**
 * Builds the context menu separator attributes record for the Context Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { contextMenuSeparatorAttributes } from '@kovojs/headless-ui/context-menu';
 *
 * const input = {} as Parameters<typeof contextMenuSeparatorAttributes>[0];
 * const result = contextMenuSeparatorAttributes(input);
 * ```
 */
export function contextMenuSeparatorAttributes(
  options: ContextMenuSeparatorAttributeOptions = {},
): ContextMenuPrimitiveAttributes {
  return Object.freeze({
    role: 'separator',
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

/**
 * Computes context menu item highlighted for the Context Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { contextMenuItemHighlighted } from '@kovojs/headless-ui/context-menu';
 *
 * const input = {} as Parameters<typeof contextMenuItemHighlighted>[0];
 * const result = contextMenuItemHighlighted(input);
 * ```
 */
export function contextMenuItemHighlighted(options: ContextMenuItemAttributeOptions): boolean {
  return options.highlightedValue === options.itemValue;
}

/**
 * Computes the set context menu open transition for the Context Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { setContextMenuOpen } from '@kovojs/headless-ui/context-menu';
 *
 * const input = {} as Parameters<typeof setContextMenuOpen>[0];
 * const state = {} as Parameters<typeof setContextMenuOpen>[1];
 * const options = {} as Parameters<typeof setContextMenuOpen>[2];
 * const detail = {} as Parameters<typeof setContextMenuOpen>[3];
 * const extra = {} as Parameters<typeof setContextMenuOpen>[4];
 * const result = setContextMenuOpen(input, state, options, detail, extra);
 * ```
 */
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

/**
 * Computes the toggle context menu transition for the Context Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toggleContextMenu } from '@kovojs/headless-ui/context-menu';
 *
 * const input = {} as Parameters<typeof toggleContextMenu>[0];
 * const state = {} as Parameters<typeof toggleContextMenu>[1];
 * const options = {} as Parameters<typeof toggleContextMenu>[2];
 * const detail = {} as Parameters<typeof toggleContextMenu>[3];
 * const result = toggleContextMenu(input, state, options, detail);
 * ```
 */
export function toggleContextMenu(
  state: ContextMenuState,
  reason: ContextMenuOpenChangeReason,
  options: ContextMenuChangeOptions = {},
  point?: ContextMenuPoint,
): ContextMenuOpenChangeResult {
  return setContextMenuOpen(state, !(state.open === true), reason, options, point);
}

/**
 * Computes the select context menu item transition for the Context Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { selectContextMenuItem } from '@kovojs/headless-ui/context-menu';
 *
 * const input = {} as Parameters<typeof selectContextMenuItem>[0];
 * const state = {} as Parameters<typeof selectContextMenuItem>[1];
 * const options = {} as Parameters<typeof selectContextMenuItem>[2];
 * const detail = {} as Parameters<typeof selectContextMenuItem>[3];
 * const result = selectContextMenuItem(input, state, options, detail);
 * ```
 */
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

/**
 * Computes context menu move for the Context Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { contextMenuMove } from '@kovojs/headless-ui/context-menu';
 *
 * const input = {} as Parameters<typeof contextMenuMove>[0];
 * const state = {} as Parameters<typeof contextMenuMove>[1];
 * const options = {} as Parameters<typeof contextMenuMove>[2];
 * const result = contextMenuMove(input, state, options);
 * ```
 */
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

/**
 * Computes context menu typeahead for the Context Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { contextMenuTypeahead } from '@kovojs/headless-ui/context-menu';
 *
 * const input = {} as Parameters<typeof contextMenuTypeahead>[0];
 * const state = {} as Parameters<typeof contextMenuTypeahead>[1];
 * const options = {} as Parameters<typeof contextMenuTypeahead>[2];
 * const result = contextMenuTypeahead(input, state, options);
 * ```
 */
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
 * Computes context menu trigger context menu for the Context Menu primitive.
 *
 * @example
 * ```ts
 * import { contextMenuTriggerContextMenu } from '@kovojs/headless-ui/context-menu';
 *
 * const input = {} as Parameters<typeof contextMenuTriggerContextMenu>[0];
 * const state = {} as Parameters<typeof contextMenuTriggerContextMenu>[1];
 * const options = {} as Parameters<typeof contextMenuTriggerContextMenu>[2];
 * const result = contextMenuTriggerContextMenu(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function contextMenuTriggerContextMenu(
  event: ContextMenuTriggerEvent,
  state: ContextMenuState,
  options: ContextMenuChangeOptions = {},
): ContextMenuOpenChangeResult | undefined {
  // Bail only when an author (or prior chained handler) prevented the default —
  // NOT when the inline loader has already canceled the native menu for us
  // (SPEC.md §4.4): that synchronous suppression sets kovoNativeDefaultManaged, and
  // this handler must still run to open the styled menu.
  if (event.defaultPrevented && event.kovoNativeDefaultManaged !== true) return;

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
 * Handles the context menu trigger key down interaction for the Context Menu primitive.
 *
 * @example
 * ```ts
 * import { contextMenuTriggerKeyDown } from '@kovojs/headless-ui/context-menu';
 *
 * const input = {} as Parameters<typeof contextMenuTriggerKeyDown>[0];
 * const state = {} as Parameters<typeof contextMenuTriggerKeyDown>[1];
 * const options = {} as Parameters<typeof contextMenuTriggerKeyDown>[2];
 * const result = contextMenuTriggerKeyDown(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
 * Handles the context menu item click interaction for the Context Menu primitive.
 *
 * @example
 * ```ts
 * import { contextMenuItemClick } from '@kovojs/headless-ui/context-menu';
 *
 * const input = {} as Parameters<typeof contextMenuItemClick>[0];
 * const state = {} as Parameters<typeof contextMenuItemClick>[1];
 * const options = {} as Parameters<typeof contextMenuItemClick>[2];
 * const result = contextMenuItemClick(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
 * Handles the context menu item key down interaction for the Context Menu primitive.
 *
 * @example
 * ```ts
 * import { contextMenuItemKeyDown } from '@kovojs/headless-ui/context-menu';
 *
 * const input = {} as Parameters<typeof contextMenuItemKeyDown>[0];
 * const state = {} as Parameters<typeof contextMenuItemKeyDown>[1];
 * const options = {} as Parameters<typeof contextMenuItemKeyDown>[2];
 * const result = contextMenuItemKeyDown(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
 * Handles the context menu key down interaction for the Context Menu primitive.
 *
 * @example
 * ```ts
 * import { contextMenuKeyDown } from '@kovojs/headless-ui/context-menu';
 *
 * const input = {} as Parameters<typeof contextMenuKeyDown>[0];
 * const state = {} as Parameters<typeof contextMenuKeyDown>[1];
 * const options = {} as Parameters<typeof contextMenuKeyDown>[2];
 * const result = contextMenuKeyDown(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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

/**
 * Computes context menu point from event for the Context Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { contextMenuPointFromEvent } from '@kovojs/headless-ui/context-menu';
 *
 * const input = {} as Parameters<typeof contextMenuPointFromEvent>[0];
 * const result = contextMenuPointFromEvent(input);
 * ```
 */
export function contextMenuPointFromEvent(event: ContextMenuTriggerEvent): ContextMenuPoint {
  return { x: event.clientX ?? 0, y: event.clientY ?? 0 };
}

/**
 * Handles the context menu focus element interaction for the Context Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { contextMenuFocusElement } from '@kovojs/headless-ui/context-menu';
 *
 * const input = {} as Parameters<typeof contextMenuFocusElement>[0];
 * const state = {} as Parameters<typeof contextMenuFocusElement>[1];
 * const options = {} as Parameters<typeof contextMenuFocusElement>[2];
 * const result = contextMenuFocusElement(input, state, options);
 * ```
 */
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
    // SPEC §4.3/§4.8: defer focus past the runtime update plan so the target is
    // revealed (un-hidden) before `.focus()` runs; see scheduleDeferred.
    (options.schedule ?? scheduleDeferred)(focus);
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
