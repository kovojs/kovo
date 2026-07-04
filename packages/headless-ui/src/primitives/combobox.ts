import {
  checkedState,
  createCollectionAdapter,
  dataDisabled,
  dataState,
  dispatchCancelableChange,
  filterCollection,
  mergeDataAttributes,
  setOpenState,
  triggerAttributes,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
  type TypeaheadState,
} from '../lib/index.js';
import { activeDescendantId, describedByIds } from '../lib/active-descendant.js';

/**
 * Public interface used by the Combobox primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { ComboboxItem } from '@kovojs/headless-ui/combobox';
 *
 * declare const value: ComboboxItem;
 * ```
 *
 *
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
 * declare const value: ComboboxState;
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
 * declare const value: ComboboxRootAttributeOptions;
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
 * declare const value: ComboboxInputAttributeOptions;
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
 * declare const value: ComboboxListboxAttributeOptions;
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
 * declare const value: ComboboxOptionAttributeOptions;
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
 * declare const value: ComboboxValueAttributeOptions;
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
 * declare const value: ComboboxValueChangeReason;
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
 * declare const value: ComboboxOpenChangeReason;
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
 * declare const value: ComboboxValueChangeDetail;
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
 * declare const value: ComboboxOpenChangeDetail;
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
 * declare const value: ComboboxChangeOptions;
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
 * declare const value: ComboboxValueChangeResult;
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
 * declare const value: ComboboxOpenChangeResult;
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
 * declare const value: ComboboxMoveResult;
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
 * declare const value: ComboboxOptionSelectResult;
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
 * declare const value: ComboboxTypeaheadOptions;
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
 * declare const value: ComboboxTypeaheadResult;
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
 * declare const value: ComboboxPrimitiveAttributes;
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
 * declare const value: ComboboxInputEvent;
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
 * declare const value: ComboboxOptionEvent;
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
 * declare const value: ComboboxKeyboardEvent;
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
 * declare const value: ComboboxKeyboardResult;
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
 * declare const input: Parameters<typeof comboboxOptionSelected>[0];
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
 * declare const input: Parameters<typeof comboboxOptionHighlighted>[0];
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
 * declare const input: Parameters<typeof comboboxValueText>[0];
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
 * declare const input: Parameters<typeof comboboxFilteredItems>[0];
 * const result = comboboxFilteredItems(input);
 * ```
 */
