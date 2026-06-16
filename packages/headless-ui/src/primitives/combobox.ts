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

export interface ComboboxItem {
  disabled?: boolean;
  id?: string;
  label?: string;
  textValue?: string;
  value: string;
}

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

export interface ComboboxRootAttributeOptions extends ComboboxState {
  id?: string;
}

export interface ComboboxInputAttributeOptions extends ComboboxState {
  descriptionId?: string;
  errorId?: string;
  id?: string;
  labelledBy?: string;
}

export interface ComboboxListboxAttributeOptions extends ComboboxState {
  id?: string;
  labelledBy?: string;
}

export interface ComboboxOptionAttributeOptions extends ComboboxState {
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemValue: string;
}

export interface ComboboxValueAttributeOptions extends ComboboxState {
  id?: string;
}

export type ComboboxValueChangeReason = 'input' | 'option-select' | 'programmatic' | 'typeahead';

export type ComboboxOpenChangeReason =
  | 'arrow-key'
  | 'escape-key'
  | 'input'
  | 'option-select'
  | 'programmatic'
  | 'typeahead';

export type ComboboxValueChangeDetail = PrimitiveChangeDetail<
  ComboboxValueChangeReason,
  string | undefined
>;

export type ComboboxOpenChangeDetail = PrimitiveChangeDetail<ComboboxOpenChangeReason, boolean>;

export interface ComboboxChangeOptions {
  onOpenChange?: (detail: ComboboxOpenChangeDetail) => void;
  onValueChange?: (detail: ComboboxValueChangeDetail) => void;
}

export interface ComboboxValueChangeResult {
  changed: boolean;
  detail?: ComboboxValueChangeDetail;
  value: string | undefined;
}

export interface ComboboxOpenChangeResult {
  changed: boolean;
  detail?: ComboboxOpenChangeDetail;
  open: boolean;
}

export interface ComboboxMoveResult {
  highlightedIndex: number;
  highlightedValue: string | undefined;
}

export interface ComboboxOptionSelectResult {
  open: ComboboxOpenChangeResult;
  value: ComboboxValueChangeResult;
}

export interface ComboboxTypeaheadOptions {
  currentValue?: string;
  loop?: boolean;
  now: number;
  state?: TypeaheadState;
  timeoutMs?: number;
}

export interface ComboboxTypeaheadResult {
  matchIndex: number;
  state: TypeaheadState;
  value: string | undefined;
}

export type ComboboxPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

export type ComboboxInputEvent = Event & {
  readonly currentTarget: (EventTarget & { value?: string }) | null;
  readonly target?: (EventTarget & { value?: string }) | null;
};
export type ComboboxOptionEvent = Event;
export type ComboboxKeyboardEvent = Event & { readonly key: string };
export type ComboboxKeyboardResult =
  | ComboboxMoveResult
  | ComboboxOpenChangeResult
  | ComboboxOptionSelectResult;

export function comboboxOptionSelected(options: ComboboxOptionAttributeOptions): boolean {
  return options.value === options.itemValue;
}

export function comboboxOptionHighlighted(options: ComboboxOptionAttributeOptions): boolean {
  return options.highlightedValue === options.itemValue;
}

export function comboboxValueText(state: ComboboxState): string {
  const selected = state.items?.find((item) => item.value === state.value);
  if (selected) return selected.label ?? selected.textValue ?? selected.value;
  if (state.value === undefined || state.value === '') return state.placeholder ?? '';
  return state.value;
}

export function comboboxFilteredItems(state: ComboboxState): readonly ComboboxItem[] {
  const query = normalizeComboboxQuery(state.value);
  const items = state.items ?? [];
  if (query === '') return items;

  return Object.freeze(items.filter((item) => comboboxItemMatches(item, query)));
}

export function comboboxRootAttributes(
  options: ComboboxRootAttributeOptions = {},
): ComboboxPrimitiveAttributes {
  return Object.freeze({
    ...comboboxDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

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

export function comboboxOptionAttributes(
  options: ComboboxOptionAttributeOptions,
): ComboboxPrimitiveAttributes {
  const disabled = comboboxOptionDisabled(options, options.itemValue);
  const selected = comboboxOptionSelected(options);

  return Object.freeze({
    ...comboboxOptionDataAttributes(options),
    'aria-selected': String(selected),
    role: 'option',
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(disabled ? { 'aria-disabled': 'true' } : {}),
    ...(options.itemLabel === undefined ? {} : { label: options.itemLabel }),
    value: options.itemValue,
  });
}

export function comboboxValueAttributes(
  options: ComboboxValueAttributeOptions = {},
): ComboboxPrimitiveAttributes {
  return Object.freeze({
    ...comboboxValueDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

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

export function selectComboboxOption(
  state: ComboboxState,
  value: string | undefined,
  options: ComboboxChangeOptions = {},
): ComboboxOptionSelectResult {
  const valueResult = setComboboxValue(state, value, 'option-select', options);
  if (!valueResult.changed) {
    return {
      open: { changed: false, open: state.open === true },
      value: valueResult,
    };
  }

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

  const itemId = options.items?.find((item) => item.value === options.highlightedValue)?.id;
  if (itemId !== undefined) return itemId;

  const index = options.items?.findIndex((item) => item.value === options.highlightedValue) ?? -1;
  if (index < 0) return undefined;

  return `${options.listboxId ?? options.id ?? 'combobox'}-option-${index}`;
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
