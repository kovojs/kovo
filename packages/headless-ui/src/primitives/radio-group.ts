import {
  checkedState,
  dataDisabled,
  dataOrientation,
  dispatchCancelableChange,
  mergeDataAttributes,
  moveCollectionIndex,
  navigationIntentFromKey,
  type CollectionOrientation,
  type NavigationIntent,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
  type TextDirection,
} from '../lib/index.js';

/**
 * Public interface used by the Radio Group primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { RadioGroupItem } from '@kovojs/headless-ui/radio-group';
 *
 * const value: RadioGroupItem = {} as RadioGroupItem;
 * ```
 */
export interface RadioGroupItem {
  disabled?: boolean;
  value: string;
}

/**
 * State snapshot consumed by the Radio Group primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { RadioGroupState } from '@kovojs/headless-ui/radio-group';
 *
 * const value: RadioGroupState = {} as RadioGroupState;
 * ```
 */
export interface RadioGroupState {
  dir?: TextDirection;
  disabled?: boolean;
  form?: string;
  invalid?: boolean;
  items?: readonly RadioGroupItem[];
  loop?: boolean;
  name?: string;
  orientation?: CollectionOrientation;
  required?: boolean;
  value?: string;
}

/**
 * Options accepted by the Radio Group primitive radio group root attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { RadioGroupRootAttributeOptions } from '@kovojs/headless-ui/radio-group';
 *
 * const value: RadioGroupRootAttributeOptions = {} as RadioGroupRootAttributeOptions;
 * ```
 */
export interface RadioGroupRootAttributeOptions extends RadioGroupState {
  descriptionId?: string;
  errorId?: string;
  id?: string;
  labelledBy?: string;
}

/**
 * Options accepted by the Radio Group primitive radio group item attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { RadioGroupItemAttributeOptions } from '@kovojs/headless-ui/radio-group';
 *
 * const value: RadioGroupItemAttributeOptions = {} as RadioGroupItemAttributeOptions;
 * ```
 */
export interface RadioGroupItemAttributeOptions extends RadioGroupState {
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
}

/**
 * Options accepted by the Radio Group primitive radio group radio attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { RadioGroupRadioAttributeOptions } from '@kovojs/headless-ui/radio-group';
 *
 * const value: RadioGroupRadioAttributeOptions = {} as RadioGroupRadioAttributeOptions;
 * ```
 */
export interface RadioGroupRadioAttributeOptions extends RadioGroupItemAttributeOptions {
  controlId?: string;
}

/**
 * Options accepted by the Radio Group primitive radio group label attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { RadioGroupLabelAttributeOptions } from '@kovojs/headless-ui/radio-group';
 *
 * const value: RadioGroupLabelAttributeOptions = {} as RadioGroupLabelAttributeOptions;
 * ```
 */
export interface RadioGroupLabelAttributeOptions extends RadioGroupItemAttributeOptions {
  controlId?: string;
}

/**
 * Reason token reported by the Radio Group primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { RadioGroupChangeReason } from '@kovojs/headless-ui/radio-group';
 *
 * const value: RadioGroupChangeReason = {} as RadioGroupChangeReason;
 * ```
 */
export type RadioGroupChangeReason = 'item-click' | 'keyboard' | 'programmatic';

/**
 * Cancelable change detail emitted by the Radio Group primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { RadioGroupChangeDetail } from '@kovojs/headless-ui/radio-group';
 *
 * const value: RadioGroupChangeDetail = {} as RadioGroupChangeDetail;
 * ```
 */
export type RadioGroupChangeDetail = PrimitiveChangeDetail<
  RadioGroupChangeReason,
  string | undefined
>;

/**
 * Options accepted by the Radio Group primitive radio group change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { RadioGroupChangeOptions } from '@kovojs/headless-ui/radio-group';
 *
 * const value: RadioGroupChangeOptions = {} as RadioGroupChangeOptions;
 * ```
 */
export interface RadioGroupChangeOptions {
  onValueChange?: (detail: RadioGroupChangeDetail) => void;
}

/**
 * Result returned by the Radio Group primitive radio group change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { RadioGroupChangeResult } from '@kovojs/headless-ui/radio-group';
 *
 * const value: RadioGroupChangeResult = {} as RadioGroupChangeResult;
 * ```
 */
