/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  fieldControlAttributes,
  fieldDescriptionAttributes,
  fieldErrorAttributes,
  fieldLabelAttributes,
  fieldRootAttributes,
  fieldsetLegendAttributes,
  fieldsetRootAttributes,
} from '@kovojs/headless-ui/field';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

/**
 * Style override slots accepted by the field components.
 *
 * @example
 * import type { FieldStyleOverrides } from "@kovojs/ui/field";
 * const styles: FieldStyleOverrides = {};
 */
export interface FieldStyleOverrides {
  control?: style.StyleInput;
  description?: style.StyleInput;
  error?: style.StyleInput;
  fieldset?: style.StyleInput;
  fieldsetLegend?: style.StyleInput;
  label?: style.StyleInput;
  root?: style.StyleInput;
  select?: style.StyleInput;
  selectOption?: style.StyleInput;
  textarea?: style.StyleInput;
}

/**
 * Shared state props for the field component family.
 *
 * @example
 * import type { FieldStateProps } from "@kovojs/ui/field";
 * const state: FieldStateProps = {};
 */
export interface FieldStateProps {
  disabled?: boolean;
  invalid?: boolean;
  required?: boolean;
}

/**
 * Props for the field component.
 *
 * @example
 * import type { FieldProps } from "@kovojs/ui/field";
 * const props: FieldProps = { children: 'Content' };
 */
export interface FieldProps extends FieldStateProps {
  children?: string;
  id?: string;
  styles?: FieldStyleOverrides;
}

/**
 * Props for the field label component.
 *
 * @example
 * import type { FieldLabelProps } from "@kovojs/ui/field";
 * const props: FieldLabelProps = { children: 'Content' };
 */
export interface FieldLabelProps extends FieldStateProps {
  children?: string;
  controlId?: string;
  id?: string;
  styles?: FieldStyleOverrides;
}

/**
 * Props for the field control component.
 *
 * @example
 * import type { FieldControlProps } from "@kovojs/ui/field";
 * const props: FieldControlProps = {};
 */
export interface FieldControlProps extends FieldStateProps {
  autoComplete?: string;
  descriptionId?: string;
  errorId?: string;
  form?: string;
  id?: string;
  inputMode?: string;
  maxLength?: number;
  minLength?: number;
  name?: string;
  pattern?: string;
  placeholder?: string;
  styles?: FieldStyleOverrides;
  type?: string;
  value?: string;
}

/**
 * Props for the field textarea component.
 *
 * @example
 * import type { FieldTextareaProps } from "@kovojs/ui/field";
 * const props: FieldTextareaProps = { children: 'Content' };
 */
export interface FieldTextareaProps extends FieldStateProps {
  autoComplete?: string;
  children?: string;
  descriptionId?: string;
  errorId?: string;
  form?: string;
  id?: string;
  inputMode?: string;
  maxLength?: number;
  minLength?: number;
  name?: string;
  placeholder?: string;
  rows?: number;
  styles?: FieldStyleOverrides;
}

/**
 * Props for the field select component.
 *
 * @example
 * import type { FieldSelectProps } from "@kovojs/ui/field";
 * const props: FieldSelectProps = { children: 'Content' };
 */
export interface FieldSelectProps extends FieldStateProps {
  children?: string;
  descriptionId?: string;
  errorId?: string;
  form?: string;
  id?: string;
  name?: string;
  styles?: FieldStyleOverrides;
  value?: string;
}

/**
 * Props for the field select option component.
 *
 * @example
 * import type { FieldSelectOptionProps } from "@kovojs/ui/field";
 * const props: FieldSelectOptionProps = { children: 'Content' };
 */
export interface FieldSelectOptionProps {
  children?: string;
  disabled?: boolean;
  selected?: boolean;
  styles?: FieldStyleOverrides;
  value?: string;
}

/**
 * Props for the field message component.
 *
 * @example
 * import type { FieldMessageProps } from "@kovojs/ui/field";
 * const props: FieldMessageProps = { children: 'Content' };
 */
export interface FieldMessageProps extends FieldStateProps {
  children?: string;
  id?: string;
  styles?: FieldStyleOverrides;
  visible?: boolean;
}

