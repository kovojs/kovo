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
  safeUrl,
  scheduleDeferred,
  type CollectionOrientation,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
  type TextDirection,
  type TypeaheadState,
} from '../lib/index.js';

/**
 * Public interface used by the Navigation Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { NavigationMenuItem } from '@kovojs/headless-ui/navigation-menu';
 *
 * const value: NavigationMenuItem = {} as NavigationMenuItem;
 * ```
 */
export interface NavigationMenuItem {
  disabled?: boolean;
  hasContent?: boolean;
  label?: string;
  textValue?: string;
  value: string;
}

/**
 * State snapshot consumed by the Navigation Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { NavigationMenuState } from '@kovojs/headless-ui/navigation-menu';
 *
 * const value: NavigationMenuState = {} as NavigationMenuState;
 * ```
 */
export interface NavigationMenuState {
  activeValue?: string;
  dir?: TextDirection;
  disabled?: boolean;
  items?: readonly NavigationMenuItem[];
  loop?: boolean;
  openValue?: string;
  orientation?: CollectionOrientation;
}

/**
 * Options accepted by the Navigation Menu primitive navigation menu root attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { NavigationMenuRootAttributeOptions } from '@kovojs/headless-ui/navigation-menu';
 *
 * const value: NavigationMenuRootAttributeOptions = {} as NavigationMenuRootAttributeOptions;
 * ```
 */
export interface NavigationMenuRootAttributeOptions extends NavigationMenuState {
  descriptionId?: string;
  id?: string;
  label?: string;
  labelledBy?: string;
}

/**
 * Options accepted by the Navigation Menu primitive navigation menu list attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { NavigationMenuListAttributeOptions } from '@kovojs/headless-ui/navigation-menu';
 *
 * const value: NavigationMenuListAttributeOptions = {} as NavigationMenuListAttributeOptions;
 * ```
 */
export interface NavigationMenuListAttributeOptions extends NavigationMenuState {
  id?: string;
  labelledBy?: string;
}

/**
 * Options accepted by the Navigation Menu primitive navigation menu item attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { NavigationMenuItemAttributeOptions } from '@kovojs/headless-ui/navigation-menu';
 *
 * const value: NavigationMenuItemAttributeOptions = {} as NavigationMenuItemAttributeOptions;
 * ```
 */
export interface NavigationMenuItemAttributeOptions extends NavigationMenuState {
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
}

/**
 * Options accepted by the Navigation Menu primitive navigation menu trigger attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { NavigationMenuTriggerAttributeOptions } from '@kovojs/headless-ui/navigation-menu';
 *
 * const value: NavigationMenuTriggerAttributeOptions = {} as NavigationMenuTriggerAttributeOptions;
 * ```
 */
export interface NavigationMenuTriggerAttributeOptions extends NavigationMenuState {
  contentId?: string;
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemValue: string;
}

/**
 * Options accepted by the Navigation Menu primitive navigation menu content attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { NavigationMenuContentAttributeOptions } from '@kovojs/headless-ui/navigation-menu';
 *
 * const value: NavigationMenuContentAttributeOptions = {} as NavigationMenuContentAttributeOptions;
 * ```
 */
export interface NavigationMenuContentAttributeOptions extends NavigationMenuState {
  id?: string;
  labelledBy?: string;
  value: string;
}

/**
 * Options accepted by the Navigation Menu primitive navigation menu link attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { NavigationMenuLinkAttributeOptions } from '@kovojs/headless-ui/navigation-menu';
 *
 * const value: NavigationMenuLinkAttributeOptions = {} as NavigationMenuLinkAttributeOptions;
 * ```
 */
export interface NavigationMenuLinkAttributeOptions extends NavigationMenuState {
  href?: string;
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemValue: string;
}

/**
 * Options accepted by the Navigation Menu primitive navigation menu viewport attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { NavigationMenuViewportAttributeOptions } from '@kovojs/headless-ui/navigation-menu';
 *
 * const value: NavigationMenuViewportAttributeOptions = {} as NavigationMenuViewportAttributeOptions;
 * ```
 */
