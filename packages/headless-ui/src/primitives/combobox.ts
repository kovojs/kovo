import {
  checkedState,
  dataDisabled,
  dataState,
  dispatchCancelableChange,
  findTypeaheadMatch,
  mergeDataAttributes,
  moveCollectionIndex,
  navigationIntentFromKey,
  nextTypeaheadState,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
  type TypeaheadState,
} from '../lib/index.js';

/**
 * Public interface used by the Combobox primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ComboboxItem } from '@kovojs/headless-ui/combobox';
 *
 * const value: ComboboxItem = {} as ComboboxItem;
 * ```
 */
export interface ComboboxItem {
  disabled?: boolean;
  id?: string;
  label?: string;
  textValue?: string;
  value: string;
}

/**
 * State snapshot consumed by the Combobox primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ComboboxState } from '@kovojs/headless-ui/combobox';
 *
 * const value: ComboboxState = {} as ComboboxState;
 * ```
 */
export interface ComboboxState {
  disabled?: boolean;
  form?: string;
  highlightedValue?: string;
  invalid?: boolean;
  items?: readonly ComboboxItem[];
  listboxId?: string;
  name?: string;
  open?: boolean;
  placeholder?: string;
  required?: boolean;
  value?: string;
}

/**
 * Options accepted by the Combobox primitive combobox root attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ComboboxRootAttributeOptions } from '@kovojs/headless-ui/combobox';
 *
 * const value: ComboboxRootAttributeOptions = {} as ComboboxRootAttributeOptions;
 * ```
 */
export interface ComboboxRootAttributeOptions extends ComboboxState {
  id?: string;
}

/**
 * Options accepted by the Combobox primitive combobox input attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ComboboxInputAttributeOptions } from '@kovojs/headless-ui/combobox';
 *
 * const value: ComboboxInputAttributeOptions = {} as ComboboxInputAttributeOptions;
 * ```
 */
export interface ComboboxInputAttributeOptions extends ComboboxState {
  descriptionId?: string;
  errorId?: string;
  id?: string;
  labelledBy?: string;
}

/**
 * Options accepted by the Combobox primitive combobox listbox attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ComboboxListboxAttributeOptions } from '@kovojs/headless-ui/combobox';
 *
 * const value: ComboboxListboxAttributeOptions = {} as ComboboxListboxAttributeOptions;
 * ```
 */
export interface ComboboxListboxAttributeOptions extends ComboboxState {
  id?: string;
  labelledBy?: string;
}

/**
 * Options accepted by the Combobox primitive combobox option attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ComboboxOptionAttributeOptions } from '@kovojs/headless-ui/combobox';
 *
 * const value: ComboboxOptionAttributeOptions = {} as ComboboxOptionAttributeOptions;
 * ```
 */
export interface ComboboxOptionAttributeOptions extends ComboboxState {
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemValue: string;
}

/**
 * Options accepted by the Combobox primitive combobox value attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ComboboxValueAttributeOptions } from '@kovojs/headless-ui/combobox';
 *
 * const value: ComboboxValueAttributeOptions = {} as ComboboxValueAttributeOptions;
 * ```
 */
export interface ComboboxValueAttributeOptions extends ComboboxState {
  id?: string;
}

/**
 * Reason token reported by the Combobox primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ComboboxValueChangeReason } from '@kovojs/headless-ui/combobox';
 *
 * const value: ComboboxValueChangeReason = {} as ComboboxValueChangeReason;
 * ```
 */
export type ComboboxValueChangeReason = 'input' | 'option-select' | 'programmatic' | 'typeahead';

/**
 * Reason token reported by the Combobox primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ComboboxOpenChangeReason } from '@kovojs/headless-ui/combobox';
 *
 * const value: ComboboxOpenChangeReason = {} as ComboboxOpenChangeReason;
 * ```
 */
export type ComboboxOpenChangeReason =
  | 'arrow-key'
  | 'escape-key'
  | 'input'
  | 'option-select'
  | 'programmatic'
  | 'typeahead';

/**
 * Cancelable change detail emitted by the Combobox primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ComboboxValueChangeDetail } from '@kovojs/headless-ui/combobox';
 *
 * const value: ComboboxValueChangeDetail = {} as ComboboxValueChangeDetail;
 * ```
 */