/**
 * Props for the fieldset component.
 *
 * @example
 * import type { FieldsetProps } from "@kovojs/ui/field";
 * const props: FieldsetProps = { children: 'Content' };
 */
export interface FieldsetProps extends FieldStateProps {
  children?: string;
  descriptionId?: string;
  errorId?: string;
  form?: string;
  id?: string;
  name?: string;
  styles?: FieldStyleOverrides;
}

/**
 * Props for the fieldset legend component.
 *
 * @example
 * import type { FieldsetLegendProps } from "@kovojs/ui/field";
 * const props: FieldsetLegendProps = { children: 'Content' };
 */
export interface FieldsetLegendProps extends FieldStateProps {
  children?: string;
  id?: string;
  styles?: FieldStyleOverrides;
}

const nativeControlStyle = {
  backgroundColor: uiTheme.color.background,
  borderColor: uiTheme.color.border,
  borderRadius: uiTheme.radius.md,
  borderStyle: 'solid',
  borderWidth: 1,
  boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
  color: uiTheme.color.foreground,
  fontSize: 14,
  transitionProperty: 'border-color, background-color, color, box-shadow',
  width: '100%',
  '::placeholder': {
    color: uiTheme.color.foregroundMuted,
  },
  '[aria-invalid=true]': {
    borderColor: uiTheme.color.danger.border,
  },
  ':disabled': {
    backgroundColor: uiTheme.color.backgroundSubtle,
    cursor: 'not-allowed',
    opacity: 0.7,
  },
  // shadcn-style focus: a 3px translucent ring (box-shadow) plus an accent
  // border, instead of a detached offset outline.
  ':focus-visible': {
    borderColor: uiTheme.color.accent,
    boxShadow: '0 0 0 3px color-mix(in srgb, var(--kovo-theme-sys-color-primary) 35%, transparent)',
    outlineStyle: 'none',
  },
  '[aria-invalid=true]:focus-visible': {
    borderColor: uiTheme.color.danger.border,
    boxShadow: '0 0 0 3px color-mix(in srgb, var(--kovo-theme-sys-color-error) 30%, transparent)',
  },
} as const;

/**
 * Style definitions used by the field components.
 *
 * @example
 * import { fieldStyles } from "@kovojs/ui/field";
 * const styles = fieldStyles;
 */
export const fieldStyles = style.create({
  control: {
    ...nativeControlStyle,
    height: 36,
    paddingBlock: 4,
    paddingInline: 12,
  },
  description: {
    color: uiTheme.color.foregroundMuted,
    fontSize: 14,
  },
  error: {
    color: uiTheme.color.danger.border,
    fontSize: 14,
  },
  fieldset: {
    borderColor: uiTheme.color.border,
    borderRadius: uiTheme.radius.md,
    borderStyle: 'solid',
    borderWidth: 1,
    color: uiTheme.color.foreground,
    display: 'grid',
    fontSize: 14,
    padding: 16,
    rowGap: 12,
    '[data-disabled]': {
      opacity: 0.5,
    },
    '[data-invalid]': {
      borderColor: uiTheme.color.danger.border,
    },
  },
  fieldsetLegend: {
    color: uiTheme.color.foreground,
    fontSize: 14,
    fontWeight: 500,
    paddingInline: 4,
  },
  label: {
    color: uiTheme.color.foreground,
    fontSize: 14,
    fontWeight: 500,
    lineHeight: 1,
    '[data-disabled]': {
      cursor: 'not-allowed',
      opacity: 0.7,
    },
    // Required emphasis belongs on the label only — not the whole field.
    '[data-required]': {
      fontWeight: 600,
    },
  },
  root: {
    color: uiTheme.color.foreground,
    display: 'grid',
    fontSize: 14,
    rowGap: 8,
    '[data-disabled]': {
      opacity: 0.5,
    },
    '[data-invalid]': {
      color: uiTheme.color.danger.foreground,
    },
  },
  select: {
    ...nativeControlStyle,
    height: 36,
    paddingBlock: 4,
    paddingInline: 12,
  },
  selectOption: {
    color: uiTheme.color.foreground,
    ':disabled': {
      color: uiTheme.color.foregroundMuted,
    },
  },
  textarea: {
    ...nativeControlStyle,
    minHeight: 96,
    paddingBlock: 8,
    paddingInline: 12,
  },
});