export interface NavigationMenuViewportAttributeOptions extends NavigationMenuState {
  id?: string;
}

/**
 * Options accepted by the Navigation Menu primitive navigation menu indicator attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { NavigationMenuIndicatorAttributeOptions } from '@kovojs/headless-ui/navigation-menu';
 *
 * const value: NavigationMenuIndicatorAttributeOptions = {} as NavigationMenuIndicatorAttributeOptions;
 * ```
 */
export interface NavigationMenuIndicatorAttributeOptions extends NavigationMenuState {
  id?: string;
}

/**
 * Reason token reported by the Navigation Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { NavigationMenuOpenChangeReason } from '@kovojs/headless-ui/navigation-menu';
 *
 * const value: NavigationMenuOpenChangeReason = {} as NavigationMenuOpenChangeReason;
 * ```
 */
export type NavigationMenuOpenChangeReason =
  | 'escape-key'
  | 'link-select'
  | 'programmatic'
  | 'trigger-click'
  | 'trigger-focus'
  | 'trigger-keyboard'
  | 'trigger-pointer-enter';

/**
 * Reason token reported by the Navigation Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { NavigationMenuSelectReason } from '@kovojs/headless-ui/navigation-menu';
 *
 * const value: NavigationMenuSelectReason = {} as NavigationMenuSelectReason;
 * ```
 */
export type NavigationMenuSelectReason = 'link-click' | 'programmatic';

/**
 * Cancelable change detail emitted by the Navigation Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { NavigationMenuOpenChangeDetail } from '@kovojs/headless-ui/navigation-menu';
 *
 * const value: NavigationMenuOpenChangeDetail = {} as NavigationMenuOpenChangeDetail;
 * ```
 */
export type NavigationMenuOpenChangeDetail = PrimitiveChangeDetail<
  NavigationMenuOpenChangeReason,
  string | undefined
>;

/**
 * Cancelable change detail emitted by the Navigation Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { NavigationMenuSelectDetail } from '@kovojs/headless-ui/navigation-menu';
 *
 * const value: NavigationMenuSelectDetail = {} as NavigationMenuSelectDetail;
 * ```
 */
export type NavigationMenuSelectDetail = PrimitiveChangeDetail<NavigationMenuSelectReason, string>;

/**
 * Options accepted by the Navigation Menu primitive navigation menu change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { NavigationMenuChangeOptions } from '@kovojs/headless-ui/navigation-menu';
 *
 * const value: NavigationMenuChangeOptions = {} as NavigationMenuChangeOptions;
 * ```
 */
export interface NavigationMenuChangeOptions {
  onOpenChange?: (detail: NavigationMenuOpenChangeDetail) => void;
  onSelect?: (detail: NavigationMenuSelectDetail) => void;
}

/**
 * Result returned by the Navigation Menu primitive navigation menu open change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { NavigationMenuOpenChangeResult } from '@kovojs/headless-ui/navigation-menu';
 *
 * const value: NavigationMenuOpenChangeResult = {} as NavigationMenuOpenChangeResult;
 * ```
 */
export interface NavigationMenuOpenChangeResult {
  changed: boolean;
  detail?: NavigationMenuOpenChangeDetail;
  openValue: string | undefined;
}

/**
 * Result returned by the Navigation Menu primitive navigation menu select.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { NavigationMenuSelectResult } from '@kovojs/headless-ui/navigation-menu';
 *
 * const value: NavigationMenuSelectResult = {} as NavigationMenuSelectResult;
 * ```
 */
export interface NavigationMenuSelectResult {
  detail?: NavigationMenuSelectDetail;
  open: NavigationMenuOpenChangeResult;
  selected: boolean;
  value: string;
}

/**
 * Options accepted by the Navigation Menu primitive navigation menu move.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { NavigationMenuMoveOptions } from '@kovojs/headless-ui/navigation-menu';
 *
 * const value: NavigationMenuMoveOptions = {} as NavigationMenuMoveOptions;
 * ```
 */
