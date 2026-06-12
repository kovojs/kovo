import {
  dataDisabled,
  dataOrientation,
  dispatchCancelableChange,
  mergeDataAttributes,
  openState,
  type CollectionOrientation,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
} from '../lib/index.js';

export type AccordionType = 'multiple' | 'single';

export type AccordionValue = readonly string[] | string | undefined;

export type AccordionChangeReason = 'programmatic' | 'trigger-click';

export type AccordionChangeDetail = PrimitiveChangeDetail<AccordionChangeReason, AccordionValue>;

export interface AccordionState {
  collapsible?: boolean;
  disabled?: boolean;
  orientation?: CollectionOrientation;
  type?: AccordionType;
  value?: AccordionValue;
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

export type AccordionPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

export type AccordionTriggerEvent = Event;

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

/**
 * @jisoPrimitiveHandler
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

function accordionItemDataAttributes(options: AccordionItemOptions): PrimitiveDataAttributes {
  return mergeDataAttributes(
    openState(accordionItemOpen(options)),
    dataDisabled(accordionItemDisabled(options)),
  );
}

function accordionItemDisabled(options: AccordionItemOptions): boolean {
  return options.disabled === true || options.itemDisabled === true;
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
