import {
  dataDisabled,
  dataOrientation,
  mergeDataAttributes,
  moveCollectionIndex,
  navigationIntentFromKey,
  type NavigationIntent,
  type PrimitiveDataAttributes,
  type TextDirection,
} from '../lib/index.js';

/**
 * Public type used by the Toolbar primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToolbarOrientation } from '@kovojs/headless-ui/toolbar';
 *
 * const value: ToolbarOrientation = {} as ToolbarOrientation;
 * ```
 */
export type ToolbarOrientation = 'horizontal' | 'vertical';

/**
 * Public interface used by the Toolbar primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToolbarItem } from '@kovojs/headless-ui/toolbar';
 *
 * const value: ToolbarItem = {} as ToolbarItem;
 * ```
 */
export interface ToolbarItem {
  disabled?: boolean;
  value: string;
}

/**
 * State snapshot consumed by the Toolbar primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToolbarState } from '@kovojs/headless-ui/toolbar';
 *
 * const value: ToolbarState = {} as ToolbarState;
 * ```
 */
export interface ToolbarState {
  activeValue?: string;
  dir?: TextDirection;
  disabled?: boolean;
  items?: readonly ToolbarItem[];
  loop?: boolean;
  orientation?: ToolbarOrientation;
}

/**
 * Options accepted by the Toolbar primitive toolbar root attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToolbarRootAttributeOptions } from '@kovojs/headless-ui/toolbar';
 *
 * const value: ToolbarRootAttributeOptions = {} as ToolbarRootAttributeOptions;
 * ```
 */
export interface ToolbarRootAttributeOptions extends ToolbarState {
  descriptionId?: string;
  id?: string;
  label?: string;
  labelledBy?: string;
}

/**
 * Options accepted by the Toolbar primitive toolbar item attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToolbarItemAttributeOptions } from '@kovojs/headless-ui/toolbar';
 *
 * const value: ToolbarItemAttributeOptions = {} as ToolbarItemAttributeOptions;
 * ```
 */
export interface ToolbarItemAttributeOptions extends ToolbarState {
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
}

/**
 * Options accepted by the Toolbar primitive toolbar button attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToolbarButtonAttributeOptions } from '@kovojs/headless-ui/toolbar';
 *
 * const value: ToolbarButtonAttributeOptions = {} as ToolbarButtonAttributeOptions;
 * ```
 */
export interface ToolbarButtonAttributeOptions extends ToolbarItemAttributeOptions {
  pressed?: boolean;
}

/**
 * Result returned by the Toolbar primitive toolbar move.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToolbarMoveResult } from '@kovojs/headless-ui/toolbar';
 *
 * const value: ToolbarMoveResult = {} as ToolbarMoveResult;
 * ```
 */
export interface ToolbarMoveResult {
  index: number;
  value: string | undefined;
}

/**
 * Serializable attribute record returned by Toolbar primitive builders.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToolbarPrimitiveAttributes } from '@kovojs/headless-ui/toolbar';
 *
 * const value: ToolbarPrimitiveAttributes = {} as ToolbarPrimitiveAttributes;
 * ```
 */
export type ToolbarPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

/**
 * Event shape consumed by the Toolbar primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ToolbarKeyboardEvent } from '@kovojs/headless-ui/toolbar';
 *
 * const value: ToolbarKeyboardEvent = {} as ToolbarKeyboardEvent;
 * ```
 */
export type ToolbarKeyboardEvent = Event & { readonly key: string };

/**
 * Computes toolbar roving index for the Toolbar primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toolbarRovingIndex } from '@kovojs/headless-ui/toolbar';
 *
 * const input = {} as Parameters<typeof toolbarRovingIndex>[0];
 * const result = toolbarRovingIndex(input);
 * ```
 */
export function toolbarRovingIndex(state: ToolbarState): number {
  const items = state.items ?? [];
  if (items.length === 0) return -1;

  const activeIndex = items.findIndex(
    (item) => item.value === state.activeValue && !toolbarItemDisabled(state, item.value),
  );
  if (activeIndex >= 0) return activeIndex;

  return moveCollectionIndex('first', {
    currentIndex: -1,
    items: toolbarNavigationItems(state),
  });
}

/**
 * Builds the toolbar root attributes record for the Toolbar primitive.
 *
 * Emits `aria-describedby`, `aria-disabled`, `aria-label`, `aria-labelledby`, `aria-orientation`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toolbarRootAttributes } from '@kovojs/headless-ui/toolbar';
 *
 * const input = {} as Parameters<typeof toolbarRootAttributes>[0];
 * const result = toolbarRootAttributes(input);
 * ```
 */
export function toolbarRootAttributes(
  options: ToolbarRootAttributeOptions = {},
): ToolbarPrimitiveAttributes {
  return Object.freeze({
    ...toolbarDataAttributes(options),
    role: 'toolbar',
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.label === undefined ? {} : { 'aria-label': options.label }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
    ...(options.descriptionId === undefined ? {} : { 'aria-describedby': options.descriptionId }),
    ...(toolbarDataOrientation(options.orientation) === 'vertical'
      ? { 'aria-orientation': 'vertical' }
      : {}),
    ...(options.disabled === true ? { 'aria-disabled': 'true' } : {}),
  });
}

