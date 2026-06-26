import {
  dataDisabled,
  dataOrientation,
  dispatchCancelableChange,
  mergeDataAttributes,
  moveCollectionIndex,
  navigationIntentFromKey,
  openState,
  type CollectionOrientation,
  type NavigationIntent,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
  type TextDirection,
} from '../lib/index.js';

/**
 * Public type used by the Accordion primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AccordionType } from '@kovojs/headless-ui/accordion';
 *
 * const value: AccordionType = {} as AccordionType;
 * ```
 */
export type AccordionType = 'multiple' | 'single';

/**
 * Public type used by the Accordion primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AccordionValue } from '@kovojs/headless-ui/accordion';
 *
 * const value: AccordionValue = {} as AccordionValue;
 * ```
 */
export type AccordionValue = readonly string[] | string | undefined;

/**
 * Reason token reported by the Accordion primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AccordionChangeReason } from '@kovojs/headless-ui/accordion';
 *
 * const value: AccordionChangeReason = {} as AccordionChangeReason;
 * ```
 */
export type AccordionChangeReason = 'programmatic' | 'trigger-click';

/**
 * Cancelable change detail emitted by the Accordion primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AccordionChangeDetail } from '@kovojs/headless-ui/accordion';
 *
 * const value: AccordionChangeDetail = {} as AccordionChangeDetail;
 * ```
 */
export type AccordionChangeDetail = PrimitiveChangeDetail<AccordionChangeReason, AccordionValue>;

/**
 * State snapshot consumed by the Accordion primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AccordionState } from '@kovojs/headless-ui/accordion';
 *
 * const value: AccordionState = {} as AccordionState;
 * ```
 */
export interface AccordionState {
  activeValue?: string;
  collapsible?: boolean;
  dir?: TextDirection;
  disabled?: boolean;
  items?: readonly AccordionItem[];
  loop?: boolean;
  orientation?: CollectionOrientation;
  type?: AccordionType;
  value?: AccordionValue;
}

/**
 * Public interface used by the Accordion primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AccordionItem } from '@kovojs/headless-ui/accordion';
 *
 * const value: AccordionItem = {} as AccordionItem;
 * ```
 */
export interface AccordionItem {
  disabled?: boolean;
  value: string;
}

/**
 * Options accepted by the Accordion primitive accordion item.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AccordionItemOptions } from '@kovojs/headless-ui/accordion';
 *
 * const value: AccordionItemOptions = {} as AccordionItemOptions;
 * ```
 */
export interface AccordionItemOptions extends AccordionState {
  itemDisabled?: boolean;
  itemValue: string;
}

/**
 * Options accepted by the Accordion primitive accordion header attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AccordionHeaderAttributeOptions } from '@kovojs/headless-ui/accordion';
 *
 * const value: AccordionHeaderAttributeOptions = {} as AccordionHeaderAttributeOptions;
 * ```
 */
export interface AccordionHeaderAttributeOptions extends AccordionItemOptions {
  level?: number;
}

/**
 * Options accepted by the Accordion primitive accordion trigger attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AccordionTriggerAttributeOptions } from '@kovojs/headless-ui/accordion';
 *
 * const value: AccordionTriggerAttributeOptions = {} as AccordionTriggerAttributeOptions;
 * ```
 */
export interface AccordionTriggerAttributeOptions extends AccordionItemOptions {
  contentId?: string;
  triggerId?: string;
}

/**
 * Options accepted by the Accordion primitive accordion content attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AccordionContentAttributeOptions } from '@kovojs/headless-ui/accordion';
 *
 * const value: AccordionContentAttributeOptions = {} as AccordionContentAttributeOptions;
 * ```
 */
export interface AccordionContentAttributeOptions extends AccordionItemOptions {
  contentId?: string;
  triggerId?: string;
}

