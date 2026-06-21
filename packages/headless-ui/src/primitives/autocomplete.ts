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

export interface AutocompleteItem {
  disabled?: boolean;
  id?: string;
  label?: string;
  textValue?: string;
  value: string;
}

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

export interface AutocompleteRootAttributeOptions extends AutocompleteState {
  id?: string;
}

export interface AutocompleteInputAttributeOptions extends AutocompleteState {
  autocomplete?: string;
  descriptionId?: string;
  errorId?: string;
  id?: string;
  labelledBy?: string;
}

export interface AutocompleteListAttributeOptions extends AutocompleteState {
  id?: string;
  labelledBy?: string;
}

export interface AutocompleteOptionAttributeOptions extends AutocompleteState {
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemValue: string;
}

export interface AutocompleteValueAttributeOptions extends AutocompleteState {
  id?: string;
}

export type AutocompleteInputChangeReason = 'input' | 'option-select' | 'programmatic';
export type AutocompleteValueChangeReason = 'option-select' | 'programmatic' | 'typeahead';

export type AutocompleteOpenChangeReason =
  | 'arrow-key'
  | 'escape-key'
  | 'input'
  | 'option-select'
  | 'programmatic'
  | 'typeahead';

export type AutocompleteInputChangeDetail = PrimitiveChangeDetail<
  AutocompleteInputChangeReason,
  string
>;

export type AutocompleteValueChangeDetail = PrimitiveChangeDetail<
  AutocompleteValueChangeReason,
  string | undefined
>;

export type AutocompleteOpenChangeDetail = PrimitiveChangeDetail<
  AutocompleteOpenChangeReason,
  boolean
>;

export interface AutocompleteChangeOptions {
  onInputValueChange?: (detail: AutocompleteInputChangeDetail) => void;
  onOpenChange?: (detail: AutocompleteOpenChangeDetail) => void;
  onValueChange?: (detail: AutocompleteValueChangeDetail) => void;
}

export interface AutocompleteInputChangeResult {
  changed: boolean;
  detail?: AutocompleteInputChangeDetail;
  inputValue: string;
}

export interface AutocompleteValueChangeResult {
  changed: boolean;
  detail?: AutocompleteValueChangeDetail;
  value: string | undefined;
}

export interface AutocompleteOpenChangeResult {
  changed: boolean;
  detail?: AutocompleteOpenChangeDetail;
  open: boolean;
}

export interface AutocompleteMoveResult {
  highlightedIndex: number;
  highlightedValue: string | undefined;
}

export interface AutocompleteOptionSelectResult {
  inputValue: AutocompleteInputChangeResult;
  open: AutocompleteOpenChangeResult;
  value: AutocompleteValueChangeResult;
}

export interface AutocompleteTypeaheadOptions {
  currentValue?: string;
  loop?: boolean;
  now: number;
  state?: TypeaheadState;
  timeoutMs?: number;
}

export interface AutocompleteTypeaheadResult {
  matchIndex: number;
  state: TypeaheadState;
  value: string | undefined;
}

export type AutocompletePrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

export type AutocompleteInputEvent = Event & {
  readonly currentTarget: (EventTarget & { value?: string }) | null;
  readonly target?: (EventTarget & { value?: string }) | null;
};
export type AutocompleteOptionEvent = Event;
export type AutocompleteKeyboardEvent = Event & { readonly key: string };
export type AutocompleteKeyboardResult =
  | AutocompleteMoveResult
  | AutocompleteOpenChangeResult
  | AutocompleteOptionSelectResult;

export function autocompleteOptionSelected(options: AutocompleteOptionAttributeOptions): boolean {
  return options.value === options.itemValue;
}

export function autocompleteOptionHighlighted(
  options: AutocompleteOptionAttributeOptions,
): boolean {
  return options.highlightedValue === options.itemValue;
}

export function autocompleteValueText(state: AutocompleteState): string {
  const selected = state.items?.find((item) => item.value === state.value);
  if (selected) return selected.label ?? selected.textValue ?? selected.value;
  if (state.value === undefined || state.value === '') return state.placeholder ?? '';
  return state.value;
}

export function autocompleteSuggestions(state: AutocompleteState): readonly AutocompleteItem[] {
  const query = (state.inputValue ?? state.value ?? '').trim().toLocaleLowerCase();
  const items = state.items ?? [];
  if (query === '') return items.filter((item) => item.disabled !== true);

  return items.filter((item) => {
    if (item.disabled) return false;
    return autocompleteItemText(item).trim().toLocaleLowerCase().startsWith(query);
  });
}

export function autocompleteRootAttributes(
  options: AutocompleteRootAttributeOptions = {},
): AutocompletePrimitiveAttributes {
  return Object.freeze({
    ...autocompleteDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

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

export function autocompleteValueAttributes(
  options: AutocompleteValueAttributeOptions = {},
): AutocompletePrimitiveAttributes {
  return Object.freeze({
    ...autocompleteValueDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

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
    if (result.value.changed) event.preventDefault();
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
  state: AutocompleteState & { id?: string },
  value: string,
): string | undefined {
  // J1 (SPEC.md §4.6): index against the *filtered* render order so the
  // synthesized id matches the rendered option's position after typing. If the
  // value is not in the filtered set (e.g. an app that renders the unfiltered
  // list), fall back to the full-list index so the IDREF still resolves.
  const filteredIndex = autocompleteSuggestions(state).findIndex((item) => item.value === value);
  const index =
    filteredIndex >= 0
      ? filteredIndex
      : (state.items?.findIndex((item) => item.value === value) ?? -1);
  if (index < 0) return undefined;
  return `${state.listId ?? state.id ?? 'autocomplete'}-option-${index}`;
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