export interface RadioGroupChangeResult {
  changed: boolean;
  detail?: RadioGroupChangeDetail;
  value: string | undefined;
}

/**
 * Result returned by the Radio Group primitive radio group move.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { RadioGroupMoveResult } from '@kovojs/headless-ui/radio-group';
 *
 * const value: RadioGroupMoveResult = {} as RadioGroupMoveResult;
 * ```
 */
export interface RadioGroupMoveResult {
  index: number;
  value: string | undefined;
}

/**
 * Serializable attribute record returned by Radio Group primitive builders.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { RadioGroupPrimitiveAttributes } from '@kovojs/headless-ui/radio-group';
 *
 * const value: RadioGroupPrimitiveAttributes = {} as RadioGroupPrimitiveAttributes;
 * ```
 */
export type RadioGroupPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

/**
 * Event shape consumed by the Radio Group primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { RadioGroupItemEvent } from '@kovojs/headless-ui/radio-group';
 *
 * const value: RadioGroupItemEvent = {} as RadioGroupItemEvent;
 * ```
 */
export type RadioGroupItemEvent = Event;

/**
 * Event shape consumed by the Radio Group primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { RadioGroupKeyboardEvent } from '@kovojs/headless-ui/radio-group';
 *
 * const value: RadioGroupKeyboardEvent = {} as RadioGroupKeyboardEvent;
 * ```
 */
export type RadioGroupKeyboardEvent = Event & { readonly key: string };

/**
 * Computes radio group item checked for the Radio Group primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { radioGroupItemChecked } from '@kovojs/headless-ui/radio-group';
 *
 * const input = {} as Parameters<typeof radioGroupItemChecked>[0];
 * const result = radioGroupItemChecked(input);
 * ```
 */
export function radioGroupItemChecked(options: RadioGroupItemAttributeOptions): boolean {
  return options.value === options.itemValue;
}

/**
 * Computes radio group roving index for the Radio Group primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { radioGroupRovingIndex } from '@kovojs/headless-ui/radio-group';
 *
 * const input = {} as Parameters<typeof radioGroupRovingIndex>[0];
 * const result = radioGroupRovingIndex(input);
 * ```
 */
export function radioGroupRovingIndex(state: RadioGroupState): number {
  const items = state.items ?? [];
  if (items.length === 0) return -1;

  const selectedIndex = items.findIndex(
    (item) => item.value === state.value && !radioGroupItemDisabled(state, item.value),
  );
  if (selectedIndex >= 0) return selectedIndex;

  return moveCollectionIndex('first', {
    currentIndex: -1,
    items: radioGroupNavigationItems(state),
  });
}

/**
 * Builds the radio group root attributes record for the Radio Group primitive.
 *
 * Emits `aria-labelledby`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { radioGroupRootAttributes } from '@kovojs/headless-ui/radio-group';
 *
 * const input = {} as Parameters<typeof radioGroupRootAttributes>[0];
 * const result = radioGroupRootAttributes(input);
 * ```
 */
export function radioGroupRootAttributes(
  options: RadioGroupRootAttributeOptions = {},
): RadioGroupPrimitiveAttributes {
  const describedBy = radioGroupDescribedBy(options);

  return Object.freeze({
    ...radioGroupDataAttributes(options),
    role: 'radiogroup',
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
    ...(describedBy === '' ? {} : { 'aria-describedby': describedBy }),
    ...(options.disabled === true ? { 'aria-disabled': 'true' } : {}),
    ...(options.invalid === true ? { 'aria-invalid': 'true' } : {}),
    ...(options.required === true ? { 'aria-required': 'true' } : {}),
  });
}

/**
 * Builds the radio group item attributes record for the Radio Group primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { radioGroupItemAttributes } from '@kovojs/headless-ui/radio-group';
 *
 * const input = {} as Parameters<typeof radioGroupItemAttributes>[0];
 * const result = radioGroupItemAttributes(input);
 * ```
 */