/**
 * Renders the styled field primitive.
 *
 * @example
 * import { Field } from "@kovojs/ui/field";
 * const component = Field;
 */
export const Field = component({
  render(props: FieldProps) {
    const attrs = fieldRootAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.required === undefined ? {} : { required: props.required }),
    });
    const styleAttrs = style.attrs(fieldStyles.root, props.styles?.root);

    return (
      <div
        {...styleAttrs}
        {...passThroughProps(props)}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        id={attrs.id}
      >
        {props.children}
      </div>
    );
  },
});

/**
 * Renders the styled field label primitive.
 *
 * @example
 * import { FieldLabel } from "@kovojs/ui/field";
 * const component = FieldLabel;
 */
export const FieldLabel = component({
  render(props: FieldLabelProps) {
    const attrs = fieldLabelAttributes({
      ...(props.controlId === undefined ? {} : { controlId: props.controlId }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.required === undefined ? {} : { required: props.required }),
    });
    const styleAttrs = style.attrs(fieldStyles.label, props.styles?.label);

    return (
      <label
        {...styleAttrs}
        {...passThroughProps(props)}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        for={attrs.for}
        id={attrs.id}
      >
        {props.children}
      </label>
    );
  },
});

/**
 * Renders the styled field control primitive.
 *
 * @example
 * import { FieldControl } from "@kovojs/ui/field";
 * const component = FieldControl;
 */
export const FieldControl = component({
  render(props: FieldControlProps) {
    const attrs = fieldControlAttributes({
      ...(props.autoComplete === undefined ? {} : { autoComplete: props.autoComplete }),
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.errorId === undefined ? {} : { errorId: props.errorId }),
      ...(props.form === undefined ? {} : { form: props.form }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.inputMode === undefined ? {} : { inputMode: props.inputMode }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.maxLength === undefined ? {} : { maxLength: props.maxLength }),
      ...(props.minLength === undefined ? {} : { minLength: props.minLength }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.pattern === undefined ? {} : { pattern: props.pattern }),
      ...(props.required === undefined ? {} : { required: props.required }),
    });
    const styleAttrs = style.attrs(fieldStyles.control, props.styles?.control);

    return (
      <input
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-describedby={attrs['aria-describedby']}
        aria-invalid={attrs['aria-invalid']}
        autoComplete={attrs.autoComplete}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        disabled={attrs.disabled}
        form={attrs.form}
        id={attrs.id}
        inputMode={attrs.inputMode}
        maxLength={attrs.maxLength}
        minLength={attrs.minLength}
        name={attrs.name}
        pattern={attrs.pattern}
        placeholder={props.placeholder}
        required={attrs.required}
        type={props.type ?? 'text'}
        value={props.value}
      />
    );
  },
});

/**
 * Renders the styled field textarea primitive.
 *
 * @example
 * import { FieldTextarea } from "@kovojs/ui/field";
 * const component = FieldTextarea;
 */
export const FieldTextarea = component({
  render(props: FieldTextareaProps) {
    const attrs = fieldControlAttributes({
      ...(props.autoComplete === undefined ? {} : { autoComplete: props.autoComplete }),
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.errorId === undefined ? {} : { errorId: props.errorId }),
      ...(props.form === undefined ? {} : { form: props.form }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.inputMode === undefined ? {} : { inputMode: props.inputMode }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.maxLength === undefined ? {} : { maxLength: props.maxLength }),
      ...(props.minLength === undefined ? {} : { minLength: props.minLength }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.required === undefined ? {} : { required: props.required }),
    });
    const styleAttrs = style.attrs(fieldStyles.textarea, props.styles?.textarea);

    return (
      <textarea
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-describedby={attrs['aria-describedby']}
        aria-invalid={attrs['aria-invalid']}
        autoComplete={attrs.autoComplete}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        disabled={attrs.disabled}
        form={attrs.form}
        id={attrs.id}
        inputMode={attrs.inputMode}
        maxLength={attrs.maxLength}
        minLength={attrs.minLength}
        name={attrs.name}
        placeholder={props.placeholder}
        required={attrs.required}
        rows={props.rows}
      >
        {props.children}
      </textarea>
    );
  },
});