export type ComboboxValueChangeDetail = PrimitiveChangeDetail<
  ComboboxValueChangeReason,
  string | undefined
>;

/**
 * Cancelable change detail emitted by the Combobox primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ComboboxOpenChangeDetail } from '@kovojs/headless-ui/combobox';
 *
 * const value: ComboboxOpenChangeDetail = {} as ComboboxOpenChangeDetail;
 * ```
 */
export type ComboboxOpenChangeDetail = PrimitiveChangeDetail<ComboboxOpenChangeReason, boolean>;

/**
 * Options accepted by the Combobox primitive combobox change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ComboboxChangeOptions } from '@kovojs/headless-ui/combobox';
 *
 * const value: ComboboxChangeOptions = {} as ComboboxChangeOptions;
 * ```
 */
export interface ComboboxChangeOptions {
  onOpenChange?: (detail: ComboboxOpenChangeDetail) => void;
  onValueChange?: (detail: ComboboxValueChangeDetail) => void;
}

/**
 * Result returned by the Combobox primitive combobox value change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ComboboxValueChangeResult } from '@kovojs/headless-ui/combobox';
 *
 * const value: ComboboxValueChangeResult = {} as ComboboxValueChangeResult;
 * ```
 */
export interface ComboboxValueChangeResult {
  changed: boolean;
  detail?: ComboboxValueChangeDetail;
  value: string | undefined;
}

/**
 * Result returned by the Combobox primitive combobox open change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ComboboxOpenChangeResult } from '@kovojs/headless-ui/combobox';
 *
 * const value: ComboboxOpenChangeResult = {} as ComboboxOpenChangeResult;
 * ```
 */
export interface ComboboxOpenChangeResult {
  changed: boolean;
  detail?: ComboboxOpenChangeDetail;
  open: boolean;
}

/**
 * Result returned by the Combobox primitive combobox move.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ComboboxMoveResult } from '@kovojs/headless-ui/combobox';
 *
 * const value: ComboboxMoveResult = {} as ComboboxMoveResult;
 * ```
 */
export interface ComboboxMoveResult {
  highlightedIndex: number;
  highlightedValue: string | undefined;
}

/**
 * Result returned by the Combobox primitive combobox option select.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ComboboxOptionSelectResult } from '@kovojs/headless-ui/combobox';
 *
 * const value: ComboboxOptionSelectResult = {} as ComboboxOptionSelectResult;
 * ```
 */
export interface ComboboxOptionSelectResult {
  open: ComboboxOpenChangeResult;
  value: ComboboxValueChangeResult;
}

/**
 * Options accepted by the Combobox primitive combobox typeahead.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ComboboxTypeaheadOptions } from '@kovojs/headless-ui/combobox';
 *
 * const value: ComboboxTypeaheadOptions = {} as ComboboxTypeaheadOptions;
 * ```
 */
export interface ComboboxTypeaheadOptions {
  currentValue?: string;
  loop?: boolean;
  now: number;
  state?: TypeaheadState;
  timeoutMs?: number;
}

/**
 * Result returned by the Combobox primitive combobox typeahead.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ComboboxTypeaheadResult } from '@kovojs/headless-ui/combobox';
 *
 * const value: ComboboxTypeaheadResult = {} as ComboboxTypeaheadResult;
 * ```
 */
export interface ComboboxTypeaheadResult {
  matchIndex: number;
  state: TypeaheadState;
  value: string | undefined;
}

/**
 * Serializable attribute record returned by Combobox primitive builders.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ComboboxPrimitiveAttributes } from '@kovojs/headless-ui/combobox';
 *
 * const value: ComboboxPrimitiveAttributes = {} as ComboboxPrimitiveAttributes;
 * ```
 */
export type ComboboxPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

/**
 * Event shape consumed by the Combobox primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ComboboxInputEvent } from '@kovojs/headless-ui/combobox';
 *
 * const value: ComboboxInputEvent = {} as ComboboxInputEvent;
 * ```
 */
export type ComboboxInputEvent = Event & {
  readonly currentTarget: (EventTarget & { value?: string }) | null;
  readonly target?: (EventTarget & { value?: string }) | null;
};

