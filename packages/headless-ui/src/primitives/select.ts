import {
  checkedState,
  dataDisabled,
  dataState,
  dispatchCancelableChange,
  mergeDataAttributes,
  type PrimitiveChangeDetail,
  type PrimitiveDataAttributes,
} from '../lib/index.js';

export interface SelectItem {
  disabled?: boolean;
  label?: string;
  textValue?: string;
  value: string;
}

export interface SelectState {
  disabled?: boolean;
  form?: string;
  invalid?: boolean;
  items?: readonly SelectItem[];
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

export interface SelectContentAttributeOptions extends SelectState {
  id?: string;
  labelledBy?: string;
}

export interface SelectItemAttributeOptions extends SelectState {
  itemDisabled?: boolean;
  itemLabel?: string;
  itemValue: string;
}

export interface SelectValueAttributeOptions extends SelectState {
  id?: string;
}

export type SelectChangeReason = 'programmatic' | 'trigger-change';

export type SelectChangeDetail = PrimitiveChangeDetail<SelectChangeReason, string | undefined>;

export interface SelectChangeOptions {
  onValueChange?: (detail: SelectChangeDetail) => void;
}

export interface SelectChangeResult {
  changed: boolean;
  detail?: SelectChangeDetail;
  value: string | undefined;
}

export type SelectPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

export type SelectTriggerEvent = Event & {
  readonly currentTarget: EventTarget & { value?: string };
};

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

  // SPEC.md §6.3: form() typing validates real named controls; select keeps
  // the native select element as the submitted control.
  return Object.freeze({
    ...selectDataAttributes(options),
    'aria-expanded': String(options.open === true),
    ...(options.disabled === true ? { disabled: true } : {}),
    ...(options.form === undefined ? {} : { form: options.form }),
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
    ...(describedBy === '' ? {} : { 'aria-describedby': describedBy }),
    ...(options.invalid === true ? { 'aria-invalid': 'true' } : {}),
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(options.required === true ? { required: true } : {}),
  });
}

export function selectContentAttributes(
  options: SelectContentAttributeOptions = {},
): SelectPrimitiveAttributes {
  return Object.freeze({
    ...selectDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.labelledBy === undefined ? {} : { 'aria-labelledby': options.labelledBy }),
  });
}

export function selectItemAttributes(
  options: SelectItemAttributeOptions,
): SelectPrimitiveAttributes {
  const disabled = selectItemDisabled(options, options.itemValue);
  const selected = selectItemSelected(options);

  return Object.freeze({
    ...selectItemDataAttributes(options),
    ...(disabled ? { disabled: true } : {}),
    ...(selected ? { selected: true } : {}),
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

/**
 * @jisoPrimitiveHandler
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

function selectDescribedBy(options: {
  descriptionId?: string;
  errorId?: string;
  invalid?: boolean;
}): string {
  return [options.descriptionId, options.invalid === true ? options.errorId : undefined]
    .filter((id): id is string => id !== undefined && id.length > 0)
    .join(' ');
}
