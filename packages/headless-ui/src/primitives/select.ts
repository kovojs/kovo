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
 * Public interface used by the Select primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SelectItem } from '@kovojs/headless-ui/select';
 *
 * const value: SelectItem = {} as SelectItem;
 * ```
 */
export interface SelectItem {
  disabled?: boolean;
  id?: string;
  label?: string;
  textValue?: string;
  value: string;
}

/**
 * State snapshot consumed by the Select primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SelectState } from '@kovojs/headless-ui/select';
 *
 * const value: SelectState = {} as SelectState;
 * ```
 */
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

/**
 * Options accepted by the Select primitive select root attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SelectRootAttributeOptions } from '@kovojs/headless-ui/select';
 *
 * const value: SelectRootAttributeOptions = {} as SelectRootAttributeOptions;
 * ```
 */
export interface SelectRootAttributeOptions extends SelectState {
  id?: string;
}

/**
 * Options accepted by the Select primitive select trigger attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SelectTriggerAttributeOptions } from '@kovojs/headless-ui/select';
 *
 * const value: SelectTriggerAttributeOptions = {} as SelectTriggerAttributeOptions;
 * ```
 */
export interface SelectTriggerAttributeOptions extends SelectState {
  descriptionId?: string;
  errorId?: string;
  id?: string;
  labelledBy?: string;
}

/**
 * Options accepted by the Select primitive select hidden input attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SelectHiddenInputAttributeOptions } from '@kovojs/headless-ui/select';
 *
 * const value: SelectHiddenInputAttributeOptions = {} as SelectHiddenInputAttributeOptions;
 * ```
 */
export interface SelectHiddenInputAttributeOptions extends SelectState {}

/**
 * Options accepted by the Select primitive select content attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SelectContentAttributeOptions } from '@kovojs/headless-ui/select';
 *
 * const value: SelectContentAttributeOptions = {} as SelectContentAttributeOptions;
 * ```
 */
export interface SelectContentAttributeOptions extends SelectState {
  id?: string;
  labelledBy?: string;
}

/**
 * Options accepted by the Select primitive select item attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SelectItemAttributeOptions } from '@kovojs/headless-ui/select';
 *
 * const value: SelectItemAttributeOptions = {} as SelectItemAttributeOptions;
 * ```
 */
export interface SelectItemAttributeOptions extends SelectState {
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemValue: string;
}

/**
 * Options accepted by the Select primitive select value attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SelectValueAttributeOptions } from '@kovojs/headless-ui/select';
 *
 * const value: SelectValueAttributeOptions = {} as SelectValueAttributeOptions;
 * ```
 */
export interface SelectValueAttributeOptions extends SelectState {
  id?: string;
}

/**
 * Reason token reported by the Select primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SelectChangeReason } from '@kovojs/headless-ui/select';
 *
 * const value: SelectChangeReason = {} as SelectChangeReason;
 * ```
 */
export type SelectChangeReason = 'item-select' | 'programmatic' | 'trigger-change';

/**
 * Reason token reported by the Select primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SelectOpenChangeReason } from '@kovojs/headless-ui/select';
 *
 * const value: SelectOpenChangeReason = {} as SelectOpenChangeReason;
 * ```
 */
export type SelectOpenChangeReason =
  | 'arrow-key'
  | 'escape-key'
  | 'item-select'
  | 'programmatic'
  | 'trigger-click'
  | 'typeahead';

/**
 * Cancelable change detail emitted by the Select primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SelectChangeDetail } from '@kovojs/headless-ui/select';
 *
 * const value: SelectChangeDetail = {} as SelectChangeDetail;
 * ```
 */
export type SelectChangeDetail = PrimitiveChangeDetail<SelectChangeReason, string | undefined>;

/**
 * Cancelable change detail emitted by the Select primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SelectOpenChangeDetail } from '@kovojs/headless-ui/select';
 *
 * const value: SelectOpenChangeDetail = {} as SelectOpenChangeDetail;
 * ```
 */
export type SelectOpenChangeDetail = PrimitiveChangeDetail<SelectOpenChangeReason, boolean>;

/**
 * Options accepted by the Select primitive select change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SelectChangeOptions } from '@kovojs/headless-ui/select';
 *
 * const value: SelectChangeOptions = {} as SelectChangeOptions;
 * ```
 */
export interface SelectChangeOptions {
  onOpenChange?: (detail: SelectOpenChangeDetail) => void;
  onValueChange?: (detail: SelectChangeDetail) => void;
}

/**
 * Result returned by the Select primitive select change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SelectChangeResult } from '@kovojs/headless-ui/select';
 *
 * const value: SelectChangeResult = {} as SelectChangeResult;
 * ```
 */
export interface SelectChangeResult {
  changed: boolean;
  detail?: SelectChangeDetail;
  value: string | undefined;
}

/**
 * Result returned by the Select primitive select open change.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SelectOpenChangeResult } from '@kovojs/headless-ui/select';
 *
 * const value: SelectOpenChangeResult = {} as SelectOpenChangeResult;
 * ```
 */
