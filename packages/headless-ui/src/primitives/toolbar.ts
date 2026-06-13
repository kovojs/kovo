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

export type ToolbarOrientation = 'horizontal' | 'vertical';

export interface ToolbarItem {
  disabled?: boolean;
  value: string;
}

export interface ToolbarState {
  activeValue?: string;
  dir?: TextDirection;
  disabled?: boolean;
  items?: readonly ToolbarItem[];
  loop?: boolean;
  orientation?: ToolbarOrientation;
}

export interface ToolbarRootAttributeOptions extends ToolbarState {
  descriptionId?: string;
  id?: string;
  label?: string;
  labelledBy?: string;
}

export interface ToolbarItemAttributeOptions extends ToolbarState {
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
}

export interface ToolbarButtonAttributeOptions extends ToolbarItemAttributeOptions {
  pressed?: boolean;
}

export interface ToolbarMoveResult {
  index: number;
  value: string | undefined;
}

export type ToolbarPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

export type ToolbarKeyboardEvent = Event & { readonly key: string };

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

export function toolbarItemAttributes(
  options: ToolbarItemAttributeOptions,
): ToolbarPrimitiveAttributes {
  return Object.freeze({
    ...toolbarItemDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

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
 * @jisoPrimitiveHandler
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