export function radioGroupItemAttributes(
  options: RadioGroupItemAttributeOptions,
): RadioGroupPrimitiveAttributes {
  return Object.freeze({
    ...radioGroupItemDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

/**
 * Builds the radio group radio attributes record for the Radio Group primitive.
 *
 * Emits `aria-checked`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { radioGroupRadioAttributes } from '@kovojs/headless-ui/radio-group';
 *
 * const input = {} as Parameters<typeof radioGroupRadioAttributes>[0];
 * const result = radioGroupRadioAttributes(input);
 * ```
 */
export function radioGroupRadioAttributes(
  options: RadioGroupRadioAttributeOptions,
): RadioGroupPrimitiveAttributes {
  const disabled = radioGroupItemDisabled(options, options.itemValue);
  const checked = radioGroupItemChecked(options);

  // SPEC.md §6.3: form() typing validates real named controls; radio-group
  // preserves native radio inputs instead of synthesizing hidden fields.
  return Object.freeze({
    ...radioGroupItemDataAttributes(options),
    'aria-checked': String(checked),
    checked,
    disabled,
    tabIndex: radioGroupItemTabIndex(options),
    type: 'radio',
    value: options.itemValue,
    ...(options.controlId === undefined ? {} : { id: options.controlId }),
    ...(options.form === undefined ? {} : { form: options.form }),
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(options.required === true ? { required: true } : {}),
  });
}

/**
 * Builds the radio group label attributes record for the Radio Group primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { radioGroupLabelAttributes } from '@kovojs/headless-ui/radio-group';
 *
 * const input = {} as Parameters<typeof radioGroupLabelAttributes>[0];
 * const result = radioGroupLabelAttributes(input);
 * ```
 */
export function radioGroupLabelAttributes(
  options: RadioGroupLabelAttributeOptions,
): RadioGroupPrimitiveAttributes {
  return Object.freeze({
    ...radioGroupItemDataAttributes(options),
    ...(options.controlId === undefined ? {} : { for: options.controlId }),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

/**
 * Computes the set radio group value transition for the Radio Group primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { setRadioGroupValue } from '@kovojs/headless-ui/radio-group';
 *
 * const input = {} as Parameters<typeof setRadioGroupValue>[0];
 * const state = {} as Parameters<typeof setRadioGroupValue>[1];
 * const options = {} as Parameters<typeof setRadioGroupValue>[2];
 * const detail = {} as Parameters<typeof setRadioGroupValue>[3];
 * const result = setRadioGroupValue(input, state, options, detail);
 * ```
 */
export function setRadioGroupValue(
  state: RadioGroupState,
  value: string | undefined,
  reason: RadioGroupChangeReason,
  options: RadioGroupChangeOptions = {},
): RadioGroupChangeResult {
  if (state.disabled || state.value === value || radioGroupValueDisabled(state, value)) {
    return { changed: false, value: state.value };
  }

  const detail = dispatchCancelableChange({ reason, value }, options.onValueChange);
  if (detail.defaultPrevented) {
    return { changed: false, detail, value: state.value };
  }

  return { changed: true, detail, value };
}

/**
 * Computes radio group move value for the Radio Group primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { radioGroupMoveValue } from '@kovojs/headless-ui/radio-group';
 *
 * const input = {} as Parameters<typeof radioGroupMoveValue>[0];
 * const state = {} as Parameters<typeof radioGroupMoveValue>[1];
 * const result = radioGroupMoveValue(input, state);
 * ```
 */
export function radioGroupMoveValue(
  state: RadioGroupState,
  intent: NavigationIntent,
): RadioGroupMoveResult {
  const items = state.items ?? [];
  if (state.disabled || items.length === 0) return { index: -1, value: state.value };

  const currentIndex = radioGroupRovingIndex(state);
  if (currentIndex < 0) return { index: -1, value: state.value };

  const index = moveCollectionIndex(intent, {
    currentIndex,
    items: radioGroupNavigationItems(state),
    ...(state.loop === undefined ? {} : { loop: state.loop }),
  });

  return {
    index,
    value: index < 0 ? state.value : items[index]?.value,
  };
}

/**
 * Handles the radio group item click interaction for the Radio Group primitive.
 *
 * @example
 * ```ts
 * import { radioGroupItemClick } from '@kovojs/headless-ui/radio-group';
 *
 * const input = {} as Parameters<typeof radioGroupItemClick>[0];
 * const state = {} as Parameters<typeof radioGroupItemClick>[1];
 * const options = {} as Parameters<typeof radioGroupItemClick>[2];
 * const result = radioGroupItemClick(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function radioGroupItemClick(
  event: RadioGroupItemEvent,
  state: RadioGroupItemAttributeOptions,
  options: RadioGroupChangeOptions = {},
): RadioGroupChangeResult | undefined {
  if (event.defaultPrevented) return;

  const result = setRadioGroupValue(state, state.itemValue, 'item-click', options);
  if (!result.changed) {
    event.preventDefault();
  }

  return result;
}

/**
 * Handles the radio group key down interaction for the Radio Group primitive.
 *
 * @example
 * ```ts
 * import { radioGroupKeyDown } from '@kovojs/headless-ui/radio-group';
 *
 * const input = {} as Parameters<typeof radioGroupKeyDown>[0];
 * const state = {} as Parameters<typeof radioGroupKeyDown>[1];
 * const options = {} as Parameters<typeof radioGroupKeyDown>[2];
 * const result = radioGroupKeyDown(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function radioGroupKeyDown(
  event: RadioGroupKeyboardEvent,
  state: RadioGroupState,
  options: RadioGroupChangeOptions = {},
): RadioGroupChangeResult | undefined {
  if (event.defaultPrevented) return;

  const intent = navigationIntentFromKey(event.key, {
    ...(state.dir === undefined ? {} : { dir: state.dir }),
    ...(state.orientation === undefined ? {} : { orientation: state.orientation }),
  });
  if (intent === undefined) return;

  const next = radioGroupMoveValue(state, intent);
  if (next.index < 0) return;

  const result = setRadioGroupValue(state, next.value, 'keyboard', options);
  event.preventDefault();

  return result;
}

function radioGroupDataAttributes(state: RadioGroupState): PrimitiveDataAttributes {
  return mergeDataAttributes(
    dataOrientation(radioGroupDataOrientation(state.orientation)),
    dataDisabled(state.disabled === true),
    state.invalid === true ? { 'data-invalid': '' } : undefined,
    state.required === true ? { 'data-required': '' } : undefined,
  );
}

function radioGroupItemDataAttributes(
  options: RadioGroupItemAttributeOptions,
): PrimitiveDataAttributes {
  return mergeDataAttributes(
    checkedState(radioGroupItemChecked(options)),
    dataDisabled(radioGroupItemDisabled(options, options.itemValue)),
  );
}

function radioGroupItemTabIndex(options: RadioGroupItemAttributeOptions): number {
  if (radioGroupItemDisabled(options, options.itemValue)) return -1;

  const itemIndex = options.items?.findIndex((item) => item.value === options.itemValue) ?? -1;
  if (itemIndex >= 0) return itemIndex === radioGroupRovingIndex(options) ? 0 : -1;

  return radioGroupItemChecked(options) ? 0 : -1;
}

function radioGroupItemDisabled(
  state: RadioGroupState & { itemDisabled?: boolean },
  value: string,
): boolean {
  return (
    state.disabled === true ||
    state.itemDisabled === true ||
    state.items?.find((item) => item.value === value)?.disabled === true
  );
}

function radioGroupValueDisabled(state: RadioGroupState, value: string | undefined): boolean {
  return value !== undefined && radioGroupItemDisabled(state, value);
}

function radioGroupNavigationItems(state: RadioGroupState): readonly { disabled?: boolean }[] {
  return (state.items ?? []).map((item) => ({
    disabled: state.disabled === true || item.disabled === true,
  }));
}

function radioGroupDataOrientation(
  orientation: CollectionOrientation | undefined,
): 'horizontal' | 'vertical' {
  return orientation === 'horizontal' ? 'horizontal' : 'vertical';
}

function radioGroupDescribedBy(options: {
  descriptionId?: string;
  errorId?: string;
  invalid?: boolean;
}): string {
  return [options.descriptionId, options.invalid === true ? options.errorId : undefined]
    .filter((id): id is string => id !== undefined && id.length > 0)
    .join(' ');
}