export interface SelectOpenChangeResult {
  changed: boolean;
  detail?: SelectOpenChangeDetail;
  open: boolean;
}

/**
 * Result returned by the Select primitive select move.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SelectMoveResult } from '@kovojs/headless-ui/select';
 *
 * const value: SelectMoveResult = {} as SelectMoveResult;
 * ```
 */
export interface SelectMoveResult {
  highlightedIndex: number;
  highlightedValue: string | undefined;
}

/**
 * Result returned by the Select primitive select option select.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SelectOptionSelectResult } from '@kovojs/headless-ui/select';
 *
 * const value: SelectOptionSelectResult = {} as SelectOptionSelectResult;
 * ```
 */
export interface SelectOptionSelectResult {
  open: SelectOpenChangeResult;
  value: SelectChangeResult;
}

/**
 * Options accepted by the Select primitive select typeahead.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SelectTypeaheadOptions } from '@kovojs/headless-ui/select';
 *
 * const value: SelectTypeaheadOptions = {} as SelectTypeaheadOptions;
 * ```
 */
export interface SelectTypeaheadOptions {
  currentValue?: string;
  loop?: boolean;
  now: number;
  state?: TypeaheadState;
  timeoutMs?: number;
}

/**
 * Result returned by the Select primitive select typeahead.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SelectTypeaheadResult } from '@kovojs/headless-ui/select';
 *
 * const value: SelectTypeaheadResult = {} as SelectTypeaheadResult;
 * ```
 */
export interface SelectTypeaheadResult {
  matchIndex: number;
  state: TypeaheadState;
  value: string | undefined;
}

/**
 * Serializable attribute record returned by Select primitive builders.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SelectPrimitiveAttributes } from '@kovojs/headless-ui/select';
 *
 * const value: SelectPrimitiveAttributes = {} as SelectPrimitiveAttributes;
 * ```
 */
export type SelectPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

/**
 * Event shape consumed by the Select primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SelectTriggerEvent } from '@kovojs/headless-ui/select';
 *
 * const value: SelectTriggerEvent = {} as SelectTriggerEvent;
 * ```
 */
export type SelectTriggerEvent = Event & {
  readonly currentTarget: EventTarget & { value?: string };
};

/**
 * Event shape consumed by the Select primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SelectKeyboardEvent } from '@kovojs/headless-ui/select';
 *
 * const value: SelectKeyboardEvent = {} as SelectKeyboardEvent;
 * ```
 */
export type SelectKeyboardEvent = Event & { readonly key: string };

/**
 * Event shape consumed by the Select primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SelectItemEvent } from '@kovojs/headless-ui/select';
 *
 * const value: SelectItemEvent = {} as SelectItemEvent;
 * ```
 */
export type SelectItemEvent = Event;

/**
 * Result returned by the Select primitive select keyboard.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { SelectKeyboardResult } from '@kovojs/headless-ui/select';
 *
 * const value: SelectKeyboardResult = {} as SelectKeyboardResult;
 * ```
 */
export type SelectKeyboardResult =
  | SelectMoveResult
  | SelectOpenChangeResult
  | SelectOptionSelectResult
  | SelectTypeaheadResult;

/**
 * Computes the select item selected transition for the Select primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { selectItemSelected } from '@kovojs/headless-ui/select';
 *
 * const input = {} as Parameters<typeof selectItemSelected>[0];
 * const result = selectItemSelected(input);
 * ```
 */
export function selectItemSelected(options: SelectItemAttributeOptions): boolean {
  return options.value === options.itemValue;
}

/**
 * Computes the select value text transition for the Select primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { selectValueText } from '@kovojs/headless-ui/select';
 *
 * const input = {} as Parameters<typeof selectValueText>[0];
 * const result = selectValueText(input);
 * ```
 */
export function selectValueText(state: SelectState): string {
  const selected = state.items?.find((item) => item.value === state.value);
  if (selected) return selected.label ?? selected.textValue ?? selected.value;
  if (state.value === undefined || state.value === '') return state.placeholder ?? '';
  return state.value;
}

/**
 * Builds the select root attributes record for the Select primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { selectRootAttributes } from '@kovojs/headless-ui/select';
 *
 * const input = {} as Parameters<typeof selectRootAttributes>[0];
 * const result = selectRootAttributes(input);
 * ```
 */
