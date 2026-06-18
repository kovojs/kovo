/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  numberFieldDecrementAttributes,
  numberFieldIncrementAttributes,
  numberFieldInputAttributes,
  numberFieldRootAttributes,
  type NumberFieldValue,
} from '@kovojs/headless-ui/number-field';
import * as style from '@kovojs/style';

export interface NumberFieldStyleOverrides {
  button?: style.StyleInput;
  control?: style.StyleInput;
  input?: style.StyleInput;
  root?: style.StyleInput;
}

export interface NumberFieldStateProps {
  disabled?: boolean;
  invalid?: boolean;
  max?: number;
  min?: number;
  name?: string;
  required?: boolean;
  step?: number;
  value?: NumberFieldValue;
}

export interface NumberFieldProps extends NumberFieldStateProps {
  children?: string;
  id?: string;
  styles?: NumberFieldStyleOverrides;
}

export interface NumberFieldInputProps extends NumberFieldStateProps {
  descriptionId?: string;
  errorId?: string;
  form?: string;
  id?: string;
  label?: string;
  labelledBy?: string;
  styles?: NumberFieldStyleOverrides;
}

export interface NumberFieldButtonProps extends NumberFieldStateProps {
  children?: string;
  id?: string;
  inputId?: string;
  label?: string;
  styles?: NumberFieldStyleOverrides;
}

export const numberFieldStyles = style.create(
  {
    button: {
      alignItems: 'center',
      backgroundColor: '#fafafa',
      borderColor: '#e5e5e5',
      borderStyle: 'solid',
      color: '#404040',
      display: 'inline-flex',
      fontSize: 14,
      fontWeight: 500,
      height: 36,
      justifyContent: 'center',
      transitionProperty: 'background-color, color',
      width: 36,
      '[data-action=decrement]': {
        borderRightWidth: 1,
      },
      '[data-action=increment]': {
        borderLeftWidth: 1,
      },
      '[data-disabled]': {
        opacity: 0.7,
      },
      ':disabled': {
        backgroundColor: '#f5f5f5',
        color: '#a3a3a3',
        cursor: 'not-allowed',
      },
      ':focus-visible': {
        outlineColor: '#0a0a0a',
        outlineOffset: -2,
        outlineStyle: 'solid',
        outlineWidth: 2,
      },
      ':hover': {
        backgroundColor: '#f5f5f5',
      },
    },
    control: {
      alignItems: 'center',
      backgroundColor: '#ffffff',
      borderColor: '#d4d4d4',
      borderRadius: 6,
      borderStyle: 'solid',
      borderWidth: 1,
      boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
      display: 'inline-flex',
      height: 36,
      overflow: 'hidden',
      width: 'fit-content',
      '[data-disabled]': {
        opacity: 0.6,
      },
      '[data-invalid]': {
        borderColor: '#f87171',
      },
    },
    input: {
      backgroundColor: 'transparent',
      borderWidth: 0,
      color: '#0a0a0a',
      fontSize: 14,
      height: 36,
      outlineStyle: 'none',
      paddingInline: 12,
      textAlign: 'center',
      width: 80,
      '[aria-invalid=true]': {
        color: '#450a0a',
      },
      ':disabled': {
        backgroundColor: '#f5f5f5',
        color: '#737373',
        cursor: 'not-allowed',
      },
      ':focus-visible': {
        outlineColor: '#0a0a0a',
        outlineStyle: 'solid',
        outlineWidth: 2,
      },
    },
    root: {
      color: '#0a0a0a',
      display: 'grid',
      fontSize: 14,
      rowGap: 8,
      '[data-disabled]': {
        opacity: 0.5,
      },
      '[data-invalid]': {
        color: '#450a0a',
      },
    },
  },
  { namespace: 'numberField', source: 'number-field.tsx' },
);