/**
 * Builds the toolbar item attributes record for the Toolbar primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toolbarItemAttributes } from '@kovojs/headless-ui/toolbar';
 *
 * const input = {} as Parameters<typeof toolbarItemAttributes>[0];
 * const result = toolbarItemAttributes(input);
 * ```
 */
export function toolbarItemAttributes(
  options: ToolbarItemAttributeOptions,
): ToolbarPrimitiveAttributes {
  return Object.freeze({
    ...toolbarItemDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

/**
 * Builds the toolbar button attributes record for the Toolbar primitive.
 *
 * Emits `aria-pressed`, `data-pressed`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toolbarButtonAttributes } from '@kovojs/headless-ui/toolbar';
 *
 * const input = {} as Parameters<typeof toolbarButtonAttributes>[0];
 * const result = toolbarButtonAttributes(input);
 * ```
 */
export function toolbarButtonAttributes(
  options: ToolbarButtonAttributeOptions,
): ToolbarPrimitiveAttributes {
  const disabled = toolbarItemDisabled(options, options.itemValue);

  return Object.freeze({
    ...toolbarItemDataAttributes(options),
    disabled,
    tabIndex: toolbarItemTabIndex(options),
    type: 'button',
    value: options.itemValue,
    ...(options.pressed === undefined
      ? {}
      : { 'aria-pressed': String(options.pressed), 'data-pressed': String(options.pressed) }),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

/**
 * Handles the toolbar move focus interaction for the Toolbar primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toolbarMoveFocus } from '@kovojs/headless-ui/toolbar';
 *
 * const input = {} as Parameters<typeof toolbarMoveFocus>[0];
 * const state = {} as Parameters<typeof toolbarMoveFocus>[1];
 * const result = toolbarMoveFocus(input, state);
 * ```
 */
export function toolbarMoveFocus(state: ToolbarState, intent: NavigationIntent): ToolbarMoveResult {
  const items = state.items ?? [];
  if (state.disabled || items.length === 0) return { index: -1, value: state.activeValue };

  const currentIndex = toolbarRovingIndex(state);
  if (currentIndex < 0) return { index: -1, value: state.activeValue };

  const index = moveCollectionIndex(intent, {
    currentIndex,
    items: toolbarNavigationItems(state),
    ...(state.loop === undefined ? {} : { loop: state.loop }),
  });

  return {
    index,
    value: index < 0 ? state.activeValue : items[index]?.value,
  };
}

/**
 * Handles the toolbar key down interaction for the Toolbar primitive.
 *
 * @example
 * ```ts
 * import { toolbarKeyDown } from '@kovojs/headless-ui/toolbar';
 *
 * const input = {} as Parameters<typeof toolbarKeyDown>[0];
 * const state = {} as Parameters<typeof toolbarKeyDown>[1];
 * const result = toolbarKeyDown(input, state);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function toolbarKeyDown(
  event: ToolbarKeyboardEvent,
  state: ToolbarState,
): ToolbarMoveResult | undefined {
  if (event.defaultPrevented) return;

  const intent = navigationIntentFromKey(event.key, {
    ...(state.dir === undefined ? {} : { dir: state.dir }),
    orientation: state.orientation ?? 'horizontal',
  });
  if (intent === undefined) return;

  const result = toolbarMoveFocus(state, intent);
  if (result.index < 0) return;

  event.preventDefault();

  return result;
}

function toolbarDataAttributes(state: ToolbarState): PrimitiveDataAttributes {
  return mergeDataAttributes(
    dataOrientation(toolbarDataOrientation(state.orientation)),
    dataDisabled(state.disabled === true),
  );
}

function toolbarItemDataAttributes(options: ToolbarItemAttributeOptions): PrimitiveDataAttributes {
  return mergeDataAttributes(dataDisabled(toolbarItemDisabled(options, options.itemValue)));
}

function toolbarItemTabIndex(options: ToolbarItemAttributeOptions): number {
  if (toolbarItemDisabled(options, options.itemValue)) return -1;

  const itemIndex = options.items?.findIndex((item) => item.value === options.itemValue) ?? -1;
  if (itemIndex >= 0) return itemIndex === toolbarRovingIndex(options) ? 0 : -1;

  return 0;
}

function toolbarItemDisabled(state: ToolbarState & { itemDisabled?: boolean }, value: string) {
  return (
    state.disabled === true ||
    state.itemDisabled === true ||
    state.items?.find((item) => item.value === value)?.disabled === true
  );
}

function toolbarNavigationItems(state: ToolbarState): readonly { disabled?: boolean }[] {
  return (state.items ?? []).map((item) => ({
    disabled: state.disabled === true || item.disabled === true,
  }));
}

function toolbarDataOrientation(
  orientation: ToolbarOrientation | undefined,
): 'horizontal' | 'vertical' {
  return orientation === 'vertical' ? 'vertical' : 'horizontal';
}
