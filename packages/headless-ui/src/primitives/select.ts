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

export interface SelectItem {
  disabled?: boolean;
  id?: string;
  label?: string;
  textValue?: string;
  value: string;
}

export interface SelectState {
  disabled?: boolean;
  form?: string;
  highlightedValue?: string;
  invalid?: boolean;
  items?: readonly SelectItem[];
  listboxId?: string;
  name?: string;
  open?: boolean;
  placeholder?: string;
  required?: boolean;
  value?: string;
}

export interface SelectRootAttributeOptions extends SelectState {
  id?: string;
}

export interface SelectTriggerAttributeOptions extends SelectState {
  descriptionId?: string;
  errorId?: string;
  id?: string;
  labelledBy?: string;
}

export interface SelectHiddenInputAttributeOptions extends SelectState {}

export interface SelectContentAttributeOptions extends SelectState {
  id?: string;
  labelledBy?: string;
}

export interface SelectItemAttributeOptions extends SelectState {
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemValue: string;
}

export interface SelectValueAttributeOptions extends SelectState {
  id?: string;
}

export type SelectChangeReason = 'item-select' | 'programmatic' | 'trigger-change';

export type SelectOpenChangeReason =
  | 'arrow-key'
  | 'escape-key'
  | 'item-select'
  | 'programmatic'
  | 'trigger-click'
  | 'typeahead';

export type SelectChangeDetail = PrimitiveChangeDetail<SelectChangeReason, string | undefined>;
export type SelectOpenChangeDetail = PrimitiveChangeDetail<SelectOpenChangeReason, boolean>;

export interface SelectChangeOptions {
  onOpenChange?: (detail: SelectOpenChangeDetail) => void;
  onValueChange?: (detail: SelectChangeDetail) => void;
}

export interface SelectChangeResult {
  changed: boolean;
  detail?: SelectChangeDetail;
  value: string | undefined;
}

export interface SelectOpenChangeResult {
  changed: boolean;
  detail?: SelectOpenChangeDetail;
  open: boolean;
}

export interface SelectMoveResult {
  highlightedIndex: number;
  highlightedValue: string | undefined;
}

export interface SelectOptionSelectResult {
  open: SelectOpenChangeResult;
  value: SelectChangeResult;
}

export interface SelectTypeaheadOptions {
  currentValue?: string;
  loop?: boolean;
  now: number;
  state?: TypeaheadState;
  timeoutMs?: number;
}

export interface SelectTypeaheadResult {
  matchIndex: number;
  state: TypeaheadState;
  value: string | undefined;
}

export type SelectPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

export type SelectTriggerEvent = Event & {
  readonly currentTarget: EventTarget & { value?: string };
};
export type SelectKeyboardEvent = Event & { readonly key: string };
export type SelectItemEvent = Event;
export type SelectKeyboardResult =
  | SelectMoveResult
  | SelectOpenChangeResult
  | SelectOptionSelectResult
  | SelectTypeaheadResult;

export function selectItemSelected(options: SelectItemAttributeOptions): boolean {
  return options.value === options.itemValue;
}

export function selectValueText(state: SelectState): string {
  const selected = state.items?.find((item) => item.value === state.value);
  if (selected) return selected.label ?? selected.textValue ?? selected.value;
  if (state.value === undefined || state.value === '') return state.placeholder ?? '';
  return state.value;
}