export const numberFieldClasses = [style.attrs(numberFieldStyles.root).class ?? ''] as const;
export const numberFieldControlClasses = [
  style.attrs(numberFieldStyles.control).class ?? '',
] as const;
export const numberFieldInputClasses = [style.attrs(numberFieldStyles.input).class ?? ''] as const;
export const numberFieldButtonClasses = [
  style.attrs(numberFieldStyles.button).class ?? '',
] as const;

export const NumberField = component({
  render(props: NumberFieldProps) {
    const attrs = numberFieldRootAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.max === undefined ? {} : { max: props.max }),
      ...(props.min === undefined ? {} : { min: props.min }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.step === undefined ? {} : { step: props.step }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });
    const styleAttrs = style.attrs(numberFieldStyles.root, props.styles?.root);

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

export const NumberFieldControl = component({
  render(props: NumberFieldProps) {
    const attrs = numberFieldRootAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.max === undefined ? {} : { max: props.max }),
      ...(props.min === undefined ? {} : { min: props.min }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.step === undefined ? {} : { step: props.step }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });
    const styleAttrs = style.attrs(numberFieldStyles.control, props.styles?.control);

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

export const NumberFieldInput = component({
  render(props: NumberFieldInputProps) {
    const attrs = numberFieldInputAttributes({
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.errorId === undefined ? {} : { errorId: props.errorId }),
      ...(props.form === undefined ? {} : { form: props.form }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.label === undefined ? {} : { label: props.label }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.max === undefined ? {} : { max: props.max }),
      ...(props.min === undefined ? {} : { min: props.min }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.step === undefined ? {} : { step: props.step }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });
    const styleAttrs = style.attrs(numberFieldStyles.input, props.styles?.input);

    return (
      <input
        {...styleAttrs}
        aria-describedby={attrs['aria-describedby']}
        aria-invalid={attrs['aria-invalid']}
        aria-label={attrs['aria-label']}
        aria-labelledby={attrs['aria-labelledby']}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        disabled={attrs.disabled}
        form={attrs.form}
        id={attrs.id}
        max={attrs.max}
        min={attrs.min}
        name={attrs.name}
        required={attrs.required}
        step={attrs.step}
        type={attrs.type}
        value={attrs.value}
      />
    );
  },
});

export const NumberFieldDecrement = component({
  render(props: NumberFieldButtonProps) {
    const attrs = numberFieldDecrementAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.inputId === undefined ? {} : { inputId: props.inputId }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.label === undefined ? {} : { label: props.label }),
      ...(props.max === undefined ? {} : { max: props.max }),
      ...(props.min === undefined ? {} : { min: props.min }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.step === undefined ? {} : { step: props.step }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });
    const styleAttrs = style.attrs(numberFieldStyles.button, props.styles?.button);

    return (
      <button
        {...styleAttrs}
        aria-controls={attrs['aria-controls']}
        aria-label={attrs['aria-label']}
        data-action={attrs['data-action']}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        disabled={attrs.disabled}
        id={attrs.id}
        type={attrs.type}
      >
        {props.children ?? '-'}
      </button>
    );
  },
});

export const NumberFieldIncrement = component({
  render(props: NumberFieldButtonProps) {
    const attrs = numberFieldIncrementAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.inputId === undefined ? {} : { inputId: props.inputId }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.label === undefined ? {} : { label: props.label }),
      ...(props.max === undefined ? {} : { max: props.max }),
      ...(props.min === undefined ? {} : { min: props.min }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.step === undefined ? {} : { step: props.step }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });
    const styleAttrs = style.attrs(numberFieldStyles.button, props.styles?.button);

    return (
      <button
        {...styleAttrs}
        aria-controls={attrs['aria-controls']}
        aria-label={attrs['aria-label']}
        data-action={attrs['data-action']}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        disabled={attrs.disabled}
        id={attrs.id}
        type={attrs.type}
      >
        {props.children ?? '+'}
      </button>
    );
  },
});
