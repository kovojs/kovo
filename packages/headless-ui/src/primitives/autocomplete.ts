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
 * Public interface used by the Autocomplete primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AutocompleteItem } from '@kovojs/headless-ui/autocomplete';
 *
 * const value: AutocompleteItem = {} as AutocompleteItem;
 * ```
 */
export interface AutocompleteItem {
  disabled?: boolean;
  id?: string;
  label?: string;
  textValue?: string;
  value: string;
}

/**
 * State snapshot consumed by the Autocomplete primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AutocompleteState } from '@kovojs/headless-ui/autocomplete';
 *
 * const value: AutocompleteState = {} as AutocompleteState;
 * ```
 */
export interface AutocompleteState {
  disabled?: boolean;
  form?: string;
  highlightedValue?: string;
  inputValue?: string;
  invalid?: boolean;
  items?: readonly AutocompleteItem[];
  listId?: string;
  name?: string;
  open?: boolean;
  placeholder?: string;
  required?: boolean;
  value?: string;
}

/**
 * Options accepted by the Autocomplete primitive autocomplete root attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AutocompleteRootAttributeOptions } from '@kovojs/headless-ui/autocomplete';
 *
 * const value: AutocompleteRootAttributeOptions = {} as AutocompleteRootAttributeOptions;
 * ```
 */
export interface AutocompleteRootAttributeOptions extends AutocompleteState {
  id?: string;
}

/**
 * Options accepted by the Autocomplete primitive autocomplete input attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AutocompleteInputAttributeOptions } from '@kovojs/headless-ui/autocomplete';
 *
 * const value: AutocompleteInputAttributeOptions = {} as AutocompleteInputAttributeOptions;
 * ```
 */
export interface AutocompleteInputAttributeOptions extends AutocompleteState {
  autocomplete?: string;
  descriptionId?: string;
  errorId?: string;
  id?: string;
  labelledBy?: string;
}

/**
 * Options accepted by the Autocomplete primitive autocomplete list attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AutocompleteListAttributeOptions } from '@kovojs/headless-ui/autocomplete';
 *
 * const value: AutocompleteListAttributeOptions = {} as AutocompleteListAttributeOptions;
 * ```
 */
export interface AutocompleteListAttributeOptions extends AutocompleteState {
  id?: string;
  labelledBy?: string;
}

/**
 * Options accepted by the Autocomplete primitive autocomplete option attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AutocompleteOptionAttributeOptions } from '@kovojs/headless-ui/autocomplete';
 *
 * const value: AutocompleteOptionAttributeOptions = {} as AutocompleteOptionAttributeOptions;
 * ```
 */
export interface AutocompleteOptionAttributeOptions extends AutocompleteState {
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemValue: string;
}

/**
 * Options accepted by the Autocomplete primitive autocomplete value attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AutocompleteValueAttributeOptions } from '@kovojs/headless-ui/autocomplete';
 *
 * const value: AutocompleteValueAttributeOptions = {} as AutocompleteValueAttributeOptions;
 * ```
 */
export interface AutocompleteValueAttributeOptions extends AutocompleteState {
  id?: string;
}

/**
 * Reason token reported by the Autocomplete primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AutocompleteInputChangeReason } from '@kovojs/headless-ui/autocomplete';
 *
 * const value: AutocompleteInputChangeReason = {} as AutocompleteInputChangeReason;
 * ```
 */
export type AutocompleteInputChangeReason = 'input' | 'option-select' | 'programmatic';

/**
 * Reason token reported by the Autocomplete primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AutocompleteValueChangeReason } from '@kovojs/headless-ui/autocomplete';
 *
 * const value: AutocompleteValueChangeReason = {} as AutocompleteValueChangeReason;
 * ```
 */
export type AutocompleteValueChangeReason = 'option-select' | 'programmatic' | 'typeahead';

/**
 * Reason token reported by the Autocomplete primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AutocompleteOpenChangeReason } from '@kovojs/headless-ui/autocomplete';
 *
 * const value: AutocompleteOpenChangeReason = {} as AutocompleteOpenChangeReason;
 * ```
 */
