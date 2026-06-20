/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  otpFieldHiddenInputAttributes,
  otpFieldInputAttributes,
  otpFieldRootAttributes,
  type OtpFieldInputMode,
} from '@kovojs/headless-ui/otp-field';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

export interface OtpFieldStyleOverrides {
  group?: style.StyleInput;
  hiddenInput?: style.StyleInput;
  input?: style.StyleInput;
  root?: style.StyleInput;
}

export interface OtpFieldStateProps {
  disabled?: boolean;
  form?: string;
  inputMode?: OtpFieldInputMode;
  invalid?: boolean;
  length?: number;
  name?: string;
  pattern?: string;
  required?: boolean;
  value?: string;
}

export interface OtpFieldProps extends OtpFieldStateProps {
  children?: string;
  descriptionId?: string;
  errorId?: string;
  id?: string;
  labelledBy?: string;
  styles?: OtpFieldStyleOverrides;
}

export interface OtpFieldHiddenInputProps extends OtpFieldStateProps {
  id?: string;
  styles?: OtpFieldStyleOverrides;
}

export interface OtpFieldInputProps extends OtpFieldStateProps {
  id?: string;
  label?: string;
  labelledBy?: string;
  slotIndex: number;
  styles?: OtpFieldStyleOverrides;
}

export const otpFieldStyles = style.create({
  group: {
    alignItems: 'center',
    display: 'flex',
  },
  hiddenInput: {
    borderWidth: 0,
    clip: 'rect(0, 0, 0, 0)',
    height: 1,
    margin: -1,
    overflow: 'hidden',
    padding: 0,
    position: 'absolute',
    whiteSpace: 'nowrap',
    width: 1,
  },
  // Base slot. Slots sit edge-to-edge sharing inner borders: every slot keeps
  // its top/bottom/right border, but only the first slot draws a left border
  // (others use borderLeftWidth 0) and only the ends are rounded. End/rounding
  // is applied per-position via the `first`/`last` variants below.
  input: {
    backgroundColor: uiTheme.color.background,
    borderColor: uiTheme.color.border,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderStyle: 'solid',
    borderWidth: 1,
    borderLeftWidth: 0,
    boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
    color: uiTheme.color.foreground,
    fontSize: 16,
    fontWeight: 500,
    height: 40,
    textAlign: 'center',
    transitionProperty: 'border-color, color, box-shadow',
    width: 40,
    // Keep the focus ring above the shared borders so the active slot reads.
    position: 'relative',
    '[data-filled]': {
      borderColor: uiTheme.color.borderStrong,
    },
    '[data-invalid]': {
      borderColor: uiTheme.color.danger.border,
    },
    ':disabled': {
      backgroundColor: uiTheme.color.backgroundSubtle,
      color: uiTheme.color.foregroundMuted,
      cursor: 'not-allowed',
    },
    ':focus-visible': {
      outlineColor: uiTheme.color.accent,
      outlineOffset: 2,
      outlineStyle: 'solid',
      outlineWidth: 2,
      zIndex: 1,
    },
    '[data-invalid]:focus-visible': {
      outlineColor: uiTheme.color.danger.border,
    },
  },
  // First slot: restore its left border and round the left corners.
  inputFirst: {
    borderLeftWidth: 1,
    borderTopLeftRadius: uiTheme.radius.md,
    borderBottomLeftRadius: uiTheme.radius.md,
  },
  // Last slot: round the right corners.
  inputLast: {
    borderTopRightRadius: uiTheme.radius.md,
    borderBottomRightRadius: uiTheme.radius.md,
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

export const otpFieldClasses = [style.attrs(otpFieldStyles.root).class ?? ''] as const;
export const otpFieldGroupClasses = [style.attrs(otpFieldStyles.group).class ?? ''] as const;
export const otpFieldHiddenInputClasses = [
  style.attrs(otpFieldStyles.hiddenInput).class ?? '',
] as const;
export const otpFieldInputClasses = [style.attrs(otpFieldStyles.input).class ?? ''] as const;

export const OtpField = component({
  render(props: OtpFieldProps) {
    const attrs = otpFieldRootAttributes({
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.errorId === undefined ? {} : { errorId: props.errorId }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.inputMode === undefined ? {} : { inputMode: props.inputMode }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.length === undefined ? {} : { length: props.length }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.pattern === undefined ? {} : { pattern: props.pattern }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });
    const styleAttrs = style.attrs(otpFieldStyles.root, props.styles?.root);

    return (
      <div
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-describedby={attrs['aria-describedby']}
        aria-disabled={attrs['aria-disabled']}
        aria-invalid={attrs['aria-invalid']}
        aria-labelledby={attrs['aria-labelledby']}
        aria-required={attrs['aria-required']}
        data-complete={attrs['data-complete']}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        id={attrs.id}
        role={attrs.role}
      >
        {props.children}
      </div>
    );
  },
});

export const OtpFieldGroup = component({
  render(props: { children?: string; styles?: OtpFieldStyleOverrides }) {
    const styleAttrs = style.attrs(otpFieldStyles.group, props.styles?.group);
    return <div {...styleAttrs}>{props.children}</div>;
  },
});

export const OtpFieldHiddenInput = component({
  render(props: OtpFieldHiddenInputProps) {
    const attrs = otpFieldHiddenInputAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.form === undefined ? {} : { form: props.form }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.inputMode === undefined ? {} : { inputMode: props.inputMode }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.length === undefined ? {} : { length: props.length }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.pattern === undefined ? {} : { pattern: props.pattern }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });
    const styleAttrs = style.attrs(otpFieldStyles.hiddenInput, props.styles?.hiddenInput);

    return (
      <input
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-hidden={attrs['aria-hidden']}
        autoComplete={attrs.autoComplete}
        data-complete={attrs['data-complete']}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        data-slot={attrs['data-slot']}
        disabled={attrs.disabled}
        form={attrs.form}
        id={attrs.id}
        inputMode={attrs.inputMode}
        maxLength={attrs.maxLength}
        minLength={attrs.minLength}
        name={attrs.name}
        pattern={attrs.pattern}
        required={attrs.required}
        tabIndex={attrs.tabIndex}
        type={attrs.type}
        value={attrs.value}
      />
    );
  },
});

export const OtpFieldInput = component({
  render(props: OtpFieldInputProps) {
    const attrs = otpFieldInputAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.inputMode === undefined ? {} : { inputMode: props.inputMode }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.label === undefined ? {} : { label: props.label }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.length === undefined ? {} : { length: props.length }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.pattern === undefined ? {} : { pattern: props.pattern }),
      ...(props.required === undefined ? {} : { required: props.required }),
      slotIndex: props.slotIndex,
      ...(props.value === undefined ? {} : { value: props.value }),
    });
    const isFirst = props.slotIndex === 0;
    const isLast = props.length !== undefined && props.slotIndex === props.length - 1;
    const styleAttrs = style.attrs(
      otpFieldStyles.input,
      isFirst ? otpFieldStyles.inputFirst : null,
      isLast ? otpFieldStyles.inputLast : null,
      props.styles?.input,
    );

    return (
      <input
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-invalid={attrs['aria-invalid']}
        aria-label={attrs['aria-label']}
        aria-labelledby={attrs['aria-labelledby']}
        autoComplete={attrs.autoComplete}
        data-complete={attrs['data-complete']}
        data-disabled={attrs['data-disabled']}
        data-filled={attrs['data-filled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        data-slot={attrs['data-slot']}
        disabled={attrs.disabled}
        id={attrs.id}
        inputMode={attrs.inputMode}
        maxLength={attrs.maxLength}
        pattern={attrs.pattern}
        required={attrs.required}
        type={attrs.type}
        value={attrs.value}
      />
    );
  },
});