export interface NavigationMenuMoveOptions {
  loop?: boolean;
}

/**
 * Result returned by the Navigation Menu primitive navigation menu move.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { NavigationMenuMoveResult } from '@kovojs/headless-ui/navigation-menu';
 *
 * const value: NavigationMenuMoveResult = {} as NavigationMenuMoveResult;
 * ```
 */
export interface NavigationMenuMoveResult {
  activeIndex: number;
  activeValue: string | undefined;
}

/**
 * Options accepted by the Navigation Menu primitive navigation menu typeahead.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { NavigationMenuTypeaheadOptions } from '@kovojs/headless-ui/navigation-menu';
 *
 * const value: NavigationMenuTypeaheadOptions = {} as NavigationMenuTypeaheadOptions;
 * ```
 */
export interface NavigationMenuTypeaheadOptions extends NavigationMenuMoveOptions {
  currentValue?: string;
  now: number;
  state?: TypeaheadState;
  timeoutMs?: number;
}

/**
 * Result returned by the Navigation Menu primitive navigation menu typeahead.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { NavigationMenuTypeaheadResult } from '@kovojs/headless-ui/navigation-menu';
 *
 * const value: NavigationMenuTypeaheadResult = {} as NavigationMenuTypeaheadResult;
 * ```
 */
export interface NavigationMenuTypeaheadResult extends NavigationMenuMoveResult {
  state: TypeaheadState;
}

/**
 * Serializable attribute record returned by Navigation Menu primitive builders.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { NavigationMenuPrimitiveAttributes } from '@kovojs/headless-ui/navigation-menu';
 *
 * const value: NavigationMenuPrimitiveAttributes = {} as NavigationMenuPrimitiveAttributes;
 * ```
 */
export type NavigationMenuPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

/**
 * Event shape consumed by the Navigation Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { NavigationMenuTriggerEvent } from '@kovojs/headless-ui/navigation-menu';
 *
 * const value: NavigationMenuTriggerEvent = {} as NavigationMenuTriggerEvent;
 * ```
 */
export type NavigationMenuTriggerEvent = Event;

/**
 * Event shape consumed by the Navigation Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { NavigationMenuLinkEvent } from '@kovojs/headless-ui/navigation-menu';
 *
 * const value: NavigationMenuLinkEvent = {} as NavigationMenuLinkEvent;
 * ```
 */
export type NavigationMenuLinkEvent = Event;

/**
 * Event shape consumed by the Navigation Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { NavigationMenuKeyboardEvent } from '@kovojs/headless-ui/navigation-menu';
 *
 * const value: NavigationMenuKeyboardEvent = {} as NavigationMenuKeyboardEvent;
 * ```
 */
export type NavigationMenuKeyboardEvent = Event & { readonly key: string };

/**
 * Event shape consumed by the Navigation Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { NavigationMenuFocusEvent } from '@kovojs/headless-ui/navigation-menu';
 *
 * const value: NavigationMenuFocusEvent = {} as NavigationMenuFocusEvent;
 * ```
 */
