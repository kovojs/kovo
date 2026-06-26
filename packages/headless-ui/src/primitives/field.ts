import { dataDisabled, mergeDataAttributes, type PrimitiveDataAttributes } from '../lib/index.js';

/**
 * Options accepted by the Field primitive field attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { FieldAttributeOptions } from '@kovojs/headless-ui/field';
 *
 * const value: FieldAttributeOptions = {} as FieldAttributeOptions;
 * ```
 */
export interface FieldAttributeOptions {
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  required?: boolean;
}

/**
 * Options accepted by the Field primitive field control attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { FieldControlAttributeOptions } from '@kovojs/headless-ui/field';
 *
 * const value: FieldControlAttributeOptions = {} as FieldControlAttributeOptions;
 * ```
 */
export interface FieldControlAttributeOptions extends FieldAttributeOptions {
  autoComplete?: string;
  descriptionId?: string;
  errorId?: string;
  form?: string;
  inputMode?: string;
  maxLength?: number;
  minLength?: number;
  name?: string;
  pattern?: string;
}

/**
 * Options accepted by the Field primitive field label attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { FieldLabelAttributeOptions } from '@kovojs/headless-ui/field';
 *
 * const value: FieldLabelAttributeOptions = {} as FieldLabelAttributeOptions;
 * ```
 */
export interface FieldLabelAttributeOptions extends FieldAttributeOptions {
  controlId?: string;
}

/**
 * Options accepted by the Field primitive field message attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { FieldMessageAttributeOptions } from '@kovojs/headless-ui/field';
 *
 * const value: FieldMessageAttributeOptions = {} as FieldMessageAttributeOptions;
 * ```
 */
export interface FieldMessageAttributeOptions extends FieldAttributeOptions {
  visible?: boolean;
}

/**
 * Options accepted by the Field primitive fieldset attribute.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { FieldsetAttributeOptions } from '@kovojs/headless-ui/field';
 *
 * const value: FieldsetAttributeOptions = {} as FieldsetAttributeOptions;
 * ```
 */
export interface FieldsetAttributeOptions extends FieldAttributeOptions {
  descriptionId?: string;
  errorId?: string;
  form?: string;
  name?: string;
}

/**
 * Serializable attribute record returned by Field primitive builders.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import type { FieldPrimitiveAttributes } from '@kovojs/headless-ui/field';
 *
 * const value: FieldPrimitiveAttributes = {} as FieldPrimitiveAttributes;
 * ```
 */
export type FieldPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, boolean | number | string>>;

/**
 * Builds the field root attributes record for the Field primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { fieldRootAttributes } from '@kovojs/headless-ui/field';
 *
 * const input = {} as Parameters<typeof fieldRootAttributes>[0];
 * const result = fieldRootAttributes(input);
 * ```
 */
export function fieldRootAttributes(options: FieldAttributeOptions = {}): FieldPrimitiveAttributes {
  return Object.freeze({
    ...fieldDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
  });
}

/**
 * Builds the field label attributes record for the Field primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { fieldLabelAttributes } from '@kovojs/headless-ui/field';
 *
 * const input = {} as Parameters<typeof fieldLabelAttributes>[0];
 * const result = fieldLabelAttributes(input);
 * ```
 */
export function fieldLabelAttributes(
  options: FieldLabelAttributeOptions = {},
): FieldPrimitiveAttributes {
  return Object.freeze({
    ...fieldDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.controlId === undefined ? {} : { for: options.controlId }),
  });
}

/**
 * Builds the field control attributes record for the Field primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { fieldControlAttributes } from '@kovojs/headless-ui/field';
 *
 * const input = {} as Parameters<typeof fieldControlAttributes>[0];
 * const result = fieldControlAttributes(input);
 * ```
 */
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
    ...(options.disabled === true ? { disabled: true } : {}),
    ...(options.autoComplete === undefined ? {} : { autoComplete: options.autoComplete }),
    ...(options.form === undefined ? {} : { form: options.form }),
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.inputMode === undefined ? {} : { inputMode: options.inputMode }),
    ...(options.maxLength === undefined ? {} : { maxLength: options.maxLength }),
    ...(options.minLength === undefined ? {} : { minLength: options.minLength }),
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(options.pattern === undefined ? {} : { pattern: options.pattern }),
    ...(options.required === true ? { required: true } : {}),
  });
}

/**
 * Builds the field description attributes record for the Field primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { fieldDescriptionAttributes } from '@kovojs/headless-ui/field';
 *
 * const input = {} as Parameters<typeof fieldDescriptionAttributes>[0];
 * const result = fieldDescriptionAttributes(input);
 * ```
 */
export function fieldDescriptionAttributes(
  options: FieldMessageAttributeOptions = {},
): FieldPrimitiveAttributes {
  return Object.freeze({
    ...fieldDataAttributes(options),
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.visible === false ? { hidden: true } : {}),
  });
}

/**
 * Builds the field error attributes record for the Field primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { fieldErrorAttributes } from '@kovojs/headless-ui/field';
 *
 * const input = {} as Parameters<typeof fieldErrorAttributes>[0];
 * const result = fieldErrorAttributes(input);
 * ```
 */
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

/**
 * Builds the fieldset root attributes record for the Field primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { fieldsetRootAttributes } from '@kovojs/headless-ui/field';
 *
 * const input = {} as Parameters<typeof fieldsetRootAttributes>[0];
 * const result = fieldsetRootAttributes(input);
 * ```
 */
export function fieldsetRootAttributes(
  options: FieldsetAttributeOptions = {},
): FieldPrimitiveAttributes {
  const describedBy = fieldDescribedBy(options);

  return Object.freeze({
    ...fieldDataAttributes(options),
    ...(describedBy === '' ? {} : { 'aria-describedby': describedBy }),
    ...(options.invalid === true ? { 'aria-invalid': 'true' } : {}),
    ...(options.disabled === true ? { disabled: true } : {}),
    ...(options.form === undefined ? {} : { form: options.form }),
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.name === undefined ? {} : { name: options.name }),
  });
}

/**
 * Builds the fieldset legend attributes record for the Field primitive.
 *
 * SPEC.md §4.6 defines primitive attribute records and merge ownership.
 *
 * @example
 * ```ts
 * import { fieldsetLegendAttributes } from '@kovojs/headless-ui/field';
 *
 * const input = {} as Parameters<typeof fieldsetLegendAttributes>[0];
 * const result = fieldsetLegendAttributes(input);
 * ```
 */
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
