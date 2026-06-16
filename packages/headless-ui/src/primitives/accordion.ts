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

export type AccordionType = 'multiple' | 'single';

export type AccordionValue = readonly string[] | string | undefined;

export type AccordionChangeReason = 'programmatic' | 'trigger-click';

export type AccordionChangeDetail = PrimitiveChangeDetail<AccordionChangeReason, AccordionValue>;

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

export interface AccordionItem {
  disabled?: boolean;
  value: string;
}

export interface AccordionItemOptions extends AccordionState {
  itemDisabled?: boolean;
  itemValue: string;
}

export interface AccordionHeaderAttributeOptions extends AccordionItemOptions {
  level?: number;
}

export interface AccordionTriggerAttributeOptions extends AccordionItemOptions {
  contentId?: string;
  triggerId?: string;
}

export interface AccordionContentAttributeOptions extends AccordionItemOptions {
  contentId?: string;
  triggerId?: string;
}

export interface AccordionChangeOptions {
  onValueChange?: (detail: AccordionChangeDetail) => void;
}

export interface AccordionChangeResult {
  changed: boolean;
  detail?: AccordionChangeDetail;
  value: AccordionValue;
}

export interface AccordionMoveResult {
  index: number;
  value: string | undefined;
}

export type AccordionPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

export type AccordionTriggerEvent = Event;
export type AccordionKeyboardEvent = Event & { readonly key: string };

export function accordionItemOpen(options: AccordionItemOptions): boolean {
  if (accordionType(options) === 'multiple') {
    return Array.isArray(options.value) && options.value.includes(options.itemValue);
  }

  return options.value === options.itemValue;
}

export function accordionRootAttributes(state: AccordionState): AccordionPrimitiveAttributes {
  return Object.freeze({
    ...mergeDataAttributes(
      dataOrientation(accordionDataOrientation(state.orientation)),
      dataDisabled(state.disabled === true),
    ),
  });
}

export function accordionItemAttributes(
  options: AccordionItemOptions,
): AccordionPrimitiveAttributes {
  return Object.freeze({
    ...accordionItemDataAttributes(options),
    open: accordionItemOpen(options),
  });
}

export function accordionHeaderAttributes(
  options: AccordionHeaderAttributeOptions,
): AccordionPrimitiveAttributes {
  return Object.freeze({
    ...accordionItemDataAttributes(options),
    ...(options.level === undefined ? {} : { 'aria-level': normalizeHeaderLevel(options.level) }),
    ...(options.level === undefined ? {} : { role: 'heading' }),
  });
}

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

  const intent = navigationIntentFromKey(event.key, {
    ...(state.dir === undefined ? {} : { dir: state.dir }),
    ...(state.orientation === undefined ? {} : { orientation: state.orientation }),
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
  return state.type ?? (Array.isArray(state.value) ? 'multiple' : 'single');
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
