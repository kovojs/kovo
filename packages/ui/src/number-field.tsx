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

import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

/**
 * Style override slots accepted by the number field components.
 *
 * @example
 * import type { NumberFieldStyleOverrides } from "@kovojs/ui/number-field";
 * const styles: NumberFieldStyleOverrides = {};
 */
export interface NumberFieldStyleOverrides {
  button?: style.StyleInput;
  control?: style.StyleInput;
  input?: style.StyleInput;
  root?: style.StyleInput;
}

/**
 * Shared state props for the number field component family.
 *
 * @example
 * import type { NumberFieldStateProps } from "@kovojs/ui/number-field";
 * const state: NumberFieldStateProps = {};
 */
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

/**
 * Props for the number field component.
 *
 * @example
 * import type { NumberFieldProps } from "@kovojs/ui/number-field";
 * const props: NumberFieldProps = { children: 'Content' };
 */
export interface NumberFieldProps extends NumberFieldStateProps {
  children?: string;
  id?: string;
  styles?: NumberFieldStyleOverrides;
}

/**
 * Props for the number field input component.
 *
 * @example
 * import type { NumberFieldInputProps } from "@kovojs/ui/number-field";
 * const props: NumberFieldInputProps = {};
 */
export interface NumberFieldInputProps extends NumberFieldStateProps {
  descriptionId?: string;
  errorId?: string;
  form?: string;
  id?: string;
  label?: string;
  labelledBy?: string;
  styles?: NumberFieldStyleOverrides;
}

/**
 * Props for the number field button component.
 *
 * @example
 * import type { NumberFieldButtonProps } from "@kovojs/ui/number-field";
 * const props: NumberFieldButtonProps = { children: 'Content' };
 */
export interface NumberFieldButtonProps extends NumberFieldStateProps {
  children?: string;
  id?: string;
  inputId?: string;
  label?: string;
  styles?: NumberFieldStyleOverrides;
}

/**
 * Style definitions used by the number field components.
 *
 * @example
 * import { numberFieldStyles } from "@kovojs/ui/number-field";
 * const styles = numberFieldStyles;
 */
export const numberFieldStyles = style.create({
  button: {
    alignItems: 'center',
    backgroundColor: uiTheme.color.backgroundRaised,
    borderColor: uiTheme.color.border,
    borderStyle: 'solid',
    color: uiTheme.color.foregroundMuted,
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
      backgroundColor: uiTheme.color.backgroundSubtle,
      color: uiTheme.color.foregroundMuted,
      cursor: 'not-allowed',
    },
    ':focus-visible': {
      outlineColor: uiTheme.color.accent,
      outlineOffset: -2,
      outlineStyle: 'solid',
      outlineWidth: 2,
    },
    ':hover': {
      backgroundColor: uiTheme.color.backgroundSubtle,
    },
  },
  control: {
    alignItems: 'center',
    backgroundColor: uiTheme.color.background,
    borderColor: uiTheme.color.border,
    borderRadius: uiTheme.radius.md,
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
      borderColor: uiTheme.color.danger.border,
    },
  },
  input: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    color: uiTheme.color.foreground,
    fontSize: 14,
    height: 36,
    outlineStyle: 'none',
    paddingInline: 12,
    textAlign: 'center',
    width: 80,
    '[aria-invalid=true]': {
      color: uiTheme.color.danger.foreground,
    },
    ':disabled': {
      backgroundColor: uiTheme.color.backgroundSubtle,
      color: uiTheme.color.foregroundMuted,
      cursor: 'not-allowed',
    },
    ':focus-visible': {
      outlineColor: uiTheme.color.accent,
      outlineStyle: 'solid',
      outlineWidth: 2,
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
});

/**
 * Renders the styled number field primitive.
 *
 * @example
 * import { NumberField } from "@kovojs/ui/number-field";
 * const component = NumberField;
 */
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
 * Renders the styled number field control primitive.
 *
 * @example
 * import { NumberFieldControl } from "@kovojs/ui/number-field";
 * const component = NumberFieldControl;
 */
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
 * Renders the styled number field input primitive.
 *
 * @example
 * import { NumberFieldInput } from "@kovojs/ui/number-field";
 * const component = NumberFieldInput;
 */
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
        {...passThroughProps(props)}
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

/**
 * Renders the styled number field decrement primitive.
 *
 * @example
 * import { NumberFieldDecrement } from "@kovojs/ui/number-field";
 * const component = NumberFieldDecrement;
 */
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
        {...passThroughProps(props)}
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

/**
 * Renders the styled number field increment primitive.
 *
 * @example
 * import { NumberFieldIncrement } from "@kovojs/ui/number-field";
 * const component = NumberFieldIncrement;
 */
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
        {...passThroughProps(props)}
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