export type NavigationMenuFocusEvent = Event & {
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
 * Options accepted by the Navigation Menu primitive navigation menu focus.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { NavigationMenuFocusOptions } from '@kovojs/headless-ui/navigation-menu';
 *
 * const value: NavigationMenuFocusOptions = {} as NavigationMenuFocusOptions;
 * ```
 */
export interface NavigationMenuFocusOptions {
  defer?: boolean;
  schedule?: (callback: () => void) => void;
}

/**
 * Builds the navigation menu root attributes record for the Navigation Menu primitive.
 *
 * Emits `aria-describedby`, `aria-disabled`, `aria-label`, `aria-labelledby`, `aria-orientation`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { navigationMenuRootAttributes } from '@kovojs/headless-ui/navigation-menu';
 *
 * const input = {} as Parameters<typeof navigationMenuRootAttributes>[0];
 * const result = navigationMenuRootAttributes(input);
 * ```
 */
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

/**
 * Builds the navigation menu list attributes record for the Navigation Menu primitive.
 *
 * Emits `aria-labelledby`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { navigationMenuListAttributes } from '@kovojs/headless-ui/navigation-menu';
 *
 * const input = {} as Parameters<typeof navigationMenuListAttributes>[0];
 * const result = navigationMenuListAttributes(input);
 * ```
 */
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

/**
 * Builds the navigation menu item attributes record for the Navigation Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { navigationMenuItemAttributes } from '@kovojs/headless-ui/navigation-menu';
 *
 * const input = {} as Parameters<typeof navigationMenuItemAttributes>[0];
 * const result = navigationMenuItemAttributes(input);
 * ```
 */
export function navigationMenuItemAttributes(
  options: NavigationMenuItemAttributeOptions,
): NavigationMenuPrimitiveAttributes {
  return Object.freeze({
    ...navigationMenuItemDataAttributes(options),
    role: 'listitem',
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

/**
 * Builds the navigation menu trigger attributes record for the Navigation Menu primitive.
 *
 * Emits `aria-controls`, `aria-expanded`, `aria-haspopup`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { navigationMenuTriggerAttributes } from '@kovojs/headless-ui/navigation-menu';
 *
 * const input = {} as Parameters<typeof navigationMenuTriggerAttributes>[0];
 * const result = navigationMenuTriggerAttributes(input);
 * ```
 */
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

/**
 * Builds the navigation menu content attributes record for the Navigation Menu primitive.
 *
 * Emits `aria-labelledby`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { navigationMenuContentAttributes } from '@kovojs/headless-ui/navigation-menu';
 *
 * const input = {} as Parameters<typeof navigationMenuContentAttributes>[0];
 * const result = navigationMenuContentAttributes(input);
 * ```
 */
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

/**
 * Builds the navigation menu link attributes record for the Navigation Menu primitive.
 *
 * Emits `aria-disabled`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { navigationMenuLinkAttributes } from '@kovojs/headless-ui/navigation-menu';
 *
 * const input = {} as Parameters<typeof navigationMenuLinkAttributes>[0];
 * const result = navigationMenuLinkAttributes(input);
 * ```
 */
export function navigationMenuLinkAttributes(
  options: NavigationMenuLinkAttributeOptions,
): NavigationMenuPrimitiveAttributes {
  const disabled = navigationMenuItemDisabled(options, options.itemValue);

  return Object.freeze({
    ...navigationMenuItemDataAttributes(options),
    tabIndex: navigationMenuItemHighlighted(options) && !disabled ? 0 : -1,
    value: options.itemValue,
    ...(disabled ? { 'aria-disabled': 'true' } : {}),
    // SECURITY_FINDINGS.md H3: the caller href was previously spread verbatim
    // and `escapeAttribute` does not neutralize schemes, so a `javascript:` href
    // would render and execute on click. Route it through safeUrl. The href is
    // still omitted entirely when disabled or absent (undefined semantics).
    ...(disabled || options.href === undefined ? {} : { href: safeUrl(options.href) }),
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.itemLabel === undefined ? {} : { label: options.itemLabel }),
  });
}

/**
 * Builds the navigation menu viewport attributes record for the Navigation Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { navigationMenuViewportAttributes } from '@kovojs/headless-ui/navigation-menu';
 *
 * const input = {} as Parameters<typeof navigationMenuViewportAttributes>[0];
 * const result = navigationMenuViewportAttributes(input);
 * ```
 */
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

/**
 * Builds the navigation menu indicator attributes record for the Navigation Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { navigationMenuIndicatorAttributes } from '@kovojs/headless-ui/navigation-menu';
 *
 * const input = {} as Parameters<typeof navigationMenuIndicatorAttributes>[0];
 * const result = navigationMenuIndicatorAttributes(input);
 * ```
 */
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

/**
 * Computes navigation menu item highlighted for the Navigation Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { navigationMenuItemHighlighted } from '@kovojs/headless-ui/navigation-menu';
 *
 * const input = {} as Parameters<typeof navigationMenuItemHighlighted>[0];
 * const result = navigationMenuItemHighlighted(input);
 * ```
 */
export function navigationMenuItemHighlighted(
  options: NavigationMenuItemAttributeOptions,
): boolean {
  return options.activeValue === options.itemValue;
}

/**
 * Computes navigation menu item open for the Navigation Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { navigationMenuItemOpen } from '@kovojs/headless-ui/navigation-menu';
 *
 * const input = {} as Parameters<typeof navigationMenuItemOpen>[0];
 * const result = navigationMenuItemOpen(input);
 * ```
 */
export function navigationMenuItemOpen(options: NavigationMenuItemAttributeOptions): boolean {
  return options.openValue === options.itemValue;
}

/**
 * Computes the set navigation menu open value transition for the Navigation Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { setNavigationMenuOpenValue } from '@kovojs/headless-ui/navigation-menu';
 *
 * const input = {} as Parameters<typeof setNavigationMenuOpenValue>[0];
 * const state = {} as Parameters<typeof setNavigationMenuOpenValue>[1];
 * const options = {} as Parameters<typeof setNavigationMenuOpenValue>[2];
 * const detail = {} as Parameters<typeof setNavigationMenuOpenValue>[3];
 * const result = setNavigationMenuOpenValue(input, state, options, detail);
 * ```
 */
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

/**
 * Computes the toggle navigation menu open value transition for the Navigation Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toggleNavigationMenuOpenValue } from '@kovojs/headless-ui/navigation-menu';
 *
 * const input = {} as Parameters<typeof toggleNavigationMenuOpenValue>[0];
 * const state = {} as Parameters<typeof toggleNavigationMenuOpenValue>[1];
 * const options = {} as Parameters<typeof toggleNavigationMenuOpenValue>[2];
 * const detail = {} as Parameters<typeof toggleNavigationMenuOpenValue>[3];
 * const result = toggleNavigationMenuOpenValue(input, state, options, detail);
 * ```
 */
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

/**
 * Computes the select navigation menu link transition for the Navigation Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { selectNavigationMenuLink } from '@kovojs/headless-ui/navigation-menu';
 *
 * const input = {} as Parameters<typeof selectNavigationMenuLink>[0];
 * const state = {} as Parameters<typeof selectNavigationMenuLink>[1];
 * const options = {} as Parameters<typeof selectNavigationMenuLink>[2];
 * const detail = {} as Parameters<typeof selectNavigationMenuLink>[3];
 * const result = selectNavigationMenuLink(input, state, options, detail);
 * ```
 */
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

/**
 * Computes navigation menu move for the Navigation Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { navigationMenuMove } from '@kovojs/headless-ui/navigation-menu';
 *
 * const input = {} as Parameters<typeof navigationMenuMove>[0];
 * const state = {} as Parameters<typeof navigationMenuMove>[1];
 * const options = {} as Parameters<typeof navigationMenuMove>[2];
 * const result = navigationMenuMove(input, state, options);
 * ```
 */
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

/**
 * Computes navigation menu typeahead for the Navigation Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { navigationMenuTypeahead } from '@kovojs/headless-ui/navigation-menu';
 *
 * const input = {} as Parameters<typeof navigationMenuTypeahead>[0];
 * const state = {} as Parameters<typeof navigationMenuTypeahead>[1];
 * const options = {} as Parameters<typeof navigationMenuTypeahead>[2];
 * const result = navigationMenuTypeahead(input, state, options);
 * ```
 */
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
 * Handles the navigation menu trigger click interaction for the Navigation Menu primitive.
 *
 * @example
 * ```ts
 * import { navigationMenuTriggerClick } from '@kovojs/headless-ui/navigation-menu';
 *
 * const input = {} as Parameters<typeof navigationMenuTriggerClick>[0];
 * const state = {} as Parameters<typeof navigationMenuTriggerClick>[1];
 * const options = {} as Parameters<typeof navigationMenuTriggerClick>[2];
 * const result = navigationMenuTriggerClick(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
 * Handles the navigation menu trigger pointer enter interaction for the Navigation Menu primitive.
 *
 * @example
 * ```ts
 * import { navigationMenuTriggerPointerEnter } from '@kovojs/headless-ui/navigation-menu';
 *
 * const input = {} as Parameters<typeof navigationMenuTriggerPointerEnter>[0];
 * const state = {} as Parameters<typeof navigationMenuTriggerPointerEnter>[1];
 * const options = {} as Parameters<typeof navigationMenuTriggerPointerEnter>[2];
 * const result = navigationMenuTriggerPointerEnter(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
 * Handles the navigation menu trigger focus interaction for the Navigation Menu primitive.
 *
 * @example
 * ```ts
 * import { navigationMenuTriggerFocus } from '@kovojs/headless-ui/navigation-menu';
 *
 * const input = {} as Parameters<typeof navigationMenuTriggerFocus>[0];
 * const state = {} as Parameters<typeof navigationMenuTriggerFocus>[1];
 * const options = {} as Parameters<typeof navigationMenuTriggerFocus>[2];
 * const result = navigationMenuTriggerFocus(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
 * Handles the navigation menu link click interaction for the Navigation Menu primitive.
 *
 * @example
 * ```ts
 * import { navigationMenuLinkClick } from '@kovojs/headless-ui/navigation-menu';
 *
 * const input = {} as Parameters<typeof navigationMenuLinkClick>[0];
 * const state = {} as Parameters<typeof navigationMenuLinkClick>[1];
 * const options = {} as Parameters<typeof navigationMenuLinkClick>[2];
 * const result = navigationMenuLinkClick(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
 * Handles the navigation menu key down interaction for the Navigation Menu primitive.
 *
 * @example
 * ```ts
 * import { navigationMenuKeyDown } from '@kovojs/headless-ui/navigation-menu';
 *
 * const input = {} as Parameters<typeof navigationMenuKeyDown>[0];
 * const state = {} as Parameters<typeof navigationMenuKeyDown>[1];
 * const options = {} as Parameters<typeof navigationMenuKeyDown>[2];
 * const result = navigationMenuKeyDown(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
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
    if (!navigationMenuItemDisabled(state, state.activeValue)) event.preventDefault();
    return result;
  }

  return undefined;
}

/**
 * Handles the navigation menu focus element interaction for the Navigation Menu primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { navigationMenuFocusElement } from '@kovojs/headless-ui/navigation-menu';
 *
 * const input = {} as Parameters<typeof navigationMenuFocusElement>[0];
 * const state = {} as Parameters<typeof navigationMenuFocusElement>[1];
 * const options = {} as Parameters<typeof navigationMenuFocusElement>[2];
 * const result = navigationMenuFocusElement(input, state, options);
 * ```
 */
export function navigationMenuFocusElement(
  event: NavigationMenuFocusEvent,
  id: string | undefined,
  options: NavigationMenuFocusOptions = {},
): boolean {
  if (!id) return false;

  const ownerDocument = event.currentTarget?.ownerDocument ?? event.target?.ownerDocument;
  const target = ownerDocument?.getElementById?.(id);
  if (typeof (target as { focus?: unknown } | undefined)?.focus !== 'function') return false;

  const focus = () => {
    (target as { focus(): void }).focus();
  };
  if (options.defer === true) {
    // J2 (SPEC.md §4.6): a bare setTimeout(0) fires before the runtime drains its
    // post-commit queue, so .focus() runs while the content subtree is still
    // hidden (a no-op). Route through scheduleDeferred so focus lands after the
    // content is revealed — defaults to the menu primitives.
    (options.schedule ?? scheduleDeferred)(focus);
  } else {
    focus();
  }
  return true;
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