export function selectRootAttributes(
  options: SelectRootAttributeOptions = {},
): SelectPrimitiveAttributes {
  return Object.freeze({
    ...selectDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

/**
 * Builds the select trigger attributes record for the Select primitive.
 *
 * Emits `aria-activedescendant`, `aria-controls`, `aria-expanded`, `aria-haspopup`, `aria-labelledby`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { selectTriggerAttributes } from '@kovojs/headless-ui/select';
 *
 * const input = {} as Parameters<typeof selectTriggerAttributes>[0];
 * const result = selectTriggerAttributes(input);
 * ```
 */
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

/**
 * Builds the select hidden input attributes record for the Select primitive.
 *
 * Emits `hidden`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { selectHiddenInputAttributes } from '@kovojs/headless-ui/select';
 *
 * const input = {} as Parameters<typeof selectHiddenInputAttributes>[0];
 * const result = selectHiddenInputAttributes(input);
 * ```
 */
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

/**
 * Builds the select content attributes record for the Select primitive.
 *
 * Emits `aria-labelledby`.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { selectContentAttributes } from '@kovojs/headless-ui/select';
 *
 * const input = {} as Parameters<typeof selectContentAttributes>[0];
 * const result = selectContentAttributes(input);
 * ```
 */
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

/**
 * Builds the select item attributes record for the Select primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { selectItemAttributes } from '@kovojs/headless-ui/select';
 *
 * const input = {} as Parameters<typeof selectItemAttributes>[0];
 * const result = selectItemAttributes(input);
 * ```
 */
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

/**
 * Builds the select value attributes record for the Select primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { selectValueAttributes } from '@kovojs/headless-ui/select';
 *
 * const input = {} as Parameters<typeof selectValueAttributes>[0];
 * const result = selectValueAttributes(input);
 * ```
 */
export function selectValueAttributes(
  options: SelectValueAttributeOptions = {},
): SelectPrimitiveAttributes {
  return Object.freeze({
    ...selectValueDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

/**
 * Computes the set select value transition for the Select primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { setSelectValue } from '@kovojs/headless-ui/select';
 *
 * const input = {} as Parameters<typeof setSelectValue>[0];
 * const state = {} as Parameters<typeof setSelectValue>[1];
 * const options = {} as Parameters<typeof setSelectValue>[2];
 * const detail = {} as Parameters<typeof setSelectValue>[3];
 * const result = setSelectValue(input, state, options, detail);
 * ```
 */
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

/**
 * Computes the set select open transition for the Select primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { setSelectOpen } from '@kovojs/headless-ui/select';
 *
 * const input = {} as Parameters<typeof setSelectOpen>[0];
 * const state = {} as Parameters<typeof setSelectOpen>[1];
 * const options = {} as Parameters<typeof setSelectOpen>[2];
 * const detail = {} as Parameters<typeof setSelectOpen>[3];
 * const result = setSelectOpen(input, state, options, detail);
 * ```
 */
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

/**
 * Computes the select option transition for the Select primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { selectOption } from '@kovojs/headless-ui/select';
 *
 * const input = {} as Parameters<typeof selectOption>[0];
 * const state = {} as Parameters<typeof selectOption>[1];
 * const options = {} as Parameters<typeof selectOption>[2];
 * const result = selectOption(input, state, options);
 * ```
 */
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

/**
 * Computes the select move transition for the Select primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { selectMove } from '@kovojs/headless-ui/select';
 *
 * const input = {} as Parameters<typeof selectMove>[0];
 * const state = {} as Parameters<typeof selectMove>[1];
 * const options = {} as Parameters<typeof selectMove>[2];
 * const result = selectMove(input, state, options);
 * ```
 */
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

/**
 * Computes the select typeahead transition for the Select primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { selectTypeahead } from '@kovojs/headless-ui/select';
 *
 * const input = {} as Parameters<typeof selectTypeahead>[0];
 * const state = {} as Parameters<typeof selectTypeahead>[1];
 * const options = {} as Parameters<typeof selectTypeahead>[2];
 * const result = selectTypeahead(input, state, options);
 * ```
 */
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
 * Computes the select trigger change transition for the Select primitive.
 *
 * @example
 * ```ts
 * import { selectTriggerChange } from '@kovojs/headless-ui/select';
 *
 * const input = {} as Parameters<typeof selectTriggerChange>[0];
 * const state = {} as Parameters<typeof selectTriggerChange>[1];
 * const options = {} as Parameters<typeof selectTriggerChange>[2];
 * const result = selectTriggerChange(input, state, options);
 * ```
 *
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
 * Computes the select trigger click transition for the Select primitive.
 *
 * @example
 * ```ts
 * import { selectTriggerClick } from '@kovojs/headless-ui/select';
 *
 * const input = {} as Parameters<typeof selectTriggerClick>[0];
 * const state = {} as Parameters<typeof selectTriggerClick>[1];
 * const options = {} as Parameters<typeof selectTriggerClick>[2];
 * const result = selectTriggerClick(input, state, options);
 * ```
 *
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
 * Computes the select item click transition for the Select primitive.
 *
 * @example
 * ```ts
 * import { selectItemClick } from '@kovojs/headless-ui/select';
 *
 * const input = {} as Parameters<typeof selectItemClick>[0];
 * const state = {} as Parameters<typeof selectItemClick>[1];
 * const options = {} as Parameters<typeof selectItemClick>[2];
 * const result = selectItemClick(input, state, options);
 * ```
 *
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
 * Computes the select key down transition for the Select primitive.
 *
 * @example
 * ```ts
 * import { selectKeyDown } from '@kovojs/headless-ui/select';
 *
 * const input = {} as Parameters<typeof selectKeyDown>[0];
 * const state = {} as Parameters<typeof selectKeyDown>[1];
 * const options = {} as Parameters<typeof selectKeyDown>[2];
 * const result = selectKeyDown(input, state, options);
 * ```
 *
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