/**
 * Options accepted by the Accordion primitive accordion change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AccordionChangeOptions } from '@kovojs/headless-ui/accordion';
 *
 * const value: AccordionChangeOptions = {} as AccordionChangeOptions;
 * ```
 */
export interface AccordionChangeOptions {
  onValueChange?: (detail: AccordionChangeDetail) => void;
}

/**
 * Result returned by the Accordion primitive accordion change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AccordionChangeResult } from '@kovojs/headless-ui/accordion';
 *
 * const value: AccordionChangeResult = {} as AccordionChangeResult;
 * ```
 */
export interface AccordionChangeResult {
  changed: boolean;
  detail?: AccordionChangeDetail;
  value: AccordionValue;
}

/**
 * Result returned by the Accordion primitive accordion move.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AccordionMoveResult } from '@kovojs/headless-ui/accordion';
 *
 * const value: AccordionMoveResult = {} as AccordionMoveResult;
 * ```
 */
export interface AccordionMoveResult {
  index: number;
  value: string | undefined;
}

/**
 * Serializable attribute record returned by Accordion primitive builders.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AccordionPrimitiveAttributes } from '@kovojs/headless-ui/accordion';
 *
 * const value: AccordionPrimitiveAttributes = {} as AccordionPrimitiveAttributes;
 * ```
 */
export type AccordionPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

/**
 * Event shape consumed by the Accordion primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AccordionTriggerEvent } from '@kovojs/headless-ui/accordion';
 *
 * const value: AccordionTriggerEvent = {} as AccordionTriggerEvent;
 * ```
 */
export type AccordionTriggerEvent = Event;

/**
 * Event shape consumed by the Accordion primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AccordionKeyboardEvent } from '@kovojs/headless-ui/accordion';
 *
 * const value: AccordionKeyboardEvent = {} as AccordionKeyboardEvent;
 * ```
 */
export type AccordionKeyboardEvent = Event & { readonly key: string };

/**
 * Computes accordion item open for the Accordion primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { accordionItemOpen } from '@kovojs/headless-ui/accordion';
 *
 * const input = {} as Parameters<typeof accordionItemOpen>[0];
 * const result = accordionItemOpen(input);
 * ```
 */
export function accordionItemOpen(options: AccordionItemOptions): boolean {
  if (accordionType(options) === 'multiple') {
    return Array.isArray(options.value) && options.value.includes(options.itemValue);
  }

  return options.value === options.itemValue;
}

/**
 * Builds the accordion root attributes record for the Accordion primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { accordionRootAttributes } from '@kovojs/headless-ui/accordion';
 *
 * const input = {} as Parameters<typeof accordionRootAttributes>[0];
 * const result = accordionRootAttributes(input);
 * ```
 */
export function accordionRootAttributes(state: AccordionState): AccordionPrimitiveAttributes {
  return Object.freeze({
    ...mergeDataAttributes(
      dataOrientation(accordionDataOrientation(state.orientation)),
      dataDisabled(state.disabled === true),
    ),
  });
}

/**
 * Builds the accordion item attributes record for the Accordion primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { accordionItemAttributes } from '@kovojs/headless-ui/accordion';
 *
 * const input = {} as Parameters<typeof accordionItemAttributes>[0];
 * const result = accordionItemAttributes(input);
 * ```
 */
export function accordionItemAttributes(
  options: AccordionItemOptions,
): AccordionPrimitiveAttributes {
  return Object.freeze({
    ...accordionItemDataAttributes(options),
    open: accordionItemOpen(options),
  });
}

/**
 * Builds the accordion header attributes record for the Accordion primitive.
 *
 * Emits `aria-level`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { accordionHeaderAttributes } from '@kovojs/headless-ui/accordion';
 *
 * const input = {} as Parameters<typeof accordionHeaderAttributes>[0];
 * const result = accordionHeaderAttributes(input);
 * ```
 */