export type AutocompleteOpenChangeReason =
  | 'arrow-key'
  | 'escape-key'
  | 'input'
  | 'option-select'
  | 'programmatic'
  | 'typeahead';

/**
 * Cancelable change detail emitted by the Autocomplete primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AutocompleteInputChangeDetail } from '@kovojs/headless-ui/autocomplete';
 *
 * const value: AutocompleteInputChangeDetail = {} as AutocompleteInputChangeDetail;
 * ```
 */
export type AutocompleteInputChangeDetail = PrimitiveChangeDetail<
  AutocompleteInputChangeReason,
  string
>;

/**
 * Cancelable change detail emitted by the Autocomplete primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AutocompleteValueChangeDetail } from '@kovojs/headless-ui/autocomplete';
 *
 * const value: AutocompleteValueChangeDetail = {} as AutocompleteValueChangeDetail;
 * ```
 */
export type AutocompleteValueChangeDetail = PrimitiveChangeDetail<
  AutocompleteValueChangeReason,
  string | undefined
>;

/**
 * Cancelable change detail emitted by the Autocomplete primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AutocompleteOpenChangeDetail } from '@kovojs/headless-ui/autocomplete';
 *
 * const value: AutocompleteOpenChangeDetail = {} as AutocompleteOpenChangeDetail;
 * ```
 */
export type AutocompleteOpenChangeDetail = PrimitiveChangeDetail<
  AutocompleteOpenChangeReason,
  boolean
>;

/**
 * Options accepted by the Autocomplete primitive autocomplete change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AutocompleteChangeOptions } from '@kovojs/headless-ui/autocomplete';
 *
 * const value: AutocompleteChangeOptions = {} as AutocompleteChangeOptions;
 * ```
 */
export interface AutocompleteChangeOptions {
  onInputValueChange?: (detail: AutocompleteInputChangeDetail) => void;
  onOpenChange?: (detail: AutocompleteOpenChangeDetail) => void;
  onValueChange?: (detail: AutocompleteValueChangeDetail) => void;
}

/**
 * Result returned by the Autocomplete primitive autocomplete input change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AutocompleteInputChangeResult } from '@kovojs/headless-ui/autocomplete';
 *
 * const value: AutocompleteInputChangeResult = {} as AutocompleteInputChangeResult;
 * ```
 */
export interface AutocompleteInputChangeResult {
  changed: boolean;
  detail?: AutocompleteInputChangeDetail;
  inputValue: string;
}

/**
 * Result returned by the Autocomplete primitive autocomplete value change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AutocompleteValueChangeResult } from '@kovojs/headless-ui/autocomplete';
 *
 * const value: AutocompleteValueChangeResult = {} as AutocompleteValueChangeResult;
 * ```
 */
export interface AutocompleteValueChangeResult {
  changed: boolean;
  detail?: AutocompleteValueChangeDetail;
  value: string | undefined;
}

/**
 * Result returned by the Autocomplete primitive autocomplete open change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AutocompleteOpenChangeResult } from '@kovojs/headless-ui/autocomplete';
 *
 * const value: AutocompleteOpenChangeResult = {} as AutocompleteOpenChangeResult;
 * ```
 */
export interface AutocompleteOpenChangeResult {
  changed: boolean;
  detail?: AutocompleteOpenChangeDetail;
  open: boolean;
}

/**
 * Result returned by the Autocomplete primitive autocomplete move.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AutocompleteMoveResult } from '@kovojs/headless-ui/autocomplete';
 *
 * const value: AutocompleteMoveResult = {} as AutocompleteMoveResult;
 * ```
 */
export interface AutocompleteMoveResult {
  highlightedIndex: number;
  highlightedValue: string | undefined;
}

/**
 * Result returned by the Autocomplete primitive autocomplete option select.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AutocompleteOptionSelectResult } from '@kovojs/headless-ui/autocomplete';
 *
 * const value: AutocompleteOptionSelectResult = {} as AutocompleteOptionSelectResult;
 * ```
 */
export interface AutocompleteOptionSelectResult {
  inputValue: AutocompleteInputChangeResult;
  open: AutocompleteOpenChangeResult;
  value: AutocompleteValueChangeResult;
}