export function comboboxFilteredItems(state: ComboboxState): readonly ComboboxItem[] {
  const query = normalizeComboboxQuery(state.value);
  return filterCollection({
    fields: comboboxFilterFields,
    items: state.items,
    match: (values, normalizedQuery) => values.join(' ').includes(normalizedQuery),
    query,
  });
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
 * declare const input: Parameters<typeof comboboxRootAttributes>[0];
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
 * declare const input: Parameters<typeof comboboxInputAttributes>[0];
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
    role: 'combobox',
    type: 'text',
    value: options.value ?? '',
    ...(activeDescendant === undefined ? {} : { 'aria-activedescendant': activeDescendant }),
    ...triggerAttributes({
      controlsId: options.listboxId,
      disabled: options.disabled === true,
      labelledBy: options.labelledBy,
      nativeDisabledPresence: 'always',
      open: options.open === true,
    }),
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(describedBy === '' ? {} : { 'aria-describedby': describedBy }),
    ...(options.invalid === true ? { 'aria-invalid': 'true' } : {}),
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
 * declare const input: Parameters<typeof comboboxListboxAttributes>[0];
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
 * declare const input: Parameters<typeof comboboxOptionAttributes>[0];
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
 * declare const input: Parameters<typeof comboboxValueAttributes>[0];
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
 * declare const input: Parameters<typeof setComboboxValue>[0];
 * declare const state: Parameters<typeof setComboboxValue>[1];
 * declare const options: Parameters<typeof setComboboxValue>[2];
 * declare const detail: Parameters<typeof setComboboxValue>[3];
 * const result = setComboboxValue(input, state, options, detail);
 * ```
 *
 * @internal
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
 * declare const input: Parameters<typeof setComboboxOpen>[0];
 * declare const state: Parameters<typeof setComboboxOpen>[1];
 * declare const options: Parameters<typeof setComboboxOpen>[2];
 * declare const detail: Parameters<typeof setComboboxOpen>[3];
 * const result = setComboboxOpen(input, state, options, detail);
 * ```
 *
 * @internal
 */
export function setComboboxOpen(
  state: ComboboxState,
  open: boolean,
  reason: ComboboxOpenChangeReason,
  options: ComboboxChangeOptions = {},
): ComboboxOpenChangeResult {
  return setOpenState({ disabled: state.disabled, open: state.open === true }, open, reason, {
    onOpenChange: options.onOpenChange,
  });
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
 * declare const input: Parameters<typeof selectComboboxOption>[0];
 * declare const state: Parameters<typeof selectComboboxOption>[1];
 * declare const options: Parameters<typeof selectComboboxOption>[2];
 * const result = selectComboboxOption(input, state, options);
 * ```
 *
 * @internal
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
 * declare const input: Parameters<typeof comboboxTypeahead>[0];
 * declare const state: Parameters<typeof comboboxTypeahead>[1];
 * declare const options: Parameters<typeof comboboxTypeahead>[2];
 * const result = comboboxTypeahead(input, state, options);
 * ```
 *
 * @internal
 */
export function comboboxTypeahead(
  state: ComboboxState,
  key: string,
  options: ComboboxTypeaheadOptions,
): ComboboxTypeaheadResult {
  const result = comboboxCollection.typeahead(key, state, {
    currentValue: options.currentValue ?? state.highlightedValue ?? state.value,
    disabled: state.disabled,
    loop: options.loop,
    now: options.now,
    state: options.state,
    timeoutMs: options.timeoutMs,
  });
  return result.matchIndex < 0 ? { ...result, value: options.currentValue ?? state.value } : result;
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
 * declare const input: Parameters<typeof comboboxMove>[0];
 * declare const state: Parameters<typeof comboboxMove>[1];
 * declare const options: Parameters<typeof comboboxMove>[2];
 * const result = comboboxMove(input, state, options);
 * ```
 *
 * @internal
 */
export function comboboxMove(
  state: ComboboxState,
  key: string,
  options: { loop?: boolean } = {},
): ComboboxMoveResult | undefined {
  return comboboxCollection.move(state, {
    currentValue: state.highlightedValue ?? state.value,
    disabled: state.disabled,
    key,
    loop: options.loop,
  });
}

/**
 * Handles the combobox input interaction for the Combobox primitive.
 *
 * @example
 * ```ts
 * import { comboboxInput } from '@kovojs/headless-ui/combobox';
 *
 * declare const input: Parameters<typeof comboboxInput>[0];
 * declare const state: Parameters<typeof comboboxInput>[1];
 * declare const options: Parameters<typeof comboboxInput>[2];
 * const result = comboboxInput(input, state, options);
 * ```
 *
 * @generated
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
 * declare const input: Parameters<typeof comboboxOptionClick>[0];
 * declare const state: Parameters<typeof comboboxOptionClick>[1];
 * declare const options: Parameters<typeof comboboxOptionClick>[2];
 * const result = comboboxOptionClick(input, state, options);
 * ```
 *
 * @generated
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
 * declare const input: Parameters<typeof comboboxKeyDown>[0];
 * declare const state: Parameters<typeof comboboxKeyDown>[1];
 * declare const options: Parameters<typeof comboboxKeyDown>[2];
 * const result = comboboxKeyDown(input, state, options);
 * ```
 *
 * @generated
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
  // J2 (SPEC.md §4.6): index against the *filtered* render order (the options the
  // listbox actually renders, comboboxFilteredItems), not the full item list, so the
  // synthesized id matches the rendered option's auto-generated id after filtering.
  return activeDescendantId<string>({
    fallbackId: (value) => comboboxFallbackOptionId(options, value),
    highlightedValue: options.highlightedValue,
    itemId: (value) => comboboxItemId(options, value),
  });
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
  state: ComboboxState & { id?: string; listboxId?: string },
  value: string,
): string | undefined {
  // J2 (SPEC.md §4.6) + bugz-3 L17: use a SINGLE index space — always the
  // *filtered* render order (the options the listbox actually renders). A value
  // outside that order gets no synthesized id (returns undefined) instead of a
  // full-list-index fallback; the old dual space let a non-matching full-index-0
  // item collide with a matching filtered-index-0 item on `…-option-0` and made
  // aria-activedescendant resolve to the wrong element. Both this option side and
  // comboboxActiveDescendant resolve the same `state`, so the IDREF still matches.
  const index = comboboxFilteredItems(state).findIndex((item) => item.value === value);
  if (index < 0) return undefined;
  return `${comboboxFallbackPrefix(state)}-option-${index}`;
}

// bugz-3 L17 / papercuts-6 B (SPEC.md §4.6): synthesized option ids need a
// caller-owned instance prefix. A pure helper cannot distinguish two identical
// id-less comboboxes from the same item set, so falling back to an item
// fingerprint creates duplicate document ids. Require an explicit listboxId for
// id-less generated IDs instead of guessing a page-global instance identity.
function comboboxFallbackPrefix(state: {
  items?: readonly ComboboxItem[];
  listboxId?: string;
}): string {
  if (state.listboxId !== undefined) return state.listboxId;
  throw new TypeError(
    'headless-ui combobox requires listboxId to synthesize option ids for id-less items; ' +
      'pass a unique listboxId or explicit item ids.',
  );
}

function comboboxDescribedBy(options: {
  descriptionId?: string;
  errorId?: string;
  invalid?: boolean;
}): string {
  return describedByIds(
    options.descriptionId,
    options.invalid === true ? options.errorId : undefined,
  );
}

const comboboxFilterFields = [
  (item: ComboboxItem) => item.label,
  (item: ComboboxItem) => item.textValue,
  (item: ComboboxItem) => item.value,
] as const;

const comboboxCollection = createCollectionAdapter({
  getItems: (state: ComboboxState) => state.items,
  projector: comboboxCollectionItem,
});

function comboboxCollectionItem(item: ComboboxItem) {
  return {
    ...(item.disabled === undefined ? {} : { disabled: item.disabled }),
    textValue: item.textValue ?? item.label ?? item.value,
    value: item.value,
  };
}

function normalizeComboboxQuery(inputValue: string | undefined): string {
  return (inputValue ?? '').trim().toLocaleLowerCase();
}