export function accordionHeaderAttributes(
  options: AccordionHeaderAttributeOptions,
): AccordionPrimitiveAttributes {
  return Object.freeze({
    ...accordionItemDataAttributes(options),
    ...(options.level === undefined ? {} : { 'aria-level': normalizeHeaderLevel(options.level) }),
    ...(options.level === undefined ? {} : { role: 'heading' }),
  });
}

/**
 * Builds the accordion trigger attributes record for the Accordion primitive.
 *
 * Emits `aria-controls`, `aria-expanded`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { accordionTriggerAttributes } from '@kovojs/headless-ui/accordion';
 *
 * const input = {} as Parameters<typeof accordionTriggerAttributes>[0];
 * const result = accordionTriggerAttributes(input);
 * ```
 */
export function accordionTriggerAttributes(
  options: AccordionTriggerAttributeOptions,
): AccordionPrimitiveAttributes {
  return Object.freeze({
    ...accordionItemDataAttributes(options),
    'aria-expanded': String(accordionItemOpen(options)),
    disabled: accordionItemDisabled(options),
    tabIndex: accordionItemTabIndex(options),
    type: 'button',
    ...(options.contentId === undefined ? {} : { 'aria-controls': options.contentId }),
    ...(options.triggerId === undefined ? {} : { id: options.triggerId }),
  });
}

/**
 * Builds the accordion content attributes record for the Accordion primitive.
 *
 * Emits `aria-labelledby`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { accordionContentAttributes } from '@kovojs/headless-ui/accordion';
 *
 * const input = {} as Parameters<typeof accordionContentAttributes>[0];
 * const result = accordionContentAttributes(input);
 * ```
 */
export function accordionContentAttributes(
  options: AccordionContentAttributeOptions,
): AccordionPrimitiveAttributes {
  const open = accordionItemOpen(options);

  return Object.freeze({
    ...accordionItemDataAttributes(options),
    hidden: !open,
    ...(options.contentId === undefined ? {} : { id: options.contentId }),
    ...(options.triggerId === undefined ? {} : { 'aria-labelledby': options.triggerId }),
    ...(options.triggerId === undefined ? {} : { role: 'region' }),
  });
}

/**
 * Computes the set accordion value transition for the Accordion primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { setAccordionValue } from '@kovojs/headless-ui/accordion';
 *
 * const input = {} as Parameters<typeof setAccordionValue>[0];
 * const state = {} as Parameters<typeof setAccordionValue>[1];
 * const options = {} as Parameters<typeof setAccordionValue>[2];
 * const detail = {} as Parameters<typeof setAccordionValue>[3];
 * const result = setAccordionValue(input, state, options, detail);
 * ```
 */
export function setAccordionValue(
  state: AccordionState,
  value: AccordionValue,
  reason: AccordionChangeReason,
  options: AccordionChangeOptions = {},
): AccordionChangeResult {
  const normalizedValue = normalizeAccordionValue(state, value);
  const currentValue = normalizeAccordionValue(state, state.value);

  if (state.disabled || accordionValueEqual(currentValue, normalizedValue)) {
    return { changed: false, value: currentValue };
  }

  const detail = dispatchCancelableChange(
    { reason, value: normalizedValue },
    options.onValueChange,
  );
  if (detail.defaultPrevented) {
    return { changed: false, detail, value: currentValue };
  }

  return { changed: true, detail, value: normalizedValue };
}

/**
 * Computes the toggle accordion item transition for the Accordion primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { toggleAccordionItem } from '@kovojs/headless-ui/accordion';
 *
 * const input = {} as Parameters<typeof toggleAccordionItem>[0];
 * const state = {} as Parameters<typeof toggleAccordionItem>[1];
 * const options = {} as Parameters<typeof toggleAccordionItem>[2];
 * const detail = {} as Parameters<typeof toggleAccordionItem>[3];
 * const result = toggleAccordionItem(input, state, options, detail);
 * ```
 */