/**
 * Options accepted by the Autocomplete primitive autocomplete typeahead.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AutocompleteTypeaheadOptions } from '@kovojs/headless-ui/autocomplete';
 *
 * const value: AutocompleteTypeaheadOptions = {} as AutocompleteTypeaheadOptions;
 * ```
 */
export interface AutocompleteTypeaheadOptions {
  currentValue?: string;
  loop?: boolean;
  now: number;
  state?: TypeaheadState;
  timeoutMs?: number;
}

/**
 * Result returned by the Autocomplete primitive autocomplete typeahead.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AutocompleteTypeaheadResult } from '@kovojs/headless-ui/autocomplete';
 *
 * const value: AutocompleteTypeaheadResult = {} as AutocompleteTypeaheadResult;
 * ```
 */
export interface AutocompleteTypeaheadResult {
  matchIndex: number;
  state: TypeaheadState;
  value: string | undefined;
}

/**
 * Serializable attribute record returned by Autocomplete primitive builders.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AutocompletePrimitiveAttributes } from '@kovojs/headless-ui/autocomplete';
 *
 * const value: AutocompletePrimitiveAttributes = {} as AutocompletePrimitiveAttributes;
 * ```
 */
export type AutocompletePrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

/**
 * Event shape consumed by the Autocomplete primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AutocompleteInputEvent } from '@kovojs/headless-ui/autocomplete';
 *
 * const value: AutocompleteInputEvent = {} as AutocompleteInputEvent;
 * ```
 */
export type AutocompleteInputEvent = Event & {
  readonly currentTarget: (EventTarget & { value?: string }) | null;
  readonly target?: (EventTarget & { value?: string }) | null;
};

/**
 * Event shape consumed by the Autocomplete primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AutocompleteOptionEvent } from '@kovojs/headless-ui/autocomplete';
 *
 * const value: AutocompleteOptionEvent = {} as AutocompleteOptionEvent;
 * ```
 */
export type AutocompleteOptionEvent = Event;

/**
 * Event shape consumed by the Autocomplete primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AutocompleteKeyboardEvent } from '@kovojs/headless-ui/autocomplete';
 *
 * const value: AutocompleteKeyboardEvent = {} as AutocompleteKeyboardEvent;
 * ```
 */
export type AutocompleteKeyboardEvent = Event & { readonly key: string };

/**
 * Result returned by the Autocomplete primitive autocomplete keyboard.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { AutocompleteKeyboardResult } from '@kovojs/headless-ui/autocomplete';
 *
 * const value: AutocompleteKeyboardResult = {} as AutocompleteKeyboardResult;
 * ```
 */
export type AutocompleteKeyboardResult =
  | AutocompleteMoveResult
  | AutocompleteOpenChangeResult
  | AutocompleteOptionSelectResult;

/**
 * Computes autocomplete option selected for the Autocomplete primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { autocompleteOptionSelected } from '@kovojs/headless-ui/autocomplete';
 *
 * const input = {} as Parameters<typeof autocompleteOptionSelected>[0];
 * const result = autocompleteOptionSelected(input);
 * ```
 */
export function autocompleteOptionSelected(options: AutocompleteOptionAttributeOptions): boolean {
  return options.value === options.itemValue;
}

/**
 * Computes autocomplete option highlighted for the Autocomplete primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { autocompleteOptionHighlighted } from '@kovojs/headless-ui/autocomplete';
 *
 * const input = {} as Parameters<typeof autocompleteOptionHighlighted>[0];
 * const result = autocompleteOptionHighlighted(input);
 * ```
 */
export function autocompleteOptionHighlighted(
  options: AutocompleteOptionAttributeOptions,
): boolean {
  return options.highlightedValue === options.itemValue;
}

/**
 * Computes autocomplete value text for the Autocomplete primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { autocompleteValueText } from '@kovojs/headless-ui/autocomplete';
 *
 * const input = {} as Parameters<typeof autocompleteValueText>[0];
 * const result = autocompleteValueText(input);
 * ```
 */