export function selectRootAttributes(
  options: SelectRootAttributeOptions = {},
): SelectPrimitiveAttributes {
  return Object.freeze({
    ...selectDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

export function selectTriggerAttributes(
  options: SelectTriggerAttributeOptions = {},
): SelectPrimitiveAttributes {
  const describedBy = selectDescribedBy(options);
  // J3 (SPEC.md §4.6): the trigger holds focus while the listbox is open, so the
  // highlighted option must be advertised through aria-activedescendant on it —
  // otherwise a keyboard+SR user perceives nothing as they arrow through items.
  const activeDescendant = selectActiveDescendant(options);

  return Object.freeze({
    ...selectDataAttributes(options),
    'aria-expanded': String(options.open === true),
    'aria-haspopup': 'listbox',
    role: 'combobox',
    type: 'button',
    ...(activeDescendant === undefined ? {} : { 'aria-activedescendant': activeDescendant }),
    ...(options.listboxId === undefined ? {} : { 'aria-controls': options.listboxId }),
    ...(options.disabled === true ? { disabled: true } : {}),
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
    ...(describedBy === '' ? {} : { 'aria-describedby': describedBy }),
    ...(options.invalid === true ? { 'aria-invalid': 'true' } : {}),
  });
}

export function selectHiddenInputAttributes(
  options: SelectHiddenInputAttributeOptions = {},
): SelectPrimitiveAttributes {
  return Object.freeze({
    disabled: options.disabled === true,
    ...(options.form === undefined ? {} : { form: options.form }),
    ...(options.name === undefined ? {} : { name: options.name }),
    type: 'hidden',
    value: options.value ?? '',
  });
}

export function selectContentAttributes(
  options: SelectContentAttributeOptions = {},
): SelectPrimitiveAttributes {
  return Object.freeze({
    ...selectDataAttributes(options),
    role: 'listbox',
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
    ...(options.open === true ? {} : { hidden: true }),
  });
}

export function selectItemAttributes(
  options: SelectItemAttributeOptions,
): SelectPrimitiveAttributes {
  const disabled = selectItemDisabled(options, options.itemValue);
  const selected = selectItemSelected(options);
  // J3 (SPEC.md §4.6): resolve a stable option id so the synthesized
  // aria-activedescendant always references a rendered option. Honor an explicit
  // call-site id, then the item's own id, then auto-generate
  // `<listboxId>-option-<i>`. Mirrors combobox.ts/command.ts/autocomplete.ts.
  const id = selectOptionId(options, options.itemValue);

  return Object.freeze({
    ...selectItemDataAttributes(options),
    'aria-selected': String(selected),
    role: 'option',
    ...(id === undefined ? {} : { id }),
    ...(disabled ? { 'aria-disabled': 'true' } : {}),
    value: options.itemValue,
    ...(options.itemLabel === undefined ? {} : { label: options.itemLabel }),
  });
}

export function selectValueAttributes(
  options: SelectValueAttributeOptions = {},
): SelectPrimitiveAttributes {
  return Object.freeze({
    ...selectValueDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

export function setSelectValue(
  state: SelectState,
  value: string | undefined,
  reason: SelectChangeReason,
  options: SelectChangeOptions = {},
): SelectChangeResult {
  if (state.disabled || state.value === value || selectValueDisabled(state, value)) {
    return { changed: false, value: state.value };
  }

  const detail = dispatchCancelableChange({ reason, value }, options.onValueChange);
  if (detail.defaultPrevented) {
    return { changed: false, detail, value: state.value };
  }

  return { changed: true, detail, value };
}

export function setSelectOpen(
  state: SelectState,
  open: boolean,
  reason: SelectOpenChangeReason,
  options: SelectChangeOptions = {},
): SelectOpenChangeResult {
  if (state.disabled || state.open === open) {
    return { changed: false, open: state.open === true };
  }

  const detail = dispatchCancelableChange({ reason, value: open }, options.onOpenChange);
  if (detail.defaultPrevented) {
    return { changed: false, detail, open: state.open === true };
  }

  return { changed: true, detail, open };
}

export function selectOption(
  state: SelectState,
  value: string | undefined,
  options: SelectChangeOptions = {},
): SelectOptionSelectResult {
  const valueResult = setSelectValue(state, value, 'item-select', options);
  if (!valueResult.changed) {
    return {
      open: { changed: false, open: state.open === true },
      value: valueResult,
    };
  }

  const openResult = setSelectOpen(state, false, 'item-select', options);
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

export function selectMove(
  state: SelectState,
  key: string,
  options: { loop?: boolean } = {},
): SelectMoveResult | undefined {
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

export function selectTypeahead(
  state: SelectState,
  key: string,
  options: SelectTypeaheadOptions,
): SelectTypeaheadResult {
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
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function selectTriggerChange(
  event: SelectTriggerEvent,
  state: SelectState,
  options: SelectChangeOptions = {},
): SelectChangeResult | undefined {
  if (event.defaultPrevented) return;

  const result = setSelectValue(state, event.currentTarget.value, 'trigger-change', options);
  if (!result.changed) {
    event.currentTarget.value = state.value ?? '';
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
export function selectTriggerClick(
  event: Event,
  state: SelectState,
  options: SelectChangeOptions = {},
): SelectOpenChangeResult | undefined {
  if (event.defaultPrevented) return;

  const result = setSelectOpen(state, state.open !== true, 'trigger-click', options);
  if (result.changed) event.preventDefault();
  return result;
}

/**
 * @kovoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function selectItemClick(
  event: SelectItemEvent,
  state: SelectItemAttributeOptions,
  options: SelectChangeOptions = {},
): SelectOptionSelectResult | undefined {
  if (event.defaultPrevented) return;

  const result = selectOption(state, state.itemValue, options);
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
export function selectKeyDown(
  event: SelectKeyboardEvent,
  state: SelectState,
  options: SelectChangeOptions = {},
): SelectKeyboardResult | undefined {
  if (event.defaultPrevented) return;

  if (event.key === 'Enter' || event.key === ' ') {
    if (state.open === true && state.highlightedValue !== undefined) {
      const result = selectOption(state, state.highlightedValue, options);
      if (result.value.changed) event.preventDefault();
      return result;
    }

    const result = setSelectOpen(state, true, 'arrow-key', options);
    if (result.changed) event.preventDefault();
    return result;
  }

  if (event.key === 'Escape') {
    const result = setSelectOpen(state, false, 'escape-key', options);
    if (result.changed) event.preventDefault();
    return result;
  }

  if (
    event.key === 'ArrowDown' ||
    event.key === 'ArrowUp' ||
    event.key === 'Home' ||
    event.key === 'End'
  ) {
    if (state.open === true) {
      const result = selectMove(state, event.key, { loop: true });
      if (result !== undefined) event.preventDefault();
      return result;
    }

    const result = setSelectOpen(state, true, 'arrow-key', options);
    if (result.changed) event.preventDefault();
    return result;
  }

  const typeahead = selectTypeahead(state, event.key, { loop: true, now: Date.now() });
  if (typeahead.matchIndex >= 0) {
    event.preventDefault();
    if (state.open === true) return typeahead;
    const result = setSelectValue(state, typeahead.value, 'item-select', options);
    return {
      matchIndex: typeahead.matchIndex,
      state: typeahead.state,
      value: result.changed ? result.value : state.value,
    };
  }

  return undefined;
}

function selectDataAttributes(state: SelectState): PrimitiveDataAttributes {
  return mergeDataAttributes(
    dataState(state.open === true ? 'open' : 'closed'),
    dataDisabled(state.disabled === true),
    selectValueDataAttributes(state),
    state.invalid === true ? { 'data-invalid': '' } : undefined,
    state.required === true ? { 'data-required': '' } : undefined,
  );
}

function selectItemDataAttributes(options: SelectItemAttributeOptions): PrimitiveDataAttributes {
  return mergeDataAttributes(
    checkedState(selectItemSelected(options)),
    dataDisabled(selectItemDisabled(options, options.itemValue)),
    options.highlightedValue === options.itemValue ? { 'data-highlighted': '' } : undefined,
  );
}

function selectValueDataAttributes(state: SelectState): PrimitiveDataAttributes {
  return state.value === undefined || state.value === ''
    ? Object.freeze({ 'data-placeholder': '' })
    : Object.freeze({});
}

function selectItemDisabled(
  state: SelectState & { itemDisabled?: boolean },
  value: string,
): boolean {
  return (
    state.disabled === true ||
    state.itemDisabled === true ||
    state.items?.find((item) => item.value === value)?.disabled === true
  );
}

function selectValueDisabled(state: SelectState, value: string | undefined): boolean {
  return value !== undefined && selectItemDisabled(state, value);
}

function selectActiveDescendant(options: SelectTriggerAttributeOptions): string | undefined {
  // J3 (SPEC.md §4.6): only an open listbox has a navigable highlight; a closed
  // trigger must not advertise a dangling active descendant.
  if (options.open !== true || options.highlightedValue === undefined) return undefined;

  const itemId = selectItemId(options, options.highlightedValue);
  if (itemId !== undefined) return itemId;

  return selectFallbackOptionId(options, options.highlightedValue);
}

function selectItemId(state: SelectState, value: string): string | undefined {
  return state.items?.find((item) => item.value === value)?.id;
}

function selectOptionId(options: SelectItemAttributeOptions, value: string): string | undefined {
  if (options.id !== undefined) return options.id;
  const itemId = selectItemId(options, value);
  if (itemId !== undefined) return itemId;
  return selectFallbackOptionId(options, value);
}

function selectFallbackOptionId(
  state: SelectState & { id?: string },
  value: string,
): string | undefined {
  // J3 (SPEC.md §4.6): select renders the full item list unfiltered, so the
  // synthesized id is the option's index in `items`. Mirrors combobox/command's
  // fallback id shape (`<listboxId>-option-<i>`).
  const index = state.items?.findIndex((item) => item.value === value) ?? -1;
  if (index < 0) return undefined;
  return `${state.listboxId ?? state.id ?? 'select'}-option-${index}`;
}

function selectDescribedBy(options: {
  descriptionId?: string;
  errorId?: string;
  invalid?: boolean;
}): string {
  return [options.descriptionId, options.invalid === true ? options.errorId : undefined]
    .filter((id): id is string => id !== undefined && id.length > 0)
    .join(' ');
}