export function toggleAccordionItem(
  state: AccordionState,
  itemValue: string,
  reason: AccordionChangeReason,
  options: AccordionChangeOptions = {},
): AccordionChangeResult {
  if (state.disabled) {
    return { changed: false, value: normalizeAccordionValue(state, state.value) };
  }

  return setAccordionValue(state, nextAccordionValue(state, itemValue), reason, options);
}

/**
 * Computes accordion roving index for the Accordion primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { accordionRovingIndex } from '@kovojs/headless-ui/accordion';
 *
 * const input = {} as Parameters<typeof accordionRovingIndex>[0];
 * const result = accordionRovingIndex(input);
 * ```
 */
export function accordionRovingIndex(state: AccordionState): number {
  const items = state.items ?? [];
  if (items.length === 0) return -1;

  const activeIndex = items.findIndex(
    (item) => item.value === state.activeValue && !accordionItemDisabled(stateForItem(state, item)),
  );
  if (activeIndex >= 0) return activeIndex;

  const openIndex = items.findIndex(
    (item) => accordionItemOpen({ ...state, itemValue: item.value }) && !item.disabled,
  );
  if (openIndex >= 0) return openIndex;

  return moveCollectionIndex('first', {
    currentIndex: -1,
    items: accordionNavigationItems(state),
  });
}

/**
 * Handles the accordion move focus interaction for the Accordion primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { accordionMoveFocus } from '@kovojs/headless-ui/accordion';
 *
 * const input = {} as Parameters<typeof accordionMoveFocus>[0];
 * const state = {} as Parameters<typeof accordionMoveFocus>[1];
 * const result = accordionMoveFocus(input, state);
 * ```
 */
export function accordionMoveFocus(
  state: AccordionState,
  intent: NavigationIntent,
): AccordionMoveResult {
  const items = state.items ?? [];
  if (state.disabled || items.length === 0) return { index: -1, value: state.activeValue };

  const currentIndex = accordionRovingIndex(state);
  if (currentIndex < 0) return { index: -1, value: state.activeValue };

  const index = moveCollectionIndex(intent, {
    currentIndex,
    items: accordionNavigationItems(state),
    ...(state.loop === undefined ? {} : { loop: state.loop }),
  });

  return {
    index,
    value: index < 0 ? state.activeValue : items[index]?.value,
  };
}