/**
 * Event shape consumed by the Combobox primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ComboboxOptionEvent } from '@kovojs/headless-ui/combobox';
 *
 * const value: ComboboxOptionEvent = {} as ComboboxOptionEvent;
 * ```
 */
export type ComboboxOptionEvent = Event;

/**
 * Event shape consumed by the Combobox primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ComboboxKeyboardEvent } from '@kovojs/headless-ui/combobox';
 *
 * const value: ComboboxKeyboardEvent = {} as ComboboxKeyboardEvent;
 * ```
 */
export type ComboboxKeyboardEvent = Event & { readonly key: string };

/**
 * Result returned by the Combobox primitive combobox keyboard.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ComboboxKeyboardResult } from '@kovojs/headless-ui/combobox';
 *
 * const value: ComboboxKeyboardResult = {} as ComboboxKeyboardResult;
 * ```
 */
export type ComboboxKeyboardResult =
  | ComboboxMoveResult
  | ComboboxOpenChangeResult
  | ComboboxOptionSelectResult;

/**
 * Computes combobox option selected for the Combobox primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { comboboxOptionSelected } from '@kovojs/headless-ui/combobox';
 *
 * const input = {} as Parameters<typeof comboboxOptionSelected>[0];
 * const result = comboboxOptionSelected(input);
 * ```
 */
export function comboboxOptionSelected(options: ComboboxOptionAttributeOptions): boolean {
  return options.value === options.itemValue;
}

/**
 * Computes combobox option highlighted for the Combobox primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { comboboxOptionHighlighted } from '@kovojs/headless-ui/combobox';
 *
 * const input = {} as Parameters<typeof comboboxOptionHighlighted>[0];
 * const result = comboboxOptionHighlighted(input);
 * ```
 */
export function comboboxOptionHighlighted(options: ComboboxOptionAttributeOptions): boolean {
  return options.highlightedValue === options.itemValue;
}

/**
 * Computes combobox value text for the Combobox primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { comboboxValueText } from '@kovojs/headless-ui/combobox';
 *
 * const input = {} as Parameters<typeof comboboxValueText>[0];
 * const result = comboboxValueText(input);
 * ```
 */
export function comboboxValueText(state: ComboboxState): string {
  const selected = state.items?.find((item) => item.value === state.value);
  if (selected) return selected.label ?? selected.textValue ?? selected.value;
  if (state.value === undefined || state.value === '') return state.placeholder ?? '';
  return state.value;
}

/**
 * Computes combobox filtered items for the Combobox primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { comboboxFilteredItems } from '@kovojs/headless-ui/combobox';
 *
 * const input = {} as Parameters<typeof comboboxFilteredItems>[0];
 * const result = comboboxFilteredItems(input);
 * ```
 */
export function comboboxFilteredItems(state: ComboboxState): readonly ComboboxItem[] {
  const query = normalizeComboboxQuery(state.value);
  const items = state.items ?? [];
  if (query === '') return items;

  return Object.freeze(items.filter((item) => comboboxItemMatches(item, query)));
}

/**
 * Builds the combobox root attributes record for the Combobox primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { comboboxRootAttributes } from '@kovojs/headless-ui/combobox';
 *
 * const input = {} as Parameters<typeof comboboxRootAttributes>[0];
 * const result = comboboxRootAttributes(input);
 * ```
 */
