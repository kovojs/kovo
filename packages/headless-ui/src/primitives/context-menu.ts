import {
  createCollectionAdapter,
  dataDisabled,
  dataState,
  dispatchCancelableChange,
  mergeDataAttributes,
  isActivationKey,
  setOpenState,
  openState,
  scheduleDeferred,
  triggerAttributes,
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
 * declare const value: ContextMenuPoint;
 * ```
 *
 *
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
 * declare const value: ContextMenuItem;
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
 * declare const value: ContextMenuState;
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
 * declare const value: ContextMenuRootAttributeOptions;
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
 * declare const value: ContextMenuTriggerAttributeOptions;
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
 * declare const value: ContextMenuContentAttributeOptions;
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
 * declare const value: ContextMenuItemAttributeOptions;
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
 * declare const value: ContextMenuGroupAttributeOptions;
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
 * declare const value: ContextMenuSeparatorAttributeOptions;
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
 * declare const value: ContextMenuOpenChangeReason;
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
 * declare const value: ContextMenuSelectReason;
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
 * declare const value: ContextMenuOpenChangeDetail;
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
 * declare const value: ContextMenuSelectDetail;
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
 * declare const value: ContextMenuChangeOptions;
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
 * declare const value: ContextMenuOpenChangeResult;
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
 * declare const value: ContextMenuSelectResult;
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
 * declare const value: ContextMenuMoveResult;
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
 * declare const value: ContextMenuTypeaheadOptions;
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
 * declare const value: ContextMenuTypeaheadResult;
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
 * declare const value: ContextMenuPrimitiveAttributes;
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
 * declare const value: ContextMenuTriggerEvent;
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
 * declare const value: ContextMenuItemEvent;
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
 * declare const value: ContextMenuKeyboardEvent;
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
 * declare const value: ContextMenuFocusEvent;
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
 * declare const value: ContextMenuFocusOptions;
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
 * declare const input: Parameters<typeof contextMenuRootAttributes>[0];
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
 * declare const input: Parameters<typeof contextMenuTriggerAttributes>[0];
 * const result = contextMenuTriggerAttributes(input);
 * ```
 */
export function contextMenuTriggerAttributes(
  options: ContextMenuTriggerAttributeOptions = {},
): ContextMenuPrimitiveAttributes {
  const trigger = triggerAttributes({
    controlsId: options.contentId,
    disabled: options.disabled === true,
    disabledBehavior: 'aria',
    haspopup: 'menu',
    labelledBy: options.labelledBy,
    open: options.open === true,
    stripControlsWhenDisabled: true,
  });
  const controlsId =
    typeof trigger['aria-controls'] === 'string' ? trigger['aria-controls'] : undefined;

  return Object.freeze({
    ...contextMenuDataAttributes(options),
    role: 'button',
    ...trigger,
    ...(controlsId === undefined ? {} : { 'kovo-context-menu': controlsId }),
    ...(options.id === undefined ? {} : { id: options.id }),
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
 * declare const input: Parameters<typeof contextMenuContentAttributes>[0];
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
 * declare const input: Parameters<typeof contextMenuItemAttributes>[0];
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
 * declare const input: Parameters<typeof contextMenuGroupAttributes>[0];
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
 * declare const input: Parameters<typeof contextMenuSeparatorAttributes>[0];
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
 * declare const input: Parameters<typeof contextMenuItemHighlighted>[0];
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
 * declare const input: Parameters<typeof setContextMenuOpen>[0];
 * declare const state: Parameters<typeof setContextMenuOpen>[1];
 * declare const options: Parameters<typeof setContextMenuOpen>[2];
 * declare const detail: Parameters<typeof setContextMenuOpen>[3];
 * declare const extra: Parameters<typeof setContextMenuOpen>[4];
 * const result = setContextMenuOpen(input, state, options, detail, extra);
 * ```
 *
 * @internal
 */
export function setContextMenuOpen(
  state: ContextMenuState,
  open: boolean,
  reason: ContextMenuOpenChangeReason,
  options: ContextMenuChangeOptions = {},
  point?: ContextMenuPoint,
): ContextMenuOpenChangeResult {
  const result = setOpenState(
    { disabled: state.disabled, open: state.open === true },
    open,
    reason,
    { onOpenChange: options.onOpenChange },
  );

  return {
    ...result,
    ...((result.changed ? (point ?? state.point) : state.point)
      ? { point: result.changed ? (point ?? state.point) : state.point }
      : {}),
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
 * declare const input: Parameters<typeof toggleContextMenu>[0];
 * declare const state: Parameters<typeof toggleContextMenu>[1];
 * declare const options: Parameters<typeof toggleContextMenu>[2];
 * declare const detail: Parameters<typeof toggleContextMenu>[3];
 * const result = toggleContextMenu(input, state, options, detail);
 * ```
 *
 * @internal
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
 * declare const input: Parameters<typeof selectContextMenuItem>[0];
 * declare const state: Parameters<typeof selectContextMenuItem>[1];
 * declare const options: Parameters<typeof selectContextMenuItem>[2];
 * declare const detail: Parameters<typeof selectContextMenuItem>[3];
 * const result = selectContextMenuItem(input, state, options, detail);
 * ```
 *
 * @internal
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
 * declare const input: Parameters<typeof contextMenuMove>[0];
 * declare const state: Parameters<typeof contextMenuMove>[1];
 * declare const options: Parameters<typeof contextMenuMove>[2];
 * const result = contextMenuMove(input, state, options);
 * ```
 *
 * @internal
 */
export function contextMenuMove(
  state: ContextMenuState,
  key: string,
  options: { loop?: boolean } = {},
): ContextMenuMoveResult | undefined {
  return contextMenuCollection.move(state, {
    currentValue: state.highlightedValue,
    disabled: state.disabled,
    key,
    loop: options.loop,
  });
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
 * declare const input: Parameters<typeof contextMenuTypeahead>[0];
 * declare const state: Parameters<typeof contextMenuTypeahead>[1];
 * declare const options: Parameters<typeof contextMenuTypeahead>[2];
 * const result = contextMenuTypeahead(input, state, options);
 * ```
 *
 * @internal
 */
export function contextMenuTypeahead(
  state: ContextMenuState,
  key: string,
  options: ContextMenuTypeaheadOptions,
): ContextMenuTypeaheadResult {
  const result = contextMenuCollection.typeahead(key, state, {
    currentValue: options.currentValue ?? state.highlightedValue,
    disabled: state.disabled,
    loop: options.loop,
    now: options.now,
    state: options.state,
    timeoutMs: options.timeoutMs,
  });

  return {
    highlightedIndex: result.matchIndex,
    highlightedValue: result.value,
    state: result.state,
  };
}

/**
 * Computes context menu trigger context menu for the Context Menu primitive.
 *
 * @example
 * ```ts
 * import { contextMenuTriggerContextMenu } from '@kovojs/headless-ui/context-menu';
 *
 * declare const input: Parameters<typeof contextMenuTriggerContextMenu>[0];
 * declare const state: Parameters<typeof contextMenuTriggerContextMenu>[1];
 * declare const options: Parameters<typeof contextMenuTriggerContextMenu>[2];
 * const result = contextMenuTriggerContextMenu(input, state, options);
 * ```
 *
 * @generated
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
 * declare const input: Parameters<typeof contextMenuTriggerKeyDown>[0];
 * declare const state: Parameters<typeof contextMenuTriggerKeyDown>[1];
 * declare const options: Parameters<typeof contextMenuTriggerKeyDown>[2];
 * const result = contextMenuTriggerKeyDown(input, state, options);
 * ```
 *
 * @generated
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
 * declare const input: Parameters<typeof contextMenuItemClick>[0];
 * declare const state: Parameters<typeof contextMenuItemClick>[1];
 * declare const options: Parameters<typeof contextMenuItemClick>[2];
 * const result = contextMenuItemClick(input, state, options);
 * ```
 *
 * @generated
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
 * declare const input: Parameters<typeof contextMenuItemKeyDown>[0];
 * declare const state: Parameters<typeof contextMenuItemKeyDown>[1];
 * declare const options: Parameters<typeof contextMenuItemKeyDown>[2];
 * const result = contextMenuItemKeyDown(input, state, options);
 * ```
 *
 * @generated
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
 * declare const input: Parameters<typeof contextMenuKeyDown>[0];
 * declare const state: Parameters<typeof contextMenuKeyDown>[1];
 * declare const options: Parameters<typeof contextMenuKeyDown>[2];
 * const result = contextMenuKeyDown(input, state, options);
 * ```
 *
 * @generated
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
 * declare const input: Parameters<typeof contextMenuPointFromEvent>[0];
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
 * declare const input: Parameters<typeof contextMenuFocusElement>[0];
 * declare const state: Parameters<typeof contextMenuFocusElement>[1];
 * declare const options: Parameters<typeof contextMenuFocusElement>[2];
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

const contextMenuCollection = createCollectionAdapter({
  getItems: (state: ContextMenuState) => state.items,
  projector: contextMenuCollectionItem,
});

function contextMenuCollectionItem(item: ContextMenuItem) {
  return {
    ...(item.disabled === undefined ? {} : { disabled: item.disabled }),
    textValue: item.textValue ?? item.label ?? item.value,
    value: item.value,
  };
}

function contextMenuItemActivationKey(key: string): boolean {
  return isActivationKey(key);
}
