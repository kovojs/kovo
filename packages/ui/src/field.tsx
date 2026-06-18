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

import { uiTheme } from './theme.js';

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

export interface FieldStateProps {
  disabled?: boolean;
  invalid?: boolean;
  required?: boolean;
}

export interface FieldProps extends FieldStateProps {
  children?: string;
  id?: string;
  styles?: FieldStyleOverrides;
}

export interface FieldLabelProps extends FieldStateProps {
  children?: string;
  controlId?: string;
  id?: string;
  styles?: FieldStyleOverrides;
}

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

export interface FieldSelectOptionProps {
  children?: string;
  disabled?: boolean;
  selected?: boolean;
  styles?: FieldStyleOverrides;
  value?: string;
}

export interface FieldMessageProps extends FieldStateProps {
  children?: string;
  id?: string;
  styles?: FieldStyleOverrides;
  visible?: boolean;
}

export interface FieldsetProps extends FieldStateProps {
  children?: string;
  descriptionId?: string;
  errorId?: string;
  form?: string;
  id?: string;
  name?: string;
  styles?: FieldStyleOverrides;
}

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
  ':focus-visible': {
    outlineColor: uiTheme.color.borderStrong,
    outlineOffset: 2,
    outlineStyle: 'solid',
    outlineWidth: 2,
  },
  '[aria-invalid=true]:focus-visible': {
    outlineColor: uiTheme.color.danger.border,
  },
} as const;

export const fieldStyles = style.create(
  {
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
      fontWeight: 500,
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
      '[data-required]': {
        fontWeight: 500,
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
  },
  { namespace: 'field', source: 'field.tsx' },
);

export const fieldClasses = [style.attrs(fieldStyles.root).class ?? ''] as const;
export const fieldLabelClasses = [style.attrs(fieldStyles.label).class ?? ''] as const;
export const fieldControlClasses = [style.attrs(fieldStyles.control).class ?? ''] as const;
export const fieldTextareaClasses = [style.attrs(fieldStyles.textarea).class ?? ''] as const;
export const fieldSelectClasses = [style.attrs(fieldStyles.select).class ?? ''] as const;
export const fieldSelectOptionClasses = [
  style.attrs(fieldStyles.selectOption).class ?? '',
] as const;
export const fieldDescriptionClasses = [style.attrs(fieldStyles.description).class ?? ''] as const;
export const fieldErrorClasses = [style.attrs(fieldStyles.error).class ?? ''] as const;
export const fieldsetClasses = [style.attrs(fieldStyles.fieldset).class ?? ''] as const;
export const fieldsetLegendClasses = [style.attrs(fieldStyles.fieldsetLegend).class ?? ''] as const;

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

export const FieldSelectOption = component({
  render(props: FieldSelectOptionProps) {
    const styleAttrs = style.attrs(fieldStyles.selectOption, props.styles?.selectOption);

    return (
      <option
        {...styleAttrs}
        disabled={props.disabled}
        selected={props.selected}
        value={props.value}
      >
        {props.children}
      </option>
    );
  },
});

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