export function comboboxRootAttributes(
  options: ComboboxRootAttributeOptions = {},
): ComboboxPrimitiveAttributes {
  return Object.freeze({
    ...comboboxDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

/**
 * Builds the combobox input attributes record for the Combobox primitive.
 *
 * Emits `aria-autocomplete`, `aria-expanded`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { comboboxInputAttributes } from '@kovojs/headless-ui/combobox';
 *
 * const input = {} as Parameters<typeof comboboxInputAttributes>[0];
 * const result = comboboxInputAttributes(input);
 * ```
 */
export function comboboxInputAttributes(
  options: ComboboxInputAttributeOptions = {},
): ComboboxPrimitiveAttributes {
  const describedBy = comboboxDescribedBy(options);
  const activeDescendant = comboboxActiveDescendant(options);

  // SPEC.md §6.3: form() typing validates real named controls; combobox keeps
  // the native input as the submitted control instead of synthesizing hidden fields.
  return Object.freeze({
    ...comboboxDataAttributes(options),
    'aria-autocomplete': 'list',
    'aria-expanded': String(options.open === true),
    role: 'combobox',
    type: 'text',
    value: options.value ?? '',
    ...(activeDescendant === undefined ? {} : { 'aria-activedescendant': activeDescendant }),
    ...(options.listboxId === undefined ? {} : { 'aria-controls': options.listboxId }),
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
    ...(describedBy === '' ? {} : { 'aria-describedby': describedBy }),
    ...(options.invalid === true ? { 'aria-invalid': 'true' } : {}),
    disabled: options.disabled === true,
    ...(options.form === undefined ? {} : { form: options.form }),
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(options.placeholder === undefined ? {} : { placeholder: options.placeholder }),
    ...(options.required === true ? { required: true } : {}),
  });
}

/**
 * Builds the combobox listbox attributes record for the Combobox primitive.
 *
 * Emits `aria-labelledby`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { comboboxListboxAttributes } from '@kovojs/headless-ui/combobox';
 *
 * const input = {} as Parameters<typeof comboboxListboxAttributes>[0];
 * const result = comboboxListboxAttributes(input);
 * ```
 */
export function comboboxListboxAttributes(
  options: ComboboxListboxAttributeOptions = {},
): ComboboxPrimitiveAttributes {
  return Object.freeze({
    ...comboboxDataAttributes(options),
    role: 'listbox',
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
    ...(options.open === true ? {} : { hidden: true }),
  });
}

/**
 * Builds the combobox option attributes record for the Combobox primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { comboboxOptionAttributes } from '@kovojs/headless-ui/combobox';
 *
 * const input = {} as Parameters<typeof comboboxOptionAttributes>[0];
 * const result = comboboxOptionAttributes(input);
 * ```
 */
export function comboboxOptionAttributes(
  options: ComboboxOptionAttributeOptions,
): ComboboxPrimitiveAttributes {
  const disabled = comboboxOptionDisabled(options, options.itemValue);
  const selected = comboboxOptionSelected(options);
  // J2 (SPEC.md §4.6): resolve a stable option id so the synthesized
  // aria-activedescendant always references a rendered option. Honor an explicit
  // id, then the item's own id, then auto-generate `<listboxId>-option-<i>` against
  // the *filtered* render order — the exact id comboboxActiveDescendant falls back
  // to. Mirrors command.ts (commandItemId + the filtered-index fallback).
  const id = comboboxOptionId(options, options.itemValue);

  return Object.freeze({
    ...comboboxOptionDataAttributes(options),
    'aria-selected': String(selected),
    role: 'option',
    ...(id === undefined ? {} : { id }),
    ...(disabled ? { 'aria-disabled': 'true' } : {}),
    ...(options.itemLabel === undefined ? {} : { label: options.itemLabel }),
    value: options.itemValue,
  });
}

/**
 * Builds the combobox value attributes record for the Combobox primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { comboboxValueAttributes } from '@kovojs/headless-ui/combobox';
 *
 * const input = {} as Parameters<typeof comboboxValueAttributes>[0];
 * const result = comboboxValueAttributes(input);
 * ```
 */
export function comboboxValueAttributes(
  options: ComboboxValueAttributeOptions = {},
): ComboboxPrimitiveAttributes {
  return Object.freeze({
    ...comboboxValueDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

/**
 * Computes the set combobox value transition for the Combobox primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { setComboboxValue } from '@kovojs/headless-ui/combobox';
 *
 * const input = {} as Parameters<typeof setComboboxValue>[0];
 * const state = {} as Parameters<typeof setComboboxValue>[1];
 * const options = {} as Parameters<typeof setComboboxValue>[2];
 * const detail = {} as Parameters<typeof setComboboxValue>[3];
 * const result = setComboboxValue(input, state, options, detail);
 * ```
 */
export function setComboboxValue(
  state: ComboboxState,
  value: string | undefined,
  reason: ComboboxValueChangeReason,
  options: ComboboxChangeOptions = {},
): ComboboxValueChangeResult {
  if (state.disabled || state.value === value || comboboxValueDisabled(state, value)) {
    return { changed: false, value: state.value };
  }

  const detail = dispatchCancelableChange({ reason, value }, options.onValueChange);
  if (detail.defaultPrevented) {
    return { changed: false, detail, value: state.value };
  }

  return { changed: true, detail, value };
}

/**
 * Computes the set combobox open transition for the Combobox primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { setComboboxOpen } from '@kovojs/headless-ui/combobox';
 *
 * const input = {} as Parameters<typeof setComboboxOpen>[0];
 * const state = {} as Parameters<typeof setComboboxOpen>[1];
 * const options = {} as Parameters<typeof setComboboxOpen>[2];
 * const detail = {} as Parameters<typeof setComboboxOpen>[3];
 * const result = setComboboxOpen(input, state, options, detail);
 * ```
 */
export function setComboboxOpen(
  state: ComboboxState,
  open: boolean,
  reason: ComboboxOpenChangeReason,
  options: ComboboxChangeOptions = {},
): ComboboxOpenChangeResult {
  if (state.disabled || state.open === open) {
    return { changed: false, open: state.open === true };
  }

  const detail = dispatchCancelableChange({ reason, value: open }, options.onOpenChange);
  if (detail.defaultPrevented) {
    return { changed: false, detail, open: state.open === true };
  }

  return { changed: true, detail, open };
}

/**
 * Computes the select combobox option transition for the Combobox primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { selectComboboxOption } from '@kovojs/headless-ui/combobox';
 *
 * const input = {} as Parameters<typeof selectComboboxOption>[0];
 * const state = {} as Parameters<typeof selectComboboxOption>[1];
 * const options = {} as Parameters<typeof selectComboboxOption>[2];
 * const result = selectComboboxOption(input, state, options);
 * ```
 */
export function selectComboboxOption(
  state: ComboboxState,
  value: string | undefined,
  options: ComboboxChangeOptions = {},
): ComboboxOptionSelectResult {
  const valueResult = setComboboxValue(state, value, 'option-select', options);

  // UX (B5): selecting any option closes the listbox, including re-selecting the
  // currently selected value. Previously an unchanged value early-returned with
  // open unchanged, leaving the popup open on re-select.
  const openResult = setComboboxOpen(state, false, 'option-select', options);
  if (openResult.detail?.defaultPrevented === true) {
    return {
      open: openResult,
      value: {
        changed: false,
        ...(valueResult.detail === undefined ? {} : { detail: valueResult.detail }),
        value: state.value,
      },
    };
  }

  return {
    open: openResult,
    value: valueResult,
  };
}

/**
 * Computes combobox typeahead for the Combobox primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { comboboxTypeahead } from '@kovojs/headless-ui/combobox';
 *
 * const input = {} as Parameters<typeof comboboxTypeahead>[0];
 * const state = {} as Parameters<typeof comboboxTypeahead>[1];
 * const options = {} as Parameters<typeof comboboxTypeahead>[2];
 * const result = comboboxTypeahead(input, state, options);
 * ```
 */
export function comboboxTypeahead(
  state: ComboboxState,
  key: string,
  options: ComboboxTypeaheadOptions,
): ComboboxTypeaheadResult {
  const nextState = nextTypeaheadState(
    state.disabled ? undefined : options.state,
    key,
    options.now,
    options.timeoutMs,
  );
  if (state.disabled || nextState.buffer === '') {
    return { matchIndex: -1, state: nextState, value: options.currentValue ?? state.value };
  }

  const items = (state.items ?? []).map((item) => ({
    ...(item.disabled === undefined ? {} : { disabled: item.disabled }),
    textValue: item.textValue ?? item.label ?? item.value,
  }));
  const currentIndex = (state.items ?? []).findIndex(
    (item) => item.value === (options.currentValue ?? state.highlightedValue ?? state.value),
  );
  const matchIndex = findTypeaheadMatch({
    currentIndex,
    items,
    ...(options.loop === undefined ? {} : { loop: options.loop }),
    search: nextState.buffer,
  });

  return {
    matchIndex,
    state: nextState,
    value:
      matchIndex < 0 ? (options.currentValue ?? state.value) : state.items?.[matchIndex]?.value,
  };
}

/**
 * Computes combobox move for the Combobox primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { comboboxMove } from '@kovojs/headless-ui/combobox';
 *
 * const input = {} as Parameters<typeof comboboxMove>[0];
 * const state = {} as Parameters<typeof comboboxMove>[1];
 * const options = {} as Parameters<typeof comboboxMove>[2];
 * const result = comboboxMove(input, state, options);
 * ```
 */
export function comboboxMove(
  state: ComboboxState,
  key: string,
  options: { loop?: boolean } = {},
): ComboboxMoveResult | undefined {
  if (state.disabled) return undefined;

  const intent = navigationIntentFromKey(key, { orientation: 'vertical' });
  if (intent === undefined) return undefined;

  const sourceItems = state.items ?? [];
  const items = sourceItems.map((item) =>
    item.disabled === undefined ? {} : { disabled: item.disabled },
  );
  const currentIndex = items.findIndex(
    (_item, index) => sourceItems[index]?.value === (state.highlightedValue ?? state.value),
  );
  const highlightedIndex = moveCollectionIndex(intent, {
    currentIndex,
    items,
    ...(options.loop === undefined ? {} : { loop: options.loop }),
  });

  return {
    highlightedIndex,
    highlightedValue: highlightedIndex < 0 ? undefined : sourceItems[highlightedIndex]?.value,
  };
}

/**
 * Handles the combobox input interaction for the Combobox primitive.
 *
 * @example
 * ```ts
 * import { comboboxInput } from '@kovojs/headless-ui/combobox';
 *
 * const input = {} as Parameters<typeof comboboxInput>[0];
 * const state = {} as Parameters<typeof comboboxInput>[1];
 * const options = {} as Parameters<typeof comboboxInput>[2];
 * const result = comboboxInput(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function comboboxInput(
  event: ComboboxInputEvent,
  state: ComboboxState,
  options: ComboboxChangeOptions = {},
): ComboboxValueChangeResult | undefined {
  if (event.defaultPrevented) return;

  const inputTarget = event.target ?? event.currentTarget;
  const result = setComboboxValue(state, inputTarget?.value, 'input', options);
  if (!result.changed) {
    if (inputTarget) inputTarget.value = result.value ?? '';
    if (event.currentTarget && event.currentTarget !== inputTarget) {
      event.currentTarget.value = result.value ?? '';
    }
    event.preventDefault();
  }

  return result;
}

/**
 * Handles the combobox option click interaction for the Combobox primitive.
 *
 * @example
 * ```ts
 * import { comboboxOptionClick } from '@kovojs/headless-ui/combobox';
 *
 * const input = {} as Parameters<typeof comboboxOptionClick>[0];
 * const state = {} as Parameters<typeof comboboxOptionClick>[1];
 * const options = {} as Parameters<typeof comboboxOptionClick>[2];
 * const result = comboboxOptionClick(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function comboboxOptionClick(
  event: ComboboxOptionEvent,
  state: ComboboxOptionAttributeOptions,
  options: ComboboxChangeOptions = {},
): ComboboxOptionSelectResult | undefined {
  if (event.defaultPrevented) return;

  const result = selectComboboxOption(state, state.itemValue, options);
  if (!result.value.changed) {
    event.preventDefault();
  }

  return result;
}

/**
 * Handles the combobox key down interaction for the Combobox primitive.
 *
 * @example
 * ```ts
 * import { comboboxKeyDown } from '@kovojs/headless-ui/combobox';
 *
 * const input = {} as Parameters<typeof comboboxKeyDown>[0];
 * const state = {} as Parameters<typeof comboboxKeyDown>[1];
 * const options = {} as Parameters<typeof comboboxKeyDown>[2];
 * const result = comboboxKeyDown(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function comboboxKeyDown(
  event: ComboboxKeyboardEvent,
  state: ComboboxState,
  options: ComboboxChangeOptions = {},
): ComboboxKeyboardResult | undefined {
  if (event.defaultPrevented) return;

  if (event.key === 'Enter' && state.open === true && state.highlightedValue !== undefined) {
    const result = selectComboboxOption(state, state.highlightedValue, options);
    if (result.value.changed) event.preventDefault();
    return result;
  }

  if (event.key === 'Escape') {
    const result = setComboboxOpen(state, false, 'escape-key', options);
    if (result.changed) event.preventDefault();
    return result;
  }

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (state.open === true) {
      const result = comboboxMove(state, event.key, { loop: true });
      if (result !== undefined) event.preventDefault();
      return result;
    }

    const result = setComboboxOpen(state, true, 'arrow-key', options);
    if (result.changed) event.preventDefault();
    return result;
  }

  return undefined;
}

function comboboxDataAttributes(state: ComboboxState): PrimitiveDataAttributes {
  return mergeDataAttributes(
    dataState(state.open === true ? 'open' : 'closed'),
    dataDisabled(state.disabled === true),
    comboboxValueDataAttributes(state),
    state.invalid === true ? { 'data-invalid': '' } : undefined,
    state.required === true ? { 'data-required': '' } : undefined,
  );
}

function comboboxOptionDataAttributes(
  options: ComboboxOptionAttributeOptions,
): PrimitiveDataAttributes {
  return mergeDataAttributes(
    checkedState(comboboxOptionSelected(options)),
    dataDisabled(comboboxOptionDisabled(options, options.itemValue)),
    comboboxOptionHighlighted(options) ? { 'data-highlighted': '' } : undefined,
  );
}

function comboboxValueDataAttributes(state: ComboboxState): PrimitiveDataAttributes {
  return state.value === undefined || state.value === ''
    ? Object.freeze({ 'data-placeholder': '' })
    : Object.freeze({});
}

function comboboxOptionDisabled(
  state: ComboboxState & { itemDisabled?: boolean },
  value: string,
): boolean {
  return (
    state.disabled === true ||
    state.itemDisabled === true ||
    state.items?.find((item) => item.value === value)?.disabled === true
  );
}

function comboboxValueDisabled(state: ComboboxState, value: string | undefined): boolean {
  return value !== undefined && comboboxOptionDisabled(state, value);
}

function comboboxActiveDescendant(options: ComboboxInputAttributeOptions): string | undefined {
  if (options.highlightedValue === undefined) return undefined;

  const itemId = comboboxItemId(options, options.highlightedValue);
  if (itemId !== undefined) return itemId;

  // J2 (SPEC.md §4.6): index against the *filtered* render order (the options the
  // listbox actually renders, comboboxFilteredItems), not the full item list, so the
  // synthesized id matches the rendered option's auto-generated id after filtering.
  return comboboxFallbackOptionId(options, options.highlightedValue);
}

function comboboxItemId(state: ComboboxState, value: string): string | undefined {
  return state.items?.find((item) => item.value === value)?.id;
}

function comboboxOptionId(
  options: ComboboxOptionAttributeOptions,
  value: string,
): string | undefined {
  if (options.id !== undefined) return options.id;
  const itemId = comboboxItemId(options, value);
  if (itemId !== undefined) return itemId;
  return comboboxFallbackOptionId(options, value);
}

function comboboxFallbackOptionId(
  state: ComboboxState & { id?: string },
  value: string,
): string | undefined {
  // J2 (SPEC.md §4.6): index against the *filtered* render order so the synthesized
  // id matches the rendered option's position after typing. Mirrors command.ts:649.
  // If the value is not in the filtered set (e.g. an app that renders the unfiltered
  // list), fall back to the full-list index so the IDREF still resolves to that
  // option rather than vanishing.
  const filteredIndex = comboboxFilteredItems(state).findIndex((item) => item.value === value);
  const index =
    filteredIndex >= 0
      ? filteredIndex
      : (state.items?.findIndex((item) => item.value === value) ?? -1);
  if (index < 0) return undefined;
  return `${state.listboxId ?? state.id ?? 'combobox'}-option-${index}`;
}

function comboboxDescribedBy(options: {
  descriptionId?: string;
  errorId?: string;
  invalid?: boolean;
}): string {
  return [options.descriptionId, options.invalid === true ? options.errorId : undefined]
    .filter((id): id is string => id !== undefined && id.length > 0)
    .join(' ');
}

function comboboxItemMatches(item: ComboboxItem, query: string): boolean {
  return comboboxSearchText(item).includes(query);
}

function comboboxSearchText(item: ComboboxItem): string {
  return [item.label, item.textValue, item.value]
    .filter((value): value is string => value !== undefined)
    .join(' ')
    .toLocaleLowerCase();
}

function normalizeComboboxQuery(inputValue: string | undefined): string {
  return (inputValue ?? '').trim().toLocaleLowerCase();
}