export function autocompleteValueText(state: AutocompleteState): string {
  const selected = state.items?.find((item) => item.value === state.value);
  if (selected) return selected.label ?? selected.textValue ?? selected.value;
  if (state.value === undefined || state.value === '') return state.placeholder ?? '';
  return state.value;
}

/**
 * Computes autocomplete suggestions for the Autocomplete primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { autocompleteSuggestions } from '@kovojs/headless-ui/autocomplete';
 *
 * const input = {} as Parameters<typeof autocompleteSuggestions>[0];
 * const result = autocompleteSuggestions(input);
 * ```
 */
export function autocompleteSuggestions(state: AutocompleteState): readonly AutocompleteItem[] {
  const query = (state.inputValue ?? state.value ?? '').trim().toLocaleLowerCase();
  const items = state.items ?? [];
  if (query === '') return items.filter((item) => item.disabled !== true);

  return items.filter((item) => {
    if (item.disabled) return false;
    return autocompleteItemText(item).trim().toLocaleLowerCase().startsWith(query);
  });
}

/**
 * Builds the autocomplete root attributes record for the Autocomplete primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { autocompleteRootAttributes } from '@kovojs/headless-ui/autocomplete';
 *
 * const input = {} as Parameters<typeof autocompleteRootAttributes>[0];
 * const result = autocompleteRootAttributes(input);
 * ```
 */
