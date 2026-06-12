import { dataDisabled, mergeDataAttributes, type PrimitiveDataAttributes } from '../lib/index.js';

export interface FieldAttributeOptions {
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  required?: boolean;
}

export interface FieldControlAttributeOptions extends FieldAttributeOptions {
  descriptionId?: string;
  errorId?: string;
  name?: string;
}

export interface FieldLabelAttributeOptions extends FieldAttributeOptions {
  controlId?: string;
}

export interface FieldMessageAttributeOptions extends FieldAttributeOptions {
  visible?: boolean;
}

export interface FieldsetAttributeOptions extends FieldAttributeOptions {
  descriptionId?: string;
  errorId?: string;
}

export type FieldPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | string>>;

export function fieldRootAttributes(options: FieldAttributeOptions = {}): FieldPrimitiveAttributes {
  return Object.freeze({
    ...fieldDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

export function fieldLabelAttributes(
  options: FieldLabelAttributeOptions = {},
): FieldPrimitiveAttributes {
  return Object.freeze({
    ...fieldDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.controlId === undefined ? {} : { for: options.controlId }),
  });
}

export function fieldControlAttributes(
  options: FieldControlAttributeOptions = {},
): FieldPrimitiveAttributes {
  const describedBy = fieldDescribedBy(options);

  // SPEC.md §6.3: form() typing validates real named controls; this helper
  // keeps field wiring native instead of adding hidden inputs.
  return Object.freeze({
    ...fieldDataAttributes(options),
    ...(describedBy === '' ? {} : { 'aria-describedby': describedBy }),
    ...(options.invalid === true ? { 'aria-invalid': 'true' } : {}),
    disabled: options.disabled === true,
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(options.required === true ? { required: true } : {}),
  });
}

export function fieldDescriptionAttributes(
  options: FieldMessageAttributeOptions = {},
): FieldPrimitiveAttributes {
  return Object.freeze({
    ...fieldDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.visible === false ? { hidden: true } : {}),
  });
}

export function fieldErrorAttributes(
  options: FieldMessageAttributeOptions = {},
): FieldPrimitiveAttributes {
  return Object.freeze({
    ...fieldDataAttributes({ ...options, invalid: true }),
    ...(options.id === undefined ? {} : { id: options.id }),
    role: 'alert',
    ...(options.visible === false ? { hidden: true } : {}),
  });
}

export function fieldsetRootAttributes(
  options: FieldsetAttributeOptions = {},
): FieldPrimitiveAttributes {
  const describedBy = fieldDescribedBy(options);

  return Object.freeze({
    ...fieldDataAttributes(options),
    ...(describedBy === '' ? {} : { 'aria-describedby': describedBy }),
    ...(options.invalid === true ? { 'aria-invalid': 'true' } : {}),
    disabled: options.disabled === true,
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

export function fieldsetLegendAttributes(
  options: FieldAttributeOptions = {},
): FieldPrimitiveAttributes {
  return Object.freeze({
    ...fieldDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

function fieldDataAttributes(options: FieldAttributeOptions): PrimitiveDataAttributes {
  return mergeDataAttributes(
    dataDisabled(options.disabled === true),
    options.invalid === true ? { 'data-invalid': '' } : undefined,
    options.required === true ? { 'data-required': '' } : undefined,
  );
}

function fieldDescribedBy(options: {
  descriptionId?: string;
  errorId?: string;
  invalid?: boolean;
}): string {
  return [options.descriptionId, options.invalid === true ? options.errorId : undefined]
    .filter((id): id is string => id !== undefined && id.length > 0)
    .join(' ');
}