/**
 * Handles the accordion trigger click interaction for the Accordion primitive.
 *
 * @example
 * ```ts
 * import { accordionTriggerClick } from '@kovojs/headless-ui/accordion';
 *
 * const input = {} as Parameters<typeof accordionTriggerClick>[0];
 * const state = {} as Parameters<typeof accordionTriggerClick>[1];
 * const options = {} as Parameters<typeof accordionTriggerClick>[2];
 * const result = accordionTriggerClick(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function accordionTriggerClick(
  event: AccordionTriggerEvent,
  state: AccordionItemOptions,
  options: AccordionChangeOptions = {},
): AccordionChangeResult | undefined {
  if (event.defaultPrevented) return;

  if (accordionItemDisabled(state)) {
    const result = {
      changed: false,
      value: normalizeAccordionValue(state, state.value),
    };
    event.preventDefault();
    return result;
  }

  const result = toggleAccordionItem(state, state.itemValue, 'trigger-click', options);
  if (!result.changed) {
    event.preventDefault();
  }

  return result;
}

/**
 * Handles the accordion key down interaction for the Accordion primitive.
 *
 * @example
 * ```ts
 * import { accordionKeyDown } from '@kovojs/headless-ui/accordion';
 *
 * const input = {} as Parameters<typeof accordionKeyDown>[0];
 * const state = {} as Parameters<typeof accordionKeyDown>[1];
 * const result = accordionKeyDown(input, state);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function accordionKeyDown(
  event: AccordionKeyboardEvent,
  state: AccordionState,
): AccordionMoveResult | undefined {
  if (event.defaultPrevented) return;

  // SPEC.md §4.6 + rules/accessibility-conformance.md (WAI-ARIA APG): default the
  // navigation orientation to the rendered default ('vertical', matching
  // accordionDataOrientation) instead of 'both', so a vertical accordion responds to
  // Up/Down only and off-axis arrows fall through to the browser. Mirrors the
  // toolbar/menubar peers (`state.orientation ?? 'horizontal'`).
  const intent = navigationIntentFromKey(event.key, {
    ...(state.dir === undefined ? {} : { dir: state.dir }),
    orientation: state.orientation ?? 'vertical',
  });
  if (intent === undefined) return;

  const result = accordionMoveFocus(state, intent);
  if (result.index < 0) return;

  event.preventDefault();

  return result;
}

function accordionItemDataAttributes(options: AccordionItemOptions): PrimitiveDataAttributes {
  return mergeDataAttributes(
    openState(accordionItemOpen(options)),
    dataDisabled(accordionItemDisabled(options)),
  );
}

function accordionItemDisabled(options: AccordionItemOptions): boolean {
  return options.disabled === true || options.itemDisabled === true;
}

function accordionItemTabIndex(options: AccordionItemOptions): number {
  if (accordionItemDisabled(options)) return -1;

  const itemIndex = options.items?.findIndex((item) => item.value === options.itemValue) ?? -1;
  if (itemIndex >= 0) return itemIndex === accordionRovingIndex(options) ? 0 : -1;

  return 0;
}

function accordionNavigationItems(state: AccordionState): readonly { disabled?: boolean }[] {
  return (state.items ?? []).map((item) => ({
    disabled: state.disabled === true || item.disabled === true,
  }));
}

function stateForItem(state: AccordionState, item: AccordionItem): AccordionItemOptions {
  return {
    ...state,
    itemValue: item.value,
    ...(item.disabled === undefined ? {} : { itemDisabled: item.disabled }),
  };
}

function accordionDataOrientation(
  orientation: CollectionOrientation | undefined,
): 'horizontal' | 'vertical' {
  return orientation === 'horizontal' ? 'horizontal' : 'vertical';
}

function accordionType(state: AccordionState): AccordionType {
  // J3 (SPEC.md §4.6): an explicit `type` is authoritative and must stay stable
  // across toggles. When `type` is omitted, only a string value (a single open
  // panel) implies single-select; an array OR an empty/undefined value keeps the
  // accordion multiple, so an intended-multiple accordion that starts with no open
  // panels does not silently collapse to single after the first toggle stores a
  // bare string. Multiplicity is never re-derived in a way that flips the declared
  // mode between toggles.
  if (state.type !== undefined) return state.type;
  return typeof state.value === 'string' ? 'single' : 'multiple';
}

function nextAccordionValue(state: AccordionState, itemValue: string): AccordionValue {
  if (accordionType(state) === 'multiple') {
    const current = normalizeAccordionValue({ ...state, type: 'multiple' }, state.value);
    const values = Array.isArray(current) ? current : [];

    return values.includes(itemValue)
      ? values.filter((value) => value !== itemValue)
      : [...values, itemValue];
  }

  return state.value === itemValue
    ? state.collapsible === true
      ? undefined
      : state.value
    : itemValue;
}

function normalizeAccordionValue(state: AccordionState, value: AccordionValue): AccordionValue {
  if (accordionType(state) === 'multiple') {
    if (Array.isArray(value)) return Object.freeze([...value]) as readonly string[];
    return value === undefined
      ? (Object.freeze([]) as readonly string[])
      : (Object.freeze([value]) as readonly string[]);
  }

  if (Array.isArray(value)) return value[0];
  return value;
}

function accordionValueEqual(left: AccordionValue, right: AccordionValue): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    return left.length === right.length && left.every((value, index) => right[index] === value);
  }

  return left === right;
}

function normalizeHeaderLevel(level: number): number {
  return Math.min(6, Math.max(1, Math.trunc(level)));
}