export function autocompleteRootAttributes(
  options: AutocompleteRootAttributeOptions = {},
): AutocompletePrimitiveAttributes {
  return Object.freeze({
    ...autocompleteDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

/**
 * Builds the autocomplete input attributes record for the Autocomplete primitive.
 *
 * Emits `aria-autocomplete`, `aria-expanded`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { autocompleteInputAttributes } from '@kovojs/headless-ui/autocomplete';
 *
 * const input = {} as Parameters<typeof autocompleteInputAttributes>[0];
 * const result = autocompleteInputAttributes(input);
 * ```
 */
export function autocompleteInputAttributes(
  options: AutocompleteInputAttributeOptions = {},
): AutocompletePrimitiveAttributes {
  const describedBy = autocompleteDescribedBy(options);
  const activeDescendant = autocompleteActiveDescendant(options);
  const listId = options.listId ?? options.id;

  // SPEC.md §6.3: form() typing validates real named controls; autocomplete
  // keeps the native text input as the submitted control.
  return Object.freeze({
    ...autocompleteDataAttributes(options),
    'aria-autocomplete': 'list',
    'aria-expanded': String(options.open === true),
    autocomplete: options.autocomplete ?? 'off',
    disabled: options.disabled === true,
    role: 'combobox',
    type: 'text',
    value: options.inputValue ?? options.value ?? '',
    ...(activeDescendant === undefined ? {} : { 'aria-activedescendant': activeDescendant }),
    ...(listId === undefined ? {} : { 'aria-controls': listId }),
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
    ...(describedBy === '' ? {} : { 'aria-describedby': describedBy }),
    ...(options.invalid === true ? { 'aria-invalid': 'true' } : {}),
    ...(options.form === undefined ? {} : { form: options.form }),
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(options.placeholder === undefined ? {} : { placeholder: options.placeholder }),
    ...(options.required === true ? { required: true } : {}),
  });
}

/**
 * Builds the autocomplete list attributes record for the Autocomplete primitive.
 *
 * Emits `aria-labelledby`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { autocompleteListAttributes } from '@kovojs/headless-ui/autocomplete';
 *
 * const input = {} as Parameters<typeof autocompleteListAttributes>[0];
 * const result = autocompleteListAttributes(input);
 * ```
 */
export function autocompleteListAttributes(
  options: AutocompleteListAttributeOptions = {},
): AutocompletePrimitiveAttributes {
  return Object.freeze({
    ...autocompleteDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
    role: 'listbox',
    ...(options.open === true ? {} : { hidden: true }),
  });
}

/**
 * Builds the autocomplete option attributes record for the Autocomplete primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { autocompleteOptionAttributes } from '@kovojs/headless-ui/autocomplete';
 *
 * const input = {} as Parameters<typeof autocompleteOptionAttributes>[0];
 * const result = autocompleteOptionAttributes(input);
 * ```
 */
export function autocompleteOptionAttributes(
  options: AutocompleteOptionAttributeOptions,
): AutocompletePrimitiveAttributes {
  const disabled = autocompleteOptionDisabled(options, options.itemValue);
  const selected = autocompleteOptionSelected(options);
  // J1 (SPEC.md §4.6): resolve a stable option id so the synthesized
  // aria-activedescendant always references a rendered option. Honor an explicit
  // call-site id, then the item's own id, then auto-generate
  // `<listId>-option-<i>` against the *filtered* render order — the exact id
  // autocompleteActiveDescendant falls back to. Mirrors combobox.ts/command.ts.
  const id = autocompleteOptionId(options, options.itemValue);

  return Object.freeze({
    ...autocompleteOptionDataAttributes(options),
    'aria-selected': String(selected),
    role: 'option',
    value: options.itemValue,
    ...(id === undefined ? {} : { id }),
    ...(disabled ? { 'aria-disabled': 'true' } : {}),
    ...(options.itemLabel === undefined ? {} : { label: options.itemLabel }),
  });
}

/**
 * Builds the autocomplete value attributes record for the Autocomplete primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { autocompleteValueAttributes } from '@kovojs/headless-ui/autocomplete';
 *
 * const input = {} as Parameters<typeof autocompleteValueAttributes>[0];
 * const result = autocompleteValueAttributes(input);
 * ```
 */
export function autocompleteValueAttributes(
  options: AutocompleteValueAttributeOptions = {},
): AutocompletePrimitiveAttributes {
  return Object.freeze({
    ...autocompleteValueDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

/**
 * Computes the set autocomplete input value transition for the Autocomplete primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { setAutocompleteInputValue } from '@kovojs/headless-ui/autocomplete';
 *
 * const input = {} as Parameters<typeof setAutocompleteInputValue>[0];
 * const state = {} as Parameters<typeof setAutocompleteInputValue>[1];
 * const options = {} as Parameters<typeof setAutocompleteInputValue>[2];
 * const detail = {} as Parameters<typeof setAutocompleteInputValue>[3];
 * const result = setAutocompleteInputValue(input, state, options, detail);
 * ```
 */
export function setAutocompleteInputValue(
  state: AutocompleteState,
  inputValue: string,
  reason: AutocompleteInputChangeReason,
  options: AutocompleteChangeOptions = {},
): AutocompleteInputChangeResult {
  const current = state.inputValue ?? state.value ?? '';
  if (state.disabled || current === inputValue) {
    return { changed: false, inputValue: current };
  }

  const detail = dispatchCancelableChange(
    { reason, value: inputValue },
    options.onInputValueChange,
  );
  if (detail.defaultPrevented) {
    return { changed: false, detail, inputValue: current };
  }

  return { changed: true, detail, inputValue };
}

/**
 * Computes the set autocomplete value transition for the Autocomplete primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { setAutocompleteValue } from '@kovojs/headless-ui/autocomplete';
 *
 * const input = {} as Parameters<typeof setAutocompleteValue>[0];
 * const state = {} as Parameters<typeof setAutocompleteValue>[1];
 * const options = {} as Parameters<typeof setAutocompleteValue>[2];
 * const detail = {} as Parameters<typeof setAutocompleteValue>[3];
 * const result = setAutocompleteValue(input, state, options, detail);
 * ```
 */
export function setAutocompleteValue(
  state: AutocompleteState,
  value: string | undefined,
  reason: AutocompleteValueChangeReason,
  options: AutocompleteChangeOptions = {},
): AutocompleteValueChangeResult {
  if (state.disabled || state.value === value || autocompleteValueDisabled(state, value)) {
    return { changed: false, value: state.value };
  }

  const detail = dispatchCancelableChange({ reason, value }, options.onValueChange);
  if (detail.defaultPrevented) {
    return { changed: false, detail, value: state.value };
  }

  return { changed: true, detail, value };
}

/**
 * Computes the set autocomplete open transition for the Autocomplete primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { setAutocompleteOpen } from '@kovojs/headless-ui/autocomplete';
 *
 * const input = {} as Parameters<typeof setAutocompleteOpen>[0];
 * const state = {} as Parameters<typeof setAutocompleteOpen>[1];
 * const options = {} as Parameters<typeof setAutocompleteOpen>[2];
 * const detail = {} as Parameters<typeof setAutocompleteOpen>[3];
 * const result = setAutocompleteOpen(input, state, options, detail);
 * ```
 */
export function setAutocompleteOpen(
  state: AutocompleteState,
  open: boolean,
  reason: AutocompleteOpenChangeReason,
  options: AutocompleteChangeOptions = {},
): AutocompleteOpenChangeResult {
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
 * Computes the select autocomplete option transition for the Autocomplete primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { selectAutocompleteOption } from '@kovojs/headless-ui/autocomplete';
 *
 * const input = {} as Parameters<typeof selectAutocompleteOption>[0];
 * const state = {} as Parameters<typeof selectAutocompleteOption>[1];
 * const options = {} as Parameters<typeof selectAutocompleteOption>[2];
 * const result = selectAutocompleteOption(input, state, options);
 * ```
 */
export function selectAutocompleteOption(
  state: AutocompleteState,
  value: string | undefined,
  options: AutocompleteChangeOptions = {},
): AutocompleteOptionSelectResult {
  const valueResult = setAutocompleteValue(state, value, 'option-select', options);

  // UX (B5): selecting any option closes the listbox, including re-selecting the
  // currently selected value. Previously an unchanged value early-returned with
  // open unchanged, leaving the suggestion list open on re-select. We sync the
  // input value to the (possibly unchanged) selected value and close the list.
  const inputResult = setAutocompleteInputValue(
    state,
    valueResult.value ?? '',
    'option-select',
    options,
  );
  if (inputResult.detail?.defaultPrevented === true) {
    return {
      inputValue: inputResult,
      open: { changed: false, open: state.open === true },
      value: {
        changed: false,
        ...(valueResult.detail === undefined ? {} : { detail: valueResult.detail }),
        value: state.value,
      },
    };
  }

  const openResult = setAutocompleteOpen(state, false, 'option-select', options);
  if (openResult.detail?.defaultPrevented === true) {
    return {
      inputValue: {
        changed: false,
        ...(inputResult.detail === undefined ? {} : { detail: inputResult.detail }),
        inputValue: state.inputValue ?? state.value ?? '',
      },
      open: openResult,
      value: {
        changed: false,
        ...(valueResult.detail === undefined ? {} : { detail: valueResult.detail }),
        value: state.value,
      },
    };
  }

  return {
    inputValue: inputResult,
    open: openResult,
    value: valueResult,
  };
}

/**
 * Computes autocomplete typeahead for the Autocomplete primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { autocompleteTypeahead } from '@kovojs/headless-ui/autocomplete';
 *
 * const input = {} as Parameters<typeof autocompleteTypeahead>[0];
 * const state = {} as Parameters<typeof autocompleteTypeahead>[1];
 * const options = {} as Parameters<typeof autocompleteTypeahead>[2];
 * const result = autocompleteTypeahead(input, state, options);
 * ```
 */
export function autocompleteTypeahead(
  state: AutocompleteState,
  key: string,
  options: AutocompleteTypeaheadOptions,
): AutocompleteTypeaheadResult {
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
    textValue: autocompleteItemText(item),
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
 * Computes autocomplete move for the Autocomplete primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { autocompleteMove } from '@kovojs/headless-ui/autocomplete';
 *
 * const input = {} as Parameters<typeof autocompleteMove>[0];
 * const state = {} as Parameters<typeof autocompleteMove>[1];
 * const options = {} as Parameters<typeof autocompleteMove>[2];
 * const result = autocompleteMove(input, state, options);
 * ```
 */
export function autocompleteMove(
  state: AutocompleteState,
  key: string,
  options: { loop?: boolean } = {},
): AutocompleteMoveResult | undefined {
  if (state.disabled) return undefined;

  const intent = navigationIntentFromKey(key, { orientation: 'vertical' });
  if (intent === undefined) return undefined;

  const items = autocompleteSuggestions(state);
  const currentIndex = items.findIndex(
    (item) => item.value === (state.highlightedValue ?? state.value),
  );
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
 * Handles the autocomplete input interaction for the Autocomplete primitive.
 *
 * @example
 * ```ts
 * import { autocompleteInput } from '@kovojs/headless-ui/autocomplete';
 *
 * const input = {} as Parameters<typeof autocompleteInput>[0];
 * const state = {} as Parameters<typeof autocompleteInput>[1];
 * const options = {} as Parameters<typeof autocompleteInput>[2];
 * const result = autocompleteInput(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function autocompleteInput(
  event: AutocompleteInputEvent,
  state: AutocompleteState,
  options: AutocompleteChangeOptions = {},
): AutocompleteInputChangeResult | undefined {
  if (event.defaultPrevented) return;

  const inputTarget = event.target ?? event.currentTarget;
  const result = setAutocompleteInputValue(state, inputTarget?.value ?? '', 'input', options);
  if (!result.changed) {
    if (inputTarget) inputTarget.value = result.inputValue;
    if (event.currentTarget && event.currentTarget !== inputTarget) {
      event.currentTarget.value = result.inputValue;
    }
    event.preventDefault();
  }

  return result;
}

/**
 * Handles the autocomplete option click interaction for the Autocomplete primitive.
 *
 * @example
 * ```ts
 * import { autocompleteOptionClick } from '@kovojs/headless-ui/autocomplete';
 *
 * const input = {} as Parameters<typeof autocompleteOptionClick>[0];
 * const state = {} as Parameters<typeof autocompleteOptionClick>[1];
 * const options = {} as Parameters<typeof autocompleteOptionClick>[2];
 * const result = autocompleteOptionClick(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function autocompleteOptionClick(
  event: AutocompleteOptionEvent,
  state: AutocompleteOptionAttributeOptions,
  options: AutocompleteChangeOptions = {},
): AutocompleteOptionSelectResult | undefined {
  if (event.defaultPrevented) return;

  const result = selectAutocompleteOption(state, state.itemValue, options);
  if (!result.value.changed) {
    event.preventDefault();
  }

  return result;
}

/**
 * Handles the autocomplete key down interaction for the Autocomplete primitive.
 *
 * @example
 * ```ts
 * import { autocompleteKeyDown } from '@kovojs/headless-ui/autocomplete';
 *
 * const input = {} as Parameters<typeof autocompleteKeyDown>[0];
 * const state = {} as Parameters<typeof autocompleteKeyDown>[1];
 * const options = {} as Parameters<typeof autocompleteKeyDown>[2];
 * const result = autocompleteKeyDown(input, state, options);
 * ```
 *
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function autocompleteKeyDown(
  event: AutocompleteKeyboardEvent,
  state: AutocompleteState,
  options: AutocompleteChangeOptions = {},
): AutocompleteKeyboardResult | undefined {
  if (event.defaultPrevented) return;

  if (event.key === 'Enter' && state.open === true && state.highlightedValue !== undefined) {
    const result = selectAutocompleteOption(state, state.highlightedValue, options);
    // Selecting from an open list must NEVER fall through to the host form's
    // implicit submit, which reloads the page and discards the selection (the
    // "Enter does not select" defect). Prevent default whenever Enter commits or
    // closes the open list, even when re-selecting the already-current value.
    event.preventDefault();
    return result;
  }

  if (event.key === 'Escape') {
    const result = setAutocompleteOpen(state, false, 'escape-key', options);
    if (result.changed) event.preventDefault();
    return result;
  }

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (state.open === true) {
      const result = autocompleteMove(state, event.key, { loop: true });
      if (result !== undefined) event.preventDefault();
      return result;
    }

    const result = setAutocompleteOpen(state, true, 'arrow-key', options);
    if (result.changed) event.preventDefault();
    return result;
  }

  return undefined;
}

function autocompleteDataAttributes(state: AutocompleteState): PrimitiveDataAttributes {
  return mergeDataAttributes(
    dataState(state.open === true ? 'open' : 'closed'),
    dataDisabled(state.disabled === true),
    autocompleteValueDataAttributes(state),
    state.invalid === true ? { 'data-invalid': '' } : undefined,
    state.required === true ? { 'data-required': '' } : undefined,
  );
}

function autocompleteOptionDataAttributes(
  options: AutocompleteOptionAttributeOptions,
): PrimitiveDataAttributes {
  return mergeDataAttributes(
    checkedState(autocompleteOptionSelected(options)),
    dataDisabled(autocompleteOptionDisabled(options, options.itemValue)),
    autocompleteOptionHighlighted(options) ? { 'data-highlighted': '' } : undefined,
  );
}

function autocompleteValueDataAttributes(state: AutocompleteState): PrimitiveDataAttributes {
  return state.value === undefined || state.value === ''
    ? Object.freeze({ 'data-placeholder': '' })
    : Object.freeze({});
}

function autocompleteOptionDisabled(
  state: AutocompleteState & { itemDisabled?: boolean },
  value: string,
): boolean {
  return (
    state.disabled === true ||
    state.itemDisabled === true ||
    state.items?.find((item) => item.value === value)?.disabled === true
  );
}

function autocompleteValueDisabled(state: AutocompleteState, value: string | undefined): boolean {
  return value !== undefined && autocompleteOptionDisabled(state, value);
}

function autocompleteActiveDescendant(
  options: AutocompleteInputAttributeOptions,
): string | undefined {
  if (options.highlightedValue === undefined) return undefined;

  const itemId = autocompleteItemId(options, options.highlightedValue);
  if (itemId !== undefined) return itemId;

  // J1 (SPEC.md §4.6): index against the *filtered* render order
  // (autocompleteSuggestions — the options the listbox actually renders), not the
  // full item list, so the synthesized id matches the rendered option's
  // auto-generated id after typing. Mirrors combobox.ts/command.ts.
  return autocompleteFallbackOptionId(options, options.highlightedValue);
}

function autocompleteItemId(state: AutocompleteState, value: string): string | undefined {
  return state.items?.find((item) => item.value === value)?.id;
}

function autocompleteOptionId(
  options: AutocompleteOptionAttributeOptions,
  value: string,
): string | undefined {
  if (options.id !== undefined) return options.id;
  const itemId = autocompleteItemId(options, value);
  if (itemId !== undefined) return itemId;
  return autocompleteFallbackOptionId(options, value);
}

function autocompleteFallbackOptionId(
  state: AutocompleteState & { id?: string; listId?: string },
  value: string,
): string | undefined {
  // J1 (SPEC.md §4.6) + bugz-3 L17: use a SINGLE index space — always the
  // *filtered* suggestion order (the options actually rendered). A value outside
  // that order gets no synthesized id (returns undefined) instead of a full-list
  // fallback; the old dual space let a non-matching full-index-0 item collide
  // with a matching filtered-index-0 item on `…-option-0`. The input
  // (aria-activedescendant) and every option resolve the same `state`, so the
  // synthesized IDREF still matches.
  const index = autocompleteSuggestions(state).findIndex((item) => item.value === value);
  if (index < 0) return undefined;
  return `${autocompleteFallbackPrefix(state)}-option-${index}`;
}

// bugz-3 L17 / papercuts-6 B (SPEC.md §4.6): synthesized option ids need a
// caller-owned instance prefix. A pure helper cannot distinguish two identical
// id-less autocompletes from the same item set, so falling back to an item
// fingerprint creates duplicate document ids. Require an explicit listId for
// id-less generated IDs instead of guessing a page-global instance identity.
function autocompleteFallbackPrefix(state: {
  items?: readonly AutocompleteItem[];
  listId?: string;
}): string {
  if (state.listId !== undefined) return state.listId;
  throw new TypeError(
    'headless-ui autocomplete requires listId to synthesize option ids for id-less items; ' +
      'pass a unique listId or explicit item ids.',
  );
}

function autocompleteItemText(item: AutocompleteItem): string {
  return item.textValue ?? item.label ?? item.value;
}

function autocompleteDescribedBy(options: {
  descriptionId?: string;
  errorId?: string;
  invalid?: boolean;
}): string {
  return [options.descriptionId, options.invalid === true ? options.errorId : undefined]
    .filter((id): id is string => id !== undefined && id.length > 0)
    .join(' ');
}