/**
 * Renders the styled field select primitive.
 *
 * @example
 * import { FieldSelect } from "@kovojs/ui/field";
 * const component = FieldSelect;
 */
export const FieldSelect = component({
  render(props: FieldSelectProps) {
    const attrs = fieldControlAttributes({
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.errorId === undefined ? {} : { errorId: props.errorId }),
      ...(props.form === undefined ? {} : { form: props.form }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.required === undefined ? {} : { required: props.required }),
    });
    const styleAttrs = style.attrs(fieldStyles.select, props.styles?.select);

    return (
      <select
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-describedby={attrs['aria-describedby']}
        aria-invalid={attrs['aria-invalid']}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        disabled={attrs.disabled}
        form={attrs.form}
        id={attrs.id}
        name={attrs.name}
        required={attrs.required}
        value={props.value}
      >
        {props.children}
      </select>
    );
  },
});

/**
 * Renders the styled field select option primitive.
 *
 * @example
 * import { FieldSelectOption } from "@kovojs/ui/field";
 * const component = FieldSelectOption;
 */
export const FieldSelectOption = component({
  render(props: FieldSelectOptionProps) {
    const styleAttrs = style.attrs(fieldStyles.selectOption, props.styles?.selectOption);

    return (
      <option
        {...styleAttrs}
        {...passThroughProps(props)}
        disabled={props.disabled}
        selected={props.selected}
        value={props.value}
      >
        {props.children}
      </option>
    );
  },
});

/**
 * Renders the styled field description primitive.
 *
 * @example
 * import { FieldDescription } from "@kovojs/ui/field";
 * const component = FieldDescription;
 */
export const FieldDescription = component({
  render(props: FieldMessageProps) {
    const attrs = fieldDescriptionAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.visible === undefined ? {} : { visible: props.visible }),
    });
    const styleAttrs = style.attrs(fieldStyles.description, props.styles?.description);

    return (
      <p
        {...styleAttrs}
        {...passThroughProps(props)}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        hidden={attrs.hidden}
        id={attrs.id}
      >
        {props.children}
      </p>
    );
  },
});

/**
 * Renders the styled field error primitive.
 *
 * @example
 * import { FieldError } from "@kovojs/ui/field";
 * const component = FieldError;
 */
export const FieldError = component({
  render(props: FieldMessageProps) {
    const attrs = fieldErrorAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.visible === undefined ? {} : { visible: props.visible }),
    });
    const styleAttrs = style.attrs(fieldStyles.error, props.styles?.error);

    return (
      <p
        {...styleAttrs}
        {...passThroughProps(props)}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        hidden={attrs.hidden}
        id={attrs.id}
        role={attrs.role}
      >
        {props.children}
      </p>
    );
  },
});

/**
 * Renders the styled fieldset primitive.
 *
 * @example
 * import { Fieldset } from "@kovojs/ui/field";
 * const component = Fieldset;
 */
export const Fieldset = component({
  render(props: FieldsetProps) {
    const attrs = fieldsetRootAttributes({
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.errorId === undefined ? {} : { errorId: props.errorId }),
      ...(props.form === undefined ? {} : { form: props.form }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.required === undefined ? {} : { required: props.required }),
    });
    const styleAttrs = style.attrs(fieldStyles.fieldset, props.styles?.fieldset);

    return (
      <fieldset
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-describedby={attrs['aria-describedby']}
        aria-invalid={attrs['aria-invalid']}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        disabled={attrs.disabled}
        form={attrs.form}
        id={attrs.id}
        name={attrs.name}
      >
        {props.children}
      </fieldset>
    );
  },
});

/**
 * Renders the styled fieldset legend primitive.
 *
 * @example
 * import { FieldsetLegend } from "@kovojs/ui/field";
 * const component = FieldsetLegend;
 */
export const FieldsetLegend = component({
  render(props: FieldsetLegendProps) {
    const attrs = fieldsetLegendAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.required === undefined ? {} : { required: props.required }),
    });
    const styleAttrs = style.attrs(fieldStyles.fieldsetLegend, props.styles?.fieldsetLegend);

    return (
      <legend
        {...styleAttrs}
        {...passThroughProps(props)}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        id={attrs.id}
      >
        {props.children}
      </legend>
    );
  },
});
